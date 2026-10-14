//============================================================================================================================================
//                                                      DISTANCEFIELDGISTAGE.CPP
//============================================================================================================================================
// 📦 Mesh-local samples are uploaded once. Only placement records, surface lighting and screen gathers change.

#include "DistanceFieldGIStage.h"
#include "DriverProgress.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <vector>

namespace Frontier
{
bool DistanceFieldGIStage::Bring(const DistanceFieldStageInit& Input) noexcept
{
    Refusal.clear();
    if (!Input.PhysicalDevice || !Input.Device || !Input.Geometry || Input.Geometry->QueryFacets().empty() ||
        Input.Geometry->QuerySamples().empty() || Input.Geometry->QueryPlacements().empty() || !Input.OutputImageView ||
        !Input.SurfaceImageView || !Input.NormalImageView || !Input.TriangleBuffer || !Input.MaterialBuffer ||
        !Input.InstanceBuffer || !Input.SlabBuffer || !Input.VertexBuffer || !Input.IndexBuffer || !Input.TableSampler ||
        !Input.LinearImageView || !Input.EnergyLutView || !Input.SheenLutView || !Input.ShadowDescriptorLayout ||
        !Input.ImageWidth || !Input.ImageHeight || Input.CardResolution < 2u || Input.CardResolution > 32u ||
        Input.CycleSlotCount < 1u || Input.CycleSlotCount > 3u ||
        (Input.TextureCapacity && (!Input.TextureCount || !Input.TextureViews || !Input.TextureSampler ||
                                   Input.TextureCount > Input.TextureCapacity)))
    {
        Refusal = "distance-field GI initialization is missing persistent geometry or borrowed raster resources";
        return false;
    }
    try
    {
        // Caller has completed GPU readers before rebinding borrowed views. Resizes/material edits retain samples,
        // cards and pipelines; neither an image resize nor a camera/instance move is a mesh import.
        if (Ready && Initialization.Device == Input.Device && ResidentRevision == Input.Geometry->QueryRevision() &&
            Initialization.TextureCapacity == Input.TextureCapacity && Initialization.CardResolution == Input.CardResolution &&
            Initialization.ShadowDescriptorLayout == Input.ShadowDescriptorLayout)
        {
            const bool Resize = Input.ImageWidth != Initialization.ImageWidth || Input.ImageHeight != Initialization.ImageHeight;
            if (Resize || Input.SurfaceImageView != Initialization.SurfaceImageView ||
                Input.NormalImageView != Initialization.NormalImageView) ScreenHistoryReady = false;
            Initialization = Input;
            if (Resize)
            {
                RetireCardImages(5u);
                ScreenImagesInitialized = false;
                if (!ConstructCardImages(5u)) { Refusal = "distance-field GI screen target allocation refused"; Destroy(); return false; }
            }
            if (!WriteDescriptors()) { Refusal = "distance-field GI descriptor rebind refused"; Destroy(); return false; }
            return true;
        }
        Destroy();
        Initialization = Input;
        VoxelCount = static_cast<uint32_t>(Input.Geometry->QuerySamples().size());
        const uint32_t Cards = static_cast<uint32_t>(Input.Geometry->QueryFacets().size());
        const uint32_t Columns = static_cast<uint32_t>(std::ceil(std::sqrt(double(Cards))));
        CardWidth = Columns * Input.CardResolution;
        CardHeight = ((Cards + Columns - 1u) / Columns) * Input.CardResolution;
        VkPhysicalDeviceProperties Properties{};
        vkGetPhysicalDeviceProperties(Input.PhysicalDevice, &Properties);
        VkFormatProperties Format{}, PositionFormat{};
        vkGetPhysicalDeviceFormatProperties(Input.PhysicalDevice, VK_FORMAT_R16G16B16A16_SFLOAT, &Format);
        vkGetPhysicalDeviceFormatProperties(Input.PhysicalDevice, VK_FORMAT_R32G32B32A32_SFLOAT, &PositionFormat);
        if (!(Format.optimalTilingFeatures & VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT) ||
            !(PositionFormat.optimalTilingFeatures & VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT) ||
            CardWidth > Properties.limits.maxImageDimension2D || CardHeight > Properties.limits.maxImageDimension2D ||
            Input.ImageWidth > Properties.limits.maxImageDimension2D || Input.ImageHeight > Properties.limits.maxImageDimension2D ||
            Properties.limits.maxPerStageDescriptorStorageImages < 16u ||
            VkDeviceSize(VoxelCount) * sizeof(DistanceFieldVoxelRecord) > Properties.limits.maxStorageBufferRange ||
            Input.Geometry->QueryFacets().size() * sizeof(DistanceFieldFacet) > Properties.limits.maxStorageBufferRange ||
            Input.Geometry->QueryPlacements().size() * sizeof(DistanceFieldPlacementRecord) > Properties.limits.maxStorageBufferRange)
        { Refusal = "distance-field GI exceeds storage format, image or buffer limits"; Destroy(); return false; }
        if (!Allocate(0u, VkDeviceSize(VoxelCount) * sizeof(DistanceFieldVoxelRecord)) || !Allocate(3u, 16u) ||
            !Allocate(4u, Input.Geometry->QueryPlacements().size() * sizeof(DistanceFieldPlacementRecord)) ||
            !Allocate(5u, Input.Geometry->QueryFacets().size() * sizeof(DistanceFieldFacet)) ||
            !ConstructCardImages() || !ConstructPipelines() || !WriteDescriptors())
        {
            if (Refusal.empty()) Refusal = "distance-field GI allocation, pipeline or descriptor creation refused";
            Destroy();
            return false;
        }
        uint32_t FamilyCount = 0u;
        vkGetPhysicalDeviceQueueFamilyProperties(Input.PhysicalDevice, &FamilyCount, nullptr);
        std::vector<VkQueueFamilyProperties> Families(FamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(Input.PhysicalDevice, &FamilyCount, Families.data());
        TimestampBits = Input.QueueFamily < FamilyCount ? Families[Input.QueueFamily].timestampValidBits : 0u;
        TimestampPeriod = Properties.limits.timestampPeriod;
        if (TimestampBits)
        {
            VkQueryPoolCreateInfo Queries{ VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO };
            Queries.queryType = VK_QUERY_TYPE_TIMESTAMP;
            Queries.queryCount = Input.CycleSlotCount * 8u;
            if (vkCreateQueryPool(Input.Device, &Queries, nullptr, &Timestamps) != VK_SUCCESS) TimestampBits = 0u;
        }
        std::fill_n(GpuDurations, 4u, -1.0f);
        ResidentRevision = Input.Geometry->QueryRevision();
        UploadPending = true;
        Ready = true;
        const auto& Metrics = Input.Geometry->QueryCacheMetrics();
        std::cerr << "[SdfGI] mesh-local fields: constructed=" << Metrics.Constructed << ", file hits=" << Metrics.FileHits
                  << ", shared placements=" << Metrics.SharedPlacements << ", samples=" << VoxelCount
                  << "; no runtime distance-field construction pipeline\n";
        return true;
    }
    catch (...)
    {
        Refusal = "distance-field GI host allocation refused";
        Destroy();
        return false;
    }
}

bool DistanceFieldGIStage::Allocate(uint32_t Slot, VkDeviceSize Bytes)
{
    Sizes[Slot] = Bytes;
    VkBufferCreateInfo Information{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    Information.size  = Bytes;
    Information.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    if (vkCreateBuffer(Initialization.Device, &Information, nullptr, &Buffers[Slot]) != VK_SUCCESS) return false;
    VkMemoryRequirements Requirements{};
    vkGetBufferMemoryRequirements(Initialization.Device, Buffers[Slot], &Requirements);
    uint32_t Type = UINT32_MAX;
    for (uint32_t Index = 0u; Index < Initialization.MemoryProperties.memoryTypeCount; ++Index)
        if ((Requirements.memoryTypeBits & (1u << Index)) &&
            (Initialization.MemoryProperties.memoryTypes[Index].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT))
        {
            Type = Index;
            break;
        }
    if (Type == UINT32_MAX) return false;
    VkMemoryAllocateInfo Allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    Allocation.allocationSize  = Requirements.size;
    Allocation.memoryTypeIndex = Type;
    if (vkAllocateMemory(Initialization.Device, &Allocation, nullptr, &Memory[Slot]) != VK_SUCCESS) return false;
    return vkBindBufferMemory(Initialization.Device, Buffers[Slot], Memory[Slot], 0u) == VK_SUCCESS;
}

bool DistanceFieldGIStage::ConstructCardImages(uint32_t First)
{
    for (uint32_t Slot = First; Slot < kCardImageCount; ++Slot)
    {
        VkImageCreateInfo Information{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        Information.imageType = VK_IMAGE_TYPE_2D;
        Information.format    = Slot >= 10u ? VK_FORMAT_R32G32B32A32_SFLOAT : VK_FORMAT_R16G16B16A16_SFLOAT;
        Information.extent    = Slot < 5u ? VkExtent3D{CardWidth, CardHeight, 1u} :
                                Slot == 7u ? VkExtent3D{Initialization.ImageWidth, Initialization.ImageHeight, 1u} :
                                             VkExtent3D{(Initialization.ImageWidth + 1u) / 2u,
                                                        (Initialization.ImageHeight + 1u) / 2u, 1u};
        Information.mipLevels = Information.arrayLayers = 1u;
        Information.samples                             = VK_SAMPLE_COUNT_1_BIT;
        Information.tiling                              = VK_IMAGE_TILING_OPTIMAL;
        Information.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
        if (vkCreateImage(Initialization.Device, &Information, nullptr, &CardImages[Slot]) != VK_SUCCESS) return false;
        VkMemoryRequirements Requirements{};
        vkGetImageMemoryRequirements(Initialization.Device, CardImages[Slot], &Requirements);
        uint32_t Selection = UINT32_MAX;
        for (uint32_t Index = 0u; Index < Initialization.MemoryProperties.memoryTypeCount; ++Index)
            if ((Requirements.memoryTypeBits & (1u << Index)) &&
                (Initialization.MemoryProperties.memoryTypes[Index].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT))
            {
                Selection = Index;
                break;
            }
        if (Selection == UINT32_MAX) return false;
        VkMemoryAllocateInfo Extent{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Extent.allocationSize  = Requirements.size;
        Extent.memoryTypeIndex = Selection;
        if (vkAllocateMemory(Initialization.Device, &Extent, nullptr, &CardStorage[Slot]) != VK_SUCCESS ||
            vkBindImageMemory(Initialization.Device, CardImages[Slot], CardStorage[Slot], 0u) != VK_SUCCESS)
            return false;
        VkImageViewCreateInfo View{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        View.image            = CardImages[Slot];
        View.viewType         = VK_IMAGE_VIEW_TYPE_2D;
        View.format           = Information.format;
        View.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0u, 1u, 0u, 1u};
        if (vkCreateImageView(Initialization.Device, &View, nullptr, &CardViews[Slot]) != VK_SUCCESS) return false;
    }
    return true;
}

bool DistanceFieldGIStage::ConstructPipelines()
{
    std::vector<VkDescriptorSetLayoutBinding> Descriptors;
    auto                                      Append = [&](uint32_t Slot, VkDescriptorType Type, uint32_t Count = 1u)
    { Descriptors.push_back({Slot, Type, Count, VK_SHADER_STAGE_COMPUTE_BIT, nullptr}); };
    for (uint32_t Slot : {0u, 1u, 2u, 4u, 8u, 9u, 10u, 11u, 21u, 22u, 23u, 24u, 25u, 26u, 27u, 28u})
        Append(Slot, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    for (uint32_t Slot : {3u, 5u, 6u, 7u, 15u, 16u, 17u, 18u, 19u, 20u})
        Append(Slot, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER);
    Append(13u, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    Append(14u, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    Append(31u, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, std::max(1u, Initialization.TextureCapacity));
    std::vector<VkDescriptorBindingFlags> Flags(Descriptors.size(), 0u);
    if (Initialization.TextureCapacity)
        Flags.back() = VK_DESCRIPTOR_BINDING_VARIABLE_DESCRIPTOR_COUNT_BIT | VK_DESCRIPTOR_BINDING_PARTIALLY_BOUND_BIT;
    if (Initialization.TextureCapacity && Initialization.TextureUpdateAfterBind) Flags.back() |= VK_DESCRIPTOR_BINDING_UPDATE_AFTER_BIND_BIT;
    VkDescriptorSetLayoutBindingFlagsCreateInfo DescriptorFlags{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_BINDING_FLAGS_CREATE_INFO};
    DescriptorFlags.bindingCount  = static_cast<uint32_t>(Flags.size());
    DescriptorFlags.pBindingFlags = Flags.data();
    VkDescriptorSetLayoutCreateInfo Layout{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    Layout.pNext        = Initialization.TextureCapacity ? &DescriptorFlags : nullptr;
    Layout.flags        = Initialization.TextureCapacity && Initialization.TextureUpdateAfterBind
                              ? VkDescriptorSetLayoutCreateFlags(VK_DESCRIPTOR_SET_LAYOUT_CREATE_UPDATE_AFTER_BIND_POOL_BIT)
                              : 0u;
    Layout.bindingCount = static_cast<uint32_t>(Descriptors.size());
    Layout.pBindings    = Descriptors.data();
    if (vkCreateDescriptorSetLayout(Initialization.Device, &Layout, nullptr, &DescriptorLayout) != VK_SUCCESS) return false;
    VkPushConstantRange        Push{VK_SHADER_STAGE_COMPUTE_BIT, 0u, sizeof(DistanceFieldPush)};
    VkPipelineLayoutCreateInfo PipelineInformation{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    const VkDescriptorSetLayout Layouts[] = { DescriptorLayout, Initialization.ShadowDescriptorLayout };
    PipelineInformation.setLayoutCount         = 2u;
    PipelineInformation.pSetLayouts            = Layouts;
    PipelineInformation.pushConstantRangeCount = 1u;
    PipelineInformation.pPushConstantRanges    = &Push;
    if (vkCreatePipelineLayout(Initialization.Device, &PipelineInformation, nullptr, &PipelineLayout) != VK_SUCCESS) return false;
    const char* Names[] = {
        Initialization.TextureCapacity ? "DistanceFieldCapture.spv" : "DistanceFieldCaptureFixed.spv",
        "DistanceFieldRadiance.spv",
        Initialization.TextureCapacity ? "DistanceFieldGather.spv" : "DistanceFieldGatherFixed.spv",
        Initialization.TextureCapacity ? "DistanceFieldGIResolve.spv" : "DistanceFieldGIResolveFixed.spv",
        Initialization.TextureCapacity ? "DistanceFieldReflection.spv" : "DistanceFieldReflectionFixed.spv"};
    for (uint32_t Index = 0u; Index < kPipelineCount; ++Index)
    {
        std::ifstream Stream(Initialization.SpirvDirectory + "/" + Names[Index], std::ios::binary | std::ios::ate);
        if (!Stream) return false;
        const auto Length = Stream.tellg();
        if (Length < 20 || Length % 4 != 0) return false;
        std::vector<uint32_t> Words(static_cast<size_t>(Length) / 4u);
        Stream.seekg(0);
        if (!Stream.read(reinterpret_cast<char*>(Words.data()), Length) || Words[0] != 0x07230203u) return false;
        VkShaderModuleCreateInfo ModuleInformation{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        ModuleInformation.codeSize = static_cast<size_t>(Length);
        ModuleInformation.pCode    = Words.data();
        VkShaderModule Module{};
        if (vkCreateShaderModule(Initialization.Device, &ModuleInformation, nullptr, &Module) != VK_SUCCESS) return false;
        VkComputePipelineCreateInfo Pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
        Pipeline.stage        = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        Pipeline.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
        Pipeline.stage.module = Module;
        Pipeline.stage.pName  = "main";
        Pipeline.layout       = PipelineLayout;
        const auto Result = DriverProgress::Call(std::string("distance-field GI pipeline: ") + Names[Index], [&]
        { return vkCreateComputePipelines(Initialization.Device, Initialization.PipelineCache, 1u, &Pipeline, nullptr, &Pipelines[Index]); });
        vkDestroyShaderModule(Initialization.Device, Module, nullptr);
        if (Result != VK_SUCCESS) return false;
    }
    return true;
}

bool DistanceFieldGIStage::WriteDescriptors()
{
    const uint32_t             Capacity = std::max(1u, Initialization.TextureCapacity);
    VkDescriptorPoolSize       Sizes[]  = {{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 20u},
                                           {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 32u},
                                           {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 2u * (Capacity + 2u)}};
    VkDescriptorPoolCreateInfo Information{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    Information.maxSets       = 2u;
    Information.flags         = Initialization.TextureCapacity && Initialization.TextureUpdateAfterBind
                                    ? VkDescriptorPoolCreateFlags(VK_DESCRIPTOR_POOL_CREATE_UPDATE_AFTER_BIND_BIT)
                                    : 0u;
    Information.poolSizeCount = 3u;
    Information.pPoolSizes    = Sizes;
    if (!Pool && vkCreateDescriptorPool(Initialization.Device, &Information, nullptr, &Pool) != VK_SUCCESS) return false;
    std::vector<VkDescriptorImageInfo> Textures(Capacity);
    for (uint32_t Index = 0u; Index < Capacity; ++Index)
        Textures[Index] =
            Initialization.TextureCapacity
                ? VkDescriptorImageInfo{Initialization.TextureSampler,
                                        Initialization.TextureViews[std::min(Index, Initialization.TextureCount - 1u)],
                                        VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL}
                : VkDescriptorImageInfo{Initialization.TableSampler, Initialization.EnergyLutView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
    for (uint32_t Cycle = 0u; Cycle < 2u; ++Cycle)
    {
        VkDescriptorSetVariableDescriptorCountAllocateInfo Variable{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_VARIABLE_DESCRIPTOR_COUNT_ALLOCATE_INFO};
        Variable.descriptorSetCount = 1u;
        Variable.pDescriptorCounts  = &Capacity;
        VkDescriptorSetAllocateInfo Allocation{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        Allocation.pNext              = Initialization.TextureCapacity ? &Variable : nullptr;
        Allocation.descriptorPool     = Pool;
        Allocation.descriptorSetCount = 1u;
        Allocation.pSetLayouts        = &DescriptorLayout;
        if (!Sets[Cycle] && vkAllocateDescriptorSets(Initialization.Device, &Allocation, &Sets[Cycle]) != VK_SUCCESS) return false;
        VkBuffer               Handles[] = {Buffers[0],
                                            Buffers[3],
                                            Buffers[4],
                                            Buffers[5],
                                            Initialization.TriangleBuffer,
                                            Initialization.MaterialBuffer,
                                            Initialization.InstanceBuffer,
                                            Initialization.SlabBuffer,
                                            Initialization.VertexBuffer,
                                            Initialization.IndexBuffer};
        const uint32_t         Slots[]   = {3u, 5u, 6u, 7u, 15u, 16u, 17u, 18u, 19u, 20u};
        VkDescriptorBufferInfo BufferInformation[10]{};
        VkDescriptorImageInfo  Images[] = {
            {VK_NULL_HANDLE, Initialization.OutputImageView, VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, Initialization.SurfaceImageView, VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, Initialization.NormalImageView, VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[1u - Cycle], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[2], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[3], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[4], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 8u : 5u], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 9u : 6u], VK_IMAGE_LAYOUT_GENERAL},
            {Initialization.TableSampler, Initialization.EnergyLutView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL},
            {Initialization.TableSampler, Initialization.SheenLutView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL},
            {VK_NULL_HANDLE, Initialization.LinearImageView, VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[7], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 5u : 8u], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 6u : 9u], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 10u : 11u], VK_IMAGE_LAYOUT_GENERAL},
            {VK_NULL_HANDLE, CardViews[Cycle ? 11u : 10u], VK_IMAGE_LAYOUT_GENERAL}};
        std::vector<VkWriteDescriptorSet> Writes;
        for (uint32_t Index = 0u; Index < 10u; ++Index)
        {
            BufferInformation[Index] = {Handles[Index], 0u, VK_WHOLE_SIZE};
            VkWriteDescriptorSet Write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
            Write.dstSet          = Sets[Cycle];
            Write.dstBinding      = Slots[Index];
            Write.descriptorCount = 1u;
            Write.descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Write.pBufferInfo     = &BufferInformation[Index];
            Writes.push_back(Write);
        }
        const uint32_t ImageSlots[] = {0u, 1u, 2u, 4u, 10u, 8u, 9u, 11u, 21u, 22u,
                                       13u, 14u, 23u, 24u, 25u, 26u, 27u, 28u};
        for (uint32_t Index = 0u; Index < 18u; ++Index)
        {
            VkWriteDescriptorSet Write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
            Write.dstSet          = Sets[Cycle];
            Write.dstBinding      = ImageSlots[Index];
            Write.descriptorCount = 1u;
            Write.descriptorType  = (Index == 10u || Index == 11u) ? VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER : VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
            Write.pImageInfo      = &Images[Index];
            Writes.push_back(Write);
        }
        VkWriteDescriptorSet Write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        Write.dstSet          = Sets[Cycle];
        Write.dstBinding      = 31u;
        Write.descriptorCount = Capacity;
        Write.descriptorType  = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        Write.pImageInfo      = Textures.data();
        Writes.push_back(Write);
        vkUpdateDescriptorSets(Initialization.Device, static_cast<uint32_t>(Writes.size()), Writes.data(), 0u, nullptr);
    }
    return true;
}

bool DistanceFieldGIStage::IsReady() const noexcept
{
    return Ready && Initialization.Geometry && ResidentRevision == Initialization.Geometry->QueryRevision() &&
           !Initialization.Geometry->QuerySamples().empty() && !Initialization.Geometry->QueryPlacements().empty() &&
           Initialization.Geometry->QuerySamples().size() * sizeof(DistanceFieldVoxelRecord) <= Sizes[0] &&
           Initialization.Geometry->QueryPlacements().size() * sizeof(DistanceFieldPlacementRecord) <= Sizes[4] &&
           Initialization.Geometry->QueryFacets().size() * sizeof(DistanceFieldFacet) <= Sizes[5];
}

bool DistanceFieldGIStage::RecordFrame(VkCommandBuffer Command, const DistanceFieldFrameParams& Frame) noexcept
{
    if (!SelectsDistanceField(Frame.FeatureFlags) ||
        !IsReady() || !Command || !Frame.ShadowDescriptors || Frame.CycleSlot >= Initialization.CycleSlotCount ||
        !Frame.RenderWidth || !Frame.RenderHeight || Frame.RenderWidth > Initialization.ImageWidth ||
        Frame.RenderHeight > Initialization.ImageHeight) return false;
    for (float Coordinate : Frame.CameraEye) if (!std::isfinite(Coordinate)) return false;
    const auto& Geometry = *Initialization.Geometry;
    constexpr VkPipelineStageFlags Compute = VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;
    constexpr VkPipelineStageFlags Transfer = VK_PIPELINE_STAGE_TRANSFER_BIT;
    auto Settle = [&](VkPipelineStageFlags Source, VkPipelineStageFlags Target, VkAccessFlags Read, VkAccessFlags Write)
    {
        VkMemoryBarrier Barrier{ VK_STRUCTURE_TYPE_MEMORY_BARRIER };
        Barrier.srcAccessMask = Read;
        Barrier.dstAccessMask = Write;
        vkCmdPipelineBarrier(Command, Source, Target, 0u, 1u, &Barrier, 0u, nullptr, 0u, nullptr);
    };
    auto Upload = [&](uint32_t Slot, const void* Bytes, VkDeviceSize Count)
    {
        const auto* Source = static_cast<const unsigned char*>(Bytes);
        for (VkDeviceSize Offset = 0u; Offset < Count; Offset += 65536u)
            vkCmdUpdateBuffer(Command, Buffers[Slot], Offset, std::min<VkDeviceSize>(65536u, Count - Offset), Source + Offset);
    };
    Settle(Compute | Transfer, Transfer, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
           VK_ACCESS_TRANSFER_WRITE_BIT);
    if (UploadPending)
    {
        Upload(0u, Geometry.QuerySamples().data(), Sizes[0]);
        Upload(5u, Geometry.QueryFacets().data(), Sizes[5]);
        const uint32_t Counts[] = { VoxelCount, static_cast<uint32_t>(Geometry.QueryPlacements().size()),
                                   static_cast<uint32_t>(Geometry.QueryFacets().size()), Initialization.CardResolution };
        Upload(3u, Counts, sizeof(Counts));
    }
    if (UploadPending || ResidentPlacements != Geometry.QueryPlacementRevision())
    {
        Upload(4u, Geometry.QueryPlacements().data(), Sizes[4]);
        ResidentPlacements = Geometry.QueryPlacementRevision();
    }
    Settle(Transfer, Compute, VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
    VkImageSubresourceRange Whole{ VK_IMAGE_ASPECT_COLOR_BIT, 0u, 1u, 0u, 1u };
    for (uint32_t Slot = 0u; Slot < kCardImageCount; ++Slot)
    {
        if ((Slot < 5u && CardImagesInitialized) || (Slot >= 5u && ScreenImagesInitialized)) continue;
        VkImageMemoryBarrier Barrier{ VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER };
        Barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        Barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
        Barrier.srcQueueFamilyIndex = Barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        Barrier.image = CardImages[Slot];
        Barrier.subresourceRange = Whole;
        Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, Compute | Transfer, 0u,
                             0u, nullptr, 0u, nullptr, 1u, &Barrier);
    }
    const bool Capture = UploadPending || ResidentMaterials != Frame.MaterialRevision || ResidentCapture != Geometry.QueryCaptureRevision();
    // Never mix lighting epochs. Camera motion and animated surfaces are rejected independently by the pixel guide.
    const float Lighting[] = { Frame.SunDirection[0], Frame.SunDirection[1], Frame.SunDirection[2], Frame.SunRadiance,
                               Frame.SunColour[0], Frame.SunColour[1], Frame.SunColour[2],
                               Frame.SkyAmbient[0], Frame.SkyAmbient[1], Frame.SkyAmbient[2], Frame.ShadowSoftness };
    const bool ReuseScreen = ScreenHistoryReady && !Capture &&
                             std::memcmp(Lighting, PreviousLighting, sizeof(Lighting)) == 0;
    if (Capture)
    {
        Settle(Compute | Transfer, Transfer, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
               VK_ACCESS_TRANSFER_WRITE_BIT);
        VkClearColorValue Zero{};
        for (uint32_t Slot = 0u; Slot < 2u; ++Slot)
            vkCmdClearColorImage(Command, CardImages[Slot], VK_IMAGE_LAYOUT_GENERAL, &Zero, 1u, &Whole);
        Settle(Transfer, Compute, VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
    }
    CardImagesInitialized = ScreenImagesInitialized = true;
    const uint32_t Q = Frame.CycleSlot * 8u;
    if (Timestamps)
    {
        if (RecordedSlots[Frame.CycleSlot])
        {
            uint64_t Ticks[8]{};
            if (vkGetQueryPoolResults(Initialization.Device, Timestamps, Q, 8u, sizeof(Ticks), Ticks, sizeof(uint64_t),
                                      VK_QUERY_RESULT_64_BIT) == VK_SUCCESS)
            {
                const uint64_t Mask = TimestampBits == 64u ? UINT64_MAX : ((1ull << TimestampBits) - 1u);
                for (uint32_t Span = 0u; Span < 4u; ++Span)
                    GpuDurations[Span] = float((Ticks[Span * 2u + 1u] - Ticks[Span * 2u]) & Mask) * TimestampPeriod * 1.0e-6f;
            }
        }
        vkCmdResetQueryPool(Command, Timestamps, Q, 8u);
        RecordedSlots[Frame.CycleSlot] = true;
    }
    auto Stamp = [&](uint32_t Offset)
    {
        if (Timestamps) vkCmdWriteTimestamp(Command, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, Timestamps, Q + Offset);
    };
    // Card texels relit per frame. 22 k facets x 4x4 cards is 355 k texels: at 16 k a full pass took 22 frames and,
    //    through the 0.25 blend, ~110 frames to settle after a light change. 64 k settles in ~30.
    static const uint32_t kRadianceBudget = []{ const char* Value = std::getenv("FRONTIER_GI_BUDGET"); return Value ? static_cast<uint32_t>(std::atoi(Value)) : 65536u; }();   // CI bisect hook
    DistanceFieldPush Push{};
    std::memcpy(Push.Sun, Frame.SunDirection, 12u); Push.Sun[3] = Frame.SunRadiance;
    std::memcpy(Push.SunColour, Frame.SunColour, 12u);
    std::memcpy(Push.SkyExposure, Frame.SkyAmbient, 12u); Push.SkyExposure[3] = Frame.Exposure;
    Push.Eye[0] = Frame.CameraEye[0]; Push.Eye[1] = Frame.CameraEye[1]; Push.Eye[2] = Frame.CameraEye[2];
    // ⚠️ Eye.w is the resident texture count: SceneMaterialResolve.slang's SampleChannel (FRONTIER_SDF_MATERIALS)
    //    falls back to the constant channel for any slot >= CameraEye.w. It was never written — zero — so EVERY
    //    texture read on the SDF path fell back: card capture and final resolve shaded flat material constants,
    //    and a cabin display was its emissive colour, a blank white panel, instead of the UI drawn into its sheet.
    Push.Eye[3] = static_cast<float>(Initialization.TextureCapacity ? Initialization.TextureCount : 0u);
    Push.Tuning[0] = Frame.ShadowSoftness; Push.Tuning[1] = Frame.GiBoost; Push.Tuning[3] = static_cast<float>(Frame.DebugView);
    Push.Counts[0] = static_cast<uint32_t>(Geometry.QueryFacets().size());
    Push.Counts[1] = FrameNumber; Push.Counts[2] = Frame.FeatureFlags; Push.Counts[3] = std::min(Frame.ReflectionMode, 1u);
    Push.RenderExtent[0] = Frame.RenderWidth; Push.RenderExtent[1] = Frame.RenderHeight;
    Push.RenderExtent[2] = ReuseScreen ? 1u : 0u; Push.RenderExtent[3] = kRadianceBudget;
    const VkDescriptorSet Descriptors[] = { Sets[FrameNumber & 1u], Frame.ShadowDescriptors };
    vkCmdBindDescriptorSets(Command, VK_PIPELINE_BIND_POINT_COMPUTE, PipelineLayout, 0u, 2u, Descriptors, 0u, nullptr);
    vkCmdPushConstants(Command, PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0u, sizeof(Push), &Push);
    auto Dispatch = [&](uint32_t Pipeline, uint32_t X, uint32_t Y)
    {
        vkCmdBindPipeline(Command, VK_PIPELINE_BIND_POINT_COMPUTE, Pipelines[Pipeline]);
        vkCmdDispatch(Command, X, Y, 1u);
        Settle(Compute, Compute, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
    };
    Stamp(0u);
    if (Capture) Dispatch(0u, (CardWidth + 7u) / 8u, (CardHeight + 7u) / 8u);
    Stamp(1u);
    // Carry untouched lighting forward before refreshing a fixed-size card window. This is lighting, not a bake.
    Settle(Compute | Transfer, Transfer, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
           VK_ACCESS_TRANSFER_READ_BIT | VK_ACCESS_TRANSFER_WRITE_BIT);
    VkImageCopy Copy{};
    Copy.srcSubresource = Copy.dstSubresource = { VK_IMAGE_ASPECT_COLOR_BIT, 0u, 0u, 1u };
    Copy.extent = { CardWidth, CardHeight, 1u };
    vkCmdCopyImage(Command, CardImages[FrameNumber & 1u], VK_IMAGE_LAYOUT_GENERAL,
                   CardImages[1u - (FrameNumber & 1u)], VK_IMAGE_LAYOUT_GENERAL, 1u, &Copy);
    Settle(Transfer, Compute, VK_ACCESS_TRANSFER_READ_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
           VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
    Stamp(2u);
    const uint32_t CardTexels = CardWidth * CardHeight;
    Dispatch(1u, (std::min(kRadianceBudget, CardTexels) + 63u) / 64u, 1u);
    Stamp(3u);
    Stamp(4u);
    Dispatch(2u, ((Frame.RenderWidth + 1u) / 2u + 7u) / 8u, ((Frame.RenderHeight + 1u) / 2u + 7u) / 8u);
    Stamp(5u);
    Stamp(6u);
    // The specular term first (its own kernel — see DistanceFieldReflectionBody.slang), then the resolve adds it.
    Dispatch(4u, (Frame.RenderWidth + 15u) / 16u, (Frame.RenderHeight + 15u) / 16u);
    Dispatch(3u, (Frame.RenderWidth + 15u) / 16u, (Frame.RenderHeight + 15u) / 16u);
    Stamp(7u);
    if (FrameNumber % 120u == 0u)
    {
        std::cerr << "[SdfGI] no bake; placements=" << Geometry.QueryPlacements().size()
                  << ", card budget=" << std::min(kRadianceBudget, CardTexels) << ", gather=half-resolution/4 samples"
                  << ", debug view=" << Frame.DebugView << ", reflection mode=" << Frame.ReflectionMode;
        if (GpuDurations[0] >= 0.0f)
            std::cerr << ", GPU ms capture/radiance/gather/resolve=" << GpuDurations[0] << '/' << GpuDurations[1]
                      << '/' << GpuDurations[2] << '/' << GpuDurations[3];
        else std::cerr << ", GPU timing pending or unsupported";
        std::cerr << '\n';
    }
    UploadPending = false;
    ScreenHistoryReady = true;
    std::memcpy(PreviousLighting, Lighting, sizeof(Lighting));
    ResidentMaterials = Frame.MaterialRevision;
    ResidentCapture = Geometry.QueryCaptureRevision();
    ++FrameNumber;
    return true;
}

void DistanceFieldGIStage::RetireCardImages(uint32_t First)
{
    if (!Initialization.Device) return;
    for (uint32_t Slot = First; Slot < kCardImageCount; ++Slot)
    {
        if (CardViews[Slot]) vkDestroyImageView(Initialization.Device, CardViews[Slot], nullptr);
        if (CardImages[Slot]) vkDestroyImage(Initialization.Device, CardImages[Slot], nullptr);
        if (CardStorage[Slot]) vkFreeMemory(Initialization.Device, CardStorage[Slot], nullptr);
        CardViews[Slot] = VK_NULL_HANDLE; CardImages[Slot] = VK_NULL_HANDLE; CardStorage[Slot] = VK_NULL_HANDLE;
    }
}

void DistanceFieldGIStage::Destroy() noexcept
{
    if (Initialization.Device)
    {
        if (Timestamps) vkDestroyQueryPool(Initialization.Device, Timestamps, nullptr);
        if (Pool) vkDestroyDescriptorPool(Initialization.Device, Pool, nullptr);
        for (VkPipeline Pipeline : Pipelines) if (Pipeline) vkDestroyPipeline(Initialization.Device, Pipeline, nullptr);
        if (PipelineLayout) vkDestroyPipelineLayout(Initialization.Device, PipelineLayout, nullptr);
        if (DescriptorLayout) vkDestroyDescriptorSetLayout(Initialization.Device, DescriptorLayout, nullptr);
        RetireCardImages(0u);
        for (uint32_t Slot = 0u; Slot < 6u; ++Slot)
        {
            if (Buffers[Slot]) vkDestroyBuffer(Initialization.Device, Buffers[Slot], nullptr);
            if (Memory[Slot]) vkFreeMemory(Initialization.Device, Memory[Slot], nullptr);
        }
    }
    Initialization = {};
    std::fill_n(Buffers, 6u, VK_NULL_HANDLE); std::fill_n(Memory, 6u, VK_NULL_HANDLE); std::fill_n(Sizes, 6u, 0u);
    std::fill_n(Pipelines, kPipelineCount, VK_NULL_HANDLE); std::fill_n(Sets, 2u, VK_NULL_HANDLE);
    std::fill_n(RecordedSlots, 3u, false); std::fill_n(GpuDurations, 4u, -1.0f);
    Pool = VK_NULL_HANDLE; DescriptorLayout = VK_NULL_HANDLE; PipelineLayout = VK_NULL_HANDLE; Timestamps = VK_NULL_HANDLE;
    CardWidth = CardHeight = VoxelCount = FrameNumber = TimestampBits = 0u;
    ResidentRevision = 0u; ResidentMaterials = ResidentPlacements = ResidentCapture = UINT64_MAX;
    CardImagesInitialized = ScreenImagesInitialized = ScreenHistoryReady = UploadPending = Ready = false;
    std::fill_n(PreviousLighting, 11u, 0.0f);
}
}
