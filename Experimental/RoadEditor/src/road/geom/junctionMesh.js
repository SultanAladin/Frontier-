// Junction surface, curb returns, sidewalk corners, roundabout islands and through-tram rails.
import { ShapeUtils, Vector2 } from 'three';
import { Out, strip, polyWall, polygon, ribbon, quad } from './out.js';
import { CURB_W, GROUND, tramRails } from './edge.js';
import { LEVEL, getProfile, layout } from '../profiles.js';
import { line } from './markings.js';
import { nodeControl } from './control.js';

const H = LEVEL.raised;

function inset(curb, outer, d) {
  return curb.map((p, k) => {
    const q = outer[k], dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz);
    if (l < 1e-6) return p.slice();
    const t = Math.min(d, l * 0.5) / l;
    return [p[0] + dx * t, p[1], p[2] + dz * t];
  });
}
const lift = (P, h) => P.map(p => [p[0], p[1] + h, p[2]]);

export function buildJunction(net, J, ctx) {
  const out = new Out(J.id);
  out.kind = J.kind;
  if (!J.polygon || J.polygon.length < 3) {
    if (J.node) out.grow(J.node.x, J.node.y, J.node.z);
    return out;
  }
  // surface material = shared surface of incident roads, else asphalt
  const surfaces = new Set(J.ends.map(e => getProfile(e.edge).surface || 'asphalt'));
  const mat = surfaces.size === 1 ? [...surfaces][0] : (surfaces.has('asphalt') ? 'asphalt' : [...surfaces][0]);

  // --- surface polygon (with island hole for roundabouts)
  const contour = J.polygon.map(p => new Vector2(p[0], p[2]));
  const holes = J.hole ? [J.hole.map(p => new Vector2(p[0], p[2]))] : [];
  let tris;
  try {
    const clean = dedupe(contour);
    const faces = ShapeUtils.triangulateShape(clean.pts, holes);
    const all = [...clean.src.map(i => J.polygon[i]), ...(J.hole || [])];
    tris = [];
    for (const [a, b, c] of faces) {
      const A = all[a], B = all[b], C = all[c];
      // upward facing ⇔ (C-B)×(A-B) has +y ⇔ cross in xz of (B-A),(C-A) negative
      const cr = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
      if (cr < 0) tris.push(a, b, c); else tris.push(a, c, b);
    }
    polygon(out, mat, all, tris);
  } catch (e) { out.warning = 'triangulation failed'; }

  // --- corners: curb returns + sidewalks
  for (const g of J.gaps) {
    if (!g.hasCurb) continue;
    const hasSw = Math.max(g.swA, g.swB) > 0.05;
    if (!hasSw) continue;
    const curbIn = inset(g.curb, g.outer, CURB_W);
    strip(out, 'curb', lift(g.curb, H), lift(curbIn, H));
    strip(out, 'sidewalk', lift(curbIn, H), lift(g.outer, H));
    polyWall(out, 'curb', g.curb, 0, H, +1);
    polyWall(out, 'curb', g.outer, GROUND, H, -1);
  }

  // Lane boundaries continue through the junction as shaped connectors. Unequal approaches
  // get a drawn taper and a hatched merge/diverge gore instead of abruptly losing a lane.
  if (ctx.markings !== false && J.kind === 'junction') addLaneTransitions(out, J);

  // --- roundabout island
  if (J.kind === 'roundabout' && J.hole) {
    const N = J.node, ring = J.hole.slice().reverse(); // CCW
    const inner = ring.map(p => { const dx = p[0] - N.x, dz = p[2] - N.z, l = Math.hypot(dx, dz); return [N.x + dx / l * (l - CURB_W * 1.5), p[1], N.z + dz / l * (l - CURB_W * 1.5)]; });
    ring.push(ring[0]); inner.push(inner[0]);
    strip(out, 'curb', lift(inner, H), lift(ring, H));
    polyWall(out, 'curb', ring, 0, H, -1);
    // apron (truck mountable) ring of pavers
    const apron = inner.map(p => { const dx = p[0] - N.x, dz = p[2] - N.z, l = Math.hypot(dx, dz); return [N.x + dx / l * (l - 2.2), p[1], N.z + dz / l * (l - 2.2)]; });
    strip(out, 'cobble', lift(apron, H - 0.05), lift(inner, H));
    const pc = out.piece('grass'), base = pc.p.length / 3;
    out.vert(pc, N.x, N.y + H + 0.25, N.z, N.x, N.z);
    for (const p of apron) out.vert(pc, p[0], p[1] + H - 0.05, p[2], p[0], p[2]);
    for (let k = 0; k < apron.length - 1; k++) pc.i.push(base, base + 2 + k, base + 1 + k);
    if (ctx.props !== false) {
      out.prop('treeA', N.x, N.y + H + 0.2, N.z, 0, 1.5, 1.5, 1.5);
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, r = (J.Ri - 3) * 0.55; out.prop('treeB', N.x + Math.cos(a) * r, N.y + H + 0.1, N.z + Math.sin(a) * r, a, 0.8, 0.8, 0.8); }
    }
    // circulating lane edge line along island
    out.grow(N.x - J.Rc, N.y, N.z - J.Rc); out.grow(N.x + J.Rc, N.y, N.z + J.Rc);
  }

  // --- tram rails straight through junction for opposing tram approaches
  const trams = J.ends.filter(e => layout(getProfile(e.edge)).lanes.some(l => l.type === 'tram'));
  for (let i = 0; i < trams.length; i++) for (let j = i + 1; j < trams.length; j++) {
    const A = trams[i], B = trams[j];
    if (A.dx * B.dx + A.dz * B.dz > -0.9) continue;
    for (const ln of layout(getProfile(A.edge)).lanes.filter(l => l.type === 'tram')) {
      const oc = (ln.o0 + ln.o1) / 2 * (A.atA ? 1 : -1); // into right-of-d frame
      for (const g of [-0.7175, 0.7175]) {
        const o = oc + g;
        const N = J.node;
        const pa = [N.x + A.dx * A.setback + A.rx * o, N.z + A.dz * A.setback + A.rz * o];
        const pb = [N.x + B.dx * B.setback - B.rx * o, N.z + B.dz * B.setback - B.rz * o];
        const fake = straightCl(pa, pb, N.y);
        tramRails(out, fake.frames, oc, 0);
      }
    }
  }

  // --- yellow box / centre markings: roundabout circulating line
  if (J.kind === 'roundabout' && ctx.markings !== false) {
    const N = J.node, r = J.Ri + 0.35 + CURB_W;
    const m = 72, frames = [];
    for (let k = 0; k <= m; k++) { const a = k / m * Math.PI * 2; frames.push({ x: N.x + Math.cos(a) * r, z: N.z + Math.sin(a) * r, y: N.y, s: a * r, tx: -Math.sin(a), tz: Math.cos(a), nx: -Math.cos(a), nz: -Math.sin(a) }); }
    ribbon(out, 'markYellow', frames, -0.06, 0.06, 0.012);
  }
  out.control = nodeControl(J);
  return out;
}

