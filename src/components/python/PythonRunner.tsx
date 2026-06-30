import { useState } from 'react'
import { usePython } from '../../hooks/usePython'
import { codeNeedsNetwork } from '../../lib/python/analyze'
import { CodeEditor } from './CodeEditor'
import { Console } from './Console'

interface Props {
  initialCode?: string
  /** When set, editor contents persist to localStorage under this key. */
  storageKey?: string
  variant?: 'inline' | 'full'
  autoFocus?: boolean
}

function load(storageKey: string | undefined, fallback: string): string {
  if (!storageKey) return fallback
  try {
    return localStorage.getItem(storageKey) ?? fallback
  } catch {
    return fallback
  }
}

/** Self-contained editor + Run/Stop/Reset toolbar + output console. */
export function PythonRunner({ initialCode = '', storageKey, variant = 'inline', autoFocus }: Props) {
  const [code, setCode] = useState(() => load(storageKey, initialCode))
  const { engineState, running, output, run, stop, clearOutput } = usePython()

  const update = (v: string) => {
    setCode(v)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, v)
      } catch {
        /* ignore storage quota / disabled */
      }
    }
  }

  const doRun = () => {
    clearOutput()
    void run(code)
  }
  const reset = () => {
    update(initialCode)
    clearOutput()
  }

  const needsNetwork = codeNeedsNetwork(code)

  return (
    <div className={`py-runner py-${variant}`}>
      {needsNetwork && (
        <p className="py-net-note">
          ⚠ This snippet calls an external API (needs a key + network). In-browser Python can’t reach
          those services (CORS &amp; key safety) — run it locally to make the live call. The
          non-API parts still run here.
        </p>
      )}
      <CodeEditor value={code} onChange={update} onRun={doRun} autoFocus={autoFocus} ariaLabel="Editable Python code" />
      <div className="py-toolbar">
        {running ? (
          <button className="py-btn py-stop" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="py-btn py-run" onClick={doRun} disabled={engineState === 'loading'}>
            ▶ Run
          </button>
        )}
        <button className="py-btn" onClick={reset} disabled={running}>
          ↺ Reset
        </button>
        <button className="py-btn" onClick={clearOutput} disabled={running}>
          Clear
        </button>
        <span className="py-status">
          {engineState === 'loading' ? 'loading…' : running ? 'running…' : 'ready'}
        </span>
      </div>
      <Console output={output} loading={engineState === 'loading'} />
    </div>
  )
}
