import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

export const CURRENT_STEP_CONTRACT_RELATIVE_PATH = ".graphcoding/current-step-contract.json";

const IGNORED_DIRS = new Set([
  ".git",
  ".graphcoding",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "generated",
  ".tmp",
]);

const PACKAGE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

const ROUTING_PATTERNS = [
  /^src\/routes\//,
  /^src\/router\//,
  /^src\/pages\//,
  /^pages\//,
  /^app\//,
  /route\.[jt]sx?$/,
  /layout\.[jt]sx?$/,
];

const SCREEN_PATH_PATTERNS = [/screen/i, /page/i, /route/i, /dashboard/i, /panel/i, /view/i];

const hashText = (value) => createHash("sha1").update(value).digest("hex");

const normalizeRelativePath = (rootPath, absolutePath) =>
  path.relative(rootPath, absolutePath).split(path.sep).join("/");

const shouldIgnorePath = (relativePath) => {
  const segments = relativePath.split("/");
  return segments.some((segment) => IGNORED_DIRS.has(segment));
};

const walkFiles = async (rootPath, currentPath = rootPath, files = []) => {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = normalizeRelativePath(rootPath, absolutePath);

    if (!relativePath || shouldIgnorePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFiles(rootPath, absolutePath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({ absolutePath, relativePath });
  }

  return files;
};

export const captureWorkspaceSnapshot = async (rootPath) => {
  const files = await walkFiles(rootPath);
  const entries = {};

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath);
    entries[file.relativePath] = {
      hash: hashText(content),
      size: content.length,
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    entries,
  };
};

export const buildSelectionStepContract = ({ selectedNodeId, selectedNodeTitle, selectedNodeShape, requiredBoundaries, outOfScope }) => {
  const shapeBudgets = {
    startEnd: 6,
    input: 6,
    event: 6,
    state: 6,
    decision: 7,
    queue: 7,
    process: 8,
    service: 8,
    api: 8,
    database: 8,
    auth: 8,
    external: 8,
    screen: 9,
  };

  const outOfScopeTitles = Array.isArray(outOfScope)
    ? outOfScope.map((entry) => String(entry).split(":")[0].trim()).filter(Boolean)
    : [];

  const derivedForbiddenKeywords = outOfScopeTitles
    .flatMap((title) => title.split(/[\s/,_-]+/))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);

  const genericForbiddenKeywords =
    selectedNodeShape === "startEnd"
      ? ["watchlist", "chart", "history", "alert", "notification", "settings", "admin", "manage"]
      : selectedNodeShape === "process" || selectedNodeShape === "service" || selectedNodeShape === "api" || selectedNodeShape === "database"
        ? ["dashboard", "page", "screen", "panel"]
        : [];

  return {
    version: 1,
    mode: "selection",
    selectedNodeId,
    selectedNodeTitle,
    selectedNodeShape,
    requiredBoundaries: Array.isArray(requiredBoundaries) ? requiredBoundaries : [],
    outOfScope: Array.isArray(outOfScope) ? outOfScope : [],
    maxTouchedFiles: shapeBudgets[selectedNodeShape] ?? 8,
    allowPackageJsonChanges: false,
    allowLockfileChanges: false,
    allowRoutingChanges: selectedNodeShape === "screen",
    allowedTestTargets: [selectedNodeId, selectedNodeTitle, "launch", "smoke", "app"],
    forbiddenFeatureKeywords: Array.from(new Set([...genericForbiddenKeywords, ...derivedForbiddenKeywords])),
  };
};

export const writeSelectionStepContract = async ({ rootPath, contract }) => {
  const absolutePath = path.join(rootPath, CURRENT_STEP_CONTRACT_RELATIVE_PATH);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(contract, null, 2)}\n`);
  return absolutePath;
};

const diffSnapshots = (beforeSnapshot, afterSnapshot) => {
  const beforeEntries = beforeSnapshot.entries;
  const afterEntries = afterSnapshot.entries;
  const beforePaths = new Set(Object.keys(beforeEntries));
  const afterPaths = new Set(Object.keys(afterEntries));

  const createdFiles = [...afterPaths].filter((filePath) => !beforePaths.has(filePath)).sort();
  const deletedFiles = [...beforePaths].filter((filePath) => !afterPaths.has(filePath)).sort();
  const modifiedFiles = [...afterPaths]
    .filter((filePath) => beforePaths.has(filePath) && beforeEntries[filePath].hash !== afterEntries[filePath].hash)
    .sort();

  const touchedFiles = Array.from(new Set([...createdFiles, ...modifiedFiles, ...deletedFiles])).sort();
  return {
    createdFiles,
    modifiedFiles,
    deletedFiles,
    touchedFiles,
  };
};

const readTouchedFileContents = async (rootPath, filePaths) => {
  const records = [];
  for (const relativePath of filePaths) {
    const absolutePath = path.join(rootPath, relativePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      records.push({
        relativePath,
        content: content.slice(0, 12000),
      });
    } catch {
      // ignore deleted files
    }
  }
  return records;
};

const matchesRoutingPath = (relativePath) => ROUTING_PATTERNS.some((pattern) => pattern.test(relativePath));
const matchesScreenPath = (relativePath) => SCREEN_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));

export const verifySelectionBuildScope = async ({ rootPath, beforeSnapshot, contract }) => {
  const afterSnapshot = await captureWorkspaceSnapshot(rootPath);
  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  const violations = [];

  if (diff.touchedFiles.length > contract.maxTouchedFiles) {
    violations.push(`Touched files ${diff.touchedFiles.length} exceed the allowed maximum ${contract.maxTouchedFiles}.`);
  }

  if (!contract.allowPackageJsonChanges) {
    const packageHits = diff.touchedFiles.filter((filePath) => PACKAGE_FILES.has(path.basename(filePath)));
    if (packageHits.length > 0) {
      violations.push(`Package manager files are out of scope for this step: ${packageHits.join(", ")}.`);
    }
  }

  if (!contract.allowRoutingChanges) {
    const routingHits = diff.touchedFiles.filter((filePath) => matchesRoutingPath(filePath));
    if (routingHits.length > 0) {
      violations.push(`Routing files are out of scope for this step: ${routingHits.join(", ")}.`);
    }
  }

  if (contract.selectedNodeShape !== "screen") {
    const screenHits = diff.createdFiles.filter((filePath) => matchesScreenPath(filePath));
    if (screenHits.length > 0) {
      violations.push(`New screen-like files are out of scope for ${contract.selectedNodeShape}: ${screenHits.join(", ")}.`);
    }
  }

  const keywordHits = [];
  const touchedContents = await readTouchedFileContents(rootPath, [...diff.createdFiles, ...diff.modifiedFiles]);
  const normalizedKeywords = Array.isArray(contract.forbiddenFeatureKeywords)
    ? contract.forbiddenFeatureKeywords.map((keyword) => String(keyword).toLowerCase()).filter(Boolean)
    : [];
  for (const record of touchedContents) {
    const lowerPath = record.relativePath.toLowerCase();
    const lowerContent = record.content.toLowerCase();
    for (const keyword of normalizedKeywords) {
      if (lowerPath.includes(keyword) || lowerContent.includes(keyword)) {
        keywordHits.push(`${keyword} -> ${record.relativePath}`);
      }
    }
  }
  if (keywordHits.length > 0) {
    violations.push(`Out-of-scope feature keywords were touched: ${keywordHits.slice(0, 8).join(", ")}.`);
  }

  return {
    ok: violations.length === 0,
    diff,
    violations,
    afterSnapshot,
  };
};
