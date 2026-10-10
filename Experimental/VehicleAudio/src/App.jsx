import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, Car, Cog, Download, Flame, Fuel, Gauge, KeyRound, Layers, Power, Radio,
  RotateCcw, Sparkles, SlidersHorizontal, Volume2, Wind, Wrench, Zap,
} from 'lucide-react';
import { CARS, carById } from './audio/cars.js';
import { vehicleAudio } from './audio/VehicleAudio.js';
import { renderClip } from './audio/engine-core.js';
import { encodeWav } from './audio/wav.js';

const LAYERS = [
  { key: 'exhaust', label: 'Exhaust', hint: 'Combustion pulses through the pipe resonators', icon: Volume2 },
  { key: 'intake', label: 'Intake', hint: 'Induction roar, follows throttle and rpm', icon: Wind },
  { key: 'turbo', label: 'Turbo', hint: 'Compressor whine, hiss, blow-off, wastegate', icon: Zap },
  { key: 'mechanical', label: 'Crank & valvetrain', hint: 'Valve ticks, gear-mesh whine, starter', icon: Cog },
  { key: 'metal', label: 'Metal', hint: 'Dog-gear shift clunk and ringing', icon: Wrench },
  { key: 'fuel', label: 'Fuel system', hint: 'Injector hiss, pump whine, starvation', icon: Fuel },
  { key: 'nos', label: 'NOS', hint: 'Nitrous bottle flow hiss', icon: Flame },
  { key: 'wind', label: 'Wind', hint: 'Broadband air noise above ~40 km/h', icon: Activity },
];

const DEFAULT_GAINS = Object.fromEntries(LAYERS.map((l) => [l.key, 1]));
const KEYS = { throttle: ['w', 'arrowup'], brake: ['s', 'arrowdown'], nos: ['n'], up: ['e', ']'], down: ['q', '['] };
const pedalInput = (p) => ({ throttle: p.throttle, brake: p.brake, nos: p.nos });

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-6));

const EMPTY_TELEMETRY = {
  state: 'off', gear: 0, rpm: 0, speedKmh: 0, throttle: 0, brake: 0, boost: 0,
  nos: 1, nosActive: false, fuel: 0.9, starving: false, limiter: false, shifting: false,
  misfires: 0, levels: Object.fromEntries(LAYERS.map((l) => [l.key, 0])),
};

