// Frontier Road Editor — the deck mesher.
//
// Turns a planned network into surfaces: every ribbon band with its kerbs and
// gutter, every junction apron with its corner slabs, bridges with decks and
// piers, tunnels with bores. Junctions are not patched in afterwards — they are
// built from the same trim lines and corner paths the planner solved, so the
// apron, the kerb line and the ribbon's raised bands share vertices instead of
// merely lining up.

import { MeshBuilder, mergeGeometry, validateMesh, geometryBounds } from './mesh.js';
import { clamp, lerp, dist2, sub2, norm2 } from './math.js';
import { KERBS } from './styles.js';
import { dedupeLoop, simplifyCollinear, polygonCentroid } from './poly.js';
import {
  bandEdges, crossPoint, emitBandTop, emitKerb, emitLoopCap, emitPlanFlat,
  emitQuadOriented, frameAt, roadFrames, runBetween, surfaceLevels,
} from './ribbon.js';
import {
  buildJunctionFurniture, buildJunctionMarkings, buildRailCrossing, buildRailTrack,
  buildRoadFurniture, buildRoadMarkings,
} from './detail.js';

export const GROUPS = ['deck', 'markings', 'furniture', 'structures'];

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Vertical face between two plan points, oriented so its normal points `want`. */
export function emitFace(mb, a, b, yTopA, yTopB, yBotA, yBotB, material, want) {
  return emitQuadOriented(mb, [
    [a[0], yTopA, a[1]], [b[0], yTopB, b[1]], [b[0], yBotB, b[1]], [a[0], yBotA, a[1]],
  ], material, want || [0, 1, 0]);
}

// ── ribbon ──────────────────────────────────────────────────────────────────-

/**
 * One road ribbon: band tops, kerb runs with gutters, median, rail track. Raised
 * bands are clipped to the corner splits so the junction's sidewalk owns the
 * corner, and their inner edge is pulled back by the kerbstone width so the
 * kerb top and the band tile instead of overlapping.
 */
const tag = (mb, name, fn) => (mb.tag ? mb.tag(name, fn) : fn());

