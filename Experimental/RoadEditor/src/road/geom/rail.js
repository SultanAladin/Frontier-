// Railways (ballast, sleepers, rails, catenary, fences, bridges) and level crossings
// (rubber panels, gates, crossbuck signals, RXR pavement markings, stop lines).
import { Centerline } from '../centerline.js';
import { Out, ribbon, sweep, wall, box, yawFor } from './out.js';
import { getProfile, layout, LEVEL } from '../profiles.js';
import { decal, bar } from './markings.js';
import { tramRails } from './edge.js';
import { segIntersect } from '../math.js';

const GAUGE = 1.435;
export const TRACK_SPACING = 4.2;

export function railCenterline(rail) {
  const baseY = rail.height ?? 0;
  return new Centerline(rail.pts.map(p => ({ x: p.x, y: p.y ?? baseY, z: p.z })));
}

// Find at-grade crossings between a rail and road edges.
export function findCrossings(net, rail, rc, index) {
  const mode = rail.mode || rail.kind || 'mainline';
  if (mode === 'suspended') return [];
  const res = [];
  const X = rc.X, Z = rc.Z, S = rc.S;
  const step = 6;
  const seen = new Set();
  for (let i = 0; i < X.length - 1; i += step) {
    const j = Math.min(X.length - 1, i + step);
    const cand = index.query((X[i] + X[j]) / 2, (Z[i] + Z[j]) / 2, 20);
    for (const e of cand) {
      const c = net.centerline(e);
      for (let k = 0; k < c.X.length - 1; k += 3) {
        const k2 = Math.min(c.X.length - 1, k + 3);
        const hit = segIntersect(X[i], Z[i], X[j], Z[j], c.X[k], c.Z[k], c.X[k2], c.Z[k2]);
        if (!hit) continue;
        const sR = S[i] + (S[j] - S[i]) * hit[0], sE = c.S[k] + (c.S[k2] - c.S[k]) * hit[1];
        const key = e.id + ':' + Math.round(sE / 5);
        if (seen.has(key)) continue; seen.add(key);
        const fe = c.frameAt(sE);
        if (fe.y > 2.5) continue;                       // road bridges over the rail
        const fr = rc.frameAt(sR);
        if (mode === 'tram' && Math.abs(fe.y - fr.y) > 0.25) continue; // only same-level tramways receive road crossing panels
        const cos = Math.abs(fe.tx * fr.tx + fe.tz * fr.tz);
        res.push({ edgeId: e.id, sRail: sR, sEdge: sE, sin: Math.sqrt(Math.max(0.05, 1 - cos * cos)), half: layout(getProfile(e)).total / 2 });
      }
    }
  }
  return res.sort((a, b) => a.sRail - b.sRail);
}

