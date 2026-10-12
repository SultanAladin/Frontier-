// Frontier Road Editor — the catalog: road classes, cross-sections, kerbs,
// surfaces, markings, furniture and render materials.
//
// This file is the design reference the rest of the editor reads from. Numbers
// follow common practice (AASHTO/UK DMRB/Austroads ranges) rounded to the
// centimetre; nothing here is a standard-compliance claim — it is a library of
// plausible, editable road furniture for a game map.

import { clamp, hashStr, makeRng } from './math.js';

// ── materials (render params only; the mesher just tags triangles) ───────────
export const MATERIALS = {
  asphalt: { albedo: [0.085, 0.088, 0.094], roughness: 0.78, metallic: 0, spec: 0.35, emissive: 0, uvScale: 0.25 },
  'asphalt-worn': { albedo: [0.12, 0.122, 0.126], roughness: 0.86, metallic: 0, spec: 0.25, emissive: 0, uvScale: 0.25 },
  'asphalt-wet': { albedo: [0.06, 0.062, 0.07], roughness: 0.32, metallic: 0.0, spec: 1.0, emissive: 0, uvScale: 0.25 },
  concrete: { albedo: [0.46, 0.465, 0.46], roughness: 0.82, metallic: 0, spec: 0.3, emissive: 0, uvScale: 0.2 },
  'concrete-dirty': { albedo: [0.36, 0.36, 0.35], roughness: 0.9, metallic: 0, spec: 0.25, emissive: 0, uvScale: 0.2 },
  paver: { albedo: [0.38, 0.36, 0.33], roughness: 0.78, metallic: 0, spec: 0.3, emissive: 0, uvScale: 0.35 },
  'paver-red': { albedo: [0.36, 0.2, 0.17], roughness: 0.8, metallic: 0, spec: 0.28, emissive: 0, uvScale: 0.35 },
  'paver-grey': { albedo: [0.34, 0.34, 0.35], roughness: 0.82, metallic: 0, spec: 0.26, emissive: 0, uvScale: 0.35 },
  grass: { albedo: [0.09, 0.16, 0.07], roughness: 0.95, metallic: 0, spec: 0.1, emissive: 0, uvScale: 0.15 },
  soil: { albedo: [0.11, 0.085, 0.06], roughness: 0.95, metallic: 0, spec: 0.1, emissive: 0, uvScale: 0.15 },
  gravel: { albedo: [0.28, 0.26, 0.23], roughness: 0.95, metallic: 0, spec: 0.12, emissive: 0, uvScale: 0.6 },
  cobble: { albedo: [0.24, 0.23, 0.22], roughness: 0.72, metallic: 0, spec: 0.35, emissive: 0, uvScale: 0.9 },
  'granite-kerb': { albedo: [0.44, 0.44, 0.45], roughness: 0.7, metallic: 0, spec: 0.4, emissive: 0, uvScale: 0.4 },
  'concrete-kerb': { albedo: [0.55, 0.55, 0.53], roughness: 0.8, metallic: 0, spec: 0.3, emissive: 0, uvScale: 0.4 },
  'granite-set': { albedo: [0.4, 0.4, 0.41], roughness: 0.75, metallic: 0, spec: 0.35, emissive: 0, uvScale: 1.2 },
  'line-white': { albedo: [0.86, 0.87, 0.86], roughness: 0.55, metallic: 0, spec: 0.7, emissive: 0.02, uvScale: 1 },
  'line-yellow': { albedo: [0.85, 0.68, 0.16], roughness: 0.55, metallic: 0, spec: 0.7, emissive: 0.02, uvScale: 1 },
  'line-blue': { albedo: [0.16, 0.32, 0.72], roughness: 0.6, metallic: 0, spec: 0.6, emissive: 0.02, uvScale: 1 },
  'line-red': { albedo: [0.5, 0.13, 0.12], roughness: 0.68, metallic: 0, spec: 0.4, emissive: 0, uvScale: 1 },
  'line-green': { albedo: [0.1, 0.45, 0.28], roughness: 0.66, metallic: 0, spec: 0.4, emissive: 0, uvScale: 1 },
  thermoplastic: { albedo: [0.8, 0.8, 0.78], roughness: 0.45, metallic: 0, spec: 0.9, emissive: 0.03, uvScale: 1 },
  'metal-dark': { albedo: [0.22, 0.23, 0.25], roughness: 0.4, metallic: 0.9, spec: 1, emissive: 0, uvScale: 0.5 },
  'metal-light': { albedo: [0.62, 0.64, 0.66], roughness: 0.3, metallic: 0.9, spec: 1, emissive: 0, uvScale: 0.5 },
  'paint-red': { albedo: [0.42, 0.1, 0.09], roughness: 0.55, metallic: 0.1, spec: 0.7, emissive: 0, uvScale: 0.5 },
  'paint-white': { albedo: [0.82, 0.82, 0.8], roughness: 0.5, metallic: 0.05, spec: 0.8, emissive: 0, uvScale: 0.5 },
  'plastic-black': { albedo: [0.06, 0.06, 0.065], roughness: 0.62, metallic: 0, spec: 0.35, emissive: 0, uvScale: 0.8 },
  'plastic-yellow': { albedo: [0.78, 0.62, 0.06], roughness: 0.55, metallic: 0, spec: 0.45, emissive: 0.05, uvScale: 0.8 },
  rubber: { albedo: [0.035, 0.035, 0.038], roughness: 0.92, metallic: 0, spec: 0.12, emissive: 0, uvScale: 0.6 },
  wood: { albedo: [0.24, 0.15, 0.09], roughness: 0.8, metallic: 0, spec: 0.25, emissive: 0, uvScale: 0.4 },
  'steel-deck': { albedo: [0.3, 0.31, 0.33], roughness: 0.42, metallic: 0.85, spec: 1, emissive: 0, uvScale: 0.3 },
  'rail-steel': { albedo: [0.42, 0.43, 0.45], roughness: 0.28, metallic: 1, spec: 1, emissive: 0, uvScale: 0.4 },
  sleepers: { albedo: [0.14, 0.11, 0.09], roughness: 0.9, metallic: 0, spec: 0.2, emissive: 0, uvScale: 0.5 },
  ballast: { albedo: [0.2, 0.19, 0.18], roughness: 0.96, metallic: 0, spec: 0.1, emissive: 0, uvScale: 1.5 },
  'lamp-glass': { albedo: [0.7, 0.7, 0.68], roughness: 0.2, metallic: 0, spec: 1, emissive: 0.25, uvScale: 1 },
  'signal-lens': { albedo: [0.12, 0.12, 0.12], roughness: 0.25, metallic: 0, spec: 1, emissive: 0.5, uvScale: 1 },
  'tunnel-lining': { albedo: [0.3, 0.3, 0.31], roughness: 0.88, metallic: 0, spec: 0.18, emissive: 0, uvScale: 0.18 },
  water: { albedo: [0.03, 0.07, 0.09], roughness: 0.08, metallic: 0.1, spec: 1, emissive: 0, uvScale: 0.05 },
  terrain: { albedo: [0.13, 0.13, 0.14], roughness: 0.94, metallic: 0, spec: 0.1, emissive: 0, uvScale: 0.02 },
  'marking-white': { albedo: [0.88, 0.89, 0.88], roughness: 0.5, metallic: 0, spec: 0.8, emissive: 0.02, uvScale: 1, decal: true },
  'marking-yellow': { albedo: [0.86, 0.7, 0.2], roughness: 0.5, metallic: 0, spec: 0.8, emissive: 0.02, uvScale: 1, decal: true },
  'marking-blue': { albedo: [0.18, 0.34, 0.74], roughness: 0.55, metallic: 0, spec: 0.7, emissive: 0.02, uvScale: 1, decal: true },
  'marking-red': { albedo: [0.55, 0.16, 0.14], roughness: 0.6, metallic: 0, spec: 0.5, emissive: 0, uvScale: 1, decal: true },
};

