# Project-Dyno — Frontier Engine Audio Sim v3

The better version of both [EngineAudioSim](https://github.com/eosclient0001-rgb/EngineAudioSim) simulators,
recreated natively in Frontier (row A2) plus a playable web twin.

## Why a hybrid

| | EngineAudioSim `main` | patch-1 (`gt3-car-audio-simulator`) | **v3 (this)** |
|---|---|---|---|
| Synthesis | per-cylinder pulse + harmonics | exhaust-pulse header-wave model | patch-1 backbone **+** main's raw layers |
| Character | every car sounds the same | AMG / Vulcan-class voices are unmistakable | per-car exhaust physics kept |
| Feel | raw, detailed | too digital, linear | per-event randomness, load-sensitive loudness, heat drift |
| LaFerrari | capped nowhere → F1 shriek | thinnest voice in the garage | **rebuilt profile (below)** |

Fused from `main`: asymmetric rarefaction pulse, pulse-gated order layer, inter-bank AM rasp,
per-firing stochastic crackle, supercharger/EV synthesis. Fixed from patch-1: late-only jitter
(now zero-mean), full loudness normaliser (now partial, exponent 0.19), static pulse rounding
(now rpm-dynamic), throttle-independent loudness.

## The LaFerrari fix (F140 FE 6.3 L 65° V12)

Every previous attempt failed for identifiable reasons; the rebuilt profile (`laferrari` in
`Source/EngineVoice.cpp` and `Web/src/sim/voices.ts`) addresses each:

1. **Order peak capped at 3.4** — the old migration to orders 8–12 *was* the F1 sound.
2. **Chest restored** — body 1.05 @ 118 Hz + rarefaction 0.38: hollow low-rpm bark under the scream.
3. **Correct formant stack** — 132 / 356 / **742 (the howl)** / 1480 / 2950 / 4700 Hz, drifting up with exhaust heat.
4. **Dynamic rounding** — separate barks at idle, overlapped silk at 9,000 rpm.
5. **Real intake** — variable-trumpet honk at 386 / 864 / 1730 Hz, the loudest NA intake short of the 911 RSR.
6. **Dead-even firing** — smallest roughness/skew/lope in the garage; a 65° V12 must never lope like a V8.

## Run it

```sh
python3 Tools/Bootstrap.py --package miniaudio          # once
bash Projects/Project-Dyno/Build/ToolchainSequence.sh   # build

B=Projects/Project-Dyno/Build/Output/Linux/Release/Binary/Project-Dyno
$B --list-cars                                          # the 18-car garage
$B --render la.wav --car laferrari --pull pull          # offline, byte-deterministic
$B --null --car amg-gt3 --seconds 5                     # headless live smoke test
$B --car vulcan                                         # live on the default device
$B --engine clicks --sweep                              # A1 transport self-test (regression path)
```

Pulls: `idle`, `sweep`, `pull`, `steady`, `blip`. Cars include the patch-1 garage plus
Vulcan, Viper, Demon, Agera RS and the Taycan EV.

Web twin (same synthesis in an AudioWorklet, drivable):

```sh
cd Projects/Project-Dyno/Web && npm install && npm run dev   # http://localhost:5174
npm run test:worklet                                          # headless worklet proof
```

## Proof

```sh
python3 Projects/Project-Dyno/Test/TestAcousticRenders.py
```

Asserts deterministic renders, audibility, no hard clipping, and measurable character
(Viper darker than LaFerrari; all four test cars spectrally distinct). Measured on the
`pull` render, mid-pull segment: LaFerrari centroid ≈ 1.07 kHz with 61 % of energy below
800 Hz (chest + howl), Viper ≈ 0.57 kHz, AMG GT3 ≈ 2.1 kHz, Taycan ≈ 4.5 kHz.

## Layout

- `Source/AcousticIntegrator.*` — the hybrid synthesiser (pulse / additive / EV models)
- `Source/EngineVoice.*` — the 18-car voice garage (native twin of `Web/src/sim/voices.ts`)
- `Source/CrankClickIntegrator.*` — A1 transport self-test, kept deliberately
- `Source/DynoSequence.*` — scripted pulls shared by live and offline paths
- `Web/` — browser version (React + Vite + AudioWorklet), `test/worklet-harness.ts` proves it headlessly
