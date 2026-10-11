// Extrudes a road's cross-section along its centre-line.
//
// Stations carry a local frame (position, tangent, right, up) and a `grade` value
// describing how much of the kerb/upstand height survives at that station.  Near a
// junction the grade falls to zero so footways and central reservations ramp down to
// carriageway level, and the junction patch (see junctions.js) takes over.

import { buildCrossSection, spanMaterialKey } from './crossSection.js';
import { getSurfaceMaterial } from './materials.js';
import { clamp, polylineLength, sampleSpline, smoothstep } from './util.js';

const RAMP = 2.6; // length of the kerb ramp that lowers upstands into a junction

/** Sample a road's control points into evenly spaced stations with local frames. */
export function sampleRoadStations(points, spacing = 4) {
  const length = polylineLength(points);
  const count = clamp(Math.ceil(length / spacing) + 1, 2, 900);
  const pts = sampleSpline(points, count);
  const stations = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // right = tangent x up
    let rx = -tz;
    let rz = tx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const ry = 0;
    // up = right x tangent
    const ux = ry * tz - rz * ty;
    const uy = rz * tx - rx * tz;
    const uz = rx * ty - ry * tx;
    if (i > 0) {
      s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    }
    stations.push({ p, t: [tx, ty, tz], r: [rx, ry, rz], u: [ux, uy, uz], s, grade: 1 });
  }
  return { stations, length, points: pts };
}

/**
 * Vertical offset profile for bridges (rise to a deck) and tunnels (dip to a bore).
 * Returns dy for a station distance.
 */
export function structureProfile(road, structure, length, deckHeight = 6, depth = 7) {
  if (!structure || structure === 'none') return () => 0;
  const ramp = clamp(Math.min(length * 0.35, structure === 'bridge' ? 34 : 40), 8, 60);
  if (structure === 'bridge') {
    const h = deckHeight;
    return (s) => {
      if (s <= 0) return 0;
      if (s >= length) return 0;
      if (s < ramp) return smoothstep(0, ramp, s) * h;
      if (s > length - ramp) return smoothstep(0, ramp, length - s) * h;
      return h;
    };
  }
  // tunnel: dip below grade and stay there, with open ramps at both ends
  return (s) => {
    if (s <= 0) return 0;
    if (s >= length) return 0;
    if (s < ramp) return -smoothstep(0, ramp, s) * depth;
    if (s > length - ramp) return -smoothstep(0, ramp, length - s) * depth;
    return -depth;
  };
}

/** Position of (offset, height) at a station. */
export function stationPoint(station, offset, height) {
  return [
    station.p.x + station.r[0] * offset + station.u[0] * height,
    station.p.y + station.r[1] * offset + station.u[1] * height,
    station.p.z + station.r[2] * offset + station.u[2] * height,
  ];
}

