import type { WorkerRequest, WorkerResponse } from './protocol'

interface InstallPyodide {
  loadPackage(name: string): Promise<unknown>
  pyimport(name: string): unknown
}

interface MicropipProxy {
  install: {
    callKwargs(
      packages: string[],
      options: { keep_going: boolean },
    ): Promise<unknown>
  }
  destroy(): void
}

type InstallRequest = Extract<WorkerRequest, { type: 'install' }>

export async function installPackages(
  py: InstallPyodide,
  req: InstallRequest,
  post: (message: WorkerResponse) => void,
): Promise<void> {
  let micropip: MicropipProxy | undefined
  try {
    const packages = req.packages.map((value) => value.trim()).filter(Boolean)
    if (packages.length === 0) {
      throw new Error('Enter at least one package to install.')
    }

    await py.loadPackage('micropip')
    micropip = py.pyimport('micropip') as MicropipProxy
    post({
      kind: 'output',
      id: req.id,
      stream: 'stdout',
      text: `Installing ${packages.join(' ')}…\n`,
    })
    await micropip.install.callKwargs(packages, { keep_going: true })
    post({
      kind: 'output',
      id: req.id,
      stream: 'stdout',
      text: `Installed ${packages.join(' ')}\n`,
    })
    post({ kind: 'done', id: req.id, ok: true })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    post({
      kind: 'output',
      id: req.id,
      stream: 'stderr',
      text: message.endsWith('\n') ? message : `${message}\n`,
    })
    post({ kind: 'done', id: req.id, ok: false, error: message })
  } finally {
    micropip?.destroy()
  }
}
