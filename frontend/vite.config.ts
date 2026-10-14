import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The minified build bundles its own dependencies, so the dev server serves each
      // diagram chunk directly instead of re-optimizing them mid-session (which caused
      // "Failed to fetch dynamically imported module" errors).
      mermaid: "mermaid/dist/mermaid.esm.min.mjs",
    },
  },
  optimizeDeps: {
    exclude: ["mermaid"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
