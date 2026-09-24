//============================================================================================================================================
// Frontier/PhotometricIllumination/AutomotiveFlakeMaterial.h — ReSTIR-compatible automotive flake BRDF
//============================================================================================================================================
#pragma once

#include "../DeviceExchange/OrientationClassifier.h"
#include "../GeometricRaster/MaterialCodec.h"
#include <array>
#include <cstdint>

namespace Frontier {

using FlakeCoordinate = std::array<float, 2>;

struct AutomotiveFlakePalette
{
    uint32_t Count = 0;
    std::array<Vector3, 8> Minimum{};
    std::array<Vector3, 8> Maximum{};
    std::array<float, 8> Weight{};

    [[nodiscard]] static AutomotiveFlakePalette RGB() noexcept;
};

struct AutomotiveFlakeParameters
{
    Vector3 Pigment{ 0.014f, 0.045f, 0.13f };
    Vector3 FlakeReflectance{ 0.72f, 0.77f, 0.82f };
    float Density = 0.8f;              // expected flakes per cell, [0, 16]
    float DiameterMillimetres = 0.35f;
    float NormalSpread = 0.24f;
    float FlakeRoughness = 0.065f;
    float ClearcoatRoughness = 0.23f;
    float ClearcoatWeight = 1.0f;
    Vector3 ClearcoatTint{ 1.0f, 1.0f, 1.0f };
    float ClearcoatTintStrength = 0.0f;
    float PearlWeight = 0.0f;
    float FilmThicknessNanometres = 420.0f;
    float FilmIor = 1.48f;
    uint32_t Seed = 17u;
};

struct AutomotiveFlakeSurface
{
    uint32_t FacetKey = 0;
    Vector3 Colour{ 0.72f, 0.77f, 0.82f };
    Vector3 MeanColour{ 0.72f, 0.77f, 0.82f };
    Vector3 Slope{};
    float Weight = 0.0f;
    float MeanWeight = 0.0f;
    float Unresolved = 0.0f;
    float Roughness = 0.065f;
    float PopulationRoughness = 0.24f;
};

class AutomotiveFlakeMaterial
{
public:
    AutomotiveFlakeMaterial() noexcept = default;
    explicit AutomotiveFlakeMaterial(AutomotiveFlakeParameters Parameters) noexcept : Parameters(Parameters) {}

    [[nodiscard]] AutomotiveFlakeSurface Prepare(const FlakeCoordinate& MaterialMetres,
                                                  const FlakeCoordinate& DerivativeX,
                                                  const FlakeCoordinate& DerivativeY) const noexcept;
    [[nodiscard]] AutomotiveFlakeSurface ApplyPalette(AutomotiveFlakeSurface Surface,
                                                       const AutomotiveFlakePalette& Palette) const noexcept;
    [[nodiscard]] Vector3 Evaluate(const AutomotiveFlakeSurface& Surface,
                                   const Vector3& ViewDirection,
                                   const Vector3& LightDirection) const noexcept;
    [[nodiscard]] Vector3 Evaluate(const SurfaceAttributeRecord& Surface,
                                   const FlakeCoordinate& MaterialMetres,
                                   const FlakeCoordinate& DerivativeX,
                                   const FlakeCoordinate& DerivativeY,
                                   const Vector3& ViewDirection,
                                   const Vector3& LightDirection,
                                   const AutomotiveFlakePalette& Palette = AutomotiveFlakePalette{}) const noexcept;

    [[nodiscard]] AutomotiveFlakeParameters& AccessParameters() noexcept { return Parameters; }
    [[nodiscard]] const AutomotiveFlakeParameters& QueryParameters() const noexcept { return Parameters; }

private:
    AutomotiveFlakeParameters Parameters;
};

} // namespace Frontier
