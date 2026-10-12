// Folds dist/standalone/{bundle.js,bundle.css} into a single HTML document so the
// editor can be served from anywhere (raw.githack, a subfolder, or file://) with no
// bare module specifiers, no MIME sniffing and no relative asset paths to get wrong.
//
// Run with: node scripts/inline-build.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = resolve(new URL('.', import.meta.url).pathname, '..');
const buildDir = join(here, 'dist', 'standalone');
const outFile = join(here, 'standalone.html');

if (!existsSync(buildDir)) {
  console.error(`No build found at ${buildDir}. Run "vite build --config vite.standalone.config.js" first.`);
  process.exit(1);
}

const files = readdirSync(buildDir);
const js = files
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(buildDir, name), 'utf8'))
  .join('\n;\n');
const css = files
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(join(buildDir, name), 'utf8'))
  .join('\n');

if (!js) {
  console.error('The standalone build produced no JavaScript.');
  process.exit(1);
}

let html = readFileSync(join(buildDir, 'index.html'), 'utf8');

// A literal closing tag inside a string would end the element early.
const safeScript = js.replace(/<\/script/gi, '<\\/script');
const safeStyle = css.replace(/<\/style/gi, '<\\/style');

html = html
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, css ? () => `<style>\n${safeStyle}\n</style>` : '')
  .replace(/<script[^>]*src="[^"]+\.js"[^>]*>\s*<\/script>/gi, () => `<script>\n${safeScript}\n</script>`);

if (!html.includes('<script>')) {
  console.error('Could not inline the bundle into index.html — did the build output change?');
  process.exit(1);
}

writeFileSync(outFile, html);

const kb = (statSync(outFile).size / 1024).toFixed(0);
console.log(`standalone.html written — ${kb} kB, self-contained (${(js.length / 1024).toFixed(0)} kB of JS inlined).`);
