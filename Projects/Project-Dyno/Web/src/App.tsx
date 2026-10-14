import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CARS, DEFAULT_LAB, buildEngine, getCar, headerText, type LabSettings } from "./sim/cars";
import { CarSim, emptyInputs, type Inputs } from "./sim/CarSim";
import { AudioEngine, type ListenMode, type MixSettings } from "./audio/AudioEngine";
import { Tachometer } from "./components/Tachometer";
import { Spectrum } from "./components/Spectrum";
import { CycleView } from "./components/CycleView";
import { RoadView } from "./components/RoadView";
import { CarList } from "./components/CarList";
import { LabPanel } from "./components/LabPanel";
import { ControlPad } from "./components/ControlPad";

interface Hud {
  thr: number;
  brk: number;
  clutch: number;
  nitroTank: number;
  nitroN: number;
  boost: number;
  torque: number;
  power: number;
  limiter: boolean;
  wheelspin: boolean;
  shifting: boolean;
  auto: boolean;
  msg: string;
  hybrid: number;
}

const INITIAL_HUD: Hud = {
  thr: 0,
  brk: 0,
  clutch: 0,
  nitroTank: 100,
  nitroN: 0,
  boost: 0,
  torque: 0,
  power: 0,
  limiter: false,
  wheelspin: false,
  shifting: false,
  auto: false,
  msg: "",
  hybrid: 0,
};

const KEYMAP: Record<string, keyof Inputs> = {
  KeyW: "throttle",
  ArrowUp: "throttle",
  KeyS: "brake",
  ArrowDown: "brake",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "nitro",
  ShiftRight: "nitro",
  Space: "clutch",
};

function Panel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={"rounded-xl border border-white/10 bg-white/[0.03] p-4 " + className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Bar({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span>{label}</span>
        <span className="font-mono text-zinc-400">{text ?? Math.round(value * 100) + "%"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: Math.max(0, Math.min(1, value)) * 100 + "%", background: color }}
        />
      </div>
    </div>
  );
}

function Tag({ on, color, children }: { on: boolean; color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition"
      style={
        on
          ? { background: color, color: "#000", boxShadow: `0 0 12px ${color}99` }
          : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.25)" }
      }
    >
      {children}
    </span>
  );
}

