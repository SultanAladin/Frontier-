// Procedural canvas textures for every surface the road editor can lay down.
// Everything is generated at runtime: no image files, no network fetches, and every
// tile is periodic so it repeats seamlessly along a road's UV parameterisation.

import * as THREE from 'three';
import { clamp, lerp, makeRng } from './util.js';

const SIZE = 256;
const cache = new Map();

function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise — wraps at `period` so tiles butt seamlessly. */
function periodicNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v) => ((v % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

function periodicFbm(x, y, period, seed, octaves = 4) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicNoise(x * freq, y * freq, period * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

function createCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Paint a tile. `painter(u, v, i, j)` returns { r, g, b, h } in 0..255 / 0..1 space
 * where `h` is a height used to derive the normal map.
 */
function paintTile(size, painter) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const height = new Float32Array(size * size);
  const out = { r: 0, g: 0, b: 0, h: 0.5 };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      painter(i / size, j / size, i, j, out);
      const idx = j * size + i;
      data[idx * 4 + 0] = out.r;
      data[idx * 4 + 1] = out.g;
      data[idx * 4 + 2] = out.b;
      data[idx * 4 + 3] = 255;
      height[idx] = out.h;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, height };
}

/** Sobel a height field into a tangent-space normal map tile. */
function normalFromHeight(height, size, strength = 2.2) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx =
        at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1) -
        (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1));
      const dy =
        at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1) -
        (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1));
      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const idx = (j * size + i) * 4;
      data[idx + 0] = (nx * 0.5 + 0.5) * 255;
      data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      data[idx + 2] = (nz / len) * 0.5 * 255 + 127.5;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function whiteTile(size = 8) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function toTexture(canvas, { srgb = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Surface painters                                                     */
/* ------------------------------------------------------------------ */

const painters = {
  asphalt(u, v, i, j, out, seed) {
    const grain = periodicFbm(u * 48, v * 48, 48, seed, 4);
    const fine = periodicNoise(u * 190, v * 190, 190, seed + 91);
    // Aggregate chips: bright flecks where a stone catches the light.
    const chip = periodicNoise(u * 96, v * 96, 96, seed + 5);
    const chipLit = chip > 0.78 ? (chip - 0.78) * 3.4 : 0;
    const base = 46 + grain * 16 + fine * 10 + chipLit * 26;
    out.r = base;
    out.g = base + 1.5;
    out.b = base + 4;
    out.h = 0.45 + grain * 0.16 + fine * 0.12 + chipLit * 0.3;
  },
  asphaltWorn(u, v, i, j, out, seed) {
    painters.asphalt(u, v, i, j, out, seed);
    // Faded wheel-path polishing and a few patched seams.
    const polish = periodicFbm(u * 9, v * 9, 9, seed + 31, 3);
    const wear = clamp((polish - 0.5) * 1.6, 0, 1);
    const crack = Math.abs(periodicFbm(u * 14, v * 14, 14, seed + 77, 3) - 0.5);
    const crackLine = crack < 0.015 ? 1 - crack / 0.015 : 0;
    const shade = 1 + wear * 0.18 - crackLine * 0.55;
    out.r = clamp(out.r * shade, 0, 255);
    out.g = clamp(out.g * shade, 0, 255);
    out.b = clamp(out.b * shade, 0, 255);
    out.h = clamp(out.h - crackLine * 0.4, 0, 1);
  },
  concrete(u, v, i, j, out, seed) {
    const mottle = periodicFbm(u * 22, v * 22, 22, seed, 4);
    const fine = periodicNoise(u * 120, v * 120, 120, seed + 13);
    const base = 132 + mottle * 22 + fine * 8;
    out.r = base;
    out.g = base + 1;
    out.b = base - 3;
    out.h = 0.5 + mottle * 0.1 + fine * 0.06;
  },
  slab(u, v, i, j, out, seed) {
    // 0.9 m paving slabs laid out on a half-offset grid.
    const cols = 2;
    const rows = 2;
    const cx = u * cols;
    const cy = v * rows;
    const col = Math.floor(cx);
    const row = Math.floor(cy);
    const ox = ((row % 2) * 0.5 + cx) % 1;
    const oy = cy % 1;
    const edge = Math.min(ox, 1 - ox, oy, 1 - oy);
    const joint = edge < 0.028 ? 1 - edge / 0.028 : 0;
    const tone = hash2(col, row, seed) * 14;
    const mottle = periodicFbm(u * 40, v * 40, 40, seed, 3) * 12;
    const base = 150 + tone + mottle - joint * 44;
    out.r = base;
    out.g = base - 1;
    out.b = base - 6;
    out.h = 0.52 + tone / 120 - joint * 0.35;
  },
  brick(u, v, i, j, out, seed) {
    const rows = 10;
    const cols = 5;
    const ry = v * rows;
    const row = Math.floor(ry);
    const offset = (row % 2) * 0.5;
    const rx = (u * cols + offset) % cols;
    const col = Math.floor(rx);
    const ox = rx - col;
    const oy = ry - row;
    const edge = Math.min(ox, 1 - ox) * 0.55;
    const edgeY = Math.min(oy, 1 - oy);
    const mortar = Math.min(edge, edgeY) < 0.045 ? 1 : 0;
    const tone = hash2(col, row, seed);
    const grain = periodicNoise(u * 160, v * 160, 160, seed + 3) * 16;
    const r = mortar ? 128 + grain * 0.4 : 116 + tone * 52 + grain;
    const g = mortar ? 128 + grain * 0.4 : 62 + tone * 30 + grain * 0.8;
    const b = mortar ? 124 + grain * 0.4 : 50 + tone * 22 + grain * 0.8;
    out.r = r;
    out.g = g;
    out.b = b;
    out.h = mortar ? 0.4 : 0.56 + tone * 0.06;
  },
  sett(u, v, i, j, out, seed) {
    // Granite setts: jittered rectangles on a staggered grid.
    const cols = 8;
    const rows = 8;
    const ry = v * rows;
    const row = Math.floor(ry);
    const offset = (row % 2) * 0.5;
    const rx = (u * cols + offset) % cols;
    const col = Math.floor(rx);
    const ox = rx - col;
    const oy = ry - row;
    const jitterX = (hash2(col, row, seed + 2) - 0.5) * 0.14;
    const jitterY = (hash2(col, row, seed + 7) - 0.5) * 0.14;
    const dx = Math.abs(ox - 0.5 - jitterX);
    const dy = Math.abs(oy - 0.5 - jitterY);
    const inside = dx < 0.42 && dy < 0.4;
    const bevel = inside ? clamp((0.42 - dx) * 8, 0, 1) * clamp((0.4 - dy) * 8, 0, 1) : 0;
    const tone = hash2(col, row, seed + 11);
    const grain = periodicNoise(u * 200, v * 200, 200, seed) * 18;
    const base = inside ? 96 + tone * 70 + grain : 62 + grain * 0.5;
    out.r = base;
    out.g = base + (tone > 0.6 ? 4 : 0);
    out.b = base + 6;
    out.h = inside ? 0.55 + bevel * 0.25 : 0.32;
  },
  stone(u, v, i, j, out, seed) {
    // Large irregular flagstones.
    const gx = u * 4;
    const gy = v * 4;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const ox = gx - cx;
    const oy = gy - cy;
    const warp = periodicFbm(u * 8, v * 8, 8, seed + 21, 3) * 0.16;
    const edge = Math.min(ox + warp, 1 - ox - warp, oy - warp, 1 - oy + warp);
    const joint = edge < 0.05 ? 1 - edge / 0.05 : 0;
    const tone = hash2(cx, cy, seed) * 26;
    const mottle = periodicFbm(u * 30, v * 30, 30, seed + 4, 4) * 20;
    const base = 138 + tone + mottle - joint * 50;
    out.r = base;
    out.g = base - 2;
    out.b = base - 10;
    out.h = 0.54 + tone / 120 - joint * 0.34;
  },
  grass(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 34, v * 34, 34, seed, 4);
    const blade = periodicNoise(u * 150, v * 150, 150, seed + 8) * 0.5;
    const patch = periodicFbm(u * 6, v * 6, 6, seed + 44, 2);
    const g = 76 + n * 46 + blade * 22 + patch * 16;
    out.r = 42 + n * 26 + patch * 10;
    out.g = g;
    out.b = 38 + n * 20;
    out.h = 0.4 + n * 0.25 + blade * 0.2;
  },
  gravel(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 40, v * 40, 40, seed, 4);
    const pebble = periodicNoise(u * 110, v * 110, 110, seed + 2);
    const lit = pebble > 0.72 ? (pebble - 0.72) * 3 : 0;
    const base = 118 + n * 34 + lit * 40;
    out.r = base;
    out.g = base - 8;
    out.b = base - 26;
    out.h = 0.4 + n * 0.2 + lit * 0.35;
  },
  dirt(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 26, v * 26, 26, seed, 4);
    const fine = periodicNoise(u * 120, v * 120, 120, seed + 9) * 12;
    const base = 92 + n * 40 + fine;
    out.r = base;
    out.g = base - 22;
    out.b = base - 46;
    out.h = 0.42 + n * 0.22;
  },
  sand(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 30, v * 30, 30, seed, 3);
    const ripple = Math.sin((u + n * 0.2) * Math.PI * 16) * 0.5 + 0.5;
    const base = 176 + n * 26 + ripple * 12;
    out.r = base;
    out.g = base - 18;
    out.b = base - 58;
    out.h = 0.45 + ripple * 0.1;
  },
  timber(u, v, i, j, out, seed) {
    const boards = 6;
    const by = v * boards;
    const row = Math.floor(by);
    const oy = by - row;
    const gap = Math.min(oy, 1 - oy) < 0.05 ? 1 : 0;
    const grain = periodicFbm(u * 4, v * 60 + row * 13, 4, seed + row, 3);
    const tone = hash2(row, 3, seed) * 24;
    const base = gap ? 62 : 118 + tone + grain * 34;
    out.r = base;
    out.g = base - 34;
    out.b = base - 66;
    out.h = gap ? 0.3 : 0.5 + grain * 0.15;
  },
  ballast(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 54, v * 54, 54, seed, 4);
    const chip = periodicNoise(u * 130, v * 130, 130, seed + 6);
    const lit = chip > 0.66 ? (chip - 0.66) * 2.6 : 0;
    const base = 92 + n * 44 + lit * 46;
    out.r = base;
    out.g = base - 4;
    out.b = base - 14;
    out.h = 0.35 + n * 0.3 + lit * 0.4;
  },
  tile(u, v, i, j, out, seed) {
    // Glazed subway wall tiles.
    const cols = 8;
    const rows = 8;
    const cx = u * cols;
    const cy = v * rows;
    const col = Math.floor(cx);
    const row = Math.floor(cy);
    const ox = cx - col;
    const oy = cy - row;
    const grout = Math.min(ox, 1 - ox, oy, 1 - oy) < 0.06 ? 1 : 0;
    const tone = hash2(col, row, seed) * 10;
    const base = grout ? 150 : 208 + tone;
    out.r = base - (grout ? 6 : 14);
    out.g = base;
    out.b = base + (grout ? 4 : 6);
    out.h = grout ? 0.45 : 0.62;
  },
  metal(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 60, v * 8, 60, seed, 3);
    const base = 132 + n * 30;
    out.r = base;
    out.g = base + 3;
    out.b = base + 8;
    out.h = 0.5 + n * 0.1;
  },
  wall(u, v, i, j, out, seed) {
    const mottle = periodicFbm(u * 18, v * 18, 18, seed, 4);
    const formLines = Math.abs(((v * 4) % 1) - 0.5) < 0.012 ? 1 : 0;
    const tie = periodicNoise(u * 24, v * 24, 24, seed + 5);
    const tieHole = tie > 0.94 ? 1 : 0;
    const streak = clamp(periodicFbm(u * 3, v * 40, 3, seed + 19, 3) - 0.4, 0, 1);
    const base = 128 + mottle * 20 - formLines * 18 - tieHole * 26 - streak * 22;
    out.r = base;
    out.g = base;
    out.b = base - 4;
    out.h = 0.5 - formLines * 0.2 - tieHole * 0.3;
  },
  facade(u, v, i, j, out, seed) {
    // Rainscreen panels with punched windows: cols x rows per tile.
    const cols = 4;
    const rows = 5;
    const cx = u * cols;
    const cy = v * rows;
    const col = Math.floor(cx);
    const row = Math.floor(cy);
    const ox = cx - col;
    const oy = cy - row;
    const tone = hash2(col, row, seed);
    // window opening
    const inX = ox > 0.16 && ox < 0.84;
    const inY = oy > 0.2 && oy < 0.74;
    const mullion = Math.abs(ox - 0.5) < 0.02 || Math.abs(oy - 0.47) < 0.015;
    const grain = periodicNoise(u * 150, v * 150, 150, seed + 2) * 10;
    if (inX && inY) {
      const lit = hash2(col * 7 + 3, row * 13 + 5, seed + 21);
      const base = lit > 0.82 ? 46 + lit * 40 : 24 + lit * 26;
      out.r = base;
      out.g = base + 4;
      out.b = base + 12;
      out.h = mullion ? 0.55 : 0.3;
      return;
    }
    const base = 118 + tone * 26 + grain;
    out.r = base;
    out.g = base - 2;
    out.b = base - 10;
    out.h = 0.5 + tone * 0.05;
  },
  sleepers(u, v, i, j, out, seed) {
    // Ballast with a repeating concrete/wood sleeper pattern along v.
    painters.ballast(u, v, i, j, out, seed);
    const pitch = 6; // sleepers per tile
    const sv = (v * pitch) % 1;
    if (sv < 0.34) {
      const grain = periodicNoise(u * 90, v * 90, 90, seed + 3) * 14;
      const tone = hash2(Math.floor(v * pitch), 0, seed) * 18;
      out.r = 108 + tone + grain;
      out.g = 96 + tone + grain;
      out.b = 80 + tone + grain;
      out.h = 0.62;
    }
  },
  kerb(u, v, i, j, out, seed) {
    const n = periodicFbm(u * 30, v * 30, 30, seed, 3);
    const fine = periodicNoise(u * 140, v * 140, 140, seed + 4) * 10;
    const base = 142 + n * 20 + fine;
    out.r = base;
    out.g = base;
    out.b = base - 4;
    out.h = 0.55 + n * 0.08;
  },
};

