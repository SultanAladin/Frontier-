//============================================================================================================================================
//                                          AUTOMOTIVE MATERIAL PROFILES
//============================================================================================================================================
// Shared authoring profiles for the standalone automotive material scene. These are deliberately built out of the
// same ShadingRecord fields consumed by MaterialEvaluation.slang: the CPU exhibit and the GPU include see the exact
// same profile bytes and the exact same OpenPBR lobe evaluator. They are not wired into Project-Zero's material
// records yet; the preview scene is the review gate before that integration.
//
// Current preview milestone: clearcoat paint with dense analytic metallic flakes, carbon/resin, red/clear optics,
// brushed alloy, heat-tinted titanium, rubber, and Alcantara. UV texture sampling, water, and automotive host
// serialization remain later milestones. The functions below are intentionally texture-free so a CPU render can be
// compared bit-for-bit against the same constants on the GPU.

#ifndef FRONTIER_AUTOMOTIVE_MATERIAL_PROFILES
#define FRONTIER_AUTOMOTIVE_MATERIAL_PROFILES

ShadingRecord AutomotiveDefaults()
{
    ShadingRecord M;
    M.BaseColor = vec3(0.5);
    M.Metalness = 0.0;
    M.DiffuseRoughness = 0.5;
    M.SpecularWeight = 1.0;
    M.SpecularColor = vec3(1.0);
    M.SpecularRoughness = 0.5;
    M.SpecularAnisotropy = 0.0;
    M.AnisotropyAngle = 0.0;
    M.SpecularIor = 1.5;
    M.ThinFilmWeight = 0.0;
    M.ThinFilmThickness = 0.5;
    M.ThinFilmIor = 1.4;
    M.HazinessWeight = 0.0;
    M.HazinessRoughness = 0.5;
    M.CoatWeight = 0.0;
    M.CoatColor = vec3(1.0);
    M.CoatRoughness = 0.0;
    M.CoatAnisotropy = 0.0;
    M.CoatIor = 1.5;
    M.CoatDarkening = 1.0;
    M.CoatTangent = vec3(1.0, 0.0, 0.0);
    M.CoatNormal = vec3(0.0, 0.0, 1.0);
    M.FuzzWeight = 0.0;
    M.FuzzColor = vec3(1.0);
    M.FuzzRoughness = 0.5;
    M.Emission = vec3(0.0);
    M.TransmissionWeight = 0.0;
    M.TransmissionColor = vec3(1.0);
    M.TransmissionDepth = 0.0;
    M.TransmissionThickness = 0.0;
    M.Selection = kReflectanceStandard;
    M.SssWeight = 0.0;
    M.SssColor = vec3(1.0);
    M.SssRadius = 0.0;
    M.SssRadiusScale = vec3(1.0);
    M.SssThickness = 0.0;
    return M;
}

// A compact flop helper for later per-hit/profile parameterisation. It is shared here so the future texture/UV
// integration cannot invent a second colour-shift curve. mu is the view cosine; edgeColor is approached at grazing.
vec3 AutomotiveFlopColor(vec3 faceColor, vec3 edgeColor, float mu)
{
    float grazing = pow(1.0 - clamp(mu, 0.0, 1.0), 5.0);
    return mix(faceColor, edgeColor, grazing);
}

// Cauchy dispersion at wavelengthNm. B and C are authored around the 589.3 nm reference line so the supplied
// IorD remains the measured yellow-green index. This is a transport parameter, not an RGB tint: the preview traces
// each display channel with its wavelength-specific IOR through the existing Fresnel/Snell/TIR path.
float AutomotiveCauchyIor(float iorD, float cauchyB, float cauchyC, float wavelengthNm)
{
    float lambdaUm = max(wavelengthNm * 0.001f, 0.25f);
    float referenceUm = 0.5893f;
    float a = iorD - cauchyB / (referenceUm * referenceUm) - cauchyC /
              (referenceUm * referenceUm * referenceUm * referenceUm);
    return max(1.0001f, a + cauchyB / (lambdaUm * lambdaUm) +
               cauchyC / (lambdaUm * lambdaUm * lambdaUm * lambdaUm));
}

