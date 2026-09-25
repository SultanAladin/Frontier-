# DenoiserLab

A no-GPU test bench for `Engine/Shaders/AtrousDenoise.slang` improvements, built the same way the upstream repo's
own M9 denoise gate works: the **real shader text** is mechanically staged to C++ (`stage.py`, mirroring
`Exhibits/Workbench/Materials/StageAtrousDenoise.py`) and executed through `DenoiseCpuShim.h` / `SlangCpuShim.h`
(byte copies from `streamlinkinbox/Frontier @ arena/01a0c77d-frontier`). Nothing is re-implemented — every variant
runs the shader's own `main()`.

- `Shaders/V0_Baseline.slang` — byte copy of the shipped shader; `make_variants.py` derives every variant from it
  by exact-match substitution (fails loudly if the baseline drifts) and regenerates `Patches/Denoiser/*.patch`.
- `Harness.cpp` — synthetic 512² frame with every failure mode under test (textures, grazing slant, real depth
  step, glints, fireflies, disocclusion, sky gradient), kernel-exact accumulation (running mean + moments →
  variance of the mean), the 4-level chain with shipped constants, metrics, and PPM output.
- `run_lab.sh` — builds and runs all 9 variants, writes `Results/metrics.csv`, all PNGs and composites.
- `Results/DenoiserLabReport.md` — the scoreboard, per-change verdicts, and cost notes.

Variants:

| id | change | where it lives |
|---|---|---|
| V0 | shipped baseline | — |
| V1 | variance-gated firefly clamp | shader |
| V2 | young-history variance floor (n<4) | kernel accumulation (harness flag `HV_YOUNG`) |
| V3 | per-level σl schedule {4,4,2,1} | driver push constants (flag `HV_SCHEDULE`) |
| V4 | log(1+L)-space luminance edge stop | shader |
| V5 | ±half-LSB hash dither at the 8-bit write | shader |
| V6 | min-magnitude depth-gradient edge stop | shader |
| V7 | albedo demodulation / remodulation | shader + kernel (flag `HV_DEMOD`) |
| V8 | all of the above | everything |

Run: `bash run_lab.sh` (needs g++ and python3; ~1 min).
