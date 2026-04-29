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
import BuildLoopPanel from "./components/BuildLoopPanel";
import DiagramEmptyState from "./components/DiagramEmptyState";
import DiagramNodeRenderer from "./components/DiagramNode";
import ExplorerPanel from "./components/ExplorerPanel";
import InspectorPanel from "./components/InspectorPanel";
import { LiquidGlassBadge, LiquidGlassButton } from "./components/LiquidGlassControls";
import RunPanel from "./components/RunPanel";
import WorkspaceSetupModal from "./components/WorkspaceSetupModal";
import {
  buildDiagramDocument,
  createEdge,
  createFlowFromBlueprint,
  createInitialFlow,
  createNode,
  isBuildableShape,
  migratePersistedDiagram,
} from "./lib/diagram";
import {
  buildHarnessArtifacts,
  findWorkspaceHarnessFile,
  getHarnessPreset,
  inferHarnessPreset,
  tryParseHarnessConfig,
} from "./lib/harness";
import type {
  BuildLoopState,
  BuildNodeResponse,
  DiagramEdge,
  DiagramGenerationResponse,
  NodeBuildRecord,
  NodeBuildStatus,
  RuntimeVerificationResult,
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
const LAST_NATIVE_WORKSPACE_KEY = "graph-coding-gpt.last-native-workspace.v1";

const nodeTypes = {
  diagram: DiagramNodeRenderer,
};

type AuthStatus = {
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  detail: string;
  model?: string;
  reasoningEffort?: string;
};

type AuxPanel = "ai" | "inspector" | "build";
type DirectoryWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  };
type WorkspaceMode = "none" | "directory" | "imported" | "native";

