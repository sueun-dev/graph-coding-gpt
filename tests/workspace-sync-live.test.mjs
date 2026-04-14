import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const createManagedManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_workspace_sync_live",
  createdAt: "2026-04-13T00:00:00.000Z",
  lastOpenedAt: "2026-04-13T00:00:00.000Z",
  graphHash: "gcg-sync-live",
  state: "graph-draft",
});

const createHarness = (projectName) => ({
  version: 1,
  presetId: "desktop-app",
  projectName,
  projectGoal: "Build a desktop application from the diagram.",
  stack: {
    appType: "desktop-app",
    frontend: "React + Vite",
    backend: "Tauri / Electron bridge",
    runtime: "Rust + Node.js",
    packageManager: "pnpm",
    styling: "Native dark shell",
    database: "SQLite / local files when persistence is needed",
    auth: "Optional local profile if multi-user separation is needed",
  },
  agent: {
    primaryModel: "gpt-5.4",
    reasoningEffort: "high",
    sandbox: "workspace-write",
    tools: {
      mcp: true,
      shell: true,
      browser: true,
      applyPatch: true,
      fileSearch: true,
    },
  },
  quality: {
    lint: true,
    typecheck: true,
    unitTests: true,
    e2eTests: true,
    partialBuilds: true,
    requireTestsBeforeDone: true,
    allowStubsOutsideScope: false,
  },
  paths: {
    configDir: ".graphcoding",
    artifactDir: "generated",
    testsDir: "tests",
  },
  notes: [],
});

const createManagedDiagram = () => ({
  title: "Workspace Sync Diagram",
  summary: "sync after external deletes",
  nodes: [
    {
      id: "start",
      shape: "startEnd",
      title: "시작 노드",
      actor: "사용자",
      intent: "시작한다",
      behavior: "첫 진입 흐름을 연다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "",
      status: "planned",
      position: { x: 80, y: 120 },
    },
  ],
  edges: [],
  scope: { mode: "full", nodeIds: [] },
});

const openWorkspace = async (browser, rootPath) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await context.addInitScript(([storageKey, value]) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, value);
  }, [ROOT_KEY, rootPath]);
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_500);
  return { context, page };
};

test("workspace live sync clears deleted diagram and harness artifacts from the UI", { timeout: 240_000 }, async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live workspace sync test");

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-workspace-sync-live-"));
  const workspaceRoot = path.join(root, "managed-sync-workspace");
  const graphcodingRoot = path.join(workspaceRoot, ".graphcoding");

  await mkdir(graphcodingRoot, { recursive: true });
  await writeFile(path.join(graphcodingRoot, "manifest.json"), JSON.stringify(createManagedManifest(), null, 2));
  await writeFile(path.join(graphcodingRoot, "harness.json"), JSON.stringify(createHarness("managed-sync-workspace"), null, 2));
  await writeFile(path.join(graphcodingRoot, "diagram.graph.json"), JSON.stringify(createManagedDiagram(), null, 2));

  try {
    const { context, page } = await openWorkspace(browser, workspaceRoot);

    await page.waitForFunction(() => document.body.innerText.includes("1 nodes"), { timeout: 30_000 });
    assert.equal(await page.locator(".diagram-node").count(), 1);
    await page.waitForFunction(() => document.body.innerText.includes("desktop-app preset fixed in workspace"), { timeout: 30_000 });

    await rm(path.join(graphcodingRoot, "diagram.graph.json"));
    await rm(path.join(graphcodingRoot, "harness.json"));

    await page.waitForFunction(() => document.body.innerText.includes("0 nodes"), { timeout: 30_000 });
    await page.waitForFunction(
      () => document.body.innerText.includes("Create or load .graphcoding/harness.json"),
      { timeout: 30_000 },
    );

    assert.equal(await page.locator(".diagram-node").count(), 0);
    assert.equal((await page.locator("body").innerText()).includes("Create or load .graphcoding/harness.json"), true);
    assert.equal(await page.locator(".setup-modal__dialog").count(), 0);

    await context.close();
  } finally {
    await browser.close();
  }
});
