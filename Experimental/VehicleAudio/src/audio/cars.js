// Vehicle definitions for the synthesis core.
//
// Every value is either a physical quantity (rpm, Nm, kg, m, s) or a sound-design
// coefficient. Engine layouts follow the public spec of each car's road/race
// engine; the numbers are approximations meant to drive the model, not
// manufacturer data. Exhaust "modes" are [frequency Hz, Q, gain] resonators that
// model the tuned exhaust/manifold system the combustion pulses are fed into.
//
// Turbo layouts add a spool model; all cars share the same mechanical, fuel and
// NOS systems, so sound differences come from the data below.

export const CARS = [
  {
    id: 'porsche-911-gt3',
    name: 'Porsche 911 GT3',
    spec: '4.0 L flat-six · naturally aspirated · boxer',
    cylinders: 6,
    valves: 24,
    idleRpm: 850,
    redline: 8800,
    // [rpm, Nm] engine torque at full load
    torque: [[800, 260], [2000, 340], [3500, 410], [5200, 455], [6200, 470], [7200, 455], [8000, 425], [8800, 380]],
    inertia: 0.20,
    friction: [16, 0.0035],   // Nm: constant + per-rpm
    pumpLoss: 5,              // Nm per 1000 rpm when the throttle is shut
    gears: [3.15, 2.25, 1.78, 1.47, 1.27, 1.11],
    finalDrive: 3.2,
    wheelRadius: 0.345,
    mass: 1450,
    cdA: 0.62,
    crr: 0.013,
    brakeForce: 14000,
    blipRpm: 1100,
    // Firing-slot stereo positions (-1 left .. +1 right): boxer banks alternate.
    pan: [-0.7, 0.7, -0.7, 0.7, -0.7, 0.7],
    modes: [[125, 5, 0.9], [270, 4.5, 0.75], [540, 5, 0.65], [1000, 6, 0.5], [2150, 7, 0.36], [4400, 9, 0.2]],
    pulseTau: 0.00055,        // combustion pulse decay (s): short = bright
    roughness: 0.12,          // cycle-to-cycle amplitude scatter
    jitterDeg: 0.6,           // firing-angle scatter (deg)
    noise: 0.15,               // broadband noise inside each combustion event
    baseLevel: 0.85,
    exhaustGain: 1,
    intake: { freq: 820, q: 1.2, gain: 0.04 },   // naturally aspirated induction roar
    turbo: null,
    gearTeeth: 19,
    gearWhine: 0.010,
    ticks: 0.012,            // valvetrain tick level
    crackle: 0.35,           // overrun crackle probability scale
    popGain: 0.6,
    injHiss: 0.008,
    pumpGain: 0.003,
    windGain: 0.02,
    clunk: 0.25,             // sequential shift dog-engagement clunk
    nosSeconds: 14,
  },
  {
    id: 'nissan-gtr-nismo-gt3',
    name: 'Nissan GT-R NISMO GT3',
    spec: '3.8 L twin-turbo VR38DETT · 60° V6',
    cylinders: 6,
    valves: 24,
    idleRpm: 900,
    redline: 7400,
    torque: [[800, 300], [2000, 480], [3200, 600], [4500, 640], [5500, 630], [6500, 585], [7400, 520]],
    inertia: 0.24,
    friction: [18, 0.0038],
    pumpLoss: 6,
    gears: [3.0, 2.2, 1.75, 1.45, 1.25, 1.1],
    finalDrive: 3.35,
    wheelRadius: 0.35,
    mass: 1370,
    cdA: 0.66,
    crr: 0.013,
    brakeForce: 15000,
    blipRpm: 1000,
    pan: [-0.7, 0.7, -0.7, 0.7, -0.7, 0.7],
    modes: [[90, 5, 1.0], [210, 4.5, 0.8], [440, 5, 0.6], [880, 6, 0.5], [1700, 7, 0.34], [3400, 8, 0.18]],
    pulseTau: 0.0007,
    roughness: 0.10,
    jitterDeg: 0.5,
    noise: 0.13,
    baseLevel: 0.8,
    exhaustGain: 1,
    intake: { freq: 600, q: 1.0, gain: 0.02 },
    turbo: {
      spoolUp: 0.32,          // s, first-order spool time constants
      spoolDown: 0.55,
      whineMin: 2600,         // Hz compressor whine at low / high spool
      whineMax: 8000,
      whineGain: 0.035,
      hissGain: 0.008,
      bovGain: 0.12,          // blow-off valve "psshh" on throttle lift
      wastegate: 0.04,        // wastegate rattle when boosting hard
      wgHz: 40,
    },
    gearTeeth: 17,
    gearWhine: 0.008,
    ticks: 0.008,
    crackle: 0.25,
    popGain: 0.7,
    injHiss: 0.008,
    pumpGain: 0.003,
    windGain: 0.02,
    clunk: 0.3,
    nosSeconds: 16,
  },
  {
    id: 'ferrari-488-gt3',
    name: 'Ferrari 488 GT3',
    spec: '3.9 L twin-turbo V8 · 90° flat-plane crank',
    cylinders: 8,
    valves: 32,
    idleRpm: 950,
    redline: 8250,
    torque: [[900, 320], [2500, 560], [4000, 690], [5500, 700], [6500, 660], [7500, 600], [8250, 540]],
    inertia: 0.19,
    friction: [18, 0.0036],
    pumpLoss: 6,
    gears: [3.0, 2.3, 1.85, 1.52, 1.3, 1.13],
    finalDrive: 3.5,
    wheelRadius: 0.345,
    mass: 1360,
    cdA: 0.70,
    crr: 0.013,
    brakeForce: 15000,
    blipRpm: 1000,
    pan: [-0.7, 0.7, -0.7, 0.7, 0.7, -0.7, 0.7, -0.7],
    modes: [[138, 5, 0.95], [300, 4.5, 0.7], [610, 4.5, 0.7], [1180, 5, 0.5], [2450, 6, 0.38], [5150, 8, 0.18]],
    pulseTau: 0.0005,
    roughness: 0.10,
    jitterDeg: 0.5,
    noise: 0.13,
    baseLevel: 0.75,
    exhaustGain: 1,
    intake: { freq: 900, q: 1.1, gain: 0.015 },
    turbo: {
      spoolUp: 0.28,
      spoolDown: 0.5,
      whineMin: 3000,
      whineMax: 9000,
      whineGain: 0.03,
      hissGain: 0.008,
      bovGain: 0.12,
      wastegate: 0.02,
      wgHz: 46,
    },
    gearTeeth: 21,
    gearWhine: 0.009,
    ticks: 0.009,
    crackle: 0.3,
    popGain: 0.55,
    injHiss: 0.008,
    pumpGain: 0.003,
    windGain: 0.02,
    clunk: 0.28,
    nosSeconds: 15,
  },
];

export function carById(id) {
  return CARS.find((car) => car.id === id) ?? CARS[0];
}
