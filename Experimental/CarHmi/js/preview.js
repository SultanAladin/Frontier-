// Car preview viewport — the tablet's own 3D world: own camera, own studio
// lights, own backdrop. A low-poly PROTO-X wedge (wheelbase 3.396 m, track
// 2.095 m from VehicleGeometry.h, scaled) with per-face studio shading,
// projected by a turntable camera. Drag orbits, pinch zooms, idle auto-turns.
// C++ landing spot: the HMI 3D viewport (existing raster, new view setup).

import { attachGestures } from './touch.js';

// Car-local metres: +X forward, +Y left, +Z up. Faces: verts + base colour.
const BODY = '#2b3644', GLASS = '#0e141b', TRIM = '#14b8f2';
function quad(a, b, c, d, col) { return { v: [a, b, c, d], col }; }
const MESH = [
  // lower body — wedge: nose low (+X), tail high (−X)
  quad([2.99, -0.95, 0.12], [2.99, 0.95, 0.12], [2.2, 1.02, 0.42], [2.2, -1.02, 0.42], '#3a4656'), // nose ramp
  quad([2.2, -1.02, 0.42], [2.2, 1.02, 0.42], [-2.99, 1.0, 0.62], [-2.99, -1.0, 0.62], BODY),       // deck
  quad([2.99, -0.95, 0.12], [2.2, -1.02, 0.42], [-2.99, -1.0, 0.62], [-2.99, -0.98, 0.12], '#232c38'), // left flank
  quad([2.99, 0.95, 0.12], [-2.99, 0.98, 0.12], [-2.99, 1.0, 0.62], [2.2, 1.02, 0.42], '#232c38'),  // right flank
  quad([-2.99, -1.0, 0.62], [-2.99, 1.0, 0.62], [-2.99, 1.0, 0.12], [-2.99, -1.0, 0.12], '#1b222c'), // tail
  quad([2.99, -0.95, 0.12], [-2.99, -0.98, 0.12], [-2.99, 0.98, 0.12], [2.99, 0.95, 0.12], '#10151c'), // floor
  // cabin — glasshouse trapezoid
  quad([0.9, -0.78, 0.5], [0.9, 0.78, 0.5], [-0.2, 0.72, 1.12], [-0.2, -0.72, 1.12], GLASS),        // windshield
  quad([-0.2, -0.72, 1.12], [-0.2, 0.72, 1.12], [-1.5, 0.66, 1.08], [-1.5, -0.66, 1.08], '#161d26'), // roof
  quad([-1.5, -0.66, 1.08], [-1.5, 0.66, 1.08], [-2.2, 0.8, 0.6], [-2.2, -0.8, 0.6], GLASS),         // backlight
  quad([0.9, -0.78, 0.5], [-0.2, -0.72, 1.12], [-1.5, -0.66, 1.08], [-2.2, -0.8, 0.6], GLASS),       // glass L
  quad([0.9, 0.78, 0.5], [-2.2, 0.8, 0.6], [-1.5, 0.66, 1.08], [-0.2, 0.72, 1.12], GLASS),           // glass R
  // wing — blade + swan neck
  quad([-2.99, -1.0, 0.62], [-2.99, 1.0, 0.62], [-3.25, 1.0, 0.98], [-3.25, -1.0, 0.98], '#161d26'),
  quad([-3.25, -1.0, 0.98], [-3.25, 1.0, 0.98], [-3.45, 1.0, 0.94], [-3.45, -1.0, 0.94], TRIM),
];
// Wheel centres (axle sockets): front +1.7274, rear −1.6686, ±1.0475, r 0.51.
const WHEELS = [[1.7274, -1.0475], [1.7274, 1.0475], [-1.6686, -1.0475], [-1.6686, 1.0475]];

function normal(f) {
  const [a, b, c] = f.v;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}
function shade(hex, k) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const s = v.map((c) => Math.round(Math.min(255, Math.max(0, c * k))));
  return `rgb(${s[0]},${s[1]},${s[2]})`;
}

