// Road mesh generation (pure JS, no three.js).
//
// buildRoadBuckets(road, centerline, trim) -> { asphalt, paving, plain, marking, ghost, mask }
// Each bucket is { p, n, uv, c, i } flat arrays: positions, normals, uv (metres),
// sRGB vertex colours (0..1) and triangle indices. The renderer converts these
// into BufferGeometry; tests inspect them directly.
//
// Conventions: y is up, road base height is poly.h (0 for surface roads, > 0 on
// bridges, < 0 underground). Lanes are ribbons whose top is at base + lane.elev.

import { LANE_KINDS, roadKindOf, lanesOf, laneOffsets, laneInfo } from './lanes.js';
import { slicePoly, pointAt } from './centerline.js';
import { hexToRgb, clamp, smooth01 } from './math.js';
import { resolveS } from './props.js';

export const BUCKETS = ['asphalt', 'paving', 'plain', 'marking', 'ghost', 'mask'];

export const PALETTE = {
  curb: '#c9cbcd',
  barrier: '#a9adb0',
  concrete: '#9a9da0',
  white: '#f5f5f0',
  yellow: '#f2c230',
  steel: '#8e959c',
  poleDark: '#3d434b',
  lampHead: '#f1ebc9',
  bollard: '#f0bf2a',
  rail: '#a3aab1',
  sleeper: '#5f4c3b',
  plank: '#6d5b49',
  bump: '#d8c155',
  gateArm: '#f4f4f0',
  gateRed: '#d6392e',
  roof: '#7d8b99',
  trench: '#101216',
  pad: LANE_KINDS.drive.color,
};

const JERSEY = [[-0.4, 0], [0.4, 0], [0.2, 0.8], [-0.2, 0.8]];
const PARAPET = [[-0.15, 0], [0.15, 0], [0.15, 0.9], [-0.15, 0.9]];

export function emptyBuckets() {
  const out = {};
  for (const name of BUCKETS) out[name] = { p: [], n: [], uv: [], c: [], i: [] };
  return out;
}

function vtx(M, x, y, z, nx, ny, nz, u, v, c) {
  const k = M.p.length / 3;
  M.p.push(x, y, z);
  M.n.push(nx, ny, nz);
  M.uv.push(u, v);
  M.c.push(c[0], c[1], c[2]);
  return k;
}

/** Vertical or horizontal quad with explicit normal. P = four [x,y,z] corners in order. */
function quadN(M, P, nrm, c) {
  const base = M.p.length / 3;
  for (const q of P) vtx(M, q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], 0, 0, c);
  M.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Horizontal/sloped strip between offsets offA..offB along a poly. uv = (metres across, metres along). */
