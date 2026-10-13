//============================================================================================================================================
//                                                            SMOKEEXCHANGE.H
//============================================================================================================================================
// 📦 On-demand world-space fine gas images, bounded Vulkan transport and opaque-depth-clipped linear-radiance presentation.

#pragma once

#include "../ProjectInterchange/SmokeTransportInterchange.h"
#include "../DisplayPresentation/VolumeRaymarch.h"

#include <vulkan/vulkan.h>
#include <array>
#include <string>
#include <vector>

namespace Frontier
{

struct SmokeDeviceSpecification
{
    VkPhysicalDevice                 PhysicalDevice = VK_NULL_HANDLE;
    VkDevice                         Device         = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    uint32_t                         FineExtent     = 64u;      // [cells] - fixed while resident; 64 or 128
    uint32_t                         CycleSlotCount = 2u;       // [-]     - completion-gated upload reuse
    uint64_t                         ByteAllowance  = 40000000; // [B]     - explicit per-domain ceiling
    std::string                      SpirvLocation  = "Engine/Shaders";
};

struct SmokeProjection
{
    float Eye[4]     = {0.0f, -8.0f, 4.0f, 0.57735027f}; // [m,-] - origin and tan(vertical half-aperture)
    float Forward[4] = {0.0f, 1.0f, 0.0f, 1.0f};        // [-]   - sight and exposure
    float Right[4]   = {1.0f, 0.0f, 0.0f, 1.0f};        // [-]   - right and colour saturation
    float Up[4]      = {0.0f, 0.0f, 1.0f, 0.0f};        // [-]   - up; w requests albedo remodulation
    uint32_t Width  = 0u;                                // [px]  - current rendered viewport width
    uint32_t Height = 0u;                                // [px]  - current rendered viewport height
    uint32_t RaySamples = 96u;                           // [-]   - bounded primary quadrature
    uint32_t ColourTransfer = 0u;                        // [-]   - 0 ACES, 1 diagnostic gamma, 2 Reinhard
    VolumeLighting Lighting;
};

struct SmokeDeviceMetrics
{
    uint64_t Acquisitions       = 0u;  // [-]  - expensive domain acquisitions, never vehicle spawns
    uint64_t Retirements        = 0u;  // [-]  - completed releases
    uint64_t TransportTicks     = 0u;  // [-]  - fine visual advances
    uint64_t Relocations        = 0u;  // [-]  - integral world shifts
    uint64_t HeldBytes          = 0u;  // [B]  - charged VkMemoryRequirements extents
    uint64_t UploadBytes        = 0u;  // [B]  - latest completed velocity/source upload
    double   TransportMilliseconds = 0.0; // [ms] - completion-gated device timestamps
    double   RenderMilliseconds    = 0.0; // [ms] - completion-gated device timestamps
};

class SmokeExchange
{
public:
    SmokeExchange() = default;
    ~SmokeExchange();
    SmokeExchange(const SmokeExchange&) = delete;
    SmokeExchange& operator=(const SmokeExchange&) = delete;

    bool Construct(const SmokeDeviceSpecification& Specification);
    bool Capture(const FrontierProjectSmokeReading& Scalar, const FrontierSmokeTransportReading& Transport);
    bool RecordTransport(VkCommandBuffer Command, uint32_t CycleSlot);
    bool RecordProjection(
        VkCommandBuffer        Command,
        uint32_t               CycleSlot,
        VkImageView            LinearRadiance,
        VkImageView            Surface,
        VkImageView            Albedo,
        VkImageView            Presentation,
        const SmokeProjection& Projection);
    void ReadCompleted(uint32_t CycleSlot);
    void Reclaim();

    const std::string& QueryRefusal() const noexcept { return Refusal; }
    const SmokeDeviceMetrics& QueryMetrics() const noexcept { return Measurements; }
    bool Resident() const noexcept { return VolumeImages[0] != VK_NULL_HANDLE; }
    VkImage QueryVolumeImage() const noexcept { return VolumeImages[CurrentVolume]; }

private:
    struct TransferSpace
    {
        VkBuffer       Transfer = VK_NULL_HANDLE;
        VkDeviceMemory Storage  = VK_NULL_HANDLE;
        void*          Mapped   = nullptr;
        VkDeviceSize   Bytes    = 0u;
    };

    bool AcquireDomain();
    void RetireDomain();
    bool ConstructTransfer(TransferSpace& Extent, VkDeviceSize Bytes, VkBufferUsageFlags Usage);
    void ReclaimTransfer(TransferSpace& Extent);
    bool ConstructProgram(const char* Name, VkPipelineLayout Layout, VkPipeline& Program);
    bool ConstructDescriptors();
    bool Refuse(const char* Explanation);

    SmokeDeviceSpecification Initialization;
    SmokeDeviceMetrics       Measurements;
    std::string              Refusal;
    FrontierSmokeTransportReading Pending{};
    std::vector<float> PendingVelocity;
    uint64_t LastCarrier  = 0u;
    uint64_t LastRevision = 0u;
    float PreviousOrigin[3]{};
    float VisualSeconds = 0.0f;
    uint32_t CurrentVolume = 0u;
    bool ImagesInitialized = false;

    VkImage        VolumeImages[2]  = {VK_NULL_HANDLE, VK_NULL_HANDLE};
    VkImageView    VolumeViews[2]   = {VK_NULL_HANDLE, VK_NULL_HANDLE};
    VkDeviceMemory VolumeStorage[2] = {VK_NULL_HANDLE, VK_NULL_HANDLE};
    TransferSpace Coverage;
    std::vector<TransferSpace> VelocityTransfers, SourceTransfers, ParameterTransfers;
    std::vector<std::array<VkDescriptorSet, 2>> TransportDescriptors, ProjectionDescriptors;
    VkDescriptorPool      Descriptors      = VK_NULL_HANDLE;
    VkDescriptorSetLayout TransportLayout  = VK_NULL_HANDLE;
    VkDescriptorSetLayout ProjectionLayout = VK_NULL_HANDLE;
    VkPipelineLayout      TransportProgramLayout  = VK_NULL_HANDLE;
    VkPipelineLayout      ProjectionProgramLayout = VK_NULL_HANDLE;
    VkPipeline            TransportProgram        = VK_NULL_HANDLE;
    VkPipeline            ProjectionProgram       = VK_NULL_HANDLE;
    VkSampler             VolumeSampler           = VK_NULL_HANDLE;
    VkQueryPool           Timestamps              = VK_NULL_HANDLE;
    float TimestampPeriod = 1.0f;
    std::vector<uint32_t> RecordedTimestamps;
};

} // namespace Frontier
