//============================================================================================================================================
//                                                         VEHICLESTRUCTURE.CPP
//============================================================================================================================================
// 📦 Authors the same ControlVehicle numeric archives and closed wheel topology for shared native rendering and glTF opening.

#include "VehicleStructure.h"
#include "AutomotiveShowcasePresets.h"
#include "../GeometricRaster/WheelProjection.h"
#include "../../EngineContent/GeometryArchives/ControlVehicleStructure.inl"
#include "../../EngineContent/GeometryArchives/ControlWheelStructure.inl"

#include <algorithm>
#include <cstring>

namespace Frontier
{

void VehicleStructure::AppendFacet(const Vector3& Alpha, const Vector3& Beta, const Vector3& Gamma, uint32_t Material)
{
    TriangleIndex Facet{};
    Facet.VertexAlphaX = Alpha.x; Facet.VertexAlphaY = Alpha.y; Facet.VertexAlphaZ = Alpha.z;
    Facet.VertexBetaX  = Beta.x;  Facet.VertexBetaY  = Beta.y;  Facet.VertexBetaZ  = Beta.z;
    Facet.VertexGammaX = Gamma.x; Facet.VertexGammaY = Gamma.y; Facet.VertexGammaZ = Gamma.z;
    std::memcpy(&Facet.MaterialSlot, &Material, sizeof(Material));
    Facet.TextureBetaU  = 1.0f;
    Facet.TextureGammaV = 1.0f;
    Triangles.push_back(Facet);
}

void VehicleStructure::BeginSpan(const char* Name, bool Dynamic)
{
    TriangleSpanRecord Span;
    Span.Name          = Name;
    Span.Dynamic       = Dynamic;
    Span.FirstTriangle = static_cast<uint32_t>(Triangles.size());
    Spans.push_back(std::move(Span));
}

void VehicleStructure::FinishSpan()
{
    Spans.back().TriangleCount = static_cast<uint32_t>(Triangles.size()) - Spans.back().FirstTriangle;
}

void VehicleStructure::Construct()
{
    Triangles.clear(); Materials.clear(); Spans.clear();
    const float Palette[16][3] =
    {
        {0.38f, 0.40f, 0.43f}, {0.15f, 0.17f, 0.20f}, {0.35f, 0.36f, 0.38f}, {0.42f, 0.43f, 0.45f},
        {0.90f, 0.72f, 0.08f}, {0.95f, 0.35f, 0.05f}, {0.680005f, 0.800458f, 0.0f}, {0.025f, 0.035f, 0.045f},
        {0.012f, 0.014f, 0.018f}, {0.03741f, 0.03741f, 0.03741f}, {0.06f, 0.22f, 0.62f}, {0.30f, 0.075f, 0.025f},
        {0.8f, 0.8f, 0.8f}, {0.8f, 0.8f, 0.8f}, {0.7541f, 0.01f, 0.02f}, {0.8f, 0.8f, 0.8f},
    };
    const char* Names[] =
    {
        "Pad light", "Pad dark", "Surround", "Ramp", "Bump", "Cone", "MetalicCoat", "Glass", "Plastic",
        "StandardRubber", "Material.024", "Brake", "Plastic2", "FrontLight", "RearLight", "Material.016",
    };
    for (uint32_t Material = 0u; Material < 16u; ++Material)
    {
        MaterialDescriptor Description;
        Description.Name = Names[Material];
        Description.Slabs.emplace_back();
        auto& Slab = Description.Slabs.back();
        if (Material == 6u)
        {
            AuthorAutomotiveShowcase(Slab, 4u, 0.5f);
            Slab.BaseMetalness = 0.0f;
            Slab.CoatRoughness = 0.03f;
        }
        std::copy_n(Palette[Material], 3u, Slab.BaseColor);
        Slab.SpecularRoughness = Material == 9u ? 0.76087f : 0.5f;
        if (Material == 7u)
        {
            Slab.TransmissionWeight = 1.0f;
            Slab.SpecularIor        = 1.52f;
            Slab.SpecularRoughness  = 0.02f;
            Slab.TransmissionDepth = 0.006f;
            Slab.TransmissionColor[0] = 0.26f;
            Slab.TransmissionColor[1] = 0.28f;
            Slab.TransmissionColor[2] = 0.30f;
        }
        if (Material == 10u) Slab.BaseMetalness = 1.0f;
        Materials.push_back(std::move(Description));
    }
    BeginSpan("ProjectZero proving ground", false);
    for (int32_t Row = -20; Row < 20; ++Row)
        for (int32_t Column = -20; Column < 20; ++Column)
        {
            const Vector3 Alpha{Column * 4.0f, Row * 4.0f, 0.0f};
            const Vector3 Beta{Alpha.x + 4.0f, Alpha.y, 0.0f};
            const Vector3 Gamma{Alpha.x + 4.0f, Alpha.y + 4.0f, 0.0f};
            const Vector3 Delta{Alpha.x, Alpha.y + 4.0f, 0.0f};
            const uint32_t Material = static_cast<uint32_t>((Row + Column) & 1);
            AppendFacet(Alpha, Beta, Gamma, Material);
            AppendFacet(Alpha, Gamma, Delta, Material);
        }
    FinishSpan();
    const Vehicle::VehicleGeometry Dimensions;
    const float Height = Dimensions.CoMHeight + 0.02f;
    namespace Authored = Vehicle::ControlVehicle;
    BeginSpan("ControlVehicle — paint / glass / plastic", true);
    const auto BodyPoint = [&](uint32_t Index)
    {
        const float* Position = Authored::kPositions + Index * 3u;
        return Vector3{Position[0], Position[1], Position[2] - Dimensions.CoMModelZ() + Height};
    };
    for (uint32_t Facet = 0u; Facet < Authored::kTriangleCount; ++Facet)
        AppendFacet(BodyPoint(Authored::kTriangles[Facet * 3u]), BodyPoint(Authored::kTriangles[Facet * 3u + 1u]),
                    BodyPoint(Authored::kTriangles[Facet * 3u + 2u]), Authored::kTriangleFamily[Facet]);
    FinishSpan();
    const char* WheelNames[] = {"XPBD Tyre FL", "XPBD Tyre FR", "XPBD Tyre RL", "XPBD Tyre RR"};
    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
    {
        BeginSpan(WheelNames[Wheel], true);
        auto Centre = Dimensions.AxleMountLocal(Wheel);
        Centre.z += Height;
        Vehicle::WheelTreadLattice Tread;
        Tread.RingCount    = Vehicle::kDriveWheelRingCount;
        Tread.SegmentCount = Vehicle::kDriveWheelSegmentCount;
        Tread.SpokeCount   = 0u;
        Tread.RimRadius    = Dimensions.TyreRimRadius;
        Tread.HalfWidth    = Dimensions.TyreWidth * 0.5f;
        std::vector<float> Samples(Tread.RingCount * Tread.SegmentCount * 3u);
        Vehicle::FillRestTreadLattice(Samples.data(), Tread.RingCount, Tread.SegmentCount, Dimensions.TyreRadius, Tread.HalfWidth);
        Tread.Tread = Samples.data();
        const auto Point = [&](const float* Position)
        {
            return Vector3{Centre.x + Position[0], Centre.y + Position[1], Centre.z + Position[2]};
        };
        Vehicle::EmitWheelSurface(Tread, 9u, 10u, 11u,
            [&](const float* Alpha, const float* Beta, const float* Gamma,
                const float*, const float*, const float*, uint32_t Material)
            {
                AppendFacet(Point(Alpha), Point(Beta), Point(Gamma), Material);
            });
        namespace Rim = Vehicle::ControlWheel;
        const float Scale = Dimensions.TyreRimRadius / Rim::kRimRadius;
        const auto RimPoint = [&](uint32_t Index)
        {
            const float* Position = Rim::kPositions + Index * 3u;
            return Vector3{Centre.x + Position[0] * Scale, Centre.y + Position[1] * Scale, Centre.z + Position[2] * Scale};
        };
        for (uint32_t Facet = 0u; Facet < Rim::kTriangleCount; ++Facet)
            AppendFacet(RimPoint(Rim::kTriangles[Facet * 3u]), RimPoint(Rim::kTriangles[Facet * 3u + 1u]),
                        RimPoint(Rim::kTriangles[Facet * 3u + 2u]), Rim::kTriangleFamily[Facet]);
        FinishSpan();
    }
}

bool VehicleStructure::Export(const std::string& Location, std::string& Refusal) const
{
    SceneEncodeConfiguration Specification;
    Specification.Name  = "ProjectZero ControlVehicle";
    Specification.Spans = &Spans;
    return SceneCodec::Encode(Location, Triangles, Materials, &Refusal, Specification);
}

} // namespace Frontier
