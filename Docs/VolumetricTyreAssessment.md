# Volumetric tyre: assessment and Frontier integration plan

**Date:** 16 October 2026  
**Scope:** assessment of the current WebGPU tyre lab, the three supplied screenshots, and the checked-in Frontier interfaces. This is a report, not a native integration or a new hardware benchmark.

> **Subsequent implementation update:** this report assessed baseline commit `807559c`. The uniform-upload bug and several scheduling costs have since been fixed, and a GPU admissibility filter and severe-load tests were added. Read [TyreGpuHardening.md](TyreGpuHardening.md) for the current changes, measurements and safety limitations. The original assessment below is retained as baseline evidence.

## Executive decision

**Proceed with the corotational volumetric tyre as an experimental GPU subsystem and native test-rig project. Do not yet use its output as authoritative vehicle-handling physics.**

The demonstration has established that GPU-resident deformation, direct rendering of solved nodes, and asynchronous load telemetry are practical. Your screenshots add useful hardware evidence: approximately **4.85 ms for one sampled solver tick**, alongside a browser frame interval of approximately **17.3 ms**. That is encouraging for a first implementation, but expensive for a production four-wheel system and not evidence of calibrated tyre behaviour.

The screenshots also show an **INVERTED ELEMENTS** warning. An element whose deformation determinant becomes negative has crossed through zero volume and reversed orientation. That is a material-state failure, even if the outside surface still resembles a tyre. The current implementation does not prevent it.

There are therefore two separate conclusions:

- **Feasibility:** good enough to justify further work on the volumetric approach.
- **Production readiness:** not ready; inversion prevention, force validation, chassis coupling and performance engineering are blocking work.

The volumetric mode should become the primary research path. Keep the edge mode as a diagnostic baseline rather than trying to make one stiffness slider cure its folding.

## 1. What the screenshots actually establish

| Observation | Interpretation | What it does not establish |
|---|---|---|
| Approximately 4.85 ms in GPU SOLVER | A timestamp sample of the compute pass for a simulated tick, including solver/contact/diagnostic reduction | A median, worst case, whole-frame GPU time, or four-wheel cost |
| Approximately 17.3 ms frame interval | About 58 browser animation callbacks per second over the displayed rolling average | Exact GPU rendering time or CPU physics time |
| Belt speed shows 3.0 m/s | The rig requests this belt velocity and integrates rim rotation from it | A free vehicle driving at that speed |
| Compression around 92 mm, stiffness 0.25, cleat selected | A severe, deliberately soft test configuration | A representative passenger tyre operating point |
| Inverted-elements warning | At least that displayed sampled state has invalid element orientation | A physically acceptable result just because it remains bounded |
| Reaction around 6.5 kN in one screenshot | An uncalibrated contact-correction estimate | Validated wheel load or full hub force/torque |

### “5 m/s” versus “5 ms”

If you mean **roughly 5 milliseconds of solver time**, the screenshot supports that observation for one sample on your machine. The GPU model, driver, sustained distribution and thermal conditions have not been supplied.

If you mean **a belt speed of 5 metres/second**, that is a different test. The current UI tops out at 3 m/s; the supplied screenshots do not establish a 5 m/s test. At 5 m/s:

- Road speed is 18 km/h, which is still low for a road vehicle.
- With the demo's 0.48 m radius, prescribed wheel speed would be about 10.42 rad/s, or 99.5 rpm.
- At the current 1/240 s substep, belt travel is about 20.8 mm per substep.
- The generated mesh's shortest rest edge is about 26.0 mm. That travel is a substantial fraction of the smallest element scale, before considering road features and slip.

Consequently, being stable at 5 m/s would be useful but not a high-speed vehicle validation. At 120 km/h the corresponding travel is approximately 139 mm per current substep. Contact prediction/CCD, speed-dependent temporal resolution and collision-feature resolution must be designed, not assumed to follow from a low-speed demo.

The displayed “% real-time” is also only a lifetime simulation-time/wall-time ratio since reset. Pauses count against it. For benchmarking, use **change in simulation tick count divided by active elapsed time**, record pauses, and measure a fixed post-warmup interval.

## 2. Why the edge model folds inward

### The distinction that matters

**XPBD is the constraint solver, not the tyre material. Both lab modes use XPBD.** The comparison is:

1. An edge-length network plus tetrahedral volume penalties.
2. Corotational tetrahedral material strain plus volume penalties.

The result does not demonstrate that “XPBD always folds” or that the volumetric solver is unrelated to XPBD. It indicates that the second material representation and its numerical safeguards behave better in your tested configurations.

### Specific weaknesses in this implementation

