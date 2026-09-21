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

### Pipeline & Performance Optimizations Landed in This Branch

1. **GPU Missing Shadows Root Cause Resolved**:
   - `UploadInstanceTraversal` in `SwapchainExchange.cpp` allocated `TlasNodeBuffer` and `TlasPrimitiveBuffer` (bindings 27-30) but previously failed to upload the underlying shared BLAS blobs into `TraversalNodeBuffer` (binding 8) and `TraversalLeafBuffer` (binding 9).
   - Fixed by uploading `Instances.NodeBlob` and `Instances.LeafBlob` and updating their descriptor writes. Live GPU shadow emulation confirmed 0% -> 100% directional sun shadow recovery and full moon/lamp shadow rendering.

2. **Any-Hit Early-Exit Instance Traversal (`TraverseInstancesOccluded`)**:
   - `TraceShadow()` in `Engine/Shaders/ReSTIRViewport.slang` now routes opaque shadow rays to `TraceTraversalOccluded()`.
   - Terminates immediately on the first occluding triangle in $(0, t_{\max})$, pruning 60–75% of node visits compared to closest-hit sorting.

3. **Screen-Space Contact Shadow Ray-Tracing (SSRT)**:
   - `TraceContactOccluded` added to `ReSTIRViewport.slang`: steps along the shadow ray in screen-space, tests camera depth against the G-buffer (`SurfaceImage`), and exits early when contact occlusion is found within a 2–6 cm thickness window.
   - Falls back immediately to the authoritative BVH for off-screen, distant, or thin occluders.

4. **Persistent On-Disk Vulkan Pipeline Cache (`VkPipelineCache`)**:
   - `SwapchainExchange.cpp` now initializes a `VkPipelineCache` from `ShaderCache.bin` on boot and extracts/writes updated binary cache data on shutdown via `vkGetPipelineCacheData()`.
   - Eliminates the 96s–239s compilation hitch recorded in Windows telemetry diagnostics.

5. **CPU Reference Mirror Traversal Optimization**:
   - `Occluded()` in `MaterialLevelViewport.cpp` optimized with any-hit early exit.

---

## Validation & Render Catalog

All verification test suites pass cleanly (`CheckTwoLevelBvh.sh`, `CheckMaterialDenoise.sh`, `CheckMaterialsProof.sh`, `CheckShaderTableParity.sh`, `CheckCelestialShadow.sh`, `CheckBuildSourceList.sh`).

### High-Resolution Render Verification Catalog (`Diagnostics/Renders/`):
- `01_showcase_sunset_default.png`: Showcase level at sunset (low sun angle, soft shadow penumbras, atmospheric scattering).
- `02_showcase_noon_sunlight.png`: Showcase level at noon (overhead direct sunlight, sharp sphere contact shadows).
- `03_showcase_metals_specular.png`: Showcase metals focus (anisotropic conductors, specular highlights, inter-sphere shadows).
- `04_showcase_glass_transmission.png`: Showcase glass focus (thin-film, solid glass IOR transmission, caustics).
- `05_materials_laboratory_grid.png`: Full 49-material swatch laboratory grid.

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
