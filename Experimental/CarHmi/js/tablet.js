// Tablet shell — boot overlay, icon rail, page router, quick shade, on-screen
// keyboard, snapshot feed. Pages render HTML; this file owns navigation and
// the phone contract (edge-back, shade, keyboard summon).

import { attachGestures } from './touch.js';
import { startSnapshot } from './snapshot.js';
import { BootFX } from './particles.js';
import { mountPreview } from './preview.js';
import * as V from './pages-vehicle.js';
import * as O from './pages-online.js';

const APPS = [
  { sect: 'Car' },
  { id: 'home', icon: '▦', name: 'Home' },
  { id: 'steering', icon: '⌖', name: 'Steer' },
  { id: 'suspension', icon: '⤢', name: 'Susp.' },
  { id: 'aero', icon: '⋙', name: 'Aero' },
  { id: 'power', icon: '⚡', name: 'Power' },
  { id: 'tyres', icon: '◉', name: 'Tyres' },
  { id: 'data', icon: '📈', name: 'Data' },
  { id: 'preview', icon: '🚗', name: 'Car' },
  { sect: 'Online' },
  { id: 'messages', icon: '✉', name: 'Msgs', badge: 2 },
  { id: 'contacts', icon: '👥', name: 'People' },
  { id: 'session', icon: '🏁', name: 'Session' },
  { id: 'account', icon: '⚙', name: 'Account' },
];

const gridApps = APPS.filter((a) => a.id && a.id !== 'home');
function renderHome() {
  return `<h1>Garage</h1><p class="sub">Swipe pages · tap to open · drag down from the top for quick settings</p>
    <div class="apps">${gridApps.map((a) =>
      `<button class="app" data-open="${a.id}"><span class="ic">${a.icon}</span>${a.name}<br>
      <small>${a.id === 'session' ? '3 in lobby' : a.id === 'messages' ? '2 unread' : ' '}</small></button>`).join('')}
    </div>`;
}

const ROUTES = {
  home: { render: renderHome, wire: (r) => r.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.open))) },
  steering: { render: V.renderSteering, wire: V.wireVehiclePage },
  suspension: { render: V.renderSuspension, wire: V.wireVehiclePage },
  aero: { render: V.renderAero, wire: V.wireVehiclePage },
  power: { render: V.renderPower, wire: V.wireVehiclePage },
  tyres: { render: V.renderTyres, wire: V.wireVehiclePage },
  data: { render: V.renderData, wire: V.wireVehiclePage },
  preview: {
    render: () => `<h1>PROTO-X</h1><p class="sub">Own camera · own studio light · 18 Hz · pauses when hidden</p>
      <div id="previewWrap"><canvas id="previewCv"></canvas><span class="badge"></span>
      <span class="hint">drag to orbit · pinch to zoom</span></div>
      <div class="grid2" style="margin-top:14px"><div class="card"><h2>Dimensions · ControlVehicle.blend</h2>
      <div class="row"><label>Wheelbase</label><output>3.396 m</output></div>
      <div class="row"><label>Track F/R</label><output>2.095 m</output></div></div>
      <div class="card"><h2>Spec</h2>
      <div class="row"><label>Mass</label><output>1300 kg</output></div>
      <div class="row"><label>Tyre Ø</label><output>1.017 m</output></div></div></div>`,
    wire: (r) => { previewCtl = mountPreview(r.querySelector('#previewCv'), r.querySelector('.badge')); },
    leave: () => { previewCtl?.destroy(); previewCtl = null; },
  },
  messages: { render: O.renderMessages, wire: O.wireMessages },
  contacts: { render: O.renderContacts, wire: O.wireContacts },
  session: { render: O.renderSession, wire: (r) => O.wireSession(r, () => go('session')) },
  account: { render: O.renderAccount, wire: O.wireAccount },
};

let current = '', previewCtl = null, booted = false;
const page = document.querySelector('#page');
const rail = document.querySelector('#rail');

function go(id) {
  if (!ROUTES[id]) return;
  ROUTES[current]?.leave?.();
  current = id;
  page.innerHTML = ROUTES[id].render();
  ROUTES[id].wire(page);
  page.scrollTop = 0;
  rail.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  hideKb();
}

// rail
rail.innerHTML = APPS.map((a) => a.sect ? `<div class="sect">${a.sect}</div>`
  : `<button data-go="${a.id}"><span class="ic">${a.icon}</span>${a.name}
     ${a.badge ? `<span class="dot">${a.badge}</span>` : ''}</button>`).join('');
rail.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

// edge-back: swipe right from the left edge returns home.
attachGestures(page, {
  onSwipe: ({ dir, x }) => { if (dir === 'right' && x < 60 && current !== 'home') go('home'); },
});

// shade: drag down from the status bar.
const shade = document.querySelector('#shade');
const bar = document.querySelector('#statusbar');
attachGestures(bar, {
  onSwipe: ({ dir }) => { if (dir === 'down') shade.classList.add('open'); },
  onTap: () => shade.classList.toggle('open'),
});
shade.querySelector('#shadeClose').addEventListener('click', () => shade.classList.remove('open'));

