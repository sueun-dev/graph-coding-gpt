import type { Edge, Node } from "@xyflow/react";

export type ShapeType =
  | "startEnd"
  | "screen"
  | "process"
  | "decision"
  | "input"
  | "database"
  | "api"
  | "service"
  | "queue"
  | "state"
  | "event"
  | "auth"
  | "external"
  | "document"
  | "note"
  | "group";

export type NodeStatus = "planned" | "active" | "blocked" | "done";
export type LineStyle = "smoothstep" | "straight" | "step";

export type DiagramNodeData = {
  shape: ShapeType;
  title: string;
  actor: string;
  intent: string;
  behavior: string;
  inputs: string;
  outputs: string;
  notes: string;
  testHint: string;
  status: NodeStatus;
  accent: string;
};

export type DiagramEdgeData = {
  relation: string;
  notes: string;
  lineStyle: LineStyle;
  animated: boolean;
};

export type DiagramNode = Node<DiagramNodeData>;
export type DiagramEdge = Edge<DiagramEdgeData>;

export type DiagramDocument = {
  title: string;
  summary: string;
  nodes: Array<{
    id: string;
    shape: ShapeType;
    title: string;
    actor: string;
    intent: string;
    behavior: string;
    inputs: string;
    outputs: string;
    notes: string;
    testHint: string;
    status: NodeStatus;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: string;
    notes: string;
    lineStyle: LineStyle;
    animated: boolean;
  }>;
  scope: {
    mode: "full" | "selection";
    nodeIds: string[];
  };
};

export type ShapeDefinition = {
  type: ShapeType;
  label: string;
  description: string;
  accent: string;
};

export type SystemUnderstanding = {
  productGoal: string;
  fullGraphSummary: string;
  primaryFlow: string[];
  majorSubsystems: string[];
  coordinationRisks: string[];
};

export type ScopeContract = {
  mode: "full" | "selection";
  selectedNodeIds: string[];
  selectedNodeTitles: string[];
  currentStepGoal: string;
  mustImplement: string[];
  requiredBoundaries: string[];
  outOfScope: string[];
  implementationOrder: string[];
  doneCriteria: string[];
  testCriteria: string[];
};

export type Recommendation = {
  title: string;
  rationale: string;
  implementationHint: string;
  impact: "low" | "medium" | "high";
};

export type SpecResponse = {
  ok: boolean;
  source: "codex" | "fallback";
  generatedAt: string;
  spec: {
    title: string;
    overview: string;
    systemUnderstanding: SystemUnderstanding;
    scopeContract: ScopeContract;
    architecture: string[];
    executionPlan: string[];
    nodeSummaries: Array<{
      nodeId: string;
      role: string;
      summary: string;
      implementationHint: string;
      testHint: string;
    }>;
    filePlan: string[];
    testPlan: string[];
    buildPrompt: string;
    iterationPrompt: string;
    assumptions: string[];
    recommendations: Recommendation[];
  };
  raw?: string;
  error?: string;
};

export type DiagramBlueprint = {
  title: string;
  summary: string;
  nodes: Array<{
    key: string;
    shape: ShapeType;
    title: string;
    actor: string;
    intent: string;
    behavior: string;
    inputs: string;
    outputs: string;
    notes: string;
    testHint: string;
    status: NodeStatus;
  }>;
  edges: Array<{
    sourceKey: string;
    targetKey: string;
    relation: string;
    notes: string;
    lineStyle: LineStyle;
    animated: boolean;
  }>;
};

export type DiagramGenerationResponse = {
  ok: boolean;
  source: "codex" | "fallback";
  generatedAt: string;
  diagram: DiagramBlueprint;
  raw?: string;
  error?: string;
};

export type BuildResponse = {
  ok: boolean;
  source: "codex";
  generatedAt: string;
  mode: "full" | "selection";
  workspaceRoot: string;
  promptKind: "buildPrompt" | "iterationPrompt";
  output: string;
  promptPath?: string;
  logPath?: string;
  mistakePath?: string;
  contractPath?: string;
  attemptCount?: number;
  recovered?: boolean;
  error?: string;
};

export type NativeWorkspaceEntry = {
  path: string;
  size: number;
  type: string;
};

export type WorkspaceManifest = {
  marker: string;
  app: string;
  formatVersion: number;
  workspaceId: string;
  createdAt: string | null;
  lastOpenedAt: string | null;
  graphHash: string | null;
  state: string | null;
};

export type StepExecutionState = "annotation" | "approved" | "reachable" | "blocked";

export type StepHistoryEntry = {
  nodeId: string;
  approvedAt: string;
  buildMode: "selection";
  buildGeneratedAt: string | null;
  buildLogPath: string | null;
  buildPromptPath: string | null;
  verificationSummary: string[];
};

export type StepHistoryDocument = {
  version: 1;
  entries: StepHistoryEntry[];
};

