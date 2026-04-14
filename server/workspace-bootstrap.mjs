import path from "path";
import { promises as fs } from "fs";

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

export const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".pnpm-store",
  "coverage",
  ".idea",
  ".vscode-test",
]);

export const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export const WORKSPACE_MARKERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pubspec.yaml",
  "Dockerfile",
  ".graphcoding/manifest.json",
  ".graphcoding/harness.json",
];

const MANIFEST_PATH = ".graphcoding/manifest.json";
const GRAPH_ARTIFACT_PATH = ".graphcoding/diagram.graph.json";
const WORKFLOW_STATE_PATH = ".graphcoding/workflow-state.json";
const STEP_HISTORY_PATH = ".graphcoding/step-history.json";
const RESUME_STATE_PATH = ".graphcoding/resume-state.json";
const MANIFEST_MARKER = "graph-coding-gpt-workspace";
const MANIFEST_APP = "graph-coding-gpt";
const MANIFEST_FORMAT_VERSION = 1;
const CODE_SIGNAL_DIRECTORIES = [
  "src/",
  "app/",
  "server/",
  "electron/",
  "components/",
  "pages/",
  "lib/",
  "tests/",
];
const CODE_SIGNAL_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "swift", "dart", "sql", "sh"]);

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

export const ensureWithinRoot = (rootPath, relativePath) => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(rootPath, relativePath);
  const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;

  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }

  return resolvedFile;
};

