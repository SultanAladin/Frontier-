// Procedural city generator.
//
// Lays out a warped arterial grid, recursively subdivides every block into lots with
// local streets, threads a river and a railway through it, hangs a subway network
// below the arterials and then dresses everything with lanes, markings, furniture and
// perimeter-block massing.  Everything is seeded, so a seed always rebuilds the same
// city.

import { Grid2D, clamp, distSqPointSegmentXZ, lerp, makeRng, nearestOnPolyline, polylineLength, clamp as clampNum } from './util.js';
import { makeDetail } from './details.js';

const STREET_NAMES = [
  'High Street', 'Station Road', 'Main Street', 'Park Lane', 'Church Street', 'Mill Road',
  'Bridge Street', 'Victoria Road', 'King Street', 'Queen Street', 'Northgate', 'Southgate',
  'Market Street', 'School Lane', 'Chapel Street', 'Waterloo Road', 'Albert Street',
  'Granary Way', 'Foundry Row', 'Orchard Street', 'Kingsway', 'Riverside', 'Canal Walk',
];

const SECONDARY_NAMES = [
  'Avenue', 'Boulevard', 'Crescent', 'Terrace', 'Grove', 'Close', 'Way', 'Rise', 'Mews', 'Yard',
];

/* ------------------------------------------------------------------ */
/* topology helpers                                                    */
/* ------------------------------------------------------------------ */

function addNode(network, x, z, kind = 'plain') {
  return network.addNode(x, z, 0, kind);
}

/** Split a road at the closest point to (x, z); returns the (possibly new) node. */
function splitRoadAt(network, roadId, x, z, minDistance = 3) {
  const road = network.getRoad(roadId);
  if (!road) return null;
  const points = network.roadPoints(road);
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const r = distSqPointSegmentXZ(x, z, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z);
    if (!best || r.distSq < best.distSq) best = { ...r, i };
  }
  if (!best) return null;
  const a = points[best.i];
  const b = points[best.i + 1];
  const px = lerp(a.x, b.x, best.t);
  const pz = lerp(a.z, b.z, best.t);
  const py = lerp(a.y ?? 0, b.y ?? 0, best.t);

  if (Math.hypot(px - a.x, pz - a.z) < minDistance) return a;
  if (Math.hypot(px - b.x, pz - b.z) < minDistance) return b;

  const node = network.addNode(px, pz, py, 'junction');
  road.nodeIds.splice(best.i + 1, 0, node.id);
  return node;
}

/** Index of road segments so we can find "which road passes near this point". */
function buildSegmentIndex(network) {
  const grid = new Grid2D(36);
  for (const road of network.roads.values()) {
    const points = network.roadPoints(road);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      grid.insert((a.x + b.x) / 2, (a.z + b.z) / 2, { road, a, b, index: i });
    }
  }
  return grid;
}

