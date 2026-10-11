// Frontier Road Generator Studio — 3D Math, Cubic Splines & Planar Graph Auto-Merger

export const EPS = 1e-6;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / Math.max(EPS, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dotXZ = (a, b) => a[0] * b[0] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const crossXZ = (a, b) => a[0] * b[2] - a[2] * b[0];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const lenXZ = (a) => Math.hypot(a[0], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const distXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-8 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

export function normXZ(a) {
  const l = Math.hypot(a[0], a[2]);
  return l > 1e-8 ? [a[0] / l, 0, a[2] / l] : [1, 0, 0];
}

// Right-hand planar normal in XZ (when looking along +d, right is [d.z, 0, -d.x] or [-d.z, 0, d.x])
// Standard convention: +X East, +Z South, +Y Up => Forward=[0,0,-1] has Right=[1,0,0] = [-d.z, 0, d.x]
export function rightXZ(d) {
  const n = normXZ(d);
  return [-n[2], 0, n[0]];
}

export function angleXZ(d) {
  return Math.atan2(d[2], d[0]);
}

export function wrapAnglePositive(a) {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
}

// Cubic Bezier evaluation & derivatives
export function evalCubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return [
    b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
    b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2],
  ];
}

export function evalCubicDeriv(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const c0 = 3 * u * u;
  const c1 = 6 * u * t;
  const c2 = 3 * t * t;
  return [
    c0 * (p1[0] - p0[0]) + c1 * (p2[0] - p1[0]) + c2 * (p3[0] - p2[0]),
    c0 * (p1[1] - p0[1]) + c1 * (p2[1] - p1[1]) + c2 * (p3[1] - p2[1]),
    c0 * (p1[2] - p0[2]) + c1 * (p2[2] - p1[2]) + c2 * (p3[2] - p2[2]),
  ];
}

export function evalCubicSecondDeriv(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    6 * u * (p2[0] - 2 * p1[0] + p0[0]) + 6 * t * (p3[0] - 2 * p2[0] + p1[0]),
    6 * u * (p2[1] - 2 * p1[1] + p0[1]) + 6 * t * (p3[1] - 2 * p2[1] + p1[1]),
    6 * u * (p2[2] - 2 * p1[2] + p0[2]) + 6 * t * (p3[2] - 2 * p2[2] + p1[2]),
  ];
}

export function splitCubic(p0, p1, p2, p3, t) {
  const p01 = lerp3(p0, p1, t);
  const p12 = lerp3(p1, p2, t);
  const p23 = lerp3(p2, p3, t);
  const p012 = lerp3(p01, p12, t);
  const p123 = lerp3(p12, p23, t);
  const p0123 = lerp3(p012, p123, t);
  return {
    left: [p0, p01, p012, p0123],
    right: [p0123, p123, p23, p3],
    mid: p0123,
  };
}

