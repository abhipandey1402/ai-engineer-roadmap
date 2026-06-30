import { useEffect, useReducer, useState } from 'react'
import { navigate } from '../../hooks/useRoute'
import type { Theme } from '../../hooks/useTheme'
import { usePython } from '../../hooks/usePython'
import {
  defaultPlaygroundStore,
  fileReducer,
  uniqueName,
  type FileStore,
} from '../../lib/python/fileStore'
import { Logo } from '../Logo'
import { CodeEditor } from './CodeEditor'
import { Console } from './Console'
import { FileTabs } from './FileTabs'
import { Repl } from './Repl'

const STORE_KEY = 'pathwise-playground-files'
const ensurePy = (n: string) => (n.endsWith('.py') ? n : `${n}.py`)

function loadStore(): FileStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FileStore>
      if (parsed?.files && parsed.order?.length && parsed.active && parsed.files[parsed.active] !== undefined) {
        return parsed as FileStore
      }
    }
  } catch {
    /* fall through to default */
  }
  return defaultPlaygroundStore
}

export function PlaygroundApp({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [store, dispatch] = useReducer(fileReducer, undefined, loadStore)
  const [showRepl, setShowRepl] = useState(false)
  const { engineState, running, output, run, stop, clearOutput, writeFile } = usePython()

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store))
    } catch {
      /* ignore storage quota / disabled */
    }
  }, [store])

  const active = store.active
  const code = store.files[active] ?? ''

  const doRun = async () => {
    clearOutput()
    // Sync every file into the worker FS so imports between them resolve.
    for (const name of store.order) await writeFile(name, store.files[name])
    void run(code)
  }

  const addFile = () => {
    const name = window.prompt('New file name', uniqueName(store))?.trim()
    if (name) dispatch({ type: 'add', name: ensurePy(name) })
  }
  const renameFile = (from: string) => {
    const to = window.prompt('Rename file', from)?.trim()
    if (to) dispatch({ type: 'rename', from, to: ensurePy(to) })
  }
  const deleteFile = (name: string) => {
    if (window.confirm(`Delete ${name}?`)) dispatch({ type: 'delete', name })
  }

  return (
    <div className="playground">
      <header className="playground-head">
        <button className="pg-home" onClick={() => navigate('')}>
          <Logo size={22} />
          <span>Pathwise</span>
        </button>
        <h1>Python Playground</h1>
        <div className="pg-head-actions">
          <button className="py-btn" onClick={() => setShowRepl((v) => !v)}>
            {showRepl ? 'Hide REPL' : 'Show REPL'}
          </button>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div className="pg-body">
        <section className="pg-editor-pane">
          <FileTabs
            store={store}
            onSelect={(n) => dispatch({ type: 'select', name: n })}
            onAdd={addFile}
            onRename={renameFile}
            onDelete={deleteFile}
          />
          <CodeEditor
            value={code}
            onChange={(v) => dispatch({ type: 'edit', name: active, content: v })}
            onRun={doRun}
            minRows={14}
            ariaLabel={`Code for ${active}`}
          />
          <div className="py-toolbar">
            {running ? (
              <button className="py-btn py-stop" onClick={stop}>
                ■ Stop
              </button>
            ) : (
              <button className="py-btn py-run" onClick={doRun} disabled={engineState === 'loading'}>
                ▶ Run {active}
              </button>
            )}
            <button className="py-btn" onClick={clearOutput} disabled={running}>
              Clear
            </button>
            <span className="py-status">
              {engineState === 'loading' ? 'loading…' : running ? 'running…' : 'ready'}
            </span>
          </div>
        </section>

        <section className="pg-output-pane">
          <Console output={output} loading={engineState === 'loading'} emptyHint="Run your code to see output." />
          {showRepl && <Repl />}
        </section>
      </div>
    </div>
  )
}