// ⚠️ RETIRED (M6b): AutomotiveFlakeSignal and AutomotiveApplyTriCoatFlakeNormal lived here — a sum of three
//    incommensurate sines, thresholded into a sparkle. They are DELETED rather than deprecated, because a second
//    flake model is the one thing this file exists to prevent: the preview kept running the sine field for a
//    milestone after the kernel had moved on, and the automotive paint exhibit rendered speckle noise the whole
//    time. Every caller now uses the lattice below. The reasoning that replaced them is its banner comment.

//============================================================================================================================================
//                                     M6b — THE FLAKE LATTICE (sized, coloured, shared)
//============================================================================================================================================
// ⚠️ WHY A LATTICE AND NOT A SINE FIELD (the retired AutomotiveFlakeSignal, see the note above). That was a sum of
//    three incommensurate sines, so its "flakes" were whatever happened to cross a threshold: their SIZE is set by
//    the frequency and cannot be authored, and at the library's uv_scale every feature landed far below a pixel.
//    Rendered, that reads as a faint salt — measurable (the M6 gate saw 4.5 % RMSE) but not visible as flakes. A
//    real flake has three authorable properties a noise field cannot express: a POSITION, a RADIUS, and one
//    CONSTANT orientation and colour across its whole face (it is a flat chip of pigment, not a field).
//
//    So: quantise the surface point into cells of 1/cellsPerMetre metres; each cell hosts at most one flake, seeded
//    from the cell's own hash. `flakeSize` is the flake's radius as a fraction of the cell (0.02 → 0.5 — 0.5 is a
//    flake touching the cell wall), and it is what finally makes the sparkle visible at a sane cell frequency.
//    `coverage` is the fraction of cells that host one at all. One cell is inspected per hit (the jitter is bounded so
//    a flake never leaves its cell), so the cost is a handful of hashes — not the 27-cell neighbourhood search.
//
//    Everything here is deterministic and texture-free, so the GPU shader and the FRONTIER_CPU_PORT mirror return the
//    SAME flake for the same world point. The flake is still a microfacet under the coat: it perturbs the normal,
//    tints the metal it is made of, and polishes its own facet. It is never a light source.

float SlateFlakeHash(vec3 cell, float salt)
{
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7)) + salt * 19.19) * 43758.5453);
}

// The pigment wheel a metallic flake set is mixed from: a full-value linear-RGB rainbow, so `t` walks the hues the
//    way a flake batch does (gold → green → cyan → violet → red) rather than only lightening one colour.
// ⚠️ The wheel is lifted off the axes by kFlakeFloor, and this is a MEASURED floor, not a taste call. A hue at full
//    saturation has EXACT zeros in one or two channels; a metal whose F82 tint is zero in a channel drives that
//    channel's Kulla–Conty energy-compensation term to a tiny NEGATIVE radiance. Measured on the candy column at
//    360x270x24: floor 0.00 → 6 617 out-of-range samples, 0.06 → 1 344, 0.15 → 91, 0.22 → ZERO (the shipped value). The aluminium
//    and tinted columns never reach a zero channel and reported 0 throughout. A real pigment flake is not a perfect
//    notch filter either, so the floor is physical as well as numerical.
const float kFlakeFloor = 0.22;

vec3 SlateFlakeHue(float t)
{
    float h = fract(t) * 6.0;
    float f = h - floor(h);
    int   arc = int(h) % 6;
    vec3 pure;
    if      (arc == 0) pure = vec3(1.0, f, 0.0);
    else if (arc == 1) pure = vec3(1.0 - f, 1.0, 0.0);
    else if (arc == 2) pure = vec3(0.0, 1.0, f);
    else if (arc == 3) pure = vec3(0.0, 1.0 - f, 1.0);
    else if (arc == 4) pure = vec3(f, 0.0, 1.0);
    else               pure = vec3(1.0, 0.0, 1.0 - f);
    return vec3(kFlakeFloor, kFlakeFloor, kFlakeFloor) + pure * (1.0 - kFlakeFloor);
}

