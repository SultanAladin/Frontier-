// Voice profiles for the exhaust-pulse synthesis model — Frontier v3 hybrid.
//
// Each cylinder firing launches a pressure pulse into the exhaust. The pulse
// train then passes through, per bank:
//   * header / collector resonances (the "formants")
//   * a body thump path
//   * a pipe resonator (feedback delay = a real open-ended pipe reflecting the
//     pulse back, which makes the pitch-independent "tone" of each exhaust)
//   * the muffler low-pass
// Combustion "rasp" (noise bursts gated by every firing) is injected ahead of
// the pipe, and a separate induction path adds the intake roar.
//
// Every cylinder has its own level / timing error and every combustion event
// varies a little - that irregularity stops an even-firing engine sounding
// like a synthesiser.
//
// ── v3 hybrid additions (from EngineAudioSim `main`, the "raw" engine) ──────
// The patch-1 model above gives every car its character, but on its own it can
// sound digital and linear: analytic pulse shapes, perfectly periodic cycles,
// and a loudness normaliser that flattens dynamics. v3 fuses in the main
// branch's raw layers so the character now rides on top of grit:
//   * `rare`    — the asymmetric pulse's negative rarefaction dip (the main
//                 branch's spike → blow-down → suction waveform). This is the
//                 hollow "bark" a purely positive pulse can never make.
//   * `orders`  — the main branch's per-car harmonic weights, reborn as a
//                 tonal order layer whose amplitude is *gated by the pulse
//                 train itself*, so it breathes instead of droning.
//   * `orderPeak` — how far the loudest order migrates with rpm. The old
//                 LaFerrari failed here: its peak ran to the 8th–12th order
//                 and thinned into an F1 shriek. Real cars are capped.
//   * `raspAM`  — the main branch's inter-bank AM "tearing" rasp (carrier at
//                 3× firing, half-order modulator), layered over gated noise.
//   * `crackle` — per-firing stochastic high-frequency burst with a randomised
//                 level and decay for every single combustion event.
//   * `formantHeat` — exhaust formants drift up as the system heats with load
//                 (hot gas = faster sound = higher pipe resonances). Nothing
//                 in the exhaust is allowed to stay perfectly static any more.
//   * `charger` / `chargerRatio` — supercharger whine (Demon), absent before.

export interface VoiceProfile {
  tag: string; // one-line character description (shown in the UI)
  blowLow: number; // exhaust pulse width at idle (crank degrees)
  blowHigh: number; // exhaust pulse width at redline (crank degrees)
  decay: number; // pulse tail exponent (higher = sharper / crisper)
  atk: number; // pulse attack time (s) - larger = rounder
  round: number; // 0 = sharp blow-down pulse, 1 = smooth bell-shaped pulse
  fcLow: number; // muffler corner (Hz) at closed throttle
  fcHigh: number; // muffler corner (Hz) at full throttle
  direct: number; // un-resonated pulse level
  body: number; // low thump level
  bodyHz: number; // thump corner
  formants: [number, number, number][]; // exhaust resonances [Hz, gain, Q]
  detune: number; // header length difference between the banks
  bankGain: number; // level of bank B relative to bank A
  pipeMs: number; // exhaust pipe round-trip delay (ms) - 0 disables
  pipeFb: number; // pipe reflection (negative = open end, positive = closed)
  pipeDamp: number; // damping low-pass inside the pipe loop (Hz)
  rasp: number; // combustion rasp level (noise bursts gated by each firing)
  raspHz: number; // rasp band centre
  raspQ: number; // rasp band Q
  intake: [number, number, number][]; // induction resonances [Hz, gain, Q]
  intakeGain: number;
  intakeW: number; // intake pulse width (crank degrees)
  rough: number; // static cylinder-to-cylinder level spread
  skew: number; // static cylinder timing error (crank degrees)
  cyc: number; // cycle-to-cycle combustion variation
  jit: number; // cycle-to-cycle timing jitter (crank degrees)
  idleLope: number; // extra lumpiness at idle
  drive: number; // saturation drive
  level: number; // target loudness going into the saturator
  // detailed tonal layers (no noise)
  scavG: number; // scavenge / reversion pulse level
  scavMs: number; // scavenge path delay (ms)
  scavHz: number; // scavenge path damping (Hz)
  overlapW: number; // valve-overlap scavenge window (crank degrees)
  overlapG: number; // valve-overlap level
  blockHz: number; // engine-block vibration frequency
  blockG: number; // engine-block vibration level
  blockQ: number;
  injHz: number; // injector / valvetrain click band
  injG: number;
  chainHz: number; // timing-chain / gear rattle band
  chainG: number;
  tailMs: number; // tailpipe reflection delay (ms)
  tailFb: number; // tailpipe reflection gain
  tailDamp: number; // tailpipe damping (Hz)
  // exhaust routing / individual cylinder colour
  runnerMs: number; // exhaust wave delay, port -> merge (ms of crank time, i.e. it
  // is divided by rpm before use). This is the KEY: a 40 ms runner is 8° of crank
  // at 3000 rpm and 23° at 8000 rpm, so each cylinder's pulse really slides in the
  // cycle. It is what turns a flat comb into a lumpy firing pattern.
  runnerSpread: number; // how unequal the individual runners are (0 = equal length)
  intakeMs: number; // intake runner flight time (ms)
  intakeSpread: number; // intake runner length spread
  atkSpread: number; // per-cylinder attack hardness variation
  // wave (non-linear) character, per cylinder
  cylDurSpread: number; // how much individual blow-down duration varies
  cylDecSpread: number; // how much individual tail steepness varies
  preG: number; // valve-overlap scavenge "whoosh" level (fires before the pulse)
  preW: number; // scavenge window width (crank degrees)
  preSpread: number; // per-cylinder variation of the scavenge window
  // turbo back-pressure (0 when N/A)
  turbo: number; // pulses arrive through a broad shell instead of holes
  turboHz: number; // shell band centre
  turboQ: number; // shell Q
  turboFb: number; // shell reflection amount
  turboMs: number; // shell delay (ms)
  // header wave physics
  reflG: number; // reflected (suction) wave strength - the "on-cam" tuned-header tone
  collMs: number; // collector / scroll merge pipe delay (ms)
  collFb: number; // collector / scroll reflection (0..0.8)
  // extra mechanical detail
  tors: number; // crank torsional speed swing driven by the firing pulses
  slapHz: number; // piston-slap / secondary-motion band
  slapG: number; // piston-slap level
  ancMul: number; // ancillary whine cycles per crank revolution
  ancG: number; // ancillary whine level (alternator / pumps / drives)
  // layer 1: valvetrain / cam signature
  camHz: number; // valve-spring / follower resonance excited by valve events
  camQ: number; // valvetrain resonance Q
  camG: number; // exhaust-valve event excitation
  camInG: number; // intake-valve event excitation relative to exhaust
  // layer 2: turbo spool + overrun
  spoolTau: number; // turbo shaft spool-up time constant (s)
  spoolHz: number; // shaft whistle frequency at full spool (Hz)
  spoolG: number; // spool whistle level multiplier
  overG: number; // compressor-surge / overrun level
  overHz: number; // compressor-surge chop rate (Hz)
  // layer 3: cabin resonance + Doppler
  cabHz: number; // main cabin / body boom resonance (Hz)
  cabQ: number; // cabin resonance Q
  cabG: number; // main cabin resonance level
  cab2Hz: number; // secondary panel / seat resonance (Hz)
  cab2G: number; // secondary cabin resonance level
  dopG: number; // exterior Doppler amount (0 = off, 1 = physical)
  // ── v3 hybrid layers (from EngineAudioSim main) ──
  rare: number; // negative rarefaction dip after blow-down (0 = patch-1 pulse, ~0.35 = hollow bark)
  raspAM: number; // inter-bank AM tearing rasp level (main-branch signature)
  orders: number[]; // tonal order weights vs firing frequency (main-branch harmonics)
  orderGain: number; // order-layer level (gated by the pulse train)
  orderPeak: number; // highest order the loudest-order migration may reach
  crackle: number; // per-firing stochastic HF burst level
  crackleHz: number; // crackle band centre (Hz)
  formantHeat: number; // formant drift with exhaust temperature (0 = static, 1 = physical)
  charger: number; // supercharger whine level (0 = none)
  chargerRatio: number; // charger whine cycles per crank revolution
}

