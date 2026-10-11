// Frontier Road Generator Studio — Procedural PBR Texture Layer Stack & Real-Time Compositor

export const PAVING_PATTERNS = [
  { id: 'herringbone', name: '45° Herringbone Brick Bond', desc: 'Interlocking clay/granite block pavers' },
  { id: 'ashlar', name: 'Ashlar Cut Granite Slabs', desc: 'Staggered architectural stone slabs' },
  { id: 'munich-hex', name: 'Munich Hexagonal Plaza Tiles', desc: 'Chamfered hexagonal concrete pavers' },
  { id: 'basketweave', name: 'Paired Basketweave Brick', desc: 'Alternating orthogonal brick pairs' },
  { id: 'cobble-fan', name: 'European Roman Fan Cobblestone', desc: 'Arched porphyry sett courses' },
  { id: 'terrazzo', name: 'Polished Aggregate Terrazzo', desc: 'Marble-chip transit plaza slabs' },
  { id: 'running-bond', name: ' Stretcher Running Bond', desc: 'Offset rectangular concrete flags' },
  { id: 'slate', name: 'Riven Dark Basalt Slate', desc: 'Split-face dark natural stone' },
  { id: 'permeable', name: 'Permeable Eco-Grid Pavers', desc: 'Concrete lattice with gravel/turf cells' },
];

export const DEFAULT_TEXTURE_LAYERS = [
  {
    id: 'layer-asphalt-base',
    name: 'SMA-11 Stone Matrix Asphalt',
    category: 'Carriageway Base',
    blendMode: 'Normal',
    enabled: true,
    opacity: 1.0,
    baseColor: '#2b2d31',
    roughness: 0.78,
    metallic: 0.02,
    normalStrength: 0.82,
    scale: 1.0,
    seed: 104,
    color: '#95a5c6',
    desc: 'Coarse crushed basalt aggregate bound in dark bitumen mastic with micro-voids.',
  },
  {
    id: 'layer-wheel-polish',
    name: 'Polished Wheel-Track Rut Wear',
    category: 'Traffic Wear',
    blendMode: 'Multiply',
    enabled: true,
    opacity: 0.72,
    baseColor: '#1f2125',
    roughness: 0.46,
    metallic: 0.05,
    normalStrength: 0.45,
    scale: 1.2,
    seed: 211,
    color: '#b29ec9',
    desc: 'Polished stone tips and vulcanized tire rubber deposition along dual wheel tracks.',
  },
  {
    id: 'layer-tar-cracks',
    name: 'Fatigue Cracks & Bitumen Overband',
    category: 'Surface Distress',
    blendMode: 'Height Blend',
    enabled: true,
    opacity: 0.65,
    baseColor: '#141517',
    roughness: 0.22,
    metallic: 0.08,
    normalStrength: 0.9,
    scale: 1.5,
    seed: 309,
    color: '#d4a373',
    desc: 'Longitudinal & alligator cracks sealed with glossy hot-poured bitumen overband.',
  },
  {
    id: 'layer-pothole-gravel',
    name: 'Pothole Sub-Base & Crushed Gravel',
    category: 'Surface Distress',
    blendMode: 'Height Mask',
    enabled: true,
    opacity: 0.95,
    baseColor: '#665b4c',
    roughness: 0.92,
    metallic: 0.0,
    normalStrength: 0.98,
    scale: 1.8,
    seed: 418,
    color: '#df9a78',
    desc: 'Exposed unbound granular sub-base stone and spalled asphalt rim inside potholes.',
  },
  {
    id: 'layer-wet-puddles',
    name: 'Rainwater Puddles & Damp Film',
    category: 'Weathering & Moisture',
    blendMode: 'Wetness',
    enabled: true,
    opacity: 0.42,
    baseColor: '#181c22',
    roughness: 0.07,
    metallic: 0.12,
    normalStrength: 0.15,
    scale: 0.9,
    seed: 512,
    color: '#76bde0',
    desc: 'Height-modulated standing water puddles in ruts/potholes and porous asphalt dampness.',
  },
  {
    id: 'layer-thermoplastic-paint',
    name: 'Thermoplastic Glass-Bead Markings',
    category: 'Decals & Paint',
    blendMode: 'Mask',
    enabled: true,
    opacity: 0.96,
    baseColor: '#ecebe6',
    roughness: 0.36,
    metallic: 0.04,
    normalStrength: 0.6,
    scale: 1.0,
    seed: 607,
    color: '#e6c875',
    desc: 'High-build retroreflective white, yellow, red-bus & green-cycle thermoplastic markings.',
  },
  {
    id: 'layer-paving-bond',
    name: 'Sidewalk Paving & Mortar Joints',
    category: 'Footway & Plazas',
    blendMode: 'Normal',
    enabled: true,
    opacity: 0.96,
    baseColor: '#9c9891',
    roughness: 0.72,
    metallic: 0.0,
    normalStrength: 0.88,
    scale: 1.0,
    seed: 719,
    color: '#8bc49e',
    desc: 'World-scaled stone/brick bond patterns with recessed sand-cement mortar joints.',
  },
  {
    id: 'layer-curb-granite',
    name: 'Bush-Hammered Granite Curb & Tactile',
    category: 'Footway & Plazas',
    blendMode: 'Normal',
    enabled: true,
    opacity: 0.94,
    baseColor: '#b0ada6',
    roughness: 0.64,
    metallic: 0.02,
    normalStrength: 0.78,
    scale: 1.0,
    seed: 823,
    color: '#c4b491',
    desc: '15mm chamfered silver-grey granite curbstones and ADA blister tactile warning slabs.',
  },
  {
    id: 'layer-edge-moss-oil',
    name: 'Gutter Detritus, Oil & Weathering',
    category: 'Weathering & Moisture',
    blendMode: 'Overlay',
    enabled: true,
    opacity: 0.52,
    baseColor: '#3a3d32',
    roughness: 0.84,
    metallic: 0.03,
    normalStrength: 0.5,
    scale: 1.3,
    seed: 934,
    color: '#94c280',
    desc: 'Centerline engine oil drips, gutter dust accumulation, and construction mud tracks.',
  },
];

