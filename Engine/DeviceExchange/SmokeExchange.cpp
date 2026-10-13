//============================================================================================================================================
//                                                            SMOKEEXCHANGE.CPP
//============================================================================================================================================
// 📦 Lazy bounded Vulkan gas residency, completion-gated snapshots, exact cell scrolling and linear scene/volume resolve.

#include "SmokeExchange.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>

namespace Frontier
{

namespace
{

struct alignas(16) TransportSpecification
{
    float OriginSpan[4];
    float Rates[4];
    float ChassisPosition[4];
    float ChassisInverse[4];
    float ChassisMinimum[4];
    float ChassisMaximum[4];
    float SourceMinimum[4];
    float SourceMaximum[4];
};
static_assert(sizeof(TransportSpecification) == 128u);
static_assert(sizeof(FrontierSmokeInjection) == 48u);

struct alignas(16) TransportCycle
{
    float PreviousOriginTime[4];
    uint32_t Counts[4];
};
static_assert(sizeof(TransportCycle) == 32u);

struct alignas(16) ProjectionSpecification
{
    float Eye[4], Forward[4], Right[4], Up[4], OriginSpan[4], Optical[4], Sun[4];
    uint32_t Counts[4];
};
static_assert(sizeof(ProjectionSpecification) == 128u);

VkImageMemoryBarrier ImageBarrier(VkImage Image, VkImageLayout Previous, VkImageLayout Current,
                                  VkAccessFlags Source, VkAccessFlags Target)
{
    VkImageMemoryBarrier Barrier{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    Barrier.oldLayout                       = Previous;
    Barrier.newLayout                       = Current;
    Barrier.srcQueueFamilyIndex             = VK_QUEUE_FAMILY_IGNORED;
    Barrier.dstQueueFamilyIndex             = VK_QUEUE_FAMILY_IGNORED;
    Barrier.image                           = Image;
    Barrier.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
    Barrier.subresourceRange.levelCount     = 1u;
    Barrier.subresourceRange.layerCount     = 1u;
    Barrier.srcAccessMask                   = Source;
    Barrier.dstAccessMask                   = Target;
    return Barrier;
}

} // namespace

SmokeExchange::~SmokeExchange()
{
    Reclaim();
}

bool SmokeExchange::Refuse(const char* Explanation)
{
    Refusal = Explanation;
    return false;
}

bool SmokeExchange::Construct(const SmokeDeviceSpecification& Specification)
{
    if (Resident()) return Refuse("smoke quality cannot change while a live plume holds its fixed cell size");
    if (!Specification.Device || !Specification.PhysicalDevice ||
        (Specification.FineExtent != 64u && Specification.FineExtent != 128u) ||
        Specification.CycleSlotCount < 1u || Specification.CycleSlotCount > 4u)
        return Refuse("smoke device specification is incomplete or outside its bounded quality allowance");
    Initialization = Specification;
    if (!Initialization.MemoryProperties.memoryTypeCount)
        vkGetPhysicalDeviceMemoryProperties(Initialization.PhysicalDevice, &Initialization.MemoryProperties);
    Refusal.clear();
    return true;
}

bool SmokeExchange::ConstructTransfer(TransferSpace& Extent, VkDeviceSize Bytes, VkBufferUsageFlags Usage)
{
    VkBufferCreateInfo Information{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    Information.size  = Bytes;
    Information.usage = Usage;
    if (vkCreateBuffer(Initialization.Device, &Information, nullptr, &Extent.Transfer) != VK_SUCCESS)
        return Refuse("smoke transfer creation refused");
    VkMemoryRequirements Requirements{};
    vkGetBufferMemoryRequirements(Initialization.Device, Extent.Transfer, &Requirements);
    uint32_t Selection = UINT32_MAX;
    for (uint32_t Index = 0u; Index < Initialization.MemoryProperties.memoryTypeCount; ++Index)
        if ((Requirements.memoryTypeBits & (1u << Index)) &&
            (Initialization.MemoryProperties.memoryTypes[Index].propertyFlags &
             (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)) ==
            (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))
        {
            Selection = Index;
            break;
        }
    if (Selection == UINT32_MAX) return Refuse("smoke requires coherent completion-gated host uploads");
    if (Measurements.HeldBytes + Requirements.size > Initialization.ByteAllowance)
        return Refuse("smoke transfer exceeds the domain byte allowance");
    VkMemoryAllocateInfo Storage{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    Storage.allocationSize  = Requirements.size;
    Storage.memoryTypeIndex = Selection;
    if (vkAllocateMemory(Initialization.Device, &Storage, nullptr, &Extent.Storage) != VK_SUCCESS ||
        vkBindBufferMemory(Initialization.Device, Extent.Transfer, Extent.Storage, 0u) != VK_SUCCESS ||
        vkMapMemory(Initialization.Device, Extent.Storage, 0u, Bytes, 0u, &Extent.Mapped) != VK_SUCCESS)
        return Refuse("smoke transfer storage acquisition refused");
    Extent.Bytes = Requirements.size;
    Measurements.HeldBytes += Requirements.size;
    return true;
}

void SmokeExchange::ReclaimTransfer(TransferSpace& Extent)
{
    if (Extent.Mapped) vkUnmapMemory(Initialization.Device, Extent.Storage);
    if (Extent.Transfer) vkDestroyBuffer(Initialization.Device, Extent.Transfer, nullptr);
    if (Extent.Storage) vkFreeMemory(Initialization.Device, Extent.Storage, nullptr);
    Extent = {};
}

bool SmokeExchange::ConstructProgram(const char* Name, VkPipelineLayout Layout, VkPipeline& Program)
{
    std::ifstream Stream(Initialization.SpirvLocation + "/" + Name + ".spv", std::ios::binary | std::ios::ate);
    const auto Bytes = Stream ? Stream.tellg() : std::streampos(0);
    if (Bytes <= 0 || static_cast<uint64_t>(Bytes) % sizeof(uint32_t)) return Refuse("smoke SPIR-V is missing or malformed");
    std::vector<uint32_t> Instructions(static_cast<size_t>(Bytes) / sizeof(uint32_t));
    Stream.seekg(0);
    Stream.read(reinterpret_cast<char*>(Instructions.data()), Bytes);
    if (!Stream || Instructions.front() != 0x07230203u) return Refuse("smoke SPIR-V content refused");
    VkShaderModuleCreateInfo Shader{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    Shader.codeSize = static_cast<size_t>(Bytes);
    Shader.pCode    = Instructions.data();
    VkShaderModule Code = VK_NULL_HANDLE;
    if (vkCreateShaderModule(Initialization.Device, &Shader, nullptr, &Code) != VK_SUCCESS)
        return Refuse("smoke shader creation refused");
    VkComputePipelineCreateInfo Information{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    Information.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    Information.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
    Information.stage.module = Code;
    Information.stage.pName  = "main";
    Information.layout      = Layout;
    const auto Delivered = vkCreateComputePipelines(Initialization.Device, VK_NULL_HANDLE, 1u, &Information, nullptr, &Program);
    vkDestroyShaderModule(Initialization.Device, Code, nullptr);
    return Delivered == VK_SUCCESS || Refuse("smoke compute program creation refused");
}

bool SmokeExchange::ConstructDescriptors()
{
    const VkDescriptorType TransportTypes[] =
    {
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
    };
    const VkDescriptorType ProjectionTypes[] =
    {
        VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,
        VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
    };
    for (uint32_t Subject = 0u; Subject < 2u; ++Subject)
    {
        std::array<VkDescriptorSetLayoutBinding, 6> Slots{};
        for (uint32_t Index = 0u; Index < Slots.size(); ++Index)
            Slots[Index] = {Index, Subject == 0u ? TransportTypes[Index] : ProjectionTypes[Index], 1u,
                            VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        VkDescriptorSetLayoutCreateInfo Declaration{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        Declaration.bindingCount = static_cast<uint32_t>(Slots.size());
        Declaration.pBindings    = Slots.data();
        auto& DescriptorLayout = Subject == 0u ? TransportLayout : ProjectionLayout;
        if (vkCreateDescriptorSetLayout(Initialization.Device, &Declaration, nullptr, &DescriptorLayout) != VK_SUCCESS)
            return Refuse("smoke descriptor declaration refused");
        VkPushConstantRange Constants{VK_SHADER_STAGE_COMPUTE_BIT, 0u, Subject == 0u ? 32u : 128u};
        VkPipelineLayoutCreateInfo ProgramDeclaration{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        ProgramDeclaration.setLayoutCount         = 1u;
        ProgramDeclaration.pSetLayouts            = &DescriptorLayout;
        ProgramDeclaration.pushConstantRangeCount = 1u;
        ProgramDeclaration.pPushConstantRanges    = &Constants;
        auto& ProgramLayout = Subject == 0u ? TransportProgramLayout : ProjectionProgramLayout;
        if (vkCreatePipelineLayout(Initialization.Device, &ProgramDeclaration, nullptr, &ProgramLayout) != VK_SUCCESS)
            return Refuse("smoke program declaration refused");
    }
    const uint32_t Slots = Initialization.CycleSlotCount * 2u;
    const VkDescriptorPoolSize Counts[] =
    {
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, Slots * 4u}, {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, Slots},
        {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, Slots * 3u}, {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, Slots * 4u},
    };
    VkDescriptorPoolCreateInfo Capacity{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    Capacity.maxSets       = Slots * 2u;
    Capacity.poolSizeCount = 4u;
    Capacity.pPoolSizes    = Counts;
    if (vkCreateDescriptorPool(Initialization.Device, &Capacity, nullptr, &Descriptors) != VK_SUCCESS)
        return Refuse("smoke descriptor capacity acquisition refused");
    TransportDescriptors.resize(Initialization.CycleSlotCount);
    ProjectionDescriptors.resize(Initialization.CycleSlotCount);
    for (uint32_t Cycle = 0u; Cycle < Initialization.CycleSlotCount; ++Cycle)
        for (uint32_t Subject = 0u; Subject < 2u; ++Subject)
        {
            const VkDescriptorSetLayout Declarations[] =
            {
                Subject == 0u ? TransportLayout : ProjectionLayout,
                Subject == 0u ? TransportLayout : ProjectionLayout,
            };
            VkDescriptorSetAllocateInfo Selection{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
            Selection.descriptorPool     = Descriptors;
            Selection.descriptorSetCount = 2u;
            Selection.pSetLayouts        = Declarations;
            auto& Destination = Subject == 0u ? TransportDescriptors[Cycle] : ProjectionDescriptors[Cycle];
            if (vkAllocateDescriptorSets(Initialization.Device, &Selection, Destination.data()) != VK_SUCCESS)
                return Refuse("smoke descriptor selection refused");
        }
    return ConstructProgram("SmokeTransport", TransportProgramLayout, TransportProgram) &&
           ConstructProgram("SmokeViewport", ProjectionProgramLayout, ProjectionProgram);
}

bool SmokeExchange::AcquireDomain()
{
    VkFormatProperties Capabilities{};
    vkGetPhysicalDeviceFormatProperties(Initialization.PhysicalDevice, VK_FORMAT_R16G16B16A16_SFLOAT, &Capabilities);
    const VkFormatFeatureFlags Required = VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT | VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT |
                                         VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT;
    if ((Capabilities.optimalTilingFeatures & Required) != Required)
        return Refuse("smoke requires linearly sampled rgba16f 3D storage images");
    const uint32_t Extent = Initialization.FineExtent;
    for (uint32_t Slot = 0u; Slot < 2u; ++Slot)
    {
        VkImageCreateInfo Image{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        Image.imageType     = VK_IMAGE_TYPE_3D;
        Image.format        = VK_FORMAT_R16G16B16A16_SFLOAT;
        Image.extent        = {Extent, Extent, Extent};
        Image.mipLevels     = Image.arrayLayers = 1u;
        Image.samples       = VK_SAMPLE_COUNT_1_BIT;
        Image.tiling        = VK_IMAGE_TILING_OPTIMAL;
        Image.usage         = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT |
                              VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
        if (vkCreateImage(Initialization.Device, &Image, nullptr, &VolumeImages[Slot]) != VK_SUCCESS)
            return Refuse("smoke fine image creation refused");
        VkMemoryRequirements Requirements{};
        vkGetImageMemoryRequirements(Initialization.Device, VolumeImages[Slot], &Requirements);
        uint32_t Selection = UINT32_MAX;
        for (uint32_t Index = 0u; Index < Initialization.MemoryProperties.memoryTypeCount; ++Index)
            if ((Requirements.memoryTypeBits & (1u << Index)) &&
                (Initialization.MemoryProperties.memoryTypes[Index].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT))
            {
                Selection = Index;
                break;
            }
        if (Selection == UINT32_MAX || Measurements.HeldBytes + Requirements.size > Initialization.ByteAllowance)
            return Refuse("smoke fine image exceeds its device-memory allowance");
        VkMemoryAllocateInfo ExtentStorage{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ExtentStorage.allocationSize  = Requirements.size;
        ExtentStorage.memoryTypeIndex = Selection;
        if (vkAllocateMemory(Initialization.Device, &ExtentStorage, nullptr, &VolumeStorage[Slot]) != VK_SUCCESS ||
            vkBindImageMemory(Initialization.Device, VolumeImages[Slot], VolumeStorage[Slot], 0u) != VK_SUCCESS)
            return Refuse("smoke fine image storage acquisition refused");
        Measurements.HeldBytes += Requirements.size;
        VkImageViewCreateInfo View{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        View.image       = VolumeImages[Slot];
        View.viewType    = VK_IMAGE_VIEW_TYPE_3D;
        View.format      = Image.format;
        View.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        View.subresourceRange.levelCount = 1u;
        View.subresourceRange.layerCount = 1u;
        if (vkCreateImageView(Initialization.Device, &View, nullptr, &VolumeViews[Slot]) != VK_SUCCESS)
            return Refuse("smoke fine image view creation refused");
    }
    VkSamplerCreateInfo Sampler{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    Sampler.magFilter = Sampler.minFilter = VK_FILTER_LINEAR;
    Sampler.addressModeU = Sampler.addressModeV = Sampler.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER;
    Sampler.borderColor = VK_BORDER_COLOR_FLOAT_TRANSPARENT_BLACK;
    if (vkCreateSampler(Initialization.Device, &Sampler, nullptr, &VolumeSampler) != VK_SUCCESS)
        return Refuse("smoke volume sampler acquisition refused");
    VelocityTransfers.resize(Initialization.CycleSlotCount);
    SourceTransfers.resize(Initialization.CycleSlotCount);
    ParameterTransfers.resize(Initialization.CycleSlotCount);
    for (uint32_t Slot = 0u; Slot < Initialization.CycleSlotCount; ++Slot)
        if (!ConstructTransfer(VelocityTransfers[Slot], 32u * 32u * 32u * 4u * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT) ||
            !ConstructTransfer(SourceTransfers[Slot], sizeof(Pending.Sources), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT) ||
            !ConstructTransfer(ParameterTransfers[Slot], sizeof(TransportSpecification), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT)) return false;
    if (!ConstructTransfer(Coverage, 32u, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT)) return false;
    std::fill_n(static_cast<uint32_t*>(Coverage.Mapped), 4u, Initialization.FineExtent);
    std::fill_n(static_cast<uint32_t*>(Coverage.Mapped) + 4u, 4u, 0u);
    if (!ConstructDescriptors()) return false;
    VkPhysicalDeviceProperties Properties{};
    vkGetPhysicalDeviceProperties(Initialization.PhysicalDevice, &Properties);
    TimestampPeriod = Properties.limits.timestampPeriod;
    VkQueryPoolCreateInfo Clock{VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
    Clock.queryType  = VK_QUERY_TYPE_TIMESTAMP;
    Clock.queryCount = Initialization.CycleSlotCount * 4u;
    if (Properties.limits.timestampComputeAndGraphics)
        if (vkCreateQueryPool(Initialization.Device, &Clock, nullptr, &Timestamps) != VK_SUCCESS) Timestamps = VK_NULL_HANDLE;
    RecordedTimestamps.assign(Initialization.CycleSlotCount, 0u);
    ++Measurements.Acquisitions;
    ImagesInitialized = false;
    CurrentVolume     = 0u;
    LastRevision      = 0u;
    VisualSeconds     = 0.0f;
    return true;
}

void SmokeExchange::RetireDomain()
{
    if (!Initialization.Device) return;
    const bool Held = VolumeImages[0] != VK_NULL_HANDLE || VolumeImages[1] != VK_NULL_HANDLE;
    if (Held) vkDeviceWaitIdle(Initialization.Device);
    if (Timestamps) vkDestroyQueryPool(Initialization.Device, Timestamps, nullptr);
    if (Descriptors) vkDestroyDescriptorPool(Initialization.Device, Descriptors, nullptr);
    if (TransportProgram) vkDestroyPipeline(Initialization.Device, TransportProgram, nullptr);
    if (ProjectionProgram) vkDestroyPipeline(Initialization.Device, ProjectionProgram, nullptr);
    if (TransportProgramLayout) vkDestroyPipelineLayout(Initialization.Device, TransportProgramLayout, nullptr);
    if (ProjectionProgramLayout) vkDestroyPipelineLayout(Initialization.Device, ProjectionProgramLayout, nullptr);
    if (TransportLayout) vkDestroyDescriptorSetLayout(Initialization.Device, TransportLayout, nullptr);
    if (ProjectionLayout) vkDestroyDescriptorSetLayout(Initialization.Device, ProjectionLayout, nullptr);
    if (VolumeSampler) vkDestroySampler(Initialization.Device, VolumeSampler, nullptr);
    ReclaimTransfer(Coverage);
    for (auto& Extent : VelocityTransfers) ReclaimTransfer(Extent);
    for (auto& Extent : SourceTransfers) ReclaimTransfer(Extent);
    for (auto& Extent : ParameterTransfers) ReclaimTransfer(Extent);
    for (uint32_t Slot = 0u; Slot < 2u; ++Slot)
    {
        if (VolumeViews[Slot]) vkDestroyImageView(Initialization.Device, VolumeViews[Slot], nullptr);
        if (VolumeImages[Slot]) vkDestroyImage(Initialization.Device, VolumeImages[Slot], nullptr);
        if (VolumeStorage[Slot]) vkFreeMemory(Initialization.Device, VolumeStorage[Slot], nullptr);
        VolumeViews[Slot]   = VK_NULL_HANDLE;
        VolumeImages[Slot]  = VK_NULL_HANDLE;
        VolumeStorage[Slot] = VK_NULL_HANDLE;
    }
    Timestamps = VK_NULL_HANDLE;
    Descriptors = VK_NULL_HANDLE;
    TransportProgram = ProjectionProgram = VK_NULL_HANDLE;
    TransportProgramLayout = ProjectionProgramLayout = VK_NULL_HANDLE;
    TransportLayout = ProjectionLayout = VK_NULL_HANDLE;
    VolumeSampler = VK_NULL_HANDLE;
    VelocityTransfers.clear(); SourceTransfers.clear(); ParameterTransfers.clear();
    TransportDescriptors.clear(); ProjectionDescriptors.clear(); RecordedTimestamps.clear();
    std::vector<float>().swap(PendingVelocity);
    Measurements.HeldBytes   = 0u;
    Measurements.UploadBytes = 0u;
    ImagesInitialized        = false;
    LastRevision             = 0u;
    LastCarrier              = 0u;
    if (Held) ++Measurements.Retirements;
}

void SmokeExchange::Reclaim()
{
    RetireDomain();
    Pending = {};
}

bool SmokeExchange::Capture(const FrontierProjectSmokeReading& Scalar, const FrontierSmokeTransportReading& Transport)
{
    Refusal.clear();
    if (Scalar.Extent == 0u)
    {
        RetireDomain();
        Pending = {};
        return true;
    }
    if (Transport.StructureSize != sizeof(Transport) || Transport.InterchangeNumber != FrontierSmokeTransportNumber ||
        Transport.Extent != 32u || Transport.Extent != Scalar.Extent || Transport.Capacity < 32u * 32u * 32u ||
        !Transport.VelocityOccupancy || Transport.CarrierIdentifier == 0u || Transport.CarrierIdentifier != Scalar.CarrierIdentifier ||
        Transport.Revision != Scalar.Revision || Transport.Span != Scalar.Span || Transport.CompletedTicks > 6u ||
        Transport.SourceCount > FrontierSmokeSourceCeiling ||
        !std::equal(std::begin(Scalar.Origin), std::end(Scalar.Origin), std::begin(Transport.Origin)))
        return Refuse("smoke transport does not match the completed caller-owned scalar snapshot");
    if (Transport.Revision == 0u || Transport.SourceOffsets[0] != 0u ||
        Transport.SourceOffsets[Transport.CompletedTicks] != Transport.SourceCount)
        return Refuse("smoke completed-tick source ranges are incomplete");
    for (uint32_t Tick = 0u; Tick < Transport.CompletedTicks; ++Tick)
        if (Transport.SourceOffsets[Tick] > Transport.SourceOffsets[Tick + 1u])
            return Refuse("smoke completed-tick source ranges are not ordered");
    double QuaternionNorm = 0.0;
    for (uint32_t Component = 0u; Component < 4u; ++Component)
    {
        if (!std::isfinite(Transport.ChassisPosition[Component]) || !std::isfinite(Transport.ChassisInverse[Component]) ||
            !std::isfinite(Transport.ChassisMinimum[Component]) || !std::isfinite(Transport.ChassisMaximum[Component]))
            return Refuse("smoke chassis obstruction contains nonfinite pose or bounds");
        QuaternionNorm += double(Transport.ChassisInverse[Component]) * Transport.ChassisInverse[Component];
        if (Component < 3u && Transport.ChassisMinimum[Component] > Transport.ChassisMaximum[Component])
            return Refuse("smoke chassis obstruction bounds are reversed");
    }
    if (std::abs(QuaternionNorm - 1.0) > 0.001) return Refuse("smoke chassis inverse quaternion is not unit length");
    if (!(Transport.Span > 0.0f) || !std::isfinite(Transport.Span) ||
        !std::isfinite(Transport.SmokeLoss) || Transport.SmokeLoss < 0.0f ||
        !std::isfinite(Transport.Cooling) || Transport.Cooling < 0.0f)
        return Refuse("smoke transport extent or decay is nonphysical");
    for (float Coordinate : Transport.Origin)
        if (!std::isfinite(Coordinate)) return Refuse("smoke transport placement is nonfinite");
    for (uint32_t Source = 0u; Source < Transport.SourceCount; ++Source)
    {
        const auto& Emission = Transport.Sources[Source];
        for (uint32_t Component = 0u; Component < 4u; ++Component)
            if (!std::isfinite(Emission.PositionRadius[Component]) || !std::isfinite(Emission.VelocityDensity[Component]) ||
                !std::isfinite(Emission.Temperature[Component])) return Refuse("smoke source contains nonfinite readings");
        if (Emission.PositionRadius[3] <= 0.0f || Emission.VelocityDensity[3] < 0.0f || Emission.Temperature[0] < 0.0f || Emission.Temperature[1] < 0.0f)
            return Refuse("smoke source has a nonphysical radius or rate");
    }
    for (uint32_t ScalarIndex = 0u; ScalarIndex < 32u * 32u * 32u * 4u; ++ScalarIndex)
        if (!std::isfinite(Transport.VelocityOccupancy[ScalarIndex]) ||
            (ScalarIndex % 4u == 3u && (Transport.VelocityOccupancy[ScalarIndex] < 0.0f || Transport.VelocityOccupancy[ScalarIndex] > 1.0f)))
            return Refuse("smoke world velocity or terrain occupancy is nonphysical");
    if (Resident() && LastCarrier == Transport.CarrierIdentifier && Pending.Span != Transport.Span)
        return Refuse("live smoke resizing requires remapping; fixed-cell contents were not relabelled");
    if (Resident() && LastCarrier != Transport.CarrierIdentifier) RetireDomain();
    if (!Resident())
    {
        try
        {
            if (!AcquireDomain()) { RetireDomain(); return false; }
        }
        catch (...) { RetireDomain(); return Refuse("smoke domain acquisition exhausted storage"); }
        LastCarrier = Transport.CarrierIdentifier;
        std::copy_n(Transport.Origin, 3u, PreviousOrigin);
    }
    if (Transport.Revision < LastRevision) return Refuse("smoke transport revision moved backwards within a carrier lifetime");
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        const double Shift = (double(Transport.Origin[Axis]) - PreviousOrigin[Axis]) * Initialization.FineExtent / Transport.Span;
        if (std::abs(Shift - std::round(Shift)) > 0.0001) return Refuse("smoke relocation is not an integral fine-cell displacement");
    }
    try { PendingVelocity.assign(Transport.VelocityOccupancy, Transport.VelocityOccupancy + 32u * 32u * 32u * 4u); }
    catch (...) { return Refuse("smoke host-owned transport copy exhausted storage"); }
    Pending = Transport;
    Pending.VelocityOccupancy = nullptr;
    return true;
}

void SmokeExchange::ReadCompleted(uint32_t CycleSlot)
{
    if (!Timestamps || CycleSlot >= RecordedTimestamps.size()) return;
    uint64_t Readings[2]{};
    const auto ReadSpan = [&](uint32_t First, double& Milliseconds)
    {
        if (vkGetQueryPoolResults(Initialization.Device, Timestamps, First, 2u, sizeof(Readings), Readings,
                                  sizeof(uint64_t), VK_QUERY_RESULT_64_BIT) == VK_SUCCESS)
            Milliseconds = static_cast<double>(Readings[1] - Readings[0]) * TimestampPeriod / 1000000.0;
    };
    if (RecordedTimestamps[CycleSlot] & 1u) ReadSpan(CycleSlot * 4u, Measurements.TransportMilliseconds);
    if (RecordedTimestamps[CycleSlot] & 2u) ReadSpan(CycleSlot * 4u + 2u, Measurements.RenderMilliseconds);
    RecordedTimestamps[CycleSlot] = 0u;
}

bool SmokeExchange::RecordTransport(VkCommandBuffer Command, uint32_t CycleSlot)
{
    if (!Resident() || Pending.Revision == LastRevision) return true;
    if (!Command || CycleSlot >= Initialization.CycleSlotCount) return Refuse("smoke recording slot is invalid");
    if (Timestamps)
    {
        vkCmdResetQueryPool(Command, Timestamps, CycleSlot * 4u, 4u);
        vkCmdWriteTimestamp(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, Timestamps, CycleSlot * 4u);
        RecordedTimestamps[CycleSlot] = 1u;
    }
    if (!ImagesInitialized)
    {
        VkImageMemoryBarrier Initial[] =
        {
            ImageBarrier(VolumeImages[0], VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL, 0u, VK_ACCESS_TRANSFER_WRITE_BIT),
            ImageBarrier(VolumeImages[1], VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL, 0u, VK_ACCESS_TRANSFER_WRITE_BIT),
        };
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             0u, 0u, nullptr, 0u, nullptr, 2u, Initial);
        VkClearColorValue Empty{};
        for (uint32_t Slot = 0u; Slot < 2u; ++Slot)
            vkCmdClearColorImage(Command, VolumeImages[Slot], VK_IMAGE_LAYOUT_GENERAL, &Empty, 1u, &Initial[Slot].subresourceRange);
        for (auto& Barrier : Initial)
        {
            Barrier.oldLayout     = VK_IMAGE_LAYOUT_GENERAL;
            Barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        }
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0u, 0u, nullptr, 0u, nullptr, 2u, Initial);
        ImagesInitialized = true;
    }
    std::memcpy(VelocityTransfers[CycleSlot].Mapped, PendingVelocity.data(), PendingVelocity.size() * sizeof(float));
    std::memcpy(SourceTransfers[CycleSlot].Mapped, Pending.Sources, Pending.SourceCount * sizeof(FrontierSmokeInjection));
    TransportSpecification Parameters{};
    std::copy_n(Pending.Origin, 3u, Parameters.OriginSpan);
    Parameters.OriginSpan[3] = Pending.Span;
    Parameters.Rates[0]      = 1.0f / 60.0f;
    Parameters.Rates[1]      = Pending.SmokeLoss;
    Parameters.Rates[2]      = Pending.Cooling;
    Parameters.Rates[3]      = 1.0f;
    std::copy_n(Pending.ChassisPosition, 4u, Parameters.ChassisPosition);
    std::copy_n(Pending.ChassisInverse, 4u, Parameters.ChassisInverse);
    std::copy_n(Pending.ChassisMinimum, 4u, Parameters.ChassisMinimum);
    std::copy_n(Pending.ChassisMaximum, 4u, Parameters.ChassisMaximum);
    const float Spacing = Pending.Span / Initialization.FineExtent;
    std::fill_n(Parameters.SourceMinimum, 3u, 1000000.0f);
    std::fill_n(Parameters.SourceMaximum, 3u, -1000000.0f);
    for (uint32_t Source = 0u; Source < Pending.SourceCount; ++Source)
    {
        const auto& Emission = Pending.Sources[Source];
        const float Radius = std::max(Emission.PositionRadius[3], Spacing * 0.72f) * 3.5f + Spacing;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            Parameters.SourceMinimum[Axis] = std::min(Parameters.SourceMinimum[Axis], Emission.PositionRadius[Axis] - Radius);
            Parameters.SourceMaximum[Axis] = std::max(Parameters.SourceMaximum[Axis], Emission.PositionRadius[Axis] + Radius);
        }
    }
    std::memcpy(ParameterTransfers[CycleSlot].Mapped, &Parameters, sizeof(Parameters));
    Measurements.UploadBytes = PendingVelocity.size() * sizeof(float) +
                               Pending.SourceCount * sizeof(FrontierSmokeInjection) + sizeof(Parameters);
    for (uint32_t Volume = 0u; Volume < 2u; ++Volume)
    {
        VkDescriptorBufferInfo Transfers[] =
        {
            {VelocityTransfers[CycleSlot].Transfer, 0u, 32u * 32u * 32u * 4u * sizeof(float)},
            {SourceTransfers[CycleSlot].Transfer, 0u, sizeof(Pending.Sources)},
            {ParameterTransfers[CycleSlot].Transfer, 0u, sizeof(Parameters)},
            {Coverage.Transfer, 0u, 32u},
        };
        VkDescriptorImageInfo Images[] =
        {
            {VolumeSampler, VolumeViews[Volume], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, VolumeViews[1u - Volume], VK_IMAGE_LAYOUT_GENERAL},
        };
        VkWriteDescriptorSet Writes[6]{};
        for (uint32_t Index = 0u; Index < 6u; ++Index)
        {
            auto& Write = Writes[Index];
            Write.sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            Write.dstSet          = TransportDescriptors[CycleSlot][Volume];
            Write.dstBinding      = Index;
            Write.descriptorCount = 1u;
            Write.descriptorType  = Index == 2u ? VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER :
                                    (Index == 3u ? VK_DESCRIPTOR_TYPE_STORAGE_IMAGE :
                                    (Index == 4u ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER));
            if (Index == 2u || Index == 3u) Write.pImageInfo = &Images[Index - 2u];
            else Write.pBufferInfo = &Transfers[Index == 5u ? 3u : (Index == 4u ? 2u : Index)];
        }
        vkUpdateDescriptorSets(Initialization.Device, 6u, Writes, 0u, nullptr);
    }
    VkMemoryBarrier Visibility{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    Visibility.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    Visibility.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0u, 1u, &Visibility, 0u, nullptr, 0u, nullptr);
    const bool Relocated = !std::equal(std::begin(PreviousOrigin), std::end(PreviousOrigin), std::begin(Pending.Origin));
    const auto Dispatch = [&](bool ScrollOnly, uint32_t Tick)
    {
        VkMemoryBarrier BeforeCoverage{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        BeforeCoverage.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        BeforeCoverage.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             0u, 1u, &BeforeCoverage, 0u, nullptr, 0u, nullptr);
        vkCmdFillBuffer(Command, Coverage.Transfer, 0u, 16u, Initialization.FineExtent);
        vkCmdFillBuffer(Command, Coverage.Transfer, 16u, 16u, 0u);
        VkMemoryBarrier Covered{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Covered.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT;
        Covered.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0u, 1u, &Covered, 0u, nullptr, 0u, nullptr);
        TransportCycle Cycle{};
        std::copy_n(PreviousOrigin, 3u, Cycle.PreviousOriginTime);
        Cycle.PreviousOriginTime[3] = VisualSeconds;
        Cycle.Counts[0] = ScrollOnly ? 0u : Pending.SourceOffsets[Tick + 1u];
        Cycle.Counts[1] = ScrollOnly ? 0u : Pending.SourceOffsets[Tick];
        Cycle.Counts[2] = Initialization.FineExtent;
        Cycle.Counts[3] = ScrollOnly ? 1u : 0u;
        vkCmdBindPipeline(Command, VK_PIPELINE_BIND_POINT_COMPUTE, TransportProgram);
        vkCmdBindDescriptorSets(Command, VK_PIPELINE_BIND_POINT_COMPUTE, TransportProgramLayout,
                                0u, 1u, &TransportDescriptors[CycleSlot][CurrentVolume], 0u, nullptr);
        vkCmdPushConstants(Command, TransportProgramLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0u, sizeof(Cycle), &Cycle);
        const uint32_t Groups = (Initialization.FineExtent + 3u) / 4u;
        vkCmdDispatch(Command, Groups, Groups, Groups);
        CurrentVolume = 1u - CurrentVolume;
        Visibility.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0u, 1u, &Visibility, 0u, nullptr, 0u, nullptr);
    };
    if (Relocated)
    {
        Dispatch(true, 0u);
        std::copy_n(Pending.Origin, 3u, PreviousOrigin);
        ++Measurements.Relocations;
    }
    for (uint32_t Tick = 0u; Tick < Pending.CompletedTicks; ++Tick)
    {
        VisualSeconds += 1.0f / 60.0f;
        Dispatch(false, Tick);
        ++Measurements.TransportTicks;
    }
    LastRevision = Pending.Revision;
    if (Timestamps) vkCmdWriteTimestamp(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, Timestamps, CycleSlot * 4u + 1u);
    return true;
}

bool SmokeExchange::RecordProjection(
    VkCommandBuffer        Command,
    uint32_t               CycleSlot,
    VkImageView            LinearRadiance,
    VkImageView            Surface,
    VkImageView            Albedo,
    VkImageView            Presentation,
    const SmokeProjection& Projection)
{
    if (!Resident()) return true;
    if (!Command || CycleSlot >= Initialization.CycleSlotCount || !LinearRadiance || !Surface || !Albedo || !Presentation ||
        !Projection.Width || !Projection.Height) return Refuse("smoke viewport inputs are incomplete");
    if (Timestamps)
    {
        if (!(RecordedTimestamps[CycleSlot] & 1u)) vkCmdResetQueryPool(Command, Timestamps, CycleSlot * 4u + 2u, 2u);
        vkCmdWriteTimestamp(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, Timestamps, CycleSlot * 4u + 2u);
        RecordedTimestamps[CycleSlot] |= 2u;
    }
    VkDescriptorImageInfo Images[] =
    {
        {VolumeSampler, VolumeViews[CurrentVolume], VK_IMAGE_LAYOUT_GENERAL},
        {VK_NULL_HANDLE, Presentation, VK_IMAGE_LAYOUT_GENERAL},
        {VK_NULL_HANDLE, LinearRadiance, VK_IMAGE_LAYOUT_GENERAL},
        {VK_NULL_HANDLE, Surface, VK_IMAGE_LAYOUT_GENERAL},
        {VolumeSampler, Albedo, VK_IMAGE_LAYOUT_GENERAL},
    };
    VkDescriptorBufferInfo Occupied{Coverage.Transfer, 0u, 32u};
    VkWriteDescriptorSet Writes[6]{};
    const auto Destination = ProjectionDescriptors[CycleSlot][CurrentVolume];
    for (uint32_t Index = 0u; Index < 6u; ++Index)
    {
        auto& Write = Writes[Index];
        Write.sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        Write.dstSet          = Destination;
        Write.dstBinding      = Index;
        Write.descriptorCount = 1u;
        Write.descriptorType  = Index == 5u ? VK_DESCRIPTOR_TYPE_STORAGE_BUFFER :
                                (Index == 0u || Index == 4u ? VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER : VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
        if (Index == 5u) Write.pBufferInfo = &Occupied;
        else Write.pImageInfo = &Images[Index];
    }
    vkUpdateDescriptorSets(Initialization.Device, 6u, Writes, 0u, nullptr);
    VkMemoryBarrier Ready{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    Ready.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT;
    Ready.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0u, 1u, &Ready, 0u, nullptr, 0u, nullptr);
    ProjectionSpecification Parameters{};
    std::copy_n(Projection.Eye, 4u, Parameters.Eye);
    std::copy_n(Projection.Forward, 4u, Parameters.Forward);
    std::copy_n(Projection.Right, 4u, Parameters.Right);
    std::copy_n(Projection.Up, 4u, Parameters.Up);
    std::copy_n(Pending.Origin, 3u, Parameters.OriginSpan);
    Parameters.OriginSpan[3] = Pending.Span;
    Parameters.Optical[0] = Projection.Lighting.DensityExtinction;
    Parameters.Optical[1] = Projection.Lighting.SmokeAlbedo;
    Parameters.Optical[2] = Projection.Lighting.TemperatureScale;
    Parameters.Optical[3] = Projection.Lighting.FireIntensity;
    Parameters.Sun[0] = -0.40f;
    Parameters.Sun[1] = -0.30f;
    Parameters.Sun[2] = 0.8660254f;
    Parameters.Sun[3] = Projection.Lighting.SunIntensity;
    Parameters.Counts[0] = Projection.Width;
    Parameters.Counts[1] = Projection.Height;
    Parameters.Counts[2] = std::clamp(Projection.RaySamples, 8u, 256u) |
                           (static_cast<uint32_t>(std::clamp(Projection.Lighting.ShadowSteps, 0, 16)) << 16u);
    Parameters.Counts[3] = Projection.ColourTransfer;
    vkCmdBindPipeline(Command, VK_PIPELINE_BIND_POINT_COMPUTE, ProjectionProgram);
    vkCmdBindDescriptorSets(Command, VK_PIPELINE_BIND_POINT_COMPUTE, ProjectionProgramLayout, 0u, 1u, &Destination, 0u, nullptr);
    vkCmdPushConstants(Command, ProjectionProgramLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0u, sizeof(Parameters), &Parameters);
    vkCmdDispatch(Command, (Projection.Width + 7u) / 8u, (Projection.Height + 7u) / 8u, 1u);
    if (Timestamps) vkCmdWriteTimestamp(Command, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, Timestamps, CycleSlot * 4u + 3u);
    return true;
}

} // namespace Frontier
