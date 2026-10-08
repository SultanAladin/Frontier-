# Gas Fluid — port to Frontier, and attach it to objects

Port the browser gas/pyro simulator at `Experimental/Fluid` into native C++, ship it as both a
standalone host and a Fluid Editor inside the engine editor, and let any object in the scene own an
emitter so a fracture throws dust and a spinning tyre throws smoke.

**This file is a plan only. No code from it has been written.**

## What already exists

| Thing | Where | State |
|---|---|---|
| Browser gas simulator | `Experimental/Fluid` | Working. WebGL2 and WebGPU engines, 18 presets, scene save/load, flipbook bake |
| Its contract | `src/SceneSpecification.js`, `src/presets.js` | `DEFAULT_PARAMS` (84 settings), `ControlSpecification` (per-setting range/choice), `ValidateScene`, `ConstructPresetParameters`, `PresetPresentation` |
| Its proof | `src/SceneMetrics.mjs` | 18 node tests, all passing |
| `Project-Fluid` | `Projects/Project-Fluid` | A **liquid** project: PBF basin, Ripple pond, GPU surface extraction. Shares a name, shares no solver |
| Fracture editor port | `Engine/Editor/FractureEditorSurface.h` | The shape a page port takes here: one header, CPU-drawable, no window |
| Inspector appearances | `EditorSheetAppearance` in `Engine/Editor/EditorInstance.h` | `Sun … Tyre, TyreTread, TyreLattice, SolidArc`. The Fluid rows join this list |

The gas solver is **new work**. Nothing in the engine advects a velocity field on a voxel grid today.

## The shape of the port

Four layers, each buildable and provable on its own, in this order.

### 1 · `Engine/VolumetricDynamics` — the solver, no graphics

The semi-Lagrangian gas solver, CPU-first, as plain C++20 over `float` arrays. One translation unit
per stage so each gets its own proof:

| File | What |
|---|---|
| `GasDomain.h/.cpp` | The voxel grid: resolution, world bounds, the four thermo channels (smoke, temperature, fuel, soot) and the staggered velocity field |
| `GasAdvection.cpp` | Semi-Lagrangian and MacCormack advection — `macCormackAdvection` in the browser |
| `PressureProjection.cpp` | Jacobi divergence removal, `pressureIterations` sweeps |
| `VorticityConfinement.cpp` | The curl-restoring force |
| `CombustionSequence.cpp` | `burnRate`, `burnHeat`, `sootGeneration`, `combustionExpansion`, `coolingRate` |
| `GasSettings.h` | The 84 settings, each with its range, mirroring `ControlSpecification` exactly |
| `GasPresetLibrary.cpp` | The 18 presets, generated from `presets.js` so they cannot drift |

**Do not hand-copy the presets.** Write `Tools/Build/GenerateGasPresets.py`, which reads
`Experimental/Fluid/src/presets.js` and emits `GasPresetLibrary.cpp`, and have the proof fail when
the generated file is stale. The browser file stays the single source of truth for tuning.

**Proof** — `Exhibits/Workbench/GasFluid/`: a CPU mirror with no window. Assert conservation
(a closed domain neither gains nor loses smoke), that every generated preset validates against the
ranges, that divergence after projection is below a stated bound, and re-assert the three rules the
node suite already enforces — detonations keep ≥ 28 voxels per world unit, cold effects carry no
fuel on either the emitter or the burst path, and sand sinks while fire rises.

### 2 · Rendering — the volume, inside the existing host

`Engine/DisplayPresentation/VolumeRaymarch.*` plus a Slang shader beside the engine's others. The
browser raymarches a tiled 2D atlas because WebGL2 has no 3D textures; **Vulkan does**, so the
native path uses a real `VK_IMAGE_TYPE_3D` and drops the atlas entirely. Keep the browser's lighting
vocabulary — `densityExtinction`, `smokeAlbedo`, `shadowSteps`, `phaseAnisotropy`,
`internalScattering` — so a scene saved in one reads the same in the other.

`Frontier.exe` stays the only windowed host. The solver never touches a swapchain.

### 3 · Standalone host

