import {
  loadRuntimeConfig,
  loadRuntimeCredentials,
} from './config'
import { RuntimeApi } from './runtimeApi'
import { VercelSandboxProvider } from './vercelProvider'

const environment = process.env

export const runtimeApi = new RuntimeApi({
  config: loadRuntimeConfig(environment),
  credentials: loadRuntimeCredentials(environment),
  provider: new VercelSandboxProvider(),
})
