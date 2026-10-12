// Frontier Road Editor — mesh assembly, welding, validation and export.
//
// Every surface the road editor emits goes through MeshBuilder so that the same
// invariants can be checked on any sub-mesh: indexed, finite, unit normals,
// no degenerate or duplicated triangles, no non-manifold edges, and — the one
// that matters for roads — the winding agrees with the shading normal.

import { EPS, cross3, sub3, len3, norm3, add3, mul3 } from './math.js';

const QUANT = 1e5; // vertex weld quantum (0.01 mm at km scale, exact for our inputs)
const keyOf = (x, y, z, i) => `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)},${i}`;

export class MeshBuilder {
  constructor(name = 'mesh') {
    this.name = name;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.materials = [];
    this.indices = [];
    this.vertexKeys = new Map();
    this.materialNames = [];
    this._matIndex = new Map();
    // Site tags: the emit site that produced each triangle. A validator failure
    // that names the site can be fixed without re-deriving the whole mesh, and
    // the tag costs one array slot per triangle.
    this.tags = [];
    this._tag = 'root';
  }

  /** Run `fn` with every triangle it emits tagged as `name`. */
  tag(name, fn) {
    const prev = this._tag;
    this._tag = name;
    try { return fn(); } finally { this._tag = prev; }
  }

  /** Triangle counts per site tag, for reports. */
  tagCounts() {
    const out = {};
    for (const t of this.tags) if (t) out[t] = (out[t] || 0) + 1;
    return out;
  }

  materialIndex(name = 'default') {
    if (!this._matIndex.has(name)) { this._matIndex.set(name, this.materialNames.length); this.materialNames.push(name); }
    return this._matIndex.get(name);
  }

  /** Add (or reuse) a vertex. Normals/UVs are part of the key: creases stay hard. */
  vertex(p, n = [0, 1, 0], uv = [0, 0], material = 'default') {
    const mi = this.materialIndex(material);
    const key = keyOf(p[0], p[1], p[2], mi);
    const hit = this.vertexKeys.get(key);
    if (hit !== undefined) {
      const sameNormal = Math.abs(this.normals[hit * 3] - n[0]) + Math.abs(this.normals[hit * 3 + 1] - n[1]) + Math.abs(this.normals[hit * 3 + 2] - n[2]) < 1e-6;
      const sameUv = Math.abs(this.uvs[hit * 2] - uv[0]) + Math.abs(this.uvs[hit * 2 + 1] - uv[1]) < 1e-6;
      if (sameNormal && sameUv) return hit;
    }
    const index = this.positions.length / 3;
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(uv[0], uv[1]);
    this.materials.push(mi);
    this.vertexKeys.set(key, index);
    return index;
  }

  tri(a, b, c, opts = {}) {
    const ia = this.vertex(a.p, a.n, a.uv, a.m ?? opts.material);
    const ib = this.vertex(b.p, b.n, b.uv, b.m ?? opts.material);
    const ic = this.vertex(c.p, c.n, c.uv, c.m ?? opts.material);
    if (ia === ib || ib === ic || ia === ic) return false;
    if (opts.flip) this.indices.push(ia, ic, ib); else this.indices.push(ia, ib, ic);
    this.tags[this.indices.length - 3] = this._tag;
    return true;
  }

  /** Triangle from raw points; computes a flat normal unless one is given. */
  triP(a, b, c, opts = {}) {
    const n = opts.normal || faceNormal(a, b, c);
    const uv = opts.uv || [[0, 0], [0, 0], [0, 0]];
    return this.tri({ p: a, n, uv: uv[0], m: opts.material }, { p: b, n, uv: uv[1] }, { p: c, n, uv: uv[2] }, opts);
  }

  quad(a, b, c, d, opts = {}) {
    const ok1 = this.tri(a, b, c, opts);
    const ok2 = this.tri(a, c, d, opts);
    return ok1 && ok2;
  }

  /** Quad from raw points with a flat normal (or per-vertex normals). */
  quadP(a, b, c, d, opts = {}) {
    const ns = opts.normals || [faceNormal(a, b, c), faceNormal(a, b, c), faceNormal(a, b, c), faceNormal(a, b, c)];
    const uv = opts.uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    return this.quad(
      { p: a, n: ns[0], uv: uv[0], m: opts.material },
      { p: b, n: ns[1], uv: uv[1], m: opts.material },
      { p: c, n: ns[2], uv: uv[2], m: opts.material },
      { p: d, n: ns[3], uv: uv[3], m: opts.material },
      opts,
    );
  }

