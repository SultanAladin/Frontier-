// Road network topology: nodes, roads (edges between nodes) and props.
//
// A road is an edge a -> b with optional via points. Crossings between roads at
// the same height become junction nodes (both roads are split there). Crossings
// between roads whose heights differ by more than Y_MATCH are grade-separated:
// they pass over/under each other with no junction. This keeps the graph clean
// without hand-authored intersections.
//
// Everything here is plain data + pure functions over the network object, so it
// runs in Node for tests. Rendering lives in road-geometry.js.

export const FORMAT = 'frontier.road-network';
export const FORMAT_VERSION = 1;
export const SNAP_NODE = 2.0; // metres: merge with an existing node (no sliver edges below this)
export const SNAP_END = 2.5; // metres: endpoint snaps onto a node or road
export const Y_MATCH = 0.3; // metres: roads closer in height than this join at a junction
const CELL = 100;
const STEP = 2.0; // dense sampling step along curves

const denseCache = new WeakMap(); // edge object -> dense curve
const indexCache = new WeakMap(); // network object -> segment index

export function createNetwork({ seed = 0, meta = {} } = {}) {
  return { format: FORMAT, version: FORMAT_VERSION, units: 'm', seed, meta, nextId: 1, nodes: {}, edges: {}, props: {} };
}

function newId(net, prefix) {
  const id = `${prefix}${net.nextId}`;
  net.nextId += 1;
  return id;
}

export function cloneNetwork(net) {
  return JSON.parse(JSON.stringify(net));
}

const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

// ---------------------------------------------------------------- index ------

class SegIndex {
  constructor() {
    this.cells = new Map();
    this.keys = new Map();
  }

  static cellKey(ix, iz) {
    return (ix + 1000000) * 2000003 + (iz + 1000000);
  }

  insert(id, C) {
    this.remove(id);
    const keys = new Set();
    for (let k = 0; k < C.length - 1; k += 1) {
      const a = C[k];
      const b = C[k + 1];
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL);
      const x1 = Math.floor(Math.max(a.x, b.x) / CELL);
      const z0 = Math.floor(Math.min(a.z, b.z) / CELL);
      const z1 = Math.floor(Math.max(a.z, b.z) / CELL);
      for (let ix = x0; ix <= x1; ix += 1) {
        for (let iz = z0; iz <= z1; iz += 1) {
          const key = SegIndex.cellKey(ix, iz);
          let cell = this.cells.get(key);
          if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
          }
          cell.add(id);
          keys.add(key);
        }
      }
    }
    this.keys.set(id, [...keys]);
  }

  remove(id) {
    const keys = this.keys.get(id);
    if (!keys) return;
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (cell) {
        cell.delete(id);
        if (cell.size === 0) this.cells.delete(key);
      }
    }
    this.keys.delete(id);
  }

  query(x0, z0, x1, z1) {
    const out = new Set();
    const ix0 = Math.floor(x0 / CELL);
    const ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL);
    const iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iz = iz0; iz <= iz1; iz += 1) {
        const cell = this.cells.get(SegIndex.cellKey(ix, iz));
        if (cell) for (const id of cell) out.add(id);
      }
    }
    return out;
  }
}

function indexOf(net) {
  let ix = indexCache.get(net);
  if (!ix) {
    ix = new SegIndex();
    indexCache.set(net, ix);
    for (const e of Object.values(net.edges)) ix.insert(e.id, ctrl(net, e));
  }
  return ix;
}

// Rebuild the spatial index from scratch (after bulk loads).
export function reindexAll(net) {
  indexCache.delete(net);
  return indexOf(net);
}

// ------------------------------------------------------------ geometry -------

// Control polyline of an edge: [node a, ...via points, node b].
export function ctrl(net, e) {
  const a = net.nodes[e.a];
  const b = net.nodes[e.b];
  const C = [{ x: a.x, y: a.y, z: a.z }];
  for (const p of e.pts) C.push({ x: p.x, y: p.y ?? 0, z: p.z });
  C.push({ x: b.x, y: b.y, z: b.z });
  return C;
}

