// Vehicle pages: Steering / Suspension / Aero / Power / Tyres / Data. Every
// slider binds to a real arena/215a6f39-frontier tunable — the BINDINGS table
// is the control contract the C++ port transcribes (path, range, unit).
// Renderers return HTML strings; wire* attaches listeners. No DOM at import.

export const TuneState = {
  steering: { sensitivity: 1.0, linearity: 1.0, deadzone: 0.05, wheelRange: 900, ffb: 0.7, rampRate: 3.5, returnRate: 5.0 },
  suspension: { freqF: 2.0, freqR: 2.0, dampF: 0.6, dampR: 0.6, curve: 'digressive', hardening: 1.5, arbF: 80000, arbR: 80000, arbFOn: true, arbROn: true },
  aero: { wing: 14, adaptive: true, threshold: 35, brakeDeploy: 10, splitter: true, canards: true, skirts: true, diffuser: true },
  power: { upshift: 6800, downshift: 2600, cooldown: 0.35, abs: true, slipTarget: 0.12, diff: 'lsd' },
  units: 'metric',
};

// path into TuneState, C++ header that owns it, range, unit. Pinned by Checks.mjs.
export const BINDINGS = [
  { path: ['steering', 'sensitivity'], src: 'DriverInputIntegrator.h InputConfiguration.SteeringSensitivity', min: 0.2, max: 2.0, step: 0.05, unit: '×', label: 'Steering sensitivity', note: 'Scales resolved steer. This is the stick/key response — NOT mouse-look.' },
  { path: ['steering', 'linearity'], src: 'InputConfiguration.SteeringLinearity', min: 0.5, max: 3.0, step: 0.1, unit: '', label: 'Steering linearity', note: 'Exponent. >1 = finer near centre.' },
  { path: ['steering', 'deadzone'], src: 'InputConfiguration.SteeringDeadZone', min: 0.0, max: 0.25, step: 0.01, unit: '', label: 'Steering dead zone', note: 'Analog band ignored around centre.' },
  { path: ['steering', 'wheelRange'], src: 'InputConfiguration.WheelRotationRange', min: 270, max: 1080, step: 10, unit: '°', label: 'Wheel rotation range', note: 'Physical wheel mapped to full lock.' },
  { path: ['steering', 'ffb'], src: 'InputConfiguration.ForceFeedbackStrength', min: 0, max: 1, step: 0.05, unit: '', label: 'Force feedback', note: 'Surfaced for the FFB driver.' },
  { path: ['steering', 'rampRate'], src: 'InputConfiguration.SteerRate', min: 0.5, max: 10, step: 0.1, unit: '/s', label: 'Key steer rate', note: 'Keyboard build toward full lock.' },
  { path: ['steering', 'returnRate'], src: 'InputConfiguration.SteerReturnRate', min: 0.5, max: 12, step: 0.1, unit: '/s', label: 'Self-centring rate', note: 'Keyboard return when keys released.' },
  { path: ['suspension', 'freqF'], src: 'SuspensionSpecification.NaturalFrequency (front)', min: 1.0, max: 3.5, step: 0.05, unit: 'Hz', label: 'Ride frequency · front', note: 'The ride knob. Rate derives: k = m·ω².' },
  { path: ['suspension', 'freqR'], src: 'SuspensionSpecification.NaturalFrequency (rear)', min: 1.0, max: 3.5, step: 0.05, unit: 'Hz', label: 'Ride frequency · rear', note: '' },
  { path: ['suspension', 'dampF'], src: 'SuspensionSpecification.DampingRatio (front)', min: 0.1, max: 1.2, step: 0.05, unit: 'ζ', label: 'Damping ratio · front', note: '1.0 = critical. Road cars 0.2–0.7.' },
  { path: ['suspension', 'dampR'], src: 'SuspensionSpecification.DampingRatio (rear)', min: 0.1, max: 1.2, step: 0.05, unit: 'ζ', label: 'Damping ratio · rear', note: '' },
  { path: ['suspension', 'hardening'], src: 'SuspensionSpecification.HardeningFactor', min: 1.0, max: 3.0, step: 0.1, unit: '×', label: 'Hardening factor', note: 'Rate multiplier at full travel.' },
  { path: ['suspension', 'arbF'], src: 'AntiRollBar.Stiffness (front)', min: 0, max: 200000, step: 5000, unit: 'N/m', label: 'Anti-roll bar · front', note: 'Resists differential compression.' },
  { path: ['suspension', 'arbR'], src: 'AntiRollBar.Stiffness (rear)', min: 0, max: 200000, step: 5000, unit: 'N/m', label: 'Anti-roll bar · rear', note: '' },
  { path: ['aero', 'wing'], src: 'AeroWing.CurrentAngle_deg', min: 4, max: 22, step: 0.5, unit: '°', label: 'Rear wing angle', note: 'GT3 kit. Adaptive trims around this.' },
  { path: ['aero', 'threshold'], src: 'AeroWing.AdaptiveSpeedThreshold_ms', min: 15, max: 70, step: 1, unit: 'm/s', label: 'Adaptive threshold', note: 'Speed where the wing starts trimming.' },
  { path: ['aero', 'brakeDeploy'], src: 'AeroWing.BrakeDeployAngle_deg', min: 0, max: 20, step: 1, unit: '°', label: 'Air-brake deploy', note: 'Extra angle under braking.' },
  { path: ['power', 'upshift'], src: 'VehicleSolverConfiguration.UpshiftRPM', min: 4000, max: 7500, step: 50, unit: 'rpm', label: 'Upshift point', note: 'AMT auto-upshift threshold.' },
  { path: ['power', 'downshift'], src: 'VehicleSolverConfiguration.DownshiftRPM', min: 1500, max: 4500, step: 50, unit: 'rpm', label: 'Downshift point', note: 'AMT auto-downshift threshold.' },
  { path: ['power', 'cooldown'], src: 'VehicleSolverConfiguration.ShiftCooldownSeconds', min: 0.1, max: 1.0, step: 0.05, unit: 's', label: 'Shift cooldown', note: 'Minimum dwell between gears.' },
  { path: ['power', 'slipTarget'], src: 'AbsParameters.SlipTarget', min: 0.04, max: 0.25, step: 0.01, unit: '', label: 'ABS slip target', note: 'Near the μ–slip peak for a race tyre.' },
];

