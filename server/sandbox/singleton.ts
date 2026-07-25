import {
  loadRuntimeConfig,
  loadRuntimeCredentials,
  setupRequiredRuntimeConfig,
  type PrivateRuntimeCredentials,
  type RuntimeConfig,
} from './config'
import type { SandboxProvider } from './provider'
import { RuntimeApi } from './runtimeApi'

class LazyVercelSandboxProvider implements SandboxProvider {
  private provider: Promise<SandboxProvider> | undefined

  constructor(
    private readonly credentials:
      | PrivateRuntimeCredentials['sandboxCredentials']
      | undefined,
  ) {}

  private async loadProvider(): Promise<SandboxProvider> {
    if (!this.provider) {
      this.provider = import('./vercelProvider').then(({ VercelSandboxProvider }) => (
        this.credentials
          ? new VercelSandboxProvider(undefined, { credentials: this.credentials })
          : new VercelSandboxProvider()
      ))
    }
    return this.provider
  }

  async create(...args: Parameters<SandboxProvider['create']>) {
    return await (await this.loadProvider()).create(...args)
  }

  async get(...args: Parameters<SandboxProvider['get']>) {
    return await (await this.loadProvider()).get(...args)
  }
}

const environment = process.env
let config: RuntimeConfig
let credentials: PrivateRuntimeCredentials | undefined
try {
  config = loadRuntimeConfig(environment)
  credentials = loadRuntimeCredentials(environment)
} catch {
  // Keep the public setup endpoint available when an enabled deployment is
  // incomplete. Execution remains disabled, and no operator details leak.
  config = setupRequiredRuntimeConfig()
  credentials = undefined
}
const provider = new LazyVercelSandboxProvider(credentials?.sandboxCredentials)

export const runtimeApi = new RuntimeApi({
  config,
  credentials,
  provider,
})
