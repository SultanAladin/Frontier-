import { useEffect, useRef } from "react";
import type { CarSim } from "../sim/CarSim";

interface Props {
  simRef: React.MutableRefObject<CarSim>;
}

const H = 170;

export function RoadView({ simRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 600;
    let raf = 0;
    let roll = 0;

    const resize = () => {
      W = Math.max(280, wrap.current?.clientWidth ?? 600);
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrap.current) ro.observe(wrap.current);

    const rrect = (x: number, y: number, w: number, h: number, r: number) => {
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };

    const draw = () => {
      const sim = simRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const hy = 52;
      const speed = sim.speedKmh;
      roll += sim.v * 0.016 * 0.35;

      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#05060a");
      sky.addColorStop(1, "#1a1d2b");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, hy);
      // ground
      ctx.fillStyle = "#0c0e13";
      ctx.fillRect(0, hy, W, H - hy);

      const vp = W / 2 - sim.lateral * 60 - sim.steer * 24;
      const halfTop = 14;
      const halfBot = Math.min(W * 0.46, 250);
      const shift = -sim.lateral * 90;

      // road
      ctx.fillStyle = "#1b1e27";
      ctx.beginPath();
      ctx.moveTo(vp - halfTop, hy);
      ctx.lineTo(vp + halfTop, hy);
      ctx.lineTo(W / 2 + shift + halfBot, H);
      ctx.lineTo(W / 2 + shift - halfBot, H);
      ctx.closePath();
      ctx.fill();

      const lerpX = (t: number, side: number) => {
        const top = vp + side * halfTop;
        const bot = W / 2 + shift + side * halfBot;
        return top + (bot - top) * t;
      };

      // kerbs + dashes (perspective strips)
      const strips = 22;
      for (let i = 0; i < strips; i++) {
        const f0 = (i + (roll % 1 + 1) % 1) / strips;
        const f1 = (i + 0.5 + (roll % 1 + 1) % 1) / strips;
        const t0 = Math.pow(Math.min(1, f0), 2.4);
        const t1 = Math.pow(Math.min(1, f1), 2.4);
        const y0 = hy + (H - hy) * t0;
        const y1 = hy + (H - hy) * t1;
        const alt = i % 2 === 0;
        // kerbs
        for (const side of [-1, 1]) {
          ctx.fillStyle = alt ? "#ff3340" : "#f2f3f7";
          ctx.beginPath();
          ctx.moveTo(lerpX(t0, side), y0);
          ctx.lineTo(lerpX(t0, side * 1.08), y0);
          ctx.lineTo(lerpX(t1, side * 1.08), y1);
          ctx.lineTo(lerpX(t1, side), y1);
          ctx.closePath();
          ctx.fill();
        }
        // centre dash
        if (alt) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          const w0 = 1 + 4 * t0;
          const w1 = 1 + 4 * t1;
          ctx.beginPath();
          ctx.moveTo(lerpX(t0, 0) - w0, y0);
          ctx.lineTo(lerpX(t0, 0) + w0, y0);
          ctx.lineTo(lerpX(t1, 0) + w1, y1);
          ctx.lineTo(lerpX(t1, 0) - w1, y1);
          ctx.closePath();
          ctx.fill();
        }
      }

      // speed streaks
      const sk = Math.min(1, Math.abs(speed) / 250);
      ctx.strokeStyle = "rgba(255,255,255," + (0.05 + 0.2 * sk).toFixed(2) + ")";
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = 40 + ((roll * 8 + i * 13) % 60);
        ctx.beginPath();
        ctx.moveTo(vp + Math.cos(a) * rr * 2.2, hy + 30 + Math.sin(a) * rr * 0.55);
        ctx.lineTo(vp + Math.cos(a) * (rr + 24 * sk) * 2.2, hy + 30 + Math.sin(a) * (rr + 24 * sk) * 0.55);
        ctx.stroke();
      }

      // car (rear view)
      const carX = W / 2 + sim.steer * 14;
      const cy = H - 34;
      const accent = sim.car.accent;
      ctx.save();
      ctx.translate(carX, cy);
      ctx.rotate(sim.steer * 0.05);
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#0a0b0f";
      ctx.beginPath();
      rrect(-46, -14, 92, 30, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#14161d";
      ctx.beginPath();
      rrect(-30, -26, 60, 18, 7);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-46, -16, 92, 4);
      // wing
      ctx.fillStyle = "#07080b";
      ctx.fillRect(-42, -30, 84, 5);
      // tail lights
      const braking = sim.brk > 0.1;
      ctx.fillStyle = braking ? "#ff2a35" : "#7a1c24";
      ctx.shadowColor = braking ? "#ff2a35" : "transparent";
      ctx.shadowBlur = braking ? 16 : 0;
      ctx.fillRect(-42, -6, 20, 5);
      ctx.fillRect(22, -6, 20, 5);
      ctx.shadowBlur = 0;
      // exhaust glow on nitro
      if (sim.nitroN > 0.05) {
        ctx.fillStyle = "rgba(90,180,255," + (0.8 * sim.nitroN).toFixed(2) + ")";
        ctx.shadowColor = "#5ab4ff";
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.ellipse(-14, 14, 5, 12 * sim.nitroN + 2, 0, 0, Math.PI * 2);
        ctx.ellipse(14, 14, 5, 12 * sim.nitroN + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // tyres
      ctx.fillStyle = "#050507";
      ctx.fillRect(-52, -6, 10, 22);
      ctx.fillRect(42, -6, 10, 22);
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [simRef]);

  return (
    <div ref={wrap} className="w-full">
      <canvas ref={ref} className="block rounded-lg" />
    </div>
  );
}
