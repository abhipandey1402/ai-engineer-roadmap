import { afterEach, describe, expect, it, vi } from 'vitest'

const { providerConstructor } = vi.hoisted(() => ({
  providerConstructor: vi.fn(function MockVercelSandboxProvider() {}),
}))

vi.mock('./vercelProvider', () => ({
  VercelSandboxProvider: providerConstructor,
}))

const SESSION_SECRET = 'test-session-secret-with-at-least-32-characters'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  providerConstructor.mockClear()
})

describe('runtime singleton authentication wiring', () => {
  it('passes private static credentials to the provider', async () => {
    vi.stubEnv('SANDBOX_ENABLED', 'true')
    vi.stubEnv('VERCEL_TOKEN', 'vercel-token')
    vi.stubEnv('VERCEL_TEAM_ID', 'team-id')
    vi.stubEnv('VERCEL_PROJECT_ID', 'project-id')
    vi.stubEnv('PLAYGROUND_SESSION_SECRET', SESSION_SECRET)
    vi.stubEnv('PLAYGROUND_ACCESS_TOKEN', 'owner-access-token')

    await import('./singleton')

    expect(providerConstructor).toHaveBeenCalledWith(undefined, {
      credentials: {
        token: 'vercel-token',
        teamId: 'team-id',
        projectId: 'project-id',
      },
    })
  })

  it('passes no explicit credentials on the production OIDC path', async () => {
    vi.stubEnv('SANDBOX_ENABLED', 'true')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('PLAYGROUND_SESSION_SECRET', SESSION_SECRET)
    vi.stubEnv('PLAYGROUND_ACCESS_TOKEN', 'owner-access-token')

    await import('./singleton')

    expect(providerConstructor).toHaveBeenCalledWith()
  })
})
