#!/usr/bin/env bash
#============================================================================================================================================
# Builds and runs every denoiser variant, collecting Results/metrics.csv and Results/<Variant>.ppm/.png.
#   V0 baseline        — the shipped shader, shipped constants
#   V1 GlintSafeClamp  — shader change: variance-gated firefly clamp
#   V2 YoungVarFloor   — kernel change (harness flag HV_YOUNG): variance floor for n < 4 histories
#   V3 SigmaSchedule   — driver change (harness flag HV_SCHEDULE): per-level luminance sigma {4,4,2,1}
#   V4 LogLumaStop     — shader change: luminance edge-stop in log(1+L)
#   V5 OutputDither    — shader change: ±half-LSB hash dither at the 8-bit write
#   V6 DepthGradient   — shader change: SVGF-style depth-gradient tolerance
#   V7 AlbedoDemod     — shader+kernel change (flag HV_DEMOD): filter irradiance, remodulate at the write
#   V8 Combined        — all of the above at once
set -e
cd "$(dirname "$0")"

python3 make_variants.py
for V in V0_Baseline V1_GlintSafeClamp V4_LogLumaStop V5_OutputDither V6_DepthGradient V7_AlbedoDemodulation V8_Combined; do
    python3 stage.py Shaders/$V.slang staged/$V.part1.h staged/$V.part2.h
done

build() { # name shader flags...
    local NAME=$1 SHADER=$2; shift 2
    g++ -O2 -std=c++17 -I. \
        -DSTAGED1="\"staged/${SHADER}.part1.h\"" -DSTAGED2="\"staged/${SHADER}.part2.h\"" \
        "$@" Harness.cpp -o "/tmp/lab_${NAME}"
}

build V0_Baseline           V0_Baseline
build V1_GlintSafeClamp     V1_GlintSafeClamp
build V2_YoungVarianceFloor V0_Baseline           -DHV_YOUNG
build V3_SigmaSchedule      V0_Baseline           -DHV_SCHEDULE
build V4_LogLumaStop        V4_LogLumaStop
build V5_OutputDither       V5_OutputDither
build V6_DepthGradient      V6_DepthGradient
build V7_AlbedoDemodulation V7_AlbedoDemodulation -DHV_DEMOD
build V8_Combined           V8_Combined           -DHV_YOUNG -DHV_SCHEDULE -DHV_DEMOD

HEADER="variant,chain_ms,psnr_all,psnr_wall,psnr_floor,psnr_trim,psnr_converged,psnr_wedge,glint_conv_pct,glint_fresh_pct,firefly_ratio,sky_lowfreq_err,sky_distinct"
echo "$HEADER" > Results/metrics.csv
for V in V0_Baseline V1_GlintSafeClamp V2_YoungVarianceFloor V3_SigmaSchedule V4_LogLumaStop V5_OutputDither V6_DepthGradient V7_AlbedoDemodulation V8_Combined; do
    "/tmp/lab_${V}" "$V" Results | tee -a Results/metrics.csv
done

for P in Results/*.ppm; do
    python3 ppm2png.py "$P" "${P%.ppm}.png"
done
python3 composite.py
echo done
