# Tyre contact and GPU tyre deformation — decision report

Date: 2026-10-14 · Branch `arena/215a6f39-frontier` · State at `5f264e0`

## 1. Decision restated

1. **Wheel contact = ray-trace suspension/tyre system.** The GRIT trajectory-atlas contact (fan of rim samples →
   one patch, one normal, one load) is the production model (`TraceContactTyre.h`, default since `5f264e0`).
   Measured on `VehicleDrivingChecks`: 12/12 pass, 1.3 s per suite; XPBD was 8/12 and 20–90 s.
   For 4 tyres × 60 players it is 57 point queries per wheel per step ≈ 14 k per step — sub-millisecond on one core.
2. **XPBD is removed from the Frontier C++ entirely** (not kept behind an option). Inventory in §2.
3. **Tyre deformation stays, and is purely visual, on the GPU.** The physics never reads the deformed mesh; the mesh
   is shaped from the solver's per-wheel contact figures. Options and recommendation in §3–§5.

## 2. XPBD removal inventory (Frontier only)

Sources to delete:
- `Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.{h,cpp}`, `XPBDTyreValidation.cpp`
- `Engine/PhysicalDynamics/XPBDTyreSolver.{h,cpp}` (older solver, no image links it)
- `Experimental/TyreLattice/index.html` (the WebGPU lattice study) — archive or delete

Files that reference XPBD types and must be re-homed onto the trace model:
| File | What it takes from XPBD | Replacement |
|---|---|---|
| `VehicleSolver.{h,cpp}` | `SoftTyres`, `SoftTyreParameters Tyre`, `TyreSubsteps`, `HubMotion`, `TyreReaction`, `GroundQuery` type, `Vec3/Quat` | Move `Vec3/Quat/HubMotion/TyreReaction/GroundQuery` into a small `VehicleMath.h` + `WheelContact.h`; `Tyre` becomes `TyreGeometry {Radius, RimRadius, Width, InflationPressure}`; drop `TyreSubsteps` |
| `TraceContactTyre.h` | includes `XPBDSoftTyre.h` for the types | include `WheelContact.h` |
| `VehicleInstanceSequence.{h,cpp}` (Engine + Drive wrapper) | `Tyre.MaterialFrame()`, `HubPosition()` for wheel rows; `GroundQuery` | solver telemetry: `Wheels[i].HubPosition/HubRotation` + a `SpinAngle` field (add to `WheelTelemetry`) |
| `GeometricRaster/TyreSequence.h`, `WheelProjection.h` | captures nodes to project vertices | deleted; replaced by the GPU deformation record (§5) |
| `Projects/Project-Drive/Source/ProjectDriveInterchange.cpp` | `Surfaces[]` (TyreSequence), `ProjectGeometryInterchange` per-vertex path | publishes `TyreDeformationRecord` per wheel instead |
| `DriveSceneAuthor.cpp`, `DriveContentHost.cpp`, `TyreGeneratorSequence.*`, `DriveCourse.h`, `DriveSpawnChecks.cpp`, `DriveTelemetry.cpp`, `Drive*Checks.cpp` | `GroundQuery` type, rest-lattice tessellation constants, node telemetry | `GroundQuery` from `WheelContact.h`; render tessellation constants stay (render-only) |
| `VolumetricDynamics/GasVehicleIntake.h`, `ThermalIntegrator.h` | `RestVolume()/EnclosedVolume()` for the gas-thermal path | analytic torus volume from `TyreGeometry` (rest volume is all the trace model ever reported anyway) |
| `VehicleStructure.{h,cpp}`, `VehicleGeometry.*`, `VehicleSpawnSolver.h`, `Aerodynamics.h`, `SuspensionSpecification.h`, `VehiclePhysicsThread.h` | comments / type names | text only |
| `Exhibits/Workbench/Automotive/*` (DynamicsProof, RenderProof, AirTyreMetrics, Fixture) | config fields `Tyre.RingCount` etc. | drop the fields; proofs re-run |
| `Projects/Project-Tractrix/Source/ProjectTractrixIdentity.h` (`kTyreSubsteps`), `TractrixProvingGround.h`, `TractrixVehicleScene.h` | substep constant | delete |
| Rosters: `DriveSimulationSources.json`, `DriveContentSources.json`, `Tools/Build/CheckBuildSourceList.sh` (lines 110, 117) | compiled-source lists | remove entries |
| `Plans/Ongoing/MasterPlan.md`, `ProceduralTyreAndSurfacePainting.md`, `SmokeSequence.md`, `Docs/*TransportReview.md`, gallery `*.json` | prose / recorded metrics | prose updated; proof JSON left as history |

Nothing in the HMI, smoke, SDF-GI or display stacks depends on XPBD; the smoke's wheel-telemetry adapter reads
`WheelTelemetry` only.

## 3. What the physics now gives the renderer, per wheel, per step

From `TraceContactReading` + `WheelTelemetry` (all already computed):
`Deflection δ` [m], `Rate` [m/s], contact `Normal` (world), `PatchCentre`, `HitCount`, `Fz, Fx, Fy, Mz`, `SlipRatio κ`,
`SlipAngle α`, `WheelOmega ω`, `SteerAngle`, camber (0 today), hub pose, gas gauge pressure and temperature.
That is enough to drive every visible tyre effect a game shows: vertical squash and sidewall bulge (δ, p),
patch flattening (δ, Normal), lateral lean of the carcass under cornering (Fy/Fz, α), longitudinal lead/lag of the
tread band under traction/braking (Fx/Fz, κ), centrifugal growth and standing waves (ω), kerb-edge one-sided
compression (patch offset across the tread from the lateral slices).

