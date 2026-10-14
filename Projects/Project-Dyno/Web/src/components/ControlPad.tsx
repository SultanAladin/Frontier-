import type { Inputs } from "../sim/CarSim";

interface Props {
  accent: string;
  pressed: Record<string, boolean>;
  auto: boolean;
  onSet: (name: keyof Inputs, v: boolean) => void;
  onShift: (dir: number) => void;
  onAuto: () => void;
}

function Key({
  label,
  sub,
  active,
  accent,
  wide,
  onDown,
  onUp,
}: {
  label: string;
  sub: string;
  active: boolean;
  accent: string;
  wide?: boolean;
  onDown: () => void;
  onUp?: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      className={
        "select-none touch-none rounded-lg border text-center transition-transform " +
        (wide ? "px-4 py-2 " : "h-14 w-14 ") +
        (active ? "translate-y-0.5 text-black" : "border-white/15 bg-white/[0.05] text-zinc-100 hover:bg-white/10")
      }
      style={active ? { background: accent, borderColor: accent, boxShadow: `0 0 18px ${accent}88` } : undefined}
    >
      <div className="text-base font-extrabold leading-none">{label}</div>
      <div className={"mt-1 text-[9px] font-semibold uppercase tracking-wider " + (active ? "text-black/70" : "text-zinc-500")}>
        {sub}
      </div>
    </button>
  );
}

export function ControlPad({ accent, pressed, auto, onSet, onShift, onAuto }: Props) {
  const hold = (name: keyof Inputs) => ({
    onDown: () => onSet(name, true),
    onUp: () => onSet(name, false),
  });
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      {/* WASD */}
      <div className="grid grid-cols-3 gap-1.5">
        <div />
        <Key label="W" sub="Gas" active={!!pressed.throttle} accent={accent} {...hold("throttle")} />
        <div />
        <Key label="A" sub="Left" active={!!pressed.left} accent={accent} {...hold("left")} />
        <Key label="S" sub="Brake" active={!!pressed.brake} accent={accent} {...hold("brake")} />
        <Key label="D" sub="Right" active={!!pressed.right} accent={accent} {...hold("right")} />
      </div>

      {/* shifting */}
      <div className="flex items-end gap-1.5">
        <Key label="Q" sub="Down" active={!!pressed.down} accent={accent} onDown={() => onShift(-1)} />
        <Key label="E" sub="Up" active={!!pressed.up} accent={accent} onDown={() => onShift(1)} />
      </div>

      {/* nitro / clutch / auto */}
      <div className="flex flex-col gap-1.5">
        <Key
          label="SHIFT"
          sub="Nitrous"
          wide
          active={!!pressed.nitro}
          accent="#5ab4ff"
          {...hold("nitro")}
        />
        <div className="flex gap-1.5">
          <Key label="SPACE" sub="Clutch" wide active={!!pressed.clutch} accent={accent} {...hold("clutch")} />
          <Key label="T" sub={auto ? "Auto" : "Manual"} active={auto} accent={accent} onDown={onAuto} />
        </div>
      </div>
    </div>
  );
}
