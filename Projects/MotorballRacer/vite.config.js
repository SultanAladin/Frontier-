import { defineConfig } from "vite";

// NOTE: deliberately NOT 5173 (vite default), 800, or 8080 — per project request.
const RACER_PORT = 6931;

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: RACER_PORT,
    strictPort: true,
    cors: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: RACER_PORT,
    strictPort: true,
    cors: true,
    allowedHosts: true,
  },
});
