import { describe, expect, it } from "vitest";
// @ts-expect-error Runtime policy is intentionally shared with the plain-JS server.
import {
  isOriginAllowed,
  parseAllowedOrigins,
  requiredScriptNames,
  resolveRuntimeSupport,
  safeRelativeArtifactPaths,
  shouldInspectAbsolutePathReference,
  validateDiagramStructure,
  validateReadinessPayload,
} from "../server/policy.mjs";

describe("server origin policy", () => {
  const allowedOrigins = parseAllowedOrigins("http://127.0.0.1:6000");

  it("allows same-origin, configured dev origins, and local CLI requests", () => {
    expect(isOriginAllowed({ origin: "", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(true);
    expect(isOriginAllowed({ origin: "http://localhost:5173", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(true);
    expect(isOriginAllowed({ origin: "http://127.0.0.1:6000", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(true);
    expect(isOriginAllowed({ origin: "http://127.0.0.1:8791", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(true);
  });

  it("rejects unrelated and malformed origins", () => {
    expect(isOriginAllowed({ origin: "https://evil.example", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(false);
    expect(isOriginAllowed({ origin: "http://evil.example:8791", requestHost: "evil.example:8791", allowedOrigins })).toBe(false);
    expect(isOriginAllowed({ origin: "not a url", requestHost: "127.0.0.1:8791", allowedOrigins })).toBe(false);
  });
});

describe("runtime support and required gates", () => {
  it("supports only fully wired Node presets", () => {
    expect(resolveRuntimeSupport({ harness: { presetId: "saas-web", stack: { runtime: "Node.js", packageManager: "pnpm" } }, pkg: {} }).supported).toBe(true);
    expect(resolveRuntimeSupport({ harness: { presetId: "agent-tool", stack: { runtime: "Node.js", packageManager: "npm" } }, pkg: {} }).supported).toBe(true);
    expect(resolveRuntimeSupport({ harness: { presetId: "api-service", stack: { runtime: "Python", packageManager: "uv" } }, pkg: {} }).supported).toBe(false);
    expect(resolveRuntimeSupport({ harness: { presetId: "mobile-app", stack: { runtime: "Dart", packageManager: "flutter pub" } }, pkg: {} }).supported).toBe(false);
  });

  it("turns enabled quality policy into required scripts", () => {
    const required = requiredScriptNames({ harness: { quality: { lint: true, typecheck: true, e2eTests: true } }, hasFrontend: true });
    expect([...required].sort()).toEqual(["build", "dev", "e2e", "lint", "test", "typecheck"]);
  });
});

describe("runtime readiness", () => {
  const harness = { stack: { frontend: "React + Vite" } };

  it("accepts a mountable HTML app", () => {
    const body = `<!doctype html><html><body><div id="root">${"ready".repeat(20)}</div></body></html>`;
    expect(validateReadinessPayload({ status: 200, contentType: "text/html", body, harness }).passed).toBe(true);
  });

  it("rejects placeholder HTTP 200 responses", () => {
    expect(validateReadinessPayload({ status: 200, contentType: "text/plain", body: "placeholder", harness }).passed).toBe(false);
  });
});

describe("external path semantics", () => {
  it("ignores prose, fixtures, comments, and input placeholders", () => {
    expect(shouldInspectAbsolutePathReference({ relativePath: "README.md", line: "/Users/you/app", absolutePathExists: false })).toBe(false);
    expect(shouldInspectAbsolutePathReference({ relativePath: "tests/path.test.ts", line: "const root = '/Users/me/proj'", absolutePathExists: false })).toBe(false);
    expect(shouldInspectAbsolutePathReference({ relativePath: "src/App.tsx", line: "placeholder=\"/Users/you/app\"", absolutePathExists: false })).toBe(false);
    expect(shouldInspectAbsolutePathReference({ relativePath: "src/app.ts", line: "// readFile('/Users/me/app')", absolutePathExists: true })).toBe(false);
  });

  it("flags executable filesystem dependencies", () => {
    expect(shouldInspectAbsolutePathReference({ relativePath: "src/app.ts", line: "readFile('/Users/me/app/config.json')", absolutePathExists: false })).toBe(true);
    expect(shouldInspectAbsolutePathReference({ relativePath: "src/app.ts", line: "const p = '/Users/real/sibling'", absolutePathExists: true })).toBe(true);
  });
});

describe("diagram and prior-artifact validation", () => {
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

  it("rejects structural ambiguity and cycles", () => {
    const result = validateDiagramStructure({
      diagram: { nodes: [...nodes, { id: "entry", shape: "mystery" }], edges: [{ source: "missing", target: "entry" }] },
      coverage: { ok: false, missingLayers: ["L2 Database"] },
      orderResult: { order: [], cycles: true },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Duplicate|Unsupported|Dangling|exactly one|Missing|required|cycle|empty/i);
  });

  it("drops unknown, absolute, and escaping client-provided artifact paths", () => {
    const safe = safeRelativeArtifactPaths({
      rootPath: "/workspace",
      diagram: { nodes: [{ id: "state", title: "State", shape: "state" }] },
      previouslyBuilt: [
        { id: "state", title: "Injected", shape: "screen", files: ["src/state.ts", "../outside", "/tmp/outside"] },
        { id: "unknown", files: ["src/unknown.ts"] },
      ],
    });
    expect(safe).toEqual([{ id: "state", title: "State", shape: "state", files: ["src/state.ts"] }]);
  });
});
