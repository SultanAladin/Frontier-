// Junction solving. Every road end is attached to a node. Where two or more
// street roads meet, each road is trimmed back to the junction radius (the widest
// incident half-width) and a single convex asphalt pad is laid over the hull of
// all incident cross-section corners. This removes overlapping ribbons and
// T-junction z-fighting without a full boolean road union.

import { pointAt } from './centerline.js';
import { convexHull } from './math.js';
import { isJunctionRoad, laneOffsets, lanesOf, halfWidthOf } from './lanes.js';

/**
 * @param {object} project
 * @param {(road:object)=>object} getCl  returns the full centerline Poly for a road
 * @returns {{ trims: Map<string,number>, pads: Map<string,Array<[number,number]>> }}
 *   trims key: `${roadId}:start` | `${roadId}:end`
 */
export function computeJunctions(project, getCl) {
  const incident = new Map(); // nodeId -> [{ road, end }]
  for (const road of project.roads) {
    if (!isJunctionRoad(road)) continue;
    for (const end of ['start', 'end']) {
      const nid = road[end];
      if (!nid || !project.nodes[nid]) continue;
      if (!incident.has(nid)) incident.set(nid, []);
      incident.get(nid).push({ road, end });
    }
  }

  const trims = new Map();
  const pads = new Map();
  for (const [nodeId, list] of incident) {
    if (list.length < 2) continue; // dead end: no trim, no pad
    let radius = 0;
    for (const { road } of list) radius = Math.max(radius, halfWidthOf(road));

    const corners = [];
    for (const { road, end } of list) {
      const cl = getCl(road);
      const L = cl.s[cl.n - 1] - cl.s[0];
      const trim = Math.min(radius, 0.45 * L);
      trims.set(`${road.id}:${end}`, trim);
      const p = end === 'start' ? pointAt(cl, cl.s[0] + trim) : pointAt(cl, cl.s[cl.n - 1] - trim);
      const offs = laneOffsets(lanesOf(road));
      for (const o of offs) corners.push([p.x + p.nx * o, p.z + p.nz * o]);
    }
    pads.set(nodeId, convexHull(corners));
  }
  return { trims, pads };
}

export function trimFor(junctions, road) {
  return {
    start: junctions.trims.get(`${road.id}:start`) || 0,
    end: junctions.trims.get(`${road.id}:end`) || 0,
  };
}
