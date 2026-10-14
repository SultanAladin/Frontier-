import { useEffect, useRef } from "react";
import type { CarSim } from "../sim/CarSim";

interface Props {
  simRef: React.MutableRefObject<CarSim>;
}

const C_INTAKE = "#38bdf8";
const C_COMP = "#f59e0b";
const C_EXH = "#7b8494";

export function CycleView({ simRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 600;
    let H = 0;
    let raf = 0;

    const setSize = (w: number, h: number) => {
      W = w;
      H = h;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = w + "px";
      cv.style.height = h + "px";
    };

    const draw = () => {
      const sim = simRef.current;
      const b = sim.build;
      const n = b.cyl;
      const four = b.strokes === 4;
      const cycleDeg = four ? 720 : 360;
      const rowH = Math.max(9, Math.min(22, 168 / n));
      const wantH = Math.round(44 + n * rowH + 22);
      const wantW = Math.max(280, wrap.current?.clientWidth ?? 600);
      if (wantW !== W || wantH !== H) setSize(wantW, wantH);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const x0 = 46;
      const pw = W - x0 - 10;
      const top = 34;
      const accent = sim.car.accent;
      const strokes = four
        ? [
            { name: "Power", c: accent },
            { name: "Exhaust", c: C_EXH },
            { name: "Intake", c: C_INTAKE },
            { name: "Compression", c: C_COMP },
          ]
        : [
            { name: "Power + exhaust", c: accent },
            { name: "Scavenge + compression", c: C_COMP },
          ];
      const segDeg = cycleDeg / strokes.length;

      // legend
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      let lx = x0;
      for (const s of strokes) {
        ctx.fillStyle = s.c;
        ctx.fillRect(lx, 8, 10, 10);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(s.name, lx + 14, 13);
        lx += 14 + ctx.measureText(s.name).width + 14;
      }
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText(
        "crank " + Math.round(sim.viewCyc * cycleDeg).toString().padStart(3, "0") + "°",
        W - 10,
        13,
      );

      // axis
      ctx.textAlign = "center";
      for (let d = 0; d <= cycleDeg; d += 180) {
        const x = x0 + (d / cycleDeg) * pw;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(x, top - 4);
        ctx.lineTo(x, top + n * rowH + 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillText(d + "°", x, top + n * rowH + 13);
      }

      const cur = sim.viewCyc;
      for (let i = 0; i < n; i++) {
        const y = top + i * rowH;
        const fire = b.firing.frac[i];
        const bank = b.firing.bank[i];
        // label
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "600 " + Math.min(10, rowH - 1) + "px ui-monospace, Menlo, monospace";
        ctx.fillText(String(i + 1).padStart(2, "0") + (b.banks === 2 ? (bank ? "B" : "A") : ""), 4, y + rowH / 2);

        // flash intensity after ignition
        const since = (((cur - fire) % 1) + 1) % 1;
        const flash = since < 0.07 ? 1 - since / 0.07 : 0;

        for (let s = 0; s < strokes.length; s++) {
          const start = (((fire * cycleDeg + s * segDeg) % cycleDeg) + cycleDeg) % cycleDeg;
          const end = start + segDeg;
          const active = (() => {
            const rel = (((cur * cycleDeg - fire * cycleDeg) % cycleDeg) + cycleDeg) % cycleDeg;
            return Math.floor(rel / segDeg) === s;
          })();
          ctx.globalAlpha = active ? 1 : 0.32;
          ctx.fillStyle = strokes[s].c;
          const seg = (a: number, bb: number) => {
            const xa = x0 + (a / cycleDeg) * pw;
            const xb = x0 + (bb / cycleDeg) * pw;
            ctx.fillRect(xa + 0.5, y + 1, Math.max(0, xb - xa - 1), rowH - 2);
          };
          if (end <= cycleDeg) seg(start, end);
          else {
            seg(start, cycleDeg);
            seg(0, end - cycleDeg);
          }
        }
        ctx.globalAlpha = 1;

        if (flash > 0) {
          const fx = x0 + fire * pw;
          const g = ctx.createRadialGradient(fx, y + rowH / 2, 0, fx, y + rowH / 2, 26);
          g.addColorStop(0, "rgba(255,255,255," + (0.9 * flash).toFixed(2) + ")");
          g.addColorStop(1, "rgba(255,160,60,0)");
          ctx.fillStyle = g;
          ctx.fillRect(fx - 26, y - 6, 52, rowH + 12);
        }
      }

      // cursor
      const cx = x0 + cur * pw;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx, top - 6);
      ctx.lineTo(cx, top + n * rowH + 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [simRef]);

  return (
    <div ref={wrap} className="w-full">
      <canvas ref={ref} className="block" />
    </div>
  );
}
