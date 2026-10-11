// Road furniture and surface details.
//
// Details live on a road at a station distance and can raise geometry (speed bumps,
// kerb build-outs, crossing decks), paint markings (bus cages, rumble strips) and
// drop instanced props (shelters, bollards, signals, trees).

import * as THREE from 'three';
import { getSurfaceMaterial } from './materials.js';
import {
  DECAL,
  WHITE,
  YELLOW,
  addTransverseBand,
  addWorldGlyph,
  frameAt,
  pointAt,
} from './markings.js';
import { getGlyphMaterial, getLineMaterial, getMarkingMaterial, getZebraMaterial, getGiveWayMaterial, getHatchMaterial, getTactileMaterial } from './materials.js';
import { clamp } from './util.js';

/* ------------------------------------------------------------------ */
/* catalogue                                                           */
/* ------------------------------------------------------------------ */

export const DETAIL_GROUPS = [
  { id: 'calming', label: 'Traffic calming' },
  { id: 'crossing', label: 'Crossings' },
  { id: 'transit', label: 'Bus, tram & taxi' },
  { id: 'furniture', label: 'Street furniture' },
  { id: 'signals', label: 'Signals & signs' },
  { id: 'surface', label: 'Surface details' },
];

export const DETAIL_TYPES = [
  {
    id: 'speed-bump',
    label: 'Speed bump',
    group: 'calming',
    blurb: 'Raised hump across the carriageway.',
    defaults: { kind: 'flat-top', height: 0.1, length: 3.6, ramp: 1.2 },
    fields: [
      { key: 'kind', label: 'Profile', type: 'select', options: ['flat-top', 'round', 'cushion', 'sinusoidal'] },
      { key: 'height', label: 'Height', type: 'number', min: 0.04, max: 0.22, step: 0.01, unit: 'm' },
      { key: 'length', label: 'Length', type: 'number', min: 1, max: 12, step: 0.2, unit: 'm' },
      { key: 'ramp', label: 'Ramp', type: 'number', min: 0.3, max: 4, step: 0.1, unit: 'm' },
    ],
  },
  {
    id: 'speed-table',
    label: 'Raised table',
    group: 'calming',
    blurb: 'Flat-topped raised plateau, usually a continuous footway across a side road.',
    defaults: { height: 0.1, length: 7, ramp: 1.6, surface: 'slab' },
    fields: [
      { key: 'height', label: 'Height', type: 'number', min: 0.05, max: 0.16, step: 0.005, unit: 'm' },
      { key: 'length', label: 'Length', type: 'number', min: 3, max: 16, step: 0.5, unit: 'm' },
      { key: 'ramp', label: 'Ramp', type: 'number', min: 0.5, max: 4, step: 0.1, unit: 'm' },
      { key: 'surface', label: 'Surface', type: 'surface' },
    ],
  },
  {
    id: 'rumble-strip',
    label: 'Rumble strip',
    group: 'calming',
    blurb: 'Transverse bars that whine when crossed.',
    defaults: { bars: 8, depth: 6, colour: 'white' },
    fields: [
      { key: 'bars', label: 'Bars', type: 'number', min: 3, max: 24, step: 1 },
      { key: 'depth', label: 'Depth', type: 'number', min: 2, max: 20, step: 0.5, unit: 'm' },
      { key: 'colour', label: 'Colour', type: 'select', options: ['white', 'yellow', 'red'] },
    ],
  },
  {
    id: 'pedestrian-crossing',
    label: 'Pedestrian crossing',
    group: 'crossing',
    blurb: 'Zebra, ladder or signalised crossing with tactile paving.',
    defaults: { kind: 'zebra', width: 4, beacons: true, tactile: true },
    fields: [
      { key: 'kind', label: 'Type', type: 'select', options: ['zebra', 'ladder', 'signal', 'courtesy'] },
      { key: 'width', label: 'Width', type: 'number', min: 2, max: 8, step: 0.2, unit: 'm' },
      { key: 'beacons', label: 'Beacons / signals', type: 'toggle' },
      { key: 'tactile', label: 'Tactile paving', type: 'toggle' },
    ],
  },
  {
    id: 'refuge-island',
    label: 'Pedestrian refuge',
    group: 'crossing',
    blurb: 'Raised island in the middle of the road with kerbs and a beacon.',
    defaults: { width: 2.2, length: 6 },
    fields: [
      { key: 'width', label: 'Width', type: 'number', min: 1, max: 5, step: 0.1, unit: 'm' },
      { key: 'length', label: 'Length', type: 'number', min: 2, max: 20, step: 0.5, unit: 'm' },
    ],
  },
  {
    id: 'kerb-extension',
    label: 'Kerb build-out',
    group: 'crossing',
    blurb: 'Footway extended into the carriageway to tighten the crossing.',
    defaults: { side: 'both', depth: 2, length: 7 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'depth', label: 'Depth', type: 'number', min: 0.5, max: 4, step: 0.1, unit: 'm' },
      { key: 'length', label: 'Length', type: 'number', min: 2, max: 20, step: 0.5, unit: 'm' },
    ],
  },
  {
    id: 'railway-crossing',
    label: 'Level crossing',
    group: 'crossing',
    blurb: 'Railway crossing with deck panels, crossbucks and half barriers.',
    defaults: { width: 8, gates: true, surface: 'concrete', tracks: 1 },
    fields: [
      { key: 'width', label: 'Crossing width', type: 'number', min: 4, max: 30, step: 0.5, unit: 'm' },
      { key: 'tracks', label: 'Tracks', type: 'number', min: 1, max: 3, step: 1 },
      { key: 'gates', label: 'Half barriers', type: 'toggle' },
      { key: 'surface', label: 'Deck', type: 'surface' },
    ],
  },
  {
    id: 'bus-stop',
    label: 'Bus stop',
    group: 'transit',
    blurb: 'Shelter, flag, cage markings, boarding kerb and tactile strip.',
    defaults: { shelter: true, boarder: true, side: 'right', length: 14 },
    fields: [
      { key: 'shelter', label: 'Shelter', type: 'toggle' },
      { key: 'boarder', label: 'Boarding kerb', type: 'toggle' },
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right'] },
      { key: 'length', label: 'Cage length', type: 'number', min: 6, max: 26, step: 0.5, unit: 'm' },
    ],
  },
  {
    id: 'taxi-rank',
    label: 'Taxi rank',
    group: 'transit',
    blurb: 'Marked rank with a illuminated sign and waiting bays.',
    defaults: { bays: 3, side: 'right' },
    fields: [
      { key: 'bays', label: 'Bays', type: 'number', min: 1, max: 10, step: 1 },
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right'] },
    ],
  },
  {
    id: 'tram-stop',
    label: 'Tram stop',
    group: 'transit',
    blurb: 'Raised platform beside the tracks with a shelter and tactile edge.',
    defaults: { side: 'right', length: 22, height: 0.28 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right'] },
      { key: 'length', label: 'Length', type: 'number', min: 10, max: 45, step: 1, unit: 'm' },
      { key: 'height', label: 'Platform height', type: 'number', min: 0.15, max: 0.4, step: 0.01, unit: 'm' },
    ],
  },
  {
    id: 'bollards',
    label: 'Bollards',
    group: 'furniture',
    blurb: 'A row of bollards protecting the footway.',
    defaults: { count: 5, spacing: 1.6, side: 'left', type: 'bollard' },
    fields: [
      { key: 'count', label: 'Count', type: 'number', min: 2, max: 24, step: 1 },
      { key: 'spacing', label: 'Spacing', type: 'number', min: 0.8, max: 4, step: 0.1, unit: 'm' },
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'type', label: 'Style', type: 'select', options: ['bollard', 'bollardRemovable', 'chainPost'] },
    ],
  },
  {
    id: 'guardrail',
    label: 'Safety barrier',
    group: 'furniture',
    blurb: 'Steel beam guardrail along the verge.',
    defaults: { side: 'left', length: 30, height: 0.75 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'length', label: 'Length', type: 'number', min: 4, max: 200, step: 1, unit: 'm' },
      { key: 'height', label: 'Height', type: 'number', min: 0.5, max: 1.2, step: 0.05, unit: 'm' },
    ],
  },
  {
    id: 'tree-pit',
    label: 'Street tree',
    group: 'furniture',
    blurb: 'Tree in a pit with a grille.',
    defaults: { side: 'left', spacing: 12, count: 1 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'spacing', label: 'Spacing', type: 'number', min: 5, max: 30, step: 0.5, unit: 'm' },
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 20, step: 1 },
    ],
  },
  {
    id: 'bench',
    label: 'Bench',
    group: 'furniture',
    blurb: 'Seat facing the carriageway.',
    defaults: { side: 'left' },
    fields: [{ key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] }],
  },
  {
    id: 'litter-bin',
    label: 'Litter bin',
    group: 'furniture',
    blurb: 'Street bin at the kerb.',
    defaults: { side: 'left' },
    fields: [{ key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] }],
  },
  {
    id: 'cycle-stand',
    label: 'Cycle stands',
    group: 'furniture',
    blurb: 'Sheffield stands for parking bikes.',
    defaults: { count: 4, side: 'right' },
    fields: [
      { key: 'count', label: 'Stands', type: 'number', min: 1, max: 20, step: 1 },
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
    ],
  },
  {
    id: 'planter',
    label: 'Planter',
    group: 'furniture',
    blurb: 'Timber or stone planter blocking a movement.',
    defaults: { side: 'left', count: 1 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 12, step: 1 },
    ],
  },
  {
    id: 'street-light',
    label: 'Street light',
    group: 'furniture',
    blurb: 'Lighting column at the kerb.',
    defaults: { side: 'right', type: 'lamp' },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'type', label: 'Column', type: 'select', options: ['lamp', 'lampHeritage', 'floodMast'] },
    ],
  },
  {
    id: 'traffic-signal',
    label: 'Traffic signal',
    group: 'signals',
    blurb: 'Signal head on a pole with a pedestrian push-button.',
    defaults: { side: 'right', pedestrian: true },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'pedestrian', label: 'Pedestrian head', type: 'toggle' },
    ],
  },
  {
    id: 'sign',
    label: 'Sign',
    group: 'signals',
    blurb: 'Post-mounted sign.',
    defaults: { side: 'right', variant: 'stop' },
    fields: [
      { key: 'variant', label: 'Sign', type: 'select', options: ['stop', 'give-way', 'speed-30', 'speed-50', 'warning', 'dead-end', 'roundabout'] },
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
    ],
  },
  {
    id: 'catenary-mast',
    label: 'Catenary mast',
    group: 'signals',
    blurb: 'Overhead line support for electrified track.',
    defaults: { side: 'left' },
    fields: [{ key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] }],
  },
  {
    id: 'marker-post',
    label: 'Marker posts',
    group: 'signals',
    blurb: 'Verge marker posts, spaced along the road.',
    defaults: { side: 'both', spacing: 20, count: 10 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] },
      { key: 'spacing', label: 'Spacing', type: 'number', min: 5, max: 60, step: 1, unit: 'm' },
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 60, step: 1 },
    ],
  },
  {
    id: 'gully',
    label: 'Gully / drain',
    group: 'surface',
    blurb: 'Road gully and cover at the kerb line.',
    defaults: { side: 'both' },
    fields: [{ key: 'side', label: 'Side', type: 'select', options: ['left', 'right', 'both'] }],
  },
  {
    id: 'manhole',
    label: 'Manhole cover',
    group: 'surface',
    blurb: 'Iron cover flush with the carriageway.',
    defaults: { offset: 0 },
    fields: [{ key: 'offset', label: 'Lateral offset', type: 'number', min: -12, max: 12, step: 0.25, unit: 'm' }],
  },
  {
    id: 'loading-bay',
    label: 'Loading bay',
    group: 'surface',
    blurb: 'Yellow-hatched loading bay at the kerb.',
    defaults: { side: 'right', length: 12 },
    fields: [
      { key: 'side', label: 'Side', type: 'select', options: ['left', 'right'] },
      { key: 'length', label: 'Length', type: 'number', min: 4, max: 30, step: 0.5, unit: 'm' },
    ],
  },
  {
    id: 'subway-entrance',
    label: 'Subway entrance',
    group: 'transit',
    blurb: 'Canopy and stair down to an underground station.',
    defaults: { side: 'right' },
    fields: [{ key: 'side', label: 'Side', type: 'select', options: ['left', 'right'] }],
  },
];

