# Surface Display — Cabin HMI port (tablet + cluster) into Project-Drive

Status: in progress (13 Oct 2026). Source of truth for the UI behaviour is the accepted HTML prototype in
`Experimental/TabletPanel/` (launcher/apps, Settings launcher picker, irregular cluster outlines, no squashed
rasters on shape change). This plan ports it to C++ as a **generic engine facility** and mounts it in the
ControlVehicle cabin.

## Findings that shape the design

- The host owns the renderer. A project image only reaches the scene through the versioned C interchange
  (`ProjectInterchange.h` + optional extensions `GeometryInterchange.h`, `SmokeInterchange.h`). There is no
  texture extension yet.
- Materials already carry an **Emission texture channel** (`MaterialTextureChannel::Emission`,
  `EmissionLuminance` [nit]); `SceneStructure::Finalise` turns every triangle whose material has
  `EmissionLuminance > 0` into a `LuminaireRecord` (Walker alias table), so an emissive quad is a real light
  for ReSTIR NEE and the distance-field GI. The emission texture modulates the luminance at shading
  (`MaterialEvaluation.slang`, channel 6 is never gated). ⇒ **a textured emissive quad is GI-participating by
  construction.**
- `TextureIndex::RegisterHalves` re-seats a named slot in place (sky dome bake). There is no RGBA8 in-place
  re-seat and `SwapchainExchange::UploadTextures` rebuilds the whole table under `vkDeviceWaitIdle`. A live
  display needs a single-slot refresh.
- `PunctualLuminaireRecord` (KHR_lights_punctual) is CPU-only scene-graph data; the path kernel lights the
  scene from the sun/moon/sky and **emissive triangles only**. ⇒ the "interior point light" is authored as a
  small emissive dome lamp (cabin ceiling), which is the path that actually lights the cabin in this engine.
- `ControlVehicleSockets` has no HMI/steering hard-points (camera-mount sockets are deliberately omitted).
  Placement is estimated from the authored body: ground at model z ≈ −0.417 m, cabin glass spans
  x ∈ [−0.97, 1.33] m, 1.17–1.76 m above ground; the windscreen base sits at x ≈ 1.33 m. Right-hand drive
  (driver at −Y) by default; one constant flips it.
- Fonts: `EngineContent/FontArchives/Inter/*.ttf` are shipped; `ExternalPackages/stb` (whole tree) includes
  `stb_truetype.h`. Text rasterises on the CPU from Inter, so the C++ port keeps the prototype's typography.

## Naming (SKILL-Naming; generic, not car-specific)

New engine module `Engine/SurfaceDisplay/` — "a flat, texture-backed, emissive display surface in the world":

| File | Role |
|---|---|
| `DisplaySheetStructure.{h,cpp}` | Owns an RGBA8 texel sheet (+ optional shape mask), size, revision. |
| `DisplayRasterProjection.{h,cpp}` | Draws primitives into a sheet: fills, rounded rectangles, polygons, arcs/rings, strokes, text, clipping, alpha blend. |
| `TypefaceSheetCodec.{h,cpp}` | Decodes a TTF into glyph coverage bitmaps on demand (stb_truetype), measures strings. |
| `DisplaySurfaceStructure.{h,cpp}` | Authors the world geometry: an outline polygon (rectangle, hexagon, arc, trapezoid, pill…) in display millimetres → triangles with UVs mapped 1:1 to the sheet (never stretched), and the emissive `MaterialDescriptor`. |
| `DisplayTouchProjection.{h,cpp}` | Pointer ray ↔ display pixel; Android/iPhone-style tap / long-press / swipe / fling / scroll state machine. |
| `TabletScreenSequence.{h,cpp}` | The launcher (Launchpad / Focus / Grid…) and apps (Drive, Media, Climate, Garage, Settings, Navigation…) — the prototype's `TabletSequence.js` + `AppSpecification.js`. |
| `ClusterScreenSequence.{h,cpp}` | Instrument cluster against a `ClusterReading` (speed, rpm, gear, temps, pressures, warnings) in the prototype's four outlines. |

Interchange / host:

| File | Role |
|---|---|
| `Engine/ProjectInterchange/DisplayInterchange.h` | `FrontierProjectDisplayReading` + `ProjectDisplayInterchange` optional export (ABI3 unchanged, same shape as smoke/geometry). The host passes the pointer ray + press; the project returns the current sheet span + revision. |
| `Engine/ProjectInterchange/CodeInterchange.{h,cpp}` | Resolve the optional export. |
| `Engine/Host/DisplaySequence.h` | Polls every display subject per cycle; on revision change re-seats the texel slot and asks the exchange for a single-slot refresh. |
| `Engine/ContentInterchange/TextureIndex.{h,cpp}` | `RegisterTexels` (RGBA8 in place by name). |
| `Engine/DeviceExchange/SwapchainExchange.{h,cpp}` | `RefreshTexture(slot)` — re-uploads one resident image (same extent) without rebuilding the table. |

Project-Drive:

| File | Role |
|---|---|
| `Projects/Project-Drive/Source/DriveCabinLayout.h` | The estimated placement (tablet, cluster, headliner lamp) in ControlVehicle model space and the shared `CabinScreenBasis` so the author and the DLL agree on the screen frame. |
| `Projects/Project-Drive/Source/DriveCabinDisplays.{h,cpp}` | Feeds vehicle telemetry at the two update rates (cluster 60 Hz, tablet 30 Hz), resolves touch rays against the posed glass, and serves `FrontierProjectDisplayReading`. |
| `DriveSceneAuthor.{h,cpp}` | `AppendCabinFixtures`: screen glass (materials 16/17 `Display:CabinTablet` / `Display:DriverCluster`, emissive 24/28 nit so the GI luminaire pass picks them up), bezels (19) and the headliner lamp disc (18, 40 nit) are part of the body span, so they ride with the chassis (scene revision 7). |
| `ProjectDriveInterchange.cpp` | Exports `ProjectDisplayInterchange`; constructs/advances `DriveCabinDisplays`. |
| `Engine/SurfaceDisplay/DisplayMeshProjection.{h,cpp}` | Flat CPU mesh projection used by the tablet's Garage car preview and the cabin diagnostic sheets. |

Proof: `VisualProof/SurfaceDisplay/` — CPU-mirror harness that rasterises launcher, Settings picker, Garage,
the four cluster outlines, runs the touch state machine, and self-checks (pixel assertions, aspect/no-stretch
invariants, revision monotonicity, interchange refusals), writing PNGs + `SurfaceDisplayAudit.json`.

## Steps

1. ✅ Research (above).
2. ✅ Engine module (sheet, raster, typeface, surface geometry, touch, tablet, cluster, mesh projection).
3. ✅ Interchange + host + texture refresh (`DisplayInterchange.h`, `Host/DisplaySequence.h`, single-slot `TextureIndex` refresh).
4. ✅ Drive integration (placement, lamp, rates) — fixtures live on the body span, so no extra mutations are needed.
5. ✅ Rosters: `DriveSimulationSources.json` (DLL: SurfaceDisplay + `DriveCabinDisplays.cpp`), `DriveContentSources.json`
   (`DisplaySurfaceStructure.cpp` for the author), `ProjectDrive.cmake` (stb include), `RunDriveExhibit.py`,
   `CheckDrivePlayback.py`. Frontier.exe gained no new TU (`DisplaySequence.h` is header-only), so the MSVC
   engine/host rosters are unchanged.
6. ✅ Proofs (`Tools/Tests/CheckSurfaceDisplay.py` → `VisualProof/SurfaceDisplay/`, gallery `index.html`, live sheets
   from the code image under `Live/`) + commit.
7. ✅ Windows binaries from GitHub Actions (`Frontier build` → artifact `frontier-windows-desktop`). Two things stood
   between the branch and a green MSVC job, neither HMI-specific: `std::max`/`std::toupper` without their headers
   (MSVC's `<cmath>` does not drag `<algorithm>` in), and `ToolchainSequence.ps1` writing both
   `VehicleInstanceSequence.cpp` files to the same `.obj` under `/Fo<dir>\` — same-named sources now get a
   folder-qualified object of their own. The workflow also emits every `error C…/LNK…` line as an annotation, so a
   failure is readable without the raw log.
8. **Open — needs a GPU:** the in-engine frame of the lit screens in GI; measuring the single-slot texture refresh.

## Harness note

A touch ray computed from the *previous* body mutation lands off-centre at speed (≈0.5 m of travel per frame at
100 km/h); the host builds the pointer ray against the frame it displays, so this only affects offline harnesses —
tap while paused or stationary there.

## Deferred / known limits

- Startup particle sequence and per-car tablet specifications beyond ControlVehicle.
- The single-slot refresh waits on the graphics queue for the frame in flight; a fenced staging ring is the
  follow-up once measured on hardware.
- Shape-mask edge anti-aliasing uses the sheet alpha; the quad outline itself is the hard clip.
