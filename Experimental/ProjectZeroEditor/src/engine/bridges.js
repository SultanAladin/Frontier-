// Bridge decks, viaduct piers, abutments and tunnel linings.

import { getSurfaceMaterial } from './materials.js';
import { clamp, polylineLength } from './util.js';
import { frameAt, pointAt } from './markings.js';

/** Axis-aligned-ish box placed in world space with a yaw rotation. */
export function addOrientedBox(builder, cx, cy, cz, sx, sy, sz, yaw, owner, uvScale = 0.35) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hx = sx / 2;
  const hz = sz / 2;
  const corner = (dx, dz) => [cx + dx * c - dz * s, cy, cz + dx * s + dz * c];
  const p = [
    corner(-hx, -hz),
    corner(hx, -hz),
    corner(hx, hz),
    corner(-hx, hz),
  ];
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const ring = p.map((q) => [q[0], 0, q[2]]);
  const uv = (i, v) => [i * sx * uvScale, v * sy * uvScale];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    builder.quad(
      [ring[i][0], y1, ring[i][2]],
      [ring[j][0], y1, ring[j][2]],
      [ring[j][0], y0, ring[j][2]],
      [ring[i][0], y0, ring[i][2]],
      null,
      [[i * sx * uvScale, sy * uvScale], [(i + 1) * sx * uvScale, sy * uvScale], [(i + 1) * sx * uvScale, 0], [i * sx * uvScale, 0]],
      owner,
    );
  }
  // top
  builder.quad([ring[3][0], y1, ring[3][2]], [ring[2][0], y1, ring[2][2]], [ring[1][0], y1, ring[1][2]], [ring[0][0], y1, ring[0][2]],
    null, [[0, 0], [sx * uvScale, 0], [sx * uvScale, sz * uvScale], [0, sz * uvScale]], owner);
  // bottom
  builder.quad([ring[0][0], y0, ring[0][2]], [ring[1][0], y0, ring[1][2]], [ring[2][0], y0, ring[2][2]], [ring[3][0], y0, ring[3][2]],
    null, [[0, 0], [sx * uvScale, 0], [sx * uvScale, sz * uvScale], [0, sz * uvScale]], owner);
  return uv;
}

/** Box spanning a range of stations, following the road's centre-line. */
function addDeckBox(ctx, prepared, { from, to, offset, width, top, bottom, materialKey, owner }) {
  const stations = prepared.stations.filter((st) => st.s >= from - 0.6 && st.s <= to + 0.6);
  if (stations.length < 2) return;
  const material = getSurfaceMaterial(materialKey);
  const inv = 1 / (material.userData.metersPerTile || 4);
  const o0 = offset - width / 2;
  const o1 = offset + width / 2;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const builder = ctx.sink.at(a.p.x, a.p.z, materialKey);
    const aT = pointAt(a, o0, top);
    const aB = pointAt(a, o0, bottom);
    const bT = pointAt(a, o1, top);
    const bB = pointAt(a, o1, bottom);
    const cT = pointAt(b, o1, top);
    const cB = pointAt(b, o1, bottom);
    const dT = pointAt(b, o0, top);
    const dB = pointAt(b, o0, bottom);
    // sides
    builder.quad(aT, dT, dB, aB, null, [
      [a.s * inv, top * inv],
      [b.s * inv, top * inv],
      [b.s * inv, bottom * inv],
      [a.s * inv, bottom * inv],
    ], owner);
    builder.quad(cT, bT, bB, cB, null, [
      [a.s * inv, top * inv],
      [b.s * inv, top * inv],
      [b.s * inv, bottom * inv],
      [a.s * inv, bottom * inv],
    ], owner);
    // soffit
    builder.quad(aB, bB, cB, dB, null, [
      [o0 * inv, a.s * inv],
      [o1 * inv, a.s * inv],
      [o1 * inv, b.s * inv],
      [o0 * inv, b.s * inv],
    ], owner);
  }
}

