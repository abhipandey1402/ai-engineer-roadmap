import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIMITS, type CloudRuntime } from '../../src/lib/sandbox/protocol'
import type {
  SandboxCommandIdempotency,
  SandboxCommand,
  SandboxCommandResult,
  SandboxHandle,
  SandboxProvider,
} from './provider'
import {
  SandboxIdempotencyConflictError,
  SandboxNotFoundError,
} from './provider'
import { nodeHandler, readJsonBody } from './http'
import { RuntimeApi, type RuntimeRequest } from './runtimeApi'
import { sealSession } from './session'

const SESSION_SECRET = 'test-session-secret-with-at-least-32-characters'
const NOW = 2_000_000_000_000
const enabledConfig = {
  enabled: true as const,
  runtimes: ['python', 'node'] as const,
  allowByok: true,
  limits: DEFAULT_LIMITS,
}
const disabledConfig = {
  enabled: false as const,
  reason: 'Cloud runtime is disabled.',
  runtimes: [] as const,
  allowByok: false,
  limits: DEFAULT_LIMITS,
}
const credentials = {
  sessionSecret: SESSION_SECRET,
  accessToken: 'owner-token',
}

class FakeHandle implements SandboxHandle {
  readonly writeCalls: Parameters<SandboxHandle['writeFiles']>[0][] = []
  readonly runCalls: SandboxCommand[] = []
  readonly idempotentRunCalls: Array<{
    command: SandboxCommand
    idempotencyKey: string
    requestFingerprint: string | undefined
  }> = []
  executionStarts = 0
  stopCalls = 0
  stopIdempotentCalls = 0
  runResult: SandboxCommandResult = { exitCode: 0, output: [] }
  runError: unknown
  runDeferred: Promise<SandboxCommandResult> | undefined
  private readonly executions = new Map<string, Promise<SandboxCommandResult>>()
  private readonly fingerprints = new Map<string, string | undefined>()

  constructor(readonly name: string) {}

  async writeFiles(files: Parameters<SandboxHandle['writeFiles']>[0]): Promise<void> {
    this.writeCalls.push(files)
  }

  async run(command: SandboxCommand): Promise<SandboxCommandResult> {
    this.runCalls.push(command)
    if (this.runError) throw this.runError
    return this.runResult
  }

  async runIdempotent(
    command: SandboxCommand,
    idempotency: SandboxCommandIdempotency,
  ): Promise<SandboxCommandResult> {
    const idempotencyKey = idempotency.key
    const requestFingerprint = idempotency.requestFingerprint
    this.idempotentRunCalls.push({
      command,
      idempotencyKey,
      requestFingerprint,
    })
    if (
      this.fingerprints.has(idempotencyKey)
      && this.fingerprints.get(idempotencyKey) !== requestFingerprint
    ) {
      throw new SandboxIdempotencyConflictError()
    }
    const existing = this.executions.get(idempotencyKey)
    if (existing) return existing
    this.executionStarts += 1
    this.fingerprints.set(idempotencyKey, requestFingerprint)
    const execution = this.runDeferred ?? this.run(command)
    this.executions.set(idempotencyKey, execution)
    return execution
  }

  private async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async stopIdempotent(): Promise<void> {
    this.stopIdempotentCalls += 1
    await this.stop()
  }
}

class FakeProvider implements SandboxProvider {
  readonly createCalls: Array<{
    runtime: CloudRuntime
    name: string
    timeoutMs: number
  }> = []
  readonly getCalls: string[] = []
  readonly handles = new Map<string, FakeHandle>()
  createError: unknown
  getError: unknown

  async create(
    runtime: CloudRuntime,
    name: string,
    timeoutMs: number,
  ): Promise<SandboxHandle> {
    this.createCalls.push({ runtime, name, timeoutMs })
    if (this.createError) throw this.createError
    const handle = new FakeHandle(name)
    this.handles.set(name, handle)
    return handle
  }

