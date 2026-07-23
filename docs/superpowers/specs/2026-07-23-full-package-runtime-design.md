# Pathwise Full Package Runtime

**Date:** 2026-07-23  
**Status:** Approved for planning

## 1. Goal

Let learners install packages and run realistic Python and Node.js projects from
the Pathwise playground:

```sh
pip install openai numpy
export OPENAI_API_KEY="..."
python rag_minimal.py
```

and:

```sh
npm install openai
node example.mjs
```

The feature must preserve the current fast in-browser Python experience while
adding an isolated cloud runtime for packages and commands that cannot run in a
browser.

### Success criteria

- The standalone playground offers Browser Python, Cloud Python, and Cloud Node
  runtimes.
- Cloud Python runs Python 3.13 and supports normal `pip install` commands,
  including compatible native Linux wheels and source builds supported by the
  sandbox image.
- Cloud Node supports normal `npm install` commands and runs JavaScript files.
- A terminal accepts a deliberately bounded command set and streams stdout,
  stderr, exit status, and lifecycle state.
- Editor files synchronize into a session workspace before execution.
- Browser Python keeps using Pyodide and can explicitly install packages through
  `micropip`; Pyodide-provided imports continue to auto-load.
- An incompatible browser package produces an actionable message and an “Open in
  Cloud Playground” path instead of implying all PyPI packages work in WebAssembly.
- Secrets are masked, kept out of localStorage, command history, URLs, analytics,
  and ordinary output.
- Cloud execution is disabled unless the deployment has Vercel Sandbox
  authentication and an explicit access/abuse-control policy.
- Existing course behavior, tests, and static browser execution continue working.

## 2. Runtime strategy

### 2.1 Browser Python

The current Pyodide Web Worker remains the default for course labs and quick
playground work. It has no server cost, starts lazily, and cannot access the host
system.

Add an explicit install operation backed by `micropip.install`. It supports:

- pure-Python wheels from PyPI;
- packages already built for Pyodide/WASM, including NumPy;
- compatible wheel URLs.

It cannot support arbitrary native C, C++, Fortran, or Rust extensions unless a
matching Pyodide wheel exists. It also cannot provide a real shell, Node.js, OS
processes, Docker, or arbitrary system packages.

### 2.2 Cloud Python and Cloud Node

Cloud modes use Vercel Sandbox through server-only API functions. Every active
playground session receives an ephemeral, isolated microVM with:

- Python 3.13 or Node.js 24;
- a private filesystem rooted at `/vercel/sandbox/workspace`;
- normal `pip`, `python`, `npm`, and `node` executables;
- bounded runtime and idle lifetime;
- explicit network policy;
- no implicit access to the production deployment environment.

This is the closest accurate implementation of “all pip/npm packages.” Individual
packages can still fail because of upstream platform requirements, unavailable
system libraries, unsupported CPU/GPU hardware, package bugs, registry outages,
or resource limits. The terminal reports the real failure rather than hiding it.

### 2.3 Rejected alternatives

- **Pyodide plus WebContainers only:** lower infrastructure cost, but it cannot
  meet broad native pip compatibility and WebContainers add cross-origin
  isolation and browser-compatibility constraints.
- **Run commands directly in a Vercel Function:** functions are not an isolation
  boundary for arbitrary user code and do not provide a durable project process.
- **Third-party execution API:** adds another runtime vendor, credential, quota,
  and failure surface while the project already targets Vercel.

## 3. User experience

### 3.1 Runtime selector

The standalone playground header gains a runtime selector:

- **Browser Python** — current Pyodide runtime; default and always available.
- **Cloud Python** — Vercel Sandbox with Python 3.13.
- **Cloud Node** — Vercel Sandbox with Node.js 24.

Changing between browser and cloud mode does not delete editor files. Changing
between Cloud Python and Cloud Node restarts the cloud session so runtime state is
unambiguous.

If cloud execution is not configured, cloud choices remain visible but disabled
with a setup explanation. This makes the limitation discoverable without breaking
the existing playground.

### 3.2 Terminal

The output pane becomes a terminal-like command surface in cloud modes. It supports
structured forms of:

- `pip install <requirements...>`
- `python <file> [args...]`
- `npm install [packages...]`
- `node <file> [args...]`
- `export NAME=value`
- `pwd`
- `ls [path]`

The client parses commands for immediate feedback, but the server validates them
again. The server invokes an executable with an argument array; it does not
interpolate user input into `sh -c`.

Shell operators and commands outside the allowlist are rejected in the first
version. This avoids presenting a partially secured general-purpose shell while
still covering package installation and program execution.

