// Build orchestration: turns the network document into chunked render meshes.

import * as THREE from 'three';
import { GeometrySink } from './meshBuilder.js';
import { Network } from './network.js';
import { Terrain, computeBounds } from './terrain.js';
import { prepareRoad, buildRoadSurface, sampleRoadStations } from './roadBuilder.js';
import { buildJunctions, roundaboutMetrics } from './junctions.js';
import { buildRoadMarkings, buildJunctionMarkings } from './markings.js';
import { buildRoadDetails, buildAutomaticFurniture } from './details.js';
import { buildStructures } from './bridges.js';
import { buildSubway } from './subway.js';
import { buildMassing } from './buildings.js';
import { PropField } from './props.js';
import { clamp, smoothstep } from './util.js';

const RAMP = 2.6;

export class RoadWorld {
  constructor(network, options = {}) {
    this.network = network || new Network();
    this.chunkSize = options.chunkSize ?? 256;
    this.spacing = options.spacing ?? 4;
    this.group = new THREE.Group();
    this.group.name = 'road-world';
    this.chunkGroup = new THREE.Group();
    this.propGroup = new THREE.Group();
    this.group.add(this.chunkGroup, this.propGroup);
    this.terrain = new Terrain(this.network.settings.terrain);
    this.ownerKeys = [];
    this.ownerIds = new Map();
    this.props = new PropField();
    this.showFurniture = true;
    this.showBuildings = true;
    this.lastStats = null;
    this.prepared = new Map();
  }

  /** Stable integer id used for GPU-side picking. */
  ownerOf(key) {
    let id = this.ownerIds.get(key);
    if (id === undefined) {
      id = this.ownerKeys.length + 1;
      this.ownerKeys.push(key);
      this.ownerIds.set(key, id);
    }
    return id;
  }

  keyForOwner(id) {
    return this.ownerKeys[id - 1];
  }

  dispose() {
    for (const child of this.chunkGroup.children.slice()) {
      child.traverse?.((node) => node.geometry?.dispose());
      this.chunkGroup.remove(child);
    }
    for (const child of this.propGroup.children.slice()) {
      child.geometry?.dispose();
      this.propGroup.remove(child);
    }
  }