const get = (p) => p.reduce((o, k) => o[k], TuneState);
const set = (p, v) => { const o = p.slice(0, -1).reduce((a, k) => a[k], TuneState); o[p[p.length - 1]] = v; };
const byId = (id) => BINDINGS.find((b) => b.path.join('.') === id);
const fmt = (b, v) => `${(+v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${b.unit ? ' ' + b.unit : ''}`;

function sliderRow(id) {
  const b = byId(id);
  const v = get(b.path);
  return `<div class="row"><label>${b.label}${b.note ? `<small>${b.note}</small>` : ''}</label>
    <input type="range" data-bind="${id}" min="${b.min}" max="${b.max}" step="${b.step}" value="${v}">
    <output data-out="${id}">${fmt(b, v)}</output></div>`;
}
function toggleRow(path, label, note) {
  const id = path.join('.');
  return `<div class="row"><label>${label}${note ? `<small>${note}</small>` : ''}</label>
    <span class="switch"><input type="checkbox" data-toggle="${id}" ${get(path) ? 'checked' : ''}><i></i></span></div>`;
}
function segRow(path, label, options, note) {
  const id = path.join('.');
  const cur = get(path);
  return `<div class="row"><label>${label}${note ? `<small>${note}</small>` : ''}</label>
    <span class="seg" data-seg="${id}">${options.map((o) =>
      `<button data-val="${o[0]}" class="${o[0] === cur ? 'on' : ''}">${o[1]}</button>`).join('')}</span></div>`;
}
export function readoutRow(label, snapKey, unit, fmtFn) {
  return `<div class="row"><label>${label}</label>
    <output data-snap="${snapKey}" data-unit="${unit || ''}" data-fmt="${fmtFn || ''}">—</output></div>`;
}

const head = (t, s) => `<h1>${t}</h1><p class="sub">${s}</p>`;

export function renderSteering() {
  return head('Steering', 'DriverInputIntegrator · keyboard, gamepad and wheel mappings') +
    `<div class="grid2"><div class="card"><h2>Response</h2>
      ${sliderRow('steering.sensitivity')}${sliderRow('steering.linearity')}${sliderRow('steering.deadzone')}
    </div><div class="card"><h2>Hardware</h2>
      ${sliderRow('steering.wheelRange')}${sliderRow('steering.ffb')}
    </div><div class="card"><h2>Keyboard feel</h2>
      ${sliderRow('steering.rampRate')}${sliderRow('steering.returnRate')}
    </div><div class="card"><h2>Live</h2>
      ${readoutRow('Steer angle', 'steer', '')}${readoutRow('Throttle', 'throttle', '%', 'pct')}${readoutRow('Brake', 'brake', '%', 'pct')}
    </div></div>`;
}

