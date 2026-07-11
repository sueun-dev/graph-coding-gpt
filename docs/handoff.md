# Graph Coding GPT Handoff

Last updated: 2026-06-01

This repo is the portable handoff point for Graph Coding GPT. Use the GitHub
remote as the source of truth:

```bash
git clone https://github.com/sueun-dev/graph-coding-gpt.git
cd graph-coding-gpt
git status --short --branch
```

Expected branch is `main`, tracking `origin/main`.

## What This Project Is

Graph Coding GPT is a local React + Express app for diagram-driven coding:

1. Open a target workspace folder.
2. Write a short product brief.
3. Generate or edit a graph of implementation nodes.
4. Run the build loop so Codex implements one graph node at a time.
5. Persist diagram/build progress under the target workspace's `.graphcoding/`
   folder.

The app itself lives in this repo. Generated projects are intentionally not
committed here.

## Runtime Requirements

- Node.js 18+
- npm
- Codex CLI installed and logged in
- A target workspace folder that Codex is allowed to modify

Check Codex auth before a build-loop run:

```bash
codex login status
```

The server runs Codex with:

- model: `gpt-5.6-sol` (GPT-5.6 Sol) by default
- reasoning effort: `high` by default
- sandbox: `workspace-write`

Overrides:

```bash
GRAPHCODING_CODEX_MODEL=<model> npm run dev
GRAPHCODING_CODEX_REASONING_EFFORT=high npm run dev
GRAPHCODING_PORT=9100 npm run dev
```

## Fresh Machine Setup

```bash
git clone https://github.com/sueun-dev/graph-coding-gpt.git
cd graph-coding-gpt
npm install
npm run build
npm run dev
```

Then open:

```text
http://localhost:5173
```

The default backend port is `8791`. If that port is taken, start with:

```bash
GRAPHCODING_PORT=9100 npm run dev
```

## Main Files

- `src/App.tsx`: main UI shell, build-loop driver, persistence behavior.
- `src/components/`: workbench panels, inspector, build-loop controls, explorer,
  workspace setup modal.
- `src/lib/diagram.ts`: diagram normalization, ordering helpers, graph logic.
- `src/lib/harness.ts`: project harness presets and setup data.
- `src/lib/workspace.ts`: client-side workspace API helpers.
- `server/index.mjs`: Express API, Codex calls, build-node loop, workspace file
  guards, persistence APIs, isolation validation.
- `docs/build-loop-qa-notes.md`: QA notes from the generated app test run and
  fixes that were made afterward.
- `README.md`: product overview, user flow, architecture, limitations.

## Verification Before Continuing Work

Run these after pulling on another computer:

```bash
git fetch origin
git status --short --branch
npm install
npm run build
```

For runtime QA:

```bash
npm run dev
```

Open `http://localhost:5173`, select or type a target workspace folder, generate
a diagram, and start the build loop on a disposable test workspace first.

## Current Reliability Boundaries

These are already handled in the current code:

- Build order respects dependency-like edges, not only node layout.
- Build-node prompts include previously completed node files.
- Test execution prefers the target workspace's local `vitest` binary.
- Per-node Vitest/Jest execution is focused to `tests/<node-slug>`; the terminal
  node and runtime verification retain the full-suite gate.
- Build state persists to `.graphcoding/build-state.json` through serialized,
  atomic writes.
- Diagram state persists to `.graphcoding/diagram.graph.json` after a 400 ms
  debounce.
- Stop uses request aborting plus a generation counter so late responses cannot
  overwrite a paused run.
- Workspace file reads/writes and build-state APIs guard real paths against
  symlink escapes.
- After each Codex attempt, the server rejects external symlinks, host absolute
  path references, and invalid pnpm `node_modules` package entries before
  accepting a node as done.
- Authentication checks are asynchronous and coalesced, isolation uses a
  bounded-concurrency single tree pass, and content snapshots cache unchanged
  streaming hashes.
- Preview, isolation, workspace-file count, subprocess output, and runtime
  artifact retention have explicit limits; hash caches are LRU-bounded and
  runtime artifact cleanup is throttled to once per hour.

Known caveats:

- The UI does not stream intermediate build-node retry states yet; it jumps from
  `implementing` to `done` or `failed`.
- Spec generation is optional and not used by the build loop.
- Fallback diagram/spec responses are explicit degraded failures and cannot
  unlock Build.
- Only Node-based SaaS Web App and Agent Tooling presets are enabled. Python,
  Tauri/Rust, and Flutter presets are disabled until runtime adapters exist.
- macOS is the declared host support. Linux/Windows folder dialogs are not
  claimed as verified.

## Git Handoff Checklist

Before switching machines:

```bash
git status --short --branch
git log --oneline --decorate --max-count=5
git push origin main
```

The clean handoff state is:

- no uncommitted files in `git status --short`
- local `main` and `origin/main` point at the same commit
- `npm run build` passes on the machine that pushed

Do not commit generated target workspaces, `.graphcoding/`, `node_modules/`,
`dist/`, `.tmp/`, or secrets.

## Secret Check

Before making the repo public or sharing broadly:

```bash
rg -n --hidden -S "(api[_-]?key|token|secret|password|sk-|ghp_|github_pat_)" . \
  --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!.tmp' --glob '!generated'
```
