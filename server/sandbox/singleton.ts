import {
  loadRuntimeConfig,
  loadRuntimeCredentials,
  setupRequiredRuntimeConfig,
  type PrivateRuntimeCredentials,
  type RuntimeConfig,
} from './config'
import { RuntimeApi } from './runtimeApi'
import { VercelSandboxProvider } from './vercelProvider'

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
const provider = credentials?.sandboxCredentials
  ? new VercelSandboxProvider(undefined, {
      credentials: credentials.sandboxCredentials,
    })
  : new VercelSandboxProvider()

export const runtimeApi = new RuntimeApi({
  config,
  credentials,
  provider,
})
