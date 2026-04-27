import cors from "cors";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";

const app = express();
// Port 8791 instead of the common 8787 to avoid collision with sibling dev
// servers (e.g. threads-oauth) that also default to 8787. Override with
// GRAPHCODING_PORT if 8791 is taken on your machine.
const PORT = Number(process.env.GRAPHCODING_PORT) || 8791;
const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "generated");
const TMP_DIR = path.join(ROOT, ".tmp");
const DIST_DIR = path.join(ROOT, "dist");
const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "txt",
  "css",
  "scss",
  "html",
  "xml",
  "yml",
  "yaml",
  "toml",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "dart",
  "sql",
  "sh",
  "env",
  "gitignore",
]);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "overview",
    "architecture",
    "executionPlan",
    "nodeSummaries",
    "filePlan",
    "testPlan",
    "buildPrompt",
    "iterationPrompt",
    "assumptions",
  ],
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    architecture: { type: "array", items: { type: "string" } },
    executionPlan: { type: "array", items: { type: "string" } },
    nodeSummaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "role", "summary", "implementationHint", "testHint"],
        properties: {
          nodeId: { type: "string" },
          role: { type: "string" },
          summary: { type: "string" },
          implementationHint: { type: "string" },
          testHint: { type: "string" },
        },
      },
    },
    filePlan: { type: "array", items: { type: "string" } },
    testPlan: { type: "array", items: { type: "string" } },
    buildPrompt: { type: "string" },
    iterationPrompt: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
  },
};

const DIAGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "nodes", "edges"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    nodes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "shape", "title", "actor", "intent", "behavior", "inputs", "outputs", "notes", "testHint", "status"],
        properties: {
          key: { type: "string" },
          shape: {
            type: "string",
            // 9-shape vocabulary. Reduced from 16 — the merged-away shapes
            // (queue/auth/external/event/decision/document/group) used to
            // each carry an architectural meaning that is now expressed via
            // a parent shape + edge metadata or behavior text. The server
            // also accepts legacy values via migrateLegacyShape() before
            // schema validation, so older saved diagrams keep working.
            enum: ["startEnd", "screen", "process", "input", "database", "api", "service", "state", "note"],
          },
          title: { type: "string" },
          actor: { type: "string" },
          intent: { type: "string" },
          behavior: { type: "string" },
          inputs: { type: "string" },
          outputs: { type: "string" },
          notes: { type: "string" },
          testHint: { type: "string" },
          status: {
            type: "string",
            enum: ["planned", "active", "blocked", "done"],
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceKey", "targetKey", "relation", "notes", "lineStyle", "animated"],
        properties: {
          sourceKey: { type: "string" },
          targetKey: { type: "string" },
          relation: { type: "string" },
          notes: { type: "string" },
          lineStyle: {
            type: "string",
            enum: ["smoothstep", "straight", "step"],
          },
          animated: { type: "boolean" },
        },
      },
    },
  },
};

const ensureRuntimeDirs = async () => {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });
};

const isTextLikePath = (filePath) => {
  const extension = filePath.includes(".") ? filePath.split(".").pop()?.toLowerCase() ?? "" : "";
  return TEXT_EXTENSIONS.has(extension);
};

const guessMimeType = (filePath) => {
  const extension = filePath.includes(".") ? filePath.split(".").pop()?.toLowerCase() ?? "" : "";

  switch (extension) {
    case "ts":
    case "tsx":
      return "application/typescript";
    case "js":
    case "jsx":
      return "application/javascript";
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "css":
      return "text/css";
    case "html":
      return "text/html";
    case "yml":
    case "yaml":
      return "application/yaml";
    case "svg":
      return "image/svg+xml";
    case "txt":
    case "sh":
    case "env":
    case "gitignore":
      return "text/plain";
    default:
      return isTextLikePath(filePath) ? "text/plain" : "application/octet-stream";
  }
};

const ensureWithinRoot = (rootPath, relativePath) => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(rootPath, relativePath);
  const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;

  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }

  return resolvedFile;
};

const readWorkspaceListing = async (rootPath) => {
  const files = [];

  const visit = async (currentDirectory, prefix = []) => {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = [...prefix, entry.name].join("/");

      if (entry.isDirectory()) {
        await visit(absolutePath, [...prefix, entry.name]);
        continue;
      }

      const stat = await fs.stat(absolutePath);
      files.push({
        path: relativePath,
        size: stat.size,
        type: guessMimeType(relativePath),
      });
    }
  };

  await visit(rootPath);

  return {
    rootPath,
    rootName: path.basename(rootPath),
    files,
  };
};

const chooseFolderViaDialog = () => {
  if (process.platform === "darwin") {
    const script = 'POSIX path of (choose folder with prompt "Open Folder")';
    const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
    if (result.status !== 0) {
      const detail = `${result.stderr || ""}${result.stdout || ""}`.trim() || "Folder selection was cancelled.";
      throw new Error(detail);
    }

    return result.stdout.trim().replace(/\/$/, "");
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "Open Folder"',
      "if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }",
      "Write-Output $dialog.SelectedPath",
    ].join("; ");
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    if (result.status !== 0) {
      const detail = `${result.stderr || ""}${result.stdout || ""}`.trim() || "Folder selection was cancelled.";
      throw new Error(detail);
    }

    return result.stdout.trim();
  }

  const result = spawnSync("zenity", ["--file-selection", "--directory", "--title=Open Folder"], { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim() || "Folder selection was cancelled.";
    throw new Error(detail);
  }

  return result.stdout.trim();
};

// spawnSync("codex login status") takes ~50-200ms; cache for 30s since auth
// state rarely changes mid-session. Health route can bypass with {fresh:true}.
const CODEX_STATUS_TTL_MS = 30_000;
let codexStatusCache = { value: null, expiresAt: 0 };

const codexStatus = (opts) => {
  const fresh = !!opts?.fresh;
  const now = Date.now();
  if (!fresh && codexStatusCache.value && now < codexStatusCache.expiresAt) {
    return codexStatusCache.value;
  }
  const check = spawnSync("codex", ["login", "status"], {
    encoding: "utf8",
  });

  let result;
  if (check.error) {
    result = {
      codexInstalled: false,
      codexAuthenticated: false,
      detail: check.error.message,
    };
  } else {
    const detail = `${check.stdout}${check.stderr}`.trim();
    result = {
      codexInstalled: true,
      codexAuthenticated: check.status === 0,
      detail: detail || "Unknown",
    };
  }
  codexStatusCache = { value: result, expiresAt: now + CODEX_STATUS_TTL_MS };
  return result;
};

const normalizeScope = (diagram, requestedMode) => {
  if (requestedMode === "selection" && Array.isArray(diagram?.scope?.nodeIds) && diagram.scope.nodeIds.length > 0) {
    return {
      mode: "selection",
      nodeIds: diagram.scope.nodeIds,
    };
  }

  return {
    mode: "full",
    nodeIds: [],
  };
};

const compactText = (value = "") => value.replace(/\s+/g, " ").trim();
const isKoreanText = (value = "") => /[가-힣]/.test(value);
const containsAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword));

// Mirror of LEGACY_SHAPE_MAP in src/lib/diagram.ts. Used when an incoming
// diagram (from a saved workspace, an old fallback, or rarely from a stale
// codex response) still uses the pre-collapse 16-shape vocabulary. Walks
// every node and rewrites the `shape` field in-place. Edges are unaffected
// — they don't carry a shape.
const LEGACY_SHAPE_MAP = {
  queue: "service",
  auth: "service",
  external: "service",
  event: "api",
  decision: "process",
  document: "process",
  group: "note",
};

const migrateLegacyShape = (shape) => LEGACY_SHAPE_MAP[shape] ?? shape;

const migrateDiagramShapes = (diagram) => {
  if (!diagram || !Array.isArray(diagram.nodes)) return diagram;
  return {
    ...diagram,
    nodes: diagram.nodes.map((node) =>
      node && LEGACY_SHAPE_MAP[node.shape]
        ? { ...node, shape: LEGACY_SHAPE_MAP[node.shape] }
        : node,
    ),
  };
};

const detectExchangeName = (brief, korean) => {
  if (containsAny(brief, ["빗썸", "bithumb"])) {
    return korean ? "빗썸" : "Bithumb";
  }

  if (containsAny(brief, ["업비트", "upbit"])) {
    return korean ? "업비트" : "Upbit";
  }

  if (containsAny(brief, ["바이낸스", "binance"])) {
    return korean ? "바이낸스" : "Binance";
  }

  return korean ? "거래소" : "Exchange";
};

const scoreMatches = (text, keywords) => keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);

const isCryptoTrackerBrief = (brief) => {
  const marketScore = scoreMatches(brief, ["코인", "crypto", "coin", "btc", "eth", "비트코인", "ticker", "시세", "market", "가격", "price"]);
  const trackerScore = scoreMatches(brief, ["tracker", "트래커", "tracking", "watchlist", "차트", "chart", "알림", "alert", "notification", "거래소", "exchange", "빗썸", "bithumb", "업비트", "upbit", "바이낸스", "binance"]);
  return marketScore >= 1 && trackerScore >= 1;
};

const isAgentDiagramBrief = (brief) => {
  const diagramScore = scoreMatches(brief, ["diagram", "도식", "도식화", "graph", "canvas", "node", "edge", "flow"]);
  const aiScore = scoreMatches(brief, ["gpt", "codex", "prompt", "프롬프트", "spec", "스펙", "generate", "생성", "agent", "ai"]);
  return diagramScore >= 1 && aiScore >= 1;
};

const summarizeBriefAsTitle = (brief, fallback) => {
  const trimmed = compactText(brief);
  if (!trimmed) {
    return fallback;
  }

  return trimmed.length > 32 ? `${trimmed.slice(0, 29)}...` : trimmed;
};

const FEATURE_KEYWORDS = {
  auth: ["auth", "login", "oauth", "signin", "sign in", "로그인", "인증", "권한", "pin", "비밀번호", "프로필"],
  restore: ["restore", "resume", "session", "last state", "remember", "복원", "세션", "이전 상태", "마지막 상태"],
  notification: ["alert", "notification", "notify", "알림", "푸시"],
  export: ["export", "csv", "json file", "download", "내보내기", "다운로드", "파일 저장"],
};

const hasExplicitFeature = (brief, keywords) => containsAny(brief, keywords);

const getNodeText = (node) =>
  compactText([node.title, node.intent, node.behavior, node.inputs, node.outputs, node.notes, node.testHint].join(" "));

const applyReplacements = (value, replacements) =>
  replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);

const sanitizeLaunchNode = (node, brief, korean) => {
  const lowerBrief = brief.toLowerCase();
  const exchangeName = detectExchangeName(lowerBrief, korean);

  if (isCryptoTrackerBrief(lowerBrief)) {
    return {
      ...node,
      title: korean ? "앱 실행" : "Launch Tracker",
      intent: korean ? `${exchangeName} 코인 가격 추적을 시작한다` : `Start tracking ${exchangeName} coin prices`,
      behavior: korean ? "데스크톱 앱을 열고 실시간 시세 대시보드를 표시한다" : "Open the desktop app and show the live price dashboard",
      inputs: korean ? "앱 실행 이벤트" : "app launch event",
      outputs: korean ? "초기 대시보드 표시 요청" : "initial dashboard render request",
      testHint: korean ? "앱 실행 후 기본 대시보드가 정상적으로 열리는지 확인한다" : "Verify the dashboard opens after launch",
    };
  }

  return {
    ...node,
    title: korean ? "앱 실행" : "Launch App",
    intent: korean ? "주요 사용자 흐름을 시작한다" : "Start the main user flow",
    behavior: korean ? "앱을 열고 기본 화면으로 진입한다" : "Open the app and enter the main screen",
    inputs: korean ? "앱 실행 이벤트" : "app launch event",
    outputs: korean ? "초기 화면 표시 요청" : "initial screen render request",
    testHint: korean ? "앱 실행 후 첫 화면이 정상적으로 열리는지 확인한다" : "Verify the first screen opens after launch",
  };
};

