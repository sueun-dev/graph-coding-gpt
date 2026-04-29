import type { BuildLoopState, DiagramDocument, NodeBuildStatus } from "../lib/types";
import { LiquidGlassBadge, LiquidGlassButton } from "./LiquidGlassControls";

type BuildLoopPanelProps = {
  diagram: DiagramDocument;
  state: BuildLoopState | null;
  canRun: boolean;
  blockedReason: string;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
};

const STATUS_LABEL: Record<NodeBuildStatus, string> = {
  pending: "대기",
  implementing: "구현 중",
  testing: "테스트 중",
  fixing: "수정 중",
  done: "완료",
  failed: "실패",
};

export default function BuildLoopPanel({
  diagram,
  state,
  canRun,
  blockedReason,
  onStart,
  onStop,
  onReset,
}: BuildLoopPanelProps) {
  const order = state?.order ?? [];
  const records = state?.records ?? {};
  const hasOrder = order.length > 0;
  const running = !!state?.running;
  const doneCount = order.filter((id) => records[id]?.status === "done").length;
  const failedCount = order.filter((id) => records[id]?.status === "failed").length;

  return (
    <section className="build-loop-panel panel-surface">
      <div className="panel-header">
        <div>
          <p className="eyebrow">STEP 4</p>
          <h2>Build</h2>
        </div>
        <LiquidGlassBadge width={82} height={24} tone={canRun && !running ? "primary" : "status"}>
          {running ? "Running" : canRun ? "Ready" : "Blocked"}
        </LiquidGlassBadge>
      </div>

      <div className="runtime-card">
        <p>
          확정된 다이어그램을 순서대로 한 노드씩 돌면서 <strong>계획 + 패치 + 테스트 + 검증</strong>을 실행합니다. 실패하면 자동으로 최대 3회까지 수정 재시도.
        </p>
        <div className="codex-pipeline" aria-label="Codex build pipeline">
          <LiquidGlassBadge width="100%" height={30}>Plan</LiquidGlassBadge>
          <LiquidGlassBadge width="100%" height={30}>Patch</LiquidGlassBadge>
          <LiquidGlassBadge width="100%" height={30}>Test</LiquidGlassBadge>
          <LiquidGlassBadge width="100%" height={30}>Verify</LiquidGlassBadge>
        </div>
        {!canRun ? <p className="result-warning">{blockedReason}</p> : null}
        <div className="button-row">
          <LiquidGlassButton width={hasOrder ? 150 : 164} height={34} onClick={onStart} disabled={!canRun || running}>
            {running ? "Running..." : hasOrder ? "Continue Build" : "Start Build Loop"}
          </LiquidGlassButton>
          <LiquidGlassButton tone="secondary" width={76} height={34} onClick={onStop} disabled={!running}>
            Stop
          </LiquidGlassButton>
          {hasOrder ? (
            <LiquidGlassButton tone="secondary" width={82} height={34} onClick={onReset} disabled={running}>
              Reset
            </LiquidGlassButton>
          ) : null}
        </div>
        {hasOrder ? (
          <p className="build-loop-summary">
            {doneCount} / {order.length} done
            {failedCount > 0 ? ` · ${failedCount} failed` : ""}
          </p>
        ) : null}
      </div>

      {hasOrder ? (
        <ol className="build-loop-list">
          {order.map((nodeId, index) => {
            const record = records[nodeId];
            const status: NodeBuildStatus = record?.status ?? "pending";
            const node = diagram.nodes.find((n) => n.id === nodeId);
            const isCurrent = state?.currentNodeId === nodeId;
            return (
              <li key={nodeId} className={`build-loop-item is-${status} ${isCurrent ? "is-current" : ""}`}>
                <div className="build-loop-item__head">
                  <span className="build-loop-item__index">{index + 1}</span>
                  <div className="build-loop-item__title">
                    <strong>{record?.nodeTitle ?? node?.title ?? nodeId.slice(0, 8)}</strong>
                    <small>{record?.nodeShape ?? node?.shape ?? ""}</small>
                  </div>
                  <span className={`build-loop-chip is-${status}`}>{STATUS_LABEL[status]}</span>
                </div>
                {record?.attempts ? (
                  <div className="build-loop-item__meta">
                    <span>attempts: {record.attempts}</span>
                    {record.testResult ? (
                      <span className={record.testResult.passed ? "ok" : "bad"}>
                        tests: {record.testResult.passed ? "green" : `${record.testResult.failures.length} failing`}
                      </span>
                    ) : null}
                    {record.files?.length ? <span>{record.files.length} files</span> : null}
                  </div>
                ) : null}
                {record?.lastError ? <p className="build-loop-error">{record.lastError}</p> : null}
                {record?.testResult && !record.testResult.passed && record.testResult.failures.length > 0 ? (
                  <details className="build-loop-failure">
                    <summary>test failure detail</summary>
                    <pre>{record.testResult.failures.slice(0, 4).join("\n\n").slice(0, 2400)}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="build-loop-empty">다이어그램을 확정하고 Start Build Loop를 눌러주세요.</p>
      )}
    </section>
  );
}
