import type { DiagramDocument, StepBuildContract, StepExecutionState, StepHistoryEntry, WorkflowStateArtifact } from "./types";

const NON_EXECUTABLE_SHAPES = new Set(["note", "document", "group"]);

export const computeDiagramHash = (value: unknown) => {
  const normalizedValue =
    value && typeof value === "object" && "nodes" in value && "edges" in value
      ? {
          ...(value as Record<string, unknown>),
          scope: {
            mode: "full",
            nodeIds: [],
          },
        }
      : value;
  const text = JSON.stringify(normalizedValue);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `gcg-${hash.toString(16)}`;
};

export const isExecutableShape = (shape: string) => !NON_EXECUTABLE_SHAPES.has(shape);

export const isExecutableNodeId = (diagram: DiagramDocument, nodeId: string) =>
  diagram.nodes.some((node) => node.id === nodeId && isExecutableShape(node.shape));

export const sanitizeStepHistoryEntries = (diagram: DiagramDocument, entries: StepHistoryEntry[] | null | undefined) => {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!entry || typeof entry.nodeId !== "string" || seen.has(entry.nodeId)) {
      return false;
    }

    if (!isExecutableNodeId(diagram, entry.nodeId)) {
      return false;
    }

    seen.add(entry.nodeId);
    return true;
  });
};

export const getExecutableNodeIds = (diagram: DiagramDocument) =>
  diagram.nodes.filter((node) => isExecutableShape(node.shape)).map((node) => node.id);

export const computeReachableNodeIds = (diagram: DiagramDocument, approvedNodeIds: string[]) => {
  const approved = new Set(approvedNodeIds);

  return diagram.nodes
    .filter((node) => isExecutableShape(node.shape))
    .filter((node) => !approved.has(node.id))
    .filter((node) => {
      const predecessors = diagram.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => edge.source)
        .filter((sourceId) => isExecutableNodeId(diagram, sourceId));

      return predecessors.every((sourceId) => approved.has(sourceId));
    })
    .map((node) => node.id);
};

export const computeWorkflowProgress = (diagram: DiagramDocument, stepHistory: StepHistoryEntry[]) => {
  const approvedEntries = sanitizeStepHistoryEntries(diagram, stepHistory);
  const approvedNodeIds = approvedEntries.map((entry) => entry.nodeId);
  const executableNodeIds = getExecutableNodeIds(diagram);
  const reachableNodeIds = computeReachableNodeIds(diagram, approvedNodeIds);
  const reachableSet = new Set(reachableNodeIds);
  const approvedSet = new Set(approvedNodeIds);
  const blockedNodeIds = executableNodeIds.filter((nodeId) => !approvedSet.has(nodeId) && !reachableSet.has(nodeId));
  const finalStatus: "in-progress" | "complete" =
    executableNodeIds.length > 0 && executableNodeIds.every((nodeId) => approvedSet.has(nodeId)) ? "complete" : "in-progress";

  return {
    executableNodeIds,
    approvedNodeIds,
    reachableNodeIds,
    blockedNodeIds,
    finalStatus,
  };
};

export const getNodeExecutionState = (
  diagram: DiagramDocument,
  nodeId: string,
  stepHistory: StepHistoryEntry[],
): StepExecutionState => {
  const node = diagram.nodes.find((item) => item.id === nodeId);
  if (!node || !isExecutableShape(node.shape)) {
    return "annotation";
  }

  const { approvedNodeIds, reachableNodeIds } = computeWorkflowProgress(diagram, stepHistory);
  if (approvedNodeIds.includes(nodeId)) {
    return "approved";
  }
  if (reachableNodeIds.includes(nodeId)) {
    return "reachable";
  }
  return "blocked";
};

export const createApprovedDiagramDocument = (diagram: DiagramDocument): DiagramDocument => ({
  ...diagram,
  scope: {
    mode: "full",
    nodeIds: [],
  },
});

export const createScopedApprovedDiagram = (diagram: DiagramDocument, selectedNodeIds: string[]): DiagramDocument => ({
  ...diagram,
  scope: {
    mode: selectedNodeIds.length > 0 ? "selection" : "full",
    nodeIds: selectedNodeIds,
  },
});

