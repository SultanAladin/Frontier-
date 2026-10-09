// The browser host: a device, one pipeline, one draw.
//
// The whole interface is a single vkCmdDraw(4, instances) in the engine and a single
// pass.draw(4, count) here. There is no vertex buffer and no index buffer: the vertex stage derives
// the corner from its own index, which is why adding a figure costs 160 bytes and nothing else.

import { pack, resolve, FloatsPerFigure } from './figures.js';
import { SDF_WGSL } from './sdf.generated.js';
import { STREAK_WGSL } from './streaks.js';
import { constructHudLayout, assignValues } from './layout.js';
import { FIBRE_WGSL, packFibre, StreakPreset, FibreFloats } from './fibres.js';
import { CHASSIS_WGSL, packRoom, RoomFloats } from './chassis.js';

// Module-scope declarations come first so the fibre stages can reach the globals the figure stages
// also use. One module, one shader compilation, three pipelines off it.
const Prelude = `
struct Globals {
  viewClip : mat4x4f,
  eye      : vec4f,     // xyz = eye
  extent   : vec4f,     // xy = render size [px]
  ambient  : vec4f,     // xyz = scene-average irradiance on the panel
  timing   : vec4f,     // x = elapsed [s]
};

struct Fig {
  rowX    : vec4f,
  rowY    : vec4f,
  rowZ    : vec4f,
  size    : vec4f,      // xy half extent [m], z corner radius [m], w opacity
  clip    : vec4f,      // xy minimum, zw maximum, figure-local
  scal    : vec4f,      // x category, y ScalarAlpha, z ScalarBeta, w emissive weight
  tint    : vec4f,
  base    : vec4f,      // xyz albedo, w light role (1 = overlay, lights nothing)
  streakA : vec4f,
  streakB : vec4f,
};

@group(0) @binding(0) var<uniform> G : Globals;
@group(0) @binding(1) var<storage, read> Figures : array<Fig>;
`;

const Stages = `
struct Varying {
  @builtin(position) Position : vec4f,
  @location(0) @interpolate(flat) Figure : u32,
  @location(1) Local : vec2f,
};

// gl_VertexIndex 0..3 -> the corners of a triangle strip on the figure's local plane.
fn InterfaceCorner(VertexIndex : u32, HalfExtent : vec2f) -> vec2f {
  let Sign = vec2f(select(-1.0, 1.0, (VertexIndex & 1u) != 0u),
                   select(-1.0, 1.0, (VertexIndex & 2u) != 0u));
  return Sign * HalfExtent;
}

@vertex
fn VertexMain(@builtin(vertex_index) Vertex : u32,
              @builtin(instance_index) Instance : u32) -> Varying {
  let F = Figures[Instance];
  let Corner = InterfaceCorner(Vertex, F.size.xy);
  let Local = vec3f(Corner, 0.0);

  let World = vec3f(dot(F.rowX.xyz, Local) + F.rowX.w,
                    dot(F.rowY.xyz, Local) + F.rowY.w,
                    dot(F.rowZ.xyz, Local) + F.rowZ.w);

  var Out : Varying;
  Out.Position = G.viewClip * vec4f(World, 1.0);
  Out.Figure = Instance;
  Out.Local = Corner;
  return Out;
}

@fragment
fn FragmentMain(In : Varying) -> @location(0) vec4f {
  let F = Figures[In.Figure];

  // One screen pixel, in the figure's local metres. fwidth is the sum of the absolute derivatives —
  // the conservative estimate, and the reason the edge stays one pixel wide under perspective and
  // rotation alike.
  let PixelWidth = max(fwidth(In.Local.x), fwidth(In.Local.y));

  let Category = u32(F.scal.x + 0.5);

  var Coverage : f32;
  if (Category == kCategoryStreakField) {
    // The streak field answers with light, not with a distance: there is no edge for a coverage ramp
    // to be a pixel wide across, so asking CoverageFromDistance for one would be meaningless.
    Coverage = StreakFieldGlow(In.Local, F.size.xy, F.streakA, F.streakB, G.timing.x);
  } else {
    let Distance = DistanceFigure(Category, In.Local, F.size.xy, F.size.z, F.scal.y, F.scal.z);
    Coverage = CoverageFromDistance(Distance, PixelWidth);
  }

  Coverage *= ClipCoverage(In.Local, F.clip, 0.0, PixelWidth);
  if (Coverage <= 0.0) { discard; }

  let Alpha = Coverage * F.size.w * F.tint.w;
  if (Alpha <= 0.0) { discard; }

  // Surface response. An emissive element shows its tint whatever the room is doing; an albedo one
  // is lit by the ambient term, so a dark bezel sits DOWN in a dim room instead of glowing.
  let Emitted = F.tint.xyz;
  let Received = F.base.xyz * G.ambient.xyz;
  let Colour = mix(Received, Emitted, clamp(F.scal.w, 0.0, 1.0));

  return vec4f(Colour * Alpha, Alpha);   // premultiplied
}
`;

