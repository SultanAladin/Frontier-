//============================================================================================================================================
//                                                      SWAPCHAINEXCHANGE.H
//============================================================================================================================================
// 🧩 Vulkan instance, surface, device, swapchain and recording-slot transport across the hardware vendor edge.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "InputExchange.h"
#include "RayTracingCapabilitySet.h"
#include "OrientationClassifier.h"
#include "VisibilityExchange.h"
#include <cstdint>
#include <vector>
#include <array>

struct GLFWwindow;

namespace Frontier {

class SceneStructure;
class TraversalIndex;   // GeometricRaster/TraversalIndex.h (R3 CWBVH)

//------------------------------------------------------------------------------------------------------------------------
//                                              SWAPCHAIN CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

// Presentation pacing requested by the Control Centre Display tab; the swapchain maps it onto what the surface supports.
enum class PresentPacingCategory : uint32_t
{
    VerticalSyncOff      = 0,   // IMMEDIATE (tearing allowed) → MAILBOX → FIFO fallback
    VerticalSyncOn       = 1,   // FIFO (always available)
    VerticalSyncAdaptive = 2,   // FIFO_RELAXED → FIFO fallback
};

struct SwapchainConfiguration
{
    uint32_t    Width;                          // [px]  surface horizontal resolution
    uint32_t    Height;                         // [px]  surface vertical resolution
    const char* Title;                          // [-]   window title string
    bool        ValidationEnabled;              // [-]   Vulkan validation layer activation
};

//------------------------------------------------------------------------------------------------------------------------
//                             FACET STRUCTURE  (GPU SSBO — triangle geometry topology)
//
// Mechanism: three vertex positions + geometric normal + material slot index,
//    the minimal geometric facet of the Cornell Box mesh, packed as a contiguous
//    64-byte SSBO slot for GPU ray traversal.
//------------------------------------------------------------------------------------------------------------------------

struct TriangleIndex
{
    float    VertexAlphaX,  VertexAlphaY,  VertexAlphaZ;   // [m]   vertex α world position
    float    MaterialSlot;                                   // [-]   material index (uint reinterpreted)
    float    VertexBetaX,   VertexBetaY,   VertexBetaZ;    // [m]   vertex β world position
    float    TriangleSlot;                                   // [-]   triangle index (uint reinterpreted)
    float    VertexGammaX,  VertexGammaY,  VertexGammaZ;   // [m]   vertex γ world position
    float    _PadGamma;                                      // [-]   alignment
    float    NormalX,       NormalY,        NormalZ;         // [-]   geometric surface normal
    float    _PadNormal;                                     // [-]   alignment to 64 bytes
};

//------------------------------------------------------------------------------------------------------------------------
//                           RADIANCE STRUCTURE  (GPU SSBO — photometric surface topology)
//
// Mechanism: albedo reflectance, emissive radiance, roughness and metallic values
//    that define the surface's photometric behaviour, packed as a contiguous
//    48-byte SSBO slot for GPU shading.
//------------------------------------------------------------------------------------------------------------------------

struct RadianceStructure
{
    float    AlbedoR,    AlbedoG,    AlbedoB;               // [0..1]  diffuse surface reflectance
    float    Roughness;                                       // [0..1]  microfacet roughness
    float    EmissiveR,  EmissiveG,  EmissiveB;              // [lux]   self-emitted radiance
    float    Metallic;                                        // [0..1]  conductor parameter
    uint32_t Identifier;                                      // [-]     unique material slot index
    float    _Pad0, _Pad1, _Pad2;                            // [-]     alignment to 48 bytes
};

//------------------------------------------------------------------------------------------------------------------------
//                                    DISPATCH CONFIGURATION  (compute push constants)
//
// Mechanism: per-frame camera orientation and ReSTIR tuning scalars pushed
//    directly to the compute shader via vkCmdPushConstants — 80 bytes total.
//------------------------------------------------------------------------------------------------------------------------

struct DispatchConfiguration
{
    float    CameraOriginX,    CameraOriginY,    CameraOriginZ;  // [m]   camera world position
    float    FieldOfViewTanHalf;                                  // [-]   tan(α_FoV / 2)
    float    CameraForwardX,   CameraForwardY,   CameraForwardZ; // [-]   forward unit vector
    float    AspectRatio;                                          // [-]   width / height
    float    CameraRightX,     CameraRightY,     CameraRightZ;   // [-]   right unit vector
    float    Exposure;                                             // [-]   ACES tone-map exposure scalar
    float    CameraUpX,        CameraUpY,         CameraUpZ;     // [-]   up unit vector
    float    AmbientStrength;                                      // [-]   ambient fallback contribution
    uint32_t ViewportWidth;                                        // [px]  render width
    uint32_t ViewportHeight;                                       // [px]  render height
    uint32_t AccumulationIndex;                                    // [-]   temporal frame counter
    uint32_t SpatialPassCount;                                     // [-]   ReSTIR spatial resampling passes
    uint32_t CandidatesPerPixel;                                   // [-]   primary DI candidates per pixel
    uint32_t TriangleCount;                                        // [-]   total triangles in scene
    uint32_t LuminaireTriangleCount;                               // [-]   emissive triangles for DI sampling
    uint32_t FeatureFlags;                                         // [bit] DispatchFeature bits
};

// Bits of DispatchConfiguration::FeatureFlags — mirror kFeature* in ReSTIRViewport.slang.
enum DispatchFeature : uint32_t
{
    DispatchFeatureGlobalIllumination = 1u << 0,
    DispatchFeatureAntiAliasing       = 1u << 1,
    DispatchFeatureAmbientFloor       = 1u << 2    // debug fill light (R0: off by default)
};

// Mirrors `layout(push_constant) uniform ReSTIRConstants` in Engine/Shaders/ReSTIRViewport.slang.
//    vec3 + float pairs pack to 16 bytes each (4 × 16) followed by 8 uints (32) = 96 bytes.
static_assert(sizeof(DispatchConfiguration) == 96u, "DispatchConfiguration must match the shader push-constant block (96 bytes)");

//------------------------------------------------------------------------------------------------------------------------
//                                                  SWAPCHAIN EXCHANGE
//------------------------------------------------------------------------------------------------------------------------

class SwapchainExchange
{
public:
    explicit SwapchainExchange(const SwapchainConfiguration& InitialConfiguration) noexcept;
    ~SwapchainExchange() noexcept;

