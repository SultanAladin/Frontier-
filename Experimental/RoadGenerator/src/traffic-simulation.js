// Frontier Road Generator Studio — High-Detail AI Traffic (<= 25 Vehicles), Trains, Subway & Sidewalk Robots

import {
  add,
  sub,
  scale,
  madd,
  lerp,
  lerp3,
  clamp,
  normXZ,
  rightXZ,
  distXZ,
  interpolateStationAtS,
} from './math-splines.js';
import { QuadMeshBuilder, getRoadCarriagewayHalfWidth } from './quad-topology.js';
import { surfacePointAt, buildAutonomousRobotQuads } from './infrastructure-builders.js';

export const MAX_AI_VEHICLES = 25;

const VEHICLE_ARCHETYPES = [
  { kind: 'sedan', name: 'Executive Sedan', length: 4.75, width: 1.92, height: 1.44, speed: 13.5, paint: 'vehicle-cobalt' },
  { kind: 'fastback', name: 'GT Sport Fastback', length: 4.62, width: 1.96, height: 1.36, speed: 15.5, paint: 'vehicle-crimson' },
  { kind: 'suv', name: 'Metropolitan SUV', length: 4.95, width: 2.04, height: 1.74, speed: 12.5, paint: 'vehicle-silver' },
  { kind: 'bus', name: 'Transit City Bus', length: 11.4, width: 2.52, height: 3.05, speed: 9.8, paint: 'vehicle-amber' },
  { kind: 'truck', name: 'Heavy Hauler Truck', length: 8.6, width: 2.46, height: 3.15, speed: 10.2, paint: 'vehicle-slate' },
  { kind: 'van', name: 'Autonomous Mobility Shuttle', length: 5.2, width: 2.08, height: 2.15, speed: 11.2, paint: 'vehicle-pearl' },
];

export class TrafficSimulator {
  constructor() {
    this.vehicles = [];
    this.trains = [];
    this.subwayTrains = [];
    this.robots = [];
    this.time = 0;
  }

