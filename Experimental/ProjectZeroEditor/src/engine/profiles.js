// The road catalogue.
//
// A road is described by an ordered list of lanes running from the LEFT edge of the
// cross-section to the RIGHT edge, looking along the road's forward direction
// (first control point -> last control point).  Each lane carries a travel
// direction: +1 travels forward, -1 travels back, 0 is non-directional.
//
// Profiles are authored for right-hand traffic.  The network stores a global
// `driveSide` and `mirrorProfile()` flips the whole layout for left-hand traffic,
// so every entry below works in both worlds for free.

/** Lane kinds the geometry builder understands. */
export const LANE_KINDS = {
  driving: { label: 'Driving lane', surface: 'asphalt', dir: 1, h: 0, drivable: true },
  bus: { label: 'Bus lane', surface: 'asphalt', dir: 1, h: 0, drivable: true, tint: 'bus' },
  cycle: { label: 'Cycle lane', surface: 'asphalt', dir: 1, h: 0, drivable: true, tint: 'cycle' },
  parking: { label: 'Parking bay', surface: 'asphalt', dir: 1, h: 0, drivable: true },
  shoulder: { label: 'Hard shoulder', surface: 'asphalt', dir: 1, h: 0, drivable: true },
  hov: { label: 'HOV / car-pool', surface: 'asphalt', dir: 1, h: 0, drivable: true },
  buffer: { label: 'Hatched buffer', surface: 'asphalt', dir: 0, h: 0 },
  median: { label: 'Central reservation', surface: 'concrete', dir: 0, h: 0.16, variant: 'raised' },
  sidewalk: { label: 'Footway', surface: 'slab', dir: 0, h: 0.15 },
  planting: { label: 'Planting strip', surface: 'grass', dir: 0, h: 0.15 },
  verge: { label: 'Verge', surface: 'grass', dir: 0, h: 0 },
  shared: { label: 'Shared surface', surface: 'sett', dir: 0, h: 0 },
  pathway: { label: 'Pathway', surface: 'asphalt', dir: 0, h: 0.02 },
  rail: { label: 'Railway', surface: 'ballast', dir: 0, h: 0 },
  tram: { label: 'Tram track', surface: 'sett', dir: 0, h: 0 },
  channel: { label: 'Water channel', surface: 'stone', dir: 0, h: -0.12 },
};

export const LANE_KIND_LIST = Object.keys(LANE_KINDS);

export function makeLane(kind, width, extra = {}) {
  return { kind, width, dir: LANE_KINDS[kind]?.dir ?? 0, surface: LANE_KINDS[kind]?.surface ?? 'asphalt', ...extra };
}

/** Short helpers keep the catalogue readable. */
const sw = (w, extra) => makeLane('sidewalk', w, extra);
const dv = (w, dir, extra) => makeLane('driving', w, { dir, ...extra });
const bus = (w, dir, extra) => makeLane('bus', w, { dir, ...extra });
const cyc = (w, dir, extra) => makeLane('cycle', w, { dir, ...extra });
const park = (w, dir, extra) => makeLane('parking', w, { dir, ...extra });
const sh = (w, dir, extra) => makeLane('shoulder', w, { dir, ...extra });
const med = (w, extra) => makeLane('median', w, extra);
const buf = (w, extra) => makeLane('buffer', w, extra);
const pl = (w, extra) => makeLane('planting', w, extra);
const vg = (w, extra) => makeLane('verge', w, extra);
const shared = (w, extra) => makeLane('shared', w, extra);
const path = (w, extra) => makeLane('pathway', w, extra);
const rail = (w, extra) => makeLane('rail', w, extra);
const tram = (w, extra) => makeLane('tram', w, extra);

export const CATEGORIES = [
  { id: 'motorway', label: 'Motorways & expressways', accent: '#8ea2b4' },
  { id: 'urban', label: 'Urban streets', accent: '#c9a97a' },
  { id: 'residential', label: 'Residential & shared space', accent: '#a8c08a' },
  { id: 'rural', label: 'Rural & unpaved', accent: '#b79c7a' },
  { id: 'active', label: 'Walking & cycling', accent: '#7fb8a4' },
  { id: 'transit', label: 'Rail & transit', accent: '#9a9ec4' },
  { id: 'structure', label: 'Bridges, tunnels & specials', accent: '#c48a8a' },
];

/**
 * The catalogue.  `hints` guide the city generator (lighting, planting, furniture)
 * and `markings` control what gets painted between the kerbs.
 */
