import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// One-file build for plain static hosting (raw.githack, file://, any subfolder).
// Outputs a classic IIFE script with no code splitting; scripts/inline-build.mjs
// then folds the bundle and the stylesheet into a single HTML document.
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/standalone',
    emptyOutDir: true,
    target: 'es2019',
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'bundle.js',
        assetFileNames: 'bundle.[ext]',
      },
    },
  },
});
