//============================================================================================================================================
// 📦 Frontier/Layer3_GeometricRaster/VisibilityProjection.cpp — Visibility Projection Field Implementation
//============================================================================================================================================

#include "VisibilityProjection.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

VisibilityProjection::VisibilityProjection(uint32_t ExtentWidth, uint32_t ExtentHeight) noexcept
    : m_Width(ExtentWidth)
    , m_Height(ExtentHeight)
    , m_VisibilityField(ExtentWidth * ExtentHeight, 0xFFFFFFFFu)
    , m_DepthField(ExtentWidth * ExtentHeight, 1.0f)
{
}

void VisibilityProjection::ClearExtent() noexcept
{
    std::fill(m_VisibilityField.begin(), m_VisibilityField.end(), 0xFFFFFFFFu);
    std::fill(m_DepthField.begin(), m_DepthField.end(), 1.0f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                FIELD ACCESS OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

void VisibilityProjection::WritePixel(uint32_t x, uint32_t y, float Depth, VisibilityIdentifier Identifier) noexcept
{
    if (x < m_Width && y < m_Height)
    {
        size_t idx = static_cast<size_t>(y * m_Width + x);
        if (Depth < m_DepthField[idx])
        {
            m_DepthField[idx] = Depth;
            m_VisibilityField[idx] = Identifier.PackedIdentifier;
        }
    }
}

VisibilityIdentifier VisibilityProjection::QueryPixel(uint32_t x, uint32_t y) const noexcept
{
    if (x < m_Width && y < m_Height)
    {
        return VisibilityIdentifier{ m_VisibilityField[y * m_Width + x] };
    }
    return VisibilityIdentifier{ 0xFFFFFFFFu };
}

float VisibilityProjection::QueryDepth(uint32_t x, uint32_t y) const noexcept
{
    if (x < m_Width && y < m_Height)
    {
        return m_DepthField[y * m_Width + x];
    }
    return 1.0f;
}

} // namespace Frontier
