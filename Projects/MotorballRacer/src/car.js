import * as THREE from "three";
import { clamp, lerp, damp } from "./mathUtils.js";

// ---------------------------------------------------------------------------------------------
// Low-poly compact-sedan racecar (silhouette modeled after a Nissan Sentra style 3-box sedan:
// short overhangs, upright greenhouse, simple sloped hood/trunk). Built entirely from primitive
// geometry so the prototype needs zero imported 3D assets.
// ---------------------------------------------------------------------------------------------

function tapered(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildBody(color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x131a20, roughness: 0.15, metalness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.6, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.25, metalness: 0.9 });
  const lightF = new THREE.MeshStandardMaterial({ color: 0xfff7d8, emissive: 0xffedaa, emissiveIntensity: 0.9 });
  const lightR = new THREE.MeshStandardMaterial({ color: 0x610b0b, emissive: 0x8a0f0f, emissiveIntensity: 0.7 });

  const CAR_LEN = 4.5;
  const CAR_WID = 1.78;
  const CAR_HEI = 1.42;
  const FLOOR = 0.34; // ride height of the chassis floor above ground

  // --- Lower body shell: boxy but with a sloped hood/trunk and a gentle front taper -----
  const bodyH = 0.7;
  const bodyGeo = new THREE.BoxGeometry(CAR_WID, bodyH, CAR_LEN, 1, 1, 3);
  tapered(bodyGeo, (v) => {
    const frontness = v.z / (CAR_LEN / 2); // -1 rear .. +1 front
    if (v.y > 0) {
      if (frontness > 0.32) {
        // hood: slopes down toward the front bumper
        const k = (frontness - 0.32) / 0.68;
        v.y -= k * 0.34;
      } else if (frontness < -0.4) {
        // trunk: slight downward slope toward the rear bumper
        const k = (-frontness - 0.4) / 0.6;
        v.y -= k * 0.22;
      }
    }
    // taper the extreme front/rear corners inward slightly (bumper rounding, low-poly facets)
    if (frontness > 0.85) v.x *= 0.86;
    if (frontness < -0.85) v.x *= 0.9;
  });
  const body = new THREE.Mesh(bodyGeo, paint);
  body.position.y = FLOOR + bodyH / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // --- Greenhouse / cabin with raked windshield + rear glass -----------------------------
  const cabinW = CAR_WID * 0.86;
  const cabinH = 0.5;
  const cabinL = 2.15;
  const cabinGeo = new THREE.BoxGeometry(cabinW, cabinH, cabinL, 1, 1, 2);
  tapered(cabinGeo, (v) => {
    if (v.y > 0) {
      v.x *= 0.82; // narrower roof than base (fastback taper)
      if (v.z > 0) {
        v.z -= 0.5; // windshield rake: pull the top-front edge rearward
        v.y -= 0.05;
      } else {
        v.z += 0.36; // rear glass rake: pull the top-rear edge forward
        v.y -= 0.03;
      }
    }
  });
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, FLOOR + bodyH + cabinH / 2 - 0.06, -0.18);
  cabin.castShadow = true;
  group.add(cabin);

  // Roof panel (paint colored strip) sitting on top of the glass cabin box, slightly inset,
  // so the greenhouse doesn't read as a single glass block.
  const roofGeo = new THREE.BoxGeometry(cabinW * 0.94, 0.1, cabinL * 0.62);
  const roof = new THREE.Mesh(roofGeo, paint);
  roof.position.set(0, cabin.position.y + cabinH / 2 - 0.02, cabin.position.z - 0.05);
  group.add(roof);

  // --- Front bumper / grille / headlights -------------------------------------------------
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(CAR_WID * 0.98, 0.34, 0.28), trim);
  bumperF.position.set(0, FLOOR + 0.24, CAR_LEN / 2 - 0.05);
  group.add(bumperF);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(CAR_WID * 0.5, 0.22, 0.06), trim);
  grille.position.set(0, FLOOR + 0.62, CAR_LEN / 2 + 0.02);
  group.add(grille);

  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), lightF);
    hl.position.set(side * (CAR_WID / 2 - 0.28), FLOOR + 0.58, CAR_LEN / 2 + 0.03);
    group.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightR);
    tl.position.set(side * (CAR_WID / 2 - 0.3), FLOOR + 0.66, -CAR_LEN / 2 - 0.02);
    group.add(tl);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.22), paint);
    mirror.position.set(side * (cabinW / 2 + 0.06), cabin.position.y + 0.02, cabin.position.z + 0.55);
    group.add(mirror);
  }

  // --- Rear bumper + license plate ---------------------------------------------------------
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(CAR_WID * 0.98, 0.32, 0.26), trim);
  bumperR.position.set(0, FLOOR + 0.24, -CAR_LEN / 2 + 0.04);
  group.add(bumperR);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.02), chrome);
  plate.position.set(0, FLOOR + 0.28, -CAR_LEN / 2 - 0.02);
  group.add(plate);

  // --- Side sills + door seams (thin trim strips for a bit of low-poly surface detail) ---
  for (const side of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, CAR_LEN * 0.7), trim);
    sill.position.set(side * (CAR_WID / 2 - 0.01), FLOOR + 0.12, 0);
    group.add(sill);
  }

  group.userData.dims = { CAR_LEN, CAR_WID, CAR_HEI, FLOOR };
  return group;
}

