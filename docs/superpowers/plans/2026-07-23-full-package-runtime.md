# Full Package Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compatible browser-side Python package installation plus feature-gated Vercel Sandbox runtimes that install and execute Python and Node.js packages from the Pathwise playground.

**Architecture:** Preserve the Pyodide worker as the always-available fast path and add `micropip` installation through its existing request protocol. Add a browser/server-neutral validation layer, thin Vercel API functions, and a server-only Vercel Sandbox adapter; the React playground selects one engine without coupling either engine to the other.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Pyodide 314.0.2, `micropip`, Vercel Functions, `@vercel/sandbox` 2.x, Node `crypto`/streams.

## Global Constraints

- Browser Python remains the default and always works without server configuration.
- Cloud Python uses Vercel Sandbox runtime `python3.13`; Cloud Node uses `node24`.
- Never expose deployment secrets to browser code or inherit the server environment wholesale.
- Cloud mode defaults to disabled and requires `SANDBOX_ENABLED=true`, Vercel authentication, `PLAYGROUND_SESSION_SECRET`, and `PLAYGROUND_ACCESS_TOKEN`.
- Server command execution uses an executable and argument array; user input is never interpolated into `sh -c`.
- Allowed commands are `pip install`, `python`, `npm install`, `node`, `pwd`, and `ls`; Browser Python accepts only `pip install` as a `micropip` alias.
- Reject shell operators, traversal paths, control characters, excess files/bytes/arguments, and concurrent commands.
- Secret values stay in React memory, never localStorage/sessionStorage/history, and exact matches are redacted from output.
- Installed packages persist only for the bounded active sandbox session.
- Existing inline course runners remain Browser Python.
- Live cloud tests are opt-in and never run from the default `npm test`.

---

## File map

### Browser runtime

- Modify `src/lib/python/protocol.ts` — add the install request/result protocol.
- Modify `src/lib/python/client.ts` — expose `install(packages, onOutput)`.
- Modify `src/lib/python/python.worker.ts` — load `micropip` and install requirements.
- Modify `src/hooks/usePython.ts` — expose install state/action.
- Modify `src/lib/python/client.test.ts` — verify request correlation.

### Shared cloud-safe logic

- Create `src/lib/sandbox/protocol.ts` — public runtime/API types and limit defaults.
- Create `src/lib/sandbox/commands.ts` — tokenize and validate terminal commands.
- Create `src/lib/sandbox/files.ts` — validate project paths and sizes.
- Create `src/lib/sandbox/redaction.ts` — exact-value output redaction.
- Create matching `*.test.ts` files next to each module.

### Server runtime

- Create `server/sandbox/config.ts` — server environment validation and access checks.
- Create `server/sandbox/session.ts` — AES-GCM sealed HttpOnly session cookie.
- Create `server/sandbox/provider.ts` — sandbox-provider interface and domain service.
- Create `server/sandbox/vercelProvider.ts` — `@vercel/sandbox` implementation.
- Create `server/sandbox/http.ts` — request parsing and JSON/NDJSON responses.
- Create `server/sandbox/runtimeApi.ts` — capability/session/files/command/stop handlers.
- Create `server/sandbox/runtimeApi.test.ts` — contract tests with a fake provider.
- Create thin functions in `api/runtime/` for the six public endpoints.

### Browser cloud client and UI

- Create `src/lib/sandbox/client.ts` and test — fetch/NDJSON client.
- Create `src/hooks/useSandbox.ts` — React lifecycle wrapper.
- Create `src/components/python/RuntimeSelector.tsx`.
- Create `src/components/python/PackageTerminal.tsx`.
- Create `src/components/python/EnvironmentPanel.tsx`.
- Create `src/components/python/CloudSetupNotice.tsx`.
- Modify `src/components/python/PlaygroundApp.tsx`.
- Modify `src/components/python/PythonRunner.tsx`.
- Modify `src/index.css`.

### Configuration and documentation

