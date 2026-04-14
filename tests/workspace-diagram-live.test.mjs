import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const APP_URL = "http://localhost:8787";
const ROOT_KEY = "graph-coding-gpt.workspace.native-root.v1";

const openWorkspace = async (browser, rootPath) => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
  });
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
  await page.waitForTimeout(1_500);
};

const focusAiPanel = async (page) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const briefBox = page.locator("textarea.runtime-textarea");
  await briefBox.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const element = document.querySelector("textarea.runtime-textarea");
    if (!(element instanceof HTMLTextAreaElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  }, { timeout: 30_000 });
  return briefBox;
};

const waitForDiagramResponse = async (page, trigger) => {
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/ai/diagram") && response.request().method() === "POST",
    { timeout: 360_000 },
  );
  await trigger();
  const response = await responsePromise;
  const payload = await response.json();
  assert.equal(payload.ok, true, "diagram API must succeed");
  assert.equal(payload.source, "codex", payload.error || "diagram API should use live Codex, not fallback");
  return payload;
};

const waitForDiagramState = async (page) => {
  await page.waitForFunction(() => {
    const bodyText = document.body.innerText;
    return bodyText.includes("Refine Current Diagram") && !bodyText.includes("현재 결과는 fallback diagram입니다.");
  }, undefined, { timeout: 30_000 });
};

const waitForDiagramArtifact = async (diagramPath) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(diagramPath)) {
      const raw = await readFile(diagramPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0 && Array.isArray(parsed.edges)) {
        return parsed;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for diagram artifact at ${diagramPath}`);
};

test("live diagram generation completes through the UI for fresh and code-intake workspaces", { timeout: 600_000 }, async () => {
  const health = await fetch(`${APP_URL}/api/health`);
  assert.equal(health.ok, true, "local server must be running before the live diagram test");

  const authStatus = await fetch(`${APP_URL}/api/auth/status`).then((response) => response.json());
  assert.equal(authStatus.codexInstalled, true);
  assert.equal(authStatus.codexAuthenticated, true);

  const playwrightModule = await import("playwright");
  const browser = await playwrightModule.chromium.launch({ headless: true });

  const root = await mkdtemp(path.join(os.tmpdir(), "gcg-diagram-live-"));
  const emptyRoot = path.join(root, "fresh-workspace");
  const codeRoot = path.join(root, "code-intake-workspace");

  await mkdir(emptyRoot, { recursive: true });
  await mkdir(path.join(codeRoot, "src"), { recursive: true });
  await writeFile(path.join(codeRoot, "package.json"), JSON.stringify({ name: "live-code-intake", private: true }));
  await writeFile(path.join(codeRoot, "src", "main.tsx"), "export const liveCodeInput = 1;\n");

  try {
    {
      const { context, page } = await openWorkspace(browser, emptyRoot);
      await saveHarnessFromModal(page);

      const briefBox = await focusAiPanel(page);
      await briefBox.fill("빗썸 코인 가격 트래커 데스크톱 앱을 만들고 싶어. 관심 코인 목록, 현재가, 수동 새로고침이 필요해.");
      const freshPayload = await waitForDiagramResponse(page, () =>
        page.getByRole("button", { name: "Generate First Diagram", exact: true }).click(),
      );
      await waitForDiagramState(page);

      const body = await page.locator("body").innerText();
      const savedDiagram = await waitForDiagramArtifact(path.join(emptyRoot, ".graphcoding", "diagram.graph.json"));
      assert.equal(freshPayload.diagram.nodes.length > 0, true);
      assert.equal(freshPayload.diagram.edges.length > 0, true);
      assert.equal(body.includes("Refine Current Diagram"), true);
      assert.equal(body.includes("Replace Diagram"), true);
      assert.equal(body.includes("현재 결과는 fallback diagram입니다."), false);
      assert.equal(savedDiagram.nodes.length > 0, true);
      assert.equal(savedDiagram.edges.length > 0, true);
      await context.close();
    }

    {
      const { context, page } = await openWorkspace(browser, codeRoot);
      await saveHarnessFromModal(page);

      const briefBox = await focusAiPanel(page);
      const briefValue = await briefBox.inputValue();
      assert.match(briefValue, /현재 workspace에 이미 있는 코드를 기준으로 graph workflow를 시작하고 싶어/);
      assert.match(briefValue, /대표 코드 파일: src\/main\.tsx/);
      await briefBox.fill("빗썸 코인 가격 트래커 데스크톱 앱을 만들고 싶어. 관심 코인 목록, 현재가, 수동 새로고침이 필요해.");

      const codePayload = await waitForDiagramResponse(page, () =>
        page.getByRole("button", { name: "Generate First Diagram", exact: true }).click(),
      );
      await waitForDiagramState(page);

      const body = await page.locator("body").innerText();
      const savedDiagram = await waitForDiagramArtifact(path.join(codeRoot, ".graphcoding", "diagram.graph.json"));
      const resumeState = JSON.parse(await readFile(path.join(codeRoot, ".graphcoding", "resume-state.json"), "utf8"));
      assert.equal(resumeState.decisionKind, "analyze-existing-code");
      assert.equal(codePayload.diagram.nodes.length > 0, true);
      assert.equal(body.includes("Refine Current Diagram"), true);
      assert.equal(body.includes("현재 결과는 fallback diagram입니다."), false);
      assert.equal(savedDiagram.nodes.length > 0, true);
      assert.equal(existsSync(path.join(codeRoot, ".graphcoding", "diagram.graph.json")), true);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