const scrubRestoreText = (value, korean) => {
  if (!value) {
    return value;
  }

  if (korean) {
    return compactText(
      applyReplacements(value, [
        [/앱 실행 및 세션 복원/g, "앱 실행"],
        [/세션 복원/g, ""],
        [/이전 세션 메타데이터/g, "앱 실행 이벤트"],
        [/마지막 사용 상태를 이어서 본다/g, "앱을 열고 주요 화면을 본다"],
        [/복원 가능한 로컬 상태/g, "로컬 상태"],
        [/마지막 관심 코인과 캐시를 로드한다/g, "저장된 설정과 현재 상태를 반영한다"],
      ]),
    );
  }

  return compactText(
    applyReplacements(value, [
      [/session restore/gi, ""],
      [/previous session metadata/gi, "app launch event"],
      [/restorable local state/gi, "local state"],
      [/last state/gi, "current state"],
    ]),
  );
};

const scrubExportText = (value, korean) => {
  if (!value) {
    return value;
  }

  if (korean) {
    return compactText(
      applyReplacements(value, [
        [/ 및 내보내기 결과/g, ""],
        [/내보내기 결과/g, ""],
        [/내보내기 실행/g, ""],
        [/내보내기 요청,?\s*/g, ""],
        [/파일 열기 요청,?\s*/g, ""],
      ]),
    );
  }

  return compactText(
    applyReplacements(value, [
      [/ and export results/gi, ""],
      [/export results/gi, ""],
      [/export request[s]?/gi, ""],
      [/open file request[s]?/gi, ""],
    ]),
  );
};

const stripAlertWordsFromSettingsNode = (node, korean) => {
  if (!containsAny(getNodeText(node).toLowerCase(), ["알림", "alert", "notification"])) {
    return node;
  }

  if (korean) {
    return {
      ...node,
      title: applyReplacements(node.title, [[/ 및 알림/g, ""], [/알림 설정/g, "관심 코인 설정"]]),
      intent: applyReplacements(node.intent, [[/과 가격 조건을 직접 관리한다/g, "을 직접 관리한다"], [/알림 /g, ""]]),
      behavior: compactText(
        applyReplacements(node.behavior, [
          [/목표가 또는 변동률 조건 설정,?\s*/g, ""],
          [/알림 /g, ""],
        ]),
      ),
      outputs: compactText(applyReplacements(node.outputs, [[/내보내기 요청,?\s*/g, ""], [/알림 /g, ""]])),
      notes: compactText(`${node.notes} 추천 기능으로 가격 알림을 추가할 수 있다.`),
    };
  }

  return node;
};

// "Dedicated X node" = a node whose ENTIRE purpose is feature X. Used to
// auto-prune feature nodes the user didn't ask for. After the 16→9 shape
// collapse the previous shape signals (auth/event/external/document) are
// gone, so we lean on title-keyword matching instead. Title-only is
// deliberately strict: a node that just *mentions* auth in its behavior
// won't get pruned — only one whose title clearly names it as the
// auth/notification/export module.
const titleMentions = (node, keywords) => {
  const haystack = (node.title || "").toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
};

const isDedicatedAuthNode = (node, lowerText) =>
  titleMentions(node, ["auth", "login", "signin", "sign in", "oauth", "로그인", "인증", "권한", "프로필 잠금"]) ||
  containsAny(lowerText, ["local profile", "pin", "profile unlock", "프로필 잠금", "잠금 해제"]);

const isDedicatedNotificationNode = (node, lowerText) =>
  titleMentions(node, ["notification", "alert", "알림", "푸시"]) &&
  containsAny(lowerText, ["notification", "alert", "desktop notification", "알림", "알림 센터"]);

const isDedicatedExportNode = (node, lowerText) =>
  titleMentions(node, ["export", "csv", "json file", "download", "내보내기", "다운로드"]) &&
  containsAny(lowerText, ["export", "csv", "json file", "file permission", "내보내기", "파일 권한"]);

const sanitizeDiagramBlueprint = (rawBlueprint, brief, harness) => {
  // Migrate legacy 16-shape vocabulary FIRST so all downstream sanitization
  // (auth-node detection, recommendation extraction, etc.) sees only the new
  // 9-shape vocabulary. Without this, a fallback that still uses
  // shape:"external"/"event" would slip through unchanged.
  const blueprint = migrateDiagramShapes(rawBlueprint);
  const korean = isKoreanText(brief);
  const normalizedBrief = compactText(brief).toLowerCase();
  const explicit = {
    auth: hasExplicitFeature(normalizedBrief, FEATURE_KEYWORDS.auth),
    restore: hasExplicitFeature(normalizedBrief, FEATURE_KEYWORDS.restore),
    notification: hasExplicitFeature(normalizedBrief, FEATURE_KEYWORDS.notification),
    export: hasExplicitFeature(normalizedBrief, FEATURE_KEYWORDS.export),
  };

  const incomingAnchors = new Map();
  for (const edge of blueprint.edges) {
    incomingAnchors.set(edge.targetKey, [...(incomingAnchors.get(edge.targetKey) ?? []), edge.sourceKey]);
  }

  const nodes = [];
  const edges = [];
  const removedKeys = new Set();
  const recommendationNodes = [];
  const recommendationEdges = [];
  const recommendationTitles = new Set();

  const addRecommendation = (title, behavior, anchorKey) => {
    if (recommendationTitles.has(title)) {
      return;
    }

    recommendationTitles.add(title);
    const key = `recommendation-${recommendationTitles.size}`;
    recommendationNodes.push({
      key,
      shape: "note",
      title,
      actor: korean ? "시스템" : "System",
      intent: korean ? "추천 기능으로 고려할 수 있다" : "Optional feature recommendation",
      behavior,
      inputs: korean ? "현재 brief와 생성 결과" : "current brief and generated diagram",
      outputs: korean ? "후속 보강 아이디어" : "follow-up enhancement idea",
      notes: harness?.projectName ? `${harness.projectName} recommendation` : "",
      testHint: korean ? "핵심 요구가 확정된 뒤 필요할 때만 추가한다" : "Add only if needed after the core flow is confirmed",
      status: "planned",
    });

    if (anchorKey) {
      recommendationEdges.push({
        sourceKey: anchorKey,
        targetKey: key,
        relation: korean ? "추천" : "recommendation",
        notes: korean ? "기본 요구에는 없지만 후속 보강 후보" : "Not explicit in the brief, but a possible follow-up",
        lineStyle: "smoothstep",
        animated: false,
      });
    }
  };

  for (const node of blueprint.nodes) {
    const lowerText = getNodeText(node).toLowerCase();
    const anchorKey = (incomingAnchors.get(node.key) ?? [blueprint.nodes[0]?.key]).find(Boolean);
    let next = { ...node };

    if (!explicit.restore && next.shape === "startEnd" && containsAny(lowerText, ["복원", "restore", "session", "마지막 상태"])) {
      next = sanitizeLaunchNode(next, brief, korean);
      addRecommendation(
        korean ? "추천: 마지막 상태 복원" : "Recommended: restore last state",
        korean
          ? "사용자가 같은 watchlist와 탭 구성을 자주 이어서 쓰면 마지막 상태 복원을 후속 기능으로 추가할 수 있다."
          : "If users often continue from the same watchlist and tab layout, add last-state restore as a later enhancement.",
        next.key,
      );
    }

    if (!explicit.auth && isDedicatedAuthNode(next, lowerText)) {
      removedKeys.add(next.key);
      addRecommendation(
        korean ? "추천: 로컬 프로필 보호" : "Recommended: local profile protection",
        korean
          ? "같은 기기에서 여러 사용자가 설정을 분리해야 하면 로컬 프로필 또는 PIN 보호를 추가할 수 있다. 현재 brief에는 없으므로 기본 흐름에서는 제외한다."
          : "If multiple users share the same device, consider local profiles or PIN protection. It is not explicit in the brief, so it is excluded from the core flow.",
        anchorKey,
      );
      continue;
    }

    if (!explicit.notification && isDedicatedNotificationNode(next, lowerText)) {
      removedKeys.add(next.key);
      addRecommendation(
        korean ? "추천: 가격 알림" : "Recommended: price alerts",
        korean
          ? "가격 조건 충족 시 OS 알림을 보내는 기능을 후속으로 넣을 수 있다. 현재 brief에는 명시되지 않았으므로 추천 기능으로만 남긴다."
          : "Desktop price alerts can be added later when threshold notifications matter. The current brief does not make them mandatory.",
        anchorKey,
      );
      continue;
    }

    if (!explicit.export && isDedicatedExportNode(next, lowerText)) {
      removedKeys.add(next.key);
      addRecommendation(
        korean ? "추천: CSV/JSON 내보내기" : "Recommended: CSV/JSON export",
        korean
          ? "시세 이력이나 watchlist를 외부 분석에 쓰려면 CSV/JSON 내보내기를 후속 기능으로 추가할 수 있다."
          : "If users need external analysis, add CSV/JSON export as a follow-up feature.",
        anchorKey,
      );
      continue;
    }

    if (!explicit.notification && next.shape === "screen") {
      const stripped = stripAlertWordsFromSettingsNode(next, korean);
      if (stripped !== next) {
        addRecommendation(
          korean ? "추천: 가격 알림 설정" : "Recommended: price alert settings",
          korean
            ? "watchlist 관리 이후 단계에서 목표가 또는 변동률 알림 설정을 추가할 수 있다."
            : "After the watchlist flow is stable, add threshold or movement-based alert settings.",
          next.key,
        );
        next = stripped;
      }
    }

    if (!explicit.restore) {
      next = {
        ...next,
        title: scrubRestoreText(next.title, korean),
        intent: scrubRestoreText(next.intent, korean),
        behavior: scrubRestoreText(next.behavior, korean),
        inputs: scrubRestoreText(next.inputs, korean),
        outputs: scrubRestoreText(next.outputs, korean),
        notes: scrubRestoreText(next.notes, korean),
        testHint: scrubRestoreText(next.testHint, korean),
      };
    }

    if (!explicit.export) {
      next = {
        ...next,
        title: scrubExportText(next.title, korean),
        intent: scrubExportText(next.intent, korean),
        behavior: scrubExportText(next.behavior, korean),
        inputs: scrubExportText(next.inputs, korean),
        outputs: scrubExportText(next.outputs, korean),
        notes: scrubExportText(next.notes, korean),
        testHint: scrubExportText(next.testHint, korean),
      };
    }

    nodes.push(next);
  }

  for (const edge of blueprint.edges) {
    if (removedKeys.has(edge.sourceKey) || removedKeys.has(edge.targetKey)) {
      continue;
    }
    edges.push(edge);
  }

  return {
    ...blueprint,
    nodes: [...nodes, ...recommendationNodes],
    edges: [...edges, ...recommendationEdges],
  };
};

