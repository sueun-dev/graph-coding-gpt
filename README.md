# Graph Coding GPT

Turn a sentence into a diagram, edit the diagram, then let GPT-5.5 implement it **one node at a time** with tests that have to go green before the next node starts.

Not a single-shot code generator. A visible, editable, per-node iterative build loop you drive from a React Flow canvas.

## The Flow

```
 Brief (a sentence)         →   GPT-5.5 drafts a diagram
 ──────────────────
 Diagram (edit on canvas)   →   nodes, edges, per-node intent/behavior/tests
 ──────────────────
 Build Loop (Start)         →   topological order, note/group skipped
 ──────────────────
   for each node:
     codex writes src + tests ─────┐
              ↓                    │
          run vitest               │ fail → feed failure into next attempt
              ↓                    │         (up to 3 retries)
         done or failed  ←─────────┘
```

You own the diagram. The loop turns each node into code + tests, fails visibly, retries with the test failure in-prompt, and persists progress to `.graphcoding/build-state.json` so you can stop and resume.

## What the app actually does

- **Brief → Diagram.** One sentence, one button. GPT-5.5 returns a structured diagram with nodes and edges; you edit it on a React Flow canvas with an Inspector panel.
- **Per-node build loop.** Topological order (ties broken by x-position), `note`/`group` shapes skipped. Each node goes implementing → done | failed. On failure, the test output is fed into the retry prompt — up to 3 retries.
- **Real tests.** Every node writes vitest tests under `tests/<node-slug>/`. The runner pins to the workspace's own `node_modules/.bin/vitest` so it never resolves to a sibling project's version.
- **Correct cross-node context.** Each node's prompt includes the files produced by every prior completed node, so codex imports from them instead of re-implementing.
- **Persistence.** Diagram and build state both live on disk under `.graphcoding/` (debounced), and auto-restore on workspace open. You can close the tab mid-build and come back.
- **Stop that actually stops.** Clicking Stop aborts the in-flight fetch via `AbortController` and invalidates a generation counter, so a late response can't overwrite the paused state.

## What the UI looks like

Welcome screen is intentionally two interactive things: a path input with **Open** and a native-dialog link. Everything else (aux panel, bottom panel, editor tabs) stays hidden until a folder is loaded.

After opening a folder:

