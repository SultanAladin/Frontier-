// Junction patches and roundabouts.
//
// A junction is drawn as two star-shaped polygons built around the shared node:
//   * an inner carriageway patch (asphalt), covering the union of every approach's
//     running lanes; and
//   * an outer band (paving), covering the union of every approach's full width,
//     including footways.
// Footways ramp down to carriageway level before the junction, so the outer band
// reads as a continuous footway across the mouth of every side road.
//
// Roundabouts get a dedicated builder: circulatory annulus, raised island, kerbs,
// footway ring that is cut open at each approach, splitter islands and give-way
// markings (markings themselves are painted by markings.js).

import { getSurfaceMaterial } from './materials.js';
import { clamp } from './util.js';

const SEGMENTS = 64;
const ROUNDABOUT_SEGMENTS = 96;
const TWO_PI = Math.PI * 2;

function angleOf(dx, dz) {
  return Math.atan2(dz, dx);
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Radial extent of one road's corridor at angle `theta` relative to its axis. */
function corridorReach(delta, halfWidth, length) {
  const c = Math.cos(delta);
  if (c <= 0.002) return 0;
  const s = Math.abs(Math.sin(delta));
  return Math.min(length / c, halfWidth / Math.max(s, 1e-4));
}

function unionRadius(entries) {
  return (theta) => {
    let best = 0;
    for (const entry of entries) {
      const r = corridorReach(angleDelta(theta, entry.angle), entry.halfWidth, entry.length);
      if (r > best) best = r;
    }
    return best;
  };
}

function sampleRing(cx, cz, y, radiusFn, segments = SEGMENTS) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * TWO_PI;
    const r = radiusFn(theta);
    points.push([cx + Math.cos(theta) * r, y, cz + Math.sin(theta) * r]);
  }
  return points;
}

/** Fan-filled star-shaped polygon, facing +Y. */
function addFan(builder, cx, cz, y, ring, owner, uvScale) {
  const center = [cx, y, cz];
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    builder.tri(
      center,
      ring[next],
      ring[i],
      [[0, 1, 0], [0, 1, 0], [0, 1, 0]],
      [
        [cx * uvScale, cz * uvScale],
        [ring[next][0] * uvScale, ring[next][2] * uvScale],
        [ring[i][0] * uvScale, ring[i][2] * uvScale],
      ],
      owner,
    );
  }
}

/**
 * Band between two concentric star-shaped rings.  `mask(i, segments)` may veto a
 * segment, which is how the roundabout footway is opened at each approach.
 */
function addBand(builder, inner, outer, owner, uvScale, mask = null) {
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    if (mask && !mask(i, n)) continue;
    const next = (i + 1) % n;
    builder.quad(inner[i], inner[next], outer[next], outer[i], null, [
      [inner[i][0] * uvScale, inner[i][2] * uvScale],
      [inner[next][0] * uvScale, inner[next][2] * uvScale],
      [outer[next][0] * uvScale, outer[next][2] * uvScale],
      [outer[i][0] * uvScale, outer[i][2] * uvScale],
    ], owner);
  }
}

function uvScaleFor(materialKey) {
  const material = getSurfaceMaterial(materialKey);
  return 1 / (material.userData.metersPerTile || 4);
}

/** Outward direction of a road at a node, plus its cross-section half-widths. */
function approachAt(road, nodeId, prepared, network) {
  const prep = prepared;
  const cross = prep?.cross;
  const node = network.getNode(nodeId);
  let dx;
  let dz;
  const isStart = road.nodeIds[0] === nodeId;
  const isEnd = road.nodeIds[road.nodeIds.length - 1] === nodeId;
  const points = prep?.points || network.roadPoints(road);
  if (points.length < 2) return null;

  if (isStart || isEnd) {
    const a = isStart ? points[0] : points[points.length - 1];
    const b = isStart ? points[1] : points[points.length - 2];
    dx = b.x - a.x;
    dz = b.z - a.z;
  } else {
    // Node sits mid-road: take the tangent from the nearest sampled station.
    let best = null;
    for (const station of prep?.stations || []) {
      const d = Math.hypot(station.p.x - (node?.x ?? 0), station.p.z - (node?.z ?? 0));
      if (!best || d < best.d) best = { d, t: station.t };
    }
    if (!best) return null;
    dx = best.t[0];
    dz = best.t[2];
  }
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const halfCarriage = cross ? Math.max(Math.abs(cross.carriageLeft), Math.abs(cross.carriageRight)) : 4;
  const halfFull = cross ? cross.halfWidth : 5;
  return { angle: angleOf(dx, dz), halfCarriage, halfFull, dir: [dx, dz] };
}

