// Street furniture library.
//
// Every prop is baked into a single BufferGeometry with vertex colours so the whole
// set renders as one instanced draw call per prop type.  Emissive sub-parts (lamp
// glass, signal lenses, beacons) are split into a second geometry rendered with an
// unlit material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from './util.js';

class PartBuilder {
  constructor() {
    this.parts = [];
  }

  add(geometry, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    const g = geometry.clone();
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(new THREE.Vector3(x, y, z), quat, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(matrix);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.deleteAttribute('tangent');
    this.parts.push(g);
    return this;
  }

  merge() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts = [];
    if (!merged) return null;
    merged.deleteAttribute('uv2');
    merged.computeBoundingSphere();
    return merged;
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sphere = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2));
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);

/* ------------------------------------------------------------------ */
/* individual props                                                    */
/* ------------------------------------------------------------------ */

function buildBollard() {
  const b = new PartBuilder();
  b.add(cyl(0.075, 0.09, 1.0, 12), 0x2f3236, { y: 0.5 });
  b.add(sphere(0.09, 10), 0x3a3e43, { y: 1.0 });
  b.add(cyl(0.1, 0.1, 0.06, 12), 0x1b1d20, { y: 0.03 });
  b.add(cyl(0.082, 0.082, 0.09, 12), 0xd8d5cc, { y: 0.82 });
  return { body: b.merge() };
}

function buildBollardRemovable() {
  const b = new PartBuilder();
  b.add(box(0.16, 0.06, 0.16), 0x24262a, { y: 0.03 });
  b.add(cyl(0.07, 0.08, 0.9, 12), 0x8d9095, { y: 0.5 });
  b.add(cyl(0.075, 0.075, 0.08, 12), 0xd8483c, { y: 0.9 });
  return { body: b.merge() };
}

