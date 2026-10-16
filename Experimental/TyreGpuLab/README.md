# Frontier · WebGPU Tyre Dynamics Lab

A standalone **GPU physics experiment**, not a native engine feature or an AAA-ready tyre package. No suspension spring/damper model, no CPU physics implementation, no tyre vertex-shader deformation. The tyre render vertex shader reads the positions produced by compute directly.

## Assessment and native integration

See [the hardware-screenshot assessment and Frontier integration plan](../../Docs/VolumetricTyreAssessment.md) for the folding diagnosis, timing interpretation, code-audit findings, coupling requirements and proposed acceptance gates.

## Asset updates / cached preview recovery

The entry module, dependencies and shaders carry a shared release key. Shader fetches bypass HTTP caching and validate their release marker/compute entry points before pipeline creation. `server.py` sends `Cache-Control: no-store` and returns fresh bytes even for old Last-Modified validators. Use this server (or `npm run dev`) rather than a generic caching static server during iteration. After upgrading an already-open old preview once, reload it with **Ctrl+Shift+R** if necessary. A missing `clearLambda` error means mixed old JS/new WGSL, not unsupported GPU hardware; clearing is fused into `predict` now.

For an ABI-changing update, bump `ASSET_RELEASE`, all WGSL release markers (including shared `terrain.wgsl`) and the versioned module/CSS URLs together. `npm test` checks the manifest against shader entries and document/import URLs. `npm run test:assets` tests same-browser version-mismatch detection and reload recovery against the lab server.

## Current r4 scheduling / solver research

See [the r4 research and measurement report](../../Docs/TyreGpuSolverResearch.md) for the literature review, rejected packed-workgroup experiment, 14/24-colour schedule, GPU phase fusion and parallel guard reduction. No constraints or solver iterations were removed. Finite-iteration loads change with ordering and remain uncalibrated. The UI now distinguishes GPU milliseconds from rendered FPS explicitly.

## Hardening / optimization update

See [the optimization and safety report](../../Docs/TyreGpuHardening.md) for the current acceptance filter, measured before/after results, stress tests, and remaining port blockers. The earlier assessment describes baseline commit `807559c`.

## Run

```sh
cd Experimental/TyreGpuLab
python3 server.py --port 8080
# Open http://localhost:8080 locally, or the HTTPS preview URL.
```

Runtime has **zero npm/CDN dependencies**. Use a current browser with hardware WebGPU enabled. HTTPS or localhost is required. Unsupported devices stop with an explicit error; known software/fallback adapters are rejected. Browser/driver adapter reporting is ultimately the browser's responsibility; a web page cannot guarantee which physical device a driver chooses. The status tooltip identifies the reported adapter. Missing timestamp-query support disables the GPU timing number, **not** GPU physics.

Drag to orbit; scroll to zoom. Space pauses, R resets, W toggles edges, G toggles the undeformed envelope (shortcuts do not intercept form inputs). A model switch resets the tyre, retaining test settings. Requested compression and cleat height ramp from accepted GPU state. Rim rotation and conveyor phase integrate from the accepted pose; a safety-limited frame cannot accumulate a hidden CPU-clock pose offset. Actual speed/compression are shown separately from requests. Export downloads a diagnostic JSON sample.

## What is being compared?

**XPBD is a solver, not a material.** Both modes use graph-coloured XPBD, but different material constraints:

| Mode | Material constraints |
|---|---|
| Edge carcass | Rest-length constraints on the tetrahedral edge network plus per-tet volume constraints. No explicit spring forces. |
| Volumetric / flesh-inspired | Corotational tetrahedral strain plus per-tet volume. No distance constraints. `F = Ds inverse(Dm)`, strain `C = ||F − R||`, volume `C = J − 1`. Energy is `V0 [mu/2 ||F−R||² + K/2 (J−1)²]`. |