export const DETAIL_TYPE_MAP = new Map(DETAIL_TYPES.map((d) => [d.id, d]));

export function makeDetail(typeId, s, params = {}) {
  const def = DETAIL_TYPE_MAP.get(typeId);
  return { type: typeId, s, ...(def?.defaults || {}), ...params };
}

/* ------------------------------------------------------------------ */
/* placement helpers                                                   */
/* ------------------------------------------------------------------ */

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function placeProp(ctx, type, x, y, z, rotationY = 0, scale = 1, color = null) {
  _p.set(x, y, z);
  _q.setFromAxisAngle(UP, rotationY);
  _s.set(scale, scale, scale);
  _m.compose(_p, _q, _s);
  ctx.props.add(type, _m, color);
}

function surfaceBuilder(ctx, key, x, z) {
  return ctx.sink.at(x, z, key);
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[2] - b[0] * a[2];
  }
  return sum;
}

/**
 * Vertical prism with a convex top ring.  The ring's winding is corrected
 * automatically so side faces always point outwards.
 */
function addPrism(builder, ring, y0, y1, owner, uvScale = 0.5) {
  const ordered = signedArea(ring) >= 0 ? ring : ring.slice().reverse();
  ring = ordered;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const a = ring[i];
    const b = ring[j];
    builder.quad(
      [a[0], y1, a[2]],
      [b[0], y1, b[2]],
      [b[0], y0, b[2]],
      [a[0], y0, a[2]],
      null,
      [[0, (y1 - y0) * uvScale], [1, (y1 - y0) * uvScale], [1, 0], [0, 0]],
      owner,
    );
  }
  for (let i = 1; i < ring.length - 1; i++) {
    builder.tri(
      [ring[0][0], y1, ring[0][2]],
      [ring[i + 1][0], y1, ring[i + 1][2]],
      [ring[i][0], y1, ring[i][2]],
      [[0, 1, 0], [0, 1, 0], [0, 1, 0]],
      [
        [ring[0][0] * uvScale, ring[0][2] * uvScale],
        [ring[i + 1][0] * uvScale, ring[i + 1][2] * uvScale],
        [ring[i][0] * uvScale, ring[i][2] * uvScale],
      ],
      owner,
    );
  }
}

