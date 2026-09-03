//============================================================================================================================================
//                                                     RESTIRINTEGRATOR.CPP
//============================================================================================================================================
// 🧩 Accumulates ReSTIR DI+GI radiance by numerically integrating light transport paths on the GPU compute pipeline.

#include "ReSTIRIntegrator.h"
#include <cmath>

namespace Frontier {

//============================================================================================================================================
//                                                     LIFECYCLE
//============================================================================================================================================

ReSTIRIntegrator::ReSTIRIntegrator(ReSTIRIntegratorConfiguration InitialConfiguration) noexcept
    : ActiveConfiguration(InitialConfiguration)
    , AccumulationIndex(0u)
    , HistoryOrigin{ 0.0f, 0.0f, 0.0f }
    , HistoryForward{ 0.0f, 0.0f, 0.0f }
    , HistoryWidth(0u)
    , HistoryHeight(0u)
{
}

//============================================================================================================================================
//                                                OBSERVE CAMERA
//============================================================================================================================================

void ReSTIRIntegrator::ObserveCamera(const ProjectZero::FlyThroughSolver& Camera,
                                     uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept
{
    const Vector3& Origin  = Camera.QuerySpatialLocation();
    const Vector3& Forward = Camera.QueryForwardVector();

    constexpr float PositionTolerance  = 1e-5f;   // [m]
    constexpr float DirectionTolerance = 1e-6f;   // [-]

    const Vector3 OriginDelta  = Origin  - HistoryOrigin;
    const Vector3 ForwardDelta = Forward - HistoryForward;

    const bool Moved   = OriginDelta.LengthSquared()  > PositionTolerance  * PositionTolerance;
    const bool Turned  = ForwardDelta.LengthSquared() > DirectionTolerance * DirectionTolerance;
    const bool Resized = ViewportWidth != HistoryWidth || ViewportHeight != HistoryHeight;

    if (Moved || Turned || Resized)
    {
        HistoryOrigin  = Origin;
        HistoryForward = Forward;
        HistoryWidth   = ViewportWidth;
        HistoryHeight  = ViewportHeight;
        ResetAccumulation();
    }
}

//============================================================================================================================================
//                                                  BUILD DISPATCH
//============================================================================================================================================

DispatchConfiguration ReSTIRIntegrator::BuildDispatch(
    const ProjectZero::FlyThroughSolver& Camera,
    uint32_t                             ViewportWidth,
    uint32_t                             ViewportHeight,
    uint32_t                             TriangleCount,
    uint32_t                             LuminaireTriangleCount) const noexcept
{
    const Vector3& Origin  = Camera.QuerySpatialLocation();
    const Vector3& Forward = Camera.QueryForwardVector();
    const Vector3& Right   = Camera.QueryRightVector();
    const Vector3& Up      = Camera.QueryUpwardVector();

    const float TanHalf = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);

    DispatchConfiguration Dispatch{};
    Dispatch.CameraOriginX         = Origin.x;
    Dispatch.CameraOriginY         = Origin.y;
    Dispatch.CameraOriginZ         = Origin.z;
    Dispatch.FieldOfViewTanHalf    = TanHalf;
    Dispatch.CameraForwardX        = Forward.x;
    Dispatch.CameraForwardY        = Forward.y;
    Dispatch.CameraForwardZ        = Forward.z;
    Dispatch.AspectRatio           = Camera.QueryAspectRatio();
    Dispatch.CameraRightX          = Right.x;
    Dispatch.CameraRightY          = Right.y;
    Dispatch.CameraRightZ          = Right.z;
    Dispatch.Exposure              = ActiveConfiguration.Exposure;
    Dispatch.CameraUpX             = Up.x;
    Dispatch.CameraUpY             = Up.y;
    Dispatch.CameraUpZ             = Up.z;
    Dispatch.AmbientStrength       = ActiveConfiguration.AmbientStrength;
    Dispatch.ViewportWidth         = ViewportWidth;
    Dispatch.ViewportHeight        = ViewportHeight;
    Dispatch.AccumulationIndex     = AccumulationIndex;
    Dispatch.SpatialPassCount      = ActiveConfiguration.SpatialPassCount;
    Dispatch.CandidatesPerPixel    = ActiveConfiguration.CandidatesPerPixel;
    Dispatch.TriangleCount         = TriangleCount;
    Dispatch.LuminaireTriangleCount = LuminaireTriangleCount;
    Dispatch.FeatureFlags          = (ActiveConfiguration.GlobalIllumination ? DispatchFeatureGlobalIllumination : 0u)
                                   | (ActiveConfiguration.AntiAliasing       ? DispatchFeatureAntiAliasing       : 0u);

    return Dispatch;
}

//============================================================================================================================================
//                                               SCENE RECORD BUILDERS
//============================================================================================================================================

uint32_t ReSTIRIntegrator::CountLuminaireTriangles(const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Triangles = Scene.QueryTriangles();
    const auto& Materials = Scene.QueryMaterials();

    uint32_t Count = 0u;
    for (const auto& Triangle : Triangles)
    {
        if (Triangle.MaterialIndex < Materials.size())
        {
            const auto& Material = Materials[Triangle.MaterialIndex];
            const float EmissiveMagnitude = Material.EmissiveRadiance.x
                                          + Material.EmissiveRadiance.y
                                          + Material.EmissiveRadiance.z;
            if (EmissiveMagnitude > 0.0f) ++Count;
        }
    }
    return Count;
}

std::vector<TriangleIndex> ReSTIRIntegrator::BuildTriangleIndex(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Triangles = Scene.QueryTriangles();

    std::vector<TriangleIndex> Records;
    Records.reserve(Triangles.size());

    for (const auto& Triangle : Triangles)
    {
        TriangleIndex Record{};
        Record.VertexAlphaX  = Triangle.VertexAlpha.x;
        Record.VertexAlphaY  = Triangle.VertexAlpha.y;
        Record.VertexAlphaZ  = Triangle.VertexAlpha.z;
        Record.MaterialSlot  = *reinterpret_cast<const float*>(&Triangle.MaterialIndex);
        Record.VertexBetaX   = Triangle.VertexBeta.x;
        Record.VertexBetaY   = Triangle.VertexBeta.y;
        Record.VertexBetaZ   = Triangle.VertexBeta.z;
        Record.TriangleSlot  = *reinterpret_cast<const float*>(&Triangle.TriangleIndex);
        Record.VertexGammaX  = Triangle.VertexGamma.x;
        Record.VertexGammaY  = Triangle.VertexGamma.y;
        Record.VertexGammaZ  = Triangle.VertexGamma.z;
        Record._PadGamma     = 0.0f;
        Record.NormalX       = Triangle.SurfaceNormal.x;
        Record.NormalY       = Triangle.SurfaceNormal.y;
        Record.NormalZ       = Triangle.SurfaceNormal.z;
        Record._PadNormal    = 0.0f;
        Records.push_back(Record);
    }
    return Records;
}

std::vector<RadianceStructure> ReSTIRIntegrator::BuildRadianceStructures(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Materials = Scene.QueryMaterials();

    std::vector<RadianceStructure> Records;
    Records.reserve(Materials.size());

    for (const auto& Material : Materials)
    {
        RadianceStructure Record{};
        Record.AlbedoR    = Material.AlbedoColor.x;
        Record.AlbedoG    = Material.AlbedoColor.y;
        Record.AlbedoB    = Material.AlbedoColor.z;
        Record.Roughness  = Material.RoughnessValue;
        Record.EmissiveR  = Material.EmissiveRadiance.x;
        Record.EmissiveG  = Material.EmissiveRadiance.y;
        Record.EmissiveB  = Material.EmissiveRadiance.z;
        Record.Metallic   = Material.MetallicValue;
        Record.Identifier = Material.MaterialIdentifier;
        Record._Pad0 = Record._Pad1 = Record._Pad2 = 0.0f;
        Records.push_back(Record);
    }
    return Records;
}

} // namespace Frontier
