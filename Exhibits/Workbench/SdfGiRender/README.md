# Mesh-SDF scene with distance-field diffuse GI: CPU render

**Status: CPU reference only. The GPU path has not run here.** The SPIR-V kernels and the Vulkan host are not executed in
this sandbox. This exhibit shows what the algorithm should produce, from the same TriangleField code the import chain uses.
It does not show that the device matches it.

## What it does
- Four meshes (floor slab, icosphere, rotated red block, green wall) are projected **once** each into a `TriangleField`
  (`Engine/GeometricRaster/TriangleField.h`, `Project`). Each instance is sampled through its inverse transform
  (`MakeAffine` / `SampleInstance`), as the device path does.
- Primary rays are sphere-traced on the min over instances. Direct sun uses a traced shadow ray.
- Indirect light is a cosine-weighted hemisphere gather from each hit. Each gather ray is sphere-traced with a bounded
  budget. A miss returns the sky. A hit returns the hit surface's direct sun term plus its sky fill: one bounce.
- `SdfGiRender.cpp` mirrors the **structure** of `DistanceFieldGIResolveBody.slang` and
  `DistanceFieldTransport.slang::GatherDistanceRadiance`. It is not a line-for-line port. The shader's cached-radiance
  lookup, material model, and reflections are not reproduced. Those are the gaps to close before any claim of an exact mirror.

## Results (from `out/run.log`, `out/selftest.txt`, `out/convergence.csv`, `out/gi_colour_bleed.txt`)

| Check | Value |
|---|---|
| Projection (4 instances, res 96/64) | 4.5 s, once per topology |
| Sphere field vs analytic, within 0.2 m of surface | max error 0.081 m (about two cells at res 64), sign wrong at 0 of 4000 samples |
| Primary hits on the sphere vs analytic sphere | 97 hits, worst 2.2 mm |
| Mean linear RGB: GI off / 32 samples (48-step) / 512 reference | 0.3070 / 0.4051 / 0.4034 |
| RMSE vs 512-sample reference, samples 1, 2, 4, 8, 16, 32, 64, 128, 256 | 0.0680, 0.0453, 0.0244, 0.0155, 0.0124, 0.0082, 0.0044, 0.0024, 0.0013 |
| 32 samples at the production 48-step trace, RMSE vs reference | 0.0123 |

Convergence is about N^-1/2, which is the Monte Carlo rate (`chart_gi_convergence.png`). The 32-sample prefix uses the
reference's 192-step trace, so the 0.0082 figure isolates the sample count. The 48-step production budget adds error
(0.0123) and brightens the mean slightly (0.4051 vs 0.4034).

**Colour bleed:** the test I wrote does not show red bleed from the block onto the floor. The metric was mean(R−G) beside
the block, and it goes from +0.008 (GI off) to −0.005 (GI on). The region is too coarse and too dominated by the green
wall's tint to isolate the block. The image does show green bounce from the wall into the shadowed floor and sphere. I am
not claiming red bleed.

## Files
- `SdfGiRender.cpp`: renderer and self-test. `build_sdf_gi_proofs.py`: PNGs, GIF, chart from the raw buffers.
- `out/gi_comparison.png`: GI off, GI on at 32 samples, GI reference at 512.
- `out/gi_32_samples_prod.png`, `out/gi_reference_512.png`, `out/gi_off.png`.
- `out/gi_error_32_vs_ref_x10.png`: absolute error ×10.
- `out/gi_convergence.gif`: gather at 1, 4, 32 samples, then the reference.
- `out/chart_gi_convergence.png`, `out/convergence.csv`, `out/selftest.txt`, `out/run.log`.
- The raw float buffers (`*.f32`, 691 KB each) are not committed. The binary regenerates them and the build script reads them.

## Not done
- No GPU run, no device readback, no tolerance set for GPU vs CPU.
- The shader's cached-radiance gather and the materials are not ported.
- The field's distance error near the surface is about two grid cells, which limits how thin features can be shaded.