// One flake sample at a world point.
//    .x   = mask     — 1 on the flake's face, feathered to 0 across its rim (0 = bare paint between flakes)
//    .yzw = tint     — the flake's own pigment (white when colourSpread = 0: a plain aluminium flake)
// `tilt` (out-parameter free: derived again by the normal call below from the same cell) stays with the flake so the
//    whole face shares one orientation — that is what makes a flake flash as a unit instead of shimmering.
vec4 SlateFlakeSample(vec3 position, float cellsPerMetre, float coverage, float flakeSize, float colourSpread)
{
    vec3  grid = position * max(cellsPerMetre, 0.01);
    vec3  cell = floor(grid);
    vec3  local = grid - cell;
    if (SlateFlakeHash(cell, 3.7) > clamp(coverage, 0.0, 1.0)) return vec4(0.0, 1.0, 1.0, 1.0);   // this cell is bare paint

    float radius = clamp(flakeSize, 0.02, 0.5);
    vec3  jitter = vec3(SlateFlakeHash(cell, 11.3), SlateFlakeHash(cell, 23.9), SlateFlakeHash(cell, 41.1));
    vec3  centre = vec3(0.5, 0.5, 0.5) + (jitter - vec3(0.5, 0.5, 0.5)) * (1.0 - 2.0 * radius);   // bounded: never crosses a wall
    vec3  offset = local - centre;
    float reach  = length(offset) / radius;
    float mask   = 1.0 - smoothstep(0.72, 1.0, reach);
    if (mask <= 0.0) return vec4(0.0, 1.0, 1.0, 1.0);

    vec3 tint = mix(vec3(1.0, 1.0, 1.0), SlateFlakeHue(SlateFlakeHash(cell, 57.3)), clamp(colourSpread, 0.0, 1.0));
    return vec4(mask, tint.x, tint.y, tint.z);
}

