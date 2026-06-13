import { defineConfig } from "vitest/config";

// Test runner config kept separate from vite.config.ts so the production build
// stays free of test-only globals/jsdom. The lib modules under test are pure
// (diagram graph math, harness presets, workspace tree building) but a few
// touch browser globals (crypto.randomUUID, File, Blob, document), so we run in
// jsdom. All external I/O (fetch, FileSystem Access API, native bridge) is
// mocked per-test — no test hits the network or disk.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
