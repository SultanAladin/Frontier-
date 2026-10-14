import {
  RW,
  buildEngine,
  gearRatios,
  type CarSpec,
  type EngineBuild,
  type LabSettings,
} from "./cars";
import type { AudioState } from "../audio/AudioEngine";

export interface Inputs {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
  clutch: boolean;
}

export const emptyInputs = (): Inputs => ({
  throttle: false,
  brake: false,
  left: false,
  right: false,
  nitro: false,
  clutch: false,
});

export interface SimEvent {
  name: "pop" | "click" | "flutter" | "shift";
  a: number;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (cur: number, tgt: number, rate: number, dt: number) => {
  const d = tgt - cur;
  const s = rate * dt;
  return Math.abs(d) <= s ? tgt : cur + Math.sign(d) * s;
};

function interp(c: number[][], x: number): number {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) {
      const t = (x - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return lerp(c[i - 1][1], c[i][1], t);
    }
  }
  return c[c.length - 1][1];
}

// Torque shapes as a fraction of peak versus rpm / redline.
const NA_CURVE = [
  [0, 0.55],
  [0.15, 0.62],
  [0.35, 0.78],
  [0.6, 0.95],
  [0.78, 1.0],
  [0.92, 0.96],
  [1.0, 0.88],
  [1.15, 0.5],
];
const TT_BASE = [
  [0, 0.42],
  [0.15, 0.48],
  [0.4, 0.52],
  [0.7, 0.52],
  [1.0, 0.44],
  [1.15, 0.25],
];
const TT_FULL = [
  [0, 0.6],
  [0.12, 0.78],
  [0.25, 0.95],
  [0.45, 1.0],
  [0.7, 1.0],
  [0.9, 0.93],
  [1.0, 0.85],
  [1.15, 0.5],
];

const WK = 6; // clutch slip-speed scale (rad/s)
const ETA = 0.92;

export class CarSim {
  car: CarSpec;
  lab: LabSettings;
  build: EngineBuild;
  ratios: number[];

  // dynamic state
  we: number; // engine speed rad/s
  v = 0; // m/s
  gear = 1; // -1 R, 0 N, 1..N
  auto = false;
  thr = 0;
  brk = 0;
  steer = 0;
  clutchP = 0;
  nitroN = 0;
  nitroTank = 100;
  nitroOn = false;
  turbo = 0;
  loadS = 0;

  // outputs
  rpm = 0;
  speedKmh = 0;
  torqueFrac = 0;
  powerKw = 0;
  limiter = false;
  wheelspin = false;
  clutchEff = 1;
  distance = 0;
  lateral = 0;
  viewCyc = 0;
  cycPerSec = 0;
  msg = "";
  msgT = 0;
  shiftFlash = 0;
  events: SimEvent[] = [];

  private sh = { active: false, t: 0, dur: 0.15, to: 1, from: 1, swapped: false, dir: 1 };
  private limT = 0;
  private prevThr = 0;
  private popWin = 0;
  private popT = 0;
  private autoCool = 0;
  private revHold = 0;
  private cutAudio = 0;
  private gearLoadS = 0;
  private gearEngS = 0;
  private motorA = 0;

  constructor(car: CarSpec, lab: LabSettings) {
    this.car = car;
    this.lab = lab;
    this.build = buildEngine(car, lab);
    this.ratios = gearRatios(car);
    this.we = (car.idle * Math.PI) / 30;
    this.rpm = car.idle;
  }

  applyLab(lab: LabSettings) {
    this.lab = lab;
    this.build = buildEngine(this.car, lab);
  }

  private ev(name: SimEvent["name"], a: number) {
    this.events.push({ name, a });
  }

  private flash(m: string) {
    this.msg = m;
    this.msgT = 1.6;
  }

  private ratioFor(g: number): number {
    if (g === 0) return 0;
    if (g < 0) return -this.ratios[1] * 0.9;
    return this.ratios[g];
  }

  requestShift(dir: number): boolean {
    return this.requestGear(this.gear + dir);
  }

  requestGear(toRaw: number): boolean {
    const car = this.car;
    const to = clamp(toRaw, -1, car.gears);
    if (this.sh.active || to === this.gear) return false;
    if (to === -1 && this.v > 1.5) {
      this.flash("Stop before selecting reverse");
      return false;
    }
    if (to >= 1 && this.v > 0.5) {
      const rpmAfter = ((this.v / RW) * this.ratios[to] * 30) / Math.PI;
      if (rpmAfter > car.redline * 1.04) {
        this.flash("Too fast for that gear");
        return false;
      }
    }
    const dir = to > this.gear ? 1 : -1;
    const race = car.cls !== "ROAD";
    this.sh = {
      active: true,
      t: 0,
      dur: car.shiftTime * (to === 0 || this.gear === 0 ? 0.7 : 1),
      to,
      from: this.gear,
      swapped: false,
      dir,
    };
    if (race) this.ev("shift", 0.6);
    if (dir > 0 && this.gear >= 1) {
      // upshift under load: ignition-cut bang / compressor flutter
      if (this.thr > 0.7 && Math.random() < car.sound.pop) this.ev("pop", 0.55);
      if (this.turbo > 0.6 && car.sound.flutter > 0.3 && Math.random() < 0.6) {
        this.ev("flutter", this.turbo * car.sound.flutter * 0.8);
      }
    }
    return true;
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.flash(this.auto ? "Automatic transmission" : "Manual transmission");
  }