  /**
   * Strip between two equal-length point rows (a = left/outer, b = right/inner,
   * walking along the road). Emits quads sharing vertices along the run, which is
   * what keeps the ribbon topology clean.
   */
  strip(rowA, rowB, opts = {}) {
    const n = Math.min(rowA.length, rowB.length);
    const uAlong = opts.uAlong ?? 0; // texture coordinate scale handled by caller
    for (let i = 0; i < n - 1; i++) {
      const u0 = opts.u?.(i) ?? [i * uAlong, 0];
      const u1 = opts.u?.(i + 1) ?? [(i + 1) * uAlong, 0];
      this.quadP(
        rowA[i], rowB[i], rowB[i + 1], rowA[i + 1],
        {
          material: opts.material,
          normals: opts.normals ? [opts.normals[i], opts.normals[i], opts.normals[i + 1], opts.normals[i + 1]] : undefined,
          uv: opts.uvPair ? [opts.uvPair[0](i), opts.uvPair[1](i), opts.uvPair[1](i + 1), opts.uvPair[0](i + 1)] : [u0, [u1[0], 1], [u1[0], 1], [u0[0], 1]],
        },
      );
    }
  }

  /** Vertical wall between two parallel rows (kerb faces, parapets, portal jambs). */
  wall(rowTop, rowBottom, opts = {}) {
    const n = Math.min(rowTop.length, rowBottom.length);
    for (let i = 0; i < n - 1; i++) {
      const a = rowTop[i], b = rowTop[i + 1], c = rowBottom[i + 1], d = rowBottom[i];
      const nrm = opts.normal ? (typeof opts.normal === 'function' ? opts.normal(i) : opts.normal)
        : norm3(cross3(sub3(b, a), sub3(d, a)));
      const ns = nrm[0] === 0 && nrm[1] === 0 && nrm[2] === 0 ? [0, 1, 0] : nrm;
      this.quadP(a, b, c, d, { material: opts.material, normals: [ns, ns, ns, ns], uv: opts.uv?.(i) });
    }
  }

  /** Extrude a closed loop vertically: side wall + optional cap. */
  prism(loop, yBottom, yTop, opts = {}) {
    const ccw = loop;
    for (let i = 0; i < ccw.length; i++) {
      const a = ccw[i], b = ccw[(i + 1) % ccw.length];
      this.quadP([a[0], yTop, a[1]], [b[0], yTop, b[1]], [b[0], yBottom, b[1]], [a[0], yBottom, a[1]],
        { material: opts.material, normals: opts.normals ? [opts.normals[i], opts.normals[(i + 1) % ccw.length], opts.normals[(i + 1) % ccw.length], opts.normals[i]] : undefined });
    }
  }

  /** Concave/convex loop filled at a fixed height (flat, +Y). */
  cap(loop, y, material = 'default', uvScale = 0.25, opts = {}) {
    if (loop.length < 3) return;
    const tris = earClip(loop, opts.down === true ? false : true);
    for (const [a, b, c] of tris) {
      this.triP([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], { material, uv: [[a[0] * uvScale, a[1] * uvScale], [b[0] * uvScale, b[1] * uvScale], [c[0] * uvScale, c[1] * uvScale]] });
    }
  }

  /** Sloped cap (each vertex its own height), used for graded verge/ramp tops. */
  capHeights(loop, heightAt, material = 'default', uvScale = 0.25, opts = {}) {
    const tris = earClip(loop, opts.down === true ? false : true);
    for (const [a, b, c] of tris) {
      const pa = [a[0], heightAt(a), a[1]], pb = [b[0], heightAt(b), b[1]], pc = [c[0], heightAt(c), c[1]];
      this.triP(pa, pb, pc, { material, uv: [[a[0] * uvScale, a[1] * uvScale], [b[0] * uvScale, b[1] * uvScale], [c[0] * uvScale, c[1] * uvScale]] });
    }
  }

  get triangleCount() { return this.indices.length / 3; }
  get vertexCount() { return this.positions.length / 3; }

  geometry() {
    return {
      name: this.name,
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      materials: new Float32Array(this.materials),
      indices: new Uint32Array(this.indices),
      materialNames: this.materialNames.slice(),
      tags: this.tags.slice(),
    };
  }
}

export function faceNormal(a, b, c) {
  const n = cross3(sub3(b, a), sub3(c, a));
  return len3(n) < 1e-12 ? [0, 1, 0] : norm3(n);
}

/**
 * Ear clipping. `up` = true emits triangles wound to face +Y (the default for
 * every road surface in this editor), false faces -Y.
 */
function earClip(loop, up = true) {
  const poly = loop.map((p) => [p[0], p[1]]);
  const area = polygonAreaF(poly);
  if (area < 0) poly.reverse();
  const idx = poly.map((_, i) => i);
  const out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < idx.length * idx.length + 64) {
    let done = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cr(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(poly[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push([a, b, c]); idx.splice(i, 1); done = true; break;
    }
    if (!done) break;
  }
  if (idx.length === 3) out.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
  else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i++) out.push([poly[idx[0]], poly[idx[i]], poly[idx[i + 1]]]);
  return up ? out : out.map((t) => [t[0], t[2], t[1]]);
}
function polygonAreaF(loop) { let a = 0; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1]; return a / 2; }
function inTri(p, a, b, c) {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS, pos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(neg && pos);
}