// The flake's facet: one constant tilt across the whole face, drawn from the same cell hash the sample used.
vec3 SlateFlakeNormal(vec3 normal, vec3 position, float cellsPerMetre, float mask, float tiltAmplitude)
{
    if (mask <= 0.0) return normal;
    vec3  cell = floor(position * max(cellsPerMetre, 0.01));
    vec3  helper = abs(normal.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3  tangent = normalize(cross(helper, normal));
    vec3  bitangent = cross(normal, tangent);
    float tx = SlateFlakeHash(cell, 67.7) * 2.0 - 1.0;
    float ty = SlateFlakeHash(cell, 83.1) * 2.0 - 1.0;
    float tilt = mask * tiltAmplitude;
    return normalize(normal + tangent * (tx * tilt) + bitangent * (ty * tilt));
}

// UV-backed review detail. These analytic test patterns stand in for texture reads until the host texture binding is
// integrated: both CPU and GPU still consume the same UV coordinates, phase, thresholds, and lobe modulation. The
// carbon pattern is a dual-weave warp/weft, while the tire pattern uses staggered longitudinal ribs and cross grooves.
float AutomotiveCarbonWeave(vec2 uv)
{
    float Tau = 6.28318530718f;
    float warp = 0.5f + 0.5f * float(sin(uv.x * Tau * 34.0f + 0.22f * sin(uv.y * Tau * 3.0f)));
    float weft = 0.5f + 0.5f * float(sin(uv.y * Tau * 34.0f + 0.22f * sin(uv.x * Tau * 3.0f)));
    float diagonal = 0.5f + 0.5f * float(sin((uv.x + uv.y) * Tau * 17.0f));
    return clamp(0.50f * max(pow(warp, 3.0f), pow(weft, 3.0f)) + 0.16f * diagonal, 0.0f, 1.0f);
}

float AutomotiveTireTread(vec2 uv)
{
    float Tau = 6.28318530718f;
    float rib = abs(float(sin(uv.x * Tau * 11.0f + 0.35f * sin(uv.y * Tau * 2.0f))));
    float crossGroove = abs(float(sin(uv.y * Tau * 5.5f + uv.x * Tau * 2.0f)));
    return clamp(smoothstep(0.28f, 0.72f, rib) * (0.72f + 0.28f * crossGroove), 0.0f, 1.0f);
}

vec3 AutomotiveUvFrameNormal(vec3 normal, vec2 uv, float pattern, float amplitude)
{
    vec3 helper = abs(normal.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(helper, normal));
    vec3 bitangent = cross(normal, tangent);
    float Tau = 6.28318530718;
    float hx = pattern < 0.5
        ? sin(uv.x * Tau * 34.0 + 0.18 * sin(uv.y * Tau * 3.0))
        : sin(uv.x * Tau * 11.0 + 0.35 * sin(uv.y * Tau * 2.0));
    float hy = pattern < 0.5
        ? sin(uv.y * Tau * 34.0 + 0.18 * sin(uv.x * Tau * 3.0))
        : sin(uv.y * Tau * 5.5 + uv.x * Tau * 2.0);
    return normalize(normal + tangent * (hx * amplitude) + bitangent * (hy * amplitude));
}

ShadingRecord AutomotiveApplyCarbonUvDetail(ShadingRecord M, vec2 uv)
{
    float weave = AutomotiveCarbonWeave(uv);
    M.BaseColor = mix(vec3(0.008, 0.010, 0.013), vec3(0.055, 0.068, 0.082), weave * 0.72);
    M.SpecularRoughness = mix(0.30, 0.18, weave);
    M.SpecularAnisotropy = mix(0.58, 0.88, weave);
    M.CoatRoughness = mix(0.10, 0.055, weave);
    return M;
}

ShadingRecord AutomotiveApplyTireUvDetail(ShadingRecord M, vec2 uv)
{
    float tread = AutomotiveTireTread(uv);
    M.BaseColor = mix(vec3(0.009, 0.010, 0.011), vec3(0.030, 0.034, 0.038), tread);
    M.DiffuseRoughness = mix(0.98, 0.82, tread);
    M.SpecularWeight = mix(0.12, 0.28, tread);
    M.SpecularRoughness = mix(0.88, 0.66, tread);
    return M;
}

// Apply the automotive paint's analytic detail after the material record has been resolved. The caller supplies the
// view direction for the flop term.
//
// ⚠️ M6b — THIS NOW RUNS THE LATTICE, NOT THE SINE FIELD. The preview is where the flake rule was first proven, and
//    it was still running AutomotiveFlakeSignal after the engine had moved on: the paint read as speckle NOISE
//    rather than flakes (a sine field's features have no size, so they alias to salt at any review distance). It
//    now calls the SAME SlateFlakeSample / SlateFlakeNormal the kernel and the CPU mirror call, so there is exactly
//    one flake model in the repository again — which is the property this file exists to guarantee.
//
//    `density` keeps its old meaning (coverage of the lattice's cells), `scale` is now the lattice frequency in
//    cells per metre, and the two new authored properties arrive as arguments: `flakeSize` (radius within the cell)
//    and `colourSpread` (per-flake pigment). The flop term is untouched — it is a view-dependent property of the
//    paint, not of the flakes.
ShadingRecord AutomotiveApplyTriCoatFlakes(ShadingRecord M, vec3 position, vec3 normal, vec3 viewDirection,
                                           vec3 edgeColor, float density, float scale, float jitter,
                                           float flakeSize, float colourSpread)
{
    if (M.Metalness <= 0.0 || M.CoatWeight <= 0.0) return M;
    float mu = clamp(dot(normalize(normal), normalize(viewDirection)), 0.0, 1.0);
    M.BaseColor = AutomotiveFlopColor(M.BaseColor, edgeColor, mu);

    vec4 flake = SlateFlakeSample(position, scale, density, flakeSize, colourSpread);
    if (flake.x <= 0.0) return M;
    // The chip REPLACES the basecoat where it sits (the M6b correction: multiplying a pigment in is what a filter
    // does, and it renders every flake DARKER than the paint around it). A tinted chip carries its own pigment; an
    // untinted one is the bright aluminium the preview always drew, biased toward the edge colour so the tri-coat
    // still reads as a tri-coat.
    vec3 flakeTint = vec3(flake.y, flake.z, flake.w);   // (the CPU shim has no .yzw swizzle on vec4)
    vec3 flakeColor = mix(mix(edgeColor, vec3(1.0), 0.55), flakeTint, colourSpread);
    M.BaseColor = mix(M.BaseColor, flakeColor, flake.x);
    M.SpecularColor = mix(M.SpecularColor, vec3(1.0), flake.x * 0.92);
    M.SpecularRoughness = mix(M.SpecularRoughness, max(0.05, M.SpecularRoughness * 0.30), flake.x);
    M.CoatRoughness = mix(M.CoatRoughness, max(0.012, M.CoatRoughness * 0.45), flake.x * 0.35);
    return M;
}

ShadingRecord AutomotiveTriCoat(vec3 pigment, float roughness, float coatRoughness, float coatIor)
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = pigment;
    M.Metalness = 0.92;
    M.SpecularColor = vec3(0.92, 0.95, 1.0);
    M.SpecularRoughness = roughness;
    M.SpecularWeight = 1.0;
    M.CoatWeight = 1.0;
    M.CoatColor = vec3(0.98, 0.99, 1.0);
    M.CoatRoughness = coatRoughness;
    M.CoatIor = coatIor;
    M.CoatDarkening = 0.9;
    M.Selection = kReflectanceClearCoated;
    return M;
}

