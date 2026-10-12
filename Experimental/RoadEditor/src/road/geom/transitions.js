// Roadway transitions: where two lanes meet three (lane-drop taper) and where a road joins
// another at an acute angle (at-grade merge). Both reuse the generic junction apron — the taper
// stretches it over a legal taper length, the merge keeps the corner fillet — and add the
// specialized geometry + markings neither a plain intersection nor a butt joint can provide:
// converging lane lines, hatched gore wedges, merge arrows and yield channelization.
import { getProfile, layout } from '../profiles.js';
import { Centerline } from '../centerline.js';
import { decal } from './markings.js';
import { yawFor } from './out.js';
import { clamp } from '../math.js';

const PAINT = 0.014;

// ------------------------------------------------------------------ lane-drop taper
function driveGroups(lay) {
  const drives = lay.lanes.filter(l => l.type === 'drive');
  return {
    plus: drives.filter(l => l.dir === 1).sort((a, b) => a.o0 - b.o0),
    minus: drives.filter(l => l.dir === -1).sort((a, b) => b.o0 - a.o0),
    zero: drives.filter(l => !l.dir).sort((a, b) => Math.abs((a.o0 + a.o1) / 2) - Math.abs((b.o0 + b.o1) / 2)),
  };
}
function othersKey(lay) {
  return lay.lanes.filter(l => l.type !== 'drive').map(l => l.type + ':' + l.width.toFixed(1)).join('|');
}
function laneKey(l, lay) {
  if (l.type !== 'drive') return 'x' + lay.lanes.filter(x => x.type !== 'drive').indexOf(l);
  const g = driveGroups(lay)[l.dir === 1 ? 'plus' : l.dir === -1 ? 'minus' : 'zero'];
  return 'd' + (l.dir || 0) + ':' + g.indexOf(l);
}

// Degree-2, straight, same road family, drive-lane counts differ: returns the taper spec.
export function taperSpec(net, nodeId, ends) {
  void net; void nodeId;
  if (!ends || ends.length !== 2) return null;
  const [A, B] = ends;
  if (A.dx * B.dx + A.dz * B.dz > -0.94) return null;
  const pA = getProfile(A.edge), pB = getProfile(B.edge);
  if (pA.category !== pB.category || (pA.surface || 'asphalt') !== (pB.surface || 'asphalt')) return null;
  if (!!pA.oneWay !== !!pB.oneWay) return null;
  const lA = A.lay, lB = B.lay;
  if (Math.abs(lA.sideL - lB.sideL) > 0.35 || Math.abs(lA.sideR - lB.sideR) > 0.35) return null;
  if (othersKey(lA) !== othersKey(lB)) return null;
  const gA = driveGroups(lA), gB = driveGroups(lB);
  const dirsA = ['plus', 'minus', 'zero'].filter(d => gA[d].length).sort().join(',');
  const dirsB = ['plus', 'minus', 'zero'].filter(d => gB[d].length).sort().join(',');
  if (!dirsA || dirsA !== dirsB) return null;
  // one-way direction must chain through the node
  const flipA = A.edge.a === nodeId, flipB = B.edge.a === nodeId;
  if (lA.oneWay && flipA === flipB) return null;
  let diff = 0;
  for (const d of ['plus', 'minus', 'zero']) {
    const dd = Math.abs(gA[d].length - gB[d].length);
    if (dd > 2) return null;
    diff = Math.max(diff, dd);
  }
  if (diff < 1) return null;
  const dW = Math.abs(lA.total - lB.total);
  const L = clamp(Math.max(40, dW * 20), 40, 120);
  if (A.len < L / 2 + 15 || B.len < L / 2 + 15) return null;
  return { L };
}

