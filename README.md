# Pathwise — Interactive Learning Roadmaps

A minimal, modern learning platform. Each course distills an official [roadmap.sh](https://roadmap.sh) curriculum **and** its recommended articles/docs into short summaries, key points, runnable code, hands-on labs, and curated "go deeper" links — so you can learn in focused 1–2 hour sessions without hopping across tabs.

**Tracks**

- **AI Engineer** — the full [roadmap.sh/ai-engineer](https://roadmap.sh/ai-engineer) curriculum (15 sections, 170+ topics): LLMs, prompting, RAG, agents, MCP, evals, and more.
- **Python** — the full [roadmap.sh/python](https://roadmap.sh/python) curriculum (12 sections, 80+ topics): from syntax and data structures through OOP, packaging, typing, testing, async, and web frameworks.

More tracks will be added over time.

## Run it

```bash
npm install
npm run dev
```

Other scripts: `npm run build` (typecheck + production build), `npm run lint`, `npm test` (Vitest unit tests).

## Features

- **Pathwise homepage** — a branded hub of course cards, each showing topic count, estimated hours, and your progress.
- **Per-course roadmap timeline** — all sections and topics at a glance, grouped the same way as roadmap.sh.
- **Reading view per topic** — summary, key points, code with a copy button, and resources that open in a new tab.
- **Hands-on labs** — step-by-step labs with runnable code; multi-language courses (AI) offer a language toggle, single-language courses (Python) don't.
- **Progress tracking** — mark topics complete; saved per-course in localStorage; "Continue learning" picks up where you left off.
- **Search** — `⌘K` fuzzy search across the current course's topics.
- **Shareable URLs** — hash routing: `#/`, `#/python`, `#/python/<section>/<topic>`. Back/forward works.
- **Keyboard navigation** — `←` / `→` between topics, `D`/`I`/`S`/`R` to set status, `esc` back.

## Adding a course

The data layer auto-discovers courses, so adding one is a drop-in:

1. Create `src/data/courses/<course-id>/course.json` (id, order, title, tagline, description, accent, icon, source, `labLanguages`).
2. Add `src/data/courses/<course-id>/sections/*.json` section files (the `Section`/`Topic` shape in `src/types.ts`).

It appears on the homepage automatically — no code changes.

## Content pipeline

- `scripts/build_manifest.py [--course ai-engineer|python]` pulls topic structure + source text from the roadmap.sh open-source repo into `content-src/<course>/`.
- Enriched per-section JSON lives in `src/data/courses/<course>/sections/*.json` — edit freely; the app picks up any file matching that glob.