// Mandatory architecture layers — every diagram must have at least one node
// of each shape below to be "buildable end-to-end". After the 16→9 shape
// collapse, all 8 buildable shapes are mandatory (only `note`, the lone
// annotation shape, is optional). Layer numbers match SHAPE_PRIORITY above.
// Keep this in sync with [MANDATORY] markers in buildPromptFromBrief.
const MANDATORY_LAYERS = [
  { shape: "state",    layer: "L1", label: "Types & schemas" },
  { shape: "database", layer: "L2", label: "Persistence" },
  { shape: "service",  layer: "L3", label: "Domain services (incl. auth/queue/external)" },
  { shape: "api",      layer: "L4", label: "Bridge / gateway (incl. event/webhook)" },
  { shape: "process",  layer: "L5", label: "Orchestration (incl. decision/output-generation)" },
  { shape: "input",    layer: "L6", label: "UI primitives" },
  { shape: "screen",   layer: "L7", label: "Screens" },
  { shape: "startEnd", layer: "L8", label: "Entry point" },
];

// Returns { ok, missingLayers, warnings, totalRuntimeNodes } describing whether
// the diagram has enough layer coverage to be buildable. Pure inspection — does
// NOT mutate the diagram. The client decides whether to block Build Loop or just
// warn the user. Cheap to run after every generation.
// Generic shippability heuristics — same for every appType. We do NOT branch
// on harness because the graph is the source of truth; platform-specific
// knowledge belongs in the prompt, not in this validator. These checks just
// look for *traces* that a thoughtful graph would always leave behind.
const SHIPPABILITY_KEYWORDS = {
  // Look for an explicit runtime entry/host artifact node. Typical titles:
  // "HTML 진입점", "main entry", "bin/cli.ts", "server bootstrap", "app shell".
  entry: [
    "html", "index.html", "entry", "진입", "bootstrap", "부트스트랩", "shell", "셸",
    "mount", "마운트", "bin", "main entry", "서버 시작", "server boot",
    "app boot", "앱 부트",
  ],
  // Look for a smoke / integration test node — something that boots the
  // assembled system and asserts a real round-trip.
  smoke: [
    "smoke", "스모크", "integration", "통합", "e2e", "end-to-end",
    "boot test", "부팅 테스트", "round-trip", "round trip", "라운드트립",
    "happy path", "해피 패스",
  ],
  // Look for a real platform adapter implementation (not just a contract).
  adapter: [
    "adapter", "어댑터", "implementation", "구현체", "tauri", "electron",
    "ipc bridge", "ipc 다리", "localstorage", "indexeddb", "sqlite",
    "fetch client", "http client",
  ],
};

// Match against title only — behavior/intent text is too noisy (e.g. a process
// that "mounts the app" mentions "mount" but is not itself an entry artifact).
// A proper entry/smoke/adapter node always names its role in the title.
const matchesKeywords = (node, keywords) => {
  const haystack = (node.title || "").toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
};

const validateDiagramCoverage = (diagram) => {
  // Only `note` is skipped now — the old `group` shape was legacy-migrated
  // into `note` before reaching this code.
  const skip = new Set(["note"]);
  const runtime = (diagram?.nodes || []).filter((n) => !skip.has(n.shape));
  const shapesPresent = new Set(runtime.map((n) => n.shape));

  const missingLayers = MANDATORY_LAYERS.filter((m) => !shapesPresent.has(m.shape));
  const warnings = [];

  if (runtime.length < 8) {
    warnings.push(`Only ${runtime.length} runtime nodes — typical apps need 14-22. Diagram may be too thin to ship.`);
  }
  const startEndCount = runtime.filter((n) => n.shape === "startEnd").length;
  if (startEndCount > 1) {
    warnings.push(`${startEndCount} entry-point nodes detected — should be exactly 1.`);
  }

  // Shippability heuristics — only warnings, never block. The build loop
  // still runs even if these miss, but the user is told what's likely absent.
  const hasEntryArtifact = runtime.some((n) => matchesKeywords(n, SHIPPABILITY_KEYWORDS.entry));
  if (!hasEntryArtifact) {
    warnings.push(
      "No node looks like a runtime entry artifact (HTML / bin script / server bootstrap). " +
      "Without one, the built modules will not actually boot. Add an entry node before Build Loop.",
    );
  }
  // Smoke tests live under `process` after the shape collapse — the old
  // `decision` shape is gone (decision = process with multiple outgoing
  // edges), so we don't have to look anywhere else.
  const hasSmokeTest = runtime.some(
    (n) => n.shape === "process" && matchesKeywords(n, SHIPPABILITY_KEYWORDS.smoke),
  );
  if (!hasSmokeTest) {
    warnings.push(
      "No smoke / integration test node detected. Unit tests verify each module in isolation but do " +
      "not prove the assembled app boots. Add a smoke-test process node that mounts the app and " +
      "exercises one real round-trip.",
    );
  }
  // Adapters now live under `service` (was the old `external`) or `api`
  // (HTTP/IPC bridges). After the shape collapse, "external SDK wrapper"
  // is just a service with adapter-themed title text.
  const hasAdapterImpl = runtime.some(
    (n) => (n.shape === "service" || n.shape === "api") && matchesKeywords(n, SHIPPABILITY_KEYWORDS.adapter),
  );
  // Only flag adapter-impl absence if there's a database/contract node — i.e.
  // when persistence exists in the graph, *something* must implement it.
  const hasPersistenceContract = runtime.some((n) => n.shape === "database");
  if (hasPersistenceContract && !hasAdapterImpl) {
    warnings.push(
      "Persistence contract exists but no platform adapter implementation node was found. " +
      "The contract alone stores nothing — add an adapter node (browser storage, Tauri IPC, etc).",
    );
  }

  return {
    ok: missingLayers.length === 0,
    missingLayers: missingLayers.map((m) => `${m.layer} ${m.label} (shape: ${m.shape})`),
    warnings,
    totalRuntimeNodes: runtime.length,
  };
};

const buildCryptoTrackerFallback = (brief, harness, errorMessage = "") => {
  const korean = isKoreanText(brief);
  const normalized = brief.toLowerCase();
  const exchangeName = detectExchangeName(normalized, korean);
  const trackerTitle = korean ? `${exchangeName} 코인 가격 트래커` : `${exchangeName} Coin Price Tracker`;
  const cacheNotes = harness?.stack?.database || (korean ? "SQLite 또는 로컬 파일" : "SQLite or local files");
  const frontendNotes = harness?.stack?.frontend || (korean ? "데스크톱 대시보드" : "Desktop dashboard");
  const includeAlerts = containsAny(normalized, ["알림", "alert", "notification"]);
  const includeCharts = containsAny(normalized, ["차트", "chart", "캔들", "candle", "히스토리", "history"]);

  const nodes = [
    {
      key: "launch",
      shape: "startEnd",
      title: korean ? "앱 실행" : "Launch Tracker",
      actor: korean ? "사용자" : "User",
      intent: korean ? "관심 코인의 시세를 추적한다" : "Start the tracker and monitor selected coins",
      behavior: korean ? "앱을 열고 관심 코인과 새로고침 흐름을 시작한다" : "Open the tracker and start the main monitoring flow",
      inputs: korean ? "실행, 코인 선택, 새로고침" : "Launch, symbol selection, manual refresh",
      outputs: korean ? "대시보드 표시 요청" : "Dashboard render request",
      notes: compactText(brief),
      testHint: korean ? "초기 실행 후 기본 화면과 마지막 watchlist가 보이는지 확인한다" : "Verify startup loads the last watchlist and shows the dashboard",
      status: "planned",
    },
    {
      key: "dashboard",
      shape: "screen",
      title: korean ? `${exchangeName} 가격 대시보드` : `${exchangeName} Price Dashboard`,
      actor: korean ? "사용자" : "User",
      intent: korean ? "현재가, 변동률, watchlist를 확인한다" : "Inspect live prices, change rate, and watchlist",
      behavior: korean
        ? "실시간 가격 카드, 관심 코인 목록, 수동 새로고침과 최근 변동을 보여준다"
        : "Render live price cards, watchlist items, refresh actions, and recent movement",
      inputs: korean ? "가격 상태, 사용자 watchlist, 수동 요청" : "Price state, watchlist, and manual commands",
      outputs: korean ? "수집 요청과 사용자 설정 변경" : "Polling triggers and watchlist updates",
      notes: frontendNotes,
      testHint: korean ? "가격 카드와 watchlist 변경이 즉시 반영되는지 확인한다" : "Check dashboard rendering and watchlist updates",
      status: "planned",
    },
    {
      key: "poller",
      shape: "process",
      title: korean ? "시세 수집 워커" : "Price Poller",
      actor: korean ? "시스템" : "System",
      intent: korean ? `${exchangeName} 시세를 주기적으로 가져온다` : `Fetch ${exchangeName} market prices on an interval`,
      behavior: korean
        ? "관심 코인 기준으로 주기 호출, 응답 정규화, 실패 시 재시도를 수행한다"
        : "Poll selected symbols, normalize payloads, and retry on transient failures",
      inputs: korean ? "watchlist, polling interval" : "watchlist and polling interval",
      outputs: korean ? "정규화된 가격 데이터" : "normalized price payloads",
      notes: errorMessage ? `Fallback generated because: ${errorMessage}` : "",
      testHint: korean ? "타이머, 재시도, 실패 복구를 모킹해 검증한다" : "Mock timers, retries, and recovery behavior",
      status: "planned",
    },
    {
      key: "exchange-api",
      // Service shape with explicit "external SDK" framing in the notes —
      // the old `external` shape is gone; we keep that semantic on the text.
      shape: "service",
      title: korean ? `${exchangeName} 시세 API 어댑터` : `${exchangeName} Market API Adapter`,
      actor: korean ? "외부 시스템" : "External Service",
      intent: korean ? "코인 가격과 거래 정보를 제공한다" : "Provide ticker and market data",
      behavior: korean ? "심볼별 현재가와 변동 데이터를 반환한다 (외부 SDK/HTTP 어댑터)" : "Return current price and movement data per symbol (external SDK/HTTP adapter)",
      inputs: korean ? "HTTP 요청" : "HTTP requests",
      outputs: korean ? "JSON 시세 응답" : "JSON market responses",
      notes: korean ? "거래소 rate limit과 장애를 고려해야 한다" : "Handle rate limits and external failures",
      testHint: korean ? "샘플 응답 스냅샷으로 파서를 검증한다" : "Validate parsing with sample responses",
      status: "planned",
    },
    {
      key: "cache",
      shape: "database",
      title: korean ? "가격 캐시와 watchlist 저장소" : "Price Cache and Watchlist Store",
      actor: korean ? "시스템" : "System",
      intent: korean ? "최근 가격과 사용자 설정을 유지한다" : "Persist recent prices and the user's watchlist",
      behavior: korean
        ? "마지막 시세, 관심 코인, 새로고침 주기와 사용자 설정을 저장한다"
        : "Store recent prices, watchlist entries, refresh interval, and local preferences",
      inputs: korean ? "정규화된 가격 데이터와 설정 변경" : "normalized prices and settings updates",
      outputs: korean ? "재시작 시 복원 가능한 로컬 상태" : "local state available on restart",
      notes: cacheNotes,
      testHint: korean ? "앱 재시작 후 마지막 상태가 복구되는지 확인한다" : "Verify persistence across restarts",
      status: "planned",
    },
  ];

  const edges = [
    { sourceKey: "launch", targetKey: "dashboard", relation: korean ? "대시보드 진입" : "opens dashboard", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "dashboard", targetKey: "poller", relation: korean ? "시세 조회 요청" : "starts polling", notes: "", lineStyle: "straight", animated: true },
    { sourceKey: "poller", targetKey: "exchange-api", relation: korean ? "시세 데이터 요청" : "requests ticker data", notes: "", lineStyle: "straight", animated: true },
    { sourceKey: "exchange-api", targetKey: "poller", relation: korean ? "시세 응답 반환" : "returns market payload", notes: "", lineStyle: "straight", animated: true },
    { sourceKey: "poller", targetKey: "cache", relation: korean ? "정규화 데이터 저장" : "stores normalized prices", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "cache", targetKey: "dashboard", relation: korean ? "저장 상태 공급" : "hydrates dashboard", notes: "", lineStyle: "smoothstep", animated: false },
  ];

  if (includeCharts) {
    nodes.push({
      key: "history-view",
      shape: "screen",
      title: korean ? "가격 히스토리 뷰" : "Price History View",
      actor: korean ? "사용자" : "User",
      intent: korean ? "최근 가격 흐름과 변동을 시각적으로 본다" : "Inspect recent price movement visually",
      behavior: korean ? "차트와 히스토리 요약을 보여준다" : "Render chart panels and history summaries",
      inputs: korean ? "캐시된 시세 히스토리" : "cached price history",
      outputs: korean ? "시각적 가격 분석" : "visual trend analysis",
      notes: frontendNotes,
      testHint: korean ? "차트 축과 데이터 포인트가 watchlist 선택에 맞게 바뀌는지 본다" : "Verify chart updates for the selected symbol",
      status: "planned",
    });
    edges.push({
      sourceKey: "cache",
      targetKey: "history-view",
      relation: korean ? "히스토리 데이터 제공" : "supplies history data",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    });
  }

  if (includeAlerts) {
    nodes.push({
      key: "alerts",
      // Was `event` shape — collapsed into `api` because pub/sub is just
      // an async-mode call. The "event" semantic now travels on outgoing
      // edges as edge.mode="event" once Stage 2 ships.
      shape: "api",
      title: korean ? "가격 알림 이벤트 발행기" : "Price Alert Event Bridge",
      actor: korean ? "시스템" : "System",
      intent: korean ? "사용자가 지정한 가격 조건을 감지한다" : "Detect user-defined price conditions",
      behavior: korean ? "조건 충족 시 알림 이벤트를 발행한다 (pub/sub 다리)" : "Emit alert events when thresholds are reached (pub/sub bridge)",
      inputs: korean ? "실시간 가격, 사용자 알림 규칙" : "live prices and alert rules",
      outputs: korean ? "알림 이벤트" : "notification events",
      notes: korean ? "가격 급등락 알림, 목표가 도달 알림" : "Threshold and rapid-change alerts",
      testHint: korean ? "상승/하락 조건별 이벤트 발생을 검증한다" : "Verify alert events for threshold conditions",
      status: "planned",
    });
    edges.push(
      {
        sourceKey: "poller",
        targetKey: "alerts",
        relation: korean ? "가격 변동 평가" : "evaluates price changes",
        notes: "",
        lineStyle: "straight",
        animated: true,
      },
      {
        sourceKey: "alerts",
        targetKey: "dashboard",
        relation: korean ? "알림 상태 표시" : "shows alert state",
        notes: "",
        lineStyle: "smoothstep",
        animated: false,
      },
    );
  }

  return {
    title: trackerTitle,
    summary: brief,
    nodes,
    edges,
  };
};

