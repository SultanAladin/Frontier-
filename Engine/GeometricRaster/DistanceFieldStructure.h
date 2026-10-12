//============================================================================================================================================
//                                                       DISTANCEFIELDSTRUCTURE.H
//============================================================================================================================================
// 📦 Persistent mesh-local distance samples and independently refreshed scene placements. No camera-centred bake.

#pragma once

#include "GeometryStructure.h"
#include <cstdint>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

namespace Frontier
{
class SceneStructure;
struct InstanceRecord;
struct MaterialRecord;

struct alignas(16) DistanceFieldFacet
{
    float Alpha[4]{};
    float Beta[4]{};
    float Gamma[4]{};
    float Normal[4]{};
    float Albedo[4]{};
    float Emission[4]{};
};

struct alignas(16) DistanceFieldBranch
{
    float Minimum[3]{};
    uint32_t First = 0u;
    float Maximum[3]{};
    uint32_t Count = 0u;
    uint32_t Escape = 0u;
    uint32_t Reserved[3]{};
};

struct DistanceFieldVoxelRecord
{
    float Distance = 0.0f;                         // [m] signed distance in the mesh's authored coordinates
    uint32_t Facet = 0u;                           // [-] nearest local facet, before the placement's facet offset
};

struct alignas(16) DistanceFieldPlacementRecord
{
    float LocalToWorld[16]{};
    float WorldToLocal[16]{};
    float Minimum[4]{};                            // xyz [m] local field bounds; w [-] conservative distance scale
    float Maximum[4]{};                            // xyz [m] local field bounds; w [m] world surface tolerance
    uint32_t Resolution[4]{};                      // xyz [-] lattice dimensions; w [-] offset in immutable samples
    uint32_t Identity[4]{};                        // instance slot, first surface facet, facet count, reserved
    float WorldMinimum[4]{};
    float WorldMaximum[4]{};
};

struct DistanceFieldCacheMetrics
{
    uint32_t Constructed = 0u;
    uint32_t FileHits = 0u;
    uint32_t SharedPlacements = 0u;
};

static_assert(sizeof(DistanceFieldFacet) == 96u);
static_assert(sizeof(DistanceFieldBranch) == 48u);
static_assert(sizeof(DistanceFieldVoxelRecord) == 8u);
static_assert(sizeof(DistanceFieldPlacementRecord) == 224u);

class DistanceFieldStructure
{
public:
    DistanceFieldStructure();
    ~DistanceFieldStructure();

    bool Construct(const SceneStructure& Scene);
    bool Construct(const std::vector<VertexRecord>& Positions, const std::vector<uint32_t>& Corners,
                   const std::vector<InstanceRecord>& Placements, const std::vector<MaterialRecord>& Reflectance,
                   const std::filesystem::path& Storage = "Build/Derived/DistanceFields");
    bool Construct(std::vector<DistanceFieldFacet> Input);
    bool RefreshInstances(const InstanceRecord* Rows, uint32_t Count);
    bool RefreshReflectance(const SceneStructure& Scene);

    [[nodiscard]] const std::vector<DistanceFieldFacet>& QueryFacets() const noexcept { return Facets; }
    [[nodiscard]] const std::vector<DistanceFieldBranch>& QueryBranches() const noexcept { return Branches; }
    [[nodiscard]] const std::vector<DistanceFieldVoxelRecord>& QuerySamples() const noexcept { return Samples; }
    [[nodiscard]] const std::vector<DistanceFieldPlacementRecord>& QueryPlacements() const noexcept { return Placements; }
    [[nodiscard]] const DistanceFieldCacheMetrics& QueryCacheMetrics() const noexcept { return CacheMetrics; }
    [[nodiscard]] const std::string& QueryRefusal() const noexcept { return Refusal; }
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision; }
    [[nodiscard]] uint64_t QueryPlacementRevision() const noexcept { return PlacementRevision; }
    [[nodiscard]] uint64_t QueryCaptureRevision() const noexcept { return CaptureRevision; }
    [[nodiscard]] float SampleDistance(uint32_t Placement, Vector3 World) const noexcept;

private:
    struct DistanceFieldContentRecord
    {
        float Minimum[3]{};
        float Maximum[3]{};
        uint32_t Resolution[3]{};
        uint32_t FirstSample = 0u;
        std::vector<DistanceFieldFacet> Facets;
    };

    bool ConstructPartition(std::vector<DistanceFieldFacet> Input, const std::filesystem::path& Storage,
                            DistanceFieldContentRecord& Content);
    bool ProjectPlacement(uint32_t Slot, const InstanceRecord& Row, DistanceFieldPlacementRecord& Placement) const;
    void Linearize(uint32_t First, uint32_t Count);

    std::vector<DistanceFieldFacet> Facets;
    std::vector<DistanceFieldBranch> Branches;       // CPU import-time nearest-surface acceleration only
    std::vector<DistanceFieldVoxelRecord> Samples;
    std::vector<DistanceFieldPlacementRecord> Placements;
    std::vector<InstanceRecord> Instances;
    std::vector<MaterialRecord> Materials;
    std::unordered_map<std::string, DistanceFieldContentRecord> Contents;
    DistanceFieldCacheMetrics CacheMetrics;
    std::string Refusal;
    uint64_t Revision = 0u;
    uint64_t PlacementRevision = 0u;
    uint64_t CaptureRevision = 0u;
};
}
