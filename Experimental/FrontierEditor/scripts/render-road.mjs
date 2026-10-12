// Frontier Road Editor — software render proof.
//
// There is no GPU in the build sandbox, so the road page is proved out by
// rasterising the same tiles the viewer uploads, with the same camera maths and
// the same material colours, into a plain z-buffered image. Anything that is
// wrong in the geometry — a flipped face, a hole at a junction, a kerb that
// forgot to step — shows up here as a black patch or a missing road, and the
// image is small enough to keep next to the code as evidence.
//
//   node scripts/render-road.mjs [--seed=11] [--blocks=8] [--size=1280x720] [--mode=all]

import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateCity } from '../road/core/city.js';
import { buildNetworkGeometry, validateGroups } from '../road/core/geometry.js';
import { tile } from '../road/app/tiles.js';
import { FreeCamera } from '../road/app/camera.js';
import { MATERIALS } from '../road/core/styles.js';

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? '1'];
}));
const num = (k, d) => (args.has(k) ? Number(args.get(k)) : d);
const SEED = num('seed', 11);
const BLOCKS = num('blocks', 8);
const BLOCK = num('block', 240);
const AMP = num('amp', 1);
const MODE = args.get('mode') ?? 'all';
const GROUPS = (args.get('groups') ?? 'deck,markings,furniture,structures').split(',');
const [W, H] = String(args.get('size') ?? '1280x720').split('x').map(Number);
const OUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'road', 'renders');

const terrain = (x, z) => (Math.sin(x / 520) * 9 + Math.cos(z / 610) * 7 + Math.sin((x + z) / 260) * 3) * AMP;

// ── build (what the worker does, without the worker) ────────────────────────
const report = { seed: SEED, blocks: BLOCKS, blockSize: BLOCK, checks: [], images: [] };
const check = (ok, what, detail = '') => {
  report.checks.push({ ok, what, detail });
  if (!ok) report.failed = true;
  return ok;
};

const t0 = Date.now();
const city = generateCity({ seed: SEED, blocks: BLOCKS, blockSize: BLOCK, terrainAmp: AMP, terrain });
const built = buildNetworkGeometry(city.net);
const buildMs = Date.now() - t0;
const validation = validateGroups(built);
for (const [group, r] of Object.entries(validation)) {
  check(r.failures.length === 0, `${group} mesh validates`, r.failures.join('; '));
}
report.stats = built.stats;
report.buildMs = buildMs;
report.bounds = built.bounds;

// ── tiling, as the viewer consumes it ───────────────────────────────────────
const chunks = [];
for (const [name, geo] of Object.entries(built.groups)) if (geo.indices.length) tile(name, geo, 250, chunks);
const trisByGroup = {};
for (const c of chunks) trisByGroup[c.group] = (trisByGroup[c.group] || 0) + c.tris;
for (const [name, geo] of Object.entries(built.groups)) {
  check((trisByGroup[name] || 0) === geo.indices.length / 3, `tiling keeps every ${name} triangle`,
    `${trisByGroup[name] || 0} of ${geo.indices.length / 3}`);
}
let bad = 0, outside = 0;
for (const c of chunks) {
  for (const v of c.pos) if (!Number.isFinite(v)) bad++;
  for (const v of c.nrm) if (!Number.isFinite(v)) bad++;
  const b = c.bounds;
  for (let i = 0; i < c.pos.length; i += 3) {
    const x = c.pos[i], y = c.pos[i + 1], z = c.pos[i + 2];
    if (x < b[0] - 1e-3 || x > b[3] + 1e-3 || y < b[1] - 1e-3 || y > b[4] + 1e-3 || z < b[2] - 1e-3 || z > b[5] + 1e-3) outside++;
  }
}
check(bad === 0, 'tile buffers are finite', `${bad} non-finite values`);
check(outside === 0, 'tile bounds contain their vertices', `${outside} outside`);
check(chunks.every((c) => c.idx.length % 3 === 0), 'tile indices are whole triangles');
report.tiles = chunks.length;
report.tris = Object.values(trisByGroup).reduce((a, b) => a + b, 0);
check(report.tris === built.stats.tris, 'tiles cover the whole mesh', `${report.tris} of ${built.stats.tris}`);

