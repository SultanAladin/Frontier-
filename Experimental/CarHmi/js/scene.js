// 3D tablet scene — camera rig (orbit / tilt / zoom), preset views, auto-spin,
// and the glass response. The glass sheen position + screen brightness follow
// the view angle (grazing = brighter glare, dimmer screen — the SpatialHud
// Fresnel finding, DOM edition). VIEWS is DOM-free and pinned by Checks.mjs.

export const VIEWS = {
  front: { rx: 0, ry: 0, s: 1.0, label: '2D · front' },
  iso: { rx: -14, ry: 24, s: 0.95, label: '3D · angle' },
  side: { rx: -6, ry: 52, s: 0.9, label: '3D · side' },
  top: { rx: -54, ry: 8, s: 0.9, label: '3D · top' },
};
const RX_MIN = -70, RX_MAX = 30, RY_MIN = -70, RY_MAX = 70;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function initScene(root) {
  const tablet = root.querySelector('#tablet3d');
  const screen = root.querySelector('#screen');
  const glass = root.querySelector('#glass');
  const stage = root.querySelector('#stage');
  const state = { rx: VIEWS.iso.rx, ry: VIEWS.iso.ry, s: VIEWS.iso.s, auto: false, view: 'iso' };
  let raf = 0, last = 0;

  function apply(anim) {
    tablet.classList.toggle('anim', !!anim);
    tablet.style.transform = `rotateX(${state.rx}deg) rotateY(${state.ry}deg) scale(${state.s})`;
    // glass response: sheen slides with yaw, glare grows toward grazing.
    const tilt = clamp((Math.abs(state.rx) + Math.abs(state.ry)) / 70, 0, 1);
    glass.style.setProperty('--sx1', `${-state.ry * 6}px`);
    glass.style.setProperty('--sx2', `${-state.ry * 11}px`);
    glass.style.setProperty('--glare', (0.35 + tilt * 0.65).toFixed(2));
    screen.style.setProperty('--dim', (1 - tilt * 0.28).toFixed(2));
  }

  function spin(now) {
    if (!state.auto) { raf = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    state.ry += dt * 14;
    if (state.ry > RY_MAX) state.ry = RY_MIN;
    state.view = 'custom';
    apply(false); sync();
    raf = requestAnimationFrame(spin);
  }

  // orbit by dragging the backdrop (never the screen — it stays interactive).
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#screen')) return;
    drag = { x: e.clientX, y: e.clientY, rx: state.rx, ry: state.ry };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.ry = clamp(drag.ry + (e.clientX - drag.x) * 0.25, RY_MIN, RY_MAX);
    state.rx = clamp(drag.rx - (e.clientY - drag.y) * 0.25, RX_MIN, RX_MAX);
    state.view = 'custom';
    apply(false); sync();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // control panel lives in app.js; scene exposes a sync hook + api.
  let sync = () => {};
  const api = {
    state,
    onSync(fn) { sync = fn; },
    setView(name) {
      const v = VIEWS[name]; if (!v) return;
      Object.assign(state, { rx: v.rx, ry: v.ry, s: v.s, view: name });
      apply(true); sync();
    },
    setRX(v) { state.rx = clamp(v, RX_MIN, RX_MAX); state.view = 'custom'; apply(false); sync(); },
    setRY(v) { state.ry = clamp(v, RY_MIN, RY_MAX); state.view = 'custom'; apply(false); sync(); },
    setS(v) { state.s = clamp(v, 0.55, 1.25); apply(false); sync(); },
    toggleAuto() {
      state.auto = !state.auto;
      if (state.auto) { last = performance.now(); if (!raf) raf = requestAnimationFrame(spin); }
      sync(); return state.auto;
    },
  };
  apply(false);
  return api;
}
