// Frontier Road Editor — surface detail.
//
// Markings, furniture, speed control, crossings and rail track. Everything is
// built on the ribbon frames, so a stop bar lands on the kerb line it belongs
// to, a signal head stands on the corner it faces, and a rail crossing sits on
// the same deck as the asphalt it interrupts. Paint and furniture never guess a
// height: they ask the frame they were placed on.

import { clamp, lerp } from './math.js';
import { MARKINGS, FURNITURE, KERBS, ROAD_CLASSES } from './styles.js';
import {
  bandEdges, crossPoint, emitPlanFlat, emitQuadOriented, frameAt, spacedStations, surfaceLevels,
} from './ribbon.js';

const GAUGE = 1.435;
const PAINT_LIFT = 0.014;

// ── painting ────────────────────────────────────────────────────────────────-

/** Plan point at (station, offset) with a height. */
function pt(frame, offset, y, along = 0) {
  const q = crossPoint(frame, offset, 0);
  return [q[0] + frame.dir[0] * along, y, q[2] + frame.dir[1] * along];
}

const DASH_CACHE = new Map();
function dashOn(spec, d) {
  const dash = spec.dash ?? 0;
  if (!dash) return true;
  const gap = spec.gap ?? dash;
  const key = `${dash}:${gap}`;
  let fn = DASH_CACHE.get(key);
  if (!fn) { const period = dash + gap; fn = (x) => (x % period) < dash; DASH_CACHE.set(key, fn); }
  return fn(d);
}

/**
 * Paint one line along a run at a cross-section offset: solid, dashed, double or
 * zig-zag, on the surface the offset belongs to.
 */
export function emitLine(mb, frames, offset, spec, opts, heightOf) {
  if (!spec || frames.length < 2) return 0;
  const material = opts.material || spec.material || 'marking-white';
  const w = spec.width ?? 0.12;
  const step = opts.step ?? (spec.dash ? Math.min(2.0, (spec.dash + (spec.gap ?? 0)) / 2) : 2.5);
  const s0 = frames[0].s + (opts.padStart ?? 0);
  const s1 = frames[frames.length - 1].s - (opts.padEnd ?? 0);
  const offs = spec.double
    ? [offset - (w + (spec.gapBetween ?? 0.1)) / 2, offset + (w + (spec.gapBetween ?? 0.1)) / 2]
    : [offset];
  let quads = 0;
  for (let s = s0; s < s1; s += step) {
    const sm = Math.min(s + step, s1);
    const a = frameAt(frames, s), b = frameAt(frames, sm);
    if (!opts.solid && !dashOn(spec, (s + sm) / 2 - frames[0].s)) continue;
    for (const o of offs) {
      const ya = heightOf(a, o) + (opts.lift ?? PAINT_LIFT);
      const yb = heightOf(b, o) + (opts.lift ?? PAINT_LIFT);
      quads += emitPlanFlat(mb, [
        pt(a, o - w / 2, ya), pt(a, o + w / 2, ya), pt(b, o + w / 2, yb), pt(b, o - w / 2, yb),
      ], material);
    }
  }
  // Zig-zag (school zone): a chevron run beside the straight kerb line.
  if (spec.zigzag) {
    for (let s = s0; s < s1; s += (spec.dash ?? 1) + (spec.gap ?? 0.6)) {
      const a = frameAt(frames, s), b = frameAt(frames, Math.min(s + (spec.dash ?? 1), s1));
      const ya = heightOf(a, offset) + (opts.lift ?? PAINT_LIFT);
      const yb = heightOf(b, offset) + (opts.lift ?? PAINT_LIFT);
      quads += emitPlanFlat(mb, [
        pt(a, offset - 0.35, ya), pt(a, offset + 0.35, ya), pt(b, offset + 0.75, yb), pt(b, offset + 0.05, yb),
      ], material);
    }
  }
  return quads;
}

/** A stripe across the carriageway at a station. */
export function emitTransverse(mb, frame, fromOffset, toOffset, width, y, material, opts = {}) {
  if (!frame) return 0;
  const a = pt(frame, fromOffset, y, -width / 2);
  const b = pt(frame, toOffset, y, -width / 2);
  const c = pt(frame, toOffset, y, width / 2);
  const d = pt(frame, fromOffset, y, width / 2);
  if (opts.dash && Math.abs(opts.dash) > 0.01) {
    // Dashed transverse line: stripes along the band, not across it.
    const dash = opts.dash, gap = opts.gap ?? dash;
    const span = toOffset - fromOffset;
    const n = Math.max(1, Math.floor(Math.abs(span) / (dash + gap)));
    const pitch = span / n;
    let count = 0;
    for (let k = 0; k < n; k += 2) {
      const o0 = fromOffset + k * pitch;
      const o1 = fromOffset + (k + 1) * pitch;
      count += emitPlanFlat(mb, [pt(frame, o0, y, -width / 2), pt(frame, o1, y, -width / 2), pt(frame, o1, y, width / 2), pt(frame, o0, y, width / 2)], material);
    }
    return count;
  }
  return emitPlanFlat(mb, [a, b, c, d], material);
}

/** Zebra crossing acaross the carriageway at a station. */
export function emitZebra(mb, frame, fromOffset, toOffset, spec, opts = {}) {
  if (!frame) return 0;
  const stripe = spec.stripe ?? 0.6, gap = spec.gap ?? 0.6;
  const material = opts.material || spec.material || 'marking-white';
  const dirSign = Math.sign(toOffset - fromOffset) || 1;
  const total = Math.abs(toOffset - fromOffset);
  const count = Math.max(2, Math.round(total / (stripe + gap)));
  const pitch = total / count;
  const bar = opts.barLength ?? 3.2;
  const y = opts.y ?? 0;
  let quads = 0;
  for (let k = 0; k < count; k++) {
    const o0 = fromOffset + dirSign * k * pitch;
    const o1 = o0 + dirSign * Math.min(stripe, pitch * 0.75);
    quads += emitPlanFlat(mb, [
      pt(frame, o0, y, -bar / 2), pt(frame, o1, y, -bar / 2), pt(frame, o1, y, bar / 2), pt(frame, o0, y, bar / 2),
    ], material);
  }
  return quads;
}

