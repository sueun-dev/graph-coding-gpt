import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  buildSelectionStepContract,
  captureWorkspaceSnapshot,
  verifySelectionBuildScope,
} from "../server/build-verifier.mjs";

const write = async (root, relativePath, content) => {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

test("selection verifier passes for a narrow launch-surface change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-verifier-pass-"));
  await write(root, "src/main.tsx", "export const boot = true;\n");
  await write(root, "src/App.tsx", "export const App = () => null;\n");

  const beforeSnapshot = await captureWorkspaceSnapshot(root);

  await write(root, "src/App.tsx", "export const App = () => 'launch-ready';\n");
  await write(root, "src/appLaunch.test.ts", "export const smoke = true;\n");

  const contract = buildSelectionStepContract({
    selectedNodeId: "start",
    selectedNodeTitle: "앱 실행",
    selectedNodeShape: "startEnd",
    requiredBoundaries: [],
    outOfScope: ["관심코인 관리", "가격 히스토리 뷰"],
  });

  const result = await verifySelectionBuildScope({
    rootPath: root,
    beforeSnapshot,
    contract,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diff.touchedFiles.sort(), ["src/App.tsx", "src/appLaunch.test.ts"].sort());
});

test("selection verifier blocks package file changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-verifier-package-"));
  await write(root, "package.json", JSON.stringify({ name: "demo", private: true }, null, 2));
  await write(root, "src/main.tsx", "export const boot = true;\n");

  const beforeSnapshot = await captureWorkspaceSnapshot(root);
  await write(root, "package.json", JSON.stringify({ name: "demo", private: true, dependencies: { react: "^18.0.0" } }, null, 2));

  const contract = buildSelectionStepContract({
    selectedNodeId: "start",
    selectedNodeTitle: "앱 실행",
    selectedNodeShape: "startEnd",
    requiredBoundaries: [],
    outOfScope: [],
  });

  const result = await verifySelectionBuildScope({
    rootPath: root,
    beforeSnapshot,
    contract,
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /Package manager files are out of scope/i);
});

test("selection verifier blocks out-of-scope feature file creation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-verifier-scope-"));
  await write(root, "src/App.tsx", "export const App = () => null;\n");

  const beforeSnapshot = await captureWorkspaceSnapshot(root);
  await write(root, "src/components/WatchlistPanel.tsx", "export const WatchlistPanel = () => null;\n");

  const contract = buildSelectionStepContract({
    selectedNodeId: "start",
    selectedNodeTitle: "앱 실행",
    selectedNodeShape: "startEnd",
    requiredBoundaries: [],
    outOfScope: ["관심코인 관리", "가격 히스토리 뷰"],
  });

  const result = await verifySelectionBuildScope({
    rootPath: root,
    beforeSnapshot,
    contract,
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /watchlist/i);
});

test("selection verifier blocks changes that exceed file budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-build-verifier-budget-"));
  await write(root, "src/main.tsx", "export const boot = true;\n");

  const beforeSnapshot = await captureWorkspaceSnapshot(root);
  for (const fileName of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"]) {
    await write(root, `src/${fileName}`, `export const ${fileName.replace(".ts", "")} = true;\n`);
  }

  const contract = buildSelectionStepContract({
    selectedNodeId: "start",
    selectedNodeTitle: "앱 실행",
    selectedNodeShape: "startEnd",
    requiredBoundaries: [],
    outOfScope: [],
  });

  const result = await verifySelectionBuildScope({
    rootPath: root,
    beforeSnapshot,
    contract,
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /Touched files 7 exceed the allowed maximum 6/);
});
