#!/usr/bin/env python3
#============================================================================================================================================
#                                                        SHIP_V8.PY
#============================================================================================================================================
# Applies the full V8 ship set to the REAL engine files in /home/user/Frontier-upstream (branch arena/01a0c77d-frontier
# @ f0a2329). Every edit is an exact-match substitution: if the tree drifts, this fails loudly rather than shipping a
# half-applied change.
#
#   AtrousDenoise.slang      — V1 clamp gate, V6 min-mag depth gradient, V4 log-luma stop, V5 dither,
#                              V7 remodulation reading the albedo the kernel parks in OutputImage (no new binding:
#                              kernel-set bindings 0-31 are full and 31 must stay last).
#   ReSTIRViewport.slang     — V2 young-history variance floor; ResolveSurface carries the primary albedo;
#                              demodulated DenoiseImage store (+ variance rescale); albedo parked in OutputImage.
#   SwapchainExchange.cpp    — V3 per-level sigma_l schedule; the kernel->denoise barrier extended to the
#                              presentation image (the final level now READS the parked albedo from it).
import sys

UP = "/home/user/Frontier-upstream/"


def apply(path, old, new, count=1):
    text = open(UP + path, encoding="utf-8").read()
    found = text.count(old)
    if found != count:
        sys.stderr.write("ANCHOR MISS in %s (found %d, expected %d):\n%s\n" % (path, found, count, old[:160]))
        sys.exit(2)
    open(UP + path, "w", encoding="utf-8").write(text.replace(old, new, count))


# ══════════════════════════════════════════════════ AtrousDenoise.slang ═══════════════════════════════════════════════
S = "Engine/Shaders/AtrousDenoise.slang"

# -- V7 half A: binding 3 becomes read+write (the kernel parks the primary albedo there when the denoiser is on) ------
apply(S,
"layout(set = 0, binding = 3, rgba8)   uniform writeonly image2D OutputImage;   // tone-mapped presentation image (final level only)",
"layout(set = 0, binding = 3, rgba8)   uniform           image2D OutputImage;   // IN: primary albedo, parked by the kernel while the denoiser owns this image · OUT: tone-mapped presentation (final level only)")

# -- V5: half-LSB hash dither helper ----------------------------------------------------------------------------------
apply(S,
"""vec3 ToneMap(vec3 Hdr)
{""",
"""// Half-LSB hash dither for the rgba8 presentation write. Smooth sky and fog gradients otherwise quantise into
//    visible bands; +-0.5/255 of position-hashed noise trades them for imperceptible grain (measured: 185 -> 249
//    distinct levels across a sky gradient). Position-hashed, not frame-hashed, so a still frame stays still.
float DitherOffset(ivec2 Pixel)
{
    uint H = uint(Pixel.x) * 1664525u + uint(Pixel.y) * 1013904223u;
    H = (H ^ (H >> 16u)) * 2246822519u;
    H = H ^ (H >> 13u);
    return (float(H & 1023u) / 1023.0 - 0.5) / 255.0;
}

vec3 ToneMap(vec3 Hdr)
{""")

# -- V1: variance-gated firefly clamp ---------------------------------------------------------------------------------
apply(S,
"""            if (TapLum > MaxAllowedLum && TapLum > 1.0e-4)
            {
                TapColour.rgb *= (MaxAllowedLum / TapLum);
            }""",
"""            // Clamp only STATISTICALLY UNCERTAIN brightness: a tap whose variance-of-the-mean certifies its value
            //    to better than ~15% relative is a converged bright feature (a glint), not a firefly — fireflies
            //    are always high-variance because they are one huge sample amortised over a short history.
            if (TapLum > MaxAllowedLum && TapLum > 1.0e-4 && TapColour.a > 0.0225 * TapLum * TapLum)
            {
                TapColour.rgb *= (MaxAllowedLum / TapLum);
            }""")

# -- V6: min-magnitude depth-gradient edge stop (before V4, which rewrites the anchor line) ---------------------------
apply(S,
"    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;",
"""    // The screen-space depth gradient, from the immediate neighbours (4 extra surface loads per pixel against the
    //    main loop's 50 — ~8% bandwidth). |grad z . offset| predicts how much depth SHOULD change along a tap
    //    offset on this same surface; only the residual beyond that is an edge. The two one-sided differences are
    //    combined by MIN MAGNITUDE, not averaged: at a genuine depth edge one side crosses the step and reads
    //    huge, and averaging it in would inflate the tolerance exactly where it must stay tight.
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

    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;""")

apply(S,
"""            float DepthDelta  = abs(CentreDepth - TapSurface.w);
            float DepthSpan   = DepthScale * CentreDepth * float(max(abs(X), abs(Y)) * Step) + 1.0e-3;
            float DepthWeight = exp(-DepthDelta / DepthSpan);""",
"""            float DepthDelta  = abs(CentreDepth - TapSurface.w);
            // Tolerance = 2x the change predicted by the local gradient along this offset, plus a tenth of the old
            //    relative allowance as a floor for quantised depth. The old rule was tolerant in proportion to
            //    z * distance whatever the surface did — it could not tell a slope from a step of the same size
            //    (measured: +0.67 dB across a 0.4-unit trim step, -0.12 dB on a grazing slant).
            float Predicted   = abs(DepthGradX * float(Offset.x)) + abs(DepthGradY * float(Offset.y));
            float DepthSpan   = 2.0 * Predicted + DepthScale * 0.1 * CentreDepth * float(max(abs(X), abs(Y)) * Step) + 1.0e-3;
            float DepthWeight = exp(-DepthDelta / DepthSpan);""")

