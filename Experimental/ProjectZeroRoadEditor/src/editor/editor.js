// RoadEditor: tools, picking, snapping, undo/redo and overlays. The UI (ui.js)
// calls these methods and listens to onChange; the kernel does all geometry.

import * as THREE from 'three';
import { Stage } from '../render/stage.js';
import { RoadWorld } from '../render/world.js';
import { FlyCamera } from '../render/flyCamera.js';
import {
  createProject, addNode, addRoad, moveNode, moveRoadPoint, removeRoad, removeRoadPoint, addProp, removeProp,
  nearestRoad, ensureNodeAt, insertPointAt, roundaboutPoints, serialize, deserialize, centerlineOf,
  syncEndpoints, findRoad, roadLength, projectStats,
} from '../core/model.js';
import { ROAD_KINDS, LANE_KINDS, presetLanes, lanesOf, halfWidthOf, laneOffsets } from '../core/lanes.js';
import { trimFor } from '../core/junctions.js';
import { minCurveRadius, nearestOnPoly, pointAt } from '../core/centerline.js';
import { defaultProp, resolveS, PROP_KINDS } from '../core/props.js';
import { generateCity } from '../core/city.js';
import { round } from '../core/math.js';

export const TOOLS = {
  select: { key: '1', label: 'Select / edit' },
  draw: { key: '2', label: 'Draw road' },
  prop: { key: '3', label: 'Place prop' },
  roundabout: { key: '4', label: 'Roundabout' },
  delete: { key: '5', label: 'Delete' },
};

const HISTORY_LIMIT = 150;
const NODE_SNAP = 3;
const ROAD_SNAP = 3;
const HANDLE_PICK = 3;
const MINT = 0x82e3c3;

export class RoadEditor {
  constructor({ canvas, onChange = () => {}, onMessage = () => {} }) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.onMessage = onMessage;
    this.stage = new Stage(canvas);
    this.world = new RoadWorld(this.stage.scene, this.stage.mats);
    this.fly = new FlyCamera(this.stage.camera);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.tool = 'select';
    this.drawKind = 'avenue';
    this.drawOptions = { busLanes: true, bikeLanes: true, parking: true };
    this.propKind = 'speedBump';
    this.roundaboutRadius = 14;
    this.snapOn = true;
    this.gridSize = 2;
    this.showNodes = true;
    this.selection = null; // {type:'road'|'node'|'prop', id, propId?}
    this.draw = { points: [] };
    this.cursor = null; // {x,z,snap}
    this.hover = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastFrame = performance.now();
    this.junctions = null;

