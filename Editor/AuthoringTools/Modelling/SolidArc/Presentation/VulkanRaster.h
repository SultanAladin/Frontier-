//============================================================================================================================================
// 📦 Editor/AuthoringTools/Modelling/SolidArc/Presentation/VulkanRaster.h — GPU implementation of RasterExchange on Vulkan (headless)
//============================================================================================================================================
// SolidArc's raster path on the GPU. Same verbs as SoftwareRaster (the CPU mirror), recorded into one Vulkan command buffer per
//    target and submitted at EndTarget. Shaders: SPIR-V generated from Presentation/Shaders/SolidArcVulkanEntries.slang
//    (Presentation/Generated/SolidArcSpirv.inc). No Vulkan types leak into this header, so the rest of SolidArc still builds
//    without the Vulkan SDK.
//
// Honest limits, all logged at runtime with the prefix [SolidArc/Vulkan]:
//    • Valid() is false when no Vulkan device exists. Nothing is faked: the caller must fall back or report the reason.
//    • Readback is copied to host memory at EndTarget (synchronous). Pick and Depth come from that copy.
//    • QueryTally counts triangles, segments and points only. Fragment, depth-reject and back-face counters are GPU-side
//      quantities this path does not read back, so they stay 0 and say so in the log.
//    • Matcap studios are evaluated analytically per fragment; the CPU mirror samples pre-rendered layers. Pixels agree only
//      in the analytic limit (see the proof README).
#pragma once

#include "RasterExchange.h"
#include <memory>
#include <string>

namespace Frontier
{

class VulkanRaster final : public RasterExchange
{
public:
    // Creates the instance, device, pipelines and offscreen targets. Never throws. On failure Valid() is false and
    //    FailureReason() says why (for example "no Vulkan loader or ICD").
    VulkanRaster(uint32_t Width, uint32_t Height) noexcept;
    ~VulkanRaster() override;

    [[nodiscard]] bool               Valid() const noexcept;
    [[nodiscard]] const std::string& FailureReason() const noexcept;
    [[nodiscard]] const std::string& DeviceName() const noexcept;
    [[nodiscard]] double             LastGpuMilliseconds() const noexcept;   // timestamp-query span of the last EndTarget

    void     Resize(uint32_t Width, uint32_t Height) noexcept override;
    uint32_t Width() const noexcept override;
    uint32_t Height() const noexcept override;

    void BeginTarget(const float ClearColour[4]) noexcept override;
    void BindView(const ViewRecord& View) noexcept override;
    void DrawLattice() noexcept override;
    void DrawSurface(const SurfaceStream& Stream, const DrawRecord& Draw) noexcept override;
    void DrawSegments(const SegmentStream& Stream, const DrawRecord& Draw) noexcept override;
    void DrawPoints(const PointStream& Stream, const DrawRecord& Draw) noexcept override;
    void BeginOverlay() noexcept override;
    void EndTarget() noexcept override;

    RasterImage Readback() const noexcept override;
    uint32_t    Pick(uint32_t X, uint32_t Y) const noexcept override;
    float       Depth(uint32_t X, uint32_t Y) const noexcept override;
    Tally       QueryTally() const noexcept override;

private:
    struct Detail;
    std::unique_ptr<Detail> Self;
};

} // namespace Frontier
