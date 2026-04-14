import { MarkerType } from "@xyflow/react";
import type {
  DiagramBlueprint,
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  DiagramNodeData,
  LineStyle,
  NodeStatus,
  ShapeDefinition,
  ShapeType,
} from "./types";

export const SHAPE_LIBRARY: ShapeDefinition[] = [
  { type: "startEnd", label: "Start / End", description: "프로세스 시작과 종료", accent: "#8df7a1" },
  { type: "screen", label: "Screen", description: "UI 화면 또는 페이지", accent: "#7cc7ff" },
  { type: "process", label: "Process", description: "핵심 로직 또는 처리 단계", accent: "#ffd16e" },
  { type: "decision", label: "Decision", description: "분기, 조건, 정책 결정", accent: "#ff9d88" },
  { type: "input", label: "Input", description: "유저 입력 또는 폼", accent: "#c1a7ff" },
  { type: "database", label: "Database", description: "DB, 스토리지, 영속 계층", accent: "#67e4d6" },
  { type: "api", label: "API", description: "HTTP API 또는 계약", accent: "#ffcb8a" },
  { type: "service", label: "Service", description: "도메인 서비스 또는 모듈", accent: "#90b5ff" },
  { type: "queue", label: "Queue", description: "비동기 큐 또는 이벤트 버퍼", accent: "#ffc2e0" },
  { type: "state", label: "State", description: "상태 머신, 스토어, 캐시", accent: "#7ee3a0" },
  { type: "event", label: "Event", description: "트리거, 웹훅, 알림 이벤트", accent: "#ff85b3" },
  { type: "auth", label: "Auth", description: "로그인, 권한, 보안 경계", accent: "#f7a3ff" },
  { type: "external", label: "External", description: "외부 시스템 또는 서드파티", accent: "#9ac4c9" },
  { type: "document", label: "Document", description: "스펙, 결과물, 리포트", accent: "#ffe784" },
  { type: "note", label: "Note", description: "설명, 제약, TODO 메모", accent: "#fff08b" },
  { type: "group", label: "Group", description: "기능 묶음 또는 bounded context", accent: "#83a5ff" },
];

const defaultNodeData = (shape: ShapeType): DiagramNodeData => {
  const meta = SHAPE_LIBRARY.find((item) => item.type === shape)!;
  return {
    shape,
    title: meta.label,
    actor: "사용자",
    intent: "무엇을 달성해야 하는지 설명",
    behavior: "이 노드에서 시스템이 실제로 수행할 동작",
    inputs: "",
    outputs: "",
    notes: "",
    testHint: "",
    status: "planned",
    accent: meta.accent,
  };
};

const allowedShapes = new Set<ShapeType>(SHAPE_LIBRARY.map((item) => item.type));
const allowedStatuses = new Set<NodeStatus>(["planned", "active", "blocked", "done"]);
const allowedLineStyles = new Set<LineStyle>(["smoothstep", "straight", "step"]);

const normalizeShape = (shape: string): ShapeType =>
  allowedShapes.has(shape as ShapeType) ? (shape as ShapeType) : "process";

const normalizeStatus = (status: string): NodeStatus =>
  allowedStatuses.has(status as NodeStatus) ? (status as NodeStatus) : "planned";

const normalizeLineStyle = (style: string): LineStyle =>
  allowedLineStyles.has(style as LineStyle) ? (style as LineStyle) : "smoothstep";

export const createNode = (shape: ShapeType, index: number): DiagramNode => {
  const row = Math.floor(index / 4);
  const col = index % 4;

  return {
    id: crypto.randomUUID(),
    type: "diagram",
    position: { x: 80 + col * 280, y: 90 + row * 220 },
    data: defaultNodeData(shape),
  };
};

export const createInitialFlow = (): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  return {
    nodes: [],
    edges: [],
  };
};

export const createEdge = (source: string, target: string, relation = "flows to"): DiagramEdge => ({
  id: crypto.randomUUID(),
  source,
  target,
  label: relation,
  type: "smoothstep",
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, width: 22, height: 22, color: "#9fb3d9" },
  style: { strokeWidth: 2, stroke: "#9fb3d9" },
  data: {
    relation,
    notes: "",
    lineStyle: "smoothstep",
    animated: false,
  },
});

