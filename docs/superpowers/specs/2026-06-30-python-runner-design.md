# Pathwise — In-browser Python Runner

**Date:** 2026-06-30
**Status:** Approved design

## 1. Goal

Let learners write, run, test, and REPL real Python **inside Pathwise** — no leaving
the page, no external tools. Three surfaces:

1. **Inline in labs** — every Python lab code step gets a "Run" affordance, and the
   practice list gets a scratch pad, so learners experiment where they read.
2. **A standalone Playground product** — a dedicated page (own homepage card +
   `#/playground` route) with a multi-file editor, output console, and REPL.
3. **One reusable component** powering all of the above.

### Success criteria

- Clicking **Run** on a Python lab step executes it and shows stdout/stderr in place.
- The Playground supports multiple `.py` files (so imports/tests work), a REPL, and
  Run/Stop/Reset. Files and lab edits persist across reloads (localStorage).
- A runaway loop never freezes the UI and can be stopped.
- AI-engineer course is **unchanged** (stays copy-snippets); runner is gated to the
  Python course via one opt-in flag.
- No backend, no Vite/Vercel/asset config changes. `npm run build`, `npm run lint`,
  `npm test` pass.

## 2. Chosen approach

**Pyodide (CPython 3.14, WASM) running in a Web Worker, loaded from the jsDelivr CDN.**

- *In-browser* (vs a backend python3 service): no server, no sandbox to harden, $0,
  works on the current static Vercel deploy. Rejected backend (infra + security + not
  "least changes") and third-party API (external dep, rate limits).
- *Web Worker* (vs main thread): execution is off the UI thread, so the page never
  freezes; **Stop** = terminate + respawn the worker, which also kills infinite loops.
- *CDN load* (vs bundling/self-hosting the ~12MB of WASM + stdlib): confirmed
  `https://cdn.jsdelivr.net/pyodide/v314.0.2/full/` serves the matching version, so
  there are **zero build/asset changes**. Trade-off: first run fetches ~6MB over the
  network (browser-cached after). Self-hosting is a later option if offline is needed.

The `pyodide` npm package is added for its **TypeScript types only**; the runtime
loader + assets come from the CDN (`import(/* @vite-ignore */ '<cdn>/pyodide.mjs')`),
so our worker bundle stays tiny and loader/asset versions always match.

## 3. Architecture

### 3.1 Engine (off-main-thread)

```
src/lib/python/
  protocol.ts        # shared message types (Req/Res), PYODIDE_VERSION, CDN url
  python.worker.ts   # module worker: boots Pyodide lazily; handles messages
  client.ts          # PythonClient singleton wrapping the worker
```

**Worker message protocol** (request id correlates response):

- `run { code }` → executes code; streams `output { stream:'stdout'|'stderr', text }`
  messages during execution; resolves `done { ok, error? }`.
- `repl { code }` → runs in a persistent namespace; resolves with the repr of the last
  expression value (or empty) plus any streamed output.
- `writeFile { name, content }`, `readFile { name }`, `listFiles {}`,
  `deleteFile { name }` → virtual FS under `/home/pyodide`.
- `reset {}` → clears the global namespace (fresh `__main__`); does not reload the engine.
- Lifecycle: worker posts `status { state:'loading'|'ready' }` and `output` events
  unsolicited; everything else is request/response.

stdout/stderr are captured via Pyodide's `setStdout`/`setStderr` with `batched`
callbacks and posted as `output` events so the console streams live.

**`PythonClient`** (singleton, module-level): spawns the worker
(`new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })`),
tracks pending requests by id, fans `output`/`status` events to subscribers, and
exposes `run`, `repl`, file ops, `reset`, and `stop()` (terminate + respawn, then
re-emit `idle`). One engine is shared across the whole app.

### 3.2 React hook

`src/hooks/usePython.ts` — wraps the singleton client:

