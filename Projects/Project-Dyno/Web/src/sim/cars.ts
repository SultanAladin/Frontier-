// Car catalogue + engine layout / sound-profile builders.
// Everything the audio engine needs (cylinders, firing pattern, stroke cycle,
// exhaust resonances ...) is derived from these definitions.

import { DEFAULT_VOICE, VOICES, type VoiceProfile } from "./voices";

export type CarClass = "ROAD" | "GT3" | "LMGTE";
export type Crank = "even" | "cross";

export const RW = 0.34; // effective wheel radius (m)

export interface SoundProfile {
  alpha: number; // pulse spectral slope (1 = saw-like, lower = brighter)
  fcLow: number; // exhaust low-pass (Hz) at closed throttle
  fcHigh: number; // exhaust low-pass (Hz) at wide-open throttle
  res: [number, number, number][]; // exhaust formants [Hz, gain, log-width]
  intake: [number, number, number]; // induction resonance [Hz, gain, log-width]
  bankGain: number; // bank B level relative to bank A
  bankDelay: number; // bank B header delay (ms)
  lope: number; // idle lope / cylinder-to-cylinder drift
  rough: number; // static cylinder variance
  drive: number; // saturation drive
  turbo: number; // turbo whistle amount
  twin: boolean;
  flutter: number; // compressor flutter on lift-off
  motor: number; // electric motor whine
  gear: number; // gearbox whine
  pop: number; // overrun / shift pops
  body: number; // low-shelf body (dB)
}

export interface CarSpec {
  id: string;
  name: string;
  maker: string;
  cls: CarClass;
  year: string;
  accent: string;
  tagline: string;
  code: string;
  layoutText: string;
  displacement: string;
  aspiration: string;
  cyl: number;
  banks: 1 | 2;
  crank: Crank;
  redline: number;
  idle: number;
  peakKw: number;
  peakNm: number;
  boosted: boolean;
  mass: number;
  cdA: number;
  clA: number;
  mu: number;
  driveBias: number;
  brakeG: number;
  gears: number;
  v1: number; // km/h at redline in 1st
  vN: number; // km/h at redline in top gear
  shiftTime: number;
  trans: string;
  inertia: number;
  ev?: boolean; // pure electric (Taycan) — no combustion model at all
  hybrid?: { nm: number; xEnd: number; regen: number; kw: number };
  sound: SoundProfile;
}

export interface LabSettings {
  cylinders: number | null; // null = stock
  strokes: 2 | 4;
  crank: Crank | null; // only used for 8-cylinder layouts
  afr: number; // petrol air/fuel ratio
  shot: number; // nitrous shot size multiplier (0.5 / 1 / 1.5)
}

export const DEFAULT_LAB: LabSettings = {
  cylinders: null,
  strokes: 4,
  crank: null,
  afr: 13.0,
  shot: 1,
};

export interface Firing {
  frac: number[];
  bank: number[];
}

export function buildFiring(cyl: number, banks: 1 | 2, crank: Crank): Firing {
  const frac: number[] = [];
  const bank: number[] = [];
  if (crank === "cross" && cyl === 8 && banks === 2) {
    // classic cross-plane V8 firing sequence L R R L R L L R
    const p = [0, 1, 1, 0, 1, 0, 0, 1];
    for (let i = 0; i < 8; i++) {
      frac.push(i / 8);
      bank.push(p[i]);
    }
  } else {
    for (let i = 0; i < cyl; i++) {
      frac.push(i / cyl);
      bank.push(banks === 2 ? i % 2 : 0);
    }
  }
  return { frac, bank };
}

export interface VoiceCfg extends VoiceProfile {
  ampS: number[]; // static per-cylinder level
  timS: number[]; // static per-cylinder timing error (crank degrees)
}

export type SynthMode = "additive" | "pulse" | "ev";

export interface EngineCfg {
  mode: SynthMode;
  v: VoiceCfg;
  pop: number;
  strokes: number;
  frac: number[];
  bank: number[];
  cylGain: number[];
  bankGain: number;
  bankDelay: number;
  panL: number[];
  panR: number[];
  alpha: number;
  fcLow: number;
  fcHigh: number;
  res: [number, number, number][];
  intake: [number, number, number];
  lope: number;
  turbo: number;
  twin: boolean;
  motor: number;
  gear: number;
  redline: number;
  idle: number;
  // exhaust routing / individual cylinder colour
  route: number[]; // collector (scroll) group per cylinder
  grpBank: number[]; // bank per group
  nG: number; // number of exhaust groups
  runD: number[]; // exhaust runner flight time per cylinder (s)
  inD: number[]; // intake runner flight time per cylinder (s)
  durM: number[]; // per-cylinder blow-down pulse width multiplier
  decM: number[]; // per-cylinder blow-down tail steepness multiplier
  atkM: number[]; // per-cylinder attack hardness multiplier
}

