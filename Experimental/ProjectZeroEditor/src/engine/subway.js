// Underground railway lines.
//
// Tunnels are cut-away: the floor, inner walls and roof soffit are built but never
// the outside of the roof, so switching the ground to X-ray lets you look straight
// into the box, along the tracks and into the station platforms.

import { getLampMaterial, getSurfaceMaterial } from './materials.js';
import { clamp, sampleSpline, polylineLength } from './util.js';

const GAUGE = 1.435;
const TRACK_SPACING = 3.6;

/** Emit one quad with a constant normal. */
function quad(builder, corners, normal, uvs, owner, flip = false) {
  const [p0, p1, p2, p3] = corners;
  const n = [normal, normal, normal, normal];
  if (flip) builder.quad(p3, p2, p1, p0, n, [uvs[3], uvs[2], uvs[1], uvs[0]], owner);
  else builder.quad(p0, p1, p2, p3, n, uvs, owner);
}

function framesFor(points, spacing = 6) {
  const length = polylineLength(points);
  const count = clamp(Math.ceil(length / spacing) + 1, 2, 900);
  const pts = sampleSpline(points.map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z })), count);
  const frames = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    frames.push({ p, t: [tx, 0, tz], r: [-tz, 0, tx], s });
  }
  return { frames, length };
}

function pointAtFrame(frame, offset, height) {
  return [
    frame.p.x + frame.r[0] * offset,
    frame.p.y + height,
    frame.p.z + frame.r[2] * offset,
  ];
}

/** Rectangular running tunnel between two stations, opened along the top. */
function tunnelSection(ctx, a, b, geometry, materialKey, owner, uvScale) {
  const { halfWidth, floor, height } = geometry;
  const builder = ctx.sink.at(a.p.x, a.p.z, materialKey);
  const inv = uvScale;
  const fa = -halfWidth;
  const fb = halfWidth;
  const yFloor = floor;
  const yRoof = floor + height;

  const a0 = pointAtFrame(a, fa, yFloor);
  const a1 = pointAtFrame(a, fb, yFloor);
  const b0 = pointAtFrame(b, fa, yFloor);
  const b1 = pointAtFrame(b, fb, yFloor);

  // Floor (facing up).
  quad(builder, [a0, a1, b1, b0], [0, 1, 0], [
    [fa * inv, a.s * inv],
    [fb * inv, a.s * inv],
    [fb * inv, b.s * inv],
    [fa * inv, b.s * inv],
  ], owner, true);

  const yTop = yRoof;
  const a0t = pointAtFrame(a, fa, yTop);
  const a1t = pointAtFrame(a, fb, yTop);
  const b0t = pointAtFrame(b, fa, yTop);
  const b1t = pointAtFrame(b, fb, yTop);

  // Roof soffit (facing down) — no exterior, so the tunnel reads as a cutaway.
  quad(builder, [a0t, a1t, b1t, b0t], [0, -1, 0], [
    [fa * inv, a.s * inv],
    [fb * inv, a.s * inv],
    [fb * inv, b.s * inv],
    [fa * inv, b.s * inv],
  ], owner);

  // Side walls (facing inward).
  quad(builder, [a0, b0, b0t, a0t], [a.r[0], 0, a.r[2]], [
    [a.s * inv, yFloor * inv],
    [b.s * inv, yFloor * inv],
    [b.s * inv, yTop * inv],
    [a.s * inv, yTop * inv],
  ], owner);
  quad(builder, [a1, b1, b1t, a1t], [-a.r[0], 0, -a.r[2]], [
    [a.s * inv, yFloor * inv],
    [b.s * inv, yFloor * inv],
    [b.s * inv, yTop * inv],
    [a.s * inv, yTop * inv],
  ], owner, true);
}