- Modify `package.json` and `package-lock.json` — add `@vercel/sandbox`.
- Modify `vercel.json` — preserve API routing and set function duration.
- Modify `README.md` — document browser limits and cloud configuration.
- Create `.env.example` — non-secret configuration names and safe defaults.

---

### Task 1: Browser Python package installation

**Files:**
- Modify: `src/lib/python/protocol.ts`
- Modify: `src/lib/python/client.ts`
- Modify: `src/lib/python/python.worker.ts`
- Modify: `src/hooks/usePython.ts`
- Modify: `src/lib/python/client.test.ts`

**Interfaces:**
- Consumes: existing `PythonClient.request`, `WorkerRequest`, `WorkerResponse`, and output streaming.
- Produces: `PythonClient.install(packages: string[], onOutput?: OutputHandler): Promise<RunResult>` and `usePython().install(packages)`.

- [ ] **Step 1: Write the failing client protocol test**

Add a test that calls:

```ts
const pending = client.install(['openai', 'numpy'])
expect(worker.postMessage).toHaveBeenCalledWith({
  id: 1,
  type: 'install',
  packages: ['openai', 'numpy'],
})
worker.emit({ kind: 'done', id: 1, ok: true })
await expect(pending).resolves.toEqual({ ok: true, error: undefined, result: undefined })
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run src/lib/python/client.test.ts`

Expected: TypeScript/test failure because `PythonClient.install` does not exist.

- [ ] **Step 3: Add the install request and client method**

Extend the request union in `protocol.ts` with:

```ts
| { id: number; type: 'install'; packages: string[] }
```

Add to `PythonClient`:

```ts
install(packages: string[], onOutput?: OutputHandler): Promise<RunResult> {
  return this.request<RunResult>({ type: 'install', packages }, onOutput)
}
```

- [ ] **Step 4: Implement `micropip` installation in the worker**

Add a switch case that validates non-empty package strings, loads `micropip`, and
destroys its proxy:

```ts
case 'install': {
  const packages = req.packages.map((value) => value.trim()).filter(Boolean)
  if (packages.length === 0) throw new Error('Enter at least one package to install.')
  await py.loadPackage('micropip')
  const micropip = py.pyimport('micropip')
  try {
    post({ kind: 'output', id: req.id, stream: 'stdout', text: `Installing ${packages.join(' ')}…\n` })
    await micropip.install(packages, { keep_going: true })
    post({ kind: 'output', id: req.id, stream: 'stdout', text: `Installed ${packages.join(' ')}\n` })
    post({ kind: 'done', id: req.id, ok: true })
  } finally {
    micropip.destroy()
  }
  break
}
```

Use the actual PyProxy call signature accepted by the installed Pyodide typings;
if keyword arguments require `callKwargs`, use:

```ts
await micropip.install.callKwargs(packages, { keep_going: true })
```

- [ ] **Step 5: Expose installation through `usePython`**

Mirror `run` with an `install` callback that shares the hook's `running` flag and
output appender:

```ts
const install = useCallback(async (packages: string[]) => {
  setRunning(true)
  try {
    return await pythonClient.install(packages, append)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    setRunning(false)
  }
}, [append])
```

Return `install` from the hook.

- [ ] **Step 6: Run tests and build**

Run:

```sh
npm test -- --run src/lib/python/client.test.ts
npm run build
```

Expected: focused tests pass and production build succeeds.

- [ ] **Step 7: Commit the browser engine slice**

```sh
git add src/lib/python/protocol.ts src/lib/python/client.ts src/lib/python/python.worker.ts src/hooks/usePython.ts src/lib/python/client.test.ts
git commit -m "feat: install compatible packages in browser Python"
```

---

### Task 2: Shared command, file, runtime, and redaction rules

**Files:**
- Create: `src/lib/sandbox/protocol.ts`
- Create: `src/lib/sandbox/commands.ts`
- Create: `src/lib/sandbox/commands.test.ts`
- Create: `src/lib/sandbox/files.ts`
- Create: `src/lib/sandbox/files.test.ts`
- Create: `src/lib/sandbox/redaction.ts`
- Create: `src/lib/sandbox/redaction.test.ts`

