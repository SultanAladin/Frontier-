# Gas Fluid — port to Frontier, bake it, budget it, and attach it to objects

Port the browser gas/pyro simulator at `Experimental/Fluid` into native C++, ship it as both a
standalone host and a Fluid Editor inside the engine editor, let any object own an emitter, and run
the whole thing inside a stated budget so a scene full of smoke still holds its frame rate.

**This file is a plan only. No code from it has been written.**

## What already exists

| Thing | Where | State |
|---|---|---|
| Browser gas simulator | `Experimental/Fluid` | Working. WebGL2 and WebGPU engines, 18 presets, scene save/load, **flipbook bake already implemented** (`src/FlipbookSequence.js`) |
| Its contract | `src/SceneSpecification.js`, `src/presets.js` | `DEFAULT_PARAMS` (84 settings), per-setting ranges, `ValidateScene`, `ConstructPresetParameters` |
| Its proof | `src/SceneMetrics.mjs` | 18 node tests, all passing |
| Six collider primitives | `OBSTACLE_TYPES` | None, sphere, vertical cylinder, horizontal cylinder, deflector slab, **tyre ring** |
| `Project-Fluid` | `Projects/Project-Fluid` | A **liquid** project. Shares a name, shares no solver |
| A global distance field | `Engine/GeometricRaster/{DistanceFieldSpace,GlobalDistanceFieldSpace,DistanceFieldBakeSolver}.cpp` | **Already in the tree and unused by any target.** This is how arbitrary meshes become gas colliders for free |
| Fracture editor port | `Engine/Editor/FractureEditorSurface.h` | The shape a page port takes here |
| Tyre slip | `Engine/PhysicalDynamics/Vehicle/TyreSlipDynamics.cpp` | Already computes the slip ratio a burnout emitter keys off |
| Shader lowering in CI | `.github/workflows/frontier-shaders.yml` | 35 shaders → SPIR-V in 53 s. The volume raymarch joins the table |

The gas solver is **new work**. Nothing in the engine advects a velocity field on a voxel grid today.

---

## 1 · Cost, measured before anything is built

Everything below depends on these numbers, so they come first.

### Live simulation — what a domain costs in VRAM

Per voxel, at half precision: velocity `RGBA16F` ping-ponged (16 B), thermo — smoke, temperature,
fuel, soot — `RGBA16F` ping-ponged (16 B), pressure ping-ponged (4 B), divergence (2 B), vorticity
(8 B), obstacle mask (1 B). **47 bytes per voxel.**

| Grid | Voxels | VRAM | Pressure solve, 22 sweeps |
|---|---|---|---|
| 32³ | 32 768 | **1.5 MB** | 0.7 M voxel-ops |
| 64³ | 262 144 | **12.3 MB** | 5.8 M |
| 96³ | 884 736 | **41.6 MB** | 19.5 M |
| 128³ | 2 097 152 | **98.6 MB** | 46.1 M |

VRAM is not the problem. **The pressure solve is**, and it scales with the cube of resolution.

### Baking the 3D volume — is it performant?

Short answer: **on VRAM, no; on GPU time, yes — and only at 64³ or below.**

A baked volume is a sequence of 3D textures. Only density and temperature need to survive the bake
(fuel and soot have already done their work), so `RG8` — 2 bytes per voxel.

| Grid | Per frame | 90 frames (3 s @ 30 Hz), raw | Sparse 8³ bricks, ~20 % occupancy |
|---|---|---|---|
| 64³ | 0.5 MB | **47 MB** | **~9 MB** |
| 96³ | 1.7 MB | 159 MB | ~32 MB |
| 128³ | 4.0 MB | **377 MB** | ~56 MB |

So:

- **64³ baked, sparse, is shippable** — ~9 MB per effect, and it replaces 5.8 M voxel-ops per frame
  with one 3D texture fetch per raymarch step. That is a genuine win for a repeated effect.
- **128³ baked is not.** 56 MB for one three-second effect buys very little over simulating it.
- Block compression does not rescue it: `BC4`/`BC7` on `VK_IMAGE_TYPE_3D` is optional in Vulkan and
  absent on a lot of hardware, so it cannot be relied on.
- The win is **shared instances**. One bake played by thirty muzzle puffs costs 9 MB once. One bake
  played by one hero explosion costs 9 MB for one explosion — simulate that instead.

**Conclusion: bake in 3D only for effects that repeat, at 64³, sparse, under four seconds.**

### Baking to a 2D sprite sheet — the better trade for small and distant

An 8×8 flipbook of 256² frames in a 2048² atlas:

| Contents | Uncompressed | Compressed |
|---|---|---|
| Colour + alpha `RGBA8` | 16.8 MB | **4.2 MB** `BC7`, 5.6 MB with mips |
| Motion vectors `RG8` (for frame blending) | 8.4 MB | **4.2 MB** `BC5` |
| Six-way lighting (3 extra channels) | +12.6 MB | +4.2 MB |

