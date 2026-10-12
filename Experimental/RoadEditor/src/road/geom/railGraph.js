// Graph railway builders: heavy-rail edges (reusing the ballast/crossing builder between
// junction setbacks), suspended-monorail guideways on pylons, and rail junctions (buffer stops,
// turnouts with point blades + frogs, diamond crossings, station decks).
import { ShapeUtils, Vector2 } from 'three';
import { Out, ribbon, wall, sweep, box, polyWall, polygon, yawFor } from './out.js';
import { buildRail, findCrossings, TRACK_SPACING } from './rail.js';
import { getRailProfile, railLayout, RAIL_GAUGE, MONO_BEAM_W, MONO_BEAM_D } from '../railProfiles.js';
import { getProfile, layout } from '../profiles.js';
import { clamp } from '../math.js';

const GROUND = -0.06;
const RAIL_TOP = 0.42;
const RAIL_SHAPE = [[0.035, -0.16], [0.035, -0.01], [0.02, 0], [-0.02, 0], [-0.035, -0.01], [-0.035, -0.16]];
// Suspended cabin envelope below the beam top (must match trains.js MONO_HANG).
export const MONO_CABIN_TOP = -1.8, MONO_CABIN_FLOOR = -4.5, MONO_CABIN_W = 2.6;

// ------------------------------------------------------------------ edges
export function buildRailEdge(net, rail, edge, JA, JB, ctx, index) {
  const prof = getRailProfile(edge);
  if (prof.family === 'mono') return buildMonoEdge(net, rail, edge, JA, JB, ctx, index);
  return buildHeavyEdge(net, rail, edge, JA, JB, ctx, index);
}

export function buildHeavyEdge(net, rail, edge, JA, JB, ctx, index) {
  const rc = rail.centerline(edge);
  const L = rc.length;
  const eA = JA?.endFor?.(edge.id, true), eB = JB?.endFor?.(edge.id, false);
  const s0 = eA ? eA.setback : 0, s1 = L - (eB ? eB.setback : 0);
  const prof = getRailProfile(edge);
  let crossings = index ? findCrossings(net, null, rc, index) : [];
  // grade separation: elevated track bridges over streets instead of gating them; a street on a
  // bridge passes over the track untouched.
  const spans = [];
  if (crossings.length) {
    const keep = [];
    for (const x of crossings) {
      const e = net.edges.get(x.edgeId), c = e ? net.centerline(e) : null;
      const roadY = c ? c.frameAt(clamp(x.sEdge, 0, c.length)).y || 0 : 0;
      const railY = rc.frameAt(x.sRail).y || 0;
      if (Math.abs(railY - roadY) > 2.2) {
        if (railY > roadY) { const h = x.half / x.sin + 4; spans.push([x.sRail - h, x.sRail + h]); }
        continue;
      }
      keep.push(x);
    }
    crossings = keep;
  }
  const gaps = (edge.features || []).filter(f => f.type === 'halt').map(f => [f.s - 46, f.s + 46]);
  const out = buildRail(net, { id: edge.id, tracks: prof.tracks }, rc, crossings, ctx, [s0, s1], gaps.length ? gaps : null, spans.length ? spans : null);
  for (const ft of edge.features || []) {
    if (ft.type === 'halt' && ft.s > s0 + 45 && ft.s < s1 - 45) haltPlatforms(out, rc, ft, railLayout(prof));
  }
  return out;
}