// Glyphs in (along, across) metres, relative to the symbol's anchor. A driver
// reads them heading `along`.
const GLYPHS = {
  'arrow-straight': (s) => { const w = s * 0.13; return [[[0, -w], [s * 0.66, -w], [s * 0.66, w], [0, w]], [[s * 0.66, -s * 0.3], [s * 0.66, s * 0.3], [s, 0]]]; },
  'arrow-left': (s) => {
    const w = s * 0.13;
    return [
      [[0, -w], [s * 0.55, -w], [s * 0.55, w], [0, w]],
      [[s * 0.42, -w], [s * 0.62, -w], [s * 0.62, -s * 0.3], [s * 0.42, -s * 0.3]],
      [[s * 0.25, -s * 0.22], [s * 0.79, -s * 0.22], [s * 0.52, -s * 0.42]],
    ];
  },
  'arrow-right': (s) => {
    const w = s * 0.13;
    return [
      [[0, -w], [s * 0.55, -w], [s * 0.55, w], [0, w]],
      [[s * 0.42, w], [s * 0.62, w], [s * 0.62, s * 0.3], [s * 0.42, s * 0.3]],
      [[s * 0.25, s * 0.22], [s * 0.79, s * 0.22], [s * 0.52, s * 0.42]],
    ];
  },
  'arrow-straight-left': (s) => {
    const w = s * 0.13;
    return [
      [[0, -w], [s * 0.62, -w], [s * 0.62, w], [0, w]],
      [[s * 0.5, -s * 0.16], [s * 0.68, -s * 0.16], [s * 0.68, -s * 0.34], [s * 0.5, -s * 0.34]],
      [[s * 0.36, -s * 0.28], [s * 0.82, -s * 0.28], [s * 0.59, -s * 0.46]],
      [[s * 0.62, -w], [s, -w], [s, w], [s * 0.62, w]],
      [[s, -s * 0.3], [s, s * 0.3], [s * 1.28, 0]],
    ];
  },
  'arrow-straight-right': (s) => {
    const w = s * 0.13;
    return [
      [[0, -w], [s * 0.62, -w], [s * 0.62, w], [0, w]],
      [[s * 0.5, s * 0.16], [s * 0.68, s * 0.16], [s * 0.68, s * 0.34], [s * 0.5, s * 0.34]],
      [[s * 0.36, s * 0.28], [s * 0.82, s * 0.28], [s * 0.59, s * 0.46]],
      [[s * 0.62, -w], [s, -w], [s, w], [s * 0.62, w]],
      [[s, -s * 0.3], [s, s * 0.3], [s * 1.28, 0]],
    ];
  },
  'arrow-left-right': (s) => {
    const w = s * 0.13;
    return [
      [[0, -w], [s * 0.5, -w], [s * 0.5, w], [0, w]],
      [[s * 0.3, -s * 0.16], [s * 0.48, -s * 0.16], [s * 0.48, -s * 0.36], [s * 0.3, -s * 0.36]],
      [[s * 0.16, -s * 0.3], [s * 0.62, -s * 0.3], [s * 0.39, -s * 0.48]],
      [[s * 0.3, s * 0.16], [s * 0.48, s * 0.16], [s * 0.48, s * 0.36], [s * 0.3, s * 0.36]],
      [[s * 0.16, s * 0.3], [s * 0.62, s * 0.3], [s * 0.39, s * 0.48]],
    ];
  },
  'arrow-merge-left': (s) => { const w = s * 0.13; return [[[0, -w], [s * 0.55, -w - s * 0.1], [s * 0.55, w - s * 0.1], [0, w]], [[s * 0.55, -w * 2.2], [s * 0.55, w * 0.4], [s * 0.95, -w * 0.9]]]; },
  'arrow-merge-right': (s) => { const w = s * 0.13; return [[[0, -w], [s * 0.55, -w + s * 0.1], [s * 0.55, w + s * 0.1], [0, w]], [[s * 0.55, w * 2.2], [s * 0.55, -w * 0.4], [s * 0.95, w * 0.9]]]; },
  'give-way-triangle': (s) => [[[0, -s * 0.3], [0, s * 0.3], [s * 0.5, 0]]],
  'keep-left': (s) => [[[0, -s * 0.3], [s * 0.7, -s * 0.3], [s * 0.35, s * 0.1]]],
  'keep-right': (s) => [[[0, s * 0.3], [s * 0.7, s * 0.3], [s * 0.35, -s * 0.1]]],
  bike: (s) => {
    const r = s * 0.1;
    const ring = (cx, cz, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        out.push([[cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * r * 0.55, cz + Math.sin(a1) * r * 0.55], [cx + Math.cos(a0) * r * 0.55, cz + Math.sin(a0) * r * 0.55]]);
      }
      return out;
    };
    return [...ring(s * 0.2, -s * 0.18, 8), ...ring(s * 0.2, s * 0.18, 8),
      [[s * 0.2, s * 0.08], [s * 0.45, 0], [s * 0.4, -s * 0.06], [s * 0.16, 0]]];
  },
  'rail-x': (s) => {
    const w = s * 0.07;
    const bar = (ax, az, bx, bz) => {
      const dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * w, nz = (dx / l) * w;
      return [[ax - nx, az - nz], [ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz]];
    };
    return [bar(0, 0, s * 0.6, s * 0.6), bar(0, s * 0.6, s * 0.6, 0)];
  },
};

/** Paint a symbol (turn arrow, bike, triangles) on the deck at a frame. */
export function emitSymbol(mb, frame, offset, kind, size, material, y, opts = {}) {
  const make = GLYPHS[kind];
  if (!frame || !make) return 0;
  const polys = make(size ?? 5);
  let n = 0;
  for (const poly of polys) {
    const plan = poly.map(([along, across]) => {
      const q = crossPoint(frame, offset + across, 0);
      return [q[0] + frame.dir[0] * along - frame.dir[0] * (opts.shift ?? 0), y, q[2] + frame.dir[1] * along - frame.dir[1] * (opts.shift ?? 0)];
    });
    n += emitPlanFlat(mb, plan, material);
  }
  return n;
}

export function hasGlyph(kind) { return !!GLYPHS[kind]; }

