// Procedural road networks: city, countryside and offroad.
// Every generator returns plain "road specs" that the editor can edit afterwards:
//   { id, typeId, layer, points:[[x,y]...], seed }
// Roads are unique: each one gets its own seed, so widths, dash phase, bump positions,
// bollard spacing and vertex tint differ even when two roads use the same type.

import { makeRng, catmullRom, vdist } from './geometry.js';
import { ROAD_TYPES } from './profiles.js';

export function layerOf(typeId) {
  const t = ROAD_TYPES[typeId];
  if (!t) return 0;
  if (t.kind === 'bridge') return 1;
  if (t.kind === 'subway') return -1;
  return 0;
}

// Assigns ids/seeds in one place so generated networks are reproducible.
class Net {
  constructor(seed) {
    this.rng = makeRng(seed);
    this.roads = [];
    this.n = 0;
  }
  add(typeId, points, extra = {}) {
    const id = `${typeId}-${String(++this.n).padStart(3, '0')}`;
    const seed = Math.floor(this.rng() * 1e9) + this.n;
    const road = { id, typeId, layer: layerOf(typeId), points, seed, ...extra };
    this.roads.push(road);
    return road;
  }
}

// Insert point p into a polyline at its projection (T-joins are then exact vertices).
export function attachPoint(points, p) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const d = vdist(p, q);
    if (!best || d < best.d) best = { d, i, q, t };
  }
  if (!best) return { points, at: p };
  // Do not duplicate a vertex that already sits there.
  const out = points.slice(0, best.i + 1);
  if (best.t > 1e-6 && best.t < 1 - 1e-6) out.push(best.q);
  out.push(...points.slice(best.i + 1));
  return { points: out, at: best.q };
}

function nearestVertex(points, p) {
  let bi = 0, bd = Infinity;
  points.forEach((q, i) => {
    const d = vdist(q, p);
    if (d < bd) { bd = d; bi = i; }
  });
  return { index: bi, point: points[bi] };
}

// Lateral wobble for a straight run from a to b (end points kept exact).
function wobbleLine(a, b, rng, { step = 120, amp = 8 } = {}) {
  const L = vdist(a, b);
  const n = Math.max(2, Math.round(L / step));
  const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
  const px = -dy, py = dx;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = i === 0 || i === n ? 0 : (rng() - 0.5) * 2 * amp;
    pts.push([a[0] + (b[0] - a[0]) * t + px * w, a[1] + (b[1] - a[1]) * t + py * w]);
  }
  return pts;
}