/** Lateral offset helpers. */
function sideOffsets(detail, cross) {
  const left = cross.carriageLeft;
  const right = cross.carriageRight;
  const side = detail.side || 'right';
  if (side === 'left') return [left];
  if (side === 'right') return [right];
  return [left, right];
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

function bumpHeight(profile, detail, distance) {
  const length = detail.length ?? 3.6;
  const ramp = Math.min(detail.ramp ?? 1.2, length / 2);
  const half = length / 2;
  const x = Math.abs(distance);
  const height = detail.height ?? 0.1;
  if (x >= half) return 0;
  switch (detail.kind) {
    case 'round':
      return x >= half - ramp ? height * (1 - (x - (half - ramp)) / ramp) : height;
    case 'sinusoidal':
      return height * 0.5 * (1 + Math.cos((x / half) * Math.PI));
    case 'flat-top':
    default:
      return x >= half - ramp ? height * (1 - (x - (half - ramp)) / ramp) : height;
  }
}

function buildSpeedBump(prepared, detail, ctx) {
  const { cross } = prepared;
  const owner = ctx.ownerOf(prepared.road.id);
  const length = detail.length ?? 3.6;
  const from = detail.s - length / 2;
  const to = detail.s + length / 2;
  const materialKey = detail.kind === 'flat-top' && (detail.length ?? 3.6) > 5 ? (detail.surface || 'asphalt') : 'asphalt';
  const material = getSurfaceMaterial(materialKey);
  const inv = 1 / (material.userData.metersPerTile || 4);

  const cushions = detail.kind === 'cushion'
    ? [[cross.carriageLeft, cross.centerOffset - 0.55], [cross.centerOffset + 0.55, cross.carriageRight]]
    : [[cross.carriageLeft, cross.carriageRight]];

  const stations = prepared.stations.filter((st) => st.s >= from - 0.5 && st.s <= to + 0.5);
  for (const [o0, o1] of cushions) {
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      const ha = bumpHeight(prepared, detail, a.s - detail.s);
      const hb = bumpHeight(prepared, detail, b.s - detail.s);
      const p0 = pointAt(a, o0, ha);
      const p1 = pointAt(a, o1, ha);
      const p2 = pointAt(b, o1, hb);
      const p3 = pointAt(b, o0, hb);
      const builder = ctx.sink.at((p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, materialKey);
      builder.quad(p0, p1, p2, p3, null, [
        [o0 * inv, a.s * inv],
        [o1 * inv, a.s * inv],
        [o1 * inv, b.s * inv],
        [o0 * inv, b.s * inv],
      ], owner);
    }
  }

  // White chevrons on the approach face.
  addTransverseBand(ctx, prepared, {
    s: detail.s - length / 2 + 0.35,
    depth: 0.5,
    fromOffset: cross.carriageLeft + 0.2,
    toOffset: cross.carriageRight - 0.2,
    materialKey: 'bump-mark',
    material: getMarkingMaterial('bump-mark', { color: WHITE }),
    owner,
  });
}

function buildSpeedTable(prepared, detail, ctx) {
  buildSpeedBump(prepared, { ...detail, kind: 'flat-top' }, ctx);
  const cross = prepared.cross;
  // Continuous footway look: zebra stripes across the top.
  addTransverseBand(ctx, prepared, {
    s: detail.s,
    depth: Math.min(2.4, (detail.length ?? 7) * 0.5),
    fromOffset: cross.carriageLeft,
    toOffset: cross.carriageRight,
    materialKey: 'zebra',
    material: getZebraMaterial(Math.max(4, Math.round((cross.carriageRight - cross.carriageLeft) / 0.62)), 'zebra'),
    owner: ctx.ownerOf(prepared.road.id),
    uRepeat: Math.max(4, Math.round((cross.carriageRight - cross.carriageLeft) / 0.62)),
  });
}

function buildRumbleStrip(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const bars = detail.bars ?? 8;
  const depth = detail.depth ?? 6;
  const color = detail.colour === 'yellow' ? YELLOW : detail.colour === 'red' ? 0xa8342c : WHITE;
  const material = getMarkingMaterial(`rumble-${detail.colour || 'white'}`, { color });
  for (let i = 0; i < bars; i++) {
    const s = detail.s - depth / 2 + (i + 0.5) * (depth / bars);
    addTransverseBand(ctx, prepared, {
      s,
      depth: Math.min(0.4, depth / bars * 0.55),
      fromOffset: cross.carriageLeft + 0.1,
      toOffset: cross.carriageRight - 0.1,
      materialKey: `rumble-${detail.colour || 'white'}`,
      material,
      owner,
    });
  }
}

function buildPedestrianCrossing(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const width = detail.width ?? 4;
  const left = cross.carriageLeft;
  const right = cross.carriageRight;
  const stripes = Math.max(4, Math.round((right - left) / 0.62));
  if (detail.kind === 'zebra' || detail.kind === 'ladder') {
    addTransverseBand(ctx, prepared, {
      s: detail.s,
      depth: width,
      fromOffset: left,
      toOffset: right,
      materialKey: `crossing-${detail.kind}-${stripes}`,
      material: getZebraMaterial(stripes, detail.kind),
      owner,
      uRepeat: stripes,
    });
  } else {
    // Signalised / courtesy: two dashed give-way lines only.
    for (const s of [detail.s - width / 2 - 0.6, detail.s + width / 2 + 0.6]) {
      addTransverseBand(ctx, prepared, {
        s,
        depth: 0.45,
        fromOffset: left + 0.2,
        toOffset: right - 0.2,
        materialKey: 'give-way-teeth',
        material: getGiveWayMaterial(Math.max(3, Math.round((right - left) / 0.8))),
        owner,
        uRepeat: Math.max(3, Math.round((right - left) / 0.8)),
      });
    }
  }

  if (detail.tactile) {
    for (const offset of [left - 0.4, right + 0.4]) {
      addTransverseBand(ctx, prepared, {
        s: detail.s,
        depth: width,
        fromOffset: offset,
        toOffset: offset + (offset < 0 ? -0.9 : 0.9),
        materialKey: 'tactile',
        material: getTactileMaterial(),
        owner,
        uRepeat: 1,
      });
    }
  }

  if (detail.beacons) {
    for (const offset of [left - 0.8, right + 0.8]) {
      for (const s of [detail.s - width / 2 - 0.5, detail.s + width / 2 + 0.5]) {
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, offset, 0.02);
        placeProp(ctx, detail.kind === 'signal' ? 'signal' : 'beacon', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
      }
    }
  }
}

function buildRefugeIsland(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const length = detail.length ?? 6;
  const width = detail.width ?? 2.2;
  const center = cross.centerOffset;
  const s0 = detail.s - length / 2;
  const s1 = detail.s + length / 2;
  const ring = [];
  const steps = Math.max(2, Math.round(length / 2));
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    const f = i / steps;
    const taper = Math.sin(clamp(f, 0, 1) * Math.PI);
    const half = (width / 2) * (0.35 + 0.65 * taper);
    const a = pointAt(frameAt(prepared, s), center - half, 0);
    ring.push(a);
  }
  for (let i = steps; i >= 0; i--) {
    const s = s0 + ((s1 - s0) * i) / steps;
    const f = i / steps;
    const taper = Math.sin(clamp(f, 0, 1) * Math.PI);
    const half = (width / 2) * (0.35 + 0.65 * taper);
    ring.push(pointAt(frameAt(prepared, s), center + half, 0));
  }
  const kerb = ctx.sink.at(ring[0][0], ring[0][2], 'kerb');
  const slab = ctx.sink.at(ring[0][0], ring[0][2], 'slab');
  addPrism(kerb, ring, -0.05, 0.16, owner);
  addPrism(slab, ring, 0.15, 0.17, owner);
  const frame = frameAt(prepared, s0 - 0.8);
  const nose = pointAt(frame, center, 0.16);
  placeProp(ctx, 'beacon', nose[0], nose[1], nose[2], Math.atan2(frame.t[0], frame.t[2]));
}

