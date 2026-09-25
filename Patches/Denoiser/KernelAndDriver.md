# Denoiser patches — kernel and driver halves (V2, V3, V7)

The `V*.patch` files in this folder apply to `Engine/Shaders/AtrousDenoise.slang` of
`streamlinkinbox/Frontier @ arena/01a0c77d-frontier`. Three of the tested changes also (or only) touch the kernel
and the dispatcher; those exact edits are below. Evidence for every change:
`Scratchpad/DenoiserLab/Results/DenoiserLabReport.md`.

⚠️ The M9 denoise gate (`Exhibits/Workbench/Materials/CheckMaterialDenoise.sh` / `DenoiseReprojectionProof.cpp`)
pins both shaders as text. Any of these edits will trip it until the pinned lines are updated — that is the gate
doing its job, not a break.

---

## V2 — young-history variance floor (kernel only)

`Engine/Shaders/ReSTIRViewport.slang`, in the accumulator (directly below the
"variance OF THE MEAN" comment, currently ~line 1295):

```glsl
     float variance = sampleVariance / count;

+    // V2: a two- or three-sample history cannot certify a LOW variance — a lucky pair of equal samples reports
+    //    ~0 and freezes the filter on a freshly disoccluded pixel, which is exactly where smoothing is needed.
+    //    Floor the estimate in proportion to brightness, fading out by n = 4 (SVGF §4.2's motivation, done
+    //    without the spatial pass). Measured: +0.61 dB in a n=2 disocclusion block, all other pixels identical.
+    if (count < 4.0) variance = max(variance, luma * luma * (4.0 - count) * 0.125);
+
     // A single sample carries no information about its own spread. ...
     if (count < 2.0) variance = luma * luma;
```

## V3 — per-level luminance-sigma schedule (driver only)

`Engine/DeviceExchange/SwapchainExchange.cpp`, in the denoise level loop (~line 3283):

```cpp
-                Push.LuminanceScale = 4.0f;
+                // V3: tighten the luminance stop as the taps widen — levels 2-3 have 4/8 px-spaced taps and are
+                //    where detail smears. Measured: +0.42 dB overall, +0.87 dB converged, fresh glints 86.9→92.4%,
+                //    at the price of ~-0.3 dB in dark high-noise areas (they keep more residue). Tune by eye.
+                {
+                    static constexpr float kSigmaSchedule[5] = { 4.0f, 4.0f, 2.0f, 1.0f, 1.0f };
+                    Push.LuminanceScale = kSigmaSchedule[Level < 4u ? Level : 4u];
+                }
```

## V7 — albedo demodulation (kernel + driver + the V7 shader patch)

The filter smooths **irradiance**; albedo is multiplied back at the presentation write, so texture detail becomes
immune to the blur (+7.7 dB overall, +11.4 dB on textured surfaces in the lab). Three parts:

**1. Shader:** `V7_AlbedoDemodulation.patch` (binding 4 `AlbedoImage`, remodulation at the three OutputImage writes).

**2. Kernel** — `Engine/Shaders/ReSTIRViewport.slang`:
   - resolve the primary hit's diffuse albedo (the value is in hand in `ResolveSurface`) and write it to a new
     `AlbedoImage` (rgba8 is enough); write `vec4(1)` for sky/emissive/no-surface pixels;
   - store the mean DEMODULATED: `imageStore(DenoiseImage, px, vec4(mean / max(albedo, vec3(0.02)), variance));`
     (the moments/variance stay luminance-of-the-sample based — the lab accumulated them the same way);
   - the denoiser-off path must remodulate before its own tone map: `ToneMap(mean)` → the mean it stores is
     demodulated, so multiply back there too.

**3. Driver** — `Engine/DeviceExchange/SwapchainExchange.cpp`:
   - allocate the rgba8 albedo image next to the denoise ping-pong images (swapchain-sized, GENERAL layout);
   - add binding 4 to the denoise descriptor set layout and write it in `DenoiseSets[Level]` (only the final level
     samples it, but binding it everywhere keeps one layout).

Notes:
   - use the **diffuse albedo × (1-metalness) + F0 lerp** or simply base colour — anything stable per-pixel works,
     it only needs to match what was divided out;
   - `max(albedo, 0.02)` bounds the remodulation error on near-black paint;
   - fireflies/glints are unaffected (they live in the irradiance term).

---

## Measured summary (see the full report for the scoreboard and images)

| change | headline result | cost |
|---|---|---|
| V7 demodulation | +7.7 dB overall, +11.4 dB texture | ~0 (1 extra read at final level) |
| V2 variance floor | +0.61 dB in disocclusions, else identical | 0 |
| V6 depth gradient | +0.67 dB at real depth steps | +4 loads/px (~8 %) |
| V5 dither | sky banding 185→249 distinct levels | ~0 |
| V3 σl schedule | +0.42 dB overall, better glints; dark areas noisier | 0 |
| V4 log-luma stop | best glint retention; neutral PSNR here | ALU only; verify |
| V1 clamp gate | no measurable change (clamp never hit isolated glints) | 0 |

Recommended order: **V7 → V2 → V5 → V6**, then V3/V4 by eye on real content.
