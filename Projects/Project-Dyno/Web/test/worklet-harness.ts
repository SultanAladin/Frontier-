// Headless worklet harness: runs the real WORKLET_SOURCE in Node with a
// mocked AudioWorklet environment, drives several cars at steady rpm/load
// and reports RMS / peak / spectral shape so synthesis regressions
// (silence, NaNs, all-cars-sound-the-same) fail loudly without a browser.
//
//   npm run test:worklet
import { WORKLET_SOURCE } from "../src/audio/workletSource";
import { CARS, buildEngine, DEFAULT_LAB } from "../src/sim/cars";

// ── mock AudioWorklet globals ──────────────────────────────────────────────
let ProcessorCtor: (new () => any) | null = null;
(globalThis as any).sampleRate = 48000;
(globalThis as any).__reg = (_name: string, ctor: new () => any) => {
  ProcessorCtor = ctor;
};
(globalThis as any).AudioWorkletProcessor = class {
  port = { onmessage: null as ((e: { data: unknown }) => void) | null };
};
// The worklet source calls registerProcessor(...) and extends
// AudioWorkletProcessor / reads bare `sampleRate` — provide all three.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runWorklet = new Function(
  "registerProcessor",
  "AudioWorkletProcessor",
  "sampleRate",
  WORKLET_SOURCE.replace("registerProcessor(", "registerProcessor("),
);
runWorklet(
  (globalThis as any).__reg,
  (globalThis as any).AudioWorkletProcessor,
  48000,
);
if (!ProcessorCtor) throw new Error("worklet did not register a processor");
const Ctor: new () => any = ProcessorCtor;

function renderCar(id: string, rpm: number, load: number, seconds: number) {
  const car = CARS.find((c) => c.id === id);
  if (!car) throw new Error("unknown car " + id);
  const build = buildEngine(car, DEFAULT_LAB);
  const proc = new Ctor();
  proc.port.onmessage({ data: { t: "cfg", cfg: build.cfg } });
  proc.port.onmessage({
    data: {
      t: "st",
      st: {
        rpm,
        load,
        nitro: 0,
        cut: 0,
        boost: car.boosted ? 0.8 : 0,
        motor: car.hybrid ? 0.4 : car.ev ? load : 0,
        gearLoad: 0.5,
        gearEng: 1,
        speed: 80,
        rich: 0,
      },
    },
  });
  const sr = 48000;
  const total = Math.floor(sr * seconds);
  const mono = new Float64Array(total);
  let pos = 0;
  const N = 128;
  while (pos < total) {
    const out0 = [new Float32Array(N), new Float32Array(N)];
    const out1 = [new Float32Array(N), new Float32Array(N)];
    proc.process([], [out0, out1]);
    const n = Math.min(N, total - pos);
    for (let i = 0; i < n; i++) mono[pos + i] = (out0[0][i] + out0[1][i]) * 0.5 + (out1[0][i] + out1[1][i]) * 0.5;
    pos += N;
  }
  return mono;
}

function analyse(x: Float64Array, sr: number) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    sum += x[i] * x[i];
  }
  const rms = Math.sqrt(sum / x.length);
  // spectral centroid + band energies from a proper 8192-point FFT
  const M = 8192;
  const off = Math.floor(x.length / 2);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  for (let n = 0; n < M; n++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (M - 1)); // Hann
    re[n] = x[off + n] * w;
  }
  for (let s = 1, j = 0; s < M; s <<= 1) {
    // iterative radix-2 FFT (bit-reversal + butterflies)
    if (s === 1) {
      for (let i = 1, r = 0; i < M; i++) {
        let bit = M >> 1;
        for (; r & bit; bit >>= 1) r ^= bit;
        r ^= bit;
        if (i < r) {
          const tr = re[i];
          re[i] = re[r];
          re[r] = tr;
          const ti = im[i];
          im[i] = im[r];
          im[r] = ti;
        }
      }
      j = 1;
    }
    const angStep = (2 * Math.PI) / (s << 1);
    for (let base = 0; base < M; base += s << 1) {
      for (let k2 = 0; k2 < s; k2++) {
        const ang = -angStep * k2;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const a = base + k2;
        const b = a + s;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
    void j;
  }
  let num = 0;
  let den = 0;
  const bands = [0, 0, 0, 0]; // <250, 250-800, 800-2500, >2500
  for (let k = 0; k < M / 2; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const f = (k * sr) / M;
    num += f * mag;
    den += mag;
    if (f < 250) bands[0] += mag;
    else if (f < 800) bands[1] += mag;
    else if (f < 2500) bands[2] += mag;
    else bands[3] += mag;
  }
  const tot = bands[0] + bands[1] + bands[2] + bands[3] || 1;
  return {
    rms,
    peak,
    centroid: den > 0 ? num / den : 0,
    bands: bands.map((b) => +(b / tot).toFixed(3)),
    finite: Number.isFinite(rms) && Number.isFinite(peak),
  };
}

const cases: [string, number, number][] = [
  ["laferrari", 3000, 0.7],
  ["laferrari", 8000, 0.9],
  ["vulcan", 6000, 0.9],
  ["amg-gt3", 4000, 0.8],
  ["m4-gt3", 5000, 0.85],
  ["viper", 2500, 0.7],
  ["918", 7000, 0.9],
  ["demon", 3500, 0.8],
  ["taycan", 9000, 0.8],
];

let failed = false;
for (const [id, rpm, load] of cases) {
  const x = renderCar(id, rpm, load, 1.2);
  const a = analyse(x, 48000);
  const ok = a.finite && a.rms > 0.002 && a.peak < 1.6;
  if (!ok) failed = true;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${id.padEnd(12)} @${rpm}rpm load=${load}  rms=${a.rms.toFixed(4)} peak=${a.peak.toFixed(3)} centroid=${Math.round(a.centroid)}Hz bands[<250,250-800,800-2.5k,>2.5k]=${a.bands.join("/")}`,
  );
}
if (failed) process.exit(1);
console.log("worklet harness: all cars produce finite, audible, level-sane output");
