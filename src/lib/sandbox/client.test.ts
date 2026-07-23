import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeClientError,
  SandboxClient,
  type CommandResult,
  type RuntimeCapabilities,
} from './client'
import { DEFAULT_LIMITS, type ExecuteCommand } from './protocol'

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function setup(responses: Response[], idempotencyKey = 'request-key') {
  const fetch = vi.fn<typeof globalThis.fetch>()
  for (const response of responses) fetch.mockResolvedValueOnce(response)
  return {
    fetch,
    client: new SandboxClient(fetch, () => idempotencyKey),
  }
}

const capabilities: RuntimeCapabilities = {
  enabled: true,
  runtimes: ['python', 'node'],
  allowByok: true,
  limits: DEFAULT_LIMITS,
}

const command: ExecuteCommand = {
  kind: 'execute',
  executable: 'python',
  args: ['main.py'],
}

describe('SandboxClient', () => {
  it('fetches public capabilities with same-origin credentials', async () => {
    const { client, fetch } = setup([jsonResponse(capabilities)])

    await expect(client.capabilities()).resolves.toEqual(capabilities)
    expect(fetch).toHaveBeenCalledWith('/api/runtime/capabilities', {
      credentials: 'same-origin',
    })
  })

  it('creates a cloud session using only the access header and cookie credentials', async () => {
    const { client, fetch } = setup([jsonResponse({ runtime: 'python' }, { status: 201 })])

    await expect(client.create('python', 'owner-token')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/runtime/sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Playground-Access': 'owner-token',
      },
      body: JSON.stringify({ runtime: 'python' }),
    })
  })

  it('synchronizes the complete project file set', async () => {
    const { client, fetch } = setup([new Response(null, { status: 204 })])
    const files = [{ path: 'main.py', content: 'print("hi")' }]

    await expect(client.syncFiles(files, 'owner-token')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/runtime/files', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Playground-Access': 'owner-token',
      },
      body: JSON.stringify({ files }),
    })
  })

  it('runs a command with an idempotency key and returns sequence-ordered output', async () => {
    const result: CommandResult = {
      idempotencyKey: 'request-key',
      exitCode: 0,
      output: [
        { sequence: 2, stream: 'stderr', text: 'third' },
        { sequence: 0, stream: 'stdout', text: 'first' },
        { sequence: 1, stream: 'stdout', text: 'second' },
      ],
    }
    const response = jsonResponse(result, {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-key',
      },
    })
    const { client, fetch } = setup([response])

    await expect(client.run(
      command,
      { OPENAI_API_KEY: 'environment-secret' },
      ['OPENAI_API_KEY'],
      'owner-token',
      undefined,
    )).resolves.toEqual({
      ...result,
      output: [
        { sequence: 0, stream: 'stdout', text: 'first' },
        { sequence: 1, stream: 'stdout', text: 'second' },
        { sequence: 2, stream: 'stderr', text: 'third' },
      ],
    })
    expect(fetch).toHaveBeenCalledWith('/api/runtime/commands', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-key',
        'X-Playground-Access': 'owner-token',
      },
      body: JSON.stringify({
        command,
        environment: { OPENAI_API_KEY: 'environment-secret' },
        secretNames: ['OPENAI_API_KEY'],
      }),
      signal: undefined,
    })
  })

  it('rejects a command response with a mismatched idempotency echo', async () => {
    const response = jsonResponse({
      idempotencyKey: 'other-key',
      exitCode: 0,
      output: [],
    }, {
      headers: { 'Idempotency-Key': 'other-key' },
    })
    const { client } = setup([response])

    await expect(client.run(
      command,
      {},
      [],
      'owner-token',
      undefined,
    )).rejects.toMatchObject({
      name: 'RuntimeClientError',
      code: 'INVALID_RESPONSE',
    })
  })

  it('normalizes API errors without exposing access or environment values', async () => {
    const { client } = setup([jsonResponse({
      error: {
        code: 'ACCESS_DENIED',
        message: 'The playground access token is invalid.',
      },
    }, { status: 401 })])

    const rejection = client.run(
      command,
      { API_KEY: 'environment-secret' },
      ['API_KEY'],
      'owner-token',
      undefined,
    )
    await expect(rejection).rejects.toEqual(expect.any(RuntimeClientError))
    await expect(rejection).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      message: 'The playground access token is invalid.',
      status: 401,
    })
    await expect(rejection).rejects.not.toThrow(/owner-token|environment-secret/)
  })

  it('redacts submitted credentials if an upstream error message echoes them', async () => {
    const { client } = setup([jsonResponse({
      error: {
        code: 'COMMAND_REJECTED',
        message: 'Rejected owner-token and environment-secret.',
      },
    }, { status: 400 })])

    const rejection = client.run(
      command,
      { API_KEY: 'environment-secret' },
      ['API_KEY'],
      'owner-token',
    )

    await expect(rejection).rejects.toMatchObject({
      code: 'COMMAND_REJECTED',
      message: 'Rejected [REDACTED] and [REDACTED].',
    })
  })

  it('uses a safe stable error for malformed error responses', async () => {
    const { client } = setup([
      new Response('upstream leaked owner-token', { status: 502 }),
    ])

    await expect(client.create('python', 'owner-token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'The runtime service returned an invalid response.',
      status: 502,
    })
  })

  it('stops and destroys idempotently through their public endpoints', async () => {
    const { client, fetch } = setup([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ])

    await client.stop('owner-token')
    await client.destroy('owner-token')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/runtime/stop', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Playground-Access': 'owner-token' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/runtime/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-Playground-Access': 'owner-token' },
    })
  })

  it('forwards AbortController cancellation to command fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    ))
    const client = new SandboxClient(fetch, () => 'request-key')
    const controller = new AbortController()
    const pending = client.run(
      command,
      {},
      [],
      'owner-token',
      controller.signal,
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \t '],
    ['NUL-containing', 'request\0key'],
    ['carriage-return-containing', 'request\rkey'],
    ['line-feed-containing', 'request\nkey'],
    ['over 256 UTF-8 bytes', 'é'.repeat(129)],
  ])('rejects a %s generated idempotency key before fetch', async (
    _description,
    idempotencyKey,
  ) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = new SandboxClient(fetch, () => idempotencyKey)

    const rejection = client.run(
      {
        kind: 'execute',
        executable: 'python',
        args: ['secret-argument'],
      },
      { API_KEY: 'environment-secret' },
      ['API_KEY'],
      'owner-token',
    )

    await expect(rejection).rejects.toMatchObject({
      name: 'RuntimeClientError',
      code: 'COMMAND_REJECTED',
      status: 0,
    })
    await expect(rejection).rejects.not.toThrow(
      /secret-argument|environment-secret|owner-token/,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a repeated generated idempotency key before a second fetch', async () => {
    const firstResult = resultForKey('repeated-key')
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(responseForResult(firstResult))
    const client = new SandboxClient(fetch, () => 'repeated-key')

    await expect(client.run(
      command,
      {},
      [],
      'owner-token',
    )).resolves.toEqual(firstResult)
    await expect(client.run(
      command,
      {},
      [],
      'owner-token',
    )).rejects.toMatchObject({
      name: 'RuntimeClientError',
      code: 'COMMAND_REJECTED',
      status: 0,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts unique valid generated idempotency keys', async () => {
    const keys = ['unique-key-1', 'unique-key-2']
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(responseForResult(resultForKey(keys[0])))
      .mockResolvedValueOnce(responseForResult(resultForKey(keys[1])))
    const client = new SandboxClient(fetch, () => {
      const key = keys.shift()
      if (!key) throw new Error('Unexpected key request')
      return key
    })

    await expect(client.run(
      command,
      {},
      [],
      'owner-token',
    )).resolves.toMatchObject({ idempotencyKey: 'unique-key-1' })
    await expect(client.run(
      command,
      {},
      [],
      'owner-token',
    )).resolves.toMatchObject({ idempotencyKey: 'unique-key-2' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

function resultForKey(idempotencyKey: string): CommandResult {
  return { idempotencyKey, exitCode: 0, output: [] }
}

function responseForResult(result: CommandResult): Response {
  return jsonResponse(result, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': result.idempotencyKey,
    },
  })
}
