import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import BottomPanel from "./components/BottomPanel";
import DiagramNodeRenderer from "./components/DiagramNode";
import ExplorerPanel from "./components/ExplorerPanel";
import InspectorPanel from "./components/InspectorPanel";
import RunPanel from "./components/RunPanel";
import WorkspaceSetupModal from "./components/WorkspaceSetupModal";
import { buildDiagramDocument, createEdge, createFlowFromBlueprint, createInitialFlow, createNode } from "./lib/diagram";
import {
  buildHarnessArtifacts,
  findWorkspaceHarnessFile,
  inferHarnessPreset,
  tryParseHarnessConfig,
} from "./lib/harness";
import type {
  BuildResponse,
  DiagramEdge,
  DiagramGenerationResponse,
  DiagramNode as DiagramNodeType,
  EditorTab,
  HarnessConfig,
  HarnessPresetId,
  ShapeType,
  SpecResponse,
  WorkspaceFile,
} from "./lib/types";
import {
  buildWorkspaceTree,
  createWorkspaceFilesFromNativeListing,
  createWorkspaceFilesFromDirectoryHandle,
  createWorkspaceFilesFromFileList,
  downloadArtifacts,
  mergeWorkspaceArtifacts,
  readWorkspaceFileText,
  readWorkspaceFilePreview,
  writeArtifactsToDirectoryHandle,
} from "./lib/workspace";

const initialFlow = createInitialFlow();
const DIAGRAM_STORAGE_PREFIX = "graph-coding-gpt.prototype.v2";
const LEGACY_DIAGRAM_STORAGE_KEY = "graph-coding-gpt.prototype";
const BRIEF_STORAGE_PREFIX = "graph-coding-gpt.brief.v1";

const nodeTypes = {
  diagram: DiagramNodeRenderer,
};

type AuthStatus = {
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  detail: string;
};

type AuxPanel = "ai" | "inspector";
type DirectoryWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  };
type WorkspaceMode = "none" | "directory" | "imported" | "native";