The latter is **inspired by volumetric flesh simulation**, not Epic's Chaos Flesh implementation, not Chaos Vehicles, and not an imported Unreal component. A persistent quaternion per tetrahedron approximately extracts the proper polar rotation with four bounded iterations (avoids inverting nearly singular deformed elements). Element-relative trust regions limit local nonlinear corrections; applied multiplier changes are limited by the same factor. The local material projections alone are not inversion-proof. A separate global GPU acceptance filter now limits proposed motion against the last accepted mesh; see the safety section below. Before global acceptance, an additional GPU unilateral minimum-volume barrier activates when a proposed element has `J < 0.30`. Two race-free colour sweeps push compressed elements toward `J = 0.35`; the unchanged global guard still certifies the final result. This is a numerical inversion-resistance constraint, not calibrated tyre elasticity or self-collision. The UI/export exposes `barrierActive`; do not interpret its extra stiffness as measured material response.

The 64 × 4 × 7 periodic annular mesh has **1,792 nodes, 6,912 positive-rest-volume tetrahedra, 9,856 unique edges**, a 0.48 m outer radius, and a 0.31 m section width. Inner nodes at radius 0.265 m are prescribed rim attachments. Effective nodal mass is 30 kg distributed across all nodes (including attachments). This is a **filled effective carcass**, not a detailed hollow pneumatic tyre. The tread pattern is surface colour only; it does not generate the silhouette, deformation, or contact.

The volumetric mode is selected by default. Default effective parameters: edge compliance `1/150000 m/N`, corotational strain modulus `300 kPa`, volumetric penalty `2 MPa`. One stiffness slider scales those together. These values are **not fitted to measured tyre data**, and the edge and solid models are not modulus-matched. Comparing their outputs demonstrates the pipeline, not which material is objectively more accurate.

## GPU execution / ownership

CPU work: mesh and graph construction once, UI/camera, prescribed rig inputs, command encoding, and small telemetry display. All dynamic node positions, velocities, element rotations, XPBD multipliers, contacts, and force reduction live in GPU buffers.

1. Fixed 60 Hz simulation tick, four 1/240 s base substeps. Optional adaptive budgeting uses eight substeps above 1.5 m/s and sixteen above 3 m/s. The tick remains 1/60 s; damping and reaction averaging scale with substep duration.
2. Predict GPU nodes under gravity; apply kinematic rim boundary conditions.
3. Reset substep XPBD multipliers. Solve `deltaLambda = (−C − alphaTilde lambda) / (sum(w |gradC|²) + alphaTilde)`.
4. Graph-coloured in-place Gauss–Seidel: 14 edge colours and 24 tet colours; nodes within a colour never overlap. Each dispatch boundary orders dependent colours. No float atomics, cross-workgroup barriers, or concurrent writes to a node.
5. Project along the shared height-field normal after material updates (up to three normal iterations); apply accumulated 3D tangent displacement projected onto a Coulomb disk.
6. Reduce candidate quality and a conservative global interpolation bound. GPU-written indirect arguments activate two local volume-barrier sweeps only for low-J proposals, then redo contact/acceptance. Accept mesh and rig together, then reconstruct velocity. Numerical damping is `0.996^(240 h)` per substep.
7. Accumulate contact reactions in a GPU node buffer over the tick. Run one final parallel/block reduction for tick-averaged reactions and final accepted element quality, not four repeated force reductions.
8. Draw boundary triangles directly from the solved node buffer.

Reused staging uploads only active aligned records: 39,936 bytes for the default four substeps (rather than the baseline 2,458,624 bytes). Typed dynamic offsets and redundant pipeline-bind elimination avoid per-dispatch array allocations. Aligned immutable uniform records per substep/colour avoid the common WebGPU mistake of overwriting one uniform buffer and having every queued dispatch see the last values.

The frame loop advances at most one fixed tick per animation frame and permits at most two submissions in flight, deliberately slowing simulation on a missed budget rather than changing dt or building an unbounded catch-up queue. A displayed **% real-time** exposes that slowdown and now excludes paused time while including backpressure waits. It also slows on displays rendering below 60 Hz. A shipping engine needs an independent scheduler and a GPU command/latency budget.

