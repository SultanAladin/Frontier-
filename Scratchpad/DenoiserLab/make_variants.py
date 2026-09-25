#!/usr/bin/env python3
#============================================================================================================================================
#                                                      MAKE_VARIANTS.PY
#============================================================================================================================================
# Generates the denoiser experiment variants from the REAL shader text (Shaders/V0_Baseline.slang, a byte copy of
# Engine/Shaders/AtrousDenoise.slang from streamlinkinbox/Frontier @ arena/01a0c77d-frontier). Each variant is the
# baseline plus ONE isolated change, applied as exact string substitution — if the baseline text drifts, this script
# fails loudly instead of silently testing the wrong thing. Also writes unified diffs into Patches/Denoiser/.
import difflib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATCHES = os.path.normpath(os.path.join(HERE, "..", "..", "Patches", "Denoiser"))
BASE = open(os.path.join(HERE, "Shaders", "V0_Baseline.slang"), encoding="utf-8").read()


def apply(text, old, new, count=1, label=""):
    found = text.count(old)
    if found != count:
        sys.stderr.write("substitution '%s' matched %d times, expected %d\n" % (label, found, count))
        sys.exit(2)
    return text.replace(old, new, count)


# ------------------------------------------------------------------------------------------------------------------------
# V1 — variance-gated firefly clamp: a tap whose temporal variance certifies its mean to ~15% is signal, not a firefly.
# ------------------------------------------------------------------------------------------------------------------------
def v1(text):
    old = """            if (TapLum > MaxAllowedLum && TapLum > 1.0e-4)
            {
                TapColour.rgb *= (MaxAllowedLum / TapLum);
            }"""
    new = """            // V1: clamp only STATISTICALLY UNCERTAIN brightness. A tap whose variance-of-the-mean says its value
            //    is known to better than ~15% relative is a converged bright feature (a glint) — fireflies are always
            //    high-variance because they are one huge sample amortised over a short history.
            if (TapLum > MaxAllowedLum && TapLum > 1.0e-4 && TapColour.a > 0.0225 * TapLum * TapLum)
            {
                TapColour.rgb *= (MaxAllowedLum / TapLum);
            }"""
    return apply(text, old, new, 1, "V1 clamp gate")


# ------------------------------------------------------------------------------------------------------------------------
# V4 — luminance edge-stop in log(1+L) space: one sigma means the same visual step in shadow and highlight.
# ------------------------------------------------------------------------------------------------------------------------
def v4(text):
    old = "    float CentreLuminance = Luminance(Centre.rgb);\n"
    new = ("    float CentreLuminance = Luminance(Centre.rgb);\n"
           "    float CentreLogLum    = log(1.0 + CentreLuminance);   // V4: the edge-stop compares in log(1+L)\n")
    text = apply(text, old, new, 1, "V4 centre log-lum")
    old = "    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;"
    new = ("    // V4: the variance estimate is linear-luma-squared; d log(1+L) / dL = 1 / (1+L) converts its sigma so\n"
           "    //    the SAME LuminanceScale keeps its meaning. Linear space made bright regions never filter (their\n"
           "    //    absolute deltas dwarf sigma) and shadows over-filter; log space treats both alike.\n"
           "    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) / (1.0 + CentreLuminance) + 1.0e-4;")
    text = apply(text, old, new, 1, "V4 denominator")
    old = "            float LuminanceDelta  = abs(CentreLuminance - Luminance(TapColour.rgb));"
    new = ("            float TapLogLum       = log(1.0 + Luminance(TapColour.rgb));   // V4\n"
           "            float LuminanceDelta  = abs(CentreLogLum - TapLogLum);          // V4")
    return apply(text, old, new, 1, "V4 tap delta")