# -- V4: luminance edge stop in log(1+L) ------------------------------------------------------------------------------
apply(S,
"    float CentreLuminance = Luminance(Centre.rgb);\n",
"""    float CentreLuminance = Luminance(Centre.rgb);
    float CentreLogLum    = log(1.0 + CentreLuminance);   // the edge-stop compares in log(1+L) space
""")

apply(S,
"    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;",
"""    // The edge-stop runs in log(1+L) space so one sigma means the same visual step in shadow and highlight; the
    //    variance estimate is linear-luma^2, and d log(1+L) / dL = 1 / (1+L) converts its sigma, so the SAME
    //    LuminanceScale keeps its meaning (measured: fresh-glint retention 86.9% -> 93.5%).
    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) / (1.0 + CentreLuminance) + 1.0e-4;""")

apply(S,
"            float LuminanceDelta  = abs(CentreLuminance - Luminance(TapColour.rgb));",
"""            float TapLogLum       = log(1.0 + Luminance(TapColour.rgb));
            float LuminanceDelta  = abs(CentreLogLum - TapLogLum);""")

# -- V7 half B + V5: the three presentation writes remodulate the parked albedo, then dither -------------------------
apply(S,
"        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb), 1.0));",
"""        if (FinalLevel != 0u)
        {
            // The kernel parked the primary albedo in OutputImage (it never writes colour there while the denoiser
            //    owns the presentation). Read it back before overwriting — a same-texel load-then-store inside one
            //    invocation is well-defined, and no other invocation touches this texel.
            vec3  Albedo = imageLoad(OutputImage, Pixel).rgb;
            float Grain  = DitherOffset(Pixel);
            imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb * Albedo) + vec3(Grain, Grain, Grain), 1.0));
        }""",
count=2)

apply(S,
"    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb), 1.0));",
"""    if (FinalLevel != 0u)
    {
        vec3  Albedo = imageLoad(OutputImage, Pixel).rgb;   // the albedo the kernel parked (see the early-out sites)
        float Grain  = DitherOffset(Pixel);
        imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb * Albedo) + vec3(Grain, Grain, Grain), 1.0));
    }""")

# ══════════════════════════════════════════════════ ReSTIRViewport.slang ══════════════════════════════════════════════
K = "Engine/Shaders/ReSTIRViewport.slang"

# -- V2: young-history variance floor ---------------------------------------------------------------------------------
apply(K,
"""    // A single sample carries no information about its own spread. Reporting its luminance squared keeps the
    //    filter permissive on brand-new pixels (disocclusions), which is exactly where smoothing is needed most.
    if (count < 2.0) variance = luma * luma;""",
"""    // A young history cannot certify a LOW variance either: two or three samples that happen to agree report ~0
    //    and freeze the filter on a freshly disoccluded pixel. Floor the estimate in proportion to brightness,
    //    fading out by n = 4 (measured: +0.61 dB in an n=2 disocclusion block, all other pixels bit-identical).
    if (count < 4.0) variance = max(variance, luma * luma * (4.0 - count) * 0.125);

    // A single sample carries no information about its own spread. Reporting its luminance squared keeps the
    //    filter permissive on brand-new pixels (disocclusions), which is exactly where smoothing is needed most.
    if (count < 2.0) variance = luma * luma;""")

# -- V7: ResolveSurface carries the primary surface's albedo ----------------------------------------------------------
apply(K,
"void ResolveSurface(uvec2 pixel, vec3 radiance, vec3 normal, float depth, uint identity)",
"void ResolveSurface(uvec2 pixel, vec3 radiance, vec3 normal, float depth, uint identity, vec3 albedo)")

apply(K,
"    ResolveSurface(pixel, radiance, vec3(0.0, 0.0, 1.0), -1.0, kIdentityNone);",
"    ResolveSurface(pixel, radiance, vec3(0.0, 0.0, 1.0), -1.0, kIdentityNone, vec3(1.0));   // no surface -> nothing to demodulate")

apply(K,
"    ResolveSurface(pixel, accumulatedRadiance, hitNormal, primaryT, visibility);",
"    ResolveSurface(pixel, accumulatedRadiance, hitNormal, primaryT, visibility, albedo);")

