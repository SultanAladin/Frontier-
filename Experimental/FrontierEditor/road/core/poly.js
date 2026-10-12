// Frontier Road Editor — 2D polygon / polyline operations (plan space).
//
// Deliberately no boolean CSG: the network model knows where a road ends and
// where a junction begins, so every loop here is constructed from trim lines and
// arcs rather than cut out of another polygon. That keeps the topology exact
// (shared vertices, no slivers) and the code verifiable.

import { EPS, clamp, dist2, lineIntersect, sub2, add2, mul2, norm2, left2, dot2, cross2 } from './math.js';

export function polygonArea(loop) {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += (loop[j][0] * loop[i][1]) - (loop[i][0] * loop[j][1]);
  return a / 2;
}
export const isCCW = (loop) => polygonArea(loop) > 0;
export function ensureCCW(loop) { return isCCW(loop) ? loop : loop.slice().reverse(); }
export function ensureCW(loop) { return isCCW(loop) ? loop.slice().reverse() : loop; }

/**
 * Orient a plan loop so that a triangle fan built from it faces +Y.
 * In a Y-up right-handed frame, (x,z) winding with NEGATIVE signed area gives an
 * upward normal — cross((1,0,0),(0,1,0)_in_xz) = ... = -Y — so this reverses
 * positive-area loops. Every road surface goes through here exactly once.
 */
export function ensureUpFacing(loop) { return polygonArea(loop) > 0 ? loop.slice().reverse() : loop; }

export function polygonCentroid(loop) {
  let a = 0, x = 0, z = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const f = loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
    a += f; x += (loop[j][0] + loop[i][0]) * f; z += (loop[j][1] + loop[i][1]) * f;
  }
  if (Math.abs(a) < EPS) {
    const s = loop.reduce((acc, p) => add2(acc, p), [0, 0]);
    return mul2(s, 1 / Math.max(1, loop.length));
  }
  return [x / (3 * a), z / (3 * a)];
}

export function pointInPolygon(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i], [xj, zj] = loop[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi || EPS) + xi) inside = !inside;
  }
  return inside;
}

export function polygonPerimeter(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) s += dist2(loop[i], loop[(i + 1) % loop.length]);
  return s;
}

export function bboxOf(points) {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const p of points) { min[0] = Math.min(min[0], p[0]); min[1] = Math.min(min[1], p[1]); max[0] = Math.max(max[0], p[0]); max[1] = Math.max(max[1], p[1]); }
  return { min, max };
}

/** Sutherland–Hodgman clip against the half-plane n·x + d <= 0 (inside kept). */
export function clipHalfPlane(loop, n, d) {
  if (!loop.length) return [];
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const da = dot2(n, a) + d, db = dot2(n, b) + d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return dedupeLoop(out);
}

export function dedupeLoop(loop, eps = 1e-7) {
  const out = [];
  for (const p of loop) {
    const last = out[out.length - 1];
    if (!last || dist2(last, p) > eps) out.push(p);
  }
  if (out.length > 1 && dist2(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

export function simplifyCollinear(loop, eps = 1e-6) {
  const out = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    if (Math.abs(cross2(sub2(b, a), sub2(c, b))) > eps) out.push(b);
  }
  return out.length >= 3 ? out : loop;
}

/**
 * Offset a closed loop outward by `delta` (positive = outward for CCW input).
 * Miter joins with a limit; returns a fresh loop of the same winding.
 */
export function offsetPolygon(loop, delta, miterLimit = 4) {
  const src = ensureCCW(loop);
  const n = src.length;
  if (n < 3) return src.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = src[(i - 1 + n) % n], cur = src[i], next = src[(i + 1) % n];
    const d0 = norm2(sub2(cur, prev)), d1 = norm2(sub2(next, cur));
    // outward normal of a CCW loop is (dz, -dx)
    const n0 = [d0[1], -d0[0]], n1 = [d1[1], -d1[0]];
    const bis = norm2(add2(n0, n1));
    const cosHalf = dot2(bis, n0);
    let m = Math.abs(cosHalf) < 1e-6 ? miterLimit : 1 / cosHalf;
    m = clamp(m, -miterLimit, miterLimit);
    out.push([cur[0] + bis[0] * delta * m, cur[1] + bis[1] * delta * m]);
  }
  return out;
}

/**
 * Offset an open polyline to the left by `dist` (+ = left of travel).
 * Endpoints keep their direction; miter joins clamped at the limit.
 */
export function offsetPolyline(pts, dist, miterLimit = 3) {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [pts[0].slice()];
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    const d = norm2(sub2(next, prev));
    const nrm = left2(d);
    out.push([pts[i][0] + nrm[0] * dist, pts[i][1] + nrm[1] * dist]);
  }
  return out;
}

/** Unit tangent of a polyline at index i (central differences). */
export function tangentAt(pts, i) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const d = norm2(sub2(b, a));
  return d[0] || d[1] ? d : [1, 0];
}

