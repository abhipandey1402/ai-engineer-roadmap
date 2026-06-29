import { topicKey, type Course } from '../types'
import type { TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { Logo } from './Logo'

interface Props {
  course: Course
  activeSectionId: string | null
  statuses: Record<string, TopicStatus>
  onHome: () => void
  onSelectSection: (sectionId: string) => void
  onSearch: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Sidebar({
  course,
  activeSectionId,
  statuses,
  onHome,
  onSelectSection,
  onSearch,
  theme,
  onToggleTheme,
}: Props) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={onHome}>
        <span className="brand-mark">
          <Logo />
        </span>
        <span>
          Pathwise
          <small>{course.title}</small>
        </span>
      </button>

      <button className="search-trigger" onClick={onSearch}>
        <span>Search topics</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="section-list">
        {course.sections.map((s, i) => {
          const sectionStatuses = s.topics.map((t) => statuses[topicKey(course.id, s.id, t.id)])
          const done = sectionStatuses.filter((st) => st === 'done').length
          const hasLearning = sectionStatuses.some((st) => st === 'learning')
          const isFinished =
            s.topics.length > 0 && sectionStatuses.every((st) => st === 'done' || st === 'skipped')
          return (
            <button
              key={s.id}
              className={`section-item ${activeSectionId === s.id ? 'active' : ''}`}
              onClick={() => onSelectSection(s.id)}
            >
              <span className="section-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="section-name">
                {s.title}
                {hasLearning && <span className="section-learning" title="In progress"> ◐</span>}
              </span>
              <span className={`section-count ${isFinished ? 'done' : ''}`}>
                {isFinished ? '✓' : `${done}/${s.topics.length}`}
              </span>
            </button>
          )
        })}
      </nav>

      <footer className="sidebar-footer">
        <span>
          Based on{' '}
          <a href={course.source.url} target="_blank" rel="noreferrer">
            {course.source.label}
          </a>
        </span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </footer>
    </aside>
  )
}
