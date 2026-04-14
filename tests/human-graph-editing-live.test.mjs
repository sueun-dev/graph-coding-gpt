import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const createManagedManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_human_edit_live",
  createdAt: "2026-04-13T00:00:00.000Z",
  lastOpenedAt: "2026-04-13T00:00:00.000Z",
  graphHash: "gcg-edit-live",
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
  title: "Human Edit Diagram",
  summary: "editing flow",
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
    {
      id: "process-1",
      shape: "process",
      title: "처리 노드",
      actor: "시스템",
      intent: "중간 처리를 수행한다",
      behavior: "핵심 로직을 실행한다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "",
      status: "planned",
      position: { x: 420, y: 120 },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "start",
      target: "process-1",
      relation: "시작 후 처리",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    },
  ],
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

const waitForDiagramArtifact = async (diagramPath, predicate) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(diagramPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0 && (!predicate || predicate(parsed))) {
        return parsed;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for edited diagram artifact at ${diagramPath}`);
};

test("human graph editing updates restored diagrams, selection actions, and persisted artifacts", async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live graph editing test");

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-human-edit-live-"));
  const workspaceRoot = path.join(root, "managed-edit-workspace");
  const diagramPath = path.join(workspaceRoot, ".graphcoding", "diagram.graph.json");

  await mkdir(path.join(workspaceRoot, ".graphcoding"), { recursive: true });
  await writeFile(path.join(workspaceRoot, ".graphcoding", "manifest.json"), JSON.stringify(createManagedManifest(), null, 2));
  await writeFile(path.join(workspaceRoot, ".graphcoding", "harness.json"), JSON.stringify(createHarness("managed-edit-workspace"), null, 2));
  await writeFile(diagramPath, JSON.stringify(createManagedDiagram(), null, 2));

  try {
    const { context, page } = await openWorkspace(browser, workspaceRoot);

    await page.locator(".diagram-node").filter({ hasText: "시작 노드" }).first().click({ force: true });
    await page.getByRole("button", { name: "INSPECTOR", exact: true }).click();
    await page.waitForSelector(".inspector .form-stack", { timeout: 10_000 });
    await page.locator(".inspector input").first().fill("수정된 시작 노드");
    assert.equal(await page.locator(".inspector input").first().inputValue(), "수정된 시작 노드");
    await page.locator(".inspector select").first().selectOption("screen");

    await page.locator(".inspector-actions").getByRole("button", { name: "Duplicate Node", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("3 nodes"), { timeout: 10_000 });
    await page.waitForFunction(() => document.body.innerText.includes("unsaved edits") || document.body.innerText.includes("saving..."), { timeout: 10_000 });

    await page.locator(".inspector-actions").getByRole("button", { name: "Delete Node", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("2 nodes"), { timeout: 10_000 });
    await page.waitForFunction(() => document.body.innerText.includes("saved"), { timeout: 30_000 });

    const savedDiagram = await waitForDiagramArtifact(diagramPath, (parsed) => {
      const updatedStartNode = parsed.nodes.find((node) => node.id === "start");
      return updatedStartNode?.title === "수정된 시작 노드" && updatedStartNode?.shape === "screen" && parsed.nodes.length === 2;
    });
    const updatedStartNode = savedDiagram.nodes.find((node) => node.id === "start");

    assert.equal(updatedStartNode?.title, "수정된 시작 노드");
    assert.equal(updatedStartNode?.shape, "screen");
    assert.equal(savedDiagram.nodes.length, 2);
    assert.equal(savedDiagram.edges.length, 1);

    await context.close();
  } finally {
    await browser.close();
  }
});