const buildAgentDiagramFallback = (brief, harness, errorMessage = "") => {
  const korean = isKoreanText(brief);

  return {
    title: korean ? "AI 도식화 기반 앱 생성 워크스페이스" : "AI Diagram-to-App Workspace",
    summary: brief,
    nodes: [
      {
        key: "brief",
        shape: "input",
        title: korean ? "아이디어 입력" : "Idea Brief",
        actor: korean ? "사용자" : "User",
        intent: korean ? "만들고 싶은 앱 요구를 거칠게 적는다" : "Describe the intended app in rough text",
        behavior: korean ? "도메인, 목표, 핵심 기능을 간단히 입력한다" : "Provide a rough product direction, domain, and target flow",
        inputs: korean ? "러프 텍스트" : "rough text",
        outputs: korean ? "구조화 대상 요구" : "raw requirement brief",
        notes: compactText(brief),
        testHint: korean ? "짧은 입력에서도 핵심 요구가 누락되지 않는지 본다" : "Verify short briefs still preserve the main idea",
        status: "planned",
      },
      {
        key: "canvas",
        shape: "screen",
        title: korean ? "도식화 캔버스" : "Diagram Canvas",
        actor: korean ? "사용자" : "User",
        intent: korean ? "노드와 방향선으로 시스템을 편집한다" : "Edit nodes and directed edges",
        behavior: korean ? "기본 diagram을 확인하고 직접 보정한다" : "Inspect and refine the generated diagram",
        inputs: korean ? "AI가 만든 기본 diagram, 수동 편집" : "AI-generated diagram and manual edits",
        outputs: korean ? "구현 가능한 도식화" : "implementation-oriented diagram",
        notes: harness?.stack?.frontend || "",
        testHint: korean ? "노드/선 편집과 선택 범위 지정이 유지되는지 확인한다" : "Verify node, edge, and selection edits persist",
        status: "planned",
      },
      {
        key: "planner",
        shape: "service",
        title: korean ? "GPT-5.5 diagram planner" : "GPT-5.5 Diagram Planner",
        actor: korean ? "AI" : "AI",
        intent: korean ? "러프 텍스트를 첫 기본 diagram으로 바꾼다" : "Turn the rough brief into the first diagram",
        behavior: korean ? "도메인, 화면, 서비스, 저장소, 외부 연동을 추론해 노드와 선을 만든다" : "Infer screens, services, persistence, and integrations",
        inputs: korean ? "brief, harness, 현재 diagram" : "brief, harness, and current diagram",
        outputs: korean ? "기본 diagram blueprint" : "diagram blueprint",
        notes: "gpt-5.5",
        testHint: korean ? "짧은 brief에도 도메인 고유 명사가 살아 있는지 본다" : "Verify domain-specific nouns survive short prompts",
        status: "planned",
      },
      {
        key: "spec",
        // Was `document` shape — generated artifacts are produced by
        // running code, so they belong under `process`.
        shape: "process",
        title: korean ? "구현 스펙과 프롬프트 생성" : "Spec and Build Prompt Generation",
        actor: korean ? "AI" : "AI",
        intent: korean ? "도식화를 코드 생성 가능한 명세로 만든다" : "Convert the diagram into an implementation spec",
        behavior: korean ? "전체 빌드 프롬프트와 선택 범위 프롬프트를 생성한다" : "Generate build prompts for full and partial scope",
        inputs: korean ? "완성된 diagram" : "finalized diagram",
        outputs: korean ? "스펙, build prompt, iteration prompt" : "spec, build prompt, iteration prompt",
        notes: errorMessage ? `Fallback generated because: ${errorMessage}` : "",
        testHint: korean ? "선택 범위와 전체 범위 프롬프트가 분리되는지 확인한다" : "Verify selection and full-scope prompts are distinct",
        status: "planned",
      },
      {
        key: "builder",
        shape: "process",
        title: korean ? "빌드와 테스트 루프" : "Build and Test Loop",
        actor: korean ? "시스템" : "System",
        intent: korean ? "생성된 프롬프트로 앱을 만들고 검증한다" : "Build and verify the app from the prompt",
        behavior: korean ? "코드 생성, 테스트 실행, 실패 수정 루프를 반복한다" : "Run code generation, tests, and fix iterations",
        inputs: korean ? "build prompt, harness 정책" : "build prompt and harness policy",
        outputs: korean ? "테스트 가능한 앱 결과물" : "testable app output",
        notes: harness?.stack?.backend || "",
        testHint: korean ? "테스트 실패 시 수정 루프가 이어지는지 본다" : "Verify failing tests feed the next fix iteration",
        status: "planned",
      },
    ],
    edges: [
      { sourceKey: "brief", targetKey: "planner", relation: korean ? "아이디어 전달" : "sends rough idea", notes: "", lineStyle: "smoothstep", animated: false },
      { sourceKey: "planner", targetKey: "canvas", relation: korean ? "기본 diagram 생성" : "creates base diagram", notes: "", lineStyle: "smoothstep", animated: false },
      { sourceKey: "canvas", targetKey: "spec", relation: korean ? "확정 diagram 전달" : "sends finalized diagram", notes: "", lineStyle: "smoothstep", animated: false },
      { sourceKey: "spec", targetKey: "builder", relation: korean ? "구현 프롬프트 전달" : "passes build prompt", notes: "", lineStyle: "straight", animated: true },
    ],
  };
};