**Interfaces:**
- Produces: `parseTerminalCommand(input, runtime)`, `commandForFile(runtime, file)`, `validateProjectFiles(files, limits)`, and `redactSecrets(text, secrets)`.
- Consumed by: browser terminal, cloud client, and server API validation.

- [ ] **Step 1: Write command parser tests**

Cover these exact cases:

```ts
expect(parseTerminalCommand('pip install openai numpy', 'python')).toEqual({
  kind: 'execute',
  executable: 'pip',
  args: ['install', 'openai', 'numpy'],
})
expect(parseTerminalCommand('npm install "@scope/pkg@^2"', 'node')).toEqual({
  kind: 'execute',
  executable: 'npm',
  args: ['install', '@scope/pkg@^2'],
})
expect(parseTerminalCommand('export OPENAI_API_KEY="sk-test value"', 'python')).toEqual({
  kind: 'environment',
  name: 'OPENAI_API_KEY',
  value: 'sk-test value',
  secret: true,
})
expect(() => parseTerminalCommand('python app.py; cat /etc/passwd', 'python'))
  .toThrow('Shell operators are not supported')
expect(() => parseTerminalCommand('npm install openai', 'python'))
  .toThrow('npm is available only in Cloud Node')
```

Also assert `commandForFile('python', 'rag.py')` and
`commandForFile('node', 'example.mjs')`, plus rejection of mismatched extensions.

- [ ] **Step 2: Run command tests and verify RED**

Run: `npm test -- --run src/lib/sandbox/commands.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement shared protocol and parser**

Define:

```ts
export type CloudRuntime = 'python' | 'node'
export type PlaygroundRuntime = 'browser-python' | 'cloud-python' | 'cloud-node'
export type SessionState = 'disabled' | 'idle' | 'creating' | 'ready' | 'running' | 'stopping' | 'error'
export interface ProjectFile { path: string; content: string }
export interface ExecuteCommand { kind: 'execute'; executable: 'pip' | 'python' | 'npm' | 'node' | 'pwd' | 'ls'; args: string[] }
export interface EnvironmentCommand { kind: 'environment'; name: string; value: string; secret: boolean }
export type ParsedTerminalCommand = ExecuteCommand | EnvironmentCommand
export const DEFAULT_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 256_000,
  maxProjectBytes: 1_000_000,
  maxArgs: 40,
  maxArgBytes: 4_096,
  maxOutputBytes: 1_000_000,
  commandTimeoutMs: 120_000,
  sandboxTimeoutMs: 900_000,
} as const
```

Implement a finite-state tokenizer supporting whitespace, single quotes, double
quotes, and backslash escapes. Reject `;`, `&&`, `||`, pipes, redirects, newlines,
and unmatched quotes outside quoted literals. Enforce the runtime-specific
allowlist and require `install` as the package-manager subcommand.

- [ ] **Step 4: Write file validation and redaction tests**

Assert:

```ts
expect(validateProjectFiles([{ path: 'src/app.py', content: 'print(1)' }], DEFAULT_LIMITS))
  .toEqual([{ path: 'src/app.py', content: 'print(1)' }])
expect(() => validateProjectFiles([{ path: '../secret', content: '' }], DEFAULT_LIMITS))
  .toThrow('Invalid project path')
expect(redactSecrets('key=sk-secret and sk-secret-again', ['sk-secret']))
  .toBe('key=[REDACTED] and [REDACTED]-again')
