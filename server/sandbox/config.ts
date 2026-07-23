import { createHash, timingSafeEqual } from 'node:crypto'
import {
  DEFAULT_LIMITS,
  type CloudRuntime,
} from '../../src/lib/sandbox/protocol'

type RuntimeLimits = typeof DEFAULT_LIMITS

interface RuntimeCapabilities {
  enabled: boolean
  reason?: string
  runtimes: readonly CloudRuntime[]
  allowByok: boolean
  limits: RuntimeLimits
}

export interface EnabledRuntimeCapabilities extends RuntimeCapabilities {
  enabled: true
}

export interface DisabledRuntimeCapabilities extends RuntimeCapabilities {
  enabled: false
  reason: string
  runtimes: readonly []
}

export type PublicRuntimeCapabilities =
  | EnabledRuntimeCapabilities
  | DisabledRuntimeCapabilities

export interface PrivateRuntimeCredentials {
  sessionSecret: string
  accessToken: string
}

export interface EnabledRuntimeConfig {
  capabilities: EnabledRuntimeCapabilities
  credentials: PrivateRuntimeCredentials
}

export interface DisabledRuntimeConfig {
  capabilities: DisabledRuntimeCapabilities
  credentials?: never
}

export type RuntimeConfig = EnabledRuntimeConfig | DisabledRuntimeConfig

const DISABLED_REASON = 'Set SANDBOX_ENABLED=true to enable cloud runtimes.'
const CLOUD_RUNTIMES = ['python', 'node'] as const satisfies readonly CloudRuntime[]
const MINIMUM_SESSION_SECRET_LENGTH = 32
const DEFAULT_SECRET_MARKERS = [
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
  'your-secret',
  'default',
  'example',
]

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeSessionSecret(secret: string | undefined): secret is string {
  if (!hasValue(secret) || secret.length < MINIMUM_SESSION_SECRET_LENGTH) return false

  const normalized = secret.toLowerCase()
  return !DEFAULT_SECRET_MARKERS.some((marker) => normalized.includes(marker))
}

export function loadRuntimeConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  if (env.SANDBOX_ENABLED !== 'true') {
    return {
      capabilities: {
        enabled: false,
        reason: DISABLED_REASON,
        runtimes: [],
        allowByok: false,
        limits: DEFAULT_LIMITS,
      },
    }
  }

  if (!hasValue(env.VERCEL_OIDC_TOKEN) && !hasValue(env.VERCEL_ACCESS_TOKEN)) {
    throw new Error('Vercel authentication is required to enable cloud runtimes.')
  }

  const sessionSecret = env.PLAYGROUND_SESSION_SECRET
  if (!isSafeSessionSecret(sessionSecret)) {
    throw new Error('A non-default session secret of at least 32 characters is required.')
  }

  const accessToken = env.PLAYGROUND_ACCESS_TOKEN
  if (!hasValue(accessToken)) {
    throw new Error('A playground access token is required to enable cloud runtimes.')
  }

  return {
    capabilities: {
      enabled: true,
      runtimes: CLOUD_RUNTIMES,
      allowByok: env.PLAYGROUND_ALLOW_BYOK === 'true',
      limits: DEFAULT_LIMITS,
    },
    credentials: {
      sessionSecret,
      accessToken,
    },
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function authorizeAccess(
  config: RuntimeConfig,
  token: string | undefined,
): boolean {
  const expected = config.credentials?.accessToken ?? ''
  const supplied = typeof token === 'string' ? token : ''
  const matches = timingSafeEqual(digest(expected), digest(supplied))

  return config.capabilities.enabled
    && config.credentials !== undefined
    && typeof token === 'string'
    && matches
}
