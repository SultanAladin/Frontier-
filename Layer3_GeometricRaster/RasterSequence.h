//============================================================================================================================================
// 📦 Frontier/Layer3_GeometricRaster/RasterSequence.h — Tile-Based Compute Software Rasterizer for Polyhedral Clusters
//============================================================================================================================================

#pragma once

#include "GeometryStructure.h"
#include "VisibilityProjection.h"
#include "../Layer0_DeviceExchange/TaskScheduler.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                   RASTER SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

class RasterSequence
{
public:
    explicit RasterSequence(TaskScheduler* Scheduler) noexcept;
    ~RasterSequence() noexcept = default;

    RasterSequence(const RasterSequence&) = delete;
    RasterSequence& operator=(const RasterSequence&) = delete;

    void                    RasterizeGeometry(const GeometryStructure& Geometry, uint32_t InstanceToken, const Matrix4x4& Transform, const Matrix4x4& ViewProj, VisibilityProjection& Target) noexcept;

    // Single unified conversion operator for scheduler reference check
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    void                    RasterizeTriangle(const Vector3& v0, const Vector3& v1, const Vector3& v2, uint32_t InstanceToken, uint32_t PrimitiveToken, VisibilityProjection& Target) noexcept;

    TaskScheduler*          m_Scheduler;                        // [ptr] worker task scheduler
};

template<>
inline bool RasterSequence::Convert<bool>() const noexcept
{
    return m_Scheduler != nullptr;
}

} // namespace Frontier
