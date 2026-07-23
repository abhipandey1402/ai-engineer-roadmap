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

export interface SandboxHandle {
  name: string
  writeFiles(files: ProjectFile[]): Promise<void>
  run(command: SandboxCommand): Promise<SandboxCommandResult>
  stop(): Promise<void>
}

export interface SandboxProvider {
  create(
    runtime: CloudRuntime,
    name: string,
    timeoutMs: number,
  ): Promise<SandboxHandle>
  get(name: string): Promise<SandboxHandle>
}
