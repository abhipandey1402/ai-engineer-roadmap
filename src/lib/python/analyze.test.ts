import { describe, it, expect } from 'vitest'
import { codeNeedsNetwork } from './analyze'

describe('codeNeedsNetwork', () => {
  it('flags an openai import', () => {
    expect(codeNeedsNetwork('import openai')).toBe(true)
  })
  it('flags a from-import of anthropic', () => {
    expect(codeNeedsNetwork('from anthropic import Anthropic')).toBe(true)
  })
  it('flags a chat completion call', () => {
    expect(codeNeedsNetwork('resp = client.chat.completions.create(model="x")')).toBe(true)
  })
  it('flags an api key reference', () => {
    expect(codeNeedsNetwork('client = OpenAI(api_key="sk-...")')).toBe(true)
  })
  it('flags requests usage', () => {
    expect(codeNeedsNetwork('import requests')).toBe(true)
  })
  it('does not flag pure-compute code', () => {
    expect(codeNeedsNetwork('import numpy as np\nprint(np.mean([1, 2, 3]))')).toBe(false)
  })
  it('does not flag plain prints', () => {
    expect(codeNeedsNetwork('for i in range(3):\n    print(i)')).toBe(false)
  })
})
