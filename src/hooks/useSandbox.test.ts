import { describe, expect, it, vi } from 'vitest'
import {
  SandboxController,
  initialSandboxSnapshot,
  sandboxReducer,
  type SandboxCredentials,
  type SandboxSnapshot,
} from './useSandbox'
import {
  RuntimeClientError,
  type CommandResult,
  type SandboxClient,
} from '../lib/sandbox/client'
import {
  DEFAULT_LIMITS,
  type ExecuteCommand,
  type ProjectFile,
  type RuntimeCapabilities,
} from '../lib/sandbox/protocol'

const enabledCapabilities: RuntimeCapabilities = {
  enabled: true,
  runtimes: ['python', 'node'],
  allowByok: true,
  limits: DEFAULT_LIMITS,
}

const disabledCapabilities: RuntimeCapabilities = {
  enabled: false,
  reason: 'Cloud execution is disabled.',
  runtimes: [],
  allowByok: false,
  limits: DEFAULT_LIMITS,
}

const command: ExecuteCommand = {
  kind: 'execute',
  executable: 'python',
  args: ['main.py'],
}

const files: ProjectFile[] = [
  { path: 'main.py', content: 'print("hello")' },
]

const credentials: SandboxCredentials = {
  accessToken: 'owner-token',
  environment: { OPENAI_API_KEY: 'environment-secret' },
  secretNames: ['OPENAI_API_KEY'],
}

