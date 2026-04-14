import type { ChangeEvent } from "react";
import type { BuildResponse, DiagramDocument, DiagramGenerationResponse, SpecResponse, StepExecutionState } from "../lib/types";

type AuthStatus = {
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  detail: string;
};

type RunPanelProps = {
  auth: AuthStatus | null;
  diagram: DiagramDocument;
  brief: string;
  canGenerateDiagram: boolean;
  diagramGenerationHint: string;
  diagramLoading: boolean;
  diagramResult: DiagramGenerationResponse | null;
  diagramError: string;
  hasApprovedDiagram: boolean;
  approvedAt: string | null;
  graphApprovalStale: boolean;
  graphApprovalLoading: boolean;
  graphApprovalError: string;
  reachableCount: number;
  approvedCount: number;
  blockedCount: number;
  finalWorkflowStatus: "in-progress" | "complete";
  selectedStepState: StepExecutionState | null;
  selectedStepTitle: string | null;
  loading: boolean;
  result: SpecResponse | null;
  error: string;
  lastSpecMode: "full" | "selection" | null;
  buildLoading: boolean;
  buildResult: BuildResponse | null;
  buildError: string;
  canBuildInWorkspace: boolean;
  buildHint: string;
  canBuildSelection: boolean;
  canBuildFull: boolean;
  canApproveGraph: boolean;
  canApproveStep: boolean;
  onBriefChange: (value: string) => void;
  onGenerateDiagram: (strategy: "replace" | "augment") => void;
  onGenerate: (mode: "full" | "selection") => void;
  onBuild: (mode: "full" | "selection") => void;
  onApproveGraph: () => void;
  onApproveStep: () => void;
};

