# Particle Editor

`Experimental/ParticleEditor/index.html` is a standalone particle editor written in HTML, JavaScript and WebGPU. Its UI follows the layout of `Experimental/ProjectZeroEditor/index.html`: top bar, outliner on the left, viewport in the centre, and inspector on the right, with a status bar along the bottom.

Open it through any static HTTP server. Opening the file directly with `file://` will not load the scripts in every browser. A browser with WebGPU enabled is required.

```
cd Experimental/ParticleEditor && python3 -m http.server 8080
# then open http://localhost:8080/
```

Query parameters:

- `?scene=none` starts with no particle systems.
- `?scene=id,id,...` starts with the listed presets only (IDs come from `js/presets.js`).

## What is in the editor

| System | Kind | Notes |
| --- | --- | --- |
| Sparks | Ballistic, GPU-simulated | Streak-rendered. Emitted by the **Strike** button and by lightning. Affected by the wind field. |
| Lightning and thunder | Procedural bolts | **Strike** creates a bolt with a flash, a thunder cue (**Sound**) and a spark burst at the impact point. |
| Leaves | Wind-driven, GPU-simulated | Leaf or paper sprites (selectable). They take their velocity from the wind field at their position.
| Tornado debris | Wind-driven, GPU-simulated | Paper debris lifted from a ring around a vortex. Adding it enables the **Tornado** wind component at its origin. |
| Sandstorm | Wind-driven, GPU-simulated | Dense dust (up to about 6,000 grains) fired from the upwind edge. Adding it sets **Prevailing wind** to 8 m/s at bearing 70°. |
| Rain streaks | Precipitation, GPU-simulated | Streaked drops that fall through the wind field and rebound a little off the floor. |
| Hail | Precipitation, GPU-simulated | Ice pellets that drop fast and bounce high off the floor before settling. |
| Snow | Precipitation, GPU-simulated | Flakes that drift through the wind field and land with a soft rebound. |

Precipitation uses the regular particle kind, not the debris kind. Debris pins to the floor, while the other kinds bounce with the preset's `bounce` coefficient, so rain, hail and snow set a bounce value.
| Embers | Additive VFX | Glowing embers lifted on buoyancy and bent by the wind. |
| Cherry petals | Wind-driven, GPU-simulated | Petals that tumble and follow the wind closely. | |
| Atoms (LJ gas) | Molecular, GPU-simulated | Lennard-Jones pairs on a spatial-hash grid, Langevin thermostat, reflecting box walls. |
| Chemicals A+B→C | Molecular, GPU-simulated | Same as atoms, with stochastic A + B → C reactions on contact and C → A or B dissociation. |

Particles are stored in one GPU buffer per system, with 64 bytes per particle. Simulation and rendering both stay on the GPU. The CPU only receives the small statistics described under *Readback costs* below.

## Wind field

The wind field is a 3D grid of velocities, 24 × 12 × 24 voxels over a 12 × 8 × 12 m domain. It is carried over from the reference editor and is evaluated each step by every wind-driven system.

Sources (all linear superposition, as in the reference):

- **Prevailing wind**: directional, with strength, bearing, radius and centre position.
- **Passing gust**: travelling gust bands.
- **Turbulence**: scaled noise, controlled by the *Turbulence* slider.
- **Swirl**: a divergence-free curl-noise field, controlled by the *Swirl* slider (m/s). Because it is a curl, it turns the grid over on itself without creating sources or sinks, so arrows visibly swirl while the net flow stays intact.
- **Tornado** (a wind component, type 2): a vortex with a tangential velocity, inflow, and an updraft. Systems such as Tornado debris read it through the grid like any other wind.

The field is visualised as a 3D grid rather than a single plane. Each arrow is one voxel:

- **Direction** is the local wind direction.
- **Colour** encodes speed: blue is calm, cyan moderate, yellow fast, red at or above the full-scale value.
- **Length** follows speed, up to one voxel.

The *Arrow full scale* slider sets the speed that maps to full colour and length. *Show grid arrows*, *Show floor* and *Show domain box* toggle the overlay layers. The arrows are a debugging view of the forces that drive particles and are not part of the final visual.

## Readback costs

The editor keeps simulation state on the GPU. CPU readback is limited to the data the UI actually needs, and every readback is asynchronous: the frame is recorded and submitted without waiting for the map to complete. A result therefore arrives one or more frames after it was requested.

| Readback | Size | Frequency | Used for |
| --- | --- | --- | --- |
| Molecular statistics (alive count, species counts A/B/C, kinetic energy sum) | 32 bytes per molecular system | At most one in flight per system, so about once per frame | Status bar, live counts, temperature readout |
| Wind probe (one voxel, rgba16float) | 8 bytes | On request, while the viewport probe is enabled | Probe readout in the viewport |
| Full particle buffer | 64 bytes × capacity (for example 1,024 atoms = 64 KiB; 65,536 = 4 MiB) | Only when **Benchmark full readback** is pressed | Measurement only; the editor never uses this data |

Why the statistics are cheap:

- A reduction pass on the GPU sums the counts and energy into a fixed 32-byte buffer. The CPU never reads per-particle data during normal use.
- Energy is accumulated as integers (`v² × 1000`) so that atomic adds are exact. The integer sum is safe up to about 65,000 atoms at the maximum speed cap before it overflows a `u32`.

Measured here (headless Chrome with SwiftShader, a CPU software WebGPU implementation, so these numbers are not representative of real hardware):

- The status-bar readback time reached about 790 ms. This value is the time from `mapAsync` to its resolution, which includes queued GPU work. Software emulation makes that queue very slow, so it does not predict real-GPU latency.
- The temperature readout is `<v²>/3` and settled at 0.59–0.60 for a thermostat set to T = 0.6, which is the expected value.

What to expect on real hardware: a 32-byte map adds about one frame of latency. Use **Benchmark full readback** on the target GPU to measure the full-buffer cost before relying on it. Measured cost is not published in this document.

Rule of thumb: keep per-frame readback to the 32-byte statistics. Anything bigger should be requested on demand, asynchronously, and at a low rate.

## Simulation notes

- **Molecular step size.** The molecular step uses a fixed `simDt` (default 0.004). Each frame runs `steps = clamp(round(dt / simDt), 1, 8)` sub-steps, and the sub-step is `min(dt / steps, 1.25 × simDt)`. This keeps the Lennard-Jones integration stable when the frame rate drops and `dt` grows.
- **Thermostat noise must differ per sub-step.** The random seed mixes the particle index, the frame seed and the particle's current position. Using only the frame seed made every sub-step reuse the same noise and pushed the atoms about 2.4× too hot.
- **Wind texture usage.** The wind grid is a 3D texture. It uses `GPUTextureUsage` flags, with separate sampled and storage views.

## Files

- `index.html`: markup and element IDs, loading the stylesheet and the five scripts in order.
- `ParticleEditor.css`: dark theme, DM Sans fonts from `fonts/`.
- `js/presets.js`: system presets.
- `js/shaders.js`: WGSL for simulation, reduction and rendering.
- `js/engine.js`: WebGPU device, buffers, pipelines, readbacks.
- `js/lightning.js`: bolt generation and thunder cues.
- `js/app.js`: editor state, UI, frame loop.
