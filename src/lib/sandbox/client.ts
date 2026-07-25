import type {
  CloudRuntime,
  CommandResult,
  ExecuteCommand,
  ProjectFile,
  RuntimeCapabilities,
} from './protocol.js'

export type {
  CommandOutputChunk,
  CommandResult,
  RuntimeCapabilities,
} from './protocol.js'

type Fetch = typeof globalThis.fetch
type IdempotencyKeyFactory = () => string

interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

const INVALID_RESPONSE_MESSAGE =
  'The runtime service returned an invalid response.'
const INVALID_IDEMPOTENCY_KEY_MESSAGE =
  'The command request could not be prepared.'
const encoder = new TextEncoder()

export class RuntimeClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'RuntimeClientError'
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!isRecord(value) || !isRecord(value.error)) return false
  return typeof value.error.code === 'string'
    && value.error.code.length > 0
    && typeof value.error.message === 'string'
    && value.error.message.length > 0
}

function invalidResponse(status: number): RuntimeClientError {
  return new RuntimeClientError(
    'INVALID_RESPONSE',
    INVALID_RESPONSE_MESSAGE,
    status,
  )
}

function invalidIdempotencyKey(): RuntimeClientError {
  return new RuntimeClientError(
    'COMMAND_REJECTED',
    INVALID_IDEMPOTENCY_KEY_MESSAGE,
    0,
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw invalidResponse(response.status)
  }
}

function redactSensitiveValues(
  message: string,
  sensitiveValues: readonly string[],
): string {
  let redacted = message
  const values = [...new Set(sensitiveValues)]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
  for (const value of values) {
    redacted = redacted.replaceAll(value, '[REDACTED]')
  }
  return redacted
}

async function accept(
  response: Response,
  sensitiveValues: readonly string[] = [],
): Promise<Response> {
  if (response.ok) return response
  const body = await readJson(response)
  if (!isApiErrorBody(body)) throw invalidResponse(response.status)
  throw new RuntimeClientError(
    body.error.code,
    redactSensitiveValues(body.error.message, sensitiveValues),
    response.status,
  )
}

function accessHeaders(
  accessToken: string,
  json = false,
): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Playground-Access': accessToken,
  }
}

function isCommandResult(value: unknown): value is CommandResult {
  if (
    !isRecord(value)
    || typeof value.idempotencyKey !== 'string'
    || !Number.isSafeInteger(value.exitCode)
    || !Array.isArray(value.output)
  ) {
    return false
  }
  return value.output.every((chunk) => (
    isRecord(chunk)
    && Number.isSafeInteger(chunk.sequence)
    && (chunk.stream === 'stdout' || chunk.stream === 'stderr')
    && typeof chunk.text === 'string'
  ))
}

const defaultIdempotencyKey: IdempotencyKeyFactory = () =>
  globalThis.crypto.randomUUID()

export class SandboxClient {
  private readonly fetch: Fetch
  private readonly createIdempotencyKey: IdempotencyKeyFactory
  private readonly usedIdempotencyKeys = new Set<string>()

  constructor(
    // The native fetch must be invoked with the global object as its receiver;
    // storing `globalThis.fetch` directly and calling it as `this.fetch(...)`
    // throws "Illegal invocation" in browsers. Wrap it so the receiver is
    // always correct, and resolve it lazily to avoid a module-load dependency.
    fetch: Fetch = (input, init) => globalThis.fetch(input, init),
    createIdempotencyKey: IdempotencyKeyFactory = defaultIdempotencyKey,
  ) {
    this.fetch = fetch
    this.createIdempotencyKey = createIdempotencyKey
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    const response = await accept(await this.fetch('/api/runtime/capabilities', {
      credentials: 'same-origin',
    }))
    return await readJson(response) as RuntimeCapabilities
  }

  async create(runtime: CloudRuntime, accessToken: string): Promise<void> {
    await accept(await this.fetch('/api/runtime/sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: accessHeaders(accessToken, true),
      body: JSON.stringify({ runtime }),
    }), [accessToken])
  }

  async syncFiles(
    files: ProjectFile[],
    accessToken: string,
  ): Promise<void> {
    await accept(await this.fetch('/api/runtime/files', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: accessHeaders(accessToken, true),
      body: JSON.stringify({ files }),
    }), [accessToken])
  }

  async run(
    command: ExecuteCommand,
    environment: Record<string, string>,
    secretNames: string[],
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const idempotencyKey = this.createIdempotencyKey()
    if (
      typeof idempotencyKey !== 'string'
      || idempotencyKey.trim().length === 0
      || encoder.encode(idempotencyKey).byteLength > 256
      || /[\0\r\n]/.test(idempotencyKey)
      || this.usedIdempotencyKeys.has(idempotencyKey)
    ) {
      throw invalidIdempotencyKey()
    }
    this.usedIdempotencyKeys.add(idempotencyKey)
    const response = await accept(await this.fetch('/api/runtime/commands', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...accessHeaders(accessToken, true),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ command, environment, secretNames }),
      signal,
    }), [accessToken, ...Object.values(environment)])
    const body = await readJson(response)
    if (
      !isCommandResult(body)
      || body.idempotencyKey !== idempotencyKey
      || response.headers.get('Idempotency-Key') !== idempotencyKey
    ) {
      throw invalidResponse(response.status)
    }
    return {
      ...body,
      output: [...body.output].sort(
        (left, right) => left.sequence - right.sequence,
      ),
    }
  }

  async stop(accessToken: string): Promise<void> {
    await accept(await this.fetch('/api/runtime/stop', {
      method: 'POST',
      credentials: 'same-origin',
      headers: accessHeaders(accessToken),
    }), [accessToken])
  }

  async destroy(accessToken: string): Promise<void> {
    await accept(await this.fetch('/api/runtime/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: accessHeaders(accessToken),
    }), [accessToken])
  }
}
