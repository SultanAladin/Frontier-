// Boot particles — stardust field + light-streak sweep. Parameters echo the
// ParticleEditor presets (Light streaks: running head, exponential wake,
// per-strand phase; dust motes: slow drift + twinkle), reduced to a 2D canvas
// layer at boot scale. The layer is destroyed after settle — zero cost while
// driving. C++ landing spot: HmiBootSequence particle layer.

export class BootFX {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.dead = false; this.t = 0; this.last = 0;
    const r = canvas.getBoundingClientRect();
    this.W = canvas.width = Math.round(r.width * devicePixelRatio);
    this.H = canvas.height = Math.round(r.height * devicePixelRatio);
    // stardust — 240 motes: pos, drift, twinkle phase/pace, size.
    this.dust = Array.from({ length: 240 }, (_, i) => ({
      x: hash(i * 3 + 1), y: hash(i * 3 + 2), s: 0.6 + hash(i * 3 + 3) * 1.8,
      ph: hash(i + 500) * 6.28, pc: 0.6 + hash(i + 900) * 1.8,
      dx: (hash(i + 100) - 0.5) * 0.014, dy: (hash(i + 200) - 0.5) * 0.010,
    }));
    // streaks — 7 strands across the face, staggered phase.
    this.streaks = Array.from({ length: 7 }, (_, i) => ({
      y: 0.16 + (i / 6) * 0.68, ph: i * 0.35, hue: i % 3 === 2 ? '255,153,31' : '20,184,242',
      amp: 0.02 + hash(i + 50) * 0.03, fr: 1.5 + hash(i + 60) * 2.5,
    }));
  }

  start() {
    this.last = performance.now();
    const frame = (now) => {
      if (this.dead) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now; this.t += dt;
      this.paint();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  stop() { this.dead = true; }

  paint() {
    const { ctx, W, H, t } = this;
    ctx.clearRect(0, 0, W, H);
    // phase envelopes: dust 0→1.4 s in, holds, out at 3.2 s; streaks 0.8→2.6 s.
    const dustA = env(t, 0, 0.5, 3.0, 3.6);
    const lineA = env(t, 0.8, 1.4, 2.4, 3.0);
    if (dustA > 0) {
      for (const d of this.dust) {
        const x = (d.x + d.dx * t + 1) % 1, y = (d.y + d.dy * t + 1) % 1;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * d.pc * 3 + d.ph));
        ctx.globalAlpha = dustA * tw * 0.9;
        ctx.fillStyle = '#cfe8ff';
        ctx.beginPath(); ctx.arc(x * W, y * H, d.s * devicePixelRatio, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (lineA > 0) {
      ctx.lineCap = 'round';
      for (const s of this.streaks) {
        // running head sweeps left→right over ~1 s, staggered; wake decays behind.
        const head = ((t - 0.8 - s.ph * 0.5) / 1.1) * 1.3 - 0.15;
        if (head < -0.2 || head > 1.4) continue;
        const yAt = (x) => (s.y + Math.sin(x * 6.28 * s.fr + s.ph) * s.amp) * H;
        for (let k = 0; k < 26; k++) {
          const x1 = head - k * 0.012, x2 = head - (k + 1) * 0.012;
          if (x2 < -0.05) break;
          const a = lineA * Math.exp(-k * 0.22);
          ctx.strokeStyle = `rgba(${s.hue},${a.toFixed(3)})`;
          ctx.lineWidth = (1 + 3 * Math.exp(-k * 0.3)) * devicePixelRatio;
          ctx.beginPath(); ctx.moveTo(x1 * W, yAt(x1)); ctx.lineTo(x2 * W, yAt(x2)); ctx.stroke();
        }
        // spark at the head.
        ctx.fillStyle = `rgba(255,255,255,${(lineA * 0.9).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(head * W, yAt(head), 3 * devicePixelRatio, 0, 7); ctx.fill();
      }
    }
  }
}

// envelope: fade in [a,b], hold, fade out [c,d].
function env(t, a, b, c, d) {
  if (t < a || t > d) return 0;
  if (t < b) return (t - a) / (b - a);
  if (t > c) return 1 - (t - c) / (d - c);
  return 1;
}
// deterministic 0..1 hash (no Math.random — the boot looks the same twice).
function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >> 15; x = (x * 2246822519) >>> 0; x ^= x >> 13;
  return (x >>> 0) / 4294967296;
}