- `status`: `'idle' | 'loading' | 'ready' | 'running'`
- `run(code)`, `runRepl(code)`, `stop()`, `reset()`, file ops
- `output`: ordered buffer of `{ stream, text }` chunks + `clearOutput()`
- subscribes to client output/status on mount, unsubscribes on unmount

### 3.3 UI components

```
src/components/python/
  PythonRunner.tsx   # editor + toolbar + console; variant: 'inline' | 'full'
  Repl.tsx           # interactive prompt + scrollback
  FileTabs.tsx       # create/rename/delete/select .py files (Playground)
  PlaygroundApp.tsx  # full-page: FileTabs + PythonRunner(full) + Repl toggle
```

- **PythonRunner**: enhanced `<textarea>` (monospace, Tab→2 spaces, ⌘/Ctrl+Enter =
  Run), toolbar (Run / Stop while running / Reset / Clear), and a color-coded output
  console. First run shows "Starting Python…". Optional `storageKey` persists edits.
  No syntax-highlighting dependency in v1 (CodeMirror is a noted future upgrade).
- **Repl**: input line + scrollback of `>>> code` / result / output; ↑/↓ history.
- **FileTabs**: manages a `{ name: content }` map (pure reducer, unit-tested) and
  syncs each file into the worker FS before running the active file.

### 3.4 Inline integration (Python course only)

- `src/types.ts`: add `runnablePython?: boolean` to `Course`.
- `src/data/courses/python/course.json`: set `"runnablePython": true`. AI course
  omits it → unchanged.
- `HandsOnLab.tsx`: when `runnablePython` and active lang is `python`, `StepCode`
  gains a **Run ▶** toggle expanding `<PythonRunner variant="inline">` seeded with the
  step's code (copy button stays). Below the practice list, a collapsible
  **"Scratch pad — try it here"** blank inline runner. `storageKey` derives from
  `topicKey:stepIndex` so edits persist (same localStorage convention as practice).
- `TopicView.tsx` passes `course.runnablePython` to `HandsOnLab`.

### 3.5 Playground product + routing

- `src/hooks/useRoute.ts`: add `{ kind: 'playground' }`; `parseHash` reserves the
  single-part hash `playground` (course ids are `python`/`ai-engineer`, no collision).
- `src/App.tsx`: render `PlaygroundApp` for the playground route.
- `src/components/HomePage.tsx`: add a "Python Playground" card that navigates to
  `#/playground`.
- `PlaygroundApp.tsx`: header + FileTabs + PythonRunner(full) + a REPL panel toggle;
  files persisted to localStorage under `pathwise-playground-files`.

### 3.6 Styling

Scoped `.py-*` classes appended to `src/index.css`, reusing existing tokens
(`--mono`, `--code-bg`, `--code-fg`, `--accent`, `--border`, etc.) so the runner
matches the existing `.lab-code` / `.code-block` look in both themes.

## 4. Testing

Vitest (node env, already configured). Unit-test the pure logic:

- `parseHash` → playground route (and that `playground` doesn't parse as a course).
- FileTabs reducer (add/rename/delete/select, name collisions, last-file guard).
- Output-buffer formatting/coalescing.
- `PythonClient` request/response correlation against a mock `Worker`.

Pyodide-in-WASM can't run under node vitest; engine execution is verified manually
in-browser (`npm run dev`): run a lab step, multi-file import in the Playground, a
REPL session, and Stop on an infinite loop.

## 5. Files

**New (~8):** `lib/python/{protocol,python.worker,client}.ts`,
`hooks/usePython.ts`, `components/python/{PythonRunner,Repl,FileTabs,PlaygroundApp}.tsx`,
plus test files.

**Edited (~7):** `types.ts`, `data/courses/python/course.json`, `HandsOnLab.tsx`,
`TopicView.tsx`, `hooks/useRoute.ts`, `App.tsx`, `HomePage.tsx`, `index.css`,
`package.json` (pyodide dep).

**Unchanged:** `vite.config.ts`, `vercel.json`, build pipeline, AI-engineer content.
