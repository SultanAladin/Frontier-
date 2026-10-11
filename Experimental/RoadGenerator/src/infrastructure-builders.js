// Frontier Road Generator Studio — High-Fidelity Real-Life Road Infrastructure & Furniture Builders

import {
  add,
  sub,
  scale,
  madd,
  lerp,
  lerp3,
  clamp,
  norm,
  normXZ,
  rightXZ,
  distXZ,
  sampleRoadAlignment,
  interpolateStationAtS,
} from './math-splines.js';
import { getRoadCarriagewayHalfWidth, getRoadTotalHalfWidth } from './quad-topology.js';

// Helper to get a point on the road surface at station `st`, lateral offset `lat`, and vertical lift `dy`
export function surfacePointAt(st, road, lat, dy = 0.016) {
  const hw = getRoadCarriagewayHalfWidth(road);
  const crossfall = (road.crossfall ?? 2.0) / 100;
  const crown = hw * crossfall;
  const frac = clamp(Math.abs(lat) / Math.max(0.1, hw), 0, 1);
  const yCrown = crown * (1 - frac);
  return [
    st.p[0] + st.n[0] * lat,
    st.p[1] + yCrown + dy,
    st.p[2] + st.n[2] * lat,
  ];
}

/**
 * 1. Accurate Road Markings, Crosswalks, Turn Arrows, Bus/Cycle Lanes & Roadside Parking Bays
 */
export function buildRoadMarkingsQuads(road, alignment, trimStart, trimEnd, profiles, builder, project) {
  if (road.markings === false) return { parkingBays: [] };
  const sStart = trimStart + 0.6;
  const sEnd = alignment.length - trimEnd - 0.6;
  if (sEnd - sStart < 4.0) return { parkingBays: [] };

  const lanes = road.lanes || 2;
  const laneW = road.laneWidth || 3.5;
  const medianW = road.medianWidth || 0;
  const travelHalfW = (lanes * laneW + medianW) * 0.5;
  const hw = getRoadCarriagewayHalfWidth(road);

  const addRibbon = (s0, s1, latCenter, width, matId = 'marking-white', dy = 0.018) => {
    const steps = Math.max(1, Math.ceil((s1 - s0) / 2.2));
    const grid = [];
    for (let i = 0; i <= steps; i++) {
      const s = lerp(s0, s1, i / steps);
      const st = interpolateStationAtS(alignment, s);
      const pL = surfacePointAt(st, road, latCenter - width * 0.5, dy);
      const pR = surfacePointAt(st, road, latCenter + width * 0.5, dy);
      grid.push([
        { p: pL, uv: [0, (s - s0) * 0.5] },
        { p: pR, uv: [1, (s - s0) * 0.5] },
      ]);
    }
    builder.addQuadGrid(matId, 'markings', road.id, grid, false, false);
  };

  // Crosswalk setback at start and end junctions
  const startNode = project.nodes.find((n) => n.id === road.start);
  const endNode = project.nodes.find((n) => n.id === road.end);
  const hasStartCrosswalk = startNode && startNode.crossings !== false && road.roadClass !== 'highway';
  const hasEndCrosswalk = endNode && endNode.crossings !== false && road.roadClass !== 'highway';

  const markFrom = sStart + (hasStartCrosswalk ? 5.2 : 0.4);
  const markTo = sEnd - (hasEndCrosswalk ? 5.2 : 0.4);

  if (markTo > markFrom + 2.0) {
    // Centerline / Median lines
    if (!road.oneWay) {
      if (medianW >= 0.8) {
        // Raised Concrete Median Island with chamfered curbs
        const medSteps = Math.max(4, Math.ceil((markTo - markFrom) / 2.5));
        const medGrid = [];
        const halfM = medianW * 0.5 - 0.12;
        for (let i = 0; i <= medSteps; i++) {
          const s = lerp(markFrom, markTo, i / medSteps);
          const st = interpolateStationAtS(alignment, s);
          const p0 = surfacePointAt(st, road, -halfM, 0.01);
          const p1 = surfacePointAt(st, road, -halfM + 0.06, 0.15);
          const p2 = surfacePointAt(st, road, halfM - 0.06, 0.15);
          const p3 = surfacePointAt(st, road, halfM, 0.01);
          medGrid.push([
            { p: p0, uv: [0, s * 0.3] },
            { p: p1, uv: [0.25, s * 0.3] },
            { p: p2, uv: [0.75, s * 0.3] },
            { p: p3, uv: [1.0, s * 0.3] },
          ]);
        }
        builder.addQuadGrid('curb-granite', 'curbs', road.id, medGrid, false, true);
        addRibbon(markFrom, markTo, -(medianW * 0.5 + 0.12), 0.14, 'marking-yellow', 0.019);
        addRibbon(markFrom, markTo, medianW * 0.5 + 0.12, 0.14, 'marking-yellow', 0.019);
      } else {
        // Double Solid Yellow Centerline (US/Intl standard)
        addRibbon(markFrom, markTo, -0.11, 0.12, 'marking-yellow', 0.019);
        addRibbon(markFrom, markTo, 0.11, 0.12, 'marking-yellow', 0.019);
      }
    }

    // Dashed Lane Dividers
    const halfLanes = lanes / 2;
    for (let l = 1; l < lanes; l++) {
      if (!road.oneWay && l === halfLanes) continue;
      const lat =
        -travelHalfW +
        l * laneW +
        (!road.oneWay ? (l < halfLanes ? -medianW * 0.5 : medianW * 0.5) : 0);
      const pitch = road.roadClass === 'highway' ? 9.0 : 6.0;
      const dashLen = road.roadClass === 'highway' ? 3.6 : 2.6;
      for (let s = markFrom + 1.0; s + dashLen < markTo - 0.8; s += pitch) {
        addRibbon(s, s + dashLen, lat, 0.13, 'marking-white', 0.019);
      }
    }

    // Outer Edge / Shoulder Lines
    for (const side of [-1, 1]) {
      const edgeLat = side * (travelHalfW - 0.14);
      const mat = road.oneWay && side === -1 ? 'marking-yellow' : 'marking-white';
      addRibbon(markFrom, markTo, edgeLat, 0.14, mat, 0.019);
    }

    // Dedicated Red Bus Lane & Protected Green Cycling Track ribbons (NACTO / AASHTO dimensions)
    if (road.busLane) {
      for (const side of road.oneWay ? [1] : [-1, 1]) {
        const busLat = side * (travelHalfW - laneW * 0.5);
        const busW = laneW - 0.24;
        addRibbon(markFrom, markTo, busLat, busW, 'bus-lane-red', 0.014);
        // Solid 150mm white transit separation stripe
        addRibbon(markFrom, markTo, busLat - side * (busW * 0.5 + 0.08), 0.15, 'marking-white', 0.019);

        // White Transit Diamond (◇) + "BUS" bar stencils every 22m
        for (let s = markFrom + 8.0; s < markTo - 8.0; s += 22.0) {
          const stC = interpolateStationAtS(alignment, s);
          const stF = interpolateStationAtS(alignment, s + 1.45);
          const stB = interpolateStationAtS(alignment, s - 1.45);
          const pTop = surfacePointAt(stF, road, busLat, 0.022);
          const pBot = surfacePointAt(stB, road, busLat, 0.022);
          const pLeft = surfacePointAt(stC, road, busLat - 0.58, 0.022);
          const pRight = surfacePointAt(stC, road, busLat + 0.58, 0.022);
          builder.addQuad('marking-white', 'markings', road.id, pBot, pRight, pTop, pLeft, [0, 0], [1, 0], [1, 1], [0, 1], [1, 1, 1, 1], false);
          // Transverse "BUS ONLY" legend bars ahead of diamond
          addRibbon(s + 2.2, s + 2.55, busLat, 1.15, 'marking-white', 0.022);
          addRibbon(s + 2.85, s + 3.2, busLat, 0.95, 'marking-white', 0.022);
        }
      }
    }
    if (road.cycleLane) {
      for (const side of [-1, 1]) {
        const cycW = 1.65;
        const cycLat = side * (hw - cycW * 0.5 - 0.08);
        const bufInnerLat = side * (hw - cycW - 0.16);
        const bufOuterLat = side * (hw - cycW - 0.58);
        // Emerald Green Protected Bikeway Surfacing
        addRibbon(markFrom, markTo, cycLat, cycW, 'cycle-lane-green', 0.015);
        // Dual 120mm White Buffer Stripes (0.42m painted buffer zone)
        addRibbon(markFrom, markTo, bufInnerLat, 0.12, 'marking-white', 0.019);
        addRibbon(markFrom, markTo, bufOuterLat, 0.12, 'marking-white', 0.019);

        // Diagonal Buffer Hatch Bars & Flexible Protected Bikeway Delineators every 6.5m
        for (let s = markFrom + 3.0; s < markTo - 3.0; s += 6.5) {
          const stA = interpolateStationAtS(alignment, s - 0.35);
          const stB = interpolateStationAtS(alignment, s + 0.35);
          builder.addQuad(
            'marking-white',
            'markings',
            road.id,
            surfacePointAt(stA, road, bufInnerLat, 0.021),
            surfacePointAt(stA, road, bufInnerLat - side * 0.09, 0.021),
            surfacePointAt(stB, road, bufOuterLat + side * 0.09, 0.021),
            surfacePointAt(stB, road, bufOuterLat, 0.021),
            [0, 0], [1, 0], [1, 1], [0, 1],
            [1, 1, 1, 1],
            false
          );
          if (Math.floor(s / 6.5) % 2 === 0) {
            const delinBase = surfacePointAt(stA, road, (bufInnerLat + bufOuterLat) * 0.5, 0.01);
            builder.addCylinder('cycle-lane-green', 'furniture', road.id, delinBase, add(delinBase, [0, 0.72, 0]), 0.048, 0.042, 6);
            builder.addCylinder('marking-white', 'furniture', road.id, add(delinBase, [0, 0.52, 0]), add(delinBase, [0, 0.66, 0]), 0.046, 0.044, 6);
          }
        }

        // White Bike Symbol + Chevron Stencils every 16m along the green cycle track
        for (let s = markFrom + 5.5; s < markTo - 5.5; s += 16.0) {
          addRibbon(s - 0.55, s + 0.35, cycLat, 0.14, 'marking-white', 0.022);
          const stTip = interpolateStationAtS(alignment, s + 0.95 * side);
          const stBase = interpolateStationAtS(alignment, s + 0.35 * side);
          builder.addQuad(
            'marking-white',
            'markings',
            road.id,
            surfacePointAt(stBase, road, cycLat - 0.36, 0.022),
            surfacePointAt(stBase, road, cycLat + 0.36, 0.022),
            surfacePointAt(stTip, road, cycLat + 0.06, 0.022),
            surfacePointAt(stTip, road, cycLat - 0.06, 0.022),
            [0, 0], [1, 0], [1, 1], [0, 1],
            [1, 1, 1, 1],
            false
          );
        }
      }
    }

    // Directional Lane Arrows (Quads) near junctions
    const drawLaneArrow = (stationS, dirSign) => {
      const st = interpolateStationAtS(alignment, stationS);
      for (let l = 0; l < lanes; l++) {
        const isRightHalf = l >= lanes / 2;
        const laneDir = road.oneWay ? 1 : isRightHalf ? 1 : -1;
        if (laneDir !== dirSign) continue;
        const lat =
          -travelHalfW +
          (l + 0.5) * laneW +
          (!road.oneWay ? (isRightHalf ? medianW * 0.5 : -medianW * 0.5) : 0);
        // Shaft quad + Head chevron quads
        const pPt = (dx, dz) => {
          const stAt = interpolateStationAtS(alignment, stationS + dz * dirSign);
          return surfacePointAt(stAt, road, lat + dx * dirSign, 0.022);
        };
        builder.addQuad('marking-white', 'markings', road.id, pPt(-0.11, -1.4), pPt(0.11, -1.4), pPt(0.11, 0.25), pPt(-0.11, 0.25), [0, 0], [1, 0], [1, 1], [0, 1], [1, 1, 1, 1], false);
        builder.addQuad('marking-white', 'markings', road.id, pPt(-0.46, 0.25), pPt(0.46, 0.25), pPt(0.08, 1.35), pPt(-0.08, 1.35), [0, 0], [1, 0], [0.6, 1], [0.4, 1], [1, 1, 1, 1], false);
      }
    };
    if (markTo - markFrom > 18) {
      if (!road.oneWay) drawLaneArrow(markFrom + 6.5, -1);
      drawLaneArrow(markTo - 6.5, 1);
    }
  }

  // Continental Zebra Crosswalks & Incoming Stop Bars
  const drawCrosswalkAndStopBar = (crossS, incomingSign) => {
    const zWidth = hw * 2 - 0.5;
    const stripeCount = Math.max(4, Math.floor(zWidth / 0.9));
    const zLength = 3.2;
    for (let i = 0; i < stripeCount; i++) {
      const lat = -zWidth * 0.5 + ((i + 0.5) / stripeCount) * zWidth;
      if (medianW >= 0.8 && Math.abs(lat) < medianW * 0.5 + 0.2) continue;
      const st0 = interpolateStationAtS(alignment, crossS - zLength * 0.5);
      const st1 = interpolateStationAtS(alignment, crossS + zLength * 0.5);
      builder.addQuad(
        'marking-white',
        'markings',
        road.id,
        surfacePointAt(st0, road, lat - 0.22, 0.021),
        surfacePointAt(st0, road, lat + 0.22, 0.021),
        surfacePointAt(st1, road, lat + 0.22, 0.021),
        surfacePointAt(st1, road, lat - 0.22, 0.021),
        [0, 0], [1, 0], [1, 1], [0, 1],
        [1, 1, 1, 1],
        false
      );
    }
    // Incoming Stop Bar (40cm wide solid white line before crosswalk)
    const stopS = crossS - incomingSign * (zLength * 0.5 + 1.35);
    if (stopS > sStart && stopS < sEnd) {
      const stA = interpolateStationAtS(alignment, stopS - 0.22);
      const stB = interpolateStationAtS(alignment, stopS + 0.22);
      const lat0 = road.oneWay ? -travelHalfW + 0.2 : incomingSign === 1 ? medianW * 0.5 + 0.15 : -travelHalfW + 0.2;
      const lat1 = road.oneWay ? travelHalfW - 0.2 : incomingSign === 1 ? travelHalfW - 0.2 : -medianW * 0.5 - 0.15;
      builder.addQuad(
        'marking-white',
        'markings',
        road.id,
        surfacePointAt(stA, road, lat0, 0.022),
        surfacePointAt(stA, road, lat1, 0.022),
        surfacePointAt(stB, road, lat1, 0.022),
        surfacePointAt(stB, road, lat0, 0.022),
        [0, 0], [1, 0], [1, 1], [0, 1],
        [1, 1, 1, 1],
        false
      );
    }
  };

  if (hasStartCrosswalk && sEnd - sStart > 12) drawCrosswalkAndStopBar(sStart + 2.2, -1);
  if (hasEndCrosswalk && sEnd - sStart > 12) drawCrosswalkAndStopBar(sEnd - 2.2, 1);

  // Roadside Parallel Parking Bays (5.5m x 2.15m on 6.2m pitch)
  const parkingBays = [];
  if (road.parking && road.roadClass !== 'highway') {
    const bayLen = 5.5;
    const bayWidth = 2.1;
    const pitch = 6.2;
    const parkFrom = markFrom + 4.0;
    const parkTo = markTo - 4.0;
    for (const side of [-1, 1]) {
      const outerLat = side * (travelHalfW + bayWidth);
      const innerLat = side * (travelHalfW + 0.12);
      for (let s = parkFrom; s + bayLen <= parkTo; s += pitch) {
        const s0 = s;
        const s1 = s + bayLen;
        // Front T-tick, Rear T-tick, and outer boundary dashes
        addRibbon(s0, s0 + 0.12, (innerLat + outerLat) * 0.5, bayWidth - 0.15, 'marking-white', 0.02);
        addRibbon(s1 - 0.12, s1, (innerLat + outerLat) * 0.5, bayWidth - 0.15, 'marking-white', 0.02);
        addRibbon(s0, s0 + 1.1, innerLat, 0.11, 'marking-white', 0.02);
        addRibbon(s1 - 1.1, s1, innerLat, 0.11, 'marking-white', 0.02);
        const stMid = interpolateStationAtS(alignment, (s0 + s1) * 0.5);
        parkingBays.push({
          id: `${road.id}-bay-${side}-${Math.round(s0)}`,
          roadId: road.id,
          side,
          station: (s0 + s1) * 0.5,
          position: surfacePointAt(stMid, road, (innerLat + outerLat) * 0.5, 0.02),
          direction: side === 1 ? stMid.d : scale(stMid.d, -1),
        });
      }
    }
  }

  return { parkingBays };
}

