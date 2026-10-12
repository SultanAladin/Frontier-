// Road mesh generation. Pure functions over the road network: no three.js, no DOM.
//
// Output is a list of chunks (CHUNK x CHUNK metres) with four layers each:
//   surface     asphalt, concrete, kerbs, rails, bridge decks and parapets
//   markings    lane lines, stop lines, zebra crossings, arrows, parking bays
//   props       bollards, speed bumps, rail-crossing gates, stations, piers
//   underground ghosted subway geometry (rendered transparent)
// Every triangle is emitted flat (its own normal from winding), so the renderer
// must use DoubleSide. Winding never needs to be "correct": normal and winding
// are derived from the same cross product, so both faces shade correctly.

import { dense, frameAt, degrees, incidentEdges, ctrl } from './road-graph.js';
import { CROSSABLE, DIRECTED, curbColor, layoutLanes, lanesOf, presetOf } from './road-catalog.js';

export const CHUNK = 500;
export const ROAD_DROP = -0.05; // roads sit just above the ground plane
export const LINE_H = 0.014; // paint height above the asphalt
const PIER_SPACING = 25;
const TIE_SPACING = 0.7;

const WHITE = [0.93, 0.93, 0.9];
const YELLOW = [0.96, 0.78, 0.14];
const RED = [0.78, 0.12, 0.1];
const STEEL = [0.56, 0.57, 0.6];
const WOOD = [0.32, 0.22, 0.13];
const CONCRETE = [0.72, 0.71, 0.68];
const BOLLARD = [0.95, 0.8, 0.16];
const KIOSK = [0.84, 0.85, 0.86];
const SIDEWALK_COLOUR = [0.66, 0.65, 0.62];
const ROOF = [0.22, 0.25, 0.3];

// ---------------------------------------------------------------- mesh -------

export class MeshBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.tris = 0;
  }

  tri(a, b, c, col) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col[0], col[1], col[2]);
    }
    this.tris += 1;
  }

  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  get empty() {
    return this.tris === 0;
  }

  toBuffers() {
    if (this.empty) return null;
    return {
      position: Float32Array.from(this.p),
      normal: Float32Array.from(this.n),
      color: Float32Array.from(this.c),
      triangles: this.tris,
    };
  }
}

// ------------------------------------------------------------ sampling -------

// Indices of dense samples worth keeping: curvature, height changes, or 25 m.
function keepIndices(D) {
  const n = D.s.length;
  const heading = new Float64Array(n);
  for (let i = 0; i < n - 1; i += 1) heading[i] = Math.atan2(D.z[i + 1] - D.z[i], D.x[i + 1] - D.x[i]);
  heading[n - 1] = heading[n - 2];
  const keep = [0];
  let last = 0;
  for (let i = 1; i < n - 1; i += 1) {
    let dh = Math.abs(heading[i] - heading[last]);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const dy = Math.abs(D.y[i] - D.y[last]);
    if (dh > 0.026 || dy > 0.03 || D.s[i] - D.s[last] >= 25) {
      keep.push(i);
      last = i;
    }
  }
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  return Int32Array.from(keep);
}

// Sorted arc-length samples covering [a,b]: the ends plus every kept sample between.
function sampleRange(info, a, b) {
  const { D, kept } = info;
  const out = [a];
  let lo = 0;
  let hi = kept.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (D.s[kept[mid]] <= a) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < kept.length; k += 1) {
    const s = D.s[kept[k]];
    if (s >= b) break;
    if (s > a) out.push(s);
  }
  out.push(b);
  return out;
}

function framesFor(info, sList) {
  return sList.map((s) => frameAt(info.D, s));
}

const pt = (f, lat, h) => [f.x + f.nx * lat, f.y + h, f.z + f.nz * lat];

// Extrude a lateral profile [[lat,h],...] along a list of frames.
// profile may be a function of the frame (for height that varies along the road).
function profileAlong(mb, frames, profile, color, closed = false) {
  const K = frames.length;
  if (K < 2) return;
  const profs = frames.map((f) => (typeof profile === 'function' ? profile(f) : profile));
  const M = profs[0].length;
  const segs = closed ? M : M - 1;
  for (let k = 0; k < K - 1; k += 1) {
    const f0 = frames[k];
    const f1 = frames[k + 1];
    const p0 = profs[k];
    const p1 = profs[k + 1];
    for (let j = 0; j < segs; j += 1) {
      const j2 = (j + 1) % M;
      mb.quad(pt(f0, p0[j][0], p0[j][1]), pt(f1, p1[j][0], p1[j][1]), pt(f1, p1[j2][0], p1[j2][1]), pt(f0, p0[j2][0], p0[j2][1]), color);
    }
  }
}

