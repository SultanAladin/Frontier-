// Shell — control panel (views, camera, grid switcher), the 5 grid renderers,
// app open/close, status clock, toasts. Grids render into #gridArea; the app
// window slides over them; the home bar always returns.

import { APPS, icon, appName, appBlurb } from './icons.js';
import { GRIDS, FOLDERS, DOCK, PAGE_SIZE, chunk } from './grids.js';
import { renderAppScreen, wireAppScreen } from './apps.js';
import { VIEWS, initScene } from './scene.js';

const $ = (s) => document.querySelector(s);
const gridArea = $('#gridArea'), appwin = $('#appwin'), toastEl = $('#toast');
let grid = 'pages', pageIdx = 0, folderOpen = -1, appCleanup = null, wall = 0;

let toastT = 0;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ── scene + control panel ──────────────────────────────────────────
const scene = initScene(document);
const viewBtns = $('#viewBtns'), gridBtns = $('#gridBtns');

viewBtns.innerHTML = Object.entries(VIEWS).map(([k, v]) =>
  `<button data-v="${k}">${v.label}</button>`).join('') +
  `<button data-v="__spin" class="spin">⟳ spin</button>`;
viewBtns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.v === '__spin') {
    const on = scene.toggleAuto();
    b.classList.toggle('on', on);
  } else scene.setView(b.dataset.v);
}));

gridBtns.innerHTML = GRIDS.map((g) =>
  `<button data-g="${g.id}" class="${g.id === grid ? 'on' : ''}"><b>${g.name}</b><span>${g.desc}</span></button>`).join('');
gridBtns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  grid = b.dataset.g; pageIdx = 0; folderOpen = -1;
  gridBtns.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderGrid();
}));

const rxR = $('#rx'), ryR = $('#ry'), zR = $('#zoom');
rxR.addEventListener('input', () => scene.setRX(+rxR.value));
ryR.addEventListener('input', () => scene.setRY(+ryR.value));
zR.addEventListener('input', () => scene.setS(+zR.value));
scene.onSync(() => {
  const s = scene.state;
  rxR.value = s.rx; ryR.value = s.ry; zR.value = s.s;
  $('#camlabel').textContent = s.view === 'custom'
    ? `custom · tilt ${Math.round(s.rx)}° turn ${Math.round(s.ry)}°`
    : (VIEWS[s.view]?.label ?? s.view);
  viewBtns.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === s.view));
});

// ── grid renderers ─────────────────────────────────────────────────
const tile = (id, extra = '') =>
  `<button class="tile" data-app="${id}" ${extra}><span class="ti">${icon(id)}</span><em>${appName(id)}</em></button>`;

function renderPages() {
  const pages = chunk(APPS.filter((a) => !DOCK.includes(a.id)), PAGE_SIZE);
  pageIdx = Math.min(pageIdx, pages.length - 1);
  gridArea.innerHTML = `<div class="pagenav"><button id="pgprev">‹</button>
    <span class="dots">${pages.map((_, i) => `<i class="${i === pageIdx ? 'on' : ''}" data-pg="${i}"></i>`).join('')}</span>
    <button id="pgnext">›</button></div>
    <div class="pagetrack"><div class="pagegrid">${pages[pageIdx].map((a) => tile(a.id)).join('')}</div></div>
    <div class="dock">${DOCK.map((id) => tile(id)).join('')}</div>`;
  const go = (d) => { pageIdx = (pageIdx + d + pages.length) % pages.length; renderGrid(); };
  gridArea.querySelector('#pgprev').onclick = () => go(-1);
  gridArea.querySelector('#pgnext').onclick = () => go(1);
  gridArea.querySelectorAll('[data-pg]').forEach((d) =>
    d.addEventListener('click', () => { pageIdx = +d.dataset.pg; renderGrid(); }));
  // swipe between pages.
  const track = gridArea.querySelector('.pagetrack');
  let sx = 0;
  track.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  track.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    if (dx < -40) go(1); else if (dx > 40) go(-1);
  });
}

function renderFolders() {
  if (folderOpen < 0) {
    gridArea.innerHTML = `<div class="foldergrid">${FOLDERS.map((f, i) =>
      `<button class="folder" data-f="${i}"><span class="fpreview">${
        f.apps.slice(0, 4).map((id) => `<span class="mini">${icon(id)}</span>`).join('')}</span>
        <em>${f.name}</em></button>`).join('')}</div>`;
    gridArea.querySelectorAll('[data-f]').forEach((b) =>
      b.addEventListener('click', () => { folderOpen = +b.dataset.f; renderGrid(); }));
  } else {
    const f = FOLDERS[folderOpen];
    gridArea.innerHTML = `<div class="pagenav"><button id="fback">‹ ${f.name}</button></div>
      <div class="pagegrid">${f.apps.map((id) => tile(id)).join('')}</div>`;
    gridArea.querySelector('#fback').onclick = () => { folderOpen = -1; renderGrid(); };
  }
}