// Heavy-rail halt: side platforms, shelters, lamps and signs; tracks run straight through.
function haltPlatforms(out, rc, ft, lay) {
  const LEN = 80, W = 3.0, TOP = 1.0;
  const inner = lay.half + 0.35;
  for (const side of [-1, 1]) {
    const oc = side * (inner + W / 2);
    const f0 = rc.frameAt(ft.s - LEN / 2), f1 = rc.frameAt(ft.s + LEN / 2);
    const cx = (f0.x + f1.x) / 2, cz = (f0.z + f1.z) / 2, cy = (f0.y + f1.y) / 2;
    const dx = f1.x - f0.x, dz = f1.z - f0.z, l = Math.hypot(dx, dz) || 1;
    const tx = dx / l, tz = dz / l, nx = -tz, nz = tx;
    const px = cx + nx * oc, pz = cz + nz * oc;
    box(out, 'concrete', px, cy + TOP - 0.55, pz, tx, tz, LEN / 2, W / 2, 0.55);
    box(out, 'platformEdge', px - nx * side * (W / 2 - 0.3), cy + TOP + 0.012, pz - nz * side * (W / 2 - 0.3), tx, tz, LEN / 2, 0.28, 0.012);
    const f = rc.frameAt(ft.s);
    out.prop('busShelter', f.x + nx * (oc + side * 0.2), cy + TOP, f.z + nz * (oc + side * 0.2), yawFor(-nx * side, -nz * side));
    out.prop('haltSign', f.x + nx * (oc + side * 1.0), cy + TOP, f.z + nz * (oc + side * 1.0), yawFor(tx, tz));
    for (const ds of [-30, 0, 30]) {
      const g = rc.frameAt(ft.s + ds);
      out.prop('lampPost', g.x + nx * (oc + side * 1.1), cy + TOP, g.z + nz * (oc + side * 1.1), 0);
    }
    const b = rc.frameAt(ft.s + 18);
    out.prop('bench', b.x + nx * (oc + side * 0.6), cy + TOP, b.z + nz * (oc + side * 0.6), yawFor(-nx * side, -nz * side));
  }
}

// ------------------------------------------------------------------ suspended monorail guideway
// A guideway pylon may stand anywhere except inside a live carriageway or across a heavy-rail
// formation it would block. Streets passing UNDER the beam are the whole point, so only the
// pylon footprint is tested (unlike pierBlocked, subway tunnels below don't disqualify a site).
function clearForPylon(net, rail, index, x, z, r, beamY, selfId) {
  if (index) for (const e of index.query(x, z, 14)) {
    const c = net.centerline(e), q = c.nearest(x, z);
    if (q.d > layout(getProfile(e)).total / 2 + r + 0.5) continue;
    const f = c.frameAt(q.s);
    if ((f.y || 0) < beamY - 4.0) return false;
  }
  if (rail) for (const e of rail.edges.values()) {
    if (e.id === selfId || rail.family(e) !== 'heavy') continue;
    const c = rail.centerline(e), q = c.nearest(x, z);
    if (q.d > railLayout(getRailProfile(e)).half + r + 0.5) continue;
    const f = c.frameAt(q.s);
    if ((f.y || 0) < beamY - 4.0) return false;
  }
  return true;
}

