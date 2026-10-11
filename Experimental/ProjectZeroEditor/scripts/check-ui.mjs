// Bundles scripts/ui-smoke.jsx with esbuild (react-dom/server, no DOM) and runs it.
// Run with: node scripts/check-ui.mjs

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outfile = resolve(root, 'node_modules/.cache/projectzero/ui-smoke.mjs');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'scripts/ui-smoke.jsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  logLevel: 'warning',
  mainFields: ['module', 'main'],
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

process.env.UI_DUMP_DIR = resolve(root, 'node_modules/.cache/projectzero/dump');

await import(pathToFileURL(outfile).href);
