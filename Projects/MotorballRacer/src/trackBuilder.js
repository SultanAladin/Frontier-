import * as THREE from "three";
import { clamp, lerp, smoothstep, degToRad } from "./mathUtils.js";
import {
  asphaltTexture,
  hazardStripeTexture,
  checkerTexture,
  fenceAlphaTexture,
  metalPanelTexture,
  crowdTexture,
  groundTexture,
} from "./textures.js";

// ---------------------------------------------------------------------------------------------
// MOTORBALL SPEEDWAY — a wheeled-racecar redesign of the Alita: Battle Angel motorball arena.
//
// Source material read: the film's motorball track is a steel-and-concrete arena loop with
// heavily banked curved sections, hazard-striped barriers, chain-link crowd fencing, floodlight
// trusses, and the game famously "spilling out" of the stadium into underpass / sewage tunnels.
// This redesign keeps that industrial-arena DNA but reshapes the circuit purely for cars:
//   - Two big 16 degree banked speedway turns (instead of a skater loop) so racecars can carry
//     real cornering speed.
//   - A tabletop jump on the back straight (a motorball-style ramp gag, reworked so a car
//     launches cleanly instead of a void/gap that could strand a wheeled vehicle).
//   - A sunken tunnel dip under a stadium overpass on the front straight, echoing the movie's
//     race spilling into Iron City's underpasses.
//   - Hazard-striped crash barriers, chain-link fencing, floodlight trusses and bleachers with a
//     crowd texture, all around the loop.
// ---------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