/**
 * Surface library. `metersPerTile` drives the UV scale baked while extruding road
 * geometry so a texture always covers the same real-world area.
 */
export const SURFACES = {
  asphalt: { painter: 'asphalt', color: 0x6a6d72, roughness: 0.92, metersPerTile: 8, seed: 11 },
  asphaltWorn: { painter: 'asphaltWorn', color: 0x66696e, roughness: 0.95, metersPerTile: 8, seed: 27 },
  concrete: { painter: 'concrete', color: 0x9a9a96, roughness: 0.86, metersPerTile: 6, seed: 33 },
  slab: { painter: 'slab', color: 0xa8a8a4, roughness: 0.8, metersPerTile: 1.8, seed: 41 },
  brick: { painter: 'brick', color: 0xa0705c, roughness: 0.82, metersPerTile: 2.4, seed: 53 },
  sett: { painter: 'sett', color: 0x8d8d8d, roughness: 0.85, metersPerTile: 2.2, seed: 61 },
  stone: { painter: 'stone', color: 0x9e9c96, roughness: 0.78, metersPerTile: 4, seed: 71 },
  grass: { painter: 'grass', color: 0x6f8a4a, roughness: 0.95, metersPerTile: 4, seed: 83 },
  gravel: { painter: 'gravel', color: 0x9b8f78, roughness: 0.98, metersPerTile: 3, seed: 97 },
  dirt: { painter: 'dirt', color: 0x8a6f4c, roughness: 0.99, metersPerTile: 5, seed: 103 },
  sand: { painter: 'sand', color: 0xc9b583, roughness: 0.98, metersPerTile: 4, seed: 109 },
  timber: { painter: 'timber', color: 0x8a6440, roughness: 0.85, metersPerTile: 2, seed: 113 },
  ballast: { painter: 'ballast', color: 0x8b8578, roughness: 0.97, metersPerTile: 3, seed: 127 },
  tile: { painter: 'tile', color: 0xd8e2e0, roughness: 0.35, metersPerTile: 2, seed: 131 },
  metal: { painter: 'metal', color: 0x9aa0a6, roughness: 0.45, metalness: 0.85, metersPerTile: 2, seed: 137 },
  wall: { painter: 'wall', color: 0x8f8f8b, roughness: 0.9, metersPerTile: 4, seed: 149 },
  kerb: { painter: 'kerb', color: 0xa9a9a4, roughness: 0.78, metersPerTile: 2, seed: 151 },
  sleepers: { painter: 'sleepers', color: 0x8b8578, roughness: 0.97, metersPerTile: 2.4, seed: 163 },
  facade: { painter: 'facade', color: 0xa9a6a0, roughness: 0.72, metersPerTile: 3.6, seed: 173 },
  roof: { painter: 'roof', color: 0x6f7276, roughness: 0.92, metersPerTile: 6, seed: 179 },
};