// Oriented box. c = centre, ax/ay/az = unit half-axes, h = half extents.
function box(mb, c, ax, ay, az, h, col) {
  const corner = (sx, sy, sz) => [0, 1, 2].map((k) => c[k] + ax[k] * sx * h[0] + ay[k] * sy * h[1] + az[k] * sz * h[2]);
  const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((q) => corner(...q));
  const face = (a, b, cc, d) => mb.quad(v[a], v[b], v[cc], v[d], col);
  face(0, 3, 2, 1);
  face(4, 5, 6, 7);
  face(0, 1, 5, 4);
  face(2, 3, 7, 6);
  face(1, 2, 6, 5);
  face(3, 0, 4, 7);
}

function prism(mb, c, r, h, n, col) {
  const ring = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    ring.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
  }
  const top = ring.map((p) => [p[0], p[1] + h, p[2]]);
  const cen = [c[0], c[1] + h, c[2]];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    mb.quad(ring[i], ring[j], top[j], top[i], col);
    mb.tri(top[i], top[j], cen, col);
  }
}

// ----------------------------------------------------------- lane helpers ----

function crossingGroups(lay) {
  const groups = [];
  let cur = null;
  for (const ln of lay.lanes) {
    if (CROSSABLE.has(ln.kind)) {
      if (!cur) {
        cur = { lo: ln.oR, hi: ln.oL };
        groups.push(cur);
      } else {
        cur.lo = Math.min(cur.lo, ln.oR);
        cur.hi = Math.max(cur.hi, ln.oL);
      }
    } else {
      cur = null;
    }
  }
  return groups;
}

function crossingSpan(lay) {
  const lanes = lay.lanes.filter((ln) => CROSSABLE.has(ln.kind));
  if (!lanes.length) return null;
  return { lo: Math.min(...lanes.map((l) => l.oR)), hi: Math.max(...lanes.map((l) => l.oL)) };
}

function bumpHeight(u) {
  const a = Math.abs(u);
  if (a >= 1.8) return 0;
  if (a <= 1.2) return 0.1;
  return (0.1 * (1.8 - a)) / 0.6;
}

// Zebra crossing centred at arc length sc, stripes running along the road.
function zebra(mb, info, sc, lo, hi) {
  const a = Math.max(0, sc - 1.5);
  const b = Math.min(info.L, sc + 1.5);
  if (b - a < 0.8) return;
  const fr = framesFor(info, sampleRange(info, a, b));
  for (let l = lo; l + 0.5 <= hi + 1e-6; l += 1.0) {
    profileAlong(mb, fr, [[l, LINE_H], [l + 0.5, LINE_H]], WHITE);
  }
}

function railProfile(o) {
  return [[o - 0.035, 0.02], [o - 0.035, 0.16], [o + 0.035, 0.16], [o + 0.035, 0.02]];
}

// Lane-boundary paint between lanes a (left) and b (right) at their shared offset.
function boundaryPaint(a, b, centre) {
  const skip = new Set(['median', 'sidewalk', 'verge', 'path', 'gravel', 'paver', 'rail']);
  if (skip.has(a.kind) || skip.has(b.kind)) return [];
  const opposite = (a.dir === 'back' && b.dir === 'fwd') || (a.dir === 'fwd' && b.dir === 'back');
  if (opposite && DIRECTED.has(a.kind) && DIRECTED.has(b.kind) && (a.kind === 'drive' || a.kind === 'bus') && (b.kind === 'drive' || b.kind === 'bus')) {
    if (centre === 'dashed') return [{ dash: true, dx: 0, color: YELLOW }];
    if (centre === 'solid') return [{ dash: false, dx: 0, color: YELLOW }];
    if (centre === 'double') return [{ dash: false, dx: -0.13, color: YELLOW }, { dash: false, dx: 0.13, color: YELLOW }];
    return [];
  }
  if ((a.kind === 'drive' || a.kind === 'bus') && (b.kind === 'drive' || b.kind === 'bus')) {
    return [{ dash: true, dx: 0, color: WHITE }];
  }
  return [{ dash: false, dx: 0, color: WHITE }];
}

