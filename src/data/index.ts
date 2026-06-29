import type { Section } from '../types'

const modules = import.meta.glob('./sections/*.json', { eager: true }) as Record<
  string,
  { default: Section }
>

export const sections: Section[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path].default)

export const totalTopics = sections.reduce((n, s) => n + s.topics.length, 0)

export const totalMinutes = sections.reduce(
  (n, s) => n + s.topics.reduce((m, t) => m + t.minutes, 0),
  0,
)
