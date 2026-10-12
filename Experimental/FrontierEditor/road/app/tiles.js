// Frontier Road Editor — spatial tiling.
//
// The mesher produces one mesh per group for the whole network. Rendering that
// as a single buffer would mean drawing four hundred thousand triangles wherever
// the camera looks, so it is re-cut into tiles by triangle centroid: each tile
// carries its own compact vertex buffer and a bounding box the viewer can cull
// against. This is also the unit the transfer to the render thread works in.

import { MATERIALS } from '../core/styles.js';

export const TILE = 250;
export function colorFor(name) {
  const m = MATERIALS[name];
  const a = m?.albedo ?? [0.5, 0.5, 0.5];
  return [a[0], a[1], a[2], m?.emissive ?? 0];
}

/**
 * Split one group's geometry into tiles by triangle centroid, compacting the
 * vertices each tile actually uses. A tile is the unit of view culling.
 */
export function tile(group, geo, tileSize, out) {
  const { indices, positions, normals, materials, materialNames } = geo;
  const tint = materialNames.map(colorFor);
  const buckets = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
    const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
    const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
    const key = `${Math.floor(cx / tileSize)}:${Math.floor(cz / tileSize)}`;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(ia, ib, ic);
  }
  for (const [key, tris] of buckets) {
    const remap = new Map();
    const pos = [], nrm = [], col = [], idx = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of tris) {
      let r = remap.get(v);
      if (r === undefined) {
        r = remap.size;
        remap.set(v, r);
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        pos.push(x, y, z);
        nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        const c = tint[materials[v] | 0] || [0.5, 0.5, 0.5, 0];
        col.push(c[0], c[1], c[2], c[3]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      idx.push(r);
    }
    out.push({
      group,
      key,
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
      pos: new Float32Array(pos),
      nrm: new Float32Array(nrm),
      col: new Float32Array(col),
      idx: new Uint32Array(idx),
      tris: tris.length / 3,
    });
  }
}

