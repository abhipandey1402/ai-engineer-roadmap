import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { CloudRuntime } from '../../src/lib/sandbox/protocol'

export interface SessionPayload {
  name: string
  runtime: CloudRuntime
  expiresAt: number
}

export const SESSION_COOKIE_NAME = 'pathwise_runtime'
export const SESSION_COOKIE_MAX_AGE_SECONDS = 900

const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const MINIMUM_SECRET_LENGTH = 32
const TOKEN_PART = /^[A-Za-z0-9_-]+$/

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const payload = value as Record<string, unknown>
  return typeof payload.name === 'string'
    && payload.name.length > 0
    && (payload.runtime === 'python' || payload.runtime === 'node')
    && typeof payload.expiresAt === 'number'
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > 0
}

function encode(value: Buffer): string {
  return value.toString('base64url')
}

function decode(value: string): Buffer {
  if (!TOKEN_PART.test(value)) throw new Error('Invalid session')

  const decoded = Buffer.from(value, 'base64url')
  if (encode(decoded) !== value) throw new Error('Invalid session')
  return decoded
}

export async function sealSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error('Invalid session secret')
  }
  if (!isSessionPayload(payload)) throw new Error('Invalid session payload')

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${encode(iv)}.${encode(ciphertext)}.${encode(tag)}`
}

export async function openSession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload> {
  let payload: unknown

  try {
    if (secret.length < MINIMUM_SECRET_LENGTH) throw new Error('Invalid session')

    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid session')

    const [ivPart, ciphertextPart, tagPart] = parts
    const iv = decode(ivPart)
    const ciphertext = decode(ciphertextPart)
    const tag = decode(tagPart)
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== AUTH_TAG_BYTES) {
      throw new Error('Invalid session')
    }

    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    payload = JSON.parse(plaintext.toString('utf8')) as unknown
    if (!isSessionPayload(payload)) throw new Error('Invalid session')
  } catch {
    throw new Error('Invalid session')
  }

  if (payload.expiresAt <= now) throw new Error('Session expired')
  return payload
}

export function serializeSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/api/runtime; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/api/runtime; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue

    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name === SESSION_COOKIE_NAME && value.length > 0) return value
  }

  return undefined
}