// Compute cubic Bezier control points from road endpoints and optional curve control point(s)
export function getRoadControlPoints(road, nodesMap) {
  const n0 = nodesMap.get(road.start);
  const n1 = nodesMap.get(road.end);
  if (!n0 || !n1) return [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const p0 = [...n0.position];
  const p3 = [...n1.position];
  if (road.ctrl1 && road.ctrl2) {
    return [p0, [...road.ctrl1], [...road.ctrl2], p3];
  }
  if (road.curvePoint) {
    // Convert quadratic/pass-through midpoint M at t=0.5 into symmetric cubic control points
    const m = road.curvePoint;
    const midY = 0.5 * (p0[1] + p3[1]) + (m[1] || 0);
    const c = [
      2 * m[0] - 0.5 * (p0[0] + p3[0]),
      midY,
      2 * m[2] - 0.5 * (p0[2] + p3[2]),
    ];
    const p1 = lerp3(p0, c, 2 / 3);
    const p2 = lerp3(p3, c, 2 / 3);
    return [p0, p1, p2, p3];
  }
  return [p0, lerp3(p0, p3, 1 / 3), lerp3(p0, p3, 2 / 3), p3];
}

// Sample road spline with arc-length stations, curvature, grade, and vertical arch/tunnel profile
export function sampleRoadAlignment(road, nodesMap, stepMeters = 1.6) {
  const [p0, p1, p2, p3] = getRoadControlPoints(road, nodesMap);
  const rawSteps = 96;
  const raw = [];
  let accumLength = 0;
  let prev = p0;
  for (let i = 0; i <= rawSteps; i++) {
    const t = i / rawSteps;
    const p = evalCubic(p0, p1, p2, p3, t);
    // Optional bridge arch or underpass dip profile along road
    if (road.verticalProfile === 'bridge-arch') {
      const arch = Math.sin(t * Math.PI);
      p[1] += (road.profileElevation ?? 7.2) * Math.pow(arch, 1.35);
    } else if (road.verticalProfile === 'underpass-dip') {
      const dip = Math.sin(t * Math.PI);
      p[1] -= Math.abs(road.profileElevation ?? 5.6) * Math.pow(dip, 1.45);
    }
    if (i > 0) accumLength += dist(p, prev);
    const dRaw = evalCubicDeriv(p0, p1, p2, p3, t);
    const ddRaw = evalCubicSecondDeriv(p0, p1, p2, p3, t);
    const d = normXZ(dRaw);
    const n = rightXZ(d);
    const speedXZ = Math.max(0.01, lenXZ(dRaw));
    const kappa = crossXZ(dRaw, ddRaw) / (speedXZ * speedXZ * speedXZ);
    raw.push({ t, s: accumLength, p, d, n, kappa });
    prev = p;
  }

  const totalLength = Math.max(0.1, accumLength);
  const numStations = Math.max(8, Math.ceil(totalLength / stepMeters));
  const stations = [];
  let rawIdx = 0;
  for (let k = 0; k <= numStations; k++) {
    const targetS = (k / numStations) * totalLength;
    while (rawIdx < raw.length - 2 && raw[rawIdx + 1].s < targetS) {
      rawIdx++;
    }
    const a = raw[rawIdx];
    const b = raw[rawIdx + 1];
    const frac = clamp((targetS - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    const t = lerp(a.t, b.t, frac);
    const p = evalCubic(p0, p1, p2, p3, t);
    let dyDt = 0;
    if (road.verticalProfile === 'bridge-arch') {
      const arch = Math.sin(t * Math.PI);
      const h = road.profileElevation ?? 7.2;
      p[1] += h * Math.pow(Math.max(0, arch), 1.35);
      dyDt = h * 1.35 * Math.pow(Math.max(1e-4, arch), 0.35) * Math.cos(t * Math.PI) * Math.PI;
    } else if (road.verticalProfile === 'underpass-dip') {
      const dip = Math.sin(t * Math.PI);
      const h = Math.abs(road.profileElevation ?? 5.6);
      p[1] -= h * Math.pow(Math.max(0, dip), 1.45);
      dyDt = -h * 1.45 * Math.pow(Math.max(1e-4, dip), 0.45) * Math.cos(t * Math.PI) * Math.PI;
    }
    const dRaw = evalCubicDeriv(p0, p1, p2, p3, t);
    dRaw[1] += dyDt;
    const d = normXZ(dRaw);
    const n = rightXZ(d);
    const grade = (dRaw[1] / Math.max(0.1, lenXZ(dRaw))) * 100;
    const kappa = lerp(a.kappa, b.kappa, frac);
    stations.push({
      t,
      s: targetS,
      p,
      d,
      n,
      grade,
      kappa,
    });
  }
  return {
    roadId: road.id,
    p0,
    p1,
    p2,
    p3,
    length: totalLength,
    stations,
  };
}

export function interpolateStationAtS(alignment, targetS) {
  const st = alignment.stations;
  if (targetS <= st[0].s) return { ...st[0], p: [...st[0].p], d: [...st[0].d], n: [...st[0].n] };
  if (targetS >= st[st.length - 1].s) {
    const last = st[st.length - 1];
    return { ...last, p: [...last.p], d: [...last.d], n: [...last.n] };
  }
  let lo = 0;
  let hi = st.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (st[mid].s <= targetS) lo = mid;
    else hi = mid;
  }
  const a = st[lo];
  const b = st[hi];
  const u = clamp((targetS - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
  const d = normXZ(lerp3(a.d, b.d, u));
  return {
    t: lerp(a.t, b.t, u),
    s: targetS,
    p: lerp3(a.p, b.p, u),
    d,
    n: rightXZ(d),
    grade: lerp(a.grade, b.grade, u),
    kappa: lerp(a.kappa, b.kappa, u),
  };
}

// 2D XZ Segment-Segment Intersection
export function intersectSegmentsXZ(a0, a1, b0, b1) {
  const r = [a1[0] - a0[0], 0, a1[2] - a0[2]];
  const s = [b1[0] - b0[0], 0, b1[2] - b0[2]];
  const denom = crossXZ(r, s);
  if (Math.abs(denom) < 1e-7) return null;
  const qp = [b0[0] - a0[0], 0, b0[2] - a0[2]];
  const t = crossXZ(qp, s) / denom;
  const u = crossXZ(qp, r) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    const p = lerp3(a0, a1, t);
    const q = lerp3(b0, b1, u);
    return {
      t,
      u,
      point: [p[0], 0.5 * (p[1] + q[1]), p[2]],
      elevationDiff: Math.abs(p[1] - q[1]),
    };
  }
  return null;
}

// Ray-Line Intersection in XZ plane: P = a + t * da, Q = b + u * db
export function intersectRaysXZ(a, da, b, db) {
  const denom = crossXZ(da, db);
  if (Math.abs(denom) < 1e-6) return null;
  const delta = [b[0] - a[0], 0, b[2] - a[2]];
  const t = crossXZ(delta, db) / denom;
  const u = crossXZ(delta, da) / denom;
  return {
    t,
    u,
    point: [a[0] + da[0] * t, 0.5 * (a[1] + b[1]), a[2] + da[2] * t],
  };
}

// Closest point on sampled alignment in XZ
export function closestPointOnAlignmentXZ(alignment, pt) {
  let bestDist = Infinity;
  let bestStation = alignment.stations[0];
  const st = alignment.stations;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    const abx = b.p[0] - a.p[0];
    const abz = b.p[2] - a.p[2];
    const lenSq = abx * abx + abz * abz;
    const u = lenSq > 1e-8 ? clamp(((pt[0] - a.p[0]) * abx + (pt[2] - a.p[2]) * abz) / lenSq, 0, 1) : 0;
    const px = a.p[0] + abx * u;
    const pz = a.p[2] + abz * u;
    const d = Math.hypot(pt[0] - px, pt[2] - pz);
    if (d < bestDist) {
      bestDist = d;
      bestStation = interpolateStationAtS(alignment, lerp(a.s, b.s, u));
    }
  }
  return { distance: bestDist, station: bestStation };
}

/**
 * Automatic At-Grade Spline Intersection Splitter & Merger:
 * Prevents overlapping geometry ("| layered on -" or "V + |") by detecting
 * at-grade spline crossings (|dy| < 2.5m) and T/Y endpoint-to-spline junctions,
 * splitting the splines cleanly at the intersection point, and creating a single
 * shared IntersectionNode with merged quad topology.
 */
export function resolveSplineNetworkIntersections(project) {
  let modified = false;
  let safetyCounter = 0;

  while (safetyCounter++ < 16) {
    let splitOccurred = false;
    const nodesMap = new Map(project.nodes.map((n) => [n.id, n]));
    const alignments = new Map(
      project.roads.map((r) => [r.id, sampleRoadAlignment(r, nodesMap, 2.0)])
    );

    // 1. Check if any road endpoint lies near the interior of another road (T or Y junction)
    for (const node of project.nodes) {
      for (const road of project.roads) {
        if (road.start === node.id || road.end === node.id) continue;
        const align = alignments.get(road.id);
        if (!align || align.length < 18) continue;
        const closest = closestPointOnAlignmentXZ(align, node.position);
        const halfW = (road.lanes * road.laneWidth) * 0.5 + (road.sidewalk ?? 3.5);
        const endMargin = Math.max(8, halfW * 1.3);
        if (
          closest.distance < halfW + 2.5 &&
          closest.station.s > endMargin &&
          closest.station.s < align.length - endMargin &&
          Math.abs(closest.station.p[1] - node.position[1]) < 2.4 &&
          road.verticalProfile !== 'bridge-arch' &&
          road.verticalProfile !== 'underpass-dip'
        ) {
          // Snap node onto the spline and split the road into two segments meeting at `node`
          node.position = [...closest.station.p];
          const [p0, p1, p2, p3] = getRoadControlPoints(road, nodesMap);
          const { left, right } = splitCubic(p0, p1, p2, p3, closest.station.t);
          const roadA = {
            ...road,
            id: `${road.id}-a`,
            name: `${road.name} · West/South`,
            start: road.start,
            end: node.id,
            ctrl1: left[1],
            ctrl2: left[2],
            curvePoint: null,
          };
          const roadB = {
            ...road,
            id: `${road.id}-b`,
            name: `${road.name} · East/North`,
            start: node.id,
            end: road.end,
            ctrl1: right[1],
            ctrl2: right[2],
            curvePoint: null,
          };
          project.roads = project.roads.filter((r) => r.id !== road.id).concat([roadA, roadB]);
          splitOccurred = true;
          modified = true;
          break;
        }
      }
      if (splitOccurred) break;
    }
    if (splitOccurred) continue;

    // 2. Check if any two road splines cross each other at-grade (|dy| < 2.4m)
    for (let i = 0; i < project.roads.length; i++) {
      for (let j = i + 1; j < project.roads.length; j++) {
        const rA = project.roads[i];
        const rB = project.roads[j];
        // Skip if they already share a node and only touch near that node
        const shareNode =
          rA.start === rB.start ||
          rA.start === rB.end ||
          rA.end === rB.start ||
          rA.end === rB.end;
        if (
          rA.verticalProfile === 'bridge-arch' ||
          rB.verticalProfile === 'bridge-arch' ||
          rA.verticalProfile === 'underpass-dip' ||
          rB.verticalProfile === 'underpass-dip'
        ) {
          continue; // Grade-separated overpass/underpass!
        }

        const alignA = alignments.get(rA.id);
        const alignB = alignments.get(rB.id);
        if (!alignA || !alignB) continue;

        let foundHit = null;
        const stA = alignA.stations;
        const stB = alignB.stations;
        for (let ia = 0; ia < stA.length - 1 && !foundHit; ia++) {
          for (let ib = 0; ib < stB.length - 1 && !foundHit; ib++) {
            const hit = intersectSegmentsXZ(stA[ia].p, stA[ia + 1].p, stB[ib].p, stB[ib + 1].p);
            if (!hit || hit.elevationDiff >= 2.4) continue;
            const sA = lerp(stA[ia].s, stA[ia + 1].s, hit.t);
            const sB = lerp(stB[ib].s, stB[ib + 1].s, hit.u);
            const tA = lerp(stA[ia].t, stA[ia + 1].t, hit.t);
            const tB = lerp(stB[ib].t, stB[ib + 1].t, hit.u);
            const margin = shareNode ? 14 : 6;
            if (
              sA > margin &&
              sA < alignA.length - margin &&
              sB > margin &&
              sB < alignB.length - margin
            ) {
              foundHit = { point: hit.point, tA, tB };
            }
          }
        }

        if (foundHit) {
          const newNodeId = `node-merged-${Date.now().toString(36)}-${safetyCounter}`;
          const newNode = {
            id: newNodeId,
            name: `Merged Junction ${project.nodes.length + 1}`,
            position: foundHit.point,
            radius: 9.5,
            crossings: true,
            signalized: true,
            bollards: true,
          };
          project.nodes.push(newNode);

          const [a0, a1, a2, a3] = getRoadControlPoints(rA, nodesMap);
          const [b0, b1, b2, b3] = getRoadControlPoints(rB, nodesMap);
          const splitA = splitCubic(a0, a1, a2, a3, foundHit.tA);
          const splitB = splitCubic(b0, b1, b2, b3, foundHit.tB);

          const nextRoads = project.roads.filter((r) => r.id !== rA.id && r.id !== rB.id);
          nextRoads.push(
            {
              ...rA,
              id: `${rA.id}-1`,
              name: `${rA.name} (S1)`,
              start: rA.start,
              end: newNodeId,
              ctrl1: splitA.left[1],
              ctrl2: splitA.left[2],
              curvePoint: null,
            },
            {
              ...rA,
              id: `${rA.id}-2`,
              name: `${rA.name} (S2)`,
              start: newNodeId,
              end: rA.end,
              ctrl1: splitA.right[1],
              ctrl2: splitA.right[2],
              curvePoint: null,
            },
            {
              ...rB,
              id: `${rB.id}-1`,
              name: `${rB.name} (S1)`,
              start: rB.start,
              end: newNodeId,
              ctrl1: splitB.left[1],
              ctrl2: splitB.left[2],
              curvePoint: null,
            },
            {
              ...rB,
              id: `${rB.id}-2`,
              name: `${rB.name} (S2)`,
              start: newNodeId,
              end: rB.end,
              ctrl1: splitB.right[1],
              ctrl2: splitB.right[2],
              curvePoint: null,
            }
          );
          project.roads = nextRoads;
          splitOccurred = true;
          modified = true;
          break;
        }
      }
      if (splitOccurred) break;
    }
    if (!splitOccurred) break;
  }

  return modified;
}

// 4x4 Column-Major Matrix Operations for WebGPU / WebGL2 & Ray Picking
export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad * 0.5);
  const nf = 1.0 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / Math.max(0.01, aspect);
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4Ortho(left, right, bottom, top, near, far) {
  const m = new Float32Array(16);
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  m[0] = -2 * lr;
  m[5] = -2 * bt;
  m[10] = 2 * nf;
  m[12] = (left + right) * lr;
  m[13] = (top + bottom) * bt;
  m[14] = (far + near) * nf;
  m[15] = 1;
  return m;
}

export function mat4LookAt(eye, target, up = [0, 1, 0]) {
  const z = norm(sub(eye, target));
  let x = cross(up, z);
  if (len(x) < 1e-5) x = [1, 0, 0];
  else x = norm(x);
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, eye);
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, eye);
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot(z, eye);
  m[3] = 0;    m[7] = 0;    m[11] = 0;    m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function projectPointToScreen(worldPt, vpMat, width, height) {
  const x = worldPt[0], y = worldPt[1], z = worldPt[2];
  const cx = vpMat[0] * x + vpMat[4] * y + vpMat[8] * z + vpMat[12];
  const cy = vpMat[1] * x + vpMat[5] * y + vpMat[9] * z + vpMat[13];
  const cz = vpMat[2] * x + vpMat[6] * y + vpMat[10] * z + vpMat[14];
  const cw = vpMat[3] * x + vpMat[7] * y + vpMat[11] * z + vpMat[15];
  if (cw <= 0.05) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  return [
    (ndcX * 0.5 + 0.5) * width,
    (0.5 - ndcY * 0.5) * height,
    ndcZ,
    cw,
  ];
}

export function createCameraRay(screenX, screenY, width, height, eye, target, fovRad) {
  const aspect = width / Math.max(1, height);
  const ndcX = (screenX / width) * 2 - 1;
  const ndcY = 1 - (screenY / height) * 2;
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const tanHalf = Math.tan(fovRad * 0.5);
  const dir = norm([
    fwd[0] + right[0] * ndcX * aspect * tanHalf + up[0] * ndcY * tanHalf,
    fwd[1] + right[1] * ndcX * aspect * tanHalf + up[1] * ndcY * tanHalf,
    fwd[2] + right[2] * ndcX * aspect * tanHalf + up[2] * ndcY * tanHalf,
  ]);
  return { origin: [...eye], dir };
}

export function intersectRayPlaneY(ray, planeY = 0) {
  if (Math.abs(ray.dir[1]) < 1e-6) return null;
  const t = (planeY - ray.origin[1]) / ray.dir[1];
  if (t < 0) return null;
  return madd(ray.origin, ray.dir, t);
}

export function intersectRaySphere(ray, center, radius) {
  const oc = sub(ray.origin, center);
  const b = dot(oc, ray.dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
