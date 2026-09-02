//============================================================================================================================================
// 📦 Frontier/Layer4_PhotometricIllumination/ClusteredSpace.cpp — Cluster Light Binning Implementation
//============================================================================================================================================

#include "ClusteredSpace.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

ClusteredSpace::ClusteredSpace(uint32_t SlicesX, uint32_t SlicesY, uint32_t SlicesZ) noexcept
    : m_SlicesX(SlicesX)
    , m_SlicesY(SlicesY)
    , m_SlicesZ(SlicesZ)
    , m_Clusters(SlicesX * SlicesY * SlicesZ, ClusterRecord{ 0, 0 })
{
}

//------------------------------------------------------------------------------------------------------------------------
//                                                BINNING OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

void ClusteredSpace::BinLights(const std::vector<PhotometricLightRecord>& Lights, const Matrix4x4& ViewProj) noexcept
{
    (void)ViewProj;
    m_ActiveLightIndices.clear();

    for (size_t i = 0; i < Lights.size(); ++i)
    {
        m_ActiveLightIndices.push_back(static_cast<uint32_t>(i));
    }

    uint32_t TotalLightCount = static_cast<uint32_t>(Lights.size());
    for (auto& cluster : m_Clusters)
    {
        cluster.LightOffset = 0;
        cluster.LightCount = TotalLightCount;
    }
}

ClusterRecord ClusteredSpace::QueryCluster(uint32_t x, uint32_t y, uint32_t z) const noexcept
{
    if (x < m_SlicesX && y < m_SlicesY && z < m_SlicesZ)
    {
        return m_Clusters[z * (m_SlicesX * m_SlicesY) + y * m_SlicesX + x];
    }
    return ClusterRecord{ 0, 0 };
}

} // namespace Frontier
