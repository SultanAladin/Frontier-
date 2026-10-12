//============================================================================================================================================
//                                                       DRIVERENDERPROOF.CPP
//============================================================================================================================================
// 📦 Fresh Drive CPU raster and mesh-local SDF transport reference. Not a Vulkan screenshot or an appearance parity claim.

#include "../../../Engine/ContentInterchange/UnifiedMaterialEvaluation.h"
#include "../../../Engine/DisplayPresentation/ShadingTableCodec.h"
#include "../../../Engine/ContentInterchange/PngWriteCounterpart.h"
#include "../../../Engine/GeometricRaster/SceneStructure.h"
#include "../../../Engine/GeometricRaster/VisibilityRaster.h"
#include "../../../Engine/GeometricRaster/DistanceFieldStructure.h"
#include "../../../Projects/Project-Drive/Source/DriveSceneAuthor.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <limits>
#include <string>
#include <thread>
#include <vector>

namespace
{

using V = Frontier::Vehicle::Vec3;
constexpr float π = 3.14159265359f;
constexpr uint32_t Width = 512u;
constexpr uint32_t Height = 512u;

V From(const float* Point) { return {Point[0], Point[1], Point[2]}; }
V Transform(const float* Rows, V Point)
{
    return {Rows[0] * Point.x + Rows[4] * Point.y + Rows[8] * Point.z + Rows[12],
            Rows[1] * Point.x + Rows[5] * Point.y + Rows[9] * Point.z + Rows[13],
            Rows[2] * Point.x + Rows[6] * Point.y + Rows[10] * Point.z + Rows[14]};
}

struct FieldReading
{
    float Distance = 1.0e20f;
    float Tolerance = 0.002f;
    uint32_t Facet = UINT32_MAX;
};

FieldReading ReadFields(const Frontier::DistanceFieldStructure& Fields, V Position)
{
    FieldReading Reading;
    for (const auto& Placement : Fields.QueryPlacements())
    {
        const V Local = Transform(Placement.WorldToLocal, Position);
        const float Coordinates[3] = {Local.x, Local.y, Local.z};
        float OutsideSquared = 0.0f;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const float Outside = std::max({Placement.Minimum[Axis] - Coordinates[Axis],
                                             Coordinates[Axis] - Placement.Maximum[Axis], 0.0f});
            OutsideSquared += Outside * Outside;
        }
        if (OutsideSquared > 0.0f)
        {
            const float Distance = std::sqrt(OutsideSquared) * Placement.Minimum[3];
            if (Distance < Reading.Distance) Reading = {Distance, Placement.Maximum[3], UINT32_MAX};
            continue;
        }
        uint32_t Lower[3];
        float Fraction[3];
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const float Coordinate = (Coordinates[Axis] - Placement.Minimum[Axis]) /
                (Placement.Maximum[Axis] - Placement.Minimum[Axis]) * (Placement.Resolution[Axis] - 1u);
            Lower[Axis] = std::min(static_cast<uint32_t>(std::max(0.0f, Coordinate)), Placement.Resolution[Axis] - 2u);
            Fraction[Axis] = Coordinate - Lower[Axis];
        }
        float SignedDistance = 0.0f, NearestWeight = -1.0f;
        uint32_t NearestFacet = 0u;
        for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
        {
            uint32_t At[3];
            float Weight = 1.0f;
            for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
            {
                const bool Upper = (Corner & (1u << Axis)) != 0u;
                At[Axis] = Lower[Axis] + (Upper ? 1u : 0u);
                Weight *= Upper ? Fraction[Axis] : 1.0f - Fraction[Axis];
            }
            const auto& Sample = Fields.QuerySamples()[Placement.Resolution[3] +
                (At[2] * Placement.Resolution[1] + At[1]) * Placement.Resolution[0] + At[0]];
            SignedDistance += Sample.Distance * Weight;
            if (Weight > NearestWeight) { NearestWeight = Weight; NearestFacet = Sample.Facet; }
        }
        const float Distance = std::abs(SignedDistance) * Placement.Minimum[3];
        if (Distance < Reading.Distance)
            Reading = {Distance, Placement.Maximum[3], Placement.Identity[1] + std::min(NearestFacet, Placement.Identity[2] - 1u)};
    }
    return Reading;
}

