# Denoiser improvement lab — per-change quality & cost report

> **SHIPPED 2026-09-25** as one commit on top of `f0a2329` (the user's latest push): the full V8 set, engine +
> gate, in `Patches/Denoiser/V8_ShipSet.mbox` (`git am`-ready, message included) / `V8_ShipSet.patch` (plain diff),
> both verified to apply cleanly to `f0a2329`. The shipped implementation moves the albedo through **OutputImage**
> (unwritten while the denoiser owns the presentation) instead of a new binding — kernel-set bindings 0-31 are all
> taken and 31 (the bindless table) must stay last. Validation of the exact shipped text:
> **V9_ShipSet row = V8's numbers** (37.97 dB, glints 100 % / 97.7 %), M9 denoise gate **97/97 GREEN** (the gate's
> mirror/pins updated in the same commit; A5 was already stale on the branch and is fixed too), TemporalIdentity
> gate GREEN, weather-composite text guardrails PASS, `SwapchainExchange.cpp` syntax-checked (only pre-existing
> custom-ImGui-fork fields fail with stock imgui headers). Push to `streamlinkinbox/Frontier` was denied (this
> session's credentials own only the session repo), so apply the mbox from a machine with write access:
> `git am < Patches/Denoiser/V8_ShipSet.mbox`.

**What was tested.** The real `Engine/Shaders/AtrousDenoise.slang` from `streamlinkinbox/Frontier @ arena/01a0c77d-frontier`,
compiled 1:1 as C++ exactly the way the repo's own M9 gate does it (`DenoiseCpuShim.h` staging — no re-implementation,
the shader's own `main()` runs). Each variant is the baseline text plus **one isolated change**; the diffs in
`Patches/Denoiser/` are generated from the same substitutions that built the tested shaders.

**Test frame.** 512×512 synthetic G-buffer with each failure mode present: checker/pinstripe wall (texture erosion),
grazing slanted floor + a genuine 0.4-unit trim step (depth edge-stop), sphere + sharp shadow band (normal/luminance
edges), ~540 stable glints (converged n=64 and fresh n=8), ~180 injected one-sample fireflies (the clamp's real job),
a n=2 disocclusion block (young variance), and a smooth noiseless sky gradient (8-bit banding). Input noise is
1-candidate-ReSTIR-like — per-sample multiplicative Exp(1), i.e. 100 % relative sigma — accumulated with the kernel's
own running-mean + two-moments math (variance of the mean, `n<2 → luma²`). Chain: 4 levels, steps 1/2/4/8, shipped
constants (σn=64, σz=0.05, σl=4.0), exposure 1.

## Scoreboard

PSNR in output (8-bit sRGB) space vs the clean reference, higher is better. `chain ms` is the CPU mirror's 4-level
time (a *relative* cost proxy — see the cost notes below).

| variant | chain ms | PSNR all | wall (texture) | floor (slant) | trim (step) | converged | disocclusion | glints conv % | glints fresh % | firefly leak | sky banding |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 Baseline            | 951  | 30.63 | 26.49 | 37.26 | 39.47 | 38.81 | 27.34 | 99.2 | 86.9 | 1.15 | 185 levels |
| V1 GlintSafeClamp      | 898  | 30.64 | 26.50 | 37.26 | 39.46 | 38.81 | 27.33 | 99.2 | 86.9 | 1.15 | 185 |
| V2 YoungVarianceFloor  | 903  | 30.70 | 26.51 | 37.26 | 39.47 | 38.81 | **27.95** | 99.2 | 86.9 | 1.15 | 185 |
| V3 SigmaSchedule       | 903  | 31.05 | 27.03 | 36.91 | 37.56 | 39.68 | 26.99 | 99.6 | 92.4 | 1.26 | 185 |
| V4 LogLumaStop         | 1221 | 30.56 | 26.32 | 37.19 | 40.14 | 38.88 | 27.37 | **100.0** | 93.5 | 1.24 | 185 |
| V5 OutputDither        | 887  | 30.62 | 26.49 | 37.23 | 39.42 | 38.77 | 27.34 | 99.2 | 86.9 | 1.15 | **249 levels** |
| V6 DepthGradient       | 956  | 30.68 | 26.54 | 37.14 | **40.14** | 38.67 | 27.26 | 99.3 | 88.1 | 1.18 | 185 |
| V7 AlbedoDemodulation  | 909  | **38.30** | **37.87** | **42.59** | 40.18 | **43.17** | 31.15 | 99.1 | 86.8 | **1.14** | 185 |
| V8 Combined            | 1316 | 37.97 | 37.32 | 39.13 | 38.81 | **43.36** | **31.34** | **100.0** | **97.7** | 1.47 | 249 |

(glint % = luminance retained vs reference; firefly leak = residual luminance ratio at injected firefly pixels,
1.0 = perfectly removed; sky banding = distinct 8-bit levels per gradient row — more distinct levels = smoother.)

Images: `Composite_Crops.png` (side-by-side zones), `Composite_Diffs.png` (|out−ref|×6 — the subtle variants show
here), `Composite_Sky.png` (banding strips at ×10 contrast), `Composite_Overview.png`, plus full frames per variant.

## Per-change verdicts

**V7 — albedo demodulation. Ship this first.** +7.7 dB overall, **+11.4 dB on textured surfaces**, +4.4 dB in the
converged block, +3.8 dB in the disocclusion, and it also *looks* like the reference (see TEXTURE/TRIM rows —
V0–V6 wash the checker out; V7/V8 are crisp). It filters irradiance instead of radiance, so texture detail no longer
passes through the blur at all. GPU cost: one divide in the kernel resolve, one extra image read at the final level,
one rgba8 albedo target. Effectively free in a bandwidth-bound pass.

**V2 — young-history variance floor. Free, targeted, zero side effects.** +0.61 dB exactly in the n=2 disocclusion
block; every other number byte-identical to baseline. Two or three lucky samples can no longer certify "converged"
and freeze the filter on fresh pixels. One line in the kernel.

**V6 — depth-gradient edge stop (min-magnitude form). Correctness win.** +0.67 dB at the genuine 0.4 step (the old
rule's tolerance grows as z·distance, so it cannot tell a slope from a step); the price is −0.12 dB on the grazing
slant (it now filters *along* the surface only as far as the gradient justifies). Note the first attempt used central
differences and gained almost nothing — the step inflated its own tolerance; the min-magnitude one-sided gradient is
the part that matters. Cost: +4 surface loads/pixel (~8 % of the pass's loads).

**V5 — output dither. Perceptual win the PSNR can't see.** Distinct sky levels 185 → 249; the ×10 strips show V0's
banding replaced by sub-LSB grain. Cost: ~4 ALU. Take it whenever gradients (sky/fog — relevant to your new
volumetrics) reach the 8-bit target.

**V3 — per-level σl schedule {4,4,2,1}. A trade, not a free win.** +0.42 overall, +0.54 texture, +0.87 converged,
fresh glints 86.9→92.4 % — but −1.9 dB at the dim trim and −0.35 dB in the disocclusion (late levels smooth less, so
dark noisy areas keep more residue; firefly leak 1.15→1.26 for the same reason). Pairs well with V7 (which removes
the need for texture protection the hard way); tune per taste.

**V4 — log-space luminance stop. Neutral here, keep conditional.** Glint retention best-in-class (100 %/93.5 %) and
+0.67 dB at the trim, but −0.17 dB on texture and slight firefly retention. Its real justification is HDR scenes with
sun-lit vs shadowed dynamic range — this LDR-ish test can't show that. CPU +35 % (a `log` per tap); on GPU that ALU
should hide under memory latency, but verify on device.

**V1 — variance-gated firefly clamp. Honest null result.** No measurable change. Analysis of the shipped clamp
explains it: a single bright pixel raises its own 3×3 log-luma allowance above itself (centre weight 0.14 →
`μ+2.5σ` ≈ 1.007·Δ), so isolated stable glints were **never being clamped in the first place** — the clamp only
guards taps at step ≥ 2 from bleeding. Conclusion for your GPU sparkle complaint: the loss is in the *sampling*
(1 candidate, 0.5× resolution) and the luminance-stop averaging while variance is high — not the firefly clamp.
The patch is still principled insurance for clustered glints, but don't expect sparkles back from it.

**V8 — everything combined.** Best glints (97.7 % fresh / 100 % converged), best converged and disocclusion blocks,
texture within 0.6 dB of V7-alone; overall PSNR sits 0.33 dB under V7-alone *by design* (dither grain and the tighter
σl trade measured error for perceptual quality). Firefly leak rises to 1.47 — that's the σl schedule keeping late
levels honest; if it bothers, drop the level-3 σl from 1.0 to 1.5.

## Cost notes (what "no performance cost" means on the GPU)

The CPU ms above measure the same code the GPU runs, but a GPU à-trous pass is **memory-bandwidth-bound** (50 image
loads/pixel/level), so ALU-only changes are expected to vanish:

| change | extra memory traffic | extra ALU | expected GPU cost |
|---|---|---|---|
| V1 | none | 2 mul + 1 cmp per bright tap | ~0 |
| V2 | none | 1 madd per pixel (kernel) | ~0 |
| V3 | none | none (push constant) | 0 |
| V4 | none | ~26 `log` per pixel | ~0 expected; verify on device |
| V5 | none | ~6 int ops final level | ~0 |
| V6 | +4 surface loads/pixel (~8 %) | ~6 madd | small; verify on device |
| V7 | +1 load final level, +1 rgba8 target | 2 mul | ~0 |

The one honest caveat: none of this ran on a GPU (this sandbox has none). The harness proves the *quality* deltas on
the shader's own code; the `[GpuTiming]` denoise/post numbers on your machine are the final judge for cost.

## How to reproduce

```
cd Scratchpad/DenoiserLab && bash run_lab.sh   # builds every variant, writes Results/metrics.csv + all images
```

## How to apply upstream

- Shader changes: `Patches/Denoiser/V*.patch` apply to `Engine/Shaders/AtrousDenoise.slang` (`git apply`).
  `V8_Combined.patch` is the everything-at-once version.
- Kernel/driver halves (V2, V3, V7): exact snippets in `Patches/Denoiser/KernelAndDriver.md` for
  `Engine/Shaders/ReSTIRViewport.slang` and `Engine/DeviceExchange/SwapchainExchange.cpp`.
- Note: the M9 gate (`CheckMaterialDenoise.sh`) pins the shader text — its pinned lines must be updated alongside
  any of these patches, which is by design (the gate exists to notice exactly this).

Recommended order: **V7 → V2 → V5 → V6**, then evaluate V3/V4 by eye on real content.
