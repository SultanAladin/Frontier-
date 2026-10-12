// Seeded procedural city: a jittered street grid where every block edge is its own
// road segment joined at shared nodes (clean topology), plus an elevated highway,
// an underground subway, a surface railway that crosses streets with level
// crossings, and speed bumps, zebra crossings, stop lines, lamps and bollards.
// Buildings are intentionally not generated.

import { addNode, addRoad, addProp, createProject, centerlineOf } from './model.js';
import { mulberry32 } from './math.js';
import { sampleCenterline } from './centerline.js';
import { defaultProp } from './props.js';

export const CITY_DEFAULTS = {
  seed: 7,
  cols: 8,
  rows: 8,
  block: 140,
  jitter: 0.1,
  highway: true,
  subway: true,
  railway: true,
  busLanes: true,
  bikeLanes: true,
  parking: true,
  speedBumps: true,
  crosswalks: true,
  bollards: true,
  lamps: true,
  footpaths: true,
};

export function generateCity(input = {}) {
  const o = { ...CITY_DEFAULTS, ...input };
  const rng = mulberry32(o.seed);
  const project = createProject(`Generated city · seed ${o.seed}`);
  const { cols, rows, block } = o;
  const W = cols * block;
  const H = rows * block;
  const jit = (edge) => (edge ? 0 : (rng() * 2 - 1) * o.jitter * block);

  // 1. Grid nodes (boundary nodes stay on the map edge).
  const grid = [];
  for (let j = 0; j <= rows; j++) {
    const row = [];
    for (let i = 0; i <= cols; i++) {
      const edgeX = i === 0 || i === cols;
      const edgeZ = j === 0 || j === rows;
      const x = i * block + (edgeX ? 0 : jit(false));
      const z = j * block + (edgeZ ? 0 : jit(false));
      row.push(addNode(project, x, z));
    }
    grid.push(row);
  }
  const nodePos = (id) => project.nodes[id];

  const streetKind = (idx, count) => {
    if (idx === 0 || idx === count) return 'avenue';
    if (idx % 4 === 0) return 'avenue';
    if (idx % 2 === 0) return 'collector';
    return 'local';
  };
  const laneOpts = { busLanes: o.busLanes, bikeLanes: o.bikeLanes, parking: o.parking };

  // 2. Street edges: horizontal rows (j) and vertical columns (i).
  const streets = [];
  for (let j = 0; j <= rows; j++) {
    const kind = streetKind(j, rows);
    for (let i = 0; i < cols; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      streets.push(addRoad(project, { kind, startNode: a, endNode: b, points: [nodePos(a), nodePos(b)], options: laneOpts }));
    }
  }
  for (let i = 0; i <= cols; i++) {
    const kind = streetKind(i, cols);
    for (let j = 0; j < rows; j++) {
      const a = grid[j][i];
      const b = grid[j + 1][i];
      streets.push(addRoad(project, { kind, startNode: a, endNode: b, points: [nodePos(a), nodePos(b)], options: laneOpts }));
    }
  }

  // Node degree, used to decide where crossings and stop lines belong.
  const degree = new Map();
  for (const r of streets) {
    degree.set(r.start, (degree.get(r.start) || 0) + 1);
    degree.set(r.end, (degree.get(r.end) || 0) + 1);
  }

  // 3. Props on street segments.
  for (const road of streets) {
    const isAvenue = road.kind === 'avenue';
    const isLocal = road.kind === 'local';
    const atJunctionStart = degree.get(road.start) > 1;
    const atJunctionEnd = degree.get(road.end) > 1;
    if (o.crosswalks) {
      if (atJunctionStart) addProp(project, road.id, { ...defaultProp('crosswalk', 5), ref: 'start' });
      if (atJunctionEnd) addProp(project, road.id, { ...defaultProp('crosswalk', 5), ref: 'end' });
    }
    if (isAvenue || road.kind === 'collector') {
      if (atJunctionStart) addProp(project, road.id, { ...defaultProp('stopLine', 2), ref: 'start' });
      if (atJunctionEnd) addProp(project, road.id, { ...defaultProp('stopLine', 2), ref: 'end' });
    }
    if (isLocal && o.speedBumps) {
      const L = centerlineOf(road).s.at(-1);
      addProp(project, road.id, defaultProp('speedBump', L / 2));
    }
    if (o.lamps) addProp(project, road.id, defaultProp('lamps', 0));
    if (isLocal && o.bollards && rng() < 0.12) addProp(project, road.id, defaultProp('bollards', 0));
  }

  // 4. Elevated highway: one bridge across the city, ramping up from outside the grid.
  if (o.highway) {
    const pts = [
      { x: -0.25 * W, z: 0.12 * H, h: 0 },
      { x: 0.25 * W, z: 0.42 * H, h: 9 },
      { x: 0.75 * W, z: 0.58 * H, h: 9 },
      { x: 1.25 * W, z: 0.92 * H, h: 0 },
    ];
    const [hs, he] = [addNode(project, pts[0].x, pts[0].z), addNode(project, pts.at(-1).x, pts.at(-1).z)];
    addRoad(project, { kind: 'highway', mode: 'bridge', points: pts, name: 'Elevated highway', startNode: hs, endNode: he });
  }

  // 5. Underground subway under the central avenue row.
  if (o.subway) {
    const jr = Math.max(1, Math.round(rows / 2));
    const pts = [];
    for (let i = 0; i <= cols; i++) {
      const n = nodePos(grid[jr][i]);
      const h = i === 0 || i === cols ? 0 : -7;
      pts.push({ x: n.x, z: n.z, h });
    }
    addRoad(project, {
      kind: 'subway', mode: 'underground', points: pts, name: 'Central subway',
      startNode: grid[jr][0], endNode: grid[jr][cols],
    });
  }

  // 6. Surface railway on a diagonal, with level crossings wherever it meets a street.
  if (o.railway) {
    const rp = [{ x: -0.1 * W, z: 0.9 * H, h: 0 }, { x: 1.1 * W, z: 0.08 * H, h: 0 }];
    const rail = addRoad(project, {
      kind: 'railway',
      points: rp,
      name: 'Surface railway',
      startNode: addNode(project, rp[0].x, rp[0].z),
      endNode: addNode(project, rp[1].x, rp[1].z),
    });
    const railCl = sampleCenterline(rail.points, { step: 2 });
    for (const road of streets) {
      if (road.kind === 'avenue' && rng() < 0.3) continue;
      const ptsA = road.points;
      const hit = segmentCrossing(railCl, ptsA[0], ptsA[1]);
      if (!hit) continue;
      const L = Math.hypot(ptsA[1].x - ptsA[0].x, ptsA[1].z - ptsA[0].z);
      if (hit.t * L < 22 || (1 - hit.t) * L < 22) continue; // keep crossings clear of junctions
      addProp(project, road.id, { ...defaultProp('railCrossing', hit.t * L), closed: true });
    }
  }

  // 7. Footpaths cutting diagonally through a few blocks (dead ends, no nodes).
  if (o.footpaths) {
    for (let k = 0; k < Math.max(2, Math.round((cols * rows) / 14)); k++) {
      const i = Math.floor(rng() * cols);
      const j = Math.floor(rng() * rows);
      const m = 0.18 * block;
      const a = { x: i * block + m, z: j * block + m, h: 0 };
      const b = { x: (i + 1) * block - m, z: (j + 1) * block - m, h: 0 };
      addRoad(project, {
        kind: 'footpath', points: [a, b], name: `Footpath ${k + 1}`,
        startNode: addNode(project, a.x, a.z), endNode: addNode(project, b.x, b.z),
      });
    }
  }

  return project;
}

/** Parametric hit of segment A-B against a sampled polyline. Returns {t} with t along A-B. */
function segmentCrossing(poly, A, B) {
  const ax = A.x;
  const az = A.z;
  const bx = B.x;
  const bz = B.z;
  for (let i = 0; i < poly.n - 1; i++) {
    const cx = poly.x[i];
    const cz = poly.z[i];
    const dx = poly.x[i + 1];
    const dz = poly.z[i + 1];
    const d1x = bx - ax;
    const d1z = bz - az;
    const d2x = dx - cx;
    const d2z = dz - cz;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
    const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t };
  }
  return null;
}
