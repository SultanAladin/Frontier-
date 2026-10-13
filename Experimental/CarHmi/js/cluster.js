// Instrument cluster — dual gauge (tach left, speed right), gear + digital
// speed centre, shift lights, telltales, odo/trip. Canvas 2D, redrawn at
// 30 Hz while driving (the report's cluster policy) with a needle-sweep
// self-test on load. Driven by the same snapshot shape as the tablet.

import { Snapshot } from './snapshot.js';

const cv = document.querySelector('#clusterCv');
const ctx = cv.getContext('2d');
let W = 0, H = 0;
const fit = () => {
  W = cv.width = Math.round(innerWidth * devicePixelRatio);
  H = cv.height = Math.round(innerHeight * devicePixelRatio);
};
fit(); addEventListener('resize', fit);

const ACC = '#14b8f2', AMB = '#ff991f', INK = '#dbe6f2', MUT = '#8b98a5', RED = '#ff5a5a';
const snap = new Snapshot();
let needleRpm = 0, needleSpd = 0, sweepT = 0;
const SWEEP = 1.4; // [s] needle self-test

function gauge(cx, cy, r, a0, a1, min, max, major, val, unit, redFrom, label) {
  // track
  ctx.lineWidth = 10 * devicePixelRatio; ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b232c';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  if (redFrom !== undefined) {
    const ar = a0 + (a1 - a0) * ((redFrom - min) / (max - min));
    ctx.strokeStyle = RED; ctx.beginPath(); ctx.arc(cx, cy, r, ar, a1); ctx.stroke();
  }
  // value arc
  const av = a0 + (a1 - a0) * Math.min(1, Math.max(0, (val - min) / (max - min)));
  ctx.strokeStyle = redFrom !== undefined && val >= redFrom ? RED : ACC;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, av); ctx.stroke();
  // ticks + numerals
  ctx.fillStyle = MUT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${13 * devicePixelRatio}px ui-monospace,monospace`;
  for (let v = min; v <= max + 1e-6; v += major) {
    const a = a0 + (a1 - a0) * ((v - min) / (max - min));
    const x1 = cx + Math.cos(a) * (r - 20 * devicePixelRatio), y1 = cy + Math.sin(a) * (r - 20 * devicePixelRatio);
    const x2 = cx + Math.cos(a) * (r - 32 * devicePixelRatio), y2 = cy + Math.sin(a) * (r - 32 * devicePixelRatio);
    ctx.strokeStyle = v >= (redFrom ?? Infinity) ? RED : MUT;
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const lx = cx + Math.cos(a) * (r - 50 * devicePixelRatio), ly = cy + Math.sin(a) * (r - 50 * devicePixelRatio);
    ctx.fillText(unit === 'rpm' ? String(Math.round(v / 1000)) : String(Math.round(v)), lx, ly);
  }
  // needle
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * devicePixelRatio;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(av) * 14, cy - Math.sin(av) * 14);
  ctx.lineTo(cx + Math.cos(av) * (r - 24 * devicePixelRatio), cy + Math.sin(av) * (r - 24 * devicePixelRatio));
  ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 7 * devicePixelRatio, 0, 7); ctx.fill();
  ctx.fillStyle = MUT; ctx.font = `${12 * devicePixelRatio}px system-ui,sans-serif`;
  ctx.fillText(label, cx, cy + r * 0.52);
}

function paint(s) {
  ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.54, r = Math.min(W, H) * 0.30;
  const lx = cx - Math.min(W * 0.28, r * 1.7), rx = cx + Math.min(W * 0.28, r * 1.7);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  gauge(lx, cy, r, a0, a1, 0, 8000, 1000, needleRpm, 'rpm', 7200, 'RPM ×1000');
  gauge(rx, cy, r, a0, a1, 0, 320, 40, needleSpd, 'kmh', undefined, 'KM/H');
  // centre: digital speed + gear
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = INK; ctx.font = `700 ${Math.round(r * 0.52)}px system-ui,sans-serif`;
  ctx.fillText(String(Math.round(s.speedKmh)), cx, cy - r * 0.28);
  ctx.fillStyle = MUT; ctx.font = `${13 * devicePixelRatio}px system-ui,sans-serif`;
  ctx.fillText('KM/H', cx, cy - r * 0.28 + r * 0.30);
  const gear = s.gear === 0 ? 'N' : String(s.gear);
  ctx.fillStyle = AMB; ctx.font = `700 ${Math.round(r * 0.42)}px system-ui,sans-serif`;
  ctx.fillText(gear, cx, cy + r * 0.30);
  // shift lights — progressive from 6000, flash at 7000+.
  const lit = s.rpm > 6000 ? Math.min(5, 1 + Math.floor((s.rpm - 6000) / 240)) : 0;
  for (let i = 0; i < 5; i++) {
    const x = cx + (i - 2) * r * 0.16, y = H * 0.12;
    const on = i < lit && (s.rpm < 7000 || Math.floor(performance.now() / 90) % 2 === 0);
    ctx.fillStyle = on ? (i > 2 ? RED : AMB) : '#1b232c';
    ctx.beginPath(); ctx.arc(x, y, r * 0.05, 0, 7); ctx.fill();
  }
  // telltales.
  const tells = [
    ['SPORT', AMB, true], ['ABS', MUT, true], ['🔋', MUT, true],
    ['🛞', s.brake > 0 ? RED : '#1b232c', true],
    ['⛽', '#1b232c', true],
  ];
  ctx.font = `${12 * devicePixelRatio}px system-ui,sans-serif`;
  tells.forEach(([t, c], i) => {
    ctx.fillStyle = c; ctx.fillText(t, cx + (i - 2) * r * 0.34, H * 0.88);
  });
  ctx.fillStyle = MUT;
  ctx.fillText(`ODO ${s.odoKm.toFixed(1)} km · TRIP ${s.tripKm.toFixed(1)} km`, cx, H * 0.93);
  ctx.fillStyle = '#4a5560';
  ctx.fillText('cluster · 30 Hz · snapshot-fed', cx, H * 0.965);
}

// main loop: snapshot ticks at display rate, canvas redraws at 30 Hz.
let last = performance.now(), acc = 0, lastDraw = 0;
const frame = (now) => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const s = snap.tick(dt);
  sweepT += dt;
  let targetRpm = s.rpm, targetSpd = s.speedKmh;
  if (sweepT < SWEEP) { // self-test sweep: 0 → max → live.
    const k = sweepT / SWEEP;
    const sweep = k < 0.5 ? k * 2 : (1 - k) * 2;
    targetRpm = sweep * 8000; targetSpd = sweep * 320;
  }
  const ease = Math.min(1, dt * 9); // needle ballistics ≈ stepper motor.
  needleRpm += (targetRpm - needleRpm) * ease;
  needleSpd += (targetSpd - needleSpd) * ease;
  if (now - lastDraw >= 1000 / 30) { lastDraw = now; paint(s); }
};
requestAnimationFrame(frame);