**~10 MB for a high-quality looping effect, shared by every instance, rendered as a camera-facing
card at the cost of two triangles.** That is 1/5 the memory of the 3D bake and roughly 1/50 the
render cost, and the browser app already knows how to produce it.

This is the right default for anything small or far away. Its limit is parallax: a card does not
hold up when you walk around it or through it.

### The rule that falls out

| | Live sim | 3D bake | 2D flipbook |
|---|---|---|---|
| Hero, player-adjacent, unique | ✅ | | |
| Repeated mid-ground, 64³ | ✅ at distance | ✅ | |
| Small, numerous, or distant | | | ✅ |
| Must react to the world | ✅ | | |

---

## 2 · Budget and quality tiers

A domain is not born at a tier; it is **assigned** one each frame by distance and by what is left in
the budget, and it can be demoted mid-life.

| Tier | Grid | Pressure sweeps | **Sim rate** | Raymarch / shadow steps | VRAM | Allowed at once |
|---|---|---|---|---|---|---|
| **Hero** | 128³ | 24 | 60 Hz | 128 / 8 | 99 MB | **1** |
| **Near** | 96³ | 18 | 60 Hz | 96 / 6 | 42 MB | **2** |
| **Mid** | 64³ | 12 | **30 Hz** | 64 / 4 | 12 MB | **4** |
| **Far** | 32³ *or* a flipbook card | 8 | **15 Hz** | 32 / 2 | 1.5 MB | **8** |
| **Card** | baked 2D only | — | playback | — | shared atlas | unbounded |

Worst legal case: 99 + 2×42 + 4×12 + 8×1.5 = **243 MB of VRAM**, which is a defensible ceiling on a
modern card and a configurable one on a smaller card.

**The sim rate is not the frame rate.** The game renders every frame at whatever the display runs
at; a Mid-tier domain merely *steps* 30 times a second and its density is interpolated between the
two newest states in between — the same easing the replication runtime already does for remote
placements. This is what the request for "60 FPS near, 30 FPS far" actually means in a solver, and
it is where most of the saving comes from: halving the step rate halves the pressure solve.

`GasBudget` owns three ceilings — VRAM, per-frame milliseconds, and live domain count. When a new
domain would breach one it is demoted a tier, and if it is already at Far it plays a card instead.
A frame-time governor demotes the furthest domain first when the measured gas cost exceeds its
millisecond ceiling for several frames running. **Nothing is ever silently dropped**; the editor
shows which tier each domain is running at and why.

---

## 3 · Collision — objects that the gas can feel

Opt-in, per object, with a `GasCollision` component. Three levels:

1. **Primitive** — sphere, capsule, box, cylinder, or the tyre ring the simulator already has.
   Rasterised into the obstacle mask each tick. Nearly free.
2. **Distance field** — sample `GlobalDistanceFieldSpace` where it covers the domain. Arbitrary
   meshes become colliders **with no new code in the solver**, because the engine already bakes this
   field and nothing currently consumes it. This is the single highest-value reuse in the plan.
3. **Two-way** — integrate pressure over the object's occupied cells and hand the force to Jolt.
   **Off by default.** It costs a readback, it is the only part that can destabilise the rigid-body
   solver, and it is the first thing to break determinism.

Default is one-way: the world pushes the gas, the gas does not push the world.

---

## 4 · Determinism — only where it is paid for

**Single-player: none required.** The solver may use whatever GPU reduction order it likes.

**Multiplayer: do not replicate the fluid.** Replicate the *cause* and let every client simulate its
own smoke. A fracture sends "piece 12 broke at this transform with this energy"; a tyre sends its
slip ratio. Both are a handful of bytes and both already fit the replication runtime landed in
`Projects/Project-Networking` — `ReplicationSequence` carries exactly this kind of small authored
event. Two clients will then show visually different smoke, which does not matter, **because smoke
is not gameplay**.

It stops being true the moment smoke *blocks line of sight*. If that is ever wanted, the answer is
two fields, not one deterministic one:

- a coarse **32³ CPU occlusion field**, fixed timestep, fixed iteration count, integer-seeded noise,
  fixed reduction order — deterministic, replicated, and what the game logic queries;
- the pretty GPU volume on top, non-deterministic and purely cosmetic.

That separation is standard, and it is far cheaper than making a GPU fluid bit-exact across vendors.

---

## 5 · The port itself

### 5.1 `Engine/VolumetricDynamics` — the solver, no graphics

| File | What |
|---|---|
| `GasDomain.h/.cpp` | Grid, world bounds, thermo channels, staggered velocity, tier |
| `GasAdvection.cpp` | Semi-Lagrangian and MacCormack |
| `PressureProjection.cpp` | Jacobi divergence removal |
| `VorticityConfinement.cpp` | The curl-restoring force |
| `CombustionSequence.cpp` | Burn rate, heat, soot, expansion, cooling |
| `GasSettings.h` | The 84 settings with their ranges, mirroring `ControlSpecification` |
| `GasPresetLibrary.cpp` | **Generated** from `presets.js` by `Tools/Build/GenerateGasPresets.py` |
| `GasBudget.h/.cpp` | The tier table, the ceilings, the governor |