uint32_t TraceFields(const Frontier::DistanceFieldStructure& Fields, V Origin, V Direction)
{
    float Travel = 0.002f;
    for (uint32_t Step = 0u; Step < 32u && Travel < 20.0f; ++Step)
    {
        const auto Reading = ReadFields(Fields, Origin + Direction * Travel);
        if (Reading.Distance > 1.0e19f) break;
        if (Reading.Facet != UINT32_MAX && Reading.Distance < Reading.Tolerance) return Reading.Facet;
        Travel += std::max(Reading.Distance * 0.75f, Reading.Tolerance * 1.5f);
    }
    return UINT32_MAX;
}

void ConstructScene(Frontier::SceneStructure& Scene, const Frontier::Drive::DriveSceneAuthor& Author)
{
    for (const auto& Material : Author.QueryMaterials()) Scene.RegisterMaterial(Material);
    for (const auto& Span : Author.QuerySpans())
        for (uint32_t Material = 0u; Material < Author.QueryMaterials().size(); ++Material)
        {
            Frontier::GeometryStructure Geometry;
            std::vector<Frontier::VertexRecord> Vertices;
            std::vector<uint32_t> Indices;
            for (uint32_t Index = Span.FirstTriangle; Index < Span.FirstTriangle + Span.TriangleCount; ++Index)
            {
                const auto& Triangle = Author.QueryTriangles()[Index];
                uint32_t Slot;
                std::memcpy(&Slot, &Triangle.MaterialSlot, sizeof(Slot));
                if (Slot != Material) continue;
                const float* Points[3] = {&Triangle.VertexAlphaX, &Triangle.VertexBetaX, &Triangle.VertexGammaX};
                for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
                {
                    Frontier::VertexRecord Vertex{};
                    Vertex.SpatialLocation = {Points[Corner][0], Points[Corner][1], Points[Corner][2]};
                    Vertex.NormalDirection = Author.QueryCornerNormals()[Index * 3u + Corner];
                    const float TextureU[3] = {Triangle.TextureAlphaU, Triangle.TextureBetaU, Triangle.TextureGammaU};
                    const float TextureV[3] = {Triangle.TextureAlphaV, Triangle.TextureBetaV, Triangle.TextureGammaV};
                    Vertex.TextureCoordinateU = TextureU[Corner];
                    Vertex.TextureCoordinateV = TextureV[Corner];
                    Vertex.TangentDirection = {1.0f, 0.0f, 0.0f, 1.0f};
                    Vertices.push_back(Vertex);
                    Indices.push_back(static_cast<uint32_t>(Indices.size()));
                }
            }
            if (Vertices.empty()) continue;
            Geometry.AppendVertices(Vertices.data(), Vertices.size());
            Geometry.AppendIndices(Indices.data(), Indices.size());
            Frontier::Matrix4x4 World{};
            for (uint32_t Axis = 0u; Axis < 4u; ++Axis) World.Columns[Axis][Axis] = 1.0f;
            Scene.RegisterInstance(Geometry, World, Material, Frontier::InstanceFlagDoubleSided);
        }
    Scene.Finalise();
}