// ── matrices ─────────────────────────────────────────────────────────────────────────────────────
// World is right-handed Z-up, as the engine's is. Clip depth is 0..1, which is WebGPU's convention
// and Vulkan's both.

function lookAt(eye, at, up) {
  const f = normalise([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]);
  const s = normalise(cross(f, up));
  const u = cross(s, f);
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ];
}

function perspective(fovY, aspect, near, far) {
  const t = 1 / Math.tan(fovY * 0.5);
  return [
    t / aspect, 0, 0, 0,
    0, t, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (far * near) / (near - far), 0,
  ];
}

function multiply(A, B) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = A[0 * 4 + r] * B[c * 4 + 0] + A[1 * 4 + r] * B[c * 4 + 1]
                     + A[2 * 4 + r] * B[c * 4 + 2] + A[3 * 4 + r] * B[c * 4 + 3];
    }
  }
  return out;
}

const dot = (A, B) => A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
const cross = (A, B) => [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
const normalise = (A) => { const L = Math.hypot(A[0], A[1], A[2]) || 1; return [A[0] / L, A[1] / L, A[2] / L]; };

// ── springs ──────────────────────────────────────────────────────────────────────────────────────
// MotionIntegrator's channels, in miniature: a second-order step per value, so a number never jumps.
// The needle's envelope is the trial panel's own (zeta ~ 0.68, about seven percent overshoot); the
// bar is critically damped, because a progress bar that overshoots reads as a fault.

class Channel {
  constructor(stiffness, damping, value = 0) {
    this.k = stiffness; this.c = damping; this.value = value; this.rate = 0; this.target = value;
  }
  advance(dt) {
    // Sub-stepped at a fixed 240 Hz: a stiff spring integrated at the display's refresh explodes on
    // a slow frame, and a HUD that detonates when the tab is backgrounded is not acceptable.
    const step = 1 / 240;
    let left = Math.min(dt, 0.25);
    while (left > 0) {
      const h = Math.min(step, left);
      this.rate += (this.k * (this.target - this.value) - this.c * this.rate) * h;
      this.value += this.rate * h;
      left -= h;
    }
    return this.value;
  }
}

// ── the host ─────────────────────────────────────────────────────────────────────────────────────

const State = {
  speed: 0, boost: 0.0, regen: 0.35, sport: 0,
  ambient: 0.35,
  orbit: 0.42, tilt: 0.18, distance: 0.78,
  running: true, demo: true,
  streak: null,
  // The backdrop ladder. 'live' is the real 3D fibres; 'field' is the analytic plane field, which
  // is the rung a reflection or a distant panel gets; 'off' is neither.
  backdrop: 'live',
};

async function start() {
  const canvas = document.getElementById('viewport');
  const notice = document.getElementById('notice');

  if (!navigator.gpu) {
    notice.hidden = false;
    notice.textContent = 'This reference needs WebGPU. Chrome or Edge 113+, or Safari 18+.';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    notice.hidden = false;
    notice.textContent = 'WebGPU is present but no adapter answered. Hardware acceleration may be off.';
    return;
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({
    label: 'spatial interface',
    code: `${Prelude}\n${SDF_WGSL}\n${STREAK_WGSL}\n${FIBRE_WGSL}\n${CHASSIS_WGSL}\n${Stages}`,
  });

  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((One) => One.type === 'error');
  if (errors.length) {
    notice.hidden = false;
    notice.textContent = errors.map((One) => `${One.lineNum}:${One.linePos} ${One.message}`).join('\n');
    throw new Error(errors[0].message);
  }

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'VertexMain' },
    fragment: {
      module,
      entryPoint: 'FragmentMain',
      targets: [{
        format,
        // Premultiplied alpha, composited against the resolved scene — the engine's own blend.
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    primitive: { topology: 'triangle-strip' },
  });

  // The world behind the glass. Additive, because light adds: two strands crossing are brighter
  // than either, and that is not an alpha blend. No depth buffer is bound at all — every figure in
  // this composition is coplanar to within three millimetres, so depth would z-fight rather than
  // resolve, and the fibres are glow that should never occlude anything anyway.
  const additive = {
    color: { srcFactor: 'one', dstFactor: 'one' },
    alpha: { srcFactor: 'one', dstFactor: 'one' },
  };
  const fibrePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsFibre' },
    fragment: { module, entryPoint: 'fsFibre', targets: [{ format, blend: additive }] },
    primitive: { topology: 'triangle-list' },
  });
  const sparkPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsSpark' },
    fragment: { module, entryPoint: 'fsSpark', targets: [{ format, blend: additive }] },
    primitive: { topology: 'triangle-list' },
  });

  // The tablet as an object. The body is opaque and goes down first, so everything else lands on
  // a real surface; the glass is composited last, over the finished interface.
  const roomPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsRoom' },
    fragment: { module, entryPoint: 'fsRoom', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const glassPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsGlass' },
    fragment: { module, entryPoint: 'fsGlass', targets: [{ format, blend: additive }] },
    primitive: { topology: 'triangle-strip' },
  });

  const { structure, handles } = constructHudLayout();
  State.streak = structure.query(handles.streaks).streak.slice();

  const globals = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let capacity = Math.max(structure.count, 64);
  let figureBuffer = device.createBuffer({
    size: capacity * FloatsPerFigure * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: figureBuffer } }],
  });

  const roomData = new Float32Array(RoomFloats);
  const roomBuffer = device.createBuffer({
    size: roomData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const roomEntries = [{ binding: 0, resource: { buffer: globals } },
                       { binding: 3, resource: { buffer: roomBuffer } }];
  const roomBind = device.createBindGroup({ layout: roomPipeline.getBindGroupLayout(0), entries: roomEntries });
  const glassBind = device.createBindGroup({ layout: glassPipeline.getBindGroupLayout(0), entries: roomEntries });

  const fibreData = new Float32Array(FibreFloats);
  const fibreBuffer = device.createBuffer({
    size: fibreData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const fibreEntries = [{ binding: 0, resource: { buffer: globals } },
                        { binding: 2, resource: { buffer: fibreBuffer } }];
  const fibreBind = device.createBindGroup({ layout: fibrePipeline.getBindGroupLayout(0), entries: fibreEntries });
  const sparkBind = device.createBindGroup({ layout: sparkPipeline.getBindGroupLayout(0), entries: fibreEntries });

  const boostChannel = new Channel(260, 22);
  const fillChannel = new Channel(220, 30, State.regen);
  const sportChannel = new Channel(300, 26);
  const speedChannel = new Channel(90, 17);

  wireControls(structure, handles);
  wireCamera(canvas);

  // Reported on the first frame, not after the first half second, so a page that renders once and
  // then dies still says what it managed.
  let firstFrame = true;

  const globalData = new Float32Array(32);
  let last = performance.now() / 1000;
  let elapsed = 0;
  let frames = 0, frameClock = last, rate = 0;

  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - last, 0.1);
    last = now;
    if (State.running) elapsed += dt;

    if (State.demo) {
      // The scripted cycle, so the panel is alive before anything is touched.
      const cycle = (elapsed % 12) / 12;
      State.boost = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2 * 2);
      State.speed = 18 + 160 * State.boost;
      State.sport = cycle > 0.5 ? 1 : 0;
      State.regen = 0.5 + 0.45 * Math.sin(cycle * Math.PI * 2);
      reflectControls();
    }

    boostChannel.target = State.boost;
    fillChannel.target = State.regen;
    sportChannel.target = State.sport;
    speedChannel.target = State.speed;

    assignValues(structure, handles, {
      speed: speedChannel.advance(dt),
      boost: boostChannel.advance(dt),
      regen: fillChannel.advance(dt),
      sport: sportChannel.advance(dt),
      time: elapsed,
    });

    const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }

    const eye = [
      Math.sin(State.orbit) * Math.cos(State.tilt) * State.distance,
      -Math.cos(State.orbit) * Math.cos(State.tilt) * State.distance,
      Math.sin(State.tilt) * State.distance,
    ];
    const fieldOfView = 0.62;
    const forward = normalise([-eye[0], -eye[1], -eye[2]]);
    const right = normalise(cross(forward, [0, 0, 1]));
    const rise = cross(right, forward);
    const view = lookAt(eye, [0, 0, 0], [0, 0, 1]);
    const projection = perspective(fieldOfView, width / height, 0.02, 40);
    const viewClip = multiply(projection, view);

    // Pixels per world metre at w = 1, which is how the fibres keep a constant pixel width at any
    // distance — the same quantity the particle editor passes as projScale.
    const projectionScale = 0.5 * height / Math.tan(fieldOfView * 0.5);

    // The analytic field is a RUNG, not a fallback: it is the only form of this backdrop that can
    // be answered at a hit point, because it is a closed-form function of a plane coordinate and
    // geometry is not. It is drawn only when it is the rung in use.
    structure.query(handles.streaks).opacity = State.backdrop === 'field' ? State.fieldOpacity : 0;

    globalData.set(viewClip, 0);
    globalData.set([eye[0], eye[1], eye[2], 0], 16);
    globalData.set([width, height, 0, 0], 20);
    const a = State.ambient;
    globalData.set([a, a * 1.02, a * 1.08, 0], 24);
    globalData.set([elapsed, dt, 0, 0], 28);
    device.queue.writeBuffer(globals, 0, globalData);

    const { placements } = resolve(structure);
    const packed = pack(structure, placements, eye);

    // Where the world goes: after the housing, the face and the field rung, before every control.
    const backdropRank = structure.query(handles.streaks).orderingRank;
    let splitAt = packed.order.findIndex((at) => structure.query(at).orderingRank > backdropRank);
    if (splitAt < 0) splitAt = packed.count;

    packRoom(roomData, placements[handles.housing], {
      forward, right, up: rise, tanHalf: Math.tan(fieldOfView * 0.5), aspect: width / height,
    });
    device.queue.writeBuffer(roomBuffer, 0, roomData);

    if (State.backdrop === 'live') {
      packFibre(fibreData, StreakPreset, {
        time: elapsed, width, height, projectionScale,
        rows: placements[handles.housing],
      });
      device.queue.writeBuffer(fibreBuffer, 0, fibreData);
    }

    if (packed.count > capacity) {
      capacity = packed.count * 2;
      figureBuffer.destroy();
      figureBuffer = device.createBuffer({
        size: capacity * FloatsPerFigure * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: figureBuffer } }],
      });
    }
    device.queue.writeBuffer(figureBuffer, 0, packed.data);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.012, g: 0.014, b: 0.018, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    // The tablet first: an opaque body, marched, that everything else sits on.
    pass.setPipeline(roomPipeline);
    pass.setBindGroup(0, roomBind);
    pass.draw(3);

    // The interface is still one draw — the world is inserted between its two halves.
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(4, splitAt, 0, 0);

    if (State.backdrop === 'live') {
      pass.setPipeline(fibrePipeline);
      pass.setBindGroup(0, fibreBind);
      pass.draw(StreakPreset.strands * StreakPreset.segments * 6);
      pass.setPipeline(sparkPipeline);
      pass.setBindGroup(0, sparkBind);
      pass.draw(StreakPreset.strands * 6);
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(4, packed.count - splitAt, 0, splitAt);

    // The glass last, over the finished interface, because that is where a reflection lives.
    pass.setPipeline(glassPipeline);
    pass.setBindGroup(0, glassBind);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);

    frames++;
    if (firstFrame || now - frameClock > 0.5) {
      firstFrame = false;
      rate = frames / (now - frameClock);
      frames = 0; frameClock = now;
      const strands = State.backdrop === 'live' ? ` · ${StreakPreset.strands} fibres` : '';
      document.getElementById('readout').textContent =
        `${packed.count} figures${strands} · ${rate.toFixed(0)} fps`;
    }
    requestAnimationFrame(guarded);
  }

  // A throw inside a requestAnimationFrame callback is logged and then swallowed: the loop simply
  // stops and the canvas freezes with no explanation. Catch it where it can still be shown.
  function guarded() {
    try { frame(); } catch (trouble) { announce(trouble); }
  }
  requestAnimationFrame(guarded);
}

