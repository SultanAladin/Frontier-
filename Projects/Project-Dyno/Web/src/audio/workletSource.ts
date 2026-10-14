// AudioWorklet source (kept as a string so it can be loaded from a Blob URL and
// works in a single-file build) — Frontier v3 HYBRID.
//
// Three engine models share the same output layers (turbo whistle, gearbox,
// hybrid motor, supercharger, one-shots):
//
//  1. "additive" - harmonic-series model for the cross-plane V8s (AMG GT3,
//     Vantage, Demon). Kept because its uneven-fire harmonics are exactly
//     why those cars sound unique — and now fed by the v3 layers.
//
//  2. "pulse" - header-wave model for every other engine, fused with the
//     raw layers from EngineAudioSim `main` (see voices.ts): asymmetric
//     rarefaction pulse, pulse-gated order layer with a CAPPED order peak,
//     inter-bank AM rasp, per-firing stochastic crackle, heat-drifting
//     formants, dynamic pulse rounding and a loudness normaliser that only
//     *partially* normalises (patch-1's full normaliser was a big part of
//     its "digital, linear" flatness).
//
//  3. "ev" - the main branch's electric synthesis (Taycan).
//
// The pulse model:
//     - each cylinder fires at its real firing-order slot, tagged with its bank
//     - its pulse travels down its OWN runner: the flight time (seconds) becomes
//       crank degrees via the live rpm, so unequal headers make pulses arrive
//       unevenly, and more so at high rpm
//     - every pulse launches a reflected suction wave 2 x runner time later
//       (the tuned-header "on-cam" tone that changes with rpm)
//     - per-cylinder pulse width, tail steepness and attack hardness; louder
//       pulses get steeper fronts (nonlinear wave steepening)
//     - cylinders merge in collector / twin-scroll groups, each with its own
//       comb and a saturating reflection; turbo cars pass through a turbine
//       that soaks up sharp edges as boost rises
//     - intake runners get their own per-cylinder delay before the plenum
//     - tonal valvetrain tick rung by each pulse onset (not noise)

