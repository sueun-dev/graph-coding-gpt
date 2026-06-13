import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESIGN,
  HARNESS_PRESETS,
  buildHarnessArtifacts,
  cloneHarnessConfig,
  createHarnessFromPreset,
  findWorkspaceHarnessFile,
  getHarnessPreset,
  inferHarnessPreset,
  sanitizeHarnessConfig,
  tryParseHarnessConfig,
} from "../src/lib/harness";
import type { HarnessConfig, WorkspaceFile } from "../src/lib/types";

const wsFile = (path: string): WorkspaceFile =>
  ({
    id: path,
    path,
    name: path.split("/").pop() ?? path,
    parts: path.split("/"),
    size: 0,
    type: "",
    file: new File([], path),
  }) as WorkspaceFile;

describe("HARNESS_PRESETS / getHarnessPreset", () => {
  it("defines all five presets with stable ids", () => {
    expect(HARNESS_PRESETS.map((p) => p.id)).toEqual([
      "saas-web",
      "api-service",
      "agent-tool",
      "desktop-app",
      "mobile-app",
    ]);
  });

  it("getHarnessPreset returns the matching preset", () => {
    expect(getHarnessPreset("desktop-app").label).toBe("Desktop App");
    expect(getHarnessPreset("api-service").defaults.stack.runtime).toBe("Python");
  });

  it("getHarnessPreset falls back to the first preset for unknown ids", () => {
    expect(getHarnessPreset("ghost" as never)).toBe(HARNESS_PRESETS[0]);
  });

  it("every preset default has version 1 and a populated stack", () => {
    for (const preset of HARNESS_PRESETS) {
      expect(preset.defaults.version).toBe(1);
      expect(preset.defaults.presetId).toBe(preset.id);
      expect(preset.defaults.stack.appType.length).toBeGreaterThan(0);
    }
  });
});

describe("createHarnessFromPreset", () => {
  it("clones the preset and applies the project name", () => {
    const config = createHarnessFromPreset("saas-web", "My App");
    expect(config.projectName).toBe("My App");
    expect(config.presetId).toBe("saas-web");
  });

  it("falls back to the preset label when name is empty", () => {
    const config = createHarnessFromPreset("agent-tool", "");
    expect(config.projectName).toBe("Agent Tooling");
  });

  it("returns a deep copy — mutating the result never touches the preset", () => {
    const config = createHarnessFromPreset("saas-web", "X");
    config.design.palette.primary = "#000000";
    config.agent.tools.mcp = false;
    expect(getHarnessPreset("saas-web").defaults.design.palette.primary).not.toBe("#000000");
    expect(getHarnessPreset("saas-web").defaults.agent.tools.mcp).toBe(true);
  });
});

describe("sanitizeHarnessConfig / cloneHarnessConfig", () => {
  const base = createHarnessFromPreset("saas-web", "Base");

  it("forces version to 1 and copies nested objects (no shared refs)", () => {
    const dirty = { ...base, version: 7 as unknown as 1 };
    const clean = sanitizeHarnessConfig(dirty);
    expect(clean.version).toBe(1);
    expect(clean.design.palette).not.toBe(base.design.palette);
    expect(clean.agent.tools).not.toBe(base.agent.tools);
    expect(clean.notes).not.toBe(base.notes);
  });

  it("drops unknown top-level keys", () => {
    const withExtra = { ...base, hacker: "payload" } as HarnessConfig & { hacker: string };
    const clean = sanitizeHarnessConfig(withExtra) as HarnessConfig & { hacker?: string };
    expect(clean.hacker).toBeUndefined();
  });

  it("cloneHarnessConfig produces an equal but independent config", () => {
    const clone = cloneHarnessConfig(base);
    expect(clone).toEqual(sanitizeHarnessConfig(base));
    clone.stack.frontend = "changed";
    expect(base.stack.frontend).not.toBe("changed");
  });
});

