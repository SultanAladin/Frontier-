// Centerline sampling. A road is a list of control points (x, z, h) that a
// uniform Catmull-Rom spline passes through. We resample it into a dense "Poly"
// (~1 m apart) with arc length `s`, unit tangents and left normals. Every other
// part of the kernel (lanes, markings, props, junctions) works on Polys.
//
// Poly = { n, x, z, h, s, tx, tz, nx, nz, closed } with typed arrays.
// For a full centerline s[0] === 0. Slices keep absolute s values so props and
// markings can address the road in its own coordinate system.

import { catmullRom, smooth01, clamp, lerp } from './math.js';

function isStraight(p0, p1, p2, p3) {
  const ax = p2.x - p1.x;
  const az = p2.z - p1.z;
  const L = Math.hypot(ax, az) || 1;
  const off = (p) => Math.abs((p.x - p1.x) * az - (p.z - p1.z) * ax) / L;
  return off(p0) < 0.02 && off(p3) < 0.02;
}

function fromArrays(x, z, h, s, tx, tz, closed) {
  const n = x.length;
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    nx[i] = -tz[i];
    nz[i] = tx[i];
  }
  return { n, x, z, h, s, tx, tz, nx, nz, closed: !!closed };
}

/**
 * @param {Array<{x:number,z:number,h?:number}>} points control points
 * @param {{closed?:boolean, step?:number}} [opts]
 */
export function sampleCenterline(points, { closed = false, step = 1 } = {}) {
  const n = points.length;
  if (n < 2) return fromArrays(new Float64Array(0), new Float64Array(0), new Float64Array(0), new Float64Array(0), new Float64Array(0), new Float64Array(0), closed);
  const xs = [];
  const zs = [];
  const hs = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    let p0;
    let p3;
    if (closed) {
      p0 = points[(i - 1 + n) % n];
      p3 = points[(i + 2) % n];
    } else {
      p0 = i > 0 ? points[i - 1] : { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z };
      p3 = i + 2 < n ? points[i + 2] : { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z };
    }
    const h1 = p1.h || 0;
    const h2 = p2.h || 0;
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    // Straight spans (all four control points collinear) need far fewer samples;
    // curved spans keep the requested resolution.
    const straight = isStraight(p0, p1, p2, p3);
    const k = Math.max(1, Math.ceil(len / (straight ? Math.max(step, 6) : step)));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      xs.push(catmullRom(p0.x, p1.x, p2.x, p3.x, t));
      zs.push(catmullRom(p0.z, p1.z, p2.z, p3.z, t));
      hs.push(lerp(h1, h2, smooth01(t)));
    }
  }
  if (closed) {
    // Repeat the first point so a closed ribbon seals without a gap.
    xs.push(points[0].x);
    zs.push(points[0].z);
    hs.push(points[0].h || 0);
  } else {
    xs.push(points[n - 1].x);
    zs.push(points[n - 1].z);
    hs.push(points[n - 1].h || 0);
  }

  // Drop consecutive duplicates (zero-length segments break tangents).
  const X = [];
  const Z = [];
  const H = [];
  for (let i = 0; i < xs.length; i++) {
    const m = X.length;
    if (m && Math.hypot(xs[i] - X[m - 1], zs[i] - Z[m - 1]) < 1e-6) continue;
    X.push(xs[i]);
    Z.push(zs[i]);
    H.push(hs[i]);
  }
  const m = X.length;
  const S = new Float64Array(m);
  for (let i = 1; i < m; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  const TX = new Float64Array(m);
  const TZ = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let a;
    let b;
    if (closed && m > 2) {
      a = i > 0 ? i - 1 : m - 2;
      b = i < m - 1 ? i + 1 : 1;
    } else {
      a = Math.max(0, i - 1);
      b = Math.min(m - 1, i + 1);
    }
    const dx = X[b] - X[a];
    const dz = Z[b] - Z[a];
    const l = Math.hypot(dx, dz) || 1;
    TX[i] = dx / l;
    TZ[i] = dz / l;
  }
  return fromArrays(Float64Array.from(X), Float64Array.from(Z), Float64Array.from(H), S, TX, TZ, closed);
}