## Can it return tyre load? Yes—with important distinctions

The GPU sums the actual positional contact corrections. For a free node of mass `m` and substep duration `h`:

```
contact reaction vector estimate = m * accumulatedContactDeltaXYZ / h²
```

Equivalently, contact impulse is `m * deltaXYZ / h`. This lab averages active substep reactions for the reported tick. The ground receives the opposite reaction. Tangential corrections are reduced in the same units. Reduction output stays GPU-resident and **can be consumed by another GPU rigid-body pass without readback**.

For CPU consumers, the lab copies only 64 bytes of statistics/safety flags plus 16 bytes of optional timestamps into one asynchronous staging buffer, about every 130 ms. It never synchronously maps the live simulation buffer or waits in the frame loop. **Readback age includes GPU queue/map latency**, measured from capture submission. The UI intentionally samples slowly; a production readback ring could sample each tick, but still has nonzero latency.

**Belt reaction is not automatically hub load.** This is a displacement-controlled, kinematic rim rig. During transients, carcass inertia, gravity, and rim reactions matter. It does not sum bead-constraint reaction forces or couple a moving chassis. A CPU vehicle must not use these slowly sampled numbers as zero-latency suspension forces. A real integration would compute full bead impulses/torques and use same-GPU rigid-body coupling or explicitly handle delayed CPU feedback.

The finite 3 m × 0.63 m belt, rounded Gaussian cleat and surrounding lower floor share **one WGSL profile and analytic normal** between rendering and collision. The cleat and belt markings follow the accepted conveyor phase; this is a prescribed moving height-field, not a simulated flexible conveyor. Normal projection is iterative, not an exact signed-distance solve. Reaction XYZ includes the normal and tangent corrections; the headline `normal` remains **vertical support Fy**, not the scalar force along a slope. Friction is still an approximate positional Coulomb model.

## Debug / timing

- Shaded solved geometry; surface edge overlay; accepted-pose undeformed reference envelope. A unique orange sidewall witness is fixed in material/rest coordinates, not world space. Repeating tread can still exhibit wagon-wheel aliasing; follow the witness to see actual rubber motion. A unique pale stripe also witnesses the flat belt phase.
- Contact heatmap: accumulated normal position correction (impulse-proportional for equal node masses).
- Volume heatmap (computed only when selected): peak incident-element `|J−1|` encountered during the last substep before local volume projections. Conservative/transient, **not a stress-in-Pascals plot**.
- Numerical telemetry: final accepted last-substep minimum `J`, maximum `|J−1|`, averaged contact-node count, tangential force, sample age. `J <= 0` means inverted material. High local errors trigger a visible quality warning rather than being hidden.
- GPU solver milliseconds: optional hardware timestamp query around the complete compute pass, including contact and diagnostic reduction, excluding render/readback and CPU command encoding. It is a sampled tick, not a calibrated benchmark. The headline shows rolling p50 of up to 60 asynchronous samples, plus raw last/p95/sample count. Barrier activation and optional substep changes alter GPU work; browser scheduling/render work affect frame intervals separately. A timing change alone does not mean texture or physics motion stopped.
- CPU encode: rolling mean wall time of the submitted frame command construction/upload/submit, excluding synchronous GPU waits (there are none). It is not CPU tyre-solver time.
- Safety-step telemetry: minimum accepted fraction over the sampled tick; `N · LIMITED` flags reactions from a limited/penetrating/invalid numerical state.
- Frame interval: rolling average of requestAnimationFrame intervals, including browser scheduling. This is **not CPU solver time**. Derived rendered FPS is shown separately from simulation real-time rate. Plot auto-scales.
- The debug-only `window.tyreLab.snapshot()` reads all node data (`rigSnapshot()` reads accepted/trial/start rig records) on demand for tests; normal operation never does this.

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

### Baseline validation performed in this sandbox (before hardening)