function buildKerbExtension(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const length = detail.length ?? 7;
  const depth = detail.depth ?? 2;
  const sides = detail.side === 'both' ? ['left', 'right'] : [detail.side || 'right'];
  const s0 = detail.s - length / 2;
  const s1 = detail.s + length / 2;
  for (const side of sides) {
    const edge = side === 'left' ? cross.carriageLeft : cross.carriageRight;
    const inward = side === 'left' ? 1 : -1; // build-outs grow into the carriageway
    const samples = Math.max(3, Math.round(length / 1.5));
    const ring = [];
    // New kerb line, bulging into the carriageway.
    for (let i = 0; i <= samples; i++) {
      const s = s0 + ((s1 - s0) * i) / samples;
      const bulge = Math.sin(clamp(i / samples, 0, 1) * Math.PI) * depth;
      ring.push(pointAt(frameAt(prepared, s), edge + inward * bulge, 0));
    }
    // Back edge, tying into the existing footway.
    for (let i = samples; i >= 0; i--) {
      const s = s0 + ((s1 - s0) * i) / samples;
      ring.push(pointAt(frameAt(prepared, s), edge - inward * 1.2, 0));
    }
    const kerb = ctx.sink.at(ring[0][0], ring[0][2], 'kerb');
    const slab = ctx.sink.at(ring[0][0], ring[0][2], 'slab');
    addPrism(kerb, ring, -0.05, 0.16, owner);
    addPrism(slab, ring, 0.15, 0.17, owner);
  }
}