export function buildRibbon(net, road, mb, mbDetail, ctx = {}) {
  const run = roadFrames(net, road);
  const stats = { bands: 0, kerbs: 0, track: 0, skipped: 0 };
  if (run.empty) return { ...stats, run };
  const { frames, splits } = run;
  const profile = road.profile;
  const levels = surfaceLevels(profile);
  const camber = road.flags.camber ?? 0;
  const startOf = (side) => (side === 1 ? splits.aL : splits.aR);
  const endOf = (side) => (side === 1 ? splits.bL : splits.bR);

  for (const band of profile.bands) {
    const { inner, outer } = bandEdges(band);
    const y = levels.bandY.get(band) || 0;
    const kerbIn = levels.kerbAt(band.side, inner);
    const kerbOut = levels.kerbAt(band.side, outer);
    const inset = kerbIn ? Math.max(kerbIn.type.width, kerbIn.type.batter ?? 0) : 0;
    // A channel (gutter) belongs to the band outside it: pull that band's outer
    // edge back so the gutter strip and the band meet at one edge, not two.
    const channel = kerbOut && kerbOut.type.channel > 0.01 ? kerbOut.type.channel : 0;
    const innerEdge = inner + band.side * inset;
    const outerEdge = outer - band.side * channel;
    if (Math.abs(outerEdge - innerEdge) < 0.02) { stats.skipped++; continue; }
    const deck = band.level === 'carriageway';
    const fr = deck ? frames : runBetween(frames, startOf(band.side), endOf(band.side));
    if (fr.length < 2) { stats.skipped++; continue; }
    tag(mb, `band ${band.role} ${innerEdge.toFixed(2)}..${outerEdge.toFixed(2)} ${band.material}`, () => emitBandTop(mb, fr, innerEdge, outerEdge, y, band.material, { camber, uvScale: 0.08 }));
    stats.bands++;
  }

  for (const k of levels.kerbs) {
    if (k.median) continue; // the median block below owns its own kerbs
    const fr = runBetween(frames, startOf(k.side), endOf(k.side));
    if (fr.length < 2) continue;
    tag(mb, `kerb ${k.offset.toFixed(2)} ${k.type.face} y${k.yIn.toFixed(2)}->${k.yOut.toFixed(2)}`, () => emitKerb(mb, fr, k, {}));
    stats.kerbs++;
  }

  // Median: raised planting strip, painted gap, or barrier wall.
  const med = profile.median;
  if (med) {
    const halfM = profile.medianHalf;
    const fr = runBetween(frames, Math.max(splits.aL, splits.aR), Math.min(splits.bL, splits.bR));
    if (med.level === 'raised' && fr.length >= 2) {
      tag(mb, `median top ${med.material || 'grass'}`, () => emitBandTop(mb, fr, -halfM, halfM, levels.medianY, med.material || 'grass', { uvScale: 0.1 }));
      const kt = KERBS[med.kerb] || KERBS['median-low'];
      for (const side of [1, -1]) {
        // At a median kerb the raised strip is on the inside, so the levels run
        // the other way round: median height at the offset, carriageway beyond.
        tag(mb, `kerb median ${side > 0 ? 'left' : 'right'} s${side * halfM}`, () => emitKerb(mb, fr, { offset: side * halfM, side, type: kt, yIn: levels.medianY, yOut: 0 }, { gutter: false }));
        stats.kerbs++;
      }
    } else {
      emitBandTop(mb, frames, -halfM, halfM, 0, med.material || 'asphalt', { uvScale: 0.08 });
      if (med.type === 'barrier') {
        const h = med.rail ? 1.1 : 0.85;
        for (let i = 0; i < frames.length - 1; i++) {
          const a = frames[i], b = frames[i + 1];
          const o = 0.16;
          const aL = crossPoint(a, -o, 0), aR = crossPoint(a, o, 0);
          const bL = crossPoint(b, -o, 0), bR = crossPoint(b, o, 0);
          emitFace(mb, [aL[0], aL[2]], [bL[0], bL[2]], aL[1] + h, bL[1] + h, aL[1], bL[1], 'concrete', norm3([a.left[0], 0, a.left[1]]));
          emitFace(mb, [aR[0], aR[2]], [bR[0], bR[2]], aR[1] + h, bR[1] + h, aR[1], bR[1], 'concrete', norm3([-a.left[0], 0, -a.left[1]]));
        }
      }
    }
  }

  if (profile.railway) stats.track = buildRailTrack(net, road, frames, mbDetail, ctx);
  return { ...stats, run };
}

// ── structures ──────────────────────────────────────────────────────────────-

const DECK_THICKNESS = 1.1;

