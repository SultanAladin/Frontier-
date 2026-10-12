#!/usr/bin/env node
/**
 * Headless check for the road editor core.
 *
 *   node Experimental/FrontierEditor/scripts/check-road.mjs [--quick] [--seed N]
 *
 * Runs against the plain core modules (no DOM, no canvas) and reports every
 * invariant the generator promises:
 *
 *   junctions   pavement + corner rings are simple closed loops, trims stay in
 *               a sane band, fillets keep their tangents inside the pocket
 *   ribbons     no NaN, kerbs on both sides, band widths sum to the profile
 *   geometry    validateMesh passes on every emitted mesh, junction pavement
 *               tiles with the ribbon ends without cracks or overlaps
 *   markings    every marking sits on a band it belongs to, bumper to bumper
 *
 * Exit code is non-zero when any check fails, so it can gate a build.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { RoadNetwork, classifyTurn, cornerRadiusFor } from '../road/core/network.js';
import { loopSelfIntersects, polygonArea, loopDistance } from '../road/core/poly.js';
import { validateMesh } from '../road/core/mesh.js';
import { roadFrames, crossPoint } from '../road/core/ribbon.js';
import { buildNetworkGeometry, validateGroups, GROUPS } from '../road/core/geometry.js';
import { ROAD_CLASSES, CROSS_SECTIONS, expandProfile } from '../road/core/styles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../build/road-editor');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const SEED = Number((args.find((a) => a.startsWith('--seed=')) || '--seed=1').split('=')[1]);

const fails = [];
const notes = [];
function check(ok, label, detail) {
  if (!ok) fails.push(detail ? `${label}: ${detail}` : label);
  return ok;
}

const nx = (pts) => pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]));

// ── junctions ───────────────────────────────────────────────────────────────-

function junctionConfigs() {
  const cases = [
    [['arterial', 'street', 'avenue', 'street'], [0, 90, 180, 270]],
    [['motorway', 'street', 'lane'], [0, 100, 210]],
    [['lane', 'lane', 'lane', 'lane'], [0, 100, 190, 280]],
    [['boulevard', 'cycle-way', 'alley', 'farm-track'], [0, 80, 175, 265]],
    [['arterial', 'street'], [0, 92]],
    [['arterial', 'street', 'lane'], [0, 175, 300]],
    [['avenue', 'avenue', 'avenue'], [0, 120, 240]],
    [['motorway', 'motorway', 'street', 'street'], [0, 88, 180, 265]],
    [['boulevard', 'boulevard', 'boulevard', 'boulevard'], [0, 88, 181, 269]],
    [['street', 'street', 'street', 'street', 'street'], [0, 72, 144, 216, 288]],
    [['farm-track', 'alley', 'homezone'], [0, 120, 250]],
    [['cycle-way', 'avenue', 'cycle-way'], [0, 95, 205]],
    [['street', 'street'], [0, 30]],
    [['street', 'street'], [0, 170]],
    [['avenue', 'lane'], [0, 20]],
    [['avenue', 'lane'], [0, 55]],
    [['street', 'street', 'street'], [0, 6, 95]],
    [['street', 'street', 'street'], [0, 45, 90]],
    [['arterial', 'motorway', 'rail', 'street'], [0, 90, 180, 270]],
    [['street', 'street', 'street', 'street'], [0, 3, 180, 183]],
  ];
  return cases;
}

function buildNode(net, classes, angles, radius = 150) {
  const c = net.addNode([0, 0]);
  classes.forEach((k, i) => {
    const a = (angles[i] * Math.PI) / 180;
    const n = net.addNode([Math.cos(a) * radius, Math.sin(a) * radius]);
    net.addRoad(c, n, { class: k });
  });
  net.sampleAll();
  return c;
}

function checkJunctions(report) {
  const net = new RoadNetwork({ seed: SEED, terrainH: () => 0 });
  let corners = 0;
  let cornersBad = 0;
  const rows = [];
  for (const [classes, angles] of junctionConfigs()) {
    const c = net.addNode([0, 0]);
    classes.forEach((k, i) => {
      const a = (angles[i] * Math.PI) / 180;
      const n = net.addNode([Math.cos(a) * 150, Math.sin(a) * 150]);
      net.addRoad(c, n, { class: k });
    });
    net.sampleAll();
    const plan = net.planJunction(c);
    const label = `${classes.join('/')} @ ${angles.join(',')}`;
    check(!nx(plan.pavement), `pavement finite (${label})`);
    check(!nx(plan.trims.map((t, i) => [t, i])), `trims finite (${label})`);
    const pavHit = loopSelfIntersects(plan.pavement);
    // A folded ring is only acceptable when the node reports why: arms within
    // ~14° overlap, and no trim line can pull two overlapping ribbons apart.
    check(!pavHit || plan.overlap.length > 0, `pavement simple (${label})`,
      pavHit ? 'folded with no overlapping pair' : '');
    const area = Math.abs(polygonArea(plan.pavement));
    check(area > 1, `pavement has area (${label})`, `${area.toFixed(1)} m²`);
    const maxHalf = Math.max(...plan.inc.map((e) => e.half));
    const over = plan.trims.filter((t) => t > 8 * maxHalf + 1);
    check(over.length === 0, `trims in band (${label})`, over.map((t) => t.toFixed(1)).join(','));
    const emitted = plan.corners.filter(Boolean);
    corners += emitted.length;
    for (const [i, poly] of plan.corners.entries()) {
      if (!poly) continue;
      check(poly.length >= 3, `corner ${i} has 3+ pts (${label})`);
      const hit = loopSelfIntersects(poly);
      if (hit) cornersBad++;
      check(!hit, `corner ${i} simple (${label})`);
    }
    for (const [i, m] of plan.mouths.entries()) {
      check(m.exposed === true, `mouth ${i} exposed (${label})`);
      check(Math.abs(Math.hypot(m.left[0] - m.right[0], m.left[1] - m.right[1]) - 2 * plan.inc[i].half) < 1e-6,
        `mouth ${i} spans the carriageway (${label})`);
    }
    rows.push({ label, arms: plan.armCount, type: plan.type, trims: plan.trims, corners: emitted.length, fillets: plan.fillets.filter(Boolean).length });
  }
  notes.push(`junction sweep: ${rows.length} nodes, ${corners} corner polygons, ${cornersBad} self-intersecting`);
  report.junctions = rows;

  // Randomised stress: odd angles, mixed classes, dead ends, rail.
  const rand = new RoadNetwork({ seed: SEED + 7, terrainH: () => 0 });
  const classes = Object.keys(ROAD_CLASSES);
  const rng = mulberry(SEED + 11);
  const nodeCount = QUICK ? 12 : 60;
  let stressCorners = 0;
  let stressBad = 0;
  for (let t = 0; t < nodeCount; t++) {
    const c = rand.addNode([t * 400, 0]);
    const arms = 2 + Math.floor(rng() * 4);
    let a = rng() * 360;
    const used = [];
    for (let i = 0; i < arms; i++) {
      const gap = 12 + rng() * 120;
      a += gap;
      used.push(a);
      const r = 120 + rng() * 120;
      const n = rand.addNode([t * 400 + Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r]);
      rand.addRoad(c, n, { class: classes[Math.floor(rng() * classes.length)] });
    }
    rand.sampleAll();
    const plan = rand.planJunction(c);
    const label = `random node ${t} (${used.map((v) => v.toFixed(0)).join(',')})`;
    check(!loopSelfIntersects(plan.pavement) || plan.overlap.length > 0, `pavement simple (${label})`);
    check(!nx(plan.pavement), `pavement finite (${label})`);
    for (const [i, poly] of plan.corners.entries()) {
      if (!poly) continue;
      stressCorners++;
      const hit = loopSelfIntersects(poly);
      if (hit) stressBad++;
      check(!hit, `corner ${i} simple (${label})`);
    }
    const maxHalf = Math.max(...plan.inc.map((e) => e.half));
    check(plan.trims.every((v) => v <= 8 * maxHalf + 1), `trims in band (${label})`,
      plan.trims.map((v) => v.toFixed(1)).join(','));
  }
  notes.push(`random stress: ${nodeCount} nodes, ${stressCorners} corner polygons, ${stressBad} self-intersecting`);
  report.stress = { nodes: nodeCount, corners: stressCorners, bad: stressBad };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── ribbons + junctions as meshes ───────────────────────────────────────────-

function meshReport(built, label, report) {
  const v = validateGroups(built);
  const rows = [];
  for (const g of GROUPS) {
    const r = v[g];
    if (!r) continue;
    check(r.failures.length === 0, `mesh clean (${label} · ${g})`, r.failures.join('; '));
    check(r.nonManifoldEdges === 0, `mesh manifold (${label} · ${g})`, `${r.nonManifoldEdges} non-manifold`);
    check(r.windingMismatches === 0, `mesh winding (${label} · ${g})`, `${r.windingMismatches} wrong-facing`);
    check(r.flippedEdges === 0, `mesh orientation (${label} · ${g})`, `${r.flippedEdges} inconsistent edges`);
    check(r.degenerateTriangles === 0, `mesh has no degenerate faces (${label} · ${g})`, `${r.degenerateTriangles}`);
    rows.push({ group: g, tris: r.triangles, verts: r.vertices, open: r.boundaryEdges });
  }
  report.meshes = report.meshes || [];
  report.meshes.push({ label, rows, stats: built.stats });
  const tris = rows.reduce((a, r) => a + r.tris, 0);
  notes.push(`mesh ${label}: ${tris} tris in ${rows.length} groups`);
  return built;
}

function checkGeometry(report) {
  // Every cross section on its own straight ribbon first: one section at a time
  // keeps a failure attributable.
  for (const id of Object.keys(CROSS_SECTIONS)) {
    const net = new RoadNetwork({ seed: SEED, terrainH: () => 0 });
    const a = net.addNode([0, 0]);
    const b = net.addNode([180, 0]);
    net.addRoad(a, b, { class: id, section: id });
    net.sampleAll();
    const built = buildNetworkGeometry(net, { furniture: false });
    meshReport(built, id, report);
    const profile = expandProfile(id);
    check(profile.carriagewayHalf > 0.5, `profile has a carriageway (${id})`);
  }

  // Every cross section at a junction: this is where bands, kerbs and the apron
  // have to agree.
  const ids = Object.keys(CROSS_SECTIONS);
  for (let k = 0; k < ids.length; k++) {
    const net = new RoadNetwork({ seed: SEED, terrainH: () => 0 });
    const c = net.addNode([0, 0]);
    [0, 90, 210].forEach((ang, i) => {
      const a = (ang * Math.PI) / 180;
      const n = net.addNode([Math.cos(a) * 150, Math.sin(a) * 150]);
      net.addRoad(c, n, { class: ids[(k + i) % ids.length], section: ids[(k + i) % ids.length] });
    });
    net.sampleAll();
    const built = buildNetworkGeometry(net, { detail: true });
    meshReport(built, `junction ${ids[k]}`, report);
  }

  // Bridges, tunnels, rail crossings, signals, roundabouts, crossings.
  const net = new RoadNetwork({ seed: SEED, terrainH: () => 0 });
  const a = net.addNode([0, 0]), b = net.addNode([320, 0]), c = net.addNode([320, 320]), d = net.addNode([0, 320]);
  net.addRoad(a, b, { class: 'motorway', bridge: true, ctrl: [[80, -30], [200, 30]] });
  net.addRoad(b, c, { class: 'arterial', section: 'arterial-2x2' });
  net.addRoad(c, d, { class: 'street', bridge: true });
  net.addRoad(d, a, { class: 'boulevard' });
  net.addRoad(b, d, { class: 'avenue' });
  const railA = net.addNode([-200, 160]), railB = net.addNode([520, 160]);
  net.addRoad(railA, railB, { class: 'rail-line' });
  const round = net.addNode([160, 160], { roundabout: true, roundaboutRadius: 16 });
  net.addRoad(d, round, { class: 'street' });
  net.addRoad(round, b, { class: 'street' });
  net.addNode([0, 0]);
  net.nodes.find((n) => n.p[0] === 320 && n.p[1] === 0).tags = { junction: 'signal', crossings: true };
  net.nodes.find((n) => n.p[0] === 0 && n.p[1] === 320).tags = { junction: 'signal' };
  net.sampleAll();
  const built = buildNetworkGeometry(net);
  meshReport(built, 'feature mix', report);
  check(built.stats.junctions >= 4, 'feature mix has junctions', String(built.stats.junctions));
  report.featureStats = built.stats;
}

/**
 * Watertightness of the deck: walk a line across the corridor at stations along
 * a road and check that every point of it is inside a deck triangle. A hole here
 * is a hole you can see through from a car, so it is a hard gate — the cross
 * sections are solved as one tiling and must stay one tiling through the kerbs,
 * the gutters and the junction splits.
 */