/**
 * 2. Speed Bumps (Parabolic Asphalt + Vulcanized Rubber Cushions) & 3D Pothole Details
 */
export function buildSpeedBumpsAndPotholesQuads(road, alignment, potholes, speedBumps, builder) {
  const hw = getRoadCarriagewayHalfWidth(road);

  // Speed Bumps: Add yellow chevron warning triangles on the ramp approaches
  for (const bump of speedBumps) {
    if (bump.enabled === false || bump.roadId !== road.id) continue;
    const s = clamp(bump.station, 4, alignment.length - 4);
    const halfLen = (bump.length || 3.4) * 0.5;
    const st0 = interpolateStationAtS(alignment, s - halfLen * 0.75);
    const stMid = interpolateStationAtS(alignment, s);
    const st1 = interpolateStationAtS(alignment, s + halfLen * 0.75);

    // Dark vulcanized rubber band + yellow warning chevrons across carriageway
    const chevronCount = Math.max(4, Math.floor((hw * 1.8) / 1.1));
    for (let i = 0; i < chevronCount; i++) {
      const lat = -hw * 0.85 + ((i + 0.5) / chevronCount) * (hw * 1.7);
      const lift = (bump.height || 0.085) + 0.022;
      builder.addQuad(
        'marking-yellow',
        'distress',
        bump.id,
        surfacePointAt(st0, road, lat - 0.18, 0.04),
        surfacePointAt(st0, road, lat + 0.18, 0.04),
        surfacePointAt(stMid, road, lat + 0.06, lift),
        surfacePointAt(stMid, road, lat - 0.06, lift),
        [0, 0], [1, 0], [1, 1], [0, 1],
        [1, 0.82, 0.1, 1],
        false
      );
      builder.addQuad(
        'marking-yellow',
        'distress',
        bump.id,
        surfacePointAt(st1, road, lat - 0.18, 0.04),
        surfacePointAt(stMid, road, lat - 0.06, lift),
        surfacePointAt(stMid, road, lat + 0.06, lift),
        surfacePointAt(st1, road, lat + 0.18, 0.04),
        [0, 0], [0, 1], [1, 1], [1, 0],
        [1, 0.82, 0.1, 1],
        false
      );
    }
    builder.pickables.push({
      kind: 'speed-bump',
      id: bump.id,
      name: bump.name || 'Speed Bump',
      center: [...stMid.p],
      radius: Math.max(3.5, hw),
    });
  }

  // Potholes: Add jagged inner asphalt collar, sub-base stones, and water puddle quad inside the depressed mesh
  for (const ph of potholes) {
    if (ph.enabled === false || (ph.roadId && ph.roadId !== road.id)) continue;
    const r = ph.radius || 1.35;
    const depth = ph.depth || 0.085;
    const c = ph.position;
    const ringSegs = 12;
    const rimGrid = [[], [], []];
    for (let i = 0; i <= ringSegs; i++) {
      const a = (i / ringSegs) * Math.PI * 2;
      // Deterministic jaggedness for realistic broken asphalt fracture rim
      const jag = 0.82 + 0.22 * Math.sin(i * 3.7 + c[0]) * Math.cos(i * 2.3 + c[2]);
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const pOuter = [c[0] + cs * r * 1.05 * jag, c[1] + 0.012, c[2] + sn * r * 1.05 * jag];
      const pWall = [c[0] + cs * r * 0.82 * jag, c[1] - depth * 0.72, c[2] + sn * r * 0.82 * jag];
      const pFloor = [c[0] + cs * r * 0.35 * jag, c[1] - depth * 0.88, c[2] + sn * r * 0.35 * jag];
      rimGrid[0].push({ p: pOuter, uv: [i / ringSegs, 0], color: [0.35, 0.34, 0.33, 1] });
      rimGrid[1].push({ p: pWall, uv: [i / ringSegs, 0.5], color: [0.22, 0.2, 0.18, 1] });
      rimGrid[2].push({ p: pFloor, uv: [i / ringSegs, 1], color: [0.46, 0.42, 0.36, 0] });
    }
    builder.addQuadGrid('pothole-subbase', 'distress', ph.id, rimGrid, true, true);

    // Reflective rainwater puddle quad inside the pothole
    if (ph.waterPuddle !== false) {
      const pr = r * 0.68;
      const py = c[1] - depth * 0.52;
      builder.addQuad(
        'water-puddle',
        'distress',
        ph.id,
        [c[0] - pr, py, c[2] - pr],
        [c[0] + pr, py, c[2] - pr],
        [c[0] + pr, py, c[2] + pr],
        [c[0] - pr, py, c[2] + pr],
        [0, 0], [1, 0], [1, 1], [0, 1],
        [0.18, 0.24, 0.28, 0.92],
        false
      );
    }

    builder.pickables.push({
      kind: 'pothole',
      id: ph.id,
      name: ph.name || 'Road Pothole & Patch',
      center: [...c],
      radius: r * 1.8,
    });
  }
}