function hexToRgb01(hex) {
  const clean = (hex || '#808080').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 128;
  const g = parseInt(clean.slice(2, 4), 16) || 128;
  const b = parseInt(clean.slice(4, 6), 16) || 128;
  return [r / 255, g / 255, b / 255];
}

function hash2D(x, y, seed = 101) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function getEffectiveMaterialParams(layerStack) {
  const byId = new Map(layerStack.map((l) => [l.id, l]));
  const soloLayer = layerStack.find((l) => l.solo);

  const isLayerActive = (id) => {
    const l = byId.get(id);
    if (!l) return false;
    if (soloLayer) return soloLayer.id === id;
    return l.enabled !== false;
  };

  const base = byId.get('layer-asphalt-base') || DEFAULT_TEXTURE_LAYERS[0];
  const polish = byId.get('layer-wheel-polish') || DEFAULT_TEXTURE_LAYERS[1];
  const cracks = byId.get('layer-tar-cracks') || DEFAULT_TEXTURE_LAYERS[2];
  const gravel = byId.get('layer-pothole-gravel') || DEFAULT_TEXTURE_LAYERS[3];
  const puddles = byId.get('layer-wet-puddles') || DEFAULT_TEXTURE_LAYERS[4];
  const paint = byId.get('layer-thermoplastic-paint') || DEFAULT_TEXTURE_LAYERS[5];
  const paving = byId.get('layer-paving-bond') || DEFAULT_TEXTURE_LAYERS[6];
  const curb = byId.get('layer-curb-granite') || DEFAULT_TEXTURE_LAYERS[7];
  const oil = byId.get('layer-edge-moss-oil') || DEFAULT_TEXTURE_LAYERS[8];

  return {
    asphaltColor: isLayerActive('layer-asphalt-base') ? hexToRgb01(base.baseColor) : [0.22, 0.23, 0.25],
    asphaltRoughness: isLayerActive('layer-asphalt-base') ? base.roughness : 0.8,
    asphaltNormal: isLayerActive('layer-asphalt-base') ? base.normalStrength : 0.5,
    asphaltScale: base.scale || 1.0,
    wheelPolishOpacity: isLayerActive('layer-wheel-polish') ? polish.opacity : 0.0,
    wheelRoughness: polish.roughness ?? 0.46,
    crackOpacity: isLayerActive('layer-tar-cracks') ? cracks.opacity : 0.0,
    potholeGravelColor: isLayerActive('layer-pothole-gravel') ? hexToRgb01(gravel.baseColor) : [0.38, 0.34, 0.28],
    wetness: isLayerActive('layer-wet-puddles') ? puddles.opacity : 0.0,
    paintOpacity: isLayerActive('layer-thermoplastic-paint') ? paint.opacity : 0.15,
    paintColor: hexToRgb01(paint.baseColor),
    pavingColor: isLayerActive('layer-paving-bond') ? hexToRgb01(paving.baseColor) : [0.58, 0.56, 0.54],
    pavingRoughness: paving.roughness ?? 0.72,
    pavingScale: paving.scale ?? 1.0,
    curbColor: isLayerActive('layer-curb-granite') ? hexToRgb01(curb.baseColor) : [0.68, 0.67, 0.64],
    curbRoughness: curb.roughness ?? 0.64,
    weatheringOpacity: isLayerActive('layer-edge-moss-oil') ? oil.opacity : 0.0,
  };
}

