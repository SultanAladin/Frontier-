import { defineConfig } from 'vite';

// The AudioWorklet module is bundled as an ES module so that it can import the
// shared DSP core (src/audio/engine-core.js) without any runtime dependency.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  worker: { format: 'es' },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
});
