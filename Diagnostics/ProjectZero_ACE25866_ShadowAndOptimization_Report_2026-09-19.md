# Project-Zero Diagnostics Report — ace25866 shadows, moon reservoir, denoising, spatial reuse, and Unreal-style optimizations

Date: 2026-09-19  
Diagnostics inspected from: `SultanAladin/Frontier`, branch `master`, commit `ace25866`  
Uploaded folder inspected: `Exhibits/Diagnostics`

Files checked:

- `ProjectZero_TelemetryProbe.md`
- `ProjectZero_TelemetryProbe_Frames.csv`
- `ProjectZero_TelemetryReport.md`

Current Frontier- working branch context:

- `133e14d` added ReLAX/ReBLUR-style faster history response, compatibility-guided spatial reuse, and persistent Vulkan compute pipeline cache.
- `f5959a3` added the moon as an analytic direct-light candidate in the ReSTIR reservoir.

---

## 1. Executive conclusion

### Startup hitch

The Vulkan pipeline-cache target appears to be fixed in this diagnostic run.

The old reported regression was:

| Phase | Old problematic run |
|---|---:|
| `StartupComplete` | `110255.5 ms` |
| `VulkanBringUp` | `100089.9 ms` |
| `BringComputePipeline` | `96003.9 ms` |

The uploaded `ace25866` probe reports:

| Phase | Uploaded run |
|---|---:|
| `StartupComplete` | `6329.295 ms` |
| `VulkanBringUp` | `2544.268 ms` |
| `BringComputePipeline` | `47.718 ms` |
| `BringDenoisePipeline` | `12.430 ms` |
| `BringLuminanceReduction` | `3.577 ms` |

That means the specific 96-second compute-pipeline hitch is no longer present in this run. `BringComputePipeline` dropped from about `96.0 s` to `47.7 ms`, roughly a 2000x reduction for that stage.

Caveat: the wall-clock timestamps in `ProjectZero_TelemetryReport.md` show a large gap between early bootstrap lines and swapchain-ready lines, while `ProjectZero_TelemetryProbe.md`'s internal phase timer reports only ~6.3 s to startup complete. For phase analysis, I trust the probe's monotonic phase table more than the report's wall-clock timestamps, but we should add explicit pipeline-cache load/save bytes and cache-hit/miss logging to remove ambiguity.

### Shadows

The uploaded diagnostics prove the renderer is entering the intended shadow path, but they do **not** prove that shadow rays are hitting blockers or that a strong shadow-casting light source is contributing visible energy.

Most important findings:

1. The log says the GI-on path is ReSTIR ray-traced, so `GpuShadowMs = 0` is expected there because inline shadow rays are counted inside `GpuReSTIRMs`.
2. The scene has `3370 luminaires` but `0 punctual lights`.
3. The uploaded log shows the panel light set to **Low**, with very small blue emission: `rgb (0.000 0.008 0.042)` from 4 figures, 5% coverage.
4. The diagnostics do not print sun elevation, sun direct radiance, `sunUp`, `MoonControl`, moon elevation, moon direct irradiance, or ReSTIR selected-light source counters.
5. Therefore, from these files alone, the most likely explanation is: the renderer is tracing the ReSTIR shadow path, but the current visible scene/configuration still does not contain a strong, verified direct shadow source in the actual reservoir.

This does **not** mean your report of no visible shadows is wrong. It means the current diagnostics are missing the exact counters needed to distinguish:

- no direct source active,
- direct source active but too weak / too soft / washed out,
- source candidates generated but not selected,
- candidates selected but visibility always reports unblocked,
- visibility blocked but denoiser/exposure/history hides the contrast,
- shadow rays broken on the Windows SPIR-V path.

---

## 2. What the uploaded diagnostics say

### Scene and lighting setup

From `ProjectZero_TelemetryReport.md`:

```text
Showcase: 229506 triangles, 499 instances, 2045 clusters, 241 materials, 3368 luminaires,
bounds [-40.00 -40.00 0.00]..[40.00 40.00 6.00] m
```

