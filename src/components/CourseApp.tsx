import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { courseTopicCount } from '../data'
import { getLastTopic, saveLastTopic, type TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { topicKey, type Course } from '../types'
import type { Route } from '../hooks/useRoute'
import { navigate } from '../hooks/useRoute'
import { Sidebar } from './Sidebar'
import { RoadmapView } from './RoadmapView'
import { TopicView } from './TopicView'
import { SearchPalette } from './SearchPalette'

interface FlatTopic {
  sectionId: string
  topicId: string
  title: string
}

interface Props {
  course: Course
  route: Extract<Route, { kind: 'course' } | { kind: 'topic' }>
  statuses: Record<string, TopicStatus>
  setStatus: (key: string, status: TopicStatus) => void
  theme: Theme
  toggleTheme: () => void
  onHome: () => void
}

export function CourseApp({ course, route, statuses, setStatus, theme, toggleTheme, onHome }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const homeScroll = useRef(0)
  const restoreScroll = useRef(false)

  const onRoadmap = route.kind === 'course'

  useLayoutEffect(() => {
    if (onRoadmap && restoreScroll.current) {
      restoreScroll.current = false
      window.scrollTo({ top: homeScroll.current, behavior: 'instant' as ScrollBehavior })
    }
  }, [onRoadmap])

  const flat = useMemo<FlatTopic[]>(
    () =>
      course.sections.flatMap((s) =>
        s.topics.map((t) => ({ sectionId: s.id, topicId: t.id, title: t.title })),
      ),
    [course],
  )

  const openTopic = useCallback(
    (sectionId: string, topicId: string) => {
      if (onRoadmap) homeScroll.current = window.scrollY
      setSearchOpen(false)
      saveLastTopic(course.id, `${sectionId}/${topicId}`)
      navigate(`${course.id}/${sectionId}/${topicId}`)
    },
    [onRoadmap, course.id],
  )

  const goRoadmap = useCallback(() => {
    restoreScroll.current = true
    navigate(course.id)
  }, [course.id])

  const selectSection = useCallback(
    (sectionId: string) => {
      restoreScroll.current = false
      navigate(course.id)
      requestAnimationFrame(() => {
        document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' })
      })
    },
    [course.id],
  )

  const isFinished = useCallback(
    (key: string) => statuses[key] === 'done' || statuses[key] === 'skipped',
    [statuses],
  )

  const continueTarget = useMemo(() => {
    const last = getLastTopic(course.id)
    if (last) {
      const slash = last.indexOf('/')
      const sId = last.slice(0, slash)
      const tId = last.slice(slash + 1)
      if (!isFinished(topicKey(course.id, sId, tId))) {
        const hit = flat.find((f) => f.sectionId === sId && f.topicId === tId)
        if (hit) return hit
      }
    }
    return flat.find((f) => !isFinished(topicKey(course.id, f.sectionId, f.topicId))) ?? flat[0] ?? null
  }, [flat, isFinished, course.id])

  const current = useMemo(() => {
    if (route.kind !== 'topic') return null
    const section = course.sections.find((s) => s.id === route.sectionId)
    const topic = section?.topics.find((t) => t.id === route.topicId)
    if (!section || !topic) return null
    const idx = flat.findIndex((f) => f.sectionId === route.sectionId && f.topicId === route.topicId)
    const findTopic = (ref: FlatTopic | undefined) =>
      ref
        ? course.sections.find((s) => s.id === ref.sectionId)?.topics.find((t) => t.id === ref.topicId) ?? null
        : null
    return { section, topic, idx, prev: findTopic(flat[idx - 1]), next: findTopic(flat[idx + 1]) }
  }, [route, flat, course])

  const navigateTopic = useCallback(
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
      if (e.key === 'Escape') {
        if (route.kind === 'topic') goRoadmap()
        else onHome()
        return
      }
      if (route.kind === 'topic') {
        const key = topicKey(course.id, route.sectionId, route.topicId)
        switch (e.key.toLowerCase()) {
          case 'arrowleft':
            navigateTopic(-1)
            break
          case 'arrowright':
            navigateTopic(1)
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
  }, [searchOpen, route, navigateTopic, goRoadmap, onHome, setStatus, course.id])

  const total = courseTopicCount(course)
  const doneCount = useMemo(
    () =>
      course.sections.reduce(
        (n, s) => n + s.topics.filter((t) => statuses[topicKey(course.id, s.id, t.id)] === 'done').length,
        0,
      ),
    [course, statuses],
  )
  const pct = total ? (doneCount / total) * 100 : 0

  return (
    <div className="app">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <Sidebar
        course={course}
        activeSectionId={route.kind === 'topic' ? route.sectionId : null}
        statuses={statuses}
        onHome={onHome}
        onSelectSection={selectSection}
        onSearch={() => setSearchOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="main">
        {current ? (
          <TopicView
            course={course}
            section={current.section}
            topic={current.topic}
            statuses={statuses}
            onSetStatus={setStatus}
            onBack={goRoadmap}
            onNavigate={navigateTopic}
            neighbors={{ prev: current.prev, next: current.next }}
          />
        ) : (
          <RoadmapView
            course={course}
            statuses={statuses}
            onOpenTopic={openTopic}
            continueTarget={continueTarget}
          />
        )}
      </main>
      {searchOpen && (
        <SearchPalette
          course={course}
          statuses={statuses}
          onClose={() => setSearchOpen(false)}
          onOpenTopic={openTopic}
        />
      )}
    </div>
  )
}