// ── kerbs ────────────────────────────────────────────────────────────────────
// face: vertical face + top, batter = leaning face, rollover = curved channel,
// flush/mountable = the kerb can be driven over (driveways, home zones).
export const KERBS = {
  none: null,
  'granite-halfbatter': { height: 0.14, width: 0.3, face: 'batter', batter: 0.045, material: 'granite-kerb', channel: 0.3, channelFall: 0.02, mountable: false },
  'concrete-halfbatter': { height: 0.13, width: 0.28, face: 'batter', batter: 0.04, material: 'concrete-kerb', channel: 0.3, channelFall: 0.02, mountable: false },
  'concrete-vertical': { height: 0.15, width: 0.2, face: 'vertical', material: 'concrete-kerb', channel: 0.25, channelFall: 0.015, mountable: false },
  'concrete-splay': { height: 0.12, width: 0.32, face: 'splay', batter: 0.09, material: 'concrete-kerb', channel: 0.35, channelFall: 0.025, mountable: false },
  'track-kerb': { height: 0.1, width: 0.16, face: 'vertical', material: 'concrete-kerb', channel: 0.2, channelFall: 0.01, mountable: false },
  'mountable-kerb': { height: 0.05, width: 0.25, face: 'batter', batter: 0.08, material: 'concrete-kerb', channel: 0.15, channelFall: 0.01, mountable: true },
  'flush-kerb': { height: 0.012, width: 0.2, face: 'vertical', material: 'granite-set', channel: 0.1, channelFall: 0.004, mountable: true },
  'stone-set-channel': { height: 0.11, width: 0.45, face: 'rollover', batter: 0.1, material: 'granite-set', channel: 0.4, channelFall: 0.03, mountable: false },
  'median-low': { height: 0.1, width: 0.3, face: 'splay', batter: 0.1, material: 'concrete-kerb', channel: 0, channelFall: 0, mountable: false },
  'median-high': { height: 0.25, width: 0.35, face: 'vertical', material: 'concrete-kerb', channel: 0, channelFall: 0, mountable: false },
};

// ── lane roles ───────────────────────────────────────────────────────────────
export const LANE_ROLES = {
  motor: { width: [3.0, 3.75], label: 'General traffic' },
  bus: { width: [3.3, 3.75], label: 'Bus / BRT lane', marking: 'bus-lane', color: 'red' },
  hov: { width: [3.2, 3.6], label: 'HOV / carpool', marking: 'hov-lane' },
  bike: { width: [1.6, 2.2], label: 'Advisory cycle lane', marking: 'bike-lane' },
  'cycle-track': { width: [2.0, 3.0], label: 'Kerbed cycle track', marking: 'bike-lane' },
  parking: { width: [2.2, 2.7], label: 'Parallel parking bay', marking: 'parking-bay' },
  'parking-90': { width: [4.8, 5.5], label: 'Perpendicular parking' },
  loading: { width: [2.4, 3.0], label: 'Loading bay', marking: 'parking-bay' },
  shoulder: { width: [0.5, 3.0], label: 'Hard shoulder', marking: 'edge-line' },
  tram: { width: [2.8, 3.2], label: 'Tram track lane' },
  transit: { width: [3.0, 3.4], label: 'Median transitway' },
  gutter: { width: [0.3, 0.6], label: 'Gutter / channel' },
  footway: { width: [1.5, 6.0], label: 'Footway / pavement' },
  shared: { width: [2.5, 4.5], label: 'Shared path' },
  verge: { width: [0.5, 8.0], label: 'Verge / planting strip' },
  ditch: { width: [0.8, 2.0], label: 'Drainage ditch' },
};

