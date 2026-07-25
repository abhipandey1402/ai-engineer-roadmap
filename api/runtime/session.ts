import { nodeHandler } from '../../server/sandbox/http.js'
import { runtimeApi } from '../../server/sandbox/singleton.js'

export default nodeHandler(
  (request) => runtimeApi.destroySession(request),
  ['DELETE'],
)
