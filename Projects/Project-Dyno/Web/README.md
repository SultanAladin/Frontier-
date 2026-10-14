# Frontier Engine Audio Sim v3 — Web

Playable browser twin of Frontier's native Engine Audio Sim v3
(`Projects/Project-Dyno/Source/AcousticIntegrator.cpp`). Same synthesis story,
two runtimes: patch-1's per-car exhaust character fused with the main branch's
raw detail, and a rebuilt LaFerrari exhaust profile.

```sh
npm install
npm run dev          # http://localhost:5174 — pick a car, Start engine, W/S/Q/E
npm run build        # type-check + production build
npm run test:worklet # headless proof: runs the real worklet in Node and
                     # asserts every car is audible, finite, level-sane
```

What's new versus `gt3-car-audio-simulator` (patch-1):

- **Raw layers from the main branch**: rarefaction pulse dip, pulse-gated order
  layer, inter-bank AM rasp, per-firing stochastic crackle, supercharger whine,
  EV model (Taycan joins as a drivable car).
- **Fixed "digital/linear" causes**: loudness normaliser is partial now,
  throttle changes loudness, jitter is zero-mean, every firing gets its own
  pulse width/tail, exhaust formants drift with heat, pulse rounding follows rpm.
- **LaFerrari rebuilt**: capped order peak (3.4, no more F1), restored chest,
  742 Hz collector howl, three-formant intake. See `src/sim/voices.ts`.
- **Five new cars**: Vulcan, Viper, Demon, Agera RS, Taycan.
- New Lab slider: **Order layer · harmonics**.

The old "pure synthesis, zero noise" claim is retired: the crackle/rasp layers
deliberately use stochastic bursts, like the main branch — that's the rawness.
No samples are used anywhere.
