/**
 * materials.js — Procedural fossil-bone, tooth, flesh and ground materials.
 * All textures are generated on a <canvas> at start-up: no image downloads.
 */

import {
  CanvasTexture, RepeatWrapping, SRGBColorSpace, MeshStandardMaterial,
  MeshPhysicalMaterial, Color, DoubleSide,
} from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Tileable value-noise fBm painted into an ImageData buffer. */
function fbmCanvas(size, seed, palette, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const G = 256;
  const grid = Array.from({ length: G * G }, () => r());
  // periodic value noise: `cells` lattice cells across the texture, wraps exactly
  const val = (x, y, cells) => {
    const gx = (x / size) * cells, gy = (y / size) * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => grid[(((y0 + j) % cells) % G) * G + (((x0 + i) % cells) % G)];
    return (g(0, 0) * (1 - ux) + g(1, 0) * ux) * (1 - uy) + (g(0, 1) * (1 - ux) + g(1, 1) * ux) * uy;
  };
  const oct = opts.octaves ?? 5;
  const baseCells = Math.max(1, Math.round(opts.base ?? 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, amp = 0.5, f = baseCells;
      let n = 0;
      for (let o = 0; o < oct; o++) { n += val(x, y, f) * amp; a += amp; amp *= 0.5; f *= 2; }
      n /= a;
      // streaky fibrous grain along one axis (cortical bone texture)
      const streak = opts.streak ? 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 48 + val(x, y, baseCells * 2) * 12) : 0.5;
      const t = Math.min(1, Math.max(0, (n - 0.25) * 1.9 * (1 - (opts.streak ?? 0)) + streak * (opts.streak ?? 0)));
      // palette ramp
      const k = t * (palette.length - 1);
      const i0 = Math.floor(k), i1 = Math.min(palette.length - 1, i0 + 1), u = k - i0;
      const p0 = palette[i0], p1 = palette[i1];
      const idx = (y * size + x) * 4;
      img.data[idx] = p0[0] + (p1[0] - p0[0]) * u;
      img.data[idx + 1] = p0[1] + (p1[1] - p0[1]) * u;
      img.data[idx + 2] = p0[2] + (p1[2] - p0[2]) * u;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // speckles / pits (weathering)
  if (opts.pits) {
    for (let i = 0; i < opts.pits; i++) {
      const x = r() * size, y = r() * size, rad = 0.4 + r() * 1.6;
      ctx.fillStyle = `rgba(20,12,6,${0.25 + r() * 0.35})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  }
  return c;
}

function tex(canvas, repeat = 1, srgb = true) {
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Bone finishes.  Plain (untextured) by default — clean matte colours read
 * best at a distance; the procedural fossil texture is optional.
 */
export const BONE_PRESETS = {
  ivory: { name: 'Plain ivory', color: 0xd9ceb6, rough: 0.72, tooth: 0xf1ead8 },
  sue:   { name: 'Plain brown (Sue)', color: 0x5a3d28, rough: 0.6, tooth: 0x2b1d12 },
  ochre: { name: 'Plain ochre', color: 0xb08a5a, rough: 0.7, tooth: 0x6a4d2e },
  cast:  { name: 'Plain grey cast', color: 0xb9b6ae, rough: 0.55, tooth: 0xdcd8cc },
};

/**
 * Per-fragment "real bone" finish (ported from the CFC3 skeleton). Injects a
 * 3-octave value-noise in object-local space so every bone shows cortical grain,
 * subtle warm mottling and roughness break-up. A shared `uFossil` uniform blends
 * the fresh-ivory look toward a darker mineralised fossil cast — this is what the
 * "Fossil finish" toggle drives, matching the reference skeleton's material.
 */
function makeBoneShaderMaterial(color, rough, shared) {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFossil = shared.uFossil;
    sh.uniforms.uGrain = shared.uGrain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLP; uniform float uFossil; uniform float uGrain;
        float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float nA = n3(vLP*11.0)*0.5 + n3(vLP*29.0)*0.3 + n3(vLP*83.0)*0.2;
        float nB = n3(vLP*2.7 + 5.0);
        float nFib = n3(vLP*vec3(6.0, 90.0, 6.0));                 // long-grain cortical fibres
        vec3 boneC = diffuseColor.rgb * (1.0 - uGrain*0.22 + uGrain*(0.34*nA + 0.10*nFib))
                     * mix(vec3(1.0), vec3(1.05,0.97,0.85), nB);
        vec3 fosC = mix(vec3(0.15,0.11,0.08), vec3(0.52,0.40,0.28), smoothstep(0.18,0.85,nA)) * (0.72 + 0.5*nB);
        diffuseColor.rgb = mix(boneC, fosC, uFossil);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (nA - 0.5)*0.28*uGrain + uFossil*0.10, 0.05, 1.0);`);
  };
  return m;
}

export function makeMaterials() {
  const bumpCanvas = fbmCanvas(256, 7, [[0, 0, 0], [255, 255, 255]], { octaves: 5, base: 6, pits: 900 });
  const bump = tex(bumpCanvas, 3, false);

  // Shared uniforms so every bone + tooth material reacts to one toggle.
  const shared = { uFossil: { value: 0 }, uGrain: { value: 1 } };

  const bone = makeBoneShaderMaterial(BONE_PRESETS.ivory.color, 0.72, shared);
  let textured = false;
  let preset = 'ivory';
  const apply = () => {
    const p = BONE_PRESETS[preset];
    bone.color.setHex(p.color);
    bone.roughness = p.rough;
    bone.bumpMap = bump;             // faint micro-pitting on top of the shader grain
    bone.bumpScale = 0.6;
    shared.uFossil.value = textured ? 1 : 0;
    bone.needsUpdate = true;
    tooth.color.setHex(p.tooth);
  };

  const tooth = makeBoneShaderMaterial(0xf1ead8, 0.32, shared);
  tooth.userData.tooth = true;
  apply();

  const fleshCanvas = fbmCanvas(256, 23, [[62, 58, 44], [84, 78, 58], [104, 96, 70], [70, 64, 50], [128, 116, 84]], { octaves: 6, base: 10, pits: 3000 });
  const flesh = new MeshPhysicalMaterial({
    color: 0xffffff, map: tex(fleshCanvas, 6), roughness: 0.8,
    bumpMap: bump, bumpScale: 3, transparent: true, opacity: 0.22,
    depthWrite: false, sheen: 0.4, sheenColor: new Color(0x9aa080),
  });

  const groundCanvas = fbmCanvas(512, 5, [[80, 70, 54], [104, 92, 70], [124, 110, 84], [96, 86, 64], [140, 126, 96]], { octaves: 6, base: 8, pits: 5000 });
  const ground = new MeshStandardMaterial({ map: tex(groundCanvas, 40), roughness: 0.95, bumpMap: tex(bumpCanvas, 60, false), bumpScale: 2 });

  return {
    bone, tooth, flesh, ground,
    setBonePreset(key) { preset = key; apply(); },
    setTextured(v) { textured = v; apply(); },
  };
}
