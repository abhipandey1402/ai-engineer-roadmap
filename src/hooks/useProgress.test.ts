import { describe, it, expect } from 'vitest'
import { namespaceKeys } from './useProgress'

describe('namespaceKeys', () => {
  it('prefixes every key with the course id', () => {
    const legacy = {
      'introduction/what-is-an-ai-engineer': 'done',
      'rag/chunking': 'learning',
    } as const
    expect(namespaceKeys(legacy, 'ai-engineer')).toEqual({
      'ai-engineer/introduction/what-is-an-ai-engineer': 'done',
      'ai-engineer/rag/chunking': 'learning',
    })
  })

  it('returns an empty object unchanged', () => {
    expect(namespaceKeys({}, 'python')).toEqual({})
  })
})