export const createFlowFromBlueprint = (blueprint: DiagramBlueprint): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const keyOrder = new Map(blueprint.nodes.map((node, index) => [node.key, index]));
  const indegree = new Map(blueprint.nodes.map((node) => [node.key, 0]));
  const adjacency = new Map<string, string[]>();
  const depth = new Map(blueprint.nodes.map((node) => [node.key, 0]));

  for (const edge of blueprint.edges) {
    if (!keyOrder.has(edge.sourceKey) || !keyOrder.has(edge.targetKey)) {
      continue;
    }

    indegree.set(edge.targetKey, (indegree.get(edge.targetKey) ?? 0) + 1);
    adjacency.set(edge.sourceKey, [...(adjacency.get(edge.sourceKey) ?? []), edge.targetKey]);
  }

  const queue = blueprint.nodes
    .filter((node) => (indegree.get(node.key) ?? 0) === 0)
    .sort((left, right) => (keyOrder.get(left.key) ?? 0) - (keyOrder.get(right.key) ?? 0))
    .map((node) => node.key);

  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentKey = queue.shift();
    if (!currentKey) {
      continue;
    }

    visited.add(currentKey);
    const nextKeys = adjacency.get(currentKey) ?? [];

    for (const nextKey of nextKeys) {
      depth.set(nextKey, Math.max(depth.get(nextKey) ?? 0, (depth.get(currentKey) ?? 0) + 1));
      indegree.set(nextKey, (indegree.get(nextKey) ?? 0) - 1);
      if ((indegree.get(nextKey) ?? 0) === 0) {
        queue.push(nextKey);
        queue.sort((left, right) => (keyOrder.get(left) ?? 0) - (keyOrder.get(right) ?? 0));
      }
    }
  }

  let overflowDepth = Math.max(0, ...Array.from(depth.values()));
  for (const node of blueprint.nodes) {
    if (!visited.has(node.key)) {
      overflowDepth += 1;
      depth.set(node.key, overflowDepth);
    }
  }

  const layers = new Map<number, typeof blueprint.nodes>();
  for (const node of blueprint.nodes) {
    const layer = depth.get(node.key) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }

  const keyToId = new Map<string, string>();
  const nodes: DiagramNode[] = [];

  Array.from(layers.entries())
    .sort((left, right) => left[0] - right[0])
    .forEach(([layerIndex, layerNodes]) => {
      layerNodes
        .sort((left, right) => (keyOrder.get(left.key) ?? 0) - (keyOrder.get(right.key) ?? 0))
        .forEach((node, rowIndex) => {
          const shape = normalizeShape(node.shape);
          const base = defaultNodeData(shape);
          const id = crypto.randomUUID();

          keyToId.set(node.key, id);
          nodes.push({
            id,
            type: "diagram",
            position: { x: 80 + layerIndex * 320, y: 120 + rowIndex * 220 },
            data: {
              ...base,
              title: node.title,
              actor: node.actor,
              intent: node.intent,
              behavior: node.behavior,
              inputs: node.inputs,
              outputs: node.outputs,
              notes: node.notes,
              testHint: node.testHint,
              status: normalizeStatus(node.status),
            },
          });
        });
    });

  const edges: DiagramEdge[] = [];

  for (const edge of blueprint.edges) {
    const source = keyToId.get(edge.sourceKey);
    const target = keyToId.get(edge.targetKey);
    if (!source || !target) {
      continue;
    }

    const created = createEdge(source, target, edge.relation);
    const lineStyle = normalizeLineStyle(edge.lineStyle);
    edges.push({
      ...created,
      type: lineStyle,
      animated: edge.animated,
      data: {
        relation: edge.relation,
        notes: edge.notes,
        lineStyle,
        animated: edge.animated,
      },
    });
  }

  return { nodes, edges };
};

export const createFlowFromDocument = (document: DiagramDocument): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const selectedIds = new Set(document.scope?.mode === "selection" ? document.scope.nodeIds : []);

  const nodes: DiagramNode[] = document.nodes.map((node, index) => {
    const shape = normalizeShape(node.shape);
    const base = defaultNodeData(shape);
    const row = Math.floor(index / 4);
    const col = index % 4;

    return {
      id: node.id,
      type: "diagram",
      position: node.position ?? { x: 80 + col * 280, y: 90 + row * 220 },
      selected: selectedIds.has(node.id),
      data: {
        ...base,
        title: node.title,
        actor: node.actor,
        intent: node.intent,
        behavior: node.behavior,
        inputs: node.inputs,
        outputs: node.outputs,
        notes: node.notes,
        testHint: node.testHint,
        status: normalizeStatus(node.status),
      },
    };
  });

  const edges: DiagramEdge[] = document.edges.map((edge) => {
    const created = createEdge(edge.source, edge.target, edge.relation);
    const lineStyle = normalizeLineStyle(edge.lineStyle);

    return {
      ...created,
      id: edge.id,
      type: lineStyle,
      animated: edge.animated,
      label: edge.relation,
      data: {
        relation: edge.relation,
        notes: edge.notes,
        lineStyle,
        animated: edge.animated,
      },
    };
  });

  return { nodes, edges };
};

export const buildDiagramDocument = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  selectedNodeIds: string[],
): DiagramDocument => ({
  title: "Graph Coding GPT Diagram",
  summary: "프로그래밍 도식화 문서",
  nodes: nodes.map((node) => ({
    id: node.id,
    shape: node.data.shape,
    title: node.data.title,
    actor: node.data.actor,
    intent: node.data.intent,
    behavior: node.data.behavior,
    inputs: node.data.inputs,
    outputs: node.data.outputs,
    notes: node.data.notes,
    testHint: node.data.testHint,
    status: node.data.status,
    position: node.position,
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: edge.data?.relation ?? "",
    notes: edge.data?.notes ?? "",
    lineStyle: edge.data?.lineStyle ?? "smoothstep",
    animated: edge.data?.animated ?? false,
  })),
  scope: {
    mode: selectedNodeIds.length > 0 ? "selection" : "full",
    nodeIds: selectedNodeIds,
  },
});

export const shapeLabel = (shape: ShapeType): string =>
  SHAPE_LIBRARY.find((item) => item.type === shape)?.label ?? shape;
