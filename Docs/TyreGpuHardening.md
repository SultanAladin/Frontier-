# GPU tyre hardening and optimization — 16 October 2026

## Current release: r3 terrain and accepted motion

`tyre-gpu-20261016-r3` supersedes the earlier static-ground display/contact path. Rendering and collision now include the same `terrain.wgsl`: finite flat conveyor, rounded moving cleat, analytic slope normals and lower surrounding floor. Contact resolves normal and 3D tangent corrections; reported `normal` is vertical Fy, not slope-normal magnitude.

Rig angle, hub height, cleat height and belt phase now integrate **on the GPU from accepted state**, and commit with the same global fraction as the mesh. The undeformed ghost follows that accepted pose. The tyre's unique orange witness uses immutable material coordinates; a pale conveyor stripe follows accepted belt phase. Repeating treads can still alias at frame rate, but these unique witnesses disambiguate material motion.

Accepted-state integration alone did **not** resolve the compressed-cleat stall: a local element approached the unchanged J=0.1 guard floor. A GPU unilateral volume barrier now runs before final acceptance when candidate minimum J<0.30. Two coloured sweeps (forward/reverse) push low-J elements toward 0.35; contact and the global guard are recomputed. This actually changes solved node positions, not the shader silhouette. **It adds numerical stiffness and is not a calibrated constitutive response.** The global guard is retained unchanged, and severe settings can still be limited. `barrierActive` is exported and displayed.

Repair dispatch counts are GPU-generated, with no CPU physics decision/readback: zero workgroups when inactive. An alternate binding directs argument generation to a separate storage/indirect buffer, avoiding simultaneous writable-storage/indirect usage. For four sweeps/four substeps the solid path encodes **682 dispatch commands** (462 nonzero when repair is inactive); the edge path encodes 922 (702 nonzero inactive). Zero-sized indirect commands still have driver overhead. Upload remains 43,008 B. Do not apply the older 450-command count or ~30% software speedup to r3.

GPU telemetry now shows rolling p50/p95 plus raw last/sample count. Active barrier work and 4/8/16 substeps change compute cost; frame interval additionally includes rendering and browser scheduling. No new hardware performance claim is made.

### r3 verification (16 October 2026)

14 unit tests, asset-cache/reload browser tests, and the full WebGPU browser regression pass on Chromium 131 / explicit SwiftShader validation. Dynamic physics remains GPU-only; independent CPU determinants are assertions over GPU readback, not a fallback solver.

| Sequential case | Ticks | Snapshot minimum J | Actual motion / qualification |
|---|---:|---:|---|
| Edge / flat / 38 mm | 100 | 0.670 | Positive support, full acceptance |
| Solid / flat / 38 mm | 100 | 0.663 | Positive support, full acceptance |
| Parked 45 mm rounded cleat | +70 | 0.350 | Cleat reaches 45 mm; barrier active; support ≈4.13 kN, uncalibrated |
| Then requested 1 m/s | +60 | 0.679 | Accepted travel ≈1.000 m, angle ≈2.083 rad; no stalled pose |
| Then flat belt, 1 m/s | +60 | 0.654 | Cleat reaches zero; actual speed ≈1.000 m/s |
| Soft / 92 mm / 3 m/s cleat | +100 | 0.326 | Sampled actual ≈2.96 m/s; reaction flagged LIMITED |
| Then requested 5 m/s | +60 | 0.329 | Sampled actual ≈1.39 m/s; LIMITED, not a successful 5 m/s physical solve |
| Then adaptive 16 substeps | +8 | 0.395 | Sampled actual ≈4.97 m/s; still LIMITED/uncalibrated |
| Reset: soft / 95 mm / 5 m/s cleat | 120 | 0.349 | Compression reaches ≈95 mm; sampled actual ≈1.59 m/s; LIMITED |

Six isolated GPU terrain samples verify flat height, rounded peak, translated peak, analytic slope/normal, outside floor and phase periodicity. Six independent GPU guard fixtures pass identity/rotation/reflection/crush/shear/nonfinite checks. Regression checks visible material coordinates remain unchanged while solved material positions move. These finite runs do not establish sustained high-speed accuracy or self-collision safety.