function nearestRoad(grid, x, z, radius = 60) {
  let best = null;
  grid.query(x, z, radius, (entry) => {
    const r = distSqPointSegmentXZ(x, z, entry.value.a.x, entry.value.a.z, entry.value.b.x, entry.value.b.z);
    if (!best || r.distSq < best.distSq) best = { distSq: r.distSq, t: r.t, road: entry.value.road };
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

export const CITY_DEFAULTS = {
  seed: 1337,
  extent: 2100,
  arterialSpacing: 400,
  blockMin: 62,
  depth: 4,
  river: true,
  railway: true,
  subway: true,
  roundabouts: true,
  cycleLanes: true,
  busLanes: true,
  parking: true,
  buildings: true,
  furniture: 'full',
  blockInfill: 0.16,
};

export function generateCity(network, options = {}) {
  const settings = { ...CITY_DEFAULTS, ...options };
  const rng = makeRng(settings.seed >>> 0);
  const half = settings.extent / 2;
  network.clear();
  network.settings.city = { ...settings };

  const lines = Math.max(3, Math.round(settings.extent / settings.arterialSpacing) + 1);
  const step = settings.extent / (lines - 1);
  const coordinate = (index) => -half + index * step + (index === 0 || index === lines - 1 ? 0 : rng.range(-step * 0.09, step * 0.09));

  /* -------------------------------------------------------------- */
  /* 1. arterial grid                                                */
  /* -------------------------------------------------------------- */
  const grid = [];
  for (let j = 0; j < lines; j++) {
    grid[j] = [];
    for (let i = 0; i < lines; i++) {
      const jitterX = i === 0 || i === lines - 1 ? 0 : rng.range(-18, 18);
      const jitterZ = j === 0 || j === lines - 1 ? 0 : rng.range(-18, 18);
      grid[j][i] = addNode(network, coordinate(i) + jitterX, coordinate(j) + jitterZ, 'junction');
    }
  }

  const arterials = [];
  const addArterial = (nodeIds, tier) => {
    const road = network.addRoad(nodeIds, 'arterial-bus-cycle', { group: tier });
    if (road) {
      arterials.push({ road, tier });
      road.name = `${rng.pick(STREET_NAMES)}`;
    }
    return road;
  };

  for (let j = 0; j < lines; j++) {
    for (let i = 0; i < lines - 1; i++) {
      const tier = i === 0 || i === lines - 2 ? 'ring' : j % 2 === 0 ? 'primary' : 'secondary';
      const road = network.addRoad([grid[j][i].id, grid[j][i + 1].id], 'arterial-bus-cycle');
      if (road) {
        arterials.push({ road, tier });
        road.name = j % 2 === 0 ? rng.pick(STREET_NAMES) : `${rng.pick(STREET_NAMES)} ${rng.pick(SECONDARY_NAMES)}`;
        road.__tier = tier;
      }
    }
  }
  for (let i = 0; i < lines; i++) {
    for (let j = 0; j < lines - 1; j++) {
      const tier = j === 0 || j === lines - 2 ? 'ring' : i % 2 === 0 ? 'secondary' : 'primary';
      const road = network.addRoad([grid[j][i].id, grid[j + 1][i].id], 'arterial-bus-cycle');
      if (road) {
        arterials.push({ road, tier });
        road.name = `${rng.pick(STREET_NAMES)} ${rng.pick(SECONDARY_NAMES)}`;
        road.__tier = tier;
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* 2. river                                                        */
  /* -------------------------------------------------------------- */
  let river = null;
  if (settings.river) {
    river = buildRiver(settings, rng, half);
    network.settings.river = river;
  }

  /* -------------------------------------------------------------- */
  /* 3. block subdivision                                            */
  /* -------------------------------------------------------------- */
  const blocks = [];
  for (let j = 0; j < lines - 1; j++) {
    for (let i = 0; i < lines - 1; i++) {
      const corners = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      const edges = [
        { a: corners[0], b: corners[1], road: roadBetween(network, corners[0], corners[1]) },
        { a: corners[1], b: corners[2], road: roadBetween(network, corners[1], corners[2]) },
        { a: corners[2], b: corners[3], road: roadBetween(network, corners[2], corners[3]) },
        { a: corners[3], b: corners[0], road: roadBetween(network, corners[3], corners[0]) },
      ];
      blocks.push({ corners, edges });
    }
  }

  const leaves = [];
  const districtCentre = { x: rng.range(-half * 0.25, half * 0.25), z: rng.range(-half * 0.25, half * 0.25) };
  for (const block of blocks) {
    const superblock = rng.chance(settings.blockInfill);
    subdivideBlock(block, superblock ? 1 : settings.depth, {
      network,
      rng,
      leaves,
      minFrontage: settings.blockMin,
      river,
      superblock,
      districtCentre,
      half,
    });
  }

  /* -------------------------------------------------------------- */
  /* 4. profiles by hierarchy                                        */
  /* -------------------------------------------------------------- */
  assignProfiles(network, arterials, rng, settings, half, districtCentre);

  /* -------------------------------------------------------------- */
  /* 5. roundabouts                                                  */
  /* -------------------------------------------------------------- */
  if (settings.roundabouts) convertRoundabouts(network, rng, half);

  /* -------------------------------------------------------------- */
  /* 6. railway and level crossings                                  */
  /* -------------------------------------------------------------- */
  if (settings.railway) addRailway(network, rng, half, settings);

  /* -------------------------------------------------------------- */
  /* 7. subway                                                       */
  /* -------------------------------------------------------------- */
  if (settings.subway) addSubway(network, grid, lines, rng, settings);

  /* -------------------------------------------------------------- */
  /* 8. park paths and furniture details                             */
  /* -------------------------------------------------------------- */
  addParkPaths(network, leaves, rng, settings);
  addFurnitureDetails(network, rng, settings);

  /* -------------------------------------------------------------- */
  /* 9. buildings                                                    */
  /* -------------------------------------------------------------- */
  if (settings.buildings) {
    network.settings.massing = leaves
      .filter((leaf) => !leaf.park)
      .map((leaf) => ({
        polygon: leaf.corners.map((n) => ({ x: n.x, z: n.z })),
        zone: leaf.zone,
        seed: Math.floor(rng() * 1e6),
      }));
  } else {
    network.settings.massing = [];
  }

  pruneOrphans(network);
  const stats = network.stats();
  return { stats, blocks: leaves.length, seed: settings.seed };
}

/* ------------------------------------------------------------------ */
/* river                                                               */
/* ------------------------------------------------------------------ */

function buildRiver(settings, rng, half) {
  const points = [];
  const count = 14;
  const startAngle = rng.range(0, Math.PI * 2);
  const amplitude = half * rng.range(0.18, 0.34);
  const across = half * 1.35;
  const dx = Math.cos(startAngle);
  const dz = Math.sin(startAngle);
  const px = -dz;
  const pz = dx;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const along = lerp(-across, across, t);
    const lateral = Math.sin(t * Math.PI * rng.range(1.1, 2.1) + rng.range(0, 1)) * amplitude
      + Math.sin(t * Math.PI * 3.7) * amplitude * 0.25;
    points.push({ x: px * along + dx * lateral, z: pz * along + dz * lateral });
  }
  return {
    points,
    width: settings.extent * rng.range(0.03, 0.055),
    level: null,
  };
}

function riverDistance(river, x, z) {
  if (!river) return Infinity;
  return nearestOnPolyline(river.points, x, z).dist;
}

/* ------------------------------------------------------------------ */
/* block subdivision                                                   */
/* ------------------------------------------------------------------ */

function roadBetween(network, a, b) {
  for (const road of network.roads.values()) {
    const ids = road.nodeIds;
    for (let i = 0; i < ids.length - 1; i++) {
      if ((ids[i] === a.id && ids[i + 1] === b.id) || (ids[i] === b.id && ids[i + 1] === a.id)) return road;
    }
  }
  return null;
}

function quadMetrics(corners) {
  let width = 0;
  let depth = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (i % 2 === 0) width += length / 2;
    else depth += length / 2;
  }
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cz = (corners[0].z + corners[1].z + corners[2].z + corners[3].z) / 4;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area += a.x * b.z - b.x * a.z;
  }
  return { width, depth, cx, cz, area: Math.abs(area) / 2 };
}

/**
 * Splits a block in two with a new local street.  The block is a cyclic list of four
 * edges; the split cuts two opposite edges, inserts a node in the road that runs
 * along each of them (creating real T-junctions) and recurses on both halves.
 */
function subdivideBlock(block, depth, ctx) {
  const { network, rng, leaves, minFrontage, river, superblock, districtCentre, half } = ctx;
  const metrics = quadMetrics(block.corners);
  const shortest = Math.min(metrics.width, metrics.depth);

  if (depth <= 0 || shortest < minFrontage * 1.7 || metrics.area < minFrontage * minFrontage * 2.2) {
    leaves.push({
      corners: block.corners,
      zone: zoneFor(metrics, districtCentre, half),
      park: superblock || (river && riverDistance(river, metrics.cx, metrics.cz) < river.width * 0.9),
    });
    return;
  }

  const [c0, c1, c2, c3] = block.corners;
  const [e0, e1, e2, e3] = block.edges;
  // Cut across the longer axis so the new street is the shorter one.
  const cutAcrossE1 = metrics.width >= metrics.depth;
  const t = rng.range(0.4, 0.6);
  const edgeA = cutAcrossE1 ? e1 : e0;
  const edgeB = cutAcrossE1 ? e3 : e2;
  const pointA = lerpPoint(edgeA.a, edgeA.b, t);
  const pointB = lerpPoint(edgeB.a, edgeB.b, cutAcrossE1 ? 1 - t * 0.4 - 0.3 : t);

  if (river && (riverDistance(river, pointA.x, pointA.z) < river.width * 0.5 || riverDistance(river, pointB.x, pointB.z) < river.width * 0.5)) {
    leaves.push({ corners: block.corners, zone: 'park', park: true });
    return;
  }

  const nodeA = edgeA.road ? splitRoadAt(network, edgeA.road.id, pointA.x, pointA.z) : addNode(network, pointA.x, pointA.z, 'junction');
  const nodeB = edgeB.road ? splitRoadAt(network, edgeB.road.id, pointB.x, pointB.z) : addNode(network, pointB.x, pointB.z, 'junction');
  if (!nodeA || !nodeB || nodeA.id === nodeB.id) {
    leaves.push({ corners: block.corners, zone: 'urban', park: false });
    return;
  }

  const street = network.addRoad([nodeA.id, nodeB.id], 'residential-street', { group: 'local' });
  if (street) street.name = `${rng.pick(STREET_NAMES)} ${rng.pick(SECONDARY_NAMES)}`;
  const streetEdgeAB = { a: nodeA, b: nodeB, road: street };
  const streetEdgeBA = { a: nodeB, b: nodeA, road: street };

  let childA;
  let childB;
  if (cutAcrossE1) {
    // Cut e1 (c1->c2) and e3 (c3->c0).
    childA = {
      corners: [c0, c1, nodeA, nodeB],
      edges: [e0, { a: c1, b: nodeA, road: e1.road }, streetEdgeAB, { a: nodeB, b: c0, road: e3.road }],
    };
    childB = {
      corners: [nodeB, nodeA, c2, c3],
      edges: [streetEdgeBA, { a: nodeA, b: c2, road: e1.road }, e2, { a: c3, b: nodeB, road: e3.road }],
    };
  } else {
    // Cut e0 (c0->c1) and e2 (c2->c3).
    childA = {
      corners: [c0, nodeA, nodeB, c3],
      edges: [{ a: c0, b: nodeA, road: e0.road }, streetEdgeAB, { a: nodeB, b: c3, road: e2.road }, e3],
    };
    childB = {
      corners: [nodeA, c1, c2, nodeB],
      edges: [{ a: nodeA, b: c1, road: e0.road }, e1, { a: c2, b: nodeB, road: e2.road }, streetEdgeBA],
    };
  }

  subdivideBlock(childA, depth - 1, ctx);
  subdivideBlock(childB, depth - 1, ctx);
}

function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
}

function zoneFor(metrics, centre, half) {
  const distance = Math.hypot(metrics.cx - centre.x, metrics.cz - centre.z) / half;
  if (distance < 0.22) return 'core';
  if (distance < 0.5) return 'inner';
  if (distance < 0.78) return 'suburb';
  return 'outskirts';
}

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

function assignProfiles(network, arterials, rng, settings, half, centre) {
  for (const { road, tier } of arterials) {
    const points = network.roadPoints(road);
    if (points.length < 2) continue;
    const mx = (points[0].x + points[1].x) / 2;
    const mz = (points[0].z + points[1].z) / 2;
    const distance = Math.hypot(mx - centre.x, mz - centre.z) / half;
    const roll = rng();

    if (tier === 'ring') {
      road.profileId = roll < 0.55 ? 'motorway-2x2' : 'expressway-dual';
      if (roll > 0.9) road.profileId = 'motorway-3x3';
    } else if (tier === 'primary') {
      if (distance < 0.3 && roll < 0.24) road.profileId = 'boulevard';
      else if (roll < 0.16) road.profileId = 'brt-corridor';
      else if (roll < 0.28) road.profileId = 'tram-street';
      else if (settings.busLanes) road.profileId = 'arterial-bus-cycle';
      else road.profileId = 'arterial-car';
      if (road.profileId === 'arterial-bus-cycle' && !settings.cycleLanes) road.profileId = 'arterial-car';
    } else {
      if (distance < 0.3) road.profileId = rng.chance(0.5) ? 'downtown-street' : 'avenue-parking';
      else if (distance < 0.62) road.profileId = rng.chance(0.7) ? 'avenue-parking' : 'suburban-collector';
      else road.profileId = rng.chance(0.6) ? 'suburban-collector' : 'residential-street';
      if (!settings.parking && (road.profileId === 'avenue-parking' || road.profileId === 'downtown-street')) {
        road.profileId = 'suburban-collector';
      }
    }
  }

  for (const road of network.roads.values()) {
    if (road.group === 'local') {
      const roll = rng();
      road.profileId = roll < 0.42 ? 'residential-street'
        : roll < 0.58 ? 'residential-narrow'
        : roll < 0.68 ? 'cul-de-sac'
        : roll < 0.78 ? 'mews'
        : roll < 0.86 ? 'woonerf'
        : roll < 0.94 ? 'cycle-street'
        : 'school-street';
    }
  }
}

/* ------------------------------------------------------------------ */
/* roundabouts                                                         */
/* ------------------------------------------------------------------ */

function convertRoundabouts(network, rng, half) {
  const counts = new Map();
  for (const road of network.roads.values()) {
    for (const id of [road.nodeIds[0], road.nodeIds[road.nodeIds.length - 1]]) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  for (const [nodeId, degree] of counts) {
    if (degree < 3) continue;
    const node = network.getNode(nodeId);
    if (!node) continue;
    if (Math.hypot(node.x, node.z) > half * 0.85) continue;
    if (!rng.chance(degree >= 4 ? 0.42 : 0.16)) continue;
    node.kind = 'roundabout';
    node.radius = rng.range(9, 15);
    node.lanes = 1;
    node.laneWidth = 4.8;
    node.footway = 3;
    node.islandSurface = rng.chance(0.7) ? 'grass' : 'sett';
  }
}

/* ------------------------------------------------------------------ */
/* railway                                                             */
/* ------------------------------------------------------------------ */

function addRailway(network, rng, half, settings) {
  const angle = rng.range(0, Math.PI * 2);
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const offset = half * rng.range(-0.45, 0.45);
  const points = [];
  const span = half * 1.4;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const along = lerp(-span, span, t);
    const lateral = offset + Math.sin(t * Math.PI * 1.3) * half * 0.12;
    points.push({ x: px * along + dx * lateral, z: pz * along + dz * lateral });
  }

  const nodes = points.map((p) => addNode(network, p.x, p.z, 'plain'));
  const line = network.addRoad(nodes.map((n) => n.id), 'rail-double', { group: 'rail' });
  if (!line) return;
  line.name = 'Main line';

  const index = buildSegmentIndex(network);
  const crossings = [];
  for (const road of network.roads.values()) {
    if (road === line || road.group === 'rail') continue;
    const points2 = network.roadPoints(road);
    for (let i = 0; i < points2.length - 1; i++) {
      const a = points2[i];
      const b = points2[i + 1];
      const hit = segmentCrossesPolyline(a, b, points);
      if (hit) crossings.push({ road, distance: hit.distance, point: hit.point, segment: i });
    }
  }

  for (const crossing of crossings) {
    const roadLength = polylineLength(network.roadPoints(crossing.road));
    const isStrategic = crossing.road.group !== 'local' && crossing.road.profileId !== 'motorway-2x2';
    const nearEnd = crossing.distance < 90 || crossing.distance > roadLength - 90;
    if (isStrategic && !nearEnd && rng.chance(0.7)) {
      // Grade-separate: lift a short overpass over the railway.
      const overpass = isolateSection(network, crossing.road, crossing.distance, 78);
      if (overpass) {
        overpass.structure = 'bridge';
        overpass.deckHeight = 6.2;
        overpass.name = `${crossing.road.name || 'Road'} flyover`;
        continue;
      }
    }
    // Level crossing on the road.
    if (!crossing.road.details) crossing.road.details = [];
    crossing.road.details.push(makeDetail('railway-crossing', crossing.distance, {
      width: 9,
      tracks: 2,
      gates: rng.chance(0.8),
      surface: 'concrete',
    }));
  }
}

function segmentCrossesPolyline(a, b, points) {
  for (let i = 0; i < points.length - 1; i++) {
    const hit = segmentIntersection(a, b, points[i], points[i + 1]);
    if (hit) return hit;
  }
  return null;
}

function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const denom = r.x * s.z - r.z * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / denom;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / denom;
  if (t < 0.001 || t > 0.999 || u < 0 || u > 1) return null;
  const len = Math.hypot(r.x, r.z);
  return {
    distance: t * len,
    point: { x: a.x + r.x * t, z: a.z + r.z * t },
  };
}

/** Split a road twice so the middle section becomes its own road. */
function isolateSection(network, road, centreDistance, halfLength) {
  const total = polylineLength(network.roadPoints(road));
  const from = clampNum(centreDistance - halfLength, 12, total - 12);
  const to = clampNum(centreDistance + halfLength, 12, total - 12);
  if (to - from < 24) return null;
  const pointAtDistance = (target) => {
    const points = network.roadPoints(road);
    let run = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const segment = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
      if (run + segment >= target) {
        const t = (target - run) / (segment || 1);
        return { x: lerp(points[i].x, points[i + 1].x, t), z: lerp(points[i].z, points[i + 1].z, t) };
      }
      run += segment;
    }
    return null;
  };
  const startPoint = pointAtDistance(from);
  const endPoint = pointAtDistance(to);
  if (!startPoint || !endPoint) return null;
  const startNode = splitRoadAt(network, road.id, startPoint.x, startPoint.z, 6);
  const endNode = splitRoadAt(network, road.id, endPoint.x, endPoint.z, 6);
  if (!startNode || !endNode || startNode.id === endNode.id) return null;
  const ids = road.nodeIds;
  const si = ids.indexOf(startNode.id);
  const ei = ids.indexOf(endNode.id);
  if (si < 0 || ei < 0) return null;
  const lo = Math.min(si, ei);
  const hi = Math.max(si, ei);
  const middleIds = ids.slice(lo, hi + 1);
  if (middleIds.length < 2) return null;
  const middle = network.addRoad(middleIds, road.profileId, { group: road.group || 'arterial' });
  const remainder = ids.filter((id, index) => index < lo || index > hi);
  if (remainder.length >= 2) road.nodeIds = remainder;
  else network.removeRoad(road.id);
  if (middle) {
    middle.name = road.name;
    middle.lanes = road.lanes;
  }
  return middle;
}