export function buildTrack() {
  const group = new THREE.Group();
  group.name = "MotorballSpeedway";

  // ----- authored geometry constants ------------------------------------------------------
  const R = 52; // turn radius at centerline [m]
  const L = 150; // straight length [m]
  const BASE_HALF_WIDTH = 7.5; // [m]
  const TUNNEL_HALF_WIDTH = 5.4; // [m]
  const PEAK_BANK = degToRad(16);
  const WALL_HEIGHT = 1.15;
  const WALL_INSET = 0.35;

  const JUMP_CENTER_FRAC = 0.52;
  const JUMP_TOP_HALF = 6;
  const JUMP_RAMP_HALF = 11;
  const JUMP_HEIGHT = 3.4;

  const TUNNEL_CENTER_FRAC = 0.58;
  const TUNNEL_TOP_HALF = 9;
  const TUNNEL_RAMP_HALF = 15;
  const TUNNEL_DEPTH = 5.0;

  const segments = [
    { tag: "front", type: "straight", x: -R, z0: L / 2, z1: -L / 2, length: L },
    { tag: "turnB", type: "turn", cx: 0, cz: -L / 2, r: R, theta0: Math.PI, theta1: 2 * Math.PI, length: Math.PI * R },
    { tag: "back", type: "straight", x: R, z0: -L / 2, z1: L / 2, length: L },
    { tag: "turnA", type: "turn", cx: 0, cz: L / 2, r: R, theta0: 0, theta1: Math.PI, length: Math.PI * R },
  ];
  const segOffsets = [0];
  for (let i = 0; i < segments.length; i++) segOffsets.push(segOffsets[i] + segments[i].length);
  const TOTAL_LENGTH = segOffsets[segments.length];

  function trapezoid(dist, center, topHalf, rampHalf) {
    const d = Math.abs(dist - center);
    if (d <= topHalf) return 1;
    if (d >= topHalf + rampHalf) return 0;
    return 1 - smoothstep(topHalf, topHalf + rampHalf, d);
  }

  // Pure analytic evaluation of the track centerline at arbitrary arc-length s.
  function evalTrack(s) {
    s = ((s % TOTAL_LENGTH) + TOTAL_LENGTH) % TOTAL_LENGTH;
    let idx = segments.length - 1;
    for (let i = 0; i < segments.length; i++) {
      if (s < segOffsets[i + 1]) {
        idx = i;
        break;
      }
    }
    const seg = segments[idx];
    const dist = s - segOffsets[idx];
    const t = dist / seg.length;

    let x, z, tx, tz;
    if (seg.type === "straight") {
      x = seg.x;
      z = lerp(seg.z0, seg.z1, t);
      tx = 0;
      tz = Math.sign(seg.z1 - seg.z0);
    } else {
      const theta = lerp(seg.theta0, seg.theta1, t);
      x = seg.cx + seg.r * Math.cos(theta);
      z = seg.cz + seg.r * Math.sin(theta);
      const dir = Math.sign(seg.theta1 - seg.theta0);
      tx = -Math.sin(theta) * dir;
      tz = Math.cos(theta) * dir;
    }
    // Rotated +90° from tangent (not -90°) so that cross(right, tangent) points +Y: this keeps
    // the road/curb ribbon triangle winding front-facing (visible from above) with THREE's
    // default counter-clockwise front-face convention.
    const rx = -tz;
    const rz = tx;

    let outX, outZ;
    if (seg.type === "turn") {
      const ox = x - seg.cx;
      const oz = z - seg.cz;
      const ol = Math.hypot(ox, oz) || 1;
      outX = ox / ol;
      outZ = oz / ol;
    } else {
      outX = Math.sign(seg.x);
      outZ = 0;
    }

    let bank = 0;
    if (seg.type === "turn") {
      const ease = smoothstep(0, 0.16, t) * (1 - smoothstep(0.84, 1.0, t));
      const dotOutRight = outX * rx + outZ * rz;
      const sign = dotOutRight >= 0 ? 1 : -1;
      bank = PEAK_BANK * ease * sign;
    }

    let elevation = 0;
    let halfWidth = BASE_HALF_WIDTH;
    let jumpFactor = 0;
    let tunnelFactor = 0;
    if (seg.tag === "back") {
      jumpFactor = trapezoid(dist, seg.length * JUMP_CENTER_FRAC, JUMP_TOP_HALF, JUMP_RAMP_HALF);
      elevation = jumpFactor * JUMP_HEIGHT;
    } else if (seg.tag === "front") {
      tunnelFactor = trapezoid(dist, seg.length * TUNNEL_CENTER_FRAC, TUNNEL_TOP_HALF, TUNNEL_RAMP_HALF);
      elevation = -tunnelFactor * TUNNEL_DEPTH;
      halfWidth = lerp(BASE_HALF_WIDTH, TUNNEL_HALF_WIDTH, tunnelFactor);
    }

    // Pivot banked turns off the inside edge so the inner rail always meets ground level
    // instead of the whole cross-section rotating through the terrain.
    elevation += halfWidth * Math.tan(Math.abs(bank));

    return {
      x, z, tx, tz, rx, rz, outX, outZ, bank, elevation, halfWidth,
      tag: seg.tag, dist, segLength: seg.length, jumpFactor, tunnelFactor, s,
    };
  }

  // ----- discretize into dense samples used for physics + mesh construction --------------
  const N = 1800;
  const samples = {
    n: N,
    posX: new Float32Array(N), posZ: new Float32Array(N),
    tanX: new Float32Array(N), tanZ: new Float32Array(N),
    rightX: new Float32Array(N), rightZ: new Float32Array(N),
    outX: new Float32Array(N), outZ: new Float32Array(N),
    elevation: new Float32Array(N), bank: new Float32Array(N), halfWidth: new Float32Array(N),
    slope: new Float32Array(N), sArc: new Float32Array(N),
    normal: new Float32Array(N * 3),
    launchStrength: new Float32Array(N), isLaunch: new Uint8Array(N),
    tag: new Array(N),
    totalLength: TOTAL_LENGTH,
  };

  for (let i = 0; i < N; i++) {
    const s = (i / N) * TOTAL_LENGTH;
    const e = evalTrack(s);
    samples.posX[i] = e.x; samples.posZ[i] = e.z;
    samples.tanX[i] = e.tx; samples.tanZ[i] = e.tz;
    samples.rightX[i] = e.rx; samples.rightZ[i] = e.rz;
    samples.outX[i] = e.outX; samples.outZ[i] = e.outZ;
    samples.elevation[i] = e.elevation; samples.bank[i] = e.bank; samples.halfWidth[i] = e.halfWidth;
    samples.sArc[i] = s;
    samples.tag[i] = e.tag;
  }

  const EPS = 0.06;
  for (let i = 0; i < N; i++) {
    const s = samples.sArc[i];
    const e0 = evalTrack(s - EPS);
    const e1 = evalTrack(s + EPS);
    samples.slope[i] = (e1.elevation - e0.elevation) / (2 * EPS);
  }

  const tmpT = new THREE.Vector3();
  const tmpR = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    tmpT.set(samples.tanX[i], samples.slope[i], samples.tanZ[i]).normalize();
    tmpR.set(samples.rightX[i], 0, samples.rightZ[i])
      .multiplyScalar(Math.cos(samples.bank[i]))
      .addScaledVector(UP, Math.sin(samples.bank[i]))
      .normalize();
    tmpN.crossVectors(tmpR, tmpT).normalize();
    if (tmpN.y < 0) tmpN.multiplyScalar(-1);
    samples.normal[i * 3] = tmpN.x;
    samples.normal[i * 3 + 1] = tmpN.y;
    samples.normal[i * 3 + 2] = tmpN.z;
  }

  // launch trigger zone: right where the jump tabletop ends and the down-ramp begins
  const jumpDownDistCenter = L * JUMP_CENTER_FRAC + JUMP_TOP_HALF + JUMP_RAMP_HALF * 0.32;
  for (let i = 0; i < N; i++) {
    if (samples.tag[i] !== "back") continue;
    const seg = segments[2];
    const localS = samples.sArc[i] - segOffsets[2];
    const d = Math.abs(localS - jumpDownDistCenter);
    if (d < 4.2) {
      const strength = clamp(-samples.slope[i] * 1.55, 0, 3.4);
      samples.launchStrength[i] = strength;
      samples.isLaunch[i] = strength > 0.2 ? 1 : 0;
    }
  }

  // ----- nearest-sample lookup (used by car physics every frame) -------------------------
  function nearestIndex(x, z, hint) {
    let bestIdx = -1;
    let bestD = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = ((k % N) + N) % N;
        const dx = x - samples.posX[i];
        const dz = z - samples.posZ[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
    };
    if (hint != null && hint >= 0) {
      scan(hint - 45, hint + 45);
      if (bestD < 30 * 30) return bestIdx;
    }
    scan(0, N - 1);
    return bestIdx;
  }

  function frameAt(x, z, hint) {
    const idx = nearestIndex(x, z, hint);
    const dx = x - samples.posX[idx];
    const dz = z - samples.posZ[idx];
    const u = dx * samples.rightX[idx] + dz * samples.rightZ[idx];
    const y = samples.elevation[idx] + u * Math.tan(samples.bank[idx]);
    return {
      idx,
      u,
      y,
      halfWidth: samples.halfWidth[idx],
      bank: samples.bank[idx],
      s: samples.sArc[idx],
      normal: new THREE.Vector3(samples.normal[idx * 3], samples.normal[idx * 3 + 1], samples.normal[idx * 3 + 2]),
      tangent: new THREE.Vector3(samples.tanX[idx], 0, samples.tanZ[idx]),
      right: new THREE.Vector3(samples.rightX[idx], 0, samples.rightZ[idx]),
      isLaunch: samples.isLaunch[idx] === 1,
      launchStrength: samples.launchStrength[idx],
    };
  }

  // ---------------------------------------------------------------------------------------
  // MESH CONSTRUCTION — built from exactly the same sample arrays used by the physics so the
  // ground you see always matches the ground you drive on.
  // ---------------------------------------------------------------------------------------

  function edgePoint(i, side) {
    const hw = samples.halfWidth[i] * side;
    const x = samples.posX[i] + samples.rightX[i] * hw;
    const z = samples.posZ[i] + samples.rightZ[i] * hw;
    const y = samples.elevation[i] + hw * Math.tan(samples.bank[i]);
    return new THREE.Vector3(x, y, z);
  }

  // --- Road surface ---
  {
    const positions = [];
    const uvs = [];
    const indices = [];
    const lenScale = TOTAL_LENGTH / 6;
    for (let i = 0; i < N; i++) {
      const L0 = edgePoint(i, -1);
      const R0 = edgePoint(i, 1);
      positions.push(L0.x, L0.y, L0.z, R0.x, R0.y, R0.z);
      const v = (samples.sArc[i] / TOTAL_LENGTH) * lenScale;
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1;
      const ni = (i + 1) % N;
      const c = ni * 2, d = ni * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: asphaltTexture({ repeatX: 1, repeatY: 1 }),
      roughness: 0.95,
      metalness: 0.02,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    road.name = "RoadSurface";
    group.add(road);
  }

  // --- Curbs (red/white rumble strips just inside each edge) ---
  {
    const curbTex = checkerTexture("#d6302b", "#f2f2f2", 2);
    curbTex.wrapS = THREE.RepeatWrapping;
    curbTex.wrapT = THREE.RepeatWrapping;
    curbTex.repeat.set(1, TOTAL_LENGTH / 5);
    for (const side of [-1, 1]) {
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let i = 0; i < N; i++) {
        const outer = samples.halfWidth[i] * side;
        const inner = (samples.halfWidth[i] - 0.7) * side;
        for (const hw of [inner, outer]) {
          const x = samples.posX[i] + samples.rightX[i] * hw;
          const z = samples.posZ[i] + samples.rightZ[i] * hw;
          const y = samples.elevation[i] + hw * Math.tan(samples.bank[i]) + 0.015;
          positions.push(x, y, z);
        }
        uvs.push(0, i, 1, i);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1;
        const ni = (i + 1) % N;
        const c = ni * 2, d = ni * 2 + 1;
        indices.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8 }));
      mesh.name = "Curb" + side;
      group.add(mesh);
    }
  }

  // --- Crash barriers (hazard-striped walls following the banked surface normal) ---
  {
    const hazardTex = hazardStripeTexture();
    hazardTex.repeat.set(TOTAL_LENGTH / 8, 1);
    for (const side of [-1, 1]) {
      const positions = [];
      const uvs = [];
      const indices = [];
      const lenScale = TOTAL_LENGTH / 8;
      for (let i = 0; i < N; i++) {
        const base = edgePoint(i, side);
        const nrm = new THREE.Vector3(samples.normal[i * 3], samples.normal[i * 3 + 1], samples.normal[i * 3 + 2]);
        const top = base.clone().addScaledVector(nrm, WALL_HEIGHT);
        positions.push(base.x, base.y, base.z, top.x, top.y, top.z);
        const v = (samples.sArc[i] / TOTAL_LENGTH) * lenScale;
        uvs.push(v, 0, v, 1);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1;
        const ni = (i + 1) % N;
        const c = ni * 2, d = ni * 2 + 1;
        // wind so the outward face (away from track) receives the texture
        if (side > 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.name = "CrashBarrier" + side;
      group.add(mesh);
    }
  }

  // --- Chain-link fence above the outer barrier (motorball crowd-safety fencing) ---
  {
    const fenceTex = fenceAlphaTexture();
    const fenceHeight = 3.2;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < N; i += 1) {
      // only fence the outward side (bias toward +right or -right depending which is "outside")
      const side = samples.bank[i] !== 0 ? Math.sign(samples.bank[i]) : Math.sign(samples.outX[i] * samples.rightX[i] + samples.outZ[i] * samples.rightZ[i]) || 1;
      const base = edgePoint(i, side);
      const nrm = new THREE.Vector3(samples.normal[i * 3], samples.normal[i * 3 + 1], samples.normal[i * 3 + 2]);
      const bottom = base.clone().addScaledVector(nrm, WALL_HEIGHT);
      const top = base.clone().addScaledVector(nrm, WALL_HEIGHT + fenceHeight);
      positions.push(bottom.x, bottom.y, bottom.z, top.x, top.y, top.z);
      uvs.push(i, 0, i, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1;
      const ni = (i + 1) % N;
      const c = ni * 2, d = ni * 2 + 1;
      indices.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: fenceTex, alphaMap: fenceTex, transparent: true, side: THREE.DoubleSide,
      color: 0xaeb6bd, roughness: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "CrowdFence";
    group.add(mesh);
  }

  // --- Grandstands along both banked turns ---
  {
    const crowdTex = crowdTexture();
    const panelTex = metalPanelTexture("#484f57");
    function buildStand(sStart, sEnd, count) {
      const g = new THREE.Group();
      for (let k = 0; k <= count; k++) {
        const s = lerp(sStart, sEnd, k / count);
        const e = evalTrack(s);
        const outward = new THREE.Vector3(e.outX, 0, e.outZ);
        const offset = e.halfWidth + WALL_HEIGHT + 6.5;
        const cx = e.x + outward.x * offset;
        const cz = e.z + outward.z * offset;
        const standH = 9;
        const geo = new THREE.BoxGeometry(11, standH, 5.4);
        const mats = [
          new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 }),
          new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 }),
          new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }),
          new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.9 }),
          new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 }),
          new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 }),
        ];
        const box = new THREE.Mesh(geo, mats);
        box.position.set(cx, standH / 2 - 0.3, cz);
        box.lookAt(e.x, box.position.y, e.z);
        box.rotation.x = -0.18;
        box.castShadow = true;
        box.receiveShadow = true;
        g.add(box);
      }
      return g;
    }
    const off = segOffsets;
    group.add(buildStand(off[1] + 4, off[1] + segments[1].length - 4, 6)); // turnB stands
    group.add(buildStand(off[3] + 4, off[3] + segments[3].length - 4, 6)); // turnA stands
  }

  // --- Floodlight trusses around the loop ---
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.6 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2b8, emissiveIntensity: 1.6 });
    const NUM_LIGHTS = 14;
    for (let k = 0; k < NUM_LIGHTS; k++) {
      const s = (k / NUM_LIGHTS) * TOTAL_LENGTH;
      const e = evalTrack(s);
      const outward = new THREE.Vector3(e.outX, 0, e.outZ);
      const offset = e.halfWidth + 4.5;
      const px = e.x + outward.x * offset;
      const pz = e.z + outward.z * offset;
      const towerH = 13 + (k % 3);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, towerH, 8), poleMat);
      pole.position.set(px, towerH / 2, pz);
      pole.castShadow = true;
      group.add(pole);
      const lampGeo = new THREE.BoxGeometry(2.6, 1.1, 0.5);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(px + outward.x * -1.1, towerH + 0.2, pz + outward.z * -1.1);
      lamp.lookAt(e.x, towerH, e.z);
      group.add(lamp);
      if (k % 4 === 0) {
        const spot = new THREE.SpotLight(0xfff2d0, 220, 90, Math.PI / 5, 0.6, 1.4);
        spot.position.copy(lamp.position);
        spot.target.position.set(e.x, e.elevation, e.z);
        spot.castShadow = false;
        group.add(spot);
        group.add(spot.target);
      }
    }
  }

  // --- Tunnel overpass structure at the sunken dip on the front straight ---
  {
    const panelTex = metalPanelTexture("#31353b");
    const frontSeg = segments[0];
    const frontOff = segOffsets[0];
    const centerDist = frontSeg.length * TUNNEL_CENTER_FRAC;
    const sCenter = frontOff + centerDist;
    const e = evalTrack(sCenter);
    const span = TUNNEL_TOP_HALF * 2 + TUNNEL_RAMP_HALF * 0.9;
    const deckThickness = 2.4;
    const clearance = 5.0;
    const deckY = e.elevation + clearance;
    const tunnelWidth = e.halfWidth * 2 + 10;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(tunnelWidth, deckThickness, span),
      new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 })
    );
    deck.position.set(e.x, deckY + deckThickness / 2, e.z);
    deck.rotation.y = Math.atan2(e.tx, e.tz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7, metalness: 0.4 });
    for (const side of [-1, 1]) {
      const px = e.x + e.rx * (e.halfWidth + 2.2) * side;
      const pz = e.z + e.rz * (e.halfWidth + 2.2) * side;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, deckY, 3.2), pillarMat);
      pillar.position.set(px, deckY / 2, pz);
      pillar.rotation.y = deck.rotation.y;
      pillar.castShadow = true;
      group.add(pillar);
    }
    // hazard trim along the front edge of the overpass, echoing the barrier livery
    const trimTex = hazardStripeTexture();
    trimTex.repeat.set(tunnelWidth / 3, 1);
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(tunnelWidth, 0.5, 0.35),
      new THREE.MeshStandardMaterial({ map: trimTex })
    );
    trim.position.set(e.x - e.tx * span * 0.5, deckY - 0.3, e.z - e.tz * span * 0.5);
    trim.rotation.y = deck.rotation.y;
    group.add(trim);
    const trim2 = trim.clone();
    trim2.position.set(e.x + e.tx * span * 0.5, deckY - 0.3, e.z + e.tz * span * 0.5);
    group.add(trim2);
  }

  // --- Start / finish gantry on the front straight ---
  {
    const sStart = 6; // just after the front straight begins
    const e = evalTrack(sStart);
    const gantryGroup = new THREE.Group();
    const legMat = new THREE.MeshStandardMaterial({ color: 0x202327, metalness: 0.5, roughness: 0.5 });
    const legH = 8.5;
    const span = e.halfWidth * 2 + 3;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, legH, 0.9), legMat);
      leg.position.set(e.x + e.rx * (e.halfWidth + 1) * side, legH / 2, e.z + e.rz * (e.halfWidth + 1) * side);
      gantryGroup.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.1, 1.1), legMat);
    beam.position.set(e.x, legH, e.z);
    beam.rotation.y = Math.atan2(e.tx, e.tz) + Math.PI / 2;
    gantryGroup.add(beam);

    const checker = checkerTexture("#f4f4f4", "#101010", 8);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 0.94, 1.8),
      new THREE.MeshStandardMaterial({ map: checker, side: THREE.DoubleSide })
    );
    banner.position.set(e.x, legH - 1.2, e.z);
    banner.rotation.y = beam.rotation.y;
    gantryGroup.add(banner);

    group.add(gantryGroup);
  }

  // --- Infield monument: a low-poly nod to the motorball itself, off to the side of the track ---
  {
    const ballGroup = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.75, roughness: 0.35, flatShading: true })
    );
    ball.castShadow = true;
    ballGroup.add(ball);
    const spikeGeo = new THREE.ConeGeometry(0.28, 1.1, 5);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 10; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
      ).normalize();
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.copy(dir.clone().multiplyScalar(2.7));
      spike.lookAt(dir.clone().multiplyScalar(4.2));
      spike.rotateX(Math.PI / 2);
      ballGroup.add(spike);
    }
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.6, 1.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.8 })
    );
    pedestal.position.y = -3.2;
    ballGroup.add(pedestal);
    ballGroup.position.set(0, 4.6, 0);
    group.add(ballGroup);
  }

  // --- Ground terrain that gently follows the track profile (avoids clipping at the jump/tunnel) ---
  {
    const size = (R + L) * 1.35;
    const segs = 110;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const STRIDE = 3;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let bestD = Infinity, bestElev = 0, bestHW = BASE_HALF_WIDTH;
      for (let s = 0; s < N; s += STRIDE) {
        const dx = x - samples.posX[s];
        const dz = z - samples.posZ[s];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestElev = samples.elevation[s]; bestHW = samples.halfWidth[s]; }
      }
      const dist = Math.sqrt(bestD);
      const influence = bestHW + 30;
      const t = 1 - clamp((dist - bestHW) / influence, 0, 1);
      const eased = t * t * (3 - 2 * t);
      const y = lerp(0, bestElev - 0.45, eased);
      pos.setY(i, y);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.name = "Ground";
    group.add(ground);
  }

  // ----- public API used by the car controller and main scene -----------------------------
  const api = {
    totalLength: TOTAL_LENGTH,
    baseHalfWidth: BASE_HALF_WIDTH,
    wallInset: WALL_INSET,
    frameAt,
    nearestIndex,
    evalTrack,
    startPose: (() => {
      const e = evalTrack(2);
      return {
        x: e.x + e.rx * -2.6,
        z: e.z + e.rz * -2.6,
        heading: Math.atan2(e.tx, e.tz),
        y: e.elevation,
      };
    })(),
  };

  return { group, api };
}