The remaining sections describe the **historical r1/r2 optimization** and unchanged guard math; their benchmark and stress numbers are not r3 measurements.

## Scope and result

The WebGPU lab was hardened and optimized **before a native port**. The native engine has not been modified. Tyre state and safety decisions remain on the GPU, with no CPU tyre solver or shader-deformation substitute.

Baseline source is commit **`807559c`**. This update corrects the upload bug identified in [the assessment](VolumetricTyreAssessment.md), reduces scheduling/memory overhead and adds a conservative GPU acceptance filter. The volumetric material is now the initial selection.

**What is improved:** significantly less host work/upload traffic; fewer material dispatches; less redundant storage traffic; and positive-volume acceptance in the tested severe configurations.

**What is not established:** calibrated tyre loads, robust global self-collision, momentum-conserving chassis coupling, four-wheel hardware performance, or physical accuracy in safety-limited states.

## Changes

### Host and scheduling

- Fixed quadratic parameter allocation/upload: the baseline allocated/copied 2,458,624 bytes per tick. At the original 49 records, the actual need was 50,176 bytes. The new colour schedule uses 42 records, giving **43,008 active bytes** for four substeps—about **57× less traffic** than the baseline.
- Allocate staging once; reuse Float32/Uint32 views and immutable schedule fields. Maximum 16-substep staging capacity is 172,032 bytes, but only active records upload.
- Precompute typed dynamic-offset arrays. No short-lived array allocation at each colour binding.
- Do not rebind an unchanged compute pipeline on every colour.
- Construct independent compute pipelines concurrently during startup.
- Deterministic saturation-degree graph colouring changes the default topology from **16 → 15 edge colours** and **32 → 26 tetrahedron colours**. Tests verify every colour is a matching and every constraint occurs exactly once. This is one-time asset preparation, not CPU physics.
- Bound GPU submissions to two in flight, including render-only frames. Excess work is not silently queued for many frames. Throughput accounting includes backpressure waits and excludes pauses.

### Kernels

- Position projections write only position and actual contact accumulation, not an entire 80-byte node including immutable rest and unrelated velocity data.
- Skip attachment-position writes and edges with two fixed endpoints.
- Skip peak node heatmap accumulation unless volume visualization is selected. Final numerical quality reduction remains enabled regardless of view.
- Flat ground returns zero without repeated exponential evaluation. The cleat uses a square instead of a general `pow` call.
- Persistent-quaternion extraction exits early on convergence; its maximum iteration count is unchanged.
- Fuse independent multiplier clearing into prediction. In volumetric mode, clear only tetrahedral multipliers.
- Accumulate each node's time-weighted contact reaction over a tick on the GPU; reduce forces once at tick end instead of repeating the full reaction reduction after every substep.

For historical r1/r2, with four sweeps/four substeps, volumetric dispatch count was **450 versus 548** previously, despite adding the acceptance filter. The count is `4 * [1 prediction + 4*(26 material + 1 contact) + 2 guard + 1 finish] + 2 final reductions`. The edge path is 690 versus 804. These are command counts, not guaranteed timing ratios.

### Controls/diagnostics

- Belt control now reaches **5 m/s**.
- Optional adaptive budgeting: four base substeps, eight above 1.5 m/s, sixteen above 3 m/s. This is speed-based temporal refinement, not a claim that arbitrary load is supported.
- Preserve the 60 Hz simulation tick and scale numerical damping and contact-force averaging with substep duration.
- Expose CPU command-encode time, accepted-step fraction, numerical reaction validity, substep count and parameter upload size in UI/API/export.
- Full-frame GPU compute timing still includes diagnostic and acceptance work. Missing timestamp support remains explicitly N/A.
- Reject invalid/nonfinite programmatic settings before dispatch.
- The rigid rim visualization derives its pose from **accepted GPU attachment positions**, so a safety-limited tyre is not displayed with a misleading unachieved rim pose.

## Acceptance filter: what it guarantees, and what it does not