  syncFleet(project, alignmentsMap) {
    const requestedCount = clamp(project.trafficCount ?? 18, 0, MAX_AI_VEHICLES);
    const validRoads = project.roads.filter((r) => alignmentsMap.has(r.id) && alignmentsMap.get(r.id).length > 16);
    if (!validRoads.length) {
      this.vehicles = [];
      return;
    }

    while (this.vehicles.length > requestedCount) {
      this.vehicles.pop();
    }

    while (this.vehicles.length < requestedCount) {
      const idx = this.vehicles.length;
      const road = validRoads[idx % validRoads.length];
      const align = alignmentsMap.get(road.id);
      const arch = VEHICLE_ARCHETYPES[idx % VEHICLE_ARCHETYPES.length];
      const lanes = road.lanes || 2;
      const laneIdx = idx % lanes;
      const isForward = road.oneWay ? true : laneIdx >= lanes / 2;
      const frac = ((idx * 0.29 + 0.13) % 0.82) + 0.09;

      this.vehicles.push({
        id: `veh-${idx + 1}`,
        archetype: arch,
        roadId: road.id,
        laneIdx,
        direction: isForward ? 1 : -1,
        s: frac * align.length,
        speed: arch.speed,
        currentSpeed: arch.speed,
        braking: false,
        wheelAngle: 0,
      });
    }

    // Re-validate road assignments if any road was deleted or split
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!alignmentsMap.has(v.roadId)) {
        const fallback = validRoads[i % validRoads.length];
        v.roadId = fallback.id;
        v.s = alignmentsMap.get(fallback.id).length * 0.5;
      }
    }
  }

  step(dt, project, alignmentsMap) {
    const clampedDt = clamp(dt, 0.001, 0.08);
    this.time += clampedDt;
    this.syncFleet(project, alignmentsMap);

    const roadsMap = new Map(project.roads.map((r) => [r.id, r]));
    const speedBumps = project.speedBumps || [];
    const constructionZones = project.constructionZones || [];

    for (const v of this.vehicles) {
      const road = roadsMap.get(v.roadId);
      const align = alignmentsMap.get(v.roadId);
      if (!road || !align) continue;

      let targetSpeed = v.archetype.speed * (road.roadClass === 'highway' ? 1.35 : 1.0);
      v.braking = false;

      // 1. Slow down smoothly for Speed Bumps & Active Construction Zones
      for (const bump of speedBumps) {
        if (bump.enabled !== false && bump.roadId === v.roadId) {
          const distToBump = (bump.station - v.s) * v.direction;
          if (distToBump > -2 && distToBump < 14) {
            targetSpeed = Math.min(targetSpeed, 5.2);
            if (distToBump > 1.5) v.braking = true;
          }
        }
      }
      for (const cz of constructionZones) {
        if (cz.enabled !== false && cz.roadId === v.roadId) {
          const distToCz = Math.abs(cz.station - v.s);
          if (distToCz < (cz.length || 24) * 0.65 + 10) {
            targetSpeed = Math.min(targetSpeed, 6.0);
            v.braking = true;
          }
        }
      }

      // 2. Intelligent Car-Following (IDM headway check against vehicles on same road & direction)
      for (const other of this.vehicles) {
        if (other === v || other.roadId !== v.roadId || other.direction !== v.direction) continue;
        const otherLaneSame = (other.laneIdx % 2) === (v.laneIdx % 2);
        if (!otherLaneSame) continue;
        const gap = (other.s - v.s) * v.direction - (v.archetype.length + other.archetype.length) * 0.5;
        if (gap > 0 && gap < 16.0) {
          targetSpeed = Math.min(targetSpeed, other.currentSpeed * clamp((gap - 3.5) / 12.5, 0, 1));
          if (gap < 11.0) v.braking = true;
        }
      }

      v.currentSpeed = lerp(v.currentSpeed, targetSpeed, clamp(clampedDt * 4.5, 0, 1));
      v.s += v.currentSpeed * v.direction * clampedDt;
      v.wheelAngle += v.currentSpeed * clampedDt * 2.8;

      // 3. Transition smoothly across merged intersections onto connected road arms!
      if (v.s >= align.length - 2.0 || v.s <= 2.0) {
        const reachedNodeId = v.direction === 1 ? road.end : road.start;
        const candidates = project.roads.filter(
          (r) => r.id !== road.id && (r.start === reachedNodeId || r.end === reachedNodeId) && alignmentsMap.has(r.id)
        );
        if (candidates.length > 0) {
          // Deterministically pick a connected arm at the merged intersection
          const pickIdx = Math.abs(Math.floor(this.time * 1.7 + parseInt(v.id.slice(4), 10))) % candidates.length;
          const nextRoad = candidates[pickIdx];
          const nextAlign = alignmentsMap.get(nextRoad.id);
          const enteringAtStart = nextRoad.start === reachedNodeId;
          v.roadId = nextRoad.id;
          v.direction = nextRoad.oneWay ? 1 : enteringAtStart ? 1 : -1;
          v.s = v.direction === 1 ? 2.5 : nextAlign.length - 2.5;
          const nextLanes = nextRoad.lanes || 2;
          v.laneIdx = v.direction === 1
            ? Math.min(nextLanes - 1, Math.floor(nextLanes / 2) + (v.laneIdx % Math.max(1, Math.floor(nextLanes / 2))))
            : v.laneIdx % Math.max(1, Math.floor(nextLanes / 2));
        } else {
          // U-turn at dead end
          v.direction *= -1;
          const lanes = road.lanes || 2;
          v.laneIdx = v.direction === 1 ? Math.floor(lanes / 2) : 0;
          v.s = clamp(v.s, 2.5, align.length - 2.5);
        }
      }
    }
  }

  /**
   * Build high-detail multi-part Quad meshes for all active AI Vehicles (<=25),
   * Express Railway Trains, Underground Subway Trains, and Sidewalk Delivery Robots!
   */
  buildDynamicFleetQuads(project, alignmentsMap) {
    const builder = new QuadMeshBuilder();
    const roadsMap = new Map(project.roads.map((r) => [r.id, r]));

    // 1. Build AI Vehicles (Strictly <= 25)
    if (project.layers?.traffic !== false) {
      for (const v of this.vehicles.slice(0, MAX_AI_VEHICLES)) {
        const road = roadsMap.get(v.roadId);
        const align = alignmentsMap.get(v.roadId);
        if (!road || !align) continue;

        const st = interpolateStationAtS(align, clamp(v.s, 0.5, align.length - 0.5));
        const lanes = road.lanes || 2;
        const laneW = road.laneWidth || 3.5;
        const medianW = road.medianWidth || 0;
        const travelHalfW = (lanes * laneW + medianW) * 0.5;
        const isRightHalf = v.direction === 1;
        const laneInHalf = v.laneIdx % Math.max(1, Math.floor(lanes / 2));
        const lat = road.oneWay
          ? -travelHalfW + ( (v.laneIdx % lanes) + 0.5 ) * laneW
          : isRightHalf
            ? medianW * 0.5 + (laneInHalf + 0.5) * laneW
            : -(medianW * 0.5 + (laneInHalf + 0.5) * laneW);

        // Shift laterally around active construction zones on the same side
        let constructionShift = 0;
        for (const cz of project.constructionZones || []) {
          if (cz.enabled !== false && cz.roadId === road.id) {
            const ds = Math.abs(v.s - cz.station);
            if (ds < (cz.length || 24) * 0.65) {
              constructionShift = (cz.side === 'left' ? 1 : -1) * 1.45;
            }
          }
        }

        const pos = surfacePointAt(st, road, lat + constructionShift, 0.02);
        const fwd = v.direction === 1 ? st.d : scale(st.d, -1);
        buildDetailedVehicleQuadMesh(builder, pos, fwd, v.archetype, v.braking, v.id);
      }
    }

    // 2. Build Moving Express Commuter Train on Mainline Railway
    if (project.layers?.railways !== false) {
      for (const rail of project.railways || []) {
        if (rail.enabled === false || rail.trains === false) continue;
        const dummyMap = new Map([
          ['rs', { id: 'rs', position: rail.start || [-110, 0, -18] }],
          ['re', { id: 're', position: rail.end || [110, 0, 18] }],
        ]);
        const align = alignmentsMap.get(rail.id) || {
          stations: [
            { s: 0, p: rail.start || [-110, 0, -18], d: [1, 0, 0], n: [0, 0, 1] },
            { s: 220, p: rail.end || [110, 0, 18], d: [1, 0, 0], n: [0, 0, 1] },
          ],
          length: distXZ(rail.start || [-110, 0, -18], rail.end || [110, 0, 18]),
        };
        const trainSpeed = rail.trainSpeed ?? 22.0;
        const cycleLen = align.length + 55.0;
        const headS = ((this.time * trainSpeed) % cycleLen) - 15.0;
        const trackOff = rail.tracks === 2 ? 2.1 : 0;
        buildArticulatedTrainQuadMesh(builder, align, headS, trackOff, 4, 'express-train', rail.id);
      }
    }

    // 3. Build Moving Underground Metro Subway Train
    if (project.layers?.subways !== false) {
      for (const subw of project.subways || []) {
        if (subw.enabled === false) continue;
        const align = alignmentsMap.get(subw.id);
        if (!align) continue;
        const speed = 16.5;
        const cycleLen = align.length + 40.0;
        const headS = ((this.time * speed + 35) % cycleLen) - 10.0;
        buildArticulatedTrainQuadMesh(builder, align, headS, 0, 3, 'subway-metro', subw.id);
      }
    }

    // 4. Build Autonomous Sidewalk Delivery Rovers along urban roads
    if (project.layers?.robots !== false) {
      const urbanRoads = project.roads.filter((r) => r.roadClass !== 'highway' && alignmentsMap.has(r.id));
      for (let i = 0; i < Math.min(6, urbanRoads.length * 2); i++) {
        const road = urbanRoads[i % urbanRoads.length];
        const align = alignmentsMap.get(road.id);
        const side = i % 2 === 0 ? 1 : -1;
        const hw = getRoadCarriagewayHalfWidth(road);
        const cw = road.curbWidth ?? 0.18;
        const ch = road.curbHeight ?? 0.145;
        const sw = road.sidewalkWidth ?? 3.6;
        if (sw < 1.2) continue;
        const botS = ((this.time * 2.2 + i * 19.0) % Math.max(10, align.length - 12)) + 6.0;
        const st = interpolateStationAtS(align, botS);
        const lat = side * (hw + cw + sw * 0.55);
        const pos = [
          st.p[0] + st.n[0] * lat,
          st.p[1] + ch + 0.03,
          st.p[2] + st.n[2] * lat,
        ];
        buildAutonomousRobotQuads(builder, pos, side === 1 ? st.d : scale(st.d, -1), 'delivery-rover', `rover-${i}`);
      }
    }

    return builder;
  }
}

