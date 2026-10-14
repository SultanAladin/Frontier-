import { CARS, type CarClass, type CarSpec } from "../sim/cars";

interface Props {
  carId: string;
  onSelect: (id: string) => void;
}

const GROUPS: { cls: CarClass; title: string; sub: string }[] = [
  { cls: "ROAD", title: "Hypercar / Road", sub: "V12 · V10 · blown V8 · TT V8 · EV" },
  { cls: "GT3", title: "GT3", sub: "FIA GT3 customer racers" },
  { cls: "LMGTE", title: "LMGTE", sub: "Le Mans GTE Pro / Am" },
];

function CarButton({ car, active, onClick }: { car: CarSpec; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={
        "group relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left transition " +
        (active
          ? "border-white/25 bg-white/[0.08]"
          : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]")
      }
    >
      <span
        className="absolute inset-y-0 left-0 w-1 transition-all"
        style={{ background: car.accent, opacity: active ? 1 : 0.35, width: active ? 4 : 3 }}
      />
      <div className="flex items-baseline justify-between gap-2 pl-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium uppercase tracking-wider text-zinc-500">{car.maker}</div>
          <div className="truncate text-sm font-semibold text-zinc-100">{car.name}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs font-semibold" style={{ color: car.accent }}>
            {car.layoutText.split(" ").slice(-1)[0] === "flat-plane" || car.layoutText.includes("cross")
              ? "V8"
              : car.layoutText.split(" ").pop()}
          </div>
          <div className="text-[10px] text-zinc-500">{car.aspiration.includes("Twin") ? "TT" : car.aspiration.includes("hybrid") ? "HYB" : "NA"}</div>
        </div>
      </div>
      {active && <p className="mt-1.5 pl-2 text-[11px] leading-snug text-zinc-400">{car.tagline}</p>}
    </button>
  );
}

export function CarList({ carId, onSelect }: Props) {
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.cls}>
          <div className="mb-2 flex items-end justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">{g.title}</h3>
            <span className="text-[10px] text-zinc-600">{g.sub}</span>
          </div>
          <div className="space-y-1.5">
            {CARS.filter((c) => c.cls === g.cls).map((c) => (
              <CarButton key={c.id} car={c} active={c.id === carId} onClick={() => onSelect(c.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