The material/contact sweeps produce a candidate rather than immediately trusting it. `Node.previous` holds the last accepted positions. Each tetrahedron constructs:

```
A = previous edge matrix
B = proposed edge-matrix change
E = inverse(A) * B
eta = min(0.5, 0.8 * max(0, 1 - cbrt(0.1 / J_previous)))
alpha <= eta / ||E||_F
```

If limiting is necessary, apply an additional 0.95 margin. A parallel minimum reduction picks a **global** alpha across all tetrahedra, then the finish pass accepts `previous + alpha*(candidate-previous)`.

Since `||alpha E||_2 <= ||alpha E||_F < 1`, `I + alpha E` remains nonsingular throughout the accepted path, preserving positive orientation. Its minimum singular-value bound gives `J_accepted >= J_previous*(1-eta)^3 >= 0.1` in exact arithmetic for a valid starting state. Tests use a 0.099 numerical tolerance. Checking against the whole previous mesh matters: a local correction that protects its own tetrahedron can still invert a neighbour.

Nonfinite or escaped proposals produce alpha zero. The rejection path copies previous positions with a branch; multiplying a NaN proposal by zero is not a safe rollback. The lab uses a bounded rig domain; those position bounds should become local-coordinate/asset-aware bounds in a native port.

**This is a conservative safety filter, not a new physical material or an inversion-repair algorithm.** A small alpha means requested motion was not realized. It can stall an entire tyre because of a single bad region. It can reject valid but very large shear/rotation steps. The candidate rotations are warm-start estimates, not separately certified physical state. Global self-intersection between distant surface regions is not checked.

A curved/rising height-field is not convex in general. Interpolating between contact-corrected states does not prove nonpenetration against that changing field. The final signed vertical gap is measured. Samples with limited motion, invalid nodes, insufficient J margin, or more than 1 mm penetration are flagged `validReaction: false`. Their displayed reaction is labelled **LIMITED**, with an explicit warning not to use it for chassis coupling. Even `validReaction: true` means only these numerical checks passed; the rig still does not provide calibrated dynamic hub forces.

Thus, **the reported folding configuration is numerically contained, not made physically accurate by clamping**. Do not remove this warning when porting.

## Measured before/after

Reproducible benchmark: `benchmark.mjs`, baseline `807559c`, headless Chromium 131 with explicit localhost-only **SwiftShader software validation**, same mesh, corotational material, 38 mm compression, stiffness 1, friction 0.8, zero belt speed, flat ground, four sweeps and four substeps. Warm up for 60 simulation ticks, then collect 60 asynchronous timing samples per version. Runs were sequential, baseline first. Raw samples/settings are in [TyreGpuSoftware-2026-10-16.json](Benchmarks/TyreGpuSoftware-2026-10-16.json).

| Measurement | Baseline | Optimized + safety filter |
|---|---:|---:|
| Compute timestamp p50 | 127.33 ms | 89.54 ms |
| Compute timestamp p95 | 142.44 ms | 93.16 ms |
| Compute timestamp p99 | 144.23 ms | 94.12 ms |
| CPU encode/upload/submit p50 | 1.40 ms | 0.30 ms |
| CPU encode/upload/submit p95 | 5.40 ms | 0.40 ms |
| Default active parameter upload | 2,458,624 B | 43,008 B |

In this software run, median compute time fell about **30%**, and sampled median host encode time fell about **79%**. This is **not a hardware GPU speedup claim**, not a prediction that the user's 4.85 ms becomes a particular number, and not a four-wheel benchmark. Software scheduling, one run order and sampled timing limit confidence; p99 of 60 samples is not a rigorous tail characterization. CPU timing is the observed submitted-frame encoding/upload/submit path, not CPU solver time or isolated driver time.

Colour ordering changes numerical convergence at a finite sweep budget: the optimized nominal static volumetric output is around 2.75 kN versus approximately 2.48 kN in the earlier reference run. That difference is **not** advertised as greater physical accuracy. Material/load convergence remains a port gate; neither version is calibrated.

### Run your hardware benchmark