export default function App() {
  const [carId, setCarId] = useState(CARS[0].id);
  const [lab, setLab] = useState<LabSettings>(DEFAULT_LAB);
  const [mix, setMix] = useState<MixSettings>({
    engine: 1,
    turbo: 1,
    gear: 1,
    motor: 1,
    fx: 1,
    exhaust: 0.5,
    rough: 1,
    intake: 1,
    mech: 1,
    crackle: 1,
    tors: 1,
    cam: 1,
    spool: 1,
    space: 1,
    order: 1,
  });
  const [volume, setVolume] = useState(0.75);
  const [listen, setListen] = useState<ListenMode>("cockpit");
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const [pressed, setPressed] = useState<Record<string, boolean>>({});

  const [simRef] = useState(() => ({ current: new CarSim(CARS[0], DEFAULT_LAB) }));
  const engineRef = useRef<AudioEngine | null>(null);
  const inputsRef = useRef<Inputs>(emptyInputs());

  const car = getCar(carId);
  const build = useMemo(() => buildEngine(car, lab), [car, lab]);

  // ── car / lab changes ──
  useEffect(() => {
    const prev = simRef.current;
    if (prev.car.id !== carId) {
      const s = new CarSim(getCar(carId), lab);
      s.auto = prev.auto;
      simRef.current = s;
    } else {
      prev.applyLab(lab);
    }
    const b = simRef.current.build;
    engineRef.current?.setProfile(b.cfg, b.drive, b.body);
  }, [carId, lab, simRef]);

  useEffect(() => {
    engineRef.current?.setMix(mix);
  }, [mix]);
  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    engineRef.current?.setListen(listen);
  }, [listen]);

  const selectCar = useCallback((id: string) => {
    setCarId(id);
    setLab((l) => ({ ...l, cylinders: null, crank: null }));
  }, []);

  // ── input helpers ──
  const setInput = useCallback((name: keyof Inputs, v: boolean) => {
    if (inputsRef.current[name] === v) return;
    inputsRef.current[name] = v;
    setPressed((p) => ({ ...p, [name]: v }));
  }, []);

  const flashKey = useCallback((k: "up" | "down") => {
    setPressed((p) => ({ ...p, [k]: true }));
    window.setTimeout(() => setPressed((p) => ({ ...p, [k]: false })), 140);
  }, []);

  const doShift = useCallback(
    (dir: number) => {
      simRef.current.requestShift(dir);
      flashKey(dir > 0 ? "up" : "down");
    },
    [flashKey, simRef],
  );

  const toggleAuto = useCallback(() => {
    simRef.current.toggleAuto();
  }, [simRef]);

  // ── keyboard ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.tagName === "INPUT" && (tgt as HTMLInputElement).type !== "range") return;
      const name = KEYMAP[e.code];
      if (name) {
        e.preventDefault();
        setInput(name, true);
        return;
      }
      if (e.code === "KeyE") {
        e.preventDefault();
        if (!e.repeat) doShift(1);
      } else if (e.code === "KeyQ") {
        e.preventDefault();
        if (!e.repeat) doShift(-1);
      } else if (e.code === "KeyT") {
        e.preventDefault();
        if (!e.repeat) toggleAuto();
      }
    };
    const up = (e: KeyboardEvent) => {
      const name = KEYMAP[e.code];
      if (name) {
        e.preventDefault();
        setInput(name, false);
      }
    };
    const blur = () => {
      (Object.keys(inputsRef.current) as (keyof Inputs)[]).forEach((k) => setInput(k, false));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setInput, doShift, toggleAuto]);

  // ── main simulation + audio-feed loop ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const sim = simRef.current;
      sim.update(dt, inputsRef.current);
      const eng = engineRef.current;
      if (eng && eng.ready) {
        eng.setState(sim.audio());
        for (const ev of sim.events) eng.trigger(ev.name, ev.a);
      }
      sim.events.length = 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [simRef]);

  // ── HUD sampling ──
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = simRef.current;
      setHud({
        thr: s.thr,
        brk: s.brk,
        clutch: 1 - s.clutchEff,
        nitroTank: s.nitroTank,
        nitroN: s.nitroN,
        boost: s.turbo,
        torque: Math.max(0, s.torqueFrac),
        power: s.powerKw,
        limiter: s.limiter,
        wheelspin: s.wheelspin,
        shifting: s.shifting,
        auto: s.auto,
        msg: s.msg,
        hybrid: Math.max(0, s.car.hybrid ? s.torqueFrac : 0),
      });
    }, 66);
    return () => window.clearInterval(id);
  }, [simRef]);

  // ── start audio ──
  const start = async () => {
    setLoading(true);
    setError("");
    try {
      const e = engineRef.current ?? new AudioEngine();
      engineRef.current = e;
      await e.start();
      const b = simRef.current.build;
      e.setProfile(b.cfg, b.drive, b.body);
      e.setMix(mix);
      e.setVolume(volume);
      e.setListen(listen);
      setStarted(true);
    } catch (err) {
      setError(
        "Could not start the audio engine: " +
          (err instanceof Error ? err.message : String(err)) +
          ". This simulator needs a browser with AudioWorklet support (Chrome, Edge, Firefox, Safari 14.5+).",
      );
    } finally {
      setLoading(false);
    }
  };

  const accent = car.accent;
  const effCyl = build.cyl;
  const cycleText = build.strokes === 4 ? "4-stroke" : "2-stroke";
  const firingHz = simRef.current.cycPerSec * effCyl;

  const specRows: [string, string][] = [
    ["Engine", car.code],
    ["Layout", effCyl === car.cyl ? car.layoutText : `${effCyl}-cyl (custom)`],
    ["Displacement", car.displacement],
    ["Aspiration", car.aspiration],
    ["Cycle", `${cycleText} · petrol`],
    ["Voicing", build.mode === "pulse" ? build.cfg.v.tag : build.mode === "ev" ? "Electric · twin-motor + gear whine" : "Uneven-fire · cross-plane"],
    ["Exhaust", headerText(car, build)],
    [
      "Detail",
      build.mode === "ev"
        ? "Motor orders · reduction gear · inverter throb"
        : "Rarefaction pulse · capped order layer · AM rasp · per-firing crackle · heat-drifting formants · cam · spool/overrun · cabin/Doppler",
    ],
    ["Redline", car.redline.toLocaleString() + " rpm"],
    ["Peak", `${Math.round(car.peakKw * build.torqueScale)} kW · ${Math.round(car.peakNm * build.torqueScale)} Nm`],
    ["Gearbox", `${car.trans}`],
    ["Mass", car.mass.toLocaleString() + " kg"],
  ];

  return (
    <div
      className="min-h-screen bg-[#07080b] text-zinc-200"
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 70% -10%, " + accent + "18, transparent 60%), repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 6px)",
      }}
    >
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07080b]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: accent }}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M22 12h-1" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-extrabold uppercase italic tracking-wide text-white">
                Frontier Engine Audio <span style={{ color: accent }}>Sim v3</span>
              </h1>
              <p className="text-[11px] text-zinc-500">Hybrid synthesis: patch-1 exhaust character × main-branch raw detail · GT3 · LMGTE · hypercars</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: started ? "#27e36b" : "#555" }} />
              {started ? "Audio running · live synthesis, no samples" : "Audio stopped"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">VOL</span>
              <input
                type="range"
                tabIndex={-1}
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-28 cursor-pointer"
                style={{ accentColor: accent }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1700px] gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_340px]">
        {/* left: cars + spec */}
        <aside className="space-y-4">
          <Panel title="Garage">
            <CarList carId={carId} onSelect={selectCar} />
          </Panel>
          <Panel title="Specification" right={<span className="text-[10px] font-bold" style={{ color: accent }}>{car.cls}</span>}>
            <dl className="space-y-1.5 text-xs">
              {specRows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="text-right font-medium text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </aside>

        {/* centre: dashboard */}
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-[400px_minmax(0,1fr)]">
            <Panel title={car.maker + " " + car.name} right={<span className="font-mono text-[11px] text-zinc-500">{car.layoutText}</span>}>
              <Tachometer simRef={simRef} />
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                <Tag on={hud.limiter} color="#ff3b46">Limiter</Tag>
                <Tag on={hud.shifting} color="#ffcb2e">Shift</Tag>
                <Tag on={hud.wheelspin} color="#ff8a2e">Wheelspin</Tag>
                <Tag on={hud.nitroN > 0.1} color="#5ab4ff">N₂O</Tag>
                <Tag on={hud.auto} color="#27e36b">Auto</Tag>
              </div>
            </Panel>

            <Panel
              title="Telemetry"
              right={<span className="font-mono text-[11px] text-zinc-500">firing {Math.round(firingHz)} Hz</span>}
            >
              <RoadView simRef={simRef} />
              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                <Bar label="Throttle" value={hud.thr} color={accent} />
                <Bar label="Brake" value={hud.brk} color="#ff3b46" />
                <Bar label="Clutch open" value={hud.clutch} color="#ffcb2e" />
                <Bar label="Engine torque" value={hud.torque} color="#e6e8ee" text={Math.round(hud.power) + " kW"} />
                <Bar
                  label={car.boosted ? "Turbo boost" : car.hybrid ? "Electric assist" : "Induction"}
                  value={car.boosted ? hud.boost : car.hybrid ? Math.max(0, hud.hybrid * (1 - hud.thr * 0.2)) : hud.thr}
                  color="#27e3c8"
                />
                <Bar label="Nitrous tank" value={hud.nitroTank / 100} color="#5ab4ff" text={Math.round(hud.nitroTank) + "%"} />
              </div>
              <div className="mt-3 h-5 text-center text-xs font-semibold" style={{ color: accent }}>
                {hud.msg}
              </div>
            </Panel>
          </div>

          <Panel
            title="Drive it"
            right={<span className="text-[11px] text-zinc-500">Keyboard or tap · gear {simRef.current.gearLabel}</span>}
          >
            <ControlPad
              accent={accent}
              pressed={pressed}
              auto={hud.auto}
              onSet={setInput}
              onShift={doShift}
              onAuto={toggleAuto}
            />
            <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-500">
              <b className="text-zinc-300">W</b> throttle · <b className="text-zinc-300">S</b> brake ·{" "}
              <b className="text-zinc-300">A/D</b> steer · <b className="text-zinc-300">Shift</b> nitrous ·{" "}
              <b className="text-zinc-300">E</b> upshift · <b className="text-zinc-300">Q</b> downshift (→ N → R) ·{" "}
              <b className="text-zinc-300">Space</b> clutch / rev in gear · <b className="text-zinc-300">T</b> auto gearbox
            </p>
          </Panel>

          <Panel
            title="Engine cycle"
            right={
              <span className="text-[11px] text-zinc-500">
                {effCyl} cyl · {cycleText} · slow-motion crank
              </span>
            }
          >
            <CycleView simRef={simRef} />
          </Panel>

          <Panel title="Live spectrum" right={<span className="text-[11px] text-zinc-500">engine orders · log frequency</span>}>
            <Spectrum simRef={simRef} engineRef={engineRef} />
          </Panel>
        </div>

        {/* right: lab */}
        <aside className="lg:col-span-2 xl:col-span-1">
          <LabPanel
            car={car}
            build={build}
            lab={lab}
            setLab={setLab}
            mix={mix}
            setMix={setMix}
            volume={volume}
            setVolume={setVolume}
            listen={listen}
            setListen={setListen}
          />
        </aside>
      </main>

      <footer className="px-4 pb-8 pt-2 text-center text-[11px] leading-relaxed text-zinc-600">
        Frontier Engine Audio Sim v3 — every sound is synthesised live: per-cylinder exhaust pulses with rarefaction,
        header/exhaust formants that drift with heat, a pulse-gated order layer, per-firing crackle and mechanical detail.
        No samples. LaFerrari uses the rebuilt F140 exhaust profile — see Projects/Project-Dyno/README.md.
      </footer>

      {/* start overlay */}
      {!started && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0f14] p-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: accent }}>
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-black" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M22 12h-1" />
              </svg>
            </div>
            <h2 className="text-2xl font-extrabold uppercase italic tracking-wide text-white">
              Frontier Engine Audio <span style={{ color: accent }}>Sim v3</span>
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              The better version of both EngineAudioSim engines: the main branch's raw, detailed pulses fused with the
              patch-1 simulator's per-car exhaust character — plus a rebuilt LaFerrari V12 that finally keeps its chest
              under the scream. Cylinders, firing order, exhaust runners, turbo, hybrid motors and nitrous are all modelled live.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 text-left text-[11px] text-zinc-400">
              <div className="rounded-lg bg-white/[0.04] p-2.5"><b className="text-zinc-200">W / S</b><br />throttle / brake</div>
              <div className="rounded-lg bg-white/[0.04] p-2.5"><b className="text-zinc-200">Q / E</b><br />down / up shift</div>
              <div className="rounded-lg bg-white/[0.04] p-2.5"><b className="text-zinc-200">Shift</b><br />nitrous boost</div>
            </div>
            <button
              type="button"
              onClick={start}
              disabled={loading}
              className="mt-6 w-full rounded-xl px-6 py-3.5 text-sm font-extrabold uppercase tracking-[0.2em] text-black transition hover:brightness-110 disabled:opacity-60"
              style={{ background: accent, boxShadow: `0 0 30px ${accent}66` }}
            >
              {loading ? "Starting…" : "Start engine"}
            </button>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            <p className="mt-3 text-[11px] text-zinc-600">Headphones recommended — the two cylinder banks are panned in stereo.</p>
          </div>
        </div>
      )}
    </div>
  );
}
