import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const createManagedManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_graph_review_live",
  createdAt: "2026-04-13T00:00:00.000Z",
  lastOpenedAt: "2026-04-13T00:00:00.000Z",
  graphHash: null,
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

const createDraftDiagram = () => ({
  title: "Graph Review Diagram",
  summary: "approval and reachable flow",
  nodes: [
    {
      id: "start",
      shape: "startEnd",
      title: "시작 단계",
      actor: "사용자",
      intent: "앱을 연다",
      behavior: "트래커를 시작한다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "앱 진입 확인",
      status: "planned",
      position: { x: 80, y: 120 },
    },
    {
      id: "watchlist",
      shape: "process",
      title: "관심코인 준비",
      actor: "시스템",
      intent: "watchlist를 준비한다",
      behavior: "기본 관심 코인을 로드한다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "기본 목록 로드 확인",
      status: "planned",
      position: { x: 420, y: 120 },
    },
    {
      id: "refresh",
      shape: "process",
      title: "가격 갱신",
      actor: "시스템",
      intent: "최신 가격을 가져온다",
      behavior: "빗썸 시세를 새로고침한다",
      inputs: "",
      outputs: "",
      notes: "",
      testHint: "새로고침 흐름 확인",
      status: "planned",
      position: { x: 760, y: 120 },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "start",
      target: "watchlist",
      relation: "앱 실행 후 기본 준비",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    },
    {
      id: "edge-2",
      source: "watchlist",
      target: "refresh",
      relation: "기본 준비 후 가격 갱신",
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

const waitForApprovedArtifacts = async (workspaceRoot) => {
  const approvedPath = path.join(workspaceRoot, ".graphcoding", "diagram.approved.json");
  const workflowPath = path.join(workspaceRoot, ".graphcoding", "workflow-state.json");
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (existsSync(approvedPath) && existsSync(workflowPath)) {
      const approvedRaw = await readFile(approvedPath, "utf8");
      const workflowRaw = await readFile(workflowPath, "utf8");
      const approved = JSON.parse(approvedRaw);
      const workflow = JSON.parse(workflowRaw);

      if (Array.isArray(approved.nodes) && approved.nodes.length === 3) {
        return { approved, workflow };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for approved graph artifacts.");
};

test("graph approval and reachable step gating work through the live UI", { timeout: 240_000 }, async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live graph review test");

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-graph-review-live-"));
  const workspaceRoot = path.join(root, "managed-graph-review-workspace");
  await mkdir(path.join(workspaceRoot, ".graphcoding"), { recursive: true });
  await writeFile(path.join(workspaceRoot, ".graphcoding", "manifest.json"), JSON.stringify(createManagedManifest(), null, 2));
  await writeFile(path.join(workspaceRoot, ".graphcoding", "harness.json"), JSON.stringify(createHarness("managed-graph-review-workspace"), null, 2));
  await writeFile(path.join(workspaceRoot, ".graphcoding", "diagram.graph.json"), JSON.stringify(createDraftDiagram(), null, 2));

  try {
    let session = await openWorkspace(browser, workspaceRoot);
    let { context, page } = session;

    await page.getByRole("button", { name: "AI", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Approve Graph"), { timeout: 30_000 });
    await page.waitForFunction(() => document.body.innerText.includes("현재 diagram은 draft 상태입니다."), { timeout: 30_000 });

    await page.getByRole("button", { name: "Approve Graph", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Approved graph가 현재 개발 기준입니다."), { timeout: 30_000 });

    const { workflow } = await waitForApprovedArtifacts(workspaceRoot);
    assert.deepEqual(workflow.approvedNodeIds, []);
    assert.deepEqual(workflow.reachableNodeIds, ["start"]);
    assert.equal(workflow.finalStatus, "in-progress");

    await page.locator(".diagram-node").filter({ hasText: "가격 갱신" }).first().click({ force: true });
    await page.getByRole("button", { name: "Generate Selection Spec", exact: true }).click();
    await page.getByText("현재 선택한 step은 아직 reachable하지 않습니다.", { exact: false }).first().waitFor({ timeout: 30_000 });

    await page.locator(".diagram-node").filter({ hasText: "시작 단계" }).first().click({ force: true });
    await page.getByText("시작 단계: 현재 build 가능한 reachable step입니다.", { exact: false }).first().waitFor({ timeout: 30_000 });

    await writeFile(
      path.join(workspaceRoot, ".graphcoding", "step-history.json"),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              nodeId: "start",
              approvedAt: "2026-04-13T01:00:00.000Z",
              buildMode: "selection",
              buildGeneratedAt: "2026-04-13T00:59:00.000Z",
              buildLogPath: null,
              buildPromptPath: null,
              verificationSummary: ["Selection build completed."],
            },
          ],
        },
        null,
        2,
      ),
    );

    await context.close();
    session = await openWorkspace(browser, workspaceRoot);
    ({ context, page } = session);
    await page.locator(".diagram-node").filter({ hasText: "관심코인 준비" }).first().click({ force: true });
    await page.getByText("관심코인 준비: 현재 build 가능한 reachable step입니다.", { exact: false }).first().waitFor({ timeout: 30_000 });

    await context.close();
  } finally {
    await browser.close();
  }
});
