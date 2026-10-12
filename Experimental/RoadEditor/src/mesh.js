// Converts the planar road graph into triangle batches (one per material).
// Pure JS (no three.js), so the output is testable and reusable by any renderer.
//
// World convention: 2D planar point (x, y)  ->  world (x, height, y).
// Every batch is { positions[], normals[], colors[], indices[] } ready for BufferGeometry.

import {
  offsetPolyline, arcLengths, resampleByLength, vnorm, vsub, vperp, vdist, makeRng, polylineLength,
} from './geometry.js';

export const MATERIALS = {
  asphalt: [0.14, 0.145, 0.15],
  asphalt_bus: [0.56, 0.13, 0.1],
  bike: [0.12, 0.45, 0.25],
  parking: [0.24, 0.24, 0.25],
  concrete: [0.66, 0.65, 0.62],
  grass: [0.25, 0.45, 0.18],
  gravel: [0.5, 0.46, 0.38],
  dirt: [0.4, 0.3, 0.2],
  ballast: [0.5, 0.48, 0.44],
  sleeper: [0.32, 0.2, 0.12],
  steel: [0.6, 0.6, 0.64],
  paint_white: [0.95, 0.95, 0.93],
  paint_yellow: [0.98, 0.8, 0.12],
  paint_red: [0.8, 0.12, 0.1],
  barrier: [0.72, 0.72, 0.74],
  bollard: [0.95, 0.85, 0.12],
  pier: [0.52, 0.53, 0.55],
  struct: [0.36, 0.4, 0.46],
  cable: [0.88, 0.88, 0.92],
  gate_red: [0.92, 0.14, 0.12],
  tunnel: [0.3, 0.36, 0.44],
  curb: [0.7, 0.7, 0.68],
};

// Heights per layer. Layer 1 = bridge deck, -1 = subway tunnel, 0 = surface.
export const LAYER_HEIGHT = { 0: 0, 1: 9, '-1': -7 };
export const RAMP_LENGTH = 28;

const UP = [0, 1, 0];

// --------------------------------------------------------------- batch builder
export const CHUNK_SIZE = 300; // metres; each chunk is its own draw call so the camera can cull it

export class MeshBatches {
  constructor() {
    this.batches = new Map(); // key "material|cx|cy" -> arrays
    this.counts = { triangles: 0 };
  }

  key(mat, centre) {
    const cx = Math.floor(centre[0] / CHUNK_SIZE), cz = Math.floor(centre[2] / CHUNK_SIZE);
    return `${mat}|${cx}|${cz}`;
  }

  batch(key) {
    if (!this.batches.has(key)) this.batches.set(key, { positions: [], normals: [], colors: [], indices: [] });
    return this.batches.get(key);
  }

