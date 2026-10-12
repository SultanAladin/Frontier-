// Pure 2D geometry + planar road-graph construction.
// No three.js imports: everything here is unit-testable under `node --test`.
//
// Topology rules implemented here (no boolean operations):
//  * Every crossing between two roads on the SAME layer is cut into both
//    polylines and becomes a single shared graph node (+ shape, T, Y, or X).
//  * Endpoints lying on another road (T-junction) are snapped onto it.
//  * Roads on DIFFERENT layers (bridge / surface / subway) are never merged:
//    they pass over or under each other, exactly like a real grade separation.
//  * Overlapping collinear roads are reported by validateTopology() instead of
//    being silently kept twice.

export const EPS = 1e-9;

// ---------------------------------------------------------------- randomness
// Mulberry32: small, fast, deterministic. Every road gets its own seed so that
// generated cities never repeat the same road twice.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- vectors
export const v2 = (x, y) => [x, y];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const vscale = (a, s) => [a[0] * s, a[1] * s];
export const vlen = (a) => Math.hypot(a[0], a[1]);
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const vcross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function vnorm(a) {
  const l = vlen(a);
  return l > EPS ? [a[0] / l, a[1] / l] : [0, 0];
}
// Left-hand normal (counter-clockwise rotation by 90 degrees).
export const vperp = (a) => [-a[1], a[0]];
const clamp01 = (t) => Math.min(1, Math.max(0, t));

// ---------------------------------------------------------------- curves
// Centripetal-ish Catmull-Rom through control points, returning dense 2D points.
export function catmullRom(points, samplesPerSegment = 12) {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += vdist(pts[i - 1], pts[i]);
  return L;
}

// Resample a polyline so consecutive points are about `step` apart (keeps ends).
export function resampleByLength(pts, step) {
  if (pts.length < 2) return pts.slice();
  const total = polylineLength(pts);
  const count = Math.max(1, Math.round(total / step));
  const out = [pts[0]];
  let seg = 0;
  let segStart = 0;
  for (let k = 1; k < count; k++) {
    const target = (total * k) / count;
    while (seg < pts.length - 2 && segStart + vdist(pts[seg], pts[seg + 1]) < target) {
      segStart += vdist(pts[seg], pts[seg + 1]);
      seg++;
    }
    const sl = vdist(pts[seg], pts[seg + 1]) || 1;
    const t = clamp01((target - segStart) / sl);
    out.push([
      pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t,
    ]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Cumulative arc length at each vertex.
export function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + vdist(pts[i - 1], pts[i]));
  return s;
}

// Miter-joined offset polyline. `d` > 0 goes to the left of travel direction.
export function offsetPolyline(pts, d) {
  const n = pts.length;
  if (n < 2) return pts.map((p) => [p[0], p[1]]);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? vnorm(vsub(pts[i], pts[i - 1])) : null;
    const next = i < n - 1 ? vnorm(vsub(pts[i + 1], pts[i])) : null;
    let nrm;
    let miter = 1;
    if (prev && next) {
      const n1 = vperp(prev);
      const n2 = vperp(next);
      nrm = vnorm(vadd(n1, n2));
      const c = Math.max(0.5, vdot(nrm, n1)); // cos of half the turn angle
      miter = Math.min(2.5, 1 / c);
    } else {
      nrm = vperp(prev || next);
    }
    out[i] = [pts[i][0] + nrm[0] * d * miter, pts[i][1] + nrm[1] * d * miter];
  }
  return out;
}

// ---------------------------------------------------------------- intersections
// Intersection of segments pq and rs. Returns {t,u,point} or null.
// Parallel / collinear pairs are reported separately by overlapInfo().
export function segIntersection(p, q, r, s) {
  const d1 = vsub(q, p);
  const d2 = vsub(s, r);
  const den = vcross(d1, d2);
  const scale = (vlen(d1) * vlen(d2)) || 1;
  if (Math.abs(den) < 1e-12 * scale) return null;
  const w = vsub(r, p);
  const t = vcross(w, d2) / den;
  const u = vcross(w, d1) / den;
  const tol = 1e-9;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  const tc = clamp01(t);
  return { t: tc, u: clamp01(u), point: [p[0] + d1[0] * tc, p[1] + d1[1] * tc] };
}

