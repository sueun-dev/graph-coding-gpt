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
import BuildLoopPanel from "./components/BuildLoopPanel";
import DiagramEmptyState from "./components/DiagramEmptyState";
import DiagramNodeRenderer from "./components/DiagramNode";
import ExplorerPanel from "./components/ExplorerPanel";
import InspectorPanel from "./components/InspectorPanel";
import RunPanel from "./components/RunPanel";
import WorkspaceSetupModal from "./components/WorkspaceSetupModal";
import {
  buildDiagramDocument,
  createEdge,
  createFlowFromBlueprint,
  createInitialFlow,
  createNode,
  migratePersistedDiagram,
} from "./lib/diagram";
import {
  buildHarnessArtifacts,
  findWorkspaceHarnessFile,
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

type AuxPanel = "ai" | "inspector" | "build";
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
  const [buildLoopState, setBuildLoopState] = useState<BuildLoopState | null>(null);
  const buildAbortRef = useRef(false);
  // Incremented every time a new build-loop run starts. Each loop captures the
  // value at entry and bails if it changes — that way a late fetch response
  // from an aborted previous run can't overwrite fresh state.
  const buildGenRef = useRef(0);
  // Active fetch controllers keyed by generation id — stopBuildLoop aborts them.
  const buildAbortControllersRef = useRef<Set<AbortController>>(new Set());
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

        // Spread `edge.data` first so the new edge metadata fields
        // (dataShape/mode/condition/iteration) are preserved when the user
        // edits any single field. Without this spread, editing `relation`
        // would wipe `dataShape` etc. back to undefined.
        const data = {
          relation: edge.data?.relation ?? "",
          notes: edge.data?.notes ?? "",
          lineStyle: edge.data?.lineStyle ?? "smoothstep",
          animated: edge.data?.animated ?? false,
          dataShape: edge.data?.dataShape ?? "",
          mode: edge.data?.mode ?? "sync",
          condition: edge.data?.condition ?? "",
          iteration: edge.data?.iteration ?? "",
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
          setBuildLoopState({ ...data.state, running: false, paused: true });
        } else {
          setBuildLoopState(null);
        }
      } catch {
        if (!cancelled) setBuildLoopState(null);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceMode, workspaceRootPath]);

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
    if (diagramResult?.source === "fallback") {
      setWorkspaceNotice("Diagram이 fallback 결과입니다. 실제 GPT-5.5 응답을 먼저 받으세요.");
      setActiveAuxPanel("ai");
      return;
    }

    buildAbortRef.current = false;
    const myGen = ++buildGenRef.current;
    const isCurrent = () => buildGenRef.current === myGen && !buildAbortRef.current;
    setActiveAuxPanel("build");

    let currentState = buildLoopState;
    if (!currentState || currentState.order.length === 0) {
      const orderResponse = await fetch("/api/ai/build-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagram }),
      });
      const orderData = (await orderResponse.json()) as { ok: boolean; order?: string[]; cycles?: boolean; error?: string };
      if (!isCurrent()) return;
      if (!orderData.ok || !orderData.order) {
        setWorkspaceNotice(orderData.error || "빌드 순서를 계산할 수 없습니다.");
        return;
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
      currentState = {
        running: true,
        paused: false,
        currentNodeId: null,
        order: orderData.order,
        records: initialRecords,
        startedAt: new Date().toISOString(),
      };
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
        failureReason: undefined,
      };
      setBuildLoopState(resumed);
      currentState = resumed;
      await persistBuildState(resumed);
    }

    const order = currentState.order;
    let firstPendingHit = true;

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
      running: false,
      paused: false,
      currentNodeId: null,
      finishedAt: new Date().toISOString(),
    }));
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
        return renderTextDocument("specification.md", "No generated specification yet.\n\nRun GPT-5.5 from the AI panel to generate one.");
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
            <p>폴더를 열면 Harness를 만들고, Brief를 써서 GPT-5.5로 diagram과 코드를 생성합니다.</p>
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
              <button className="ghost-button compact-button" onClick={() => flow.fitView({ duration: 300, padding: 0.2 })}>
                Fit View
              </button>
            ) : null}
          </div>
        </div>

        <div className="canvas-stage">
          {isEmptyCanvas ? (
            <DiagramEmptyState
              brief={diagramBrief}
              loading={diagramLoading}
              error={diagramError}
              authReady={Boolean(auth?.codexAuthenticated)}
              onBriefChange={setDiagramBrief}
              onGenerate={() => void generateDiagramFromBrief("replace")}
            />
          ) : (
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
          )}
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
            {auth?.codexAuthenticated ? "GPT-5.5 Ready" : "Auth Pending"}
          </span>
        </div>
      </header>

      <div className={`workbench ${workspaceFiles.length === 0 ? "is-welcome" : ""}`}>
        <ExplorerPanel
          workspaceName={workspaceName}
          workspaceTree={workspaceTree}
          editorTabs={editorTabs}
          activeEditor={activeEditor}
          hasWorkspace={workspaceFiles.length > 0}
          onSelectEditor={setActiveEditor}
          onSelectFile={handleSelectWorkspaceFile}
          onAddNode={addNodeOfType}
          onResetDiagram={resetFlow}
          harnessConfig={harnessConfig}
          onOpenSetup={() => setIsSetupOpen(true)}
        />

        <section className="main-column">
          {workspaceFiles.length > 0 ? (
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

          {workspaceFiles.length > 0 ? (
            <BottomPanel diagram={diagram} result={result} error={error} loading={loading} />
          ) : null}
        </section>

        {workspaceFiles.length > 0 ? (
        <aside className="auxiliary-bar">
          <div className="auxiliary-tabs">
            <button className={activeAuxPanel === "ai" ? "is-active" : ""} onClick={() => setActiveAuxPanel("ai")}>
              AI
            </button>
            <button className={activeAuxPanel === "inspector" ? "is-active" : ""} onClick={() => setActiveAuxPanel("inspector")}>
              INSPECTOR
            </button>
            <button className={activeAuxPanel === "build" ? "is-active" : ""} onClick={() => setActiveAuxPanel("build")}>
              BUILD
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
                onBriefChange={setDiagramBrief}
                onGenerateDiagram={generateDiagramFromBrief}
                onGenerate={generateSpec}
              />
            ) : activeAuxPanel === "inspector" ? (
              <InspectorPanel
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                selectedNodeCount={selectedNodes.length}
                onNodeFieldChange={updateNodeField}
                onEdgeFieldChange={updateEdgeField}
              />
            ) : (
              <BuildLoopPanel
                diagram={diagram}
                state={buildLoopState}
                canRun={
                  workspaceMode === "native" &&
                  Boolean(workspaceRootPath) &&
                  diagram.nodes.length > 0 &&
                  diagramResult?.source !== "fallback"
                }
                blockedReason={
                  workspaceMode !== "native" || !workspaceRootPath
                    ? "Build Loop은 Open Folder로 연 native workspace에서만 실행됩니다."
                    : diagram.nodes.length === 0
                      ? "먼저 diagram을 만들거나 확정하세요."
                      : diagramResult?.source === "fallback"
                        ? "현재 diagram은 fallback 결과입니다. 실제 GPT-5.5 응답을 받은 뒤 실행하세요."
                        : ""
                }
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
          <span>{harnessConfig ? harnessConfig.presetId : "no-harness"}</span>
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
        </div>
        <div className="status-bar__right">
          <span>{workspaceNotice || auth?.detail || "Checking Codex..."}</span>
          <span>{diagramLoading ? "Generating diagram..." : loading ? "Generating spec..." : buildLoopState?.running ? `Building node ${buildLoopState.currentNodeId ? (buildLoopState.records[buildLoopState.currentNodeId]?.nodeTitle ?? "") : ""}...` : "Ready"}</span>
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