// ── road classes ─────────────────────────────────────────────────────────────
export const ROAD_CLASSES = {
  motorway: { label: 'Motorway', speed: 110, grid: 900, curve: 0.55, junction: 'interchange', lane: 'motor', footway: 'none', lights: 60, nameStyle: 'M-#' },
  expressway: { label: 'Expressway', speed: 90, grid: 700, curve: 0.45, junction: 'interchange', lane: 'motor', footway: 'none', lights: 55 },
  arterial: { label: 'Arterial', speed: 70, grid: 420, curve: 0.3, junction: 'signal', lane: 'motor', footway: 'both', lights: 42 },
  boulevard: { label: 'Boulevard', speed: 60, grid: 380, curve: 0.25, junction: 'signal', lane: 'motor', footway: 'both', lights: 38 },
  avenue: { label: 'Avenue', speed: 50, grid: 300, curve: 0.2, junction: 'signal', lane: 'motor', footway: 'both', lights: 34 },
  street: { label: 'Street', speed: 40, grid: 220, curve: 0.15, junction: 'giveway', lane: 'motor', footway: 'both', lights: 32 },
  lane: { label: 'Residential lane', speed: 30, grid: 150, curve: 0.12, junction: 'giveway', lane: 'motor', footway: 'one', lights: 30 },
  homezone: { label: 'Home zone / shared', speed: 20, grid: 140, curve: 0.1, junction: 'shared', lane: 'shared', footway: 'both', lights: 26 },
  alley: { label: 'Service alley', speed: 20, grid: 120, curve: 0.1, junction: 'shared', lane: 'shared', footway: 'none', lights: 0 },
  service: { label: 'Service road', speed: 30, grid: 180, curve: 0.12, junction: 'giveway', lane: 'motor', footway: 'one', lights: 28 },
  ramp: { label: 'Interchange ramp', speed: 60, grid: 200, curve: 0.7, junction: 'merge', lane: 'motor', footway: 'none', lights: 45 },
  'brt-way': { label: 'Busway (BRT)', speed: 60, grid: 350, curve: 0.3, junction: 'signal', lane: 'bus', footway: 'both', lights: 36 },
  'cycle-way': { label: 'Cycle superhighway', speed: 25, grid: 260, curve: 0.25, junction: 'giveway', lane: 'cycle-track', footway: 'both', lights: 26 },
  'coastal-drive': { label: 'Coastal / scenic drive', speed: 70, grid: 600, curve: 0.85, junction: 'giveway', lane: 'motor', footway: 'one', lights: 40 },
  viaduct: { label: 'Elevated viaduct', speed: 90, grid: 700, curve: 0.6, junction: 'merge', lane: 'motor', footway: 'none', lights: 50 },
  underpass: { label: 'Underpass / subway', speed: 80, grid: 600, curve: 0.5, junction: 'merge', lane: 'motor', footway: 'none', lights: 30 },
  'farm-track': { label: 'Farm track', speed: 20, grid: 300, curve: 0.6, junction: 'shared', lane: 'shared', footway: 'none', lights: 0 },
  'rail-line': { label: 'Railway', speed: 120, grid: 1200, curve: 0.75, junction: 'rail', lane: 'rail', footway: 'none', lights: 0 },
  'metro-line': { label: 'Metro (underground)', speed: 80, grid: 900, curve: 0.6, junction: 'rail', lane: 'rail', footway: 'none', lights: 0 },
  'tram-line': { label: 'Tram corridor', speed: 50, grid: 500, curve: 0.4, junction: 'signal', lane: 'tram', footway: 'both', lights: 32 },
};

// ── cross-sections ───────────────────────────────────────────────────────────
// `side` is the profile from the centre outward (one side); the mesher mirrors
// it. lane.dir is resolved against the drive-side setting: '+' travels along the
// centrelines direction, '-' against it, 'both' is a shared/2-way surface.
// Every element: { role, width, level: 'carriageway'|'raised'|'ground', kerb,
//                  material, markingIn, markingOut, dir }
const L = (role, width, extra = {}) => ({ role, width, level: 'carriageway', ...extra });

