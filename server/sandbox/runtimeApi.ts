import { createHash, randomUUID } from 'node:crypto'
import {
  parseTerminalCommand,
} from '../../src/lib/sandbox/commands'
import { validateProjectFiles } from '../../src/lib/sandbox/files'
import { redactSecrets } from '../../src/lib/sandbox/redaction'
import type {
  CloudRuntime,
  ExecuteCommand,
  ProjectFile,
} from '../../src/lib/sandbox/protocol'
import {
  authorizeAccess,
  type PrivateRuntimeCredentials,
  type RuntimeConfig,
} from './config'
import type {
  SandboxCommandIdempotency,
  SandboxCommandResult,
  SandboxProvider,
} from './provider'
import {
  SandboxIdempotencyConflictError,
  SandboxNotFoundError,
} from './provider'
import {
  clearSessionCookie,
  openSession,
  parseSessionCookie,
  sealSession,
  serializeSessionCookie,
  type SessionPayload,
} from './session'

export interface RuntimeRequest {
  method: string
  headers: Record<string, string | undefined>
  body?: unknown
}

export interface RuntimeResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

interface RuntimeApiOptions {
  config: RuntimeConfig
  credentials: PrivateRuntimeCredentials | undefined
  provider: SandboxProvider
  now?: () => number
}

interface CommandRequest {
  command: ExecuteCommand
  environment: Record<string, string>
  secretNames: string[]
}

const WORKSPACE = '/vercel/sandbox/workspace'
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MINIMUM_REDACTABLE_SECRET_LENGTH = 8
const MAX_WARM_IDEMPOTENCY_ENTRIES = 100
const MAX_WARM_IDEMPOTENCY_AGE_MS = 5 * 60 * 1000
const encoder = new TextEncoder()