const buildGenericFallback = (brief, harness, errorMessage = "") => {
  const korean = isKoreanText(brief);
  const briefTitle = summarizeBriefAsTitle(brief, korean ? "제품" : "Product");
  const frontendShape = harness?.stack?.frontend?.toLowerCase().includes("flutter") ? "screen" : "screen";
  const backendShape = harness?.stack?.backend?.toLowerCase().includes("fastapi") ? "api" : "service";
  // Old code used `document` as a fallback when the harness had no real
  // persistence — but `document` no longer exists as a shape. Use `database`
  // unconditionally; an in-memory store is still a database contract that
  // later nodes can mock or swap.
  const databaseShape = "database";
  const authNeeded = containsAny(brief.toLowerCase(), ["oauth", "auth", "login", "로그인", "인증", "권한"]);

  const nodes = [
    {
      key: "start",
      shape: "startEnd",
      title: korean ? "요구 출발점" : "Entry Point",
      actor: korean ? "사용자" : "User",
      intent: korean ? "만들고 싶은 제품 목표를 시작한다" : "Start the main product flow",
      behavior: compactText(brief),
      inputs: korean ? "러프 브리프" : "rough brief",
      outputs: korean ? "핵심 사용자 흐름" : "primary user flow",
      notes: "",
      testHint: korean ? "입력된 목표가 메인 플로우에 반영되는지 확인한다" : "Verify the brief maps to the main flow",
      status: "planned",
    },
    {
      key: "ui",
      shape: frontendShape,
      title: korean ? `${briefTitle} 핵심 화면` : `${briefTitle} Main Screen`,
      actor: korean ? "사용자" : "User",
      intent: korean ? "가장 중요한 상호작용을 처리한다" : "Handle the primary user interaction",
      behavior: korean
        ? "사용자가 목표를 수행하고 중간 결과를 확인하는 화면"
        : "Main interface where the user starts work and sees immediate feedback",
      inputs: korean ? "사용자 입력과 현재 상태" : "user input and current state",
      outputs: korean ? "도메인 요청" : "domain requests",
      notes: harness?.stack?.frontend || "",
      testHint: korean ? "대표 플로우가 한 번에 이어지는지 본다" : "Check that the main flow is uninterrupted",
      status: "planned",
    },
    {
      key: "core",
      shape: "process",
      title: korean ? `${briefTitle} 도메인 처리` : `${briefTitle} Domain Flow`,
      actor: korean ? "시스템" : "System",
      intent: korean ? "브리프의 핵심 규칙을 실제 동작으로 바꾼다" : "Execute the core business behavior implied by the brief",
      behavior: korean
        ? "검증, 분기, 데이터 조합, 상태 변화 등 핵심 로직을 수행한다"
        : "Run validation, branching, data shaping, and state updates",
      inputs: korean ? "사용자 요청" : "user requests",
      outputs: korean ? "처리 결과와 상태 변화" : "results and state transitions",
      notes: errorMessage ? `Fallback generated because: ${errorMessage}` : "",
      testHint: korean ? "정상/실패/경계 조건을 나눠 검증한다" : "Verify success, failure, and edge cases",
      status: "planned",
    },
    {
      key: "backend",
      shape: backendShape,
      title: korean ? `${briefTitle} 서비스 경계` : `${briefTitle} Service Boundary`,
      actor: korean ? "서버" : "Server",
      intent: korean ? "프론트와 핵심 로직 사이 계약을 제공한다" : "Provide the contract between UI and domain logic",
      behavior: korean ? "요청 수신, 호출 조율, 오류 반환" : "Receive requests, orchestrate calls, and return typed errors",
      inputs: korean ? "화면 요청" : "screen requests",
      outputs: korean ? "타입된 응답" : "typed responses",
      notes: harness?.stack?.backend || "",
      testHint: korean ? "계약, 상태 코드, 예외 응답을 확인한다" : "Validate contracts and error responses",
      status: "planned",
    },
    {
      key: "storage",
      shape: databaseShape,
      title: korean ? `${briefTitle} 저장 계층` : `${briefTitle} Storage Layer`,
      actor: korean ? "시스템" : "System",
      intent: korean ? "필요한 상태와 산출물을 보존한다" : "Persist required state and artifacts",
      behavior: korean ? "읽기/쓰기, 캐시, 복구용 데이터 보존" : "Handle reads, writes, cache, and restart recovery data",
      inputs: korean ? "도메인 데이터" : "domain data",
      outputs: korean ? "저장된 상태" : "stored state",
      notes: harness?.stack?.database || "",
      testHint: korean ? "저장 후 다시 읽었을 때 일관성이 유지되는지 본다" : "Verify round-trip persistence",
      status: "planned",
    },
  ];

  const edges = [
    { sourceKey: "start", targetKey: "ui", relation: korean ? "사용자 흐름 시작" : "starts user flow", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "ui", targetKey: "backend", relation: korean ? "주요 요청 전달" : "sends primary request", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "backend", targetKey: "core", relation: korean ? "핵심 처리 호출" : "calls domain flow", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "core", targetKey: "storage", relation: korean ? "상태 저장" : "persists state", notes: "", lineStyle: "smoothstep", animated: false },
    { sourceKey: "storage", targetKey: "ui", relation: korean ? "저장 상태 반영" : "hydrates screen state", notes: "", lineStyle: "smoothstep", animated: false },
  ];

  if (authNeeded) {
    nodes.push({
      key: "auth",
      // Was `auth` shape — collapsed into `service` since auth is a
      // domain-logic module, just with sensitive scope.
      shape: "service",
      title: korean ? "인증/권한 서비스" : "Auth Boundary Service",
      actor: korean ? "시스템" : "System",
      intent: korean ? "로그인과 권한을 확인한다" : "Validate login and permission state",
      behavior: korean ? "인증 상태를 만들고 요청 권한을 통제한다" : "Create auth state and gate protected requests",
      inputs: korean ? "로그인 요청, 토큰, 세션" : "login requests, tokens, sessions",
      outputs: korean ? "인증된 사용자 컨텍스트" : "authenticated user context",
      notes: harness?.stack?.auth || "",
      testHint: korean ? "성공/실패 로그인과 권한 예외를 검증한다" : "Verify success, failure, and permission edge cases",
      status: "planned",
    });
    edges.splice(1, 0, {
      sourceKey: "ui",
      targetKey: "auth",
      relation: korean ? "인증 확인" : "checks auth",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    });
    edges.splice(2, 0, {
      sourceKey: "auth",
      targetKey: "backend",
      relation: korean ? "인증 컨텍스트 전달" : "passes auth context",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    });
  }

  return {
    title: harness?.projectName || briefTitle,
    summary: brief,
    nodes,
    edges,
  };
};

const buildPromptFromBrief = (brief, diagram, harness, strategy) => `
You are a staff software architect. Your output is the **module graph** for a per-node
code generator: a downstream system will implement each node as one buildable module
(1-3 source files + tests) IN THE ORDER YOU IMPLY by the layers below. The nodes you
produce MUST collectively be sufficient to ship the whole system. If you skip a layer
(types, storage, error UI, etc.) the codegen will hallucinate it and break later nodes.

═══════════════════════════════════════════════════════════════════════════════
DEFINITION OF A NODE
═══════════════════════════════════════════════════════════════════════════════
Each node is ONE buildable module:
- 1-3 source files in src/<area>/ (no more)
- One focused test file in tests/<slug>/*.test.{ts,tsx}
- Implementable + tested in <5 min by a coding agent
- ONLY imports from earlier layers (lower L number); never re-defines types or
  utilities that another node already owns.

═══════════════════════════════════════════════════════════════════════════════
SHAPE VOCABULARY — EXACTLY 9 SHAPES, NO OTHERS ALLOWED
═══════════════════════════════════════════════════════════════════════════════
Older diagrams used 16 shapes. The system was simplified — there are now
EXACTLY 9 shapes you may use. If you produce any other shape value the
diagram will be rejected. Several previously-distinct shapes were collapsed:

   queue / auth / external      → use shape: service
   event / webhook              → use shape: api
   decision / document          → use shape: process
   group                        → use shape: note

The collapse was intentional: those distinctions were better expressed by
node behavior text or edge metadata, not by extra shapes. Do not try to
reintroduce them.

═══════════════════════════════════════════════════════════════════════════════
ARCHITECTURE LAYERS — MANDATORY COVERAGE (one node per layer minimum)
═══════════════════════════════════════════════════════════════════════════════
The 8 buildable shapes form 8 architectural layers, ALL mandatory. The 9th
shape (note) is annotation only and never built. Build order follows L1 → L8.

[L1  MANDATORY] Types & schemas              shape: state
   Pure interfaces, type aliases, zod/io-ts schemas, reactive stores.
   NO behavior — only data shape.
   Examples: "도메인 타입 정의", "Message/Conversation 스키마", "대화 스토어"

[L2  MANDATORY] Persistence                  shape: database
   How state survives a reload. Always include — even in-memory stores need an
   explicit contract so later nodes can mock/swap. Add a sibling adapter node
   (still shape: database, or shape: service for SDK-style wrappers) that
   actually implements the contract for the target runtime.
   Examples: "대화 영속 저장소 (localStorage)", "설정 보관소 (sqlite)"

[L3  MANDATORY] Domain services              shape: service
   Pure business logic. ALSO absorbs: auth/permissions, async queues, third-
   party SDK adapters. One node per logical capability. Should be unit-testable
   without DOM or network. Use the title to make the role obvious
   ("…인증 서비스", "…큐 워커", "OpenAI SDK 어댑터").
   Examples: "응답 생성 서비스", "메시지 정렬 유틸", "Stripe 결제 어댑터"

[L4  MANDATORY] Bridge / gateway             shape: api
   The boundary between domain and IO. Browser-only apps still need an api node
   wrapping fetch/localStorage/IndexedDB. ALSO absorbs: event/webhook
   publishers — title them as "…이벤트 발행기" or "…웹훅 다리". Async-mode
   edges between this and consumers express the pub/sub semantic.
   Examples: "Tauri IPC 브리지", "GPT 호출 게이트웨이", "주문 이벤트 발행기"

[L5  MANDATORY] Orchestration                shape: process
   Controllers/sagas/pipelines that sequence services + storage + state. ALSO
   absorbs: branching/decision policies (express branches as multiple outgoing
   edges) and document/file-generation processes (anything that runs code to
   emit an artifact — exported CSV, generated PDF, etc).
   At least one process node per major user action.
   Examples: "메시지 전송 파이프라인", "결제 분기 라우터", "리포트 PDF 생성기"

[L6  MANDATORY] UI primitives & forms        shape: input
   Reusable presentational pieces: button, MessageBubble, Composer, Modal,
   Loading, ErrorBoundary. Each is testable in jsdom independently of any
   screen. At MINIMUM include: one composer/form node + one Loading/Error node.

[L7  MANDATORY] Screens / pages              shape: screen
   Composed views the user navigates between. Each screen imports input
   components + a process for its actions. At least one per major user-visible
   state.

[L8  MANDATORY] Entry point                  shape: startEnd
   App mount/hydrate/wire. EXACTLY ONE per diagram. Goes last in build order.

[ANNOTATION]    Suggestions / TODO / groups  shape: note
   Title MUST start with "추천:" if it's a recommendation for a capability the
   user did NOT explicitly ask for. Also use note for bounded-context grouping
   labels and pure design memos. Notes are NEVER built into code.

═══════════════════════════════════════════════════════════════════════════════
NODE COUNT TARGETS
═══════════════════════════════════════════════════════════════════════════════
- Single-purpose tool (calculator, timer):     8-12 nodes
- Standard interactive app (chat, todo):       14-22 nodes
- Multi-screen complex app (dashboard, IDE):   18-28 nodes

Hitting ~14-22 for a typical app means: 1 types + 1 storage + 2-3 services +
1-2 api + 1 state-management + 2-4 process + 3-5 input components + 2-3 screens
+ 1 entry. That's the realistic floor for "buildable end-to-end".

═══════════════════════════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════════════════════════
- DO NOT skip any [MANDATORY] layer. If a brief is "just a calculator", you still
  need types (state), storage (even in-memory), services (the math), api (DOM
  wrapper), process (orchestrate input→compute→display), input (digit buttons,
  display), screen (calculator panel), and startEnd (mount).
- DO NOT mix concerns in one node. "Auth + storage + UI" → split into 3 nodes.
- DO NOT use generic placeholder titles ("핵심 처리", "도메인 모듈"). Every title
  must be specific to THIS brief.
- DO NOT promote inferred features (auth, sync, notifications) into MANDATORY
  layers unless the brief asks. Suggest them as note nodes prefixed "추천:".
- DO NOT encode visual design (colors, fonts, spacing). That belongs to harness.design.
- Edge direction: A → B means "A calls/depends on B at RUNTIME". This is
  documentation only — the build engine reorders by layer automatically.

═══════════════════════════════════════════════════════════════════════════════
SHIPPABILITY SELF-CHECK — THE GRAPH MUST PASS THIS BEFORE YOU RETURN
═══════════════════════════════════════════════════════════════════════════════
This graph is the COMPLETE, AUTHORITATIVE specification of the system. A coding
agent will build only what your graph says. If a piece is missing from the graph,
it will be missing from the running app.

Do this MENTAL SIMULATION before finalizing your response:

  1. Imagine all of your nodes are now built into a real codebase.
  2. The user opens the codebase and types the natural "run" command for this
     stack (e.g. "pnpm dev" for web/desktop, "node bin/cli.js" for CLI,
     "pnpm start" for server, etc).
  3. Does the app actually start, render its first interactive surface, and
     persist data in a way the user can verify?

If your answer is NO, the graph is INCOMPLETE. Find what is missing and ADD
nodes for it. Common omissions to scan for (any of these missing → fix it):

  □ Application entry/host file (HTML for web/desktop, bin script for CLI,
    server bootstrap for API). It is NOT enough to have a startEnd node that
    only "wires modules" — there must also be a node owning the actual
    entry artifact a runtime loads first.
  □ Build / dev-server configuration (vite.config / webpack / rollup /
    electron-builder / cargo manifest / tsconfig for libs). Whatever your
    stack needs to compile and run.
  □ Real platform adapter implementation, not just the contract. A
    "persistence contract" node alone does not store anything — there must
    be a sibling node implementing it for the target runtime (browser
    localStorage, Tauri IPC, sqlite via node, etc).
  □ package.json scripts wiring (dev / build / start / test). One node should
    own these or another node's behavior should explicitly create them.
  □ One smoke / integration test node that actually mounts/boots the system
    and asserts a single happy path round-trip (e.g. "mount → click →
    storage write → reload → state restored"). Unit tests on individual
    modules are not enough.
  □ Environment / secret configuration if the brief implies external services.
  □ Output artifacts the user explicitly asked for (downloadable file,
    generated PDF, exported config, etc) — produced by a real node, not
    implied.

After scanning the list above, ask yourself: "Could a stranger receive ONLY
this graph, run codex over it, and ship the app the same hour?" If yes, you
are done. If no, add the missing nodes.

The number of additional nodes from this check is typically 2–4. Do not
hesitate to push your total node count higher than the sizing target above
if shippability requires it — sizing is a lower bound, not a ceiling.

═══════════════════════════════════════════════════════════════════════════════
PER-NODE FIELDS YOU MUST FILL
═══════════════════════════════════════════════════════════════════════════════
- title:    specific to THIS app, in the brief's language
- actor:    user | system | scheduler | external | (specific role)
- intent:   1 sentence, "this node exists to..."
- behavior: 2-4 sentences of WHAT the module concretely does; cite types it
            defines/imports; cite functions it exports.
- inputs:   typed shape of incoming data (e.g. "{ threadId: string, text: string }")
- outputs:  typed shape of outgoing data
- notes:    edge cases, what NOT to include, dependencies on other nodes
- testHint: ≥1 happy-path test + ≥1 edge case (e.g. "empty list", "network fail")

═══════════════════════════════════════════════════════════════════════════════
STRATEGY
═══════════════════════════════════════════════════════════════════════════════
${strategy === "augment"
  ? "augment: revise and EXTEND the current diagram. Add missing layers that the user's new request implies. Return a fresh full diagram (not a patch). Preserve existing node ids when the role is unchanged."
  : "replace: generate a fresh full diagram from the brief. The current diagram is loose context only."}

═══════════════════════════════════════════════════════════════════════════════
HARNESS (implementation environment — use as constraints, not as feature list)
═══════════════════════════════════════════════════════════════════════════════
${JSON.stringify(harness ?? null, null, 2)}

═══════════════════════════════════════════════════════════════════════════════
CURRENT DIAGRAM CONTEXT (for augment mode)
═══════════════════════════════════════════════════════════════════════════════
${JSON.stringify(diagram ?? null, null, 2)}

═══════════════════════════════════════════════════════════════════════════════
USER BRIEF
═══════════════════════════════════════════════════════════════════════════════
${brief}

Now produce the module graph. Before returning, mentally verify THREE things:
  1. Every MANDATORY architecture layer (L1 state, L2 database, L3 service,
     L4 api, L5 process, L6 input, L7 screen, L8 startEnd) has at least one node.
  2. Every node uses ONE of the 9 allowed shapes (state, database, service,
     api, process, input, screen, startEnd, note). No queue/auth/external/
     event/decision/document/group — those are gone.
  3. The SHIPPABILITY SELF-CHECK above passes — a stranger could ship from
     your graph alone, no missing entry/build/adapter/smoke nodes.
`.trim();