  vert(key, p, n, tint = [1, 1, 1]) {
    const b = this.batch(key);
    const base = MATERIALS[key.split('|')[0]] || [1, 1, 1];
    b.positions.push(p[0], p[1], p[2]);
    b.normals.push(n[0], n[1], n[2]);
    b.colors.push(base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]);
    return b.positions.length / 3 - 1;
  }

  tri(mat, a, b, c, n, tint = [1, 1, 1]) {
    if (triArea(a, b, c) < 1e-7) return; // skip slivers instead of emitting degenerate faces
    const nn = n || faceNormal(a, b, c);
    const k = this.key(mat, centroid(a, b, c));
    const i0 = this.vert(k, a, nn, tint);
    const i1 = this.vert(k, b, nn, tint);
    const i2 = this.vert(k, c, nn, tint);
    this.batch(k).indices.push(i0, i1, i2);
    this.counts.triangles++;
  }

  // Indexed quad: four shared vertices, two triangles.
  quad(mat, a, b, c, d, n, tint = [1, 1, 1]) {
    if (triArea(a, b, c) + triArea(a, c, d) < 1e-7) return;
    const nn = n || faceNormal(a, b, c);
    const k = this.key(mat, centroid(a, b, c, d));
    const i0 = this.vert(k, a, nn, tint);
    const i1 = this.vert(k, b, nn, tint);
    const i2 = this.vert(k, c, nn, tint);
    const i3 = this.vert(k, d, nn, tint);
    this.batch(k).indices.push(i0, i1, i2, i0, i2, i3);
    this.counts.triangles += 2;
  }

  // Ribbon between two 3D polylines of equal length.
  strip(mat, L, R, tint = [1, 1, 1], n) {
    for (let i = 0; i < L.length - 1; i++) {
      const nn = n || faceNormal(L[i], L[i + 1], R[i + 1]);
      this.quad(mat, L[i], L[i + 1], R[i + 1], R[i], nn, tint);
    }
  }
  // Axis-aligned-in-local-space box rotated by yaw around Y.
  box(mat, center, half, yaw, tint) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corner = (x, y, z) => [
      center[0] + x * c + z * s, center[1] + y, center[2] - x * s + z * c,
    ];
    const v = {
      0: corner(-half[0], -half[1], -half[2]), 1: corner(half[0], -half[1], -half[2]),
      2: corner(half[0], half[1], -half[2]), 3: corner(-half[0], half[1], -half[2]),
      4: corner(-half[0], -half[1], half[2]), 5: corner(half[0], -half[1], half[2]),
      6: corner(half[0], half[1], half[2]), 7: corner(-half[0], half[1], half[2]),
    };
    const faces = [
      [0, 3, 2, 1, [0, 0, -1]], [4, 5, 6, 7, [0, 0, 1]],
      [0, 4, 7, 3, [-1, 0, 0]], [1, 2, 6, 5, [1, 0, 0]],
      [3, 7, 6, 2, [0, 1, 0]], [0, 1, 5, 4, [0, -1, 0]],
    ];
    for (const [a, b, cc, d, nrm] of faces) {
      const nw = [nrm[0] * c + nrm[2] * s, nrm[1], -nrm[0] * s + nrm[2] * c];
      this.quad(mat, v[a], v[b], v[cc], v[d], nw, tint);
    }
  }

  // Square-section beam from a to b.
  beam(mat, a, b, r, tint) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return;
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    this.boxOriented(mat, mid, [r, r, L / 2], yaw, pitch, tint);
  }

  boxOriented(mat, center, half, yaw, pitch, tint) {
    // Build in local space: z axis along the beam, then yaw around Y and pitch around X.
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    const tf = (x, y, z) => {
      // pitch around local X
      const y1 = y * cp - z * sp, z1 = y * sp + z * cp;
      // yaw around Y
      const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
      return [center[0] + x2, center[1] + y1, center[2] + z2];
    };
    const sx = half[0], sy2 = half[1], sz = half[2];
    const v = [
      tf(-sx, -sy2, -sz), tf(sx, -sy2, -sz), tf(sx, sy2, -sz), tf(-sx, sy2, -sz),
      tf(-sx, -sy2, sz), tf(sx, -sy2, sz), tf(sx, sy2, sz), tf(-sx, sy2, sz),
    ];
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
    for (const [a, b, c, d] of faces) this.quad(mat, v[a], v[b], v[c], v[d], undefined, tint);
  }

  // Cylinder with vertical axis at base point.
  cylinder(mat, base, radius, height, seg, tint) {
    const top = [base[0], base[1] + height, base[2]];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [base[0] + Math.cos(a0) * radius, base[1], base[2] + Math.sin(a0) * radius];
      const p1 = [base[0] + Math.cos(a1) * radius, base[1], base[2] + Math.sin(a1) * radius];
      const q0 = [p0[0], base[1] + height, p0[2]];
      const q1 = [p1[0], base[1] + height, p1[2]];
      const nm = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.quad(mat, p0, p1, q1, q0, nm, tint);
      this.tri(mat, top, q0, q1, UP, tint);
    }
  }

  // Thin flat rectangle lying on the ground plane between two 2D points.
  flatLine(mat, a2, b2, width, y, tint) {
    const d = vnorm(vsub(b2, a2));
    const n = vperp(d);
    const h = width / 2;
    const p = (pt, s) => [pt[0] + n[0] * s, y, pt[1] + n[1] * s];
    this.quad(mat, p(a2, h), p(b2, h), p(b2, -h), p(a2, -h), UP, tint);
  }

  // Flat rectangle centred on a 2D point, oriented along `dir`.
  flatRect(mat, centre2, dir, along, across, y, tint) {
    const n = vperp(dir);
    const ha = along / 2, hb = across / 2;
    const c = centre2;
    const pt = (s, t) => [c[0] + dir[0] * s + n[0] * t, y, c[1] + dir[1] * s + n[1] * t];
    this.quad(mat, pt(-ha, hb), pt(ha, hb), pt(ha, -hb), pt(-ha, -hb), UP, tint);
  }

  // One entry per chunk-batch: { material, cx, cz, positions, normals, colors, indices }.
  toChunks() {
    const out = [];
    for (const [key, b] of this.batches) {
      const [material, cx, cz] = key.split('|');
      out.push({
        key, material, cx: Number(cx), cz: Number(cz),
        positions: new Float32Array(b.positions),
        normals: new Float32Array(b.normals),
        colors: new Float32Array(b.colors),
        indices: new Uint32Array(b.indices),
      });
    }
    return out;
  }
}

