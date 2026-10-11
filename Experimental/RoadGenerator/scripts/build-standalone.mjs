// Build standalone self-contained RoadGenerator.html from modular sources in Experimental/RoadGenerator/src/
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '../src');
const repoRoot = resolve(__dirname, '../../..');

const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');

const moduleOrder = [
  'math-splines.js',
  'quad-topology.js',
  'infrastructure-builders.js',
  'texture-layer-stack.js',
  'traffic-simulation.js',
  'presets-network.js',
  'webgpu-renderer.js',
  'app.js',
];

let combinedJs = `'use strict';\n`;
for (const file of moduleOrder) {
  let code = readFileSync(resolve(srcDir, file), 'utf8');
  // Strip ES module import blocks (including multi-line imports) and export keywords
  code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
  code = code.replace(/export\s+(const|let|var|function|class|async\s+function)/g, '$1');
  combinedJs += `\n// === Module: ${file} ===\n${code}\n`;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Frontier · WebGPU Road Generator Studio</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
${combinedJs}
  </script>
</body>
</html>
`;

writeFileSync(resolve(repoRoot, 'RoadGenerator.html'), html, 'utf8');
writeFileSync(resolve(__dirname, '../index.html'), html, 'utf8');
writeFileSync(resolve(repoRoot, 'Experimental/FrontierEditor/road-generator.html'), html, 'utf8');

console.log('Built standalone RoadGenerator.html:', (html.length / 1024).toFixed(1), 'KB');