// Centripetal Catmull-Rom point between p1 and p2 at u in [0,1].
function crPoint(p0, p1, p2, p3, u) {
  const d = (p, q) => Math.max(Math.sqrt(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)), 1e-3);
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const t = t1 + u * (t2 - t1);
  const lerp3 = (a, b, wa, wb) => ({ x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z });
  const A1 = lerp3(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
  const A2 = lerp3(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
  const A3 = lerp3(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
  const B1 = lerp3(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
  const B2 = lerp3(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
  return lerp3(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
}

// Dense sampled centreline of an edge, arc-length parameterised.
// Returns {x,y,z,s,seg,L}; seg[i] is the control segment index of sample i.
function wrapAngle(a) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
function turnAngle(p0, p1, p2, p3) {
  const a0 = Math.atan2(p1.z - p0.z, p1.x - p0.x);
  const a1 = Math.atan2(p2.z - p1.z, p2.x - p1.x);
  const a2 = Math.atan2(p3.z - p2.z, p3.x - p2.x);
  return Math.abs(wrapAngle(a1 - a0)) + Math.abs(wrapAngle(a2 - a1));
}
export function dense(net, e) {
  const hit = denseCache.get(e);
  if (hit) return hit;
  const C = ctrl(net, e);
  const m = C.length;
  const X = [];
  const Y = [];
  const Z = [];
  const SEG = [];
  for (let k = 0; k < m - 1; k += 1) {
    const p1 = C[k];
    const p2 = C[k + 1];
    const p0 = k > 0 ? C[k - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z };
    const p3 = k + 2 < m ? C[k + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z };
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    // Adaptive sampling: straight runs need few samples; bends are sampled so the
    // chord error stays near 2 cm (sagitta ~ len * turn / (8 n^2)).
    const turn = turnAngle(p0, p1, p2, p3);
    const need = Math.max(Math.ceil(len / 16), Math.ceil(Math.sqrt((len * turn) / 0.16)));
    const n = m === 2 ? Math.max(1, Math.ceil(len / 16)) : Math.max(1, Math.min(600, Math.ceil(len / STEP), need));
    for (let j = 0; j < n; j += 1) {
      const u = j / n;
      const q = m === 2
        ? { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u, z: p1.z + (p2.z - p1.z) * u }
        : crPoint(p0, p1, p2, p3, u);
      X.push(q.x);
      Y.push(q.y);
      Z.push(q.z);
      SEG.push(k);
    }
  }
  X.push(C[m - 1].x);
  Y.push(C[m - 1].y);
  Z.push(C[m - 1].z);
  SEG.push(m - 2);
  const S = new Float64Array(X.length);
  for (let i = 1; i < X.length; i += 1) {
    S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1], Z[i] - Z[i - 1]);
  }
  const D = {
    x: Float64Array.from(X), y: Float64Array.from(Y), z: Float64Array.from(Z),
    s: S, seg: Int32Array.from(SEG), L: S[S.length - 1],
  };
  denseCache.set(e, D);
  return D;
}

export function edgeLength(net, e) {
  return dense(net, e).L;
}

// Frame at arc length s: position, height, unit tangent and left normal (xz).
export function frameAt(D, s) {
  const S = D.s;
  const n = S.length;
  const sc = Math.min(Math.max(s, 0), D.L);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= sc) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const i1 = Math.min(i + 1, n - 1);
  const span = S[i1] - S[i];
  const u = span > 1e-9 ? (sc - S[i]) / span : 0;
  const x = D.x[i] + (D.x[i1] - D.x[i]) * u;
  const y = D.y[i] + (D.y[i1] - D.y[i]) * u;
  const z = D.z[i] + (D.z[i1] - D.z[i]) * u;
  let dx = D.x[i1] - D.x[i];
  let dz = D.z[i1] - D.z[i];
  let len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    // Vertical or duplicate sample: borrow the neighbouring direction.
    const j = Math.max(i - 1, 0);
    dx = D.x[i1] - D.x[j];
    dz = D.z[i1] - D.z[j];
    len = Math.hypot(dx, dz) || 1;
  }
  const tx = dx / len;
  const tz = dz / len;
  return { s: sc, x, y, z, tx, tz, nx: tz, nz: -tx };
}

// Nearest point on a control polyline to (px,pz).
export function projectToCtrl(C, px, pz) {
  let best = { d2: Infinity };
  for (let k = 0; k < C.length - 1; k += 1) {
    const a = C[k];
    const b = C[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const L2 = dx * dx + dz * dz;
    let u = L2 > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / L2 : 0;
    u = Math.min(Math.max(u, 0), 1);
    const x = a.x + dx * u;
    const z = a.z + dz * u;
    const d2 = dist2(px, pz, x, z);
    if (d2 < best.d2) {
      best = { d2, k, u, x, z, y: a.y + (b.y - a.y) * u };
    }
  }
  best.isEnd = best.k === 0 && best.u <= 1e-6 || best.k === C.length - 2 && best.u >= 1 - 1e-6;
  return best;
}

// Arc length on the dense curve nearest to (x,z).
export function denseArcAt(D, x, z) {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < D.x.length; i += 1) {
    const d = dist2(x, z, D.x[i], D.z[i]);
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return D.s[bi];
}

// ---------------------------------------------------------- intersections -----

// Proper 2D intersection of segments AB and CD. Returns parameters or null.
function segInt(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax;
  const r1z = bz - az;
  const r2x = dx - cx;
  const r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = cx - ax;
  const qpz = cz - az;
  const u = (qpx * r2z - qpz * r2x) / den;
  const t = (qpx * r1z - qpz * r1x) / den;
  const eps = 1e-7;
  if (u <= eps || u >= 1 - eps || t < -eps || t > 1 + eps) return null;
  return { u, t: Math.min(Math.max(t, 0), 1) };
}

// ---------------------------------------------------------------- nodes -------

export function addNode(net, x, y, z) {
  const id = newId(net, 'n');
  net.nodes[id] = { id, x, y, z };
  return id;
}

export function nearestNode(net, x, z, tol) {
  let best = null;
  let bestD = tol * tol;
  for (const n of Object.values(net.nodes)) {
    const d = dist2(x, z, n.x, n.z);
    if (d <= bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

export function degrees(net) {
  const deg = new Map();
  for (const id of Object.keys(net.nodes)) deg.set(id, 0);
  for (const e of Object.values(net.edges)) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  return deg;
}

export function incidentEdges(net, nodeId) {
  return Object.values(net.edges).filter((e) => e.a === nodeId || e.b === nodeId).map((e) => e.id);
}

// Split edge eid at existing node nid, which must lie on the interior of the edge.
export function splitEdge(net, eid, nid) {
  const e = net.edges[eid];
  if (!e || e.a === nid || e.b === nid) return null;
  const N = net.nodes[nid];
  const C = ctrl(net, e);
  const pr = projectToCtrl(C, N.x, N.z);
  if (pr.isEnd) return null;
  const D = dense(net, e);
  const sN = denseArcAt(D, N.x, N.z);
  let left = C.slice(1, pr.k + 1);
  let right = C.slice(pr.k + 1, C.length - 1);
  if (pr.k > 0 && dist2(N.x, N.z, C[pr.k].x, C[pr.k].z) < 0.0025) left = C.slice(1, pr.k);
  if (dist2(N.x, N.z, C[pr.k + 1].x, C[pr.k + 1].z) < 0.0025) right = C.slice(pr.k + 2, C.length - 1);
  const e2id = newId(net, 'e');
  const e1 = { ...e, b: nid, pts: left.map((p) => ({ x: p.x, y: p.y, z: p.z })) };
  const e2 = { ...e, id: e2id, a: nid, pts: right.map((p) => ({ x: p.x, y: p.y, z: p.z })) };
  for (const p of Object.values(net.props)) {
    if (p.edge !== eid) continue;
    const len = p.len ?? 0;
    if (p.s + len <= sN + 1e-6) continue;
    if (p.s >= sN) {
      p.edge = e2id;
      p.s -= sN;
    } else {
      const q = { ...p, id: newId(net, 'p'), edge: e2id, s: 0, len: p.s + len - sN };
      p.len = sN - p.s;
      net.props[q.id] = q;
    }
  }
  net.edges[eid] = e1;
  net.edges[e2id] = e2;
  const ix = indexOf(net);
  ix.insert(eid, ctrl(net, e1));
  ix.insert(e2id, ctrl(net, e2));
  return e2id;
}

// Return a node at p (merging with a node within SNAP_NODE) and split any road
// passing through it, so that the result is a true junction.
export function ensureNodeAt(net, p, tol = SNAP_NODE) {
  let nid = nearestNode(net, p.x, p.z, tol);
  if (!nid) nid = addNode(net, p.x, p.y, p.z);
  const N = net.nodes[nid];
  const ix = indexOf(net);
  for (const eid of [...ix.query(N.x - tol - 0.5, N.z - tol - 0.5, N.x + tol + 0.5, N.z + tol + 0.5)]) {
    const e = net.edges[eid];
    if (!e || e.a === nid || e.b === nid) continue;
    const pr = projectToCtrl(ctrl(net, e), N.x, N.z);
    if (pr.d2 > tol * tol || pr.isEnd) continue;
    splitEdge(net, eid, nid);
  }
  return nid;
}

function resolveEndpoint(net, p) {
  const near = nearestNode(net, p.x, p.z, SNAP_END);
  if (near && Math.abs(net.nodes[near].y - p.y) < Y_MATCH) return near;
  const ix = indexOf(net);
  let best = null;
  for (const eid of ix.query(p.x - SNAP_END, p.z - SNAP_END, p.x + SNAP_END, p.z + SNAP_END)) {
    const e = net.edges[eid];
    if (!e) continue;
    const pr = projectToCtrl(ctrl(net, e), p.x, p.z);
    if (pr.d2 > SNAP_END * SNAP_END || pr.isEnd || Math.abs(pr.y - p.y) >= Y_MATCH) continue;
    if (!best || pr.d2 < best.d2) best = pr;
  }
  if (best) return ensureNodeAt(net, { x: best.x, y: best.y, z: best.z });
  return addNode(net, p.x, p.y, p.z);
}

// ---------------------------------------------------------------- edges -------

function cleanPoint(p) {
  return { x: p.x, y: Number.isFinite(p.y) ? p.y : 0, z: p.z };
}

export function addEdge(net, a, b, pts, meta) {
  const id = newId(net, 'e');
  const e = { id, a, b, pts: pts.map(cleanPoint), preset: meta.preset };
  if (meta.name) e.name = meta.name;
  if (meta.lanes) e.lanes = meta.lanes.map((l) => [...l]);
  if (meta.speed) e.speed = meta.speed;
  if (meta.center) e.center = meta.center;
  net.edges[id] = e;
  indexOf(net).insert(id, ctrl(net, e));
  return id;
}

export function updateEdge(net, id, patch) {
  const e = net.edges[id];
  if (!e) return;
  net.edges[id] = { ...e, ...patch };
  indexOf(net).insert(id, ctrl(net, net.edges[id]));
}

export function removeEdge(net, id) {
  const e = net.edges[id];
  if (!e) return;
  delete net.edges[id];
  indexOf(net).remove(id);
  for (const p of Object.values(net.props)) if (p.edge === id) delete net.props[p.id];
  const deg = degrees(net);
  for (const nodeId of [e.a, e.b]) {
    if ((deg.get(nodeId) ?? 0) === 0 && net.nodes[nodeId]) delete net.nodes[nodeId];
  }
}

// Move a node in plan and re-index the roads attached to it.
export function moveNode(net, id, x, z) {
  const n = net.nodes[id];
  if (!n) return;
  n.x = x;
  n.z = z;
  refreshIncident(net, id);
}

export function setNodeHeight(net, id, y) {
  const n = net.nodes[id];
  if (!n) return;
  n.y = y;
  refreshIncident(net, id);
}

function refreshIncident(net, id) {
  const ix = indexOf(net);
  for (const eid of incidentEdges(net, id)) {
    net.edges[eid] = { ...net.edges[eid] };
    ix.insert(eid, ctrl(net, net.edges[eid]));
  }
}

// Set a road's deck height: via points and its end nodes move to y.
export function setRoadHeight(net, eid, y) {
  const e = net.edges[eid];
  if (!e) return;
  net.edges[eid] = { ...e, pts: e.pts.map((p) => ({ ...p, y })) };
  setNodeHeight(net, e.a, y);
  setNodeHeight(net, e.b, y);
  indexOf(net).insert(eid, ctrl(net, net.edges[eid]));
}

// Insert a polyline as one or more roads, creating junctions at every crossing.
//   pts: [{x,y,z}] ordered; opts: {preset, name, lanes, speed, center, closed}.
// Returns the ids of the new edges.
export function addRoad(net, input, opts) {
  let P = [];
  for (const p of input) {
    const q = cleanPoint(p);
    if (!P.length || dist2(P[P.length - 1].x, P[P.length - 1].z, q.x, q.z) > 0.0625) P.push(q);
  }
  if (opts.closed && P.length >= 3) {
    if (dist2(P[0].x, P[0].z, P[P.length - 1].x, P[P.length - 1].z) > 0.0625) P.push({ ...P[0] });
    else P[P.length - 1] = { ...P[0] };
  }
  if (P.length < 2) return [];
  const ix = indexOf(net);

  // 1. Crossings with existing roads, computed on the untouched network.
  const hits = [];
  for (let i = 0; i < P.length - 1; i += 1) {
    const A = P[i];
    const B = P[i + 1];
    const cand = ix.query(Math.min(A.x, B.x) - 0.5, Math.min(A.z, B.z) - 0.5, Math.max(A.x, B.x) + 0.5, Math.max(A.z, B.z) + 0.5);
    for (const eid of cand) {
      const e = net.edges[eid];
      if (!e) continue;
      const C = ctrl(net, e);
      for (let k = 0; k < C.length - 1; k += 1) {
        const r = segInt(A.x, A.z, B.x, B.z, C[k].x, C[k].z, C[k + 1].x, C[k + 1].z);
        if (!r) continue;
        const y = A.y + (B.y - A.y) * r.u;
        const yE = C[k].y + (C[k + 1].y - C[k].y) * r.t;
        if (Math.abs(y - yE) >= Y_MATCH) continue;
        hits.push({
          key: i + r.u, x: A.x + (B.x - A.x) * r.u, z: A.z + (B.z - A.z) * r.u, y, vertex: null,
        });
      }
    }
  }
  // Interior vertices of the new road lying on an existing road.
  for (let i = 1; i < P.length - 1; i += 1) {
    const V = P[i];
    for (const eid of ix.query(V.x - SNAP_END, V.z - SNAP_END, V.x + SNAP_END, V.z + SNAP_END)) {
      const e = net.edges[eid];
      if (!e) continue;
      const pr = projectToCtrl(ctrl(net, e), V.x, V.z);
      if (pr.d2 > SNAP_END * SNAP_END || pr.isEnd || Math.abs(pr.y - V.y) >= Y_MATCH) continue;
      hits.push({ key: i, x: pr.x, z: pr.z, y: pr.y, vertex: i });
    }
  }
  hits.sort((p, q) => p.key - q.key);
  const unique = [];
  for (const h of hits) {
    const prev = unique[unique.length - 1];
    if (prev && dist2(prev.x, prev.z, h.x, h.z) < 0.25) {
      if (h.vertex !== null) unique[unique.length - 1] = h;
      continue;
    }
    unique.push(h);
  }

  // 2. Endpoints, then crossing nodes (which split the roads they hit).
  const startN = resolveEndpoint(net, P[0]);
  const endN = opts.closed ? startN : resolveEndpoint(net, P[P.length - 1]);
  const vertexNode = new Map();
  for (const h of unique) h.nid = ensureNodeAt(net, h);
  for (const h of unique) if (h.vertex !== null) vertexNode.set(h.vertex, h.nid);

  // 3. Walk the polyline, emitting one road per run between nodes.
  const markers = [{ key: 0, nid: startN }];
  for (let i = 1; i < P.length - 1; i += 1) {
    if (vertexNode.has(i)) markers.push({ key: i, nid: vertexNode.get(i) });
    else markers.push({ key: i, pt: P[i] });
  }
  markers.push({ key: P.length - 1, nid: endN });
  for (const h of unique) if (h.vertex === null) markers.push({ key: h.key, nid: h.nid });
  markers.sort((p, q) => p.key - q.key);

  const created = [];
  let cur = null;
  let pts = [];
  const flush = (nextNode) => {
    if (cur === null) return;
    if (cur === nextNode && pts.length === 0) return;
    let prev = net.nodes[cur];
    let L = 0;
    for (const p of pts) {
      L += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    L += Math.hypot(net.nodes[nextNode].x - prev.x, net.nodes[nextNode].z - prev.z);
    if (L < 0.5) return;
    created.push(addEdge(net, cur, nextNode, pts, opts));
  };
  for (const m of markers) {
    if (m.nid !== undefined) {
      flush(m.nid);
      cur = m.nid;
      pts = [];
    } else {
      pts.push(m.pt);
    }
  }
  return created;
}

// --------------------------------------------------------------- props --------

export function addProp(net, prop) {
  const id = newId(net, 'p');
  net.props[id] = { ...prop, id };
  return id;
}

export function removeProp(net, id) {
  delete net.props[id];
}

export function propsOn(net, eid) {
  return Object.values(net.props).filter((p) => p.edge === eid).sort((a, b) => a.s - b.s);
}

// Remove and regenerate automatic props (rail crossings at rail/road junctions).
export function refreshAutoProps(net) {
  for (const p of Object.values(net.props)) if (p.auto) delete net.props[p.id];
  const deg = degrees(net);
  const railNodes = new Set();
  const roadArms = new Map();
  for (const e of Object.values(net.edges)) {
    const rail = /^(rail-mainline|subway)$/.test(e.preset);
    for (const end of ['a', 'b']) {
      const nodeId = e[end];
      if (rail) railNodes.add(nodeId);
      else {
        if (!roadArms.has(nodeId)) roadArms.set(nodeId, []);
        roadArms.get(nodeId).push({ e, end });
      }
    }
  }
  for (const nodeId of railNodes) {
    if ((deg.get(nodeId) ?? 0) < 3 || !roadArms.has(nodeId)) continue;
    if (net.nodes[nodeId].y < -0.5) continue;
    for (const { e, end } of roadArms.get(nodeId)) {
      const D = dense(net, e);
      const s = end === 'a' ? 6 : D.L - 6;
      if (s < 0 || s > D.L) continue;
      addProp(net, { type: 'railcrossing', edge: e.id, s, auto: true });
    }
  }
}

// -------------------------------------------------------- serialization -------

export function serialize(net) {
  return {
    format: net.format,
    version: net.version,
    units: net.units,
    seed: net.seed,
    meta: net.meta,
    nextId: net.nextId,
    nodes: net.nodes,
    edges: net.edges,
    props: net.props,
  };
}

export function deserialize(obj) {
  if (!obj || obj.format !== FORMAT) throw new Error('Not a Frontier road network file.');
  if (obj.version !== FORMAT_VERSION) throw new Error(`Unsupported road network version ${obj.version}.`);
  const net = createNetwork({ seed: obj.seed ?? 0, meta: obj.meta ?? {} });
  net.nodes = {};
  for (const [id, n] of Object.entries(obj.nodes ?? {})) {
    if ([n.x, n.y, n.z].every(Number.isFinite)) net.nodes[id] = { id, x: n.x, y: n.y, z: n.z };
  }
  net.edges = {};
  for (const [id, e] of Object.entries(obj.edges ?? {})) {
    if (!net.nodes[e.a] || !net.nodes[e.b]) continue;
    net.edges[id] = {
      id, a: e.a, b: e.b, pts: (e.pts ?? []).map(cleanPoint), preset: e.preset,
      ...(e.name ? { name: e.name } : {}), ...(e.lanes ? { lanes: e.lanes } : {}),
      ...(e.speed ? { speed: e.speed } : {}), ...(e.center ? { center: e.center } : {}),
    };
  }
  net.props = {};
  for (const [id, p] of Object.entries(obj.props ?? {})) {
    if (net.edges[p.edge] && Number.isFinite(p.s)) net.props[id] = { ...p, id };
  }
  let maxId = 0;
  for (const id of [...Object.keys(net.nodes), ...Object.keys(net.edges), ...Object.keys(net.props)]) {
    maxId = Math.max(maxId, Number(id.replace(/^[a-z]/, '')) || 0);
  }
  net.nextId = Math.max(obj.nextId ?? 1, maxId + 1);
  reindexAll(net);
  return net;
}