/** Bridge: deck slab, piers, abutments and expansion joints. */
function buildBridge(prepared, ctx) {
  const { cross, road, length, deckHeight } = prepared;
  const owner = ctx.ownerOf(road.id);
  const thickness = clamp(cross.totalWidth * 0.045, 0.9, 2.4);
  const deckBottom = -thickness;
  const ramp = clamp(Math.min(length * 0.35, 34), 8, 60);
  const spanStart = ramp;
  const spanEnd = length - ramp;

  addDeckBox(ctx, prepared, {
    from: 0,
    to: length,
    offset: 0,
    width: cross.totalWidth * 0.98,
    top: -0.04,
    bottom: deckBottom,
    materialKey: 'wall',
    owner,
  });

  // Piers underneath the spanning section.
  if (spanEnd - spanStart > 12) {
    const spacing = clamp(deckHeight * 3.2, 18, 42);
    for (let s = spanStart + spacing * 0.5; s < spanEnd; s += spacing) {
      const frame = frameAt(prepared, s);
      const groundY = ctx.terrain ? ctx.terrain.heightAt(frame.p.x, frame.p.z) : 0;
      const deckY = frame.p.y + deckBottom;
      const height = Math.max(1.5, deckY - groundY);
      const pierWidth = clamp(cross.totalWidth * 0.14, 1.2, 3);
      const yaw = Math.atan2(frame.t[0], frame.t[2]);
      const rows = cross.totalWidth > 18 ? [-cross.totalWidth * 0.24, cross.totalWidth * 0.24] : [0];
      for (const offset of rows) {
        const p = pointAt(frame, offset, deckBottom - height / 2);
        const builder = ctx.sink.at(p[0], p[2], 'wall');
        addOrientedBox(builder, p[0], p[1], p[2], pierWidth, height, pierWidth * 1.4, yaw, owner);
        // Pier cap.
        const cap = pointAt(frame, offset, deckBottom - 0.25);
        addOrientedBox(ctx.sink.at(cap[0], cap[2], 'wall'), cap[0], cap[1], cap[2], pierWidth * 1.7, 0.5, cross.totalWidth * 0.7, yaw, owner);
      }
    }
  }

  // Abutments: solid banks closing the ends of the deck.
  for (const s of [ramp * 0.85, length - ramp * 0.85]) {
    const frame = frameAt(prepared, s);
    const groundY = ctx.terrain ? ctx.terrain.heightAt(frame.p.x, frame.p.z) : 0;
    const deckY = frame.p.y + deckBottom;
    if (deckY - groundY < 0.6) continue;
    const yaw = Math.atan2(frame.t[0], frame.t[2]);
    const p = pointAt(frame, 0, deckBottom - (deckY - groundY) / 2);
    addOrientedBox(
      ctx.sink.at(p[0], p[2], 'wall'),
      p[0],
      p[1],
      p[2],
      cross.totalWidth * 0.98,
      deckY - groundY,
      2.2,
      yaw,
      owner,
    );
  }
}

/** Tunnel: roof slab over the covered section and portal headwalls. */
function buildTunnel(prepared, ctx) {
  const { cross, road, length, depth, dy } = prepared;
  const owner = ctx.ownerOf(road.id);
  const envelope = cross.envelope;
  if (!envelope) return;
  const roofHeight = envelope.h;
  const wallSpan = (envelope.right - envelope.left) * 0.5;

  // Covered section: where the road has dropped away from the surface.
  let coveredFrom = 0;
  let coveredTo = length;
  for (let s = 0; s < length; s += 2) {
    if (dy(s) < -1.6) {
      coveredFrom = s;
      break;
    }
  }
  for (let s = length; s > 0; s -= 2) {
    if (dy(s) < -1.6) {
      coveredTo = s;
      break;
    }
  }
  if (coveredTo - coveredFrom < 4) return;

  // Roof slab.
  addDeckBox(ctx, prepared, {
    from: coveredFrom,
    to: coveredTo,
    offset: (envelope.left + envelope.right) / 2,
    width: (envelope.right - envelope.left) * 0.98,
    top: roofHeight + 1.1,
    bottom: roofHeight,
    materialKey: 'wall',
    owner,
  });

  // Portal headwall at each end of the covered section.
  for (const s of [coveredFrom, coveredTo]) {
    const frame = frameAt(prepared, s);
    const yaw = Math.atan2(frame.t[0], frame.t[2]);
    const p = pointAt(frame, (envelope.left + envelope.right) / 2, roofHeight / 2);
    addOrientedBox(
      ctx.sink.at(p[0], p[2], 'wall'),
      p[0],
      p[1],
      p[2],
      (envelope.right - envelope.left) * 1.04,
      roofHeight,
      1.6,
      yaw,
      owner,
    );
  }
}

export function buildStructures(prepared, ctx) {
  if (prepared.structure === 'bridge') buildBridge(prepared, ctx);
  else if (prepared.structure === 'tunnel') buildTunnel(prepared, ctx);
}
