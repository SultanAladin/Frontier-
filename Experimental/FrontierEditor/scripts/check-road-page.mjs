// Frontier Road Editor — page gate.
//
// The road page is a worker plus a viewer plus a DOM. There is no browser in the
// build sandbox, so each of those is checked the way it can be: the worker is
// run for real against a fake `self` (which proves generation, meshing, tiling
// and the transferable list all work off the main thread), the viewer's shaders
// and the page's element ids are checked against the ship files, and every module
// the page imports is imported here so a typo cannot reach a browser first.
//
//   node scripts/check-road-page.mjs [--blocks=4]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? '1'];
}));
const BLOCKS = Number(args.get('blocks') ?? 4);

const checks = [];
const check = (ok, what, detail = '') => {
  checks.push({ ok, what, detail });
  return ok;
};

// ── the worker, for real ────────────────────────────────────────────────────
const messages = [];
let onmessage = null;
globalThis.self = {
  postMessage: (m, transfer) => messages.push({ m, transfer }),
  set onmessage(fn) { onmessage = fn; },
  get onmessage() { return onmessage; },
};
await import('../road/app/worker.js');
check(typeof onmessage === 'function', 'worker registers a message handler');
onmessage({ data: { cmd: 'build', opts: { seed: 7, blocks: BLOCKS, blockSize: 240, chunk: 250 } } });

const done = messages.find((x) => x.m.type === 'done');
const err = messages.find((x) => x.m.type === 'error');
check(!err, 'worker build does not throw', err?.m.message?.slice(0, 400) ?? '');
check(!!done, 'worker posts a result');
if (done) {
  const p = done.m;
  check(messages.some((x) => x.m.type === 'progress'), 'worker reports progress');
  check(p.chunks.length > 0, 'worker produces tiles', String(p.chunks.length));
  check(p.stats.tris > 1000, 'worker meshes a city', `${p.stats.tris} tris`);
  const failures = Object.entries(p.validation).filter(([, v]) => v.failures.length);
  check(failures.length === 0, 'every group validates in the worker',
    failures.map(([g, v]) => `${g}: ${v.failures.join('; ')}`).join(' | '));
  let nonFinite = 0, badIndex = 0, tris = 0;
  for (const c of p.chunks) {
    for (const v of c.pos) if (!Number.isFinite(v)) nonFinite++;
    for (const v of c.nrm) if (!Number.isFinite(v)) nonFinite++;
    for (const v of c.col) if (!Number.isFinite(v)) nonFinite++;
    const verts = c.pos.length / 3;
    for (const i of c.idx) if (i >= verts) badIndex++;
    tris += c.idx.length / 3;
  }
  check(nonFinite === 0, 'tile attributes are finite', String(nonFinite));
  check(badIndex === 0, 'tile indices are in range', String(badIndex));
  check(tris === p.stats.tris, 'tiles carry every triangle', `${tris} of ${p.stats.tris}`);
  check(p.bounds.length === 6 && p.bounds.every(Number.isFinite), 'bounds are finite', JSON.stringify(p.bounds));
  const transfer = done.transfer || [];
  check(transfer.length === p.chunks.length * 4, 'every tile buffer is transferred, not copied',
    `${transfer.length} of ${p.chunks.length * 4}`);
  check(new Set(transfer).size === transfer.length, 'no buffer is transferred twice');
  const byGroup = {};
  for (const c of p.chunks) byGroup[c.group] = (byGroup[c.group] || 0) + c.tris;
  check(Object.keys(byGroup).length >= 3, 'the city has road, paint and furniture layers', JSON.stringify(byGroup));
  check(p.describe.lengthKm > BLOCKS * 1.5, 'the city is large', `${p.describe.lengthKm.toFixed(0)} km`);
  check(p.describe.junctionTypes.signal > 0, 'the city has signal junctions');
  check(p.describe.junctionTypes.roundabout > 0, 'the city has roundabouts');
  check(p.minimap.length > 100, 'the minimap has centrelines', String(p.minimap.length));
  console.log(`  worker built ${p.describe.lengthKm.toFixed(0)} km of road: ${p.stats.tris} triangles in ${p.chunks.length} tiles`);
  console.log(`  classes ${JSON.stringify(p.describe.byClass)}`);
  console.log(`  junctions ${JSON.stringify(p.describe.junctionTypes)}`);
}

// ── the page ────────────────────────────────────────────────────────────────
const html = readFileSync(resolve(root, 'road.html'), 'utf8');
for (const file of ['main.js', 'viewer.js', 'worker.js', 'camera.js', 'tiles.js']) {
  const src = readFileSync(resolve(root, 'road', 'app', file), 'utf8');
  const ids = [...src.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id="${id}"`).test(html) && !/^(minimap|view)$/.test(id));
  check(missing.length === 0, `${file} only touches ids the page has`, missing.join(', '));
}
check(/<script type="module" src="\.\/road\/app\/main\.js"><\/script>/.test(html), 'page loads the app module');
check(/road\.html/.test(readFileSync(resolve(root, 'vite.config.js'), 'utf8')), 'road.html is a build entry');

// Every module the page can load, imported here: a syntax or export error should
// fail the build, not a browser.
const modules = ['city', 'geometry', 'network', 'detail', 'ribbon', 'mesh', 'poly', 'styles', 'math'];
const exportsSeen = {};
for (const name of modules) {
  const mod = await import(`../road/core/${name}.js`);
  exportsSeen[name] = Object.keys(mod).length;
  check(Object.keys(mod).length > 0, `road/core/${name}.js exports something`);
}
const appModules = ['camera', 'tiles'];
for (const name of appModules) {
  const mod = await import(`../road/app/${name}.js`);
  exportsSeen[name] = Object.keys(mod).length;
  check(Object.keys(mod).length > 0, `road/app/${name}.js exports something`);
}
const viewer = readFileSync(resolve(root, 'road', 'app', 'viewer.js'), 'utf8');
check(/#version 300 es/.test(viewer), 'viewer ships GLSL ES 3.0 shaders');
const camera = await import('../road/app/camera.js');
const cam = new camera.FreeCamera({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
const { proj } = cam.matrices(1.78, 60, 0.25, 9000);
const view = cam.matrices(1.78, 60, 0.25, 9000).view;
const project = (p) => {
  const x = p[0] * view[0] + p[1] * view[4] + p[2] * view[8] + view[12];
  const y = p[0] * view[1] + p[1] * view[5] + p[2] * view[9] + view[13];
  const w = p[0] * view[3] + p[1] * view[7] + p[2] * view[11] + view[15];
  return [x * proj[0] / w, y * proj[5] / w];
};
const ahead = project([10, 5, 0]);
const right = project([10, 0, 5]);
check(ahead[1] > 0.5 && Math.abs(ahead[0]) < 1e-6, 'camera: +Y projects to screen up', JSON.stringify(ahead));
check(right[0] > 0.2, 'camera: +Z is to the right of a +X heading', JSON.stringify(right));
const framed = new camera.FreeCamera({});
framed.frame([0, 0, 0, 1000, 0, 1000]);
check(framed.pos[1] > 100, 'camera frames a city from above', String(framed.pos[1]));

// ── report ──────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
for (const c of failed) console.log(`  ✗ ${c.what}${c.detail ? `: ${c.detail}` : ''}`);
console.log(`road page check: ${failed.length} failed of ${checks.length}`);
process.exit(failed.length ? 1 : 0);
