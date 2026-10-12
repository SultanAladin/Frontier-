// three.js viewport for the road editor: Unreal-style fly camera (WASD + RMB look),
// chunked road meshes, screen-space picking and overlays. No React in here.

import * as THREE from 'three';
import { dense, frameAt, ctrl } from './road-graph.js';
import { ROAD_DROP } from './road-geometry.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const GROUND_Y = -0.3;

export class RoadViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.skyColor = new THREE.Color(0xa7bcc8);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.skyColor, 2600, 9000);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 30000);
    this.yaw = 0.6;
    this.pitch = -0.72;
    this.camera.position.set(0, 420, 900);
    this.speed = 140;
    this.keys = new Set();
    this.drag = null; // { x, y } while RMB look is active
    this.width = 1;
    this.height = 1;

    this.scene.add(new THREE.HemisphereLight(0xe8f1f7, 0x3a3f35, 1.0));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(-600, 900, 400);
    this.scene.add(sun);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a5a40, roughness: 1, metalness: 0, transparent: true, opacity: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = GROUND_Y;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(12000, 120, 0x9bd1c0, 0x7c9d8f);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.18;
    this.grid.material.depthWrite = false;
    this.grid.position.y = GROUND_Y + 0.02;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.roadGroup = new THREE.Group();
    this.scene.add(this.roadGroup);
    this.nodeGroup = new THREE.Group();
    this.scene.add(this.nodeGroup);
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);

    this.undergroundVisible = true;
    this.pick = null;
    this.nodeList = [];
    this.edgeIds = [];
    this.matrix = new Float32Array(16);

    this.matSurface = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.matMarking = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.matProp = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
    this.matUnder = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.55, depthWrite: false });

    this.nodeMaterial = new THREE.PointsMaterial({ color: 0xffd166, size: 3, sizeAttenuation: false, depthTest: false });
    this.selectMaterial = new THREE.LineBasicMaterial({ color: 0x7ee8ff, depthTest: false, transparent: true, opacity: 0.95 });
    this.drawMaterial = new THREE.LineBasicMaterial({ color: 0xff9f43, depthTest: false });
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    this.lastFrame = performance.now();
    this.onFrame = null;
    this.raf = 0;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- network display -------------------------------------------------

  setNetwork(net, meshes) {
    this.clearGroup(this.roadGroup);
    this.clearGroup(this.nodeGroup);
    for (const chunk of meshes.chunks) {
      const group = new THREE.Group();
      group.name = chunk.key;
      this.addLayer(group, chunk.surface, this.matSurface, 0);
      this.addLayer(group, chunk.markings, this.matMarking, 1);
      this.addLayer(group, chunk.props, this.matProp, 2);
      this.addLayer(group, chunk.underground, this.matUnder, 3);
      this.roadGroup.add(group);
    }
    this.roadGroup.children.forEach((g) => { g.children.forEach((m) => { if (m.userData.layer === 3) m.visible = this.undergroundVisible; }); });
    this.buildPickIndex(net);
    this.buildNodes(net);
  }

  addLayer(group, buffers, material, layer) {
    if (!buffers) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(buffers.color, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.layer = layer;
    mesh.renderOrder = layer;
    group.add(mesh);
  }

  clearGroup(group) {
    for (const child of [...group.children]) {
      child.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      group.remove(child);
    }
  }

  setUndergroundVisible(visible) {
    this.undergroundVisible = visible;
    this.ground.material.opacity = visible ? 0.8 : 1;
    this.ground.material.needsUpdate = true;
    this.roadGroup.children.forEach((g) => g.children.forEach((m) => { if (m.userData.layer === 3) m.visible = visible; }));
  }

  setGridVisible(visible) {
    this.grid.visible = visible;
  }

  buildPickIndex(net) {
    let count = 0;
    const edges = Object.values(net.edges);
    const denses = edges.map((e) => dense(net, e));
    for (const D of denses) count += D.x.length;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const s = new Float32Array(count);
    const who = new Int32Array(count);
    this.edgeIds = edges.map((e) => e.id);
    let k = 0;
    denses.forEach((D, idx) => {
      for (let i = 0; i < D.x.length; i += 1, k += 1) {
        x[k] = D.x[i];
        y[k] = D.y[i] + ROAD_DROP;
        z[k] = D.z[i];
        s[k] = D.s[i];
        who[k] = idx;
      }
    });
    this.pick = { x, y, z, s, who, count };
  }

  buildNodes(net) {
    const nodes = Object.values(net.nodes);
    this.nodeList = nodes;
    const pos = new Float32Array(nodes.length * 3);
    nodes.forEach((n, i) => { pos[i * 3] = n.x; pos[i * 3 + 1] = n.y + 0.4; pos[i * 3 + 2] = n.z; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, this.nodeMaterial);
    points.renderOrder = 6;
    this.nodeGroup.add(points);
  }

  // ----- projection and picking -------------------------------------------

  updateMatrix() {
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.matrix.set(m.elements);
  }

  toScreen(x, y, z) {
    const e = this.matrix;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 1e-4) return null;
    const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    return [(cx + 1) * 0.5 * this.width, (1 - cy) * 0.5 * this.height];
  }

  pickEdge(px, py, radius = 10) {
    if (!this.pick || this.pick.count === 0) return null;
    this.updateMatrix();
    const { x, y, z, s, who } = this.pick;
    const r2 = radius * radius;
    const e = this.matrix;
    const hw = this.width * 0.5;
    const hh = this.height * 0.5;
    let best = r2;
    let hit = -1;
    for (let i = 0; i < x.length; i += 1) {
      const xi = x[i];
      const yi = y[i];
      const zi = z[i];
      const w = e[3] * xi + e[7] * yi + e[11] * zi + e[15];
      if (w <= 1e-4) continue;
      const sx = (e[0] * xi + e[4] * yi + e[8] * zi + e[12]) / w * hw + hw;
      const sy = hh - (e[1] * xi + e[5] * yi + e[9] * zi + e[13]) / w * hh;
      const dx = sx - px;
      const dy = sy - py;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        hit = i;
      }
    }
    if (hit < 0) return null;
    return {
      edgeId: this.edgeIds[who[hit]], s: s[hit], x: x[hit], y: y[hit] - ROAD_DROP, z: z[hit], dist: Math.sqrt(best),
    };
  }

  pickNode(px, py, radius = 12) {
    this.updateMatrix();
    let best = radius * radius;
    let hit = null;
    for (const n of this.nodeList) {
      const sc = this.toScreen(n.x, n.y + 0.4, n.z);
      if (!sc) continue;
      const d = (sc[0] - px) ** 2 + (sc[1] - py) ** 2;
      if (d < best) {
        best = d;
        hit = n.id;
      }
    }
    return hit;
  }

  groundAt(px, py, height = 0) {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(WORLD_UP, -height);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? { x: out.x, y: height, z: out.z } : null;
  }

  // ----- overlays ----------------------------------------------------------

  clearOverlay() {
    this.clearGroup(this.overlay);
  }

  showSelection(net, edgeId) {
    this.clearOverlay();
    const e = net.edges[edgeId];
    if (!e) return;
    const D = dense(net, e);
    const pos = new Float32Array(D.x.length * 3);
    for (let i = 0; i < D.x.length; i += 1) {
      pos[i * 3] = D.x[i];
      pos[i * 3 + 1] = D.y[i] + 0.35;
      pos[i * 3 + 2] = D.z[i];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, this.selectMaterial);
    line.renderOrder = 8;
    this.overlay.add(line);
  }

  showNodeMarker(net, nodeId) {
    this.clearOverlay();
    const n = net.nodes[nodeId];
    if (!n) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7ee8ff, depthTest: false }));
    m.position.set(n.x, n.y + 0.4, n.z);
    m.renderOrder = 9;
    this.overlay.add(m);
  }

  showDraft(points, height) {
    this.clearOverlay();
    if (points.length === 0) return;
    const pos = new Float32Array(points.length * 3);
    points.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = (p.y ?? height) + 0.5; pos[i * 3 + 2] = p.z; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, this.drawMaterial);
    line.renderOrder = 8;
    this.overlay.add(line);
    const dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff9f43, size: 6, sizeAttenuation: false, depthTest: false }));
    dots.renderOrder = 9;
    this.overlay.add(dots);
  }

  setCursor(point) {
    if (!point) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.position.set(point.x, point.y + 0.3, point.z);
  }

  // Lateral offset and arc position for a click on a road.
  propPlacement(net, hit) {
    const e = net.edges[hit.edgeId];
    if (!e) return null;
    const D = dense(net, e);
    const s = hit.s;
    const fr = frameAt(D, s);
    const lat = (hit.x - fr.x) * fr.nx + (hit.z - fr.z) * fr.nz;
    return { s, lat, length: D.L, ctrlCount: ctrl(net, e).length };
  }

  // ----- camera --------------------------------------------------------------

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  lookAt(x, y, z, distance = 260) {
    const target = new THREE.Vector3(x, y, z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.position.copy(target).addScaledVector(dir, -distance);
    this.applyRotation();
  }

  setView(position, yaw, pitch) {
    this.camera.position.set(position[0], position[1], position[2]);
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyRotation();
  }

  lookDelta(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022));
    this.applyRotation();
  }

  adjustSpeed(direction) {
    this.speed = Math.max(5, Math.min(2500, this.speed * (direction > 0 ? 1.15 : 1 / 1.15)));
  }

  step(dt, fast) {
    const f = this.forward();
    const r = new THREE.Vector3().crossVectors(f, WORLD_UP).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(f);
    if (this.keys.has('KeyS')) move.sub(f);
    if (this.keys.has('KeyD')) move.add(r);
    if (this.keys.has('KeyA')) move.sub(r);
    if (this.keys.has('KeyE')) move.add(WORLD_UP);
    if (this.keys.has('KeyQ')) move.sub(WORLD_UP);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(this.speed * (fast ? 4 : 1) * dt);
      this.camera.position.add(move);
    }
    this.applyRotation();
  }

  start() {
    const loop = (now) => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      this.step(dt, fast);
      if (this.onFrame) this.onFrame(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.clearGroup(this.roadGroup);
    this.clearGroup(this.nodeGroup);
    this.clearOverlay();
    this.renderer.dispose();
  }
}
