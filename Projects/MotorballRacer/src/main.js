import * as THREE from "three";
import { buildTrack } from "./trackBuilder.js";
import { buildLowPolyCar, CarController } from "./car.js";
import { createInput } from "./input.js";
import { damp, clamp } from "./mathUtils.js";

const app = document.getElementById("app");

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db8c9);
scene.fog = new THREE.Fog(0x9db8c9, 140, 520);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

// --- lighting: overcast industrial arena sky ------------------------------------------------
const hemi = new THREE.HemisphereLight(0xcfe0ee, 0x2a2a26, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d8, 1.55);
sun.position.set(120, 160, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -220;
sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220;
sun.shadow.camera.bottom = -220;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);

const fill = new THREE.DirectionalLight(0x9fb6d8, 0.35);
fill.position.set(-100, 80, -120);
scene.add(fill);

// --- build the redesigned motorball speedway -------------------------------------------------
const { group: trackGroup, api: trackApi } = buildTrack();
scene.add(trackGroup);
sun.target.position.set(0, 0, 0);

// --- low-poly racecar --------------------------------------------------------------------
const car = buildLowPolyCar(0xd21f2e);
scene.add(car);

const controller = new CarController(trackApi, car);

// --- HUD ---------------------------------------------------------------------------------
const el = {
  speed: document.getElementById("speed"),
  lap: document.getElementById("lap"),
  laptime: document.getElementById("laptime"),
  best: document.getElementById("best"),
  gear: document.getElementById("gear"),
};
const TOTAL_LAPS = 3;

function fmtTime(ms) {
  if (ms == null) return "--:--.-";
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

// --- input + camera ------------------------------------------------------------------------
const input = createInput();
let cameraMode = 0; // 0 = close chase, 1 = far chase
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camInitialized = false;

function updateCamera(dt) {
  const dims = cameraMode === 0 ? { back: 6.2, up: 2.6, look: 1.4 } : { back: 10.5, up: 4.6, look: 2.2 };
  const forward = new THREE.Vector3(Math.sin(controller.heading), 0, Math.cos(controller.heading));
  const desired = controller.mesh.position.clone()
    .addScaledVector(forward, -dims.back)
    .addScaledVector(new THREE.Vector3(0, 1, 0), dims.up);
  const desiredLook = controller.mesh.position.clone().addScaledVector(forward, dims.look);
  desiredLook.y += 0.6;

  if (!camInitialized) {
    camPos.copy(desired);
    camLook.copy(desiredLook);
    camInitialized = true;
  } else {
    camPos.x = damp(camPos.x, desired.x, 6, dt);
    camPos.y = damp(camPos.y, desired.y, 5, dt);
    camPos.z = damp(camPos.z, desired.z, 6, dt);
    camLook.x = damp(camLook.x, desiredLook.x, 10, dt);
    camLook.y = damp(camLook.y, desiredLook.y, 10, dt);
    camLook.z = damp(camLook.z, desiredLook.z, 10, dt);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// --- boot overlay --------------------------------------------------------------------------
requestAnimationFrame(() => {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 550);
  }
});

// --- resize ---------------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- main loop --------------------------------------------------------------------------------
let lastT = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = clamp((now - lastT) / 1000, 0, 0.05);
  lastT = now;

  if (input.consumeCameraToggle()) cameraMode = 1 - cameraMode;
  if (input.consumeReset()) controller.reset();

  controller.update(dt, input.state);
  updateCamera(dt);

  el.speed.textContent = Math.round(controller.speedKph).toString();
  el.lap.textContent = `${Math.min(controller.lapCount, TOTAL_LAPS)} / ${TOTAL_LAPS}`;
  el.laptime.textContent = fmtTime((controller.simTime - controller.lapStartTime) * 1000);
  el.best.textContent = fmtTime(controller.bestLapTime);
  el.gear.textContent = controller.speed < -0.05 ? "R" : controller.speed > 0.05 ? "D" : "N";

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
