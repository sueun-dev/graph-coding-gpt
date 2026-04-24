import type { HarnessArtifact, HarnessConfig, HarnessDesign, HarnessPreset, HarnessPresetId, WorkspaceFile } from "./types";

const BASE_PATHS = {
  configDir: ".graphcoding",
  artifactDir: "generated",
  testsDir: "tests",
} as const;

const DEFAULT_DESIGN: HarnessDesign = {
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
  typography: {
    heading: "Inter",
    body: "Inter",
    mono: "JetBrains Mono",
  },
  notes: "",
};

const designWith = (overrides: Partial<HarnessDesign>): HarnessDesign => ({
  ...DEFAULT_DESIGN,
  ...overrides,
  palette: { ...DEFAULT_DESIGN.palette, ...(overrides.palette ?? {}) },
  typography: { ...DEFAULT_DESIGN.typography, ...(overrides.typography ?? {}) },
});

const baseHarness = (presetId: HarnessPresetId, label: string): HarnessConfig => ({
  version: 1,
  presetId,
  projectName: label,
  stack: {
    appType: "",
    frontend: "",
    backend: "",
    runtime: "",
    packageManager: "pnpm",
    database: "",
    auth: "",
  },
  agent: {
    reasoningEffort: "high",
    sandbox: "workspace-write",
    tools: {
      mcp: true,
      shell: true,
      browser: true,
      applyPatch: true,
      fileSearch: true,
    },
  },
  quality: {
    lint: true,
    typecheck: true,
    unitTests: true,
    e2eTests: false,
    partialBuilds: true,
    requireTestsBeforeDone: true,
    allowStubsOutsideScope: true,
  },
  design: { ...DEFAULT_DESIGN, palette: { ...DEFAULT_DESIGN.palette }, typography: { ...DEFAULT_DESIGN.typography } },
  paths: { ...BASE_PATHS },
  notes: [],
});

