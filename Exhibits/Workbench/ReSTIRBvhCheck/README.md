# ReSTIR-style direct light and the BVH CPU path: CPU checks

**Status: CPU checks of the estimator and the BVH. The ReSTIR GPU kernel has not run here.**

`ViewportIntegrator.slang` describes its own state as "NOT ReSTIR as published": one-bounce RIS direct lighting with
temporal reuse and no spatial reuse. These checks test what that estimator computes, not the published algorithm.

## What is checked
- **Part A, BVH closest hit** (`Engine/GeometricRaster/TraversalIndex.cpp`, `TraceClosest`, tinybvh binary tree) against a
  brute-force Möller–Trumbore over the same triangles. 20,000 random rays plus 2,000 axis-aligned rays. The axis-aligned
  rays carry an exactly zero direction component, which the source flags as a NaN hazard for slab tests, so they are a
  deliberate case.
- **Part B, RIS direct light** (candidate weights, reservoir selection, W = WeightSum/(M·p̂(z)), contribution = W·p̂·V, as in
  `ResampleCandidate` and the weighting rules of `ViewportIntegrator.slang`) against a brute-force sum over all lights.
  Visibility comes from the BVH. Target p̂ is the unshadowed Lambert term, as in the shader.

## Results (from `out/restir_bvh_check.txt`, `out/ris_bias_vs_m.csv`)

| Check | Result |
|---|---|
| Scene | 482 triangles (floor + 40 boxes), BVH built, 48 nodes |
| Closest hit, BVH vs brute, 22,000 rays | 0 hit/miss mismatches, 0 primitive mismatches, 0 distance mismatches above 1e-3 m; 7,852 both-hit, 14,148 both-miss |
| Visibility, BVH vs brute, 12,800 receiver-light pairs | 0 mismatches |
| RIS mean relative bias vs brute, M = 1, 2, 4, 8, 16, 32, 64 | +0.29 %, −0.33 %, −0.03 %, −0.11 %, +0.13 %, −0.07 %, +0.13 % |
| RIS per-receiver relative spread, M = 1 → 64 | 3.4 % → 3.0 % with visibility; 1.9 % → 0.20 % without (see below) |

**Interpretation:** the BVH agrees with brute force exactly on this scene, including the axis-aligned rays, so the
NaN-slab hazard did not appear in this test. The RIS estimator's mean is unbiased to within about 0.3 %.

**Why the spread stays flat.** The spread did not fall with M, which the usual RIS variance argument predicts. The
variant `RestirBvhCheckNoVisibility.cpp` (visibility removed from both estimate and reference, otherwise identical) tests
the cause. Its spread falls roughly as 1/M:

| M | 1 | 2 | 4 | 8 | 16 | 32 | 64 |
|---|---|---|---|---|---|---|---|
| spread, visibility ON | 3.4 % | 2.6 % | 3.1 % | 2.1 % | 1.8 % | 3.1 % | 3.0 % |
| spread, visibility OFF (`out/ris_bias_vs_m_novis.csv`) | 1.9 % | 1.2 % | 0.82 % | 0.57 % | 0.44 % | 0.29 % | 0.20 % |

So the binary visibility of the one selected light is the dominant noise source. Its variance does not shrink with M
because only the selected sample is shadow-tested. The estimator is still unbiased with visibility on.

## Files
- `RestirBvhCheck.cpp`: the checks. `RestirBvhCheckNoVisibility.cpp`: the variant used for the noise test. `build_restir_charts.py`: `out/chart_ris_bias_vs_m.png`.
- `out/restir_bvh_check.txt`, `out/ris_bias_vs_m.csv`.

## Not done
- No GPU run of `ReSTIRViewport.slang` or `RayQueryViewport.slang`. The hardware ray-query path is not tested.
- No temporal or spatial reuse in these checks. Only the initial candidates and the weight algebra are covered.
- Build needs the Vulkan headers and tinybvh (external packages), which are not in the repository's ExternalPackages.
