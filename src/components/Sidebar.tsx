import { sections } from '../data'
import { topicKey } from '../types'
import type { TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { Logo } from './Logo'

interface Props {
  activeSectionId: string | null
  statuses: Record<string, TopicStatus>
  onHome: () => void
  onSelectSection: (sectionId: string) => void
  onSearch: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Sidebar({
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
          AI Engineer
          <small>learning roadmap</small>
        </span>
      </button>

      <button className="search-trigger" onClick={onSearch}>
        <span>Search topics</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="section-list">
        {sections.map((s, i) => {
          const sectionStatuses = s.topics.map((t) => statuses[topicKey(s.id, t.id)])
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
          <a href="https://roadmap.sh/ai-engineer" target="_blank" rel="noreferrer">
            roadmap.sh/ai-engineer
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