/**
 * 3. Active Road Construction & Rebuilding Zone (Trench, Rebar, Pipes, Barriers, Cones, Arrow Board & Construction Robots)
 */
export function buildConstructionZoneQuads(road, alignment, zone, builder, simTime = 0) {
  if (!zone || zone.enabled === false || zone.roadId !== road.id) return;
  const hw = getRoadCarriagewayHalfWidth(road);
  const length = zone.length || 24.0;
  const sCenter = clamp(zone.station || alignment.length * 0.5, length * 0.6, alignment.length - length * 0.6);
  const s0 = sCenter - length * 0.5;
  const s1 = sCenter + length * 0.5;
  const depth = zone.depth || 0.32;

  const sideSign = zone.side === 'left' ? -1 : 1;
  const latInner = sideSign * 0.25;
  const latOuter = sideSign * (hw - 0.35);
  const latMin = Math.min(latInner, latOuter);
  const latMax = Math.max(latInner, latOuter);
  const latMid = 0.5 * (latMin + latMax);
  const trenchW = Math.max(2.2, latMax - latMin);

  // 1. Excavated Sub-Base Gravel Bed & Rebar Grid Quads
  const steps = Math.max(6, Math.ceil(length / 2.0));
  const bedGrid = [];
  for (let i = 0; i <= steps; i++) {
    const s = lerp(s0 + 1.2, s1 - 1.2, i / steps);
    const st = interpolateStationAtS(alignment, s);
    const pL = surfacePointAt(st, road, latMin + 0.15, -depth + 0.02);
    const pR = surfacePointAt(st, road, latMax - 0.15, -depth + 0.02);
    bedGrid.push([
      { p: pL, uv: [0, i * 0.5], color: [0.55, 0.48, 0.38, 1] },
      { p: pR, uv: [1, i * 0.5], color: [0.55, 0.48, 0.38, 1] },
    ]);
  }
  builder.addQuadGrid('pothole-subbase', 'construction', zone.id, bedGrid, false, true);

  // Reinforcing Steel Rebar Bars & Concrete Culvert Pipe inside the trench
  const stMid = interpolateStationAtS(alignment, sCenter);
  const pipeStart = madd(surfacePointAt(stMid, road, latMid, -depth + 0.28), stMid.d, -length * 0.22);
  const pipeEnd = madd(surfacePointAt(stMid, road, latMid, -depth + 0.28), stMid.d, length * 0.22);
  builder.addCylinder('concrete-structure', 'construction', zone.id, pipeStart, pipeEnd, 0.36, 0.36, 12, [0.76, 0.75, 0.72, 1], false);

  for (let s = s0 + 2.5; s <= s1 - 2.5; s += 1.6) {
    const st = interpolateStationAtS(alignment, s);
    const rA = surfacePointAt(st, road, latMin + 0.3, -depth + 0.06);
    const rB = surfacePointAt(st, road, latMax - 0.3, -depth + 0.06);
    builder.addCylinder('steel-galvanized', 'construction', zone.id, rA, rB, 0.022, 0.022, 6, [0.48, 0.35, 0.26, 1], false);
  }

  // 2. Orange & White Jersey Barriers around the work zone
  const barrierLen = 2.8;
  for (let s = s0; s + barrierLen <= s1; s += barrierLen + 0.25) {
    const st = interpolateStationAtS(alignment, s + barrierLen * 0.5);
    const bPos = surfacePointAt(st, road, latInner - sideSign * 0.25, 0.42);
    const isOrange = Math.floor((s - s0) / barrierLen) % 2 === 0;
    const mat = isOrange ? 'construction-orange' : 'marking-white';
    builder.addBox(mat, 'construction', zone.id, bPos, 0.48, 0.84, barrierLen, st.d, [1, 1, 1, 1], false);
  }

  // 3. Reflective Traffic Cones along taper
  const conePositions = [
    [s0 - 7.5, latOuter * 0.85],
    [s0 - 5.0, latOuter * 0.6],
    [s0 - 2.5, latInner],
    [s1 + 2.5, latInner],
    [s1 + 5.0, latOuter * 0.6],
    [s1 + 7.5, latOuter * 0.85],
  ];
  for (const [cs, clat] of conePositions) {
    if (cs <= 1 || cs >= alignment.length - 1) continue;
    const st = interpolateStationAtS(alignment, cs);
    const baseP = surfacePointAt(st, road, clat, 0.01);
    builder.addBox('asphalt-wearing', 'construction', zone.id, add(baseP, [0, 0.025, 0]), 0.42, 0.05, 0.42, st.d);
    builder.addCylinder('construction-orange', 'construction', zone.id, add(baseP, [0, 0.05, 0]), add(baseP, [0, 0.78, 0]), 0.16, 0.045, 8);
    builder.addCylinder('marking-white', 'construction', zone.id, add(baseP, [0, 0.42, 0]), add(baseP, [0, 0.58, 0]), 0.105, 0.075, 8);
  }

  // 4. Solar Flashing Arrow-Board Trailer at work-zone approach
  const stTrailer = interpolateStationAtS(alignment, Math.max(2, s0 - 1.6));
  const trailerPos = surfacePointAt(stTrailer, road, latMid, 0.02);
  builder.addBox('marking-yellow', 'construction', zone.id, add(trailerPos, [0, 0.35, 0]), 1.6, 0.22, 2.1, stTrailer.d);
  builder.addBox('asphalt-wearing', 'construction', zone.id, add(trailerPos, [0, 1.95, 0]), 2.2, 1.25, 0.16, stTrailer.d);
  // Glowing amber arrow quads on the board
  for (let k = -2; k <= 2; k++) {
    const pDot = madd(add(trailerPos, [0, 1.95, 0]), stTrailer.n, k * 0.32);
    builder.addBox('emissive-amber', 'construction', zone.id, madd(pDot, stTrailer.d, -0.1), 0.14, 0.14, 0.04, stTrailer.d);
  }

  // 5. Autonomous Road-Rebuilding Robot inside the Construction Zone
  const botS = sCenter + Math.sin(simTime * 0.9) * (length * 0.25);
  const stBot = interpolateStationAtS(alignment, botS);
  const botPos = surfacePointAt(stBot, road, latMid, -depth + 0.02);
  buildAutonomousRobotQuads(builder, botPos, stBot.d, 'construction-bot', zone.id);

  builder.pickables.push({
    kind: 'construction',
    id: zone.id,
    name: zone.name || 'Road Rebuilding & Trench Zone',
    center: [...stMid.p],
    radius: Math.max(6.0, length * 0.35),
  });
}

/**
 * 4. Bridges, Overpasses, Highway Interchanges & Tunnels / Underpasses
 * Built with accurate civil engineering dimensions (1.65m girders, >5.2m clearance, hammerhead piers, bearings).
 */