const baseTabs: EditorTab[] = [
  { id: "diagram", label: "diagram.canvas", kind: "diagram", closeable: false },
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
  const [buildLoopState, setBuildLoopState] = useState<BuildLoopState | null>(null);
  const [buildSyncing, setBuildSyncing] = useState(false);
  const buildAbortRef = useRef(false);
  // Incremented every time a new build-loop run starts. Each loop captures the
  // value at entry and bails if it changes — that way a late fetch response
  // from an aborted previous run can't overwrite fresh state.
  const buildGenRef = useRef(0);
  // Active fetch controllers keyed by generation id — stopBuildLoop aborts them.
  const buildAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("NO FOLDER OPENED");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [openedFiles, setOpenedFiles] = useState<WorkspaceFile[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [workspaceHandle, setWorkspaceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("none");
  const hasWorkspace = workspaceMode !== "none" || workspaceFiles.length > 0;
  const [harnessConfig, setHarnessConfig] = useState<HarnessConfig | null>(null);
  const [suggestedPreset, setSuggestedPreset] = useState<HarnessPresetId>("agent-tool");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [manualPathLoading, setManualPathLoading] = useState(false);
  const [folderDialogLoading, setFolderDialogLoading] = useState(false);
  const [activeEditor, setActiveEditor] = useState<string>("diagram");
  const [activeAuxPanel, setActiveAuxPanel] = useState<AuxPanel>("ai");
  const flow = useReactFlow();
  const setupPromptedKeyRef = useRef("");
  const restoredWorkspaceRef = useRef(false);
  const diagramRequestIdRef = useRef(0);
  const [diagramHydrated, setDiagramHydrated] = useState(false);
  // Tracks which diagramStorageKey the current {nodes, edges} state was loaded
  // from. The save effect only writes when this matches the current key —
  // prevents "wrote workspace A's diagram into workspace B" during switch.
  const hydratedKeyRef = useRef<string | null>(null);

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
    const key = `${workspaceMode}:${workspaceRootPath ?? workspaceName}:${workspaceFiles.length}`;
    if (hasWorkspace && !harnessConfig && setupPromptedKeyRef.current !== key) {
      setupPromptedKeyRef.current = key;
      setIsSetupOpen(true);
    }
  }, [harnessConfig, hasWorkspace, workspaceFiles.length, workspaceMode, workspaceName, workspaceRootPath]);

  const diagramStorageKey = useMemo(() => {
    if (workspaceRootPath) {
      return `${DIAGRAM_STORAGE_PREFIX}:native:${workspaceRootPath}`;
    }

    if (hasWorkspace && workspaceName !== "NO FOLDER OPENED") {
      return `${DIAGRAM_STORAGE_PREFIX}:workspace:${workspaceName}`;
    }

    return null;
  }, [hasWorkspace, workspaceName, workspaceRootPath]);

  const briefStorageKey = useMemo(() => {
    if (workspaceRootPath) {
      return `${BRIEF_STORAGE_PREFIX}:native:${workspaceRootPath}`;
    }

    if (hasWorkspace && workspaceName !== "NO FOLDER OPENED") {
      return `${BRIEF_STORAGE_PREFIX}:workspace:${workspaceName}`;
    }

    return `${BRIEF_STORAGE_PREFIX}:global`;
  }, [hasWorkspace, workspaceName, workspaceRootPath]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_DIAGRAM_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const storedBrief = localStorage.getItem(briefStorageKey);
    setDiagramBrief(storedBrief ?? "");
  }, [briefStorageKey]);

  useEffect(() => {
    let cancelled = false;
    // Invalidate the hydrated-key ref synchronously so the save effect's guard
    // immediately rejects writes with the new key until we finish loading.
    hydratedKeyRef.current = null;
    setDiagramHydrated(false);

    const keyForThisLoad = diagramStorageKey;

    const fresh = createInitialFlow();
    const applyFresh = () => {
      if (cancelled) return;
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      hydratedKeyRef.current = keyForThisLoad;
      setDiagramHydrated(true);
    };
    const applyParsed = (raw: string, key: string | null) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(raw) as { nodes: DiagramNodeType[]; edges: DiagramEdge[] };
        // Saved diagrams may have been written under the old 16-shape vocabulary
        // (e.g. shape: "external", "decision", "document"). Run them through the
        // migration table so they conform to the current 9-shape schema before
        // hitting any downstream code that asserts on shape values.
        const migrated = migratePersistedDiagram(parsed);
        setNodes(migrated.nodes);
        setEdges(migrated.edges);
      } catch (err) {
        console.warn("[diagram] failed to parse stored diagram; backing up and starting fresh:", err);
        if (key) {
          try { localStorage.setItem(`${key}:corrupt-${Date.now()}`, raw); } catch { /* quota */ }
          localStorage.removeItem(key);
        }
        setNodes(fresh.nodes);
        setEdges(fresh.edges);
      } finally {
        hydratedKeyRef.current = keyForThisLoad;
        setDiagramHydrated(true);
      }
    };

    if (!diagramStorageKey) {
      applyFresh();
      return () => { cancelled = true; };
    }

    // Native workspaces: prefer disk copy, fall back to localStorage.
    if (workspaceMode === "native" && workspaceRootPath) {
      void (async () => {
        try {
          const response = await fetch("/api/workspace/read-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rootPath: workspaceRootPath, path: ".graphcoding/diagram.graph.json" }),
          });
          if (response.ok) {
            const data = (await response.json()) as { ok: boolean; content?: string };
            if (data.ok && data.content) {
              applyParsed(data.content, null);
              return;
            }
          }
        } catch { /* fall through */ }
        const raw = localStorage.getItem(diagramStorageKey);
        if (raw) applyParsed(raw, diagramStorageKey);
        else applyFresh();
      })();
      return () => { cancelled = true; };
    }

    const raw = localStorage.getItem(diagramStorageKey);
    if (raw) applyParsed(raw, diagramStorageKey);
    else applyFresh();
    return () => { cancelled = true; };
  }, [diagramStorageKey, setEdges, setNodes, workspaceMode, workspaceRootPath]);

  useEffect(() => {
    if (!diagramHydrated || !diagramStorageKey) {
      return;
    }
    // Guard against the cross-workspace race: if we haven't finished hydrating
    // from `diagramStorageKey` yet, nodes/edges still belong to a previous
    // workspace and writing them here would corrupt the new one.
    if (hydratedKeyRef.current !== diagramStorageKey) {
      return;
    }

    const payload = JSON.stringify({ nodes, edges });
    localStorage.setItem(diagramStorageKey, payload);

    if (workspaceMode === "native" && workspaceRootPath) {
      const timer = setTimeout(() => {
        void fetch("/api/workspace/write-artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath: workspaceRootPath,
            artifacts: [
              { path: ".graphcoding/diagram.graph.json", content: payload },
            ],
          }),
        }).catch((err) => {
          console.warn("[diagram] disk save failed:", err);
        });
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [diagramHydrated, diagramStorageKey, edges, nodes, workspaceMode, workspaceRootPath]);

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
  const hasBuildableNodes = diagram.nodes.some((node) => isBuildableShape(node.shape));
  const buildableDiagramNodeIds = useMemo(
    () => nodes.filter((node) => isBuildableShape(node.data.shape)).map((node) => node.id),
    [nodes],
  );
  const diagramSignature = useMemo(
    () => createDiagramBuildSignature(nodes, edges),
    [edges, nodes],
  );
  const compatibleBuildLoopState = buildLoopState && isBuildLoopStateCompatible(buildLoopState, buildableDiagramNodeIds, diagramSignature)
    ? buildLoopState
    : null;
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceFiles), [workspaceFiles]);

  useEffect(() => {
    const element = canvasStageRef.current;
    if (!element || activeEditor !== "diagram" || nodes.length === 0) {
      setCanvasReady(false);
      return;
    }

    const updateCanvasReady = () => {
      const rect = element.getBoundingClientRect();
      setCanvasReady(rect.width > 0 && rect.height > 0);
    };

    updateCanvasReady();
    const observer = new ResizeObserver(updateCanvasReady);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeEditor, nodes.length, workspaceFiles.length]);

  const editorTabs = useMemo<EditorTab[]>(() => {
    const tabs = [...baseTabs];
    if (harnessConfig) {
      tabs.push({ id: "harness", label: "App Target", kind: "harness", closeable: false });
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
    if (!window.confirm("Reset diagram? This clears nodes, edges, generated specs, and build state.")) {
      return;
    }

    buildAbortRef.current = true;
    buildGenRef.current += 1;
    for (const controller of buildAbortControllersRef.current) {
      controller.abort();
    }
    buildAbortControllersRef.current.clear();

    const fresh = createInitialFlow();
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setResult(null);
    setLastSpecMode(null);
    setError("");
    setBuildLoopState(null);
    setDiagramResult(null);
    setDiagramError("");
    setActiveEditor("diagram");
    if (diagramStorageKey) {
      localStorage.removeItem(diagramStorageKey);
    }
    if (workspaceMode === "native" && workspaceRootPath) {
      void fetch("/api/build-state/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspaceRootPath, state: null }),
      });
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


    setDiagramResult(null);
    setDiagramError("");
    setActiveEditor("diagram");
    setWorkspaceNotice("");
  };

  // Restore build-loop progress from disk whenever we have a native workspace root.
  // Runs on fresh loadWorkspace AND on HMR-preserved state after page reload.
  useEffect(() => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      setBuildLoopState(null);
      return;
    }
    if (!diagramHydrated) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/build-state/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rootPath: workspaceRootPath }),
        });
        const data = (await response.json()) as { ok: boolean; state: BuildLoopState | null };
        if (cancelled) return;
        if (data.ok && data.state) {
          if (isBuildLoopStateCompatible(data.state, buildableDiagramNodeIds, diagramSignature)) {
            setBuildLoopState({ ...data.state, running: false, paused: true });
          } else {
            setBuildLoopState(null);
            setWorkspaceNotice("Ignored stale Build state because it does not match the current diagram.");
          }
        } else {
          setBuildLoopState(null);
        }
      } catch {
        if (!cancelled) setBuildLoopState(null);
      }
    })();
    return () => { cancelled = true; };
  }, [buildableDiagramNodeIds, diagramHydrated, diagramSignature, workspaceMode, workspaceRootPath]);

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
    localStorage.setItem(LAST_NATIVE_WORKSPACE_KEY, data.rootPath);
  };

  useEffect(() => {
    if (restoredWorkspaceRef.current || workspaceMode !== "none" || workspaceFiles.length > 0) {
      return;
    }

    restoredWorkspaceRef.current = true;
    const lastWorkspace = localStorage.getItem(LAST_NATIVE_WORKSPACE_KEY);
    if (!lastWorkspace) {
      return;
    }

    setManualPathLoading(true);
    setWorkspaceNotice(`Restoring ${lastWorkspace} ...`);
    void reloadNativeWorkspace(lastWorkspace)
      .then(() => {
        setWorkspaceNotice(`Restored ${lastWorkspace}`);
      })
      .catch((caught) => {
        localStorage.removeItem(LAST_NATIVE_WORKSPACE_KEY);
        const message = caught instanceof Error ? caught.message : "마지막 워크스페이스를 복구하지 못했습니다.";
        setWorkspaceNotice(`Last workspace restore failed: ${message}`);
      })
      .finally(() => {
        setManualPathLoading(false);
      });
  }, [workspaceFiles.length, workspaceMode]);

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
    if (folderDialogLoading) {
      return;
    }

    setFolderDialogLoading(true);
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
    } finally {
      setFolderDialogLoading(false);
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

  const persistBuildState = async (next: BuildLoopState) => {
    if (workspaceMode !== "native" || !workspaceRootPath) return;
    try {
      await fetch("/api/build-state/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspaceRootPath, state: next }),
      });
    } catch {
      // Non-fatal: state persistence is best-effort.
    }
  };

  const updateBuildState = (mutator: (prev: BuildLoopState) => BuildLoopState) => {
    setBuildLoopState((prev) => {
      if (!prev) return prev;
      const next = mutator(prev);
      void persistBuildState(next);
      return next;
    });
  };

  const updateNodeRecord = (nodeId: string, patch: Partial<NodeBuildRecord>) => {
    updateBuildState((prev) => ({
      ...prev,
      records: {
        ...prev.records,
        [nodeId]: { ...prev.records[nodeId], ...patch },
      },
    }));
  };

  const createPendingBuildStateFromDiagram = async (running: boolean): Promise<BuildLoopState> => {
    const orderResponse = await fetch("/api/ai/build-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagram }),
    });
    const orderData = (await orderResponse.json()) as { ok: boolean; order?: string[]; cycles?: boolean; error?: string };
    if (!orderData.ok || !orderData.order) {
      throw new Error(orderData.error || "빌드 순서를 계산할 수 없습니다.");
    }
    if (orderData.cycles) {
      setWorkspaceNotice("Diagram에 사이클이 있어 일부 노드는 마지막에 위치 순서대로 빌드됩니다. 사이클을 정리하면 결과가 더 정확해집니다.");
    }

    const initialRecords: Record<string, NodeBuildRecord> = {};
    for (const id of orderData.order) {
      const node = diagram.nodes.find((n) => n.id === id);
      if (!node) continue;
      initialRecords[id] = {
        nodeId: id,
        nodeTitle: node.title || id.slice(0, 8),
        nodeShape: node.shape,
        status: "pending",
        attempts: 0,
        files: [],
        lastOutput: "",
        testResult: null,
      };
    }

    const now = new Date().toISOString();
    return {
      running,
      paused: false,
      currentNodeId: null,
      order: orderData.order,
      records: initialRecords,
      diagramSignature,
      ...(running ? { startedAt: now } : { syncedAt: now }),
    };
  };

  const syncBuildStateToDiagram = async () => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      setWorkspaceNotice("Build Sync는 Open Folder로 연 native workspace에서만 실행됩니다.");
      setActiveAuxPanel("build");
      return;
    }
    if (!hasBuildableNodes) {
      setWorkspaceNotice("Sync할 빌드 대상 노드가 없습니다. State/Service/Screen 같은 buildable 노드를 추가하세요.");
      setActiveAuxPanel("build");
      return;
    }
    if (buildLoopState?.running) {
      setWorkspaceNotice("실행 중인 Build를 먼저 Stop한 뒤 Sync하세요.");
      setActiveAuxPanel("build");
      return;
    }

    buildAbortRef.current = true;
    buildGenRef.current += 1;
    for (const controller of buildAbortControllersRef.current) {
      controller.abort();
    }
    buildAbortControllersRef.current.clear();
    setBuildSyncing(true);
    setActiveAuxPanel("build");

    try {
      const synced = await createPendingBuildStateFromDiagram(false);
      setBuildLoopState(synced);
      await persistBuildState(synced);
      setWorkspaceNotice(`Build state synced from current diagram (${synced.order.length} nodes).`);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Build state sync failed.");
    } finally {
      setBuildSyncing(false);
    }
  };

  // Quietly reload the native workspace — never let a tree refresh hang the
  // build loop. Errors are logged to console and surfaced as a notice.
  const safeReloadNativeWorkspace = async (rootPath: string) => {
    try {
      await reloadNativeWorkspace(rootPath);
    } catch (err) {
      console.warn("[build-loop] workspace reload failed:", err);
      setWorkspaceNotice(`Workspace tree refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const startBuildLoop = async () => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      setWorkspaceNotice("Build Loop은 Open Folder로 연 native workspace에서만 실행됩니다.");
      setActiveAuxPanel("build");
      return;
    }
    if (diagram.nodes.length === 0) {
      setWorkspaceNotice("먼저 diagram을 생성하거나 확정하세요.");
      return;
    }
    if (!hasBuildableNodes) {
      setWorkspaceNotice("빌드 대상 노드가 없습니다. State/Service/Screen 같은 buildable 노드를 추가하세요.");
      setActiveAuxPanel("build");
      return;
    }
    if (diagramResult?.source === "fallback") {
      setWorkspaceNotice("Diagram이 fallback 결과입니다. 실제 Codex 응답을 먼저 받으세요.");
      setActiveAuxPanel("ai");
      return;
    }

    buildAbortRef.current = false;
    const myGen = ++buildGenRef.current;
    const isCurrent = () => buildGenRef.current === myGen && !buildAbortRef.current;
    setActiveAuxPanel("build");

    let currentState = compatibleBuildLoopState;
    if (!currentState || currentState.order.length === 0) {
      try {
        currentState = await createPendingBuildStateFromDiagram(true);
      } catch (caught) {
        setWorkspaceNotice(caught instanceof Error ? caught.message : "빌드 순서를 계산할 수 없습니다.");
        return;
      }
      if (!isCurrent()) return;
      setBuildLoopState(currentState);
      await persistBuildState(currentState);
    } else {
      // Resume: clear any stale "implementing" state from a killed prior run.
      const cleanedRecords: Record<string, NodeBuildRecord> = {};
      for (const id of currentState.order) {
        const rec = currentState.records[id];
        if (!rec) continue;
        if (rec.status === "implementing" || rec.status === "testing" || rec.status === "fixing") {
          cleanedRecords[id] = { ...rec, status: "pending", startedAt: undefined };
        } else {
          cleanedRecords[id] = rec;
        }
      }
      const resumed: BuildLoopState = {
        ...currentState,
        records: cleanedRecords,
        running: true,
        paused: false,
        currentNodeId: null,
        diagramSignature,
        startedAt: currentState.startedAt ?? new Date().toISOString(),
        failureReason: undefined,
      };
      setBuildLoopState(resumed);
      currentState = resumed;
      await persistBuildState(resumed);
    }

    const order = currentState.order;
    let firstPendingHit = !order.some((id) => currentState?.records[id]?.status === "done");

    for (let i = 0; i < order.length; i++) {
      if (!isCurrent()) return;
      const nodeId = order[i];
      const record = currentState.records[nodeId];
      if (record?.status === "done") continue;
      if (record?.status === "failed") {
        updateBuildState((prev) => ({ ...prev, running: false, paused: true, failureReason: `Node ${record.nodeTitle} previously failed.` }));
        return;
      }

      const previouslyBuilt = order
        .slice(0, i)
        .map((id) => currentState!.records[id])
        .filter((r) => r && r.status === "done")
        .map((r) => ({ id: r.nodeId, title: r.nodeTitle, shape: r.nodeShape, files: r.files }));

      // Atomically transition: set currentNodeId + mark this node implementing.
      updateBuildState((prev) => ({
        ...prev,
        currentNodeId: nodeId,
        records: {
          ...prev.records,
          [nodeId]: {
            ...prev.records[nodeId],
            status: "implementing",
            startedAt: new Date().toISOString(),
            lastError: undefined,
          },
        },
      }));

      const controller = new AbortController();
      buildAbortControllersRef.current.add(controller);
      try {
        const response = await fetch("/api/ai/build-node", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath: workspaceRootPath,
            diagram,
            harness: harnessConfig,
            nodeId,
            previouslyBuilt,
            isFirst: firstPendingHit,
            maxRetries: 3,
          }),
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        const data = (await response.json()) as BuildNodeResponse & { message?: string };
        if (!isCurrent()) return;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || data.message || "node build failed");
        }
        firstPendingHit = false;

        const finishedStatus: NodeBuildStatus = data.status;
        const recordPatch: Partial<NodeBuildRecord> = {
          status: finishedStatus,
          attempts: data.attempts,
          files: data.files,
          lastOutput: data.output,
          testResult: data.testResult,
          finishedAt: new Date().toISOString(),
        };
        // Single atomic state update: record patch + top-level transition.
        updateBuildState((prev) => {
          const nextRec = { ...prev.records[nodeId], ...recordPatch };
          const base = { ...prev, records: { ...prev.records, [nodeId]: nextRec } };
          if (finishedStatus === "failed") {
            return { ...base, running: false, paused: true, currentNodeId: null, failureReason: `Node ${record?.nodeTitle ?? nodeId.slice(0, 8)} failed after ${data.attempts} attempts.` };
          }
          return base;
        });

        // CRITICAL: Keep the local snapshot in sync so the next iteration's
        // previouslyBuilt reflects what was just built. Without this, codex
        // for node N+1 gets (none) in its "Already-built nodes" context.
        currentState = {
          ...currentState,
          records: { ...currentState.records, [nodeId]: { ...currentState.records[nodeId], ...recordPatch } },
        };

        if (finishedStatus === "failed") {
          await safeReloadNativeWorkspace(workspaceRootPath);
          return;
        }
      } catch (caught) {
        const aborted = caught instanceof DOMException && caught.name === "AbortError";
        if (aborted || !isCurrent()) return;
        const message = caught instanceof Error ? caught.message : "node build failed";
        updateBuildState((prev) => ({
          ...prev,
          running: false,
          paused: true,
          currentNodeId: null,
          failureReason: message,
          records: {
            ...prev.records,
            [nodeId]: { ...prev.records[nodeId], status: "failed", lastError: message, finishedAt: new Date().toISOString() },
          },
        }));
        await safeReloadNativeWorkspace(workspaceRootPath);
        return;
      } finally {
        buildAbortControllersRef.current.delete(controller);
      }

      await safeReloadNativeWorkspace(workspaceRootPath);
    }

    if (!isCurrent()) return;
    updateBuildState((prev) => ({
      ...prev,
      currentNodeId: null,
      runtimeVerification: {
        status: "running",
        passed: false,
        checks: ["Final runtime verification started"],
        failures: [],
        stdout: "",
        stderr: "",
        startedAt: new Date().toISOString(),
      },
    }));
    setWorkspaceNotice("Final verification: running test/typecheck/build and launching the generated app...");

    const runtimeController = new AbortController();
    buildAbortControllersRef.current.add(runtimeController);
    try {
      const response = await fetch("/api/workspace/runtime-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspaceRootPath, harness: harnessConfig }),
        signal: runtimeController.signal,
      });
      if (!isCurrent()) return;
      const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: RuntimeVerificationResult; error?: string } | null;
      if (!response.ok || !data?.ok || !data.result) {
        throw new Error(data?.error || "runtime verification failed");
      }
      const runtimeResult: RuntimeVerificationResult = {
        ...data.result,
        status: data.result.passed ? "passed" : "failed",
        finishedAt: data.result.finishedAt ?? new Date().toISOString(),
      };
      if (!runtimeResult.passed) {
        updateBuildState((prev) => ({
          ...prev,
          running: false,
          paused: true,
          currentNodeId: null,
          failureReason: runtimeResult.failures[0] || "Final runtime verification failed.",
          runtimeVerification: runtimeResult,
        }));
        setWorkspaceNotice("Final runtime verification failed. Check Build details.");
        await safeReloadNativeWorkspace(workspaceRootPath);
        return;
      }

      updateBuildState((prev) => ({
        ...prev,
        running: false,
        paused: false,
        currentNodeId: null,
        runtimeVerification: runtimeResult,
        finishedAt: new Date().toISOString(),
      }));
      setWorkspaceNotice(`Build finished and runtime verified${runtimeResult.url ? ` at ${runtimeResult.url}` : ""}.`);
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      if (aborted || !isCurrent()) return;
      const message = caught instanceof Error ? caught.message : "Final runtime verification failed.";
      updateBuildState((prev) => ({
        ...prev,
        running: false,
        paused: true,
        currentNodeId: null,
        failureReason: message,
        runtimeVerification: {
          status: "failed",
          passed: false,
          checks: [],
          failures: [message],
          stdout: "",
          stderr: "",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      }));
      setWorkspaceNotice(message);
    } finally {
      buildAbortControllersRef.current.delete(runtimeController);
    }
  };

  const stopBuildLoop = () => {
    buildAbortRef.current = true;
    // Abort in-flight fetches so a late response can't overwrite paused state.
    for (const c of buildAbortControllersRef.current) c.abort();
    buildAbortControllersRef.current.clear();
    updateBuildState((prev) => ({ ...prev, running: false, paused: true }));
  };

  const resetBuildLoop = () => {
    buildAbortRef.current = true;
    buildGenRef.current += 1; // invalidate any in-flight driver
    for (const c of buildAbortControllersRef.current) c.abort();
    buildAbortControllersRef.current.clear();
    setBuildLoopState(null);
    if (workspaceMode === "native" && workspaceRootPath) {
      void fetch("/api/build-state/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workspaceRootPath, state: null }),
      });
    }
  };

  const saveHarness = async (config: HarnessConfig) => {
    const artifacts = buildHarnessArtifacts(config);
    setSuggestedPreset(config.presetId);

    if (workspaceMode === "native" && workspaceRootPath) {
      const response = await fetch("/api/workspace/write-artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: workspaceRootPath,
          artifacts,
        }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "App Target files could not be written into the native workspace.");
      }
      await reloadNativeWorkspace(workspaceRootPath);
      setWorkspaceNotice("App Target files were written into the native workspace.");
    } else if (workspaceHandle && workspaceMode === "directory") {
      await writeArtifactsToDirectoryHandle(workspaceHandle, artifacts);
      const reloaded = await createWorkspaceFilesFromDirectoryHandle(workspaceHandle);
      setWorkspaceFiles(reloaded.files);
      setWorkspaceName(reloaded.rootName);
      setWorkspaceNotice("App Target files were written into the workspace.");
    } else {
      if (workspaceMode === "none") {
        setWorkspaceName(config.projectName);
      }
      downloadArtifacts(artifacts);
      setWorkspaceFiles((current) => mergeWorkspaceArtifacts(current, artifacts));
      setWorkspaceNotice("Workspace is read-only in the browser, so App Target files were downloaded and mirrored in the explorer.");
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
        "App Target (.graphcoding/harness.json)",
        harnessConfig ? JSON.stringify(harnessConfig, null, 2) : "No harness configured yet.",
        harnessConfig ? "Codex target" : undefined,
      );
    }

    if (activeEditor === "spec") {
      if (!result) {
        return renderTextDocument("specification.md", "No generated specification yet.\n\nUse 2. Generate to create one.");
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

    if (!hasWorkspace && !harnessConfig) {
      const workspaceOpening = manualPathLoading || folderDialogLoading;
      return (
        <section className="welcome-screen">
          <div className="welcome-card">
            <h1>Open a project folder to start.</h1>
            <p>폴더를 열면 App Target을 고정하고, Brief를 써서 Codex로 diagram과 코드를 생성합니다.</p>
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
                  disabled={workspaceOpening}
                  spellCheck={false}
                  autoComplete="off"
                />
                <LiquidGlassButton
                  width={88}
                  height={30}
                  onClick={() => void handleOpenFolderByPath(manualPath)}
                  disabled={workspaceOpening || !manualPath.trim()}
                >
                  {manualPathLoading ? "Opening..." : "Open"}
                </LiquidGlassButton>
              </div>
              <button className="ghost-button compact-button welcome-manual-path__native" onClick={() => void handleOpenFolder()} disabled={workspaceOpening}>
                {folderDialogLoading ? "Opening native dialog..." : "또는 네이티브 대화상자로 폴더 선택"}
              </button>
              {workspaceNotice ? <p className="welcome-manual-path__notice">{workspaceNotice}</p> : null}
            </div>
          </div>
        </section>
      );
    }

    const isEmptyCanvas = nodes.length === 0;

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
            {selectedNodes.length > 0 ? (
              <span className="editor-chip">{selectedNodes.length} selected</span>
            ) : null}
            {!isEmptyCanvas ? (
              <LiquidGlassButton tone="ghost" width={82} height={28} onClick={() => flow.fitView({ duration: 300, padding: 0.2 })}>
                Fit View
              </LiquidGlassButton>
            ) : null}
          </div>
        </div>

        <div className="canvas-stage" ref={canvasStageRef}>
          {isEmptyCanvas ? (
            <DiagramEmptyState
              brief={diagramBrief}
              loading={diagramLoading}
              error={diagramError}
              authReady={Boolean(auth?.codexAuthenticated)}
              onBriefChange={setDiagramBrief}
              onGenerate={() => void generateDiagramFromBrief("replace")}
            />
          ) : canvasReady ? (
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
          ) : (
            <div className="canvas-loading">Preparing diagram canvas...</div>
          )}
        </div>
      </section>
    );
  };

  const buildOrder = compatibleBuildLoopState?.order ?? [];
  const buildDone = buildOrder.filter((id) => compatibleBuildLoopState?.records[id]?.status === "done").length;
  const activeWorkflowStep = !hasWorkspace || !harnessConfig ? "target" : activeAuxPanel;
  const workflowSteps = [
    {
      id: "target",
      index: "1",
      title: "Target",
      detail: !hasWorkspace ? "Open a folder first" : harnessConfig ? getHarnessPreset(harnessConfig.presetId).label : "Choose app type",
      done: Boolean(harnessConfig),
      active: activeWorkflowStep === "target",
      disabled: !hasWorkspace,
      onClick: () => setIsSetupOpen(true),
    },
    {
      id: "ai",
      index: "2",
      title: "Generate",
      detail: diagram.nodes.length > 0 ? `${diagram.nodes.length} nodes ready` : "Brief to diagram",
      done: diagram.nodes.length > 0,
      active: activeWorkflowStep === "ai",
      disabled: !hasWorkspace,
      onClick: () => setActiveAuxPanel("ai"),
    },
    {
      id: "inspector",
      index: "3",
      title: "Edit",
      detail: selectedNodes.length + selectedEdges.length > 0 ? `${selectedNodes.length + selectedEdges.length} selected` : "Select a node",
      done: diagram.nodes.length > 0,
      active: activeWorkflowStep === "inspector",
      disabled: !hasWorkspace,
      onClick: () => setActiveAuxPanel("inspector"),
    },
    {
      id: "build",
      index: "4",
      title: "Build",
      detail: buildOrder.length > 0 ? `${buildDone}/${buildOrder.length} done` : "Run code + tests",
      done: buildOrder.length > 0 && buildDone === buildOrder.length,
      active: activeWorkflowStep === "build",
      disabled: !hasWorkspace,
      onClick: () => setActiveAuxPanel("build"),
    },
  ];

  return (
    <div className="ide-shell">
      <header className="title-bar">
        <div className="title-bar__brand">Graph Coding GPT</div>
        <div className="title-bar__actions">
          <LiquidGlassBadge width={Math.max(118, Math.min(210, workspaceName.length * 8 + 34))} height={24}>
            {workspaceName}
          </LiquidGlassBadge>
          <LiquidGlassBadge width={112} height={24} tone={auth?.codexAuthenticated ? "primary" : "status"}>
            {auth?.codexAuthenticated ? "Codex Ready" : "Connect Codex"}
          </LiquidGlassBadge>
        </div>
      </header>

      <nav className="workflow-rail" aria-label="Graph Coding workflow">
        {workflowSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`workflow-step ${step.active ? "is-active" : ""} ${step.done ? "is-done" : ""}`}
            disabled={step.disabled}
            onClick={step.onClick}
          >
            <span className="workflow-step__index">{step.index}</span>
            <span className="workflow-step__copy">
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className={`workbench ${hasWorkspace ? "" : "is-welcome"}`}>
        <ExplorerPanel
          workspaceName={workspaceName}
          workspaceTree={workspaceTree}
          editorTabs={editorTabs}
          activeEditor={activeEditor}
          hasWorkspace={hasWorkspace}
          onSelectEditor={setActiveEditor}
          onSelectFile={handleSelectWorkspaceFile}
          onAddNode={addNodeOfType}
          onResetDiagram={resetFlow}
          harnessConfig={harnessConfig}
          onOpenSetup={() => setIsSetupOpen(true)}
        />

        <section className="main-column">
          {hasWorkspace ? (
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
          ) : null}

          <div className="editor-surface">{renderActiveEditor()}</div>

        </section>

        {hasWorkspace ? (
          <aside className="auxiliary-bar">
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
                  onBriefChange={setDiagramBrief}
                  onGenerateDiagram={generateDiagramFromBrief}
                  onGenerate={generateSpec}
                />
              ) : activeAuxPanel === "inspector" ? (
                <InspectorPanel
                  selectedNode={selectedNode}
                  selectedEdge={selectedEdge}
                  selectedCount={selectedNodes.length + selectedEdges.length}
                  onNodeFieldChange={updateNodeField}
                  onEdgeFieldChange={updateEdgeField}
                />
              ) : (
                <BuildLoopPanel
                  diagram={diagram}
                  state={compatibleBuildLoopState}
                  canRun={
                    workspaceMode === "native" &&
                    Boolean(workspaceRootPath) &&
                    hasBuildableNodes &&
                    diagramResult?.source !== "fallback"
                  }
                  blockedReason={
                    workspaceMode !== "native" || !workspaceRootPath
                      ? "Build Loop은 Open Folder로 연 native workspace에서만 실행됩니다."
                      : diagram.nodes.length === 0
                        ? "먼저 diagram을 만들거나 확정하세요."
                        : !hasBuildableNodes
                          ? "Note는 빌드 대상이 아닙니다. State/Database/Service/API/Process/Input/Screen/Start-End 노드를 추가하세요."
                          : diagramResult?.source === "fallback"
                            ? "현재 diagram은 fallback 결과입니다. 실제 Codex 응답을 받은 뒤 실행하세요."
                            : ""
                  }
                  syncing={buildSyncing}
                  onSync={() => void syncBuildStateToDiagram()}
                  onStart={() => void startBuildLoop()}
                  onStop={stopBuildLoop}
                  onReset={resetBuildLoop}
                />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="status-bar">
        <div className="status-bar__left">
          <span>main</span>
          <span>{workspaceName}</span>
          <span>{harnessConfig ? harnessConfig.presetId : "no-target"}</span>
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
        </div>
        <div className="status-bar__right">
          <span>{workspaceNotice || auth?.detail || "Checking Codex..."}</span>
          <span>
            {diagramLoading
              ? "Generating diagram..."
              : loading
                ? "Generating spec..."
                : compatibleBuildLoopState?.running
                  ? compatibleBuildLoopState.runtimeVerification?.status === "running"
                    ? "Running final verification..."
                    : `Building node ${compatibleBuildLoopState.currentNodeId ? (compatibleBuildLoopState.records[compatibleBuildLoopState.currentNodeId]?.nodeTitle ?? "") : ""}...`
                  : "Ready"}
          </span>
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

function createDiagramBuildSignature(nodes: DiagramNodeType[], edges: DiagramEdge[]) {
  const buildableNodes = nodes
    .filter((node) => isBuildableShape(node.data.shape))
    .map((node) => ({
      id: node.id,
      shape: node.data.shape,
      title: node.data.title,
      actor: node.data.actor,
      intent: node.data.intent,
      behavior: node.data.behavior,
      inputs: node.data.inputs,
      outputs: node.data.outputs,
      testHint: node.data.testHint,
      notes: node.data.notes,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const buildableIds = new Set(buildableNodes.map((node) => node.id));
  const buildableEdges = edges
    .filter((edge) => buildableIds.has(edge.source) && buildableIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.data?.relation ?? edge.label ?? "",
      notes: edge.data?.notes ?? "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({ nodes: buildableNodes, edges: buildableEdges });
}

function isBuildLoopStateCompatible(
  state: BuildLoopState,
  buildableNodeIds: string[],
  diagramSignature: string,
) {
  if (state.order.length !== buildableNodeIds.length) {
    return false;
  }

  const buildableIdSet = new Set(buildableNodeIds);
  if (state.order.some((id) => !buildableIdSet.has(id))) {
    return false;
  }

  if (state.diagramSignature && state.diagramSignature !== diagramSignature) {
    return false;
  }

  return true;
}
