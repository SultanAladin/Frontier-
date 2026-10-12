// Browser road editor: Unreal-style camera, draw/select tools, procedural generators,
// live planar topology and chunked three.js rendering.

import * as THREE from 'three';
import { ROAD_TYPES, TYPE_ORDER, buildLanes } from './profiles.js';
import { planarize, validateTopology, makeRng, vdist, polylineLength } from './geometry.js';
import { buildRoadMeshes, MATERIALS, LAYER_HEIGHT } from './mesh.js';
import { generateCity, generateCountryside, generateOffroad, layerOf, reseed } from './generator.js';

// ------------------------------------------------------------------ DOM
const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ui = {
  toolDraw: $('tool-draw'), toolSelect: $('tool-select'), roadType: $('road-type'), typeHelp: $('type-help'),
  selectedInfo: $('selected-info'), reseed: $('reseed'), del: $('delete'), genCity: $('gen-city'),
  genCountry: $('gen-country'), genOffroad: $('gen-offroad'), clear: $('clear'), seed: $('seed'),
  validate: $('validate'), exportBtn: $('export'), importInput: $('import'), stats: $('stats'), status: $('status'),
};

// ------------------------------------------------------------------ state
const state = {
  roads: [],
  selectedId: null,
  tool: 'draw',
  typeId: 'street',
  drawing: null,      // array of [x,y] control points while placing a road
  cursor: null,       // [x,y] under the mouse on the ground plane
  history: [],
  graph: null,
  problems: [],
  building: false,
};

for (const id of TYPE_ORDER) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = ROAD_TYPES[id].label;
  ui.roadType.appendChild(opt);
}
ui.roadType.value = state.typeId;

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3e0);
scene.fog = new THREE.Fog(0x9cc3e0, 1400, 6500);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 30000);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x3c4f2c, 1.0));
const sun = new THREE.DirectionalLight(0xfff3dc, 2.0);
sun.position.set(600, 1100, 400);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20000, 20000),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(...MATERIALS.grass), roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

const roadGroup = new THREE.Group();
const overlayGroup = new THREE.Group();
const problemGroup = new THREE.Group();
scene.add(roadGroup, overlayGroup, problemGroup);

const materialCache = new Map();
function materialFor(name) {
  if (materialCache.has(name)) return materialCache.get(name);
  const opts = {
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    color: 0xffffff,
  };
  if (name.startsWith('paint')) {
    opts.polygonOffset = true;
    opts.polygonOffsetFactor = -2;
    opts.polygonOffsetUnits = -2;
  }
  if (name === 'tunnel') {
    opts.transparent = true;
    opts.opacity = 0.35;
    opts.depthWrite = false;
  }
  if (name === 'steel' || name === 'cable' || name === 'barrier') opts.metalness = 0.4;
  const m = new THREE.MeshStandardMaterial(opts);
  materialCache.set(name, m);
  return m;
}

// Camera (Unreal-style fly camera)
const cam = { yaw: Math.PI, pitch: -0.45, pos: new THREE.Vector3(0, 260, 700), speed: 120 };
const keys = new Set();
let looking = false;
const lookSensitivity = 0.0025;

function updateCamera(dt) {
  const fwd = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch),
    Math.sin(cam.pitch),
    Math.cos(cam.yaw) * Math.cos(cam.pitch),
  ).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(fwd);
  if (keys.has('KeyS')) move.sub(fwd);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  if (keys.has('KeyE')) move.y += 1;
  if (keys.has('KeyQ')) move.y -= 1;
  if (move.lengthSq() > 0) {
    move.normalize();
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
    cam.pos.addScaledVector(move, cam.speed * boost * dt);
  }
  camera.position.copy(cam.pos);
  camera.lookAt(cam.pos.clone().add(fwd));
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (e.button === 2) looking = true;
  if (e.button === 0) onLeftClick();
});
window.addEventListener('pointerup', (e) => { if (e.button === 2) looking = false; });
window.addEventListener('pointermove', (e) => {
  if (looking) {
    cam.yaw -= e.movementX * lookSensitivity;
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - e.movementY * lookSensitivity));
  }
  updateCursor(e);
});
canvas.addEventListener('wheel', (e) => {
  cam.speed = Math.max(10, Math.min(1500, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
  e.preventDefault();
}, { passive: false });

const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function updateCursor(e) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, hit)) state.cursor = [snap(hit.x), snap(hit.z)];
}
const snap = (v) => Math.round(v * 2) / 2; // half-metre grid

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys.add(e.code);
  if (e.code === 'KeyB') setTool('draw');
  if (e.code === 'KeyV') setTool('select');
  if (e.code === 'Enter') finishDrawing();
  if (e.code === 'Escape') cancelDrawing();
  if (e.code === 'Backspace') { e.preventDefault(); undoPoint(); }
  if (e.code === 'Delete') deleteSelected();
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ------------------------------------------------------------------ tools
function setTool(tool) {
  state.tool = tool;
  ui.toolDraw.classList.toggle('on', tool === 'draw');
  ui.toolSelect.classList.toggle('on', tool === 'select');
  if (tool !== 'draw') cancelDrawing();
  setStatus(tool === 'draw' ? 'Click to place control points. Enter finishes.' : 'Click a road to select it.');
  refreshOverlay();
}
ui.toolDraw.onclick = () => setTool('draw');
ui.toolSelect.onclick = () => setTool('select');

