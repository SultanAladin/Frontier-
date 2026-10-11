// Frontier Road Generator Studio — Watertight Quad-Dominant Mesh & Coons-Patch Intersection Engine

import {
  add,
  sub,
  scale,
  madd,
  lerp,
  lerp3,
  clamp,
  dot,
  dotXZ,
  cross,
  crossXZ,
  norm,
  normXZ,
  rightXZ,
  dist,
  distXZ,
  angleXZ,
  wrapAnglePositive,
  evalCubic,
  evalCubicDeriv,
  sampleRoadAlignment,
  interpolateStationAtS,
} from './math-splines.js';

export class QuadMeshBuilder {
  constructor() {
    this.batches = new Map();
    this.quadWireSegments = []; // Pairs of 3D points representing ONLY true 4-sided quad perimeter edges
    this.totalQuads = 0;
    this.totalTriangles = 0;
    this.pickables = []; // Bounding boxes / spheres for 3D raycast picking
  }

  getBatch(materialId, layerId = 'roads', ownerId = 'scene') {
    const key = `${materialId}::${layerId}`;
    let b = this.batches.get(key);
    if (!b) {
      b = {
        key,
        materialId,
        layerId,
        ownerId,
        positions: [],
        normals: [],
        uvs: [],
        colors: [], // r, g, b, a (vertex tint / AO / wear mask)
        indices: [],
        quads: [], // [i0, i1, i2, i3] for true quad OBJ export & topology inspection
      };
      this.batches.set(key, b);
    }
    return b;
  }

  addQuadWire(p0, p1, p2, p3) {
    this.quadWireSegments.push(
      p0[0], p0[1] + 0.008, p0[2], p1[0], p1[1] + 0.008, p1[2],
      p1[0], p1[1] + 0.008, p1[2], p2[0], p2[1] + 0.008, p2[2],
      p2[0], p2[1] + 0.008, p2[2], p3[0], p3[1] + 0.008, p3[2],
      p3[0], p3[1] + 0.008, p3[2], p0[0], p0[1] + 0.008, p0[2]
    );
  }

  // Add a single 4-vertex Quad (CCW winding when viewed from outside/above: p0 -> p1 -> p2 -> p3)
  addQuad(materialId, layerId, ownerId, p0, p1, p2, p3, uv0, uv1, uv2, uv3, color = [1, 1, 1, 1], recordWire = true) {
    const b = this.getBatch(materialId, layerId, ownerId);
    const e1 = sub(p1, p0);
    const e2 = sub(p3, p0);
    let n = cross(e1, e2);
    if (Math.hypot(n[0], n[1], n[2]) < 1e-8) {
      n = [0, 1, 0];
    } else {
      n = norm(n);
    }

    const base = b.positions.length / 3;
    const pts = [p0, p1, p2, p3];
    const uvs = [
      uv0 || [0, 0],
      uv1 || [1, 0],
      uv2 || [1, 1],
      uv3 || [0, 1],
    ];
    for (let i = 0; i < 4; i++) {
      b.positions.push(pts[i][0], pts[i][1], pts[i][2]);
      b.normals.push(n[0], n[1], n[2]);
      b.uvs.push(uvs[i][0], uvs[i][1]);
      b.colors.push(color[0], color[1], color[2], color[3] ?? 1);
    }
    b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.quads.push([base, base + 1, base + 2, base + 3]);
    this.totalQuads += 1;
    this.totalTriangles += 2;
    if (recordWire) {
      this.addQuadWire(p0, p1, p2, p3);
    }
  }