/**
 * High-Detail Sculpted Multi-Section Quad Mesh for an AI Vehicle
 * (Curved hood/roof/fastback profile, cabin glass, pillars, side mirrors, 4 alloy wheels, headlamps & brake bar)
 */
export function buildDetailedVehicleQuadMesh(builder, basePos, fwdDir, arch, braking, ownerId) {
  const f = normXZ(fwdDir);
  const r = rightXZ(f);
  const L = arch.length;
  const W = arch.width;
  const H = arch.height;
  const hw = W * 0.5;
  const hl = L * 0.5;

  const pt = (lx, ly, lz) => [
    basePos[0] + r[0] * lx + f[0] * lz,
    basePos[1] + ly,
    basePos[2] + r[2] * lx + f[2] * lz,
  ];

  // 1. Multi-station sculpted longitudinal quad body shell (8 stations from rear bumper to front splitter)
  const isBoxy = arch.kind === 'bus' || arch.kind === 'truck';
  const profileStations = isBoxy
    ? [
        [-hl, 0.28, 0.92],
        [-hl, H * 0.62, 0.98],
        [-hl * 0.94, H, 0.94],
        [hl * 0.86, H, 0.94],
        [hl * 0.98, H * 0.58, 0.96],
        [hl, 0.26, 0.92],
      ]
    : [
        [-hl, 0.26, 0.88],
        [-hl * 0.96, H * 0.58, 0.96],
        [-hl * 0.62, H * 0.66, 0.95],
        [-hl * 0.28, H, 0.84],
        [hl * 0.16, H * 0.98, 0.84],
        [hl * 0.46, H * 0.62, 0.96],
        [hl * 0.94, H * 0.46, 0.92],
        [hl, 0.22, 0.86],
      ];

  const bodyGrid = [];
  for (let i = 0; i < profileStations.length; i++) {
    const [zOff, yTop, wScale] = profileStations[i];
    const wCur = hw * wScale;
    const yBelt = Math.min(yTop - 0.04, H * 0.54);
    const ySkirt = 0.22;
    bodyGrid.push([
      { p: pt(-hw * 0.96, ySkirt, zOff), uv: [0, i * 0.25] },
      { p: pt(-wCur, yBelt, zOff), uv: [0.25, i * 0.25] },
      { p: pt(-wCur * 0.86, yTop, zOff), uv: [0.42, i * 0.25] },
      { p: pt(wCur * 0.86, yTop, zOff), uv: [0.58, i * 0.25] },
      { p: pt(wCur, yBelt, zOff), uv: [0.75, i * 0.25] },
      { p: pt(hw * 0.96, ySkirt, zOff), uv: [1.0, i * 0.25] },
    ]);
  }
  builder.addQuadGrid(arch.paint, 'traffic', ownerId, bodyGrid, false, true);

  // 2. Flush Tinted Cabin Windshield & Side Greenhouse Glass Quads
  if (!isBoxy) {
    const ws0 = pt(-hw * 0.78, H * 0.63, hl * 0.44);
    const ws1 = pt(hw * 0.78, H * 0.63, hl * 0.44);
    const ws2 = pt(hw * 0.72, H * 0.96, hl * 0.14);
    const ws3 = pt(-hw * 0.72, H * 0.96, hl * 0.14);
    builder.addQuad('glass-tinted', 'traffic', ownerId, ws0, ws1, ws2, ws3, [0, 0], [1, 0], [1, 1], [0, 1]);

    const rw0 = pt(hw * 0.74, H * 0.65, -hl * 0.60);
    const rw1 = pt(-hw * 0.74, H * 0.65, -hl * 0.60);
    const rw2 = pt(-hw * 0.70, H * 0.96, -hl * 0.28);
    const rw3 = pt(hw * 0.70, H * 0.96, -hl * 0.28);
    builder.addQuad('glass-tinted', 'traffic', ownerId, rw0, rw1, rw2, rw3, [0, 0], [1, 0], [1, 1], [0, 1]);
  } else {
    // Large Panoramic Bus/Truck Front Windshield
    builder.addBox('glass-tinted', 'traffic', ownerId, pt(0, H * 0.72, hl * 0.94), W * 0.88, H * 0.36, 0.14, f);
  }

  // 3. Twin LED Headlamps (Front) & Wide Red LED Taillight / Brake Light Bar (Rear)
  for (const side of [-1, 1]) {
    builder.addBox(
      'emissive-warm',
      'traffic',
      ownerId,
      pt(side * hw * 0.68, 0.48, hl * 0.97),
      0.34,
      0.13,
      0.08,
      f
    );
    // Side wing mirrors
    builder.addBox(
      arch.paint,
      'traffic',
      ownerId,
      pt(side * (hw + 0.09), H * 0.62, hl * 0.28),
      0.18,
      0.11,
      0.14,
      f
    );
  }
  builder.addBox(
    braking ? 'emissive-red' : 'bus-lane-red',
    'traffic',
    ownerId,
    pt(0, 0.56, -hl * 0.98),
    W * 0.82,
    0.14,
    0.08,
    f
  );

  // 4. Four 3D Cylindrical Tires + Alloy Wheel Hubs
  const wheelRadius = isBoxy ? 0.46 : 0.34;
  const wheelWidth = isBoxy ? 0.28 : 0.24;
  const axleFront = hl * 0.62;
  const axleRear = -hl * 0.62;
  for (const zAxle of [axleFront, axleRear]) {
    for (const side of [-1, 1]) {
      const wIn = pt(side * (hw - wheelWidth * 0.85), wheelRadius, zAxle);
      const wOut = pt(side * (hw + 0.02), wheelRadius, zAxle);
      builder.addCylinder('asphalt-wearing', 'traffic', ownerId, wIn, wOut, wheelRadius, wheelRadius, 10, [0.15, 0.16, 0.17, 1], true);
      builder.addCylinder('steel-galvanized', 'traffic', ownerId, wIn, madd(wOut, r, side * 0.015), wheelRadius * 0.62, wheelRadius * 0.62, 8, [0.82, 0.85, 0.88, 1], true);
    }
  }
}