```text
Materials: 241 descriptors -> 241 records, 241 slabs (limit 1, 0 folded),
499 placements, 0 cameras, 0 punctual lights
```

```text
Panel light Low: rgb (0.000 0.008 0.042) from 4 figures, 5% coverage,
3370 luminaires now.
```

Interpretation:

- The scene has many emissive mesh triangles.
- It has **zero punctual/spot/point lights**.
- The low panel-light setting is dim and blue.
- If you expect strong lamp shadows from regular point/spot fixtures, that path does not exist yet in the current scene representation. Emissive mesh triangles can cast shadows through the ReSTIR estimator, but they behave like area lights, not concentrated shadow-casting spotlights.

### Moon assets

From `ProjectZero_TelemetryReport.md`:

```text
Textures: 6 resident (0 placeholder), 64.0 MB with mips, decoded in 1029 ms
Moons: 6 textures resident, moon slots 0..5.
```

Interpretation:

- The six moon texture files were decoded/resident.
- This proves asset load residency, but it does **not** prove that the visible moon disc sampled the bindless texture correctly in the shader.
- A white/blank moon can still be caused by a slot/descriptor mismatch, a UV/sampler problem, over-bright phase/glow, or a shader fallback read returning white.
- The R13 moon direct-light reservoir candidate does **not** depend on albedo texture detail for shadowing. It uses the moon direction, angular radius, brightness, tint, phase/elevation, and `TraceShadow()`.

### Shadow-path log

The run repeatedly logs:

```text
Shadow path: ReSTIR ray-traced (GI on - shadow maps idle; inline shadow rays are counted inside GpuReSTIRMs, so GpuShadowMs=0 is expected).
Opaque rays use the bounded closest-hit path and spatial winners are revalidated at the current pixel.
```

Interpretation:

- `GpuShadowMs = 0` is not by itself a bug for GI-on/ReSTIR. The shadow rays are inside the ReSTIR compute kernel timer.
- The useful signal is not `GpuShadowMs`; the missing signal is per-light visibility: how many sun/moon/mesh candidates were traced, how many hit blockers, and how much visible direct radiance survived.

### Performance in the uploaded CSV

`ProjectZero_TelemetryProbe_Frames.csv` contains 146 frames, 144 with valid GPU timestamps.

Valid-frame means:

| Metric | Mean | Median | Min | Max |
|---|---:|---:|---:|---:|
| Frame delta | `83.00 ms` | `100.00 ms` | `5.09 ms` | `100.00 ms` |
| CPU `RecordAndPresent` | `109.35 ms` | `107.01 ms` | `2.75 ms` | `277.09 ms` |
| GPU kernel / ReSTIR | `101.01 ms` | `98.18 ms` | `85.58 ms` | `131.40 ms` |
| GPU raster | `7.28 ms` | `7.59 ms` | `2.90 ms` | `12.94 ms` |
| GPU post | `2.78 ms` | `2.85 ms` | `1.91 ms` | `3.97 ms` |

The run is heavily ReSTIR-kernel bound in the uploaded CSV. Raster is not the bottleneck in this capture.

---

## 3. Why there are still no visible shadows

### 3.1 Sun/atmosphere missing from the outliner is probably not the direct root cause

The Project-Zero celestial system is not just ordinary scene geometry. Sun, sky, atmosphere, and moons are packed into uniform records and editor/celestial roster rows. The sky record can feed the shader even if the item is not represented the way a normal mesh or actor appears in the outliner.

So: absence from the outliner is suspicious for UI/editor visibility, but it is not enough to prove that the GPU shader lacks a sun direction.

What matters to the ReSTIR kernel is:

- `SkySunDirection`
- `SkySunDirect`
- `sunUp`
- `SunPickProbability`
- `MoonControl`
- moon direction/elevation/brightness
- `LightTriangleCount`

The uploaded diagnostics do not print those values. We need them.

### 3.2 At night, pre-R13 moon visuals were not shadow-casting moonlight

Before R13, the moon could appear in the sky and could contribute small ambient fill, but it was not a real direct ReSTIR reservoir candidate.

