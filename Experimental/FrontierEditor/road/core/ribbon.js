// Frontier Road Editor — ribbon primitives.
//
// Everything the road mesher needs to turn a sampled centreline plus a cross
// section into surfaces: how high each band sits, where its kerbs are, and how
// to emit a run of stations as a strip. Kept separate from geometry.js so that
// markings, furniture and crossings all build on the same frames — a bollard
// and the kerb it stands on then agree on where the ground is by construction.

import { clamp, lerp, norm2 } from './math.js';
import { KERBS } from './styles.js';

export const DEFAULT_KERB_HEIGHT = 0.14;
export const MEDIAN_KERB_HEIGHT = 0.1;

/**
 * Vertical layout of a cross section.
 *
 * Each side is walked outwards from the centreline keeping a running height: a
 * kerb raises everything beyond it, so a footway and the verge outside it sit at
 * the same level without either being told. Returns the height of every band and
 * every kerb's two sides, so the kerb faces and the gutter fall out of the same
 * walk.
 */
export function surfaceLevels(profile) {
  const kerbs = (profile.kerbs || []).map((k) => ({
    offset: k.offset, side: k.side, type: k.type || KERBS['concrete-vertical'],
    innerBand: -1, outerBand: -1, yIn: 0, yOut: 0,
  }));
  const kerbAt = (side, offset, tol = 1e-6) =>
    kerbs.find((k) => k.side === side && Math.abs(Math.abs(k.offset) - Math.abs(offset)) < tol) || null;

  const median = profile.median;
  const medianY = !median ? 0
    : median.level === 'raised' ? (median.kerb ? (KERBS[median.kerb]?.height ?? MEDIAN_KERB_HEIGHT) : MEDIAN_KERB_HEIGHT)
      : 0;
  // A raised median is bounded by two kerbs like any other step: they are pushed
  // into the list here so the carriageway bands are inset by the kerbstone width
  // and the median top, the kerb face and the band meet two at a time.
  if (median && median.level === 'raised') {
    const kt = KERBS[median.kerb] || KERBS['median-low'];
    for (const side of [1, -1]) {
      kerbs.push({ offset: side * (profile.medianHalf || median.width / 2), side, type: kt, median: true, yIn: medianY, yOut: 0, innerBand: -1, outerBand: -1 });
    }
  }

  const bandY = new Map();
  const sideY = new Map();
  for (const side of profile.sides) {
    let y = side.sign === 1 || side.sign === -1 ? (median && median.level === 'raised' ? medianY : 0) : 0;
    const bands = side.bands;
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const inner = Math.abs(band.from) <= Math.abs(band.to) ? band.from : band.to;
      const outer = inner === band.from ? band.to : band.from;
      const k = kerbAt(band.side, inner);
      if (k) {
        // The kerb belongs to the pair (previous band, this band).
        k.outerBand = i;
        if (k.innerBand < 0) k.innerBand = i - 1;
        k.yIn = i > 0 ? (bandY.get(bands[i - 1]) ?? y) : y;
        y = k.yIn + k.type.height;
        k.yOut = y;
      } else if (band.level === 'raised' && i > 0 && (bandY.get(bands[i - 1]) ?? 0) === y) {
        // A raised band with no explicit kerb still steps up once.
        y = Math.max(y, DEFAULT_KERB_HEIGHT);
      }
      bandY.set(band, y);
      void outer;
    }
    sideY.set(side.sign, y);
  }

  // Kerbs whose band pair was not found (offset between two bands of one side
  // that are both missing) fall back to the interpolated side heights.
  for (const k of kerbs) {
    if (k.outerBand < 0 && k.innerBand < 0) { k.yIn = 0; k.yOut = Math.max(0, k.yIn + k.type.height); }
  }

  return { bandY, sideY, kerbs, medianY, median, kerbAt };
}

/** Height of one band (ascending from its side's median edge). */
export function bandHeight(profile, band) {
  return surfaceLevels(profile).bandY.get(band) ?? 0;
}