function straightCl(a, b, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const tx = dx / l, tz = dz / l;
  return { frames: [0, 1].map(t => ({ x: a[0] + dx * t, z: a[1] + dz * t, y, s: l * t, tx, tz, nx: -tz, nz: tx })) };
}

function laneGroup(lane) {
  if (lane.type === 'drive' || lane.type === 'bus') return 'motor';
  if (lane.type === 'bike' || lane.type === 'cycletrack') return 'bike';
  if (lane.type === 'tram') return 'tram';
  return null;
}

function travellingLanes(end, incoming, group) {
  return end.lay.lanes.filter(lane => {
    const direction = lane.dir ?? 0;
    const arrives = direction === 0 || (end.atA ? direction < 0 : direction > 0);
    const leaves = direction === 0 || (end.atA ? direction > 0 : direction < 0);
    return lane.meta.traffic && laneGroup(lane) === group && (incoming ? arrives : leaves);
  }).map(lane => {
    const local = (lane.o0 + lane.o1) / 2;
    const offset = incoming ? local * (end.atA ? -1 : 1) : local * (end.atA ? 1 : -1);
    return { lane, offset, width: lane.width, h: lane.h };
  }).sort((a, b) => a.offset - b.offset);
}

function endpoint(node, end, flowOffset, incoming, h) {
  const offset = incoming ? -flowOffset : flowOffset;
  const t = Math.max(0, end.setback || 0);
  return {
    x: node.x + end.dx * t + end.rx * offset,
    y: node.y + h + 0.022,
    z: node.z + end.dz * t + end.rz * offset,
  };
}

function transitionCurve(node, from, to, offsetA, offsetB, incomingLane, outgoingLane) {
  const p0 = endpoint(node, from, offsetA, true, incomingLane.h);
  const p3 = endpoint(node, to, offsetB, false, outgoingLane.h);
  const flow = [-from.dx, -from.dz], out = [to.dx, to.dz];
  const d = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  const handle = Math.min(18, Math.max(1.5, d * 0.38));
  const p1 = { x: p0.x + flow[0] * handle, y: p0.y, z: p0.z + flow[1] * handle };
  const p2 = { x: p3.x - out[0] * handle, y: p3.y, z: p3.z - out[1] * handle };
  const at = t => {
    const u = 1 - t;
    return {
      x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
      z: u ** 3 * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t ** 3 * p3.z,
    };
  };
  const steps = Math.max(8, Math.min(48, Math.ceil(d / 2.4)));
  const frames = [];
  let length = 0, prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = at(t), before = at(Math.max(0, t - 1 / (steps * 2))), after = at(Math.min(1, t + 1 / (steps * 2)));
    let tx = after.x - before.x, tz = after.z - before.z;
    const mag = Math.hypot(tx, tz) || 1; tx /= mag; tz /= mag;
    if (prev) length += Math.hypot(p.x - prev.x, p.z - prev.z);
    frames.push({ x: p.x, y: p.y, z: p.z, tx, tz, nx: -tz, nz: tx, s: length });
    prev = p;
  }
  return { at, frames };
}

