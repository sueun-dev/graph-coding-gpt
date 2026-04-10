import type { HarnessArtifact, HarnessConfig, HarnessPreset, HarnessPresetId, WorkspaceFile } from "./types";

const BASE_PATHS = {
  configDir: ".graphcoding",
  artifactDir: "generated",
  testsDir: "tests",
} as const;

const baseHarness = (presetId: HarnessPresetId, label: string, goal: string): HarnessConfig => ({
  version: 1,
  presetId,
  projectName: label,
  projectGoal: goal,
  stack: {
    appType: "",
    frontend: "",
    backend: "",
    runtime: "",
    packageManager: "pnpm",
    styling: "",
    database: "",
    auth: "",
  },
  agent: {
    primaryModel: "gpt-5.4",
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
      ...baseHarness("saas-web", "SaaS Web App", "Build a production-ready web application from the diagram."),
      stack: {
        appType: "web-app",
        frontend: "Next.js",
        backend: "Route Handlers / FastAPI bridge",
        runtime: "Node.js",
        packageManager: "pnpm",
        styling: "Tailwind + shadcn",
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
      ...baseHarness("api-service", "API Service", "Build a backend/API service from the diagram."),
      stack: {
        appType: "api-service",
        frontend: "Minimal admin client",
        backend: "FastAPI",
        runtime: "Python",
        packageManager: "uv",
        styling: "Minimal",
        database: "PostgreSQL",
        auth: "Bearer / OAuth",
      },
      agent: {
        ...baseHarness("api-service", "API Service", "").agent,
        reasoningEffort: "xhigh",
      },
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
      ...baseHarness("agent-tool", "Agent Tooling", "Build an agent product or internal AI tool from the diagram."),
      stack: {
        appType: "agent-tool",
        frontend: "React + Vite",
        backend: "Node/Express",
        runtime: "Node.js",
        packageManager: "pnpm",
        styling: "VS Code-style dark UI",
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
      ...baseHarness("desktop-app", "Desktop App", "Build a desktop application from the diagram."),
      stack: {
        appType: "desktop-app",
        frontend: "React + Vite",
        backend: "Tauri / Electron bridge",
        runtime: "Rust + Node.js",
        packageManager: "pnpm",
        styling: "Native dark shell",
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
      ...baseHarness("mobile-app", "Mobile App", "Build a mobile application from the diagram."),
      stack: {
        appType: "mobile-app",
        frontend: "Flutter",
        backend: "FastAPI / managed backend",
        runtime: "Dart",
        packageManager: "flutter pub",
        styling: "Native mobile design system",
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
      notes: [
        "Optimize for screen-state transitions and offline-safe local state.",
      ],
    },
  },
];

export const getHarnessPreset = (presetId: HarnessPresetId) =>
  HARNESS_PRESETS.find((preset) => preset.id === presetId) ?? HARNESS_PRESETS[0];

export const cloneHarnessConfig = (config: HarnessConfig): HarnessConfig =>
  JSON.parse(JSON.stringify(config)) as HarnessConfig;

export const createHarnessFromPreset = (
  presetId: HarnessPresetId,
  projectName: string,
  inferredGoal?: string,
): HarnessConfig => {
  const preset = getHarnessPreset(presetId);
  const config = cloneHarnessConfig(preset.defaults);
  config.projectName = projectName || preset.label;
  if (inferredGoal) {
    config.projectGoal = inferredGoal;
  }
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
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
};

export const findWorkspaceHarnessFile = (files: WorkspaceFile[]) =>
  files.find((file) => file.path === ".graphcoding/harness.json");

export const buildHarnessArtifacts = (config: HarnessConfig): HarnessArtifact[] => {
  const harnessJson = JSON.stringify(config, null, 2);
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
    "## Goal",
    config.projectGoal,
    "",
    "## Stack",
    `- App Type: ${config.stack.appType}`,
    `- Frontend: ${config.stack.frontend}`,
    `- Backend: ${config.stack.backend}`,
    `- Runtime: ${config.stack.runtime}`,
    `- Package Manager: ${config.stack.packageManager}`,
    `- Styling: ${config.stack.styling}`,
    `- Database: ${config.stack.database}`,
    `- Auth: ${config.stack.auth}`,
    "",
    "## Agent Policy",
    `- Model: ${config.agent.primaryModel}`,
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
    "## Notes",
    ...(config.notes.length > 0 ? config.notes.map((note) => `- ${note}`) : ["- No extra notes yet."]),
  ].join("\n");

  return [
    { path: ".graphcoding/harness.json", content: harnessJson },
    { path: ".graphcoding/project-profile.md", content: profile },
    { path: ".graphcoding/build-policy.json", content: buildPolicy },
  ];
};

function booleanWord(value: boolean) {
  return value ? "enabled" : "disabled";
}