// A line whose lateral offset morphs from o0 to o1 along the centreline.
function morphLine(out, mat, c, s0, s1, o0, o1, w, h = 0) {
  if (s1 - s0 < 0.5) return;
  const pc = out.piece(mat), base = pc.p.length / 3;
  const st = c.stations(s0, s1, [], 4, 0.02);
  const f = {};
  for (const s of st) {
    c.frameAt(s, f);
    const t = (s - s0) / Math.max(1e-6, s1 - s0), o = o0 + (o1 - o0) * t;
    const y = f.y + h + 0.012;
    out.vert(pc, f.x + f.nx * (o - w / 2), y, f.z + f.nz * (o - w / 2), 0, s);
    out.vert(pc, f.x + f.nx * (o + w / 2), y, f.z + f.nz * (o + w / 2), 1, s);
  }
  for (let k = 0; k < st.length - 1; k++) { const l0 = base + k * 2; pc.i.push(l0, l0 + 1, l0 + 2, l0 + 1, l0 + 3, l0 + 2); }
}
function morphDashed(out, mat, c, s0, s1, o0, o1, w, dash, gap, h = 0) {
  const period = dash + gap;
  for (let s = s0; s < s1; s += period) {
    const a = s, b = Math.min(s1, s + dash);
    if (b - a < 0.4) continue;
    const t0 = (a - s0) / (s1 - s0), t1 = (b - s0) / (s1 - s0);
    morphLine(out, mat, c, a, b, o0 + (o1 - o0) * t0, o0 + (o1 - o0) * t1, w, h);
  }
}