// ── the control rail ─────────────────────────────────────────────────────────────────────────────

const RungNotes = {
  live: 'Real 3D Bézier fibres, drawn as geometry in the volume behind the glass and clipped by the '
      + "panel's own rounded rectangle. Parallax is real — orbit the tablet and the light swims "
      + 'behind the surface.',
  field: 'The analytic plane field. Flat by construction: every strand is at the same depth, so it '
       + 'slides with the surface instead of swimming behind it. This is the rung a reflection or a '
       + 'distant panel gets, because it can be answered at a hit point.',
  off: 'No backdrop. The instrument on a bare card.',
};

const StreakFields = [
  ['strands', 0, 1, 48, 1], ['amplitude', 1, 0, 0.06, 0.001], ['waves', 2, 0.2, 8, 0.1],
  ['speed', 3, 0, 3, 0.01], ['tail', 4, 0.02, 1.5, 0.01], ['seed', 5, 0, 64, 1],
  ['intensity', 6, 0, 4, 0.01], ['core', 7, 0.0005, 0.012, 0.0001],
];

// Every lookup here goes through this. A control that is missing from the markup is a bug worth
// seeing, but it is not worth losing the whole panel over — the page reports it and carries on.
function control(selector) {
  const found = document.querySelector(selector);
  if (!found) console.warn(`SpatialHud: no control matches ${selector}`);
  return found;
}