export const DEFAULT_VOICE: VoiceProfile = {
  tag: "Exhaust-pulse model",
  blowLow: 105,
  blowHigh: 75,
  decay: 2.8,
  atk: 0.0005,
  round: 0,
  fcLow: 900,
  fcHigh: 5000,
  direct: 1,
  body: 1,
  bodyHz: 130,
  formants: [
    [120, 1.8, 4],
    [400, 1.6, 4.5],
    [1000, 2.0, 5],
    [2300, 2.2, 5],
  ],
  detune: 0.05,
  bankGain: 0.88,
  pipeMs: 0,
  pipeFb: 0,
  pipeDamp: 3000,
  rasp: 0,
  raspHz: 2000,
  raspQ: 1,
  intake: [[320, 1.5, 3.5]],
  intakeGain: 0.5,
  intakeW: 175,
  rough: 0.14,
  skew: 2.4,
  cyc: 0.14,
  jit: 1.5,
  idleLope: 0.45,
  drive: 1.0,
  level: 0.3,
  scavG: 0,
  scavMs: 0,
  scavHz: 1500,
  overlapW: 0,
  overlapG: 0,
  blockHz: 90,
  blockG: 0,
  blockQ: 1,
  injHz: 3000,
  injG: 0,
  chainHz: 900,
  chainG: 0,
  tailMs: 0,
  tailFb: 0,
  tailDamp: 2500,
  runnerMs: 1.2,
  runnerSpread: 0.3,
  intakeMs: 0.9,
  intakeSpread: 0.3,
  atkSpread: 0.45,
  cylDurSpread: 0.22,
  cylDecSpread: 0.3,
  preG: 0,
  preW: 26,
  preSpread: 0.35,
  turbo: 0,
  turboHz: 950,
  turboQ: 1.4,
  turboFb: 0.25,
  turboMs: 1.4,
  reflG: 0.3,
  collMs: 1.2,
  collFb: 0.25,
  tors: 0.045,
  slapHz: 620,
  slapG: 0.1,
  ancMul: 18,
  ancG: 0.22,
  camHz: 2600,
  camQ: 5,
  camG: 0.7,
  camInG: 0.6,
  spoolTau: 0.45,
  spoolHz: 6200,
  spoolG: 0,
  overG: 0,
  overHz: 13,
  cabHz: 86,
  cabQ: 2.2,
  cabG: 0.34,
  cab2Hz: 320,
  cab2G: 0.12,
  dopG: 0.9,
  // v3 hybrid layers
  rare: 0.22,
  raspAM: 0.25,
  orders: [1.0, 0.8, 0.5, 0.35, 0.22, 0.14],
  orderGain: 0.35,
  orderPeak: 5,
  crackle: 0.22,
  crackleHz: 4800,
  formantHeat: 0.7,
  charger: 0,
  chargerRatio: 36,
};

// Exhaust routing + runner geometry per engine family. This is what makes an
// inline-6, a flat-plane V8 and a V10 physically different rather than just
// differently filtered: how long each runner is, how unequal the primaries
// are, and whether the pulses merge into one collector, a twin-scroll pair or
// two primary pipes.
const ROUTING: Record<string, Partial<VoiceProfile>> = {
  // ── turbo V6: twin-scroll, back-pressure shell, broad low-mid rumble ──
  "gtr-nismo": { runnerMs: 26, runnerSpread: 0.3, intakeMs: 1.1, intakeSpread: 0.35, atkSpread: 0.5, cylDurSpread: 0.24, cylDecSpread: 0.3, preG: 0.35, preW: 28, preSpread: 0.35, turbo: 0.5, turboHz: 780, turboQ: 1.5, turboFb: 0.3, turboMs: 1.8 },
  "gtr-gt3": { runnerMs: 30, runnerSpread: 0.34, intakeMs: 1.25, intakeSpread: 0.38, atkSpread: 0.55, cylDurSpread: 0.26, cylDecSpread: 0.32, preG: 0.4, preW: 30, preSpread: 0.38, turbo: 0.52, turboHz: 750, turboQ: 1.5, turboFb: 0.32, turboMs: 2.0 },
  "296-gt3": { runnerMs: 24, runnerSpread: 0.3, intakeMs: 1.0, intakeSpread: 0.32, atkSpread: 0.5, cylDurSpread: 0.22, cylDecSpread: 0.28, preG: 0.33, preW: 26, preSpread: 0.33, turbo: 0.46, turboHz: 820, turboQ: 1.5, turboFb: 0.28, turboMs: 1.6 },
  // ── turbo inline-6: longest primaries, split 1-3 / 4-6 growl ──
  "m4-gt3": { runnerMs: 34, runnerSpread: 0.46, intakeMs: 1.3, intakeSpread: 0.4, atkSpread: 0.5, cylDurSpread: 0.28, cylDecSpread: 0.34, preG: 0.42, preW: 32, preSpread: 0.4, turbo: 0.55, turboHz: 720, turboQ: 1.4, turboFb: 0.34, turboMs: 2.2 },
  // ── turbo flat-plane V8 ──
  "488-gte": { runnerMs: 20, runnerSpread: 0.25, intakeMs: 1.0, intakeSpread: 0.3, atkSpread: 0.45, cylDurSpread: 0.2, cylDecSpread: 0.26, preG: 0.3, preW: 26, preSpread: 0.3, turbo: 0.48, turboHz: 800, turboQ: 1.5, turboFb: 0.29, turboMs: 1.5 },
  "vantage-gte": { runnerMs: 22, runnerSpread: 0.28, intakeMs: 1.0, intakeSpread: 0.3, atkSpread: 0.45, cylDurSpread: 0.22, cylDecSpread: 0.28, preG: 0.32, preW: 28, preSpread: 0.32, turbo: 0.5, turboHz: 760, turboQ: 1.5, turboFb: 0.3, turboMs: 1.6 },
  // ── NA flat-plane V8: short equal primaries, hard attack, N/A (turbo 0) ──
  "918": { runnerMs: 16, runnerSpread: 0.18, intakeMs: 0.8, intakeSpread: 0.22, atkSpread: 0.5, cylDurSpread: 0.18, cylDecSpread: 0.24, preG: 0.22, preW: 22, preSpread: 0.25, turbo: 0 },
  c8r: { runnerMs: 17, runnerSpread: 0.2, intakeMs: 0.85, intakeSpread: 0.25, atkSpread: 0.5, cylDurSpread: 0.2, cylDecSpread: 0.26, preG: 0.26, preW: 24, preSpread: 0.28, turbo: 0 },
  "amg-gt3": { runnerMs: 18, runnerSpread: 0.22, intakeMs: 0.9, intakeSpread: 0.25, atkSpread: 0.5, cylDurSpread: 0.2, cylDecSpread: 0.28, preG: 0.28, preW: 26, preSpread: 0.3, turbo: 0 },
  // ── boxer-6: DELIBERATELY unequal primaries = the warble ──
  "911-gt3r": { runnerMs: 20, runnerSpread: 0.5, intakeMs: 0.9, intakeSpread: 0.5, atkSpread: 0.6, cylDurSpread: 0.3, cylDecSpread: 0.36, preG: 0.4, preW: 30, preSpread: 0.45, turbo: 0 },
  "911-rsr": { runnerMs: 22, runnerSpread: 0.52, intakeMs: 0.95, intakeSpread: 0.5, atkSpread: 0.6, cylDurSpread: 0.32, cylDecSpread: 0.38, preG: 0.42, preW: 32, preSpread: 0.48, turbo: 0 },
  // ── V10: near-equal length, crisp ──
  "huracan-gt3": { runnerMs: 15, runnerSpread: 0.12, intakeMs: 0.75, intakeSpread: 0.15, atkSpread: 0.35, cylDurSpread: 0.14, cylDecSpread: 0.2, preG: 0.18, preW: 20, preSpread: 0.2, turbo: 0 },
  // ── V12: the smoothest, most equal-length header ──
  laferrari: { runnerMs: 13, runnerSpread: 0.08, intakeMs: 0.65, intakeSpread: 0.1, atkSpread: 0.3, cylDurSpread: 0.1, cylDecSpread: 0.16, preG: 0.12, preW: 18, preSpread: 0.15, turbo: 0 },
  vulcan: { runnerMs: 12, runnerSpread: 0.1, intakeMs: 0.62, intakeSpread: 0.12, atkSpread: 0.34, cylDurSpread: 0.12, cylDecSpread: 0.18, preG: 0.16, preW: 20, preSpread: 0.18, turbo: 0 },
  // ── Viper V10: short side-pipes, big lazy pulses ──
  viper: { runnerMs: 14, runnerSpread: 0.2, intakeMs: 0.8, intakeSpread: 0.24, atkSpread: 0.5, cylDurSpread: 0.22, cylDecSpread: 0.3, preG: 0.3, preW: 26, preSpread: 0.32, turbo: 0 },
  // ── Agera flat-plane twin-turbo V8: compact manifolds into the turbines ──
  agera: { runnerMs: 19, runnerSpread: 0.24, intakeMs: 0.95, intakeSpread: 0.28, atkSpread: 0.46, cylDurSpread: 0.2, cylDecSpread: 0.26, preG: 0.3, preW: 25, preSpread: 0.3, turbo: 0.5, turboHz: 840, turboQ: 1.5, turboFb: 0.3, turboMs: 1.5 },
};