function buildRailwayCrossing(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const width = detail.width ?? 8;
  const tracks = detail.tracks ?? 1;
  const frame = frameAt(prepared, detail.s);
  const deckKey = detail.surface || 'concrete';

  // Deck panels across the carriageway and verges.
  const halfDepth = Math.max(4.2, tracks * 4.4 + 2.2);
  const deckFrom = detail.s - halfDepth;
  const deckTo = detail.s + halfDepth;
  const stations = prepared.stations.filter((st) => st.s >= deckFrom - 1 && st.s <= deckTo + 1);
  const material = getSurfaceMaterial(deckKey);
  const inv = 1 / (material.userData.metersPerTile || 4);
  const o0 = Math.min(cross.carriageLeft, -width / 2) - 0.6;
  const o1 = Math.max(cross.carriageRight, width / 2) + 0.6;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const p0 = pointAt(a, o0, 0.012);
    const p1 = pointAt(a, o1, 0.012);
    const p2 = pointAt(b, o1, 0.012);
    const p3 = pointAt(b, o0, 0.012);
    const builder = ctx.sink.at((p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, deckKey);
    builder.quad(p0, p1, p2, p3, null, [
      [o0 * inv, a.s * inv],
      [o1 * inv, a.s * inv],
      [o1 * inv, b.s * inv],
      [o0 * inv, b.s * inv],
    ], owner);
  }

  // Rails running across the road (perpendicular to the road's direction).
  const railBuilder = ctx.sink.at(frame.p.x, frame.p.z, 'ballast');
  const railKey = 'rail-bed';
  for (let t = 0; t < tracks; t++) {
    const gauge = 1.435;
    const sBase = detail.s + (t - (tracks - 1) / 2) * 4.4;
    for (const lateral of [-gauge / 2, gauge / 2]) {
      const a = pointAt(frameAt(prepared, sBase - 0.035), o0, 0.12);
      const b = pointAt(frameAt(prepared, sBase - 0.035), o1, 0.12);
      const c = pointAt(frameAt(prepared, sBase + 0.035), o1, 0.12);
      const d = pointAt(frameAt(prepared, sBase + 0.035), o0, 0.12);
      const top = [a, b, c, d].map((p) => [p[0], p[1] + 0.06, p[2]]);
      const half = Math.hypot(o1 - o0, 0) * 0;
      railBuilder.quad(a, b, c, d, null, [[0, 0], [(o1 - o0) * 0.5, 0], [(o1 - o0) * 0.5, 0.07], [0, 0.07]], owner);
      railBuilder.quad(top[3], top[2], top[1], top[0], null, [[0, 0], [(o1 - o0) * 0.5, 0], [(o1 - o0) * 0.5, 0.5], [0, 0.5]], owner);
    }
    // Sleepers between the rails.
    for (let x = o0 + 0.6; x < o1 - 0.4; x += 0.62) {
      const a = pointAt(frameAt(prepared, sBase - 0.55), x, 0.1);
      const b = pointAt(frameAt(prepared, sBase - 0.55), x + 0.3, 0.1);
      const c = pointAt(frameAt(prepared, sBase + 0.55), x + 0.3, 0.1);
      const d = pointAt(frameAt(prepared, sBase + 0.55), x, 0.1);
      railBuilder.quad(a, b, c, d, null, [[0, 0], [0.3, 0], [0.3, 1.1], [0, 1.1]], owner);
    }
  }

  // Stop line + white saltire across the approach.
  addTransverseBand(ctx, prepared, {
    s: detail.s - halfDepth - 1.6,
    depth: 0.45,
    fromOffset: cross.carriageLeft + 0.2,
    toOffset: cross.carriageRight - 0.2,
    materialKey: 'crossing-stop',
    material: getMarkingMaterial('crossing-stop', { color: WHITE }),
    owner,
  });
  const glyphFrame = frameAt(prepared, detail.s - halfDepth - 4);
  const gp = pointAt(glyphFrame, cross.centerOffset, DECAL);
  addWorldGlyph(ctx, {
    x: gp[0],
    z: gp[2],
    y: gp[1],
    size: 2.6,
    dirX: glyphFrame.t[0],
    dirZ: glyphFrame.t[2],
    material: getGlyphMaterial('look', '#f4f3ee'),
    materialKey: 'glyph-look',
    owner,
  });

  // Crossbucks and barriers.
  for (const side of [-1, 1]) {
    const lateral = side < 0 ? o0 - 1.2 : o1 + 1.2;
    const p = pointAt(frame, lateral, 0);
    placeProp(ctx, 'sign', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]) + (side < 0 ? Math.PI : 0));
    if (detail.gates) {
      const g = pointAt(frameAt(prepared, detail.s - halfDepth - 2.4), lateral, 0);
      placeProp(ctx, 'signal', g[0], g[1], g[2], Math.atan2(frame.t[0], frame.t[2]) + (side < 0 ? Math.PI / 2 : -Math.PI / 2));
    }
  }
}

function buildBusStop(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const side = detail.side || 'right';
  const edge = side === 'left' ? cross.carriageLeft : cross.carriageRight;
  const outward = side === 'left' ? -1 : 1;
  const length = detail.length ?? 14;
  const busLane = cross.lanes.find((lane) => lane.kind === 'bus' && (side === 'right' ? lane.dir > 0 : lane.dir < 0))
    || cross.lanes.find((lane) => lane.kind === 'bus');
  const inner = busLane ? (side === 'left' ? busLane.o1 : busLane.o0) : edge - outward * 0.1;
  const outer = busLane ? (side === 'left' ? busLane.o0 : busLane.o1) : edge + outward * 0.1;

  // Bus cage: hatched yellow box with a solid edge.
  const hatch = ctx.sink.at(prepared.stations[0].p.x, prepared.stations[0].p.z, 'cage-hatch');
  const hatchMaterial = getHatchMaterial(45);
  ctx.sink.registerMaterial('cage-hatch', hatchMaterial);
  const stations = prepared.stations.filter((st) => Math.abs(st.s - detail.s) <= length / 2);
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const p0 = pointAt(a, Math.min(inner, outer), DECAL);
    const p1 = pointAt(a, Math.max(inner, outer), DECAL);
    const p2 = pointAt(b, Math.max(inner, outer), DECAL);
    const p3 = pointAt(b, Math.min(inner, outer), DECAL);
    hatch.quad(p0, p1, p2, p3, null, [
      [0, a.s / 2],
      [Math.abs(outer - inner) / 2, a.s / 2],
      [Math.abs(outer - inner) / 2, b.s / 2],
      [0, b.s / 2],
    ], owner);
  }

  // "BUS" legend on the deck.
  for (let s = detail.s - length / 2 + 4; s < detail.s + length / 2 - 1; s += 12) {
    const frame = frameAt(prepared, s);
    const p = pointAt(frame, (inner + outer) / 2, DECAL);
    addWorldGlyph(ctx, {
      x: p[0],
      z: p[2],
      y: p[1],
      size: Math.min(2.2, Math.abs(outer - inner) * 0.9),
      dirX: frame.t[0] * (side === 'left' ? -1 : 1),
      dirZ: frame.t[2] * (side === 'left' ? -1 : 1),
      material: getGlyphMaterial('bus', '#f4f3ee'),
      materialKey: 'glyph-bus',
      owner,
    });
  }

  if (detail.boarder) {
    // Raised boarding kerb strip at the back of the bay.
    const ring = [];
    const s0 = detail.s - length / 2;
    const s1 = detail.s + length / 2;
    const samples = Math.max(2, Math.round(length / 3));
    for (let i = 0; i <= samples; i++) {
      ring.push(pointAt(frameAt(prepared, s0 + ((s1 - s0) * i) / samples), inner, 0));
    }
    for (let i = samples; i >= 0; i--) {
      ring.push(pointAt(frameAt(prepared, s0 + ((s1 - s0) * i) / samples), inner - outward * 1.6, 0));
    }
    const kerb = ctx.sink.at(ring[0][0], ring[0][2], 'kerb');
    const slab = ctx.sink.at(ring[0][0], ring[0][2], 'slab');
    addPrism(kerb, ring, -0.05, 0.16, owner);
    addPrism(slab, ring, 0.15, 0.17, owner);
  }

  // Furniture.
  const frame = frameAt(prepared, detail.s);
  const kerbPoint = pointAt(frame, edge + outward * 1.4, 0.16);
  placeProp(ctx, 'busFlag', kerbPoint[0], kerbPoint[1], kerbPoint[2], Math.atan2(frame.t[0], frame.t[2]));
  if (detail.shelter) {
    const shelterPoint = pointAt(frameAt(prepared, detail.s + 1.5), edge + outward * 2.4, 0.16);
    placeProp(ctx, 'busShelter', shelterPoint[0], shelterPoint[1], shelterPoint[2], Math.atan2(frame.t[0], frame.t[2]));
  }
  const binPoint = pointAt(frameAt(prepared, detail.s - length / 2 + 1), edge + outward * 1.1, 0.16);
  placeProp(ctx, 'bin', binPoint[0], binPoint[1], binPoint[2], Math.atan2(frame.t[0], frame.t[2]));
  // Tactile strip at the boarding edge.
  addTransverseBand(ctx, prepared, {
    s: detail.s,
    depth: Math.min(3.2, length * 0.5),
    fromOffset: edge - outward * 0.5,
    toOffset: edge + outward * 0.4,
    materialKey: 'tactile',
    material: getTactileMaterial(),
    owner,
  });
}

