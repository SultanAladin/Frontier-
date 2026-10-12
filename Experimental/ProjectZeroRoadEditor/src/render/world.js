// Tiled road world. Roads are bucketed into 400 m tiles by their midpoint and
// junction pads by their node. Each tile keeps a signature of everything that
// feeds its geometry (road records, junction trims, pads). After an edit only
// tiles whose signature changed are rebuilt, and only the tiles near the camera
// are built per frame, so a 60 km city stays interactive.

import * as THREE from 'three';
import { centerlineOf } from '../core/model.js';
import { computeJunctions, trimFor } from '../core/junctions.js';
import { buildRoadBuckets, buildPadBuckets, BUCKETS } from '../core/geometry.js';
import { pointAt } from '../core/centerline.js';

export const TILE_SIZE = 400;
const BUILD_RADIUS = 3600; // metres: tiles beyond this are not built (or rebuilt) yet
const VIEW_RADIUS = 9000; // metres: built tiles beyond this are hidden
const FRAME_BUDGET_MS = 10;

const srgbToLinear = (c) => Math.pow(c, 2.2);

function emptyAcc() {
  const acc = {};
  for (const name of BUCKETS) acc[name] = { p: [], n: [], uv: [], c: [], i: [] };
  return acc;
}

function appendBucket(dst, src) {
  const base = dst.p.length / 3;
  for (let k = 0; k < src.p.length; k++) dst.p.push(src.p[k]);
  for (let k = 0; k < src.n.length; k++) dst.n.push(src.n[k]);
  for (let k = 0; k < src.uv.length; k++) dst.uv.push(src.uv[k]);
  for (let k = 0; k < src.c.length; k++) dst.c.push(src.c[k]);
  for (let k = 0; k < src.i.length; k++) dst.i.push(src.i[k] + base);
}

function toGeometry(M) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(M.p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(M.n, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(M.uv, 2));
  const col = new Float32Array(M.c.length);
  for (let k = 0; k < M.c.length; k++) col[k] = srgbToLinear(M.c[k]);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const useU32 = M.p.length / 3 > 65535;
  geo.setIndex(new THREE.BufferAttribute(useU32 ? new Uint32Array(M.i) : new Uint16Array(M.i), 1));
  geo.computeBoundingSphere();
  return geo;
}

function disposeGroup(group) {
  for (const child of group.children) child.geometry?.dispose();
  group.clear();
}

export class RoadWorld {
  constructor(scene, materials) {
    this.root = new THREE.Group();
    this.root.name = 'road-world';
    scene.add(this.root);
    this.materials = materials;
    this.tiles = new Map();
    this.project = null;
    this.junctions = null;
    this.roadsById = new Map();
    this.stats = { tiles: 0, dirty: 0, triangles: 0 };
  }

  static tileKey(x, z) {
    return `${Math.floor(x / TILE_SIZE)},${Math.floor(z / TILE_SIZE)}`;
  }

