import { defineConfig } from 'vite';

// Dev server is reachable from the sandbox preview host (*.e2b.app) as well as localhost.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5180,
    allowedHosts: ['.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    port: 5180,
    allowedHosts: ['.e2b.app'],
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