That means a frame could show a visible moon disc but still have no directional moon shadow.

R13 changed that by making the moon a direct-light candidate with analytic sentinels `0xFFFFFFF0..0xFFFFFFF3`, using the same reservoir algebra as sun/mesh lights and the same `TraceShadow()` visibility test.

However, the uploaded diagnostics only show:

```text
Moons: 6 textures resident, moon slots 0..5.
```

They do not prove that the binary being run includes R13, nor do they print moon candidate counts. The next report should include a source/build hash and moon reservoir counters.

### 3.3 Emissive lights are not the same as punctual lights

The log explicitly says:

```text
0 punctual lights
```

Emissive mesh triangles can cast direct-light shadows through ReSTIR, but they are finite area sources. If they are small, dim, single-sided, or broadly distributed, their shadows can be soft, low contrast, or statistically hard to read. The uploaded scene's extra panel light is also very dim blue.

So the statement “even emissive lights do not give shadows” is consistent with several possibilities:

- the emissive mesh lights are too dim compared to sky/GI/exposure,
- they are too broad/area-like, so shadows are soft,
- they are single-sided and the receiver sees the back side of many triangles,
- the alias distribution spends candidates on thousands of weak luminaires,
- denoising/history suppresses the small contrast,
- or the Windows shader's visibility test is still failing.

The diagnostics do not separate these. We need per-source reservoir counters.

### 3.4 `GpuShadowMs = 0` does not mean “no ReSTIR shadows”

For GI-on ReSTIR, the log is correct: inline `TraceShadow()` calls are inside the ReSTIR compute pass and therefore counted under `GpuReSTIRMs` / `GpuKernelMs`, not under `GpuShadowMs`.

But for diagnosis, this is not enough. We need a shadow visibility telemetry channel, for example:

| Counter | Why it matters |
|---|---|
| sun candidates generated | proves the sun entered the reservoir |
| moon candidates generated | proves R13 moon entered the reservoir |
| mesh candidates generated | proves emissive triangles entered the reservoir |
| selected source type | proves what the reservoir actually chose |
| shadow rays fired | proves visibility was tested |
| shadow ray hit/miss count | proves blockers are found |
| visible direct contribution by source | proves the result is bright enough to see |

Without these, the log can only say “the path is active”, not “the visible shadow should appear”.

---

## 4. Moon as a real reservoir candidate

R13's design is correct for the problem you identified.

The earlier night screenshot had sun elevation around `-32.5°`. At that elevation, the sun cannot be the source of visible hard scene shadows. A visible moon or strong artificial light must be the source.

R13 adds the moon as an analytic distant direct light:

- stored as a reservoir candidate, not a side estimator,
- sampled as a disc/cone with solid angle,
- selected with RIS/ReSTIR weights,
- temporally and spatially reused,
- stored as a far point like the sun,
- traced with `TraceShadow()` so actual scene blockers can occlude it.

Important distinction:

- Moon **texture** controls how the moon disc looks in the sky.
- Moon **direct reservoir candidate** controls whether moonlight can cast shadows on surfaces.

The blank moon texture problem is real but separate. A blank moon disc does not necessarily prevent moonlight shadows if the uniform moon direction/brightness are valid.

Recommended next diagnostic for moon:

```text
MoonControl.x = N
Moon[0] slot = S, elevation = E, radius = R, brightness = B, phase = P
MoonDirectIrradiance = X
MoonReservoirGenerated = A
MoonReservoirSelected = B
MoonShadowRays = C
MoonShadowBlocked = D
MoonDirectRadianceMean = E
```

---

## 5. ReLAX / ReBLUR-style fast history and adaptive temporal response

