import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { navigate } from '../../hooks/useRoute'
import { useSandbox } from '../../hooks/useSandbox'
import type { Theme } from '../../hooks/useTheme'
import { usePython } from '../../hooks/usePython'
import {
  defaultPlaygroundStore,
  fileReducer,
  uniqueRuntimeName,
  type FileStore,
} from '../../lib/python/fileStore'
import { CLOUD_PLAYGROUND_HANDOFF_KEY } from '../../lib/python/browserPackageFallback'
import { commandForFile } from '../../lib/sandbox/commands'
import type { PlaygroundRuntime } from '../../lib/sandbox/protocol'
import { Logo } from '../Logo'
import { CloudSetupNotice } from './CloudSetupNotice'
import { CodeEditor } from './CodeEditor'
import { EnvironmentPanel, type EnvironmentEntry } from './EnvironmentPanel'
import { FileTabs } from './FileTabs'
import { PackageTerminal } from './PackageTerminal'
import { Repl } from './Repl'
import { RuntimeSelector } from './RuntimeSelector'

const STORE_KEY = 'pathwise-playground-files'
const knownExtension = /\.(?:py|cjs|mjs|js)$/i

function ensureRuntimeExtension(name: string, runtime: PlaygroundRuntime): string {
  if (knownExtension.test(name)) return name
  return runtime === 'cloud-node' ? `${name}.js` : `${name}.py`
}

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
  const [handoff] = useState(() => {
    try {
      const code = sessionStorage.getItem(CLOUD_PLAYGROUND_HANDOFF_KEY)
      sessionStorage.removeItem(CLOUD_PLAYGROUND_HANDOFF_KEY)
      return code
    } catch {
      return null
    }
  })
  const [store, dispatch] = useReducer(fileReducer, undefined, () => {
    const loaded = loadStore()
    if (handoff === null) return loaded
    return {
      ...loaded,
      files: { ...loaded.files, [loaded.active]: handoff },
    }
  })
  const [runtime, setRuntime] = useState<PlaygroundRuntime>(
    handoff === null ? 'browser-python' : 'cloud-python',
  )
  const [showRepl, setShowRepl] = useState(false)
  const [runError, setRunError] = useState('')
  const [environmentEntries, setEnvironmentEntries] = useState<EnvironmentEntry[]>([])
  const [accessToken, setAccessToken] = useState('')
  const nextEnvironmentId = useRef(1)
  const {
    engineState,
    running: browserRunning,
    output: browserOutput,
    run,
    install,
    stop: stopBrowser,
    clearOutput: clearBrowserOutput,
    writeFile,
  } = usePython()

  const environment = useMemo(
    () => Object.fromEntries(
      environmentEntries
        .filter((entry) => entry.name.trim())
        .map((entry) => [entry.name.trim(), entry.value]),
    ),
    [environmentEntries],
  )
  const secretNames = useMemo(
    () => environmentEntries
      .filter((entry) => entry.secret && entry.name.trim())
      .map((entry) => entry.name.trim()),
    [environmentEntries],
  )
  const clearSecrets = useCallback(() => {
    setAccessToken('')
    setEnvironmentEntries((entries) => entries.map((entry) => (
      entry.secret ? { ...entry, value: '' } : entry
    )))
  }, [])
  const cloudRuntime = runtime === 'cloud-node' ? 'node' : 'python'
  const sandbox = useSandbox({
    runtime: cloudRuntime,
    accessToken,
    environment,
    secretNames,
    onSecretsCleared: clearSecrets,
  })
  const browserMode = runtime === 'browser-python'
  const cloudBusy = ['creating', 'running', 'stopping'].includes(sandbox.state)
  const running = browserMode ? browserRunning : cloudBusy

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
    setRunError('')
    if (browserMode) {
      clearBrowserOutput()
      // Sync every file into the worker FS so imports between them resolve.
      for (const name of store.order) await writeFile(name, store.files[name])
      void run(code)
      return
    }
    try {
      sandbox.clearOutput()
      const command = commandForFile(cloudRuntime, active)
      await sandbox.runFiles(
        store.order.map((name) => ({ path: name, content: store.files[name] })),
      )
      await sandbox.runCommand(command)
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : 'Could not run this file.')
    }
  }

  const addFile = () => {
    const name = window.prompt('New file name', uniqueRuntimeName(store, runtime))?.trim()
    if (name) dispatch({ type: 'add', name: ensureRuntimeExtension(name, runtime) })
  }
  const renameFile = (from: string) => {
    const to = window.prompt('Rename file', from)?.trim()
    if (to) dispatch({ type: 'rename', from, to: ensureRuntimeExtension(to, runtime) })
  }
  const deleteFile = (name: string) => {
    if (window.confirm(`Delete ${name}?`)) dispatch({ type: 'delete', name })
  }

  const selectRuntime = async (next: PlaygroundRuntime) => {
    if (next === runtime) return
    if (!browserMode && sandbox.state === 'running') {
      const confirmed = window.confirm(
        'A cloud command is running. Destroy this session and change runtime?',
      )
      if (!confirmed) return
    }
    if (!browserMode && next === 'browser-python') await sandbox.destroy()
    setRuntime(next)
    if (next !== 'browser-python') setShowRepl(false)
  }

  const setEnvironment = (name: string, value: string, secret: boolean) => {
    setEnvironmentEntries((entries) => {
      const existing = entries.find((entry) => entry.name === name)
      if (existing) {
        return entries.map((entry) => (
          entry.id === existing.id ? { ...entry, value, secret } : entry
        ))
      }
      return [...entries, {
        id: nextEnvironmentId.current++,
        name,
        value,
        secret,
      }]
    })
  }

  const updateEnvironment = (
    id: number,
    patch: Partial<Omit<EnvironmentEntry, 'id'>>,
  ) => {
    setEnvironmentEntries((entries) => entries.map((entry) => (
      entry.id === id ? { ...entry, ...patch } : entry
    )))
  }

  return (
    <div className="playground">
      <header className="playground-head">
        <button className="pg-home" onClick={() => navigate('')}>
          <Logo size={22} />
          <span>Pathwise</span>
        </button>
        <h1>Project workbench</h1>
        <div className="pg-head-actions">
          {browserMode && (
            <button className="py-btn" onClick={() => setShowRepl((v) => !v)}>
              {showRepl ? 'Hide REPL' : 'Show REPL'}
            </button>
          )}
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <RuntimeSelector
        value={runtime}
        capabilities={sandbox.capabilities}
        cloudState={sandbox.state}
        onChange={(next) => void selectRuntime(next)}
      />

      {sandbox.capabilities?.enabled === false && (
        <CloudSetupNotice reason={sandbox.capabilities.reason} />
      )}

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
              <button
                className="py-btn py-stop"
                onClick={browserMode ? stopBrowser : () => void sandbox.stop()}
              >
                ■ Stop
              </button>
            ) : (
              <button
                className="py-btn py-run"
                onClick={() => void doRun()}
                disabled={
                  browserMode
                    ? engineState === 'loading'
                    : sandbox.state === 'loading' || sandbox.state === 'disabled'
                }
              >
                ▶ Run {active}
              </button>
            )}
            <button
              className="py-btn"
              onClick={browserMode ? clearBrowserOutput : sandbox.clearOutput}
              disabled={running}
            >
              Clear
            </button>
            {!browserMode && (
              <>
                <button className="py-btn" onClick={() => void sandbox.restart()} disabled={running}>
                  Restart session
                </button>
                <button className="py-btn" onClick={() => void sandbox.destroy()} disabled={running}>
                  Destroy session
                </button>
              </>
            )}
            <span className="py-status" aria-live="polite">
              {browserMode
                ? engineState === 'loading' ? 'loading…' : browserRunning ? 'running…' : 'ready'
                : sandbox.state}
            </span>
          </div>
        </section>

        <section className="pg-output-pane">
          <PackageTerminal
            runtime={runtime}
            install={install}
            runCommand={sandbox.runCommand}
            setEnvironment={setEnvironment}
            secrets={environmentEntries.filter((entry) => entry.secret).map((entry) => entry.value)}
            output={browserMode ? browserOutput : sandbox.output}
            running={running}
            disabled={!browserMode && sandbox.state === 'disabled'}
            error={browserMode ? undefined : runError || sandbox.error}
          />
          {browserMode && showRepl && <Repl />}
          {!browserMode && sandbox.capabilities?.enabled && (
            <EnvironmentPanel
              entries={environmentEntries}
              accessToken={accessToken}
              allowAccessToken={sandbox.capabilities.allowByok}
              onAccessTokenChange={setAccessToken}
              onAdd={() => setEnvironmentEntries((entries) => [...entries, {
                id: nextEnvironmentId.current++,
                name: '',
                value: '',
                secret: false,
              }])}
              onChange={updateEnvironment}
              onRemove={(id) => setEnvironmentEntries((entries) => (
                entries.filter((entry) => entry.id !== id)
              ))}
              onClearSecrets={clearSecrets}
            />
          )}
        </section>
      </div>
    </div>
  )
}
