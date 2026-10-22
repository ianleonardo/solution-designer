import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Settings come from the project's root .env (shared with the backend); real environment variables win.
const rootDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * FRONTEND_ALLOWED_HOSTS: host names the dev server answers to, comma-separated, e.g. "lxsplatsgv098,lxsplatsgv098.corp.local".
 * A leading dot allows every subdomain (".corp.local"); "*" allows any host. localhost and IP addresses always work.
 */
function allowedHosts(raw: string | undefined): string[] | true | undefined {
  const hosts = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (hosts.includes("*")) return true;
  return hosts.length ? hosts : undefined;
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, rootDir, ""), ...process.env };
  const hosts = allowedHosts(env.FRONTEND_ALLOWED_HOSTS);
  return {
    plugins: [react()],
    // Bundle Mermaid with the app. Its diagram chunks live in the workspace node_modules,
    // outside this folder, and serving them as separate files left the dev server on a
    // stale copy after an upgrade ("Failed to fetch dynamically imported module").
    optimizeDeps: {
      include: ["mermaid"],
    },
    server: {
      // 0.0.0.0 accepts 127.0.0.1 (what the browser uses for localhost) and the LAN address.
      host: "0.0.0.0",
      port: Number(env.FRONTEND_PORT) || 7777,
      allowedHosts: hosts,
      fs: {
        allow: [rootDir],
      },
      proxy: {
        "/api": env.BACKEND_URL || "http://127.0.0.1:8000",
      },
    },
    preview: {
      allowedHosts: hosts,
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test-setup.ts",
    },
  };
});
