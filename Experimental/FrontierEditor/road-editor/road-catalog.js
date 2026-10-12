// Road catalogue: lane kinds, road presets and cross-section layout.
//
// Conventions (used everywhere in the road editor):
//   - Units are metres. Y is up. The ground plane is y = 0.
//   - A lane is [kind, dir, width]. Lanes are listed LEFT -> RIGHT when looking
//     along the road from its first node to its last node.
//   - dir is 'fwd' (travel from node a towards node b), 'back' (b -> a),
//     'both', or 'none'. Right-hand traffic: 'fwd' lanes sit on the right
//     (negative lateral offset), 'back' lanes on the left (positive offset).
//   - Lateral offset is positive to the LEFT of travel:  left normal = (tz, -tx).

export const LANE_KINDS = {
  sidewalk: { label: 'Sidewalk', color: [0.66, 0.65, 0.62], raise: 0.15, carriage: false },
  verge: { label: 'Verge / grass', color: [0.3, 0.42, 0.22], raise: 0, carriage: false },
  path: { label: 'Paved footpath', color: [0.63, 0.61, 0.56], raise: 0, carriage: false },
  gravel: { label: 'Gravel / dirt', color: [0.47, 0.4, 0.3], raise: 0, carriage: false },
  paver: { label: 'Shared paving', color: [0.6, 0.56, 0.5], raise: 0, carriage: true },
  drive: { label: 'Drive lane', color: [0.18, 0.18, 0.19], raise: 0, carriage: true },
  bus: { label: 'Bus lane (red)', color: [0.63, 0.16, 0.14], raise: 0, carriage: true },
  bike: { label: 'Bike lane (green)', color: [0.2, 0.52, 0.32], raise: 0, carriage: true },
  cycle: { label: 'Cycle track', color: [0.27, 0.5, 0.35], raise: 0.08, carriage: false },
  parking: { label: 'Parking lane', color: [0.25, 0.25, 0.27], raise: 0, carriage: true },
  shoulder: { label: 'Hard shoulder', color: [0.3, 0.3, 0.31], raise: 0, carriage: true },
  median: { label: 'Median / island', color: [0.52, 0.52, 0.49], raise: 0.15, carriage: false },
  tram: { label: 'Tram track', color: [0.22, 0.21, 0.21], raise: 0, carriage: true },
  rail: { label: 'Railway ballast', color: [0.43, 0.4, 0.35], raise: 0, carriage: true },
};

// Kinds a pedestrian may cross on a zebra (everything carriageway-like, not islands/kerbs).
export const CROSSABLE = new Set(['drive', 'bus', 'bike', 'parking', 'paver', 'tram', 'shoulder']);
// Kinds whose travel direction is used for markings and junction approaches.
export const DIRECTED = new Set(['drive', 'bus', 'bike', 'cycle', 'tram']);

const L = (kind, dir, width) => [kind, dir, width];

