// Project model: nodes (junction points) and roads (ordered control points with a
// road kind, cross-section, mode and props). All edits go through these functions
// so the topology invariants hold:
//   * every open road's first/last point equals its start/end node position
//   * nodes no longer referenced by any road are removed
//   * closed roads (loops, roundabouts) have no nodes
//   * roads never overlap at the same height without a node unless the user asks

import { sampleCenterline, nearestOnPoly, pointAt } from './centerline.js';
import { ROAD_KINDS, presetLanes, lanesOf } from './lanes.js';
import { resolveS } from './props.js';
import { round } from './math.js';

export const FORMAT = 'pz-road-project';
export const FORMAT_VERSION = 1;

export function createProject(name = 'Untitled city') {
  return { format: FORMAT, version: FORMAT_VERSION, name, nextId: 1, nodes: {}, roads: [] };
}

export function newId(project, prefix) {
  return `${prefix}${project.nextId++}`;
}

const clCache = new WeakMap();
/** Full centerline for a road, memoised on the road object and invalidated when its geometry changes. */
export function centerlineOf(road) {
  const key = `${road.closed ? 1 : 0}|${road.points.map((p) => `${p.x},${p.z},${p.h || 0}`).join(';')}`;
  const hit = clCache.get(road);
  if (hit && hit.key === key) return hit.cl;
  const cl = sampleCenterline(road.points, { closed: !!road.closed, step: 1 });
  clCache.set(road, { key, cl });
  return cl;
}

export function roadLength(road) {
  const cl = centerlineOf(road);
  return cl.n ? cl.s[cl.n - 1] - cl.s[0] : 0;
}

export function addNode(project, x, z) {
  const id = newId(project, 'n');
  project.nodes[id] = { id, x: round(x), z: round(z) };
  return id;
}

export function addRoad(project, spec) {
  const kind = ROAD_KINDS[spec.kind] ? spec.kind : 'local';
  const k = ROAD_KINDS[kind];
  const id = newId(project, 'r');
  const road = {
    id,
    name: spec.name || `${k.label} ${id.slice(1)}`,
    kind,
    mode: spec.mode || k.mode || 'surface',
    roof: spec.roof ?? false,
    closed: !!(spec.closed || k.closed),
    start: spec.closed || k.closed ? null : spec.startNode || null,
    end: spec.closed || k.closed ? null : spec.endNode || null,
    points: spec.points.map((p) => ({ x: round(p.x), z: round(p.z), h: round(p.h || 0) })),
    lanes: spec.lanes ? spec.lanes.map((l) => ({ ...l })) : presetLanes(kind, spec.options),
    props: [],
  };
  if (spec.radius) road.radius = spec.radius;
  project.roads.push(road);
  syncEndpoints(project, road);
  return road;
}

export function findRoad(project, id) {
  return project.roads.find((r) => r.id === id) || null;
}

/** Copy node positions onto the road's end points. */
export function syncEndpoints(project, road) {
  if (road.closed || road.points.length < 2) return;
  const first = road.start && project.nodes[road.start];
  const last = road.end && project.nodes[road.end];
  if (first) road.points[0] = { x: first.x, z: first.z, h: road.points[0].h || 0 };
  if (last) road.points[road.points.length - 1] = { x: last.x, z: last.z, h: road.points[road.points.length - 1].h || 0 };
}

export function roadsAtNode(project, nodeId) {
  return project.roads.filter((r) => r.start === nodeId || r.end === nodeId);
}

export function moveNode(project, nodeId, x, z) {
  const node = project.nodes[nodeId];
  if (!node) return;
  node.x = round(x);
  node.z = round(z);
  for (const road of roadsAtNode(project, nodeId)) syncEndpoints(project, road);
}

/** Move a control point. Endpoints move their node (and every road sharing it). */
export function moveRoadPoint(project, roadId, index, x, z) {
  const road = findRoad(project, roadId);
  if (!road || !road.points[index]) return;
  const last = road.points.length - 1;
  if (!road.closed && index === 0 && road.start) return moveNode(project, road.start, x, z);
  if (!road.closed && index === last && road.end) return moveNode(project, road.end, x, z);
  road.points[index] = { x: round(x), z: round(z), h: road.points[index].h || 0 };
}

export function removeRoad(project, roadId) {
  project.roads = project.roads.filter((r) => r.id !== roadId);
  const used = new Set();
  for (const r of project.roads) {
    if (r.start) used.add(r.start);
    if (r.end) used.add(r.end);
  }
  for (const id of Object.keys(project.nodes)) if (!used.has(id)) delete project.nodes[id];
}