# ------------------------------------------------------------------------------------------------------------------------
# V5 — +-half-LSB hash dither before every 8-bit presentation write (three sites: pass-through, early-out, final).
# ------------------------------------------------------------------------------------------------------------------------
def v5(text):
    old = """vec3 ToneMap(vec3 Hdr)
{"""
    new = """// V5: +-half-LSB hash dither for the rgba8 presentation write. Smooth sky and fog gradients otherwise quantise
//    into visible bands; +-0.5/255 of position-hashed noise trades them for imperceptible grain. Position-hashed,
//    not frame-hashed, so a still frame stays still.
float DitherOffset(ivec2 Pixel)
{
    uint H = uint(Pixel.x) * 1664525u + uint(Pixel.y) * 1013904223u;
    H = (H ^ (H >> 16u)) * 2246822519u;
    H = H ^ (H >> 13u);
    return (float(H & 1023u) / 1023.0 - 0.5) / 255.0;
}

vec3 ToneMap(vec3 Hdr)
{"""
    text = apply(text, old, new, 1, "V5 helper")
    old = "        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb), 1.0));"
    new = ("        if (FinalLevel != 0u) { float D = DitherOffset(Pixel); "
           "imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb) + vec3(D, D, D), 1.0)); }   // V5")
    text = apply(text, old, new, 2, "V5 pass-through writes")
    old = "    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb), 1.0));"
    new = ("    if (FinalLevel != 0u) { float D = DitherOffset(Pixel); "
           "imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb) + vec3(D, D, D), 1.0)); }   // V5")
    return apply(text, old, new, 1, "V5 final write")


# ------------------------------------------------------------------------------------------------------------------------
# V6 — SVGF-style depth-gradient edge stop: tolerance is the depth change PREDICTED along the tap offset, so a slanted
#      floor filters along itself while a small genuine step (trim, panel gap) stops the kernel dead.
# ------------------------------------------------------------------------------------------------------------------------
def v6(text):
    old = "    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;"
    new = """    // V6: the screen-space depth gradient, from the immediate neighbours (4 extra surface loads per pixel against
    //    the main loop's 50 — ~8% bandwidth). |grad z . offset| predicts how much depth SHOULD change along a tap
    //    offset on this same surface; only the residual beyond that is an edge. The two one-sided differences are
    //    combined by MIN MAGNITUDE, not averaged: at a genuine depth edge one side crosses the step and reads huge,
    //    and averaging it in would inflate the tolerance exactly where it must stay tight.
    float DepthGradX = 0.0;
    float DepthGradY = 0.0;
    {
        int Xp = min(Pixel.x + 1, int(Extent.x) - 1), Xm = max(Pixel.x - 1, 0);
        int Yp = min(Pixel.y + 1, int(Extent.y) - 1), Ym = max(Pixel.y - 1, 0);
        float Zxp = imageLoad(SurfaceImage, ivec2(Xp, Pixel.y)).w, Zxm = imageLoad(SurfaceImage, ivec2(Xm, Pixel.y)).w;
        float Zyp = imageLoad(SurfaceImage, ivec2(Pixel.x, Yp)).w, Zym = imageLoad(SurfaceImage, ivec2(Pixel.x, Ym)).w;
        float GxF = (Zxp > 0.0 && Xp > Pixel.x) ? (Zxp - CentreDepth) : 0.0;
        float GxB = (Zxm > 0.0 && Pixel.x > Xm) ? (CentreDepth - Zxm) : 0.0;
        float GyF = (Zyp > 0.0 && Yp > Pixel.y) ? (Zyp - CentreDepth) : 0.0;
        float GyB = (Zym > 0.0 && Pixel.y > Ym) ? (CentreDepth - Zym) : 0.0;
        DepthGradX = abs(GxF) < abs(GxB) ? GxF : GxB;
        DepthGradY = abs(GyF) < abs(GyB) ? GyF : GyB;
    }

    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;"""
    text = apply(text, old, new, 1, "V6 gradient")
    old = """            float DepthDelta  = abs(CentreDepth - TapSurface.w);
            float DepthSpan   = DepthScale * CentreDepth * float(max(abs(X), abs(Y)) * Step) + 1.0e-3;
            float DepthWeight = exp(-DepthDelta / DepthSpan);"""
    new = """            float DepthDelta  = abs(CentreDepth - TapSurface.w);
            // V6: tolerance = 2x the change predicted by the local gradient along this offset, plus a tenth of the
            //    old relative allowance as a floor for quantised depth. The old rule was tolerant in proportion to
            //    z * distance whatever the surface did — it could not tell a slope from a step of the same size.
            float Predicted   = abs(DepthGradX * float(Offset.x)) + abs(DepthGradY * float(Offset.y));
            float DepthSpan   = 2.0 * Predicted + DepthScale * 0.1 * CentreDepth * float(max(abs(X), abs(Y)) * Step) + 1.0e-3;
            float DepthWeight = exp(-DepthDelta / DepthSpan);"""
    return apply(text, old, new, 1, "V6 span")