// Centroid of a triangle (c given) or quad (d given), used to bucket geometry into chunks.
function centroid(a, b, c, d) {
  const pts = d ? [a, b, c, d] : [a, b, c];
  const n = pts.length;
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / n, y / n, z / n];
}

function triArea(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

// Raw geometric normal (winding order). Callers pass UP explicitly for ground faces;
// the renderer uses double-sided lighting, so vertical faces stay correct.
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// --------------------------------------------------------------- helpers
const P3 = (p, h) => [p[0], h, p[1]];
const smooth = (u) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

// Height profile of an edge (metres above ground). Bridges/tunnels ramp down to
// the ground only where they meet a surface junction.
export function edgeHeightFn(edge, groundNodes) {
  const base = LAYER_HEIGHT[edge.layer] ?? 0;
  const pts = edge.points;
  const L = polylineLength(pts);
  const RL = Math.min(RAMP_LENGTH, L / 2);
  const groundStart = groundNodes.has(edge.a);
  const groundEnd = groundNodes.has(edge.b);
  const arc = arcLengths(pts);
  return (i) => {
    if (base === 0) return 0;
    const s = arc[i];
    let f = 1;
    if (groundStart) f = Math.min(f, smooth(s / Math.max(RL, 1e-6)));
    if (groundEnd) f = Math.min(f, smooth((L - s) / Math.max(RL, 1e-6)));
    return base * f;
  };
}

// --------------------------------------------------------------- main entry
// graph: planarize() output, each edge carries: typeId, profile {lanes,width,type}, seed, bridge?
export function buildRoadMeshes(graph, { crosswalks = true } = {}) {
  const out = new MeshBatches();
  const degree = new Map();
  const nodeLayers = new Map(); // node -> Set(layers)
  for (const e of graph.edges) {
    for (const n of [e.a, e.b]) {
      degree.set(n, (degree.get(n) || 0) + 1);
      if (!nodeLayers.has(n)) nodeLayers.set(n, new Set());
      nodeLayers.get(n).add(e.layer);
    }
  }
  // Nodes touching a surface road: bridge/tunnel ramps come down here.
  const groundNodes = new Set();
  for (const e of graph.edges) if (e.layer === 0) { groundNodes.add(e.a); groundNodes.add(e.b); }

  const edgeInfo = new Map();
  for (const e of graph.edges) {
    const rng = makeRng(e.seed ?? (e.id * 9973 + 17));
    // Resample to about 3 m between vertices: smooth enough for bends, light enough for a city.
    const pts = resampleByLength(e.points, 3.0);
    const heightOf = edgeHeightFn({ ...e, points: pts }, groundNodes);
    const arc = arcLengths(pts);
    const z = pts.map((_, i) => heightOf(i));
    const tint = [1 + (rng() - 0.5) * 0.08, 1 + (rng() - 0.5) * 0.08, 1 + (rng() - 0.5) * 0.08];
    const info = { edge: e, pts, z, arc, rng, tint };
    edgeInfo.set(e.id, info);
    const kind = e.profile?.type?.kind ?? e.kind ?? 'road';
    if (kind === 'rail') drawRail(out, info);
    else if (kind === 'subway') drawTunnel(out, info);
    else drawRoad(out, info, e);
  }

  // Junctions: arms at each node grouped by their surface height (ground vs bridge vs tunnel).
  for (const [node, degCount] of degree) {
    if (degCount === 0) continue;
    const nodePos = nodeCoord(graph, node);
    const arms = [];
    for (const e of graph.edges) {
      if (e.a !== node && e.b !== node) continue;
      const info = edgeInfo.get(e.id);
      const atStart = e.a === node;
      const idx = atStart ? 0 : info.pts.length - 1;
      const nb = atStart ? info.pts[1] : info.pts[info.pts.length - 2];
      const dir = vnorm(vsub(nb, nodePos));
      const profile = e.profile || { lanes: [], width: 7, type: {} };
      arms.push({ e, info, dir, h: info.z[idx], profile, kind: e.profile?.type?.kind ?? 'road' });
    }
    const groups = new Map();
    for (const arm of arms) {
      if (arm.kind === 'rail' || arm.kind === 'subway') continue;
      const key = Math.round(arm.h * 100);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(arm);
    }
    for (const [, group] of groups) {
      if (group.length === 1) drawCap(out, nodePos, group[0]);
      else drawJunction(out, nodePos, group);
      if (crosswalks) drawArmCrossings(out, nodePos, group);
    }
    // Rail crossings: level crossing where a railway meets a road at the same height.
    const rails = arms.filter((a) => a.kind === 'rail');
    const roads = arms.filter((a) => a.kind === 'road' && a.h === 0);
    if (rails.length && roads.length) drawLevelCrossing(out, nodePos, roads);
  }

  // Bridge decks: parapets, girders, arches or cable-stayed towers.
  for (const [, info] of edgeInfo) {
    const e = info.edge;
    if (e.profile?.type?.kind === 'bridge') drawBridgeStructure(out, info, e);
  }

  return { chunks: out.toChunks(), counts: out.counts, edgeCount: graph.edges.length, nodeCount: graph.nodes.length };
}

function nodeCoord(graph, id) {
  const n = graph.nodes[id];
  return [n.x, n.y];
}

// --------------------------------------------------------------- road surfaces
function lateralLine(info, off, extraZ = 0) {
  const offset = offsetPolyline(info.pts, off);
  return offset.map((p, i) => P3(p, info.z[i] + extraZ));
}

const laneMat = (lane) => {
  switch (lane.type) {
    case 'drive': return 'asphalt';
    case 'bus': return 'asphalt_bus';
    case 'bike': return 'bike';
    case 'parking': return 'parking';
    case 'sidewalk': return 'concrete';
    case 'concrete': return 'concrete';
    case 'median': return 'grass';
    case 'shoulder': return 'gravel';
    case 'gravel': return 'gravel';
    case 'dirt': return 'dirt';
    default: return 'asphalt';
  }
};

function drawRoad(out, info, edge) {
  const { pts, z, rng, tint } = info;
  const profile = edge.profile || { lanes: [], width: 7, type: {} };
  const type = profile.type || {};
  const lanes = profile.lanes;
  if (!lanes.length) return;

  // Off-road tracks get a rut pattern: a deterministic bumpy height field.
  const rutPhase = rng() * 10;
  const rutted = !!type.ruts;

  // 1. Lane surfaces.
  for (const lane of lanes) {
    const top = offsetPolyline(pts, lane.top);
    const bot = offsetPolyline(pts, lane.bottom);
    const h = lane.h;
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const rut = rutted ? ruttedHeight(info.arc[i], rutPhase, lane) : 0;
      L.push(P3(top[i], z[i] + h + rut));
      R.push(P3(bot[i], z[i] + h + rut));
    }
    out.strip(laneMat(lane), L, R, tint, UP);
    // 2. Curb faces on raised lanes (sidewalks, medians).
    if (h > 0) {
      const inner = Math.abs(lane.top) < Math.abs(lane.bottom) ? top : bot;
      const outer = inner === top ? bot : top;
      const innerBase = inner.map((p, i) => P3(p, z[i]));
      const innerTop = inner.map((p, i) => P3(p, z[i] + h));
      out.strip('curb', innerBase, innerTop, tint);
      const outerBase = outer.map((p, i) => P3(p, z[i]));
      const outerTop = outer.map((p, i) => P3(p, z[i] + h));
      out.strip('curb', outerTop, outerBase, tint);
    }
    if (lane.type === 'median' && type.barrier) {
      const barTop = top.map((p, i) => P3(p, z[i] + 0.9));
      const barBase = top.map((p, i) => P3(p, z[i]));
      out.strip('barrier', barTop, barBase, tint);
      const barTop2 = bot.map((p, i) => P3(p, z[i] + 0.9));
      const barBase2 = bot.map((p, i) => P3(p, z[i]));
      out.strip('barrier', barBase2, barTop2, tint);
    }
  }

  // 3. Lane boundaries: markings.
  if (type.markings && type.markings !== 'none') drawMarkings(out, info, lanes, type, rng);

  // 4. Edge barrier on highways.
  if (type.barrier) {
    const outerL = Math.max(...lanes.map((l) => l.top));
    const outerR = Math.min(...lanes.map((l) => l.bottom));
    for (const off of [outerL, outerR]) {
      const line = offsetPolyline(pts, off);
      out.strip('barrier', line.map((p, i) => P3(p, z[i] + 0.8)), line.map((p, i) => P3(p, z[i])), tint);
    }
  }

  // 5. Bollards along bike lanes or pedestrian edges.
  if (type.bollards && type.bollards !== 'none') drawBollards(out, info, lanes, type, rng);

  // 6. Speed bumps across the drive lanes.
  const bumps = Math.max(0, Math.round((type.speedBumps || 0) * (0.5 + rng())));
  for (let k = 0; k < bumps; k++) drawSpeedBump(out, info, lanes, rng);
}