// ── road markings ───────────────────────────────────────────────────────────-

/**
 * Markings for one ribbon: lane dividers, centre line, edge lines, parking bays,
 * bus/cycle lane separation. Called with the frames the deck was built from.
 */
export function buildRoadMarkings(net, road, frames, mb, ctx = {}) {
  const out = { lanes: 0, quads: 0, skipped: [] };
  if (!frames.length || ctx.markings === false) return out;
  const profile = road.profile;
  const levels = surfaceLevels(profile);
  const yAt = (offset) => {
    let best = 0, bestD = Infinity;
    for (const band of profile.bands) {
      const { inner, outer } = bandEdges(band);
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      const d = offset < lo ? lo - offset : offset > hi ? offset - hi : 0;
      if (d < bestD) { bestD = d; best = levels.bandY.get(band) || 0; }
    }
    return best;
  };
  const heightOf = (f, o) => f.p[1] + yAt(o);
  const shared = profile.shared;

  for (const side of profile.sides) {
    const lanes = side.bands.filter((b) => b.lane && !b.rail);
    for (let i = 0; i < lanes.length; i++) {
      const band = lanes[i];
      const { inner, outer } = bandEdges(band);
      const outerSign = Math.sign(outer - inner) || side.sign;
      if (shared) continue;
      if (band.markingIn) {
        out.quads += emitLine(mb, frames, inner, MARKINGS[band.markingIn], {}, heightOf);
      }
      const next = lanes[i + 1];
      if (next && !next.markingIn) {
        const spec = band.dir !== next.dir ? MARKINGS['centre-line'] : MARKINGS['lane-dash'];
        out.quads += emitLine(mb, frames, outer, spec, {}, heightOf);
      }
      if (band.markingOut && laneBoundaryNeedsPaint(band, next)) {
        out.quads += emitLine(mb, frames, outer, MARKINGS[band.markingOut], {}, heightOf);
      }
      // Carriageway edge line: only where a kerb holds the road in.
      const kerb = levels.kerbs.find((k) => k.side === band.side && Math.abs(Math.abs(k.offset) - Math.abs(outer)) < 1e-6);
      if (kerb && i === lanes.length - 1 && band.level === 'carriageway') {
        out.quads += emitLine(mb, frames, outer - outerSign * 0.22, MARKINGS['edge-line'], {}, heightOf);
      }
      if (band.role === 'parking' || band.role === 'parking-90' || band.role === 'loading') {
        const bay = MARKINGS['parking-bay'];
        const span = frames[frames.length - 1].s - frames[0].s;
        const bays = Math.max(1, Math.floor(span / (bay.bayLength ?? 5.5)));
        for (let k = 0; k <= bays; k++) {
          const f = frameAt(frames, frames[0].s + (k * span) / bays);
          const y = heightOf(f, inner) + PAINT_LIFT;
          out.quads += emitTransverse(mb, f, inner + outerSign * 0.06, outer - outerSign * 0.06, 0.1, y, bay.material);
        }
      }
      if (band.role === 'bus' || band.role === 'hov') {
        const label = band.role === 'bus' ? 'bus' : 'hov';
        for (const f of spacedStations(frames, 40, 18)) {
          const fr = frameAt(frames, f);
          out.quads += emitSymbol(mb, fr, (band.from + band.to) / 2, 'arrow-straight', 2.4, 'marking-white', heightOf(fr, (band.from + band.to) / 2) + PAINT_LIFT);
          out.skipped.push(`${label} lettering (glyph font)`);
        }
      }
      if (band.markingOut === 'bike-lane' || band.role === 'bike' || band.role === 'cycle-track') {
        for (const f of spacedStations(frames, 45, 20)) {
          const fr = frameAt(frames, f);
          const mid = (band.from + band.to) / 2;
          out.quads += emitSymbol(mb, fr, mid, 'bike', 2.6, 'marking-white', heightOf(fr, mid) + PAINT_LIFT);
        }
      }
      out.lanes++;
    }
  }
  out.skipped = [...new Set(out.skipped)];
  return out;
}

function laneBoundaryNeedsPaint(band, next) {
  if (!next) return true;
  return next.markingIn !== band.markingOut;
}

// ── junction markings ───────────────────────────────────────────────────────-

/** Which side of the mouth the arriving traffic is on, in the arm's own frame. */
export function arrivalSide(plan, i) {
  const e = plan.inc[i];
  const lanes = e.profile.bands.filter((b) => b.lane && !b.rail);
  const arrivals = lanes.filter((b) => (e.end === 'a' ? b.dir === '-' : b.dir === '+'));
  if (!arrivals.length) return 0;
  const side = arrivals[0].side;
  return e.end === 'a' ? side : -side;
}

/** Stop bars, give-way lines, crossings and turn arrows at one junction. */
export function buildJunctionMarkings(net, node, plan, mb, ctx = {}) {
  const out = { stops: 0, zebras: 0, glyphs: 0 };
  if (!plan || plan.armCount < 2 || ctx.markings === false) return out;
  const y = (p) => (plan.heightAt ? plan.heightAt(p) : node.y);
  for (let i = 0; i < plan.armCount; i++) {
    const e = plan.inc[i];
    if (e.profile.railway) continue;
    const side = arrivalSide(plan, i) || -1;
    const half = e.half;
    const f = frameAt(armRun(plan, i), Math.max(0.8, plan.mouths[i].trim - 1.1));
    if (!f) continue;
    const yMid = y([f.p[0], f.p[2]]);
    if (plan.type === 'signal') {
      out.stops += emitTransverse(mb, f, 0, side * half, 0.4, yMid + PAINT_LIFT, 'marking-white');
      const back = frameAt(armRun(plan, i), Math.max(0.8, plan.mouths[i].trim - 13));
      if (back) {
        const lanes = e.profile.bands.filter((b) => b.lane && !b.rail && (e.end === 'a' ? b.dir === '-' : b.dir === '+'));
        const yb = y([back.p[0], back.p[2]]);
        for (const lane of lanes) {
          const turn = laneTurn(plan, i, lane);
          out.glyphs += emitSymbol(mb, back, (lane.from + lane.to) / 2, turn, 4.6, 'marking-white', yb + PAINT_LIFT);
        }
      }
    } else if (plan.type === 'giveway') {
      out.stops += emitTransverse(mb, f, 0, side * half, 0.3, yMid + PAINT_LIFT, 'marking-white', { dash: 0.5, gap: 0.3 });
      const nose = frameAt(armRun(plan, i), Math.max(0.8, plan.mouths[i].trim - 3.4));
      if (nose) out.glyphs += emitSymbol(mb, nose, side * (half - 1.1), 'give-way-triangle', 2.6, 'marking-white', y([nose.p[0], nose.p[2]]) + PAINT_LIFT);
    } else if (plan.type === 'roundabout') {
      out.stops += emitTransverse(mb, f, 0, side * half, 0.3, yMid + PAINT_LIFT, 'marking-white', { dash: 0.5, gap: 0.3 });
    }
    // Crossings: node tags or the road declaring a zebra on that approach.
    const crossing = node.tags.crossings === true || node.tags.crossings === 'all'
      || (Array.isArray(node.tags.crossings) && node.tags.crossings.includes(i));
    if (crossing && plan.type !== 'rail') {
      const zf = frameAt(armRun(plan, i), Math.max(0.8, plan.mouths[i].trim + 3.2));
      if (zf) {
        const yz = y([zf.p[0], zf.p[2]]);
        out.zebras += emitZebra(mb, zf, -half, half, MARKINGS.zebra, { y: yz + PAINT_LIFT, barLength: 3.4 });
      }
    }
  }
  return out;
}