/** Two tracks: bed, sleepers texture, rails and a central walkway. */
function trackForm(ctx, frames, geometry, owner) {
  const { floor } = geometry;
  const builder = ctx.sink.at(frames[0].p.x, frames[0].p.z, 'sleepers');
  const inv = 1 / 2.4;
  for (const trackOffset of [-TRACK_SPACING / 2, TRACK_SPACING / 2]) {
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const o0 = trackOffset - 1.35;
      const o1 = trackOffset + 1.35;
      const p0 = pointAtFrame(a, o0, floor + 0.16);
      const p1 = pointAtFrame(a, o1, floor + 0.16);
      const p2 = pointAtFrame(b, o1, floor + 0.16);
      const p3 = pointAtFrame(b, o0, floor + 0.16);
      builder.quad(p0, p1, p2, p3, null, [
        [0, a.s * inv],
        [2.7 * inv, a.s * inv],
        [2.7 * inv, b.s * inv],
        [0, b.s * inv],
      ], owner);
    }
    // Rails.
    const railBuilder = ctx.sink.at(frames[0].p.x, frames[0].p.z, 'metal');
    for (const lateral of [-GAUGE / 2, GAUGE / 2]) {
      for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        const o = trackOffset + lateral;
        const w = 0.035;
        const top = floor + 0.34;
        const p0 = pointAtFrame(a, o - w, top);
        const p1 = pointAtFrame(a, o + w, top);
        const p2 = pointAtFrame(b, o + w, top);
        const p3 = pointAtFrame(b, o - w, top);
        railBuilder.quad(p0, p1, p2, p3, null, [[0, a.s], [0.07, a.s], [0.07, b.s], [0, b.s]], owner);
      }
    }
  }

  // Cable trays and lighting along the walls.
  const lampKey = 'subway-light';
  ctx.sink.registerMaterial(lampKey, getLampMaterial(0xfff0cf, 2.2));
  const lampBuilder = ctx.sink.at(frames[0].p.x, frames[0].p.z, lampKey);
  for (let i = 0; i < frames.length - 1; i += 2) {
    const a = frames[i];
    const b = frames[Math.min(frames.length - 1, i + 1)];
    for (const side of [-1, 1]) {
      const o = side * (geometry.halfWidth - 0.25);
      const y = geometry.floor + geometry.height - 0.35;
      const p0 = pointAtFrame(a, o - 0.08, y);
      const p1 = pointAtFrame(a, o + 0.08, y);
      const p2 = pointAtFrame(b, o + 0.08, y);
      const p3 = pointAtFrame(b, o - 0.08, y);
      lampBuilder.quad(p0, p1, p2, p3, null, [[0, 0], [1, 0], [1, 1], [0, 1]], owner);
    }
  }
}