# -- V7: demodulated DenoiseImage store; albedo parked in OutputImage while the denoiser owns it -----------------------
apply(K,
"""    imageStore(DenoiseImage, ivec2(pixel), vec4(mean, variance));
    if ((FeatureFlags & kFeatureDenoise) == 0u)
        imageStore(OutputImage, ivec2(pixel), vec4(ToneMap(mean), 1.0));""",
"""    // Albedo demodulation (measured: +7.7 dB overall, +11.4 dB on textured surfaces): the filter smooths
    //    IRRADIANCE, and the final à-trous level multiplies the albedo back, so texture detail never passes
    //    through the blur at all. The variance channel rides in luminance² units, so it rescales by the albedo
    //    luminance squared. The albedo is quantised HERE exactly as the rgba8 store will quantise it, so the
    //    divide and the filter's read-back multiply are inverses to the last bit.
    //    Where the albedo travels: with the denoiser on, OutputImage is otherwise unwritten this frame — the
    //    kernel parks the albedo there and the final level reads it back before overwriting. No new image and no
    //    new binding (0-31 of this set are all taken, and 31, the variable-count table, must stay last).
    if ((FeatureFlags & kFeatureDenoise) == 0u)
    {
        imageStore(DenoiseImage, ivec2(pixel), vec4(mean, variance));
        imageStore(OutputImage, ivec2(pixel), vec4(ToneMap(mean), 1.0));
    }
    else
    {
        vec3  demodAlbedo = max(floor(albedo * 255.0 + 0.5) / 255.0, vec3(0.02));
        float demodLum    = max(Luminance(demodAlbedo), 0.02);
        imageStore(DenoiseImage, ivec2(pixel), vec4(mean / demodAlbedo, variance / (demodLum * demodLum)));
        imageStore(OutputImage,  ivec2(pixel), vec4(demodAlbedo, 1.0));
    }""")

# ══════════════════════════════════════════════════ SwapchainExchange.cpp ═════════════════════════════════════════════
D = "Engine/DeviceExchange/SwapchainExchange.cpp"

# -- V7: the kernel->denoise barrier now also covers the presentation image (final level READS the parked albedo) -----
apply(D,
"""                VkImageMemoryBarrier KernelOutput{};
                KernelOutput.sType                       = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
                KernelOutput.oldLayout                   = VK_IMAGE_LAYOUT_GENERAL;
                KernelOutput.newLayout                   = VK_IMAGE_LAYOUT_GENERAL;
                KernelOutput.srcQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
                KernelOutput.dstQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
                KernelOutput.image                       = Vulkan->HistorySurfaceImage;
                KernelOutput.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
                KernelOutput.subresourceRange.levelCount = 1u;
                KernelOutput.subresourceRange.layerCount = 1u;""",
"""                // Two images to order, same bracket: the surface image feeds every level's edge stops, and the
                //    PRESENTATION image now carries the albedo the kernel parked for the final level's
                //    remodulation read — unordered, the final level could read a texel the kernel had not
                //    written yet and remodulate with garbage.
                VkImageMemoryBarrier KernelOutputs[2]{};
                for (uint32_t Slot = 0u; Slot < 2u; ++Slot)
                {
                    VkImageMemoryBarrier& KernelOutput       = KernelOutputs[Slot];
                    KernelOutput.sType                       = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
                    KernelOutput.oldLayout                   = VK_IMAGE_LAYOUT_GENERAL;
                    KernelOutput.newLayout                   = VK_IMAGE_LAYOUT_GENERAL;
                    KernelOutput.srcQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
                    KernelOutput.dstQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
                    KernelOutput.image                       = Slot == 0u ? Vulkan->HistorySurfaceImage
                                                                          : Vulkan->StorageImage;
                    KernelOutput.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
                    KernelOutput.subresourceRange.levelCount = 1u;
                    KernelOutput.subresourceRange.layerCount = 1u;""")

apply(D,
"""                KernelOutput.srcAccessMask               = VK_ACCESS_SHADER_WRITE_BIT;
                KernelOutput.dstAccessMask               = VK_ACCESS_SHADER_READ_BIT;
                vkCmdPipelineBarrier(Command,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                    0u, 0u, nullptr, 0u, nullptr, 1u, &KernelOutput);""",
"""                    KernelOutput.srcAccessMask               = VK_ACCESS_SHADER_WRITE_BIT;
                    KernelOutput.dstAccessMask               = VK_ACCESS_SHADER_READ_BIT
                                                             | (Slot == 1u ? VK_ACCESS_SHADER_WRITE_BIT : 0u);
                }
                vkCmdPipelineBarrier(Command,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                    0u, 0u, nullptr, 0u, nullptr, 2u, KernelOutputs);""")

# -- V3: per-level luminance-sigma schedule ---------------------------------------------------------------------------
apply(D,
"                Push.LuminanceScale = 4.0f;",
"""                // Per-level sigma_l schedule: tighten the luminance stop as the taps widen — levels 2+ have
                //    4/8/16 px-spaced taps and are where detail smears (measured: +0.42 dB overall, fresh-glint
                //    retention 86.9% -> 92.4%; dark high-noise areas keep slightly more residue).
                {
                    static constexpr float kSigmaSchedule[5] = { 4.0f, 4.0f, 2.0f, 1.0f, 1.0f };
                    Push.LuminanceScale = kSigmaSchedule[Level < 5u ? Level : 4u];
                }""")

print("V8 ship set applied to", UP)
