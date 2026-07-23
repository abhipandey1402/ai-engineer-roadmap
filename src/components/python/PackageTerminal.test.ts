import { describe, expect, it, vi } from 'vitest'
import type { ExecuteCommand, PlaygroundRuntime } from '../../lib/sandbox/protocol'
import { isBrowserPackageIncompatibility } from '../../lib/python/browserPackageFallback'
import { uniqueRuntimeName, type FileStore } from '../../lib/python/fileStore'
import { submitTerminalInput } from './PackageTerminal'

function dependencies(runtime: PlaygroundRuntime) {
  return {
    runtime,
    install: vi.fn(async () => ({ ok: true })),
    runCommand: vi.fn(async (command: ExecuteCommand) => command),
    setEnvironment: vi.fn(),
    secrets: [] as string[],
  }
}

describe('submitTerminalInput', () => {
  it('maps Browser Python pip installs to the browser installer', async () => {
    const deps = dependencies('browser-python')

    await expect(submitTerminalInput('pip install numpy', deps))
      .resolves.toBe('pip install numpy')
    expect(deps.install).toHaveBeenCalledWith(['numpy'])
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('directs Browser Python file commands to the Run button', async () => {
    const deps = dependencies('browser-python')

    await expect(submitTerminalInput('python app.py', deps))
      .rejects.toThrow('Run the editor with the Run button.')
  })

  it('sends parsed pip and python commands to Cloud Python', async () => {
    const deps = dependencies('cloud-python')

    await submitTerminalInput('pip install numpy', deps)
    await submitTerminalInput('python app.py', deps)

    expect(deps.runCommand).toHaveBeenNthCalledWith(1, {
      kind: 'execute',
      executable: 'pip',
      args: ['install', 'numpy'],
    })
    expect(deps.runCommand).toHaveBeenNthCalledWith(2, {
      kind: 'execute',
      executable: 'python',
      args: ['app.py'],
    })
  })

  it('sends parsed npm and node commands to Cloud Node', async () => {
    const deps = dependencies('cloud-node')

    await submitTerminalInput('npm install openai', deps)
    await submitTerminalInput('node app.js', deps)

    expect(deps.runCommand).toHaveBeenNthCalledWith(1, {
      kind: 'execute',
      executable: 'npm',
      args: ['install', 'openai'],
    })
    expect(deps.runCommand).toHaveBeenNthCalledWith(2, {
      kind: 'execute',
      executable: 'node',
      args: ['app.js'],
    })
  })

  it('updates secret state without returning a history entry', async () => {
    const deps = dependencies('cloud-python')

    await expect(submitTerminalInput(
      'export OPENAI_API_KEY=sk-example-secret',
      deps,
    )).resolves.toBeUndefined()
    expect(deps.setEnvironment).toHaveBeenCalledWith(
      'OPENAI_API_KEY',
      'sk-example-secret',
      true,
    )
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('returns a trimmed, secret-redacted history entry for ordinary commands', async () => {
    const deps = {
      ...dependencies('cloud-python'),
      secrets: ['sk-example-secret'],
    }

    await expect(submitTerminalInput(
      '  python app.py --token sk-example-secret  ',
      deps,
    )).resolves.toBe('python app.py --token [REDACTED]')
  })
})

describe('isBrowserPackageIncompatibility', () => {
  it.each([
    'Can’t find a pure Python 3 wheel for package scipy',
    'No compatible wheel is available for Pyodide',
    'This package is not supported in Pyodide',
  ])('recognizes browser wheel errors in %j', (message) => {
    expect(isBrowserPackageIncompatibility(message)).toBe(true)
  })

  it('does not classify ordinary Python errors as package incompatibility', () => {
    expect(isBrowserPackageIncompatibility('NameError: name x is not defined')).toBe(false)
  })
})

describe('uniqueRuntimeName', () => {
  const store: FileStore = {
    files: { 'untitled.js': '', 'untitled_1.js': '', 'main.py': '' },
    order: ['main.py', 'untitled.js', 'untitled_1.js'],
    active: 'main.py',
  }

  it('suggests a JavaScript file in Cloud Node without colliding', () => {
    expect(uniqueRuntimeName(store, 'cloud-node')).toBe('untitled_2.js')
  })

  it('suggests a Python file in browser and cloud Python', () => {
    expect(uniqueRuntimeName(store, 'browser-python')).toBe('untitled.py')
    expect(uniqueRuntimeName(store, 'cloud-python')).toBe('untitled.py')
  })
})
