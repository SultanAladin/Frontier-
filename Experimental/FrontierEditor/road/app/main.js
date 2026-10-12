// Frontier Road Editor — page wiring.
//
// Owns the worker handshake, the parameter panel, the toggles and the minimap.
// The heavy lifting lives in the worker (city + mesh) and the viewer (WebGL);
// this file is the part that has to know about both.

import { Viewer } from './viewer.js';
import { FreeCamera } from './camera.js';
import { ROAD_CLASSES, CROSS_SECTIONS, MATERIALS } from '../core/styles.js';
import { clamp } from '../core/math.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);

const state = {
  seed: num('seed', 11),
  blocks: num('blocks', 8),
  blockSize: num('block', 240),
  jitter: num('jitter', 16),
  rail: params.get('rail') !== '0',
  ring: params.get('ring') !== '0',
  diagonals: num('diagonals', 2),
  amp: num('amp', 1),
  groups: { deck: true, markings: true, furniture: true, structures: true },
  ground: true,
  fog: true,
  busy: false,
  describe: null,
  stats: null,
  minimap: null,
  bounds: null,
  lastFrame: performance.now(),
};

const cam = new FreeCamera({ x: -320, y: 90, z: -320, speed: 40 });
const canvas = $('view');
let viewer = null;
let worker = null;

function terrain(x, z) {
  return (Math.sin(x / 520) * 9 + Math.cos(z / 610) * 7 + Math.sin((x + z) / 260) * 3) * state.amp;
}

function setStatus(text, pct) {
  const bar = $('bar');
  const label = $('status');
  if (label) label.textContent = text;
  if (bar) bar.style.width = `${Math.round(clamp(pct, 0, 1) * 100)}%`;
}

function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function startBuild() {
  if (state.busy) return;
  state.busy = true;
  $('overlay').classList.add('on');
  setStatus('starting', 0.02);
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { setStatus(m.stage, m.pct); return; }
    if (m.type === 'error') {
      state.busy = false;
      $('overlay').classList.remove('on');
      setStatus('build failed', 1);
      console.error(m.message);
      $('error').textContent = m.message;
      $('error').classList.add('on');
      return;
    }
    if (m.type !== 'done') return;
    state.describe = m.describe;
    state.stats = m.stats;
    state.minimap = m.minimap;
    state.bounds = m.bounds;
    viewer.uploadChunks(m.chunks);
    viewer.buildGround(terrain, m.bounds, [0.27, 0.33, 0.20]);
    cam.frame(m.bounds);
    cam.lookAt([(m.bounds[0] + m.bounds[3]) / 2, m.bounds[1], (m.bounds[2] + m.bounds[5]) / 2]);
    cam.pos[1] += 60;
    cam.pitch = -0.35;
    state.busy = false;
    $('overlay').classList.remove('on');
    setStatus('ready', 1);
    renderPanel();
    drawMinimap();
  };
  worker.postMessage({
    cmd: 'build',
    opts: {
      seed: state.seed,
      blocks: state.blocks,
      blockSize: state.blockSize,
      jitter: state.jitter,
      rail: state.rail,
      ring: state.ring,
      diagonals: state.diagonals,
      terrainAmp: state.amp,
    },
  });
}

// ── panel ────────────────────────────────────────────────────────────────────

function row(label, value, unit = '') {
  return `<div class="row"><span>${label}</span><b>${value}${unit}</b></div>`;
}