/**
 * Multi-Car Articulated Express Commuter Train or Underground Subway Train (Pure Quads)
 */
export function buildArticulatedTrainQuadMesh(builder, alignment, headS, lateralOffset, numCars = 4, kind = 'express-train', ownerId = 'train') {
  const carLength = kind === 'subway-metro' ? 14.5 : 17.5;
  const carGap = 0.85;
  const carWidth = kind === 'subway-metro' ? 2.75 : 2.95;
  const carHeight = kind === 'subway-metro' ? 3.35 : 3.75;
  const railTopLift = kind === 'subway-metro' ? 0.22 : 0.48;
  const layerId = kind === 'subway-metro' ? 'subways' : 'railways';
  const bodyMat = kind === 'subway-metro' ? 'steel-galvanized' : 'vehicle-pearl';
  const stripeMat = kind === 'subway-metro' ? 'emissive-cyan' : 'vehicle-cobalt';

  for (let c = 0; c < numCars; c++) {
    const centerS = headS - c * (carLength + carGap);
    if (centerS < 4 || centerS > alignment.length - 4) continue;

    const stFront = interpolateStationAtS(alignment, Math.min(alignment.length - 0.5, centerS + carLength * 0.35));
    const stRear = interpolateStationAtS(alignment, Math.max(0.5, centerS - carLength * 0.35));
    const stMid = interpolateStationAtS(alignment, centerS);
    const dir = normXZ(sub(stFront.p, stRear.p));
    const right = rightXZ(dir);

    const carBase = [
      stMid.p[0] + stMid.n[0] * lateralOffset,
      stMid.p[1] + railTopLift,
      stMid.p[2] + stMid.n[2] * lateralOffset,
    ];

    // Main Coach Shell Box + Tapered Roof Crown + Livery Stripe + Illuminated Windows
    builder.addBox(bodyMat, layerId, ownerId, add(carBase, [0, carHeight * 0.52, 0]), carWidth, carHeight * 0.84, carLength, dir);
    builder.addBox(stripeMat, layerId, ownerId, add(carBase, [0, carHeight * 0.38, 0]), carWidth + 0.04, 0.32, carLength * 0.98, dir);
    builder.addBox('glass-tinted', layerId, ownerId, add(carBase, [0, carHeight * 0.64, 0]), carWidth + 0.05, 0.72, carLength * 0.88, dir);

    // Lead Nose Cone & High-Beam Headlights on Car 0
    if (c === 0) {
      const nosePos = madd(add(carBase, [0, carHeight * 0.42, 0]), dir, carLength * 0.54);
      builder.addBox(bodyMat, layerId, ownerId, nosePos, carWidth * 0.88, carHeight * 0.62, 1.6, dir);
      builder.addBox('emissive-warm', layerId, ownerId, madd(nosePos, dir, 0.82), carWidth * 0.65, 0.24, 0.1, dir);
    }

    // Dual Bogie Wheel Trucks under coach
    for (const bogieZ of [-carLength * 0.34, carLength * 0.34]) {
      const bogiePos = madd(add(carBase, [0, 0.28, 0]), dir, bogieZ);
      builder.addBox('asphalt-wearing', layerId, ownerId, bogiePos, carWidth * 0.82, 0.44, 2.4, dir);
    }
  }
}
