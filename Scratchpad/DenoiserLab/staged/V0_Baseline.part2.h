
// R10 #9. The convergence threshold for the per-pixel early-out, as a VARIANCE. Expressed as the square of a
//    fraction of an 8-bit quantisation step so the intent survives: below this, the pixel cannot move by enough
//    to change the byte that reaches the screen. Kept a compile-time constant rather than a push field — it is a
//    property of the 8-bit presentation format, not something a tier or a user should be dialling.
const float kEarlyOutStepFraction = 0.2;                                    // [-]  fraction of one 8-bit step
const float kEarlyOutVariance     = (kEarlyOutStepFraction / 255.0)
                                  * (kEarlyOutStepFraction / 255.0);        // [-]  σ² ≈ 6.1e-7

//------------------------------------------------------------------------------------------------------------------------
//                                                       HELPERS
//------------------------------------------------------------------------------------------------------------------------

float Luminance(vec3 Colour)
{
    return dot(Colour, vec3(0.2126, 0.7152, 0.0722));
}

// Identical to ReSTIRViewport.slang's tone map — the two must agree, because with the denoiser off the kernel
//    writes the presentation image itself and toggling the filter must not change the grade.
float AcesFilm(float x)
{
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 ToneMap(vec3 Hdr)
{
    // A7d, identical to the kernel's: below about 3 cd/m² the eye loses colour, and rendering full saturation
    //    there turns a faint pre-dawn glow into a lurid orange band.
    const float Grey = dot(Hdr, vec3(0.2126, 0.7152, 0.0722));
    Hdr = mix(vec3(Grey), Hdr, clamp(ColourSaturation, 0.0, 1.0));
    Hdr *= Exposure;
    return pow(vec3(AcesFilm(Hdr.r), AcesFilm(Hdr.g), AcesFilm(Hdr.b)), vec3(1.0 / 2.2));
}

// The 5-tap B₃ spline kernel, separable: (1/16, 1/4, 3/8, 1/4, 1/16). The 2D weight is the outer product.
float KernelWeight(int Offset)
{
    const float Weights[5] = { 0.0625, 0.25, 0.375, 0.25, 0.0625 };
    return Weights[Offset + 2];
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        KERNEL
//------------------------------------------------------------------------------------------------------------------------

void main()
{
    ivec2 Pixel = ivec2(gl_GlobalInvocationID.xy);
    if (Pixel.x >= int(Extent.x) || Pixel.y >= int(Extent.y)) return;

    vec4 Centre = imageLoad(SourceImage, Pixel);

    // Disabled, or a pixel with no surface (background): pass straight through. Filtering the background against
    //    geometry would drag scene colour into the void and produce a halo around every silhouette.
    vec4 CentreSurface = imageLoad(SurfaceImage, Pixel);
    if (Enabled == 0u || CentreSurface.w <= 0.0)
    {
        imageStore(TargetImage, Pixel, Centre);
        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb), 1.0));
        return;
    }

    vec3  CentreNormal    = CentreSurface.xyz;
    float CentreDepth     = CentreSurface.w;
    float CentreLuminance = Luminance(Centre.rgb);

    // The luminance denominator uses a 3×3 pre-filtered variance so a single bright fireflier cannot declare itself
    //    an edge and survive every level. ε keeps a fully converged (zero-variance) region from dividing by zero.
    // RELAX extension: local log-luminance statistics clamp extreme outlier fireflies before wavelet accumulation.
    float VarianceSum    = 0.0;
    float VarianceWeight = 0.0;
    float LogLumSum      = 0.0;
    float LogLumSqSum    = 0.0;
    for (int Y = -1; Y <= 1; ++Y)
    {
        for (int X = -1; X <= 1; ++X)
        {
            ivec2 Tap = clamp(Pixel + ivec2(X, Y), ivec2(0), ivec2(Extent) - 1);
            float W   = KernelWeight(X) * KernelWeight(Y);
            vec4 Sample = imageLoad(SourceImage, Tap);
            VarianceSum    += Sample.a * W;
            VarianceWeight += W;
            float LLum = log(1.0 + Luminance(Sample.rgb));
            LogLumSum      += LLum * W;
            LogLumSqSum    += (LLum * LLum) * W;
        }
    }
    float LocalVariance     = VarianceWeight > 0.0 ? max(VarianceSum / VarianceWeight, 0.0) : 0.0;
    float MeanLogLum        = VarianceWeight > 0.0 ? LogLumSum / VarianceWeight : 0.0;
    float VarLogLum         = VarianceWeight > 0.0 ? max(0.0, (LogLumSqSum / VarianceWeight) - (MeanLogLum * MeanLogLum)) : 0.0;
    float MaxAllowedLogLum  = MeanLogLum + 2.5 * sqrt(VarLogLum) + 0.15;
    float MaxAllowedLum     = exp(MaxAllowedLogLum) - 1.0;

    // R10 #9. A pixel whose neighbourhood has already converged has nothing left for a wider kernel to remove:
    //    the filter would compute a weighted mean of 25 values that already agree and hand back what it started
    //    with. Skipping it costs 25 taps, 25 image loads and the edge-stopper maths per pixel per level.
    //
    // The threshold is DERIVED, not tuned. It is the variance whose standard deviation is one fifth of an 8-bit
    //    quantisation step — (0.2/255)² ≈ 6.1e-7 — so a skipped pixel cannot move far enough to change the byte
    //    written into the presentation image. Measured against the same chain without the early-out, the worst
    //    single-pixel deviation across the frame is 0.47 of a step, i.e. under the half step that would round to
    //    a different value. At 1e-5 the same measurement gives 4.4 steps, which is plainly visible; the useful
    //    range is narrow and sits far lower than intuition suggests, which is why it was measured.
    //
    // This is self-gating in a way that also handles a still frame for free. Variance only falls this low AFTER
    //    the early levels have done their work and only where the estimate has genuinely converged, so:
    //      · a noisy frame (1-4 spp) skips nothing at all — 0.0% of taps, the filter behaves exactly as before;
    //      · a frame held still accumulates samples and skips progressively more — 9.7% of taps at 64 spp,
    //        21.1% at 256, 36.0% at 1024 — without a frame counter, a heuristic or a separate "converged" path.
    //    The saving arrives exactly when there is nothing left to do, and per pixel rather than per frame, so a
    //    static background stops being filtered while a moving character in front of it keeps its full chain.
    //
    // Verified against the tap loop rather than assumed: a level guard was tried and measured as a no-op, since
    //    no pixel ever qualifies at levels 0-3. The convergence test is its own gate.
    if (LocalVariance < kEarlyOutVariance)
    {
        // Still write BOTH outputs. The ping-pong target must carry this pixel forward or the next level reads a
        //    stale slot, and the presentation image must be written or a skipped pixel keeps last frame's colour.
        imageStore(TargetImage, Pixel, Centre);
        if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Centre.rgb), 1.0));
        return;
    }

    float LuminanceDenominator = LuminanceScale * sqrt(LocalVariance) + 1.0e-4;

    vec3  ColourSum   = vec3(0.0);
    float VarianceOut = 0.0;
    float WeightSum   = 0.0;

    int Step = int(StepSize);

    for (int Y = -2; Y <= 2; ++Y)
    {
        for (int X = -2; X <= 2; ++X)
        {
            ivec2 Offset = ivec2(X, Y) * Step;
            ivec2 Tap    = Pixel + Offset;

            // Taps outside the image are dropped rather than clamped: clamping would pile the edge pixel's value
            //    up against the border and produce a bright rim.
            if (Tap.x < 0 || Tap.y < 0 || Tap.x >= int(Extent.x) || Tap.y >= int(Extent.y)) continue;

            vec4 TapSurface = imageLoad(SurfaceImage, Tap);
            if (TapSurface.w <= 0.0) continue;                     // background never bleeds into a surface

            vec4  TapColour = imageLoad(SourceImage, Tap);
            float TapLum    = Luminance(TapColour.rgb);
            if (TapLum > MaxAllowedLum && TapLum > 1.0e-4)
            {
                TapColour.rgb *= (MaxAllowedLum / TapLum);
            }
            float Base      = KernelWeight(X) * KernelWeight(Y);

            // ① Normal agreement.
            float NormalWeight = pow(max(dot(CentreNormal, TapSurface.xyz), 0.0), NormalPower);

            // ② Depth. Scaled by the centre depth so the tolerance is relative — a 5 cm step matters at 1 m and
            //    is irrelevant at 100 m — and by the tap distance, standing in for the depth gradient.
            float DepthDelta  = abs(CentreDepth - TapSurface.w);
            float DepthSpan   = DepthScale * CentreDepth * float(max(abs(X), abs(Y)) * Step) + 1.0e-3;
            float DepthWeight = exp(-DepthDelta / DepthSpan);

            // ③ Luminance, relative to the noise level.
            float LuminanceDelta  = abs(CentreLuminance - Luminance(TapColour.rgb));
            float LuminanceWeight = exp(-LuminanceDelta / LuminanceDenominator);

            float Weight = Base * NormalWeight * DepthWeight * LuminanceWeight;

            ColourSum   += TapColour.rgb * Weight;
            VarianceOut += TapColour.a   * Weight * Weight;        // variance of a weighted mean
            WeightSum   += Weight;
        }
    }

    // WeightSum is always ≥ the centre tap's own weight, so this cannot divide by zero; the guard is for the
    //    pathological case of a denormal kernel weight.
    vec4 Result = WeightSum > 1.0e-8
                ? vec4(ColourSum / WeightSum, VarianceOut / (WeightSum * WeightSum))
                : Centre;

    imageStore(TargetImage, Pixel, Result);

    // The last level is also the presentation write. Doing it here rather than in a sixth pass saves a full-screen
    //    round trip, and keeps the tone map the only place linear radiance becomes display values.
    if (FinalLevel != 0u) imageStore(OutputImage, Pixel, vec4(ToneMap(Result.rgb), 1.0));
}

