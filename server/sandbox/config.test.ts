import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS } from '../../src/lib/sandbox/protocol'
import {
  authorizeAccess,
  loadRuntimeConfig,
  loadRuntimeCredentials,
} from './config'

const SESSION_SECRET = 'test-session-secret-with-at-least-32-characters'

describe('loadRuntimeConfig', () => {
  it('disables cloud runtimes by default', () => {
    expect(loadRuntimeConfig({})).toEqual({
      enabled: false,
      reason: 'Set SANDBOX_ENABLED=true to enable cloud runtimes.',
      runtimes: [],
      allowByok: false,
      limits: DEFAULT_LIMITS,
    })
  })

  it('returns only serializable public capabilities when enabled', () => {
    const env = {
      SANDBOX_ENABLED: 'true',
      VERCEL_OIDC_TOKEN: 'oidc-token',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
      PLAYGROUND_ALLOW_BYOK: 'true',
    }
    const config = loadRuntimeConfig(env)

    expect(config).toEqual({
      enabled: true,
      runtimes: ['python', 'node'],
      allowByok: true,
      limits: DEFAULT_LIMITS,
    })

    const serializedConfig = JSON.stringify(config)
    expect(serializedConfig).not.toContain(SESSION_SECRET)
    expect(serializedConfig).not.toContain('owner-access-token')
  })

  it('loads private credentials separately only for valid enablement', () => {
    expect(loadRuntimeCredentials({})).toBeUndefined()
    expect(loadRuntimeCredentials({
      SANDBOX_ENABLED: 'true',
      VERCEL_OIDC_TOKEN: 'oidc-token',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
    })).toEqual({
      sessionSecret: SESSION_SECRET,
      accessToken: 'owner-access-token',
    })
    expect(() => loadRuntimeCredentials({
      SANDBOX_ENABLED: 'true',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
    })).toThrow('Vercel authentication')
  })

  it('accepts a Vercel access token instead of OIDC authentication', () => {
    expect(loadRuntimeConfig({
      SANDBOX_ENABLED: 'true',
      VERCEL_ACCESS_TOKEN: 'vercel-access-token',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
    }).enabled).toBe(true)
  })

  it('enables BYOK only for the exact value true', () => {
    expect(loadRuntimeConfig({
      SANDBOX_ENABLED: 'true',
      VERCEL_OIDC_TOKEN: 'oidc-token',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
      PLAYGROUND_ALLOW_BYOK: 'TRUE',
    }).allowByok).toBe(false)
  })

  it('rejects enabled configuration without Vercel authentication', () => {
    expect(() => loadRuntimeConfig({
      SANDBOX_ENABLED: 'true',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
    })).toThrow('Vercel authentication')
  })

  it.each([
    'too-short',
    'change-me-change-me-change-me-change-me',
  ])('rejects an unsafe session secret %j', (sessionSecret) => {
    expect(() => loadRuntimeConfig({
      SANDBOX_ENABLED: 'true',
      VERCEL_OIDC_TOKEN: 'oidc-token',
      PLAYGROUND_SESSION_SECRET: sessionSecret,
      PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
    })).toThrow('session secret')
  })

  it('rejects enabled configuration without an access token', () => {
    expect(() => loadRuntimeConfig({
      SANDBOX_ENABLED: 'true',
      VERCEL_OIDC_TOKEN: 'oidc-token',
      PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
    })).toThrow('access token')
  })
})

describe('authorizeAccess', () => {
  const env = {
    SANDBOX_ENABLED: 'true',
    VERCEL_OIDC_TOKEN: 'oidc-token',
    PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
    PLAYGROUND_ACCESS_TOKEN: 'owner-access-token',
  }

  it('authorizes the configured access token', () => {
    expect(authorizeAccess(
      loadRuntimeCredentials(env),
      'owner-access-token',
    )).toBe(true)
  })

  it.each([
    undefined,
    '',
    'incorrect',
    'owner-access-token-with-a-different-length',
  ])('rejects an incorrect access token %j', (token) => {
    expect(authorizeAccess(loadRuntimeCredentials(env), token)).toBe(false)
  })

  it('rejects access when cloud runtimes are disabled', () => {
    expect(authorizeAccess(loadRuntimeCredentials({}), 'anything')).toBe(false)
  })
})
