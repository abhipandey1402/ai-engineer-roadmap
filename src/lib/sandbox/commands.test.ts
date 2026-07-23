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

  it('allows only pip install in Browser Python', () => {
    expect(parseTerminalCommand('pip install openai>=1 "numpy[testing]"', 'browser-python'))
      .toEqual({
        kind: 'execute',
        executable: 'pip',
        args: ['install', 'openai>=1', 'numpy[testing]'],
      })

    for (const command of [
      'python app.py',
      'pwd',
      'ls',
      'npm install openai',
      'node app.js',
      'export OPENAI_API_KEY=sk-test-value',
    ]) {
      expect(
        () => parseTerminalCommand(command, 'browser-python'),
        command,
      ).toThrow()
    }
  })

  it.each([
    ['python ../secret.py', 'python'],
    ['node /tmp/x.js', 'node'],
    ['node C:/tmp/x.js', 'node'],
    ['ls ..', 'python'],
  ] as const)('rejects unsafe path arguments in %j', (command, runtime) => {
    expect(() => parseTerminalCommand(command, runtime)).toThrow('Invalid command path')
  })

  it.each([
    ['python app\u0000.py', 'python'],
    ['npm install package\u001fname', 'node'],
  ] as const)('rejects control characters in arguments for %j', (command, runtime) => {
    expect(() => parseTerminalCommand(command, runtime))
      .toThrow('Command arguments cannot contain control characters')
  })

  it('preserves normal non-path program arguments', () => {
    expect(parseTerminalCommand('python app.py --output ../result.json', 'python')).toEqual({
      kind: 'execute',
      executable: 'python',
      args: ['app.py', '--output', '../result.json'],
    })
  })

  it('enforces the maximum argument count', () => {
    const args = Array.from({ length: 41 }, (_, index) => `arg-${index}`).join(' ')
    expect(() => parseTerminalCommand(`python ${args}`, 'python'))
      .toThrow('Too many command arguments')
  })

  it('enforces the maximum UTF-8 byte size of each argument', () => {
    expect(() => parseTerminalCommand(`python app.py ${'🙂'.repeat(1_025)}`, 'python'))
      .toThrow('Command argument is too large')
  })

  it.each([
    'python app.py | cat',
    'python app.py > output.txt',
    'python app.py<input.txt',
    'python app.py\npwd',
  ])('rejects shell syntax in %j', (command) => {
    expect(() => parseTerminalCommand(command, 'python'))
      .toThrow('Shell operators are not supported')
  })

  it.each([
    "python 'app.py",
    'python "app.py',
    'python app.py\\',
  ])('rejects unmatched quote or escape in %j', (command) => {
    expect(() => parseTerminalCommand(command, 'python'))
      .toThrow('Unmatched quote or escape')
  })

  it.each([
    ['pip list', 'python', 'pip supports only the install subcommand'],
    ['npm run build', 'node', 'npm supports only the install subcommand'],
  ] as const)('rejects non-install package-manager command %j', (command, runtime, message) => {
    expect(() => parseTerminalCommand(command, runtime)).toThrow(message)
  })

  it('accepts legitimate npm package specifiers', () => {
    expect(parseTerminalCommand(
      'npm install @scope/pkg@^2 package@>=3 github:user/repo#semver:^1',
      'node',
    )).toEqual({
      kind: 'execute',
      executable: 'npm',
      args: ['install', '@scope/pkg@^2', 'package@>=3', 'github:user/repo#semver:^1'],
    })
  })

  it('preserves quoted comparison expressions as literal arguments', () => {
    expect(parseTerminalCommand('python app.py --expr "x > 1"', 'python')).toEqual({
      kind: 'execute',
      executable: 'python',
      args: ['app.py', '--expr', 'x > 1'],
    })
  })

  it('rejects an attached pip redirect', () => {
    expect(() => parseTerminalCommand('pip install openai>requirements.txt', 'python'))
      .toThrow('Shell operators are not supported')
  })

  it.each(['openai>=1.0', 'openai<2'])(
    'accepts legitimate Python requirement comparator %j',
    (requirement) => {
      expect(parseTerminalCommand(`pip install ${requirement}`, 'python')).toEqual({
        kind: 'execute',
        executable: 'pip',
        args: ['install', requirement],
      })
    },
  )

  it.each([
    'ls -la ..',
    'ls -- ../secret',
    'ls -la /tmp',
    'ls -la src ..',
    'ls -- safe ../secret',
  ])('rejects every unsafe ls path operand in %j', (command) => {
    expect(() => parseTerminalCommand(command, 'python')).toThrow('Invalid command path')
  })

  it.each([
    ['ls -la src', ['-la', 'src']],
    ['ls -- -named', ['--', '-named']],
  ] as const)('preserves valid ls flags and operands in %j', (command, args) => {
    expect(parseTerminalCommand(command, 'python')).toEqual({
      kind: 'execute',
      executable: 'ls',
      args: [...args],
    })
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

  it.each(['../rag.py', '/tmp/rag.py', 'C:\\tmp\\rag.py', 'src/\u0000rag.py'])(
    'rejects unsafe file path %j',
    (file) => {
      expect(() => commandForFile('python', file)).toThrow('Invalid command path')
    },
  )
})
