import { createHash, timingSafeEqual } from 'node:crypto'
import {
  DEFAULT_LIMITS,
  type CloudRuntime,
} from '../../src/lib/sandbox/protocol'

type RuntimeLimits = typeof DEFAULT_LIMITS

interface PublicRuntimeConfig {
  enabled: boolean
  reason?: string
  runtimes: readonly CloudRuntime[]
  allowByok: boolean
  limits: RuntimeLimits
}

export interface EnabledRuntimeConfig extends PublicRuntimeConfig {
  enabled: true
}

export interface DisabledRuntimeConfig extends PublicRuntimeConfig {
  enabled: false
  reason: string
  runtimes: readonly []
}

export interface SandboxCredentials {
  token: string
  teamId: string
  projectId: string
}

export interface PrivateRuntimeCredentials {
  sessionSecret: string
  accessToken: string
  sandboxCredentials?: SandboxCredentials
}

export type RuntimeConfig = EnabledRuntimeConfig | DisabledRuntimeConfig

const DISABLED_REASON = 'Set SANDBOX_ENABLED=true to enable cloud runtimes.'
export const SETUP_REQUIRED_REASON = 'Cloud runtimes require server setup.'
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

export function setupRequiredRuntimeConfig(): DisabledRuntimeConfig {
  return {
    enabled: false,
    reason: SETUP_REQUIRED_REASON,
    runtimes: [],
    allowByok: false,
    limits: DEFAULT_LIMITS,
  }
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeSessionSecret(secret: string | undefined): secret is string {
  if (!hasValue(secret) || secret.length < MINIMUM_SESSION_SECRET_LENGTH) return false

  const normalized = secret.toLowerCase()
  return !DEFAULT_SECRET_MARKERS.some((marker) => normalized.includes(marker))
}

function loadEnabledCredentials(
  env: Record<string, string | undefined>,
): PrivateRuntimeCredentials {
  const staticCredentialNames = [
    'VERCEL_TOKEN',
    'VERCEL_TEAM_ID',
    'VERCEL_PROJECT_ID',
  ] as const
  const suppliedStaticCredentials = staticCredentialNames.filter(
    (name) => hasValue(env[name]),
  )
  if (
    suppliedStaticCredentials.length > 0
    && suppliedStaticCredentials.length < staticCredentialNames.length
  ) {
    const missing = staticCredentialNames.filter((name) => !hasValue(env[name]))
    throw new Error(
      `Static Vercel authentication requires VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID together; missing: ${missing.join(', ')}.`,
    )
  }

  const hasStaticCredentials = suppliedStaticCredentials.length
    === staticCredentialNames.length
  if (
    !hasValue(env.VERCEL_OIDC_TOKEN)
    && env.VERCEL !== '1'
    && !hasStaticCredentials
  ) {
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

  const credentials: PrivateRuntimeCredentials = {
    sessionSecret,
    accessToken,
  }
  if (hasStaticCredentials) {
    credentials.sandboxCredentials = {
      token: env.VERCEL_TOKEN!,
      teamId: env.VERCEL_TEAM_ID!,
      projectId: env.VERCEL_PROJECT_ID!,
    }
  }

  return credentials
}

export function loadRuntimeConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  if (env.SANDBOX_ENABLED !== 'true') {
    return {
      enabled: false,
      reason: DISABLED_REASON,
      runtimes: [],
      allowByok: false,
      limits: DEFAULT_LIMITS,
    }
  }

  loadEnabledCredentials(env)

  return {
    enabled: true,
    runtimes: CLOUD_RUNTIMES,
    allowByok: env.PLAYGROUND_ALLOW_BYOK === 'true',
    limits: DEFAULT_LIMITS,
  }
}

export function loadRuntimeCredentials(
  env: Record<string, string | undefined>,
): PrivateRuntimeCredentials | undefined {
  if (env.SANDBOX_ENABLED !== 'true') return undefined
  return loadEnabledCredentials(env)
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function authorizeAccess(
  credentials: PrivateRuntimeCredentials | undefined,
  token: string | undefined,
): boolean {
  const expected = credentials?.accessToken ?? ''
  const supplied = typeof token === 'string' ? token : ''
  const matches = timingSafeEqual(digest(expected), digest(supplied))

  return credentials !== undefined
    && typeof token === 'string'
    && matches
}
