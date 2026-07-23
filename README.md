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

## Playground runtimes

The project workbench has three deliberately different execution tiers:

- **Browser Python** is the default and runs in a Pyodide Web Worker. It supports
  the Python standard library, packages included in the
  [Pyodide package catalog](https://pyodide.org/en/stable/usage/packages-in-pyodide.html),
  and compatible pure-Python wheels. Enter `pip install <package>` in
  **Packages and output**; this is a friendly alias for `micropip.install`, not a
  system shell. Packages with native C, C++, Fortran, or Rust extensions need a
  matching WebAssembly/Pyodide wheel, so an ordinary Linux wheel can fail in the
  browser even when the same package works in Cloud Python.
- **Cloud Python** runs Python 3.13 in an ephemeral Vercel Sandbox and accepts
  bounded `pip install`, `python`, `pwd`, and `ls` commands.
- **Cloud Node** runs Node.js 24 in an ephemeral Vercel Sandbox and accepts
  bounded `npm install`, `node`, `pwd`, and `ls` commands.

Cloud runtimes provide broad compatibility with normal Linux Python and npm
packages, including many native Linux wheels and source builds. They do not
literally support every package or hardware target: packages can still require
missing system libraries, a different CPU architecture, a GPU, unsupported
kernel features, more time or memory, or an available package registry. Shell
operators and commands outside the playground allowlist are rejected.

Editor files persist in browser `localStorage`. Installed cloud packages and
sandbox files live only for the current session. A command is limited to two
minutes and a sandbox to fifteen minutes.

## Enable cloud runtimes on Vercel

Cloud execution is off by default. Browser Python and existing inline course labs
continue to work without Vercel credentials.

Requirements:

- a Vercel project with Sandbox access;
- either Vercel OIDC (recommended) or the complete static credential trio
  described below;
- Vercel CLI authentication for local OIDC development;
- a random session-signing secret of at least 32 characters;
- a private owner access token; and
- an access and abuse-control policy appropriate for the deployment.

Link the checkout and pull the short-lived development OIDC token:

```sh
vercel link
vercel env pull
```

`vercel env pull` writes `VERCEL_OIDC_TOKEN` and the project's development
variables to `.env.local`, which is ignored by this repository. The token is
short-lived; pull it again if local Sandbox authentication expires. Do not copy
an OIDC value into `.env.example`, source control, logs, or documentation.

Add the server configuration through the Vercel dashboard or CLI. The
`vercel env add` command prompts for a value and the Development, Preview, and
Production targets to which it applies:

```sh
vercel env add SANDBOX_ENABLED
vercel env add PLAYGROUND_SESSION_SECRET
vercel env add PLAYGROUND_ACCESS_TOKEN
vercel env add PLAYGROUND_ALLOW_BYOK
vercel env pull
```

Use these values:

- `SANDBOX_ENABLED=true`
- `PLAYGROUND_SESSION_SECRET=<a random value of at least 32 characters>`
- `PLAYGROUND_ACCESS_TOKEN=<a private, high-entropy owner token>`
- `PLAYGROUND_ALLOW_BYOK=false` unless a trusted owner explicitly needs temporary
  secret forwarding

Run the full local Vercel environment with `vercel dev`. A plain `npm run dev`
serves the browser application but does not provide the serverless runtime API.
On Vercel deployments with OIDC enabled, the Sandbox SDK reads the current
function request's OIDC context and Vercel manages token rotation. The
application does not require `VERCEL_OIDC_TOKEN` to exist in the function's
module-load environment. Do not add or commit a static OIDC token.

If OIDC is unavailable, the Sandbox SDK also supports official static
authentication. Set all three variables together:

- `VERCEL_TOKEN`
- `VERCEL_TEAM_ID`
- `VERCEL_PROJECT_ID`

The server passes that complete trio only to Sandbox SDK create/get operations.
A partial trio is rejected. `VERCEL_ACCESS_TOKEN` is not a supported variable
name for this integration.

### Access and secret warning

`PLAYGROUND_ACCESS_TOKEN` is a shared owner gate, not user authentication, rate
limiting, quotas, or billing protection. Anyone who obtains it can create
billable sandboxes. Do not publish a cloud-enabled deployment or share this
token broadly. A public multi-user deployment needs real authentication,
durable rate limits, quotas, monitoring, and an incident/disable path first.

The owner enters the matching access token into the masked playground field. It
is kept in React memory and sent in request headers; it is not saved to
`localStorage` or `sessionStorage`.

`PLAYGROUND_ALLOW_BYOK=true` temporarily enables **Secret** environment rows.
Those values are held in browser memory, forwarded into the active sandbox for
the selected command, omitted from command history, and exact matches are
redacted from displayed output. This is only suitable for a trusted owner's
private session:

- the current implementation has no OpenAI credential broker or request proxy;
- exact-value redaction is not a security boundary against hostile code;
- a secret is available to code running in that sandbox; and
- neither the application nor Vercel can make a pasted long-lived key safe for
  arbitrary public users.

Leave BYOK disabled for public deployments. Prefer a short-lived, restricted,
revocable credential and clear it immediately after use.

## OpenAI SDK smoke flow

The examples below use the official SDKs and read `OPENAI_API_KEY` from the
process environment. They require Cloud Python or Cloud Node, outbound network
access, an authorized OpenAI API project, and temporary BYOK enabled. Add
`OPENAI_API_KEY` in the playground Environment panel, mark it **Secret**, and
never paste it into an editor file or ordinary environment row.

For Cloud Python, run:

```sh
pip install openai numpy
python rag_minimal.py
```

Create `rag_minimal.py` in the editor:

```python
import numpy as np
from openai import OpenAI

client = OpenAI()
response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Pathwise makes technical roadmaps interactive.",
)
embedding = np.asarray(response.data[0].embedding)
print(embedding.shape)
```

For Cloud Node, run:

```sh
npm install openai
node example.mjs
```

Create `example.mjs` in the editor:

```js
import OpenAI from "openai";

const client = new OpenAI();
const response = await client.responses.create({
  model: "gpt-5",
  input: "Write one sentence explaining an embedding.",
});

console.log(response.output_text);
```

The Python embedding call follows the
[official embeddings API shape](https://platform.openai.com/docs/api-reference/embeddings/create);
the Node example follows the
[official OpenAI quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request).

## Stop, destroy, or disable cloud execution

- **Stop** interrupts the active command. It does not remove installed packages
  or files from the sandbox.
- **Destroy session** stops and removes the current sandbox and clears in-memory
  access/secret values. Use it before closing a private BYOK session.
- To disable new cloud execution, set `SANDBOX_ENABLED=false` for every deployed
  Vercel environment and redeploy. Then verify the playground shows the cloud
  setup notice and the Cloud Python/Cloud Node choices are unavailable. Destroy
  active sessions before disabling when possible; otherwise they expire at
  their configured timeout.
- Rotate `PLAYGROUND_ACCESS_TOKEN` and any temporarily forwarded API credential
  if either may have been exposed.

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