function checkWatertight(report) {
  const STEP = 0.05;
  const worst = { section: null, gap: 0 };
  report.watertight = [];
  for (const id of Object.keys(CROSS_SECTIONS)) {
    const net = new RoadNetwork({ seed: SEED, terrainH: () => 0 });
    const a = net.addNode([0, 0]), b = net.addNode([200, 0]), c = net.addNode([400, 0]);
    net.addRoad(a, b, { class: 'street', section: id });
    net.addRoad(b, c, { class: 'street' }); // node b becomes a junction to clip against
    net.sampleAll();
    for (const n of net.nodes) net.planJunction(n);
    const road = net.roads[0];
    const built = buildNetworkGeometry(net, { furniture: false });
    const geo = built.groups.deck;
    const run = roadFrames(net, road);
    const half = road.profile.corridorHalf;
    const N = Math.round((2 * half) / STEP);
    let holes = 0, worstGap = 0;
    for (let k = 2; k < run.frames.length - 2; k += 7) {
      const f = run.frames[k];
      const covered = new Array(N + 1).fill(false);
      for (let t = 0; t < geo.indices.length; t += 3) {
        const ia = geo.indices[t], ib = geo.indices[t + 1], ic = geo.indices[t + 2];
        const ax = geo.positions[ia * 3], az = geo.positions[ia * 3 + 2];
        if (Math.abs(az - f.p[2]) > half + 1 || Math.abs(ax - f.p[0]) > 4) continue;
        const bx = geo.positions[ib * 3], bz = geo.positions[ib * 3 + 2];
        const cx = geo.positions[ic * 3], cz = geo.positions[ic * 3 + 2];
        const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (Math.abs(area) < 1e-9) continue;
        for (let i = 0; i <= N; i++) {
          if (covered[i]) continue;
          const p = crossPoint(f, -half + (2 * half * i) / N, 0);
          const px = p[0], pz = p[2];
          const w0 = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / area;
          const w1 = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / area;
          if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) covered[i] = true;
        }
      }
      let start = null;
      for (let i = 0; i <= N; i++) {
        if (!covered[i]) { if (start === null) start = i; }
        else if (start !== null) {
          const gap = (i - start) * STEP;
          if (gap > 0.06) { holes++; worstGap = Math.max(worstGap, gap); }
          start = null;
        }
      }
    }
    check(holes === 0, `deck is watertight (${id})`, `${holes} holes, worst ${worstGap.toFixed(3)} m`);
    if (worstGap > worst.gap) { worst.gap = worstGap; worst.section = id; }
    report.watertight.push({ section: id, holes, worstGap });
  }
  notes.push(`watertightness: ${report.watertight.length} sections, worst hole ${worst.gap.toFixed(3)} m${worst.section ? ` (${worst.section})` : ''}`);
}