/** Sample a circular arc from a0 to a1 (radians, CCW positive) about c. */
export function arcPoints(c, r, a0, a1, samples = 8, includeEnds = true) {
  const out = [];
  const n = Math.max(1, samples);
  for (let i = 0; i <= n; i++) {
    if (!includeEnds && (i === 0 || i === n)) continue;
    const a = a0 + (a1 - a0) * (i / n);
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

export function triangulateFan(loop) {
  const tris = [];
  if (loop.length < 3) return tris;
  const ccw = ensureCCW(loop);
  for (let i = 1; i < ccw.length - 1; i++) tris.push([ccw[0], ccw[i], ccw[i + 1]]);
  return tris;
}

/** Ear clipping for simple polygons (CCW input). Robust enough for road loops. */
export function triangulateEar(loop) {
  const poly = ensureCCW(dedupeLoop(loop, 1e-6)).map((p) => p.slice());
  const idx = poly.map((_, i) => i);
  const tris = [];
  let guard = 0;
  const area2 = (a, b, c) => cross2(sub2(b, a), sub2(c, a));
  while (idx.length > 3 && guard++ < poly.length * poly.length + 64) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (area2(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(poly[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // self-intersecting input: fall back to a fan of what is left
  }
  if (idx.length === 3) tris.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
  else if (idx.length > 3) {
    for (let i = 1; i < idx.length - 1; i++) tris.push([poly[idx[0]], poly[idx[i]], poly[idx[i + 1]]]);
  }
  return tris;
}

export function pointInTriangle(p, a, b, c) {
  const d1 = cross2(sub2(b, a), sub2(p, a));
  const d2 = cross2(sub2(c, b), sub2(p, b));
  const d3 = cross2(sub2(a, c), sub2(p, c));
  const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const pos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(neg && pos);
}

/** Grid strip triangulation: rows × columns of points -> quads (v0..v-1 layout). */
export function triangulateGrid(rows, cols, ccw = true) {
  const tris = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c, i1 = i0 + 1, i2 = i0 + cols, i3 = i2 + 1;
      if (ccw) { tris.push([i0, i2, i1], [i1, i2, i3]); }
      else { tris.push([i0, i1, i2], [i1, i3, i2]); }
    }
  }
  return tris;
}

/** Segment/segment intersection test (proper, excludes shared endpoints). */
export function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross2(sub2(p2, p1), sub2(p3, p1));
  const d2 = cross2(sub2(p2, p1), sub2(p4, p1));
  const d3 = cross2(sub2(p4, p3), sub2(p1, p3));
  const d4 = cross2(sub2(p4, p3), sub2(p2, p3));
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** True when a closed loop crosses itself. O(n²), used on small junction loops. */
export function loopSelfIntersects(loop) {
  const n = loop.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = loop[i], a2 = loop[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = loop[j], b2 = loop[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Minimum distance between two loops' vertices (used for overlap checks). */
export function loopDistance(a, b) {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, dist2(p, q));
  return best;
}

/** Intersect two lines given as point + dir; null when parallel. */
export function intersectLineDir(p, d, q, e) {
  const r = lineIntersect(p, d, q, e);
  if (!r) return null;
  return [p[0] + d[0] * r[0], p[1] + d[1] * r[0]];
}

/** Round a loop's corners with arcs; `radiusAt` may vary per corner index. */
export function filletLoop(loop, radius, samples = 4) {
  const src = dedupeLoop(loop, 1e-6);
  const n = src.length;
  if (n < 3) return src;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = src[(i - 1 + n) % n], cur = src[i], next = src[(i + 1) % n];
    const d0 = norm2(sub2(cur, prev)), d1 = norm2(sub2(next, cur));
    const cosT = clamp(dot2(d0, d1), -1, 1);
    const theta = Math.acos(cosT);
    if (theta < 1e-3 || theta > Math.PI - 1e-3) { out.push(cur.slice()); continue; }
    const tanLen = Math.min(radius / Math.tan((Math.PI - theta) / 2), dist2(cur, prev) / 2, dist2(cur, next) / 2);
    const r = tanLen * Math.tan((Math.PI - theta) / 2);
    const tA = add2(cur, mul2(d0, -tanLen));
    const tB = add2(cur, mul2(d1, tanLen));
    const bis = norm2(add2(mul2(d0, -1), d1));
    const centre = add2(cur, mul2(bis, Math.hypot(tanLen, r) * (r < 1e-6 ? 0 : 1)));
    out.push(tA);
    const a0 = Math.atan2(tA[1] - centre[1], tA[0] - centre[0]);
    const a1 = Math.atan2(tB[1] - centre[1], tB[0] - centre[0]);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    for (let s = 1; s < samples; s++) out.push(...arcPoints(centre, r, a0, a0 + delta * (s / samples), 1));
  }
  return dedupeLoop(out, 1e-6);
}

/** Area of a strip between two parallel polylines (approximate, for stats). */
export function stripArea(a, b) {
  let area = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n - 1; i++) {
    const t1 = [a[i], b[i], b[i + 1]], t2 = [a[i], b[i + 1], a[i + 1]];
    area += Math.abs(polygonArea(t1)) + Math.abs(polygonArea(t2));
  }
  return area;
}