A console/windowed front end over layers 1–2, reached the way `Project-Fluid` already is: a target
in the root `CMakeLists.txt` and an `option(FRONTIER_GAS_ONLY)` beside the existing
`FRONTIER_FLUID_ONLY`, so the gas work builds on a machine with no Vulkan at all.

It loads and saves the **same** `frontier-fluid-scene` version 1 JSON the browser writes. That is
the cheapest possible parity test: save in the browser, open in the native host, compare.

### 4 · The editor

**Outliner.** A new `EditorInstanceCategory::Fluid` row with its own glyph, created from the add
menu like any other object. Selecting it fills the inspector from a new
`EditorSheetAppearance::Fluid` sheet: the handful of settings worth having inline — preset, grid
resolution, bounds, and the five or six sliders a scene is usually nudged with.

**The Fluid Editor.** Everything else lives in a full page opened from the inspector, exactly as the
fracture card opens the fracture editor today. It lands as `Engine/Editor/FluidEditorSurface.h`,
drawn with the same `ControlPanel` widgets, and is a **port of the browser page**, not a new design:
preset rail with its four filters, the grouped inspector, the viewport with its bounds box and voxel
grid lines, the atlas minimap, the debug channel selector and the flipbook bake panel.

**Proof** — `Exhibits/Workbench/FluidEditor/`, matching the bundle the way `BundleParity.py` already
does for the Project Zero editor: every label, group and range in the native page must match
`presets.js` and `index.html`.

### 5 · Emitters on other objects — the part that makes it worth doing

An emitter is not the domain. Separate the two:

- a **`GasDomain`** is a scene object with world bounds, a grid and a budget;
- a **`GasEmitter`** is a *component on any object* — a transform, a shape, and a preset's emitter
  half.

Each emitter resolves to a domain: the nearest enclosing one, or an implicit per-emitter domain
sized from its own radius when there is none. That is what lets a tyre and a fracture both throw
smoke in the same level without either of them owning a 128³ grid.

Then the two cases asked for fall out:

| Event | What it spawns |
|---|---|
| A fracture piece separates | A one-shot `brick_fracture_dust` burst at the break, scaled by the piece's volume |
| A tyre's slip ratio passes a threshold | A continuous `tyre_burnout` emitter at the contact patch, rate driven by slip, that stops when slip drops |

The second is already half-built: `Engine/PhysicalDynamics/Vehicle/TyreSlipDynamics.cpp` computes
the slip, and the browser preset is tuned around the **tyre ring collider** the simulator already
has (`OBSTACLE_TYPES` id 5). The hook is a reading, not a new solver.

The seam is one small interface — `GasEmitterSource`, which answers "where, how big, how hard, and
with what preset, this tick" — so fracture and tyre both drive it and neither knows about gas.

## Build routes

A build change lands in all three, as always: the MSVC path, the `Module.toml` / orchestration path,
and the CMake path. The gas solver has no third-party dependency, so it belongs in
`FRONTIER_ENGINE_SOURCES`; only the raymarch needs Vulkan.

## Order, and what each step is worth on its own

1. Solver + generated presets + CPU proof — provable with no GPU, and already useful for baking
2. Volume raymarch in the host — the thing becomes visible
3. Standalone host + scene round-trip against the browser — parity is pinned
4. Outliner row and inline inspector — fluids exist in a level
5. Fluid Editor page — fluids become editable
6. Emitter component, then the fracture and tyre hooks — fluids become part of the game

Steps 1 and 2 are the real work. Everything after is wiring onto seams this repo already has.

## Open questions

- **Budget.** How many live domains should a level allow, and what happens at the limit — refuse,
  or evict the oldest? The browser has exactly one domain and never had to answer this.
- **Determinism.** The vehicle solver is deterministic and the gas solver as written is not
  (GPU reduction order). Does a replay need the smoke to match, or only to look right?
- **Bake vs. simulate.** The browser can already bake a flipbook. For distant or small effects a
  baked sheet is far cheaper than a live grid — is that the default for emitter-spawned puffs?

## What this plan deliberately excludes

- Liquids. `Projects/Project-Fluid` owns those and its solver is unrelated.
- WebGPU. The browser keeps both backends; native has Vulkan and needs no second path.
- The tiled atlas. It exists only because WebGL2 has no 3D textures.