    SwapchainExchange(const SwapchainExchange&)            = delete;
    SwapchainExchange& operator=(const SwapchainExchange&) = delete;

    [[nodiscard]] bool  Bring()  noexcept;
    void                Retire() noexcept;

    void                        PollInput(InputExchange& TargetInput) noexcept;
    [[nodiscard]] bool          CloseRequested() const noexcept;

    void                        UploadTriangles   (const std::vector<TriangleIndex>&   Facets)    noexcept;
    void                        UploadRadiance (const std::vector<RadianceStructure>& Radiances) noexcept;

    // R2: the whole level becomes resident (vertices · indices · instances · clusters · materials · luminaires) and the
    //    interim kernel's flat triangle / material SSBOs are taken from the same SceneStructure — one upload, one truth.
    void                        UploadScene(const SceneStructure& Scene, const TraversalIndex& Traversal) noexcept;
    void                        UploadTraversal(const TraversalIndex& Traversal) noexcept;   // R3 CWBVH blobs → bindings 8-9

    // R2 frame front end (cull → visibility raster → HiZ → resolve) recorded before the kernel each frame.
    void                        AssignVisibilityFrame(const VisibilityFrameConfiguration& Frame) noexcept { VisibilityFrame = Frame; VisibilityFrameValid = true; }
    [[nodiscard]] const VisibilityTelemetry& QueryVisibilityTelemetry() const noexcept { return Visibility.QueryTelemetry(); }
    [[nodiscard]] uint32_t      QueryClusterCount() const noexcept { return Visibility.QueryClusterCount(); }
    [[nodiscard]] bool          QueryDrawIndirectCount() const noexcept { return DrawIndirectCountSupported; }

    void                        RecordAndPresent(const DispatchConfiguration& Dispatch) noexcept;

    void                        SignalResize() noexcept { ResizePending = true; }

    // Display settings (Step 5C). Each request is applied at the next present: pacing rebuilds the swapchain with the
    //    best supported VkPresentModeKHR; fullscreen toggles the GLFW window between the primary monitor's video mode
    //    and the remembered windowed rectangle (the resize callback then rebuilds the swapchain).
    void                        AssignPresentPacing(PresentPacingCategory Desired) noexcept;
    void                        AssignFullscreen(bool Desired) noexcept;
    [[nodiscard]] PresentPacingCategory QueryPresentPacing() const noexcept { return Pacing; }

    // Ray-tracing capability (plan v2.1 §3.4): probed once the physical device is chosen. The request comes from
    //    Slate.config.toml [render] ray_tracing_tier; the resolved tier is what the renderer must build for.
    void                        AssignRayTracingRequest(RayTracingRequestCategory Request) noexcept { RayTracingRequest = Request; }
    [[nodiscard]] const RayTracingCapabilitySet& QueryRayTracingCapabilities() const noexcept { return Capabilities; }
    [[nodiscard]] RayTracingTierCategory QueryRayTracingTier() const noexcept { return Capabilities.ResolveTier(RayTracingRequest); }
    [[nodiscard]] RayTracingRequestCategory QueryRayTracingRequest() const noexcept { return RayTracingRequest; }
    [[nodiscard]] bool          QueryFullscreen() const noexcept { return FullscreenActive; }
    [[nodiscard]] const char*   QueryPresentModeName() const noexcept;   // resolved VkPresentModeKHR, for diagnostics

