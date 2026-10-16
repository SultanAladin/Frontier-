# Frontier · WebGPU Tyre Dynamics Lab

A standalone **GPU physics experiment**, not a native engine feature or an AAA-ready tyre package. No suspension spring/damper model, no CPU physics implementation, no tyre vertex-shader deformation. The tyre render vertex shader reads the positions produced by compute directly.

## Assessment and native integration

See [the hardware-screenshot assessment and Frontier integration plan](../../Docs/VolumetricTyreAssessment.md) for the folding diagnosis, timing interpretation, code-audit findings, coupling requirements and proposed acceptance gates.

## Run

```sh
cd Experimental/TyreGpuLab
python3 -m http.server 8080 --bind 0.0.0.0
# Open http://localhost:8080 locally, or the HTTPS preview URL.
```

Runtime has **zero npm/CDN dependencies**. Use a current browser with hardware WebGPU enabled. HTTPS or localhost is required. Unsupported devices stop with an explicit error; known software/fallback adapters are rejected. Browser/driver adapter reporting is ultimately the browser's responsibility; a web page cannot guarantee which physical device a driver chooses. The status tooltip identifies the reported adapter. Missing timestamp-query support disables the GPU timing number, **not** GPU physics.

Drag to orbit; scroll to zoom. Space pauses, R resets, W toggles edges, G toggles the undeformed envelope (shortcuts do not intercept form inputs). A model switch resets the tyre, retaining test settings. Compression and the cleat height ramp in gradually. Rim rotation integrates belt speed; changing speed does not teleport the rim. Export downloads a diagnostic JSON sample.

## What is being compared?

**XPBD is a solver, not a material.** Both modes use graph-coloured XPBD, but different material constraints:

| Mode | Material constraints |
|---|---|
| Edge carcass | Rest-length constraints on the tetrahedral edge network plus per-tet volume constraints. No explicit spring forces. |
| Volumetric / flesh-inspired | Corotational tetrahedral strain plus per-tet volume. No distance constraints. `F = Ds inverse(Dm)`, strain `C = ||F − R||`, volume `C = J − 1`. Energy is `V0 [mu/2 ||F−R||² + K/2 (J−1)²]`. |

The latter is **inspired by volumetric flesh simulation**, not Epic's Chaos Flesh implementation, not Chaos Vehicles, and not an imported Unreal component. A persistent quaternion per tetrahedron approximately extracts the proper polar rotation with four bounded iterations (avoids inverting nearly singular deformed elements). Element-relative trust regions limit local nonlinear corrections; applied multiplier changes are limited by the same factor. Neither is an inversion-proof solver.

The 64 × 4 × 7 periodic annular mesh has **1,792 nodes, 6,912 positive-rest-volume tetrahedra, 9,856 unique edges**, a 0.48 m outer radius, and a 0.31 m section width. Inner nodes at radius 0.265 m are prescribed rim attachments. Effective nodal mass is 30 kg distributed across all nodes (including attachments). This is a **filled effective carcass**, not a detailed hollow pneumatic tyre. The tread pattern is surface colour only; it does not generate the silhouette, deformation, or contact.

Default effective parameters: edge compliance `1/150000 m/N`, corotational strain modulus `300 kPa`, volumetric penalty `2 MPa`. One stiffness slider scales those together. These values are **not fitted to measured tyre data**, and the edge and solid models are not modulus-matched. Comparing their outputs demonstrates the pipeline, not which material is objectively more accurate.

## GPU execution / ownership

CPU work: mesh and graph construction once, UI/camera, prescribed rig inputs, command encoding, and small telemetry display. All dynamic node positions, velocities, element rotations, XPBD multipliers, contacts, and force reduction live in GPU buffers.

1. Fixed 60 Hz simulation tick, four 1/240 s substeps.
2. Predict GPU nodes under gravity; apply kinematic rim boundary conditions.
3. Reset substep XPBD multipliers. Solve `deltaLambda = (−C − alphaTilde lambda) / (sum(w |gradC|²) + alphaTilde)`.
4. Graph-coloured in-place Gauss–Seidel: 16 edge colours and 32 tet colours; nodes within a colour never overlap. Each dispatch boundary orders dependent colours. No float atomics, cross-workgroup barriers, or concurrent writes to a node.
5. Project vertical belt/height-field contacts after material updates. Apply accumulated tangential displacement projected onto a Coulomb disk after each sweep.
6. Reconstruct velocity; numerical damping is `0.996` per substep.
7. Parallel workgroup reduction then a small block reduction for reactions and final element quality.
8. Draw boundary triangles directly from the solved node buffer.

Aligned immutable uniform records per substep/colour avoid the common WebGPU mistake of overwriting one uniform buffer and having every queued dispatch see the last values.

The frame loop advances at most one fixed tick per animation frame, deliberately slowing simulation on a missed budget rather than changing dt or building an unbounded catch-up queue. A displayed **% real-time** exposes that slowdown. It also slows on displays rendering below 60 Hz. A shipping engine needs an independent scheduler and a GPU command/latency budget.

## Can it return tyre load? Yes—with important distinctions

The GPU sums the actual positional contact corrections. For a free node of mass `m` and substep duration `h`:

```
vertical reaction estimate = m * accumulatedContactDeltaY / h²
```

Equivalently, contact impulse is `m * deltaY / h`. This lab averages four substep reactions for the reported tick. The ground receives the opposite reaction. Tangential corrections are reduced in the same units. Reduction output stays GPU-resident and **can be consumed by another GPU rigid-body pass without readback**.

