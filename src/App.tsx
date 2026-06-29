import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { sections, totalTopics } from './data'
import { getLastTopic, saveLastTopic, useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { topicKey } from './types'
import { Sidebar } from './components/Sidebar'
import { RoadmapView } from './components/RoadmapView'
import { TopicView } from './components/TopicView'
import { SearchPalette } from './components/SearchPalette'

type View = { kind: 'home' } | { kind: 'topic'; sectionId: string; topicId: string }

interface FlatTopic {
  sectionId: string
  topicId: string
  title: string
}

export default function App() {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [searchOpen, setSearchOpen] = useState(false)
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()
  const homeScroll = useRef(0)
  const restoreScroll = useRef(false)

  // Restore the roadmap's scroll position only when navigating back from a topic —
  // not when jumping to a section from the sidebar.
  useLayoutEffect(() => {
    if (view.kind === 'home' && restoreScroll.current) {
      restoreScroll.current = false
      window.scrollTo({ top: homeScroll.current, behavior: 'instant' as ScrollBehavior })
    }
  }, [view])

  const flat = useMemo<FlatTopic[]>(
    () =>
      sections.flatMap((s) =>
        s.topics.map((t) => ({ sectionId: s.id, topicId: t.id, title: t.title })),
      ),
    [],
  )

  const openTopic = useCallback(
    (sectionId: string, topicId: string) => {
      if (view.kind === 'home') homeScroll.current = window.scrollY
      setView({ kind: 'topic', sectionId, topicId })
      setSearchOpen(false)
      saveLastTopic(`${sectionId}/${topicId}`)
    },
    [view.kind],
  )

  const goHome = useCallback(() => {
    restoreScroll.current = true
    setView({ kind: 'home' })
  }, [])

  const selectSection = useCallback((sectionId: string) => {
    restoreScroll.current = false
    setView({ kind: 'home' })
    requestAnimationFrame(() => {
      document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  // Where "continue learning" lands: last visited if unfinished, else first unfinished topic.
  const isFinished = useCallback(
    (key: string) => statuses[key] === 'done' || statuses[key] === 'skipped',
    [statuses],
  )

  const continueTarget = useMemo(() => {
    const last = getLastTopic()
    if (last && !isFinished(last)) {
      const slash = last.indexOf('/')
      const hit = flat.find(
        (f) => f.sectionId === last.slice(0, slash) && f.topicId === last.slice(slash + 1),
      )
      if (hit) return hit
    }
    return flat.find((f) => !isFinished(topicKey(f.sectionId, f.topicId))) ?? flat[0] ?? null
  }, [flat, isFinished])

  const current = useMemo(() => {
    if (view.kind !== 'topic') return null
    const section = sections.find((s) => s.id === view.sectionId)
    const topic = section?.topics.find((t) => t.id === view.topicId)
    if (!section || !topic) return null
    const idx = flat.findIndex((f) => f.sectionId === view.sectionId && f.topicId === view.topicId)
    const findTopic = (ref: FlatTopic | undefined) =>
      ref
        ? (sections.find((s) => s.id === ref.sectionId)?.topics.find((t) => t.id === ref.topicId) ?? null)
        : null
    return { section, topic, idx, prev: findTopic(flat[idx - 1]), next: findTopic(flat[idx + 1]) }
  }, [view, flat])

  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (!current) return
      const target = flat[current.idx + dir]
      if (target) openTopic(target.sectionId, target.topicId)
    },
    [current, flat, openTopic],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
        return
      }
      if (searchOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') goHome()
      if (view.kind === 'topic') {
        const key = topicKey(view.sectionId, view.topicId)
        switch (e.key.toLowerCase()) {
          case 'arrowleft':
            navigate(-1)
            break
          case 'arrowright':
            navigate(1)
            break
          case 'd':
            setStatus(key, 'done')
            break
          case 'i':
            setStatus(key, 'learning')
            break
          case 's':
            setStatus(key, 'skipped')
            break
          case 'r':
            setStatus(key, 'pending')
            break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, view, navigate, goHome, setStatus])

  const doneCount = useMemo(
    () => Object.values(statuses).filter((s) => s === 'done').length,
    [statuses],
  )
  const pct = totalTopics ? (doneCount / totalTopics) * 100 : 0

  return (
    <div className="app">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <Sidebar
        activeSectionId={view.kind === 'topic' ? view.sectionId : null}
        statuses={statuses}
        onHome={goHome}
        onSelectSection={selectSection}
        onSearch={() => setSearchOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="main">
        {current ? (
          <TopicView
            section={current.section}
            topic={current.topic}
            statuses={statuses}
            onSetStatus={setStatus}
            onBack={goHome}
            onNavigate={navigate}
            neighbors={{ prev: current.prev, next: current.next }}
          />
        ) : (
          <RoadmapView statuses={statuses} onOpenTopic={openTopic} continueTarget={continueTarget} />
        )}
      </main>
      {searchOpen && (
        <SearchPalette
          statuses={statuses}
          onClose={() => setSearchOpen(false)}
          onOpenTopic={openTopic}
        />
      )}
    </div>
  )
}