ShadingRecord AutomotiveCarbonResin()
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.012, 0.016, 0.020);
    M.Metalness = 0.35;
    M.SpecularColor = vec3(0.72, 0.78, 0.84);
    M.SpecularRoughness = 0.24;
    M.SpecularAnisotropy = 0.72;
    M.AnisotropyAngle = 0.78539816339;
    M.CoatWeight = 1.0;
    M.CoatColor = vec3(0.96, 0.98, 1.0);
    M.CoatRoughness = 0.08;
    M.CoatIor = 1.52;
    M.Selection = kReflectanceClearCoated;
    return M;
}

ShadingRecord AutomotiveClearHeadlight(float ior, float roughness)
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.0);
    M.SpecularIor = ior;
    M.SpecularRoughness = roughness;
    M.TransmissionWeight = 1.0;
    M.TransmissionColor = vec3(0.94, 0.98, 1.0);
    M.TransmissionDepth = 4.0;
    M.TransmissionThickness = 0.22;
    M.Selection = kReflectanceTransmissive;
    return M;
}

ShadingRecord AutomotiveRedTailLens(float ior, float roughness)
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.0);
    M.SpecularIor = ior;
    M.SpecularRoughness = roughness;
    M.TransmissionWeight = 1.0;
    M.TransmissionColor = vec3(0.40, 0.008, 0.004);
    M.TransmissionDepth = 0.70;
    M.TransmissionThickness = 0.16;
    M.Selection = kReflectanceTransmissive;
    return M;
}

ShadingRecord AutomotiveBrushedAlloy(vec3 tint, float roughness, float anisotropy, float angle)
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = tint;
    M.Metalness = 1.0;
    M.SpecularColor = vec3(0.90, 0.93, 0.98);
    M.SpecularRoughness = roughness;
    M.SpecularAnisotropy = anisotropy;
    M.AnisotropyAngle = angle;
    M.Selection = kReflectanceAnisotropic;
    return M;
}

ShadingRecord AutomotiveHeatTitanium(float roughness, float filmThickness)
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.48, 0.52, 0.58);
    M.Metalness = 1.0;
    M.SpecularColor = vec3(0.75, 0.82, 0.92);
    M.SpecularRoughness = roughness;
    M.ThinFilmWeight = 0.78;
    M.ThinFilmThickness = filmThickness;
    M.ThinFilmIor = 1.72;
    M.Selection = kReflectanceStandard;
    return M;
}

ShadingRecord AutomotiveTireRubber()
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.018, 0.020, 0.022);
    M.Metalness = 0.0;
    M.DiffuseRoughness = 0.86;
    M.SpecularWeight = 0.22;
    M.SpecularColor = vec3(0.18, 0.19, 0.20);
    M.SpecularRoughness = 0.78;
    M.Selection = kReflectanceStandard;
    return M;
}

ShadingRecord AutomotiveAlcantara()
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.075, 0.082, 0.090);
    M.DiffuseRoughness = 0.92;
    M.SpecularWeight = 0.08;
    M.SpecularRoughness = 0.72;
    M.FuzzWeight = 0.72;
    M.FuzzColor = vec3(0.16, 0.18, 0.20);
    M.FuzzRoughness = 0.86;
    M.Selection = kReflectanceCloth;
    return M;
}

#endif // FRONTIER_AUTOMOTIVE_MATERIAL_PROFILES
