import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, Car, Cog, Download, Flame, Fuel, Gauge, Keyboard, KeyRound, Layers, Mountain, Power, Radio,
  RotateCcw, Sparkles, SlidersHorizontal, Volume2, Wind, Wrench, Zap,
} from 'lucide-react';
import { CARS, carById } from './audio/cars.js';
import { vehicleAudio } from './audio/VehicleAudio.js';
import { renderClip } from './audio/engine-core.js';
import { encodeWav } from './audio/wav.js';

const LAYERS = [
  { key: 'exhaust', label: 'Exhaust', hint: 'Combustion pulses through the pipe resonators', icon: Volume2 },
  { key: 'intake', label: 'Intake', hint: 'Induction roar, follows engine load and rpm', icon: Wind },
  { key: 'turbo', label: 'Turbo', hint: 'Compressor whine, hiss, blow-off, wastegate', icon: Zap },
  { key: 'mechanical', label: 'Crank & driveline', hint: 'Valve ticks, gear-mesh whine (follows torque), starter', icon: Cog },
  { key: 'metal', label: 'Metal', hint: 'Dog-gear shift clunk, driveline tip-in clunk', icon: Wrench },
  { key: 'fuel', label: 'Fuel system', hint: 'Injector hiss, pump whine, starvation', icon: Fuel },
  { key: 'nos', label: 'NOS', hint: 'Nitrous bottle flow hiss', icon: Flame },
  { key: 'wind', label: 'Wind', hint: 'Broadband air noise, rises with speed', icon: Activity },
];

const DEFAULT_GAINS = Object.fromEntries(LAYERS.map((l) => [l.key, 1]));

// Keyboard map by physical key code (layout-independent). Shift and Ctrl are the
// shift keys as requested; Q/E and the arrow keys work too.
const CODE_ACTIONS = {
  KeyW: 'throttle', ArrowUp: 'throttle',
  KeyS: 'brake', ArrowDown: 'brake',
  Space: 'handbrake',
  KeyN: 'nos',
  KeyE: 'up', ShiftLeft: 'up', ShiftRight: 'up',
  KeyQ: 'down', ControlLeft: 'down', ControlRight: 'down',
  KeyI: 'ignition', KeyM: 'mode', KeyF: 'refuel', KeyR: 'refill',
};
const HELD = ['throttle', 'brake', 'handbrake', 'nos'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-6));
const pedalInput = (p) => ({ throttle: p.throttle ? 1 : 0, brake: p.brake ? 1 : 0, handbrake: p.handbrake ? 1 : 0, nos: !!p.nos });

