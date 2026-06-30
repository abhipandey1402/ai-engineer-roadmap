import { useEffect, useRef } from 'react'
import { coalesceOutput } from '../../lib/python/output'
import type { OutputChunk } from '../../lib/python/client'

interface Props {
  output: OutputChunk[]
  loading?: boolean
  emptyHint?: string
}

/** stdout/stderr console that auto-scrolls to the latest output. */
export function Console({ output, loading, emptyHint = 'Output appears here when you run.' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lines = coalesceOutput(output)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output, loading])

  return (
    <div className="py-console" ref={ref} aria-live="polite">
      {lines.length === 0 && !loading && <span className="py-console-empty">{emptyHint}</span>}
      {lines.map((l, i) => (
        <span key={i} className={l.stream === 'stderr' ? 'py-err' : 'py-out'}>
          {l.text}
        </span>
      ))}
      {loading && <span className="py-console-loading">Starting Python… (one-time download)</span>}
    </div>
  )
}
