import { useState } from 'react'
import { PythonRunner } from './PythonRunner'
import { Repl } from './Repl'

const DOCK_INITIAL = '# Scratch runner — open from anywhere.\n# Write Python and press Run (or ⌘/Ctrl+Enter).\n\nprint("ready")\n'

/**
 * App-wide floating code runner. A fixed action button toggles a right-side
 * slide-in panel (chatbot style) holding an Editor and a REPL tab. Mounted once
 * at the app root so its state survives navigation; the panel stays mounted
 * (hidden via CSS) so output isn't lost when it's collapsed.
 */
export function CodeRunnerDock() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'editor' | 'repl'>('editor')

  return (
    <>
      <button
        className={`runner-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Python runner' : 'Open Python runner'}
        aria-expanded={open}
        title={open ? 'Close runner' : 'Run Python anywhere'}
      >
        {open ? '×' : '>_'}
      </button>

      <aside
        className={`runner-dock ${open ? 'open' : ''}`}
        role="dialog"
        aria-label="Python runner"
        aria-hidden={!open}
      >
        <header className="runner-dock-head">
          <span className="runner-dock-title">
            <span className="runner-dock-glyph">{'>_'}</span> Python Runner
          </span>
          <span className="runner-dock-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'editor'}
              className={tab === 'editor' ? 'active' : ''}
              onClick={() => setTab('editor')}
            >
              Editor
            </button>
            <button
              role="tab"
              aria-selected={tab === 'repl'}
              className={tab === 'repl' ? 'active' : ''}
              onClick={() => setTab('repl')}
            >
              REPL
            </button>
          </span>
          <button className="runner-dock-close" onClick={() => setOpen(false)} aria-label="Close runner">
            ×
          </button>
        </header>

        <div className="runner-dock-body">
          <div className="runner-dock-pane" hidden={tab !== 'editor'}>
            <PythonRunner variant="full" storageKey="pathwise-dock" initialCode={DOCK_INITIAL} />
          </div>
          <div className="runner-dock-pane" hidden={tab !== 'repl'}>
            <Repl />
          </div>
        </div>
      </aside>
    </>
  )
}