export default function App() {
  const [carId, setCarId] = useState(CARS[0].id);
  const car = carById(carId);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [ignition, setIgnition] = useState(false);
  const [mode, setMode] = useState('auto');
  const [volume, setVolume] = useState(0.9);
  const [gains, setGains] = useState(DEFAULT_GAINS);
  const [fuelSetting, setFuelSetting] = useState(0.9);
  const [pedal, setPedal] = useState({ throttle: 0, brake: 0, nos: false });
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [audioInfo, setAudioInfo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState('');

  // Input state lives in refs so event handlers always see the latest values
  // without re-binding, and so messages are never sent from inside a state updater.
  const pedalRef = useRef({ throttle: 0, brake: 0, nos: false });
  const ignitionRef = useRef(false);
  const modeRef = useRef('auto');

  // Telemetry arrives from the audio thread (~23 Hz). The UI reads it; it never drives audio.
  useEffect(() => vehicleAudio.subscribe((t) => setTelemetry(t)), []);

  const send = (input) => vehicleAudio.send(input);

  const startAudio = async () => {
    setStarting(true);
    setError('');
    try {
      await vehicleAudio.start();
      vehicleAudio.setCar(carId);
      vehicleAudio.setVolume(volume);
      send({ layers: gains, fuel: fuelSetting, mode: modeRef.current, ignition: ignitionRef.current, ...pedalInput(pedalRef.current) });
      setAudioInfo(vehicleAudio.info);
      setStarted(true);
    } catch (err) {
      setError(err?.message || 'The browser refused to start audio.');
    } finally {
      setStarting(false);
    }
  };

  const stopAudio = async () => {
    await vehicleAudio.stop();
    setStarted(false);
  };

  const selectCar = (id) => {
    setCarId(id);
    vehicleAudio.setCar(id);
  };

  const toggleIgnition = () => {
    const next = !ignitionRef.current;
    ignitionRef.current = next;
    setIgnition(next);
    send({ ignition: next });
  };

  const toggleMode = () => {
    const next = modeRef.current === 'auto' ? 'manual' : 'auto';
    modeRef.current = next;
    setMode(next);
    send({ mode: next });
  };

  const setPedalState = (patch) => {
    const next = { ...pedalRef.current, ...patch };
    pedalRef.current = next;
    setPedal(next);
    send(pedalInput(next));
  };

  // Keyboard controls. Held keys act like pedals; shifts are edge-triggered.
  useEffect(() => {
    const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const down = (e) => {
      if (isTyping(e.target) || e.repeat) return;
      const k = e.key.toLowerCase();
      if (KEYS.throttle.includes(k)) setPedalState({ throttle: 1 });
      else if (KEYS.brake.includes(k)) setPedalState({ brake: 1 });
      else if (KEYS.nos.includes(k)) setPedalState({ nos: true });
      else if (KEYS.up.includes(k)) send({ shift: 1 });
      else if (KEYS.down.includes(k)) send({ shift: -1 });
      else if (k === 'i') toggleIgnition();
      else if (k === 'm') toggleMode();
      else if (k === 'f') { setFuelSetting(1); send({ refuel: true }); }
      else if (k === 'r') send({ refillNos: true });
      else return;
      if (['arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    };
    const up = (e) => {
      const k = e.key.toLowerCase();
      if (KEYS.throttle.includes(k)) setPedalState({ throttle: 0 });
      else if (KEYS.brake.includes(k)) setPedalState({ brake: 0 });
      else if (KEYS.nos.includes(k)) setPedalState({ nos: false });
    };
    const blur = () => setPedalState({ throttle: 0, brake: 0, nos: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // Handlers read refs only, so binding once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateGain = (key, value) => {
    const next = { ...gains, [key]: value };
    setGains(next);
    send({ layers: { [key]: value } });
  };

  const resetMixer = () => {
    setGains(DEFAULT_GAINS);
    send({ layers: DEFAULT_GAINS });
  };

  const updateVolume = (value) => {
    setVolume(value);
    vehicleAudio.setVolume(value);
  };

  const updateFuel = (value) => {
    setFuelSetting(value);
    send({ fuel: value });
  };

  const exportClip = () => {
    setExporting(true);
    setLastExport('');
    // Let the button state paint before the synchronous render blocks the page.
    setTimeout(() => {
      try {
        const sr = 48000;
        const seconds = 12;
        const script = (t) => {
          if (t < 0.01) return { ignition: true, throttle: 0, mode: 'auto' };
          if (t < 1.5) return null;
          if (t < 2) return { throttle: 1 };
          if (t < 6) return null;
          if (t < 7.5) return { throttle: 0 };
          if (t < 8) return { throttle: 1 };
          if (t < 9.5) return { nos: true };
          if (t < 9.51) return { nos: false, throttle: 0.2 };
          if (t < 10) return { brake: 0.8, throttle: 0 };
          if (t < 10.01) return { brake: 0 };
          return null;
        };
        const { L, R } = renderClip(car, seconds, script, sr);
        const blob = encodeWav(L, R, sr);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${car.id}-engine-clip.wav`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setLastExport(`${a.download} · ${seconds}s · 48 kHz stereo 16-bit`);
      } catch (err) {
        setLastExport(`Export failed: ${err.message}`);
      } finally {
        setExporting(false);
      }
    }, 30);
  };

  const t = telemetry;
  const firingHz = (t.rpm / 60) * (car.cylinders / 2);
  const running = t.state === 'running';
  const audioLive = started && vehicleAudio.running;

  return (
    <div className="shell">
      <aside className="outliner">
        <div className="brand">
          <span className="brand-symbol"><Gauge size={22} strokeWidth={1.5} /></span>
          <span>Engine<span className="brand-dot">.</span></span>
          <span className="version">AUDIO</span>
        </div>
        <div className="scene-label"><span>VEHICLES</span><span>{CARS.length}</span></div>
        <div className="group" style={{ marginTop: 18 }}>
          {CARS.map((c) => (
            <div key={c.id} className={`tree-row ${c.id === carId ? 'selected' : ''}`}>
              <button className="object-button" onClick={() => selectCar(c.id)}>
                <Car size={16} strokeWidth={1.4} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{c.name}</span>
                  <span style={{ fontSize: 9, color: '#6e6e6e' }}>{c.spec.split('·')[0].trim()}</span>
                </span>
                {c.id === carId && <span className="selected-dot" />}
              </button>
            </div>
          ))}
        </div>
        <div className="outliner-bottom">
          <div className="world-icon"><Radio size={16} strokeWidth={1.4} /></div>
          <div>
            <strong>Audio thread</strong>
            <span>{audioLive ? `${audioInfo?.sampleRate ?? 48000} Hz · ${audioInfo?.baseLatencyMs ?? '—'} ms` : started ? 'Suspended' : 'Not started'}</span>
          </div>
          <span className="little-dot" style={{ background: audioLive ? '#c9c9c9' : '#555' }} />
        </div>
      </aside>

      <main className="inspector">
        <div className="inspector-top">
          <div><Activity size={14} /><span>Vehicle audio</span><span>/</span><span style={{ color: '#d6d6d6' }}>{car.name}</span></div>
          <div className={`save-status ${audioLive ? '' : 'saved'}`}>
            <span className="unsaved-dot" style={{ background: audioLive ? '#d6d6d6' : '#555' }} />
            {audioLive ? 'Live · synthesized in real time' : started ? 'Audio suspended' : 'Audio off'}
          </div>
        </div>

        <div className="inspector-content">
          <div className="object-header">
            <div className="object-title">
              <div className="object-icon"><Car size={28} strokeWidth={1.3} /></div>
              <div>
                <div className="eyebrow">{car.spec}</div>
                <h1>{car.name}</h1>
              </div>
            </div>
            <div className="object-actions">
              {!started ? (
                <button className="enabled-pill" onClick={startAudio} disabled={starting} style={{ cursor: 'pointer' }}>
                  <Power size={12} /> {starting ? 'Starting…' : 'Start audio'}
                </button>
              ) : (
                <button className="enabled-pill" onClick={audioLive ? stopAudio : startAudio}>
                  <span style={{ background: audioLive ? '#d6d6d6' : '#555' }} />
                  {audioLive ? 'Audio on · pause' : 'Audio paused · resume'}
                </button>
              )}
              <button className={`enabled-pill ${ignition ? '' : 'disabled'}`} onClick={toggleIgnition} title="Key: I">
                <KeyRound size={12} /> Ignition {ignition ? 'on' : 'off'}
              </button>
              <button className="enabled-pill" onClick={toggleMode} title="Key: M">
                <SlidersHorizontal size={12} /> {mode === 'auto' ? 'Auto' : 'Manual'} gearbox
              </button>
            </div>
          </div>

          {error && <p className="card-off-label" style={{ fontSize: 11, marginBottom: 16 }}>{error}</p>}

          <div className="cards engine-cards">
            <section className="card wide-card tach-card">
              <div className="card-heading"><span><Gauge size={16} />Tachometer</span><span className="small-pill">{t.state}</span></div>
              <Tachometer rpm={t.rpm} redline={car.redline} limiter={t.limiter} />
              <div className="tach-readout">
                <div><div className="metric">{Math.round(t.rpm)}<small>rpm</small></div><p className="muted">Crank speed</p></div>
                <div><div className="metric">{t.gear === 0 ? 'N' : t.gear}</div><p className="muted">Gear · {mode === 'auto' ? 'auto' : 'manual'}</p></div>
                <div><div className="metric">{Math.round(t.speedKmh)}<small>km/h</small></div><p className="muted">Road speed</p></div>
              </div>
            </section>

            <section className="card pedal-card">
              <div className="card-heading"><span><Sparkles size={16} />Pedals</span><span className="muted-tag">W · S</span></div>
              <div className="pedals">
                <Pedal label="Throttle" value={pedal.throttle} onDown={() => setPedalState({ throttle: 1 })} onUp={() => setPedalState({ throttle: 0 })} accent="#d6d6d6" />
                <Pedal label="Brake" value={pedal.brake} onDown={() => setPedalState({ brake: 1 })} onUp={() => setPedalState({ brake: 0 })} accent="#9d9d9d" />
              </div>
              <div className="range-labels"><span>Hold to press</span><span>↑ / ↓ shift · E Q</span></div>
              <div className="shift-row">
                <button className="ghost-btn" onClick={() => send({ shift: -1 })} title="Downshift: Q">Downshift</button>
                <button className="ghost-btn" onClick={() => send({ shift: 1 })} title="Upshift: E">Upshift</button>
              </div>
            </section>

            <section className="card boost-card">
              <div className="card-heading"><span><Zap size={16} />{car.turbo ? 'Turbo' : 'Induction'}</span><span className="small-pill">{car.turbo ? 'Twin turbo' : 'Naturally aspirated'}</span></div>
              {car.turbo ? (
                <>
                  <BoostGauge value={t.boost} />
                  <div className="range-labels"><span>Spool {Math.round(t.boost * 100)}%</span><span>{t.boost > 0.85 ? 'Boosting' : t.boost > 0.3 ? 'Spooling' : 'Off-boost'}</span></div>
                  <p className="muted">Blow-off valve vents when the throttle lifts under boost. Wastegate rattles at full boost.</p>
                </>
              ) : (
                <>
                  <div className="metric">{Math.round(t.throttle * 100)}<small>%</small></div>
                  <p className="muted">No turbo: intake roar follows throttle and rpm. There is no boost or blow-off on this engine.</p>
                </>
              )}
            </section>

            <section className="card fuel-card">
              <div className="card-heading"><span><Fuel size={16} />Fuel</span><span className={`small-pill ${t.starving ? 'warn' : ''}`}>{t.starving ? 'Starving' : `${Math.round(t.fuel * 100)}%`}</span></div>
              <div className="fuel-row">
                <div className="tank"><i style={{ height: `${Math.round(t.fuel * 100)}%` }} className={t.starving ? 'warn' : ''} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="metric">{Math.round(t.fuel * 100)}<small>%</small></div>
                  <p className="muted">{t.starving ? 'Low fuel: pump is starving and the engine is misfiring.' : 'Pump whine and injector hiss track fuel flow.'}</p>
                  <label className="inline-slider"><span>Level</span><input type="range" min="0" max="1" step="0.01" value={fuelSetting} onChange={(e) => updateFuel(+e.target.value)} /></label>
                  <button className="ghost-btn" onClick={() => { setFuelSetting(1); send({ refuel: true }); }}>Refuel · F</button>
                </div>
              </div>
              <div className="range-labels"><span>Misfires {t.misfires}</span><span>{t.limiter ? 'Limiter' : ''}</span></div>
            </section>

            <section className="card nos-card">
              <div className="card-heading"><span><Flame size={16} />NOS</span><span className={`small-pill ${t.nosActive ? 'live' : ''}`}>{t.nosActive ? 'Flowing' : 'Idle'}</span></div>
              <div className="fuel-row">
                <div className="tank nos"><i style={{ height: `${Math.round(t.nos * 100)}%` }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="metric">{Math.round(t.nos * 100)}<small>%</small></div>
                  <p className="muted">Bottle pressure. Hold to flow: adds torque, intake hiss and backfires.</p>
                  <button
                    className={`ghost-btn ${pedal.nos ? 'active' : ''}`}
                    onPointerDown={() => setPedalState({ nos: true })}
                    onPointerUp={() => setPedalState({ nos: false })}
                    onPointerLeave={() => pedal.nos && setPedalState({ nos: false })}
                  >
                    Hold · N
                  </button>
                  <button className="ghost-btn" onClick={() => send({ refillNos: true })}>Refill · R</button>
                </div>
              </div>
            </section>

            <section className="card wide-card layers-card">
              <div className="card-heading"><span><Layers size={16} />Layer mixer</span><span className="small-pill">live meters</span></div>
              <div className="layer-list">
                {LAYERS.map((layer) => {
                  const Icon = layer.icon;
                  const level = t.levels[layer.key] ?? 0;
                  const db = toDb(level * 2.2);
                  const fill = clamp((db + 60) / 60, 0, 1) * 100;
                  return (
                    <label key={layer.key} className="layer-row" title={layer.hint}>
                      <span className="layer-name"><Icon size={14} />{layer.label}</span>
                      <span className="layer-meter"><i style={{ width: `${fill}%` }} /></span>
                      <input type="range" min="0" max="1.5" step="0.01" value={gains[layer.key]} onChange={(e) => updateGain(layer.key, +e.target.value)} />
                      <span className="layer-value">{gains[layer.key] === 0 ? 'mute' : `${Math.round(gains[layer.key] * 100)}%`}</span>
                    </label>
                  );
                })}
              </div>
              <div className="range-labels">
                <span>Master</span>
                <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => updateVolume(+e.target.value)} style={{ maxWidth: 240 }} />
                <span>{Math.round(volume * 100)}%</span>
              </div>
            </section>

            <section className="card systems-card">
              <div className="card-heading"><span><Cog size={16} />Engine model</span><span className="small-pill">{car.cylinders} cyl · {car.valves} valves</span></div>
              <dl className="stat-list">
                <div><dt>Firing frequency</dt><dd>{firingHz.toFixed(1)} Hz</dd></div>
                <div><dt>Idle target</dt><dd>{car.idleRpm} rpm</dd></div>
                <div><dt>Redline</dt><dd>{car.redline} rpm</dd></div>
                <div><dt>Gear shift</dt><dd>{t.shifting ? 'Shifting' : 'Stable'}</dd></div>
                <div><dt>Crank state</dt><dd>{running ? 'Running' : t.state}</dd></div>
              </dl>
              <p className="muted">Sound is synthesized from firing order, exhaust resonators, turbo spool and mechanical noise. No recorded samples.</p>
            </section>

            <section className="card export-card">
              <div className="card-heading"><span><Download size={16} />Clip export</span><span className="small-pill">12 s · WAV</span></div>
              <p className="muted" style={{ marginTop: 0 }}>Renders a scripted drive for this car: idle, full throttle with auto shifts, overrun pops, NOS and braking.</p>
              <button className="ghost-btn primary" onClick={exportClip} disabled={exporting}>
                {exporting ? 'Rendering…' : 'Render clip'}
              </button>
              {lastExport && <p className="muted">{lastExport}</p>}
              <button className="ghost-btn" style={{ marginTop: 10 }} onClick={resetMixer}>
                <RotateCcw size={12} /> Reset mixer
              </button>
            </section>
          </div>

          <div className="keys-note">
            <span>W / ↑ throttle</span><span>S / ↓ brake</span><span>E / ] up · Q / [ down</span><span>N hold NOS</span><span>I ignition</span><span>M gearbox</span><span>F refuel</span><span>R NOS refill</span>
          </div>
          <p className="muted" style={{ maxWidth: 820 }}>
            Synthesis is procedural, with no samples and no sound libraries. Everything runs on the browser's native Web Audio API inside an AudioWorklet,
            which keeps the engine running on the audio thread even when the page is busy. {!started && 'Start audio to hear the engine.'}
          </p>
        </div>
      </main>
    </div>
  );
}

function Tachometer({ rpm, redline, limiter }) {
  const max = Math.ceil((redline * 1.05) / 1000) * 1000;
  const frac = clamp(rpm / max, 0, 1);
  const angle = -225 + frac * 270;
  const cx = 160, cy = 160, r = 120;
  const pt = (deg, rr) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + rr * Math.cos(rad), cy + rr * Math.sin(rad)];
  };
  const arc = (from, to, rr) => {
    const [x1, y1] = pt(from, rr);
    const [x2, y2] = pt(to, rr);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
  };
  const ticks = [];
  for (let k = 0; k <= max; k += 1000) {
    const a = -225 + (k / max) * 270;
    const [x1, y1] = pt(a, r - 4);
    const [x2, y2] = pt(a, r - 16);
    const [tx, ty] = pt(a, r - 30);
    ticks.push(
      <g key={k}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={k >= redline ? '#d68a8a' : '#8c8c8c'} strokeWidth={k % 2000 === 0 ? 2 : 1} />
        {k % 2000 === 0 && <text x={tx} y={ty} fill="#7d7d7d" fontSize="11" textAnchor="middle" dominantBaseline="middle">{k / 1000}</text>}
      </g>,
    );
  }
  const [nx, ny] = pt(angle, r - 10);
  return (
    <svg viewBox="0 0 320 240" className="tach-svg" role="img" aria-label={`${Math.round(rpm)} rpm`}>
      <path d={arc(-225, 45, r)} fill="none" stroke="#2c2c2c" strokeWidth="10" strokeLinecap="round" />
      <path d={arc(-225 + (redline / max) * 270, 45, r)} fill="none" stroke="#7a3b3b" strokeWidth="10" strokeLinecap="round" opacity="0.8" />
      <path d={arc(-225, -225 + frac * 270, r)} fill="none" stroke={limiter ? '#d68a8a' : '#d6d6d6'} strokeWidth="10" strokeLinecap="round" />
      {ticks}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={limiter ? '#e09a9a' : '#f0f0f0'} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="8" fill="#1e1e1e" stroke="#c9c9c9" strokeWidth="2" />
      <text x={cx} y={cy + 52} fill="#7d7d7d" fontSize="10" textAnchor="middle" letterSpacing="1.5">× 1000 RPM</text>
    </svg>
  );
}

function Pedal({ label, value, onDown, onUp, accent }) {
  return (
    <button
      className="pedal"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      aria-pressed={value > 0.5}
    >
      <span className="pedal-track"><i style={{ height: `${value * 100}%`, background: accent }} /></span>
      <span className="pedal-label">{label}</span>
    </button>
  );
}

function BoostGauge({ value }) {
  const pct = clamp(value, 0, 1);
  const cx = 150, cy = 130, r = 105;
  const pt = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (a, b) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const end = -180 + pct * 180;
  return (
    <svg viewBox="0 0 300 150" className="boost-svg" role="img" aria-label={`Turbo ${Math.round(pct * 100)} percent`}>
      <path d={arc(-180, 0)} fill="none" stroke="#2c2c2c" strokeWidth="12" strokeLinecap="round" />
      <path d={arc(-180, end)} fill="none" stroke={pct > 0.85 ? '#e6c77a' : '#c7c7c7'} strokeWidth="12" strokeLinecap="round" />
      <text x={cx} y={cy - 6} fill="#dfdfdf" fontSize="30" textAnchor="middle" fontWeight="300">{Math.round(pct * 100)}</text>
      <text x={cx} y={cy + 14} fill="#7d7d7d" fontSize="10" textAnchor="middle" letterSpacing="1.5">BOOST %</text>
    </svg>
  );
}