/** Arc length between the first and last sample. */
export function polyLength(p) {
  return p.n ? p.s[p.n - 1] - p.s[0] : 0;
}

/** Interpolated frame at arc length s (clamped to the poly's range). */
export function pointAt(p, s) {
  const S = p.s;
  const n = p.n;
  const sv = clamp(s, S[0], S[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= sv) lo = mid;
    else hi = mid;
  }
  const d = S[lo + 1] - S[lo];
  const f = d > 1e-12 ? (sv - S[lo]) / d : 0;
  const x = lerp(p.x[lo], p.x[lo + 1], f);
  const z = lerp(p.z[lo], p.z[lo + 1], f);
  const h = lerp(p.h[lo], p.h[lo + 1], f);
  let tx = lerp(p.tx[lo], p.tx[lo + 1], f);
  let tz = lerp(p.tz[lo], p.tz[lo + 1], f);
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  return { x, z, h, s: sv, tx, tz, nx: -tz, nz: tx };
}

/** Sub-poly between arc lengths a..b (absolute s kept). Null if too short. */
export function slicePoly(p, a, b) {
  if (!p || p.n < 2) return null;
  const S0 = p.s[0];
  const S1 = p.s[p.n - 1];
  const from = clamp(a, S0, S1);
  const to = clamp(b, S0, S1);
  if (to - from < 0.2) return null;
  const st = pointAt(p, from);
  const en = pointAt(p, to);
  const x = [st.x];
  const z = [st.z];
  const h = [st.h];
  const s = [from];
  const tx = [st.tx];
  const tz = [st.tz];
  for (let i = 0; i < p.n; i++) {
    const si = p.s[i];
    if (si <= from || si >= to) continue;
    x.push(p.x[i]);
    z.push(p.z[i]);
    h.push(p.h[i]);
    s.push(si);
    tx.push(p.tx[i]);
    tz.push(p.tz[i]);
  }
  x.push(en.x);
  z.push(en.z);
  h.push(en.h);
  s.push(to);
  tx.push(en.tx);
  tz.push(en.tz);
  return fromArrays(Float64Array.from(x), Float64Array.from(z), Float64Array.from(h), Float64Array.from(s), Float64Array.from(tx), Float64Array.from(tz), p.closed);
}

/** Nearest point on the poly to (x,z): { s, dist, x, z }. Brute force, cheap for one road. */
export function nearestOnPoly(p, x, z) {
  let best = { s: 0, dist: Infinity, x: p.x[0], z: p.z[0] };
  for (let i = 0; i < p.n - 1; i++) {
    const ax = p.x[i];
    const az = p.z[i];
    const dx = p.x[i + 1] - ax;
    const dz = p.z[i + 1] - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) best = { s: lerp(p.s[i], p.s[i + 1], t), dist: d, x: px, z: pz };
  }
  return best;
}

/** Smallest radius of curvature (metres) over the poly; Infinity when straight. */
export function minCurveRadius(p, window = 4) {
  let minR = Infinity;
  for (let i = window; i < p.n - window; i++) {
    const a = i - window;
    const b = i + window;
    const cross = p.tx[a] * p.tz[b] - p.tz[a] * p.tx[b];
    const dot = p.tx[a] * p.tx[b] + p.tz[a] * p.tz[b];
    const ang = Math.abs(Math.atan2(cross, dot));
    const arc = p.s[b] - p.s[a];
    if (ang > 1e-4) minR = Math.min(minR, arc / ang);
  }
  return minR;
}

export function polyBounds(p) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.n; i++) {
    if (p.x[i] < minX) minX = p.x[i];
    if (p.x[i] > maxX) maxX = p.x[i];
    if (p.z[i] < minZ) minZ = p.z[i];
    if (p.z[i] > maxZ) maxZ = p.z[i];
  }
  return { minX, minZ, maxX, maxZ };
}
