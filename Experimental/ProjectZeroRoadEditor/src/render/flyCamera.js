// Unreal-style editor camera:
//   W/S forward/back, A/D strafe, Q/E down/up (in view space for WASD, world up for QE)
//   Right mouse drag (or Alt+drag) to look; Shift = 3x speed, Ctrl = 0.25x speed
//   Mouse wheel changes fly speed while looking, dollies otherwise; F focuses the selection.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class FlyCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 140, 320);
    this.yaw = 0; // 0 looks toward -z
    this.pitch = -0.38;
    this.speed = 80; // m/s
    this.keys = new Set();
    this.looking = false;
    this.minSpeed = 2;
    this.maxSpeed = 2500;
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** dt in seconds. Moves and orients the three.js camera. */
  update(dt) {
    const f = this.forward();
    const r = this.right();
    const move = new THREE.Vector3();
    const k = this.keys;
    if (k.has('KeyW')) move.add(f);
    if (k.has('KeyS')) move.sub(f);
    if (k.has('KeyD')) move.add(r);
    if (k.has('KeyA')) move.sub(r);
    if (k.has('KeyE')) move.add(UP);
    if (k.has('KeyQ')) move.sub(UP);
    if (move.lengthSq() > 0) {
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
      const slow = k.has('ControlLeft') || k.has('ControlRight') ? 0.25 : 1;
      move.normalize().multiplyScalar(this.speed * boost * slow * Math.min(dt, 0.1));
      this.pos.add(move);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.pos.clone().add(f));
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - dy * 0.0022));
  }

  dolly(amount) {
    this.pos.addScaledVector(this.forward(), amount);
  }

  changeSpeed(direction) {
    const factor = direction < 0 ? 1.15 : 1 / 1.15;
    this.speed = Math.max(this.minSpeed, Math.min(this.maxSpeed, this.speed * factor));
  }

  /** Place the camera behind and above a point, looking at it. */
  focus(x, y, z, distance = 90) {
    this.pitch = -0.55;
    const target = new THREE.Vector3(x, y, z);
    this.pos.copy(target).addScaledVector(this.forward(), -distance);
  }

  setYaw(v) {
    this.yaw = v;
  }
}