export function renderSuspension() {
  return head('Suspension', 'One strut per corner + anti-roll bar per axle · GRIT-derived 2.0 Hz calibration') +
    `<div class="grid2"><div class="card"><h2>Ride · front axle</h2>
      ${sliderRow('suspension.freqF')}${sliderRow('suspension.dampF')}
      ${sliderRow('suspension.arbF')}${toggleRow(['suspension', 'arbFOn'], 'Bar fitted', 'Unfit to compare warp compliance.')}
    </div><div class="card"><h2>Ride · rear axle</h2>
      ${sliderRow('suspension.freqR')}${sliderRow('suspension.dampR')}
      ${sliderRow('suspension.arbR')}${toggleRow(['suspension', 'arbROn'], 'Bar fitted', '')}
    </div><div class="card"><h2>Spring curve</h2>
      ${segRow(['suspension', 'curve'], 'Curve shape', [['linear', 'Linear'], ['progressive', 'Progressive'], ['digressive', 'Digressive']], 'Cubic F(x) = k₁x + k₂x² + k₃x³.')}
      ${sliderRow('suspension.hardening')}
      ${readoutRow('Travel envelope', '', '', 'travel')}
    </div><div class="card"><h2>Live · damper travel</h2>
      ${readoutRow('FL', 'travel0', 'mm', 'travelCorner')}${readoutRow('FR', 'travel1', 'mm', 'travelCorner')}
      ${readoutRow('RL', 'travel2', 'mm', 'travelCorner')}${readoutRow('RR', 'travel3', 'mm', 'travelCorner')}
    </div></div>`;
}

export function renderAero() {
  return head('Aerodynamics', 'GT3 adaptive kit · downforce feeds wheel load Fz, drag feeds the chassis') +
    `<div class="grid2"><div class="card"><h2>Rear wing</h2>
      ${sliderRow('aero.wing')}${toggleRow(['aero', 'adaptive'], 'Adaptive (DRS-style)', 'Trims angle with speed.')}
      ${sliderRow('aero.threshold')}${sliderRow('aero.brakeDeploy')}
    </div><div class="card"><h2>Devices</h2>
      ${toggleRow(['aero', 'splitter'], 'Front splitter', 'Ground-effect sensitive.')}
      ${toggleRow(['aero', 'canards'], 'Canards', 'Adaptive with throttle reduction.')}
      ${toggleRow(['aero', 'skirts'], 'Side skirts', 'Ground-effect sealing suction.')}
      ${toggleRow(['aero', 'diffuser'], 'Diffuser + floor', 'Venturi + pressure recovery.')}
    </div><div class="card"><h2>Live · loads</h2>
      ${readoutRow('Wing angle now', 'wingAngleDeg', '°', 'f1')}
      ${readoutRow('Downforce · front', 'downforceFrontN', 'N', 'f0')}
      ${readoutRow('Downforce · rear', 'downforceRearN', 'N', 'f0')}
      ${readoutRow('Drag', 'dragN', 'N', 'f0')}
    </div><div class="card"><h2>Presets</h2>
      <div class="row"><label>Corner<small>Max downforce</small></label><button class="btn ghost" data-preset="corner">Apply</button></div>
      <div class="row"><label>Straight<small>Min drag</small></label><button class="btn ghost" data-preset="straight">Apply</button></div>
      <div class="row"><label>Air-brake test<small>Deploy +10° for 3 s</small></label><button class="btn warn" data-preset="airbrake">Test</button></div>
    </div></div>`;
}

export function renderPower() {
  return head('Powertrain & brakes', 'Turbo GTR-spec AMT · GT3 brakes · proportional ABS') +
    `<div class="grid2"><div class="card"><h2>Gearbox (AMT)</h2>
      ${sliderRow('power.upshift')}${sliderRow('power.downshift')}${sliderRow('power.cooldown')}
      ${segRow(['power', 'diff'], 'Differential', [['open', 'Open'], ['lsd', 'LSD'], ['locked', 'Locked'], ['tv', 'Vectoring']], '')}
    </div><div class="card"><h2>Brakes</h2>
      ${toggleRow(['power', 'abs'], 'ABS', 'Slip-regulating, not bang-bang.')}
      ${sliderRow('power.slipTarget')}
    </div><div class="card"><h2>Live · engine</h2>
      ${readoutRow('RPM', 'rpm', 'rpm', 'f0')}${readoutRow('Gear', 'gear', '', 'gear')}
      ${readoutRow('Boost', 'boostBar', 'bar', 'f2')}${readoutRow('Speed', 'speedKmh', 'km/h', 'f0')}
    </div><div class="card"><h2>Live · brake temps</h2>
      ${readoutRow('FL', 'brake0', '°C', 'f0')}${readoutRow('FR', 'brake1', '°C', 'f0')}
      ${readoutRow('RL', 'brake2', '°C', 'f0')}${readoutRow('RR', 'brake3', '°C', 'f0')}
    </div></div>`;
}