ui.roadType.onchange = () => {
  state.typeId = ui.roadType.value;
  ui.typeHelp.textContent = ROAD_TYPES[state.typeId].label;
};
ui.typeHelp.textContent = ROAD_TYPES[state.typeId].label;

function onLeftClick() {
  if (!state.cursor) return;
  if (state.tool === 'draw') {
    if (!state.drawing) state.drawing = [];
    const last = state.drawing[state.drawing.length - 1];
    if (!last || vdist(last, state.cursor) > 0.5) state.drawing.push([...state.cursor]);
    refreshOverlay();
  } else {
    selectNear(state.cursor);
  }
}

function finishDrawing() {
  if (!state.drawing || state.drawing.length < 2) { cancelDrawing(); return; }
  pushHistory();
  const typeId = state.typeId;
  const id = `${typeId}-u${Date.now().toString(36)}`;
  const road = { id, typeId, layer: layerOf(typeId), points: state.drawing.map((p) => [...p]), seed: Math.floor(Math.random() * 1e9) };
  state.roads.push(road);
  state.drawing = null;
  state.selectedId = id;
  rebuild(`Added ${ROAD_TYPES[typeId].label.split(' (')[0]}.`);
}

function cancelDrawing() {
  state.drawing = null;
  refreshOverlay();
}

function undoPoint() {
  if (state.drawing && state.drawing.length) state.drawing.pop();
  if (state.drawing && !state.drawing.length) state.drawing = null;
  refreshOverlay();
}

function selectNear(p) {
  let best = null;
  for (const r of state.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i], b = r.points[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
      const d = vdist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
      if (!best || d < best.d) best = { d, id: r.id };
    }
  }
  state.selectedId = best && best.d < 8 ? best.id : null;
  refreshOverlay();
  updateSelectedInfo();
}

function deleteSelected() {
  if (!state.selectedId) return;
  pushHistory();
  state.roads = state.roads.filter((r) => r.id !== state.selectedId);
  state.selectedId = null;
  rebuild('Deleted road.');
}

function reseedSelected() {
  const r = state.roads.find((x) => x.id === state.selectedId);
  if (!r) return setStatus('Select a road first.', 'bad');
  pushHistory();
  r.seed = Math.floor(Math.random() * 1e9);
  rebuild('Rerolled this road\'s look (widths, markings, bumps).');
}
ui.reseed.onclick = reseedSelected;
ui.del.onclick = deleteSelected;

function pushHistory() {
  state.history.push(JSON.stringify(state.roads));
  if (state.history.length > 40) state.history.shift();
}
function undo() {
  const prev = state.history.pop();
  if (!prev) return setStatus('Nothing to undo.');
  state.roads = JSON.parse(prev);
  state.selectedId = null;
  rebuild('Undo.');
}

function updateSelectedInfo() {
  const r = state.roads.find((x) => x.id === state.selectedId);
  if (!r) { ui.selectedInfo.textContent = 'Nothing selected.'; return; }
  const profile = buildLanes(r.typeId, makeRng(r.seed));
  const lanes = profile.lanes.map((l) => l.type).join(' · ');
  const len = polylineLength(r.points).toFixed(0);
  ui.selectedInfo.textContent = `${r.id}\nlength ${len} m · width ${profile.width.toFixed(1)} m · layer ${r.layer}\nlanes: ${lanes}`;
}

// ------------------------------------------------------------------ generators
function runGenerator(name, fn) {
  pushHistory();
  const seed = Math.max(1, parseInt(ui.seed.value, 10) || 1);
  setStatus(`Generating ${name} (seed ${seed})…`);
  setTimeout(() => {
    state.roads = fn(seed);
    state.selectedId = null;
    rebuild(`Generated ${name}: ${state.roads.length} roads.`);
  }, 20);
}
ui.genCity.onclick = () => runGenerator('city', generateCity);
ui.genCountry.onclick = () => runGenerator('countryside', generateCountryside);
ui.genOffroad.onclick = () => runGenerator('offroad', generateOffroad);
ui.clear.onclick = () => { pushHistory(); state.roads = []; state.selectedId = null; rebuild('Cleared.'); };