export function buildBridgeAndUnderpassQuads(road, alignment, trimStart, trimEnd, builder, project) {
  const totalHw = getRoadTotalHalfWidth(road);
  const s0 = trimStart;
  const s1 = alignment.length - trimEnd;
  if (s1 - s0 < 6.0) return { minClearance: 5.6 };

  // A. Elevated Bridge Structure (Box-Girder or Steel I-Girder + Bearings + Chamfered Hammerhead Piers)
  if (road.verticalProfile === 'bridge-arch' || road.isBridge) {
    const girderDepth = road.girderDepth || 1.65;
    const bridgeStyle = road.bridgeStyle || 'box-girder'; // 'box-girder' or 'steel-i-girder'
    const steps = Math.max(10, Math.ceil((s1 - s0) / 3.0));
    const soffitGrid = [];

    for (let i = 0; i <= steps; i++) {
      const s = lerp(s0, s1, i / steps);
      const st = interpolateStationAtS(alignment, s);
      if (st.p[1] < 1.2 && !road.isBridge) continue;

      const deckY = st.p[1] - 0.32;
      const botY = deckY - girderDepth;
      const topW = totalHw * 0.96;
      const botW = totalHw * 0.68;

      const pTopL = [st.p[0] - st.n[0] * topW, deckY, st.p[2] - st.n[2] * topW];
      const pBotL = [st.p[0] - st.n[0] * botW, botY, st.p[2] - st.n[2] * botW];
      const pBotR = [st.p[0] + st.n[0] * botW, botY, st.p[2] + st.n[2] * botW];
      const pTopR = [st.p[0] + st.n[0] * topW, deckY, st.p[2] + st.n[2] * topW];

      soffitGrid.push([
        { p: pTopL, uv: [0, s * 0.15] },
        { p: pBotL, uv: [0.3, s * 0.15] },
        { p: pBotR, uv: [0.7, s * 0.15] },
        { p: pTopR, uv: [1.0, s * 0.15] },
      ]);

      // If Steel I-Girder, add longitudinal steel plate webs & cross-diaphragms
      if (bridgeStyle === 'steel-i-girder' && i < steps) {
        const sNext = lerp(s0, s1, (i + 1) / steps);
        const stNext = interpolateStationAtS(alignment, sNext);
        const girderCount = Math.max(3, Math.floor((topW * 1.7) / 3.2));
        for (let g = 0; g < girderCount; g++) {
          const gLat = lerp(-botW * 0.88, botW * 0.88, g / (girderCount - 1));
          const gMid = [
            0.5 * (st.p[0] + stNext.p[0]) + st.n[0] * gLat,
            0.5 * (st.p[1] + stNext.p[1]) - 0.32 - girderDepth * 0.5,
            0.5 * (st.p[2] + stNext.p[2]) + st.n[2] * gLat,
          ];
          builder.addBox('steel-weathered', 'bridges', road.id, gMid, 0.24, girderDepth * 0.92, sNext - s, st.d);
        }
      }
    }

    if (soffitGrid.length >= 2) {
      builder.addQuadGrid(
        bridgeStyle === 'steel-i-girder' ? 'steel-weathered' : 'concrete-structure',
        'bridges',
        road.id,
        soffitGrid,
        false,
        true
      );
    }

    // Pier Placement with Lower-Corridor Collision Avoidance & Real Elastomeric Bearings
    const pierSpacing = road.pierSpacing || 28.0;
    const spanLen = s1 - s0;
    const numPiers = Math.max(2, Math.floor(spanLen / pierSpacing));
    for (let pIdx = 1; pIdx <= numPiers; pIdx++) {
      const pierS = s0 + (pIdx / (numPiers + 1)) * spanLen;
      const st = interpolateStationAtS(alignment, pierS);
      const soffitY = st.p[1] - 0.32 - girderDepth;
      if (soffitY < 2.2) continue;

      // Hammerhead Cap Beam
      const capH = 1.15;
      const capW = totalHw * 1.42;
      const capCenter = [st.p[0], soffitY - capH * 0.5 - 0.14, st.p[2]];
      builder.addBox('concrete-structure', 'bridges', road.id, capCenter, capW, capH, 2.2, st.d, [0.88, 0.87, 0.85, 1], true);

      // Elastomeric Bearing Pads on top of Hammerhead Cap
      for (const bFrac of [-0.65, -0.22, 0.22, 0.65]) {
        const bPos = [
          st.p[0] + st.n[0] * (capW * 0.45 * bFrac),
          soffitY - 0.07,
          st.p[2] + st.n[2] * (capW * 0.45 * bFrac),
        ];
        builder.addBox('asphalt-wearing', 'bridges', road.id, bPos, 0.65, 0.14, 0.65, st.d);
      }

      // Twin or Single Chamfered Concrete Column + Pile Cap Footing
      const colH = Math.max(1.0, soffitY - capH - 0.14);
      if (totalHw > 8.5) {
        for (const side of [-1, 1]) {
          const colX = st.p[0] + st.n[0] * side * (totalHw * 0.46);
          const colZ = st.p[2] + st.n[2] * side * (totalHw * 0.46);
          builder.addCylinder(
            'concrete-structure',
            'bridges',
            road.id,
            [colX, 0, colZ],
            [colX, colH, colZ],
            1.05,
            0.92,
            12,
            [0.85, 0.84, 0.82, 1],
            false
          );
          builder.addBox('concrete-structure', 'bridges', road.id, [colX, 0.35, colZ], 3.2, 0.7, 3.2, st.d);
        }
      } else {
        builder.addCylinder(
          'concrete-structure',
          'bridges',
          road.id,
          [st.p[0], 0, st.p[2]],
          [st.p[0], colH, st.p[2]],
          1.25,
          1.08,
          12,
          [0.85, 0.84, 0.82, 1],
          false
        );
        builder.addBox('concrete-structure', 'bridges', road.id, [st.p[0], 0.4, st.p[2]], 3.8, 0.8, 3.8, st.d);
      }
    }
  }

  // B. Underpass Retaining Walls & Bored Tunnel Portal + Ceiling Jet Fans + LED Strips
  if (road.verticalProfile === 'underpass-dip' || road.isTunnel) {
    const steps = Math.max(10, Math.ceil((s1 - s0) / 3.0));
    const wallHeight = 6.2;

    for (const side of [-1, 1]) {
      const wallGrid = [];
      for (let i = 0; i <= steps; i++) {
        const s = lerp(s0, s1, i / steps);
        const st = interpolateStationAtS(alignment, s);
        if (st.p[1] > -0.6 && !road.isTunnel) continue;
        const wLat = side * (totalHw - 0.15);
        const pBot = [st.p[0] + st.n[0] * wLat, st.p[1], st.p[2] + st.n[2] * wLat];
        const pTop = [st.p[0] + st.n[0] * wLat, Math.max(0.35, st.p[1] + wallHeight), st.p[2] + st.n[2] * wLat];
        wallGrid.push([
          { p: pBot, uv: [0, s * 0.2] },
          { p: pTop, uv: [1, s * 0.2] },
        ]);
      }
      if (wallGrid.length >= 2) {
        builder.addQuadGrid('concrete-structure', 'tunnels', road.id, wallGrid, side === 1, true);
      }
    }

    // Tunnel Roof Arch, Portal Headwalls, Jet Fans & Continuous LED Luminaires in central deep zone
    const roofFrom = s0 + (s1 - s0) * 0.26;
    const roofTo = s0 + (s1 - s0) * 0.74;
    if (roofTo - roofFrom > 8.0) {
      const roofSteps = Math.max(6, Math.ceil((roofTo - roofFrom) / 2.8));
      const archSegs = 8;
      const archGrid = [];
      const clearH = 5.4;

      for (let i = 0; i <= roofSteps; i++) {
        const s = lerp(roofFrom, roofTo, i / roofSteps);
        const st = interpolateStationAtS(alignment, s);
        const row = [];
        for (let j = 0; j <= archSegs; j++) {
          const u = j / archSegs;
          const angle = u * Math.PI;
          const lat = -Math.cos(angle) * (totalHw - 0.15);
          const archRise = Math.sin(angle) * 1.85;
          const p = [
            st.p[0] + st.n[0] * lat,
            st.p[1] + clearH + archRise,
            st.p[2] + st.n[2] * lat,
          ];
          row.push({ p, uv: [u * 3, s * 0.2], color: [0.78, 0.79, 0.81, 1] });
        }
        archGrid.push(row);

        // Continuous Tunnel LED Strip lights on both upper haunches
        if (i < roofSteps) {
          const sNext = lerp(roofFrom, roofTo, (i + 1) / roofSteps);
          for (const side of [-1, 1]) {
            const ledPos = [
              st.p[0] + st.n[0] * side * (totalHw * 0.62),
              st.p[1] + clearH + 0.85,
              st.p[2] + st.n[2] * side * (totalHw * 0.62),
            ];
            builder.addBox('emissive-warm', 'tunnels', road.id, ledPos, 0.16, 0.08, (sNext - s) * 0.88, st.d);
          }
        }
      }
      builder.addQuadGrid('concrete-structure', 'tunnels', road.id, archGrid, false, true);

      // Tunnel Ceiling Jet-Fan Ventilation Turbines at mid-tunnel
      const stMid = interpolateStationAtS(alignment, 0.5 * (roofFrom + roofTo));
      for (const side of [-1, 1]) {
        const fanC = [
          stMid.p[0] + stMid.n[0] * side * 2.1,
          stMid.p[1] + clearH + 1.1,
          stMid.p[2] + stMid.n[2] * side * 2.1,
        ];
        builder.addCylinder(
          'steel-galvanized',
          'tunnels',
          road.id,
          madd(fanC, stMid.d, -1.4),
          madd(fanC, stMid.d, 1.4),
          0.48,
          0.48,
          10
        );
      }

      // Portal Collar Frames at entrance & exit
      for (const portalS of [roofFrom, roofTo]) {
        const stP = interpolateStationAtS(alignment, portalS);
        builder.addBox(
          'concrete-structure',
          'tunnels',
          road.id,
          [stP.p[0], stP.p[1] + clearH + 1.4, stP.p[2]],
          totalHw * 2.12,
          1.6,
          1.4,
          stP.d
        );
      }
    }
  }

  return { minClearance: 5.45 };
}

/**
 * 5. Railways Going Through/Under/Over the Road (with Full FHWA MUTCD At-Grade Road-Rail Crossings)
 *    + Underground Subway Tunnel & Cutaway Station
 */