// ── rasteriser ──────────────────────────────────────────────────────────────
function render(cam, opts = {}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const sky = [0.30, 0.38, 0.50];
  const fog = [0.62, 0.68, 0.76];
  const near = 0.25, far = opts.far ?? 9000;
  const { proj, view } = cam.matrices(W / H, opts.fov ?? 60, near, far);
  const depth = new Float32Array(W * H).fill(Infinity);
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = sky[0] * 255; px[i * 4 + 1] = sky[1] * 255; px[i * 4 + 2] = sky[2] * 255; px[i * 4 + 3] = 255;
  }
  const sun = opts.sun || [0.42, 0.72, -0.55];
  const sl = Math.hypot(sun[0], sun[1], sun[2]);
  const S = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
  // Eye-space transform, then a real near-plane clip: a triangle that straddles
  // the near plane must be clipped, not dropped, or the road immediately in front
  // of the camera disappears and the proof image lies about the geometry.
  const toEye = (p) => [
    p[0] * view[0] + p[1] * view[4] + p[2] * view[8] + view[12],
    p[0] * view[1] + p[1] * view[5] + p[2] * view[9] + view[13],
    p[0] * view[2] + p[1] * view[6] + p[2] * view[10] + view[14],
  ];
  const toScreen = (e) => {
    const cx = e[0] * proj[0];
    const cy = e[1] * proj[5];
    const cz = e[2] * proj[10] + proj[14];
    const cw = -e[2];
    if (cw <= 1e-6) return null;
    return [(cx / cw * 0.5 + 0.5) * W, (0.5 - cy / cw * 0.5) * H, cw, cz];
  };
  const clipNear = (poly) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const aIn = a[2] <= -near, bIn = b[2] <= -near;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (-near - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -near]);
      }
    }
    return out;
  };
  const groups = opts.groups || GROUPS;
  let drawn = 0;
  for (const c of chunks) {
    if (!groups.includes(c.group)) continue;
    const P = c.pos, N = c.nrm, C = c.col, I = c.idx;
    const eye = new Array(P.length / 3);
    let anyIn = false;
    for (let v = 0; v < eye.length; v++) {
      eye[v] = toEye([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      if (eye[v][2] <= -near) anyIn = true;
    }
    if (!anyIn) continue;
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t], ib = I[t + 1], ic = I[t + 2];
      let poly = [eye[ia], eye[ib], eye[ic]];
      if (poly.every((v) => v[2] > -near)) continue;
      poly = clipNear(poly);
      if (poly.length < 3) continue;
      const screen = poly.map(toScreen);
      if (screen.some((s) => !s)) continue;
      const nA = [N[ia * 3], N[ia * 3 + 1], N[ia * 3 + 2]];
      const nB = [N[ib * 3], N[ib * 3 + 1], N[ib * 3 + 2]];
      const nC = [N[ic * 3], N[ic * 3 + 1], N[ic * 3 + 2]];
      const lam = Math.max(0, (nA[0] + nB[0] + nC[0]) / 3 * S[0] + (nA[1] + nB[1] + nC[1]) / 3 * S[1] + (nA[2] + nB[2] + nC[2]) / 3 * S[2]);
      const amb = 0.42 + 0.18 * ((nA[1] + nB[1] + nC[1]) / 3);
      const cr = (C[ia * 4] + C[ib * 4] + C[ic * 4]) / 3;
      const cg = (C[ia * 4 + 1] + C[ib * 4 + 1] + C[ic * 4 + 1]) / 3;
      const cb = (C[ia * 4 + 2] + C[ib * 4 + 2] + C[ic * 4 + 2]) / 3;
      const em = (C[ia * 4 + 3] + C[ib * 4 + 3] + C[ic * 4 + 3]) / 3;
      const shade = amb + lam * 0.9;
      const col = [
        Math.min(1, cr * shade + cr * em) * 255,
        Math.min(1, cg * shade + cg * em) * 255,
        Math.min(1, cb * shade + cb * em) * 255,
      ];
      const fogFar = opts.fogFar ?? 2600;
      const fogNear = opts.fogNear ?? 400;
      drawn++;
      for (let k = 1; k + 1 < screen.length; k++) {
        const a = screen[0], b = screen[k], d = screen[k + 1];
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], d[0])));
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], d[1])));
        if (maxX < minX || maxY < minY) continue;
        if ((maxX - minX) * (maxY - minY) > W * H) continue;
        const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        if (Math.abs(area) < 1e-6) continue;
        const inv = 1 / area;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const pxc = x + 0.5, pyc = y + 0.5;
            const w0 = ((b[0] - pxc) * (d[1] - pyc) - (b[1] - pyc) * (d[0] - pxc)) * inv;
            const w1 = ((d[0] - pxc) * (a[1] - pyc) - (d[1] - pyc) * (a[0] - pxc)) * inv;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * a[2] + w1 * b[2] + w2 * d[2];
            const o = y * W + x;
            if (z >= depth[o]) continue;
            depth[o] = z;
            const f = Math.min(1, Math.max(0, (z - fogNear) / Math.max(1, fogFar - fogNear)));
            const ff = f * f * 0.9;
            px[o * 4] = col[0] * (1 - ff) + fog[0] * 255 * ff;
            px[o * 4 + 1] = col[1] * (1 - ff) + fog[1] * 255 * ff;
            px[o * 4 + 2] = col[2] * (1 - ff) + fog[2] * 255 * ff;
            px[o * 4 + 3] = 255;
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, drawn, covered: countCovered(depth, near, far) };
}

