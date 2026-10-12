// Catalogue of lane kinds, road kinds (cross-section presets) and helpers.
//
// A road's cross-section is an ordered list of lanes, left -> right when you walk
// along the centerline. Offsets are metres from the centerline: the first lane
// starts at -W/2 and the last ends at +W/2. Lanes with offset < 0 sit on the
// -normal side. Normal = (-tz, tx), i.e. "left" of travel for the +x direction.

/** Per-lane surface definition. `elev` is the lane top above the road base (curb height). */
export const LANE_KINDS = {
  drive: { label: 'Drive lane', surface: 'asphalt', color: '#3a3f46', elev: 0, drivable: true, width: 3.3 },
  shoulder: { label: 'Shoulder', surface: 'asphalt', color: '#4d5259', elev: 0, drivable: true, width: 2.5 },
  bus: { label: 'Bus lane', surface: 'asphalt', color: '#9b2f2a', elev: 0, drivable: true, width: 3.5 },
  bike: { label: 'Cycle lane', surface: 'asphalt', color: '#2c7456', elev: 0, drivable: true, width: 1.8 },
  parking: { label: 'Parking lane', surface: 'asphalt', color: '#484d55', elev: 0, drivable: true, width: 2.4 },
  sidewalk: { label: 'Sidewalk', surface: 'paving', color: '#bfc1c3', elev: 0.15, drivable: false, width: 2.5 },
  footway: { label: 'Pedestrian path', surface: 'paving', color: '#d0c8b4', elev: 0, drivable: false, width: 3.0 },
  median: { label: 'Median island', surface: 'asphalt', color: '#56713f', elev: 0.15, drivable: false, width: 1.2 },
  buffer: { label: 'Planted buffer', surface: 'asphalt', color: '#5f7c48', elev: 0.12, drivable: false, width: 0.6 },
  ballast: { label: 'Rail ballast', surface: 'asphalt', color: '#746e66', elev: 0.03, drivable: false, width: 4.5 },
};

/**
 * Road kinds. `lanes` entries are [laneKind, width, flags?]. `group`:
 *  - street: vehicle roads, get junction pads and trimmed ends
 *  - path:   pedestrian/cycle paths, same junction handling
 *  - rail:   railway lines, never get junction pads
 * `center` marks the drive/drive boundary at offset 0: dashed | solid | none.
 */
export const ROAD_KINDS = {
  alley: { label: 'Alley', group: 'street', mode: 'surface', lanes: [['drive', 3.0]], edges: false, center: 'none' },
  local: {
    label: 'Local street',
    group: 'street',
    mode: 'surface',
    lanes: [['sidewalk', 2.2], ['parking', 2.3], ['drive', 3.2], ['drive', 3.2], ['parking', 2.3], ['sidewalk', 2.2]],
    edges: true,
    center: 'dashed',
  },
  collector: {
    label: 'Collector (bike + parking)',
    group: 'street',
    mode: 'surface',
    lanes: [['sidewalk', 2.5], ['parking', 2.4], ['bike', 1.8], ['drive', 3.3], ['drive', 3.3], ['bike', 1.8], ['parking', 2.4], ['sidewalk', 2.5]],
    edges: true,
    center: 'solid',
  },
  avenue: {
    label: 'Avenue (bus + bike + median)',
    group: 'street',
    mode: 'surface',
    lanes: [
      ['sidewalk', 3.0], ['parking', 2.4], ['bike', 1.8], ['bus', 3.5], ['drive', 3.3],
      ['median', 1.2], ['drive', 3.3], ['bus', 3.5], ['bike', 1.8], ['parking', 2.4], ['sidewalk', 3.0],
    ],
    edges: true,
    center: 'none',
  },
  highway: {
    label: 'Highway (barrier median)',
    group: 'street',
    mode: 'surface',
    lanes: [['shoulder', 3.0], ['drive', 3.6], ['drive', 3.6], ['median', 4.0, { barrier: true }], ['drive', 3.6], ['drive', 3.6], ['shoulder', 3.0]],
    edges: true,
    center: 'none',
  },
  cycleway: {
    label: 'Protected cycleway',
    group: 'street',
    mode: 'surface',
    lanes: [['sidewalk', 2.0], ['buffer', 0.6], ['bike', 2.6], ['buffer', 0.6], ['sidewalk', 2.0]],
    edges: false,
    center: 'none',
  },
  footpath: { label: 'Pedestrian path', group: 'path', mode: 'surface', lanes: [['footway', 3.5]], edges: false, center: 'none' },
  railway: { label: 'Railway (surface)', group: 'rail', mode: 'surface', lanes: [['ballast', 4.5]], rails: true, edges: false, center: 'none' },
  subway: { label: 'Subway line (underground)', group: 'rail', mode: 'underground', lanes: [['ballast', 4.5]], rails: true, edges: false, center: 'none' },
  roundabout: {
    label: 'Roundabout (one-way ring)',
    group: 'street',
    mode: 'surface',
    closed: true,
    lanes: [['sidewalk', 2.0], ['drive', 7.0], ['median', 3.0]],
    edges: false,
    center: 'none',
  },
};

export const ROAD_MODES = {
  surface: 'Surface',
  bridge: 'Bridge (elevated deck + piers)',
  underground: 'Underground (trench / tunnel)',
};

export function roadKindOf(road) {
  return ROAD_KINDS[road.kind] || ROAD_KINDS.local;
}

/** Expand a preset into lane objects, honouring feature toggles. */
export function presetLanes(kindId, opts = {}) {
  const kind = ROAD_KINDS[kindId] || ROAD_KINDS.local;
  let lanes = kind.lanes.map(([lane, width, flags]) => ({ kind: lane, width, ...(flags || {}) }));
  if (opts.busLanes === false) lanes = lanes.map((l) => (l.kind === 'bus' ? { ...l, kind: 'drive' } : l));
  if (opts.bikeLanes === false) lanes = lanes.filter((l) => l.kind !== 'bike');
  if (opts.parking === false) lanes = lanes.filter((l) => l.kind !== 'parking');
  return lanes;
}

export function lanesOf(road) {
  return Array.isArray(road.lanes) && road.lanes.length ? road.lanes : presetLanes(road.kind);
}

export function laneInfo(lane) {
  return LANE_KINDS[lane.kind] || LANE_KINDS.drive;
}

/** offs[i] = left edge of lane i; offs[n] = right edge of the last lane. */
export function laneOffsets(lanes) {
  const total = lanes.reduce((acc, l) => acc + Math.max(0, l.width), 0);
  const offs = [-total / 2];
  for (const l of lanes) offs.push(offs[offs.length - 1] + Math.max(0, l.width));
  return offs;
}

export function totalWidth(lanes) {
  return lanes.reduce((acc, l) => acc + Math.max(0, l.width), 0);
}

export function halfWidthOf(road) {
  return totalWidth(lanesOf(road)) / 2;
}

export function isJunctionRoad(road) {
  const k = roadKindOf(road);
  return (k.group === 'street' || k.group === 'path') && (road.mode || k.mode) === 'surface' && !road.closed;
}

export const LANE_KIND_IDS = Object.keys(LANE_KINDS);
export const ROAD_KIND_IDS = Object.keys(ROAD_KINDS);