export function addProp(project, roadId, prop) {
  const road = findRoad(project, roadId);
  if (!road) return null;
  const withId = { ...prop, id: newId(project, 'p') };
  road.props = road.props || [];
  road.props.push(withId);
  return withId;
}

export function removeProp(project, roadId, propId) {
  const road = findRoad(project, roadId);
  if (!road) return;
  road.props = (road.props || []).filter((p) => p.id !== propId);
}

/** Nearest road to (x,z) within maxDist. Returns { road, near } where near = nearestOnPoly. */
export function nearestRoad(project, x, z, maxDist = Infinity) {
  let best = null;
  for (const road of project.roads) {
    const cl = centerlineOf(road);
    if (cl.n < 2) continue;
    const near = nearestOnPoly(cl, x, z);
    if (near.dist <= maxDist && (!best || near.dist < best.near.dist)) best = { road, near };
  }
  return best;
}

/**
 * Split a surface road at the point nearest (x,z). Creates a node there and returns its id.
 * Props are re-homed onto the correct half. Bridges and tunnels cannot be split.
 */
export function splitRoadAt(project, roadId, x, z) {
  const road = findRoad(project, roadId);
  if (!road || road.closed || road.mode !== 'surface') return null;
  const cl = centerlineOf(road);
  const near = nearestOnPoly(cl, x, z);
  const L = cl.s[cl.n - 1];
  if (near.s < 1 || near.s > L - 1) return null;
  const nodeId = addNode(project, near.x, near.z);
  const P = road.points;
  let seg = 0;
  let bestD = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const d = segmentDistance(near.x, near.z, P[i], P[i + 1]);
    if (d < bestD) {
      bestD = d;
      seg = i;
    }
  }
  const split = { x: round(near.x), z: round(near.z), h: 0 };
  const aPoints = P.slice(0, seg + 1).concat([split]);
  const bPoints = [split].concat(P.slice(seg + 1));
  const oldEnd = road.end;

  const props = road.props || [];
  const aProps = [];
  const bProps = [];
  for (const prop of props) {
    const { id, ...rest } = prop;
    if (['bollards', 'lamps'].includes(prop.kind)) {
      const s0 = prop.s0 ?? 0;
      const s1 = prop.s1 ?? L;
      if (s0 < near.s - 0.5) aProps.push({ ...rest, id: newId(project, 'p'), s0, s1: Math.min(s1, near.s) });
      if (s1 > near.s + 0.5) bProps.push({ ...rest, id: newId(project, 'p'), s0: Math.max(s0, near.s) - near.s, s1: s1 - near.s });
    } else {
      const sAbs = resolveS(prop, L);
      if (sAbs < near.s) aProps.push({ ...rest, id: newId(project, 'p'), ref: undefined, s: sAbs });
      else bProps.push({ ...rest, id: newId(project, 'p'), ref: undefined, s: sAbs - near.s });
    }
  }

  const b = {
    ...road,
    id: newId(project, 'r'),
    name: `${road.name} (B)`,
    start: nodeId,
    end: oldEnd,
    points: bPoints,
    lanes: lanesOf(road).map((l) => ({ ...l })),
    props: bProps,
  };
  road.end = nodeId;
  road.points = aPoints;
  road.props = aProps;
  project.roads.push(b);
  syncEndpoints(project, road);
  syncEndpoints(project, b);
  return nodeId;
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/**
 * Resolve a point to a node: existing node within `nodeTol`, else split a road
 * whose centerline passes within `roadTol`, else null (caller creates a new node).
 */
export function ensureNodeAt(project, x, z, { nodeTol = 2.5, roadTol = 3 } = {}) {
  let bestNode = null;
  let bestD = nodeTol;
  for (const node of Object.values(project.nodes)) {
    const d = Math.hypot(node.x - x, node.z - z);
    if (d <= bestD) {
      bestD = d;
      bestNode = node.id;
    }
  }
  if (bestNode) return bestNode;
  const hit = nearestRoad(project, x, z, roadTol);
  if (hit && !hit.road.closed && hit.road.mode === 'surface') {
    const cl = centerlineOf(hit.road);
    const L = cl.s[cl.n - 1];
    if (hit.near.s > 2 && hit.near.s < L - 2) return splitRoadAt(project, hit.road.id, x, z);
  }
  return null;
}

