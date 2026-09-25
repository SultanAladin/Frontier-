#!/usr/bin/env python3
# Updates the M9 denoise gate alongside the V8 ship set — the gate pins shader/dispatcher text and asserts
# bit-exact presentation behaviour, both of which the ship set deliberately changes:
#   - the mirror must park unit albedo in the output image (the kernel's new contract),
#   - "bit-identical presentation" becomes "within the ±half-LSB dither bound",
#   - moved text pins (B10/B15/B27) follow their lines,
#   - A5 was ALREADY stale on this branch (#27B sky-reservoir bit, pre-existing) — fixed here too.
import sys

UP = "/home/user/Frontier-upstream/"


def apply(path, old, new, count=1):
    text = open(UP + path, encoding="utf-8").read()
    found = text.count(old)
    if found != count:
        sys.stderr.write("ANCHOR MISS in %s (found %d, expected %d):\n%s\n" % (path, found, count, old[:160]))
        sys.exit(2)
    open(UP + path, "w", encoding="utf-8").write(text.replace(old, new, count))


M = "Exhibits/Workbench/Materials/"

# ── the mirror parks unit albedo (the kernel's new contract for the presentation image) ─────────────────────────────
apply(M + "AtrousDenoiseMirror.cpp",
"    OutputImage.Assign(static_cast<int>(ExtentPixels), static_cast<int>(ExtentPixels));",
"""    OutputImage.Assign(static_cast<int>(ExtentPixels), static_cast<int>(ExtentPixels));
    // V7 demodulation: the kernel parks the primary surface's albedo in the presentation image and the final level
    //    reads it back to remodulate. The mirror's streams feed radiance directly — unit albedo — so the parked
    //    value is 1 and every pre-demodulation expectation keeps its meaning unchanged.
    for (vec4& Texel : OutputImage.Texels) Texel = vec4(1.0f, 1.0f, 1.0f, 1.0f);""")

# ── E4: accepted pixels match the kernel's own tone map within the dither half-LSB ─────────────────────────────────
apply(M + "DenoiseStreams.h",
"""                    bool Same = true;
                    for (uint32_t C = 0u; C < 3u; ++C) Same = Same && O[C] == Presented[C];""",
"""                    // V5 dither: the presentation write adds a ±half-LSB positional hash, so "untouched" is
                    //    asserted within that bound rather than bit-exactly (the pre-dither value IS bit-exact:
                    //    the early-out hands Centre through unchanged, as C3.1 still proves on the radiance side).
                    const float kHalfLsb = 0.5f / 255.0f + 1.0e-6f;
                    bool Same = true;
                    for (uint32_t C = 0u; C < 3u; ++C)
                        Same = Same && (O[C] - Presented[C]) <= kHalfLsb && (Presented[C] - O[C]) <= kHalfLsb;""")

P = M + "DenoiseReprojectionProof.cpp"

# ── the shared bound, once, next to the stream import ───────────────────────────────────────────────────────────────
apply(P,
"using DenoiseStreams::MeasureStream;",
"""using DenoiseStreams::MeasureStream;

// V5 output dither: the filter's presentation write carries a ±half-LSB positional hash, so every "same
//    presentation image" assertion is made within this bound rather than bit-exactly.
static constexpr float kDitherHalfLsb = 0.5f / 255.0f + 1.0e-6f;""")

# ── A5: pre-existing staleness — #27B's sky-reservoir bit is in the default dispatch ───────────────────────────────
apply(P,
"""                                | DispatchFeatureDenoise | DispatchFeatureGiReuse;
        Check(Dispatch.FeatureFlags == Expected, "A5 default dispatch carries exactly the R6/R7/GI feature bits (8 bits named)");""",
"""                                | DispatchFeatureDenoise | DispatchFeatureGiReuse | DispatchFeatureSkyReservoir;
        Check(Dispatch.FeatureFlags == Expected, "A5 default dispatch carries exactly the R6/R7/GI/#27B feature bits (9 bits named)");""")

# ── moved text pins ─────────────────────────────────────────────────────────────────────────────────────────────────
apply(P,
"""{ "ReSTIRViewport", "imageStore(DenoiseImage, ivec2(pixel), vec4(mean, variance));", 1u, "B10 one denoise store site for every material" },""",
"""{ "ReSTIRViewport", "imageStore(DenoiseImage, ivec2(pixel), vec4(storedMean, storedVariance));", 1u, "B10 one denoise store site for every material (storedMean = demodulated when the filter runs)" },""")

apply(P,
"""{ "AtrousDenoise", "layout(set = 0, binding = 3, rgba8)   uniform writeonly image2D OutputImage;", 1u, "B15 filter binding 3: the presentation image" },""",
"""{ "AtrousDenoise", "layout(set = 0, binding = 3, rgba8)   uniform           image2D OutputImage;", 1u, "B15 filter binding 3: the presentation image (read: the kernel's parked albedo; write: the tone map)" },""")

apply(P,
"""{ "SwapchainExchange", "Push.LuminanceScale = 4.0f;", 1u, "B27 the engine's σl reaches the shader" },""",
"""{ "SwapchainExchange", "static constexpr float kSigmaSchedule[5] = { 4.0f, 4.0f, 2.0f, 1.0f, 1.0f };", 1u, "B27 the engine's σl schedule reaches the shader (tightening as the taps widen)" },""")

# ── C1.2: disabled pass, now within the dither bound (and through the parked unit albedo) ──────────────────────────
apply(P,
"                Mapped = O[0] == Expected[0] && O[1] == Expected[1] && O[2] == Expected[2];",
"""                // The write remodulates the parked unit albedo and adds the ±half-LSB dither, so the tone-map
                //    equivalence is asserted within that bound.
                Mapped = std::fabs(O[0] - Expected[0]) <= kDitherHalfLsb
                      && std::fabs(O[1] - Expected[1]) <= kDitherHalfLsb
                      && std::fabs(O[2] - Expected[2]) <= kDitherHalfLsb;""")

apply(P,
"""        Check(Mapped, "C1.2 the disabled pass still writes the presentation image through the shader's own tone map");""",
"""        Check(Mapped, "C1.2 the disabled pass still writes the presentation image through the shader's own tone map (within the dither half-LSB)");""")

# ── C3.2: the convergence A/B, same bound ───────────────────────────────────────────────────────────────────────────
apply(P,
"                PassthroughOutput = PassthroughOutput && O[0] == Expected[0] && O[1] == Expected[1] && O[2] == Expected[2];",
"""                PassthroughOutput = PassthroughOutput
                                 && std::fabs(O[0] - Expected[0]) <= kDitherHalfLsb
                                 && std::fabs(O[1] - Expected[1]) <= kDitherHalfLsb
                                 && std::fabs(O[2] - Expected[2]) <= kDitherHalfLsb;""")

apply(P,
"""        Check(PassthroughOutput, "C3.2 A/B AT CONVERGENCE: denoise ON == denoise OFF, presentation images bit-identical");""",
"""        Check(PassthroughOutput, "C3.2 A/B AT CONVERGENCE: denoise ON == denoise OFF within the dither half-LSB");""")

# ── E4 label follows its comparison ────────────────────────────────────────────────────────────────────────────────
apply(P,
'''"E4 %s: every pixel the early-out accepts is bit-identical (%u/%u/%u accepted at the three holds, %u differ)",''',
'''"E4 %s: every pixel the early-out accepts matches within the dither half-LSB (%u/%u/%u accepted at the three holds, %u differ)",''')

print("gate updated")