  /**
   * Add a structured R x C grid of Quads with shared welded vertices and smooth vertex normals.
   * grid[r][c] = { p: [x,y,z], uv: [u,v], n?: [nx,ny,nz], color?: [r,g,b,a] }
   */
  addQuadGrid(materialId, layerId, ownerId, grid, flipWinding = false, recordWire = true) {
    const rows = grid.length;
    if (rows < 2) return;
    const cols = grid[0].length;
    if (cols < 2) return;

    const b = this.getBatch(materialId, layerId, ownerId);
    const base = b.positions.length / 3;

    // Compute smooth normals if not explicitly provided
    const computedNormals = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [0, 0, 0])
    );

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p00 = grid[r][c].p;
        const p10 = grid[r + 1][c].p;
        const p11 = grid[r + 1][c + 1].p;
        const p01 = grid[r][c + 1].p;
        const diag1 = sub(p11, p00);
        const diag2 = sub(p01, p10);
        const fn = flipWinding ? cross(diag2, diag1) : cross(diag1, diag2);
        for (const [rr, cc] of [[r, c], [r + 1, c], [r + 1, c + 1], [r, c + 1]]) {
          computedNormals[rr][cc][0] += fn[0];
          computedNormals[rr][cc][1] += fn[1];
          computedNormals[rr][cc][2] += fn[2];
        }
        if (recordWire) {
          this.addQuadWire(p00, p10, p11, p01);
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const n = cell.n ? norm(cell.n) : norm(computedNormals[r][c]);
        const uv = cell.uv || [c / (cols - 1), r / (rows - 1)];
        const col = cell.color || [1, 1, 1, 1];
        b.positions.push(cell.p[0], cell.p[1], cell.p[2]);
        b.normals.push(n[0], n[1], n[2]);
        b.uvs.push(uv[0], uv[1]);
        b.colors.push(col[0], col[1], col[2], col[3] ?? 1);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i00 = base + r * cols + c;
        const i10 = base + (r + 1) * cols + c;
        const i11 = base + (r + 1) * cols + (c + 1);
        const i01 = base + r * cols + (c + 1);
        if (!flipWinding) {
          b.indices.push(i00, i10, i11, i00, i11, i01);
          b.quads.push([i00, i10, i11, i01]);
        } else {
          b.indices.push(i00, i01, i11, i00, i11, i10);
          b.quads.push([i00, i01, i11, i10]);
        }
        this.totalQuads += 1;
        this.totalTriangles += 2;
      }
    }
  }

  // Add an oriented 3D Box made of 6 Quads
  addBox(materialId, layerId, ownerId, center, width, height, length, forwardDir = [0, 0, 1], color = [1, 1, 1, 1], recordWire = false) {
    const f = normXZ(forwardDir);
    const r = rightXZ(f);
    const u = [0, 1, 0];
    const hw = width * 0.5;
    const hh = height * 0.5;
    const hl = length * 0.5;

    const pt = (sx, sy, sz) => [
      center[0] + r[0] * sx * hw + u[0] * sy * hh + f[0] * sz * hl,
      center[1] + r[1] * sx * hw + u[1] * sy * hh + f[1] * sz * hl,
      center[2] + r[2] * sx * hw + u[2] * sy * hh + f[2] * sz * hl,
    ];

    const c000 = pt(-1, -1, -1);
    const c100 = pt(1, -1, -1);
    const c110 = pt(1, 1, -1);
    const c010 = pt(-1, 1, -1);
    const c001 = pt(-1, -1, 1);
    const c101 = pt(1, -1, 1);
    const c111 = pt(1, 1, 1);
    const c011 = pt(-1, 1, 1);

    // Top (+Y)
    this.addQuad(materialId, layerId, ownerId, c010, c011, c111, c110, [0, 0], [0, length], [width, length], [width, 0], color, recordWire);
    // Bottom (-Y)
    this.addQuad(materialId, layerId, ownerId, c000, c100, c101, c001, [0, 0], [width, 0], [width, length], [0, length], color, recordWire);
    // Front (+Z along f)
    this.addQuad(materialId, layerId, ownerId, c001, c101, c111, c011, [0, 0], [width, 0], [width, height], [0, height], color, recordWire);
    // Back (-Z along f)
    this.addQuad(materialId, layerId, ownerId, c100, c000, c010, c110, [0, 0], [width, 0], [width, height], [0, height], color, recordWire);
    // Right (+X along r)
    this.addQuad(materialId, layerId, ownerId, c101, c100, c110, c111, [0, 0], [length, 0], [length, height], [0, height], color, recordWire);
    // Left (-X along r)
    this.addQuad(materialId, layerId, ownerId, c000, c001, c011, c010, [0, 0], [length, 0], [length, height], [0, height], color, recordWire);
  }

  // Add a smooth vertical/tilted cylinder or frustum made of Quads
  addCylinder(materialId, layerId, ownerId, baseCenter, topCenter, radiusBottom, radiusTop, segments = 12, color = [1, 1, 1, 1], capTop = true) {
    const axis = sub(topCenter, baseCenter);
    const height = Math.max(1e-4, Math.hypot(axis[0], axis[1], axis[2]));
    const up = scale(axis, 1 / height);
    let tangent = Math.abs(up[1]) < 0.9 ? cross(up, [0, 1, 0]) : cross(up, [1, 0, 0]);
    tangent = norm(tangent);
    const bitangent = norm(cross(tangent, up));

    const grid = [[], []];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cs = Math.cos(theta);
      const sn = Math.sin(theta);
      const radial = [
        tangent[0] * cs + bitangent[0] * sn,
        tangent[1] * cs + bitangent[1] * sn,
        tangent[2] * cs + bitangent[2] * sn,
      ];
      grid[0].push({
        p: madd(baseCenter, radial, radiusBottom),
        n: radial,
        uv: [i / segments, 0],
        color,
      });
      grid[1].push({
        p: madd(topCenter, radial, radiusTop),
        n: radial,
        uv: [i / segments, height],
        color,
      });
    }
    this.addQuadGrid(materialId, layerId, ownerId, grid, false, false);

    if (capTop && radiusTop > 0.005) {
      const half = Math.max(2, Math.floor(segments / 4));
      for (let i = 0; i < segments; i += 2) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const a2 = ((i + 2) / segments) * Math.PI * 2;
        const p0 = topCenter;
        const p1 = madd(topCenter, add(scale(tangent, Math.cos(a0)), scale(bitangent, Math.sin(a0))), radiusTop);
        const p2 = madd(topCenter, add(scale(tangent, Math.cos(a1)), scale(bitangent, Math.sin(a1))), radiusTop);
        const p3 = madd(topCenter, add(scale(tangent, Math.cos(a2)), scale(bitangent, Math.sin(a2))), radiusTop);
        this.addQuad(materialId, layerId, ownerId, p0, p3, p2, p1, [0.5, 0.5], [1, 0.5], [0.8, 0.8], [0.5, 1], color, false);
      }
    }
  }
}

// Compute total carriageway half-width of a road
export function getRoadCarriagewayHalfWidth(road) {
  const lanes = road.lanes || 2;
  const laneWidth = road.laneWidth || 3.5;
  const median = road.medianWidth || 0;
  const shoulder = road.shoulderWidth || 0;
  const parking = road.parking ? 2.25 : 0;
  const cycle = road.cycleLane ? 1.65 : 0;
  return (lanes * laneWidth + median) * 0.5 + shoulder + parking + cycle;
}

export function getRoadTotalHalfWidth(road) {
  return getRoadCarriagewayHalfWidth(road) + (road.curbWidth ?? 0.18) + (road.sidewalkWidth ?? 3.6);
}

/**
 * Evaluate exact road cross-section profile at station `st`:
 * Returns structured lateral points across the road so both road spans and merged intersections
 * share identical cross-sectional quad strip layout!
 * M = 4 lateral strips per half-road (total 8 quad strips across asphalt carriageway).
 */
export const HALF_ROAD_STRIPS = 4; // 8 quad strips across carriageway

