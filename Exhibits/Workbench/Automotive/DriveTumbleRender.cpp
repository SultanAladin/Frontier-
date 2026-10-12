//============================================================================================================================================
//                                                         DRIVETUMBLERENDER.CPP
//============================================================================================================================================
// 📦 Shared-engine CPU raster of recorded chassis and all solved tyre particles; no scripted or interpolated poses.

#include "../../../Engine/DisplayPresentation/ShadingTableCodec.h"
#include "../../../Engine/ContentInterchange/UnifiedMaterialEvaluation.h"
#include "../../../Engine/ContentInterchange/PngWriteCounterpart.h"
#include "../../../Engine/GeometricRaster/SceneStructure.h"
#include "../../../Engine/GeometricRaster/VisibilityRaster.h"
#include "../../../Projects/Project-Drive/Source/ControlVehicleMesh.inl"
#include "../../../Projects/Project-Drive/Source/ControlVehicleWheelMesh.inl"
#include "../../../Projects/Project-Drive/Source/DriveWheelMesh.h"
#include "../../../Projects/Project-Drive/Source/DriveCourse.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"

#include <cassert>
#include <filesystem>
#include <fstream>
#include <string>

namespace
{

using Frontier::Vehicle::Vec3;
using Frontier::Vehicle::Quat;
using Frontier::Vehicle::Cross;
constexpr uint32_t Extent = 320u;
constexpr float π = 3.14159265359f;

struct FacetSequence
{
    std::vector<Frontier::VertexRecord> Vertices;
    std::vector<uint32_t> Indices;

    void Triangle(const Vec3& A, const Vec3& B, const Vec3& C)
    {
        const Vec3 Normal = Cross(B - A, C - A).Normalized();
        for (const Vec3 Point : {A, B, C})
        {
            Frontier::VertexRecord Vertex{};
            Vertex.SpatialLocation = {Point.x, Point.y, Point.z}; Vertex.NormalDirection = {Normal.x, Normal.y, Normal.z};
            Vertex.TangentDirection = {1.0f, 0.0f, 0.0f, 1.0f};
            Vertices.push_back(Vertex); Indices.push_back(static_cast<uint32_t>(Indices.size()));
        }
    }

