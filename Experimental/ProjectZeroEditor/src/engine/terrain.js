// Terrain height field, road-corridor grading and water bodies.

import * as THREE from 'three';
import { getSurfaceMaterialSet, getWaterTextures } from './textures.js';
import { getWaterMaterial } from './materials.js';
import { Grid2D, clamp, lerp, makeNoise2D, nearestOnPolyline, smoothstep } from './util.js';

export class Terrain {
  constructor(settings = {}) {
    this.amplitude = settings.amplitude ?? 7;
    this.scale = settings.scale ?? 620;
    this.seed = settings.seed ?? 1337;
    this.enabled = settings.enabled !== false;
    this.noise = makeNoise2D(this.seed);
    this.water = []; // { points, halfWidth, level, bedDrop }
    this.roadGrid = new Grid2D(18);
    this.roadSamples = 0;
    this.flattenRadius = 26;
    this.enabled = this.enabled;
  }

  /** Add a river / lake corridor that the height field is carved into. */
  addWater(points, width, level = null, bedDrop = 6) {
    const entry = {
      points: points.map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0 })),
      halfWidth: width / 2,
      level: level,
      bedDrop,
    };
    this.water.push(entry);
    return entry;
  }

  clearWater() {
    this.water.length = 0;
  }

  /** Raw (ungraded) ground height. */
  rawHeight(x, z) {
    if (!this.enabled) return 0;
    const n = this.noise.fbm(x / this.scale, z / this.scale, 4, 2.05, 0.5);
    const ridge = this.noise.fbm(x / (this.scale * 2.6) + 11.3, z / (this.scale * 2.6) - 4.7, 2, 2, 0.5);
    let height = n * this.amplitude + ridge * this.amplitude * 0.35;
    for (const body of this.water) {
      const near = nearestOnPolyline(body.points, x, z);
      const level = body.level ?? this.waterLevel(body);
      const bank = body.halfWidth * 1.9;
      if (near.dist < bank) {
        const t = smoothstep(bank, body.halfWidth * 0.85, near.dist);
        const bed = level - body.bedDrop * (1 - smoothstep(body.halfWidth, 0, near.dist));
        height = lerp(height, Math.min(height, bed), t);
      }
    }
    return height;
  }

  waterLevel(body) {
    if (body.level !== null && body.level !== undefined) return body.level;
    // Place the surface a little below the surrounding ground.
    let sum = 0;
    for (const point of body.points) sum += this.noise.fbm(point.x / this.scale, point.z / this.scale, 3) * this.amplitude;
    return sum / body.points.length - 2.4;
  }

  /** Height used by roads: the raw ground, before corridor grading. */
  roadHeight(x, z, fallback = 0) {
    return typeof fallback === 'number' ? this.rawHeight(x, z) : this.rawHeight(x, z);
  }

  setRoadSamples(samples) {
    this.roadGrid.clear();
    this.roadSamples = samples.length;
    for (const sample of samples) this.roadGrid.insert(sample.x, sample.z, sample);
  }

  /** Graded ground height: flattened towards the nearest road corridor. */
  heightAt(x, z) {
    const raw = this.rawHeight(x, z);
    if (!this.roadSamples) return raw;
    let best = null;
    let bestDist = Infinity;
    this.roadGrid.query(x, z, this.flattenRadius, (entry) => {
      const dx = entry.x - x;
      const dz = entry.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = entry.value;
      }
    });
    if (!best) return raw;
    const distance = Math.sqrt(bestDist);
    const blend = smoothstep(this.flattenRadius, this.flattenRadius * 0.28, distance);
    const target = (best.y ?? 0) - 0.18;
    // Never push the ground above a road that is already higher than the raw ground.
    return lerp(raw, Math.min(raw, target) > target ? target : Math.min(raw, target), blend * 0.92);
  }

  /**
   * Build the ground mesh into a sink.  Vertex colours carry grass / rock / sand
   * variation, and the mesh is chunked along with everything else.
   */
  build(sink, bounds) {
    if (!this.enabled) return 0;
    const margin = 260;
    const minX = bounds.minX - margin;
    const maxX = bounds.maxX + margin;
    const minZ = bounds.minZ - margin;
    const maxZ = bounds.maxZ + margin;
    const size = Math.max(maxX - minX, maxZ - minZ);
    const cells = clamp(Math.round(size / 14), 48, 340);
    const stepX = (maxX - minX) / cells;
    const stepZ = (maxZ - minZ) / cells;
    const heights = new Float32Array((cells + 1) * (cells + 1));

    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        heights[j * (cells + 1) + i] = this.heightAt(minX + i * stepX, minZ + j * stepZ);
      }
    }

    const set = getSurfaceMaterialSet('grass');
    const materialKey = 'terrain';
    if (!sink.materials.has(materialKey)) {
      sink.registerMaterial(
        materialKey,
        new THREE.MeshStandardMaterial({
          map: set.map,
          normalMap: set.normalMap,
          normalScale: new THREE.Vector2(0.6, 0.6),
          vertexColors: true,
          roughness: 0.96,
          metalness: 0,
          dithering: true,
        }),
      );
    }

    const chunkCells = Math.max(1, Math.floor(128 / Math.max(stepX, stepZ)));
    const heightAt = (i, j) => heights[j * (cells + 1) + i];
    const color = new THREE.Color();
    let triangles = 0;

    for (let cj = 0; cj < cells; cj += chunkCells) {
      for (let ci = 0; ci < cells; ci += chunkCells) {
        const i1 = Math.min(cells, ci + chunkCells);
        const j1 = Math.min(cells, cj + chunkCells);
        const builder = sink.at(minX + (ci + 0.5) * stepX, minZ + (cj + 0.5) * stepZ, materialKey);
        for (let j = cj; j < j1; j++) {
          for (let i = ci; i < i1; i++) {
            const x0 = minX + i * stepX;
            const x1 = minX + (i + 1) * stepX;
            const z0 = minZ + j * stepZ;
            const z1 = minZ + (j + 1) * stepZ;
            const hA = heightAt(i, j);
            const hB = heightAt(i + 1, j);
            const hC = heightAt(i + 1, j + 1);
            const hD = heightAt(i, j + 1);

            // Two triangles with a consistent diagonal.
            const quads = [
              [[x0, hA, z0], [x1, hB, z0], [x1, hC, z1], [x0, hD, z1]],
            ];
            for (const [p0, p1, p2, p3] of quads) {
              const slope = Math.min(1, (Math.abs(hB - hA) + Math.abs(hD - hA)) / (stepX * 0.9));
              const variation = (this.noise.fbm(x0 / 90, z0 / 90, 3) + 1) * 0.5;
              const dry = clamp(variation * 0.7 + slope * 0.9, 0, 1);
              color.setRGB(
                lerp(0.72, 0.96, dry) * lerp(0.92, 1.06, variation),
                lerp(0.86, 0.8, dry) * lerp(0.94, 1.04, variation),
                lerp(0.6, 0.52, dry),
              );
              builder.setColor(color.r, color.g, color.b);
              builder.quad(p0, p1, p2, p3, null, [
                [x0 / 6, z0 / 6],
                [x1 / 6, z0 / 6],
                [x1 / 6, z1 / 6],
                [x0 / 6, z1 / 6],
              ], 0);
              triangles += 2;
            }
          }
        }
      }
    }
    return triangles;
  }

  /** Water surface ribbons for every registered water body. */
  buildWater(sink, bounds) {
    if (!this.water.length) return 0;
    const materialKey = 'water';
    sink.registerMaterial(materialKey, getWaterMaterial());
    let triangles = 0;
    for (const body of this.water) {
      const level = body.level ?? this.waterLevel(body);
      const builder = sink.at(body.points[0].x, body.points[0].z, materialKey);
      for (let i = 0; i < body.points.length - 1; i++) {
        const a = body.points[i];
        const b = body.points[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const halfWidth = body.halfWidth;
        const p0 = [a.x + nx * halfWidth, level, a.z + nz * halfWidth];
        const p1 = [a.x - nx * halfWidth, level, a.z - nz * halfWidth];
        const p2 = [b.x - nx * halfWidth, level, b.z - nz * halfWidth];
        const p3 = [b.x + nx * halfWidth, level, b.z + nz * halfWidth];
        builder.quad(p0, p1, p2, p3, null, [
          [0, 0],
          [halfWidth * 2 * 0.05, 0],
          [halfWidth * 2 * 0.05, len * 0.05],
          [0, len * 0.05],
        ], 0);
        triangles += 2;
      }
    }
    return triangles;
  }
}

export function computeBounds(network, padding = 60) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const node of network.nodes.values()) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minZ = Math.min(minZ, node.z);
    maxZ = Math.max(maxZ, node.z);
  }
  if (!Number.isFinite(minX)) return { minX: -200, maxX: 200, minZ: -200, maxZ: 200, width: 400, height: 400 };
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
    width: maxX - minX + padding * 2,
    height: maxZ - minZ + padding * 2,
  };
}
