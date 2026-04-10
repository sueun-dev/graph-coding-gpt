import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DiagramNode as DiagramCanvasNode } from "../lib/types";
import { shapeLabel } from "../lib/diagram";

export default function DiagramNodeRenderer({ data, selected }: NodeProps<DiagramCanvasNode>) {
  return (
    <div
      className={`diagram-node shape-${data.shape} ${selected ? "is-selected" : ""}`}
      style={{ ["--node-accent" as string]: data.accent }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} />

      <div className="diagram-node__inner">
        <div className="diagram-node__meta">
          <span className="diagram-node__badge">{shapeLabel(data.shape)}</span>
          <span className={`status-pill status-${data.status}`}>{data.status}</span>
        </div>
        <h3>{data.title}</h3>
        <p className="diagram-node__actor">{data.actor}</p>
        <p className="diagram-node__intent">{data.intent}</p>
      </div>

      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
