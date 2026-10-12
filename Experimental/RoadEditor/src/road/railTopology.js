// Derive a small, explicit track graph from editable railway route polylines.
// Rails have their own nodes: a rail/road crossing is a crossing, not a road junction.
import { planarize } from './planarize.js';

const modeOf = route => route.mode || (route.kind === 'suspended' ? 'suspended' : route.kind === 'tram' ? 'tram' : 'mainline');

function heightAt(points, x, z, fallback = 0) {
  let best = Infinity, y = fallback;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < best) {
      best = d2;
      y = (a.y ?? fallback) + ((b.y ?? fallback) - (a.y ?? fallback)) * t;
    }
  }
  return y;
}

export function deriveRailTopology(routes, { tolerance = 1.25 } = {}) {
  const polys = [...routes.values()]
    .filter(r => Array.isArray(r.pts) && r.pts.length >= 2)
    .map(r => ({
      id: r.id,
      layer: `rail:${modeOf(r)}`,
      mode: modeOf(r),
      route: r,
      pts: r.pts.map(p => [p.x, p.z]),
      ys: r.pts.map(p => p.y ?? r.height ?? 0),
    }));
  if (!polys.length) return { nodes: new Map(), edges: new Map() };

  const graph = planarize(polys, { tol: tolerance, cell: 120 });
  const nodes = new Map();
  for (const n of graph.nodes) {
    const id = `rn${n.id.toString(36)}`;
    nodes.set(id, { id, x: n.x, y: n.y ?? 0, z: n.z, degree: n.deg, mode: n.layer?.replace('rail:', '') || 'mainline', kind: n.deg > 2 ? 'switch' : n.deg === 2 ? 'through' : 'end' });
  }

  const edges = new Map();
  const routeOrdinals = new Map();
  for (const e of graph.edges) {
    const route = e.src.route;
    const ordinal = routeOrdinals.get(route.id) || 0;
    routeOrdinals.set(route.id, ordinal + 1);
    const id = `${route.id}:seg${ordinal.toString(36)}`;
    const yAt = (x, z) => heightAt(route.pts, x, z, route.height || 0);
    edges.set(id, {
      id,
      a: `rn${e.a.toString(36)}`,
      b: `rn${e.b.toString(36)}`,
      routeId: route.id,
      name: route.name || 'Railway',
      mode: modeOf(route),
      tracks: route.tracks || 1,
      pts: e.pts.map(([x, z]) => ({ x, y: yAt(x, z), z })),
      length: polylineLength([[graph.nodes[e.a].x, graph.nodes[e.a].z], ...e.pts, [graph.nodes[e.b].x, graph.nodes[e.b].z]]),
    });
  }
  return { nodes, edges };
}

function polylineLength(pts) {
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return length;
}