  private engineTorque(rpm: number, thrEff: number): number {
    const car = this.car;
    const x = rpm / car.redline;
    const base = car.boosted
      ? lerp(interp(TT_BASE, x), interp(TT_FULL, x), this.turbo)
      : interp(NA_CURVE, x);
    const afrF = 1 - 0.03 * Math.abs(this.lab.afr - 12.9);
    let T = car.peakNm * this.build.torqueScale * base * thrEff * afrF * (1 + 0.32 * this.lab.shot * this.nitroN);
    if (car.hybrid) {
      T += car.hybrid.nm * thrEff * Math.max(0, 1 - x / car.hybrid.xEnd);
    }
    return T;
  }

  update(dtRaw: number, inp: Inputs) {
    const dt = clamp(dtRaw, 0.001, 0.05);
    const car = this.car;
    const redline = car.redline;
    const rpm0 = (this.we * 30) / Math.PI;
    const x0 = rpm0 / redline;
    const rich = clamp((14.7 - this.lab.afr) / 3.2, -1, 1);

    // ── pedals / steering ──
    this.thr = approach(this.thr, inp.throttle ? 1 : 0, inp.throttle ? 3.4 : 7.5, dt);
    this.brk = approach(this.brk, inp.brake ? 1 : 0, inp.brake ? 5 : 9, dt);
    this.clutchP = approach(this.clutchP, inp.clutch ? 1 : 0, 9, dt);
    const sT = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    this.steer = approach(this.steer, sT, sT === 0 ? 5 : 3, dt);
    this.lateral = clamp(
      this.lateral + this.steer * clamp(Math.abs(this.v) / 25, 0, 1) * dt * 1.3 - this.lateral * 0.12 * dt,
      -1,
      1,
    );

    // ── nitrous ──
    const wantN = inp.nitro && this.nitroTank > 0.5 && this.thr > 0.25;
    if (wantN && !this.nitroOn) {
      this.nitroOn = true;
      this.ev("click", 1);
    } else if (!wantN && this.nitroOn) {
      this.nitroOn = false;
      if (this.nitroN > 0.5) {
        if (Math.random() < 0.5 + car.sound.pop * 0.5) this.ev("pop", 0.7);
        this.flash("Nitrous off");
      }
    }
    if (this.nitroOn) this.nitroTank = Math.max(0, this.nitroTank - 14 * this.lab.shot * dt);
    else if (!inp.nitro) this.nitroTank = Math.min(100, this.nitroTank + 3.5 * dt);
    this.nitroN = approach(this.nitroN, this.nitroOn ? 1 : 0, this.nitroOn ? 7 : 3.5, dt);

    // ── gear shift state machine ──
    const sh = this.sh;
    const race = car.cls !== "ROAD";
    let clutchF = 1;
    let thrMul = 1;
    let blip = 0;
    let shiftCutA = 0;
    if (sh.active) {
      sh.t += dt;
      const p = sh.t / sh.dur;
      if (p >= 0.5 && !sh.swapped) {
        this.gear = sh.to;
        sh.swapped = true;
      }
      clutchF = p < 0.28 ? 1 - p / 0.28 : p < 0.66 ? 0 : Math.min(1, (p - 0.66) / 0.34);
      if (sh.dir > 0 && sh.from >= 1) {
        if (p > 0.1 && p < 0.7) {
          thrMul = 1 - (race ? 1 : 0.8);
          shiftCutA = race ? 0.9 : 0.5;
        }
      } else if (sh.dir < 0 && sh.to >= 1 && p > 0.22 && p < 0.92) {
        const target = ((Math.abs(this.v) / RW) * this.ratios[sh.to] * 30) / Math.PI;
        blip = clamp((target - rpm0) / 1000, 0, 1) * 0.9;
      }
      if (p >= 1) sh.active = false;
    }

    // ── auto transmission ──
    this.autoCool = Math.max(0, this.autoCool - dt);
    if (this.auto && !sh.active && this.autoCool <= 0) {
      const g = this.gear;
      if (g === 0 && this.thr > 0.15) {
        this.requestGear(1);
        this.autoCool = 0.4;
      } else if (g >= 1) {
        const upRpm = redline * (0.62 + 0.32 * this.thr);
        if (g < car.gears && rpm0 > upRpm && this.thr > 0.05) {
          if (this.requestGear(g + 1)) this.autoCool = 0.6;
        } else if (g > 1) {
          const after = rpm0 * (this.ratios[g - 1] / this.ratios[g]);
          const low = redline * 0.3;
          const kick = this.thr > 0.85 && rpm0 < redline * 0.46;
          if ((rpm0 < low || kick) && after < redline * 0.9) {
            if (this.requestGear(g - 1)) this.autoCool = 0.7;
          }
        }
      }
      // hold brake while stopped -> reverse
      if (Math.abs(this.v) < 0.8 && this.brk > 0.6 && this.thr < 0.05) this.revHold += dt;
      else this.revHold = 0;
      if (this.revHold > 0.9 && this.gear >= 0) {
        this.requestGear(-1);
        this.revHold = 0;
        this.autoCool = 0.8;
      }
    }

    // ── rev limiter + effective throttle ──
    let thrEff = this.thr * thrMul;
    thrEff = Math.max(thrEff, blip);
    if (this.limT > 0) this.limT -= dt;
    else if (rpm0 >= redline && thrEff > 0.02) this.limT = race ? 0.06 : 0.085;
    const limActive = this.limT > 0 && thrEff > 0.02;
    if (limActive) thrEff = 0;
    this.limiter = limActive;

    // ── turbo spool ──
    if (car.boosted) {
      const tgt =
        thrEff * smooth01((x0 - 0.1) / 0.28) * (0.55 + 0.45 * smooth01((x0 - 0.2) / 0.5)) +
        0.18 * this.nitroN;
      const tau = tgt > this.turbo ? 0.45 : thrEff < 0.1 ? 0.95 : 0.5;
      this.turbo += (clamp(tgt, 0, 1) - this.turbo) * (1 - Math.exp(-dt / tau));
    } else {
      this.turbo = 0;
    }

    // ── clutch (automatic bite + manual override + shift) ──
    let cF = smooth01((rpm0 - car.idle * 1.08) / (car.idle * 0.5 + 600));
    cF *= 1 - this.clutchP;
    cF *= clutchF;
    if (this.gear === 0) cF = 0;
    this.clutchEff = cF;

    // ── physics sub-steps ──
    const R = this.ratioFor(this.gear);
    const eng = R !== 0;
    const pk = car.peakNm * this.build.torqueScale;
    const hyb = car.hybrid ? car.hybrid.nm : 0;
    const cap = 1.9 * (pk + hyb) * (1 + 0.5 * this.lab.shot * this.nitroN);
    const Ie = car.inertia;
    const mass = car.mass;
    const steps = Math.ceil(dt / 0.0004);
    const h = dt / steps;
    const regen = car.hybrid && this.gear !== 0 ? car.hybrid.regen * this.brk * clamp(Math.abs(this.v) / 6, 0, 1) : 0;
    const wMin = (car.idle * 0.55 * Math.PI) / 30;
    const wMax = (redline * 1.3 * Math.PI) / 30;
    let we = this.we;
    let v = this.v;
    let Tc = 0;
    let spin = false;
    let TeLast = 0;

    for (let i = 0; i < steps; i++) {
      const rpm = (we * 30) / Math.PI;
      const x = rpm / redline;
      const Tth = this.engineTorque(rpm, thrEff);
      const ti = clamp(pk * (0.08 + (car.idle - rpm) * 0.0012), 0, 0.55 * pk);
      const fric = pk * (0.04 + 0.075 * x * x) + pk * 0.09 * (1 - Math.min(1, thrEff)) * (0.3 + x);
      const Te = Math.max(Tth, ti) - fric - regen;
      TeLast = Te;

      Tc = 0;
      if (eng && cF > 0.001) {
        const wc = (v / RW) * R;
        Tc = cap * cF * Math.tanh((we - wc) / WK);
        const Fz = mass * 9.81 + 0.6 * 1.2 * car.clA * v * v;
        // weight transfer under acceleration loads the driven axle (+0.25), sport tyres on road cars (+0.2 mu)
        const muEff = car.mu + (car.cls === "ROAD" ? 0.2 : 0);
        const Tlim = (muEff * Math.min(1, car.driveBias + 0.25) * Fz * RW) / Math.abs(R);
        if (Tc > Tlim) {
          Tc = Tlim;
          if (we - wc > 10) spin = true;
        } else if (Tc < -Tlim) {
          Tc = -Tlim;
        }
      }
      we += ((Te - Tc) / Ie) * h;
      if (we < wMin) we = wMin;
      else if (we > wMax) we = wMax;

      let Fd = 0;
      if (eng) {
        const tr = Tc * R;
        Fd = (tr * (tr > 0 ? ETA : 1 / ETA)) / RW;
      }
      const drag = 0.5 * 1.2 * car.cdA * v * Math.abs(v);
      const roll = 0.015 * mass * 9.81 * Math.tanh(v * 2.5);
      const corner = Math.abs(this.steer) * clamp(Math.abs(v) / 35, 0, 1) * 0.06 * mass * 9.81 * Math.tanh(v * 2);
      const a = (Fd - drag - roll - corner) / mass;
      v += a * h;
      if (this.brk > 0.001) {
        const aB = this.brk * car.brakeG * 9.81 * (1 + (0.3 * car.clA * v * v) / (mass * 9.81 || 1));
        const dv = aB * h;
        if (Math.abs(v) <= dv) v = 0;
        else v -= Math.sign(v) * dv;
      }
    }
    this.we = we;
    this.v = v;
    this.wheelspin = spin;

    // ── derived outputs ──
    this.rpm = (we * 30) / Math.PI;
    this.speedKmh = v * 3.6;
    this.distance += v * dt;
    this.torqueFrac = clamp(TeLast / (pk + hyb), -1, 1.2);
    this.powerKw = Math.max(0, (TeLast * we) / 1000);

    const loadTarget = this.limiter ? this.thr : thrEff;
    this.loadS += (loadTarget - this.loadS) * (1 - Math.exp(-dt / 0.05));

    this.gearLoadS += (clamp(Tc / (pk * 1.2), -1, 1) - this.gearLoadS) * (1 - Math.exp(-dt / 0.08));
    const gEng = eng && !sh.active ? cF : 0;
    this.gearEngS += (gEng - this.gearEngS) * (1 - Math.exp(-dt / 0.08));
    if (car.hybrid) {
      const xx = this.rpm / redline;
      const drive = thrEff * Math.max(0, 1 - xx / car.hybrid.xEnd);
      const reg = this.brk * (Math.abs(v) > 3 ? 0.7 : 0);
      this.motorA += (drive - reg - this.motorA) * (1 - Math.exp(-dt / 0.06));
    } else if (car.ev) {
      // EV "motor activity" for the audio layer: drive torque, regen negative
      const drive = thrEff;
      const reg = this.brk * (Math.abs(v) > 3 ? 0.8 : 0);
      this.motorA += (drive - reg - this.motorA) * (1 - Math.exp(-dt / 0.06));
    } else {
      this.motorA = 0;
    }

    // audio limiter / shift cut amount
    const limA = this.limiter ? (car.cls === "ROAD" ? 0.55 : 0.9) : 0;
    this.cutAudio = Math.max(limA, shiftCutA);

    // ── lift-off: flutter + overrun pops ──
    if (this.prevThr > 0.55 && this.thr < 0.2 && this.rpm > redline * 0.4) {
      this.popWin = 0.8 + 1.6 * car.sound.pop + 0.8 * Math.max(0, rich);
      if (this.turbo > 0.45 && car.sound.turbo > 0 && car.sound.flutter > 0.1) {
        this.ev("flutter", this.turbo * car.sound.flutter);
      }
    }
    this.prevThr = this.thr;
    if (this.popWin > 0) {
      this.popWin -= dt;
      const pr = car.sound.pop + 0.5 * Math.max(rich, 0) - 0.4 * Math.max(-rich, 0);
      if (this.thr < 0.12 && this.rpm > redline * 0.3 && pr > 0.15) {
        this.popT -= dt;
        if (this.popT <= 0) {
          this.ev("pop", (0.25 + 0.75 * Math.random()) * Math.min(1, pr + 0.2));
          this.popT = 0.045 + (Math.random() * 0.2) / (0.5 + pr);
        }
      }
    }

    // ── engine-cycle visual clock (slow-motion) ──
    this.cycPerSec = this.rpm / 60 / (this.build.strokes / 2);
    this.viewCyc = (this.viewCyc + (this.cycPerSec * dt) / 55) % 1;

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msg = "";
    }
    if (this.shiftFlash > 0) this.shiftFlash -= dt;
  }

  audio(): AudioState {
    return {
      rpm: clamp(this.rpm, 300, this.car.redline * 1.15),
      load: clamp(this.loadS, 0, 1),
      nitro: this.nitroN * clamp(0.55 + 0.45 * this.lab.shot, 0.5, 1.3),
      cut: this.cutAudio,
      boost: this.turbo,
      motor: clamp(this.motorA, -1, 1),
      gearLoad: this.gearLoadS,
      gearEng: this.gearEngS,
      speed: Math.abs(this.v) * 3.6,
      rich: clamp((14.7 - this.lab.afr) / 3.2, -1, 1),
    };
  }

  get gearLabel(): string {
    return this.gear === -1 ? "R" : this.gear === 0 ? "N" : String(this.gear);
  }

  get shifting(): boolean {
    return this.sh.active;
  }
}
