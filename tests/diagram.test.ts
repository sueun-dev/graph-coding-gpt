import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkerType } from "@xyflow/react";

import {
  SHAPE_LIBRARY,
  buildDiagramDocument,
  createEdge,
  createFlowFromBlueprint,
  createInitialFlow,
  createNode,
  isBuildableShape,
  migratePersistedDiagram,
  shapeLabel,
} from "../src/lib/diagram";
import type {
  DiagramBlueprint,
  DiagramEdge,
  DiagramNode,
  ShapeType,
} from "../src/lib/types";

// crypto.randomUUID is available in jsdom/node, but we stub it to make node ids
// deterministic so assertions can target exact ids and ordering. A counter keeps
// every generated id unique (the production code relies on uniqueness).
let uuidCounter = 0;
const stubUuids = () => {
  uuidCounter = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `id-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
});

// A minimal blueprint node factory — every field is required by the type, but
// tests usually only care about key/shape/title, so the rest get filler.
const bpNode = (
  key: string,
  shape: ShapeType,
  overrides: Partial<DiagramBlueprint["nodes"][number]> = {},
): DiagramBlueprint["nodes"][number] => ({
  key,
  shape,
  title: key,
  actor: "actor",
  intent: "intent",
  behavior: "behavior",
  inputs: "in",
  outputs: "out",
  notes: "notes",
  testHint: "hint",
  status: "planned",
  ...overrides,
});

const bpEdge = (
  sourceKey: string,
  targetKey: string,
  overrides: Partial<DiagramBlueprint["edges"][number]> = {},
): DiagramBlueprint["edges"][number] => ({
  sourceKey,
  targetKey,
  relation: "flows to",
  notes: "",
  lineStyle: "smoothstep",
  animated: false,
  ...overrides,
});

describe("SHAPE_LIBRARY + helpers", () => {
  it("exposes 9 unique shapes with note last", () => {
    expect(SHAPE_LIBRARY).toHaveLength(9);
    const types = SHAPE_LIBRARY.map((s) => s.type);
    expect(new Set(types).size).toBe(9);
    expect(types[types.length - 1]).toBe("note");
  });

  it("every shape entry has a non-empty label and hex accent", () => {
    for (const shape of SHAPE_LIBRARY) {
      expect(shape.label.length).toBeGreaterThan(0);
      expect(shape.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("isBuildableShape is true for everything except note", () => {
    for (const shape of SHAPE_LIBRARY) {
      expect(isBuildableShape(shape.type)).toBe(shape.type !== "note");
    }
  });

  it("shapeLabel returns the library label, or the raw value when unknown", () => {
    expect(shapeLabel("startEnd")).toBe("Start / End");
    expect(shapeLabel("service")).toBe("Service");
    // Unknown shape falls through to the raw string (defensive default).
    expect(shapeLabel("totally-unknown" as ShapeType)).toBe("totally-unknown");
  });
});

describe("createNode", () => {
  it("lays out nodes in a 4-column grid by index", () => {
    stubUuids();
    const first = createNode("service", 0);
    const fifth = createNode("service", 4); // row 1, col 0
    const seventh = createNode("service", 6); // row 1, col 2

    expect(first.position).toEqual({ x: 80, y: 90 });
    expect(fifth.position).toEqual({ x: 80, y: 90 + 220 });
    expect(seventh.position).toEqual({ x: 80 + 2 * 280, y: 90 + 220 });
  });

  it("seeds default data from the shape library and id from crypto", () => {
    stubUuids();
    const node = createNode("database", 0);
    expect(node.id).toBe("id-1");
    expect(node.type).toBe("diagram");
    expect(node.data.shape).toBe("database");
    expect(node.data.accent).toBe(
      SHAPE_LIBRARY.find((s) => s.type === "database")!.accent,
    );
    expect(node.data.status).toBe("planned");
    expect(node.data.title).toBe("Database");
  });
});

describe("createInitialFlow", () => {
  it("returns an empty graph", () => {
    expect(createInitialFlow()).toEqual({ nodes: [], edges: [] });
  });
});

describe("createEdge", () => {
  it("builds an edge with arrow marker and mirrored relation in data", () => {
    stubUuids();
    const edge = createEdge("a", "b", "calls");
    expect(edge.source).toBe("a");
    expect(edge.target).toBe("b");
    expect(edge.label).toBe("calls");
    expect(edge.type).toBe("smoothstep");
    expect(edge.markerEnd).toMatchObject({ type: MarkerType.ArrowClosed });
    expect(edge.data).toEqual({
      relation: "calls",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    });
  });

  it("defaults the relation to 'flows to'", () => {
    stubUuids();
    expect(createEdge("a", "b").label).toBe("flows to");
  });
});

describe("migratePersistedDiagram", () => {
  const nodeWithShape = (shape: string): DiagramNode =>
    ({
      id: "n1",
      type: "diagram",
      position: { x: 0, y: 0 },
      data: { shape } as DiagramNode["data"],
    }) as DiagramNode;

  it("rewrites legacy shapes to the 9-shape vocabulary", () => {
    const { nodes } = migratePersistedDiagram({
      nodes: [
        nodeWithShape("queue"),
        nodeWithShape("auth"),
        nodeWithShape("event"),
        nodeWithShape("decision"),
        nodeWithShape("group"),
      ],
      edges: [],
    });
    expect(nodes.map((n) => n.data.shape)).toEqual([
      "service",
      "service",
      "api",
      "process",
      "note",
    ]);
  });

  it("falls back unknown shapes to process", () => {
    const { nodes } = migratePersistedDiagram({
      nodes: [nodeWithShape("nonsense")],
      edges: [],
    });
    expect(nodes[0].data.shape).toBe("process");
  });

  it("is a no-op for already-current shapes and preserves identity", () => {
    const node = nodeWithShape("service");
    const { nodes } = migratePersistedDiagram({ nodes: [node], edges: [] });
    // Unchanged nodes must be returned by reference (idempotent, no churn).
    expect(nodes[0]).toBe(node);
  });

  it("leaves nodes without a shape untouched and passes edges through", () => {
    const noShape = {
      id: "x",
      type: "diagram",
      position: { x: 0, y: 0 },
      data: {} as DiagramNode["data"],
    } as DiagramNode;
    const edges = [{ id: "e", source: "a", target: "b" }] as DiagramEdge[];
    const result = migratePersistedDiagram({ nodes: [noShape], edges });
    expect(result.nodes[0]).toBe(noShape);
    expect(result.edges).toBe(edges);
  });
});

describe("createFlowFromBlueprint — layering & layout", () => {
  it("places a linear chain into successive depth layers (x increases)", () => {
    stubUuids();
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      nodes: [bpNode("a", "state"), bpNode("b", "service"), bpNode("c", "screen")],
      edges: [bpEdge("a", "b"), bpEdge("b", "c")],
    };
    const { nodes, edges } = createFlowFromBlueprint(blueprint);

    const byTitle = new Map(nodes.map((n) => [n.data.title, n]));
    // depth a=0, b=1, c=2 → x = 80 + depth*320
    expect(byTitle.get("a")!.position.x).toBe(80);
    expect(byTitle.get("b")!.position.x).toBe(80 + 320);
    expect(byTitle.get("c")!.position.x).toBe(80 + 640);
    expect(edges).toHaveLength(2);
  });

  it("stacks same-depth nodes vertically by key order", () => {
    stubUuids();
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      // two roots (no incoming edges) both at depth 0
      nodes: [bpNode("first", "state"), bpNode("second", "state")],
      edges: [],
    };
    const { nodes } = createFlowFromBlueprint(blueprint);
    const first = nodes.find((n) => n.data.title === "first")!;
    const second = nodes.find((n) => n.data.title === "second")!;
    expect(first.position.x).toBe(80);
    expect(second.position.x).toBe(80);
    expect(first.position.y).toBe(120);
    expect(second.position.y).toBe(120 + 220);
  });

  it("maps blueprint node fields and normalizes shape + status", () => {
    stubUuids();
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      nodes: [
        bpNode("a", "auth" as ShapeType, {
          title: "Login",
          status: "bogus-status" as DiagramBlueprint["nodes"][number]["status"],
        }),
      ],
      edges: [],
    };
    const { nodes } = createFlowFromBlueprint(blueprint);
    expect(nodes[0].data.shape).toBe("service"); // auth -> service
    expect(nodes[0].data.status).toBe("planned"); // invalid -> planned
    expect(nodes[0].data.title).toBe("Login");
  });

  it("drops edges that reference unknown node keys", () => {
    stubUuids();
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      nodes: [bpNode("a", "state"), bpNode("b", "service")],
      edges: [bpEdge("a", "b"), bpEdge("a", "ghost"), bpEdge("ghost", "b")],
    };
    const { edges } = createFlowFromBlueprint(blueprint);
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.relation).toBe("flows to");
  });

  it("normalizes edge lineStyle and carries animated through", () => {
    stubUuids();
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      nodes: [bpNode("a", "state"), bpNode("b", "service")],
      edges: [
        bpEdge("a", "b", {
          lineStyle: "diagonal" as DiagramBlueprint["edges"][number]["lineStyle"],
          animated: true,
          relation: "calls",
        }),
      ],
    };
    const { edges } = createFlowFromBlueprint(blueprint);
    expect(edges[0].type).toBe("smoothstep"); // invalid lineStyle -> default
    expect(edges[0].animated).toBe(true);
    expect(edges[0].data?.lineStyle).toBe("smoothstep");
    expect(edges[0].data?.relation).toBe("calls");
  });

  it("assigns cyclic / unreachable nodes their own overflow layers", () => {
    stubUuids();
    // a <-> b form a 2-cycle with no indegree-0 entry, so neither is visited by
    // Kahn's queue; both must still be placed (overflow depth path).
    const blueprint: DiagramBlueprint = {
      title: "t",
      summary: "s",
      nodes: [bpNode("a", "state"), bpNode("b", "service")],
      edges: [bpEdge("a", "b"), bpEdge("b", "a")],
    };
    const { nodes } = createFlowFromBlueprint(blueprint);
    expect(nodes).toHaveLength(2);
    // Each cyclic node gets a distinct overflow layer → distinct x positions.
    const xs = nodes.map((n) => n.position.x);
    expect(new Set(xs).size).toBe(2);
  });

  it("handles an empty blueprint", () => {
    const { nodes, edges } = createFlowFromBlueprint({
      title: "t",
      summary: "s",
      nodes: [],
      edges: [],
    });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("buildDiagramDocument", () => {
  const sampleNode = (id: string, overrides: Partial<DiagramNode["data"]> = {}): DiagramNode =>
    ({
      id,
      type: "diagram",
      position: { x: 1, y: 2 },
      data: {
        shape: "service",
        title: "T",
        actor: "A",
        intent: "I",
        behavior: "B",
        inputs: "in",
        outputs: "out",
        notes: "N",
        testHint: "H",
        status: "planned",
        accent: "#fff",
        ...overrides,
      },
    }) as DiagramNode;

  const sampleEdge = (id: string, withData = true): DiagramEdge =>
    ({
      id,
      source: "n1",
      target: "n2",
      ...(withData
        ? {
            data: {
              relation: "calls",
              notes: "edge note",
              lineStyle: "step",
              animated: true,
            },
          }
        : {}),
    }) as DiagramEdge;

  it("serializes nodes (incl. position) and edges from data", () => {
    const doc = buildDiagramDocument(
      [sampleNode("n1", { title: "First" })],
      [sampleEdge("e1")],
      [],
    );
    expect(doc.nodes[0]).toMatchObject({
      id: "n1",
      title: "First",
      shape: "service",
      position: { x: 1, y: 2 },
    });
    expect(doc.edges[0]).toEqual({
      id: "e1",
      source: "n1",
      target: "n2",
      relation: "calls",
      notes: "edge note",
      lineStyle: "step",
      animated: true,
    });
  });

  it("defaults edge fields when edge.data is missing", () => {
    const doc = buildDiagramDocument([], [sampleEdge("e1", false)], []);
    expect(doc.edges[0]).toMatchObject({
      relation: "",
      notes: "",
      lineStyle: "smoothstep",
      animated: false,
    });
  });

  it("scope is 'full' with no selection", () => {
    const doc = buildDiagramDocument([sampleNode("n1")], [], []);
    expect(doc.scope).toEqual({ mode: "full", nodeIds: [] });
  });

  it("scope is 'selection' when ids are provided", () => {
    const doc = buildDiagramDocument([sampleNode("n1")], [], ["n1"]);
    expect(doc.scope).toEqual({ mode: "selection", nodeIds: ["n1"] });
  });
});
