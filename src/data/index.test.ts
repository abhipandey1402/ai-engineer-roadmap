import { describe, it, expect } from 'vitest'
import { courses, getCourse, courseTopicCount } from './index'

describe('course registry', () => {
  it('loads the ai-engineer course from courses/*/course.json', () => {
    expect(getCourse('ai-engineer')).toBeDefined()
  })

  it('attaches all 15 AI sections (150+ topics) to the course', () => {
    const c = getCourse('ai-engineer')!
    expect(c.sections.length).toBe(15)
    expect(courseTopicCount(c)).toBeGreaterThan(150)
  })

  it('orders courses by their `order` field', () => {
    const orders = courses.map((c) => c.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('loads the python course as a Python-only course', () => {
    const py = getCourse('python')
    expect(py).toBeDefined()
    expect(py!.labLanguages).toEqual(['python'])
    expect(py!.sections.length).toBeGreaterThanOrEqual(1)
  })
})