The browser file stays the single source of truth for tuning; the proof fails when the generated
file is stale. (Same pattern as `CompileShaders.py` reading the shader table rather than copying it.)

**Proof** — `Exhibits/Workbench/GasFluid/`, a CPU mirror with no window: a closed domain conserves
smoke; divergence after projection is below a stated bound; every generated preset validates;
the tier table never exceeds its stated VRAM; and the three rules the node suite already enforces —
detonations keep ≥ 28 voxels per world unit, cold effects carry no fuel on either path, sand sinks
and fire rises.

### 5.2 Rendering

`Engine/DisplayPresentation/VolumeRaymarch.*` and one Slang shader added to the shader table, so CI
lowers it with everything else. Vulkan has real 3D textures, so the browser's tiled 2D atlas — a
WebGL2 workaround — is dropped. Keep the lighting vocabulary (`densityExtinction`, `smokeAlbedo`,
`shadowSteps`, `phaseAnisotropy`, `internalScattering`) so a scene reads the same in both.

`Frontier.exe` stays the only windowed host. The solver never touches a swapchain.

### 5.3 Standalone host

A target beside `Project-Fluid`, with `option(FRONTIER_GAS_ONLY)` next to the existing
`FRONTIER_FLUID_ONLY` so the gas work builds on a machine with no Vulkan. It loads and saves the
**same** `frontier-fluid-scene` version 1 JSON the browser writes — save in the browser, open in the
native host, compare. That is the parity test, and it is nearly free.

### 5.4 The editor

**Outliner.** `EditorInstanceCategory::Fluid` with its own glyph. Selecting it fills an
`EditorSheetAppearance::Fluid` sheet with the few settings worth having inline — preset, tier, grid,
bounds, and the handful of sliders a scene is usually nudged with — plus a live readout of the tier
the budget has actually assigned it.

**The Fluid Editor.** Everything else is a full page opened from the inspector, exactly as the
fracture card opens the fracture editor. `Engine/Editor/FluidEditorSurface.h`, drawn with the same
`ControlPanel` widgets, a **port of the browser page** rather than a new design: preset rail and its
four filters, grouped inspector, viewport with bounds box and voxel grid lines, debug channel
selector, and the bake panel — which now bakes **both** a 2D flipbook and a sparse 3D volume.

**Proof** — `Exhibits/Workbench/FluidEditor/`, matched against the bundle the way `BundleParity.py`
already matches the Project Zero editor.

### 5.5 Emitters on other objects

A **domain** is a scene object with bounds and a budget. An **emitter** is a component on *any*
object: a transform, a shape, and a preset's emitter half. Each emitter resolves to the nearest
enclosing domain, or to an implicit one sized from its own radius. That is what lets a tyre and a
fracture both smoke in one level without either owning a 128³ grid.

| Event | What it spawns | Tier |
|---|---|---|
| A fracture piece separates | One-shot `brick_fracture_dust` at the break, scaled by piece volume | Card, or Mid if close |
| Tyre slip ratio passes threshold | Continuous `tyre_burnout` at the contact patch, rate driven by slip | Mid or Near |

Both drive one small interface — `GasEmitterSource`, answering "where, how big, how hard, which
preset, this tick" — so neither fracture nor tyre knows anything about gas.

---

## 6 · Order

1. Solver + generated presets + CPU proof + the budget table — provable with no GPU
2. Volume raymarch, its shader in the CI table — it becomes visible
3. Standalone host + scene round-trip against the browser — parity pinned
4. **2D flipbook bake** — the cheapest tier, and the browser already has the algorithm
5. Outliner row and inline inspector — fluids exist in a level
6. Fluid Editor page — fluids become editable
7. Emitter component, then the fracture and tyre hooks — fluids become part of the game
8. Collision: primitives, then the global distance field, then optional two-way
9. Sparse 3D bake — last, because it is the narrowest win

Steps 1, 2 and 4 are the real work. Everything after is wiring onto seams this repo already has.

## 7 · Still open

- **Whose budget?** The ceilings above are a proposal, not a measurement. They need pinning to a
  target card before step 1 is finished.
- **Flipbook authoring.** Six-way lighting triples the atlas. Worth it, or is a single lit sheet
  with a normal good enough for this engine's look?
- **Does smoke ever block sight?** If yes, the 32³ deterministic CPU field in §4 is not optional and
  should move into step 1.

## Deliberately excluded

- Liquids — `Projects/Project-Fluid` owns those.
- WebGPU — native has Vulkan and needs no second backend.
- The tiled 2D atlas for *live* volumes — it exists only because WebGL2 has no 3D textures.