/** Bridge deck slab, fascias, piers; tunnel bore walls and roof. */
export function buildStructures(net, road, run, mb, ctx = {}) {
  const stats = { piers: 0, deck: 0, tunnel: 0 };
  if (!run || run.empty) return stats;
  const { frames } = run;
  const profile = road.profile;
  const half = profile.corridorHalf;

  if (road.flags.bridge || road.flags.elevated) {
    const thickness = road.flags.deckThickness ?? DECK_THICKNESS;
    stats.deck = 1;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      const aL = crossPoint(a, half, 0), aR = crossPoint(a, -half, 0);
      const bL = crossPoint(b, half, 0), bR = crossPoint(b, -half, 0);
      // Soffit faces down, fascias face out.
      tag(mb, 'soffit', () => emitQuadOriented(mb, [
        [aL[0], aL[1] - thickness, aL[2]], [aR[0], aR[1] - thickness, aR[2]],
        [bR[0], bR[1] - thickness, bR[2]], [bL[0], bL[1] - thickness, bL[2]],
      ], 'concrete', [0, -1, 0]));
      tag(mb, 'fascia', () => {
        emitFace(mb, [aL[0], aL[2]], [bL[0], bL[2]], aL[1], bL[1], aL[1] - thickness, bL[1] - thickness, 'concrete', norm3([a.left[0], 0, a.left[1]]));
        emitFace(mb, [aR[0], aR[2]], [bR[0], bR[2]], aR[1], bR[1], aR[1] - thickness, bR[1] - thickness, 'concrete', norm3([-a.left[0], 0, -a.left[1]]));
      });
    }
    const spacing = road.flags.pierSpacing ?? 26;
    for (let s = frames[0].s + spacing / 2; s < frames[frames.length - 1].s; s += spacing) {
      const f = frameAt(frames, s);
      const ground = net.terrainH(f.p[0], f.p[2]);
      const top = f.p[1] - thickness;
      if (top - ground < 1.6) continue;
      const r = 1.0;
      // Piers are squared to the deck, not to the world: an axis-aligned box
      // under a road running north-south is a diamond, and its cap beam points
      // the wrong way across the carriageway.
      const along = [f.dir[0], f.dir[1]];
      const side = [f.left[0], f.left[1]];
      const corner = (u, v) => [f.p[0] + along[0] * u + side[0] * v, f.p[2] + along[1] * u + side[1] * v];
      tag(mb, 'pier', () => {
        const loop = [corner(-r, -r), corner(r, -r), corner(r, r), corner(-r, r)];
        mb.prism(loop, ground - 0.4, top - 0.7, { material: 'concrete' });
        // Pier cap beam under the soffit, wider across the deck.
        const cap = [corner(-r, -r - 0.5), corner(r, -r - 0.5), corner(r, r + 0.5), corner(-r, r + 0.5)];
        mb.prism(cap, top - 0.7, top, { material: 'concrete' });
        mb.cap(cap, top, 'concrete', 0.4, { down: true });
      });
      stats.piers++;
    }
  }

  if (road.flags.tunnel || profile.enclosure === 'tunnel' || profile.enclosure === 'covered') {
    stats.tunnel = 1;
    const roofH = profile.enclosure === 'covered' ? 4.4 : 5.2;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      for (const side of [1, -1]) {
        const pa = crossPoint(a, side * half, 0), pb = crossPoint(b, side * half, 0);
        tag(mb, 'tunnel wall', () => emitFace(mb, [pa[0], pa[2]], [pb[0], pb[2]], pa[1] + roofH, pb[1] + roofH, pa[1], pb[1], 'concrete',
          norm3([-side * a.left[0], 0, -side * a.left[1]])));
      }
      const aL = crossPoint(a, half, 0), aR = crossPoint(a, -half, 0);
      const bL = crossPoint(b, half, 0), bR = crossPoint(b, -half, 0);
      tag(mb, 'tunnel roof', () => emitQuadOriented(mb, [
        [aL[0], aL[1] + roofH, aL[2]], [aR[0], aR[1] + roofH, aR[2]],
        [bR[0], bR[1] + roofH, bR[2]], [bL[0], bL[1] + roofH, bL[2]],
      ], 'concrete', [0, -1, 0]));
    }
  }
  return stats;
}

// ── junctions ───────────────────────────────────────────────────────────────-

/** Deck height of an arm's own ribbon at its mouth. */
function armDeckY(net, plan, i) {
  const e = plan.inc[i];
  const sm = net.sampleRoad(e.road);
  const j = e.road.junctions[e.end];
  const station = j ? j.trim : 0;
  const s = e.end === 'a' ? station : sm.length - station;
  return net.pointAt(e.road, s).p[1];
}

/**
 * Height at every pavement-ring vertex: the arm's deck along the mouth lines, a
 * blend along the corner kerb between the two arms that own it. That makes the
 * apron meet each ribbon at grade — no step, no ramped patch, and no crack.
 */
