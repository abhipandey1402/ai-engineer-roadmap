import {
  DEFAULT_LIMITS,
  type CloudRuntime,
  type ExecuteCommand,
  type ParsedTerminalCommand,
  type PlaygroundRuntime,
} from './protocol.js'

type Quote = 'single' | 'double' | null
type CommandRuntime = CloudRuntime | PlaygroundRuntime
interface TerminalToken {
  value: string
  hasUnquotedRedirect: boolean
}

const encoder = new TextEncoder()
const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/
const secretName = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i
const windowsAbsolutePath = /^[A-Za-z]:\//
const pythonRequirementWithComparator =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9._,-]+\])?(?:===|==|~=|!=|<=|>=|<|>)[0-9*][A-Za-z0-9*+!._-]*(?:,(?:===|==|~=|!=|<=|>=|<|>)[0-9*][A-Za-z0-9*+!._-]*)*$/
const npmPackageWithComparator = /^(?:@[^/@\s]+\/)?[^@/\s]+@(?:<=|>=|<|>)[0-9][A-Za-z0-9+._-]*$/

function isShellOperator(character: string): boolean {
  return character === '\n' || character === '\r' || ';|&'.includes(character)
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function isUnsafePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized.startsWith('/')
    || windowsAbsolutePath.test(normalized)
    || normalized.split('/').includes('..')
    || hasControlCharacter(normalized)
  )
}

function tokenize(input: string): TerminalToken[] {
  const tokens: TerminalToken[] = []
  let token = ''
  let tokenStarted = false
  let hasUnquotedRedirect = false
  let quote: Quote = null
  let escaped = false

  for (const character of input) {
    if (escaped) {
      if (quote === null && isShellOperator(character)) {
        throw new Error('Shell operators are not supported')
      }
      token += character
      tokenStarted = true
      if (quote === null && (character === '<' || character === '>')) {
        hasUnquotedRedirect = true
      }
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
        tokens.push({ value: token, hasUnquotedRedirect })
        token = ''
        tokenStarted = false
        hasUnquotedRedirect = false
      }
      continue
    }

    token += character
    tokenStarted = true
    if (character === '<' || character === '>') hasUnquotedRedirect = true
  }

  if (escaped || quote !== null) throw new Error('Unmatched quote or escape')
  if (tokenStarted) tokens.push({ value: token, hasUnquotedRedirect })
  return tokens
}

function assertArgumentLimits(args: string[]): void {
  if (args.length > DEFAULT_LIMITS.maxArgs) throw new Error('Too many command arguments')
  if (args.some((argument) => encoder.encode(argument).byteLength > DEFAULT_LIMITS.maxArgBytes)) {
    throw new Error('Command argument is too large')
  }
}

function assertNoControlCharacters(args: string[]): void {
  if (args.some(hasControlCharacter)) {
    throw new Error('Command arguments cannot contain control characters')
  }
}

function assertNoRedirects(tokens: TerminalToken[]): void {
  const [executable, subcommand] = tokens

  for (const [index, token] of tokens.entries()) {
    if (!token.hasUnquotedRedirect) continue

    const allowedPythonComparator = executable.value === 'pip'
      && subcommand?.value === 'install'
      && index >= 2
      && pythonRequirementWithComparator.test(token.value)
    const allowedNodeComparator = executable.value === 'npm'
      && subcommand?.value === 'install'
      && index >= 2
      && npmPackageWithComparator.test(token.value)

    if (!allowedPythonComparator && !allowedNodeComparator) {
      throw new Error('Shell operators are not supported')
    }
  }
}

function assertSafeCommandPaths(executable: string, args: string[]): void {
  const paths = executable === 'python' || executable === 'node'
    ? args.slice(0, 1)
    : executable === 'ls'
      ? args.filter((argument, index) => {
          const doubleDashIndex = args.indexOf('--')
          return doubleDashIndex >= 0
            ? index > doubleDashIndex || (index < doubleDashIndex && !argument.startsWith('-'))
            : !argument.startsWith('-')
        })
      : []

  if (paths.some(isUnsafePath)) throw new Error('Invalid command path')
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
  runtime: CommandRuntime,
): ParsedTerminalCommand {
  const tokens = tokenize(input)
  if (tokens.length === 0) throw new Error('Command cannot be empty')

  assertNoRedirects(tokens)

  const [executableToken, ...argumentTokens] = tokens
  const executable = executableToken.value
  const args = argumentTokens.map((token) => token.value)
  assertNoControlCharacters(args)

  if (runtime === 'browser-python') {
    if (executable !== 'pip' || args[0] !== 'install') {
      throw new Error('Browser Python supports only pip install')
    }
  } else if (executable === 'export') {
    return parseEnvironment([executable, ...args])
  }

  const cloudRuntime = runtime === 'cloud-python'
    ? 'python'
    : runtime === 'cloud-node'
      ? 'node'
      : runtime
  const allowed = cloudRuntime === 'python'
    ? ['pip', 'python', 'pwd', 'ls']
    : cloudRuntime === 'node'
      ? ['npm', 'node', 'pwd', 'ls']
      : ['pip']

  if (!allowed.includes(executable)) throw runtimeError(executable)
  if ((executable === 'pip' || executable === 'npm') && args[0] !== 'install') {
    throw new Error(`${executable} supports only the install subcommand`)
  }
  assertArgumentLimits(args)
  assertSafeCommandPaths(executable, args)

  return {
    kind: 'execute',
    executable: executable as ExecuteCommand['executable'],
    args,
  }
}

export function commandForFile(runtime: CloudRuntime, file: string): ExecuteCommand {
  if (isUnsafePath(file)) throw new Error('Invalid command path')

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
