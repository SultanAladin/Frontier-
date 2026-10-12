// Rail junction solver. Classifies each rail node and fixes where every incident track ends:
//   continuation — degree 2, same profile, straight: track flows through untouched.
//   buffer / terminus — degree 1: track ends in a buffer stop (heavy) or a beam cap (mono).
//   switch     — heavy degree 3: a turnout. The most-aligned pair is the through route, the odd
//                leg diverges; the facing leg is the through leg trains enter from to diverge.
//   diamond    — heavy degree 4 as two straight pairs: a crossing diamond, both routes through.
//   joint      — heavy degree 2 that is neither continuation nor switch (profile change / kink).
//   yard       — heavy fallback: ballast apron, every leg butts into it.
//   station    — mono degree ≥3, or any mono node flagged as a station: deck + side platforms.
//   mixed      — legs of different families share a node: no connection, each passes at its level.
import { getRailProfile, railLayout } from './railProfiles.js';

function endInfo(rail, edge, nodeId) {
  const c = rail.centerline(edge), lay = railLayout(getRailProfile(edge));
  const atA = edge.a === nodeId;
  const f = c.frameAt(atA ? 0 : c.length);
  const dx = atA ? f.tx : -f.tx, dz = atA ? f.tz : -f.tz;
  return {
    edge, id: edge.id, atA, c, lay, len: c.length,
    dx, dz, rx: -dz, rz: dx, ang: Math.atan2(dz, dx),
    half: lay.half, family: lay.family, tracks: lay.tracks,
    ey: f.y || 0, setback: 0,
  };
}

const P = (N, e, t, w) => [N.x + e.dx * t + e.rx * w, N.z + e.dz * t + e.rz * w];

// Monotone-chain convex hull over [x,z] points; returns CCW ring without duplicate endpoint.
export function hull2(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-9) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

function mostAlignedPair(ends) {
  let best = null, bestDot = 2;
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const d = ends[i].dx * ends[j].dx + ends[i].dz * ends[j].dz;
    if (d < bestDot) { bestDot = d; best = [ends[i], ends[j]]; }
  }
  return { pair: best, dot: bestDot };
}

export function computeRailJunction(rail, nodeId) {
  const N = rail.nodes.get(nodeId);
  const edges = rail.nodeEdges(nodeId);
  const J = { id: nodeId, node: N, y: N ? N.y : 0, ends: [], kind: 'none', polygon: null, spec: null };
  if (!N || !edges.length) return J;
  const ends = edges.map(e => endInfo(rail, e, nodeId)).sort((a, b) => a.ang - b.ang);
  J.ends = ends;
  const map = new Map(ends.map(e => [e.id + (e.atA ? ':a' : ':b'), e]));
  J.endFor = (edgeId, atA) => map.get(edgeId + (atA ? ':a' : ':b'));

  const fams = new Set(ends.map(e => e.family));
  if (fams.size > 1) { J.kind = 'mixed'; return J; }
  const family = ends[0].family;
  const wantStation = !!N.station;

  if (rail.isContinuation(nodeId) && !wantStation) { J.kind = 'continuation'; return J; }

  if (ends.length === 1) {
    ends[0].setback = 0.5;
    J.kind = family === 'mono' ? 'terminus' : 'buffer';
    return J;
  }

  if (family === 'mono') {
    if (ends.length === 2 && !wantStation) {
      // kink or single↔double transition: beams butt into a small cover plate
      for (const e of ends) e.setback = 1.0;
      J.kind = 'joint';
      J.polygon = plate(J);
      return J;
    }
    // station: deck + side platforms along the through pair
    const { pair } = mostAlignedPair(ends);
    const [A, B] = pair;
    const platHalf = 34;
    for (const e of ends) e.setback = (e === A || e === B) ? platHalf : 6;
    for (const e of ends) e.setback = Math.min(e.setback, Math.max(2, e.len * 0.42));
    J.kind = 'station';
    J.spec = { thru: [A.id + (A.atA ? ':a' : ':b'), B.id + (B.atA ? ':a' : ':b')] };
    J.polygon = plate(J, 3.5);
    return J;
  }

  // ---- heavy rail ----
  if (ends.length === 2) {
    for (const e of ends) e.setback = 2;
    J.kind = 'joint';
    J.polygon = plate(J);
    return J;
  }
  if (ends.length === 3) {
    const { pair } = mostAlignedPair(ends);
    const [A, B] = pair;
    const D = ends.find(e => e !== A && e !== B);
    for (const e of ends) e.setback = 4;
    // facing leg: the through leg whose inward direction best matches the diverging outward dir
    const sA = -(A.dx * D.dx + A.dz * D.dz), sB = -(B.dx * D.dx + B.dz * D.dz);
    const F = sA >= sB ? A : B;
    J.kind = 'switch';
    J.spec = {
      thru: [A.id + (A.atA ? ':a' : ':b'), B.id + (B.atA ? ':a' : ':b')],
      div: D.id + (D.atA ? ':a' : ':b'),
      facing: F.id + (F.atA ? ':a' : ':b'),
    };
    J.polygon = plate(J);
    return J;
  }
  if (ends.length === 4) {
    const { pair, dot } = mostAlignedPair(ends);
    const rest = ends.filter(e => e !== pair[0] && e !== pair[1]);
    const dot2 = rest[0].dx * rest[1].dx + rest[0].dz * rest[1].dz;
    for (const e of ends) e.setback = 3;
    if (dot < -0.9 && dot2 < -0.9) {
      J.kind = 'diamond';
      J.spec = {
        pairA: [pair[0].id + (pair[0].atA ? ':a' : ':b'), pair[1].id + (pair[1].atA ? ':a' : ':b')],
        pairB: [rest[0].id + (rest[0].atA ? ':a' : ':b'), rest[1].id + (rest[1].atA ? ':a' : ':b')],
      };
    } else {
      J.kind = 'yard';
    }
    J.polygon = plate(J);
    return J;
  }
  for (const e of ends) e.setback = 2;
  J.kind = 'yard';
  J.polygon = plate(J);
  return J;
}

// Ballast/deck apron: convex hull of the leg end sections (plus margin), lifted to node height.
function plate(J, margin = 0.6) {
  const N = J.node, pts = [];
  for (const e of J.ends) {
    const t = e.setback, w = e.half + margin;
    pts.push(P(N, e, t, -w), P(N, e, t, w));
    if (e.setback > 8) { const m = e.setback * 0.5; pts.push(P(N, e, m, -w), P(N, e, m, w)); }
  }
  pts.push([N.x, N.z]);
  return hull2(pts).map(([x, z]) => [x, N.y, z]);
}

export const RAIL_KIND_LABEL = {
  none: 'Isolated', continuation: 'Through', buffer: 'Buffer stop', terminus: 'Terminus',
  switch: 'Turnout', diamond: 'Diamond crossing', joint: 'Joint', yard: 'Yard', station: 'Station', mixed: 'Crossing',
};