export const CROSS_SECTIONS = {
  'motorway-2x3': {
    label: 'Motorway · 2×3 + shoulders + barrier median',
    median: { width: 3.6, type: 'barrier', material: 'asphalt', kerb: null, markingIn: 'edge-line' },
    side: [
      L('motor', 3.6), L('motor', 3.6), L('motor', 3.65, { markingOut: 'edge-line' }), L('shoulder', 3.0, { material: 'asphalt-worn' }),
      { role: 'verge', width: 1.6, level: 'ground', material: 'grass' },
      { role: 'barrier', width: 0.2, level: 'ground', furniture: 'guardrail', height: 0.75 },
    ],
    speed: 110, oneWay: false, driveSide: 'both',
  },
  'motorway-2x2': {
    label: 'Motorway · 2×2 + shoulders',
    median: { width: 3.0, type: 'barrier', material: 'asphalt', markingIn: 'edge-line' },
    side: [
      L('motor', 3.65), L('motor', 3.65, { markingOut: 'edge-line' }), L('shoulder', 2.5, { material: 'asphalt-worn' }),
      { role: 'verge', width: 2.0, level: 'ground', material: 'grass' },
      { role: 'barrier', width: 0.2, level: 'ground', furniture: 'guardrail', height: 0.75 },
    ],
    speed: 110, oneWay: false,
  },
  'expressway-2x2': {
    label: 'Expressway · 2×2, kerbed median, no footway',
    median: { width: 4.0, type: 'kerbed', kerb: 'median-low', material: 'grass', markingIn: 'edge-line' },
    side: [L('motor', 3.6), L('motor', 3.6, { markingOut: 'edge-line' }), L('shoulder', 1.5, { material: 'asphalt-worn' }),
      { role: 'kerb', width: 0, kerb: 'concrete-halfbatter' },
      { role: 'verge', width: 2.3, level: 'raised', material: 'grass' }],
    speed: 90, oneWay: false,
  },
  'boulevard-2x3-median': {
    label: 'Boulevard · 2×3 with bus lane, planted median, cycle track',
    median: { width: 5.0, type: 'kerbed', kerb: 'median-low', material: 'grass', planted: 'trees', markingIn: 'edge-line' },
    side: [
      L('motor', 3.5), L('motor', 3.5), L('bus', 3.5, { markingOut: 'bus-lane' }),
      { role: 'kerb', width: 0, kerb: 'granite-halfbatter' },
      { role: 'cycle-track', width: 2.4, level: 'raised', material: 'paver-red', markingIn: 'bike-lane', kerbOutside: 'mountable-kerb', bollards: 12 },
      { role: 'verge', width: 0.6, level: 'raised', material: 'paver-grey' },
      { role: 'footway', width: 3.2, level: 'raised', material: 'paver' },
      { role: 'verge', width: 1.6, level: 'raised', material: 'grass', trees: 14 },
    ],
    speed: 60, oneWay: false,
  },
  'arterial-2x2-transit': {
    label: 'Arterial · 2×2 with tram median and parking lane',
    median: { width: 7.0, type: 'transit', material: 'concrete', rail: 'tram', markingIn: 'edge-line' },
    side: [
      L('motor', 3.4), L('motor', 3.4, { markingOut: 'edge-line' }), L('parking', 2.4, { markingOut: 'parking-bay', material: 'asphalt-worn' }),
      { role: 'kerb', width: 0, kerb: 'concrete-halfbatter' },
      { role: 'cycle-track', width: 2.0, level: 'raised', material: 'paver-red', markingIn: 'bike-lane' },
      { role: 'footway', width: 3.6, level: 'raised', material: 'paver' },
      { role: 'verge', width: 1.8, level: 'raised', material: 'grass', trees: 16 },
    ],
    speed: 60, oneWay: false,
  },
  'arterial-2x2': {
    label: 'Arterial · 2×2, kerbed median',
    median: { width: 3.2, type: 'kerbed', kerb: 'median-low', material: 'concrete', markingIn: 'edge-line' },
    side: [L('motor', 3.5), L('motor', 3.5, { markingOut: 'edge-line' }),
      { role: 'kerb', width: 0, kerb: 'concrete-halfbatter' },
      { role: 'bike', width: 1.8, level: 'raised', material: 'asphalt-worn', markingIn: 'bike-lane' },
      { role: 'footway', width: 2.6, level: 'raised', material: 'paver' },
      { role: 'verge', width: 2.5, level: 'raised', material: 'grass', trees: 20 }],
    speed: 70, oneWay: false,
  },
  'avenue-2x1-parking': {
    label: 'Avenue · 1 lane each way + both-side parking',
    median: null,
    side: [L('motor', 3.5, { markingIn: 'centre-line' }), L('parking', 2.4, { markingOut: 'parking-bay', material: 'asphalt-worn' }),
      { role: 'kerb', width: 0, kerb: 'granite-halfbatter' },
      { role: 'footway', width: 3.0, level: 'raised', material: 'paver' },
      { role: 'verge', width: 1.4, level: 'raised', material: 'grass', trees: 24 }],
    speed: 50, oneWay: false,
  },
  'street-2x1': {
    label: 'Street · 1 lane each way, parking bays',
    median: null,
    side: [L('motor', 3.2, { markingIn: 'centre-line' }), L('parking', 2.2, { markingOut: 'parking-bay', material: 'asphalt-worn' }),
      { role: 'kerb', width: 0, kerb: 'concrete-splay' },
      { role: 'footway', width: 2.2, level: 'raised', material: 'concrete-dirty' },
      { role: 'verge', width: 1.0, level: 'raised', material: 'grass' }],
    speed: 40, oneWay: false,
  },
  'street-1way-2lane': {
    label: 'Street · one-way, 2 lanes, one-side cycle lane',
    median: null, forceOneWay: true,
    side: [L('motor', 3.2, { dir: '+', invert: true }), L('bike', 1.8, { dir: '+', invert: true, markingOut: 'bike-lane', material: 'asphalt-worn' }),
      { role: 'kerb', width: 0, kerb: 'concrete-splay' },
      { role: 'footway', width: 2.4, level: 'raised', material: 'concrete-dirty' },
      { role: 'kerb', width: 0, kerb: 'concrete-splay' },
      { role: 'footway', width: 2.0, level: 'raised', material: 'concrete-dirty' }],
    speed: 40, oneWay: true,
  },
  'lane-2x1-shared': {
    label: 'Residential lane · 1 lane each way, no markings',
    median: null,
    side: [L('motor', 2.9), { role: 'kerb', width: 0, kerb: 'concrete-splay' },
      { role: 'footway', width: 1.8, level: 'raised', material: 'concrete-dirty' },
      { role: 'verge', width: 2.2, level: 'raised', material: 'grass', trees: 30 }],
    speed: 30, oneWay: false,
  },
  'homezone-shared': {
    label: 'Home zone · shared surface, flush kerbs',
    median: null, shared: true,
    side: [{ role: 'shared', width: 3.4, level: 'carriageway', material: 'paver' },
      { role: 'kerb', width: 0, kerb: 'flush-kerb' },
      { role: 'footway', width: 1.6, level: 'raised', material: 'paver' },
      { role: 'verge', width: 1.4, level: 'raised', material: 'grass', trees: 26 }],
    speed: 20, oneWay: false,
  },
  'alley-service': {
    label: 'Service alley · single shared strip, gravel shoulders',
    median: null, shared: true,
    side: [{ role: 'shared', width: 2.8, level: 'carriageway', material: 'asphalt-worn' },
      { role: 'kerb', width: 0, kerb: 'flush-kerb' },
      { role: 'verge', width: 0.9, level: 'raised', material: 'gravel' }],
    speed: 20, oneWay: true,
  },
  'ramp-1way': {
    label: 'Ramp · one-way, paved shoulder, guardrail',
    median: null, forceOneWay: true,
    side: [L('motor', 3.7), L('shoulder', 1.6, { material: 'asphalt-worn' }),
      { role: 'verge', width: 1.2, level: 'ground', material: 'grass' },
      { role: 'barrier', width: 0.2, level: 'ground', furniture: 'guardrail', height: 0.75 }],
    speed: 60, oneWay: true,
  },
  'brt-2way': {
    label: 'Busway · 1 lane each way, kerbed platforms',
    median: null,
    side: [L('bus', 3.6, { markingIn: 'centre-line' }), { role: 'kerb', width: 0, kerb: 'concrete-vertical' },
      { role: 'footway', width: 4.0, level: 'raised', material: 'concrete', platform: true },
      { role: 'verge', width: 1.0, level: 'raised', material: 'grass' }],
    speed: 60, oneWay: false,
  },
  'cycle-superhighway': {
    label: 'Cycle superhighway · 2×2 m cycleway + footway',
    median: { width: 0.4, type: 'kerbed', kerb: 'median-low', material: 'concrete', markingIn: 'edge-line' },
    side: [{ role: 'cycle-track', width: 2.2, level: 'carriageway', material: 'asphalt-worn', markingOut: 'bike-lane' },
      { role: 'kerb', width: 0, kerb: 'mountable-kerb' },
      { role: 'footway', width: 2.6, level: 'raised', material: 'paver' },
      { role: 'verge', width: 1.2, level: 'raised', material: 'grass', bollards: 20 }],
    speed: 25, oneWay: false, cycle: true,
  },
  'coastal-drive-2x1': {
    label: 'Coastal drive · 1 lane each way, wide scenic verge',
    median: null,
    side: [L('motor', 3.6, { markingIn: 'centre-line' }), L('shoulder', 1.2, { material: 'asphalt-worn', markingOut: 'edge-line' }),
      { role: 'kerb', width: 0, kerb: 'granite-halfbatter' },
      { role: 'footway', width: 2.4, level: 'raised', material: 'concrete-dirty' },
      { role: 'verge', width: 4.0, level: 'raised', material: 'grass', trees: 34 }],
    speed: 70, oneWay: false,
  },
  'viaduct-2x2': {
    label: 'Viaduct · 2×2 on deck, parapets, no footway',
    median: { width: 1.6, type: 'barrier', material: 'asphalt', markingIn: 'edge-line' },
    side: [L('motor', 3.6), L('motor', 3.6, { markingOut: 'edge-line' }), L('shoulder', 1.2, { material: 'asphalt-worn' }),
      { role: 'barrier', width: 0.4, level: 'carriageway', furniture: 'parapet', height: 1.1 }],
    speed: 90, oneWay: false,
  },
  'underpass-2x2': {
    label: 'Underpass / subway · 2×2 in bore, walkway, lights',
    median: { width: 1.2, type: 'barrier', material: 'concrete', markingIn: 'edge-line' },
    side: [L('motor', 3.4), L('motor', 3.4, { markingOut: 'edge-line' }), L('shoulder', 0.9, { material: 'concrete' }),
      { role: 'kerb', width: 0, kerb: 'concrete-vertical' },
      { role: 'footway', width: 1.4, level: 'raised', material: 'concrete', raised: true, lights: 22 }],
    speed: 80, oneWay: false, enclosure: 'tunnel',
  },
  'farm-track-single': {
    label: 'Farm track · single lane, gravel, open ditches',
    median: null, shared: true,
    side: [{ role: 'shared', width: 3.0, level: 'carriageway', material: 'gravel' },
      { role: 'ditch', width: 1.2, level: 'ground', material: 'gravel', depth: 0.4 },
      { role: 'verge', width: 3.0, level: 'ground', material: 'grass', fence: true }],
    speed: 20, oneWay: true,
  },
  'tram-median': {
    label: 'Tram corridor · double track in grass median',
    median: { width: 7.4, type: 'transit', material: 'grass', rail: 'tram', kerb: 'median-low' },
    side: [L('motor', 3.4, { markingIn: 'centre-line' }), L('parking', 2.3, { material: 'asphalt-worn', markingOut: 'parking-bay' }),
      { role: 'kerb', width: 0, kerb: 'granite-halfbatter' },
      { role: 'footway', width: 3.4, level: 'raised', material: 'paver', platform: true, lights: 26 },
      { role: 'verge', width: 2.0, level: 'raised', material: 'grass', trees: 18 }],
    speed: 50, oneWay: false,
  },
  'plaza-shared': {
    label: 'Plaza · shared paving, no kerbs',
    median: null, shared: true,
    side: [{ role: 'shared', width: 6.0, level: 'carriageway', material: 'paver' },
      { role: 'verge', width: 2.0, level: 'carriageway', material: 'paver-grey', bollards: 8 }],
    speed: 20, oneWay: false,
  },
  'rail-2track': {
    label: 'Railway · double track ballast',
    median: null, forceOneWay: true, railway: true,
    side: [{ role: 'rail', width: 2.1, level: 'carriageway', material: 'ballast', rail: 'rail' },
      { role: 'rail', width: 2.1, level: 'carriageway', material: 'ballast', rail: 'rail' },
      { role: 'shoulder', width: 1.4, level: 'carriageway', material: 'ballast' },
      { role: 'verge', width: 1.6, level: 'ground', material: 'grass', fence: true }],
    speed: 120, oneWay: true,
  },
  'metro-2track': {
    label: 'Metro · double track, elevated or underground',
    median: null, forceOneWay: true, railway: true, enclosure: 'tunnel',
    side: [{ role: 'rail', width: 2.1, level: 'carriageway', material: 'concrete', rail: 'metro' },
      { role: 'rail', width: 2.1, level: 'carriageway', material: 'concrete', rail: 'metro' },
      { role: 'footway', width: 1.6, level: 'carriageway', material: 'concrete', raised: true, lights: 20 },
      { role: 'shoulder', width: 0.8, level: 'carriageway', material: 'concrete' }],
    speed: 80, oneWay: true,
  },
};