function ruttedHeight(s, phase, lane) {
  // Two wheel ruts: smooth sinusoid on lateral position + slow height noise.
  const mid = (lane.top + lane.bottom) / 2;
  const rutLateral = Math.cos(mid * 1.4 + phase) * 0.08;
  return rutLateral + 0.05 * Math.sin(s * 0.11 + phase) + 0.03 * Math.sin(s * 0.37 + phase * 2.3);
}

function drawMarkings(out, info, lanes, type, rng) {
  const sorted = lanes.slice().sort((a, b) => b.top - a.top);
  const mat = 'paint_white';
  const dashLen = 2.8 + rng() * 1.2;
  const gapLen = 6.5 + rng() * 4.5;
  const phase = rng() * (dashLen + gapLen);
  const { z, pts, tint } = info;

  // Boundaries between consecutive lanes, plus the outer edges.
  const boundaries = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    boundaries.push({ off: sorted[i].bottom, a: sorted[i], b: sorted[i + 1] });
  }
  for (const b of boundaries) {
    const { a, b: c } = b;
    if (a.type === 'median' || c.type === 'median') {
      // Double yellow line on the median edge.
      for (const dOff of [-0.18, 0.18]) line(out, info, b.off + dOff, 0.12, 'paint_yellow', 0);
    } else if (a.type === 'sidewalk' || c.type === 'sidewalk' || a.type === 'shoulder' || c.type === 'shoulder') {
      line(out, info, b.off, 0.14, mat, 0); // kerb-edge solid line
    } else if (a.dir !== 0 && c.dir !== 0 && a.dir !== c.dir) {
      // Opposing traffic meets: yellow centre line.
      line(out, info, b.off, 0.14, 'paint_yellow', 0);
    } else if (a.dir !== 0 && a.dir === c.dir && (a.type === 'drive' && c.type === 'drive')) {
      if (type.markings !== 'country') dashed(out, info, b.off, 0.14, dashLen, gapLen, phase, mat);
    } else {
      line(out, info, b.off, 0.14, mat, 0);
    }
  }
  // Outer edges of the carriageway (solid white) if there is no kerb.
  const outerTop = sorted[0];
  const outerBot = sorted[sorted.length - 1];
  if (outerTop.type !== 'sidewalk' && outerTop.type !== 'shoulder' && outerTop.type !== 'median') {
    line(out, info, outerTop.top, 0.14, mat, 0);
  }
  if (outerBot.type !== 'sidewalk' && outerBot.type !== 'shoulder' && outerBot.type !== 'median') {
    line(out, info, outerBot.bottom, 0.14, mat, 0);
  }
  // Parking stall separators.
  for (const lane of lanes) {
    if (lane.type !== 'parking') continue;
    const step = 5.2 + rng() * 1.2;
    const offTop = offsetPolyline(pts, lane.top);
    const offBot = offsetPolyline(pts, lane.bottom);
    let s = rng() * step;
    const arc = info.arc;
    for (let i = 1; i < pts.length; i++) {
      if (arc[i] >= s) {
        out.flatLine(mat, offTop[i], offBot[i], 0.12, z[i] + 0.02, tint);
        s += step;
      }
    }
  }
}