/** Signed inner/outer offsets of a band: inner is the edge nearer the centreline. */
export function bandEdges(band) {
  const inner = Math.abs(band.from) <= Math.abs(band.to) ? band.from : band.to;
  const outer = inner === band.from ? band.to : band.from;
  return { inner, outer };
}

/**
 * Stations the mesher walks for a road: the junction trims at both ends, with
 * the samples in between. Frames carry plan + elevation + frame vectors, so a
 * caller never needs the raw sample arrays.
 */
export function roadFrames(net, road, opts = {}) {
  const sm = net.sampleRoad(road);
  const jA = road.junctions.a, jB = road.junctions.b;
  const s0 = jA ? clamp(jA.trim, 0, sm.length) : 0;
  const s1 = jB ? clamp(sm.length - jB.trim, 0, sm.length) : sm.length;
  if (s1 - s0 < 0.5) return { frames: [], s0, s1, length: sm.length, splits: { aL: s0, aR: s0, bL: s1, bR: s1 }, empty: true };
  // Road-frame splits: which station each side's raised bands begin at. The
  // junction stores them in the arm's own frame, which runs outward from the
  // node — so at the far end they must be measured back from the end of the road
  // (and left and right swap, because reversing a direction swaps them).
  const splits = {
    aL: jA ? clamp(jA.splitLeft, s0, s1) : s0,
    aR: jA ? clamp(jA.splitRight, s0, s1) : s0,
    bL: jB ? clamp(sm.length - jB.splitRight, s0, s1) : s1,
    bR: jB ? clamp(sm.length - jB.splitLeft, s0, s1) : s1,
  };
  const stations = [s0];
  for (let i = 0; i < sm.count; i++) if (sm.s[i] > s0 + 1e-6 && sm.s[i] < s1 - 1e-6) stations.push(sm.s[i]);
  stations.push(s1);
  const frames = stations.map((s) => {
    const q = net.pointAt(road, s);
    return { s, p: q.p, dir: q.dir, left: q.left, grade: q.grade, y: q.p[1] };
  });
  return { frames, s0, s1, length: sm.length, splits, empty: false };
}

/**
 * Emit a strip between two rows, choosing the row order that winds each quad to
 * face up. A cross section is walked outwards on the left of a road and inwards
 * on the right, so a fixed order would leave half the network inside out; the
 * order is therefore decided from the first quad's own cross product.
 */
export function emitRows(mb, rowA, rowB, opts = {}) {
  let a = rowA, b = rowB;
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  // strip() emits quads as (A_i, B_i, B_i+1, A_i+1), so the first triangle is
  // (A_0, B_0, B_1): ask that one which way round the rows belong.
  if (crossY(rowA[0], rowB[0], rowB[1]) < 0) { a = rowB; b = rowA; }
  // A ribbon on a curve tighter than its own half width folds its outer rows over
  // themselves. A folded quad is inside out, so it is skipped rather than shipped
  // with a normal that disagrees with its winding — `opts.onFold` counts them and
  // the caller can report the geometry as unsuited to the section it was given.
  let emitted = 0;
  for (let i = 0; i < n - 1; i++) {
    const A0 = a[i], A1 = a[i + 1], B0 = b[i], B1 = b[i + 1];
    if (crossY(A0, B0, B1) <= 0 || crossY(A0, B1, A1) <= 0) { if (opts.onFold) opts.onFold(); continue; }
    const ns = opts.normals
      ? [[opts.normals[i], opts.normals[i + 1]]]
      : null;
    if (ns) {
      const [nA, nB] = [opts.normals[i], opts.normals[i + 1]];
      const face = faceNormal3(A0, B0, B1);
      const flipN = (v) => (v[0] * face[0] + v[1] * face[1] + v[2] * face[2] < 0 ? [-v[0], -v[1], -v[2]] : v);
      mb.quadP(A0, B0, B1, A1, {
        material: opts.material,
        normals: [flipN(nA), flipN(nB), flipN(nB), flipN(nA)],
        uv: opts.uvPair ? [opts.uvPair[0](i), opts.uvPair[1](i), opts.uvPair[1](i + 1), opts.uvPair[0](i + 1)] : undefined,
      });
    } else {
      mb.quadP(A0, B0, B1, A1, { material: opts.material });
    }
    emitted++;
  }
  return emitted;
}

