# Project-Zero: actual authored car and shared world smoke

This supersedes the rejected density-projection exhibit as **visual evidence**. The original thermal/coarse milestone
remains historical evidence, not proof of the current integration.

## Executed boundary

- Load the real `ProjectZero.dll` through `CodeInterchange`, including normal ABI3 verification and optional geometry,
  scalar-smoke and transport extensions.
- Author and decode the actual ControlVehicle / PROTO-X archives as glTF: **23,148 triangles and six placements**,
  including the proving ground, authored body, authored rims and closed live XPBD-compatible tyre surfaces.
- Seed velocity/angular velocity once through `[Vehicle]`; afterwards the actual shared chassis, contact, tyre,
  drivetrain and thermal mechanics determine motion. Turning uses steering and a brief rear-brake input.
- Publish the DLL's actual relative scene transforms and live tyre positions through the existing C callbacks.
- Rasterize that actual 3D scene with the shared diagnostic `VisibilityRaster`. Upload **linear RGB and actual
  world-space surface intersections**, not gamma-encoded pixels or density projections.
- Execute the production `SmokeExchange`, `SmokeTransport.slang` and `SmokeViewport.slang` on **SwiftShader software
  Vulkan**. Composite front-to-back radiance only up to the actual opaque scene surface, before the final transfer.
- All gallery clips start paused and are independently controllable; playing one pauses the others.

**Not claimed:** physical-GPU performance, full windowed Frontier execution in this sandbox, empirical compound
calibration, a calibrated Planck spectrum, or deformed tyre SDFs. The production window route is wired and its source/
shader build routes are updated; the executed visual proof is the shared offscreen diagnostic route described above.

## Shared ownership

The active Project-Zero code image owns its project behaviour and the C lifecycle/input/scene/geometry exports. It owns **no window or
renderer**. The shared engine owns authored-car construction, chassis/XPBD/Pacejka/thermal mechanics, wheel projection,
chase-camera mechanism, field transport, host snapshot storage and Vulkan residency/presentation.

Project-Drive retains a compatibility adapter that supplies its own course surface. No Project-Zero code includes
Project-Drive source. Numeric archive bodies were compared against their pre-promotion versions and preserved exactly:

| Archive | SHA-256 of unchanged numeric array bodies |
|---|---|
| ControlVehicle | `f78a9e976499119e13a611c86df248d735ea2fde4e1ada8c68bdd5fcae40047c` |
| ControlWheel | `5bf9e09b7d3d54ad637ce9d5bf9bfdfb19014f19a7f5748d62fafd37c1da6dde` |

`Projects/Project-Zero/ProjectZero.frontier` now opens `Content/Scenes/Vehicle.gltf`. The shared host constructs this
rebuildable scene once if it is absent, then imports it normally. The locally generated glTF and native DLL are build
products and remain outside the committed source payload.

## Fine transport and appearance

- One on-demand world-axis-aligned domain per car; no field or simulation upload lattice is acquired merely on spawn.
- Fixed **64³ or 128³** fine cells over the same 24 m logical cube. Live quality changes are refused rather than
  silently resetting, resizing or relabelling surviving contents.
- Two `RGBA16F` images hold density, excess temperature, **advected combustion provenance** and a clear reserved lane.
  Only actually ignited, fuel-consuming tyre sources inject combustion provenance. Warm unignited friction smoke
  therefore cannot become an artificial flame merely because its visual temperature changes.
- The coarse solved world velocity drives midpoint-backtraced fine advection. A world-anchored analytic divergence-free
  curl supplies visual detail. This is **not** an additional fine pressure solve or an unrelated project-owned fluid.
- Whole-cell relocation is a separate exact-texel dispatch. Overlapping scalar/provenance contents retain their world
  location and bit pattern; exposed cells clear. No vehicle quaternion appears in field placement or advection.
- Caller-owned C reception includes completed per-gas-tick source ranges, avoiding application of all future sources
  on every fine tick of a slower presentation frame. The latest coarse velocity remains the driver for that batch.
- Terrain occupancy plus an exact rigid chassis-box pose refresh fine obstruction. Car geometry/SDFs are not rebaked
  merely because the car moves. Deformed tyre-SDF obstruction remains explicitly deferred.
- GPU-written occupied-cell bounds limit viewport quadrature without shrinking or relocating the logical domain.
- The shared surface resolves volumes after scene filtering. Denoised irradiance is remodulated with material albedo;
  the distance-field route publishes an additional linear-radiance output. Composition never uses LDR presentation as
  its radiance source and does not contaminate opaque temporal history. Unaffected pixels keep their original result.