export function buildRail(net, rail, rc, crossings, ctx) {
  const mode = rail.mode || rail.kind || 'mainline';
  if (mode === 'suspended') return buildSuspendedRail(rail, rc, ctx);
  if (mode === 'tram') return buildTramway(net, rail, rc, crossings, ctx);
  const out = new Out(rail.id);
  const tracks = rail.tracks || 2;
  const offs = tracks === 1 ? [0] : Array.from({ length: tracks }, (_, k) => (k - (tracks - 1) / 2) * TRACK_SPACING);
  const W = (tracks - 1) * TRACK_SPACING + 3.2;           // ballast top width
  const zones = crossings.map(x => { const h = x.half / x.sin + 2.5; return [x.sRail - h, x.sRail + h]; });
  const inCross = s => zones.some(([a, b]) => s > a && s < b);
  const RAIL_TOP = 0.42;
  // rail-top height profile: flush with road at crossings, ramps of 16 m.
  const yAt = s => {
    let y = RAIL_TOP;
    for (const [a, b] of zones) {
      if (s > a && s < b) return 0.025;
      const d = s < a ? a - s : s - b;
      if (d < 16) y = Math.min(y, 0.025 + (RAIL_TOP - 0.025) * (d / 16));
    }
    const w = ctx.waterAt && ctx.waterAt(rc.frameAt(s).x, rc.frameAt(s).z);
    return w ? Math.max(y, 0.9) : y;
  };
  const extra = zones.flatMap(([a, b]) => [a - 16, a, b, b + 16]);
  const st = rc.stations(0, rc.length, extra, 10, 0.03);
  const frames = st.map(s => { const f = rc.frameAt(s); f.y = yAt(s); return f; });
  // ballast prism
  const half = W / 2;
  ribbon(out, 'ballast', frames, -half, half, -0.2);
  for (const side of [-1, 1]) {
    const pc = out.piece('ballast'), base = pc.p.length / 3;
    for (const f of frames) {
      const yt = f.y - 0.2, run = 0.6 + Math.max(0, yt - GROUNDY) * 1.6;
      const a = side * half, b = side * (half + run);
      out.vert(pc, f.x + f.nx * a, yt, f.z + f.nz * a, a, f.s);
      out.vert(pc, f.x + f.nx * b, GROUNDY - 0.02, f.z + f.nz * b, b, f.s);
    }
    for (let k = 0; k < frames.length - 1; k++) {
      const t0 = base + k * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      if (side > 0) pc.i.push(t0, b0, t1, b0, b1, t1); else pc.i.push(t0, t1, b0, b0, t1, b1);
    }
  }
  for (const o of offs) {
    for (const g of [-GAUGE / 2, GAUGE / 2]) {
      const oc = o + g;
      sweep(out, 'steel', frames, [[0.035, -0.16], [0.035, -0.01], [0.02, 0], [-0.02, 0], [-0.035, -0.01], [-0.035, -0.16]], oc);
    }
  }
  // sleepers + catenary + fence
  let lastMast = -999;
  for (let s = 0.4; s < rc.length; s += 0.65) {
    if (inCross(s)) continue;
    const f = rc.frameAt(s), y = yAt(s);
    for (const o of offs) out.prop('sleeper', f.x + f.nx * o, f.y + y - 0.29, f.z + f.nz * o, yawFor(f.nx, f.nz));
    if (s - lastMast > 55 && !(ctx.waterAt && ctx.waterAt(f.x, f.z))) {
      lastMast = s;
      const o = -half - 1.0;
      const yaw = yawFor(f.nx, f.nz);
      out.prop('catenaryMast', f.x + f.nx * o, f.y + y - 0.4, f.z + f.nz * o, yaw);
      out.prop('catenaryArm', f.x + f.nx * o, f.y + y + 6.2, f.z + f.nz * o, yaw, W + 1.6, 1, 1);
    }
  }
  // fences (not at crossings or on bridges)
  const fenceRuns = [];
  let cur = [];
  for (const f of frames) {
    const ok = !zones.some(([a, b]) => f.s > a - 10 && f.s < b + 10) && !(ctx.waterAt && ctx.waterAt(f.x, f.z));
    if (ok) cur.push(f); else { if (cur.length > 1) fenceRuns.push(cur); cur = []; }
  }
  if (cur.length > 1) fenceRuns.push(cur);
  for (const run of fenceRuns) for (const side of [-1, 1]) {
    const o = side * (half + 3.2);
    const flat = run.map(f => ({ ...f, y: 0 }));
    wall(out, 'fence', flat, o, GROUNDY, 1.9, side);
    wall(out, 'fence', flat, o, GROUNDY, 1.9, -side);
    for (let s = run[0].s; s < run[run.length - 1].s; s += 3) { const f = rc.frameAt(s); out.prop('fencePost', f.x + f.nx * o, GROUNDY, f.z + f.nz * o, 0); }
  }
  // bridge over water: girders + piers
  const wet = frames.filter(f => ctx.waterAt && ctx.waterAt(f.x, f.z));
  if (wet.length > 1) {
    const s0 = wet[0].s - 8, s1 = wet[wet.length - 1].s + 8;
    const bf = rc.stations(s0, s1, [], 6).map(s => { const f = rc.frameAt(s); f.y = yAt(s); return f; });
    ribbon(out, 'concrete', bf, half + 1.4, -half - 1.4, -1.3);
    for (const side of [-1, 1]) {
      const o = side * (half + 1.4);
      wall(out, 'girder', bf, o, -1.3, 1.6, side);
      wall(out, 'girder', bf, o - side * 0.4, -1.3, 1.6, -side);
      sweep(out, 'girder', bf, side > 0 ? [[0, 1.6], [-0.4, 1.6]] : [[0.4, 1.6], [0, 1.6]], o);
    }
    for (let s = s0 + 20; s < s1 - 10; s += 30) {
      const f = rc.frameAt(s);
      out.prop('pierColWide', f.x, -6, f.z, yawFor(f.tx, f.tz), 1.3, yAt(s) - 1.3 + 6 - 1.0, 1.3);
      out.prop('pierCap', f.x, yAt(s) - 1.3 - 1.0, f.z, yawFor(f.nx, f.nz), W + 3, 1.0, 1.6);
    }
  }
  // level crossings
  for (const x of crossings) crossing(out, net, rail, rc, x, offs, half);
  return out;
}