export function computeStationProfile(st, road, project, potholes = [], speedBumps = [], constructionZones = []) {
  const hw = getRoadCarriagewayHalfWidth(road);
  const cw = road.curbWidth ?? 0.18;
  const ch = road.curbStyle === 'flush' ? 0.015 : (road.curbHeight ?? 0.145);
  const sw = road.sidewalkWidth ?? 3.6;
  const crossfall = (road.crossfall ?? 2.0) / 100;
  const swCrossfall = (road.sidewalkCrossfall ?? 1.5) / 100;
  const crown = hw * crossfall;

  // Check if this station is on a speed bump
  let bumpLift = 0;
  for (const bump of speedBumps) {
    if (bump.roadId === road.id && bump.enabled !== false) {
      const ds = Math.abs(st.s - bump.station);
      const halfLen = (bump.length || 3.4) * 0.5;
      if (ds < halfLen) {
        const u = Math.cos((ds / halfLen) * (Math.PI * 0.5));
        bumpLift = Math.max(bumpLift, (bump.height || 0.085) * u * u);
      }
    }
  }

  // Generate 2*M + 1 carriageway points from -hw (side = -1, decreasing theta) to +hw (side = +1, increasing theta)
  const M = HALF_ROAD_STRIPS;
  const carriageway = [];
  for (let j = -M; j <= M; j++) {
    const frac = j / M; // -1 .. +1
    const lat = frac * hw;
    let yOffset = crown * (1 - Math.abs(frac)) + bumpLift * (1 - 0.15 * frac * frac);
    let vertexColor = [1, 1, 1, 1];

    // Apply physical 3D pothole depression & sub-base exposure
    const worldPtXZ = [st.p[0] + st.n[0] * lat, st.p[2] + st.n[2] * lat];
    for (const ph of potholes) {
      if (ph.enabled === false) continue;
      if (ph.roadId && ph.roadId !== road.id) continue;
      const d = Math.hypot(worldPtXZ[0] - ph.position[0], worldPtXZ[1] - ph.position[2]);
      const r = ph.radius || 1.35;
      if (d < r * 1.25) {
        const q = d / r;
        if (q < 0.85) {
          const depth = ph.depth || 0.085;
          yOffset -= depth * (1 - 0.25 * q * q);
          vertexColor = [0.42, 0.39, 0.36, 0.0]; // Alpha=0 signals exposed pothole sub-base/puddle to shader!
        } else if (q < 1.15) {
          // Raised/broken asphalt lip
          yOffset += 0.012 * Math.sin(((q - 0.85) / 0.3) * Math.PI);
          vertexColor = [0.58, 0.56, 0.54, 0.35];
        }
      }
    }

    // Apply physical 3D construction milled roadbed trench
    for (const cz of constructionZones) {
      if (cz.enabled === false || cz.roadId !== road.id) continue;
      const halfL = (cz.length || 24) * 0.5;
      const ds = Math.abs(st.s - cz.station);
      const sideMatch = cz.side === 'both' || (cz.side === 'right' && frac >= -0.05) || (cz.side === 'left' && frac <= 0.05);
      if (ds < halfL && sideMatch) {
        const edgeRamp = clamp((halfL - ds) / 1.8, 0, 1);
        const trenchDepth = (cz.depth || 0.32) * edgeRamp;
        yOffset -= trenchDepth;
        vertexColor = [0.52, 0.45, 0.36, 0.15]; // Exposed milled sub-base aggregate
      }
    }

    const pt = [
      st.p[0] + st.n[0] * lat,
      st.p[1] + yOffset,
      st.p[2] + st.n[2] * lat,
    ];
    carriageway.push({
      p: pt,
      lat,
      frac,
      color: vertexColor,
    });
  }

  // Curb & Sidewalk profile helper for side = -1 or +1
  const buildSideProfile = (side) => {
    const edgePt = carriageway[side === -1 ? 0 : 2 * M].p;
    const baseY = edgePt[1];
    // 15mm chamfered stone curb:
    // c0: gutter toe (at edgePt)
    // c1: curb face below chamfer (lat: hw + 0.02, y: baseY + ch - 0.015)
    // c2: curb top after 15mm chamfer (lat: hw + 0.038, y: baseY + ch)
    // c3: curb outer back (lat: hw + cw, y: baseY + ch)
    const ptAt = (latDist, yAbs) => [
      st.p[0] + st.n[0] * side * latDist,
      yAbs,
      st.p[2] + st.n[2] * side * latDist,
    ];
    const c0 = [...edgePt];
    const c1 = ptAt(hw + 0.018, baseY + Math.max(0.005, ch - 0.015));
    const c2 = ptAt(hw + 0.036, baseY + ch);
    const c3 = ptAt(hw + cw, baseY + ch);

    // Sidewalk: 3 lateral points (inner at c3, mid, outer at hw + cw + sw)
    const swRise = sw * swCrossfall;
    const swMid = ptAt(hw + cw + sw * 0.5, baseY + ch + swRise * 0.5);
    const swOut = ptAt(hw + cw + sw, baseY + ch + swRise);
    const skirtBot = ptAt(hw + cw + sw + 0.12, st.p[1] - (road.isBridge ? 0.32 : 0.48));

    return {
      curb: [c0, c1, c2, c3],
      sidewalk: [c3, swMid, swOut],
      skirt: [swOut, skirtBot],
    };
  };

  return {
    station: st,
    hw,
    cw,
    ch,
    sw,
    crown,
    carriageway, // length 2*M + 1 (index 0 is side=-1, index M is center, index 2*M is side=+1)
    minusSide: buildSideProfile(-1),
    plusSide: buildSideProfile(1),
  };
}

/**
 * Compute smooth corner fillet curve between Arm A (+theta edge) and Arm B (-theta edge).
 * Works cleanly from tight acute angles (18 deg Y-merges) to obtuse bends (175 deg)!
 */
