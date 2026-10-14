import { useEffect, useRef } from "react";
import type { CarSim } from "../sim/CarSim";
import type { AudioEngine } from "../audio/AudioEngine";

interface Props {
  simRef: React.MutableRefObject<CarSim>;
  engineRef: React.MutableRefObject<AudioEngine | null>;
}

const H = 190;
const F_MIN = 30;
const F_MAX = 9000;

export function Spectrum({ simRef, engineRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let W = 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      W = Math.max(280, wrap.current?.clientWidth ?? 600);
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrap.current) ro.observe(wrap.current);

    let data = new Uint8Array(2048);
    const peaks = new Float32Array(512);
    const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;

    const draw = () => {
      const sim = simRef.current;
      const an = engineRef.current?.analyser;
      const ac = engineRef.current?.ctx;
      ctx.clearRect(0, 0, W, H);

      // grid
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
        const x = xOf(f);
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H - 16);
        ctx.stroke();
        ctx.fillText(f >= 1000 ? f / 1000 + "k" : String(f), x, H - 3);
      }

      const bars = Math.floor(W / 4);
      if (an && ac) {
        if (data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        const binHz = ac.sampleRate / an.fftSize;
        const accent = sim.car.accent;
        const g = ctx.createLinearGradient(0, H - 16, 0, 0);
        g.addColorStop(0, accent + "22");
        g.addColorStop(1, accent);
        for (let i = 0; i < bars; i++) {
          const f0 = F_MIN * Math.pow(F_MAX / F_MIN, i / bars);
          const f1 = F_MIN * Math.pow(F_MAX / F_MIN, (i + 1) / bars);
          const b0 = Math.floor(f0 / binHz);
          const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
          let m = 0;
          for (let b = b0; b < b1 && b < data.length; b++) if (data[b] > m) m = data[b];
          const v = m / 255;
          const h = Math.pow(v, 1.4) * (H - 24);
          const idx = i % peaks.length;
          peaks[idx] = Math.max(h, peaks[idx] - 1.2);
          ctx.fillStyle = g;
          ctx.fillRect((i / bars) * W, H - 16 - h, W / bars - 1, h);
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillRect((i / bars) * W, H - 16 - peaks[idx] - 2, W / bars - 1, 1.5);
        }
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.textAlign = "center";
        ctx.fillText("Start the engine to see the live spectrum", W / 2, H / 2);
      }

      // firing-order markers
      const fire = sim.cycPerSec * sim.build.cyl;
      ctx.textAlign = "left";
      for (let m = 1; m <= 4; m++) {
        const f = fire * m;
        if (f < F_MIN || f > F_MAX) continue;
        const x = xOf(f);
        ctx.strokeStyle = m === 1 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.28)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 12);
        ctx.lineTo(x, H - 16);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(m === 1 ? "firing " + Math.round(f) + " Hz" : m + "×", x + 3, 10);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [simRef, engineRef]);

  return (
    <div ref={wrap} className="w-full">
      <canvas ref={ref} className="block rounded-lg bg-black/30" />
    </div>
  );
}
