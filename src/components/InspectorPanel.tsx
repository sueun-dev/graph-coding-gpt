import type { ChangeEvent } from "react";
import type { DiagramEdge, DiagramNode, LineStyle, NodeStatus, ShapeType } from "../lib/types";

type InspectorProps = {
  selectedNode: DiagramNode | null;
  selectedEdge: DiagramEdge | null;
  selectedCount: number;
  onNodeFieldChange: (field: string, value: string) => void;
  onEdgeFieldChange: (field: string, value: string | boolean) => void;
};

const statusOptions: NodeStatus[] = ["planned", "active", "blocked", "done"];
const lineStyles: LineStyle[] = ["smoothstep", "straight", "step"];

const nodeTypeGuide: Record<ShapeType, string> = {
  state: "앱 전체에서 공유할 타입, 데이터 모델, 상태 저장 방식, 캐시 규칙을 정리합니다.",
  database: "저장소 이름, 저장할 데이터 구조, 읽기/쓰기 규칙, 영속화 방식을 적습니다.",
  service: "UI나 API 뒤에서 실행되는 핵심 도메인 로직, 외부 SDK 호출, 검증 규칙을 적습니다.",
  api: "프론트와 백엔드 또는 외부 시스템 사이의 요청/응답 계약을 적습니다.",
  process: "여러 단계의 처리 순서, 분기 조건, 결과 생성 과정을 적습니다.",
  input: "버튼, 폼, 검색창처럼 사용자가 값을 넣거나 액션을 시작하는 UI 부품을 적습니다.",
  screen: "사용자가 보는 화면 구성, 표시할 데이터, 주요 액션 흐름을 적습니다.",
  startEnd: "앱 시작점, 초기 로딩, 라우팅 진입, 최종 완료 상태를 적습니다.",
  note: "빌드 대상이 아닌 설명, TODO, 제약, 설계 의도를 적습니다.",
};

const nodeTypeLabel: Record<ShapeType, string> = {
  state: "State",
  database: "Database",
  service: "Service",
  api: "API",
  process: "Process",
  input: "Input",
  screen: "Screen",
  startEnd: "Start / End",
  note: "Note",
};

const FieldHint = ({ children }: { children: string }) => <p className="field-hint">{children}</p>;

