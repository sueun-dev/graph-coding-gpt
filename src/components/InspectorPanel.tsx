import type { ChangeEvent } from "react";
import type { DiagramEdge, DiagramNode, LineStyle, NodeStatus, ShapeType } from "../lib/types";
import { SHAPE_LIBRARY } from "../lib/diagram";

type InspectorProps = {
  selectedNode: DiagramNode | null;
  selectedEdge: DiagramEdge | null;
  selectedNodeCount: number;
  onNodeFieldChange: (field: string, value: string) => void;
  onEdgeFieldChange: (field: string, value: string | boolean) => void;
  onDuplicateNode: () => void;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
};

const statusOptions: NodeStatus[] = ["planned", "active", "blocked", "done"];
const lineStyles: LineStyle[] = ["smoothstep", "straight", "step"];

export default function InspectorPanel({
  selectedNode,
  selectedEdge,
  selectedNodeCount,
  onNodeFieldChange,
  onEdgeFieldChange,
  onDuplicateNode,
  onDeleteSelection,
  onClearSelection,
}: InspectorProps) {
  const activePanel = selectedNode ? "node" : selectedEdge ? "edge" : "empty";

  const handleInput = (field: string) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onNodeFieldChange(field, event.target.value);
  };

  return (
    <aside className="inspector">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>선택 속성</h2>
        </div>
        <span className="selection-count">{selectedNodeCount} selected</span>
      </div>

      {activePanel === "node" && selectedNode && (
        <div className="form-stack">
          <label>
            <span>도형</span>
            <select value={selectedNode.data.shape} onChange={handleInput("shape")}>
              {SHAPE_LIBRARY.map((shape) => (
                <option key={shape.type} value={shape.type}>
                  {shape.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>제목</span>
            <input value={selectedNode.data.title} onChange={handleInput("title")} />
          </label>
          <label>
            <span>주체</span>
            <input value={selectedNode.data.actor} onChange={handleInput("actor")} />
          </label>
          <label>
            <span>목표</span>
            <textarea value={selectedNode.data.intent} onChange={handleInput("intent")} rows={3} />
          </label>
          <label>
            <span>시스템 동작</span>
            <textarea value={selectedNode.data.behavior} onChange={handleInput("behavior")} rows={4} />
          </label>
          <label>
            <span>입력</span>
            <textarea value={selectedNode.data.inputs} onChange={handleInput("inputs")} rows={2} />
          </label>
          <label>
            <span>출력</span>
            <textarea value={selectedNode.data.outputs} onChange={handleInput("outputs")} rows={2} />
          </label>
          <label>
            <span>테스트 힌트</span>
            <textarea value={selectedNode.data.testHint} onChange={handleInput("testHint")} rows={2} />
          </label>
          <label>
            <span>메모</span>
            <textarea value={selectedNode.data.notes} onChange={handleInput("notes")} rows={3} />
          </label>
          <label>
            <span>상태</span>
            <select value={selectedNode.data.status} onChange={handleInput("status")}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="inspector-actions">
            <button className="ghost-button compact-button" onClick={onDuplicateNode}>
              Duplicate Node
            </button>
            <button className="ghost-button compact-button danger-button" onClick={onDeleteSelection}>
              Delete Node
            </button>
            <button className="ghost-button compact-button" onClick={onClearSelection}>
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {activePanel === "edge" && selectedEdge && (
        <div className="form-stack">
          <label>
            <span>관계 라벨</span>
            <input
              value={selectedEdge.data?.relation ?? ""}
              onChange={(event) => onEdgeFieldChange("relation", event.target.value)}
            />
          </label>
          <label>
            <span>라인 타입</span>
            <select
              value={selectedEdge.data?.lineStyle ?? "smoothstep"}
              onChange={(event) => onEdgeFieldChange("lineStyle", event.target.value)}
            >
              {lineStyles.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedEdge.data?.animated ?? false}
              onChange={(event) => onEdgeFieldChange("animated", event.target.checked)}
            />
            <span>애니메이션 흐름 표시</span>
          </label>
          <label>
            <span>엣지 메모</span>
            <textarea
              value={selectedEdge.data?.notes ?? ""}
              onChange={(event) => onEdgeFieldChange("notes", event.target.value)}
              rows={5}
            />
          </label>
          <div className="inspector-actions">
            <button className="ghost-button compact-button danger-button" onClick={onDeleteSelection}>
              Delete Edge
            </button>
            <button className="ghost-button compact-button" onClick={onClearSelection}>
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {activePanel === "empty" && (
        <div className="empty-state">
          <h3>편집할 항목을 선택하세요</h3>
          <p>노드를 선택하면 기능 설명을 입력할 수 있고, 선을 선택하면 방향 관계를 구체화할 수 있습니다.</p>
          <p>여러 노드를 선택한 뒤 스펙 생성을 누르면 해당 범위만 부분 구현하도록 AI가 판단합니다.</p>
        </div>
      )}
    </aside>
  );
}
