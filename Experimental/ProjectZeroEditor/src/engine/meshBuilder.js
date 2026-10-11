// Chunked geometry accumulator.
//
// Everything the editor generates is poured into a `GeometrySink`, which buckets
// triangles by world chunk (so a small edit only rebuilds a few meshes) and by
// material key (so the whole city is a handful of draw calls per chunk).
// Each triangle carries an `owner` id so the viewport can pick roads by raycast.

import * as THREE from 'three';
import { getSurfaceMaterial } from './materials.js';

class FloatBuf {
  constructor(itemSize, capacity = 4096) {
    this.itemSize = itemSize;
    this.data = new Float32Array(capacity * itemSize);
    this.count = 0;
  }
  ensure(extra) {
    const needed = (this.count + extra) * this.itemSize;
    if (needed <= this.data.length) return;
    let capacity = this.data.length || this.itemSize;
    while (capacity < needed) capacity *= 2;
    const next = new Float32Array(Math.max(capacity, this.data.length * 2));
    next.set(this.data.subarray(0, this.count * this.itemSize));
    this.data = next;
  }
  push3(a, b, c) {
    this.ensure(1);
    const i = this.count * 3;
    this.data[i] = a;
    this.data[i + 1] = b;
    this.data[i + 2] = c;
    this.count++;
  }
  push2(a, b) {
    this.ensure(1);
    const i = this.count * 2;
    this.data[i] = a;
    this.data[i + 1] = b;
    this.count++;
  }
  slice() {
    return this.data.subarray(0, this.count * this.itemSize).slice();
  }
}

class IndexBuf {
  constructor(capacity = 8192) {
    this.data = new Uint32Array(capacity);
    this.count = 0;
  }
  ensure(extra) {
    if ((this.count + extra) * 1 <= this.data.length) return;
    let capacity = this.data.length || 4096;
    while (capacity < this.count + extra) capacity *= 2;
    const next = new Uint32Array(capacity);
    next.set(this.data.subarray(0, this.count));
    this.data = next;
  }
  push(a, b, c) {
    this.ensure(3);
    const i = this.count;
    this.data[i] = a;
    this.data[i + 1] = b;
    this.data[i + 2] = c;
    this.count += 3;
  }
  slice() {
    return this.data.subarray(0, this.count).slice();
  }
}

class OwnerBuf {
  constructor(capacity = 2048) {
    this.data = new Uint32Array(capacity);
    this.count = 0;
  }
  push(owner) {
    if (this.count >= this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.count++] = owner >>> 0;
  }
  slice() {
    return this.data.subarray(0, this.count).slice();
  }
}

/** Accumulates triangles for a single (chunk, material) pair. */
export class SurfaceBuilder {
  constructor(materialKey) {
    this.materialKey = materialKey;
    this.positions = new FloatBuf(3);
    this.normals = new FloatBuf(3);
    this.uvs = new FloatBuf(2);
    this.colors = new FloatBuf(3);
    this.usesColors = false;
    this.color = [1, 1, 1];
    this.indices = new IndexBuf();
    this.owners = new OwnerBuf();
    this.vertexCount = 0;
  }

  /** Enable per-vertex colours (terrain, massing) and set the current colour. */
  setColor(r, g, b) {
    this.usesColors = true;
    this.color = [r, g, b];
  }

  get isEmpty() {
    return this.indices.count === 0;
  }

  get triangleCount() {
    return this.indices.count / 3;
  }

  vertex(x, y, z, nx, ny, nz, u, v) {
    this.positions.push3(x, y, z);
    this.normals.push3(nx, ny, nz);
    this.uvs.push2(u, v);
    if (this.usesColors) this.colors.push3(this.color[0], this.color[1], this.color[2]);
    return this.vertexCount++;
  }