export function buildRailwaysAndSubwayQuads(project, builder, simTime = 0, alignmentsMap = null) {
  const railways = project.railways || [];
  for (const rail of railways) {
    if (rail.enabled === false) continue;
    const p0 = rail.start || [-110, 0, -18];
    const p3 = rail.end || [110, 0, 18];
    const p1 = rail.ctrl1 || lerp3(p0, p3, 0.33);
    const p2 = rail.ctrl2 || lerp3(p0, p3, 0.67);

    // Sample railway spline
    const dummyMap = new Map([
      ['rs', { id: 'rs', position: p0 }],
      ['re', { id: 're', position: p3 }],
    ]);
    const align = sampleRoadAlignment(
      { id: rail.id, start: 'rs', end: 're', ctrl1: p1, ctrl2: p2 },
      dummyMap,
      1.6
    );

    const trackGauge = 1.435; // Standard UIC/AREMA gauge 1435mm (4 ft 8.5 in)
    const trackSpacing = rail.tracks === 2 ? 4.0 : 0;
    const ballastHalfW = rail.tracks === 2 ? 4.9 : 2.8;

    // Automatically detect all at-grade road-rail intersections across the city network!
    const gradeCrossings = [];
    if (alignmentsMap) {
      for (const road of project.roads || []) {
        if (road.enabled === false || road.verticalProfile === 'bridge-arch') continue;
        const rAlign = alignmentsMap.get(road.id);
        if (!rAlign) continue;
        let bestDist = Infinity;
        let bestRailSt = null;
        let bestRoadSt = null;
        for (const railSt of align.stations) {
          for (const roadSt of rAlign.stations) {
            const dXZ = distXZ(railSt.p, roadSt.p);
            const dY = Math.abs(railSt.p[1] - roadSt.p[1]);
            if (dXZ < bestDist && dY < 2.2) {
              bestDist = dXZ;
              bestRailSt = railSt;
              bestRoadSt = roadSt;
            }
          }
        }
        const roadHw = getRoadCarriagewayHalfWidth(road);
        if (bestDist < Math.max(4.5, roadHw * 0.65) && bestRailSt && bestRoadSt) {
          // Ensure we don't duplicate a crossing within 14m along the same rail line
          if (!gradeCrossings.some((c) => Math.abs(c.railS - bestRailSt.s) < 14.0)) {
            gradeCrossings.push({
              railS: bestRailSt.s,
              railSt: bestRailSt,
              road,
              roadAlign: rAlign,
              roadS: bestRoadSt.s,
              roadSt: bestRoadSt,
              roadHw,
              halfSpan: roadHw + (road.sidewalkWidth || 3.2) + 1.2,
            });
          }
        }
      }
    }
    if (rail.crossingStation !== undefined && !gradeCrossings.some((c) => Math.abs(c.railS - rail.crossingStation) < 14.0)) {
      const stCross = interpolateStationAtS(align, rail.crossingStation);
      gradeCrossings.push({
        railS: rail.crossingStation,
        railSt: stCross,
        road: null,
        roadAlign: null,
        roadS: 0,
        roadSt: stCross,
        roadHw: 7.5,
        halfSpan: 11.0,
      });
    }

    // Helper: compute depression factor (0 inside road grade crossing, 1 on open ballasted track)
    const getCrossingProfileFactor = (s) => {
      let factor = 1.0;
      for (const c of gradeCrossings) {
        const ds = Math.abs(s - c.railS);
        if (ds < c.roadHw + 1.2) return 0.0;
        if (ds < c.halfSpan + 3.0) {
          const t = (ds - (c.roadHw + 1.2)) / (c.halfSpan + 1.8 - c.roadHw);
          factor = Math.min(factor, clamp(t, 0.0, 1.0));
        }
      }
      return factor;
    };

    // 1. Crushed Granite Ballast Trapezoid Prism (Quads — smoothly depressed at road grade crossings!)
    const ballastGrid = [];
    for (let i = 0; i < align.stations.length; i++) {
      const st = align.stations[i];
      const f = getCrossingProfileFactor(st.s);
      const topY = lerp(-0.03, 0.30, f);
      const b0 = [st.p[0] - st.n[0] * (ballastHalfW + 0.9), st.p[1] - 0.03, st.p[2] - st.n[2] * (ballastHalfW + 0.9)];
      const b1 = [st.p[0] - st.n[0] * ballastHalfW, st.p[1] + topY, st.p[2] - st.n[2] * ballastHalfW];
      const b2 = [st.p[0] + st.n[0] * ballastHalfW, st.p[1] + topY, st.p[2] + st.n[2] * ballastHalfW];
      const b3 = [st.p[0] + st.n[0] * (ballastHalfW + 0.9), st.p[1] - 0.03, st.p[2] + st.n[2] * (ballastHalfW + 0.9)];
      ballastGrid.push([
        { p: b0, uv: [0, st.s * 0.25] },
        { p: b1, uv: [0.25, st.s * 0.25] },
        { p: b2, uv: [0.75, st.s * 0.25] },
        { p: b3, uv: [1.0, st.s * 0.25] },
      ]);
    }
    builder.addQuadGrid('railway-ballast', 'railways', rail.id, ballastGrid, false, true);

    // 2. Concrete Sleepers & Dual UIC60 Steel Rails (1435mm standard gauge)
    const trackOffsets = rail.tracks === 2 ? [-trackSpacing * 0.5, trackSpacing * 0.5] : [0];
    for (const tOff of trackOffsets) {
      // Continuous Steel Rails (smoothly flush at road grade crossings!)
      for (const rSide of [-1, 1]) {
        const railLat = tOff + rSide * (trackGauge * 0.5);
        const railGrid = [];
        for (let i = 0; i < align.stations.length; i++) {
          const st = align.stations[i];
          const f = getCrossingProfileFactor(st.s);
          const railY = lerp(0.085, 0.42, f);
          const rL = [st.p[0] + st.n[0] * (railLat - 0.045), st.p[1] + railY, st.p[2] + st.n[2] * (railLat - 0.045)];
          const rR = [st.p[0] + st.n[0] * (railLat + 0.045), st.p[1] + railY, st.p[2] + st.n[2] * (railLat + 0.045)];
          railGrid.push([
            { p: rL, uv: [0, st.s] },
            { p: rR, uv: [1, st.s] },
          ]);
        }
        builder.addQuadGrid('steel-galvanized', 'railways', rail.id, railGrid, false, false);
      }

      // Prestressed Concrete Monoblock Sleepers every 1.1m (outside road grade-crossing deck panels)
      for (let s = 1.0; s < align.length - 1.0; s += 1.1) {
        if (getCrossingProfileFactor(s) < 0.35) continue;
        const st = interpolateStationAtS(align, s);
        const f = getCrossingProfileFactor(s);
        const slCenter = [
          st.p[0] + st.n[0] * tOff,
          st.p[1] + lerp(0.02, 0.33, f),
          st.p[2] + st.n[2] * tOff,
        ];
        builder.addBox('concrete-structure', 'railways', rail.id, slCenter, 2.55, 0.14, 0.26, st.d);
      }
    }

    // 3. Overhead Electrified Catenary Masts, Cantilevers & Contact Wires (clearing grade crossings)
    if (rail.electrified !== false) {
      let prevContactPts = null;
      for (let s = 6.0; s < align.length - 6.0; s += 26.0) {
        const nearCrossing = gradeCrossings.some((c) => Math.abs(s - c.railS) < c.halfSpan + 2.5);
        const st = interpolateStationAtS(align, s);
        if (!nearCrossing) {
          for (const side of [-1, 1]) {
            const mastX = st.p[0] + st.n[0] * side * (ballastHalfW + 0.85);
            const mastZ = st.p[2] + st.n[2] * side * (ballastHalfW + 0.85);
            builder.addBox(
              'steel-weathered',
              'railways',
              rail.id,
              [mastX, st.p[1] + 3.4, mastZ],
              0.28,
              6.8,
              0.28,
              st.d
            );
          }
          // Overhead Portal Crossbeam across tracks
          builder.addBox(
            'steel-galvanized',
            'railways',
            rail.id,
            [st.p[0], st.p[1] + 6.45, st.p[2]],
            (ballastHalfW + 0.85) * 2.0,
            0.22,
            0.22,
            st.d
          );
        }
        const curContactPts = trackOffsets.map((tOff) => [
          st.p[0] + st.n[0] * tOff,
          st.p[1] + 5.75,
          st.p[2] + st.n[2] * tOff,
        ]);
        if (prevContactPts) {
          for (let k = 0; k < curContactPts.length; k++) {
            builder.addCylinder(
              'steel-galvanized',
              'railways',
              rail.id,
              prevContactPts[k],
              curContactPts[k],
              0.025,
              0.025,
              4,
              [0.3, 0.32, 0.35, 1],
              false
            );
          }
        }
        prevContactPts = curContactPts;
      }
    }

    // 4. Full FHWA MUTCD Highway-Rail Grade Crossings (Precast Crossing Panels, R×R Markings, Crossbucks, Signals & Boom Gates)
    for (const cross of gradeCrossings) {
      const stA = interpolateStationAtS(align, Math.max(0, cross.railS - cross.roadHw - 0.6));
      const stB = interpolateStationAtS(align, Math.min(align.length, cross.railS + cross.roadHw + 0.6));

      // 4a. Flush Precast Concrete Grade Crossing Deck Panels & Elastomeric Flangeway Strips across the road
      const panelHalfW = ballastHalfW - 0.35;
      const p00 = [stA.p[0] - stA.n[0] * panelHalfW, stA.p[1] + 0.055, stA.p[2] - stA.n[2] * panelHalfW];
      const p01 = [stA.p[0] + stA.n[0] * panelHalfW, stA.p[1] + 0.055, stA.p[2] + stA.n[2] * panelHalfW];
      const p11 = [stB.p[0] + stB.n[0] * panelHalfW, stB.p[1] + 0.055, stB.p[2] + stB.n[2] * panelHalfW];
      const p10 = [stB.p[0] - stB.n[0] * panelHalfW, stB.p[1] + 0.055, stB.p[2] - stB.n[2] * panelHalfW];
      builder.addQuad('concrete-structure', 'railways', rail.id, p00, p01, p11, p10, [0, 0], [3, 0], [3, 4], [0, 4], [0.76, 0.75, 0.72, 1], true);

      // Dark rubberized flangeway filler strips along each track
      for (const tOff of trackOffsets) {
        const f00 = [stA.p[0] + stA.n[0] * (tOff - 0.56), stA.p[1] + 0.068, stA.p[2] + stA.n[2] * (tOff - 0.56)];
        const f01 = [stA.p[0] + stA.n[0] * (tOff + 0.56), stA.p[1] + 0.068, stA.p[2] + stA.n[2] * (tOff + 0.56)];
        const f11 = [stB.p[0] + stB.n[0] * (tOff + 0.56), stB.p[1] + 0.068, stB.p[2] + stB.n[2] * (tOff + 0.56)];
        const f10 = [stB.p[0] + stB.n[0] * (tOff - 0.56), stB.p[1] + 0.068, stB.p[2] + stB.n[2] * (tOff - 0.56)];
        builder.addQuad('asphalt-wearing', 'railways', rail.id, f00, f01, f11, f10, [0, 0], [1, 0], [1, 2], [0, 2], [0.22, 0.23, 0.25, 1], false);
      }

      // 4b. MUTCD Stop Lines (24 in / 0.60m), Dynamic Envelope & R×R Advance Warning Pavement Markings on the crossed road
      if (cross.road && cross.roadAlign) {
        const rRoad = cross.road;
        const rAlign = cross.roadAlign;
        const rHw = cross.roadHw;
        const envDist = ballastHalfW + 1.4; // Dynamic envelope edge (6 ft from outer rail)
        const stopDist = ballastHalfW + 4.4; // MUTCD Stop Line (15 ft from outer rail)

        for (const dirSign of [-1, 1]) {
          // Dynamic Envelope Line across full road
          const sEnv = clamp(cross.roadS + dirSign * envDist, 1, rAlign.length - 1);
          const stEnvA = interpolateStationAtS(rAlign, sEnv - 0.18);
          const stEnvB = interpolateStationAtS(rAlign, sEnv + 0.18);
          builder.addQuad(
            'marking-white',
            'markings',
            rRoad.id,
            surfacePointAt(stEnvA, rRoad, -rHw + 0.25, 0.024),
            surfacePointAt(stEnvA, rRoad, rHw - 0.25, 0.024),
            surfacePointAt(stEnvB, rRoad, rHw - 0.25, 0.024),
            surfacePointAt(stEnvB, rRoad, -rHw + 0.25, 0.024),
            [0, 0], [1, 0], [1, 1], [0, 1],
            [1, 1, 1, 1],
            false
          );

          // 0.60m (24 in) Solid White Stop Line across approaching half of road
          const sStop = clamp(cross.roadS + dirSign * stopDist, 1, rAlign.length - 1);
          const stStopA = interpolateStationAtS(rAlign, sStop - 0.30);
          const stStopB = interpolateStationAtS(rAlign, sStop + 0.30);
          const appLat0 = dirSign === 1 ? -rHw + 0.3 : 0.15;
          const appLat1 = dirSign === 1 ? -0.15 : rHw - 0.3;
          builder.addQuad(
            'marking-white',
            'markings',
            rRoad.id,
            surfacePointAt(stStopA, rRoad, appLat0, 0.025),
            surfacePointAt(stStopA, rRoad, appLat1, 0.025),
            surfacePointAt(stStopB, rRoad, appLat1, 0.025),
            surfacePointAt(stStopB, rRoad, appLat0, 0.025),
            [0, 0], [1, 0], [1, 1], [0, 1],
            [1, 1, 1, 1],
            false
          );

          // MUTCD R×R Advance Warning Symbol in approaching lanes (X + flanking R bars + framing bands)
          const sRxr = cross.roadS + dirSign * (stopDist + 6.2);
          if (sRxr > 4.0 && sRxr < rAlign.length - 4.0) {
            const laneMidLat = (appLat0 + appLat1) * 0.5;
            const stNear = interpolateStationAtS(rAlign, sRxr - 2.2);
            const stFar = interpolateStationAtS(rAlign, sRxr + 2.2);
            const stMidRxr = interpolateStationAtS(rAlign, sRxr);
            // Diagonal X strokes (2.0m wide x 4.4m tall)
            builder.addQuad(
              'marking-white',
              'markings',
              rRoad.id,
              surfacePointAt(stNear, rRoad, laneMidLat - 0.95, 0.025),
              surfacePointAt(stNear, rRoad, laneMidLat - 0.65, 0.025),
              surfacePointAt(stFar, rRoad, laneMidLat + 0.95, 0.025),
              surfacePointAt(stFar, rRoad, laneMidLat + 0.65, 0.025),
              [0, 0], [1, 0], [1, 1], [0, 1],
              [1, 1, 1, 1],
              false
            );
            builder.addQuad(
              'marking-white',
              'markings',
              rRoad.id,
              surfacePointAt(stNear, rRoad, laneMidLat + 0.65, 0.025),
              surfacePointAt(stNear, rRoad, laneMidLat + 0.95, 0.025),
              surfacePointAt(stFar, rRoad, laneMidLat - 0.65, 0.025),
              surfacePointAt(stFar, rRoad, laneMidLat - 0.95, 0.025),
              [0, 0], [1, 0], [1, 1], [0, 1],
              [1, 1, 1, 1],
              false
            );
            // Flanking Left & Right "R" Stencil Bars
            for (const rSide of [-1, 1]) {
              const rLat = laneMidLat + rSide * 1.25;
              const stR0 = interpolateStationAtS(rAlign, sRxr - 0.85);
              const stR1 = interpolateStationAtS(rAlign, sRxr + 0.85);
              builder.addQuad(
                'marking-white',
                'markings',
                rRoad.id,
                surfacePointAt(stR0, rRoad, rLat - 0.22, 0.025),
                surfacePointAt(stR0, rRoad, rLat + 0.22, 0.025),
                surfacePointAt(stR1, rRoad, rLat + 0.22, 0.025),
                surfacePointAt(stR1, rRoad, rLat - 0.22, 0.025),
                [0, 0], [1, 0], [1, 1], [0, 1],
                [1, 1, 1, 1],
                false
              );
            }
            // W10-1 Yellow Round Advance Warning Sign on right sidewalk
            const signBase = [
              stMidRxr.p[0] + stMidRxr.n[0] * (-dirSign * (rHw + 0.95)),
              stMidRxr.p[1],
              stMidRxr.p[2] + stMidRxr.n[2] * (-dirSign * (rHw + 0.95)),
            ];
            builder.addCylinder('steel-galvanized', 'railways', rail.id, signBase, add(signBase, [0, 2.5, 0]), 0.05, 0.045, 6);
            builder.addBox('marking-yellow', 'railways', rail.id, add(signBase, [0, 2.35, 0]), 0.78, 0.78, 0.06, stMidRxr.d);
          }
        }
      }

      // 4c. Active Grade Crossing Masts, R15-1 Crossbuck Blades, Cantilevered Flashing Red LEDs & Striped Boom Gates
      const stCross = cross.railSt;
      for (const side of [-1, 1]) {
        const gateBase = [
          stCross.p[0] + stCross.n[0] * side * (ballastHalfW + 1.4) + stCross.d[0] * side * (cross.roadHw + 0.85),
          stCross.p[1],
          stCross.p[2] + stCross.n[2] * side * (ballastHalfW + 1.4) + stCross.d[2] * side * (cross.roadHw + 0.85),
        ];
        // Galvanized Signal Mast
        builder.addCylinder('steel-galvanized', 'railways', rail.id, gateBase, add(gateBase, [0, 4.4, 0]), 0.11, 0.085, 8);
        // R15-1 Crossbuck (two 1.2m white blades crossed at 90 deg near top of mast)
        const cbCenter = add(gateBase, [0, 3.55, 0]);
        builder.addBox('marking-white', 'railways', rail.id, cbCenter, 1.22, 0.22, 0.05, stCross.d);
        builder.addBox('marking-white', 'railways', rail.id, cbCenter, 0.22, 1.15, 0.05, stCross.d);
        // Twin Flashing Red Signal Lamps
        builder.addBox('emissive-red', 'railways', rail.id, add(gateBase, [0, 2.65, 0]), 0.75, 0.28, 0.26, stCross.d);
        // Overhead Cantilever Arm over traffic lanes
        const cantTip = madd(add(gateBase, [0, 4.25, 0]), stCross.d, -side * Math.min(5.5, cross.roadHw * 0.75));
        builder.addCylinder('steel-galvanized', 'railways', rail.id, add(gateBase, [0, 4.25, 0]), cantTip, 0.075, 0.06, 6);
        builder.addBox('emissive-red', 'railways', rail.id, cantTip, 0.68, 0.26, 0.24, stCross.d);

        // Red/White Striped Automatic Boom Gate Arm extending across the approaching road lanes
        const boomLen = Math.min(7.2, cross.roadHw * 0.95);
        const segCount = 6;
        const boomStart = add(gateBase, [0, 1.12, 0]);
        for (let seg = 0; seg < segCount; seg++) {
          const aPt = madd(boomStart, stCross.d, -side * (seg / segCount) * boomLen);
          const bPt = madd(boomStart, stCross.d, -side * ((seg + 1) / segCount) * boomLen);
          const segMat = seg % 2 === 0 ? 'emissive-red' : 'marking-white';
          builder.addCylinder(segMat, 'railways', rail.id, aPt, bPt, 0.058, 0.048, 6);
        }
      }
    }

    const stMid = align.stations[Math.floor(align.stations.length / 2)];
    builder.pickables.push({
      kind: 'railway',
      id: rail.id,
      name: rail.name || 'Mainline Double-Track Railway',
      center: [...stMid.p],
      radius: 10.0,
      alignment: align,
      trackOffsets,
    });
  }

  // B. Underground Subway System (Street Entrance Pavilion + Cutaway Subterranean Tube & Platform)
  const subways = project.subways || [];
  for (const subw of subways) {
    if (subw.enabled === false) continue;
    const p0 = subw.start || [-95, -6.2, 22];
    const p3 = subw.end || [95, -6.2, 22];
    const dummyMap = new Map([
      ['ss', { id: 'ss', position: p0 }],
      ['se', { id: 'se', position: p3 }],
    ]);
    const align = sampleRoadAlignment({ id: subw.id, start: 'ss', end: 'se' }, dummyMap, 2.5);
    const tubeHalfW = 4.8;
    const tubeH = 4.2;

    // Subterranean Cutaway Tunnel Box & Trackbed (at Y = -6.2m) + Street-Level Viewing Cutaway Trench
    const floorGrid = [];
    const backWallGrid = [];
    const platformGrid = [];

    for (let i = 0; i < align.stations.length; i++) {
      const st = align.stations[i];
      const fL = [st.p[0] - st.n[0] * tubeHalfW, st.p[1], st.p[2] - st.n[2] * tubeHalfW];
      const fR = [st.p[0] + st.n[0] * tubeHalfW, st.p[1], st.p[2] + st.n[2] * tubeHalfW];
      floorGrid.push([
        { p: fL, uv: [0, st.s * 0.2] },
        { p: fR, uv: [1, st.s * 0.2] },
      ]);

      const wBot = [...fL];
      const wTop = [fL[0], st.p[1] + tubeH, fL[2]];
      backWallGrid.push([
        { p: wBot, uv: [0, st.s * 0.2] },
        { p: wTop, uv: [1, st.s * 0.2] },
      ]);

      // Subway Station Platform along central 46m section
      if (Math.abs(st.s - align.length * 0.5) < 23.0) {
        const plIn = [st.p[0] - st.n[0] * 1.65, st.p[1] + 0.95, st.p[2] - st.n[2] * 1.65];
        const plOut = [st.p[0] - st.n[0] * tubeHalfW, st.p[1] + 0.95, st.p[2] - st.n[2] * tubeHalfW];
        platformGrid.push([
          { p: plOut, uv: [0, st.s * 0.3] },
          { p: plIn, uv: [1, st.s * 0.3] },
        ]);
      }
    }

    builder.addQuadGrid('railway-ballast', 'subways', subw.id, floorGrid, false, true);
    builder.addQuadGrid('concrete-structure', 'subways', subw.id, backWallGrid, false, true);
    if (platformGrid.length >= 2) {
      builder.addQuadGrid('paving-terrazzo', 'subways', subw.id, platformGrid, false, true);
    }

    // Subway steel rails & third rail
    for (const rLat of [-0.72, 0.72, 1.35]) {
      const rGrid = [];
      for (const st of align.stations) {
        rGrid.push([
          { p: [st.p[0] + st.n[0] * (rLat - 0.05), st.p[1] + 0.14, st.p[2] + st.n[2] * (rLat - 0.05)], uv: [0, st.s] },
          { p: [st.p[0] + st.n[0] * (rLat + 0.05), st.p[1] + 0.14, st.p[2] + st.n[2] * (rLat + 0.05)], uv: [1, st.s] },
        ]);
      }
      builder.addQuadGrid('steel-galvanized', 'subways', subw.id, rGrid, false, false);
    }

    // Street-level Glass & Steel Subway Entrance Headhouse + Staircase
    const stMid = align.stations[Math.floor(align.stations.length / 2)];
    const entranceCenter = [
      stMid.p[0] - stMid.n[0] * (tubeHalfW + 2.8),
      0,
      stMid.p[2] - stMid.n[2] * (tubeHalfW + 2.8),
    ];
    // Glass Canopy Frame & Sign
    builder.addBox('steel-weathered', 'subways', subw.id, add(entranceCenter, [0, 2.55, 0]), 3.4, 0.18, 6.2, stMid.d);
    builder.addBox('glass-tinted', 'subways', subw.id, add(entranceCenter, [0, 1.3, 0]), 3.2, 2.3, 5.8, stMid.d);
    builder.addBox('emissive-cyan', 'subways', subw.id, madd(add(entranceCenter, [0, 2.75, 0]), stMid.d, 3.05), 2.8, 0.42, 0.16, stMid.d);

    builder.pickables.push({
      kind: 'subway',
      id: subw.id,
      name: subw.name || 'Underground Metro Subway & Station',
      center: [...entranceCenter],
      radius: 9.0,
      alignment: align,
    });
  }
}