// ------------------------------------------------------------ preparation ----

function prepareEdges(net) {
  const infos = new Map();
  for (const e of Object.values(net.edges)) {
    const D = dense(net, e);
    const lay = layoutLanes(lanesOf(e));
    let halfC = 0;
    for (const ln of lay.lanes) if (ln.carriage) halfC = Math.max(halfC, Math.abs(ln.oL), Math.abs(ln.oR));
    const mid = frameAt(D, D.L / 2);
    const preset = presetOf(e);
    infos.set(e.id, {
      e,
      D,
      L: D.L,
      lay,
      halfC,
      halfF: lay.half,
      kept: keepIndices(D),
      underground: mid.y < -0.5,
      midX: mid.x,
      midZ: mid.z,
      centre: e.center ?? preset.center,
      rail: Boolean(preset.rail),
      hasSidewalk: lay.lanes.some((ln) => ln.kind === 'sidewalk'),
      trimA: 0,
      trimB: 0,
    });
  }
  return infos;
}

// --------------------------------------------------------------- emission ----

function chunkFor(ctx, x, z) {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const key = `${cx},${cz}`;
  let c = ctx.chunks.get(key);
  if (!c) {
    c = { key, cx, cz, surface: new MeshBuilder(), markings: new MeshBuilder(), props: new MeshBuilder(), underground: new MeshBuilder() };
    ctx.chunks.set(key, c);
  }
  return c;
}

function emitEdge(ctx, info, propsHere) {
  const { D, L, lay } = info;
  const s0 = info.trimA;
  const s1 = L - info.trimB;
  const under = info.underground;
  const chunk = chunkFor(ctx, info.midX, info.midZ);
  const surf = under ? chunk.underground : chunk.surface;
  const mark = under ? chunk.underground : chunk.markings;
  const prop = under ? chunk.underground : chunk.props;
  const lanes = lay.lanes;
  ctx.stats.edges += 1;

  // Full-length rails (not trimmed by junctions) and the rail ties.
  if (info.rail || lanes.some((ln) => ln.kind === 'rail' || ln.kind === 'tram')) {
    const full = framesFor(info, sampleRange(info, 0, L));
    for (const ln of lanes) {
      if (ln.kind !== 'rail' && ln.kind !== 'tram') continue;
      const c = (ln.oL + ln.oR) / 2;
      const off = ln.kind === 'rail' ? 0.72 : 0.7;
      for (const o of [c - off, c + off]) profileAlong(surf, full, railProfile(o), STEEL, true);
      if (ln.kind === 'rail') {
        for (let s = TIE_SPACING / 2; s < L; s += TIE_SPACING) {
          const f = frameAt(D, s);
          box(surf, [f.x, f.y + 0.07, f.z], [f.tx, 0, f.tz], [0, 1, 0], [f.nx, 0, f.nz], [0.13, 0.06, 1.3], WOOD);
        }
      }
    }
  }
  if (s1 - s0 < 0.3) return;

  const sList = sampleRange(info, s0, s1);
  const fr = framesFor(info, sList);

  // Lane surfaces, then kerbs where neighbouring lanes have different heights.
  for (const ln of lanes) {
    if (ln.kind === 'rail') continue; // ballast is drawn below; keep rails visible
    profileAlong(surf, fr, [[ln.oL, ln.raise], [ln.oR, ln.raise]], ln.color);
  }
  for (let i = 0; i < lanes.length - 1; i += 1) {
    const a = lanes[i];
    const b = lanes[i + 1];
    if (a.raise === b.raise) continue;
    const high = a.raise > b.raise ? a : b;
    const lo = Math.min(a.raise, b.raise);
    profileAlong(surf, fr, [[a.oR, lo], [a.oR, high.raise]], curbColor(high.color));
  }
  if (lanes[0].raise > 0) profileAlong(surf, fr, [[lanes[0].oL, ROAD_DROP], [lanes[0].oL, lanes[0].raise]], curbColor(lanes[0].color));
  const last = lanes[lanes.length - 1];
  if (last.raise > 0) profileAlong(surf, fr, [[last.oR, ROAD_DROP], [last.oR, last.raise]], curbColor(last.color));
  // Ballast under rails, drawn on the trimmed surface like any other lane.
  for (const ln of lanes) {
    if (ln.kind === 'rail') profileAlong(surf, fr, [[ln.oL, 0], [ln.oR, 0]], ln.color);
  }

  // Bridge decks: parapets and piers wherever the deck is above ground.
  if (fr.some((f) => f.y > 0.5)) {
    const half = info.halfF;
    const hgt = (f) => (f.y > 0.5 ? 0.9 : 0);
    profileAlong(surf, fr, (f) => [[half, 0], [half, hgt(f)]], CONCRETE);
    profileAlong(surf, fr, (f) => [[-half, 0], [-half, hgt(f)]], CONCRETE);
    for (let s = PIER_SPACING / 2; s < L; s += PIER_SPACING) {
      if (s < s0 || s > s1) continue;
      const f = frameAt(D, s);
      if (f.y <= 1.2) continue;
      const top = f.y - 0.6;
      box(prop, [f.x, top / 2, f.z], [f.tx, 0, f.tz], [0, 1, 0], [f.nx, 0, f.nz], [0.9, Math.max(top / 2, 0.05), 0.9], CONCRETE);
    }
  }

  // Lane paint.
  const h = LINE_H;
  const solidLine = (o, w, frames) => profileAlong(mark, frames, [[o - w / 2, h], [o + w / 2, h]], WHITE);
  for (let i = 0; i < lanes.length - 1; i += 1) {
    const a = lanes[i];
    const b = lanes[i + 1];
    for (const line of boundaryPaint(a, b, info.centre)) {
      const color = line.color;
      const w = 0.12;
      const o = a.oR + line.dx;
      if (line.dash) {
        for (let x = s0; x < s1; x += 12) {
          const xb = Math.min(x + 3, s1);
          if (xb - x < 0.5) continue;
          profileAlong(mark, framesFor(info, sampleRange(info, x, xb)), [[o - w / 2, h], [o + w / 2, h]], color);
        }
      } else {
        profileAlong(mark, fr, [[o - w / 2, h], [o + w / 2, h]], color);
      }
    }
  }
  for (const ln of lanes) {
    if (ln.kind !== 'parking') continue;
    for (let x = s0 + 1; x < s1 - 1; x += 6) {
      profileAlong(mark, framesFor(info, [x - 0.08, x + 0.08]), [[ln.oL - 0.02, h], [ln.oR + 0.02, h]], WHITE);
    }
  }

  // Street furniture placed on this road.
  for (const p of propsHere) emitProp(ctx, info, p, { prop, mark, chunk });
}

