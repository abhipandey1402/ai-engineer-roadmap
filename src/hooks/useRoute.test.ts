import { describe, it, expect } from 'vitest'
import { parseHash } from './useRoute'

describe('parseHash', () => {
  it('treats empty hash as home', () => {
    expect(parseHash('')).toEqual({ kind: 'home' })
  })
  it('treats "#/" as home', () => {
    expect(parseHash('#/')).toEqual({ kind: 'home' })
  })
  it('parses a single segment as a course', () => {
    expect(parseHash('#/python')).toEqual({ kind: 'course', courseId: 'python' })
  })
  it('parses three segments as a topic', () => {
    expect(parseHash('#/python/language-basics/loops')).toEqual({
      kind: 'topic',
      courseId: 'python',
      sectionId: 'language-basics',
      topicId: 'loops',
    })
  })
  it('falls back to home for a malformed two-segment hash', () => {
    expect(parseHash('#/python/language-basics')).toEqual({ kind: 'home' })
  })
  it('ignores a trailing slash', () => {
    expect(parseHash('#/python/')).toEqual({ kind: 'course', courseId: 'python' })
  })
  it('parses "#/playground" as the reserved playground route', () => {
    expect(parseHash('#/playground')).toEqual({ kind: 'playground' })
  })
  it('still parses a non-playground single segment as a course', () => {
    expect(parseHash('#/ai-engineer')).toEqual({ kind: 'course', courseId: 'ai-engineer' })
  })
})