  async get(name: string): Promise<SandboxHandle> {
    this.getCalls.push(name)
    if (this.getError) throw this.getError
    const handle = this.handles.get(name)
    if (!handle) throw new SandboxNotFoundError(name)
    return handle
  }
}

function request(
  body?: unknown,
  headers: RuntimeRequest['headers'] = {},
): RuntimeRequest {
  return { method: 'POST', headers, body }
}

function accessHeaders(extra: RuntimeRequest['headers'] = {}): RuntimeRequest['headers'] {
  return { 'x-playground-access': 'owner-token', ...extra }
}

function errorCode(response: { body?: unknown }): unknown {
  return (response.body as { error?: { code?: unknown } })?.error?.code
}

async function createApi(
  runtime: CloudRuntime = 'python',
  now: () => number = () => NOW,
) {
  const provider = new FakeProvider()
  const api = new RuntimeApi({
    config: enabledConfig,
    credentials,
    provider,
    now,
  })
  const created = await api.createSession(request({ runtime }, accessHeaders()))
  const cookie = created.headers?.['Set-Cookie'].split(';')[0]
  if (!cookie) throw new Error('expected session cookie')
  const name = provider.createCalls[0].name
  const handle = provider.handles.get(name)
  if (!handle) throw new Error('expected sandbox handle')
  return { api, provider, created, cookie, handle }
}