- Baseline four Node topology tests passed: positive volumes/inverse rest matrices, closed manifold surface, periodic seam, and complete race-free graph colouring.
- WGSL and GPU command validation executed in headless Chromium 131 using **SwiftShader software WebGPU**, explicitly enabled for testing with `http://localhost:8080/?validateSoftware=1`. That opt-in is localhost-only, says **SOFTWARE VALIDATION ONLY**, and is rejected on the normal preview URL. It is not the deployed physics fallback.
- With 38 mm compression, stiffness 1, friction 0.8, four sweeps and four substeps: 100 static ticks per model and then 60 volumetric rolling ticks at 1 m/s with the 45 mm cleat. Node snapshots were finite, above the flat plane, and the sampled minimum J stayed positive. Reset restored the original positions and zero velocity. No WebGPU validation errors in those runs.
- Example observations: edge static ~2.35 kN, min J ~0.73; corotated static ~2.48 kN, min J ~0.67; corotated rolling/cleat sample ~3.97 kN, min J ~0.30. These are **uncalibrated solver outputs**, not tyre-reference measurements. Local volume errors were large (~34% static, ~70% in the cleat sample); the UI reports them. Force convergence is **not** established by merely remaining finite.
- Software compute samples were roughly 125–145 ms/tick in those runs. **These are not hardware-GPU frame times. No physical GPU is available in this sandbox, so AAA performance, GPU-vs-CPU speedup, target-console budgets, and hardware driver coverage remain unverified.** Use the live timing on your GPU and export comparable samples.

## GPU acceptance filter and remaining limits

Every substep saves the previous accepted mesh. Material/contact passes propose a candidate. For each tetrahedron, let `A` be the previous edge matrix and `B` its proposed change. The GPU bounds `||alpha A^-1 B||_F` below an element-dependent value less than one. This prevents an orientation flip along the accepted interpolation and gives a conservative `J >= 0.1` bound in exact arithmetic. A GPU block reduction chooses the minimum factor globally. Nonfinite/escaped candidates are rejected using a branch, not `mix(old, NaN, 0)`. The render rim follows accepted GPU attachments, not an unattained requested pose.

This is **not** a constitutive fix or a proof of accurate contact/energy behaviour. A small factor means the rig is unable to realize the requested motion at this budget. On a curved/rising height-field, interpolation can also leave a small gap violation; that is measured and marks reaction invalid above the numerical threshold. `validReaction` indicates only the implemented numerical checks (unlimited step, bounded/finite nodes, J margin, penetration below 1 mm), **not** calibrated hub-force eligibility. Even an unlimited sample remains an uncalibrated belt reaction.

Stress tests cover the reported 92 mm compression / stiffness 0.25 / cleat case at 3 and 5 m/s. Accepted snapshots remained finite with positive J, but some steps were heavily limited and their reactions explicitly marked invalid. Adaptive substeps cost more and do not make an already heavily distorted state physically valid. Global self-contact remains unimplemented.

## Before an AAA vehicle integration

This demo proves a compute pipeline and load-return mechanism, **not a production tyre**. Still needed: measured load–deflection calibration and convergence sweeps; anisotropic belts/cords; realistic bead/sidewall construction; pneumatic cavity pressure; robust inversion barriers and mesh-quality handling; thermal/wear effects if relevant; contact area/pressure validation; friction, slip ratio and lateral slip matching; self-contact/road mesh collision/CCD; rigid wheel torque and full chassis momentum coupling; multi-wheel scheduling, LOD and batching; deterministic replay goals; extensive hardware GPU profiling.

More iterations/material stiffness are not a universal fix. The supported controls deliberately let you see residual errors and failure regimes. Start with a flat belt, sweep compression and solver budget, check `J` and force convergence, then introduce rolling/cleats. If elements invert or load changes materially with iteration count, treat that result as invalid for handling calibration. An effective reduced-order contact/tyre model calibrated against a high-resolution offline softbody may ultimately be a better AAA budget trade-off than simulating every tetrahedron on every wheel.