function ribbon(M, poly, offA, offB, elev, c, o = {}) {
  const n = poly.n;
  const lift = o.lift || 0;
  const ny = o.ny ?? 1;
  const base = M.p.length / 3;
  for (let i = 0; i < n; i++) {
    const e = typeof elev === 'number' ? elev : elev[i];
    const y = poly.h[i] + e + lift;
    const x = poly.x[i];
    const z = poly.z[i];
    const nx = poly.nx[i];
    const nz = poly.nz[i];
    vtx(M, x + nx * offA, y, z + nz * offA, 0, ny, 0, offA, poly.s[i], c);
    vtx(M, x + nx * offB, y, z + nz * offB, 0, ny, 0, offB, poly.s[i], c);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i;
    M.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

/** Vertical face at offset `off`, from yBot[] to yTop[] (absolute heights). side = +1 faces +normal. */
function wall(M, poly, off, yBot, yTop, side, c) {
  const n = poly.n;
  for (let i = 0; i < n - 1; i++) {
    const a = [poly.x[i] + poly.nx[i] * off, poly.z[i] + poly.nz[i] * off];
    const b = [poly.x[i + 1] + poly.nx[i + 1] * off, poly.z[i + 1] + poly.nz[i + 1] * off];
    const nrm = [poly.nx[i] * side, 0, poly.nz[i] * side];
    quadN(M, [
      [a[0], yBot[i], a[1]],
      [b[0], yBot[i + 1], b[1]],
      [b[0], yTop[i + 1], b[1]],
      [a[0], yTop[i], a[1]],
    ], nrm, c);
  }
}

/** Extruded profile along the poly. prof = [[lat, yRel], ...] CCW in (lat, y). */
function prism(M, poly, prof, yBase, centerOff, c) {
  const n = poly.n;
  const m = prof.length;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const [l1, y1] = prof[k];
      const [l2, y2] = prof[k2];
      const dl = l2 - l1;
      const dy = y2 - y1;
      const len = Math.hypot(dl, dy) || 1;
      // Outward normal of a CCW profile edge in (lat, y) is (dy, -dl).
      const nl = dy / len;
      const ny = -dl / len;
      const nrm = [poly.nx[i] * nl, ny, poly.nz[i] * nl];
      const corner = (idx, lat, yr) => {
        const L = centerOff + lat;
        return [poly.x[idx] + poly.nx[idx] * L, yBase[idx] + yr, poly.z[idx] + poly.nz[idx] * L];
      };
      quadN(M, [corner(i, l1, y1), corner(i + 1, l1, y1), corner(i + 1, l2, y2), corner(i, l2, y2)], nrm, c);
    }
  }
}

/** Axis-aligned box in a local frame: T (tangent), N (normal), Y (up); hs = half sizes. */
function box(M, p, T, N, Y, hs, c) {
  const axes = [T, N, Y];
  for (let f = 0; f < 3; f++) {
    const F = axes[f];
    const U = axes[(f + 1) % 3];
    const V = axes[(f + 2) % 3];
    const hF = hs[f];
    const hU = hs[(f + 1) % 3];
    const hV = hs[(f + 2) % 3];
    for (const sg of [-1, 1]) {
      const cx = p[0] + F[0] * hF * sg;
      const cy = p[1] + F[1] * hF * sg;
      const cz = p[2] + F[2] * hF * sg;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
        cx + U[0] * hU * a + V[0] * hV * b,
        cy + U[1] * hU * a + V[1] * hV * b,
        cz + U[2] * hU * a + V[2] * hV * b,
      ]);
      quadN(M, corners, [F[0] * sg, F[1] * sg, F[2] * sg], c);
    }
  }
}

function cylinder(M, x, y0, z, r, h, seg, c) {
  const base = M.p.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    vtx(M, x + cx * r, y0, z + sz * r, cx, 0, sz, 0, 0, c);
    vtx(M, x + cx * r, y0 + h, z + sz * r, cx, 0, sz, 0, 1, c);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + 2 * i;
    M.i.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const top = vtx(M, x, y0 + h, z, 0, 1, 0, 0, 0, c);
  const ring = M.p.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    vtx(M, x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r, 0, 1, 0, 0, 0, c);
  }
  for (let i = 0; i < seg; i++) M.i.push(top, ring + i, ring + i + 1);
}

/** Thin bar across the road at arc length s (lateral lo..hi, along-road thickness). */
function transverseBar(M, cl, s, lo, hi, thick, lift, c) {
  const p = pointAt(cl, s);
  const y = p.h + lift;
  const at = (lat, along) => [p.x + p.nx * lat + p.tx * along, y, p.z + p.nz * lat + p.tz * along];
  quadN(M, [at(lo, -thick / 2), at(hi, -thick / 2), at(hi, thick / 2), at(lo, thick / 2)], [0, 1, 0], c);
}

const rel = (poly, v) => Float64Array.from(poly.h, (h) => h + v);
const constArr = (n, v) => new Float64Array(n).fill(v);

