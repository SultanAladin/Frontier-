import { useEffect, useRef } from "react";
import type { CarSim } from "../sim/CarSim";

interface Props {
  simRef: React.MutableRefObject<CarSim>;
}

const S = 380;

export function Tachometer({ simRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = S * dpr;
    cv.height = S * dpr;
    ctx.scale(dpr, dpr);
    let raf = 0;
    let needle = 0;

    const A0 = (135 * Math.PI) / 180;
    const SWEEP = (270 * Math.PI) / 180;

    const draw = (t: number) => {
      const sim = simRef.current;
      const car = sim.car;
      const maxK = Math.ceil((car.redline + 400) / 1000);
      const maxRpm = maxK * 1000;
      const rpm = sim.rpm;
      needle += (rpm - needle) * 0.35;
      const cx = S / 2;
      const cy = S / 2 + 6;
      const r = 150;

      ctx.clearRect(0, 0, S, S);

      // bezel
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, r + 26);
      bg.addColorStop(0, "#14161d");
      bg.addColorStop(0.8, "#0b0c11");
      bg.addColorStop(1, "#1d2029");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      ctx.stroke();

      const ang = (v: number) => A0 + (v / maxRpm) * SWEEP;

      // red zone
      ctx.beginPath();
      ctx.arc(cx, cy, r - 4, ang(car.redline - 500), ang(maxRpm));
      ctx.strokeStyle = "rgba(255,40,50,0.85)";
      ctx.lineWidth = 8;
      ctx.stroke();

      // ticks
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let v = 0; v <= maxRpm; v += 250) {
        const major = v % 1000 === 0;
        const a = ang(v);
        const r1 = r - 14;
        const r2 = major ? r - 34 : r - 24;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.strokeStyle = v >= car.redline - 500 ? "#ff4650" : major ? "#e6e8ee" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = major ? 2.5 : 1.2;
        ctx.stroke();
        if (major) {
          ctx.fillStyle = v >= car.redline - 500 ? "#ff6068" : "#e6e8ee";
          ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(String(v / 1000), cx + Math.cos(a) * (r - 54), cy + Math.sin(a) * (r - 54));
        }
      }

      // progress arc (accent)
      const pr = Math.min(needle, maxRpm);
      const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      grad.addColorStop(0, car.accent + "00");
      grad.addColorStop(1, car.accent);
      ctx.beginPath();
      ctx.arc(cx, cy, r - 78, A0, ang(pr));
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";

      // shift lights
      const nLed = 11;
      const frac = Math.max(0, (needle - car.redline * 0.72) / (car.redline * 0.28));
      const blink = needle >= car.redline * 0.985 && Math.floor(t / 70) % 2 === 0;
      for (let i = 0; i < nLed; i++) {
        const lx = cx - 100 + (i * 200) / (nLed - 1);
        const ly = cy - r - 8 + Math.abs(i - 5) * 3.5;
        const on = frac > (i + 1) / (nLed + 1);
        const col = i < 4 ? "#27e36b" : i < 8 ? "#ffcb2e" : "#ff3b46";
        ctx.beginPath();
        ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = on && (!blink || frac < 1) ? col : "rgba(255,255,255,0.08)";
        if (blink && frac >= 1) ctx.fillStyle = "#6cd5ff";
        ctx.shadowColor = on ? col : "transparent";
        ctx.shadowBlur = on ? 12 : 0;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // needle
      const a = ang(Math.min(needle, maxRpm * 1.02));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.shadowColor = "rgba(255,50,60,0.9)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(r - 22, -2.2);
      ctx.lineTo(r - 12, 0);
      ctx.lineTo(r - 22, 2.2);
      ctx.closePath();
      ctx.fillStyle = "#ff3b46";
      ctx.fill();
      ctx.restore();

      // hub
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.fillStyle = "#1b1e27";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // centre read-outs
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("RPM ×1000", cx, cy + 44);

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 46px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(sim.gearLabel, cx, cy + 82);

      ctx.fillStyle = car.accent;
      ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(String(Math.round(Math.abs(sim.speedKmh))), cx - 62, cy + 112);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("KM/H", cx - 62, cy + 128);

      ctx.fillStyle = "#e6e8ee";
      ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(String(Math.round(rpm)).padStart(4, " "), cx + 62, cy + 112);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("RPM", cx + 62, cy + 128);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [simRef]);

  return <canvas ref={ref} style={{ width: S, height: S, maxWidth: "100%" }} className="mx-auto block" />;
}
