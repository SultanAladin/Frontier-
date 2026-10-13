// Fake vehicle snapshot — stands in for the C++ per-HMI-tick copy of solver
// state (speed, rpm, gear, temps, travels, aero loads). A scripted 24 s drive
// cycle (launch → cruise → brake → pull → coast) plus noise, so gauges,
// data pages and the cluster all move without a solver behind them.
// C++ landing spot: the vehicle snapshot struct fed to HmiRenderSequence.
// DOM-free: Checks.mjs ticks this in node.

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
// Deterministic wobble (no Math.random: checks must reproduce the trace).
function wob(seed, t) { return Math.sin(t * 2.1 + seed) * 0.6 + Math.sin(t * 5.7 + seed * 2.0) * 0.4; }

export class Snapshot {
  constructor() { this.t = 0; }

  // Advance the cycle by dt seconds. Pure function of (t, dt).
  tick(dt) { this.t += Math.max(0, dt); return this.read(); }

  read() {
    const t = this.t % 24;
    // Speed profile [km/h] over the 24 s loop.
    let speed;
    if (t < 6) speed = lerp(0, 182, t / 6);                    // launch
    else if (t < 10) speed = 182 + wob(1, t) * 1.5;            // cruise
    else if (t < 13) speed = lerp(182, 58, (t - 10) / 3);      // brake
    else if (t < 18) speed = lerp(58, 224, (t - 13) / 5);      // pull
    else speed = lerp(224, 40, (t - 18) / 6);                  // coast
    speed = Math.max(0, speed);

    const gear = speed < 1 ? 0 : clamp(1 + Math.floor(speed / 34), 1, 7); // 0 = N
    const inGear = gear === 0 ? 0 : (speed - (gear - 1) * 34) / 34;
    const rpm = gear === 0 ? 780 + wob(2, t) * 30
      : 1500 + clamp(inGear, 0, 1) * 5400 + wob(3, t) * 60;
    const throttle = t < 6 || (t >= 13 && t < 18) ? 0.85 + wob(4, t) * 0.1
      : t < 10 ? 0.25 : 0.05;
    const brake = t >= 10 && t < 13 ? 0.7 : 0;
    const steer = wob(5, t * 0.4) * 0.3;
    const boost = clamp((throttle - 0.2) * 1.4, 0, 1.2);      // [bar]
    const heat = clamp(t / 24, 0, 1);
    const tyre = [0, 1, 2, 3].map((i) => 62 + heat * 34 + wob(10 + i, t * 0.8) * 3);
    const brakes = [0, 1, 2, 3].map((i) => 180 + heat * 260 + (i < 2 ? 60 : 0) + wob(20 + i, t) * 8);
    const travel = [0, 1, 2, 3].map((i) => 0.045 + wob(30 + i, t * 1.7) * 0.012); // [m]
    const wing = 14 - clamp(speed / 3.6 / 60, 0, 1) * 8 + (brake > 0 ? 10 : 0); // adaptive + air-brake
    const v = speed / 3.6;
    const q = 0.5 * 1.225 * v * v;                            // dynamic pressure
    const downF = q * 0.75 * 0.9, downR = q * 1.4 * (wing / 22) * 1.8;
    return {
      t: this.t, speedKmh: speed, rpm, gear, throttle: clamp(throttle, 0, 1), brake,
      steer, boostBar: boost, tyreTempC: tyre, brakeTempC: brakes,
      damperTravelM: travel, wingAngleDeg: wing,
      downforceFrontN: downF, downforceRearN: downR, dragN: q * 0.62,
      gLat: steer * v * 0.04, gLong: (throttle - brake) * 0.5,
      fuelPct: 68, odoKm: 1204.6 + this.t * speed / 3600, tripKm: 18.2,
      sessionPlayers: 3,
    };
  }
}

// Drive a callback at hz with a fresh snapshot. Returns a stop function.
export function startSnapshot(hz, cb) {
  const snap = new Snapshot();
  const step = 1 / hz;
  let last = performance.now();
  let acc = 0, id = 0;
  const frame = (now) => {
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    while (acc >= step) { acc -= step; cb(snap.tick(step)); }
    id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(id);
}