// ── markings ─────────────────────────────────────────────────────────────────
// kind: line (dash pattern along the lane boundary), area (fill/fill with hatch),
// symbol (glyph from the symbol library), zebra, chevron.
export const MARKINGS = {
  none: null,
  'lane-dash': { kind: 'line', color: 'white', width: 0.12, dash: 3.0, gap: 9.0, material: 'marking-white' },
  'lane-dash-short': { kind: 'line', color: 'white', width: 0.12, dash: 1.0, gap: 1.0, material: 'marking-white' },
  'lane-solid': { kind: 'line', color: 'white', width: 0.12, material: 'marking-white' },
  'edge-line': { kind: 'line', color: 'white', width: 0.15, material: 'marking-white' },
  'centre-line': { kind: 'line', color: 'yellow', width: 0.12, dash: 3.0, gap: 6.0, material: 'marking-yellow' },
  'centre-double': { kind: 'line', color: 'yellow', width: 0.1, gapBetween: 0.1, double: true, material: 'marking-yellow' },
  'no-overtaking': { kind: 'line', color: 'yellow', width: 0.1, gapBetween: 0.12, double: true, material: 'marking-yellow' },
  'bus-lane': { kind: 'line', color: 'white', width: 0.15, separation: true, text: 'BUS', textColor: 'white', material: 'marking-white' },
  'hov-lane': { kind: 'line', color: 'white', width: 0.15, separation: true, text: 'HOV', material: 'marking-white' },
  'bike-lane': { kind: 'line', color: 'white', width: 0.12, dash: 1.0, gap: 2.0, symbol: 'bike', material: 'marking-white' },
  'parking-bay': { kind: 'line', color: 'white', width: 0.1, bays: true, bayLength: 5.5, material: 'marking-white' },
  'stop-line': { kind: 'line', color: 'white', width: 0.4, material: 'marking-white' },
  'give-way': { kind: 'line', color: 'white', width: 0.3, dashed: 0.5, gap: 0.3, material: 'marking-white' },
  zebra: { kind: 'zebra', color: 'white', stripe: 0.6, gap: 0.6, material: 'marking-white' },
  'crossing-raised': { kind: 'zebra', color: 'white', stripe: 0.5, gap: 0.5, raised: true, material: 'marking-white' },
  'crossing-signal': { kind: 'zebra', color: 'white', stripe: 0.5, gap: 0.5, stopLine: true, material: 'marking-white' },
  'crossing-cycle': { kind: 'zebra', color: 'white', stripe: 0.5, gap: 0.5, cycle: true, material: 'marking-white' },
  'hatched-island': { kind: 'area', color: 'white', hatch: { width: 0.15, spacing: 1.6, angle: 0.7 }, material: 'marking-white' },
  'chevron-merge': { kind: 'chevron', color: 'white', stripe: 0.45, gap: 0.45, material: 'marking-white' },
  'kerb-blaze': { kind: 'line', color: 'yellow', width: 0.3, dash: 2.0, gap: 2.0, material: 'marking-yellow' },
  'kerb-blaze-red': { kind: 'line', color: 'red', width: 0.3, material: 'marking-red' },
  'bus-stop-box': { kind: 'area', color: 'white', outline: true, bays: false, material: 'marking-white' },
  'school-zone': { kind: 'line', color: 'yellow', width: 0.25, zigzag: true, dash: 1.0, gap: 0.6, material: 'marking-yellow' },
  'rail-x': { kind: 'symbol', color: 'white', symbol: 'rail-x', material: 'marking-white' },
  'rail-crossing-band': { kind: 'area', color: 'white', hatch: { width: 0.2, spacing: 0.9, angle: 0.35 }, material: 'marking-white' },
  rumble: { kind: 'line', color: 'white', width: 0.3, dash: 0.4, gap: 0.4, material: 'marking-white' },
};

