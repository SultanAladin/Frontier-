// CarHmi pins — the CheckHud habit, DOM edition. Run: node --test Checks.mjs
// Only DOM-free modules are imported (icons, grids, apps strings, VIEWS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, icon, appName } from './js/icons.js';
import { GRIDS, FOLDERS, DOCK, PAGE_SIZE } from './js/grids.js';
import { renderAppScreen } from './js/apps.js';
import { VIEWS } from './js/scene.js';

test('icons: 12+ apps, each a valid multicolour SVG', () => {
  assert.ok(APPS.length >= 12, `need 12+ apps, have ${APPS.length}`);
  const ids = new Set();
  for (const a of APPS) {
    assert.ok(a.id && !ids.has(a.id), `unique id ${a.id}`); ids.add(a.id);
    assert.ok(a.name && a.blurb, `${a.id}: name + blurb`);
    assert.ok(a.svg.startsWith('<svg') && a.svg.includes('</svg>'), `${a.id}: svg wrapper`);
    const colours = new Set([...a.svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase()));
    assert.ok(colours.size >= 3, `${a.id}: multicolour, found ${colours.size}`);
    assert.equal(icon(a.id), a.svg);
    assert.equal(appName(a.id), a.name);
  }
  assert.equal(icon('nope'), '');
});

test('grids: exactly 5 designs, unique ids', () => {
  assert.equal(GRIDS.length, 5);
  assert.equal(new Set(GRIDS.map((g) => g.id)).size, 5);
  for (const g of GRIDS) assert.ok(g.name && g.desc, `${g.id}: name + desc`);
});

test('collections: folders cover every app once, dock is a subset', () => {
  const all = FOLDERS.flatMap((f) => f.apps).sort();
  const ids = APPS.map((a) => a.id).sort();
  assert.deepEqual(all, ids);
  assert.equal(DOCK.length, 4);
  for (const d of DOCK) assert.ok(ids.includes(d), `dock ${d} is a real app`);
  assert.ok(PAGE_SIZE === 10, 'pages grid is 5x2 landscape');
});

test('views: 2D front is flat, 3D presets are angled, all in clamp range', () => {
  for (const k of ['front', 'iso', 'side', 'top']) assert.ok(VIEWS[k], `view ${k} exists`);
  assert.deepEqual({ rx: VIEWS.front.rx, ry: VIEWS.front.ry, s: VIEWS.front.s }, { rx: 0, ry: 0, s: 1 });
  for (const k of ['iso', 'side', 'top']) {
    assert.ok(Math.abs(VIEWS[k].rx) + Math.abs(VIEWS[k].ry) > 10, `${k} is visibly 3D`);
  }
  for (const v of Object.values(VIEWS)) {
    assert.ok(v.rx >= -70 && v.rx <= 30 && v.ry >= -70 && v.ry <= 70, 'in orbit clamp range');
    assert.ok(v.s >= 0.55 && v.s <= 1.25, 'in zoom range');
  }
});

test('apps: every icon opens a non-empty screen', () => {
  for (const a of APPS) {
    const html = renderAppScreen(a.id);
    assert.ok(html.length > 100, `${a.id}: renders a screen`);
    assert.ok(html.includes('data-close'), `${a.id}: has a back button`);
  }
});
