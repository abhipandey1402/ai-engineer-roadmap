import { describe, expect, it, vi } from 'vitest'
import type { ExecuteCommand, ProjectFile } from '../../lib/sandbox/protocol'
import {
  buildCloudEnvironment,
  consumeCloudHandoff,
  getEnvironmentPresentation,
  runCloudProject,
} from './playgroundIntegration'

describe('getEnvironmentPresentation', () => {
  it('always presents access-token entry independently of BYOK', () => {
    expect(getEnvironmentPresentation(false)).toMatchObject({
      showAccessToken: true,
      allowSecrets: false,
    })
    expect(getEnvironmentPresentation(true)).toMatchObject({
      showAccessToken: true,
      allowSecrets: true,
    })
  })

  it('explains that owner-provided secrets are unavailable when BYOK is off', () => {
    expect(getEnvironmentPresentation(false).secretNotice)
      .toContain('Owner-provided secrets are disabled')
  })
})

describe('buildCloudEnvironment', () => {
  const entries = [
    { id: 1, name: 'MODE', value: 'test', secret: false },
    { id: 2, name: 'OPENAI_API_KEY', value: 'sk-secret', secret: true },
  ]

  it('keeps ordinary variables but excludes secret rows when BYOK is off', () => {
    expect(buildCloudEnvironment(entries, false)).toEqual({
      environment: { MODE: 'test' },
      secretNames: [],
    })
  })

  it('includes opted-in secret rows and names when BYOK is on', () => {
    expect(buildCloudEnvironment(entries, true)).toEqual({
      environment: {
        MODE: 'test',
        OPENAI_API_KEY: 'sk-secret',
      },
      secretNames: ['OPENAI_API_KEY'],
    })
  })
})

describe('consumeCloudHandoff', () => {
  it('removes the one-time value as part of consuming it', () => {
    const calls: string[] = []
    const storage = {
      getItem: vi.fn(() => {
        calls.push('get')
        return 'print("handoff")'
      }),
      removeItem: vi.fn(() => {
        calls.push('remove')
      }),
    }

    expect(consumeCloudHandoff(storage)).toBe('print("handoff")')
    expect(calls).toEqual(['get', 'remove'])
  })
})

describe('runCloudProject', () => {
  const files: ProjectFile[] = [{ path: 'main.py', content: 'print("hi")' }]
  const command: ExecuteCommand = {
    kind: 'execute',
    executable: 'python',
    args: ['main.py'],
  }

  it('does not run a command after file synchronization fails', async () => {
    const runCommand = vi.fn()

    await expect(runCloudProject({
      files,
      command,
      runFiles: vi.fn().mockResolvedValue(false),
      runCommand,
      busy: { current: false },
      onSyncingChange: vi.fn(),
    })).resolves.toBe(false)

    expect(runCommand).not.toHaveBeenCalled()
  })

  it('keeps the operation busy through sync and command and rejects a duplicate run', async () => {
    let finishSync!: (success: boolean) => void
    const events: string[] = []
    const busy = { current: false }
    const runFiles = vi.fn(() => new Promise<boolean>((resolve) => {
      events.push('sync:start')
      finishSync = resolve
    }))
    const runCommand = vi.fn(async () => {
      events.push('command')
    })
    const onSyncingChange = vi.fn((syncing: boolean) => {
      events.push(syncing ? 'busy:on' : 'busy:off')
    })
    const dependencies = {
      files,
      command,
      runFiles,
      runCommand,
      busy,
      onSyncingChange,
    }

    const first = runCloudProject(dependencies)
    await expect(runCloudProject(dependencies)).resolves.toBe(false)
    finishSync(true)
    await expect(first).resolves.toBe(true)

    expect(events).toEqual(['busy:on', 'sync:start', 'busy:off', 'command'])
    expect(runFiles).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(busy.current).toBe(false)
  })

  it('clears busy state when synchronization rejects', async () => {
    const busy = { current: false }
    const onSyncingChange = vi.fn()

    await expect(runCloudProject({
      files,
      command,
      runFiles: vi.fn().mockRejectedValue(new Error('sync exploded')),
      runCommand: vi.fn(),
      busy,
      onSyncingChange,
    })).rejects.toThrow('sync exploded')

    expect(onSyncingChange).toHaveBeenNthCalledWith(1, true)
    expect(onSyncingChange).toHaveBeenLastCalledWith(false)
    expect(busy.current).toBe(false)
  })
})