function line(out, info, off, width, mat, dh) {
  const { pts, z, tint } = info;
  const a = offsetPolyline(pts, off + width / 2);
  const b = offsetPolyline(pts, off - width / 2);
  out.strip(mat, a.map((p, i) => P3(p, z[i] + 0.02 + dh)), b.map((p, i) => P3(p, z[i] + 0.02 + dh)), tint, UP);
}

function dashed(out, info, off, width, dashLen, gapLen, phase, mat) {
  const { pts, z, arc, tint } = info;
  const total = arc[arc.length - 1];
  const left = offsetPolyline(pts, off + width / 2);
  const right = offsetPolyline(pts, off - width / 2);
  let s = -phase;
  while (s < total) {
    const a = Math.max(0, s), b = Math.min(total, s + dashLen);
    if (b - a > 0.3) {
      const idx = [];
      for (let i = 0; i < pts.length; i++) if (arc[i] >= a && arc[i] <= b) idx.push(i);
      if (idx.length >= 2) {
        const L = idx.map((i) => P3(left[i], z[i] + 0.02));
        const R = idx.map((i) => P3(right[i], z[i] + 0.02));
        out.strip(mat, L, R, tint, UP);
      }
    }
    s += dashLen + gapLen;
  }
}

function drawBollards(out, info, lanes, type, rng) {
  const { pts, z, arc, tint } = info;
  // Spacing is generous: bollards are real geometry (no instancing in this builder).
  const spacing = type.bollards === 'post' ? 3.0 : 6.0;
  const sorted = lanes.slice().sort((a, b) => b.top - a.top);
  const targets = [];
  if (type.bollards === 'bike') {
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], c = sorted[i + 1];
      if ((a.type === 'bike' || c.type === 'bike') && a.type !== 'sidewalk' && c.type !== 'sidewalk') targets.push(a.bottom);
    }
  } else {
    // Pedestrian path: bollards at both outer edges.
    targets.push(sorted[0].top, sorted[sorted.length - 1].bottom);
  }
  const height = type.bollards === 'post' ? 0.9 : 0.85;
  const radius = type.bollards === 'post' ? 0.12 : 0.1;
  for (const off of targets) {
    const offs = offsetPolyline(pts, off);
    let s = rng() * spacing;
    for (let i = 1; i < pts.length; i++) {
      if (arc[i] >= s) {
        out.cylinder('bollard', P3(offs[i], z[i]), radius, height, 5, tint);
        s += spacing * (0.95 + rng() * 0.1);
      }
    }
  }
}

