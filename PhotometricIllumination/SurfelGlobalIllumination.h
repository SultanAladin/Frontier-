//============================================================================================================================================
// Frontier/PhotometricIllumination/SurfelGlobalIllumination.h — Mesh-based Surfel GI
//============================================================================================================================================
#pragma once

#include "../GeometricRaster/MaterialCodec.h"
#include <cstdint>
#include <functional>
#include <vector>

namespace Frontier {

// A compact irradiance cache sample placed on an actual mesh surface. No SDF/voxel field is used.
struct SurfelRecord
{
    Vector3 Position;
    Vector3 Normal;
    Vector3 Albedo;
    Vector3 Irradiance;
    float Radius;
    bool Valid;
};

struct SurfelGISettings
{
    uint32_t SurfelStride = 2;              // denser cache for less blur and fewer holes
    uint32_t BounceCount = 1;               // shared with reflection/path bounce setting
    float GatherRadius = 1.0f;              // world-space interpolation radius
    float NormalThreshold = 0.35f;          // reject back-facing surfels
    uint32_t ReprojectionSamples = 12;      // weighted surfels used per output pixel
    bool RayTracedShadows = true;           // visibility is evaluated against mesh triangles
};

// The callback is deliberately supplied by the renderer: a hardware ray query, a CPU BVH,
// or the project's existing triangle solver can provide the exact same shadow contract.
using SurfelShadowQuery = std::function<bool(const Vector3& Origin, const Vector3& Target)>;

class SurfelGlobalIllumination
{
public:
    SurfelGlobalIllumination(uint32_t Width, uint32_t Height) noexcept;

    void Integrate(const VisibilityProjection& Visibility,
                   const GeometryStructure& Geometry,
                   const MaterialCodec& Codec,
                   std::vector<Vector4>& RadianceField,
                   const SurfelGISettings& Settings,
                   const SurfelShadowQuery& ShadowQuery = {}) noexcept;

    [[nodiscard]] const std::vector<SurfelRecord>& QuerySurfels() const noexcept { return Surfels; }
    [[nodiscard]] size_t QuerySurfelCount() const noexcept { return Surfels.size(); }

private:
    void BuildVisibleSurfels(const VisibilityProjection&, const GeometryStructure&, const MaterialCodec&, uint32_t Stride) noexcept;
    uint32_t Width;
    uint32_t Height;
    std::vector<SurfelRecord> Surfels;
};

} // namespace Frontier
