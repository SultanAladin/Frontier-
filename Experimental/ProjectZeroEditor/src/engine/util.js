// Small shared math / randomness helpers for the road editor.
// Kept dependency-free so the modules can also be unit-checked under plain node.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export function deg(rad) {
  return (rad * 180) / Math.PI;
}

export function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng()) ;
  rng.pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  return rng;
}

/** Hash based 2D value noise with fBm — used for terrain and texture grain. */
export function makeNoise2D(seed) {
  const perm = new Uint8Array(512);
  const base = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(base() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (hash, x, y) => {
    switch (hash & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };

  const noise = (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // ~[-1, 1]
  };

  noise.fbm = (x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  };

  noise.ridge = (x, y, octaves = 4) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / (norm || 1);
  };

  return noise;
}

/** Squared distance from point p to segment ab, in the XZ plane. */
export function distSqPointSegmentXZ(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const denom = abx * abx + abz * abz;
  const t = denom > 1e-9 ? clamp((apx * abx + apz * abz) / denom, 0, 1) : 0;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return { distSq: dx * dx + dz * dz, t, cx, cz };
}

/** Nearest point on a polyline (XZ). Returns { dist, t, index, x, z, station }. */
export function nearestOnPolyline(points, px, pz) {
  let best = { dist: Infinity, t: 0, index: 0, x: points[0]?.x ?? 0, z: points[0]?.z ?? 0, station: 0 };
  let running = 0;
  const lengths = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const r = distSqPointSegmentXZ(px, pz, a.x, a.z, b.x, b.z);
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (r.distSq < best.dist * best.dist) {
      best = {
        dist: Math.sqrt(r.distSq),
        t: r.t,
        index: i,
        x: r.cx,
        z: r.cz,
        station: running + segLen * r.t,
      };
    }
    running += segLen;
    lengths.push(segLen);
  }
  best.length = running;
  return best;
}

/** Total length of a polyline (XZ + optional Y). */
export function polylineLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }
  return total;
}

/** Uniform spatial hash for 2D point lookups. */
export class Grid2D {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  insert(x, z, value) {
    const key = this._key(x, z);
    let bucket = this.map.get(key);
    if (!bucket) {
      bucket = [];
      this.map.set(key, bucket);
    }
    bucket.push({ x, z, value });
  }
  /** Visit every entry within `radius`, calling fn(entry). */
  query(x, z, radius, fn) {
    const c = this.cell;
    const minX = Math.floor((x - radius) / c);
    const maxX = Math.floor((x + radius) / c);
    const minZ = Math.floor((z - radius) / c);
    const maxZ = Math.floor((z + radius) / c);
    const r2 = radius * radius;
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const bucket = this.map.get(`${ix},${iz}`);
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - x;
          const dz = entry.z - z;
          if (dx * dx + dz * dz <= r2) fn(entry);
        }
      }
    }
  }
  clear() {
    this.map.clear();
  }
  get size() {
    let n = 0;
    for (const b of this.map.values()) n += b.length;
    return n;
  }
}

/** Catmull-Rom sample of a polyline (centripetal) with arc-length re-parameterisation. */
export function sampleSpline(points, count) {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return Array.from({ length: Math.max(count, 2) }, () => ({ ...points[0] }));
  if (n === 2) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      out.push({
        x: lerp(points[0].x, points[1].x, t),
        y: lerp(points[0].y ?? 0, points[1].y ?? 0, t),
        z: lerp(points[0].z, points[1].z, t),
      });
    }
    return out;
  }

  // Build cumulative arc-length table over a dense raw sampling of the centripetal spline.
  const raw = [];
  const rawN = Math.max(64, Math.min(4096, n * 48));
  for (let i = 0; i < rawN; i++) {
    const u = (i / (rawN - 1)) * (n - 1);
    raw.push(catmullRomPoint(points, u));
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
  }
  const total = cum[cum.length - 1] || 1;

  const out = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * total;
    while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
    const span = cum[cursor + 1] - cum[cursor] || 1e-6;
    const f = clamp((target - cum[cursor]) / span, 0, 1);
    const a = raw[cursor];
    const b = raw[cursor + 1];
    out.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) });
  }
  return out;
}

function catmullRomPoint(points, u) {
  const n = points.length;
  const i1 = clamp(Math.floor(u), 0, n - 1);
  const f = u - i1;
  const p0 = points[clamp(i1 - 1, 0, n - 1)];
  const p1 = points[i1];
  const p2 = points[clamp(i1 + 1, 0, n - 1)];
  const p3 = points[clamp(i1 + 2, 0, n - 1)];
  // Centripetal-ish blend (uniform is stable enough and avoids sqrt(0) blowups on
  // duplicated control points, which happen constantly while dragging nodes).
  const f2 = f * f;
  const f3 = f2 * f;
  const cr = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  return {
    x: cr(p0.x, p1.x, p2.x, p3.x),
    y: cr(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0),
    z: cr(p0.z, p1.z, p2.z, p3.z),
  };
}

/** Douglas–Peucker style simplification (XZ) used to keep generated roads cheap. */
export function simplifyPolyline(points, tolerance = 0.5) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > tolerance) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Convex-ish polygon area (positive when counter-clockwise in XZ with Y up). */
export function polygonArea2D(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/** Ring orientation helper: make the ring counter-clockwise when viewed from +Y. */
export function ensureCCW(poly) {
  const area = polygonArea2D(poly);
  return area < 0 ? poly.slice().reverse() : poly;
}
