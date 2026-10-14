import type { ReactNode } from "react";
import type { CarSpec, EngineBuild, LabSettings } from "../sim/cars";
import type { ListenMode, MixSettings } from "../audio/AudioEngine";

interface Props {
  car: CarSpec;
  build: EngineBuild;
  lab: LabSettings;
  setLab: (l: LabSettings) => void;
  mix: MixSettings;
  setMix: (m: MixSettings) => void;
  volume: number;
  setVolume: (v: number) => void;
  listen: ListenMode;
  setListen: (m: ListenMode) => void;
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  accent,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  accent: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition " +
        (disabled
          ? "cursor-not-allowed border-white/5 text-zinc-700"
          : active
            ? "text-black"
            : "border-white/10 text-zinc-300 hover:border-white/30 hover:bg-white/5")
      }
      style={active && !disabled ? { background: accent, borderColor: accent } : undefined}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  accent,
  disabled,
  hint,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accent: string;
  disabled?: boolean;
  hint?: string;
  display?: string;
}) {
  return (
    <div className={disabled ? "opacity-35" : ""}>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-400">{display ?? value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        tabIndex={-1}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer"
        style={{ accentColor: accent }}
      />
      {hint && <div className="mt-0.5 text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

function afrLabel(afr: number): string {
  if (afr < 12.2) return "Very rich — burble, pops, soft tone";
  if (afr < 13.6) return "Power mixture — best torque";
  if (afr < 14.4) return "Economy — clean, crisp";
  if (afr < 15.2) return "Stoichiometric 14.7:1";
  return "Lean — sharp, bright, less power";
}

export function LabPanel({ car, build, lab, setLab, mix, setMix, volume, setVolume, listen, setListen }: Props) {
  const accent = car.accent;
  const cylOptions = [3, 4, 5, 6, 8, 10, 12, 16];
  const effCyl = build.cyl;
  const canCrank = effCyl === 8 && car.banks === 2;
  const setM = (k: keyof MixSettings, v: number) => setMix({ ...mix, [k]: v });

  const interval = 720 / effCyl;
  const evenText =
    build.crank === "cross"
      ? "90° per cylinder · uneven per bank (L R R L R L L R)"
      : `${interval.toFixed(interval % 1 ? 1 : 0)}° crank · even firing`;

  return (
    <div className="space-y-4">
      <Card
        title="Engine Lab"
        right={
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLab({ ...lab, cylinders: null, crank: null, strokes: 4, afr: 13, shot: 1 })}
            className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-200"
          >
            Reset
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-300">Cylinders</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip accent={accent} active={lab.cylinders === null} onClick={() => setLab({ ...lab, cylinders: null })}>
                Stock · {car.cyl}
              </Chip>
              {cylOptions
                .filter((n) => n !== car.cyl)
                .map((n) => (
                  <Chip key={n} accent={accent} active={lab.cylinders === n} onClick={() => setLab({ ...lab, cylinders: n })}>
                    {n}
                  </Chip>
                ))}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">{evenText}</div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-300">Engine cycle</div>
            <div className="flex gap-1.5">
              <Chip accent={accent} active={lab.strokes === 4} onClick={() => setLab({ ...lab, strokes: 4 })}>
                4-stroke Otto
              </Chip>
              <Chip accent={accent} active={lab.strokes === 2} onClick={() => setLab({ ...lab, strokes: 2 })}>
                2-stroke
              </Chip>
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {lab.strokes === 4
                ? "Intake → compression → power → exhaust over 720° (2 revs)."
                : "Power + scavenge / compression over 360° — double the firing rate."}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-300">Crank layout (V8)</div>
            <div className="flex gap-1.5">
              <Chip
                accent={accent}
                disabled={!canCrank}
                active={canCrank && build.crank === "even"}
                onClick={() => setLab({ ...lab, crank: "even" })}
              >
                Flat-plane
              </Chip>
              <Chip
                accent={accent}
                disabled={!canCrank}
                active={canCrank && build.crank === "cross"}
                onClick={() => setLab({ ...lab, crank: "cross" })}
              >
                Cross-plane
              </Chip>
            </div>
            {!canCrank && <div className="mt-1 text-[10px] text-zinc-600">Pick 8 cylinders on a two-bank engine to choose.</div>}
          </div>

          <Slider
            label="Petrol mixture (AFR)"
            value={lab.afr}
            min={11}
            max={16}
            step={0.1}
            accent={accent}
            display={lab.afr.toFixed(1) + " : 1"}
            hint={afrLabel(lab.afr)}
            onChange={(v) => setLab({ ...lab, afr: v })}
          />

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium text-zinc-300">Nitrous shot (hold Shift)</span>
            </div>
            <div className="flex gap-1.5">
              {[
                { v: 0.5, l: "50 hp" },
                { v: 1, l: "100 hp" },
                { v: 1.5, l: "150 hp" },
              ].map((o) => (
                <Chip key={o.v} accent={accent} active={lab.shot === o.v} onClick={() => setLab({ ...lab, shot: o.v })}>
                  {o.l}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs">
            <span className="text-zinc-400">Fuel</span>
            <span className="font-semibold text-zinc-200">Petrol · 98 RON</span>
          </div>
        </div>
      </Card>

      <Card title="Sound Mixer">
        <div className="space-y-3.5">
          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-300">Microphone</div>
            <div className="flex gap-1.5">
              <Chip accent={accent} active={listen === "cockpit"} onClick={() => setListen("cockpit")}>
                Cockpit
              </Chip>
              <Chip accent={accent} active={listen === "exterior"} onClick={() => setListen("exterior")}>
                Exterior
              </Chip>
            </div>
          </div>
          <Slider label="Master volume" value={volume} min={0} max={1} step={0.01} accent={accent} onChange={setVolume} />
          <Slider
            label="Exhaust"
            value={mix.exhaust}
            min={0}
            max={1}
            step={0.01}
            accent={accent}
            display={mix.exhaust < 0.35 ? "muffled" : mix.exhaust > 0.65 ? "straight pipe" : "sport"}
            onChange={(v) => setM("exhaust", v)}
          />
          <Slider label="Engine" value={mix.engine} min={0} max={1.4} step={0.01} accent={accent} onChange={(v) => setM("engine", v)} />
          <Slider
            label="Order layer · harmonics"
            value={mix.order}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.order < 0.25 ? "pulse only" : mix.order > 1.4 ? "singing" : "natural"}
            hint="Tonal firing orders gated by the pulse train — capped per car so V12s keep their chest (the anti-F1 control)"
            onChange={(v) => setM("order", v)}
          />
          <Slider
            label="Roughness · rasp"
            value={mix.rough}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.rough < 0.25 ? "perfect" : mix.rough > 1.4 ? "raw race" : "natural"}
            hint="Cylinder-to-cylinder and cycle-to-cycle variation"
            onChange={(v) => setM("rough", v)}
          />
          <Slider
            label="Intake roar"
            value={mix.intake}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            onChange={(v) => setM("intake", v)}
          />
          <Slider
            label="Mechanical detail"
            value={mix.mech}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.mech < 0.25 ? "hidden" : mix.mech > 1.4 ? "exposed" : "natural"}
            hint="Block rumble, piston slap, valvetrain tick, chain whirr, ancillary whine"
            onChange={(v) => setM("mech", v)}
          />
          <Slider
            label="Crank surge"
            value={mix.tors}
            min={0}
            max={2.5}
            step={0.01}
            accent={accent}
            display={mix.tors < 0.2 ? "rigid" : mix.tors > 1.6 ? "rubber" : "mechanical"}
            hint="Each firing speeds the crank up; the next compression slows it down"
            onChange={(v) => setM("tors", v)}
          />
          <Slider
            label="Crackle · limiter pops"
            value={mix.crackle}
            min={0}
            max={2.5}
            step={0.01}
            accent={accent}
            display={mix.crackle < 0.25 ? "clean" : mix.crackle > 1.6 ? "anti-lag" : "race"}
            hint="Fuel-cut backfires that ring through the car's own exhaust"
            onChange={(v) => setM("crackle", v)}
          />
          <Slider
            label="Cam · valvetrain"
            value={mix.cam}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.cam < 0.25 ? "muted" : mix.cam > 1.4 ? "exposed" : "mechanical"}
            hint="Valve events ring the valvetrain at each cylinder's own opening and closing"
            onChange={(v) => setM("cam", v)}
          />
          <Slider
            label="Turbo spool · overrun"
            value={mix.spool}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.spool < 0.25 ? "off" : mix.spool > 1.4 ? "big turbo" : "natural"}
            hint="Shaft inertia on spool-up, compressor surge chop on lift-off"
            disabled={car.sound.turbo === 0}
            onChange={(v) => setM("spool", v)}
          />
          <Slider
            label="Cabin · Doppler"
            value={mix.space}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            display={mix.space < 0.25 ? "anechoic" : mix.space > 1.4 ? "stripped cabin" : "natural"}
            hint="Cabin/body resonance in cockpit view, pass-by Doppler outside"
            onChange={(v) => setM("space", v)}
          />
          <Slider
            label="Turbo whistle"
            value={mix.turbo}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            disabled={car.sound.turbo === 0}
            onChange={(v) => setM("turbo", v)}
          />
          <Slider
            label="Hybrid motor whine"
            value={mix.motor}
            min={0}
            max={2}
            step={0.01}
            accent={accent}
            disabled={car.sound.motor === 0}
            onChange={(v) => setM("motor", v)}
          />
          <Slider label="Gearbox whine" value={mix.gear} min={0} max={2} step={0.01} accent={accent} onChange={(v) => setM("gear", v)} />
          <Slider label="Pops · flutter · clicks" value={mix.fx} min={0} max={2} step={0.01} accent={accent} onChange={(v) => setM("fx", v)} />
        </div>
      </Card>
    </div>
  );
}