export function buildSectorCornerCurve(nodePos, armA, armB, requestedRadius, numHalfSegments = HALF_ROAD_STRIPS) {
  const numSegments = numHalfSegments * 2;
  const pA = armA.plusEdge;   // +theta road edge of armA at trim mouth
  const pB = armB.minusEdge;  // -theta road edge of armB at trim mouth
  const dA = armA.dir;        // outgoing unit vector of armA
  const dB = armB.dir;        // outgoing unit vector of armB

  // Inward directions along the arm edges toward the junction apex
  const inA = scale(dA, -1);
  const inB = scale(dB, -1);

  // Use a smooth cubic Bezier fillet whose control points follow the exact inward tangents
  // and clamp handle lengths so tight acute angles never loop or self-intersect!
  const chord = distXZ(pA, pB);
  const cosAngle = clamp(dotXZ(dA, dB), -0.999, 0.999);
  const sectorAngle = wrapAnglePositive(armB.angle - armA.angle);

  // Project intersection of the two edge rays to place the fillet tangent handles accurately
  const det = crossXZ(inA, inB);
  let handleA = chord * 0.36;
  let handleB = chord * 0.36;

  if (Math.abs(det) > 1e-4 && sectorAngle < Math.PI * 0.64) {
    const delta = sub(pB, pA);
    const tA = crossXZ(delta, inB) / det;
    const tB = crossXZ(delta, inA) / det;
    if (tA > 0.1 && tB > 0.1) {
      const halfTheta = Math.acos(clamp(-dotXZ(inA, inB), -1, 1)) * 0.5;
      const kappa = (4 / 3) * Math.tan(Math.max(0.08, (Math.PI - 2 * halfTheta) * 0.25));
      handleA = clamp(tA * Math.min(0.68, Math.max(0.45, kappa)), 0.4, Math.min(tA * 0.72, chord * 0.46));
      handleB = clamp(tB * Math.min(0.68, Math.max(0.45, kappa)), 0.4, Math.min(tB * 0.72, chord * 0.46));
    }
  } else {
    // Smooth symmetric G1 handle for wide/obtuse Y-junction outer bends
    const smoothLen = clamp(chord * 0.35, 1.0, Math.max(2.5, requestedRadius * 0.85));
    handleA = smoothLen;
    handleB = smoothLen;
  }

  const c0 = [...pA];
  const c1 = madd(pA, inA, handleA);
  const c2 = madd(pB, inB, handleB);
  const c3 = [...pB];

  const points = [];
  const tangents = [];
  const outwardNormals = []; // Pointing AWAY from asphalt into curb/sidewalk!

  for (let k = 0; k <= numSegments; k++) {
    const t = k / numSegments;
    const pt = evalCubic(c0, c1, c2, c3, t);
    pt[1] = lerp(pA[1], pB[1], t);
    const deriv = normXZ(evalCubicDeriv(c0, c1, c2, c3, t));
    const outN = scale(rightXZ(deriv), -1);
    points.push(pt);
    tangents.push(deriv);
    outwardNormals.push(outN);
  }

  // Enforce exact endpoint normals matching Arm A (+nA) and Arm B (-nB)
  outwardNormals[0] = [...armA.n];
  outwardNormals[numSegments] = scale(armB.n, -1);

  return {
    points,
    tangents,
    outwardNormals,
    sectorAngle,
    midPoint: points[numHalfSegments],
  };
}

/**
 * Evaluate a Transfinite Bilinear Coons Quad Patch on an (M+1) x (M+1) grid:
 * - cU0[v] (u = 0, v = 0..M): Mouth half-profile from mouth center (v=0) to mouth edge (v=M)
 * - cU1[v] (u = M, v = 0..M): Radial bisector seam from junction hub O (v=0) to corner midpoint C (v=M)
 * - cV0[u] (v = 0, u = 0..M): Centerline seam from mouth center (u=0) to junction hub O (u=M)
 * - cV1[u] (v = M, u = 0..M): Corner fillet half-curve from mouth edge (u=0) to corner midpoint C (u=M)
 */