function laneTurn(plan, i, lane) {
  const a = plan.inc[i];
  const deltas = [];
  for (let j = 0; j < plan.armCount; j++) {
    if (j === i) continue;
    const b = plan.inc[j];
    const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    const dot = a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1];
    deltas.push({ j, ang: Math.atan2(cross, dot) });
  }
  if (!deltas.length) return 'arrow-straight';
  const ahead = deltas.find((d) => Math.abs(d.ang) < 0.6);
  const left = deltas.find((d) => d.ang >= 0.6 && d.ang < 2.6);
  const right = deltas.find((d) => d.ang <= -0.6 && d.ang > -2.6);
  const own = lane.side === 1 ? left : lane.side === -1 ? right : null;
  if (ahead && own) return lane.side === 1 ? 'arrow-straight-left' : 'arrow-straight-right';
  if (ahead) return 'arrow-straight';
  if (own) return lane.side === 1 ? 'arrow-left' : 'arrow-right';
  if (left && right) return 'arrow-left-right';
  return 'arrow-straight';
}

/** A short synthetic run along one arm, used to place junction detail. */
export function armRun(plan, i) {
  const e = plan.inc[i];
  if (!e.armRun) {
    const m = plan.mouths[i];
    const s0 = Math.max(0.5, m.trim - 26);
    const out = [];
    for (let s = s0; s <= m.trim + 0.001; s += 2) {
      out.push({
        s,
        dir: e.dir,
        left: e.left,
        p: [plan.node.p[0] + e.dir[0] * s, plan.node.y, plan.node.p[1] + e.dir[1] * s],
        grade: 0,
        y: plan.node.y,
      });
    }
    e.armRun = out;
  }
  return e.armRun;
}

// ── furniture ───────────────────────────────────────────────────────────────-

/** Axis-aligned-in-frame box on the ground: bollard, cabinet, bench, shelter. */
function placeBox(mb, frame, offset, size, material, opts = {}) {
  const [w, h, l] = size;
  const base = (opts.base ?? frame.p[1]) + (opts.lift ?? 0);
  const p = (along, across) => crossPoint(frame, offset + across, 0);
  const c = [
    [pt(frame, offset - w / 2, 0, -l / 2)[0], pt(frame, offset - w / 2, 0, -l / 2)[2]],
    [pt(frame, offset + w / 2, 0, -l / 2)[0], pt(frame, offset + w / 2, 0, -l / 2)[2]],
    [pt(frame, offset + w / 2, 0, l / 2)[0], pt(frame, offset + w / 2, 0, l / 2)[2]],
    [pt(frame, offset - w / 2, 0, l / 2)[0], pt(frame, offset - w / 2, 0, l / 2)[2]],
  ];
  void p;
  mb.prism(c, base, base + h, { material });
  if (opts.cap) mb.cap(c, base + h, opts.cap, 0.5, { down: true });
  return 1;
}

/** A post with an optional arm and luminaire, oriented to reach over the road. */
function placePole(mb, frame, offset, spec, material, opts = {}) {
  const w = spec.size?.[0] ?? 0.16;
  const h = spec.size?.[1] ?? 8;
  placeBox(mb, frame, offset, [w, h, w], material, { base: frame.p[1] });
  const arm = opts.arm ?? spec.arm ?? 0;
  const inward = opts.inward ?? -1;
  if (arm > 0) {
    const armH = opts.armHeight ?? spec.armHeight ?? h * 0.95;
    const t = 0.09;
    const a = crossPoint(frame, offset, armH);
    const b = crossPoint(frame, offset + inward * arm, armH);
    // The arm is a horizontal beam: a vertical prism over its own footprint, so
    // every face comes off the same loop and the box closes.
    placeBar(mb, a, b, t, t, material);
    if (opts.lamp !== false) {
      const head = crossPoint(frame, offset + inward * (arm + 0.1), armH - 0.14);
      const box = [
        [head[0] - 0.17, head[2] - 0.35], [head[0] + 0.17, head[2] - 0.35],
        [head[0] + 0.17, head[2] + 0.35], [head[0] - 0.17, head[2] + 0.35],
      ];
      mb.prism(box, head[1] - 0.08, head[1] + 0.08, { material });
      mb.cap(box, head[1] + 0.08, 'lamp-glass', 0.5, { down: true });
    }
  }
  return 1;
}

/**
 * A bar between two points: a rectangular beam of `across` width and `thick`
 * height, capped top and bottom. Used for mast arms and signal brackets, which
 * are boxes rather than prisms and were the one place faces could disagree.
 */
