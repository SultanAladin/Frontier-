// Road markings.
//
// Longitudinal lines, kerbside bay ticks, lane glyphs, stop bars, give-way teeth,
// zebra crossings, junction arrows and roundabout circulatory arrows.  Everything is
// painted as thin decals lifted a couple of centimetres off the running surface and
// suppressed inside junction wipe zones.

import {
  getGiveWayMaterial,
  getGlyphMaterial,
  getHatchMaterial,
  getLineMaterial,
  getMarkingMaterial,
  getZebraMaterial,
} from './materials.js';
import { clamp } from './util.js';

const WHITE = 0xf4f3ee;
const YELLOW = 0xe4c340;

const DECAL = 0.024; // height above the running surface

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function decalBuilder(ctx, x, z, key, factory) {
  if (!ctx.markingMaterials) ctx.markingMaterials = new Map();
  let material = ctx.markingMaterials.get(key);
  if (!material) {
    material = factory();
    material.userData.isMarking = true;
    ctx.sink.registerMaterial(key, material);
    ctx.markingMaterials.set(key, material);
  }
  return ctx.sink.at(x, z, key);
}

function solid() {
  return getMarkingMaterial('solid-white', { color: WHITE });
}

function frameAt(prepared, s) {
  const stations = prepared.stations;
  if (s <= stations[0].s) return stations[0];
  if (s >= stations[stations.length - 1].s) return stations[stations.length - 1];
  let lo = 0;
  let hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = stations[lo];
  const b = stations[hi];
  const span = b.s - a.s || 1;
  const f = (s - a.s) / span;
  return {
    p: {
      x: a.p.x + (b.p.x - a.p.x) * f,
      y: a.p.y + (b.p.y - a.p.y) * f,
      z: a.p.z + (b.p.z - a.p.z) * f,
    },
    r: [
      a.r[0] + (b.r[0] - a.r[0]) * f,
      a.r[1] + (b.r[1] - a.r[1]) * f,
      a.r[2] + (b.r[2] - a.r[2]) * f,
    ],
    u: [
      a.u[0] + (b.u[0] - a.u[0]) * f,
      a.u[1] + (b.u[1] - a.u[1]) * f,
      a.u[2] + (b.u[2] - a.u[2]) * f,
    ],
    t: [
      a.t[0] + (b.t[0] - a.t[0]) * f,
      a.t[1] + (b.t[1] - a.t[1]) * f,
      a.t[2] + (b.t[2] - a.t[2]) * f,
    ],
    s,
    grade: a.grade + (b.grade - a.grade) * f,
  };
}

function pointAt(frame, offset, height) {
  return [
    frame.p.x + frame.r[0] * offset + frame.u[0] * height,
    frame.p.y + frame.r[1] * offset + frame.u[1] * height,
    frame.p.z + frame.r[2] * offset + frame.u[2] * height,
  ];
}

/**
 * Longitudinal ribbon following a constant lateral offset between two stations.
 * `tileMeters` sets how the dash pattern repeats (0 = solid).
 */
function addLongitudinalLine(ctx, prepared, options) {
  const {
    offset,
    width = 0.12,
    from = 0,
    to = prepared.length,
    laneHeight = 0,
    materialKey,
    material,
    tileMeters = 6,
    owner = 0,
  } = options;
  const stations = prepared.stations;
  const half = width / 2;
  const h = laneHeight + DECAL;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const mid = (a.s + b.s) * 0.5;
    if (mid < from || mid > to) continue;
    if (a.grade < 0.5 && b.grade < 0.5) continue;
    const p0 = pointAt(a, offset - half, h);
    const p1 = pointAt(a, offset + half, h);
    const p2 = pointAt(b, offset + half, h);
    const p3 = pointAt(b, offset - half, h);
    const v0 = tileMeters > 0 ? a.s / tileMeters : 0;
    const v1 = tileMeters > 0 ? b.s / tileMeters : 1;
    const builder = decalBuilder(ctx, (p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, materialKey, () => material);
    builder.quad(p0, p1, p2, p3, null, [[0, v0], [1, v0], [1, v1], [0, v1]], owner);
  }
}