function error(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): RuntimeResponse {
  return {
    status,
    ...(headers ? { headers } : {}),
    body: { error: { code, message } },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRuntime(value: unknown): value is CloudRuntime {
  return value === 'python' || value === 'node'
}

function accessToken(req: RuntimeRequest): string | undefined {
  return req.headers['x-playground-access']
}

function cookieToken(req: RuntimeRequest): string | undefined {
  return parseSessionCookie(req.headers.cookie)
}

function parseFiles(value: unknown): ProjectFile[] {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new Error('Invalid project files')
  }

  return value.files.map((file) => {
    if (
      !isRecord(file)
      || typeof file.path !== 'string'
      || typeof file.content !== 'string'
    ) {
      throw new Error('Invalid project files')
    }
    return { path: file.path, content: file.content }
  })
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./@,:=+*~!<>-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function validateCommand(
  value: unknown,
  runtime: CloudRuntime,
): ExecuteCommand {
  if (
    !isRecord(value)
    || value.kind !== 'execute'
    || typeof value.executable !== 'string'
    || !Array.isArray(value.args)
    || value.args.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error('Invalid command')
  }

  const args = value.args as string[]
  if (args.some((argument) => /[;\n\r|&]/.test(argument))) {
    throw new Error('Shell operators are not supported')
  }

  const parsed = parseTerminalCommand(
    [value.executable, ...args].map(shellToken).join(' '),
    runtime,
  )
  if (
    parsed.kind !== 'execute'
    || parsed.executable !== value.executable
    || parsed.args.length !== args.length
    || parsed.args.some((argument, index) => argument !== args[index])
  ) {
    throw new Error('Invalid command')
  }
  return parsed
}

function parseEnvironment(
  environmentValue: unknown,
  secretNamesValue: unknown,
  allowByok: boolean,
  maxEntries: number,
  maxValueBytes: number,
): {
  environment: Record<string, string>
  secrets: string[]
  secretNames: string[]
} {
  if (!isRecord(environmentValue) || !Array.isArray(secretNamesValue)) {
    throw new Error('Invalid environment')
  }
  if (
    Object.keys(environmentValue).length > maxEntries
    || secretNamesValue.length > maxEntries
  ) {
    throw new Error('Too many environment variables')
  }

  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(environmentValue)) {
    if (
      !ENVIRONMENT_NAME.test(name)
      || typeof value !== 'string'
      || encoder.encode(value).byteLength > maxValueBytes
      || /[\0\r\n]/.test(value)
    ) {
      throw new Error('Invalid environment')
    }
    environment[name] = value
  }

  if (
    secretNamesValue.some((name) => (
      typeof name !== 'string'
      || !ENVIRONMENT_NAME.test(name)
      || !(name in environment)
    ))
  ) {
    throw new Error('Invalid secret selection')
  }
  if (!allowByok && secretNamesValue.length > 0) {
    throw new Error('Temporary secrets are disabled')
  }

  const secretNames = [...new Set(secretNamesValue as string[])]
  if (secretNames.some(
    (name) => environment[name].length < MINIMUM_REDACTABLE_SECRET_LENGTH,
  )) {
    throw new Error('Selected secrets must be at least eight characters')
  }
  return {
    environment,
    secrets: secretNames.map((name) => environment[name]),
    secretNames,
  }
}

function commandFingerprint(commandRequest: CommandRequest): string {
  const canonical = JSON.stringify({
    command: commandRequest.command,
    environment: Object.entries(commandRequest.environment)
      .sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      )),
    secretNames: [...commandRequest.secretNames].sort(),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function normalizeOutput(
  result: SandboxCommandResult,
  secrets: string[],
  maxOutputBytes: number,
): SandboxCommandResult['output'] {
  const sorted = [...result.output].sort(
    (left, right) => left.sequence - right.sequence,
  )
  let totalBytes = 0
  for (const chunk of sorted) {
    if (
      !Number.isSafeInteger(chunk.sequence)
      || chunk.sequence < 0
      || (chunk.stream !== 'stdout' && chunk.stream !== 'stderr')
      || typeof chunk.text !== 'string'
    ) {
      throw new Error('Invalid provider output')
    }
    totalBytes += encoder.encode(chunk.text).byteLength
    if (totalBytes > maxOutputBytes) throw new Error('Output limit exceeded')
  }

  const fullText = sorted.map((chunk) => chunk.text).join('')
  const redactedFullText = redactSecrets(fullText, secrets)
  if (redactedFullText === fullText) return sorted

  const candidates = [...new Set(secrets)]
    .filter((secret) => secret.length >= MINIMUM_REDACTABLE_SECRET_LENGTH)
    .sort((left, right) => right.length - left.length)
  const texts = sorted.map(() => '')
  const boundaries: number[] = []
  let boundary = 0
  for (const chunk of sorted) {
    boundary += chunk.text.length
    boundaries.push(boundary)
  }
  let chunkIndex = 0
  for (let index = 0; index < fullText.length;) {
    while (index >= boundaries[chunkIndex] && chunkIndex < sorted.length - 1) {
      chunkIndex += 1
    }
    const secret = candidates.find((candidate) => fullText.startsWith(candidate, index))
    if (secret) {
      texts[chunkIndex] += '[REDACTED]'
      index += secret.length
      continue
    }
    texts[chunkIndex] += fullText[index]
    index += 1
  }

  const output = sorted.map((chunk, index) => ({ ...chunk, text: texts[index] }))
  if (output.map((chunk) => chunk.text).join('') !== redactedFullText) {
    throw new Error('Unable to redact provider output')
  }
  return output
}

export class RuntimeApi {
  private readonly config: RuntimeConfig
  private readonly credentials: PrivateRuntimeCredentials | undefined
  private readonly provider: SandboxProvider
  private readonly now: () => number
  private readonly commandResponses = new Map<string, {
    expiresAt: number
    requestFingerprint: string
    response: Promise<RuntimeResponse>
  }>()

  constructor(options: RuntimeApiOptions) {
    this.config = options.config
    this.credentials = options.credentials
    this.provider = options.provider
    this.now = options.now ?? Date.now
  }

  async capabilities(req: RuntimeRequest): Promise<RuntimeResponse> {
    void req
    return { status: 200, body: this.config }
  }

  async createSession(req: RuntimeRequest): Promise<RuntimeResponse> {
    if (!this.config.enabled) {
      return error(503, 'CLOUD_DISABLED', this.config.reason)
    }
    const credentials = this.credentials
    if (!credentials || !authorizeAccess(credentials, accessToken(req))) {
      return error(401, 'ACCESS_DENIED', 'The playground access token is invalid.')
    }
    if (!isRecord(req.body) || !isRuntime(req.body.runtime)) {
      return error(400, 'COMMAND_REJECTED', 'Select a supported cloud runtime.')
    }
    if (!this.config.runtimes.includes(req.body.runtime)) {
      return error(400, 'COMMAND_REJECTED', 'Select a supported cloud runtime.')
    }

    const runtime = req.body.runtime
    const name = `pathwise-${randomUUID()}`
    try {
      await this.provider.create(
        runtime,
        name,
        this.config.limits.sandboxTimeoutMs,
      )
      const token = await sealSession({
        name,
        runtime,
        expiresAt: this.now() + this.config.limits.sandboxTimeoutMs,
      }, credentials.sessionSecret)
      return {
        status: 201,
        headers: { 'Set-Cookie': serializeSessionCookie(token) },
        body: { runtime },
      }
    } catch {
      return error(
        503,
        'SANDBOX_UNAVAILABLE',
        'The cloud sandbox is temporarily unavailable.',
      )
    }
  }

  async destroySession(req: RuntimeRequest): Promise<RuntimeResponse> {
    return this.stop(req)
  }

  async syncFiles(req: RuntimeRequest): Promise<RuntimeResponse> {
    const rejection = this.authorize(req)
    if (rejection) return rejection

    let files: ProjectFile[]
    try {
      files = validateProjectFiles(
        parseFiles(req.body),
        this.config.limits,
      )
    } catch {
      return error(400, 'PROJECT_LIMIT', 'The project files are invalid or exceed a limit.')
    }

    const session = await this.session(req)
    if ('status' in session) return session
    try {
      const sandbox = await this.provider.get(session.name)
      await sandbox.writeFiles(files)
      return { status: 204 }
    } catch {
      return error(
        503,
        'SANDBOX_UNAVAILABLE',
        'The cloud sandbox is temporarily unavailable.',
      )
    }
  }

  async runCommand(req: RuntimeRequest): Promise<RuntimeResponse> {
    const idempotencyKey = req.headers['idempotency-key']
    if (
      typeof idempotencyKey !== 'string'
      || idempotencyKey.trim().length === 0
      || encoder.encode(idempotencyKey).byteLength > 256
      || /[\0\r\n]/.test(idempotencyKey)
    ) {
      return error(400, 'COMMAND_REJECTED', 'A valid Idempotency-Key is required.')
    }
    const responseHeaders = { 'Idempotency-Key': idempotencyKey }

    const rejection = this.authorize(req)
    if (rejection) return this.withHeaders(rejection, responseHeaders)

    const session = await this.session(req)
    if ('status' in session) return this.withHeaders(session, responseHeaders)

    let commandRequest: CommandRequest
    let secrets: string[]
    try {
      if (!isRecord(req.body)) throw new Error('Invalid command request')
      const command = validateCommand(req.body.command, session.runtime)
      const parsedEnvironment = parseEnvironment(
        req.body.environment,
        req.body.secretNames,
        this.config.allowByok,
        this.config.limits.maxArgs,
        this.config.limits.maxArgBytes,
      )
      commandRequest = {
        command,
        environment: parsedEnvironment.environment,
        secretNames: parsedEnvironment.secretNames,
      }
      secrets = parsedEnvironment.secrets
    } catch {
      return error(
        400,
        'COMMAND_REJECTED',
        'The command or environment is invalid.',
        responseHeaders,
      )
    }

    const cacheKey = `${session.name}\0${idempotencyKey}`
    const requestFingerprint = commandFingerprint(commandRequest)
    const cached = this.cachedCommandResponse(
      cacheKey,
      requestFingerprint,
      responseHeaders,
    )
    if (cached) return cached
    const response = this.executeCommand(
      session,
      { key: idempotencyKey, requestFingerprint },
      commandRequest,
      secrets,
      responseHeaders,
    )
    this.cacheCommandResponse(cacheKey, requestFingerprint, response)
    return response
  }

  private async executeCommand(
    session: SessionPayload,
    idempotency: SandboxCommandIdempotency,
    commandRequest: CommandRequest,
    secrets: string[],
    responseHeaders: Record<string, string>,
  ): Promise<RuntimeResponse> {
    try {
      const sandbox = await this.provider.get(session.name)
      const result = await sandbox.runIdempotent({
        executable: 'flock',
        args: [
          '-n',
          '-E',
          '75',
          '/tmp/pathwise-command.lock',
          commandRequest.command.executable,
          ...commandRequest.command.args,
        ],
        cwd: WORKSPACE,
        env: commandRequest.environment,
        timeoutMs: this.config.limits.commandTimeoutMs,
      }, idempotency)
      if (result.exitCode === 75) {
        return error(
          409,
          'COMMAND_IN_PROGRESS',
          'Another command is already running.',
          responseHeaders,
        )
      }
      const output = normalizeOutput(
        result,
        secrets,
        this.config.limits.maxOutputBytes,
      )
      return {
        status: 200,
        headers: responseHeaders,
        body: {
          idempotencyKey: idempotency.key,
          exitCode: result.exitCode,
          output,
        },
      }
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'Output limit exceeded') {
        return error(
          413,
          'OUTPUT_LIMIT',
          'Command output exceeded the configured limit.',
          responseHeaders,
        )
      }
      if (caught instanceof SandboxIdempotencyConflictError) {
        return error(
          409,
          'IDEMPOTENCY_CONFLICT',
          'The Idempotency-Key was already used for a different command.',
          responseHeaders,
        )
      }
      return error(
        503,
        'SANDBOX_UNAVAILABLE',
        'The cloud sandbox is temporarily unavailable.',
        responseHeaders,
      )
    }
  }

  async stop(req: RuntimeRequest): Promise<RuntimeResponse> {
    const headers = { 'Set-Cookie': clearSessionCookie() }
    const rejection = this.authorize(req)
    if (rejection) return this.withHeaders(rejection, headers)

    if (!cookieToken(req)) return { status: 204, headers }

    const session = await this.session(req)
    if ('status' in session) return { status: 204, headers }
    try {
      const sandbox = await this.provider.get(session.name)
      await sandbox.stopIdempotent()
      return { status: 204, headers }
    } catch (caught) {
      if (caught instanceof SandboxNotFoundError) return { status: 204, headers }
      return error(
        503,
        'SANDBOX_UNAVAILABLE',
        'The cloud sandbox is temporarily unavailable.',
        headers,
      )
    }
  }

  private cachedCommandResponse(
    key: string,
    requestFingerprint: string,
    responseHeaders: Record<string, string>,
  ): Promise<RuntimeResponse> | undefined {
    const entry = this.commandResponses.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.commandResponses.delete(key)
      return undefined
    }
    if (entry.requestFingerprint !== requestFingerprint) {
      return Promise.resolve(error(
        409,
        'IDEMPOTENCY_CONFLICT',
        'The Idempotency-Key was already used for a different command.',
        responseHeaders,
      ))
    }
    return entry.response
  }

  private cacheCommandResponse(
    key: string,
    requestFingerprint: string,
    response: Promise<RuntimeResponse>,
  ): void {
    const now = this.now()
    for (const [cachedKey, entry] of this.commandResponses) {
      if (entry.expiresAt <= now) this.commandResponses.delete(cachedKey)
    }
    while (this.commandResponses.size >= MAX_WARM_IDEMPOTENCY_ENTRIES) {
      const oldest = this.commandResponses.keys().next().value as string | undefined
      if (!oldest) break
      this.commandResponses.delete(oldest)
    }
    this.commandResponses.set(key, {
      expiresAt: now + Math.min(
        MAX_WARM_IDEMPOTENCY_AGE_MS,
        this.config.limits.sandboxTimeoutMs,
      ),
      requestFingerprint,
      response,
    })
    void response.then(
      (result) => {
        if (result.status >= 500) this.deleteCachedResponse(key, response)
      },
      () => this.deleteCachedResponse(key, response),
    )
  }

  private deleteCachedResponse(
    key: string,
    response: Promise<RuntimeResponse>,
  ): void {
    if (this.commandResponses.get(key)?.response === response) {
      this.commandResponses.delete(key)
    }
  }

  private withHeaders(
    response: RuntimeResponse,
    headers: Record<string, string>,
  ): RuntimeResponse {
    return {
      ...response,
      headers: { ...response.headers, ...headers },
    }
  }

  private authorize(req: RuntimeRequest): RuntimeResponse | undefined {
    if (!this.config.enabled) {
      return error(503, 'CLOUD_DISABLED', this.config.reason)
    }
    if (!authorizeAccess(this.credentials, accessToken(req))) {
      return error(401, 'ACCESS_DENIED', 'The playground access token is invalid.')
    }
    return undefined
  }

  private async session(
    req: RuntimeRequest,
  ): Promise<SessionPayload | RuntimeResponse> {
    const token = cookieToken(req)
    if (!token || !this.credentials) {
      return error(401, 'SESSION_EXPIRED', 'The cloud session has expired.')
    }
    try {
      return await openSession(token, this.credentials.sessionSecret, this.now())
    } catch {
      return error(401, 'SESSION_EXPIRED', 'The cloud session has expired.')
    }
  }
}