export function buildTaperPaint(out, net, J, ctx) {
  void ctx;
  if (ctx.markings === false) return;
  const [A, B] = J.ends;
  const N = J.node, style = net.meta.markingStyle || 'us';
  const eu = style === 'eu';
  // taper axis in world: A section centre → B section centre
  const aC = [(A.dx * A.setback), (A.dz * A.setback)], bC = [(B.dx * B.setback), (B.dz * B.setback)];
  const P0 = { x: N.x + aC[0], z: N.z + aC[1], y: N.y }, P1 = { x: N.x + bC[0], z: N.z + bC[1], y: N.y };
  const c = new Centerline([P0, P1]);
  const L = c.length, s0 = 0, s1 = L;
  const lA = A.lay, lB = B.lay;
  // Axis +s runs A→B. End A outward ≈ −axis so A-frame offsets negate; B outward ≈ +axis.
  const oA = o => -o, oB = o => o;
  // lane travel direction in the axis frame (+1 = A→B)
  const axisDir = (end, lane) => {
    const d = lane.dir || 0;
    if (end === A) return (A.atA ? -d : d);
    return (B.atA ? d : -d);
  };
  const Y = eu ? 'markWhite' : 'markYellow';

  // --- matched seams: same lane-pair on both sides
  const keysA = lA.lanes.map(l => laneKey(l, lA)), keysB = lB.lanes.map(l => laneKey(l, lB));
  const keyIdxB = new Map(keysB.map((k, j) => [k, j]));
  const drawn = new Set();
  const seamStyle = (l, r) => {
    if (!l || !r) return { kind: 'solid', mat: 'markWhite', w: 0.12 };
    if (l.type === 'drive' && r.type === 'drive') {
      if ((l.dir || 0) !== (r.dir || 0)) {
        if ((getProfile(A.edge)).noCenterLine) return null;
        return eu ? { kind: 'dashed', mat: 'markWhite', w: 0.12, dash: 4, gap: 8 } : { kind: 'double', mat: Y, w: 0.11 };
      }
      return { kind: 'dashed', mat: 'markWhite', w: 0.12, dash: 3, gap: 9 };
    }
    return { kind: 'solid', mat: 'markWhite', w: 0.12 };
  };
  for (let i = 0; i < lA.lanes.length - 1; i++) {
    const j = keyIdxB.get(keysA[i]);
    if (j === undefined || keysB[j + 1] !== keysA[i + 1]) continue;
    const st = seamStyle(lA.lanes[i], lA.lanes[i + 1]);
    if (!st) continue;
    const oo0 = oA(lA.lanes[i].o1), oo1 = oB(lB.lanes[j].o1);
    const key = keysA[i] + '|' + keysA[i + 1];
    if (drawn.has(key)) continue;
    drawn.add(key);
    if (st.kind === 'solid') morphLine(out, st.mat, c, s0, s1, oo0, oo1, st.w);
    else if (st.kind === 'double') { morphLine(out, st.mat, c, s0, s1, oo0 - 0.11, oo1 - 0.11, st.w); morphLine(out, st.mat, c, s0, s1, oo0 + 0.11, oo1 + 0.11, st.w); }
    else morphDashed(out, st.mat, c, s0, s1, oo0, oo1, st.w, st.dash, st.gap);
  }
  // --- edge lines along the tapering curbs
  morphLine(out, eu ? 'markWhite' : Y, c, s0, s1, oA(lA.curbL + 0.25), oB(lB.curbL + 0.25), 0.12);
  morphLine(out, 'markWhite', c, s0, s1, oA(lA.curbR - 0.25), oB(lB.curbR - 0.25), 0.12);

  // --- dropped-lane wedges: extra drive lanes converge onto the neighbour boundary
  const wideSides = [[lA, lB, A, keysA, keysB, true], [lB, lA, B, keysB, keysA, false]];
  for (const [layW, layN, endW, keysW, keysN, wideIsA] of wideSides) {
    const setN = new Set(keysN);
    const oW = wideIsA ? oA : oB, oN = wideIsA ? oB : oA;
    layW.lanes.forEach((lW, i) => {
      if (lW.type !== 'drive' || setN.has(keysW[i])) return;
      // neighbours on the wide side; find the narrow-side boundary they share
      const prev = layW.lanes[i - 1], next = layW.lanes[i + 1];
      const kp = prev ? keysW[i - 1] : null, kn = next ? keysW[i + 1] : null;
      let target = null;
      if (kp && kn) {
        const jp = keysN.indexOf(kp), jn = keysN.indexOf(kn);
        if (jp >= 0 && jn === jp + 1) target = layN.lanes[jp].o1;
      }
      if (target === null) return;
      const oT = oN(target), oI = oW(lW.o0), oO = oW(lW.o1);
      const sLo = Math.min(s0, s1), sHi = Math.max(s0, s1);
      const atLo = wideIsA ? oI : oT, atHi = wideIsA ? oT : oI;
      const atLo2 = wideIsA ? oO : oT, atHi2 = wideIsA ? oT : oO;
      morphLine(out, 'markWhite', c, sLo, sHi, atLo, atHi, 0.14);
      morphLine(out, 'markWhite', c, sLo, sHi, atLo2, atHi2, 0.14);
      chevronWedge(out, c, wideIsA ? s0 : s1, wideIsA ? s1 : s0, oI, oO, oT);
      // merge arrow on the dropped lane, only for traffic heading narrow-ward (the other way it is
      // a lane gain, which needs no merge marking)
      const dirTravel = wideIsA ? 1 : -1;
      if (axisDir(endW, lW) !== dirTravel) return;
      const sArr = wideIsA ? s0 + L * 0.22 : s1 - L * 0.22;
      const toInner = Math.sign(oT - (oI + oO) / 2) || 1;
      decal(out, (toInner * dirTravel >= 0) ? 'mergeR' : 'mergeL', c, sArr, (oI + oO) / 2, dirTravel, 0);
    });
  }
  // --- straight-ahead arrows on the continuing lanes, placed per travel direction
  for (const [lay, end, keys, setO, oMap] of [[lA, A, keysA, new Set(keysB), oA], [lB, B, keysB, new Set(keysA), oB]]) {
    lay.lanes.forEach((l, i) => {
      if (l.type !== 'drive' || !setO.has(keys[i])) return;
      const dir = axisDir(end, l) || 1;
      const sArr = dir > 0 ? s0 + L * 0.2 : s1 - L * 0.2;
      decal(out, 'arrowS', c, sArr, oMap((l.o0 + l.o1) / 2), dir, 0, 0.85);
    });
  }
}

