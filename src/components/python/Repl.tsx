import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { pythonClient, type OutputChunk } from '../../lib/python/client'

interface Entry {
  input: string
  chunks: OutputChunk[]
  result: string
  running: boolean
}

/** Interactive prompt sharing the engine's persistent namespace. ↑/↓ = history. */
export function Repl() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const histIndex = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  const submit = async () => {
    const code = input.trim()
    if (!code || busy) return
    const idx = entries.length
    setEntries((e) => [...e, { input: code, chunks: [], result: '', running: true }])
    setInput('')
    histIndex.current = null
    setBusy(true)
    const collected: OutputChunk[] = []
    const res = await pythonClient
      .repl(code, (c) => {
        collected.push(c)
        setEntries((e) => e.map((en, i) => (i === idx ? { ...en, chunks: [...collected] } : en)))
      })
      .catch(() => ({ result: '' }))
    setEntries((e) => e.map((en, i) => (i === idx ? { ...en, result: res.result ?? '', running: false } : en)))
    setBusy(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
      return
    }
    const inputs = entries.map((en) => en.input)
    if (e.key === 'ArrowUp' && inputs.length) {
      e.preventDefault()
      const next = histIndex.current === null ? inputs.length - 1 : Math.max(0, histIndex.current - 1)
      histIndex.current = next
      setInput(inputs[next])
    } else if (e.key === 'ArrowDown' && histIndex.current !== null) {
      e.preventDefault()
      const next = histIndex.current + 1
      if (next >= inputs.length) {
        histIndex.current = null
        setInput('')
      } else {
        histIndex.current = next
        setInput(inputs[next])
      }
    }
  }

  return (
    <div className="py-repl">
      <div className="py-repl-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <span className="py-console-empty">Type Python and press Enter. ↑/↓ for history.</span>
        )}
        {entries.map((en, i) => (
          <div key={i} className="py-repl-entry">
            <div className="py-repl-in">
              <span className="py-repl-ps">&gt;&gt;&gt;</span> {en.input}
            </div>
            {en.chunks.map((c, j) => (
              <span key={j} className={c.stream === 'stderr' ? 'py-err' : 'py-out'}>
                {c.text}
              </span>
            ))}
            {en.result && <span className="py-repl-result">{en.result}</span>}
          </div>
        ))}
      </div>
      <div className="py-repl-prompt">
        <span className="py-repl-ps">&gt;&gt;&gt;</span>
        <input
          className="py-repl-input"
          value={input}
          placeholder={busy ? 'running…' : 'type code, Enter to run'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}
