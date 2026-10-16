import {
  ASSET_RELEASE,
  COMPUTE_ENTRIES,
  fetchShader,
} from "./runtime-assets.js?release=tyre-gpu-20261016-r2";
import { makeTyre } from "./mesh.js?release=tyre-gpu-20261016-r2";
import {
  makeSolverPlan,
  substepsFor,
  assertSolverInputs,
} from "./solver-plan.js?release=tyre-gpu-20261016-r2";
const $ = (id) => document.getElementById(id);
const state = {
  model: 1,
  compression: 38,
  speed: 0,
  stiffness: 1,
  friction: 0.8,
  iterations: 4,
  obstacle: 0,
  paused: false,
  view: 0,
  wire: false,
  ghost: false,
  adaptive: false,
};
let resetRequested = false,
  stepsRequested = 0;
const labStarted = new Date().toISOString();
const mesh = makeTyre(),
  N = mesh.rest.length,
  E = mesh.edges.length,
  T = mesh.tets.length;
let activeSubsteps = 4,
  cpuEncodeMs = 0;
let device,
  adapter,
  ready = false,
  simTime = 0,
  simAngle = 0,
  simTicks = 0,
  readAt = 0,
  lastStats = null,
  gpuMs = null,
  pending = false;
const history = { load: [], frame: [] };
function fatal(e) {
  console.error(e);
  $("error").hidden = false;
  $("error").textContent =
    `WebGPU lab stopped\n\n${e.message || e}\n\n${/version mismatch|Entry point.*exist/i.test(e.message || String(e)) ? "Application assets are out of sync. Reload this preview with Ctrl+Shift+R; this is not a GPU compatibility diagnosis." : "Use a current WebGPU-enabled browser over HTTPS or localhost. A compatible GPU is required. There is intentionally no CPU physics fallback."}`;
  $("status").textContent = "● GPU UNAVAILABLE / STOPPED";
  ready = false;
  window.tyreLab.error = String(e);
  $("reset").textContent = "↺ Reload";
}
for (const name of [
  "compression",
  "speed",
  "stiffness",
  "friction",
  "iterations",
])
  $(name).oninput = () => {
    state[name] = Number($(name).value);
    const v = state[name];
    $(name + "-out").textContent =
      name === "compression"
        ? `${v} mm`
        : name === "speed"
          ? `${v.toFixed(1)} m/s`
          : name === "stiffness"
            ? `${v.toFixed(2)} ×`
            : name === "friction"
              ? `${v.toFixed(2)} μ`
              : v;
  };
function model(m) {
  state.model = m;
  $("xpbd").classList.toggle("active", m === 0);
  $("flesh").classList.toggle("active", m === 1);
  $("solver-label").textContent = m
    ? "VOLUMETRIC / COROTATED TETS"
    : "XPBD / DISTANCE + VOLUME";
  $("model-description").textContent = m
    ? "Flesh-inspired solid: corotational tetrahedral strain + volume constraints, solved with GPU XPBD. An effective carcass, not a pneumatic cavity."
    : "Distance-constrained carcass with tetrahedral volume preservation. Graph-coloured XPBD on the GPU.";
  resetRequested = true;
}
$("xpbd").onclick = () => model(0);
$("flesh").onclick = () => model(1);
$("flat").onclick = () => {
  state.obstacle = 0;
  $("flat").classList.add("active");
  $("cleat").classList.remove("active");
};
$("cleat").onclick = () => {
  state.obstacle = 0.045;
  $("cleat").classList.add("active");
  $("flat").classList.remove("active");
};
$("view").onchange = () => (state.view = Number($("view").value));
for (const k of ["wire", "ghost", "adaptive"])
  $(k).onchange = () => (state[k] = $(k).checked);