export const PROFILES = [
  /* ------------------------------------------------------------------ */
  /* Motorways & expressways                                             */
  /* ------------------------------------------------------------------ */
  {
    id: 'motorway-2x2',
    name: 'Motorway 2+2',
    category: 'motorway',
    origin: 'Interstate / Autobahn / M-way',
    blurb: 'Grade-separated dual carriageway, 3.75 m lanes, hard shoulders and a barriered central reservation.',
    speed: 120,
    lanes: [vg(3), sh(3, -1), dv(3.75, -1), dv(3.75, -1), med(4.5, { variant: 'barrier' }), dv(3.75, 1), dv(3.75, 1), sh(3, 1), vg(3)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 60, side: 'left' }, barrier: 'both', noise: true },
    tags: ['highway', 'dual'],
  },
  {
    id: 'motorway-3x3',
    name: 'Motorway 3+3',
    category: 'motorway',
    origin: 'Urban motorway, 6 lanes',
    blurb: 'Six-lane motorway with hard shoulders and a concrete step barrier down the middle.',
    speed: 110,
    lanes: [vg(2.5), sh(3, -1), dv(3.5, -1), dv(3.5, -1), dv(3.5, -1), med(3.5, { variant: 'barrier' }), dv(3.5, 1), dv(3.5, 1), dv(3.5, 1), sh(3, 1), vg(2.5)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 55, side: 'both' }, barrier: 'both', noise: true },
    tags: ['highway', 'dual'],
  },
  {
    id: 'motorway-hov',
    name: 'Motorway with HOV lane',
    category: 'motorway',
    origin: 'US car-pool / managed lane',
    blurb: 'Inner lane reserved for high-occupancy vehicles, marked with diamonds and a double white buffer.',
    speed: 110,
    lanes: [vg(3), sh(2.5, -1), makeLane('hov', 3.6, { dir: -1 }), dv(3.6, -1), dv(3.6, -1), med(3.5, { variant: 'barrier' }), dv(3.6, 1), dv(3.6, 1), makeLane('hov', 3.6, { dir: 1 }), sh(2.5, 1), vg(3)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 55, side: 'both' }, barrier: 'both', noise: true },
    tags: ['highway', 'dual'],
  },
  {
    id: 'expressway-dual',
    name: 'Dual carriageway A-road',
    category: 'motorway',
    origin: 'UK / Ireland dual carriageway',
    blurb: 'At-grade-capable dual carriageway with a hatched flush central reservation.',
    speed: 100,
    lanes: [vg(2.5), dv(3.65, -1), dv(3.65, -1), med(2.4, { variant: 'hatched' }), dv(3.65, 1), dv(3.65, 1), vg(2.5)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 45, side: 'both' } },
    tags: ['highway', 'dual'],
  },
  {
    id: 'slip-road',
    name: 'Slip road / ramp',
    category: 'motorway',
    origin: 'Motorway on-off ramp',
    blurb: 'Single wide lane with generous sealed shoulders for merge and diverge movements.',
    speed: 60,
    lanes: [vg(2), sh(2, -1, { surface: 'asphaltWorn' }), dv(5, -1), sh(2.5, -1, { surface: 'asphaltWorn' }), vg(2)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 70, side: 'right' } },
    tags: ['highway', 'ramp'],
  },

  /* ------------------------------------------------------------------ */
  /* Urban streets                                                       */
  /* ------------------------------------------------------------------ */
  {
    id: 'arterial-bus-cycle',
    name: 'Urban arterial — bus + cycle',
    category: 'urban',
    origin: 'Continental / modern city arterial',
    blurb: 'Two lanes each way with a kerbside bus lane, protected-width cycle lane and 3 m footways.',
    speed: 50,
    lanes: [
      sw(3), cyc(2, -1), bus(3.4, -1), dv(3.25, -1), dv(3.25, -1),
      dv(3.25, 1), dv(3.25, 1), bus(3.4, 1), cyc(2, 1), sw(3),
    ],
    centerLine: 'double-yellow',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 32, side: 'both' }, trees: { spacing: 14 }, bollards: false, busStop: true, crossings: true },
    tags: ['urban', 'transit', 'cycle'],
  },
  {
    id: 'arterial-car',
    name: 'Urban arterial — general traffic',
    category: 'urban',
    origin: 'Car-oriented arterial',
    blurb: 'Three lanes each way, no cycle provision, wide footways with planting.',
    speed: 60,
    lanes: [
      sw(3.5), pl(1.6), dv(3.4, -1), dv(3.4, -1), dv(3.4, -1),
      dv(3.4, 1), dv(3.4, 1), dv(3.4, 1), pl(1.6), sw(3.5),
    ],
    centerLine: 'double-yellow',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 34, side: 'both' }, trees: { spacing: 12 }, crossings: true },
    tags: ['urban'],
  },
  {
    id: 'boulevard',
    name: 'Boulevard',
    category: 'urban',
    origin: 'Paris / Barcelona / Vienna',
    blurb: 'Grand boulevard: tree-lined central reservation, two lanes each way, generous promenade footways.',
    speed: 50,
    lanes: [
      sw(5), pl(2), cyc(2.2, -1), dv(3.3, -1), dv(3.3, -1),
      med(6, { variant: 'raised', surface: 'grass' }),
      dv(3.3, 1), dv(3.3, 1), cyc(2.2, 1), pl(2), sw(5),
    ],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 26, side: 'both', type: 'heritage' }, trees: { spacing: 9 }, crossings: true, benches: true },
    tags: ['urban', 'grand'],
  },
  {
    id: 'avenue-parking',
    name: 'Avenue with parking',
    category: 'urban',
    origin: 'Classic city avenue',
    blurb: 'One lane each way flanked by kerbside parking bays and footways with street trees.',
    speed: 40,
    lanes: [sw(3), park(2.4, -1), dv(3.3, -1), dv(3.3, 1), park(2.4, 1), sw(3)],
    centerLine: 'double-yellow',
    edgeLine: 'none',
    hints: { lighting: { spacing: 28, side: 'both' }, trees: { spacing: 11 }, parking: true, crossings: true },
    tags: ['urban', 'parking'],
  },
  {
    id: 'downtown-street',
    name: 'Downtown street',
    category: 'urban',
    origin: 'North-American downtown grid',
    blurb: 'Two moving lanes, one parking lane, a loading bay and wide pedestrian footways.',
    speed: 30,
    lanes: [sw(4), makeLane('parking', 2.6, { dir: -1, variant: 'loading' }), dv(3.2, -1), dv(3.2, 1), park(2.6, 1), sw(4)],
    centerLine: 'double-yellow',
    edgeLine: 'none',
    hints: { lighting: { spacing: 24, side: 'both' }, trees: { spacing: 15 }, parking: true, crossings: true, signals: true },
    tags: ['urban', 'parking'],
  },
  {
    id: 'one-way-contraflow',
    name: 'One-way with contraflow cycle',
    category: 'urban',
    origin: 'Dutch / Belgian one-way system',
    blurb: 'One-way for cars, two-way for bikes: a contraflow cycle lane runs against traffic.',
    speed: 30,
    lanes: [sw(3), cyc(2, -1, { variant: 'contraflow' }), dv(3.1, 1), dv(3.1, 1), park(2.4, 1), sw(3)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 26, side: 'both' }, parking: true, crossings: true },
    tags: ['urban', 'cycle', 'one-way'],
  },
  {
    id: 'brt-corridor',
    name: 'BRT corridor',
    category: 'urban',
    origin: 'Bus rapid transit',
    blurb: 'Dedicated central busway with station platforms in the median and a passing lane at stops.',
    speed: 50,
    lanes: [
      sw(3), cyc(2, -1), dv(3.2, -1), dv(3.2, -1), bus(3.6, -1),
      med(3.2, { variant: 'platform' }),
      bus(3.6, 1), dv(3.2, 1), dv(3.2, 1), cyc(2, 1), sw(3),
    ],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 30, side: 'both' }, trees: { spacing: 16 }, busStop: true, brt: true, crossings: true },
    tags: ['urban', 'transit', 'brt'],
  },
  {
    id: 'tram-street',
    name: 'Street with tram tracks',
    category: 'urban',
    origin: 'Melbourne / Prague / Amsterdam',
    blurb: 'Tram reservation in the centre with setted track bed, cycle lanes and footways either side.',
    speed: 40,
    lanes: [sw(3), cyc(1.8, -1), dv(3.2, -1), tram(6.4), dv(3.2, 1), cyc(1.8, 1), sw(3)],
    centerLine: 'none',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 30, side: 'both' }, trees: { spacing: 16 }, crossings: true, tram: true },
    tags: ['urban', 'transit', 'tram'],
  },
  {
    id: 'industrial-estate',
    name: 'Industrial estate road',
    category: 'urban',
    origin: 'Freight-oriented estate road',
    blurb: 'Wide concrete lanes built for HGVs, sweeping corners and no footway on the working side.',
    speed: 40,
    lanes: [vg(2.5), dv(4, -1, { surface: 'concrete' }), dv(4, 1, { surface: 'concrete' }), sw(2, { surface: 'concrete' }), vg(2.5)],
    centerLine: 'single-white',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 40, side: 'right' }, barrier: 'none' },
    tags: ['urban', 'freight'],
  },
  {
    id: 'port-road',
    name: 'Dock / port road',
    category: 'urban',
    origin: 'Working port with rail spurs',
    blurb: 'Heavy-duty pavement with railway tracks embedded in the carriageway and quayside bollards.',
    speed: 30,
    lanes: [vg(2), dv(4.2, -1), rail(6.5), dv(4.2, 1), vg(2)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 45, side: 'right', type: 'flood' }, bollards: true },
    tags: ['urban', 'freight', 'rail'],
  },
  {
    id: 'historic-cobble',
    name: 'Historic cobbled street',
    category: 'urban',
    origin: 'Old town, granite setts',
    blurb: 'Granite setts, flush kerbs, narrow footways and a central drainage channel.',
    speed: 20,
    lanes: [sw(2.2, { surface: 'stone' }), shared(6, { surface: 'sett' }), sw(2.2, { surface: 'stone' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 22, side: 'both', type: 'heritage' }, bollards: true },
    tags: ['urban', 'heritage'],
  },
  {
    id: 'market-street',
    name: 'Market street',
    category: 'urban',
    origin: 'Street market / festival route',
    blurb: 'Fully paved level surface with planting, market stalls and removable bollards.',
    speed: 10,
    lanes: [sw(3, { surface: 'slab' }), pl(2), shared(7, { surface: 'stone' }), pl(2), sw(3, { surface: 'slab' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 20, side: 'both', type: 'heritage' }, trees: { spacing: 12 }, bollards: true, benches: true, market: true },
    tags: ['urban', 'shared'],
  },
  {
    id: 'school-street',
    name: 'School street',
    category: 'urban',
    origin: 'School zone / 20 mph zone',
    blurb: 'Filtered street with a zebra crossing, 20 km/h roundels, tightened corners and bollards.',
    speed: 20,
    lanes: [sw(2.6), pl(1.4), dv(3, -1), dv(3, 1), pl(1.4), sw(2.6)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 24, side: 'both' }, trees: { spacing: 14 }, crossings: true, bumps: 0.6, bollards: true, school: true },
    tags: ['urban', 'calm'],
  },

  /* ------------------------------------------------------------------ */
  /* Residential & shared space                                          */
  /* ------------------------------------------------------------------ */
  {
    id: 'residential-street',
    name: 'Residential street',
    category: 'residential',
    origin: 'Suburban residential',
    blurb: 'Two narrow lanes with footways and grass verges; the workhorse of any suburb.',
    speed: 30,
    lanes: [sw(1.8), vg(1), dv(2.75, -1), dv(2.75, 1), vg(1), sw(1.8)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 26, side: 'alternate' }, trees: { spacing: 16 }, parking: true, crossings: false },
    tags: ['residential'],
  },
  {
    id: 'residential-narrow',
    name: 'Narrow residential lane',
    category: 'residential',
    origin: 'Terraced streets, older suburbs',
    blurb: 'Single carriageway just wide enough for two cars, footway on one side only.',
    speed: 20,
    lanes: [sw(1.6), dv(2.7, -1), dv(2.7, 1), vg(1.2)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 24, side: 'left' }, parking: true, bumps: 0.35 },
    tags: ['residential'],
  },
  {
    id: 'mews',
    name: 'Mews / service alley',
    category: 'residential',
    origin: 'Rear access mews',
    blurb: 'Brick-paved shared surface at footway level: no kerbs, drainage channel down the middle.',
    speed: 10,
    lanes: [sw(1.2, { surface: 'brick', variant: 'flush' }), shared(4.2, { surface: 'brick' }), sw(1.2, { surface: 'brick', variant: 'flush' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 18, side: 'alternate', type: 'wall' } },
    tags: ['residential', 'shared'],
  },
  {
    id: 'woonerf',
    name: 'Woonerf (home zone)',
    category: 'residential',
    origin: 'Dutch woonerf / shared space',
    blurb: 'Continuous paving, no kerbs, planting and bollards instead of lane markings.',
    speed: 15,
    lanes: [sw(2, { surface: 'brick', variant: 'flush' }), pl(1.6), shared(5, { surface: 'brick' }), pl(1.6), sw(2, { surface: 'brick', variant: 'flush' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 22, side: 'alternate' }, trees: { spacing: 9 }, bollards: true, benches: true, bumps: 0.4 },
    tags: ['residential', 'shared'],
  },
  {
    id: 'cycle-street',
    name: 'Cycle street (fietsstraat)',
    category: 'residential',
    origin: 'Dutch cycle street',
    blurb: 'Cars are guests: brick surface, no centre line, red-tinted cycle strips down the middle.',
    speed: 30,
    lanes: [sw(2, { surface: 'brick' }), shared(4.6, { surface: 'brick', variant: 'cycle-street' }), sw(2, { surface: 'brick' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 24, side: 'alternate' }, bollards: true, trees: { spacing: 14 } },
    tags: ['residential', 'cycle', 'shared'],
  },
  {
    id: 'cul-de-sac',
    name: 'Cul-de-sac',
    category: 'residential',
    origin: 'Dead-end residential street',
    blurb: 'Local access street with parking bays, a turning head and no through markings.',
    speed: 15,
    lanes: [sw(1.6), park(2.2, -1), dv(2.8, -1), dv(2.8, 1), park(2.2, 1), sw(1.6)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 28, side: 'alternate' }, parking: true, trees: { spacing: 15 } },
    tags: ['residential'],
  },
  {
    id: 'suburban-collector',
    name: 'Suburban collector',
    category: 'residential',
    origin: 'Distributor road',
    blurb: 'Wider local distributor with cycle lanes, verge planting and informal parking.',
    speed: 40,
    lanes: [sw(2.2), vg(1.2), cyc(1.6, -1), dv(3.1, -1), dv(3.1, 1), cyc(1.6, 1), vg(1.2), sw(2.2)],
    centerLine: 'double-yellow',
    edgeLine: 'none',
    hints: { lighting: { spacing: 30, side: 'alternate' }, trees: { spacing: 13 }, parking: true, crossings: true, bumps: 0.2 },
    tags: ['residential'],
  },

  /* ------------------------------------------------------------------ */
  /* Rural & unpaved                                                     */
  /* ------------------------------------------------------------------ */
  {
    id: 'rural-highway',
    name: 'Rural two-lane highway',
    category: 'rural',
    origin: 'Inter-urban highway',
    blurb: '3.5 m lanes with sealed shoulders, grass verges and a double centre line.',
    speed: 90,
    lanes: [vg(2.5), sh(1.5, -1, { surface: 'asphaltWorn' }), dv(3.5, -1), dv(3.5, 1), sh(1.5, 1, { surface: 'asphaltWorn' }), vg(2.5)],
    centerLine: 'double-yellow',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 0 }, barrier: 'outside', rumble: true },
    tags: ['rural'],
  },
  {
    id: 'rural-highway-wide',
    name: 'Wide rural highway',
    category: 'rural',
    origin: 'Primary route with wide shoulders',
    blurb: 'Generous 2.5 m shoulders shared with cyclists; rumble strips on the centre line.',
    speed: 100,
    lanes: [vg(3), sh(2.5, -1, { surface: 'asphaltWorn', variant: 'cycle' }), dv(3.65, -1), dv(3.65, 1), sh(2.5, 1, { surface: 'asphaltWorn', variant: 'cycle' }), vg(3)],
    centerLine: 'double-yellow',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 0 }, rumble: true },
    tags: ['rural'],
  },
  {
    id: 'country-lane',
    name: 'Country lane (single track)',
    category: 'rural',
    origin: 'British single-track lane',
    blurb: 'One vehicle width with hedged verges and passing places every so often.',
    speed: 40,
    lanes: [vg(1.5, { surface: 'grass' }), dv(3.1, -1), dv(3.1, 1), vg(1.5, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 }, passingPlaces: true, hedge: true },
    tags: ['rural', 'narrow'],
  },
  {
    id: 'rural-gravel',
    name: 'Gravel road',
    category: 'rural',
    origin: 'Unsealed rural road',
    blurb: 'Compacted gravel with shallow crown, graded shoulders and a drainage ditch.',
    speed: 60,
    lanes: [vg(2, { surface: 'grass' }), dv(2.8, -1, { surface: 'gravel' }), dv(2.8, 1, { surface: 'gravel' }), vg(2, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 } },
    tags: ['rural', 'unpaved'],
  },
  {
    id: 'dirt-track',
    name: 'Dirt track',
    category: 'rural',
    origin: 'Farm / outback track',
    blurb: 'Two ruts of compacted earth with grass growing up the middle.',
    speed: 30,
    lanes: [vg(2, { surface: 'grass' }), shared(4, { surface: 'dirt' }), vg(2, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 } },
    tags: ['rural', 'unpaved'],
  },
  {
    id: 'desert-road',
    name: 'Desert road',
    category: 'rural',
    origin: 'Arid highway',
    blurb: 'Bleached asphalt fading into sand verges with drifting sand at the edges.',
    speed: 90,
    lanes: [vg(3, { surface: 'sand' }), dv(3.6, -1), dv(3.6, 1), vg(3, { surface: 'sand' })],
    centerLine: 'single-white',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 }, drift: true },
    tags: ['rural', 'arid'],
  },
  {
    id: 'forest-road',
    name: 'Forest road',
    category: 'rural',
    origin: 'Forestry access road',
    blurb: 'Narrow gravel road cut through woodland with a logging-turnout feel.',
    speed: 40,
    lanes: [vg(2.5, { surface: 'grass' }), shared(4.2, { surface: 'gravel' }), vg(2.5, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 }, trees: { spacing: 12, dense: true } },
    tags: ['rural', 'unpaved'],
  },
  {
    id: 'mountain-pass',
    name: 'Mountain pass road',
    category: 'rural',
    origin: 'Alpine pass',
    blurb: 'Tight lanes cut into a slope with a retaining wall on one side and a drop on the other.',
    speed: 50,
    lanes: [makeLane('median', 1.2, { variant: 'wall', surface: 'wall', h: 1.1 }), dv(3.2, -1), dv(3.2, 1), sh(1, 1), makeLane('verge', 2.5, { surface: 'grass' })],
    centerLine: 'single-white',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 0 }, barrier: 'outside' },
    tags: ['rural', 'alpine'],
  },

  /* ------------------------------------------------------------------ */
  /* Walking & cycling                                                   */
  /* ------------------------------------------------------------------ */
  {
    id: 'footway',
    name: 'Footway',
    category: 'active',
    origin: 'Standard footpath',
    blurb: '2 m paved footway with soft verges, gently crowned for drainage.',
    speed: 5,
    lanes: [vg(1), path(2, { surface: 'slab' }), vg(1)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 30, side: 'right' } },
    tags: ['path'],
  },
  {
    id: 'promenade',
    name: 'Pedestrian promenade',
    category: 'active',
    origin: 'Seaside / riverside promenade',
    blurb: 'Wide paved promenade with planting, benches and lighting on both sides.',
    speed: 5,
    lanes: [pl(2.5), path(6, { surface: 'stone' }), pl(2.5)],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 18, side: 'both', type: 'heritage' }, trees: { spacing: 10 }, benches: true, bollards: true },
    tags: ['path', 'pedestrian'],
  },
  {
    id: 'shared-use-path',
    name: 'Shared-use path',
    category: 'active',
    origin: 'Pedestrian + cycle',
    blurb: '3 m asphalt path with a painted centre line separating walkers from riders.',
    speed: 20,
    lanes: [vg(1.2), path(3, { surface: 'asphalt' }), vg(1.2)],
    centerLine: 'single-white',
    edgeLine: 'none',
    hints: { lighting: { spacing: 28, side: 'alternate' } },
    tags: ['path', 'cycle'],
  },
  {
    id: 'cycle-track-two-way',
    name: 'Two-way cycle track',
    category: 'active',
    origin: 'Dutch / Danish separated track',
    blurb: '3 m two-way cycle track with tinted surface, centre line and soft verges.',
    speed: 25,
    lanes: [vg(1.5), cyc(1.5, -1), cyc(1.5, 1), vg(1.5)],
    centerLine: 'single-white',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 26, side: 'alternate' } },
    tags: ['path', 'cycle'],
  },
  {
    id: 'cycle-superhighway',
    name: 'Cycle superhighway',
    category: 'active',
    origin: 'Copenhagen / London Cycleway',
    blurb: '4 m of smooth red-tinted asphalt with edge lines and a dashed centre line.',
    speed: 30,
    lanes: [vg(2), cyc(2, -1, { variant: 'tinted' }), cyc(2, 1, { variant: 'tinted' }), vg(2)],
    centerLine: 'dashed-white',
    edgeLine: 'solid',
    hints: { lighting: { spacing: 24, side: 'both' } },
    tags: ['path', 'cycle'],
  },
  {
    id: 'boardwalk',
    name: 'Boardwalk',
    category: 'active',
    origin: 'Wetland / dune boardwalk',
    blurb: 'Timber decking on bearers, with a handrail on the open side.',
    speed: 5,
    lanes: [vg(2, { surface: 'grass' }), path(2.5, { surface: 'timber', variant: 'deck' }), vg(2, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 24, side: 'right' }, handrail: true },
    tags: ['path', 'timber'],
  },
  {
    id: 'park-trail',
    name: 'Park trail',
    category: 'active',
    origin: 'Municipal park path',
    blurb: 'Compacted earth trail wandering through grass and planting.',
    speed: 10,
    lanes: [vg(2, { surface: 'grass' }), path(2.2, { surface: 'dirt' }), vg(2, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 34, side: 'alternate' }, trees: { spacing: 14, dense: true }, benches: true },
    tags: ['path', 'park'],
  },
  {
    id: 'pedestrian-underpass',
    name: 'Pedestrian underpass',
    category: 'active',
    origin: 'Subway beneath a road',
    blurb: 'Ramped paved passage dropping below the carriageway, lined with tiled walls.',
    speed: 5,
    lanes: [makeLane('median', 0.6, { variant: 'wall', surface: 'tile', h: 3 }), path(3.5, { surface: 'slab' }), makeLane('median', 0.6, { variant: 'wall', surface: 'tile', h: 3 })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 10, side: 'both', type: 'tunnel' }, tunnel: true },
    tags: ['path', 'structure'],
  },

  /* ------------------------------------------------------------------ */
  /* Rail & transit                                                      */
  /* ------------------------------------------------------------------ */
  {
    id: 'rail-double',
    name: 'Double-track railway',
    category: 'transit',
    origin: 'Heavy rail / mainline',
    blurb: 'Ballasted formation carrying two standard-gauge tracks with cessed shoulders.',
    speed: 160,
    lanes: [vg(3.5, { surface: 'grass' }), rail(9.4, { tracks: 2, electrified: true }), vg(3.5, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 }, rail: true },
    tags: ['rail'],
  },
  {
    id: 'rail-single',
    name: 'Single-track railway',
    category: 'transit',
    origin: 'Branch line',
    blurb: 'One track on a narrower ballast bed with grass shoulders.',
    speed: 100,
    lanes: [vg(3, { surface: 'grass' }), rail(6.2, { tracks: 1 }), vg(3, { surface: 'grass' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 0 }, rail: true },
    tags: ['rail'],
  },
  {
    id: 'tram-segregated',
    name: 'Segregated tramway',
    category: 'transit',
    origin: 'Light rail on its own alignment',
    blurb: 'Grassed track bed flanked by maintenance paths and pedestrian routes.',
    speed: 60,
    lanes: [path(1.8, { surface: 'asphalt' }), vg(1.2), rail(7.2, { tracks: 2, electrified: true, grooved: true }), vg(1.2), path(1.8, { surface: 'asphalt' })],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 40, side: 'left' }, rail: true, tram: true },
    tags: ['rail', 'tram'],
  },
  {
    id: 'rail-platform',
    name: 'Railway with platforms',
    category: 'transit',
    origin: 'Commuter station approach',
    blurb: 'Two tracks with 3 m platforms either side, tactile edges and canopies.',
    speed: 80,
    lanes: [
      makeLane('sidewalk', 3.2, { variant: 'platform', h: 0.76, surface: 'slab' }),
      rail(9.4, { tracks: 2, electrified: true }),
      makeLane('sidewalk', 3.2, { variant: 'platform', h: 0.76, surface: 'slab' }),
    ],
    centerLine: 'none',
    edgeLine: 'none',
    hints: { lighting: { spacing: 14, side: 'both' }, rail: true, station: true },
    tags: ['rail', 'station'],
  },

  /* ------------------------------------------------------------------ */
  /* Bridges, tunnels & specials                                         */
  /* ------------------------------------------------------------------ */
  {
    id: 'bridge-deck-urban',
    name: 'Bridge deck — urban',
    category: 'structure',
    origin: 'River crossing',
    blurb: 'Two lanes each way on a deck with parapets, cycle lanes and a footway each side.',
    speed: 50,
    lanes: [sw(2.4), cyc(1.8, -1), dv(3.2, -1), dv(3.2, -1), med(1.2, { variant: 'hatched' }), dv(3.2, 1), dv(3.2, 1), cyc(1.8, 1), sw(2.4)],
    centerLine: 'double-yellow',
    edgeLine: 'solid',
    structure: 'bridge',
    parapet: 'concrete',
    hints: { lighting: { spacing: 26, side: 'both', type: 'heritage' } },
    tags: ['bridge'],
  },
  {
    id: 'viaduct-deck',
    name: 'Viaduct deck',
    category: 'structure',
    origin: 'Elevated urban expressway',
    blurb: 'Elevated deck carrying three lanes with solid parapets and expansion joints.',
    speed: 80,
    lanes: [makeLane('median', 0.9, { variant: 'parapet', surface: 'wall', h: 1.1 }), dv(3.5, -1), dv(3.5, -1), dv(3.5, -1), med(1.6, { variant: 'hatched' }), dv(3.5, 1), dv(3.5, 1), dv(3.5, 1), makeLane('median', 0.9, { variant: 'parapet', surface: 'wall', h: 1.1 })],
    centerLine: 'none',
    edgeLine: 'solid',
    structure: 'bridge',
    parapet: 'concrete',
    hints: { lighting: { spacing: 40, side: 'both' }, noise: true },
    tags: ['bridge', 'elevated'],
  },
  {
    id: 'footbridge',
    name: 'Footbridge',
    category: 'structure',
    origin: 'Pedestrian / cycle bridge',
    blurb: 'Light deck with open steel balustrades, suitable for walking and cycling.',
    speed: 10,
    lanes: [makeLane('median', 0.4, { variant: 'parapet', surface: 'metal', h: 1.1 }), path(4, { surface: 'timber' }), makeLane('median', 0.4, { variant: 'parapet', surface: 'metal', h: 1.1 })],
    centerLine: 'none',
    edgeLine: 'none',
    structure: 'bridge',
    parapet: 'steel',
    hints: { lighting: { spacing: 16, side: 'both' } },
    tags: ['bridge', 'path'],
  },
  {
    id: 'tunnel-bore',
    name: 'Road tunnel bore',
    category: 'structure',
    origin: 'Bored road tunnel',
    blurb: 'Two lanes inside a lined bore with tiled side walls, lighting bands and escape walkways.',
    speed: 70,
    lanes: [
      makeLane('median', 1.1, { variant: 'wall', surface: 'tile', h: 6.4 }),
      dv(3.5, -1), dv(3.5, -1), med(0.6, { variant: 'hatched' }), dv(3.5, 1), dv(3.5, 1),
      makeLane('median', 1.1, { variant: 'wall', surface: 'tile', h: 6.4 }),
    ],
    centerLine: 'none',
    edgeLine: 'solid',
    structure: 'tunnel',
    hints: { lighting: { spacing: 8, side: 'both', type: 'tunnel' } },
    tags: ['tunnel'],
  },
  {
    id: 'cut-and-cover',
    name: 'Cut-and-cover underpass',
    category: 'structure',
    origin: 'Depressed urban road',
    blurb: 'Sunken road section retained by concrete walls, with ramps at each end.',
    speed: 60,
    lanes: [
      makeLane('median', 1.4, { variant: 'wall', surface: 'wall', h: 5.2 }),
      dv(3.4, -1), dv(3.4, -1), med(1.2, { variant: 'hatched' }), dv(3.4, 1), dv(3.4, 1),
      makeLane('median', 1.4, { variant: 'wall', surface: 'wall', h: 5.2 }),
    ],
    centerLine: 'none',
    edgeLine: 'solid',
    structure: 'tunnel',
    hints: { lighting: { spacing: 12, side: 'both', type: 'tunnel' } },
    tags: ['tunnel'],
  },
];