function drawSpeedBump(out, info, lanes, rng) {
  const { pts, z, arc, tint } = info;
  const total = arc[arc.length - 1];
  if (total < 20) return;
  const s0 = total * (0.15 + rng() * 0.7);
  let i = 0;
  while (i < arc.length - 1 && arc[i] < s0) i++;
  const drive = lanes.filter((l) => l.type === 'drive' || l.type === 'bus');
  if (!drive.length) return;
  const top = Math.max(...drive.map((l) => l.top));
  const bot = Math.min(...drive.map((l) => l.bottom));
  const mid = (top + bot) / 2;
  const w = top - bot;
  const dir = vnorm(vsub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
  const p = [pts[i][0] + vperp(dir)[0] * mid, pts[i][1] + vperp(dir)[1] * mid];
  const along = 0.6 + rng() * 0.2;
  const height = 0.09 + rng() * 0.04;
  // Speed bump: raised box across the lanes with striped top.
  out.box('paint_yellow', [p[0], z[i] + height / 2, p[1]], [w / 2, height / 2, along / 2], Math.atan2(dir[0], dir[1]), tint);
  out.flatRect('paint_white', p, dir, along * 0.5, w * 0.9, z[i] + height + 0.01, tint);
}

// --------------------------------------------------------------- junctions
function drawJunction(out, node, arms) {
  // Sort arms counter-clockwise.
  const sorted = arms.slice().sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
  const n = sorted.length;
  const y = sorted[0].h;
  const armData = sorted.map((arm) => {
    const left = vperp(arm.dir);
    const lanes = arm.profile.lanes;
    const coreTop = Math.max(0, ...lanes.filter((l) => l.h === 0 && l.type !== 'median' && l.type !== 'shoulder' && l.type !== 'gravel').map((l) => l.top));
    const coreBot = Math.min(0, ...lanes.filter((l) => l.h === 0 && l.type !== 'median' && l.type !== 'shoulder' && l.type !== 'gravel').map((l) => l.bottom));
    const outerTop = Math.max(0, ...lanes.map((l) => l.top));
    const outerBot = Math.min(0, ...lanes.map((l) => l.bottom));
    const hasSidewalk = lanes.some((l) => l.type === 'sidewalk');
    const curbH = lanes.reduce((m, l) => Math.max(m, l.h), 0);
    return { ...arm, left, coreTop, coreBot, outerTop, outerBot, hasSidewalk, curbH };
  });
  const pt = (a, lat) => [node[0] + a.left[0] * lat, node[1] + a.left[1] * lat];
  const tint = [1, 1, 1];

  // Core asphalt fan between arms.
  for (let k = 0; k < n; k++) {
    const A = armData[k];
    const B = armData[(k + 1) % n];
    const Lc = pt(A, A.coreTop);
    const Rc = pt(B, B.coreBot);
    if (n === 2 && Math.abs(Math.abs(A.coreTop) - Math.abs(B.coreBot)) < 1e-6 && vdist(Lc, Rc) < 1e-6) continue;
    const mat = A.profile.lanes.some((l) => l.type === 'dirt') ? 'dirt' : 'asphalt';
    out.tri(mat, P3(node, y), P3(Lc, y), P3(Rc, y), UP, tint);
    // Kerb-side pavement in the wedge, raised to the kerb height.
    if (A.hasSidewalk || B.hasSidewalk) {
      const Lo = pt(A, A.outerTop);
      const Ro = pt(B, B.outerBot);
      const hC = Math.max(A.curbH, B.curbH);
      const LcH = P3(Lc, y + hC), LoH = P3(Lo, y + hC), RoH = P3(Ro, y + hC), RcH = P3(Rc, y + hC);
      out.quad('concrete', LcH, LoH, RoH, RcH, UP, tint);
      out.quad('curb', P3(Lc, y), LcH, RcH, P3(Rc, y), undefined, tint);
    }
  }
}

function drawCap(out, node, arm) {
  // Dead end: half-disc of the road's core width.
  const lanes = arm.profile.lanes;
  const hw = Math.max(...lanes.map((l) => Math.abs(l.top)), ...lanes.map((l) => Math.abs(l.bottom)), 1);
  const y = arm.h;
  const ang0 = Math.atan2(arm.dir[1], arm.dir[0]);
  const segs = 10;
  const mat = lanes.some((l) => l.type === 'dirt') ? 'dirt' : lanes.some((l) => l.type === 'ballast') ? 'ballast' : 'asphalt';
  for (let i = 0; i < segs; i++) {
    const a0 = ang0 + Math.PI / 2 + (i / segs) * Math.PI;
    const a1 = ang0 + Math.PI / 2 + ((i + 1) / segs) * Math.PI;
    const p0 = [node[0] + Math.cos(a0) * hw, node[1] + Math.sin(a0) * hw];
    const p1 = [node[0] + Math.cos(a1) * hw, node[1] + Math.sin(a1) * hw];
    out.tri(mat, P3(node, y), P3(p0, y), P3(p1, y), UP);
  }
}

function drawArmCrossings(out, node, arms) {
  // Zebra crossing across each arm with a pedestrian footway, placed just outside the junction.
  for (const arm of arms) {
    if (arm.kind === 'rail' || arm.kind === 'subway') continue;
    const lanes = arm.profile.lanes;
    const hasFootway = lanes.some((l) => l.type === 'sidewalk' || l.type === 'concrete');
    if (!hasFootway) continue;
    const top = Math.max(...lanes.map((l) => l.top));
    const bot = Math.min(...lanes.map((l) => l.bottom));
    const D = Math.max(6, (top - bot) / 2 + 4);
    const c = [node[0] + arm.dir[0] * D, node[1] + arm.dir[1] * D];
    const n = vperp(arm.dir);
    const count = Math.max(4, Math.floor((top - bot) / 1.1));
    const y = arm.h + 0.02;
    for (let j = 0; j < count; j++) {
      const t = bot + ((j + 0.5) / count) * (top - bot);
      const cc = [c[0] + n[0] * t, c[1] + n[1] * t];
      out.flatRect('paint_white', cc, arm.dir, 2.5, (top - bot) / count * 0.5, y, [1, 1, 1]);
    }
  }
}

// --------------------------------------------------------------- rails
function drawRail(out, info) {
  const { pts, z, arc, tint } = info;
  const ballast = offsetPolyline(pts, 1.8), ballastB = offsetPolyline(pts, -1.8);
  out.strip('ballast', ballast.map((p, i) => P3(p, z[i] - 0.05)), ballastB.map((p, i) => P3(p, z[i] - 0.05)), tint, UP);
  for (const off of [0.72, -0.72]) {
    const r1 = offsetPolyline(pts, off + 0.07), r2 = offsetPolyline(pts, off - 0.07);
    out.strip('steel', r1.map((p, i) => P3(p, z[i] + 0.16)), r2.map((p, i) => P3(p, z[i] + 0.16)), tint, UP);
  }
  const total = arc[arc.length - 1];
  for (let s = 0.3; s < total; s += 0.65) {
    let i = 0;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const d = vnorm(vsub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    out.flatRect('sleeper', pts[i], d, 0.25, 2.6, z[i] + 0.1, tint);
  }
}

function drawLevelCrossing(out, node, roads) {
  // Barrier arms on each road approach, plus red/white gate stripes.
  for (const arm of roads) {
    const lanes = arm.profile.lanes;
    const top = Math.max(...lanes.map((l) => l.top));
    const bot = Math.min(...lanes.map((l) => l.bottom));
    const D = top + 2.5;
    const c = [node[0] + arm.dir[0] * D, node[1] + arm.dir[1] * D];
    const n = vperp(arm.dir);
    const yh = arm.h;
    const a = [c[0] + n[0] * top, yh + 1.1, c[1] + n[1] * top];
    const b = [c[0] + n[0] * bot, yh + 1.1, c[1] + n[1] * bot];
    out.cylinder('bollard', [c[0] + n[0] * (top + 0.6), yh, c[1] + n[1] * (top + 0.6)], 0.14, 1.2, 8, [1, 1, 1]);
    out.beam('gate_red', a, b, 0.07, [1, 1, 1]);
  }
}

// --------------------------------------------------------------- bridges & tunnels
function drawBridgeStructure(out, info, edge) {
  const { pts, z, arc, tint } = info;
  const profile = edge.profile;
  const lanes = profile.lanes;
  const outerTop = Math.max(...lanes.map((l) => l.top));
  const outerBot = Math.min(...lanes.map((l) => l.bottom));
  const total = arc[arc.length - 1];
  const kind = profile.type.bridge || 'girder';

  // Parapets along both edges.
  for (const off of [outerTop + 0.2, outerBot - 0.2]) {
    const line = offsetPolyline(pts, off);
    out.strip('barrier', line.map((p, i) => P3(p, z[i] + 1.1)), line.map((p, i) => P3(p, z[i])), tint);
  }

  if (kind === 'girder') {
    // Box-girder underside with a soffit.
    for (const off of [outerTop * 0.8, outerBot * 0.8]) {
      const line = offsetPolyline(pts, off);
      out.strip('struct', line.map((p, i) => P3(p, z[i] - 0.2)), line.map((p, i) => P3(p, z[i] - 2.0)), tint);
    }
    const soffitL = offsetPolyline(pts, outerTop * 0.8);
    const soffitR = offsetPolyline(pts, outerBot * 0.8);
    out.strip('struct', soffitL.map((p, i) => P3(p, z[i] - 2.0)), soffitR.map((p, i) => P3(p, z[i] - 2.0)), tint);
    drawPiers(out, info, 26, Math.max(1.4, (outerTop - outerBot) * 0.15));
  } else if (kind === 'arch') {
    // Steel arch: two ribs rising in a sine curve; hangers down to the deck.
    const H = Math.min(18, total * 0.28);
    const ribs = [outerTop * 0.7, outerBot * 0.7];
    for (const off of ribs) {
      const line = offsetPolyline(pts, off);
      const archTop = pts.map((_, i) => {
        const u = arc[i] / total;
        return z[i] + (H * Math.sin(Math.PI * Math.min(1, Math.max(0, u)))) + 0.9;
      });
      const archBot = archTop.map((h) => h - 1.6);
      out.strip('struct', line.map((p, i) => P3(p, archTop[i])), line.map((p, i) => P3(p, archBot[i])), tint);
      for (let i = 0; i < pts.length; i += Math.max(1, Math.round(4 / 3))) {
        const u = arc[i] / total;
        if (u < 0.05 || u > 0.95) continue;
        out.beam('cable', P3(line[i], z[i] + 1.1), P3(line[i], archBot[i]), 0.05, tint);
      }
    }
    drawPiers(out, info, 40, 1.2);
  } else {
    // Cable-stayed: two pylons with fan cables to the deck.
    const H = Math.min(34, total * 0.45);
    const pylonAt = [0.3, 0.7];
    const deckLine = offsetPolyline(pts, outerTop * 0.6);
    for (const u of pylonAt) {
      const target = u * total;
      let i = 0;
      while (i < arc.length - 1 && arc[i] < target) i++;
      const pylonBase = P3(pts[i], z[i]);
      for (const side of [1, -1]) {
        const lateral = vperp(vnorm(vsub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])));
        const top = [pts[i][0] + lateral[0] * side * outerTop * 0.6, z[i] + H, pts[i][1] + lateral[1] * side * outerTop * 0.6];
        out.beam('struct', [pylonBase[0] + lateral[0] * side * outerTop * 0.6, pylonBase[1], pylonBase[2] + lateral[1] * side * outerTop * 0.6], top, 0.45, tint);
        // Stay cables fanning to the deck.
        for (let k = 1; k <= 8; k++) {
          const j = Math.max(0, Math.min(pts.length - 1, i + k * 4 * (k % 2 ? 1 : -1)));
          const deckPt = P3(deckLine[j], z[j] + 0.4);
          out.beam('cable', top, deckPt, 0.05, tint);
        }
      }
    }
    drawPiers(out, info, 36, 1.4);
  }
}

