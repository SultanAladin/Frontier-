// Turns a lane list into an extrudable cross-section.
//
// The cross-section is a single polyline walking across the road in (offset, height)
// space.  Consecutive pairs become spans, and each span is extruded along the road's
// centre-line.  The same mechanism produces carriageway, kerb faces, walls, barriers,
// platforms and parapets: a "bump" in the polyline is all any of them is.

import { LANE_KINDS, laneWidth, mirrorLanes } from './profiles.js';

const SKIRT = 0.4; // how far the outer edge drops below the surface, so slabs read as solid

function laneHeight(lane, curbHeight) {
  if (lane.kind === 'channel') return -0.12;
  if (lane.variant === 'flush') return 0.015;
  if (lane.kind === 'median' || lane.kind === 'sidewalk') {
    switch (lane.variant) {
      case 'hatched': return 0;
      case 'barrier': return 0;
      case 'platform': return 0.76;
      case 'wall':
      case 'parapet': return lane.h ?? 1.0;
      default: return curbHeight;
    }
  }
  if (lane.kind === 'pathway') return lane.variant === 'deck' ? 0.42 : 0.02;
  if (lane.kind === 'planting') return curbHeight;
  if (typeof lane.h === 'number') return lane.h;
  return LANE_KINDS[lane.kind]?.h ?? 0;
}

function surfaceOf(lane) {
  return lane.surface || LANE_KINDS[lane.kind]?.surface || 'asphalt';
}

function kerbMaterial(lane, nextLane) {
  const tall = (lane.h ?? 0) > 0.5 || (lane.variant === 'wall' || lane.variant === 'parapet');
  if (tall) return 'wall';
  if (lane.surface === 'brick' || lane.surface === 'sett' || lane.surface === 'stone') return 'sett';
  if (nextLane && (nextLane.surface === 'brick' || nextLane.surface === 'sett')) return 'sett';
  return 'kerb';
}

const TINTS = {
  cycle: 0x2f6f4a,
  bus: 0x8a5a3c,
  tram: 0x000000,
};

/**
 * @param {object} profile  road catalogue entry (or a road's own edited copy)
 * @param {object} options  { driveSide: 'right'|'left', curbHeight: number }
 */