type SandboxClientMock = SandboxClient & {
  create: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function result(output: CommandResult['output'] = []): CommandResult {
  return { idempotencyKey: 'request-key', exitCode: 0, output }
}

function clientMock(
  overrides: Partial<SandboxClient> = {},
): SandboxClientMock {
  return {
    capabilities: vi.fn().mockResolvedValue(enabledCapabilities),
    create: vi.fn().mockResolvedValue(undefined),
    syncFiles: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(result()),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SandboxClientMock
}

function setup(
  client = clientMock(),
  onSecretsCleared = vi.fn(),
) {
  let snapshot: SandboxSnapshot = initialSandboxSnapshot
  const dispatch = (action: Parameters<typeof sandboxReducer>[1]) => {
    snapshot = sandboxReducer(snapshot, action)
  }
  const controller = new SandboxController(
    client,
    'python',
    credentials,
    dispatch,
    onSecretsCleared,
  )
  return {
    client,
    controller,
    onSecretsCleared,
    snapshot: () => snapshot,
  }
}

describe('SandboxController', () => {
  it('loads capabilities from an initial loading state', async () => {
    let resolveCapabilities!: (value: RuntimeCapabilities) => void
    const pending = new Promise<RuntimeCapabilities>((resolve) => {
      resolveCapabilities = resolve
    })
    const client = clientMock({
      capabilities: vi.fn().mockReturnValue(pending),
    })
    const { controller, snapshot } = setup(client)

    const loading = controller.loadCapabilities()
    expect(snapshot()).toMatchObject({
      state: 'loading',
      capabilities: undefined,
    })

    resolveCapabilities(enabledCapabilities)
    await loading
    expect(snapshot()).toMatchObject({
      state: 'idle',
      capabilities: enabledCapabilities,
    })
  })

  it('enters disabled state when cloud capabilities are disabled', async () => {
    const client = clientMock({
      capabilities: vi.fn().mockResolvedValue(disabledCapabilities),
    })
    const { controller, snapshot } = setup(client)

    await controller.loadCapabilities()

    expect(snapshot()).toMatchObject({
      state: 'disabled',
      capabilities: disabledCapabilities,
    })
  })

  it('preserves resolved capability state when the mount effect is replayed', async () => {
    const { controller, snapshot } = setup()

    await controller.loadCapabilities()
    await controller.loadCapabilities()

    expect(snapshot()).toMatchObject({
      state: 'idle',
      capabilities: enabledCapabilities,
    })
  })

  it('creates a session lazily on the first command', async () => {
    const { client, controller, snapshot } = setup()

    await controller.runCommand(command)

    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenCalledWith('python', 'owner-token')
    expect(client.run).toHaveBeenCalledWith(
      command,
      { OPENAI_API_KEY: 'environment-secret' },
      ['OPENAI_API_KEY'],
      'owner-token',
      expect.any(AbortSignal),
    )
    expect(snapshot().state).toBe('ready')
  })

  it('deduplicates session creation across concurrent first actions', async () => {
    let resolveCreate!: () => void
    const create = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      resolveCreate = resolve
    }))
    const client = clientMock({ create })
    const { controller } = setup(client)

    const syncing = controller.runFiles(files)
    const running = controller.runCommand(command)
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    resolveCreate()
    await Promise.all([syncing, running])

    expect(create).toHaveBeenCalledTimes(1)
    expect(client.syncFiles).toHaveBeenCalledTimes(1)
    expect(client.run).toHaveBeenCalledTimes(1)
  })

  it('waits for capabilities before creating a session', async () => {
    let resolveCapabilities!: (value: RuntimeCapabilities) => void
    const capabilities = vi.fn().mockReturnValue(
      new Promise<RuntimeCapabilities>((resolve) => {
        resolveCapabilities = resolve
      }),
    )
    const client = clientMock({ capabilities })
    const { controller } = setup(client)

    const running = controller.runCommand(command)
    await Promise.resolve()
    expect(client.create).not.toHaveBeenCalled()

    resolveCapabilities(enabledCapabilities)
    await running
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it('synchronizes files and appends command output in sequence order', async () => {
    const client = clientMock({
      run: vi.fn().mockResolvedValue(result([
        { sequence: 2, stream: 'stderr', text: 'third' },
        { sequence: 0, stream: 'stdout', text: 'first' },
        { sequence: 1, stream: 'stdout', text: 'second' },
      ])),
    })
    const { controller, snapshot } = setup(client)

    await controller.runFiles(files)
    await controller.runCommand(command)

    expect(client.syncFiles).toHaveBeenCalledWith(files, 'owner-token')
    expect(snapshot().output.map((chunk) => chunk.text)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('aborts an active request before asking the server to stop', async () => {
    const calls: string[] = []
    const run = vi.fn((
      _command,
      _environment,
      _secretNames,
      _accessToken,
      signal: AbortSignal,
    ) => new Promise<CommandResult>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        calls.push('abort')
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    }))
    const stop = vi.fn().mockImplementation(async () => {
      calls.push('stop')
    })
    const client = clientMock({ run, stop })
    const { controller, snapshot } = setup(client)
    const pending = controller.runCommand(command)
    await vi.waitFor(() => expect(run).toHaveBeenCalled())

    await controller.stop()
    await pending

    expect(calls).toEqual(['abort', 'stop'])
    expect(snapshot().state).toBe('idle')
  })

  it('ignores command output that resolves after Stop invalidates it', async () => {
    let resolveRun!: (value: CommandResult) => void
    const run = vi.fn().mockReturnValue(new Promise<CommandResult>((resolve) => {
      resolveRun = resolve
    }))
    const client = clientMock({ run })
    const { controller, snapshot } = setup(client)
    const pending = controller.runCommand(command)
    await vi.waitFor(() => expect(run).toHaveBeenCalled())

    await controller.stop()
    resolveRun(result([
      { sequence: 0, stream: 'stdout', text: 'stale' },
    ]))
    await pending

    expect(snapshot().state).toBe('idle')
    expect(snapshot().output).toEqual([])
  })

  it('does not recover an expired file sync after Stop invalidates it', async () => {
    let rejectSync!: (error: unknown) => void
    const syncFiles = vi.fn().mockReturnValue(new Promise<void>((_resolve, reject) => {
      rejectSync = reject
    }))
    const client = clientMock({ syncFiles })
    const { controller, snapshot } = setup(client)
    const syncing = controller.runFiles(files)
    await vi.waitFor(() => expect(syncFiles).toHaveBeenCalled())

    await controller.stop()
    rejectSync(new RuntimeClientError(
      'SESSION_EXPIRED',
      'The cloud session has expired.',
      401,
    ))
    await syncing

    expect(client.create).toHaveBeenCalledTimes(1)
    expect(snapshot().state).toBe('idle')
  })

  it('recreates an expired session once, resyncs files, and retries the command', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new RuntimeClientError(
        'SESSION_EXPIRED',
        'The cloud session has expired.',
        401,
      ))
      .mockResolvedValueOnce(result())
    const client = clientMock({ run })
    const { controller, snapshot } = setup(client)

    await controller.runFiles(files)
    await controller.runCommand(command)

    expect(client.create).toHaveBeenCalledTimes(2)
    expect(client.syncFiles).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(2)
    expect(snapshot().state).toBe('ready')
  })

  it('does not attempt a second recreation when the recovery retry expires', async () => {
    const expired = new RuntimeClientError(
      'SESSION_EXPIRED',
      'The cloud session has expired.',
      401,
    )
    const client = clientMock({
      run: vi.fn().mockRejectedValue(expired),
    })
    const { controller, snapshot } = setup(client)

    await controller.runCommand(command)

    expect(client.create).toHaveBeenCalledTimes(2)
    expect(client.run).toHaveBeenCalledTimes(2)
    expect(snapshot()).toMatchObject({
      state: 'error',
      error: 'The cloud session has expired.',
    })
  })

  it('destroys an active old runtime before switching runtimes', async () => {
    const client = clientMock()
    const { controller } = setup(client)
    await controller.runCommand(command)

    await controller.updateConfiguration('node', {
      accessToken: 'new-owner-token',
      environment: {},
      secretNames: [],
    })
    await controller.runCommand({
      kind: 'execute',
      executable: 'node',
      args: ['main.js'],
    })

    expect(client.destroy).toHaveBeenCalledWith('owner-token')
    expect(client.destroy.mock.invocationCallOrder[0])
      .toBeLessThan(client.create.mock.invocationCallOrder[1])
    expect(client.create).toHaveBeenLastCalledWith('node', 'new-owner-token')
  })

  it('destroys the old runtime on change even before this controller creates one', async () => {
    const client = clientMock()
    const { controller } = setup(client)

    await controller.updateConfiguration('node', {
      accessToken: 'new-owner-token',
      environment: {},
      secretNames: [],
    })

    expect(client.destroy).toHaveBeenCalledWith('owner-token')
  })

  it('waits for runtime destruction before an action creates the new runtime', async () => {
    let resolveDestroy!: () => void
    const destroy = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      resolveDestroy = resolve
    }))
    const client = clientMock({ destroy })
    const { controller } = setup(client)

    const changing = controller.updateConfiguration('node', {
      accessToken: 'new-owner-token',
      environment: {},
      secretNames: [],
    })
    const running = controller.runCommand({
      kind: 'execute',
      executable: 'node',
      args: ['main.js'],
    })
    await Promise.resolve()
    expect(client.create).not.toHaveBeenCalled()

    resolveDestroy()
    await Promise.all([changing, running])
    expect(client.create).toHaveBeenCalledWith('node', 'new-owner-token')
  })

  it('clears sensitive values on explicit destroy', async () => {
    const client = clientMock()
    const { controller, onSecretsCleared } = setup(client)
    await controller.runCommand(command)

    await controller.destroy()
    await controller.runCommand(command)

    expect(client.destroy).toHaveBeenCalledWith('owner-token')
    expect(onSecretsCleared).toHaveBeenCalledTimes(1)
    expect(client.create).toHaveBeenLastCalledWith('python', '')
    expect(client.run).toHaveBeenLastCalledWith(
      command,
      {},
      [],
      '',
      expect.any(AbortSignal),
    )
  })

  it('destroys the session and clears sensitive values on unmount disposal', async () => {
    const client = clientMock()
    const { controller, onSecretsCleared } = setup(client)
    await controller.runCommand(command)

    await controller.dispose()

    expect(client.destroy).toHaveBeenCalledWith('owner-token')
    expect(onSecretsCleared).toHaveBeenCalledTimes(1)
  })

  it('does not externally clear secrets during a Strict Mode cleanup/setup cycle', async () => {
    const { controller, onSecretsCleared } = setup()

    const cleanup = controller.dispose()
    controller.activate()
    await cleanup

    expect(onSecretsCleared).not.toHaveBeenCalled()
  })

  it('destroys a session that finishes creating after unmount disposal', async () => {
    let resolveCreate!: () => void
    const create = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      resolveCreate = resolve
    }))
    const client = clientMock({ create })
    const { controller } = setup(client)
    const running = controller.runCommand(command)
    await vi.waitFor(() => expect(create).toHaveBeenCalled())

    const disposing = controller.dispose()
    resolveCreate()
    await Promise.all([disposing, running])

    expect(client.destroy).toHaveBeenCalledWith('owner-token')
    expect(client.run).not.toHaveBeenCalled()
  })
})
