import type { HarnessArtifact, WorkspaceFile, WorkspaceTreeNode } from "./types";

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

type NativeWorkspaceEntry = {
  path: string;
  size: number;
  type: string;
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

const createVirtualFile = (path: string, content: string, type = "application/json") =>
  mapFile(new File([content], path.split("/")[path.split("/").length - 1] ?? path, { type }), path);

export const createWorkspaceFilesFromFileList = (fileList: FileList | File[]) => {
  const files = Array.from(fileList);
  if (files.length === 0) {
    return {
      rootName: "NO FOLDER OPENED",
      files: [] as WorkspaceFile[],
    };
  }

  const firstPath = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name).split("/");
  const rootName = firstPath.length > 1 ? firstPath[0] : "workspace";

  const mapped = files
    .map((file) => {
      const relative = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
        .split("/")
        .slice(firstPath.length > 1 ? 1 : 0)
        .join("/");

      return mapFile(file, relative || file.name);
    })
    .sort((left, right) => SORTER.compare(left.path, right.path));

  return { rootName, files: mapped };
};

export const createWorkspaceFilesFromNativeListing = (
  rootPath: string,
  entries: NativeWorkspaceEntry[],
) => {
  const rootName = rootPath.split("/").filter(Boolean).pop() ?? "workspace";
  const files = entries
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

export const createWorkspaceFilesFromDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const files: WorkspaceFile[] = [];

  const visit = async (directory: FileSystemDirectoryHandle, prefix: string[] = []) => {
    const entries = (directory as FileSystemDirectoryHandle & {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    }).entries();

    for await (const [, entry] of entries) {
      if (entry.kind === "directory") {
        await visit(entry as FileSystemDirectoryHandle, [...prefix, entry.name]);
        continue;
      }

      const file = await (entry as FileSystemFileHandle).getFile();
      const relativePath = [...prefix, entry.name].join("/");
      files.push(mapFile(file, relativePath));
    }
  };

  await visit(handle);
  files.sort((left, right) => SORTER.compare(left.path, right.path));
  return { rootName: handle.name, files };
};

export const mergeWorkspaceArtifacts = (existingFiles: WorkspaceFile[], artifacts: HarnessArtifact[]) => {
  const generated = artifacts.map((artifact) =>
    createVirtualFile(
      artifact.path,
      artifact.content,
      artifact.path.endsWith(".md") ? "text/markdown" : artifact.path.endsWith(".json") ? "application/json" : "text/plain",
    ),
  );

  const retained = existingFiles.filter(
    (file) => !generated.some((generatedFile) => generatedFile.path === file.path),
  );

  return [...retained, ...generated].sort((left, right) => SORTER.compare(left.path, right.path));
};

export const writeArtifactsToDirectoryHandle = async (
  rootHandle: FileSystemDirectoryHandle,
  artifacts: HarnessArtifact[],
) => {
  for (const artifact of artifacts) {
    const parts = artifact.path.split("/");
    const fileName = parts.pop();
    if (!fileName) {
      continue;
    }

    let currentDirectory = rootHandle as FileSystemDirectoryHandle & {
      getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
      getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    };

    for (const part of parts) {
      currentDirectory = (await currentDirectory.getDirectoryHandle(part, { create: true })) as typeof currentDirectory;
    }

    const fileHandle = await currentDirectory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(artifact.content);
    await writable.close();
  }
};

export const downloadArtifacts = (artifacts: HarnessArtifact[]) => {
  for (const artifact of artifacts) {
    const blob = new Blob([artifact.content], {
      type: artifact.path.endsWith(".json") ? "application/json" : artifact.path.endsWith(".md") ? "text/markdown" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.path.split("/").join("__");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
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
