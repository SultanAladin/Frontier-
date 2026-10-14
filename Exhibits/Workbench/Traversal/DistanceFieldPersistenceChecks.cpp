//============================================================================================================================================
//                                                   DISTANCEFIELDPERSISTENCECHECKS.CPP
//============================================================================================================================================
// 📦 CPU-only production-code checks: durable local fields, moving placements, affine refusal and GI/RT selection.

#include "GeometricRaster/SceneStructure.h"
#include "GeometricRaster/DistanceFieldStructure.h"
#include "DeviceExchange/DistanceFieldGIStage.h"
#include <cassert>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <vector>

namespace
{
using namespace Frontier;

uint64_t FingerprintSamples(const DistanceFieldStructure& Fields)
{
    uint64_t Digest = 14695981039346656037ull;
    const auto* Bytes = reinterpret_cast<const unsigned char*>(Fields.QuerySamples().data());
    const size_t Count = Fields.QuerySamples().size() * sizeof(DistanceFieldVoxelRecord);
    for (size_t Index = 0u; Index < Count; ++Index) Digest = (Digest ^ Bytes[Index]) * 1099511628211ull;
    return Digest;
}

InstanceRecord IdentityPlacement()
{
    InstanceRecord Row{};
    Row.World[0] = Row.World[5] = Row.World[10] = Row.World[15] = 1.0f;
    Row.TriangleCount = 2u;
    return Row;
}

Vector3 ProjectPoint(const float* World, Vector3 Local)
{
    return { World[0] * Local.x + World[4] * Local.y + World[8] * Local.z + World[12],
             World[1] * Local.x + World[5] * Local.y + World[9] * Local.z + World[13],
             World[2] * Local.x + World[6] * Local.y + World[10] * Local.z + World[14] };
}
}

