# Pathwise — Multi-Course Platform + Python Track

**Date:** 2026-06-29
**Status:** Approved design, pending spec review

## 1. Goal

Turn the current single-course **AI Engineer** learning app into **Pathwise**, a
minimalist multi-course learning platform with a branded homepage, and add a full
**Python** track at the same quality as the existing AI track (distilled theory,
key points, runnable code, hands-on labs, verified references). The platform must
make adding future courses cheap: drop a content folder + one registry entry.

### Success criteria

- A branded Pathwise homepage (hero + course cards) lists all courses with per-course progress.
- Two working courses: **AI Engineering** (existing content, unchanged) and **Python** (new, full roadmap.sh/python parity).
- Each course keeps today's reading experience: roadmap timeline, topic reader, hands-on labs, ⌘K search, progress tracking, light/dark.
- Shareable URLs: `#/`, `#/python`, `#/python/<section>/<topic>`. Back/forward works.
- Existing users' AI-track progress is preserved (migrated, not reset).
- `npm run build` and `npm run lint` pass; zero new runtime dependencies.

## 2. Chosen approach

**Approach A — course-scoped refactor + tiny hash router.** (Rejected: B "no router,
global sections" — collision-prone, no shareable URLs, scales badly; C "react-router" —
adds a runtime dependency the project deliberately avoids.)

Rationale: preserves the project's zero-runtime-dependency, minimalist philosophy;
isolates each course so the reading/lab/search code is reused, just scoped; gives
shareable deep links; and makes new courses a drop-in.

## 3. Architecture

### 3.1 Data model

Add a `Course` type (in `src/types.ts`). `Section`, `Topic`, `HandsOnLab`, etc. are unchanged.

```ts
export interface Course {
  id: string                                  // 'ai-engineer' | 'python'
  order: number                               // sort order on the homepage
  title: string                               // 'AI Engineer'
  tagline: string                             // short card line
  description: string                          // 1–2 sentence card body
  accent: string                              // per-course accent (hex)
  icon: string                                // emoji/glyph for the card
  source: { label: string; url: string }      // e.g. roadmap.sh/python
  labLanguages: Array<'python' | 'javascript'> // single entry → lab lang toggle hidden
  sections: Section[]
}
```

### 3.2 Content layout (file moves + new files)

```
src/data/
  index.ts                       # course registry (rewritten)
  courses/
    ai-engineer/
      course.json                # meta (title, tagline, accent, icon, source, labLanguages, order)
      sections/*.json            # MOVED from src/data/sections/*.json (unchanged content)
    python/
      course.json
      sections/*.json            # NEW (authored by the workflow)
```

`src/data/index.ts` globs `./courses/*/course.json` + `./courses/*/sections/*.json`,
assembles a `Course[]` sorted by `order`, and exposes:
`courses`, `getCourse(id)`, and per-course `totalTopics(course)` / `totalMinutes(course)` helpers.

### 3.3 Routing — tiny hash router (no dependency)

New `src/hooks/useRoute.ts` (~40 lines). Parses `location.hash`:

- `#/` (or empty) → `{ kind: 'home' }`
- `#/<courseId>` → `{ kind: 'course', courseId }`
- `#/<courseId>/<sectionId>/<topicId>` → `{ kind: 'topic', courseId, sectionId, topicId }`

Listens to `hashchange`; exposes `navigate(path)` that sets `location.hash`. Unknown
course/topic falls back to home. This replaces App's `view` state machine and the
manual scroll-restore wiring stays (keyed off route changes).

### 3.4 Component structure

- `App.tsx` — reads the route; renders `HomePage` or `CourseApp` (and within it, roadmap vs topic). Owns global theme + status hooks.
- `HomePage.tsx` (new) — Pathwise hero + course-card grid (see §4).
- `CourseApp.tsx` (new) — extracts today's Sidebar + RoadmapView/TopicView shell, scoped to one `course`. Receives the course, statuses, route.
- `Sidebar.tsx` — brand becomes **Pathwise** (logo) with course title beneath; clicking the brand routes home. Section list + footer source link are per-course.
- `RoadmapView.tsx`, `TopicView.tsx`, `SearchPalette.tsx` — take `course` (its sections) instead of the global `sections` import. Stats computed for that course.
- `HandsOnLab.tsx` — accepts `labLanguages`; renders the lang toggle only if length > 1. Python course passes `['python']` → Python-only, no toggle.
- `Logo.tsx`, `Inline.tsx` — unchanged.

### 3.5 Progress + persistence (namespaced, with migration)