describe('RuntimeApi', () => {
  it('returns public capabilities without creating a sandbox', async () => {
    const provider = new FakeProvider()
    const api = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })

    const response = await api.capabilities({ method: 'GET', headers: {} })

    expect(response).toEqual({ status: 200, body: enabledConfig })
    expect(provider.createCalls).toEqual([])
    expect(JSON.stringify(response)).not.toContain(SESSION_SECRET)
    expect(JSON.stringify(response)).not.toContain('owner-token')
  })

  it('rejects create when cloud runtimes are disabled', async () => {
    const provider = new FakeProvider()
    const api = new RuntimeApi({
      config: disabledConfig,
      credentials: undefined,
      provider,
      now: () => NOW,
    })

    const response = await api.createSession(request(
      { runtime: 'python' },
      { 'x-playground-access': 'anything' },
    ))

    expect(response.status).toBe(503)
    expect(errorCode(response)).toBe('CLOUD_DISABLED')
    expect(provider.createCalls).toEqual([])
  })

  it('rejects an incorrect access token before creating a sandbox', async () => {
    const provider = new FakeProvider()
    const api = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })

    const response = await api.createSession(request(
      { runtime: 'python' },
      { 'x-playground-access': 'incorrect' },
    ))

    expect(response.status).toBe(401)
    expect(errorCode(response)).toBe('ACCESS_DENIED')
    expect(provider.createCalls).toEqual([])
  })

  it.each([
    'python',
    'node',
  ] as const)('creates a sealed %s session through the provider', async (runtime) => {
    const { provider, created } = await createApi(runtime)

    expect(created.status).toBe(201)
    expect(created.headers?.['Set-Cookie']).toContain('HttpOnly')
    expect(created.headers?.['Set-Cookie']).not.toContain(provider.createCalls[0].name)
    expect(provider.createCalls[0]).toMatchObject({
      runtime,
      name: expect.stringMatching(/^pathwise-/),
      timeoutMs: DEFAULT_LIMITS.sandboxTimeoutMs,
    })
    expect(created.body).toEqual({ runtime })
  })

  it('rejects file traversal before resolving the provider', async () => {
    const { api, provider, cookie } = await createApi()
    provider.getCalls.length = 0

    const response = await api.syncFiles(request(
      { files: [{ path: '../secret.py', content: 'print(1)' }] },
      accessHeaders({ cookie }),
    ))

    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('PROJECT_LIMIT')
    expect(provider.getCalls).toEqual([])
  })

  it('rejects shell operators before resolving the provider', async () => {
    const { api, provider, cookie } = await createApi()
    provider.getCalls.length = 0

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py; whoami'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'request-1' }),
    ))

    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('COMMAND_REJECTED')
    expect(provider.getCalls).toEqual([])
  })

  it('passes only request-selected environment values and uses flock', async () => {
    const { api, cookie, handle } = await createApi('node')

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'node', args: ['index.js'] },
        environment: { USER_VALUE: 'selected', API_TOKEN: 'temporary-secret' },
        secretNames: ['API_TOKEN'],
      },
      accessHeaders({ cookie, 'idempotency-key': 'request-2' }),
    ))

    expect(response.status).toBe(200)
    expect(handle.runCalls).toEqual([{
      executable: 'flock',
      args: [
        '-n',
        '-E',
        '75',
        '/tmp/pathwise-command.lock',
        'node',
        'index.js',
      ],
      cwd: '/vercel/sandbox/workspace',
      env: { USER_VALUE: 'selected', API_TOKEN: 'temporary-secret' },
      timeoutMs: DEFAULT_LIMITS.commandTimeoutMs,
    }])
    expect(JSON.stringify(handle.runCalls)).not.toContain('owner-token')
  })

  it('redacts exact selected secret values and preserves output sequence order', async () => {
    const { api, cookie, handle } = await createApi()
    handle.runResult = {
      exitCode: 0,
      output: [
        { sequence: 2, stream: 'stdout', text: 'third temporary-secret' },
        { sequence: 0, stream: 'stdout', text: 'first temporary-secret-long' },
        { sequence: 1, stream: 'stderr', text: 'second temporary-secret' },
      ],
    }

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {
          API_TOKEN: 'temporary-secret',
          LONG_TOKEN: 'temporary-secret-long',
          ORDINARY: 'do-not-redact',
        },
        secretNames: ['API_TOKEN', 'LONG_TOKEN'],
      },
      accessHeaders({ cookie, 'idempotency-key': 'request-3' }),
    ))

    expect(response.body).toEqual({
      idempotencyKey: 'request-3',
      exitCode: 0,
      output: [
        { sequence: 0, stream: 'stdout', text: 'first [REDACTED]' },
        { sequence: 1, stream: 'stderr', text: 'second [REDACTED]' },
        { sequence: 2, stream: 'stdout', text: 'third [REDACTED]' },
      ],
    })
  })

  it('redacts a selected secret split across ordered output chunks', async () => {
    const { api, cookie, handle } = await createApi()
    handle.runResult = {
      exitCode: 0,
      output: [
        { sequence: 2, stream: 'stdout', text: 'cret suffix' },
        { sequence: 0, stream: 'stdout', text: 'prefix temporary-' },
        { sequence: 1, stream: 'stderr', text: 'se' },
      ],
    }

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: { API_TOKEN: 'temporary-secret' },
        secretNames: ['API_TOKEN'],
      },
      accessHeaders({ cookie, 'idempotency-key': 'split-secret' }),
    ))

    expect(JSON.stringify(response.body)).not.toContain('temporary-secret')
    expect(response.body).toEqual({
      idempotencyKey: 'split-secret',
      exitCode: 0,
      output: [
        { sequence: 0, stream: 'stdout', text: 'prefix [REDACTED]' },
        { sequence: 1, stream: 'stderr', text: '' },
        { sequence: 2, stream: 'stdout', text: ' suffix' },
      ],
    })
  })

  it('rejects selected secret values shorter than eight characters before provider calls', async () => {
    const { api, provider, cookie, handle } = await createApi()
    provider.getCalls.length = 0

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: { API_TOKEN: 'short-7' },
        secretNames: ['API_TOKEN'],
      },
      accessHeaders({ cookie, 'idempotency-key': 'short-secret' }),
    ))

    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('COMMAND_REJECTED')
    expect(response.headers?.['Idempotency-Key']).toBe('short-secret')
    expect(provider.getCalls).toEqual([])
    expect(handle.runCalls).toEqual([])
  })

  it('replays completed duplicate commands without executing twice', async () => {
    const { api, cookie, handle } = await createApi()
    handle.runResult = {
      exitCode: 0,
      output: [{ sequence: 0, stream: 'stdout', text: 'first result' }],
    }
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'duplicate-complete' }),
    )

    const first = await api.runCommand(command)
    handle.runResult = {
      exitCode: 0,
      output: [{ sequence: 0, stream: 'stdout', text: 'second result' }],
    }
    const second = await api.runCommand(command)

    expect(second).toEqual(first)
    expect(handle.runCalls).toHaveLength(1)
    expect(handle.idempotentRunCalls).toHaveLength(1)
  })

  it('shares one in-flight execution across concurrent duplicate commands', async () => {
    const { api, cookie, handle } = await createApi()
    let resolveRun!: (result: SandboxCommandResult) => void
    handle.runDeferred = new Promise((resolve) => {
      resolveRun = resolve
    })
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'duplicate-concurrent' }),
    )

    const first = api.runCommand(command)
    const second = api.runCommand(command)
    await vi.waitFor(() => expect(handle.idempotentRunCalls).toHaveLength(1))
    resolveRun({ exitCode: 0, output: [] })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ])
    expect(handle.idempotentRunCalls).toHaveLength(1)
  })

  it('executes commands with different idempotency keys separately', async () => {
    const { api, cookie, handle } = await createApi()
    const body = {
      command: { kind: 'execute', executable: 'python', args: ['main.py'] },
      environment: {},
      secretNames: [],
    }

    await api.runCommand(request(
      body,
      accessHeaders({ cookie, 'idempotency-key': 'different-a' }),
    ))
    await api.runCommand(request(
      body,
      accessHeaders({ cookie, 'idempotency-key': 'different-b' }),
    ))

    expect(handle.runCalls).toHaveLength(2)
    expect(handle.idempotentRunCalls.map((call) => call.idempotencyKey)).toEqual([
      'different-a',
      'different-b',
    ])
  })

  it('uses provider idempotency to replay across RuntimeApi cold instances', async () => {
    const { api, provider, cookie, handle } = await createApi()
    const coldApi = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'provider-replay' }),
    )

    await api.runCommand(command)
    await coldApi.runCommand(command)

    expect(handle.idempotentRunCalls).toHaveLength(2)
    expect(handle.runCalls).toHaveLength(1)
  })

  it('rejects cold same-key reuse with changed secret selection without leaking output', async () => {
    const { api, provider, cookie, handle } = await createApi()
    handle.runResult = {
      exitCode: 0,
      output: [{ sequence: 0, stream: 'stdout', text: 'temporary-secret' }],
    }
    const coldApi = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })

    await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: { API_TOKEN: 'temporary-secret' },
        secretNames: ['API_TOKEN'],
      },
      accessHeaders({ cookie, 'idempotency-key': 'changed-secret-selection' }),
    ))
    const changed = await coldApi.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: { API_TOKEN: 'temporary-secret' },
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'changed-secret-selection' }),
    ))

    expect(changed.status).toBe(409)
    expect(errorCode(changed)).toBe('IDEMPOTENCY_CONFLICT')
    expect(changed.headers?.['Idempotency-Key']).toBe('changed-secret-selection')
    expect(JSON.stringify(changed)).not.toContain('temporary-secret')
    expect(handle.executionStarts).toBe(1)
  })

  it('uses provider idempotency for concurrent duplicates across cold instances', async () => {
    const { api, provider, cookie, handle } = await createApi()
    const coldApi = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })
    let resolveRun!: (result: SandboxCommandResult) => void
    handle.runDeferred = new Promise((resolve) => {
      resolveRun = resolve
    })
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'provider-concurrent' }),
    )

    const first = api.runCommand(command)
    const second = coldApi.runCommand(command)
    await vi.waitFor(() => expect(handle.idempotentRunCalls).toHaveLength(2))
    expect(handle.executionStarts).toBe(1)
    resolveRun({ exitCode: 0, output: [] })

    await Promise.all([first, second])
    expect(handle.idempotentRunCalls).toHaveLength(2)
    expect(handle.executionStarts).toBe(1)
  })

  it('expires warm idempotency entries and delegates replay to the provider', async () => {
    let currentNow = NOW
    const { api, cookie, handle } = await createApi('python', () => currentNow)
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'expiring-entry' }),
    )

    await api.runCommand(command)
    currentNow += 5 * 60 * 1000
    await api.runCommand(command)

    expect(handle.idempotentRunCalls).toHaveLength(2)
    expect(handle.runCalls).toHaveLength(1)
  })

  it('bounds warm idempotency entries and delegates evicted replay to the provider', async () => {
    const { api, cookie, handle } = await createApi()
    const body = {
      command: { kind: 'execute', executable: 'python', args: ['main.py'] },
      environment: {},
      secretNames: [],
    }

    for (let index = 0; index <= 100; index += 1) {
      await api.runCommand(request(
        body,
        accessHeaders({ cookie, 'idempotency-key': `bounded-${index}` }),
      ))
    }
    await api.runCommand(request(
      body,
      accessHeaders({ cookie, 'idempotency-key': 'bounded-0' }),
    ))

    expect(handle.idempotentRunCalls).toHaveLength(102)
    expect(handle.runCalls).toHaveLength(101)
  })

  it('requires and echoes a non-empty Idempotency-Key', async () => {
    const { api, cookie, handle } = await createApi()

    const missing = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie }),
    ))

    expect(missing.status).toBe(400)
    expect(errorCode(missing)).toBe('COMMAND_REJECTED')
    expect(handle.runCalls).toEqual([])
  })

  it('maps flock exit code 75 to COMMAND_IN_PROGRESS', async () => {
    const { api, cookie, handle } = await createApi()
    handle.runResult = { exitCode: 75, output: [] }

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'request-4' }),
    ))

    expect(response.status).toBe(409)
    expect(errorCode(response)).toBe('COMMAND_IN_PROGRESS')
    expect(response.headers?.['Idempotency-Key']).toBe('request-4')
  })

  it('echoes a valid Idempotency-Key on output-limit errors', async () => {
    const { api, cookie, handle } = await createApi()
    handle.runResult = {
      exitCode: 0,
      output: [{
        sequence: 0,
        stream: 'stdout',
        text: 'x'.repeat(DEFAULT_LIMITS.maxOutputBytes + 1),
      }],
    }

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'echo-output-limit' }),
    ))

    expect(response.status).toBe(413)
    expect(response.headers?.['Idempotency-Key']).toBe('echo-output-limit')
  })

  it('echoes a valid Idempotency-Key on provider failures', async () => {
    const { api, provider, cookie } = await createApi()
    provider.getError = new Error('provider failure')

    const response = await api.runCommand(request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'echo-provider' }),
    ))

    expect(response.status).toBe(503)
    expect(response.headers?.['Idempotency-Key']).toBe('echo-provider')
  })

  it('evicts transient provider failures so a same-key retry can succeed', async () => {
    const { api, provider, cookie, handle } = await createApi()
    provider.getError = new Error('temporary provider failure')
    const command = request(
      {
        command: { kind: 'execute', executable: 'python', args: ['main.py'] },
        environment: {},
        secretNames: [],
      },
      accessHeaders({ cookie, 'idempotency-key': 'retry-provider-failure' }),
    )

    const failed = await api.runCommand(command)
    provider.getError = undefined
    const retried = await api.runCommand(command)

    expect(failed.status).toBe(503)
    expect(retried.status).toBe(200)
    expect(handle.executionStarts).toBe(1)
  })

  it.each([
    {
      name: 'access failure',
      prepare: async (api: RuntimeApi, cookie: string) => api.runCommand(request(
        {},
        { cookie, 'x-playground-access': 'wrong', 'idempotency-key': 'echo-access' },
      )),
      key: 'echo-access',
    },
    {
      name: 'session failure',
      prepare: async (api: RuntimeApi) => api.runCommand(request(
        {},
        accessHeaders({ 'idempotency-key': 'echo-session' }),
      )),
      key: 'echo-session',
    },
    {
      name: 'validation failure',
      prepare: async (api: RuntimeApi, cookie: string) => api.runCommand(request(
        {},
        accessHeaders({ cookie, 'idempotency-key': 'echo-validation' }),
      )),
      key: 'echo-validation',
    },
  ])('echoes a valid Idempotency-Key on $name', async ({ prepare, key }) => {
    const { api, cookie } = await createApi()

    const response = await prepare(api, cookie)

    expect(response.headers?.['Idempotency-Key']).toBe(key)
  })

  it('returns SESSION_EXPIRED for an expired sealed cookie', async () => {
    const provider = new FakeProvider()
    const api = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })
    const expired = await sealSession({
      name: 'pathwise-expired',
      runtime: 'python',
      expiresAt: NOW - 1,
    }, SESSION_SECRET)

    const response = await api.syncFiles(request(
      { files: [] },
      accessHeaders({ cookie: `pathwise_runtime=${expired}` }),
    ))

    expect(response.status).toBe(401)
    expect(errorCode(response)).toBe('SESSION_EXPIRED')
    expect(provider.getCalls).toEqual([])
  })

  it('stops idempotently and clears the session cookie', async () => {
    const { api, cookie, handle } = await createApi()

    const first = await api.stop(request(undefined, accessHeaders({ cookie })))
    const second = await api.stop(request(undefined, accessHeaders()))

    expect(first.status).toBe(204)
    expect(first.headers?.['Set-Cookie']).toContain('Max-Age=0')
    expect(second.status).toBe(204)
    expect(second.headers?.['Set-Cookie']).toContain('Max-Age=0')
    expect(handle.stopCalls).toBe(1)
  })

  it.each(['expired', 'invalid'] as const)(
    'stops an %s session idempotently and clears the cookie',
    async (kind) => {
      const { api } = await createApi()
      const token = kind === 'expired'
        ? await sealSession({
            name: 'pathwise-expired-stop',
            runtime: 'python',
            expiresAt: NOW - 1,
          }, SESSION_SECRET)
        : 'invalid-cookie'

      const response = await api.stop(request(
        undefined,
        accessHeaders({ cookie: `pathwise_runtime=${token}` }),
      ))

      expect(response.status).toBe(204)
      expect(response.headers?.['Set-Cookie']).toContain('Max-Age=0')
    },
  )

  it('replays stop with the original sealed cookie after the provider is missing', async () => {
    const { api, provider, cookie, handle } = await createApi()

    const first = await api.stop(request(undefined, accessHeaders({ cookie })))
    provider.handles.delete(handle.name)
    const second = await api.stop(request(undefined, accessHeaders({ cookie })))

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
    expect(second.headers?.['Set-Cookie']).toContain('Max-Age=0')
  })

  it('uses the provider idempotent stop operation for concurrent requests', async () => {
    const { api, cookie, handle } = await createApi()

    const [first, second] = await Promise.all([
      api.stop(request(undefined, accessHeaders({ cookie }))),
      api.stop(request(undefined, accessHeaders({ cookie }))),
    ])

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
    expect(handle.stopIdempotentCalls).toBe(2)
  })

  it('keeps operational stop failures distinguishable and clears the cookie', async () => {
    const { api, provider, cookie } = await createApi()
    provider.getError = new Error('provider network failure')

    const response = await api.stop(request(undefined, accessHeaders({ cookie })))

    expect(response.status).toBe(503)
    expect(errorCode(response)).toBe('SANDBOX_UNAVAILABLE')
    expect(response.headers?.['Set-Cookie']).toContain('Max-Age=0')
  })

  it('destroys idempotently and clears the session cookie', async () => {
    const { api, cookie, handle } = await createApi()

    const first = await api.destroySession(request(undefined, accessHeaders({ cookie })))
    const second = await api.destroySession(request(undefined, accessHeaders()))

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
    expect(handle.stopCalls).toBe(1)
  })

  it('normalizes provider failures without exposing details or stack traces', async () => {
    const provider = new FakeProvider()
    provider.createError = new Error('provider secret detail')
    const api = new RuntimeApi({
      config: enabledConfig,
      credentials,
      provider,
      now: () => NOW,
    })

    const response = await api.createSession(request(
      { runtime: 'python' },
      accessHeaders(),
    ))

    expect(response.status).toBe(503)
    expect(errorCode(response)).toBe('SANDBOX_UNAVAILABLE')
    expect(JSON.stringify(response)).not.toContain('provider secret detail')
    expect(JSON.stringify(response)).not.toContain('stack')
  })
})