/**
 * 6. Guardrails & Railings (7 Distinct High-Detail Designs) + Bollards (6 Distinct Designs)
 */
export function buildGuardrailsAndBollardsQuads(road, alignment, trimStart, trimEnd, builder, project) {
  const s0 = trimStart + 1.2;
  const s1 = alignment.length - trimEnd - 1.2;
  if (s1 - s0 < 5.0) return;

  const totalHw = getRoadTotalHalfWidth(road);
  const hw = getRoadCarriagewayHalfWidth(road);
  const cw = road.curbWidth ?? 0.18;
  const ch = road.curbHeight ?? 0.145;

  // A. Guardrails & Railings (7 Designs: w-beam, thrie-beam, jersey, box-beam, cable, balustrade, parapet)
  if (road.guardrails) {
    const style = road.railStyle || 'w-beam';
    const postSpacing = road.postSpacing || 3.8;
    const railH = road.railHeight || 0.82;
    const steps = Math.max(6, Math.ceil((s1 - s0) / 2.2));

    for (const side of [-1, 1]) {
      const railLat = side * (totalHw - 0.12);

      if (style === 'w-beam' || style === 'thrie-beam') {
        // Corrugated W-Beam or Thrie-Beam swept profile (Multi-strip Quads!)
        const waves = style === 'thrie-beam' ? 3 : 2;
        const profPts = waves === 3
          ? [[0, 0.42], [-0.07, 0.49], [0, 0.56], [-0.07, 0.63], [0, 0.70], [-0.07, 0.77], [0, 0.84]]
          : [[0, 0.48], [-0.08, 0.56], [0, 0.65], [-0.08, 0.74], [0, 0.82]];

        const railGrid = [];
        for (let i = 0; i <= steps; i++) {
          const s = lerp(s0, s1, i / steps);
          const st = interpolateStationAtS(alignment, s);
          const base = [st.p[0] + st.n[0] * railLat, st.p[1] + ch, st.p[2] + st.n[2] * railLat];
          const row = profPts.map(([dLat, dy], idx) => ({
            p: [base[0] + st.n[0] * side * dLat, base[1] + dy * (railH / 0.82), base[2] + st.n[2] * side * dLat],
            uv: [idx / (profPts.length - 1), s * 0.5],
          }));
          railGrid.push(row);
        }
        builder.addQuadGrid('steel-galvanized', 'guardrails', road.id, railGrid, side === -1, true);
      } else if (style === 'jersey') {
        // Precast F-Shape Concrete Jersey Barrier
        const jProf = [
          [-0.28, 0],
          [-0.28, 0.08],
          [-0.14, 0.34],
          [-0.10, 0.92],
          [0.10, 0.92],
          [0.14, 0.34],
          [0.28, 0.08],
          [0.28, 0],
        ];
        const jGrid = [];
        for (let i = 0; i <= steps; i++) {
          const s = lerp(s0, s1, i / steps);
          const st = interpolateStationAtS(alignment, s);
          const base = [st.p[0] + st.n[0] * railLat, st.p[1] + ch, st.p[2] + st.n[2] * railLat];
          jGrid.push(
            jProf.map(([dLat, dy], idx) => ({
              p: [base[0] + st.n[0] * dLat, base[1] + dy, base[2] + st.n[2] * dLat],
              uv: [idx / (jProf.length - 1), s * 0.3],
            }))
          );
        }
        builder.addQuadGrid('concrete-structure', 'guardrails', road.id, jGrid, false, true);
      } else if (style === 'box-beam' || style === 'parapet' || style === 'balustrade') {
        // Continuous top & middle structural rails
        for (const hFrac of style === 'parapet' ? [0.35, 0.98] : [0.48, 0.92]) {
          for (let i = 0; i < steps; i++) {
            const sa = lerp(s0, s1, i / steps);
            const sb = lerp(s0, s1, (i + 1) / steps);
            const stMid = interpolateStationAtS(alignment, 0.5 * (sa + sb));
            const rPos = [
              stMid.p[0] + stMid.n[0] * railLat,
              stMid.p[1] + ch + railH * hFrac,
              stMid.p[2] + stMid.n[2] * railLat,
            ];
            builder.addBox(
              style === 'parapet' ? 'concrete-structure' : 'steel-galvanized',
              'guardrails',
              road.id,
              rPos,
              style === 'parapet' ? 0.32 : 0.14,
              style === 'parapet' && hFrac < 0.5 ? 0.55 : 0.12,
              sb - sa,
              stMid.d
            );
          }
        }
      } else if (style === 'cable') {
        // Four-Cable Tension Safety Barrier
        for (const cH of [0.38, 0.52, 0.66, 0.80]) {
          for (let i = 0; i < steps; i++) {
            const sa = lerp(s0, s1, i / steps);
            const sb = lerp(s0, s1, (i + 1) / steps);
            const stA = interpolateStationAtS(alignment, sa);
            const stB = interpolateStationAtS(alignment, sb);
            builder.addCylinder(
              'steel-galvanized',
              'guardrails',
              road.id,
              [stA.p[0] + stA.n[0] * railLat, stA.p[1] + ch + cH, stA.p[2] + stA.n[2] * railLat],
              [stB.p[0] + stB.n[0] * railLat, stB.p[1] + ch + cH, stB.p[2] + stB.n[2] * railLat],
              0.018,
              0.018,
              6,
              [0.82, 0.84, 0.86, 1],
              false
            );
          }
        }
      }

      // Vertical Support Posts / Balustrade Pickets along the guardrail run
      if (style !== 'jersey') {
        const pStep = style === 'balustrade' ? 1.2 : postSpacing;
        for (let s = s0; s <= s1; s += pStep) {
          const st = interpolateStationAtS(alignment, s);
          const pPos = [
            st.p[0] + st.n[0] * (railLat + side * 0.08),
            st.p[1] + ch + railH * 0.48,
            st.p[2] + st.n[2] * (railLat + side * 0.08),
          ];
          builder.addBox('steel-weathered', 'guardrails', road.id, pPos, 0.11, railH * 0.96, 0.14, st.d);
        }
      }
    }
  }

  // B. Bollards (6 Distinct Designs: heritage, stainless, mitre, security, flexible, illuminated)
  if (road.bollards !== false && road.roadClass !== 'highway') {
    const bStyle = road.bollardStyle || 'heritage';
    const bSpacing = road.bollardSpacing || 9.5;
    for (const side of [-1, 1]) {
      const bLat = side * (hw + cw + 0.36);
      for (let s = s0 + 2.5; s <= s1 - 2.5; s += bSpacing) {
        const st = interpolateStationAtS(alignment, s);
        const baseP = [st.p[0] + st.n[0] * bLat, st.p[1] + ch, st.p[2] + st.n[2] * bLat];
        buildSingleBollardQuads(builder, baseP, st.d, bStyle, road.id);
      }
    }
  }
}

