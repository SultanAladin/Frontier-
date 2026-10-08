// WebGPU engine for the Particle Editor: buffers, pipelines, per-frame encoding and
// asynchronous CPU readbacks. Scene logic (emission, UI, camera) lives in app.js.
(function () {
  "use strict";
  const PE = (window.PE = window.PE || {});

  // Offsets into the System uniform, in vec4 slots (16 floats each). Mirrored in shaders.js.
  PE.SYS_SLOT = {
    origin: 0, dir: 1, speed: 2, life: 3, colA: 4, colB: 5, colC: 6, phys: 7,
    phys2: 8, phys3: 9, phys4: 10, mol: 11, mol2: 12, mol3: 13, emit: 14, misc: 15,
  };
  // Offsets (floats) into the Glob uniform (192 bytes).
  PE.GLOB_OFF = {
    viewProj: 0, camRight: 16, camUp: 20, camPos: 24, windMin: 28, windSize: 32,
    windDim: 36, timing: 40, viz: 44,
  };
  PE.WIND = { min: [-6, 0, -6], size: [12, 8, 12], dim: [24, 12, 24], maxComps: 16 };
  PE.MAX_SEGS = 1600;
  PE.MAX_GD = 24;          // molecular grid resolution per axis (allocation ceiling)
  PE.SLOTS = 24;           // molecular grid slots per cell
  const PART_BYTES = 64;
  const LINE_BYTES = 28;
  const MAX_LINE_VERTS = 4096;

  const ADD = {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  };
  const OVER = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };

  // Per-system GPU resources.
  class SystemGPU {
    constructor(engine, params) {
      const d = engine.device;
      const U = GPUBufferUsage;
      this.engine = engine;
      this.cap = Math.max(64, Math.floor(params.capacity));
      this.parts = d.createBuffer({ size: this.cap * PART_BYTES, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
      this.snap = d.createBuffer({ size: this.cap * PART_BYTES, usage: U.STORAGE | U.COPY_DST });
      this.stats = d.createBuffer({ size: 32, usage: U.STORAGE | U.COPY_SRC });
      this.statStage = d.createBuffer({ size: 32, usage: U.MAP_READ | U.COPY_DST });
      this.uniform = d.createBuffer({ size: 256, usage: U.UNIFORM | U.COPY_DST });
      const cells = PE.MAX_GD ** 3;
      this.cellCount = d.createBuffer({ size: cells * 4, usage: U.STORAGE });
      this.cellSlots = d.createBuffer({ size: cells * PE.SLOTS * 4, usage: U.STORAGE });
      this.simBG = d.createBindGroup({
        layout: engine.gl1Sim,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: this.parts } },
          { binding: 2, resource: { buffer: this.stats } },
          { binding: 3, resource: { buffer: this.cellCount } },
          { binding: 4, resource: { buffer: this.cellSlots } },
          { binding: 5, resource: { buffer: this.snap } },
        ],
      });
      this.renderBG = d.createBindGroup({
        layout: engine.gl1Render,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: this.parts } },
          { binding: 2, resource: { buffer: engine.segs } },
        ],
      });
      this.cpu = new Float32Array(64);
      this.statPending = false;
      this.stats_ = null;       // latest decoded readback
      this.readbackMs = 0;
      this.readbackCount = 0;
      this.lastReadAt = 0;
    }
    destroy() {
      for (const b of [this.parts, this.snap, this.stats, this.statStage, this.uniform, this.cellCount, this.cellSlots]) {
        b.destroy();
      }
    }
  }
  PE.SystemGPU = SystemGPU;

  PE.Engine = class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      this.probePending = false;
      this.probeResult = null;
      this.windCells = PE.WIND.dim[0] * PE.WIND.dim[1] * PE.WIND.dim[2];
    }

    async init() {
      if (!navigator.gpu) {
        throw new Error("WebGPU is not available in this browser. Use a current Chrome, Edge or Safari build with WebGPU enabled.");
      }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("WebGPU is present but no adapter was returned.");
      this.adapter = adapter;
      this.device = await adapter.requestDevice();
      const d = this.device;
      this.deviceLost = false;
      d.lost.then((info) => {
        this.deviceLost = true;
        if (this.onLost) this.onLost(info);
      });
      const ai = adapter.info || {};
      this.adapterName = [ai.vendor, ai.architecture, ai.device, ai.description].filter(Boolean).join(" ") || "WebGPU adapter";
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context = this.canvas.getContext("webgpu");
      this.context.configure({ device: d, format: this.format, alphaMode: "opaque" });

      const U = GPUBufferUsage;
      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const C = GPUShaderStage.COMPUTE;

      // Shared buffers.
      this.glob = d.createBuffer({ size: 192, usage: U.UNIFORM | U.COPY_DST });
      this.comps = d.createBuffer({ size: PE.WIND.maxComps * 32, usage: U.STORAGE | U.COPY_DST });
      this.segs = d.createBuffer({ size: PE.MAX_SEGS * 2 * 16, usage: U.STORAGE | U.COPY_DST });
      this.lines = d.createBuffer({ size: MAX_LINE_VERTS * LINE_BYTES, usage: U.VERTEX | U.COPY_DST });
      this.dummySys = d.createBuffer({ size: 256, usage: U.UNIFORM | U.COPY_DST });
      this.dummyParts = d.createBuffer({ size: PART_BYTES, usage: U.STORAGE });
      this.probeBuf = d.createBuffer({ size: 256, usage: U.COPY_DST | U.MAP_READ });

      // Wind texture: rgb velocity (m/s), a magnitude.
      const T = GPUTextureUsage;
      const [gx, gy, gz] = PE.WIND.dim;
      this.windTex = d.createTexture({
        size: [gx, gy, gz],
        dimension: "3d",
        format: "rgba16float",
        usage: T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC,
      });
      // Separate views so each bind group sees exactly the usage its layout declares.
      this.windView = this.windTex.createView({ usage: T.TEXTURE_BINDING });
      this.windStoreView = this.windTex.createView({ usage: T.STORAGE_BINDING });
      this.windSampler = d.createSampler({
        magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge",
      });

      // Bind group layouts.
      this.gl0 = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: C | VF, buffer: { type: "uniform" } },
          { binding: 1, visibility: C | VF, texture: { sampleType: "float", viewDimension: "3d" } },
          { binding: 2, visibility: C | VF, sampler: { type: "filtering" } },
        ],
      });
      this.gl1Sim = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: C, buffer: { type: "uniform" } },
          { binding: 1, visibility: C, buffer: { type: "storage" } },
          { binding: 2, visibility: C, buffer: { type: "storage" } },
          { binding: 3, visibility: C, buffer: { type: "storage" } },
          { binding: 4, visibility: C, buffer: { type: "storage" } },
          { binding: 5, visibility: C, buffer: { type: "read-only-storage" } },
        ],
      });
      this.gl1Render = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: VF, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        ],
      });
      this.glWind = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: C, buffer: { type: "uniform" } },
          { binding: 1, visibility: C, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: C, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
        ],
      });

      this.bg0 = d.createBindGroup({
        layout: this.gl0,
        entries: [
          { binding: 0, resource: { buffer: this.glob } },
          { binding: 1, resource: this.windView },
          { binding: 2, resource: this.windSampler },
        ],
      });
      this.bgWind = d.createBindGroup({
        layout: this.glWind,
        entries: [
          { binding: 0, resource: { buffer: this.glob } },
          { binding: 1, resource: { buffer: this.comps } },
          { binding: 2, resource: this.windStoreView },
        ],
      });
      this.bgDummy = d.createBindGroup({
        layout: this.gl1Render,
        entries: [
          { binding: 0, resource: { buffer: this.dummySys } },
          { binding: 1, resource: { buffer: this.dummyParts } },
          { binding: 2, resource: { buffer: this.segs } },
        ],
      });

      // Shaders, compile-checked so errors show up in the UI rather than as silent black frames.
      const modules = {};
      for (const key of ["sim", "wind", "render"]) {
        const m = d.createShaderModule({ code: PE.Shaders[key], label: "ParticleEditor " + key });
        const info = await m.getCompilationInfo();
        const errors = info.messages.filter((x) => x.type === "error");
        if (errors.length) {
          throw new Error(key + " shader: " + errors.map((e) => "line " + e.lineNum + ": " + e.message).join("; "));
        }
        modules[key] = m;
      }

      const simLayout = d.createPipelineLayout({ bindGroupLayouts: [this.gl0, this.gl1Sim] });
      const mkC = (entry, layout = simLayout) =>
        d.createComputePipeline({ layout, compute: { module: modules.sim, entryPoint: entry } });
      this.pipe = {
        wind: d.createComputePipeline({
          layout: d.createPipelineLayout({ bindGroupLayouts: [this.glWind] }),
          compute: { module: modules.wind, entryPoint: "buildWind" },
        }),
        emit: mkC("emitParticles"),
        update: mkC("updateParticles"),
        reset: mkC("resetStats"),
        reduce: mkC("reduceStats"),
        molClear: mkC("molClear"),
        molInsert: mkC("molInsert"),
        molStep: mkC("molStep"),
      };

      const renderLayout = d.createPipelineLayout({ bindGroupLayouts: [this.gl0, this.gl1Render] });
      const depth = { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" };
      const mkR = (vs, fs, blend, opts = {}) =>
        d.createRenderPipeline({
          layout: renderLayout,
          vertex: { module: modules.render, entryPoint: vs, buffers: opts.buffers || [] },
          fragment: { module: modules.render, entryPoint: fs, targets: [{ format: this.format, blend }] },
          primitive: { topology: opts.topology || "triangle-list" },
          depthStencil: Object.assign({}, depth, opts.depth || {}),
        });
      this.pipe.partAdd = mkR("vsPart", "fsPart", ADD);
      this.pipe.partAlpha = mkR("vsPart", "fsPart", OVER);
      this.pipe.seg = mkR("vsSeg", "fsSeg", ADD);
      this.pipe.arrow = mkR("vsArrow", "fsArrow", ADD);
      this.pipe.floor = mkR("vsFloor", "fsFloor", undefined, { depth: { depthWriteEnabled: true } });
      this.pipe.line = mkR("vsLine", "fsLine", OVER, {
        topology: "line-list",
        buffers: [{
          arrayStride: LINE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x4" },
          ],
        }],
      });
      this.info = {
        adapter: this.adapterName,
        maxStorage: d.limits.maxStorageBufferBindingSize,
        maxInvocations: d.limits.maxComputeInvocationsPerWorkgroup,
      };
      this.resize(this.canvas.width || 800, this.canvas.height || 600);
      return this.info;
    }

    resize(w, h) {
      if (!this.device) return;
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [Math.max(1, w), Math.max(1, h)], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthView = this.depthTex.createView();
    }

    createSystem(params) {
      return new SystemGPU(this, params);
    }

    // Pushes the frame's uniforms, runs every simulation job, then renders.
    //   frame = {
    //     glob: Float32Array(48), comps: Float32Array(128), clear: [r,g,b],
    //     floor, arrows, lines: Float32Array, lineCount,
    //     segCount, segData: Float32Array,
    //     jobs: [{ gpu, cpu, simulate, mol, emitN, steps, gd, readStats, draw, alpha }],
    //     probe: {ix,iy,iz} | null,
    //   }
    render(frame) {
      if (!this.device || this.deviceLost) return;
      const d = this.device;
      const q = d.queue;
      q.writeBuffer(this.glob, 0, frame.glob);
      q.writeBuffer(this.comps, 0, frame.comps);
      if (frame.segCount) q.writeBuffer(this.segs, 0, frame.segData, 0, frame.segCount * 8);
      if (frame.lineCount) q.writeBuffer(this.lines, 0, frame.lines, 0, frame.lineCount * 7);
      for (const job of frame.jobs) {
        if (job.draw) q.writeBuffer(job.gpu.uniform, 0, job.cpu);
      }

      const enc = d.createCommandEncoder({ label: "ParticleEditor frame" });

      // 1. Wind grid, rebuilt every frame (6912 voxels, trivial).
      let pass = enc.beginComputePass({ label: "wind" });
      pass.setPipeline(this.pipe.wind);
      pass.setBindGroup(0, this.bgWind);
      pass.dispatchWorkgroups(PE.WIND.dim[0] / 4, PE.WIND.dim[1] / 4, PE.WIND.dim[2] / 4);
      pass.end();

      // 2. Particle systems.
      for (const job of frame.jobs) {
        if (!job.simulate) continue;
        const g = job.gpu;
        const cap = g.cap;
        if (job.mol) {
          if (job.emitN > 0) {
            pass = enc.beginComputePass({ label: "emit" });
            pass.setBindGroup(0, this.bg0);
            pass.setBindGroup(1, g.simBG);
            pass.setPipeline(this.pipe.emit);
            pass.dispatchWorkgroups(Math.ceil(job.emitN / 64));
            pass.end();
          }
          const cells = job.gd ** 3;
          for (let s = 0; s < job.steps; s++) {
            pass = enc.beginComputePass({ label: "molecular insert" });
            pass.setBindGroup(0, this.bg0);
            pass.setBindGroup(1, g.simBG);
            pass.setPipeline(this.pipe.molClear);
            pass.dispatchWorkgroups(Math.ceil(cells / 64));
            pass.setPipeline(this.pipe.molInsert);
            pass.dispatchWorkgroups(Math.ceil(cap / 64));
            pass.end();
            // Snapshot so every thread reads a consistent previous state.
            enc.copyBufferToBuffer(g.parts, 0, g.snap, 0, cap * PART_BYTES);
            pass = enc.beginComputePass({ label: "molecular step" });
            pass.setBindGroup(0, this.bg0);
            pass.setBindGroup(1, g.simBG);
            pass.setPipeline(this.pipe.molStep);
            pass.dispatchWorkgroups(Math.ceil(cap / 64));
            pass.end();
          }
        } else {
          pass = enc.beginComputePass({ label: "particles" });
          pass.setBindGroup(0, this.bg0);
          pass.setBindGroup(1, g.simBG);
          if (job.emitN > 0) {
            pass.setPipeline(this.pipe.emit);
            pass.dispatchWorkgroups(Math.ceil(job.emitN / 64));
          }
          pass.setPipeline(this.pipe.update);
          pass.dispatchWorkgroups(Math.ceil(cap / 64));
          pass.end();
        }
        // Statistics reduction: alive count, species counts, kinetic energy.
        pass = enc.beginComputePass({ label: "stats" });
        pass.setBindGroup(0, this.bg0);
        pass.setBindGroup(1, g.simBG);
        pass.setPipeline(this.pipe.reset);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(this.pipe.reduce);
        pass.dispatchWorkgroups(Math.ceil(cap / 64));
        pass.end();
        job.copyStats = !!job.readStats && !g.statPending;
        if (job.copyStats) enc.copyBufferToBuffer(g.stats, 0, g.statStage, 0, 32);
      }

      // 3. Optional probe readback: one texel (8 bytes) of the wind grid.
      const doProbe = !!frame.probe && !this.probePending;
      if (doProbe) {
        const p = frame.probe;
        enc.copyTextureToBuffer(
          { texture: this.windTex, origin: [p.ix, p.iy, p.iz] },
          { buffer: this.probeBuf, bytesPerRow: 256 },
          [1, 1, 1],
        );
      }

      // 4. Render.
      const view = this.context.getCurrentTexture().createView();
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: frame.clear[0], g: frame.clear[1], b: frame.clear[2], a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: this.depthView, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store",
        },
      });
      rp.setBindGroup(0, this.bg0);
      if (frame.floor) {
        rp.setPipeline(this.pipe.floor);
        rp.setBindGroup(1, this.bgDummy);
        rp.draw(6);
      }
      if (frame.lineCount) {
        rp.setPipeline(this.pipe.line);
        rp.setBindGroup(1, this.bgDummy);
        rp.setVertexBuffer(0, this.lines);
        rp.draw(frame.lineCount);
      }
      if (frame.arrows) {
        rp.setPipeline(this.pipe.arrow);
        rp.setBindGroup(1, this.bgDummy);
        rp.draw(6, this.windCells);
      }
      for (const job of frame.jobs) {
        if (!job.draw) continue;
        rp.setPipeline(job.alpha ? this.pipe.partAlpha : this.pipe.partAdd);
        rp.setBindGroup(1, job.gpu.renderBG);
        rp.draw(6, job.gpu.cap);
      }
      if (frame.segCount) {
        rp.setPipeline(this.pipe.seg);
        rp.setBindGroup(1, this.bgDummy);
        rp.draw(6, frame.segCount);
      }
      rp.end();

      q.submit([enc.finish()]);

      // Asynchronous readbacks. Each staging buffer has at most one map in flight.
      for (const job of frame.jobs) {
        if (!job.copyStats) continue;
        const g = job.gpu;
        g.statPending = true;
        const t0 = performance.now();
        g.statStage.mapAsync(GPUMapMode.READ).then(() => {
          const u = new Uint32Array(g.statStage.getMappedRange().slice(0));
          g.statStage.unmap();
          g.stats_ = { alive: u[0], A: u[1], B: u[2], C: u[3], energy: u[4] / 1000, bytes: 32 };
          g.readbackMs = performance.now() - t0;
          g.readbackCount++;
          g.lastReadAt = performance.now();
          g.statPending = false;
        }, () => { g.statPending = false; });
      }
      if (doProbe) {
        this.probePending = true;
        const t0 = performance.now();
        const p = frame.probe;
        this.probeBuf.mapAsync(GPUMapMode.READ).then(() => {
          const h = new Uint16Array(this.probeBuf.getMappedRange().slice(0, 8));
          this.probeBuf.unmap();
          const v = Array.from(h, halfToFloat);
          this.probeResult = { at: [p.ix, p.iy, p.iz], value: v.slice(0, 3), mag: v[3], ms: performance.now() - t0, bytes: 8 };
          this.probePending = false;
        }, () => { this.probePending = false; });
      }
    }

    // Measures what a full particle-buffer readback costs (for the Readback card).
    async benchmarkFullReadback(gpu) {
      const d = this.device;
      const size = gpu.cap * PART_BYTES;
      const stage = d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const t0 = performance.now();
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(gpu.parts, 0, stage, 0, size);
      d.queue.submit([enc.finish()]);
      await stage.mapAsync(GPUMapMode.READ);
      const t1 = performance.now();
      const data = new Float32Array(stage.getMappedRange().slice(0));
      stage.unmap();
      stage.destroy();
      let alive = 0;
      for (let i = 0; i < gpu.cap; i++) if (data[i * 16 + 3] < data[i * 16 + 7]) alive++;
      return { bytes: size, ms: t1 - t0, alive, mbPerSecond: size / 1048576 / ((t1 - t0) / 1000) };
    }

    destroySystem(g) {
      g.destroy();
    }
  };

  function halfToFloat(h) {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    if (e === 0) return s * 2 ** -14 * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * 2 ** (e - 15) * (1 + f / 1024);
  }
  PE.halfToFloat = halfToFloat;

  // Fills one system's uniform block from its parameters and per-frame values.
  PE.fillSys = function fillSys(f, p, o) {
    const S = PE.SYS_SLOT;
    const set = (name, a, b = 0, c = 0, d = 0) => {
      const s = S[name] * 4;
      f[s] = a; f[s + 1] = b; f[s + 2] = c; f[s + 3] = d;
    };
    const dl = p.dir;
    const dlen = Math.hypot(dl[0], dl[1], dl[2]) || 1;
    const B = p.boxHalf[0];
    set("origin", o.origin[0], o.origin[1], o.origin[2], p.radius);
    set("dir", dl[0] / dlen, dl[1] / dlen, dl[2] / dlen, p.spread);
    set("speed", p.speedMin, p.speedMax, p.drag, p.gravity);
    set("life", p.lifeMin, p.lifeMax, p.sizeStart, p.sizeEnd);
    set("colA", ...p.colA);
    set("colB", ...p.colB);
    set("colC", ...p.colC);
    set("phys", o.dt, o.time, o.frame, p.kind);
    set("phys2", p.windCoupling, p.bounce, p.buoyancy, p.flutter);
    set("phys3", o.cap, p.emitShape, p.fracA, o.emitN);
    set("phys4", o.mol ? B : p.boxHalf[0], o.mol ? B : p.boxHalf[1], o.mol ? B : p.boxHalf[2], o.head);
    set("mol", p.temperature, p.epsilon, p.sigma, p.reactRate);
    set("mol2", o.cellSize, o.gd, PE.SLOTS, p.dissociation);
    set("mol3", Math.min(p.reactRadius, 2.5 * p.sigma), p.damping, 0, 0);
    set("emit", o.head, o.seed, p.shape, p.leafMode);
    set("misc", p.sizeScale, 0, 0, 0);
  };
})();
