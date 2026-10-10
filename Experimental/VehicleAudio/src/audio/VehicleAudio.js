// Main-thread controller: owns the AudioContext and the worklet node. It never
// runs the simulation itself; it forwards inputs and receives telemetry.
// The worklet URL is bundled by Vite as an ES module (see vite.config.js).
import bundledWorkletUrl from './engine-worklet.js?worker&url';

// Dev: load the raw module so no HMR client code is injected into the audio thread.
// Production: the self-contained bundle emitted by Vite (no imports, one file).
const workletUrl = import.meta.env.DEV ? new URL('./engine-worklet.js', import.meta.url).href : bundledWorkletUrl;

export class VehicleAudio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.listeners = new Set();
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'vehicle-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      // Safety limiter after the worklet's own soft clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      node.connect(gain).connect(limiter).connect(ctx.destination);
      node.port.onmessage = (event) => {
        if (event.data.type === 'telemetry') this.listeners.forEach((fn) => fn(event.data.telemetry));
      };
      this.ctx = ctx;
      this.node = node;
      this.gain = gain;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  async stop() {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  send(input) {
    this.node?.port.postMessage({ type: 'input', input });
  }

  setCar(id) {
    this.node?.port.postMessage({ type: 'car', id });
  }

  setVolume(value) {
    if (this.gain) this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get info() {
    if (!this.ctx) return null;
    return { sampleRate: this.ctx.sampleRate, baseLatencyMs: ((this.ctx.baseLatency ?? 0) * 1000).toFixed(1) };
  }
}

export const vehicleAudio = new VehicleAudio();
