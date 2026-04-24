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
          <p className="eyebrow">AI CONTROL</p>
          <h2>GPT-5.4 Runtime</h2>
        </div>
        <span className={`runtime-status ${auth?.codexAuthenticated ? "ok" : "warn"}`}>
          {auth?.codexAuthenticated ? "Codex Ready" : "Auth Check Needed"}
        </span>
      </div>

      <div className="runtime-card">
        <h3>Brief to Diagram</h3>
        <p>대충 적어도 됩니다. GPT-5.4가 이 텍스트를 읽고 기본 diagram을 먼저 구성합니다.</p>
        <textarea
          className="runtime-textarea"
          value={brief}
          onChange={handleBriefInput}
          rows={6}
          placeholder="예: OAuth 로그인으로 연결되는 데스크톱 앱을 만들고 싶다. 사용자는 도식화를 그린 뒤 GPT-5.4가 기본 앱 구조와 구현 프롬프트를 생성해야 한다. 부분 구현과 테스트 루프도 필요하다."
        />
        <div className="button-row">
          <button className="primary-button" onClick={() => onGenerateDiagram(hasDiagram ? "augment" : "replace")} disabled={diagramLoading}>
            {hasDiagram ? "Refine Current Diagram" : "Generate First Diagram"}
          </button>
          {hasDiagram ? (
            <button className="secondary-button" onClick={() => onGenerateDiagram("replace")} disabled={diagramLoading}>
              Replace Diagram
            </button>
          ) : null}
        </div>
      </div>

      {diagramLoading && (
        <div className="result-card">
          <h3>Generating Diagram</h3>
          <p>브리프를 읽고 도메인에 맞는 노드, 관계선, 구현 가능한 구조를 생성하고 있습니다. 정확성을 우선하므로 최대 몇 분까지 걸릴 수 있습니다.</p>
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
              현재 결과는 fallback diagram입니다. GPT-5.4 응답이 아니며, 서버에서 예외 또는 지연이 발생했을 때 내려오는 대체 결과입니다.
            </p>
          ) : null}
          {diagramResult.error ? (
            <p className="result-warning">
              이유: <strong>{diagramResult.error}</strong>
            </p>
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
          </div>
        </div>
      )}

      <div className="runtime-card">
        <h3>Diagram to Spec</h3>
        <p>
          현재 범위: <strong>{scopeLabel}</strong>
        </p>
        <p>
          코드를 쓰기 전에 확정된 diagram에서 스펙 문서를 뽑아냅니다. 코드 생성은 아래의 <strong>Build Loop</strong>에서 노드 단위로 진행합니다.
        </p>
        <div className="button-row">
          <button className="primary-button" onClick={() => onGenerate("selection")} disabled={loading || diagram.nodes.length === 0}>
            Generate Selection Spec
          </button>
          <button className="secondary-button" onClick={() => onGenerate("full")} disabled={loading || diagram.nodes.length === 0}>
            Generate Full Spec
          </button>
        </div>
      </div>

      <div className="runtime-meta">
        <div>
          <span className="meta-label">Codex</span>
          <strong>{auth?.codexInstalled ? "installed" : "missing"}</strong>
        </div>
        <div>
          <span className="meta-label">Login</span>
          <strong>{auth?.codexAuthenticated ? "ready" : "not ready"}</strong>
        </div>
        <div>
          <span className="meta-label">Detail</span>
          <strong>{auth?.detail ?? "checking..."}</strong>
        </div>
      </div>

      {loading && (
        <div className="result-card">
          <h3>Running</h3>
          <p>Codex에 도식화와 범위를 전달해 시스템 설계 문서를 만들고 있습니다.</p>
        </div>
      )}

      {error && (
        <div className="result-card error-card">
          <h3>오류</h3>
          <p>{error}</p>
        </div>
      )}

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
    </section>
  );
}
