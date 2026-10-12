// Frontier Road Editor — city generator.
//
// Builds a road network from a seed: a jittered grid whose lines change class
// with their part in the plan (a motorway ring, arterial grid, residential
// streets, service mews), with the things that make a city read as one —
// roundabouts where the arterials meet the ring, signals at the busy crossings,
// bus corridors and cycle routes on the roads that carry them, parking on the
// avenues, a rail line with a level crossing and a station, a home zone quarter
// with shared surfaces and speed tables, a plaza with no kerbs.
//
// Buildings are deliberately absent: this is the road layer, and the whole point
// of the generator is to hand the mesher a network big enough to be interesting.

import { RoadNetwork } from './network.js';
import { ROAD_CLASSES } from './styles.js';
import { makeRng } from './math.js';

const QUARTERS = ['residential', 'homezone', 'mews', 'market'];

/**
 * Generate a city. Returns `{ net, meta, plan }` where `plan` is the intended
 * layout (before jitter) so the UI can describe what it built.
 */
export function generateCity(opts = {}) {
  const o = {
    seed: 11,
    blocks: opts.blocks ?? 10,
    blockSize: opts.blockSize ?? 240,
    jitter: opts.jitter ?? 16,
    ring: opts.ring ?? true,
    diagonals: opts.diagonals ?? 2,
    rail: opts.rail ?? true,
    square: opts.square ?? true,
    ringClass: opts.ringClass ?? 'expressway',
    arterialEvery: opts.arterialEvery ?? 3,
    terrain: opts.terrain ?? ((x, z) => Math.sin(x / 520) * 9 + Math.cos(z / 610) * 7 + Math.sin((x + z) / 260) * 3),
    terrainAmp: opts.terrainAmp ?? 1,
    driveSide: opts.driveSide ?? 'left',
    ...opts,
  };
  const rng = makeRng(o.seed);
  const n = Math.max(3, Math.round(o.blocks));
  const step = o.blockSize;
  const net = new RoadNetwork({
    seed: o.seed,
    driveSide: o.driveSide,
    terrainH: (x, z) => o.terrain(x, z) * o.terrainAmp,
  });

  // ── grid ───────────────────────────────────────────────────────────────────
  const grid = [];
  const jit = (v) => v + (rng() * 2 - 1) * o.jitter;
  for (let i = 0; i < n; i++) {
    grid.push([]);
    for (let j = 0; j < n; j++) {
      const x = jit(i * step);
      const z = jit(j * step);
      const major = i % o.arterialEvery === 0 || j % o.arterialEvery === 0;
      const tags = {};
      if (i % o.arterialEvery === 0 && j % o.arterialEvery === 0) {
        tags.junction = 'signal';
        tags.crossings = true;
      }
      const node = net.addNode([x, z], tags);
      node.quarter = i % o.arterialEvery === 0 || j % o.arterialEvery === 0 ? 'grid' : QUARTERS[Math.floor(rng() * QUARTERS.length)];
      node.major = major;
      grid[i].push(node);
    }
  }

  const linkOpts = (cls, extra = {}) => ({ class: cls, ...extra });

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = grid[i][j];
      if (i + 1 < n) {
        const b = grid[i + 1][j];
        const arterial = i % o.arterialEvery === 0 || j % o.arterialEvery === 0;
        if (arterial) {
          net.addRoad(a, b, linkOpts('arterial', {
            busCorridor: j % (o.arterialEvery * 2) === 0,
            crossing: true,
          }));
        } else {
          net.addRoad(a, b, linkOpts(a.quarter === 'homezone' ? 'homezone' : 'street', {
            parking: a.quarter === 'residential' ? 'both' : null,
          }));
        }
      }
      if (j + 1 < n) {
        const b = grid[i][j + 1];
        const arterial = i % o.arterialEvery === 0 || j % o.arterialEvery === 0;
        if (arterial) {
          net.addRoad(a, b, linkOpts('arterial', { cycleRoute: i % (o.arterialEvery * 2) === 0 }));
        } else if (a.quarter === 'mews') {
          net.addRoad(a, b, linkOpts('alley', { service: true }));
        } else if (a.quarter === 'homezone') {
          net.addRoad(a, b, linkOpts('homezone', { speedTable: true }));
        } else {
          net.addRoad(a, b, linkOpts('street', { parking: a.quarter === 'market' ? 'left' : null }));
        }
      }
    }
  }

  // ── ring road ─────────────────────────────────────────────────────────────
  // One block outside the grid, with roundabouts at the corners and link roads
  // tying it back to the arterials. This is what makes the middle of the map
  // read as "inside the ring" rather than as "the grid".
  const meta = { ring: [], roundabouts: [], diagonals: [], rail: null, square: null };
  if (o.ring) {
    const m = n + 1;
    const ring = [];
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const corner = [
        [-1, -1], [n, -1], [n, n], [-1, n],
      ][k];
      const node = net.addNode(
        [corner[0] * step + jit(0) * 0.5, corner[1] * step + jit(0) * 0.5],
        { junction: 'roundabout', roundaboutRadius: 20, ring: true, t },
      );
      ring.push(node);
      meta.roundabouts.push(node.id);
    }
    for (let k = 0; k < 4; k++) {
      const a = ring[k], b = ring[(k + 1) % 4];
      const ctrl = [];
      for (let t = 1; t < m; t++) {
        const u = t / m;
        const x = a.p[0] + (b.p[0] - a.p[0]) * u;
        const z = a.p[1] + (b.p[1] - a.p[1]) * u;
        // Bow the ring outward from the grid a little at midpoint.
        const bow = Math.sin(Math.PI * u) * step * 0.35;
        ctrl.push(k % 2 === 0 ? [x, z + bow] : [x + bow, z]);
      }
      net.addRoad(a, b, linkOpts(o.ringClass, { ctrl, scenic: k === 0 }));
      meta.ring.push([a.id, b.id]);
    }
    // Two spurs joining the ring to the grid.
    const spurs = [
      [ring[0], grid[0][0]], [ring[2], grid[n - 1][n - 1]],
    ];
    for (const [a, b] of spurs) net.addRoad(a, b, linkOpts('arterial', { ramp: true }));
  }

  // ── diagonals ─────────────────────────────────────────────────────────────
  for (let k = 0; k < o.diagonals; k++) {
    const i0 = k === 0 ? 0 : 0;
    const j0 = k === 0 ? 0 : n - 1;
    const i1 = k === 0 ? n - 1 : n - 1;
    const j1 = k === 0 ? n - 1 : 0;
    const a = grid[i0][j0], b = grid[i1][j1];
    const ctrl = [];
    for (let t = 1; t < n - 1; t++) {
      const u = t / (n - 1);
      const x = a.p[0] + (b.p[0] - a.p[0]) * u + Math.sin(u * Math.PI) * (k ? -step * 0.6 : step * 0.6);
      const z = a.p[1] + (b.p[1] - a.p[1]) * u;
      ctrl.push([x, z]);
    }
    // A diagonal is a viaduct over the grid: piers and fascias, and it flies
    // over the streets it crosses instead of junctioning with them.
    net.addRoad(a, b, linkOpts('viaduct', { ctrl, elevated: true, cycleRoute: true, pierSpacing: 34 }));
    meta.diagonals.push([a.id, b.id]);
  }

  // ── plaza ─────────────────────────────────────────────────────────────────
  if (o.square && n >= 4) {
    const node = grid[2][2];
    node.tags = { ...node.tags, junction: 'shared', plaza: true, name: 'Central square' };
    meta.square = node.id;
    // Boulevard frontage on the approaches to the square.
    for (const link of node.roads) if (link.road.class === 'street' || link.road.class === 'arterial') link.road.flags.scenic = true;
  }

  // ── rail ──────────────────────────────────────────────────────────────────
  if (o.rail) {
    const z0 = step * (n - 1) * 0.37;
    const a = net.addNode([-step * 1.2, z0], { rail: true });
    const b = net.addNode([step * (n - 1) + step * 1.2, z0 - step * 0.55], { rail: true });
    const ctrl = [];
    for (let t = 1; t < n + 1; t++) {
      const u = t / (n + 1);
      ctrl.push([
        -step * 1.2 + (step * (n + 1) + step * 0.4) * u,
        z0 - step * 0.55 * u + Math.sin(u * Math.PI * 2) * step * 0.18,
      ]);
    }
    const rail = net.addRoad(a, b, linkOpts('rail-line', { ctrl, name: 'Main line' }));
    meta.rail = rail.id;
    // Level crossing: the street that crosses the rail line becomes a rail
    // junction on both sides of it.
    const crossZ = z0;
    let best = null;
    for (const node of net.nodes) {
      if (!node.major) continue;
      const d = Math.abs(node.p[1] - crossZ);
      if (!best || d < best.d) best = { node, d };
    }
    if (best && best.d < step * 0.6) {
      best.node.tags = { ...best.node.tags, junction: 'rail', crossings: true };
      meta.railCrossing = best.node.id;
    }
  }

  net.sampleAll();
  return { net, meta, opts: o, rng };
}

/** Short human summary of what was generated, for the UI and the harness. */
export function describeCity({ net, meta }) {
  const totals = net.totals();
  const byClass = {};
  for (const road of net.roads) byClass[road.class] = (byClass[road.class] || 0) + 1;
  const junctions = {};
  for (const node of net.nodes) {
    const t = node.plan?.type || (node.roads.length > 2 ? 'unsolved' : null);
    if (t) junctions[t] = (junctions[t] || 0) + 1;
  }
  const laneKm = net.roads.reduce((a, r) => a + r.samples.length / 1000 * (r.profile.lanes?.length || 1), 0);
  return {
    nodes: totals.nodes, roads: totals.roads, junctions: junctions.unsolved ? totals.junctions : totals.junctions,
    lengthKm: totals.length / 1000, laneKm,
    byClass, junctionTypes: junctions,
    ring: meta.ring.length, roundabouts: meta.roundabouts.length, rail: meta.rail != null,
    classes: Object.keys(byClass).filter((c) => ROAD_CLASSES[c]).length,
  };
}