export function renderTyres() {
  const corner = (i, name) => `<div class="row"><label>${name}<small data-tyrebar="${i}"></small></label>
    <span class="bar"><i data-tyreheat="${i}"></i></span><output data-snap="tyre${i}" data-fmt="f0">—</output></div>`;
  return head('Tyres', 'XPBD soft carcass + Pacejka MF6.1 + per-wheel thermals · read-only') +
    `<div class="grid2"><div class="card"><h2>Carcass temp</h2>
      ${corner(0, 'Front left')}${corner(1, 'Front right')}${corner(2, 'Rear left')}${corner(3, 'Rear right')}
    </div><div class="card"><h2>Slip model</h2>
      ${readoutRow('Solver', '', '', 'static-relax')}${readoutRow('Grip μ', '', '', 'static-mu')}
      ${readoutRow('Slip ratio', 'slip', '', 'slip')}${readoutRow('Lateral G', 'gLat', 'g', 'f2')}
    </div></div>`;
}

export function renderData() {
  return head('Data', 'Telemetry snapshot · same feed as the cluster') +
    `<div class="grid3">
      <div class="card"><h2>Speed</h2>${readoutRow('km/h', 'speedKmh', '', 'f0big')}${readoutRow('Gear', 'gear', '', 'gear')}</div>
      <div class="card"><h2>Engine</h2>${readoutRow('RPM', 'rpm', '', 'f0big')}${readoutRow('Boost', 'boostBar', 'bar', 'f2')}</div>
      <div class="card"><h2>Pedals</h2>${readoutRow('Throttle', 'throttle', '%', 'pct')}${readoutRow('Brake', 'brake', '%', 'pct')}</div>
      <div class="card"><h2>G force</h2>${readoutRow('Lateral', 'gLat', 'g', 'f2')}${readoutRow('Longitudinal', 'gLong', 'g', 'f2')}</div>
      <div class="card"><h2>Trip</h2>${readoutRow('Odometer', 'odoKm', 'km', 'f1')}${readoutRow('Trip', 'tripKm', 'km', 'f1')}${readoutRow('Fuel', 'fuelPct', '%', 'f0')}</div>
      <div class="card"><h2>Aero</h2>${readoutRow('Downforce F', 'downforceFrontN', 'N', 'f0')}${readoutRow('Downforce R', 'downforceRearN', 'N', 'f0')}</div>
    </div>`;
}

export function wireVehiclePage(root) {
  root.querySelectorAll('input[data-bind]').forEach((el) => {
    const paint = () => {
      const b = byId(el.dataset.bind);
      const pct = ((+el.value - b.min) / (b.max - b.min)) * 100;
      el.style.setProperty('--fill', pct + '%');
      set(b.path, +el.value);
      const out = root.querySelector(`output[data-out="${el.dataset.bind}"]`);
      if (out) out.textContent = fmt(b, el.value);
    };
    el.addEventListener('input', paint); paint();
  });
  root.querySelectorAll('input[data-toggle]').forEach((el) => {
    el.addEventListener('change', () => set(el.dataset.toggle.split('.'), el.checked));
  });
  root.querySelectorAll('[data-seg]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      set(seg.dataset.seg.split('.'), b.dataset.val);
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }));
  });
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    if (p === 'corner') Object.assign(TuneState.aero, { wing: 22, adaptive: true });
    if (p === 'straight') Object.assign(TuneState.aero, { wing: 4, adaptive: true });
    if (p === 'airbrake') { TuneState.aero.wing = 22; setTimeout(() => { TuneState.aero.wing = 14; }, 3000); }
    tabletRefreshNotice(b, p === 'airbrake' ? 'Air-brake deployed · 3 s' : `Preset applied · ${p}`);
  }));
}

function tabletRefreshNotice(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1600);
}