// ----------------------------------------------------------------- city
export function generateCity(seed = 1, { size = 2400 } = {}) {
  const net = new Net(seed);
  const rng = net.rng;
  const core = size * 0.36;

  // Avenue grid: spacing varies so no two blocks match.
  const xs = [], ys = [];
  for (let x = -core; x <= core + 1; x += 150 + rng() * 120) xs.push(x);
  for (let y = -core; y <= core + 1; y += 150 + rng() * 120) ys.push(y);
  const avenuesV = [], avenuesH = [];

  xs.forEach((x, i) => {
    const type = i % 3 === 0 ? 'boulevard' : 'avenue';
    const pts = wobbleLine([x, -core], [x + (rng() - 0.5) * 40, core], rng, { step: 110, amp: 10 });
    avenuesV.push(net.add(type, pts));
  });
  ys.forEach((y, i) => {
    const type = i % 3 === 1 ? 'boulevard' : 'avenue';
    const pts = wobbleLine([-core, y], [core, y + (rng() - 0.5) * 40], rng, { step: 110, amp: 10 });
    avenuesH.push(net.add(type, pts));
  });

  // Streets fill the blocks between avenues. About a quarter are dropped for variety.
  const streetTypes = ['street', 'street', 'street', 'cyclestreet'];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2 + (rng() - 0.5) * 30;
    if (rng() < 0.25) continue;
    net.add(streetTypes[Math.floor(rng() * streetTypes.length)],
      wobbleLine([x, -core * (0.6 + rng() * 0.3)], [x + (rng() - 0.5) * 60, core * (0.6 + rng() * 0.3)], rng, { step: 90, amp: 5 }));
  }
  for (let j = 0; j < ys.length - 1; j++) {
    const y = (ys[j] + ys[j + 1]) / 2 + (rng() - 0.5) * 30;
    if (rng() < 0.25) continue;
    net.add(streetTypes[Math.floor(rng() * streetTypes.length)],
      wobbleLine([-core * (0.6 + rng() * 0.3), y], [core * (0.6 + rng() * 0.3), y + (rng() - 0.5) * 60], rng, { step: 90, amp: 5 }));
  }

  // Railway: a long curved line across the city, with level crossings where it meets streets.
  const railPts = catmullRom([
    [-core - 300, -core * 0.45], [-core * 0.3, -core * 0.2 + rng() * 80],
    [core * 0.2, core * 0.25], [core + 300, core * 0.5],
  ], 14);
  net.add('railway', railPts);

  // Subway: underground lines that start and end at the surface (portals).
  net.add('subway', subwayFrom(avenuesV[Math.floor(xs.length / 2)]));
  net.add('subway', subwayFrom(avenuesH[Math.floor(ys.length / 2)]));

  // Elevated overpasses: bridges between two avenues that pass over the rail and streets.
  const overpasses = [
    ['bridge_girder', avenuesV[1], avenuesV[xs.length - 2]],
    ['bridge_cable', avenuesH[0], avenuesH[ys.length - 1]],
    ['bridge_arch', avenuesV[2], avenuesV[xs.length - 3]],
  ];
  for (const [type, A, B] of overpasses) {
    if (!A || !B) continue;
    const pA = A.points[Math.floor(A.points.length / 2)];
    const target = nearestVertex(B.points, pA);
    // Endpoints are exact ground vertices (inserted into both avenues) so they join as ramps.
    const a = attachPoint(A.points, pA);
    A.points = a.points;
    const b = attachPoint(B.points, target.point);
    B.points = b.points;
    const mid = [(pA[0] + target.point[0]) / 2, (pA[1] + target.point[1]) / 2];
    const bow = [mid[0] + (rng() - 0.5) * 30, mid[1] + (rng() - 0.5) * 30];
    const pts = catmullRom([pA, bow, target.point], 12);
    net.add(type, pts);
  }

  // Pedestrian paths that connect avenues mid-block (exact T joins).
  for (let k = 0; k < 6; k++) {
    const A = avenuesV[Math.floor(rng() * avenuesV.length)];
    const B = avenuesH[Math.floor(rng() * avenuesH.length)];
    const pA = A.points[Math.floor(rng() * (A.points.length - 2)) + 1];
    const pB = B.points[Math.floor(rng() * (B.points.length - 2)) + 1];
    const ap = attachPoint(A.points, pA); A.points = ap.points;
    const bp = attachPoint(B.points, pB); B.points = bp.points;
    const mid = [(ap.at[0] + bp.at[0]) / 2 + (rng() - 0.5) * 50, (ap.at[1] + bp.at[1]) / 2 + (rng() - 0.5) * 50];
    net.add('pathway', catmullRom([ap.at, mid, bp.at], 10));
  }

  // Countryside roads leaving the city edges, plus offroad tracks beyond.
  countryside(net, { size, core, attachTo: [...avenuesV, ...avenuesH] });
  return net.roads;
}

function subwayFrom(road) {
  // Underground copy of a surface avenue: same ends, slightly inset route.
  const pts = road.points;
  const first = pts[0], last = pts[pts.length - 1];
  const mid = [];
  for (let i = 1; i < pts.length - 1; i += 6) mid.push([pts[i][0] + 9, pts[i][1] + 9]);
  return [first, ...mid, last];
}

