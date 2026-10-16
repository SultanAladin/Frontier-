# Volumetric tyre solver: research and scheduling revision r4

16 October 2026. Baseline: `3a88cac` / release r3. This is a WebGPU prototype improvement, **not a native port or a calibrated pneumatic tyre**.

## What the screenshot means

The screenshot's **18.94 ms is GPU compute time**, not FPS. Compute alone would exhaust a 16.67 ms / 60 Hz budget. Its separate 40.4 ms mean frame interval corresponds to about **24.8 rendered FPS**; 51 ms is about 19.6 FPS. Browser/render/presentation and queue backpressure affect that interval too. r4 displays the derived FPS explicitly, alongside simulation real-time percentage, without relabelling GPU milliseconds as FPS.

The cleat fix added genuine collision/normal work and numerical volume repair, not just rendering. r3 encoded hundreds of tiny indirect commands, including zero-sized inactive repairs. On this small mesh there are only a few workgroups per colour, so dispatch/synchronization overhead is a plausible hardware bottleneck. It is **not proved to be the dominant cost on the user's GPU**: only software WebGPU is available here.

## Research findings and decisions

Sources were reviewed through indexed paper abstracts/excerpts; their published benchmarks were **not reproduced** here.

| Source | Relevant finding | Decision for this lab |
|---|---|---|
| *Small Steps in Physics Simulation* (2019) | More substeps with fewer iterations can outperform larger-step iterations for XPBD convergence. [1](https://mmacklin.com/smallsteps.pdf) | Investigate a **fixed total material-pass budget**, not the current adaptive policy's automatic 2×/4× material work. Do not silently reduce iterations: test force, motion and temporal convergence first. Not implemented in r4. |
| *A Constraint-based Formulation of Stable Neo-Hookean Materials* (2021) | Decomposes elasticity into hydrostatic and deviatoric constraints suitable for XPBD. [4](https://mmacklin.com/neohookean.pdf) | A credible alternative to per-element polar extraction. Add as a separately labelled material experiment, not a covert replacement: the energy/stress-free offset and calibration differ. Not implemented in r4. |
| *Parallel Block Neo-Hookean XPBD using Graph Clustering* | Coupled constraints and graph clustering target convergence and GPU parallelism. [5](http://profs.etsmtl.ca/sandrews/pdf/xpbdBlockNeo_MIG22_preprint.pdf) | Motivate locally blocked kernels and better scheduling, but do not equate one whole tyre/workgroup with the paper's clustered solver. The simple whole-tyre repair prototype was measured and rejected below. |
| *Vertex Block Descent* (2024) | Vertex-level block coordinate descent solves the implicit-Euler variational problem; the paper distinguishes its convergence from XPBD approximations. [2](https://arxiv.org/html/2403.06321v1) | Best next **separately selectable solver path within this lab** for a controlled comparison: per-vertex 3×3 solves, vertex colouring and energy/residual diagnostics. It is not a drop-in new kernel name or a guaranteed speedup. No VBD implementation claimed here. |
| *Augmented Vertex Block Descent* (2025) | Augmented-Lagrangian formulation addresses hard constraints and stiffness-ratio limitations. [7](https://dl.acm.org/doi/10.1145/3731195) | Relevant for bead/contact and near-incompressibility, but a larger solver/coupling change requiring independent validation. Not implemented. |
| *Modeling and Validation of a Passenger Car Tire Using Finite Element Analysis* (2024) | Uses solid rubber components plus cord/rebar reinforcement and validates inflated, loaded tyres. [7](https://doi.org/10.3390/vehicles6010016) | Our filled isotropic annulus lacks reinforcement and an air cavity. Faster generic flesh-like FEM alone cannot establish tyre realism. Hollow carcass/cord construction, pressure and measured load/contact validation remain necessary. |

### Rejected experiment

Packed the same two forward/reverse repair sweeps into one workgroup, with storage barriers between colours. This removed command boundaries but reduced parallelism. Both 256-thread and 64-thread software tests failed to show a useful tail-latency benefit: in the parked 64-thread trial, p50 increased **177.68 → 181.64 ms**, p95 **185.10 → 193.87 ms**. The experiment is **not shipped** and not presented as a hardware result. Raw trial data are retained in the report.

## Implemented r4 improvements

### 1. Topology-specific, optimal matching colour counts

The mesh is a periodic Kuhn tetrahedralization, not arbitrary imported topology. Exploit that structure during one-time CPU asset construction:

- Each of seven positive grid-edge directions forms paths/even angular cycles. Alternating edges gives **14 edge colours**, down from 15.
- The six tetrahedron orientations each need four translation classes. Use parity of the middle-axis coordinate and the sum of endpoint-axis coordinates, giving **24 tetrahedron colours**, down from 26.
- A default interior vertex has 14 incident edges and 24 incident tetrahedra. All incident constraints need different colours, so these counts reach the matching-colouring lower bounds for this topology.
- Even angular segment count is already enforced. Tests verify no shared-node writes within any colour, exact once-only constraint coverage, the periodic seam, four reduced meshes and both lower bounds.
- No tetrahedron, edge, node, material term, sweep or substep was removed. Reordering does change finite-iteration Gauss–Seidel residuals; it is **not bit-identical physics**.

This also removes quadratic saturation-degree graph construction from lab startup. It is asset preparation, not a CPU tyre solver.

### 2. Fuse independent GPU bookkeeping

- Merge trial-rig creation into prediction. Pinned nodes compute the proposed pose from the unchanged accepted rig; they **do not read the trial record another prediction invocation is concurrently writing**. Subsequent dispatches consume that record normally.
- Merge accepted-rig commit into finish invocation zero. Other finish invocations do not consume its rig/header writes; later dispatches do. This avoids introducing a cross-workgroup synchronization assumption.
- Parallelize the guard's 108-block minimum reduction across 64 lanes instead of one lane walking all blocks.
- Fuse the initial guard reduction and indirect-argument preparation. Keep the separate argument buffer/alternate binding, so writable-storage and indirect input are not used simultaneously on one buffer.
- Retain the original global J=0.1 certificate, nonfinite rejection, 0.30 repair trigger / 0.35 repair target and both local repair sweeps. Do not disguise limiting with cosmetic rotation or zero contact force.

### Command and upload budget

Four material sweeps/four substeps, default topology:

| Budget | r3 | r4 |
|---|---:|---:|
| Solid encoded dispatch commands/tick | 682 | 622 |
| Solid nonzero dispatches if repair inactive | 462 | 418 |
| Edge encoded commands/tick | 922 | 846 |
| Edge nonzero dispatches if repair inactive | 702 | 642 |
| Uniform records/substep | 42 | 39 |
| Active uniform upload/tick | 43,008 B | 39,936 B |

Zero-sized indirect commands still cost something. Counts are **not timing ratios**. GPU physics, accepted-state ownership and load readback remain intact.

## Measured results — software validation only

[Full samples, parameters, adapter identity and rejected trials](Benchmarks/TyreGpuScheduling-2026-10-16.json).

Chromium 131 / explicit localhost-only SwiftShader; sequential r3 baseline then r4; 80 warmup ticks and 32 asynchronous samples per variant. Same mesh, coefficients, four sweeps and four substeps. One run order, no confidence interval; p95 from 32 samples is descriptive, not a robust tail estimate.

| Case | GPU p50 r3 → r4 | GPU p95 r3 → r4 |
|---|---:|---:|
| Solid / flat / 38 mm | 125.41 → 119.14 ms (**−5.0%**) | 130.41 → 123.22 ms |
| Solid / parked 45 mm cleat / 38 mm | 178.12 → 122.51 ms (**−31.2%**) | 186.39 → 130.15 ms |
| Edge / soft 0.25 / 38 mm / requested 5 m/s cleat | 143.76 → 136.89 ms (**−4.8%**) | 196.85 → 145.11 ms (**−26.3%**) |

**Why these are not pure equal-work/equal-solution speedups:** changed colour ordering changes residuals and repair activation. Parked sampled minimum J rises from about 0.350 to 0.430, allowing less repair work. In the moving comparison r4 has no barrier-active samples versus five baseline samples, and the accepted speeds/trajectories differ. Treat this as the measured cost of each configuration, not isolated kernel throughput or higher physical accuracy.

**Important accuracy sensitivity:** steady flat Fy changes about **2.747 → 3.148 kN (+14.6%)**, and parked-cleat Fy about **4.141 → 4.680 kN (+13.0%)** despite unchanged material parameters. This exposes unresolved finite-iteration/contact-order dependence. The values are not calibrated tyre loads and cannot be called equivalent authoritative chassis forces. More convergence/calibration work is required; do not hide this difference behind the faster timing.

No prediction is made that the user's 18.94 ms becomes any particular number. Measure the refreshed r4 preview on that device with identical controls, especially achieved speed, limiting, barrier status and frame interval.

### Reproduce

Start `Experimental/TyreGpuLab/server.py`, then export a baseline asset directory (without switching branches):

```sh
mkdir -p /home/user/.cache/tyre-r3
for file in app.js mesh.js solver-plan.js runtime-assets.js physics.wgsl render.wgsl terrain.wgsl index.html style.css; do
  git show 3a88cac:Experimental/TyreGpuLab/$file > /home/user/.cache/tyre-r3/$file
done
BASELINE_DIR=/home/user/.cache/tyre-r3 \
BENCH_WARMUP=80 BENCH_SAMPLES=32 \
BENCH_PARAMETERS='{"model":0,"speed":5,"compression":38,"stiffness":0.25,"obstacle":0.045}' \
node Experimental/TyreGpuLab/benchmark.mjs
```

Use normal hardware WebGPU where available. The sandbox software exception requires the existing documented browser flags and localhost `?validateSoftware=1`; it is never a deployment fallback. `BENCH_OUTPUT` saves the JSON report.

## Validation and next gates

- 16 unit tests pass, including exact topology/colour coverage and upload packing.
- Full GPU regression passes: both materials, flat belt, parked/moving cleat, material-witness travel, return to flat, severe 92/95 mm cases, adaptive refinement, GPU readback, determinant assertions, overlays, reset/export and adapter rejection.
- The nominal 1 m/s cleat run still accepts approximately 1 m travel / 2.083 rad over 60 ticks. Extreme requested 5 m/s cases remain limited, not physically certified.
- Six isolated proposal guard tests and six shared-terrain GPU samples pass.
- Additional synthetic **actual GPU** reduction fixtures test minima in blocks 0, 64 and 107, plus inactive zero indirect arguments. This checks the second lane load/tail of the new parallel reduction rather than only a one-tet fixture.

Next: target-hardware stage timings and multi-wheel batching; a controlled small-steps convergence study; separately labelled stable Neo-Hookean and VBD/AVBD experiments; pressure/anisotropy and measured load/contact calibration. Do not simply raise iterations, lower the J guard, remove repair, or claim that better FPS establishes tyre accuracy.