/** Unit normal of the triangle (a, b, c), from its winding. */
function faceNormal3(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Y component of the normal of the triangle (a, b, c). */
function crossY(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return uz * vx - ux * vz + 0 * (uy * 0 - vy * 0);
}

/**
 * Emit a quad with its winding chosen so the surface faces `want`. Untagged
 * normals mean the mesh validator compares shading to geometry and always
 * agrees; choosing the winding is what makes the face visible from the side it
 * is meant to be seen, which on a kerb, a fascia or a signal arm is the whole
 * point.
 */
export function emitQuadOriented(mb, pts, material, want) {
  const p = pts.map((q) => (Array.isArray(q) ? q : [q[0], q[1], q[2]]));
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const dot = g[0] * want[0] + g[1] * want[1] + g[2] * want[2];
  if (dot >= 0) mb.quadP(p[0], p[1], p[2], p[3], { material });
  else mb.quadP(p[3], p[2], p[1], p[0], { material });
  return 1;
}

/**
 * Emit a flat plan-space polygon (marking, glyph, decal) guaranteed to face up.
 * Coincident corners are dropped and slivers are skipped: a paint run that clips
 * to a few centimetres at a junction mouth must not leave a degenerate tri in the
 * mesh, and a caller may list a glyph's corners in whatever order reads well.
 */
export function emitPlanFlat(mb, pts, material) {
  if (!pts || pts.length < 3) return 0;
  const clean = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[2] - p[2]) < 1e-6) continue;
    clean.push(p);
  }
  while (clean.length > 1) {
    const first = clean[0], last = clean[clean.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[2] - last[2]) < 1e-6) clean.pop();
    else break;
  }
  if (clean.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = clean.length - 1; i < clean.length; j = i++) {
    area += clean[j][0] * clean[i][2] - clean[i][0] * clean[j][2];
  }
  const p = area / 2 > 0 ? clean.slice().reverse() : clean;
  let n = 0;
  for (let i = 1; i + 1 < p.length; i++) {
    const a = p[0], b = p[i], c = p[i + 1];
    const twice = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(twice) < 1e-7) continue;
    mb.triP(a, b, c, { material });
    n++;
  }
  return n;
}

/** Point on the cross section at a station: frame + signed offset + height. */
export function crossPoint(frame, offset, height) {
  return [
    frame.p[0] + frame.left[0] * offset,
    frame.p[1] + (height || 0),
    frame.p[2] + frame.left[1] * offset,
  ];
}

/** A run of frames clipped to [sStart, sEnd], with exact frames at both ends. */
export function runBetween(frames, sStart, sEnd) {
  if (!frames.length || sEnd - sStart < 0.05) return [];
  const out = [frameAt(frames, sStart)];
  for (const f of frames) if (f.s > sStart + 1e-6 && f.s < sEnd - 1e-6) out.push(f);
  out.push(frameAt(frames, sEnd));
  return out;
}

/** A row of cross-section points along the run, ready for strip/wall. */
export function crossRow(frames, offset, height, from = 0, to = frames.length - 1) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(crossPoint(frames[i], offset, height));
  return out;
}

/** Rows between two stations (inclusive), for runs that start at a split. */
export function framesBetween(frames, sMin, sMax) {
  return frames.filter((f) => f.s >= sMin - 1e-6 && f.s <= sMax + 1e-6);
}

/** Surface normal of a band top at a frame: up, tilted by the deck grade. */
export function deckNormal(frame) {
  const d = frame.dir, g = frame.grade || 0;
  const l3 = Math.hypot(d[0], g, d[1]) || 1;
  const along = [d[0] / l3, g / l3, d[1] / l3];   // direction of travel, with grade
  const l = frame.left;
  const left3 = [l[0], 0, l[1]];          // lateral direction, horizontal
  const n = [
    along[1] * left3[2] - along[2] * left3[1],
    along[2] * left3[0] - along[0] * left3[2],
    along[0] * left3[1] - along[1] * left3[0],
  ];
  return n[1] >= 0 ? n : [-n[0], -n[1], -n[2]];
}

