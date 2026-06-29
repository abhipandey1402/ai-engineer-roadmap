# Pathwise — Multi-Course Platform + Python Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-course AI Engineer app into **Pathwise**, a multi-course learning platform with a branded homepage and shareable URLs, and add a full Python track at the same quality as the AI track.

**Architecture:** Course-scoped data (`src/data/courses/<id>/`) loaded by a registry; a ~40-line zero-dependency hash router; a `HomePage` hub plus a `CourseApp` shell that reuses today's roadmap/topic/lab/search UI scoped to one course. Progress is namespaced per course with one-time migration of existing data. Python content is authored by a parallel multi-agent workflow with adversarial link/fact verification.

**Tech Stack:** React 19, TypeScript (strict), Vite 8, CSS variables (no UI framework). Vitest added as a dev dependency for pure-logic unit tests. No new runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** React + react-dom only. Vitest is a **dev** dependency; acceptable.
- **TypeScript is strict:** `noUnusedLocals` and `noUnusedParameters` are on — no unused imports/params.
- **`verbatimModuleSyntax`** is on — type-only imports must use `import type { … }`.
- **Verification per task:** `npm run build` (runs `tsc -b && vite build`) must pass and `npm run lint` must be clean at every task boundary; plus the task's manual smoke check or unit test.
- **Brand:** "Pathwise". Tagline: "Learn by building." Homepage sub: "Interactive roadmaps with hands-on labs and runnable code."
- **Preserve existing AI-track content** in `src/data/courses/ai-engineer/sections/*.json` byte-for-byte (only the location moves).
- **Preserve existing user progress** — migrate `aie-*` localStorage keys, never wipe them.
- **localStorage key namespace:** new keys are `pathwise-*`; legacy `aie-*` keys are read once for migration.
- **Progress key format:** `` `${courseId}/${sectionId}/${topicId}` ``.

---

## File Structure

**Created:**
- `src/hooks/useRoute.ts` — hash router (`Route` type, `parseHash`, `navigate`, `useRoute`)
- `src/hooks/useRoute.test.ts` — `parseHash` unit tests
- `src/hooks/useProgress.test.ts` — `namespaceKeys` migration unit tests
- `src/data/courses/ai-engineer/course.json` — AI course meta
- `src/data/courses/ai-engineer/sections/*.json` — MOVED from `src/data/sections/*.json`
- `src/data/courses/python/course.json` — Python course meta
- `src/data/courses/python/sections/*.json` — NEW Python content (Task 8)
- `src/components/HomePage.tsx` — Pathwise hub (hero + course cards)
- `src/components/CourseApp.tsx` — per-course shell (extracted from `App.tsx`)

**Modified:**
- `package.json` — add `test` script + `vitest` devDep
- `vite.config.ts` — add vitest `test` config
- `src/types.ts` — add `Course`; change `topicKey` signature to include `courseId`
- `src/data/index.ts` — rewrite as course registry
- `src/App.tsx` — becomes the router (HomePage vs CourseApp)
- `src/components/Sidebar.tsx` — Pathwise brand + per-course section list/footer
- `src/components/RoadmapView.tsx` — takes a `course`
- `src/components/TopicView.tsx` — takes a `course`
- `src/components/SearchPalette.tsx` — takes a `course`
- `src/components/HandsOnLab.tsx` — `labLanguages` prop; conditional toggle; `pathwise-*` keys + migration
- `src/hooks/useProgress.ts` — `pathwise-status`/`pathwise-last` + migration + `namespaceKeys`
- `src/hooks/useTheme.ts` — `pathwise-theme` + migration
- `src/index.css` — homepage + course-card styles
- `index.html` — title → Pathwise; pre-paint theme reads `pathwise-theme`
- `scripts/build_manifest.py` — parameterized by course id; Python SECTIONS map
- `README.md` — describe Pathwise + both tracks

---

## Task 1: Git baseline + Vitest + hash router

**Files:**
- Modify: `package.json`, `vite.config.ts`
- Create: `src/hooks/useRoute.ts`, `src/hooks/useRoute.test.ts`

**Interfaces:**
- Produces: `Route` (union), `parseHash(hash: string): Route`, `navigate(path: string): void`, `useRoute(): Route`.

- [ ] **Step 1: Initialize git for rollback safety and commit the current state as baseline**

The project has a `.gitignore` but no repo. Initialize one so the refactor has rollback points.

```bash
cd /Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap
git init
git add -A
git commit -m "chore: baseline before Pathwise multi-course refactor"
```

- [ ] **Step 2: Add Vitest as a dev dependency and a test script**

Run:
```bash
npm install -D vitest@latest
```
Then edit `package.json` `scripts` to add a `test` line (keep the others):
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

Replace the file contents with:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write the failing test for `parseHash`**

