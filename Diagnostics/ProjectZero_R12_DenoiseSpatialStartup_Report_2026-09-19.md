# Project-Zero R12 Continuation — Denoiser, Spatial Reuse, Startup Cache

Branch: `arena/01a0b62f-frontier`

## Implemented

### 1. Denoiser / temporal history

Added a variance-guided fast-history response in `ResolveSurface()`:

- The running mean can still converge without a hard cap on stable still pixels.
- If the current sample's luminance diverges from history by more than the history's own sample variance explains, the effective history count is clamped before updating colour and moments.
- This raises temporal alpha only where the old history is stale, matching the A-SVGF / ReLAX / ReBLUR idea of faster response around lighting changes and motion without permanently blurring stable pixels.

Constants added:

- `kFastHistoryMinCount = 4`
- `kFastHistoryMaxCount = 64`
- `kFastHistorySoftStart = 1`
- `kFastHistoryFullReset = 4`

### 2. Spatial reuse

Added a compatibility-guided neighbour chooser for both direct ReSTIR and GI-reservoir spatial reuse:

- Each spatial tap now tests four jittered neighbour candidates inside the tap band.
- Candidates are scored using data already in the reservoir record: normal agreement, relative depth agreement, non-zero history weight, viewport-width stride guard, and a soft age penalty.
- Only the best compatible candidate enters the existing pairwise-MIS merge.
- This is the cheap in-kernel version of compatibility-guided neighbour selection: extra reservoir reads, but no extra shadow rays and no descriptor/push-constant growth.

### 3. Startup / pipeline creation

Added a persistent Vulkan `VkPipelineCache`:

- Loaded from `Diagnostics/Frontier_PipelineCache.vkcache` after logical-device creation.
- Passed into ReSTIR, luminance-reduction, and denoiser compute-pipeline creation.
- Saved back at clean shutdown after `vkDeviceWaitIdle()` and before device destruction.
- Cache files are ignored via `.gitignore`.

This is aimed at the Windows telemetry regression where `BringComputePipeline` spent about 96 seconds in driver pipeline creation. The first run still has to compile; subsequent runs should be able to reuse the cache if the driver accepts it.

## Not changed yet

- Full paired spatial reuse from ReSTIR PT Enhanced is not implemented yet. The current patch improves neighbour choice/quality first.
- Full NVIDIA NRD ReLAX/ReBLUR integration is not added; this patch ports the fast-history/adaptive-alpha behaviour into the existing à-trous path.
- Moon is still not promoted to a direct reservoir candidate.
- IES/punctual polymorphic light buffer is still pending.

## Validation in sandbox

- `Tools/Build/CheckShaderTableParity.sh` — GREEN.
- `Tools/Build/CheckShowcaseLevel.sh` — GREEN.
- `Tools/Build/CheckTelemetryProbe.sh` — GREEN.
- `Tools/Build/CheckPerformanceTelemetry.sh` — GREEN.
- `Tools/Build/CheckBuildSourceList.sh` — GREEN.
- `Tools/Build/CheckShaders.sh` — SKIPPED: no Vulkan SDK shader compiler in this sandbox.

## What to measure on Windows

Please run two launches after this patch:

1. First launch: creates `Diagnostics/Frontier_PipelineCache.vkcache`.
2. Second launch: should load the cache and should reduce `BringComputePipeline` if the driver cache was the 96-second culprit.

For runtime, compare Standard and Ultra/Reference separately because the shader now does more spatial reservoir reads and spatial-winner validation, while the denoiser history should react faster to changed lighting.