function laneLine(M, poly, off, width, c, style) {
  const lift = 0.05;
  if (style === 'dashed') {
    const a0 = poly.s[0];
    const a1 = poly.s[poly.n - 1];
    for (let a = a0; a < a1 - 0.5; a += 12) {
      const sub = slicePoly(poly, a, Math.min(a1, a + 3));
      if (sub) ribbon(M, sub, off - width / 2, off + width / 2, 0, c, { lift });
    }
  } else {
    ribbon(M, poly, off - width / 2, off + width / 2, 0, c, { lift });
  }
}

const DRIVE_LIKE = new Set(['drive', 'bus', 'bike', 'shoulder']);

function markRoad(B, kind, lanes, offs, poly) {
  const white = hexToRgb(PALETTE.white);
  const yellow = hexToRgb(PALETTE.yellow);
  const M = B.marking;
  const infos = lanes.map(laneInfo);
  for (let j = 0; j < lanes.length - 1; j++) {
    const A = lanes[j];
    const C = lanes[j + 1];
    const iA = infos[j];
    const iC = infos[j + 1];
    if (iA.elev !== iC.elev) continue; // a curb separates them: no paint
    const off = offs[j + 1];
    if (A.kind === 'drive' && C.kind === 'drive') {
      if (Math.abs(off) < 0.05) {
        if (kind.center === 'dashed') laneLine(M, poly, off, 0.12, yellow, 'dashed');
        else if (kind.center === 'solid') laneLine(M, poly, off, 0.12, yellow, 'solid');
      } else {
        laneLine(M, poly, off, 0.12, white, 'dashed');
      }
      continue;
    }
    if (iA.drivable && iC.drivable) laneLine(M, poly, off, 0.12, white, 'solid');
  }
  if (kind.edges) {
    const first = lanes[0];
    const last = lanes[lanes.length - 1];
    if (laneInfo(first).drivable && laneInfo(first).elev === 0) laneLine(M, poly, offs[0] + 0.25, 0.12, white, 'solid');
    if (laneInfo(last).drivable && laneInfo(last).elev === 0) laneLine(M, poly, offs[lanes.length] - 0.25, 0.12, white, 'solid');
  }
  // Parking bays: transverse lines every 6 m across each parking lane.
  for (let j = 0; j < lanes.length; j++) {
    if (lanes[j].kind !== 'parking') continue;
    for (let s = poly.s[0] + 3; s < poly.s[poly.n - 1] - 1; s += 6) {
      transverseBar(M, poly, s, offs[j], offs[j + 1], 0.12, 0.05, white);
    }
  }
}

function emitRails(B, poly) {
  const steel = hexToRgb(PALETTE.rail);
  for (const o of [-0.7175, 0.7175]) ribbon(B.plain, poly, o - 0.075, o + 0.075, 0.09, steel);
  const sleeper = hexToRgb(PALETTE.sleeper);
  for (let s = poly.s[0] + 0.3; s < poly.s[poly.n - 1]; s += 0.65) {
    const p = pointAt(poly, s);
    box(B.plain, [p.x, p.h + 0.07, p.z], [p.tx, 0, p.tz], [p.nx, 0, p.nz], [0, 1, 0], [0.13, 1.35, 0.06], sleeper);
  }
}

function emitBridge(B, poly, offs, lanes, kind, W) {
  const concrete = hexToRgb(PALETTE.concrete);
  ribbon(B.plain, poly, offs[0], offs[lanes.length], -0.6, concrete, { ny: -1 });
  wall(B.plain, poly, offs[0], rel(poly, -0.6), rel(poly, 0), -1, concrete);
  wall(B.plain, poly, offs[lanes.length], rel(poly, -0.6), rel(poly, 0), 1, concrete);
  if (kind.group !== 'rail') {
    prism(B.plain, poly, PARAPET, rel(poly, 0), offs[0], concrete);
    prism(B.plain, poly, PARAPET, rel(poly, 0), offs[lanes.length], concrete);
  }
  const lateral = W < 8 ? [0] : [-(W / 2 - 2), W / 2 - 2];
  for (let s = poly.s[0] + 11; s < poly.s[poly.n - 1] - 4; s += 22) {
    const p = pointAt(poly, s);
    if (p.h < 1.0) continue;
    const top = p.h - 0.6;
    const bottom = -0.5;
    for (const lat of lateral) {
      const x = p.x + p.nx * lat;
      const z = p.z + p.nz * lat;
      box(B.plain, [x, (top + bottom) / 2, z], [p.tx, 0, p.tz], [p.nx, 0, p.nz], [0, 1, 0], [0.9, 0.6, (top - bottom) / 2], concrete);
    }
  }
}

