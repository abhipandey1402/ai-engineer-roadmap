import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SandboxIdempotencyConflictError,
  SandboxNotFoundError,
  type SandboxCommand,
} from './provider'
import { DEFAULT_LIMITS } from '../../src/lib/sandbox/protocol'
import {
  VercelSandboxProvider,
  type VercelSandboxFacade,
  type VercelSandboxSdkFacade,
} from './vercelProvider'

const WORKSPACE = '/vercel/sandbox/workspace'
const temporaryDirectories: string[] = []

interface RunCommandOptions {
  cmd: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stdout?: Writable
  stderr?: Writable
  timeoutMs?: number
}

class LocalSandbox implements VercelSandboxFacade {
  readonly mkdirCalls: string[] = []
  readonly writeCalls: Array<Array<{ path: string; content: Buffer }>> = []
  readonly runCalls: RunCommandOptions[] = []
  stopCalls = 0
  stopError: unknown
  helperSourceTransform?: (source: string) => string
  private readonly flockTails = new Map<string, Promise<void>>()

  constructor(
    readonly name: string,
    readonly runtime: string = 'node24',
  ) {}

  async mkDir(path: string): Promise<void> {
    this.mkdirCalls.push(path)
  }

  async writeFiles(
    files: Array<{ path: string; content: Buffer }>,
  ): Promise<void> {
    this.writeCalls.push(files)
  }

  async runCommand(options: RunCommandOptions): Promise<{ exitCode: number }> {
    // Directory preparation (`mkdir -p ...`) is best-effort setup, not a helper
    // invocation; treat it as a successful no-op so assertions target the helper.
    if (options.cmd === 'mkdir') return { exitCode: 0 }
    this.runCalls.push(options)
    if (options.cmd !== '/usr/bin/flock') return this.spawn(options)

    const args = options.args ?? []
    const lockPath = args[1]
    if (args[0] !== '-x' || !lockPath || !args[2]) {
      throw new Error('Invalid flock invocation')
    }
    if (this.helperSourceTransform && args[3] === '-e' && args[4]) {
      args[4] = this.helperSourceTransform(args[4])
    }
    const prior = this.flockTails.get(lockPath) ?? Promise.resolve()
    let release = () => {}
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = prior.then(() => tail)
    this.flockTails.set(lockPath, queued)
    await prior
    try {
      return await this.spawn({
        ...options,
        cmd: args[2],
        args: args.slice(3),
      })
    } finally {
      release()
      if (this.flockTails.get(lockPath) === queued) {
        this.flockTails.delete(lockPath)
      }
    }
  }

  private async spawn(
    options: RunCommandOptions,
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(options.cmd, options.args ?? [], {
        cwd: options.cwd === WORKSPACE ? undefined : options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.pipe(options.stdout ?? process.stdout)
      child.stderr.pipe(options.stderr ?? process.stderr)
      const timer = options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (timer) clearTimeout(timer)
        if (signal) {
          reject(new Error(`helper terminated by ${signal}`))
          return
        }
        resolve({ exitCode: code ?? 1 })
      })
    })
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
    if (this.stopError) throw this.stopError
  }
}

function createSdk(sandbox = new LocalSandbox('existing')): {
  sdk: VercelSandboxSdkFacade
  sandbox: LocalSandbox
  create: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(async (options: { name: string }) => (
    new LocalSandbox(options.name)
  ))
  const get = vi.fn(async () => sandbox)
  return { sdk: { create, get }, sandbox, create, get }
}

async function makeStateRoot(): Promise<string> {
  const root = join(
    tmpdir(),
    `pathwise-vercel-provider-${process.pid}-${temporaryDirectories.length}`,
  )
  temporaryDirectories.push(root)
  await mkdir(root, { recursive: true })
  return root
}

function command(
  script: string,
  cwd: string,
  timeoutMs = 2_000,
): SandboxCommand {
  return {
    executable: process.execPath,
    args: ['-e', script],
    cwd,
    env: { PATHWISE_TEST_VALUE: 'forwarded' },
    timeoutMs,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => (
      rm(directory, { recursive: true, force: true })
    )),
  )
})