function placeBar(mb, a, b, across, thick, material) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const l = Math.hypot(dx, dz) || 1;
  const nx = (dz / l) * (across / 2), nz = (-dx / l) * (across / 2);
  const ax = a[0] - dx * 0.02, az = a[2] - dz * 0.02;
  const bx = b[0] + dx * 0.02, bz = b[2] + dz * 0.02;
  const loop = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
  const y0 = Math.min(a[1], b[1]) - thick / 2, y1 = y0 + thick;
  mb.prism(loop, y0, y1, { material });
  mb.cap(loop, y1, material, 0.5, { down: true });
  mb.cap(loop, y0, material, 0.5, { down: false });
  return 1;
}

/** Signal head on a corner  return 1;
}

/** Signal head on a corner: pole, mast arm and three lit lenses. */
function placeSignal(mb, frame, offset, spec, opts = {}) {
  const material = spec.material || 'metal-dark';
  placePole(mb, frame, offset, spec, material, { arm: opts.arm ?? spec.arm ?? 0, inward: opts.inward ?? -1, lamp: false });
  const arm = opts.arm ?? spec.arm ?? 0;
  const inward = opts.inward ?? -1;
  const h = (opts.armHeight ?? spec.armHeight ?? spec.size?.[1] ?? 7) - 0.4;
  const heads = Math.max(1, spec.heads ?? 1);
  for (let k = 0; k < heads; k++) {
    const off = arm > 0 ? offset + inward * (arm * (k + 1)) / (heads + 0.2) : offset;
    const q = crossPoint(frame, off, h);
    const box = [[q[0] - 0.16, q[2] - 0.14], [q[0] + 0.16, q[2] - 0.14], [q[0] + 0.16, q[2] + 0.14], [q[0] - 0.16, q[2] + 0.14]];
    mb.prism(box, q[1], q[1] + 0.95, { material });
    mb.cap(box, q[1] + 0.95, material, 0.5, { down: true });
    for (let l = 0; l < 3; l++) {
      const lens = ['signal-red', 'signal-amber', 'signal-green'][l];
      const y0 = q[1] + 0.75 - l * 0.3;
      // Lens on the face that looks back down the arm, at the approaching traffic.
      const nx = -frame.dir[1] * 0.16, nz = frame.dir[0] * 0.16;
      emitQuadOriented(mb, [
        [q[0] - frame.dir[0] * 0.12 - nx, y0, q[2] - frame.dir[1] * 0.12 - nz],
        [q[0] + frame.dir[0] * 0.12 - nx, y0, q[2] + frame.dir[1] * 0.12 - nz],
        [q[0] + frame.dir[0] * 0.12 - nx, y0 - 0.26, q[2] + frame.dir[1] * 0.12 - nz],
        [q[0] - frame.dir[0] * 0.12 - nx, y0 - 0.26, q[2] - frame.dir[1] * 0.12 - nz],
      ], lens, [-nx, 0, -nz]);
    }
  }
  return 1;
}

/** Guardrail / parapet: posts plus beams, one quad run per beam height. */
function placeRailRun(mb, frames, offset, spec, opts = {}) {
  const material = spec.material || 'metal-light';
  const spacing = spec.postSpacing ?? 2.0;
  const heights = spec.railHeights ?? [0.6];
  const baseOf = (f) => f.p[1] + (opts.base ?? 0);
  let pieces = 0;
  mb.tag?.('rail posts', () => {
    for (const s of spacedStations(frames, spacing)) {
      const f = frameAt(frames, s);
      placeBox(mb, f, offset, [0.12, spec.height ?? 0.78, 0.12], material, { base: baseOf(f) });
      pieces++;
    }
  });
  // Each span of rail is a prism over its own footprint, taken from the two
  // frames it spans. Orienting the four faces from their own cross products
  // (as this used to) flips a span wherever the road bends inside it, which
  // leaves neighbouring spans disagreeing about the edge they share.
  mb.tag?.('rail beams', () => {
    for (const h of heights) {
      for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i], b = frames[i + 1];
        const ya = baseOf(a) + h, yb = baseOf(b) + h;
        const loop = railLoop(a, b, offset, 0.05);
        if (!loop) continue;
        mb.prism(loop, Math.min(ya, yb) - 0.3, Math.max(ya, yb), { material });
      }
    }
  });
  return pieces;
}

/** Footprint of one rail span: a rectangle `half` either side of the run axis. */
function railLoop(a, b, offset, half) {
  const ax = a.p[0] + a.left[0] * (offset - half), az = a.p[2] + a.left[1] * (offset - half);
  const bx = a.p[0] + a.left[0] * (offset + half), bz = a.p[2] + a.left[1] * (offset + half);
  const cx = b.p[0] + b.left[0] * (offset + half), cz = b.p[2] + b.left[1] * (offset + half);
  const dx = b.p[0] + b.left[0] * (offset - half), dz = b.p[2] + b.left[1] * (offset - half);
  // Stretch each end along the span so consecutive rails butt without a gap.
  const ex = (b.p[0] - a.p[0]) * 0.01, ez = (b.p[2] - a.p[2]) * 0.01;
  const loop = [[ax - ex, az - ez], [bx - ex, bz - ez], [cx + ex, cz + ez], [dx + ex, dz + ez]];
  let area = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  if (Math.abs(area) < 1e-9) return null;
  return area > 0 ? loop : loop.slice().reverse();
}

/** Street tree: trunk plus a two-tier crown. */
function placeTree(mb, frame, offset, spec, opts = {}) {
  const h = (spec.height ?? 6.5) * (opts.scale ?? 1);
  const crown = (spec.crown ?? 2.6) * (opts.scale ?? 1);
  const base = frame.p[1];
  placeBox(mb, frame, offset, [0.22, h * 0.45, 0.22], 'wood', { base });
  const c = crossPoint(frame, offset, 0);
  const seg = 6;
  const ring = (r) => {
    const loop = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; loop.push([c[0] + Math.cos(a) * r, c[2] + Math.sin(a) * r]); }
    return loop;
  };
  const lo = ring(crown), hi = ring(crown * 0.5);
  mb.prism(lo, base + h * 0.4, base + h * 0.72, { material: 'leaf' });
  mb.cap(lo, base + h * 0.72, 'leaf', 0.4, { down: true });
  mb.prism(hi, base + h * 0.72, base + h, { material: 'leaf' });
  mb.cap(hi, base + h, 'leaf', 0.4, { down: true });
  return 1;
}

