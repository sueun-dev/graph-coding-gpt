import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Minimal type for Node's process — avoids needing @types/node just for cwd().
declare const process: { cwd(): string };

// Port 8791 (not 8787) matches server/index.mjs — see comment there for why.
// Use GRAPHCODING_PORT in your shell to override both sides consistently.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "GRAPHCODING_");
  const apiPort = Number(env.GRAPHCODING_PORT) || 8791;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": `http://127.0.0.1:${apiPort}`,
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@xyflow")) return "graph-vendor";
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react-vendor";
            if (id.includes("node_modules/liquid-glass-react")) return "ui-vendor";
            return undefined;
          },
        },
      },
    },
  };
});
