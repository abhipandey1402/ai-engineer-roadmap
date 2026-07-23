import {
  DEFAULT_LIMITS,
  type CloudRuntime,
  type ExecuteCommand,
  type ParsedTerminalCommand,
} from './protocol'

type Quote = 'single' | 'double' | null

const encoder = new TextEncoder()
const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/
const secretName = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i

function isShellOperator(character: string): boolean {
  return character === '\n' || character === '\r' || ';|&<>'.includes(character)
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let token = ''
  let tokenStarted = false
  let quote: Quote = null
  let escaped = false

  for (const character of input) {
    if (escaped) {
      if (quote === null && isShellOperator(character)) {
        throw new Error('Shell operators are not supported')
      }
      token += character
      tokenStarted = true
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      tokenStarted = true
      continue
    }

    if (quote === 'single') {
      if (character === "'") quote = null
      else token += character
      continue
    }

    if (quote === 'double') {
      if (character === '"') quote = null
      else token += character
      continue
    }

    if (character === "'") {
      quote = 'single'
      tokenStarted = true
      continue
    }

    if (character === '"') {
      quote = 'double'
      tokenStarted = true
      continue
    }

    if (isShellOperator(character)) {
      throw new Error('Shell operators are not supported')
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token)
        token = ''
        tokenStarted = false
      }
      continue
    }

    token += character
    tokenStarted = true
  }

  if (escaped || quote !== null) throw new Error('Unmatched quote or escape')
  if (tokenStarted) tokens.push(token)
  return tokens
}

function assertArgumentLimits(args: string[]): void {
  if (args.length > DEFAULT_LIMITS.maxArgs) throw new Error('Too many command arguments')
  if (args.some((argument) => encoder.encode(argument).byteLength > DEFAULT_LIMITS.maxArgBytes)) {
    throw new Error('Command argument is too large')
  }
}

function parseEnvironment(tokens: string[]): ParsedTerminalCommand {
  if (tokens.length !== 2) throw new Error('Expected export NAME=value')

  const assignment = tokens[1]
  const equalsIndex = assignment.indexOf('=')
  if (equalsIndex < 1) throw new Error('Expected export NAME=value')

  const name = assignment.slice(0, equalsIndex)
  if (!environmentName.test(name)) throw new Error('Invalid environment variable name')

  return {
    kind: 'environment',
    name,
    value: assignment.slice(equalsIndex + 1),
    secret: secretName.test(name),
  }
}

function runtimeError(executable: string): Error {
  if (executable === 'npm' || executable === 'node') {
    return new Error(`${executable} is available only in Cloud Node`)
  }
  if (executable === 'pip' || executable === 'python') {
    return new Error(`${executable} is available only in Cloud Python`)
  }
  return new Error('Command is not supported')
}

export function parseTerminalCommand(
  input: string,
  runtime: CloudRuntime,
): ParsedTerminalCommand {
  const tokens = tokenize(input)
  if (tokens.length === 0) throw new Error('Command cannot be empty')
  if (tokens[0] === 'export') return parseEnvironment(tokens)

  const [executable, ...args] = tokens
  const allowed = runtime === 'python'
    ? ['pip', 'python', 'pwd', 'ls']
    : ['npm', 'node', 'pwd', 'ls']

  if (!allowed.includes(executable)) throw runtimeError(executable)
  if ((executable === 'pip' || executable === 'npm') && args[0] !== 'install') {
    throw new Error(`${executable} supports only the install subcommand`)
  }
  assertArgumentLimits(args)

  return {
    kind: 'execute',
    executable: executable as ExecuteCommand['executable'],
    args,
  }
}

export function commandForFile(runtime: CloudRuntime, file: string): ExecuteCommand {
  const matchesRuntime = runtime === 'python'
    ? file.endsWith('.py')
    : /\.(?:c?js|mjs)$/.test(file)

  if (!matchesRuntime) throw new Error('File extension does not match runtime')

  return {
    kind: 'execute',
    executable: runtime,
    args: [file],
  }
}
