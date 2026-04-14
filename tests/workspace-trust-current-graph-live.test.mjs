import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const createManagedManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_trust_current_graph_live",
  createdAt: "2026-04-14T00:00:00.000Z",
  lastOpenedAt: "2026-04-14T00:00:00.000Z",
  graphHash: null,
  state: "workflow-in-progress",
});

const createHarness = () => ({
  version: 1,
  presetId: "desktop-app",
  projectName: "trust-current-graph-live",
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

const createDiagram = () => ({
  title: "Trust Current Graph",
  summary: "drift recovery",
  nodes: [
    {
      id: "start",
      shape: "startEnd",
      title: "시작",
      actor: "사용자",
      intent: "앱을 연다",
      behavior: "계산기를 시작한다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "앱 시작 확인",
      status: "planned",
      position: { x: 80, y: 120 },
    },
    {
      id: "screen",
      shape: "screen",
      title: "계산기 화면",
      actor: "사용자",
      intent: "계산식을 입력한다",
      behavior: "숫자와 연산자를 본다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "화면 표시 확인",
      status: "planned",
      position: { x: 380, y: 120 },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "start",
      target: "screen",
      relation: "시작 후 계산기 화면 진입",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    },
  ],
  scope: {
    mode: "selection",
    nodeIds: ["screen"],
  },
});

const openWorkspace = async (browser, rootPath) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await context.addInitScript(([storageKey, value]) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, value);
  }, [ROOT_KEY, rootPath]);
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  return { context, page };
};

test("trust current graph resolves managed drift and does not reopen the resume decision on reload", { timeout: 240_000 }, async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live trust-current-graph test");

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-trust-current-graph-live-"));
  const workspaceRoot = path.join(root, "managed-drift-workspace");
  const graphcodingRoot = path.join(workspaceRoot, ".graphcoding");
  await mkdir(graphcodingRoot, { recursive: true });

  await writeFile(path.join(graphcodingRoot, "manifest.json"), JSON.stringify(createManagedManifest(), null, 2));
  await writeFile(path.join(graphcodingRoot, "harness.json"), JSON.stringify(createHarness(), null, 2));
  await writeFile(path.join(graphcodingRoot, "diagram.graph.json"), JSON.stringify(createDiagram(), null, 2));
  await writeFile(
    path.join(graphcodingRoot, "workflow-state.json"),
    JSON.stringify(
      {
        version: 2,
        graphHash: "gcg-deadbeef",
        approvedGraphHash: null,
        approvedAt: null,
        approvalStale: false,
        approvedNodeIds: [],
        reachableNodeIds: [],
        blockedNodeIds: [],
        selectedNodeIds: [],
        lastSpecMode: null,
        specGeneratedAt: null,
        lastBuildMode: null,
        lastBuildAt: null,
        finalStatus: "in-progress",
      },
      null,
      2,
    ),
  );

  try {
    let session = await openWorkspace(browser, workspaceRoot);
    let { context, page } = session;

    await page.waitForFunction(() => document.body.innerText.includes("Managed Drifted Workspace"), { timeout: 30_000 });
    await page.getByRole("button", { name: "Trust Current Graph", exact: true }).click();
    await page.waitForFunction(() => !document.body.innerText.includes("Managed Drifted Workspace"), { timeout: 30_000 });
    await page.waitForFunction(() => document.body.innerText.includes("Graph Review"), { timeout: 30_000 });

    await context.close();

    session = await openWorkspace(browser, workspaceRoot);
    ({ context, page } = session);
    await page.waitForFunction(() => document.body.innerText.includes("Graph Review"), { timeout: 30_000 });
    assert.equal((await page.locator("body").innerText()).includes("Managed Drifted Workspace"), false);

    await context.close();
  } finally {
    await browser.close();
  }
});