function renderTiles() {
  const rest = APPS.filter((a) => !['nav', 'media', 'climate'].includes(a.id));
  gridArea.innerHTML = `<div class="tilegrid">
    <button class="wtile w-nav" data-app="nav"><b>Navigation</b>
      <svg viewBox="0 0 200 60"><path d="M8 50 L70 42 L130 30 L192 12" stroke="#14b8f2"
      stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="8" cy="50" r="6" fill="#3ddc84"/>
      <circle cx="192" cy="12" r="6" fill="#ff5a5a"/></svg><span>Home · 12 min · light traffic</span></button>
    <button class="wtile w-media" data-app="media"><b id="wt-m">⏸ Night Drive</b>
      <span>Neon Coast · tap tile to play/pause</span></button>
    <button class="wtile w-clim" data-app="climate"><b id="wt-c">21.5°</b><span>auto · fan 3</span></button>
    ${rest.map((a) => `<button class="wtile sm" data-app="${a.id}"><span class="ti">${icon(a.id)}</span><em>${a.name}</em></button>`).join('')}
  </div>`;
  // live widgets act without opening the app (stopPropagation).
  const wm = gridArea.querySelector('.w-media');
  let playing = true;
  wm.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    playing = !playing;
    gridArea.querySelector('#wt-m').textContent = `${playing ? '⏸' : '▶'} Night Drive`;
    e.stopPropagation();
  }, true);
}

function renderDrawer() {
  const sorted = [...APPS].sort((a, b) => a.name.localeCompare(b.name));
  gridArea.innerHTML = `<div class="search"><input id="dq" placeholder="Search apps…"></div>
    <div class="drawerlist" id="dlist"></div>`;
  const list = gridArea.querySelector('#dlist');
  const paint = (q) => {
    list.innerHTML = sorted.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
      .map((a) => `<button class="drow" data-app="${a.id}"><span class="ti sm2">${icon(a.id)}</span>
      <span class="dn"><b>${a.name}</b><i>${a.blurb}</i></span><span class="go">›</span></button>`).join('') ||
      `<p class="dim">No apps match “${q}”.</p>`;
    bindTiles(list);
  };
  gridArea.querySelector('#dq').addEventListener('input', (e) => paint(e.target.value));
  paint('');
}

function renderCards() {
  gridArea.innerHTML = `<div class="cardrail" id="crail">${APPS.map((a) =>
    `<div class="acard"><span class="ti big">${icon(a.id)}</span><b>${a.name}</b>
     <i>${a.blurb}</i><button class="btn sm" data-app="${a.id}">Open</button></div>`).join('')}</div>
    <div class="pagenav"><button id="cprev">‹</button><button id="cnext">›</button></div>`;
  const rail = gridArea.querySelector('#crail');
  gridArea.querySelector('#cprev').onclick = () => rail.scrollBy({ left: -300, behavior: 'smooth' });
  gridArea.querySelector('#cnext').onclick = () => rail.scrollBy({ left: 300, behavior: 'smooth' });
}

function renderGrid() {
  closeApp(true);
  ({ pages: renderPages, folders: renderFolders, tiles: renderTiles, drawer: renderDrawer, cards: renderCards })[grid]();
  bindTiles(gridArea);
  $('#gridname').textContent = GRIDS.find((g) => g.id === grid).name;
}

function bindTiles(scope) {
  scope.querySelectorAll('[data-app]').forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', (e) => { e.stopPropagation(); openApp(b.dataset.app); });
  });
}

// ── app window ─────────────────────────────────────────────────────
function openApp(id) {
  appCleanup?.(); appCleanup = null;
  appwin.innerHTML = `<div class="aw">${renderAppScreen(id)}</div>`;
  appwin.classList.add('open');
  appCleanup = wireAppScreen(appwin, id, api) || null;
}
function closeApp(instant) {
  if (!appwin.classList.contains('open')) return;
  appCleanup?.(); appCleanup = null;
  if (instant) { appwin.classList.add('noanim'); }
  appwin.classList.remove('open');
  if (instant) requestAnimationFrame(() => appwin.classList.remove('noanim'));
}
const api = {
  close: () => closeApp(false),
  toast,
  setWallpaper(n) {
    wall = n;
    $('#screen').classList.remove('w0', 'w1', 'w2');
    $('#screen').classList.add(`w${n}`);
    toast(`Wallpaper · ${['Aurora', 'Ember', 'Mono'][n]}`);
  },
  setScreenBright(v) { $('#screen').style.setProperty('--bright', v); },
};
$('#homebar').addEventListener('click', () => closeApp(false));

// status clock.
const clock = $('#clock');
const tickClock = () => { clock.textContent = new Date().toTimeString().slice(0, 5); };
tickClock(); setInterval(tickClock, 5000);

renderGrid();
scene.setView('iso');
