import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  type EdgeChange,
  type NodeChange,
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
import { buildDiagramDocument, createEdge, createFlowFromBlueprint, createFlowFromDocument, createInitialFlow, createNode } from "./lib/diagram";
import {
  buildHarnessArtifacts,
  findWorkspaceHarnessFile,
  inferHarnessPreset,
  tryParseHarnessConfig,
} from "./lib/harness";
import type {
  BuildResponse,
  DiagramDocument,
  DiagramEdge,
  DiagramGenerationResponse,
  DiagramNode as DiagramNodeType,
  EditorTab,
  HarnessConfig,
  HarnessPresetId,
  NativeWorkspaceResponse,
  StepHistoryDocument,
  StepHistoryEntry,
  ShapeType,
  WorkflowStateArtifact,
  SpecResponse,
  WorkspaceBootstrapStatus,
  WorkspaceFile,
  WorkspaceManifest,
} from "./lib/types";
import {
  computeDiagramHash,
  computeWorkflowProgress,
  createApprovedDiagramDocument,
  createSelectionStepBuildContract,
  createScopedApprovedDiagram,
  createWorkflowStateArtifact,
  getNodeExecutionState,
  sanitizeStepHistoryEntries,
} from "./lib/workflow";
import {
  buildWorkspaceTree,
  createWorkspaceFilesFromNativeListing,
  readWorkspaceFileText,
  readWorkspaceFilePreview,
} from "./lib/workspace";

const initialFlow = createInitialFlow();
const DIAGRAM_STORAGE_PREFIX = "graph-coding-gpt.prototype.v2";
const LEGACY_DIAGRAM_STORAGE_KEY = "graph-coding-gpt.prototype";
const BRIEF_STORAGE_PREFIX = "graph-coding-gpt.brief.v1";
const LAST_NATIVE_WORKSPACE_STORAGE_KEY = "graph-coding-gpt.workspace.native-root.v1";
const MANIFEST_PATH = ".graphcoding/manifest.json";
const DIAGRAM_ARTIFACT_PATH = ".graphcoding/diagram.graph.json";
const APPROVED_DIAGRAM_PATH = ".graphcoding/diagram.approved.json";
const WORKFLOW_STATE_PATH = ".graphcoding/workflow-state.json";
const STEP_HISTORY_PATH = ".graphcoding/step-history.json";
const RESUME_STATE_PATH = ".graphcoding/resume-state.json";
const WORKSPACE_MANIFEST_MARKER = "graph-coding-gpt-workspace";
const WORKSPACE_MANIFEST_APP = "graph-coding-gpt";
const WORKSPACE_MANIFEST_FORMAT_VERSION = 1;

const nodeTypes = {
  diagram: DiagramNodeRenderer,
};

type AuthStatus = {
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  detail: string;
};

type AuxPanel = "ai" | "inspector";
type WorkspaceMode = "none" | "native";
type BootstrapCheck = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
};
type LoadedNativeWorkspaceResponse = {
  ok: true;
  rootPath: string;
  rootName: string;
  files: NonNullable<NativeWorkspaceResponse["files"]>;
  bootstrap: WorkspaceBootstrapStatus;
  error?: string;
};

const createWorkspaceManifest = (
  existingManifest: WorkspaceManifest | null,
  state: string,
  graphHash: string | null,
): WorkspaceManifest => ({
  marker: WORKSPACE_MANIFEST_MARKER,
  app: WORKSPACE_MANIFEST_APP,
  formatVersion: WORKSPACE_MANIFEST_FORMAT_VERSION,
  workspaceId: existingManifest?.workspaceId ?? `gcg_ws_${crypto.randomUUID()}`,
  createdAt: existingManifest?.createdAt ?? new Date().toISOString(),
  lastOpenedAt: new Date().toISOString(),
  graphHash,
  state,
});

const baseTabs: EditorTab[] = [
  { id: "diagram", label: "diagram.canvas", kind: "diagram", closeable: false },
  { id: "graph", label: "diagram.graph.json", kind: "graph", closeable: false },
];

const isCodeIntakeBranchKind = (kind?: string | null) =>
  kind === "external-codebase" || kind === "managed-codebase-input" || kind === "managed-harness-on-codebase";

const createWorkspaceListingSignature = (rootPath: string | null, files: WorkspaceFile[]) =>
  `${rootPath ?? "none"}::${files.map((file) => file.path).sort().join("|")}`;

