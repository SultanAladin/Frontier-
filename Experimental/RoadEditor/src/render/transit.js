// Small procedural rolling stock, animated along railway, suspended-monorail, tram and subway paths.
import * as THREE from 'three';
import { Centerline } from '../road/centerline.js';
import { railCenterline } from '../road/geom/rail.js';
import { buildTramRoutes } from '../road/tramRoutes.js';

const MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.72, metalness: 0.28 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.82, metalness: 0.24 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9da6ad, roughness: 0.4, metalness: 0.82 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x8eb9cf, roughness: 0.17, metalness: 0.18, emissive: 0x12232c, emissiveIntensity: 0.22 }),
  light: new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe6a4, emissiveIntensity: 1.8, roughness: 0.28 }),
};
const COLORS = {
  mainline: 0xc5c9cc,
  suspended: 0x1b9a9d,
  tram: 0xb94334,
  subway: 0x2675bc,
};

function box(parent, size, position, material, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWindows(car, width, length, y, count = 7) {
  const step = length / (count + 1);
  for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
    const z = -length / 2 + step * (i + 1);
    box(car, [0.045, 0.82, Math.min(0.95, step * 0.7)], [side * (width / 2 + 0.018), y, z], MAT.glass);
  }
}

function makeCar(mode, index, count, color) {
  const car = new THREE.Group();
  const suspended = mode === 'suspended';
  const tram = mode === 'tram';
  const subway = mode === 'subway';
  const length = tram ? 10.4 : suspended ? 9.4 : 11.6;
  const width = tram ? 2.42 : suspended ? 2.72 : 2.92;
  const height = tram ? 2.75 : suspended ? 2.42 : 2.68;
  const centerY = suspended ? -2.12 : tram ? 1.66 : subway ? 1.75 : 1.9;
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.28 });
  const roofMat = new THREE.MeshStandardMaterial({ color: suspended ? 0x116c70 : tram ? 0xd7d2c7 : 0x363b40, roughness: 0.66, metalness: 0.2 });
  box(car, [width, height, length], [0, centerY, 0], bodyMat);
  box(car, [width + 0.05, 0.16, length + 0.08], [0, centerY + height / 2 + 0.055, 0], roofMat);
  addWindows(car, width, length - 0.8, centerY + 0.18, tram ? 6 : 7);

  if (suspended) {
    // A hanging bogie, twin hanger rods and a roof cradle. There are deliberately no car wheels.
    box(car, [1.6, 0.28, 2.35], [0, -0.12, 0], MAT.dark);
    box(car, [1.14, 0.14, 1.45], [0, -0.42, 0], MAT.metal);
    for (const side of [-1, 1]) box(car, [0.12, 0.9, 0.13], [side * 0.48, -0.76, 0], MAT.metal);
    box(car, [1.25, 0.12, 0.18], [0, -1.13, 0], MAT.metal);
  } else {
    box(car, [width * 0.77, 0.38, length * 0.74], [0, 0.42, 0], MAT.dark);
    for (const side of [-1, 1]) for (const z of [-length * 0.3, length * 0.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.21, 12), MAT.wheel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (width * 0.45), 0.45, z);
      wheel.castShadow = true;
      car.add(wheel);
    }
    if (tram) {
      // The tram roof has a compact pantograph; the road itself still carries the grooved rails.
      box(car, [0.12, 0.68, 0.12], [0, centerY + height / 2 + 0.44, -1.0], MAT.metal, [0, 0, -0.12]);
      box(car, [1.15, 0.08, 0.1], [0, centerY + height / 2 + 0.78, -1.0], MAT.metal);
    }
  }

  // Lit cab faces on both ends so the train remains readable when its path reverses.
  for (const end of [-1, 1]) {
    box(car, [0.23, 0.13, 0.045], [-0.72, centerY + 0.02, end * (length / 2 + 0.02)], MAT.light);
    box(car, [0.23, 0.13, 0.045], [0.72, centerY + 0.02, end * (length / 2 + 0.02)], MAT.light);
  }
  const span = (count - 1) * (length + 0.65);
  car.position.z = span / 2 - index * (length + 0.65);
  car.userData.carLength = length;
  return car;
}

function makeTrain(mode, count = 3, color = COLORS[mode] || COLORS.mainline) {
  const train = new THREE.Group();
  for (let i = 0; i < count; i++) train.add(makeCar(mode, i, count, color));
  train.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  train.userData.mode = mode;
  train.userData.length = count * (mode === 'tram' ? 11.05 : mode === 'suspended' ? 10.05 : 12.25);
  return train;
}