/* ------------------------------------------------------------------ */
/* subway                                                              */
/* ------------------------------------------------------------------ */

function addSubway(network, grid, lines, rng, settings) {
  const mid = Math.floor(lines / 2);
  const loopCoords = [];
  const a = Math.max(1, mid - 1);
  const b = Math.min(lines - 2, mid + 1);
  for (let i = a; i <= b; i++) loopCoords.push(grid[a][i]);
  for (let j = a + 1; j <= b; j++) loopCoords.push(grid[j][b]);
  for (let i = b - 1; i >= a; i--) loopCoords.push(grid[b][i]);
  for (let j = b - 1; j > a; j--) loopCoords.push(grid[j][a]);
  if (loopCoords.length > 2) loopCoords.push(loopCoords[0]);

  const loop = network.addSubway(loopCoords.map((n) => n.id), {
    name: 'Circle line',
    color: 0xe0b23a,
    depth: -13.5,
  });
  if (loop) loop.stations = placeStations(loopCoords, 520, ['Central', 'Museum Quarter', 'Cathedral', 'Riverside', 'Union Square', 'Old Market', 'Canal Street', 'Foundry']);

  const crossCoords = [];
  for (let i = 0; i < lines; i++) crossCoords.push(grid[mid][i]);
  const cross = network.addSubway(crossCoords.map((n) => n.id), {
    name: 'Crossrail',
    color: 0x4f9ee8,
    depth: -18,
  });
  if (cross) cross.stations = placeStations(crossCoords, 620, ['Northgate', 'Arts Centre', 'City Hall', 'Exchange', 'Southbank', 'Terminus']);

  const verticalCoords = [];
  for (let j = 0; j < lines; j++) verticalCoords.push(grid[j][mid]);
  const vertical = network.addSubway(verticalCoords.map((n) => n.id), {
    name: 'Northern line',
    color: 0xd8483c,
    depth: -22,
  });
  if (vertical) vertical.stations = placeStations(verticalCoords, 640, ['Highgate', 'University', 'Grand Central', 'Brewery', 'Dockside']);
}

