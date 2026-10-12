// Assemble connected street-running tram lanes into directed train paths.
import { getProfile, layout } from './profiles.js';

export function buildTramRoutes(net, junctions) {
  const arcs = [];
  for (const edge of net.edges.values()) {
    const tramLanes = layout(getProfile(edge)).lanes.filter(l => l.type === 'tram' && l.dir !== 0);
    if (!tramLanes.length) continue;
    const c = net.centerline(edge);
    const JA = junctions.get(edge.a), JB = junctions.get(edge.b);
    const sA = JA?.endFor?.(edge.id, true)?.setback || 0;
    const sB = c.length - (JB?.endFor?.(edge.id, false)?.setback || 0);
    if (sB - sA < 18) continue;
    for (const lane of tramLanes) {
      const dir = lane.dir || 1;
      const forward = dir > 0;
      const startNode = forward ? edge.a : edge.b;
      const endNode = forward ? edge.b : edge.a;
      const stations = c.stations(sA, sB, [], 8, 0.025);
      if (!forward) stations.reverse();
      const points = stations.map(s => {
        const f = c.frameAt(s);
        const o = (lane.o0 + lane.o1) / 2;
        return { x: f.x + f.nx * o, y: f.y + lane.h + 0.04, z: f.z + f.nz * o };
      });
      const f0 = c.frameAt(forward ? sA : sB), f1 = c.frameAt(forward ? sB : sA);
      arcs.push({
        id: `${edge.id}:tram:${lane.i}`,
        edge, name: edge.name || '', lane,
        startNode, endNode, points,
        startT: [f0.tx * dir, f0.tz * dir],
        endT: [f1.tx * dir, f1.tz * dir],
        start: points[0], end: points[points.length - 1],
      });
    }
  }
  if (!arcs.length) return [];

  const byStart = new Map();
  for (const a of arcs) {
    let list = byStart.get(a.startNode);
    if (!list) byStart.set(a.startNode, list = []);
    list.push(a);
  }
  const successor = new Map();
  for (const a of arcs) {
    let best = null, bestScore = -Infinity;
    for (const b of byStart.get(a.endNode) || []) {
      if (b.edge.id === a.edge.id) continue;
      if (a.name && b.name && a.name !== b.name) continue;
      const dot = a.endT[0] * b.startT[0] + a.endT[1] * b.startT[1];
      if (dot < 0.18) continue; // no U-turn or sharp cross-street jump
      const gap = Math.hypot(a.end.x - b.start.x, a.end.z - b.start.z);
      if (gap > 70) continue;
      const score = dot * 2 - gap * 0.004;
      if (score > bestScore) { best = b; bestScore = score; }
    }
    if (best) successor.set(a.id, best);
  }

  // Make joins mutually exclusive so a turnout does not send two trains into one lane.
  const predecessor = new Map();
  for (const a of arcs) {
    const b = successor.get(a.id); if (!b) continue;
    const old = predecessor.get(b.id);
    if (!old || scoreJoin(a, b) > scoreJoin(old, b)) predecessor.set(b.id, a);
  }
  for (const a of arcs) if (successor.get(a.id) && predecessor.get(successor.get(a.id).id) !== a) successor.delete(a.id);

  const used = new Set(), routes = [];
  const starts = arcs.filter(a => !predecessor.has(a.id));
  const walk = start => {
    const chain = [], seen = new Set();
    let a = start;
    while (a && !used.has(a.id) && !seen.has(a.id)) {
      seen.add(a.id); used.add(a.id); chain.push(a);
      a = successor.get(a.id);
    }
    if (!chain.length) return;
    const points = [...chain[0].points];
    for (let i = 1; i < chain.length; i++) {
      appendJoin(points, chain[i - 1], chain[i]);
      points.push(...chain[i].points.slice(1));
    }
    if (points.length >= 2) routes.push({ id: `tram:${chain[0].id}`, name: chain[0].name || 'City Tram', pts: points, mode: 'tram' });
  };
  for (const a of starts) walk(a);
  for (const a of arcs) if (!used.has(a.id)) walk(a); // closed loops
  return routes;
}

function scoreJoin(a, b) {
  const dot = a.endT[0] * b.startT[0] + a.endT[1] * b.startT[1];
  return dot * 2 - Math.hypot(a.end.x - b.start.x, a.end.z - b.start.z) * 0.004;
}

function appendJoin(points, a, b) {
  const p0 = a.end, p3 = b.start;
  const distance = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  if (distance < 0.4) return;
  const h = Math.max(1.5, Math.min(14, distance * 0.45));
  const p1 = { x: p0.x + a.endT[0] * h, z: p0.z + a.endT[1] * h, y: p0.y };
  const p2 = { x: p3.x - b.startT[0] * h, z: p3.z - b.startT[1] * h, y: p3.y };
  const steps = Math.max(3, Math.ceil(distance / 3));
  for (let k = 1; k < steps; k++) {
    const t = k / steps, u = 1 - t;
    points.push({
      x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
      z: u ** 3 * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t ** 3 * p3.z,
    });
  }
}