let cachedWhite = null;

export function getSurfaceMaterialSet(key) {
  if (cache.has(key)) return cache.get(key);
  const def = SURFACES[key] || SURFACES.asphalt;
  const painter = painters[def.painter] || painters.asphalt;
  const { canvas, height } = paintTile(SIZE, (u, v, i, j, out) => painter(u, v, i, j, out, def.seed));
  const normalCanvas = normalFromHeight(height, SIZE, def.painter === 'grass' ? 1.2 : 2.0);
  const set = {
    map: toTexture(canvas, { srgb: true }),
    normalMap: toTexture(normalCanvas),
    color: def.color,
    roughness: def.roughness,
    metalness: def.metalness ?? 0.02,
    metersPerTile: def.metersPerTile,
  };
  cache.set(key, set);
  return set;
}

/** Flat white 1x1 texture, used for painting markings and untextured helpers. */
export function getWhiteTexture() {
  if (!cachedWhite) cachedWhite = toTexture(whiteTile(4), { srgb: true });
  return cachedWhite;
}

/* ------------------------------------------------------------------ */
/* Marking textures (dashes, chevrons, arrows, zebra, glyphs)           */
/* ------------------------------------------------------------------ */

const markingCache = new Map();

/**
 * Painter-driven marking tile. Markings are painted white and tinted by the
 * material, so a single texture serves white, yellow and thermoplastic colours.
 */
