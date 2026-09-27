import * as THREE from "three";

// All textures are generated procedurally on <canvas> so the prototype has zero external
// asset dependencies and stays trivial to run offline.

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function asphaltTexture({ repeatX = 1, repeatY = 40, laneLines = true } = {}) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#232528";
  ctx.fillRect(0, 0, 256, 256);

  // grain / speckle
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 30 + Math.random() * 55;
    ctx.fillStyle = `rgba(${g + 10},${g + 10},${g + 14},${0.15 + Math.random() * 0.2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // subtle tire scrub streaks
  ctx.strokeStyle = "rgba(10,10,12,0.25)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 10; i++) {
    const x = 20 + Math.random() * 216;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 30, 256);
    ctx.stroke();
  }

  if (laneLines) {
    // dashed center-ish accents (decorative racing line hints)
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let y = 0; y < 256; y += 36) {
      ctx.fillRect(126, y, 4, 20);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function hazardStripeTexture(colorA = "#ffb81c", colorB = "#141414") {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-64, -64);
  for (let i = -2; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(i * 32, 0, 32, 256);
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function checkerTexture(a = "#f4f4f4", b = "#111111", n = 8) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  const s = 256 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function fenceAlphaTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = "rgba(210,215,220,0.85)";
  ctx.lineWidth = 2;
  const step = 16;
  for (let x = -128; x < 256; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 128, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + 128, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 4);
  return tex;
}

export function metalPanelTexture(base = "#3a3f45") {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(256, i * 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64, 256);
    ctx.stroke();
  }
  // rivets
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 32; y < 256; y += 64) {
    for (let x = 32; x < 256; x += 64) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // rust streaks
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 256;
    const grad = ctx.createLinearGradient(x, 0, x, 256);
    grad.addColorStop(0, "rgba(150,70,20,0)");
    grad.addColorStop(0.5, "rgba(150,70,20,0.18)");
    grad.addColorStop(1, "rgba(150,70,20,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 6 + Math.random() * 10, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function crowdTexture() {
  const c = makeCanvas(256, 64);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14171b";
  ctx.fillRect(0, 0, 256, 64);
  const colors = ["#ffb81c", "#c94c3d", "#3d7fc9", "#5fae5a", "#c9a63d", "#8a52b0", "#e8e8e8"];
  for (let y = 6; y < 64; y += 9) {
    for (let x = (y % 18); x < 256; x += 9) {
      ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
      ctx.beginPath();
      ctx.arc(x + Math.random() * 2, y + Math.random() * 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function groundTexture() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2c3520";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 30 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g + 20},${g + 45},${g + 10},0.5)`;
    ctx.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