function emitProp(ctx, info, p, buckets) {
  const { D, L, lay } = info;
  const propBucket = buckets.prop;
  const chunk = buckets.chunk;
  const span = crossingSpan(lay);
  switch (p.type) {
    case 'bollard': {
      const len = p.len ?? 0;
      const lat = p.lat ?? info.halfC + 0.5;
      const spacing = p.spacing ?? 1.5;
      for (let s = p.s; s <= p.s + len + 1e-6 && s <= L; s += spacing) {
        const f = frameAt(D, s);
        prism(propBucket, [f.x + f.nx * lat, f.y, f.z + f.nz * lat], 0.12, 0.9, 8, BOLLARD);
      }
      ctx.stats.props += 1;
      break;
    }
    case 'speedbump': {
      const sc = p.s;
      if (!span || sc - 1.8 < 0 || sc + 1.8 > L) return;
      const sList = [sc - 1.8, sc - 1.2, sc - 0.6, sc, sc + 0.6, sc + 1.2, sc + 1.8];
      profileAlong(propBucket, framesFor(info, sList), (f) => {
        const hgt = bumpHeight(f.s - sc);
        return [[span.lo, hgt], [span.hi, hgt]];
      }, YELLOW);
      ctx.stats.props += 1;
      break;
    }
    case 'crosswalk': {
      const sc = p.s;
      if (!span) return;
      for (const g of crossingGroups(lay)) zebra(buckets.mark, info, sc, g.lo, g.hi);
      ctx.stats.props += 1;
      break;
    }
    case 'railcrossing': {
      const sc = p.s;
      if (!span || sc < 2 || sc > L - 2) return;
      const lo = span.lo - 0.7;
      const hi = span.hi + 0.7;
      for (const lat of [lo, hi]) {
        const f = frameAt(D, sc);
        const base = [f.x + f.nx * lat, f.y, f.z + f.nz * lat];
        const ax = [f.tx, 0, f.tz];
        const ay = [0, 1, 0];
        const az = [f.nx, 0, f.nz];
        box(propBucket, [base[0], base[1] + 1.6, base[2]], ax, ay, az, [0.12, 1.6, 0.12], RED);
        box(propBucket, [base[0], base[1] + 3.3, base[2]], ax, ay, az, [0.12, 0.2, 0.12], WHITE);
      }
      const segs = 6;
      const w = (hi - lo) / segs;
      const f = frameAt(D, sc);
      for (let i = 0; i < segs; i += 1) {
        const lc = lo + (i + 0.5) * w;
        const c = [f.x + f.nx * lc, f.y + 1.2, f.z + f.nz * lc];
        box(propBucket, c, [f.nx, 0, f.nz], [0, 1, 0], [f.tx, 0, f.tz], [w / 2, 0.08, 0.08], i % 2 ? WHITE : RED);
      }
      ctx.stats.props += 1;
      break;
    }
    case 'station': {
      const sc = p.s;
      const f = frameAt(D, Math.min(Math.max(sc, 0), L));
      const lat = info.halfF + 3.5;
      const c = [f.x + f.nx * lat, 1.3, f.z + f.nz * lat];
      const ax = [f.tx, 0, f.tz];
      const az = [f.nx, 0, f.nz];
      box(chunk.props, c, ax, [0, 1, 0], az, [2.0, 1.3, 1.4], KIOSK);
      box(chunk.props, [c[0], 2.8, c[2]], ax, [0, 1, 0], az, [2.4, 0.12, 1.8], ROOF);
      ctx.stats.props += 1;
      break;
    }
    default:
      break;
  }
}