export function evaluateCoonsQuadPatch(cU0, cU1, cV0, cV1, M) {
  const p00 = cU0[0];
  const p01 = cU0[M];
  const p10 = cU1[0];
  const p11 = cU1[M];

  const grid = [];
  for (let iu = 0; iu <= M; iu++) {
    const u = iu / M;
    const hu = u * u * (3 - 2 * u); // Smooth Hermite blend
    const row = [];
    for (let iv = 0; iv <= M; iv++) {
      const v = iv / M;
      const hv = v * v * (3 - 2 * v);

      const p = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const loftU = (1 - hu) * cU0[iv][k] + hu * cU1[iv][k];
        const loftV = (1 - hv) * cV0[iu][k] + hv * cV1[iu][k];
        const bilinear =
          (1 - hu) * (1 - hv) * p00[k] +
          (1 - hu) * hv * p01[k] +
          hu * (1 - hv) * p10[k] +
          hu * hv * p11[k];
        p[k] = loftU + loftV - bilinear;
      }
      row.push({
        p,
        n: [0, 1, 0],
        uv: [u * 2.5, v * 2.5],
        color: [1, 1, 1, 1],
      });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Compute per-arm trim distances around a node so that even tight-angle Y-merges
 * and multi-way intersections have clean, non-overlapping mouths.
 */
export function computeNodeArmTrims(node, connectedRoads, alignmentsMap) {
  if (connectedRoads.length < 2) {
    return new Map(connectedRoads.map((r) => [r.id, 0]));
  }

  const armInfos = connectedRoads.map((road) => {
    const align = alignmentsMap.get(road.id);
    const isStart = road.start === node.id;
    const endSt = isStart ? align.stations[0] : align.stations[align.stations.length - 1];
    const dir = isStart ? [...endSt.d] : scale(endSt.d, -1);
    const n = rightXZ(dir);
    return {
      road,
      align,
      isStart,
      dir,
      n,
      angle: angleXZ(dir),
      hw: getRoadCarriagewayHalfWidth(road),
      totalHw: getRoadTotalHalfWidth(road),
    };
  });

  armInfos.sort((a, b) => a.angle - b.angle);

  const trims = new Map(armInfos.map((a) => [a.road.id, 0]));
  const N = armInfos.length;
  const requestedR = node.radius ?? 9.0;

  if (N === 2) {
    const a = armInfos[0];
    const b = armInfos[1];
    const turnAngle = Math.abs(Math.PI - wrapAnglePositive(b.angle - a.angle));
    const widthDiff = Math.abs(a.hw - b.hw);
    if (turnAngle < 0.08 && widthDiff < 0.05) {
      // Collinear equal-width continuation needs minimal seam trim
      trims.set(a.road.id, 0.0);
      trims.set(b.road.id, 0.0);
      return trims;
    }
  }

  for (let i = 0; i < N; i++) {
    const a = armInfos[i];
    const b = armInfos[(i + 1) % N];
    const deltaAngle = wrapAnglePositive(b.angle - a.angle);
    const clampedAngle = clamp(deltaAngle, 0.32, Math.PI * 1.65); // Safe down to ~18 degrees
    const sinA = Math.max(0.28, Math.sin(clampedAngle));
    const cosA = Math.cos(clampedAngle);
    const halfTan = Math.max(0.18, Math.tan(clampedAngle * 0.5));

    // Exact sideline intersection apex distances along arm A and arm B
    const apexA = Math.max(a.hw * 0.6, (b.hw + a.hw * Math.max(-0.5, cosA)) / sinA);
    const apexB = Math.max(b.hw * 0.6, (a.hw + b.hw * Math.max(-0.5, cosA)) / sinA);

    // Clamp corner radius so acute angles get a sleek splitter nose without consuming the whole road
    const maxBudgetA = a.align.length * 0.42;
    const maxBudgetB = b.align.length * 0.42;
    const rEff = clamp(
      requestedR * Math.min(1, halfTan * 1.15),
      1.8,
      Math.min(requestedR, Math.max(2.0, Math.min(maxBudgetA - apexA, maxBudgetB - apexB) * halfTan))
    );

    const trimA = clamp(apexA + rEff / halfTan + 0.6, a.hw + 1.5, maxBudgetA);
    const trimB = clamp(apexB + rEff / halfTan + 0.6, b.hw + 1.5, maxBudgetB);

    trims.set(a.road.id, Math.max(trims.get(a.road.id) || 0, trimA));
    trims.set(b.road.id, Math.max(trims.get(b.road.id) || 0, trimB));
  }

  return trims;
}

/**
 * Build a 100% Quad-Dominant Merged Intersection (Y, T, +, 5-way, or Roundabout)
 * that welds directly to the approaching road cross-sections with zero overlapping geometry.
 */
export function buildMergedIntersectionQuadMesh(node, armSpans, builder, project) {
  if (!armSpans || armSpans.length < 2) return null;

  const M = HALF_ROAD_STRIPS;
  const arms = armSpans.map((span) => {
    const isStart = span.road.start === node.id;
    const profile = isStart ? span.profiles[0] : span.profiles[span.profiles.length - 1];
    const st = profile.station;
    const dir = isStart ? [...st.d] : scale(st.d, -1);
    const n = rightXZ(dir);

    // Orient carriageway points so index 0 is ALWAYS the -theta side (-n * hw)
    // and index 2*M is ALWAYS the +theta side (+n * hw) when looking outward from the node!
    const rawPts = profile.carriageway.map((c) => [...c.p]);
    const orderedPts = isStart ? rawPts : [...rawPts].reverse();

    const minusSub = isStart ? profile.minusSide : profile.plusSide;
    const plusSub = isStart ? profile.plusSide : profile.minusSide;

    return {
      road: span.road,
      span,
      isStart,
      profile,
      station: st,
      dir,
      n,
      angle: angleXZ(dir),
      hw: profile.hw,
      cw: profile.cw,
      ch: profile.ch,
      sw: profile.sw,
      crown: profile.crown,
      mouthPts: orderedPts, // 0 .. 2*M from -theta to +theta
      minusEdge: orderedPts[0],
      centerPt: orderedPts[M],
      plusEdge: orderedPts[2 * M],
      minusSide: minusSub,
      plusSide: plusSub,
    };
  });

  arms.sort((a, b) => a.angle - b.angle);
  const N = arms.length;

  // Compute central hub point O at weighted intersection centroid with smooth crown height
  let hubX = 0, hubY = 0, hubZ = 0;
  for (const arm of arms) {
    hubX += arm.centerPt[0];
    hubY += arm.centerPt[1];
    hubZ += arm.centerPt[2];
  }
  const avgCenter = [hubX / N, hubY / N, hubZ / N];
  const hubO = [
    lerp(node.position[0], avgCenter[0], 0.65),
    avgCenter[1] + 0.015,
    lerp(node.position[2], avgCenter[2], 0.65),
  ];

  // Build sector corner curves between arm[i].plusEdge and arm[(i+1)%N].minusEdge
  const corners = [];
  for (let i = 0; i < N; i++) {
    const a = arms[i];
    const b = arms[(i + 1) % N];
    corners.push(buildSectorCornerCurve(hubO, a, b, node.radius ?? 9.0, M));
  }

  // Build shared centerline seams S_arm[i] (u = 0..M from arm.centerPt to hubO)
  const armSeams = arms.map((arm) => {
    const p0 = arm.centerPt;
    const p3 = hubO;
    const dLen = distXZ(p0, p3);
    const p1 = madd(p0, arm.dir, -dLen * 0.36);
    p1[1] = lerp(p0[1], p3[1], 0.35);
    const p2 = lerp3(p1, p3, 0.65);
    const pts = [];
    for (let k = 0; k <= M; k++) {
      pts.push(evalCubic(p0, p1, p2, p3, k / M));
    }
    return pts;
  });

  // Build shared corner bisector seams S_corner[i] (v = 0..M from hubO to corner[i].midPoint)
  const cornerSeams = corners.map((corner) => {
    const p0 = hubO;
    const p3 = corner.midPoint;
    const pts = [];
    for (let k = 0; k <= M; k++) {
      const t = k / M;
      const pt = lerp3(p0, p3, t);
      // Smooth parabolic crown drop from center hub O to corner curb edge
      pt[1] = lerp(p0[1], p3[1], t * t);
      pts.push(pt);
    }
    return pts;
  });

  const dominantRoad = arms.reduce((best, a) => (a.road.lanes > best.road.lanes ? a : best), arms[0]).road;
  const asphaltMat = dominantRoad.surfaceMaterial || 'asphalt-wearing';

  // For each arm i, build TWO structured M x M Coons Quad Grids:
  // 1) Minus-theta half-sector (connecting corner[i-1] second half -> arm[i] minus half -> armSeam[i] -> cornerSeam[i-1])
  // 2) Plus-theta half-sector (connecting arm[i] plus half -> corner[i] first half -> cornerSeam[i] -> armSeam[i])
  for (let i = 0; i < N; i++) {
    const prevIdx = (i - 1 + N) % N;
    const arm = arms[i];

    // Plus-theta half-sector:
    // cU0 (u=0, v=0..M): arm.mouthPts[M .. 2M] (from centerPt to plusEdge)
    // cU1 (u=M, v=0..M): cornerSeams[i][0 .. M] (from hubO to corner[i].midPoint)
    // cV0 (v=0, u=0..M): armSeams[i][0 .. M] (from centerPt to hubO)
    // cV1 (v=M, u=0..M): corners[i].points[0 .. M] (from plusEdge to corner[i].midPoint)
    const plusCU0 = arm.mouthPts.slice(M, 2 * M + 1);
    const plusCU1 = cornerSeams[i];
    const plusCV0 = armSeams[i];
    const plusCV1 = corners[i].points.slice(0, M + 1);
    const plusGrid = evaluateCoonsQuadPatch(plusCU0, plusCU1, plusCV0, plusCV1, M);
    builder.addQuadGrid(asphaltMat, 'intersections', node.id, plusGrid, false, true);

    // Minus-theta half-sector:
    // cU0 (u=0, v=0..M): arm.mouthPts[M .. 0] (from centerPt to minusEdge)
    // cU1 (u=M, v=0..M): cornerSeams[prevIdx][0 .. M] (from hubO to corner[prevIdx].midPoint)
    // cV0 (v=0, u=0..M): armSeams[i][0 .. M] (from centerPt to hubO)
    // cV1 (v=M, u=0..M): corners[prevIdx].points[2M .. M] (from minusEdge to corner[prevIdx].midPoint)
    const minusCU0 = [];
    for (let k = M; k >= 0; k--) minusCU0.push(arm.mouthPts[k]);
    const minusCU1 = cornerSeams[prevIdx];
    const minusCV0 = armSeams[i];
    const minusCV1 = [];
    for (let k = 2 * M; k >= M; k--) minusCV1.push(corners[prevIdx].points[k]);
    const minusGrid = evaluateCoonsQuadPatch(minusCU0, minusCU1, minusCV0, minusCV1, M);
    builder.addQuadGrid(asphaltMat, 'intersections', node.id, minusGrid, true, true);
  }

  // Sweep Continuous Quad Curbs, Sidewalks, Tactile Ramps, and Splitters around each sector corner!
  for (let i = 0; i < N; i++) {
    const a = arms[i];
    const b = arms[(i + 1) % N];
    const corner = corners[i];
    const K = corner.points.length;

    const curbGrid = [[], [], [], []]; // 3 quad strips for chamfered granite curb
    const walkGrid = [[], [], []];     // 2 quad strips for sidewalk paving
    const skirtGrid = [[], []];        // 1 quad strip for outer retaining wall/skirt

    let sAccum = 0;
    for (let k = 0; k < K; k++) {
      if (k > 0) sAccum += distXZ(corner.points[k], corner.points[k - 1]);
      const frac = k / (K - 1);
      const p = corner.points[k];
      const outN = corner.outwardNormals[k];

      // Taper curb height down at pedestrian crosswalk ramps near k = 0.2 and k = 0.8
      let rampFactor = 1.0;
      if (node.crossings !== false) {
        const dRampA = Math.abs(frac - 0.16);
        const dRampB = Math.abs(frac - 0.84);
        const dRamp = Math.min(dRampA, dRampB);
        if (dRamp < 0.11) {
          rampFactor = clamp(dRamp / 0.11, 0.12, 1.0);
        }
      }

      const ch = lerp(a.ch, b.ch, frac) * rampFactor;
      const cw = lerp(a.cw, b.cw, frac);
      // Taper sidewalk width inside acute Y-merge crotches so the two inner sidewalks form a clean bullnose splitter without overlapping
      const acutePinch =
        corner.sectorAngle < Math.PI * 0.46
          ? clamp(Math.pow(Math.abs(frac - 0.5) * 2.0, 1.45), 0.06, 1.0)
          : 1.0;
      const sw = lerp(a.sw, b.sw, frac) * acutePinch;
      const swRise = sw * 0.015;

      const c0 = [...p];
      const c1 = [p[0] + outN[0] * 0.018, p[1] + Math.max(0.004, ch - 0.014), p[2] + outN[2] * 0.018];
      const c2 = [p[0] + outN[0] * 0.036, p[1] + ch, p[2] + outN[2] * 0.036];
      const c3 = [p[0] + outN[0] * cw, p[1] + ch, p[2] + outN[2] * cw];

      // Exact endpoint welding to arm A and arm B curb profiles
      if (k === 0) {
        c0[0] = a.plusSide.curb[0][0]; c0[1] = a.plusSide.curb[0][1]; c0[2] = a.plusSide.curb[0][2];
        c1[0] = a.plusSide.curb[1][0]; c1[1] = a.plusSide.curb[1][1]; c1[2] = a.plusSide.curb[1][2];
        c2[0] = a.plusSide.curb[2][0]; c2[1] = a.plusSide.curb[2][1]; c2[2] = a.plusSide.curb[2][2];
        c3[0] = a.plusSide.curb[3][0]; c3[1] = a.plusSide.curb[3][1]; c3[2] = a.plusSide.curb[3][2];
      } else if (k === K - 1) {
        c0[0] = b.minusSide.curb[0][0]; c0[1] = b.minusSide.curb[0][1]; c0[2] = b.minusSide.curb[0][2];
        c1[0] = b.minusSide.curb[1][0]; c1[1] = b.minusSide.curb[1][1]; c1[2] = b.minusSide.curb[1][2];
        c2[0] = b.minusSide.curb[2][0]; c2[1] = b.minusSide.curb[2][1]; c2[2] = b.minusSide.curb[2][2];
        c3[0] = b.minusSide.curb[3][0]; c3[1] = b.minusSide.curb[3][1]; c3[2] = b.minusSide.curb[3][2];
      }

      curbGrid[0].push({ p: c0, uv: [sAccum * 0.8, 0] });
      curbGrid[1].push({ p: c1, uv: [sAccum * 0.8, 0.35] });
      curbGrid[2].push({ p: c2, uv: [sAccum * 0.8, 0.55] });
      curbGrid[3].push({ p: c3, uv: [sAccum * 0.8, 1.0] });

      const swMid = [p[0] + outN[0] * (cw + sw * 0.5), p[1] + ch + swRise * 0.5, p[2] + outN[2] * (cw + sw * 0.5)];
      const swOut = [p[0] + outN[0] * (cw + sw), p[1] + ch + swRise, p[2] + outN[2] * (cw + sw)];
      if (k === 0) {
        swMid[0] = a.plusSide.sidewalk[1][0]; swMid[1] = a.plusSide.sidewalk[1][1]; swMid[2] = a.plusSide.sidewalk[1][2];
        swOut[0] = a.plusSide.sidewalk[2][0]; swOut[1] = a.plusSide.sidewalk[2][1]; swOut[2] = a.plusSide.sidewalk[2][2];
      } else if (k === K - 1) {
        swMid[0] = b.minusSide.sidewalk[1][0]; swMid[1] = b.minusSide.sidewalk[1][1]; swMid[2] = b.minusSide.sidewalk[1][2];
        swOut[0] = b.minusSide.sidewalk[2][0]; swOut[1] = b.minusSide.sidewalk[2][1]; swOut[2] = b.minusSide.sidewalk[2][2];
      }

      walkGrid[0].push({ p: c3, uv: [sAccum * 0.45, 0] });
      walkGrid[1].push({ p: swMid, uv: [sAccum * 0.45, sw * 0.25] });
      walkGrid[2].push({ p: swOut, uv: [sAccum * 0.45, sw * 0.5] });

      const skirtBot = [swOut[0], p[1] - 0.48, swOut[2]];
      skirtGrid[0].push({ p: swOut, uv: [sAccum * 0.3, 0] });
      skirtGrid[1].push({ p: skirtBot, uv: [sAccum * 0.3, 0.5] });

      // Tactile blister paving pad at corner ramp
      if (node.crossings !== false && (k === 1 || k === K - 3)) {
        const pNext = corner.points[k + 1];
        const nNext = corner.outwardNormals[k + 1];
        const t0 = [c3[0] + outN[0] * 0.08, c3[1] + 0.008, c3[2] + outN[2] * 0.08];
        const t1 = [pNext[0] + nNext[0] * (cw + 0.08), pNext[1] + ch + 0.008, pNext[2] + nNext[2] * (cw + 0.08)];
        const t2 = [pNext[0] + nNext[0] * (cw + 0.92), pNext[1] + ch + 0.018, pNext[2] + nNext[2] * (cw + 0.92)];
        const t3 = [c3[0] + outN[0] * 0.92, c3[1] + 0.018, c3[2] + outN[2] * 0.92];
        builder.addQuad('tactile-paving', 'paving', node.id, t0, t1, t2, t3, [0, 0], [2, 0], [2, 1], [0, 1]);
      }
    }

    builder.addQuadGrid('curb-granite', 'curbs', node.id, curbGrid, true, true);
    const pavingMat = `paving-${a.road.pavingPattern || 'herringbone'}`;
    builder.addQuadGrid(pavingMat, 'paving', node.id, walkGrid, true, true);
    builder.addQuadGrid('concrete-structure', 'structures', node.id, skirtGrid, true, false);

    // If sector angle is acute (< 58 deg, e.g. Y-merge or highway slip ramp), add a painted gore chevron + bullnose splitter!
    if (corner.sectorAngle < Math.PI * 0.33 && corner.sectorAngle > 0.12) {
      const bisector = normXZ(add(a.dir, b.dir));
      const perp = rightXZ(bisector);
      const nose = corner.midPoint;
      const goreLen = clamp(distXZ(hubO, nose) * 0.55, 3.5, 14.0);
      const goreTip = madd(nose, bisector, -goreLen);
      goreTip[1] = lerp(hubO[1], nose[1], 0.35) + 0.018;
      const goreBase = madd(nose, bisector, -1.1);
      goreBase[1] = nose[1] + 0.018;
      const halfW = clamp(goreLen * Math.tan(corner.sectorAngle * 0.38), 0.55, 2.2);

      // Gore border & chevron stripes (all built as clean Quads!)
      const stripes = Math.max(3, Math.floor(goreLen / 1.8));
      for (let s = 0; s < stripes; s++) {
        const u0 = (s + 0.15) / stripes;
        const u1 = (s + 0.58) / stripes;
        const cA = lerp3(goreTip, goreBase, u0);
        const cB = lerp3(goreTip, goreBase, u1);
        const wA = halfW * u0;
        const wB = halfW * u1;
        // Left chevron wing
        builder.addQuad(
          'marking-white',
          'markings',
          node.id,
          cA,
          cB,
          madd(madd(cB, perp, -wB), bisector, -0.45 * u1),
          madd(madd(cA, perp, -wA), bisector, -0.45 * u0),
          [0, 0], [1, 0], [1, 1], [0, 1],
          [1, 1, 1, 1],
          false
        );
        // Right chevron wing
        builder.addQuad(
          'marking-white',
          'markings',
          node.id,
          cA,
          madd(madd(cA, perp, wA), bisector, -0.45 * u0),
          madd(madd(cB, perp, wB), bisector, -0.45 * u1),
          cB,
          [0, 0], [1, 0], [1, 1], [0, 1],
          [1, 1, 1, 1],
          false
        );
      }
    }
  }

  // Optional: Curved Quad Turning Guideline Dashes across the Merged Intersection Hub
  if (node.turningGuides !== false && !node.roundabout && N >= 3) {
    for (let i = 0; i < N; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % N];
      const p0 = lerp3(a.centerPt, a.plusEdge, 0.36);
      const p3 = lerp3(b.centerPt, b.minusEdge, 0.36);
      const chord = distXZ(p0, p3);
      const p1 = madd(p0, a.dir, -chord * 0.34);
      const p2 = madd(p3, b.dir, -chord * 0.34);
      const dashSteps = 9;
      for (let d = 1; d < dashSteps - 1; d += 2) {
        const t0 = d / dashSteps;
        const t1 = (d + 0.62) / dashSteps;
        const c0 = evalCubic(p0, p1, p2, p3, t0);
        const c1 = evalCubic(p0, p1, p2, p3, t1);
        c0[1] = lerp(p0[1], p3[1], t0) + 0.016;
        c1[1] = lerp(p0[1], p3[1], t1) + 0.016;
        const tan = normXZ(sub(c1, c0));
        const nL = rightXZ(tan);
        const hwDash = 0.065;
        builder.addQuad(
          'marking-white',
          'markings',
          node.id,
          madd(c0, nL, -hwDash),
          madd(c0, nL, hwDash),
          madd(c1, nL, hwDash),
          madd(c1, nL, -hwDash),
          [0, 0], [1, 0], [1, 1], [0, 1],
          [0.92, 0.94, 0.96, 1],
          false
        );
      }
    }
  }

  // Optional: 3D Sculpted Roundabout Central Island, Mountable Truck Apron & Circulatory Ring
  if (node.roundabout && N >= 3) {
    const rOuter = clamp((node.radius || 10.0) * 0.48, 3.4, 8.2);
    const rApron = rOuter * 0.68;
    const rCore = rOuter * 0.16;
    const segs = 24;
    const baseY = hubO[1];

    const ringPt = (r, yOff, idx) => {
      const ang = (idx / segs) * Math.PI * 2;
      return {
        p: [hubO[0] + Math.cos(ang) * r, baseY + yOff, hubO[2] + Math.sin(ang) * r],
        uv: [(idx / segs) * 6, r * 0.4],
      };
    };

    const curbOuterRing = [];
    const curbTopRing = [];
    const apronInnerRing = [];
    const coreRing = [];
    for (let s = 0; s <= segs; s++) {
      curbOuterRing.push(ringPt(rOuter, 0.01, s));
      curbTopRing.push(ringPt(rOuter - 0.16, 0.14, s));
      apronInnerRing.push(ringPt(rApron, 0.24, s));
      coreRing.push(ringPt(rCore, 0.30, s));
    }
    builder.addQuadGrid('curb-granite', 'curbs', node.id, [curbOuterRing, curbTopRing], true, true);
    builder.addQuadGrid('paving-cobble-fan', 'paving', node.id, [curbTopRing, apronInnerRing], true, true);
    builder.addQuadGrid('paving-munich-hex', 'paving', node.id, [apronInnerRing, coreRing], true, true);

    // Circulatory yield line dashes around the roundabout island
    const rYield = rOuter + 2.6;
    for (let s = 0; s < segs; s += 2) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1.1) / segs) * Math.PI * 2;
      const pA0 = [hubO[0] + Math.cos(a0) * (rYield - 0.08), baseY + 0.016, hubO[2] + Math.sin(a0) * (rYield - 0.08)];
      const pA1 = [hubO[0] + Math.cos(a0) * (rYield + 0.08), baseY + 0.016, hubO[2] + Math.sin(a0) * (rYield + 0.08)];
      const pB1 = [hubO[0] + Math.cos(a1) * (rYield + 0.08), baseY + 0.016, hubO[2] + Math.sin(a1) * (rYield + 0.08)];
      const pB0 = [hubO[0] + Math.cos(a1) * (rYield - 0.08), baseY + 0.016, hubO[2] + Math.sin(a1) * (rYield - 0.08)];
      builder.addQuad('marking-white', 'markings', node.id, pA0, pA1, pB1, pB0, [0, 0], [1, 0], [1, 1], [0, 1], [1, 1, 1, 1], false);
    }
  }

  // Register pickable sphere for this merged intersection so clicking it in 3D selects & shows the Gizmo
  const maxArmHw = Math.max(...arms.map((a) => a.hw));
  builder.pickables.push({
    kind: 'node',
    id: node.id,
    name: node.name,
    center: [...hubO],
    radius: Math.max(8.5, maxArmHw * 1.45),
  });

  return {
    node,
    hub: hubO,
    arms,
    corners,
    type: N === 2 ? 'Curve Join' : N === 3 ? 'Y / T Merged Junction' : N === 4 ? '+ 4-Way Merged Junction' : `${N}-Way Star Junction`,
  };
}

