//============================================================================================================================================
//                                          AUTOMOTIVE MATERIAL PROFILES
//============================================================================================================================================
// Shared authoring profiles for the standalone automotive material scene. These are deliberately built out of the
// same ShadingRecord fields consumed by MaterialEvaluation.slang: the CPU exhibit and the GPU include see the exact
// same profile bytes and the exact same OpenPBR lobe evaluator. They are not wired into Project-Zero's material
// records yet; the preview scene is the review gate before that integration.
//
// Current preview milestone: clearcoat paint, carbon/resin, red/clear optics, brushed alloy, heat-tinted titanium,
// rubber, and Alcantara. Procedural glint flakes, UV texture sampling, water, and automotive host serialization remain
// later milestones. The functions below are intentionally texture-free so a CPU render can be compared bit-for-bit
// against the same constants on the GPU.

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

// Deterministic, texture-free microflake signal. Two incommensurate bands avoid a visible grid while remaining
// identical in the CPU port and the GPU shader. The signal is deliberately a material-detail term, not a light
// source: it only modulates the shared coat/base lobes.
float AutomotiveFlakeSignal(vec3 position, vec3 normal, float density, float scale, float jitter)
{
    float h0 = abs(float(sin(dot(position, vec3(12.9898, 78.233, 37.719)) * scale + jitter * 17.17)));
    float h1 = abs(float(sin(dot(position, vec3(39.3468, 11.135, 83.155)) * (scale * 1.731) + jitter * 29.31)));
    float sparkle = smoothstep(1.0 - density, 1.0 - density + 0.08, h0)
                  * smoothstep(1.0 - density * 0.72, 1.0 - density * 0.72 + 0.10, h1);
    float grazing = 1.0 - clamp(dot(normalize(normal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    return clamp(sparkle * (0.65 + 0.35 * grazing), 0.0, 1.0);
}

// Apply the automotive paint's analytic detail after the material record has been resolved. The caller supplies the
// view direction for the flop term. A later host integration can replace position with UV-backed flakes while keeping
// this exact fallback and the same lobe fields.
ShadingRecord AutomotiveApplyTriCoatFlakes(ShadingRecord M, vec3 position, vec3 normal, vec3 viewDirection,
                                           vec3 edgeColor, float density, float scale, float jitter)
{
    if (M.Metalness <= 0.0 || M.CoatWeight <= 0.0) return M;
    float mu = clamp(dot(normalize(normal), normalize(viewDirection)), 0.0, 1.0);
    M.BaseColor = AutomotiveFlopColor(M.BaseColor, edgeColor, mu);
    float signal = AutomotiveFlakeSignal(position, normal, density, scale, jitter);
    // The flake is a bright microfacet population, not an emissive decal: it raises the shared metallic F82 tint and
    // locally narrows the roughness so a direct-light sample produces a visible sparkle at finite preview spp.
    M.BaseColor = M.BaseColor + signal * vec3(0.58, 0.62, 0.78);
    M.SpecularColor = mix(M.SpecularColor, vec3(1.0), signal * 0.86);
    M.SpecularRoughness = mix(M.SpecularRoughness, max(0.018, M.SpecularRoughness * 0.28), signal * 0.86);
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