function buildTaxiRank(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const side = detail.side || 'right';
  const bays = detail.bays ?? 3;
  const bayLength = 5.6;
  const edge = side === 'left' ? cross.carriageLeft : cross.carriageRight;
  const outward = side === 'left' ? -1 : 1;
  const o0 = edge;
  const o1 = edge + outward * 2.4;
  const start = detail.s - (bays * bayLength) / 2;
  for (let i = 0; i <= bays; i++) {
    addTransverseBand(ctx, prepared, {
      s: start + i * bayLength,
      depth: 0.14,
      fromOffset: Math.min(o0, o1),
      toOffset: Math.max(o0, o1),
      materialKey: 'taxi-line',
      material: getMarkingMaterial('taxi-line', { color: WHITE }),
      owner,
    });
  }
  addLongitudinal(ctx, prepared, edge + outward * 2.3, 0.12, start, start + bays * bayLength, 'taxi-line');
  const frame = frameAt(prepared, start + bays * bayLength + 1.2);
  const p = pointAt(frame, edge + outward * 1.2, 0.16);
  placeProp(ctx, 'taxiSign', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
}

function addLongitudinal(ctx, prepared, offset, width, from, to, materialKey, material, color = WHITE) {
  const stations = prepared.stations;
  const half = width / 2;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const mid = (a.s + b.s) * 0.5;
    if (mid < from || mid > to) continue;
    const p0 = pointAt(a, offset - half, DECAL);
    const p1 = pointAt(a, offset + half, DECAL);
    const p2 = pointAt(b, offset + half, DECAL);
    const p3 = pointAt(b, offset - half, DECAL);
    const mat = material || getMarkingMaterial(materialKey, { color });
    ctx.sink.registerMaterial(materialKey, mat);
    const builder = ctx.sink.at((p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2, materialKey);
    builder.quad(p0, p1, p2, p3, null, [[0, 0], [1, 0], [1, 1], [0, 1]], ctx.ownerOf(prepared.road.id));
  }
}

function buildTramStop(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const side = detail.side || 'right';
  const length = detail.length ?? 22;
  const height = detail.height ?? 0.28;
  const tramLane = cross.lanes.find((lane) => lane.kind === 'tram');
  const edge = tramLane ? (side === 'left' ? tramLane.o0 : tramLane.o1) : (side === 'left' ? cross.carriageLeft : cross.carriageRight);
  const outward = side === 'left' ? -1 : 1;
  const ring = [];
  const s0 = detail.s - length / 2;
  const s1 = detail.s + length / 2;
  const samples = Math.max(3, Math.round(length / 4));
  for (let i = 0; i <= samples; i++) ring.push(pointAt(frameAt(prepared, s0 + ((s1 - s0) * i) / samples), edge, 0));
  for (let i = samples; i >= 0; i--) ring.push(pointAt(frameAt(prepared, s0 + ((s1 - s0) * i) / samples), edge + outward * 3, 0));
  const kerb = ctx.sink.at(ring[0][0], ring[0][2], 'kerb');
  const slab = ctx.sink.at(ring[0][0], ring[0][2], 'slab');
  addPrism(kerb, ring, -0.05, height, owner);
  addPrism(slab, ring, height - 0.01, height, owner);
  // Tactile edge strip.
  addLongitudinal(ctx, prepared, edge + outward * 0.45, 0.7, s0, s1, 'tactile', getTactileMaterial());
  const frame = frameAt(prepared, detail.s);
  const p = pointAt(frame, edge + outward * 2.2, height);
  placeProp(ctx, 'busShelter', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
  placeProp(ctx, 'busFlag', pointAt(frame, edge + outward * 0.8, height)[0], p[1], pointAt(frame, edge + outward * 0.8, height)[2], Math.atan2(frame.t[0], frame.t[2]));
}

function buildGuardrail(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const length = detail.length ?? 30;
  const height = detail.height ?? 0.75;
  const sides = sideOffsets(detail, cross);
  const stations = prepared.stations.filter((st) => Math.abs(st.s - detail.s) <= length / 2 + 1);
  for (const edge of sides) {
    const outward = edge === cross.carriageLeft ? -1 : 1;
    const offset = edge + outward * 0.35;
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      const p0 = pointAt(a, offset, height);
      const p1 = pointAt(b, offset, height);
      const p2 = pointAt(b, offset, height - 0.32);
      const p3 = pointAt(a, offset, height - 0.32);
      const builder = ctx.sink.at(p0[0], p0[2], 'guardrail');
      ctx.sink.registerMaterial('guardrail', getSurfaceMaterial('metal'));
      builder.quad(p0, p1, p2, p3, null, [[0, 0], [1, 0], [1, 0.32], [0, 0.32]], owner);
    }
    // Posts every 4 m.
    for (let s = detail.s - length / 2; s <= detail.s + length / 2; s += 4) {
      const frame = frameAt(prepared, s);
      const p = pointAt(frame, offset, 0);
      placeProp(ctx, 'markerPost', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
    }
  }
}

function buildSubwayEntrance(prepared, detail, ctx) {
  const cross = prepared.cross;
  const side = detail.side || 'right';
  const edge = side === 'left' ? cross.carriageLeft : cross.carriageRight;
  const outward = side === 'left' ? -1 : 1;
  const frame = frameAt(prepared, detail.s);
  const base = pointAt(frame, edge + outward * 2.6, 0.16);
  placeProp(ctx, 'busShelter', base[0], base[1], base[2], Math.atan2(frame.t[0], frame.t[2]));
  // Stair void: a dark opening with a handrail.
  const ring = [];
  const s0 = detail.s - 2.4;
  const s1 = detail.s + 2.4;
  for (const s of [s0, s1]) {
    const f = frameAt(prepared, s);
    ring.push(pointAt(f, edge + outward * 1.1, 0.16));
    ring.push(pointAt(f, edge + outward * 3.1, 0.16));
  }
  const slab = ctx.sink.at(ring[0][0], ring[0][2], 'wall');
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    slab.quad(
      [ring[i][0], 0.16, ring[i][2]],
      [ring[j][0], 0.16, ring[j][2]],
      [ring[j][0], -4, ring[j][2]],
      [ring[i][0], -4, ring[i][2]],
      null,
      null,
      ctx.ownerOf(prepared.road.id),
    );
  }
}

function buildLoadingBay(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const side = detail.side || 'right';
  const length = detail.length ?? 12;
  const edge = side === 'left' ? cross.carriageLeft : cross.carriageRight;
  const outward = side === 'left' ? -1 : 1;
  const o0 = edge;
  const o1 = edge + outward * 2.5;
  const s0 = detail.s - length / 2;
  const s1 = detail.s + length / 2;
  for (const s of [s0, s1]) {
    addTransverseBand(ctx, prepared, {
      s,
      depth: 0.14,
      fromOffset: Math.min(o0, o1),
      toOffset: Math.max(o0, o1),
      materialKey: 'loading-line',
      material: getMarkingMaterial('loading-line', { color: YELLOW }),
      owner,
    });
  }
  addLongitudinal(ctx, prepared, o1, 0.2, s0, s1, 'loading-kerb', getMarkingMaterial('loading-kerb', { color: YELLOW }));
  addLongitudinal(ctx, prepared, o0 + outward * 0.1, 0.12, s0, s1, 'loading-line');
}

function buildSimplePropRow(prepared, detail, ctx, type, spacingDefault = 1.6) {
  const cross = prepared.cross;
  const frame = frameAt(prepared, detail.s);
  const sides = sideOffsets(detail, cross);
  const count = detail.count ?? 1;
  const spacing = detail.spacing ?? spacingDefault;
  const propType = detail.type || type;
  for (const edge of sides) {
    const outward = edge === cross.carriageLeft ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const s = detail.s + (i - (count - 1) / 2) * spacing;
      const f = frameAt(prepared, clamp(s, 0, prepared.length));
      const p = pointAt(f, edge + outward * 0.55, 0.16);
      placeProp(ctx, propType, p[0], p[1], p[2], Math.atan2(f.t[0], f.t[2]));
    }
  }
  return frame;
}