function buildMonoEdge(net, rail, edge, JA, JB, ctx, index) {
  const out = new Out(edge.id);
  const prof = getRailProfile(edge), lay = railLayout(prof);
  const rc = rail.centerline(edge), L = rc.length;
  const eA = JA?.endFor?.(edge.id, true), eB = JB?.endFor?.(edge.id, false);
  const s0 = eA ? eA.setback : 0, s1 = L - (eB ? eB.setback : 0);
  out.range = [s0, s1];
  if (s1 - s0 < 3) return out;
  const stations = rc.stations(s0, s1, [], 12, 0.03);
  const frames = stations.map(s => rc.frameAt(s));
  const hw = MONO_BEAM_W / 2;
  for (const o of lay.offs) {
    ribbon(out, 'monoBeam', frames, o - hw, o + hw, 0);
    wall(out, 'monoBeam', frames, o + hw, -MONO_BEAM_D, 0, +1);
    wall(out, 'monoBeam', frames, o - hw, -MONO_BEAM_D, 0, -1);
    sweep(out, 'monoBeam', frames, [[-hw, -MONO_BEAM_D], [hw, -MONO_BEAM_D]], o);
    // running + power rails under the beam: the hanger bogies travel inside these channels
    for (const g of [-0.32, 0.32]) {
      sweep(out, 'steel', frames, [[g - 0.06, -MONO_BEAM_D], [g - 0.06, -MONO_BEAM_D - 0.14], [g + 0.06, -MONO_BEAM_D - 0.14], [g + 0.06, -MONO_BEAM_D]], o);
    }
  }
  // pylons (T-bents), kept clear of live carriageways; end bents cantilever the beam ends
  const want = [];
  for (let s = s0 + 6; s < s1 - 4; s += 24) want.push(s);
  want.push(s0 + 2, s1 - 2);
  for (const s of want) {
    if (s < s0 + 1 || s > s1 - 1) continue;
    let done = false;
    for (const sh of [0, 5, -5, 9, -9, 13, -13]) {
      const ss = s + sh;
      if (ss < s0 + 1 || ss > s1 - 1) continue;
      const f = rc.frameAt(ss);
      const under = f.y - MONO_BEAM_D;
      const gy = ctx.waterAt && ctx.waterAt(f.x, f.z) ? -2.5 : GROUND;
      if (under - gy < 1.6) continue;                       // beam near grade: runs on a plinth
      if (!clearForPylon(net, rail, index, f.x, f.z, 1.2, f.y, edge.id)) continue;
      const capH = 1.0, colTop = under - capH;
      out.prop('pierCap', f.x, colTop, f.z, yawFor(f.nx, f.nz), lay.formation + 1.4, capH, 1.5);
      out.prop('pierCol', f.x, gy, f.z, yawFor(f.tx, f.tz), 1, colTop - gy, 1);
      done = true; break;
    }
    void done;
  }
  // terminus beam caps
  if (JA?.kind === 'terminus') endCap(out, rc, s0, -1, lay);
  if (JB?.kind === 'terminus') endCap(out, rc, s1, +1, lay);
  return out;
}

function endCap(out, rc, s, dir, lay) {
  const f = rc.frameAt(s);
  for (const o of lay.offs) {
    box(out, 'monoBeam', f.x + f.nx * o + f.tx * dir * 0.15, f.y - MONO_BEAM_D / 2, f.z + f.nz * o + f.tz * dir * 0.15, f.tx, f.tz, 0.15, MONO_BEAM_W / 2, MONO_BEAM_D / 2);
    out.prop('monoStop', f.x + f.nx * o + f.tx * dir * 0.9, f.y - MONO_BEAM_D, f.z + f.nz * o + f.tz * dir * 0.9, yawFor(-f.tx * dir, -f.tz * dir));
  }
}

// ------------------------------------------------------------------ rail junctions
export function buildRailJunction(net, rail, J, ctx, index = null) {
  const out = new Out(J.id);
  out.kind = J.kind;
  const N = J.node;
  if (!N) return out;
  out.grow(N.x, J.y, N.z);
  switch (J.kind) {
    case 'buffer': return buildBuffer(out, J);
    case 'terminus': return out;                            // caps are built by the edge
    case 'switch': return buildSwitch(out, J, ctx);
    case 'diamond': return buildDiamond(out, J);
    case 'joint':
    case 'yard': return buildYard(out, J);
    case 'station': return buildStation(out, net, rail, J, ctx, index);
    default: return out;                                    // continuation / mixed / none
  }
}

function buildBuffer(out, J) {
  const N = J.node, e = J.ends[0];
  const yaw = yawFor(-e.dx, -e.dz);
  for (const o of trackOffsetsWorld(e)) {
    const px = N.x + e.rx * o.w, pz = N.z + e.rz * o.w;
    out.prop('bufferStop', px - e.dx * 0.4, J.y + RAIL_TOP - 0.42, pz - e.dz * 0.4, yaw);
  }
  return out;
}

// Track centre offsets of an end in the end frame (w = right-of-outward-d).
function trackOffsetsWorld(e) {
  const sgn = e.atA ? 1 : -1;
  return e.lay.offs.map(o => ({ o, w: o * sgn }));
}