function wireControls(structure, handles) {
  for (const [name, index] of StreakFields) {
    const input = control(`[data-streak="${name}"]`);
    if (!input) continue;
    input.value = State.streak[index];
    const readout = input.nextElementSibling;
    const show = () => {
      if (readout) readout.textContent = Number(input.value).toString();
    };
    show();
    input.addEventListener('input', () => {
      State.streak[index] = Number(input.value);
      structure.query(handles.streaks).streak = State.streak.slice();
      show();
    });
  }

  const fieldOpacity = control('[data-field="fieldOpacity"]');
  if (fieldOpacity) {
    State.fieldOpacity = Number(fieldOpacity.value);
    fieldOpacity.addEventListener('input', (event) => {
      State.fieldOpacity = Number(event.target.value);
    });
  }

  for (const button of document.querySelectorAll('[data-rung]')) {
    button.addEventListener('click', () => {
      State.backdrop = button.dataset.rung;
      showRung();
    });
  }

  for (const name of ['speed', 'boost', 'regen', 'ambient']) {
    const input = control(`[data-field="${name}"]`);
    if (!input) continue;
    input.addEventListener('input', () => {
      State[name] = Number(input.value);
      if (name !== 'ambient') stopDemo();
    });
  }
  control('[data-field="sport"]')?.addEventListener('change', (event) => {
    State.sport = event.target.checked ? 1 : 0;
    stopDemo();
  });
  control('[data-field="demo"]')?.addEventListener('change', (event) => {
    State.demo = event.target.checked;
  });
  showRung();
  reflectControls();
}