describe('Node HTTP adapters', () => {
  it('reads JSON bodies up to one megabyte and rejects larger bodies', async () => {
    const small = new EventEmitter() as IncomingMessage
    const parsed = readJsonBody(small)
    small.emit('data', Buffer.from('{"ok":true}'))
    small.emit('end')
    await expect(parsed).resolves.toEqual({ ok: true })

    const large = new EventEmitter() as IncomingMessage
    const rejected = readJsonBody(large)
    large.emit('data', Buffer.alloc(1_000_001))
    await expect(rejected).rejects.toThrow('Request body is too large')
  })

  it('normalizes headers, writes JSON, forwards cookies, and returns 405', async () => {
    const runtimeHandler = vi.fn(async (runtimeRequest: RuntimeRequest) => {
      expect(runtimeRequest.headers).toEqual({
        'x-test': 'value',
        cookie: 'session',
      })
      return {
        status: 201,
        headers: { 'Set-Cookie': 'sealed-cookie' },
        body: { ok: true },
      }
    })
    const handler = nodeHandler(runtimeHandler, ['POST'])
    const responseState = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
    }
    const response = {
      set statusCode(value: number) {
        responseState.status = value
      },
      setHeader(name: string, value: string) {
        responseState.headers[name] = value
      },
      end(value = '') {
        responseState.body = value
      },
    } as unknown as ServerResponse
    const unsupported = Object.assign(new EventEmitter(), {
      method: 'GET',
      headers: { 'X-Test': 'value' },
    }) as unknown as IncomingMessage

    await handler(unsupported, response)
    expect(responseState.status).toBe(405)
    expect(runtimeHandler).not.toHaveBeenCalled()
    responseState.headers = {}

    const supported = Object.assign(new EventEmitter(), {
      method: 'POST',
      headers: { 'X-Test': 'value', Cookie: 'session' },
    }) as unknown as IncomingMessage
    const handled = handler(supported, response)
    supported.emit('data', Buffer.from('{}'))
    supported.emit('end')
    await handled

    expect(responseState).toEqual({
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sealed-cookie',
      },
      body: '{"ok":true}',
    })
  })

  it('does not expose thrown error details or stack traces', async () => {
    const handler = nodeHandler(async () => {
      throw new Error('private failure')
    }, ['GET'])
    const state = { status: 0, body: '' }
    const request = Object.assign(new EventEmitter(), {
      method: 'GET',
      headers: {},
    }) as unknown as IncomingMessage
    const response = {
      set statusCode(value: number) {
        state.status = value
      },
      setHeader() {},
      end(value = '') {
        state.body = value
      },
    } as unknown as ServerResponse

    await handler(request, response)

    expect(state.status).toBe(500)
    expect(state.body).not.toContain('private failure')
    expect(state.body).not.toContain('stack')
  })
})
