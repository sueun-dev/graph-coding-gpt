import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const ROOT = process.cwd();

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });

const waitForServer = async (port) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the server starts listening.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for the server to start.");
};

let port;
let serverProcess;

before(async () => {
  port = await getFreePort();
  serverProcess = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: "ignore",
  });

  await waitForServer(port);
});

after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill("SIGTERM");
  await new Promise((resolve) => {
    serverProcess.once("exit", () => resolve(undefined));
    setTimeout(() => resolve(undefined), 3000);
  });
});

const createApiWorkspace = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "graph-coding-gpt-api-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
  await writeFile(path.join(root, "src", "main.tsx"), "console.log('hello');\n");

  return {
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
};

const createManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_api_test",
  createdAt: "2026-04-12T00:00:00.000Z",
  lastOpenedAt: "2026-04-12T00:00:00.000Z",
  graphHash: null,
  state: "initialized",
});

test("workspace reload returns bootstrap metadata for a valid root", async () => {
  const workspace = await createApiWorkspace();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workspace.root }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.rootName, path.basename(workspace.root));
    assert.equal(body.bootstrap.workspaceKind, "Vite app workspace");
    assert.equal(body.bootstrap.fileCount, 3);
    assert.equal(body.bootstrap.hasHarness, false);
    assert.deepEqual(body.files.map((file) => file.path).sort(), ["package.json", "src/main.tsx", "vite.config.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("workspace reload rejects a missing rootPath", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /rootPath is required/i);
});

test("workspace read-file returns content and blocks path traversal", async () => {
  const workspace = await createApiWorkspace();

  try {
    const readResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        path: "src/main.tsx",
      }),
    });

    assert.equal(readResponse.status, 200);
    const readBody = await readResponse.json();
    assert.equal(readBody.ok, true);
    assert.match(readBody.content, /console\.log/);

    const traversalResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        path: "../outside.txt",
      }),
    });

    assert.equal(traversalResponse.status, 400);
    const traversalBody = await traversalResponse.json();
    assert.equal(traversalBody.ok, false);
    assert.match(traversalBody.error, /Path escapes workspace root/);
  } finally {
    await workspace.cleanup();
  }
});

test("workspace write-artifacts writes inside the root and survives reload", async () => {
  const workspace = await createApiWorkspace();

  try {
    const writeResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/write-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        artifacts: [
          {
            path: ".graphcoding/harness.json",
            content: '{"presetId":"desktop-app"}\n',
          },
          {
            path: "generated/notes.txt",
            content: "bootstrap ok\n",
          },
        ],
      }),
    });

    assert.equal(writeResponse.status, 200);
    const writeBody = await writeResponse.json();
    assert.equal(writeBody.ok, true);

    const harnessContent = await readFile(path.join(workspace.root, ".graphcoding", "harness.json"), "utf8");
    const notesContent = await readFile(path.join(workspace.root, "generated", "notes.txt"), "utf8");
    assert.match(harnessContent, /desktop-app/);
    assert.match(notesContent, /bootstrap ok/);

    const reloadResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workspace.root }),
    });

    assert.equal(reloadResponse.status, 200);
    const reloadBody = await reloadResponse.json();
    assert.equal(reloadBody.ok, true);
    assert.equal(reloadBody.bootstrap.hasHarness, true);
    assert.equal(reloadBody.bootstrap.resume.hasManifest, false);
    assert.ok(reloadBody.files.some((file) => file.path === ".graphcoding/harness.json"));
    assert.ok(reloadBody.files.some((file) => file.path === "generated/notes.txt"));
  } finally {
    await workspace.cleanup();
  }
});

test("workspace reload marks valid manifests as managed workspaces", async () => {
  const workspace = await createApiWorkspace();

  try {
    const writeResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/write-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        artifacts: [
          {
            path: ".graphcoding/manifest.json",
            content: JSON.stringify(createManifest(), null, 2),
          },
          {
            path: ".graphcoding/harness.json",
            content: '{"presetId":"desktop-app"}\n',
          },
        ],
      }),
    });

    assert.equal(writeResponse.status, 200);

    const reloadResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workspace.root }),
    });

    assert.equal(reloadResponse.status, 200);
    const reloadBody = await reloadResponse.json();
    assert.equal(reloadBody.ok, true);
    assert.equal(reloadBody.bootstrap.resume.hasManifest, true);
    assert.equal(reloadBody.bootstrap.resume.resumeBranch.kind, "managed-workspace");
    assert.equal(reloadBody.bootstrap.resume.internalBranch.kind, "managed-harness-on-codebase");
  } finally {
    await workspace.cleanup();
  }
});

test("workspace write-artifacts rejects traversal attempts", async () => {
  const workspace = await createApiWorkspace();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspace/write-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        artifacts: [
          {
            path: "../escape.txt",
            content: "nope\n",
          },
        ],
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Path escapes workspace root/);
  } finally {
    await workspace.cleanup();
  }
});

test("workspace reload honors a saved resume-state decision", async () => {
  const workspace = await createApiWorkspace();

  try {
    const writeResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/write-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspace.root,
        artifacts: [
          {
            path: ".graphcoding/resume-state.json",
            content: JSON.stringify(
              {
                version: 1,
                branchKind: "code-only",
                decisionKind: "initialize-fresh-workflow",
                decidedAt: "2026-04-12T00:00:00.000Z",
                graphHash: null,
              },
              null,
              2,
            ),
          },
        ],
      }),
    });

    assert.equal(writeResponse.status, 200);

    const reloadResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workspace.root }),
    });

    assert.equal(reloadResponse.status, 200);
    const reloadBody = await reloadResponse.json();
    assert.equal(reloadBody.ok, true);
    assert.equal(reloadBody.bootstrap.resume.resumeBranch.kind, "unmanaged-workspace");
    assert.equal(reloadBody.bootstrap.resume.internalBranch.kind, "legacy-fresh-workflow-requested");
    assert.equal(reloadBody.bootstrap.resume.resumeBranch.needsDecision, false);
    assert.equal(reloadBody.bootstrap.resume.resumeDecision.decisionKind, "initialize-fresh-workflow");
  } finally {
    await workspace.cleanup();
  }
});

test("workspace reload rejects file paths that are not directories", async () => {
  const workspace = await createApiWorkspace();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspace/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: path.join(workspace.root, "package.json") }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Selected path is not a directory/);
  } finally {
    await workspace.cleanup();
  }
});