Topic ids can repeat across courses, so progress keys become
`${courseId}/${sectionId}/${topicId}`.

localStorage keys (rename `aie-*` → `pathwise-*`, migrate on first load):

| Concern | New key | Migration |
|---|---|---|
| Statuses | `pathwise-status` | from `aie-status`, prefixing each key with `ai-engineer/` |
| Last topic | `pathwise-last` (map: courseId → "section/topic") | from `aie-last-topic` under `ai-engineer` |
| Theme | `pathwise-theme` | from `aie-theme` |
| Lab language | `pathwise-lab-lang` | from `aie-lab-lang` |
| Practice checks | `pathwise-practice` | from `aie-practice`, keys prefixed with `ai-engineer/` |

Migration runs once (guarded by presence of the new key). The pre-paint theme script
in `index.html` is updated to read `pathwise-theme` with `aie-theme` fallback.

"Continue learning" becomes per-course (last topic for that course, else first unfinished).

## 4. Homepage (Pathwise hub)

Layout: **hero + course cards** (light/dark, max-width centered, same type system).

- **Hero:** Pathwise wordmark + winding-road `Logo`; headline "Learn by building."; sub "Interactive roadmaps with hands-on labs and runnable code." Theme toggle top-right.
- **Course grid:** responsive cards (1 col mobile / 2+ desktop). Each card:
  accent rail + `icon`, course title, one-line description, stats (`N topics · ~Hh`),
  a progress bar + `%` (from namespaced statuses), and a **Start / Continue** button
  → `#/<courseId>` (Continue deep-links to the course's continue target).
- **Coming-soon card:** muted, non-clickable "+ More tracks soon".
- **Footer:** attribution to roadmap.sh.

Global cross-course search is **out of scope** for v1 (search stays per-course inside a course). Noted as a future enhancement.

## 5. Python track content

Source: roadmap.sh/python (83 nodes in `kamranahmedse/developer-roadmap`
`src/data/roadmaps/python`). Grouped into 12 sections:

1. Getting Started · 2. Language Basics · 3. Functions & Scope · 4. Data Structures ·
5. Object-Oriented Programming · 6. Errors, Files & Text · 7. Advanced Python ·
8. Data Structures & Algorithms · 9. Environments & Packaging · 10. Code Quality
(typing/formatting/testing/docs) · 11. Concurrency & Async · 12. Web Frameworks.

Each topic uses the existing `Topic` shape: `intro`, `summary[]`, `keyPoints[]`,
`code[]` (Python), optional `handsOn` lab (Python-only), `resources[]` (verified links).
Labs are added where a topic is genuinely hands-on (e.g. building a Flask/FastAPI app,
writing pytest tests, packaging with uv/poetry, asyncio), not on every node.

### 5.1 Content pipeline

- Generalize `scripts/build_manifest.py` to take a course id + its SECTIONS node map; add the Python SECTIONS mapping; output source bundles to `content-src/python/*.txt` and a `content-src/python/manifest.json`.
- Author the per-section JSON with the **parallel multi-agent workflow**:
  1. **Gather** — per topic, pull the roadmap.sh node markdown + targeted web research (current libraries/versions, official docs).
  2. **Author** — pipeline per section: draft each topic into the `Topic` JSON shape, including labs where warranted.
  3. **Verify (adversarial)** — independent agents check factual claims and confirm every resource URL is real/reachable; reject/repair failures.
  4. **Merge** — write `src/data/courses/python/sections/*.json`; human review before finalizing.

## 6. Non-goals (YAGNI)

No backend, accounts, or sync. No SSR. No react-router or other runtime deps. No global
cross-course search in v1. No course-authoring UI. No changes to AI-track content.

## 7. Verification

- `npm run build` (tsc -b + vite build) passes; `npm run lint` clean.
- Manual smoke: home lists both courses with correct stats → open each course → open a
  topic → lab renders (toggle hidden for Python) → mark progress, reload, progress
  persists and homepage % updates → deep-link a `#/python/<section>/<topic>` URL loads
  directly → back/forward works → theme toggle persists → a pre-existing `aie-status`
  blob migrates so old AI progress survives.
- Spot-check a sample of Python resource links resolve (the verify phase covers the rest).

## 8. Risks & mitigations

- **Content accuracy / link rot** → adversarial verify phase; human review of merged JSON.
- **Python content volume** → workflow batched by section; review section-by-section.
- **Progress migration bug** → explicit migration test in the smoke checklist; migration is additive (old keys untouched) so it's reversible.
- **Scope creep on homepage** → fixed to the approved hero+cards layout; extras deferred.