    void Append(Frontier::SceneStructure& Scene, uint32_t Material)
    {
        if (Vertices.empty()) return;
        Frontier::GeometryStructure Geometry;
        Geometry.AppendVertices(Vertices.data(), Vertices.size()); Geometry.AppendIndices(Indices.data(), Indices.size());
        Frontier::Matrix4x4 Identity{};
        for (uint32_t Axis = 0u; Axis < 4u; ++Axis) Identity.Columns[Axis][Axis] = 1.0f;
        Scene.RegisterInstance(Geometry, Identity, Material, Frontier::InstanceFlagDoubleSided);
    }
};

void Material(Frontier::SceneStructure& Scene, Vec3 Colour, float Emission = 0.0f)
{
    Frontier::MaterialDescriptor Description; Description.Name = "CPU motion diagnostic"; Description.Slabs.emplace_back();
    auto& Slab = Description.Slabs.back();
    Slab.BaseColor[0] = Colour.x; Slab.BaseColor[1] = Colour.y; Slab.BaseColor[2] = Colour.z;
    Slab.SpecularRoughness = 0.65f; Slab.EmissionLuminance = Emission;
    Scene.RegisterMaterial(Description);
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 3 && Count <= 8);
    const std::filesystem::path Recording = Arguments[1], Folder = Arguments[2];
    const uint32_t Stride = Count > 3 ? static_cast<uint32_t>(std::stoul(Arguments[3])) : 4u;
    const uint32_t First = Count > 4 ? static_cast<uint32_t>(std::stoul(Arguments[4])) : 0u;
    const uint32_t Last = Count > 5 ? static_cast<uint32_t>(std::stoul(Arguments[5])) : 1000u;
    assert(Stride > 0u && First < Last);
    std::ifstream Input(Recording, std::ios::binary);
    uint32_t Header[4]; Input.read(reinterpret_cast<char*>(Header), sizeof(Header));
    assert(Input.good() && (Header[0] == 0x54554D42u || Header[0] == 0x54554D31u) && Header[1] >= 2u && Header[2] >= 8u);
    const uint32_t Rings = Header[1], Segments = Header[2], Frames = Header[3];
    const uint32_t WheelCount = Header[0] == 0x54554D31u ? 1u : 4u;
    const std::string View = Count >= 8 ? Arguments[7] : "overview";
    const bool TyreCloseup = View == "tyre-side" || View == "tyre-oblique";
    const uint32_t FeaturedWheel = WheelCount == 1u ? 0u : 1u;
    assert(WheelCount == 4u || TyreCloseup);
    uint32_t Terrain = Recording.stem().string().find("air-") == 0u ? 1u : 0u;
    float Mirror = 1.0f; Vec3 Normal{0.0f, 0.0f, 1.0f};
    auto TerrainPath = Recording; TerrainPath.replace_extension(".terrain");
    std::ifstream Surface(TerrainPath);
    if (Surface.good()) Surface >> Terrain >> Mirror >> Normal.x >> Normal.y >> Normal.z;
    assert(Terrain <= 3u && std::abs(Normal.Length() - 1.0f) < 0.0001f);
    std::filesystem::create_directories(Folder);
    const bool FlatColouring = Count <= 6 || std::string(Arguments[6]) != "lit";
    Frontier::ShadingTableSet Tables;
    if (!FlatColouring)
    {
        Tables = Frontier::ShadingTableCodec::Bake(512u);
        Frontier::UnifiedMaterial::BindTables(Tables);
    }
    Frontier::Vehicle::VehicleGeometry Dimensions;
    std::vector<unsigned char> Pixels(Extent * Extent * 4u); uint32_t Rendered = 0u;
    for (uint32_t Frame = 0u; Frame < Frames; ++Frame)
    {
        Vec3 Position, Hubs[4]; Quat Rotation, Phases[4]; std::vector<Vec3> Particles[4];
        Input.read(reinterpret_cast<char*>(&Position), sizeof(Position)); Input.read(reinterpret_cast<char*>(&Rotation), sizeof(Rotation));
        for (uint32_t Corner = 0u; Corner < WheelCount; ++Corner)
        {
            Input.read(reinterpret_cast<char*>(&Hubs[Corner]), sizeof(Vec3)); Input.read(reinterpret_cast<char*>(&Phases[Corner]), sizeof(Quat));
            Particles[Corner].resize(Rings * Segments); Input.read(reinterpret_cast<char*>(Particles[Corner].data()), Particles[Corner].size() * sizeof(Vec3));
        }
        assert(Input.good());
        if (Frame < First || Frame >= Last || (Frame - First) % Stride != 0u) continue;
        Frontier::SceneStructure Scene;
        Material(Scene, {0.12f, 0.37f, 0.65f}); Material(Scene, {0.08f, 0.40f, 0.18f}); Material(Scene, {0.85f, 0.40f, 0.08f});
        Material(Scene, {0.62f, 0.63f, 0.65f}); Material(Scene, {0.16f, 0.18f, 0.21f}); Material(Scene, {1.0f, 1.0f, 1.0f}, 3.0f);
        FacetSequence Body; namespace Authored = Frontier::Drive::ControlVehicleMesh;
        for (uint32_t Triangle = 0u; !TyreCloseup && Triangle < Authored::kTriangleCount; ++Triangle)
        {
            Vec3 Points[3];
            for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
            {
                const uint32_t Index = Authored::kTriangles[Triangle * 3u + Corner] * 3u;
                Points[Corner] = Position + Rotation.Rotate({Authored::kPositions[Index], Authored::kPositions[Index + 1u], Authored::kPositions[Index + 2u] - Dimensions.CoMModelZ()});
            }
            Body.Triangle(Points[0], Points[1], Points[2]);
        }
        Body.Append(Scene, 0u); FacetSequence Tyres, Rims;
        for (uint32_t Corner = 0u; Corner < WheelCount; ++Corner)
        {
            if (TyreCloseup && Corner != FeaturedWheel) continue;
            // 📝 The diagnostic uses the native wheel emitter and authored rigid rim, not an open tread
            //      tube or a cylindrical rim proxy. Only the supplied tread positions are deformed.
            const auto& Nodes = Particles[Corner];
            const Quat Inverse{-Phases[Corner].x, -Phases[Corner].y, -Phases[Corner].z, Phases[Corner].w};
            std::vector<float> Tread(static_cast<size_t>(Rings) * Segments * 3u);
            for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
                for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
                {
                    const Vec3 Local = Inverse.Rotate(Nodes[(Rings - 1u - Ring) * Segments + Segment] - Hubs[Corner]);
                    const size_t Index = (Ring * Segments + Segment) * 3u;
                    Tread[Index]     = Local.x;
                    Tread[Index + 1] = Local.y;
                    Tread[Index + 2] = Local.z;
                }
            Frontier::Drive::WheelTreadLattice Lattice;
            Lattice.RingCount    = Rings;
            Lattice.SegmentCount = Segments;
            Lattice.Tread        = Tread.data();
            Lattice.RimRadius    = Dimensions.TyreRimRadius;
            Lattice.HalfWidth    = 0.5f * Dimensions.TyreWidth;
            Lattice.SpokeCount   = Frontier::Drive::kDriveWheelSpokeCount;
            const auto Publish = [&](const float* Local)
            {
                return Hubs[Corner] + Phases[Corner].Rotate({Local[0], Local[1], Local[2]});
            };
            Frontier::Drive::EmitWheelSurface(Lattice, 1u, 2u, 2u,
                [&](const float* A, const float* B, const float* C,
                    const float*, const float*, const float*, uint32_t Material)
                {
                    (Material == 1u ? Tyres : Rims).Triangle(Publish(A), Publish(B), Publish(C));
                });
            namespace AuthoredRim = Frontier::Drive::ControlVehicleWheelMesh;
            const float Scale = Dimensions.TyreRimRadius / AuthoredRim::kRimRadius;
            const auto RimPoint = [&](uint32_t Index)
            {
                const float* Local = AuthoredRim::kPositions + Index * 3u;
                return Hubs[Corner] + Phases[Corner].Rotate({Local[0] * Scale, Local[1] * Scale, Local[2] * Scale});
            };
            for (uint32_t Triangle = 0u; Triangle < AuthoredRim::kTriangleCount; ++Triangle)
                Rims.Triangle(RimPoint(AuthoredRim::kTriangles[Triangle * 3u]),
                              RimPoint(AuthoredRim::kTriangles[Triangle * 3u + 1u]),
                              RimPoint(AuthoredRim::kTriangles[Triangle * 3u + 2u]));
        }
        Tyres.Append(Scene, 1u); Rims.Append(Scene, 2u); FacetSequence Floor[2];
        if (Terrain == 0u)
        {
            Frontier::Drive::EmitCourseTriangles([&](float AX, float AY, float AZ, float BX, float BY, float BZ, float CX, float CY, float CZ, uint32_t SurfaceMaterial)
            {
                AY *= Mirror; BY *= Mirror; CY *= Mirror;
                if (std::max({AX, BX, CX}) < Position.x - 24 || std::min({AX, BX, CX}) > Position.x + 24 || std::max({AY, BY, CY}) < Position.y - 24 || std::min({AY, BY, CY}) > Position.y + 24) return;
                Floor[SurfaceMaterial == Frontier::Drive::MatCheckerLight ? 0u : 1u].Triangle({AX, AY, AZ}, {BX, BY, BZ}, {CX, CY, CZ});
            });
        }
        else if (Terrain >= 2u)
        {
            const Vec3 Along = (Vec3{1, 0, 0} - Normal * Normal.x).Normalized(), Across = Cross(Normal, Along).Normalized();
            const int CentreX = static_cast<int>(std::floor(Frontier::Vehicle::Dot(Position, Along) / 4)), CentreY = static_cast<int>(std::floor(Frontier::Vehicle::Dot(Position, Across) / 4));
            for (int X = CentreX - 6; X < CentreX + 6; ++X)
                for (int Y = CentreY - 6; Y < CentreY + 6; ++Y)
                {
                    const Vec3 A = Along * (X * 4.0f) + Across * (Y * 4.0f), B = A + Along * 4, C = B + Across * 4, D = A + Across * 4;
                    Floor[(X + Y) & 1].Triangle(A, B, C); Floor[(X + Y) & 1].Triangle(A, C, D);
                }
        }
        Floor[0].Append(Scene, 3u); Floor[1].Append(Scene, 4u); FacetSequence Lamp;
        if (!FlatColouring)
        {
            Lamp.Triangle(Position + Vec3{-5, -5, 7}, Position + Vec3{5, 5, 7}, Position + Vec3{5, -5, 7});
            Lamp.Triangle(Position + Vec3{-5, -5, 7}, Position + Vec3{-5, 5, 7}, Position + Vec3{5, 5, 7}); Lamp.Append(Scene, 5u);
        }
        Scene.Finalise();
        Vec3 Eye = Position + Vec3{-7.0f, -8.0f, 4.0f}, Target = Position + Vec3{0, 0, 0.25f};
        Vec3 CameraUp{0.0f, 0.0f, 1.0f};
        if (TyreCloseup)
        {
            Target = Hubs[FeaturedWheel];
            Eye = Target + Phases[FeaturedWheel].Rotate(View == "tyre-side" ? Vec3{0.0f, -1.7f, 0.0f} : Vec3{1.0f, -1.9f, 0.45f});
            CameraUp = Phases[FeaturedWheel].Rotate({0.0f, 0.0f, 1.0f});
        }
        if (Count >= 8 && std::string(Arguments[7]) == "bead")
        {
            Target = Hubs[1];
            Eye = Target + Phases[1].Rotate({0.0f, -2.3f, 0.4f});
        }
        const Vec3 Forward = (Target - Eye).Normalized();
        const Vec3 Right = Cross(Forward, CameraUp).Normalized(), Up = Cross(Right, Forward).Normalized();
        const float E[] = {Eye.x, Eye.y, Eye.z}, F[] = {Forward.x, Forward.y, Forward.z}, R[] = {Right.x, Right.y, Right.z}, U[] = {Up.x, Up.y, Up.z};
        Frontier::VisibilityRaster Raster; Raster.AssignFlatColouring(FlatColouring); Frontier::ShadowCriteria Shadows; Shadows.MapSide = 128u; Shadows.TapCount = 1u; Raster.AssignShadowCriteria(Shadows);
        double Luminance = 0.0;
        assert(Raster.Render(Scene, E, F, R, U, 46.0f * π / 180.0f, Extent, Extent, Pixels.data(), Luminance));
        assert(PngWriteCounterpart::WritePng((Folder / (std::to_string(Frame) + ".png")).string().c_str(), Extent, Extent, 4, Pixels.data(), Extent * 4u));
        ++Rendered;
    }
    assert(Rendered > 0u); std::printf("PASS %u actual poses through shared CPU raster, 20/%u Hz samples, no invented poses\n", Rendered, Stride);
}