# ------------------------------------------------------------------------------------------------------------------------
# V7 — albedo demodulation: the filter smooths IRRADIANCE; texture detail is multiplied back at the presentation
#      write and becomes immune to the blur. (Kernel-side divide is the driver/harness half of this change.)
# ------------------------------------------------------------------------------------------------------------------------
def v7(text):
    old = "layout(set = 0, binding = 3, rgba8)   uniform writeonly image2D OutputImage;   // tone-mapped presentation image (final level only)"
    new = (old + "\n"
           "layout(set = 0, binding = 4, rgba16f) uniform readonly  image2D AlbedoImage;   // V7: albedo to remodulate at the presentation write")
    text = apply(text, old, new, 1, "V7 binding")
    old = "        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb), 1.0));"
    new = ("        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Centre.rgb * imageLoad(AlbedoImage, Pixel).rgb), 1.0));   // V7")
    text = apply(text, old, new, 2, "V7 pass-through writes")
    old = "    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb), 1.0));"
    new = ("    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Result.rgb * imageLoad(AlbedoImage, Pixel).rgb), 1.0));   // V7")
    return apply(text, old, new, 1, "V7 final write")


# ------------------------------------------------------------------------------------------------------------------------
# V8 — everything combined (V5 dither applied after V7's remodulation at the shared write sites).
# ------------------------------------------------------------------------------------------------------------------------
def v8(text):
    text = v1(text)
    text = v6(text)   # before V4 — V4 rewrites the LuminanceDenominator line V6 anchors on
    text = v4(text)
    # V7 first so the write sites carry the albedo multiply, then V5's dither wraps those rewritten sites.
    text = v7(text)
    old = """vec3 ToneMap(vec3 Hdr)
{"""
    new = """float DitherOffset(ivec2 Pixel)
{
    uint H = uint(Pixel.x) * 1664525u + uint(Pixel.y) * 1013904223u;
    H = (H ^ (H >> 16u)) * 2246822519u;
    H = H ^ (H >> 13u);
    return (float(H & 1023u) / 1023.0 - 0.5) / 255.0;
}

vec3 ToneMap(vec3 Hdr)
{"""
    text = apply(text, old, new, 1, "V8 dither helper")
    old = ("        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Centre.rgb * imageLoad(AlbedoImage, Pixel).rgb), 1.0));   // V7")
    new = ("        if (FinalLevel != 0u) { float D = DitherOffset(Pixel); imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Centre.rgb * imageLoad(AlbedoImage, Pixel).rgb) + vec3(D, D, D), 1.0)); }   // V7+V5")
    text = apply(text, old, new, 2, "V8 pass-through writes")
    old = ("    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Result.rgb * imageLoad(AlbedoImage, Pixel).rgb), 1.0));   // V7")
    new = ("    if (FinalLevel != 0u) { float D = DitherOffset(Pixel); imageStore(OutputImage, Pixel, "
           "vec4(ToneMap(Result.rgb * imageLoad(AlbedoImage, Pixel).rgb) + vec3(D, D, D), 1.0)); }   // V7+V5")
    return apply(text, old, new, 1, "V8 final write")


VARIANTS = {
    "V1_GlintSafeClamp":     v1,
    "V4_LogLumaStop":        v4,
    "V5_OutputDither":       v5,
    "V6_DepthGradient":      v6,
    "V7_AlbedoDemodulation": v7,
    "V8_Combined":           v8,
}
# V2 (young-history variance floor) and V3 (per-level sigma schedule) change the KERNEL accumulation and the DRIVER
# push constants, not the filter shader — they run the baseline shader under harness flags. Their upstream patches
# live in Patches/Denoiser/KernelAndDriver.md.

os.makedirs(PATCHES, exist_ok=True)
for Name, Fn in VARIANTS.items():
    Text = Fn(BASE)
    open(os.path.join(HERE, "Shaders", Name + ".slang"), "w", encoding="utf-8").write(Text)
    Diff = difflib.unified_diff(BASE.splitlines(True), Text.splitlines(True),
                                fromfile="a/Engine/Shaders/AtrousDenoise.slang",
                                tofile="b/Engine/Shaders/AtrousDenoise.slang")
    open(os.path.join(PATCHES, Name + ".patch"), "w", encoding="utf-8").writelines(Diff)
    print("wrote", Name)
print("ok")
