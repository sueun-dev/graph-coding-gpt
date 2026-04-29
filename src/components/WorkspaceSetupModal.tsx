import { useEffect, useState } from "react";
import { HARNESS_PRESETS, cloneHarnessConfig, createHarnessFromPreset, getHarnessPreset } from "../lib/harness";
import type { HarnessConfig, HarnessDesign, HarnessPresetId } from "../lib/types";
import { LiquidGlassButton } from "./LiquidGlassControls";

const FALLBACK_DESIGN: HarnessDesign = {
  theme: "dark",
  referenceStyle: "Clean minimal product UI",
  palette: {
    primary: "#6366f1",
    accent: "#f59e0b",
    background: "#0b0b0f",
    foreground: "#f5f5f5",
    muted: "#1f2024",
    error: "#ef4444",
  },
  radius: "rounded",
  density: "comfortable",
  typography: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" },
  notes: "",
};

const ensureDesign = (config: HarnessConfig): HarnessConfig => {
  if (config.design && config.design.palette && config.design.typography) {
    return config;
  }
  return {
    ...config,
    design: {
      ...FALLBACK_DESIGN,
      ...(config.design ?? {}),
      palette: { ...FALLBACK_DESIGN.palette, ...(config.design?.palette ?? {}) },
      typography: { ...FALLBACK_DESIGN.typography, ...(config.design?.typography ?? {}) },
    },
  };
};

type WorkspaceSetupModalProps = {
  open: boolean;
  workspaceName: string;
  initialPreset: HarnessPresetId;
  existingConfig: HarnessConfig | null;
  canWriteToWorkspace: boolean;
  onClose: () => void;
  onSave: (config: HarnessConfig) => Promise<void> | void;
};

