import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const createManagedManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_live_browser",
  createdAt: "2026-04-13T00:00:00.000Z",
  lastOpenedAt: "2026-04-13T00:00:00.000Z",
  graphHash: "gcg-test",
  state: "workflow-in-progress",
});

const createHarness = (projectName) => ({
  version: 1,
  presetId: "desktop-app",
  projectName,
  projectGoal: "Build a production-ready web application from the diagram.",
  stack: {
    appType: "desktop-app",
    frontend: "React + Vite",
    backend: "Tauri / Electron bridge",
    runtime: "Rust + Node.js",
    packageManager: "pnpm",
    styling: "Native dark shell",
    database: "SQLite / local files",
    auth: "Optional local profile",
  },
  agent: {
    primaryModel: "gpt-5.4",
    reasoningEffort: "xhigh",
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
  title: "Saved Diagram",
  summary: "saved state",
  nodes: [
    {
      id: "start",
      shape: "startEnd",
      title: "앱 실행",
      actor: "사용자",
      intent: "시작",
      behavior: "앱을 시작한다",
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
  const context = await browser.newContext();
  await context.addInitScript(([storageKey, value]) => {
    window.localStorage.clear();
    window.localStorage.setItem(storageKey, value);
  }, [ROOT_KEY, rootPath]);
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_500);
  return { context, page };
};

const saveHarnessFromModal = async (page) => {
  let modalVisible = true;
  try {
    await page.waitForSelector(".setup-modal__dialog", { timeout: 3_000 });
  } catch {
    modalVisible = false;
  }

  if (!modalVisible) {
    const trigger = page.getByRole("button", { name: /Create Harness|Edit Harness|Workspace Setup/, exact: false }).first();
    await trigger.click();
  }
  await page.waitForSelector(".setup-modal__dialog", { timeout: 30_000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Save Harness", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".setup-modal__dialog"), { timeout: 30_000 });
  await page.waitForTimeout(1_000);
};

test("workspace bootstrap live flow handles managed and unmanaged branches end to end", async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live bootstrap test");

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-bootstrap-live-"));
  const codeRoot = path.join(root, "code-intake");
  const emptyRoot = path.join(root, "empty-workspace");
  const managedRoot = path.join(root, "managed-workspace");

  await mkdir(path.join(codeRoot, "src"), { recursive: true });
  await writeFile(path.join(codeRoot, "package.json"), JSON.stringify({ name: "code-intake", private: true }));
  await writeFile(path.join(codeRoot, "src", "main.tsx"), "export const codeInput = 1;\n");

  await mkdir(emptyRoot, { recursive: true });

  await mkdir(path.join(managedRoot, ".graphcoding"), { recursive: true });
  await mkdir(path.join(managedRoot, "src"), { recursive: true });
  await writeFile(path.join(managedRoot, ".graphcoding", "manifest.json"), JSON.stringify(createManagedManifest(), null, 2));
  await writeFile(path.join(managedRoot, ".graphcoding", "harness.json"), JSON.stringify(createHarness("managed-workspace"), null, 2));
  await writeFile(path.join(managedRoot, ".graphcoding", "diagram.graph.json"), JSON.stringify(createManagedDiagram(), null, 2));
  await writeFile(path.join(managedRoot, "src", "main.tsx"), "export const managedInput = 1;\n");

  try {
    {
      const { context, page } = await openWorkspace(browser, codeRoot);
      const body = await page.locator("body").innerText();
      assert.equal(body.includes("Use Current Code As Input"), false);
      assert.equal(body.includes("Fresh Graph Workflow"), false);
      await saveHarnessFromModal(page);

      const resume = JSON.parse(await readFile(path.join(codeRoot, ".graphcoding", "resume-state.json"), "utf8"));
      assert.equal(resume.decisionKind, "analyze-existing-code");
      assert.equal(existsSync(path.join(codeRoot, ".graphcoding", "manifest.json")), true);
      assert.equal(existsSync(path.join(codeRoot, ".graphcoding", "diagram.graph.json")), false);

      const briefValue = await page.locator("textarea.runtime-textarea").inputValue();
      assert.match(briefValue, /현재 workspace에 이미 있는 코드를 기준으로 graph workflow를 시작하고 싶어/);
      assert.match(briefValue, /대표 코드 파일: src\/main\.tsx/);
      await context.close();
    }

    {
      const { context, page } = await openWorkspace(browser, emptyRoot);
      const body = await page.locator("body").innerText();
      assert.equal(body.includes("Use Current Code As Input"), false);
      assert.equal(body.includes("Fresh Graph Workflow"), false);
      await saveHarnessFromModal(page);

      const resume = JSON.parse(await readFile(path.join(emptyRoot, ".graphcoding", "resume-state.json"), "utf8"));
      assert.equal(resume.decisionKind, "initialize-fresh-workflow");
      assert.equal(existsSync(path.join(emptyRoot, ".graphcoding", "manifest.json")), true);
      assert.equal(existsSync(path.join(emptyRoot, ".graphcoding", "diagram.graph.json")), false);

      const briefValue = await page.locator("textarea.runtime-textarea").inputValue();
      assert.equal(briefValue.trim(), "");
      await context.close();
    }

    {
      const { context, page } = await openWorkspace(browser, managedRoot);
      const body = await page.locator("body").innerText();
      assert.equal(body.includes("Use Current Code As Input"), false);
      assert.equal(await page.locator(".setup-modal__dialog").count(), 0);
      assert.equal(await page.locator(".diagram-node").count() > 0, true);
      assert.equal(body.includes("우측 AI 패널의 Brief to Diagram에 러프 요구를 적으면 GPT-5.4가 첫 기본 diagram을 구성합니다."), false);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