// ----------------------------------------------------------------- countryside
function countryside(net, { size, core, attachTo = [] }) {
  const rng = net.rng;
  const edge = size / 2 - 60;
  // Country roads out from the city edges to the far map boundary.
  // Start exactly at avenue ends, so country roads join the city network (end-to-end).
  const ends = attachTo.flatMap((r) => [r.points[0], r.points[r.points.length - 1]]);
  const starts = [];
  for (let i = 0; i < 6 && ends.length; i++) starts.push(ends[Math.floor(rng() * ends.length)]);
  const countryPaths = [];
  for (const s of starts) {
    const ang = Math.atan2(s[1], s[0]);
    const end = [Math.cos(ang) * edge, Math.sin(ang) * edge];
    const mid1 = [s[0] + (end[0] - s[0]) * 0.33 + (rng() - 0.5) * 300, s[1] + (end[1] - s[1]) * 0.33 + (rng() - 0.5) * 300];
    const mid2 = [s[0] + (end[0] - s[0]) * 0.66 + (rng() - 0.5) * 300, s[1] + (end[1] - s[1]) * 0.66 + (rng() - 0.5) * 300];
    const pts = catmullRom([s, mid1, mid2, end], 10);
    const road = net.add(rng() < 0.6 ? 'country' : 'highway', pts);
    countryPaths.push(road);
  }
  // Offroad tracks that branch from country roads and wander until they dead-end.
  for (let k = 0; k < 14; k++) {
    const host = countryPaths[Math.floor(rng() * countryPaths.length)];
    const hp = host.points;
    const hi = Math.floor(rng() * (hp.length - 2)) + 1;
    const att = attachPoint(hp, hp[hi]);
    host.points = att.points;
    let p = att.at;
    let heading = rng() * Math.PI * 2;
    const pts = [p];
    const steps = 6 + Math.floor(rng() * 7);
    for (let s = 0; s < steps; s++) {
      heading += (rng() - 0.5) * 1.1;
      const stepLen = 90 + rng() * 80;
      p = [p[0] + Math.cos(heading) * stepLen, p[1] + Math.sin(heading) * stepLen];
      pts.push(p);
    }
    net.add('offroad', catmullRom(pts, 6));
  }
}

// ----------------------------------------------------------------- stand-alone generators
export function generateCountryside(seed = 7, { size = 2400 } = {}) {
  const net = new Net(seed);
  const rng = net.rng;
  // A winding main road and a river-crossing bridge; country lanes branch off.
  const main = catmullRom([
    [-size * 0.45, -size * 0.1], [-size * 0.2, size * 0.1 + rng() * 80],
    [size * 0.05, -size * 0.05], [size * 0.3, size * 0.12], [size * 0.45, -size * 0.2],
  ], 14);
  const mainRoad = net.add('country', main);
  const bridgeA = attachPoint(mainRoad.points, mainRoad.points[Math.floor(mainRoad.points.length * 0.35)]);
  mainRoad.points = bridgeA.points;
  const bridgeB = attachPoint(mainRoad.points, mainRoad.points[Math.floor(mainRoad.points.length * 0.5)]);
  mainRoad.points = bridgeB.points;
  // Bridge spans the country road ahead without a junction.
  net.add('bridge_arch', catmullRom([
    [bridgeA.at[0] + 5, bridgeA.at[1] - 150], [bridgeA.at[0] + 5, bridgeA.at[1] + 150],
  ], 6));
  for (let k = 0; k < 10; k++) {
    const hp = mainRoad.points;
    const hi = Math.floor(rng() * (hp.length - 2)) + 1;
    const att = attachPoint(hp, hp[hi]);
    mainRoad.points = att.points;
    let p = att.at;
    let heading = rng() * Math.PI * 2;
    const pts = [p];
    for (let s = 0; s < 5 + Math.floor(rng() * 4); s++) {
      heading += (rng() - 0.5) * 1.2;
      p = [p[0] + Math.cos(heading) * (110 + rng() * 60), p[1] + Math.sin(heading) * (110 + rng() * 60)];
      pts.push(p);
    }
    net.add(rng() < 0.5 ? 'country' : 'offroad', catmullRom(pts, 6));
  }
  return net.roads;
}

export function generateOffroad(seed = 11, { size = 2400 } = {}) {
  const net = new Net(seed);
  const rng = net.rng;
  // Dirt tracks crossing a wilderness; some cross each other, some dead-end.
  for (let k = 0; k < 16; k++) {
    let p = [(rng() - 0.5) * size * 0.8, (rng() - 0.5) * size * 0.8];
    let heading = rng() * Math.PI * 2;
    const pts = [p];
    for (let s = 0; s < 8 + Math.floor(rng() * 6); s++) {
      heading += (rng() - 0.5) * 0.9;
      p = [p[0] + Math.cos(heading) * (120 + rng() * 80), p[1] + Math.sin(heading) * (120 + rng() * 80)];
      pts.push(p);
    }
    net.add('offroad', catmullRom(pts, 6));
  }
  return net.roads;
}

// Re-seeding a whole list (used by the "reroll seed" button).
export function reseed(roads, seed) {
  const rng = makeRng(seed);
  return roads.map((r) => ({ ...r, seed: Math.floor(rng() * 1e9) }));
}
