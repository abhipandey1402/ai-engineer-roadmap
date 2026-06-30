// Shared message contract between the main thread (client.ts) and the Pyodide
// Web Worker (python.worker.ts). Keep this dependency-free so both sides can
// import it without pulling in DOM- or worker-only globals.

// Pin to the installed `pyodide` npm version. The runtime loader + WASM assets
// are fetched from the jsDelivr CDN at this exact version (kept in sync with
// package.json), so loader and assets never mismatch and the bundle stays tiny.
export const PYODIDE_VERSION = '314.0.2'
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

export type OutputStream = 'stdout' | 'stderr'
export type EngineState = 'idle' | 'loading' | 'ready'

/** Main thread → worker. `id` correlates the eventual response. */
export type WorkerRequest =
  | { id: number; type: 'run'; code: string }
  | { id: number; type: 'repl'; code: string }
  | { id: number; type: 'writeFile'; name: string; content: string }
  | { id: number; type: 'readFile'; name: string }
  | { id: number; type: 'listFiles' }
  | { id: number; type: 'deleteFile'; name: string }
  | { id: number; type: 'reset' }

/** Worker → main thread. `output`/`status` are streamed; the rest reply 1:1. */
export type WorkerResponse =
  | { kind: 'output'; id: number; stream: OutputStream; text: string }
  | { kind: 'status'; state: Exclude<EngineState, 'idle'> }
  | { kind: 'done'; id: number; ok: boolean; error?: string; result?: string }
  | { kind: 'value'; id: number; value: string | string[] }
