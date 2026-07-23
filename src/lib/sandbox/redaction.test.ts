import { describe, expect, it } from 'vitest'
import { redactSecrets } from './redaction'

describe('redactSecrets', () => {
  it('redacts every exact occurrence', () => {
    expect(redactSecrets('key=sk-secret and sk-secret-again', ['sk-secret']))
      .toBe('key=[REDACTED] and [REDACTED]-again')
  })

  it('ignores empty and short candidate secrets', () => {
    expect(redactSecrets('unchanged', ['', 'short'])).toBe('unchanged')
  })

  it('handles regular-expression characters literally', () => {
    expect(redactSecrets('value=a+b*c?.! value=a+b*c?.!', ['a+b*c?.!']))
      .toBe('value=[REDACTED] value=[REDACTED]')
  })

  it('redacts longer overlapping secrets first', () => {
    expect(redactSecrets('prefix-secret-value', ['secret-value', 'secret-v']))
      .toBe('prefix-[REDACTED]')
  })
})
