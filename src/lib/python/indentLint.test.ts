import { describe, it, expect } from 'vitest'
import { checkIndentation } from './indentLint'

const messages = (code: string) => checkIndentation(code).map((d) => d.message)
const severities = (code: string) => checkIndentation(code).map((d) => d.severity)

describe('checkIndentation — clean code', () => {
  it('accepts a well-indented if/else', () => {
    const code = 'if x:\n  a = 1\nelse:\n  a = 2\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('accepts nested blocks', () => {
    const code = 'def f():\n  for i in range(3):\n    if i:\n      print(i)\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('accepts 4-space indentation (any consistent width is valid)', () => {
    const code = 'if x:\n    a = 1\n    b = 2\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('ignores blank and comment-only lines between a header and its body', () => {
    const code = 'while True:\n  # loop\n\n  pass\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('does not treat multi-line brackets as indentation changes', () => {
    const code = 'data = [\n    1,\n    2,\n]\nprint(data)\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('does not analyse indentation inside triple-quoted strings', () => {
    const code = 'def f():\n  s = """\n        weird indent\n  """\n  return s\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('handles backslash line continuations', () => {
    const code = 'total = 1 + \\\n        2\nprint(total)\n'
    expect(checkIndentation(code)).toEqual([])
  })

  it('does not flag a one-liner compound statement', () => {
    const code = 'if x: y = 1\nprint(y)\n'
    expect(checkIndentation(code)).toEqual([])
  })
})

describe('checkIndentation — errors', () => {
  it('flags a missing block after a colon', () => {
    const msgs = messages('if x:\nprint(1)\n')
    expect(msgs.some((m) => /Expected an indented block after 'if'/.test(m))).toBe(true)
  })

  it('flags unexpected indentation', () => {
    const msgs = messages('a = 1\n  b = 2\n')
    expect(msgs.some((m) => /Unexpected indentation/.test(m))).toBe(true)
  })

  it('flags an unindent that matches no outer level', () => {
    const code = 'if x:\n    a = 1\n  b = 2\n'
    expect(messages(code).some((m) => /Unindent does not match/.test(m))).toBe(true)
  })
})

describe('checkIndentation — tabs & mixing', () => {
  it('errors on mixed tabs and spaces in one indent', () => {
    const code = 'if x:\n \ta = 1\n'
    const d = checkIndentation(code)
    expect(d.some((x) => x.severity === 'error' && /TabError/.test(x.message))).toBe(true)
  })

  it('warns on tab-only indentation and offers a spaces fix', () => {
    const code = 'if x:\n\ta = 1\n'
    const d = checkIndentation(code)
    const tabWarn = d.find((x) => /Tab used for indentation/.test(x.message))
    expect(tabWarn?.severity).toBe('warning')
    expect(tabWarn?.fix?.insert).toBe('  ')
  })
})

describe('checkIndentation — fixes', () => {
  it('offers to indent a line that is missing a block', () => {
    const fix = checkIndentation('if x:\nprint(1)\n').find((d) => d.fix)?.fix
    expect(fix).toMatchObject({ insert: '  ', label: 'Indent this line' })
  })

  it('reports offsets within the document bounds', () => {
    const code = 'a = 1\n  b = 2\n'
    for (const d of checkIndentation(code)) {
      expect(d.from).toBeGreaterThanOrEqual(0)
      expect(d.to).toBeLessThanOrEqual(code.length)
      expect(d.from).toBeLessThanOrEqual(d.to)
    }
  })

  it('does not cascade errors after recovering from one', () => {
    // Only the unexpected indent should be reported, not the following line too.
    expect(severities('a = 1\n  b = 2\n  c = 3\n')).toEqual(['error'])
  })
})
