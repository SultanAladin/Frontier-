// Procedural city: a warped arterial grid, local streets in every block, a
// mainline railway with level crossings, two underground subway lines with
// stations, and an elevated motorway ring with slip-road interchanges.
//
// Deterministic for a given seed and options. Buildings are never generated.

import {
  createNetwork, addRoad, addProp, refreshAutoProps, dense, frameAt, degrees,
} from './road-graph.js';
import { createRng } from './rng.js';

export const GENERATOR_DEFAULTS = {
  seed: 1,
  sizeKm: 6,
  blockSize: 480,
  localSpacing: 240,
  warp: 45,
  features: {
    bus: true,
    bike: true,
    parking: true,
    rail: true,
    subway: true,
    motorway: true,
    interchanges: true,
    bumps: true,
    bollards: true,
    tram: true,
    oneway: true,
    deadEnds: true,
  },
};

const GRID_PRESETS = new Set(['boulevard', 'avenue', 'arterial', 'tram-street']);
const STEP = 40; // metres between sampled grid vertices (divides block and local spacing)
const TAU = Math.PI * 2;

export function generateCity(options = {}) {
  const features = { ...GENERATOR_DEFAULTS.features, ...(options.features ?? {}) };
  const o = { ...GENERATOR_DEFAULTS, ...options, features };
  const rng = createRng(o.seed);
  const B = o.blockSize;
  const n = Math.max(2, Math.round((o.sizeKm * 1000) / B));
  const total = n * B;
  const half = total / 2;
  const theta = rng.range(-0.18, 0.18);
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  const k1 = TAU / 1700;
  const k2 = TAU / 1450;
  const p1 = rng.range(0, TAU);
  const p2 = rng.range(0, TAU);
  // Smooth, invertible warp of the grid: keeps lines straight-ish but organic.
  const W = (u, v) => {
    const x = u + o.warp * Math.sin(v * k1 + p1);
    const z = v + o.warp * Math.sin(u * k2 + p2);
    return { x: x * cs - z * sn, z: x * sn + z * cs };
  };
  const P = (u, v, y = 0) => {
    const q = W(u, v);
    return { x: q.x, y, z: q.z };
  };

  const net = createNetwork({
    seed: o.seed,
    meta: { generator: 'city-v1', sizeKm: o.sizeKm, blockSize: B, localSpacing: o.localSpacing, half },
  });
  const stats = { arterials: 0, local: 0, rail: 0, subway: 0, ring: 0, interchanges: 0 };

  const arterialPreset = (index) => {
    if (index === 0 || index === n) return features.bus ? 'boulevard' : 'arterial';
    if (index % 4 === 0) return features.bus ? 'boulevard' : 'arterial';
    if (index % 2 === 0) return features.bike ? 'avenue' : 'arterial';
    return 'arterial';
  };
  const localPreset = () => {
    const r = rng.next();
    if (features.bike && r < 0.07) return 'cycle-street';
    if (features.oneway && r < 0.2) return 'oneway';
    if (!features.parking) return 'local';
    return r < 0.55 ? 'residential' : 'local';
  };

  // 1. Arterial grid. Each line is a single road: junctions appear where they cross.
  const gridSamples = (from, to) => {
    const out = [];
    for (let v = from; v <= to + 1e-6; v += STEP) out.push(v);
    return out;
  };
  const tramIndex = Math.floor(n / 2);
  for (let i = 0; i <= n; i += 1) {
    const u = -half + i * B;
    const preset = features.tram && i === tramIndex ? 'tram-street' : arterialPreset(i);
    const pts = gridSamples(-half, half).map((v) => P(u, v));
    addRoad(net, pts, { preset, name: `Avenue ${i + 1}` });
    stats.arterials += 1;
  }
  for (let j = 0; j <= n; j += 1) {
    const v = -half + j * B;
    const preset = arterialPreset(j + 1);
    const pts = gridSamples(-half, half).map((u) => P(u, v));
    addRoad(net, pts, { preset, name: `Street ${j + 1}` });
    stats.arterials += 1;
  }

  // 2. Local streets, inside every block, with occasional dead ends.
  const spacing = Math.max(STEP, Math.round(o.localSpacing / STEP) * STEP);
  const perBlock = Math.max(1, Math.round(B / spacing) - 1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const u0 = -half + i * B;
      const v0 = -half + j * B;
      for (let k = 1; k <= perBlock; k += 1) {
        for (const axis of ['u', 'v']) {
          if (rng.chance(0.08)) continue;
          const fixed = axis === 'u' ? u0 + k * spacing : v0 + k * spacing;
          const from = axis === 'u' ? v0 : u0;
          const to = from + B;
          const deadEnd = features.deadEnds && rng.chance(0.1);
          const end = deadEnd ? from + B / 2 : to;
          const pts = [];
          for (let t = from; t <= end + 1e-6; t += STEP) {
            pts.push(axis === 'u' ? P(fixed, t) : P(t, fixed));
          }
          if (pts.length < 2) continue;
          const preset = localPreset();
          addRoad(net, pts, { preset, name: `Lane ${stats.local + 1}` });
          stats.local += 1;
        }
      }
    }
  }

  // 3. Mainline railway crossing the city diagonally (level crossings auto-placed).
  if (features.rail) {
    const pts = [];
    for (let u = -half - 120; u <= half + 120 + 1e-6; u += STEP) {
      pts.push(P(u, -0.22 * half * Math.sin(u / half * 1.1 + 0.4), 0));
    }
    addRoad(net, pts, { preset: 'rail-mainline', name: 'Mainline' });
    stats.rail += 1;
  }

  // 4. Underground subway lines. They dive from portals outside the map.
  if (features.subway) {
    const ramp = (dist) => Math.min(1, dist / 100);
    const subA = [];
    for (let u = -half - 100; u <= half + 100 + 1e-6; u += STEP) {
      const depth = -9 * Math.min(ramp(u + half + 100), ramp(half + 100 - u));
      subA.push(P(u, -0.5 * half, depth));
    }
    const subB = [];
    for (let v = -half - 100; v <= half + 100 + 1e-6; v += STEP) {
      const depth = -14 * Math.min(ramp(v + half + 100), ramp(half + 100 - v));
      subB.push(P(0.42 * half, v, depth));
    }
    for (const [pts, name] of [[subA, 'Subway A'], [subB, 'Subway B']]) {
      const ids = addRoad(net, pts, { preset: 'subway', name });
      stats.subway += 1;
      const edges = ids.map((id) => net.edges[id]).filter(Boolean);
      edges.sort((a, b) => dense(net, b).L - dense(net, a).L);
      const main = edges[0];
      if (!main) continue;
      const L = dense(net, main).L;
      for (const frac of [0.3, 0.62]) {
        addProp(net, { type: 'station', edge: main.id, s: L * frac });
      }
    }
  }

  // 5. Elevated motorway ring at 6 m with flyover piers. Interchanges with the grid.
  let ringId = null;
  if (features.motorway) {
    const R = 0.42 * half;
    const ring = [];
    for (let a = 0; a < TAU - 1e-6; a += TAU / 72) ring.push({ x: R * Math.cos(a), y: 6, z: R * Math.sin(a) });
    const ids = addRoad(net, ring, { preset: 'motorway', name: 'Ring motorway', closed: true });
    ringId = ids[0] ?? null;
    stats.ring += 1;
  }
  if (ringId && features.interchanges && features.motorway) {
    const R = 0.42 * half;
    const picks = [];
    const crossings = [];
    const grid = Object.values(net.edges).filter((e) => GRID_PRESETS.has(e.preset));
    for (const e of grid) {
      const eid = e.id;
      const D = dense(net, e);
      for (let i = 0; i < D.x.length - 1; i += 1) {
        const r0 = Math.hypot(D.x[i], D.z[i]) - R;
        const r1 = Math.hypot(D.x[i + 1], D.z[i + 1]) - R;
        if (Math.sign(r0) === Math.sign(r1) || r0 === r1) continue;
        const u = r0 / (r0 - r1);
        const s = D.s[i] + (D.s[i + 1] - D.s[i]) * u;
        const x = D.x[i] + (D.x[i + 1] - D.x[i]) * u;
        const z = D.z[i] + (D.z[i + 1] - D.z[i]) * u;
        crossings.push({ eid, s, x, z, angle: Math.atan2(z, x), L: D.L });
      }
    }
    for (const target of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      let best = null;
      for (const c of crossings) {
        let d = Math.abs(c.angle - target);
        d = Math.min(d, TAU - d);
        if (!best || d < best.d) best = { ...c, d };
      }
      if (best && best.d < 0.5) picks.push(best);
    }
    for (const c of picks) {
      const e = net.edges[c.eid];
      if (!e) continue;
      const D = dense(net, e);
      const sA = c.s + 60 <= D.L - 20 ? c.s + 60 : c.s - 60;
      if (sA < 20 || sA > D.L - 20) continue;
      const fa = frameAt(D, sA);
      const A = { x: fa.x, y: 0, z: fa.z };
      const dAng = 0.12;
      const Q = { x: R * Math.cos(c.angle + dAng), y: 6, z: R * Math.sin(c.angle + dAng) };
      const mx = (Q.x + A.x) / 2;
      const mz = (Q.z + A.z) / 2;
      const outward = Math.hypot(mx, mz) || 1;
      const M = { x: mx + (mx / outward) * 14, y: 3, z: mz + (mz / outward) * 14 };
      const ids = addRoad(net, [Q, M, A], { preset: 'slip-road', name: 'Slip road' });
      if (ids.length) stats.interchanges += 1;
    }
  }

  // 6. Street furniture: speed bumps on local streets, bollards on cycle streets.
  for (const e of Object.values(net.edges)) {
    const L = dense(net, e).L;
    if (e.preset === 'residential' || e.preset === 'local' || e.preset === 'oneway') {
      if (features.bumps && L > 110 && rng.chance(0.3)) addProp(net, { type: 'speedbump', edge: e.id, s: L / 2 });
    }
    if (e.preset === 'cycle-street' && features.bollards) {
      for (const lat of [6.5, -6.5]) {
        addProp(net, { type: 'bollard', edge: e.id, s: 0, len: L, lat, spacing: 1.5 });
      }
    }
  }

  refreshAutoProps(net);
  net.meta.stats = { ...stats, junctions: countJunctions(net), edges: Object.keys(net.edges).length };
  return net;
}

export function countJunctions(net) {
  let count = 0;
  for (const d of degrees(net).values()) if (d >= 3) count += 1;
  return count;
}
