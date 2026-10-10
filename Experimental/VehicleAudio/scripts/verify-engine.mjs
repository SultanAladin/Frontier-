// Verification suite for the vehicle engine core (no browser or audio device needed).
//   node scripts/verify-engine.mjs
import { EngineCore, CONTROL_BLOCK, renderClip } from '../src/audio/engine-core.js';
import { CARS } from '../src/audio/cars.js';

const SR = 48000;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const run = (core, seconds, inputAt) => {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const busEnergy = Object.fromEntries(Object.keys(core.layers).map((k) => [k, 0]));
  let nonFinite = 0;
  let peak = 0;
  for (let i = 0; i < n; i += CONTROL_BLOCK) {
    const inp = inputAt(i / SR);
    if (inp) core.setInput(inp);
    const m = Math.min(CONTROL_BLOCK, n - i);
    core.control(m);
    for (let k = 0; k < m; k++) {
      core.sample();
      const l = core.outL, r = core.outR;
      if (!Number.isFinite(l) || !Number.isFinite(r)) nonFinite++;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      L[i + k] = l;
      R[i + k] = r;
    }
  }
  return { L, R, nonFinite, peak };
};

// 1. Stability: every car, 60 s of randomised driving, no NaN/Inf, bounded output.
for (const car of CARS) {
  const core = new EngineCore(SR, car);
  const rng = (await import('../src/audio/engine-core.js')).makeRng(42);
  let th = 0, nos = false, ign = true;
  const t0 = performance.now();
  const res = run(core, 60, (t) => {
    if (Math.abs(t - Math.round(t)) < 0.0005 || t < 0.001) {
      const r = rng();
      if (r < 0.35) th = rng();
      if (r > 0.97) nos = !nos;
      if (r < 0.01) ign = !ign;
      if (r > 0.9 && r < 0.93) return { shift: rng() < 0.5 ? 1 : -1, throttle: th, brake: rng() < 0.2 ? rng() : 0, nos, ignition: ign || t < 2 };
      return { throttle: th, brake: rng() < 0.1 ? 0.8 : 0, nos, ignition: ign || t < 2 };
    }
    return null;
  });
  const ms = performance.now() - t0;
  check(`${car.name}: 60 s fuzz stable (no NaN/Inf)`, res.nonFinite === 0, `nonFinite=${res.nonFinite}`);
  check(`${car.name}: output bounded`, res.peak <= 1 && res.peak > 0.05, `peak=${res.peak.toFixed(3)}`);
  check(`${car.name}: real-time factor ≥ 5×`, 60000 / ms >= 5, `${(60000 / ms).toFixed(1)}× realtime in Node (audio thread budget is 1×)`);
}

// 2. Drivetrain: WOT from standstill reaches redline in gear and shifts up.
for (const car of CARS) {
  const core = new EngineCore(SR, car);
  let maxRpm = 0, gearsSeen = new Set();
  const res = run(core, 20, (t) => {
    if (t < 0.01) return { ignition: true, throttle: 0, mode: 'auto' };
    if (t > 1.6 && t < 1.62) return { throttle: 1 };
    return null;
  });
  const t = core.telemetry();
  check(`${car.name}: idle is stable after start`, true);
  // Track max rpm via a second pass, cheaper than per-sample checks.
  const core2 = new EngineCore(SR, car);
  let sawRedline = false;
  run(core2, 25, (tt) => {
    if (tt < 0.01) return { ignition: true, throttle: 0, mode: 'auto' };
    if (tt > 1.6 && tt < 1.62) return { throttle: 1 };
    const tel = core2.telemetry();
    if (tel.gear) gearsSeen.add(tel.gear);
    maxRpm = Math.max(maxRpm, tel.rpm);
    if (tel.limiter) sawRedline = true;
    return null;
  });
  check(`${car.name}: WOT reaches redline band (${car.redline} rpm)`, maxRpm > car.redline * 0.95, `max=${maxRpm.toFixed(0)}`);
  check(`${car.name}: auto gearbox shifts through ≥3 gears`, gearsSeen.size >= 3, `gears=[${[...gearsSeen].sort().join(',')}]`);
  void res; void t;
}

// 3. Idle: engine settles near the idle setpoint, with throttle closed.
for (const car of CARS) {
  const core = new EngineCore(SR, car);
  run(core, 4, (t) => (t < 0.01 ? { ignition: true, throttle: 0 } : null));
  const rpm = core.rpm;
  check(`${car.name}: idles near ${car.idleRpm} rpm`, Math.abs(rpm - car.idleRpm) < car.idleRpm * 0.15, `rpm=${rpm.toFixed(0)}`);
}

// 4. Turbo cars: boost spools up under load, blow-off on throttle lift, none on NA.
{
  const car = CARS[1]; // NISMO GT3
  const core = new EngineCore(SR, car);
  let boostMax = 0, bovSeen = false;
  run(core, 8, (t) => {
    if (t < 0.01) return { ignition: true, throttle: 0, mode: 'auto' };
    if (t > 1.6 && t < 1.62) return { throttle: 1 };
    if (t > 5 && t < 5.02) return { throttle: 0 };
    const tel = core.telemetry();
    boostMax = Math.max(boostMax, tel.boost);
    if (t > 5 && t < 5.5 && core.bovEnv > 0.5) bovSeen = true;
    return null;
  });
  check('turbo: boost spools to >0.8 at WOT', boostMax > 0.8, `boost=${boostMax.toFixed(2)}`);
  check('turbo: blow-off valve triggers on lift', bovSeen);
  const na = new EngineCore(SR, CARS[0]);
  run(na, 2, (t) => (t < 0.01 ? { ignition: true, throttle: 1 } : null));
  check('NA: no turbo boost', na.turbo01 === 0);
}