void RenderView(
    const std::filesystem::path&       Folder,
    Frontier::SceneStructure&          Scene,
    Frontier::DistanceFieldStructure&  Fields,
    float                             Degrees,
    const std::string&                Name)
{
    const float θ = Degrees * π / 180.0f;
    const V Eye{-6.4f * std::cos(θ) + 5.4f * std::sin(θ),
                 -6.4f * std::sin(θ) - 5.4f * std::cos(θ), 2.2f};
    const V Forward = (V{0.0f, 0.0f, 0.7f} - Eye).Normalized();
    const V Right = Frontier::Vehicle::Cross(Forward, {0.0f, 0.0f, 1.0f}).Normalized();
    const V Up = Frontier::Vehicle::Cross(Right, Forward).Normalized();
    const float E[3] = {Eye.x, Eye.y, Eye.z}, F[3] = {Forward.x, Forward.y, Forward.z};
    const float R[3] = {Right.x, Right.y, Right.z}, U[3] = {Up.x, Up.y, Up.z};
    Frontier::VisibilityRaster Raster;
    Frontier::VisibilityRaster::CelestialSettings Sky;
    Sky.Enabled = true;
    const V Sun = V{-0.3f, -0.4f, 0.85f}.Normalized();
    Sky.Light.Direction[0] = Sun.x; Sky.Light.Direction[1] = Sun.y; Sky.Light.Direction[2] = Sun.z;
    Sky.Light.Intensity = 22.0f;
    Raster.AssignCelestial(Sky);
    std::vector<unsigned char> Pixels(Width * Height * 4u);
    double Luminance = 0.0;
    assert(Raster.Render(Scene, E, F, R, U, 46.0f * π / 180.0f, Width, Height, Pixels.data(), Luminance));
    assert(PngWriteCounterpart::WritePng((Folder / (Name + "-raster.png")).string().c_str(), Width, Height, 4, Pixels.data(), Width * 4u));
    const auto& Visibility = Raster.QueryVisibility();
    const auto& Barycentrics = Raster.QueryBarycentrics();
    const auto& Linear = Raster.QueryLinearRadiance();
    const auto& Triangles = Scene.QueryFlatTriangles();
    const auto& Materials = Scene.QueryMaterials().QueryRecords();
    const uint64_t Revision = Fields.QueryRevision();
    const auto* Samples = Fields.QuerySamples().data();
    // 📝 Reference-only one-bounce diffuse transport: the same persistent samples and bounded SDF march, not GPU cards.
    //     Secondary radiance uses analytical diffuse sun/sky/emission. It does not reproduce Vulkan card capture,
    //     radiance scheduling, half-resolution gather, shadow taps, temporal denoising or exact GPU appearance.
    uint64_t TotalHits = 0u;
    std::vector<uint64_t> Hits(8u);
    std::vector<std::thread> Workers;
    for (uint32_t Worker = 0u; Worker < 8u; ++Worker)
        Workers.emplace_back([&, Worker]
        {
            for (size_t Pixel = Worker; Pixel < Visibility.size(); Pixel += 8u)
            {
                if (Visibility[Pixel] == Frontier::VisibilityRaster::kMiss) continue;
                const auto& Triangle = Triangles[Visibility[Pixel]];
                const V A{Triangle.VertexAlphaX, Triangle.VertexAlphaY, Triangle.VertexAlphaZ};
                const V B{Triangle.VertexBetaX, Triangle.VertexBetaY, Triangle.VertexBetaZ};
                const V C{Triangle.VertexGammaX, Triangle.VertexGammaY, Triangle.VertexGammaZ};
                const float Wa = Barycentrics[Pixel * 2u], Wb = Barycentrics[Pixel * 2u + 1u];
                const V Position = A * Wa + B * Wb + C * (1.0f - Wa - Wb);
                V Normal = Frontier::Vehicle::Cross(B - A, C - A).Normalized();
                if (Frontier::Vehicle::Dot(Normal, Eye - Position) < 0.0f) Normal = Normal * -1.0f;
                const V Tangent = Frontier::Vehicle::Cross(Normal, std::abs(Normal.z) < 0.9f ? V{0.0f, 0.0f, 1.0f} : V{0.0f, 1.0f, 0.0f}).Normalized();
                const V Bitangent = Frontier::Vehicle::Cross(Normal, Tangent);
                uint32_t MaterialSlot;
                std::memcpy(&MaterialSlot, &Triangle.MaterialSlot, sizeof(MaterialSlot));
                const auto& Material = Materials[MaterialSlot];
                const auto Receiver = ReadFields(Fields, Position);
                V Indirect;
                constexpr uint32_t SampleCount = 8u;
                for (uint32_t Sample = 0u; Sample < SampleCount; ++Sample)
                {
                    const float Height = (Sample + 0.5f) / SampleCount;
                    const float Phase = 2.0f * π * std::fmod(Sample * 0.61803398875f + (Pixel % 17u) / 17.0f, 1.0f);
                    const V Direction = Tangent * (std::cos(Phase) * std::sqrt(1.0f - Height))
                                      + Bitangent * (std::sin(Phase) * std::sqrt(1.0f - Height)) + Normal * std::sqrt(Height);
                    const auto Facet = TraceFields(Fields, Position + Normal * std::max(0.02f, Receiver.Tolerance * 3.0f), Direction);
                    if (Facet == UINT32_MAX) continue;
                    const auto& Surface = Fields.QueryFacets()[Facet];
                    uint32_t Placement;
                    std::memcpy(&Placement, &Surface.Alpha[3], sizeof(Placement));
                    const auto& Transform = Fields.QueryPlacements()[Placement].WorldToLocal;
                    const V LocalNormal = From(Surface.Normal);
                    V HitNormal{Transform[0] * LocalNormal.x + Transform[1] * LocalNormal.y + Transform[2] * LocalNormal.z,
                                Transform[4] * LocalNormal.x + Transform[5] * LocalNormal.y + Transform[6] * LocalNormal.z,
                                Transform[8] * LocalNormal.x + Transform[9] * LocalNormal.y + Transform[10] * LocalNormal.z};
                    HitNormal = HitNormal.Normalized();
                    const float Lighting = 0.045f + std::max(0.0f, Frontier::Vehicle::Dot(HitNormal, Sun)) * 0.15f;
                    Indirect += From(Surface.Albedo) * Lighting + From(Surface.Emission);
                    ++Hits[Worker];
                }
                const float Diffuse = (1.0f - Material.Metalness) / SampleCount;
                const V Bounce{Indirect.x * Material.AlbedoR * Diffuse,
                               Indirect.y * Material.AlbedoG * Diffuse,
                               Indirect.z * Material.AlbedoB * Diffuse};
                float Colour[3] = {Linear[Pixel * 3u] + Bounce.x, Linear[Pixel * 3u + 1u] + Bounce.y, Linear[Pixel * 3u + 2u] + Bounce.z};
                for (float Channel : Colour) assert(std::isfinite(Channel) && Channel >= 0.0f);
                Frontier::ColourPipeline::ApplyToByte(Raster.QueryColourTransfer(), Colour, Pixels.data() + Pixel * 4u);
                Pixels[Pixel * 4u + 3u] = 255u;
            }
        });
    for (auto& Worker : Workers) Worker.join();
    for (const auto HitCount : Hits) TotalHits += HitCount;
    assert(TotalHits > 0u && Fields.QueryRevision() == Revision && Fields.QuerySamples().data() == Samples);
    assert(PngWriteCounterpart::WritePng((Folder / (Name + "-sdf-reference.png")).string().c_str(), Width, Height, 4, Pixels.data(), Width * 4u));
    std::printf("PASS %s: actual CPU raster; %llu bounded field hits, persistent samples unchanged. SDF lighting reference only.\n",
                Name.c_str(), static_cast<unsigned long long>(TotalHits));
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 2);
    const std::filesystem::path Folder = Arguments[1];
    std::filesystem::create_directories(Folder);
    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    Frontier::UnifiedMaterial::BindTables(Tables);
    Frontier::Drive::DriveSceneAuthor Author;
    Author.Construct(true);
    Frontier::SceneStructure Scene;
    ConstructScene(Scene, Author);
    Frontier::DistanceFieldStructure Fields;
    assert(Fields.Construct(Scene.QueryVertices(), Scene.QueryIndices(), Scene.QueryInstances(),
                            Scene.QueryMaterials().QueryRecords(), Folder / "Fields"));
    std::printf("SDF storage: %u constructed, %u file hits, %zu placements, %zu immutable samples.\n",
                Fields.QueryCacheMetrics().Constructed, Fields.QueryCacheMetrics().FileHits,
                Fields.QueryPlacements().size(), Fields.QuerySamples().size());
    const uint32_t Views = Count > 2 ? static_cast<uint32_t>(std::atoi(Arguments[2])) : 1u;
    for (uint32_t Index = 0u; Index < Views; ++Index)
        RenderView(Folder, Scene, Fields, Index * 360.0f / Views, "orbit-" + std::to_string(Index));
    Frontier::DistanceFieldStructure Reloaded;
    assert(Reloaded.Construct(Scene.QueryVertices(), Scene.QueryIndices(), Scene.QueryInstances(),
                              Scene.QueryMaterials().QueryRecords(), Folder / "Fields"));
    assert(Reloaded.QueryCacheMetrics().Constructed == 0u);
    std::puts("PASS fresh field construction reused files; no per-view geometry bake. CPU only, not Vulkan validation.");
}