export function geometryBounds(geo) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geo.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], geo.positions[i + k]); max[k] = Math.max(max[k], geo.positions[i + k]); }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], centre: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/** Merge all sub-geometries into one buffer (materials re-indexed, names kept). */
export function mergeGeometry(list, name = 'merged') {
  const materialNames = [];
  const index = new Map();
  let pos = 0, idx = 0, vcount = 0;
  for (const g of list) {
    vcount += g.positions.length / 3;
    for (const m of g.materialNames || ['default']) if (!index.has(m)) { index.set(m, materialNames.length); materialNames.push(m); }
  }
  const positions = new Float32Array(vcount * 3), normals = new Float32Array(vcount * 3), uvs = new Float32Array(vcount * 2), materials = new Float32Array(vcount);
  const indices = new Uint32Array(list.reduce((n, g) => n + g.indices.length, 0));
  for (const g of list) {
    const remap = new Map();
    for (let i = 0; i < (g.materialNames || []).length; i++) remap.set(i, index.get(g.materialNames[i]));
    positions.set(g.positions, pos); normals.set(g.normals, pos); uvs.set(g.uvs, pos * 2 / 3);
    for (let i = 0; i < g.materials.length; i++) materials[i + pos / 3] = remap.get(g.materials[i]) ?? 0;
    for (let i = 0; i < g.indices.length; i++) indices[i + idx] = g.indices[i] + pos / 3;
    pos += g.positions.length; idx += g.indices.length;
  }
  return { name, positions, normals, uvs, materials, indices, materialNames };
}

/**
 * Mesh validation. Returns a report; `failures` lists hard errors, `warnings`
 * softer statistical findings. Position-keyed so seam cracks and winding flips
 * are caught on welded positions, not on raw vertex indices.
 */
