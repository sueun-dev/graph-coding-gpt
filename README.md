# Graph Coding GPT

AI-assisted diagram-to-app workspace for turning rough product ideas and flow diagrams into implementation specs, build prompts, and code.

## What It Does

Graph Coding GPT is a VS Code-style prototype that lets a user:

- open a real local folder
- define a workspace harness before generation
- describe an app idea in plain text
- generate a first programming diagram with GPT-5.4
- refine the diagram manually with nodes and directed edges
- generate scoped or full implementation specs
- run code generation back into the opened workspace

The goal is simple: draw the system, then let the model turn that structure into an app.

## Current Capabilities

- VS Code-like shell layout with explorer, tabs, editor surface, AI panel, inspector, and bottom panel
- Native folder picker through the local server
- Diagram editor built on React Flow
- Broad node library for programming diagrams:
  `Start / End`, `Screen`, `Process`, `Decision`, `Input`, `Database`, `API`, `Service`, `Queue`, `State`, `Event`, `Auth`, `External`, `Document`, `Note`, `Group`
- `Brief to Diagram` generation with GPT-5.4
- Diagram sanitization to reduce over-inferred product features in the core flow
- `Generate Selection Spec` and `Generate Full Spec`
- `Build Selection Code` and `Build Full Code` against a native workspace
- Harness presets for `SaaS Web App`, `API Service`, `Agent Tooling`, `Desktop App`, and `Mobile App`

## How It Works

### 1. Workspace Setup

Open a local folder and lock in the project environment with a harness. The harness controls:

- stack assumptions
- package/runtime defaults
- sandbox policy
- tool access
- quality gates

### 2. Brief to Diagram

Write a rough sentence like:

`빗썸 코인 가격 트래커를 만들고싶어`

GPT-5.4 turns it into a diagram with concrete nodes and edges. The system also tries to avoid turning guessed features into mandatory core flow. Optional ideas are meant to be expressed as recommendation notes instead of silently becoming requirements.

### 3. Diagram to Spec

Specs are generated in two modes:

- `Generate Selection Spec`: only the selected graph slice
- `Generate Full Spec`: the whole diagram

Selection mode uses the selected nodes plus boundary summaries instead of sending the full graph blindly.

### 4. Spec to Code

Specs produce build prompts, then the local Codex runtime can write code directly into the opened native workspace:

- `Build Selection Code`
- `Build Full Code`

## Tech Stack

- Frontend: React 18, TypeScript, Vite
- Diagram canvas: `@xyflow/react`
- Server: Node.js, Express
- Local model runtime: Codex CLI with GPT-5.4

## Requirements

- Node.js 18+
- npm
- `codex` CLI installed
- active ChatGPT-backed Codex login
- macOS, Linux, or Windows environment supported by the native folder dialog path

Check auth locally with:

```bash
codex login status
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the local server:

```bash
npm run start:server
```

Run the client dev server separately if needed:

```bash
npm run dev:client
```

Run both together:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

## Repository Structure

```text
src/
  components/   UI panels, editor controls, setup modal
  lib/          diagram, harness, workspace, and shared types
  styles/       application styling
server/
  index.mjs     local API server, Codex execution routes, native folder integration
```

## Security and Publishing Notes

This repository is intended to exclude runtime-only artifacts and local machine state.

Ignored by default:

- `node_modules/`
- `dist/`
- `.tmp/`
- `generated/`
- `.graphcoding/`
- `.env*`

Before publishing, search for secrets again:

```bash
rg -n --hidden -S "(api[_-]?key|token|secret|password|sk-|ghp_|github_pat_)" . \
  --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!.tmp' --glob '!generated'
```

## Known Limitations

- Diagram generation can be slow because accuracy is preferred over short timeout behavior.
- Spec generation and code generation depend on local Codex runtime availability.
- Code generation currently works only when the project was opened through the native folder path.
- This is still a prototype; UX copy and execution orchestration are still being tightened.

## Roadmap

- stronger scoped build execution
- richer recommendation nodes
- live build logs in the UI
- automatic test/fix loops after code generation
- desktop packaging through Tauri or Electron

## License

No license file is included yet. Treat the repository as private until a license is added.
