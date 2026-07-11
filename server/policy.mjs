import path from "node:path";

export const SUPPORTED_PRESET_IDS = new Set(["saas-web", "agent-tool"]);

export const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8791",
  "http://localhost:8791",
]);

export const parseAllowedOrigins = (raw = "") => new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(raw).split(",").map((value) => value.trim()).filter(Boolean),
]);

export const isOriginAllowed = ({ origin, requestHost, allowedOrigins = DEFAULT_ALLOWED_ORIGINS }) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${requestHost}`);
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
    return loopbackHosts.has(originUrl.hostname)
      && loopbackHosts.has(requestUrl.hostname)
      && originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
};

export const resolveRuntimeSupport = ({ harness, pkg }) => {
  const presetId = String(harness?.presetId || "");
  if (presetId && !SUPPORTED_PRESET_IDS.has(presetId)) {
    return {
      supported: false,
      profileId: "unsupported",
      reason: `Preset ${presetId} has no complete install/test/build/runtime adapter.`,
    };
  }

  const packageManager = String(pkg?.packageManager || harness?.stack?.packageManager || "npm").split("@")[0].toLowerCase();
  const runtimeText = [harness?.stack?.runtime, harness?.stack?.frontend, harness?.stack?.backend]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const nodePackageManagers = new Set(["npm", "pnpm", "yarn", "bun"]);
  const looksNode = !runtimeText || /node|javascript|typescript|react|next|vite|express/.test(runtimeText);
  if (!nodePackageManagers.has(packageManager) || !looksNode) {
    return {
      supported: false,
      profileId: "unsupported",
      reason: `Runtime ${runtimeText || "unknown"} with package manager ${packageManager || "unknown"} is not supported.`,
    };
  }

  return { supported: true, profileId: "node-web", reason: "" };
};

export const requiredScriptNames = ({ harness, hasFrontend = true }) => {
  const quality = harness?.quality || {};
  const required = new Set(["test"]);
  if (quality.lint === true) required.add("lint");
  if (quality.typecheck === true) required.add("typecheck");
  if (quality.e2eTests === true) required.add("e2e");
  if (hasFrontend) required.add("build");
  required.add("dev");
  return required;
};

export const validateReadinessPayload = ({ status, contentType, body, harness }) => {
  if (status < 200 || status >= 300) return { passed: false, reason: `HTTP ${status}` };
  const text = String(body || "").trim();
  if (text.length < 80) return { passed: false, reason: "response body is too small to prove an application booted" };

  const frontend = String(harness?.stack?.frontend || "").toLowerCase();
  const expectsHtml = !frontend || /react|vite|next|web|client/.test(frontend);
  if (expectsHtml) {
    const isHtml = /text\/html/i.test(String(contentType || "")) && /<!doctype html|<html[\s>]/i.test(text);
    const hasMount = /<body[\s>]|id=["'](?:root|__next)["']/i.test(text);
    if (!isHtml || !hasMount) {
      return { passed: false, reason: "frontend readiness response is not a mountable HTML document" };
    }
  }
  return { passed: true, reason: "" };
};

const CODE_REFERENCE_PATTERN = /\b(import|require|readFile|writeFile|realpath|symlink|spawn|execFile|workingDirectory|cwd|rootPath)\b/;

export const shouldInspectAbsolutePathReference = ({ relativePath, line, absolutePathExists }) => {
  const normalized = String(relativePath || "").replaceAll("\\", "/").toLowerCase();
  if (normalized === "readme.md" || normalized.endsWith(".md") || normalized.endsWith(".txt")) return false;
  if (normalized.startsWith("docs/") || normalized.startsWith("tests/") || normalized.includes("/__tests__/")) return false;
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || /placeholder\s*=/.test(trimmed)) return false;
  return absolutePathExists || CODE_REFERENCE_PATTERN.test(trimmed);
};

export const validateDiagramStructure = ({ diagram, coverage, orderResult }) => {
  const errors = [];
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram?.edges) ? diagram.edges : [];
  const knownShapes = new Set(["startEnd", "screen", "process", "input", "database", "api", "service", "state", "note"]);
  const ids = new Set();
  for (const node of nodes) {
    if (!node?.id || ids.has(node.id)) errors.push(`Duplicate or missing node id: ${node?.id || "(missing)"}`);
    ids.add(node?.id);
    if (!knownShapes.has(node?.shape)) errors.push(`Unsupported node shape: ${node?.shape || "(missing)"}`);
  }
  for (const edge of edges) {
    if (!ids.has(edge?.source) || !ids.has(edge?.target)) errors.push(`Dangling edge: ${edge?.source || "?"} -> ${edge?.target || "?"}`);
  }
  const buildable = nodes.filter((node) => node?.shape !== "note");
  if (buildable.length === 0) errors.push("Diagram has no buildable nodes.");
  const entryCount = buildable.filter((node) => node.shape === "startEnd").length;
  if (entryCount !== 1) errors.push(`Diagram must contain exactly one startEnd node; found ${entryCount}.`);
  if (coverage && !coverage.ok) errors.push(...coverage.missingLayers.map((item) => `Missing required layer: ${item}`));
  if (orderResult?.cycles) errors.push("Diagram contains a blocking dependency cycle.");
  if (orderResult && orderResult.order.length === 0) errors.push("Derived build order is empty.");
  return { ok: errors.length === 0, errors };
};

export const safeRelativeArtifactPaths = ({ rootPath, diagram, previouslyBuilt }) => {
  const nodes = new Map((diagram?.nodes || []).map((node) => [node.id, node]));
  const safe = [];
  for (const prior of Array.isArray(previouslyBuilt) ? previouslyBuilt.slice(0, 100) : []) {
    const node = nodes.get(prior?.id);
    if (!node) continue;
    const files = (Array.isArray(prior.files) ? prior.files : []).slice(0, 100).filter((file) => {
      if (typeof file !== "string" || path.isAbsolute(file)) return false;
      const resolved = path.resolve(rootPath, file);
      const relative = path.relative(path.resolve(rootPath), resolved);
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    safe.push({ id: node.id, title: node.title, shape: node.shape, files });
  }
  return safe;
};
