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

export type SpecResponse = {
  ok: boolean;
  source: "codex" | "fallback";
  generatedAt: string;
  spec: {
    title: string;
    overview: string;
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

export type NodeBuildStatus =
  | "pending"
  | "implementing"
  | "testing"
  | "fixing"
  | "done"
  | "failed";

export type NodeTestResult = {
  passed: boolean;
  failures: string[];
  stdout: string;
  stderr: string;
};

export type NodeBuildRecord = {
  nodeId: string;
  nodeTitle: string;
  nodeShape: ShapeType;
  status: NodeBuildStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  files: string[];
  lastOutput: string;
  testResult: NodeTestResult | null;
  lastError?: string;
};

export type BuildLoopState = {
  running: boolean;
  paused: boolean;
  currentNodeId: string | null;
  order: string[];
  records: Record<string, NodeBuildRecord>;
  startedAt?: string;
  finishedAt?: string;
  failureReason?: string;
};

export type BuildNodeResponse = {
  ok: boolean;
  nodeId: string;
  status: NodeBuildStatus;
  attempts: number;
  files: string[];
  output: string;
  testResult: NodeTestResult | null;
  promptPath?: string;
  logPath?: string;
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

export type HarnessThemeMode = "dark" | "light" | "auto";
export type HarnessRadiusScale = "sharp" | "rounded" | "pill";
export type HarnessDensity = "compact" | "comfortable";

export type HarnessDesign = {
  theme: HarnessThemeMode;
  referenceStyle: string;
  palette: {
    primary: string;
    accent: string;
    background: string;
    foreground: string;
    muted: string;
    error: string;
  };
  radius: HarnessRadiusScale;
  density: HarnessDensity;
  typography: {
    heading: string;
    body: string;
    mono: string;
  };
  notes: string;
};

export type HarnessConfig = {
  version: 1;
  presetId: HarnessPresetId;
  projectName: string;
  stack: {
    appType: string;
    frontend: string;
    backend: string;
    runtime: string;
    packageManager: string;
    database: string;
    auth: string;
  };
  agent: {
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
  design: HarnessDesign;
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
