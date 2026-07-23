import { describe, expect, it } from 'vitest'
import {
  openSession,
  parseSessionCookie,
  sealSession,
  serializeSessionCookie,
  type SessionPayload,
} from './session'

const TEST_SECRET = 'test-session-secret-with-at-least-32-characters'
const WRONG_SECRET = 'wrong-session-secret-with-at-least-32-characters'

describe('sealed sessions', () => {
  it('round-trips an authenticated session payload', async () => {
    const token = await sealSession(
      { name: 'pathwise-test', runtime: 'python', expiresAt: 2_000_000_000_000 },
      TEST_SECRET,
    )

    await expect(openSession(token, TEST_SECRET)).resolves.toMatchObject({
      name: 'pathwise-test',
      runtime: 'python',
    })
  })

  it('rejects a tampered token', async () => {
    const token = await sealSession(
      { name: 'pathwise-test', runtime: 'python', expiresAt: 2_000_000_000_000 },
      TEST_SECRET,
    )

    await expect(openSession(`${token}x`, TEST_SECRET)).rejects.toThrow('Invalid session')
  })

  it('rejects a token opened with the wrong secret', async () => {
    const token = await sealSession(
      { name: 'pathwise-test', runtime: 'node', expiresAt: 2_000_000_000_000 },
      TEST_SECRET,
    )

    await expect(openSession(token, WRONG_SECRET)).rejects.toThrow('Invalid session')
  })

  it('rejects an expired session', async () => {
    const token = await sealSession(
      { name: 'pathwise-test', runtime: 'python', expiresAt: 1 },
      TEST_SECRET,
    )

    await expect(openSession(token, TEST_SECRET)).rejects.toThrow('Session expired')
  })

  it('rejects runtimes outside the cloud allowlist', async () => {
    const invalidPayload = {
      name: 'pathwise-test',
      runtime: 'browser-python',
      expiresAt: 2_000_000_000_000,
    } as unknown as SessionPayload

    await expect(sealSession(invalidPayload, TEST_SECRET)).rejects.toThrow('Invalid session')
  })

  it('uses a fresh 96-bit IV for each token', async () => {
    const payload: SessionPayload = {
      name: 'pathwise-test',
      runtime: 'python',
      expiresAt: 2_000_000_000_000,
    }

    const first = await sealSession(payload, TEST_SECRET)
    const second = await sealSession(payload, TEST_SECRET)

    expect(first).not.toBe(second)
    expect(first.split('.')[0]).toHaveLength(16)
    expect(first.split('.')).toHaveLength(3)
  })
})

describe('session cookies', () => {
  it('serializes a locked-down runtime cookie', () => {
    expect(serializeSessionCookie('sealed')).toBe(
      'pathwise_runtime=sealed; Path=/api/runtime; HttpOnly; Secure; SameSite=Strict; Max-Age=900',
    )
  })

  it('parses the runtime cookie among other cookies', () => {
    expect(parseSessionCookie(
      'theme=dark; pathwise_runtime=iv.ciphertext.tag; preference=compact',
    )).toBe('iv.ciphertext.tag')
  })

  it('returns undefined for an absent or malformed runtime cookie', () => {
    expect(parseSessionCookie(undefined)).toBeUndefined()
    expect(parseSessionCookie('theme=dark; pathwise_runtime')).toBeUndefined()
  })
})