function placeStations(nodes, spacing, names) {
  const stations = [];
  let run = 0;
  let next = spacing * 0.7;
  let index = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    while (next <= run + segment && index < names.length) {
      stations.push({ s: next, name: names[index++], nodeId: a.id });
      next += spacing;
    }
    run += segment;
  }
  if (!stations.length) stations.push({ s: Math.max(10, run * 0.5), name: names[0], nodeId: nodes[0].id });
  return stations;
}

/* ------------------------------------------------------------------ */
/* parks and furniture                                                 */
/* ------------------------------------------------------------------ */

function addParkPaths(network, leaves, rng, settings) {
  for (const leaf of leaves) {
    if (!leaf.park) continue;
    const centre = leaf.corners.reduce((acc, n) => ({ x: acc.x + n.x / 4, z: acc.z + n.z / 4 }), { x: 0, z: 0 });
    const metrics = quadMetrics(leaf.corners);
    const width = Math.min(metrics.width, metrics.depth) * 0.42;
    const points = [];
    const count = rng.int(3, 5);
    for (let i = 0; i <= count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
      points.push({
        x: centre.x + Math.cos(a) * width * rng.range(0.7, 1),
        z: centre.z + Math.sin(a) * width * rng.range(0.7, 1),
      });
    }
    const nodes = points.map((p) => addNode(network, p.x, p.z, 'plain'));
    const path = network.addRoad(nodes.map((n) => n.id), rng.chance(0.5) ? 'park-trail' : 'shared-use-path', { group: 'park' });
    if (path) path.name = 'Park path';

    // A cross path.
    if (rng.chance(0.6)) {
      const angle = rng.range(0, Math.PI);
      const a = addNode(network, centre.x + Math.cos(angle) * width, centre.z + Math.sin(angle) * width);
      const b = addNode(network, centre.x - Math.cos(angle) * width, centre.z - Math.sin(angle) * width);
      network.addRoad([a.id, b.id], 'park-trail', { group: 'park' });
    }
  }
}