const byId = new Map(PROFILES.map((p) => [p.id, p]));

export function getProfile(id) {
  return byId.get(id) || PROFILES[0];
}

export function profileExists(id) {
  return byId.has(id);
}

/** Deep copy so the inspector can edit a road's own lane layout. */
export function cloneLanes(lanes) {
  return lanes.map((lane) => ({ ...lane }));
}

/** Mirror a layout for left-hand traffic: reverse the order and flip directions. */
export function mirrorLanes(lanes) {
  return lanes
    .slice()
    .reverse()
    .map((lane) => ({ ...lane, dir: -(lane.dir || 0) }));
}

/** Total width of a lane list. */
export function laneWidth(lanes) {
  return lanes.reduce((sum, lane) => sum + (lane.width || 0), 0);
}

/** Width of the drivable carriageway (everything between the kerbs, excluding footways). */
export function carriagewayWidth(lanes) {
  return lanes.reduce((sum, lane) => {
    const kind = LANE_KINDS[lane.kind];
    if (!kind || !kind.drivable) return sum;
    return sum + (lane.width || 0);
  }, 0);
}

export function profilesByCategory() {
  const map = new Map();
  for (const category of CATEGORIES) map.set(category.id, []);
  for (const profile of PROFILES) {
    if (!map.has(profile.category)) map.set(profile.category, []);
    map.get(profile.category).push(profile);
  }
  return map;
}