// clock.
const clock = document.querySelector('#clock');
setInterval(() => { clock.textContent = new Date().toTimeString().slice(0, 5); }, 5000);
clock.textContent = new Date().toTimeString().slice(0, 5);

// snapshot feed @ 4 Hz — text/bar readouts only (gauges live in the cluster).
let units = 'metric';
document.addEventListener('hmi-units', (e) => { units = e.detail; });
const formatters = {
  f0: (v) => Math.round(v).toString(), f1: (v) => v.toFixed(1), f2: (v) => v.toFixed(2),
  f0big: (v) => Math.round(v).toString(), pct: (v) => Math.round(v * 100).toString(),
  gear: (v) => (v === 0 ? 'N' : v.toString()),
  slip: (v, s) => (s.brake > 0 ? (-s.brake * 0.14).toFixed(3) : (s.throttle * 0.06).toFixed(3)),
  travel: () => '−20 / +80 mm', 'static-relax': () => 'relaxation', 'static-mu': () => 'μ 1.15',
  travelCorner: (v) => Math.round(v * 1000).toString(),
};
function feed(snap) {
  document.querySelector('#sbSpeed').innerHTML = `<b>${Math.round(snap.speedKmh)}</b> km/h`;
  document.querySelector('#sbGear').innerHTML = `gear <b>${snap.gear === 0 ? 'N' : snap.gear}</b>`;
  document.querySelector('#sbTyre').innerHTML = `tyre <b>${Math.round(Math.max(...snap.tyreTempC))}°</b>`;
  const val = (k) => {
    if (k.startsWith('travel')) return snap.damperTravelM[+k.slice(6)];
    if (k.startsWith('tyre')) return snap.tyreTempC[+k.slice(4)];
    if (k.startsWith('brake')) return snap.brakeTempC[+k.slice(5)];
    if (k === 'slip' || k === 'travel' || k.startsWith('static')) return 0;
    return snap[k];
  };
  page.querySelectorAll('output[data-snap]').forEach((o) => {
    const f = formatters[o.dataset.fmt] || formatters.f0;
    const v = val(o.dataset.snap);
    o.textContent = o.dataset.unit ? `${f(v, snap)} ${o.dataset.unit}` : f(v, snap);
    o.classList.toggle('warn', o.dataset.snap.startsWith('tyre') && v > 85);
    o.classList.toggle('bad', o.dataset.snap.startsWith('tyre') && v > 100);
  });
  page.querySelectorAll('[data-tyreheat]').forEach((el) => {
    const t = snap.tyreTempC[+el.dataset.tyreheat];
    const k = Math.min(1, Math.max(0, (t - 50) / 60));
    el.style.width = `${Math.round(k * 100)}%`;
    el.className = t > 100 ? 'crit' : t > 85 ? 'hot' : '';
  });
  page.querySelectorAll('[data-tyrebar]').forEach((el) => {
    el.textContent = `${Math.round(snap.tyreTempC[+el.dataset.tyrebar])} °C carcass`;
  });
}
startSnapshot(4, feed);

// on-screen keyboard — summoned by any [data-kb] input.
const kb = document.querySelector('#kb');
let kbTarget = null;
const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
kb.innerHTML = ROWS.map((r, i) =>
  `<div class="kr">${r.split('').map((c) => `<button data-k="${c}">${c}</button>`).join('')}
   ${i === 3 ? '<button class="wide" data-k="⌫">⌫</button>' : ''}</div>`).join('') +
  `<div class="kr"><button class="wide" data-k=" ">space</button>
   <button class="wide" data-k="✕">close</button><button class="wide go" data-k="⏎">send</button></div>`;
kb.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  if (!kbTarget) return;
  const k = b.dataset.k;
  if (k === '✕') return hideKb();
  if (k === '⌫') kbTarget.value = kbTarget.value.slice(0, -1);
  else if (k === '⏎') { kbTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); hideKb(); }
  else kbTarget.value += (kbTarget.tagName === 'INPUT' && kbTarget.type !== 'text' ? k : k.toLowerCase());
  kbTarget.focus();
}));
function hideKb() { kb.classList.remove('open'); kbTarget = null; }
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('[data-kb]')) { kbTarget = e.target; kb.classList.add('open'); }
  else hideKb();
});

// ── boot: backlight → stardust → lines → logo → systems → settle ──
const boot = document.querySelector('#boot');
const sysline = boot.querySelector('.sys');
const fx = new BootFX(boot.querySelector('canvas'));
const SYSTEMS = ['solver link … ok', 'tyre thermals … ok', 'aero kit … ok', 'lobby link … ok'];
function runBoot() {
  fx.start();
  const t0 = performance.now();
  booted = false;
  setTimeout(() => boot.classList.add('show-logo'), 1800);
  SYSTEMS.forEach((s, i) => setTimeout(() => { sysline.textContent = s; }, 2400 + i * 220));
  const done = () => {
    if (booted) return; booted = true;
    boot.classList.add('gone'); fx.stop();
    setTimeout(() => boot.remove(), 700);
  };
  boot.addEventListener('click', () => { if (performance.now() - t0 > 1800) done(); });
  setTimeout(done, 4000);
}

go('home');
runBoot();