export function pointSegmentDistance(p, a, b) {
  const ab = vsub(b, a);
  const l2 = vdot(ab, ab);
  const t = l2 < EPS ? 0 : clamp01(vdot(vsub(p, a), ab) / l2);
  return { dist: vdist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]), t };
}

// Minimum distance between two segments (0 when they intersect).
export function segmentDistance(p, q, r, s) {
  if (segIntersection(p, q, r, s)) return 0;
  return Math.min(
    pointSegmentDistance(p, r, s).dist,
    pointSegmentDistance(q, r, s).dist,
    pointSegmentDistance(r, p, q).dist,
    pointSegmentDistance(s, p, q).dist,
  );
}

// Collinear overlap length of two nearly parallel segments (0 if none).
export function overlapInfo(p, q, r, s, tol = 0.35) {
  const d1 = vnorm(vsub(q, p));
  const dirAngleSin = Math.abs(vcross(d1, vnorm(vsub(s, r))));
  if (dirAngleSin > 0.02) return 0;
  // distance of r and s from the infinite line pq
  const dr = Math.abs(vcross(d1, vsub(r, p)));
  const ds = Math.abs(vcross(d1, vsub(s, p)));
  if (dr > tol || ds > tol) return 0;
  const L = vlen(vsub(q, p));
  const a0 = 0;
  const a1 = L;
  const b0 = vdot(vsub(r, p), d1);
  const b1 = vdot(vsub(s, p), d1);
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, hi - lo);
}