function drawTransition(out, node, from, to, offsetA, offsetB, laneA, laneB, width = 0.13, mat = 'markWhite') {
  const curve = transitionCurve(node, from, to, offsetA, offsetB, laneA, laneB);
  ribbon(out, mat, curve.frames, -width / 2, width / 2, 0.004);
  return curve;
}

function hatchMerge(out, curveA, curveB) {
  for (let t = 0.22; t < 0.88; t += 0.16) {
    const a = curveA.at(t), b = curveB.at(t);
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.28) continue;
    quad(out, 'markWhite', (a.x + b.x) / 2, (a.y + b.y) / 2 + 0.005, (a.z + b.z) / 2,
      dx / len, dz / len, Math.max(0.12, len * 0.43), 0.07);
  }
}

function addLaneTransitions(out, J) {
  const groups = ['motor', 'bike'];
  const stats = { movements: 0, connectors: 0, addedLanes: 0, droppedLanes: 0 };
  const ends = J.ends || [];
  for (const from of ends) for (const group of groups) {
    const incoming = travellingLanes(from, true, group);
    if (!incoming.length) continue;
    const flowX = -from.dx, flowZ = -from.dz;
    let to = null, best = 0.04;
    for (const candidate of ends) {
      if (candidate === from) continue;
      const outgoing = travellingLanes(candidate, false, group);
      if (!outgoing.length) continue;
      const alignment = flowX * candidate.dx + flowZ * candidate.dz;
      if (alignment > best) { best = alignment; to = candidate; }
    }
    if (!to) continue;
    const outgoing = travellingLanes(to, false, group);
    if (!outgoing.length) continue;
    stats.movements++;

    const aCount = incoming.length, bCount = outgoing.length;
    const common = Math.min(aCount, bCount);
    for (let i = 0; i < common - 1; i++) {
      const oa = (incoming[i].offset + incoming[i + 1].offset) * 0.5;
      const ob = (outgoing[i].offset + outgoing[i + 1].offset) * 0.5;
      drawTransition(out, J.node, from, to, oa, ob, incoming[i], outgoing[i + 1], 0.13);
      stats.connectors++;
    }

    if (aCount > bCount) {
      // The rightmost excess lane tapers into the receiving outer lane. A short hatch gore
      // makes the lane drop explicit and keeps the merge boundary from ending mid-pavement.
      const kept = outgoing[bCount - 1];
      const firstDrop = incoming[bCount];
      const lastDrop = incoming[aCount - 1];
      const boundaryA = (incoming[bCount - 1].offset + firstDrop.offset) * 0.5;
      const outerA = lastDrop.offset + lastDrop.width / 2;
      const outerB = kept.offset + kept.width / 2;
      const merge = drawTransition(out, J.node, from, to, boundaryA, outerB, incoming[bCount - 1], kept, 0.17);
      const outer = transitionCurve(J.node, from, to, outerA, outerB, lastDrop, kept);
      hatchMerge(out, merge, outer);
      stats.droppedLanes += aCount - bCount;
    } else if (bCount > aCount) {
      // New lanes appear as a drawn taper from the upstream outside edge to each new divider.
      const last = incoming[aCount - 1];
      const outerA = last.offset + last.width / 2;
      for (let i = aCount - 1; i < bCount - 1; i++) {
        const boundaryB = (outgoing[i].offset + outgoing[i + 1].offset) * 0.5;
        drawTransition(out, J.node, from, to, outerA, boundaryB, last, outgoing[i + 1], 0.14);
        stats.connectors++;
        stats.addedLanes++;
      }
    }
  }
  out.laneTopology = stats;
}

function dedupe(contour) {
  const pts = [], src = [];
  contour.forEach((p, i) => {
    const q = pts[pts.length - 1];
    if (q && Math.abs(q.x - p.x) < 1e-3 && Math.abs(q.y - p.y) < 1e-3) return;
    pts.push(p); src.push(i);
  });
  if (pts.length > 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) { pts.pop(); src.pop(); } }
  return { pts, src };
}
