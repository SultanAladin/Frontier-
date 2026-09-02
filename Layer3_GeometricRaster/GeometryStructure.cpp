//============================================================================================================================================
// 📦 Frontier/Layer3_GeometricRaster/GeometryStructure.cpp — Polyhedral Cluster Storage Implementation
//============================================================================================================================================

#include "GeometryStructure.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                GEOMETRY INGESTION
//------------------------------------------------------------------------------------------------------------------------

uint32_t GeometryStructure::RegisterCluster(PolyhedralCluster Cluster) noexcept
{
    uint32_t Index = static_cast<uint32_t>(m_Clusters.size());
    m_Clusters.push_back(Cluster);
    return Index;
}

void GeometryStructure::AppendVertices(const VertexRecord* Vertices, size_t Count) noexcept
{
    if (Vertices && Count > 0)
    {
        m_Vertices.insert(m_Vertices.end(), Vertices, Vertices + Count);
    }
}

void GeometryStructure::AppendIndices(const uint32_t* Indices, size_t Count) noexcept
{
    if (Indices && Count > 0)
    {
        m_Indices.insert(m_Indices.end(), Indices, Indices + Count);
    }
}

} // namespace Frontier
