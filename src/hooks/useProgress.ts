import { useCallback, useEffect, useState } from 'react'

export type TopicStatus = 'pending' | 'learning' | 'done' | 'skipped'

export const STATUS_LABEL: Record<TopicStatus, string> = {
  pending: 'Pending',
  learning: 'In Progress',
  done: 'Done',
  skipped: 'Skipped',
}

const STATUS_KEY = 'aie-status'
const LEGACY_PROGRESS_KEY = 'aie-progress'
const LAST_KEY = 'aie-last-topic'

function load(): Record<string, TopicStatus> {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    if (raw) return JSON.parse(raw) as Record<string, TopicStatus>
    // Migrate the old done-set format
    const legacy = localStorage.getItem(LEGACY_PROGRESS_KEY)
    if (legacy) {
      const migrated: Record<string, TopicStatus> = {}
      for (const key of JSON.parse(legacy) as string[]) migrated[key] = 'done'
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

export function saveLastTopic(key: string) {
  localStorage.setItem(LAST_KEY, key)
}

export function getLastTopic(): string | null {
  return localStorage.getItem(LAST_KEY)
}