function buildTramway(net, rail, rc, crossings, ctx) {
  const out = new Out(rail.id);
  const tracks = rail.tracks === 1 ? 1 : 2;
  const offsets = tracks === 1 ? [0] : [-TRACK_SPACING / 2, TRACK_SPACING / 2];
  const half = tracks === 1 ? 1.6 : TRACK_SPACING / 2 + 1.6;
  const spacing = Math.max(12, Math.min(80, rail.supportSpacing || 30));
  const zones = crossings.map(x => { const h = x.half / x.sin + 2; return [x.sRail - h, x.sRail + h]; });
  const extra = zones.flatMap(([a, b]) => [a - 3, a, b, b + 3]);
  const frames = rc.stations(0, rc.length, extra, 6, 0.025).map(s => rc.frameAt(s));

  // Independent tram alignments use a narrow concrete track slab rather than ballast. The
  // grooved rail profile is shared with street-running trams, so the two systems meet cleanly.
  ribbon(out, 'concrete', frames, -half, half, 0.006);
  ribbon(out, 'concrete', frames, -half, half, -0.18);
  wall(out, 'concrete', frames, -half, -0.18, 0.006, -1);
  wall(out, 'concrete', frames, half, -0.18, 0.006, 1);
  for (const offset of offsets) tramRails(out, frames, offset, 0);

  for (const x of crossings) tramwayCrossing(out, net, rc, x, offsets);

  // Twin overhead conductors, with short droppers and alternating cantilever masts. The
  // existing catenary assets are reused; at river/elevated sections they sit on the viaduct.
  if (rail.electrified !== false) {
    for (const offset of offsets) {
      sweep(out, 'steel', frames, cableProfile(4.65, 0.018), offset);
      sweep(out, 'steel', frames, cableProfile(5.2, 0.014), offset);
      for (let s = 2; s < rc.length - 1; s += 4) {
        const f = rc.frameAt(s);
        box(out, 'steel', f.x + f.nx * offset, f.y + 4.925, f.z + f.nz * offset, f.tx, f.tz, 0.025, 0.018, 0.275);
      }
    }
    if (ctx.props !== false) {
      let mastIndex = 0;
      for (let s = spacing * 0.5; s < rc.length - spacing * 0.25; s += spacing) {
        const f = rc.frameAt(s);
        const road = ctx.roadAt?.(f.x, f.z, 80);
        const roadHalf = road ? layout(getProfile(road.edge)).total / 2 : 0;
        const mastOffset = Math.max(half + 0.7, roadHalf + 0.8);
        const side = mastIndex++ % 2 ? 1 : -1;
        const o = side * mastOffset;
        const x = f.x + f.nx * o, z = f.z + f.nz * o;
        if (ctx.pierBlocked?.(x, z, 0.45, f.y + 5.2, rail.id)) continue;
        const yaw = yawFor(-side * f.nx, -side * f.nz);
        const baseY = f.y + (f.y > 0.7 || (ctx.waterAt && ctx.waterAt(f.x, f.z)) ? -0.18 : -0.08);
        out.prop('catenaryMast', x, baseY, z, yaw);
        out.prop('catenaryArm', x, f.y + 4.65, z, yaw, mastOffset + half + 0.55, 1, 1);
      }
    }
  }

  // Elevated tramways and river crossings need a real load path, not a floating rail mesh.
  out.supports = buildTramSupports(out, rc, rail, half, spacing, ctx);
  out.masts = out.props.catenaryMast ? out.props.catenaryMast.length / 8 : 0;
  out.tramCrossings = crossings.length;
  out.mode = 'tram';
  return out;
}

