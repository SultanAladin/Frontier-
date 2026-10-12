// Renderer, lights, sky/fog, ground (with trench stencil hole) and the editing grid.

import * as THREE from 'three';
import { createMaterials } from './materials.js';

export const WORLD_SIZE = 60000;

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
      // Far-distance depth precision for a 60 km map (see Docs in README).
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a6bccb');
    this.scene.fog = new THREE.FogExp2('#b3c6d1', 0.00042);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60000);

    this.scene.add(new THREE.HemisphereLight('#dcebf5', '#4a5440', 1.25));
    const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
    sun.position.set(-700, 1100, 500);
    this.scene.add(sun);

    this.mats = createMaterials(this.renderer);

    const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, this.mats.ground);
    // Layering (logarithmic depth ignores polygon offsets, so use real heights):
    // ground -0.10 < grid -0.03 < road lanes 0 < paint 0.05.
    this.ground.position.y = -0.1;
    this.ground.renderOrder = 1;
    this.ground.name = 'ground';
    this.scene.add(this.ground);

    this.mats.grid.map.repeat.set(WORLD_SIZE / 10, WORLD_SIZE / 10);
    const gridGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
    gridGeo.rotateX(-Math.PI / 2);
    this.grid = new THREE.Mesh(gridGeo, this.mats.grid);
    this.grid.position.y = -0.03;
    this.grid.renderOrder = 2;
    this.grid.name = 'grid';
    this.scene.add(this.grid);

    this.resize();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
