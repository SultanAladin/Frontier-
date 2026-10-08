import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    proxy: { '/api/construct': 'http://127.0.0.1:5191' }
  }
});
