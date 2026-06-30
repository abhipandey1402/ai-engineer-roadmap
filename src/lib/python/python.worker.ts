// Pyodide host. Runs in a module Web Worker so Python execution never blocks the
// UI thread; the main thread kills runaway code by terminating + respawning us.
//
// The runtime loader and WASM/stdlib assets are imported from the jsDelivr CDN at
// `PYODIDE_CDN` (a runtime URL, marked @vite-ignore so the bundler leaves it
// alone). The `pyodide` npm package is used only for its TypeScript types.
import type { PyodideInterface } from 'pyodide'
import { PYODIDE_CDN, type WorkerRequest, type WorkerResponse } from './protocol'

const post = (msg: WorkerResponse) => self.postMessage(msg)

const HOME = '/home/pyodide'
const filePath = (name: string) => `${HOME}/${name.replace(/^\/+/, '')}`

// Id of the request currently executing — stamped onto streamed output so the
// client can route stdout/stderr to the runner that started this run.
let currentId = -1

let pyodidePromise: Promise<PyodideInterface> | null = null
// Persistent REPL namespace + a cached `repr` so REPL results echo like a shell.
let replNs: ReturnType<PyodideInterface['runPython']> | null = null
let reprFn: ReturnType<PyodideInterface['runPython']> | null = null

async function init(): Promise<PyodideInterface> {
  post({ kind: 'status', state: 'loading' })
  const mod = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)
  const py: PyodideInterface = await mod.loadPyodide({ indexURL: PYODIDE_CDN })
  py.setStdout({ batched: (text: string) => post({ kind: 'output', id: currentId, stream: 'stdout', text }) })
  py.setStderr({ batched: (text: string) => post({ kind: 'output', id: currentId, stream: 'stderr', text }) })
  // Let scripts import sibling files written to the virtual FS.
  py.runPython(`import sys; sys.path.insert(0, '${HOME}')`)
  post({ kind: 'status', state: 'ready' })
  return py
}

function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) pyodidePromise = init()
  return pyodidePromise
}

/** A fresh `{'__name__': '__main__'}` dict so each script run is deterministic. */
function newNamespace(py: PyodideInterface) {
  return py.runPython("{'__name__': '__main__'}")
}

self.onmessage = async (e: MessageEvent) => {
  const req = e.data as WorkerRequest
  let py: PyodideInterface
  try {
    py = await getPyodide()
  } catch (err) {
    post({ kind: 'done', id: req.id, ok: false, error: `Failed to load Python: ${String(err)}` })
    return
  }

  currentId = req.id
  try {
    switch (req.type) {
      case 'run': {
        const ns = newNamespace(py)
        try {
          await py.loadPackagesFromImports(req.code)
          await py.runPythonAsync(req.code, { globals: ns })
          post({ kind: 'done', id: req.id, ok: true })
        } finally {
          ns.destroy()
        }
        break
      }
      case 'repl': {
        if (!replNs) replNs = newNamespace(py)
        if (!reprFn) reprFn = py.runPython('repr')
        await py.loadPackagesFromImports(req.code)
        const ret = await py.runPythonAsync(req.code, { globals: replNs })
        let result = ''
        // Mirror the Python shell: echo the last expression, skip None/statements.
        if (ret !== undefined && ret !== null) {
          result = reprFn(ret)
          if (typeof ret.destroy === 'function') ret.destroy()
        }
        post({ kind: 'done', id: req.id, ok: true, result })
        break
      }
      case 'writeFile':
        py.FS.writeFile(filePath(req.name), req.content)
        post({ kind: 'done', id: req.id, ok: true })
        break
      case 'readFile':
        post({
          kind: 'value',
          id: req.id,
          value: py.FS.readFile(filePath(req.name), { encoding: 'utf8' }) as string,
        })
        break
      case 'listFiles':
        post({
          kind: 'value',
          id: req.id,
          value: (py.FS.readdir(HOME) as string[]).filter((n) => n !== '.' && n !== '..'),
        })
        break
      case 'deleteFile':
        try {
          py.FS.unlink(filePath(req.name))
        } catch {
          /* already gone — treat delete as idempotent */
        }
        post({ kind: 'done', id: req.id, ok: true })
        break
      case 'reset':
        if (replNs) {
          replNs.destroy()
          replNs = null
        }
        post({ kind: 'done', id: req.id, ok: true })
        break
    }
  } catch (err) {
    // PythonError.message carries the formatted traceback — surface it as stderr
    // so it lands in the console, and flag the run as failed.
    const message = err instanceof Error ? err.message : String(err)
    post({ kind: 'output', id: req.id, stream: 'stderr', text: message.endsWith('\n') ? message : `${message}\n` })
    post({ kind: 'done', id: req.id, ok: false, error: message })
  }
}