const buildPromptFromDiagram = (diagram, scope, harness) => {
  const scopedNodes =
    scope.mode === "selection"
      ? diagram.nodes.filter((node) => scope.nodeIds.includes(node.id))
      : diagram.nodes;

  const scopedIds = new Set(scopedNodes.map((node) => node.id));
  const internalEdges =
    scope.mode === "selection"
      ? diagram.edges.filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target))
      : diagram.edges;
  const boundaryEdges =
    scope.mode === "selection"
      ? diagram.edges.filter((edge) => scopedIds.has(edge.source) !== scopedIds.has(edge.target))
      : [];
  const boundaryNodeIds = new Set(
    boundaryEdges.flatMap((edge) => [edge.source, edge.target]).filter((nodeId) => !scopedIds.has(nodeId)),
  );
  const boundaryNodes =
    scope.mode === "selection"
      ? diagram.nodes
          .filter((node) => boundaryNodeIds.has(node.id))
          .map((node) => ({
            id: node.id,
            shape: node.shape,
            title: node.title,
            actor: node.actor,
            intent: node.intent,
          }))
      : [];
  const contextBlock =
    scope.mode === "selection"
      ? `
Boundary nodes outside the current scope:
${JSON.stringify(boundaryNodes, null, 2)}

Boundary edges crossing the current scope:
${JSON.stringify(boundaryEdges, null, 2)}
`.trim()
      : `
Full diagram for context:
${JSON.stringify(diagram, null, 2)}
`.trim();

  const design = harness && harness.design ? harness.design : null;
  const designBlock = design
    ? `
Design Tokens (project-wide visual system — apply to every Screen/UI node during implementation):
${JSON.stringify(design, null, 2)}

Design application rules:
- The diagram itself is intentionally design-free. The design tokens above are the single source of visual truth.
- For every Screen/UI node, the spec must describe how the UI uses these tokens: palette (primary/accent/bg/fg/muted/error), radius, density, typography, theme mode, and the referenceStyle vibe.
- The spec must instruct the build phase to (1) configure Tailwind theme.extend with the palette and typography, (2) emit CSS custom properties for the palette in globals.css, (3) apply className tokens consistently across components.
- Honor design.notes verbatim when present — treat it as additional visual guidance from the user.
- Non-UI nodes (Process/API/Service/Database/etc.) ignore design tokens.
`.trim()
    : "";

  return `
You are a staff engineer and product architect.
Transform the following programming diagram into a rigorous implementation specification.

Rules:
- Treat node shapes as semantic hints.
- Directed edges define control flow, data flow, or dependency flow from source to target.
- Use the text inside each node as primary product intent.
- Produce a complete but execution-oriented answer.
- If the scope is partial, preserve the rest of the system using mocks, adapters, or interface boundaries.
- If the scope is partial, optimize for the selected nodes first and use only boundary summaries for outside context.
- Favor implementation detail over abstract commentary.

Output requirements:
- Return only valid JSON matching the provided schema.
- The buildPrompt must instruct a coding agent to build the selected system exactly from the diagram, including the design tokens application for UI nodes.
- The iterationPrompt must instruct the coding agent to build only the current scope and leave the rest stubbed but testable, while still applying the design tokens to any UI within that scope.

Scope:
${JSON.stringify(scope, null, 2)}

Scoped nodes:
${JSON.stringify(scopedNodes, null, 2)}

Scoped internal edges:
${JSON.stringify(internalEdges, null, 2)}

${contextBlock}

${designBlock}
`.trim();
};

const fallbackSpec = (diagram, scope, errorMessage = "") => {
  const scopedNodes =
    scope.mode === "selection"
      ? diagram.nodes.filter((node) => scope.nodeIds.includes(node.id))
      : diagram.nodes;

  return {
    title: scope.mode === "selection" ? "Selected Graph Slice Specification" : "Full Graph System Specification",
    overview:
      scope.mode === "selection"
        ? "선택된 노드만 우선 구현하고 나머지는 인터페이스와 스텁으로 유지하는 부분 구현 명세입니다."
        : "전체 도식화를 앱 구조로 바꾸는 초기 명세입니다.",
    architecture: scopedNodes.map(
      (node) => `${node.title}: ${node.actor}가 ${node.intent}를 위해 ${node.behavior}를 수행`,
    ),
    executionPlan: [
      "도식화의 노드 텍스트를 기준으로 화면, 서비스, API, 저장소 책임을 분리한다.",
      "방향성 선을 따라 의존 관계와 데이터 흐름을 코드 구조로 내린다.",
      "현재 범위 밖의 기능은 mock 또는 stub로 고정하고 테스트 가능한 경계를 만든다.",
      "핵심 사용자 흐름부터 구현하고 연결 테스트를 작성한다.",
    ],
    nodeSummaries: scopedNodes.map((node) => ({
      nodeId: node.id,
      role: node.shape,
      summary: node.behavior,
      implementationHint: `${node.title} 모듈을 만들고 "${node.intent}" 목적에 맞는 인터페이스를 정의한다.`,
      testHint: node.testHint || `${node.title}의 정상 흐름과 실패 흐름을 검증한다.`,
    })),
    filePlan: [
      "src/app-shell/*",
      "src/features/*",
      "src/services/*",
      "src/state/*",
      "tests/*",
    ],
    testPlan: [
      "선택된 노드 경로를 따라 통합 테스트를 작성한다.",
      "분기 노드는 조건별 결과를 검증한다.",
      "현재 범위 밖 노드는 스텁 연결만 검증한다.",
    ],
    buildPrompt: `Build the ${
      scope.mode === "selection" ? "selected portion" : "full system"
    } from this programming diagram. Respect every node's title, actor, intent, behavior, inputs, outputs, notes, and test hints. Use directed edges as dependency and flow order. Return a working, testable app skeleton with clear file structure and verification steps.`,
    iterationPrompt:
      "Implement only the currently selected scope. Anything outside the selected scope must remain mocked or stubbed, but all boundaries must compile and the selected flow must be testable end-to-end.",
    assumptions: errorMessage ? [`Codex fallback used because: ${errorMessage}`] : ["Prototype fallback mode used."],
  };
};

const fallbackDiagram = (brief, diagram, harness, strategy, errorMessage = "") => {
  if (strategy === "augment" && diagram && Array.isArray(diagram.nodes) && diagram.nodes.length > 0) {
    return {
      title: `${harness?.projectName || "Workspace"} Updated Diagram`,
      summary: brief,
      nodes: [
        ...diagram.nodes.map((node) => ({
          key: node.id,
          shape: node.shape,
          title: node.title,
          actor: node.actor,
          intent: node.intent,
          behavior: node.behavior,
          inputs: node.inputs,
          outputs: node.outputs,
          notes: node.notes,
          testHint: node.testHint,
          status: node.status,
        })),
        {
          key: "brief-update-note",
          shape: "note",
          title: "Brief Update",
          actor: "사용자",
          intent: "기존 diagram에 추가로 반영해야 하는 요구를 요약한다",
          behavior: brief,
          inputs: "추가 요구 텍스트",
          outputs: "수정 방향 메모",
          notes: errorMessage ? `Fallback generated because: ${errorMessage}` : "Codex fallback mode.",
          testHint: "이 노트를 기반으로 다음 generation에서 구조를 확장한다",
          status: "planned",
        },
      ],
      edges: diagram.edges.map((edge) => ({
        sourceKey: edge.source,
        targetKey: edge.target,
        relation: edge.relation,
        notes: edge.notes,
        lineStyle: edge.lineStyle,
        animated: edge.animated,
      })),
    };
  }

  const normalizedBrief = compactText(brief).toLowerCase();
  if (isCryptoTrackerBrief(normalizedBrief)) {
    return buildCryptoTrackerFallback(brief, harness, errorMessage);
  }

  if (isAgentDiagramBrief(normalizedBrief)) {
    return buildAgentDiagramFallback(brief, harness, errorMessage);
  }

  return buildGenericFallback(brief, harness, errorMessage);
};

