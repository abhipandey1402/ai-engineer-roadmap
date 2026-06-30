import { useCallback, useEffect, useState } from 'react'
import { pythonClient, type OutputChunk } from '../lib/python/client'
import type { EngineState } from '../lib/python/protocol'

/** Engine lifecycle plus a local `running` flag while this hook owns a run. */
export type RunStatus = EngineState | 'running'

/**
 * React wrapper over the shared {@link pythonClient}. Each hook instance keeps its
 * own output buffer; the client routes streamed stdout/stderr back to the run that
 * produced it, so multiple runners on a page don't bleed into each other.
 */
export function usePython() {
  const [engineState, setEngineState] = useState<EngineState>(pythonClient.state)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<OutputChunk[]>([])

  useEffect(() => pythonClient.onStatus(setEngineState), [])

  const append = useCallback((chunk: OutputChunk) => {
    setOutput((prev) => [...prev, chunk])
  }, [])

  const clearOutput = useCallback(() => setOutput([]), [])

  const run = useCallback(
    async (code: string) => {
      setRunning(true)
      try {
        return await pythonClient.run(code, append)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setRunning(false)
      }
    },
    [append],
  )

  const runRepl = useCallback(
    async (code: string) => {
      setRunning(true)
      try {
        return await pythonClient.repl(code, append)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setRunning(false)
      }
    },
    [append],
  )

  const stop = useCallback(() => {
    pythonClient.stop()
    setRunning(false)
  }, [])

  const reset = useCallback(async () => {
    await pythonClient.reset()
    setOutput([])
  }, [])

  const status: RunStatus = running ? 'running' : engineState

  return {
    status,
    engineState,
    running,
    output,
    run,
    runRepl,
    stop,
    reset,
    clearOutput,
    writeFile: pythonClient.writeFile.bind(pythonClient),
    readFile: pythonClient.readFile.bind(pythonClient),
    listFiles: pythonClient.listFiles.bind(pythonClient),
    deleteFile: pythonClient.deleteFile.bind(pythonClient),
  }
}
