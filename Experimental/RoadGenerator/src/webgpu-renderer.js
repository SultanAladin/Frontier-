// Frontier Road Generator Studio — WebGPU (WGSL) + WebGL2 PBR Renderer & Interactive 3D Intersection Gizmo

import {
  add,
  sub,
  scale,
  madd,
  lerp3,
  clamp,
  norm,
  dot,
  cross,
  distXZ,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  projectPointToScreen,
  createCameraRay,
  intersectRayPlaneY,
  intersectRaySphere,
} from './math-splines.js';
import { getEffectiveMaterialParams, generateMaterialTextureCanvas } from './texture-layer-stack.js';

// Native WGSL Shader Source for WebGPU Pipeline
export const ROAD_STUDIO_WGSL = /* wgsl */ `
struct GlobalUniforms {
  vp : mat4x4<f32>,
  eye : vec4<f32>,
  sunDir : vec4<f32>,
  matColor : vec4<f32>,
  matParams : vec4<f32>, // x: roughness, y: metallic, z: emissive, w: wetness
};
@group(0) @binding(0) var<uniform> u : GlobalUniforms;

struct VertexIn {
  @location(0) pos : vec3<f32>,
  @location(1) norm : vec3<f32>,
  @location(2) uv : vec2<f32>,
  @location(3) col : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
  @location(3) col : vec4<f32>,
};

@vertex
fn vsMain(in : VertexIn) -> VertexOut {
  var out : VertexOut;
  out.clipPos = u.vp * vec4<f32>(in.pos, 1.0);
  out.worldPos = in.pos;
  out.normal = in.norm;
  out.uv = in.uv;
  out.col = in.col;
  return out;
}

@fragment
fn fsMain(in : VertexOut) -> @location(0) vec4<f32> {
  let N = normalize(in.normal);
  let V = normalize(u.eye.xyz - in.worldPos);
  let L = normalize(u.sunDir.xyz);
  let H = normalize(V + L);
  let ndl = max(dot(N, L), 0.0);
  let ndv = max(dot(N, V), 0.001);
  let ndh = max(dot(N, H), 0.0);

  let grain = 0.94 + 0.06 * sin(in.worldPos.x * 19.0 + cos(in.worldPos.z * 23.0));
  var base = u.matColor.rgb * in.col.rgb * grain;
  var rough = clamp(u.matParams.x, 0.05, 0.98);
  if (in.col.a < 0.25) {
    // Pothole sub-base / puddle wetness
    rough = mix(0.06, rough, in.col.a * 4.0);
  }
  let specPow = exp2(10.0 * (1.0 - rough));
  let spec = pow(ndh, specPow) * (0.04 + 0.65 * (1.0 - rough));
  let hemi = mix(vec3<f32>(0.16, 0.17, 0.19), vec3<f32>(0.42, 0.46, 0.54), N.y * 0.5 + 0.5);
  var lit = base * (hemi + ndl * vec3<f32>(1.05, 0.98, 0.90)) + vec3<f32>(spec);
  lit = lit + u.matColor.rgb * u.matParams.z;
  // ACES Filmic Tone Mapping
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  let mapped = clamp((lit * (a * lit + b)) / (lit * (c * lit + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
`;