export interface EngineBuild {
  mode: SynthMode;
  cyl: number;
  strokes: 2 | 4;
  crank: Crank;
  banks: 1 | 2;
  firing: Firing;
  cfg: EngineCfg;
  drive: number;
  body: number;
  torqueScale: number;
}

// deterministic per-index spread in [-1, 1]
function spread(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function buildEngine(car: CarSpec, lab: LabSettings): EngineBuild {
  const cyl = lab.cylinders ?? car.cyl;
  const banks = car.banks;
  const crank: Crank = cyl === 8 && banks === 2 ? (lab.crank ?? car.crank) : "even";
  const firing = buildFiring(cyl, banks, crank);
  const p = car.sound;

  let bg = p.bankGain;
  let bd = p.bankDelay;
  if (cyl === 8 && banks === 2) {
    if (crank === "cross") {
      bd = Math.max(bd, 0.3);
      bg = Math.min(bg, 0.78);
    } else {
      bd = Math.min(bd, 0.07);
      bg = Math.max(bg, 0.93);
    }
  }

  const cylGain: number[] = [];
  for (let i = 0; i < cyl; i++) {
    cylGain.push(1 + p.rough * Math.sin(i * 2.399 + 0.6));
  }

  // Uneven-firing (cross-plane) engines keep the original harmonic model;
  // every even-firing engine uses the exhaust-pulse model; EVs use the
  // electric model from EngineAudioSim main.
  const mode: SynthMode = car.ev ? "ev" : crank === "cross" ? "additive" : "pulse";
  const voice = VOICES[car.id] ?? DEFAULT_VOICE;
  const ampS: number[] = [];
  const timS: number[] = [];
  for (let i = 0; i < cyl; i++) {
    ampS.push(Math.min(1.5, Math.max(0.5, 1 + voice.rough * 1.7 * spread(i, 1))));
    timS.push(voice.skew * 1.7 * spread(i, 2));
  }

  // ── exhaust routing ──────────────────────────────────────────────────
  // One collector per bank. Turbo engines (and single-bank engines) are split
  // into two scrolls: cylinders are paired 1-3 / 2-4 within a bank, which is
  // exactly how a twin-scroll header is piped - the pulses that arrive closest
  // together go down separate scrolls, and the two scrolls recombine at the
  // turbine with their own comb filter.
  const perBank = car.boosted || banks === 1 ? 2 : 1;
  const seen = [0, 0];
  const route: number[] = [];
  for (let i = 0; i < cyl; i++) {
    const b = firing.bank[i];
    const sub = perBank > 1 ? seen[b]++ % 2 : 0;
    route.push(b * perBank + sub);
  }
  const nG = banks === 1 ? perBank : banks * perBank;
  const grpBank: number[] = [];
  for (let g = 0; g < nG; g++) grpBank.push(Math.floor(g / perBank));

  // ── individual cylinder colour ───────────────────────────────────────
  // Every cylinder has its own runner length (exhaust and intake) and its own
  // port radius, so its pulse leaves later / earlier, quieter / louder, and
  // with a harder or softer attack than its neighbours.
  const runD: number[] = [];
  const inD: number[] = [];
  const atkM: number[] = [];
  const durM: number[] = [];
  const decM: number[] = [];
  for (let i = 0; i < cyl; i++) {
    const sub = route[i] % perBank;
    const gm = sub === 0 ? 1 : 1.22; // the second scroll is routed a little longer
    // runner flight time in SECONDS. The worklet converts it to crank degrees
    // with the live rpm (deg = t * rpm * 6), so an unequal header makes the
    // pulses arrive unevenly - more so the faster the engine spins.
    runD.push((voice.runnerMs * gm * (1 + voice.runnerSpread * spread(i, 5))) / 1000);
    inD.push((voice.intakeMs * (1 + voice.intakeSpread * spread(i, 7))) / 1000);
    durM.push(Math.min(1.6, Math.max(0.6, 1 + voice.cylDurSpread * spread(i, 13))));
    decM.push(Math.min(1.6, Math.max(0.6, 1 + voice.cylDecSpread * spread(i, 17))));
    atkM.push(Math.min(2, Math.max(0.45, 1 + voice.atkSpread * spread(i, 11))));
  }

  const cfg: EngineCfg = {
    mode,
    v: { ...voice, ampS, timS },
    pop: p.pop,
    strokes: lab.strokes,
    frac: firing.frac,
    bank: firing.bank,
    cylGain,
    bankGain: bg,
    bankDelay: bd,
    panL: banks === 2 ? [1, 0.5] : [0.8, 0.8],
    panR: banks === 2 ? [0.5, 1] : [0.8, 0.8],
    alpha: p.alpha,
    fcLow: p.fcLow,
    fcHigh: p.fcHigh,
    res: p.res,
    intake: p.intake,
    lope: p.lope,
    turbo: p.turbo,
    twin: p.twin,
    motor: p.motor,
    gear: p.gear,
    redline: car.redline,
    idle: car.idle,
    route,
    grpBank,
    nG,
    runD,
    inD,
    durM,
    decM,
    atkM,
  };

  const torqueScale = (cyl / car.cyl) * (lab.strokes === 2 ? 1.5 : 1);

  return {
    mode,
    cyl,
    strokes: lab.strokes,
    crank,
    banks,
    firing,
    cfg,
    drive: mode === "pulse" ? voice.drive : p.drive,
    body: p.body,
    torqueScale,
  };
}

// Human-readable exhaust description for the spec panel.
export function headerText(car: CarSpec, build: EngineBuild): string {
  if (build.mode !== "pulse") return "Cross-plane 4-into-1, unequal primaries";
  if (build.banks === 1)
    return car.boosted ? "Twin-scroll 6-into-2, long primaries" : "Twin primary 6-into-2 (1-3 / 4-6)";
  if (car.boosted) return "Twin-scroll 3-into-1, split per bank";
  switch (build.cyl) {
    case 12:
      return "Equal-length 6-into-1";
    case 10:
      return "Equal-length 5-into-1";
    case 8:
      return "Equal-length 4-into-1";
    case 6:
      return "3-into-1, unequal primaries";
    default:
      return "4-into-1";
  }
}

// Total ratio (engine rev per wheel rev) per gear, index 1..N (0 unused).
export function gearRatios(car: CarSpec): number[] {
  const wRed = (car.redline * 2 * Math.PI) / 60;
  const out: number[] = [0];
  for (let g = 1; g <= car.gears; g++) {
    const t = car.gears === 1 ? 0 : (g - 1) / (car.gears - 1);
    const vg = car.v1 * Math.pow(car.vN / car.v1, t);
    out.push((wRed * RW) / (vg / 3.6));
  }
  return out;
}

export const CARS: CarSpec[] = [
  // ───────────────────────── ROAD / HYPERCAR ─────────────────────────
  {
    id: "gtr-nismo",
    name: "GT-R NISMO",
    maker: "Nissan",
    cls: "ROAD",
    year: "R35",
    accent: "#ff2d3d",
    tagline: "Hand-built twin-turbo V6, dual-clutch AWD brawler",
    code: "VR38DETT",
    layoutText: "90° V6",
    displacement: "3.8 L",
    aspiration: "Twin-turbo",
    cyl: 6,
    banks: 2,
    crank: "even",
    redline: 7100,
    idle: 800,
    peakKw: 441,
    peakNm: 652,
    boosted: true,
    mass: 1720,
    cdA: 0.72,
    clA: 0.1,
    mu: 1.15,
    driveBias: 1.0,
    brakeG: 1.15,
    gears: 6,
    v1: 61,
    vN: 309,
    shiftTime: 0.16,
    trans: "6-speed dual-clutch",
    inertia: 0.28,
    sound: {
      alpha: 1.05,
      fcLow: 650,
      fcHigh: 3000,
      res: [
        [95, 1.4, 0.22],
        [190, 1.0, 0.25],
        [430, 0.8, 0.3],
        [1100, 0.6, 0.35],
      ],
      intake: [260, 0.5, 0.3],
      bankGain: 0.86,
      bankDelay: 0.22,
      lope: 0.1,
      rough: 0.04,
      drive: 1.7,
      turbo: 0.9,
      twin: true,
      flutter: 0.7,
      motor: 0,
      gear: 0.3,
      pop: 0.45,
      body: 4,
    },
  },
  {
    id: "918",
    name: "918 Spyder",
    maker: "Porsche",
    cls: "ROAD",
    year: "2013",
    accent: "#a6ff00",
    tagline: "RS Spyder-derived flat-plane V8 plus two electric motors",
    code: "MR.6 + 2 e-motors",
    layoutText: "90° V8 flat-plane",
    displacement: "4.6 L",
    aspiration: "NA + hybrid",
    cyl: 8,
    banks: 2,
    crank: "even",
    redline: 9150,
    idle: 900,
    peakKw: 447,
    peakNm: 540,
    boosted: false,
    mass: 1675,
    cdA: 0.68,
    clA: 0.25,
    mu: 1.2,
    driveBias: 1.0,
    brakeG: 1.2,
    gears: 7,
    v1: 64,
    vN: 355,
    shiftTime: 0.12,
    trans: "7-speed PDK",
    inertia: 0.22,
    hybrid: { nm: 420, xEnd: 0.62, regen: 160, kw: 210 },
    sound: {
      alpha: 0.9,
      fcLow: 900,
      fcHigh: 6500,
      res: [
        [150, 1.0, 0.25],
        [480, 0.7, 0.3],
        [1400, 1.0, 0.28],
        [3000, 1.1, 0.3],
      ],
      intake: [350, 0.6, 0.3],
      bankGain: 0.93,
      bankDelay: 0.06,
      lope: 0.03,
      rough: 0.02,
      drive: 1.4,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 1.0,
      gear: 0.25,
      pop: 0.25,
      body: 2,
    },
  },
  {
    id: "laferrari",
    name: "LaFerrari",
    maker: "Ferrari",
    cls: "ROAD",
    year: "2013",
    accent: "#ff3b1f",
    tagline: "9,250 rpm naturally-aspirated V12 with HY-KERS boost",
    code: "F140 FE + HY-KERS",
    layoutText: "65° V12",
    displacement: "6.3 L",
    aspiration: "NA + hybrid",
    cyl: 12,
    banks: 2,
    crank: "even",
    redline: 9250,
    idle: 1000,
    peakKw: 588,
    peakNm: 700,
    boosted: false,
    mass: 1400,
    cdA: 0.72,
    clA: 0.3,
    mu: 1.25,
    driveBias: 0.62,
    brakeG: 1.3,
    gears: 7,
    v1: 70,
    vN: 352,
    shiftTime: 0.1,
    trans: "7-speed dual-clutch",
    inertia: 0.2,
    hybrid: { nm: 180, xEnd: 0.55, regen: 120, kw: 120 },
    sound: {
      alpha: 0.8,
      fcLow: 1100,
      fcHigh: 8000,
      res: [
        [210, 0.9, 0.2],
        [800, 1.0, 0.28],
        [1700, 1.3, 0.25],
        [3300, 1.2, 0.3],
      ],
      intake: [420, 0.4, 0.3],
      bankGain: 0.97,
      bankDelay: 0.03,
      lope: 0.02,
      rough: 0.015,
      drive: 1.2,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0.6,
      gear: 0.15,
      pop: 0.3,
      body: 1,
    },
  },

  {
    id: "vulcan",
    name: "Vulcan",
    maker: "Aston Martin",
    cls: "ROAD",
    year: "2015",
    accent: "#7ee787",
    tagline: "Track-only 7.0 V12, 820 hp, virtually straight pipes — silk turned savage",
    code: "AM V12 7.0",
    layoutText: "60° V12",
    displacement: "7.0 L",
    aspiration: "Naturally aspirated",
    cyl: 12,
    banks: 2,
    crank: "even",
    redline: 8000,
    idle: 1100,
    peakKw: 611,
    peakNm: 780,
    boosted: false,
    mass: 1350,
    cdA: 0.85,
    clA: 0.9,
    mu: 1.35,
    driveBias: 0.62,
    brakeG: 1.4,
    gears: 6,
    v1: 68,
    vN: 322,
    shiftTime: 0.09,
    trans: "6-speed sequential",
    inertia: 0.2,
    sound: {
      alpha: 0.82,
      fcLow: 1200,
      fcHigh: 8200,
      res: [
        [230, 0.9, 0.2],
        [860, 1.05, 0.28],
        [1800, 1.3, 0.25],
        [3500, 1.2, 0.3],
      ],
      intake: [430, 0.45, 0.3],
      bankGain: 0.96,
      bankDelay: 0.04,
      lope: 0.03,
      rough: 0.02,
      drive: 1.35,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.35,
      pop: 0.5,
      body: 2,
    },
  },
  {
    id: "viper",
    name: "Viper ACR",
    maker: "Dodge",
    cls: "ROAD",
    year: "2016",
    accent: "#ff9046",
    tagline: "8.4-litre V10 with side pipes — the deepest thump in the garage",
    code: "Viper V10 8.4",
    layoutText: "90° V10",
    displacement: "8.4 L",
    aspiration: "Naturally aspirated",
    cyl: 10,
    banks: 2,
    crank: "even",
    redline: 6200,
    idle: 750,
    peakKw: 481,
    peakNm: 813,
    boosted: false,
    mass: 1540,
    cdA: 0.78,
    clA: 0.6,
    mu: 1.25,
    driveBias: 0.6,
    brakeG: 1.25,
    gears: 6,
    v1: 66,
    vN: 285,
    shiftTime: 0.18,
    trans: "6-speed manual",
    inertia: 0.3,
    sound: {
      alpha: 1.05,
      fcLow: 620,
      fcHigh: 3400,
      res: [
        [80, 1.5, 0.2],
        [165, 1.1, 0.25],
        [360, 0.8, 0.3],
      ],
      intake: [200, 0.5, 0.3],
      bankGain: 0.84,
      bankDelay: 0.2,
      lope: 0.14,
      rough: 0.05,
      drive: 1.8,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.3,
      pop: 0.5,
      body: 5,
    },
  },
  {
    id: "demon",
    name: "Challenger SRT Demon",
    maker: "Dodge",
    cls: "ROAD",
    year: "2018",
    accent: "#c084fc",
    tagline: "Supercharged 6.2 cross-plane V8 — blower whine over thunder",
    code: "HEMI 6.2 SC",
    layoutText: "90° V8 cross-plane",
    displacement: "6.2 L",
    aspiration: "Supercharged",
    cyl: 8,
    banks: 2,
    crank: "cross",
    redline: 6500,
    idle: 800,
    peakKw: 626,
    peakNm: 1044,
    boosted: false,
    mass: 1930,
    cdA: 0.85,
    clA: 0.05,
    mu: 1.1,
    driveBias: 0.6,
    brakeG: 1.05,
    gears: 8,
    v1: 58,
    vN: 327,
    shiftTime: 0.16,
    trans: "8-speed automatic",
    inertia: 0.3,
    sound: {
      alpha: 1.02,
      fcLow: 700,
      fcHigh: 4200,
      res: [
        [80, 1.5, 0.2],
        [165, 1.2, 0.22],
        [340, 0.9, 0.28],
        [880, 0.95, 0.3],
      ],
      intake: [205, 0.9, 0.3],
      bankGain: 0.8,
      bankDelay: 0.3,
      lope: 0.13,
      rough: 0.05,
      drive: 2.0,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.35,
      pop: 0.65,
      body: 5,
    },
  },
  {
    id: "agera",
    name: "Agera RS",
    maker: "Koenigsegg",
    cls: "ROAD",
    year: "2015",
    accent: "#f5c542",
    tagline: "5.0 flat-plane twin-turbo V8, hard edge through the turbines",
    code: "Koenigsegg 5.0 TT",
    layoutText: "90° V8 flat-plane",
    displacement: "5.0 L",
    aspiration: "Twin-turbo",
    cyl: 8,
    banks: 2,
    crank: "even",
    redline: 8250,
    idle: 800,
    peakKw: 865,
    peakNm: 1280,
    boosted: true,
    mass: 1395,
    cdA: 0.66,
    clA: 0.35,
    mu: 1.3,
    driveBias: 0.62,
    brakeG: 1.3,
    gears: 7,
    v1: 72,
    vN: 403,
    shiftTime: 0.11,
    trans: "7-speed dual-clutch",
    inertia: 0.22,
    sound: {
      alpha: 0.95,
      fcLow: 850,
      fcHigh: 4600,
      res: [
        [120, 1.15, 0.22],
        [330, 0.95, 0.28],
        [820, 1.15, 0.26],
        [1900, 1.0, 0.3],
      ],
      intake: [300, 0.5, 0.3],
      bankGain: 0.92,
      bankDelay: 0.08,
      lope: 0.07,
      rough: 0.03,
      drive: 1.65,
      turbo: 0.85,
      twin: true,
      flutter: 0.65,
      motor: 0,
      gear: 0.3,
      pop: 0.55,
      body: 3,
    },
  },
  {
    id: "taycan",
    name: "Taycan Turbo S",
    maker: "Porsche",
    cls: "ROAD",
    year: "2020",
    accent: "#6ea8ff",
    tagline: "Twin e-motors + 2-speed rear axle — the main branch's EV synthesis",
    code: "2× PSM e-motors",
    layoutText: "Electric",
    displacement: "—",
    aspiration: "Electric",
    cyl: 2,
    banks: 1,
    crank: "even",
    redline: 16000,
    idle: 0,
    peakKw: 560,
    peakNm: 1050,
    boosted: false,
    mass: 2295,
    cdA: 0.55,
    clA: 0.05,
    mu: 1.2,
    driveBias: 1.0,
    brakeG: 1.15,
    gears: 2,
    v1: 105,
    vN: 260,
    shiftTime: 0.25,
    trans: "2-speed (rear) + 1-speed",
    inertia: 0.35,
    ev: true,
    sound: {
      alpha: 1,
      fcLow: 800,
      fcHigh: 4000,
      res: [[300, 0.5, 0.3]],
      intake: [300, 0.2, 0.3],
      bankGain: 1,
      bankDelay: 0,
      lope: 0,
      rough: 0,
      drive: 1.2,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 1.0,
      gear: 0.5,
      pop: 0,
      body: 1,
    },
  },

  // ───────────────────────── GT3 ─────────────────────────
  {
    id: "911-gt3r",
    name: "911 GT3 R",
    maker: "Porsche",
    cls: "GT3",
    year: "992",
    accent: "#ffd400",
    tagline: "Rear-mounted 4.2 flat-six, screaming to 9,000",
    code: "4.2 Boxer-6",
    layoutText: "180° flat-6",
    displacement: "4.2 L",
    aspiration: "Naturally aspirated",
    cyl: 6,
    banks: 2,
    crank: "even",
    redline: 9000,
    idle: 1100,
    peakKw: 410,
    peakNm: 470,
    boosted: false,
    mass: 1260,
    cdA: 0.95,
    clA: 1.5,
    mu: 1.6,
    driveBias: 0.6,
    brakeG: 1.9,
    gears: 6,
    v1: 74,
    vN: 292,
    shiftTime: 0.07,
    trans: "6-speed sequential",
    inertia: 0.16,
    sound: {
      alpha: 0.95,
      fcLow: 1000,
      fcHigh: 7000,
      res: [
        [130, 0.9, 0.25],
        [390, 0.8, 0.28],
        [1050, 1.2, 0.25],
        [2400, 1.0, 0.3],
      ],
      intake: [300, 0.9, 0.3],
      bankGain: 0.9,
      bankDelay: 0.1,
      lope: 0.06,
      rough: 0.03,
      drive: 1.5,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.55,
      pop: 0.35,
      body: 2,
    },
  },
  {
    id: "huracan-gt3",
    name: "Huracán GT3 Evo2",
    maker: "Lamborghini",
    cls: "GT3",
    year: "2022",
    accent: "#9dff00",
    tagline: "Naturally-aspirated 5.2 V10 with a banshee top end",
    code: "DGF V10",
    layoutText: "72° V10",
    displacement: "5.2 L",
    aspiration: "Naturally aspirated",
    cyl: 10,
    banks: 2,
    crank: "even",
    redline: 8500,
    idle: 1100,
    peakKw: 400,
    peakNm: 500,
    boosted: false,
    mass: 1280,
    cdA: 0.98,
    clA: 1.5,
    mu: 1.6,
    driveBias: 0.6,
    brakeG: 1.9,
    gears: 6,
    v1: 76,
    vN: 295,
    shiftTime: 0.08,
    trans: "6-speed sequential",
    inertia: 0.17,
    sound: {
      alpha: 0.92,
      fcLow: 1000,
      fcHigh: 7500,
      res: [
        [160, 1.0, 0.22],
        [500, 0.8, 0.3],
        [1250, 1.3, 0.25],
        [2600, 1.1, 0.28],
      ],
      intake: [340, 0.9, 0.3],
      bankGain: 0.94,
      bankDelay: 0.07,
      lope: 0.05,
      rough: 0.03,
      drive: 1.6,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.5,
      pop: 0.45,
      body: 2,
    },
  },
  {
    id: "amg-gt3",
    name: "AMG GT3",
    maker: "Mercedes-AMG",
    cls: "GT3",
    year: "Evo",
    accent: "#37e6d2",
    tagline: "6.2 cross-plane V8 — the thunder of Affalterbach",
    code: "M159",
    layoutText: "90° V8 cross-plane",
    displacement: "6.2 L",
    aspiration: "Naturally aspirated",
    cyl: 8,
    banks: 2,
    crank: "cross",
    redline: 7500,
    idle: 1000,
    peakKw: 400,
    peakNm: 620,
    boosted: false,
    mass: 1285,
    cdA: 0.98,
    clA: 1.45,
    mu: 1.6,
    driveBias: 0.6,
    brakeG: 1.9,
    gears: 6,
    v1: 72,
    vN: 292,
    shiftTime: 0.08,
    trans: "6-speed sequential",
    inertia: 0.2,
    sound: {
      alpha: 1.0,
      fcLow: 800,
      fcHigh: 4800,
      res: [
        [85, 1.5, 0.2],
        [170, 1.2, 0.22],
        [340, 0.9, 0.28],
        [900, 1.0, 0.3],
      ],
      intake: [200, 1.0, 0.3],
      bankGain: 0.78,
      bankDelay: 0.32,
      lope: 0.12,
      rough: 0.05,
      drive: 1.9,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.45,
      pop: 0.6,
      body: 4,
    },
  },
  {
    id: "gtr-gt3",
    name: "GT-R NISMO GT3",
    maker: "Nissan",
    cls: "GT3",
    year: "2018",
    accent: "#ff5a1f",
    tagline: "Race-bred VR38 with open turbo plumbing",
    code: "VR38DETT-R",
    layoutText: "90° V6",
    displacement: "3.8 L",
    aspiration: "Twin-turbo",
    cyl: 6,
    banks: 2,
    crank: "even",
    redline: 7600,
    idle: 1000,
    peakKw: 405,
    peakNm: 620,
    boosted: true,
    mass: 1305,
    cdA: 1.0,
    clA: 1.5,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 72,
    vN: 290,
    shiftTime: 0.08,
    trans: "6-speed sequential",
    inertia: 0.2,
    sound: {
      alpha: 1.0,
      fcLow: 800,
      fcHigh: 3600,
      res: [
        [100, 1.3, 0.22],
        [210, 1.0, 0.25],
        [480, 0.9, 0.3],
        [1200, 0.7, 0.35],
      ],
      intake: [280, 0.5, 0.3],
      bankGain: 0.84,
      bankDelay: 0.24,
      lope: 0.12,
      rough: 0.05,
      drive: 1.9,
      turbo: 0.8,
      twin: true,
      flutter: 0.5,
      motor: 0,
      gear: 0.6,
      pop: 0.6,
      body: 3,
    },
  },
  {
    id: "296-gt3",
    name: "296 GT3",
    maker: "Ferrari",
    cls: "GT3",
    year: "2023",
    accent: "#ff1e2d",
    tagline: "120° twin-turbo V6, a very high-pitched bark",
    code: "F163 120° V6",
    layoutText: "120° V6",
    displacement: "3.0 L",
    aspiration: "Twin-turbo",
    cyl: 6,
    banks: 2,
    crank: "even",
    redline: 8400,
    idle: 1100,
    peakKw: 410,
    peakNm: 600,
    boosted: true,
    mass: 1270,
    cdA: 0.98,
    clA: 1.5,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 76,
    vN: 294,
    shiftTime: 0.07,
    trans: "6-speed sequential",
    inertia: 0.17,
    sound: {
      alpha: 0.95,
      fcLow: 950,
      fcHigh: 4500,
      res: [
        [140, 1.1, 0.22],
        [380, 0.9, 0.28],
        [900, 1.1, 0.28],
        [2100, 0.9, 0.3],
      ],
      intake: [330, 0.5, 0.3],
      bankGain: 0.9,
      bankDelay: 0.12,
      lope: 0.07,
      rough: 0.03,
      drive: 1.7,
      turbo: 0.7,
      twin: true,
      flutter: 0.45,
      motor: 0,
      gear: 0.55,
      pop: 0.5,
      body: 2,
    },
  },
  {
    id: "m4-gt3",
    name: "M4 GT3",
    maker: "BMW M",
    cls: "GT3",
    year: "G82",
    accent: "#3d8bff",
    tagline: "Turbocharged straight-six, smooth and menacing",
    code: "S58",
    layoutText: "Inline-6",
    displacement: "3.0 L",
    aspiration: "Twin-turbo",
    cyl: 6,
    banks: 1,
    crank: "even",
    redline: 7200,
    idle: 1000,
    peakKw: 410,
    peakNm: 700,
    boosted: true,
    mass: 1310,
    cdA: 1.0,
    clA: 1.45,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 70,
    vN: 290,
    shiftTime: 0.08,
    trans: "6-speed sequential",
    inertia: 0.2,
    sound: {
      alpha: 1.1,
      fcLow: 700,
      fcHigh: 3200,
      res: [
        [120, 1.2, 0.22],
        [360, 1.0, 0.25],
        [900, 0.9, 0.3],
      ],
      intake: [240, 0.5, 0.3],
      bankGain: 1,
      bankDelay: 0,
      lope: 0.06,
      rough: 0.03,
      drive: 1.7,
      turbo: 0.8,
      twin: false,
      flutter: 0.6,
      motor: 0,
      gear: 0.5,
      pop: 0.5,
      body: 3,
    },
  },

  // ───────────────────────── LMGTE ─────────────────────────
  {
    id: "488-gte",
    name: "488 GTE Evo",
    maker: "Ferrari",
    cls: "LMGTE",
    year: "2019",
    accent: "#ff2a2a",
    tagline: "Flat-plane turbo V8 — Le Mans class winner",
    code: "F154 CD",
    layoutText: "90° V8 flat-plane",
    displacement: "3.9 L",
    aspiration: "Twin-turbo",
    cyl: 8,
    banks: 2,
    crank: "even",
    redline: 7800,
    idle: 1100,
    peakKw: 385,
    peakNm: 700,
    boosted: true,
    mass: 1245,
    cdA: 0.95,
    clA: 1.4,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 74,
    vN: 300,
    shiftTime: 0.07,
    trans: "6-speed sequential",
    inertia: 0.18,
    sound: {
      alpha: 0.95,
      fcLow: 900,
      fcHigh: 4200,
      res: [
        [130, 1.1, 0.22],
        [400, 0.9, 0.28],
        [1000, 1.2, 0.26],
        [2300, 1.0, 0.3],
      ],
      intake: [330, 0.5, 0.3],
      bankGain: 0.93,
      bankDelay: 0.07,
      lope: 0.06,
      rough: 0.03,
      drive: 1.7,
      turbo: 0.7,
      twin: true,
      flutter: 0.5,
      motor: 0,
      gear: 0.6,
      pop: 0.55,
      body: 2,
    },
  },
  {
    id: "911-rsr",
    name: "911 RSR-19",
    maker: "Porsche",
    cls: "LMGTE",
    year: "2019",
    accent: "#ffffff",
    tagline: "Mid-engine flat-six that sings past 9,000 rpm",
    code: "4.2 Boxer-6",
    layoutText: "180° flat-6",
    displacement: "4.2 L",
    aspiration: "Naturally aspirated",
    cyl: 6,
    banks: 2,
    crank: "even",
    redline: 9300,
    idle: 1200,
    peakKw: 375,
    peakNm: 460,
    boosted: false,
    mass: 1245,
    cdA: 0.95,
    clA: 1.4,
    mu: 1.6,
    driveBias: 0.6,
    brakeG: 1.9,
    gears: 6,
    v1: 78,
    vN: 300,
    shiftTime: 0.065,
    trans: "6-speed sequential",
    inertia: 0.15,
    sound: {
      alpha: 0.88,
      fcLow: 1100,
      fcHigh: 8500,
      res: [
        [170, 0.8, 0.25],
        [560, 0.9, 0.28],
        [1500, 1.4, 0.25],
        [3200, 1.2, 0.3],
      ],
      intake: [420, 1.0, 0.3],
      bankGain: 0.92,
      bankDelay: 0.08,
      lope: 0.04,
      rough: 0.025,
      drive: 1.5,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.6,
      pop: 0.3,
      body: 1,
    },
  },
  {
    id: "c8r",
    name: "Corvette C8.R",
    maker: "Chevrolet",
    cls: "LMGTE",
    year: "2020",
    accent: "#ffcc00",
    tagline: "5.5 flat-plane V8 with a deep American bark",
    code: "LT6.R",
    layoutText: "90° V8 flat-plane",
    displacement: "5.5 L",
    aspiration: "Naturally aspirated",
    cyl: 8,
    banks: 2,
    crank: "even",
    redline: 8500,
    idle: 1100,
    peakKw: 380,
    peakNm: 560,
    boosted: false,
    mass: 1250,
    cdA: 0.95,
    clA: 1.4,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 75,
    vN: 298,
    shiftTime: 0.07,
    trans: "6-speed sequential",
    inertia: 0.18,
    sound: {
      alpha: 0.98,
      fcLow: 900,
      fcHigh: 5800,
      res: [
        [110, 1.3, 0.22],
        [330, 1.0, 0.25],
        [820, 1.1, 0.28],
        [1900, 1.0, 0.3],
      ],
      intake: [250, 1.0, 0.3],
      bankGain: 0.88,
      bankDelay: 0.12,
      lope: 0.08,
      rough: 0.04,
      drive: 1.8,
      turbo: 0,
      twin: false,
      flutter: 0,
      motor: 0,
      gear: 0.5,
      pop: 0.6,
      body: 3,
    },
  },
  {
    id: "vantage-gte",
    name: "Vantage AMR GTE",
    maker: "Aston Martin",
    cls: "LMGTE",
    year: "2018",
    accent: "#00d68f",
    tagline: "Cross-plane twin-turbo V8 growl",
    code: "M178",
    layoutText: "90° V8 cross-plane",
    displacement: "4.0 L",
    aspiration: "Twin-turbo",
    cyl: 8,
    banks: 2,
    crank: "cross",
    redline: 7200,
    idle: 1000,
    peakKw: 375,
    peakNm: 700,
    boosted: true,
    mass: 1250,
    cdA: 0.98,
    clA: 1.4,
    mu: 1.6,
    driveBias: 0.58,
    brakeG: 1.9,
    gears: 6,
    v1: 70,
    vN: 295,
    shiftTime: 0.08,
    trans: "6-speed sequential",
    inertia: 0.2,
    sound: {
      alpha: 1.0,
      fcLow: 750,
      fcHigh: 3800,
      res: [
        [90, 1.4, 0.2],
        [220, 1.1, 0.25],
        [520, 0.9, 0.3],
        [1100, 0.8, 0.3],
      ],
      intake: [230, 0.6, 0.3],
      bankGain: 0.8,
      bankDelay: 0.28,
      lope: 0.1,
      rough: 0.04,
      drive: 1.8,
      turbo: 0.8,
      twin: true,
      flutter: 0.5,
      motor: 0,
      gear: 0.5,
      pop: 0.55,
      body: 3,
    },
  },
];

export function getCar(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