export default function App() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initialFlow.edges);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [result, setResult] = useState<SpecResponse | null>(null);
  const [preparedSpec, setPreparedSpec] = useState<SpecResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [diagramBrief, setDiagramBrief] = useState("");
  const [diagramResult, setDiagramResult] = useState<DiagramGenerationResponse | null>(null);
  const [diagramError, setDiagramError] = useState("");
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [lastSpecMode, setLastSpecMode] = useState<"full" | "selection" | null>(null);
  const [preparedSpecMode, setPreparedSpecMode] = useState<"full" | "selection" | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResponse | null>(null);
  const [buildError, setBuildError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("NO FOLDER OPENED");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [openedFiles, setOpenedFiles] = useState<WorkspaceFile[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("none");
  const [workspaceBootstrap, setWorkspaceBootstrap] = useState<WorkspaceBootstrapStatus | null>(null);
  const [harnessConfig, setHarnessConfig] = useState<HarnessConfig | null>(null);
  const [suggestedPreset, setSuggestedPreset] = useState<HarnessPresetId>("agent-tool");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [diagramDirty, setDiagramDirty] = useState(false);
  const [diagramPersisting, setDiagramPersisting] = useState(false);
  const [lastDiagramSavedAt, setLastDiagramSavedAt] = useState<string | null>(null);
  const [approvedDiagram, setApprovedDiagram] = useState<DiagramDocument | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [stepHistory, setStepHistory] = useState<StepHistoryEntry[]>([]);
  const [workflowHydrated, setWorkflowHydrated] = useState(false);
  const [graphApprovalLoading, setGraphApprovalLoading] = useState(false);
  const [graphApprovalError, setGraphApprovalError] = useState("");
  const [lastSelectionBuildNodeId, setLastSelectionBuildNodeId] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<string>("diagram");
  const [activeAuxPanel, setActiveAuxPanel] = useState<AuxPanel>("ai");
  const flow = useReactFlow();
  const diagramRequestIdRef = useRef(0);
  const didRestoreNativeWorkspaceRef = useRef(false);
  const workspaceSyncBlockedRef = useRef(false);
  const workspaceListingSignatureRef = useRef("none");
  const pendingWorkspaceExternalSyncRef = useRef(false);
  const lastPersistedDiagramContentRef = useRef<string | null>(null);
  const [diagramHydrated, setDiagramHydrated] = useState(false);
  const [lastNativeWorkspaceRoot, setLastNativeWorkspaceRoot] = useState<string | null>(() =>
    localStorage.getItem(LAST_NATIVE_WORKSPACE_STORAGE_KEY),
  );
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((edge) => edge.selected), [edges]);
  const selectedNode = selectedNodes[0] ?? null;
  const selectedEdge = selectedEdges[0] ?? null;
  const activeSpec = preparedSpec ?? result;
  const activeSpecMode = preparedSpecMode ?? lastSpecMode;
  const selectedScopeNodeIds = useMemo(() => selectedNodes.map((node) => node.id), [selectedNodes]);
  const diagram = useMemo(
    () => buildDiagramDocument(nodes, edges, selectedScopeNodeIds),
    [edges, nodes, selectedScopeNodeIds],
  );
  const persistedDiagramDocument = useMemo(() => createApprovedDiagramDocument(diagram), [diagram]);
  const currentDiagramHash =
    persistedDiagramDocument.nodes.length > 0 || persistedDiagramDocument.edges.length > 0
      ? computeDiagramHash(persistedDiagramDocument)
      : null;
  const approvedDiagramHash =
    approvedDiagram && (approvedDiagram.nodes.length > 0 || approvedDiagram.edges.length > 0) ? computeDiagramHash(approvedDiagram) : null;
  const graphApprovalStale = Boolean(approvedDiagramHash && currentDiagramHash && approvedDiagramHash !== currentDiagramHash);
  const workflowProgress = useMemo(
    () =>
      approvedDiagram
        ? computeWorkflowProgress(approvedDiagram, stepHistory)
        : {
            executableNodeIds: [],
            approvedNodeIds: [],
            reachableNodeIds: [],
            blockedNodeIds: [],
            finalStatus: "in-progress" as const,
          },
    [approvedDiagram, stepHistory],
  );
  const selectedExecutableNodeIds = selectedNodes
    .map((node) => node.id)
    .filter((nodeId) => approvedDiagram?.nodes.some((approvedNode) => approvedNode.id === nodeId) ?? false);
  const selectedReachableNodeId =
    selectedExecutableNodeIds.length === 1 && workflowProgress.reachableNodeIds.includes(selectedExecutableNodeIds[0])
      ? selectedExecutableNodeIds[0]
      : null;
  const selectedStepState =
    selectedExecutableNodeIds.length === 1 && approvedDiagram
      ? getNodeExecutionState(approvedDiagram, selectedExecutableNodeIds[0], stepHistory)
      : null;
  const selectedStepTitle = selectedNodes.length === 1 ? selectedNodes[0].data.title : null;
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceFiles), [workspaceFiles]);
  const resumeBranch = workspaceBootstrap?.resume.resumeBranch ?? null;
  const internalResumeBranch = workspaceBootstrap?.resume.internalBranch ?? null;
  const autoResumeDecision =
    workspaceMode === "native" && workspaceRootPath && !workspaceBootstrap?.resume.hasManifest
      ? internalResumeBranch?.kind === "external-codebase"
        ? "analyze-existing-code"
        : internalResumeBranch?.kind === "external-empty-workspace"
          ? "initialize-fresh-workflow"
          : null
      : null;
  const isAutoResumePending = Boolean(autoResumeDecision);
  const hasPendingResumeDecision = Boolean(internalResumeBranch?.needsDecision) && !isAutoResumePending;
  const canApproveGraph =
    workspaceMode === "native" && Boolean(workspaceRootPath) && diagram.nodes.length > 0 && !hasPendingResumeDecision && !isAutoResumePending;
  const canApproveStep =
    Boolean(buildResult)
    && buildResult?.mode === "selection"
    && Boolean(lastSelectionBuildNodeId)
    && Boolean(approvedDiagram)
    && !graphApprovalStale
    && workflowProgress.reachableNodeIds.includes(lastSelectionBuildNodeId ?? "");
  const canGenerateDiagram =
    workspaceMode === "native" &&
    Boolean(workspaceRootPath) &&
    !isAutoResumePending &&
    !hasPendingResumeDecision &&
    Boolean(harnessConfig) &&
    Boolean(auth?.codexAuthenticated);
  const briefReady = diagramBrief.trim().length > 0;
  const canReopenLastWorkspace = Boolean(lastNativeWorkspaceRoot) && lastNativeWorkspaceRoot !== workspaceRootPath;
  const bootstrapChecks = useMemo<BootstrapCheck[]>(
    () => [
      {
        id: "folder",
        label: "Open Folder",
        detail:
          workspaceMode === "native" && workspaceRootPath
            ? `${workspaceBootstrap?.workspaceKind ?? "Native workspace"} connected`
            : "Native workspace root is required for bootstrap",
        ready: workspaceMode === "native" && Boolean(workspaceRootPath),
      },
      {
        id: "resume",
        label: "Resume Branch",
        detail:
          workspaceMode === "native" && resumeBranch && internalResumeBranch
            ? isAutoResumePending
              ? internalResumeBranch.kind === "external-codebase"
                ? "Existing codebase detected. Locking codebase intake and bootstrap state automatically."
                : "Empty external workspace detected. Initializing a fresh managed workflow automatically."
              : hasPendingResumeDecision
              ? `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.reason}`
              : `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`
            : "Open Folder 이후 workspace 상태를 분류하고 재개 분기를 고정합니다.",
        ready: workspaceMode !== "native" ? false : !hasPendingResumeDecision && !isAutoResumePending,
      },
      {
        id: "harness",
        label: "Harness",
        detail: harnessConfig ? `${harnessConfig.presetId} preset fixed in workspace` : "Create or load .graphcoding/harness.json",
        ready: Boolean(harnessConfig),
      },
      {
        id: "runtime",
        label: "GPT-5.4 Runtime",
        detail: auth?.codexAuthenticated ? auth.detail : "Codex login must be ready before diagram generation",
        ready: Boolean(auth?.codexAuthenticated),
      },
      {
        id: "brief",
        label: "Brief",
        detail: briefReady ? "Brief is ready for diagram generation" : "Write a rough product brief in the AI panel",
        ready: briefReady,
      },
    ],
    [
      auth?.codexAuthenticated,
      auth?.detail,
      briefReady,
      harnessConfig,
      isAutoResumePending,
      hasPendingResumeDecision,
      internalResumeBranch,
      resumeBranch,
      workspaceBootstrap?.workspaceKind,
      workspaceMode,
      workspaceRootPath,
    ],
  );
  const diagramGenerationHint = (() => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      return "먼저 Open Folder로 실제 작업 폴더를 열어야 합니다.";
    }

    if (isAutoResumePending) {
      return autoResumeDecision === "analyze-existing-code"
        ? "기존 코드베이스를 graph 입력으로 고정하는 중입니다. 기본 셋업이 끝나면 Brief to Diagram을 사용할 수 있습니다."
        : "빈 외부 폴더를 fresh workflow로 고정하는 중입니다. 기본 셋업이 끝나면 Brief to Diagram을 사용할 수 있습니다.";
    }

    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      return `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`;
    }

    if (!harnessConfig) {
      return "먼저 Edit Harness에서 프로젝트 하네스를 고정해야 합니다.";
    }

    if (!auth?.codexAuthenticated) {
      return "Codex/GPT-5.4 로그인 상태가 ready여야 초기 diagram 생성을 시작할 수 있습니다.";
    }

    return "준비 완료. Brief를 바탕으로 전체 diagram 초안을 생성할 수 있습니다.";
  })();

  const markDiagramEdited = () => {
    invalidatePreparedSpec();
    setDiagramDirty(true);
  };

  const handleNodesChange = (changes: NodeChange<DiagramNodeType>[]) => {
    if (changes.some((change) => change.type !== "select")) {
      markDiagramEdited();
    }
    onNodesChangeBase(changes);
  };

  const handleEdgesChange = (changes: EdgeChange<DiagramEdge>[]) => {
    if (changes.some((change) => change.type !== "select")) {
      markDiagramEdited();
    }
    onEdgesChangeBase(changes);
  };

  useEffect(() => {
    const loadAuth = async () => {
      const response = await fetch("/api/auth/status");
      const data = await response.json();
      setAuth(data);
    };

    void loadAuth();
  }, []);

  useEffect(() => {
    if (didRestoreNativeWorkspaceRef.current || !lastNativeWorkspaceRoot) {
      return;
    }

    didRestoreNativeWorkspaceRef.current = true;
    setWorkspaceNotice(`Restoring ${lastNativeWorkspaceRoot}...`);

    void reloadNativeWorkspace(lastNativeWorkspaceRoot)
      .then(() => {
        setWorkspaceNotice(`Restored ${lastNativeWorkspaceRoot}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unable to restore the last workspace.";
        localStorage.removeItem(LAST_NATIVE_WORKSPACE_STORAGE_KEY);
        setLastNativeWorkspaceRoot(null);
        setWorkspaceNotice(`${message} Open Folder로 새 워크스페이스를 선택하세요.`);
      });
  }, [lastNativeWorkspaceRoot]);

  useEffect(() => {
    if (hasPendingResumeDecision && isSetupOpen) {
      setIsSetupOpen(false);
    }
  }, [hasPendingResumeDecision, isSetupOpen]);

  useEffect(() => {
    if (isAutoResumePending && isSetupOpen) {
      setIsSetupOpen(false);
    }
  }, [isAutoResumePending, isSetupOpen]);

  useEffect(() => {
    workspaceSyncBlockedRef.current =
      loading || diagramLoading || buildLoading || graphApprovalLoading || isSetupOpen;
  }, [buildLoading, diagramLoading, graphApprovalLoading, isSetupOpen, loading]);

  useEffect(() => {
    const knownPaths = new Set(workspaceFiles.map((file) => file.path));

    setOpenedFiles((current) => current.filter((file) => knownPaths.has(file.path)));
    setFilePreviews((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => knownPaths.has(filePath))),
    );
  }, [workspaceFiles]);

  useEffect(() => {
    if (activeEditor.startsWith("file:")) {
      const targetPath = activeEditor.replace(/^file:/, "");
      const exists = workspaceFiles.some((file) => file.path === targetPath);
      if (!exists) {
        setActiveEditor("diagram");
      }
      return;
    }

    if (activeEditor === "harness" && !harnessConfig) {
      setActiveEditor("diagram");
    }
  }, [activeEditor, harnessConfig, workspaceFiles]);

  const diagramStorageKey = useMemo(() => {
    if (workspaceMode === "native") {
      return null;
    }

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
    let cancelled = false;

    if (workspaceMode === "native") {
      const graphFile = workspaceFiles.find((file) => file.path === DIAGRAM_ARTIFACT_PATH);

      if (!graphFile) {
        setNodes(fresh.nodes);
        setEdges(fresh.edges);
        setDiagramDirty(false);
        setDiagramPersisting(false);
        setLastDiagramSavedAt(null);
        lastPersistedDiagramContentRef.current = null;
        setDiagramHydrated(true);
        return;
      }

      void (async () => {
        try {
          const raw = await readWorkspaceFileText(graphFile);
          const parsed = JSON.parse(raw);
          const loaded = createFlowFromDocument(parsed);
          if (cancelled) {
            return;
          }
          setNodes(loaded.nodes);
          setEdges(loaded.edges);
          setDiagramDirty(false);
          setDiagramPersisting(false);
          setLastDiagramSavedAt(new Date().toISOString());
          lastPersistedDiagramContentRef.current = JSON.stringify(parsed, null, 2);
        } catch {
          if (cancelled) {
            return;
          }
          setNodes(fresh.nodes);
          setEdges(fresh.edges);
          setDiagramDirty(false);
          setDiagramPersisting(false);
          setLastDiagramSavedAt(null);
          lastPersistedDiagramContentRef.current = null;
        } finally {
          if (!cancelled) {
            setDiagramHydrated(true);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (!diagramStorageKey) {
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setDiagramDirty(false);
      setDiagramPersisting(false);
      setLastDiagramSavedAt(null);
      lastPersistedDiagramContentRef.current = null;
      setDiagramHydrated(true);
      return;
    }

    const raw = localStorage.getItem(diagramStorageKey);
    if (!raw) {
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setDiagramDirty(false);
      setDiagramPersisting(false);
      setLastDiagramSavedAt(null);
      lastPersistedDiagramContentRef.current = null;
      setDiagramHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { nodes: DiagramNodeType[]; edges: DiagramEdge[] };
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      setDiagramDirty(false);
      setDiagramPersisting(false);
      setLastDiagramSavedAt(new Date().toISOString());
      lastPersistedDiagramContentRef.current = JSON.stringify(parsed, null, 2);
    } catch {
      localStorage.removeItem(diagramStorageKey);
      setNodes(fresh.nodes);
      setEdges(fresh.edges);
      setDiagramDirty(false);
      setDiagramPersisting(false);
      setLastDiagramSavedAt(null);
      lastPersistedDiagramContentRef.current = null;
    } finally {
      setDiagramHydrated(true);
    }
    return () => {
      cancelled = true;
    };
  }, [diagramStorageKey, setEdges, setNodes, workspaceFiles, workspaceMode]);

  useEffect(() => {
    setWorkflowHydrated(false);
    let cancelled = false;

    if (workspaceMode === "native" && workspaceFiles.length > 0) {
      const approvedFile = workspaceFiles.find((file) => file.path === APPROVED_DIAGRAM_PATH);
      const workflowFile = workspaceFiles.find((file) => file.path === WORKFLOW_STATE_PATH);
      const stepHistoryFile = workspaceFiles.find((file) => file.path === STEP_HISTORY_PATH);

      void (async () => {
        let nextApprovedDiagram: DiagramDocument | null = null;
        let nextApprovedAt: string | null = null;
        let nextStepHistory: StepHistoryEntry[] = [];

        if (approvedFile) {
          try {
            const raw = await readWorkspaceFileText(approvedFile);
            nextApprovedDiagram = createApprovedDiagramDocument(JSON.parse(raw));
          } catch {
            nextApprovedDiagram = null;
          }
        }

        if (workflowFile) {
          try {
            const raw = await readWorkspaceFileText(workflowFile);
            const parsed = JSON.parse(raw) as Partial<WorkflowStateArtifact>;
            nextApprovedAt = typeof parsed.approvedAt === "string" ? parsed.approvedAt : null;
          } catch {
            nextApprovedAt = null;
          }
        }

        if (stepHistoryFile) {
          try {
            const raw = await readWorkspaceFileText(stepHistoryFile);
            const parsed = JSON.parse(raw) as Partial<StepHistoryDocument>;
            nextStepHistory = nextApprovedDiagram
              ? sanitizeStepHistoryEntries(nextApprovedDiagram, Array.isArray(parsed.entries) ? parsed.entries : [])
              : [];
          } catch {
            nextStepHistory = [];
          }
        }

        if (cancelled) {
          return;
        }

        setApprovedDiagram(nextApprovedDiagram);
        setApprovedAt(nextApprovedAt);
        setStepHistory(nextStepHistory);
        setWorkflowHydrated(true);
      })();

      return () => {
        cancelled = true;
      };
    }

    setApprovedDiagram(null);
    setApprovedAt(null);
    setStepHistory([]);
    setWorkflowHydrated(true);
    return () => {
      cancelled = true;
    };
  }, [workspaceFiles, workspaceMode]);

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

  useEffect(() => {
    if (workspaceMode !== "native" || !workspaceRootPath || !diagramHydrated) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (persistedDiagramDocument.nodes.length === 0 && persistedDiagramDocument.edges.length === 0) {
        return;
      }

      const nextContent = JSON.stringify(persistedDiagramDocument, null, 2);
      if (lastPersistedDiagramContentRef.current === nextContent) {
        return;
      }

      setDiagramPersisting(true);
      void writeWorkspaceArtifacts([
        {
          path: DIAGRAM_ARTIFACT_PATH,
          content: nextContent,
        },
      ])
        .then(() => {
          if (cancelled) {
            return;
          }
          lastPersistedDiagramContentRef.current = nextContent;
          setDiagramDirty(false);
          setLastDiagramSavedAt(new Date().toISOString());
        })
        .catch((caught: unknown) => {
          if (cancelled) {
            return;
          }
          setWorkspaceNotice(caught instanceof Error ? caught.message : "diagram 저장에 실패했습니다.");
        })
        .finally(() => {
          if (!cancelled) {
            setDiagramPersisting(false);
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [diagramHydrated, persistedDiagramDocument, workspaceMode, workspaceRootPath]);

  useEffect(() => {
    if (workspaceMode !== "native" || !workspaceRootPath || !diagramHydrated || !workflowHydrated) {
      return;
    }

    if (!approvedDiagram && !activeSpec && !buildResult && stepHistory.length === 0) {
      return;
    }

    const workflowState = createWorkflowStateArtifact({
      currentDiagram: diagram,
      approvedDiagram,
      stepHistory,
      selectedNodeIds: diagram.scope.nodeIds,
      lastSpecMode: activeSpecMode,
      specGeneratedAt: activeSpec?.generatedAt ?? null,
      lastBuildMode: buildResult?.mode ?? null,
      lastBuildAt: buildResult?.generatedAt ?? null,
      approvedAt,
    });

    void writeWorkspaceArtifacts([
      {
        path: WORKFLOW_STATE_PATH,
        content: JSON.stringify(workflowState, null, 2),
      },
    ]);
  }, [
    activeSpec?.generatedAt,
    activeSpecMode,
    approvedAt,
    approvedDiagram,
    buildResult?.generatedAt,
    buildResult?.mode,
    diagram,
    diagramHydrated,
    stepHistory,
    workflowHydrated,
    workspaceMode,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (!internalResumeBranch?.needsDecision || !resumeBranch) {
      return;
    }

    setWorkspaceNotice(`${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.reason}`);
  }, [internalResumeBranch, resumeBranch]);

  useEffect(() => {
    if (!autoResumeDecision || workspaceMode !== "native" || !workspaceRootPath || !resumeBranch || !internalResumeBranch) {
      return;
    }

    const notice =
      autoResumeDecision === "analyze-existing-code"
        ? "External codebase detected. Locking codebase intake before Harness Setup..."
        : "Empty external workspace detected. Locking a fresh workflow before Harness Setup...";
    setWorkspaceNotice(notice);
    void resolveResumeBranch(autoResumeDecision);
  }, [autoResumeDecision, internalResumeBranch, resumeBranch, workspaceMode, workspaceRootPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingElement(event.target)) {
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && (selectedNodes.length > 0 || selectedEdges.length > 0)) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (event.key === "Escape" && (selectedNodes.length > 0 || selectedEdges.length > 0)) {
        clearSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selectedNode) {
        event.preventDefault();
        duplicateSelectedNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEdges.length, selectedNode, selectedNodes.length]);

  useEffect(() => {
    if (workspaceMode !== "native") {
      return;
    }

    if (diagram.nodes.length > 0 || diagram.edges.length > 0 || diagramBrief.trim()) {
      return;
    }

    if (
      internalResumeBranch?.kind === "managed-codebase-input"
      || internalResumeBranch?.kind === "managed-harness-on-codebase"
    ) {
      setDiagramBrief(buildCodeAwareBrief());
    }
  }, [diagram.edges.length, diagram.nodes.length, diagramBrief, internalResumeBranch?.kind, workspaceMode]);

  const editorTabs = useMemo<EditorTab[]>(() => {
    const tabs = [...baseTabs];
    if (harnessConfig) {
      tabs.push({ id: "harness", label: ".graphcoding/harness.json", kind: "harness", closeable: false });
    }
    if (activeSpec) {
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
  }, [activeSpec, harnessConfig, openedFiles]);

  const invalidatePreparedSpec = () => {
    setResult(null);
    setPreparedSpec(null);
    setLastSpecMode(null);
    setPreparedSpecMode(null);
    setBuildResult(null);
    setBuildError("");
    setError("");
  };

  const addNodeOfType = (shape: ShapeType) => {
    setNodes((current) => [...current, createNode(shape, current.length)]);
    setActiveEditor("diagram");
    setDiagramResult(null);
    markDiagramEdited();
  };

  const resetFlow = () => {
    const fresh = createInitialFlow();
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    invalidatePreparedSpec();
    setDiagramResult(null);
    setDiagramError("");
    setDiagramDirty(false);
    setDiagramPersisting(false);
    setLastDiagramSavedAt(null);
    setApprovedDiagram(null);
    setApprovedAt(null);
    setStepHistory([]);
    setActiveEditor("diagram");
    if (diagramStorageKey) {
      localStorage.removeItem(diagramStorageKey);
    }
    if (workspaceMode === "native" && workspaceRootPath) {
      void deleteWorkspaceArtifacts([DIAGRAM_ARTIFACT_PATH, APPROVED_DIAGRAM_PATH, WORKFLOW_STATE_PATH, STEP_HISTORY_PATH]);
    }
  };

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    setEdges((current) => addEdge(createEdge(connection.source, connection.target, "새 흐름"), current));
    markDiagramEdited();
  };

  const updateNodeField = (field: string, value: string) => {
    if (!selectedNode) {
      return;
    }

    markDiagramEdited();
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

    markDiagramEdited();
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

  const clearSelection = () => {
    setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
  };

  const duplicateSelectedNode = () => {
    if (!selectedNode) {
      return;
    }

    const duplicate: DiagramNodeType = {
      ...selectedNode,
      id: crypto.randomUUID(),
      selected: true,
      position: {
        x: selectedNode.position.x + 56,
        y: selectedNode.position.y + 56,
      },
      data: {
        ...selectedNode.data,
        title: `${selectedNode.data.title} 복제`,
      },
    };

    markDiagramEdited();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false } as DiagramNodeType)), duplicate]);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setActiveAuxPanel("inspector");
  };

  const deleteSelection = () => {
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      return;
    }

    markDiagramEdited();
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target),
      ),
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

  const syncWorkspaceState = async (
    name: string,
    files: WorkspaceFile[],
    mode: WorkspaceMode,
    rootPath: string | null,
    bootstrap: WorkspaceBootstrapStatus | null,
  ) => {
    await inspectHarnessInWorkspace(files);
    workspaceListingSignatureRef.current = createWorkspaceListingSignature(rootPath, files);
    setWorkspaceName(name || "workspace");
    setWorkspaceFiles(files);
    setWorkspaceRootPath(rootPath);
    setWorkspaceMode(mode);
    setWorkspaceBootstrap(bootstrap);
  };

  const loadWorkspace = async (
    name: string,
    files: WorkspaceFile[],
    mode: WorkspaceMode,
    rootPath: string | null,
    bootstrap: WorkspaceBootstrapStatus | null,
  ) => {
    await syncWorkspaceState(name, files, mode, rootPath, bootstrap);
    setResult(null);
    setPreparedSpec(null);
    setLastSpecMode(null);
    setPreparedSpecMode(null);
    setError("");
    setBuildResult(null);
    setBuildError("");
    setDiagramResult(null);
    setDiagramError("");
    setActiveEditor("diagram");
    setWorkspaceNotice("");
  };

  const writeWorkspaceArtifacts = async (artifacts: Array<{ path: string; content: string }>) => {
    if (workspaceMode !== "native" || !workspaceRootPath || artifacts.length === 0) {
      return;
    }

    const response = await fetch("/api/workspace/write-artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspaceRootPath,
        artifacts,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "워크스페이스 파일을 저장하지 못했습니다.");
    }
  };

  const deleteWorkspaceArtifacts = async (paths: string[]) => {
    if (workspaceMode !== "native" || !workspaceRootPath || paths.length === 0) {
      return;
    }

    const response = await fetch("/api/workspace/delete-artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: workspaceRootPath,
        paths,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "워크스페이스 파일을 삭제하지 못했습니다.");
    }
  };

  const readNativeWorkspaceResponse = (data: NativeWorkspaceResponse): LoadedNativeWorkspaceResponse => {
    if (!data.ok || !data.rootPath || !Array.isArray(data.files) || !data.bootstrap) {
      throw new Error(data.error || "워크스페이스 응답이 올바르지 않습니다.");
    }

    return {
      ok: true,
      rootPath: data.rootPath,
      rootName: data.rootName || data.rootPath.split("/").filter(Boolean).pop() || "workspace",
      files: data.files,
      bootstrap: data.bootstrap,
      error: data.error,
    };
  };

  const reloadNativeWorkspace = async (rootPath: string) => {
    const response = await fetch("/api/workspace/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath }),
    });

    const data = (await response.json()) as NativeWorkspaceResponse;
    if (!response.ok) {
      throw new Error(data.error || "워크스페이스를 다시 불러오지 못했습니다.");
    }

    const parsed = readNativeWorkspaceResponse(data);
    const loaded = createWorkspaceFilesFromNativeListing(parsed.rootPath, parsed.files);
    const nextSignature = createWorkspaceListingSignature(parsed.rootPath, loaded.files);
    if (workspaceListingSignatureRef.current === nextSignature) {
      localStorage.setItem(LAST_NATIVE_WORKSPACE_STORAGE_KEY, parsed.rootPath);
      setLastNativeWorkspaceRoot(parsed.rootPath);
      return;
    }
    await syncWorkspaceState(parsed.rootName || loaded.rootName, loaded.files, "native", parsed.rootPath, parsed.bootstrap);
    localStorage.setItem(LAST_NATIVE_WORKSPACE_STORAGE_KEY, parsed.rootPath);
    setLastNativeWorkspaceRoot(parsed.rootPath);
  };

  useEffect(() => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const syncWorkspaceFromDisk = async () => {
      if (cancelled || inFlight) {
        return;
      }

      if (workspaceSyncBlockedRef.current) {
        pendingWorkspaceExternalSyncRef.current = true;
        return;
      }

      inFlight = true;
      pendingWorkspaceExternalSyncRef.current = false;
      try {
        await reloadNativeWorkspace(workspaceRootPath);
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : "워크스페이스 변경 사항을 다시 불러오지 못했습니다.";
          setWorkspaceNotice(message);
        }
      } finally {
        inFlight = false;
      }
    };

    const eventSource = new EventSource(`/api/workspace/watch?rootPath=${encodeURIComponent(workspaceRootPath)}`);

    const handleWorkspaceChange = () => {
      void syncWorkspaceFromDisk();
    };

    eventSource.addEventListener("workspace-changed", handleWorkspaceChange);
    eventSource.addEventListener("workspace-watch-error", handleWorkspaceChange);

    const handleFocus = () => {
      void syncWorkspaceFromDisk();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncWorkspaceFromDisk();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      eventSource.removeEventListener("workspace-changed", handleWorkspaceChange);
      eventSource.removeEventListener("workspace-watch-error", handleWorkspaceChange);
      eventSource.close();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    workspaceMode,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (
      workspaceMode !== "native"
      || !workspaceRootPath
      || workspaceSyncBlockedRef.current
      || !pendingWorkspaceExternalSyncRef.current
    ) {
      return;
    }

    pendingWorkspaceExternalSyncRef.current = false;
    void reloadNativeWorkspace(workspaceRootPath).catch((caught) => {
      const message = caught instanceof Error ? caught.message : "워크스페이스 변경 사항을 다시 불러오지 못했습니다.";
      setWorkspaceNotice(message);
    });
  }, [buildLoading, diagramLoading, graphApprovalLoading, isSetupOpen, loading, workspaceMode, workspaceRootPath]);

  const handleOpenFolder = async () => {
    setWorkspaceNotice("Opening native folder dialog...");
    setIsSetupOpen(false);

    try {
      const response = await fetch("/api/workspace/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = (await response.json()) as NativeWorkspaceResponse;
      if (!response.ok) {
        throw new Error(data.error || "네이티브 폴더를 열지 못했습니다.");
      }

      const parsed = readNativeWorkspaceResponse(data);
      const loaded = createWorkspaceFilesFromNativeListing(parsed.rootPath, parsed.files);
      await loadWorkspace(parsed.rootName || loaded.rootName, loaded.files, "native", parsed.rootPath, parsed.bootstrap);
      localStorage.setItem(LAST_NATIVE_WORKSPACE_STORAGE_KEY, parsed.rootPath);
      setLastNativeWorkspaceRoot(parsed.rootPath);
      setWorkspaceNotice(`Opened ${parsed.rootPath}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "네이티브 폴더를 열지 못했습니다.";
      setWorkspaceNotice(message);
    }
  };

  const handleReopenLastWorkspace = () => {
    if (!lastNativeWorkspaceRoot) {
      setWorkspaceNotice("복원할 마지막 native workspace가 없습니다.");
      return;
    }

    setWorkspaceNotice(`Reopening ${lastNativeWorkspaceRoot}...`);
    setIsSetupOpen(false);
    void reloadNativeWorkspace(lastNativeWorkspaceRoot)
      .then(() => {
        setWorkspaceNotice(`Reopened ${lastNativeWorkspaceRoot}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "마지막 workspace를 다시 열지 못했습니다.";
        setWorkspaceNotice(message);
      });
  };

  const handleOpenSetup = () => {
    if (isAutoResumePending) {
      setWorkspaceNotice(
        autoResumeDecision === "analyze-existing-code"
          ? "기존 코드베이스 intake를 먼저 고정하는 중입니다. 잠시 후 Harness Setup을 열 수 있습니다."
          : "fresh workflow를 먼저 고정하는 중입니다. 잠시 후 Harness Setup을 열 수 있습니다.",
      );
      return;
    }

    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      setWorkspaceNotice(`${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`);
      return;
    }

    setIsSetupOpen(true);
  };

  const buildCodeAwareBrief = () =>
    [
      "현재 workspace에 이미 있는 코드를 기준으로 graph workflow를 시작하고 싶어.",
      workspaceBootstrap?.projectMarkers.length ? `프로젝트 마커: ${workspaceBootstrap.projectMarkers.slice(0, 6).join(", ")}` : "",
      workspaceBootstrap?.resume.codeSignalFiles.length ? `대표 코드 파일: ${workspaceBootstrap.resume.codeSignalFiles.slice(0, 8).join(", ")}` : "",
      "대표 파일과 현재 구조를 바탕으로 주요 화면, 서비스, 저장소, 외부 연동 중심의 전체 graph 초안을 만들어줘.",
    ]
      .filter(Boolean)
      .join("\n");

  const buildDiagramIntakeContext = async () => {
    if (workspaceMode !== "native" || !workspaceBootstrap || !isCodeIntakeBranchKind(internalResumeBranch?.kind)) {
      return null;
    }

    const representativePaths = workspaceBootstrap.resume.codeSignalFiles.slice(0, 4);
    const representativeFiles = representativePaths
      .map((targetPath) => workspaceFiles.find((file) => file.path === targetPath))
      .filter((file): file is WorkspaceFile => Boolean(file));

    const fileSnippets = await Promise.all(
      representativeFiles.map(async (file) => {
        try {
          const content = await readWorkspaceFileText(file);
          return {
            path: file.path,
            excerpt: content.slice(0, 1600),
          };
        } catch {
          return {
            path: file.path,
            excerpt: "[unavailable]",
          };
        }
      }),
    );

    return {
      workspaceKind: workspaceBootstrap.workspaceKind,
      projectMarkers: workspaceBootstrap.projectMarkers.slice(0, 8),
      representativeFiles: fileSnippets,
    };
  };

  const resolveResumeBranch = async (decisionKind: "initialize-fresh-workflow" | "trust-current-graph" | "analyze-existing-code") => {
    if (workspaceMode !== "native" || !workspaceRootPath || !resumeBranch || !internalResumeBranch) {
      return;
    }

    setWorkspaceNotice(`${resumeBranch.label} / ${internalResumeBranch.label} 결정을 적용하는 중입니다...`);
    setIsSetupOpen(false);
    setBuildError("");
    setDiagramError("");

    try {
      const deleteTargets =
        decisionKind === "initialize-fresh-workflow"
          ? [DIAGRAM_ARTIFACT_PATH, APPROVED_DIAGRAM_PATH, WORKFLOW_STATE_PATH, STEP_HISTORY_PATH]
          : decisionKind === "trust-current-graph"
            ? [WORKFLOW_STATE_PATH, STEP_HISTORY_PATH]
            : [];

      if (deleteTargets.length > 0) {
        await deleteWorkspaceArtifacts(deleteTargets);
      }

      const graphHash =
        persistedDiagramDocument.nodes.length > 0 || persistedDiagramDocument.edges.length > 0
          ? computeDiagramHash(persistedDiagramDocument)
          : null;
      const manifest = createWorkspaceManifest(
        workspaceBootstrap?.resume.manifest ?? null,
        decisionKind === "analyze-existing-code" ? "codebase-intake" : decisionKind === "trust-current-graph" ? "graph-adopted" : "initialized",
        graphHash,
      );

      const decisionAppliedAt = new Date().toISOString();
      const trustCurrentApprovedDiagram =
        decisionKind === "trust-current-graph" ? createApprovedDiagramDocument(persistedDiagramDocument) : null;
      const trustCurrentWorkflowState =
        decisionKind === "trust-current-graph"
          ? createWorkflowStateArtifact({
              currentDiagram: persistedDiagramDocument,
              approvedDiagram: trustCurrentApprovedDiagram,
              stepHistory: [],
              selectedNodeIds: [],
              lastSpecMode: null,
              specGeneratedAt: null,
              lastBuildMode: null,
              lastBuildAt: null,
              approvedAt: decisionAppliedAt,
            })
          : null;

      const artifactsToWrite = [
        {
          path: MANIFEST_PATH,
          content: JSON.stringify(manifest, null, 2),
        },
        {
          path: RESUME_STATE_PATH,
          content: JSON.stringify(
            {
              version: 1,
              ownershipKind: resumeBranch.kind,
              branchKind: internalResumeBranch.kind,
              decisionKind,
              decidedAt: decisionAppliedAt,
              graphHash,
            },
            null,
            2,
          ),
        },
      ];

      if (trustCurrentApprovedDiagram && trustCurrentWorkflowState) {
        artifactsToWrite.push(
          {
            path: APPROVED_DIAGRAM_PATH,
            content: JSON.stringify(trustCurrentApprovedDiagram, null, 2),
          },
          {
            path: WORKFLOW_STATE_PATH,
            content: JSON.stringify(trustCurrentWorkflowState, null, 2),
          },
        );
      }

      await writeWorkspaceArtifacts(artifactsToWrite);

      if (decisionKind === "initialize-fresh-workflow") {
        const fresh = createInitialFlow();
        setNodes(fresh.nodes);
        setEdges(fresh.edges);
        invalidatePreparedSpec();
        setDiagramResult(null);
        setDiagramError("");
      } else if (decisionKind === "trust-current-graph") {
        setApprovedDiagram(trustCurrentApprovedDiagram);
        setApprovedAt(decisionAppliedAt);
        setStepHistory([]);
        setLastSelectionBuildNodeId(null);
        invalidatePreparedSpec();
      }

      if (decisionKind === "analyze-existing-code" && !diagramBrief.trim()) {
        setDiagramBrief(buildCodeAwareBrief());
      }

      await reloadNativeWorkspace(workspaceRootPath);

      if (decisionKind === "initialize-fresh-workflow") {
        setWorkspaceNotice("Fresh graph workflow로 전환했습니다. 이제 Harness와 Brief를 고정하면 됩니다.");
      } else if (decisionKind === "trust-current-graph") {
        setWorkspaceNotice("현재 graph를 기준으로 resume 경로를 고정했습니다.");
      } else {
        setWorkspaceNotice("기존 코드베이스를 기준으로 graph workflow를 시작하도록 표시했습니다.");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "resume 분기를 적용하지 못했습니다.";
      setWorkspaceNotice(message);
    }
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

  const getSelectionApprovalError = () => {
    if (!approvedDiagram) {
      return "먼저 Approve Graph로 현재 diagram을 개발 기준 source of truth로 확정해야 합니다.";
    }

    if (graphApprovalStale) {
      return "현재 draft diagram이 승인된 graph와 다릅니다. Build 전에 Approve Graph로 다시 확정해야 합니다.";
    }

    if (selectedExecutableNodeIds.length !== 1) {
      return "Selection 단계는 approved graph 기준으로 정확히 1개의 executable node만 선택해야 합니다.";
    }

    const selectedNodeId = selectedExecutableNodeIds[0];
    const state = getNodeExecutionState(approvedDiagram, selectedNodeId, stepHistory);

    if (state === "annotation") {
      return "선택한 노드는 annotation 용도입니다. executable node 1개를 선택해야 step build를 진행할 수 있습니다.";
    }

    if (state === "approved") {
      return "현재 선택한 step은 이미 승인되었습니다. 다음 reachable step을 선택하거나 graph를 수정한 뒤 다시 승인하세요.";
    }

    if (state !== "reachable") {
      return "현재 선택한 step은 아직 reachable하지 않습니다. 선행 step을 먼저 승인해야 합니다.";
    }

    return "";
  };

  const generateSpec = async (mode: "full" | "selection") => {
    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      const message = `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`;
      setError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (!approvedDiagram) {
      const message = "먼저 Approve Graph로 현재 diagram을 개발 기준 source of truth로 확정해야 합니다.";
      setError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (graphApprovalStale) {
      const message = "현재 draft diagram이 승인된 graph와 다릅니다. Spec 전에 Approve Graph로 다시 확정해야 합니다.";
      setError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    const selectionError = mode === "selection" ? getSelectionApprovalError() : "";
    if (selectionError) {
      setError(selectionError);
      setWorkspaceNotice(selectionError);
      setActiveAuxPanel("ai");
      return;
    }

    setLoading(true);
    setError("");
    setActiveAuxPanel("ai");

    try {
      const diagramForSpec =
        mode === "selection" && selectedReachableNodeId
          ? createScopedApprovedDiagram(approvedDiagram, [selectedReachableNodeId])
          : createScopedApprovedDiagram(approvedDiagram, []);
      const response = await fetch("/api/ai/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagram: diagramForSpec,
          requestedMode: mode,
        }),
      });

      const data = (await response.json()) as SpecResponse & { message?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "스펙 생성에 실패했습니다.");
      }

      setResult(data);
      setPreparedSpec(data);
      setLastSpecMode(mode);
      setPreparedSpecMode(mode);
      setBuildResult(null);
      setBuildError("");
      setWorkspaceNotice(mode === "selection" ? "Selection spec is ready." : "Full spec is ready.");
      setActiveEditor("spec");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "스펙 생성에 실패했습니다.";
      setError(message);
      setWorkspaceNotice(message);
    } finally {
      setLoading(false);
    }
  };

  const generateDiagramFromBrief = async (strategy: "replace" | "augment") => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      setDiagramError("먼저 Open Folder로 실제 작업 폴더를 열어야 합니다.");
      setActiveAuxPanel("ai");
      return;
    }

    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      setDiagramError(`${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`);
      setActiveAuxPanel("ai");
      return;
    }

    if (!harnessConfig) {
      setDiagramError("먼저 Edit Harness에서 프로젝트 하네스를 고정해야 합니다.");
      setIsSetupOpen(true);
      setActiveAuxPanel("ai");
      return;
    }

    if (!auth?.codexAuthenticated) {
      setDiagramError("Codex/GPT-5.4 로그인 상태가 ready여야 초기 diagram 생성을 시작할 수 있습니다.");
      setActiveAuxPanel("ai");
      return;
    }

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
      const intakeContext = await buildDiagramIntakeContext();
      const response = await fetch("/api/ai/diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: trimmedBrief,
          strategy,
          harness: harnessConfig,
          diagram,
          intakeContext,
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
      const nextDiagramDocument = createApprovedDiagramDocument(buildDiagramDocument(nextFlow.nodes, nextFlow.edges, []));

      if (workspaceMode === "native" && workspaceRootPath) {
        const serializedDiagram = JSON.stringify(nextDiagramDocument, null, 2);
        setDiagramPersisting(true);
        await writeWorkspaceArtifacts([
          {
            path: DIAGRAM_ARTIFACT_PATH,
            content: serializedDiagram,
          },
        ]);
        lastPersistedDiagramContentRef.current = serializedDiagram;
        setLastDiagramSavedAt(new Date().toISOString());
        setDiagramDirty(false);
        setDiagramPersisting(false);
      }

      setNodes(nextFlow.nodes);
      setEdges(nextFlow.edges);
      setDiagramResult(data);
      setResult(null);
      setPreparedSpec(null);
      setLastSpecMode(null);
      setPreparedSpecMode(null);
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
      setDiagramPersisting(false);
      setDiagramError(caught instanceof Error ? caught.message : "기본 diagram 생성에 실패했습니다.");
    } finally {
      if (requestId === diagramRequestIdRef.current) {
        setDiagramLoading(false);
      }
    }
  };

  const buildCode = async (mode: "full" | "selection") => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      const message = "코드 생성은 Open Folder로 연 native workspace에서만 실행할 수 있습니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      const message = `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`;
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (!approvedDiagram) {
      const message = "먼저 Approve Graph로 현재 diagram을 개발 기준 source of truth로 확정해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (graphApprovalStale) {
      const message = "현재 draft diagram이 승인된 graph와 다릅니다. Build 전에 Approve Graph로 다시 확정해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (loading) {
      const message =
        mode === "selection"
          ? "Selection spec을 아직 생성 중입니다. 완료된 뒤 Build Selection Code를 실행해야 합니다."
          : "Full spec을 아직 생성 중입니다. 완료된 뒤 Build Full Code를 실행해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (mode === "selection") {
      const selectionError = getSelectionApprovalError();
      if (selectionError) {
        setBuildError(selectionError);
        setWorkspaceNotice(selectionError);
        setActiveAuxPanel("ai");
        return;
      }
    }

    if (!activeSpec) {
      const message =
        mode === "selection"
          ? "아직 Selection spec 결과가 없습니다. 먼저 Generate Selection Spec을 실행해야 합니다."
          : "아직 Full spec 결과가 없습니다. 먼저 Generate Full Spec을 실행해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (activeSpecMode !== mode) {
      const message =
        mode === "selection"
          ? "현재는 Full spec만 준비되어 있습니다. Build Selection Code를 하려면 Generate Selection Spec을 다시 실행해야 합니다."
          : "현재는 Selection spec만 준비되어 있습니다. Build Full Code를 하려면 Generate Full Spec을 다시 실행해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    if (
      mode === "selection"
      && (
        !selectedReachableNodeId
        || activeSpec.spec.scopeContract.selectedNodeIds.length !== 1
        || activeSpec.spec.scopeContract.selectedNodeIds[0] !== selectedReachableNodeId
      )
    ) {
      const message = "현재 선택한 reachable step과 준비된 Selection spec이 다릅니다. Generate Selection Spec을 다시 실행해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      setActiveAuxPanel("ai");
      return;
    }

    const prompt = mode === "selection" ? activeSpec.spec.iterationPrompt : activeSpec.spec.buildPrompt;
    const stepContract =
      mode === "selection" && approvedDiagram && selectedReachableNodeId
        ? createSelectionStepBuildContract(approvedDiagram, selectedReachableNodeId, activeSpec.spec.scopeContract)
        : null;
    setBuildLoading(true);
    setBuildError("");
    setBuildResult(null);
    setWorkspaceNotice(mode === "selection" ? "Building selected code in workspace..." : "Building full code in workspace...");
    setActiveAuxPanel("ai");

    try {
      if (mode === "selection") {
        setLastSelectionBuildNodeId(selectedReachableNodeId);
      } else {
        setLastSelectionBuildNodeId(null);
      }
      const response = await fetch("/api/ai/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          requestedMode: mode,
          rootPath: workspaceRootPath,
          harness: harnessConfig,
          stepContract,
        }),
      });

      const data = (await response.json()) as BuildResponse & {
        message?: string;
        error?: string;
        ok?: boolean;
        logPath?: string;
        promptPath?: string;
        partialOutput?: string;
      };
      if (!response.ok || !data.ok) {
        const message = data.error || data.message || "코드 생성에 실패했습니다.";
        const detail = [
          message,
          typeof data.attemptCount === "number" ? `Attempts: ${data.attemptCount}` : "",
          data.logPath ? `Log: ${data.logPath}` : "",
          data.promptPath ? `Prompt: ${data.promptPath}` : "",
          data.contractPath ? `Step contract: ${data.contractPath}` : "",
          data.mistakePath ? `Mistake log: ${data.mistakePath}` : "",
          data.partialOutput ? `Last output:\n${data.partialOutput.split("\n").slice(-14).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        throw new Error(detail);
      }

      await reloadNativeWorkspace(workspaceRootPath);
      setBuildResult(data);
      setWorkspaceNotice(
        mode === "selection"
          ? data.recovered
            ? `Selection code was written into the workspace after ${data.attemptCount} attempts.`
            : "Selection code was written into the workspace."
          : data.recovered
            ? `Full code build was written into the workspace after ${data.attemptCount} attempts.`
            : "Full code build was written into the workspace.",
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "코드 생성에 실패했습니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
    } finally {
      setBuildLoading(false);
    }
  };

  const approveCurrentDiagram = async () => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      const message = "Graph approval은 Open Folder로 연 native workspace에서만 할 수 있습니다.";
      setGraphApprovalError(message);
      setWorkspaceNotice(message);
      return;
    }

    if (diagram.nodes.length === 0) {
      const message = "Approve Graph 전에 현재 diagram이 있어야 합니다.";
      setGraphApprovalError(message);
      setWorkspaceNotice(message);
      return;
    }

    setGraphApprovalLoading(true);
    setGraphApprovalError("");

    try {
      const nextApprovedDiagram = createApprovedDiagramDocument(diagram);
      const nextApprovedHash = computeDiagramHash(nextApprovedDiagram);
      const canPreserveStepHistory = approvedDiagramHash === nextApprovedHash;
      const nextStepHistory = canPreserveStepHistory ? sanitizeStepHistoryEntries(nextApprovedDiagram, stepHistory) : [];
      const nextApprovedAt = new Date().toISOString();

      await writeWorkspaceArtifacts([
        {
          path: APPROVED_DIAGRAM_PATH,
          content: JSON.stringify(nextApprovedDiagram, null, 2),
        },
        {
          path: STEP_HISTORY_PATH,
          content: JSON.stringify(
            {
              version: 1,
              entries: nextStepHistory,
            },
            null,
            2,
          ),
        },
      ]);

      setApprovedDiagram(nextApprovedDiagram);
      setApprovedAt(nextApprovedAt);
      setStepHistory(nextStepHistory);
      invalidatePreparedSpec();
      setBuildResult(null);
      setLastSelectionBuildNodeId(null);
      setWorkspaceNotice(
        canPreserveStepHistory
          ? "Current graph를 다시 승인했습니다. 기존 step progress를 유지합니다."
          : "Current graph를 승인했습니다. graph가 바뀌었으므로 step progress를 초기화했습니다.",
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Graph approval에 실패했습니다.";
      setGraphApprovalError(message);
      setWorkspaceNotice(message);
    } finally {
      setGraphApprovalLoading(false);
    }
  };

  const approveCurrentStep = async () => {
    if (!approvedDiagram || !buildResult || buildResult.mode !== "selection" || !lastSelectionBuildNodeId) {
      const message = "먼저 current reachable step에 대해 Selection build를 성공시켜야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      return;
    }

    if (!workflowProgress.reachableNodeIds.includes(lastSelectionBuildNodeId)) {
      const message = "현재 build 결과는 더 이상 reachable한 step과 일치하지 않습니다. Selection spec/build를 다시 실행해야 합니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
      return;
    }

    try {
      const nextEntry: StepHistoryEntry = {
        nodeId: lastSelectionBuildNodeId,
        approvedAt: new Date().toISOString(),
        buildMode: "selection",
        buildGeneratedAt: buildResult.generatedAt,
        buildLogPath: buildResult.logPath ?? null,
        buildPromptPath: buildResult.promptPath ?? null,
        verificationSummary: [
          "Selection build completed.",
          buildResult.logPath ? `Log: ${buildResult.logPath}` : "",
          buildResult.promptPath ? `Prompt: ${buildResult.promptPath}` : "",
        ].filter(Boolean),
      };
      const nextStepHistory = [
        ...stepHistory.filter((entry) => entry.nodeId !== lastSelectionBuildNodeId),
        nextEntry,
      ];

      await writeWorkspaceArtifacts([
        {
          path: STEP_HISTORY_PATH,
          content: JSON.stringify(
            {
              version: 1,
              entries: nextStepHistory,
            },
            null,
            2,
          ),
        },
      ]);

      setStepHistory(nextStepHistory);
      invalidatePreparedSpec();
      setBuildResult(null);
      setLastSelectionBuildNodeId(null);
      setWorkspaceNotice("Current step를 승인했습니다. 다음 reachable step이 열렸습니다.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Step approval에 실패했습니다.";
      setBuildError(message);
      setWorkspaceNotice(message);
    }
  };

  const saveHarness = async (config: HarnessConfig) => {
    if (workspaceMode !== "native" || !workspaceRootPath) {
      const message = "Harness 저장은 Open Folder로 연 native workspace에서만 할 수 있습니다.";
      setWorkspaceNotice(message);
      throw new Error(message);
    }

    if (hasPendingResumeDecision && resumeBranch && internalResumeBranch) {
      const message = `${resumeBranch.label} / ${internalResumeBranch.label}: ${internalResumeBranch.recommendedAction}`;
      setWorkspaceNotice(message);
      throw new Error(message);
    }

    const graphHash =
      persistedDiagramDocument.nodes.length > 0 || persistedDiagramDocument.edges.length > 0
        ? computeDiagramHash(persistedDiagramDocument)
        : null;
    const manifest = createWorkspaceManifest(workspaceBootstrap?.resume.manifest ?? null, "harness-fixed", graphHash);
    const artifacts = [
      {
        path: MANIFEST_PATH,
        content: JSON.stringify(manifest, null, 2),
      },
      ...buildHarnessArtifacts(config),
    ];
    setSuggestedPreset(config.presetId);
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

    setHarnessConfig(config);
    setActiveEditor("harness");
  };

  const renderResumeDecisionScreen = () => {
    if (!resumeBranch || !internalResumeBranch) {
      return null;
    }

    const actions =
      internalResumeBranch.kind === "external-codebase"
        ? [
            {
              id: "initialize-fresh-workflow" as const,
              label: "Fresh Graph Workflow",
              description: "기존 코드는 유지하고, 이 폴더에서 새 graph workflow를 시작합니다.",
              tone: "primary",
            },
            {
              id: "analyze-existing-code" as const,
              label: "Use Current Code As Input",
              description: "현재 코드 구조를 바탕으로 다음 graph 초안을 만들 수 있게 이 workspace를 고정합니다.",
              tone: "secondary",
            },
          ]
        : internalResumeBranch.kind === "legacy-graphcoding-artifacts"
          ? [
              {
                id: "trust-current-graph" as const,
                label: "Adopt Saved Graph",
                description: "현재 저장된 graph 흔적을 source of truth로 삼아 이 폴더를 managed workspace로 편입합니다.",
                tone: "primary",
              },
              ...(workspaceBootstrap?.resume.hasCodeSignals
                ? [
                    {
                      id: "analyze-existing-code" as const,
                      label: "Use Current Code As Input",
                      description: "저장된 legacy graph 대신 현재 코드 구조를 읽어서 새 diagram 초안을 만들게 합니다.",
                      tone: "secondary",
                    },
                  ]
                : []),
              {
                id: "initialize-fresh-workflow" as const,
                label: "Start Fresh Workflow",
                description: "기존 legacy graph/workflow 흔적을 버리고 새 managed workflow로 다시 시작합니다.",
                tone: "secondary",
              },
            ]
          : internalResumeBranch.kind === "managed-graph-without-code"
            || internalResumeBranch.kind === "managed-drifted-workspace"
          ? [
              {
                id: "trust-current-graph" as const,
                label: "Trust Current Graph",
                description: "현재 저장된 graph를 source of truth로 보고 이후 review와 step build를 이어갑니다.",
                tone: "primary",
              },
              {
                id: "initialize-fresh-workflow" as const,
                label: "Start Fresh Workflow",
                description: "저장된 graph/workflow 흔적을 지우고 새 workflow로 다시 시작합니다.",
                tone: "secondary",
              },
            ]
          : [];

    return (
      <section className="welcome-screen">
        <div className="welcome-card welcome-card--bootstrap resume-decision-card">
          <div className="editor-view__header">
            <div>
              <span className="editor-view__eyebrow">RESUME DECISION</span>
              <h2>{resumeBranch.label}</h2>
            </div>
            <span className="editor-chip">{internalResumeBranch.label}</span>
          </div>
          <div className="decision-copy">
            <p>{internalResumeBranch.reason}</p>
            <p>{internalResumeBranch.recommendedAction}</p>
          </div>
          <div className="decision-meta">
            <div>
              <span className="meta-label">Root</span>
              <strong>{workspaceRootPath ?? "No root"}</strong>
            </div>
            <div>
              <span className="meta-label">Ownership</span>
              <strong>{resumeBranch.label}</strong>
            </div>
            <div>
              <span className="meta-label">Code Signals</span>
              <strong>{workspaceBootstrap?.resume.codeSignalCount ?? 0}</strong>
            </div>
            <div>
              <span className="meta-label">Graph</span>
              <strong>{workspaceBootstrap?.resume.hasDiagram ? "present" : "missing"}</strong>
            </div>
            <div>
              <span className="meta-label">Workflow</span>
              <strong>{workspaceBootstrap?.resume.hasWorkflowState ? "present" : "missing"}</strong>
            </div>
          </div>
          {workspaceBootstrap?.resume.codeSignalFiles.length ? (
            <div className="bootstrap-chip-list">
              {workspaceBootstrap.resume.codeSignalFiles.slice(0, 8).map((filePath) => (
                <span key={filePath} className="editor-chip bootstrap-chip">
                  {filePath}
                </span>
              ))}
            </div>
          ) : null}
          <div className="decision-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                className={action.tone === "primary" ? "primary-button" : "secondary-button"}
                onClick={() => void resolveResumeBranch(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="decision-copy decision-copy--compact">
            {actions.map((action) => (
              <p key={`${action.id}-detail`}>
                <strong>{action.label}</strong>: {action.description}
              </p>
            ))}
          </div>
        </div>
      </section>
    );
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
    if (activeEditor === "diagram" && hasPendingResumeDecision) {
      return renderResumeDecisionScreen();
    }

    if (activeEditor === "harness") {
      return renderTextDocument(
        ".graphcoding/harness.json",
        harnessConfig ? JSON.stringify(harnessConfig, null, 2) : "No harness configured yet.",
        harnessConfig ? "workspace setup" : undefined,
      );
    }

    if (activeEditor === "graph") {
      return renderTextDocument(
        "diagram.graph.json",
        JSON.stringify(persistedDiagramDocument, null, 2),
        `${persistedDiagramDocument.nodes.length} nodes`,
      );
    }

    if (activeEditor === "spec") {
      if (!activeSpec) {
        return renderTextDocument("specification.md", "No generated specification yet.\n\nRun GPT-5.4 from the AI panel to generate one.");
      }

      return renderTextDocument(
        "specification.md",
        [
          `# ${activeSpec.spec.title}`,
          "",
          activeSpec.spec.overview,
          "",
          "## Whole Graph Understanding",
          activeSpec.spec.systemUnderstanding.fullGraphSummary,
          "",
          "### Product Goal",
          activeSpec.spec.systemUnderstanding.productGoal,
          "",
          "### Primary Flow",
          ...activeSpec.spec.systemUnderstanding.primaryFlow.map((item) => `- ${item}`),
          "",
          "### Major Subsystems",
          ...activeSpec.spec.systemUnderstanding.majorSubsystems.map((item) => `- ${item}`),
          "",
          "## Scope Contract",
          `Mode: ${activeSpec.spec.scopeContract.mode}`,
          "",
          `Current Step Goal: ${activeSpec.spec.scopeContract.currentStepGoal}`,
          "",
          "### Must Implement",
          ...activeSpec.spec.scopeContract.mustImplement.map((item) => `- ${item}`),
          "",
          "### Required Boundaries",
          ...activeSpec.spec.scopeContract.requiredBoundaries.map((item) => `- ${item}`),
          "",
          "### Out Of Scope",
          ...activeSpec.spec.scopeContract.outOfScope.map((item) => `- ${item}`),
          "",
          "### Done Criteria",
          ...activeSpec.spec.scopeContract.doneCriteria.map((item) => `- ${item}`),
          "",
          "### Test Criteria",
          ...activeSpec.spec.scopeContract.testCriteria.map((item) => `- ${item}`),
          "",
          "## Architecture",
          ...activeSpec.spec.architecture.map((item) => `- ${item}`),
          "",
          "## Execution Plan",
          ...activeSpec.spec.executionPlan.map((item, index) => `${index + 1}. ${item}`),
          "",
          "## Test Plan",
          ...activeSpec.spec.testPlan.map((item) => `- ${item}`),
          "",
          "## Recommendations",
          ...(activeSpec.spec.recommendations.length > 0
            ? activeSpec.spec.recommendations.map((item) => `- ${item.title} (${item.impact}): ${item.rationale}`)
            : ["- none"]),
        ].join("\n"),
        activeSpec.source,
      );
    }

    if (activeEditor === "buildPrompt") {
      return renderTextDocument(
        "build.prompt",
        activeSpec?.spec.buildPrompt ?? "Build prompt will appear after spec generation.",
        activeSpec?.generatedAt,
      );
    }

    if (activeEditor === "iterationPrompt") {
      return renderTextDocument(
        "iteration.prompt",
        activeSpec?.spec.iterationPrompt ?? "Iteration prompt will appear after spec generation.",
      );
    }

    if (activeFile) {
      return renderTextDocument(activeFile.path, filePreviews[activeFile.path] ?? "Loading preview...", `${activeFile.size} bytes`);
    }

    if (workspaceFiles.length === 0 && !harnessConfig) {
      return (
        <section className="welcome-screen">
          <div className="welcome-card welcome-card--bootstrap">
          <div className="welcome-layout">
              <div className="welcome-main">
                <span className="editor-view__eyebrow">Workspace Bootstrap</span>
                <h1>Open Folder is the real start.</h1>
                <p>
                  먼저 native workspace root를 고정하고, ignore 규칙으로 무거운 폴더를 걷어낸 뒤, harness와 GPT-5.4 runtime을 확인해야 Brief to Diagram이 열린다.
                </p>
                <div className="welcome-actions">
                  <button className="primary-button compact-button" onClick={() => void handleOpenFolder()}>
                    Open Folder
                  </button>
                  {canReopenLastWorkspace ? (
                    <button className="secondary-button compact-button" onClick={handleReopenLastWorkspace}>
                      Reopen Last Folder
                    </button>
                  ) : null}
                </div>
                <div className="welcome-metrics">
                  <div className="welcome-metric">
                    <strong>Open Folder</strong>
                    <span>Native workspace, writable builds, bootstrap metadata</span>
                  </div>
                  <div className="welcome-metric">
                    <strong>Edit Harness</strong>
                    <span>Preset, sandbox, tests, partial build policy</span>
                  </div>
                  <div className="welcome-metric">
                    <strong>Brief to Diagram</strong>
                    <span>GPT-5.4 creates the first whole-graph draft after runtime is ready</span>
                  </div>
                </div>
              </div>

              <div className="welcome-checklist">
                <div className="welcome-checklist__header">
                  <strong>Bootstrap Checklist</strong>
                  <span>{bootstrapChecks.filter((check) => check.ready).length}/{bootstrapChecks.length} ready</span>
                </div>
                <div className="welcome-step-list">
                  {bootstrapChecks.map((check) => (
                    <div key={check.id} className={`welcome-step ${check.ready ? "is-ready" : ""}`}>
                      <div className="welcome-step__state">{check.ready ? "✓" : "•"}</div>
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {lastNativeWorkspaceRoot ? (
                  <div className="welcome-last-root">
                    <span className="meta-label">Last Native Workspace</span>
                    <strong>{lastNativeWorkspaceRoot}</strong>
                  </div>
                ) : (
                  <div className="welcome-last-root">
                    <span className="meta-label">Last Native Workspace</span>
                    <strong>No previous native workspace recorded yet.</strong>
                  </div>
                )}
                {workspaceBootstrap?.warnings.length ? (
                  <div className="welcome-last-root">
                    <span className="meta-label">Bootstrap Warnings</span>
                    <strong>{workspaceBootstrap.warnings.join(" ")}</strong>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="welcome-grid">
              <div>
                <strong>Ignored Paths</strong>
                <span>.git, node_modules, dist, build, .next, coverage and similar heavy folders stay out of the tree.</span>
              </div>
              <div>
                <strong>Saved Files</strong>
                <span>.graphcoding/harness.json, project-profile.md, build-policy.json</span>
              </div>
              <div>
                <strong>Native Only</strong>
                <span>실제 개발과 누적 build는 Open Folder로 연 native workspace 하나만 기준으로 진행한다.</span>
              </div>
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
            <span className="editor-chip">
              {selectedNodes.length > 0 || selectedEdges.length > 0
                ? `${selectedNodes.length} nodes / ${selectedEdges.length} edges selected`
                : "full scope"}
            </span>
            <span className={`editor-chip ${diagramPersisting ? "is-saving" : diagramDirty ? "is-dirty" : "is-saved"}`}>
              {diagramPersisting ? "saving..." : diagramDirty ? "unsaved edits" : lastDiagramSavedAt ? "saved" : "clean"}
            </span>
            <button className="ghost-button compact-button" onClick={duplicateSelectedNode} disabled={!selectedNode}>
              Duplicate Node
            </button>
            <button className="ghost-button compact-button" onClick={deleteSelection} disabled={selectedNodes.length === 0 && selectedEdges.length === 0}>
              Delete Selection
            </button>
            <button className="ghost-button compact-button" onClick={clearSelection} disabled={selectedNodes.length === 0 && selectedEdges.length === 0}>
              Clear Selection
            </button>
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
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
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
        <div className="title-bar__menus">
          <span>File</span>
          <span>Edit</span>
          <span>Selection</span>
          <span>View</span>
          <span>Go</span>
          <span>Run</span>
          <span>Terminal</span>
          <span>Help</span>
        </div>
        <div className="title-bar__center">Graph Coding GPT Prototype</div>
        <div className="title-bar__actions">
          <button className="ghost-button compact-button title-action-button" onClick={handleOpenSetup}>
            Workspace Setup
          </button>
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
          workspaceMode={workspaceMode}
          workspaceRootPath={workspaceRootPath}
          workspaceBootstrap={workspaceBootstrap}
          workspaceTree={workspaceTree}
          editorTabs={editorTabs}
          activeEditor={activeEditor}
          bootstrapChecks={bootstrapChecks}
          onOpenFolder={() => void handleOpenFolder()}
          onReloadWorkspace={() => {
            if (!workspaceRootPath) {
              return;
            }
            void reloadNativeWorkspace(workspaceRootPath)
              .then(() => setWorkspaceNotice(`Reloaded ${workspaceRootPath}`))
              .catch((caught: unknown) =>
                setWorkspaceNotice(caught instanceof Error ? caught.message : "워크스페이스를 다시 불러오지 못했습니다."),
              );
          }}
          onReopenLastWorkspace={handleReopenLastWorkspace}
          onSelectEditor={setActiveEditor}
          onSelectFile={handleSelectWorkspaceFile}
          onAddNode={addNodeOfType}
          onResetDiagram={resetFlow}
          harnessConfig={harnessConfig}
          canReopenLastWorkspace={canReopenLastWorkspace}
          onOpenSetup={handleOpenSetup}
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

          <BottomPanel diagram={diagram} result={activeSpec} error={error} loading={loading} />
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
                canGenerateDiagram={canGenerateDiagram}
                diagramGenerationHint={diagramGenerationHint}
                diagramLoading={diagramLoading}
                diagramResult={diagramResult}
                diagramError={diagramError}
                hasApprovedDiagram={Boolean(approvedDiagram)}
                approvedAt={approvedAt}
                graphApprovalStale={graphApprovalStale}
                graphApprovalLoading={graphApprovalLoading}
                graphApprovalError={graphApprovalError}
                reachableCount={workflowProgress.reachableNodeIds.length}
                approvedCount={workflowProgress.approvedNodeIds.length}
                blockedCount={workflowProgress.blockedNodeIds.length}
                finalWorkflowStatus={workflowProgress.finalStatus}
                selectedStepState={selectedStepState}
                selectedStepTitle={selectedStepTitle}
                loading={loading}
                result={activeSpec}
                error={error}
                lastSpecMode={activeSpecMode}
                buildLoading={buildLoading}
                buildResult={buildResult}
                buildError={buildError}
                canBuildInWorkspace={workspaceMode === "native" && Boolean(workspaceRootPath)}
                buildHint={
                  workspaceMode === "native" && workspaceRootPath
                    ? "해당 범위의 spec을 먼저 만든 뒤, 아래 버튼으로 현재 폴더에 직접 코드를 작성합니다."
                    : "먼저 Open Folder로 실제 폴더를 열고, 해당 범위의 spec을 생성한 뒤 코드를 작성할 수 있습니다."
                }
                canBuildSelection={workspaceMode === "native" && Boolean(workspaceRootPath) && Boolean(activeSpec) && activeSpecMode === "selection"}
                canBuildFull={workspaceMode === "native" && Boolean(workspaceRootPath) && Boolean(activeSpec) && activeSpecMode === "full"}
                canApproveGraph={canApproveGraph}
                canApproveStep={canApproveStep}
                onBriefChange={setDiagramBrief}
                onGenerateDiagram={generateDiagramFromBrief}
                onGenerate={generateSpec}
                onBuild={buildCode}
                onApproveGraph={() => void approveCurrentDiagram()}
                onApproveStep={() => void approveCurrentStep()}
              />
            ) : (
              <InspectorPanel
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                selectedNodeCount={selectedNodes.length}
                onNodeFieldChange={updateNodeField}
                onEdgeFieldChange={updateEdgeField}
                onDuplicateNode={duplicateSelectedNode}
                onDeleteSelection={deleteSelection}
                onClearSelection={clearSelection}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="status-bar">
        <div className="status-bar__left">
          <span>main</span>
          <span>{workspaceName}</span>
          <span>{workspaceBootstrap?.workspaceKind ?? workspaceMode}</span>
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
        canWriteToWorkspace={workspaceMode === "native"}
        onClose={() => setIsSetupOpen(false)}
        onSave={saveHarness}
      />
    </div>
  );
}

function selectedNodesLength(nodes: DiagramNodeType[]) {
  return nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0);
}

function isTextEditingElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}