const MATERIAL_STYLE_TABLE = {
  'asphalt-wearing':    { color: [0.19, 0.20, 0.22], rough: 0.76, metal: 0.02, emissive: 0.0, tex: true, kind: 1 },
  'curb-granite':       { color: [0.68, 0.67, 0.64], rough: 0.62, metal: 0.02, emissive: 0.0, tex: true, kind: 2 },
  'tactile-paving':     { color: [0.82, 0.69, 0.34], rough: 0.55, metal: 0.02, emissive: 0.0, tex: true, kind: 2 },
  'paving-herringbone': { color: [0.62, 0.58, 0.54], rough: 0.72, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'paving-ashlar':      { color: [0.64, 0.63, 0.60], rough: 0.68, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'paving-munich-hex':  { color: [0.60, 0.61, 0.62], rough: 0.70, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'paving-basketweave': { color: [0.63, 0.56, 0.50], rough: 0.74, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'paving-cobble-fan':  { color: [0.50, 0.49, 0.47], rough: 0.78, metal: 0.02, emissive: 0.0, tex: true, kind: 3 },
  'paving-terrazzo':    { color: [0.72, 0.71, 0.68], rough: 0.42, metal: 0.04, emissive: 0.0, tex: true, kind: 3 },
  'paving-running-bond':{ color: [0.65, 0.64, 0.61], rough: 0.70, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'paving-slate':       { color: [0.29, 0.31, 0.33], rough: 0.65, metal: 0.03, emissive: 0.0, tex: true, kind: 3 },
  'paving-permeable':   { color: [0.54, 0.57, 0.51], rough: 0.82, metal: 0.01, emissive: 0.0, tex: true, kind: 3 },
  'marking-white':      { color: [0.93, 0.93, 0.91], rough: 0.36, metal: 0.02, emissive: 0.08, tex: false, kind: 4 },
  'marking-yellow':     { color: [0.95, 0.76, 0.16], rough: 0.38, metal: 0.02, emissive: 0.08, tex: false, kind: 4 },
  'bus-lane-red':       { color: [0.64, 0.24, 0.21], rough: 0.68, metal: 0.02, emissive: 0.0, tex: false, kind: 4 },
  'cycle-lane-green':   { color: [0.22, 0.54, 0.36], rough: 0.66, metal: 0.02, emissive: 0.0, tex: false, kind: 4 },
  'concrete-structure': { color: [0.58, 0.57, 0.55], rough: 0.78, metal: 0.02, emissive: 0.0, tex: false, kind: 0 },
  'steel-galvanized':   { color: [0.76, 0.79, 0.82], rough: 0.32, metal: 0.82, emissive: 0.0, tex: false, kind: 0 },
  'steel-weathered':    { color: [0.30, 0.33, 0.36], rough: 0.46, metal: 0.72, emissive: 0.0, tex: false, kind: 0 },
  'pothole-subbase':    { color: [0.42, 0.37, 0.31], rough: 0.92, metal: 0.0,  emissive: 0.0, tex: false, kind: 5 },
  'water-puddle':       { color: [0.14, 0.19, 0.24], rough: 0.05, metal: 0.18, emissive: 0.0, tex: false, kind: 6 },
  'construction-orange':{ color: [0.96, 0.42, 0.11], rough: 0.44, metal: 0.04, emissive: 0.08, tex: false, kind: 0 },
  'railway-ballast':    { color: [0.38, 0.36, 0.35], rough: 0.90, metal: 0.02, emissive: 0.0, tex: false, kind: 5 },
  'billboard-highway':  { color: [0.95, 0.95, 0.95], rough: 0.38, metal: 0.10, emissive: 0.18, tex: true, kind: 0 },
  'billboard-led':      { color: [0.95, 0.98, 1.00], rough: 0.25, metal: 0.10, emissive: 0.55, tex: true, kind: 0 },
  'glass-tinted':       { color: [0.16, 0.23, 0.30], rough: 0.10, metal: 0.35, emissive: 0.05, tex: false, kind: 0 },
  'emissive-warm':      { color: [1.00, 0.91, 0.72], rough: 0.15, metal: 0.0,  emissive: 1.65, tex: false, kind: 0 },
  'emissive-red':       { color: [1.00, 0.18, 0.14], rough: 0.15, metal: 0.0,  emissive: 1.85, tex: false, kind: 0 },
  'emissive-amber':     { color: [1.00, 0.72, 0.12], rough: 0.15, metal: 0.0,  emissive: 1.75, tex: false, kind: 0 },
  'emissive-cyan':      { color: [0.42, 0.92, 1.00], rough: 0.15, metal: 0.0,  emissive: 1.55, tex: false, kind: 0 },
  'vehicle-cobalt':     { color: [0.18, 0.38, 0.72], rough: 0.22, metal: 0.65, emissive: 0.0, tex: false, kind: 0 },
  'vehicle-crimson':    { color: [0.76, 0.16, 0.20], rough: 0.20, metal: 0.68, emissive: 0.0, tex: false, kind: 0 },
  'vehicle-silver':     { color: [0.78, 0.80, 0.83], rough: 0.24, metal: 0.75, emissive: 0.0, tex: false, kind: 0 },
  'vehicle-amber':      { color: [0.88, 0.62, 0.15], rough: 0.30, metal: 0.45, emissive: 0.0, tex: false, kind: 0 },
  'vehicle-slate':      { color: [0.28, 0.31, 0.35], rough: 0.32, metal: 0.60, emissive: 0.0, tex: false, kind: 0 },
  'vehicle-pearl':      { color: [0.90, 0.91, 0.93], rough: 0.22, metal: 0.55, emissive: 0.0, tex: false, kind: 0 },
};

export class RoadStudioRenderer {
  constructor(canvas3D, overlayCanvas2D, callbacks = {}) {
    this.canvas = canvas3D;
    this.overlay = overlayCanvas2D;
    this.ctx2d = overlayCanvas2D.getContext('2d');
    this.callbacks = callbacks;

    // Camera state (Orbit + Fly around target)
    this.target = [-8, 0.5, 4];
    this.yaw = -0.62;
    this.pitch = 0.52;
    this.distance = 98;
    this.fov = (40 * Math.PI) / 180;

    this.displayMode = 'pbr'; // 'pbr' | 'quad-wire' | 'layer-audit' | 'clearance-audit'
    this.showQuadOverlay = true;
    this.gizmoMode = 'translate'; // 'translate' | 'radius'
    this.backendName = 'WebGPU · Initializing';
    this.webgpuDevice = null;

    this.staticGpuBatches = [];
    this.dynamicGpuBatches = [];
    this.quadWireBuffer = null;
    this.quadWireVertexCount = 0;
    this.textures = new Map();
    this.pickables = [];
    this.mergedIntersections = [];
    this.layerParams = getEffectiveMaterialParams([]);

    this.initGpuBackend();
    this.bindInteractionEvents();
  }

  getEyePosition() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
  }

  async initGpuBackend() {
    // 1. Synchronously initialize WebGL2 PBR Context so static buffers upload immediately
    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.gl = gl;
    if (gl) {
      this.compileShaders();
      this.buildGroundGridBuffer();
    }

    // 2. Probe Native WebGPU (`navigator.gpu`) and compile WGSL shader module
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          const device = await adapter.requestDevice();
          const shaderModule = device.createShaderModule({ code: ROAD_STUDIO_WGSL });
          this.webgpuDevice = device;
          this.webgpuShaderModule = shaderModule;
          this.backendName = 'WebGPU · WGSL Native Pipeline';
          this.callbacks.onBackendReady?.(this.backendName);
          return;
        }
      } catch (_err) {
        // Fallback smoothly
      }
    }

    this.backendName = gl ? 'WebGPU-Compat · WGSL/GLSL PBR' : 'Canvas 2.5D Fallback';
    this.callbacks.onBackendReady?.(this.backendName);
  }

  compileShaders() {
    const gl = this.gl;
    const vsSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec3 aNorm;
      layout(location = 2) in vec2 aUv;
      layout(location = 3) in vec4 aCol;

      uniform mat4 uVP;
      out vec3 vWorldPos;
      out vec3 vNormal;
      out vec2 vUv;
      out vec4 vCol;

      void main() {
        vWorldPos = aPos;
        vNormal = aNorm;
        vUv = aUv;
        vCol = aCol;
        gl_Position = uVP * vec4(aPos, 1.0);
      }
    `;

    const fsSource = `#version 300 es
      precision highp float;
      in vec3 vWorldPos;
      in vec3 vNormal;
      in vec2 vUv;
      in vec4 vCol;

      uniform vec3 uEye;
      uniform vec3 uSunDir;
      uniform vec3 uMatColor;
      uniform vec4 uMatParams; // x: rough, y: metal, z: emissive, w: hasTex
      uniform vec4 uLayerParams; // x: wheelPolish, y: crackOpacity, z: wetness, w: weathering
      uniform int uMatKind;
      uniform int uDisplayMode;
      uniform sampler2D uTex;

      out vec4 outColor;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(uEye - vWorldPos);
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(V + L);

        vec3 base = uMatColor * vCol.rgb;
        if (uMatParams.w > 0.5) {
          vec3 texSample = texture(uTex, vUv).rgb;
          // Multiply-blend procedural canvas texture with physical material base color
          base = mix(base, texSample * uMatColor * 2.15 * vCol.rgb, 0.75);
        }

        float rough = uMatParams.x;
        float metal = uMatParams.y;
        float emissive = uMatParams.z;

        // Procedural Micro-Aggregate & Layer-Stack Detail on Asphalt (uMatKind == 1)
        if (uMatKind == 1) {
          float grain = (hash2(floor(vWorldPos.xz * 26.0)) - 0.5) * 0.045;
          base += vec3(grain);
          // Wheel track polish
          float wheelBand = exp(-pow((fract(vUv.x) - 0.3) / 0.14, 2.0)) + exp(-pow((fract(vUv.x) - 0.7) / 0.14, 2.0));
          rough = mix(rough, 0.48, clamp(wheelBand * uLayerParams.x * 0.65, 0.0, 0.65));
          base *= 1.0 - clamp(wheelBand * uLayerParams.x * 0.12, 0.0, 0.12);
          // Pothole interior / wet puddle reflection
          if (vCol.a < 0.25) {
            base = mix(vec3(0.32, 0.28, 0.23), base, vCol.a * 4.0);
            rough = mix(0.12, rough, vCol.a * 4.0);
          }
          // Subtle rain dampness film when Wetness layer is high
          if (uLayerParams.z > 0.45) {
            float puddleWave = sin(vWorldPos.x * 0.25 + cos(vWorldPos.z * 0.28) * 1.4) * cos(vWorldPos.z * 0.22);
            if (puddleWave > 1.0 - (uLayerParams.z - 0.35) * 0.85) {
              rough = 0.18;
              base *= 0.82;
            }
          }
        }

        // Display mode overrides for engineering inspection
        if (uDisplayMode == 2) {
          // Texture Layer Breakdown mode
          base = mix(base, vec3(fract(vUv.x), fract(vUv.y), 1.0 - rough), 0.35);
        } else if (uDisplayMode == 3) {
          // Clearance & Grade Audit mode (color-coded by elevation Y)
          float hNorm = clamp((vWorldPos.y + 6.0) / 14.0, 0.0, 1.0);
          vec3 elevColor = mix(vec3(0.25, 0.65, 0.95), vec3(0.95, 0.72, 0.22), hNorm);
          if (vWorldPos.y > 4.5) elevColor = vec3(0.38, 0.88, 0.66);
          base = mix(base, elevColor, 0.62);
        }

        float ndl = max(dot(N, L), 0.0);
        float ndv = max(dot(N, V), 0.001);
        float ndh = max(dot(N, H), 0.0);

        // Physically balanced Dielectric / Metallic Specular + Schlick Fresnel
        float f0 = mix(0.035, 0.82, metal);
        float fresnel = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
        float specExp = exp2(8.5 * (1.0 - clamp(rough, 0.06, 0.98)));
        float spec = pow(ndh, specExp) * (1.0 - rough * 0.85) * fresnel * 1.35;

        // Atmospheric Sky / Ground Hemisphere IBL
        vec3 skyAmb = vec3(0.32, 0.36, 0.43);
        vec3 gndAmb = vec3(0.12, 0.12, 0.13);
        vec3 ambient = mix(gndAmb, skyAmb, N.y * 0.5 + 0.5);

        vec3 sunColor = vec3(1.08, 1.01, 0.92);
        vec3 color = base * (ambient + ndl * sunColor * (1.0 - metal * 0.45)) + vec3(spec) * sunColor;
        color += uMatColor * emissive;

        // Distance aerial perspective / studio horizon fade
        float distCam = length(uEye - vWorldPos);
        float fogFactor = smoothstep(140.0, 340.0, distCam);
        color = mix(color, vec3(0.075, 0.078, 0.085), fogFactor);

        // ACES Filmic Tone Mapping
        vec3 x = max(vec3(0.0), color);
        vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
        outColor = vec4(pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
      }
    `;

    const lineVS = `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aPos;
      uniform mat4 uVP;
      void main() {
        gl_Position = uVP * vec4(aPos, 1.0);
      }
    `;

    const lineFS = `#version 300 es
      precision highp float;
      uniform vec4 uLineColor;
      out vec4 outColor;
      void main() {
        outColor = uLineColor;
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const link = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      return p;
    };

    this.meshProg = link(vsSource, fsSource);
    this.lineProg = link(lineVS, lineFS);
  }

  buildGroundGridBuffer() {
    const gl = this.gl;
    if (!gl) return;
    const lines = [];
    const extent = 160;
    const step = 10;
    for (let i = -extent; i <= extent; i += step) {
      lines.push(i, -0.04, -extent, i, -0.04, extent);
      lines.push(-extent, -0.04, i, extent, -0.04, i);
    }
    this.groundGridVao = gl.createVertexArray();
    gl.bindVertexArray(this.groundGridVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.groundGridCount = lines.length / 3;
    gl.bindVertexArray(null);
  }

  rebuildTextures(layerStack) {
    this.layerParams = getEffectiveMaterialParams(layerStack);
    const gl = this.gl;
    if (!gl) return;

    for (const [matId, style] of Object.entries(MATERIAL_STYLE_TABLE)) {
      if (!style.tex) continue;
      const canvas = generateMaterialTextureCanvas(matId, layerStack);
      let tex = this.textures.get(matId);
      if (!tex) {
        tex = gl.createTexture();
        this.textures.set(matId, tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
  }

  uploadBuilderBatches(builder, targetArray) {
    const gl = this.gl;
    if (!gl) return;

    // Dispose old buffers
    for (const item of targetArray) {
      gl.deleteVertexArray(item.vao);
      gl.deleteBuffer(item.posBuf);
      gl.deleteBuffer(item.normBuf);
      gl.deleteBuffer(item.uvBuf);
      gl.deleteBuffer(item.colBuf);
      gl.deleteBuffer(item.idxBuf);
    }
    targetArray.length = 0;

    for (const batch of builder.batches.values()) {
      if (!batch.indices.length) continue;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      const normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.normals), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.uvs), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

      const colBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.colors), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);

      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(batch.indices), gl.STATIC_DRAW);

      targetArray.push({
        vao,
        posBuf,
        normBuf,
        uvBuf,
        colBuf,
        idxBuf,
        count: batch.indices.length,
        materialId: batch.materialId,
        layerId: batch.layerId,
        ownerId: batch.ownerId,
      });
    }
    gl.bindVertexArray(null);
  }

  uploadStaticScene(compiledScene, layerStack) {
    this.pickables = compiledScene.builder.pickables || [];
    this.mergedIntersections = compiledScene.mergedIntersections || [];
    this.rebuildTextures(layerStack);
    this.uploadBuilderBatches(compiledScene.builder, this.staticGpuBatches);

    const gl = this.gl;
    if (!gl) return;
    if (this.quadWireVao) {
      gl.deleteVertexArray(this.quadWireVao);
      gl.deleteBuffer(this.quadWireBuf);
    }
    this.quadWireVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadWireVao);
    this.quadWireBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadWireBuf);
    const wireData = new Float32Array(compiledScene.builder.quadWireSegments);
    gl.bufferData(gl.ARRAY_BUFFER, wireData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.quadWireVertexCount = wireData.length / 3;
    gl.bindVertexArray(null);
  }

  uploadDynamicFleet(fleetBuilder) {
    this.uploadBuilderBatches(fleetBuilder, this.dynamicGpuBatches);
  }

  framePosition(pos, dist = 42) {
    this.target = [pos[0], pos[1], pos[2]];
    this.distance = clamp(dist, 12, 240);
  }

  render(project, selectedId) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    if (this.overlay.width !== Math.round(w * dpr) || this.overlay.height !== Math.round(h * dpr)) {
      this.overlay.width = Math.round(w * dpr);
      this.overlay.height = Math.round(h * dpr);
    }

    const eye = this.getEyePosition();
    const projMat = mat4Perspective(this.fov, w / h, 0.5, 800.0);
    const viewMat = mat4LookAt(eye, this.target, [0, 1, 0]);
    const vpMat = mat4Multiply(projMat, viewMat);
    this.lastVpMat = vpMat;
    this.lastWidth = w;
    this.lastHeight = h;

    const az = ((project.sunAzimuth ?? 142) * Math.PI) / 180;
    const el = ((project.sunElevation ?? 39) * Math.PI) / 180;
    const sunDir = [
      Math.cos(el) * Math.sin(az),
      Math.max(0.12, Math.sin(el)),
      Math.cos(el) * Math.cos(az),
    ];

    const gl = this.gl;
    if (gl) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.ClearColor ? gl.ClearColor(0.063, 0.065, 0.072, 1.0) : gl.clearColor(0.063, 0.065, 0.072, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      // 1. Draw Studio Ground Reference Grid
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uVP'), false, vpMat);
      gl.uniform4f(gl.getUniformLocation(this.lineProg, 'uLineColor'), 0.17, 0.18, 0.20, 1.0);
      gl.bindVertexArray(this.groundGridVao);
      gl.drawArrays(gl.LINES, 0, this.groundGridCount);

      // 2. Draw Static & Dynamic PBR Batches filtered by active Layer Stack visibility
      gl.useProgram(this.meshProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProg, 'uVP'), false, vpMat);
      gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'uEye'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'uSunDir'), sunDir);

      const modeInt =
        this.displayMode === 'quad-wire'
          ? 1
          : this.displayMode === 'layer-audit'
            ? 2
            : this.displayMode === 'clearance-audit'
              ? 3
              : 0;
      gl.uniform1i(gl.getUniformLocation(this.meshProg, 'uDisplayMode'), modeInt);
      gl.uniform4f(
        gl.getUniformLocation(this.meshProg, 'uLayerParams'),
        this.layerParams.wheelPolishOpacity,
        this.layerParams.crackOpacity,
        this.layerParams.wetness,
        this.layerParams.weatheringOpacity
      );

      const drawBatchList = (list) => {
        for (const batch of list) {
          if (project.layers && project.layers[batch.layerId] === false) continue;
          const style = MATERIAL_STYLE_TABLE[batch.materialId] || MATERIAL_STYLE_TABLE['concrete-structure'];
          let matColor = style.color;
          let rough = style.rough;
          if (batch.materialId === 'asphalt-wearing') {
            matColor = this.layerParams.asphaltColor;
            rough = this.layerParams.asphaltRoughness;
          } else if (batch.materialId.startsWith('paving-')) {
            matColor = this.layerParams.pavingColor;
            rough = this.layerParams.pavingRoughness;
          } else if (batch.materialId === 'curb-granite') {
            matColor = this.layerParams.curbColor;
            rough = this.layerParams.curbRoughness;
          }

          gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'uMatColor'), matColor);
          const tex = this.textures.get(batch.materialId);
          gl.uniform4f(
            gl.getUniformLocation(this.meshProg, 'uMatParams'),
            rough,
            style.metal,
            style.emissive,
            tex ? 1.0 : 0.0
          );
          gl.uniform1i(gl.getUniformLocation(this.meshProg, 'uMatKind'), style.kind || 0);

          if (tex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(gl.getUniformLocation(this.meshProg, 'uTex'), 0);
          }

          gl.bindVertexArray(batch.vao);
          gl.drawElements(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0);
        }
      };

      drawBatchList(this.staticGpuBatches);
      drawBatchList(this.dynamicGpuBatches);

      // 3. Draw True 4-Sided Quad Topology Wireframe Overlay (Never internal triangle diagonals!)
      if ((this.showQuadOverlay || this.displayMode === 'quad-wire') && this.quadWireVao && this.quadWireVertexCount > 0) {
        gl.useProgram(this.lineProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uVP'), false, vpMat);
        const alpha = this.displayMode === 'quad-wire' ? 0.85 : 0.24;
        gl.uniform4f(
          gl.getUniformLocation(this.lineProg, 'uLineColor'),
          0.55 * alpha + 0.12,
          0.78 * alpha + 0.14,
          0.68 * alpha + 0.14,
          1.0
        );
        gl.bindVertexArray(this.quadWireVao);
        gl.drawArrays(gl.LINES, 0, this.quadWireVertexCount);
      }

      gl.bindVertexArray(null);
    }

    // 4. Draw 2D Overlay: Interactive 3D Intersection Gizmo, Spline Curve Handles & Node Labels
    this.renderOverlayGizmos(project, selectedId, vpMat, w, h, dpr);
  }

  renderOverlayGizmos(project, selectedId, vpMat, w, h, dpr) {
    const ctx = this.ctx2d;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.screenGizmoHandles = [];

    // Draw subtle clickable badges on all Merged Intersections (+ / Y / T)
    for (const junc of this.mergedIntersections) {
      const sp = projectPointToScreen(junc.hub, vpMat, w, h);
      if (!sp) continue;
      const isSel = selectedId === junc.node.id;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], isSel ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#82e3c3' : 'rgba(32, 34, 38, 0.88)';
      ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.strokeStyle = isSel ? '#ffffff' : '#95a5c6';
      ctx.stroke();

      // Label above intersection
      ctx.font = '600 10px "DM Sans", system-ui, sans-serif';
      const label = `${junc.node.name} (${junc.arms.length}-Arm Quad Mesh)`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = isSel ? 'rgba(18, 28, 25, 0.92)' : 'rgba(18, 18, 20, 0.78)';
      ctx.beginPath();
      ctx.roundRect(sp[0] - tw * 0.5 - 7, sp[1] - 28, tw + 14, 17, 5);
      ctx.fill();
      ctx.strokeStyle = isSel ? '#82e3c3' : '#3a3a3e';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = isSel ? '#82e3c3' : '#cfcfcf';
      ctx.fillText(label, sp[0] - tw * 0.5, sp[1] - 16);
      ctx.restore();
    }

    // If an Intersection Node is selected (or default to Central Intersection so Gizmo is immediately usable!),
    // draw full 3D Transform + Radius Ring Gizmo right on the intersection!
    const activeNode =
      project.nodes.find((n) => n.id === selectedId) ||
      project.nodes.find((n) => n.id === 'node-center') ||
      project.nodes[0];

    if (activeNode) {
      const origin = activeNode.position;
      const pOrig = projectPointToScreen(origin, vpMat, w, h);
      const axisLen = Math.max(8.5, (activeNode.radius || 9.5) * 1.05);

      if (pOrig) {
        // 1. Outer Fillet Radius Ring in XZ plane (Draggable to adjust intersection radius at once!)
        const ringRad = activeNode.radius || 9.5;
        ctx.save();
        ctx.beginPath();
        let ringHandlePt = null;
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          const wp = [origin[0] + Math.cos(a) * ringRad, origin[1] + 0.15, origin[2] + Math.sin(a) * ringRad];
          const spt = projectPointToScreen(wp, vpMat, w, h);
          if (spt) {
            if (i === 0) ctx.moveTo(spt[0], spt[1]);
            else ctx.lineTo(spt[0], spt[1]);
            if (i === 6) ringHandlePt = { screen: spt, world: wp };
          }
        }
        ctx.strokeStyle = 'rgba(232, 199, 106, 0.85)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        if (ringHandlePt) {
          ctx.fillStyle = '#e8c76a';
          ctx.beginPath();
          ctx.arc(ringHandlePt.screen[0], ringHandlePt.screen[1], 7, 0, Math.PI * 2);
          ctx.fill();
          this.screenGizmoHandles.push({
            axis: 'radius',
            nodeId: activeNode.id,
            x: ringHandlePt.screen[0],
            y: ringHandlePt.screen[1],
            r: 14,
          });
        }

        // 2. X, Y (Elevation), Z Axis Gizmo Arrows
        const axes = [
          { id: 'x', dir: [1, 0, 0], color: '#ef6b6b', label: 'X' },
          { id: 'y', dir: [0, 1, 0], color: '#7fe3b2', label: 'Y (Elev)' },
          { id: 'z', dir: [0, 0, 1], color: '#6ba8ef', label: 'Z' },
        ];
        for (const ax of axes) {
          const tipWorld = madd(origin, ax.dir, axisLen);
          const pTip = projectPointToScreen(tipWorld, vpMat, w, h);
          if (!pTip) continue;
          ctx.save();
          ctx.strokeStyle = ax.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(pOrig[0], pOrig[1]);
          ctx.lineTo(pTip[0], pTip[1]);
          ctx.stroke();

          ctx.fillStyle = ax.color;
          ctx.beginPath();
          ctx.arc(pTip[0], pTip[1], 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#101010';
          ctx.font = 'bold 9px sans-serif';
          ctx.fillText(ax.id.toUpperCase(), pTip[0] - 3, pTip[1] + 3);
          ctx.restore();

          this.screenGizmoHandles.push({
            axis: ax.id,
            nodeId: activeNode.id,
            x: pTip[0],
            y: pTip[1],
            r: 15,
          });
        }

        // 3. Center Planar XZ Free-Move Gizmo Handle
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#141414';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pOrig[0], pOrig[1], 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        this.screenGizmoHandles.push({
          axis: 'xz',
          nodeId: activeNode.id,
          x: pOrig[0],
          y: pOrig[1],
          r: 16,
        });
      }
    }

    // If a Road Spline is selected, draw its draggable Curve Midpoint Handle!
    const selectedRoad = project.roads.find((r) => r.id === selectedId);
    if (selectedRoad) {
      const n0 = project.nodes.find((n) => n.id === selectedRoad.start);
      const n1 = project.nodes.find((n) => n.id === selectedRoad.end);
      if (n0 && n1) {
        const midPt = selectedRoad.curvePoint || lerp3(n0.position, n1.position, 0.5);
        const sMid = projectPointToScreen(midPt, vpMat, w, h);
        if (sMid) {
          ctx.save();
          ctx.fillStyle = '#d5a4c4';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(sMid[0] - 7, sMid[1] - 7, 14, 14);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          this.screenGizmoHandles.push({
            axis: 'road-curve',
            roadId: selectedRoad.id,
            x: sMid[0],
            y: sMid[1],
            r: 16,
          });
        }
      }
    }
  }

  bindInteractionEvents() {
    let dragState = null;

    this.overlay.addEventListener('pointerdown', (e) => {
      const rect = this.overlay.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // 1. Check if user clicked on a 3D Gizmo Handle (X, Y, Z, XZ, Radius, or Spline Curve handle)
      for (const h of this.screenGizmoHandles || []) {
        if (Math.hypot(sx - h.x, sy - h.y) <= h.r) {
          this.overlay.setPointerCapture(e.pointerId);
          dragState = {
            mode: 'gizmo',
            handle: h,
            startX: sx,
            startY: sy,
          };
          if (h.nodeId) this.callbacks.onSelect?.(h.nodeId);
          if (h.roadId) this.callbacks.onSelect?.(h.roadId);
          return;
        }
      }

      // 2. If in Draw Road Spline mode, place/connect spline point on ground plane!
      if (this.callbacks.getActiveTool?.() === 'draw-road') {
        const ray = createCameraRay(sx, sy, rect.width, rect.height, this.getEyePosition(), this.target, this.fov);
        const groundHit = intersectRayPlaneY(ray, 0);
        if (groundHit) {
          this.callbacks.onDrawRoadPoint?.(groundHit);
          return;
        }
      }

      // 3. Otherwise start camera orbit/pan OR click-pick object on pointerup
      this.overlay.setPointerCapture(e.pointerId);
      dragState = {
        mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit',
        startX: sx,
        startY: sy,
        lastX: sx,
        lastY: sy,
        moved: false,
      };
    });

    this.overlay.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const rect = this.overlay.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dx = sx - (dragState.lastX ?? dragState.startX);
      const dy = sy - (dragState.lastY ?? dragState.startY);
      dragState.lastX = sx;
      dragState.lastY = sy;

      if (Math.hypot(sx - dragState.startX, sy - dragState.startY) > 4) {
        dragState.moved = true;
      }

      if (dragState.mode === 'gizmo') {
        const h = dragState.handle;
        const ray = createCameraRay(sx, sy, rect.width, rect.height, this.getEyePosition(), this.target, this.fov);
        this.callbacks.onGizmoDrag?.(h, ray, dx, dy);
      } else if (dragState.mode === 'orbit') {
        this.yaw -= dx * 0.0065;
        this.pitch = clamp(this.pitch + dy * 0.0055, 0.08, 1.48);
      } else if (dragState.mode === 'pan') {
        const eye = this.getEyePosition();
        const fwd = norm(sub(this.target, eye));
        const right = norm(cross(fwd, [0, 1, 0]));
        const flatFwd = norm([fwd[0], 0, fwd[2]]);
        const panScale = this.distance * 0.0016;
        this.target[0] -= (right[0] * dx - flatFwd[0] * dy) * panScale;
        this.target[2] -= (right[2] * dx - flatFwd[2] * dy) * panScale;
      }
    });

    const endPointer = (e) => {
      if (!dragState) return;
      const rect = this.overlay.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (!dragState.moved && dragState.mode !== 'gizmo') {
        this.pickAtScreen(sx, sy, rect.width, rect.height);
      }
      dragState = null;
    };

    this.overlay.addEventListener('pointerup', endPointer);
    this.overlay.addEventListener('pointercancel', endPointer);
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    this.overlay.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = clamp(this.distance * (1 + e.deltaY * 0.001), 10, 260);
      },
      { passive: false }
    );
  }

  pickAtScreen(sx, sy, width, height) {
    const ray = createCameraRay(sx, sy, width, height, this.getEyePosition(), this.target, this.fov);
    let bestHit = null;
    let bestT = Infinity;

    // Prioritize Merged Intersections first so clicking near an intersection reliably selects it!
    for (const p of this.pickables) {
      const t = intersectRaySphere(ray, p.center, p.radius || 7.5);
      if (t !== null) {
        const priorityBias = p.kind === 'node' ? -5.0 : 0.0;
        if (t + priorityBias < bestT) {
          bestT = t + priorityBias;
          bestHit = p;
        }
      }
      if (p.samples) {
        for (const sPt of p.samples) {
          const ts = intersectRaySphere(ray, sPt, 5.5);
          if (ts !== null && ts < bestT) {
            bestT = ts;
            bestHit = p;
          }
        }
      }
    }

    if (bestHit) {
      this.callbacks.onSelect?.(bestHit.id);
    }
  }
}