/** A fence: posts plus two rails. */
function placeFence(mb, frames, offset, spec) {
  const material = spec.material || 'metal-dark';
  const h = spec.height ?? 1.6;
  let pieces = 0;
  for (const s of spacedStations(frames, spec.postSpacing ?? 3)) {
    const f = frameAt(frames, s);
    placeBox(mb, f, offset, [0.1, h, 0.1], material, { base: f.p[1] });
    pieces++;
  }
  for (const hh of [h, h * 0.55]) {
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      const pa = crossPoint(a, offset, 0), pb = crossPoint(b, offset, 0);
      emitQuadOriented(mb, [
        [pa[0], pa[1] + hh - 0.03, pa[2]], [pb[0], pb[1] + hh - 0.03, pb[2]],
        [pb[0], pb[1] + hh + 0.03, pb[2]], [pa[0], pa[1] + hh + 0.03, pa[2]],
      ], material, [-a.left[0], 0, -a.left[1]]);
    }
  }
  return pieces;
}

const BUMP_PROFILES = {
  // [fraction along, fraction of rise]
  bump: [[0, 0], [0.12, 0.45], [0.2, 0.75], [0.5, 1], [0.8, 0.75], [0.88, 0.45], [1, 0]],
  hump: [[0, 0], [0.25, 0.5], [0.5, 1], [0.75, 0.5], [1, 0]],
  table: [[0, 0], [0.24, 1], [0.76, 1], [1, 0]],
};

/**
 * Speed control across a carriageway: bump, hump, raised table or cushions, with
 * the ramp markings a driver is meant to see.
 */
export function buildSpeedBump(mb, frames, station, kind, y, opts = {}) {
  const spec = FURNITURE[kind];
  if (!spec) return 0;
  const len = spec.length ?? 3.7;
  const rise = spec.rise ?? 0.075;
  const from = opts.from ?? 0;
  const to = opts.to ?? 0;
  const heights = spec.profile === 'cushions' ? BUMP_PROFILES.bump : (BUMP_PROFILES[spec.profile] || BUMP_PROFILES.bump);
  let quads = 0;
  const strips = spec.profile === 'cushions'
    ? [[0.25, 0.6], [-0.6, -0.25]]
    : [[0, 1]];
  for (const [l0, l1] of strips) {
    const a = from + (to - from) * l0, b = from + (to - from) * l1;
    for (let i = 0; i < heights.length - 1; i++) {
      const [fa, ha] = heights[i];
      const [fb, hb] = heights[i + 1];
      const fa0 = frameAt(frames, station - len / 2 + fa * len);
      const fb0 = frameAt(frames, station - len / 2 + fb * len);
      if (!fa0 || !fb0) continue;
      quads += emitPlanFlat(mb, [
        pt(fa0, a, y + rise * ha), pt(fa0, b, y + rise * ha), pt(fb0, b, y + rise * hb), pt(fb0, a, y + rise * hb),
      ], spec.material || 'asphalt-worn');
    }
  }
  if (spec.marking === 'triangle') {
    const f = frameAt(frames, station - len / 2 - 1.2);
    if (f) quads += emitSymbol(mb, f, (from + to) / 2, 'give-way-triangle', 1.6, 'marking-white', y + PAINT_LIFT);
  }
  return quads;
}

/**
 * All furniture along one ribbon: lights, rails, fences, bollards, trees, street
 * furniture and speed control. Placement follows the band catalog, so a cross
 * section that asks for bollards gets them on its own footway edge.
 */