/** Station box: wider tunnel, platforms, tactile edges, columns and a shaft. */
function station(ctx, frames, center, geometry, line, owner) {
  const length = 96;
  const s0 = clamp(center - length / 2, 0, frames[frames.length - 1].s);
  const s1 = clamp(center + length / 2, 0, frames[frames.length - 1].s);
  const section = frames.filter((f) => f.s >= s0 && f.s <= s1);
  if (section.length < 2) return;
  const stationGeometry = {
    halfWidth: geometry.halfWidth + 2.6,
    floor: geometry.floor,
    height: geometry.height + 1.6,
  };
  for (let i = 0; i < section.length - 1; i++) {
    tunnelSection(ctx, section[i], section[i + 1], stationGeometry, 'tile', owner, 0.5);
  }

  // Platforms either side.
  const platformHeight = 0.95;
  const platformWidth = 3.6;
  const slabBuilder = ctx.sink.at(section[0].p.x, section[0].p.z, 'slab');
  const kerbBuilder = ctx.sink.at(section[0].p.x, section[0].p.z, 'kerb');
  for (const side of [-1, 1]) {
    const oInner = side * (TRACK_SPACING / 2 + 1.5);
    const oOuter = side * (stationGeometry.halfWidth - 0.2);
    for (let i = 0; i < section.length - 1; i++) {
      const a = section[i];
      const b = section[i + 1];
      const p0 = pointAtFrame(a, oInner, stationGeometry.floor + platformHeight);
      const p1 = pointAtFrame(a, oOuter, stationGeometry.floor + platformHeight);
      const p2 = pointAtFrame(b, oOuter, stationGeometry.floor + platformHeight);
      const p3 = pointAtFrame(b, oInner, stationGeometry.floor + platformHeight);
      slabBuilder.quad(p0, p1, p2, p3, null, [[0, a.s * 0.5], [platformWidth * 0.5, a.s * 0.5], [platformWidth * 0.5, b.s * 0.5], [0, b.s * 0.5]], owner);
      // Platform edge upstand.
      const q0 = pointAtFrame(a, oInner, stationGeometry.floor);
      const q1 = pointAtFrame(b, oInner, stationGeometry.floor);
      kerbBuilder.quad(p0, p3, q1, q0, null, [[0, 1], [1, 1], [1, 0], [0, 0]], owner);
    }
  }

  // Columns down the middle.
  const columnBuilder = ctx.sink.at(section[0].p.x, section[0].p.z, 'wall');
  for (let s = s0 + 8; s < s1; s += 12) {
    const frame = frames.find((f) => f.s >= s) || section[0];
    const base = pointAtFrame(frame, 0, stationGeometry.floor);
    const top = pointAtFrame(frame, 0, stationGeometry.floor + stationGeometry.height - 0.2);
    const w = 0.7;
    for (const [o0, o1] of [[-w, w]]) {
      const corners = [
        pointAtFrame(frame, o0, stationGeometry.floor),
        pointAtFrame(frame, o1, stationGeometry.floor),
      ];
      columnBuilder.quad(
        [corners[0][0], base[1], corners[0][2]],
        [corners[1][0], base[1], corners[1][2]],
        [corners[1][0], top[1], corners[1][2]],
        [corners[0][0], top[1], corners[0][2]],
        null,
        null,
        owner,
      );
    }
  }

  // Access shaft up to street level, with a small canopy.
  const mid = section[Math.floor(section.length / 2)];
  const surfaceY = ctx.terrain ? ctx.terrain.heightAt(mid.p.x, mid.p.z) : 0;
  const shaftBuilder = ctx.sink.at(mid.p.x, mid.p.z, 'wall');
  const shaftOffset = stationGeometry.halfWidth * 0.55;
  for (const side of [-1, 1]) {
    const o = side * shaftOffset;
    const p0 = pointAtFrame(mid, o - 2.4, stationGeometry.floor + stationGeometry.height);
    const p1 = pointAtFrame(mid, o + 2.4, stationGeometry.floor + stationGeometry.height);
    const p2 = [p1[0], surfaceY + 0.35, p1[2]];
    const p3 = [p0[0], surfaceY + 0.35, p0[2]];
    shaftBuilder.quad(p0, p1, p2, p3, null, [[0, 0], [4.8, 0], [4.8, 6], [0, 6]], owner);
  }
  const canopyBuilder = ctx.sink.at(mid.p.x, mid.p.z, 'metal');
  const c0 = pointAtFrame(mid, -shaftOffset - 2.6, surfaceY + 0.35);
  const c1 = pointAtFrame(mid, shaftOffset + 2.6, surfaceY + 0.35);
  const along = 3.4;
  const d = [mid.t[0] * along, 0, mid.t[2] * along];
  canopyBuilder.quad(
    [c0[0] - d[0], surfaceY + 2.9, c0[2] - d[2]],
    [c1[0] - d[0], surfaceY + 2.9, c1[2] - d[2]],
    [c1[0] + d[0], surfaceY + 2.9, c1[2] + d[2]],
    [c0[0] + d[0], surfaceY + 2.9, c0[2] + d[2]],
    null,
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    owner,
  );
}

export function buildSubway(line, ctx) {
  const points = line.nodeIds.map((id) => ctx.network.getNode(id)).filter(Boolean);
  if (points.length < 2) return;
  const { frames, length } = framesFor(points, 6);
  const depth = line.depth ?? -13;
  const geometry = { halfWidth: 5.2, floor: depth, height: 6.2 };
  const owner = ctx.ownerOf(`subway:${line.id}`);

  for (const frame of frames) frame.p.y = 0; // heights are absolute in the subway builder

  for (let i = 0; i < frames.length - 1; i++) {
    tunnelSection(ctx, frames[i], frames[i + 1], geometry, 'wall', owner, 0.35);
  }
  trackForm(ctx, frames, geometry, owner);

  for (const stop of line.stations || []) {
    station(ctx, frames, clamp(stop.s ?? 0, 0, length), geometry, line, owner);
  }
}

/** Approximate station positions along a line, used by the city generator. */
export function planStations(line, spacing = 700, offset = 240) {
  const points = line.nodeIds.map((id) => line.__nodes?.[id]).filter(Boolean);
  return [];
}

export const SUBWAY_DEFAULTS = { depth: -13, halfWidth: 5.2, height: 6.2, gauge: GAUGE, spacing: TRACK_SPACING };
