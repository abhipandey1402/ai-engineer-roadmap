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