function emitUnderground(B, poly, offs, lanes, roof) {
  const concrete = hexToRgb(PALETTE.concrete);
  const left = offs[0] - 0.5;
  const right = offs[lanes.length] + 0.5;
  // The ground plane is masked over the trench footprint (see render/world.js).
  ribbon(B.mask, poly, left, right, Float64Array.from(poly.h, (h) => -h), [0, 0, 0]);
  wall(B.plain, poly, left, rel(poly, -0.3), constArr(poly.n, 0), 1, concrete);
  wall(B.plain, poly, right, rel(poly, -0.3), constArr(poly.n, 0), -1, concrete);
  if (roof) {
    ribbon(B.ghost, poly, left, right, Float64Array.from(poly.h, (h) => 0.03 - h), hexToRgb(PALETTE.roof));
  }
}

function endCaps(M, poly, offs, lanes, elevs) {
  const c = hexToRgb(PALETTE.curb);
  for (let i = 0; i < lanes.length; i++) {
    const e = elevs[i];
    if (e <= 0) continue;
    const at = (idx, lat, y) => [poly.x[idx] + poly.nx[idx] * lat, poly.h[idx] + y, poly.z[idx] + poly.nz[idx] * lat];
    const tS = [poly.tx[0], 0, poly.tz[0]];
    const last = poly.n - 1;
    const tE = [poly.tx[last], 0, poly.tz[last]];
    quadN(M, [at(0, offs[i], 0), at(0, offs[i + 1], 0), at(0, offs[i + 1], e), at(0, offs[i], e)], [-tS[0], 0, -tS[2]], c);
    quadN(M, [at(last, offs[i], 0), at(last, offs[i + 1], 0), at(last, offs[i + 1], e), at(last, offs[i], e)], tE, c);
  }
}

/** Cross-section extents of the carriageway (drive, bus, bike, shoulder lanes). */
function carriagewayExtent(lanes, offs) {
  let lo = Infinity;
  let hi = -Infinity;
  lanes.forEach((l, i) => {
    if (DRIVE_LIKE.has(l.kind)) {
      lo = Math.min(lo, offs[i]);
      hi = Math.max(hi, offs[i + 1]);
    }
  });
  return Number.isFinite(lo) ? [lo, hi] : [offs[0], offs[lanes.length]];
}