    [[nodiscard]] uint32_t      QueryWidth()  const noexcept { return Configuration.Width;  }
    [[nodiscard]] uint32_t      QueryHeight() const noexcept { return Configuration.Height; }

    template<typename TargetType>
    [[nodiscard]] TargetType    Convert() const noexcept;

private:
    [[nodiscard]] bool  BringInstance()         noexcept;
    [[nodiscard]] bool  BringSurface()          noexcept;
    [[nodiscard]] bool  BringPhysicalDevice()   noexcept;
    [[nodiscard]] bool  BringLogicalDevice()    noexcept;
    [[nodiscard]] bool  BringSwapchain()        noexcept;
    [[nodiscard]] bool  BringStorageImage()     noexcept;
    [[nodiscard]] bool  BringComputePipeline()  noexcept;
    [[nodiscard]] bool  BringDescriptorSet()    noexcept;
    [[nodiscard]] bool  BringCommandRecording() noexcept;
    [[nodiscard]] bool  BringCycleSlots()       noexcept;
    [[nodiscard]] bool  BringImGui()            noexcept;
    [[nodiscard]] bool  BringVisibility()       noexcept;

    void                RetireSwapchain()       noexcept;
    [[nodiscard]] bool  RebuildSwapchain()      noexcept;
    [[nodiscard]] uint32_t ResolvePresentMode() const noexcept;   // VkPresentModeKHR as uint32_t (header stays Vulkan-free)

    void                RecordComputeCommands(uint32_t ImageOrdinal,
                                              const DispatchConfiguration& Dispatch) noexcept;
    void                WriteDescriptorSet()   noexcept;
    void                ConstructSceneBuffers() noexcept;

    [[nodiscard]] uint32_t ResolveMemoryType(uint32_t TypeMask, uint32_t PropertyMask) const noexcept;

    static void OnKey         (GLFWwindow*, int Key, int Scancode, int Action, int Mods) noexcept;
    static void OnMouseButton (GLFWwindow*, int Button, int Action, int Mods) noexcept;
    static void OnCursorMove  (GLFWwindow*, double X, double Y) noexcept;
    static void OnScroll      (GLFWwindow*, double OffsetX, double OffsetY) noexcept;
    static void OnFramebuffer (GLFWwindow*, int W, int H) noexcept;
    static void OnFocus       (GLFWwindow*, int Focused) noexcept;

    // Full Vulkan object lifetimes are owned by VulkanRecord, defined only in .cpp
    struct VulkanRecord;
    VulkanRecord*           Vulkan;             // [-]   heap-allocated Vulkan object lifetimes

    GLFWwindow*             GlfwWindow;         // [-]   GLFW window pointer
    SwapchainConfiguration  Configuration;      // [-]   runtime-tunable surface parameters
    bool                    ResizePending;       // [-]   framebuffer resize signal
    PresentPacingCategory   Pacing;              // [-]   requested pacing (default VerticalSyncOn)
    uint32_t                ResolvedPresentMode; // [-]   VkPresentModeKHR chosen at the last swapchain build
    bool                    FullscreenActive;    // [-]   window currently covers the primary monitor
    RayTracingCapabilitySet Capabilities;        // [-]   probed in BringPhysicalDevice
    VisibilityExchange      Visibility;          // [-]   R2 resident scene + cull / raster / HiZ / resolve
    bool                    TraversalResident = false;   // [-]   R3 CWBVH uploaded (kernel refuses to run without it)
    VisibilityFrameConfiguration VisibilityFrame{};
    bool                    VisibilityFrameValid = false;
    bool                    DrawIndirectCountSupported = false;   // [-] VkPhysicalDeviceVulkan12Features::drawIndirectCount
    RayTracingRequestCategory RayTracingRequest = RayTracingRequestCategory::Auto;
    int                     WindowedX, WindowedY, WindowedW, WindowedH;   // [px] rectangle to restore on leaving fullscreen

    InputExchange*          ForwardInput;        // [-]   target for GLFW callback forwarding (valid during PollInput)
    double                  PreviousCursorX;     // [px]  last known cursor horizontal position
    double                  PreviousCursorY;     // [px]  last known cursor vertical position
    bool                    CursorInitialised;   // [-]   first-movement delta suppression
    bool                    PendingInputReset;   // [-]   focus was lost; release every held key/button on next poll
};

template<>
inline bool SwapchainExchange::Convert<bool>() const noexcept
{
    return !CloseRequested();
}

template<>
inline uint32_t SwapchainExchange::Convert<uint32_t>() const noexcept
{
    return Configuration.Width;
}

} // namespace Frontier