int main(int ArgumentCount, char** Arguments)
{
    assert(ArgumentCount == 2);
    const std::filesystem::path Storage = Arguments[1];
    assert(!std::filesystem::exists(Storage));       // runner supplies its own fresh scratch directory
    std::vector<VertexRecord> Positions(4u);
    Positions[0].SpatialLocation = { -1.0f, -1.0f, 0.0f };
    Positions[1].SpatialLocation = {  1.0f, -1.0f, 0.0f };
    Positions[2].SpatialLocation = {  1.0f,  1.0f, 0.0f };
    Positions[3].SpatialLocation = { -1.0f,  1.0f, 0.0f };
    const std::vector<uint32_t> Corners{ 0u, 1u, 2u, 0u, 2u, 3u };
    std::vector<InstanceRecord> Rows{ IdentityPlacement(), IdentityPlacement() };
    Rows[1].World[12] = 5.0f;
    Rows[1].MaterialIndex = 1u;
    std::vector<MaterialRecord> Reflectance(2u);
    Reflectance[0].AlbedoR = 0.7f;
    Reflectance[1].AlbedoG = 0.5f;

    DistanceFieldStructure Fields;
    assert(Fields.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Fields.QueryCacheMetrics().Constructed == 1u && Fields.QueryCacheMetrics().FileHits == 0u);
    assert(Fields.QueryCacheMetrics().SharedPlacements == 1u);
    assert(Fields.QueryPlacements().size() == 2u && Fields.QueryFacets().size() == 4u);
    assert(Fields.QueryPlacements()[0].Resolution[3] == Fields.QueryPlacements()[1].Resolution[3]);
    for (const auto& Sample : Fields.QuerySamples()) assert(Sample.Facet < 2u && std::isfinite(Sample.Distance));
    std::filesystem::path Artifact;
    uint32_t ArtifactCount = 0u;
    for (const auto& Entry : std::filesystem::directory_iterator(Storage)) { Artifact = Entry.path(); ++ArtifactCount; }
    assert(ArtifactCount == 1u && Artifact.extension() == ".sdf");
    const auto Timestamp = std::filesystem::last_write_time(Artifact);
    const uint64_t Digest = FingerprintSamples(Fields), Revision = Fields.QueryRevision();
    const auto* Samples = Fields.QuerySamples().data();
    assert(Fields.SampleDistance(0u, { 0.2f, 0.1f, 0.06f }) > 0.0f);
    assert(Fields.SampleDistance(0u, { 0.2f, 0.1f, -0.06f }) < 0.0f);
    std::cout << "PASS one durable field shared by two differently placed/materialed instances\n";

    const Vector3 Local{ 0.2f, 0.1f, 0.02f };
    const float LocalDistance = Fields.SampleDistance(0u, Local) / Fields.QueryPlacements()[0].Minimum[3];
    for (uint32_t Tick = 0u; Tick < 512u; ++Tick)
    {
        const float Angle = float(Tick) * 0.017f, Cosine = std::cos(Angle), Sine = std::sin(Angle);
        const float Scale = Tick & 1u ? -2.0f : 2.0f;
        Rows[0].World[0] = Cosine * Scale; Rows[0].World[1] = Sine * Scale;
        Rows[0].World[4] = -Sine * 0.5f; Rows[0].World[5] = Cosine * 0.5f;
        Rows[0].World[8] = 0.2f; Rows[0].World[9] = -0.1f; Rows[0].World[10] = 1.3f;
        Rows[0].World[12] = float(Tick) * 0.04f; Rows[0].World[13] = -7.0f; Rows[0].World[14] = 3.0f;
        assert(Fields.RefreshInstances(Rows.data(), static_cast<uint32_t>(Rows.size())));
        const Vector3 World = ProjectPoint(Rows[0].World, Local);
        const auto& Placement = Fields.QueryPlacements()[0];
        const float Distance = Fields.SampleDistance(0u, World) / Placement.Minimum[3];
        assert(std::fabs(Distance - LocalDistance) < 2.0e-5f);
        assert(Fields.QueryRevision() == Revision && Fields.QuerySamples().data() == Samples);
        assert(FingerprintSamples(Fields) == Digest && Fields.QueryCacheMetrics().Constructed == 1u);
        assert(std::filesystem::last_write_time(Artifact) == Timestamp);
        assert(World.x >= Placement.WorldMinimum[0] && World.x <= Placement.WorldMaximum[0]);
        assert(World.y >= Placement.WorldMinimum[1] && World.y <= Placement.WorldMaximum[1]);
        assert(World.z >= Placement.WorldMinimum[2] && World.z <= Placement.WorldMaximum[2]);
    }
    std::cout << "PASS 512 translations/rotations/nonuniform scales/shears/mirrors: unchanged samples, address, file and bake revision\n";

    const uint64_t CaptureRevision = Fields.QueryCaptureRevision();
    Rows[0].MaterialIndex = 1u;
    assert(Fields.RefreshInstances(Rows.data(), static_cast<uint32_t>(Rows.size())));
    assert(Fields.QueryCaptureRevision() > CaptureRevision && FingerprintSamples(Fields) == Digest);
    DistanceFieldStructure Restart;
    assert(Restart.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Restart.QueryCacheMetrics().Constructed == 0u && Restart.QueryCacheMetrics().FileHits == 1u);
    assert(FingerprintSamples(Restart) == Digest && std::filesystem::last_write_time(Artifact) == Timestamp);
    std::cout << "PASS fresh process-equivalent construction reuses disk bytes; transform/material changes are not cache keys\n";

    const auto Before = Fields.QueryPlacements();
    auto Invalid = Rows;
    Invalid[0].World[12] += 50.0f;
    Invalid[1].World[0] = 0.0f;
    assert(!Fields.RefreshInstances(Invalid.data(), static_cast<uint32_t>(Invalid.size())));
    assert(std::memcmp(Before.data(), Fields.QueryPlacements().data(), Before.size() * sizeof(Before[0])) == 0);
    Invalid = Rows;
    Invalid[0].World[12] = std::numeric_limits<float>::quiet_NaN();
    assert(!Fields.RefreshInstances(Invalid.data(), static_cast<uint32_t>(Invalid.size())));
    Invalid = Rows;
    ++Invalid[0].TriangleCount;
    assert(!Fields.RefreshInstances(Invalid.data(), static_cast<uint32_t>(Invalid.size())));
    assert(!Fields.RefreshInstances(Rows.data(), 1u));
    assert(FingerprintSamples(Fields) == Digest);
    std::cout << "PASS singular/nonfinite/topology/count refusals are transactional, without a rebuild\n";

    // A damaged or truncated artifact must never be accepted as GPU samples.
    {
        std::fstream Stream(Artifact, std::ios::binary | std::ios::in | std::ios::out);
        Stream.seekg(-1, std::ios::end);
        char Byte = 0;
        Stream.read(&Byte, 1);
        Byte ^= 0x20;
        Stream.seekp(-1, std::ios::end);
        Stream.write(&Byte, 1);
    }
    DistanceFieldStructure Recovered;
    assert(Recovered.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Recovered.QueryCacheMetrics().Constructed == 1u && FingerprintSamples(Recovered) == Digest);
    std::filesystem::resize_file(Artifact, 100u);
    assert(Recovered.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Recovered.QueryCacheMetrics().Constructed == 1u && FingerprintSamples(Recovered) == Digest);
    DistanceFieldStructure Verified;
    assert(Verified.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Verified.QueryCacheMetrics().FileHits == 1u && Verified.QueryCacheMetrics().Constructed == 0u);
    std::cout << "PASS checksum/truncation refusal, atomic repair, then an ordinary cache hit\n";

    for (auto& Position : Positions) Position.SpatialLocation.z += 0.2f;
    DistanceFieldStructure Edited;
    assert(Edited.Construct(Positions, Corners, Rows, Reflectance, Storage));
    assert(Edited.QueryCacheMetrics().Constructed == 1u);
    ArtifactCount = 0u;
    for (const auto& Entry : std::filesystem::directory_iterator(Storage)) { (void)Entry; ++ArtifactCount; }
    assert(ArtifactCount == 2u);                    // genuine local mesh edits produce a distinct asset artifact
    const auto Denied = Storage / "NotADirectory";
    std::ofstream(Denied).put('x');
    assert(!Edited.Construct(Positions, Corners, Rows, Reflectance, Denied));
    assert(!Edited.QueryRefusal().empty());
    std::cout << "PASS genuine mesh edits invalidate identity; failed persistence refuses rather than rebaking each frame\n";

    // One authored node split into two material instances is one geometric field, while card identities remain
    // the original instance + primitive pair. An unrelated mesh at another transform retains its own field.
    {
        std::vector<VertexRecord> SplitPositions(4u);
        SplitPositions[0].SpatialLocation = { -1.0f, -1.0f, 0.0f };
        SplitPositions[1].SpatialLocation = {  1.0f, -1.0f, 0.0f };
        SplitPositions[2].SpatialLocation = {  1.0f,  1.0f, 0.0f };
        SplitPositions[3].SpatialLocation = { -1.0f,  1.0f, 0.0f };
        std::vector<InstanceRecord> SplitRows(3u, IdentityPlacement());
        SplitRows[0].TriangleCount = SplitRows[1].TriangleCount = SplitRows[2].TriangleCount = 1u;
        SplitRows[1].FirstIndex = 3u;
        SplitRows[1].MaterialIndex = 1u;
        SplitRows[2].World[12] = 5.0f;
        const std::vector<uint32_t> Roots{ 0u, 0u, 2u };
        const auto SplitStorage = Storage / "MaterialPartition";
        DistanceFieldStructure Grouped;
        assert(Grouped.Construct(SplitPositions, Corners, SplitRows, Reflectance, Roots, SplitStorage));
        const auto& GroupPlacements = Grouped.QueryPlacements();
        assert(GroupPlacements.size() == 3u && Grouped.QueryFacets().size() == 3u);
        assert(Grouped.QueryCacheMetrics().Constructed == 2u);
        assert(GroupPlacements[0].Identity[3] == 1u && GroupPlacements[1].Identity[3] == 0u &&
               GroupPlacements[2].Identity[3] == 1u);
        assert(GroupPlacements[0].Resolution[3] == GroupPlacements[1].Resolution[3]);
        assert(GroupPlacements[0].Identity[1] == GroupPlacements[1].Identity[1]);
        assert(GroupPlacements[0].Identity[2] == 2u && GroupPlacements[2].Identity[2] == 1u);
        for (uint32_t Facet = 0u; Facet < Grouped.QueryFacets().size(); ++Facet)
        {
            uint32_t Slot = ~0u, Primitive = ~0u;
            std::memcpy(&Slot, &Grouped.QueryFacets()[Facet].Alpha[3], sizeof(Slot));
            std::memcpy(&Primitive, &Grouped.QueryFacets()[Facet].Beta[3], sizeof(Primitive));
            assert(Slot == Facet && Primitive == 0u);
        }
        assert(Grouped.QueryFacets()[0].Albedo[0] == Reflectance[0].AlbedoR);
        assert(Grouped.QueryFacets()[1].Albedo[1] == Reflectance[1].AlbedoG);
        const auto* GroupSamples = Grouped.QuerySamples().data();
        const auto GroupDigest = FingerprintSamples(Grouped), GroupRevision = Grouped.QueryRevision();
        const float Original = Grouped.SampleDistance(0u, { -0.6f, 0.1f, 0.06f });
        SplitRows[0].World[12] = SplitRows[1].World[12] = 3.0f;
        assert(Grouped.RefreshInstances(SplitRows.data(), static_cast<uint32_t>(SplitRows.size())));
        assert(std::fabs(Grouped.SampleDistance(0u, { 2.4f, 0.1f, 0.06f }) - Original) < 2.0e-5f);
        assert(Grouped.QuerySamples().data() == GroupSamples && FingerprintSamples(Grouped) == GroupDigest &&
               Grouped.QueryRevision() == GroupRevision);
        const auto Committed = Grouped.QueryPlacements();
        SplitRows[1].World[12] = 4.0f;
        assert(!Grouped.RefreshInstances(SplitRows.data(), static_cast<uint32_t>(SplitRows.size())));
        assert(std::memcmp(Committed.data(), Grouped.QueryPlacements().data(),
                           Committed.size() * sizeof(Committed[0])) == 0);
        SplitRows[1].World[12] = 3.0f;
        DistanceFieldStructure Reloaded;
        assert(Reloaded.Construct(SplitPositions, Corners, SplitRows, Reflectance, Roots, SplitStorage));
        assert(Reloaded.QueryCacheMetrics().FileHits == 2u && Reloaded.QueryCacheMetrics().Constructed == 0u);
        assert(FingerprintSamples(Reloaded) == GroupDigest);
        DistanceFieldStructure InvalidRoots;
        assert(!InvalidRoots.Construct(SplitPositions, Corners, SplitRows, Reflectance, { 0u, 0u, 0u }, SplitStorage));
        assert(!InvalidRoots.QueryRefusal().empty());
        std::cout << "PASS material partitions share one field; distinct objects keep their own; card IDs, "
                     "cache reuse and transactional co-motion\n";
    }
    {
        GeometryStructure FirstHalf, SecondHalf;
        const std::vector<VertexRecord> Quad = []
        {
            std::vector<VertexRecord> Vertices(4u);
            Vertices[0].SpatialLocation = { -1.0f, -1.0f, 0.0f };
            Vertices[1].SpatialLocation = {  1.0f, -1.0f, 0.0f };
            Vertices[2].SpatialLocation = {  1.0f,  1.0f, 0.0f };
            Vertices[3].SpatialLocation = { -1.0f,  1.0f, 0.0f };
            return Vertices;
        }();
        FirstHalf.AppendVertices(Quad.data(), Quad.size());
        SecondHalf.AppendVertices(Quad.data(), Quad.size());
        const uint32_t Left[] = { 0u, 1u, 2u }, Right[] = { 0u, 2u, 3u };
        FirstHalf.AppendIndices(Left, 3u);
        SecondHalf.AppendIndices(Right, 3u);
        SceneStructure Scene;
        const uint32_t Red = Scene.RegisterMaterial(MaterialDescriptor{});
        const uint32_t Blue = Scene.RegisterMaterial(MaterialDescriptor{});
        Matrix4x4 World = Matrix4x4::Identity();
        const uint32_t Node = Scene.RegisterPlacement("Shared authored mesh", kPlacementNone, World, World);
        const uint32_t First = Scene.RegisterInstance(FirstHalf, World, Red, 0u);
        (void)Scene.RegisterInstance(SecondHalf, World, Blue, 0u);
        Scene.AttachInstances(Node, First, 2u);
        World.Columns[3][0] = 5.0f;
        const uint32_t Other = Scene.RegisterPlacement("Different object", kPlacementNone, World, World);
        const uint32_t Independent = Scene.RegisterInstance(FirstHalf, World, Red, 0u);
        Scene.AttachInstances(Other, Independent, 1u);
        Scene.Finalise();
        DistanceFieldStructure FromScene;
        assert(FromScene.Construct(Scene, Storage / "SceneGroup"));
        assert(FromScene.QueryPlacements().size() == 3u);
        assert(FromScene.QueryPlacements()[0].Identity[3] == 1u &&
               FromScene.QueryPlacements()[1].Identity[3] == 0u &&
               FromScene.QueryPlacements()[2].Identity[3] == 1u);
        assert(FromScene.QueryFacets().size() == 3u);
        assert(FromScene.QueryCacheMetrics().Constructed == 2u);
        std::cout << "PASS actual scene-graph mesh node groups material rows without grouping a different object\n";
    }

    {
        std::vector<VertexRecord> Volumetric(3u);
        Volumetric[0].SpatialLocation = { 0.0f, 0.0f, 0.0f };
        Volumetric[1].SpatialLocation = { 16.0f, 0.0f, 0.0f };
        Volumetric[2].SpatialLocation = { 0.0f, 16.0f, 16.0f };
        auto Row = IdentityPlacement();
        Row.TriangleCount = 1u;
        DistanceFieldStructure Bounded;
        assert(Bounded.Construct(Volumetric, { 0u, 1u, 2u }, { Row }, { Reflectance[0] }, Storage / "Volume"));
        assert(Bounded.QuerySamples().size() <= 2000000u);
        std::cout << "PASS compact, volumetric field obeys its per-partition memory budget\n";
    }

    static_assert(DispatchFeatureGlobalIllumination == 1u && DispatchFeatureRaytracing == (1u << 11u));
    for (uint32_t Features = 0u; Features < 8192u; ++Features)
        assert(DistanceFieldGIStage::SelectsDistanceField(Features) ==
               ((Features & DispatchFeatureGlobalIllumination) != 0u && (Features & DispatchFeatureRaytracing) == 0u));
    std::cout << "PASS all 8192 feature combinations: SDF only GI-on AND RT-off\n";
    std::cout << "CPU only: no Vulkan dispatch, Windows build, AMD device-loss reproduction or GPU performance claim.\n";
}