export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    id: "saas-web",
    label: "SaaS Web App",
    tagline: "Next.js, dashboard UX, auth, tests",
    description: "관리 화면, 인증, API, 데이터 계층까지 포함하는 일반적인 SaaS 웹앱용 기본 하네스",
    defaults: {
      ...baseHarness("saas-web", "SaaS Web App"),
      stack: {
        appType: "web-app",
        frontend: "Next.js",
        backend: "Route Handlers / FastAPI bridge",
        runtime: "Node.js",
        packageManager: "pnpm",
        database: "PostgreSQL / Supabase",
        auth: "OAuth + email",
      },
      quality: {
        lint: true,
        typecheck: true,
        unitTests: true,
        e2eTests: true,
        partialBuilds: true,
        requireTestsBeforeDone: true,
        allowStubsOutsideScope: true,
      },
      design: designWith({
        theme: "light",
        referenceStyle: "Modern SaaS dashboard (Linear, Vercel feel)",
        palette: {
          primary: "#6366f1",
          accent: "#8b5cf6",
          background: "#ffffff",
          foreground: "#0f172a",
          muted: "#f1f5f9",
          error: "#e11d48",
        },
        radius: "rounded",
        density: "comfortable",
        typography: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" },
      }),
      notes: [
        "Favor modular feature folders and typed contracts.",
        "Keep partial scope runnable with mocks outside the selected graph.",
      ],
    },
  },
  {
    id: "api-service",
    label: "API Service",
    tagline: "Backend-first, typed contracts, DB and tests",
    description: "REST/worker/backend 시스템을 빠르게 시작하기 위한 서버 중심 preset",
    defaults: {
      ...baseHarness("api-service", "API Service"),
      stack: {
        appType: "api-service",
        frontend: "Minimal admin client",
        backend: "FastAPI",
        runtime: "Python",
        packageManager: "uv",
        database: "PostgreSQL",
        auth: "Bearer / OAuth",
      },
      agent: {
        ...baseHarness("api-service", "API Service").agent,
        reasoningEffort: "xhigh",
      },
      design: designWith({
        theme: "dark",
        referenceStyle: "Minimal admin surface / API console",
        palette: {
          primary: "#22d3ee",
          accent: "#34d399",
          background: "#0a0f14",
          foreground: "#e5e7eb",
          muted: "#141a21",
          error: "#f97316",
        },
        radius: "sharp",
        density: "compact",
        typography: { heading: "IBM Plex Sans", body: "IBM Plex Sans", mono: "IBM Plex Mono" },
      }),
      notes: [
        "Generate OpenAPI-friendly contracts when possible.",
        "Implement both PUT and PATCH for mutable resources.",
      ],
    },
  },
  {
    id: "agent-tool",
    label: "Agent Tooling",
    tagline: "MCP, skills, shell, evaluation loop",
    description: "에이전트 런타임, 오케스트레이션 도구, MCP/skills 중심 제품용 preset",
    defaults: {
      ...baseHarness("agent-tool", "Agent Tooling"),
      stack: {
        appType: "agent-tool",
        frontend: "React + Vite",
        backend: "Node/Express",
        runtime: "Node.js",
        packageManager: "pnpm",
        database: "SQLite + file artifacts",
        auth: "Local prototype",
      },
      quality: {
        lint: true,
        typecheck: true,
        unitTests: true,
        e2eTests: false,
        partialBuilds: true,
        requireTestsBeforeDone: true,
        allowStubsOutsideScope: true,
      },
      design: designWith({
        theme: "dark",
        referenceStyle: "VS Code-inspired workbench",
        palette: {
          primary: "#0ea5e9",
          accent: "#a855f7",
          background: "#1e1e1e",
          foreground: "#cccccc",
          muted: "#252526",
          error: "#f14c4c",
        },
        radius: "sharp",
        density: "compact",
        typography: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" },
      }),
      notes: [
        "Expose tool policy explicitly before generation.",
        "Prefer reproducible workspace scaffolds over ad-hoc prompts.",
      ],
    },
  },
  {
    id: "desktop-app",
    label: "Desktop App",
    tagline: "Tauri/Electron, local files, native packaging",
    description: "로컬 파일 접근과 네이티브 packaging이 중요한 데스크톱 앱용 preset",
    defaults: {
      ...baseHarness("desktop-app", "Desktop App"),
      stack: {
        appType: "desktop-app",
        frontend: "React + Vite",
        backend: "Tauri / Electron bridge",
        runtime: "Rust + Node.js",
        packageManager: "pnpm",
        database: "SQLite / local files when persistence is needed",
        auth: "Optional local profile if multi-user separation is needed",
      },
      quality: {
        lint: true,
        typecheck: true,
        unitTests: true,
        e2eTests: true,
        partialBuilds: true,
        requireTestsBeforeDone: true,
        allowStubsOutsideScope: false,
      },
      design: designWith({
        theme: "dark",
        referenceStyle: "Native macOS-inspired shell with vibrancy",
        palette: {
          primary: "#5eead4",
          accent: "#fb923c",
          background: "#111111",
          foreground: "#f4f4f5",
          muted: "#1c1c1e",
          error: "#ef4444",
        },
        radius: "rounded",
        density: "comfortable",
        typography: { heading: "SF Pro Display", body: "SF Pro Text", mono: "SF Mono" },
      }),
      notes: [
        "Treat local filesystem permissions as first-class product behavior.",
        "Prefer native-safe adapters around file access and shell execution.",
        "Use recommendation nodes for optional desktop-only enhancements instead of forcing them into the core flow.",
      ],
    },
  },
  {
    id: "mobile-app",
    label: "Mobile App",
    tagline: "Flutter/React Native, API contracts, device states",
    description: "모바일 화면 흐름과 상태 전이가 핵심인 제품용 preset",
    defaults: {
      ...baseHarness("mobile-app", "Mobile App"),
      stack: {
        appType: "mobile-app",
        frontend: "Flutter",
        backend: "FastAPI / managed backend",
        runtime: "Dart",
        packageManager: "flutter pub",
        database: "SQLite / cloud sync",
        auth: "OAuth + device session",
      },
      quality: {
        lint: true,
        typecheck: true,
        unitTests: true,
        e2eTests: true,
        partialBuilds: true,
        requireTestsBeforeDone: true,
        allowStubsOutsideScope: true,
      },
      design: designWith({
        theme: "light",
        referenceStyle: "iOS-inspired mobile feel with large tap targets",
        palette: {
          primary: "#0a84ff",
          accent: "#ff9f0a",
          background: "#f2f2f7",
          foreground: "#1c1c1e",
          muted: "#e5e5ea",
          error: "#ff3b30",
        },
        radius: "pill",
        density: "comfortable",
        typography: { heading: "SF Pro Display", body: "SF Pro Text", mono: "SF Mono" },
      }),
      notes: [
        "Optimize for screen-state transitions and offline-safe local state.",
      ],
    },
  },
];

