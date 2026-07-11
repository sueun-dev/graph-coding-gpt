import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

describe("Express API fail-closed boundaries", () => {
  let child: ChildProcess;
  let baseUrl = "";

  beforeAll(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, GRAPHCODING_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {
        // Server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("test server did not start");
  });

  afterAll(async () => {
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  });

  it("denies unrelated browser origins before endpoint execution", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/open-folder`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows the approved local UI origin without wildcard CORS", async () => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "http://localhost:5173" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("rejects invalid JSON and path traversal", async () => {
    const invalid = await fetch(`${baseUrl}/api/workspace/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(invalid.status).toBe(400);

    const traversal = await fetch(`${baseUrl}/api/workspace/read-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: process.cwd(), path: "../package.json" }),
    });
    expect(traversal.status).toBe(400);
  });

  it("rejects an empty build graph", async () => {
    const response = await fetch(`${baseUrl}/api/ai/build-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagram: { nodes: [], edges: [] } }),
    });
    const body = await response.json() as { ok: boolean; error: string };
    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no buildable nodes|exactly one|empty/i);
  });

  it("accepts a structurally complete graph and returns deterministic order", async () => {
    const nodes = [
      { id: "state", shape: "state" },
      { id: "db", shape: "database" },
      { id: "service", shape: "service" },
      { id: "api", shape: "api" },
      { id: "process", shape: "process" },
      { id: "input", shape: "input" },
      { id: "screen", shape: "screen" },
      { id: "entry", shape: "startEnd" },
    ];
    const response = await fetch(`${baseUrl}/api/ai/build-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagram: { nodes, edges: [] } }),
    });
    const body = await response.json() as { ok: boolean; order: string[] };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.order).toEqual(nodes.map((node) => node.id));
  });

  it("fails runtime verification when required scripts are missing", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gcg-runtime-negative-"));
    try {
      await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({
        name: "placeholder-app",
        private: true,
        scripts: { dev: "node server.mjs" },
      }));
      await fs.writeFile(path.join(workspace, "server.mjs"), "process.exit(0);\n");
      const response = await fetch(`${baseUrl}/api/workspace/runtime-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: workspace,
          harness: { presetId: "agent-tool", stack: { runtime: "Node.js", frontend: "React + Vite", packageManager: "npm" }, quality: {} },
        }),
      });
      const body = await response.json() as { ok: boolean; result: { passed: boolean; failures: string[] } };
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.result.passed).toBe(false);
      expect(body.result.failures.join("\n")).toMatch(/Required test script is missing/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("passes a real Node app with required scripts and mountable HTML", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gcg-runtime-positive-"));
    try {
      await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({
        name: "verified-app",
        private: true,
        scripts: {
          test: "node -e \"process.exit(0)\"",
          build: "node -e \"process.exit(0)\"",
          dev: "node server.mjs",
        },
      }));
      await fs.writeFile(path.join(workspace, "server.mjs"), `
import http from "node:http";
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(args[portIndex + 1]);
const html = '<!doctype html><html><body><div id="root">Verified application readiness ${"ok".repeat(50)}</div></body></html>';
http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}).listen(port, "127.0.0.1");
`);
      const response = await fetch(`${baseUrl}/api/workspace/runtime-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: workspace,
          harness: { presetId: "agent-tool", stack: { runtime: "Node.js", frontend: "React + Vite", packageManager: "npm" }, quality: {} },
        }),
      });
      const body = await response.json() as { ok: boolean; result: { passed: boolean; checks: string[]; evidenceUrl?: string; previewRunning?: boolean } };
      expect(body.ok).toBe(true);
      expect(body.result.passed).toBe(true);
      expect(body.result.checks).toContain("test passed");
      expect(body.result.checks).toContain("build passed");
      expect(body.result.evidenceUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(body.result.previewRunning).toBe(false);
      await expect(fetch(body.result.evidenceUrl!)).rejects.toThrow();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("allows prose examples but rejects executable outside-path dependencies", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gcg-isolation-"));
    const external = path.join(os.tmpdir(), `gcg-external-${Date.now()}.json`);
    try {
      await fs.mkdir(path.join(workspace, "src"));
      await fs.writeFile(path.join(workspace, "README.md"), "Example: /Users/you/Documents/app\n");
      await fs.writeFile(external, "{}\n");
      let response = await fetch(`${baseUrl}/api/workspace/validate-isolation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspace }),
      });
      expect(response.status).toBe(200);

      await fs.writeFile(path.join(workspace, "src", "bad.ts"), `readFile('${external}')\n`);
      response = await fetch(`${baseUrl}/api/workspace/validate-isolation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspace }),
      });
      const body = await response.json() as { passed: boolean; issues: Array<{ type: string }> };
      expect(response.status).toBe(400);
      expect(body.passed).toBe(false);
      expect(body.issues.some((issue) => issue.type === "external-path-reference")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(external, { force: true });
    }
  });
});
