import type { Course, Section } from '../types'

type CourseMeta = Omit<Course, 'sections'>

const metaModules = import.meta.glob('./courses/*/course.json', { eager: true }) as Record<
  string,
  { default: CourseMeta }
>
const sectionModules = import.meta.glob('./courses/*/sections/*.json', { eager: true }) as Record<
  string,
  { default: Section }
>

// Path shape: './courses/<courseId>/sections/NN-foo.json' or './courses/<courseId>/course.json'
const courseIdFromPath = (p: string) => p.split('/')[2]

const sectionsByCourse: Record<string, Array<{ path: string; section: Section }>> = {}
for (const path of Object.keys(sectionModules)) {
  const id = courseIdFromPath(path)
  ;(sectionsByCourse[id] ??= []).push({ path, section: sectionModules[path].default })
}

export const courses: Course[] = Object.keys(metaModules)
  .map((path) => {
    const meta = metaModules[path].default
    const sections = (sectionsByCourse[meta.id] ?? [])
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((s) => s.section)
    return { ...meta, sections }
  })
  .sort((a, b) => a.order - b.order)

export const getCourse = (id: string): Course | undefined => courses.find((c) => c.id === id)

export const courseTopicCount = (c: Course) =>
  c.sections.reduce((n, s) => n + s.topics.length, 0)

export const courseMinutes = (c: Course) =>
  c.sections.reduce((n, s) => n + s.topics.reduce((m, t) => m + t.minutes, 0), 0)

// --- Temporary back-compat exports (removed in Task 5 once components take a course) ---
const aiEngineer = getCourse('ai-engineer')
export const sections: Section[] = aiEngineer?.sections ?? []
export const totalTopics = aiEngineer ? courseTopicCount(aiEngineer) : 0
export const totalMinutes = aiEngineer ? courseMinutes(aiEngineer) : 0