const baseTabs: EditorTab[] = [
  { id: "diagram", label: "diagram.canvas", kind: "diagram", closeable: false },
  { id: "graph", label: "diagram.graph.json", kind: "graph", closeable: false },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [result, setResult] = useState<SpecResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [diagramBrief, setDiagramBrief] = useState("");
  const [diagramResult, setDiagramResult] = useState<DiagramGenerationResponse | null>(null);
  const [diagramError, setDiagramError] = useState("");
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [lastSpecMode, setLastSpecMode] = useState<"full" | "selection" | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResponse | null>(null);
  const [buildError, setBuildError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("NO FOLDER OPENED");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [openedFiles, setOpenedFiles] = useState<WorkspaceFile[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [workspaceHandle, setWorkspaceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("none");
  const [harnessConfig, setHarnessConfig] = useState<HarnessConfig | null>(null);
  const [suggestedPreset, setSuggestedPreset] = useState<HarnessPresetId>("agent-tool");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [manualPathLoading, setManualPathLoading] = useState(false);
  const [activeEditor, setActiveEditor] = useState<string>("diagram");
  const [activeAuxPanel, setActiveAuxPanel] = useState<AuxPanel>("ai");
  const flow = useReactFlow();
  const setupPromptedKeyRef = useRef("");
  const diagramRequestIdRef = useRef(0);
  const [diagramHydrated, setDiagramHydrated] = useState(false);

  useEffect(() => {
    const loadAuth = async () => {
      const response = await fetch("/api/auth/status");
      const data = await response.json();
      setAuth(data);
    };

    void loadAuth();
  }, []);

  useEffect(() => {
    if (selectedNodesLength(nodes) > 0 || edges.some((edge) => edge.selected)) {
      setActiveAuxPanel("inspector");
    }
  }, [edges, nodes]);

  useEffect(() => {
    const key = `${workspaceName}:${workspaceFiles.length}`;
    if (workspaceFiles.length > 0 && !harnessConfig && setupPromptedKeyRef.current !== key) {
      setupPromptedKeyRef.current = key;
      setIsSetupOpen(true);
    }
  }, [harnessConfig, workspaceFiles, workspaceName]);

  const diagramStorageKey = useMemo(() => {
    if (workspaceRootPath) {
      return `${DIAGRAM_STORAGE_PREFIX}:native:${workspaceRootPath}`;
    }

    if (workspaceFiles.length > 0 && workspaceName !== "NO FOLDER OPENED") {
      return `${DIAGRAM_STORAGE_PREFIX}:workspace:${workspaceName}`;
    }

    return null;
  }, [workspaceFiles.length, workspaceName, workspaceRootPath]);

  const briefStorageKey = useMemo(() => {
    if (workspaceRootPath) {
      return `${BRIEF_STORAGE_PREFIX}:native:${workspaceRootPath}`;
    }

    if (workspaceFiles.length > 0 && workspaceName !== "NO FOLDER OPENED") {
      return `${BRIEF_STORAGE_PREFIX}:workspace:${workspaceName}`;
    }

    return `${BRIEF_STORAGE_PREFIX}:global`;
  }, [workspaceFiles.length, workspaceName, workspaceRootPath]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_DIAGRAM_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const storedBrief = localStorage.getItem(briefStorageKey);
    setDiagramBrief(storedBrief ?? "");
  }, [briefStorageKey]);

  useEffect(() => {
    setDiagramHydrated(false);

    const fresh = createInitialFlow();
    if (!diagramStorageKey) {
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setDiagramHydrated(true);
      return;
    }

    const raw = localStorage.getItem(diagramStorageKey);
    if (!raw) {
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setDiagramHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { nodes: DiagramNodeType[]; edges: DiagramEdge[] };
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
    } catch {
      localStorage.removeItem(diagramStorageKey);
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
    } finally {
      setDiagramHydrated(true);
    }
  }, [diagramStorageKey, setEdges, setNodes]);

  useEffect(() => {
    if (!diagramHydrated || !diagramStorageKey) {
      return;
    }

    localStorage.setItem(
      diagramStorageKey,
      JSON.stringify({
        nodes,
        edges,
      }),
    );
  }, [diagramHydrated, diagramStorageKey, edges, nodes]);

  useEffect(() => {
    if (!briefStorageKey) {
      return;
    }

    const nextValue = diagramBrief.trim();
    if (!nextValue) {
      localStorage.removeItem(briefStorageKey);
      return;
    }

    localStorage.setItem(briefStorageKey, diagramBrief);
  }, [briefStorageKey, diagramBrief]);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const selectedNode = selectedNodes[0] ?? null;
  const selectedEdge = selectedEdges[0] ?? null;
  const diagram = buildDiagramDocument(
    nodes,
    edges,
    selectedNodes.map((node) => node.id),
  );
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceFiles), [workspaceFiles]);

  const editorTabs = useMemo<EditorTab[]>(() => {
    const tabs = [...baseTabs];
    if (harnessConfig) {
      tabs.push({ id: "harness", label: ".graphcoding/harness.json", kind: "harness", closeable: false });
    }
    if (result) {
      tabs.push(
        { id: "spec", label: "specification.md", kind: "spec", closeable: false },
        { id: "buildPrompt", label: "build.prompt", kind: "buildPrompt", closeable: false },
        { id: "iterationPrompt", label: "iteration.prompt", kind: "iterationPrompt", closeable: false },
      );
    }

    for (const file of openedFiles) {
      tabs.push({
        id: `file:${file.path}`,
        label: file.name,
        kind: "file",
        closeable: true,
        path: file.path,
      });
    }

    return tabs;
  }, [harnessConfig, openedFiles, result]);

  const addNodeOfType = (shape: ShapeType) => {
    setNodes((current) => [...current, createNode(shape, current.length)]);
    setActiveEditor("diagram");
    setDiagramResult(null);
  };

  const resetFlow = () => {
    const fresh = createInitialFlow();
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setResult(null);
    setLastSpecMode(null);
    setError("");
    setBuildResult(null);
    setBuildError("");
    setDiagramResult(null);
    setDiagramError("");
    setActiveEditor("diagram");
    if (diagramStorageKey) {
      localStorage.removeItem(diagramStorageKey);
    }
  };

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    setEdges((current) => addEdge(createEdge(connection.source, connection.target, "새 흐름"), current));
  };

  const updateNodeField = (field: string, value: string) => {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                [field]: value,
              },
            }
          : node,
      ),
    );
  };

  const updateEdgeField = (field: string, value: string | boolean) => {
    if (!selectedEdge) {
      return;
    }

    setEdges((current) =>
      current.map((edge) => {
        if (edge.id !== selectedEdge.id) {
          return edge;
        }

        const data = {
          relation: edge.data?.relation ?? "",
          notes: edge.data?.notes ?? "",
          lineStyle: edge.data?.lineStyle ?? "smoothstep",
          animated: edge.data?.animated ?? false,
          [field]: value,
        };

        return {
          ...edge,
          label: data.relation,
          type: data.lineStyle,
          animated: data.animated,
          data,
        };
      }),
    );
  };

  const inspectHarnessInWorkspace = async (files: WorkspaceFile[]) => {
    const harnessFile = findWorkspaceHarnessFile(files);
    const inferredPreset = inferHarnessPreset(files);
    setSuggestedPreset(inferredPreset);

    if (!harnessFile) {
      setHarnessConfig(null);
      return null;
    }

    const content = await readWorkspaceFileText(harnessFile);
    const parsed = tryParseHarnessConfig(content);
    setHarnessConfig(parsed);
    return parsed;
  };

  const loadWorkspace = async (
    name: string,
    files: WorkspaceFile[],
    mode: WorkspaceMode,
    handle: FileSystemDirectoryHandle | null,
    rootPath: string | null,
  ) => {
    await inspectHarnessInWorkspace(files);
    setWorkspaceName(name || "workspace");
    setWorkspaceFiles(files);
    setWorkspaceHandle(handle);
    setWorkspaceRootPath(rootPath);
    setWorkspaceMode(mode);
    setResult(null);
    setLastSpecMode(null);
    setError("");
    setBuildResult(null);
    setBuildError("");
    setDiagramResult(null);
    setDiagramError("");
    setActiveEditor("diagram");
    setWorkspaceNotice("");
  };

  const reloadNativeWorkspace = async (rootPath: string) => {
    const response = await fetch("/api/workspace/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: rootPath }),
    });

    const data = (await response.json()) as {
      ok?: boolean;
      rootPath?: string;
      rootName?: string;
      files?: Array<{ path: string; size: number; type: string }>;
      error?: string;
    };

    if (!response.ok || !data.ok || !data.rootPath || !Array.isArray(data.files)) {
      throw new Error(data.error || "워크스페이스를 다시 불러오지 못했습니다.");
    }

    const loaded = createWorkspaceFilesFromNativeListing(data.rootPath, data.files);
    await loadWorkspace(data.rootName || loaded.rootName, loaded.files, "native", null, data.rootPath);
  };

  const handleOpenFolderByPath = async (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      setWorkspaceNotice("경로를 입력해주세요.");
      return;
    }

    setManualPathLoading(true);
    setWorkspaceNotice(`Opening ${trimmed} ...`);
    try {
      await reloadNativeWorkspace(trimmed);
      setWorkspaceNotice(`Opened ${trimmed}`);
      setManualPath("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "경로를 열지 못했습니다.";
      setWorkspaceNotice(message);
    } finally {
      setManualPathLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    setWorkspaceNotice("Opening native folder dialog...");

    try {
      const response = await fetch("/api/workspace/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        rootPath?: string;
        rootName?: string;
        files?: Array<{ path: string; size: number; type: string }>;
        error?: string;
      };

      if (!response.ok || !data.ok || !data.rootPath || !Array.isArray(data.files)) {
        throw new Error(data.error || "네이티브 폴더를 열지 못했습니다.");
      }

      const loaded = createWorkspaceFilesFromNativeListing(data.rootPath, data.files);
      await loadWorkspace(data.rootName || loaded.rootName, loaded.files, "native", null, data.rootPath);
      setWorkspaceNotice(`Opened ${data.rootPath}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "네이티브 폴더를 열지 못했습니다.";
      setWorkspaceNotice(`${message} Import로 브라우저 폴더 로드를 시도할 수 있습니다.`);
    }
  };

  const handleConnectWorkspace = () => {
    const hostWindow = window as DirectoryWindow;
    if (!hostWindow.showDirectoryPicker || !window.isSecureContext) {
      setWorkspaceNotice("Native workspace connection is unavailable here. Use Open Folder for import mode.");
      return;
    }

    void hostWindow
      .showDirectoryPicker({ mode: "read" })
      .then(async (handle) => {
        const loaded = await createWorkspaceFilesFromDirectoryHandle(handle);
        await loadWorkspace(loaded.rootName, loaded.files, "directory", handle, null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        const detail = error instanceof Error ? error.message : "unknown error";
        setWorkspaceNotice(`Native workspace connection failed. Use Open Folder instead. (${detail})`);
      });
  };

  const handleFolderInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const loaded = createWorkspaceFilesFromFileList(files);
    void loadWorkspace(loaded.rootName, loaded.files, "imported", null, null);
    event.target.value = "";
  };

  const handleSelectWorkspaceFile = async (file: WorkspaceFile) => {
    setOpenedFiles((current) => (current.some((entry) => entry.path === file.path) ? current : [...current, file]));
    setActiveEditor(`file:${file.path}`);

    if (filePreviews[file.path]) {
      return;
    }

    setFilePreviews((current) => ({
      ...current,
      [file.path]: "Loading preview...",
    }));

    const preview = await readWorkspaceFilePreview(file);
    setFilePreviews((current) => ({
      ...current,
      [file.path]: preview,
    }));
  };

  const closeEditor = (tabId: string) => {
    if (!tabId.startsWith("file:")) {
      return;
    }

    const path = tabId.replace(/^file:/, "");
    setOpenedFiles((current) => current.filter((file) => file.path !== path));
    if (activeEditor === tabId) {
      setActiveEditor("diagram");
    }
  };

  const generateSpec = async (mode: "full" | "selection") => {
    setLoading(true);
    setError("");
    setActiveAuxPanel("ai");

    try {
      const response = await fetch("/api/ai/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagram,
          requestedMode: mode,
          harness: harnessConfig,
        }),
      });

      const data = (await response.json()) as SpecResponse & { message?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "스펙 생성에 실패했습니다.");
      }

      setResult(data);
      setLastSpecMode(mode);
      setBuildResult(null);
      setBuildError("");
      setActiveEditor("spec");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "스펙 생성에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const generateDiagramFromBrief = async (strategy: "replace" | "augment") => {
    const trimmedBrief = diagramBrief.trim();
    if (!trimmedBrief) {
      setDiagramError("먼저 만들고 싶은 앱이나 흐름을 텍스트로 적어야 합니다.");
      setActiveAuxPanel("ai");
      return;
    }

    const requestId = diagramRequestIdRef.current + 1;
    diagramRequestIdRef.current = requestId;
    setDiagramLoading(true);
    setDiagramError("");
    setDiagramResult(null);
    setResult(null);
    setActiveAuxPanel("ai");

    try {
      const response = await fetch("/api/ai/diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: trimmedBrief,
          strategy,
          harness: harnessConfig,
          diagram,
        }),
      });

      const data = (await response.json()) as DiagramGenerationResponse & { message?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "기본 diagram 생성에 실패했습니다.");
      }

      if (requestId !== diagramRequestIdRef.current) {
        return;
      }

      const nextFlow = createFlowFromBlueprint(data.diagram);
      setNodes(nextFlow.nodes);
      setEdges(nextFlow.edges);
      setDiagramResult(data);
      setResult(null);
      setLastSpecMode(null);
      setBuildResult(null);
      setBuildError("");
      setError("");
      setActiveEditor("diagram");

      window.setTimeout(() => {
        flow.fitView({ duration: 320, padding: 0.22 });
      }, 60);
    } catch (caught) {
      if (requestId !== diagramRequestIdRef.current) {
        return;
      }
      setDiagramError(caught instanceof Error ? caught.message : "기본 diagram 생성에 실패했습니다.");
    } finally {
      if (requestId === diagramRequestIdRef.current) {
        setDiagramLoading(false);
      }
    }
  };

  const buildCode = async (mode: "full" | "selection") => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      setBuildError("코드 생성은 Open Folder로 연 native workspace에서만 실행할 수 있습니다.");
      setActiveAuxPanel("ai");
      return;
    }

    if (!result || lastSpecMode !== mode) {
      setBuildError(mode === "selection" ? "먼저 Generate Selection Spec을 실행해야 합니다." : "먼저 Generate Full Spec을 실행해야 합니다.");
      setActiveAuxPanel("ai");
      return;
    }

    const prompt = mode === "selection" ? result.spec.iterationPrompt : result.spec.buildPrompt;
    setBuildLoading(true);
    setBuildError("");
    setBuildResult(null);
    setWorkspaceNotice(mode === "selection" ? "Building selected code in workspace..." : "Building full code in workspace...");
    setActiveAuxPanel("ai");

    try {
      const response = await fetch("/api/ai/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          requestedMode: mode,
          rootPath: workspaceRootPath,
          harness: harnessConfig,
        }),
      });

      const data = (await response.json()) as BuildResponse & { message?: string; error?: string; ok?: boolean };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "코드 생성에 실패했습니다.");
      }

      setBuildResult(data);
      await reloadNativeWorkspace(workspaceRootPath);
      setWorkspaceNotice(mode === "selection" ? "Selection code was written into the workspace." : "Full code build was written into the workspace.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "코드 생성에 실패했습니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
    } finally {
      setBuildLoading(false);
    }
  };

  const saveHarness = async (config: HarnessConfig) => {
    const artifacts = buildHarnessArtifacts(config);
    setSuggestedPreset(config.presetId);

    if (workspaceMode === "native" && workspaceRootPath) {
      await fetch("/api/workspace/write-artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: workspaceRootPath,
          artifacts,
        }),
      });
      await reloadNativeWorkspace(workspaceRootPath);
      setWorkspaceNotice("Harness files were written into the native workspace.");
    } else if (workspaceHandle && workspaceMode === "directory") {
      await writeArtifactsToDirectoryHandle(workspaceHandle, artifacts);
      const reloaded = await createWorkspaceFilesFromDirectoryHandle(workspaceHandle);
      setWorkspaceFiles(reloaded.files);
      setWorkspaceName(reloaded.rootName);
      setWorkspaceNotice("Harness files were written into the workspace.");
    } else {
      if (workspaceMode === "none") {
        setWorkspaceName(config.projectName);
      }
      downloadArtifacts(artifacts);
      setWorkspaceFiles((current) => mergeWorkspaceArtifacts(current, artifacts));
      setWorkspaceNotice("Workspace is read-only in the browser, so harness files were downloaded and mirrored in the explorer.");
    }

    setHarnessConfig(config);
    setActiveEditor("harness");
  };

  const renderTextDocument = (title: string, text: string, subtitle?: string) => (
    <section className="document-editor">
      <div className="editor-view__header">
        <div>
          <span className="editor-view__eyebrow">TEXT PREVIEW</span>
          <h2>{title}</h2>
        </div>
        {subtitle ? <span className="editor-chip">{subtitle}</span> : null}
      </div>
      <pre className="editor-code">{text}</pre>
    </section>
  );

  const activeFile = activeEditor.startsWith("file:")
    ? openedFiles.find((file) => file.path === activeEditor.replace(/^file:/, ""))
    : null;

  const renderActiveEditor = () => {
    if (activeEditor === "harness") {
      return renderTextDocument(
        ".graphcoding/harness.json",
        harnessConfig ? JSON.stringify(harnessConfig, null, 2) : "No harness configured yet.",
        harnessConfig ? "workspace setup" : undefined,
      );
    }

    if (activeEditor === "graph") {
      return renderTextDocument("diagram.graph.json", JSON.stringify(diagram, null, 2), `${diagram.nodes.length} nodes`);
    }

    if (activeEditor === "spec") {
      if (!result) {
        return renderTextDocument("specification.md", "No generated specification yet.\n\nRun GPT-5.4 from the AI panel to generate one.");
      }

      return renderTextDocument(
        "specification.md",
        [
          `# ${result.spec.title}`,
          "",
          result.spec.overview,
          "",
          "## Architecture",
          ...result.spec.architecture.map((item) => `- ${item}`),
          "",
          "## Execution Plan",
          ...result.spec.executionPlan.map((item, index) => `${index + 1}. ${item}`),
          "",
          "## Test Plan",
          ...result.spec.testPlan.map((item) => `- ${item}`),
        ].join("\n"),
        result.source,
      );
    }

    if (activeEditor === "buildPrompt") {
      return renderTextDocument(
        "build.prompt",
        result?.spec.buildPrompt ?? "Build prompt will appear after spec generation.",
        result?.generatedAt,
      );
    }

    if (activeEditor === "iterationPrompt") {
      return renderTextDocument(
        "iteration.prompt",
        result?.spec.iterationPrompt ?? "Iteration prompt will appear after spec generation.",
      );
    }

    if (activeFile) {
      return renderTextDocument(activeFile.path, filePreviews[activeFile.path] ?? "Loading preview...", `${activeFile.size} bytes`);
    }

    if (workspaceFiles.length === 0 && !harnessConfig) {
      return (
        <section className="welcome-screen">
          <div className="welcome-card">
            <h1>Open a project folder to start.</h1>
            <p>폴더를 열면 Harness를 만들고, Brief를 써서 GPT-5.4로 diagram과 코드를 생성합니다.</p>
            <div className="welcome-manual-path">
              <div className="welcome-manual-path__row">
                <input
                  id="welcome-manual-path-input"
                  className="welcome-manual-path__input"
                  type="text"
                  placeholder="/Users/you/Documents/your-app"
                  value={manualPath}
                  onChange={(event) => setManualPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !manualPathLoading) {
                      void handleOpenFolderByPath(manualPath);
                    }
                  }}
                  disabled={manualPathLoading}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="primary-button compact-button"
                  onClick={() => void handleOpenFolderByPath(manualPath)}
                  disabled={manualPathLoading || !manualPath.trim()}
                >
                  {manualPathLoading ? "Opening..." : "Open"}
                </button>
              </div>
              <button className="ghost-button compact-button welcome-manual-path__native" onClick={() => void handleOpenFolder()}>
                또는 네이티브 대화상자로 폴더 선택
              </button>
              {workspaceNotice ? <p className="welcome-manual-path__notice">{workspaceNotice}</p> : null}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="diagram-editor">
        <div className="editor-view__header">
          <div>
            <span className="editor-view__eyebrow">DIAGRAM EDITOR</span>
            <h2>program.graph</h2>
          </div>
          <div className="editor-toolbar">
            <span className="editor-chip">{nodes.length} nodes</span>
            <span className="editor-chip">{edges.length} arrows</span>
            <span className="editor-chip">{selectedNodes.length > 0 ? `${selectedNodes.length} selected` : "full scope"}</span>
            <button className="ghost-button compact-button" onClick={() => flow.fitView({ duration: 300, padding: 0.2 })}>
              Fit View
            </button>
          </div>
        </div>

        <div className="canvas-stage">
          <div className="canvas-overlay">
            <strong>Flow Editor</strong>
            <span>
              {nodes.length === 0
                ? "우측 AI 패널의 Brief to Diagram에 러프 요구를 적으면 GPT-5.4가 첫 기본 diagram을 구성합니다."
                : "도형을 추가하고, 노드 안에 유저 행동과 시스템 동작을 적은 뒤 화살표로 관계를 연결합니다."}
            </span>
          </div>
          <div className="scope-banner">
            {diagram.scope.mode === "selection"
              ? `Selection Mode: ${diagram.scope.nodeIds.length} nodes`
              : "Full Graph Mode"}
          </div>
          <ReactFlow
            className="flow-canvas"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            nodeTypes={nodeTypes}
            fitView
            selectionOnDrag
          >
            <Background color="#2f2f2f" gap={22} variant={BackgroundVariant.Dots} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
      </section>
    );
  };

  return (
    <div className="ide-shell">
      <header className="title-bar">
        <div className="title-bar__brand">Graph Coding GPT</div>
        <div className="title-bar__actions">
          <span className="title-pill">{workspaceName}</span>
          <span className={`title-pill ${auth?.codexAuthenticated ? "is-ready" : ""}`}>
            {auth?.codexAuthenticated ? "GPT-5.4 Ready" : "Auth Pending"}
          </span>
        </div>
      </header>

      <div className="workbench">
        <nav className="activity-bar">
          <button className="activity-icon is-active" title="Explorer">
            ⛶
          </button>
          <button className={`activity-icon ${activeEditor === "diagram" ? "is-active" : ""}`} title="Diagram" onClick={() => setActiveEditor("diagram")}>
            ◎
          </button>
          <button className={`activity-icon ${activeEditor === "spec" ? "is-active" : ""}`} title="Specification" onClick={() => setActiveEditor("spec")}>
            ≣
          </button>
          <button className={`activity-icon ${activeAuxPanel === "ai" ? "is-active" : ""}`} title="AI" onClick={() => setActiveAuxPanel("ai")}>
            ✦
          </button>
          <button className={`activity-icon ${activeAuxPanel === "inspector" ? "is-active" : ""}`} title="Inspector" onClick={() => setActiveAuxPanel("inspector")}>
            ☰
          </button>
        </nav>

        <ExplorerPanel
          workspaceName={workspaceName}
          workspaceTree={workspaceTree}
          editorTabs={editorTabs}
          activeEditor={activeEditor}
          hasWorkspace={workspaceFiles.length > 0}
          onOpenFolder={() => void handleOpenFolder()}
          onFolderImportChange={handleFolderInputChange}
          onSelectEditor={setActiveEditor}
          onSelectFile={handleSelectWorkspaceFile}
          onAddNode={addNodeOfType}
          onResetDiagram={resetFlow}
          harnessConfig={harnessConfig}
          onOpenSetup={() => setIsSetupOpen(true)}
        />

        <section className="main-column">
          <div className="editor-tabs">
            {editorTabs.map((tab) => (
              <div key={tab.id} className={`editor-tab ${activeEditor === tab.id ? "is-active" : ""}`}>
                <button className="editor-tab__select" onClick={() => setActiveEditor(tab.id)}>
                  {tab.label}
                </button>
                {tab.closeable ? (
                  <button className="editor-tab__close" onClick={() => closeEditor(tab.id)} title="Close Tab">
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="editor-surface">{renderActiveEditor()}</div>

          <BottomPanel diagram={diagram} result={result} error={error} loading={loading} />
        </section>

        <aside className="auxiliary-bar">
          <div className="auxiliary-tabs">
            <button className={activeAuxPanel === "ai" ? "is-active" : ""} onClick={() => setActiveAuxPanel("ai")}>
              AI
            </button>
            <button className={activeAuxPanel === "inspector" ? "is-active" : ""} onClick={() => setActiveAuxPanel("inspector")}>
              INSPECTOR
            </button>
          </div>

          <div className="auxiliary-body">
            {activeAuxPanel === "ai" ? (
              <RunPanel
                auth={auth}
                diagram={diagram}
                brief={diagramBrief}
                diagramLoading={diagramLoading}
                diagramResult={diagramResult}
                diagramError={diagramError}
                loading={loading}
                result={result}
                error={error}
                buildLoading={buildLoading}
                buildResult={buildResult}
                buildError={buildError}
                canBuildInWorkspace={workspaceMode === "native" && Boolean(workspaceRootPath)}
                buildHint={
                  workspaceMode === "native" && workspaceRootPath
                    ? "해당 범위의 spec을 먼저 만든 뒤, 아래 버튼으로 현재 폴더에 직접 코드를 작성합니다."
                    : "먼저 Open Folder로 실제 폴더를 열고, 해당 범위의 spec을 생성한 뒤 코드를 작성할 수 있습니다."
                }
                canBuildSelection={workspaceMode === "native" && Boolean(workspaceRootPath) && Boolean(result) && lastSpecMode === "selection"}
                canBuildFull={workspaceMode === "native" && Boolean(workspaceRootPath) && Boolean(result) && lastSpecMode === "full"}
                onBriefChange={setDiagramBrief}
                onGenerateDiagram={generateDiagramFromBrief}
                onGenerate={generateSpec}
                onBuild={buildCode}
              />
            ) : (
              <InspectorPanel
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                selectedNodeCount={selectedNodes.length}
                onNodeFieldChange={updateNodeField}
                onEdgeFieldChange={updateEdgeField}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="status-bar">
        <div className="status-bar__left">
          <span>main</span>
          <span>{workspaceName}</span>
          <span>{harnessConfig ? harnessConfig.presetId : "no-harness"}</span>
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
        </div>
        <div className="status-bar__right">
          <span>{workspaceNotice || auth?.detail || "Checking Codex..."}</span>
          <span>{diagramLoading ? "Generating diagram..." : loading ? "Generating spec..." : buildLoading ? "Building code..." : "Ready"}</span>
        </div>
      </footer>

      <WorkspaceSetupModal
        open={isSetupOpen}
        workspaceName={workspaceName === "NO FOLDER OPENED" ? "New Workspace" : workspaceName}
        initialPreset={suggestedPreset}
        existingConfig={harnessConfig}
        canWriteToWorkspace={workspaceMode === "directory" || workspaceMode === "native"}
        onClose={() => setIsSetupOpen(false)}
        onSave={saveHarness}
      />
    </div>
  );
}

function selectedNodesLength(nodes: DiagramNodeType[]) {
  return nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0);
}
