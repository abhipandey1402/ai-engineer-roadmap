# AI Engineer — Interactive Learning Roadmap

A minimal black & white learning app covering the full [roadmap.sh/ai-engineer](https://roadmap.sh/ai-engineer) curriculum — 15 sections, 170+ topics. Each topic distills the official roadmap text **and** its recommended articles/docs into a short summary, key points, runnable code snippets, and curated "go deeper" links, so you can learn in short 1–2 hour sessions without hopping across tabs.

## Run it

```bash
npm install
npm run dev
```

## Features

- **Interactive roadmap timeline** — all sections and topics at a glance, grouped the same way as roadmap.sh
- **Reading view per topic** — summary, key points, code with copy button, resources that open in a new tab
- **Progress tracking** — mark topics complete; saved in localStorage; "Continue learning" picks up where you left off
- **Search** — `⌘K` fuzzy search across every topic
- **Keyboard navigation** — `←` / `→` between topics, `esc` back to the roadmap

## Content pipeline

- `scripts/build_manifest.py` pulls topic structure + source text from the roadmap.sh open-source repo into `content-src/`
- Enriched per-section JSON lives in `src/data/sections/*.json` — edit freely; the app picks up any file matching that glob