/**
 * Emit a horizontal band top between two signed offsets. `heightFrom`/
 * `heightTo` allow a camber: the surface drops from the inner to the outer edge.
 */
export function emitBandTop(mb, frames, inner, outer, height, material, opts = {}) {
  if (frames.length < 2) return 0;
  const camber = opts.camber ?? 0;
  const hIn = height + (opts.heightInner ?? 0);
  const hOut = height + (opts.heightOuter ?? 0);
  const rowInner = frames.map((f) => crossPoint(f, inner, hIn + Math.abs(inner) * -camber));
  const rowOuter = frames.map((f) => crossPoint(f, outer, hOut + Math.abs(outer) * -camber));
  const scale = opts.uvScale ?? 0.08;
  return emitRows(mb, rowInner, rowOuter, {
    material,
    normals: frames.map((f) => deckNormal(f)),
    uvPair: [
      (i) => [frames[i].s * scale, 0],
      (i) => [frames[i].s * scale, Math.abs(outer - inner) * scale * 4],
    ],
  });
}

/**
 * Emit one kerb run: gutter strip, face (vertical / batter / splay / rollover)
 * and the kerbstone top. `outward` is +1 or -1 along the left normal.
 */
export function emitKerb(mb, frames, kerb, opts = {}) {
  const t = kerb.type;
  const o = kerb.offset;
  const outward = kerb.side;
  const yIn = kerb.yIn, yOut = kerb.yOut;
  const rise = yOut - yIn;
  const batter = t.batter ?? (t.face === 'splay' ? t.width * 0.28 : 0);
  const topFrom = o + outward * batter;
  const topTo = o + outward * Math.max(batter, t.width);
  const mat = opts.material || t.material || 'concrete-kerb';
  // A kerb with no step to speak of is a set line, not a wall: it is drawn as one
  // flush strip covering exactly the strip the adjacent bands gave up, so the
  // surface still tiles and no third triangle meets the edge the bands share.
  const flush = Math.abs(rise) < 0.02;
  let tris = 0;

  // Gutter: the channel the kerb drains into, drawn in worn asphalt inside the
  // face so the kerb line reads from a distance.
  if (!flush && (t.channel ?? 0) > 0.01 && opts.gutter !== false) {
    emitRows(mb, crossRow(frames, o - outward * t.channel, yIn), crossRow(frames, o, yIn), {
      material: 'asphalt-worn',
      normals: frames.map((f) => deckNormal(f)),
      uvPair: [(i) => [frames[i].s * 0.08, 0], (i) => [frames[i].s * 0.08, t.channel * 0.4]],
    });
  }

  if (flush) {
    // Flush kerb: a set line at grade, no face. It covers exactly what the
    // adjacent bands gave up — from the gutter's inner edge to the inset the
    // raised band starts at — so the surface tiles instead of leaving a sliver.
    const from = o - outward * ((t.channel ?? 0) > 0.01 && opts.gutter !== false ? t.channel : 0);
    const to = o + outward * Math.max(t.width, batter ?? 0);
    emitRows(mb, crossRow(frames, from, yIn), crossRow(frames, to, yOut),
      { material: mat, normals: frames.map((f) => deckNormal(f)) });
    return 1;
  }

  // Which way the face looks: at the lower side, which is the side you see a
  // kerb from — the road for a footway kerb, the road again for a median kerb
  // whose raised strip is inside.
  const wantSign = -Math.sign(rise) * outward;
  const outN = (i) => {
    const l = frames[Math.min(i, frames.length - 1)].left;
    return [wantSign * l[0], 0, wantSign * l[1]];
  };
  if (t.face === 'rollover') {
    const midY = yIn + rise * 0.55;
    const midO = o + outward * (batter * 0.55);
    wallOriented(mb, crossRow(frames, midO, midY), crossRow(frames, o, yIn), mat, outN);
    wallOriented(mb, crossRow(frames, topFrom, yOut), crossRow(frames, midO, midY), mat, outN);
    tris += 2;
  } else {
    wallOriented(mb, crossRow(frames, topFrom, yOut), crossRow(frames, o, yIn), mat, outN);
    tris += 1;
  }

  // Kerbstone top (and the splay's shallow upper face).
  emitRows(mb, crossRow(frames, topFrom, yOut), crossRow(frames, topTo, yOut), {
    material: mat, normals: frames.map((f) => deckNormal(f)),
    uvPair: [(i) => [frames[i].s * 0.25, 0], (i) => [frames[i].s * 0.25, 1]],
  });
  return tris + 1;
}