const runCodexStructuredOutput = async ({ prompt, schema, name, timeoutMs = 600000 }) => {
  await ensureRuntimeDirs();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const schemaPath = path.join(TMP_DIR, `${name}-schema-${stamp}.json`);
  const outputPath = path.join(TMP_DIR, `${name}-output-${stamp}.json`);
  const promptPath = path.join(GENERATED_DIR, `${name}-prompt-${stamp}.md`);
  const rawPath = path.join(GENERATED_DIR, `${name}-raw-${stamp}.json`);

  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2));
  await fs.writeFile(promptPath, prompt);

  const args = [
    "exec",
    "-m",
    "gpt-5.5",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-",
  ];

  const raw = await new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex ${name} generation timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Codex exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });

  const text = await fs.readFile(outputPath, "utf8");
  await fs.writeFile(rawPath, text);
  return {
    parsed: JSON.parse(text),
    raw,
  };
};

const runCodexSpec = async (diagram, scope, harness) => {
  const prompt = buildPromptFromDiagram(diagram, scope, harness);
  return runCodexStructuredOutput({
    prompt,
    schema: SPEC_SCHEMA,
    name: "spec",
  });
};

const slugifyNodeTitle = (title, nodeId) => {
  const base = String(title || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "node";
  const suffix = String(nodeId || "").slice(0, 8) || "x";
  return `${base}-${suffix}`;
};

// Architecture-layer build priority. Lower number = built FIRST.
//
// Rationale: a developer implements an app bottom-up — types before storage,
// storage before services, services before bridges, orchestration before UI,
// entry point last. Each layer can only import from layers BELOW it. Edge
// direction in the diagram represents RUNTIME flow (A calls B), which is the
// *opposite* of what build order needs, so we intentionally ignore edges for
// ordering (they're still drawn on the canvas for human reference).
//
// After the 16→9 shape collapse there are 8 buildable shapes mapping to 8
// layers. The 9th shape (`note`) is annotation only and excluded from build
// order entirely (see `skip` set above). Removed shapes
// (queue/auth/external/event/decision/document/group) migrate to one of the
// 8 via LEGACY_SHAPE_MAP — server-side migration runs before this lookup.
const SHAPE_PRIORITY = {
  state: 1,      // L1: type defs, schemas, reactive stores — pure data shape
  database: 2,   // L2: persistence (localStorage, sqlite, indexeddb)
  service: 3,    // L3: domain logic (also absorbs auth/queue/external)
  api: 4,        // L4: bridge / gateway (also absorbs event/webhook)
  process: 5,    // L5: orchestration (also absorbs decision/document-generation)
  input: 6,      // L6: UI primitives — forms, buttons
  screen: 7,     // L7: composed pages
  startEnd: 8,   // L8: entry point — mount, hydrate, wire everything
};

const deriveBuildOrder = (diagram) => {
  // Only `note` is skipped now — the old `group` shape was legacy-migrated
  // into `note` before reaching this code.
  const skip = new Set(["note"]);
  const runtimeNodes = (diagram?.nodes || []).filter((n) => !skip.has(n.shape));
  const priorityOf = (n) => SHAPE_PRIORITY[n.shape] ?? 50;

  // Sort by (shape priority, x position, original index). Deterministic and
  // independent of the edge directions the LLM happened to draw.
  const ordered = runtimeNodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const pa = priorityOf(a.n);
      const pb = priorityOf(b.n);
      if (pa !== pb) return pa - pb;
      const ax = a.n.position?.x ?? 0;
      const bx = b.n.position?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.i - b.i;
    })
    .map(({ n }) => n.id);

  // "cycles" here flags **back-edges** relative to shape priority: e.g., a screen
  // whose edge points at a database. That's legitimate in runtime (UI reads from DB,
  // DB pushes updates back), but it signals the diagram has feedback loops the user
  // should be aware of. Does not affect order.
  const runtimeIds = new Set(runtimeNodes.map((n) => n.id));
  const nodeById = new Map(runtimeNodes.map((n) => [n.id, n]));
  let cycles = false;
  for (const edge of diagram?.edges || []) {
    if (!runtimeIds.has(edge.source) || !runtimeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const s = nodeById.get(edge.source);
    const t = nodeById.get(edge.target);
    if (priorityOf(s) > priorityOf(t)) {
      cycles = true;
      break;
    }
  }

  return { order: ordered, cycles };
};

const buildNodePrompt = ({ node, harness, previouslyBuilt, previousTestFailure, isFirst }) => {
  const design = harness?.design ? JSON.stringify(harness.design, null, 2) : "null";
  const nodeSlug = slugifyNodeTitle(node.title, node.id);
  const priorContext = Array.isArray(previouslyBuilt) && previouslyBuilt.length > 0
    ? previouslyBuilt
        .map((p) => `- ${p.title} [${p.shape}]: files=${(p.files || []).slice(0, 4).join(", ")}${(p.files || []).length > 4 ? "..." : ""}`)
        .join("\n")
    : "(none — this is the first node)";

  const bootstrapBlock = isFirst
    ? `
Bootstrap requirements (first node only):
- Scaffold package.json with the correct packageManager (harness.stack.packageManager). Include "type": "module".
- Install vitest@^2, @types/node, typescript, jsdom as devDependencies.
- Create tsconfig.json: target ES2022, module Bundler, moduleResolution Bundler, jsx react-jsx, strict true, include [src, tests].
- Create vitest.config.ts with environment "jsdom" and include ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"].
- Create the empty tests/ directory; every subsequent node adds its own subfolder.
- If harness.stack.frontend uses Tailwind: create tailwind.config.ts and src/globals.css wiring the six palette vars and typography.
- Run the package manager's install command once so node_modules is ready for later nodes' tests.
`.trim()
    : `
The workspace is already scaffolded by prior nodes. Do NOT re-initialize package.json, tsconfig, or vitest config. Only add the files this node needs.`.trim();

  const fixBlock = previousTestFailure
    ? `
PREVIOUS TEST FAILURE — THIS IS A FIX ATTEMPT. Patch the root cause and do not touch unrelated code.

${previousTestFailure.slice(0, 4000)}
`.trim()
    : "";

  return `
You are implementing EXACTLY ONE node of a diagram-driven system. Do not implement other nodes. Do not invent features beyond this node's explicit behavior.

Harness (environment + quality policy, authoritative):
${JSON.stringify(harness ?? null, null, 2)}

Design tokens (wire via CSS variables + Tailwind tokens, never hardcode hex):
${design}

Already-built nodes (import from them; never re-implement):
${priorContext}

Target node (implement exactly this, no more):
- id: ${node.id}
- title: ${node.title}
- shape: ${node.shape}
- actor: ${node.actor}
- intent: ${node.intent}
- behavior: ${node.behavior}
- inputs: ${node.inputs}
- outputs: ${node.outputs}
- notes: ${node.notes}
- testHint: ${node.testHint}

${bootstrapBlock}

CONTEXT-DISCOVERY — DO THIS FIRST (required, before writing any code):
1. Read package.json and tsconfig.json so you know the framework, test runner,
   and module setup.
2. For EACH "already-built node" listed above, OPEN its files (the paths are
   shown). Note the exact exported types, function signatures, and named exports.
3. NEVER invent a type that another node already defines. If you need a Message
   type and a prior node defined it, IMPORT IT — do not redeclare.
4. If a needed export is missing from prior nodes, treat that as a bug in the
   diagram and either (a) add the missing export to the prior node's files
   (only if it's clearly a tiny gap) or (b) write a NOTE in your final summary
   explaining what's missing so the user can fix the diagram.

Work rules for this node:
1. Write the source file(s) for this node, prefer src/<area>/ structure that
   matches the node's shape (state→src/types, database→src/store,
   service→src/services, api→src/api, process→src/orchestration,
   input→src/components, screen→src/screens, startEnd→src/main.ts*).
2. Write comprehensive tests in tests/${nodeSlug}/*.test.ts covering every
   branch implied by behavior, inputs, outputs, and testHint. Use vitest.
   Test BOTH the happy path AND at least one edge case.
3. Run the whole workspace's vitest suite and make sure it is green before
   finishing. Do not finish on red.
4. Run \`npx tsc --noEmit\` and make sure it is green before finishing.
5. Do NOT delete or edit files created by prior nodes unless the current node's
   behavior explicitly requires it. If you must edit a prior file, keep the
   change minimal and additive (export new symbols, do not change existing
   signatures).
6. End with a terse summary: "Files added: ..." and "Files modified: ..."
   Include any IMPORT mismatches you noticed in prior nodes (so the user
   can decide whether to refine the diagram).

${fixBlock}

Start now.
`.trim();
};

const runCodexForNode = async ({ prompt, cwd, nodeId, attempt, timeoutMs = 900000 }) => {
  await ensureRuntimeDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shortId = String(nodeId || "x").slice(0, 8);
  const promptPath = path.join(GENERATED_DIR, `node-${shortId}-attempt${attempt}-prompt-${stamp}.md`);
  const logPath = path.join(GENERATED_DIR, `node-${shortId}-attempt${attempt}-log-${stamp}.txt`);
  await fs.writeFile(promptPath, prompt);

  const args = [
    "exec",
    "-m",
    "gpt-5.5",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ephemeral",
    "--color",
    "never",
    "-",
  ];

  const output = await new Promise((resolve, reject) => {
    const child = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex node build timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Codex exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve([stdout.trim(), stderr.trim() ? `\n[stderr]\n${stderr.trim()}` : ""].filter(Boolean).join("\n").trim());
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  await fs.writeFile(logPath, output);
  return { output, promptPath, logPath };
};

const detectTestRunner = async (cwd) => {
  const localVitest = path.join(cwd, "node_modules", ".bin", "vitest");
  const localJest = path.join(cwd, "node_modules", ".bin", "jest");
  const hasLocal = async (p) => fs.access(p).then(() => true).catch(() => false);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
    const wantsVitest = /vitest/.test(pkg.scripts?.test || "") || pkg.devDependencies?.vitest || pkg.dependencies?.vitest;
    const wantsJest = !wantsVitest && (pkg.devDependencies?.jest || pkg.dependencies?.jest);
    if (wantsVitest && await hasLocal(localVitest)) {
      return { cmd: localVitest, args: ["run", "--reporter=verbose", "--no-color"] };
    }
    if (wantsJest && await hasLocal(localJest)) {
      return { cmd: localJest, args: ["--color=false"] };
    }
    if (wantsVitest) {
      return { cmd: "npx", args: ["--yes", "vitest", "run", "--reporter=verbose", "--no-color"] };
    }
    if (wantsJest) {
      return { cmd: "npx", args: ["--yes", "jest", "--color=false"] };
    }
  } catch (err) {
    console.warn(`[detectTestRunner] could not read ${cwd}/package.json: ${err?.message || err}`);
  }
  if (await hasLocal(localVitest)) {
    return { cmd: localVitest, args: ["run", "--reporter=verbose", "--no-color"] };
  }
  return { cmd: "npx", args: ["--yes", "vitest", "run", "--reporter=verbose", "--no-color"] };
};

const extractFailureLines = (text) => {
  const failures = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bFAIL\b|\bfailed\b|\bError:|AssertionError|Expected |Received /.test(line)) {
      const block = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
      if (!seen.has(block)) {
        seen.add(block);
        failures.push(block);
      }
    }
  }
  const summaryMatch = text.match(/\bTest Files\s+\d+[^\n]*failed[^\n]*/);
  if (summaryMatch) failures.unshift(summaryMatch[0]);
  return failures.slice(0, 12);
};

