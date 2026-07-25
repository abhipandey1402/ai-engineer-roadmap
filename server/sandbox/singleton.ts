import {
  loadRuntimeConfig,
  loadRuntimeCredentials,
  setupRequiredRuntimeConfig,
  type PrivateRuntimeCredentials,
  type RuntimeConfig,
} from './config.js'
import type { SandboxProvider } from './provider.js'
import { RuntimeApi } from './runtimeApi.js'

class LazyVercelSandboxProvider implements SandboxProvider {
  private provider: Promise<SandboxProvider> | undefined

  constructor(
    private readonly credentials:
      | PrivateRuntimeCredentials['sandboxCredentials']
      | undefined,
  ) {}

  private async loadProvider(): Promise<SandboxProvider> {
    if (!this.provider) {
      this.provider = import('./vercelProvider.js').then(({ VercelSandboxProvider }) => (
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
} catch (caught) {
  // Keep the public setup endpoint available when an enabled deployment is
  // incomplete. Execution remains disabled, and no operator details leak.
  // Operator-only diagnostic (server logs, never the public response): report
  // which credential check failed and whether each variable is present, using
  // booleans and lengths so no secret value is ever logged.
  console.error('[runtime-setup] cloud runtimes disabled:', {
    reason: caught instanceof Error ? caught.message : String(caught),
    SANDBOX_ENABLED: environment.SANDBOX_ENABLED,
    hasSessionSecret: Boolean(environment.PLAYGROUND_SESSION_SECRET?.trim()),
    sessionSecretLength: environment.PLAYGROUND_SESSION_SECRET?.length ?? 0,
    hasAccessToken: Boolean(environment.PLAYGROUND_ACCESS_TOKEN?.trim()),
    VERCEL: environment.VERCEL,
    hasOidcToken: Boolean(environment.VERCEL_OIDC_TOKEN?.trim()),
    staticCreds: {
      VERCEL_TOKEN: Boolean(environment.VERCEL_TOKEN?.trim()),
      VERCEL_TEAM_ID: Boolean(environment.VERCEL_TEAM_ID?.trim()),
      VERCEL_PROJECT_ID: Boolean(environment.VERCEL_PROJECT_ID?.trim()),
    },
  })
  config = setupRequiredRuntimeConfig()
  credentials = undefined
}
const provider = new LazyVercelSandboxProvider(credentials?.sandboxCredentials)

export const runtimeApi = new RuntimeApi({
  config,
  credentials,
  provider,
})