describe('VercelSandboxProvider', () => {
  it.each([
    ['python', 'python3.13'],
    ['node', 'node24'],
  ] as const)('maps %s creation to the Vercel runtime', async (runtime, mapped) => {
    const { sdk, create } = createSdk()
    const provider = new VercelSandboxProvider(sdk)

    const handle = await provider.create(runtime, 'pathwise-new', 300_000)

    expect(handle.name).toBe('pathwise-new')
    expect(create).toHaveBeenCalledWith({
      name: 'pathwise-new',
      runtime: mapped,
      timeout: 300_000,
      networkPolicy: 'allow-all',
    })
  })

  it('reconnects by name and normalizes provider absence', async () => {
    const { sdk, get } = createSdk()
    const provider = new VercelSandboxProvider(sdk)

    await expect(provider.get('pathwise-existing')).resolves.toMatchObject({
      name: 'existing',
    })
    expect(get).toHaveBeenCalledWith({ name: 'pathwise-existing' })

    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(provider.get('missing')).rejects.toBeInstanceOf(
      SandboxNotFoundError,
    )
  })

  it('passes official static credentials to every SDK create and get call', async () => {
    const { sdk, create, get } = createSdk()
    const credentials = {
      token: 'vercel-token',
      teamId: 'team-id',
      projectId: 'project-id',
    }
    const provider = new VercelSandboxProvider(sdk, { credentials })

    await provider.create('node', 'pathwise-new', 300_000)
    await provider.get('pathwise-existing')

    expect(create).toHaveBeenCalledWith({
      name: 'pathwise-new',
      runtime: 'node24',
      timeout: 300_000,
      networkPolicy: 'allow-all',
      ...credentials,
    })
    expect(get).toHaveBeenCalledWith({
      name: 'pathwise-existing',
      ...credentials,
    })
  })

  it('creates the workspace and writes project contents as buffers', async () => {
    const { sdk, sandbox } = createSdk()
    const handle = await new VercelSandboxProvider(sdk).get('existing')

    await handle.writeFiles([
      { path: 'src/main.py', content: 'print("hello")' },
      { path: 'README.md', content: '# Demo' },
    ])

    expect(sandbox.mkdirCalls).toEqual([WORKSPACE])
    expect(sandbox.writeCalls).toHaveLength(1)
    expect(sandbox.writeCalls[0]).toEqual([
      {
        path: `${WORKSPACE}/src/main.py`,
        content: Buffer.from('print("hello")'),
      },
      {
        path: `${WORKSPACE}/README.md`,
        content: Buffer.from('# Demo'),
      },
    ])
  })

  it('forwards command fields as encoded data and collects both output streams', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk, sandbox } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const testCommand = command(
      [
        'process.stdout.write(process.env.PATHWISE_TEST_VALUE);',
        'setTimeout(() => process.stderr.write(" error"), 20);',
      ].join(''),
      stateRoot,
    )

    const result = await handle.runIdempotent(testCommand, {
      key: 'encoded-fields',
      requestFingerprint: 'fingerprint-1',
    })

    expect(result.exitCode).toBe(0)
    expect(result.output.map(({ stream, text }) => ({ stream, text }))).toEqual([
      { stream: 'stdout', text: 'forwarded' },
      { stream: 'stderr', text: ' error' },
    ])
    expect(result.output.map((chunk) => chunk.sequence)).toEqual([0, 1])
    expect(sandbox.runCalls).toHaveLength(1)
    expect(sandbox.runCalls[0].cmd).toBe('/usr/bin/flock')
    expect(sandbox.runCalls[0].args?.slice(0, 3)).toEqual([
      '-x',
      expect.stringMatching(/[a-f0-9]{64}\.lock$/),
      'node',
    ])
    expect(sandbox.runCalls[0].cwd).toBe(WORKSPACE)
    expect(sandbox.runCalls[0].env).toEqual({})
    expect(sandbox.runCalls[0].timeoutMs).toBeGreaterThan(testCommand.timeoutMs)

    const encodedPayload = sandbox.runCalls[0].args?.at(-1)
    expect(encodedPayload).toBeDefined()
    const payload = JSON.parse(
      Buffer.from(encodedPayload!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    expect(payload).toMatchObject({
      executable: testCommand.executable,
      args: testCommand.args,
      cwd: testCommand.cwd,
      env: testCommand.env,
      timeoutMs: testCommand.timeoutMs,
      fingerprint: 'fingerprint-1',
    })
    expect(JSON.stringify(sandbox.runCalls[0].args?.slice(0, -1))).not.toContain(
      'PATHWISE_TEST_VALUE',
    )
  })

  it('uses the fixed Python helper for a Python sandbox', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk, sandbox } = createSdk(
      new LocalSandbox('python-existing', 'python3.13'),
    )
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get(
      'python-existing',
    )

    const result = await handle.runIdempotent(
      command('process.stdout.write("python-helper")', stateRoot),
      { key: 'python-helper', requestFingerprint: 'same' },
    )

    expect(result.output.map((chunk) => chunk.text).join('')).toBe('python-helper')
    expect(sandbox.runCalls[0].cmd).toBe('/usr/bin/flock')
    expect(sandbox.runCalls[0].args?.[2]).toBe('python3')
  })

  it('replays a completed result across provider instances without rerunning', async () => {
    const stateRoot = await makeStateRoot()
    const counter = join(stateRoot, 'counter.txt')
    const { sdk, sandbox } = createSdk()
    const first = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const second = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const testCommand = command(
      `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x');`
        + 'process.stdout.write("once")',
      stateRoot,
    )
    const idempotency = { key: 'durable-result', requestFingerprint: 'same' }

    const firstResult = await first.runIdempotent(testCommand, idempotency)
    const replayed = await second.runIdempotent(testCommand, idempotency)

    expect(replayed).toEqual(firstResult)
    expect(await readFile(counter, 'utf8')).toBe('x')
    expect(sandbox.runCalls).toHaveLength(2)
    const digest = createHash('sha256')
      .update(idempotency.key, 'utf8')
      .digest('hex')
    const started = JSON.parse(
      await readFile(join(stateRoot, digest, 'started.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(started).toMatchObject({
      version: 1,
      phase: 'started',
      fingerprint: 'same',
      childPid: expect.any(Number),
    })
  })

  it('waits for and replays an in-flight execution', async () => {
    const stateRoot = await makeStateRoot()
    const counter = join(stateRoot, 'counter.txt')
    const { sdk } = createSdk()
    const first = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const second = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const testCommand = command(
      `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x');`
        + 'setTimeout(() => process.stdout.write("done"), 150)',
      stateRoot,
    )
    const idempotency = { key: 'in-flight', requestFingerprint: 'same' }

    const [left, right] = await Promise.all([
      first.runIdempotent(testCommand, idempotency),
      second.runIdempotent(testCommand, idempotency),
    ])

    expect(right).toEqual(left)
    expect(await readFile(counter, 'utf8')).toBe('x')
  })

  it('rejects reuse with a different fingerprint before replay', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const testCommand = command('process.stdout.write("done")', stateRoot)

    await handle.runIdempotent(testCommand, {
      key: 'conflict',
      requestFingerprint: 'first',
    })

    await expect(handle.runIdempotent(testCommand, {
      key: 'conflict',
      requestFingerprint: 'second',
    })).rejects.toBeInstanceOf(SandboxIdempotencyConflictError)
  })

  it('removes a rejected claim so a same-fingerprint retry can execute', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const idempotency = { key: 'rejected', requestFingerprint: 'same' }

    await expect(handle.runIdempotent({
      ...command('', stateRoot),
      executable: join(stateRoot, 'missing-executable'),
      args: [],
    }, idempotency)).rejects.toThrow()

    await expect(handle.runIdempotent(
      command('process.stdout.write("retried")', stateRoot),
      idempotency,
    )).resolves.toMatchObject({ exitCode: 0 })
  })

  it('serializes multiple stale waiters so only one retry executes', async () => {
    const stateRoot = await makeStateRoot()
    const key = 'crashed-owner'
    const digest = createHash('sha256').update(key, 'utf8').digest('hex')
    const claim = join(stateRoot, digest)
    await mkdir(claim)
    await writeFile(join(claim, 'claim.json'), JSON.stringify({
      version: 1,
      fingerprint: 'same',
      phase: 'claimed',
      ownerPid: 2_147_483_647,
    }))
    const { sdk } = createSdk()
    const handles = await Promise.all(Array.from({ length: 4 }, () => (
      new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    )))
    const counter = join(stateRoot, 'stale-counter.txt')
    const testCommand = command(
      `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x');`
        + 'setTimeout(() => process.stdout.write("recovered"), 50)',
      stateRoot,
    )

    const results = await Promise.all(handles.map((handle) => (
      handle.runIdempotent(testCommand, { key, requestFingerprint: 'same' })
    )))

    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1)
    expect(await readFile(counter, 'utf8')).toBe('x')
  })

  it.each([
    ['alive', process.pid],
    ['orphaned', 2_147_483_647],
  ])('never reruns a %s started execution without a valid result', async (
    _description,
    childPid,
  ) => {
    const stateRoot = await makeStateRoot()
    const key = `started-${childPid}`
    const digest = createHash('sha256').update(key, 'utf8').digest('hex')
    const recordPath = join(stateRoot, digest)
    await mkdir(recordPath)
    await writeFile(join(recordPath, 'claim.json'), JSON.stringify({
      version: 1,
      fingerprint: 'same',
      phase: 'claimed',
      ownerPid: 2_147_483_647,
    }))
    await writeFile(join(recordPath, 'started.json'), JSON.stringify({
      version: 1,
      fingerprint: 'same',
      phase: 'started',
      childPid,
    }))
    const counter = join(stateRoot, 'must-not-run.txt')
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')

    await expect(handle.runIdempotent(
      command(
        `require('node:fs').writeFileSync(${JSON.stringify(counter)}, 'ran')`,
        stateRoot,
      ),
      { key, requestFingerprint: 'same' },
    )).rejects.toMatchObject({ name: 'SandboxIndeterminateExecutionError' })
    await expect(stat(counter)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves started evidence when gate creation fails and never retries', async () => {
    const stateRoot = await makeStateRoot()
    const key = 'gate-write-fault'
    const digest = createHash('sha256').update(key, 'utf8').digest('hex')
    const recordPath = join(stateRoot, digest)
    const counter = join(stateRoot, 'gate-write-counter.txt')
    const { sdk, sandbox } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const testCommand = command(
      `require('node:fs').writeFileSync(${JSON.stringify(counter)}, 'ran')`,
      stateRoot,
    )
    sandbox.helperSourceTransform = (source) => source.replace(
      "await fs.writeFile(gatePath, '', { flag: 'wx' });",
      "throw new Error('injected gate write failure');",
    )

    await expect(handle.runIdempotent(
      testCommand,
      { key, requestFingerprint: 'same' },
    )).rejects.toMatchObject({ name: 'SandboxIndeterminateExecutionError' })

    const started = JSON.parse(
      await readFile(join(recordPath, 'started.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(started).toMatchObject({
      version: 1,
      phase: 'started',
      fingerprint: 'same',
      childPid: expect.any(Number),
    })
    sandbox.helperSourceTransform = undefined

    await expect(handle.runIdempotent(
      testCommand,
      { key, requestFingerprint: 'same' },
    )).rejects.toMatchObject({ name: 'SandboxIndeterminateExecutionError' })
    await expect(stat(counter)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not expose server-only environment values to the child', async () => {
    const stateRoot = await makeStateRoot()
    const serverSecret = `server-only-${Date.now()}`
    process.env.PATHWISE_SERVER_ONLY = serverSecret
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')

    try {
      const result = await handle.runIdempotent(command(
        'process.stdout.write(JSON.stringify({'
          + 'server:process.env.PATHWISE_SERVER_ONLY,'
          + 'allowed:process.env.PATHWISE_TEST_VALUE,'
          + 'path:typeof process.env.PATH'
          + '}))',
        stateRoot,
      ), { key: 'isolated-env', requestFingerprint: 'same' })
      const childEnvironment = JSON.parse(
        result.output.map((chunk) => chunk.text).join(''),
      ) as Record<string, unknown>

      expect(childEnvironment).toEqual({
        allowed: 'forwarded',
        path: 'string',
      })
    } finally {
      delete process.env.PATHWISE_SERVER_ONLY
    }
  })

  it('kills noisy commands and persists output within the application cap', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk } = createSdk()
    const first = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const second = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const idempotency = { key: 'noisy', requestFingerprint: 'same' }

    const result = await first.runIdempotent(
      command(`process.stdout.write('x'.repeat(${DEFAULT_LIMITS.maxOutputBytes * 2}))`, stateRoot),
      idempotency,
    )
    const replayed = await second.runIdempotent(command('', stateRoot), idempotency)
    const outputBytes = result.output.reduce(
      (total, chunk) => total + Buffer.byteLength(chunk.text, 'utf8'),
      0,
    )

    expect(outputBytes).toBeLessThanOrEqual(DEFAULT_LIMITS.maxOutputBytes)
    expect(result.exitCode).not.toBe(0)
    expect(replayed).toEqual(result)
  })

  it('clears malformed pre-start state and retries safely', async () => {
    const stateRoot = await makeStateRoot()
    const key = 'malformed-pre-start'
    const digest = createHash('sha256').update(key, 'utf8').digest('hex')
    const recordPath = join(stateRoot, digest)
    await mkdir(recordPath)
    await writeFile(join(recordPath, 'claim.json'), '{bad-json')
    await writeFile(join(recordPath, 'result.json'), '{also-bad')
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')

    const result = await handle.runIdempotent(
      command('process.stdout.write("retried")', stateRoot),
      { key, requestFingerprint: 'same' },
    )

    expect(result.output.map((chunk) => chunk.text).join('')).toBe('retried')
  })

  it('treats malformed results after started as indeterminate', async () => {
    const stateRoot = await makeStateRoot()
    const key = 'malformed-after-start'
    const digest = createHash('sha256').update(key, 'utf8').digest('hex')
    const recordPath = join(stateRoot, digest)
    await mkdir(recordPath)
    await writeFile(join(recordPath, 'claim.json'), JSON.stringify({
      version: 1,
      fingerprint: 'same',
      phase: 'claimed',
      ownerPid: 2_147_483_647,
    }))
    await writeFile(join(recordPath, 'started.json'), JSON.stringify({
      version: 1,
      fingerprint: 'same',
      phase: 'started',
      childPid: 2_147_483_647,
    }))
    await writeFile(join(recordPath, 'result.json'), '{"exitCode":0,"output":"bad"}')
    const counter = join(stateRoot, 'must-not-run-malformed.txt')
    const { sdk } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')

    await expect(handle.runIdempotent(
      command(
        `require('node:fs').writeFileSync(${JSON.stringify(counter)}, 'ran')`,
        stateRoot,
      ),
      { key, requestFingerprint: 'same' },
    )).rejects.toMatchObject({ name: 'SandboxIndeterminateExecutionError' })
    await expect(stat(counter)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('hashes keys into bounded paths and rejects malformed persisted results', async () => {
    const stateRoot = await makeStateRoot()
    const { sdk, sandbox } = createSdk()
    const handle = await new VercelSandboxProvider(sdk, { stateRoot }).get('existing')
    const maliciousKey = `${'x'.repeat(4_096)}/../../escape`
    sandbox.runCommand = vi.fn(async (options: RunCommandOptions) => {
      if (options.cmd === 'mkdir') return { exitCode: 0 }
      sandbox.runCalls.push(options)
      options.stdout?.write('not-json')
      return { exitCode: 0 }
    })

    await expect(handle.runIdempotent(
      command('', stateRoot),
      { key: maliciousKey, requestFingerprint: 'fingerprint' },
    )).rejects.toThrow('Invalid idempotency helper result')

    const encodedPayload = sandbox.runCalls[0].args?.at(-1)
    const payload = JSON.parse(
      Buffer.from(encodedPayload!, 'base64url').toString('utf8'),
    ) as { recordPath: string }
    expect(payload.recordPath).toMatch(
      new RegExp(`^${stateRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-f0-9]{64}$`),
    )
    expect(payload.recordPath).not.toContain('escape')
  })

  it('treats an already absent sandbox as stopped', async () => {
    const { sdk, sandbox } = createSdk()
    const handle = await new VercelSandboxProvider(sdk).get('existing')
    sandbox.stopError = { response: { status: 404 } }

    await expect(handle.stopIdempotent()).resolves.toBeUndefined()
    expect(sandbox.stopCalls).toBe(1)
  })
})