function stopDemo() {
  State.demo = false;
  const demo = document.querySelector('[data-field="demo"]');
  if (demo) demo.checked = false;
}

function showRung() {
  const note = document.getElementById('rung-note');
  if (note) note.textContent = RungNotes[State.backdrop];
  for (const button of document.querySelectorAll('[data-rung]')) {
    button.classList.toggle('on', button.dataset.rung === State.backdrop);
  }
}

function reflectControls() {
  for (const name of ['speed', 'boost', 'regen']) {
    const input = document.querySelector(`[data-field="${name}"]`);
    if (input && document.activeElement !== input) input.value = State[name];
  }
  const sport = document.querySelector('[data-field="sport"]');
  if (sport) sport.checked = State.sport > 0.5;
}

function wireCamera(canvas) {
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    dragging = false; canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    State.orbit += (event.clientX - lastX) * 0.006;
    State.tilt = Math.max(-1.2, Math.min(1.2, State.tilt + (event.clientY - lastY) * 0.005));
    lastX = event.clientX; lastY = event.clientY;
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    State.distance = Math.max(0.3, Math.min(3.0, State.distance * (1 + event.deltaY * 0.0012)));
  }, { passive: false });
}

// 🔴 NOTHING MAY FAIL SILENTLY.
//
//    The first time this page broke, it broke invisibly: one exception while wiring a control left
//    a black canvas, an untouched "starting" readout and no message anywhere. A WebGPU page that
//    cannot say why it is blank is almost impossible to report a bug against, so every path into
//    start() now ends somewhere visible.
function announce(trouble) {
  const notice = document.getElementById('notice');
  notice.hidden = false;
  notice.textContent = String(trouble && trouble.stack ? trouble.stack : trouble);
  const readout = document.getElementById('readout');
  if (readout) readout.textContent = 'stopped';
  console.error(trouble);
}

function boot() {
  try {
    start().catch(announce);
  } catch (trouble) {
    announce(trouble);
  }
}

// A module script is deferred, so DOMContentLoaded has already fired by the time this runs.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
