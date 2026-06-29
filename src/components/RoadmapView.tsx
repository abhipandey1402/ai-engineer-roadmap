import { courseMinutes, courseTopicCount } from '../data'
import { topicKey, type Course, type Section, type Topic } from '../types'
import type { TopicStatus } from '../hooks/useProgress'

interface Props {
  course: Course
  statuses: Record<string, TopicStatus>
  onOpenTopic: (sectionId: string, topicId: string) => void
  continueTarget: { sectionId: string; topicId: string; title: string } | null
}

const PILL_ICON: Partial<Record<TopicStatus, string>> = {
  learning: '◐',
  done: '✓',
  skipped: '⊘',
}

function groupTopics(section: Section): Array<{ label: string | null; topics: Topic[] }> {
  const groups: Array<{ label: string | null; topics: Topic[] }> = []
  for (const t of section.topics) {
    const last = groups[groups.length - 1]
    if (last && last.label === t.subsection) last.topics.push(t)
    else groups.push({ label: t.subsection, topics: [t] })
  }
  return groups
}

export function RoadmapView({ course, statuses, onOpenTopic, continueTarget }: Props) {
  const total = courseTopicCount(course)
  let doneCount = 0
  let learningCount = 0
  for (const s of course.sections) {
    for (const t of s.topics) {
      const st = statuses[topicKey(course.id, s.id, t.id)]
      if (st === 'done') doneCount++
      else if (st === 'learning') learningCount++
    }
  }
  const pct = total ? Math.round((doneCount / total) * 100) : 0

  return (
    <div className="roadmap">
      <header className="hero">
        <h1>{course.title}</h1>
        <p className="hero-sub">{course.description}</p>
        <div className="hero-stats">
          <div className="stat">
            <strong>{total}</strong>
            <span>topics</span>
          </div>
          <div className="stat">
            <strong>~{Math.round(courseMinutes(course) / 60)}h</strong>
            <span>total reading</span>
          </div>
          <div className="stat">
            <strong>{learningCount}</strong>
            <span>in progress</span>
          </div>
          <div className="stat">
            <strong>{doneCount}</strong>
            <span>done</span>
          </div>
          <div className="stat">
            <strong>{pct}%</strong>
            <span>complete</span>
          </div>
        </div>
        {continueTarget && (
          <button
            className="continue-btn"
            onClick={() => onOpenTopic(continueTarget.sectionId, continueTarget.topicId)}
          >
            {doneCount > 0 || learningCount > 0 ? 'Continue learning' : 'Start learning'} —{' '}
            {continueTarget.title} →
          </button>
        )}
      </header>

      <div className="timeline">
        {course.sections.map((section, i) => {
          const sectionStatuses = section.topics.map((t) => statuses[topicKey(course.id, section.id, t.id)])
          const sectionDone = sectionStatuses.filter((s) => s === 'done').length
          const allFinished = sectionStatuses.every((s) => s === 'done' || s === 'skipped')
          return (
            <section key={section.id} id={`section-${section.id}`} className="timeline-item">
              <div className="timeline-rail">
                <div className={`timeline-node ${allFinished ? 'filled' : ''}`}>
                  {allFinished ? '✓' : String(i + 1).padStart(2, '0')}
                </div>
                {i < course.sections.length - 1 && <div className="timeline-line" />}
              </div>
              <div className="timeline-card">
                <div className="timeline-card-head">
                  <h2>{section.title}</h2>
                  <span className="timeline-progress">
                    {sectionDone}/{section.topics.length}
                  </span>
                </div>
                <p className="timeline-desc">{section.description}</p>
                {groupTopics(section).map((g, gi) => (
                  <div key={gi} className="topic-group">
                    {g.label && <div className="topic-group-label">{g.label}</div>}
                    <div className="topic-pills">
                      {g.topics.map((t) => {
                        const status = statuses[topicKey(course.id, section.id, t.id)] ?? 'pending'
                        const icon = PILL_ICON[status]
                        return (
                          <button
                            key={t.id}
                            className={`pill pill-${status}`}
                            onClick={() => onOpenTopic(section.id, t.id)}
                            title={t.handsOn ? `${t.intro} (includes hands-on lab)` : t.intro}
                          >
                            {icon && <span className="pill-check">{icon}</span>}
                            {t.title}
                            {t.handsOn && <span className="pill-lab" title="Hands-on lab">LAB</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