export function junctionHeights(net, plan) {
  const map = new Map();
  const key = (p) => `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;
  const armY = plan.inc.map((e, i) => armDeckY(net, plan, i));
  for (let i = 0; i < plan.armCount; i++) {
    const m = plan.mouths[i];
    map.set(key(m.left), armY[i]);
    map.set(key(m.right), armY[i]);
  }
  for (let i = 0; i < plan.armCount; i++) {
    const j = (i + 1) % plan.armCount;
    const path = plan.cornerPaths ? plan.cornerPaths[i] : null;
    if (!path || path.length < 2) continue;
    let total = 0;
    const ds = [0];
    for (let k = 1; k < path.length; k++) { total += dist2(path[k - 1], path[k]); ds.push(total); }
    for (let k = 1; k < path.length - 1; k++) {
      map.set(key(path[k]), lerp(armY[i], armY[j], total > 1e-6 ? ds[k] / total : 0.5));
    }
  }
  return { map, key, armY };
}

const keyOf = (p) => `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;

/** Sidewalk corner slabs: the block corner, with a kerb face to the pavement. */
function buildCornerSlabs(net, node, plan, mb, heightAt) {
  const stats = { slabs: 0, kerbs: 0, dropped: 0 };
  for (let i = 0; i < plan.armCount; i++) {
    const poly = plan.corners[i];
    if (!poly) { stats.dropped++; continue; }
    const a = plan.inc[i], b = plan.inc[(i + 1) % plan.armCount];
    const rise = cornerRise(a, b);
    const pts = poly.map((p) => [p[0], p[1]]);
    const top = (p) => heightAt(p) + rise;
    tag(mb, 'junction.slab', () => emitLoopCap(mb, pts, top, sidewalkMaterial(a, b), { uvScale: 0.22 }));
    // Kerb along the shared path only: the other edges meet the ribbon bands at
    // the same height by construction.
    const path = plan.cornerPaths ? plan.cornerPaths[i] : null;
    const c = polygonCentroid(pts);
    const shared = new Map();
    if (path) {
      for (let k = 0; k < path.length - 1; k++) {
        shared.set(`${keyOf(path[k])}|${keyOf(path[k + 1])}`, [path[k], path[k + 1]]);
        shared.set(`${keyOf(path[k + 1])}|${keyOf(path[k])}`, [path[k + 1], path[k]]);
      }
    }
    const N = pts.length;
    for (let k = 0; k < N; k++) {
      const p0 = pts[k], p1 = pts[(k + 1) % N];
      if (!shared.has(`${keyOf(p0)}|${keyOf(p1)}`)) continue;
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const want = norm3([mid[0] - c[0], 0, mid[1] - c[1]]);
      tag(mb, 'junction.slabKerb', () => emitFace(mb, p0, p1, top(p0) - 0.002, top(p1) - 0.002, heightAt(p0), heightAt(p1), 'concrete-kerb', want));
      stats.kerbs++;
    }
    stats.slabs++;
  }
  return stats;
}

function cornerRise(a, b) {
  const la = surfaceLevels(a.profile), lb = surfaceLevels(b.profile);
  const ka = la.kerbs.find((k) => k.side === (a.end === 'a' ? -1 : 1));
  const kb = lb.kerbs.find((k) => k.side === (b.end === 'a' ? 1 : -1));
  return Math.max(ka?.type.height ?? 0.14, kb?.type.height ?? 0.14);
}

function sidewalkMaterial(a, b) {
  const bands = [
    ...a.profile.bands.filter((x) => x.level !== 'carriageway'),
    ...b.profile.bands.filter((x) => x.level !== 'carriageway'),
  ];
  const hope = bands.find((x) => x.role === 'footway') || bands[0];
  return hope?.material || 'paver';
}

/**
 * The junction: apron, corner slabs with their kerbs, and the detail that
 * belongs to the junction (markings, signals, signs, crossings). `mb` takes the
 * deck, `mbDetail` the movable furniture.
 */
export function buildJunction(net, node, mb, mbDetail, ctx = {}) {
  const plan = node.plan || net.planJunction(node);
  const stats = { corners: 0, mouths: 0, kerbs: 0, signals: 0 };
  if (!plan || plan.armCount < 2) return stats;
  const H = junctionHeights(net, plan);
  const heightAt = (p) => {
    const v = H.map.get(H.key(p));
    if (v != null) return v;
    let num = 0, den = 0;
    for (let i = 0; i < plan.armCount; i++) {
      const m = plan.mouths[i];
      const mid = [(m.left[0] + m.right[0]) / 2, (m.left[1] + m.right[1]) / 2];
      const d = Math.max(1, dist2(mid, p));
      num += H.armY[i] / (d * d);
      den += 1 / (d * d);
    }
    return den > 0 ? num / den : node.y;
  };
  plan.heightAt = heightAt;
  plan.surface = plan.surface
    || (plan.type === 'shared' || plan.inc.every((e) => e.profile.shared) ? 'paver' : 'asphalt');

  const ring = simplifyCollinear(dedupeLoop(plan.pavement.map((p) => [p[0], p[1]]), 1e-4), 1e-3);
  if (ring.length >= 3) {
    tag(mb, 'junction.apron', () => emitLoopCap(mb, ring, heightAt, plan.surface, { uvScale: 0.08 }));
    stats.mouths = plan.mouths.length;
  }

  const slabs = buildCornerSlabs(net, node, plan, mb, heightAt);
  stats.corners = slabs.slabs;
  stats.kerbs = slabs.kerbs;
  stats.droppedCorners = slabs.dropped;

  if (ctx.furniture !== false) {
    const f = buildJunctionFurniture(net, node, plan, mbDetail || mb, { ...ctx, heightAt });
    stats.signals = f.signals;
    stats.signs = f.signs;
  }
  const m = buildJunctionMarkings(net, node, plan, ctx.markingsMb || mb, { ...ctx, heightAt });
  stats.markings = m.stops + m.glyphs + m.zebras;
  stats.rail = buildRailCrossing(net, node, plan, mb, mbDetail || mb, ctx).crossings;
  return stats;
}

// ── whole network ───────────────────────────────────────────────────────────-

/**
 * Build the whole network. Groups are separate meshes on purpose: the viewer can
 * toggle paint and furniture, and each group validates on its own — a kerb face
 * and the asphalt it holds back legitimately share an edge, two unrelated groups
 * do not.
 */
export function buildNetworkGeometry(net, opts = {}) {
  const groups = {};
  for (const g of GROUPS) groups[g] = new MeshBuilder(g);
  const stats = { roads: 0, junctions: 0, tris: 0, counts: {}, warnings: [], skipped: [] };
  const count = (k, v = 1) => { if (v) stats.counts[k] = (stats.counts[k] || 0) + v; };

  for (const node of net.nodes) {
    if (!node.roads.length) continue;
    if (!node.plan) net.planJunction(node);
  }

  for (const road of net.roads) {
    const run = roadFrames(net, road);
    if (run.empty) { stats.warnings.push(`road ${road.id} (${road.class}) is consumed by its junctions`); continue; }
    const label = `road ${road.id} ${road.section || road.class}`;
    const r = tag(groups.deck, `${label} bands`, () => buildRibbon(net, road, groups.deck, groups.furniture, opts));
    const s = tag(groups.structures, `${label} structures`, () => buildStructures(net, road, run, groups.structures, opts));
    const m = tag(groups.markings, `${label} paint`, () => buildRoadMarkings(net, road, run.frames, groups.markings, opts));
    const f = tag(groups.furniture, `${label} furniture`, () => buildRoadFurniture(net, road, run.frames, groups.furniture, opts));
    stats.roads++;
    count('bands', r.bands); count('kerbs', r.kerbs); count('dashes', m.quads || 0);
    count('furniture', (f.pieces || 0) + (f.bumps || 0));
    count('piers', s.piers); count('sleepers', s.deck); count('tunnels', s.tunnel); count('track', r.track);
    stats.skipped.push(...(m.skipped || []), ...(f.skipped || []));
  }

  for (const node of net.nodes) {
    if (!node.plan || node.plan.armCount < 2) continue;
    const label = `node ${node.id} ${node.plan.type}`;
    const j = tag(groups.deck, `${label}`, () => buildJunction(net, node, groups.deck, groups.furniture, {
      ...opts, markingsMb: groups.markings,
    }));
    stats.junctions++;
    count('corners', j.corners);
    count('signals', j.signals);
    count('signs', j.signs);
  }
  stats.skipped = [...new Set(stats.skipped)];

  const geos = {};
  const trisByGroup = {};
  for (const g of GROUPS) {
    const geo = groups[g].geometry();
    geos[g] = geo;
    trisByGroup[g] = geo.indices.length / 3;
    stats.tris += geo.indices.length / 3;
  }
  stats.trisByGroup = trisByGroup;
  const merged = mergeGeometry(GROUPS.map((g) => geos[g]).filter((g) => g.indices.length), 'road-network');
  const box = geometryBounds(merged);
  merged.bounds = box;
  // Flat form for the viewer / worker: [minX, minY, minZ, maxX, maxY, maxZ].
  merged.boundsArray = [box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2]];
  return { groups: geos, mesh: merged, stats, builders: groups, bounds: merged.boundsArray };
}

/** Per-group validation, so the harness can gate on it. */
export function validateGroups(built) {
  const out = {};
  for (const g of GROUPS) {
    const geo = built.groups[g];
    if (!geo || !geo.indices.length) continue;
    out[g] = validateMesh(geo, { name: g });
  }
  return out;
}