function makeMarkingTexture(key, w, h, painter) {
  if (markingCache.has(key)) return markingCache.get(key);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  painter(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  markingCache.set(key, texture);
  return texture;
}

/**
 * Longitudinal line tile. `pattern` is [dash, gap, dash, gap...] expressed as a
 * fraction of the tile length; the tile length is set by the caller in metres.
 */
export function getLineTexture(pattern) {
  const key = `line:${pattern.join('_')}`;
  return makeMarkingTexture(key, 8, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    let y = 0;
    const total = pattern.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < pattern.length; i += 2) {
      const dash = (pattern[i] / total) * h;
      ctx.fillRect(0, y, w, dash);
      y += dash + (pattern[i + 1] !== undefined ? (pattern[i + 1] / total) * h : 0);
    }
  });
}

/** Zebra / ladder crossing stripes across the carriageway. */
export function getZebraTexture(stripes = 8, kind = 'zebra') {
  const key = `cross:${kind}:${stripes}`;
  return makeMarkingTexture(key, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    if (kind === 'ladder') {
      // Two thin transverse bars with square blocks between them.
      ctx.fillRect(0, h * 0.1, w, h * 0.055);
      ctx.fillRect(0, h * 0.845, w, h * 0.055);
    }
    const usable = h * (kind === 'ladder' ? 0.69 : 0.92);
    const start = h * (kind === 'ladder' ? 0.155 : 0.04);
    const pitch = usable / stripes;
    const barWidth = kind === 'ladder' ? pitch * 0.62 : pitch * 0.5;
    for (let i = 0; i < stripes; i++) {
      const x = i * pitch + (kind === 'ladder' ? (pitch - barWidth) / 2 : pitch * 0.18);
      ctx.fillRect(x, start, barWidth, usable);
    }
  });
}