function checkCity(report) {
  // A city-scale network: a grid with diagonals, mixed classes, no two roads
  // sharing a corner exactly. This is the size the editor is meant to hold.
  const net = new RoadNetwork({ seed: SEED, terrainH: (x, z) => Math.sin(x / 260) * 4 + Math.cos(z / 310) * 3 });
  const step = 200;
  const n = QUICK ? 5 : 9;
  const grid = [];
  for (let i = 0; i < n; i++) {
    grid.push([]);
    for (let j = 0; j < n; j++) {
      const x = i * step + Math.sin(i * 1.7 + j * 0.9) * 14;
      const z = j * step + Math.cos(i * 1.1 + j * 2.3) * 14;
      grid[i].push(net.addNode([x, z]));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i + 1 < n) {
        const cls = j % 3 === 0 ? 'arterial' : j % 3 === 1 ? 'street' : 'avenue';
        net.addRoad(grid[i][j], grid[i + 1][j], { class: cls, parking: j % 3 === 1 ? 'both' : null });
      }
      if (j + 1 < n) {
        const cls = i % 4 === 0 ? 'boulevard' : i % 4 === 2 ? 'lane' : 'street';
        net.addRoad(grid[i][j], grid[i][j + 1], { class: cls });
      }
    }
  }
  // Diagonal arterials and a couple of home-zone lanes, then a rail line.
  for (let i = 0; i + 2 < n; i += 2) net.addRoad(grid[i][i], grid[i + 2][i + 2], { class: 'arterial' });
  net.addRoad(grid[1][n - 1], grid[n - 1][1], { class: 'boulevard' });
  const rail = [net.addNode([-240, step * (n / 2)]), net.addNode([step * n + 240, step * (n / 2)])];
  net.addRoad(rail[0], rail[1], { class: 'rail-line' });
  net.sampleAll();
  const t0 = Date.now();
  const built = buildNetworkGeometry(net);
  const ms = Date.now() - t0;
  meshReport(built, `city ${n}x${n}`, report);
  const tot = net.totals();
  notes.push(`city: ${tot.roads} links, ${tot.nodes} nodes, ${tot.junctions} junctions, ${(tot.length / 1000).toFixed(1)} km, built in ${ms} ms`);
  report.city = { ...tot, ms, tris: built.stats.tris, byGroup: built.stats.byGroup };
  check(tot.length > (QUICK ? 3000 : 12000), 'city is large', `${(tot.length / 1000).toFixed(1)} km`);
  check(ms < 20000, 'city builds in reasonable time', `${ms} ms`);
}

// ── main ────────────────────────────────────────────────────────────────────-

const report = { seed: SEED, quick: QUICK, at: new Date().toISOString() };
checkJunctions(report);
checkWatertight(report);
checkGeometry(report);
checkCity(report);

const lines = [];
lines.push(`road editor check  seed=${SEED}  ${QUICK ? 'quick' : 'full'}`);
lines.push(`failures: ${fails.length}`);
for (const n of notes) lines.push(`  · ${n}`);
if (fails.length) {
  lines.push('');
  for (const f of fails.slice(0, 40)) lines.push(`  ✗ ${f}`);
  if (fails.length > 40) lines.push(`  … ${fails.length - 40} more`);
}
const text = lines.join('\n');
console.log(text);
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'result.txt'), text + '\n');
await writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ...report, fails }, null, 2));
process.exit(fails.length ? 1 : 0);
