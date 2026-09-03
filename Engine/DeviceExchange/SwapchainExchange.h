//============================================================================================================================================
//                                                      SWAPCHAINEXCHANGE.H
//============================================================================================================================================
// 🧩 Vulkan instance, surface, device, swapchain and recording-slot transport across the hardware vendor edge.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "InputExchange.h"
#include "OrientationClassifier.h"
#include <cstdint>
#include <vector>
#include <array>

struct GLFWwindow;

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                              SWAPCHAIN CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

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
    float    _Pad;                                                 // [-]   alignment to 96 bytes
};

// Mirrors `layout(push_constant) uniform ReSTIRConstants` in Engine/Shaders/ReSTIRViewport.slang.
//    vec3 + float pairs pack to 16 bytes each (4 × 16) followed by 7 uints + 1 float (32) = 96 bytes.
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

    void                        RecordAndPresent(const DispatchConfiguration& Dispatch) noexcept;

    void                        SignalResize() noexcept { ResizePending = true; }

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

    void                RetireSwapchain()       noexcept;
    [[nodiscard]] bool  RebuildSwapchain()      noexcept;

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
