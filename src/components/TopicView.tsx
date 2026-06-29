import { useEffect, useState } from 'react'
import { topicKey, type Course, type Section, type Topic } from '../types'
import { STATUS_LABEL, type TopicStatus } from '../hooks/useProgress'
import { Inline } from './Inline'
import { HandsOnLab } from './HandsOnLab'

interface Props {
  course: Course
  section: Section
  topic: Topic
  statuses: Record<string, TopicStatus>
  onSetStatus: (key: string, status: TopicStatus) => void
  onBack: () => void
  onNavigate: (dir: -1 | 1) => void
  neighbors: { prev: Topic | null; next: Topic | null }
}

const TYPE_LABEL: Record<string, string> = {
  article: 'Article',
  video: 'Video',
  course: 'Course',
  official: 'Docs',
  opensource: 'Code',
}

const STATUS_OPTIONS: Array<{ status: TopicStatus; icon: string; kbd: string }> = [
  { status: 'pending', icon: '○', kbd: 'R' },
  { status: 'learning', icon: '◐', kbd: 'I' },
  { status: 'done', icon: '●', kbd: 'D' },
  { status: 'skipped', icon: '⊘', kbd: 'S' },
]

function CodeBlock({ title, language, code }: { title: string; language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <figure className="code-block">
      <figcaption>
        <span className="code-title">{title}</span>
        <span className="code-meta">
          <span className="code-lang">{language}</span>
          <button className="code-copy" onClick={copy}>
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </span>
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export function TopicView({
  course,
  section,
  topic,
  statuses,
  onSetStatus,
  onBack,
  onNavigate,
  neighbors,
}: Props) {
  const key = topicKey(course.id, section.id, topic.id)
  const status: TopicStatus = statuses[key] ?? 'pending'

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [key])

  return (
    <article className="topic-view">
      <nav className="breadcrumb">
        <button onClick={onBack}>← Roadmap</button>
        <span className="crumb-sep">/</span>
        <span>{section.title}</span>
        {topic.subsection && (
          <>
            <span className="crumb-sep">/</span>
            <span>{topic.subsection}</span>
          </>
        )}
      </nav>

      <header className="topic-head">
        <h1>{topic.title}</h1>
        <div className="topic-meta">
          <span className="meta-time">{topic.minutes} min read</span>
          {topic.handsOn && <span className="lab-badge">⌨ Hands-on lab</span>}
          <div className="status-control" role="group" aria-label="Topic status">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.status}
                className={`status-option status-${opt.status} ${status === opt.status ? 'active' : ''}`}
                onClick={() => onSetStatus(key, opt.status)}
                title={`${STATUS_LABEL[opt.status]} (${opt.kbd})`}
              >
                <span className="status-icon">{opt.icon}</span>
                {STATUS_LABEL[opt.status]}
                <kbd>{opt.kbd}</kbd>
              </button>
            ))}
          </div>
        </div>
        <p className="topic-intro">
          <Inline text={topic.intro} />
        </p>
      </header>

      <div className="topic-body">
        {topic.summary.map((p, i) => (
          <p key={i}>
            <Inline text={p} />
          </p>
        ))}

        {topic.keyPoints.length > 0 && (
          <div className="key-points">
            <h3>Key points</h3>
            <ul>
              {topic.keyPoints.map((kp, i) => (
                <li key={i}>
                  <Inline text={kp} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {topic.code.map((c, i) => (
          <CodeBlock key={i} {...c} />
        ))}

        {topic.handsOn && (
          <HandsOnLab lab={topic.handsOn} topicKey={key} labLanguages={course.labLanguages} />
        )}

        {topic.resources.length > 0 && (
          <div className="resources">
            <h3>Go deeper</h3>
            {topic.resources.map((r, i) => (
              <a key={i} className="resource" href={r.url} target="_blank" rel="noreferrer">
                <span className={`resource-type type-${r.type}`}>{TYPE_LABEL[r.type] ?? r.type}</span>
                <span className="resource-title">{r.title}</span>
                <span className="resource-arrow">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <nav className="topic-nav">
        {neighbors.prev ? (
          <button onClick={() => onNavigate(-1)}>
            <small>← Previous</small>
            {neighbors.prev.title}
          </button>
        ) : (
          <span />
        )}
        {neighbors.next ? (
          <button className="nav-next" onClick={() => onNavigate(1)}>
            <small>Next →</small>
            {neighbors.next.title}
          </button>
        ) : (
          <span />
        )}
      </nav>
      <p className="kbd-hint">
        <kbd>←</kbd> <kbd>→</kbd> topics · <kbd>D</kbd> done · <kbd>I</kbd> in progress ·{' '}
        <kbd>S</kbd> skip · <kbd>R</kbd> reset · <kbd>esc</kbd> roadmap
      </p>
    </article>
  )
}