- Sliding onset is sustained for 50 ms; release consent uses 60% of onset power with an 80 ms short-gap grace.
  Contact loss excludes fresh friction emission immediately. Ignited airborne tyres can continue burning.

## Resource allowance and device assertions

Measured charged `VkMemoryRequirements` extents (not guessed texture sizes):

| Quality / completion slots | Resident device bytes | No-demand / retired bytes |
|---|---:|---:|
| 64³ / one slot | 4,737,184 | 0 |
| 128³ / two slots | 34,640,160 | 0 |

The explicit per-domain allowance is 40,000,000 bytes. A one-byte allowance is refused and all partial acquisitions
are reclaimed. Coarse velocity uploads are 524,288 bytes plus completed sources and 128 bytes of transport parameters.

Executed production-device assertions cover:

1. Six completed source ticks in a single batch equal six individual advances with the same coarse velocity.
2. Caller storage can be poisoned after capture without being borrowed by subsequent Vulkan recording.
3. A `(6, -4, 2)` fine-cell shift preserves **215,760** texels bit-exactly, clears **46,384**, and does not advance time.
4. Rigid vehicle yaw cannot rotate or drag retained world gas.
5. Source cessation/restart reuses residency; malformed tick ranges and nonfinite poses preserve the existing domain.
6. Both quality allocations, explicit ceiling refusal and full retirement are measured.

The actual-car clips also check paused revisions and opaque interception in front of every volume sample. Device
transport/render and CPU physics/snapshot timings are in the certificate and CSVs. **Software-device milliseconds
are not a hardware-GPU frame-budget claim.**

## Thermal and fire scope

The default ignition settings remain **623.15 K sustained for four seconds**, available combustible rubber and a
finite burn rate. A separate native thermal test exercises those untouched constants under sustained sliding heat.
The flame clip explicitly uses shortened visual-test settings: 100 J/K tread capacity, 315 K ignition, 310 K extinction
and 0.2 s exposure. It is not evidence that ordinary driving ignites.

The authored plume heat conversion and emission palette are visual calibration, not empirical rubber/air combustion
validation. Physical tread/carcass/gas conditions, pressure and grip remain independent of visual quality. Normal drift
fixtures do not ignite. The heat-work account remains separate from previously reported unresolved hard-landing
energy-account failures.

## Reproduction

```text
python Tools/Build/ProjectCodeSequence.py --project Project-Zero
python Tools/Tests/RunZeroSmokeExhibit.py --device-checks
python Tools/Tests/PublishZeroSmokeExhibit.py
python Tools/Tests/CheckDriveSmoke.py
python Tools/Tests/CheckDriveDynamics.py
```

GCC and MSVC `/MD` code-image/proof routes consume the explicit JSON source rosters. The root authoritative MSVC and
CMake routes include the new shared compiled sources and both shaders. Run dependencies/build products/logs/raw
captures stay in `_AgentScratch`; only the requested gallery media, measurements and source-linked certificates are
published under `Exhibits/Gallery/ProjectZero`.

## Current verification status

- Eleven native shared foundation groups and five Drive-compatible thermal/smoke fixtures passed; the real Drive C
  callback copied 236 resident snapshots and passed pause/step/reset/retirement checks.
- Current shared vehicle/contact/possession/deployment dynamics regressions passed.
- ASan/UBSan/leak assertions passed for the eleven foundation groups only; this is not a sanitizer claim for the
  full vehicle or Vulkan programs.
- Five actual Project-Zero clips passed on one source/code-image identity; all 300 decoded native 3D frames are
  individually paused in the real-browser-audited gallery.
- The changed DF resolve lowered on fixed and bindless shader variants; the C transport extension passed C11.
- The authoritative host source lists agree on all 127 compiled units. The broad repository source-list gate still
  reports twelve **pre-existing legacy orphan units**. The broad ownership gate still reports unrelated/retired
  legacy project window entries and cross-project includes. This continuation does not hide or certify those
  existing architecture debts. It introduces no project-owned window/renderer or project-to-project source include.
- Full Swapchain syntax checking against the hash-locked, unpatched ImGui headers reaches the four pre-existing
  custom TabSlant/TabOverlap/TabHeight/TabStripPadTop members. Full native-window/MSVC execution is not claimed.