- **An edge length has no orientation information.** Even all six lengths of one tetrahedron determine its shape only up to reflection. The volume term distinguishes orientation energetically, but its finite penalty is not a hard positive-determinant barrier.
- **Finite sweeps leave residual error.** The material, rim attachments and ground projections compete. A later colour or ground correction can undo an earlier element's volume improvement.
- **There is no self-collision.** Separate surface regions can pass through one another. Positive element volume alone would not prevent all global self-intersections either.
- **There is no real carcass construction.** No anisotropic belt/cord layers, pneumatic cavity, or separately modelled thin sidewall/bead system supplies the intended tyre mechanics.
- **The contact projection is approximate.** The ground/cleat pushes vertically, not along exact surface normals; the cleat is not a general road-mesh collider.
- **The exposed extreme is severe.** At the nominal centre section the radial solid thickness is 215 mm. A prescribed 92 mm rim drop is about 43% of that thickness. At the 45 mm cleat peak the available gap is reduced by another 45 mm, giving roughly 64% nominal local compression. Shoulder geometry differs, but this illustrates the severity.

An edge network containing all tetrahedral edges does resist shape/shear changes; it is **not correct** to say it has no shear resistance. The problem is the combination of material representation, orientation ambiguity, finite convergence, contact and missing nonpenetration safeguards—not distance constraints being inherently incapable of solid simulation.

## 3. Why the volumetric version is the better starting point

It measures the full deformation gradient `F = Ds inverse(Dm)`, extracts an approximate proper rotation `R`, and penalizes `||F-R||` and `J-1` with rest-volume weighting. This provides a clearer, rotation-aware constitutive model than a network of edge stiffnesses.

Useful existing pieces:

- GPU-resident positions, velocities, rotations and multipliers.
- Graph-coloured in-place updates without overlapping node writes inside a colour.
- Persistent quaternion rotation extraction, avoiding inversion of a nearly singular deformed matrix.
- Element-relative trust-region limits on strain and volume projections.
- Contact impulse reduction and an asynchronous telemetry path.
- Rendering the solved positions without deforming the tyre in a vertex/material shader.

However, **corotational elasticity is not a complete rubber or tyre model**. Rotation extraction is approximate; trust-region limiting is not inversion prevention; the effective filled solid is not a hollow pneumatic tyre. The current material values are not fitted to measurements, and the two modes are not modulus-matched. Better-looking deformation is evidence worth pursuing, not a validation of load accuracy.

## 4. Performance assessment

### Frame-budget interpretation

Using 4.85 ms only as the observed sample:

| Budget | One tyre's observed solver share |
|---|---:|
| 60 fps / 16.67 ms | About 29% |
| 120 fps / 8.33 ms | About 58% |
| Four equivalent tyres, naively sequential | About 19.4 ms of solver work before rendering and other GPU work |

Four tyres should share dispatches where possible, so **19.4 ms is an arithmetic warning, not a measured prediction**. Batching improves occupancy and amortizes dispatch overhead but does not eliminate four tyres' material and collision work. Concurrent compute/render execution is not guaranteed to hide the cost.

Current full-resolution topology: 1,792 nodes and 6,912 tetrahedra per tyre. At four sweeps and four substeps, the volumetric mode records approximately **548 compute dispatches per tick**: 32 material-colour dispatches and one contact dispatch per sweep, plus prediction, multiplier clearing, velocity reconstruction and two reduction dispatches per substep. The edge mode additionally visits 16 edge colours, bringing its corresponding count to approximately **804**. Material differences are therefore confounded with different dispatch/work counts when comparing the two timings.

### Code-audit finding: unnecessary uniform upload

`Experimental/TyreGpuLab/app.js` currently allocates both the parameter buffer and each tick's staging ArrayBuffer with:

```
4 * records * records * 256
```

Only `4 * records` aligned records are addressed; `records = 49`. The required span is therefore:

```
4 * records * 256
```

The present allocation/upload is **2,458,624 bytes instead of 50,176 bytes**, a 49× excess. At 60 ticks/s that is approximately 147.5 MB/s rather than 3.0 MB/s of parameter uploads, plus avoidable JavaScript allocation/GC pressure. This is a concrete optimization to correct before re-benchmarking. It does not explain the constitutive folding and does not mean GPU solver time will improve by 49×: the timestamp is around compute execution, not all CPU upload/encoding overhead. The report leaves the measured lab code unchanged so the existing screenshot baseline is not silently replaced.

### Recommended performance work, in order