// (the ROUTING table is applied at the bottom of this file, once VOICES exists)

const v = (o: Partial<VoiceProfile>): VoiceProfile => ({ ...DEFAULT_VOICE, ...o });

export const VOICES: Record<string, VoiceProfile> = {
  // ═════════════ ROAD / HYPERCAR ═════════════

  // The reference voice - deliberately left exactly as it was.
  "gtr-nismo": v({
    tag: "Twin-turbo V6 · deep brawl",
    blowLow: 115,
    blowHigh: 90,
    decay: 2.4,
    atk: 0.0007,
    fcLow: 650,
    fcHigh: 3000,
    body: 1.4,
    bodyHz: 120,
    formants: [
      [80, 2.4, 4],
      [165, 2.0, 4],
      [330, 1.6, 4],
      [680, 1.2, 3.5],
      [1400, 1.0, 3],
    ],
    detune: 0.06,
    bankGain: 0.88,
    intake: [[210, 1.4, 3]],
    intakeGain: 0.3,
    intakeW: 190,
    rough: 0.14,
    skew: 2.8,
    cyc: 0.14,
    jit: 1.6,
    idleLope: 0.5,
    // detailed tonal layers
    scavG: 0.22,
    scavMs: 2.8,
    scavHz: 900,
    overlapW: 28,
    overlapG: 0.18,
    blockHz: 85,
    blockG: 0.35,
    blockQ: 1.2,
    injHz: 2600,
    injG: 0.08,
    chainHz: 750,
    chainG: 0.12,
    tailMs: 5.2,
    tailFb: 0.18,
    tailDamp: 2200,
  }),

  // Flat-plane V8, short open top-pipes, clean and hard-edged
  "918": v({
    tag: "Flat-plane V8 · clean hybrid scream",
    blowLow: 108,
    blowHigh: 78,
    decay: 2.6,
    atk: 0.0006,
    round: 0.1,
    fcLow: 850,
    fcHigh: 4600,
    body: 0.95,
    bodyHz: 125,
    formants: [
      [110, 2.0, 3.2],
      [300, 1.8, 3.4],
      [760, 2.0, 3.4],
      [1700, 1.8, 3.1],
      [3000, 1.1, 2.8],
    ],
    detune: 0.04,
    bankGain: 0.92,
    pipeMs: 3.4,
    pipeFb: -0.4,
    pipeDamp: 3200,
    rasp: 0.32,
    raspHz: 2100,
    raspQ: 1.1,
    intake: [
      [340, 1.8, 3.2],
      [900, 1.9, 3.5],
    ],
    intakeGain: 0.5,
    intakeW: 175,
    rough: 0.12,
    skew: 2.0,
    cyc: 0.13,
    jit: 1.2,
    idleLope: 0.35,
    drive: 1.05,
    level: 0.27,
    // detailed tonal layers
    scavG: 0.18,
    scavMs: 3.1,
    scavHz: 1100,
    overlapW: 22,
    overlapG: 0.14,
    blockHz: 95,
    blockG: 0.28,
    blockQ: 1.1,
    injHz: 2800,
    injG: 0.06,
    chainHz: 820,
    chainG: 0.1,
    tailMs: 4.6,
    tailFb: 0.15,
    tailDamp: 2600,
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // FERRARI LaFERRARI — F140 FE 6.3 L 65° V12 · REBUILT EXHAUST PROFILE (v3)
  // ═══════════════════════════════════════════════════════════════════════
  // Why every previous attempt sounded like an F1 car (or a Ferrari V8):
  //
  //  1. THE ORDER PEAK RAN AWAY. The main-branch engine migrated its loudest
  //     harmonic to the 8th–12th order at high rpm and starved the low
  //     orders. At 9,000 rpm that is a thin 6–9 kHz shriek — a 19,000 rpm
  //     F1 engine's spectrum transplanted onto a 9,250 rpm road V12.
  //     → `orderPeak: 3.4` caps the migration; orders 1–4 never empty out.
  //
  //  2. THE BODY WAS MISSING. Patch-1 gave this car body:0.7 / bodyHz:140 —
  //     the quietest chest of any NA car here. A real LaFerrari at 3,000 rpm
  //     is a deep, hollow *bark* you feel in your ribs; the scream is layered
  //     ON TOP of that weight, it never replaces it.
  //     → body 1.05 @ 118 Hz, direct 1.05, and a rarefaction dip (`rare`)
  //       that hollows the pulse out like the main branch's waveform did.
  //
  //  3. THE EXHAUST FORMANTS WERE IN THE WRONG PLACE. Generic 150/480/1050/
  //     2100/3600 spacing reads as "generic V12". The F140's equal-length
  //     6-into-1 system sings in a specific stack: collector chest ~130 Hz,
  //     primary resonance ~355 Hz, the famous mid-range HOWL at ~740 Hz,
  //     scream formant ~1.48 kHz, glass at ~2.95 kHz only when hot & loaded.
  //     → six formants, heat-drifting, with the 740 Hz howl the loudest.
  //
  //  4. IT WAS TOO SMOOTH AT LOW RPM, TOO SHARP AT HIGH RPM. A V12 fires
  //     every 60°; at idle the pulses are separate events (bark, lope,
  //     individual cylinder tick), at 9,000 rpm six pulses are in the
  //     primaries at once (silk). One static pulse shape cannot do both.
  //     → low static `round` (0.16) — the worklet now rounds the pulse
  //       dynamically as rpm climbs (see `round` handling in the worklet).
  //
  //  5. THE INTAKE WAS AN AFTERTHOUGHT. LaFerrari's variable trumpets are
  //     half the mid-range sound — a hard-edged induction honk at 390/860 Hz
  //     that leads the exhaust by a few ms under load.
  //     → three intake formants, intakeGain 0.85, the loudest NA intake here
  //       short of the 911 RSR.
  //
  // What it is NOT: not a V8 (no cross-plane lope — rough/skew/idleLope are
  // the smallest in the garage; a 65° V12 with offset pins fires dead even),
  // and not an F1 car (redline 9,250, capped orders, chest that stays).
  laferrari: v({
    tag: "65° V12 · hollow bark → glass howl · equal-length 6-into-1 (rebuilt v3)",
    blowLow: 104,
    blowHigh: 66,
    decay: 2.15,
    atk: 0.00055,
    round: 0.16, // sharp at idle; the worklet rounds it dynamically with rpm
    fcLow: 950,
    fcHigh: 5600,
    direct: 1.05,
    body: 1.05,
    bodyHz: 118,
    formants: [
      [132, 1.9, 3.4], // collector chest
      [356, 1.9, 3.6], // primary resonance
      [742, 2.5, 3.8], // THE howl
      [1480, 2.4, 3.4], // scream formant
      [2950, 1.7, 2.9], // glass (heat/load only, via drift + load gain)
      [4700, 0.8, 2.4], // top sheen
    ],
    detune: 0.018,
    bankGain: 0.97,
    pipeMs: 5.6,
    pipeFb: -0.42,
    pipeDamp: 3400,
    rasp: 0.16,
    raspHz: 2750,
    raspQ: 1,
    intake: [
      [386, 2.0, 3.2],
      [864, 2.2, 3.4],
      [1730, 1.4, 3.0],
    ],
    intakeGain: 0.85,
    intakeW: 168,
    rough: 0.05,
    skew: 0.8,
    cyc: 0.06,
    jit: 0.5,
    idleLope: 0.1,
    drive: 0.95,
    level: 0.3,
    // detailed tonal layers
    scavG: 0.1,
    scavMs: 4.6,
    scavHz: 1500,
    overlapW: 14,
    overlapG: 0.07,
    blockHz: 118,
    blockG: 0.16,
    blockQ: 1,
    injHz: 3400,
    injG: 0.035,
    chainHz: 940,
    chainG: 0.05,
    tailMs: 6.4,
    tailFb: 0.12,
    tailDamp: 3200,
    // v3 hybrid layers — the main branch's LaFerrari harmonics, capped
    rare: 0.38,
    raspAM: 0.55,
    orders: [0.9, 1.0, 0.55, 0.95, 0.42, 0.62, 0.3, 0.2],
    orderGain: 0.5,
    orderPeak: 3.4,
    crackle: 0.2,
    crackleHz: 5200,
    formantHeat: 0.9,
  }),

  // Aston Martin Vulcan: 7.0 L NA V12, track-only, near-straight pipes.
  // Same F140-style even-fire silk as LaFerrari, but rawer everywhere:
  // shorter system, harder attack, more rasp, less muffler, no hybrid hush.
  // (The "Vulcan" voice the patch-1 garage never had.)
  vulcan: v({
    tag: "7.0 V12 · track-only · straight pipes, silk turned savage",
    blowLow: 100,
    blowHigh: 62,
    decay: 2.5,
    atk: 0.00048,
    round: 0.12,
    fcLow: 1100,
    fcHigh: 6600,
    direct: 1.1,
    body: 0.9,
    bodyHz: 128,
    formants: [
      [148, 1.8, 3.2],
      [412, 2.0, 3.4],
      [884, 2.5, 3.6],
      [1780, 2.4, 3.2],
      [3450, 1.6, 2.8],
    ],
    detune: 0.022,
    bankGain: 0.96,
    pipeMs: 4.2,
    pipeFb: -0.52,
    pipeDamp: 3800,
    rasp: 0.3,
    raspHz: 2900,
    raspQ: 1,
    intake: [
      [408, 2.1, 3.2],
      [920, 2.3, 3.4],
    ],
    intakeGain: 0.95,
    intakeW: 164,
    rough: 0.09,
    skew: 1.3,
    cyc: 0.09,
    jit: 0.8,
    idleLope: 0.18,
    drive: 1.06,
    level: 0.33,
    scavG: 0.14,
    scavMs: 4.0,
    scavHz: 1500,
    overlapW: 18,
    overlapG: 0.1,
    blockHz: 112,
    blockG: 0.2,
    blockQ: 1,
    injHz: 3300,
    injG: 0.05,
    chainHz: 920,
    chainG: 0.07,
    tailMs: 5.2,
    tailFb: 0.14,
    tailDamp: 3300,
    rare: 0.3,
    raspAM: 0.7,
    orders: [0.85, 1.0, 0.6, 0.9, 0.45, 0.6, 0.34, 0.24],
    orderGain: 0.52,
    orderPeak: 3.8,
    crackle: 0.3,
    crackleHz: 5400,
    formantHeat: 0.9,
  }),

  // Dodge Viper ACR: 8.4 L 90° V10, side pipes. The anti-V12: huge lazy
  // pulses, deep chest, rough idle, almost no top-end glass. From the
  // main branch's favourite (basePitch 38 — the lowest in either garage).
  viper: v({
    tag: "8.4 V10 · side-pipe thump · lazy giant",
    blowLow: 124,
    blowHigh: 92,
    decay: 2.1,
    atk: 0.0008,
    round: 0.2,
    fcLow: 620,
    fcHigh: 3400,
    direct: 1.1,
    body: 1.6,
    bodyHz: 96,
    formants: [
      [72, 2.6, 3.6],
      [148, 2.2, 3.8],
      [305, 1.8, 3.8],
      [640, 1.4, 3.4],
      [1250, 1.0, 3.0],
    ],
    detune: 0.09,
    bankGain: 0.82,
    pipeMs: 3.8,
    pipeFb: -0.38,
    pipeDamp: 2400,
    rasp: 0.22,
    raspHz: 1500,
    raspQ: 1.1,
    intake: [[190, 1.6, 3.0]],
    intakeGain: 0.45,
    intakeW: 188,
    rough: 0.2,
    skew: 3.4,
    cyc: 0.19,
    jit: 2.0,
    idleLope: 0.62,
    drive: 1.12,
    level: 0.31,
    scavG: 0.26,
    scavMs: 2.6,
    scavHz: 850,
    overlapW: 30,
    overlapG: 0.2,
    blockHz: 78,
    blockG: 0.36,
    blockQ: 1.2,
    injHz: 2500,
    injG: 0.08,
    chainHz: 680,
    chainG: 0.13,
    tailMs: 4.2,
    tailFb: 0.16,
    tailDamp: 2100,
    rare: 0.34,
    raspAM: 0.18,
    orders: [1.0, 0.9, 0.4, 0.7, 0.3, 0.5],
    orderGain: 0.42,
    orderPeak: 3.0,
    crackle: 0.26,
    crackleHz: 3800,
    formantHeat: 0.6,
  }),

  // Koenigsegg Agera RS: 5.0 flat-plane twin-turbo V8. Main-branch car,
  // rebuilt on the pulse model: hard flat-plane edge, turbines soaking the
  // attack as boost rises, wastegate-heavy overrun.
  agera: v({
    tag: "Flat-plane TT V8 · hard edge through the turbines",
    blowLow: 110,
    blowHigh: 80,
    decay: 2.55,
    atk: 0.00058,
    round: 0.08,
    fcLow: 800,
    fcHigh: 4400,
    direct: 1.05,
    body: 1.25,
    bodyHz: 118,
    formants: [
      [105, 2.2, 3.5],
      [290, 2.0, 3.6],
      [690, 2.2, 3.6],
      [1500, 1.9, 3.3],
      [2700, 1.2, 3.0],
    ],
    detune: 0.05,
    bankGain: 0.9,
    pipeMs: 4.0,
    pipeFb: -0.46,
    pipeDamp: 3000,
    rasp: 0.34,
    raspHz: 1850,
    raspQ: 1.1,
    intake: [[300, 1.5, 3.0]],
    intakeGain: 0.42,
    intakeW: 176,
    rough: 0.14,
    skew: 2.4,
    cyc: 0.15,
    jit: 1.5,
    idleLope: 0.44,
    drive: 1.08,
    level: 0.3,
    scavG: 0.24,
    scavMs: 3.0,
    scavHz: 1000,
    overlapW: 27,
    overlapG: 0.18,
    blockHz: 92,
    blockG: 0.3,
    blockQ: 1.2,
    injHz: 2700,
    injG: 0.08,
    chainHz: 740,
    chainG: 0.13,
    tailMs: 4.2,
    tailFb: 0.17,
    tailDamp: 2400,
    rare: 0.26,
    raspAM: 0.4,
    orders: [1.2, 0.5, 1.1, 0.4, 0.9, 0.3, 0.7],
    orderGain: 0.4,
    orderPeak: 4.2,
    crackle: 0.3,
    crackleHz: 4600,
    formantHeat: 0.8,
  }),

  // Dodge Challenger SRT Demon: supercharged cross-plane V8. Voiced here for
  // the worklet's cam/cabin/charger layers; the uneven-fire body itself is
  // the additive model (see cars.ts — crank "cross").
  demon: v({
    tag: "Supercharged cross-plane V8 · blower thunder",
    blowLow: 122,
    blowHigh: 92,
    decay: 2.3,
    atk: 0.00065,
    round: 0.1,
    fcLow: 700,
    fcHigh: 4200,
    direct: 1.1,
    body: 1.55,
    bodyHz: 104,
    formants: [
      [76, 2.6, 4],
      [152, 2.2, 4],
      [318, 1.8, 4],
      [760, 1.3, 3.5],
      [1600, 1.0, 3],
    ],
    detune: 0.07,
    bankGain: 0.85,
    pipeMs: 3.4,
    pipeFb: -0.4,
    pipeDamp: 2200,
    rasp: 0.24,
    raspHz: 1500,
    raspQ: 1.1,
    intake: [[205, 1.9, 3]],
    intakeGain: 0.65,
    intakeW: 186,
    rough: 0.16,
    skew: 3.0,
    cyc: 0.16,
    jit: 1.8,
    idleLope: 0.58,
    drive: 1.12,
    level: 0.3,
    scavG: 0.3,
    scavMs: 2.4,
    scavHz: 800,
    overlapW: 34,
    overlapG: 0.23,
    blockHz: 74,
    blockG: 0.38,
    blockQ: 1.3,
    injHz: 2400,
    injG: 0.09,
    chainHz: 640,
    chainG: 0.15,
    tailMs: 3.4,
    tailFb: 0.2,
    tailDamp: 2000,
    rare: 0.3,
    raspAM: 0.12,
    orders: [1.0, 0.8, 0.6, 0.5, 0.3, 0.2],
    orderGain: 0.4,
    orderPeak: 3.2,
    crackle: 0.3,
    crackleHz: 4000,
    formantHeat: 0.6,
    charger: 1.0,
    chargerRatio: 34,
  }),

  // ═════════════ GT3 ═════════════

  // Boxer-six: unequal-length headers (big bank beat), short pipes, metallic rasp
  "911-gt3r": v({
    tag: "Boxer-6 · raw metallic rasp",
    blowLow: 100,
    blowHigh: 66,
    decay: 3.0,
    atk: 0.00045,
    fcLow: 1000,
    fcHigh: 5200,
    body: 0.55,
    bodyHz: 150,
    formants: [
      [120, 1.4, 3.2],
      [360, 1.5, 3.5],
      [880, 2.3, 3.8],
      [1900, 2.4, 3.5],
      [3300, 1.5, 3.0],
    ],
    detune: 0.11,
    bankGain: 0.84,
    pipeMs: 2.6,
    pipeFb: -0.5,
    pipeDamp: 3800,
    rasp: 0.62,
    raspHz: 2400,
    raspQ: 1,
    intake: [
      [300, 2.4, 3.5],
      [780, 2.7, 3.8],
    ],
    intakeGain: 0.8,
    intakeW: 175,
    rough: 0.17,
    skew: 2.8,
    cyc: 0.17,
    jit: 1.6,
    idleLope: 0.5,
    level: 0.27,
    // detailed tonal layers
    scavG: 0.28,
    scavMs: 2.2,
    scavHz: 1300,
    overlapW: 32,
    overlapG: 0.22,
    blockHz: 100,
    blockG: 0.32,
    blockQ: 1.2,
    injHz: 2900,
    injG: 0.1,
    chainHz: 780,
    chainG: 0.14,
    tailMs: 3.8,
    tailFb: 0.2,
    tailDamp: 2800,
  }),

  // V10: smooth, nasal wail with a strong firing-order tone
  "huracan-gt3": v({
    tag: "V10 · nasal banshee wail",
    blowLow: 100,
    blowHigh: 66,
    decay: 2.6,
    atk: 0.0006,
    round: 0.22,
    fcLow: 1000,
    fcHigh: 5000,
    body: 0.75,
    bodyHz: 140,
    formants: [
      [130, 1.5, 3.0],
      [420, 1.6, 3.2],
      [1000, 2.2, 3.2],
      [2000, 2.3, 3.0],
      [3400, 1.3, 2.8],
    ],
    detune: 0.03,
    bankGain: 0.93,
    pipeMs: 4.2,
    pipeFb: -0.45,
    pipeDamp: 3400,
    rasp: 0.2,
    raspHz: 2400,
    raspQ: 1,
    intake: [
      [360, 2.0, 3.2],
      [1000, 2.4, 3.5],
    ],
    intakeGain: 0.7,
    intakeW: 170,
    rough: 0.08,
    skew: 1.4,
    cyc: 0.09,
    jit: 0.9,
    idleLope: 0.22,
    level: 0.27,
    // detailed tonal layers
    scavG: 0.2,
    scavMs: 3.6,
    scavHz: 1200,
    overlapW: 24,
    overlapG: 0.16,
    blockHz: 105,
    blockG: 0.26,
    blockQ: 1.1,
    injHz: 3000,
    injG: 0.07,
    chainHz: 850,
    chainG: 0.11,
    tailMs: 4.4,
    tailFb: 0.16,
    tailDamp: 2700,
  }),

  // cross-plane voicing (only used if you switch it to a flat-plane crank)
  "amg-gt3": v({
    tag: "Cross-plane V8 · thunder",
    blowLow: 120,
    blowHigh: 90,
    decay: 2.3,
    atk: 0.0006,
    fcLow: 800,
    fcHigh: 4800,
    body: 1.5,
    bodyHz: 110,
    formants: [
      [80, 2.5, 4],
      [160, 2.1, 4],
      [330, 1.7, 4],
      [820, 1.3, 3.5],
      [1700, 1.0, 3],
    ],
    detune: 0.07,
    bankGain: 0.85,
    intake: [[200, 2.0, 3]],
    intakeGain: 0.7,
    intakeW: 185,
    rough: 0.15,
    skew: 3.0,
    cyc: 0.15,
    jit: 1.8,
    idleLope: 0.55,
    drive: 1.1,
    // detailed tonal layers
    scavG: 0.3,
    scavMs: 2.4,
    scavHz: 800,
    overlapW: 36,
    overlapG: 0.24,
    blockHz: 75,
    blockG: 0.38,
    blockQ: 1.3,
    injHz: 2400,
    injG: 0.09,
    chainHz: 650,
    chainG: 0.15,
    tailMs: 3.2,
    tailFb: 0.22,
    tailDamp: 2000,
  }),

  // Race V6: open turbo plumbing, long hollow pipes, barking mids
  "gtr-gt3": v({
    tag: "Twin-turbo V6 · open-pipe bark",
    blowLow: 112,
    blowHigh: 84,
    decay: 2.5,
    atk: 0.00065,
    fcLow: 750,
    fcHigh: 3600,
    body: 1.3,
    bodyHz: 115,
    formants: [
      [85, 2.2, 3.5],
      [180, 2.0, 3.6],
      [420, 1.8, 3.8],
      [1000, 1.7, 3.5],
      [2000, 1.3, 3.2],
    ],
    detune: 0.07,
    bankGain: 0.86,
    pipeMs: 4.8,
    pipeFb: -0.5,
    pipeDamp: 2800,
    rasp: 0.4,
    raspHz: 1500,
    raspQ: 1.2,
    intake: [[260, 1.2, 3]],
    intakeGain: 0.35,
    intakeW: 180,
    rough: 0.16,
    skew: 3.0,
    cyc: 0.16,
    jit: 1.8,
    idleLope: 0.55,
    drive: 1.1,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.26,
    scavMs: 3.4,
    scavHz: 1000,
    overlapW: 30,
    overlapG: 0.2,
    blockHz: 90,
    blockG: 0.3,
    blockQ: 1.2,
    injHz: 2700,
    injG: 0.08,
    chainHz: 720,
    chainG: 0.13,
    tailMs: 4.2,
    tailFb: 0.18,
    tailDamp: 2400,
  }),

  // 120-degree V6: higher revving, sharper rip
  "296-gt3": v({
    tag: "120° V6 · ripping canvas",
    blowLow: 100,
    blowHigh: 70,
    decay: 2.8,
    atk: 0.0005,
    fcLow: 900,
    fcHigh: 4600,
    body: 0.85,
    bodyHz: 135,
    formants: [
      [135, 1.9, 3.2],
      [370, 1.8, 3.5],
      [880, 2.2, 3.6],
      [1900, 2.1, 3.4],
      [3300, 1.3, 3.0],
    ],
    detune: 0.05,
    bankGain: 0.88,
    pipeMs: 3.0,
    pipeFb: -0.55,
    pipeDamp: 3500,
    rasp: 0.5,
    raspHz: 1900,
    raspQ: 1,
    intake: [[330, 1.4, 3]],
    intakeGain: 0.42,
    intakeW: 175,
    rough: 0.15,
    skew: 2.6,
    cyc: 0.15,
    jit: 1.5,
    idleLope: 0.45,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.24,
    scavMs: 2.8,
    scavHz: 1100,
    overlapW: 26,
    overlapG: 0.18,
    blockHz: 95,
    blockG: 0.28,
    blockQ: 1.1,
    injHz: 2800,
    injG: 0.07,
    chainHz: 760,
    chainG: 0.12,
    tailMs: 3.6,
    tailFb: 0.17,
    tailDamp: 2500,
  }),

  // Inline-six: one long exhaust, deep growl, smooth
  "m4-gt3": v({
    tag: "Inline-6 · long-pipe growl",
    blowLow: 112,
    blowHigh: 82,
    decay: 2.5,
    atk: 0.00065,
    round: 0.15,
    fcLow: 700,
    fcHigh: 3800,
    body: 1.15,
    bodyHz: 120,
    formants: [
      [110, 2.1, 3.5],
      [240, 1.8, 3.5],
      [520, 2.0, 3.8],
      [1050, 1.8, 3.5],
      [2000, 1.2, 3.0],
    ],
    detune: 0,
    bankGain: 1,
    pipeMs: 6.2,
    pipeFb: -0.52,
    pipeDamp: 2600,
    rasp: 0.3,
    raspHz: 1250,
    raspQ: 1.2,
    intake: [[240, 1.3, 3]],
    intakeGain: 0.35,
    intakeW: 185,
    rough: 0.12,
    skew: 2.0,
    cyc: 0.12,
    jit: 1.3,
    idleLope: 0.35,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.22,
    scavMs: 4.4,
    scavHz: 900,
    overlapW: 24,
    overlapG: 0.16,
    blockHz: 80,
    blockG: 0.26,
    blockQ: 1.1,
    injHz: 2500,
    injG: 0.06,
    chainHz: 700,
    chainG: 0.11,
    tailMs: 5.4,
    tailFb: 0.15,
    tailDamp: 2200,
  }),

  // ═════════════ LMGTE ═════════════

  // Turbo flat-plane V8: tearing fabric, muffled by the turbos
  "488-gte": v({
    tag: "Turbo flat-plane V8 · tearing",
    blowLow: 108,
    blowHigh: 78,
    decay: 2.7,
    atk: 0.0006,
    round: 0.08,
    fcLow: 850,
    fcHigh: 4200,
    body: 1.0,
    bodyHz: 125,
    formants: [
      [120, 1.9, 3.4],
      [330, 1.9, 3.6],
      [780, 2.2, 3.6],
      [1700, 2.0, 3.3],
      [3000, 1.2, 3.0],
    ],
    detune: 0.05,
    bankGain: 0.9,
    pipeMs: 3.8,
    pipeFb: -0.45,
    pipeDamp: 3000,
    rasp: 0.38,
    raspHz: 1800,
    raspQ: 1.1,
    intake: [[300, 1.5, 3]],
    intakeGain: 0.4,
    intakeW: 175,
    rough: 0.14,
    skew: 2.4,
    cyc: 0.15,
    jit: 1.5,
    idleLope: 0.45,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.25,
    scavMs: 3.2,
    scavHz: 1000,
    overlapW: 28,
    overlapG: 0.19,
    blockHz: 92,
    blockG: 0.29,
    blockQ: 1.2,
    injHz: 2750,
    injG: 0.08,
    chainHz: 740,
    chainG: 0.13,
    tailMs: 4.0,
    tailFb: 0.17,
    tailDamp: 2450,
  }),

  // NA boxer-six: deep racing bark, big intake, longer pipes than the GT3 R
  "911-rsr": v({
    tag: "Boxer-6 · deep racing bark",
    blowLow: 104,
    blowHigh: 70,
    decay: 2.8,
    atk: 0.0005,
    round: 0.08,
    fcLow: 950,
    fcHigh: 4800,
    body: 0.85,
    bodyHz: 135,
    formants: [
      [105, 1.9, 3.3],
      [290, 1.9, 3.6],
      [700, 2.3, 3.8],
      [1500, 2.2, 3.5],
      [2800, 1.4, 3.0],
    ],
    detune: 0.12,
    bankGain: 0.83,
    pipeMs: 3.9,
    pipeFb: -0.52,
    pipeDamp: 3000,
    rasp: 0.48,
    raspHz: 1700,
    raspQ: 1.1,
    intake: [
      [260, 2.5, 3.3],
      [700, 2.6, 3.6],
    ],
    intakeGain: 0.8,
    intakeW: 175,
    rough: 0.17,
    skew: 2.8,
    cyc: 0.17,
    jit: 1.6,
    idleLope: 0.5,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.29,
    scavMs: 2.6,
    scavHz: 1200,
    overlapW: 34,
    overlapG: 0.23,
    blockHz: 98,
    blockG: 0.31,
    blockQ: 1.2,
    injHz: 2850,
    injG: 0.09,
    chainHz: 770,
    chainG: 0.14,
    tailMs: 3.4,
    tailFb: 0.19,
    tailDamp: 2600,
  }),

  // Big NA flat-plane V8: thunderous bark
  c8r: v({
    tag: "Big flat-plane V8 · thunderous bark",
    blowLow: 112,
    blowHigh: 80,
    decay: 2.6,
    atk: 0.0006,
    round: 0.05,
    fcLow: 850,
    fcHigh: 5000,
    body: 1.3,
    bodyHz: 115,
    formants: [
      [95, 2.3, 3.4],
      [270, 2.0, 3.6],
      [640, 2.2, 3.8],
      [1400, 2.0, 3.5],
      [2600, 1.4, 3.0],
    ],
    detune: 0.06,
    bankGain: 0.86,
    pipeMs: 4.4,
    pipeFb: -0.5,
    pipeDamp: 3200,
    rasp: 0.45,
    raspHz: 1500,
    raspQ: 1.1,
    intake: [
      [240, 2.5, 3.2],
      [650, 2.3, 3.5],
    ],
    intakeGain: 0.75,
    intakeW: 180,
    rough: 0.15,
    skew: 2.8,
    cyc: 0.16,
    jit: 1.7,
    idleLope: 0.5,
    drive: 1.1,
    level: 0.28,
    // detailed tonal layers
    scavG: 0.27,
    scavMs: 3.8,
    scavHz: 950,
    overlapW: 30,
    overlapG: 0.21,
    blockHz: 88,
    blockG: 0.33,
    blockQ: 1.2,
    injHz: 2650,
    injG: 0.09,
    chainHz: 710,
    chainG: 0.14,
    tailMs: 4.6,
    tailFb: 0.18,
    tailDamp: 2300,
  }),

  // cross-plane voicing (only used if you switch it to a flat-plane crank)
  "vantage-gte": v({
    tag: "Cross-plane turbo V8 · burble",
    blowLow: 115,
    blowHigh: 85,
    decay: 2.4,
    atk: 0.0006,
    fcLow: 750,
    fcHigh: 3800,
    body: 1.4,
    bodyHz: 115,
    formants: [
      [90, 2.4, 4],
      [220, 2.0, 4],
      [520, 1.6, 4],
      [1100, 1.3, 3.5],
      [2000, 1.0, 3],
    ],
    detune: 0.07,
    bankGain: 0.85,
    intake: [[230, 1.4, 3]],
    intakeGain: 0.4,
    intakeW: 185,
    rough: 0.15,
    skew: 3.0,
    cyc: 0.15,
    jit: 1.8,
    idleLope: 0.55,
    drive: 1.1,
    // detailed tonal layers
    scavG: 0.3,
    scavMs: 2.2,
    scavHz: 750,
    overlapW: 38,
    overlapG: 0.25,
    blockHz: 70,
    blockG: 0.4,
    blockQ: 1.3,
    injHz: 2300,
    injG: 0.1,
    chainHz: 620,
    chainG: 0.16,
    tailMs: 3.0,
    tailFb: 0.23,
    tailDamp: 1900,
  }),
};

// Header wave physics per car. runnerMs is the REAL flight time of a pulse from
// the port to the collector (hot exhaust ~550 m/s, 0.5-1 m primaries = 1-2 ms).
// runnerSpread is how unequal the primaries are: a boxer's long/short runners
// make its pulses arrive unevenly (the warble), a V12's equal-length header
// does not. Applied after ROUTING so these values win.
const WAVE: Record<string, Partial<VoiceProfile>> = {
  // twin-turbo V6s: medium runners, turbine soaks up the sharp edges
  "gtr-nismo": { runnerMs: 1.5, runnerSpread: 0.35, reflG: 0.3, collMs: 1.8, collFb: 0.3, turbo: 0.5, turboHz: 1400 },
  "gtr-gt3": { runnerMs: 1.6, runnerSpread: 0.38, reflG: 0.32, collMs: 2.0, collFb: 0.32, turbo: 0.45, turboHz: 1500 },
  "296-gt3": { runnerMs: 1.3, runnerSpread: 0.32, reflG: 0.3, collMs: 1.6, collFb: 0.28, turbo: 0.45, turboHz: 1600 },
  // turbo inline-6: longest primaries, 1-3 / 4-6 scroll split
  "m4-gt3": { runnerMs: 1.9, runnerSpread: 0.3, reflG: 0.34, collMs: 2.2, collFb: 0.32, turbo: 0.5, turboHz: 1400 },
  // turbo V8s
  "488-gte": { runnerMs: 1.2, runnerSpread: 0.25, reflG: 0.28, collMs: 1.4, collFb: 0.26, turbo: 0.45, turboHz: 1600 },
  "vantage-gte": { runnerMs: 1.4, runnerSpread: 0.3, reflG: 0.3, collMs: 1.6, collFb: 0.28, turbo: 0.45, turboHz: 1500 },
  // NA V8s: short primaries, strong tuned reflection
  "918": { runnerMs: 0.9, runnerSpread: 0.16, reflG: 0.36, collMs: 1.1, collFb: 0.22, turbo: 0 },
  c8r: { runnerMs: 1.1, runnerSpread: 0.2, reflG: 0.34, collMs: 1.3, collFb: 0.24, turbo: 0 },
  "amg-gt3": { runnerMs: 1.1, runnerSpread: 0.22, reflG: 0.34, collMs: 1.3, collFb: 0.24, turbo: 0 },
  // boxer-6: deliberately unequal primaries = the boxer warble
  "911-gt3r": { runnerMs: 1.0, runnerSpread: 0.55, reflG: 0.38, collMs: 1.2, collFb: 0.24, turbo: 0 },
  "911-rsr": { runnerMs: 1.2, runnerSpread: 0.58, reflG: 0.38, collMs: 1.4, collFb: 0.26, turbo: 0 },
  // V10 / V12: near-equal-length headers, smooth and crisp
  "huracan-gt3": { runnerMs: 0.85, runnerSpread: 0.12, reflG: 0.36, collMs: 1.0, collFb: 0.2, turbo: 0 },
  laferrari: { runnerMs: 0.75, runnerSpread: 0.07, reflG: 0.34, collMs: 0.9, collFb: 0.18, turbo: 0 },
};

// Extra mechanical detail per family. Big, slow, heavily loaded engines swing
// the crank more and slap harder; high-revving equal-length engines stay clean.
// ancMul is the ancillary drive ratio: alternator / pump whine tracks rpm at
// this many cycles per crank revolution.
const DETAIL2: Record<string, Partial<VoiceProfile>> = {
  "gtr-nismo": { tors: 0.055, slapHz: 560, slapG: 0.13, ancMul: 17, ancG: 0.2 },
  "gtr-gt3": { tors: 0.058, slapHz: 580, slapG: 0.14, ancMul: 17, ancG: 0.22 },
  "296-gt3": { tors: 0.046, slapHz: 680, slapG: 0.11, ancMul: 19, ancG: 0.2 },
  "m4-gt3": { tors: 0.052, slapHz: 540, slapG: 0.13, ancMul: 16, ancG: 0.21 },
  "488-gte": { tors: 0.042, slapHz: 700, slapG: 0.1, ancMul: 20, ancG: 0.19 },
  "vantage-gte": { tors: 0.055, slapHz: 560, slapG: 0.13, ancMul: 17, ancG: 0.2 },
  "918": { tors: 0.034, slapHz: 760, slapG: 0.08, ancMul: 22, ancG: 0.18 },
  c8r: { tors: 0.048, slapHz: 640, slapG: 0.12, ancMul: 19, ancG: 0.2 },
  "amg-gt3": { tors: 0.052, slapHz: 600, slapG: 0.13, ancMul: 18, ancG: 0.2 },
  "911-gt3r": { tors: 0.05, slapHz: 720, slapG: 0.14, ancMul: 21, ancG: 0.21 },
  "911-rsr": { tors: 0.052, slapHz: 700, slapG: 0.14, ancMul: 21, ancG: 0.21 },
  "huracan-gt3": { tors: 0.03, slapHz: 820, slapG: 0.07, ancMul: 24, ancG: 0.17 },
  laferrari: { tors: 0.022, slapHz: 900, slapG: 0.05, ancMul: 26, ancG: 0.15 },
};

// Layer signatures: (1) valvetrain/cam, (2) turbo spool + overrun, (3) cabin.
// Stripped race cabins ring more; road cabins are softer and lower. Small,
// fast turbos spool quickly and surge at a higher chop rate than big ones.
const SIGNATURE: Record<string, Partial<VoiceProfile>> = {
  "gtr-nismo": { camHz: 2350, camQ: 4.6, camG: 0.78, camInG: 0.55, spoolTau: 0.58, spoolHz: 5400, spoolG: 1.12, overG: 0.82, overHz: 10.5, cabHz: 76, cabQ: 2.0, cabG: 0.3, cab2Hz: 285, cab2G: 0.1, dopG: 0.75 },
  "918": { camHz: 3150, camQ: 5.8, camG: 0.62, camInG: 0.72, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 94, cabQ: 2.3, cabG: 0.34, cab2Hz: 340, cab2G: 0.11, dopG: 0.8 },
  laferrari: { camHz: 3400, camQ: 6.0, camG: 0.52, camInG: 0.78, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 96, cabQ: 2.2, cabG: 0.32, cab2Hz: 355, cab2G: 0.1, dopG: 0.8 },
  "911-gt3r": { camHz: 2920, camQ: 5.2, camG: 0.92, camInG: 0.82, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 104, cabQ: 2.6, cabG: 0.48, cab2Hz: 365, cab2G: 0.16, dopG: 1.0 },
  "huracan-gt3": { camHz: 3220, camQ: 5.8, camG: 0.6, camInG: 0.72, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 101, cabQ: 2.4, cabG: 0.43, cab2Hz: 350, cab2G: 0.14, dopG: 1.0 },
  "amg-gt3": { camHz: 2280, camQ: 4.8, camG: 0.84, camInG: 0.55, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 88, cabQ: 2.5, cabG: 0.5, cab2Hz: 315, cab2G: 0.17, dopG: 1.0 },
  "gtr-gt3": { camHz: 2480, camQ: 4.8, camG: 0.82, camInG: 0.58, spoolTau: 0.5, spoolHz: 5900, spoolG: 1.02, overG: 0.92, overHz: 11.5, cabHz: 84, cabQ: 2.4, cabG: 0.47, cab2Hz: 305, cab2G: 0.16, dopG: 1.0 },
  "296-gt3": { camHz: 2820, camQ: 5.2, camG: 0.72, camInG: 0.66, spoolTau: 0.36, spoolHz: 6900, spoolG: 0.92, overG: 0.72, overHz: 14.5, cabHz: 95, cabQ: 2.4, cabG: 0.45, cab2Hz: 335, cab2G: 0.15, dopG: 1.0 },
  "m4-gt3": { camHz: 2580, camQ: 5.0, camG: 0.76, camInG: 0.62, spoolTau: 0.42, spoolHz: 6400, spoolG: 0.98, overG: 0.78, overHz: 13, cabHz: 87, cabQ: 2.4, cabG: 0.44, cab2Hz: 310, cab2G: 0.15, dopG: 1.0 },
  "488-gte": { camHz: 2920, camQ: 5.2, camG: 0.66, camInG: 0.6, spoolTau: 0.4, spoolHz: 6650, spoolG: 0.94, overG: 0.76, overHz: 14, cabHz: 93, cabQ: 2.4, cabG: 0.46, cab2Hz: 330, cab2G: 0.15, dopG: 1.0 },
  "911-rsr": { camHz: 2840, camQ: 5.2, camG: 0.96, camInG: 0.86, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 99, cabQ: 2.6, cabG: 0.53, cab2Hz: 355, cab2G: 0.18, dopG: 1.0 },
  c8r: { camHz: 2620, camQ: 5.0, camG: 0.86, camInG: 0.62, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 90, cabQ: 2.5, cabG: 0.51, cab2Hz: 320, cab2G: 0.17, dopG: 1.0 },
  "vantage-gte": { camHz: 2320, camQ: 4.8, camG: 0.8, camInG: 0.56, spoolTau: 0.52, spoolHz: 5650, spoolG: 1.04, overG: 0.74, overHz: 11.5, cabHz: 85, cabQ: 2.4, cabG: 0.49, cab2Hz: 300, cab2G: 0.16, dopG: 1.0 },
};

// Header-wave / detail / signature entries for the v3 additions
Object.assign(WAVE, {
  vulcan: { runnerMs: 0.7, runnerSpread: 0.09, reflG: 0.36, collMs: 0.85, collFb: 0.18, turbo: 0 },
  viper: { runnerMs: 1.15, runnerSpread: 0.24, reflG: 0.3, collMs: 1.35, collFb: 0.26, turbo: 0 },
  agera: { runnerMs: 1.25, runnerSpread: 0.24, reflG: 0.28, collMs: 1.45, collFb: 0.27, turbo: 0.5, turboHz: 1650 },
  demon: { runnerMs: 1.3, runnerSpread: 0.3, reflG: 0.3, collMs: 1.5, collFb: 0.28, turbo: 0 },
});
Object.assign(DETAIL2, {
  vulcan: { tors: 0.024, slapHz: 880, slapG: 0.055, ancMul: 26, ancG: 0.15 },
  viper: { tors: 0.06, slapHz: 520, slapG: 0.15, ancMul: 15, ancG: 0.22 },
  agera: { tors: 0.044, slapHz: 690, slapG: 0.1, ancMul: 20, ancG: 0.19 },
  demon: { tors: 0.058, slapHz: 570, slapG: 0.14, ancMul: 17, ancG: 0.21 },
});
Object.assign(SIGNATURE, {
  vulcan: { camHz: 3350, camQ: 6.0, camG: 0.55, camInG: 0.8, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 92, cabQ: 2.4, cabG: 0.42, cab2Hz: 345, cab2G: 0.14, dopG: 0.9 },
  viper: { camHz: 2300, camQ: 4.6, camG: 0.85, camInG: 0.55, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 78, cabQ: 2.2, cabG: 0.38, cab2Hz: 290, cab2G: 0.12, dopG: 0.8 },
  agera: { camHz: 2880, camQ: 5.2, camG: 0.68, camInG: 0.6, spoolTau: 0.42, spoolHz: 7000, spoolG: 1.18, overG: 0.85, overHz: 13.5, cabHz: 90, cabQ: 2.3, cabG: 0.36, cab2Hz: 325, cab2G: 0.12, dopG: 0.85 },
  demon: { camHz: 2260, camQ: 4.8, camG: 0.86, camInG: 0.55, spoolTau: 0.4, spoolHz: 6200, spoolG: 0, overG: 0, overHz: 13, cabHz: 80, cabQ: 2.3, cabG: 0.4, cab2Hz: 295, cab2G: 0.13, dopG: 0.8 },
});

// ── v3 hybrid layer tuning per car ─────────────────────────────────────────
// `orders` are the main branch's harmonic weights for each engine family,
// `orderPeak` caps how far the loudest order may migrate with rpm (the
// anti-F1 control), `rare` hollows the pulse, `raspAM` is the inter-bank
// tear, `crackle` the per-firing stochastic burst. Applied last so these win.
const HYBRID: Record<string, Partial<VoiceProfile>> = {
  "gtr-nismo": { rare: 0.24, raspAM: 0.2, orders: [1.0, 0.6, 0.9, 0.7, 0.4, 0.3], orderGain: 0.38, orderPeak: 4.0, crackle: 0.3, crackleHz: 4200, formantHeat: 0.7 },
  "918": { rare: 0.2, raspAM: 0.5, orders: [1.0, 1.4, 0.6, 0.8], orderGain: 0.44, orderPeak: 4.4, crackle: 0.26, crackleHz: 5000, formantHeat: 0.85 },
  laferrari: { rare: 0.38, raspAM: 0.55, orders: [0.9, 1.0, 0.55, 0.95, 0.42, 0.62, 0.3, 0.2], orderGain: 0.5, orderPeak: 3.4, crackle: 0.2, crackleHz: 5200, formantHeat: 0.9 },
  "911-gt3r": { rare: 0.26, raspAM: 0.42, orders: [0.95, 0.7, 1.1, 0.6, 0.4], orderGain: 0.4, orderPeak: 4.6, crackle: 0.42, crackleHz: 5400, formantHeat: 0.9 },
  "huracan-gt3": { rare: 0.24, raspAM: 0.5, orders: [0.9, 0.8, 1.0, 0.7, 0.4, 0.25], orderGain: 0.44, orderPeak: 4.2, crackle: 0.3, crackleHz: 5100, formantHeat: 0.85 },
  "amg-gt3": { rare: 0.3, raspAM: 0.12, orders: [1.0, 0.85, 0.6, 0.45, 0.28], orderGain: 0.42, orderPeak: 3.2, crackle: 0.34, crackleHz: 4100, formantHeat: 0.6, charger: 0 },
  "gtr-gt3": { rare: 0.25, raspAM: 0.22, orders: [1.0, 0.65, 0.9, 0.65, 0.4], orderGain: 0.38, orderPeak: 4.0, crackle: 0.36, crackleHz: 4300, formantHeat: 0.7 },
  "296-gt3": { rare: 0.22, raspAM: 0.34, orders: [0.95, 0.7, 1.0, 0.7, 0.4], orderGain: 0.4, orderPeak: 4.4, crackle: 0.34, crackleHz: 4900, formantHeat: 0.85 },
  "m4-gt3": { rare: 0.26, raspAM: 0.18, orders: [1.05, 0.7, 0.95, 0.6, 0.35], orderGain: 0.4, orderPeak: 3.8, crackle: 0.28, crackleHz: 4000, formantHeat: 0.7 },
  "488-gte": { rare: 0.22, raspAM: 0.4, orders: [1.0, 0.6, 1.05, 0.5, 0.35], orderGain: 0.4, orderPeak: 4.2, crackle: 0.32, crackleHz: 4700, formantHeat: 0.8 },
  "911-rsr": { rare: 0.25, raspAM: 0.44, orders: [0.9, 0.7, 1.15, 0.65, 0.4], orderGain: 0.4, orderPeak: 4.8, crackle: 0.4, crackleHz: 5500, formantHeat: 0.9 },
  c8r: { rare: 0.24, raspAM: 0.38, orders: [1.05, 0.6, 1.0, 0.55, 0.35], orderGain: 0.42, orderPeak: 4.0, crackle: 0.36, crackleHz: 4500, formantHeat: 0.8 },
  "vantage-gte": { rare: 0.3, raspAM: 0.14, orders: [1.0, 0.85, 0.6, 0.45, 0.28], orderGain: 0.42, orderPeak: 3.2, crackle: 0.32, crackleHz: 4100, formantHeat: 0.6 },
};

// apply the routing table, then the header wave physics, then detail, on top of the voices
for (const k of Object.keys(ROUTING)) {
  if (VOICES[k]) Object.assign(VOICES[k], ROUTING[k]);
}
for (const k of Object.keys(WAVE)) {
  if (VOICES[k]) Object.assign(VOICES[k], WAVE[k]);
}
for (const k of Object.keys(DETAIL2)) {
  if (VOICES[k]) Object.assign(VOICES[k], DETAIL2[k]);
}
for (const k of Object.keys(SIGNATURE)) {
  if (VOICES[k]) Object.assign(VOICES[k], SIGNATURE[k]);
}
for (const k of Object.keys(HYBRID)) {
  if (VOICES[k]) Object.assign(VOICES[k], HYBRID[k]);
}