function buildLamp() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.13, 0.16, 0.5, 12), 0x3b3f44, { y: 0.25 });
  b.add(cyl(0.075, 0.095, 7.2, 12), 0x4a4f55, { y: 4.0 });
  b.add(box(0.5, 0.12, 0.14), 0x4a4f55, { x: 0.22, y: 7.5 });
  b.add(box(0.62, 0.1, 0.26), 0x3d4147, { x: 0.42, y: 7.4 });
  glow.add(box(0.5, 0.06, 0.2), 0xffe9c4, { x: 0.42, y: 7.33 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildLampHeritage() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.22, 0.3, 0.7, 12), 0x2c2f33, { y: 0.35 });
  b.add(cyl(0.06, 0.09, 4.3, 12), 0x33373b, { y: 2.85 });
  b.add(cyl(0.11, 0.11, 0.16, 12), 0x3d4147, { y: 4.55 });
  b.add(cone(0.34, 0.34, 6), 0x2c2f33, { y: 4.95 });
  glow.add(cyl(0.2, 0.24, 0.34, 6), 0xffdfae, { y: 4.78 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildFloodMast() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.2, 0.28, 1.0, 10), 0x33373b, { y: 0.5 });
  b.add(cyl(0.1, 0.16, 12, 10), 0x43484e, { y: 7 });
  b.add(box(1.6, 0.16, 0.4), 0x3a3e43, { y: 12.9 });
  glow.add(box(1.5, 0.1, 0.32), 0xfff3d8, { y: 12.78 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildSignal() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.13, 0.17, 0.6, 12), 0x33373b, { y: 0.3 });
  b.add(cyl(0.075, 0.1, 3.4, 12), 0x45494f, { y: 2.2 });
  b.add(box(0.34, 1.0, 0.3), 0x22252a, { x: 0.3, y: 4.1 });
  glow.add(box(0.24, 0.22, 0.05), 0xd93a2b, { x: 0.48, y: 4.42 });
  glow.add(box(0.24, 0.22, 0.05), 0xe8b23a, { x: 0.48, y: 4.1 });
  glow.add(box(0.24, 0.22, 0.05), 0x4fbf5a, { x: 0.48, y: 3.78 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildSign() {
  const b = new PartBuilder();
  b.add(cyl(0.05, 0.06, 2.4, 10), 0x8b9096, { y: 1.2 });
  b.add(box(0.72, 0.72, 0.05), 0xe6e6e0, { x: 0.38, y: 2.2 });
  b.add(box(0.6, 0.6, 0.02), 0xcfcfc8, { x: 0.38, y: 2.2, z: 0.04 });
  return { body: b.merge() };
}

function buildTree(rng) {
  const b = new PartBuilder();
  const height = 5.5 + rng() * 3.5;
  b.add(cyl(0.16, 0.28, height * 0.42, 8), 0x5b4632, { y: height * 0.21 });
  const crownR = 1.7 + rng() * 1.1;
  const blobs = 3;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    const r = crownR * (0.62 + rng() * 0.3);
    b.add(sphere(r, 8), i % 2 ? 0x4e6b35 : 0x5d7c3c, {
      x: Math.cos(a) * crownR * 0.34,
      y: height * 0.55 + rng() * 1.6,
      z: Math.sin(a) * crownR * 0.34,
      sy: 0.85,
    });
  }
  return { body: b.merge() };
}

function buildConifer() {
  const b = new PartBuilder();
  b.add(cyl(0.14, 0.2, 1.2, 8), 0x4a3a2a, { y: 0.6 });
  for (let i = 0; i < 3; i++) {
    b.add(cone(1.5 - i * 0.35, 2.6, 8), i % 2 ? 0x33502c : 0x3c5c33, { y: 1.8 + i * 1.5 });
  }
  return { body: b.merge() };
}

function buildBench() {
  const b = new PartBuilder();
  b.add(box(1.8, 0.08, 0.5), 0x7a5a3a, { y: 0.45 });
  b.add(box(1.8, 0.5, 0.07), 0x7a5a3a, { y: 0.68, z: -0.21 });
  b.add(box(0.09, 0.45, 0.45), 0x33373b, { x: -0.75, y: 0.22 });
  b.add(box(0.09, 0.45, 0.45), 0x33373b, { x: 0.75, y: 0.22 });
  return { body: b.merge() };
}

function buildBin() {
  const b = new PartBuilder();
  b.add(cyl(0.28, 0.24, 0.9, 12), 0x2f3a35, { y: 0.45 });
  b.add(cyl(0.3, 0.3, 0.06, 12), 0x3d4a43, { y: 0.93 });
  return { body: b.merge() };
}

function buildPlanter() {
  const b = new PartBuilder();
  b.add(box(1.2, 0.55, 1.2), 0x6d6a63, { y: 0.28 });
  b.add(box(1.05, 0.1, 1.05), 0x3d3a33, { y: 0.56 });
  b.add(sphere(0.45, 8), 0x4f7038, { y: 0.8, sy: 0.7 });
  return { body: b.merge() };
}

function buildCycleStand() {
  const b = new PartBuilder();
  b.add(cyl(0.04, 0.04, 1.8, 8), 0x9aa0a6, { x: -0.35, y: 0 });
  b.add(cyl(0.04, 0.04, 1.8, 8), 0x9aa0a6, { x: 0.35, y: 0 });
  b.add(cyl(0.04, 0.04, 0.7, 8), 0x9aa0a6, { y: 0.9, rz: Math.PI / 2 });
  b.add(cyl(0.04, 0.04, 0.34, 8), 0x9aa0a6, { x: -0.35, y: 0.9, rx: Math.PI / 2 });
  b.add(cyl(0.04, 0.04, 0.34, 8), 0x9aa0a6, { x: 0.35, y: 0.9, rx: Math.PI / 2 });
  return { body: b.merge() };
}

function buildBusShelter() {
  const b = new PartBuilder();
  b.add(box(4.4, 0.12, 1.6), 0x3a3f45, { y: 2.5 });
  b.add(box(4.4, 0.1, 0.1), 0x4a4f55, { y: 2.62, z: -0.75 });
  b.add(box(0.12, 2.5, 0.12), 0x4a4f55, { x: -2.1, y: 1.25, z: -0.72 });
  b.add(box(0.12, 2.5, 0.12), 0x4a4f55, { x: 2.1, y: 1.25, z: -0.72 });
  b.add(box(4.4, 2.4, 0.08), 0x9fc4d8, { y: 1.3, z: -0.74 });
  b.add(box(1.7, 2.4, 0.08), 0x9fc4d8, { x: -1.35, y: 1.3, z: 0.74, ry: 0 });
  b.add(box(0.5, 2.4, 0.08), 0x9fc4d8, { x: 1.95, y: 1.3, z: 0.74 });
  b.add(box(4.2, 0.45, 0.5), 0x565b61, { y: 0.22 });
  return { body: b.merge() };
}

function buildBusFlag() {
  const b = new PartBuilder();
  b.add(cyl(0.06, 0.07, 2.6, 10), 0x4a4f55, { y: 1.3 });
  b.add(box(0.5, 0.36, 0.05), 0xd8483c, { x: 0.28, y: 2.4 });
  b.add(box(0.7, 0.05, 0.05), 0x4a4f55, { x: 0.38, y: 2.2 });
  return { body: b.merge() };
}

function buildBeacon() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.12, 0.16, 0.4, 10), 0x33373b, { y: 0.2 });
  b.add(cyl(0.06, 0.08, 2.6, 10), 0x45494f, { y: 1.5 });
  glow.add(sphere(0.24, 10), 0xffc83a, { y: 2.95 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildCatenary() {
  const b = new PartBuilder();
  b.add(cyl(0.16, 0.2, 0.5, 8), 0x3a3e43, { y: 0.25 });
  b.add(cyl(0.1, 0.14, 8.2, 8), 0x54595f, { y: 4.4 });
  b.add(box(2.6, 0.14, 0.14), 0x54595f, { x: 0.9, y: 8.1 });
  b.add(box(0.1, 0.5, 0.1), 0x54595f, { x: 2.0, y: 7.85 });
  return { body: b.merge() };
}

function buildMarkerPost() {
  const b = new PartBuilder();
  b.add(box(0.12, 1.0, 0.12), 0xe8e6df, { y: 0.5 });
  b.add(box(0.14, 0.22, 0.14), 0xd8483c, { y: 0.78 });
  return { body: b.merge() };
}

function buildTaxiSign() {
  const b = new PartBuilder();
  const glow = new PartBuilder();
  b.add(cyl(0.06, 0.07, 2.8, 10), 0x4a4f55, { y: 1.4 });
  glow.add(box(0.9, 0.42, 0.12), 0xf5d34a, { x: 0.45, y: 2.7 });
  return { body: b.merge(), glow: glow.merge() };
}

function buildBollardChainPost() {
  const b = new PartBuilder();
  b.add(cyl(0.07, 0.09, 1.1, 10), 0x2f3236, { y: 0.55 });
  b.add(sphere(0.085, 8), 0xd8d5cc, { y: 1.12 });
  return { body: b.merge() };
}

const BUILDERS = {
  bollard: buildBollard,
  bollardRemovable: buildBollardRemovable,
  lamp: buildLamp,
  lampHeritage: buildLampHeritage,
  floodMast: buildFloodMast,
  signal: buildSignal,
  sign: buildSign,
  tree: buildTree,
  conifer: buildConifer,
  bench: buildBench,
  bin: buildBin,
  planter: buildPlanter,
  cycleStand: buildCycleStand,
  busShelter: buildBusShelter,
  busFlag: buildBusFlag,
  beacon: buildBeacon,
  catenary: buildCatenary,
  markerPost: buildMarkerPost,
  taxiSign: buildTaxiSign,
  chainPost: buildBollardChainPost,
};

export const PROP_TYPE_LIST = Object.keys(BUILDERS);

let library = null;

export function getPropLibrary() {
  if (library) return library;
  library = {};
  const rng = makeRng(4242);
  for (const [name, builder] of Object.entries(BUILDERS)) {
    const built = builder(rng);
    if (built?.body) library[name] = built;
  }
  return library;
}

export function getPropMaterial() {
  if (!getPropMaterial._material) {
    getPropMaterial._material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.08,
    });
  }
  return getPropMaterial._material;
}

