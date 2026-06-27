import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The client lives in /client and builds to /client/dist, which the Express
// server serves as static assets. During dev, /api is proxied to the server.
export default defineConfig({
  root: resolve(__dirname, "client"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "client/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/pdf": "http://localhost:8080",
    },
  },
});