  /** Rebuild everything.  `options.silent` skips emitting progress. */
  rebuild(options = {}) {
    const started = performance.now();
    this.dispose();
    const network = this.network;
    const sink = new GeometrySink(this.chunkSize);
    this.props = new PropField();
    const terrainSettings = network.settings.terrain || {};
    this.terrain = new Terrain(terrainSettings);
    if (network.settings.river) {
      this.terrain.addWater(network.settings.river.points, network.settings.river.width, network.settings.river.level ?? null);
    }

    const ctx = {
      network,
      sink,
      terrain: this.terrain,
      spacing: this.spacing,
      ownerOf: (key) => this.ownerOf(key),
      props: this.props,
      driveSide: network.settings.driveSide,
      roundaboutMetrics,
      prepared: new Map(),
      roadsByNode: new Map(),
      junctionBlend: new Map(),
      markingMaterials: new Map(),
    };
    this.ctx = ctx;

    // --- 1. sample every road -------------------------------------
    const preparedList = [];
    for (const road of network.roads.values()) {
      if (road.visible === false) continue;
      const prepared = prepareRoad(road, ctx);
      if (!prepared) continue;
      prepared.road = road;
      ctx.prepared.set(road.id, prepared);
      preparedList.push(prepared);
    }
    this.prepared = ctx.prepared;

    // --- 2. node index and junction patches ------------------------
    for (const prepared of preparedList) {
      for (const nodeId of prepared.road.nodeIds) {
        let list = ctx.roadsByNode.get(nodeId);
        if (!list) {
          list = [];
          ctx.roadsByNode.set(nodeId, list);
        }
        list.push(prepared.road.id);
      }
    }

    ctx.junctionBlend = buildJunctions(ctx);

    // --- 3. blend footways down into junctions ---------------------
    for (const prepared of preparedList) {
      const ids = prepared.road.nodeIds;
      const startBlend = ctx.junctionBlend.get(ids[0]) ?? 0;
      const endBlend = ctx.junctionBlend.get(ids[ids.length - 1]) ?? 0;
      for (const station of prepared.stations) {
        let grade = 1;
        if (startBlend > 0) grade = Math.min(grade, smoothstep(startBlend, startBlend + RAMP, station.s));
        if (endBlend > 0) grade = Math.min(grade, smoothstep(endBlend, endBlend + RAMP, prepared.length - station.s));
        station.grade = grade;
      }
    }

    // --- 4. smooth conflicting heights where corridors meet --------
    const samples = [];
    for (const prepared of preparedList) {
      for (const station of prepared.stations) samples.push(station);
    }
    smoothHeights(samples, this.terrain);
    this.terrain.setRoadSamples(samples);

    // --- 5. surfaces, markings, details, structures ----------------
    for (const prepared of preparedList) {
      buildRoadSurface(prepared, ctx);
      buildStructures(prepared, ctx);
    }
    for (const prepared of preparedList) buildRoadMarkings(prepared, ctx);
    buildJunctionMarkings(ctx);
    if (this.showFurniture) {
      for (const prepared of preparedList) {
        buildRoadDetails(prepared, ctx);
        buildAutomaticFurniture(prepared, ctx);
      }
    }

    // --- 6. subway -------------------------------------------------
    for (const line of network.subways.values()) {
      if (line.visible === false) continue;
      buildSubway(line, ctx);
    }

    // --- 7. terrain, water and massing ------------------------------
    const bounds = computeBounds(network, 120);
    this.bounds = bounds;
    const terrainTriangles = this.terrain.build(sink, bounds);
    const waterTriangles = this.terrain.buildWater(sink, bounds);
    let buildings = 0;
    if (this.showBuildings && network.settings.massing?.length) {
      buildings = buildMassing(network.settings.massing, ctx);
    }

    // --- 8. commit to the scene -------------------------------------
    const chunks = sink.build({ castShadow: false, receiveShadow: true });
    for (const chunk of chunks) this.chunkGroup.add(chunk.group);
    if (this.showFurniture) this.props.build(this.propGroup);

    let triangles = terrainTriangles + waterTriangles;
    for (const chunk of chunks) triangles += chunk.triangles;

    this.lastStats = {
      chunks: chunks.length,
      triangles,
      terrainTriangles,
      props: this.props.count,
      buildings,
      roads: preparedList.length,
      junctions: ctx.junctionBlend.size,
      ms: Math.round(performance.now() - started),
    };
    if (options.onStats) options.onStats(this.lastStats);
    return this.lastStats;
  }

  /** Pick a road/subway id from a raycast intersection. */
  ownerFromIntersection(intersection) {
    const object = intersection.object;
    const owners = object?.userData?.owner;
    if (!owners || !intersection.faceIndex) return null;
    const id = owners[intersection.faceIndex];
    return id ? this.keyForOwner(id) : null;
  }

  /** Terrain height, honouring corridor grading. */
  groundHeight(x, z) {
    return this.terrain.heightAt(x, z);
  }
}

/**
 * Nudge overlapping corridors towards a shared height so junctions sit flat and the
 * grading pass has a single target per location.
 */
function smoothHeights(samples, terrain) {
  if (!samples.length) return;
  const cell = 14;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const sample of samples) {
    const k = key(sample.p.x, sample.p.z);
    let bucket = grid.get(k);
    if (!bucket) {
      bucket = [];
      grid.set(k, bucket);
    }
    bucket.push(sample);
  }
  const targets = new Float32Array(samples.length);
  const radius = 16;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const cx = Math.floor(sample.p.x / cell);
    const cz = Math.floor(sample.p.z / cell);
    let sum = 0;
    let count = 0;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const bucket = grid.get(`${cx + ix},${cz + iz}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const dx = other.p.x - sample.p.x;
          const dz = other.p.z - sample.p.z;
          if (dx * dx + dz * dz > radius * radius) continue;
          sum += other.p.y;
          count++;
        }
      }
    }
    targets[i] = count ? sum / count : sample.p.y;
  }
  // Blend towards the neighbourhood average, but never above the raw ground.
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const ground = terrain.rawHeight(sample.p.x, sample.p.z);
    const target = Math.min(targets[i], ground + 0.4);
    sample.p.y = clamp(sample.p.y + (target - sample.p.y) * 0.85, ground - 14, ground + 8);
    sample.smoothedY = sample.p.y;
  }
}