function cableProfile(height, radius) {
  const profile = [];
  for (let i = 0; i <= 10; i++) {
    const a = i / 10 * Math.PI * 2;
    profile.push([Math.cos(a) * radius, height + Math.sin(a) * radius]);
  }
  return profile;
}

function tramwayCrossing(out, net, rc, x, offsets) {
  const edge = net.edges.get(x.edgeId);
  if (!edge) return;
  const road = net.centerline(edge);
  const roadY = road.frameAt(x.sEdge).y;
  const halfLength = x.half / x.sin + 1.5;
  const frames = [-halfLength, halfLength].map(d => {
    const f = rc.frameAt(x.sRail + d);
    f.y = roadY;
    return f;
  });
  // Flush rubber/concrete flangeway panels allow street traffic across the independent line.
  for (const offset of offsets) ribbon(out, 'crossPanel', frames, offset - GAUGE / 2 - 0.55, offset + GAUGE / 2 + 0.55, 0.014);
}

function buildTramSupports(out, rc, rail, half, spacing, ctx) {
  let supports = 0;
  const deckBottom = f => f.y - 0.18;
  for (let s = spacing * 0.5; s < rc.length - spacing * 0.25; s += spacing) {
    let placed = false;
    for (const shift of [0, 6, -6, 11, -11]) {
      const ss = s + shift;
      if (ss < 3 || ss > rc.length - 3) continue;
      const f = rc.frameAt(ss);
      const water = !!ctx.waterAt?.(f.x, f.z);
      if (f.y <= 0.7 && !water) continue;
      const road = ctx.roadAt?.(f.x, f.z, 80);
      const roadHalf = road ? layout(getProfile(road.edge)).total / 2 : 0;
      const baseOffset = Math.max(half + 0.7, roadHalf + 1.0);
      const ground = water ? -6 : (ctx.groundAt ? ctx.groundAt(f.x, f.z) : GROUNDY);
      const capTop = deckBottom(f) + 0.12, capHeight = 0.5;
      const columnTop = capTop - capHeight;
      if (columnTop - ground < 0.25) continue;

      for (const offset of [baseOffset, baseOffset + 3.5, baseOffset + 7, baseOffset + 12]) {
        const left = [f.x - f.nx * offset, f.z - f.nz * offset];
        const right = [f.x + f.nx * offset, f.z + f.nz * offset];
        const blocked = [left, right].some(([x, z]) => ctx.pierBlocked?.(x, z, 0.65, f.y + 0.2, rail.id));
        if (blocked) continue;
        const columnHeight = columnTop - ground;
        for (const [x, z] of [left, right]) {
          box(out, 'concrete', x, ground + columnHeight / 2, z, f.tx, f.tz, 0.48, 0.48, columnHeight / 2);
          box(out, 'concrete', x, ground + 0.16, z, f.tx, f.tz, 0.75, 0.72, 0.16);
        }
        box(out, 'concrete', f.x, capTop - capHeight / 2, f.z, f.tx, f.tz, 0.62, offset + 0.42, capHeight / 2);
        supports++;
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  return supports;
}

function buildSuspendedRail(rail, rc, ctx) {
  const out = new Out(rail.id);
  const halfWidth = Math.max(0.75, (rail.guidewayWidth || 2.0) / 2);
  const beamHeight = rail.guidewayHeight || 1.35;
  const frames = rc.stations(0, rc.length, [], 8, 0.025).map(s => rc.frameAt(s));

  // A box guideway with a dark under-slot and paired running surfaces. The carriage hangs
  // from bogies beneath this beam rather than riding on visible wheels above the track.
  ribbon(out, 'guideway', frames, -halfWidth, halfWidth, beamHeight);
  ribbon(out, 'guideway', frames, -halfWidth, halfWidth, 0);
  wall(out, 'guideway', frames, -halfWidth, 0, beamHeight, -1);
  wall(out, 'guideway', frames, halfWidth, 0, beamHeight, 1);
  ribbon(out, 'railGroove', frames, -0.18, 0.18, 0.012);
  for (const o of [-0.56, 0.56]) {
    ribbon(out, 'steel', frames, o - 0.07, o + 0.07, 0.018);
    wall(out, 'steel', frames, o - 0.07, 0.018, 0.12, -1);
    wall(out, 'steel', frames, o + 0.07, 0.018, 0.12, 1);
  }

  const spacing = rail.supportSpacing || 42;
  const ground = GROUNDY;
  const supportPositions = new Set();
  for (let s = spacing * 0.5; s < rc.length - spacing * 0.25; s += spacing) {
    const f = rc.frameAt(s);
    if (ctx.waterAt && ctx.waterAt(f.x, f.z)) {
      // Foundations in the river are allowed; the footings extend below the water surface.
    }
    const road = ctx.roadAt?.(f.x, f.z, 80);
    const roadHalf = road ? layout(getProfile(road.edge)).total / 2 : 0;
    const offset = rail.supportOffset || Math.max(6.0, roadHalf + 2.0);
    const top = f.y + 0.45;
    const groundY = ctx.waterAt && ctx.waterAt(f.x, f.z) ? -6.0 : ground;
    const pxL = f.x - f.nx * offset, pzL = f.z - f.nz * offset;
    const pxR = f.x + f.nx * offset, pzR = f.z + f.nz * offset;
    const clear = [
      !ctx.pierBlocked || !ctx.pierBlocked(pxL, pzL, 0.65, f.y + beamHeight, rail.id),
      !ctx.pierBlocked || !ctx.pierBlocked(pxR, pzR, 0.65, f.y + beamHeight, rail.id),
    ];
    if (!clear[0] || !clear[1]) continue;
    const colH = Math.max(1, top - groundY);
    box(out, 'concrete', pxL, (top + groundY) / 2, pzL, f.tx, f.tz, 0.48, 0.48, colH / 2);
    box(out, 'concrete', pxR, (top + groundY) / 2, pzR, f.tx, f.tz, 0.48, 0.48, colH / 2);
    // A crosshead transfers the guideway load to columns clear of the carriageway.
    box(out, 'concrete', f.x, f.y + 0.35, f.z, f.tx, f.tz, 0.62, offset + 0.55, 0.3);
    supportPositions.add(s);
  }
  out.mode = 'suspended';
  out.supports = supportPositions.size;
  return out;
}

const GROUNDY = -0.06;

function crossing(out, net, rail, rc, x, offs, half) {
  const e = net.edges.get(x.edgeId); if (!e) return;
  const c = net.centerline(e), lay = layout(getProfile(e));
  // rubber panels across the full road width around each track
  const roadHalf = x.half / x.sin + 1.5;
  const fs = [-roadHalf, roadHalf].map(d => { const f = rc.frameAt(x.sRail + d); f.y = c.frameAt(x.sEdge).y; return f; });
  for (const o of offs) ribbon(out, 'crossPanel', fs, o - GAUGE / 2 - 0.55, o + GAUGE / 2 + 0.55, 0.006);
  // gates, signals and markings on each approach
  const railHalf = half + 0.5;
  for (const dir of [-1, 1]) {
    // dir = +1 → approach from smaller s (traffic moving +s, lanes dir +1 on right side)
    const dS = (railHalf / x.sin) + 3.0;
    const sGate = x.sEdge - dir * dS;
    if (sGate < 2 || sGate > c.length - 2) continue;
    const f = c.frameAt(sGate);
    const side = dir;                                    // right side of travel for +s is +n
    const curb = side > 0 ? lay.curbR : lay.curbL;
    const has = side > 0 ? lay.hasCurbR : lay.hasCurbL;
    const o = curb + side * (has ? 0.8 : 1.6);
    const y = f.y + (has ? LEVEL.raised : 0);
    const px = f.x + f.nx * o, pz = f.z + f.nz * o;
    const toward = -side;
    out.prop('crossbuck', px, y, pz, yawFor(-f.tx * dir, -f.tz * dir));
    // Half-barriers: the span from the post to the centreline is broken into <= 7 m arms, each on its
    // own cabinet, so a wide carriageway still gets a barrier that closes it. Arm record is
    // [x,y,z,yaw,pitch,sx,sy,sz] with sx = length along local +x (inward), so pitch stays 0 = level.
    const ga = c.frameAt(sGate + dir * -0.9);
    const yawGate = yawFor(ga.nx * toward, ga.nz * toward);   // +x points from the curb toward the centre
    const span = Math.max(3.2, Math.abs(o) - 0.4);             // post → just short of the centreline
    const nSeg = Math.max(1, Math.ceil(span / 7));             // a real half-barrier is 4-7 m long
    const seg = span / nSeg;
    for (let k = 0; k < nSeg; k++) {
      const oo = o + toward * k * seg;                         // step inward along the normal
      out.prop('gatePost', ga.x + ga.nx * oo, y, ga.z + ga.nz * oo, yawGate);
      out.prop('gateArm', ga.x + ga.nx * oo, y + 1.05, ga.z + ga.nz * oo, yawGate, seg, 1, 1.35);
      out.prop('gateArm', ga.x + ga.nx * (oo - toward * 1.1), y + 1.05, ga.z + ga.nz * (oo - toward * 1.1), yawGate, 1.1, 0.8, 1.1);
    }
    // stop line + RXR markings on incoming lanes
    const inc = lay.lanes.filter(l => l.meta.traffic && ((l.dir || 0) === dir || (l.dir || 0) === 0));
    if (!inc.length) continue;
    const oMin = Math.min(...inc.map(l => l.o0)), oMax = Math.max(...inc.map(l => l.o1));
    const sStop = x.sEdge - dir * (dS + 1.8);
    if (sStop > 1 && sStop < c.length - 1) bar(out, 'markWhite', c, sStop, (oMin + oMax) / 2, 0.25, (oMax - oMin) / 2 - 0.05);
    const sR = x.sEdge - dir * (dS + 30);
    if (sR > 4 && sR < c.length - 4) for (const l of inc) if (l.type === 'drive') decal(out, 'rxr', c, sR, (l.o0 + l.o1) / 2, dir, 0);
    const sSign = x.sEdge - dir * (dS + 70);
    if (sSign > 2 && sSign < c.length - 2) { const g = c.frameAt(sSign); out.prop('signRail', g.x + g.nx * o, y, g.z + g.nz * o, yawFor(-g.tx * dir, -g.tz * dir)); }
  }
}
