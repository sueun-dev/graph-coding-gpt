import { useMemo, useState } from "react";
import type { DiagramDocument, SpecResponse } from "../lib/types";

type BottomPanelProps = {
  diagram: DiagramDocument;
  result: SpecResponse | null;
  error: string;
  loading: boolean;
};

type BottomTab = "spec" | "buildPrompt" | "iterationPrompt" | "graph";

export default function BottomPanel({ diagram, result, error, loading }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomTab>("spec");

  const body = useMemo(() => {
    if (loading) {
      return <p className="panel-message">GPT-5.4가 도식화를 읽고 구조화된 스펙을 생성하는 중입니다.</p>;
    }

    if (error) {
      return <p className="panel-message panel-error">{error}</p>;
    }

    if (activeTab === "graph") {
      return <pre className="panel-code">{JSON.stringify(diagram, null, 2)}</pre>;
    }

    if (!result) {
      return <p className="panel-message">아직 생성된 스펙이 없습니다. 우측 AI 패널에서 스펙 생성을 실행하세요.</p>;
    }

    if (activeTab === "buildPrompt") {
      return <pre className="panel-code">{result.spec.buildPrompt}</pre>;
    }

    if (activeTab === "iterationPrompt") {
      return <pre className="panel-code">{result.spec.iterationPrompt}</pre>;
    }

    return (
      <div className="spec-layout">
        <section className="spec-card">
          <h3>{result.spec.title}</h3>
          <p>{result.spec.overview}</p>
        </section>
        <section className="spec-card">
          <h3>Architecture</h3>
          <ul>
            {result.spec.architecture.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="spec-card">
          <h3>Execution Plan</h3>
          <ol>
            {result.spec.executionPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
        <section className="spec-card">
          <h3>Test Plan</h3>
          <ul>
            {result.spec.testPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    );
  }, [activeTab, diagram, error, loading, result]);

  return (
    <section className="bottom-panel">
      <div className="bottom-tabs">
        <button className={activeTab === "spec" ? "is-active" : ""} onClick={() => setActiveTab("spec")}>
          SPECIFICATION
        </button>
        <button className={activeTab === "buildPrompt" ? "is-active" : ""} onClick={() => setActiveTab("buildPrompt")}>
          BUILD PROMPT
        </button>
        <button className={activeTab === "iterationPrompt" ? "is-active" : ""} onClick={() => setActiveTab("iterationPrompt")}>
          ITERATION
        </button>
        <button className={activeTab === "graph" ? "is-active" : ""} onClick={() => setActiveTab("graph")}>
          GRAPH JSON
        </button>
      </div>
      <div className="bottom-body">{body}</div>
    </section>
  );
}