function framesFromPts(pts, y, lift = 0) {
  // pts: [[x,z]...] → centreline-like frames with tangents
  const fr = pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x, z, y: (Array.isArray(y) ? y[i] : y) + lift, s: 0, tx, tz, nx: -tz, nz: tx };
  });
  let s = 0;
  for (let i = 0; i < fr.length; i++) { if (i) s += Math.hypot(fr[i].x - fr[i - 1].x, fr[i].z - fr[i - 1].z); fr[i].s = s; }
  return fr;
}

function apron(out, J, mat, top, skDrop = 0.6) {
  if (!J.polygon || J.polygon.length < 3) return;
  const ring = J.polygon.map(([x, y, z]) => [x, top, z]);
  const contour = ring.map(p => new Vector2(p[0], p[2]));
  try {
    const faces = ShapeUtils.triangulateShape(contour, []);
    const tris = [];
    for (const [a, b, c] of faces) {
      const A = ring[a], B = ring[b], C = ring[c];
      const cr = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
      if (cr < 0) tris.push(a, b, c); else tris.push(a, c, b);
    }
    polygon(out, mat, ring, tris);
  } catch { /* degenerate: skip */ }
  // skirts both ways so the edge reads correctly regardless of ring orientation
  const closed = [...ring, ring[0]];
  polyWall(out, mat, closed, -skDrop, 0, +1);
  polyWall(out, mat, closed, -skDrop, 0, -1);
}

// Section points of an end's tracks at its setback, in world.
function sectionTracks(N, e) {
  return trackOffsetsWorld(e).map(({ w }) => [N.x + e.dx * e.setback + e.rx * w, N.z + e.dz * e.setback + e.rz * w, w]);
}

function pairTracks(A, B) {
  // pair A/B tracks by lateral order so through routes stay parallel
  const sa = A.slice().sort((p, q) => p[2] - q[2]), sb = B.slice().sort((p, q) => p[2] - q[2]);
  const n = Math.min(sa.length, sb.length);
  const out = [];
  for (let k = 0; k < n; k++) out.push([sa[k], sb[sb.length - n + k]]);
  return out;
}

function routeRails(out, pts, y, n = 8) {
  const fr = framesFromPts(pts, y);
  for (const g of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) sweep(out, 'steel', fr, RAIL_SHAPE, g);
  return fr;
}

