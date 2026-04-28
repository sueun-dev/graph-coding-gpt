import type { ChangeEvent } from "react";
import type { DiagramDocument, DiagramGenerationResponse, SpecResponse } from "../lib/types";

type AuthStatus = {
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  detail: string;
};

type RunPanelProps = {
  auth: AuthStatus | null;
  diagram: DiagramDocument;
  brief: string;
  diagramLoading: boolean;
  diagramResult: DiagramGenerationResponse | null;
  diagramError: string;
  loading: boolean;
  result: SpecResponse | null;
  error: string;
  onBriefChange: (value: string) => void;
  onGenerateDiagram: (strategy: "replace" | "augment") => void;
  onGenerate: (mode: "full" | "selection") => void;
};

export default function RunPanel({
  auth,
  diagram,
  brief,
  diagramLoading,
  diagramResult,
  diagramError,
  loading,
  result,
  error,
  onBriefChange,
  onGenerateDiagram,
  onGenerate,
}: RunPanelProps) {
  const scopeLabel = diagram.scope.mode === "selection" ? `${diagram.scope.nodeIds.length} nodes selected` : "Full diagram";
  const hasDiagram = diagram.nodes.length > 0;
  const handleBriefInput = (event: ChangeEvent<HTMLTextAreaElement>) => onBriefChange(event.target.value);

  return (
    <section className="run-panel panel-surface">
      <div className="panel-header">
        <div>
          <p className="eyebrow">STEP 1</p>
          <h2>Generate Diagram</h2>
        </div>
        <span className={`runtime-status ${auth?.codexAuthenticated ? "ok" : "warn"}`}>
          {auth?.codexAuthenticated ? "Codex Ready" : "Auth Check Needed"}
        </span>
      </div>

      {hasDiagram ? (
        /* STEP 1 (refine mode) — user already has a diagram; let them iterate on it here.
           The initial brief input lives in the canvas empty-state, so this card only renders
           once a diagram exists. */
        <div className="runtime-card">
          <h3>1. Refine Diagram</h3>
          <p>추가로 원하는 점을 적으면 기존 diagram에 덧붙여 노드/관계선을 더합니다.</p>
          <textarea
            className="runtime-textarea"
            value={brief}
            onChange={handleBriefInput}
            rows={4}
            placeholder="예: 결제 화면을 추가하고 Stripe 연동 노드를 넣어줘."
          />
          <div className="button-row">
            <button className="primary-button" onClick={() => onGenerateDiagram("augment")} disabled={diagramLoading}>
              Refine Diagram
            </button>
          </div>
          <p className="runtime-hint">
            처음부터 다시 만들려면 좌측 EXPLORER의 <strong>Reset</strong>으로 지운 뒤 실행하세요.
          </p>
        </div>
      ) : (
        /* STEP 1 (empty mode) — brief input lives in the canvas. Keep this side panel quiet
           but informative so the user sees the whole 3-step flow laid out. */
        <div className="runtime-card runtime-card--subtle">
          <h3>시작하는 법</h3>
          <ol className="runtime-flowlist">
            <li><strong>캔버스</strong>에 한 문장 brief를 적고 <em>Generate Diagram</em>을 누르세요.</li>
            <li>생성된 노드/관계선을 <strong>캔버스</strong>에서 직접 편집합니다.</li>
            <li>오른쪽 <strong>3. BUILD</strong> 탭 → <em>Start Build Loop</em>으로 코드 + 테스트를 실행합니다.</li>
          </ol>
        </div>
      )}

      {diagramLoading && (
        <div className="result-card">
          <h3>Generating Diagram</h3>
          <p>브리프를 읽고 도메인에 맞는 노드, 관계선, 구현 가능한 구조를 생성하고 있습니다. 최대 몇 분까지 걸릴 수 있습니다.</p>
        </div>
      )}

      {diagramError && (
        <div className="result-card error-card">
          <h3>Diagram 오류</h3>
          <p>{diagramError}</p>
        </div>
      )}

      {diagramResult && (
        <div className="result-card">
          <div className="result-card__header">
            <h3>{diagramResult.diagram.title}</h3>
            <span className="result-source">{diagramResult.source}</span>
          </div>
          <p>{diagramResult.diagram.summary}</p>
          {diagramResult.source === "fallback" ? (
            <p className="result-warning">
              이 결과는 fallback diagram입니다 (Codex 응답이 아닌 대체 결과). Build Loop은 실제 응답을 받은 뒤에만 실행할 수 있습니다.
            </p>
          ) : null}
          {diagramResult.error ? (
            <p className="result-warning">이유: <strong>{diagramResult.error}</strong></p>
          ) : null}

          {/* Coverage check — surfaces missing mandatory architecture layers
              so the user can refine before kicking off the Build Loop. */}
          {diagramResult.coverage && !diagramResult.coverage.ok ? (
            <div className="result-coverage result-coverage--warn">
              <strong>⚠️ 빠진 layer가 있어요</strong>
              <p>이 layer들의 노드를 더 채워야 빌드가 hallucinate 없이 끝까지 갈 수 있습니다:</p>
              <ul>
                {diagramResult.coverage.missingLayers.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="result-coverage__hint">
                위쪽 brief에 부족한 layer를 명시하고 <em>Refine Diagram</em>으로 보강하거나, 캔버스에서 직접 노드를 추가하세요.
              </p>
            </div>
          ) : null}
          {diagramResult.coverage?.warnings.length ? (
            <div className="result-coverage result-coverage--info">
              {diagramResult.coverage.warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          ) : null}

          <div className="runtime-summary-grid runtime-summary-grid-tight">
            <div className="runtime-summary-cell">
              <span className="meta-label">Nodes</span>
              <strong>{diagramResult.diagram.nodes.length}</strong>
            </div>
            <div className="runtime-summary-cell">
              <span className="meta-label">Edges</span>
              <strong>{diagramResult.diagram.edges.length}</strong>
            </div>
            {diagramResult.coverage ? (
              <div className="runtime-summary-cell">
                <span className="meta-label">Coverage</span>
                <strong className={diagramResult.coverage.ok ? "is-ok" : "is-warn"}>
                  {diagramResult.coverage.ok ? "✓ 전체" : `${diagramResult.coverage.missingLayers.length} 빠짐`}
                </strong>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* STEP 2 — Build Loop hint (next action points user to the Build tab) */}
      {hasDiagram && diagramResult?.source !== "fallback" ? (
        <div className="runtime-card runtime-card--cta">
          <h3>2. 다음 단계</h3>
          <p>
            노드를 다 편집했으면 오른쪽 <strong>3. BUILD</strong> 탭으로 가서 <strong>Start Build Loop</strong>을 누르세요. Codex가 노드 단위로 코드 + 테스트를 실제로 작성합니다.
          </p>
        </div>
      ) : null}

      {/* OPTIONAL — Spec generation (collapsed; Build Loop does not require it) */}
      <details className="runtime-optional">
        <summary>부가: Spec 문서 만들기 (선택)</summary>
        <div className="runtime-card runtime-card--subtle">
          <p>
            확정된 diagram에서 읽기 좋은 스펙 문서를 뽑습니다. <strong>Build Loop은 이 문서를 읽지 않습니다</strong> — 문서화/검토용입니다.
          </p>
          <p>현재 범위: <strong>{scopeLabel}</strong></p>
          <div className="button-row">
            <button className="primary-button" onClick={() => onGenerate("selection")} disabled={loading || !hasDiagram}>
              Selection Spec
            </button>
            <button className="secondary-button" onClick={() => onGenerate("full")} disabled={loading || !hasDiagram}>
              Full Spec
            </button>
          </div>
          {loading && <p className="runtime-hint">Codex에 도식화와 범위를 전달해 스펙 문서를 만들고 있습니다.</p>}
          {error && <p className="result-warning">{error}</p>}
          {result && (
            <div className="result-stack runtime-compact">
              <div className="result-card">
                <div className="result-card__header">
                  <h3>{result.spec.title}</h3>
                  <span className="result-source">{result.source}</span>
                </div>
                <p>{result.spec.overview}</p>
              </div>
              <div className="runtime-summary-grid">
                <div className="runtime-summary-cell">
                  <span className="meta-label">Architecture</span>
                  <strong>{result.spec.architecture.length}</strong>
                </div>
                <div className="runtime-summary-cell">
                  <span className="meta-label">Execution</span>
                  <strong>{result.spec.executionPlan.length}</strong>
                </div>
                <div className="runtime-summary-cell">
                  <span className="meta-label">Tests</span>
                  <strong>{result.spec.testPlan.length}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