/**
 * Build a complete Road Span as a structured Quad Grid (Carriageway, Curbs, Sidewalks, Skirt)
 */
export function buildRoadSpanQuadMesh(road, profiles, builder, project) {
  if (!profiles || profiles.length < 2) return;
  const K = profiles.length;
  const M = HALF_ROAD_STRIPS;
  const asphaltMat = road.surfaceMaterial || 'asphalt-wearing';
  const pavingMat = `paving-${road.pavingPattern || 'herringbone'}`;

  // 1. Carriageway Quad Grid: K rows x (2*M + 1) columns
  const roadGrid = [];
  for (let k = 0; k < K; k++) {
    const prof = profiles[k];
    const s = prof.station.s;
    const row = [];
    for (let j = 0; j <= 2 * M; j++) {
      const cwPt = prof.carriageway[j];
      row.push({
        p: cwPt.p,
        uv: [(cwPt.frac + 1) * prof.hw * 0.25, s * 0.2],
        color: cwPt.color,
      });
    }
    roadGrid.push(row);
  }
  builder.addQuadGrid(asphaltMat, 'roads', road.id, roadGrid, false, true);

  // 2. Left (-1) and Right (+1) Curbs, Sidewalks & Skirts
  for (const side of [-1, 1]) {
    const curbGrid = [];
    const walkGrid = [];
    const skirtGrid = [];
    const flip = side === 1;

    for (let k = 0; k < K; k++) {
      const prof = profiles[k];
      const s = prof.station.s;
      const sideProf = side === -1 ? prof.minusSide : prof.plusSide;

      curbGrid.push([
        { p: sideProf.curb[0], uv: [0, s * 0.5] },
        { p: sideProf.curb[1], uv: [0.35, s * 0.5] },
        { p: sideProf.curb[2], uv: [0.55, s * 0.5] },
        { p: sideProf.curb[3], uv: [1.0, s * 0.5] },
      ]);

      walkGrid.push([
        { p: sideProf.sidewalk[0], uv: [0, s * 0.35] },
        { p: sideProf.sidewalk[1], uv: [prof.sw * 0.2, s * 0.35] },
        { p: sideProf.sidewalk[2], uv: [prof.sw * 0.4, s * 0.35] },
      ]);

      skirtGrid.push([
        { p: sideProf.skirt[0], uv: [0, s * 0.25] },
        { p: sideProf.skirt[1], uv: [1, s * 0.25] },
      ]);
    }

    builder.addQuadGrid('curb-granite', 'curbs', road.id, curbGrid, flip, true);
    if ((road.sidewalkWidth ?? 3.6) > 0.1) {
      builder.addQuadGrid(pavingMat, 'paving', road.id, walkGrid, flip, true);
    }
    builder.addQuadGrid('concrete-structure', 'structures', road.id, skirtGrid, flip, false);
  }

  // Register pickable samples along the road spline for 3D clicking
  const midProf = profiles[Math.floor(K / 2)];
  builder.pickables.push({
    kind: 'road',
    id: road.id,
    name: road.name,
    center: [...midProf.station.p],
    radius: Math.max(7.0, midProf.hw * 1.25),
    samples: profiles.filter((_, i) => i % 4 === 0).map((p) => p.station.p),
  });
}
