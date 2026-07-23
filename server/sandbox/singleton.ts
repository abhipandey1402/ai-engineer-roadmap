import {
  loadRuntimeConfig,
  loadRuntimeCredentials,
} from './config'
import { RuntimeApi } from './runtimeApi'
import { VercelSandboxProvider } from './vercelProvider'

const environment = process.env
const credentials = loadRuntimeCredentials(environment)
const provider = credentials?.sandboxCredentials
  ? new VercelSandboxProvider(undefined, {
      credentials: credentials.sandboxCredentials,
    })
  : new VercelSandboxProvider()

export const runtimeApi = new RuntimeApi({
  config: loadRuntimeConfig(environment),
  credentials,
  provider,
})
