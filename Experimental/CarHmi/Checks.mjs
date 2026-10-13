// CarHmi pins — the CheckHud habit, DOM edition. Run: node --test Checks.mjs
// Only DOM-free modules are imported (theme, snapshot, touch, BINDINGS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Theme, luminance } from './js/theme.js';
import { Snapshot } from './js/snapshot.js';
import { classifySwipe, TAP_MS, TAP_PX, SWIPE_PX } from './js/touch.js';
import { BINDINGS, TuneState } from './js/pages-vehicle.js';

test('theme: text brighter than card, accent visible on bg', () => {
  assert.ok(luminance(Theme.marking) > luminance(Theme.card) * 3, 'marking vs card');
  assert.ok(luminance(Theme.accent) > luminance(Theme.bg) * 2, 'accent vs bg');
  assert.ok(luminance(Theme.muted) > luminance(Theme.bgSoft), 'muted vs bgSoft');
  assert.ok(Theme.rail === 84 && Theme.status === 44, 'layout constants pinned');
});

test('bindings: every tunable in range, default inside, source cited', () => {
  assert.ok(BINDINGS.length >= 20, `need 20+ bindings, have ${BINDINGS.length}`);
  for (const b of BINDINGS) {
    assert.ok(b.min < b.max, `${b.label}: min<max`);
    assert.ok(b.step > 0, `${b.label}: step>0`);
    assert.ok(b.src && b.src.length > 5, `${b.label}: cites its C++ owner`);
    const v = b.path.reduce((o, k) => o[k], TuneState);
    assert.ok(typeof v === 'number' && v >= b.min && v <= b.max, `${b.label}: default ${v} in [${b.min},${b.max}]`);
  }
});

test('bindings: report-critical defaults match the vehicle headers', () => {
  const get = (p) => p.split('.').reduce((o, k) => o[k], TuneState);
  assert.equal(get('suspension.freqF'), 2.0);
  assert.equal(get('suspension.dampF'), 0.6);
  assert.equal(get('aero.wing'), 14);
  assert.equal(get('power.upshift'), 6800);
  assert.equal(get('power.slipTarget'), 0.12);
  assert.equal(get('steering.wheelRange'), 900);
});

test('gestures: swipe classification thresholds', () => {
  assert.equal(TAP_MS, 300); assert.equal(TAP_PX, 12); assert.equal(SWIPE_PX, 48);
  assert.equal(classifySwipe(120, 10, 200), 'right');
  assert.equal(classifySwipe(-120, 5, 200), 'left');
  assert.equal(classifySwipe(5, 120, 200), 'down');
  assert.equal(classifySwipe(10, -200, 200), 'up');
  assert.equal(classifySwipe(20, 5, 200), null, 'below distance threshold');
  assert.equal(classifySwipe(200, 10, 900), null, 'above time threshold');
  assert.equal(classifySwipe(100, 100, 200), null, 'diagonal is not a swipe');
});

test('snapshot: 24 s loop stays finite and in envelope', () => {
  const s = new Snapshot();
  for (let t = 0; t < 24; t += 1 / 30) {
    const r = s.tick(1 / 30);
    for (const k of ['speedKmh', 'rpm', 'throttle', 'brake', 'boostBar', 'wingAngleDeg']) {
      assert.ok(Number.isFinite(r[k]), `${k} finite at t=${t.toFixed(2)}`);
    }
    assert.ok(r.speedKmh >= 0 && r.speedKmh <= 260, `speed envelope at t=${t.toFixed(2)}`);
    assert.ok(r.rpm >= 600 && r.rpm <= 8000, `rpm envelope at t=${t.toFixed(2)}`);
    assert.ok(r.gear >= 0 && r.gear <= 7, 'gear envelope');
    assert.ok(r.tyreTempC.every((x) => x > 20 && x < 140), 'tyre temps sane');
  }
});
