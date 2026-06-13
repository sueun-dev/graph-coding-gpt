import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkspaceTree,
  createWorkspaceFilesFromFileList,
  createWorkspaceFilesFromNativeListing,
  mergeWorkspaceArtifacts,
  readWorkspaceFilePreview,
  readWorkspaceFileText,
} from "../src/lib/workspace";
import type { HarnessArtifact, WorkspaceFile } from "../src/lib/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// jsdom's File/Blob polyfill does not implement Blob.text() / arrayBuffer(),
// which a real browser (and the source under test) relies on. textFile() returns
// a jsdom File whose text() resolves to the known content, faithfully matching
// browser File.text() behavior so the tests stay deterministic and offline.
const textFile = (name: string, content: string, type = ""): File => {
  const file = new File([content], name, type ? { type } : undefined);
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", {
      value: async () => content,
      configurable: true,
    });
  }
  return file;
};

// Build a File with a webkitRelativePath, mimicking what <input webkitdirectory>
// hands the browser. The native File constructor does not let us set
// webkitRelativePath, so we attach it as an own property.
const dirFile = (relativePath: string, content = ""): File => {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = textFile(name, content);
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
};

describe("createWorkspaceFilesFromFileList", () => {
  it("returns the empty sentinel for an empty list", () => {
    const result = createWorkspaceFilesFromFileList([]);
    expect(result.rootName).toBe("NO FOLDER OPENED");
    expect(result.files).toEqual([]);
  });

  it("strips the common root segment and sorts naturally", () => {
    const result = createWorkspaceFilesFromFileList([
      dirFile("proj/src/z.ts"),
      dirFile("proj/src/a.ts"),
      dirFile("proj/README.md"),
    ]);
    expect(result.rootName).toBe("proj");
    expect(result.files.map((f) => f.path)).toEqual(["README.md", "src/a.ts", "src/z.ts"]);
  });

  it("excludes files under skipped directories (node_modules, .git, dist)", () => {
    const result = createWorkspaceFilesFromFileList([
      dirFile("proj/src/app.ts"),
      dirFile("proj/node_modules/lib/index.js"),
      dirFile("proj/.git/config"),
      dirFile("proj/dist/bundle.js"),
    ]);
    expect(result.files.map((f) => f.path)).toEqual(["src/app.ts"]);
  });

  it("uses 'workspace' as root when files have no folder prefix", () => {
    const flat = new File([""], "loose.txt"); // no webkitRelativePath
    const result = createWorkspaceFilesFromFileList([flat]);
    expect(result.rootName).toBe("workspace");
    expect(result.files[0].path).toBe("loose.txt");
  });

  it("populates parts/name/source for each mapped file", () => {
    const result = createWorkspaceFilesFromFileList([dirFile("proj/src/deep/file.ts")]);
    const file = result.files[0];
    expect(file.path).toBe("src/deep/file.ts");
    expect(file.name).toBe("file.ts");
    expect(file.parts).toEqual(["src", "deep", "file.ts"]);
    expect(file.source).toBe("browser");
  });
});

describe("createWorkspaceFilesFromNativeListing", () => {
  it("maps entries with size/type and marks them native", () => {
    const { rootName, files } = createWorkspaceFilesFromNativeListing("/Users/me/proj", [
      { path: "src/b.ts", size: 10, type: "application/typescript" },
      { path: "src/a.ts", size: 20, type: "application/typescript" },
    ]);
    expect(rootName).toBe("proj");
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0]).toMatchObject({
      size: 20,
      source: "native",
      rootPath: "/Users/me/proj",
    });
  });

  it("falls back to 'workspace' when rootPath has no trailing segment", () => {
    const { rootName } = createWorkspaceFilesFromNativeListing("/", []);
    expect(rootName).toBe("workspace");
  });
});

describe("mergeWorkspaceArtifacts", () => {
  const existing: WorkspaceFile[] = createWorkspaceFilesFromNativeListing("/p", [
    { path: "src/keep.ts", size: 1, type: "text/plain" },
    { path: ".graphcoding/harness.json", size: 1, type: "application/json" },
  ]).files;

  const artifacts: HarnessArtifact[] = [
    { path: ".graphcoding/harness.json", content: "{\"new\":true}" },
    { path: ".graphcoding/profile.md", content: "# Profile" },
  ];

  it("replaces files that collide with a generated artifact path", () => {
    const merged = mergeWorkspaceArtifacts(existing, artifacts);
    const harness = merged.find((f) => f.path === ".graphcoding/harness.json")!;
    // There should be exactly one harness.json — the generated one wins.
    expect(merged.filter((f) => f.path === ".graphcoding/harness.json")).toHaveLength(1);
    expect(harness.source).toBe("browser"); // virtual file
  });

  it("retains non-colliding existing files and adds new artifacts, sorted", () => {
    const merged = mergeWorkspaceArtifacts(existing, artifacts);
    const paths = merged.map((f) => f.path);
    expect(paths).toContain("src/keep.ts");
    expect(paths).toContain(".graphcoding/profile.md");
    // sorted by natural collator
    expect([...paths]).toEqual(paths.slice().sort((a, b) => a.localeCompare(b)));
  });

  it("infers mime type from artifact extension", async () => {
    const merged = mergeWorkspaceArtifacts([], [
      { path: "a.md", content: "x" },
      { path: "b.json", content: "{}" },
      { path: "c.weird", content: "x" },
    ]);
    expect(merged.find((f) => f.path === "a.md")!.file.type).toBe("text/markdown");
    expect(merged.find((f) => f.path === "b.json")!.file.type).toBe("application/json");
    expect(merged.find((f) => f.path === "c.weird")!.file.type).toBe("text/plain");
  });
});