export const SYMBOLS = ['arrow-straight', 'arrow-left', 'arrow-right', 'arrow-straight-left', 'arrow-straight-right', 'arrow-left-right', 'arrow-uturn', 'arrow-merge-left', 'arrow-merge-right', 'arrow-shunt', 'bike', 'bus', 'chevron', 'give-way-triangle', 'keep-left', 'keep-right', 'rail-x', 'SLOW', 'KEEP', 'CLEAR'];

// ── furniture ────────────────────────────────────────────────────────────────
// size is [across, height, along]; placement rules are read by the placer.
export const FURNITURE = {
  'bollard-steel': { label: 'Steel bollard', kind: 'bollard', size: [0.11, 1.05, 0.11], material: 'metal-dark', cap: 'paint-red', spacing: 1.4, on: 'footway-edge' },
  'bollard-flexi': { label: 'Flexible bollard', kind: 'bollard', size: [0.09, 0.95, 0.09], material: 'plastic-black', cap: 'plastic-yellow', spacing: 2.0, on: 'lane-boundary', flexible: true },
  'bollard-illuminated': { label: 'Illuminated keep-left bollard', kind: 'bollard', size: [0.25, 1.0, 0.25], material: 'metal-dark', cap: 'lamp-glass', emissive: true, spacing: 1.2, on: 'island-nose' },
  'delineator-post': { label: 'Delineator post', kind: 'post', size: [0.1, 1.0, 0.06], material: 'plastic-yellow', reflector: 'white', spacing: 25, on: 'shoulder-edge' },
  'refuge-post': { label: 'Refuge beacon', kind: 'post', size: [0.12, 1.1, 0.12], material: 'plastic-black', cap: 'lamp-glass', emissive: true, spacing: 1.0, on: 'island' },
  'speed-bump-3.7': { label: 'Speed bump · 3.7 m', kind: 'bump', profile: 'bump', rise: 0.075, length: 3.7, width: 'lane', material: 'asphalt-worn', marking: 'triangle', on: 'carriageway' },
  'speed-hump-4.2': { label: 'Speed hump · 4.2 m', kind: 'bump', profile: 'hump', rise: 0.09, length: 4.2, width: 'lane', material: 'asphalt-worn', on: 'carriageway' },
  'speed-table': { label: 'Raised speed table / crossing', kind: 'bump', profile: 'table', rise: 0.1, length: 6.5, width: 'full', material: 'paver-grey', ramp: 1.6, marking: 'zebra', on: 'crossing' },
  'speed-cushion': { label: 'Speed cushions', kind: 'bump', profile: 'cushions', rise: 0.075, length: 3.2, width: 'cushion', material: 'asphalt-worn', on: 'carriageway' },
  'streetlight-single': { label: 'Street light · single arm', kind: 'pole', size: [0.16, 9.0, 0.16], arm: 2.0, armHeight: 8.6, lamp: 'led', material: 'metal-light', spacing: 38, on: 'verge-inner', side: 'alternating' },
  'streetlight-twin': { label: 'Street light · twin arm', kind: 'pole', size: [0.18, 11.0, 0.18], arm: 2.4, armHeight: 10.4, lamp: 'led', material: 'metal-light', spacing: 44, on: 'median' },
  'streetlight-mast': { label: 'High mast', kind: 'pole', size: [0.3, 15.0, 0.3], arm: 0, lamp: 'cluster', material: 'metal-light', spacing: 90, on: 'island' },
  'signal-mast': { label: 'Traffic signal · mast arm', kind: 'signal', size: [0.18, 7.0, 0.18], arm: 5.0, heads: 3, material: 'metal-dark', on: 'corner' },
  'signal-post': { label: 'Traffic signal · post', kind: 'signal', size: [0.14, 3.6, 0.14], arm: 0, heads: 1, material: 'metal-dark', on: 'corner' },
  'signal-ped': { label: 'Pedestrian signal', kind: 'signal', size: [0.12, 2.6, 0.12], arm: 0, heads: 1, pedestrian: true, material: 'metal-dark', on: 'crossing' },
  'guardrail': { label: 'Guardrail (W-beam)', kind: 'rail', postSpacing: 2.0, railHeights: [0.45, 0.72], height: 0.78, material: 'metal-light', on: 'verge-edge' },
  'parapet': { label: 'Bridge parapet', kind: 'rail', postSpacing: 2.4, railHeights: [0.55, 0.95, 1.05], height: 1.15, material: 'concrete', on: 'deck-edge' },
  'fence-chain': { label: 'Boundary fence', kind: 'fence', postSpacing: 3.0, height: 1.8, material: 'metal-dark', on: 'verge-outer' },
  'fence-picket': { label: 'Picket fence', kind: 'fence', postSpacing: 2.2, height: 1.1, material: 'wood', on: 'verge-outer' },
  'crash-attenuator': { label: 'Crash attenuator', kind: 'box', size: [0.9, 1.2, 2.4], material: 'plastic-yellow', on: 'gore' },
  'hydrant': { label: 'Fire hydrant', kind: 'box', size: [0.25, 0.8, 0.25], material: 'paint-red', spacing: 90, on: 'footway-edge' },
  'bin': { label: 'Litter bin', kind: 'box', size: [0.5, 0.9, 0.5], material: 'metal-dark', spacing: 120, on: 'footway-outer' },
  'bench': { label: 'Bench', kind: 'box', size: [0.6, 0.85, 1.8], material: 'wood', spacing: 180, on: 'footway-outer' },
  'bus-shelter': { label: 'Bus shelter', kind: 'shelter', size: [1.4, 2.4, 4.2], material: 'metal-light', glass: true, spacing: 350, on: 'footway-edge' },
  'bus-stop-flag': { label: 'Bus stop flag', kind: 'pole', size: [0.08, 3.0, 0.08], material: 'metal-light', sign: 'bus', spacing: 350, on: 'footway-edge' },
  'ticket-machine': { label: 'Ticket machine', kind: 'box', size: [0.55, 1.7, 0.4], material: 'metal-dark', spacing: 400, on: 'footway-outer' },
  'sign-giveway': { label: 'Give-way sign', kind: 'sign', size: [0.9, 0.9, 0.06], poleHeight: 2.4, shape: 'triangle-down', material: 'paint-white', face: 'give-way', on: 'corner' },
  'sign-stop': { label: 'Stop sign', kind: 'sign', size: [0.75, 0.75, 0.06], poleHeight: 2.4, shape: 'octagon', material: 'paint-red', face: 'stop', on: 'corner' },
  'sign-speed': { label: 'Speed limit sign', kind: 'sign', size: [0.6, 0.6, 0.06], poleHeight: 2.6, shape: 'round', face: 'speed', spacing: 400, on: 'verge-inner' },
  'sign-cycle': { label: 'Cycle route sign', kind: 'sign', size: [0.5, 0.75, 0.06], poleHeight: 2.4, shape: 'rect', face: 'cycle', spacing: 250, on: 'cycle-track' },
  'sign-road-name': { label: 'Street name', kind: 'sign', size: [1.1, 0.3, 0.06], poleHeight: 2.4, shape: 'rect', face: 'name', spacing: 150, on: 'corner' },
  'sign-warning': { label: 'Warning sign', kind: 'sign', size: [0.75, 0.68, 0.06], poleHeight: 2.5, shape: 'diamond', face: 'warning', spacing: 300, on: 'verge-inner' },
  'sign-direction': { label: 'Direction gantry sign', kind: 'sign', size: [3.4, 1.6, 0.1], poleHeight: 6.0, shape: 'rect', face: 'direction', on: 'gantry' },
  'cctv': { label: 'CCTV column', kind: 'pole', size: [0.14, 6.0, 0.14], arm: 1.4, material: 'metal-light', on: 'corner' },
  'utility-cabinet': { label: 'Utility cabinet', kind: 'box', size: [0.7, 1.3, 0.5], material: 'metal-light', spacing: 220, on: 'footway-outer' },
  'tree-street': { label: 'Street tree', kind: 'tree', height: 6.5, crown: 2.6, material: 'wood', spacing: 11, on: 'verge', trees: true },
  'bike-rack': { label: 'Bike rack', kind: 'box', size: [0.5, 0.85, 1.6], material: 'metal-light', spacing: 150, on: 'footway-outer' },
  'rail-signal': { label: 'Railway signal', kind: 'pole', size: [0.16, 4.5, 0.16], arm: 1.0, material: 'metal-dark', on: 'rail-side' },
  'crossing-boom': { label: 'Level-crossing boom', kind: 'boom', length: 5.2, height: 1.05, material: 'paint-white', stripe: 'paint-red', on: 'rail-crossing' },
  'crossing-lights': { label: 'Level-crossing lights', kind: 'signal', size: [0.2, 3.4, 0.2], heads: 2, xenon: true, material: 'metal-dark', on: 'rail-crossing' },
  'platform-edge': { label: 'Platform edge strip', kind: 'strip', material: 'plastic-yellow', on: 'platform' },
};

