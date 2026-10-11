// The 3D viewport: renderer, scene, camera, tools, selection and gizmos.

import * as THREE from 'three';
import { RoadWorld } from './world.js';
import { CameraController } from './cameraController.js';
import { getSurfaceMaterial, setGroundOpacity, setWireframe } from './materials.js';
import { DETAIL_TYPE_MAP, makeDetail } from './details.js';
import { getProfile } from './profiles.js';
import { clamp, distSqPointSegmentXZ, nearestOnPolyline, polylineLength } from './util.js';
import { frameAt, pointAt } from './markings.js';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uHaze;
  varying vec3 vWorldDirection;

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(h, 0.75));
    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    sky += uSunColor * pow(sun, 220.0) * 2.4;          // disc
    sky += uSunColor * pow(sun, 8.0) * 0.16 * uHaze;   // forward scattering
    float ground = smoothstep(0.0, -0.03, dir.y);
    sky = mix(sky, uHorizon * 0.72, ground);
    gl_FragColor = vec4(sky, 1.0);
  }
`;

export const TOOLS = [
  { id: 'select', label: 'Select', hint: 'Click a road to inspect it; drag the handles to reshape.' },
  { id: 'road', label: 'Draw road', hint: 'Click to place control points, Enter or double-click to finish.' },
  { id: 'path', label: 'Draw path', hint: 'Footways, cycle tracks and trails.' },
  { id: 'rail', label: 'Draw railway', hint: 'Ballasted track with sleepers and rails.' },
  { id: 'subway', label: 'Draw subway', hint: 'Underground line; visible with X-ray.' },
  { id: 'detail', label: 'Place detail', hint: 'Click a road to drop the chosen detail at that point.' },
];

export class EditorViewport {
  constructor(container, network, options = {}) {
    this.container = container;
    this.network = network;
    this.listeners = new Set();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure ?? 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 9000);
    this.world = new RoadWorld(network, { chunkSize: options.chunkSize ?? 256, spacing: options.spacing ?? 4 });
    this.scene.add(this.world.group);

    this.gizmos = new THREE.Group();
    this.gizmos.name = 'gizmos';
    this.scene.add(this.gizmos);

    this.setupEnvironment();
    this.cameraController = new CameraController(this.camera, this.renderer.domElement, {
      terrain: this.world.terrain,
      position: [180, 130, 240],
    });
    this.cameraController.onSpeedChange = (speed) => this.emit('speed', { speed });

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerPixel = { x: 0, y: 0 };
    this.hoverPoint = null;
    this.hoverOwner = null;
    this.selection = null; // { type: 'road'|'subway'|'node', id }
    this.tool = 'select';
    this.pendingProfile = 'arterial-bus-cycle';
    this.pendingDetail = 'speed-bump';
    this.drawPoints = [];
    this.dragging = null;
    this.showNodes = false;
    this.showGrid = true;
    this.xray = 0;
    this.snapEnabled = true;
    this.snapRadius = 7;
    this.rebuildQueued = false;

    this.setupGrid();
    this.setupGizmoMaterials();
    this.bindPointer();
    this.resize();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this.clock = new THREE.Clock();
    this.frames = 0;
    this.fps = 60;
    this._fpsTime = 0;
    this.running = true;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /* ---------------- environment ---------------- */

  setupEnvironment() {
    this.sunDirection = new THREE.Vector3(0.42, 0.55, 0.32).normalize();
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(6000, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uHorizon: { value: new THREE.Color(0xa8b6c4) },
          uZenith: { value: new THREE.Color(0x3f6ea8) },
          uSunDirection: { value: this.sunDirection },
          uSunColor: { value: new THREE.Color(0xfff0d0) },
          uHaze: { value: 1 },
        },
      }),
    );
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1400;
    this.sun.shadow.camera.left = -260;
    this.sun.shadow.camera.right = 260;
    this.sun.shadow.camera.top = 260;
    this.sun.shadow.camera.bottom = -260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd3ea, 0x4a4a3c, 0.85);
    this.scene.add(this.hemi);
    this.fill = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.fill);

    this.scene.fog = new THREE.FogExp2(0xa8b6c4, 0.00016);
  }

  setupGrid() {
    const grid = new THREE.GridHelper(4000, 200, 0x2b3138, 0x1c2126);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.depthWrite = false;
    grid.position.y = 0.02;
    this.grid = grid;
    this.scene.add(grid);
  }

  setupGizmoMaterials() {
    this.gizmoMaterials = {
      node: new THREE.MeshStandardMaterial({ color: 0x8fa4b8, roughness: 0.4, emissive: 0x102030 }),
      nodeActive: new THREE.MeshStandardMaterial({ color: 0x63d6ff, emissive: 0x1a5a70, roughness: 0.3 }),
      junction: new THREE.MeshStandardMaterial({ color: 0xc9a97a, roughness: 0.5 }),
      roundabout: new THREE.MeshStandardMaterial({ color: 0x7fb8a4, roughness: 0.5 }),
      preview: new THREE.MeshBasicMaterial({ color: 0x63d6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      selection: new THREE.MeshBasicMaterial({ color: 0x63d6ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      cursor: new THREE.MeshBasicMaterial({ color: 0x63d6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    };
    this.nodeGeometry = new THREE.SphereGeometry(1, 14, 10);
    this.cursorGeometry = new THREE.RingGeometry(1.4, 2.1, 32);
    this.nodeMeshes = new Map();
    this.cursorMesh = new THREE.Mesh(this.cursorGeometry, this.gizmoMaterials.cursor);
    this.cursorMesh.rotation.x = -Math.PI / 2;
    this.cursorMesh.visible = false;
    this.gizmos.add(this.cursorMesh);
    this.previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.gizmoMaterials.preview);
    this.previewMesh.frustumCulled = false;
    this.gizmos.add(this.previewMesh);
    this.selectionMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.gizmoMaterials.selection);
    this.selectionMesh.frustumCulled = false;
    this.gizmos.add(this.selectionMesh);
  }

  /* ---------------- events ---------------- */

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload = {}) {
    for (const fn of this.listeners) fn({ type, ...payload });
  }

  /* ---------------- pointer ---------------- */

  bindPointer() {
    const dom = this.renderer.domElement;
    this._onPointerMoveCanvas = (event) => {
      const rect = dom.getBoundingClientRect();
      this.pointerPixel = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.pointer.set(
        (this.pointerPixel.x / rect.width) * 2 - 1,
        -(this.pointerPixel.y / rect.height) * 2 + 1,
      );
      this.updateHover();
    };
    this._onPointerDownCanvas = (event) => {
      if (event.button !== 0 || event.altKey) return;
      dom.focus?.();
      this.onPrimaryDown(event);
    };
    this._onPointerUpCanvas = (event) => {
      if (event.button !== 0) return;
      this.onPrimaryUp(event);
    };
    this._onDoubleClick = (event) => {
      if (this.tool === 'road' || this.tool === 'path' || this.tool === 'rail' || this.tool === 'subway') {
        this.finishDraw();
      }
    };
    this._onKeyDown = (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      switch (event.code) {
        case 'Enter':
        case 'NumpadEnter':
          this.finishDraw();
          break;
        case 'Escape':
          this.cancelDraw();
          this.setSelection(null);
          break;
        case 'KeyF':
          this.frameSelection();
          break;
        case 'Delete':
        case 'Backspace':
          this.deleteSelection();
          break;
        case 'KeyG':
          this.setGrid(!this.showGrid);
          break;
        case 'KeyX':
          this.setXray(this.xray > 0.5 ? 0 : 1);
          break;
        default:
          break;
      }
    };
    dom.addEventListener('pointermove', this._onPointerMoveCanvas);
    dom.addEventListener('pointerdown', this._onPointerDownCanvas);
    window.addEventListener('pointerup', this._onPointerUpCanvas);
    dom.addEventListener('dblclick', this._onDoubleClick);
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Ground intersection by ray-marching the height field. */
  raycastGround() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    const terrain = this.world.terrain;
    if (!terrain.enabled) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, hit)) return hit;
      return null;
    }
    let previousT = 0;
    let previousDelta = origin.y - terrain.heightAt(origin.x, origin.z);
    const maxDistance = 6000;
    const step = 2;
    for (let t = step; t < maxDistance; t += step) {
      const x = origin.x + direction.x * t;
      const y = origin.y + direction.y * t;
      const z = origin.z + direction.z * t;
      const delta = y - terrain.heightAt(x, z);
      if (delta <= 0 && previousDelta > 0) {
        // Bisect for a precise hit.
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + direction.x * mid;
          const my = origin.y + direction.y * mid;
          const mz = origin.z + direction.z * mid;
          if (my - terrain.heightAt(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const t0 = (lo + hi) / 2;
        return new THREE.Vector3(
          origin.x + direction.x * t0,
          origin.y + direction.y * t0,
          origin.z + direction.z * t0,
        );
      }
      previousT = t;
      previousDelta = delta;
    }
    return null;
  }

  raycastScene() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.world.chunkGroup.children, true);
    for (const hit of hits) {
      if (!hit.object.userData.pickable) continue;
      const owner = this.world.ownerFromIntersection(hit);
      if (owner) return { ...hit, owner };
    }
    return null;
  }

  raycastHandles() {
    if (!this.nodeMeshes.size) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.nodeMeshes.values()];
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0] : null;
  }

  updateHover() {
    const ground = this.raycastGround();
    this.hoverPoint = ground;
    if (this.dragging) {
      this.updateDrag(ground);
      return;
    }
    if (this.cursorMesh) {
      if (ground) {
        this.cursorMesh.visible = true;
        this.cursorMesh.position.set(ground.x, ground.y + 0.06, ground.z);
        const distance = this.camera.position.distanceTo(ground);
        const scale = clamp(distance * 0.012, 0.7, 8);
        this.cursorMesh.scale.setScalar(scale);
      } else {
        this.cursorMesh.visible = false;
      }
    }

    const hit = this.raycastScene();
    this.hoverOwner = hit?.owner ?? null;
    this.updatePreview(ground);
  }

  updatePreview(ground) {
    const drawing = this.tool === 'road' || this.tool === 'path' || this.tool === 'rail' || this.tool === 'subway';
    if (!drawing || !this.drawPoints.length || !ground) {
      this.previewMesh.visible = false;
      return;
    }
    const points = [...this.drawPoints, { x: ground.x, y: ground.y, z: ground.z }];
    if (points.length < 2) {
      this.previewMesh.visible = false;
      return;
    }
    const geometry = ribbonGeometry(points, this.previewWidth());
    this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = geometry;
    this.previewMesh.visible = true;
  }

  previewWidth() {
    if (this.tool === 'path') return 2.6;
    if (this.tool === 'rail') return 9.4;
    if (this.tool === 'subway') return 10.4;
    const profile = getProfile(this.pendingProfile);
    return profile.lanes.reduce((sum, lane) => sum + lane.width, 0);
  }

  /* ---------------- tools ---------------- */

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'road' && tool !== 'path' && tool !== 'rail' && tool !== 'subway') this.drawPoints = [];
    this.previewMesh.visible = false;
    this.emit('tool', { tool });
  }

  setPendingProfile(profileId) {
    this.pendingProfile = profileId;
    this.emit('pending', { profileId });
  }

  setPendingDetail(detailId) {
    this.pendingDetail = detailId;
    this.emit('pending', { detailId });
  }

  onPrimaryDown() {
    if (this.tool === 'select') {
      const handle = this.raycastHandles();
      if (handle) {
        const nodeId = handle.object.userData.nodeId;
        this.dragging = { nodeId, startY: handle.object.position.y };
        this.setSelection({ type: 'node', id: nodeId });
        return;
      }
      const hit = this.raycastScene();
      if (hit?.owner) {
        if (hit.owner.startsWith('subway:')) this.setSelection({ type: 'subway', id: hit.owner.slice(7) });
        else this.setSelection({ type: 'road', id: hit.owner });
      } else {
        this.setSelection(null);
      }
      return;
    }

    if (this.tool === 'detail') {
      const hit = this.raycastScene();
      if (!hit?.owner || hit.owner.startsWith('subway:')) return;
      const road = this.network.getRoad(hit.owner);
      const prepared = this.world.prepared.get(hit.owner);
      if (!road || !prepared) return;
      const station = nearestStation(prepared, hit.point);
      const detail = makeDetail(this.pendingDetail, station, {});
      road.details.push(detail);
      this.network.commit('add detail');
      this.setSelection({ type: 'road', id: road.id });
      this.requestRebuild();
      this.emit('network', { reason: 'detail' });
      return;
    }

    // Drawing tools.
    const ground = this.hoverPoint;
    if (!ground) return;
    const snapped = this.snapEnabled ? this.network.nearestNode(ground.x, ground.z, this.snapRadius) : null;
    const point = snapped ? { x: snapped.x, y: snapped.y, z: snapped.z } : { x: ground.x, y: ground.y, z: ground.z };
    this.drawPoints.push(point);
    this.updatePreview(ground);
    this.emit('draw', { points: this.drawPoints.length });
  }

  onPrimaryUp() {
    if (this.dragging) {
      this.dragging = null;
      this.network.commit('move node');
      this.emit('network', { reason: 'move' });
    }
  }

  updateDrag(ground) {
    if (!this.dragging || !ground) return;
    const node = this.network.getNode(this.dragging.nodeId);
    if (!node) return;
    const snapped = this.snapEnabled ? this.network.nearestNode(ground.x, ground.z, this.snapRadius * 0.5, (n) => n.id !== node.id) : null;
    node.x = snapped ? snapped.x : ground.x;
    node.z = snapped ? snapped.z : ground.z;
    node.y = this.world.terrain.rawHeight(node.x, node.z);
    this.requestRebuild();
  }

  finishDraw() {
    if (!this.drawPoints.length) return;
    const kind = this.tool;
    if (this.drawPoints.length < 2) {
      this.drawPoints = [];
      this.previewMesh.visible = false;
      this.emit('draw', { points: 0 });
      return;
    }
    const nodeIds = this.drawPoints.map((point) => {
      const existing = this.network.nearestNode(point.x, point.z, 1.2);
      if (existing) return existing.id;
      const node = this.network.addNode(point.x, point.z, point.y ?? 0, 'plain');
      return node.id;
    });

    if (kind === 'subway') {
      const line = this.network.addSubway(nodeIds, { name: `Line ${this.network.subways.size + 1}` });
      this.setSelection({ type: 'subway', id: line.id });
    } else {
      // Honour the profile chosen in the library when it suits the active tool,
      // otherwise fall back to a sensible default for that tool.
      const chosen = getProfile(this.pendingProfile);
      const profileId =
        kind === 'path'
          ? chosen?.category === 'active' || chosen?.category === 'transit'
            ? chosen.id
            : 'footway'
          : kind === 'rail'
            ? chosen?.category === 'transit'
              ? chosen.id
              : 'rail-double'
            : this.pendingProfile;
      const road = this.network.addRoad(nodeIds, profileId, { group: kind === 'road' ? 'arterial' : kind });
      if (road) this.setSelection({ type: 'road', id: road.id });
    }

    this.drawPoints = [];
    this.previewMesh.visible = false;
    this.network.commit('draw');
    this.requestRebuild();
    this.emit('draw', { points: 0 });
    this.emit('network', { reason: 'draw' });
  }

  cancelDraw() {
    this.drawPoints = [];
    this.previewMesh.visible = false;
    this.emit('draw', { points: 0 });
  }

  /* ---------------- selection ---------------- */

  setSelection(selection) {
    if (this.selection?.id === selection?.id && this.selection?.type === selection?.type) return;
    this.selection = selection;
    this.refreshGizmos();
    this.emit('selection', { selection });
  }

  deleteSelection() {
    const selection = this.selection;
    if (!selection) return;
    if (selection.type === 'road') this.network.removeRoad(selection.id);
    else if (selection.type === 'subway') this.network.removeSubway(selection.id);
    else if (selection.type === 'node') this.network.removeNode(selection.id);
    this.setSelection(null);
    this.network.commit('delete');
    this.requestRebuild();
    this.emit('network', { reason: 'delete' });
  }

  frameSelection() {
    const selection = this.selection;
    if (!selection) {
      this.cameraController.frame(new THREE.Vector3(0, 0, 0), Math.max(200, (this.world.bounds?.width ?? 800) * 0.35));
      return;
    }
    if (selection.type === 'node') {
      const node = this.network.getNode(selection.id);
      if (node) this.cameraController.frame(new THREE.Vector3(node.x, node.y + 2, node.z), 40);
      return;
    }
    if (selection.type === 'road') {
      const prepared = this.world.prepared.get(selection.id);
      if (prepared) {
        const centre = new THREE.Vector3();
        for (const station of prepared.stations) centre.add(new THREE.Vector3(station.p.x, station.p.y, station.p.z));
        centre.divideScalar(prepared.stations.length);
        this.cameraController.frame(centre, Math.max(30, prepared.length * 0.35));
      }
      return;
    }
    const line = this.network.subways.get(selection.id);
    if (line) {
      const points = line.nodeIds.map((id) => this.network.getNode(id)).filter(Boolean);
      const centre = points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, z: acc.z + p.z / points.length }), { x: 0, z: 0 });
      this.cameraController.frame(new THREE.Vector3(centre.x, (line.depth ?? -13) + 6, centre.z), 260);
    }
  }

  refreshGizmos() {
    for (const mesh of this.nodeMeshes.values()) this.gizmos.remove(mesh);
    this.nodeMeshes.clear();

    const addNode = (node, active) => {
      const material = node.kind === 'roundabout'
        ? this.gizmoMaterials.roundabout
        : node.kind === 'junction'
          ? this.gizmoMaterials.junction
          : active ? this.gizmoMaterials.nodeActive : this.gizmoMaterials.node;
      const mesh = new THREE.Mesh(this.nodeGeometry, material);
      const y = (node.y ?? 0) || this.world.terrain.rawHeight(node.x, node.z);
      mesh.position.set(node.x, y + 1.4, node.z);
      const degree = countDegree(this.network, node.id);
      mesh.scale.setScalar(clamp(0.9 + degree * 0.25, 0.9, 2.4));
      mesh.userData.nodeId = node.id;
      this.gizmos.add(mesh);
      this.nodeMeshes.set(node.id, mesh);
    };

    if (this.selection?.type === 'road') {
      const road = this.network.getRoad(this.selection.id);
      if (road) for (const id of road.nodeIds) {
        const node = this.network.getNode(id);
        if (node) addNode(node, true);
      }
    } else if (this.selection?.type === 'node') {
      const node = this.network.getNode(this.selection.id);
      if (node) addNode(node, true);
    }

    if (this.showNodes) {
      for (const node of this.network.nodes.values()) {
        if (this.nodeMeshes.has(node.id)) continue;
        addNode(node, false);
      }
    }

    // Selection overlay ribbon.
    this.selectionMesh.geometry.dispose();
    if (this.selection?.type === 'road') {
      const prepared = this.world.prepared.get(this.selection.id);
      if (prepared) {
        const points = prepared.stations.map((station) => ({ x: station.p.x, y: station.p.y + 0.12, z: station.p.z }));
        const width = Math.max(prepared.cross.carriageRight - prepared.cross.carriageLeft, 2);
        this.selectionMesh.geometry = ribbonGeometry(points, width);
        this.selectionMesh.visible = true;
      } else {
        this.selectionMesh.geometry = new THREE.BufferGeometry();
        this.selectionMesh.visible = false;
      }
    } else {
      this.selectionMesh.geometry = new THREE.BufferGeometry();
      this.selectionMesh.visible = false;
    }
  }

  /* ---------------- settings ---------------- */

  setShowNodes(value) {
    this.showNodes = value;
    this.refreshGizmos();
    this.emit('settings', { showNodes: value });
  }

  setGrid(value) {
    this.showGrid = value;
    this.grid.visible = value;
    this.emit('settings', { grid: value });
  }

  setWireframe(value) {
    setWireframe(value);
    this.emit('settings', { wireframe: value });
  }

  setXray(value) {
    this.xray = clamp(value, 0, 1);
    setGroundOpacity(1 - this.xray * 0.86);
    this.emit('settings', { xray: this.xray });
  }

  setShadows(enabled) {
    this.renderer.shadowMap.enabled = enabled;
    this.sun.castShadow = enabled;
    this.scene.traverse((node) => {
      if (node.isMesh) node.material.needsUpdate = true;
    });
    this.emit('settings', { shadows: enabled });
  }

  setFurniture(enabled) {
    this.world.showFurniture = enabled;
    this.requestRebuild();
  }

  setBuildings(enabled) {
    this.world.showBuildings = enabled;
    this.requestRebuild();
  }

  setTimeOfDay(hours) {
    const angle = ((hours - 6) / 24) * Math.PI * 2;
    this.sunDirection.set(Math.cos(angle) * 0.6, Math.max(0.08, Math.sin(angle)), Math.cos(angle) * 0.35 + 0.2).normalize();
    this.sky.material.uniforms.uSunDirection.value.copy(this.sunDirection);
    const day = clamp(Math.sin(angle) * 1.4 + 0.15, 0, 1);
    const night = 1 - day;
    const horizon = new THREE.Color(0xa8b6c4).lerp(new THREE.Color(0x24304a), night);
    const zenith = new THREE.Color(0x3f6ea8).lerp(new THREE.Color(0x080c18), night);
    this.sky.material.uniforms.uHorizon.value.copy(horizon);
    this.sky.material.uniforms.uZenith.value.copy(zenith);
    this.sky.material.uniforms.uSunColor.value.setHex(day > 0.25 ? 0xfff0d0 : 0xffd9a8);
    this.sun.intensity = 0.35 + day * 2.5;
    this.sun.color.setHex(day > 0.3 ? 0xfff2dc : 0xffcf9e);
    this.hemi.intensity = 0.18 + day * 0.8;
    this.hemi.color.copy(horizon);
    this.scene.fog.color.copy(horizon);
    this.scene.fog.density = 0.00016 + night * 0.00018;
    this.emit('settings', { timeOfDay: hours });
  }

  setSpacing(spacing) {
    this.world.spacing = spacing;
    this.requestRebuild();
  }

  /* ---------------- build ---------------- */

  rebuild() {
    const stats = this.world.rebuild();
    this.cameraController.setTerrain(this.world.terrain);
    this.refreshGizmos();
    this.emit('stats', { stats });
    return stats;
  }

  requestRebuild() {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- loop ---------------- */

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.cameraController.update(dt);
    this.updateSunShadow();

    this.frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this._fpsTime);
      this.frames = 0;
      this._fpsTime = 0;
      this.emit('fps', { fps: this.fps });
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateSunShadow() {
    const target = this.camera.position.clone().add(this.cameraController.forward().multiplyScalar(140));
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(target).addScaledVector(this.sunDirection, 420);
    this.sky.position.copy(this.camera.position);
  }

  dispose() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this._onPointerMoveCanvas);
    dom.removeEventListener('pointerdown', this._onPointerDownCanvas);
    window.removeEventListener('pointerup', this._onPointerUpCanvas);
    dom.removeEventListener('dblclick', this._onDoubleClick);
    window.removeEventListener('keydown', this._onKeyDown);
    this.cameraController.dispose();
    this.world.dispose();
    this.renderer.dispose();
    if (dom.parentElement) dom.parentElement.removeChild(dom);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function countDegree(network, nodeId) {
  let n = 0;
  for (const road of network.roads.values()) if (road.nodeIds.includes(nodeId)) n++;
  return n;
}

/** Flat ribbon (a strip of quads) used for previews and selection outlines. */
function ribbonGeometry(points, width) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  if (points.length < 2) return new THREE.BufferGeometry();
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz;
    const rz = tx;
    positions.push(p.x + rx * half, (p.y ?? 0) + 0.05, p.z + rz * half);
    positions.push(p.x - rx * half, (p.y ?? 0) + 0.05, p.z - rz * half);
    normals.push(0, 1, 0, 0, 1, 0);
    const v = i;
    uvs.push(0, v, 1, v);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Station distance of a world point projected onto a prepared road. */
function nearestStation(prepared, point) {
  let best = 0;
  let bestDist = Infinity;
  for (const station of prepared.stations) {
    const d = (station.p.x - point.x) ** 2 + (station.p.z - point.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = station.s;
    }
  }
  // Refine against the segments for a smooth placement.
  let refined = best;
  bestDist = Infinity;
  for (let i = 0; i < prepared.stations.length - 1; i++) {
    const a = prepared.stations[i];
    const b = prepared.stations[i + 1];
    const r = distSqPointSegmentXZ(point.x, point.z, a.p.x, a.p.z, b.p.x, b.p.z);
    if (r.distSq < bestDist) {
      bestDist = r.distSq;
      refined = a.s + (b.s - a.s) * r.t;
    }
  }
  return refined;
}

export { ribbonGeometry, nearestStation };