export function buildCrossSection(profile, options = {}) {
  const driveSide = options.driveSide || 'right';
  const curbHeight = options.curbHeight ?? 0.15;
  const lanes = driveSide === 'left' ? mirrorLanes(profile.lanes) : profile.lanes;
  const total = laneWidth(lanes);

  const spans = [];
  const laneInfo = [];
  let u = 0;

  const push = (a, b, material, meta) => {
    if (Math.abs(a.o - b.o) < 1e-6 && Math.abs(a.h - b.h) < 1e-6) return;
    const length = Math.hypot(b.o - a.o, b.h - a.h);
    spans.push({ a, b, material, u0: u, u1: u + length, ...meta });
    u += length;
  };

  let o = -total / 2;
  let prev = null; // { o, h } of the right-hand edge of the previous lane
  let carriageLeft = null;
  let carriageRight = null;
  let centerOffset = null;
  let maxWall = 0;
  let wallLeft = null;
  let wallRight = null;

  for (let index = 0; index < lanes.length; index++) {
    const lane = lanes[index];
    const width = lane.width || 0;
    const left = o;
    const right = o + width;
    const height = laneHeight(lane, curbHeight);
    const next = lanes[index + 1];
    const surface = surfaceOf(lane);
    const kind = LANE_KINDS[lane.kind] || {};

    laneInfo.push({
      index,
      kind: lane.kind,
      dir: lane.dir || 0,
      variant: lane.variant || null,
      surface,
      width,
      o0: left,
      o1: right,
      h: height,
      tracks: lane.tracks ?? (lane.kind === 'rail' ? 2 : 0),
      electrified: !!lane.electrified,
      grooved: !!lane.grooved,
      drivable: !!kind.drivable,
    });

    if (kind.drivable) {
      if (carriageLeft === null) carriageLeft = left;
      carriageRight = right;
    }
    if (lane.variant === 'wall' || lane.variant === 'parapet') {
      maxWall = Math.max(maxWall, height);
      if (wallLeft === null) wallLeft = left;
      wallRight = right;
    }

    if (prev && Math.abs((lane.dir || 0) - (lanes[index - 1].dir || 0)) === 2) {
      centerOffset = left;
    }

    // Vertical step between the previous lane and this one (kerb / wall face / ramp).
    if (prev && Math.abs(prev.h - height) > 1e-4) {
      push({ o: left, h: prev.h }, { o: left, h: height }, kerbMaterial(lane, lanes[index - 1]), {
        role: 'step',
        laneIndex: index,
      });
    } else if (prev === null) {
      // Leading skirt so the outer edge is not a paper-thin sheet.
      push({ o: left, h: height - SKIRT }, { o: left, h: height }, kerbMaterial(lane), { role: 'skirt', laneIndex: index });
    }

    if (lane.variant === 'barrier') {
      // Jersey / concrete step barrier: an explicit bump in the polyline.
      const baseWidth = Math.min(0.55, width * 0.3);
      const bl = left + (width - baseWidth * 2) / 2;
      const br = right - (width - baseWidth * 2) / 2;
      push({ o: left, h: 0 }, { o: bl, h: 0 }, 'asphalt', { role: 'surface', laneIndex: index });
      push({ o: bl, h: 0 }, { o: bl, h: 0.32 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: bl, h: 0.32 }, { o: bl + baseWidth * 0.28, h: 0.32 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: bl + baseWidth * 0.28, h: 0.32 }, { o: bl + baseWidth * 0.42, h: 0.82 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: bl + baseWidth * 0.42, h: 0.82 }, { o: br - baseWidth * 0.42, h: 0.82 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: br - baseWidth * 0.42, h: 0.82 }, { o: br - baseWidth * 0.28, h: 0.32 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: br - baseWidth * 0.28, h: 0.32 }, { o: br, h: 0.32 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: br, h: 0.32 }, { o: br, h: 0 }, 'wall', { role: 'barrier', laneIndex: index });
      push({ o: br, h: 0 }, { o: right, h: 0 }, 'asphalt', { role: 'surface', laneIndex: index });
    } else if (lane.kind === 'rail') {
      // Sloped ballast shoulder, flat bed between the shoulders.
      const shoulder = Math.min(0.9, width * 0.22);
      const bed = 0.36;
      push({ o: left, h: 0 }, { o: left + shoulder, h: bed }, 'ballast', { role: 'surface', laneIndex: index });
      push({ o: left + shoulder, h: bed }, { o: right - shoulder, h: bed }, 'ballast', { role: 'surface', laneIndex: index });
      push({ o: right - shoulder, h: bed }, { o: right, h: 0 }, 'ballast', { role: 'surface', laneIndex: index });
    } else {
      const tint = lane.variant === 'tinted' || lane.kind === 'cycle' || lane.kind === 'bus' ? TINTS[lane.kind] : null;
      push({ o: left, h: height }, { o: right, h: height }, surface, {
        role: 'surface',
        laneIndex: index,
        tint: tint ?? undefined,
      });
    }

    prev = { o: right, h: height };
    o = right;
  }

  if (prev) {
    const last = lanes[lanes.length - 1];
    push({ o: prev.o, h: prev.h }, { o: prev.o, h: prev.h - SKIRT }, kerbMaterial(last), {
      role: 'skirt',
      laneIndex: lanes.length - 1,
    });
  }

  if (centerOffset === null && laneInfo.length) {
    // One-way or non-directional: fall back to the geometric centre of the carriageway.
    centerOffset = carriageLeft !== null ? (carriageLeft + carriageRight) / 2 : 0;
  }

  const drivable = laneInfo.filter((lane) => lane.drivable);

  return {
    spans,
    lanes: laneInfo,
    drivable,
    totalWidth: total,
    carriageLeft: carriageLeft ?? -total / 2,
    carriageRight: carriageRight ?? total / 2,
    centerOffset: centerOffset ?? 0,
    halfWidth: total / 2,
    curbHeight,
    structure: profile.structure || 'none',
    envelope: maxWall > 0 ? { h: maxWall, left: wallLeft, right: wallRight } : null,
    profileId: profile.id,
  };
}

/** Distinct material keys used by a cross-section (tinted surfaces get their own key). */
export function spanMaterialKey(span) {
  return span.tint ? `${span.material}|${span.tint.toString(16)}` : span.material;
}