// Chevron bars filling a wedge between two converging edge lines (wide offsets → target).
function chevronWedge(out, c, sWide, sNar, oIw, oOw, oT) {
  const lo = Math.max(0, Math.min(sWide, sNar)), hi = Math.max(sWide, sNar);
  const span = Math.max(1e-6, hi - lo);
  const at = s => {
    const t = (s - lo) / span;
    const f = sWide < sNar ? 1 - t : t;   // 1 at wide end → 0 at narrow
    return [oT + (oIw - oT) * f, oT + (oOw - oT) * f];
  };
  const pc = out.piece('markWhite');
  for (let s = lo + 4; s < hi - 2; s += 4.5) {
    const s2 = Math.min(hi, s + 2.2);
    const [a0, b0] = at(s), [a1, b1] = at(s2);
    if (Math.abs(b0 - a0) < 0.7) continue;
    const f0 = c.frameAt(s, {}), f1 = c.frameAt(s2, {});
    const P = (f, o, y) => [f.x + f.nx * o, y, f.z + f.nz * o];
    const A = P(f0, a0, f0.y + PAINT), B = P(f0, b0, f0.y + PAINT);
    const C = P(f1, a1, f1.y + PAINT), D = P(f1, b1, f1.y + PAINT);
    const base = pc.p.length / 3;
    for (const v of [A, B, C, D]) out.vert(pc, v[0], v[1], v[2], 0, 0);
    pc.i.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
}

// ------------------------------------------------------------------ at-grade angled merge
// Degree 3 where two legs form the through mainline and the third joins at an acute angle.
export function mergeSpec(net, nodeId, ends) {
  void net; void nodeId;
  if (!ends || ends.length !== 3) return null;
  if (ends.some(e => e.rank <= 0)) return null;
  let pair = null, best = 2;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const d = ends[i].dx * ends[j].dx + ends[i].dz * ends[j].dz;
    if (d < best) { best = d; pair = [ends[i], ends[j]]; }
  }
  if (best > -0.85) return null;
  const branch = ends.find(e => e !== pair[0] && e !== pair[1]);
  const a0 = Math.acos(clamp(pair[0].dx * branch.dx + pair[0].dz * branch.dz, -1, 1));
  const a1 = Math.acos(clamp(pair[1].dx * branch.dx + pair[1].dz * branch.dz, -1, 1));
  const theta = Math.min(a0, a1);
  if (theta > 0.72 || theta < 0.06) return null;      // 4°..41°: a merge, not a crossing or a split
  const up = a0 < a1 ? pair[0] : pair[1];             // mainline leg the branch parallels
  const down = up === pair[0] ? pair[1] : pair[0];
  return {
    up: up.id, down: down.id, branch: branch.id, theta,
    upAtA: up.atA, downAtA: down.atA, branchAtA: branch.atA,
  };
}