function emitProps(B, road, cl, trim, lanes, offs) {
  const L = cl.s[cl.n - 1];
  const bLo = offs[0];
  const bHi = offs[lanes.length];
  const [dLo, dHi] = carriagewayExtent(lanes, offs);
  const firstDrive = lanes.findIndex((l) => laneInfo(l).drivable);
  const defaultEdge = firstDrive >= 0 ? offs[firstDrive] + 0.35 : bLo + 0.35;
  const white = hexToRgb(PALETTE.white);

  for (const prop of road.props || []) {
    switch (prop.kind) {
      case 'speedBump': {
        const sc = resolveS(prop, L, trim);
        const sub = slicePoly(cl, sc - 1.8, sc + 1.8);
        if (!sub) break;
        const H = prop.height || 0.09;
        const elev = Float64Array.from(sub.s, (s) => H * smooth01(clamp((1.8 - Math.abs(s - sc)) / 0.9, 0, 1)));
        ribbon(B.plain, sub, dLo, dHi, elev, hexToRgb(PALETTE.bump));
        break;
      }
      case 'crosswalk': {
        const sc = resolveS(prop, L, trim);
        const half = (prop.length || 4) / 2;
        const sub = slicePoly(cl, sc - half, sc + half);
        if (!sub) break;
        for (let a = dLo; a + 0.6 <= dHi + 1e-6; a += 1.2) ribbon(B.marking, sub, a, a + 0.6, 0, white, { lift: 0.05 });
        break;
      }
      case 'stopLine': {
        const sc = resolveS(prop, L, trim);
        transverseBar(B.marking, cl, sc, dLo, dHi, 0.45, 0.05, white);
        break;
      }
      case 'railCrossing': {
        const sc = resolveS(prop, L, trim);
        const rails = hexToRgb(PALETTE.rail);
        for (const o of [-0.72, 0.72]) transverseBar(B.plain, cl, sc + o, bLo, bHi, 0.16, 0.05, rails);
        transverseBar(B.plain, cl, sc, bLo, bHi, 1.2, 0.02, hexToRgb(PALETTE.plank));
        const pole = hexToRgb(PALETTE.poleDark);
        const arm = hexToRgb(PALETTE.gateArm);
        const red = hexToRgb(PALETTE.gateRed);
        const ps = sc - 1.4;
        const p = pointAt(cl, ps);
        for (const lat of [bLo - 0.7, bHi + 0.7]) {
          const px = p.x + p.nx * lat;
          const pz = p.z + p.nz * lat;
          cylinder(B.plain, px, p.h, pz, 0.09, 1.3, 8, pole);
          box(B.plain, [px, p.h + 1.35, pz], [p.tx, 0, p.tz], [p.nx, 0, p.nz], [0, 1, 0], [0.14, 0.14, 0.14], red);
          if (prop.closed !== false) {
            const half = Math.abs(lat) / 2;
            const mid = -lat / 2;
            box(B.plain, [p.x + p.nx * mid, p.h + 1.1, p.z + p.nz * mid], [p.tx, 0, p.tz], [p.nx, 0, p.nz], [0, 1, 0], [0.07, half, 0.07], arm);
          }
        }
        break;
      }
      case 'bollards': {
        const s0 = prop.s0 ?? trim.start;
        const s1 = prop.s1 ?? L - trim.end;
        const lat = prop.offset ?? defaultEdge;
        const spacing = Math.max(0.4, prop.spacing || 1.2);
        let count = 0;
        for (let s = s0; s <= s1 && count < 4000; s += spacing, count++) {
          const p = pointAt(cl, s);
          cylinder(B.plain, p.x + p.nx * lat, p.h, p.z + p.nz * lat, 0.12, 0.9, 8, hexToRgb(PALETTE.bollard));
        }
        break;
      }
      case 'lamps': {
        const s0 = prop.s0 ?? trim.start;
        const s1 = prop.s1 ?? L - trim.end;
        const spacing = Math.max(5, prop.spacing || 30);
        const sides = prop.offset !== undefined ? [prop.offset] : [bLo + 0.8, bHi - 0.8];
        const pole = hexToRgb(PALETTE.poleDark);
        const head = hexToRgb(PALETTE.lampHead);
        let count = 0;
        for (const lat of sides) {
          for (let s = s0 + spacing / 2; s <= s1 && count < 4000; s += spacing, count++) {
            const p = pointAt(cl, s);
            const x = p.x + p.nx * lat;
            const z = p.z + p.nz * lat;
            cylinder(B.plain, x, p.h, z, 0.08, 6.5, 6, pole);
            const inward = lat > 0 ? -0.9 : 0.9;
            box(B.plain, [x + p.nx * inward, p.h + 6.45, z + p.nz * inward], [p.tx, 0, p.tz], [p.nx, 0, p.nz], [0, 1, 0], [0.3, 0.9, 0.08], head);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Builds every bucket for one road.
 * @param {object} road   road record from the model
 * @param {object} cl     full centerline Poly (s starts at 0)
 * @param {{start:number,end:number}} [trim] junction trims at each end
 */
export function buildRoadBuckets(road, cl, trim = { start: 0, end: 0 }) {
  const B = emptyBuckets();
  const kind = roadKindOf(road);
  const lanes = lanesOf(road);
  if (!lanes.length || !cl || cl.n < 2) return B;
  const offs = laneOffsets(lanes);
  const W = offs[lanes.length];
  const closed = !!road.closed;
  const S0 = cl.s[0];
  const S1 = cl.s[cl.n - 1];
  const a = closed ? S0 : S0 + (trim.start || 0);
  const b = closed ? S1 : S1 - (trim.end || 0);
  const poly = slicePoly(cl, a, b);
  if (!poly) return B;
  const mode = road.mode || kind.mode || 'surface';
  const elevs = lanes.map((l) => laneInfo(l).elev);

  // 1. Lane surfaces.
  lanes.forEach((lane, i) => {
    const info = laneInfo(lane);
    if (!(lane.width > 0)) return;
    ribbon(info.surface === 'paving' ? B.paving : B.asphalt, poly, offs[i], offs[i + 1], info.elev, hexToRgb(info.color));
  });

  // 2. Curbs where neighbouring lanes sit at different heights.
  const curb = hexToRgb(PALETTE.curb);
  for (let j = 0; j < lanes.length - 1; j++) {
    const e1 = elevs[j];
    const e2 = elevs[j + 1];
    if (e1 === e2) continue;
    const yBot = rel(poly, Math.min(e1, e2));
    const yTop = rel(poly, Math.max(e1, e2));
    wall(B.plain, poly, offs[j + 1], yBot, yTop, e1 > e2 ? 1 : -1, curb);
  }
  if (elevs[0] > 0) wall(B.plain, poly, offs[0], rel(poly, -0.4), rel(poly, elevs[0]), -1, curb);
  if (elevs[lanes.length - 1] > 0) wall(B.plain, poly, offs[lanes.length], rel(poly, -0.4), rel(poly, elevs[lanes.length - 1]), 1, curb);
  if (!closed) endCaps(B.plain, poly, offs, lanes, elevs);

  // 3. Barriers on lanes flagged `barrier` (highway medians).
  const barrierColor = hexToRgb(PALETTE.barrier);
  lanes.forEach((lane, i) => {
    if (!lane.barrier) return;
    prism(B.plain, poly, JERSEY, rel(poly, elevs[i]), offs[i], barrierColor);
    prism(B.plain, poly, JERSEY, rel(poly, elevs[i]), offs[i + 1], barrierColor);
  });

  // 4. Structure: bridge deck or underground trench.
  if (mode === 'bridge') emitBridge(B, poly, offs, lanes, kind, W);
  if (mode === 'underground') emitUnderground(B, poly, offs, lanes, !!road.roof);

  // 5. Rails (railway / subway kinds).
  if (kind.rails) emitRails(B, poly);

  // 6. Paint.
  if (kind.group !== 'rail') markRoad(B, kind, lanes, offs, poly);

  // 7. Props.
  emitProps(B, road, cl, trim, lanes, offs);

  return B;
}

/** Junction pad: flat asphalt polygon [[x,z],...] at ground level. */
export function buildPadBuckets(hull, y = 0.02) {
  const B = emptyBuckets();
  if (!hull || hull.length < 3) return B;
  const M = B.asphalt;
  const c = hexToRgb(PALETTE.pad);
  let cx = 0;
  let cz = 0;
  for (const [x, z] of hull) {
    cx += x;
    cz += z;
  }
  cx /= hull.length;
  cz /= hull.length;
  const centre = vtx(M, cx, y, cz, 0, 1, 0, cx, cz, c);
  const first = M.p.length / 3;
  for (const [x, z] of hull) vtx(M, x, y, z, 0, 1, 0, x, z, c);
  for (let k = 0; k < hull.length; k++) M.i.push(centre, first + k, first + ((k + 1) % hull.length));
  return B;
}