1. Correct/reuse the parameter staging allocation and separate CPU encode/upload time from GPU execution time.
2. Batch tyres by colour into shared dispatches; instance-index the storage and material records.
3. Use push constants/dynamic offsets and immutable topology efficiently in the native implementation.
4. Profile dispatch ordering, occupancy and memory traffic with timestamp ranges per stage, not just one total.
5. Compare mesh quality/resolution and solver budgets at matched force/error tolerances. Fewer tets is only an improvement if the load response remains valid.
6. Add distance/importance LOD for physics with documented coupling behaviour; do not quietly replace physical reactions with a visual-only deforming mesh.
7. Add speed-adaptive substeps or robust collision-time handling, measuring their worst-case cost.

A reasonable **initial design goal**, not an achieved result, is a 1–2 ms total near-vehicle tyre budget at 60 Hz on a named target GPU. Actual project hardware and rendering budgets must decide whether that is feasible. The current 4.85 ms single-tyre sample does not meet that proposed four-wheel target.

## 5. Can the engine use the returned load?

Yes, but the current exported number is not the required coupling contract.

The demo estimates belt reaction from accumulated contact position corrections, `F = m deltaX / h²`, averaged across substeps. That is useful telemetry for a kinematic test rig. It does **not** sum the bead/rim attachment reactions, rigid wheel torque, or the carcass inertia needed to infer dynamic hub load.

For a coupled wheel, compute the **actual applied attachment impulses** and reduce:

```
linear impulse on rim = negative sum(attachment impulses applied to tyre)
angular impulse on rim = negative sum((attachmentPosition - rimCOM) cross attachmentImpulse)
```

Accumulate the realized corrections after trust-region limiting/contact handling, not an unclipped theoretical multiplier. When multiple projections alter an attachment interaction, define impulse ownership consistently; do not infer a correct wrench merely by summing positional deltas without a momentum audit.

Reduce both components on the GPU. Export a record containing wheel identity, simulation tick, interval, linear impulse, angular impulse, validity flags, minimum J and solver residual. Units should be N·s and N·m·s. Divide by the same simulation interval only when a force/torque consumer needs it.

For a GPU rigid-body consumer, read that record in a later GPU pass. For CPU Jolt, use a small fenced readback ring tagged by tick, never `vkQueueWaitIdle` or synchronous readback per wheel. Handle delay explicitly: predicted hub boundary conditions, bounded extrapolation if validated, stale-sample rejection, and a coupled stability test. The demo's approximately 130 ms telemetry sampling cadence is **not suitable for vehicle force feedback**.

Do not apply both a complete ground-contact impulse and the complete rim-reaction impulse to the chassis: that double-counts the tyre interaction. Internal tyre–rim exchange must be equal and opposite; ground momentum belongs to the external contact.

## 6. Frontier-specific integration plan

### Existing interfaces inspected

- `CMakeLists.txt`: native Project-Zero uses Vulkan, with GLSL/Slang shader build support. The Jolt target explicitly excludes its compute backends; enabling the current Jolt library does not enable GPU tyre simulation.
- `Engine/PhysicalDynamics/RigidBodySolver.h`: Jolt is behind a backend-neutral seam; a fixed-step accumulator and body pose queries exist. The exposed interface has centre-of-mass `ApplyImpulse`, but no exposed angular impulse or impulse-at-position call for full wheel wrench application.
- `Projects/Project-Zero/Source/PhysicsInstanceSequence.h`: the existing bridge updates rigid instance transforms and CPU flat triangles for moving rigid bodies. A deforming tyre needs vertex-level GPU geometry updates, not just a new instance matrix.
- `Engine/GeometricRaster/BlasBuildPipeline.h`: examples of Vulkan compute dispatch/barrier/timestamp plumbing exist. Its host-visible verification job and blocking run-tool patterns are not a shipping tyre buffer/queue design to copy literally.

### Proposed ownership—not existing APIs

| Area | Proposed responsibility |
|---|---|
| `Engine/PhysicalDynamics` | Backend-neutral tyre asset/material data, wheel handles, fixed-step input/output records, validity policy |
| Native Vulkan compute module | Device-local node/tet/rotation buffers, coloured solve dispatches, contact and wrench reductions, synchronization |
| `Engine/Shaders` | Ported GLSL or Slang compute kernels with matching layouts and validated equations |
| Project vehicle bridge | Body/wheel mapping, steering/spin/torque inputs, tick-tagged boundary conditions and Jolt impulse exchange |
| Rendering/acceleration | GPU deformed surface positions, normals, previous geometry, bounds and acceleration updates |
| `Engine/DeviceExchange` | Small diagnostic/telemetry transport, not the authoritative solver state |