function addFurnitureDetails(network, rng, settings) {
  if (settings.furniture === 'none') return;
  const rich = settings.furniture === 'full';
  for (const road of network.roads.values()) {
    const points = network.roadPoints(road);
    const length = polylineLength(points);
    if (length < 12) continue;
    const profile = network.effectiveProfile(road);
    const hints = profile.hints || {};

    if (hints.busStop && length > 120) {
      const spacing = rich ? 420 : 700;
      for (let s = spacing * 0.6; s < length - 40; s += spacing) {
        road.details.push(makeDetail('bus-stop', s, {
          side: rng.chance(0.5) ? 'right' : 'left',
          shelter: rng.chance(0.75),
          boarder: true,
        }));
      }
    }

    if (hints.bumps && rng.chance(hints.bumps) && length > 40) {
      const count = Math.max(1, Math.floor(length / 120));
      for (let i = 0; i < count; i++) {
        road.details.push(makeDetail('speed-bump', rng.range(length * 0.2, length * 0.8), {
          kind: rng.chance(0.5) ? 'flat-top' : 'sinusoidal',
          height: rng.range(0.075, 0.11),
          length: rng.range(3.4, 4.4),
        }));
      }
    }

    if (hints.market && length > 30) {
      for (let s = 6; s < length - 6; s += 6) {
        road.details.push(makeDetail('planter', s, { side: rng.chance(0.5) ? 'left' : 'right', count: 1 }));
      }
    }

    if (hints.bollards && length > 30) {
      road.details.push(makeDetail('bollards', length * 0.5, { count: Math.max(3, Math.floor(length / 3)), spacing: 2.4, side: 'both' }));
    }

    if (hints.station && length > 60) {
      road.details.push(makeDetail('subway-entrance', length * 0.5, { side: 'right' }));
    }

    if (profile.id === 'downtown-street' && length > 60) {
      road.details.push(makeDetail('taxi-rank', length * 0.72, { bays: rng.int(2, 4), side: rng.chance(0.5) ? 'right' : 'left' }));
      road.details.push(makeDetail('loading-bay', length * 0.3, { side: rng.chance(0.5) ? 'right' : 'left', length: 12 }));
    }

    if (rich && (profile.id === 'arterial-bus-cycle' || profile.id === 'brt-corridor') && length > 200) {
      road.details.push(makeDetail('pedestrian-crossing', length * 0.5, {
        kind: rng.chance(0.5) ? 'signal' : 'zebra',
        width: 4.4,
        beacons: true,
      }));
    }

    if (rich && profile.id === 'school-street' && length > 50) {
      road.details.push(makeDetail('pedestrian-crossing', length * 0.5, { kind: 'zebra', width: 5, beacons: true }));
      road.details.push(makeDetail('speed-table', length * 0.5, { height: 0.1, length: 8 }));
    }
  }
}

function pruneOrphans(network) {
  const used = new Set();
  for (const road of network.roads.values()) for (const id of road.nodeIds) used.add(id);
  for (const line of network.subways.values()) for (const id of line.nodeIds) used.add(id);
  for (const id of [...network.nodes.keys()]) if (!used.has(id)) network.nodes.delete(id);
}

export { splitRoadAt, buildSegmentIndex, nearestRoad, quadMetrics, zoneFor };
