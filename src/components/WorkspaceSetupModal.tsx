import { useEffect, useState } from "react";
import { HARNESS_PRESETS, cloneHarnessConfig, createHarnessFromPreset, getHarnessPreset } from "../lib/harness";
import type { HarnessConfig, HarnessPresetId } from "../lib/types";

type WorkspaceSetupModalProps = {
  open: boolean;
  workspaceName: string;
  initialPreset: HarnessPresetId;
  existingConfig: HarnessConfig | null;
  canWriteToWorkspace: boolean;
  onClose: () => void;
  onSave: (config: HarnessConfig) => Promise<void> | void;
};

type Step = "preset" | "advanced";

export default function WorkspaceSetupModal({
  open,
  workspaceName,
  initialPreset,
  existingConfig,
  canWriteToWorkspace,
  onClose,
  onSave,
}: WorkspaceSetupModalProps) {
  const [step, setStep] = useState<Step>("preset");
  const [config, setConfig] = useState<HarnessConfig>(() =>
    existingConfig ? cloneHarnessConfig(existingConfig) : createHarnessFromPreset(initialPreset, workspaceName || "New Workspace"),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStep("preset");
    setConfig(existingConfig ? cloneHarnessConfig(existingConfig) : createHarnessFromPreset(initialPreset, workspaceName || "New Workspace"));
  }, [existingConfig, initialPreset, open, workspaceName]);

  if (!open) {
    return null;
  }

  const updateConfig = <K extends keyof HarnessConfig>(key: K, value: HarnessConfig[K]) => {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateStack = (field: keyof HarnessConfig["stack"], value: string) => {
    setConfig((current) => ({
      ...current,
      stack: {
        ...current.stack,
        [field]: value,
      },
    }));
  };

  const updateAgentTool = (field: keyof HarnessConfig["agent"]["tools"], value: boolean) => {
    setConfig((current) => ({
      ...current,
      agent: {
        ...current.agent,
        tools: {
          ...current.agent.tools,
          [field]: value,
        },
      },
    }));
  };

  const updateQuality = (field: keyof HarnessConfig["quality"], value: boolean) => {
    setConfig((current) => ({
      ...current,
      quality: {
        ...current.quality,
        [field]: value,
      },
    }));
  };

  const applyPreset = (presetId: HarnessPresetId) => {
    const presetConfig = createHarnessFromPreset(presetId, config.projectName || workspaceName || "New Workspace", config.projectGoal);
    setConfig((current) => ({
      ...presetConfig,
      projectName: current.projectName || presetConfig.projectName,
      projectGoal: current.projectGoal || presetConfig.projectGoal,
    }));
  };

  const save = async () => {
    if (!canWriteToWorkspace) {
      return;
    }

    setSaving(true);
    try {
      await onSave(config);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-modal">
      <div className="setup-modal__backdrop" onClick={onClose} />
      <div className="setup-modal__dialog">
        <div className="setup-modal__header">
          <div>
            <span className="editor-view__eyebrow">Workspace Setup</span>
            <h2>{workspaceName || "New Workspace"} Harness</h2>
            <p className="setup-copy">
              처음부터 프레임워크, 도구, 테스트 정책, sandbox를 고정해 두면 이후 도식화 생성과 빌드 프롬프트가 훨씬 안정적입니다.
            </p>
          </div>
          <div className="setup-modal__header-meta">
            <span className="editor-chip">{canWriteToWorkspace ? "writes to workspace" : "open folder required"}</span>
            <button className="icon-button" onClick={onClose} title="Close">
              ×
            </button>
          </div>
        </div>

        <div className="setup-steps">
          <button className={step === "preset" ? "is-active" : ""} onClick={() => setStep("preset")}>
            1. Preset
          </button>
          <button className={step === "advanced" ? "is-active" : ""} onClick={() => setStep("advanced")}>
            2. Advanced
          </button>
        </div>

        {step === "preset" ? (
          <div className="setup-body">
            <section className="setup-section">
              <label className="setup-field">
                <span>Project Name</span>
                <input value={config.projectName} onChange={(event) => updateConfig("projectName", event.target.value)} />
              </label>
              <label className="setup-field">
                <span>Project Goal</span>
                <textarea value={config.projectGoal} rows={3} onChange={(event) => updateConfig("projectGoal", event.target.value)} />
              </label>
            </section>

            <section className="setup-preset-grid">
              {HARNESS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`setup-preset-card ${config.presetId === preset.id ? "is-active" : ""}`}
                  onClick={() => applyPreset(preset.id)}
                >
                  <div>
                    <strong>{preset.label}</strong>
                    <small>{preset.tagline}</small>
                  </div>
                  <p>{preset.description}</p>
                </button>
              ))}
            </section>

            <section className="setup-summary-card">
              <h3>{getHarnessPreset(config.presetId).label}</h3>
              <div className="setup-summary-grid">
                <div>
                  <span className="meta-label">Frontend</span>
                  <strong>{config.stack.frontend}</strong>
                </div>
                <div>
                  <span className="meta-label">Backend</span>
                  <strong>{config.stack.backend}</strong>
                </div>
                <div>
                  <span className="meta-label">Package Manager</span>
                  <strong>{config.stack.packageManager}</strong>
                </div>
                <div>
                  <span className="meta-label">Sandbox</span>
                  <strong>{config.agent.sandbox}</strong>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="setup-body setup-body-advanced">
            <section className="setup-section">
              <h3>Stack</h3>
              <div className="setup-form-grid">
                <label className="setup-field">
                  <span>App Type</span>
                  <input value={config.stack.appType} onChange={(event) => updateStack("appType", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Frontend</span>
                  <input value={config.stack.frontend} onChange={(event) => updateStack("frontend", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Backend</span>
                  <input value={config.stack.backend} onChange={(event) => updateStack("backend", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Runtime</span>
                  <input value={config.stack.runtime} onChange={(event) => updateStack("runtime", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Package Manager</span>
                  <input value={config.stack.packageManager} onChange={(event) => updateStack("packageManager", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Styling</span>
                  <input value={config.stack.styling} onChange={(event) => updateStack("styling", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Database</span>
                  <input value={config.stack.database} onChange={(event) => updateStack("database", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Auth</span>
                  <input value={config.stack.auth} onChange={(event) => updateStack("auth", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="setup-section">
              <h3>Agent Policy</h3>
              <div className="setup-form-grid">
                <label className="setup-field">
                  <span>Reasoning</span>
                  <select
                    value={config.agent.reasoningEffort}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        agent: {
                          ...current.agent,
                          reasoningEffort: event.target.value as HarnessConfig["agent"]["reasoningEffort"],
                        },
                      }))
                    }
                  >
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                  </select>
                </label>
                <label className="setup-field">
                  <span>Sandbox</span>
                  <select
                    value={config.agent.sandbox}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        agent: {
                          ...current.agent,
                          sandbox: event.target.value as HarnessConfig["agent"]["sandbox"],
                        },
                      }))
                    }
                  >
                    <option value="read-only">read-only</option>
                    <option value="workspace-write">workspace-write</option>
                    <option value="danger-full-access">danger-full-access</option>
                  </select>
                </label>
              </div>

              <div className="setup-checkbox-grid">
                <label className="setup-check"><input type="checkbox" checked={config.agent.tools.mcp} onChange={(event) => updateAgentTool("mcp", event.target.checked)} />MCP</label>
                <label className="setup-check"><input type="checkbox" checked={config.agent.tools.shell} onChange={(event) => updateAgentTool("shell", event.target.checked)} />Shell</label>
                <label className="setup-check"><input type="checkbox" checked={config.agent.tools.browser} onChange={(event) => updateAgentTool("browser", event.target.checked)} />Browser</label>
                <label className="setup-check"><input type="checkbox" checked={config.agent.tools.applyPatch} onChange={(event) => updateAgentTool("applyPatch", event.target.checked)} />Apply Patch</label>
                <label className="setup-check"><input type="checkbox" checked={config.agent.tools.fileSearch} onChange={(event) => updateAgentTool("fileSearch", event.target.checked)} />File Search</label>
              </div>
            </section>

            <section className="setup-section">
              <h3>Quality Gates</h3>
              <div className="setup-checkbox-grid">
                <label className="setup-check"><input type="checkbox" checked={config.quality.lint} onChange={(event) => updateQuality("lint", event.target.checked)} />Lint</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.typecheck} onChange={(event) => updateQuality("typecheck", event.target.checked)} />Typecheck</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.unitTests} onChange={(event) => updateQuality("unitTests", event.target.checked)} />Unit Tests</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.e2eTests} onChange={(event) => updateQuality("e2eTests", event.target.checked)} />E2E</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.partialBuilds} onChange={(event) => updateQuality("partialBuilds", event.target.checked)} />Partial Builds</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.requireTestsBeforeDone} onChange={(event) => updateQuality("requireTestsBeforeDone", event.target.checked)} />Require Tests Before Done</label>
                <label className="setup-check"><input type="checkbox" checked={config.quality.allowStubsOutsideScope} onChange={(event) => updateQuality("allowStubsOutsideScope", event.target.checked)} />Allow Stubs Outside Scope</label>
              </div>
            </section>
          </div>
        )}

        <div className="setup-modal__footer">
          <div className="setup-footer-copy">
            Harness files to save:
            <code>.graphcoding/harness.json</code>
            <code>.graphcoding/project-profile.md</code>
            <code>.graphcoding/build-policy.json</code>
            {!canWriteToWorkspace ? <span>Open Folder로 native workspace를 먼저 연결해야 저장할 수 있습니다.</span> : null}
          </div>
          <div className="setup-footer-actions">
            <button className="ghost-button compact-button" onClick={onClose}>
              Cancel
            </button>
            {step === "preset" ? (
              <button className="primary-button compact-button" onClick={() => setStep("advanced")}>
                Next
              </button>
            ) : (
              <button className="primary-button compact-button" onClick={save} disabled={saving || !canWriteToWorkspace}>
                {saving ? "Saving..." : "Save Harness"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
