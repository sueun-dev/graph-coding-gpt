import { SHAPE_LIBRARY } from "../lib/diagram";
import type { ShapeType } from "../lib/types";

type ToolbarProps = {
  onAddNode: (shape: ShapeType) => void;
  onReset: () => void;
  onFit: () => void;
};

export default function Toolbar({ onAddNode, onReset, onFit }: ToolbarProps) {
  return (
    <aside className="toolbar">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Shape Library</p>
          <h2>프로그래밍 도형</h2>
        </div>
        <button className="ghost-button" onClick={onFit}>
          Fit View
        </button>
      </div>

      <div className="toolbar-grid">
        {SHAPE_LIBRARY.map((shape) => (
          <button
            key={shape.type}
            className="shape-card"
            style={{ ["--shape-accent" as string]: shape.accent }}
            onClick={() => onAddNode(shape.type)}
          >
            <strong>{shape.label}</strong>
            <span>{shape.description}</span>
          </button>
        ))}
      </div>

      <button className="secondary-button" onClick={onReset}>
        샘플 다이어그램으로 리셋
      </button>
    </aside>
  );
}
