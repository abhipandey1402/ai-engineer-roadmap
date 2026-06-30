import type { OutputChunk } from './client'

/**
 * Merge consecutive chunks from the same stream so the console renders one span
 * per contiguous run instead of one per flush. Pure — unit-tested.
 */
export function coalesceOutput(chunks: OutputChunk[]): OutputChunk[] {
  const out: OutputChunk[] = []
  for (const c of chunks) {
    const last = out[out.length - 1]
    if (last && last.stream === c.stream) last.text += c.text
    else out.push({ ...c })
  }
  return out
}