const runNodeTests = async ({ cwd, timeoutMs = 300000 }) => {
  const { cmd, args } = await detectTestRunner(cwd);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ passed: false, failures: [`Test runner failed to start: ${err.message}`], stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ passed: false, failures: [`Tests timed out after ${Math.round(timeoutMs / 1000)}s`], stdout, stderr });
        return;
      }
      const passed = code === 0;
      const failures = passed ? [] : extractFailureLines(`${stdout}\n${stderr}`);
      resolve({ passed, failures, stdout, stderr });
    });
  });
};

const listWorkspaceFiles = async (cwd) => {
  const result = [];
  const walk = async (dir, prefix = "") => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "EACCES") {
        console.warn(`[listWorkspaceFiles] ${dir}: ${err?.message || err}`);
      }
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else result.push(rel);
    }
  };
  await walk(cwd);
  return result;
};

// Snapshot files with their mtimes so we can distinguish NEW vs MODIFIED vs unchanged.
const snapshotWorkspaceMtimes = async (cwd) => {
  const files = await listWorkspaceFiles(cwd);
  const map = new Map();
  await Promise.all(files.map(async (rel) => {
    try {
      const stat = await fs.stat(path.join(cwd, rel));
      map.set(rel, stat.mtimeMs);
    } catch { /* dropped between readdir and stat — ignore */ }
  }));
  return map;
};

const diffWorkspaceSnapshots = (before, after) => {
  const changed = [];
  for (const [rel, mtime] of after) {
    const prev = before.get(rel);
    if (prev === undefined || prev !== mtime) changed.push(rel);
  }
  return changed;
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "graph-coding-gpt-prototype" });
});

app.get("/api/auth/status", (_req, res) => {
  res.json(codexStatus({ fresh: true }));
});

app.post("/api/workspace/open-folder", async (req, res) => {
  try {
    const requestedPath = typeof req.body?.path === "string" && req.body.path ? path.resolve(req.body.path) : chooseFolderViaDialog();
    const workspace = await readWorkspaceListing(requestedPath);
    res.json({
      ok: true,
      ...workspace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open folder.";
    res.status(400).json({
      ok: false,
      error: message,
    });
  }
});

app.post("/api/workspace/read-file", async (req, res) => {
  try {
    const rootPath = typeof req.body?.rootPath === "string" ? req.body.rootPath : "";
    const relativePath = typeof req.body?.path === "string" ? req.body.path : "";

    if (!rootPath || !relativePath) {
      res.status(400).json({ ok: false, error: "rootPath and path are required." });
      return;
    }

    const absolutePath = ensureWithinRoot(rootPath, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    res.json({ ok: true, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read file.";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/workspace/write-artifacts", async (req, res) => {
  try {
    const rootPath = typeof req.body?.rootPath === "string" ? req.body.rootPath : "";
    const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];

    if (!rootPath) {
      res.status(400).json({ ok: false, error: "rootPath is required." });
      return;
    }

    for (const artifact of artifacts) {
      if (!artifact || typeof artifact.path !== "string" || typeof artifact.content !== "string") {
        continue;
      }

      const destination = ensureWithinRoot(rootPath, artifact.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, artifact.content);
    }

    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to write artifacts.";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/ai/diagram", async (req, res) => {
  const { brief, diagram, harness, strategy } = req.body ?? {};

  if (typeof brief !== "string" || brief.trim().length === 0) {
    res.status(400).json({
      ok: false,
      error: "brief is required",
    });
    return;
  }

  const mode = strategy === "augment" ? "augment" : "replace";

  try {
    const status = codexStatus();
    if (!status.codexInstalled || !status.codexAuthenticated) {
      const generatedDiagram = sanitizeDiagramBlueprint(
        fallbackDiagram(brief, diagram, harness, mode, status.detail),
        brief,
        harness,
      );
      console.warn("[diagram] using fallback because codex is not ready:", status.detail);
      res.json({
        ok: true,
        source: "fallback",
        generatedAt: new Date().toISOString(),
        diagram: generatedDiagram,
        coverage: validateDiagramCoverage(generatedDiagram),
        error: status.detail,
      });
      return;
    }

    const prompt = buildPromptFromBrief(brief, diagram, harness, mode);
    const { parsed, raw } = await runCodexStructuredOutput({
      prompt,
      schema: DIAGRAM_SCHEMA,
      name: "diagram",
      timeoutMs: 600000,
    });
    const sanitized = sanitizeDiagramBlueprint(parsed, brief, harness);
    const coverage = validateDiagramCoverage(sanitized);
    if (!coverage.ok) {
      console.warn(`[diagram] missing layers: ${coverage.missingLayers.join(", ")}`);
    }

    res.json({
      ok: true,
      source: "codex",
      generatedAt: new Date().toISOString(),
      diagram: sanitized,
      coverage,
      raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const generatedDiagram = sanitizeDiagramBlueprint(
      fallbackDiagram(brief, diagram, harness, mode, message),
      brief,
      harness,
    );
    console.warn("[diagram] using fallback because codex generation failed:", message);
    res.json({
      ok: true,
      source: "fallback",
      generatedAt: new Date().toISOString(),
      diagram: generatedDiagram,
      coverage: validateDiagramCoverage(generatedDiagram),
      error: message,
    });
  }
});

app.post("/api/ai/spec", async (req, res) => {
  const { diagram: rawDiagram, requestedMode, harness } = req.body ?? {};

  if (!rawDiagram || !Array.isArray(rawDiagram.nodes) || !Array.isArray(rawDiagram.edges)) {
    res.status(400).json({
      ok: false,
      error: "diagram payload is required",
    });
    return;
  }

  // Migrate legacy shapes so spec prompt + scope detection see the new vocabulary.
  const diagram = migrateDiagramShapes(rawDiagram);
  const scope = normalizeScope(diagram, requestedMode);

  try {
    const status = codexStatus();
    if (!status.codexInstalled || !status.codexAuthenticated) {
      const spec = fallbackSpec(diagram, scope, status.detail);
      res.json({
        ok: true,
        source: "fallback",
        generatedAt: new Date().toISOString(),
        spec,
        error: status.detail,
      });
      return;
    }

    const { parsed, raw } = await runCodexSpec(diagram, scope, harness);
    res.json({
      ok: true,
      source: "codex",
      generatedAt: new Date().toISOString(),
      spec: parsed,
      raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const spec = fallbackSpec(diagram, scope, message);
    res.json({
      ok: true,
      source: "fallback",
      generatedAt: new Date().toISOString(),
      spec,
      error: message,
    });
  }
});

app.post("/api/ai/build-order", (req, res) => {
  const rawDiagram = req.body?.diagram;
  if (!rawDiagram || !Array.isArray(rawDiagram.nodes)) {
    res.status(400).json({ ok: false, error: "diagram payload required" });
    return;
  }
  // Migrate up front so SHAPE_PRIORITY lookup works on legacy saved diagrams.
  const diagram = migrateDiagramShapes(rawDiagram);
  try {
    const { order, cycles } = deriveBuildOrder(diagram);
    res.json({ ok: true, order, cycles });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.post("/api/ai/build-node", async (req, res) => {
  const { rootPath, diagram: rawDiagram, harness, nodeId, previouslyBuilt, isFirst, maxRetries } = req.body ?? {};
  const retries = Number.isInteger(maxRetries) ? Math.max(0, Math.min(5, maxRetries)) : 3;

  if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
    res.status(400).json({ ok: false, error: "rootPath is required" });
    return;
  }
  if (!rawDiagram || !Array.isArray(rawDiagram.nodes)) {
    res.status(400).json({ ok: false, error: "diagram payload required" });
    return;
  }
  // Migrate legacy shapes so buildNodePrompt's folder hints + SHAPE_PRIORITY
  // sorting both see the new vocabulary.
  const diagram = migrateDiagramShapes(rawDiagram);
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(400).json({ ok: false, error: "nodeId not found in diagram" });
    return;
  }

  try {
    const status = codexStatus();
    if (!status.codexInstalled || !status.codexAuthenticated) {
      res.status(400).json({ ok: false, error: status.detail });
      return;
    }

    const resolvedRoot = ensureWithinRoot(rootPath, ".");
    const stats = await fs.stat(resolvedRoot);
    if (!stats.isDirectory()) throw new Error("rootPath must be a directory.");

    const beforeSnapshot = await snapshotWorkspaceMtimes(resolvedRoot);
    const priorList = Array.isArray(previouslyBuilt) ? previouslyBuilt : [];

    let attempt = 0;
    let lastOutput = "";
    let lastTestResult = null;
    let lastPromptPath;
    let lastLogPath;
    let previousTestFailure = null;
    const totalAttempts = Math.max(1, retries + 1);

    while (attempt < totalAttempts) {
      attempt += 1;
      const prompt = buildNodePrompt({
        node,
        harness,
        previouslyBuilt: priorList,
        previousTestFailure,
        isFirst: !!isFirst && attempt === 1,
      });
      const run = await runCodexForNode({
        prompt,
        cwd: resolvedRoot,
        nodeId: node.id,
        attempt,
      });
      lastOutput = run.output;
      lastPromptPath = run.promptPath;
      lastLogPath = run.logPath;
      const tests = await runNodeTests({ cwd: resolvedRoot });
      lastTestResult = tests;
      if (tests.passed) break;
      previousTestFailure = `${tests.failures.join("\n\n")}\n\n[stderr tail]\n${tests.stderr.slice(-2000)}`;
    }

    const afterSnapshot = await snapshotWorkspaceMtimes(resolvedRoot);
    const newOrModified = diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot);

    res.json({
      ok: true,
      nodeId: node.id,
      status: lastTestResult?.passed ? "done" : "failed",
      attempts: attempt,
      files: newOrModified,
      output: lastOutput,
      testResult: lastTestResult,
      promptPath: lastPromptPath,
      logPath: lastLogPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

const BUILD_STATE_RELPATH = ".graphcoding/build-state.json";

app.post("/api/build-state/save", async (req, res) => {
  try {
    const { rootPath, state } = req.body ?? {};
    if (typeof rootPath !== "string" || !rootPath) {
      res.status(400).json({ ok: false, error: "rootPath required" });
      return;
    }
    const absolutePath = ensureWithinRoot(rootPath, BUILD_STATE_RELPATH);
    if (state === null || state === undefined) {
      await fs.unlink(absolutePath).catch((err) => {
        if (err && err.code !== "ENOENT") throw err;
      });
      res.json({ ok: true, cleared: true });
      return;
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, JSON.stringify(state, null, 2));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.post("/api/build-state/load", async (req, res) => {
  try {
    const { rootPath } = req.body ?? {};
    if (typeof rootPath !== "string") {
      res.status(400).json({ ok: false, error: "rootPath required" });
      return;
    }
    const absolutePath = ensureWithinRoot(rootPath, BUILD_STATE_RELPATH);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      res.json({ ok: true, state: JSON.parse(content) });
    } catch (err) {
      if (err && err.code === "ENOENT") {
        res.json({ ok: true, state: null });
      } else {
        throw err;
      }
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

await ensureRuntimeDirs();

app.use(express.static(DIST_DIR));

app.get(/^(?!\/api).*/, async (_req, res) => {
  try {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  } catch {
    res
      .status(503)
      .send("Frontend bundle not found. Run `npm run build` once, or use `npm run dev` for local development.");
  }
});

app.listen(PORT, () => {
  console.log(`graph-coding-gpt server listening on http://127.0.0.1:${PORT}`);
});