/**
 * Generate a 256x256 procedural texture canvas for any material ID in the scene,
 * driven by the user's active Texture Layer Stack!
 */
export function generateMaterialTextureCanvas(materialId, layerStack) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const params = getEffectiveMaterialParams(layerStack);

  if (materialId === 'asphalt-wearing') {
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const [br, bg, bb] = params.asphaltColor.map((v) => v * 255);
    const scale = params.asphaltScale;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const n1 = (hash2D(Math.floor(x * scale), Math.floor(y * scale), 17) - 0.5) * 34 * params.asphaltNormal;
        const n2 = (hash2D(Math.floor(x * 0.5 * scale), Math.floor(y * 0.5 * scale), 53) - 0.5) * 18;
        // Wheel track polish bands at u ~ 0.28 and u ~ 0.72
        const u = x / size;
        const trackMask =
          (Math.exp(-Math.pow((u - 0.28) / 0.11, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.11, 2))) *
          params.wheelPolishOpacity;
        // Tar crack network
        const crackWave = Math.abs(Math.sin(x * 0.075 + Math.sin(y * 0.06) * 2.4) * Math.cos(y * 0.045));
        const isCrack = crackWave < 0.028 * params.crackOpacity ? 1 : 0;
        // Gutter & centerline oil/moss weathering
        const oilMask = Math.exp(-Math.pow((u - 0.5) / 0.07, 2)) * params.weatheringOpacity;

        let r = br + n1 + n2 - trackMask * 18 - oilMask * 22;
        let g = bg + n1 + n2 - trackMask * 18 - oilMask * 20;
        let b = bb + n1 + n2 - trackMask * 15 - oilMask * 24;

        if (isCrack) {
          r = 16; g = 17; b = 20;
        }
        // Subtle wet puddle darkening
        if (params.wetness > 0.05) {
          const puddleNoise = Math.sin(x * 0.04) * Math.cos(y * 0.045);
          if (puddleNoise > 1.0 - params.wetness * 1.1) {
            r *= 0.68; g *= 0.72; b *= 0.78;
          }
        }

        d[idx] = Math.max(0, Math.min(255, r));
        d[idx + 1] = Math.max(0, Math.min(255, g));
        d[idx + 2] = Math.max(0, Math.min(255, b));
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  if (materialId.startsWith('paving-')) {
    const pattern = materialId.replace('paving-', '');
    const [pr, pg, pb] = params.pavingColor.map((v) => Math.round(v * 255));
    ctx.fillStyle = '#474542';
    ctx.fillRect(0, 0, size, size);

    const drawBlock = (x, y, w, h, seedIdx) => {
      const jitter = Math.round((hash2D(x, y, seedIdx) - 0.5) * 24);
      ctx.fillStyle = `rgb(${pr + jitter}, ${pg + jitter}, ${pb + jitter})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    };

    if (pattern === 'herringbone') {
      const step = 32;
      for (let y = -1; y < 9; y++) {
        for (let x = -1; x < 9; x++) {
          const m = ((x + y) % 4 + 4) % 4;
          if (m === 0 || m === 1) drawBlock(x * step, y * step, step * 2, step, x * 13 + y);
          else drawBlock(x * step, y * step, step, step * 2, x * 17 + y);
        }
      }
    } else if (pattern === 'munich-hex') {
      const r = 24;
      const dx = r * 1.5;
      const dy = r * Math.sqrt(3);
      for (let row = -1; row < 8; row++) {
        for (let col = -1; col < 8; col++) {
          const cx = col * dx;
          const cy = row * dy + (col % 2 ? dy * 0.5 : 0);
          const jitter = Math.round((hash2D(col, row, 99) - 0.5) * 20);
          ctx.fillStyle = `rgb(${pr + jitter}, ${pg + jitter}, ${pb + jitter})`;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k * Math.PI) / 3;
            const px = cx + Math.cos(a) * (r - 2);
            const py = cy + Math.sin(a) * (r - 2);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (pattern === 'cobble-fan') {
      ctx.fillStyle = '#3c3b39';
      ctx.fillRect(0, 0, size, size);
      for (let fy = 0; fy <= size + 64; fy += 64) {
        for (let fx = 0; fx <= size + 64; fx += 96) {
          for (let ring = 14; ring <= 56; ring += 14) {
            const count = Math.max(4, Math.floor(ring / 5));
            for (let k = 0; k < count; k++) {
              const a = -Math.PI * 0.8 + (k / (count - 1)) * Math.PI * 0.6;
              const px = fx + Math.cos(a) * ring;
              const py = fy + Math.sin(a) * ring;
              const jitter = Math.round((hash2D(k, ring, fx + fy) - 0.5) * 26);
              ctx.fillStyle = `rgb(${pr - 18 + jitter}, ${pg - 18 + jitter}, ${pb - 16 + jitter})`;
              ctx.fillRect(px - 5, py - 5, 10, 10);
            }
          }
        }
      }
    } else {
      // Ashlar / Terrazzo / Running Bond / Basketweave / Slate / Permeable
      const rows = pattern === 'slate' ? 6 : 8;
      const rowH = size / rows;
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * 32;
        for (let x = -64; x < size; x += 64) {
          drawBlock(x + offset, r * rowH, 64, rowH, r * 31 + x);
        }
      }
    }
    return canvas;
  }

  if (materialId === 'curb-granite') {
    const [cr, cg, cb] = params.curbColor.map((v) => Math.round(v * 255));
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const px = (i / 4) % size;
      const py = Math.floor(i / 4 / size);
      const speckle = (hash2D(px, py, 77) - 0.5) * 28;
      const joint = py % 128 < 3 ? -45 : 0;
      img.data[i] = clamp(cr + speckle + joint, 0, 255);
      img.data[i + 1] = clamp(cg + speckle + joint, 0, 255);
      img.data[i + 2] = clamp(cb + speckle + joint, 0, 255);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  if (materialId === 'tactile-paving') {
    ctx.fillStyle = '#c9ab59';
    ctx.fillRect(0, 0, size, size);
    for (let y = 16; y < size; y += 32) {
      for (let x = 16; x < size; x += 32) {
        ctx.fillStyle = '#e5cb78';
        ctx.beginPath();
        ctx.arc(x - 2, y - 2, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#997f36';
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas;
  }

  if (materialId === 'billboard-highway') {
    ctx.fillStyle = '#0d5c3a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, size - 20, size - 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('I-95 INTERCHANGE', 22, 72);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('DOWNTOWN  ↑   AIRPORT  ↗', 22, 138);
    ctx.fillStyle = '#f2be35';
    ctx.fillRect(22, 168, 128, 42);
    ctx.fillStyle = '#141414';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('EXIT 14B', 38, 196);
    return canvas;
  }

  if (materialId === 'billboard-led') {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#13263e');
    g.addColorStop(0.55, '#1e3c58');
    g.addColorStop(1, '#101824');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#6ec8f5';
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, size - 20, size - 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('FRONTIER ZERO', 24, 92);
    ctx.fillStyle = '#7fe7c4';
    ctx.font = '19px sans-serif';
    ctx.fillText('AUTONOMOUS CORRIDOR', 24, 138);
    ctx.fillText('WEBGPU INFRASTRUCTURE', 24, 174);
    return canvas;
  }

  // Fallback solid/textured swatch
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