expect(redactSecrets('unchanged', ['', 'short'])).toBe('unchanged')
```

Include absolute path, NUL/control character, file count, per-file size, and total
size cases.

- [ ] **Step 5: Implement validation and redaction**

Normalize paths by replacing backslashes, rejecting absolute/empty/dot segments,
and returning the original UTF-8 content. Measure bytes with `TextEncoder`.

Redact only non-empty values at least eight characters long, sort longest first,
escape regex characters, and replace every exact match with `[REDACTED]`.

- [ ] **Step 6: Run the shared logic tests**

Run: `npm test -- --run src/lib/sandbox`

Expected: all command, file, and redaction tests pass.

- [ ] **Step 7: Commit shared validation**

```sh
git add src/lib/sandbox
git commit -m "feat: validate playground runtime requests"
```

---

### Task 3: Server configuration and sealed sessions

**Files:**
- Create: `server/sandbox/config.ts`
- Create: `server/sandbox/config.test.ts`
- Create: `server/sandbox/session.ts`
- Create: `server/sandbox/session.test.ts`

**Interfaces:**
- Consumes: `CloudRuntime`, `DEFAULT_LIMITS`.
- Produces: `loadRuntimeConfig(env)`, `authorizeAccess(config, token)`,
  `sealSession(payload, secret)`, `openSession(token, secret)`, and cookie helpers.

- [ ] **Step 1: Write configuration tests**

Test that an empty environment returns:

```ts
{
  enabled: false,
  reason: 'Set SANDBOX_ENABLED=true to enable cloud runtimes.',
  runtimes: [],
  allowByok: false,
  limits: DEFAULT_LIMITS,
}
```

Test enabled configuration with `VERCEL_OIDC_TOKEN`, a 32+ character session
secret, and access token. Test rejection for missing Vercel auth, default/short
secrets, and incorrect access tokens using a timing-safe comparison.

- [ ] **Step 2: Run configuration tests and verify RED**

Run: `npm test -- --run server/sandbox/config.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement configuration**

Use an injected `Record<string, string | undefined>` rather than reading
`process.env` inside pure functions. Return public capability data separately from
private secrets. Recognize `VERCEL_OIDC_TOKEN` or `VERCEL_ACCESS_TOKEN`. Enable BYOK
only for `PLAYGROUND_ALLOW_BYOK=true`.

- [ ] **Step 4: Write sealed-session tests**

Use a fixed 32+ character test secret and assert:

```ts
const token = await sealSession(
  { name: 'pathwise-test', runtime: 'python', expiresAt: 2_000_000_000_000 },
  TEST_SECRET,
)
await expect(openSession(token, TEST_SECRET)).resolves.toMatchObject({
  name: 'pathwise-test',
  runtime: 'python',
})
await expect(openSession(`${token}x`, TEST_SECRET)).rejects.toThrow('Invalid session')
```

Also test expiry, wrong secret, runtime validation, HttpOnly/Secure/SameSite cookie
serialization, and cookie parsing.

- [ ] **Step 5: Implement AES-256-GCM session sealing**

Derive a 32-byte key with SHA-256 of the configured secret, use a random 12-byte
IV, authenticate the JSON payload, and encode `iv.ciphertext.tag` as base64url.
Validate the decoded object and expiry before returning it.

Cookie output must include:

```txt
pathwise_runtime=<sealed>; Path=/api/runtime; HttpOnly; Secure; SameSite=Strict; Max-Age=900
```

- [ ] **Step 6: Run server security tests**