function renderPanel() {
  const d = state.describe;
  const s = state.stats;
  if (!d) return;
  const classes = Object.entries(d.byClass).sort((a, b) => b[1] - a[1]);
  const junctions = Object.entries(d.junctionTypes).sort((a, b) => b[1] - a[1]);
  $('summary').innerHTML = `
    ${row('Seeded city', `#${state.seed}`)}
    ${row('Roads', fmt(d.roads))}
    ${row('Junctions', fmt(d.junctions))}
    ${row('Length', d.lengthKm.toFixed(1), ' km')}
    ${row('Triangles', fmt(s?.tris ?? 0))}
    ${row('Signals', fmt(s?.counts?.signals ?? 0))}
    ${row('Corners', fmt(s?.counts?.corners ?? 0))}
    ${row('Kerbs', fmt(s?.counts?.kerbs ?? 0))}
    ${row('Street furniture', fmt(s?.counts?.furniture ?? 0))}
  `;
  $('classes').innerHTML = classes.map(([k, n]) => `<div class="row"><span>${k}</span><b>${n}</b></div>`).join('');
  $('junctionTypes').innerHTML = junctions.map(([k, n]) => `<div class="row"><span>${k}</span><b>${n}</b></div>`).join('');
  $('rules').innerHTML = `
    <div class="row"><span>Drive side</span><b>left</b></div>
    <div class="row"><span>Sections</span><b>${Object.keys(CROSS_SECTIONS).length}</b></div>
    <div class="row"><span>Materials</span><b>${Object.keys(MATERIALS).length}</b></div>
    <div class="row"><span>Road classes</span><b>${Object.keys(ROAD_CLASSES).length}</b></div>
  `;
}

// ── minimap ────────────────────────────────────────────────────────────────

const mini = $('minimap');
const mctx = mini?.getContext('2d');

function minimapTransform(w, h) {
  const b = state.bounds || [-100, 0, -100, 100, 0, 100];
  const size = Math.max(b[3] - b[0], b[5] - b[2]) * 1.05;
  const scale = Math.min(w, h) / size;
  const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
  return { scale, cx, cz, w, h };
}

function drawMinimap() {
  if (!mctx || !state.minimap) return;
  const w = mini.width, h = mini.height;
  const { scale, cx, cz } = minimapTransform(w, h);
  const toX = (x) => w / 2 + (x - cx) * scale;
  const toY = (z) => h / 2 + (z - cz) * scale;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = '#0d0f11';
  mctx.fillRect(0, 0, w, h);
  mctx.strokeStyle = '#4fd8e0';
  mctx.globalAlpha = 0.75;
  mctx.lineWidth = 1;
  mctx.beginPath();
  let o = 0;
  const mm = state.minimap;
  while (o < mm.length) {
    const count = mm[o++];
    mctx.moveTo(toX(mm[o]), toY(mm[o + 1]));
    for (let i = 1; i < count; i++) mctx.lineTo(toX(mm[o + i * 2]), toY(mm[o + i * 2 + 1]));
    o += count * 2;
  }
  mctx.stroke();
  mctx.globalAlpha = 1;
  // camera
  const px = toX(cam.pos[0]), py = toY(cam.pos[2]);
  mctx.fillStyle = '#f0f0f0';
  mctx.beginPath();
  mctx.arc(px, py, 3, 0, Math.PI * 2);
  mctx.fill();
  const f = cam.forward();
  mctx.strokeStyle = '#f0f0f0';
  mctx.beginPath();
  mctx.moveTo(px, py);
  mctx.lineTo(px + f[0] * 14, py + f[2] * 14);
  mctx.stroke();
}

mini?.addEventListener('mousedown', (e) => {
  const rect = mini.getBoundingClientRect();
  const w = mini.width, h = mini.height;
  const { scale, cx, cz } = minimapTransform(w, h);
  const x = ((e.clientX - rect.left) / rect.width) * w;
  const y = ((e.clientY - rect.top) / rect.height) * h;
  cam.pos[0] = cx + (x - w / 2) / scale;
  cam.pos[2] = cz + (y - h / 2) / scale;
  cam.pos[1] = Math.max(cam.pos[1], terrain(cam.pos[0], cam.pos[2]) + 8);
});

// ── controls ────────────────────────────────────────────────────────────────

function bindControls() {
  const rebuild = () => startBuild();
  $('rebuild')?.addEventListener('click', rebuild);
  $('reseed')?.addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 100000);
    $('seedOut').textContent = `#${state.seed}`;
    rebuild();
  });
  const bind = (id, key, out, fmtFn = (v) => v) => {
    const el = $(id);
    if (!el) return;
    el.value = String(state[key]);
    const update = () => {
      state[key] = Number(el.value);
      if (out) $(out).textContent = fmtFn(state[key]);
    };
    update();
    el.addEventListener('input', update);
    el.addEventListener('change', rebuild);
  };
  bind('blocks', 'blocks', 'blocksOut');
  bind('blockSize', 'blockSize', 'blockSizeOut', (v) => `${v} m`);
  bind('jitter', 'jitter', 'jitterOut', (v) => `${v} m`);
  bind('amp', 'amp', 'ampOut', (v) => `${v.toFixed(2)}×`);
  for (const id of ['rail', 'ring']) {
    const el = $(id);
    if (!el) continue;
    el.checked = state[id];
    el.addEventListener('change', () => { state[id] = el.checked; rebuild(); });
  }
  for (const name of ['deck', 'markings', 'furniture', 'structures']) {
    const el = $(`g-${name}`);
    if (!el) continue;
    el.checked = true;
    el.addEventListener('change', () => { state.groups[name] = el.checked; viewer.setGroup(name, el.checked); });
  }
  $('ground')?.addEventListener('change', (e) => { state.ground = e.target.checked; });
  $('fog')?.addEventListener('change', (e) => { state.fog = e.target.checked; });
  $('frame')?.addEventListener('click', () => { cam.frame(state.bounds); cam.pos[1] += 20; });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') document.body.classList.toggle('hideui');
    if (e.code === 'KeyM') $('minimapWrap')?.classList.toggle('off');
    if (e.code === 'KeyR') { state.seed = Math.floor(Math.random() * 100000); startBuild(); }
    if (e.code === 'KeyF') { cam.frame(state.bounds); }
    if (/^Digit[1-4]$/.test(e.code)) {
      const name = ['deck', 'markings', 'furniture', 'structures'][Number(e.code.slice(5)) - 1];
      const el = $(`g-${name}`);
      if (el) { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
    }
  });
}

// ── frame loop ──────────────────────────────────────────────────────────────

function frame(t) {
  const dt = Math.min(0.05, (t - state.lastFrame) / 1000 || 0.016);
  state.lastFrame = t;
  cam.update(dt);
  const stats = viewer.render(cam, {
    fogNear: state.fog ? 260 : 100000,
    fogFar: state.fog ? 2400 : 100001,
    fov: Number($('fov')?.value ?? 60),
  });
  const kmh = Math.hypot(cam.vel[0], cam.vel[2]) * 3.6;
  const hud = $('hud');
  if (hud) {
    hud.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h<span>·</span>${fmt(stats.tris)} tris<span>·</span>${stats.chunks}/${stats.total} tiles<span>·</span>x ${cam.pos[0].toFixed(0)} z ${cam.pos[2].toFixed(0)} y ${cam.pos[1].toFixed(1)}`;
  }
  drawMinimap();
  requestAnimationFrame(frame);
}

function boot() {
  try {
    viewer = new Viewer(canvas);
  } catch (err) {
    $('error').textContent = String(err.message || err);
    $('error').classList.add('on');
    return;
  }
  cam.attach(canvas);
  canvas.addEventListener('mousedown', () => {
    if (!document.pointerLockElement) canvas.requestPointerLock?.();
  });
  bindControls();
  $('seedOut').textContent = `#${state.seed}`;
  startBuild();
  requestAnimationFrame(frame);
}

boot();