export const createSelectionStepBuildContract = (diagram: DiagramDocument, selectedNodeId: string, scopeContract: {
  requiredBoundaries?: string[];
  outOfScope?: string[];
}): StepBuildContract | null => {
  const selectedNode = diagram.nodes.find((node) => node.id === selectedNodeId);
  if (!selectedNode || !isExecutableShape(selectedNode.shape)) {
    return null;
  }

  const shapeBudgets: Partial<Record<StepBuildContract["selectedNodeShape"], number>> = {
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

  const outOfScopeTitles = Array.isArray(scopeContract.outOfScope)
    ? scopeContract.outOfScope.map((entry) => String(entry).split(":")[0].trim()).filter(Boolean)
    : [];

  const derivedForbiddenKeywords = outOfScopeTitles
    .flatMap((title) => title.split(/[\s/,_-]+/))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);

  const genericForbiddenKeywords =
    selectedNode.shape === "startEnd"
      ? ["watchlist", "chart", "history", "alert", "notification", "settings", "admin", "manage"]
      : selectedNode.shape === "process" || selectedNode.shape === "service" || selectedNode.shape === "api" || selectedNode.shape === "database"
        ? ["dashboard", "page", "screen", "panel"]
        : [];

  return {
    version: 1,
    mode: "selection",
    selectedNodeId: selectedNode.id,
    selectedNodeTitle: selectedNode.title,
    selectedNodeShape: selectedNode.shape,
    requiredBoundaries: Array.isArray(scopeContract.requiredBoundaries) ? scopeContract.requiredBoundaries : [],
    outOfScope: Array.isArray(scopeContract.outOfScope) ? scopeContract.outOfScope : [],
    maxTouchedFiles: shapeBudgets[selectedNode.shape] ?? 8,
    allowPackageJsonChanges: false,
    allowLockfileChanges: false,
    allowRoutingChanges: selectedNode.shape === "screen",
    allowedTestTargets: [selectedNode.id, selectedNode.title, "launch", "smoke", "app"],
    forbiddenFeatureKeywords: Array.from(new Set([...genericForbiddenKeywords, ...derivedForbiddenKeywords])),
  };
};

export const createWorkflowStateArtifact = (params: {
  currentDiagram: DiagramDocument;
  approvedDiagram: DiagramDocument | null;
  stepHistory: StepHistoryEntry[];
  selectedNodeIds: string[];
  lastSpecMode: "full" | "selection" | null;
  specGeneratedAt: string | null;
  lastBuildMode: "full" | "selection" | null;
  lastBuildAt: string | null;
  approvedAt: string | null;
}): WorkflowStateArtifact => {
  const currentGraphHash =
    params.currentDiagram.nodes.length > 0 || params.currentDiagram.edges.length > 0 ? computeDiagramHash(params.currentDiagram) : null;
  const approvedGraphHash =
    params.approvedDiagram && (params.approvedDiagram.nodes.length > 0 || params.approvedDiagram.edges.length > 0)
      ? computeDiagramHash(params.approvedDiagram)
      : null;
  const progress = params.approvedDiagram
    ? computeWorkflowProgress(params.approvedDiagram, params.stepHistory)
    : {
        approvedNodeIds: [],
        reachableNodeIds: [],
        blockedNodeIds: [],
        finalStatus: "in-progress" as const,
      };

  return {
    version: 2,
    graphHash: currentGraphHash,
    approvedGraphHash,
    approvedAt: params.approvedAt,
    approvalStale: Boolean(approvedGraphHash && currentGraphHash && approvedGraphHash !== currentGraphHash),
    approvedNodeIds: progress.approvedNodeIds,
    reachableNodeIds: progress.reachableNodeIds,
    blockedNodeIds: progress.blockedNodeIds,
    selectedNodeIds: params.selectedNodeIds,
    lastSpecMode: params.lastSpecMode,
    specGeneratedAt: params.specGeneratedAt,
    lastBuildMode: params.lastBuildMode,
    lastBuildAt: params.lastBuildAt,
    finalStatus: progress.finalStatus,
  };
};