export const shouldIgnoreWorkspacePath = (relativePath) => {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  const fileName = parts[parts.length - 1];
  if (IGNORED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return parts.slice(0, -1).some((part) => IGNORED_DIRECTORY_NAMES.has(part));
};

export const detectWorkspaceKind = (filePaths) => {
  const has = (candidate) => filePaths.has(candidate);
  const hasSome = (candidates) => candidates.some((candidate) => filePaths.has(candidate));

  if (has("pubspec.yaml")) {
    return "Flutter workspace";
  }

  if (has("Cargo.toml") && hasSome(["src-tauri/tauri.conf.json", "tauri.conf.json"])) {
    return "Tauri desktop workspace";
  }

  if (hasSome(["electron/main.ts", "electron/main.js", "electron/main.mjs", "electron/preload.ts"])) {
    return "Electron desktop workspace";
  }

  if (hasSome(["next.config.js", "next.config.mjs", "next.config.ts"])) {
    return "Next.js app workspace";
  }

  if (hasSome(["vite.config.ts", "vite.config.js"]) && has("package.json")) {
    return "Vite app workspace";
  }

  if (has("pyproject.toml") || has("requirements.txt")) {
    return "Python workspace";
  }

  if (has("go.mod")) {
    return "Go workspace";
  }

  if (has("package.json")) {
    return "Node workspace";
  }

  return "Generic workspace";
};

const readJsonArtifact = async (rootPath, relativePath) => {
  try {
    const absolutePath = ensureWithinRoot(rootPath, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    return {
      raw: content,
      parsed: JSON.parse(content),
    };
  } catch {
    return null;
  }
};

const normalizeGraphArtifactForHash = (value) =>
  value && typeof value === "object" && "nodes" in value && "edges" in value
    ? {
        ...value,
        scope: {
          mode: "full",
          nodeIds: [],
        },
      }
    : value;

const hashJson = (value) => {
  const text = JSON.stringify(normalizeGraphArtifactForHash(value));
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `gcg-${hash.toString(16)}`;
};

const detectCodeSignalFiles = (files) =>
  files
    .map((file) => file.path)
    .filter((filePath) => {
      if (filePath.startsWith(".graphcoding/")) {
        return false;
      }

      const extension = filePath.includes(".") ? filePath.split(".").pop()?.toLowerCase() ?? "" : "";
      const inKnownDirectory = CODE_SIGNAL_DIRECTORIES.some((prefix) => filePath.startsWith(prefix));

      if (inKnownDirectory && CODE_SIGNAL_EXTENSIONS.has(extension)) {
        return true;
      }

      return ["main.ts", "main.tsx", "index.ts", "index.tsx", "main.js", "index.js"].includes(filePath);
    });

const createResumeState = (kind, label, reason, recommendedAction, needsDecision) => ({
  kind,
  label,
  reason,
  recommendedAction,
  needsDecision,
});

const normalizeManifest = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const marker = typeof value.marker === "string" ? value.marker : null;
  const app = typeof value.app === "string" ? value.app : null;
  const formatVersion = typeof value.formatVersion === "number" ? value.formatVersion : null;
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";

  if (marker !== MANIFEST_MARKER || app !== MANIFEST_APP || formatVersion !== MANIFEST_FORMAT_VERSION || workspaceId.length === 0) {
    return null;
  }

  return {
    marker,
    app,
    formatVersion,
    workspaceId,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    lastOpenedAt: typeof value.lastOpenedAt === "string" ? value.lastOpenedAt : null,
    graphHash: typeof value.graphHash === "string" ? value.graphHash : null,
    state: typeof value.state === "string" ? value.state : null,
  };
};

const classifyManagedWorkspaceState = ({
  hasHarness,
  hasDiagram,
  hasWorkflowState,
  hasStepHistory,
  hasCodeSignals,
  graphHashMatches,
  hasWorkflowBuildEvidence,
  resumeDecision,
}) => {
  const decisionKind =
    resumeDecision && typeof resumeDecision.decisionKind === "string" ? resumeDecision.decisionKind : null;

  if (!hasHarness && !hasDiagram && !hasWorkflowState && !hasStepHistory && !hasCodeSignals) {
    return createResumeState(
      "managed-empty-workspace",
      "Managed Empty Workspace",
      "A valid Graph Coding GPT manifest exists, but no harness, graph, workflow, or code slice has been fixed yet.",
      "Continue with Harness Setup to initialize this managed workspace.",
      false,
    );
  }

  if (!hasHarness && !hasDiagram && !hasWorkflowState && hasCodeSignals) {
    if (decisionKind === "analyze-existing-code") {
      return createResumeState(
        "managed-codebase-input",
        "Managed Codebase Intake",
        "This workspace is now managed by Graph Coding GPT and keeps its existing codebase as the starting source of truth.",
        "Fix the harness, then generate the first diagram from a code-aware brief.",
        false,
      );
    }

    if (decisionKind === "initialize-fresh-workflow") {
      return createResumeState(
        "managed-fresh-codebase",
        "Managed Fresh Workflow",
        "This workspace keeps existing code files, but the saved decision says the graph workflow should restart from a fresh managed baseline here.",
        "Continue with Harness Setup, then write a new brief before generating the first diagram.",
        false,
      );
    }

    return createResumeState(
      "managed-codebase",
      "Managed Codebase Workspace",
      "A valid Graph Coding GPT manifest exists and application code is present, but no graph workflow artifacts have been fixed yet.",
      "Create or confirm the harness, then decide whether the first diagram should come from a brief or a code-aware brief.",
      false,
    );
  }

  if (hasHarness && !hasDiagram && !hasWorkflowState && !hasCodeSignals) {
    return createResumeState(
      "managed-harness-only",
      "Managed Harness Only",
      "Harness files exist inside a managed workspace, but there is no saved graph draft or workflow yet.",
      "Continue with Brief to Diagram using the current harness.",
      false,
    );
  }

  if (hasHarness && !hasDiagram && !hasWorkflowState && hasCodeSignals) {
    return createResumeState(
      "managed-harness-on-codebase",
      "Managed Harness On Codebase",
      "Harness files exist and application code is present, but no graph draft has been generated yet.",
      "Use the current harness and generate the first diagram with awareness of the existing codebase.",
      false,
    );
  }

  if (hasWorkflowState && (!hasDiagram || graphHashMatches === false)) {
    return createResumeState(
      "managed-drifted-workspace",
      "Managed Drifted Workspace",
      "This managed workspace has saved workflow state, but it no longer matches the current graph artifacts.",
      "Choose whether to trust the current graph and rebuild the workflow state, or discard the current graph workflow and restart.",
      true,
    );
  }

  if (hasDiagram && hasWorkflowState && graphHashMatches !== false) {
    return createResumeState(
      "managed-workflow-in-progress",
      "Managed Workflow In Progress",
      "A saved graph and matching workflow state were found for this managed workspace.",
      "Resume from the saved workflow state and reopen the current step context.",
      false,
    );
  }

  if (hasDiagram && !hasWorkflowState && hasCodeSignals) {
    return createResumeState(
      "managed-graph-and-code",
      "Managed Graph And Code",
      "A managed workspace already has both a saved graph and existing code, but no workflow state was restored for the next step yet.",
      "Continue from graph review and the next step preparation without asking again.",
      false,
    );
  }

  if (hasDiagram && !hasWorkflowState && !hasCodeSignals) {
    return createResumeState(
      "managed-graph-draft",
      "Managed Graph Draft",
      "A saved graph draft exists in this managed workspace, but no workflow state or generated code is present yet.",
      "Resume from graph review and approval before building any step.",
      false,
    );
  }

  return createResumeState(
    "managed-unclassified",
    "Managed Unclassified Workspace",
    "The workspace is managed by Graph Coding GPT, but its current artifact mix does not match a safe auto-resume path.",
    "Stop and choose an explicit recovery path before continuing.",
    true,
  );
};

const classifyUnmanagedWorkspaceState = ({
  hasHarness,
  hasDiagram,
  hasWorkflowState,
  hasStepHistory,
  hasResumeState,
  hasCodeSignals,
  resumeDecision,
}) => {
  const decisionKind =
    resumeDecision && typeof resumeDecision.decisionKind === "string" ? resumeDecision.decisionKind : null;
  const hasLegacyGraphArtifacts = hasHarness || hasDiagram || hasWorkflowState || hasStepHistory || hasResumeState;

  if (!hasLegacyGraphArtifacts && !hasCodeSignals) {
    return createResumeState(
      "external-empty-workspace",
      "External Empty Workspace",
      "No valid Graph Coding GPT manifest or graph workflow artifacts were found in this folder yet.",
      "Continue with Harness Setup to initialize this folder as a managed workspace.",
      false,
    );
  }

  if (hasLegacyGraphArtifacts) {
    if (decisionKind === "trust-current-graph") {
      return createResumeState(
        "legacy-graph-adoption-requested",
        "Legacy Graph Adoption Requested",
        "This folder has legacy Graph Coding GPT artifacts without a manifest, and the saved decision says the current graph should be trusted.",
        "Adopt the current graph into a managed workspace and continue from graph review.",
        false,
      );
    }

    if (decisionKind === "initialize-fresh-workflow") {
      return createResumeState(
        "legacy-fresh-workflow-requested",
        "Legacy Fresh Workflow Requested",
        "This folder has legacy artifacts without a manifest, and the saved decision says the workflow should restart from a fresh baseline.",
        "Initialize a fresh managed workflow here, then continue with Harness Setup.",
        false,
      );
    }

    if (decisionKind === "analyze-existing-code") {
      return createResumeState(
        "legacy-code-analysis-requested",
        "Legacy Code Analysis Requested",
        "This folder has legacy artifacts without a manifest, and the saved decision says the current codebase should drive the next graph draft.",
        "Adopt the folder as managed, then generate the first diagram from a code-aware brief.",
        false,
      );
    }

    return createResumeState(
      "legacy-graphcoding-artifacts",
      "Legacy Graph Coding Artifacts",
      "Graph Coding GPT artifacts were found, but this folder does not contain a valid workspace manifest yet.",
      hasCodeSignals
        ? "Choose whether to trust the saved graph, analyze the current codebase, or restart the workflow fresh."
        : "Choose whether to trust the saved graph artifacts or restart the workflow fresh.",
      true,
    );
  }

  if (hasCodeSignals) {
    if (decisionKind === "initialize-fresh-workflow") {
      return createResumeState(
        "external-fresh-workflow-requested",
        "External Fresh Workflow Requested",
        "The folder already has application code, and the saved decision says a fresh managed workflow should start here.",
        "Initialize Harness Setup and write the first brief for a new graph workflow.",
        false,
      );
    }

    if (decisionKind === "analyze-existing-code") {
      return createResumeState(
        "external-code-analysis-requested",
        "External Code Analysis Requested",
        "The folder already has application code, and the saved decision says the codebase should seed the first graph draft.",
        "Fix the harness and generate the first diagram from a code-aware brief.",
        false,
      );
    }

    return createResumeState(
      "external-codebase",
      "External Codebase",
      "This folder already contains application code, but no valid Graph Coding GPT workspace manifest was found.",
      "Choose whether to analyze the existing codebase into a graph or initialize a fresh managed workflow here.",
      true,
    );
  }

  return createResumeState(
    "external-unclassified",
    "External Unclassified Workspace",
    "The folder does not contain a valid Graph Coding GPT manifest and does not fit a safe auto-resume path.",
    "Choose how this folder should be adopted before continuing.",
    true,
  );
};

export const classifyWorkspaceResumeState = ({
  hasManifest,
  hasHarness,
  hasDiagram,
  hasWorkflowState,
  hasStepHistory,
  hasResumeState,
  hasCodeSignals,
  graphHashMatches,
  hasWorkflowBuildEvidence,
  resumeDecision,
  manifest,
}) => {
  const internalBranch = hasManifest
    ? classifyManagedWorkspaceState({
        hasHarness,
        hasDiagram,
        hasWorkflowState,
        hasStepHistory,
        hasCodeSignals,
        graphHashMatches,
        hasWorkflowBuildEvidence,
        resumeDecision,
      })
    : classifyUnmanagedWorkspaceState({
        hasHarness,
        hasDiagram,
        hasWorkflowState,
        hasStepHistory,
        hasResumeState,
        hasCodeSignals,
        resumeDecision,
      });

  const resumeBranch = hasManifest
    ? createResumeState(
        "managed-workspace",
        "Managed Workspace",
        internalBranch.reason,
        internalBranch.recommendedAction,
        internalBranch.needsDecision,
      )
    : createResumeState(
        "unmanaged-workspace",
        "Unmanaged Workspace",
        internalBranch.reason,
        internalBranch.recommendedAction,
        internalBranch.needsDecision,
      );

  return {
    hasManifest,
    manifest,
    resumeBranch,
    internalBranch,
  };
};

const buildResumeInfo = async (rootPath, files) => {
  const filePaths = new Set(files.map((file) => file.path));
  const codeSignalFiles = detectCodeSignalFiles(files);
  const manifestArtifact = filePaths.has(MANIFEST_PATH) ? await readJsonArtifact(rootPath, MANIFEST_PATH) : null;
  const diagramArtifact = filePaths.has(GRAPH_ARTIFACT_PATH) ? await readJsonArtifact(rootPath, GRAPH_ARTIFACT_PATH) : null;
  const workflowArtifact = filePaths.has(WORKFLOW_STATE_PATH) ? await readJsonArtifact(rootPath, WORKFLOW_STATE_PATH) : null;
  const resumeStateArtifact = filePaths.has(RESUME_STATE_PATH) ? await readJsonArtifact(rootPath, RESUME_STATE_PATH) : null;
  const manifest = normalizeManifest(manifestArtifact?.parsed);
  const diagramNodeCount = Array.isArray(diagramArtifact?.parsed?.nodes) ? diagramArtifact.parsed.nodes.length : 0;
  const hasDiagram = diagramNodeCount > 0;
  const workflowGraphHash =
    typeof workflowArtifact?.parsed?.graphHash === "string" && workflowArtifact.parsed.graphHash.trim().length > 0
      ? workflowArtifact.parsed.graphHash
      : null;
  const currentGraphHash = hasDiagram ? hashJson(diagramArtifact.parsed) : null;
  const graphHashMatches = workflowGraphHash && currentGraphHash ? workflowGraphHash === currentGraphHash : null;
  const hasWorkflowBuildEvidence =
    Boolean(workflowArtifact?.parsed?.lastBuildAt) || Boolean(workflowArtifact?.parsed?.lastBuildMode) || filePaths.has(STEP_HISTORY_PATH);
  const classification = classifyWorkspaceResumeState({
    hasManifest: Boolean(manifest),
    manifest,
    hasHarness: filePaths.has(".graphcoding/harness.json"),
    hasDiagram,
    hasWorkflowState: Boolean(workflowArtifact),
    hasStepHistory: filePaths.has(STEP_HISTORY_PATH),
    hasResumeState: Boolean(resumeStateArtifact),
    hasCodeSignals: codeSignalFiles.length > 0,
    graphHashMatches,
    hasWorkflowBuildEvidence,
    resumeDecision: resumeStateArtifact?.parsed ?? null,
  });

  return {
    hasManifest: Boolean(manifest),
    manifest,
    hasHarness: filePaths.has(".graphcoding/harness.json"),
    hasDiagram,
    hasWorkflowState: Boolean(workflowArtifact),
    hasStepHistory: filePaths.has(STEP_HISTORY_PATH),
    hasResumeState: Boolean(resumeStateArtifact),
    hasCodeSignals: codeSignalFiles.length > 0,
    codeSignalCount: codeSignalFiles.length,
    codeSignalFiles: codeSignalFiles.slice(0, 12),
    graphHash: currentGraphHash,
    graphHashMatches,
    hasWorkflowBuildEvidence,
    resumeDecision:
      resumeStateArtifact?.parsed && typeof resumeStateArtifact.parsed === "object"
        ? {
            decisionKind:
              typeof resumeStateArtifact.parsed.decisionKind === "string" ? resumeStateArtifact.parsed.decisionKind : null,
            branchKind: typeof resumeStateArtifact.parsed.branchKind === "string" ? resumeStateArtifact.parsed.branchKind : null,
            decidedAt: typeof resumeStateArtifact.parsed.decidedAt === "string" ? resumeStateArtifact.parsed.decidedAt : null,
          }
        : null,
    resumeBranch: classification.resumeBranch,
    internalBranch: classification.internalBranch,
  };
};

export const buildWorkspaceBootstrap = ({ rootPath, rootName, files, ignoredDirectories, symlinkEntries, resumeInfo }) => {
  const filePaths = new Set(files.map((file) => file.path));
  const projectMarkers = WORKSPACE_MARKERS.filter((marker) => filePaths.has(marker));
  const workspaceKind = detectWorkspaceKind(filePaths);
  const entryFiles = files
    .filter((file) => file.path.split("/").length <= 2)
    .slice(0, 8)
    .map((file) => file.path);
  const warnings = [];

  if (projectMarkers.length === 0) {
    warnings.push("No common project marker files were detected in the workspace root.");
  }

  if (symlinkEntries.length > 0) {
    warnings.push("Symlinked files and directories are skipped during workspace bootstrap.");
  }

  return {
    rootPath,
    rootName,
    workspaceKind,
    workspaceSummary: `${workspaceKind} · ${files.length} indexed files · ${ignoredDirectories.length} ignored directories · ${symlinkEntries.length} symlink entries skipped`,
    fileCount: files.length,
    ignoredDirectoryCount: ignoredDirectories.length,
    ignoredDirectories: ignoredDirectories.slice(0, 12),
    symlinkEntryCount: symlinkEntries.length,
    symlinkEntries: symlinkEntries.slice(0, 12),
    hasHarness: filePaths.has(".graphcoding/harness.json"),
    projectMarkers,
    entryFiles,
    warnings,
    resume: resumeInfo,
  };
};

export const readWorkspaceListing = async (inputRootPath) => {
  const requestedRoot = path.resolve(inputRootPath);
  const rootStat = await fs.lstat(requestedRoot);

  if (!rootStat.isDirectory()) {
    throw new Error("Selected path is not a directory.");
  }

  const rootPath = await fs.realpath(requestedRoot);
  const files = [];
  const ignoredDirectories = [];
  const symlinkEntries = [];

  const visit = async (currentDirectory, prefix = []) => {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = [...prefix, entry.name].join("/");

      if (entry.isSymbolicLink()) {
        symlinkEntries.push(relativePath);
        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          ignoredDirectories.push(relativePath);
          continue;
        }
        await visit(absolutePath, [...prefix, entry.name]);
        continue;
      }

      if (shouldIgnoreWorkspacePath(relativePath)) {
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

  const rootName = path.basename(rootPath);
  const resumeInfo = await buildResumeInfo(rootPath, files);

  return {
    rootPath,
    rootName,
    files,
    bootstrap: buildWorkspaceBootstrap({
      rootPath,
      rootName,
      files,
      ignoredDirectories,
      symlinkEntries,
      resumeInfo,
    }),
  };
};