  /** Recompute membership and signatures for the whole project. Cheap; geometry is lazy. */
  setProject(project) {
    this.project = project;
    this.roadsById = new Map(project.roads.map((r) => [r.id, r]));
    this.junctions = computeJunctions(project, centerlineOf);

    const next = new Map();
    const ensure = (key) => {
      let t = next.get(key);
      if (!t) {
        t = { key, roads: [], pads: [], sig: [] };
        next.set(key, t);
      }
      return t;
    };
    for (const road of project.roads) {
      const cl = centerlineOf(road);
      const mid = pointAt(cl, (cl.s[0] + cl.s[cl.n - 1]) / 2);
      const t = ensure(RoadWorld.tileKey(mid.x, mid.z));
      t.roads.push(road.id);
      const trim = trimFor(this.junctions, road);
      t.sig.push(`${JSON.stringify(road)}|${trim.start.toFixed(3)},${trim.end.toFixed(3)}`);
    }
    for (const [nodeId, hull] of this.junctions.pads) {
      const node = project.nodes[nodeId];
      const t = ensure(RoadWorld.tileKey(node.x, node.z));
      t.pads.push(nodeId);
      t.sig.push(`pad:${nodeId}:${JSON.stringify(hull)}`);
    }

    // Reconcile with existing tile objects (keep their Three groups).
    const keys = new Set([...this.tiles.keys(), ...next.keys()]);
    for (const key of keys) {
      const fresh = next.get(key);
      const old = this.tiles.get(key);
      if (!fresh) {
        if (old) {
          this.root.remove(old.group);
          disposeGroup(old.group);
        }
        continue;
      }
      const sig = fresh.sig.join('\n');
      const tile = old || { key, group: new THREE.Group(), built: false, dirty: true, sig: '' };
      tile.roads = fresh.roads;
      tile.pads = fresh.pads;
      if (tile.sig !== sig) {
        tile.sig = sig;
        tile.dirty = true;
      }
      if (!old) {
        tile.group.name = `tile ${key}`;
        this.root.add(tile.group);
      }
      next.set(key, tile);
    }
    this.tiles = next;
    this.stats.tiles = next.size;
    this.stats.dirty = [...next.values()].filter((t) => t.dirty).length;
  }

  /** Rebuild dirty tiles nearest to the camera, within a per-frame time budget. */
  update(cameraPos, { budgetMs = FRAME_BUDGET_MS, all = false } = {}) {
    const started = performance.now();
    const list = [];
    for (const tile of this.tiles.values()) {
      const cx = (Number(tile.key.split(',')[0]) + 0.5) * TILE_SIZE;
      const cz = (Number(tile.key.split(',')[1]) + 0.5) * TILE_SIZE;
      const d = Math.hypot(cx - cameraPos.x, cz - cameraPos.z);
      tile.distance = d;
      tile.group.visible = tile.built && !tile.dirty && d < VIEW_RADIUS;
      if (tile.dirty && (all || d < BUILD_RADIUS)) list.push(tile);
    }
    list.sort((a, b) => a.distance - b.distance);
    let built = 0;
    for (const tile of list) {
      if (!all && built > 0 && performance.now() - started > budgetMs) break;
      this.rebuild(tile);
      tile.group.visible = tile.distance < VIEW_RADIUS;
      built++;
    }
    this.stats.dirty = [...this.tiles.values()].filter((t) => t.dirty).length;
    this.stats.triangles = this.triangleCount();
    return built;
  }

  rebuild(tile) {
    disposeGroup(tile.group);
    const acc = emptyAcc();
    for (const id of tile.roads) {
      const road = this.roadsById.get(id);
      if (!road) continue;
      const cl = centerlineOf(road);
      const B = buildRoadBuckets(road, cl, trimFor(this.junctions, road));
      for (const name of BUCKETS) appendBucket(acc[name], B[name]);
    }
    for (const id of tile.pads) {
      const hull = this.junctions.pads.get(id);
      if (!hull) continue;
      const B = buildPadBuckets(hull);
      for (const name of BUCKETS) appendBucket(acc[name], B[name]);
    }
    for (const name of BUCKETS) {
      const M = acc[name];
      if (!M.i.length) continue;
      const mesh = new THREE.Mesh(toGeometry(M), this.materials[name]);
      mesh.name = `${tile.key}:${name}`;
      mesh.renderOrder = name === 'mask' ? -1 : 0;
      tile.group.add(mesh);
    }
    tile.dirty = false;
    tile.built = true;
  }

  /** Build everything now (export, screenshots). */
  buildAll() {
    let guard = 0;
    while ([...this.tiles.values()].some((t) => t.dirty) && guard++ < 100000) {
      for (const t of this.tiles.values()) if (t.dirty) this.rebuild(t);
    }
    for (const t of this.tiles.values()) t.group.visible = true;
  }

  triangleCount() {
    let n = 0;
    for (const t of this.tiles.values()) {
      if (!t.built) continue;
      for (const m of t.group.children) n += m.geometry.index.count / 3;
    }
    return n;
  }
}
