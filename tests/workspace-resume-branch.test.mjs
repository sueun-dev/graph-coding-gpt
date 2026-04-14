import test from "node:test";
import assert from "node:assert/strict";

import { classifyWorkspaceResumeState } from "../server/workspace-bootstrap.mjs";

const createManifest = () => ({
  marker: "graph-coding-gpt-workspace",
  app: "graph-coding-gpt",
  formatVersion: 1,
  workspaceId: "gcg_ws_test",
  createdAt: "2026-04-12T00:00:00.000Z",
  lastOpenedAt: "2026-04-12T00:00:00.000Z",
  graphHash: null,
  state: "initialized",
});

test("classifyWorkspaceResumeState uses manifest-first ownership branching", () => {
  const base = {
    hasManifest: false,
    hasHarness: false,
    hasDiagram: false,
    hasWorkflowState: false,
    hasStepHistory: false,
    hasResumeState: false,
    hasCodeSignals: false,
    graphHashMatches: null,
    hasWorkflowBuildEvidence: false,
    resumeDecision: null,
    manifest: null,
  };

  const externalEmpty = classifyWorkspaceResumeState(base);
  assert.equal(externalEmpty.hasManifest, false);
  assert.equal(externalEmpty.resumeBranch.kind, "unmanaged-workspace");
  assert.equal(externalEmpty.internalBranch.kind, "external-empty-workspace");

  const externalCode = classifyWorkspaceResumeState({ ...base, hasCodeSignals: true });
  assert.equal(externalCode.resumeBranch.kind, "unmanaged-workspace");
  assert.equal(externalCode.internalBranch.kind, "external-codebase");
  assert.equal(externalCode.resumeBranch.needsDecision, true);

  const managedHarness = classifyWorkspaceResumeState({
    ...base,
    hasManifest: true,
    manifest: createManifest(),
    hasHarness: true,
  });
  assert.equal(managedHarness.resumeBranch.kind, "managed-workspace");
  assert.equal(managedHarness.internalBranch.kind, "managed-harness-only");
  assert.equal(managedHarness.resumeBranch.needsDecision, false);

  const managedWorkflow = classifyWorkspaceResumeState({
    ...base,
    hasManifest: true,
    manifest: createManifest(),
    hasHarness: true,
    hasDiagram: true,
    hasWorkflowState: true,
    hasCodeSignals: true,
    graphHashMatches: true,
    hasWorkflowBuildEvidence: true,
  });
  assert.equal(managedWorkflow.resumeBranch.kind, "managed-workspace");
  assert.equal(managedWorkflow.internalBranch.kind, "managed-workflow-in-progress");

  const managedDrifted = classifyWorkspaceResumeState({
    ...base,
    hasManifest: true,
    manifest: createManifest(),
    hasHarness: true,
    hasDiagram: true,
    hasWorkflowState: true,
    hasCodeSignals: true,
    graphHashMatches: false,
  });
  assert.equal(managedDrifted.resumeBranch.kind, "managed-workspace");
  assert.equal(managedDrifted.internalBranch.kind, "managed-drifted-workspace");
  assert.equal(managedDrifted.resumeBranch.needsDecision, true);

  const unmanagedLegacy = classifyWorkspaceResumeState({
    ...base,
    hasHarness: true,
    hasDiagram: true,
    hasCodeSignals: true,
  });
  assert.equal(unmanagedLegacy.resumeBranch.kind, "unmanaged-workspace");
  assert.equal(unmanagedLegacy.internalBranch.kind, "legacy-graphcoding-artifacts");
  assert.equal(unmanagedLegacy.resumeBranch.needsDecision, true);
});

test("saved resume decisions suppress repeated unmanaged prompts until manifest adoption happens", () => {
  const base = {
    hasManifest: false,
    manifest: null,
    hasHarness: false,
    hasDiagram: false,
    hasWorkflowState: false,
    hasStepHistory: false,
    hasResumeState: false,
    hasCodeSignals: true,
    graphHashMatches: null,
    hasWorkflowBuildEvidence: false,
  };

  const analyzeExisting = classifyWorkspaceResumeState({
    ...base,
    resumeDecision: { decisionKind: "analyze-existing-code" },
  });
  assert.equal(analyzeExisting.resumeBranch.kind, "unmanaged-workspace");
  assert.equal(analyzeExisting.internalBranch.kind, "external-code-analysis-requested");
  assert.equal(analyzeExisting.resumeBranch.needsDecision, false);

  const initializeFresh = classifyWorkspaceResumeState({
    ...base,
    resumeDecision: { decisionKind: "initialize-fresh-workflow" },
  });
  assert.equal(initializeFresh.internalBranch.kind, "external-fresh-workflow-requested");
  assert.equal(initializeFresh.resumeBranch.needsDecision, false);

  const trustLegacyGraph = classifyWorkspaceResumeState({
    ...base,
    hasResumeState: true,
    hasHarness: true,
    hasDiagram: true,
    resumeDecision: { decisionKind: "trust-current-graph" },
  });
  assert.equal(trustLegacyGraph.internalBranch.kind, "legacy-graph-adoption-requested");
  assert.equal(trustLegacyGraph.resumeBranch.needsDecision, false);
});
