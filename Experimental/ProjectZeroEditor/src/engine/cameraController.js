// Unreal-editor style viewport camera.
//
//   RMB + drag        free look (and WASD flies)
//   MMB + drag        pan up/down/left/right
//   Alt + RMB + drag  dolly forwards/backwards
//   Alt + LMB + drag  orbit around the current focus point
//   W A S D           move (forward / left / back / right)
//   Q E               move down / up in world space
//   Shift / Ctrl      4x / 0.25x speed modifier
//   Mouse wheel       camera speed (Unreal behaviour)
//   F                 frame the current selection

import * as THREE from 'three';
import { clamp } from './util.js';

const SPEED_STEPS = [0.6, 1.2, 2.5, 5, 10, 20, 40, 80, 160, 320, 640, 1200];

export class CameraController {
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.terrain = options.terrain || null;
    this.collide = options.collide !== false;

    this.yaw = options.yaw ?? Math.PI * 0.25;
    this.pitch = options.pitch ?? -0.55;
    this.position = new THREE.Vector3(options.position?.[0] ?? 120, options.position?.[1] ?? 90, options.position?.[2] ?? 160);
    this.velocity = new THREE.Vector3();
    this.speedIndex = 6;
    this.acceleration = 12;
    this.damping = 6;
    this.lookSensitivity = 0.0026;
    this.enabled = true;

    this.keys = new Set();
    this.buttons = new Set();
    this.dragMode = null;
    this.lastPointer = { x: 0, y: 0 };
    this.focus = new THREE.Vector3(0, 0, 0);
    this.focusDistance = 120;
    this.minHeight = 1.6;
    this.smoothYaw = this.yaw;
    this.smoothPitch = this.pitch;
    this.fov = camera.fov ?? 60;
    this.orthographic = false;

    this._bind();
    this.applyToCamera();
  }

  get speed() {
    return SPEED_STEPS[clamp(this.speedIndex, 0, SPEED_STEPS.length - 1)];
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  _bind() {
    const dom = this.dom;
    this._onContextMenu = (event) => event.preventDefault();
    this._onPointerDown = (event) => {
      if (!this.enabled) return;
      this.buttons.add(event.button);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (event.button === 2) this.dragMode = event.altKey ? 'dolly' : 'look';
      else if (event.button === 1) this.dragMode = 'pan';
      else if (event.button === 0 && event.altKey) this.dragMode = 'orbit';
      if (this.dragMode) {
        dom.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }
    };
    this._onPointerMove = (event) => {
      if (!this.dragMode) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.onDrag(this.dragMode, dx, dy);
    };
    this._onPointerUp = (event) => {
      this.buttons.delete(event.button);
      if (this.buttons.size === 0) this.dragMode = null;
      dom.releasePointerCapture?.(event.pointerId);
    };
    this._onWheel = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -1 : 1;
      this.speedIndex = clamp(this.speedIndex + delta, 0, SPEED_STEPS.length - 1);
      if (this.onSpeedChange) this.onSpeedChange(this.speed);
    };
    this._onKeyDown = (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      this.keys.add(event.code);
    };
    this._onKeyUp = (event) => this.keys.delete(event.code);
    this._onBlur = () => {
      this.keys.clear();
      this.buttons.clear();
      this.dragMode = null;
    };

    dom.addEventListener('contextmenu', this._onContextMenu);
    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  dispose() {
    const dom = this.dom;
    dom.removeEventListener('contextmenu', this._onContextMenu);
    dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    dom.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  onDrag(mode, dx, dy) {
    if (mode === 'look') {
      this.yaw -= dx * this.lookSensitivity;
      this.pitch = clamp(this.pitch - dy * this.lookSensitivity, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    } else if (mode === 'pan') {
      const scale = this.speed * 0.0022;
      this.moveRelative(-dx * scale, dy * scale, 0);
    } else if (mode === 'dolly') {
      this.moveRelative(0, 0, dy * this.speed * 0.006);
    } else if (mode === 'orbit') {
      this.yaw -= dx * this.lookSensitivity;
      this.pitch = clamp(this.pitch - dy * this.lookSensitivity, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
      const distance = this.position.distanceTo(this.focus);
      this.position.copy(this.focus).add(this.forward().multiplyScalar(-distance));
    }
  }

  forward(target = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return target.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  right(target = new THREE.Vector3()) {
    return target.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  moveRelative(forwardAmount, upAmount, rightAmount) {
    const forward = this.forward();
    const right = this.right();
    this.position.addScaledVector(forward, forwardAmount);
    this.position.addScaledVector(right, rightAmount);
    this.position.y += upAmount;
  }

  /** Fly to a point so it fills the view. */
  frame(target, radius = 40) {
    if (!target) return;
    this.focus.copy(target);
    const distance = Math.max(radius * 2.4, 30);
    this.focusDistance = distance;
    this.yaw = Math.PI * 0.22;
    this.pitch = -0.62;
    const forward = this.forward();
    this.position.copy(this.focus).addScaledVector(forward, -distance);
    this.smoothYaw = this.yaw;
    this.smoothPitch = this.pitch;
    this.applyToCamera();
  }

  update(dt) {
    if (!this.enabled) return;
    const keys = this.keys;
    let forwardAmount = 0;
    let rightAmount = 0;
    let upAmount = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forwardAmount += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forwardAmount -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) rightAmount += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) rightAmount -= 1;
    if (keys.has('KeyE')) upAmount += 1;
    if (keys.has('KeyQ')) upAmount -= 1;

    let modifier = 1;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) modifier *= 4;
    if (keys.has('ControlLeft') || keys.has('ControlRight')) modifier *= 0.25;

    const speed = this.speed * modifier;
    const desired = new THREE.Vector3();
    if (forwardAmount || rightAmount || upAmount) {
      const forward = this.forward();
      const right = this.right();
      desired.addScaledVector(forward, forwardAmount);
      desired.addScaledVector(right, rightAmount);
      desired.y += upAmount;
      desired.normalize().multiplyScalar(speed);
    }

    // Critically damped approach to the desired velocity, with a little inertia.
    const responsiveness = desired.lengthSq() > 0 ? this.acceleration : this.damping;
    const alpha = 1 - Math.exp(-dt * responsiveness);
    this.velocity.lerp(desired, alpha);
    if (this.velocity.lengthSq() < 1e-5) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);

    if (this.collide && this.terrain) {
      const ground = this.terrain.heightAt(this.position.x, this.position.z) + this.minHeight;
      if (this.position.y < ground) {
        this.position.y = ground;
        this.velocity.y = Math.max(0, this.velocity.y);
      }
    }

    // Smooth the look direction a touch so mouse-look feels weighted.
    this.smoothYaw += (this.yaw - this.smoothYaw) * alpha;
    this.smoothPitch += (this.pitch - this.smoothPitch) * alpha;
    this.applyToCamera();
  }

  applyToCamera() {
    const cp = Math.cos(this.smoothPitch);
    const forward = new THREE.Vector3(
      Math.sin(this.smoothYaw) * cp,
      Math.sin(this.smoothPitch),
      Math.cos(this.smoothYaw) * cp,
    ).normalize();
    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.position.clone().add(forward));
    this.camera.updateMatrixWorld();
  }

  isMoving() {
    return this.velocity.lengthSq() > 0.01;
  }

  /** Screen-space speed readout for the status bar. */
  get status() {
    return { speed: this.speed, moving: this.isMoving(), altitude: this.position.y };
  }
}

export { SPEED_STEPS };
