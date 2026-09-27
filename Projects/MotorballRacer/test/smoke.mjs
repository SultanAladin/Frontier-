// Headless smoke test (Node, no browser/WebGL needed): exercises the real track + car + physics
// modules to catch NaNs, degenerate geometry, and obviously-wrong track/physics behavior before
// relying on manual browser testing. Run with: node test/smoke.mjs

import * as THREE from "three";
import { clamp } from "../src/mathUtils.js";

// --- minimal DOM shim just so textures.js's canvas calls don't throw in Node ------------------
function fakeCtx() {
  return {
    fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fill() {}, arc() {}, save() {}, restore() {}, translate() {}, rotate() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillStyle: "", strokeStyle: "", lineWidth: 1,
  };
}
global.document = {
  createElement(tag) {
    if (tag === "canvas") {
      return { width: 0, height: 0, getContext: () => fakeCtx() };
    }
    throw new Error("unexpected createElement " + tag);
  },
};
global.window = { devicePixelRatio: 1 };

const { buildTrack } = await import("../src/trackBuilder.js");
const { buildLowPolyCar, CarController } = await import("../src/car.js");

let failures = 0;
function check(name, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok:   ${name}`);
  }
}

const { group, api } = buildTrack();
check("track group has children", group.children.length > 5);
check("total length is sane (300-1200m)", api.totalLength > 300 && api.totalLength < 1200);

// --- inspect all mesh geometries for NaN / Infinity vertices ---
let badVerts = 0;
let totalVerts = 0;
group.traverse((obj) => {
  if (obj.isMesh && obj.geometry && obj.geometry.attributes.position) {
    const pos = obj.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      totalVerts++;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) badVerts++;
    }
  }
});
check(`no NaN/Infinite vertices (checked ${totalVerts})`, badVerts === 0);
check("scene has a reasonable vertex budget (<400k)", totalVerts < 400000);

// --- sample the track frame all the way around and sanity check continuity ---
let minY = Infinity, maxY = -Infinity, minHW = Infinity, maxBankDeg = 0;
const N = 400;
let prev = null;
let maxJump = 0;
for (let i = 0; i <= N; i++) {
  const s = (i / N) * api.totalLength;
  const e = api.evalTrack(s);
  minY = Math.min(minY, e.elevation);
  maxY = Math.max(maxY, e.elevation);
  minHW = Math.min(minHW, e.halfWidth);
  maxBankDeg = Math.max(maxBankDeg, Math.abs(e.bank) * (180 / Math.PI));
  if (prev) {
    const d = Math.hypot(e.x - prev.x, e.z - prev.z);
    maxJump = Math.max(maxJump, d);
  }
  prev = e;
}
check("elevation range is sane (jump + tunnel present)", minY < -2 && maxY > 1);
check("min half-width stays positive and reasonable", minHW > 3);
check("peak bank angle near authored 16 degrees", maxBankDeg > 13 && maxBankDeg < 18);
check("centerline has no teleport discontinuities", maxJump < api.totalLength / N * 3);

// closing the loop: point at s=0 should equal point at s=totalLength (wrap)
const p0 = api.evalTrack(0);
const p1 = api.evalTrack(api.totalLength - 1e-6);
check("track loop closes (start ≈ end)", Math.hypot(p0.x - p1.x, p0.z - p1.z) < 1);

// --- nearestIndex / frameAt should locate points close to where we queried ---
{
  const e = api.evalTrack(123.4);
  const frame = api.frameAt(e.x, e.z, -1);
  check("frameAt finds itself with tiny lateral offset", Math.abs(frame.u) < 0.5);
  check("frameAt height matches evalTrack elevation at centerline", Math.abs(frame.y - e.elevation) < 0.5);
}

// --- car construction ---
const car = buildLowPolyCar(0xff0000);
let carVerts = 0, carBad = 0;
car.traverse((o) => {
  if (o.isMesh) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      carVerts++;
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) carBad++;
    }
  }
});
check("car has geometry", carVerts > 50);
check("car has no NaN vertices", carBad === 0);
check("car has 4 wheel steer groups", Object.keys(car.userData.steerGroups).length === 4);

const bbox = new THREE.Box3().setFromObject(car);
const size = new THREE.Vector3();
bbox.getSize(size);
check("car length is sedan-scale (3.8-5.2m)", size.z > 3.8 && size.z < 5.2);
check("car width is sedan-scale (1.5-2.0m)", size.x > 1.5 && size.x < 2.0);
check("car height is sedan-scale (1.1-1.7m)", size.y > 1.1 && size.y < 1.7);

// --- drive a simulated lap using a simple PD "stay near the centerline" autopilot, to check
// that the track is actually navigable end-to-end (walls, jump, tunnel, banking) without NaNs.
const controller = new CarController(api, car);
let maxSpeed = 0;
let wentAirborneAtLeastOnce = false;
let lapsCompleted = 0;
const dt = 1 / 60;
let steer = 0;
let prevU = 0;
for (let step = 0; step < 60 * 90; step++) { // 90 simulated seconds
  const input = { forward: true, back: false, left: steer < -0.15, right: steer > 0.15, handbrake: false };
  const frame = controller.update(dt, input);
  const du = (frame.u - prevU) / dt;
  prevU = frame.u;
  steer = clamp(0.03 * frame.u + 0.45 * du, -1, 1);
  maxSpeed = Math.max(maxSpeed, Math.abs(controller.speed));
  if (controller.airborne) wentAirborneAtLeastOnce = true;
  if (!Number.isFinite(controller.pos.x) || !Number.isFinite(controller.pos.y) || !Number.isFinite(controller.pos.z)) {
    failures++;
    console.error(`FAIL: car position became non-finite at step ${step}`);
    break;
  }
}
lapsCompleted = controller.lapCount - 1;
check("car reaches meaningful speed under throttle", maxSpeed > 15);
check("car completes at least one lap in 90s sim", lapsCompleted >= 1);
check("car goes airborne on the jump at some point", wentAirborneAtLeastOnce);
check("car position stays within a reasonable radius of track", Math.hypot(controller.pos.x, controller.pos.z) < 300);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