function pause() {
  state.paused = !state.paused;
  $("pause").textContent = state.paused ? "▶ Resume" : "Ⅱ Pause";
}
$("pause").onclick = pause;
$("reset").onclick = () => {
  if (!ready && window.tyreLab.error) location.reload();
  else resetRequested = true;
};
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "BUTTON"].includes(document.activeElement.tagName))
    return;
  if (e.code === "Space") {
    e.preventDefault();
    pause();
  }
  if (e.key.toLowerCase() === "r") resetRequested = true;
  for (const k of ["wire", "ghost"])
    if (e.key.toLowerCase() === k[0]) {
      $(k).checked = !$(k).checked;
      state[k] = $(k).checked;
    }
});
const canvas = $("scene");
let yaw = 0.58,
  pitch = 0.28,
  distance = 2.25,
  drag = null;
canvas.onpointerdown = (e) => {
  drag = [e.clientX, e.clientY];
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.008;
  pitch = Math.max(0.03, Math.min(1.3, pitch + (e.clientY - drag[1]) * 0.006));
  drag = [e.clientX, e.clientY];
};
canvas.onpointerup = canvas.onpointercancel = () => (drag = null);
canvas.onwheel = (e) => {
  e.preventDefault();
  distance = Math.max(1.2, Math.min(5, distance * Math.exp(e.deltaY * 0.001)));
};
function buffer(data, usage) {
  let bytes = typeof data === "number" ? data : data.byteLength;
  const b = device.createBuffer({
    size: Math.max(4, Math.ceil(bytes / 4) * 4),
    usage: usage | (typeof data !== "number" ? GPUBufferUsage.COPY_DST : 0),
  });
  if (typeof data !== "number") device.queue.writeBuffer(b, 0, data);
  return b;
}
function camera(aspect) {
  const eye = [
    Math.sin(yaw) * Math.cos(pitch) * distance,
    0.38 + Math.sin(pitch) * distance,
    Math.cos(yaw) * Math.cos(pitch) * distance,
  ];
  const target = [0, 0.36, 0];
  const norm = (a) => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const z = norm(eye.map((x, i) => x - target[i])),
    x = norm(cross([0, 1, 0], z)),
    y = cross(z, x);
  const v = [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
  const f = 1 / Math.tan(0.57 / 2),
    near = 0.02,
    far = 40,
    p = [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      far / (near - far),
      -1,
      0,
      0,
      (far * near) / (near - far),
      0,
    ];
  const out = [];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let a = 0;
      for (let k = 0; k < 4; k++) a += p[k * 4 + r] * v[c * 4 + k];
      out.push(a);
    }
  return { vp: out, eye };
}
function environmentMesh() {
  const out = [];
  const tri = (a, b, c, m) => {
    for (const p of [a, b, c]) out.push(...p, m);
  };
  for (let i = 0; i < 180; i++) {
    const a = -4 + (i * 8) / 180,
      b = -4 + ((i + 1) * 8) / 180;
    tri([a, -0.001, -4], [b, -0.001, -4], [b, -0.001, 4], 1);
    tri([a, -0.001, -4], [b, -0.001, 4], [a, -0.001, 4], 1);
  }
  for (const z of [-0.158, 0.158])
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2,
        b = ((i + 1) / 96) * Math.PI * 2,
        p = (r, t, zz) => [r * Math.cos(t), r * Math.sin(t), zz];
      tri(p(0.263, a, z), p(0.263, b, z), p(0.058, b, z), 2);
      tri(p(0.263, a, z), p(0.058, b, z), p(0.058, a, z), 2);
    }
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2,
      b = ((i + 1) / 96) * Math.PI * 2,
      p = (t, z) => [0.263 * Math.cos(t), 0.263 * Math.sin(t), z];
    tri(p(a, -0.158), p(b, -0.158), p(b, 0.158), 2);
    tri(p(a, -0.158), p(b, 0.158), p(a, 0.158), 2);
  }
  return new Float32Array(out);
}
function plot(id, values, color) {
  const c = $(id),
    w = (c.width = Math.round(c.clientWidth * devicePixelRatio)),
    h = (c.height = Math.round(c.clientHeight * devicePixelRatio)),
    ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const max = Math.max(...values, 1) * 1.2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / 119) * w,
      y = h - 4 - (v / max) * (h - 8);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = devicePixelRatio;
  ctx.stroke();
}
function metric(id, value, unit) {
  $(id).innerHTML = `${value}<em>${unit}</em>`;
}
window.tyreLab = {
  release: ASSET_RELEASE,
  state,
  mesh: { nodes: N, edges: E, tets: T },
  get ready() {
    return ready;
  },
  get stats() {
    return lastStats;
  },
  get gpuMs() {
    return gpuMs;
  },
  get ticks() {
    return simTicks;
  },
  reset() {
    resetRequested = true;
  },
  setModel: model,
  step(n = 1) {
    stepsRequested += n;
  },
  snapshot: async () => null,
};
$("capture").onclick = () => {
  const sample = {
    capturedAt: new Date().toISOString(),
    sessionStarted: labStarted,
    parameters: { ...state },
    mesh: window.tyreLab.mesh,
    adapter: window.tyreLab.adapter,
    lastGpuSample: lastStats,
    gpuSolverMs: gpuMs,
    runtime: window.tyreLab.diagnostics?.(),
    simulationTime: simTime,
    simulationTick: simTicks,
    readbackCaptureAgeMs: lastStats ? performance.now() - readAt : null,
    meanFrameIntervalMs: history.frame.length
      ? history.frame.reduce((a, b) => a + b, 0) / history.frame.length
      : null,
    caveats: [
      "Kinematic hub rig, not a vehicle",
      "Fy is contact-correction reaction, not calibrated hub force",
      "Software adapter timings are not hardware GPU benchmarks",
    ],
  };
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `frontier-tyre-${state.model ? "corotated" : "edges"}-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function init() {
  if (!navigator.gpu) throw new Error("navigator.gpu is not available.");
  adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter was found.");
  const adapterInfo = adapter.info;
  const software =
    adapter.isFallbackAdapter ||
    adapterInfo?.isFallbackAdapter ||
    /swiftshader|llvmpipe|lavapipe|software/i.test(
      [
        adapterInfo?.description,
        adapterInfo?.device,
        adapterInfo?.architecture,
      ].join(" "),
    );
  const validation =
    new URLSearchParams(location.search).get("validateSoftware") === "1" &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  if (software && !validation)
    throw new Error(
      "A software WebGPU adapter was detected. This lab requires a hardware GPU; CPU/software fallback is disabled. Enable hardware acceleration and select a compatible adapter.",
    );
  window.tyreLab.adapter = {
    description: adapterInfo?.description,
    vendor: adapterInfo?.vendor,
    device: adapterInfo?.device,
    architecture: adapterInfo?.architecture,
    software,
    validation,
  };
  const timestamps = adapter.features.has("timestamp-query");
  device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ["timestamp-query"] : [],
  });
  device.addEventListener("uncapturederror", (e) => fatal(e.error));
  device.lost.then((info) =>
    fatal(new Error(`GPU device lost: ${info.message}`)),
  );
  const storage =
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const nodes = buffer(N * 80, storage),
    edgeData = new ArrayBuffer(E * 16),
    edv = new DataView(edgeData);
  mesh.edges.forEach(([a, b], i) => {
    edv.setUint32(i * 16, a, true);
    edv.setUint32(i * 16 + 4, b, true);
    edv.setFloat32(
      i * 16 + 8,
      Math.hypot(...mesh.rest[a].map((x, k) => x - mesh.rest[b][k])),
      true,
    );
  });
  const tetData = new ArrayBuffer(T * 64),
    tdv = new DataView(tetData);
  mesh.tetData.forEach((v, i) => {
    if (i % 16 < 4) tdv.setUint32(i * 4, v, true);
    else tdv.setFloat32(i * 4, v, true);
  });
  const edgeBuffer = buffer(new Uint8Array(edgeData), storage),
    tetBuffer = buffer(new Uint8Array(tetData), storage),
    schedule = buffer(
      new Uint32Array([...mesh.edgeBatches.flat(), ...mesh.tetBatches.flat()]),
      storage,
    ),
    lambda = buffer((E + T) * 8, storage),
    stats = buffer(64 + Math.ceil(Math.max(N, T) / 64) * 32, storage);
  // Reused staging, one immutable aligned record per colour/substep; only active bytes upload.
  const plan = makeSolverPlan(
    mesh,
    device.limits.minUniformBufferOffsetAlignment,
  );
  const { batches, records } = plan;
  const params = buffer(
    plan.bytes,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const tickContacts = buffer(N * 16, storage);
  window.tyreLab.plan = {
    records,
    alignment: plan.alignment,
    capacityBytes: plan.bytes,
    get uploadBytes() {
      return plan.activeBytes(activeSubsteps);
    },
  };
  const [physicsCode, renderCode] = await Promise.all([
    fetchShader("physics.wgsl"),
    fetchShader("render.wgsl"),
  ]);
  const computeModule = device.createShaderModule({ code: physicsCode }),
    renderModule = device.createShaderModule({ code: renderCode });
  for (const module of [computeModule, renderModule]) {
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length)
      throw new Error(
        errors
          .map((m) => `WGSL ${m.lineNum}:${m.linePos}: ${m.message}`)
          .join("\n"),
      );
  }
  const rotationBuffer = buffer(T * 16, storage);
  const layout = device.createBindGroupLayout({
    entries: Array.from({ length: 9 }, (_, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer:
        binding === 5
          ? { type: "uniform", hasDynamicOffset: true, minBindingSize: 64 }
          : {
              type: [1, 2, 3].includes(binding)
                ? "read-only-storage"
                : "storage",
            },
    })),
  });
  const resources = [
    nodes,
    edgeBuffer,
    tetBuffer,
    schedule,
    lambda,
    params,
    stats,
    rotationBuffer,
    tickContacts,
  ];
  const bind = device.createBindGroup({
    layout,
    entries: resources.map((b, binding) => ({
      binding,
      resource: { buffer: b, ...(binding === 5 ? { size: 64 } : {}) },
    })),
  });
  const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    }),
    pipelines = {};
  await Promise.all(
    COMPUTE_ENTRIES.map(async (entry) => {
      pipelines[entry] = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module: computeModule, entryPoint: entry },
      });
    }),
  );
  const context = canvas.getContext("webgpu"),
    format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const cameraBuffer = buffer(
    112,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const renderLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const rb = device.createBindGroup({
    layout: renderLayout,
    entries: [
      { binding: 0, resource: { buffer: nodes } },
      { binding: 1, resource: { buffer: cameraBuffer } },
    ],
  });
  const blend = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  function renderPipeline(
    vertex,
    fragment,
    topology = "triangle-list",
    transparent = false,
  ) {
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
      vertex: {
        module: renderModule,
        entryPoint: vertex,
        ...(vertex === "environment"
          ? {
              buffers: [
                {
                  arrayStride: 16,
                  attributes: [
                    { shaderLocation: 0, format: "float32x4", offset: 0 },
                  ],
                },
              ],
            }
          : {}),
      },
      fragment: {
        module: renderModule,
        entryPoint: fragment,
        targets: [{ format, ...(transparent ? { blend } : {}) }],
      },
      primitive: { topology, cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: !transparent,
        depthCompare: transparent ? "less-equal" : "less",
        depthBias: 0,
      },
    });
  }
  const shaded = renderPipeline("tyre", "surface"),
    wire = renderPipeline("tyre", "wire", "line-list", true),
    ghost = renderPipeline("ghost", "envelope", "line-list", true),
    envPipe = renderPipeline("environment", "surface");
  const indices = buffer(new Uint32Array(mesh.surface), GPUBufferUsage.INDEX),
    lines = buffer(new Uint32Array(mesh.lines), GPUBufferUsage.INDEX),
    envData = environmentMesh(),
    env = buffer(envData, GPUBufferUsage.VERTEX);
  let depth = null,
    size = "",
    last = performance.now(),
    lastRead = 0,
    accumulator = 0,
    lastHeight = 0.48,
    lastObstacle = 0,
    readSerial = 0,
    epoch = 0,
    activeWallTime = 0,
    cpuSamples = [],
    sampleSubsteps = 4,
    submissionFrame = 0,
    lastUi = 0;
  const resetStats = new Float32Array(16);
  resetStats[7] = 1;
  let inFlight = 0;
  const parameterInput = {
    dt: 0,
    angle: 0,
    height: 0,
    speed: 0,
    stiffness: 1,
    friction: 0.8,
    model: 1,
    obstacle: 0,
  };
  const readback = buffer(
    80,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const query = timestamps
    ? device.createQuerySet({ type: "timestamp", count: 2 })
    : null;
  const resolve = timestamps
    ? buffer(16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC)
    : null;
  function reset() {
    epoch++;
    stepsRequested = 0;
    activeWallTime = 0;
    cpuSamples = [];
    history.frame = [];
    const data = new Float32Array(N * 20);
    const w = N / 30;
    mesh.rest.forEach((p, i) => {
      const k = i * 20;
      data.set([p[0], p[1] + 0.48, p[2], mesh.pinned[i] ? 0 : w], k);
      data.set([p[0], p[1] + 0.48, p[2], 0], k + 4);
      data.set([...p, 0], k + 12);
    });
    device.queue.writeBuffer(nodes, 0, data);
    const rotations = new Float32Array(T * 4);
    for (let i = 0; i < T; i++) rotations[i * 4 + 3] = 1;
    device.queue.writeBuffer(rotationBuffer, 0, rotations);
    simTime = 0;
    simAngle = 0;
    simTicks = 0;
    lastHeight = 0.48;
    lastObstacle = 0;
    window.tyreStart = performance.now();
    accumulator = 0;
    history.load = [];
    lastStats = null;
    resetRequested = false;
  }
  reset();
  model(1);
  resetRequested = false;
  window.tyreLab.flush = () => device.queue.onSubmittedWorkDone();
  window.tyreLab.diagnostics = () => ({
    activeSubsteps,
    cpuEncodeMs,
    inFlight,
    uploadBytes: plan.activeBytes(activeSubsteps),
  });
  window.tyreLab.snapshot = async () => {
    const b = buffer(N * 80, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ),
      e = device.createCommandEncoder();
    e.copyBufferToBuffer(nodes, 0, b, 0, N * 80);
    device.queue.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(b.getMappedRange().slice(0));
    b.unmap();
    b.destroy();
    return result;
  };
  $("mesh-info").textContent =
    `${N.toLocaleString()} NODES · ${T.toLocaleString()} TETS`;
  const info = adapter.info;
  $("status").textContent = software
    ? "● WEBGPU / SOFTWARE VALIDATION ONLY"
    : "● WEBGPU / GPU PHYSICS ACTIVE";
  $("status").title =
    `${info?.description || info?.device || "WebGPU adapter"}${adapter.isFallbackAdapter ? " (fallback/software adapter)" : ""}`;
  $("timer-type").textContent = timestamps
    ? "TIMESTAMP QUERY"
    : "NOT SUPPORTED";
  $("budget").textContent = `${4} substeps · ${state.iterations} iterations`;
  if (!timestamps) metric("gpu-time", "N/A", "");
  ready = true;
  function frame(now) {
    if (!ready) return;
    try {
      const encodeStart = performance.now();
      const dtFrame = (now - last) / 1000;
      last = now;
      history.frame.push(dtFrame * 1000);
      if (history.frame.length > 120) history.frame.shift();
      if (resetRequested) reset();
      if (!state.paused) {
        accumulator += Math.min(dtFrame, 0.05);
        activeWallTime += dtFrame;
      }
      if (inFlight >= 2) {
        requestAnimationFrame(frame);
        return;
      }
      const width = Math.max(
          1,
          Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)),
        ),
        height = Math.max(
          1,
          Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)),
        );
      if (size !== `${width}x${height}`) {
        depth?.destroy();
        depth = device.createTexture({
          size: [width, height],
          format: "depth24plus",
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        canvas.width = width;
        canvas.height = height;
        size = `${width}x${height}`;
      }
      const encoder = device.createCommandEncoder();
      // Fixed 1/60s tick; at most one per animation frame. Never hide slowdown by changing dt.
      const advance =
        inFlight < 2 &&
        (stepsRequested > 0 || (!state.paused && accumulator >= 1 / 60));
      let requestRead = false;
      if (advance) {
        assertSolverInputs(state);
        if (stepsRequested) stepsRequested--;
        else accumulator = Math.min(accumulator - 1 / 60, 1 / 60);
        simTicks++;
        device.queue.writeBuffer(stats, 0, resetStats);
        activeSubsteps = substepsFor(state.speed, state.adaptive);
        const step = 1 / (60 * activeSubsteps);
        const targetHeight = 0.48 - state.compression / 1000;
        Object.assign(parameterInput, {
          dt: step,
          speed: state.speed,
          stiffness: state.stiffness,
          friction: state.friction,
          model: state.model,
          view: state.view,
        });
        for (let s = 0; s < activeSubsteps; s++) {
          simTime += step;
          simAngle += (step * state.speed) / 0.48;
          lastHeight += Math.max(
            -0.06 * step,
            Math.min(0.06 * step, targetHeight - lastHeight),
          );
          lastObstacle += Math.max(
            -0.048 * step,
            Math.min(0.048 * step, state.obstacle - lastObstacle),
          );
          Object.assign(parameterInput, {
            angle: simAngle,
            height: lastHeight,
            obstacle: lastObstacle,
          });
          plan.writeStep(s, parameterInput);
        }
        device.queue.writeBuffer(
          params,
          0,
          plan.staging,
          0,
          plan.activeBytes(activeSubsteps),
        );
        const pass = encoder.beginComputePass(
          timestamps
            ? {
                timestampWrites: {
                  querySet: query,
                  beginningOfPassWriteIndex: 0,
                  endOfPassWriteIndex: 1,
                },
              }
            : {},
        );
        let currentPipeline = null;
        function dispatch(name, n) {
          if (currentPipeline !== name) {
            pass.setPipeline(pipelines[name]);
            currentPipeline = name;
          }
          pass.dispatchWorkgroups(Math.ceil(n / 64));
        }
        for (let s = 0; s < activeSubsteps; s++) {
          const base = s * records * plan.alignment;
          pass.setBindGroup(0, bind, plan.dynamicOffsets, s * records, 1);
          dispatch("predict", Math.max(N, state.model === 1 ? T : E + T));
          for (let j = 0; j < state.iterations; j++) {
            batches.forEach((b, i) => {
              if (state.model === 1 && b.kind === "solveEdges") return;
              pass.setBindGroup(
                0,
                bind,
                plan.dynamicOffsets,
                s * records + i + 1,
                1,
              );
              dispatch(b.kind, b.count);
            });
            pass.setBindGroup(0, bind, plan.dynamicOffsets, s * records, 1);
            dispatch("contact", N);
          }
          dispatch("guardPartials", T);
          dispatch("guardReduce", 1);
          dispatch("finish", N);
        }
        dispatch("reducePartials", Math.max(N, T));
        dispatch("reduce", 1);
        pass.end();
        if (timestamps) encoder.resolveQuerySet(query, 0, 2, resolve, 0);
        if (!pending && now - lastRead > 130) {
          encoder.copyBufferToBuffer(stats, 0, readback, 0, 64);
          if (timestamps)
            encoder.copyBufferToBuffer(resolve, 0, readback, 64, 16);
          pending = true;
          requestRead = true;
          lastRead = now;
          readSerial = simTicks;
          sampleSubsteps = activeSubsteps;
        }
      }
      const cam = camera(width / height);
      device.queue.writeBuffer(
        cameraBuffer,
        0,
        new Float32Array([
          ...cam.vp,
          ...cam.eye,
          1,
          state.view,
          0,
          lastHeight,
          lastObstacle,
          -simAngle,
          N / 2 + 3,
          0,
          0,
        ]),
      );
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.048, g: 0.075, b: 0.096, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      rp.setBindGroup(0, rb);
      rp.setPipeline(envPipe);
      rp.setVertexBuffer(0, env);
      rp.draw(envData.length / 4);
      rp.setPipeline(shaded);
      rp.setIndexBuffer(indices, "uint32");
      rp.drawIndexed(mesh.surface.length);
      if (state.wire) {
        rp.setPipeline(wire);
        rp.setIndexBuffer(lines, "uint32");
        rp.drawIndexed(mesh.lines.length);
      }
      if (state.ghost) {
        rp.setPipeline(ghost);
        rp.setIndexBuffer(lines, "uint32");
        rp.drawIndexed(mesh.lines.length);
      }
      rp.end();
      device.queue.submit([encoder.finish()]);
      // Bound queued work: never build a many-frame physics backlog on a slow GPU.
      inFlight++;
      device.queue
        .onSubmittedWorkDone()
        .then(() => inFlight--)
        .catch(fatal);
      cpuEncodeMs = performance.now() - encodeStart;
      cpuSamples.push(cpuEncodeMs);
      if (cpuSamples.length > 120) cpuSamples.shift();
      submissionFrame++;
      if (requestRead) {
        const thisEpoch = epoch,
          capturedAt = now;
        readback
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const data = readback.getMappedRange();
            const f = new Float32Array(data, 0, 16);
            if (thisEpoch === epoch) {
              lastStats = {
                normal: f[1],
                tangent: f[0],
                lateral: f[2],
                contacts: f[3],
                maxError: f[4],
                minJ: f[5],
                invalid: f[6],
                tick: readSerial,
                minAcceptedStep: f[7],
                maxPenetration: f[12],
                substeps: sampleSubsteps,
                validReaction:
                  f[7] > 0.9999 && f[5] > 0.1 && f[6] === 0 && f[12] < 0.001,
              };
              if (timestamps) {
                const ts = new BigUint64Array(data, 64, 2);
                gpuMs = Number(ts[1] - ts[0]) / 1e6;
              }
              readAt = capturedAt;
              history.load.push(lastStats.normal);
              if (history.load.length > 120) history.load.shift();
            }
            readback.unmap();
            pending = false;
          })
          .catch(fatal);
      }
      if (now - lastUi >= 200) {
        lastUi = now;
        metric(
          "frame-time",
          (
            history.frame.reduce((a, b) => a + b, 0) / history.frame.length
          ).toFixed(1),
          "ms",
        );
        if (gpuMs !== null) metric("gpu-time", gpuMs.toFixed(2), "ms");
        $("budget").textContent =
          `${activeSubsteps} × ${state.iterations} sweeps · ${activeWallTime ? ((simTime / activeWallTime) * 100).toFixed(0) : 0}% real-time`;
        if (lastStats) {
          metric(
            "load",
            Math.round(lastStats.normal).toLocaleString(),
            lastStats.validReaction ? "N" : "N · LIMITED",
          );
          $("safe-step").textContent =
            (100 * lastStats.minAcceptedStep).toFixed(0) + "%";
          $("cpu-encode").textContent =
            (cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length).toFixed(
              2,
            ) + " ms";
          $("contacts").textContent = lastStats.contacts.toFixed(0);
          $("min-j").textContent = lastStats.minJ.toFixed(3);
          $("error-j").textContent =
            (lastStats.maxError * 100).toFixed(1) + "%";
          $("read-age").textContent = Math.round(now - readAt) + " ms";
          $("tangent").textContent = Math.round(lastStats.tangent) + " N";
          $("quality").hidden =
            lastStats.validReaction &&
            lastStats.maxError < 0.25 &&
            lastStats.minJ > 0.25;
          $("quality").textContent = !lastStats.validReaction
            ? `GPU SAFETY LIMIT — ${(lastStats.minAcceptedStep * 100).toFixed(0)}% of requested step; reaction NOT valid for chassis coupling. Reduce load/speed or enable adaptive substeps.`
            : lastStats.minJ <= 0
              ? "INVERTED ELEMENTS — reaction is not trustworthy. Reset or reduce compression."
              : `HIGH LOCAL VOLUME ERROR · ${(lastStats.maxError * 100).toFixed(0)}% — increase iterations or reduce compression.`;
          if (lastStats.invalid)
            throw new Error(
              "Non-finite or escaped simulation nodes; reset and reduce load.",
            );
        }
        plot("load-plot", history.load, "#b8ed9b");
        plot("frame-plot", history.frame, "#82a8c4");
      }
      requestAnimationFrame(frame);
    } catch (e) {
      fatal(e);
    }
  }
  window.tyreStart = performance.now();
  requestAnimationFrame(frame);
}
init().catch(fatal);