export default function RunPanel({
  auth,
  diagram,
  brief,
  canGenerateDiagram,
  diagramGenerationHint,
  diagramLoading,
  diagramResult,
  diagramError,
  hasApprovedDiagram,
  approvedAt,
  graphApprovalStale,
  graphApprovalLoading,
  graphApprovalError,
  reachableCount,
  approvedCount,
  blockedCount,
  finalWorkflowStatus,
  selectedStepState,
  selectedStepTitle,
  loading,
  result,
  error,
  lastSpecMode,
  buildLoading,
  buildResult,
  buildError,
  canBuildInWorkspace,
  buildHint,
  canBuildSelection,
  canBuildFull,
  canApproveGraph,
  canApproveStep,
  onBriefChange,
  onGenerateDiagram,
  onGenerate,
  onBuild,
  onApproveGraph,
  onApproveStep,
}: RunPanelProps) {
  const scopeLabel = diagram.scope.mode === "selection" ? `${diagram.scope.nodeIds.length} nodes selected` : "Full diagram";
  const hasDiagram = diagram.nodes.length > 0;
  const handleBriefInput = (event: ChangeEvent<HTMLTextAreaElement>) => onBriefChange(event.target.value);
  const buildOutputPreview = buildResult?.output ? buildResult.output.split("\n").slice(0, 8).join("\n") : "";
  const graphReviewMessage = (() => {
    if (!hasDiagram) {
      return "아직 draft diagram이 없습니다. Brief를 적고 Generate First Diagram을 눌러야 합니다.";
    }

    if (!hasApprovedDiagram) {
      return "현재 diagram은 draft 상태입니다. Build 기준 source of truth로 쓰려면 먼저 Approve Graph가 필요합니다.";
    }

    if (graphApprovalStale) {
      return "현재 draft diagram이 승인된 graph와 다릅니다. Spec/Build 전에 Approve Graph로 다시 확정해야 합니다.";
    }

    return approvedAt
      ? `Approved graph가 현재 개발 기준입니다. Last approved at ${approvedAt}.`
      : "Approved graph가 현재 개발 기준입니다.";
  })();
  const selectedStepMessage = (() => {
    if (!selectedStepTitle || !selectedStepState) {
      return "Selection step build는 현재 reachable한 executable node 1개를 선택했을 때만 가능합니다.";
    }

    if (selectedStepState === "approved") {
      return `${selectedStepTitle}: 이미 승인된 step입니다. 다음 reachable step을 선택하거나 graph를 다시 승인하세요.`;
    }

    if (selectedStepState === "reachable") {
      return `${selectedStepTitle}: 현재 build 가능한 reachable step입니다.`;
    }

    if (selectedStepState === "blocked") {
      return `${selectedStepTitle}: 아직 blocked 상태입니다. 선행 step 승인이 먼저 필요합니다.`;
    }

    return `${selectedStepTitle}: annotation node는 step build 대상이 아닙니다.`;
  })();
  const buildReadinessMessage = (() => {
    if (!hasApprovedDiagram) {
      return "아직 approved graph가 없습니다. 먼저 Approve Graph로 현재 diagram을 개발 기준으로 확정해야 합니다.";
    }

    if (graphApprovalStale) {
      return "현재 draft diagram이 승인본과 다릅니다. Step build 전에 Approve Graph로 다시 확정해야 합니다.";
    }

    if (loading) {
      return "현재 spec을 생성 중입니다. 완료된 뒤 같은 범위의 code build를 실행할 수 있습니다.";
    }

    if (buildResult) {
      return buildResult.mode === "selection"
        ? "Selection code build가 완료되었습니다. 아래 결과 카드와 workspace 파일 트리를 확인하면 됩니다."
        : "Full code build가 완료되었습니다. 아래 결과 카드와 workspace 파일 트리를 확인하면 됩니다.";
    }

    if (!canBuildInWorkspace) {
      return "먼저 Open Folder로 실제 폴더를 연 뒤, Selection 또는 Full spec을 생성해야 합니다.";
    }

    if (canBuildSelection) {
      return "Selection spec이 준비되었습니다. Build Selection Code를 눌러 현재 폴더에 직접 코드를 작성할 수 있습니다.";
    }

    if (canBuildFull) {
      return "Full spec이 준비되었습니다. Build Full Code를 눌러 현재 폴더에 직접 코드를 작성할 수 있습니다.";
    }

    if (!result || !lastSpecMode) {
      return "아직 build에 사용할 spec이 없습니다. 먼저 Selection 또는 Full spec을 생성해야 합니다.";
    }

    return lastSpecMode === "selection"
      ? "현재는 Selection spec만 준비되어 있습니다. Selection 코드를 만들려면 Build Selection Code를 누르세요."
      : "현재는 Full spec만 준비되어 있습니다. Full 코드를 만들려면 Build Full Code를 누르세요.";
  })();

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
        <p>먼저 Open Folder와 Edit Harness를 끝낸 뒤, GPT-5.4로 전체 diagram 초안을 생성합니다.</p>
        <textarea
          className="runtime-textarea"
          value={brief}
          onChange={handleBriefInput}
          rows={6}
          placeholder="예: OAuth 로그인으로 연결되는 데스크톱 앱을 만들고 싶다. 사용자는 도식화를 그린 뒤 GPT-5.4가 기본 앱 구조와 구현 프롬프트를 생성해야 한다. 부분 구현과 테스트 루프도 필요하다."
        />
        <p className={canGenerateDiagram ? "result-warning result-warning--ok" : "result-warning"}>{diagramGenerationHint}</p>
        <div className="button-row">
          <button className="primary-button" onClick={() => onGenerateDiagram(hasDiagram ? "augment" : "replace")} disabled={diagramLoading || !canGenerateDiagram}>
            {hasDiagram ? "Refine Current Diagram" : "Generate First Diagram"}
          </button>
          {hasDiagram ? (
            <button className="secondary-button" onClick={() => onGenerateDiagram("replace")} disabled={diagramLoading || !canGenerateDiagram}>
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
        <h3>Graph Review</h3>
        <p>{graphReviewMessage}</p>
        <div className="runtime-summary-grid runtime-summary-grid-tight">
          <div className="runtime-summary-cell">
            <span className="meta-label">Approved</span>
            <strong>{approvedCount}</strong>
          </div>
          <div className="runtime-summary-cell">
            <span className="meta-label">Reachable</span>
            <strong>{reachableCount}</strong>
          </div>
          <div className="runtime-summary-cell">
            <span className="meta-label">Blocked</span>
            <strong>{blockedCount}</strong>
          </div>
          <div className="runtime-summary-cell">
            <span className="meta-label">Workflow</span>
            <strong>{finalWorkflowStatus}</strong>
          </div>
        </div>
        <p className={selectedStepState === "reachable" ? "result-warning result-warning--ok" : "result-warning"}>{selectedStepMessage}</p>
        <div className="button-row">
          <button className="primary-button" onClick={onApproveGraph} disabled={graphApprovalLoading || !canApproveGraph}>
            {graphApprovalLoading ? "Approving Graph..." : "Approve Graph"}
          </button>
          <button className="secondary-button" onClick={onApproveStep} disabled={!canApproveStep}>
            Approve Current Step
          </button>
        </div>
      </div>

      {graphApprovalError && (
        <div className="result-card error-card">
          <h3>Graph Approval 오류</h3>
          <p>{graphApprovalError}</p>
        </div>
      )}

      <div className="runtime-card">
        <h3>Diagram to Spec</h3>
        <p>
          현재 범위: <strong>{scopeLabel}</strong>
        </p>
        <p>
          이 단계는 코드를 바로 만드는 버튼이 아니라, 코드 생성을 위한 스펙과 프롬프트를 만드는 단계입니다.
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

      <div className="runtime-card">
        <h3>Spec to Code</h3>
        <p>{buildHint}</p>
        {!canBuildInWorkspace ? <p className="result-warning">코드 생성은 `Open Folder`로 연 native workspace에서만 실행됩니다.</p> : null}
        <div className="button-row">
          <button className="primary-button" onClick={() => onBuild("selection")} disabled={buildLoading || loading}>
            Build Selection Code
          </button>
          <button className="secondary-button" onClick={() => onBuild("full")} disabled={buildLoading || loading}>
            Build Full Code
          </button>
        </div>
        <p className={canBuildSelection || canBuildFull || Boolean(buildResult) ? "result-warning result-warning--ok" : "result-warning"}>
          {buildReadinessMessage}
        </p>
      </div>

      {buildLoading && (
        <div className="result-card">
          <h3>Building Code</h3>
          <p>현재 workspace에 GPT-5.4가 직접 코드를 작성하고 있습니다. 보통 수십 초에서 몇 분까지 걸릴 수 있습니다.</p>
        </div>
      )}

      {buildError && (
        <div className="result-card error-card">
          <h3>Build 오류</h3>
          <pre className="panel-code panel-code--compact panel-code--error">{buildError}</pre>
        </div>
      )}

      {buildResult && (
        <div className="result-card">
          <div className="result-card__header">
            <h3>{buildResult.mode === "selection" ? "Selection Code Build" : "Full Code Build"}</h3>
            <span className="result-source">{buildResult.source}</span>
          </div>
          <p>{buildResult.workspaceRoot}</p>
          <p className="result-warning">
            마지막 실행 프롬프트: <strong>{buildResult.promptKind}</strong>
          </p>
          {typeof buildResult.attemptCount === "number" ? (
            <p className="result-warning">
              Attempts: <strong>{buildResult.attemptCount}</strong>
              {buildResult.recovered ? " (auto-recovered)" : ""}
            </p>
          ) : null}
          {buildResult.logPath ? <p className="result-warning">Log: <strong>{buildResult.logPath}</strong></p> : null}
          {buildResult.contractPath ? <p className="result-warning">Step contract: <strong>{buildResult.contractPath}</strong></p> : null}
          {buildResult.mistakePath ? <p className="result-warning">Mistake log: <strong>{buildResult.mistakePath}</strong></p> : null}
          {buildOutputPreview ? <pre className="panel-code panel-code--compact">{buildOutputPreview}</pre> : null}
        </div>
      )}

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