function colorFrom(css, fallback) {
  try { return new THREE.Color(css).getHex(); } catch { return fallback; }
}

export class TransitFleet {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'Animated transit vehicles';
    this.world.roads.add(this.group);
    this.actors = [];
    this.elapsed = 0;
    this._frame = dt => this.update(dt);
    world.frameCbs.add(this._frame);
  }

  clear() {
    const shared = new Set(Object.values(MAT));
    for (const actor of this.actors) {
      this.group.remove(actor.object);
      actor.object.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const material of materials) if (material && !shared.has(material)) material.dispose();
      });
    }
    this.actors.length = 0;
  }

  addActor(points, mode, options = {}) {
    if (!points || points.length < 2) return;
    let curve;
    try { curve = new Centerline(points.map(p => ({ x: p.x, y: p.y ?? 0, z: p.z }))); } catch { return; }
    const count = options.cars || (mode === 'tram' || mode === 'suspended' ? 2 : 3);
    const object = makeTrain(mode, count, options.color ?? COLORS[mode]);
    const halfLength = object.userData.length * 0.48;
    const min = Math.min(curve.length * 0.18, halfLength);
    const max = Math.max(min + 1, curve.length - halfLength);
    this.group.add(object);
    this.actors.push({
      object, curve, mode, offset: options.offset || 0,
      min, max, speed: options.speed || (mode === 'tram' ? 9 : mode === 'suspended' ? 13 : mode === 'subway' ? 15 : 22),
      phase: options.phase || 0,
    });
  }

  rebuild(net = this.world.net, builder = this.world.builder) {
    this.clear();
    this.elapsed = 0;
    if (!net || !builder) { this.updateVisibility(); return; }

    let phase = 0;
    for (const rail of net.rails.values()) {
      const curve = railCenterline(rail);
      const mode = (rail.mode || rail.kind) === 'suspended' ? 'suspended' : 'mainline';
      const count = Math.max(1, Math.min(2, rail.trains ?? (mode === 'suspended' ? 1 : rail.tracks || 1)));
      const offsets = mode === 'suspended' ? [0] : (rail.tracks > 1 ? [-2.1, 2.1] : [0]);
      for (let i = 0; i < count; i++) {
        this.addActor(rail.pts, mode, {
          cars: mode === 'suspended' ? 2 : 3,
          offset: offsets[i % offsets.length],
          speed: rail.speed,
          phase: phase + i * Math.max(80, curve.length / count),
          color: mode === 'suspended' ? COLORS.suspended : COLORS.mainline,
        });
      }
      phase += 75;
    }

    const tramRoutes = buildTramRoutes(net, builder.junctions);
    for (const route of tramRoutes) {
      if (route.pts.length < 2) continue;
      const length = polyLength(route.pts);
      if (length < 90) continue;
      this.addActor(route.pts, 'tram', { cars: 2, speed: 8.5, phase: phase + (phase * 0.73) % Math.max(1, length) });
      phase += 58;
    }

    for (const line of net.subways.values()) {
      const pts = line.pts.map(p => ({ x: p.x, y: -line.depth + 0.18, z: p.z }));
      this.addActor(pts, 'subway', { cars: 3, speed: 15, phase: phase + 130, color: colorFrom(line.color, COLORS.subway) });
      phase += 90;
    }
    this.updateVisibility();
  }

  update(dt) {
    if (!this.actors.length) return;
    this.elapsed += dt;
    for (const actor of this.actors) {
      const span = Math.max(1, actor.max - actor.min);
      const cycle = span * 2;
      let d = (this.elapsed * actor.speed + actor.phase) % cycle;
      if (d < 0) d += cycle;
      const forward = d <= span;
      const s = actor.min + (forward ? d : cycle - d);
      const f = actor.curve.frameAt(s);
      const direction = forward ? 1 : -1;
      actor.object.position.set(f.x + f.nx * actor.offset, f.y, f.z + f.nz * actor.offset);
      actor.object.rotation.set(0, Math.atan2(f.tx * direction, f.tz * direction), 0);
    }
  }

  updateVisibility() {
    const enabled = this.world.settings.trains !== false;
    const underground = this.world.settings.view === 'underground';
    for (const actor of this.actors) actor.object.visible = enabled && ((actor.mode === 'subway') === underground);
  }

  dispose() {
    this.world.frameCbs.delete(this._frame);
    this.clear();
    this.world.roads.remove(this.group);
  }
}

function polyLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return length;
}