/**
 * Extrude a closed plan loop as a flat cap at a height function, with an
 * optional skirt (kerb face) down to a lower height.
 */
export function emitLoopCap(mb, loop, heightAt, material, opts = {}) {
  if (!loop || loop.length < 3) return 0;
  const uvScale = opts.uvScale ?? 0.08;
  // earClip's `down` flag is the one that yields +Y-facing triangles under this
  // plan convention (up-facing loops have negative plan area), so a ceiling
  // passes down:false explicitly.
  mb.capHeights(loop, (p) => heightAt(p), material, uvScale, { down: opts.ceiling !== true });
  if (opts.skirt && opts.skirt.bottom != null) {
    const bottomAt = typeof opts.skirt.bottom === 'function' ? opts.skirt.bottom : () => opts.skirt.bottom;
    const topAt = (p) => heightAt(p) - 0.002;
    const N = loop.length;
    for (let i = 0; i < N; i++) {
      const a = loop[i], b = loop[(i + 1) % N];
      if (opts.skirt.only && !opts.skirt.only(a, b, i)) continue;
      mb.quadP(
        [a[0], topAt(a), a[1]], [b[0], topAt(b), b[1]],
        [b[0], bottomAt(b), b[1]], [a[0], bottomAt(a), a[1]],
        { material: opts.skirt.material || material, flip: !!opts.skirt.flip },
      );
    }
  }
  return 1;
}

/** Vertical wall between two rows, wound so each face points `normal(frame)`. */
export function wallOriented(mb, rowTop, rowBottom, material, normal) {
  const n = Math.min(rowTop.length, rowBottom.length);
  for (let i = 0; i < n - 1; i++) {
    const a = rowTop[i], b = rowTop[i + 1], c = rowBottom[i + 1], d = rowBottom[i];
    const key = typeof normal === 'function' ? normal(i) : normal;
    emitQuadOriented(mb, [a, b, c, d], material, key);
  }
  return n - 1;
}

/** Regular stations along a run, for furniture spacing. */
export function spacedStations(frames, spacing, offset = 0) {
  if (!frames.length) return [];
  const out = [];
  const start = frames[0].s + offset;
  const end = frames[frames.length - 1].s;
  for (let s = start; s <= end; s += spacing) out.push(s);
  return out;
}

/** Frame interpolated at a station inside a run (linear between frames). */
export function frameAt(frames, s) {
  if (!frames.length) return null;
  if (s <= frames[0].s) return frames[0];
  const last = frames[frames.length - 1];
  if (s >= last.s) return last;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].s < s) i++;
  const a = frames[i], b = frames[i + 1];
  const u = clamp((s - a.s) / Math.max(1e-9, b.s - a.s), 0, 1);
  const dir = norm2([lerp(a.dir[0], b.dir[0], u), lerp(a.dir[1], b.dir[1], u)]);
  return {
    s, dir, left: [dir[1], -dir[0]],
    p: [lerp(a.p[0], b.p[0], u), lerp(a.p[1], b.p[1], u), lerp(a.p[2], b.p[2], u)],
    grade: lerp(a.grade, b.grade, u), y: lerp(a.p[1], b.p[1], u),
  };
}