export type StepBuildContract = {
  version: 1;
  mode: "selection";
  selectedNodeId: string;
  selectedNodeTitle: string;
  selectedNodeShape: ShapeType;
  requiredBoundaries: string[];
  outOfScope: string[];
  maxTouchedFiles: number;
  allowPackageJsonChanges: boolean;
  allowLockfileChanges: boolean;
  allowRoutingChanges: boolean;
  allowedTestTargets: string[];
  forbiddenFeatureKeywords: string[];
};

export type WorkflowStateArtifact = {
  version: 2;
  graphHash: string | null;
  approvedGraphHash: string | null;
  approvedAt: string | null;
  approvalStale: boolean;
  approvedNodeIds: string[];
  reachableNodeIds: string[];
  blockedNodeIds: string[];
  selectedNodeIds: string[];
  lastSpecMode: "full" | "selection" | null;
  specGeneratedAt: string | null;
  lastBuildMode: "full" | "selection" | null;
  lastBuildAt: string | null;
  finalStatus: "in-progress" | "complete";
};

export type ResumeBranchStatus = {
  kind: string;
  label: string;
  reason: string;
  recommendedAction: string;
  needsDecision: boolean;
};

export type WorkspaceBootstrapStatus = {
  rootPath: string;
  rootName: string;
  workspaceKind: string;
  workspaceSummary: string;
  fileCount: number;
  ignoredDirectoryCount: number;
  ignoredDirectories: string[];
  symlinkEntryCount: number;
  symlinkEntries: string[];
  hasHarness: boolean;
  projectMarkers: string[];
  entryFiles: string[];
  warnings: string[];
  resume: {
    hasManifest: boolean;
    manifest: WorkspaceManifest | null;
    hasHarness: boolean;
    hasDiagram: boolean;
    hasWorkflowState: boolean;
    hasStepHistory: boolean;
    hasResumeState: boolean;
    hasCodeSignals: boolean;
    codeSignalCount: number;
    codeSignalFiles: string[];
    graphHash: string | null;
    graphHashMatches: boolean | null;
    hasWorkflowBuildEvidence: boolean;
    resumeDecision: {
      decisionKind: string | null;
      branchKind: string | null;
      decidedAt: string | null;
    } | null;
    resumeBranch: ResumeBranchStatus;
    internalBranch: ResumeBranchStatus;
  };
};

export type NativeWorkspaceResponse = {
  ok: boolean;
  rootPath?: string;
  rootName?: string;
  files?: NativeWorkspaceEntry[];
  bootstrap?: WorkspaceBootstrapStatus;
  error?: string;
};

export type WorkspaceFile = {
  id: string;
  path: string;
  name: string;
  parts: string[];
  size: number;
  type: string;
  file: File;
  source?: "browser" | "native";
  rootPath?: string;
};

export type WorkspaceTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  children: WorkspaceTreeNode[];
  file?: WorkspaceFile;
};

export type EditorTab =
  | {
      id: "diagram";
      label: string;
      kind: "diagram";
      closeable: false;
    }
  | {
      id: "graph";
      label: string;
      kind: "graph";
      closeable: false;
    }
  | {
      id: "harness";
      label: string;
      kind: "harness";
      closeable: false;
    }
  | {
      id: "spec";
      label: string;
      kind: "spec";
      closeable: false;
    }
  | {
      id: "buildPrompt";
      label: string;
      kind: "buildPrompt";
      closeable: false;
    }
  | {
      id: "iterationPrompt";
      label: string;
      kind: "iterationPrompt";
      closeable: false;
    }
  | {
      id: string;
      label: string;
      kind: "file";
      closeable: true;
      path: string;
    };

export type HarnessPresetId = "saas-web" | "api-service" | "agent-tool" | "desktop-app" | "mobile-app";
export type HarnessSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type HarnessConfig = {
  version: 1;
  presetId: HarnessPresetId;
  projectName: string;
  projectGoal: string;
  stack: {
    appType: string;
    frontend: string;
    backend: string;
    runtime: string;
    packageManager: string;
    styling: string;
    database: string;
    auth: string;
  };
  agent: {
    primaryModel: "gpt-5.4";
    reasoningEffort: "medium" | "high" | "xhigh";
    sandbox: HarnessSandboxMode;
    tools: {
      mcp: boolean;
      shell: boolean;
      browser: boolean;
      applyPatch: boolean;
      fileSearch: boolean;
    };
  };
  quality: {
    lint: boolean;
    typecheck: boolean;
    unitTests: boolean;
    e2eTests: boolean;
    partialBuilds: boolean;
    requireTestsBeforeDone: boolean;
    allowStubsOutsideScope: boolean;
  };
  paths: {
    configDir: string;
    artifactDir: string;
    testsDir: string;
  };
  notes: string[];
};

export type HarnessPreset = {
  id: HarnessPresetId;
  label: string;
  tagline: string;
  description: string;
  defaults: HarnessConfig;
};

export type HarnessArtifact = {
  path: string;
  content: string;
};
