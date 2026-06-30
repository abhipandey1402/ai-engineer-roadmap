import { describe, it, expect } from 'vitest'
import { PythonClient } from './client'
import type { WorkerResponse } from './protocol'

interface PostedMsg {
  id: number
  type?: string
}

/** Stand-in for the Pyodide Worker: records postMessage calls and lets a test
    drive responses back through the onmessage handler the client installs. */
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  posted: PostedMsg[] = []
  terminated = false

  postMessage(msg: PostedMsg) {
    this.posted.push(msg)
  }
  terminate() {
    this.terminated = true
  }
  emit(res: WorkerResponse) {
    this.onmessage?.({ data: res } as unknown as MessageEvent)
  }
  last(): PostedMsg {
    return this.posted[this.posted.length - 1]
  }
}

function setup() {
  const mock = new MockWorker()
  const client = new PythonClient(() => mock as unknown as Worker)
  return { mock, client }
}

describe('PythonClient', () => {
  it('correlates a run response by id', async () => {
    const { mock, client } = setup()
    const p = client.run('print(1)')
    mock.emit({ kind: 'done', id: mock.last().id, ok: true })
    await expect(p).resolves.toMatchObject({ ok: true })
  })

  it('routes streamed output to the run that started it', async () => {
    const { mock, client } = setup()
    const chunks: string[] = []
    const p = client.run('x', (c) => chunks.push(c.text))
    const id = mock.last().id
    mock.emit({ kind: 'output', id, stream: 'stdout', text: 'hi\n' })
    mock.emit({ kind: 'done', id, ok: true })
    await p
    expect(chunks).toEqual(['hi\n'])
  })

  it('drops output addressed to an unknown id', () => {
    const { mock, client } = setup()
    const chunks: string[] = []
    void client.run('x', (c) => chunks.push(c.text))
    mock.emit({ kind: 'output', id: 9999, stream: 'stdout', text: 'nope' })
    expect(chunks).toEqual([])
  })

  it('resolves repl with the result repr', async () => {
    const { mock, client } = setup()
    const p = client.repl('1+1')
    mock.emit({ kind: 'done', id: mock.last().id, ok: true, result: '2' })
    await expect(p).resolves.toMatchObject({ ok: true, result: '2' })
  })

  it('returns the raw value for listFiles', async () => {
    const { mock, client } = setup()
    const p = client.listFiles()
    mock.emit({ kind: 'value', id: mock.last().id, value: ['main.py'] })
    await expect(p).resolves.toEqual(['main.py'])
  })

  it('broadcasts engine status to subscribers, starting from idle', () => {
    const { mock, client } = setup()
    const seen: string[] = []
    client.onStatus((s) => seen.push(s))
    void client.run('x')
    mock.emit({ kind: 'status', state: 'loading' })
    mock.emit({ kind: 'status', state: 'ready' })
    expect(seen).toEqual(['idle', 'loading', 'ready'])
    expect(client.state).toBe('ready')
  })

  it('stop() terminates the worker, resets state, and rejects pending requests', async () => {
    const { mock, client } = setup()
    const p = client.run('while True: pass')
    expect(mock.posted).toHaveLength(1)
    client.stop()
    expect(mock.terminated).toBe(true)
    expect(client.state).toBe('idle')
    await expect(p).rejects.toThrow('Execution stopped')
  })

  it('respawns a fresh worker on the next request after stop()', () => {
    let count = 0
    const client = new PythonClient(() => {
      count++
      return new MockWorker() as unknown as Worker
    })
    client.run('a').catch(() => {})
    client.stop()
    void client.run('b')
    expect(count).toBe(2)
  })
})
