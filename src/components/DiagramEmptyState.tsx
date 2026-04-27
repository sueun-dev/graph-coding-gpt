import type { ChangeEvent, KeyboardEvent } from "react";

type DiagramEmptyStateProps = {
  brief: string;
  loading: boolean;
  error: string;
  authReady: boolean;
  onBriefChange: (value: string) => void;
  onGenerate: () => void;
};

/**
 * Empty-canvas hero. Replaces the ReactFlow surface when the diagram has zero
 * nodes so the very first interaction after opening a workspace is crystal
 * clear: write a brief, press the button, get a diagram. Also carries the
 * 1→2→3 phase tracker so users know where they are in the loop.
 */
export default function DiagramEmptyState({
  brief,
  loading,
  error,
  authReady,
  onBriefChange,
  onGenerate,
}: DiagramEmptyStateProps) {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => onBriefChange(event.target.value);
  const canGenerate = authReady && brief.trim().length > 0 && !loading;

  // ⌘/Ctrl + Enter submits — a textarea affordance that developers expect.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate) {
      event.preventDefault();
      onGenerate();
    }
  };

  return (
    <div className="diagram-empty">
      <ol className="diagram-empty__steps" aria-label="build phases">
        <li className="is-active">
          <span className="diagram-empty__step-num">1</span>
          <span>Brief → Diagram</span>
        </li>
        <li>
          <span className="diagram-empty__step-num">2</span>
          <span>Edit on canvas</span>
        </li>
        <li>
          <span className="diagram-empty__step-num">3</span>
          <span>Build Loop</span>
        </li>
      </ol>

      <h1 className="diagram-empty__title">무엇을 만들까요?</h1>
      <p className="diagram-empty__subtitle">
        한 문장이면 됩니다. GPT-5.5가 노드와 관계선을 그려주면, 이어서 캔버스에서 직접 편집하고 마지막에
        Build Loop이 노드 단위로 코드 + 테스트를 작성합니다.
      </p>

      <label className="diagram-empty__field">
        <span className="diagram-empty__label">Brief</span>
        <textarea
          className="diagram-empty__textarea"
          value={brief}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={5}
          autoFocus
          disabled={loading}
          placeholder="예: 로컬 우선 메시징 앱. 스레드 목록, 채팅 창, 계산기 팝업이 있고 계산 결과를 대화에 삽입할 수 있어야 한다."
        />
      </label>

      <div className="diagram-empty__cta-row">
        <button className="diagram-empty__cta" onClick={onGenerate} disabled={!canGenerate}>
          {loading ? "GPT-5.5가 도식화 중…" : "Generate Diagram"}
        </button>
        <span className="diagram-empty__shortcut">⌘/Ctrl + Enter</span>
      </div>

      {!authReady ? (
        <p className="diagram-empty__note is-warn">
          Codex CLI 로그인이 아직 확인되지 않았어요. 터미널에서 <code>codex login status</code>를 실행해 OK가 나오는지
          먼저 보세요.
        </p>
      ) : null}
      {error ? <p className="diagram-empty__note is-error">{error}</p> : null}
    </div>
  );
}