export function buildSingleBollardQuads(builder, baseP, dir, style = 'heritage', ownerId = 'scene') {
  if (style === 'heritage') {
    // Cast-Iron Heritage Fluted Bollard (plinth + tapered fluted column + ornamental ring + dome cap)
    builder.addCylinder('steel-weathered', 'furniture', ownerId, baseP, add(baseP, [0, 0.18, 0]), 0.14, 0.115, 10, [0.22, 0.23, 0.25, 1], false);
    builder.addCylinder('steel-weathered', 'furniture', ownerId, add(baseP, [0, 0.18, 0]), add(baseP, [0, 0.84, 0]), 0.105, 0.088, 10, [0.25, 0.26, 0.28, 1], false);
    builder.addCylinder('steel-weathered', 'furniture', ownerId, add(baseP, [0, 0.84, 0]), add(baseP, [0, 0.98, 0]), 0.102, 0.035, 10, [0.28, 0.29, 0.31, 1], true);
  } else if (style === 'stainless') {
    // Brushed Stainless Cylinder with glowing cyan/white LED top ring
    builder.addCylinder('steel-galvanized', 'furniture', ownerId, baseP, add(baseP, [0, 0.82, 0]), 0.11, 0.11, 12, [0.85, 0.87, 0.9, 1], false);
    builder.addCylinder('emissive-cyan', 'furniture', ownerId, add(baseP, [0, 0.82, 0]), add(baseP, [0, 0.89, 0]), 0.105, 0.105, 12, [0.7, 0.95, 1, 1], false);
    builder.addCylinder('steel-galvanized', 'furniture', ownerId, add(baseP, [0, 0.89, 0]), add(baseP, [0, 0.98, 0]), 0.11, 0.08, 12, [0.88, 0.9, 0.92, 1], true);
  } else if (style === 'mitre') {
    // Modern Sloped Mitre-Top Architectural Bollard
    builder.addBox('steel-weathered', 'furniture', ownerId, add(baseP, [0, 0.48, 0]), 0.19, 0.96, 0.19, dir, [0.32, 0.34, 0.37, 1]);
    builder.addBox('marking-white', 'furniture', ownerId, add(baseP, [0, 0.78, 0]), 0.20, 0.09, 0.20, dir);
  } else if (style === 'security') {
    // Heavy Anti-Ram Security Bollard with yellow/black hazard collars
    builder.addCylinder('asphalt-wearing', 'furniture', ownerId, baseP, add(baseP, [0, 1.05, 0]), 0.165, 0.165, 12, [0.2, 0.2, 0.22, 1], true);
    builder.addCylinder('marking-yellow', 'furniture', ownerId, add(baseP, [0, 0.65, 0]), add(baseP, [0, 0.88, 0]), 0.17, 0.17, 12, [1, 0.82, 0.1, 1], false);
  } else if (style === 'flexible') {
    // Flexible Spring-Loaded Polyurethane Traffic Post with dual white collars
    builder.addCylinder('asphalt-wearing', 'furniture', ownerId, baseP, add(baseP, [0, 0.08, 0]), 0.15, 0.12, 8);
    builder.addCylinder('construction-orange', 'furniture', ownerId, add(baseP, [0, 0.08, 0]), add(baseP, [0, 0.95, 0]), 0.068, 0.065, 10);
    builder.addCylinder('marking-white', 'furniture', ownerId, add(baseP, [0, 0.68, 0]), add(baseP, [0, 0.84, 0]), 0.072, 0.072, 10);
  } else {
    // Illuminated Smart Plaza Bollard
    builder.addCylinder('steel-weathered', 'furniture', ownerId, baseP, add(baseP, [0, 0.64, 0]), 0.115, 0.115, 12);
    builder.addCylinder('emissive-warm', 'furniture', ownerId, add(baseP, [0, 0.64, 0]), add(baseP, [0, 0.92, 0]), 0.10, 0.10, 12);
    builder.addCylinder('steel-weathered', 'furniture', ownerId, add(baseP, [0, 0.92, 0]), add(baseP, [0, 0.99, 0]), 0.12, 0.12, 12, [0.25, 0.26, 0.28, 1], true);
  }
}

/**
 * 7. Streetlights, Highway Gantries, Billboards, Traffic Signals & Autonomous Robots
 */
