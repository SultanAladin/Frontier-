// Material factory.  Surface materials are keyed by `surface` or `surface|tintHex`
// so a cycle lane can reuse the asphalt texture with a coloured multiply.

import * as THREE from 'three';
import {
  SURFACES,
  getBusLaneTint,
  getCycleLaneTint,
  getGlyphTexture,
  getHatchTexture,
  getLineTexture,
  getShadowTexture,
  getSurfaceMaterialSet,
  getTactileTexture,
  getWaterTextures,
  getWhiteTexture,
  getZebraTexture,
  getGiveWayTexture,
} from './textures.js';

const surfaceCache = new Map();
const markingCache = new Map();
let groundOpacity = 1;
let wireframe = false;

function parseKey(key) {
  const [surface, tintHex] = key.split('|');
  return { surface, tint: tintHex ? parseInt(tintHex, 16) : null };
}

/** Shared opaque material for one surface (optionally colour-tinted). */
export function getSurfaceMaterial(key) {
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const { surface, tint } = parseKey(key);
  if (!SURFACES[surface]) console.warn(`[road-editor] unknown surface "${surface}", falling back to asphalt`);
  const set = getSurfaceMaterialSet(SURFACES[surface] ? surface : 'asphalt');
  const material = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    color: new THREE.Color(tint ?? 0xffffff).multiply(new THREE.Color(set.color)),
    roughness: set.roughness,
    metalness: set.metalness ?? 0.02,
    dithering: true,
  });
  material.userData.surfaceKey = key;
  material.userData.baseColor = material.color.clone();
  material.userData.metersPerTile = set.metersPerTile;
  surfaceCache.set(key, material);
  return material;
}

/** Tinted cycle / bus lane overlay decal material. */
export function getLaneTintMaterial(kind) {
  const key = `tint:${kind}`;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const map = kind === 'bus' ? getBusLaneTint() : getCycleLaneTint(kind === 'cycle-red' ? '#7a3b32' : '#2f6f4a');
  const material = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    opacity: 0.55,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  material.userData.isMarking = true;
  surfaceCache.set(key, material);
  return material;
}

/**
 * Road-marking decal material.  `map` may be a longitudinal dash tile, a glyph or
 * null for plain painted areas such as stop bars.
 */
export function getMarkingMaterial(mapKey, options = {}) {
  const {
    color = 0xf2f2ee,
    opacity = 1,
    map = null,
    repeat = [1, 1],
    emissive = 0,
    transparent = true,
    side = THREE.FrontSide,
    depthWrite = false,
  } = options;
  const key = `mark:${mapKey}:${color}:${opacity}:${map ? map.uuid : 'plain'}:${repeat.join('x')}:${emissive}:${side}:${depthWrite}`;
  if (markingCache.has(key)) return markingCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color,
    map: map || getWhiteTexture(),
    transparent,
    opacity,
    roughness: 0.7,
    metalness: 0,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: emissive ? 1 : 0,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    depthWrite,
    side,
  });
  if (map) {
    material.map.repeat.set(repeat[0], repeat[1]);
  }
  material.userData.isMarking = true;
  markingCache.set(key, material);
  return material;
}

export function getLineMaterial(pattern, color = 0xf2f2ee, metersPerTile = 6) {
  const map = getLineTexture(pattern);
  const texture = map.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  const material = getMarkingMaterial(`line:${pattern.join('_')}:${metersPerTile}`, { color, map: texture });
  material.userData.patternMeters = metersPerTile;
  return material;
}

export function getZebraMaterial(stripes, kind = 'zebra') {
  return getMarkingMaterial(`zebra:${kind}:${stripes}`, { map: getZebraTexture(stripes, kind) });
}

export function getGiveWayMaterial(teeth = 6) {
  return getMarkingMaterial(`giveway:${teeth}`, { map: getGiveWayTexture(teeth) });
}

export function getGlyphMaterial(name, color = 0xf2f2ee) {
  return getMarkingMaterial(`glyph:${name}:${color}`, { map: getGlyphTexture(name, `#${new THREE.Color(color).getHexString()}`) });
}

export function getHatchMaterial(angle = 45) {
  return getMarkingMaterial(`hatch:${angle}`, { map: getHatchTexture(angle) });
}

export function getTactileMaterial() {
  return getMarkingMaterial('tactile', { map: getTactileTexture(), color: 0xffffff, opacity: 1 });
}

export function getWaterMaterial() {
  const key = 'water';
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const { normalMap } = getWaterTextures();
  const material = new THREE.MeshStandardMaterial({
    color: 0x2b4c5c,
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity: 0.86,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  material.userData.isWater = true;
  surfaceCache.set(key, material);
  return material;
}

export function getGlassMaterial(color = 0x9fd8e8) {
  const key = `glass:${color}`;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
  });
  surfaceCache.set(key, material);
  return material;
}

export function getPlainMaterial(color, options = {}) {
  const key = `plain:${color}:${JSON.stringify(options)}`;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...options });
  surfaceCache.set(key, material);
  return material;
}

export function getShadowMaterial() {
  const key = 'contact-shadow';
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const material = new THREE.MeshBasicMaterial({
    map: getShadowTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  surfaceCache.set(key, material);
  return material;
}

/** Emissive lamp glass used by street lights, tunnel bands and subway lighting. */
export function getLampMaterial(color = 0xffe6b8, intensity = 1.6) {
  const key = `lamp:${color}:${intensity}`;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
  surfaceCache.set(key, material);
  return material;
}

/**
 * X-ray: fade the ground (terrain + road surfaces) so subway tunnels and
 * under-passes become visible from above.
 */
export function setGroundOpacity(value) {
  groundOpacity = value;
  const transparent = value < 0.999;
  for (const material of surfaceCache.values()) {
    if (material.userData.isWater) continue;
    if (material.userData.isMarking) {
      material.opacity = material.userData.baseOpacity ?? material.opacity;
      continue;
    }
    material.transparent = transparent;
    material.opacity = value;
    material.depthWrite = !transparent;
    material.needsUpdate = true;
  }
}

export function getGroundOpacity() {
  return groundOpacity;
}

export function setWireframe(enabled) {
  wireframe = enabled;
  for (const material of surfaceCache.values()) {
    material.wireframe = enabled;
    material.needsUpdate = true;
  }
}

export function isWireframe() {
  return wireframe;
}

export function disposeMaterials() {
  for (const material of surfaceCache.values()) material.dispose();
  surfaceCache.clear();
  for (const material of markingCache.values()) material.dispose();
  markingCache.clear();
}