function countCovered(depth, near, far) {
  let n = 0;
  for (let i = 0; i < depth.length; i++) if (depth[i] < far) n++;
  return n / depth.length;
}

// ── cameras ─────────────────────────────────────────────────────────────────
const b = built.bounds;
const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
const size = Math.max(b[3] - b[0], b[5] - b[2]);

const shots = [];
if (MODE === 'all' || MODE === 'aerial') {
  const cam = new FreeCamera({ x: cx - size * 0.35, y: size * 0.75, z: cz - size * 0.75 });
  cam.lookAt([cx, 0, cz]);
  shots.push({ name: 'aerial', cam, opts: { fov: 55, fogNear: 900, fogFar: 4200 } });
}
if (MODE === 'all' || MODE === 'street') {
  // Stand on an arterial and look along it, from the kerb.
  const arterial = city.net.roads.find((r) => r.class === 'arterial' && !r.flags.busCorridor) || city.net.roads[0];
  const sm = arterial.samples;
  const i = Math.floor(sm.count * 0.35);
  const f = { p: sm.pts[i], dir: sm.tangent[i] };
  const cam = new FreeCamera({ x: f.p[0] - f.dir[0] * 6, y: f.p[1] + 1.7, z: f.p[2] - f.dir[1] * 6 });
  cam.yaw = Math.atan2(f.dir[1], f.dir[0]);
  cam.pitch = -0.04;
  shots.push({ name: 'street', cam, opts: { fov: 62, fogNear: 120, fogFar: 900, sun: [0.3, 0.5, -0.8] } });
}
if (MODE === 'all' || MODE === 'junction') {
  // A signalised crossing from above its corner, to show the apron and paint.
  const node = city.net.nodes.find((n) => n.plan?.type === 'signal' && n.plan.armCount >= 3) || city.net.nodes[0];
  const cam = new FreeCamera({ x: node.p[0] - 26, y: node.y + 17, z: node.p[1] - 26 });
  cam.lookAt([node.p[0], node.y, node.p[1]]);
  shots.push({ name: 'junction', cam, opts: { fov: 58, fogNear: 200, fogFar: 1200 } });
}

mkdirSync(OUT, { recursive: true });
for (const shot of shots) {
  const t = Date.now();
  const { canvas, drawn, covered } = render(shot.cam, shot.opts);
  const file = resolve(OUT, `city-seed${SEED}-${shot.name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, canvas.toBuffer('image/png'));
  report.images.push({ name: shot.name, file, drawn, coverage: covered, ms: Date.now() - t });
  console.log(`  rendered ${shot.name}: ${drawn} triangles, ${(covered * 100).toFixed(1)}% of the frame is road, ${Date.now() - t} ms`);
}
check(report.images.every((i) => i.drawn > 500), 'every view draws geometry',
  report.images.map((i) => `${i.name}:${i.drawn}`).join(' '));
// The aerial view must show a road grid (roads cover a city block plan, not the
// whole frame); a view from the kerb must be dominated by the surface it stands on.
const aerial = report.images.find((i) => i.name === 'aerial');
const street = report.images.find((i) => i.name === 'street');
check(!aerial || aerial.coverage > 0.015, 'the aerial view shows the road grid', String(aerial?.coverage));
check(!street || street.coverage > 0.3, 'the street view is mostly carriageway', String(street?.coverage));

const reportFile = resolve(OUT, 'render-report.json');
writeFileSync(reportFile, JSON.stringify(report, null, 1));
console.log(`render proof: ${report.checks.filter((c) => !c.ok).length} failed of ${report.checks.length}`);
for (const c of report.checks) if (!c.ok) console.log(`  ✗ ${c.what}: ${c.detail}`);
console.log(`  ${report.tiles} tiles, ${report.tris} triangles, build ${report.buildMs} ms`);
console.log(`  report ${reportFile}`);
process.exit(report.failed ? 1 : 0);
