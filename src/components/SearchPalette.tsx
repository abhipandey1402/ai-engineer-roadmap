import { useEffect, useMemo, useRef, useState } from 'react'
import { sections } from '../data'
import { topicKey } from '../types'
import type { TopicStatus } from '../hooks/useProgress'

interface Props {
  statuses: Record<string, TopicStatus>
  onClose: () => void
  onOpenTopic: (sectionId: string, topicId: string) => void
}

const HIT_ICON: Partial<Record<TopicStatus, string>> = {
  learning: '◐ ',
  done: '✓ ',
  skipped: '⊘ ',
}

interface Hit {
  sectionId: string
  sectionTitle: string
  topicId: string
  title: string
  intro: string
}

const ALL: Hit[] = sections.flatMap((s) =>
  s.topics.map((t) => ({
    sectionId: s.id,
    sectionTitle: s.title,
    topicId: t.id,
    title: t.title,
    intro: t.intro,
  })),
)

export function SearchPalette({ statuses, onClose, onOpenTopic }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL.slice(0, 12)
    return ALL.filter(
      (h) =>
        h.title.toLowerCase().includes(q) ||
        h.intro.toLowerCase().includes(q) ||
        h.sectionTitle.toLowerCase().includes(q),
    ).slice(0, 12)
  }, [query])

  useEffect(() => setCursor(0), [query])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && hits[cursor]) {
      onOpenTopic(hits[cursor].sectionId, hits[cursor].topicId)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 170+ topics…"
        />
        <div className="palette-results">
          {hits.map((h, i) => (
            <button
              key={topicKey(h.sectionId, h.topicId)}
              className={`palette-hit ${i === cursor ? 'cursor' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onOpenTopic(h.sectionId, h.topicId)}
            >
              <span className="hit-title">
                {HIT_ICON[statuses[topicKey(h.sectionId, h.topicId)] ?? 'pending'] && (
                  <span className="pill-check">
                    {HIT_ICON[statuses[topicKey(h.sectionId, h.topicId)] ?? 'pending']}
                  </span>
                )}
                {h.title}
              </span>
              <span className="hit-section">{h.sectionTitle}</span>
            </button>
          ))}
          {hits.length === 0 && <div className="palette-empty">No topics match “{query}”.</div>}
        </div>
      </div>
    </div>
  )
}