In Browser Python, the same surface accepts `pip install <requirements...>` as a
learner-friendly alias for `micropip.install`. Other shell commands stay
unavailable, and the UI labels this as a package installer rather than a real
terminal.

Terminal history excludes secret-setting commands. Output is streamed when the
hosting runtime supports streaming; otherwise it is returned in ordered chunks
with the same client protocol.

### 3.3 Editor execution

Before Run:

1. Validate file names and total project size.
2. Synchronize all editor files into the active sandbox workspace.
3. Select `python <active-file>` for `.py`, or `node <active-file>` for `.js`,
   `.mjs`, and `.cjs`.
4. Stream output and final exit status.

The existing Run and Stop controls remain. Cloud mode also exposes Restart Session
and Destroy Session. An idle session is destroyed automatically.

### 3.4 Inline course runners

Course runners remain Browser Python. When Pyodide cannot load a package, the
runner explains whether it needs a pure-Python/Pyodide wheel and offers to copy the
current code into Cloud Python in the standalone playground.

This avoids paying for cloud sandboxes during ordinary lesson exercises.

### 3.5 Environment variables and secrets

The UI distinguishes ordinary environment variables from secrets:

- ordinary values may be retained in sessionStorage for the browser tab;
- secret values are held only in React memory by default;
- secret fields are masked and have an explicit Clear action;
- neither kind is written into project files automatically;
- command history never records values from secret-setting commands.

The deployment's OpenAI API key must not be exposed to the browser or made readable
inside arbitrary user code. The preferred production path is Vercel Sandbox
credential brokering/request proxying so authorization is injected only on an
approved outbound OpenAI request.

For local development or an owner's private deployment, temporary BYOK is an
explicit fallback. The UI warns that the value is sent to the ephemeral sandbox,
does not persist it, and redacts exact matches from output. Redaction reduces
accidental display but is not a security boundary against deliberately hostile
code, so public deployments must not inject a shared raw secret into the sandbox.

## 4. Architecture

### 4.1 Shared protocol

Add `src/lib/sandbox/protocol.ts` with runtime-independent request and response
types:

- runtime: `python` or `node`;
- session state: `disabled`, `creating`, `ready`, `running`, `stopping`, `error`;
- command: executable, argument array, environment-variable names, and request ID;
- file: normalized relative path and UTF-8 content;
- output: request ID, `stdout`/`stderr`, sequence, text;
- result: exit code, timeout flag, duration, and normalized error code.

The protocol contains no Vercel SDK types so it can be tested and used by the
browser without importing server-only code.

### 4.2 Server-only sandbox service

Add server code under `api/` plus focused modules under `server/sandbox/`:

- `config` — validates feature flags, authentication, limits, and runtime names;
- `sessionStore` — maps a signed opaque session cookie to a Vercel Sandbox ID and
  last-access time;
- `commands` — validates the allowlist and argument limits;
- `files` — normalizes paths, blocks traversal, and enforces project limits;
- `redaction` — removes known temporary secret values from output;
- `service` — creates, reconnects, runs, stops, and destroys sandboxes;
- API handlers — status, session create/destroy, file sync, command run, and stop.

The Vercel Sandbox SDK is imported only from server modules. The Vite browser
bundle never contains its credentials or implementation.

### 4.3 Client

Add `src/lib/sandbox/client.ts`:

- fetches capability/status without creating a sandbox;
- lazily creates a cloud session;
- sends normalized files and commands;
- routes output/result events by request ID;
- supports AbortController for client cancellation;
- converts API errors into stable user-facing codes.

Add `src/hooks/useSandbox.ts` to own session lifecycle and output for React.

### 4.4 UI boundaries

Keep components focused:

- `RuntimeSelector` chooses the execution engine and displays availability.
- `PackageTerminal` owns terminal input, safe history, and output presentation.
- `EnvironmentPanel` edits ordinary and secret variables.
- `PlaygroundApp` owns files and delegates execution to either `usePython` or
  `useSandbox`.
- `CloudSetupNotice` gives deployment setup instructions when the server reports
  cloud mode disabled.

The existing Pyodide client and worker do not depend on cloud code.

## 5. API and session lifecycle

### 5.1 Capability endpoint

`GET /api/runtime/capabilities` returns only public capability data:

- whether cloud mode is enabled;
- supported runtimes;
- file/output/runtime limits;
- whether BYOK is allowed.

It never returns configuration values or credentials.

### 5.2 Session endpoints