/**
 * Build every junction patch in the network.
 * Returns Map<nodeId, wipeDistance> so roadBuilder can ramp footways down before
 * they reach the junction.
 */
export function buildJunctions(ctx) {
  const { sink, network, prepared, ownerOf, terrain, roadsByNode } = ctx;
  const blend = new Map();

  for (const [nodeId, roadIds] of roadsByNode) {
    const node = network.getNode(nodeId);
    if (!node) continue;
    if (node.kind === 'roundabout') {
      blend.set(nodeId, buildRoundabout(node, roadIds, ctx));
      continue;
    }
    if (roadIds.length < 2) continue;

    const approaches = [];
    for (const roadId of roadIds) {
      const road = network.getRoad(roadId);
      if (!road) continue;
      const approach = approachAt(road, nodeId, prepared.get(roadId), network);
      if (approach) approaches.push({ roadId, ...approach });
    }
    if (approaches.length < 2) continue;

    for (const approach of approaches) {
      let inner = 4;
      let outer = 4;
      for (const other of approaches) {
        if (other === approach) continue;
        const s = Math.max(Math.abs(Math.sin(angleDelta(approach.angle, other.angle))), 0.08);
        inner = Math.max(inner, other.halfCarriage / s + 1.6);
        outer = Math.max(outer, other.halfFull / s + 1.6);
      }
      approach.length = clamp(inner, 4, 34);
      approach.outerLength = clamp(outer, 4, 44);
    }

    const innerRadius = unionRadius(approaches.map((a) => ({ angle: a.angle, halfWidth: a.halfCarriage + 0.25, length: a.length })));
    const outerRadius = unionRadius(approaches.map((a) => ({ angle: a.angle, halfWidth: a.halfFull, length: a.outerLength })));

    const base = terrain ? terrain.roadHeight(node.x, node.z, node.y) : node.y || 0;
    const owner = ownerOf(approaches[0].roadId);

    const innerRing = sampleRing(node.x, node.z, base + 0.035, innerRadius);
    const outerRing = sampleRing(node.x, node.z, base + 0.02, outerRadius);

    const outerBuilder = sink.at(node.x, node.z, 'slab');
    addBand(outerBuilder, innerRing, outerRing, owner, uvScaleFor('slab'));
    const innerBuilder = sink.at(node.x, node.z, 'asphalt');
    addFan(innerBuilder, node.x, node.z, base + 0.035, innerRing, owner, uvScaleFor('asphalt'));

    let wipe = 0;
    for (const approach of approaches) wipe = Math.max(wipe, approach.outerLength);
    blend.set(nodeId, wipe + 1.0);
  }

  return blend;
}

/* ------------------------------------------------------------------ */
/* Roundabouts                                                         */
/* ------------------------------------------------------------------ */

export function roundaboutMetrics(node) {
  const lanes = node.lanes ?? 1;
  const laneWidth = node.laneWidth ?? 4.6;
  const island = node.radius ?? 12;
  const circulatory = node.circulatory ?? lanes * laneWidth + 0.9;
  const footway = node.footway ?? 3;
  return {
    island,
    circulatory,
    laneWidth,
    lanes,
    inner: island,
    outer: island + circulatory,
    footwayOuter: island + circulatory + footway,
    footway,
  };
}

/**
 * Circulatory annulus + island + kerbs + footway ring (opened at each approach) +
 * splitter islands.  Returns the kerb-wipe distance for connecting roads.
 */