function buildTrees(prepared, detail, ctx) {
  const cross = prepared.cross;
  const side = detail.side || 'left';
  const spacing = detail.spacing ?? 12;
  const count = detail.count ?? 1;
  for (const dir of side === 'both' ? [-1, 1] : [side === 'left' ? -1 : 1]) {
    const candidates = cross.lanes.filter(
      (l) => l.kind === 'planting' || l.kind === 'verge' || l.kind === 'sidewalk',
    );
    const lane = dir < 0 ? candidates[0] : candidates[candidates.length - 1];
    const offset = lane ? (lane.o0 + lane.o1) / 2 : (dir < 0 ? cross.carriageLeft - 1.2 : cross.carriageRight + 1.2);
    for (let i = 0; i < count; i++) {
      const s = clamp(detail.s + (i - (count - 1) / 2) * spacing, 0.5, prepared.length - 0.5);
      const frame = frameAt(prepared, s);
      const p = pointAt(frame, offset, lane?.h ?? 0.15);
      placeProp(ctx, i % 5 === 4 ? 'conifer' : 'tree', p[0], p[1], p[2], 0, 0.9 + ((i * 37) % 11) / 40);
    }
  }
}

function buildGully(prepared, detail, ctx) {
  const cross = prepared.cross;
  const owner = ctx.ownerOf(prepared.road.id);
  const frame = frameAt(prepared, detail.s);
  for (const edge of sideOffsets(detail, cross)) {
    const outward = edge === cross.carriageLeft ? -1 : 1;
    addTransverseBand(ctx, prepared, {
      s: detail.s,
      depth: 0.5,
      fromOffset: edge + outward * 0.02,
      toOffset: edge + outward * 0.45,
      materialKey: 'gully',
      material: getMarkingMaterial('gully', { color: 0x2b2e31 }),
      owner,
    });
  }
  return frame;
}

function buildManhole(prepared, detail, ctx) {
  const owner = ctx.ownerOf(prepared.road.id);
  const frame = frameAt(prepared, detail.s);
  const size = 0.7;
  const offset = detail.offset ?? 0;
  const c = pointAt(frame, offset, DECAL);
  const rx = frame.r[0];
  const rz = frame.r[2];
  const tx = frame.t[0];
  const tz = frame.t[2];
  const h = size / 2;
  const corners = [
    [c[0] - rx * h - tx * h, c[1], c[2] - rz * h - tz * h],
    [c[0] + rx * h - tx * h, c[1], c[2] + rz * h - tz * h],
    [c[0] + rx * h + tx * h, c[1], c[2] + rz * h + tz * h],
    [c[0] - rx * h + tx * h, c[1], c[2] - rz * h + tz * h],
  ];
  const builder = ctx.sink.at(c[0], c[2], 'manhole');
  ctx.sink.registerMaterial('manhole', getSurfaceMaterial('metal'));
  builder.quad(corners[0], corners[1], corners[2], corners[3], null, [[0, 0], [1, 0], [1, 1], [0, 1]], owner);
}