// Junction fills, stop lines, arrows and crossings at a node.
function emitJunction(ctx, node, arms, deg) {
  const under = node.y < -0.5;
  const chunk = chunkFor(ctx, node.x, node.z);
  const surf = under ? chunk.underground : chunk.surface;
  const mark = under ? chunk.underground : chunk.markings;
  const carPts = [];
  const outPts = [];
  let carColor = null;
  let outColor = null;
  let anySidewalk = false;
  const armData = arms.map((arm) => {
    const { info, end } = arm;
    const f = frameAt(info.D, end === 'a' ? 0 : info.L);
    const d = end === 'a' ? [f.tx, f.tz] : [-f.tx, -f.tz];
    const n = [d[1], -d[0]];
    const trim = (deg.get(node.id) ?? 0) >= 3 ? info.halfC : 0;
    return { ...arm, d, n, trim };
  });
  for (const a of armData) {
    const { info, d, n, trim } = a;
    if (info.halfC > 0) {
      for (const sgn of [1, -1]) {
        carPts.push([node.x + d[0] * trim + n[0] * info.halfC * sgn, node.z + d[1] * trim + n[1] * info.halfC * sgn]);
      }
      if (!carColor) carColor = info.lay.lanes.find((ln) => ln.carriage)?.color ?? null;
    }
    for (const sgn of [1, -1]) {
      outPts.push([node.x + d[0] * trim + n[0] * info.halfF * sgn, node.z + d[1] * trim + n[1] * info.halfF * sgn]);
    }
    if (info.hasSidewalk) anySidewalk = true;
    if (!outColor) outColor = info.lay.lanes.find((ln) => !ln.carriage)?.color ?? null;
  }
  const fill = (pts, y, col) => {
    const hull = convexHull(pts);
    if (hull.length < 3 || !col) return;
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const cz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    for (let i = 0; i < hull.length; i += 1) {
      const j = (i + 1) % hull.length;
      surf.tri([hull[i][0], y, hull[i][1]], [hull[j][0], y, hull[j][1]], [cx, y, cz], col);
    }
  };
  // Outer paving (kerbs/footpaths) sits just under the carriageway fill.
  const outerCol = anySidewalk ? SIDEWALK_COLOUR : outColor;
  fill(outPts, node.y - 0.01, outerCol);
  fill(carPts, node.y, carColor);

  if (armData.length < 3) return;
  for (const a of armData) {
    const { info, end, trim } = a;
    if (info.L < trim + 14) continue;
    const sAt = (dn) => (end === 'a' ? dn : info.L - dn);
    const P = (dn, lat) => {
      const f = frameAt(info.D, sAt(dn));
      return pt(f, lat, LINE_H);
    };
    const approach = end === 'a' ? 'back' : 'fwd';
    const approaching = info.lay.lanes.filter((ln) => (ln.kind === 'drive' || ln.kind === 'bus') && ln.dir === approach);
    if (approaching.length) {
      const lo = Math.min(...approaching.map((l) => l.oR));
      const hi = Math.max(...approaching.map((l) => l.oL));
      const sc = sAt(trim + 1.0);
      const fr = framesFor(info, [sc - 0.2, sc + 0.2]);
      profileAlong(mark, fr, [[lo, LINE_H], [hi, LINE_H]], WHITE);
      for (const ln of approaching) {
        const c = (ln.oL + ln.oR) / 2;
        mark.quad(P(trim + 11, c - 0.22), P(trim + 8.5, c - 0.22), P(trim + 8.5, c + 0.22), P(trim + 11, c + 0.22), WHITE);
        mark.tri(P(trim + 8.5, c - 0.9), P(trim + 6.5, c), P(trim + 8.5, c + 0.9), WHITE);
      }
    }
    if (info.hasSidewalk) {
      const sc = sAt(trim + 3.5);
      for (const g of crossingGroups(info.lay)) zebra(mark, info, sc, g.lo, g.hi);
    }
  }
}

