import type { CSSProperties } from 'react'
import { courseMinutes, courseTopicCount } from '../data'
import { topicKey, type Course } from '../types'
import type { TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { Logo } from './Logo'

interface Props {
  courses: Course[]
  statuses: Record<string, TopicStatus>
  theme: Theme
  onToggleTheme: () => void
  onOpenCourse: (courseId: string) => void
}

function coursePct(course: Course, statuses: Record<string, TopicStatus>): number {
  const total = courseTopicCount(course)
  if (!total) return 0
  let done = 0
  for (const s of course.sections)
    for (const t of s.topics) if (statuses[topicKey(course.id, s.id, t.id)] === 'done') done++
  return Math.round((done / total) * 100)
}

export function HomePage({ courses, statuses, theme, onToggleTheme, onOpenCourse }: Props) {
  return (
    <div className="home">
      <button
        className="theme-toggle home-theme"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <header className="home-hero">
        <div className="home-brand">
          <Logo size={40} />
          <span>Pathwise</span>
        </div>
        <h1>Learn by building.</h1>
        <p>Interactive roadmaps with hands-on labs and runnable code.</p>
      </header>

      <div className="course-grid">
        {courses.map((course) => {
          const pct = coursePct(course, statuses)
          const started = pct > 0
          return (
            <button
              key={course.id}
              className="course-card"
              style={{ '--card-accent': course.accent } as CSSProperties}
              onClick={() => onOpenCourse(course.id)}
            >
              <div className="course-card-rail" />
              <div className="course-card-body">
                <span className="course-card-icon">{course.icon}</span>
                <h2>{course.title}</h2>
                <p>{course.tagline}</p>
                <div className="course-card-stats">
                  <span>{courseTopicCount(course)} topics</span>
                  <span>~{Math.round(courseMinutes(course) / 60)}h</span>
                </div>
                {started ? (
                  <div className="course-card-progress">
                    <div className="course-card-bar">
                      <div className="course-card-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="course-card-cta">Continue · {pct}% →</span>
                  </div>
                ) : (
                  <span className="course-card-cta">Start learning →</span>
                )}
              </div>
            </button>
          )
        })}

        <div className="course-card course-card-soon" aria-disabled="true">
          <div className="course-card-body">
            <span className="course-card-icon">+</span>
            <h2>More tracks</h2>
            <p>Coming soon.</p>
          </div>
        </div>
      </div>

      <footer className="home-footer">
        Curriculum based on{' '}
        <a href="https://roadmap.sh" target="_blank" rel="noreferrer">
          roadmap.sh
        </a>
      </footer>
    </div>
  )
}
