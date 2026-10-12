// Frontier Road Editor — free camera.
//
// Unreal-style: hold the right mouse button (or click the viewport to lock the
// pointer) and look, WASD to move, Q/E down and up, shift to sprint, ctrl to
// creep, wheel to change the base speed. The camera keeps its own velocity with
// drag so quick taps still feel like a camera rather than a slider, and it knows
// how to frame a whole city when one is built.

import { clamp } from '../core/math.js';

export class FreeCamera {
  constructor(opts = {}) {
    this.pos = [opts.x ?? 0, opts.y ?? 30, opts.z ?? -60];
    this.yaw = opts.yaw ?? 0.6;      // radians, 0 looks along +X
    this.pitch = opts.pitch ?? -0.25; // radians, negative looks down
    this.vel = [0, 0, 0];
    this.baseSpeed = opts.speed ?? 22;   // metres/second
    this.sprint = 4;
    this.creep = 0.25;
    this.lookSpeed = opts.lookSpeed ?? 0.0022;
    this.keys = new Set();
    this.dragging = false;
    this.locked = false;
  }

  attach(el) {
    this.el = el;
    el.tabIndex = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 0) {
        this.dragging = true;
        if (e.button === 0) el.requestPointerLock?.();
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging && !this.locked) return;
      this.yaw += e.movementX * this.lookSpeed;
      this.pitch = clamp(this.pitch - e.movementY * this.lookSpeed, -1.5, 1.5);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.dragging = false;
    });
    el.addEventListener('wheel', (e) => {
      this.baseSpeed = clamp(this.baseSpeed * (e.deltaY > 0 ? 0.85 : 1.18), 2, 2500);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName || '')) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    return this;
  }

  /** Unit forward vector from yaw/pitch. */
  forward() {
    const cp = Math.cos(this.pitch);
    return [Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp];
  }

  right() {
    return [-Math.sin(this.yaw), 0, Math.cos(this.yaw)];
  }

  update(dt) {
    const k = this.keys;
    const wish = [0, 0, 0];
    const f = this.forward();
    const r = this.right();
    const add = (v, s) => { wish[0] += v[0] * s; wish[1] += v[1] * s; wish[2] += v[2] * s; };
    if (k.has('KeyW') || k.has('ArrowUp')) add(f, 1);
    if (k.has('KeyS') || k.has('ArrowDown')) add(f, -1);
    if (k.has('KeyD') || k.has('ArrowRight')) add(r, 1);
    if (k.has('KeyA') || k.has('ArrowLeft')) add(r, -1);
    if (k.has('KeyE') || k.has('Space')) wish[1] += 1;
    if (k.has('KeyQ')) wish[1] -= 1;
    const len = Math.hypot(wish[0], wish[1], wish[2]);
    if (len > 1e-6) { wish[0] /= len; wish[1] /= len; wish[2] /= len; }
    const boost = (k.has('ShiftLeft') || k.has('ShiftRight')) ? this.sprint : (k.has('ControlLeft') || k.has('ControlRight')) ? this.creep : 1;
    const target = [wish[0] * this.baseSpeed * boost, wish[1] * this.baseSpeed * boost, wish[2] * this.baseSpeed * boost];
    // Exponential approach: snappy but not instant, framerate independent.
    const a = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < 3; i++) {
      this.vel[i] += (target[i] - this.vel[i]) * a;
      this.pos[i] += this.vel[i] * dt;
    }
    if (this.pos[1] < 1.2 && !k.has('KeyQ')) { this.pos[1] = 1.2; this.vel[1] = Math.max(0, this.vel[1]); }
    return this;
  }

  /** Look at a point (keeps yaw/pitch conventions). */
  lookAt(p) {
    const d = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
    const flat = Math.hypot(d[0], d[2]) || 1e-6;
    this.yaw = Math.atan2(d[2], d[0]);
    this.pitch = clamp(Math.atan2(d[1], flat), -1.5, 1.5);
    return this;
  }

  /** Frame a bounding box (`[minX,minY,minZ,maxX,maxY,maxZ]`) from the outside. */
  frame(bounds, fovDeg = 60) {
    if (!bounds) return this;
    const cx = (bounds[0] + bounds[3]) / 2;
    const cy = (bounds[1] + bounds[4]) / 2;
    const cz = (bounds[2] + bounds[5]) / 2;
    const size = Math.max(bounds[3] - bounds[0], bounds[5] - bounds[2], 80);
    const dist = size / (2 * Math.tan((fovDeg * Math.PI) / 360)) * 0.9;
    this.pos = [cx - dist * 0.55, cy + dist * 0.42, cz - dist * 0.75];
    this.lookAt([cx, cy, cz]);
    this.vel = [0, 0, 0];
    this.baseSpeed = clamp(size / 12, 10, 900);
    return this;
  }

  /** Perspective + view matrices (column-major, ready for WebGL). */
  matrices(aspect, fovDeg = 60, near = 0.3, far = 9000) {
    const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
    const proj = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ]);
    const [fx, fy, fz] = this.forward();
    const zx = -fx, zy = -fy, zz = -fz;
    // Right = normalize(cross(forward, worldUp)), up = cross(back, right):
    // getting the order of the second cross wrong mirrors the world vertically.
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = zy * rz - zz * ry, uy = zz * rx - zx * rz, uz = zx * ry - zy * rx;
    const p = this.pos;
    const view = new Float32Array([
      rx, ux, zx, 0,
      ry, uy, zy, 0,
      rz, uz, zz, 0,
      -(rx * p[0] + ry * p[1] + rz * p[2]),
      -(ux * p[0] + uy * p[1] + uz * p[2]),
      -(zx * p[0] + zy * p[1] + zz * p[2]), 1,
    ]);
    return { proj, view };
  }
}

/** True when a bounding box is outside the camera frustum (conservative). */
export function boxVisible(cam, bounds, aspect, fovDeg = 60, far = 9000) {
  const cx = (bounds[0] + bounds[3]) / 2, cy = (bounds[1] + bounds[4]) / 2, cz = (bounds[2] + bounds[5]) / 2;
  const r = Math.hypot(bounds[3] - cx, bounds[4] - cy, bounds[5] - cz) * 1.42;
  const d = [cx - cam.pos[0], cy - cam.pos[1], cz - cam.pos[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist - r > far) return false;
  if (dist < r) return true;
  const f = cam.forward();
  const along = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / dist;
  const half = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * Math.max(1, aspect)) + Math.asin(clamp(r / dist, 0, 1));
  return Math.acos(clamp(along, -1, 1)) <= half;
}
