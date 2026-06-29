import { useEffect, useState } from 'react'

export type Route =
  | { kind: 'home' }
  | { kind: 'course'; courseId: string }
  | { kind: 'topic'; courseId: string; sectionId: string; topicId: string }

/** Parses a `location.hash` string into a Route. Unknown shapes fall back to home. */
export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '').replace(/^\//, '').replace(/\/$/, '')
  if (!clean) return { kind: 'home' }
  const parts = clean.split('/')
  if (parts.length === 1) return { kind: 'course', courseId: parts[0] }
  if (parts.length === 3) {
    return { kind: 'topic', courseId: parts[0], sectionId: parts[1], topicId: parts[2] }
  }
  return { kind: 'home' }
}

/** Sets the hash (and thus triggers a route change) unless already there. */
export function navigate(path: string) {
  const next = path.replace(/^#?\/?/, '')
  if (location.hash.replace(/^#\/?/, '') !== next) {
    location.hash = `/${next}`
  }
}

/** Subscribes to hash changes and returns the current parsed Route. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