// ---------------------------------------------------------------- planarization
// roads: [{ id, layer, points:[[x,y],...], ...meta }]
// Returns { nodes, edges, warnings }.
// Across layers, vertices merge only when a road END lands on the other road (ramp / portal).
//   nodes: junctions only (crossings, T/Y joins, road ends). Plain curve vertices
//          are interior geometry of an edge, not graph nodes.
//   edges: { id, roadId, layer, a, b, points:[[x,y]...] } with road metadata.
export function planarize(roads, { snap = 0.35 } = {}) {
  const warnings = [];
  const clean = roads
    .map((r) => ({ ...r, points: dedupePoints(r.points, snap * 0.5) }))
    .filter((r) => r.points.length >= 2);

  // cuts[r][s] = [{t, point}] inserted into segment s of road r
  const cuts = clean.map((r) => Array.from({ length: r.points.length - 1 }, () => []));
  const addCut = (ri, si, t, point) => {
    if (t <= 1e-6 || t >= 1 - 1e-6) return; // hits at vertices need no cut
    cuts[ri][si].push({ t, point });
  };

  // Spatial index of every segment (grid of CELL metres) so large maps stay fast.
  const CELL = 40;
  const index = new Map();
  const cellKey = (cx, cy) => `${cx},${cy}`;
  const forCells = (x0, y0, x1, y1, fn) => {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) fn(cellKey(cx, cy));
    }
  };
  clean.forEach((r, ri) => {
    for (let si = 0; si < r.points.length - 1; si++) {
      const p = r.points[si], q = r.points[si + 1];
      const ref = { ri, si };
      forCells(Math.min(p[0], q[0]) - snap, Math.min(p[1], q[1]) - snap,
        Math.max(p[0], q[0]) + snap, Math.max(p[1], q[1]) + snap, (k) => {
          if (!index.has(k)) index.set(k, []);
          index.get(k).push(ref);
        });
    }
  });

  // Crossings between segments of roads on the same layer (and self-crossings).
  const tested = new Set();
  for (const bucket of index.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const A = bucket[a], B = bucket[b];
        if (A.ri === B.ri && Math.abs(A.si - B.si) < 2) continue; // neighbours share a vertex
        if (clean[A.ri].layer !== clean[B.ri].layer) continue; // grade-separated
        const key = A.ri < B.ri || (A.ri === B.ri && A.si < B.si)
          ? `${A.ri}:${A.si}|${B.ri}:${B.si}` : `${B.ri}:${B.si}|${A.ri}:${A.si}`;
        if (tested.has(key)) continue;
        tested.add(key);
        const P = clean[A.ri].points, Q = clean[B.ri].points;
        const hit = segIntersection(P[A.si], P[A.si + 1], Q[B.si], Q[B.si + 1]);
        if (hit) {
          addCut(A.ri, A.si, hit.t, hit.point);
          addCut(B.ri, B.si, hit.u, hit.point);
        }
      }
    }
  }

  // T-junctions: a road end lying within `snap` of another road's segment is snapped on.
  clean.forEach((R, ri) => {
    const ends = [0, R.points.length - 1];
    for (const e of ends) {
      const endPt = R.points[e];
      let best = null;
      forCells(endPt[0] - snap, endPt[1] - snap, endPt[0] + snap, endPt[1] + snap, (k) => {
        for (const ref of index.get(k) || []) {
          if (ref.ri === ri || clean[ref.ri].layer !== R.layer) continue;
          const tg = clean[ref.ri].points;
          const pd = pointSegmentDistance(endPt, tg[ref.si], tg[ref.si + 1]);
          if (pd.dist <= snap && pd.t > 1e-6 && pd.t < 1 - 1e-6 && (!best || pd.dist < best.dist)) {
            best = { ...pd, ref };
          }
        }
      });
      if (best) {
        const tg = clean[best.ref.ri].points;
        const a0 = tg[best.ref.si], a1 = tg[best.ref.si + 1];
        const projected = [a0[0] + (a1[0] - a0[0]) * best.t, a0[1] + (a1[1] - a0[1]) * best.t];
        cuts[best.ref.ri][best.ref.si].push({ t: best.t, point: projected });
      }
    }
  });

  // Split vertex list per road (original + inserted cut points, in order).
  const split = clean.map((r, i) => {
    const out = [];
    const last = r.points.length - 1;
    for (let s = 0; s < last; s++) {
      out.push({ p: r.points[s], ri: i, end: s === 0, k: out.length });
      const list = cuts[i][s].slice().sort((x, y) => x.t - y.t);
      for (const c of list) out.push({ p: c.point, ri: i, end: false, k: out.length });
    }
    out.push({ p: r.points[last], ri: i, end: true, k: out.length });
    return out;
  });

  // Cluster coincident vertices (same layer, or endpoint-to-endpoint across layers).
  const verts = [];
  split.forEach((list) => list.forEach((v) => {
    v.idx = verts.length;
    verts.push(v);
  }));
  const parent = verts.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const cell = snap * 2;
  const grid = new Map();
  for (const v of verts) {
    const cx = Math.floor(v.p[0] / cell), cy = Math.floor(v.p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const o of bucket) {
        if (vdist(o.p, v.p) > snap) continue;
        // Same road: only merge genuinely separate passes (a self-crossing), not neighbours.
        if (o.ri === v.ri && Math.abs(o.k - v.k) <= 2) continue;
        const sameLayer = clean[o.ri].layer === clean[v.ri].layer;
        // Across layers a ramp/portal joins only where a road END lands on another road.
        if (sameLayer || o.end || v.end) {
          const ra = find(o.idx), rb = find(v.idx);
          if (ra !== rb) parent[rb] = ra;
        }
      }
    }
    const k = cellKey(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(v);
  }

  // Group members per cluster.
  const clusters = new Map();
  for (const v of verts) {
    const root = find(v.idx);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(v);
  }

  // A cluster is a junction if it joins 2+ vertices (from roads or self-crossings)
  // or if any member is a road endpoint. Everything else is edge interior.
  const nodes = [];
  const nodeOfVert = new Array(verts.length).fill(-1);
  for (const members of clusters.values()) {
    const isJunction = members.length >= 2 || members.some((m) => m.end);
    if (!isJunction) continue;
    const id = nodes.length;
    const x = members.reduce((s, m) => s + m.p[0], 0) / members.length;
    const y = members.reduce((s, m) => s + m.p[1], 0) / members.length;
    const layers = [...new Set(members.map((m) => clean[m.ri].layer))];
    nodes.push({ id, x, y, layers, degreeHint: members.length });
    for (const m of members) nodeOfVert[m.idx] = id;
  }

  // Walk each road: a span runs between consecutive junction vertices.
  const edges = [];
  const seen = new Map();
  split.forEach((list, ri) => {
    const road = clean[ri];
    let spanStart = -1;
    let interior = [];
    for (let k = 0; k < list.length; k++) {
      const node = nodeOfVert[list[k].idx];
      if (node < 0) {
        if (spanStart >= 0) interior.push(list[k].p);
        continue;
      }
      if (spanStart >= 0) {
        const a = nodeOfVert[list[spanStart].idx];
        const b = node;
        if (a !== b) {
          const key = a < b ? `${a}|${b}|${road.layer}` : `${b}|${a}|${road.layer}`;
          const pts = dedupePoints([[nodes[a].x, nodes[a].y], ...interior, [nodes[b].x, nodes[b].y]], 1e-6);
          if (seen.has(key)) {
            warnings.push({
              type: 'duplicate',
              message: `Road ${road.id} runs over an existing road between the same two junctions (merged, not duplicated).`,
              roads: [road.id, seen.get(key)],
            });
          } else {
            seen.set(key, road.id);
            const { points: _roadPoints, ...meta } = road;
            edges.push({ ...meta, id: edges.length, roadId: road.id, a, b, layer: road.layer, points: pts });
          }
        }
      }
      spanStart = k;
      interior = [];
    }
  });

  // Edges touching only interior nodes of degree 2 keep their junction node; that is
  // intentional (a bend/joint). Nodes that end up with no edges are dropped.
  const used = new Set();
  for (const e of edges) { used.add(e.a); used.add(e.b); }
  const remap = new Map();
  const finalNodes = nodes.filter((n) => used.has(n.id)).map((n, i) => { remap.set(n.id, i); return { ...n, id: i }; });
  const finalEdges = edges.map((e, i) => ({ ...e, id: i, a: remap.get(e.a), b: remap.get(e.b) }));
  return { nodes: finalNodes, edges: finalEdges, warnings };
}