For CPU consumers, the lab copies only 32 bytes of statistics plus 16 bytes of optional timestamps into one asynchronous staging buffer, about every 130 ms. It never synchronously maps the live simulation buffer or waits in the frame loop. **Readback age includes GPU queue/map latency**, measured from capture submission. The UI intentionally samples slowly; a production readback ring could sample each tick, but still has nonzero latency.

**Belt reaction is not automatically hub load.** This is a displacement-controlled, kinematic rim rig. During transients, carcass inertia, gravity, and rim reactions matter. It does not sum bead-constraint reaction forces or couple a moving chassis. A CPU vehicle must not use these slowly sampled numbers as zero-latency suspension forces. A real integration would compute full bead impulses/torques and use same-GPU rigid-body coupling or explicitly handle delayed CPU feedback.

The cleat uses a **vertical gap projection**, not exact signed-distance normals. `Fy` remains vertical support; it is not a fully resolved sloped-surface normal force. Friction is an approximate positional Coulomb model. The cleat is a stationary height-field obstacle while the belt velocity is prescribed. The rig is not a moving road conveyor with physically transported obstacles.

## Debug / timing

- Shaded actual geometry; surface edge overlay; undeformed reference envelope.
- Contact heatmap: accumulated vertical position correction (impulse-proportional for equal node masses).
- Volume heatmap: peak incident-element `|J−1|` encountered during the last substep before local volume projections. Conservative/transient, **not a stress-in-Pascals plot**.
- Numerical telemetry: final last-substep minimum `J`, maximum `|J−1|`, averaged contact-node count, tangential force, sample age. `J <= 0` means inverted material. High local errors trigger a visible quality warning rather than being hidden.
- GPU solver milliseconds: optional hardware timestamp query around the complete compute pass, including contact and diagnostic reduction, excluding render/readback and CPU command encoding. It is a sampled tick, not a calibrated benchmark.
- Frame interval: rolling average of requestAnimationFrame intervals, including browser scheduling. This is **not CPU solver time**. Plot auto-scales.
- The debug-only `window.tyreLab.snapshot()` reads all node data on demand for tests; normal operation never does this.

## Verification

Topology tests require Node.js, not a GPU:

```sh
npm test
```

Optional browser tests (start the server first):

```sh
npm ci
npx playwright install chromium  # if a local browser is not already available
npm run test:gpu
# Or set CHROMIUM_EXECUTABLE_PATH to your installed Chromium executable.
```

`browser-test.mjs` exercises WGSL compilation/validation, both materials, actual GPU buffer snapshots, rolling over the cleat, positive determinants and finite nodes in tested scenarios, reset, UI overlays, JSON export, and software-adapter rejection. `TYRE_LAB_URL`, `CHROMIUM_ARGS` (JSON array), and `PLAYWRIGHT_MODULE` support external test installations. It does not establish correctness over the whole parameter range.

### Validation performed in this sandbox

- All four Node topology tests pass: positive volumes/inverse rest matrices, closed manifold surface, periodic seam, and complete race-free graph colouring.
- WGSL and GPU command validation executed in headless Chromium 131 using **SwiftShader software WebGPU**, explicitly enabled for testing with `http://localhost:8080/?validateSoftware=1`. That opt-in is localhost-only, says **SOFTWARE VALIDATION ONLY**, and is rejected on the normal preview URL. It is not the deployed physics fallback.
- With 38 mm compression, stiffness 1, friction 0.8, four sweeps and four substeps: 100 static ticks per model and then 60 volumetric rolling ticks at 1 m/s with the 45 mm cleat. Node snapshots were finite, above the flat plane, and the sampled minimum J stayed positive. Reset restored the original positions and zero velocity. No WebGPU validation errors in those runs.
- Example observations: edge static ~2.35 kN, min J ~0.73; corotated static ~2.48 kN, min J ~0.67; corotated rolling/cleat sample ~3.97 kN, min J ~0.30. These are **uncalibrated solver outputs**, not tyre-reference measurements. Local volume errors were large (~34% static, ~70% in the cleat sample); the UI reports them. Force convergence is **not** established by merely remaining finite.
- Software compute samples were roughly 125–145 ms/tick in those runs. **These are not hardware-GPU frame times. No physical GPU is available in this sandbox, so AAA performance, GPU-vs-CPU speedup, target-console budgets, and hardware driver coverage remain unverified.** Use the live timing on your GPU and export comparable samples.

## Before an AAA vehicle integration

This demo proves a compute pipeline and load-return mechanism, **not a production tyre**. Still needed: measured load–deflection calibration and convergence sweeps; anisotropic belts/cords; realistic bead/sidewall construction; pneumatic cavity pressure; robust inversion barriers and mesh-quality handling; thermal/wear effects if relevant; contact area/pressure validation; friction, slip ratio and lateral slip matching; self-contact/road mesh collision/CCD; rigid wheel torque and full chassis momentum coupling; multi-wheel scheduling, LOD and batching; deterministic replay goals; extensive hardware GPU profiling.

More iterations/material stiffness are not a universal fix. The supported controls deliberately let you see residual errors and failure regimes. Start with a flat belt, sweep compression and solver budget, check `J` and force convergence, then introduce rolling/cleats. If elements invert or load changes materially with iteration count, treat that result as invalid for handling calibration. An effective reduced-order contact/tyre model calibrated against a high-resolution offline softbody may ultimately be a better AAA budget trade-off than simulating every tetrahedron on every wheel.