/** Centre-line styles offered by the marking painter. */
export const CENTER_LINES = [
  { id: 'none', label: 'No centre line' },
  { id: 'single-white', label: 'Single white' },
  { id: 'double-yellow', label: 'Double yellow' },
  { id: 'double-white', label: 'Double white' },
  { id: 'dashed-white', label: 'Dashed white' },
  { id: 'hatched', label: 'Hatched buffer' },
];

export const EDGE_LINES = [
  { id: 'none', label: 'None' },
  { id: 'solid', label: 'Solid edge line' },
  { id: 'dashed', label: 'Dashed edge line' },
];

export const SURFACE_CHOICES = [
  { id: 'asphalt', label: 'Asphalt' },
  { id: 'asphaltWorn', label: 'Worn asphalt' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'slab', label: 'Paving slabs' },
  { id: 'brick', label: 'Brick paving' },
  { id: 'sett', label: 'Granite setts' },
  { id: 'stone', label: 'Flagstones' },
  { id: 'grass', label: 'Grass' },
  { id: 'gravel', label: 'Gravel' },
  { id: 'dirt', label: 'Compacted earth' },
  { id: 'sand', label: 'Sand' },
  { id: 'timber', label: 'Timber' },
  { id: 'ballast', label: 'Ballast' },
  { id: 'tile', label: 'Glazed tile' },
  { id: 'metal', label: 'Steel' },
  { id: 'wall', label: 'Board-marked concrete' },
  { id: 'kerb', label: 'Kerb stone' },
];
