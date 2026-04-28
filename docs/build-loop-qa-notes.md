# Build Loop QA Notes

Validated scenario: generated `/tmp/test2-gcg-fixed` from the live build loop and ran it through node-by-node build, test, typecheck, production build, and browser interaction.

## Findings fixed in app logic

- Build order must respect dependency-like edges. Edges such as `uses`, `implements`, `calls`, `creates`, `updates`, and `validates-with` mean the target must be built before the source. Shape-only ordering caused stores/adapters to build before their schema/contracts.
- Codex node prompts must forbid broad host searches and external dependency linking. The bad run created `node_modules` symlinks to another project and a handwritten `node_modules/zod` shim.
- Build prompts must forbid `npx` and `npm exec` for verification. Those caused registry lookups, network stalls, and false retries. Use local package-manager commands or local binaries only.
- The app now enforces this after each Codex attempt: external symlinks, outside absolute filesystem references, and pnpm package entries that are real directories are treated as node failures and retried.
- Workspace file APIs must resolve symlinks before reading or writing. A lexical root check is not enough if `path/in/workspace` is itself a symlink to another folder.
- Codex subprocesses need workspace-local cache env (`COREPACK_HOME`, `PNPM_HOME`, `NPM_CONFIG_CACHE`, `XDG_CACHE_HOME`) so package managers do not write into the user's home cache during sandboxed runs.
- The test runner should use local `node_modules/.bin/vitest` or `node_modules/vitest/vitest.mjs`; it should not fall back to network-based `npx`.
- Resume logic must not set `isFirst=true` after some nodes are already done. Otherwise a resumed middle node may try to re-scaffold the project.
- The graph/prompt must require visible UI controls for every user-owned process. The generated app had an add-habit process but initially no add-habit control.
- Start/end or app-host nodes must own real run artifacts: package scripts, runtime entry, and smoke coverage. A `launchApp()` export alone is not a runnable app.

## Current generated output caveat

The final `/tmp/test2-gcg-fixed` was repaired to run and pass tests/builds, but its `node_modules` directory still reflects the earlier bad run. It includes external symlinks into another local project. The source and package manifest are now runnable, but a clean install is required before treating that generated folder as portable.
