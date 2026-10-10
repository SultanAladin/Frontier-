// Vehicle engine synthesis core.
//
// Dependency-free DSP that runs in three places: inside an AudioWorkletProcessor
// (audio thread), on the main thread for offline clip export, and in Node for the
// verification suite. Nothing here touches the DOM, timers or requestAnimationFrame,
// so the simulation advances exactly one sample at a time whatever the page is doing.
//
// Model overview (all per-sample, with control-rate physics every CONTROL_BLOCK):
//   crank      crank angle advances with rpm; each cylinder fires at its firing-slot
//              angle (720°/N apart), with cycle-to-cycle timing and amplitude scatter.
//   combustion each firing injects a short exponentially decaying pulse into a pair of
//              stereo exciters, then the pulses pass through the exhaust resonator
//              bank (source–filter model: firing-frequency harmonics shaped by the pipe).
//   intake     band-passed noise, follows throttle and rpm.
//   turbo      spool-lag boost model; compressor whine, hiss, blow-off and wastegate.
//   mechanical valvetrain ticks, gear-mesh whine, starter motor while cranking.
//   metal      sequential-shift dog clunk excites a metal ringing filter bank.
//   fuel       injector hiss per injection, pump whine, low-fuel starvation misfires.
//   NOS        pressure bottle drains while active; adds torque, hiss and backfires.
//   wind       speed-driven broadband noise.
//   physics    rpm (crank inertia, clutch coupling to road speed), gearbox, limiter,
//              vehicle speed; all of these drive the synthesis above.

