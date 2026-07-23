import { describe, expect, it, vi } from 'vitest'
import type { WorkerResponse } from './protocol'
import { installPackages } from './python.worker.install'

function setup() {
  const callKwargs = vi.fn().mockResolvedValue(undefined)
  const destroy = vi.fn()
  const micropip = { install: { callKwargs }, destroy }
  const py = {
    loadPackage: vi.fn().mockResolvedValue(undefined),
    pyimport: vi.fn(() => micropip),
  }
  const messages: WorkerResponse[] = []
  return {
    callKwargs,
    destroy,
    messages,
    micropip,
    post: (message: WorkerResponse) => messages.push(message),
    py,
  }
}

describe('worker package installation', () => {
  it('loads micropip, installs trimmed packages, reports success, and destroys its proxy', async () => {
    const harness = setup()

    await installPackages(
      harness.py,
      { type: 'install', id: 7, packages: [' numpy ', '', 'requests'] },
      harness.post,
    )

    expect(harness.py.loadPackage).toHaveBeenCalledWith('micropip')
    expect(harness.py.pyimport).toHaveBeenCalledWith('micropip')
    expect(harness.callKwargs).toHaveBeenCalledWith(
      ['numpy', 'requests'],
      { keep_going: true },
    )
    expect(harness.messages).toEqual([
      {
        kind: 'output',
        id: 7,
        stream: 'stdout',
        text: 'Installing numpy requests…\n',
      },
      {
        kind: 'output',
        id: 7,
        stream: 'stdout',
        text: 'Installed numpy requests\n',
      },
      { kind: 'done', id: 7, ok: true },
    ])
    expect(harness.destroy).toHaveBeenCalledOnce()
  })

  it('lets the worker report install errors and still destroys the micropip proxy', async () => {
    const harness = setup()
    harness.callKwargs.mockRejectedValue(new Error('wheel unavailable'))

    await expect(installPackages(
      harness.py,
      { type: 'install', id: 8, packages: ['native-wheel'] },
      harness.post,
    )).resolves.toBeUndefined()

    expect(harness.destroy).toHaveBeenCalledOnce()
    expect(harness.messages).toEqual([
      {
        kind: 'output',
        id: 8,
        stream: 'stdout',
        text: 'Installing native-wheel…\n',
      },
      {
        kind: 'output',
        id: 8,
        stream: 'stderr',
        text: 'wheel unavailable\n',
      },
      {
        kind: 'done',
        id: 8,
        ok: false,
        error: 'wheel unavailable',
      },
    ])
  })
})