function buildRoundabout(node, roadIds, ctx) {
  const { sink, network, prepared, ownerOf, terrain } = ctx;
  const m = roundaboutMetrics(node);
  const base = terrain ? terrain.roadHeight(node.x, node.z, node.y) : node.y || 0;
  const owner = ownerOf(roadIds[0] || `rb:${node.id}`);
  const seg = ROUNDABOUT_SEGMENTS;
  const cx = node.x;
  const cz = node.z;

  const asphaltKey = 'asphalt';
  const slabKey = node.surface || 'slab';
  const kerbKey = node.kerbSurface || 'kerb';
  const islandKey = node.islandSurface || 'grass';
  const asphaltUv = uvScaleFor(asphaltKey);
  const slabUv = uvScaleFor(slabKey);
  const kerbUv = uvScaleFor(kerbKey);

  const asphaltBuilder = sink.at(cx, cz, asphaltKey);
  const slabBuilder = sink.at(cx, cz, slabKey);
  const kerbBuilder = sink.at(cx, cz, kerbKey);
  const islandBuilder = sink.at(cx, cz, islandKey);

  // Which angles are occupied by an approach?  Used to open the footway ring.
  const mouths = [];
  for (const roadId of roadIds) {
    const road = network.getRoad(roadId);
    if (!road) continue;
    const approach = approachAt(road, node.id, prepared.get(roadId), network);
    if (approach) mouths.push(approach);
  }
  const mouthMask = (radius, pad = 0.03) => (i, n) => {
    const theta = ((i + 0.5) / n) * TWO_PI;
    for (const mouth of mouths) {
      const halfAngle = Math.asin(clamp((mouth.halfFull + 0.2) / radius, -0.999, 0.999)) + pad;
      if (Math.abs(angleDelta(theta, mouth.angle)) < halfAngle) return false;
    }
    return true;
  };

  const ring = (radius, y) => {
    const points = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TWO_PI;
      points.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
    }
    return points;
  };

  /**
   * Vertical cylindrical face from (radius, yBottom) to (radius, yTop).
   * `flip` sends the normal inward instead of outward.
   */
  const arc = (radius, yBottom, yTop, builder, uvScale, mask = null, flip = false) => {
    for (let i = 0; i < seg; i++) {
      if (mask && !mask(i, seg)) continue;
      const a0 = (i / seg) * TWO_PI;
      const a1 = ((i + 1) / seg) * TWO_PI;
      const p0 = [cx + Math.cos(a0) * radius, yBottom, cz + Math.sin(a0) * radius];
      const p1 = [cx + Math.cos(a1) * radius, yBottom, cz + Math.sin(a1) * radius];
      const p2 = [cx + Math.cos(a1) * radius, yTop, cz + Math.sin(a1) * radius];
      const p3 = [cx + Math.cos(a0) * radius, yTop, cz + Math.sin(a0) * radius];
      const u0 = (i / seg) * radius * 0.5 * uvScale;
      const u1 = ((i + 1) / seg) * radius * 0.5 * uvScale;
      const v0 = 0;
      const v1 = (yTop - yBottom) * uvScale;
      // Default winding faces outwards; `flip` turns the face inwards.
      if (flip) builder.quad(p0, p1, p2, p3, null, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], owner);
      else builder.quad(p3, p2, p1, p0, null, [[u0, v1], [u1, v1], [u1, v0], [u0, v0]], owner);
    }
  };

  // Carriageway annulus.
  addBand(asphaltBuilder, ring(m.inner, base + 0.035), ring(m.outer, base + 0.035), owner, asphaltUv);
  // Island top.
  addFan(islandBuilder, cx, cz, base + 0.16, ring(m.inner, base + 0.16), owner, uvScaleFor(islandKey));
  // Island kerb (faces outward, towards traffic).
  arc(m.inner, base + 0.03, base + 0.16, kerbBuilder, kerbUv);
  // Outer kerb of the circulatory carriageway (faces inward).
  arc(m.outer, base + 0.03, base + 0.16, kerbBuilder, kerbUv, null, true);

  // Footway ring, opened at each approach.
  const footwayMask = mouthMask(m.footwayOuter - m.footway * 0.5);
  addBand(slabBuilder, ring(m.outer + 0.05, base + 0.16), ring(m.footwayOuter, base + 0.16), owner, slabUv, footwayMask);
  arc(m.footwayOuter, base - 0.35, base + 0.16, kerbBuilder, kerbUv, footwayMask);

  // Splitter islands on each approach.
  for (const mouth of mouths) {
    const width = clamp(mouth.halfFull * 0.17, 1.1, 2.6);
    const [dx, dz] = mouth.dir;
    const px = -dz;
    const pz = dx;
    const kerbH = 0.16;
    const start = m.footwayOuter + 0.6;
    const end = start + 12;
    const nose = width * 0.9;
    const corner = (o, s, h) => [cx + dx * s + px * o, base + h, cz + dz * s + pz * o];
    const top = [
      corner(-width, end, kerbH),
      corner(-width, start + nose, kerbH),
      corner(0, start, kerbH),
      corner(width, start + nose, kerbH),
      corner(width, end, kerbH),
    ];
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      kerbBuilder.quad(
        top[i],
        top[j],
        [top[j][0], base, top[j][2]],
        [top[i][0], base, top[i][2]],
        null,
        [[0, 0], [1, 0], [1, 0.16], [0, 0.16]],
        owner,
      );
    }
    addFan(slabBuilder, top[0][0], top[0][2], base + kerbH, top, owner, slabUv);
  }

  return m.footwayOuter + 2.5;
}

export { angleDelta, angleOf };