- `POST /api/runtime/sessions` creates a runtime-specific sandbox.
- `DELETE /api/runtime/sessions/current` destroys it.
- `PUT /api/runtime/sessions/current/files` synchronizes a complete bounded file
  set.
- `POST /api/runtime/sessions/current/commands` runs one validated command.
- `POST /api/runtime/sessions/current/stop` stops the active command or sandbox.

The server sets a signed, HttpOnly, Secure, SameSite cookie containing an opaque
session reference. Sandbox IDs are not accepted directly from the browser.

Only one active command is allowed per session. Requests include an idempotency key
so a retry does not start a duplicate install or execution.

### 5.3 Persistence

Sandbox files and installed packages persist only for the active session. The
browser's existing localStorage file store remains the durable source for editor
files. Sandboxes expire after an idle timeout and are destroyed on explicit
Destroy.

Snapshots and durable cloud projects are outside the first implementation.

## 6. Security and resource controls

Cloud mode is off by default. Enabling it requires:

- working Vercel Sandbox OIDC/access-token authentication;
- `SANDBOX_ENABLED=true`;
- a non-default session-signing secret;
- an access policy appropriate to the deployment.

For the current application, which has no user accounts, the first production-safe
access policy is an owner-provided playground access token entered into a masked
field and retained only for the tab. A public multi-user rollout requires real
authentication plus durable rate limiting before removing this gate.

Server-enforced limits cover:

- maximum files, per-file bytes, and total project bytes;
- maximum command and argument lengths;
- maximum install/run duration;
- maximum output bytes with truncation notice;
- maximum idle lifetime;
- one sandbox and one command per signed session;
- runtime allowlist;
- path traversal and hidden control-character rejection;
- explicit outbound-network policy.

The sandbox receives only the environment variables selected for the command. It
does not inherit the function's environment wholesale.

## 7. Failure behavior

Failures use stable codes plus actionable text:

- `CLOUD_DISABLED` — show required deployment settings.
- `ACCESS_DENIED` — request the configured access token.
- `SESSION_EXPIRED` — offer one-click recreation and resync.
- `UNSUPPORTED_BROWSER_PACKAGE` — explain WASM wheel requirements and offer Cloud
  Python.
- `PACKAGE_INSTALL_FAILED` — preserve package-manager stderr and exit code.
- `COMMAND_REJECTED` — identify the unsupported command/operator.
- `COMMAND_TIMEOUT` — state the runtime limit and keep editor files locally.
- `OUTPUT_LIMIT` — show that output was truncated.
- `PROJECT_LIMIT` — identify which file/count/size limit was exceeded.
- `SANDBOX_UNAVAILABLE` — preserve browser mode and offer retry.

Destroy and stop operations are idempotent. A browser refresh may reconnect when
the signed session is still valid; otherwise it creates a new session on demand.

## 8. Testing and verification

### 8.1 Unit tests

- command tokenization, quoting, allowlist, and shell-operator rejection;
- runtime/file-extension command selection;
- path normalization and traversal rejection;
- capability/config parsing;
- secret-history exclusion and exact-value redaction;
- output ordering, truncation, and error normalization;
- sandbox client request correlation and cancellation;
- reducer/hook state transitions for create, run, stop, expire, and destroy.

### 8.2 Server contract tests

Use a fake sandbox adapter; tests must not create paid cloud resources:

- disabled and unauthorized endpoints;
- session cookie creation and validation;
- file synchronization;
- allowed and rejected commands;
- install/run output and exit codes;
- timeout, stop, idempotency, and destroy;
- no inherited server secrets.

### 8.3 Integration verification

- all existing Vitest tests;
- ESLint;
- TypeScript and production Vite build;
- browser smoke test for Browser Python and disabled-cloud setup messaging;
- an opt-in live Vercel Sandbox smoke test when credentials are configured:
  - `pip install openai numpy`;
  - import `OpenAI` and NumPy;
  - run the provided embedding example with a temporary authorized OpenAI path;
  - `npm install openai` and import it from Node;
  - stop a long-running command;
  - confirm explicit destroy.

Live tests must never print or persist API keys and are not part of the default
test command.

## 9. Delivery boundaries

The repository implementation can provide the UI, API handlers, sandbox adapter,
tests, and setup documentation. A working public cloud runtime additionally
depends on deployment-owned state that cannot be committed safely:

- a linked Vercel project and Sandbox entitlement;
- OIDC or a Vercel access token;
- a session-signing secret;
- an access/rate-limit policy;
- an OpenAI credential-brokering or private BYOK policy.

Without those settings, the shipped site continues to provide Browser Python and
shows precise cloud setup instructions. It does not pretend cloud execution is
available.
