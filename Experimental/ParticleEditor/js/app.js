// Particle Editor application: scene state, frame loop, camera, outliner and inspector.
(function () {
  "use strict";
  const PE = window.PE;
  const $ = (sel) => document.querySelector(sel);

  // ----------------------------------------------------------------- small helpers
  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "value") node.value = v;
      else if (k === "checked") node.checked = !!v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (v, d) => (d == null ? String(+Number(v).toPrecision(4)) : Number(v).toFixed(d));
  const toHex = (c) => "#" + c.slice(0, 3).map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");

  // ----------------------------------------------------------------- matrices (column-major)
  function mul4(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function lookAt(e, c, up) {
    const f = norm3(sub3(c, e));
    const s = norm3(cross3(f, up));
    const u = cross3(s, f);
    return Float32Array.of(
      s[0], u[0], -f[0], 0,
      s[1], u[1], -f[1], 0,
      s[2], u[2], -f[2], 0,
      -dot3(s, e), -dot3(u, e), dot3(f, e), 1,
    );
  }
  function perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return Float32Array.of(t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, f / (n - f), -1, 0, 0, (n * f) / (n - f), 0);
  }

  // ----------------------------------------------------------------- state
  const state = {
    engine: null,
    lightning: null,
    systems: [],
    nextId: 1,
    selection: { type: "wind" },
    wind: PE.defaultWind(),
    cam: { yaw: 0.6, pitch: 0.3, dist: 12.5, target: [0, 1.6, 0] },
    playing: true,
    timeScale: 1,
    time: 0,
    frame: 0,
    fps: 0,
    cpuMs: 0,
    probeOn: true,
    probe: [0, 1, 0],
    ui: { liveEls: {} },
  };
  window.ParticleEditorState = state; // for diagnostics in the console

  const DOMAIN = { min: PE.WIND.min, size: PE.WIND.size, dim: PE.WIND.dim };
  const COLORS = { bg: [0.035, 0.037, 0.045] };

  // ----------------------------------------------------------------- systems
  function makeSystem(presetId, nameOverride) {
    applyWindLink(PE.presetById(presetId));
    const preset = PE.presetById(presetId);
    const p = JSON.parse(JSON.stringify(preset.p));
    const sys = {
      id: state.nextId++,
      presetId,
      name: nameOverride || preset.name,
      p,
      gpu: null,
      acc: 0,
      pendingBurst: 0,
      overrideOrigin: null,
      needFill: true,
      head: 0,
    };
    sys.gpu = state.engine.createSystem(p);
    return sys;
  }

  function rebuildGpu(sys) {
    if (sys.gpu) state.engine.destroySystem(sys.gpu);
    sys.gpu = state.engine.createSystem(sys.p);
    sys.needFill = true;
    sys.head = 0;
    sys.acc = 0;
    sys.pendingBurst = 0;
  }

  // Some presets need a matching wind component to look right (a tornado needs its vortex,
  // a sandstorm needs a strong prevailing wind). Enable or create that component when added.
  function applyWindLink(preset) {
    const link = preset.windLink;
    if (!link) return;
    const comps = state.wind.components;
    let c = comps.find((k) => k.type === link.type);
    if (!c) {
      if (comps.length >= PE.WIND.maxComps) return;
      c = { name: link.name, type: link.type, enabled: false, x: 0, z: 0, radius: 2, strength: 4, bearing: 0, freq: 0 };
      comps.push(c);
    }
    const place = link.local ? { x: preset.p.origin[0], z: preset.p.origin[2] } : {};
    Object.assign(c, link.set || {}, place, { enabled: true });
  }

  function addSystem(presetId) {
    const same = state.systems.filter((s) => s.presetId === presetId).length;
    const preset = PE.presetById(presetId);
    const sys = makeSystem(presetId, same ? preset.name + " " + (same + 1) : preset.name);
    state.systems.push(sys);
    select({ type: "system", id: sys.id });
    return sys;
  }

  function removeSystem(sys) {
    state.engine.destroySystem(sys.gpu);
    state.systems = state.systems.filter((s) => s !== sys);
    select({ type: "wind" });
  }

  function systemById(id) {
    return state.systems.find((s) => s.id === id) || null;
  }

  function resetAll() {
    for (const sys of state.systems) rebuildGpu(sys);
    state.lightning.bolts = [];
    state.lightning.flash = 0;
  }

  // Strikes place a burst on any "strike sparks" system, at the ground point.
  function onStrike(point) {
    for (const sys of state.systems) {
      if (sys.presetId === "strikeSparks") {
        sys.pendingBurst += 160;
        sys.overrideOrigin = point;
      }
    }
  }

  function strikeNow() {
    const hit = state.lightning.strike(state.time);
    onStrike(hit);
    refreshLightningReadout();
  }

  // ----------------------------------------------------------------- camera
  function cameraMatrices(aspect) {
    const c = state.cam;
    const cp = Math.cos(c.pitch);
    const sp = Math.sin(c.pitch);
    const eye = [
      c.target[0] + c.dist * cp * Math.sin(c.yaw),
      c.target[1] + c.dist * sp,
      c.target[2] + c.dist * cp * Math.cos(c.yaw),
    ];
    const view = lookAt(eye, c.target, [0, 1, 0]);
    const proj = perspective((45 * Math.PI) / 180, aspect, 0.05, 400);
    const f = norm3(sub3(c.target, eye));
    const r = norm3(cross3(f, [0, 1, 0]));
    const u = cross3(r, f);
    return { vp: mul4(proj, view), eye, r, u };
  }

  // ----------------------------------------------------------------- frame
  let lastT = 0;
  let uiTimer = 0;
  let cpuAcc = 0;
  let cpuFrames = 0;

  function buildLines(cam) {
    const out = [];
    const line = (a, b, col) => out.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3], b[0], b[1], b[2], col[0], col[1], col[2], col[3]);
    const cross = (c, s, col) => {
      line([c[0] - s, c[1], c[2]], [c[0] + s, c[1], c[2]], col);
      line([c[0], c[1] - s, c[2]], [c[0], c[1] + s, c[2]], col);
      line([c[0], c[1], c[2] - s], [c[0], c[1], c[2] + s], col);
    };
    const box = (lo, hi, col) => {
      const c = [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [lo[0], lo[1], hi[2]],
                 [lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        line(c[a], c[b], col);
      }
    };
    if (state.wind.showDomain) {
      box(DOMAIN.min, [DOMAIN.min[0] + DOMAIN.size[0], DOMAIN.min[1] + DOMAIN.size[1], DOMAIN.min[2] + DOMAIN.size[2]], [0.45, 0.6, 0.85, 0.55]);
    }
    for (const sys of state.systems) {
      if (!sys.p.visible) continue;
      const o = sys.p.origin;
      const selected = state.selection.type === "system" && state.selection.id === sys.id;
      cross(o, 0.12, selected ? [1, 0.75, 0.25, 1] : [0.6, 0.65, 0.75, 0.6]);
      if (sys.p.kind === 3 || sys.p.kind === 4) {
        const B = sys.p.boxHalf[0];
        box([o[0] - B, o[1] - B, o[2] - B], [o[0] + B, o[1] + B, o[2] + B], selected ? [1, 0.75, 0.25, 0.9] : [0.5, 0.9, 1, 0.35]);
      }
      if (sys.p.emitShape === 3 && sys.p.kind < 3) {
        const h = sys.p.boxHalf;
        box([o[0] - h[0], o[1] - h[1], o[2] - h[2]], [o[0] + h[0], o[1] + h[1], o[2] + h[2]], [0.6, 0.7, 0.9, 0.3]);
      }
    }
    if (state.probeOn) cross(state.probe, 0.18, [1, 0.9, 0.3, 1]);
    void cam;
    return new Float32Array(out);
  }

  function probeVoxel() {
    const p = state.probe;
    const cell = DOMAIN.size.map((s, i) => s / DOMAIN.dim[i]);
    return {
      ix: clamp(Math.floor((p[0] - DOMAIN.min[0]) / cell[0]), 0, DOMAIN.dim[0] - 1),
      iy: clamp(Math.floor((p[1] - DOMAIN.min[1]) / cell[1]), 0, DOMAIN.dim[1] - 1),
      iz: clamp(Math.floor((p[2] - DOMAIN.min[2]) / cell[2]), 0, DOMAIN.dim[2] - 1),
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dtReal = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now;
    if (dtReal > 0) state.fps = state.fps * 0.9 + (1 / dtReal) * 0.1;
    const dt = state.playing ? dtReal * state.timeScale : 0;
    state.time += dt;
    state.frame++;

    // Lightning and strike sparks.
    const hits = state.lightning.update(dt, state.time);
    for (const hit of hits) onStrike(hit);

    const canvas = state.engine.canvas;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const cam = cameraMatrices(aspect);

    const glob = new Float32Array(52);
    const G = PE.GLOB_OFF;
    glob.set(cam.vp, G.viewProj);
    glob.set([cam.r[0], cam.r[1], cam.r[2], 0], G.camRight);
    glob.set([cam.u[0], cam.u[1], cam.u[2], 0], G.camUp);
    glob.set([cam.eye[0], cam.eye[1], cam.eye[2], 1], G.camPos);
    glob.set([DOMAIN.min[0], DOMAIN.min[1], DOMAIN.min[2], 0], G.windMin);
    glob.set([DOMAIN.size[0], DOMAIN.size[1], DOMAIN.size[2], 0], G.windSize);
    glob.set([DOMAIN.dim[0], DOMAIN.dim[1], DOMAIN.dim[2], state.wind.components.length], G.windDim);
    glob.set([state.time, dt, state.frame, state.wind.windScale], G.timing);
    glob.set([state.wind.arrowRef, 0.012, state.lightning.flash, state.wind.turbulence], G.viz);
    glob.set([state.wind.swirl, 0.45, 0.22, state.wind.arrowStride || 3], G.swirl);

    const comps = new Float32Array(PE.WIND.maxComps * 8);
    state.wind.components.slice(0, PE.WIND.maxComps).forEach((c, i) => {
      comps.set([c.x, c.z, Math.max(0.5, c.radius), c.type, c.strength, (c.bearing * Math.PI) / 180, c.freq, c.enabled ? 1 : 0], i * 8);
    });

    const jobs = [];
    for (const sys of state.systems) {
      if (!sys.p.visible || !sys.gpu) continue;
      const p = sys.p;
      const g = sys.gpu;
      const mol = p.kind === 3 || p.kind === 4;
      const simulate = state.playing && dt > 0;
      let emitN = 0;
      let steps = 0;
      let stepDt = dt;
      let head = sys.head;
      let origin = p.origin;
      if (simulate) {
        if (p.burstEvery > 0) {
          // Timed bursts (fireworks): each shell fires from a random point in the sky.
          sys.burstTimer = (sys.burstTimer ?? 0) - dt;
          if (sys.burstTimer <= 0) {
            sys.burstTimer = p.burstEvery * (0.7 + 0.6 * Math.random());
            sys.pendingBurst += p.burstCount;
            sys.overrideOrigin = p.burstAtOrigin
              ? null
              : [-3 + 6 * Math.random(), 3.5 + 2.5 * Math.random(), -3 + 6 * Math.random()];
          }
        }
        if (sys.overrideOrigin) {
          origin = sys.overrideOrigin;
          sys.overrideOrigin = null;
        }
        if (mol) {
          // Keep the integration step at or below ~1.25 × simDt so the LJ forces stay stable
          // even when the frame rate drops and dt grows (simulated time then lags real time).
          steps = clamp(Math.round(dt / p.simDt), 1, 8);
          stepDt = Math.min(dt / steps, p.simDt * 1.25);
          if (sys.needFill) {
            emitN = g.cap;
            sys.needFill = false;
            head = 0;
          }
        } else {
          sys.acc += p.rate * dt;
          emitN = Math.floor(sys.acc);
          sys.acc -= emitN;
          emitN = Math.min(g.cap, emitN + sys.pendingBurst);
          sys.pendingBurst = 0;
          sys.head = (head + emitN) % g.cap;
        }
      }
      const B = p.boxHalf[0];
      const rc = 2.5 * p.sigma;
      const gd = mol ? clamp(Math.floor((2 * B) / rc), 1, PE.MAX_GD) : 1;
      PE.fillSys(g.cpu, p, {
        origin, dt: stepDt, time: state.time, frame: state.frame, cap: g.cap, emitN, head,
        seed: (state.frame * 7919 + sys.id * 104729) >>> 0, mol, gd, cellSize: mol ? (2 * B) / gd : 1,
      });
      jobs.push({
        gpu: g, cpu: g.cpu, simulate, mol, emitN, steps, gd, swarm: p.kind === 6,
        readStats: simulate && state.frame % 3 === 0,
        draw: true, alpha: p.blend === "alpha",
      });
    }

    const segCount = state.lightning.pack(state.time);
    const lines = buildLines(cam);
    const probe = state.probeOn && !state.engine.probePending && state.frame % 4 === 0 ? probeVoxel() : null;

    state.engine.render({
      glob,
      comps,
      clear: COLORS.bg.map((c) => c + state.lightning.flash * 0.22),
      floor: state.wind.showFloor,
      arrows: state.wind.showArrows,
      lines,
      lineCount: lines.length / 7,
      segCount,
      segData: state.lightning.dataBuf,
      jobs,
      probe,
    });

    cpuAcc += performance.now() - t0;
    cpuFrames++;
    if (now - uiTimer > 250) {
      uiTimer = now;
      state.cpuMs = cpuFrames ? cpuAcc / cpuFrames : 0;
      cpuAcc = 0;
      cpuFrames = 0;
      updateLive();
    }
  }

  // ----------------------------------------------------------------- live readouts
  function updateLive() {
    const live = state.ui.liveEls;
    const total = state.systems.filter((s) => s.p.visible).reduce((a, s) => a + (s.gpu.stats_ ? s.gpu.stats_.alive : 0), 0);
    const cap = state.systems.filter((s) => s.p.visible).reduce((a, s) => a + s.gpu.cap, 0);
    $("#st-particles").textContent = `${fmtInt(total)} / ${fmtInt(cap)} particles`;
    $("#st-fps").textContent = `${Math.round(state.fps)} fps · CPU ${state.cpuMs.toFixed(2)} ms`;
    const reads = state.systems.reduce((a, s) => a + s.gpu.readbackCount, 0);
    const lastMs = state.systems.length ? state.systems[state.systems.length - 1].gpu.readbackMs : 0;
    $("#st-readback").textContent = `readback ${lastMs ? lastMs.toFixed(2) : "–"} ms · ${reads} total`;
    $("#outliner-count").textContent = `${state.systems.length + 2} entries`;
    const vis = state.systems.filter((s) => s.p.visible).length;
    if (live.vis) live.vis.textContent = String(vis);
    if (live.hid) live.hid.textContent = String(state.systems.length - vis);

    for (const sys of state.systems) {
      const meta = sys.ui_meta;
      if (meta) meta.textContent = `${kindLabel(sys.p.kind)} · ${sys.gpu.stats_ ? fmtInt(sys.gpu.stats_.alive) : 0} alive`;
    }
    if (live.sys && state.selection.type === "system") {
      const sys = systemById(state.selection.id);
      if (sys && sys.gpu) {
        const s = sys.gpu.stats_;
        live.alive.textContent = s ? fmtInt(s.alive) : "–";
        live.readMs.textContent = sys.gpu.readbackMs ? sys.gpu.readbackMs.toFixed(2) + " ms" : "–";
        live.reads.textContent = fmtInt(sys.gpu.readbackCount);
        if (s && live.species) {
          live.species.textContent = `A ${fmtInt(s.A)} · B ${fmtInt(s.B)} · C ${fmtInt(s.C)}`;
        }
        if (s && live.temp) {
          const T = s.alive ? s.energy / s.alive / 3 : 0;
          live.temp.textContent = T.toFixed(3);
        }
      }
    }
    if (live.probe && state.engine.probeResult) {
      const r = state.engine.probeResult;
      live.probe.textContent = `${r.value.map((v) => v.toFixed(2)).join(", ")} m/s · |v| ${r.mag.toFixed(2)}`;
      live.probeMs.textContent = `${r.ms.toFixed(2)} ms · ${r.bytes} bytes`;
    }
    if (live.light) refreshLightningReadout();
  }

  function refreshLightningReadout() {
    const live = state.ui.liveEls;
    if (live.strikes) live.strikes.textContent = fmtInt(state.lightning.strikes);
    if (live.lastStrike) {
      const s = state.lightning.lastStrike;
      live.lastStrike.textContent = s ? `(${s.at.map((v) => v.toFixed(1)).join(", ")}) m` : "–";
    }
    if (live.soundBtn) live.soundBtn.textContent = state.lightning.thunder.enabled ? "Sound on" : "Sound off";
  }

  function kindLabel(k) {
    return { 0: "Streak", 1: "Wind-driven", 3: "Molecular · LJ", 4: "Molecular · reactive", 5: "VFX", 6: "Swarm · flocking" }[k] || "Particles";
  }

  // ----------------------------------------------------------------- outliner
  function renderOutliner() {
    const list = $("#outliner-list");
    list.innerHTML = "";
    const row = (key, title, meta, dotStyle, active, onclick, eye) => {
      const item = el("div", { class: "ol-item" + (active ? " is-active" : ""), onclick, role: "button", tabindex: 0 },
        el("span", { class: "ol-dot", style: dotStyle }),
        el("div", { class: "ol-text" }, el("div", { class: "ol-title", text: title }), el("div", { class: "ol-meta", text: meta })),
        eye);
      return item;
    };
    const sel = state.selection;
    const q = (state.ui.olQuery || "").trim().toLowerCase();
    const match = (t) => !q || t.toLowerCase().includes(q);
    if (match("Environment") || match("Wind field") || match("Lightning")) list.append(el("div", { class: "ol-group", text: "Environment" }));
    if (match("Wind field")) list.append(row("wind", "Wind field", `${state.wind.components.filter((c) => c.enabled).length} active · ${PE.WIND.dim.join("×")} grid`,
      "background: linear-gradient(90deg,#3a7bff,#ffd34a,#ff4a2a)", sel.type === "wind", () => select({ type: "wind" })));
    if (match("Lightning")) list.append(row("light", "Lightning", `${state.lightning.strikes} strikes · ${state.lightning.auto ? "auto" : "manual"}`,
      "background:#c9e2ff", sel.type === "lightning", () => select({ type: "lightning" })));
    list.append(el("div", { class: "ol-group", text: "Particle systems" }));
    for (const sys of state.systems) {
      if (!match(sys.name)) continue;
      const eye = el("button", {
        class: "ol-eye" + (sys.p.visible ? " is-on" : ""), title: sys.p.visible ? "Hide" : "Show",
        "aria-pressed": sys.p.visible ? "true" : "false",
        onclick: (e) => { e.stopPropagation(); sys.p.visible = !sys.p.visible; renderOutliner(); },
      }, "");
      const item = row(sys.id, sys.name, "", `background:${toHex(sys.p.colA)}`,
        sel.type === "system" && sel.id === sys.id, () => select({ type: "system", id: sys.id }), eye);
      sys.ui_meta = item.querySelector(".ol-meta");
      sys.ui_meta.textContent = `${kindLabel(sys.p.kind)} · ${sys.gpu.stats_ ? fmtInt(sys.gpu.stats_.alive) : 0} alive`;
      list.append(item);
    }
    const add = el("select", { class: "ol-add", "aria-label": "Add particle system", onchange: (e) => {
      if (!e.target.value) return;
      addSystem(e.target.value);
    } }, el("option", { value: "", text: "+ Add particle system…" }));
    let group = null;
    for (const preset of PE.Presets) {
      if (preset.group !== group) {
        group = preset.group;
        add.append(el("optgroup", { label: group }));
      }
      add.lastChild.append(el("option", { value: preset.id, text: preset.name }));
    }
    list.append(add);
    const counts = state.systems.filter((s) => s.p.visible).length;
    state.ui.liveEls.vis = null;
    $("#outliner-visible").textContent = String(counts);
    $("#outliner-hidden").textContent = String(state.systems.length - counts);
  }

  function select(sel) {
    state.selection = sel;
    renderOutliner();
    renderInspector();
  }

  // ----------------------------------------------------------------- controls
  function rangeRow(label, get, set, o) {
    const digits = o.digits;
    const range = el("input", { type: "range", min: o.min, max: o.max, step: o.step, value: get() });
    const num = el("input", { type: "number", min: o.min, max: o.max, step: o.step, value: fmt(get(), digits), class: "num" });
    const fill = () => range.style.setProperty("--fill", ((+range.value - o.min) / (o.max - o.min) * 100) + "%");
    fill();
    range.addEventListener("input", () => { const v = +range.value; num.value = fmt(v, digits); set(v); fill(); });
    num.addEventListener("change", () => { const v = +num.value; if (Number.isFinite(v)) { const c = clamp(v, o.min, o.max); range.value = c; num.value = fmt(c, digits); set(c); fill(); } });
    return el("label", { class: "row" }, el("span", { class: "row-k", text: label }), range, num, el("em", { class: "unit", text: o.unit || "" }));
  }
  function vecRow(label, arr, o) {
    const inputs = [0, 1, 2].map((i) => {
      const input = el("input", { type: "number", step: o.step, value: fmt(arr[i], o.digits), class: "num vec", "aria-label": label + " " + "xyz"[i] });
      input.addEventListener("change", () => {
        const v = +input.value;
        if (Number.isFinite(v)) { arr[i] = clamp(v, o.min, o.max); input.value = fmt(arr[i], o.digits); o.onChange?.(); }
      });
      return input;
    });
    return el("div", { class: "row vec-row" }, el("span", { class: "row-k", text: label }), el("div", { class: "axes" }, ...inputs.map((inp, i) => el("label", {}, el("b", { text: "XYZ"[i] }), inp))), el("em", { class: "unit", text: o.unit || "" }));
  }
  function colorRow(label, arr) {
    const picker = el("input", { type: "color", value: toHex(arr), "aria-label": label + " colour" });
    const alpha = el("input", { type: "range", min: 0, max: 1, step: 0.01, value: arr[3] ?? 1, "aria-label": label + " alpha" });
    picker.addEventListener("input", () => { const c = fromHex(picker.value); arr[0] = c[0]; arr[1] = c[1]; arr[2] = c[2]; });
    alpha.addEventListener("input", () => { arr[3] = +alpha.value; });
    return el("label", { class: "row" }, el("span", { class: "row-k", text: label }), picker, alpha, el("em", { class: "unit", text: "α" }));
  }
  function selectRow(label, options, get, set) {
    const s = el("select", { "aria-label": label }, ...options.map(([v, t]) => el("option", { value: v, text: t, selected: String(get()) === String(v) })));
    s.addEventListener("change", () => set(isNaN(+s.value) ? s.value : +s.value));
    return el("label", { class: "row" }, el("span", { class: "row-k", text: label }), s);
  }
  function checkRow(label, get, set) {
    const c = el("input", { type: "checkbox", checked: get(), "aria-label": label });
    c.addEventListener("change", () => set(c.checked));
    return el("label", { class: "row check" }, el("span", { class: "row-k", text: label }), c);
  }
  function button(label, onclick, cls = "") {
    return el("button", { class: "btn " + cls, onclick, type: "button" }, label);
  }
  function card(title, kicker, ...body) {
    return el("section", { class: "pcard" },
      el("header", { class: "pcard-h" }, el("h3", { text: title }), kicker ? el("span", { class: "kicker", text: kicker }) : null),
      el("div", { class: "pcard-b" }, ...body));
  }
  function note(text) {
    return el("p", { class: "note", text });
  }

  // ----------------------------------------------------------------- inspector
  function renderInspector() {
    const root = $("#inspector");
    root.innerHTML = "";
    const live = (state.ui.liveEls = { vis: state.ui.liveEls.vis });
    const sel = state.selection;
    if (sel.type === "system") {
      const sys = systemById(sel.id);
      if (sys) renderSystemInspector(root, sys, live);
    } else if (sel.type === "wind") {
      renderWindInspector(root, live);
    } else if (sel.type === "lightning") {
      renderLightningInspector(root, live);
    }
    renderOutliner();
    updateLive();
  }

  function renderSystemInspector(root, sys, live) {
    const p = sys.p;
    const mol = p.kind === 3 || p.kind === 4;
    const preset = PE.presetById(sys.presetId);
    root.append(el("div", { class: "insp-head" },
      el("span", { class: "insp-path", text: "Particle system / " + kindLabel(p.kind) }),
      el("h2", { text: sys.name }),
      el("p", { class: "insp-sub", text: preset.blurb })));

    root.append(card("System", null,
      el("label", { class: "row" }, el("span", { class: "row-k", text: "Name" }),
        el("input", { type: "text", value: sys.name, "aria-label": "System name", oninput: (e) => { sys.name = e.target.value || "Untitled"; renderOutliner(); } })),
      el("div", { class: "btn-row" },
        button(sys.p.visible ? "Hide" : "Show", () => { sys.p.visible = !sys.p.visible; renderInspector(); }),
        button(mol ? "Re-seed" : "Clear", () => rebuildGpu(sys)),
        button("Burst", () => { sys.pendingBurst += Math.max(60, Math.round(sys.gpu.cap * 0.4)); sys.overrideOrigin = null; }, "accent"),
        button("Delete", () => removeSystem(sys), "danger")),
      note(mol ? "Molecular systems keep every particle alive and integrate them on the GPU each sub-step." : "Burst spawns a one-off batch at the emitter origin.")));

    const capSel = selectRow("Capacity", [[512, "512"], [1024, "1 024"], [2048, "2 048"], [4096, "4 096"], [8192, "8 192"]], () => p.capacity,
      (v) => { p.capacity = v; rebuildGpu(sys); renderInspector(); });
    const emitCard = [capSel];
    if (!mol) {
      emitCard.push(rangeRow("Rate", () => p.rate, (v) => (p.rate = v), { min: 0, max: 2000, step: 1, unit: "/s" }));
    }
    emitCard.push(selectRow("Shape", [[0, "Point"], [1, "Sphere volume"], [2, "Disc"], [3, "Box"]], () => p.emitShape, (v) => (p.emitShape = v)));
    emitCard.push(vecRow("Origin", p.origin, { min: -20, max: 20, step: 0.05, digits: 2, unit: "m" }));
    emitCard.push(rangeRow("Radius", () => p.radius, (v) => (p.radius = v), { min: 0, max: 8, step: 0.01, digits: 2, unit: "m" }));
    if (mol) {
      emitCard.push(rangeRow("Box half", () => p.boxHalf[0], (v) => { p.boxHalf = [v, v, v]; }, { min: 0.2, max: 4, step: 0.01, digits: 2, unit: "m" }));
    } else {
      emitCard.push(vecRow("Box half", p.boxHalf, { min: 0, max: 10, step: 0.1, digits: 1, unit: "m" }));
      emitCard.push(vecRow("Direction", p.dir, { min: -1, max: 1, step: 0.05, digits: 2 }));
      emitCard.push(rangeRow("Spread", () => p.spread, (v) => (p.spread = v), { min: 0, max: 3.1416, step: 0.01, digits: 2, unit: "rad" }));
      emitCard.push(rangeRow("Speed min", () => p.speedMin, (v) => (p.speedMin = Math.min(v, p.speedMax)), { min: 0, max: 20, step: 0.05, digits: 2, unit: "m/s" }));
      emitCard.push(rangeRow("Speed max", () => p.speedMax, (v) => (p.speedMax = Math.max(v, p.speedMin)), { min: 0, max: 20, step: 0.05, digits: 2, unit: "m/s" }));
      emitCard.push(rangeRow("Life min", () => p.lifeMin, (v) => (p.lifeMin = Math.min(v, p.lifeMax)), { min: 0.05, max: 20, step: 0.05, digits: 2, unit: "s" }));
      emitCard.push(rangeRow("Life max", () => p.lifeMax, (v) => (p.lifeMax = Math.max(v, p.lifeMin)), { min: 0.05, max: 20, step: 0.05, digits: 2, unit: "s" }));
    }
    root.append(card("Emitter", mol ? "INITIAL FILL" : "SPAWN", ...emitCard));

    const partCard = [];
    if (!mol) {
      partCard.push(selectRow("Shape", [[0, "Streak"], [1, "Sphere"], [2, "Leaf / paper"], [3, "Soft glow"]], () => p.shape, (v) => (p.shape = v)));
      if (p.kind === 1) partCard.push(selectRow("Leaf mode", [[0, "Leaf"], [1, "Paper"]], () => p.leafMode, (v) => (p.leafMode = v)));
      partCard.push(selectRow("Blend", [["add", "Additive (glow)"], ["alpha", "Alpha (premultiplied)"]], () => p.blend, (v) => (p.blend = v)));
      partCard.push(rangeRow("Size start", () => p.sizeStart, (v) => (p.sizeStart = v), { min: 0.002, max: 2, step: 0.001, digits: 3, unit: "m" }));
      partCard.push(rangeRow("Size end", () => p.sizeEnd, (v) => (p.sizeEnd = v), { min: 0.002, max: 3, step: 0.001, digits: 3, unit: "m" }));
    } else {
      partCard.push(selectRow("Blend", [["add", "Additive (glow)"], ["alpha", "Alpha (premultiplied)"]], () => p.blend, (v) => (p.blend = v)));
    }
    partCard.push(rangeRow("Size scale", () => p.sizeScale, (v) => (p.sizeScale = v), { min: 0.1, max: 4, step: 0.01, digits: 2, unit: "×" }));
    partCard.push(colorRow(mol ? "Colour A" : "Colour start", p.colA));
    partCard.push(colorRow(mol ? "Colour B" : "Colour end", p.colB));
    if (p.kind === 4) partCard.push(colorRow("Colour C", p.colC));
    if (!mol) {
      partCard.push(rangeRow("Drag", () => p.drag, (v) => (p.drag = v), { min: 0, max: 5, step: 0.01, digits: 2, unit: "1/s" }));
      partCard.push(rangeRow("Gravity", () => p.gravity, (v) => (p.gravity = v), { min: -1, max: 2, step: 0.01, digits: 2, unit: "g" }));
      partCard.push(rangeRow("Buoyancy", () => p.buoyancy, (v) => (p.buoyancy = v), { min: -4, max: 6, step: 0.05, digits: 2, unit: "m/s²" }));
      partCard.push(rangeRow("Wind coupling", () => p.windCoupling, (v) => (p.windCoupling = v), { min: 0, max: 5, step: 0.01, digits: 2, unit: "1/s" }));
      partCard.push(rangeRow("Bounce", () => p.bounce, (v) => (p.bounce = v), { min: 0, max: 1, step: 0.01, digits: 2 }));
      partCard.push(rangeRow("Flutter", () => p.flutter, (v) => (p.flutter = v), { min: 0, max: 5, step: 0.05, digits: 2, unit: "m/s²" }));
    }
    root.append(card("Particle", p.kind === 3 || p.kind === 4 ? "APPEARANCE" : "RENDER", ...partCard));

    if (mol) {
      const phys = [
        rangeRow("Temperature kT", () => p.temperature, (v) => (p.temperature = v), { min: 0.02, max: 3, step: 0.01, digits: 2, unit: "ε" }),
        rangeRow("Thermostat γ", () => p.damping, (v) => (p.damping = v), { min: 0, max: 10, step: 0.05, digits: 2, unit: "1/s" }),
        rangeRow("Sim step", () => p.simDt, (v) => (p.simDt = v), { min: 0.001, max: 0.01, step: 0.0005, digits: 4, unit: "s" }),
        rangeRow("Diameter σ", () => p.sigma, (v) => (p.sigma = v), { min: 0.03, max: 0.2, step: 0.001, digits: 3, unit: "m" }),
      ];
      if (p.kind === 3) {
        phys.push(rangeRow("Well depth ε", () => p.epsilon, (v) => (p.epsilon = v), { min: 0, max: 1, step: 0.01, digits: 2 }));
      } else {
        phys.push(rangeRow("Reaction rate", () => p.reactRate, (v) => (p.reactRate = v), { min: 0, max: 30, step: 0.1, digits: 1, unit: "1/s" }));
        phys.push(rangeRow("Dissociation", () => p.dissociation, (v) => (p.dissociation = v), { min: 0, max: 5, step: 0.05, digits: 2, unit: "1/s" }));
        phys.push(rangeRow("Reaction radius", () => p.reactRadius, (v) => (p.reactRadius = v), { min: 0.02, max: 0.2, step: 0.005, digits: 3, unit: "m" }));
        phys.push(rangeRow("Initial A fraction", () => p.fracA, (v) => (p.fracA = v), { min: 0, max: 1, step: 0.01, digits: 2 }));
      }
      phys.push(note(p.kind === 3
        ? "Lennard-Jones pairs on a spatial hash grid, Langevin thermostat, reflecting box walls. The wind field does not act on atoms."
        : "A + B → C on contact (probability per second), C → A or B spontaneously. Species counts come back to the CPU as a 32-byte readback."));
      root.append(card("Physics", "MOLECULAR", ...phys));
    }

    const read = [];
    const liveEls = {};
    const stat = (label, key) => {
      const v = el("span", { class: "stat-v", text: "–" });
      liveEls[key] = v;
      return el("div", { class: "stat" }, el("span", { class: "stat-k", text: label }), v);
    };
    read.push(el("div", { class: "stat-grid" },
      stat("Alive", "alive"), stat("Readback latency", "readMs"), stat("Readbacks", "reads"),
      mol ? stat("Temperature (<v²>/3)", "temp") : null,
      p.kind === 4 ? stat("Species", "species") : null));
    read.push(note("Each readback copies 32 bytes (counts and energy) from a GPU reduction. The map is asynchronous, so the frame never waits for it."));
    read.push(el("div", { class: "btn-row" },
      button("Benchmark full readback", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Measuring…";
        const r = await state.engine.benchmarkFullReadback(sys.gpu);
        btn.disabled = false;
        btn.textContent = "Benchmark full readback";
        out.textContent = `${fmtInt(r.bytes / 1024)} KiB (${fmtInt(sys.gpu.cap)} × 64 B) in ${r.ms.toFixed(2)} ms ≈ ${r.mbPerSecond.toFixed(0)} MiB/s · ${fmtInt(r.alive)} alive. Measured on this browser's adapter; the full buffer is not used by the editor.`;
      })));
    const out = el("p", { class: "note bench", text: "Not measured yet." });
    read.push(out);
    root.append(card("Readback", "CPU ← GPU", ...read));
    state.ui.liveEls = Object.assign(live, liveEls, { sys: true });
  }

  function renderWindInspector(root, live) {
    const w = state.wind;
    root.append(el("div", { class: "insp-head" },
      el("span", { class: "insp-path", text: "Environment / Wind field" }),
      el("h2", { text: "Wind field" }),
      el("p", { class: "insp-sub", text: "A 3D grid of velocities (24 × 12 × 24 voxels over 12 × 8 × 12 m). Every particle system samples it each step; arrows show the grid itself." })));
    root.append(card("Field", "GRID",
      rangeRow("Wind scale", () => w.windScale, (v) => (w.windScale = v), { min: 0, max: 3, step: 0.01, digits: 2, unit: "×" }),
      rangeRow("Turbulence", () => w.turbulence, (v) => (w.turbulence = v), { min: 0, max: 2, step: 0.01, digits: 2, unit: "m/s" }),
      rangeRow("Swirl", () => w.swirl, (v) => (w.swirl = v), { min: 0, max: 4, step: 0.05, digits: 2, unit: "m/s" }),
      rangeRow("Arrow full scale", () => w.arrowRef, (v) => (w.arrowRef = v), { min: 1, max: 15, step: 0.1, digits: 1, unit: "m/s" }),
      checkRow("Show grid arrows", () => w.showArrows, (v) => (w.showArrows = v)),
      rangeRow("Arrow density", () => w.arrowStride, (v) => (w.arrowStride = v), { min: 1, max: 6, step: 1, digits: 0, unit: "voxel step" }),
      checkRow("Show floor", () => w.showFloor, (v) => (w.showFloor = v)),
      checkRow("Show domain box", () => w.showDomain, (v) => (w.showDomain = v)),
      note("Arrow colour is speed: blue calm, cyan, yellow, red fast. Density is the voxel step between arrows: 1 draws every voxel, 3 draws every third.")));

    w.components.forEach((c, i) => {
      root.append(card(c.name, WIND_TYPE_LABEL[c.type] || "WIND",
        el("label", { class: "row" }, el("span", { class: "row-k", text: "Name" }),
          el("input", { type: "text", value: c.name, "aria-label": "Wind component name", oninput: (e) => { c.name = e.target.value || "Wind"; } })),
        selectRow("Type", PE.WindTypes.map((t, k) => [k, t]), () => c.type, (v) => { c.type = v; renderInspector(); }),
        checkRow("Enabled", () => c.enabled, (v) => (c.enabled = v)),
        rangeRow("Strength", () => c.strength, (v) => (c.strength = v), { min: -20, max: 20, step: 0.05, digits: 2, unit: "m/s" }),
        rangeRow("Bearing", () => c.bearing, (v) => (c.bearing = v), { min: 0, max: 360, step: 1, digits: 0, unit: "°" }),
        rangeRow("Radius", () => c.radius, (v) => (c.radius = v), { min: 0.5, max: 12, step: 0.05, digits: 2, unit: "m" }),
        rangeRow("X", () => c.x, (v) => (c.x = v), { min: -6, max: 6, step: 0.05, digits: 2, unit: "m" }),
        rangeRow("Z", () => c.z, (v) => (c.z = v), { min: -6, max: 6, step: 0.05, digits: 2, unit: "m" }),
        c.type === 1 ? rangeRow("Band speed", () => c.freq, (v) => (c.freq = v), { min: 0, max: 2, step: 0.01, digits: 2 }) : null,
        el("div", { class: "btn-row" }, button("Remove", () => { w.components.splice(i, 1); renderInspector(); }, "danger"))));
    });
    root.append(el("div", { class: "btn-row pad" },
      button("Add component", () => {
        if (w.components.length >= PE.WIND.maxComps) return;
        w.components.push({ name: "Wind " + (w.components.length + 1), type: 0, enabled: true, x: 0, z: 0, radius: 4, strength: 2, bearing: 90, freq: 0.3 });
        renderInspector();
      }, "accent")));

    const probeR = el("span", { class: "stat-v", text: "–" });
    const probeMs = el("span", { class: "stat-v", text: "–" });
    live.probe = probeR;
    live.probeMs = probeMs;
    const px = [0, 1, 2].map((i) => state.probe[i]);
    root.append(card("Probe", "CPU READBACK", 
      vecRow("Position", state.probe, { min: -6, max: 8, step: 0.05, digits: 2, unit: "m", onChange: () => {} }),
      checkRow("Probe on", () => state.probeOn, (v) => (state.probeOn = v)),
      el("div", { class: "stat-grid one" }, el("div", { class: "stat" }, el("span", { class: "stat-k", text: "Wind at probe" }), probeR),
        el("div", { class: "stat" }, el("span", { class: "stat-k", text: "Readback" }), probeMs)),
      note("One texel (8 bytes, rgba16float) is copied from the wind grid each few frames and mapped asynchronously. This is the cheap direction of CPU readback.")));
    void px;
    state.ui.liveEls = Object.assign(live, { probe: probeR, probeMs });
  }
  const WIND_TYPE_LABEL = { 0: "DIRECTIONAL", 1: "GUST", 2: "TORNADO", 3: "RADIAL" };

  function renderLightningInspector(root, live) {
    const L = state.lightning;
    root.append(el("div", { class: "insp-head" },
      el("span", { class: "insp-path", text: "Effects / Lightning" }),
      el("h2", { text: "Lightning" }),
      el("p", { class: "insp-sub", text: "Branching fractal bolts built on the CPU each strike and drawn as glowing GPU ribbons. The flash lights the frame; thunder is delayed by distance ÷ 343 m/s." })));
    const strikeBtn = button("Strike now", () => strikeNow(), "accent");
    const soundBtn = button(L.thunder.enabled ? "Sound on" : "Sound off", () => {
      if (!L.thunder.enabled) {
        if (!L.thunder.enable()) return;
      } else {
        L.thunder.disable();
      }
      refreshLightningReadout();
    });
    live.soundBtn = soundBtn;
    const strikes = el("span", { class: "stat-v", text: fmtInt(L.strikes) });
    const last = el("span", { class: "stat-v", text: L.lastStrike ? "" : "–" });
    live.strikes = strikes;
    live.lastStrike = last;
    live.light = true;
    root.append(card("Strikes", "AUTO / MANUAL",
      checkRow("Automatic strikes", () => L.auto, (v) => (L.auto = v)),
      rangeRow("Interval min", () => L.intervalMin, (v) => { L.intervalMin = Math.min(v, L.intervalMax); }, { min: 0.2, max: 30, step: 0.1, digits: 1, unit: "s" }),
      rangeRow("Interval max", () => L.intervalMax, (v) => { L.intervalMax = Math.max(v, L.intervalMin); }, { min: 0.2, max: 60, step: 0.1, digits: 1, unit: "s" }),
      rangeRow("Distance", () => L.distance, (v) => (L.distance = v), { min: 50, max: 6000, step: 10, digits: 0, unit: "m" }),
      el("div", { class: "btn-row" }, strikeBtn, soundBtn),
      el("div", { class: "stat-grid one" },
        el("div", { class: "stat" }, el("span", { class: "stat-k", text: "Strikes" }), strikes),
        el("div", { class: "stat" }, el("span", { class: "stat-k", text: "Last strike point" }), last)),
      note("Strikes fire the Strike sparks system. Sound needs one click (browser autoplay rule), then plays a rumble after distance ÷ 343 s.")));
    root.append(card("Bolt shape", "FRACTAL",
      rangeRow("Roughness", () => L.amp, (v) => (L.amp = v), { min: 0.2, max: 5, step: 0.05, digits: 2, unit: "m" }),
      rangeRow("Detail levels", () => L.levels, (v) => (L.levels = Math.round(v)), { min: 3, max: 7, step: 1, digits: 0 }),
      rangeRow("Branch chance", () => L.branchChance, (v) => (L.branchChance = v), { min: 0, max: 1, step: 0.01, digits: 2 })));
    state.ui.liveEls = Object.assign(live, { light: true });
    refreshLightningReadout();
  }

  // ----------------------------------------------------------------- toolbar
  function setupToolbar() {
    $("#ol-search").addEventListener("input", (e) => { state.ui.olQuery = e.target.value; renderOutliner(); });
    const playBtn = $("#btn-play");
    const sync = () => {
      playBtn.textContent = state.playing ? "Pause" : "Play";
      playBtn.setAttribute("aria-pressed", String(!state.playing));
      $("#st-state").textContent = state.playing ? "Live" : "Paused";
      $("#st-state").className = "pill " + (state.playing ? "ok" : "warn");
      $("#btn-top").setAttribute("aria-pressed", String(state.cam.pitch > 1.2));
    };
    playBtn.addEventListener("click", () => { state.playing = !state.playing; sync(); });
    $("#btn-reset").addEventListener("click", resetAll);
    $("#btn-strike").addEventListener("click", strikeNow);
    $("#btn-sound").addEventListener("click", () => {
      const L = state.lightning;
      if (!L.thunder.enabled) L.thunder.enable(); else L.thunder.disable();
      refreshLightningReadout();
      renderInspector();
    });
    $("#btn-top").addEventListener("click", () => {
      if (state.cam.pitch > 1.2) { state.cam.pitch = 0.3; state.cam.yaw = 0.6; } else { state.cam.pitch = 1.45; state.cam.yaw = 0; }
      sync();
    });
    $("#btn-arrows").addEventListener("click", (e) => { state.wind.showArrows = !state.wind.showArrows; e.currentTarget.setAttribute("aria-pressed", String(state.wind.showArrows)); });
    $("#btn-arrows").setAttribute("aria-pressed", String(state.wind.showArrows));
    $("#btn-floor").addEventListener("click", (e) => { state.wind.showFloor = !state.wind.showFloor; e.currentTarget.setAttribute("aria-pressed", String(state.wind.showFloor)); });
    $("#btn-floor").setAttribute("aria-pressed", String(state.wind.showFloor));
    const speed = $("#time-scale");
    speed.addEventListener("input", () => { state.timeScale = +speed.value; $("#time-scale-v").textContent = state.timeScale.toFixed(2) + "×"; });
    $("#time-scale-v").textContent = state.timeScale.toFixed(2) + "×";
    window.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea")) return;
      if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
      if (e.key === "l" || e.key === "L") strikeNow();
    });
    sync();
  }

  function setupViewport() {
    const canvas = $("#view");
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const c = state.cam;
      if (drag.pan) {
        const s = c.dist * 0.0015;
        const cp = Math.cos(c.yaw), sp = Math.sin(c.yaw);
        c.target[0] += (-dx * cp) * s;
        c.target[2] += (dx * sp) * s;
        c.target[1] += dy * s;
      } else {
        c.yaw -= dx * 0.005;
        c.pitch = clamp(c.pitch + dy * 0.005, -1.45, 1.45);
      }
      $("#btn-top").setAttribute("aria-pressed", String(c.pitch > 1.2));
    });
    const up = () => { drag = null; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      state.cam.dist = clamp(state.cam.dist * Math.exp(e.deltaY * 0.001), 2, 60);
    }, { passive: false });
  }

  function resizeCanvas() {
    const canvas = $("#view");
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.floor(r.width * dpr));
    const h = Math.max(64, Math.floor(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      state.engine?.resize(w, h);
    }
  }

  // ----------------------------------------------------------------- boot
  async function boot() {
    const canvas = $("#view");
    const banner = $("#boot-error");
    try {
      resizeCanvas();
      state.engine = new PE.Engine(canvas);
      const info = await state.engine.init();
      state.lightning = new PE.Lightning();
      $("#st-adapter").textContent = info.adapter;
      state.engine.onLost = (info2) => {
        state.lostAtFrame = state.frame;
        banner.hidden = false;
        banner.textContent = "WebGPU device lost: " + (info2.message || info2.reason) + ". Reload the page.";
      };
      // ?scene=none|id,id,... overrides the default scene (handy for testing one system).
      const q = new URLSearchParams(location.search).get("scene");
      const ids = q === null ? PE.defaultScene : q === "none" || q === "" ? [] : q.split(",");
      for (const id of ids) if (PE.presetById(id)) state.systems.push(makeSystem(id));
      setupToolbar();
      setupViewport();
      window.addEventListener("resize", resizeCanvas);
      new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
      select({ type: "wind" });
      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      banner.hidden = false;
      banner.textContent = "Particle Editor could not start: " + (err && err.message ? err.message : err);
    }
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
