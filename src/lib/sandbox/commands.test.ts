import { describe, expect, it } from 'vitest'
import { commandForFile, parseTerminalCommand } from './commands'

describe('parseTerminalCommand', () => {
  it('parses Python package installation', () => {
    expect(parseTerminalCommand('pip install openai numpy', 'python')).toEqual({
      kind: 'execute',
      executable: 'pip',
      args: ['install', 'openai', 'numpy'],
    })
  })

  it('preserves a quoted scoped Node package as one argument', () => {
    expect(parseTerminalCommand('npm install "@scope/pkg@^2"', 'node')).toEqual({
      kind: 'execute',
      executable: 'npm',
      args: ['install', '@scope/pkg@^2'],
    })
  })

  it('parses exported secret environment variables', () => {
    expect(parseTerminalCommand('export OPENAI_API_KEY="sk-test value"', 'python')).toEqual({
      kind: 'environment',
      name: 'OPENAI_API_KEY',
      value: 'sk-test value',
      secret: true,
    })
  })

  it('rejects shell operators', () => {
    expect(() => parseTerminalCommand('python app.py; cat /etc/passwd', 'python'))
      .toThrow('Shell operators are not supported')
  })

  it('does not allow backslash escaping to bypass shell operator rejection', () => {
    expect(() => parseTerminalCommand('python app.py\\;cat', 'python'))
      .toThrow('Shell operators are not supported')
  })

  it('rejects commands unavailable in the selected runtime', () => {
    expect(() => parseTerminalCommand('npm install openai', 'python'))
      .toThrow('npm is available only in Cloud Node')
  })
})

describe('commandForFile', () => {
  it('builds a Python command for a Python file', () => {
    expect(commandForFile('python', 'rag.py')).toEqual({
      kind: 'execute',
      executable: 'python',
      args: ['rag.py'],
    })
  })

  it('builds a Node command for an ECMAScript module', () => {
    expect(commandForFile('node', 'example.mjs')).toEqual({
      kind: 'execute',
      executable: 'node',
      args: ['example.mjs'],
    })
  })

  it('rejects Python files in the Node runtime', () => {
    expect(() => commandForFile('node', 'rag.py')).toThrow('File extension does not match runtime')
  })

  it('rejects Node files in the Python runtime', () => {
    expect(() => commandForFile('python', 'example.mjs')).toThrow('File extension does not match runtime')
  })
})
