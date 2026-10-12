//============================================================================================================================================
//                                                        DISTANCEFIELDGISTAGE.H
//============================================================================================================================================
// 📦 Owns immutable mesh-local samples, moving placement rows and bounded, raster-fed indirect-light transport.

#pragma once
#include <vulkan/vulkan.h>
#include "../GeometricRaster/DistanceFieldStructure.h"
#include <cstddef>
#include <string>

namespace Frontier
{
struct DistanceFieldStageInit
{
    VkPhysicalDevice                 PhysicalDevice = VK_NULL_HANDLE;
    VkDevice                         Device         = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    VkPipelineCache                  PipelineCache          = VK_NULL_HANDLE;
    VkDescriptorSetLayout            ShadowDescriptorLayout = VK_NULL_HANDLE;
    uint32_t                         QueueFamily            = 0u;
    uint32_t                         CycleSlotCount         = 2u;
    VkImageView                      OutputImageView        = VK_NULL_HANDLE;
    VkImageView                      SurfaceImageView       = VK_NULL_HANDLE;
    VkImageView                      NormalImageView        = VK_NULL_HANDLE;
    VkBuffer                         TriangleBuffer         = VK_NULL_HANDLE;
    VkBuffer                         MaterialBuffer         = VK_NULL_HANDLE;
    VkBuffer                         InstanceBuffer         = VK_NULL_HANDLE;
    VkBuffer                         SlabBuffer             = VK_NULL_HANDLE;
    VkBuffer                         VertexBuffer           = VK_NULL_HANDLE;
    VkBuffer                         IndexBuffer            = VK_NULL_HANDLE;
    VkSampler                        TableSampler           = VK_NULL_HANDLE;
    VkImageView                      EnergyLutView          = VK_NULL_HANDLE;
    VkImageView                      SheenLutView           = VK_NULL_HANDLE;
    VkSampler                        TextureSampler         = VK_NULL_HANDLE;
    const VkImageView*               TextureViews           = nullptr;
    uint32_t                         TextureCount           = 0u;
    uint32_t                         TextureCapacity        = 0u;
    bool                             TextureUpdateAfterBind = false;
    uint32_t                         ImageWidth             = 0u;
    uint32_t                         ImageHeight            = 0u;
    uint32_t                         CardResolution         = 4u;
    const DistanceFieldStructure*    Geometry               = nullptr;
    std::string                      SpirvDirectory         = "Engine/Shaders";
};

struct DistanceFieldFrameParams
{
    float    SunDirection[3]  = {0.1473f, -0.1179f, 0.9820f};
    float    SunRadiance      = 1.0f;
    float    SunColour[3]     = {1.0f, 0.96f, 0.90f};
    float    Exposure         = 1.0f;
    float    SkyAmbient[3]    = {0.05f, 0.07f, 0.12f};
    float    ShadowSoftness   = 0.22f;
    float    CameraEye[3]     = {0.0f, -5.0f, 2.0f};
    float    GiBoost          = 1.0f;
    uint64_t MaterialRevision = 0u;
    uint32_t FrameIndex       = 0u;
    uint32_t FeatureFlags     = 0u;
    uint32_t ReflectionMode   = 1u; // 0 = Off, 1 = Sky; hardware/software RT belongs to the RT route
    uint32_t CycleSlot        = 0u;
    VkDescriptorSet ShadowDescriptors = VK_NULL_HANDLE;
    uint32_t RenderWidth      = 1920u;
    uint32_t RenderHeight     = 1080u;
};

struct alignas(16) DistanceFieldPush
{
    float    Sun[4], SunColour[4], SkyExposure[4], Tuning[4], Eye[4];
    uint32_t Counts[4], RenderExtent[4];
};
static_assert(sizeof(DistanceFieldPush) == 112u);
static_assert(offsetof(DistanceFieldPush, Counts) == 80u);
static_assert(offsetof(DistanceFieldPush, RenderExtent) == 96u);

class DistanceFieldGIStage
{
  public:
    DistanceFieldGIStage() = default;
    ~DistanceFieldGIStage()
    {
        Destroy();
    }
    DistanceFieldGIStage(const DistanceFieldGIStage&)            = delete;
    DistanceFieldGIStage& operator=(const DistanceFieldGIStage&) = delete;
    DistanceFieldGIStage(DistanceFieldGIStage&&)                 = delete;
    DistanceFieldGIStage& operator=(DistanceFieldGIStage&&)      = delete;
    bool                  Bring(const DistanceFieldStageInit& Initialization) noexcept;
    void                  Destroy() noexcept;
    bool                  IsReady() const noexcept;
    static constexpr bool SelectsDistanceField(uint32_t Features) noexcept
    {
        return (Features & 1u) != 0u && (Features & (1u << 11u)) == 0u;
    }
    bool                  RecordFrame(VkCommandBuffer Command, const DistanceFieldFrameParams& Frame) noexcept;
    const std::string&    QueryRefusal() const
    {
        return Refusal;
    }
    // 📝 Borrowed readback handles for execution verification; owned and retired by this stage.
    VkBuffer QueryDistanceBuffer() const
    {
        return Buffers[0];
    }
    VkImage QueryRadianceImage() const
    {
        return CardImages[FrameNumber & 1u];
    }
    VkImage QueryDiffuseImage() const
    {
        return CardImages[2];
    }
    VkImage QueryNormalImage() const
    {
        return CardImages[3];
    }
    VkImage QueryEmissionImage() const
    {
        return CardImages[4];
    }
    uint32_t QueryCardWidth() const
    {
        return CardWidth;
    }
    uint32_t QueryCardHeight() const
    {
        return CardHeight;
    }
    uint32_t QueryVoxelCount() const
    {
        return VoxelCount;
    }

  private:
    bool                   Allocate(uint32_t Slot, VkDeviceSize Bytes);
    bool                   ConstructCardImages(uint32_t First = 0u);
    void                   RetireCardImages(uint32_t First);
    bool                   ConstructPipelines();
    bool                   WriteDescriptors();
    DistanceFieldStageInit Initialization{};
    VkBuffer               Buffers[6]{};
    VkDeviceMemory         Memory[6]{};
    VkDeviceSize           Sizes[6]{};
    VkDescriptorPool       Pool             = VK_NULL_HANDLE;
    VkDescriptorSetLayout  DescriptorLayout = VK_NULL_HANDLE;
    VkPipelineLayout       PipelineLayout   = VK_NULL_HANDLE;
    VkDescriptorSet        Sets[2]{};
    VkPipeline             Pipelines[4]{};
    VkQueryPool            Timestamps = VK_NULL_HANDLE;
    uint32_t               TimestampBits = 0u;
    float                  TimestampPeriod = 0.0f;
    bool                   RecordedSlots[3]{};
    float                  GpuDurations[4]{};
    VkImage                CardImages[7]{};
    VkImageView            CardViews[7]{};
    VkDeviceMemory         CardStorage[7]{};
    uint32_t               CardWidth = 0u, CardHeight = 0u;
    bool                   CardImagesInitialized = false;
    bool                   ScreenImagesInitialized = false;
    bool                   UploadPending = false;
    uint64_t               ResidentMaterials     = UINT64_MAX;
    uint32_t               VoxelCount = 0u, FrameNumber = 0u;
    uint64_t               ResidentRevision = 0u;
    uint64_t               ResidentPlacements = UINT64_MAX;
    uint64_t               ResidentCapture = UINT64_MAX;
    bool                   Ready = false;
    std::string            Refusal;
};
} // namespace Frontier