/** Transverse band across part of the carriageway (stop bars, crossings, boxes). */
function addTransverseBand(ctx, prepared, options) {
  const {
    s,
    depth,
    fromOffset,
    toOffset,
    materialKey,
    material,
    laneHeight = 0,
    owner = 0,
    uRepeat = 1,
  } = options;
  const s0 = clamp(s - depth / 2, 0, prepared.length);
  const s1 = clamp(s + depth / 2, 0, prepared.length);
  if (s1 - s0 < 0.05) return;
  const a = frameAt(prepared, s0);
  const b = frameAt(prepared, s1);
  const h = laneHeight + DECAL;
  const p0 = pointAt(a, fromOffset, h);
  const p1 = pointAt(a, toOffset, h);
  const p2 = pointAt(b, toOffset, h);
  const p3 = pointAt(b, fromOffset, h);
  const builder = decalBuilder(ctx, (p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, materialKey, () => material);
  builder.quad(p0, p1, p2, p3, null, [[0, 0], [uRepeat, 0], [uRepeat, 1], [0, 1]], owner);
}

/** Square glyph laid flat, its texture "up" pointing along (dirX, dirZ). */
function addWorldGlyph(ctx, { x, z, y, size, dirX, dirZ, material, materialKey, owner = 0 }) {
  const len = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / len;
  const dz = dirZ / len;
  const rx = -dz;
  const rz = dx;
  const h = size / 2;
  const c0 = [x - rx * h - dx * h, y, z - rz * h - dz * h];
  const c1 = [x + rx * h - dx * h, y, z + rz * h - dz * h];
  const c2 = [x + rx * h + dx * h, y, z + rz * h + dz * h];
  const c3 = [x - rx * h + dx * h, y, z - rz * h + dz * h];
  const builder = decalBuilder(ctx, x, z, materialKey, () => material);
  builder.quad(c0, c1, c2, c3, null, [[0, 0], [1, 0], [1, 1], [0, 1]], owner);
}

/* ------------------------------------------------------------------ */
/* per-road markings                                                   */
/* ------------------------------------------------------------------ */

const DASHED = [0.5, 0.5];
const LONG_DASH = [0.66, 0.34];

export function buildRoadMarkings(prepared, ctx) {
  const { profile, cross, road } = prepared;
  const owner = ctx.ownerOf(road.id);
  const lanes = cross.lanes;
  const spacing = 4;

  const startClip = ctx.junctionBlend?.get(road.nodeIds[0]) ?? 0;
  const endClip = ctx.junctionBlend?.get(road.nodeIds[road.nodeIds.length - 1]) ?? 0;
  const from = startClip;
  const to = prepared.length - endClip;
  if (to - from < 1) return;

  const laneKind = (index) => lanes[index]?.kind;
  const boundary = (left, right) => (left.o1 + right.o0) / 2;

  // --- lane lines -------------------------------------------------
  for (let i = 0; i < lanes.length - 1; i++) {
    const left = lanes[i];
    const right = lanes[i + 1];
    if (!left.drivable && !right.drivable) continue;
    if ((!left.drivable || !right.drivable) && !(laneKind(i) === 'parking' || laneKind(i + 1) === 'parking')) continue;
    const offset = boundary(left, right);
    const height = Math.max(left.h, right.h);

    let key = null;
    let material = null;
    let width = 0.12;
    let tile = 6;

    if (left.kind === 'parking' || right.kind === 'parking') {
      key = 'park-edge';
      material = getLineMaterial([0.4, 0.6], WHITE, 2.5);
      width = 0.1;
      tile = 2.5;
    } else if (left.kind === 'bus' || right.kind === 'bus') {
      key = 'bus-edge';
      material = solid();
      width = 0.2;
    } else if (left.kind === 'cycle' || right.kind === 'cycle') {
      key = 'cycle-edge';
      material = solid();
      width = 0.15;
    } else if (left.kind === 'shoulder' || right.kind === 'shoulder') {
      key = 'carriage-edge';
      material = solid();
      width = 0.15;
    } else if (left.dir !== 0 && right.dir !== 0 && left.dir !== right.dir) {
      // Centre line.
      const style = profile.centerLine || 'none';
      if (style === 'double-yellow' || style === 'double-white') {
        const color = style === 'double-yellow' ? YELLOW : WHITE;
        addLongitudinalLine(ctx, prepared, {
          offset: offset - 0.13,
          width: 0.1,
          from,
          to,
          laneHeight: height,
          materialKey: `center-${style}-a`,
          material: solid(),
          owner,
        });
        addLongitudinalLine(ctx, prepared, {
          offset: offset + 0.13,
          width: 0.1,
          from,
          to,
          laneHeight: height,
          materialKey: `center-${style}-b`,
          material: getMarkingMaterial(`solid-${style}`, { color }),
          owner,
        });
        continue;
      }
      if (style === 'single-white') {
        key = 'center-single';
        material = solid();
        width = 0.14;
      } else if (style === 'dashed-white') {
        key = 'center-dashed';
        material = getLineMaterial(DASHED, WHITE, 6);
        width = 0.14;
        tile = 6;
      } else {
        continue;
      }
    } else if (left.dir !== 0 && left.dir === right.dir) {
      key = 'lane-dashed';
      material = getLineMaterial(left.width > 3.4 ? LONG_DASH : DASHED, WHITE, 6);
      width = 0.12;
      tile = 6;
    } else {
      continue;
    }

    addLongitudinalLine(ctx, prepared, {
      offset,
      width,
      from,
      to,
      laneHeight: height,
      materialKey: key,
      material,
      tileMeters: tile,
      owner,
    });
  }

  // --- edge lines -------------------------------------------------
  if (profile.edgeLine && profile.edgeLine !== 'none') {
    const drivable = cross.drivable;
    if (drivable.length) {
      const first = drivable[0];
      const last = drivable[drivable.length - 1];
      const material = profile.edgeLine === 'dashed' ? getLineMaterial(DASHED, WHITE, 6) : solid();
      const tile = profile.edgeLine === 'dashed' ? 6 : 0;
      if (first.o0 > cross.carriageLeft - 0.01) {
        addLongitudinalLine(ctx, prepared, {
          offset: first.o0 + 0.15,
          width: 0.15,
          from,
          to,
          laneHeight: first.h,
          materialKey: `edge-${profile.edgeLine}`,
          material,
          tileMeters: tile,
          owner,
        });
      }
      if (last.o1 < cross.carriageRight + 0.01) {
        addLongitudinalLine(ctx, prepared, {
          offset: last.o1 - 0.15,
          width: 0.15,
          from,
          to,
          laneHeight: last.h,
          materialKey: `edge-${profile.edgeLine}`,
          material,
          tileMeters: tile,
          owner,
        });
      }
    }
  }

  // --- hatching, bays and glyphs ----------------------------------
  for (const lane of lanes) {
    if (lane.kind === 'median' && lane.variant === 'hatched') {
      addHatchedLane(ctx, prepared, lane, from, to, owner);
    } else if (lane.kind === 'buffer') {
      addHatchedLane(ctx, prepared, lane, from, to, owner);
    } else if (lane.kind === 'parking') {
      addParkingBays(ctx, prepared, lane, from, to, owner, lane.variant === 'loading');
    } else if (lane.kind === 'bus' && lane.dir !== 0) {
      addGlyphRun(ctx, prepared, lane, 'bus', from, to, 38, owner);
    } else if (lane.kind === 'cycle' && lane.dir !== 0) {
      addGlyphRun(ctx, prepared, lane, 'cycle', from, to, 32, owner);
    } else if (lane.kind === 'hov' && lane.dir !== 0) {
      addGlyphRun(ctx, prepared, lane, 'diamond', from, to, 45, owner);
    } else if (lane.kind === 'shared' && lane.variant === 'cycle-street') {
      addGlyphRun(ctx, prepared, lane, 'cycle', from, to, 26, owner);
    }
  }

  // --- speed roundels on calm streets ------------------------------
  if (profile.hints?.school) {
    for (let s = from + 12; s < to - 6; s += 45) {
      const lane = cross.drivable[0];
      if (!lane) break;
      const frame = frameAt(prepared, s);
      const p = pointAt(frame, (lane.o0 + lane.o1) / 2, lane.h + DECAL);
      addWorldGlyph(ctx, {
        x: p[0],
        z: p[2],
        y: p[1],
        size: Math.min(lane.width * 0.9, 1.8),
        dirX: frame.t[0],
        dirZ: frame.t[2],
        material: getGlyphMaterial('speed', '#f4f3ee'),
        materialKey: 'glyph-speed',
        owner,
      });
    }
  }
}

function addHatchedLane(ctx, prepared, lane, from, to, owner) {
  const width = lane.o1 - lane.o0;
  if (width < 0.2) return;
  const stations = prepared.stations;
  const material = getHatchMaterial(45);
  const key = 'hatch-45';
  const h = lane.h + DECAL;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const mid = (a.s + b.s) * 0.5;
    if (mid < from || mid > to) continue;
    const p0 = pointAt(a, lane.o0, h);
    const p1 = pointAt(a, lane.o1, h);
    const p2 = pointAt(b, lane.o1, h);
    const p3 = pointAt(b, lane.o0, h);
    const builder = decalBuilder(ctx, (p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, key, () => material);
    builder.quad(p0, p1, p2, p3, null, [
      [0, a.s / 2],
      [width / 2, a.s / 2],
      [width / 2, b.s / 2],
      [0, b.s / 2],
    ], owner);
  }
}

function addParkingBays(ctx, prepared, lane, from, to, owner, loading) {
  const outer = lane.dir > 0 ? lane.o1 : lane.o0;
  if (loading) {
    addLongitudinalLine(ctx, prepared, {
      offset: outer - Math.sign(outer) * 0.12,
      width: 0.18,
      from,
      to,
      laneHeight: lane.h,
      materialKey: 'loading-kerb',
      material: getMarkingMaterial('solid-loading', { color: YELLOW }),
      owner,
    });
    return;
  }
  addLongitudinalLine(ctx, prepared, {
    offset: outer - Math.sign(outer) * 0.1,
    width: 0.1,
    from,
    to,
    laneHeight: lane.h,
    materialKey: 'bay-line',
    material: getLineMaterial([0.82, 0.18], WHITE, 5.4),
    tileMeters: 5.4,
    owner,
  });
  // Transverse divider ticks between bays.
  for (let s = from + 2.7; s < to; s += 5.4) {
    addTransverseBand(ctx, prepared, {
      s,
      depth: 0.12,
      fromOffset: lane.o0 + 0.1,
      toOffset: lane.o1 - 0.1,
      materialKey: 'bay-tick',
      material: solid(),
      laneHeight: lane.h,
      owner,
    });
  }
}

function addGlyphRun(ctx, prepared, lane, glyph, from, to, spacing, owner) {
  const center = (lane.o0 + lane.o1) / 2;
  const size = clamp(lane.width * 0.78, 0.9, 2.1);
  const material = getGlyphMaterial(glyph, '#f4f3ee');
  const key = `glyph-${glyph}`;
  for (let s = from + spacing * 0.5; s < to; s += spacing) {
    const frame = frameAt(prepared, s);
    const sign = lane.dir >= 0 ? 1 : -1;
    const p = pointAt(frame, center, lane.h + DECAL);
    addWorldGlyph(ctx, {
      x: p[0],
      z: p[2],
      y: p[1],
      size,
      dirX: frame.t[0] * sign,
      dirZ: frame.t[2] * sign,
      material,
      materialKey: key,
      owner,
    });
  }
}

/* ------------------------------------------------------------------ */
/* junction markings                                                   */
/* ------------------------------------------------------------------ */

/**
 * Stop bars, give-way teeth, zebra crossings and turn arrows on every approach of
 * every junction.  Controlled by the profile hints so a motorway does not sprout
 * zebra crossings.
 */
export function buildJunctionMarkings(ctx) {
  const { network, prepared, roadsByNode, junctionBlend, ownerOf } = ctx;

  for (const [nodeId, roadIds] of roadsByNode) {
    const node = network.getNode(nodeId);
    if (!node) continue;
    if (node.kind === 'roundabout') {
      buildRoundaboutMarkings(node, roadIds, ctx);
      continue;
    }
    if (roadIds.length < 2) continue;
    const wipe = junctionBlend.get(nodeId) ?? 0;

    for (const roadId of roadIds) {
      const prep = prepared.get(roadId);
      const road = network.getRoad(roadId);
      if (!prep || !road) continue;
      const profile = prep.profile;
      const cross = prep.cross;
      const owner = ownerOf(roadId);
      const isStart = road.nodeIds[0] === nodeId;
      const isEnd = road.nodeIds[road.nodeIds.length - 1] === nodeId;
      if (!isStart && !isEnd) continue;

      const approachDir = isStart ? -1 : 1; // lanes travelling toward the junction
      const approaching = cross.drivable.filter((lane) => lane.dir === approachDir);
      if (!approaching.length) continue;

      const stopDistance = isStart ? wipe + 1.2 : prep.length - (wipe + 1.2);
      if (stopDistance < 1 || stopDistance > prep.length - 1) continue;

      let left = Infinity;
      let right = -Infinity;
      for (const lane of approaching) {
        left = Math.min(left, lane.o0);
        right = Math.max(right, lane.o1);
      }

      const wantsCrossing = profile.hints?.crossings && wipe > 3;
      let stopLineAt = stopDistance;
      if (wantsCrossing) {
        const depth = 2.6;
        addTransverseBand(ctx, prep, {
          s: isStart ? stopDistance + depth / 2 + 0.8 : stopDistance - depth / 2 - 0.8,
          depth,
          fromOffset: cross.carriageLeft,
          toOffset: cross.carriageRight,
          materialKey: 'zebra',
          material: getZebraMaterial(Math.max(4, Math.round((cross.carriageRight - cross.carriageLeft) / 0.62)), 'zebra'),
          owner,
          uRepeat: Math.max(4, Math.round((cross.carriageRight - cross.carriageLeft) / 0.62)),
        });
        stopLineAt = isStart ? stopDistance + depth + 1.6 : stopDistance - depth - 1.6;
      }

      // Stop bar / give-way across the approaching half of the carriageway.
      const controlled = profile.hints?.signals || profile.speed >= 60;
      addTransverseBand(ctx, prep, {
        s: stopLineAt,
        depth: controlled ? 0.4 : 0.5,
        fromOffset: left + 0.15,
        toOffset: right - 0.15,
        materialKey: controlled ? 'stop-bar' : 'give-way-teeth',
        material: controlled ? solid() : getGiveWayMaterial(Math.max(3, Math.round((right - left) / 0.75))),
        owner,
        uRepeat: controlled ? 1 : Math.max(3, Math.round((right - left) / 0.75)),
      });

      // Turn arrows in each approaching lane.
      const arrowAt = isStart ? stopLineAt + 16 : stopLineAt - 16;
      if (arrowAt > 1 && arrowAt < prep.length - 1) {
        const ordered = approachDir === -1 ? approaching : approaching.slice().reverse();
        for (let i = 0; i < ordered.length; i++) {
          const lane = ordered[i];
          let glyph = 'ahead';
          if (ordered.length === 1) glyph = 'ahead';
          else if (i === 0) glyph = 'left';
          else if (i === ordered.length - 1) glyph = 'right';
          if (ordered.length === 2) {
            glyph = i === 0 ? 'aheadLeft' : 'aheadRight';
          }
          const frame = frameAt(prep, arrowAt);
          const p = pointAt(frame, (lane.o0 + lane.o1) / 2, lane.h + DECAL);
          const sign = lane.dir >= 0 ? 1 : -1;
          addWorldGlyph(ctx, {
            x: p[0],
            z: p[2],
            y: p[1],
            size: clamp(lane.width * 0.8, 1.2, 2.6),
            dirX: frame.t[0] * sign,
            dirZ: frame.t[2] * sign,
            material: getGlyphMaterial(glyph, '#f4f3ee'),
            materialKey: `glyph-${glyph}`,
            owner,
          });
        }
      }
    }
  }
}

function buildRoundaboutMarkings(node, roadIds, ctx) {
  const { prepared, ownerOf, network, driveSide } = ctx;
  const metrics = ctx.roundaboutMetrics(node);
  const cx = node.x;
  const cz = node.z;
  const base = ctx.terrain ? ctx.terrain.roadHeight(node.x, node.z, node.y) : node.y || 0;
  const owner = ownerOf(roadIds[0] || `rb:${node.id}`);
  const y = base + DECAL + 0.035;
  const circulation = driveSide === 'left' ? 1 : -1; // RHT roundabouts run anti-clockwise

  // Give-way teeth across each approach, just outside the circulatory carriageway.
  for (const roadId of roadIds) {
    const prep = prepared.get(roadId);
    const road = network.getRoad(roadId);
    if (!prep || !road) continue;
    const isStart = road.nodeIds[0] === node.id;
    const isEnd = road.nodeIds[road.nodeIds.length - 1] === node.id;
    if (!isStart && !isEnd) continue;
    const wipe = ctx.junctionBlend.get(node.id) ?? metrics.footwayOuter;
    const s = isStart ? wipe - 1.4 : prep.length - (wipe - 1.4);
    if (s < 1 || s > prep.length - 1) continue;
    const left = prep.cross.carriageLeft;
    const right = prep.cross.carriageRight;
    const teeth = Math.max(4, Math.round((right - left) / 0.8));
    addTransverseBand(ctx, prep, {
      s,
      depth: 0.75,
      fromOffset: left + 0.2,
      toOffset: right - 0.2,
      materialKey: 'give-way-teeth',
      material: getGiveWayMaterial(teeth),
      owner,
      uRepeat: teeth,
    });
  }

  // Circulatory arrows around the annulus.
  const radius = (metrics.inner + metrics.outer) / 2;
  const count = Math.max(4, Math.round(metrics.outer / 9));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    // Tangent in the direction of circulation.
    const tx = -Math.sin(a) * circulation;
    const tz = Math.cos(a) * circulation;
    addWorldGlyph(ctx, {
      x,
      z,
      y,
      size: Math.min(2.4, metrics.circulatory * 0.55),
      dirX: tx,
      dirZ: tz,
      material: getGlyphMaterial('ahead', '#f4f3ee'),
      materialKey: 'glyph-ahead',
      owner,
    });
  }

  // Edge line around the outside of the circulatory carriageway.
  const segments = 72;
  const lineMaterial = getMarkingMaterial('roundabout-edge', { color: WHITE });
  const key = 'roundabout-edge';
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const r0 = metrics.outer - 0.35;
    const r1 = metrics.outer - 0.2;
    const p0 = [cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0];
    const p1 = [cx + Math.cos(a0) * r1, y, cz + Math.sin(a0) * r1];
    const p2 = [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1];
    const p3 = [cx + Math.cos(a1) * r0, y, cz + Math.sin(a1) * r0];
    const builder = decalBuilder(ctx, p0[0], p0[2], key, () => lineMaterial);
    builder.quad(p0, p1, p2, p3, null, [[0, 0], [1, 0], [1, 1], [0, 1]], owner);
  }
}

export { addWorldGlyph, addTransverseBand, addLongitudinalLine, frameAt, pointAt, DECAL, WHITE, YELLOW };