/** Give-way shark's teeth row across a lane. */
export function getGiveWayTexture(teeth = 6) {
  const key = `giveway:${teeth}`;
  return makeMarkingTexture(key, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    const pitch = w / teeth;
    for (let i = 0; i < teeth; i++) {
      ctx.beginPath();
      ctx.moveTo(i * pitch, h * 0.9);
      ctx.lineTo((i + 1) * pitch, h * 0.9);
      ctx.lineTo(i * pitch + pitch * 0.5, h * 0.12);
      ctx.closePath();
      ctx.fill();
    }
  });
}

const ARROW_PATHS = {
  ahead: (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.06);
    ctx.lineTo(w * 0.86, h * 0.42);
    ctx.lineTo(w * 0.66, h * 0.42);
    ctx.lineTo(w * 0.66, h * 0.94);
    ctx.lineTo(w * 0.34, h * 0.94);
    ctx.lineTo(w * 0.34, h * 0.42);
    ctx.lineTo(w * 0.14, h * 0.42);
    ctx.closePath();
    ctx.fill();
  },
  left: (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(w * 0.08, h * 0.46);
    ctx.lineTo(w * 0.08, h * 0.72);
    ctx.lineTo(w * 0.38, h * 0.72);
    ctx.lineTo(w * 0.38, h * 0.96);
    ctx.lineTo(w * 0.62, h * 0.96);
    ctx.lineTo(w * 0.62, h * 0.46);
    ctx.lineTo(w * 0.86, h * 0.46);
    ctx.lineTo(w * 0.86, h * 0.22);
    ctx.lineTo(w * 0.62, h * 0.22);
    ctx.closePath();
    ctx.fill();
    // arrow head
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.5);
    ctx.lineTo(w * 0.36, h * 0.06);
    ctx.lineTo(w * 0.66, h * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  right: (ctx, w, h) => {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ARROW_PATHS.left(ctx, w, h);
    ctx.restore();
  },
  aheadLeft: (ctx, w, h) => {
    // Straight-on arrow with a left-turn spur.
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.06);
    ctx.lineTo(w * 0.86, h * 0.42);
    ctx.lineTo(w * 0.66, h * 0.42);
    ctx.lineTo(w * 0.66, h * 0.58);
    ctx.lineTo(w * 0.36, h * 0.58);
    ctx.lineTo(w * 0.36, h * 0.94);
    ctx.lineTo(w * 0.16, h * 0.94);
    ctx.lineTo(w * 0.16, h * 0.34);
    ctx.lineTo(w * 0.34, h * 0.34);
    ctx.closePath();
    ctx.fill();
    // left spur + head
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.34);
    ctx.lineTo(w * 0.04, h * 0.34);
    ctx.lineTo(w * 0.04, h * 0.14);
    ctx.lineTo(w * 0.28, h * 0.14);
    ctx.closePath();
    ctx.fill();
  },
  aheadRight: (ctx, w, h) => {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ARROW_PATHS.aheadLeft(ctx, w, h);
    ctx.restore();
  },
  diamond: (ctx, w, h) => {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.12);
    ctx.lineTo(w * 0.86, h * 0.5);
    ctx.lineTo(w * 0.5, h * 0.88);
    ctx.lineTo(w * 0.14, h * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  bus: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BUS', w * 0.5, h * 0.52);
  },
  taxi: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.52)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', w * 0.5, h * 0.52);
  },
  cycle: (ctx, w, h) => {
    // Bicycle pictogram, drawn with strokes.
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = h * 0.26;
    ctx.lineWidth = h * 0.075;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - r * 1.02, cy + r * 0.28, r, 0, Math.PI * 2);
    ctx.moveTo(cx + r * 1.02, cy + r * 0.28);
    ctx.arc(cx + r * 1.02, cy + r * 0.28, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.02, cy + r * 0.28);
    ctx.lineTo(cx - r * 0.1, cy - r * 0.5);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.5);
    ctx.moveTo(cx - r * 0.1, cy - r * 0.5);
    ctx.lineTo(cx + r * 0.1, cy + r * 0.28);
    ctx.lineTo(cx + r * 1.02, cy + r * 0.28);
    ctx.stroke();
  },
  speed: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.66)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('30', w * 0.5, h * 0.54);
  },
  keepClear: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KEEP', w * 0.5, h * 0.28);
    ctx.fillText('CLEAR', w * 0.5, h * 0.72);
  },
  stop: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', w * 0.5, h * 0.52);
  },
  slow: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SLOW', w * 0.5, h * 0.52);
  },
  look: (ctx, w, h) => {
    ctx.font = `bold ${Math.floor(h * 0.24)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LOOK', w * 0.5, h * 0.3);
    ctx.fillText('BOTH WAYS', w * 0.5, h * 0.7);
  },
};

/** Road glyph (arrow / word) drawn white on transparent. */
export function getGlyphTexture(name, color = '#ffffff', stroke = false) {
  const key = `glyph:${name}:${color}:${stroke}`;
  return makeMarkingTexture(key, 256, 256, (ctx, w, h) => {
    const path = ARROW_PATHS[name] || ARROW_PATHS.ahead;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    path(ctx, w, h);
  });
}

export const GLYPH_NAMES = Object.keys(ARROW_PATHS);

/** Yellow tactile paving studs used at bus stops, crossings and platforms. */
export function getTactileTexture() {
  return makeMarkingTexture('tactile', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d8b23a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b8942a';
    const pitch = w / 8;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc((i + 0.5) * pitch, (j + 0.5) * pitch, pitch * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Diamond / hatched buffer strip. */
export function getHatchTexture(angle = 45, spacing = 32) {
  const key = `hatch:${angle}:${spacing}`;
  return makeMarkingTexture(key, 128, 128, (ctx, w, h) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = spacing * 0.35;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((angle * Math.PI) / 180);
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * spacing, -h);
      ctx.lineTo(i * spacing, h);
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** Cycle-lane surface tint with a subtle bike logo repeat. */
export function getCycleLaneTint(color = '#3f7a4a') {
  return makeMarkingTexture(`cycletint:${color}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) ctx.fillRect(i * (w / 3) + 6, h * 0.42, w / 3 - 12, h * 0.16);
    ctx.globalAlpha = 1;
  });
}