  /** Add a triangle; normals default to the flat face normal. */
  tri(p0, p1, p2, normals = null, uvs = null, owner = 0) {
    let n = normals;
    if (!n) {
      const ax = p1[0] - p0[0];
      const ay = p1[1] - p0[1];
      const az = p1[2] - p0[2];
      const bx = p2[0] - p0[0];
      const by = p2[1] - p0[1];
      const bz = p2[2] - p0[2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      n = [[nx, ny, nz], [nx, ny, nz], [nx, ny, nz]];
    }
    const uv = uvs || [[0, 0], [1, 0], [1, 1]];
    const i0 = this.vertex(p0[0], p0[1], p0[2], n[0][0], n[0][1], n[0][2], uv[0][0], uv[0][1]);
    const i1 = this.vertex(p1[0], p1[1], p1[2], n[1][0], n[1][1], n[1][2], uv[1][0], uv[1][1]);
    const i2 = this.vertex(p2[0], p2[1], p2[2], n[2][0], n[2][1], n[2][2], uv[2][0], uv[2][1]);
    this.indices.push(i0, i1, i2);
    this.owners.push(owner);
  }

  /** Quad p0->p1->p2->p3 wound counter-clockwise as seen from the front face. */
  quad(p0, p1, p2, p3, normals = null, uvs = null, owner = 0) {
    const n0 = normals ? normals[0] : null;
    const n1 = normals ? normals[1] : null;
    const n2 = normals ? normals[2] : null;
    const n3 = normals ? normals[3] : null;
    const uv0 = uvs ? uvs[0] : [0, 0];
    const uv1 = uvs ? uvs[1] : [1, 0];
    const uv2 = uvs ? uvs[2] : [1, 1];
    const uv3 = uvs ? uvs[3] : [0, 1];
    const i0 = this.vertex(p0[0], p0[1], p0[2], n0 ? n0[0] : 0, n0 ? n0[1] : 0, n0 ? n0[2] : 0, uv0[0], uv0[1]);
    const i1 = this.vertex(p1[0], p1[1], p1[2], n1 ? n1[0] : 0, n1 ? n1[1] : 0, n1 ? n1[2] : 0, uv1[0], uv1[1]);
    const i2 = this.vertex(p2[0], p2[1], p2[2], n2 ? n2[0] : 0, n2 ? n2[1] : 0, n2 ? n2[2] : 0, uv2[0], uv2[1]);
    const i3 = this.vertex(p3[0], p3[1], p3[2], n3 ? n3[0] : 0, n3 ? n3[1] : 0, n3 ? n3[2] : 0, uv3[0], uv3[1]);
    this.indices.push(i0, i1, i2, i0, i2, i3);
    this.owners.push(owner, owner);
  }

  /** Extrude a closed cross-section ring along two stations; used for solids. */
  bridgeRings(ringA, ringB, owner = 0, uScale = 1, vA = 0, vB = 1) {
    const n = Math.min(ringA.length, ringB.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(ringA[i], ringA[j], ringB[j], ringB[i], null, [
        [i * uScale, vA],
        [(i + 1) * uScale, vA],
        [(i + 1) * uScale, vB],
        [i * uScale, vB],
      ], owner);
    }
  }

  build() {
    if (this.isEmpty) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions.slice(), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals.slice(), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs.slice(), 2));
    geometry.setIndex(new THREE.BufferAttribute(this.indices.slice(), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, owners: this.owners.slice(), materialKey: this.materialKey };
  }
}

/**
 * Spatial bucket of geometry.  The world is cut into square chunks; anything
 * generated inside a chunk lands in that chunk's builders.
 */
export class GeometrySink {
  constructor(chunkSize = 128) {
    this.chunkSize = chunkSize;
    this.chunks = new Map(); // `${cx},${cz}` -> Map(materialKey -> SurfaceBuilder)
    this.materials = new Map(); // materialKey -> THREE.Material override
  }

  /** Register a bespoke material (road markings, water, glass…) under a key. */
  registerMaterial(key, material) {
    if (!this.materials.has(key)) this.materials.set(key, material);
    return key;
  }

  material(key) {
    return this.materials.get(key) || getSurfaceMaterial(key);
  }

  chunkCoords(x, z) {
    return [Math.floor(x / this.chunkSize), Math.floor(z / this.chunkSize)];
  }

  /** Builder for a material at a world location (chunk is derived from x/z). */
  at(x, z, materialKey) {
    const [cx, cz] = this.chunkCoords(x, z);
    return this.chunk(cx, cz, materialKey);
  }

  chunk(cx, cz, materialKey) {
    const key = `${cx},${cz}`;
    let bucket = this.chunks.get(key);
    if (!bucket) {
      bucket = new Map();
      this.chunks.set(key, bucket);
    }
    let builder = bucket.get(materialKey);
    if (!builder) {
      builder = new SurfaceBuilder(materialKey);
      bucket.set(materialKey, builder);
    }
    return builder;
  }

  /** Every chunk key that a segment spanning a..b could touch. */
  *chunkKeysInBounds(minX, minZ, maxX, maxZ) {
    const s = this.chunkSize;
    const cx0 = Math.floor(minX / s);
    const cx1 = Math.floor(maxX / s);
    const cz0 = Math.floor(minZ / s);
    const cz1 = Math.floor(maxZ / s);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) yield `${cx},${cz}`;
    }
  }

  /** Build one THREE.Group per chunk; returns [{ key, group, triangles }]. */
  build({ castShadow = false, receiveShadow = true } = {}) {
    const out = [];
    for (const [key, bucket] of this.chunks) {
      const group = new THREE.Group();
      group.name = `chunk:${key}`;
      let triangles = 0;
      for (const [materialKey, builder] of bucket) {
        const built = builder.build();
        if (!built) continue;
        const material = this.material(materialKey);
        const mesh = new THREE.Mesh(built.geometry, material);
        mesh.name = `surface:${materialKey}`;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        mesh.userData.owner = built.owners;
        mesh.userData.pickable = true;
        if (material.userData?.isMarking) mesh.renderOrder = 4;
        if (material.transparent && material.depthWrite === false) mesh.renderOrder = Math.max(mesh.renderOrder, 2);
        group.add(mesh);
        triangles += built.geometry.index.count / 3;
      }
      if (group.children.length) out.push({ key, group, triangles });
    }
    return out;
  }

  get triangleEstimate() {
    let total = 0;
    for (const bucket of this.chunks.values()) {
      for (const builder of bucket.values()) total += builder.triangleCount;
    }
    return total;
  }
}

/** Utility: build an axis-aligned box as raw quads into a builder. */
export function addBox(builder, min, max, materialUvScale = 1, owner = 0) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces = [
    { p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] }, // +Z
    { p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] }, // -Z
    { p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] }, // +X
    { p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] }, // -X
    { p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] }, // +Y
    { p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] }, // -Y
  ];
  for (const face of faces) {
    const [a, b, c, d] = face.p;
    const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * materialUvScale;
    const h = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * materialUvScale;
    builder.quad(a, b, c, d, null, [[0, 0], [w, 0], [w, h], [0, h]], owner);
  }
}