export function buildMergePaint(out, net, J, ctx) {
  if (ctx.markings === false) return out;
  const N = J.node, M = J.merge;
  const end = id => J.ends.find(e => e.id === id);
  const U = end(M.up), D = end(M.down), B = end(M.branch);
  if (!U || !D || !B) return out;
  // merge side: which side of the downstream leg the branch sits on
  const bsx = N.x + B.dx * B.setback, bsz = N.z + B.dz * B.setback;
  const lat = (bsx - N.x) * D.rx + (bsz - N.z) * D.rz;
  const side = lat >= 0 ? 1 : -1;
  // edge lines of the two roadways on the merge side
  const oD = side > 0 ? D.lay.curbR : D.lay.curbL;
  const oB = sideInBranch(B, N, D, side);
  // corner points at the setbacks
  const cD = cornerPoint(N, D, D.setback, oD);
  const cB = cornerPoint(N, B, B.setback, oB);
  // nose: where the branch edge line meets the mainline edge line
  const dirB = inward(B), dirD = [D.dx, D.dz];
  const bx = cB[0], bz = cB[1];
  const t = lineT(bx, bz, dirB, cD[0], cD[1], dirD);
  const goreLen = clamp(t > 0 ? t : 24, 14, 60);
  const nose = [bx + dirB[0] * goreLen, N.y, bz + dirB[1] * goreLen];
  const onD = [cD[0] + dirD[0] * ((nose[0] - cD[0]) * dirD[0] + (nose[2] - cD[1]) * dirD[1]), N.y, 0];
  onD[2] = cD[1] + dirD[1] * ((nose[0] - cD[0]) * dirD[0] + (nose[2] - cD[1]) * dirD[1]);
  // gore outline: branch edge → nose, mainline edge → nose
  band(out, 'markWhite', [toP(cB, N.y), nose], 0.1);
  band(out, 'markWhite', [toP(cD, N.y), onD], 0.1);
  // chevrons across the gore
  const n = Math.max(2, Math.floor(goreLen / 7));
  for (let k = 1; k <= n; k++) {
    const t0 = k / (n + 1), back = Math.max(0, t0 - 1.6 / goreLen);
    const a = lerpP(toP(cB, N.y), nose, t0), b = lerpP(toP(cD, N.y), onD, back);
    bar3(out, 'markWhite', a, b, 0.18);
  }
  // yield teeth are painted by the edge builder; add the keep-right marker at the nose
  if (ctx.props !== false) {
    out.prop('signKeepRight', nose[0], N.y + 0.02, nose[2], yawFor(-B.dx, -B.dz));
    out.prop('delineator', nose[0], N.y, nose[2], yawFor(D.dx, D.dz));
  }
  return out;
}
function cornerPoint(N, e, t, w) { return [N.x + e.dx * t + e.rx * w, N.z + e.dz * t + e.rz * w]; }
function toP(p, y) { return [p[0], y, p[1]]; }
function lerpP(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function inward(e) { return [-e.dx, -e.dz]; }
// branch curb offset on the merge side: the branch edge facing the mainline
function sideInBranch(B, N, D, side) {
  // candidate inner corners; pick the one nearer the downstream leg's edge line
  const cands = [B.lay.curbL, B.lay.curbR];
  let best = cands[0], bd = Infinity;
  for (const o of cands) {
    const p = cornerPoint(N, B, B.setback, o);
    const d = Math.abs((p[0] - N.x) * D.rx + (p[1] - N.z) * D.rz - side * Math.abs(side > 0 ? D.lay.curbR : D.lay.curbL));
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
// distance along dirB from (bx,bz) to the line through (cx,cz) dir dirD
function lineT(bx, bz, dirB, cx, cz, dirD) {
  const den = dirB[0] * dirD[1] - dirB[1] * dirD[0];
  if (Math.abs(den) < 1e-6) return -1;
  const wx = cx - bx, wz = cz - bz;
  return (wx * dirD[1] - wz * dirD[0]) / den;
}
function band(out, mat, pts, half) {
  if (pts.length < 2) return;
  const pc = out.piece(mat), base = pc.p.length / 3;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.vert(pc, p[0] - tz * half, p[1] + PAINT, p[2] + tx * half, 0, 0);
    out.vert(pc, p[0] + tz * half, p[1] + PAINT, p[2] - tx * half, 1, 0);
  }
  for (let k = 0; k + 1 < pts.length; k++) { const q = base + k * 2; pc.i.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
}
function bar3(out, mat, a, b, w) {
  let dx = b[0] - a[0], dz = b[2] - a[2];
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const nx = -dz * w / 2, nz = dx * w / 2;
  const pc = out.piece(mat), q = pc.p.length / 3;
  out.vert(pc, a[0] + nx, a[1] + PAINT, a[2] + nz, 0, 0);
  out.vert(pc, a[0] - nx, a[1] + PAINT, a[2] - nz, 0, 0);
  out.vert(pc, b[0] + nx, b[1] + PAINT, b[2] + nz, 1, 0);
  out.vert(pc, b[0] - nx, b[1] + PAINT, b[2] - nz, 1, 0);
  pc.i.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
}