export const TAU = Math.PI * 2;
export const CONTROL_BLOCK = 128;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/** Deterministic xorshift32 PRNG returning values in [0, 1). */
export function makeRng(seed = 0x2f6e2b1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** RBJ band-pass (constant 0 dB peak gain) — the only filter type used. */
export class Bandpass {
  constructor() {
    this.b0 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  set(sampleRate, freq, q) {
    const f = clamp(freq, 20, sampleRate * 0.45);
    const w = (TAU * f) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cw = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class EngineCore {
  constructor(sampleRate, car) {
    this.sr = sampleRate;
    this.rng = makeRng(0x2f6e2b1);
    this.layers = { exhaust: 1, intake: 1, turbo: 1, mechanical: 1, metal: 1, fuel: 1, nos: 1, wind: 1, master: 0.8 };
    this.ignitionIn = false;
    this.thIn = 0;
    this.lastThIn = 0;
    this.brakeIn = 0;
    this.nosIn = false;
    this.mode = 'auto';
    this.fuel = 0.9;
    this.nosBottle = 1;
    this.misfires = 0;
    this.meter = new Float64Array(8);
    this.meterSamples = 0;
    this.outL = 0;
    this.outR = 0;
    this.setCar(car);
  }

  /** Switch vehicle; fuel and NOS bottles carry over. */
  setCar(car) {
    const sr = this.sr;
    const N = car.cylinders;
    this.car = car;
    this.slotNext = new Float64Array(N);
    this.slotGainL = new Float64Array(N);
    this.slotGainR = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      this.slotNext[j] = (j * 720) / N;
      const p = car.pan[j % car.pan.length];
      this.slotGainL[j] = Math.sqrt((1 - p) / 2);
      this.slotGainR[j] = Math.sqrt((1 + p) / 2);
    }
    this.modesL = car.modes.map(([f, q]) => new Bandpass().set(sr, f, q));
    this.modesR = car.modes.map(([f, q]) => new Bandpass().set(sr, f, q));
    this.modeGain = car.modes.map(([, , g]) => g * car.exhaustGain);
    this.dec = Math.exp(-1 / (car.pulseTau * sr));
    this.eL = 0;
    this.eR = 0;

    this.crankA = 0;
    this.dA = 0;
    this.rpm = 0;
    this.speed = 0;
    this.gear = 0;
    this.th = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.handbrakeIn = 0;
    this.grade = this.grade ?? 0;
    this.handbrakeForce = 0.35 * car.brakeForce;
    this.clutchMax = 1.6 * Math.max(...car.torque.map((p) => p[1]));
    this.clutchK = 40 * car.inertia;
    this.tc = 0;
    this.tcPrev = 0;
    this.driveTorque = 0;
    this.driveDemand = 0;
    this.load = 0;
    this.tqMax = 0;
    this.fuelFlow = false;
    this.idleAssist = 0;
    this.engaged = false;
    this.engineState = 'off';
    this.crankTimer = 0;
    this.shiftTimer = 0;
    this.shiftCut = 0;
    this.shiftCooldown = 0;
    this.limiterCut = false;
    this.limToggle = 0;
    this.cutActive = false;
    this.amp = 0;
    this.misfireP = 0;
    this.starve = 0;
    this.nosLevel = 0;
    this.turbo01 = 0;
    this.bovEnv = 0;
    this.clunkIn = 0;
    this.tickAcc = 0;
    this.tickEnv = 0;
    this.tickFreq = 4000;
    this.tickPh = 0;
    this.tickRate = 0;
    this.tickGain = 0;
    this.gearPh = 0;
    this.gearDPh = 0;
    this.gearGain = 0;
    this.starterPh = 0;
    this.pumpPh = 0;
    this.pumpDPh = TAU * 2600 / sr;
    this.hissEnv = 0;
    this.hissLp = 0;
    this.hissK = 1 - Math.exp((-TAU * 3000) / sr);
    this.hissDec = Math.exp(-1 / (0.0004 * sr));
    this.tickDec = Math.exp(-1 / (0.0008 * sr));
    this.bovDec = Math.exp(-1 / (0.22 * sr));
    this.turboPh = 0;
    this.turboDPh = 0;
    this.turboWhineG = 0;
    this.turboHissG = 0;
    this.wgPh = 0;
    this.wgDPh = TAU * (car.turbo?.wgHz ?? 40) / sr;
    this.wgGain = 0;
    this.intakeG = 0;
    this.windGain = 0;
    this.drive = 1;

    this.intakeBPL = new Bandpass().set(sr, car.intake.freq, car.intake.q);
    this.intakeBPR = new Bandpass().set(sr, car.intake.freq * 1.03, car.intake.q);
    this.turboNBP = new Bandpass().set(sr, 4000, 7);
    this.bovBP = new Bandpass().set(sr, 3400, 2.2);
    this.wgBP = new Bandpass().set(sr, 1500, 3);
    this.nosBP = new Bandpass().set(sr, 3800, 1.2);
    this.windBP = new Bandpass().set(sr, 620, 0.7);
    this.clunkBP = [[1100, 12, 0.35], [2350, 10, 0.25], [4700, 8, 0.15]].map(([f, q, g]) => ({ bp: new Bandpass().set(sr, f, q), g }));
    this.clunkGain = car.clunk;
    this.popScale = car.popGain;
    this.injAmp = car.injHiss;
    this.control(CONTROL_BLOCK);
  }

  setInput(v) {
    const car = this.car;
    if (v.throttle !== undefined) {
      this.lastThIn = this.thIn;
      this.thIn = clamp(v.throttle, 0, 1);
      // Throttle lift with a boosted turbo: blow-off valve venting.
      if (car.turbo && this.lastThIn > 0.6 && this.thIn < 0.15 && this.turbo01 > 0.3) this.bovEnv = 1;
    }
    if (v.brake !== undefined) this.brakeIn = clamp(v.brake, 0, 1);
    if (v.handbrake !== undefined) this.handbrakeIn = clamp(v.handbrake, 0, 1);
    if (v.grade !== undefined) this.grade = clamp(v.grade, -25, 25);
    if (v.ignition !== undefined) this.ignitionIn = !!v.ignition;
    if (v.nos !== undefined) this.nosIn = !!v.nos;
    if (v.mode !== undefined) this.mode = v.mode === 'manual' ? 'manual' : 'auto';
    if (v.shift) this.shiftTo(this.gear + v.shift, v.shift < 0);
    if (v.neutral) this.gear = 0;
    if (v.fuel !== undefined) this.fuel = clamp(v.fuel, 0, 1);
    if (v.refuel) this.fuel = 1;
    if (v.refillNos) this.nosBottle = 1;
    if (v.layers) Object.assign(this.layers, v.layers);
  }

  shiftTo(target, downshift) {
    const car = this.car;
    if (target < 1 || target > car.gears.length || target === this.gear) return;
    const fromNeutral = this.gear === 0;
    this.gear = target;
    this.shiftTimer = 0.09;
    this.shiftCut = 0.045;
    this.shiftCooldown = 0.4;
    if (!fromNeutral) {
      this.clunkIn = 1; // dog engagement clunk
    }
    // Ignition cut produces an audible bang on the exhaust.
    if (this.engineState === 'running') {
      this.pop(this.popScale * 0.9);
      this.pop(this.popScale * 0.5);
    }
  }

  /** Exhaust pop: a broadband pulse straight into the exciters. */
  pop(gain) {
    this.eL += gain * 0.7;
    this.eR += gain * 0.7;
  }

  /** Called from the sample loop when a cylinder reaches its firing angle. */
  fire(j) {
    const car = this.car;
    const rng = this.rng;
    if (this.cutActive) return;
    if (this.limiterCut) {
      this.limToggle ^= 1;
      if (this.limToggle) {
        if (rng() < 0.5) this.pop(this.popScale * 0.6);
        return;
      }
    }
    if (this.engineState === 'cranking' && rng() < 0.65) return;
    if (this.misfireP > 0 && rng() < this.misfireP) {
      this.misfires++;
      return;
    }
    const amp = this.amp * (1 + (rng() - 0.5) * 2 * car.roughness);
    if (this.nosLevel > 0.5 && rng() < 0.06) this.pop(this.popScale * 2.2);
    if (this.th < 0.06 && this.rpm > car.redline * 0.4 && rng() < car.crackle * 0.12) {
      this.pop(this.popScale * (0.5 + rng() * 0.6));
    }
    const nz = 1 + (rng() - 0.5) * 2 * car.noise;
    this.eL += amp * this.slotGainL[j] * nz;
    this.eR += amp * this.slotGainR[j] * nz;
    this.hissEnv += this.injAmp * amp;
  }

  /** Control-rate physics. Runs every CONTROL_BLOCK samples. */
  /**
   * Control-rate update (every CONTROL_BLOCK samples). The drivetrain is integrated in
   * SUB sub-steps so the clutch spring stays stable at audio-rate control intervals.
   */
  control(m) {
    const car = this.car;
    const sr = this.sr;
    const dt = m / sr;

    // --- Ignition / starter ---------------------------------------------------
    if (this.engineState === 'off' && this.ignitionIn) {
      this.engineState = 'cranking';
      this.crankTimer = 0;
    }
    if (this.engineState === 'cranking') {
      this.crankTimer += dt;
      if (!this.ignitionIn) this.engineState = 'off';
      else if (this.crankTimer > 1.3) this.engineState = 'running';
    }
    if (this.engineState === 'running' && !this.ignitionIn) this.engineState = 'off';
    const running = this.engineState === 'running';

    // --- Pedals and timers ----------------------------------------------------
    this.th += (this.thIn - this.th) * (1 - Math.exp(-dt / 0.03));
    this.brake += (this.brakeIn - this.brake) * (1 - Math.exp(-dt / 0.03));
    this.handbrake += (this.handbrakeIn - this.handbrake) * (1 - Math.exp(-dt / 0.05));
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftCut > 0) this.shiftCut -= dt;
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;

    if (running && this.mode === 'auto' && this.shiftTimer <= 0 && this.shiftCooldown <= 0) this.autoShift();
    if (running && this.gear === 0 && this.mode === 'auto' && this.th > 0.05 && this.shiftTimer <= 0) this.shiftTo(1, false);

    // --- NOS ------------------------------------------------------------------
    const nosActive = car.nosSeconds > 0 && running && this.nosIn && this.nosBottle > 0 && this.th > 0.25;
    if (nosActive) this.nosBottle = Math.max(0, this.nosBottle - dt / car.nosSeconds);
    this.nosLevel += ((nosActive ? 1 : 0) - this.nosLevel) * (1 - Math.exp(-dt / 0.15));

    // --- Turbo spool ------------------------------------------------------------
    if (car.turbo) {
      const target = this.th * clamp((this.rpm - 1500) / 2500, 0, 1);
      const tau = target > this.turbo01 ? car.turbo.spoolUp : car.turbo.spoolDown;
      this.turbo01 = clamp(this.turbo01 + (target - this.turbo01) * (1 - Math.exp(-dt / tau)), 0, 1);
    } else {
      this.turbo01 = 0;
    }

    // --- Torque available at the current rpm ------------------------------------
    let tq = interp(car.torque, this.rpm);
    if (car.turbo) tq *= 0.6 + 0.4 * this.turbo01;
    if (nosActive) tq *= 1 + 0.16 * this.nosLevel;
    this.tqMax = tq;
    this.limiterCut = running && this.rpm >= car.redline;
    this.fuelFlow = running && this.fuel > 0.005 && !this.limiterCut && this.shiftCut <= 0;
    // Idle-speed control: an ECU bypass holds idle when the throttle is closed.
    this.idleAssist = running && !this.limiterCut ? clamp((car.idleRpm - this.rpm) * 0.5, 0, 160) : 0;
    // The clutch is engaged in gear while rolling or while the driver asks for drive.
    this.engaged = running && this.gear > 0 && this.shiftTimer <= 0 && (this.speed > 0.6 || this.th > 0.08);

    if (this.engineState === 'cranking') {
      this.rpm += (320 - this.rpm) * (1 - Math.exp(-dt / 0.2));
    } else {
      const SUB = 4;
      const h = dt / SUB;
      for (let k = 0; k < SUB; k++) this.driveStep(h, running, tq);
    }
    if (this.engineState === 'off' && this.rpm < 25) this.rpm = 0;

    // --- Fuel -------------------------------------------------------------------
    if (running && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - dt * 0.0009 * this.th * (this.rpm / car.redline + 0.1) * (this.nosLevel > 0.5 ? 1.5 : 1));
    }
    this.starve = running ? clamp((0.06 - this.fuel) / 0.06, 0, 1) : 0;

    // --- Engine load: driver demand relative to available torque, plus driveline reaction ---
    const demand = this.fuelFlow && tq > 1 ? clamp((this.driveDemand) / tq, 0, 1) : 0;
    this.load += (demand - this.load) * (1 - Math.exp(-dt / 0.05));
    const rN = clamp(this.rpm / car.redline, 0, 1.1);
    const tcRatio = clamp(Math.abs(this.tc) / (this.clutchMax * 0.5), 0, 1);

    // --- Derived per-block parameters -----------------------------------------
    this.amp = car.baseLevel * (0.2 + 0.8 * this.load) * (1 + 0.2 * this.nosLevel);
    this.misfireP = this.starve * 0.5;
    this.cutActive = this.shiftCut > 0 || (!running && this.engineState !== 'cranking');
    this.dA = (6 * this.rpm) / sr;
    this.tickRate = running ? (this.rpm / 60) * (car.valves / 2) : 0;
    this.tickGain = car.ticks * clamp((this.rpm - 500) / 2000, 0, 1);
    this.gearDPh = (TAU * ((this.rpm / 60) * car.gearTeeth)) / sr;
    // Gear-mesh whine follows the torque actually passing through the gears.
    this.gearGain = car.gearWhine * rN * (0.25 + 0.75 * tcRatio) * (this.engaged ? 1 : 0.05);
    this.intakeG = car.intake.gain * (0.1 + 0.9 * this.load) * Math.pow(rN, 1.5);
    this.intakeBPL.set(sr, car.intake.freq * (0.65 + 0.7 * rN), car.intake.q);
    this.intakeBPR.set(sr, car.intake.freq * 1.03 * (0.65 + 0.7 * rN), car.intake.q);
    this.windGain = car.windGain * Math.pow(this.speed / 80, 2.2);
    // Electric fuel pump runs only with ignition on.
    this.pumpLevel = running ? car.pumpGain * (1 - 0.6 * this.starve) : 0;
    if (car.turbo) {
      const fw = car.turbo.whineMin + (car.turbo.whineMax - car.turbo.whineMin) * this.turbo01;
      this.turboDPh = (TAU * fw) / sr;
      this.turboNBP.set(sr, fw, 7);
      this.turboWhineG = car.turbo.whineGain * this.turbo01 * this.turbo01 * (0.25 + 0.75 * this.th);
      this.turboHissG = car.turbo.hissGain * this.turbo01 * (0.2 + 0.8 * this.th);
      this.wgGain = car.turbo.wastegate * (this.turbo01 > 0.7 && this.th > 0.6 ? (this.turbo01 - 0.7) / 0.3 : 0);
    }
    this.starterGain = this.engineState === 'cranking' ? 0.035 : 0;
    this.starterDPh = (TAU * (360 + 90 * (this.crankTimer % 1))) / sr;
  }

  /**
   * One drivetrain integration step (dt = h seconds).
   * Engine: I·dω/dt = T_engine − T_friction − T_clutch
   * Clutch: spring-damped slip coupling, torque capped (launch capacity is set by the driver's throttle).
   * Vehicle: m·dv/dt = T_clutch·G·η/r − drag − rolling − grade − brakes
   */
  driveStep(h, running, tq) {
    const car = this.car;
    const G = this.gear > 0 ? car.gears[this.gear - 1] * car.finalDrive : 0;
    const I = car.inertia;
    const w = (this.rpm * TAU) / 60;

    const driverTorque = this.fuelFlow ? tq * this.th : 0;
    this.driveDemand = driverTorque;
    const Te = driverTorque + (running ? this.idleAssist : 0);
    const Tf = running
      ? car.friction[0] + car.friction[1] * this.rpm + (1 - this.th) * car.pumpLoss * (this.rpm / 1000)
      : car.friction[0] + car.friction[1] * this.rpm;

    let tc = 0;
    if (this.engaged && G > 0) {
      const cap = this.speed < 3 ? Math.max(12, 0.9 * Math.max(Te, 0)) : this.clutchMax;
      tc = clamp(this.clutchK * (w - (this.speed * G) / car.wheelRadius), -cap, cap);
    }
    // Tip-in / tip-out through driveline backlash: a small metal clunk when torque reverses.
    if (this.tcPrev * tc < 0 && Math.abs(tc) > 40 && this.clunkIn === 0) this.clunkIn = 0.3;
    this.tcPrev = tc;
    this.tc = tc;

    // Engine
    let wNew = w + ((Te - Tf - tc) / I) * h;
    const wRedline = (car.redline * TAU) / 60;
    if (wNew < 0) wNew = 0;
    if (wNew > wRedline * 1.04) wNew = wRedline * 1.04;

    // Vehicle
    const v = this.speed;
    const theta = Math.atan(this.grade / 100);
    const Fdrive = this.engaged && G > 0 ? (tc * G * 0.9) / car.wheelRadius : 0;
    const Fdrag = 0.5 * 1.2 * car.cdA * v * v;
    const Froll = v > 0.05 ? car.crr * car.mass * 9.81 * Math.cos(theta) : 0;
    const Fgrade = car.mass * 9.81 * Math.sin(theta);
    const Fbrakes = this.brake * car.brakeForce + this.handbrake * this.handbrakeForce;
    let net = Fdrive - Fdrag - Froll - Fgrade;
    let vNew;
    if (v < 0.05 && Math.abs(net) <= Fbrakes) {
      vNew = 0; // held by the brakes
    } else {
      net -= Fbrakes * Math.sign(v > 0.05 ? v : net);
      vNew = v + (net / car.mass) * h;
    }
    if (vNew < 0) vNew = 0; // no reverse gear

    // Top speed in gear: the limiter stops the engine at redline, so the wheels cannot drive it past that.
    if (this.engaged && G > 0 && wNew >= wRedline) {
      const vMax = (wRedline * car.wheelRadius) / G;
      if (vNew > vMax) vNew = vMax;
    }

    this.rpm = (wNew * 60) / TAU;
    this.speed = vNew;
    this.driveTorque = tc * G * 0.9;
  }

  autoShift() {
    const car = this.car;
    const G = car.gears.length;
    const redline = car.redline;
    if (this.gear === 0) return;
    if (this.rpm >= redline * 0.975 && this.thIn > 0.35 && this.gear < G) {
      this.shiftTo(this.gear + 1, false);
      return;
    }
    if (this.gear > 1) {
      const lowerRpm = (this.speed * car.gears[this.gear - 2] * car.finalDrive * 60) / (TAU * car.wheelRadius);
      if (this.thIn > 0.85 && this.rpm < redline * 0.5 && lowerRpm < redline * 0.9) this.shiftTo(this.gear - 1, true);
      else if (this.brakeIn > 0.6 && lowerRpm < redline * 0.7) this.shiftTo(this.gear - 1, true);
    }
  }

  /** One audio sample; result written to this.outL / this.outR. */
  sample() {
    const car = this.car;
    const rng = this.rng;
    const sr = this.sr;
    const lay = this.layers;
    const N = car.cylinders;

    // Combustion exciters decay, then new pulses are injected.
    this.eL *= this.dec;
    this.eR *= this.dec;
    this.crankA += this.dA;
    for (let j = 0; j < N; j++) {
      if (this.crankA >= this.slotNext[j]) {
        this.slotNext[j] += 720 + (rng() - 0.5) * 2 * car.jitterDeg;
        this.fire(j);
      }
    }

    // Exhaust resonator bank.
    let exL = 0;
    let exR = 0;
    const mL = this.modesL;
    const mR = this.modesR;
    const mg = this.modeGain;
    for (let m = 0; m < mL.length; m++) {
      exL += mL[m].run(this.eL) * mg[m];
      exR += mR[m].run(this.eR) * mg[m];
    }

    // Intake.
    const inL = this.intakeBPL.run(rng() * 2 - 1) * this.intakeG;
    const inR = this.intakeBPR.run(rng() * 2 - 1) * this.intakeG;

    // Turbo.
    let tuL = 0;
    let tuR = 0;
    if (car.turbo) {
      this.turboPh += this.turboDPh;
      if (this.turboPh > TAU) this.turboPh -= TAU;
      const whine = Math.sin(this.turboPh) + 0.35 * Math.sin(2 * this.turboPh);
      const hiss = this.turboNBP.run(rng() * 2 - 1) * this.turboHissG * 4;
      const bovN = this.bovBP.run(rng() * 2 - 1);
      this.bovEnv *= this.bovDec;
      const bov = bovN * this.bovEnv * car.turbo.bovGain;
      this.wgPh += this.wgDPh;
      if (this.wgPh > TAU) this.wgPh -= TAU;
      const wgS = Math.pow(0.5 + 0.5 * Math.sin(this.wgPh), 3);
      const rattle = this.wgBP.run(rng() * 2 - 1) * this.wgGain * wgS * 3;
      tuL = whine * this.turboWhineG + hiss + bov + rattle;
      tuR = whine * this.turboWhineG * 0.95 + hiss * 0.9 + bov * 1.05 + rattle;
    }

    // Mechanical: valvetrain ticks, gear mesh whine, starter.
    this.tickAcc += this.tickRate / sr;
    if (this.tickAcc >= 1) {
      this.tickAcc -= 1;
      this.tickEnv = 1;
      this.tickFreq = 3600 + rng() * 1800;
    }
    this.tickEnv *= this.tickDec;
    this.tickPh += (TAU * this.tickFreq) / sr;
    if (this.tickPh > TAU) this.tickPh -= TAU;
    const ticks = this.tickEnv * (0.6 * Math.sin(this.tickPh) + 0.4 * (rng() * 2 - 1)) * this.tickGain;

    this.gearPh += this.gearDPh;
    if (this.gearPh > TAU) this.gearPh -= TAU;
    const gear = (Math.sin(this.gearPh) + 0.4 * Math.sin(2 * this.gearPh)) * this.gearGain;

    this.starterPh += this.starterDPh;
    if (this.starterPh > TAU) this.starterPh -= TAU;
    const starter = (Math.sin(this.starterPh) * 0.6 + (rng() * 2 - 1) * 0.4) * this.starterGain * (rng() < 0.6 ? 1 : 0.2);

    const mechL = (ticks + gear + starter) * 1;
    const mechR = (ticks * 0.97 + gear * 1.03 + starter * 0.95) * 1;

    // Metal: shift clunk excites a ringing filter bank.
    let metal = 0;
    const ci = this.clunkIn;
    this.clunkIn = 0;
    for (let k = 0; k < this.clunkBP.length; k++) {
      metal += this.clunkBP[k].bp.run(ci) * this.clunkBP[k].g;
    }
    metal *= this.clunkGain;

    // Fuel: injector hiss (high-passed envelope), pump whine, starvation gurgle.
    this.hissEnv *= this.hissDec;
    const hsig = (rng() * 2 - 1) * this.hissEnv;
    this.hissLp += (hsig - this.hissLp) * this.hissK;
    const hiss = (hsig - this.hissLp) * 3;
    this.pumpPh += this.pumpDPh;
    if (this.pumpPh > TAU) this.pumpPh -= TAU;
    const gurgle = this.starve > 0 && rng() < 0.02 + 0.2 * this.starve ? (rng() * 2 - 1) * this.starve * 0.08 : 0;
    const pump = Math.sin(this.pumpPh) * this.pumpLevel + gurgle;
    const fuelL = hiss * 0.8 + pump;
    const fuelR = hiss * 0.8 + pump * 0.95;

    // NOS: pressurized-bottle hiss (only audible while flowing).
    const nosN = this.nosBP.run(rng() * 2 - 1) * this.nosLevel * 0.05;
    const nosL = nosN;
    const nosR = nosN * 0.96;

    // Wind.
    const wn = this.windBP.run(rng() * 2 - 1) * this.windGain * 2;
    const windL = wn;
    const windR = wn * 0.98;

    // Mix with per-layer gains; record meters.
    const exhaustL = exL * lay.exhaust;
    const exhaustR = exR * lay.exhaust;
    const intakeL = inL * lay.intake;
    const intakeR = inR * lay.intake;
    const turboL = tuL * lay.turbo;
    const turboR = tuR * lay.turbo;
    const mechanicalL = mechL * lay.mechanical;
    const mechanicalR = mechR * lay.mechanical;
    const metalL = metal * lay.metal;
    const metalR = metal * lay.metal * 0.97;
    const fuelLayerL = fuelL * lay.fuel;
    const fuelLayerR = fuelR * lay.fuel;
    const nosLayerL = nosL * lay.nos;
    const nosLayerR = nosR * lay.nos;
    const windLayerL = windL * lay.wind;
    const windLayerR = windR * lay.wind;

    const mL_ = exhaustL + intakeL + turboL + mechanicalL + metalL + fuelLayerL + nosLayerL + windLayerL;
    const mR_ = exhaustR + intakeR + turboR + mechanicalR + metalR + fuelLayerR + nosLayerR + windLayerR;
    this.outL = Math.tanh(mL_ * lay.master * this.drive);
    this.outR = Math.tanh(mR_ * lay.master * this.drive);

    const me = this.meter;
    me[0] += Math.abs(exhaustL + exhaustR);
    me[1] += Math.abs(intakeL + intakeR);
    me[2] += Math.abs(turboL + turboR);
    me[3] += Math.abs(mechanicalL + mechanicalR);
    me[4] += Math.abs(metalL + metalR);
    me[5] += Math.abs(fuelLayerL + fuelLayerR);
    me[6] += Math.abs(nosLayerL + nosLayerR);
    me[7] += Math.abs(windLayerL + windLayerR);
    this.meterSamples++;
  }

  /** Render n samples into L/R arrays (Float32Array or plain arrays). */
  process(outL, outR, n, offset = 0) {
    for (let i = 0; i < n; i += CONTROL_BLOCK) {
      const m = Math.min(CONTROL_BLOCK, n - i);
      this.control(m);
      for (let k = 0; k < m; k++) {
        this.sample();
        outL[offset + i + k] = this.outL;
        outR[offset + i + k] = this.outR;
      }
    }
  }

  /** Snapshot for UI telemetry. Levels are block-averaged absolute values since last call. */
  telemetry() {
    const n = Math.max(1, this.meterSamples);
    const lv = this.meter;
    const levels = {
      exhaust: lv[0] / n, intake: lv[1] / n, turbo: lv[2] / n, mechanical: lv[3] / n,
      metal: lv[4] / n, fuel: lv[5] / n, nos: lv[6] / n, wind: lv[7] / n,
    };
    this.meter.fill(0);
    this.meterSamples = 0;
    return {
      state: this.engineState,
      gear: this.gear,
      rpm: this.rpm,
      speedKmh: this.speed * 3.6,
      throttle: this.th,
      brake: this.brake,
      handbrake: this.handbrake,
      grade: this.grade,
      load: this.load,
      engaged: this.engaged,
      driveTorque: this.driveTorque,
      wheelRpm: this.gear > 0 ? (this.speed * this.car.gears[this.gear - 1] * this.car.finalDrive * 60) / (TAU * this.car.wheelRadius) : 0,
      boost: this.turbo01,
      nos: this.nosBottle,
      nosActive: this.nosLevel > 0.5,
      fuel: this.fuel,
      starving: this.starve > 0.05,
      limiter: this.limiterCut,
      shifting: this.shiftTimer > 0,
      misfires: this.misfires,
      levels,
    };
  }
}

/**
 * Offline render helper (no audio context needed). `script(t)` returns the input
 * object to apply at time t (seconds); it is evaluated once per control block.
 */
export function renderClip(car, seconds, script, sampleRate = 48000) {
  const core = new EngineCore(sampleRate, car);
  const n = Math.round(seconds * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += CONTROL_BLOCK) {
    const input = script(i / sampleRate);
    if (input) core.setInput(input);
    const m = Math.min(CONTROL_BLOCK, n - i);
    core.control(m);
    for (let k = 0; k < m; k++) {
      core.sample();
      L[i + k] = core.outL;
      R[i + k] = core.outR;
    }
  }
  return { L, R, core, sampleRate };
}
