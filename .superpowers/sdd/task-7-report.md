# Task 7 report — Runtime, terminal, and environment UI

## Design plan

Pathwise learners move between a lightweight browser notebook and an isolated project workbench. The playground should make that change in execution model unmistakable without turning the page into a dashboard.

- Palette: preserve the existing Pathwise tokens: `--bg` (`#ffffff` / `#0a0a0a`) for the canvas, `--fg` (`#000000` / `#f5f5f5`) for primary ink, `--gray-1` (`#fafafa` / `#151515`) for quiet surfaces, `--border` (`#d9d9d9` / `#262626`) for seams, and `--accent` (`#e8590c` / `#ff6b1a`) only for selected/executing state.
- Type: preserve `--font` (Inter/system sans) for navigation, labels, and actions; preserve `--mono` for runtime status, commands, environment keys, and output. Headings use the existing compact, heavy sans role.
- Layout:

  ```text
  ┌ Pathwise / Project workbench ───────────────────────────────┐
  │  ● Browser Python ─── ○ Cloud Python ─── ○ Cloud Node       │
  ├──────────────── editor ───────┬──────── terminal seam ──────┤
  │ files + code                  │ output / command input       │
  │ run controls                  ├──────────────────────────────┤
  │                               │ environment + session        │
  └───────────────────────────────┴──────────────────────────────┘
  ```

  Below the existing mobile breakpoint, the rail and panels stack in reading order.
- Signature: a precise three-position runtime rail. Its selected marker drops a one-pixel accent seam into the terminal, making engine choice and execution state read as one instrument. All other controls stay flat, quiet, and utilitarian.

### Generic-default critique

The first temptation is a familiar three-card selector with icons, rounded gradients, status pills, and elevated panels. That would read as a generic AI control center and compete with the editor. The plan instead uses one connected rail, plain names, existing black/white/orange tokens, no new font, no decorative gradient, and a single active seam. Runtime status is information attached to each position, not badge decoration.

## RED / GREEN

- RED 1: `npm test -- --run src/components/python/PackageTerminal.test.ts` failed because `./PackageTerminal` did not exist. This established the six required terminal behaviors before implementation.
- GREEN 1: the focused suite passed 6/6 after adding `submitTerminalInput` and `PackageTerminal`.
- RED 2: the focused suite failed 4/4 browser-incompatibility cases because `isBrowserPackageIncompatibility` did not exist.
- GREEN 2: the focused suite passed 10/10 after adding the detection helper and inline-runner fallback.
- RED 3: the focused suite failed 2/2 runtime filename cases because `uniqueRuntimeName` did not exist.
- GREEN 3: the focused suite passed 12/12 after adding `.js` defaults and collision handling for Cloud Node.

## Verification

- Focused: `npm test -- --run src/components/python/PackageTerminal.test.ts` — 1 file, 12 tests passed.
- Full: `npm test -- --run` — 18 files, 269 tests passed.
- Lint: `npm run lint` — zero errors.
- Build: `npm run build` — succeeded. Vite retains its existing advisory that some generated chunks exceed 500 kB.
- Hygiene: `git diff --check` — clean.

## Browser smoke and visual critique

I started the local Vite server successfully, but the browser-control runtime reported that no browser backend was available, including after the documented discovery check. No screenshot or browser interaction result is claimed.

The source/layout critique found and fixed two material issues:

1. Cloud setup guidance was initially rendered only when a cloud runtime was selected, but disabled cloud options could not be selected from the default browser state. The notice now appears as soon as capabilities report cloud disabled.
2. Cloud Node initially inherited the existing `.py` filename suggestion. A tested runtime-aware filename helper now suggests collision-free `.js` names while preserving `.py` for both Python modes.

The signature remains concentrated in the three-position rail and its active seam. Rounded controls are limited to the project’s existing compact action language; no cards, gradients, new typography, or decorative badges were added.

## Self-review

- Runtime choice is explicit, Browser Python remains the default, and capability status is announced in text rather than color alone.
- The browser package surface is labeled “Packages and output,” avoiding the claim that Pyodide exposes a real terminal.
- Cloud file execution synchronizes all editor files before running the active file; extension mismatch errors are shown in the terminal rather than escaping as unhandled promises.
- Terminal commands use the shared parser, secret exports do not enter history, and output/history redact known secret values.
- Environment variables, secret values, and access tokens remain in React memory. The only new storage is the one-time code handoff, consumed and removed during playground initialization; existing editor persistence remains unchanged.
- Inputs have labels, status/output regions use `aria-live`/`role="log"`, focus is visible, reduced motion is respected, and runtime/environment layouts stack on narrow screens.
- Inline course runners keep their Browser Python execution path and add only the incompatibility handoff action.
