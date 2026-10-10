# Frontier Vehicle Audio — procedural engine synthesis

A browser experiment that synthesizes realistic race-car engine audio in real time.
Vehicles: **Porsche 911 GT3** (4.0 L flat-six, naturally aspirated), **Nissan GT-R NISMO GT3**
(3.8 L twin-turbo V6), **Ferrari 488 GT3** (3.9 L twin-turbo flat-plane V8).

It uses the React/Vite UI language of `Experimental/FrontierEditor` and **no sound libraries**:
the audio is generated directly with the browser's native Web Audio API inside an `AudioWorklet`.

## Why it stays audible

The simulation runs on the **audio rendering thread**, one sample at a time. It does not depend on
`requestAnimationFrame`, timers or the page's framerate. The UI only sends control inputs
(throttle, gear, NOS, layer gains) and reads telemetry (~23 Hz). A heavy or background page cannot
starve the audio, and the DSP is cheap enough to run on a low-power machine.

## What is simulated

| System | Model |
| --- | --- |
| Crank & firing | Crank angle advances with rpm. Each cylinder fires at its firing-slot angle (720°/N), with cycle-to-cycle timing and amplitude scatter. |
| Combustion | Short exponential pulses per firing, fed to a stereo exciter pair; the firing order drives stereo position per cylinder. |
| Exhaust | Source–filter model: a bank of resonators (per-car tuned pipe modes) shapes the pulse train into the harmonic series of the firing frequency. |
| Intake | Band-passed noise; follows throttle and rpm. Strong for the naturally aspirated Porsche. |
| Turbo | First-order spool lag (up/down time constants), compressor whine, hiss, **blow-off valve** on throttle lift, **wastegate** rattle at full boost. Turbo torque lag. |
| Drivetrain | Real longitudinal dynamics: engine inertia, a slipping clutch (launch capacity follows throttle), gear ratios, aero drag, rolling resistance, road **grade**, service brakes and **handbrake**. Engine load comes from the torque the driver demands, and the sound follows it. Rev limiter, top speed in gear, engine braking, idle governor, no reverse. |
| Mechanical | Valvetrain ticks (scale with valve count and rpm), gear-mesh whine, electric starter while cranking, idle-speed control. |
| Metal | Dog-gear shift clunk excites a set of high-Q metal modes. |
| Fuel | Injector hiss per injection, electric pump whine (only with ignition on), low-fuel starvation: misfires and pump gurgle. Fuel burns with throttle and rpm. |
| NOS | Pressure bottle drains while active; adds torque, bright intake hiss, and backfires. (NOS is not permitted in GT3 racing; it is included as a game option.) |
| Overrun | Crackle and pops on throttle lift at high rpm; limiter pops. |
| Wind | Speed-driven broadband noise. |

Every layer has its own gain and live meter in the **Layer mixer**. A 12 s scripted drive can be
rendered to a 16-bit stereo WAV from the **Clip export** card.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle (hold) |
| `S` / `↓` | Brake (hold) |
| `Space` | Handbrake (hold) |
| `Shift` / `E` | Upshift |
| `Ctrl` / `Q` | Downshift |
| `N` | NOS (hold) |
| `I` | Ignition |
| `M` | Auto / manual gearbox |
| `F` | Refuel |
| `R` | Refill NOS |

**Start engine** starts the audio (browsers require a user gesture) and turns the ignition on. Keys only reach the page when it has focus, so click the panel first. Shift-based shifting is on the Shift keys, which are both captured while the panel is focused.

Grade is set with the slider in the *Load & road* card (−15% to +15%).

## Run

Requires Node.js 20.19+ / npm and a browser with AudioWorklet support.

```sh
npm --prefix Experimental/VehicleAudio ci
npm --prefix Experimental/VehicleAudio run dev      # http://localhost:5180
npm --prefix Experimental/VehicleAudio run build    # dist/
npm --prefix Experimental/VehicleAudio run verify   # headless DSP verification (no browser)
```

## Files

| File | Purpose |
| --- | --- |
| `src/audio/engine-core.js` | Dependency-free DSP core, shared by the worklet, export and tests |
| `src/audio/engine-worklet.js` | AudioWorklet processor; forwards inputs and telemetry |
| `src/audio/VehicleAudio.js` | Main-thread controller (AudioContext, worklet node, limiter) |
| `src/audio/cars.js` | Vehicle data: torque curves, gearing, firing layout, exhaust modes, turbo, NOS |
| `src/audio/wav.js` | 16-bit PCM WAV encoder for clip export |
| `src/App.jsx` | UI (tach, pedals, turbo, fuel, NOS, layer mixer, export) |
| `scripts/verify-engine.mjs` | Stability, drivetrain, idle, turbo, NOS, fuel, shift, vehicle dynamics (drives, grade, brakes, hill hold), determinism and harmonic checks |

## Limits (read before judging realism)

- The sound is **procedurally synthesized** and not recorded. Recorded samples, measured exhaust impulse
  responses and a per-car tuning pass by ear will improve realism the most. The model's constants are
  in `cars.js` and are expected to be tuned against reference recordings.
- Car specs are approximate, public-domain-style figures chosen for sound character, not manufacturer data.
  The Ferrari entry is the **488 GT3** (the GT3 race car); "La Ferrari" is a road-car V12 hybrid and is not a GT3.
- The verification suite checks structure and stability (spectra, drivetrain, state machines). It cannot
  judge how the engine sounds; that needs listening on the target hardware.