ui.exportBtn.onclick = () => {
  const blob = new Blob([JSON.stringify({ format: 'frontier-roads', version: 1, roads: state.roads }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'roads.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
ui.importInput.onchange = async () => {
  const file = ui.importInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const roads = Array.isArray(data) ? data : data.roads;
    if (!Array.isArray(roads)) throw new Error('no roads array');
    pushHistory();
    state.roads = roads.map((r) => ({ ...r, layer: layerOf(r.typeId) }));
    state.selectedId = null;
    rebuild(`Imported ${state.roads.length} roads.`);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'bad');
  } finally {
    ui.importInput.value = '';
  }
};

// ------------------------------------------------------------------ build
function withProfiles(roads) {
  return roads.map((r) => {
    const profile = buildLanes(r.typeId, makeRng(r.seed));
    return { ...r, profile, kind: profile.type.kind };
  });
}

function rebuild(message) {
  if (state.building) return;
  state.building = true;
  setStatus(`${message} Building…`);
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const graph = planarize(withProfiles(state.roads));
      const mesh = buildRoadMeshes(graph);
      state.graph = graph;
      state.problems = [];
      disposeGroup(roadGroup);
      for (const chunk of mesh.chunks) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
        g.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
        g.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, materialFor(chunk.material));
        m.name = chunk.key;
        roadGroup.add(m);
      }
      state.stats = {
        roads: state.roads.length,
        junctions: graph.nodes.length,
        edges: graph.edges.length,
        triangles: mesh.counts.triangles,
        chunks: mesh.chunks.length,
        warnings: graph.warnings.length,
        ms: Math.round(performance.now() - t0),
      };
      updateStats();
      updateSelectedInfo();
      refreshOverlay();
      setStatus(`${message} Built in ${state.stats.ms} ms.`, 'good');
    } catch (err) {
      console.error(err);
      setStatus(`Build failed: ${err.message}`, 'bad');
    } finally {
      state.building = false;
    }
  }, 10);
}

function validate() {
  if (!state.graph) return;
  const v = validateTopology(state.graph);
  state.problems = v.problems;
  disposeGroup(problemGroup);
  for (const p of v.problems) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(4, 10, 8),
      new THREE.MeshBasicMaterial({ color: p.type === 'overlap' ? 0xff3bd1 : 0xff2a2a }),
    );
    marker.position.set(p.at[0], 12, p.at[1]);
    problemGroup.add(marker);
  }
  if (v.ok) setStatus('Topology valid: no unmerged crossings or overlaps.', 'good');
  else setStatus(`${v.problems.length} topology problem(s): ${v.problems.slice(0, 3).map((p) => p.type).join(', ')}…`, 'bad');
  updateStats();
}
ui.validate.onclick = validate;

function updateStats() {
  const s = state.stats || {};
  const surfaceNodes = state.graph ? state.graph.nodes.length : 0;
  const bridges = state.roads.filter((r) => layerOf(r.typeId) === 1).length;
  const tunnels = state.roads.filter((r) => layerOf(r.typeId) === -1).length;
  const problems = state.problems.length ? `\nproblems  ${state.problems.length}` : '';
  ui.stats.textContent =
`roads      ${s.roads ?? 0}  (bridges ${bridges}, subway ${tunnels})
junctions  ${surfaceNodes}
edges      ${s.edges ?? 0}
triangles  ${(s.triangles ?? 0).toLocaleString()}
chunks     ${s.chunks ?? 0}
warnings   ${s.warnings ?? 0}${problems}
camera     ${cam.speed.toFixed(0)} m/s`;
}

function disposeGroup(group) {
  for (const child of group.children.slice()) {
    child.geometry?.dispose();
    group.remove(child);
  }
}

// ------------------------------------------------------------------ overlay (drawing preview & selection)
const overlayMat = new THREE.LineBasicMaterial({ color: 0xffe066 });
const selectedMat = new THREE.LineBasicMaterial({ color: 0x4fd1ff });
function refreshOverlay() {
  disposeGroup(overlayGroup);
  if (state.drawing && state.drawing.length) {
    const pts = state.drawing.map(([x, z]) => new THREE.Vector3(x, 0.5, z));
    if (state.cursor) pts.push(new THREE.Vector3(state.cursor[0], 0.5, state.cursor[1]));
    overlayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), overlayMat));
    for (const [x, z] of state.drawing) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      dot.position.set(x, 0.8, z);
      overlayGroup.add(dot);
    }
  }
  const sel = state.roads.find((r) => r.id === state.selectedId);
  if (sel) {
    const pts = sel.points.map(([x, z]) => new THREE.Vector3(x, 0.6, z));
    overlayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), selectedMat));
  }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start with a small seeded city so the editor opens with something to inspect.
window.__roadEditor = { state, cam, generateCity, generateCountryside, generateOffroad, reseed, LAYER_HEIGHT };
updateStats();
setTool('draw');
runGenerator('city', generateCity);
requestAnimationFrame(frame);
