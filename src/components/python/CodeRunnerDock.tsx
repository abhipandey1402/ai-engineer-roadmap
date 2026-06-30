import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PythonRunner } from './PythonRunner'
import { Repl } from './Repl'

const DOCK_INITIAL =
  '# Scratch runner — drag me by the header, resize from the corner.\n# Write Python and press Run (or ⌘/Ctrl+Enter).\n\nprint("ready")\n'
const STORE_KEY = 'pathwise-dock-window'
const MIN_W = 320
const MIN_H = 240

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function clampBox(b: Box): Box {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(Math.max(MIN_W, b.w), vw)
  const h = Math.min(Math.max(MIN_H, b.h), vh)
  const x = Math.min(Math.max(0, b.x), Math.max(0, vw - w))
  const y = Math.min(Math.max(0, b.y), Math.max(0, vh - h))
  return { x, y, w, h }
}

function defaultBox(): Box {
  const w = 440
  const h = 520
  return clampBox({ w, h, x: window.innerWidth - w - 24, y: window.innerHeight - h - 84 })
}

function loadBox(): Box {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const b = JSON.parse(raw) as Partial<Box>
      if (['x', 'y', 'w', 'h'].every((k) => typeof b[k as keyof Box] === 'number')) {
        return clampBox(b as Box)
      }
    }
  } catch {
    /* fall through to default */
  }
  return defaultBox()
}

/**
 * App-wide floating code runner: a fixed action button toggles a draggable,
 * resizable window (Editor + REPL tabs) reusing the shared engine. Mounted once
 * at the App root so its state survives navigation. During a drag/resize the
 * window's geometry is mutated directly on the DOM node for smoothness, then
 * committed to state (and localStorage) on release.
 */
export function CodeRunnerDock() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'editor' | 'repl'>('editor')
  const [box, setBox] = useState<Box>(loadBox)
  const winRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ mode: 'drag' | 'resize'; sx: number; sy: number; box: Box } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(box))
    } catch {
      /* ignore storage quota / disabled */
    }
  }, [box])

  // Keep the window on-screen if the viewport shrinks.
  useEffect(() => {
    const onResize = () => setBox((b) => clampBox(b))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const applyGeometry = (b: Box) => {
    const el = winRef.current
    if (!el) return
    el.style.left = `${b.x}px`
    el.style.top = `${b.y}px`
    el.style.width = `${b.w}px`
    el.style.height = `${b.h}px`
  }

  const beginDrag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // let header buttons work
    gesture.current = { mode: 'drag', sx: e.clientX, sy: e.clientY, box }
    winRef.current?.setPointerCapture(e.pointerId)
  }

  const beginResize = (e: ReactPointerEvent) => {
    e.stopPropagation()
    gesture.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, box }
    winRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    applyGeometry(
      g.mode === 'drag'
        ? clampBox({ ...g.box, x: g.box.x + dx, y: g.box.y + dy })
        : clampBox({ ...g.box, w: g.box.w + dx, h: g.box.h + dy }),
    )
  }

  const endGesture = (e: ReactPointerEvent) => {
    if (!gesture.current) return
    gesture.current = null
    winRef.current?.releasePointerCapture(e.pointerId)
    const el = winRef.current
    if (el) {
      setBox(
        clampBox({
          x: parseFloat(el.style.left),
          y: parseFloat(el.style.top),
          w: parseFloat(el.style.width),
          h: parseFloat(el.style.height),
        }),
      )
    }
  }

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
        ref={winRef}
        className={`runner-window ${open ? 'open' : ''}`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        role="dialog"
        aria-label="Python runner"
        aria-hidden={!open}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <header className="runner-dock-head" onPointerDown={beginDrag}>
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

        <div className="runner-window-body">
          <div className="runner-window-pane" hidden={tab !== 'editor'}>
            <PythonRunner variant="full" storageKey="pathwise-dock" initialCode={DOCK_INITIAL} />
          </div>
          <div className="runner-window-pane" hidden={tab !== 'repl'}>
            <Repl />
          </div>
        </div>

        <span
          className="runner-resize"
          onPointerDown={beginResize}
          aria-hidden="true"
          title="Drag to resize"
        />
      </aside>
    </>
  )
}