function buildWheel() {
  const g = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.3, metalness: 0.85 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.26, 6), rimMat);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.045, 0.045), rimMat);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    g.add(spoke);
  }
  return g;
}

export function buildLowPolyCar(color = 0xc21f2b) {
  const root = new THREE.Group();
  root.name = "RacecarSentra";
  const body = buildBody(color);
  root.add(body);

  const { CAR_LEN, CAR_WID, FLOOR } = body.userData.dims;
  const wheelY = FLOOR;
  const trackHalf = CAR_WID / 2 - 0.05;
  const wheelBaseHalf = CAR_LEN / 2 - 0.78;

  const wheelPositions = {
    FL: new THREE.Vector3(-trackHalf, wheelY, wheelBaseHalf),
    FR: new THREE.Vector3(trackHalf, wheelY, wheelBaseHalf),
    RL: new THREE.Vector3(-trackHalf, wheelY, -wheelBaseHalf),
    RR: new THREE.Vector3(trackHalf, wheelY, -wheelBaseHalf),
  };

  const wheels = {};
  const steerGroups = {};
  for (const key of Object.keys(wheelPositions)) {
    const steerGroup = new THREE.Group();
    steerGroup.position.copy(wheelPositions[key]);
    const wheel = buildWheel();
    steerGroup.add(wheel);
    root.add(steerGroup);
    wheels[key] = wheel;
    steerGroups[key] = steerGroup;
  }

  root.userData.wheels = wheels;
  root.userData.steerGroups = steerGroups;
  root.userData.dims = body.userData.dims;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Arcade car controller: heading + velocity-with-grip model, driven by a track height/frame API
// (see trackBuilder.js). Produces fun, controllable handling without a full rigid-body solver.
// ---------------------------------------------------------------------------------------------
export class CarController {
  constructor(trackApi, mesh) {
    this.track = trackApi;
    this.mesh = mesh;
    const p = trackApi.startPose;
    this.pos = new THREE.Vector3(p.x, p.y, p.z);
    this.heading = p.heading;
    this.velocity = new THREE.Vector3();
    this.speed = 0; // signed scalar along heading, for HUD / gearing
    this.steerAngle = 0;
    this.airborne = false;
    this.vy = 0;
    this.hintIndex = -1;
    this.simTime = 0; // seconds, accumulated from physics dt (decoupled from wall clock on purpose)
    this.lapCount = 1;
    this.lapStartTime = 0;
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.prevS = 0;
    this.wheelSpin = 0;
    this.crashCooldown = 0;

    // tunables
    this.maxSpeed = 46; // [m/s] top speed ~166 km/h
    this.reverseMax = 9;
    this.enginePower = 26;
    this.brakePower = 46;
    this.dragCoef = 0.6;
    this.rollingResist = 3.2;
    this.maxSteer = THREE.MathUtils.degToRad(27);
    this.maxYawRate = THREE.MathUtils.degToRad(95); // hard cap so full-lock digital steering can't spin the car
    this.wheelBase = this.mesh.userData.dims.CAR_LEN * 0.62;
    this.gravity = -24;
    this.carHalfWidth = this.mesh.userData.dims.CAR_WID / 2;
  }

  reset() {
    const p = this.track.startPose;
    this.pos.set(p.x, p.y, p.z);
    this.heading = p.heading;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.airborne = false;
    this.vy = 0;
    this.hintIndex = -1;
    this.lapStartTime = this.simTime;
  }

  update(dt, input) {
    dt = Math.min(dt, 1 / 30);
    this.simTime += dt;
    const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const handbrake = !!input.handbrake;

    // --- longitudinal dynamics ---
    const forwardSpeed = this.speed;
    let accel = 0;
    if (throttle > 0) {
      accel = this.enginePower * throttle * (1 - Math.max(0, forwardSpeed) / (this.maxSpeed * 1.15));
    } else if (throttle < 0) {
      if (forwardSpeed > 0.5) accel = -this.brakePower * -throttle;
      else accel = -this.enginePower * 0.55 * -throttle * (1 - Math.max(0, -forwardSpeed) / this.reverseMax);
    }
    const drag = -Math.sign(forwardSpeed) * this.dragCoef * forwardSpeed * forwardSpeed * 0.02;
    const rolling = -Math.sign(forwardSpeed) * this.rollingResist;
    let newSpeed = forwardSpeed + (accel + drag + rolling) * dt;
    if (Math.abs(newSpeed) < 0.04 && throttle === 0) newSpeed = 0;
    newSpeed = clamp(newSpeed, -this.reverseMax, this.maxSpeed);
    this.speed = newSpeed;

    // --- steering / heading ---
    const speedFactor = clamp(1 - Math.abs(this.speed) / (this.maxSpeed * 1.35), 0.25, 1);
    const targetSteer = steerInput * this.maxSteer * speedFactor;
    this.steerAngle = damp(this.steerAngle, targetSteer, 7, dt);
    const dirSign = this.speed >= 0 ? 1 : -1;
    let yawRate = (this.speed / Math.max(this.wheelBase, 0.5)) * Math.tan(this.steerAngle) * dirSign;
    yawRate = clamp(yawRate, -this.maxYawRate, this.maxYawRate);
    this.heading += yawRate * dt;

    // --- velocity vector with grip blending (adds a bit of drift feel) ---
    const headingDir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const desiredVel = headingDir.clone().multiplyScalar(this.speed);
    const grip = handbrake ? 0.045 : 0.22;
    this.velocity.lerp(desiredVel, clamp(grip * (dt * 60), 0, 1));

    // --- integrate horizontal position ---
    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.z * dt;

    // --- query track surface ---
    const frame = this.track.frameAt(this.pos.x, this.pos.z, this.hintIndex);
    this.hintIndex = frame.idx;

    // --- wall collision (keeps the car on the drivable ribbon) ---
    const limit = frame.halfWidth - this.track.wallInset - this.carHalfWidth * 0.6;
    if (frame.u > limit) {
      const over = frame.u - limit;
      this.pos.x -= frame.right.x * over;
      this.pos.z -= frame.right.z * over;
      const vAlong = this.velocity.dot(frame.right);
      if (vAlong > 0) {
        this.velocity.addScaledVector(frame.right, -vAlong * 1.25);
        this.speed *= 0.82;
      }
    } else if (frame.u < -limit) {
      const over = -limit - frame.u;
      this.pos.x += frame.right.x * over;
      this.pos.z += frame.right.z * over;
      const vAlong = this.velocity.dot(frame.right);
      if (vAlong < 0) {
        this.velocity.addScaledVector(frame.right, -vAlong * 1.25);
        this.speed *= 0.82;
      }
    }

    // --- vertical dynamics: ground snapping, jump launch, gravity while airborne ---
    const groundY = frame.y + this.mesh.userData.dims.FLOOR;
    if (!this.airborne) {
      if (frame.isLaunch && Math.abs(this.speed) > 9) {
        this.airborne = true;
        this.vy = frame.launchStrength * Math.abs(this.speed) * 0.5 + 2.2;
      } else {
        this.pos.y = groundY;
        this.vy = 0;
      }
    }
    if (this.airborne) {
      this.vy += this.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.vy = 0;
        this.airborne = false;
      }
    }

    // --- lap timing: detect forward wrap across the start/finish arc-length origin ---
    const s = frame.s;
    if (this.prevS > this.track.totalLength * 0.82 && s < this.track.totalLength * 0.18) {
      const lapMs = (this.simTime - this.lapStartTime) * 1000;
      if (lapMs > 8000) {
        this.lastLapTime = lapMs;
        if (this.bestLapTime == null || lapMs < this.bestLapTime) this.bestLapTime = lapMs;
        this.lapCount += 1;
        this.lapStartTime = this.simTime;
      }
    }
    this.prevS = s;

    // --- orient the visual mesh: blend heading (yaw) with the track surface normal ---
    const normal = this.airborne ? new THREE.Vector3(0, 1, 0) : frame.normal;
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const rightV = new THREE.Vector3().crossVectors(normal, forward).normalize();
    const trueForward = new THREE.Vector3().crossVectors(rightV, normal).normalize();
    const m = new THREE.Matrix4().makeBasis(rightV, normal, trueForward);
    this.mesh.quaternion.setFromRotationMatrix(m);
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);

    // wheel roll + steering animation
    this.wheelSpin += (this.speed / 0.34) * dt;
    for (const key of ["FL", "FR", "RL", "RR"]) {
      const wheel = this.mesh.userData.wheels[key];
      wheel.rotation.x = this.wheelSpin;
      if (key === "FL" || key === "FR") {
        this.mesh.userData.steerGroups[key].rotation.y = this.steerAngle;
      }
    }

    return frame;
  }

  get speedKph() {
    return Math.abs(this.speed) * 3.6;
  }
}