export const WORKLET_SOURCE = `
const TWO_PI = 6.283185307179586;
const KMAX = 160;
const NV = 28;
const MAXC = 24;
const MAXF = 8;
const MAXPOP = 14;
const MAXG = 4;
const DLN = 2048;
const DLM = DLN - 1;

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function smooth(x, a, b) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function arr() { return new Float64Array(KMAX + 2); }
function fin(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
function sat(x) { return x / (1 + Math.abs(x)); }

// constant-peak-gain resonator (RBJ band-pass)
class BP {
  constructor() { this.b0 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(f, q, sr) {
    var w = TWO_PI * Math.min(f, sr * 0.45) / sr;
    var al = Math.sin(w) / (2 * q);
    var a0 = 1 + al;
    this.b0 = al / a0;
    this.a1 = -2 * Math.cos(w) / a0;
    this.a2 = (1 - al) / a0;
  }
  p(x) {
    var y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// state-variable low-pass (stable under modulation)
class LPF {
  constructor() { this.a1 = 0; this.a2 = 0; this.a3 = 0; this.ic1 = 0; this.ic2 = 0; this.set(1000, 0.7, 48000); }
  set(f, q, sr) {
    var fr = Math.min(Math.max(f, 20), sr * 0.45);
    var g = Math.tan(Math.PI * fr / sr);
    var k = 1 / q;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  p(x) {
    var v3 = x - this.ic2;
    var v1 = this.a1 * this.ic1 + this.a2 * v3;
    var v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.cfg = null;
    this.mode = 0;
    this.sig = '';
    this.n = 0;
    this.frac = new Float64Array(MAXC);
    this.bank = new Uint8Array(MAXC);
    this.cylGain = new Float64Array(MAXC);

    // additive model state
    this.aL = arr(); this.bL = arr(); this.aR = arr(); this.bR = arr();
    this.shape = arr();
    this.theta = 0;
    this.jit = 1;

    // pulse model: per-cylinder tables
    this.cyc = 0;
    this.J = 0; this.K = 0;
    this.baseEx = new Float64Array(MAXC);
    this.baseIn = new Float64Array(MAXC);
    this.runD = new Float64Array(MAXC);
    this.inD = new Float64Array(MAXC);
    this.durM = new Float64Array(MAXC);
    this.decM = new Float64Array(MAXC);
    this.atkM = new Float64Array(MAXC);
    this.route = new Uint8Array(MAXC);
    this.ampS = new Float64Array(MAXC);
    this.ampC = new Float64Array(MAXC);
    this.jitC = new Float64Array(MAXC);
    this.ampI = new Float64Array(MAXC);
    this.lastD = new Float64Array(MAXC);
    this.lastI = new Float64Array(MAXC);
    this.shEx = new Float64Array(MAXC);
    this.shIn = new Float64Array(MAXC);

    // resonators / filters
    this.bpA = []; this.bpB = []; this.bpIL = []; this.bpIR = [];
    this.fG = new Float64Array(MAXF);
    this.tg = new Float64Array(MAXF);
    this.gI = new Float64Array(MAXF);
    this.lpA = new LPF(); this.lpB = new LPF();
    this.rbpA = new BP(); this.rbpB = new BP();
    this.blockA = new BP(); this.blockB = new BP();
    this.injA = new BP(); this.injB = new BP();
    this.chainA = new BP(); this.chainB = new BP();
    this.slapA = new BP(); this.slapB = new BP();
    this.camA = new BP(); this.camB = new BP();
    this.cabLA = new BP(); this.cabRA = new BP();
    this.cab2LA = new BP(); this.cab2RA = new BP();

    // collector / scroll groups
    this.nG = 1;
    this.grpBank = new Uint8Array(MAXG);
    this.bgrp = [0, 0];
    this.eG = new Float64Array(MAXG);
    this.dcG = new Float64Array(MAXG);
    this.gLag = new Float64Array(MAXG);
    this.tLp = new Float64Array(MAXG);
    this.gD = new Int32Array(MAXG);
    this.gBuf = [];
    for (var gi = 0; gi < MAXG; gi++) this.gBuf.push(new Float64Array(DLN));

    // bank pipes, scavenge echo, tailpipe reflection (shared write cursor)
    this.pipeA = new Float64Array(DLN); this.pipeB = new Float64Array(DLN);
    this.sBuf = new Float64Array(DLN); this.tBuf = new Float64Array(DLN);
    this.pLA = 0; this.pLB = 0; this.sLag = 0; this.tLag = 0;
    this.DA = 4; this.DB = 4; this.DS = 4; this.DT = 4;
    this.wp = 0;

    // misc state
    this.lowA = 0; this.lowB = 0;
    this.dcA = 0; this.dcB = 0; this.dcI = 0;
    this.prevEA = 0; this.prevEB = 0;
    this.pw = 0.5;
    this.warm = 0.5;
    this.initLast = true;
    this.pCyc = 0.1; this.pJit = 1; this.pCut = 0; this.popP = 0.1;
    this.tq = 0; this.tqDC = 0; this.tau = 1;
    this.ancP = 0;
    // v3 hybrid state: exhaust heat, per-event crackle, order layer, charger, EV
    this.heat = 0.3;
    this.fHz = new Float64Array(MAXF); this.fQ = new Float64Array(MAXF);
    this.durC = new Float64Array(MAXC); this.decC = new Float64Array(MAXC);
    this.crA = 0; this.crB = 0; this.crDecA = 40; this.crDecB = 40;
    this.crBpA = new BP(); this.crBpB = new BP();
    this.ordGate = 0;
    this.chP = 0;
    this.ev1 = 0; this.ev2 = 0; this.ev3 = 0;
    // turbo spool / overrun + cabin / Doppler state
    this.spool = 0; this.spoolLoad = 0;
    this.over = 0; this.overP = 0; this.overC = 0;
    this.listen = 'cockpit';
    this.dopF = 1; this.dopX = -150;
    this.seed = 2463534242;
    this.pops = [];

    // shared
    this.rpm = 900;
    this.rpmT = 900;
    this.time = 0;
    this.st = { rpm: 900, load: 0, nitro: 0, cut: 0, boost: 0, motor: 0, gearLoad: 0, gearEng: 0, speed: 0, rich: 0 };
    this.s = { load: 0, nitro: 0, boost: 0, motor: 0, gearLoad: 0, gearEng: 0, speed: 0, rich: 0 };
    this.mix = { engine: 1, turbo: 1, gear: 1, motor: 1, fx: 1, exhaust: 0.5, rough: 1, intake: 1, mech: 1, crackle: 1, tors: 1, cam: 1, spool: 1, space: 1 };
    this.vol = 0;
    this.cutG = 1;
    this.tp1 = 0; this.tp2 = 0;
    this.gp1 = 0; this.gp2 = 0;
    this.mp = 0;
    this.turboF = 1000;
    this.voices = [];
    for (var i = 0; i < NV; i++) {
      this.voices.push({ on: false, ph: 0, f1: 0, df: 0, ep: 1, amp: 0, ea: 1, amR: 0, amP: 0, amD: 0 });
    }
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  rnd() {
    var x = this.seed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
  gauss() { return (this.rnd() + this.rnd() + this.rnd() - 1.5) * 2; }

  onMsg(d) {
    if (d.t === 'cfg') {
      var c = d.cfg;
      this.cfg = c;
      this.mode = (c.mode === 'pulse' && c.v) ? 1 : 0;
      this.n = Math.min(MAXC, c.frac.length);
      for (var i = 0; i < this.n; i++) {
        this.frac[i] = c.frac[i];
        this.bank[i] = c.bank[i];
        this.cylGain[i] = c.cylGain[i];
      }
      // only rebuild when the engine itself changes, never for a slider drag
      var sig = JSON.stringify([c.mode, c.frac, c.bank, c.strokes, c.redline, c.alpha, c.fcHigh, c.bankDelay,
        c.route, c.nG, c.runD, c.inD, c.durM, c.decM, c.atkM, c.v ? c.v : 0]);
      if (sig !== this.sig) {
        this.sig = sig;
        this.vol = 0;
        this.setupSpace(c);
        if (this.mode === 1) this.setupPulse(c);
      }
    } else if (d.t === 'listen') {
      this.listen = d.mode === 'exterior' ? 'exterior' : 'cockpit';
    } else if (d.t === 'st') {
      var o = d.st;
      for (var k in o) { if (k in this.st) this.st[k] = fin(o[k], this.st[k]); }
    } else if (d.t === 'mix') {
      var m = d.mix;
      for (var q in m) { if (q in this.mix) this.mix[q] = fin(m[q], this.mix[q]); }
    } else if (d.t === 'ev') {
      this.spawn(d.name, d.a);
    }
  }

  // cabin / body resonances (shared by both engine models)
  setupSpace(c) {
    var v = c.v || {}, sr = this.sr;
    var h1 = fin(v.cabHz, 86), q1 = fin(v.cabQ, 2.2);
    var h2 = fin(v.cab2Hz, 320);
    this.cabLA.set(h1, q1, sr);
    this.cabRA.set(h1 * 1.015, q1, sr);
    this.cab2LA.set(h2, 2.6, sr);
    this.cab2RA.set(h2 * 1.02, 2.6, sr);
    this.camA.set(fin(v.camHz, 2600), fin(v.camQ, 5), sr);
    this.camB.set(fin(v.camHz, 2600) * 1.03, fin(v.camQ, 5), sr);
  }

  // layer 3a: cabin resonance - strong in the cockpit, faint outside
  processSpace(L, R, N) {
    var c = this.cfg;
    if (!c || !c.v) return;
    var v = c.v;
    var amt = (this.listen === 'cockpit' ? 1 : 0.15) * clamp(fin(this.mix.space, 1), 0, 2);
    var g1 = fin(v.cabG, 0) * amt;
    var g2 = fin(v.cab2G, 0) * amt;
    if (g1 < 0.001 && g2 < 0.001) return;
    var a = this.cabLA, b = this.cabRA, a2 = this.cab2LA, b2 = this.cab2RA;
    for (var i = 0; i < N; i++) {
      var x = L[i], y = R[i];
      L[i] = x + g1 * a.p(x) + g2 * a2.p(x);
      R[i] = y + g1 * b.p(y) + g2 * b2.p(y);
    }
  }

  // ───────────────────────── pulse model setup ─────────────────────────
  setupPulse(c) {
    var v = c.v, sr = this.sr, n = this.n;
    var cycDeg = c.strokes === 2 ? 360 : 720;
    var off = c.strokes === 2 ? 0.42 : 0.5;
    var i, j, g;

    var ng = clamp((c.nG | 0) || 1, 1, MAXG);
    this.nG = ng;

    for (i = 0; i < n; i++) {
      var ts = v.timS[i] / cycDeg;
      this.ampS[i] = v.ampS[i];
      var pe = this.frac[i] + ts; pe -= Math.floor(pe);
      var pn = this.frac[i] + off + ts * 0.5; pn -= Math.floor(pn);
      this.baseEx[i] = pe;
      this.baseIn[i] = pn;
      this.runD[i] = clamp(fin(c.runD ? c.runD[i] : 0, 0), 0, 0.004);
      this.inD[i] = clamp(fin(c.inD ? c.inD[i] : 0, 0), 0, 0.004);
      this.durM[i] = clamp(fin(c.durM ? c.durM[i] : 1, 1), 0.5, 1.7);
      this.decM[i] = clamp(fin(c.decM ? c.decM[i] : 1, 1), 0.5, 1.7);
      this.atkM[i] = clamp(fin(c.atkM ? c.atkM[i] : 1, 1), 0.4, 2.2);
      var r = c.route ? (c.route[i] | 0) : this.bank[i];
      this.route[i] = clamp(r, 0, ng - 1);
      this.ampC[i] = 1; this.jitC[i] = 0; this.ampI[i] = 1;
      this.lastD[i] = 0; this.lastI[i] = 0;
      this.shEx[i] = 0; this.shIn[i] = 0;
    }

    // collector / scroll groups
    var f0 = -1, f1 = -1;
    for (g = 0; g < MAXG; g++) {
      var gb = (c.grpBank && g < ng) ? (c.grpBank[g] | 0) : 0;
      this.grpBank[g] = gb ? 1 : 0;
      if (g < ng) {
        if (gb === 0 && f0 < 0) f0 = g;
        if (gb !== 0 && f1 < 0) f1 = g;
      }
      this.gBuf[g].fill(0);
      this.gLag[g] = 0; this.dcG[g] = 0; this.tLp[g] = 0; this.eG[g] = 0;
      this.gD[g] = clamp(Math.round(fin(v.collMs, 1.2) * 0.001 * sr * (1 + 0.13 * g)), 2, DLN - 4);
    }
    if (f0 < 0) f0 = 0;
    if (f1 < 0) f1 = f0;
    this.bgrp[0] = f0; this.bgrp[1] = f1;

    // header resonances (two banks, slightly detuned)
    var J = Math.min(MAXF, v.formants.length);
    this.J = J;
    this.bpA = []; this.bpB = [];
    for (j = 0; j < J; j++) {
      var fa = new BP(); fa.set(v.formants[j][0] * (1 - 0.5 * v.detune), v.formants[j][2], sr);
      var fb = new BP(); fb.set(v.formants[j][0] * (1 + 0.5 * v.detune), v.formants[j][2], sr);
      this.bpA.push(fa); this.bpB.push(fb);
      this.fG[j] = 0; this.tg[j] = 0;
      this.fHz[j] = v.formants[j][0]; this.fQ[j] = v.formants[j][2];
    }
    this.crBpA.set(fin(v.crackleHz, 4800), 1.1, sr);
    this.crBpB.set(fin(v.crackleHz, 4800) * 1.06, 1.1, sr);
    this.heat = 0.3; this.crA = 0; this.crB = 0; this.ordGate = 0;
    for (i = 0; i < n; i++) { this.durC[i] = this.durM[i]; this.decC[i] = this.decM[i]; }
    // plenum / airbox resonances
    var K = Math.min(MAXF, v.intake.length);
    this.K = K;
    this.bpIL = []; this.bpIR = [];
    for (j = 0; j < K; j++) {
      var il = new BP(); il.set(v.intake[j][0] * 0.97, v.intake[j][2], sr);
      var ir = new BP(); ir.set(v.intake[j][0] * 1.03, v.intake[j][2], sr);
      this.bpIL.push(il); this.bpIR.push(ir);
      this.gI[j] = v.intake[j][1] * v.intakeGain;
    }

    this.lpA = new LPF(); this.lpB = new LPF();
    this.lowA = 0; this.lowB = 0;
    this.dcA = 0; this.dcB = 0; this.dcI = 0;
    this.prevEA = 0; this.prevEB = 0;
    this.pw = 0.5;
    this.warm = 0.5;
    this.initLast = true;
    this.cyc = 0;
    this.pops.length = 0;

    // bank pipes, scavenge, tail
    this.pipeA.fill(0); this.pipeB.fill(0); this.sBuf.fill(0); this.tBuf.fill(0);
    this.pLA = 0; this.pLB = 0; this.sLag = 0; this.tLag = 0;
    this.wp = 0;
    var dA = Math.round(fin(v.pipeMs, 0) * 0.001 * sr);
    this.DA = clamp(dA, 2, DLN - 4);
    this.DB = clamp(Math.round(dA * (1 + 1.2 * v.detune + 0.015)), 2, DLN - 4);
    this.DS = clamp(Math.round(fin(v.scavMs, 0) * 0.001 * sr), 2, DLN - 4);
    this.DT = clamp(Math.round(fin(v.tailMs, 0) * 0.001 * sr), 2, DLN - 4);

    this.rbpA.set(v.raspHz, v.raspQ, sr);
    this.rbpB.set(v.raspHz * 1.07, v.raspQ, sr);
    this.blockA.set(v.blockHz, v.blockQ, sr);
    this.blockB.set(v.blockHz * 1.03, v.blockQ, sr);
    this.injA.set(v.injHz, 7, sr);
    this.injB.set(v.injHz * 1.04, 7, sr);
    this.chainA.set(v.chainHz, 2, sr);
    this.chainB.set(v.chainHz * 1.02, 2, sr);
    this.slapA.set(fin(v.slapHz, 620), 2.4, sr);
    this.slapB.set(fin(v.slapHz, 620) * 1.03, 2.4, sr);
    this.camA.set(fin(v.camHz, 2600), fin(v.camQ, 5), sr);
    this.camB.set(fin(v.camHz, 2600) * 1.03, fin(v.camQ, 5), sr);
    this.tq = 0; this.tqDC = 0; this.tau = 1;
  }

  newEx(i) {
    var amp = this.ampS[i] * (1 + this.pCyc * this.gauss());
    if (amp < 0.15) amp = 0.15; else if (amp > 2.2) amp = 2.2;
    if (this.pCut > 0 && this.rnd() < this.pCut) {
      amp = 0; // fuel / ignition cut: this firing is skipped
      if (this.pCut > 0.45 && this.rnd() < this.popP) {
        this.addPop(1.2 + 2.2 * this.rnd(), 2 + 3 * this.rnd(), this.bgrp[this.bank[i] ? 1 : 0]);
      }
    }
    this.ampC[i] = amp;
    // v3: ZERO-MEAN jitter. Patch-1 used Math.abs() here, so every pulse was
    // only ever late — a constant delay, not variation. Real combustion
    // wanders both ways around the firing slot.
    var jt = this.gauss() * this.pJit * 1.3;
    this.jitC[i] = jt < -8 ? -8 : (jt > 8 ? 8 : jt);
    // every single firing also gets its own pulse width and tail steepness
    var du = 1 + 0.11 * this.gauss(), dc = 1 + 0.13 * this.gauss();
    this.durC[i] = (du < 0.65 ? 0.65 : (du > 1.4 ? 1.4 : du)) * this.durM[i];
    this.decC[i] = (dc < 0.6 ? 0.6 : (dc > 1.5 ? 1.5 : dc)) * this.decM[i];
  }

  newIn(i) {
    var a = this.ampS[i] * (1 + 0.8 * this.pCyc * this.gauss());
    this.ampI[i] = clamp(a, 0.2, 2);
  }

  addPop(amp, wms, grp) {
    if (this.pops.length >= MAXPOP) this.pops.shift();
    this.pops.push({ age: 0, w: wms * 0.001, a: amp, g: clamp(grp | 0, 0, MAXG - 1) });
  }

  // ───────────────────────── one-shot events ─────────────────────────
  voice(f0, f1, tauP, tauA, amp, amR, amD) {
    var v = null;
    for (var i = 0; i < NV; i++) { if (!this.voices[i].on) { v = this.voices[i]; break; } }
    if (!v) v = this.voices[0];
    var sr = this.sr;
    v.f1 = f1; v.df = f0 - f1;
    v.ep = Math.exp(-1 / (sr * tauP));
    v.ea = Math.exp(-1 / (sr * tauA));
    v.amp = amp; v.ph = 0; v.amR = amR || 0; v.amD = amD || 0; v.amP = 0;
    v.on = true;
  }

  spawn(name, a) {
    a = (typeof a === 'number') ? a : 0.6;
    var fx = this.mix.fx;
    var popFx = fx * clamp(fin(this.mix.crackle, 1), 0, 2.5);
    if (name === 'pop') {
      if (this.mode === 1) {
        // a backfire is an extra pulse that rings the car's own exhaust
        if (popFx > 0.01) {
          var amp = (1.6 + 3.4 * a) * popFx;
          var w = 2.5 + 5 * this.rnd();
          this.addPop(amp, w, this.bgrp[this.rnd() < 0.5 ? 0 : 1]);
          if (a > 0.55) this.addPop(amp * 0.7, w * 1.4, this.bgrp[this.rnd() < 0.5 ? 0 : 1]);
        }
      } else {
        this.voice(180 + Math.random() * 90, 44, 0.02, 0.05, (0.16 + 0.34 * a) * popFx);
        this.voice(620 + Math.random() * 300, 130, 0.01, 0.018, (0.07 + 0.15 * a) * popFx);
        this.voice(1500, 360, 0.006, 0.01, 0.06 * a * popFx);
      }
    } else if (name === 'click') {
      this.voice(3100, 3100, 1, 0.003, 0.16 * fx);
      this.voice(420, 210, 0.03, 0.05, 0.28 * fx);
      this.voice(72, 38, 0.05, 0.14, 0.32 * fx);
    } else if (name === 'flutter') {
      var f0 = Math.max(700, this.turboF);
      var am = 11 + Math.random() * 4;
      this.voice(f0, f0 * 0.38, 0.45, 0.42, (0.05 + 0.12 * a) * fx, am, 1);
      this.voice(f0 * 1.012, f0 * 0.39, 0.45, 0.42, (0.04 + 0.09 * a) * fx, am * 1.03, 1);
    } else if (name === 'shift') {
      this.voice(150, 62, 0.03, 0.06, 0.18 * a * fx);
      this.voice(1900, 900, 0.01, 0.012, 0.05 * a * fx);
    }
  }

  // ───────────────────────── main entry ─────────────────────────
  process(inputs, outputs) {
    var out0 = outputs[0], out1 = outputs[1];
    if (!out0 || !out0[0] || !out1 || !out1[0]) return true;
    var L = out0[0], R = out0[1] || out0[0];
    var FL = out1[0], FR = out1[1] || out1[0];
    var N = L.length;
    var c = this.cfg;
    if (!c) return true;
    var invSr = 1 / this.sr;
    var st = this.st, s = this.s;

    var kb = 1 - Math.exp(-N * invSr / 0.03);
    s.load += (st.load - s.load) * kb;
    s.nitro += (st.nitro - s.nitro) * kb;
    s.boost += (st.boost - s.boost) * kb;
    s.motor += (st.motor - s.motor) * kb;
    s.gearLoad += (st.gearLoad - s.gearLoad) * kb;
    s.gearEng += (st.gearEng - s.gearEng) * kb;
    s.speed += (st.speed - s.speed) * kb;
    s.rich += (st.rich - s.rich) * kb;

    // layer 3b: Doppler. In the cockpit the listener moves with the car (no
    // shift). Outside, the car passes a virtual trackside listener: approach
    // sharpens the pitch, recession flattens it, by c / (c + radial speed).
    var dtB = N * invSr;
    var dopT = 1;
    if (this.listen === 'exterior') {
      var spd = clamp(st.speed, 0, 360) / 3.6; // m/s
      this.dopX += spd * dtB;
      if (this.dopX > 170) this.dopX -= 340;
      var dist = Math.sqrt(this.dopX * this.dopX + 196); // 14 m from the road
      var radial = spd * this.dopX / dist; // + = receding
      var amt = clamp((c.v ? fin(c.v.dopG, 1) : 1) * clamp(fin(this.mix.space, 1), 0, 2), 0, 1.6);
      dopT = clamp(343 / (343 + radial * amt), 0.85, 1.17);
    }
    this.dopF += (dopT - this.dopF) * (1 - Math.exp(-dtB / 0.09));
    this.rpmT = clamp(st.rpm * this.dopF, 250, 20000);

    if (this.mode === 1) this.processPulse(L, R, N);
    else if (this.mode === 2) this.processEV(L, R, N);
    else this.processAdd(L, R, N);
    this.processSpace(L, R, N);
    this.processLayers(FL, FR, N);
    this.time += N * invSr;
    return true;
  }

  // ───────────────────────── additive engine (cross-plane V8s) ─────────────────────────
  updateCoefs() {
    var c = this.cfg, s = this.s, mix = this.mix;
    var n = this.n, nres = c.res.length;
    var strokeDiv = c.strokes / 2;
    var rpmNow = this.rpm;
    var nu = Math.max(0.8, rpmNow / 60 / strokeDiv);
    var load = s.load, nit = s.nitro, rich = s.rich;
    var fcMul = (0.5 + mix.exhaust) * (1 - 0.08 * rich);
    var rr = clamp(rpmNow / c.redline, 0, 1.2);
    var fc = (c.fcLow + (c.fcHigh - c.fcLow) * Math.pow(load, 0.8)) * fcMul * (1 + 0.38 * nit) * (0.85 + 0.25 * rr);
    var alpha = c.alpha + 0.32 * (1 - load) - 0.18 * nit - 0.05 * rich;
    var kmax = Math.min(KMAX, Math.floor(8000 / nu));
    if (kmax < 6) kmax = 6;
    var shape = this.shape;
    var res = c.res;
    var ig = c.intake[1] * Math.pow(load, 1.4) * mix.intake;
    var ilog = Math.log(c.intake[0]);
    var iw = c.intake[2];
    var half = n * 0.5;
    var sMax = 0;
    var k, j, f, kk, S, r4, lp, g, d, lf;
    for (k = 1; k <= kmax; k++) {
      f = k * nu;
      kk = k < half ? half : k;
      S = Math.pow(n / kk, alpha);
      r4 = f / fc; r4 = r4 * r4; r4 = r4 * r4;
      lp = 1 / Math.sqrt(1 + r4);
      lf = Math.log(f);
      g = 1;
      for (j = 0; j < nres; j++) {
        d = (lf - Math.log(res[j][0])) / res[j][2];
        g += res[j][1] * (1 + (j === 1 ? 0.9 * nit : 0.25 * nit)) * Math.exp(-0.5 * d * d);
      }
      d = (lf - ilog) / iw;
      g += ig * Math.exp(-0.5 * d * d);
      shape[k] = S * lp * g;
      if (shape[k] > sMax) sMax = shape[k];
    }
    var kEff = kmax;
    while (kEff > 6 && shape[kEff] < sMax * 0.006) kEff--;

    var aL = this.aL, bL = this.bL, aR = this.aR, bR = this.bR;
    for (k = 0; k <= kEff + 1; k++) { aL[k] = 0; bL[k] = 0; aR[k] = 0; bR[k] = 0; }
    var lopeAmt = (c.lope * (1 + 0.8 * Math.max(rich, 0)) + 0.12 * nit) * (1 - smooth(rpmNow, c.idle + 300, c.idle + 3800) * 0.85) * mix.rough;
    var t = this.time;
    for (var i = 0; i < n; i++) {
      var b = this.bank[i];
      var gc = this.cylGain[i] * (b ? c.bankGain : 1);
      gc *= 1 + lopeAmt * Math.sin(TWO_PI * (0.31 + 0.137 * i) * t + 1.9 * i);
      var tau = (b ? c.bankDelay : 0) * 0.001;
      var psi = TWO_PI * (this.frac[i] + nu * tau);
      var cr = Math.cos(psi), sn = Math.sin(psi);
      var ck = cr, sk = sn;
      var wL = c.panL[b], wR = c.panR[b];
      for (k = 1; k <= kEff; k++) {
        var w = gc * shape[k];
        var aa = w * ck, bb = w * sk;
        aL[k] += wL * aa; bL[k] += wL * bb;
        aR[k] += wR * aa; bR[k] += wR * bb;
        var nc = ck * cr - sk * sn;
        sk = sk * cr + ck * sn;
        ck = nc;
      }
    }
    var pw = 0;
    for (k = 1; k <= kEff; k++) pw += aL[k] * aL[k] + bL[k] * bL[k] + aR[k] * aR[k] + bR[k] * bR[k];
    var rms = Math.sqrt(pw * 0.25);
    var norm = 0.3 / Math.max(rms, 1e-5);
    for (k = 1; k <= kEff; k++) { aL[k] *= norm; bL[k] *= norm; aR[k] *= norm; bR[k] *= norm; }
    return kEff;
  }

  processAdd(L, R, N) {
    var c = this.cfg, s = this.s, mix = this.mix, st = this.st;
    var sr = this.sr, invSr = 1 / sr;
    var t = this.time;
    this.jit = 1 + (1 - 0.6 * s.load) * (0.0011 * Math.sin(TWO_PI * 5.3 * t) + 0.0007 * Math.sin(TWO_PI * 11.9 * t + 1));
    var K = this.updateCoefs();
    var strokeDiv = c.strokes / 2;
    var rpmK = 1 - Math.exp(-1 / (sr * 0.01));
    var jit = this.jit;
    var rn = clamp(this.rpm / c.redline, 0, 1.15);
    var volT = (0.34 + 0.66 * Math.pow(rn, 0.75)) * (0.5 + 0.5 * s.load) * (1 + 0.3 * s.nitro) * (0.8 + 0.4 * mix.exhaust);
    volT *= mix.engine;
    var cutT = 1 - 0.9 * clamp(st.cut, 0, 1);
    var aL = this.aL, bL = this.bL, aR = this.aR, bR = this.bR;
    var theta = this.theta, rpm = this.rpm, vol = this.vol, cutG = this.cutG;
    // layer 1 for the additive (cross-plane) cars: valve events at the real
    // firing phases ring the same per-car valvetrain resonators
    var vv = c.v || {};
    var camG = fin(vv.camG, 0) * 1.1 * clamp(fin(mix.cam, 1), 0, 2) * clamp(fin(mix.mech, 1), 0, 2) * (0.35 + 0.65 * s.load) * (0.6 + 0.5 * rn);
    var camInM = fin(vv.camInG, 0.6);
    var vtA = this.camA, vtB = this.camB;
    var frac = this.frac, bankA = this.bank, cylG = this.cylGain;
    var offTh = (c.strokes === 2 ? 0.42 : 0.5) * TWO_PI;
    var prevTh = theta;
    for (var i = 0; i < N; i++) {
      rpm += (this.rpmT - rpm) * rpmK;
      var nuS = rpm / 60 / strokeDiv * jit;
      theta += TWO_PI * nuS * invSr;
      if (theta > TWO_PI) theta -= TWO_PI;
      var camHitA = 0, camHitB = 0;
      if (camG > 0.001) {
        for (var ci = 0; ci < this.n; ci++) {
          var ev = frac[ci] * TWO_PI;
          var hit = (prevTh < ev && theta >= ev) || (theta < prevTh && (ev >= prevTh || ev < theta));
          var ev2 = ev + offTh; if (ev2 >= TWO_PI) ev2 -= TWO_PI;
          var hit2 = (prevTh < ev2 && theta >= ev2) || (theta < prevTh && (ev2 >= prevTh || ev2 < theta));
          if (hit) { if (bankA[ci]) camHitB += cylG[ci]; else camHitA += cylG[ci]; }
          if (hit2) { if (bankA[ci]) camHitB += cylG[ci] * camInM; else camHitA += cylG[ci] * camInM; }
        }
      }
      prevTh = theta;
      var c1 = Math.cos(theta), s1 = Math.sin(theta);
      var twoC = 2 * c1;
      var cPrev = 1, cCur = c1, sPrev = 0, sCur = s1;
      var accL = 0, accR = 0;
      for (var k = 1; k <= K; k++) {
        accL += aL[k] * cCur + bL[k] * sCur;
        accR += aR[k] * cCur + bR[k] * sCur;
        var cN = twoC * cCur - cPrev;
        var sN = twoC * sCur - sPrev;
        cPrev = cCur; cCur = cN;
        sPrev = sCur; sCur = sN;
      }
      if (camG > 0.001) {
        var coA = vtA.p(camHitA), coB = vtB.p(camHitB);
        accL += camG * (coA * c.panL[0] + coB * c.panL[1]);
        accR += camG * (coA * c.panR[0] + coB * c.panR[1]);
      }
      cutG += (cutT - cutG) * (cutT < cutG ? 0.012 : 0.004);
      vol += (volT - vol) * 0.002;
      var g = vol * cutG;
      L[i] = accL * g;
      R[i] = accR * g;
    }
    this.theta = theta; this.rpm = rpm; this.vol = vol; this.cutG = cutG;
  }

  // ───────────────────────── header-wave pulse engine ─────────────────────────
  processPulse(L, R, N) {
    var c = this.cfg, v = c.v, s = this.s, mix = this.mix, st = this.st;
    var sr = this.sr, invSr = 1 / sr, n = this.n;
    var cycDeg = c.strokes === 2 ? 360 : 720;
    var strokeDiv = c.strokes / 2;
    var rpmK = 1 - Math.exp(-1 / (sr * 0.01));
    var load = s.load, nit = s.nitro, rich = s.rich;
    var boost = clamp(s.boost, 0, 1);
    var rpmB = this.rpm;
    var rr = clamp(rpmB / c.redline, 0, 1.2);
    var idleF = 1 - smooth(rpmB, c.idle + 200, c.idle + 3000);
    var J = this.J, K = this.K, G = this.nG;
    var i, j, g, k, m, q;

    // base pulse geometry (crank degrees)
    var W = (v.blowLow + (v.blowHigh - v.blowLow) * smooth(rr, 0.08, 0.95)) * (1 - 0.14 * nit) * (1 + 0.06 * rich);
    var dec = v.decay * (1 + 0.3 * nit) * (1 - 0.1 * rich);
    var WI = v.intakeW;
    // v3: pulse rounding is DYNAMIC. Patch-1's static round forced one
    // compromise shape; a real engine is sharp and separate at idle (bark)
    // and overlapped/smooth at redline (silk) because the *next* firing
    // arrives before the previous pulse has left the primaries.
    var rd = clamp(v.round + 0.5 * smooth(rr, 0.3, 0.92) - 0.12 * (1 - load) * (1 - rr), 0, 0.85);
    var rareG = clamp(fin(v.rare, 0.22), 0, 0.6);

    // v3: exhaust heat. Hot gas carries sound faster, so every pipe
    // resonance creeps up as the system soaks with load (and falls back on
    // a lift). Slow follower (seconds), retunes the formant bank per block.
    this.heat += (clamp(0.15 + 0.85 * load, 0, 1) - this.heat) * (1 - Math.exp(-(N * invSr) / 2.8));
    var heatMul = 1 + fin(v.formantHeat, 0.7) * 0.11 * this.heat;
    for (j = 0; j < J; j++) {
      this.bpA[j].set(this.fHz[j] * heatMul * (1 - 0.5 * v.detune), this.fQ[j], sr);
      this.bpB[j].set(this.fHz[j] * heatMul * (1 + 0.5 * v.detune), this.fQ[j], sr);
    }

    // v3: tonal order layer (main branch). Amplitudes per order of the
    // FIRING frequency; the loudest order migrates with rpm but is CAPPED
    // by voice.orderPeak — uncapped migration is what turned the old
    // LaFerrari into an F1 car. The layer is gated by the pulse train in
    // the sample loop, so it breathes with combustion instead of droning.
    var ords = (v.orders && v.orders.length) ? v.orders : [1, 0.7, 0.4];
    var nOrd = Math.min(8, ords.length);
    var peakO = 1 + rr * (Math.max(1.4, fin(v.orderPeak, 5)) - 1);
    var ordAmp = new Float64Array(9);
    for (k = 0; k < nOrd; k++) {
      var distO = Math.abs((k + 1) - peakO);
      ordAmp[k] = ords[k] * (1 + 1.15 * Math.max(0, 1 - distO / 2.6)) * (1 + 0.5 * load * (k / Math.max(1, nOrd)));
    }
    var ordG = fin(v.orderGain, 0.35) * clamp(fin(mix.order, 1), 0, 2) * (0.3 + 0.7 * load);
    // inter-bank AM rasp (main branch): needs rpm and load to tear
    var amG = fin(v.raspAM, 0) * Math.max(0, rr - 0.14) * load * 1.5 * clamp(rg, 0, 2);
    // per-firing stochastic crackle (main branch)
    var crG = fin(v.crackle, 0) * (0.3 + 0.7 * load) * (0.45 + 0.75 * rr) * clamp(fin(mix.crackle, 1), 0, 2.2);

    // combustion irregularity
    var rg = mix.rough;
    this.pCyc = v.cyc * rg * (1 + 3 * v.idleLope * idleF) + 0.07 * Math.max(rich, 0) * rg + 0.05 * nit;
    this.pJit = v.jit * rg * (1 + idleF);
    this.pCut = clamp(st.cut, 0, 1);
    var evRate = Math.max(10, n * rpmB / 60 / strokeDiv);
    this.popP = Math.min(0.25, 22 / evRate) * clamp((c.pop || 0.3) * 1.8, 0.1, 1);

    // per-block runner shifts: flight time (s) -> crank degrees at the live rpm
    var degPerSec = rpmB * 6;
    var runD = this.runD, inD = this.inD, shEx = this.shEx, shIn = this.shIn;
    for (i = 0; i < n; i++) {
      shEx[i] = Math.min(120, runD[i] * degPerSec);
      shIn[i] = Math.min(120, inD[i] * degPerSec);
    }

    // reflected suction wave (tuned-header tone)
    var reflG = fin(v.reflG, 0) * (0.6 + 0.4 * load);
    // collector / scroll merge
    var collFb = clamp(fin(v.collFb, 0) * (0.6 + 0.8 * mix.exhaust), 0, 0.8);
    var kdC = 1 - Math.exp(-TWO_PI * 2600 * invSr);
    // turbine: soaks up sharp edges, more so with boost
    var tb = clamp(fin(v.turbo, 0) * (0.35 + 0.65 * boost), 0, 0.9);
    var kT = 1 - Math.exp(-TWO_PI * Math.max(200, fin(v.turboHz, 1500)) * invSr);

    // muffler
    var fc = (v.fcLow + (v.fcHigh - v.fcLow) * Math.pow(load, 0.8)) * (0.5 + mix.exhaust) * (1 + 0.35 * nit) * (1 - 0.1 * rich) * (0.8 + 0.3 * rr) * (1 + 0.18 * fin(v.formantHeat, 0.7) * this.heat);
    this.lpA.set(fc, 0.75, sr);
    this.lpB.set(fc * 0.94, 0.75, sr);

    // header resonances / body / intake
    var lg = 0.45 + 0.55 * load;
    var exg = 0.7 + 0.6 * mix.exhaust;
    var tg = this.tg, fG = this.fG, gI = this.gI;
    for (j = 0; j < J; j++) tg[j] = v.formants[j][1] * lg * exg * (1 + (j === 1 ? 0.7 : 0.25) * nit);
    var bodyG = v.body * (0.6 + 0.4 * load) * (0.7 + 0.6 * mix.exhaust);
    var kBody = 1 - Math.exp(-TWO_PI * v.bodyHz * invSr);
    var dirG = v.direct;
    var kM = 1 - Math.exp(-invSr / 0.06);
    var kG = 1 - Math.exp(-invSr / 0.008);
    var gIn = (0.15 + 0.85 * Math.pow(load, 1.3)) * mix.intake * (1 + 0.3 * nit);
    var gEx = 0.6 + 0.4 * load;
    var pl0 = c.panL[0], pr0 = c.panR[0];
    var pl1 = c.panL[1] * v.bankGain, pr1 = c.panR[1] * v.bankGain;

    // bank pipe resonator (saturating reflection)
    var gP = clamp(v.pipeFb * (0.55 + 0.9 * mix.exhaust), -0.86, 0.86);
    var pipeOn = v.pipeMs > 0 && Math.abs(gP) > 0.01;
    var kdP = 1 - Math.exp(-TWO_PI * Math.min(v.pipeDamp * (0.6 + 0.8 * mix.exhaust), 0.4 * sr) * invSr);
    // scavenge echo + tailpipe reflection
    var scavG = v.scavG;
    var scavOn = scavG > 0.001 && v.scavMs > 0;
    var kdS = 1 - Math.exp(-TWO_PI * Math.min(v.scavHz, 0.4 * sr) * invSr);
    var tailG = v.tailFb;
    var tailOn = tailG > 0.001 && v.tailMs > 0;
    var kdT = 1 - Math.exp(-TWO_PI * Math.min(v.tailDamp, 0.4 * sr) * invSr);

    // combustion rasp (gated by the pulses)
    var rG = v.rasp * 5 * (0.35 + 0.65 * load) * (0.5 + 0.8 * rr) * clamp(rg, 0, 2.2);
    var raspOn = rG > 0.002;
    // tonal layers
    var mech = clamp(fin(mix.mech, 1), 0, 2);
    var blockG = v.blockG * mech * (0.5 + 0.5 * load) * (0.6 + 0.6 * rr);
    var injG = v.injG * 8 * mech * (0.4 + 0.6 * load) * (0.5 + 0.8 * rr);
    var chainG = v.chainG * mech * (0.5 + 0.5 * load) * (0.5 + 0.7 * rr);
    var slapG = fin(v.slapG, 0) * mech * (0.35 + 0.65 * load) * (0.5 + 0.7 * rr);
    // layer 1: valvetrain / cam signature (valve events, not pulse onsets)
    var camG = fin(v.camG, 0) * 3 * clamp(fin(mix.cam, 1), 0, 2) * mech * (0.35 + 0.65 * load) * (0.6 + 0.5 * rr);
    var camInM = fin(v.camInG, 0.6);
    var degStep = (rpmB / 60 / strokeDiv) * invSr * cycDeg;
    var overlapG = v.overlapG * (0.3 + 0.7 * load);
    var OW = v.overlapW;

    // loudness + normaliser
    var lvl = v.level > 0 ? v.level : 0.3;
    var rn = clamp(rpmB / c.redline, 0, 1.15);
    // v3: throttle must change LOUDNESS, not just brightness. Patch-1's
    // volume target ignored load entirely and its normaliser (below) then
    // flattened what was left — the core of its "linear" feel.
    var volT = (0.34 + 0.66 * Math.pow(rn, 0.75)) * (0.5 + 0.5 * load) * (1 + 0.3 * nit) * (0.8 + 0.4 * mix.exhaust) * mix.engine;
    var cutT = 1 - 0.4 * this.pCut;
    var kAtt = 1 - Math.exp(-invSr / (this.warm > 0 ? 0.02 : 0.12));
    var kRel = 1 - Math.exp(-invSr / (this.warm > 0 ? 0.02 : 0.5));
    this.warm -= N * invSr;

    // locals
    var baseEx = this.baseEx, baseIn = this.baseIn;
    var durM = this.durM, decM = this.decM, atkM = this.atkM, route = this.route;
    var lastD = this.lastD, lastI = this.lastI;
    var ampC = this.ampC, jitC = this.jitC, ampI = this.ampI;
    var bpA = this.bpA, bpB = this.bpB, bpIL = this.bpIL, bpIR = this.bpIR;
    var lpA = this.lpA, lpB = this.lpB;
    var rbpA = this.rbpA, rbpB = this.rbpB;
    var bA = this.blockA, bB = this.blockB, iA = this.injA, iB = this.injB, cA = this.chainA, cB = this.chainB;
    var vtA = this.camA, vtB = this.camB;
    var ampS = this.ampS, bank = this.bank;
    var pops = this.pops;
    var grpBank = this.grpBank, eG = this.eG, dcG = this.dcG, gLag = this.gLag, tLp = this.tLp, gD = this.gD, gBuf = this.gBuf;
    var pipeA = this.pipeA, pipeB = this.pipeB, sBuf = this.sBuf, tBuf = this.tBuf;
    var DA = this.DA, DB = this.DB, DS = this.DS, DT = this.DT;
    var pLA = this.pLA, pLB = this.pLB, sLag = this.sLag, tLag = this.tLag, wp = this.wp;
    var cyc = this.cyc, rpm = this.rpm, vol = this.vol, cutG = this.cutG, pw = this.pw;
    var dcA = this.dcA, dcB = this.dcB, dcI = this.dcI, lowA = this.lowA, lowB = this.lowB;
    var prevEA = this.prevEA, prevEB = this.prevEB;
    var vatk = v.atk;
    // crank torsional vibration: driven by the real firing pulses below
    var torsAmt = fin(v.tors, 0.04) * clamp(fin(mix.tors, 1), 0, 2.5) * (1 - 0.78 * rr) * (0.35 + 0.65 * load);
    var kTq = 1 - Math.exp(-invSr / 0.012), kTqDC = 1 - Math.exp(-invSr / 0.3);
    var tq = this.tq, tqDC = this.tqDC, tau = this.tau;
    var sA = this.slapA, sB = this.slapB;

    if (this.initLast) {
      for (i = 0; i < n; i++) {
        var d0 = cyc - baseEx[i]; d0 -= Math.floor(d0); lastD[i] = d0;
        var e0 = cyc - baseIn[i]; e0 -= Math.floor(e0); lastI[i] = e0;
      }
      this.initLast = false;
    }

    for (m = 0; m < N; m++) {
      rpm += (this.rpmT - rpm) * rpmK;
      // instantaneous crank speed surges on each firing and sags into the
      // next compression (tau is fed by the pulse train at the bottom)
      cyc += rpm / 60 / strokeDiv * tau * invSr;
      if (cyc >= 1) cyc -= 1;

      for (g = 0; g < G; g++) eG[g] = 0;
      var eI = 0;
      var camHitA = 0, camHitB = 0;

      for (i = 0; i < n; i++) {
        // firing event happens at the cylinder's base phase...
        var d = cyc - baseEx[i]; d -= Math.floor(d);
        if (d < lastD[i]) {
          this.newEx(i);
          // exhaust valve opens for THIS cylinder (even on a fuel cut)
          if (bank[i]) camHitB += ampS[i]; else camHitA += ampS[i];
        }
        lastD[i] = d;
        var a = ampC[i];
        var deg = d * cycDeg - shEx[i] - jitC[i];
        var wc = W * this.durC[i];
        // exhaust valve closes at the end of this cylinder's blow-down window
        if (deg >= 0 && deg < wc && deg + degStep >= wc) {
          if (bank[i]) camHitB += ampS[i] * 0.45; else camHitA += ampS[i] * 0.45;
        }
        if (a > 0) {
          // ...but the pulse reaches the collector after ITS runner flight time
          var ex = 0;
          if (deg >= 0 && deg < wc) {
            var u = deg / wc;
            var sh = Math.pow(1 - u, dec * this.decC[i]);
            // louder pulses steepen (nonlinear wave front); port radius sets hardness
            var aD = 6 * rpm * vatk * atkM[i] / (0.6 + 0.4 * a);
            if (aD > wc * 0.5) aD = wc * 0.5; else if (aD < 0.6) aD = 0.6;
            if (deg < aD) { q = deg / aD; sh *= q * q * (3 - 2 * q); }
            if (rd > 0) { var sn = Math.sin(Math.PI * u); sh = (1 - rd) * sh + rd * 0.6 * sn * sn; }
            // v3 rarefaction: the main branch's asymmetric pulse dives BELOW
            // zero after blow-down (the exhaust slug overshoots and sucks).
            // That negative dip is the hollow bark — and it is also why the
            // pulse spectrum has its characteristic notched, woody colour.
            if (rareG > 0.001 && u > 0.3) {
              var su2 = (u - 0.3) / 0.62;
              if (su2 < 1) { var ss2 = Math.sin(Math.PI * su2); sh -= rareG * ss2 * ss2 * (0.4 + 0.6 * (1 - u)); }
            }
            ex += a * sh;
          }
          // reflected suction wave: back up the runner and down again (2 x flight time)
          if (reflG > 0.001) {
            var dr = deg - 2 * shEx[i] - wc * 0.35;
            var wr2 = wc * 1.5;
            if (dr >= 0 && dr < wr2) { var ur = Math.sin(Math.PI * dr / wr2); ex -= reflG * a * ur * ur; }
          }
          // valve-overlap breath just before the blow-down
          if (OW > 0 && overlapG > 0.001) {
            var dw = deg; if (dw < 0) dw += cycDeg;
            if (dw > cycDeg - OW) { var uo = Math.sin(Math.PI * (dw - (cycDeg - OW)) / OW); ex += overlapG * a * uo * uo; }
          }
          eG[route[i]] += ex;
        }
        // intake: own runner delay before the shared plenum
        var d2 = cyc - baseIn[i]; d2 -= Math.floor(d2);
        if (d2 < lastI[i]) {
          this.newIn(i);
          // intake valve opens for THIS cylinder
          if (bank[i]) camHitB += ampS[i] * camInM; else camHitA += ampS[i] * camInM;
        }
        lastI[i] = d2;
        var dg2 = d2 * cycDeg - shIn[i];
        if (dg2 >= 0 && dg2 < WI) eI += ampI[i] * Math.sin(Math.PI * dg2 / WI);
        // intake valve closes at the end of the induction window
        if (dg2 >= 0 && dg2 < WI && dg2 + degStep >= WI) {
          if (bank[i]) camHitB += ampS[i] * camInM * 0.45; else camHitA += ampS[i] * camInM * 0.45;
        }
      }

      // backfires: extra pulses in a real collector group
      for (var pi = pops.length - 1; pi >= 0; pi--) {
        var pp = pops[pi];
        pp.age += invSr;
        if (pp.age >= pp.w) { pops.splice(pi, 1); continue; }
        var uu = pp.age / pp.w;
        var at = pp.age < 0.0004 ? pp.age / 0.0004 : 1;
        at = at * at * (3 - 2 * at);
        var pg = pp.g < G ? pp.g : 0;
        eG[pg] += pp.a * at * (1 - uu) * (1 - uu);
      }

      // collector / scroll groups: own DC, turbine, comb + saturating reflection
      var xa = 0, xb = 0, eA = 0, eB = 0;
      for (g = 0; g < G; g++) {
        var eg = eG[g];
        dcG[g] += (eg - dcG[g]) * kM;
        var xg = eg - dcG[g];
        if (tb > 0.001) { tLp[g] += (xg - tLp[g]) * kT; xg = xg * (1 - tb) + tLp[g] * tb; }
        if (collFb > 0.001) {
          var gbuf = gBuf[g];
          var gd = gbuf[(wp - gD[g]) & DLM];
          gLag[g] += (gd - gLag[g]) * kdC;
          xg += collFb * sat(gLag[g]);
          gbuf[wp] = xg;
        }
        if (grpBank[g]) { xb += xg; eB += eg; } else { xa += xg; eA += eg; }
      }
      // crank torsion: leaky integral of the firing pulses, DC-blocked
      tq += ((eA + eB) - tq) * kTq;
      tqDC += (tq - tqDC) * kTqDC;
      var tqz = tq - tqDC;
      if (tqz > 2.5) tqz = 2.5; else if (tqz < -2.5) tqz = -2.5;
      tau += (1 + torsAmt * tqz - tau) * 0.45;
      dcI += (eI - dcI) * kM;
      var xi = eI - dcI;

      // combustion rasp gated by the pulses
      var gtA = eA < 0 ? 0 : (eA > 1.3 ? 1.3 : eA);
      var gtB = eB < 0 ? 0 : (eB > 1.3 ? 1.3 : eB);
      if (raspOn) {
        xa += rG * rbpA.p(this.rnd() * 2 - 1) * gtA * gtA;
        xb += rG * rbpB.p(this.rnd() * 2 - 1) * gtB * gtB;
      }
      // v3 crackle: every pulse onset re-arms a stochastic HF burst whose
      // level AND decay time were randomised for that one firing (main
      // branch behaviour). Two firings never crackle alike.
      if (crG > 0.002) {
        var conA = eA - prevEA; if (conA > 0.22 && crG * conA > this.crA) { this.crA = crG * (0.5 + this.rnd()); this.crDecA = 26 + 55 * this.rnd(); }
        var conB = eB - prevEB; if (conB > 0.22 && crG * conB > this.crB) { this.crB = crG * (0.5 + this.rnd()); this.crDecB = 26 + 55 * this.rnd(); }
        if (this.crA > 0.003) { xa += 0.55 * this.crBpA.p(this.rnd() * 2 - 1) * this.crA; this.crA *= Math.exp(-this.crDecA * invSr); }
        if (this.crB > 0.003) { xb += 0.55 * this.crBpB.p(this.rnd() * 2 - 1) * this.crB; this.crB *= Math.exp(-this.crDecB * invSr); }
      }
      // scavenge echo (both banks)
      if (scavOn) {
        var sd = sBuf[(wp - DS) & DLM];
        sLag += (sd - sLag) * kdS;
        xa += scavG * sLag;
        xb += scavG * sLag;
        sBuf[wp] = (xa + xb) * 0.5;
      }
      // engine block rumble driven by the firing pulses
      if (blockG > 0.001) { xa += blockG * bA.p(xa); xb += blockG * bB.p(xb); }
      // piston slap / secondary motion: lower, softer ring on each pulse onset
      if (slapG > 0.001) {
        var slA = eA - prevEA; if (slA < 0) slA = 0;
        var slB = eB - prevEB; if (slB < 0) slB = 0;
        xa += slapG * sA.p(slA);
        xb += slapG * sB.p(slB);
      }
      // layer 1: valvetrain ring excited by the actual valve events above
      if (camG > 0.001) {
        xa += camG * vtA.p(camHitA);
        xb += camG * vtB.p(camHitB);
      }
      // valvetrain tick: a short tonal ring excited by each pulse onset (no noise)
      if (injG > 0.001) {
        var onA = eA - prevEA; if (onA < 0) onA = 0;
        var onB = eB - prevEB; if (onB < 0) onB = 0;
        xa += injG * iA.p(onA);
        xb += injG * iB.p(onB);
      }
      prevEA = eA; prevEB = eB;
      // timing chain / gear whirr
      if (chainG > 0.001) { xa += chainG * cA.p(xa); xb += chainG * cB.p(xb); }
      // tailpipe reflection
      if (tailOn) {
        var td = tBuf[(wp - DT) & DLM];
        tLag += (td - tLag) * kdT;
        xa += tailG * tLag;
        xb += tailG * tLag;
        tBuf[wp] = (xa + xb) * 0.5;
      }

      // un-resonated pulse + body thump + header resonances
      lowA += (xa - lowA) * kBody;
      lowB += (xb - lowB) * kBody;
      var yA = dirG * xa + bodyG * lowA;
      var yB = dirG * xb + bodyG * lowB;
      for (j = 0; j < J; j++) {
        fG[j] += (tg[j] - fG[j]) * kG;
        yA += fG[j] * bpA[j].p(xa);
        yB += fG[j] * bpB[j].p(xb);
      }
      // v3 order layer + AM rasp. Firing phase comes from the crank itself
      // (cyc already carries torsional wobble), the order tone is gated by a
      // fast follower of the pulse train, and the AM tear beats the two
      // banks against each other at half order.
      {
        var phF = cyc * n;
        var gateT = (eA + eB) * 0.7; if (gateT > 1.25) gateT = 1.25;
        this.ordGate += (gateT - this.ordGate) * 0.22;
        if (ordG > 0.002 && this.ordGate > 0.004) {
          var osum = 0;
          for (k = 0; k < nOrd; k++) osum += ordAmp[k] * Math.sin(TWO_PI * (k + 1) * phF);
          var oOut = ordG * this.ordGate * osum * 0.16;
          yA += oOut; yB += oOut;
        }
        if (amG > 0.002) {
          var amC = Math.sin(TWO_PI * 3 * phF) * Math.sin(TWO_PI * 0.5 * phF);
          yA += amG * amC * (gtA * 0.35);
          yB += amG * amC * (gtB * 0.35);
        }
      }
      // bank pipes with a saturating reflection
      if (pipeOn) {
        var pdA = pipeA[(wp - DA) & DLM];
        pLA += (pdA - pLA) * kdP;
        yA += gP * sat(pLA);
        pipeA[wp] = yA;
        var pdB = pipeB[(wp - DB) & DLM];
        pLB += (pdB - pLB) * kdP;
        yB += gP * sat(pLB);
        pipeB[wp] = yB;
      }
      yA = lpA.p(yA);
      yB = lpB.p(yB);
      var exL = pl0 * yA + pl1 * yB;
      var exR = pr0 * yA + pr1 * yB;

      // plenum / induction roar
      var inL = 0, inR = 0;
      for (k = 0; k < K; k++) {
        inL += gI[k] * bpIL[k].p(xi);
        inR += gI[k] * bpIR[k].p(xi);
      }

      // level normaliser — v3: PARTIAL only (exponent 0.19, not 0.5).
      // Full normalisation (lvl/sqrt(pw)) made every rpm and every car the
      // same loudness: prime "digital linear" behaviour. A real exhaust
      // gets louder with rpm and load and stays louder.
      var rl = exL + inL, rrr = exR + inR;
      var raw = 0.5 * (rl * rl + rrr * rrr);
      pw += (raw - pw) * (raw > pw ? kAtt : kRel);
      var ag = lvl * 1.9 / Math.pow(pw + 1e-9, 0.19);
      if (ag > 30) ag = 30;

      cutG += (cutT - cutG) * (cutT < cutG ? 0.012 : 0.004);
      vol += (volT - vol) * 0.002;
      var gg = ag * vol * cutG;
      L[m] = (exL * gEx + inL * gIn) * gg;
      R[m] = (exR * gEx + inR * gIn) * gg;

      wp = (wp + 1) & DLM;
    }

    this.cyc = cyc; this.rpm = rpm; this.vol = vol; this.cutG = cutG; this.pw = pw;
    this.dcA = dcA; this.dcB = dcB; this.dcI = dcI; this.lowA = lowA; this.lowB = lowB;
    this.pLA = pLA; this.pLB = pLB; this.sLag = sLag; this.tLag = tLag; this.wp = wp;
    this.prevEA = prevEA; this.prevEB = prevEB;
    this.tq = tq; this.tqDC = tqDC; this.tau = tau;
  }

  // ───────────────────────── electric model (main branch) ─────────────────────────
  // Two motor tones + reduction-gear whine + a low electromagnetic throb.
  // Frequencies follow motor rpm (the sim reports motor rpm as "rpm" for
  // EVs, redline 16000); gains follow signed motor activity (drive/regen).
  processEV(L, R, N) {
    var c = this.cfg, s = this.s, mix = this.mix;
    var invSr = 1 / this.sr;
    var rpmK = 1 - Math.exp(-1 / (this.sr * 0.01));
    var rpm = this.rpm;
    var mot = clamp(s.motor, -1, 1);
    var act = Math.abs(mot);
    var p1 = this.ev1, p2 = this.ev2, p3 = this.ev3;
    var vol = 0;
    for (var i = 0; i < N; i++) {
      rpm += (this.rpmT - rpm) * rpmK;
      var ratio = clamp(rpm / Math.max(1000, c.redline), 0, 1.1);
      var f1 = 28 + ratio * 640;
      var f2 = 90 + ratio * 1480;
      var f3 = rpm * 0.11;
      p1 += TWO_PI * f1 * invSr; if (p1 > TWO_PI) p1 -= TWO_PI;
      p2 += TWO_PI * f2 * invSr; if (p2 > TWO_PI) p2 -= TWO_PI;
      p3 += TWO_PI * Math.min(f3, 9000) * invSr; if (p3 > TWO_PI) p3 -= TWO_PI;
      var target = (0.1 + 0.5 * act) * (0.35 + 0.65 * ratio + 0.25 * act) * clamp(fin(mix.motor, 1), 0, 2) * fin(mix.engine, 1);
      vol += (target - vol) * 0.004;
      var throb = Math.sin(p1 * 0.25) * 0.35;
      var out = (Math.sin(p1) + 0.55 * Math.sin(p2) + 0.3 * Math.sin(p2 * 1.5)) * 0.55 + Math.sin(p3) * 0.4 * ratio + throb * act;
      // soft saturation keeps the inverter edge without harshness
      out = out / (1 + Math.abs(out) * 0.7);
      L[i] = out * vol * 0.5;
      R[i] = out * vol * 0.5;
    }
    this.rpm = rpm;
    this.ev1 = p1; this.ev2 = p2; this.ev3 = p3;
  }

  // ───────────────────────── tonal layers ─────────────────────────
  processLayers(FL, FR, N) {
    var c = this.cfg, s = this.s, mix = this.mix;
    var sr = this.sr, invSr = 1 / sr;
    var boost = clamp(s.boost, 0, 1);
    // layer 2: turbo spool (shaft inertia) + overrun (compressor surge)
    var vv = c.v || null;
    var spoolMul = clamp(fin(mix.spool, 1), 0, 2);
    var spoolTau = vv ? clamp(fin(vv.spoolTau, 0.45), 0.06, 2) : 0.45;
    var dtB = N * invSr;
    var spoolWant = c.turbo > 0 ? clamp(boost * 0.85 + s.load * 0.3, 0, 1) * (0.35 + 0.65 * smooth(this.rpm, 1000, 4200)) : 0;
    var tauUse = spoolWant > this.spool ? spoolTau : spoolTau * 2.3; // spools up faster than it decays
    this.spool += (spoolWant - this.spool) * (1 - Math.exp(-dtB / tauUse));
    var spool = this.spool;
    var loadDrop = this.spoolLoad - s.load;
    if (c.turbo > 0 && spool > 0.32 && s.load < 0.3 && this.rpm > c.redline * 0.3 && loadDrop > 0.02) {
      this.over = Math.max(this.over, clamp(loadDrop * 3, 0, 1)); // lift-off while spooled
    } else {
      this.over *= Math.exp(-dtB / 0.6);
    }
    this.spoolLoad = s.load;
    var over = this.over;
    var overG = vv ? fin(vv.overG, 0) : 0;
    var overA = over * overG * c.turbo * mix.turbo * spoolMul * 0.055 * (0.35 + 0.65 * spool);
    var ovDp = TWO_PI * clamp(vv ? fin(vv.overHz, 13) : 13, 4, 30) * invSr;
    var tf = c.turbo > 0 ? 650 + spool * (vv ? fin(vv.spoolHz, 6200) : 6200) : 1100 + 4600 * Math.pow(boost, 1.1);
    this.turboF = tf;
    var ovCDp = TWO_PI * clamp(tf * 0.38, 160, 2600) * invSr;
    var ta = c.turbo * mix.turbo * spoolMul * (vv ? fin(vv.spoolG, 1) : 1) * (0.002 + 0.105 * Math.pow(spool, 1.8)) * (1 + 0.4 * s.nitro);
    var tdp1 = TWO_PI * tf * invSr;
    var tdp2 = tdp1 * (c.twin ? 1.0123 : 1.0);
    var twinMix = c.twin ? 0.8 : 0.0;
    var g1 = this.rpm / 60 * 15;
    var g2 = s.speed * 8.5;
    var gA = c.gear * mix.gear * s.gearEng * (0.35 + 0.65 * Math.abs(s.gearLoad)) * (0.2 + 0.8 * smooth(s.speed, 3, 40)) * 0.028;
    var gdp1 = TWO_PI * Math.min(g1, 0.42 * sr) * invSr;
    var gdp2 = TWO_PI * Math.min(g2, 0.42 * sr) * invSr;
    var mf = 70 + 7.0 * s.speed;
    var mA = c.motor * mix.motor * (0.010 + 0.05 * Math.abs(s.motor)) * (0.25 + 0.75 * smooth(s.speed, 1, 20));
    var mdp = TWO_PI * Math.min(mf, 0.14 * sr) * invSr;
    // ancillary whine: alternator / pumps driven off the crank at a fixed ratio
    var ancF = clamp(this.rpm / 60 * (c.v ? fin(c.v.ancMul, 18) : 18), 60, 0.35 * sr);
    var ancA = (c.v ? fin(c.v.ancG, 0) : 0) * clamp(fin(mix.mech, 1), 0, 2) * 0.011 * (0.45 + 0.55 * s.load) * (0.35 + 0.65 * clamp(this.rpm / 2500, 0, 1));
    var adp = TWO_PI * ancF * invSr;
    // v3 supercharger whine (main branch): crank-ratio tone stack through
    // soft saturation — the Demon's blower over the cross-plane thunder.
    var chF = clamp(this.rpm / 60 * (vv ? fin(vv.chargerRatio, 36) : 36), 40, 0.4 * sr);
    var chA = (vv ? fin(vv.charger, 0) : 0) * clamp(fin(mix.mech, 1), 0, 2) * 0.055 * (0.2 + 0.8 * s.load) * (0.3 + 0.7 * clamp(this.rpm / Math.max(1200, c.redline), 0, 1));
    var chDp = TWO_PI * chF * invSr;
    var voices = this.voices;
    var tp1 = this.tp1, tp2 = this.tp2, gp1 = this.gp1, gp2 = this.gp2, mp = this.mp, ancP = this.ancP;
    var chP = this.chP;
    var overP = this.overP, overC = this.overC;
    for (var i = 0; i < N; i++) {
      var lL = 0, lR = 0;
      if (ta > 0.0002) {
        tp1 += tdp1; if (tp1 > TWO_PI) tp1 -= TWO_PI;
        tp2 += tdp2; if (tp2 > TWO_PI) tp2 -= TWO_PI;
        var a1 = Math.sin(tp1), a2 = Math.sin(tp2), a3 = Math.sin(tp1 * 2);
        lL += ta * (a1 + twinMix * 0.45 * a2 + 0.22 * a3);
        lR += ta * (twinMix > 0 ? (a2 * twinMix + 0.45 * a1 + 0.22 * a3) : (a1 + 0.22 * a3));
      }
      if (gA > 0.0002) {
        gp1 += gdp1; if (gp1 > TWO_PI) gp1 -= TWO_PI;
        gp2 += gdp2; if (gp2 > TWO_PI) gp2 -= TWO_PI;
        var gs = gA * (Math.sin(gp1) + 0.45 * Math.sin(gp1 * 2) + 0.8 * Math.sin(gp2));
        lL += gs; lR += gs;
      }
      if (mA > 0.0002) {
        mp += mdp; if (mp > TWO_PI) mp -= TWO_PI;
        var ms = mA * (Math.sin(mp) + 0.5 * Math.sin(mp * 2) + 0.3 * Math.sin(mp * 3));
        lL += ms; lR += ms;
      }
      if (ancA > 0.0002) {
        ancP += adp; if (ancP > TWO_PI) ancP -= TWO_PI;
        var as = ancA * (Math.sin(ancP) + 0.35 * Math.sin(ancP * 2));
        lL += as; lR += as;
      }
      if (chA > 0.0002) {
        chP += chDp; if (chP > TWO_PI) chP -= TWO_PI;
        var chRaw = Math.sin(chP) + 0.5 * Math.sin(chP * 2) + 0.3 * Math.sin(chP * 2.98) + 0.16 * Math.sin(chP * 4.02);
        var chs = chA * (chRaw / (1 + Math.abs(chRaw) * 0.8));
        lL += chs; lR += chs;
      }
      if (overA > 0.0002) {
        overP += ovDp; if (overP > TWO_PI) overP -= TWO_PI;
        overC += ovCDp; if (overC > TWO_PI) overC -= TWO_PI;
        var chop = Math.sin(overP);
        chop = chop > 0 ? chop * chop : 0; // one-sided surge puffs, tonal not noise
        var surge = overA * (Math.sin(overC) + 0.35 * Math.sin(overC * 2)) * (0.2 + 0.8 * chop);
        lL += surge; lR += surge;
      }
      for (var j = 0; j < NV; j++) {
        var v = voices[j];
        if (!v.on) continue;
        var f = v.f1 + v.df;
        v.df *= v.ep;
        v.ph += TWO_PI * f * invSr;
        if (v.ph > TWO_PI) v.ph -= TWO_PI;
        var am = v.amp;
        v.amp *= v.ea;
        if (v.amR > 0) {
          v.amP += TWO_PI * v.amR * invSr;
          if (v.amP > TWO_PI) v.amP -= TWO_PI;
          var gw = Math.sin(v.amP);
          am *= (1 - v.amD) + v.amD * (gw > 0 ? gw : 0);
        }
        var sv = Math.sin(v.ph) * am;
        lL += sv; lR += sv;
        if (v.amp < 0.0002) v.on = false;
      }
      FL[i] = lL;
      FR[i] = lR;
    }
    this.tp1 = tp1; this.tp2 = tp2; this.gp1 = gp1; this.gp2 = gp2; this.mp = mp; this.ancP = ancP; this.chP = chP;
    this.overP = overP; this.overC = overC;
  }
}

registerProcessor('engine-processor', EngineProcessor);
`;