const EMPTY_TELEMETRY = {
  state: 'off', gear: 0, rpm: 0, speedKmh: 0, throttle: 0, brake: 0, handbrake: 0, grade: 0, load: 0,
  engaged: false, driveTorque: 0, wheelRpm: 0, boost: 0, nos: 1, nosActive: false, fuel: 0.9, starving: false,
  limiter: false, shifting: false, misfires: 0, levels: Object.fromEntries(LAYERS.map((l) => [l.key, 0])),
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
  const [grade, setGrade] = useState(0);
  const [pedal, setPedal] = useState({ throttle: false, brake: false, handbrake: false, nos: false });
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [audioInfo, setAudioInfo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState('');
  const [hasFocus, setHasFocus] = useState(document.hasFocus());

  // Input state lives in refs: handlers read the latest values without re-binding,
  // and messages are never sent from inside a React state updater.
  const keys = useRef({});     // keyboard-held actions
  const pointer = useRef({});  // pointer-held actions (on-screen pedals)
  const ignitionRef = useRef(false);
  const modeRef = useRef('auto');
  const gainsRef = useRef(DEFAULT_GAINS);
  const fuelRef = useRef(0.9);
  const gradeRef = useRef(0);
  const startedRef = useRef(false);

  // Telemetry arrives from the audio thread (~23 Hz). The UI only reads it.
  useEffect(() => vehicleAudio.subscribe((t) => setTelemetry(t)), []);

  // Keep the page's focus state visible so keyboard users know whether keys reach the sim.
  useEffect(() => {
    const onFocus = () => setHasFocus(true);
    const onBlur = () => { setHasFocus(false); clearAllInputs(); };
    const onVis = () => { if (document.hidden) clearAllInputs(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushPedals = () => {
    const merged = {};
    for (const name of HELD) merged[name] = !!(keys.current[name] || pointer.current[name]);
    setPedal(merged);
    vehicleAudio.send(pedalInput(merged));
  };

  const clearAllInputs = () => {
    keys.current = {};
    pointer.current = {};
    pushPedals();
  };

  const setHeld = (source, name, down) => {
    source.current[name] = down;
    pushPedals();
  };

  const startAudio = async () => {
    setStarting(true);
    setError('');
    try {
      await vehicleAudio.start();
      startedRef.current = true;
      vehicleAudio.setCar(carId);
      vehicleAudio.setVolume(volume);
      // Starting the engine: the ignition goes on, so the cranking motor and firing start.
      ignitionRef.current = true;
      setIgnition(true);
      vehicleAudio.send({
        ignition: true,
        mode: modeRef.current,
        layers: gainsRef.current,
        fuel: fuelRef.current,
        grade: gradeRef.current,
        ...pedalInput(merged()),
      });
      setAudioInfo(vehicleAudio.info);
      setStarted(true);
    } catch (err) {
      setError(err?.message || 'The browser refused to start audio.');
    } finally {
      setStarting(false);
    }
  };

  const merged = () => {
    const m = {};
    for (const name of HELD) m[name] = !!(keys.current[name] || pointer.current[name]);
    return m;
  };

  const pauseAudio = async () => {
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
    vehicleAudio.send({ ignition: next });
  };

  const toggleMode = () => {
    const next = modeRef.current === 'auto' ? 'manual' : 'auto';
    modeRef.current = next;
    setMode(next);
    vehicleAudio.send({ mode: next });
  };

  const updateGrade = (value) => {
    gradeRef.current = value;
    setGrade(value);
    vehicleAudio.send({ grade: value });
  };

  const updateFuel = (value) => {
    fuelRef.current = value;
    setFuelSetting(value);
    vehicleAudio.send({ fuel: value });
  };

  const refuel = () => updateFuel(1);

  // Keyboard: continuous actions are held sets; shifts and toggles fire on key-down.
  useEffect(() => {
    const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const onDown = (e) => {
      if (isTyping(e.target)) return;
      // Leave browser shortcuts (Ctrl+R, Ctrl+W, Alt+…) alone; a bare Ctrl key is still a control.
      const bareCtrl = e.code === 'ControlLeft' || e.code === 'ControlRight';
      if (((e.ctrlKey && !bareCtrl) || e.metaKey || e.altKey)) return;
      const action = CODE_ACTIONS[e.code] ?? CODE_ACTIONS[e.key];
      if (!action) return;
      if (['throttle', 'brake', 'handbrake', 'nos'].includes(action)) {
        if (!keys.current[action]) { keys.current[action] = true; pushPedals(); }
      } else if (!e.repeat) {
        if (action === 'up') vehicleAudio.send({ shift: 1 });
        else if (action === 'down') vehicleAudio.send({ shift: -1 });
        else if (action === 'ignition') toggleIgnition();
        else if (action === 'mode') toggleMode();
        else if (action === 'refuel') refuel();
        else if (action === 'refill') vehicleAudio.send({ refillNos: true });
      }
      e.preventDefault();
    };
    const onUp = (e) => {
      const action = CODE_ACTIONS[e.code] ?? CODE_ACTIONS[e.key];
      if (action && HELD.includes(action) && keys.current[action]) {
        keys.current[action] = false;
        pushPedals();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
    // Handlers read refs only, so binding once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateGain = (key, value) => {
    const next = { ...gainsRef.current, [key]: value };
    gainsRef.current = next;
    setGains(next);
    vehicleAudio.send({ layers: { [key]: value } });
  };

  const resetMixer = () => {
    gainsRef.current = DEFAULT_GAINS;
    setGains(DEFAULT_GAINS);
    vehicleAudio.send({ layers: DEFAULT_GAINS });
  };

  const updateVolume = (value) => {
    setVolume(value);
    vehicleAudio.setVolume(value);
  };

  const exportClip = () => {
    setExporting(true);
    setLastExport('');
    // Let the button state paint before the synchronous render blocks the page.
    setTimeout(() => {
      try {
        const sr = 48000;
        const seconds = 12;
        // A scripted drive: launch, full throttle with auto shifts, lift (overrun pops), NOS, brake.
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
  const audioLive = started && vehicleAudio.running;
  const pct = (x) => `${Math.round(x * 100)}`;

  return (
    <div className="shell" onPointerDown={() => window.focus()}>
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
            <span>{audioLive ? `${audioInfo?.sampleRate ?? 48000} Hz · ${audioInfo?.baseLatencyMs ?? '—'} ms` : started ? 'Paused' : 'Not started'}</span>
          </div>
          <span className="little-dot" style={{ background: audioLive ? '#c9c9c9' : '#555' }} />
        </div>
      </aside>

      <main className="inspector">
        <div className="inspector-top">
          <div><Activity size={14} /><span>Vehicle audio</span><span>/</span><span style={{ color: '#d6d6d6' }}>{car.name}</span></div>
          <div className={`save-status ${audioLive ? '' : 'saved'}`}>
            <span className="unsaved-dot" style={{ background: audioLive ? '#d6d6d6' : '#555' }} />
            {audioLive ? (t.state === 'running' ? 'Engine running · live' : `Engine ${t.state}`) : started ? 'Audio paused' : 'Audio off'}
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
                <button className="start-btn" onClick={startAudio} disabled={starting}>
                  <Power size={14} /> {starting ? 'Starting…' : 'Start engine'}
                </button>
              ) : (
                <button className="enabled-pill" onClick={audioLive ? pauseAudio : startAudio}>
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

          {error && <p className="error-line">{error}</p>}
          <div className={`focus-line ${hasFocus ? 'ok' : ''}`}>
            <Keyboard size={13} />
            {hasFocus ? 'Keyboard active · W throttle · S brake · Shift / E up · Ctrl / Q down · Space handbrake' : 'Click this panel to give it keyboard focus'}
          </div>

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
              <div className="card-heading"><span><Sparkles size={16} />Pedals</span><span className="muted-tag">W · S · Space</span></div>
              <div className="pedals">
                <Pedal label="Throttle" active={pedal.throttle} value={t.throttle}
                  onDown={() => setHeld(pointer, 'throttle', true)} onUp={() => setHeld(pointer, 'throttle', false)} />
                <Pedal label="Brake" active={pedal.brake} value={t.brake} accent="#9d9d9d"
                  onDown={() => setHeld(pointer, 'brake', true)} onUp={() => setHeld(pointer, 'brake', false)} />
              </div>
              <div className="range-labels"><span>Press and hold</span><span>Actual pedal, smoothed</span></div>
              <div className="shift-row">
                <button className={`ghost-btn ${pedal.handbrake ? 'active' : ''}`}
                  onPointerDown={() => setHeld(pointer, 'handbrake', true)} onPointerUp={() => setHeld(pointer, 'handbrake', false)}
                  onPointerLeave={() => setHeld(pointer, 'handbrake', false)}>Handbrake · Space</button>
                <button className="ghost-btn" onClick={() => vehicleAudio.send({ shift: -1 })}>Down · Q</button>
                <button className="ghost-btn" onClick={() => vehicleAudio.send({ shift: 1 })}>Up · E</button>
              </div>
            </section>

            <section className="card road-card wide-card">
              <div className="card-heading"><span><Car size={16} />Vehicle on the road</span><span className="small-pill">{grade === 0 ? 'Flat' : `${grade > 0 ? '+' : ''}${grade}% grade`}</span></div>
              <RoadView speedKmh={t.speedKmh} wheelRpm={t.wheelRpm} grade={t.grade} />
              <div className="range-labels"><span>Speed {Math.round(t.speedKmh)} km/h</span><span>Gear {t.gear === 0 ? 'N' : t.gear} · {t.engaged ? 'Driveline engaged' : 'Driveline free'}</span></div>
            </section>

            <section className="card drive-card">
              <div className="card-heading"><span><Mountain size={16} />Load & road</span><span className={`small-pill ${t.load > 0.85 ? 'warn' : ''}`}>{t.load > 0.85 ? 'High load' : t.load > 0.3 ? 'Driving' : 'Light'}</span></div>
              <div className="metric">{pct(t.load)}<small>% load</small></div>
              <div className="load-bar"><i style={{ width: `${t.load * 100}%` }} /></div>
              <dl className="stat-list" style={{ marginTop: 14 }}>
                <div><dt>Drive torque at wheels</dt><dd>{Math.round(t.driveTorque)} N·m</dd></div>
                <div><dt>Handbrake</dt><dd>{t.handbrake > 0.5 ? 'On' : 'Off'}</dd></div>
              </dl>
              <label className="inline-slider" style={{ marginTop: 14 }}>
                <span>Grade</span>
                <input type="range" min="-15" max="15" step="1" value={grade} onChange={(e) => updateGrade(+e.target.value)} />
                <span style={{ width: 42, textAlign: 'right' }}>{grade > 0 ? '+' : ''}{grade}%</span>
              </label>
              <p className="muted">Uphill costs speed and loads the engine. Downhill adds speed. Use the slider to test a hill start.</p>
            </section>

            <section className="card boost-card">
              <div className="card-heading"><span><Zap size={16} />{car.turbo ? 'Turbo' : 'Intake'}</span><span className="small-pill">{car.turbo ? 'Twin turbo' : 'Naturally aspirated'}</span></div>
              {car.turbo ? (
                <>
                  <BoostGauge value={t.boost} />
                  <div className="range-labels"><span>Spool {Math.round(t.boost * 100)}%</span><span>{t.boost > 0.85 ? 'Boosting' : t.boost > 0.3 ? 'Spooling' : 'Off-boost'}</span></div>
                  <p className="muted">Blow-off valve vents when you lift under boost. Wastegate rattles at full boost.</p>
                </>
              ) : (
                <>
                  <div className="metric">{pct(t.load)}<small>%</small></div>
                  <p className="muted">No turbo: intake roar follows engine load. There is no boost or blow-off on this engine.</p>
                </>
              )}
            </section>

            <section className="card fuel-card">
              <div className="card-heading"><span><Fuel size={16} />Fuel</span><span className={`small-pill ${t.starving ? 'warn' : ''}`}>{t.starving ? 'Starving' : `${pct(t.fuel)}%`}</span></div>
              <div className="fuel-row">
                <div className="tank"><i style={{ height: `${pct(t.fuel)}%` }} className={t.starving ? 'warn' : ''} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="metric">{pct(t.fuel)}<small>%</small></div>
                  <p className="muted">{t.starving ? 'Low fuel: the pump is starving and the engine is misfiring.' : 'Pump whine and injector hiss track fuel flow.'}</p>
                  <label className="inline-slider"><span>Level</span><input type="range" min="0" max="1" step="0.01" value={fuelSetting} onChange={(e) => updateFuel(+e.target.value)} /></label>
                  <button className="ghost-btn" onClick={refuel}>Refuel · F</button>
                </div>
              </div>
              <div className="range-labels"><span>Misfires {t.misfires}</span><span>{t.limiter ? 'Rev limiter' : ''}</span></div>
            </section>

            <section className="card nos-card">
              <div className="card-heading"><span><Flame size={16} />NOS</span><span className={`small-pill ${t.nosActive ? 'live' : ''}`}>{t.nosActive ? 'Flowing' : 'Idle'}</span></div>
              <div className="fuel-row">
                <div className="tank nos"><i style={{ height: `${pct(t.nos)}%` }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="metric">{pct(t.nos)}<small>%</small></div>
                  <p className="muted">Bottle pressure. Hold to flow: adds torque, intake hiss and backfires.</p>
                  <button className={`ghost-btn ${pedal.nos ? 'active' : ''}`}
                    onPointerDown={() => setHeld(pointer, 'nos', true)} onPointerUp={() => setHeld(pointer, 'nos', false)}
                    onPointerLeave={() => setHeld(pointer, 'nos', false)}>Hold · N</button>
                  <button className="ghost-btn" onClick={() => vehicleAudio.send({ refillNos: true })}>Refill · R</button>
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
                <div><dt>Shift state</dt><dd>{t.shifting ? 'Shifting' : 'Stable'}</dd></div>
                <div><dt>Misfires</dt><dd>{t.misfires}</dd></div>
              </dl>
              <p className="muted">Sound is synthesized from firing order, exhaust resonators, load, turbo spool and driveline noise. No recorded samples.</p>
            </section>

            <section className="card export-card">
              <div className="card-heading"><span><Download size={16} />Clip export</span><span className="small-pill">12 s · WAV</span></div>
              <p className="muted" style={{ marginTop: 0 }}>Renders a scripted drive for this car: launch, full throttle with auto shifts, overrun pops, NOS and braking.</p>
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
            <span>W / ↑ throttle</span><span>S / ↓ brake</span><span>Space handbrake</span><span>Shift / E upshift</span><span>Ctrl / Q downshift</span>
            <span>N hold NOS</span><span>I ignition</span><span>M gearbox</span><span>F refuel</span><span>R NOS refill</span>
          </div>
          <p className="muted" style={{ maxWidth: 820 }}>
            Synthesis is procedural, with no samples and no sound libraries. It runs on the browser's native Web Audio API inside an AudioWorklet, so the engine
            stays on the audio thread even when the page is busy. {!started && 'Press Start engine to hear the car.'}
          </p>
        </div>
      </main>
    </div>
  );
}

function RoadView({ speedKmh, wheelRpm, grade }) {
  const speedRef = useRef(speedKmh);
  const wheelRef = useRef(wheelRpm);
  const gradeRef = useRef(grade);
  speedRef.current = speedKmh;
  wheelRef.current = wheelRpm;
  gradeRef.current = grade;
  const laneRef = useRef(null);
  const wheelsRef = useRef([]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let offset = 0;
    let spin = 0;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const v = speedRef.current / 3.6;
      offset = (offset + v * dt * 4) % 80; // 80 px per cell; 4 px per metre of travel
      if (laneRef.current) laneRef.current.style.backgroundPositionX = `${-offset}px`;
      spin = (spin + wheelRef.current * 6 * dt) % 360;
      wheelsRef.current.forEach((el) => el && (el.style.transform = `rotate(${spin}deg)`));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const slope = Math.atan(grade / 100) * (180 / Math.PI);
  return (
    <div className="road-view">
      <div className="road-tilt" style={{ transform: `rotate(${-slope}deg)` }}>
        <div className="road-lane" ref={laneRef} />
      </div>
      <svg className="road-car" viewBox="0 0 240 90" style={{ transform: `rotate(${-slope}deg)` }} aria-hidden="true">
        <path d="M14 62 L22 42 Q30 30 56 28 L84 14 Q96 10 124 10 L164 14 Q190 20 206 40 L218 46 Q226 50 224 60 L224 66 L14 66 Z" fill="#cfcfcf" stroke="#8d8d8d" strokeWidth="1.5" />
        <path d="M84 16 L100 30 L152 30 L164 18 Z" fill="#2a2a2a" opacity="0.9" />
        <rect x="200" y="46" width="22" height="6" rx="2" fill="#ef6b5c" opacity="0.8" />
        {[62, 186].map((cx, i) => (
          <g key={cx} transform={`translate(${cx} 68)`}>
            <circle r="15" fill="#161616" stroke="#6b6b6b" strokeWidth="2" />
            <g ref={(el) => { wheelsRef.current[i] = el; }}>
              <line x1="-12" y1="0" x2="12" y2="0" stroke="#9a9a9a" strokeWidth="2" />
              <line x1="0" y1="-12" x2="0" y2="12" stroke="#9a9a9a" strokeWidth="2" />
            </g>
          </g>
        ))}
      </svg>
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

function Pedal({ label, active, value, onDown, onUp, accent = '#d6d6d6' }) {
  return (
    <button
      className="pedal"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      aria-pressed={active}
    >
      <span className="pedal-track"><i style={{ height: `${clamp(value, 0, 1) * 100}%`, background: accent }} /></span>
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
