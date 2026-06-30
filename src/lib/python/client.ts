// Main-thread handle to the singleton Pyodide worker. Correlates request/response
// by id, fans streamed output to whoever started a run, and implements stop() as
// terminate-and-respawn (which is also how runaway loops get killed).
import type { EngineState, WorkerRequest, WorkerResponse } from './protocol'

export interface RunResult {
  ok: boolean
  error?: string
}
export interface ReplResult extends RunResult {
  result?: string
}
export interface OutputChunk {
  stream: 'stdout' | 'stderr'
  text: string
}
export type OutputHandler = (chunk: OutputChunk) => void

type WorkerFactory = () => Worker
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  onOutput?: OutputHandler
}

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })

export class PythonClient {
  private createWorker: WorkerFactory
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private statusListeners = new Set<(s: EngineState) => void>()
  private _state: EngineState = 'idle'

  constructor(createWorker: WorkerFactory = defaultFactory) {
    this.createWorker = createWorker
  }

  get state(): EngineState {
    return this._state
  }

  /** Subscribe to engine state; fires immediately with the current value. */
  onStatus(cb: (s: EngineState) => void): () => void {
    this.statusListeners.add(cb)
    cb(this._state)
    return () => {
      this.statusListeners.delete(cb)
    }
  }

  run(code: string, onOutput?: OutputHandler): Promise<RunResult> {
    return this.request<RunResult>({ type: 'run', code }, onOutput)
  }

  repl(code: string, onOutput?: OutputHandler): Promise<ReplResult> {
    return this.request<ReplResult>({ type: 'repl', code }, onOutput)
  }

  writeFile(name: string, content: string): Promise<RunResult> {
    return this.request<RunResult>({ type: 'writeFile', name, content })
  }

  readFile(name: string): Promise<string> {
    return this.request<string>({ type: 'readFile', name })
  }

  listFiles(): Promise<string[]> {
    return this.request<string[]>({ type: 'listFiles' })
  }

  deleteFile(name: string): Promise<RunResult> {
    return this.request<RunResult>({ type: 'deleteFile', name })
  }

  reset(): Promise<RunResult> {
    return this.request<RunResult>({ type: 'reset' })
  }

  /** Kill the engine (and any running code); the next request respawns it. */
  stop(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    for (const p of this.pending.values()) p.reject(new Error('Execution stopped'))
    this.pending.clear()
    this.setState('idle')
  }

  private setState(s: EngineState): void {
    this._state = s
    for (const cb of this.statusListeners) cb(s)
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.createWorker()
      this.worker.onmessage = (e: MessageEvent) => this.handle(e.data as WorkerResponse)
    }
    return this.worker
  }

  private handle(msg: WorkerResponse): void {
    if (msg.kind === 'status') {
      this.setState(msg.state)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.kind === 'output') {
      p.onOutput?.({ stream: msg.stream, text: msg.text })
      return
    }
    this.pending.delete(msg.id)
    if (msg.kind === 'done') p.resolve({ ok: msg.ok, error: msg.error, result: msg.result })
    else p.resolve(msg.value)
  }

  private request<T>(body: DistributiveOmit<WorkerRequest, 'id'>, onOutput?: OutputHandler): Promise<T> {
    const worker = this.ensureWorker()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onOutput })
      worker.postMessage({ ...body, id })
    })
  }
}

export const pythonClient = new PythonClient()