function drawPiers(out, info, spacing, radius) {
  const { pts, z, arc, tint } = info;
  const total = arc[arc.length - 1];
  for (let s = spacing / 2; s < total; s += spacing) {
    let i = 0;
    while (i < arc.length - 1 && arc[i] < s) i++;
    if (z[i] < 3) continue;
    out.cylinder('pier', [pts[i][0], 0, pts[i][1]], radius, z[i] - 1.6, 10, tint);
  }
}

function drawTunnel(out, info) {
  // Tunnel shell (half-tube) at tunnel depth, drawn translucent.
  const { pts, z, tint } = info;
  const R = 4.2;
  const segs = 10;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = vnorm(vsub(pts[i + 1], pts[i]));
    const nrm = vperp(d);
    for (let k = 0; k < segs; k++) {
      const a0 = Math.PI * (k / segs), a1 = Math.PI * ((k + 1) / segs);
      const ring = (p, zc, a) => [
        p[0] + nrm[0] * Math.cos(a) * R,
        zc + Math.sin(a) * R,
        p[1] + nrm[1] * Math.cos(a) * R,
      ];
      const A0 = ring(pts[i], z[i], a0), A1 = ring(pts[i], z[i], a1);
      const B0 = ring(pts[i + 1], z[i + 1], a0), B1 = ring(pts[i + 1], z[i + 1], a1);
      out.quad('tunnel', A0, A1, B1, B0, undefined, tint);
    }
  }
}
