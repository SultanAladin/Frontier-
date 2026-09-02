//============================================================================================================================================
// 📦 Frontier/Layer3_GeometricRaster/GeometryStructure.h — Vertex, Index and Polyhedral Cluster Geometry Storage
//============================================================================================================================================

#pragma once

#include "../Layer0_DeviceExchange/OrientationClassifier.h"
#include <vector>
#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    VERTEX RECORD
//------------------------------------------------------------------------------------------------------------------------

struct alignas(16) VertexRecord
{
    Vector3                 SpatialLocation;                    // [m] position coordinate
    Vector3                 NormalDirection;                    // [-] unit surface normal
    Vector4                 TangentDirection;                   // [-] unit tangent and sign
    float                   TextureCoordinateU;                 // [0..1] horizontal texture coordinate
    float                   TextureCoordinateV;                 // [0..1] vertical texture coordinate
    float                   Padding[2];                         // [-] alignment padding
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 POLYHEDRAL CLUSTER
//------------------------------------------------------------------------------------------------------------------------

struct PolyhedralCluster
{
    Vector3                 BoundingCenter;                     // [m] bounding sphere center
    float                   BoundingRadius;                     // [m] bounding sphere radius
    Vector3                 ConeApex;                           // [m] normal cone apex
    Vector3                 ConeAxis;                           // [-] normal cone direction
    float                   ConeCutoff;                         // [-] cone angle cosine cutoff
    uint32_t                VertexOffset;                       // [offset] index into vertex span
    uint32_t                TriangleOffset;                     // [offset] index into triangle index span
    uint32_t                TriangleCount;                      // [count] number of triangles in cluster
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  GEOMETRY STRUCTURE
//------------------------------------------------------------------------------------------------------------------------

class GeometryStructure
{
public:
    GeometryStructure() noexcept = default;
    ~GeometryStructure() noexcept = default;

    GeometryStructure(const GeometryStructure&) = delete;
    GeometryStructure& operator=(const GeometryStructure&) = delete;

    uint32_t                RegisterCluster(PolyhedralCluster Cluster) noexcept;
    void                    AppendVertices(const VertexRecord* Vertices, size_t Count) noexcept;
    void                    AppendIndices(const uint32_t* Indices, size_t Count) noexcept;

    [[nodiscard]] const std::vector<VertexRecord>&      QueryVertices() const noexcept { return m_Vertices; }
    [[nodiscard]] const std::vector<uint32_t>&          QueryIndices() const noexcept { return m_Indices; }
    [[nodiscard]] const std::vector<PolyhedralCluster>& QueryClusters() const noexcept { return m_Clusters; }

    // Single unified conversion operator for vertex count
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    std::vector<VertexRecord>      m_Vertices;                  // [vertices] contiguous vertex storage
    std::vector<uint32_t>          m_Indices;                   // [indices] 32-bit triangle indices
    std::vector<PolyhedralCluster> m_Clusters;                  // [clusters] spatial cluster descriptors
};

template<>
inline size_t GeometryStructure::Convert<size_t>() const noexcept
{
    return m_Vertices.size();
}

} // namespace Frontier