export default function InspectorPanel({
  selectedNode,
  selectedEdge,
  selectedCount,
  onNodeFieldChange,
  onEdgeFieldChange,
}: InspectorProps) {
  const activePanel = selectedNode ? "node" : selectedEdge ? "edge" : "empty";

  const handleInput = (field: string) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onNodeFieldChange(field, event.target.value);
  };

  return (
    <aside className="inspector">
      <div className="panel-header">
        <div>
          <p className="eyebrow">STEP 3</p>
          <h2>Edit</h2>
        </div>
        <span className="selection-count">{selectedCount} selected</span>
      </div>

      {activePanel === "node" && selectedNode && (
        <div className="form-stack">
          <div className="selection-guide">
            <strong>{nodeTypeLabel[selectedNode.data.shape]} 노드</strong>
            <p>{nodeTypeGuide[selectedNode.data.shape]}</p>
          </div>
          <label>
            <span>제목</span>
            <FieldHint>파일명, 컴포넌트명, 기능명을 떠올릴 수 있는 짧고 구체적인 이름을 넣습니다.</FieldHint>
            <input value={selectedNode.data.title} onChange={handleInput("title")} />
          </label>
          <label>
            <span>주체</span>
            <FieldHint>이 기능을 쓰는 사람, 시스템, 외부 서비스, 또는 내부 모듈을 적습니다.</FieldHint>
            <input value={selectedNode.data.actor} onChange={handleInput("actor")} />
          </label>
          <label>
            <span>목표</span>
            <FieldHint>이 노드가 최종적으로 달성해야 하는 사용자/시스템 목적을 한두 문장으로 적습니다.</FieldHint>
            <textarea value={selectedNode.data.intent} onChange={handleInput("intent")} rows={3} />
          </label>
          <label>
            <span>시스템 동작</span>
            <FieldHint>클릭, 검증, 저장, 호출, 렌더링처럼 코드가 실제로 수행해야 할 동작을 순서대로 적습니다.</FieldHint>
            <textarea value={selectedNode.data.behavior} onChange={handleInput("behavior")} rows={4} />
          </label>
          <label>
            <span>입력</span>
            <FieldHint>이 노드가 받는 값, props, request body, state, 파일, 사용자 입력을 적습니다.</FieldHint>
            <textarea value={selectedNode.data.inputs} onChange={handleInput("inputs")} rows={2} />
          </label>
          <label>
            <span>출력</span>
            <FieldHint>다음 노드로 넘길 값, 화면에 보여줄 결과, 저장되는 데이터, API 응답을 적습니다.</FieldHint>
            <textarea value={selectedNode.data.outputs} onChange={handleInput("outputs")} rows={2} />
          </label>
          <label>
            <span>테스트 힌트</span>
            <FieldHint>정상/실패 케이스, 눌러볼 버튼, 확인해야 할 화면 결과를 적습니다.</FieldHint>
            <textarea value={selectedNode.data.testHint} onChange={handleInput("testHint")} rows={2} />
          </label>
          <label>
            <span>메모</span>
            <FieldHint>제약 조건, 구현 주의점, 디자인 의도, 나중에 확인할 TODO를 적습니다.</FieldHint>
            <textarea value={selectedNode.data.notes} onChange={handleInput("notes")} rows={3} />
          </label>
          <label>
            <span>상태</span>
            <FieldHint>아직 설계 중이면 planned, 지금 구현 대상이면 active, 막혔으면 blocked, 완료면 done입니다.</FieldHint>
            <select value={selectedNode.data.status} onChange={handleInput("status")}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {activePanel === "edge" && selectedEdge && (
        <div className="form-stack">
          <div className="selection-guide">
            <strong>Flow 연결</strong>
            <p>이전 노드에서 다음 노드로 어떤 데이터, 조건, 결과가 넘어가는지 적는 데이터 계약입니다.</p>
          </div>
          <label>
            <span>관계 라벨</span>
            <FieldHint>짧은 동사형으로 적습니다. 예: submits, loads, saves, validates, routes to.</FieldHint>
            <input
              value={selectedEdge.data?.relation ?? ""}
              onChange={(event) => onEdgeFieldChange("relation", event.target.value)}
            />
          </label>
          <label>
            <span>라인 타입</span>
            <FieldHint>기본은 smoothstep입니다. 직선이 더 명확하면 straight, 단계형 흐름이면 step을 씁니다.</FieldHint>
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
          <FieldHint>실시간 스트림, 진행 상태, 계속 흐르는 작업처럼 방향성이 중요할 때만 켭니다.</FieldHint>
          <label>
            <span>엣지 메모</span>
            <FieldHint>무엇이 넘어가는지, 언제 넘어가는지, 다음 노드가 무엇을 해야 하는지, 실패 시 처리를 적습니다.</FieldHint>
            <textarea
              value={selectedEdge.data?.notes ?? ""}
              onChange={(event) => onEdgeFieldChange("notes", event.target.value)}
              rows={5}
            />
          </label>
        </div>
      )}

      {activePanel === "empty" && (
        <div className="empty-state">
          <h3>캔버스에서 편집할 항목을 선택하세요</h3>
          <p>노드를 선택하면 기능 설명을 입력할 수 있고, 선을 선택하면 방향 관계를 구체화할 수 있습니다.</p>
          <p>여러 노드를 선택한 뒤 스펙 생성을 누르면 해당 범위만 Codex가 부분 구현 범위로 판단합니다.</p>
        </div>
      )}
    </aside>
  );
}
