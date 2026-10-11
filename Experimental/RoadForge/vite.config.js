import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '../..');

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    fs: { allow: [workspaceRoot] },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(Id) {
          if (Id.includes('/node_modules/three/')) return 'three-runtime';
          if (Id.includes('/node_modules/react-dom/') || Id.includes('/node_modules/react/')) return 'react-runtime';
          if (Id.includes('/node_modules/lucide-react/')) return 'editor-icons';
          if (Id.includes('/node_modules/earcut/') || Id.includes('/node_modules/polygon-clipping/')) return 'geometry-tools';
        },
      },
    },
  },
});