Start the lab server, install test dependencies with `npm ci`, and use a WebGPU-capable browser. Set `CHROMIUM_EXECUTABLE_PATH` if needed, then:

```sh
cd Experimental/TyreGpuLab
npm run benchmark
```

For a paired baseline comparison, export the baseline source to a scratch directory without switching branches:

```sh
# From repository root; build/ is ignored.
mkdir -p build/tyre-baseline
git archive 807559c Experimental/TyreGpuLab | tar -x -C build/tyre-baseline
cd Experimental/TyreGpuLab
BASELINE_DIR="../../build/tyre-baseline/Experimental/TyreGpuLab" \
  BENCH_OUTPUT="../../build/tyre-hardware.json" npm run benchmark
```

`TYRE_LAB_URL` selects the running server. `BENCH_WARMUP`/`BENCH_SAMPLES` control capture length; the automated timeout is intended for lab-sized runs. Baseline assets are served through Playwright request interception, not a second physics server. The baseline CPU encode timing is instrumented in the served copy only. Normal operation rejects a known software adapter; the software test exception remains localhost-only and visibly labelled.

## Verification performed

### Historical unit tests: 10 passing (r3 has 14)

Positive rest volumes and inverse matrices; manifold/periodic mesh; complete race-free new colour schedules; reduced topology; invalid mesh dimensions; linear active-byte packing/reused staging; immutable nonaliasing substep records; bounded adaptive budgets; rejection of bad settings; and heatmap/model flag separation.

### Historical r1/r2 browser tests: actual WGSL and GPU buffers

The following sequential runs passed WebGPU validation, finite-node checks and independent CPU determinant assertions over read-back **accepted GPU** snapshots (the CPU calculation is a test assertion, never a solver fallback):

| Run | Ticks | Snapshot minimum J, representative final run | Safety interpretation |
|---|---:|---:|---|
| Edge, nominal static | 100 | 0.670 | No limiting in sampled tick |
| Corotated, nominal static | 100 | 0.663 | No limiting in sampled tick |
| Corotated, 1 m/s + cleat | 60 | 0.263 | No limiting in sampled tick; high volume error still reported |
| Then 92 mm / stiffness 0.25 / 3 m/s + cleat | 100 | 0.183 | Heavily limited; reaction invalid |
| Then same at 5 m/s | 60 | 0.165 | Heavily limited; reaction invalid |
| Then adaptive 16 substeps at 5 m/s | 8 | 0.211 | Still limited; more substeps do not rescue this distorted state |

The stress sequence deliberately retains the loaded state rather than resetting to an easy initial condition between every speed change. These are finite-duration checks, not a proof over every slider combination or a sustained high-speed vehicle run.

Isolated GPU acceptance tests additionally passed: identity, small rigid rotation, reflected proposal, nearly crushed proposal, large shear proposal and NaN proposal. Reflected/crushed/sheared proposals were limited while keeping positive determinant; the NaN proposal was rejected and the previous finite mesh preserved. Tests also cover overlays, reset, JSON export, adaptive metadata and software-adapter rejection.

## Before porting / remaining work

The native interface plan remains in [VolumetricTyreAssessment.md](VolumetricTyreAssessment.md). Carry the guard, flags and tests into the port, not only the material kernel. Cook colour schedules and inverse matrices offline. Preserve explicit Vulkan barriers between dependent colours and between compute and rendering/acceleration consumers.

Still required before authoritative vehicle dynamics:

- Material/carcass construction and reference load–deflection calibration.
- An admissible solve/contact strategy that realizes operating loads without persistent safety limiting; self-contact and road-mesh/CCD handling.
- GPU bead reaction **linear and angular impulses**, with full momentum/energy accounting and a defined delayed-Jolt coupling contract.
- Four-wheel dispatch batching and actual target-hardware p50/p95/p99/frame-budget measurements.
- Long rolling, braking, cornering and rough-road tests; convergence against tighter spatial/temporal solves.

The prototype is safer and cheaper to port now, but the safety limiter must not be mistaken for an AAA-ready tyre constitutive/contact solution.
