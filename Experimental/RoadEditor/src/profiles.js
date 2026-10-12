// Road types and cross-section (lane) profiles.
// Lateral offsets are metres from the centreline; POSITIVE = left of travel.
// Each lane: { type, dir, top, bottom, h } where top > bottom and h is height.

import { makeRng } from './geometry.js';

export const ROAD_TYPES = {
  avenue: {
    label: 'Avenue (2×2 + bus + bike + parking)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 2, laneWidth: 3.4,
    median: 2.0, sidewalk: 3.6, parking: 'both', bus: true, bike: true,
    bollards: 'bike', speedBumps: 0, markings: 'city', curbH: 0.16,
  },
  boulevard: {
    label: 'Boulevard (wide median + trees line)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 2, laneWidth: 3.5,
    median: 5.5, sidewalk: 4.5, parking: 'right', bus: false, bike: false,
    bollards: 'none', speedBumps: 1, markings: 'city', curbH: 0.18,
  },
  street: {
    label: 'Residential street (parking both sides)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 1, laneWidth: 3.1,
    median: 0, sidewalk: 2.4, parking: 'both', bus: false, bike: false,
    bollards: 'none', speedBumps: 2, markings: 'city', curbH: 0.14,
  },
  cyclestreet: {
    label: 'Cycle street (bike lanes + bollards)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 1, laneWidth: 3.0,
    median: 0, sidewalk: 2.8, parking: 'none', bus: false, bike: true,
    bollards: 'bike', speedBumps: 1, markings: 'city', curbH: 0.15,
  },
  highway: {
    label: 'Highway (3 lanes each way, barrier)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 3, laneWidth: 3.7,
    median: 3.0, sidewalk: 0, shoulder: 3.0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'highway', curbH: 0.0, barrier: true,
  },
  country: {
    label: 'Country road (narrow, gravel shoulders)',
    kind: 'road', surface: 'asphalt', lanesPerDir: 1, laneWidth: 3.0,
    median: 0, sidewalk: 0, shoulder: 1.1, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'country', curbH: 0.0,
  },
  offroad: {
    label: 'Offroad track (dirt, ruts, no paint)',
    kind: 'road', surface: 'dirt', lanesPerDir: 1, laneWidth: 3.2,
    median: 0, sidewalk: 0, shoulder: 0.6, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'none', curbH: 0.0, ruts: true,
  },
  pathway: {
    label: 'Pedestrian pathway (paved, bollards)',
    kind: 'road', surface: 'concrete', lanesPerDir: 0, laneWidth: 2.6,
    median: 0, sidewalk: 2.6, parking: 'none', bus: false, bike: false,
    bollards: 'post', speedBumps: 0, markings: 'none', curbH: 0.0, pedestrian: true,
  },
  railway: {
    label: 'Railway line (ballast + sleepers)',
    kind: 'rail', surface: 'ballast', lanesPerDir: 0, laneWidth: 3.2,
    median: 0, sidewalk: 0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'none', curbH: 0.0,
  },
  subway: {
    label: 'Subway tunnel (underground)',
    kind: 'subway', surface: 'tunnel', lanesPerDir: 0, laneWidth: 3.0,
    median: 0, sidewalk: 0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'none', curbH: 0.0,
  },
  bridge_girder: {
    label: 'Bridge — box girder (2×2 lanes)',
    kind: 'bridge', bridge: 'girder', surface: 'asphalt', lanesPerDir: 2, laneWidth: 3.4,
    median: 1.0, sidewalk: 2.0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'city', curbH: 0.14,
  },
  bridge_arch: {
    label: 'Bridge — steel arch',
    kind: 'bridge', bridge: 'arch', surface: 'asphalt', lanesPerDir: 1, laneWidth: 3.4,
    median: 0.5, sidewalk: 2.0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'city', curbH: 0.14,
  },
  bridge_cable: {
    label: 'Bridge — cable-stayed',
    kind: 'bridge', bridge: 'cable', surface: 'asphalt', lanesPerDir: 2, laneWidth: 3.5,
    median: 2.0, sidewalk: 0, parking: 'none', bus: false, bike: false,
    bollards: 'none', speedBumps: 0, markings: 'highway', curbH: 0.0, barrier: true,
  },
};

export const TYPE_ORDER = Object.keys(ROAD_TYPES);

// Build the lane list for one road. `rng` makes every road slightly different
// (width jitter, marking phase), which is what keeps repeated presets from looking identical.
export function buildLanes(typeId, rng = makeRng(1), overrides = {}) {
  const t = { ...ROAD_TYPES[typeId], ...overrides };
  const jitter = (w) => w * (0.94 + rng() * 0.12);
  const lanes = [];

  if (t.kind === 'rail' || t.kind === 'subway') {
    const w = jitter(t.laneWidth);
    lanes.push({ type: t.kind === 'rail' ? 'ballast' : 'tunnel', dir: 0, top: w / 2, bottom: -w / 2, h: 0 });
    return { lanes, width: w, type: t };
  }

  if (t.surface === 'dirt' || t.surface === 'gravel') {
    const w = jitter(t.laneWidth);
    lanes.push({ type: 'dirt', dir: 0, top: w / 2, bottom: -w / 2, h: 0 });
    if (t.shoulder) {
      lanes.unshift({ type: 'gravel', dir: 0, top: w / 2 + t.shoulder, bottom: w / 2, h: -0.02 });
      lanes.push({ type: 'gravel', dir: 0, top: -w / 2, bottom: -w / 2 - t.shoulder, h: -0.02 });
    }
    return { lanes, width: w + 2 * (t.shoulder || 0), type: t };
  }

  if (t.pedestrian) {
    const w = jitter(t.laneWidth);
    lanes.push({ type: 'concrete', dir: 0, top: w / 2, bottom: -w / 2, h: 0 });
    return { lanes, width: w, type: t };
  }

  // Build outward from the median on each side.
  const median = t.median || 0;
  const side = (sgn) => {
    const seq = [];
    for (let i = 0; i < t.lanesPerDir; i++) seq.push({ type: 'drive', w: jitter(t.laneWidth) });
    if (t.bus) seq.push({ type: 'bus', w: jitter(3.3) });
    if (t.bike) seq.push({ type: 'bike', w: jitter(1.8) });
    const park = t.parking === 'both' || (t.parking === 'left' && sgn > 0) || (t.parking === 'right' && sgn < 0);
    if (park) seq.push({ type: 'parking', w: jitter(2.3) });
    if (t.sidewalk > 0) seq.push({ type: 'sidewalk', w: jitter(t.sidewalk) });
    if (t.shoulder > 0) seq.push({ type: 'shoulder', w: jitter(t.shoulder) });
    let pos = median / 2;
    for (const seg of seq) {
      const dir = seg.type === 'drive' || seg.type === 'bus' || seg.type === 'bike' ? sgn : 0;
      const top = sgn > 0 ? pos + seg.w : -pos;
      const bottom = sgn > 0 ? pos : -(pos + seg.w);
      const h = seg.type === 'sidewalk' ? t.curbH : seg.type === 'shoulder' ? -0.02 : 0;
      lanes.push({ type: seg.type, dir, top, bottom, h });
      pos += seg.w;
    }
    return pos;
  };
  const leftEdge = side(+1);
  const rightEdge = side(-1);
  if (median > 0) lanes.push({ type: 'median', dir: 0, top: median / 2, bottom: -median / 2, h: t.barrier ? 0 : 0.12 });
  const width = leftEdge + rightEdge;
  return { lanes, width, type: t };
}

// Lateral-width helper for junction fans and parking stalls.
export function halfWidth(profile) {
  return profile.width / 2;
}