- **Left:** Explorer with OPEN EDITORS, the workspace tree, a HARNESS section, and a DIAGRAM BLOCKS palette.
- **Center:** React Flow canvas + a small bottom panel that starts with just `GRAPH JSON` (SPEC / BUILD PROMPT / ITERATION tabs appear only once you've generated a spec).
- **Right:** three tabs — **AI** (brief + Generate Diagram + collapsed optional Spec), **INSPECTOR** (edit the selected node or edge), **BUILD** (Start Build Loop, per-node status list).

Spec generation is deliberately collapsed into an optional `<details>` because **the Build Loop does not read the spec** — spec is for human review and export.

## How to run it

Requirements:

- Node.js 18+ and npm
- `codex` CLI logged in (`codex login status` should return OK)
- A workspace folder you're okay with codex writing into (the sandbox is `workspace-write`)

Install and run:

```bash
npm install
npm run dev              # concurrent server (8791) + vite client (5173)
# or separately:
npm run dev:server
npm run dev:client

# Need a different port? (e.g. 8791 is taken on your machine)
GRAPHCODING_PORT=9100 npm run dev
```

Open `http://localhost:5173`, type a project folder path, click **Open**, run the Harness wizard that auto-opens, then go to the **AI** tab, write a brief, click **Generate Diagram**. When the diagram is drafted and edited, switch to **BUILD** → **Start Build Loop**.

## A minimal first run

```text
Folder           /Users/you/Documents/my-messaging-app  (empty is fine)
Harness preset   SaaS Web App  (or whichever fits)
Brief            Local-first messaging app with thread list,
                 chat view, and a calculator popup that can
                 insert results into the chat.
Expected result  ~8–10 nodes; loop builds each with tests.
                 First node takes the longest (scaffolding).
```

The first node bootstraps `package.json`, `tsconfig.json`, `vitest.config.ts`, and installs deps. Subsequent nodes only add their own files and tests.

## Architecture

```
 src/
   App.tsx               main shell; build-loop driver; persistence gates
   components/           ExplorerPanel, RunPanel, InspectorPanel,
                         BuildLoopPanel, BottomPanel, WorkspaceSetupModal
   lib/                  diagram, harness, workspace, types
   styles/app.css        VS Code-styled layout, 3-column workbench

 server/
   index.mjs             express API on :8791 (override with GRAPHCODING_PORT)
     /api/ai/diagram        brief → structured diagram (gpt-5.5)
     /api/ai/spec           diagram → structured spec (gpt-5.5, optional)
     /api/ai/build-order    topological sort (note/group skipped)
     /api/ai/build-node     codex workspace-write + vitest + retry
     /api/build-state/save  persist .graphcoding/build-state.json
     /api/build-state/load  auto-restore on workspace open
     /api/workspace/*       open-folder, read-file, write-artifacts
```

State lives in three layers:

| piece | react state | localStorage | disk (`.graphcoding/`) |
|---|---|---|---|
| diagram (nodes + edges) | ✓ | ✓ | `diagram.graph.json` (debounced 600ms) |
| build-state (per-node status) | ✓ | — | `build-state.json` (written on every transition) |
| brief text | ✓ | ✓ | — |
| harness config | ✓ | — | `harness.json` (via write-artifacts) |

On workspace open, disk wins for diagram (falls back to localStorage on read failure), and build-state is restored with `running:false, paused:true` so nothing resumes without an explicit user click.

## Reliability details

Things that broke during real E2E testing and got fixed:

- **Vitest resolution leaking to sibling projects.** `npx vitest` via pnpm's shared store was picking up a neighbor repo's vitest. `detectTestRunner` now invokes `<cwd>/node_modules/.bin/vitest` directly when present.
- **Stop not stopping.** In-flight fetch kept going; late response overwrote paused state. Fixed with `AbortController` + a `buildGenRef` generation counter; every await re-checks `isCurrent()`.
- **Stale per-node context.** The driver kept a local snapshot of `records` that never updated; node N always saw `previouslyBuilt = []`. Fixed by mirroring every `updateNodeRecord` into the local snapshot atomically.
- **File diff missing modifications.** The `files` list only captured new files. Replaced with an mtime snapshot before/after so modified files (`package.json`, shared utils) are reported too.
- **Path-escape inconsistency.** `/api/build-state/save|load` and `/api/ai/build-node` bypassed `ensureWithinRoot`. All three now route through it.
- **Reload hang.** `reloadNativeWorkspace` errors inside the loop used to leave `running:true` forever. Now wrapped in a `safeReloadNativeWorkspace` that surfaces a notice and lets the driver continue.
- **Cross-workspace diagram overwrite.** Opening workspace B right after A could write A's nodes into B's disk file. A `hydratedKeyRef` now gates the save effect: only writes after the load effect has confirmed the current key.
- **Silent 20× `spawnSync`.** `codexStatus()` forked a process on every request. Now cached with a 30s TTL; `/api/auth/status` still takes a fresh read.

## Limitations

- Diagram generation and each node build take time — `codex gpt-5.5` with reasoning effort `high` is usually 1–4 minutes per call.
- `"testing"` and `"fixing"` statuses are defined but the client doesn't currently stream intermediate server events, so the UI jumps `implementing → done | failed`. Server-sent events for in-progress retries is the next UX upgrade.
- Fallback diagrams/specs (when codex fails) return with `ok:true`. The Build Loop already blocks Start when diagram source is fallback, but the spec path still ships a template silently if codex dies — treat unexpectedly fast spec results with suspicion.
- Only tested on macOS with ChatGPT-backed codex login. Windows/Linux should work but the native folder dialog uses zenity/powershell fallbacks that haven't had the same mileage.

## Ignored by default

```text
node_modules/    dist/    .tmp/    generated/    .graphcoding/    .env*
```

Before publishing, re-scan for secrets:

```bash
rg -n --hidden -S "(api[_-]?key|token|secret|password|sk-|ghp_|github_pat_)" . \
  --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!.tmp' --glob '!generated'
```

## License

Unlicensed. Treat the repository as private until a LICENSE is added.