export const PRESETS = {
  residential: {
    label: 'Residential street', group: 'Urban', speed: 30, center: 'dashed',
    lanes: [L('sidewalk', 'none', 2.0), L('parking', 'both', 2.2), L('drive', 'back', 3.0), L('drive', 'fwd', 3.0), L('parking', 'both', 2.2), L('sidewalk', 'none', 2.0)],
  },
  local: {
    label: 'Local street (no parking)', group: 'Urban', speed: 30, center: 'dashed',
    lanes: [L('sidewalk', 'none', 1.8), L('drive', 'back', 2.8), L('drive', 'fwd', 2.8), L('sidewalk', 'none', 1.8)],
  },
  oneway: {
    label: 'One-way street', group: 'Urban', speed: 30, center: 'none',
    lanes: [L('sidewalk', 'none', 2.0), L('parking', 'both', 2.2), L('drive', 'fwd', 3.4), L('parking', 'both', 2.2), L('sidewalk', 'none', 2.0)],
  },
  shared: {
    label: 'Shared street (woonerf)', group: 'Urban', speed: 15, center: 'none', shared: true,
    lanes: [L('paver', 'back', 2.6), L('paver', 'fwd', 2.6)],
  },
  avenue: {
    label: 'Avenue with bike lanes', group: 'Urban', speed: 50, center: 'double',
    lanes: [L('sidewalk', 'none', 3.0), L('bike', 'back', 1.8), L('parking', 'both', 2.2), L('drive', 'back', 3.3), L('drive', 'fwd', 3.3), L('parking', 'both', 2.2), L('bike', 'fwd', 1.8), L('sidewalk', 'none', 3.0)],
  },
  boulevard: {
    label: 'Boulevard with bus lanes + median', group: 'Urban', speed: 50, center: 'none',
    lanes: [L('sidewalk', 'none', 3.5), L('bus', 'back', 3.4), L('drive', 'back', 3.3), L('median', 'none', 4.0), L('drive', 'fwd', 3.3), L('bus', 'fwd', 3.4), L('sidewalk', 'none', 3.5)],
  },
  'bus-corridor': {
    label: 'Bus corridor (bus + bike both sides)', group: 'Urban', speed: 50, center: 'solid',
    lanes: [L('sidewalk', 'none', 3.0), L('bike', 'back', 1.8), L('bus', 'back', 3.5), L('drive', 'back', 3.2), L('drive', 'fwd', 3.2), L('bus', 'fwd', 3.5), L('bike', 'fwd', 1.8), L('sidewalk', 'none', 3.0)],
  },
  'cycle-street': {
    label: 'Cycle street (protected tracks)', group: 'Urban', speed: 30, center: 'dashed',
    lanes: [L('sidewalk', 'none', 2.5), L('cycle', 'back', 2.2), L('drive', 'back', 3.0), L('drive', 'fwd', 3.0), L('cycle', 'fwd', 2.2), L('sidewalk', 'none', 2.5)],
  },
  'tram-street': {
    label: 'Tram street (central track)', group: 'Urban', speed: 50, center: 'none',
    lanes: [L('sidewalk', 'none', 2.5), L('drive', 'back', 3.2), L('tram', 'both', 3.0), L('drive', 'fwd', 3.2), L('sidewalk', 'none', 2.5)],
  },
  arterial: {
    label: 'Arterial (4 lanes + median)', group: 'Roads', speed: 60, center: 'none',
    lanes: [L('sidewalk', 'none', 2.5), L('drive', 'back', 3.5), L('drive', 'back', 3.5), L('median', 'none', 2.0), L('drive', 'fwd', 3.5), L('drive', 'fwd', 3.5), L('sidewalk', 'none', 2.5)],
  },
  primary: {
    label: 'Primary road (A-road, barrier)', group: 'Roads', speed: 80, center: 'none',
    lanes: [L('shoulder', 'none', 2.5), L('drive', 'back', 3.5), L('drive', 'back', 3.5), L('median', 'none', 2.0), L('drive', 'fwd', 3.5), L('drive', 'fwd', 3.5), L('shoulder', 'none', 2.5)],
  },
  motorway: {
    label: 'Motorway / freeway (divided)', group: 'Roads', speed: 120, center: 'none',
    lanes: [L('shoulder', 'none', 3.0), L('drive', 'back', 3.75), L('drive', 'back', 3.75), L('median', 'none', 4.5), L('drive', 'fwd', 3.75), L('drive', 'fwd', 3.75), L('shoulder', 'none', 3.0)],
  },
  'slip-road': {
    label: 'Slip road / on-off ramp', group: 'Roads', speed: 60, center: 'none',
    lanes: [L('shoulder', 'none', 1.0), L('drive', 'fwd', 4.5), L('shoulder', 'none', 1.0)],
  },
  'country-lane': {
    label: 'Country lane (two-way, no kerbs)', group: 'Roads', speed: 80, center: 'dashed',
    lanes: [L('shoulder', 'none', 1.0), L('drive', 'back', 2.7), L('drive', 'fwd', 2.7), L('shoulder', 'none', 1.0)],
  },
  service: {
    label: 'Service road', group: 'Roads', speed: 20, center: 'none',
    lanes: [L('verge', 'none', 1.0), L('drive', 'back', 2.8), L('drive', 'fwd', 2.8), L('verge', 'none', 1.0)],
  },
  roundabout: {
    label: 'Roundabout ring (one-way)', group: 'Roads', speed: 30, center: 'none',
    lanes: [L('sidewalk', 'none', 2.0), L('drive', 'fwd', 6.0), L('sidewalk', 'none', 2.0)],
  },
  'dirt-track': {
    label: 'Unpaved dirt track', group: 'Tracks & paths', speed: 25, center: 'none',
    lanes: [L('verge', 'none', 0.6), L('gravel', 'both', 3.2), L('verge', 'none', 0.6)],
  },
  footpath: {
    label: 'Footpath / pedestrian', group: 'Tracks & paths', speed: 5, center: 'none',
    lanes: [L('path', 'both', 3.0)],
  },
  'gravel-path': {
    label: 'Gravel park path', group: 'Tracks & paths', speed: 5, center: 'none',
    lanes: [L('gravel', 'both', 2.4)],
  },
  'rail-mainline': {
    label: 'Railway (mainline track)', group: 'Rail', speed: 120, center: 'none', rail: true,
    lanes: [L('rail', 'none', 4.0)],
  },
  subway: {
    label: 'Subway line (underground)', group: 'Rail', speed: 80, center: 'none', rail: true, underground: true,
    lanes: [L('rail', 'none', 3.2)],
  },
};

export const PRESET_GROUPS = ['Urban', 'Roads', 'Tracks & paths', 'Rail'];

export function presetOf(edge) {
  return PRESETS[edge.preset] ?? PRESETS.local;
}

export function lanesOf(edge) {
  return edge.lanes ?? presetOf(edge).lanes;
}

export function speedOf(edge) {
  return edge.speed ?? presetOf(edge).speed;
}

export function centerOf(edge) {
  return edge.center ?? presetOf(edge).center;
}

// Lay out lane definitions across the cross-section. Each lane gets its
// lateral extent [oL, oR] with oL > oR (oL is the left edge).
export function layoutLanes(laneDefs) {
  const total = laneDefs.reduce((sum, [, , w]) => sum + w, 0);
  let cur = total / 2;
  const lanes = laneDefs.map(([kind, dir, width], i) => {
    const info = LANE_KINDS[kind] ?? LANE_KINDS.drive;
    const lane = {
      i, kind, dir, w: width, oL: cur, oR: cur - width,
      raise: info.raise, color: info.color, carriage: info.carriage,
    };
    cur -= width;
    return lane;
  });
  return { lanes, half: total / 2, total };
}

export function validLanes(laneDefs) {
  if (!Array.isArray(laneDefs) || laneDefs.length === 0 || laneDefs.length > 16) return false;
  return laneDefs.every((lane) => Array.isArray(lane) && LANE_KINDS[lane[0]] && ['fwd', 'back', 'both', 'none'].includes(lane[1])
    && Number.isFinite(lane[2]) && lane[2] > 0.05 && lane[2] <= 12);
}

export function curbColor(color) {
  return color.map((c) => c * 0.8);
}
