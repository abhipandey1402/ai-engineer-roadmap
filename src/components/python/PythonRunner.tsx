import { useState } from 'react'
import { navigate } from '../../hooks/useRoute'
import { usePython } from '../../hooks/usePython'
import { codeNeedsNetwork } from '../../lib/python/analyze'
import {
  CLOUD_PLAYGROUND_HANDOFF_KEY,
  isBrowserPackageIncompatibility,
} from '../../lib/python/browserPackageFallback'
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
  const [packageIncompatible, setPackageIncompatible] = useState(false)
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
    setPackageIncompatible(false)
    void run(code).then((result) => {
      if (!result.ok && isBrowserPackageIncompatibility(result.error || '')) {
        setPackageIncompatible(true)
      }
    })
  }
  const reset = () => {
    update(initialCode)
    clearOutput()
    setPackageIncompatible(false)
  }

  const openCloudPlayground = () => {
    try {
      sessionStorage.setItem(CLOUD_PLAYGROUND_HANDOFF_KEY, code)
    } catch {
      return
    }
    navigate('playground')
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
      {packageIncompatible && (
        <div className="py-package-fallback" role="status">
          <p>
            This package has no browser-compatible Python wheel. Open the code in Cloud Python
            to use the normal Linux package.
          </p>
          <button className="py-btn" type="button" onClick={openCloudPlayground}>
            Open in Cloud Playground
          </button>
        </div>
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