export const getHarnessPreset = (presetId: HarnessPresetId) =>
  HARNESS_PRESETS.find((preset) => preset.id === presetId) ?? HARNESS_PRESETS[0];

export const sanitizeHarnessConfig = (config: HarnessConfig): HarnessConfig => ({
  version: 1,
  presetId: config.presetId,
  projectName: config.projectName,
  stack: {
    appType: config.stack.appType,
    frontend: config.stack.frontend,
    backend: config.stack.backend,
    runtime: config.stack.runtime,
    packageManager: config.stack.packageManager,
    database: config.stack.database,
    auth: config.stack.auth,
  },
  agent: {
    reasoningEffort: config.agent.reasoningEffort,
    sandbox: config.agent.sandbox,
    tools: { ...config.agent.tools },
  },
  quality: { ...config.quality },
  design: {
    ...config.design,
    palette: { ...config.design.palette },
    typography: { ...config.design.typography },
  },
  paths: { ...config.paths },
  notes: [...config.notes],
});

export const cloneHarnessConfig = (config: HarnessConfig): HarnessConfig =>
  sanitizeHarnessConfig(JSON.parse(JSON.stringify(config)) as HarnessConfig);

export const createHarnessFromPreset = (
  presetId: HarnessPresetId,
  projectName: string,
): HarnessConfig => {
  const preset = getHarnessPreset(presetId);
  const config = cloneHarnessConfig(preset.defaults);
  config.projectName = projectName || preset.label;
  return config;
};

export const inferHarnessPreset = (files: WorkspaceFile[]): HarnessPresetId => {
  const paths = files.map((file) => file.path.toLowerCase());
  const has = (fragment: string) => paths.some((path) => path.includes(fragment));

  if (has("src-tauri") || has("tauri.conf") || has("electron")) {
    return "desktop-app";
  }
  if (has("pubspec.yaml") || has("android/") || has("ios/")) {
    return "mobile-app";
  }
  if (has("pyproject.toml") || has("fastapi") || has("requirements.txt")) {
    return "api-service";
  }
  if (has(".graphcoding") || has("mcp") || has("agent") || has("codex")) {
    return "agent-tool";
  }
  return "saas-web";
};

export const tryParseHarnessConfig = (text: string): HarnessConfig | null => {
  try {
    const parsed = JSON.parse(text) as HarnessConfig;
    if (parsed && parsed.version === 1 && parsed.projectName && parsed.presetId) {
      if (!parsed.design) {
        parsed.design = { ...DEFAULT_DESIGN, palette: { ...DEFAULT_DESIGN.palette }, typography: { ...DEFAULT_DESIGN.typography } };
      }
      return sanitizeHarnessConfig(parsed);
    }
  } catch {
    return null;
  }

  return null;
};