export function buildStreetlightsAndBillboardsQuads(road, alignment, trimStart, trimEnd, builder, project) {
  const s0 = trimStart + 4.0;
  const s1 = alignment.length - trimEnd - 4.0;
  if (s1 - s0 < 10.0) return;

  const hw = getRoadCarriagewayHalfWidth(road);
  const cw = road.curbWidth ?? 0.18;
  const ch = road.curbHeight ?? 0.145;
  const sw = road.sidewalkWidth ?? 3.6;

  // A. Streetlights (Cobra-head, Twin Boulevard, or Heritage)
  if (road.streetlights !== false) {
    const lSpacing = road.lightSpacing || 24.0;
    const poleH = road.roadClass === 'highway' ? 9.2 : 7.4;
    for (let s = s0 + 4.0; s <= s1 - 4.0; s += lSpacing) {
      const st = interpolateStationAtS(alignment, s);
      for (const side of [-1, 1]) {
        const pLat = side * (hw + cw + Math.min(0.65, sw * 0.35));
        const base = [st.p[0] + st.n[0] * pLat, st.p[1] + ch, st.p[2] + st.n[2] * pLat];
        const top = add(base, [0, poleH, 0]);
        // Tapered octagonal steel pole
        builder.addCylinder('steel-weathered', 'furniture', road.id, base, top, 0.11, 0.065, 8);
        // Outreach davit arm reaching over the carriageway
        const armTip = [
          top[0] - st.n[0] * side * 2.15,
          top[1] + 0.35,
          top[2] - st.n[2] * side * 2.15,
        ];
        builder.addCylinder('steel-weathered', 'furniture', road.id, add(top, [0, -0.25, 0]), armTip, 0.055, 0.04, 6);
        // Cobra-head luminaire housing + warm LED emitter quad underneath
        builder.addBox('steel-galvanized', 'furniture', road.id, armTip, 0.42, 0.14, 0.82, st.n);
        builder.addBox('emissive-warm', 'furniture', road.id, add(armTip, [0, -0.07, 0]), 0.34, 0.04, 0.68, st.n);
      }
    }
  }

  // B. Overhead Highway Gantry & Roadside Monopole Digital Billboards
  if (road.billboards && s1 - s0 > 26.0) {
    const midS = 0.5 * (s0 + s1);
    const st = interpolateStationAtS(alignment, midS);
    const totalHw = getRoadTotalHalfWidth(road);

    // 1. Overhead Truss Highway Sign Gantry across the road
    const gSpan = (hw + cw + 0.9) * 2.0;
    const gHeight = 6.4;
    for (const side of [-1, 1]) {
      const colPos = [
        st.p[0] + st.n[0] * side * (gSpan * 0.5),
        st.p[1] + gHeight * 0.5,
        st.p[2] + st.n[2] * side * (gSpan * 0.5),
      ];
      builder.addBox('steel-galvanized', 'furniture', road.id, colPos, 0.36, gHeight, 0.36, st.d);
    }
    builder.addBox(
      'steel-galvanized',
      'furniture',
      road.id,
      [st.p[0], st.p[1] + gHeight - 0.25, st.p[2]],
      gSpan + 0.4,
      0.55,
      0.55,
      st.d
    );
    // Green Highway Directional Sign Boards with white reflective border
    builder.addBox(
      'billboard-highway',
      'furniture',
      road.id,
      madd([st.p[0], st.p[1] + gHeight - 0.1, st.p[2]], st.d, 0.35),
      Math.min(gSpan * 0.72, 11.5),
      2.35,
      0.14,
      st.d
    );

    // 2. Roadside Monopole Large-Format Digital LED Billboard outside sidewalk
    const bbLat = totalHw + 4.2;
    const bbBase = [st.p[0] + st.n[0] * bbLat, st.p[1], st.p[2] + st.n[2] * bbLat];
    builder.addCylinder('steel-weathered', 'furniture', road.id, bbBase, add(bbBase, [0, 8.8, 0]), 0.42, 0.34, 12);
    // Billboard Cabinet + Catwalk + Illuminated Display Face
    const bbHead = add(bbBase, [0, 10.6, 0]);
    builder.addBox('steel-weathered', 'furniture', road.id, bbHead, 8.6, 4.2, 0.55, st.d);
    builder.addBox('billboard-led', 'furniture', road.id, madd(bbHead, st.d, -0.31), 8.2, 3.85, 0.08, st.d);
    builder.addBox('billboard-led', 'furniture', road.id, madd(bbHead, st.d, 0.31), 8.2, 3.85, 0.08, st.d);
  }
}

/**
 * 8. Autonomous Robots (6-Wheel Sidewalk Delivery Rovers & Construction Surveyor Bots)
 */
export function buildAutonomousRobotQuads(builder, pos, forwardDir, kind = 'delivery-rover', ownerId = 'robots') {
  const f = normXZ(forwardDir);
  const r = rightXZ(f);
  const chassisCenter = add(pos, [0, 0.34, 0]);

  if (kind === 'construction-bot') {
    // Tracked Autonomous Construction / Road-Scanning Robot
    builder.addBox('marking-yellow', 'robots', ownerId, chassisCenter, 0.92, 0.38, 1.28, f);
    builder.addBox('asphalt-wearing', 'robots', ownerId, madd(chassisCenter, r, -0.48), 0.18, 0.28, 1.32, f);
    builder.addBox('asphalt-wearing', 'robots', ownerId, madd(chassisCenter, r, 0.48), 0.18, 0.28, 1.32, f);
    // Articulated laser/radar mast + LiDAR puck
    builder.addCylinder('steel-galvanized', 'robots', ownerId, add(chassisCenter, [0, 0.19, 0]), add(chassisCenter, [0, 0.72, 0]), 0.08, 0.06, 8);
    builder.addCylinder('emissive-amber', 'robots', ownerId, add(chassisCenter, [0, 0.72, 0]), add(chassisCenter, [0, 0.86, 0]), 0.14, 0.14, 10);
  } else {
    // 6-Wheeled Sidewalk Delivery Rover
    builder.addBox('marking-white', 'robots', ownerId, chassisCenter, 0.66, 0.36, 0.88, f);
    builder.addBox('asphalt-wearing', 'robots', ownerId, add(chassisCenter, [0, 0.2, 0]), 0.58, 0.08, 0.78, f);
    // Glowing cyan visor eyes on front
    builder.addBox('emissive-cyan', 'robots', ownerId, madd(add(chassisCenter, [0, 0.06, 0]), f, 0.45), 0.46, 0.09, 0.04, f);
    // Flag/LiDAR mast
    builder.addCylinder('construction-orange', 'robots', ownerId, add(chassisCenter, [-0.22, 0.2, -0.28]), add(chassisCenter, [-0.22, 0.95, -0.28]), 0.02, 0.015, 6);
    // 6 wheels (3 per side)
    for (const sSide of [-1, 1]) {
      for (const zOff of [-0.3, 0, 0.3]) {
        const wCenter = add(madd(madd(pos, r, sSide * 0.36), f, zOff), [0, 0.14, 0]);
        builder.addBox('asphalt-wearing', 'robots', ownerId, wCenter, 0.09, 0.26, 0.26, f);
      }
    }
  }
}

/**
 * 9. City Blocks & Paving Plazas (Strictly NO Buildings — Perimeter Curbs, Multi-Bond Paving, Tree Pits & Parking Courts)
 */
export function buildCityBlocksAndPavingQuads(project, builder) {
  const blocks = project.cityBlocks || [];
  for (const blk of blocks) {
    if (blk.enabled === false) continue;
    const cx = blk.position[0];
    const cy = blk.position[1] || 0;
    const cz = blk.position[2];
    const w = blk.width || 44;
    const d = blk.depth || 36;
    const rot = ((blk.rotation || 0) * Math.PI) / 180;
    const fwd = [Math.sin(rot), 0, Math.cos(rot)];
    const right = rightXZ(fwd);

    const pt = (lx, ly, lz) => [
      cx + right[0] * lx + fwd[0] * lz,
      cy + ly,
      cz + right[2] * lx + fwd[2] * lz,
    ];

    const ch = 0.15;
    const borderW = blk.borderWidth || 4.8;
    const patternMat = `paving-${blk.pavingPattern || 'munich-hex'}`;
    const innerMat = `paving-${blk.innerPattern || 'ashlar'}`;

    // 1. Raised Granite Curb Perimeter Plinth (4 sides as clean Quads)
    const hw = w * 0.5;
    const hd = d * 0.5;
    const cornersOut = [pt(-hw, ch, -hd), pt(hw, ch, -hd), pt(hw, ch, hd), pt(-hw, ch, hd)];
    const cornersBot = [pt(-hw, 0, -hd), pt(hw, 0, -hd), pt(hw, 0, hd), pt(-hw, 0, hd)];
    const cornersIn = [
      pt(-(hw - borderW), ch + 0.02, -(hd - borderW)),
      pt(hw - borderW, ch + 0.02, -(hd - borderW)),
      pt(hw - borderW, ch + 0.02, hd - borderW),
      pt(-(hw - borderW), ch + 0.02, hd - borderW),
    ];

    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const edgeLen = distXZ(cornersOut[i], cornersOut[next]);
      // Vertical granite curb face
      builder.addQuad(
        'curb-granite',
        'blocks',
        blk.id,
        cornersBot[i],
        cornersBot[next],
        cornersOut[next],
        cornersOut[i],
        [0, 0], [edgeLen * 0.5, 0], [edgeLen * 0.5, 1], [0, 1],
        [1, 1, 1, 1],
        true
      );
      // Perimeter Paving Band Quad
      builder.addQuad(
        patternMat,
        'blocks',
        blk.id,
        cornersOut[i],
        cornersOut[next],
        cornersIn[next],
        cornersIn[i],
        [0, 0], [edgeLen * 0.35, 0], [edgeLen * 0.35, borderW * 0.35], [0, borderW * 0.35],
        [1, 1, 1, 1],
        true
      );
    }

    // 2. Inner Plaza Paving Grid (Subdivided Quad Grid — Strictly NO Buildings!)
    const gridN = 6;
    const innerGrid = [];
    const iw = hw - borderW;
    const id = hd - borderW;
    for (let rz = 0; rz <= gridN; rz++) {
      const row = [];
      const zVal = lerp(-id, id, rz / gridN);
      for (let cxIdx = 0; cxIdx <= gridN; cxIdx++) {
        const xVal = lerp(-iw, iw, cxIdx / gridN);
        row.push({
          p: pt(xVal, ch + 0.02, zVal),
          uv: [(xVal + iw) * 0.3, (zVal + id) * 0.3],
        });
      }
      innerGrid.push(row);
    }
    builder.addQuadGrid(innerMat, 'blocks', blk.id, innerGrid, false, true);

    // 3. Recessed Empty Tree-Planting Soil Pits & Cast-Iron Grates (No Trees/Buildings)
    if (blk.plantingPits !== false) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pitC = pt(sx * (hw - borderW * 0.5), ch + 0.025, sz * (hd - borderW * 0.5));
          builder.addBox('curb-granite', 'blocks', blk.id, pitC, 1.85, 0.06, 1.85, fwd);
          builder.addBox('pothole-subbase', 'blocks', blk.id, add(pitC, [0, 0.02, 0]), 1.55, 0.04, 1.55, fwd, [0.36, 0.3, 0.24, 1]);
        }
      }
    }

    // 4. Perimeter Plaza Bollards
    if (blk.bollards !== false) {
      for (let x = -hw + 4; x <= hw - 4; x += 8) {
        buildSingleBollardQuads(builder, pt(x, ch, -hd + 0.45), fwd, blk.bollardStyle || 'illuminated', blk.id);
        buildSingleBollardQuads(builder, pt(x, ch, hd - 0.45), fwd, blk.bollardStyle || 'illuminated', blk.id);
      }
    }

    builder.pickables.push({
      kind: 'block',
      id: blk.id,
      name: blk.name || 'Urban Paving Block (No Buildings)',
      center: [cx, cy + ch, cz],
      radius: Math.max(w, d) * 0.45,
    });
  }
}