export function dedupePoints(pts, tol) {
  const out = [];
  for (const p of pts) {
    if (!out.length || vdist(out[out.length - 1], p) > tol) out.push([p[0], p[1]]);
  }
  return out;
}

function bboxOverlap(a, b, pad) {
  const bb = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };
  const A = bb(a), B = bb(b);
  return A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3];
}

// ---------------------------------------------------------------- validation
// Verifies the planar-graph invariants that the user asked for:
//  * no two edges of the same layer cross without sharing a node
//  * no collinear overlaps between edges on the same layer
export function validateTopology(graph) {
  const problems = [];
  const byLayer = new Map();
  for (const e of graph.edges) {
    if (!byLayer.has(e.layer)) byLayer.set(e.layer, []);
    byLayer.get(e.layer).push(e);
  }
  for (const [layer, list] of byLayer) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        const shared = A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b;
        for (let a = 0; a < A.points.length - 1; a++) {
          for (let b = 0; b < B.points.length - 1; b++) {
            const p = A.points[a], q = A.points[a + 1], r = B.points[b], s = B.points[b + 1];
            const ov = overlapInfo(p, q, r, s);
            if (ov > 0.5) {
              problems.push({ type: 'overlap', layer, edges: [A.id, B.id], length: ov, at: p });
              continue;
            }
            if (shared) {
              // Sharing a node is fine; we only care about crossings elsewhere.
              continue;
            }
            const d = segmentDistance(p, q, r, s);
            if (d < 0.05) {
              problems.push({ type: 'unmerged-crossing', layer, edges: [A.id, B.id], at: segIntersection(p, q, r, s)?.point ?? p });
            }
          }
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
