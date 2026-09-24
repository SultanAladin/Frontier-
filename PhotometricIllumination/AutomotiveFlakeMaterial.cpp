//============================================================================================================================================
// Frontier/PhotometricIllumination/AutomotiveFlakeMaterial.cpp — deterministic multi-colour flake BRDF
//============================================================================================================================================
#include "AutomotiveFlakeMaterial.h"
#include <algorithm>
#include <cmath>

namespace Frontier {
namespace {
float Clamp01(float v) noexcept { return std::clamp(v, 0.0f, 1.0f); }
uint32_t Hash(uint32_t x) noexcept
{
    x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; return x ^ (x >> 16);
}
float Hash01(uint32_t x) noexcept
{
    return static_cast<float>(Hash(x) >> 8) * (1.0f / 16777216.0f);
}
Vector3 ClampColour(Vector3 c) noexcept { return { Clamp01(c.x), Clamp01(c.y), Clamp01(c.z) }; }
Vector3 Fresnel(Vector3 f0, float cosine) noexcept
{
    float t = std::pow(1.0f - Clamp01(cosine), 5.0f);
    return f0 + (Vector3{ 1.0f, 1.0f, 1.0f } - f0) * t;
}
float FresnelDielectric(float cosine, float ior) noexcept
{
    float f0 = std::pow((ior - 1.0f) / (ior + 1.0f), 2.0f);
    return f0 + (1.0f - f0) * std::pow(1.0f - Clamp01(cosine), 5.0f);
}
float Beckmann(const Vector3& half, const Vector3& slope, float alpha) noexcept
{
    if (half.z <= 1e-4f) return 0.0f;
    Vector3 projected{ half.x / half.z - slope.x, half.y / half.z - slope.y, 0.0f };
    float a2 = alpha * alpha;
    return std::exp(-projected.LengthSquared() / a2) / (3.14159265359f * a2 * half.z * half.z * half.z * half.z);
}
float Smith(float cosine, float alpha) noexcept
{
    if (cosine <= 1e-4f) return 0.0f;
    float c2 = cosine * cosine;
    return 2.0f * cosine / (cosine + std::sqrt(alpha * alpha + (1.0f - alpha * alpha) * c2));
}
}

AutomotiveFlakePalette AutomotiveFlakePalette::RGB() noexcept
{
    AutomotiveFlakePalette p{};
    p.Count = 3;
    p.Minimum[0] = { 0.42f, 0.006f, 0.004f }; p.Maximum[0] = { 0.95f, 0.055f, 0.018f };
    p.Minimum[1] = { 0.004f, 0.24f, 0.025f }; p.Maximum[1] = { 0.035f, 0.80f, 0.15f };
    p.Minimum[2] = { 0.003f, 0.025f, 0.35f }; p.Maximum[2] = { 0.025f, 0.18f, 0.95f };
    p.Weight = { 1.0f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
    return p;
}

AutomotiveFlakeSurface AutomotiveFlakeMaterial::Prepare(const FlakeCoordinate& uv,
                                                         const FlakeCoordinate& dx,
                                                         const FlakeCoordinate& dy) const noexcept
{
    AutomotiveFlakeSurface out{};
    const float diameter = std::clamp(Parameters.DiameterMillimetres, 0.02f, 2.0f) * 0.001f;
    const float frequency = 0.72f / diameter;
    const float qx = uv[0] * frequency, qy = uv[1] * frequency;
    const int cellX = static_cast<int>(std::floor(qx)), cellY = static_cast<int>(std::floor(qy));
    const float density = std::clamp(Parameters.Density, 0.0f, 16.0f);
    const float footprint = std::min(10000.0f, std::max(0.0f, std::max(std::hypot(dx[0], dx[1]), std::hypot(dy[0], dy[1])) * frequency));
    const float aa = std::clamp(footprint * 0.6f, 0.0001f, 0.5f);
    constexpr float radius = 0.36f;

    for (uint32_t layer = 0; layer < 16; ++layer)
    {
        const float occupancy = std::clamp(density - static_cast<float>(layer), 0.0f, 1.0f);
        if (occupancy <= 0.0f) break;
        for (int oy = -1; oy <= 1; ++oy) for (int ox = -1; ox <= 1; ++ox)
        {
            uint32_t key = Hash(static_cast<uint32_t>(cellX + ox) ^ Hash(static_cast<uint32_t>(cellY + oy)) ^ Parameters.Seed);
            if (layer != 0) key ^= static_cast<uint32_t>(layer * 0x9e3779b9u);
            const float cx = static_cast<float>(cellX + ox) + Hash01(key + 1u);
            const float cy = static_cast<float>(cellY + oy) + Hash01(key + 2u);
            const float angle = 6.28318530718f * Hash01(key + 3u), c = std::cos(angle), s = std::sin(angle);
            const float lx = qx - cx, ly = qy - cy;
            const float ex = c * lx + s * ly, ey = (-s * lx + c * ly) / 0.65f;
            const float coverage = (Hash01(key) < occupancy) ? (1.0f - Clamp01((std::hypot(ex, ey) - radius + aa) / (2.0f * aa))) : 0.0f;
            if (coverage > out.Weight) { out.Weight = coverage; out.FacetKey = key; }
        }
    }

    out.Colour = ClampColour(Parameters.FlakeReflectance);
    out.MeanColour = out.Colour;
    out.MeanWeight = 1.0f - std::exp(-density * 3.14159265359f * radius * radius * 0.65f);
    out.Unresolved = Clamp01((footprint - 0.35f) / 1.15f);
    const float spread = std::clamp(Parameters.NormalSpread, 0.0f, 0.7f);
    const float radial = spread * std::sqrt(-std::log(std::max(1e-6f, Hash01(out.FacetKey + 4u))));
    const float azimuth = 6.28318530718f * Hash01(out.FacetKey + 5u);
    out.Slope = { radial * std::cos(azimuth), radial * std::sin(azimuth), 0.0f };
    out.Roughness = std::clamp(Parameters.FlakeRoughness, 0.025f, 0.5f);
    out.PopulationRoughness = std::sqrt(out.Roughness * out.Roughness + spread * spread);
    return out;
}

AutomotiveFlakeSurface AutomotiveFlakeMaterial::ApplyPalette(AutomotiveFlakeSurface surface, const AutomotiveFlakePalette& palette) const noexcept
{
    const uint32_t count = std::min(8u, palette.Count);
    float total = 0.0f; Vector3 mean{};
    for (uint32_t i = 0; i < count; ++i) { const float w = std::max(0.0f, palette.Weight[i]); total += w; mean += (palette.Minimum[i] + palette.Maximum[i]) * (0.5f * w); }
    if (total <= 0.0f) return surface;
    surface.MeanColour = mean / total;
    float pick = Hash01(surface.FacetKey + 0xa511e9b3u) * total;
    for (uint32_t i = 0; i < count; ++i)
    {
        pick -= std::max(0.0f, palette.Weight[i]);
        if (pick <= 0.0f) { surface.Colour = palette.Minimum[i] + (palette.Maximum[i] - palette.Minimum[i]) * Hash01(surface.FacetKey + 0x63d83595u); break; }
    }
    return surface;
}

Vector3 AutomotiveFlakeMaterial::Evaluate(const AutomotiveFlakeSurface& surface, const Vector3& view, const Vector3& light) const noexcept
{
    if (view.z <= 1e-4f || light.z <= 1e-4f) return {};
    Vector3 half = (view + light).Normalized();
    float coverage = surface.Weight * (1.0f - surface.Unresolved) + surface.MeanWeight * surface.Unresolved;
    float alpha = std::max(0.025f, surface.Roughness);
    float populationAlpha = std::max(0.025f, surface.PopulationRoughness);
    float masking = Smith(view.z, populationAlpha) * Smith(light.z, populationAlpha);
    Vector3 flakeF = Fresnel(surface.Colour, OrientationClassifier::DotProduct(view, half));
    Vector3 populationF = Fresnel(surface.MeanColour, OrientationClassifier::DotProduct(view, half));
    float flake = Beckmann(half, surface.Slope, alpha);
    float population = Beckmann(half, Vector3{}, populationAlpha);
    Vector3 result = (flakeF * (flake * (1.0f - surface.Unresolved)) + populationF * (population * surface.Unresolved)) * (masking / (4.0f * view.z * light.z));
    result += Parameters.Pigment * ((1.0f - coverage) * 0.31830988618f);

    const float coatWeight = std::clamp(Parameters.ClearcoatWeight, 0.0f, 1.0f);
    const float coatF = FresnelDielectric(OrientationClassifier::DotProduct(view, half), 1.5f);
    const float coatAlpha = std::clamp(Parameters.ClearcoatRoughness, 0.06f, 0.7f);
    const float coat = coatWeight * coatF * Beckmann(half, Vector3{}, coatAlpha) * Smith(view.z, coatAlpha) * Smith(light.z, coatAlpha) / (4.0f * view.z * light.z);
    const Vector3 tint = Vector3{ 1.0f, 1.0f, 1.0f } * (1.0f - Parameters.ClearcoatTintStrength) + ClampColour(Parameters.ClearcoatTint) * Parameters.ClearcoatTintStrength;
    return result * (1.0f - coatWeight * FresnelDielectric(view.z, 1.5f)) * tint + tint * coat;
}

Vector3 AutomotiveFlakeMaterial::Evaluate(const SurfaceAttributeRecord& surface, const FlakeCoordinate& uv, const FlakeCoordinate& dx, const FlakeCoordinate& dy, const Vector3& view, const Vector3& light, const AutomotiveFlakePalette& palette) const noexcept
{
    AutomotiveFlakeSurface flake = ApplyPalette(Prepare(uv, dx, dy), palette);
    return Evaluate(flake, view, light) * Vector3{ surface.AlbedoColor.x, surface.AlbedoColor.y, surface.AlbedoColor.z };
}

} // namespace Frontier