NVIDIA NRD describes NRD as an API-agnostic spatio-temporal denoising library for low ray-per-pixel signals; its README lists ReBLUR as a recurrent-blur denoiser and ReLAX as an A-trous denoiser designed for RTXDI/direct-lighting-style signals [2](https://github.com/NVIDIA-RTX/NRD/blob/master/README.md). NVIDIA's glossary also describes ReBLUR as self-stabilizing recurrent blurring and ReLAX as an SVGF variant optimized for RTXDI, with better temporal stability and responsiveness to changing lighting [1](https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/1.2.4/docs/remix-glossary.html).

What this helps with in Frontier:

- fewer noisy direct-light speckles,
- less long-lived ghosting when lighting changes,
- faster response when a shadow appears/disappears,
- less smearing from stale history after camera/light changes,
- better convergence at 1 sample / few candidates per pixel.

What it does **not** do:

- It cannot create a missing direct light.
- It cannot make a broken `TraceShadow()` test cast shadows.
- It cannot make a dim/ambient-only scene show strong shadows.

Our R12 change is not a full NRD integration. It borrows the key idea: history must be adaptive. If luma/moments indicate a change or high variance, reduce the effective history count so new lighting/shadow information appears faster instead of being averaged away for too long.

---

## 6. Compatibility-guided spatial neighbours

The compatibility-guided neighbour-selection paper states that ReSTIR improves convergence by reusing samples across pixels and frames, and that its compatibility-guided spatial-neighbour method reduces SMAPE by 6–29% and temporal covariance by 22–49% at 2–5% incremental cost [2](https://research.nvidia.com/labs/rtr/publication/junkins2026compatibility/).

The practical problem:

- ReSTIR spatial reuse borrows a reservoir from a nearby pixel.
- If that neighbour is on the other side of an edge, blocker, surface normal change, or depth discontinuity, it may carry a light sample that is valid there but invalid here.
- Bad neighbours cause light leaks, shadow leaks, unstable flicker, and “everything looks lit” artifacts.

R12's compatibility-guided version does this:

- for each spatial tap band, sample four possible neighbours,
- score them by geometry compatibility,
- merge the best one instead of blindly merging the first random one,
- revalidate spatial winners at the current pixel before shading.

What it helps:

- less light bleeding across blockers,
- better edge/shadow stability,
- fewer neighbour-caused leaks,
- improved reuse quality without paying many extra shadow rays.

What it does not solve alone:

- if no strong direct source is active, there is no strong shadow to preserve,
- if the actual shadow trace is broken, choosing a better neighbour cannot fix it,
- if the direct light is a very broad/dim area source, shadows remain soft/low contrast.

---

## 7. Unreal-style optimizations: Nanite, Surface Cache, and “Vulkanite”

### Nanite-like virtual geometry

Epic describes Nanite as Unreal's virtualized geometry system. It uses an internal mesh format, renders pixel-scale detail/high object counts, works only on visible detail, uses compressed data, fine-grained streaming, and automatic LOD [1](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine). Epic also says meshes are broken into hierarchical clusters at import and clusters are swapped at render time based on the camera view while streaming only visible detail [1](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine).

Would this help Frontier?

Yes, eventually — but not as the first fix for the current shadow issue.

The uploaded CSV shows:

- mean GPU raster: `7.28 ms`,
- mean GPU ReSTIR/kernel: `101.01 ms`.

So the current bottleneck is not raw triangle rasterization. It is the ReSTIR/lighting kernel.

A Nanite-like system would help when Frontier grows to:

- millions/billions of triangles,
- lots of high-poly assets,
- excessive draw calls,
- large streaming worlds,
- heavy visibility/LOD pressure.

It will not directly fix:

- missing direct-light candidates,
- moon texture binding,
- no punctual/spot lights,
- shadow rays not hitting blockers,
- ReSTIR kernel cost.

### Surface Cache / Lumen-style cache

Epic describes Lumen's Surface Cache as an automatic parameterization of nearby scene surfaces used to quickly look up lighting at ray-hit points. It captures material properties from multiple angles into Cards generated offline for each mesh [2](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine). Epic also notes that after the Surface Cache is populated, Lumen calculates direct and indirect lighting for those surface positions and amortizes updates over multiple frames [2](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine).

This idea could help Frontier more directly than Nanite for GI cost:

- cache material/radiance for secondary hits,
- amortize bounce lighting,
- reduce full shader evaluation at every bounce,
- improve many-light indirect stability.

But it is a major architecture feature, not a quick patch. It requires card generation, atlas management, invalidation, update scheduling, debug visualization, and ray-hit lookup.

### “Vulkanite”

The public `bdwhst/Vulcanite` project describes itself as a Vulkan implementation inspired by Unreal Engine 5 Nanite, with GPU-driven frustum/occlusion culling, BVH cluster culling, a Nanite builder, visibility-buffer rendering, and mixed-mode rasterization [1](https://github.com/bdwhst/Vulcanite).

Recommendation:

- Do **not** clone/drop it into Frontier wholesale.
- Use it as a research reference.
- Rewrite/adapt the concepts into Frontier's architecture.

Reason:

Frontier already has its own scene records, CWBVH/TLAS path, visibility raster, Slang shader binding scheme, material model, telemetry gates, and ReSTIR reservoirs. A copied renderer module would fight those seams. A fitted rewrite should start with the pieces that match Frontier:

1. offline cluster hierarchy builder,
2. screen-error LOD selection,
3. HZB/occlusion-driven cluster culling,
4. visibility-buffer path compatible with existing material resolve,
5. virtual geometry page residency only after the above is stable.

---

## 8. Immediate recommended next work

### A. Add shadow-source telemetry before another visual guess

Add debug/editor-only counters, RAM-only during run, flushed at close:

```text
DirectCandidatesSunGenerated
DirectCandidatesMoonGenerated
DirectCandidatesMeshGenerated
DirectSelectedSun
DirectSelectedMoon
DirectSelectedMesh
ShadowRaysSun
ShadowRaysMoon
ShadowRaysMesh
ShadowBlockedSun
ShadowBlockedMoon
ShadowBlockedMesh
DirectRadianceSunMean
DirectRadianceMoonMean
DirectRadianceMeshMean
SkySunElevation
SkySunDirectLuma
Moon0Elevation
Moon0DirectIrradiance
LightTriangleCount
```

These counters will tell us why the image is shadowless in one run.

### B. Add a controlled shadow-proof render mode

Make a debug preset with:

1. one floor,
2. one vertical blocker,
3. one strong directional source,
4. sky ambient lowered,
5. denoiser optional/off,
6. source forced to sun, then moon, then one emissive quad.

This removes the many-light/sky/denoise ambiguity.

### C. Add moon texture proofing

Log and/or visualize:

```text
Moon slot index
Texture dimensions
Descriptor index
CPU texture min/max/mean
GPU sampled center/edge color
Moon albedo debug view
```

This addresses the blank moon separately from moonlight shadows.

### D. Add punctual/spot/IES light buffer roadmap

The log says `0 punctual lights`. If the scene needs obvious light-fixture shadows, the next lighting feature should be a polymorphic light buffer:

- point lights,
- spot lights,
- IES profile sampling,
- rectangular/line lights,
- emissive triangles,
- sun/moon analytic lights.

Then ReSTIR can sample all of them with source-type-specific PDFs instead of relying on dim emissive triangles for every local light.

---

## 9. Bottom line

- The 96-second Vulkan compute-pipeline startup hitch appears solved in the uploaded run.
- R13's moon reservoir design is the correct fix for night shadows when the sun is far below the horizon.
- The blank moon texture is a separate GPU texture/sampler/debugging problem; it does not by itself disprove moonlight shadowing.
- ReLAX/ReBLUR-style adaptive history helps shadows appear faster and reduces ghosting/noise, but it cannot create missing light or missing visibility.
- Compatibility-guided spatial neighbours reduce ReSTIR light leaks and shadow leaks across geometry edges, but they cannot compensate for absent/weak sources.
- The latest diagnostics still cannot explain “no shadows” conclusively because they do not include per-source candidate/visibility/contribution counters.
- The most actionable next step is instrumentation, not another blind shader tweak.
- Nanite/Vulkanite-style virtual geometry is useful future architecture, but the uploaded run is ReSTIR-kernel bound, not raster-geometry bound; it will not fix the current no-shadow report.
