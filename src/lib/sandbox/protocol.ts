export type CloudRuntime = 'python' | 'node'

export type PlaygroundRuntime = 'browser-python' | 'cloud-python' | 'cloud-node'

export type SessionState =
  | 'disabled'
  | 'idle'
  | 'creating'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'error'

export interface ProjectFile {
  path: string
  content: string
}

export interface ExecuteCommand {
  kind: 'execute'
  executable: 'pip' | 'python' | 'npm' | 'node' | 'pwd' | 'ls'
  args: string[]
}

export interface EnvironmentCommand {
  kind: 'environment'
  name: string
  value: string
  secret: boolean
}

export type ParsedTerminalCommand = ExecuteCommand | EnvironmentCommand

export const DEFAULT_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 256_000,
  maxProjectBytes: 1_000_000,
  maxArgs: 40,
  maxArgBytes: 4_096,
  maxOutputBytes: 1_000_000,
  commandTimeoutMs: 120_000,
  sandboxTimeoutMs: 900_000,
} as const

export type RuntimeLimits = typeof DEFAULT_LIMITS

interface RuntimeCapabilitiesBase {
  enabled: boolean
  reason?: string
  runtimes: readonly CloudRuntime[]
  allowByok: boolean
  limits: RuntimeLimits
}

export interface EnabledRuntimeCapabilities extends RuntimeCapabilitiesBase {
  enabled: true
}

export interface DisabledRuntimeCapabilities extends RuntimeCapabilitiesBase {
  enabled: false
  reason: string
  runtimes: readonly []
}

export type RuntimeCapabilities =
  | EnabledRuntimeCapabilities
  | DisabledRuntimeCapabilities

export interface CommandOutputChunk {
  sequence: number
  stream: 'stdout' | 'stderr'
  text: string
}

export interface CommandResult {
  idempotencyKey: string
  exitCode: number
  output: CommandOutputChunk[]
}