/** Outward normal of a span at a station: rotate the cross-section direction 90°. */
function spanNormal(station, dOffset, dHeight) {
  const nx = station.u[0] * dOffset - station.r[0] * dHeight;
  const ny = station.u[1] * dOffset - station.r[1] * dHeight;
  const nz = station.u[2] * dOffset - station.r[2] * dHeight;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/**
 * Pre-compute everything the marking / detail / structure passes need for one road.
 */
export function prepareRoad(road, ctx) {
  const { network, terrain } = ctx;
  const points = network.roadPoints(road);
  if (points.length < 2) return null;

  const settings = network.settings;
  const profile = network.effectiveProfile(road);
  const cross = buildCrossSection(profile, {
    driveSide: settings.driveSide,
    curbHeight: road.curbHeight ?? settings.curbHeight ?? profile.curbHeight ?? 0.15,
  });

  const spacing = ctx.spacing ?? 4;
  const { stations, length } = sampleRoadStations(
    points.map((p) => ({ x: p.x, y: terrain ? terrain.roadHeight(p.x, p.z, p.y) : p.y ?? 0, z: p.z })),
    spacing,
  );
  if (stations.length < 2) return null;

  const structure = profile.structure || 'none';
  const deckHeight = road.deckHeight ?? (structure === 'bridge' ? 6.5 : 6.5);
  const depth = road.depth ?? 7.5;
  const dy = structureProfile(road, structure, length, deckHeight, depth);
  for (const station of stations) {
    station.p.y += dy(station.s);
  }

  // Junction blending: how much upstand survives at each station.
  const startNode = road.nodeIds[0];
  const endNode = road.nodeIds[road.nodeIds.length - 1];
  const startBlend = ctx.junctionBlend?.get(startNode) ?? 0;
  const endBlend = ctx.junctionBlend?.get(endNode) ?? 0;
  for (const station of stations) {
    let grade = 1;
    if (startBlend > 0) grade = Math.min(grade, smoothstep(startBlend, startBlend + RAMP, station.s));
    if (endBlend > 0) grade = Math.min(grade, smoothstep(endBlend, endBlend + RAMP, length - station.s));
    station.grade = grade;
  }

  return { road, profile, cross, stations, length, structure, deckHeight, depth, dy, points };
}

/** How far along a road a junction's influence reaches (kerb-line wipe). */
export function junctionBlendDistance(node, roads, crossOf, settings) {
  let reach = 0;
  for (const road of roads) {
    const cross = crossOf(road);
    if (!cross) continue;
    // Take the widest element that has to be wiped: footway, verge or reservation.
    reach = Math.max(reach, cross.halfWidth * 1.05 + 0.5);
  }
  return reach;
}

/**
 * Extrude the cross-section.  Raised spans (footways, reservations, kerbs) are
 * scaled by the station grade so they melt away into junctions.
 */
export function buildRoadSurface(prepared, ctx) {
  const { cross, stations, road } = prepared;
  const owner = ctx.ownerOf(road.id);
  const sink = ctx.sink;

  for (const span of cross.spans) {
    const materialKey = spanMaterialKey(span);
    const material = getSurfaceMaterial(materialKey);
    const metersPerTile = material.userData.metersPerTile || 4;
    const inv = 1 / metersPerTile;
    const raised = Math.max(Math.abs(span.a.h), Math.abs(span.b.h)) > 0.03;
    const dOffsetStatic = span.b.o - span.a.o;

    for (let i = 0; i < stations.length - 1; i++) {
      const s0 = stations[i];
      const s1 = stations[i + 1];
      if (raised && s0.grade < 0.002 && s1.grade < 0.002) continue;

      const hA0 = span.a.h * (raised ? s0.grade : 1);
      const hB0 = span.b.h * (raised ? s0.grade : 1);
      const hA1 = span.a.h * (raised ? s1.grade : 1);
      const hB1 = span.b.h * (raised ? s1.grade : 1);
      const dH0 = hB0 - hA0;
      const dH1 = hB1 - hA1;
      if (Math.abs(dOffsetStatic) < 1e-5 && Math.abs(dH0) < 1e-5 && Math.abs(dH1) < 1e-5) continue;

      const p0 = stationPoint(s0, span.a.o, hA0);
      const p1 = stationPoint(s0, span.b.o, hB0);
      const p2 = stationPoint(s1, span.b.o, hB1);
      const p3 = stationPoint(s1, span.a.o, hA1);

      const n0 = spanNormal(s0, dOffsetStatic, dH0);
      const n1 = spanNormal(s1, dOffsetStatic, dH1);

      const u0 = span.u0 * inv;
      const u1 = span.u1 * inv;
      const v0 = s0.s * inv;
      const v1 = s1.s * inv;

      const builder = sink.at((p0[0] + p2[0]) * 0.5, (p0[2] + p2[2]) * 0.5, materialKey);
      builder.quad(p0, p1, p2, p3, [n0, n0, n1, n1], [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ], owner);
    }
  }
}
