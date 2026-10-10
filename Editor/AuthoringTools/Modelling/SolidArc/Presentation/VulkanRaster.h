//============================================================================================================================================
//                                                      VULKANRASTER.H
//============================================================================================================================================
// 📦 Editor/AuthoringTools/Modelling/SolidArc/Presentation/VulkanRaster.h — GPU implementation of RasterExchange
//
//    SoftwareRaster executes the .slang bodies per fragment on the CPU (SlangMirror) and writes PNG proofs;
//    VulkanRaster executes the SAME .slang bodies (LatticeProjection.slang, LineRaster.slang, SurfaceRaster.slang, MatcapStudio.slang, PointRaster.slang)
//    as real Vulkan pipelines (compute + graphics) for the interactive viewport.
//
//    Why this exists: the viewport was suspected to run the CPU rasterizer (SoftwareRaster.cpp) even when a Vulkan
//    device was present — measured as SoftwareRaster::Detail::Triangle dispatch on the UI thread instead of
//    vkCmdDraw/vkCmdDispatch. This GPU path mirrors the software path's verbs but batches via Vulkan command buffers,
//    so SolidArc's primitive construction lines, gizmos and B/C bevel/chamfer previews run at viewport rate, not
//    proof-render rate.
//
//    Design — mirrors RasterExchange's Vulkan-shaped verbs:
//      • One graphics pipeline per .slang draw type (triangles, lines, points) — vertex shader = lattice projection,
//        fragment shader = matcap/line/point logic, both compiled from Slang → SPIRV → VkPipeline.
//      • Batching: DrawLattice/DrawSurface/DrawSegments/DrawPoints append to GPU buffers (vertex + index) and a
//        pending draw list; EndTarget() records a single render pass that replays them. No per-primitive vkCmdDispatch.
//      • Constructionlines (the interactive rectangle/line helpers during primitive creation before Enter/Esc) are
//        overlaid as line segments via DrawSegments with the same CameraProjection the interaction tool (ToolSession) used,
//        so the preview matches exactly what Enter commits (see https://sultanaladin.github.io/Frontier-/solidarc/).
//      • B/C bevel/chamfer like Plasticity: BlendSolver ops feed Surface streams; VulkanRaster shades them with the
//        same MatcapStudio.slang so the rounded preview is GPU-shaded.
//
//    Proofs (ConsoleHost) keep SoftwareRaster deliberately — deterministic, no device, PNG output. The interactive
//    EditorHost picks VulkanRaster when a device is available and falls back to SoftwareRaster otherwise. The
//    RasterExchange seam guarantees identical Tally/Pick results.
//
//    Usage (EditorHost):
//        std::unique_ptr<RasterExchange> raster = VulkanRaster::TryCreate(device, physicalDevice, width, height)
//                                                  ? std::make_unique<VulkanRaster>(...)
//                                                  : std::make_unique<SoftwareRaster>(...);
//        raster->BeginTarget(clear); raster->BindView(view); ScenePresentation::Draw...(*raster,...); raster->EndTarget();
//
//    Build: depends on Tools/Build/CompileShaders.py having emitted Presentation/Shaders/*.spv next to the .slang.
//============================================================================================================================================

#pragma once
#include "RasterExchange.h"
#include <memory>

namespace Frontier::SolidArc {

class VulkanRaster final : public RasterExchange
{
public:
    // TryCreate probes the Vulkan device for the presentation pipelines. Returns false if SPIRV missing or
    // pipelines refuse — caller falls back to SoftwareRaster and logs once (no hard failure).
    [[nodiscard]] static bool TryCreate(void* device, void* physicalDevice) noexcept;

    VulkanRaster(uint32_t width, uint32_t height) noexcept;
    ~VulkanRaster() override;

    void Resize(uint32_t w, uint32_t h) noexcept override;
    [[nodiscard]] uint32_t Width() const noexcept override;
    [[nodiscard]] uint32_t Height() const noexcept override;
    void AssignSamples(uint32_t s) noexcept override;
    [[nodiscard]] uint32_t QuerySamples() const noexcept override;
    void BeginTarget(const float clear[4]) noexcept override;
    void BindView(const ViewRecord& v) noexcept override;
    void BeginOverlay() noexcept override;
    void EndTarget() noexcept override;
    void DrawLattice() noexcept override;
    void DrawSurface(const SurfaceStream& s, const DrawRecord& d) noexcept override;
    void DrawSegments(const SegmentStream& s, const DrawRecord& d) noexcept override;
    void DrawPoints(const PointStream& s, const DrawRecord& d) noexcept override;
    [[nodiscard]] RasterImage Readback() const noexcept override;
    [[nodiscard]] uint32_t Pick(uint32_t x, uint32_t y) const noexcept override;
    [[nodiscard]] float Depth(uint32_t x, uint32_t y) const noexcept override;
    [[nodiscard]] Tally QueryTally() const noexcept override;

private:
    struct Detail;
    std::unique_ptr<Detail> Self;
};

} // namespace Frontier::SolidArc
