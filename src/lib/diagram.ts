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

// 9 shape types — pure architectural layers + one annotation type. Reduced
// from 16 because the extras (decision/auth/queue/event/external/document/group)
// were either redundant with their parent layer or expressed information that
// belongs on edges (data shape, async/event mode, branch conditions).
//
// Order matters: the palette is rendered in this order, so we list them in
// rough build-order from L1 (state) to L13 (startEnd) with `note` last as
// the lone non-buildable annotation.
export const SHAPE_LIBRARY: ShapeDefinition[] = [
  { type: "state",    label: "State",     description: "타입, 스키마, 스토어, 캐시", accent: "#7ee3a0" },
  { type: "database", label: "Database",  description: "영속 계층 (localStorage, sqlite, indexeddb)", accent: "#67e4d6" },
  { type: "service",  label: "Service",   description: "도메인 로직 (auth, queue, external SDK 포함)", accent: "#90b5ff" },
  { type: "api",      label: "API",       description: "Bridge/gateway (event/webhook 포함, edge.mode로 구분)", accent: "#ffcb8a" },
  { type: "process",  label: "Process",   description: "오케스트레이션 (분기는 outgoing edges로, 결과물 산출 포함)", accent: "#ffd16e" },
  { type: "input",    label: "Input",     description: "UI primitives — 폼, 버튼, 입력 컴포넌트", accent: "#c1a7ff" },
  { type: "screen",   label: "Screen",    description: "UI 화면 또는 페이지", accent: "#7cc7ff" },
  { type: "startEnd", label: "Start / End", description: "앱 진입점 / 마운트", accent: "#8df7a1" },
  { type: "note",     label: "Note",      description: "설명, 추천, TODO, 그룹 묶음 (빌드 무관)", accent: "#fff08b" },
];

export const isBuildableShape = (shape: ShapeType): boolean => shape !== "note";

// Legacy shape values written by older diagrams (and older fallbacks) — map them
// to the new 9-shape vocabulary on read. Without this, .strict() schemas would
// reject old saved diagrams and the user would lose work.
const LEGACY_SHAPE_MAP: Record<string, ShapeType> = {
  queue: "service",
  auth: "service",
  external: "service",
  event: "api",
  decision: "process",
  document: "process",
  group: "note",
};

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

// Translate any incoming shape string into the 9-shape vocabulary:
//   1) accepted directly if already valid
//   2) legacy shape name from a pre-collapse diagram → mapped via LEGACY_SHAPE_MAP
//   3) anything else falls back to "process" so build-loop still has a layer
const normalizeShape = (shape: string): ShapeType => {
  if (allowedShapes.has(shape as ShapeType)) return shape as ShapeType;
  const migrated = LEGACY_SHAPE_MAP[shape];
  if (migrated) return migrated;
  return "process";
};

// Run when re-hydrating saved diagrams (localStorage / disk). React-Flow node
// objects keep `shape` inside `data`, so we walk and normalize every entry.
// Idempotent — running twice is a no-op for already-current diagrams.
export const migratePersistedDiagram = ({
  nodes,
  edges,
}: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}): { nodes: DiagramNode[]; edges: DiagramEdge[] } => ({
  nodes: nodes.map((node) => {
    const currentShape = node.data?.shape;
    if (!currentShape) return node;
    const next = normalizeShape(currentShape);
    if (next === currentShape) return node;
    return { ...node, data: { ...node.data, shape: next } };
  }),
  edges,
});

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