export const findWorkspaceHarnessFile = (files: WorkspaceFile[]) =>
  files.find((file) => file.path === ".graphcoding/harness.json");

export const buildHarnessArtifacts = (config: HarnessConfig): HarnessArtifact[] => {
  const clean = sanitizeHarnessConfig(config);
  const harnessJson = JSON.stringify(clean, null, 2);
  const designTokens = JSON.stringify(
    {
      theme: config.design.theme,
      referenceStyle: config.design.referenceStyle,
      palette: config.design.palette,
      radius: config.design.radius,
      density: config.design.density,
      typography: config.design.typography,
      notes: config.design.notes,
    },
    null,
    2,
  );
  const buildPolicy = JSON.stringify(
    {
      sandbox: config.agent.sandbox,
      tools: config.agent.tools,
      quality: config.quality,
      paths: config.paths,
    },
    null,
    2,
  );
  const profile = [
    `# ${config.projectName}`,
    "",
    `Preset: ${getHarnessPreset(config.presetId).label}`,
    "",
    "## Stack",
    `- App Type: ${config.stack.appType}`,
    `- Frontend: ${config.stack.frontend}`,
    `- Backend: ${config.stack.backend}`,
    `- Runtime: ${config.stack.runtime}`,
    `- Package Manager: ${config.stack.packageManager}`,
    `- Database: ${config.stack.database}`,
    `- Auth: ${config.stack.auth}`,
    "",
    "## Agent Policy",
    `- Reasoning: ${config.agent.reasoningEffort}`,
    `- Sandbox: ${config.agent.sandbox}`,
    `- MCP: ${config.agent.tools.mcp ? "enabled" : "disabled"}`,
    `- Shell: ${config.agent.tools.shell ? "enabled" : "disabled"}`,
    `- Browser: ${config.agent.tools.browser ? "enabled" : "disabled"}`,
    `- Apply Patch: ${config.agent.tools.applyPatch ? "enabled" : "disabled"}`,
    "",
    "## Quality Gates",
    `- Lint: ${booleanWord(config.quality.lint)}`,
    `- Typecheck: ${booleanWord(config.quality.typecheck)}`,
    `- Unit Tests: ${booleanWord(config.quality.unitTests)}`,
    `- E2E Tests: ${booleanWord(config.quality.e2eTests)}`,
    `- Partial Builds: ${booleanWord(config.quality.partialBuilds)}`,
    `- Tests Required Before Done: ${booleanWord(config.quality.requireTestsBeforeDone)}`,
    `- Stubs Outside Scope Allowed: ${booleanWord(config.quality.allowStubsOutsideScope)}`,
    "",
    "## Design System",
    `- Theme: ${config.design.theme}`,
    `- Reference Style: ${config.design.referenceStyle}`,
    `- Radius: ${config.design.radius}`,
    `- Density: ${config.design.density}`,
    `- Typography: heading=${config.design.typography.heading}, body=${config.design.typography.body}, mono=${config.design.typography.mono}`,
    `- Palette:`,
    `  - primary: ${config.design.palette.primary}`,
    `  - accent: ${config.design.palette.accent}`,
    `  - background: ${config.design.palette.background}`,
    `  - foreground: ${config.design.palette.foreground}`,
    `  - muted: ${config.design.palette.muted}`,
    `  - error: ${config.design.palette.error}`,
    ...(config.design.notes ? ["", `> ${config.design.notes}`] : []),
    "",
    "## Notes",
    ...(config.notes.length > 0 ? config.notes.map((note) => `- ${note}`) : ["- No extra notes yet."]),
  ].join("\n");

  return [
    { path: ".graphcoding/harness.json", content: harnessJson },
    { path: ".graphcoding/project-profile.md", content: profile },
    { path: ".graphcoding/build-policy.json", content: buildPolicy },
    { path: ".graphcoding/design-tokens.json", content: designTokens },
  ];
};

function booleanWord(value: boolean) {
  return value ? "enabled" : "disabled";
}