export function mountPreview(canvas, badge) {
  const ctx = canvas.getContext('2d');
  let yaw = 0.7, pitch = -0.32, dist = 8.2, idle = 0, dead = false, paused = false;
  let W = 0, H = 0, frames = 0, lastFpsT = performance.now(), fps = 0;

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.round(r.width * devicePixelRatio);
    H = canvas.height = Math.round(r.height * devicePixelRatio);
  };
  fit(); addEventListener('resize', fit);

  attachGestures(canvas, {
    onDrag: ({ dx, dy }) => { yaw += dx * 0.005; pitch = Math.min(-0.08, Math.max(-0.9, pitch + dy * 0.004)); idle = 0; },
    onPinch: ({ total }) => { dist = Math.min(13, Math.max(5, 8.2 / total)); idle = 0; },
    onDown: () => { idle = 0; },
  });

  // Studio rig: key upper-front-left, cool fill right, rim from behind.
  const KEY = [0.5, 0.55, 0.65], FILL = [-0.4, -0.7, 0.25], RIM = [-0.75, 0.1, 0.35];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const project = (p) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy, z1 = p[2];
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
    const depth = dist + x1;
    const s = (H * 1.35) / Math.max(0.5, depth);
    return [W / 2 + y2 * s, H * 0.56 - z2 * s, depth, s];
  };

  const paint = () => {
    // backdrop: studio sweep — dark top, soft pool under the car.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04060a'); g.addColorStop(0.62, '#0a1018'); g.addColorStop(1, '#05080d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const pool = ctx.createRadialGradient(W / 2, H * 0.72, 10, W / 2, H * 0.72, W * 0.42);
    pool.addColorStop(0, 'rgba(20,184,242,0.10)'); pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H * 0.9);

    // faces, painter-sorted far → near.
    const faces = MESH.map((f) => {
      const pts = f.v.map(project);
      const depth = pts.reduce((a, p) => a + p[2], 0) / pts.length;
      return { f, pts, depth };
    }).sort((a, b) => b.depth - a.depth);
    for (const { f, pts } of faces) {
      const n = normal(f);
      const k = 0.32 + 0.85 * Math.max(0, dot(n, KEY)) + 0.25 * Math.max(0, dot(n, FILL)) + 0.45 * Math.max(0, dot(n, RIM));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fillStyle = shade(f.col, k); ctx.fill();
    }
    // wheels — dark tyre + rim + cyan cap, scaled by depth.
    for (const [wx, wy] of WHEELS) {
      const [sx, sy, depth, s] = project([wx, wy, 0.42]);
      const r = 0.51 * s;
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.94, r, 0, 0, 7); ctx.fillStyle = '#0a0d11'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.55, r * 0.55, 0, 0, 7); ctx.fillStyle = '#39434f'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.16, r * 0.16, 0, 0, 7); ctx.fillStyle = TRIM; ctx.fill();
    }
    // light bar accents — headlight strip + tail strip.
    const nose = project([2.99, 0, 0.3]), tail = project([-2.99, 0, 0.5]);
    ctx.fillStyle = 'rgba(20,184,242,0.9)';
    ctx.fillRect(nose[0] - nose[3] * 0.9, nose[1], nose[3] * 1.8, Math.max(2, nose[3] * 0.06));
    ctx.fillStyle = 'rgba(255,90,90,0.9)';
    ctx.fillRect(tail[0] - tail[3] * 0.9, tail[1], tail[3] * 1.8, Math.max(2, tail[3] * 0.06));
  };

  let last = performance.now(), acc = 0;
  const STEP = 1 / 18; // preview viewport rate: ~18 Hz, per the report.
  const frame = (now) => {
    if (dead) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    frames++;
    if (now - lastFpsT > 500) { fps = Math.round(frames * 1000 / (now - lastFpsT)); frames = 0; lastFpsT = now; }
    if (paused) return;
    acc += dt; idle += dt;
    if (idle > 3) yaw += dt * 0.12;      // auto-turntable after 3 s idle
    if (acc < STEP) return;
    acc = 0; paint();
    if (badge) badge.textContent = `preview · own camera · 18 Hz · ${fps} fps page`;
  };
  requestAnimationFrame(frame);

  return {
    destroy() { dead = true; removeEventListener('resize', fit); },
    setPaused(p) { paused = p; },
  };
}