export function getGlowMaterial() {
  if (!getGlowMaterial._material) {
    getGlowMaterial._material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0xffffff,
      emissiveIntensity: 1,
      roughness: 0.4,
      metalness: 0,
      toneMapped: true,
    });
  }
  return getGlowMaterial._material;
}

/**
 * Collects prop placements and turns them into InstancedMeshes.
 * Usage: const props = new PropField(); props.add('lamp', matrix); props.build(group);
 */
export class PropField {
  constructor() {
    this.entries = new Map(); // type -> Matrix4[]
  }

  add(type, matrix) {
    let list = this.entries.get(type);
    if (!list) {
      list = [];
      this.entries.set(type, list);
    }
    list.push(matrix.clone ? matrix.clone() : new THREE.Matrix4().copy(matrix));
  }

  get count() {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

  /** Rebuild instanced meshes into a target THREE.Group (clearing it first). */
  build(group) {
    for (const child of group.children.slice()) {
      child.geometry?.dispose();
      group.remove(child);
    }
    const lib = getPropLibrary();
    for (const [type, matrices] of this.entries) {
      const def = lib[type];
      if (!def || !matrices.length) continue;
      for (const part of ['body', 'glow']) {
        const geometry = def[part];
        if (!geometry) continue;
        const material = part === 'glow' ? getGlowMaterial() : getPropMaterial();
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        mesh.name = `prop:${type}:${part}`;
        mesh.castShadow = part === 'body';
        mesh.receiveShadow = false;
        for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.userData.propType = type;
        group.add(mesh);
      }
    }
    return group;
  }
}

export function disposeProps() {
  if (!library) return;
  for (const def of Object.values(library)) {
    def.body?.dispose();
    def.glow?.dispose();
  }
  library = null;
}
