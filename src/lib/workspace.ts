import type { NativeWorkspaceEntry, WorkspaceFile, WorkspaceTreeNode } from "./types";

const SORTER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
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

type MapFileOptions = {
  size?: number;
  type?: string;
  source?: "browser" | "native";
  rootPath?: string;
};

const IGNORED_DIRECTORY_NAMES = new Set([
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

const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

const shouldIgnoreRelativePath = (relativePath: string) => {
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

const mapFile = (file: File, path: string, options: MapFileOptions = {}): WorkspaceFile => ({
  id: crypto.randomUUID(),
  path,
  name: path.split("/")[path.split("/").length - 1] ?? path,
  parts: path.split("/"),
  size: options.size ?? file.size,
  type: options.type ?? file.type,
  file,
  source: options.source ?? "browser",
  rootPath: options.rootPath,
});

export const createWorkspaceFilesFromNativeListing = (
  rootPath: string,
  entries: NativeWorkspaceEntry[],
) => {
  const rootName = rootPath.split("/").filter(Boolean).pop() ?? "workspace";
  const files = entries
    .filter((entry) => !shouldIgnoreRelativePath(entry.path))
    .map((entry) =>
      mapFile(new File([], entry.path.split("/").pop() ?? entry.path, { type: entry.type }), entry.path, {
        size: entry.size,
        type: entry.type,
        source: "native",
        rootPath,
      }),
    )
    .sort((left, right) => SORTER.compare(left.path, right.path));

  return { rootName, files };
};

export const buildWorkspaceTree = (files: WorkspaceFile[]): WorkspaceTreeNode[] => {
  const roots: WorkspaceTreeNode[] = [];
  const folderIndex = new Map<string, WorkspaceTreeNode>();

  for (const file of files) {
    let currentLevel = roots;
    let folderPath = "";

    for (let index = 0; index < file.parts.length; index += 1) {
      const part = file.parts[index];
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      const isLeaf = index === file.parts.length - 1;

      if (isLeaf) {
        currentLevel.push({
          id: `file:${file.path}`,
          name: part,
          path: file.path,
          kind: "file",
          children: [],
          file,
        });
        continue;
      }

      let folder = folderIndex.get(folderPath);
      if (!folder) {
        folder = {
          id: `folder:${folderPath}`,
          name: part,
          path: folderPath,
          kind: "folder",
          children: [],
        };
        folderIndex.set(folderPath, folder);
        currentLevel.push(folder);
      }

      currentLevel = folder.children;
    }
  }

  const sortTree = (nodes: WorkspaceTreeNode[]): WorkspaceTreeNode[] =>
    nodes
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "folder" ? -1 : 1;
        }
        return SORTER.compare(left.name, right.name);
      })
      .map((node) =>
        node.kind === "folder"
          ? {
              ...node,
              children: sortTree(node.children),
            }
          : node,
      );

  return sortTree(roots);
};

export const readWorkspaceFilePreview = async (workspaceFile: WorkspaceFile) => {
  const segments = workspaceFile.name.split(".");
  const extension = workspaceFile.name.includes(".") ? segments[segments.length - 1]?.toLowerCase() ?? "" : "";
  const isTextLike =
    workspaceFile.type.startsWith("text/") ||
    workspaceFile.type.includes("json") ||
    workspaceFile.type.includes("javascript") ||
    workspaceFile.type.includes("typescript") ||
    TEXT_EXTENSIONS.has(extension);

  if (!isTextLike) {
    return `Binary or non-text file preview is not available.\n\nPath: ${workspaceFile.path}\nSize: ${workspaceFile.size} bytes`;
  }

  const text = await readWorkspaceFileText(workspaceFile);
  if (text.length > 200_000) {
    return `${text.slice(0, 200_000)}\n\n... truncated preview (${text.length} characters total)`;
  }

  return text;
};

export const readWorkspaceFileText = async (workspaceFile: WorkspaceFile) => {
  if (workspaceFile.source !== "native" || !workspaceFile.rootPath) {
    return workspaceFile.file.text();
  }

  const response = await fetch("/api/workspace/read-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rootPath: workspaceFile.rootPath,
      path: workspaceFile.path,
    }),
  });

  const data = (await response.json()) as { ok?: boolean; content?: string; error?: string };
  if (!response.ok || !data.ok || typeof data.content !== "string") {
    throw new Error(data.error || `Unable to read ${workspaceFile.path}`);
  }

  return data.content;
};
