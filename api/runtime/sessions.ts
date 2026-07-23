import { nodeHandler } from '../../server/sandbox/http'
import { runtimeApi } from '../../server/sandbox/singleton'

export default nodeHandler(
  (request) => runtimeApi.createSession(request),
  ['POST'],
)