// ── drive side ───────────────────────────────────────────────────────────────
export const DRIVE_SIDES = {
  left: { id: 'left', label: 'Left-hand traffic (UK · ZA · JP · AU · IN)', centreMarking: 'centre-double' },
  right: { id: 'right', label: 'Right-hand traffic (US · EU · BR · CN)', centreMarking: 'centre-line' },
};

/**
 * Expand a cross-section preset into concrete bands with signed offsets from the
 * centreline. Offset sign follows the centrelines left-hand normal: positive
 * offsets are on the LEFT of the direction of travel of the centreline.
 *
 * Returns
 *   median   { half, level, material, type, kerb, planted, rail, transit, markingIn } | null
 *   sides[]  { sign, bands, outer }  — band.from/to are already signed
 *   bands[]  flattened view of both sides
 *   kerbs[]  { offset, side, type }  side +1 = left run, -1 = right run
 *   carriagewayHalf / corridorHalf / medianHalf
 */
export function expandProfile(sectionId, opts = {}) {
  const sec = CROSS_SECTIONS[sectionId] || CROSS_SECTIONS['street-2x1'];
  const driveSide = opts.driveSide || 'left';
  const laneWidths = opts.laneWidths || {};
  const scale = opts.widthScale ?? 1;
  const oneWay = opts.oneWay ?? sec.oneWay ?? false;
  const medianHalf = sec.median ? sec.median.width / 2 : 0;
  const shared = !!(sec.shared || opts.shared);

  // Keeping left: the lanes left of the centreline run WITH the centreline
  // direction. Keeping right: they run against it.
  const nearDir = driveSide === 'left' ? '+' : '-';
  const farDir = nearDir === '+' ? '-' : '+';

  const kerbs = [];
  const sides = [];
  for (const sign of [1, -1]) {
    const bands = [];
    let cursor = medianHalf;
    let laneIndex = 0;
    const travel = shared ? 'both' : oneWay ? '+' : sign > 0 ? nearDir : farDir;
    for (const el of sec.side) {
      if (el.role === 'kerb') { kerbs.push({ offset: sign * cursor, side: sign, type: KERBS[el.kerb] }); continue; }
      let width = (el.role === 'motor' || el.role === 'bus') ? (laneWidths[el.role] ?? el.width) : el.width;
      width *= el.widthScale ?? scale;
      const from = cursor, to = cursor + width;
      const level = el.level === 'raised' ? 'raised' : el.level === 'ground' ? 'ground' : 'carriageway';
      const role = el.role;
      const isLane = ['motor', 'bus', 'hov', 'bike', 'cycle-track', 'parking', 'parking-90', 'loading', 'shared', 'tram', 'rail'].includes(role);
      const bandLaneIndex = isLane ? laneIndex++ : -1;
      const band = {
        from: sign * from, to: sign * to,
        role, level,
        material: el.material || (level === 'carriageway' ? 'asphalt' : 'grass'),
        dir: role === 'rail' ? 'both' : role === 'shared' ? 'both' : el.dir || travel,
        lane: isLane,
        laneRole: role,
        laneIndex: bandLaneIndex,
        side: sign,
        shoulder: role === 'shoulder',
        markingIn: el.markingIn || null, markingOut: el.markingOut || null,
        rail: el.rail || null, bollards: el.bollards || 0, trees: el.trees || 0,
        furniture: el.furniture || null, fence: el.fence || null, depth: el.depth || 0,
        platform: !!el.platform, lights: el.lights || 0, raised: !!el.raised,
        height: el.height ?? null, kerbOutside: el.kerbOutside || null,
        median: false,
      };
      bands.push(band);
      cursor += width;
      if (el.kerbOutside) kerbs.push({ offset: sign * cursor, side: sign, type: KERBS[el.kerbOutside] });
    }
    sides.push({ sign, bands, outer: cursor });
  }

  const bands = [...sides[0].bands, ...sides[1].bands];
  const corridorHalf = Math.max(sides[0].outer, sides[1].outer);
  const carriagewayHalf = Math.max(0, ...bands.filter((b) => b.level === 'carriageway').map((b) => Math.abs(b.to)));

  // Centre marking: exactly one line is drawn at offset 0 (or one per median edge).
  const centreMark = opts.centreMarking
    || sec.median?.markingIn
    || (driveSide === 'left' ? 'centre-double' : 'centre-line');
  if (!sec.median && !oneWay && !shared) {
    const leftInnermost = sides[0].bands[0];
    if (leftInnermost) leftInnermost.markingIn = leftInnermost.markingIn || centreMark;
    const rightInnermost = sides[1].bands[0];
    if (rightInnermost) rightInnermost.markingIn = null; // same asphalt line: drawn once
  }

  const median = sec.median ? {
    half: medianHalf, level: sec.median.type === 'barrier' ? 'carriageway' : 'raised',
    material: sec.median.material || 'grass', type: sec.median.type,
    kerb: sec.median.kerb || null, planted: sec.median.planted || null,
    rail: sec.median.rail || null, transit: sec.median.type === 'transit',
    markingIn: sec.median.markingIn || null,
    width: sec.median.width,
  } : null;

  return {
    id: sectionId, label: sec.label, sides, bands, kerbs, median, medianHalf,
    driveSide, oneWay: !!(oneWay || sec.forceOneWay), shared,
    speed: opts.speed ?? sec.speed ?? 50,
    corridorHalf, carriagewayHalf, halfWidth: corridorHalf,
    railway: !!sec.railway, cycle: !!sec.cycle, enclosure: sec.enclosure || null,
    forceOneWay: !!sec.forceOneWay,
  };
}