describe("buildWorkspaceTree", () => {
  const filesFrom = (paths: string[]): WorkspaceFile[] =>
    paths.map(
      (p) =>
        ({
          id: p,
          path: p,
          name: p.split("/").pop() ?? p,
          parts: p.split("/"),
          size: 0,
          type: "",
          file: new File([], p),
        }) as WorkspaceFile,
    );

  it("nests files under folder nodes", () => {
    const tree = buildWorkspaceTree(filesFrom(["src/a.ts", "src/sub/b.ts", "README.md"]));
    const src = tree.find((n) => n.name === "src")!;
    expect(src.kind).toBe("folder");
    expect(src.children.map((c) => c.name)).toEqual(["sub", "a.ts"]); // folders before files
    const sub = src.children.find((c) => c.name === "sub")!;
    expect(sub.children[0].name).toBe("b.ts");
    expect(sub.children[0].kind).toBe("file");
  });

  it("sorts folders before files and names naturally within a level", () => {
    const tree = buildWorkspaceTree(filesFrom(["z.ts", "a.ts", "dir/x.ts"]));
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "folder:dir",
      "file:a.ts",
      "file:z.ts",
    ]);
  });

  it("reuses one folder node for multiple files in the same directory", () => {
    const tree = buildWorkspaceTree(filesFrom(["src/a.ts", "src/b.ts"]));
    const srcNodes = tree.filter((n) => n.name === "src");
    expect(srcNodes).toHaveLength(1);
    expect(srcNodes[0].children).toHaveLength(2);
  });

  it("returns an empty array for no files", () => {
    expect(buildWorkspaceTree([])).toEqual([]);
  });

  it("tags leaf file nodes with id prefix file: and folder nodes with folder:", () => {
    const tree = buildWorkspaceTree(filesFrom(["src/a.ts"]));
    expect(tree[0].id).toBe("folder:src");
    expect(tree[0].children[0].id).toBe("file:src/a.ts");
  });
});

describe("readWorkspaceFileText", () => {
  const browserFile: WorkspaceFile = {
    id: "1",
    path: "a.ts",
    name: "a.ts",
    parts: ["a.ts"],
    size: 5,
    type: "application/typescript",
    file: textFile("a.ts", "hello"),
    source: "browser",
  };

  it("reads a browser file directly from the File object (no network)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const text = await readWorkspaceFileText(browserFile);
    expect(text).toBe("hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches native files through the bridge endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, content: "native body" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const nativeFile: WorkspaceFile = {
      ...browserFile,
      source: "native",
      rootPath: "/Users/me/proj",
    };
    const text = await readWorkspaceFileText(nativeFile);
    expect(text).toBe("native body");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspace/read-file",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ rootPath: "/Users/me/proj", path: "a.ts" });
  });

  it("throws a descriptive error when the bridge reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, error: "permission denied" }),
      }),
    );
    const nativeFile: WorkspaceFile = {
      ...browserFile,
      source: "native",
      rootPath: "/Users/me/proj",
    };
    await expect(readWorkspaceFileText(nativeFile)).rejects.toThrow("permission denied");
  });

  it("falls back to direct read when native file lacks a rootPath", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const orphan: WorkspaceFile = { ...browserFile, source: "native", rootPath: undefined };
    expect(await readWorkspaceFileText(orphan)).toBe("hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("readWorkspaceFilePreview", () => {
  const makeFile = (name: string, type: string, content: string): WorkspaceFile => ({
    id: name,
    path: name,
    name,
    parts: name.split("/"),
    size: content.length,
    type,
    file: textFile(name, content, type),
    source: "browser",
  });

  it("returns text content for text-like files", async () => {
    expect(await readWorkspaceFilePreview(makeFile("a.ts", "", "const x = 1;"))).toBe("const x = 1;");
  });

  it("recognizes text by mime type even without a known extension", async () => {
    expect(await readWorkspaceFilePreview(makeFile("LICENSE", "text/plain", "MIT"))).toBe("MIT");
  });

  it("returns a placeholder for binary files", async () => {
    const preview = await readWorkspaceFilePreview(makeFile("logo.png", "image/png", "\x89PNG"));
    expect(preview).toContain("Binary or non-text file preview is not available.");
    expect(preview).toContain("Path: logo.png");
  });

  it("truncates very large text previews to the first 200k chars plus a notice", async () => {
    const big = "a".repeat(200_001);
    const preview = await readWorkspaceFilePreview(makeFile("big.txt", "text/plain", big));
    // Only the first 200_000 chars of the body survive; the original tail is dropped.
    expect(preview.startsWith("a".repeat(200_000))).toBe(true);
    expect(preview).toContain("... truncated preview (200001 characters total)");
    // The retained body is shorter than the original even though the notice is appended.
    const bodyBeforeNotice = preview.split("\n\n... truncated")[0];
    expect(bodyBeforeNotice.length).toBe(200_000);
  });

  it("does not truncate text at exactly the 200k boundary", async () => {
    const exact = "b".repeat(200_000);
    const preview = await readWorkspaceFilePreview(makeFile("edge.txt", "text/plain", exact));
    expect(preview).toBe(exact);
    expect(preview).not.toContain("truncated preview");
  });
});
