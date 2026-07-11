# Graph Coding GPT

Turn a sentence into a diagram, edit the diagram, then let Codex implement it **one node at a time** with tests that have to go green before the next node starts.

Not a single-shot code generator. A visible, editable, per-node iterative build loop you drive from a React Flow canvas.

## The Flow

```
 Brief (a sentence)         →   Codex drafts a diagram
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

- **Brief → Diagram.** One sentence, one button. Codex returns a structured diagram with nodes and edges; you edit it on a React Flow canvas with an Inspector panel.
- **Per-node build loop.** Topological order (ties broken by x-position), `note`/`group` shapes skipped. Each node goes implementing → done | failed. On failure, the test output is fed into the retry prompt — up to 3 retries.
- **Real tests.** Every node writes vitest tests under `tests/<node-slug>/`. When the workspace has its own `test` script, the runner invokes that script through the workspace's package manager; only when no `test` script exists does it fall back to pinning the workspace's own `node_modules/.bin/vitest` directly, so it never resolves to a sibling project's version.
- **Workspace isolation gate.** After every Codex attempt, the server rejects external symlinks, host absolute path references, and invalid pnpm `node_modules` package entries before treating the node as done.
- **Correct cross-node context.** Each node's prompt includes the files produced by every prior completed node, so codex imports from them instead of re-implementing.
- **Persistence.** Diagram and build state both live on disk under `.graphcoding/` (debounced), and auto-restore on workspace open. You can close the tab mid-build and come back.
- **Stop that actually stops.** Clicking Stop aborts the in-flight fetch via `AbortController` and invalidates a generation counter, so a late response can't overwrite the paused state.

## What the UI looks like

Welcome screen is intentionally two interactive things: a path input with **Open** and a native-dialog link. Everything else (aux panel, bottom panel, editor tabs) stays hidden until a folder is loaded.

After opening a folder:

- **Top:** one workflow rail: **Target → Generate → Edit → Build**.
- **Left:** Project target, architecture blocks, active docs, and files.
- **Center:** React Flow canvas + a small bottom panel that starts with just `GRAPH JSON` (SPEC / BUILD PROMPT / ITERATION tabs appear only once you've generated a spec).
- **Right:** one detail panel for the currently selected workflow step. The top rail is the only place that switches **Generate / Edit / Build**.

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

Open `http://localhost:5173`, type a project folder path, click **Open**, run the Target wizard that auto-opens, then use **Generate** to draft the diagram. When the diagram is drafted and edited, switch to **Build** → **Start Build Loop**.

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
   App.tsx               main shell; build-loop driver; persistence gates;
                         React Flow canvas + bottom panel (GRAPH JSON / SPEC tabs)
   components/           ExplorerPanel, RunPanel, InspectorPanel, BuildLoopPanel,
                         WorkspaceSetupModal, DiagramNode, DiagramEmptyState,
                         LiquidGlassControls
   lib/                  diagram, harness, workspace, types
   styles/app.css        VS Code-styled layout, 3-column workbench

 server/
   index.mjs             express API on :8791 (override with GRAPHCODING_PORT)
     /api/health            liveness probe ({ ok: true })
     /api/auth/status       fresh codex login check (bypasses 30s cache)
     /api/ai/diagram        brief → structured diagram (gpt-5.6-sol, high)
     /api/ai/spec           diagram → structured spec (gpt-5.6-sol, high, optional)
     /api/ai/build-order    topological sort (note/group skipped)
     /api/ai/build-node     codex workspace-write + vitest + retry
     /api/build-state/save  persist .graphcoding/build-state.json
     /api/build-state/load  auto-restore on workspace open
     /api/workspace/validate-isolation  external-link/path guard
     /api/workspace/runtime-verify  assembled-app runtime check (see below)
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

## Runtime verification