## 4. Options for the GPU deformation

### A. Rig & skin (the Chaos Vehicles way)
Chaos Vehicles itself does **not** deform the tyre; the wheel bone only spins/steers/translates with the suspension.
Studios that "rig" tyres add 2–3 extra bones (a hub bone, a squash bone scaled by δ, optionally a shear bone
leaned by Fy) and let normal skinning do the rest.
- ✓ zero new shader work if the engine already skins; trivially cheap.
- ✗ a scaled bone squashes the whole torus — the top of the tyre flattens as much as the bottom, the patch is not
  flat, the sidewall bulge is a uniform scale, not a local one. Looks like a soft ball, not a tyre.
- ✗ Frontier has no skinning path yet; adding bones only for tyres is more plumbing than option B for a worse result.

### B. Procedural deformation in the vertex stage (shader), driven by the contact record
What Forza Motorsport, Gran Turismo 7, ACC and Wreckfest-class titles do: the tyre mesh is static; a per-wheel
constant block (≈ 64–96 B) describes the deformation; the vertex shader displaces each vertex analytically and
fixes the normal with the Jacobian.
- Patch: vertices whose rest radius is within δ of the ground plane are projected onto the plane (flat patch of
  the right length ≈ 2·√(2Rδ)), with a C¹ blend over the leading/trailing angle.
- Sidewall bulge: radial-outward offset ∝ δ · sin(across-angle) · falloff from patch, scaled by 1/p.
- Carcass lean: shear of the tread band along the axle by (Fy/Fz)·k_lat, decaying with height above the patch.
- Tread lead: tangential shear ∝ (Fx/Fz)·k_long in the lower half.
- Spin: the material frame already carries ω (existing wheel row); the deformation is evaluated in the *ground*
  frame so the patch stands still while the tread rolls through it.
- ✓ deterministic, ~40 ALU per vertex, 240 tyres cost nothing extra; works for any tessellation; no per-frame
  vertex uploads, no BVH refits; LOD-free.
- ✓ fits the existing raster path: `VisibilityRaster.vert` already reads `VertexRecord` + instance; one more SSBO of
  per-instance deformation records and one branch on an instance flag.
- ✓ shadows (shadow raster uses the same vertex shader source) deform consistently; the mesh-local SDF stays at the
  rest shape (as today) — a 15 mm squash is invisible in GI.
- ✗ no emergent behaviour; everything visible is authored as a formula. For a car game that is a feature.

### C. GPU soft body (compute: mass-spring / projective dynamics / FEM / position-based)
- ✓ emergent shape for arbitrary obstacles (kerbs edge-on, debris).
- ✗ it is the thing we just removed, moved to the GPU: per-tyre iterative solve each frame, readbacks if anything
  else wants the shape, non-determinism across GPUs/drivers (a problem for replays and networked proofs), and
  still needs a collision representation of the road on the GPU. The physics would not use it, so it is a
  visual-only cost of 0.1–0.5 ms per tyre per frame at 1k–3k nodes — i.e. the whole frame budget at 240 tyres.
- ✗ no engine in the real-time racing space ships this for tyres; BeamNG runs it on the CPU for a handful of cars.

## 5. Recommendation

**Option B — procedural vertex-stage deformation from the contact record**, with the record published through a
versioned C interchange (replacing the per-vertex `ProjectGeometryInterchange` path, which was only there to carry
XPBD nodes and forces a scene-sized vertex re-upload every frame).

Proposed `TyreDeformationRecord` (std430, 96 B, one per wheel instance):
```
vec4 GroundPlane;      // object-space plane (n.xyz, d): the patch plane in the wheel's material frame
vec4 Load;             // δ [m], δ-rate [m/s], gauge pressure ratio p/p0, Fz/Fz0
vec4 Slip;             // Fx/Fz, Fy/Fz, κ, α
vec4 Shape;            // R, RimRadius, HalfWidth, patch lateral centre (−1..1 across the tread, from the slices)
vec4 Spin;             // ω [rad/s], centrifugal gain, kerb one-sidedness, flags
vec4 Tuning;           // bulge gain, lean gain, lead gain, patch blend angle
```
Pipeline: solver → `WheelTelemetry` (+ δ, normal, patch offset) → Drive publishes 4 records/frame →
`VisibilityExchange` uploads a tiny SSBO → `VisibilityRaster.vert` / `ShadowRaster.vert` deform when the instance
flag is set → `SurfaceResolve` normals come out of the Jacobian in the same function (shared `.slang` include).
Validation: a CPU mirror of the same function (the pattern BlasRefit uses) gives byte-identical reference images
in the workbench without a GPU; visual proofs are hub-drop (δ = 0/10/25/40 mm), skid-pad lean at 0.8 g, kerb
one-sided compression, 60 m/s centrifugal growth — same car, same camera, before/after per clip as usual.

Cost: ~2 days — record + interchange (½), shader + Jacobian normals (1), CPU mirror + proofs (½). XPBD removal
(§2) is a separate, mechanical commit done first so the deformation lands on a clean tree.

## 6. Open points to settle before implementation
- Keep the authored tyre at the current 9×128 tessellation or let the asset decide (the shader does not care).
- Whether the record carries tread temperature/pressure for tint (the thermal path already produces both).
- Whether the GI SDF should ever follow deflection (recommendation: no; it is a 1–4 cm effect under a 20 cm voxel).
