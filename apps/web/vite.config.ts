import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const inCodespaces = process.env.CODESPACES === "true";
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          data: ["@tanstack/react-query", "zustand", "zod", "react-hook-form", "@hookform/resolvers"],
        },
      },
    },
  },
  server: {
    port: 5173,
    // GitHub Codespaces serves the dev server on *.app.github.dev over HTTPS (port 443).
    allowedHosts: [".app.github.dev", ".github.dev"],
    ...(inCodespaces ? { host: true, hmr: { clientPort: 443 } } : {}),
    proxy: {
      // xfwd passes the browser's IP to the API so its per-IP rate limits apply per visitor.
      "/api": { target: apiTarget, changeOrigin: true, xfwd: true },
      "/uploads": { target: apiTarget, changeOrigin: true, xfwd: true },
      // Live updates (Socket.IO over WebSocket).
      "/socket.io": { target: apiTarget, ws: true, changeOrigin: true, xfwd: true },
    },
  },
});
