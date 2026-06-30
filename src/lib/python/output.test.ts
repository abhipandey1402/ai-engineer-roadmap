import { describe, it, expect } from 'vitest'
import { coalesceOutput } from './output'

describe('coalesceOutput', () => {
  it('returns empty for no chunks', () => {
    expect(coalesceOutput([])).toEqual([])
  })

  it('merges consecutive same-stream chunks', () => {
    expect(
      coalesceOutput([
        { stream: 'stdout', text: 'a' },
        { stream: 'stdout', text: 'b' },
      ]),
    ).toEqual([{ stream: 'stdout', text: 'ab' }])
  })

  it('keeps boundaries between different streams', () => {
    expect(
      coalesceOutput([
        { stream: 'stdout', text: 'out' },
        { stream: 'stderr', text: 'err' },
        { stream: 'stdout', text: 'more' },
      ]),
    ).toEqual([
      { stream: 'stdout', text: 'out' },
      { stream: 'stderr', text: 'err' },
      { stream: 'stdout', text: 'more' },
    ])
  })

  it('does not mutate its input', () => {
    const input = [
      { stream: 'stdout' as const, text: 'a' },
      { stream: 'stdout' as const, text: 'b' },
    ]
    coalesceOutput(input)
    expect(input).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stdout', text: 'b' },
    ])
  })
})