/** Bus-lane surface tint. */
export function getBusLaneTint(color = '#5a4a3f') {
  return makeMarkingTexture(`bustint:${color}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Crude water surface: gentle ripple normals + deep blue body. */
export function getWaterTextures() {
  const key = 'water';
  if (cache.has(key)) return cache.get(key);
  const { height } = paintTile(128, (u, v, i, j, out) => {
    const ripple =
      Math.sin((u * 7 + periodicFbm(u * 5, v * 5, 5, 7, 2) * 3) * Math.PI * 2) * 0.5 +
      Math.sin((v * 9 + periodicFbm(u * 4, v * 4, 4, 19, 2) * 2) * Math.PI * 2) * 0.5;
    out.r = 24;
    out.g = 48;
    out.b = 62;
    out.h = 0.5 + ripple * 0.25;
  });
  const normal = normalFromHeight(height, 128, 1.4);
  const set = { normalMap: toTexture(normal) };
  cache.set(key, set);
  return set;
}

/** Round soft shadow blob for prop contact shadows. */
export function getShadowTexture() {
  return makeMarkingTexture('shadow', 64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function disposeTextureCaches() {
  for (const set of cache.values()) {
    set.map?.dispose();
    set.normalMap?.dispose();
  }
  cache.clear();
  for (const texture of markingCache.values()) texture.dispose();
  markingCache.clear();
  cachedWhite = null;
}


export { SIZE as TEXTURE_SIZE };
