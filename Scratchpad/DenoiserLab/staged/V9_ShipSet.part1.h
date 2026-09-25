//============================================================================================================================================
// 📦 Engine/Shaders/AtrousDenoise.slang — R7: edge-avoiding à-trous wavelet filter over the accumulated radiance
//============================================================================================================================================
// One dispatch per wavelet level. Level i reads the previous level and writes the next, sampling a 5×5 neighbourhood
//    whose taps are spaced 2^i pixels apart. Five levels therefore reach a 81×81 pixel footprint for the cost of
//    5 × 25 taps instead of 6561, which is the entire point of the à-trous ("with holes") formulation.
//
// The filter is EDGE-AVOIDING: each tap is weighted by how much it agrees with the centre pixel, so the blur runs
//    along surfaces and stops at silhouettes. Three weights multiply together (Dammertz et al. 2010, and the
//    geometry/luminance terms from SVGF, Schied et al. 2017):
//
//      w_normal    = max(0, n·n_tap)^σn         — a tap on a differently-oriented surface contributes nothing
//      w_depth     = exp(-|z - z_tap| / (σz·|∇z| + ε))   — separates surfaces that overlap in screen space
//      w_luminance = exp(-|l - l_tap| / (σl·√(g·Var) + ε)) — preserves genuine lighting features
//
// The luminance term is what separates this from a bilateral blur: dividing by the estimated standard deviation
//    means a difference that is small RELATIVE TO THE NOISE is smoothed, while a difference much larger than the
//    noise is a real edge and is preserved. Where variance is high (few samples) the filter is permissive and
//    blurs hard; where the estimate has converged it barely touches the image. That is the property that lets the
//    denoiser fade out as the running mean converges rather than permanently softening a still frame.
//
// Variance is carried in the alpha channel and filtered alongside the colour with the SQUARE of the colour weights,
//    which is the correct propagation for a weighted mean of independent samples.
//
// NOTE: GLSL source lowered by glslc -fshader-stage=compute.


//------------------------------------------------------------------------------------------------------------------------
//                                                       BINDINGS
//------------------------------------------------------------------------------------------------------------------------
// A private descriptor set. The ReSTIR kernel's set is full to its variable-count texture array, and a filter that
//    only needs three images has no business being bolted onto it.

layout(set = 0, binding = 0, rgba32f) uniform readonly  image2D SourceImage;    // xyz = radiance, w = variance
layout(set = 0, binding = 1, rgba32f) uniform writeonly image2D TargetImage;    // xyz = radiance, w = variance
layout(set = 0, binding = 2, rgba16f) uniform readonly  image2D SurfaceImage;   // xyz = normal, w = depth (≤ 0 = none)
layout(set = 0, binding = 3, rgba8)   uniform           image2D OutputImage;   // IN: primary albedo, parked by the kernel while the denoiser owns this image · OUT: tone-mapped presentation (final level only)

struct DenoiseConstants
{
    uvec2 Extent;             // [px]  image size
    uint  StepSize;           // [px]  tap spacing for this level: 1, 2, 4, 8, 16
    uint  Enabled;            // [-]   0 = straight copy, so the pass is an identity switch

    float NormalPower;        // [-]   σn — exponent on the normal agreement
    float DepthScale;         // [-]   σz — relative depth tolerance
    float LuminanceScale;     // [-]   σl — how many standard deviations count as "the same"
    float Exposure;           // [-]   applied by the final level's tone map

    uint  FinalLevel;         // [-]   1 = also tone-map into OutputImage
    // A7d. Must match the kernel's: with the denoiser on, THIS is the tone map the viewer sees, and a
    //    saturation applied in only one of the two would change colour when the denoiser was toggled.
    float ColourSaturation;   // [-]   1 in daylight, 0 under starlight
} DenoiseParameters;
