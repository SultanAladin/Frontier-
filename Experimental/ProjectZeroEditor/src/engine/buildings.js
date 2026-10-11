// Perimeter-block massing.
//
// Buildings are deliberately simple extrusions: they exist to give the road network
// scale and enclosure, not to be architecture.  Each block is inset, then its street
// frontages are chopped into plots and extruded to a height driven by the zone.

import { getSurfaceMaterial } from './materials.js';
import { clamp, makeRng } from './util.js';
import { addOrientedBox } from './bridges.js';

const ZONE_HEIGHTS = {
  core: [22, 78],
  inner: [14, 34],
  suburb: [7, 16],
  outskirts: [5, 12],
  industrial: [8, 14],
};

function inset(polygon, amount) {
  const cx = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
  const cz = polygon.reduce((sum, p) => sum + p.z, 0) / polygon.length;
  return polygon.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const length = Math.hypot(dx, dz) || 1;
    const scale = Math.max(0, length - amount) / length;
    return { x: cx + dx * scale, z: cz + dz * scale };
  });
}

function polygonArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

export function buildMassing(blocks, ctx) {
  if (!blocks || !blocks.length) return 0;
  let count = 0;
  for (const block of blocks) {
    const rng = makeRng(block.seed || 1);
    const polygon = inset(block.polygon, 5.5);
    const area = polygonArea(polygon);
    if (area < 220) continue;
    const range = ZONE_HEIGHTS[block.zone] || ZONE_HEIGHTS.suburb;
    const baseHeight = rng.range(range[0], range[1]);

    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 12) continue;
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      const plots = clamp(Math.round(length / rng.range(13, 24)), 1, 8);
      for (let p = 0; p < plots; p++) {
        if (rng.chance(0.12)) continue; // gap / yard
        const t0 = p / plots;
        const t1 = (p + 1) / plots;
        const gap = 1.2 / length;
        const u0 = clamp(t0 + gap, 0, 1);
        const u1 = clamp(t1 - gap, 0, 1);
        if (u1 - u0 < 0.02) continue;
        const cx = (a.x + (b.x - a.x) * (u0 + u1) / 2);
        const cz = (a.z + (b.z - a.z) * (u0 + u1) / 2);
        const width = length * (u1 - u0);
        const depth = clamp(Math.min(area ** 0.5 * 0.3, 20), 9, 22);
        const height = clamp(baseHeight * rng.range(0.55, 1.35) * (rng.chance(0.12) ? 1.9 : 1), 4, 140);
        const groundY = ctx.terrain ? ctx.terrain.heightAt(cx, cz) : 0;
        // Step the plot back from the street frontage, towards the block centre.
        const cx0 = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
        const cz0 = polygon.reduce((sum, p) => sum + p.z, 0) / polygon.length;
        let ix = cx0 - cx;
        let iz = cz0 - cz;
        const il = Math.hypot(ix, iz) || 1;
        ix /= il;
        iz /= il;
        const px = cx + ix * (depth / 2);
        const pz = cz + iz * (depth / 2);
        const owner = 0;
        const facade = ctx.sink.at(px, pz, 'facade');
        addOrientedBox(facade, px, groundY + height / 2, pz, width, height, depth, yaw, owner, 0.28);
        // Roof slab.
        const roof = ctx.sink.at(px, pz, 'roof');
        addOrientedBox(roof, px, groundY + height + 0.35, pz, width * 0.98, 0.7, depth * 0.96, yaw, owner, 0.3);
        // Ground-floor plinth so the building meets the pavement.
        const plinth = ctx.sink.at(px, pz, 'concrete');
        addOrientedBox(plinth, px, groundY + 0.25, pz, width * 1.01, 0.5, depth * 1.02, yaw, owner, 0.3);
        count++;
      }
    }
  }
  return count;
}
