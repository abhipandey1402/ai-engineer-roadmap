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

    const { runtimeApi } = await import('./singleton')
    expect(providerConstructor).not.toHaveBeenCalled()

    await runtimeApi.createSession({
      method: 'POST',
      headers: { 'x-playground-access': 'owner-access-token' },
      body: { runtime: 'python' },
    })

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

    const { runtimeApi } = await import('./singleton')
    expect(providerConstructor).not.toHaveBeenCalled()

    await runtimeApi.createSession({
      method: 'POST',
      headers: { 'x-playground-access': 'owner-access-token' },
      body: { runtime: 'python' },
    })

    expect(providerConstructor).toHaveBeenCalledWith()
  })

  it('does not import the sandbox provider for capabilities when disabled', async () => {
    vi.stubEnv('SANDBOX_ENABLED', 'false')

    const { runtimeApi } = await import('./singleton')
    const capabilities = await runtimeApi.capabilities({
      method: 'GET',
      headers: {},
    })

    expect(capabilities.status).toBe(200)
    expect(capabilities.body).toMatchObject({
      enabled: false,
      runtimes: [],
      allowByok: false,
    })
    expect(providerConstructor).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'partial static authentication',
      env: {
        VERCEL_TOKEN: 'private-vercel-token',
        PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
        PLAYGROUND_ACCESS_TOKEN: 'private-owner-token',
      },
    },
    {
      name: 'missing session secret',
      env: {
        VERCEL_OIDC_TOKEN: 'private-oidc-token',
        PLAYGROUND_ACCESS_TOKEN: 'private-owner-token',
      },
    },
    {
      name: 'missing access token',
      env: {
        VERCEL_OIDC_TOKEN: 'private-oidc-token',
        PLAYGROUND_SESSION_SECRET: SESSION_SECRET,
      },
    },
  ])('keeps handlers importable with $name', async ({ env }) => {
    vi.stubEnv('SANDBOX_ENABLED', 'true')
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

    const { runtimeApi } = await import('./singleton')
    const capabilities = await runtimeApi.capabilities({
      method: 'GET',
      headers: {},
    })
    const create = await runtimeApi.createSession({
      method: 'POST',
      headers: { 'x-playground-access': 'private-owner-token' },
      body: { runtime: 'python' },
    })

    expect(capabilities.status).toBe(200)
    expect(capabilities.body).toMatchObject({
      enabled: false,
      runtimes: [],
      allowByok: false,
      reason: 'Cloud runtimes require server setup.',
    })
    expect(create.status).toBe(503)
    expect(create.body).toEqual({
      error: {
        code: 'CLOUD_DISABLED',
        message: 'Cloud runtimes require server setup.',
      },
    })
    expect(providerConstructor).not.toHaveBeenCalled()

    const publicResponse = JSON.stringify({ capabilities, create })
    for (const value of Object.values(env)) {
      expect(publicResponse).not.toContain(value)
    }
  })
})