Per-node vitest proves each module in isolation, but it does not prove the assembled app actually boots. `POST /api/workspace/runtime-verify` (`runWorkspaceRuntimeVerification` in `server/index.mjs`) runs a separate end-to-end pass over the whole workspace and returns `{ ok, result }` where `result.status` is `passed | failed` plus the collected `checks`, `failures`, and captured stdout/stderr.

The phase runs, in order:

1. **Isolation gate (before).** Same external-symlink / host-path / pnpm-entry guard as the per-node loop, re-run against the assembled workspace.
2. **Dependency sync.** Installs the workspace's own dependencies (skipped with a reason when already satisfied).
3. **Quality scripts.** Requires `test`, `build`, and every quality script enabled by the harness (`lint`, `typecheck`, `e2e`). A missing required script fails closed; optional missing scripts are explicitly recorded as skipped.
4. **Dev-server smoke.** `runDevServerSmoke` boots the workspace's `dev` script on an allocated loopback port and requires a mountable HTML readiness response, not merely a non-empty HTTP 200. The temporary server is always stopped after evidence is collected.
5. **Isolation gate (after).** Re-checks isolation once the app has been installed and booted.

Only fully wired Node targets are selectable: **SaaS Web App** and **Agent Tooling**. Python/FastAPI, Tauri/Rust, and Flutter/Dart remain visible but disabled until complete runtime adapters exist.

## Reliability details

Things that broke during real E2E testing and got fixed:

- **Vitest resolution leaking to sibling projects.** `npx vitest` via pnpm's shared store was picking up a neighbor repo's vitest. `detectTestRunner` now invokes `<cwd>/node_modules/.bin/vitest` directly when present.
- **Stop not stopping.** In-flight fetch kept going; late response overwrote paused state. Fixed with `AbortController` + a `buildGenRef` generation counter; every await re-checks `isCurrent()`.
- **Stale per-node context.** The driver kept a local snapshot of `records` that never updated; node N always saw `previouslyBuilt = []`. Fixed by mirroring every `updateNodeRecord` into the local snapshot atomically.
- **File diff missing modifications.** The `files` list only captured new files. Replaced with content-hash snapshots before/after so modified files are reported even when mtimes collide.
- **Path-escape inconsistency.** `/api/build-state/save|load` and `/api/ai/build-node` bypassed `ensureWithinRoot`; file read/write APIs also needed realpath checks so existing symlinks cannot escape the workspace. These now route through root + realpath guards.
- **External dependency leakage.** Codex once linked `node_modules` to a sibling project. Build-node now runs a workspace isolation gate after every attempt and feeds violations back into the retry loop instead of silently passing.
- **Reload hang.** `reloadNativeWorkspace` errors inside the loop used to leave `running:true` forever. Now wrapped in a `safeReloadNativeWorkspace` that surfaces a notice and lets the driver continue.
- **Cross-workspace diagram overwrite.** Opening workspace B right after A could write A's nodes into B's disk file. A `hydratedKeyRef` now gates the save effect: only writes after the load effect has confirmed the current key.
- **Silent 20× `spawnSync`.** `codexStatus()` forked a process on every request. Now cached with a 30s TTL; `/api/auth/status` still takes a fresh read.

## Limitations

- Diagram generation and each node build take time — `codex` runs `gpt-5.6-sol` with reasoning effort `high` by default. Override with `GRAPHCODING_CODEX_MODEL` or `GRAPHCODING_CODEX_REASONING_EFFORT`.
- `"testing"` and `"fixing"` statuses are defined but the client doesn't currently stream intermediate server events, so the UI jumps `implementing → done | failed`. Server-sent events for in-progress retries is the next UX upgrade.
- Fallback diagrams/specs are returned as explicit degraded failures (`ok:false`, HTTP 502/503) and never unlock Build.
- The declared support matrix is macOS plus Node-based SaaS Web App and Agent Tooling targets. Windows/Linux native folder dialogs and the disabled non-Node presets are not claimed as verified.

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