Run: `npm test -- --run server/sandbox/config.test.ts server/sandbox/session.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit server security foundation**

```sh
git add server/sandbox/config.ts server/sandbox/config.test.ts server/sandbox/session.ts server/sandbox/session.test.ts
git commit -m "feat: secure cloud runtime configuration and sessions"
```

---

### Task 4: Sandbox service and API contracts

**Files:**
- Create: `server/sandbox/provider.ts`
- Create: `server/sandbox/runtimeApi.ts`
- Create: `server/sandbox/runtimeApi.test.ts`
- Create: `server/sandbox/http.ts`

**Interfaces:**
- Consumes: shared validation, redaction, config, and sealed sessions.
- Produces: `SandboxProvider`, `RuntimeApi`, and framework-neutral handler results.

- [ ] **Step 1: Define the provider interface and fake**

Use:

```ts
export interface SandboxCommand {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

export interface SandboxCommandResult {
  exitCode: number
  output: Array<{ sequence: number; stream: 'stdout' | 'stderr'; text: string }>
}

export interface SandboxHandle {
  name: string
  writeFiles(files: ProjectFile[]): Promise<void>
  run(command: SandboxCommand): Promise<SandboxCommandResult>
  stop(): Promise<void>
}

export interface SandboxProvider {
  create(runtime: CloudRuntime, name: string, timeoutMs: number): Promise<SandboxHandle>
  get(name: string): Promise<SandboxHandle>
}
```

The test fake records calls and exposes configurable results/errors.

- [ ] **Step 2: Write runtime API contract tests**

Test:

- capabilities are public and do not create a sandbox;
- disabled create returns `CLOUD_DISABLED`;
- incorrect access token returns `ACCESS_DENIED`;
- create chooses `python3.13`/`node24` through the provider and sets a sealed cookie;
- file sync rejects traversal before calling the provider;
- command validation rejects shell operators before calling the provider;
- command execution passes only request-selected environment variables;
- known temporary secret values are redacted from stdout/stderr;
- interleaved stdout/stderr chunks retain their sequence order in the response;
- an expired cookie returns `SESSION_EXPIRED`;
- stop is idempotent and clears the cookie;
- provider failures normalize to `SANDBOX_UNAVAILABLE`.

Represent requests as:

```ts
interface RuntimeRequest {
  method: string
  headers: Record<string, string | undefined>
  body?: unknown
}
interface RuntimeResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}
```

- [ ] **Step 3: Run the contract tests and verify RED**

Run: `npm test -- --run server/sandbox/runtimeApi.test.ts`

Expected: missing implementation failures.

- [ ] **Step 4: Implement `RuntimeApi`**

Expose methods:

```ts
capabilities(req: RuntimeRequest): Promise<RuntimeResponse>
createSession(req: RuntimeRequest): Promise<RuntimeResponse>
destroySession(req: RuntimeRequest): Promise<RuntimeResponse>
syncFiles(req: RuntimeRequest): Promise<RuntimeResponse>
runCommand(req: RuntimeRequest): Promise<RuntimeResponse>
stop(req: RuntimeRequest): Promise<RuntimeResponse>
```

Create names with `pathwise-${randomUUID()}`. Store name/runtime/expiry only inside
the sealed cookie. Resolve existing sandboxes by sealed name. Validate runtime,
files, commands, environment variable names, values, and limits on the server.
Treat Stop as stop-and-destroy; the browser lazily creates a replacement.

Require `Idempotency-Key` on command requests and return it in the response.
Prevent duplicate execution within a sandbox by prefixing the validated command
with:

```ts
{
  executable: 'flock',
  args: ['-n', '-E', '75', '/tmp/pathwise-command.lock', command.executable, ...command.args],
}
```

Map exit code 75 to `COMMAND_IN_PROGRESS`.

- [ ] **Step 5: Implement Node HTTP adapters**

Add helpers that:

- read at most 1 MB of JSON request body;
- normalize lowercase headers;
- write JSON with `Content-Type: application/json`;
- forward `Set-Cookie`;
- return 405 for unsupported methods;
- never include stack traces in public errors.

- [ ] **Step 6: Run API contracts**

Run: `npm test -- --run server/sandbox`

Expected: config, session, and runtime API tests all pass.

- [ ] **Step 7: Commit the provider-neutral API**

```sh
git add server/sandbox/provider.ts server/sandbox/runtimeApi.ts server/sandbox/runtimeApi.test.ts server/sandbox/http.ts
git commit -m "feat: add cloud runtime API contracts"
```

---

### Task 5: Vercel Sandbox adapter and functions

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/sandbox/vercelProvider.ts`
- Create: `server/sandbox/vercelProvider.test.ts`
- Create: `server/sandbox/singleton.ts`
- Create: `api/runtime/capabilities.ts`
- Create: `api/runtime/sessions.ts`
- Create: `api/runtime/session.ts`
- Create: `api/runtime/files.ts`
- Create: `api/runtime/commands.ts`
- Create: `api/runtime/stop.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `SandboxProvider`, `RuntimeApi`, Node HTTP adapter.
- Produces: deployment-ready Vercel Function routes.

- [ ] **Step 1: Install the server-only SDK**

Run: `npm install @vercel/sandbox@^2.8.0`

Expected: dependency and lockfile update.

- [ ] **Step 2: Write adapter tests with an injected SDK facade**

Assert runtime mapping, timeout/name forwarding, file content conversion to
`Buffer`, `cwd: '/vercel/sandbox/workspace'`, environment forwarding, stdout and
stderr collection, reconnect by name, and idempotent stop.

- [ ] **Step 3: Implement `VercelSandboxProvider`**

Import `Writable` from `node:stream`, then wrap:

```ts
Sandbox.create({
  name,
  runtime: runtime === 'python' ? 'python3.13' : 'node24',
  timeout: timeoutMs,
  networkPolicy: 'allow-all',
})
Sandbox.get({ name })
```

Create `/vercel/sandbox/workspace` before writes. Convert `ProjectFile` content to
`Buffer`. Call:

```ts
let sequence = 0
const output: SandboxCommandResult['output'] = []
const collect = (stream: 'stdout' | 'stderr') => new Writable({
  write(chunk, _encoding, callback) {
    output.push({ sequence: sequence++, stream, text: chunk.toString() })
    callback()
  },
})
const result = await sandbox.runCommand({
  cmd: command.executable,
  args: command.args,
  cwd: command.cwd,
  env: command.env,
  stdout: collect('stdout'),
  stderr: collect('stderr'),
})
return {
  exitCode: result.exitCode,
  output,
}
```

Confirm exact SDK option/property names against installed TypeScript declarations
and adapt only the adapter, leaving the provider interface unchanged.

- [ ] **Step 4: Create singleton wiring**

`server/sandbox/singleton.ts` reads `process.env`, creates one
`VercelSandboxProvider`, and exports one `RuntimeApi`. Do not import this module
from browser code or unit tests.

- [ ] **Step 5: Add thin API entries**

Each file exports a default Node handler and delegates exactly one method:

```ts
export default nodeHandler((request) => runtimeApi.capabilities(request), ['GET'])
```

Map:

- `capabilities.ts`: GET
- `sessions.ts`: POST
- `session.ts`: DELETE
- `files.ts`: PUT
- `commands.ts`: POST
- `stop.ts`: POST

- [ ] **Step 6: Preserve API routing and configure duration**

Update `vercel.json` so `/api/*` functions take precedence over the SPA rewrite and
set a 300-second maximum for `api/runtime/*.ts` while application-level command
limits remain 120 seconds.

- [ ] **Step 7: Run adapter tests and production build**

Run:

```sh
npm test -- --run server/sandbox/vercelProvider.test.ts
npm run build
```

Expected: adapter tests pass; browser build excludes the server SDK and succeeds.

- [ ] **Step 8: Commit Vercel integration**

```sh
git add package.json package-lock.json server/sandbox api/runtime vercel.json
git commit -m "feat: execute projects in Vercel Sandbox"
```

---

### Task 6: Cloud browser client and state hook

**Files:**
- Create: `src/lib/sandbox/client.ts`
- Create: `src/lib/sandbox/client.test.ts`
- Create: `src/hooks/useSandbox.ts`
- Create: `src/hooks/useSandbox.test.ts`

**Interfaces:**
- Consumes: public protocol and API endpoints.
- Produces: `SandboxClient` plus `useSandbox()` lifecycle/actions.

- [ ] **Step 1: Write client tests with injected fetch**

Test capability fetch, access header, credentials/cookie inclusion, session create,
file sync, command execution, normalized API errors, Stop, Destroy, and
AbortController cancellation.

Expected calls include:

```ts
fetch('/api/runtime/capabilities', { credentials: 'same-origin' })
fetch('/api/runtime/commands', {
  method: 'POST',
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': expect.any(String),
    'X-Playground-Access': 'owner-token',
  },
  body: JSON.stringify({ command, environment, secretNames }),
  signal,
})
```

- [ ] **Step 2: Run client tests and verify RED**

Run: `npm test -- --run src/lib/sandbox/client.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement `SandboxClient`**

Expose:

```ts
capabilities(): Promise<RuntimeCapabilities>
create(runtime: CloudRuntime, accessToken: string): Promise<void>
syncFiles(files: ProjectFile[], accessToken: string): Promise<void>
run(command: ExecuteCommand, environment: Record<string, string>, secretNames: string[], accessToken: string, signal?: AbortSignal): Promise<CommandResult>
stop(accessToken: string): Promise<void>
destroy(accessToken: string): Promise<void>
```

Parse non-2xx JSON into an `RuntimeClientError` with stable `code` and message.
Never include access/environment values in error messages.
Sort returned output chunks by `sequence` before exposing them to the hook.

- [ ] **Step 4: Write hook state tests**

Verify:

- initial capability loading;
- disabled state;
- lazy session creation on first run;
- ordered output append;
- Stop aborts the request and calls the server;
- expired session recreates once and resyncs;
- runtime change destroys the old cloud session;
- secrets clear on destroy and unmount.

- [ ] **Step 5: Implement `useSandbox`**

Use a reducer for deterministic state transitions. Keep access token,
environment-variable values, and secrets in component memory. Do not persist them.
Return:

```ts
{
  capabilities,
  state,
  output,
  runFiles,
  runCommand,
  stop,
  restart,
  destroy,
  clearOutput,
}
```

- [ ] **Step 6: Run client and hook tests**

Run: `npm test -- --run src/lib/sandbox/client.test.ts src/hooks/useSandbox.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit the cloud client**

```sh
git add src/lib/sandbox/client.ts src/lib/sandbox/client.test.ts src/hooks/useSandbox.ts src/hooks/useSandbox.test.ts
git commit -m "feat: add cloud playground client lifecycle"
```

---

### Task 7: Runtime, terminal, and environment UI

**Files:**
- Create: `src/components/python/RuntimeSelector.tsx`
- Create: `src/components/python/PackageTerminal.tsx`
- Create: `src/components/python/EnvironmentPanel.tsx`
- Create: `src/components/python/CloudSetupNotice.tsx`
- Create: `src/components/python/PackageTerminal.test.ts`
- Modify: `src/components/python/PlaygroundApp.tsx`
- Modify: `src/components/python/PythonRunner.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `usePython().install`, `useSandbox`, shared parser/types.
- Produces: the complete selectable playground experience.

- [ ] **Step 1: Write terminal behavior tests**

Test the pure exported `submitTerminalInput` helper:

- Browser Python maps `pip install numpy` to `install(['numpy'])`.
- Browser Python rejects `python app.py` with “Run the editor with the Run button.”
- Cloud Python sends parsed `pip`/`python` commands.
- Cloud Node sends parsed `npm`/`node` commands.
- `export OPENAI_API_KEY=...` updates secret state and returns no history entry.
- ordinary commands return a sanitized history entry.

- [ ] **Step 2: Run terminal tests and verify RED**

Run: `npm test -- --run src/components/python/PackageTerminal.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Build focused UI components**

`RuntimeSelector` renders three explicit buttons/select options with status text.
`CloudSetupNotice` uses capability reason and these commands without displaying
actual secrets:

```sh
vercel link
vercel env pull
vercel env add SANDBOX_ENABLED
vercel env add PLAYGROUND_SESSION_SECRET
vercel env add PLAYGROUND_ACCESS_TOKEN
```

`EnvironmentPanel` provides name/value rows, a Secret checkbox, masked secret
inputs, remove, and Clear Secrets.

`PackageTerminal` renders output, input, command hints for the selected runtime,
safe Up/Down history, Enter submit, and disabled/running states.

- [ ] **Step 4: Integrate runtime selection into `PlaygroundApp`**

Keep the existing file reducer/localStorage. Add runtime state with
`browser-python` default. In Browser Python:

- Run continues through `usePython`;
- `pip install` uses `usePython.install`;
- existing REPL remains available.

In cloud modes:

- Run synchronizes every file and runs the active file;
- terminal commands use `useSandbox`;
- REPL is hidden;
- Stop, Restart Session, and Destroy Session are visible;
- changing cloud runtime destroys the old session after confirmation when running.

Add `.js`, `.mjs`, and `.cjs` handling without forcing `.py` through `ensurePy`.

- [ ] **Step 5: Add browser-package fallback in `PythonRunner`**

When a browser install/import error contains pure-wheel/Pyodide incompatibility
language, show:

```txt
This package has no browser-compatible Python wheel. Open the code in Cloud Python
to use the normal Linux package.
```

Add an “Open in Cloud Playground” action that stores a one-time code handoff in
sessionStorage and navigates to `#/playground`; `PlaygroundApp` consumes and
deletes it immediately.

- [ ] **Step 6: Style and accessibility**

Add scoped `.runtime-*`, `.package-terminal-*`, and `.environment-*` styles using
existing CSS variables. Preserve visible focus rings, label every input, use
`aria-live="polite"` for status, `role="log"` for output, and make the layout stack
below the existing mobile breakpoint.

- [ ] **Step 7: Run UI tests, lint, and build**

Run:

```sh
npm test -- --run src/components/python/PackageTerminal.test.ts
npm run lint
npm run build
```

Expected: tests pass, zero lint errors, production build succeeds.

- [ ] **Step 8: Commit UI integration**

```sh
git add src/components/python src/index.css
git commit -m "feat: add package terminal and cloud runtime controls"
```

---

### Task 8: Setup documentation and full verification

**Files:**
- Create: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-23-full-package-runtime-design.md` only if verification reveals a factual SDK mismatch.

**Interfaces:**
- Consumes: completed feature and verified environment names.
- Produces: reproducible local/deployment setup and final evidence.

- [ ] **Step 1: Add safe environment example**

Create:

```dotenv
SANDBOX_ENABLED=false
PLAYGROUND_SESSION_SECRET=replace-with-at-least-32-random-characters
PLAYGROUND_ACCESS_TOKEN=replace-with-a-private-owner-access-token
PLAYGROUND_ALLOW_BYOK=false
```

Do not add Vercel OIDC values or OpenAI keys.

- [ ] **Step 2: Document both runtime tiers**

README must include:

- Browser Python support for standard library, Pyodide packages, and pure-Python
  wheels through `pip install` alias;
- why native browser wheels may fail;
- Cloud Python/Node requirements and commands;
- Vercel `link`, `env pull`, and environment configuration;
- access-token and public-abuse warning;
- temporary BYOK limitations;
- exact OpenAI example flow;
- how to destroy a sandbox and disable cloud execution.

- [ ] **Step 3: Run the complete automated suite**

Run:

```sh
npm test -- --run
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, lint exits 0, build exits 0, and diff check prints nothing.

- [ ] **Step 4: Browser smoke-test the default deployment mode**

Run the Vite dev server, then verify:

- Browser Python executes `import numpy as np; print(np.array([1, 2]))`;
- `pip install` package UI is keyboard accessible;
- cloud modes show setup instructions when disabled;
- no secret/access value is present in localStorage or sessionStorage;
- existing inline Python labs still run;
- mobile viewport has no horizontal overflow.

- [ ] **Step 5: Run opt-in live sandbox verification when credentials exist**

Only when `SANDBOX_ENABLED`, Vercel authentication, signing secret, and access token
are configured:

```sh
pip install openai numpy
python rag_minimal.py
npm install openai
node example.mjs
```

Use a temporary private credential path for the OpenAI call. Confirm Stop and
Destroy. If credentials are absent, record live cloud verification as
configuration-blocked, not as a product test failure.

- [ ] **Step 6: Inspect repository changes and commit docs**

Run: `git status --short && git diff --stat`

Then:

```sh
git add .env.example README.md
git commit -m "docs: configure full package playground runtimes"
```

- [ ] **Step 7: Request code review**

Invoke `superpowers:requesting-code-review`, address only verified findings, and
rerun the full automated suite after any change.

- [ ] **Step 8: Push the completed feature**

```sh
git push origin main
```

Expected: all implementation commits appear on `origin/main`.
