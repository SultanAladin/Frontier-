// Frontier Road Editor — scalar/vector/matrix/noise helpers.
//
// Zero dependencies. Everything the road network, the meshers and the WebGL
// renderer need, in plan space X/Z with +Y up (the engine's convention: a road
// centreline is a polyline in the XZ plane, elevation rides on Y).
//
// Vectors are plain arrays so they serialise into the project format without a
// class layer: V2 = [x, z], V3 = [x, y, z].

export const EPS = 1e-9;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const remap = (v, a, b, c, d) => c + ((clamp(v, a, b) - a) / (b - a || 1)) * (d - c);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export const v2 = (x = 0, z = 0) => [x, z];
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul2 = (a, s) => [a[0] * s, a[1] * s];
export const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len2 = (a) => Math.hypot(a[0], a[1]);
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm2 = (a) => { const l = Math.hypot(a[0], a[1]); return l > EPS ? [a[0] / l, a[1] / l] : [0, 0]; };
/** Left-hand normal of a plan-space direction: rotate +90° about +Y. */
export const left2 = (a) => [a[1], -a[0]];
export const right2 = (a) => [-a[1], a[0]];
export const angle2 = (a) => Math.atan2(a[1], a[0]);
/** Signed smallest angle from a to b, in (-pi, pi]. */
export function angleDelta(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d <= -Math.PI) d += Math.PI * 2; return d; }

export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a) => { const l = len3(a); return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Intersection of two infinite 2D lines (p + s*d). Returns [s, t] or null when parallel. */
export function lineIntersect(p, d, q, e) {
  const den = cross2(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub2(q, p);
  return [cross2(w, e) / den, cross2(w, d) / den];
}

/** Closest point parameter on segment [a,b] to p, clamped to the segment. */
export function closestTOnSegment(p, a, b) {
  const ab = sub2(b, a); const l2 = dot2(ab, ab);
  if (l2 < EPS) return 0;
  return clamp(dot2(sub2(p, a), ab) / l2, 0, 1);
}

export function distToSegment(p, a, b) {
  const t = closestTOnSegment(p, a, b);
  return dist2(p, [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
}

// ── seeded randomness ────────────────────────────────────────────────────────
/** mulberry32 — small, fast, deterministic across engines. */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(rng.range(lo, hi + 1 - 1e-9));
  rng.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  return rng;
}

/** Stable 32-bit hash of a string (for per-preset deterministic sub-seeds). */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const h2 = (x, y, seed) => {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  n = (n ^ (n >>> 13)) >>> 0; n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise on the integer lattice; period-1 output in [0,1). */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = h2(xi, yi, seed), b = h2(xi + 1, yi, seed), c = h2(xi, yi + 1, seed), d = h2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, { octaves = 4, gain = 0.5, lacunarity = 2, seed = 0 } = {}) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(fx, fy, seed + i * 1013);
    norm += amp; amp *= gain; fx *= lacunarity; fy *= lacunarity;
  }
  return sum / (norm || 1);
}

// ── curves ───────────────────────────────────────────────────────────────────
/** Catmull-Rom through pts (centripetal), returned as densely sampled points. */
export function catmullRom(pts, samplesPerSpan = 12, alpha = 0.5) {
  if (pts.length < 2) return pts.map((p) => p.slice());
  if (pts.length === 2) return sampleLine(pts[0], pts[1], samplesPerSpan);
  // Phantom end points are mirrored, not repeated: a repeated point makes its
  // span zero-length and the centripetal weights divide by zero.
  const last = pts.length - 1;
  const ext = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
    ...pts,
    [2 * pts[last][0] - pts[last - 1][0], 2 * pts[last][1] - pts[last - 1][1]],
  ];
  const out = [];
  const tj = (ti, pi, pj) => ti + Math.max(1e-6, Math.hypot(pj[0] - pi[0], pj[1] - pi[1])) ** alpha;
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = Math.max(t1 + 1e-6, tj(t1, p1, p2)), t3 = Math.max(t2 + 1e-6, tj(t2, p2, p3));
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = lerp(t1, t2, s / samplesPerSpan);
      out.push(barryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}
function barryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t) {
  // Barry-Goldman pyramid: three linear interpolations, then two, then one. The
  // earlier weight-division form divided by a zero weight at every span end.
  const at = (a, b, pa, pb) => {
    const d = b - a;
    if (Math.abs(d) < 1e-9) return [pa[0], pa[1]];
    const u = (t - a) / d;
    return [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u];
  };
  const A1 = at(t0, t1, p0, p1);
  const A2 = at(t1, t2, p1, p2);
  const A3 = at(t2, t3, p2, p3);
  const B1 = at(t0, t2, A1, A2);
  const B2 = at(t1, t3, A2, A3);
  return at(t1, t2, B1, B2);
}
export function sampleLine(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  return out;
}

