import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { OutputChunk, RunResult } from '../../lib/python/client'
import { parseTerminalCommand } from '../../lib/sandbox/commands'
import { redactSecrets } from '../../lib/sandbox/redaction'
import type {
  CommandOutputChunk,
  ExecuteCommand,
  PlaygroundRuntime,
} from '../../lib/sandbox/protocol'

interface SubmitDependencies {
  runtime: PlaygroundRuntime
  install: (packages: string[]) => Promise<RunResult>
  runCommand: (command: ExecuteCommand) => Promise<unknown>
  setEnvironment: (name: string, value: string, secret: boolean) => void
  secrets: string[]
}

// Pure behavior is exported for focused terminal contract tests.
// eslint-disable-next-line react-refresh/only-export-components
export async function submitTerminalInput(
  input: string,
  dependencies: SubmitDependencies,
): Promise<string | undefined> {
  const command = input.trim()
  if (
    dependencies.runtime === 'browser-python'
    && /^python(?:\s|$)/.test(command)
  ) {
    throw new Error('Run the editor with the Run button.')
  }

  const parsed = parseTerminalCommand(command, dependencies.runtime)
  if (parsed.kind === 'environment') {
    dependencies.setEnvironment(parsed.name, parsed.value, parsed.secret)
    return undefined
  }

  if (dependencies.runtime === 'browser-python') {
    const result = await dependencies.install(parsed.args.slice(1))
    if (!result.ok) throw new Error(result.error || 'Package installation failed.')
  } else {
    await dependencies.runCommand(parsed)
  }

  return redactSecrets(command, dependencies.secrets)
}

interface Props extends SubmitDependencies {
  output: Array<OutputChunk | CommandOutputChunk>
  running: boolean
  disabled?: boolean
  error?: string
}

const hints: Record<PlaygroundRuntime, string> = {
  'browser-python': 'pip install numpy',
  'cloud-python': 'pip install numpy · python app.py · pwd · ls',
  'cloud-node': 'npm install openai · node app.js · pwd · ls',
}

export function PackageTerminal({
  runtime,
  install,
  runCommand,
  setEnvironment,
  secrets,
  output,
  running,
  disabled = false,
  error,
}: Props) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [localError, setLocalError] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output, error, localError])

  const submit = async () => {
    if (!input.trim() || running || disabled) return
    setLocalError('')
    try {
      const entry = await submitTerminalInput(input, {
        runtime,
        install,
        runCommand,
        setEnvironment,
        secrets,
      })
      if (entry) setHistory((current) => [...current, entry])
      setInput('')
      setHistoryIndex(-1)
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Command failed.')
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    if (history.length === 0) return
    const next = event.key === 'ArrowUp'
      ? Math.min(historyIndex + 1, history.length - 1)
      : Math.max(historyIndex - 1, -1)
    setHistoryIndex(next)
    setInput(next < 0 ? '' : history[history.length - 1 - next])
  }

  return (
    <section className={`package-terminal package-terminal-${runtime}`} aria-label="Runtime terminal">
      <div className="package-terminal-head">
        <span>{runtime === 'browser-python' ? 'Packages and output' : 'Terminal'}</span>
        <span aria-live="polite">{running ? 'Running' : disabled ? 'Unavailable' : 'Ready'}</span>
      </div>
      <div className="package-terminal-output" ref={outputRef} role="log" aria-live="polite">
        {output.length === 0 && !error && !localError && (
          <span className="package-terminal-empty">
            {runtime === 'browser-python'
              ? 'Install browser-compatible Python packages here.'
              : 'Run a command or use Run to execute the active file.'}
          </span>
        )}
        {output.map((chunk, index) => (
          <span
            key={`${'sequence' in chunk ? chunk.sequence : 'browser'}-${index}`}
            className={chunk.stream === 'stderr' ? 'package-terminal-error' : undefined}
          >
            {redactSecrets(chunk.text, secrets)}
          </span>
        ))}
        {(localError || error) && (
          <span className="package-terminal-error">{localError || error}{'\n'}</span>
        )}
      </div>
      <form
        className="package-terminal-prompt"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="package-terminal-input">
          <span aria-hidden="true">$</span>
          <span className="sr-only">Terminal command</span>
        </label>
        <input
          id="package-terminal-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={hints[runtime].split(' · ')[0]}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || running}
        />
        <button type="submit" disabled={disabled || running || !input.trim()}>
          Run command
        </button>
      </form>
      <p className="package-terminal-hint">{hints[runtime]}</p>
    </section>
  )
}