function buildMarkerPosts(prepared, detail, ctx) {
  const cross = prepared.cross;
  const spacing = detail.spacing ?? 20;
  const count = detail.count ?? 10;
  for (const dir of detail.side === 'both' ? [-1, 1] : [detail.side === 'left' ? -1 : 1]) {
    const offset = dir < 0 ? cross.carriageLeft - 1.1 : cross.carriageRight + 1.1;
    for (let i = 0; i < count; i++) {
      const s = clamp(detail.s + (i - (count - 1) / 2) * spacing, 0.5, prepared.length - 0.5);
      const frame = frameAt(prepared, s);
      const p = pointAt(frame, offset, 0);
      placeProp(ctx, 'markerPost', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
    }
  }
}

const BUILDERS = {
  'speed-bump': buildSpeedBump,
  'speed-table': buildSpeedTable,
  'rumble-strip': buildRumbleStrip,
  'pedestrian-crossing': buildPedestrianCrossing,
  'refuge-island': buildRefugeIsland,
  'kerb-extension': buildKerbExtension,
  'railway-crossing': buildRailwayCrossing,
  'bus-stop': buildBusStop,
  'taxi-rank': buildTaxiRank,
  'tram-stop': buildTramStop,
  bollards: (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'bollard', 1.6),
  guardrail: buildGuardrail,
  'tree-pit': buildTrees,
  bench: (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'bench', 2.4),
  'litter-bin': (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'bin', 3),
  'cycle-stand': (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'cycleStand', 1.2),
  planter: (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'planter', 2),
  'street-light': (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, detail.type || 'lamp', 1),
  'traffic-signal': (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'signal', 1),
  sign: (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'sign', 1),
  'catenary-mast': (prepared, detail, ctx) => buildSimplePropRow(prepared, detail, ctx, 'catenary', 1),
  'marker-post': buildMarkerPosts,
  gully: buildGully,
  manhole: buildManhole,
  'loading-bay': buildLoadingBay,
  'subway-entrance': buildSubwayEntrance,
};

/** Build every detail attached to a road. */
export function buildRoadDetails(prepared, ctx) {
  const road = prepared.road;
  for (const detail of road.details || []) {
    const builder = BUILDERS[detail.type];
    if (!builder) continue;
    const s = clamp(detail.s ?? 0, 0, prepared.length);
    builder(prepared, { ...detail, s }, ctx);
  }
}

/**
 * Automatic furniture derived from the profile hints: lighting columns, street
 * trees, bollards, drainage and parked vehicles.
 */
export function buildAutomaticFurniture(prepared, ctx) {
  const { cross, profile, road } = prepared;
  const hints = profile.hints || {};
  const length = prepared.length;
  const startClip = ctx.junctionBlend?.get(road.nodeIds[0]) ?? 0;
  const endClip = ctx.junctionBlend?.get(road.nodeIds[road.nodeIds.length - 1]) ?? 0;
  const from = startClip + 1;
  const to = length - endClip - 1;
  if (to - from < 2) return;

  const lighting = hints.lighting;
  if (lighting && lighting.spacing > 0) {
    const type = lighting.type === 'heritage' ? 'lampHeritage' : lighting.type === 'flood' ? 'floodMast' : 'lamp';
    const sides = lighting.side === 'both' ? [-1, 1] : lighting.side === 'left' ? [-1] : [1];
    let index = 0;
    for (let s = from + lighting.spacing * 0.5; s < to; s += lighting.spacing) {
      for (const dir of sides) {
        if (lighting.side === 'alternate' && index % 2 === 1 && dir === 1) continue;
        const lane = cross.lanes.find((l) => l.kind === 'sidewalk');
        const offset = lane
          ? (dir < 0 ? lane.o1 - 0.35 : lane.o0 + 0.35)
          : (dir < 0 ? cross.carriageLeft - 0.9 : cross.carriageRight + 0.9);
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, offset, lane?.h ?? 0.15);
        placeProp(ctx, type, p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
      }
      index++;
    }
  }

  if (hints.trees && hints.trees.spacing > 0) {
    buildTrees(prepared, {
      side: 'both',
      spacing: hints.trees.spacing,
      count: Math.max(1, Math.floor((to - from) / hints.trees.spacing)),
      s: (from + to) / 2,
    }, ctx);
  }

  if (hints.bollards) {
    for (const dir of [-1, 1]) {
      for (let s = from + 1; s < to; s += 2.6) {
        const lane = cross.lanes.find((l) => l.kind === 'sidewalk');
        if (!lane) break;
        const offset = dir < 0 ? lane.o1 - 0.3 : lane.o0 + 0.3;
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, offset, lane.h);
        placeProp(ctx, 'bollard', p[0], p[1], p[2], 0);
      }
    }
  }

  if (hints.benches) {
    for (const dir of [-1, 1]) {
      for (let s = from + 6; s < to - 4; s += 26) {
        const lane = cross.lanes.find((l) => l.kind === 'sidewalk');
        if (!lane) break;
        const offset = dir < 0 ? lane.o1 - 0.6 : lane.o0 + 0.6;
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, offset, lane.h);
        placeProp(ctx, 'bench', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]) + (dir < 0 ? Math.PI : 0));
      }
    }
  }

  if (hints.rail) {
    // Catenary masts and marker posts along electrified track.
    const lane = cross.lanes.find((l) => l.kind === 'rail');
    if (lane) {
      for (let s = from; s < to; s += 42) {
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, lane.o1 + 1.4, 0);
        placeProp(ctx, 'catenary', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
      }
      for (let s = from; s < to; s += 8) {
        const frame = frameAt(prepared, s);
        const p = pointAt(frame, lane.o0 - 1.1, 0);
        placeProp(ctx, 'markerPost', p[0], p[1], p[2], Math.atan2(frame.t[0], frame.t[2]));
      }
    }
  }

  // Drainage: a gully at each kerb every 22 m on sealed urban roads.
  const sealed = cross.lanes.some((l) => l.surface === 'asphalt' || l.surface === 'concrete' || l.surface === 'slab');
  if (sealed && cross.lanes.some((l) => l.kind === 'sidewalk')) {
    for (let s = from + 6; s < to; s += 22) {
      buildGully(prepared, { s, side: 'both' }, ctx);
    }
  }
}

export { addPrism, bumpHeight, sideOffsets };