describe("inferHarnessPreset", () => {
  it("detects desktop apps (tauri/electron)", () => {
    expect(inferHarnessPreset([wsFile("src-tauri/tauri.conf.json")])).toBe("desktop-app");
    expect(inferHarnessPreset([wsFile("electron/main.js")])).toBe("desktop-app");
  });

  it("detects mobile apps (pubspec/android/ios)", () => {
    expect(inferHarnessPreset([wsFile("pubspec.yaml")])).toBe("mobile-app");
    expect(inferHarnessPreset([wsFile("android/build.gradle")])).toBe("mobile-app");
  });

  it("detects python api services", () => {
    expect(inferHarnessPreset([wsFile("pyproject.toml")])).toBe("api-service");
    expect(inferHarnessPreset([wsFile("requirements.txt")])).toBe("api-service");
  });

  it("detects agent tooling via .graphcoding/mcp/agent markers", () => {
    expect(inferHarnessPreset([wsFile(".graphcoding/harness.json")])).toBe("agent-tool");
    expect(inferHarnessPreset([wsFile("src/mcp/server.ts")])).toBe("agent-tool");
  });

  it("defaults to saas-web for a plain web project", () => {
    expect(inferHarnessPreset([wsFile("src/index.tsx"), wsFile("package.json")])).toBe("saas-web");
    expect(inferHarnessPreset([])).toBe("saas-web");
  });

  it("honors detection priority: desktop wins over mobile when both present", () => {
    expect(inferHarnessPreset([wsFile("ios/Runner.xcodeproj"), wsFile("electron/main.js")])).toBe(
      "desktop-app",
    );
  });
});

describe("tryParseHarnessConfig", () => {
  it("parses a valid config and sanitizes it", () => {
    const valid = JSON.stringify(createHarnessFromPreset("saas-web", "Parsed"));
    const parsed = tryParseHarnessConfig(valid);
    expect(parsed?.projectName).toBe("Parsed");
    expect(parsed?.version).toBe(1);
  });

  it("returns null for malformed JSON", () => {
    expect(tryParseHarnessConfig("{not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(tryParseHarnessConfig(JSON.stringify({ version: 1 }))).toBeNull();
    expect(
      tryParseHarnessConfig(JSON.stringify({ version: 2, projectName: "x", presetId: "saas-web" })),
    ).toBeNull();
  });

  it("backfills a missing design block from DEFAULT_DESIGN", () => {
    const partial = createHarnessFromPreset("saas-web", "NoDesign") as Partial<HarnessConfig>;
    delete partial.design;
    const parsed = tryParseHarnessConfig(JSON.stringify(partial));
    expect(parsed?.design.palette.primary).toBe(DEFAULT_DESIGN.palette.primary);
  });
});

describe("findWorkspaceHarnessFile", () => {
  it("finds the harness file at the canonical path", () => {
    const target = wsFile(".graphcoding/harness.json");
    expect(findWorkspaceHarnessFile([wsFile("src/a.ts"), target])).toBe(target);
  });

  it("returns undefined when absent", () => {
    expect(findWorkspaceHarnessFile([wsFile("src/a.ts")])).toBeUndefined();
  });
});

describe("buildHarnessArtifacts", () => {
  const config = createHarnessFromPreset("saas-web", "Artifacts Demo");

  it("emits the four expected artifact files", () => {
    const artifacts = buildHarnessArtifacts(config);
    expect(artifacts.map((a) => a.path)).toEqual([
      ".graphcoding/harness.json",
      ".graphcoding/project-profile.md",
      ".graphcoding/build-policy.json",
      ".graphcoding/design-tokens.json",
    ]);
  });

  it("harness.json round-trips to the sanitized config", () => {
    const artifacts = buildHarnessArtifacts(config);
    const harnessJson = artifacts.find((a) => a.path === ".graphcoding/harness.json")!;
    expect(JSON.parse(harnessJson.content)).toEqual(sanitizeHarnessConfig(config));
  });

  it("project-profile.md renders quality gates as enabled/disabled words", () => {
    const tweaked = cloneHarnessConfig(config);
    tweaked.quality.lint = true;
    tweaked.quality.e2eTests = false;
    const profile = buildHarnessArtifacts(tweaked).find((a) => a.path.endsWith(".md"))!.content;
    expect(profile).toContain("- Lint: enabled");
    expect(profile).toContain("- E2E Tests: disabled");
    expect(profile).toContain("# Artifacts Demo");
  });

  it("project-profile.md lists notes, or a placeholder when there are none", () => {
    const withNotes = cloneHarnessConfig(config);
    withNotes.notes = ["First note", "Second note"];
    const profileWith = buildHarnessArtifacts(withNotes).find((a) => a.path.endsWith(".md"))!.content;
    expect(profileWith).toContain("- First note");
    expect(profileWith).toContain("- Second note");

    const withoutNotes = cloneHarnessConfig(config);
    withoutNotes.notes = [];
    const profileWithout = buildHarnessArtifacts(withoutNotes)
      .find((a) => a.path.endsWith(".md"))!.content;
    expect(profileWithout).toContain("- No extra notes yet.");
  });

  it("design-tokens.json captures the palette", () => {
    const tokens = JSON.parse(
      buildHarnessArtifacts(config).find((a) => a.path.endsWith("design-tokens.json"))!.content,
    );
    expect(tokens.palette.primary).toBe(config.design.palette.primary);
    expect(tokens.theme).toBe(config.design.theme);
  });
});