    this.project = createProject('Untitled');
    this.buildOverlays();
    this.bindInput();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.addEventListener('resize', () => this.stage.resize());
  }

  // ---------------------------------------------------------------- project

  loadProject(project, { resetHistory = true, focus = true } = {}) {
    this.project = project;
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.selection = null;
    this.draw.points = [];
    this.afterEdit(false);
    if (focus) {
      const b = this.bounds();
      this.fly.pos.set(b.cx, Math.max(180, b.size * 0.5), b.cz + b.size * 0.7);
      this.fly.yaw = 0;
      this.fly.pitch = -0.5;
      this.fly.speed = Math.max(40, b.size / 40);
    }
    this.emit();
  }

  bounds() {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const n of Object.values(this.project.nodes)) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minZ = Math.min(minZ, n.z);
      maxZ = Math.max(maxZ, n.z);
    }
    if (!Number.isFinite(minX)) return { cx: 0, cz: 0, size: 400 };
    const size = Math.max(200, maxX - minX, maxZ - minZ);
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, size };
  }

  /** Commit a structural change: snapshot for undo, rebuild derived data. */
  mutate(label, fn) {
    const before = serialize(this.project);
    const result = fn(this.project);
    this.pushUndo(before, label);
    this.afterEdit(true);
    return result;
  }

  pushUndo(before, label) {
    this.undoStack.push({ before, label });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  afterEdit(save = true) {
    this.world.setProject(this.project);
    this.junctions = this.world.junctions;
    this.refreshOverlays();
    if (save) this.scheduleSave?.();
    this.emit();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return this.onMessage('Nothing to undo.');
    this.redoStack.push({ before: serialize(this.project), label: entry.label });
    this.project = deserialize(entry.before);
    this.restoreAfterHistory();
    this.onMessage(`Undid: ${entry.label}`);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return this.onMessage('Nothing to redo.');
    this.undoStack.push({ before: serialize(this.project), label: entry.label });
    this.project = deserialize(entry.before);
    this.restoreAfterHistory();
    this.onMessage(`Redid: ${entry.label}`);
  }

  /** After undo/redo the selection may point at objects that no longer exist. */
  restoreAfterHistory() {
    const sel = this.selection;
    if (sel) {
      let alive = false;
      if (sel.type === 'node') alive = !!this.project.nodes[sel.id];
      else {
        const road = findRoad(this.project, sel.id);
        if (road) alive = sel.type !== 'prop' || (road.props || []).some((p) => p.id === sel.propId);
      }
      if (!alive) this.selection = null;
    }
    this.draw.points = [];
    this.afterEdit(true);
  }

  /** Replace the whole project as one undoable step. */
  replaceProject(project, label) {
    const before = serialize(this.project);
    this.loadProject(project, { resetHistory: false });
    this.pushUndo(before, label);
    this.scheduleSave?.();
  }

  generate(options) {
    const city = generateCity(options);
    this.replaceProject(city, 'Generate city');
    this.onMessage(`Generated ${city.roads.length} roads (${projectStats(city).lengthKm.toFixed(1)} km). Ctrl+Z restores the previous map.`);
  }

  // ---------------------------------------------------------------- tools

  setTool(name) {
    if (!TOOLS[name]) return;
    this.tool = name;
    this.draw.points = [];
    if (name !== 'select') this.hover = null;
    this.refreshOverlays();
    this.emit();
    const hints = {
      select: 'Click a road or node. Drag handles to reshape. Double-click a road to add a point.',
      draw: 'Click to place points (snaps to nodes and roads). Double-click or Enter to finish, Esc cancels.',
      prop: 'Click a road to place the selected prop at that point.',
      roundabout: 'Click to place a roundabout ring.',
      delete: 'Click a road, prop or node to delete it.',
    };
    this.onMessage(hints[name]);
  }

  setDrawKind(kind) {
    this.drawKind = kind;
    this.emit();
  }

  setDrawOptions(opts) {
    this.drawOptions = { ...this.drawOptions, ...opts };
    this.emit();
  }

  setPropKind(kind) {
    this.propKind = kind;
    this.emit();
  }

  setSnap(on) {
    this.snapOn = !!on;
    this.emit();
  }

  setGrid(n) {
    this.gridSize = Math.max(0.5, Number(n) || 2);
    this.emit();
  }

  setShowNodes(on) {
    this.showNodes = !!on;
    this.refreshOverlays();
    this.emit();
  }

  select(sel) {
    this.selection = sel;
    this.refreshOverlays();
    this.emit();
  }

  selectedRoad() {
    if (!this.selection) return null;
    const id = this.selection.type === 'road' || this.selection.type === 'prop' ? this.selection.id : null;
    return id ? findRoad(this.project, id) : null;
  }

  selectedNode() {
    if (!this.selection || this.selection.type !== 'node') return null;
    return this.project.nodes[this.selection.id] || null;
  }

  // ---------------------------------------------------------------- edits

  updateRoad(id, patch, label = 'Edit road') {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate(label, () => {
      Object.assign(road, patch);
      if (patch.points) for (const p of road.points) p.h = p.h || 0;
      syncEndpoints(this.project, road);
    });
  }

  setRoadKind(id, kind) {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate(`Road type → ${ROAD_KINDS[kind].label}`, () => {
      road.kind = kind;
      road.lanes = presetLanes(kind, this.drawOptions);
      road.mode = ROAD_KINDS[kind].mode || 'surface';
      if (ROAD_KINDS[kind].closed) {
        road.closed = true;
        road.start = null;
        road.end = null;
      }
      if (road.mode === 'underground' && !road.roof) road.roof = false;
      if (road.mode === 'bridge' || road.mode === 'underground') this.applyStructureHeights(road);
    });
  }

  setRoadMode(id, mode) {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate(`Mode → ${mode}`, () => {
      road.mode = mode;
      this.applyStructureHeights(road);
    });
  }

  /** Bridges and tunnels use per-point heights: interior points get the structure depth. */
  applyStructureHeights(road, height) {
    const h = height ?? (road.mode === 'bridge' ? 7 : road.mode === 'underground' ? -7 : 0);
    road.points = road.points.map((p, i) => {
      const end = i === 0 || i === road.points.length - 1;
      const keep = road.closed ? false : end;
      return { ...p, h: keep || road.mode === 'surface' ? 0 : h };
    });
  }

  setStructureHeight(id, h) {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate('Set structure height', () => {
      this.applyStructureHeights(road, Number(h) || 0);
    });
  }

  setRoof(id, on) {
    this.updateRoad(id, { roof: !!on }, on ? 'Add roof' : 'Remove roof');
  }

  updateLane(id, index, patch, label = 'Edit lane') {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate(label, () => {
      const lanes = lanesOf(road);
      if (!lanes[index]) return;
      road.lanes = lanes.map((l, i) => (i === index ? { ...l, ...patch } : l));
      if (patch.width !== undefined) road.lanes[index].width = Math.max(0.2, Number(patch.width) || 0.2);
    });
  }

  addLane(id, kind, index) {
    const road = findRoad(this.project, id);
    if (!road) return;
    this.mutate(`Add ${LANE_KINDS[kind].label}`, () => {
      const lanes = lanesOf(road).map((l) => ({ ...l }));
      const at = index === undefined || index < 0 ? lanes.length : Math.min(index, lanes.length);
      lanes.splice(at, 0, { kind, width: LANE_KINDS[kind].width });
      road.lanes = lanes;
    });
  }

  removeLane(id, index) {
    const road = findRoad(this.project, id);
    if (!road) return;
    const lanes = lanesOf(road);
    if (lanes.length <= 1) return this.onMessage('A road needs at least one lane.');
    this.mutate('Remove lane', () => {
      road.lanes = lanes.filter((_, i) => i !== index);
    });
  }

  moveLane(id, index, dir) {
    const road = findRoad(this.project, id);
    if (!road) return;
    const lanes = lanesOf(road).map((l) => ({ ...l }));
    const j = index + dir;
    if (j < 0 || j >= lanes.length) return;
    this.mutate('Reorder lanes', () => {
      [lanes[index], lanes[j]] = [lanes[j], lanes[index]];
      road.lanes = lanes;
    });
  }

  addPropToRoad(roadId, kind, s) {
    const road = findRoad(this.project, roadId);
    if (!road) return null;
    const L = roadLength(road);
    const at = s ?? L / 2;
    const prop = defaultProp(kind, at);
    if (PROP_KINDS[kind].range) {
      prop.s0 = undefined;
      prop.s1 = undefined;
    }
    let added = null;
    this.mutate(`Add ${PROP_KINDS[kind].label}`, () => {
      added = addProp(this.project, roadId, Object.fromEntries(Object.entries(prop).filter(([, v]) => v !== undefined)));
    });
    this.select({ type: 'prop', id: roadId, propId: added?.id });
    return added;
  }

  updateProp(roadId, propId, patch) {
    const road = findRoad(this.project, roadId);
    if (!road) return;
    this.mutate('Edit prop', () => {
      road.props = road.props.map((p) => (p.id === propId ? { ...p, ...patch } : p));
    });
  }

  removePropById(roadId, propId) {
    this.mutate('Remove prop', () => removeProp(this.project, roadId, propId));
    this.select({ type: 'road', id: roadId });
  }

  deleteRoadById(id) {
    this.mutate('Delete road', () => removeRoad(this.project, id));
    if (this.selection?.id === id) this.selection = null;
    this.refreshOverlays();
    this.emit();
  }

  deleteSelection() {
    if (!this.selection) return;
    const sel = this.selection;
    if (sel.type === 'road') this.deleteRoadById(sel.id);
    else if (sel.type === 'prop') this.removePropById(sel.id, sel.propId);
    else if (sel.type === 'node') {
      const used = this.project.roads.some((r) => r.start === sel.id || r.end === sel.id);
      if (used) return this.onMessage('Delete the roads that use this node first.');
      this.mutate('Delete node', (p) => delete p.nodes[sel.id]);
      this.selection = null;
    }
    this.selection = null;
    this.refreshOverlays();
    this.emit();
  }

  focusSelection() {
    const road = this.selectedRoad();
    if (road) {
      const cl = centerlineOf(road);
      const mid = pointAt(cl, (cl.s[0] + cl.s[cl.n - 1]) / 2);
      this.fly.focus(mid.x, mid.h, mid.z, Math.max(60, roadLength(road) * 0.6));
      return;
    }
    const node = this.selectedNode();
    if (node) this.fly.focus(node.x, 0, node.z, 80);
  }

  // ---------------------------------------------------------------- picking

  pointerToGround(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  snapFree(x, z) {
    if (!this.snapOn) return { x, z };
    const g = this.gridSize;
    return { x: Math.round(x / g) * g, z: Math.round(z / g) * g };
  }

  /** Snap priority: existing node, then road centreline (T-junction), then grid. */
  snapPoint(x, z, { allowRoad = true } = {}) {
    let node = null;
    let bestD = NODE_SNAP;
    for (const n of Object.values(this.project.nodes)) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= bestD) {
        bestD = d;
        node = n;
      }
    }
    if (node) return { x: node.x, z: node.z, snap: 'node', nodeId: node.id };
    if (allowRoad) {
      const hit = nearestRoad(this.project, x, z, ROAD_SNAP);
      if (hit && !hit.road.closed && hit.road.mode === 'surface') {
        return { x: hit.near.x, z: hit.near.z, snap: 'road', roadId: hit.road.id };
      }
    }
    const f = this.snapFree(x, z);
    return { x: f.x, z: f.z, snap: this.snapOn ? 'grid' : 'free' };
  }

  roadUnder(x, z) {
    let best = null;
    for (const road of this.project.roads) {
      const cl = centerlineOf(road);
      if (cl.n < 2) continue;
      const near = nearestOnPoly(cl, x, z);
      const tol = halfWidthOf(road) + 2;
      if (near.dist <= tol && (!best || near.dist - tol < best.score)) {
        best = { road, near, score: near.dist - tol };
      }
    }
    return best;
  }

  handlePick(x, z) {
    const road = this.selectedRoad();
    if (!road || road.closed) return null;
    let best = null;
    road.points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < HANDLE_PICK && (!best || d < best.d)) best = { d, index: i };
    });
    return best ? { roadId: road.id, index: best.index } : null;
  }

  propWorldPoints(road) {
    const cl = centerlineOf(road);
    const L = cl.s[cl.n - 1];
    const trim = trimFor(this.world.junctions || { trims: new Map() }, road);
    return (road.props || []).filter((p) => !PROP_KINDS[p.kind]?.range).map((p) => {
      const s = resolveS(p, L, trim);
      const pt = pointAt(cl, s);
      return { prop: p, x: pt.x, z: pt.z, h: pt.h, s };
    });
  }

  nodeAt(x, z, tol = NODE_SNAP) {
    let best = null;
    for (const n of Object.values(this.project.nodes)) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= tol && (!best || d < best.d)) best = { node: n, d };
    }
    return best?.node || null;
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.code));
    window.addEventListener('blur', () => this.fly.keys.clear());
  }

  onPointerDown(e) {
    this.canvas.focus?.();
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      // Look mode: relative mouse motion while the button is held. No pointer lock,
      // so releasing the lock can never strand the camera.
      this.fly.looking = true;
      return;
    }
    if (e.button !== 0) return;
    const g = this.pointerToGround(e);
    if (!g) return;
    if (this.tool === 'select') this.beginSelectDrag(g, e);
    else if (this.tool === 'draw') this.drawClick(g);
    else if (this.tool === 'prop') this.propClick(g);
    else if (this.tool === 'roundabout') this.roundaboutClick(g);
    else if (this.tool === 'delete') this.deleteClick(g);
  }

  beginSelectDrag(g) {
    const handle = this.handlePick(g.x, g.z);
    if (handle) {
      const road = findRoad(this.project, handle.roadId);
      const isNode = !road.closed && (handle.index === 0 && road.start || handle.index === road.points.length - 1 && road.end);
      this.drag = { type: 'handle', roadId: handle.roadId, index: handle.index, snapshot: serialize(this.project), moved: false, isNode };
      return;
    }
    const node = this.nodeAt(g.x, g.z);
    if (node) {
      this.select({ type: 'node', id: node.id });
      this.drag = { type: 'node', id: node.id, snapshot: serialize(this.project), moved: false };
      return;
    }
    const pick = this.pickProp(g);
    if (pick) {
      this.select({ type: 'prop', id: pick.roadId, propId: pick.propId });
      return;
    }
    const hit = this.roadUnder(g.x, g.z);
    if (hit) {
      this.select({ type: 'road', id: hit.road.id });
      this.drag = null;
      return;
    }
    this.select(null);
  }

  pickProp(g) {
    const road = this.selectedRoad();
    if (!road) return null;
    let best = null;
    for (const pp of this.propWorldPoints(road)) {
      const d = Math.hypot(pp.x - g.x, pp.z - g.z);
      if (d < 4 && (!best || d < best.d)) best = { d, roadId: road.id, propId: pp.prop.id };
    }
    return best;
  }

  onPointerMove(e) {
    if (this.fly.looking) {
      this.fly.look(e.movementX || 0, e.movementY || 0);
      return;
    }
    const g = this.pointerToGround(e);
    if (!g) return;
    if (this.drag) {
      this.dragTo(g);
      return;
    }
    const snap = this.snapPoint(g.x, g.z, { allowRoad: this.tool === 'draw' || this.tool === 'prop' });
    this.cursor = snap;
    const prevHover = this.hover ? JSON.stringify(this.hover) : '';
    this.hover = this.tool === 'select' ? this.hoverPick(g) : null;
    if ((this.hover ? JSON.stringify(this.hover) : '') !== prevHover) {
      this.refreshSelectionLine();
      this.refreshHandles();
    }
    this.refreshDrawLine();
    this.refreshCursorOverlay();
  }

  hoverPick(g) {
    const handle = this.handlePick(g.x, g.z);
    if (handle) return { type: 'handle', ...handle };
    const node = this.nodeAt(g.x, g.z);
    if (node) return { type: 'node', id: node.id };
    const hit = this.roadUnder(g.x, g.z);
    return hit ? { type: 'road', id: hit.road.id } : null;
  }

  dragTo(g) {
    const d = this.drag;
    const snapped = this.snapOn ? this.snapFree(g.x, g.z) : g;
    if (d.type === 'handle') {
      moveRoadPoint(this.project, d.roadId, d.index, snapped.x, snapped.z);
      d.moved = true;
      this.afterEdit(false);
    } else if (d.type === 'node') {
      moveNode(this.project, d.id, snapped.x, snapped.z);
      d.moved = true;
      this.afterEdit(false);
    }
  }

  onPointerUp(e) {
    if (e.button === 2 || (e.button === 0 && this.fly.looking)) {
      this.fly.looking = false;
      return;
    }
    if (e.button !== 0) return;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.moved) {
        const after = serialize(this.project);
        if (after !== d.snapshot) {
          this.pushUndo(d.snapshot, d.type === 'node' ? 'Move node' : 'Move point');
        }
        this.afterEdit(true);
      }
    }
  }

  onDoubleClick(e) {
    if (this.tool === 'draw') {
      this.finishDraw();
      return;
    }
    if (this.tool !== 'select') return;
    const g = this.pointerToGround(e);
    if (!g) return;
    const road = this.selectedRoad();
    if (road) {
      const hit = this.roadUnder(g.x, g.z);
      if (hit && hit.road.id === road.id) {
        let index = -1;
        this.mutate('Insert control point', (p) => {
          index = insertPointAt(p, road.id, g.x, g.z);
        });
        this.onMessage(`Inserted control point ${index + 1}. Drag it to reshape the road.`);
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (this.fly.looking) this.fly.changeSpeed(dir);
    else this.fly.dolly(-dir * Math.max(4, this.fly.speed * 0.6));
  }

  onKeyDown(e) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = /INPUT|SELECT|TEXTAREA/.test(tag) && !(document.activeElement.type === 'checkbox' || document.activeElement.type === 'range');
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      return this.undo();
    }
    if ((ctrl && e.code === 'KeyY') || (ctrl && e.shiftKey && e.code === 'KeyZ')) {
      e.preventDefault();
      return this.redo();
    }
    if (ctrl) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(e.code)) {
      this.fly.keys.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      this.draw.points = [];
      this.drag = null;
      this.select(null);
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.tool === 'draw') this.finishDraw();
      return;
    }
    if (e.code === 'Backspace' && this.tool === 'draw') {
      this.draw.points.pop();
      this.refreshOverlays();
      return;
    }
    if (e.code === 'Delete') return this.deleteSelection();
    if (e.code === 'KeyF') return this.focusSelection();
    if (e.code === 'KeyG') return this.setSnap(!this.snapOn);
    if (e.code === 'KeyN') return this.setShowNodes(!this.showNodes);
    const toolByKey = Object.entries(TOOLS).find(([, t]) => t.key === e.key);
    if (toolByKey) return this.setTool(toolByKey[0]);
  }

  // ---------------------------------------------------------------- tool actions

  drawClick(g) {
    const snap = this.snapPoint(g.x, g.z);
    const pts = this.draw.points;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - snap.x, last.z - snap.z) < 0.5) return;
    pts.push({ x: snap.x, z: snap.z, node: snap.snap === 'node' ? snap.nodeId : null, road: snap.snap === 'road' ? snap.roadId : null, snap: snap.snap });
    this.refreshOverlays();
    this.emit();
  }

  finishDraw() {
    const pts = this.draw.points.slice();
    this.draw.points = [];
    // Drop duplicates from double-click, then require two distinct points.
    const cleaned = [];
    for (const p of pts) {
      const q = cleaned[cleaned.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.5) cleaned.push(p);
    }
    if (cleaned.length < 2) {
      this.refreshOverlays();
      this.emit();
      return this.onMessage('Need at least two distinct points to make a road.');
    }
    const kind = this.drawKind;
    const loop = cleaned.length > 2 && Math.hypot(cleaned[0].x - cleaned.at(-1).x, cleaned[0].z - cleaned.at(-1).z) < 1;
    let createdId = null;
    this.mutate(`Draw ${ROAD_KINDS[kind].label}`, (p) => {
      const endpoint = (pt) => {
        if (pt.node && p.nodes[pt.node]) return pt.node;
        const id = ensureNodeAt(p, pt.x, pt.z, { nodeTol: NODE_SNAP, roadTol: ROAD_SNAP });
        return id || addNode(p, pt.x, pt.z);
      };
      const first = cleaned[0];
      const lastPt = cleaned[cleaned.length - 1];
      let mid = cleaned.slice(1, -1).map((q) => ({ x: q.x, z: q.z, h: 0 }));
      if (loop) {
        const ring = cleaned.slice(0, -1).map((q) => ({ x: q.x, z: q.z, h: 0 }));
        const road = addRoad(p, { kind, points: ring, closed: true, options: this.drawOptions, mode: 'surface' });
        createdId = road.id;
        return;
      }
      const startNode = endpoint(first);
      const endNode = endpoint(lastPt);
      if (startNode === endNode) {
        mid = cleaned.slice(0, -1).map((q) => ({ x: q.x, z: q.z, h: 0 }));
        const road = addRoad(p, { kind, points: mid, closed: true, options: this.drawOptions });
        createdId = road.id;
        return;
      }
      const pts2 = [{ ...p.nodes[startNode], h: 0 }, ...mid, { ...p.nodes[endNode], h: 0 }];
      const road = addRoad(p, { kind, points: pts2, startNode, endNode, options: this.drawOptions });
      createdId = road.id;
    });
    if (createdId) this.select({ type: 'road', id: createdId });
    this.onMessage('Road created. Select it to edit lanes, type and props.');
  }

  propClick(g) {
    const hit = this.roadUnder(g.x, g.z);
    if (!hit) return this.onMessage('Click closer to a road to place a prop.');
    this.addPropToRoad(hit.road.id, this.propKind, hit.near.s);
    this.onMessage(`${PROP_KINDS[this.propKind].label} added to ${hit.road.name}.`);
  }

  roundaboutClick(g) {
    const snap = this.snapFree(g.x, g.z);
    let id = null;
    this.mutate('Add roundabout', (p) => {
      const road = addRoad(p, {
        kind: 'roundabout',
        points: roundaboutPoints(snap.x, snap.z, this.roundaboutRadius, 16),
        closed: true,
        radius: this.roundaboutRadius,
      });
      id = road.id;
    });
    this.select({ type: 'road', id });
  }

  deleteClick(g) {
    const pick = this.pickProp(g);
    if (pick) return this.removePropById(pick.roadId, pick.propId);
    const hit = this.roadUnder(g.x, g.z);
    if (hit) return this.deleteRoadById(hit.road.id);
  }

  // ---------------------------------------------------------------- overlays

  buildOverlays() {
    const s = this.stage.scene;
    this.overlay = new THREE.Group();
    this.overlay.name = 'editor-overlay';
    s.add(this.overlay);
    const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
    this.selLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(MINT));
    this.hoverLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0xffffff, 0.6));
    this.drawLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(0xf2c230));
    for (const l of [this.selLine, this.hoverLine, this.drawLine]) {
      l.renderOrder = 999;
      l.frustumCulled = false;
      this.overlay.add(l);
    }
    this.handleGroup = new THREE.Group();
    this.overlay.add(this.handleGroup);
    this.nodePoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    this.nodePoints.renderOrder = 998;
    this.nodePoints.frustumCulled = false;
    this.overlay.add(this.nodePoints);
    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.0, 28),
      new THREE.MeshBasicMaterial({ color: MINT, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.cursorRing.rotation.x = -Math.PI / 2;
    this.cursorRing.renderOrder = 1000;
    this.overlay.add(this.cursorRing);
    this.handleGeo = new THREE.SphereGeometry(1.1, 12, 8);
    this.handleMats = {
      point: new THREE.MeshBasicMaterial({ color: MINT, depthTest: false }),
      node: new THREE.MeshBasicMaterial({ color: 0xffb35c, depthTest: false }),
      hover: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
      prop: new THREE.MeshBasicMaterial({ color: 0xf2c230, depthTest: false }),
    };
  }

  refreshOverlays() {
    this.refreshSelectionLine();
    this.refreshHandles();
    this.refreshNodes();
    this.refreshDrawLine();
    this.refreshCursorOverlay();
  }

  setLineGeometry(line, points) {
    const pos = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    });
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }

  refreshSelectionLine() {
    const road = this.selectedRoad();
    if (!road) {
      this.selLine.visible = false;
    } else {
      const cl = centerlineOf(road);
      const pts = [];
      for (let i = 0; i < cl.n; i += 1) pts.push({ x: cl.x[i], y: cl.h[i] + 0.4, z: cl.z[i] });
      this.setLineGeometry(this.selLine, pts);
      this.selLine.visible = true;
    }
    const hov = this.hover && this.tool === 'select' && this.hover.type === 'road' && this.hover.id !== this.selection?.id ? this.hover : null;
    if (hov) {
      const road2 = findRoad(this.project, hov.id);
      const cl = centerlineOf(road2);
      const pts = [];
      for (let i = 0; i < cl.n; i += 1) pts.push({ x: cl.x[i], y: cl.h[i] + 0.45, z: cl.z[i] });
      this.setLineGeometry(this.hoverLine, pts);
      this.hoverLine.visible = true;
    } else {
      this.hoverLine.visible = false;
    }
  }

  refreshHandles() {
    for (const child of this.handleGroup.children) child.geometry?.dispose?.();
    this.handleGroup.clear();
    const road = this.selectedRoad();
    if (!road || this.tool !== 'select') return;
    const add = (x, y, z, mat, scale = 1) => {
      const m = new THREE.Mesh(this.handleGeo, mat);
      m.position.set(x, y, z);
      m.scale.setScalar(scale);
      m.renderOrder = 1001;
      this.handleGroup.add(m);
    };
    road.points.forEach((p, i) => {
      const endpoint = !road.closed && (i === 0 || i === road.points.length - 1);
      const hovered = this.hover?.type === 'handle' && this.hover.index === i;
      add(p.x, (p.h || 0) + 0.6, p.z, hovered ? this.handleMats.hover : endpoint ? this.handleMats.node : this.handleMats.point, hovered ? 1.4 : 1);
    });
    if (this.selection?.type === 'prop' || this.selection?.type === 'road') {
      for (const pp of this.propWorldPoints(road)) {
        const sel = this.selection?.propId === pp.prop.id;
        add(pp.x, pp.h + 1.2, pp.z, this.handleMats.prop, sel ? 1.8 : 1.1);
      }
    }
  }

  refreshNodes() {
    if (!this.showNodes) {
      this.nodePoints.visible = false;
      return;
    }
    const nodes = Object.values(this.project.nodes);
    const junctions = this.world.junctions;
    const pos = new Float32Array(nodes.length * 3);
    const col = new Float32Array(nodes.length * 3);
    nodes.forEach((n, i) => {
      pos[i * 3] = n.x;
      pos[i * 3 + 1] = 0.6;
      pos[i * 3 + 2] = n.z;
      const pad = junctions?.pads?.has(n.id);
      const sel = this.selection?.type === 'node' && this.selection.id === n.id;
      const c = sel ? [1, 0.75, 0.36] : pad ? [0.51, 0.89, 0.76] : [0.9, 0.9, 0.9];
      col.set(c, i * 3);
    });
    this.nodePoints.geometry.dispose();
    this.nodePoints.geometry = new THREE.BufferGeometry();
    this.nodePoints.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.nodePoints.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.nodePoints.visible = nodes.length > 0;
  }

  refreshDrawLine() {
    const pts = this.draw.points;
    if (this.tool !== 'draw' || pts.length === 0) {
      this.drawLine.visible = false;
      return;
    }
    const list = pts.map((p) => ({ x: p.x, y: 0.5, z: p.z }));
    if (this.cursor) list.push({ x: this.cursor.x, y: 0.5, z: this.cursor.z });
    this.setLineGeometry(this.drawLine, list);
    this.drawLine.visible = true;
  }

  refreshCursorOverlay() {
    const c = this.cursor;
    if (!c || !['select', 'draw', 'prop', 'roundabout', 'delete'].includes(this.tool)) {
      this.cursorRing.visible = false;
      return;
    }
    const colors = { node: 0xffb35c, road: 0x7fd3ff, grid: 0x82e3c3, free: 0x82e3c3 };
    this.cursorRing.material.color.setHex(colors[c.snap] || MINT);
    this.cursorRing.position.set(c.x, 0.5, c.z);
    this.cursorRing.visible = true;
    if (this.tool === 'roundabout') {
      this.cursorRing.scale.setScalar(this.roundaboutRadius / 1.7);
    } else {
      this.cursorRing.scale.setScalar(1);
    }
  }

  // ---------------------------------------------------------------- loop & state

  loop(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fly.update(dt);
    this.world.update(this.stage.camera.position);
    this.stage.render();
    if (this.hudTick === undefined || now - this.hudTick > 250) {
      this.hudTick = now;
      this.emit();
    }
    requestAnimationFrame(this.loop);
  }

  stats() {
    const base = projectStats(this.project);
    const cam = this.stage.camera.position;
    return {
      ...base,
      triangles: this.world.stats.triangles,
      tilesDirty: this.world.stats.dirty,
      tiles: this.world.stats.tiles,
      camera: { x: cam.x, y: cam.y, z: cam.z },
      speed: this.fly.speed,
      tool: this.tool,
      snap: this.snapOn,
      grid: this.gridSize,
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }

  emit() {
    this.onChange({
      tool: this.tool,
      drawKind: this.drawKind,
      drawOptions: this.drawOptions,
      propKind: this.propKind,
      roundaboutRadius: this.roundaboutRadius,
      selection: this.selection,
      stats: this.stats(),
      drawCount: this.draw.points.length,
      showNodes: this.showNodes,
      snapOn: this.snapOn,
      gridSize: this.gridSize,
    });
  }

  /** Road diagnostics shown in the inspector. */
  diagnostics(road) {
    const cl = centerlineOf(road);
    const warnings = [];
    const hw = halfWidthOf(road);
    const R = minCurveRadius(cl);
    if (!road.closed && R < hw * 1.05) warnings.push(`Tight bend (radius ${R.toFixed(1)} m < half width ${hw.toFixed(1)} m): inner edge may fold. Add points or widen the bend.`);
    if (road.mode === 'bridge' && !road.points.some((p) => p.h > 1)) warnings.push('Bridge has no height. Set the deck height.');
    const L = cl.s[cl.n - 1] - cl.s[0];
    const offs = laneOffsets(lanesOf(road));
    return { length: L, width: offs.at(-1) - offs[0], radius: R, warnings };
  }

  nodeRoads(nodeId) {
    return this.project.roads.filter((r) => r.start === nodeId || r.end === nodeId).map((r) => r.id);
  }

  setNodePosition(nodeId, x, z) {
    this.mutate('Move node', () => moveNode(this.project, nodeId, Number(x), Number(z)));
  }

  removeControlPoint(roadId, index) {
    let ok = false;
    this.mutate('Remove control point', (p) => {
      ok = removeRoadPoint(p, roadId, index);
    });
    if (!ok) this.onMessage('Cannot remove an endpoint or the last points of a road.');
  }

  setPointHeight(roadId, index, h) {
    this.mutate('Set point height', (p) => {
      const road = findRoad(p, roadId);
      if (road && road.points[index]) road.points[index] = { ...road.points[index], h: round(Number(h) || 0) };
    });
  }
}
