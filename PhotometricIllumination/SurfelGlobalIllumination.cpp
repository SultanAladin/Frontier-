//============================================================================================================================================
// Frontier/PhotometricIllumination/SurfelGlobalIllumination.cpp — Mesh surfel gather implementation
//============================================================================================================================================
#include "SurfelGlobalIllumination.h"
#include <algorithm>
#include <cmath>

namespace Frontier {

SurfelGlobalIllumination::SurfelGlobalIllumination(uint32_t ExtentWidth, uint32_t ExtentHeight) noexcept
    : Width(ExtentWidth), Height(ExtentHeight)
{
}

void SurfelGlobalIllumination::BuildVisibleSurfels(const VisibilityProjection& Visibility,
                                                    const GeometryStructure& Geometry,
                                                    const MaterialCodec& Codec,
                                                    uint32_t Stride) noexcept
{
    Surfels.clear();
    Stride = std::max(1u, Stride);
    Surfels.reserve((Width / Stride + 1u) * (Height / Stride + 1u));

    for (uint32_t y = 0; y < Height; y += Stride)
    {
        for (uint32_t x = 0; x < Width; x += Stride)
        {
            SurfaceAttributeRecord surface = Codec.DecodePixel(x, y, Visibility, Geometry);
            if (!surface.ValidCondition || surface.SurfaceNormal.LengthSquared() < 1e-6f)
                continue;

            Surfels.push_back(SurfelRecord{
                surface.WorldPosition,
                surface.SurfaceNormal.Normalized(),
                Vector3{ surface.AlbedoColor.x, surface.AlbedoColor.y, surface.AlbedoColor.z },
                Vector3{ 0.0f, 0.0f, 0.0f },
                0.0f,
                true
            });
        }
    }
}

void SurfelGlobalIllumination::Integrate(const VisibilityProjection& Visibility,
                                         const GeometryStructure& Geometry,
                                         const MaterialCodec& Codec,
                                         std::vector<Vector4>& RadianceField,
                                         const SurfelGISettings& Settings,
                                         const SurfelShadowQuery& ShadowQuery) noexcept
{
    if (RadianceField.size() != static_cast<size_t>(Width) * Height)
        return;

    BuildVisibleSurfels(Visibility, Geometry, Codec, Settings.SurfelStride);
    if (Surfels.empty())
        return;

    // Seed the cache with the already computed direct lighting. This makes Surfel GI a
    // secondary-light cache, rather than an extra light model, and keeps ray settings shared.
    for (uint32_t y = 0; y < Height; y += std::max(1u, Settings.SurfelStride))
    {
        for (uint32_t x = 0; x < Width; x += std::max(1u, Settings.SurfelStride))
        {
            SurfaceAttributeRecord surface = Codec.DecodePixel(x, y, Visibility, Geometry);
            if (!surface.ValidCondition) continue;
            const Vector4& direct = RadianceField[static_cast<size_t>(y) * Width + x];
            for (SurfelRecord& surfel : Surfels)
            {
                if ((surfel.Position - surface.WorldPosition).LengthSquared() < 1e-8f)
                {
                    surfel.Irradiance = Vector3{ direct.x, direct.y, direct.z };
                    break;
                }
            }
        }
    }

    const uint32_t bounces = std::max(1u, Settings.BounceCount);
    for (uint32_t bounce = 0; bounce < bounces; ++bounce)
    {
        std::vector<Vector3> next(Surfels.size(), Vector3{});
        for (size_t receiver = 0; receiver < Surfels.size(); ++receiver)
        {
            const SurfelRecord& dst = Surfels[receiver];
            Vector3 gathered{};
            float totalWeight = 0.0f;
            for (size_t source = 0; source < Surfels.size(); ++source)
            {
                if (receiver == source) continue;
                const SurfelRecord& src = Surfels[source];
                Vector3 delta = src.Position - dst.Position;
                float distanceSquared = delta.LengthSquared();
                if (distanceSquared <= 1e-6f || distanceSquared > Settings.GatherRadius * Settings.GatherRadius)
                    continue;
                float distance = std::sqrt(distanceSquared);
                Vector3 direction = delta / distance;
                float receiverCos = std::max(0.0f, OrientationClassifier::DotProduct(dst.Normal, direction));
                float sourceCos = std::max(0.0f, OrientationClassifier::DotProduct(src.Normal, direction * -1.0f));
                if (receiverCos < Settings.NormalThreshold || sourceCos <= 0.0f) continue;
                if (Settings.RayTracedShadows && ShadowQuery &&
                    !ShadowQuery(dst.Position + dst.Normal * 0.002f, src.Position)) continue;

                float weight = receiverCos * sourceCos / (distanceSquared + 0.01f);
                gathered += src.Irradiance * (weight);
                totalWeight += weight;
            }
            if (totalWeight > 0.0f)
                next[receiver] = gathered / totalWeight;
        }
        for (size_t i = 0; i < Surfels.size(); ++i)
            Surfels[i].Irradiance += next[i] * 0.5f; // diffuse albedo transport, damped for stability
    }

    // Reproject cached irradiance onto the existing G-buffer; no SDF lookup is involved.
    for (uint32_t y = 0; y < Height; ++y)
    {
        for (uint32_t x = 0; x < Width; ++x)
        {
            SurfaceAttributeRecord surface = Codec.DecodePixel(x, y, Visibility, Geometry);
            if (!surface.ValidCondition) continue;
            float best = Settings.GatherRadius * Settings.GatherRadius;
            const SurfelRecord* nearest = nullptr;
            for (const SurfelRecord& surfel : Surfels)
            {
                float distance = (surfel.Position - surface.WorldPosition).LengthSquared();
                if (distance < best && OrientationClassifier::DotProduct(surfel.Normal, surface.SurfaceNormal) > 0.0f)
                { best = distance; nearest = &surfel; }
            }
            if (nearest)
            {
                Vector3 indirect = nearest->Irradiance * nearest->Albedo;
                Vector4& pixel = RadianceField[static_cast<size_t>(y) * Width + x];
                pixel.x += indirect.x; pixel.y += indirect.y; pixel.z += indirect.z;
            }
        }
    }
}

} // namespace Frontier
