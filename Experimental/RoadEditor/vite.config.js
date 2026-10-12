import { defineConfig } from 'vite';

// Standalone page. Relative base keeps it working behind the sandbox preview proxy.
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  build: { chunkSizeWarningLimit: 1500 },
});
