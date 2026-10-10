// AudioWorklet entry point. Runs on the audio rendering thread, so the engine
// simulation advances once per rendered sample regardless of page framerate,
// tab focus or main-thread load. The page only sends control inputs and reads
// telemetry through the port.
import { EngineCore } from './engine-core.js';
import { CARS } from './cars.js';

const TELEMETRY_INTERVAL = 2048; // samples (~43 ms at 48 kHz)

class VehicleEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new EngineCore(sampleRate, CARS[0]);
    this.sinceTelemetry = 0;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'car': {
        const car = CARS.find((c) => c.id === msg.id);
        if (car) this.core.setCar(car);
        break;
      }
      case 'input':
        this.core.setInput(msg.input);
        break;
      default:
        break;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    this.core.process(left, right, left.length);
    this.sinceTelemetry += left.length;
    if (this.sinceTelemetry >= TELEMETRY_INTERVAL) {
      this.sinceTelemetry = 0;
      this.port.postMessage({ type: 'telemetry', telemetry: this.core.telemetry() });
    }
    return true;
  }
}

registerProcessor('vehicle-engine', VehicleEngineProcessor);