/** Lane count (excluding shoulders) of an expanded profile. */
export function profileLaneCount(profile) {
  return profile.bands.filter((b) => b.lane !== false && b.role !== 'shoulder').length;
}

/** Signed lane boundary offsets, innermost first, used by markings + navigation. */
export function profileLaneBoundaries(profile) {
  const out = [];
  for (const side of profile.sides) {
    const lanes = side.bands.filter((b) => b.lane !== false && b.role !== 'shoulder');
    for (const b of lanes) out.push({ side: side.sign, offset: b.from, role: b.role, dir: b.dir, boundary: 'inner' });
    const last = lanes[lanes.length - 1];
    if (last) out.push({ side: side.sign, offset: last.to, role: last.role, dir: last.dir, boundary: 'outer', edge: true });
  }
  return out;
}

export function crossSectionIds() { return Object.keys(CROSS_SECTIONS); }
export function roadClassIds() { return Object.keys(ROAD_CLASSES); }
export function furnitureIds() { return Object.keys(FURNITURE); }
export function markingIds() { return Object.keys(MARKINGS); }

/** Deterministic per-road variation (worn markings, patch repairs, potholes). */
export function roadVariation(roadId, seed = 0) {
  const rng = makeRng(hashStr(String(roadId)) ^ seed);
  return {
    worn: clamp(rng.range(0, 1), 0, 1),
    repairs: rng.int(0, 4),
    gradient: rng.range(-0.004, 0.004),
    lightOffset: rng.range(0, 1),
  };
}
