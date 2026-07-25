import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  RuntimeRequest,
  RuntimeResponse,
} from './runtimeApi.js'

const MAX_BODY_BYTES = 1_000_000

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false

    request.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > MAX_BODY_BYTES) {
        settled = true
        reject(new Error('Request body is too large'))
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      const body = Buffer.concat(chunks).toString('utf8')
      if (body.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(body) as unknown)
      } catch {
        reject(new Error('Invalid JSON request body'))
      }
    })
    request.on('error', () => {
      if (settled) return
      settled = true
      reject(new Error('Unable to read request body'))
    })
  })
}

function normalizeHeaders(
  headers: IncomingMessage['headers'],
): RuntimeRequest['headers'] {
  const normalized: RuntimeRequest['headers'] = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') normalized[name.toLowerCase()] = value
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(', ')
  }
  return normalized
}

function writeResponse(
  response: ServerResponse,
  runtimeResponse: RuntimeResponse,
): void {
  response.statusCode = runtimeResponse.status
  response.setHeader('Content-Type', 'application/json')
  for (const [name, value] of Object.entries(runtimeResponse.headers ?? {})) {
    response.setHeader(name, value)
  }
  response.end(
    runtimeResponse.body === undefined
      ? ''
      : JSON.stringify(runtimeResponse.body),
  )
}

type RuntimeHandler = (request: RuntimeRequest) => Promise<RuntimeResponse>

export function nodeHandler(
  runtimeHandler: RuntimeHandler,
  allowedMethods: readonly string[],
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const method = request.method ?? ''
    if (!allowedMethods.includes(method)) {
      writeResponse(response, {
        status: 405,
        headers: { Allow: allowedMethods.join(', ') },
        body: {
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'The request method is not supported.',
          },
        },
      })
      return
    }

    try {
      const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE'
      const body = hasBody ? await readJsonBody(request) : undefined
      const runtimeResponse = await runtimeHandler({
        method,
        headers: normalizeHeaders(request.headers),
        body,
      })
      writeResponse(response, runtimeResponse)
    } catch (caught) {
      const requestError = caught instanceof Error
        && (
          caught.message === 'Request body is too large'
          || caught.message === 'Invalid JSON request body'
        )
      writeResponse(response, requestError
        ? {
            status: caught.message === 'Request body is too large' ? 413 : 400,
            body: {
              error: {
                code: 'INVALID_REQUEST',
                message: caught.message,
              },
            },
          }
        : {
            status: 500,
            body: {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'The request could not be completed.',
              },
            },
          })
    }
  }
}