Create `src/hooks/useRoute.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseHash } from './useRoute'

describe('parseHash', () => {
  it('treats empty hash as home', () => {
    expect(parseHash('')).toEqual({ kind: 'home' })
  })
  it('treats "#/" as home', () => {
    expect(parseHash('#/')).toEqual({ kind: 'home' })
  })
  it('parses a single segment as a course', () => {
    expect(parseHash('#/python')).toEqual({ kind: 'course', courseId: 'python' })
  })
  it('parses three segments as a topic', () => {
    expect(parseHash('#/python/language-basics/loops')).toEqual({
      kind: 'topic',
      courseId: 'python',
      sectionId: 'language-basics',
      topicId: 'loops',
    })
  })
  it('falls back to home for a malformed two-segment hash', () => {
    expect(parseHash('#/python/language-basics')).toEqual({ kind: 'home' })
  })
  it('ignores a trailing slash', () => {
    expect(parseHash('#/python/')).toEqual({ kind: 'course', courseId: 'python' })
  })
})
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./useRoute"` (file doesn't exist yet).

- [ ] **Step 6: Implement `src/hooks/useRoute.ts`**

```ts
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
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npm test`
Expected: PASS — 6 passing.

- [ ] **Step 8: Confirm the build still works**

Run: `npm run build`
Expected: builds with no type errors (the new files are isolated; nothing else changed).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add vitest + zero-dependency hash router"
```

---

## Task 2: Course type + content move + data registry

**Files:**
- Modify: `src/types.ts`, `src/data/index.ts`
- Create: `src/data/courses/ai-engineer/course.json`
- Move: `src/data/sections/*.json` → `src/data/courses/ai-engineer/sections/*.json`

**Interfaces:**
- Consumes: `Section`, `Topic` from `src/types.ts`.
- Produces: `Course` interface; `courses: Course[]`, `getCourse(id): Course | undefined`, `courseTopicCount(c): number`, `courseMinutes(c): number`. Temporary back-compat exports `sections`, `totalTopics`, `totalMinutes` (removed in Task 5).

- [ ] **Step 1: Add the `Course` interface to `src/types.ts`**

Append (do NOT change `topicKey` yet — that happens in Task 4):
```ts
export interface Course {
  id: string
  order: number
  title: string
  tagline: string
  description: string
  accent: string
  icon: string
  source: { label: string; url: string }
  labLanguages: Array<'python' | 'javascript'>
  sections: Section[]
}
```

- [ ] **Step 2: Move the AI sections into the course folder**

```bash
mkdir -p src/data/courses/ai-engineer/sections
git mv src/data/sections/*.json src/data/courses/ai-engineer/sections/
rmdir src/data/sections
```

- [ ] **Step 3: Create `src/data/courses/ai-engineer/course.json`**

```json
{
  "id": "ai-engineer",
  "order": 1,
  "title": "AI Engineer",
  "tagline": "Build production apps on top of foundation models.",
  "description": "The full roadmap.sh/ai-engineer curriculum — LLMs, prompting, RAG, agents, MCP, evals and more — distilled into focused lessons with runnable code and hands-on labs.",
  "accent": "#e8590c",
  "icon": "◐",
  "source": { "label": "roadmap.sh/ai-engineer", "url": "https://roadmap.sh/ai-engineer" },
  "labLanguages": ["python", "javascript"]
}
```

- [ ] **Step 4: Rewrite `src/data/index.ts` as a course registry (with temporary back-compat exports)**

```ts
import type { Course, Section } from '../types'

type CourseMeta = Omit<Course, 'sections'>

const metaModules = import.meta.glob('./courses/*/course.json', { eager: true }) as Record<
  string,
  { default: CourseMeta }
>
const sectionModules = import.meta.glob('./courses/*/sections/*.json', { eager: true }) as Record<
  string,
  { default: Section }
>

// Path shape: './courses/<courseId>/sections/NN-foo.json' or './courses/<courseId>/course.json'
const courseIdFromPath = (p: string) => p.split('/')[2]

const sectionsByCourse: Record<string, Array<{ path: string; section: Section }>> = {}
for (const path of Object.keys(sectionModules)) {
  const id = courseIdFromPath(path)
  ;(sectionsByCourse[id] ??= []).push({ path, section: sectionModules[path].default })
}

export const courses: Course[] = Object.keys(metaModules)
  .map((path) => {
    const meta = metaModules[path].default
    const sections = (sectionsByCourse[meta.id] ?? [])
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((s) => s.section)
    return { ...meta, sections }
  })
  .sort((a, b) => a.order - b.order)

export const getCourse = (id: string): Course | undefined => courses.find((c) => c.id === id)

export const courseTopicCount = (c: Course) =>
  c.sections.reduce((n, s) => n + s.topics.length, 0)

export const courseMinutes = (c: Course) =>
  c.sections.reduce((n, s) => n + s.topics.reduce((m, t) => m + t.minutes, 0), 0)

// --- Temporary back-compat exports (removed in Task 5 once components take a course) ---
const aiEngineer = getCourse('ai-engineer')
export const sections: Section[] = aiEngineer?.sections ?? []
export const totalTopics = aiEngineer ? courseTopicCount(aiEngineer) : 0
export const totalMinutes = aiEngineer ? courseMinutes(aiEngineer) : 0
```

- [ ] **Step 5: Build to confirm the move + registry typecheck cleanly**

Run: `npm run build`
Expected: PASS. The existing components still import `sections`/`totalTopics`/`totalMinutes`, which now resolve through the registry.

- [ ] **Step 6: Smoke-check the app still works**

Run: `npm run dev`, open the app. Expected: the AI Engineer roadmap renders exactly as before (15 sections, 170 topics), topics open, labs work. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: introduce Course type and course-scoped data registry"
```

---

## Task 3: HandsOnLab gains a `labLanguages` prop

**Files:**
- Modify: `src/components/HandsOnLab.tsx`

**Interfaces:**
- Consumes: `HandsOnLab as Lab` type, `Inline`.
- Produces: `HandsOnLab` component now accepts `{ lab, topicKey, labLanguages }`. `labLanguages` defaults to `['python', 'javascript']`. When length ≤ 1, the toggle is hidden and code renders in the single language.

- [ ] **Step 1: Update the component signature and toggle logic**

In `src/components/HandsOnLab.tsx`, change the component to accept `labLanguages` and only render the toggle when more than one language is offered. Replace the `export function HandsOnLab(...)` signature and the lang-state init:

```tsx
export function HandsOnLab({
  lab,
  topicKey,
  labLanguages = ['python', 'javascript'],
}: {
  lab: Lab
  topicKey: string
  labLanguages?: Lang[]
}) {
  const single = labLanguages.length <= 1
  const only: Lang = labLanguages[0] ?? 'python'
  const [lang, setLang] = useState<Lang>(() =>
    single ? only : (localStorage.getItem(LANG_KEY) as Lang) || 'python',
  )

  useEffect(() => {
    if (!single) localStorage.setItem(LANG_KEY, lang)
  }, [lang, single])
```

- [ ] **Step 2: Make the toggle conditional in the JSX**

In the same file, wrap the `.lang-toggle` block so it only renders when `!single`:
```tsx
        {!single && (
          <div className="lang-toggle" role="group" aria-label="Code language">
            {labLanguages.map((l) => (
              <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>
                {l === 'python' ? 'Python' : 'JavaScript'}
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 3: Update the `LANG_KEY` constant to the new namespace + migrate**

Near the top of the file, replace the key constants:
```ts
const LANG_KEY = 'pathwise-lab-lang'
const PRACTICE_KEY = 'pathwise-practice'
```
And update `loadPractice()` to migrate legacy practice keys once:
```ts
function loadPractice(): Record<string, boolean> {
  try {
    const cur = localStorage.getItem(PRACTICE_KEY)
    if (cur) return JSON.parse(cur)
    const legacy = localStorage.getItem('aie-practice')
    if (legacy) {
      const old = JSON.parse(legacy) as Record<string, boolean>
      const migrated: Record<string, boolean> = {}
      for (const k in old) migrated[`ai-engineer/${k}`] = old[k]
      return migrated
    }
    return {}
  } catch {
    return {}
  }
}
```
> Note: the legacy lab-language preference (`aie-lab-lang`) is a trivial UI toggle; it's intentionally not migrated.

- [ ] **Step 4: Build to confirm types are clean**

Run: `npm run build`
Expected: PASS. `TopicView` still calls `<HandsOnLab lab={...} topicKey={key} />`; the new prop is optional so it defaults to both languages (AI behavior preserved).

- [ ] **Step 5: Smoke-check an AI lab still shows the Python/JS toggle**

Run `npm run dev`, open an AI topic with a lab (e.g. MCP → "Building an MCP Server"). Expected: the Python/JavaScript toggle still appears and works. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: HandsOnLab supports single-language courses via labLanguages prop"
```

---

## Task 4: Course-scoping — namespaced progress, migration, and per-course components

This is the central refactor. `topicKey` gains a `courseId`; progress/theme migrate to `pathwise-*`; the Sidebar/RoadmapView/TopicView/SearchPalette take a `course`; today's `App` body becomes `CourseApp`. At the end the app still shows only the AI course (routing arrives in Task 5) but is fully course-scoped, and old progress is migrated.

**Files:**
- Modify: `src/types.ts`, `src/hooks/useProgress.ts`, `src/hooks/useTheme.ts`, `src/components/Sidebar.tsx`, `src/components/RoadmapView.tsx`, `src/components/TopicView.tsx`, `src/components/SearchPalette.tsx`, `src/App.tsx`
- Create: `src/components/CourseApp.tsx`, `src/hooks/useProgress.test.ts`

**Interfaces:**
- Consumes: `Course`, `getCourse`, `courseTopicCount`, `courseMinutes` (Task 2); `navigate` (Task 1); `labLanguages` prop (Task 3).
- Produces:
  - `topicKey(courseId: string, sectionId: string, topicId: string): string`
  - `useStatuses()` unchanged shape `{ statuses, setStatus }`; `namespaceKeys<T>(obj, courseId): Record<string,T>`; `saveLastTopic(courseId, key)`, `getLastTopic(courseId): string | null`.
  - `CourseApp({ course, route, statuses, setStatus, theme, toggleTheme, onHome })` where `route` is the Task 1 `Route` narrowed to course/topic.

- [ ] **Step 1: Write the failing test for `namespaceKeys`**

Create `src/hooks/useProgress.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { namespaceKeys } from './useProgress'

describe('namespaceKeys', () => {
  it('prefixes every key with the course id', () => {
    const legacy = { 'introduction/what-is-an-ai-engineer': 'done', 'rag/chunking': 'learning' } as const
    expect(namespaceKeys(legacy, 'ai-engineer')).toEqual({
      'ai-engineer/introduction/what-is-an-ai-engineer': 'done',
      'ai-engineer/rag/chunking': 'learning',
    })
  })
  it('returns an empty object unchanged', () => {
    expect(namespaceKeys({}, 'python')).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm test`
Expected: FAIL — `namespaceKeys` is not exported yet.

- [ ] **Step 3: Change `topicKey` in `src/types.ts`**

Replace the existing `topicKey` definition:
```ts
/** Globally-unique key for a topic, namespaced by course. */
export const topicKey = (courseId: string, sectionId: string, topicId: string) =>
  `${courseId}/${sectionId}/${topicId}`
```

- [ ] **Step 4: Rewrite `src/hooks/useProgress.ts` with `pathwise-*` keys, migration, and `namespaceKeys`**

```ts
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
    // Migrate the AI app's namespaced-by-(section/topic) statuses under ai-engineer.
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
```

- [ ] **Step 5: Run the unit test, confirm it passes**

Run: `npm test`
Expected: PASS — `namespaceKeys` + `parseHash` suites green.

- [ ] **Step 6: Update `src/hooks/useTheme.ts` to `pathwise-theme` with migration**

Replace the `THEME_KEY` constant and `load()`:
```ts
const THEME_KEY = 'pathwise-theme'

function load(): Theme {
  const saved = localStorage.getItem(THEME_KEY) ?? localStorage.getItem('aie-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
```

- [ ] **Step 7: Update `src/components/Sidebar.tsx` to take a `course` and route home**

Replace the file with (brand becomes Pathwise + course title; section list and footer are per-course):
```tsx
import { topicKey, type Course } from '../types'
import type { TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { Logo } from './Logo'

interface Props {
  course: Course
  activeSectionId: string | null
  statuses: Record<string, TopicStatus>
  onHome: () => void
  onSelectSection: (sectionId: string) => void
  onSearch: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Sidebar({
  course,
  activeSectionId,
  statuses,
  onHome,
  onSelectSection,
  onSearch,
  theme,
  onToggleTheme,
}: Props) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={onHome}>
        <span className="brand-mark">
          <Logo />
        </span>
        <span>
          Pathwise
          <small>{course.title}</small>
        </span>
      </button>

      <button className="search-trigger" onClick={onSearch}>
        <span>Search topics</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="section-list">
        {course.sections.map((s, i) => {
          const sectionStatuses = s.topics.map((t) => statuses[topicKey(course.id, s.id, t.id)])
          const done = sectionStatuses.filter((st) => st === 'done').length
          const hasLearning = sectionStatuses.some((st) => st === 'learning')
          const isFinished =
            s.topics.length > 0 && sectionStatuses.every((st) => st === 'done' || st === 'skipped')
          return (
            <button
              key={s.id}
              className={`section-item ${activeSectionId === s.id ? 'active' : ''}`}
              onClick={() => onSelectSection(s.id)}
            >
              <span className="section-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="section-name">
                {s.title}
                {hasLearning && <span className="section-learning" title="In progress"> ◐</span>}
              </span>
              <span className={`section-count ${isFinished ? 'done' : ''}`}>
                {isFinished ? '✓' : `${done}/${s.topics.length}`}
              </span>
            </button>
          )
        })}
      </nav>

      <footer className="sidebar-footer">
        <span>
          Based on{' '}
          <a href={course.source.url} target="_blank" rel="noreferrer">
            {course.source.label}
          </a>
        </span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </footer>
    </aside>
  )
}
```

- [ ] **Step 8: Update `src/components/RoadmapView.tsx` to take a `course`**

Replace the imports and the `Props`/signature/derived-stats, and replace every `topicKey(section.id, t.id)` with `topicKey(course.id, section.id, t.id)` and every `sections`/`totalTopics`/`totalMinutes` with the course-scoped values. Full replacement:
```tsx
import { courseMinutes, courseTopicCount } from '../data'
import { topicKey, type Course, type Section, type Topic } from '../types'
import type { TopicStatus } from '../hooks/useProgress'

interface Props {
  course: Course
  statuses: Record<string, TopicStatus>
  onOpenTopic: (sectionId: string, topicId: string) => void
  continueTarget: { sectionId: string; topicId: string; title: string } | null
}

const PILL_ICON: Partial<Record<TopicStatus, string>> = {
  learning: '◐',
  done: '✓',
  skipped: '⊘',
}

function groupTopics(section: Section): Array<{ label: string | null; topics: Topic[] }> {
  const groups: Array<{ label: string | null; topics: Topic[] }> = []
  for (const t of section.topics) {
    const last = groups[groups.length - 1]
    if (last && last.label === t.subsection) last.topics.push(t)
    else groups.push({ label: t.subsection, topics: [t] })
  }
  return groups
}

export function RoadmapView({ course, statuses, onOpenTopic, continueTarget }: Props) {
  const total = courseTopicCount(course)
  let doneCount = 0
  let learningCount = 0
  for (const s of course.sections) {
    for (const t of s.topics) {
      const st = statuses[topicKey(course.id, s.id, t.id)]
      if (st === 'done') doneCount++
      else if (st === 'learning') learningCount++
    }
  }
  const pct = total ? Math.round((doneCount / total) * 100) : 0

  return (
    <div className="roadmap">
      <header className="hero">
        <h1>{course.title}</h1>
        <p className="hero-sub">{course.description}</p>
        <div className="hero-stats">
          <div className="stat">
            <strong>{total}</strong>
            <span>topics</span>
          </div>
          <div className="stat">
            <strong>~{Math.round(courseMinutes(course) / 60)}h</strong>
            <span>total reading</span>
          </div>
          <div className="stat">
            <strong>{learningCount}</strong>
            <span>in progress</span>
          </div>
          <div className="stat">
            <strong>{doneCount}</strong>
            <span>done</span>
          </div>
          <div className="stat">
            <strong>{pct}%</strong>
            <span>complete</span>
          </div>
        </div>
        {continueTarget && (
          <button
            className="continue-btn"
            onClick={() => onOpenTopic(continueTarget.sectionId, continueTarget.topicId)}
          >
            {doneCount > 0 || learningCount > 0 ? 'Continue learning' : 'Start learning'} —{' '}
            {continueTarget.title} →
          </button>
        )}
      </header>

      <div className="timeline">
        {course.sections.map((section, i) => {
          const sectionStatuses = section.topics.map((t) => statuses[topicKey(course.id, section.id, t.id)])
          const sectionDone = sectionStatuses.filter((s) => s === 'done').length
          const allFinished = sectionStatuses.every((s) => s === 'done' || s === 'skipped')
          return (
            <section key={section.id} id={`section-${section.id}`} className="timeline-item">
              <div className="timeline-rail">
                <div className={`timeline-node ${allFinished ? 'filled' : ''}`}>
                  {allFinished ? '✓' : String(i + 1).padStart(2, '0')}
                </div>
                {i < course.sections.length - 1 && <div className="timeline-line" />}
              </div>
              <div className="timeline-card">
                <div className="timeline-card-head">
                  <h2>{section.title}</h2>
                  <span className="timeline-progress">
                    {sectionDone}/{section.topics.length}
                  </span>
                </div>
                <p className="timeline-desc">{section.description}</p>
                {groupTopics(section).map((g, gi) => (
                  <div key={gi} className="topic-group">
                    {g.label && <div className="topic-group-label">{g.label}</div>}
                    <div className="topic-pills">
                      {g.topics.map((t) => {
                        const status = statuses[topicKey(course.id, section.id, t.id)] ?? 'pending'
                        const icon = PILL_ICON[status]
                        return (
                          <button
                            key={t.id}
                            className={`pill pill-${status}`}
                            onClick={() => onOpenTopic(section.id, t.id)}
                            title={t.handsOn ? `${t.intro} (includes hands-on lab)` : t.intro}
                          >
                            {icon && <span className="pill-check">{icon}</span>}
                            {t.title}
                            {t.handsOn && <span className="pill-lab" title="Hands-on lab">LAB</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Update `src/components/TopicView.tsx` to take a `course`**

Change the `Props` interface to add `course: Course` and update the `key` computation. Replace the imports line and the `Props` + the `const key` line:
```tsx
import { topicKey, type Course, type Section, type Topic } from '../types'
```
```tsx
interface Props {
  course: Course
  section: Section
  topic: Topic
  statuses: Record<string, TopicStatus>
  onSetStatus: (key: string, status: TopicStatus) => void
  onBack: () => void
  onNavigate: (dir: -1 | 1) => void
  neighbors: { prev: Topic | null; next: Topic | null }
}
```
```tsx
export function TopicView({
  course,
  section,
  topic,
  statuses,
  onSetStatus,
  onBack,
  onNavigate,
  neighbors,
}: Props) {
  const key = topicKey(course.id, section.id, topic.id)
```
Then pass `labLanguages` into the lab render — replace the `{topic.handsOn && <HandsOnLab ... />}` line with:
```tsx
        {topic.handsOn && (
          <HandsOnLab lab={topic.handsOn} topicKey={key} labLanguages={course.labLanguages} />
        )}
```

- [ ] **Step 10: Update `src/components/SearchPalette.tsx` to take a `course`**

Replace the module-level `ALL` constant (which imported the global `sections`) with a per-course computation, and namespace the status lookups. Replace imports + `Props` + the hit construction:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { topicKey, type Course } from '../types'
import type { TopicStatus } from '../hooks/useProgress'

interface Props {
  course: Course
  statuses: Record<string, TopicStatus>
  onClose: () => void
  onOpenTopic: (sectionId: string, topicId: string) => void
}

const HIT_ICON: Partial<Record<TopicStatus, string>> = {
  learning: '◐ ',
  done: '✓ ',
  skipped: '⊘ ',
}

interface Hit {
  sectionId: string
  sectionTitle: string
  topicId: string
  title: string
  intro: string
}
```
Then inside the component, build `ALL` from the course with `useMemo`, and update the `key`/status lookups to use `topicKey(course.id, ...)`:
```tsx
export function SearchPalette({ course, statuses, onClose, onOpenTopic }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const all = useMemo<Hit[]>(
    () =>
      course.sections.flatMap((s) =>
        s.topics.map((t) => ({
          sectionId: s.id,
          sectionTitle: s.title,
          topicId: t.id,
          title: t.title,
          intro: t.intro,
        })),
      ),
    [course],
  )

  useEffect(() => inputRef.current?.focus(), [])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 12)
    return all
      .filter(
        (h) =>
          h.title.toLowerCase().includes(q) ||
          h.intro.toLowerCase().includes(q) ||
          h.sectionTitle.toLowerCase().includes(q),
      )
      .slice(0, 12)
  }, [query, all])

  useEffect(() => setCursor(0), [query])
```
Update the input placeholder to be generic and the `key`/icon lookups in the results map:
```tsx
          placeholder={`Search ${all.length} topics…`}
```
```tsx
            <button
              key={topicKey(course.id, h.sectionId, h.topicId)}
              className={`palette-hit ${i === cursor ? 'cursor' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onOpenTopic(h.sectionId, h.topicId)}
            >
              <span className="hit-title">
                {HIT_ICON[statuses[topicKey(course.id, h.sectionId, h.topicId)] ?? 'pending'] && (
                  <span className="pill-check">
                    {HIT_ICON[statuses[topicKey(course.id, h.sectionId, h.topicId)] ?? 'pending']}
                  </span>
                )}
                {h.title}
              </span>
              <span className="hit-section">{h.sectionTitle}</span>
            </button>
```
(Keep the existing `handleKey` and the overlay markup; only the data source and keys changed.)

- [ ] **Step 11: Create `src/components/CourseApp.tsx` (today's App body, scoped to a course)**

```tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { courseTopicCount } from '../data'
import { getLastTopic, saveLastTopic, type TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { topicKey, type Course } from '../types'
import type { Route } from '../hooks/useRoute'
import { navigate } from '../hooks/useRoute'
import { Sidebar } from './Sidebar'
import { RoadmapView } from './RoadmapView'
import { TopicView } from './TopicView'
import { SearchPalette } from './SearchPalette'

interface FlatTopic {
  sectionId: string
  topicId: string
  title: string
}

interface Props {
  course: Course
  route: Extract<Route, { kind: 'course' } | { kind: 'topic' }>
  statuses: Record<string, TopicStatus>
  setStatus: (key: string, status: TopicStatus) => void
  theme: Theme
  toggleTheme: () => void
  onHome: () => void
}

export function CourseApp({ course, route, statuses, setStatus, theme, toggleTheme, onHome }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const homeScroll = useRef(0)
  const restoreScroll = useRef(false)

  const onRoadmap = route.kind === 'course'

  useLayoutEffect(() => {
    if (onRoadmap && restoreScroll.current) {
      restoreScroll.current = false
      window.scrollTo({ top: homeScroll.current, behavior: 'instant' as ScrollBehavior })
    }
  }, [onRoadmap])

  const flat = useMemo<FlatTopic[]>(
    () =>
      course.sections.flatMap((s) =>
        s.topics.map((t) => ({ sectionId: s.id, topicId: t.id, title: t.title })),
      ),
    [course],
  )

  const openTopic = useCallback(
    (sectionId: string, topicId: string) => {
      if (onRoadmap) homeScroll.current = window.scrollY
      setSearchOpen(false)
      saveLastTopic(course.id, `${sectionId}/${topicId}`)
      navigate(`${course.id}/${sectionId}/${topicId}`)
    },
    [onRoadmap, course.id],
  )

  const goRoadmap = useCallback(() => {
    restoreScroll.current = true
    navigate(course.id)
  }, [course.id])

  const selectSection = useCallback(
    (sectionId: string) => {
      restoreScroll.current = false
      navigate(course.id)
      requestAnimationFrame(() => {
        document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' })
      })
    },
    [course.id],
  )

  const isFinished = useCallback(
    (key: string) => statuses[key] === 'done' || statuses[key] === 'skipped',
    [statuses],
  )

  const continueTarget = useMemo(() => {
    const last = getLastTopic(course.id)
    if (last) {
      const slash = last.indexOf('/')
      const sId = last.slice(0, slash)
      const tId = last.slice(slash + 1)
      if (!isFinished(topicKey(course.id, sId, tId))) {
        const hit = flat.find((f) => f.sectionId === sId && f.topicId === tId)
        if (hit) return hit
      }
    }
    return flat.find((f) => !isFinished(topicKey(course.id, f.sectionId, f.topicId))) ?? flat[0] ?? null
  }, [flat, isFinished, course.id])

  const current = useMemo(() => {
    if (route.kind !== 'topic') return null
    const section = course.sections.find((s) => s.id === route.sectionId)
    const topic = section?.topics.find((t) => t.id === route.topicId)
    if (!section || !topic) return null
    const idx = flat.findIndex((f) => f.sectionId === route.sectionId && f.topicId === route.topicId)
    const findTopic = (ref: FlatTopic | undefined) =>
      ref
        ? course.sections.find((s) => s.id === ref.sectionId)?.topics.find((t) => t.id === ref.topicId) ?? null
        : null
    return { section, topic, idx, prev: findTopic(flat[idx - 1]), next: findTopic(flat[idx + 1]) }
  }, [route, flat, course])

  const navigateTopic = useCallback(
    (dir: -1 | 1) => {
      if (!current) return
      const target = flat[current.idx + dir]
      if (target) openTopic(target.sectionId, target.topicId)
    },
    [current, flat, openTopic],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
        return
      }
      if (searchOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        if (route.kind === 'topic') goRoadmap()
        else onHome()
        return
      }
      if (route.kind === 'topic') {
        const key = topicKey(course.id, route.sectionId, route.topicId)
        switch (e.key.toLowerCase()) {
          case 'arrowleft':
            navigateTopic(-1)
            break
          case 'arrowright':
            navigateTopic(1)
            break
          case 'd':
            setStatus(key, 'done')
            break
          case 'i':
            setStatus(key, 'learning')
            break
          case 's':
            setStatus(key, 'skipped')
            break
          case 'r':
            setStatus(key, 'pending')
            break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, route, navigateTopic, goRoadmap, onHome, setStatus, course.id])

  const total = courseTopicCount(course)
  const doneCount = useMemo(
    () =>
      course.sections.reduce(
        (n, s) => n + s.topics.filter((t) => statuses[topicKey(course.id, s.id, t.id)] === 'done').length,
        0,
      ),
    [course, statuses],
  )
  const pct = total ? (doneCount / total) * 100 : 0

  return (
    <div className="app">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <Sidebar
        course={course}
        activeSectionId={route.kind === 'topic' ? route.sectionId : null}
        statuses={statuses}
        onHome={onHome}
        onSelectSection={selectSection}
        onSearch={() => setSearchOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="main">
        {current ? (
          <TopicView
            course={course}
            section={current.section}
            topic={current.topic}
            statuses={statuses}
            onSetStatus={setStatus}
            onBack={goRoadmap}
            onNavigate={navigateTopic}
            neighbors={{ prev: current.prev, next: current.next }}
          />
        ) : (
          <RoadmapView
            course={course}
            statuses={statuses}
            onOpenTopic={openTopic}
            continueTarget={continueTarget}
          />
        )}
      </main>
      {searchOpen && (
        <SearchPalette
          course={course}
          statuses={statuses}
          onClose={() => setSearchOpen(false)}
          onOpenTopic={openTopic}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 12: Temporarily wire `src/App.tsx` to render the AI course via `CourseApp`**

(Routing/HomePage land in Task 5; for now keep the app working by rendering the AI course directly.)
```tsx
import { getCourse } from './data'
import { useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { CourseApp } from './components/CourseApp'

export default function App() {
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()
  const course = getCourse('ai-engineer')!

  return (
    <CourseApp
      course={course}
      route={{ kind: 'course', courseId: course.id }}
      statuses={statuses}
      setStatus={setStatus}
      theme={theme}
      toggleTheme={toggleTheme}
      onHome={() => {}}
    />
  )
}
```

- [ ] **Step 13: Build, lint, and run all tests**

Run: `npm run build && npm run lint && npm test`
Expected: all pass. Fix any unused-import errors (strict TS) that surface.

- [ ] **Step 14: Smoke-check the AI course + progress migration**

Run `npm run dev`. Before loading, if you have old progress it lives under `aie-status`. Open the app: AI roadmap renders; **previously-completed topics still show as done** (migrated). Mark a topic done, reload — it persists under `pathwise-status`. Topics open, labs work, ⌘K search works, arrow-key nav works. Stop the server.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor: course-scope progress, components, and extract CourseApp"
```

---

## Task 5: HomePage hub + routing

**Files:**
- Create: `src/components/HomePage.tsx`
- Modify: `src/App.tsx`, `src/data/index.ts` (remove back-compat exports), `src/index.css`

**Interfaces:**
- Consumes: `courses`, `getCourse`, `courseTopicCount`, `courseMinutes`; `useRoute`, `navigate`; `useStatuses`, `useTheme`; `topicKey`.
- Produces: `HomePage({ courses, statuses, theme, onToggleTheme, onOpenCourse })`.

- [ ] **Step 1: Create `src/components/HomePage.tsx`**

```tsx
import { courseMinutes, courseTopicCount } from '../data'
import { topicKey, type Course } from '../types'
import type { TopicStatus } from '../hooks/useProgress'
import type { Theme } from '../hooks/useTheme'
import { Logo } from './Logo'

interface Props {
  courses: Course[]
  statuses: Record<string, TopicStatus>
  theme: Theme
  onToggleTheme: () => void
  onOpenCourse: (courseId: string) => void
}

function coursePct(course: Course, statuses: Record<string, TopicStatus>): number {
  const total = courseTopicCount(course)
  if (!total) return 0
  let done = 0
  for (const s of course.sections)
    for (const t of s.topics) if (statuses[topicKey(course.id, s.id, t.id)] === 'done') done++
  return Math.round((done / total) * 100)
}

export function HomePage({ courses, statuses, theme, onToggleTheme, onOpenCourse }: Props) {
  return (
    <div className="home">
      <button
        className="theme-toggle home-theme"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <header className="home-hero">
        <div className="home-brand">
          <Logo size={40} />
          <span>Pathwise</span>
        </div>
        <h1>Learn by building.</h1>
        <p>Interactive roadmaps with hands-on labs and runnable code.</p>
      </header>

      <div className="course-grid">
        {courses.map((course) => {
          const pct = coursePct(course, statuses)
          const started = pct > 0
          return (
            <button
              key={course.id}
              className="course-card"
              style={{ ['--card-accent' as string]: course.accent }}
              onClick={() => onOpenCourse(course.id)}
            >
              <div className="course-card-rail" />
              <div className="course-card-body">
                <span className="course-card-icon">{course.icon}</span>
                <h2>{course.title}</h2>
                <p>{course.tagline}</p>
                <div className="course-card-stats">
                  <span>{courseTopicCount(course)} topics</span>
                  <span>~{Math.round(courseMinutes(course) / 60)}h</span>
                </div>
                {started ? (
                  <div className="course-card-progress">
                    <div className="course-card-bar">
                      <div className="course-card-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="course-card-cta">Continue · {pct}% →</span>
                  </div>
                ) : (
                  <span className="course-card-cta">Start learning →</span>
                )}
              </div>
            </button>
          )
        })}

        <div className="course-card course-card-soon" aria-disabled="true">
          <div className="course-card-body">
            <span className="course-card-icon">+</span>
            <h2>More tracks</h2>
            <p>Coming soon.</p>
          </div>
        </div>
      </div>

      <footer className="home-footer">
        Curriculum based on{' '}
        <a href="https://roadmap.sh" target="_blank" rel="noreferrer">
          roadmap.sh
        </a>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `src/App.tsx` as the router**

```tsx
import { courses, getCourse } from './data'
import { useStatuses } from './hooks/useProgress'
import { useTheme } from './hooks/useTheme'
import { navigate, useRoute } from './hooks/useRoute'
import { HomePage } from './components/HomePage'
import { CourseApp } from './components/CourseApp'

export default function App() {
  const route = useRoute()
  const { statuses, setStatus } = useStatuses()
  const { theme, toggleTheme } = useTheme()

  const course = route.kind === 'home' ? null : getCourse(route.courseId)

  if (route.kind === 'home' || !course) {
    return (
      <HomePage
        courses={courses}
        statuses={statuses}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenCourse={(id) => navigate(id)}
      />
    )
  }

  return (
    <CourseApp
      course={course}
      route={route}
      statuses={statuses}
      setStatus={setStatus}
      theme={theme}
      toggleTheme={toggleTheme}
      onHome={() => navigate('')}
    />
  )
}
```

- [ ] **Step 3: Remove the temporary back-compat exports from `src/data/index.ts`**

Delete the final block (the `aiEngineer`/`sections`/`totalTopics`/`totalMinutes` lines). Run `npm run build` to confirm nothing still imports them; fix any stragglers.

- [ ] **Step 4: Add homepage + course-card CSS to `src/index.css`**

Append:
```css
/* ---------- homepage (Pathwise hub) ---------- */

.home {
  max-width: 920px;
  margin: 0 auto;
  padding: 64px 24px 96px;
  position: relative;
}

.home-theme {
  position: absolute;
  top: 24px;
  right: 24px;
}

.home-hero {
  padding: 32px 0 48px;
}

.home-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.home-hero h1 {
  margin-top: 28px;
  font-size: 64px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.04;
}

.home-hero p {
  margin-top: 16px;
  max-width: 560px;
  font-size: 21px;
  color: var(--gray-5);
}

.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.course-card {
  display: flex;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg);
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}

.course-card:not(.course-card-soon):hover {
  border-color: var(--card-accent, var(--fg));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
}

.course-card-rail {
  width: 6px;
  flex-shrink: 0;
  background: var(--card-accent, var(--fg));
}

.course-card-body {
  padding: 22px 24px;
  flex: 1;
}

.course-card-icon {
  font-size: 26px;
  line-height: 1;
}

.course-card-body h2 {
  margin-top: 12px;
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.course-card-body p {
  margin-top: 6px;
  color: var(--gray-5);
  font-size: 16px;
}

.course-card-stats {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--gray-4);
}

.course-card-progress {
  margin-top: 18px;
}

.course-card-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--gray-2);
  overflow: hidden;
}

.course-card-bar-fill {
  height: 100%;
  background: var(--card-accent, var(--fg));
  transition: width 0.4s ease;
}

.course-card-cta {
  display: inline-block;
  margin-top: 14px;
  font-weight: 650;
  font-size: 16px;
  color: var(--fg);
}

.course-card-soon {
  opacity: 0.6;
  cursor: default;
  border-style: dashed;
}

.course-card-soon .course-card-body h2 {
  color: var(--gray-4);
}

.home-footer {
  margin-top: 48px;
  font-size: 14px;
  color: var(--gray-4);
}

.home-footer a {
  color: var(--fg);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 720px) {
  .home-hero h1 {
    font-size: 44px;
  }
}
```

- [ ] **Step 5: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Smoke-check full navigation**

Run `npm run dev`. Verify: homepage shows the AI Engineer card with progress + a "More tracks" card; clicking the card opens the AI roadmap at `#/ai-engineer`; opening a topic goes to `#/ai-engineer/<section>/<topic>`; the URL is shareable (reload the topic URL → it loads directly); browser back/forward moves between hub/roadmap/topic; clicking the sidebar brand returns to the hub; theme toggle works on both hub and course. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Pathwise homepage hub + hash routing"
```

---

## Task 6: Branding polish (title, pre-paint theme, README)

**Files:**
- Modify: `index.html`, `README.md`

**Interfaces:** none (static assets/docs).

- [ ] **Step 1: Update `index.html` title and pre-paint theme key**

Change the `<title>` and the inline theme script to read `pathwise-theme` (falling back to the legacy `aie-theme`):
```html
    <title>Pathwise — Learn by building</title>
```
```html
    <script>
      // Apply the saved theme before first paint to avoid a flash of the wrong theme.
      const saved = localStorage.getItem('pathwise-theme') || localStorage.getItem('aie-theme')
      document.documentElement.dataset.theme =
        saved === 'light' || saved === 'dark'
          ? saved
          : matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
    </script>
```

- [ ] **Step 2: Update `README.md`**

Replace the top section so it describes Pathwise as a multi-course platform (AI Engineer + Python), the homepage hub, shareable hash URLs, and that adding a course = drop a `src/data/courses/<id>/` folder (with `course.json` + `sections/*.json`) and it appears automatically. Keep the "Run it" and "Content pipeline" sections, updating paths to `src/data/courses/<id>/sections/*.json`.

- [ ] **Step 3: Build + smoke-check the tab title**

Run: `npm run build`, then `npm run dev`. Expected: browser tab reads "Pathwise — Learn by building"; theme still applies without flashing. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Pathwise branding (title, theme key, README)"
```

---

## Task 7: Python content pipeline + course shell

Generate the Python source bundles and stand up the Python course so it appears on the homepage (full content arrives in Task 8).

**Files:**
- Modify: `scripts/build_manifest.py`
- Create: `src/data/courses/python/course.json`; `content-src/python/*` (generated); `src/data/courses/python/sections/01-getting-started.json` (one real section so the course is navigable)

**Interfaces:**
- Produces: `content-src/python/NN-*.txt` source bundles + `content-src/python/manifest.json`; a visible Python course on the homepage.

- [ ] **Step 1: Clone the roadmap.sh source repo (if not already present)**

```bash
test -d /tmp/dev-roadmap || git clone --depth 1 https://github.com/kamranahmedse/developer-roadmap /tmp/dev-roadmap
ls /tmp/dev-roadmap/src/data/roadmaps/python/content | head
```
Expected: lists files like `basic-syntax@6xRncUs3_vxVbDur567QA.md`.

- [ ] **Step 2: Parameterize `scripts/build_manifest.py` by course and add the Python SECTIONS map**

Refactor the script so the roadmap id, content path, and SECTIONS list are selected by a `--course` argument (default `ai-engineer` preserves current behavior). Add the Python mapping below. Replace the top of the file:
```python
#!/usr/bin/env python3
"""Builds per-section source bundles from a roadmap.sh roadmap so content-authoring
agents can enrich them into the app's JSON data files. Usage: build_manifest.py [--course ai-engineer|python]"""
import json, os, re, sys

COURSE = 'python' if '--course' in sys.argv and sys.argv[sys.argv.index('--course') + 1] == 'python' else 'ai-engineer'
ROADMAP = COURSE
CONTENT = f'/tmp/dev-roadmap/src/data/roadmaps/{ROADMAP}/content'
OUT = os.path.join(os.path.dirname(__file__), '..', 'content-src', COURSE)
```
Keep the existing `SECTIONS` (AI) list, renamed `SECTIONS_AI`, and add `SECTIONS_PYTHON`:
```python
SECTIONS_PYTHON = [
    ("getting-started", "Getting Started", "What Python is, where it's used, and how to set up and run it.", [
        ("GISOFMKvnBys0O0IMpz2J", "Learn the Basics", None),
    ]),
    ("language-basics", "Language Basics", "Syntax, variables, operators, strings, and control flow.", [
        ("6xRncUs3_vxVbDur567QA", "Basic Syntax", None),
        ("dEFLBGpiH6nbSMeR7ecaT", "Variables and Data Types", None),
        ("so95CO6Qw3I0S98ISENS-", "Operators", None),
        ("R9DQNc0AyAQ2HLpP4HOk6", "Type Casting", None),
        ("Sg5w8zO2Ji-uDJKEoWey9", "Working with Strings", None),
        ("NP1kjSk0ujU0Gx-ajNHlR", "Conditionals", None),
        ("Dvy7BnNzK55qbh_SgOk8m", "Loops", None),
    ]),
    ("functions-scope", "Functions & Scope", "Defining and using functions, built-ins, lambdas, and scope.", [
        ("-DJgS6l2qngfwurExlmmT", "Functions", None),
        ("08XifLQ20c4FKI_4AWNBQ", "Builtin Functions", None),
        ("aWHgAk959DPUZL46CeRiI", "Lambdas", None),
        ("3RNy7Sp28d-NMx0Yh4bdx", "Variable Scope", None),
    ]),
    ("data-structures", "Data Structures", "Python's core collections and comprehensions.", [
        ("UT_SR7G-LYtzqooWrEtF1", "Lists", None),
        ("i7xIGiXU-k5UIKHIhQPjE", "Tuples", None),
        ("soZFqivM3YBuljeX6PoaX", "Sets", None),
        ("bc9CL_HMT-R6nXO1eR-gP", "Dictionaries", None),
        ("4gtmtYWYRWqwLdZRL0XMg", "List Comprehensions", None),
        ("jnLIVRrWxcX3yq3Op91Vr", "Generator Expressions", None),
    ]),
    ("oop", "Object-Oriented Programming", "Classes, methods, inheritance, encapsulation, and paradigms.", [
        ("P_Di-XPSDITmU3xKQew8G", "OOP Overview", None),
        ("AqwzR8dZKLQIoj_6KKZ3t", "Classes", None),
        ("zAS4YiEJ6VPsyABrkIG8i", "Methods", None),
        ("S0FLE70szSVUPI0CDEQK7", "Inheritance", None),
        ("3dC2o3WXdx4plFhDP2Vqk", "Encapsulation", None),
        ("4GU5HNi3W8yFkImVY9ZpW", "Programming Paradigms", None),
    ]),
    ("errors-files-text", "Errors, Files & Text", "Exceptions, file handling, context managers, and regular expressions.", [
        ("fNTb9y3zs1HPYclAmu_Wv", "Exceptions", None),
        ("Nf3kRDSl_vas6QPXG7eVa", "File Handling", None),
        ("KAXF2kUAOvtBZhY8G9rkI", "Context Managers", None),
        ("bqnwMKY4R0rirup3q_hb_", "Glob", None),
        ("7t6mJBsaFMWPi7o9fbhhq", "Regular Expressions", None),
    ]),
    ("advanced-python", "Advanced Python", "Decorators, iterators, and modules.", [
        ("pIluLJkySqn_gI_GykV6G", "Decorators", None),
        ("aB1LSQjDEQb_BxueOcnxU", "Iterators", None),
        ("274uk28wzxn6EKWQzLpHs", "Modules", None),
    ]),
    ("dsa", "Data Structures & Algorithms", "Core data structures and algorithms in Python.", [
        ("VJSIbYJcy2MC6MOFBrqXi", "DSA Overview", None),
        ("OPD4WdMO7q4gRZMcRCQh1", "Arrays and Linked Lists", None),
        ("0NlRczh6ZEaFLlT6LORWz", "Heaps, Stacks and Queues", None),
        ("DG4fi1e5ec2BVckPLsTJS", "Hashmaps", None),
        ("uJIqgsqUbE62Tyo3K75Qx", "Binary Search Tree", None),
        ("kLBgy_nxxjE8SxdVi04bq", "Recursion", None),
        ("vvTmjcWCVclOPY4f_5uB0", "Sorting Algorithms", None),
    ]),
    ("environments-packaging", "Environments & Packaging", "Virtual environments, package managers, and project config.", [
        ("qeCMw-sJ2FR4UxvU9DDzv", "Package Managers", None),
        ("iVhQnp6hpgVZDNJ0XoVra", "pip", None),
        ("1dfOTOGsOk5XE3bnZs8Ht", "PyPI", None),
        ("_IXXTSwQOgYzYIUuKVWNE", "virtualenv", None),
        ("N5VaKMbgQ0V_BC5tadV65", "pyenv", None),
        ("uh67D1u-Iv5cZamRgFEJg", "conda", None),
        ("IWq-tfkz-pSC1ztZl60vM", "pipenv", None),
        ("uXd2B01GVBEQNXQE8RATT", "poetry", None),
        ("xDgXISgVUMRHh9hu4h6Hl", "pdm", None),
        ("p3Frfs6oxpuciUzeCEsvb", "uv", None),
        ("GHKAY9gOykEbxkEeR30wL", "pyproject.toml", None),
        ("_94NrQ3quc4t_PPOsFSN0", "Common Packages", None),
    ]),
    ("code-quality", "Code Quality", "Typing, formatting, testing, and documentation.", [
        ("1PXApuUpPmJjgi12cmWo4", "Static Typing", "Typing"),
        ("o1wi39VnjnFfWIC8XcuAK", "typing module", "Typing"),
        ("gIcJ3bUVQXqO1Wx4gUKd5", "mypy", "Typing"),
        ("1q9HWgu9jDTK757hTNOmE", "pyright", "Typing"),
        ("9mFR_ueXbIB2IrkqU2s85", "pyre", "Typing"),
        ("l7k0qTYe42wYBTlT2-1cy", "Custom Type Checkers", "Typing"),
        ("0F0ppU_ClIUKZ23Q6BVZp", "Code Formatting", "Formatting"),
        ("DS6nuAUhUYcqiJDmQisKM", "black", "Formatting"),
        ("tsh_vbhzKz1-H9Vh69tsK", "yapf", "Formatting"),
        ("6cB0pvUO1-gvCtgqozP-Q", "ruff", "Formatting"),
        ("WQOYjuwKIWB2meea4JnsV", "Testing", "Testing"),
        ("3FDwJpesfelEyJrNWtm0V", "pytest", "Testing"),
        ("b4he_RO17C3ScNeUd6v2b", "unittest / PyUnit", "Testing"),
        ("aVclygxoA9ePU5IxaORSH", "doctest", "Testing"),
        ("jPFOiwbqfaGshaGDBWb5x", "tox", "Testing"),
        ("maYNuTKYyZndxk1z29-UY", "Sphinx", "Documentation"),
    ]),
    ("concurrency-async", "Concurrency & Async", "Threads, processes, the GIL, and asynchronous Python.", [
        ("u4nRzWQ4zhDFMOrZ2I_uJ", "Concurrency", None),
        ("UIx0XYaOgXXlYbbQtjiPq", "Threading", None),
        ("HSY5OUc_M5S6OcFXPRtkx", "Multiprocessing", None),
        ("bS7WeVKm2kEElu3sBKcIC", "The GIL", None),
        ("Mow7RvropbC4ZGDpcGZmw", "Asynchrony (asyncio)", None),
        ("InUJIGmTnf0X4cSoLuCEQ", "gevent", None),
    ]),
    ("web-frameworks", "Web Frameworks", "The major Python web frameworks and data validation.", [
        ("0-ShORjGnQlAdcwjtxdEB", "Learn a Framework", None),
        ("W3VALz5evFo1qqkQbMN1R", "Pydantic", None),
        ("x1V8GjdjANTnhP6YXMbgC", "Django", None),
        ("HKsGyRzntjh1UbRZSWh_4", "Flask", None),
        ("XeQSmvAsGSTi8dd7QVHxn", "FastAPI", None),
        ("DHtskqATeAVKgaazdhXKD", "Pyramid", None),
        ("9RGpqsj9jHz0_-r7EvRcw", "Sanic", None),
        ("zey2C6BdzsHJAlb_K3qrP", "Tornado", None),
        ("IBVAvFtN4mnIPbIuyUvEb", "aiohttp", None),
        ("7zcpXN3krnS3tMRWVNIVe", "Plotly Dash", None),
    ]),
]

SECTIONS = SECTIONS_PYTHON if COURSE == 'python' else SECTIONS_AI
```
Keep the rest of the script (the loop writing bundles + manifest) unchanged, since it already reads `SECTIONS`, `CONTENT`, and `OUT`. Verify `os.makedirs(OUT, exist_ok=True)` remains.

- [ ] **Step 3: Generate the Python source bundles**

```bash
python3 scripts/build_manifest.py --course python
ls content-src/python
```
Expected: prints `12 sections, 83 topics` and writes `content-src/python/01-getting-started.txt` … `12-web-frameworks.txt` + `manifest.json`.

- [ ] **Step 4: Create `src/data/courses/python/course.json`**

```json
{
  "id": "python",
  "order": 2,
  "title": "Python",
  "tagline": "Master Python from syntax to web frameworks.",
  "description": "The full roadmap.sh/python curriculum — from basic syntax and data structures through OOP, packaging, typing, testing, async, and web frameworks — distilled into focused lessons with runnable code and hands-on labs.",
  "accent": "#3776ab",
  "icon": "🐍",
  "source": { "label": "roadmap.sh/python", "url": "https://roadmap.sh/python" },
  "labLanguages": ["python"]
}
```

- [ ] **Step 5: Author one real section so the course is navigable now: `src/data/courses/python/sections/01-getting-started.json`**

Hand-author this single section following the exact `Section`/`Topic` shape used by the AI course (see `src/data/courses/ai-engineer/sections/01-introduction.json` for reference: `id`, `title`, `description`, `topics[]` with `id`, `title`, `subsection`, `minutes`, `intro`, `summary[]`, `keyPoints[]`, `code[]`, `resources[]`, optional `handsOn`). Cover the "Getting Started" topic (what Python is, installing it, the REPL, running a script). Code snippets are Python; include a small hands-on lab (install Python, run a script, use the REPL) with `python` filled and `javascript: null`. Include 2-3 real, verified resource links (python.org docs).

- [ ] **Step 6: Build, lint, test, and smoke-check**

Run: `npm run build && npm run lint && npm test`
Expected: pass. Then `npm run dev`: the homepage now shows **two** cards (AI Engineer + Python). Open Python → its roadmap renders with 12 sections (only "Getting Started" has content; others are empty until Task 8). Open the Getting Started topic; the lab shows **no language toggle** (Python-only). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Python content pipeline + course shell (Getting Started section)"
```

---

## Task 8: Author the full Python curriculum (multi-agent workflow)

Author the remaining 11 Python sections at AI-track quality using a parallel multi-agent workflow with adversarial link/fact verification, then human-review and merge.

**Files:**
- Create: `src/data/courses/python/sections/02-language-basics.json` … `12-web-frameworks.json` (11 files)

**Interfaces:**
- Consumes: `content-src/python/*.txt` bundles (Task 7); the `Section`/`Topic`/`HandsOnLab` JSON shape; the AI sections as quality references.
- Produces: 11 validated section JSON files conforming to the `Section` type.

- [ ] **Step 1: Capture the exact JSON contract for authors**

Re-read `src/types.ts` (`Section`, `Topic`, `CodeSnippet`, `Resource`, `LabStep`, `HandsOnLab`) and one AI section (`src/data/courses/ai-engineer/sections/09-rag.json`) as the gold-standard example. Note the rules authors must follow:
  - `code[]` and lab `steps[].python` are **Python**; `steps[].javascript` is always `null` (Python-only course).
  - `minutes` is an integer reading estimate (3–6 typical).
  - `resources[]` `type` ∈ `article | video | course | official | opensource`; **every URL must be real and reachable.**
  - Add a `handsOn` lab only where a topic is genuinely practice-worthy (e.g. comprehensions, decorators, exceptions, pytest, packaging with uv/poetry, asyncio, building a Flask/FastAPI app), not on every topic.
  - Section `id`/`title`/`description` and each topic's `id`/`title`/`subsection` must match `content-src/python/manifest.json`.

- [ ] **Step 2: Run the authoring workflow**

Invoke the Workflow tool with the following script (the user approved a parallel multi-agent workflow). It pipelines each of the 11 remaining sections through author → verify → repair, runs them concurrently, and writes the JSON files directly.

```js
export const meta = {
  name: 'author-python-course',
  description: 'Research, author, and verify the 11 remaining Python course sections as Section JSON',
  phases: [
    { title: 'Author' },
    { title: 'Verify' },
    { title: 'Repair' },
  ],
}

const SECTIONS = [
  '02-language-basics', '03-functions-scope', '04-data-structures', '05-oop',
  '06-errors-files-text', '07-advanced-python', '08-dsa', '09-environments-packaging',
  '10-code-quality', '11-concurrency-async', '12-web-frameworks',
]

const AUTHOR = (slug) => `You are authoring one section of a Python learning course, matching the quality and exact JSON shape of an existing reference course.

READ these files first:
- /Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap/src/types.ts (the Section/Topic/HandsOnLab TypeScript types you must conform to)
- /Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap/src/data/courses/ai-engineer/sections/09-rag.json (gold-standard example of depth, tone, structure)
- /Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap/content-src/python/${slug}.txt (the roadmap.sh source text + the exact list of topics, ids, titles, and subsection groups for THIS section)

Then research each topic with web search/fetch as needed to ensure correctness and current best practices (latest stable library versions, official docs). For EACH topic in the bundle, write:
- intro: one punchy sentence.
- summary: 2-3 substantial paragraphs distilling the concept (plain strings; use backticks for inline code).
- keyPoints: 5-6 crisp takeaways.
- code: 1-3 runnable PYTHON snippets ({title, language:'python', code}). Real, correct, idiomatic Python.
- resources: 2-4 links of type article|video|course|official|opensource. Prefer official docs (docs.python.org, library docs). Every URL MUST be real and reachable — do not invent URLs.
- handsOn (ONLY where genuinely practice-worthy): {goal, steps:[{title, explanation, python:"<code>", javascript:null}], practice:["..."]}. This is a Python-only course: javascript is ALWAYS null.

Match topic ids/titles/subsection EXACTLY to the bundle. Conform exactly to the Section JSON shape (look at the reference file). minutes is an integer (3-6).

WRITE the result as valid JSON to:
/Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap/src/data/courses/python/sections/${slug}.json

Return a short summary: section id, topic count, and which topics got a handsOn lab.`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    validJson: { type: 'boolean' },
    schemaOk: { type: 'boolean' },
    idsMatchManifest: { type: 'boolean' },
    deadLinks: { type: 'array', items: { type: 'string' } },
    factualIssues: { type: 'array', items: { type: 'string' } },
    codeIssues: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['pass', 'repair'] },
  },
  required: ['validJson', 'schemaOk', 'idsMatchManifest', 'deadLinks', 'factualIssues', 'codeIssues', 'verdict'],
}

const VERIFY = (slug) => `Adversarially verify the authored section JSON at:
/Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap/src/data/courses/python/sections/${slug}.json

Checks:
1. It is valid JSON and conforms to the Section/Topic/HandsOnLab shape in src/types.ts (read it). All lab steps have javascript:null.
2. Topic ids/titles/subsection match content-src/python/${slug}.txt's topic list.
3. Every resource URL is REAL and reachable — actually fetch a sample of them; list any that 404 / redirect to unrelated pages / look invented.
4. Code snippets are syntactically valid, idiomatic, current Python; note any bugs.
5. Factual claims are correct and current (library versions, behavior).
Be skeptical; default to 'repair' if anything is wrong. Report findings in the schema.`

const REPAIR = (slug, findings) => `The section JSON at src/data/courses/python/sections/${slug}.json (under the project root /Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap) has these verified problems that you must FIX in place by rewriting the file:

${JSON.stringify(findings, null, 2)}

Re-read src/types.ts and content-src/python/${slug}.txt. Replace any dead/invented URLs with real, verified ones (fetch to confirm). Fix code and factual issues. Keep ids/titles/subsection matching the bundle and lab javascript:null. Write the corrected valid JSON back to the same path. Return a one-line summary of what you changed.`

const results = await pipeline(
  SECTIONS,
  (slug) => agent(AUTHOR(slug), { label: `author:${slug}`, phase: 'Author' }).then(() => slug),
  (slug) => agent(VERIFY(slug), { label: `verify:${slug}`, phase: 'Verify', schema: VERIFY_SCHEMA }).then((v) => ({ slug, v })),
  async ({ slug, v }) => {
    if (!v || v.verdict === 'pass') return { slug, status: v ? 'pass' : 'unknown' }
    const findings = { deadLinks: v.deadLinks, factualIssues: v.factualIssues, codeIssues: v.codeIssues, schemaOk: v.schemaOk, idsMatchManifest: v.idsMatchManifest }
    await agent(REPAIR(slug, findings), { label: `repair:${slug}`, phase: 'Repair' })
    return { slug, status: 'repaired' }
  },
)

return results
```

- [ ] **Step 3: Validate every section file parses and conforms**

```bash
python3 - <<'PY'
import json, glob, os
root = '/Users/abhipandey/Desktop/Folders/Fun_Projects/ai-engineer-roadmap'
man = {s['id']: s for s in json.load(open(f'{root}/content-src/python/manifest.json'))}
total = 0
for f in sorted(glob.glob(f'{root}/src/data/courses/python/sections/*.json')):
    d = json.load(open(f))  # raises on invalid JSON
    assert d['id'] in man, f"unknown section id {d['id']}"
    ids = [t['id'] for t in d['topics']]
    want = [t['id'] for t in man[d['id']]['topics']]
    assert ids == want, f"{d['id']} topic ids/order mismatch:\n got {ids}\n want {want}"
    for t in d['topics']:
        for s in t.get('handsOn', {}).get('steps', []):
            assert s.get('javascript') is None, f"{d['id']}/{t['id']} lab step has non-null javascript"
        total += len(t['code'])
    print(f"OK {d['id']}: {len(d['topics'])} topics")
print('sections:', len(glob.glob(f'{root}/src/data/courses/python/sections/*.json')))
PY
```
Expected: every section prints OK, 12 section files total (Getting Started + 11), ids/order match the manifest, all lab steps Python-only.

- [ ] **Step 4: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: pass (Vite globs the new JSON automatically; no code change needed).

- [ ] **Step 5: Human review + manual smoke**

Run `npm run dev`. Open the Python course: all 12 sections populated; spot-read 3-4 topics across different sections for accuracy and tone; open 2-3 hands-on labs (no language toggle, Python code copies cleanly); click a sample of "Go deeper" resource links and confirm they resolve; mark progress and confirm the homepage Python card shows a progress bar. Read each section's content briefly and request repairs for anything weak before finalizing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: full Python curriculum content (12 sections, 83 topics)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Branded Pathwise homepage (hero + cards) → Task 5. ✓
- Two courses, AI unchanged + Python full parity → Task 2 (move/registry) + Tasks 7–8 (Python). ✓
- Per-course reading/labs/search/progress/theme → Task 4 (CourseApp + scoped components). ✓
- Shareable URLs + back/forward → Task 1 (router) + Task 5 (wiring). ✓
- Progress migration (no reset) → Task 4 (status/last) + Task 3 (practice) + Task 6 (pre-paint theme). ✓
- Per-course lab languages (Python-only hides toggle) → Task 3 + Task 7 (`labLanguages: ["python"]`). ✓
- Zero new runtime deps; build+lint green → Global Constraints + per-task verify. ✓
- Content pipeline generalized + workflow authoring with verification → Tasks 7–8. ✓
- Adding a course = drop a folder → registry globs `courses/*` (Task 2); documented in README (Task 6). ✓

**Placeholder scan:** No "TBD"/"implement later". The two hand-authored content steps (Task 7 Step 5, Task 8) specify exact files, the exact JSON contract, the reference file to mirror, and validation gates — content authored against a concrete schema, not a placeholder.

**Type consistency:** `topicKey(courseId, sectionId, topicId)` defined in Task 4 Step 3 and used with that 3-arg signature in Sidebar/RoadmapView/TopicView/SearchPalette/CourseApp/HomePage. `Course` fields (`accent`, `icon`, `labLanguages`, `source`) defined in Task 2 match their use in HomePage/Sidebar/TopicView and the `course.json` files. `Route` (Task 1) is consumed by `useRoute`/App/CourseApp consistently. `namespaceKeys`, `getLastTopic(courseId)`, `saveLastTopic(courseId, key)` signatures match across useProgress and CourseApp. `courseTopicCount`/`courseMinutes` names consistent across data/index.ts, RoadmapView, HomePage, CourseApp.
