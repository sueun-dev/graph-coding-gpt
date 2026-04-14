import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";

import { detectWorkspaceKind, ensureWithinRoot, readWorkspaceListing } from "../server/workspace-bootstrap.mjs";

const createTempWorkspace = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "graph-coding-gpt-bootstrap-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, ".graphcoding"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, "coverage"), { recursive: true });

  await writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "src", "main.tsx"), "console.log('ok');\n");
  await writeFile(
    path.join(root, ".graphcoding", "manifest.json"),
    JSON.stringify(
      {
        marker: "graph-coding-gpt-workspace",
        app: "graph-coding-gpt",
        formatVersion: 1,
        workspaceId: "gcg_ws_bootstrap_test",
        createdAt: "2026-04-12T00:00:00.000Z",
        lastOpenedAt: "2026-04-12T00:00:00.000Z",
        graphHash: null,
        state: "initialized",
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(root, ".graphcoding", "harness.json"), "{}\n");
  await writeFile(path.join(root, ".git", "config"), "[core]\n");
  await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n");
  await writeFile(path.join(root, "coverage", "coverage-final.json"), "{}\n");
  await writeFile(path.join(root, ".DS_Store"), "ignored\n");

  const external = await mkdtemp(path.join(os.tmpdir(), "graph-coding-gpt-external-"));
  await mkdir(path.join(external, "nested"), { recursive: true });
  await writeFile(path.join(external, "secret.txt"), "outside\n");
  await symlink(path.join(external, "secret.txt"), path.join(root, "linked-secret.txt"));
  await symlink(path.join(external, "nested"), path.join(root, "linked-dir"));

  return {
    root,
    external,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    },
  };
};

test("readWorkspaceListing canonicalizes the root and skips ignored or symlinked entries", async () => {
  const workspace = await createTempWorkspace();

  try {
    const listing = await readWorkspaceListing(workspace.root);
    const canonicalRoot = await realpath(workspace.root);

    assert.equal(listing.rootPath, canonicalRoot);
    assert.equal(listing.rootName, path.basename(canonicalRoot));

    const filePaths = listing.files.map((file) => file.path);
    assert.deepEqual(filePaths, [".graphcoding/harness.json", ".graphcoding/manifest.json", "package.json", "src/main.tsx", "vite.config.ts"]);

    assert.equal(listing.bootstrap.workspaceKind, "Vite app workspace");
    assert.equal(listing.bootstrap.hasHarness, true);
    assert.equal(listing.bootstrap.resume.hasManifest, true);
    assert.equal(listing.bootstrap.resume.resumeBranch.kind, "managed-workspace");
    assert.equal(listing.bootstrap.resume.internalBranch.kind, "managed-harness-on-codebase");
    assert.equal(listing.bootstrap.ignoredDirectoryCount, 3);
    assert.equal(listing.bootstrap.symlinkEntryCount, 2);
    assert.deepEqual(listing.bootstrap.projectMarkers.sort(), [".graphcoding/harness.json", ".graphcoding/manifest.json", "package.json", "vite.config.ts"]);
    assert.match(listing.bootstrap.workspaceSummary, /Vite app workspace/);
    assert.match(listing.bootstrap.workspaceSummary, /3 ignored directories/);
    assert.match(listing.bootstrap.workspaceSummary, /2 symlink entries skipped/);
    assert.ok(listing.bootstrap.warnings.some((warning) => warning.includes("Symlinked files and directories")));
    assert.deepEqual(listing.bootstrap.entryFiles.sort(), [".graphcoding/harness.json", ".graphcoding/manifest.json", "package.json", "src/main.tsx", "vite.config.ts"]);
    assert.ok(listing.bootstrap.ignoredDirectories.includes(".git"));
    assert.ok(listing.bootstrap.ignoredDirectories.includes("node_modules"));
    assert.ok(listing.bootstrap.ignoredDirectories.includes("coverage"));
    assert.ok(listing.bootstrap.symlinkEntries.includes("linked-secret.txt"));
    assert.ok(listing.bootstrap.symlinkEntries.includes("linked-dir"));
  } finally {
    await workspace.cleanup();
  }
});

test("ensureWithinRoot allows internal paths and rejects traversal", () => {
  const rootPath = "/tmp/graph-coding-gpt";

  assert.equal(ensureWithinRoot(rootPath, "src/main.tsx"), "/tmp/graph-coding-gpt/src/main.tsx");
  assert.throws(() => ensureWithinRoot(rootPath, "../escape.txt"), /Path escapes workspace root/);
});

test("detectWorkspaceKind classifies common workspace markers", () => {
  assert.equal(detectWorkspaceKind(new Set(["package.json", "vite.config.ts"])), "Vite app workspace");
  assert.equal(detectWorkspaceKind(new Set(["electron/main.ts", "package.json"])), "Electron desktop workspace");
  assert.equal(detectWorkspaceKind(new Set(["Cargo.toml", "src-tauri/tauri.conf.json"])), "Tauri desktop workspace");
  assert.equal(detectWorkspaceKind(new Set(["pyproject.toml"])), "Python workspace");
  assert.equal(detectWorkspaceKind(new Set(["README.md"])), "Generic workspace");
});