function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const uniq = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-7 || Math.abs(p[1] - pts[i - 1][1]) > 1e-7);
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i -= 1) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// ------------------------------------------------------------ public API -----

// Build all road geometry for a network.
// Returns { chunks: [{key,cx,cz,surface,markings,props,underground}], stats }
// where each layer is null or {position, normal, color, triangles}.
export function buildNetworkMeshes(net) {
  const infos = prepareEdges(net);
  const deg = degrees(net);
  for (const info of infos.values()) {
    const { e } = info;
    info.trimA = (deg.get(e.a) ?? 0) >= 3 ? info.halfC : 0;
    info.trimB = (deg.get(e.b) ?? 0) >= 3 ? info.halfC : 0;
  }
  const propsByEdge = new Map();
  for (const p of Object.values(net.props)) {
    if (!propsByEdge.has(p.edge)) propsByEdge.set(p.edge, []);
    propsByEdge.get(p.edge).push(p);
  }
  const ctx = {
    chunks: new Map(),
    stats: { edges: 0, nodes: Object.keys(net.nodes).length, junctions: 0, props: 0 },
  };
  for (const info of infos.values()) {
    emitEdge(ctx, info, propsByEdge.get(info.e.id) ?? []);
  }
  const armsByNode = new Map();
  for (const info of infos.values()) {
    const { e } = info;
    if (!armsByNode.has(e.a)) armsByNode.set(e.a, []);
    armsByNode.get(e.a).push({ info, end: 'a' });
    if (!armsByNode.has(e.b)) armsByNode.set(e.b, []);
    armsByNode.get(e.b).push({ info, end: 'b' });
  }
  for (const node of Object.values(net.nodes)) {
    const arms = armsByNode.get(node.id) ?? [];
    if (arms.length < 2) continue;
    if ((deg.get(node.id) ?? 0) >= 3) ctx.stats.junctions += 1;
    emitJunction(ctx, node, arms, deg);
  }
  const chunks = [...ctx.chunks.values()].map((c) => ({
    key: c.key,
    cx: c.cx,
    cz: c.cz,
    surface: c.surface.toBuffers(),
    markings: c.markings.toBuffers(),
    props: c.props.toBuffers(),
    underground: c.underground.toBuffers(),
  }));
  let triangles = 0;
  for (const c of chunks) {
    for (const k of ['surface', 'markings', 'props', 'underground']) if (c[k]) triangles += c[k].triangles;
  }
  return { chunks, stats: { ...ctx.stats, props: Object.keys(net.props).length, chunks: chunks.length, triangles } };
}

// Lateral/vertical samples of one edge for the picker and inspector.
export function edgeSamples(net, edge, step = 4) {
  const D = dense(net, edge);
  const out = [];
  for (let i = 0; i < D.x.length; i += step) out.push({ x: D.x[i], y: D.y[i], z: D.z[i], s: D.s[i] });
  return out;
}

// Re-export helpers used by the UI.
export { incidentEdges, ctrl };