type Step = "preset" | "advanced" | "design";

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
    ensureDesign(existingConfig ? cloneHarnessConfig(existingConfig) : createHarnessFromPreset(initialPreset, workspaceName || "New Workspace")),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setStep("preset");
    setSaveError("");
    setConfig(ensureDesign(existingConfig ? cloneHarnessConfig(existingConfig) : createHarnessFromPreset(initialPreset, workspaceName || "New Workspace")));
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

  const updateDesign = <K extends keyof HarnessConfig["design"]>(field: K, value: HarnessConfig["design"][K]) => {
    setConfig((current) => ({
      ...current,
      design: {
        ...current.design,
        [field]: value,
      },
    }));
  };

  const updateDesignPalette = (field: keyof HarnessConfig["design"]["palette"], value: string) => {
    setConfig((current) => ({
      ...current,
      design: {
        ...current.design,
        palette: {
          ...current.design.palette,
          [field]: value,
        },
      },
    }));
  };

  const updateDesignTypography = (field: keyof HarnessConfig["design"]["typography"], value: string) => {
    setConfig((current) => ({
      ...current,
      design: {
        ...current.design,
        typography: {
          ...current.design.typography,
          [field]: value,
        },
      },
    }));
  };

  const applyPreset = (presetId: HarnessPresetId) => {
    const presetConfig = createHarnessFromPreset(presetId, config.projectName || workspaceName || "New Workspace");
    setConfig((current) => ({
      ...presetConfig,
      projectName: current.projectName || presetConfig.projectName,
    }));
  };

  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(config);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "App Target files could not be saved.");
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
            <h2>{workspaceName || "New Workspace"} App Target</h2>
            <p className="setup-copy">
              처음부터 프레임워크, 도구, 테스트 정책, sandbox를 고정해 두면 Codex가 같은 기준으로 계획, 패치, 검증합니다.
            </p>
          </div>
          <div className="setup-modal__header-meta">
            <span className="editor-chip">{canWriteToWorkspace ? "writes to workspace" : "download fallback"}</span>
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
          <button className={step === "design" ? "is-active" : ""} onClick={() => setStep("design")}>
            3. Design
          </button>
        </div>

        {step === "preset" && (
          <div className="setup-body">
            <section className="setup-section">
              <label className="setup-field">
                <span>Project Name</span>
                <input value={config.projectName} onChange={(event) => updateConfig("projectName", event.target.value)} />
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
        )}

        {step === "advanced" && (
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

        {step === "design" && (
          <div className="setup-body setup-body-advanced">
            <section className="setup-section">
              <h3>Theme &amp; Reference</h3>
              <div className="setup-form-grid">
                <label className="setup-field">
                  <span>Theme</span>
                  <select value={config.design.theme} onChange={(event) => updateDesign("theme", event.target.value as HarnessConfig["design"]["theme"])}>
                    <option value="dark">dark</option>
                    <option value="light">light</option>
                    <option value="auto">auto</option>
                  </select>
                </label>
                <label className="setup-field">
                  <span>Radius</span>
                  <select value={config.design.radius} onChange={(event) => updateDesign("radius", event.target.value as HarnessConfig["design"]["radius"])}>
                    <option value="sharp">sharp</option>
                    <option value="rounded">rounded</option>
                    <option value="pill">pill</option>
                  </select>
                </label>
                <label className="setup-field">
                  <span>Density</span>
                  <select value={config.design.density} onChange={(event) => updateDesign("density", event.target.value as HarnessConfig["design"]["density"])}>
                    <option value="compact">compact</option>
                    <option value="comfortable">comfortable</option>
                  </select>
                </label>
                <label className="setup-field setup-field-wide">
                  <span>Reference Style</span>
                  <input
                    value={config.design.referenceStyle}
                    placeholder='예: "iOS calculator", "Linear dashboard", "Brutalist neo-monochrome"'
                    onChange={(event) => updateDesign("referenceStyle", event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="setup-section">
              <h3>Palette</h3>
              <div className="setup-form-grid setup-palette-grid">
                {(["primary", "accent", "background", "foreground", "muted", "error"] as const).map((key) => (
                  <label key={key} className="setup-field setup-palette-field">
                    <span>{key}</span>
                    <div className="setup-palette-row">
                      <input
                        type="color"
                        value={config.design.palette[key]}
                        onChange={(event) => updateDesignPalette(key, event.target.value)}
                      />
                      <input
                        type="text"
                        value={config.design.palette[key]}
                        onChange={(event) => updateDesignPalette(key, event.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="setup-section">
              <h3>Typography</h3>
              <div className="setup-form-grid">
                <label className="setup-field">
                  <span>Heading</span>
                  <input value={config.design.typography.heading} onChange={(event) => updateDesignTypography("heading", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Body</span>
                  <input value={config.design.typography.body} onChange={(event) => updateDesignTypography("body", event.target.value)} />
                </label>
                <label className="setup-field">
                  <span>Mono</span>
                  <input value={config.design.typography.mono} onChange={(event) => updateDesignTypography("mono", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="setup-section">
              <h3>Design Notes</h3>
              <label className="setup-field setup-field-wide">
                <span>Extra design guidance (optional)</span>
                <textarea
                  rows={3}
                  placeholder='예: "버튼은 press 시 scale 0.96, Display는 우측 정렬 5rem, 네온 글로우"'
                  value={config.design.notes}
                  onChange={(event) => updateDesign("notes", event.target.value)}
                />
              </label>
            </section>
          </div>
        )}

        <div className="setup-modal__footer">
          <div className="setup-footer-copy">
            Target files to save:
            <code>.graphcoding/harness.json</code>
            <code>.graphcoding/project-profile.md</code>
            <code>.graphcoding/build-policy.json</code>
            <code>.graphcoding/design-tokens.json</code>
            {saveError ? <span className="setup-save-error">{saveError}</span> : null}
          </div>
          <div className="setup-footer-actions">
            <LiquidGlassButton tone="ghost" width={82} height={30} onClick={onClose}>
              Cancel
            </LiquidGlassButton>
            {step === "preset" && (
              <LiquidGlassButton width={72} height={30} onClick={() => setStep("advanced")}>
                Next
              </LiquidGlassButton>
            )}
            {step === "advanced" && (
              <LiquidGlassButton width={72} height={30} onClick={() => setStep("design")}>
                Next
              </LiquidGlassButton>
            )}
            {step === "design" && (
              <LiquidGlassButton width={122} height={30} onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save Target"}
              </LiquidGlassButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