The WGSL is a useful executable specification; it is **not directly a native Vulkan shader artifact**. Port or deliberately adopt a WGSL-to-SPIR-V toolchain, then compare captured GPU results under the same inputs. This is a new native GPU subsystem, not a flag to switch on in the present engine.

### Coordinate conversion is a correctness gate

The WebGPU lab is right-handed **Y-up**; Frontier's rigid-body seam is right-handed **Z-up**. Use a proper basis rotation consistently for positions, forces, velocities, orientations and winding. For example:

```
(x, y, z)lab -> (x, -z, y)engine
```

This has determinant +1. Simply swapping Y and Z reflects the basis and can invert every tetrahedron. Recheck positive rest volumes after any conversion and ensure wheel spin/torque signs match.

### Synchronization/rendering contract

Keep dynamic tyre state device-local. Upload only boundary conditions and small controls, with a ring for in-flight frames. Insert explicit compute-write → subsequent-compute-read/write dependencies between dependent colours, and compute-write → graphics/acceleration-read dependencies before consuming the surface. WebGPU's implicit resource ordering must not be assumed to appear automatically in a Vulkan port. Avoid globally idle waits.

Maintain previous solved surface positions for motion vectors, update normals and bounds, and ensure shadows/reflections/ray tracing see the deformed tyre. Refit an acceleration structure only if its update rules permit it; otherwise rebuild the relevant structure. Updating only the visible raster mesh while leaving the ray-traced mesh undeformed is not a complete integration.

### Milestones

**A. Native GPU kinematic rig:** port only the volumetric solver first; preserve lab input traces, GPU diagnostics and a no-CPU-tyre-solver policy. Fix the uniform overhead. Measure a single tyre and four batched tyres.

**B. Numerical hardening:** positive-determinant safeguards, self-contact strategy, robust road normals/CCD, and documented material/compression limits. A local per-tet determinant check is insufficient if later neighbour updates can invert it; use incident-element-aware admissibility or a coordinated safe-step method. Fail explicitly on invalid states rather than hiding them behind a plausible mesh.

**C. One dynamic wheel:** replace the prescribed rim with a full moving boundary, reduce bead impulses/torques, extend the rigid-body seam for angular/point impulses, and validate coupled momentum with readback latency. This stage still has no whole-car claim.

**D. Four-wheel vehicle:** validate acceleration, braking, cornering and rough-road response; calibrate against measurements. Evaluate physics LOD and fallback policy against explicit requirements, without silently introducing CPU tyre physics or a shader-deformation substitute.

## 7. Acceptance tests before handling physics

The following are proposed gates, not results already achieved:

1. **Rest/rotation:** zero-strain rest shape and equivalent response under rigid rotations/basis conversion; no unexplained force at zero compression after accounting for gravity and attachments.
2. **Static load–deflection:** measured reference curves at several material/pressure configurations, equilibrium checks and controlled unloading/hysteresis observations. This requires an appropriate pneumatic construction before claiming pressure dependence.
3. **Convergence:** sweep spatial resolution, substeps and sweeps separately; require load/contact area to settle within a project-defined tolerance (for example 5%) under a tighter reference solve.
4. **Element quality:** no inverted elements in the supported operating envelope; an agreed minimum-J margin and bounds on volumetric error for the chosen material. Rubber's physical near-incompressibility must not be confused with numerical residual.
5. **Contact:** stationary ground/no-slip tests, cleat geometry with true normals, banking, edges, mesh transitions and high-speed sweeps. Check signed contact gaps, not just that Y stays above zero.
6. **Coupling:** free-wheel drop, spin-up/braking torque, action–reaction balance, energy accounting, and artificial 0/1/2/more-tick latency tests.
7. **Timing:** named GPU/driver, warmup, at least a fixed multi-second capture, p50/p95/p99 and maximum for 1/4/many tyres; total frame GPU time, CPU submission time and real simulation throughput.
8. **Long runs:** sustained rolling, steering, load ramps and recovery; invalid states must not quietly produce authoritative chassis impulses.

## Recommendation

**Integrate the volumetric approach as a development feature, beginning with a native GPU test rig—not by directly wiring the demo's Fy into the car.** Your measured timing is promising enough to continue, and the material representation is the stronger foundation. The visible inversion failures mean it is not yet a trustworthy tyre model, and one tyre at about 5 ms is not yet a suitable default four-wheel AAA budget.

The next highest-value work is: correct the parameter-upload overhead; measure one versus four batched tyres on your hardware; implement orientation/contact safeguards; and validate full rim impulse/torque coupling. A credible native tyre should be accepted on its load response, conservation, admissible material states and worst-case frame budget—not solely on the exterior deformation looking convincing.
