// Railway cross-section library. Three families share one graph topology (nodes/edges like roads):
//   heavy — conventional ballast railway (sleepers, twin rails, catenary), at grade.
//   mono  — suspended monorail (Schwebebahn style): an elevated guideway beam on pylons with the
//           cabins hanging below it on hanger bogies that run under the beam.
// Street trams are not a graph family: they run in `tram` lanes inside road profiles (see profiles.js),
// with grooved rails embedded flush in the carriageway; TrainSystem routes them over the road graph.
import { TRACK_SPACING } from './geom/rail.js';

export const RAIL_GAUGE = 1.435;
export const MONO_SPACING = 3.8;        // guideway centres on a double monorail beam pair
export const MONO_BEAM_W = 1.0;         // guideway beam width
export const MONO_BEAM_D = 1.5;         // guideway beam depth (top = edge level, cabins hang below)
export const MONO_DEFAULT_Y = 6.5;      // beam-top level for new elevated guideways (5 m clearance)
export const RAIL_TOP = 0.42;           // heavy-rail head height above the formation frame

export const RAIL_PROFILES = {
  heavy2: {
    id: 'heavy2', name: 'Heavy rail · double track', family: 'heavy', tracks: 2,
    speed: 33, electrified: true,
    desc: 'Double-track electrified main line: ballast, concrete sleepers, catenary, level crossings.',
  },
  heavy1: {
    id: 'heavy1', name: 'Heavy rail · single track', family: 'heavy', tracks: 1,
    speed: 25, electrified: true,
    desc: 'Single-track branch line with passing loops at switches.',
  },
  mono2: {
    id: 'mono2', name: 'Suspended monorail · double', family: 'mono', tracks: 2,
    speed: 16, electrified: true, elevatedDefault: MONO_DEFAULT_Y,
    desc: 'Twin elevated guideway beams on T-pylons; cabins suspended below the beam.',
  },
  mono1: {
    id: 'mono1', name: 'Suspended monorail · single', family: 'mono', tracks: 1,
    speed: 14, electrified: true, elevatedDefault: MONO_DEFAULT_Y,
    desc: 'Single elevated guideway beam, cabins suspended below.',
  },
};

export function getRailProfile(edge) {
  return RAIL_PROFILES[edge.profile] || RAIL_PROFILES.heavy2;
}

// Lateral layout: per-track centre offsets + formation half width (for junctions/picking/clearance).
const cache = new WeakMap();
export function railLayout(profile) {
  if (cache.has(profile)) return cache.get(profile);
  const n = profile.tracks || 2;
  const dx = profile.family === 'mono' ? MONO_SPACING : TRACK_SPACING;
  const offs = n === 1 ? [0] : Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * dx);
  const half = profile.family === 'mono'
    ? (n - 1) * dx / 2 + MONO_BEAM_W / 2 + 0.9
    : (n - 1) * dx / 2 + 1.6;
  const res = { tracks: n, offs, dx, half, formation: half * 2, family: profile.family };
  cache.set(profile, res);
  return res;
}

export const RAIL_FAMILY_COLOR = { heavy: '#c084fc', mono: '#4fd8e0' };
