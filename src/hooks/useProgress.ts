import { useCallback, useEffect, useState } from 'react'

export type TopicStatus = 'pending' | 'learning' | 'done' | 'skipped'

export const STATUS_LABEL: Record<TopicStatus, string> = {
  pending: 'Pending',
  learning: 'In Progress',
  done: 'Done',
  skipped: 'Skipped',
}

const STATUS_KEY = 'pathwise-status'
const LAST_KEY = 'pathwise-last'
const LEGACY_STATUS_KEY = 'aie-status'
const LEGACY_DONESET_KEY = 'aie-progress'
const LEGACY_LAST_KEY = 'aie-last-topic'

/** Pure helper: prefix every key in a status/flags map with `${courseId}/`. */
export function namespaceKeys<T>(obj: Record<string, T>, courseId: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k in obj) out[`${courseId}/${k}`] = obj[k]
  return out
}

function load(): Record<string, TopicStatus> {
  try {
    const cur = localStorage.getItem(STATUS_KEY)
    if (cur) return JSON.parse(cur) as Record<string, TopicStatus>
    // Migrate the AI app's (section/topic)-keyed statuses under ai-engineer.
    const legacy = localStorage.getItem(LEGACY_STATUS_KEY)
    if (legacy) return namespaceKeys(JSON.parse(legacy) as Record<string, TopicStatus>, 'ai-engineer')
    // Migrate the oldest done-set format.
    const doneset = localStorage.getItem(LEGACY_DONESET_KEY)
    if (doneset) {
      const migrated: Record<string, TopicStatus> = {}
      for (const key of JSON.parse(doneset) as string[]) migrated[`ai-engineer/${key}`] = 'done'
      return migrated
    }
    return {}
  } catch {
    return {}
  }
}

export function useStatuses() {
  const [statuses, setStatuses] = useState<Record<string, TopicStatus>>(load)

  useEffect(() => {
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
  }, [statuses])

  /** Sets a status. Setting the topic's current status resets it to pending (toggle). */
  const setStatus = useCallback((key: string, status: TopicStatus) => {
    setStatuses((prev) => {
      const next = { ...prev }
      if (status === 'pending' || prev[key] === status) delete next[key]
      else next[key] = status
      return next
    })
  }, [])

  return { statuses, setStatus }
}

function lastMap(): Record<string, string> {
  try {
    const cur = localStorage.getItem(LAST_KEY)
    if (cur) return JSON.parse(cur)
    const legacy = localStorage.getItem(LEGACY_LAST_KEY)
    if (legacy) return { 'ai-engineer': legacy }
    return {}
  } catch {
    return {}
  }
}

export function saveLastTopic(courseId: string, key: string) {
  const map = lastMap()
  map[courseId] = key
  localStorage.setItem(LAST_KEY, JSON.stringify(map))
}

export function getLastTopic(courseId: string): string | null {
  return lastMap()[courseId] ?? null
}