/**
 * Resample a polyline to (near-)uniform arc-length stations.
 * Returns { pts, s } — cumulative arc length per point. The last point is the
 * original end, so endpoints are preserved exactly (junctions depend on it).
 */
export function resample(poly, step) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < poly.length; i++) { const l = dist2(poly[i - 1], poly[i]); seg.push(l); total += l; }
  const n = Math.max(1, Math.ceil(total / step));
  const ds = total / n;
  const pts = [poly[0].slice()], s = [0];
  let i = 0, acc = 0;
  for (let k = 1; k < n; k++) {
    const target = k * ds;
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const t = seg[i] > EPS ? (target - acc) / seg[i] : 0;
    pts.push([lerp(poly[i][0], poly[i + 1][0], t), lerp(poly[i][1], poly[i + 1][1], t)]);
    s.push(target);
  }
  pts.push(poly[poly.length - 1].slice()); s.push(total);
  return { pts, s, length: total };
}

// ── 4×4 matrices (column-major, WebGL layout) ────────────────────────────────
export function mat4Identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
export function mat4Multiply(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
export function mat4Perspective(fovy, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
  return out;
}
export function mat4LookAt(eye, center, up, out = new Float32Array(16)) {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -dot3(x, eye); out[13] = -dot3(y, eye); out[14] = -dot3(z, eye); out[15] = 1;
  return out;
}
/** Compose translate * rotateY(yaw) * rotateX(pitch) * scale(s). */
export function mat4TRS(t, rotY, rotX, s = 1, out = new Float32Array(16)) {
  const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
  out[0] = cy * s; out[1] = 0; out[2] = -sy * s; out[3] = 0;
  out[4] = sy * sx * s; out[5] = cx * s; out[6] = cy * sx * s; out[7] = 0;
  out[8] = sy * cx * s; out[9] = -sx * s; out[10] = cy * cx * s; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}
export function mat4Invert(a, out = new Float32Array(16)) {
  const m = a;
  const b00 = m[0] * m[5] - m[1] * m[4], b01 = m[0] * m[6] - m[2] * m[4], b02 = m[0] * m[7] - m[3] * m[4];
  const b03 = m[1] * m[6] - m[2] * m[5], b04 = m[1] * m[7] - m[3] * m[5], b05 = m[2] * m[7] - m[3] * m[6];
  const b06 = m[8] * m[13] - m[9] * m[12], b07 = m[8] * m[14] - m[10] * m[12], b08 = m[8] * m[15] - m[11] * m[12];
  const b09 = m[9] * m[14] - m[10] * m[13], b10 = m[9] * m[15] - m[11] * m[13], b11 = m[10] * m[15] - m[11] * m[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-20) return mat4Identity();
  det = 1 / det;
  out[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * det;
  out[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * det;
  out[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * det;
  out[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * det;
  out[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * det;
  out[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * det;
  out[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * det;
  out[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * det;
  out[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * det;
  out[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * det;
  out[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * det;
  out[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * det;
  out[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * det;
  out[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * det;
  out[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * det;
  out[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * det;
  return out;
}

/** Extract the 6 frustum planes (a,b,c,d with a*x+b*y+c*z+d >= 0 inside) from a view-projection matrix. */
export function frustumPlanes(m) {
  const planes = [];
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const push = (a) => {
    if (!a.every(Number.isFinite)) return;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    planes.push([a[0] / l, a[1] / l, a[2] / l, a[3] / l]);
  };
  push([r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]]);
  push([r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]]);
  push([r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]]);
  push([r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]]);
  push([r3[0] + r2[0], r3[1] + r2[1], r3[2] + r2[2], r3[3] + r2[3]]);
  push([r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]]);
  return planes;
}
export function aabbVisible(planes, min, max) {
  for (const p of planes) {
    const x = p[0] >= 0 ? max[0] : min[0];
    const y = p[1] >= 0 ? max[1] : min[1];
    const z = p[2] >= 0 ? max[2] : min[2];
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}