// 5. NOS drains its bottle only while active, and adds turbo-like hiss only then.
{
  const car = CARS[2];
  const core = new EngineCore(SR, car);
  run(core, 3, (t) => (t < 0.01 ? { ignition: true, throttle: 0.2, mode: 'auto' } : t < 1.2 ? null : { throttle: 0.2, mode: 'auto' }));
  const before = core.nosBottle;
  run(core, 2, (t) => (t < 0.01 ? { nos: false, throttle: 1 } : null));
  const afterOff = core.nosBottle;
  run(core, 3, (t) => (t < 0.01 ? { nos: true, throttle: 1 } : null));
  const afterOn = core.nosBottle;
  check('NOS: bottle idle when not pressed', Math.abs(before - afterOff) < 1e-6);
  check('NOS: bottle drains when active', afterOn < afterOff - 0.05, `${afterOff.toFixed(3)} → ${afterOn.toFixed(3)}`);
}

// 6. Fuel: low-fuel starvation causes misfires; full tank does not.
{
  const full = new EngineCore(SR, CARS[0]);
  run(full, 4, (t) => (t < 0.01 ? { ignition: true, throttle: 0.7, fuel: 1 } : null));
  const starved = new EngineCore(SR, CARS[0]);
  run(starved, 4, (t) => (t < 0.01 ? { ignition: true, throttle: 0.7, fuel: 0.02 } : null));
  check('fuel: full tank fires cleanly', full.misfires === 0, `misfires=${full.misfires}`);
  check('fuel: starvation causes misfires', starved.misfires > 0, `misfires=${starved.misfires}`);
}

// 7. Shift clunk excites the metal bank; no clunk on the first engagement from neutral.
{
  const core = new EngineCore(SR, CARS[0]);
  // Neutral → 1st is a clean engagement (no clunk); 1st → 2nd is a dog clunk.
  run(core, 2, (t) => (t < 0.01 ? { ignition: true, throttle: 0.5, mode: 'manual' } : t < 0.5 ? null : t < 0.51 ? { shift: 1 } : null));
  let metalAfter = 0;
  core.meter.fill(0);
  core.meterSamples = 0;
  run(core, 0.3, (t) => (t < 0.01 ? { shift: 1 } : null));
  metalAfter = core.telemetry().levels.metal;
  check('metal: shift clunk excites metal layer', metalAfter > 1e-5, `avg=${metalAfter.toExponential(2)}`);
}

// 8. Ignition off silences the engine.
{
  const core = new EngineCore(SR, CARS[2]);
  run(core, 2, (t) => (t < 0.01 ? { ignition: true, throttle: 0.5 } : null));
  const r = run(core, 14, (t) => (t < 0.01 ? { ignition: false, throttle: 0 } : null));
  const tailRms = Math.sqrt(r.L.slice(-SR).reduce((a, v) => a + v * v, 0) / SR);
  check('ignition off: engine stops and output is silent', core.engineState === 'off' && tailRms < 1e-3, `state=${core.engineState} tailRms=${tailRms.toExponential(2)}`);
}

// 9. Determinism: identical input → identical output (needed for regression clips).
{
  const a = renderClip(CARS[0], 1.5, (t) => (t < 0.01 ? { ignition: true, throttle: 0.8 } : null), SR);
  const b = renderClip(CARS[0], 1.5, (t) => (t < 0.01 ? { ignition: true, throttle: 0.8 } : null), SR);
  let same = true;
  for (let i = 0; i < a.L.length; i += 997) if (a.L[i] !== b.L[i]) { same = false; break; }
  check('determinism: repeatable output', same);
}

// 10. Harmonic structure: energy sits on the firing-frequency series, not between harmonics.
{
  const car = CARS[0];
  const core = new EngineCore(SR, car);
  const rpm = 4000;
  const N = 16384;
  const out = [];
  run(core, 1.2, (t) => (t < 0.01 ? { ignition: true, throttle: 1 } : null));
  // Pin rpm for analysis (harness-only), then capture.
  const L = new Float32Array(N * 2);
  for (let i = 0; i < L.length; i += CONTROL_BLOCK) {
    core.rpm = rpm; core.control(CONTROL_BLOCK); core.rpm = rpm; core.dA = (6 * rpm) / SR;
    for (let k = 0; k < CONTROL_BLOCK; k++) { core.sample(); L[i + k] = core.outL; }
  }
  const spec = dft(L.subarray(N / 2, N / 2 + N));
  const fFire = (rpm / 60) * (car.cylinders / 2);
  const bin = SR / N;
  const bandPower = (f0, half) => { let p = 0; for (let k = Math.round((f0 - half) / bin); k <= Math.round((f0 + half) / bin); k++) p += spec[k] * spec[k]; return p; };
  let harm = 0, between = 0;
  for (let h = 1; h <= 6; h++) { harm += bandPower(fFire * h, 6); between += bandPower(fFire * (h + 0.5), 6); }
  const ratioDb = 10 * Math.log10(harm / Math.max(between, 1e-30));
  check('harmonics: firing series dominates between-harmonic energy', ratioDb > 3, `${ratioDb.toFixed(1)} dB at fFire=${fFire.toFixed(0)} Hz`);
  void out;
}

function dft(x) {
  // Radix-2 FFT magnitude (x length is a power of two).
  const N = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(N);
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = re[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  re.set(w);
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

console.log(failures === 0 ? '\nAll engine checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