export function buildRoadFurniture(net, road, frames, mb, ctx = {}) {
  const out = { pieces: 0, bumps: 0, skipped: [] };
  if (!frames.length || ctx.furniture === false) return out;
  const profile = road.profile;
  const levels = surfaceLevels(profile);
  const sEnd = frames[frames.length - 1].s;
  const place = (kind, frame, offset, extra = {}) => {
    const spec = FURNITURE[kind];
    if (!spec || !frame) return 0;
    const site = `furniture ${kind}`;
    if (mb.tag && !ctx._tagging) { ctx._tagging = true; mb.tag(site, () => place(kind, frame, offset, extra)); ctx._tagging = false; return 1; }
    switch (spec.kind) {
      case 'bollard': case 'post': case 'box': case 'shelter':
        return placeBox(mb, frame, offset, spec.size, spec.material, { cap: spec.cap, base: frame.p[1] });
      case 'pole': return placePole(mb, frame, offset, spec, spec.material, extra);
      case 'signal': return placeSignal(mb, frame, offset, spec, extra);
      case 'tree': return placeTree(mb, frame, offset, spec, extra);
      case 'sign': {
        const ph = spec.poleHeight ?? 2.4;
        placeBox(mb, frame, offset, [0.07, ph, 0.07], 'metal-light', { base: frame.p[1] });
        placeBox(mb, frame, offset, [spec.size[0], spec.size[1], 0.06], spec.material || 'paint-white', { base: frame.p[1] + ph - spec.size[1] * 0.6 });
        return 1;
      }
      case 'boom': {
        placeBox(mb, frame, offset, [0.14, 0.9, 0.14], 'metal-dark', { base: frame.p[1] });
        const q = crossPoint(frame, offset, 0);
        emitQuadOriented(mb, [
          [q[0], q[1] + 0.95, q[2]], [q[0], q[1] + 0.81, q[2]],
          [pt(frame, offset, 0, spec.length ?? 4)[0], q[1] + 0.81, pt(frame, offset, 0, spec.length ?? 4)[2]],
          [pt(frame, offset, 0, spec.length ?? 4)[0], q[1] + 0.95, pt(frame, offset, 0, spec.length ?? 4)[2]],
        ], spec.material, [0, 1, 0]);
        return 1;
      }
      case 'strip': {
        const q = crossPoint(frame, offset, 0);
        return emitPlanFlat(mb, [
          [q[0] - 0.25, q[1] + 0.005, q[2]], [q[0] + 0.25, q[1] + 0.005, q[2]],
          [pt(frame, offset, 0, 0.4)[0] + 0.25, q[1] + 0.005, pt(frame, offset, 0, 0.4)[2]], [pt(frame, offset, 0, 0.4)[0] - 0.25, q[1] + 0.005, pt(frame, offset, 0, 0.4)[2]],
        ], spec.material);
      }
      default: return 0;
    }
  };

  // Street lights: the class spacing, on the first raised band of the section.
  const klass = ROAD_CLASSES[road.class];
  const verge = profile.bands.find((b) => b.level !== 'carriageway' && (b.role === 'verge' || b.role === 'footway' || b.role === 'barrier'));
  if (klass?.lights && verge && !profile.shared) {
    const { inner } = bandEdges(verge);
    for (const s of spacedStations(frames, klass.lights, klass.lights * 0.5)) {
      out.pieces += place('streetlight-single', frameAt(frames, s), inner - verge.side * 0.4, { inward: verge.side, arm: 2.0, armHeight: 8.6 });
    }
  }

  for (const band of profile.bands) {
    const { inner, outer } = bandEdges(band);
    const outerSign = Math.sign(outer - inner) || band.side;
    const y = levels.bandY.get(band) || 0;
    const lifted = (f) => (f ? { ...f, p: [f.p[0], f.p[1], f.p[2]] } : null);
    if (band.furniture && FURNITURE[band.furniture]) {
      const spec = FURNITURE[band.furniture];
      if (spec.kind === 'rail') {
        out.pieces += placeRailRun(mb, frames, inner + outerSign * 0.15, spec, { base: y });
      } else {
        for (const s of spacedStations(frames, spec.spacing ?? 20)) {
          out.pieces += place(band.furniture, lifted(frameAt(frames, s)), inner + outerSign * 0.3, {});
        }
      }
    }
    if (band.fence && FURNITURE[band.fence]) {
      out.pieces += placeFence(mb, frames, outer - outerSign * 0.25, FURNITURE[band.fence]);
    }
    if (band.bollards) {
      for (const s of spacedStations(frames, band.bollards, 1.2)) {
        out.pieces += place('bollard-steel', lifted(frameAt(frames, s)), inner + outerSign * 0.35, {});
      }
    }
    if (band.trees) {
      for (const s of spacedStations(frames, band.trees, 4)) {
        const f = lifted(frameAt(frames, s));
        out.pieces += placeTree(mb, f, inner + outerSign * Math.abs(outer - inner) * 0.55, FURNITURE['tree-street'], { scale: 0.85 + 0.3 * ((Math.abs(s) % 7) / 7) });
      }
    }
    if (band.role === 'platform' && band.platform) out.skipped.push('platform edge strip');
  }

  if (road.flags.bridge || road.flags.elevated) {
    const edge = profile.bands.filter((b) => b.level !== 'carriageway').pop();
    // A section that already carries its own edge rail (the viaducts do) would
    // otherwise get two parapets a few centimetres apart, whose posts overlap.
    const railed = edge && edge.furniture && FURNITURE[edge.furniture] && FURNITURE[edge.furniture].kind === 'rail';
    if (edge && !railed) {
      const { outer } = bandEdges(edge);
      out.pieces += placeRailRun(mb, frames, outer - edge.side * 0.25, FURNITURE.parapet, { base: (levels.bandY.get(edge) || 0) });
    }
  }

  // Speed control: home zones and shared surfaces get a table at each junction,
  // traffic-calmed streets a hump every 90 m.
  const calmed = engineCalm(road);
  if (calmed && frames.length > 3) {
    const y0 = frames[1].p[1];
    if (road.flags.speedTable) {
      for (const s of [frames[1].s + 6, sEnd - 6]) {
        if (s > frames[1].s + 2 && s < sEnd - 2) out.bumps += buildSpeedBump(mb, frames, s, 'speed-table', y0, { from: -profile.carriagewayHalf, to: profile.carriagewayHalf });
      }
    } else {
      for (let s = frames[0].s + 40; s < sEnd - 40; s += 90) {
        out.bumps += buildSpeedBump(mb, frames, s, 'speed-hump-4.2', y0, { from: -profile.carriagewayHalf, to: profile.carriagewayHalf });
      }
    }
  }
  return out;
}

function engineCalm(road) {
  if (road.flags.calmed !== undefined) return !!road.flags.calmed;
  return ['homezone', 'alley', 'lane', 'farm-track'].includes(road.class);
}

/**
 * Furniture that belongs to a junction rather than to a road: signals with mast
 * arms on the approach corners, give-way and stop signs on the arms that yield,
 * street lights on the remaining corners.
 */
export function buildJunctionFurniture(net, node, plan, mb, ctx = {}) {
  const out = { signals: 0, signs: 0, lamps: 0 };
  if (!plan || plan.armCount < 2 || ctx.furniture === false) return out;
  const y = (p) => (plan.heightAt ? plan.heightAt(p) : node.y);
  const ranks = { motorway: 5, expressway: 5, arterial: 4, boulevard: 4, viaduct: 4, avenue: 3, tram: 3, 'brt-way': 3, street: 2, service: 2, 'cycle-way': 2, lane: 1, homezone: 1, alley: 1, 'farm-track': 1 };
  for (let i = 0; i < plan.armCount; i++) {
    const e = plan.inc[i];
    const trim = plan.mouths[i].trim;
    if (plan.type === 'rail') continue;
    const side = arrivalSide(plan, i) || -1;
    const f = frameAt(armRun(plan, i), Math.max(0.8, trim - 1.2));
    if (!f) continue;
    if (plan.type === 'signal') {
      out.signals += placeSignal(mb, f, side * (e.half + 1.1), FURNITURE['signal-mast'], { inward: -side, arm: 5.0, armHeight: 6.6 });
    } else if (plan.type === 'giveway' || plan.type === 'roundabout') {
      const next = plan.inc[(i + 1) % plan.armCount];
      const ra = ranks[e.road.class] ?? 2, rb = ranks[next.road.class] ?? 2;
      if (ra < rb) {
        const sb = frameAt(armRun(plan, i), Math.max(0.8, trim - 2.6));
        if (sb) {
          const q = crossPoint(sb, side * (e.half + 0.9), 0);
          out.signs += placeSignal != null ? signPost(mb, sb, side * (e.half + 0.9), q[1], 'sign-giveway') : 0;
        }
      }
    }
    if (plan.type !== 'shared') {
      const ls = frameAt(armRun(plan, i), Math.max(0.8, trim - 4.0));
      if (ls) out.lamps += placePole(mb, ls, -side * (e.corridorHalf + 0.6), FURNITURE['streetlight-single'], 'metal-light', { inward: side, arm: 2.0, armHeight: 8.6 });
    }
  }
  return out;
}