function lerpPts(a, b, n) {
  const out = [];
  for (let k = 0; k <= n; k++) { const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  return out;
}

function bezPts(a, c, b, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

function sleepersAlong(out, fr, step = 0.7, len = 2.6) {
  for (let d = 0; d < fr[fr.length - 1].s; d += step) {
    const f = frameAtDist(fr, d);
    out.prop('sleeper', f.x, f.y - 0.29, f.z, yawFor(f.nx, f.nz), len / 2.6, 1, 1);
  }
}

function frameAtDist(fr, d) {
  let i = 0;
  while (i < fr.length - 2 && fr[i + 1].s < d) i++;
  const a = fr[i], b = fr[i + 1], t = b.s > a.s ? (d - a.s) / (b.s - a.s) : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, tx: a.tx, tz: a.tz, nx: a.nx, nz: a.nz };
}

function buildSwitch(out, J, ctx) {
  const N = J.node, yT = J.y + RAIL_TOP;
  const end = key => J.ends.find(e => (e.id + (e.atA ? ':a' : ':b')) === key);
  const A = end(J.spec.thru[0]), B = end(J.spec.thru[1]), D = end(J.spec.div), F = end(J.spec.facing);
  apron(out, J, 'ballast', J.y + 0.22);
  const sA = sectionTracks(N, A), sB = sectionTracks(N, B), sD = sectionTracks(N, D), sF = sectionTracks(N, F);
  // through route (straight) + diverging route (curve through the node), slightly lifted to layer
  for (const [pa, pb] of pairTracks(sA, sB)) {
    const pts = lerpPts(pa, pb, 6);
    const fr = routeRails(out, pts, yT);
    sleepersAlong(out, fr, 0.7, Math.max(2.6, A.half * 2 + 1.4));
  }
  const pairs = pairTracks(sF, sD);
  for (const [pf, pd] of pairs) {
    const pts = bezPts(pf, [N.x, N.z], pd, 12);
    const fr = routeRails(out, pts, yT + 0.005);
    sleepersAlong(out, fr, 0.7, 2.9);
    // frog plate where the diverging rail crosses the through rail
    const mid = pts[Math.floor(pts.length * 0.62)];
    const fA = { x: (sA[0][0] + sB[0][0]) / 2, z: (sA[0][1] + sB[0][1]) / 2 };
    const ax = sB[0][0] - sA[0][0], az = sB[0][1] - sA[0][1], al = Math.hypot(ax, az) || 1;
    box(out, 'steel', mid[0], yT - 0.06, mid[1], ax / al, az / al, 0.7, 0.3, 0.05);
    void fA;
  }
  // point blades at the toe + switch stand beside it
  const toe = lerpPts(sF[0], [N.x, N.z], 2)[1];
  const fdx = (N.x - sF[0][0]), fdz = (N.z - sF[0][1]), fl = Math.hypot(fdx, fdz) || 1;
  for (const g of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) {
    const bx = toe[0] + (-fdz / fl) * g, bz = toe[1] + (fdx / fl) * g;
    box(out, 'steel', bx, yT - 0.05, bz, fdx / fl, fdz / fl, 1.6, 0.05, 0.06);
  }
  const side = (sD[0][2] || 0) >= 0 ? 1 : -1;
  out.prop('switchStand', toe[0] + (-fdz / fl) * side * (F.half + 1.2), J.y + 0.22, toe[1] + (fdx / fl) * side * (F.half + 1.2), yawFor(fdx / fl, fdz / fl));
  void ctx;
  return out;
}

function buildDiamond(out, J) {
  const N = J.node, yT = J.y + RAIL_TOP;
  const end = key => J.ends.find(e => (e.id + (e.atA ? ':a' : ':b')) === key);
  apron(out, J, 'ballast', J.y + 0.22);
  for (const key of ['pairA', 'pairB']) {
    const A = end(J.spec[key][0]), B = end(J.spec[key][1]);
    const sA = sectionTracks(N, A), sB = sectionTracks(N, B);
    for (const [pa, pb] of pairTracks(sA, sB)) {
      const fr = routeRails(out, lerpPts(pa, pb, 6), yT + (key === 'pairB' ? 0.005 : 0));
      if (key === 'pairA') sleepersAlong(out, fr, 0.7, Math.max(2.6, A.half * 2 + 1.2));
    }
  }
  // crossing frogs around the centre
  for (const [dx, dz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) {
    box(out, 'steel', N.x + dx, yT - 0.06, N.z + dz, 1, 0, 0.5, 0.25, 0.05);
  }
  return out;
}

function buildYard(out, J) {
  const N = J.node, yT = J.y + RAIL_TOP;
  const isMono = J.ends[0] && J.ends[0].family === 'mono';
  if (isMono) {
    apron(out, J, 'concrete', J.y - 0.02, 1.8);
    return out;
  }
  apron(out, J, 'ballast', J.y + 0.22);
  for (const e of J.ends) {
    for (const p of sectionTracks(N, e)) {
      const fr = routeRails(out, lerpPts(p, [N.x, N.z], 3), yT);
      sleepersAlong(out, fr, 0.7, 2.6);
    }
  }
  return out;
}

// ------------------------------------------------------------------ monorail station
function buildStation(out, net, rail, J, ctx, index) {
  const N = J.node, yB = J.y;
  const end = key => J.ends.find(e => (e.id + (e.atA ? ':a' : ':b')) === key);
  const A = end(J.spec.thru[0]), B = end(J.spec.thru[1]);
  // station axis: through route direction
  const ax = B.dx - A.dx, az = B.dz - A.dz, al = Math.hypot(ax, az) || 1;
  const tx = ax / al, tz = az / al, nx = -tz, nz = tx;
  const half = Math.max(A.half, B.half);
  const PLAT_L = 56, PLAT_W = 3.0, platTop = yB + MONO_CABIN_FLOOR + 0.1;
  const inner = half + 0.1;
  const roofY = yB + 2.4;
  for (const side of [-1, 1]) {
    const oc = side * (inner + PLAT_W / 2);
    const px = N.x + nx * oc, pz = N.z + nz * oc;
    box(out, 'concrete', px, (platTop + GROUND) / 2, pz, tx, tz, PLAT_L / 2, PLAT_W / 2, Math.max(0.4, (platTop - GROUND) / 2));
    box(out, 'platformEdge', px - nx * side * (PLAT_W / 2 - 0.3), platTop + 0.012, pz - nz * side * (PLAT_W / 2 - 0.3), tx, tz, PLAT_L / 2, 0.28, 0.012);
    // canopy columns along the outer edge, roof spanning the hall
    for (const ds of [-PLAT_L / 2 + 4, 0, PLAT_L / 2 - 4]) {
      const cx = px + tx * ds + nx * side * (PLAT_W / 2 - 0.3), cz = pz + tz * ds + nz * side * (PLAT_W / 2 - 0.3);
      out.prop('stationColumn', cx, GROUND, cz, 0, 1, roofY - GROUND, 1);
    }
    for (const ds of [-18, 0, 18]) {
      const lx = px + tx * ds + nx * side * 1.0, lz = pz + tz * ds + nz * side * 1.0;
      out.prop('lampPost', lx, platTop, lz, 0);
    }
    out.prop('monoSign', px + tx * 20 - nx * side * 0.6, platTop, pz + tz * 20 - nz * side * 0.6, yawFor(tx, tz));
    out.prop('monoSign', px - tx * 20 - nx * side * 0.6, platTop, pz - tz * 20 - nz * side * 0.6, yawFor(-tx, -tz));
    out.prop('bench', px - tx * 8 + nx * side * 0.7, platTop, pz - tz * 8 + nz * side * 0.7, yawFor(-nx * side, -nz * side));
    // access stair at the far end, down to the street
    stair(out, N.x + nx * oc - tx * (PLAT_L / 2 + 5.5), platTop, N.z + nz * oc - tz * (PLAT_L / 2 + 5.5), -tx, -tz, platTop - GROUND);
  }
  box(out, 'girder', N.x, roofY, N.z, tx, tz, PLAT_L / 2 + 2, inner + PLAT_W + 1.2, 0.18);
  // support bents under the guideways at the hall ends
  for (const ds of [-PLAT_L / 2 - 2, PLAT_L / 2 + 2]) {
    const fx = N.x + tx * ds, fz = N.z + tz * ds;
    if (!clearForPylon(net, rail, index, fx, fz, 1.2, yB, J.id)) continue;
    out.prop('pierCap', fx, yB - MONO_BEAM_D - 1.0, fz, yawFor(nx, nz), half * 2 + 1.6, 1.0, 1.5);
    out.prop('pierCol', fx, GROUND, fz, yawFor(tx, tz), 1, yB - MONO_BEAM_D - 1.0 - GROUND, 1);
  }
  void ctx;
  return out;
}

function stair(out, x0, yTop, z0, dx, dz, drop) {
  const steps = Math.max(4, Math.round(drop / 0.42));
  const run = drop / Math.tan(Math.PI / 180 * 32);
  const sl = run / steps;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const nx = -dz, nz = dx;
  for (let k = 0; k < steps; k++) {
    const cx = x0 + dx * (k + 0.5) * sl, cz = z0 + dz * (k + 0.5) * sl;
    box(out, 'concrete', cx, yTop - (k + 0.5) * (drop / steps), cz, dx, dz, sl / 2 + 0.02, 1.1, drop / steps / 2 + 0.02);
    void nx; void nz;
  }
}