/** Insert a control point on the road nearest to (x,z). Returns the new index. */
export function insertPointAt(project, roadId, x, z) {
  const road = findRoad(project, roadId);
  if (!road) return -1;
  const P = road.points;
  let seg = 0;
  let bestD = Infinity;
  const segCount = road.closed ? P.length : P.length - 1;
  for (let i = 0; i < segCount; i++) {
    const d = segmentDistance(x, z, P[i], P[(i + 1) % P.length]);
    if (d < bestD) {
      bestD = d;
      seg = i;
    }
  }
  const cl = centerlineOf(road);
  const near = nearestOnPoly(cl, x, z);
  const h = pointAt(cl, near.s).h;
  const point = { x: round(near.x), z: round(near.z), h: round(h) };
  road.points.splice(seg + 1, 0, point);
  return seg + 1;
}

export function removeRoadPoint(project, roadId, index) {
  const road = findRoad(project, roadId);
  if (!road) return false;
  const min = road.closed ? 3 : 2;
  if (road.points.length <= min) return false;
  if (!road.closed && (index === 0 || index === road.points.length - 1)) return false;
  road.points.splice(index, 1);
  return true;
}

/** Construct a closed ring road (roundabout) around a centre point. */
export function roundaboutPoints(cx, cz, radius, count = 16) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: round(cx + Math.cos(a) * radius), z: round(cz + Math.sin(a) * radius), h: 0 });
  }
  return pts;
}

export function serialize(project) {
  return JSON.stringify(project);
}

/** Parse + repair a project from JSON. Unknown kinds fall back to 'local'. */
export function deserialize(text) {
  const obj = typeof text === 'string' ? JSON.parse(text) : text;
  return normalizeProject(obj);
}

export function normalizeProject(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a project file.');
  const project = createProject(obj.name || 'Untitled city');
  project.nodes = {};
  for (const [id, n] of Object.entries(obj.nodes || {})) {
    project.nodes[id] = { id, x: Number(n.x) || 0, z: Number(n.z) || 0 };
  }
  project.roads = [];
  let maxId = 0;
  for (const raw of obj.roads || []) {
    const kind = ROAD_KINDS[raw.kind] ? raw.kind : 'local';
    const k = ROAD_KINDS[kind];
    const points = (raw.points || []).map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0, h: Number(p.h) || 0 }));
    if (points.length < 2) continue;
    const road = {
      id: String(raw.id),
      name: raw.name || k.label,
      kind,
      mode: ['surface', 'bridge', 'underground'].includes(raw.mode) ? raw.mode : k.mode || 'surface',
      roof: !!raw.roof,
      closed: !!raw.closed || !!k.closed,
      start: raw.start && project.nodes[raw.start] ? raw.start : null,
      end: raw.end && project.nodes[raw.end] ? raw.end : null,
      points,
      lanes: Array.isArray(raw.lanes) && raw.lanes.length
        ? raw.lanes.map((l) => ({ ...l, kind: String(l.kind), width: Math.max(0.2, Number(l.width) || 1) }))
        : presetLanes(kind),
      props: Array.isArray(raw.props) ? raw.props.map((p) => ({ ...p, id: String(p.id) })) : [],
    };
    if (raw.radius) road.radius = Number(raw.radius);
    if (road.closed) {
      road.start = null;
      road.end = null;
    }
    project.roads.push(road);
    const idNum = Number(String(road.id).replace(/\D/g, ''));
    if (Number.isFinite(idNum)) maxId = Math.max(maxId, idNum);
    for (const p of road.props) {
      const pn = Number(String(p.id).replace(/\D/g, ''));
      if (Number.isFinite(pn)) maxId = Math.max(maxId, pn);
    }
  }
  for (const id of Object.keys(project.nodes)) {
    const n = Number(id.replace(/\D/g, ''));
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  project.nextId = Math.max(Number(obj.nextId) || 1, maxId + 1);
  for (const road of project.roads) syncEndpoints(project, road);
  return project;
}

export function projectStats(project) {
  let length = 0;
  let controlPoints = 0;
  let props = 0;
  let bridges = 0;
  let tunnels = 0;
  for (const road of project.roads) {
    length += roadLength(road);
    controlPoints += road.points.length;
    props += (road.props || []).length;
    if (road.mode === 'bridge') bridges++;
    if (road.mode === 'underground') tunnels++;
  }
  return {
    roads: project.roads.length,
    nodes: Object.keys(project.nodes).length,
    lengthKm: length / 1000,
    controlPoints,
    props,
    bridges,
    tunnels,
  };
}

