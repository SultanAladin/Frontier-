// Procedural textures and materials. No external image assets: asphalt grain,
// paver joints and ground/grid overlays are painted on canvases at start-up.

import * as THREE from 'three';

function canvasTexture(canvas, { repeat = 1, anisotropy = 4, srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** 256px = 4 m tile. Mid-grey so vertex colours tint it. */
function asphaltCanvas(seed = 3) {
  const c = makeCanvas(256);
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  let r = seed;
  const rnd = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  for (let i = 0; i < 256 * 256; i++) {
    const v = 150 + rnd() * 60 + (rnd() < 0.04 ? -50 : 0) + (rnd() < 0.015 ? 60 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** 256px = 1.2 m tile, 4 x 4 pavers with joints. */
function paverCanvas() {
  const c = makeCanvas(256);
  const g = c.getContext('2d');
  g.fillStyle = '#a8a8a8';
  g.fillRect(0, 0, 256, 256);
  const cell = 64;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const shade = 200 + ((i * 37 + j * 91) % 40) - 20;
      g.fillStyle = `rgb(${shade},${shade},${shade - 4})`;
      g.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
    }
  }
  g.fillStyle = 'rgba(70,70,70,0.6)';
  for (let k = 0; k < 4; k++) {
    g.fillRect(k * cell, 0, 2, 256);
    g.fillRect(0, k * cell, 256, 2);
  }
  return c;
}

/** 512px ground noise with fine speckle. */
function groundCanvas() {
  const c = makeCanvas(512);
  const g = c.getContext('2d');
  const img = g.createImageData(512, 512);
  let r = 99;
  const rnd = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  for (let i = 0; i < 512 * 512; i++) {
    const v = 175 + rnd() * 50;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Transparent grid: 10 m minor, 100 m major lines. Drawn over the ground at y~0. */
function gridCanvas() {
  const c = makeCanvas(256);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(150, 230, 200, 0.42)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0.5);
  g.lineTo(256, 0.5);
  g.moveTo(0.5, 0);
  g.lineTo(0.5, 256);
  g.stroke();
  return c;
}

export function createMaterials(renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const asphaltTex = canvasTexture(asphaltCanvas(), { repeat: 1 / 4, anisotropy: aniso, srgb: false });
  const paverTex = canvasTexture(paverCanvas(), { repeat: 1 / 1.2, anisotropy: aniso, srgb: true });

  const mats = {
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex, vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
    paving: new THREE.MeshStandardMaterial({ map: paverTex, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }),
    marking: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    ghost: new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
    // Writes stencil 1 where a trench is, without touching colour or depth.
    mask: new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      side: THREE.DoubleSide,
    }),
  };

  const groundTex = canvasTexture(groundCanvas(), { repeat: 1500, anisotropy: aniso, srgb: true });
  mats.ground = new THREE.MeshStandardMaterial({
    map: groundTex,
    color: new THREE.Color('#6f7f5c'),
    roughness: 1,
    metalness: 0,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
  });

  const gridTex = canvasTexture(gridCanvas(), { repeat: 1, anisotropy: aniso, srgb: true });
  mats.grid = new THREE.MeshBasicMaterial({
    map: gridTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  return mats;
}

export function disposeMaterials(mats) {
  for (const m of Object.values(mats)) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
}