export function validateMesh(geo, opts = {}) {
  const name = geo.name || opts.name || 'mesh';
  const report = { name, triangles: geo.indices.length / 3, vertices: geo.positions.length / 3, failures: [], warnings: [] };
  const fail = (m) => report.failures.push(m);
  const warn = (m) => report.warnings.push(m);

  for (let i = 0; i < geo.positions.length; i++) if (!Number.isFinite(geo.positions[i])) { fail('non-finite position'); break; }
  for (let i = 0; i < geo.normals.length; i++) if (!Number.isFinite(geo.normals[i])) { fail('non-finite normal'); break; }
  for (let i = 0; i < geo.uvs.length; i++) if (!Number.isFinite(geo.uvs[i])) { fail('non-finite uv'); break; }

  // Site tags make a failure actionable: report which emit site produced each
  // offending triangle instead of only how many there were.
  const siteOf = (t) => (geo.tags ? geo.tags[t] : null) || 'untagged';
  const siteList = (counts, limit = 4) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, v]) => `${k}×${v}`).join(', ');

  let badNormal = 0, degenerate = 0, badWinding = 0;
  const degSites = {}, windSites = {}, nonManSites = {}, flipSites = {};
  const vcount = geo.positions.length / 3;
  for (let v = 0; v < vcount; v++) {
    const l = Math.hypot(geo.normals[v * 3], geo.normals[v * 3 + 1], geo.normals[v * 3 + 2]);
    if (Math.abs(l - 1) > 2e-3) badNormal++;
  }
  if (badNormal) fail(`${badNormal} normals not unit length`);
  report.normalUnitViolations = badNormal;

  const edges = new Map(); // undirected weld key -> count / directed count
  const posKey = (i) => keyOf(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2], 0);
  for (let t = 0; t < geo.indices.length; t += 3) {
    const ia = geo.indices[t], ib = geo.indices[t + 1], ic = geo.indices[t + 2];
    if (ia >= vcount || ib >= vcount || ic >= vcount) { fail('index out of range'); break; }
    const a = [geo.positions[ia * 3], geo.positions[ia * 3 + 1], geo.positions[ia * 3 + 2]];
    const b = [geo.positions[ib * 3], geo.positions[ib * 3 + 1], geo.positions[ib * 3 + 2]];
    const c = [geo.positions[ic * 3], geo.positions[ic * 3 + 1], geo.positions[ic * 3 + 2]];
    const n = cross3(sub3(b, a), sub3(c, a));
    const area = len3(n) / 2;
    if (area < 1e-8) { degenerate++; degSites[siteOf(t)] = (degSites[siteOf(t)] || 0) + 1; }
    else {
      const gn = norm3(n);
      const sn = [(geo.normals[ia * 3] + geo.normals[ib * 3] + geo.normals[ic * 3]) / 3, (geo.normals[ia * 3 + 1] + geo.normals[ib * 3 + 1] + geo.normals[ic * 3 + 1]) / 3, (geo.normals[ia * 3 + 2] + geo.normals[ib * 3 + 2] + geo.normals[ic * 3 + 2]) / 3];
      if (gn[0] * sn[0] + gn[1] * sn[1] + gn[2] * sn[2] < 0.05) { badWinding++; windSites[siteOf(t)] = (windSites[siteOf(t)] || 0) + 1; }
    }
    const keys = [posKey(ia), posKey(ib), posKey(ic)];
    for (let e = 0; e < 3; e++) {
      const k1 = keys[e], k2 = keys[(e + 1) % 3];
      if (k1 === k2) { degenerate++; continue; }
      const und = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const dir = `${k1}>${k2}`;
      const rec = edges.get(und) || { count: 0, dirs: new Map(), tris: [] };
      rec.count++; rec.dirs.set(dir, (rec.dirs.get(dir) || 0) + 1);
      rec.tris.push(t);
      edges.set(und, rec);
    }
  }
  report.degenerateTriangles = degenerate;
  report.windingMismatches = badWinding;
  report.degenerateSites = degSites;
  report.windingSites = windSites;
  if (degenerate) fail(`${degenerate} degenerate triangles/edges (${siteList(degSites)})`);
  if (badWinding) fail(`${badWinding} triangles wound against their shading normal (${siteList(windSites)})`);

  let open = 0, nonManifold = 0, flipped = 0;
  for (const rec of edges.values()) {
    if (rec.count === 1) open++;
    else if (rec.count > 2) { nonManifold++; for (const t of rec.tris) nonManSites[siteOf(t)] = (nonManSites[siteOf(t)] || 0) + 1; }
    else if (rec.count === 2) {
      let dup = false;
      for (const n of rec.dirs.values()) if (n > 1) dup = true;
      if (dup) { flipped++; for (const t of rec.tris) flipSites[siteOf(t)] = (flipSites[siteOf(t)] || 0) + 1; }
    }
  }
  report.edges = edges.size;
  report.boundaryEdges = open;
  report.nonManifoldEdges = nonManifold;
  report.flippedEdges = flipped;
  report.nonManifoldSites = nonManSites;
  report.flippedSites = flipSites;
  if (nonManifold) fail(`${nonManifold} non-manifold edges (shared by >2 triangles) (${siteList(nonManSites)})`);
  if (flipped) fail(`${flipped} edges used twice in the same direction (orientation inconsistency) (${siteList(flipSites)})`);
  if (opts.expectClosed) {
    report.closed = open === 0;
    if (open) fail(`${open} boundary edges on a mesh expected to be closed`);
  }
  if (geo.indices.length === 0) warn('empty mesh');
  return report;
}

/** OBJ export (positions/normals/uvs + material groups) for inspection offline. */
export function geometryToObj(geos) {
  const lines = ['# Frontier Road Editor export'];
  let vBase = 1, vtBase = 1, vnBase = 1;
  for (const geo of geos) {
    lines.push(`o ${geo.name || 'mesh'}`);
    const P = geo.positions, N = geo.normals, U = geo.uvs;
    for (let i = 0; i < P.length; i += 3) lines.push(`v ${P[i].toFixed(4)} ${P[i + 1].toFixed(4)} ${P[i + 2].toFixed(4)}`);
    for (let i = 0; i < N.length; i += 3) lines.push(`vn ${N[i].toFixed(4)} ${N[i + 1].toFixed(4)} ${N[i + 2].toFixed(4)}`);
    for (let i = 0; i < U.length; i += 2) lines.push(`vt ${U[i].toFixed(4)} ${U[i + 1].toFixed(4)}`);
    const names = geo.materialNames || [];
    for (let m = 0; m < names.length; m++) {
      lines.push(`usemtl ${names[m]}`);
      for (let t = 0; t < geo.indices.length; t += 3) {
        if ((geo.materials[geo.indices[t]] | 0) !== m) continue;
        const ids = [geo.indices[t], geo.indices[t + 1], geo.indices[t + 2]];
        lines.push(`f ${ids.map((id) => `${id + vBase}//${id + vnBase}`).join(' ')}`);
      }
    }
    vBase += geo.positions.length / 3; vnBase += geo.normals.length / 3; vtBase += geo.uvs.length / 2;
  }
  return lines.join('\n') + '\n';
}

/** Point light/emissive helper used by street lights + signals (no geometry). */
export function emissiveSprite(pos, radius, color) { return { pos, radius, color }; }

export const MeshUtil = { faceNormal, mergeGeometry, validateMesh, geometryBounds, geometryToObj, MeshBuilder };
export { add3, mul3 };
