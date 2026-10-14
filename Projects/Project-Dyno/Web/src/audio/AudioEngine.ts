import { WORKLET_SOURCE } from "./workletSource";
import type { EngineCfg } from "../sim/cars";

export type ListenMode = "cockpit" | "exterior";

export interface AudioState {
  rpm: number;
  load: number;
  nitro: number;
  cut: number;
  boost: number;
  motor: number;
  gearLoad: number;
  gearEng: number;
  speed: number;
  rich: number;
}

export interface MixSettings {
  engine: number;
  turbo: number;
  gear: number;
  motor: number;
  fx: number;
  exhaust: number;
  rough: number;
  intake: number;
  mech: number;
  crackle: number;
  tors: number;
  cam: number;
  spool: number;
  space: number;
  order: number; // v3: pulse-gated tonal order layer (main-branch harmonics)
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  ready = false;

  private node: AudioWorkletNode | null = null;
  private driveGain: GainNode | null = null;
  private layerGain: GainNode | null = null;
  private shelf: BiquadFilterNode | null = null;
  private presence: BiquadFilterNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private master: GainNode | null = null;

  private pendingCfg: { cfg: EngineCfg; drive: number; body: number } | null = null;
  private pendingMix: MixSettings | null = null;
  private volume = 0.8;
  private listen: ListenMode = "cockpit";

  async start(): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;

    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const node = new AudioWorkletNode(ctx, "engine-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
    });
    this.node = node;

    // engine path: drive -> saturation
    const driveGain = ctx.createGain();
    driveGain.gain.value = 1.5;
    this.driveGain = driveGain;

    const shaper = ctx.createWaveShaper();
    const N = 4096;
    const curve = new Float32Array(N);
    const norm = Math.tanh(1.7);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = (Math.tanh(1.7 * x + 0.1 * x * x) / norm) * 0.9;
    }
    shaper.curve = curve;
    shaper.oversample = "2x";

    const bus = ctx.createGain();
    bus.gain.value = 1;

    const layerGain = ctx.createGain();
    layerGain.gain.value = 1.4;
    this.layerGain = layerGain;

    node.connect(driveGain, 0, 0);
    driveGain.connect(shaper);
    shaper.connect(bus);
    node.connect(layerGain, 1, 0);
    layerGain.connect(bus);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 30;
    hp.Q.value = 0.7;

    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 160;
    shelf.gain.value = 4;
    this.shelf = shelf;

    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2400;
    presence.Q.value = 0.8;
    presence.gain.value = 0;
    this.presence = presence;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3600;
    lp.Q.value = 0.6;
    this.lp = lp;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    this.master = master;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.7;
    analyser.minDecibels = -95;
    analyser.maxDecibels = -15;
    this.analyser = analyser;

    bus.connect(hp);
    hp.connect(shelf);
    shelf.connect(presence);
    presence.connect(lp);
    lp.connect(comp);
    comp.connect(master);
    master.connect(analyser);
    master.connect(ctx.destination);

    this.ready = true;
    this.applyListen();
    this.setVolume(this.volume);
    if (this.pendingCfg) this.setProfile(this.pendingCfg.cfg, this.pendingCfg.drive, this.pendingCfg.body);
    if (this.pendingMix) this.setMix(this.pendingMix);

    document.addEventListener("visibilitychange", this.onVisibility);
    await ctx.resume();
  }

  private onVisibility = () => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  };

  setProfile(cfg: EngineCfg, drive: number, body: number) {
    this.pendingCfg = { cfg, drive, body };
    if (!this.ready || !this.node || !this.ctx) return;
    this.node.port.postMessage({ t: "cfg", cfg });
    const t = this.ctx.currentTime;
    this.driveGain?.gain.setTargetAtTime(drive * 1.0, t, 0.05);
    this.applyListen(body);
  }

  setMix(mix: MixSettings) {
    this.pendingMix = mix;
    if (!this.ready || !this.node) return;
    this.node.port.postMessage({ t: "mix", mix });
  }

  setState(st: AudioState) {
    if (!this.ready || !this.node) return;
    this.node.port.postMessage({ t: "st", st });
  }

  trigger(name: string, a: number) {
    if (!this.ready || !this.node) return;
    this.node.port.postMessage({ t: "ev", name, a });
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(v * v * 1.1, this.ctx.currentTime, 0.03);
  }

  setListen(mode: ListenMode) {
    this.listen = mode;
    if (this.ready && this.node) this.node.port.postMessage({ t: "listen", mode });
    this.applyListen();
  }

  private bodyDb = 3;
  private applyListen(body?: number) {
    if (body !== undefined) this.bodyDb = body;
    if (!this.ctx || !this.lp || !this.shelf || !this.presence || !this.layerGain) return;
    const t = this.ctx.currentTime;
    if (this.listen === "cockpit") {
      this.lp.frequency.setTargetAtTime(3400, t, 0.06);
      this.shelf.gain.setTargetAtTime(2 + this.bodyDb, t, 0.06);
      this.presence.gain.setTargetAtTime(-2, t, 0.06);
      this.layerGain.gain.setTargetAtTime(1.7, t, 0.06);
    } else {
      this.lp.frequency.setTargetAtTime(15000, t, 0.06);
      this.shelf.gain.setTargetAtTime(this.bodyDb * 0.4, t, 0.06);
      this.presence.gain.setTargetAtTime(2.5, t, 0.06);
      this.layerGain.gain.setTargetAtTime(1.0, t, 0.06);
    }
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.ctx?.close();
    this.ready = false;
  }
}
