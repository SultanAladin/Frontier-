# Project-Zero Shadow + Telemetry Diagnosis — 2026-09-19

Source telemetry compared:

- Previous diagnostics commit: `825a274` from `SultanAladin/Frontier` `master`.
- Updated diagnostics commit: `a115696` from `SultanAladin/Frontier` `master`.
- Engine branch fixed here: `arena/01a0b62f-frontier`.

## Shadow diagnosis

### What the updated logs prove

- The updated run is using the Showcase scene with **229,506 triangles**, **499 instances**, **241 materials**, and **3,370 live luminaires** after the panel-light proxy.
- The log reports: `Shadow path: ReSTIR ray-traced (GI on - shadow maps idle)`.
- Therefore `GpuShadowMs = 0` in that run is **not** proof that shadows are disabled. In GI/ReSTIR mode, the shadow ray is inline inside the ReSTIR kernel and is timed as `GpuReSTIRMs` / `GpuKernelMs`; the separate `GpuShadowMs` stage is only the GI-off raster shadow-map path.
- The screenshot footer showed `QUALITY Low`, but that was the **spatial-interface fidelity tier**, not the renderer quality tier. The footer has been corrected to print the actual render tier (`Minimal`, `Economy`, `Standard`, `Ultra`, `Reference`).

### Likely live-GPU failure points fixed

1. **Opaque shadow rays used a different any-hit traversal from the CPU/closest-hit path.**
   - The CPU proofs/render used closest-hit style intersection.
   - The live GPU direct-shadow path used `Traverse*Occluded` for opaque geometry.
   - Fix: `TraceShadow()` now uses the same bounded closest-hit traversal for opaque and alpha-tested shadow rays. This removes a GPU-only divergence point and aligns live shadows with the CPU reference path.

2. **Spatial reuse trusted neighbour visibility at the current pixel.**
   - A spatial neighbour can see around a blocker that the current pixel cannot.
   - The previous visibility-reuse shortcut could leak light across shadow boundaries, which reads visually as washed/no shadows.
   - Fix: only reservoirs that actually win from a spatial neighbour get a late current-pixel visibility validation. Local/temporal winners keep the one exact current-pixel trace and do not pay the extra ray.

3. **Diagnostics wording was ambiguous.**
   - Fix: the `[Shadows]` log now explicitly says that GI-on shadows are inline in `GpuReSTIRMs`, so `GpuShadowMs=0` is expected.

## Performance: updated logs vs previous logs

### Scene load increased substantially

| Metric | Previous `825a274` | Updated `a115696` | Change |
|---|---:|---:|---:|
| Triangles | 92,842 | 229,506 | **2.47× heavier** |
| Instances | 117 | 499 | **4.26× heavier** |
| Materials | 50 | 241 | **4.82× heavier** |
| Luminaires after panel | 2,214 | 3,370 | **1.52× heavier** |
| Clusters | 790 | 2,045 | **2.59× heavier** |

### Runtime improved despite the bigger scene

Numbers below use valid GPU-timestamped frames after the first 60 frames.

| Runtime metric | Previous | Updated | Result |
|---|---:|---:|---:|
| Mean FPS | 17.24 | 35.97 | **+109%** |
| Median FPS | 16.14 | 39.08 | **+142%** |
| Mean frame delta | 60.78 ms | 31.67 ms | **−48%** |
| Mean GPU ReSTIR/kernel | 63.76 ms | 22.23 ms | **−65%** |
| Median GPU ReSTIR/kernel | 59.72 ms | 14.79 ms | **−75%** |
| CPU record+present mean | 68.92 ms | 28.35 ms | **−59%** |
| GPU post mean | 1.69 ms | 0.44 ms | **−74%** |

### Tier/budget slices from the updated report

| Budget seen in log | Mean FPS | Mean GPU total | Mean ReSTIR | Note |
|---|---:|---:|---:|---|
| `8 candidates + 3 extra + 3 spatial`, 5 denoise levels | 19.11 fps | 54.92 ms | 48.24 ms | Ultra/reference-class load on this GPU |
| `4 candidates + 2 extra + 2 spatial`, 4 denoise levels | 39.99 fps | 23.60 ms | 15.25 ms | Standard-class load; this matches the user's ~40 FPS observation |
| `2 candidates + 1 extra + 1 spatial`, 4 denoise levels | 18.68 fps | 51.72 ms | 44.86 ms | Small sample in log; likely captured while the view/scene was expensive, so not representative alone |

### Regression: startup time

Runtime improved, but startup regressed badly in the updated log:

| Startup metric | Previous | Updated | Result |
|---|---:|---:|---:|
| Startup complete | 7.51 s | 110.26 s | **regressed** |
| Vulkan bring-up | 2.81 s | 100.09 s | **regressed** |
| ReSTIR compute pipeline creation | 69.39 ms | 96,003.93 ms | **major culprit** |

The runtime path is much faster once the renderer is running, but the Windows driver is spending about **96 seconds** creating the ReSTIR compute pipeline in the updated run. That points to pipeline creation / shader compilation / driver cache behavior, not frame rendering. A follow-up should add a Vulkan pipeline cache and/or split/specialize the ReSTIR shader so the first pipeline build is not a 96-second hitch.

## Fixes landed in this branch

- `Engine/Shaders/ReSTIRViewport.slang`
  - Opaque `TraceShadow()` now uses bounded closest-hit traversal.
  - Degenerate shadow rays are guarded.
  - Spatial-reservoir winners are revalidated at the current pixel before shading.
- `Projects/Project-Zero/Source/GameExecution.cpp`
  - `[Shadows]` log line now explains inline ReSTIR shadow timing.
  - Editor footer `QUALITY` now shows actual render quality, not panel/interface fidelity.
- `Tools/Build/Gates/ShowcaseLevelGate.cpp`
  - Gate updated for the intentional 80 m r5 proof floor; it still rejects old kilometre-scale scenes.

## Validation run in the sandbox

- `Tools/Build/CheckShaderTableParity.sh` — GREEN.
- `Tools/Build/CheckShowcaseLevel.sh` — GREEN.
- `Tools/Build/CheckTelemetryProbe.sh` — GREEN.
- `Tools/Build/CheckPerformanceTelemetry.sh` — GREEN after restoring Vulkan headers to the sandbox cache.
- `Tools/Build/CheckBuildSourceList.sh` — GREEN.
- `Tools/Build/CheckShaders.sh` — SKIPPED because no Vulkan SDK shader compiler is installed in the sandbox.

## What to check on the next Windows run

1. The footer should show `Standard`, `Ultra`, etc., not `Low`, unless the actual render quality is Minimal/Low-equivalent.
2. The `[Shadows]` log should say that ReSTIR shadow rays are inline in `GpuReSTIRMs`.
3. In daylight (`Sun` above horizon), sun shadows should be visible.
4. At night (`Sun -32.5°` like the screenshot), sun shadows are physically absent; only emissive/spot/moon terms can cast shadows, and moon ambient is intentionally flat until moon is promoted to a reservoir candidate.
5. Please send the next `ProjectZero_TelemetryProbe.md`, frame CSV, report, and a screenshot after this patch so we can quantify the post-fix cost of closest-hit/spatial-winner validation on the GTX 1650 SUPER.
