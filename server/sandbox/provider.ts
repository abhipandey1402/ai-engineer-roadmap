import type {
  CloudRuntime,
  ProjectFile,
} from '../../src/lib/sandbox/protocol'

export interface SandboxCommand {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

export interface SandboxCommandResult {
  exitCode: number
  output: Array<{
    sequence: number
    stream: 'stdout' | 'stderr'
    text: string
  }>
}

export interface SandboxCommandIdempotency {
  key: string
  requestFingerprint: string
}

export interface SandboxHandle {
  name: string
  writeFiles(files: ProjectFile[]): Promise<void>
  /**
   * Executes a command at most once for a given key within this sandbox.
   *
   * Implementations must persist and replay the in-flight or completed result
   * inside the sandbox so the guarantee survives serverless cold instances.
   * The request fingerprint must be persisted with the key. Reuse with a
   * different fingerprint must throw SandboxIdempotencyConflictError before
   * replaying output. Keys are scoped to this handle's sandbox.
   */
  runIdempotent(
    command: SandboxCommand,
    idempotency: SandboxCommandIdempotency,
  ): Promise<SandboxCommandResult>
  /**
   * Stops the sandbox and succeeds when it is already stopped or absent.
   *
   * An implementation that cannot absorb provider-native absence must throw
   * SandboxNotFoundError so the API can preserve idempotent stop semantics.
   */
  stopIdempotent(): Promise<void>
}

export class SandboxIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was reused for a different command request')
    this.name = 'SandboxIdempotencyConflictError'
  }
}

export class SandboxNotFoundError extends Error {
  constructor(name: string) {
    super(`Sandbox not found: ${name}`)
    this.name = 'SandboxNotFoundError'
  }
}

export interface SandboxProvider {
  create(
    runtime: CloudRuntime,
    name: string,
    timeoutMs: number,
  ): Promise<SandboxHandle>
  /**
   * Resolves an existing sandbox.
   *
   * Implementations must throw SandboxNotFoundError when the sandbox no longer
   * exists so stop/destroy retries can be distinguished from operational
   * provider failures.
   */
  get(name: string): Promise<SandboxHandle>
}