/** Sign on a post at a plan point. */
function signPost(mb, frame, offset, y, kind) {
  const spec = FURNITURE[kind];
  if (!spec) return 0;
  const ph = spec.poleHeight ?? 2.4;
  placeBox(mb, frame, offset, [0.07, ph, 0.07], 'metal-light', { base: y });
  placeBox(mb, frame, offset, [spec.size[0], spec.size[1], 0.06], spec.material || 'paint-white', { base: y + ph - spec.size[1] * 0.6 });
  return 1;
}

// ── rail ────────────────────────────────────────────────────────────────────-

/** Ballast sleepers and rails for a railway cross section. */
export function buildRailTrack(net, road, frames, mb, ctx = {}) {
  if (!frames.length || ctx.rail === false) return 0;
  const levels = surfaceLevels(road.profile);
  let pieces = 0;
  for (const band of road.profile.bands) {
    if (band.role !== 'rail') continue;
    const mid = (band.from + band.to) / 2;
    const y = levels.bandY.get(band) || 0;
    for (let s = frames[0].s; s < frames[frames.length - 1].s; s += 0.65) {
      const f = frameAt(frames, s);
      const c = crossPoint(f, mid, 0);
      const half = GAUGE / 2 + 0.35;
      const yb = c[1] + y + 0.06;
      pieces += emitPlanFlat(mb, [
        pt(f, mid - half, yb, -0.13), pt(f, mid + half, yb, -0.13), pt(f, mid + half, yb, 0.13), pt(f, mid - half, yb, 0.13),
      ], 'sleeper');
    }
    for (const g of [-1, 1]) {
      const o = mid + (g * GAUGE) / 2;
      for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i], b = frames[i + 1];
        const pa = crossPoint(a, o, 0), pb = crossPoint(b, o, 0);
        const ya = pa[1] + y + 0.23, yb = pb[1] + y + 0.23;
        const hw = 0.037;
        // Rail: web across, head on top.
        emitQuadOriented(mb, [
          pt(a, o, ya, -hw), pt(b, o, yb, -hw), pt(b, o, yb - 0.15, -hw), pt(a, o, ya - 0.15, -hw),
        ], 'steel', [-a.left[0], 0, -a.left[1]]);
        emitQuadOriented(mb, [
          pt(a, o, ya, hw), pt(b, o, yb, hw), pt(b, o, yb - 0.15, hw), pt(a, o, ya - 0.15, hw),
        ], 'steel', [a.left[0], 0, a.left[1]]);
        quadsTop(mb, a, b, o, ya, yb, hw, 'steel');
        pieces += 2;
      }
    }
  }
  return pieces;
}

function quadsTop(mb, a, b, o, ya, yb, hw, material) {
  emitQuadOriented(mb, [
    pt(a, o - hw, ya, 0), pt(a, o + hw, ya, 0), pt(b, o + hw, yb, 0), pt(b, o - hw, yb, 0),
  ], material, [0, 1, 0]);
}

/** Level crossing: rails and deck panels across the road, booms and lights. */
export function buildRailCrossing(net, node, plan, mb, mr, ctx = {}) {
  const out = { crossings: 0, guarded: 0 };
  if (!plan || plan.type !== 'rail') return out;
  const y = (p) => (plan.heightAt ? plan.heightAt(p) : node.y);
  for (let i = 0; i < plan.armCount; i++) {
    const e = plan.inc[i];
    if (e.profile.railway) continue;
    const trim = plan.mouths[i].trim;
    const f = frameAt(armRun(plan, i), Math.max(1.0, trim * 0.5));
    if (!f) continue;
    const yc = y([f.p[0], f.p[2]]);
    const half = e.half;
    // The crossing itself: two rails in the surface, with deck panels between.
    for (const g of [-1, 1]) {
      const o = (g * GAUGE) / 2;
      out.crossings += emitPlanFlat(mb, [
        pt(f, o - 0.04, yc + 0.16, -half), pt(f, o + 0.04, yc + 0.16, -half), pt(f, o + 0.04, yc + 0.16, half), pt(f, o - 0.04, yc + 0.16, half),
      ], 'steel');
    }
    out.crossings += emitPlanFlat(mb, [
      pt(f, -half, yc + 0.012, -1.1), pt(f, half, yc + 0.012, -1.1), pt(f, half, yc + 0.012, 1.1), pt(f, -half, yc + 0.012, 1.1),
    ], 'asphalt-worn');
    // Rail-crossing warning markings on both approaches.
    for (const s of [Math.max(1.2, trim - 4.5), Math.max(1.2, trim + 5.5)]) {
      const mf = frameAt(armRun(plan, i), s);
      if (!mf) continue;
      const ym = y([mf.p[0], mf.p[2]]) + PAINT_LIFT;
      for (const side of [-1, 1]) {
        out.crossings += emitSymbol(mb, mf, side * (half * 0.5), 'rail-x', 2.6, 'marking-white', ym);
      }
    }
    const guarded = e.road.flags.crossing === 'protected' || node.tags.guarded === true;
    if (guarded && mr) {
      const post = frameAt(armRun(plan, i), Math.max(1.4, trim - 3.0));
      if (post) {
        const side = arrivalSide(plan, i) || -1;
        const q = crossPoint(post, side * (half + 1.0), 0);
        placeBox(mr, post, side * (half + 1.0), [0.14, 1.0, 0.14], 'metal-dark', { base: q[1] });
        placeBox(mr, post, side * (half + 1.0), [0.3, 0.24, 0.3], 'signal-red', { base: q[1] + 0.86 });
        placeBox(mr, post, side * (half + 1.0), [0.3, 0.24, 0.3], 'signal-red', { base: q[1] + 1.2 });
        out.guarded++;
      }
    }
  }
  return out;
}
