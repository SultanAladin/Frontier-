//============================================================================================================================================
// 📦 Editor/AuthoringTools/Modelling/SolidArc/Presentation/VulkanRaster.cpp — headless Vulkan implementation of RasterExchange
//============================================================================================================================================
// Build: needs <vulkan/vulkan.h> (Vulkan SDK or Khronos Vulkan-Headers) and, to run, a Vulkan loader + ICD. Tools/Build/CheckSolidArcVulkan.sh
//    compiles this file against the headers; it cannot run without a device, and it says so.
//
// Frame structure (one target per fit, same contract as SoftwareRaster):
//    BeginTarget  → reset arenas, begin command buffer and render pass (clear colour / pick 0 / depth 1), set viewport + scissor
//    BindView     → stage a GpuViewRecord (written to the view UBO slot at submit)
//    Draw*        → upload vertex data into the arena, stage a GpuDrawRecord, bind pipeline + descriptor set, record the draw
//    BeginOverlay → switch to the depth-test-off pipeline variants for the rest of the target
//    EndTarget    → end pass, copy colour / pick / depth to host buffers, submit, wait, read timestamps, cache readback
//
// Records are staged on the CPU and copied to their dynamic-offset slots only at EndTarget, so a slot is never overwritten while
//    recorded commands still point at it. Arenas are reset only after the previous submission has completed (fence wait).
#include "RasterExchange.h"
#include "VulkanRaster.h"
#include "Generated/SolidArcSpirv.inc"

#include <vulkan/vulkan.h>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

namespace Frontier
{

namespace
{

constexpr uint32_t MaxViews = 256;                       // view records per target
constexpr uint32_t MaxDraws = 8192;                      // draw records per target
constexpr VkDeviceSize ArenaBytes = VkDeviceSize(64) << 20;
constexpr VkDeviceSize ArenaBase = 64;                   // bytes 0..23 hold the quad index pattern
constexpr VkDeviceSize NoOffset = std::numeric_limits<VkDeviceSize>::max();

enum Kind : uint32_t { KindLattice = 0, KindSurface = 1, KindLine = 2, KindPoint = 3, KindCount = 4 };

// Std140 layouts that match Slang's ConstantBuffer<ViewRecord> (272 bytes) and ConstantBuffer<DrawRecord> (112 bytes).
struct GpuViewRecord
{
    float ViewClip[16];
    float ClipView[16];
    float ViewWorld[16];
    float EyePosition[4];
    float Viewport[4];
    float LatticeStyle[4];
    float Illumination[4];
    float DepthPolicy[4];        // x line bias, y radians per pixel (perspective), z world per pixel (ortho), w reserved
};
struct GpuDrawRecord
{
    float LocalWorld[16];
    float Tint[4];
    float Selection[4];          // x highlight, y pick identity as a float value (exact below 2^24), z line width, w point size
    float Surface[4];            // x matcap layer, y shading mode, z emissive, w dashed flag
};
static_assert(sizeof(GpuViewRecord) == 272, "ViewRecord layout: 3 float4x4 + 5 float4");
static_assert(sizeof(GpuDrawRecord) == 112, "DrawRecord layout");

void Log(const char* Format, ...)
{
    std::fputs("[SolidArc/Vulkan] ", stderr);
    va_list Args;
    va_start(Args, Format);
    std::vfprintf(stderr, Format, Args);
    va_end(Args);
    std::fputc('\n', stderr);
}

VkDeviceSize AlignUp(VkDeviceSize Value, VkDeviceSize Alignment)
{
    return Alignment ? (Value + Alignment - 1) / Alignment * Alignment : Value;
}

uint32_t FindMemoryType(const VkPhysicalDeviceMemoryProperties& Memory, uint32_t TypeBits, VkMemoryPropertyFlags Wanted)
{
    for (uint32_t I = 0; I < Memory.memoryTypeCount; ++I)
        if ((TypeBits & (1u << I)) && (Memory.memoryTypes[I].propertyFlags & Wanted) == Wanted) return I;
    return UINT32_MAX;
}

GpuViewRecord ToGpu(const ViewRecord& V)
{
    GpuViewRecord G{};
    std::memcpy(G.ViewClip, V.ViewClip, sizeof G.ViewClip);
    std::memcpy(G.ClipView, V.ClipView, sizeof G.ClipView);
    std::memcpy(G.ViewWorld, V.ViewWorld, sizeof G.ViewWorld);
    std::memcpy(G.EyePosition, V.EyePosition, sizeof G.EyePosition);
    std::memcpy(G.Viewport, V.Viewport, sizeof G.Viewport);
    std::memcpy(G.LatticeStyle, V.LatticeStyle, sizeof G.LatticeStyle);
    std::memcpy(G.Illumination, V.Illumination, sizeof G.Illumination);
    G.DepthPolicy[0] = V.DepthPolicy[0];
    G.DepthPolicy[1] = V.PixelAngle;
    G.DepthPolicy[2] = V.PixelWorld;
    G.DepthPolicy[3] = V.DepthPolicy[3];
    return G;
}

GpuDrawRecord ToGpu(const DrawRecord& D)
{
    GpuDrawRecord G{};
    std::memcpy(G.LocalWorld, D.LocalWorld, sizeof G.LocalWorld);
    std::memcpy(G.Tint, D.Tint, sizeof G.Tint);
    G.Selection[0] = D.Highlight;
    G.Selection[1] = static_cast<float>(D.PickIdentity);
    G.Selection[2] = D.LineWidth;
    G.Selection[3] = D.PointSize;
    G.Surface[0] = float(D.Matcap);
    G.Surface[1] = float(D.Shading);
    G.Surface[2] = D.Emissive;
    G.Surface[3] = D.Dashed ? 1.0f : 0.0f;
    return G;
}

} // namespace

struct VulkanRaster::Detail
{
    struct Buf { VkBuffer B = VK_NULL_HANDLE; VkDeviceMemory M = VK_NULL_HANDLE; uint8_t* Map = nullptr; };
    struct Img { VkImage I = VK_NULL_HANDLE; VkDeviceMemory M = VK_NULL_HANDLE; VkImageView V = VK_NULL_HANDLE; };

    uint32_t W = 0, H = 0;
    bool Valid = false;
    std::string Reason, Device;
    double GpuMs = 0.0;

    VkInstance Instance = VK_NULL_HANDLE;
    VkPhysicalDevice Phys = VK_NULL_HANDLE;
    VkDevice Dev = VK_NULL_HANDLE;
    VkQueue Queue = VK_NULL_HANDLE;
    uint32_t Family = 0;
    float TimestampNs = 1.0f;
    VkPhysicalDeviceMemoryProperties Memory{};
    VkDeviceSize MinUboAlign = 256;
    VkCommandPool Pool = VK_NULL_HANDLE;
    VkCommandBuffer Cmd = VK_NULL_HANDLE;
    VkFence Fence = VK_NULL_HANDLE;
    VkQueryPool Timing = VK_NULL_HANDLE;
    VkDescriptorSetLayout SetLayout = VK_NULL_HANDLE;
    VkPipelineLayout PipeLayout = VK_NULL_HANDLE;
    VkDescriptorPool DescPool = VK_NULL_HANDLE;
    VkDescriptorSet Set = VK_NULL_HANDLE;
    VkRenderPass Pass = VK_NULL_HANDLE;
    VkShaderModule Modules[8] = {};
    VkPipeline Pipes[KindCount][2][2] = {};          // [kind][overlay][pick]

    Buf ViewUbo, DrawUbo, Arena, ColourRead, PickRead, DepthRead;
    Img Colour, Pick, Depth;
    VkFramebuffer Fb = VK_NULL_HANDLE;
    VkDeviceSize ViewStride = 0, DrawStride = 0;
    VkDeviceSize ArenaCursor = ArenaBase;

    bool InTarget = false;
    bool Overlay = false;
    float Clear[4] = { 0.0f, 0.0f, 0.0f, 1.0f };
    std::vector<GpuViewRecord> Views;
    std::vector<GpuDrawRecord> Draws;
    int64_t CurView = -1;
    Tally Counts;

    RasterImage Cache;
    std::vector<uint32_t> PickCache;
    std::vector<float> DepthCache;

    bool Fail(const char* What, VkResult Result)
    {
        Reason = std::string(What) + " failed (VkResult " + std::to_string(static_cast<int>(Result)) + ")";
        Log("%s", Reason.c_str());
        return false;
    }

#define SA_VK(Expr, What) do { VkResult SaResult_ = (Expr); if (SaResult_ != VK_SUCCESS) return Fail(What, SaResult_); } while (0)

    bool MakeBuffer(VkDeviceSize Size, VkBufferUsageFlags Usage, Buf& Out, const char* What)
    {
        VkBufferCreateInfo CI{ VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO };
        CI.size = Size;
        CI.usage = Usage;
        CI.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        SA_VK(vkCreateBuffer(Dev, &CI, nullptr, &Out.B), What);
        VkMemoryRequirements Req{};
        vkGetBufferMemoryRequirements(Dev, Out.B, &Req);
        const uint32_t Type = FindMemoryType(Memory, Req.memoryTypeBits,
                                             VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        if (Type == UINT32_MAX) { Reason = std::string(What) + ": no host-visible coherent memory"; Log("%s", Reason.c_str()); return false; }
        VkMemoryAllocateInfo AI{ VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO };
        AI.allocationSize = Req.size;
        AI.memoryTypeIndex = Type;
        SA_VK(vkAllocateMemory(Dev, &AI, nullptr, &Out.M), What);
        SA_VK(vkBindBufferMemory(Dev, Out.B, Out.M, 0), What);
        void* Mapped = nullptr;
        SA_VK(vkMapMemory(Dev, Out.M, 0, VK_WHOLE_SIZE, 0, &Mapped), What);
        Out.Map = static_cast<uint8_t*>(Mapped);
        return true;
    }

    bool MakeImage(VkFormat Format, VkImageUsageFlags Usage, VkImageAspectFlags Aspect, Img& Out, const char* What)
    {
        VkImageCreateInfo CI{ VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO };
        CI.imageType = VK_IMAGE_TYPE_2D;
        CI.format = Format;
        CI.extent = { W, H, 1 };
        CI.mipLevels = 1;
        CI.arrayLayers = 1;
        CI.samples = VK_SAMPLE_COUNT_1_BIT;
        CI.tiling = VK_IMAGE_TILING_OPTIMAL;
        CI.usage = Usage;
        CI.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        CI.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        SA_VK(vkCreateImage(Dev, &CI, nullptr, &Out.I), What);
        VkMemoryRequirements Req{};
        vkGetImageMemoryRequirements(Dev, Out.I, &Req);
        const uint32_t Type = FindMemoryType(Memory, Req.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        if (Type == UINT32_MAX) { Reason = std::string(What) + ": no device-local memory"; Log("%s", Reason.c_str()); return false; }
        VkMemoryAllocateInfo AI{ VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO };
        AI.allocationSize = Req.size;
        AI.memoryTypeIndex = Type;
        SA_VK(vkAllocateMemory(Dev, &AI, nullptr, &Out.M), What);
        SA_VK(vkBindImageMemory(Dev, Out.I, Out.M, 0), What);
        VkImageViewCreateInfo VI{ VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO };
        VI.image = Out.I;
        VI.viewType = VK_IMAGE_VIEW_TYPE_2D;
        VI.format = Format;
        VI.subresourceRange = { Aspect, 0, 1, 0, 1 };
        SA_VK(vkCreateImageView(Dev, &VI, nullptr, &Out.V), What);
        return true;
    }

    static void Destroy(VkDevice Dev, Img& I)
    {
        if (I.V) vkDestroyImageView(Dev, I.V, nullptr);
        if (I.I) vkDestroyImage(Dev, I.I, nullptr);
        if (I.M) vkFreeMemory(Dev, I.M, nullptr);
        I = Img{};
    }
    static void Destroy(VkDevice Dev, Buf& B)
    {
        if (B.Map) vkUnmapMemory(Dev, B.M);
        if (B.B) vkDestroyBuffer(Dev, B.B, nullptr);
        if (B.M) vkFreeMemory(Dev, B.M, nullptr);
        B = Buf{};
    }

    bool PickDevice()
    {
        uint32_t Count = 0;
        SA_VK(vkEnumeratePhysicalDevices(Instance, &Count, nullptr), "vkEnumeratePhysicalDevices");
        if (Count == 0) { Reason = "no Vulkan physical device"; Log("%s", Reason.c_str()); return false; }
        std::vector<VkPhysicalDevice> Devices(Count);
        SA_VK(vkEnumeratePhysicalDevices(Instance, &Count, Devices.data()), "vkEnumeratePhysicalDevices");
        for (VkPhysicalDevice P : Devices)
        {
            uint32_t QCount = 0;
            vkGetPhysicalDeviceQueueFamilyProperties(P, &QCount, nullptr);
            std::vector<VkQueueFamilyProperties> Q(QCount);
            vkGetPhysicalDeviceQueueFamilyProperties(P, &QCount, Q.data());
            uint32_t Chosen = UINT32_MAX;
            for (uint32_t I = 0; I < QCount; ++I)
                if ((Q[I].queueFlags & VK_QUEUE_GRAPHICS_BIT) && Q[I].timestampValidBits > 0) { Chosen = I; break; }
            if (Chosen == UINT32_MAX) continue;
            auto Supports = [P](VkFormat F, VkFormatFeatureFlags Need) {
                VkFormatProperties FP{};
                vkGetPhysicalDeviceFormatProperties(P, F, &FP);
                return (FP.optimalTilingFeatures & Need) == Need;
            };
            if (!Supports(VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT | VK_FORMAT_FEATURE_TRANSFER_SRC_BIT)) continue;
            if (!Supports(VK_FORMAT_R32_UINT, VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT | VK_FORMAT_FEATURE_TRANSFER_SRC_BIT)) continue;
            if (!Supports(VK_FORMAT_D32_SFLOAT, VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT)) continue;
            Phys = P;
            Family = Chosen;
            VkPhysicalDeviceProperties Props{};
            vkGetPhysicalDeviceProperties(P, &Props);
            Device = Props.deviceName;
            TimestampNs = Props.limits.timestampPeriod;
            MinUboAlign = std::max<VkDeviceSize>(1, Props.limits.minUniformBufferOffsetAlignment);
            vkGetPhysicalDeviceMemoryProperties(P, &Memory);
            Log("device: %s · queue family %u · timestamp period %.3f ns", Device.c_str(), Family, double(TimestampNs));
            return true;
        }
        Reason = "no device with graphics + timestamps + R8G8B8A8/R32_UINT/D32 attachments";
        Log("%s", Reason.c_str());
        return false;
    }

    bool CreateDevice()
    {
        const float Priority = 1.0f;
        VkDeviceQueueCreateInfo QCI{ VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO };
        QCI.queueFamilyIndex = Family;
        QCI.queueCount = 1;
        QCI.pQueuePriorities = &Priority;
        VkDeviceCreateInfo DCI{ VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO };
        DCI.queueCreateInfoCount = 1;
        DCI.pQueueCreateInfos = &QCI;
        SA_VK(vkCreateDevice(Phys, &DCI, nullptr, &Dev), "vkCreateDevice");
        vkGetDeviceQueue(Dev, Family, 0, &Queue);

        VkCommandPoolCreateInfo PCI{ VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO };
        PCI.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        PCI.queueFamilyIndex = Family;
        SA_VK(vkCreateCommandPool(Dev, &PCI, nullptr, &Pool), "vkCreateCommandPool");
        VkCommandBufferAllocateInfo AI{ VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO };
        AI.commandPool = Pool;
        AI.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        AI.commandBufferCount = 1;
        SA_VK(vkAllocateCommandBuffers(Dev, &AI, &Cmd), "vkAllocateCommandBuffers");
        VkFenceCreateInfo FI{ VK_STRUCTURE_TYPE_FENCE_CREATE_INFO };
        SA_VK(vkCreateFence(Dev, &FI, nullptr, &Fence), "vkCreateFence");
        VkQueryPoolCreateInfo QP{ VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO };
        QP.queryType = VK_QUERY_TYPE_TIMESTAMP;
        QP.queryCount = 2;
        SA_VK(vkCreateQueryPool(Dev, &QP, nullptr, &Timing), "vkCreateQueryPool");

        // One set layout for every pipeline: view UBO at binding 0, draw UBO at binding 1, both dynamic.
        VkDescriptorSetLayoutBinding Bindings[2] = {};
        for (uint32_t I = 0; I < 2; ++I)
        {
            Bindings[I].binding = I;
            Bindings[I].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC;
            Bindings[I].descriptorCount = 1;
            Bindings[I].stageFlags = VK_SHADER_STAGE_ALL_GRAPHICS;
        }
        VkDescriptorSetLayoutCreateInfo SLI{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO };
        SLI.bindingCount = 2;
        SLI.pBindings = Bindings;
        SA_VK(vkCreateDescriptorSetLayout(Dev, &SLI, nullptr, &SetLayout), "vkCreateDescriptorSetLayout");
        VkPipelineLayoutCreateInfo PLI{ VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO };
        PLI.setLayoutCount = 1;
        PLI.pSetLayouts = &SetLayout;
        SA_VK(vkCreatePipelineLayout(Dev, &PLI, nullptr, &PipeLayout), "vkCreatePipelineLayout");
        VkDescriptorPoolSize PoolSize{ VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC, 2 };
        VkDescriptorPoolCreateInfo DPI{ VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO };
        DPI.maxSets = 1;
        DPI.poolSizeCount = 1;
        DPI.pPoolSizes = &PoolSize;
        SA_VK(vkCreateDescriptorPool(Dev, &DPI, nullptr, &DescPool), "vkCreateDescriptorPool");
        VkDescriptorSetAllocateInfo DSI{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO };
        DSI.descriptorPool = DescPool;
        DSI.descriptorSetCount = 1;
        DSI.pSetLayouts = &SetLayout;
        SA_VK(vkAllocateDescriptorSets(Dev, &DSI, &Set), "vkAllocateDescriptorSets");

        ViewStride = AlignUp(sizeof(GpuViewRecord), MinUboAlign);
        DrawStride = AlignUp(sizeof(GpuDrawRecord), MinUboAlign);
        if (!MakeBuffer(ViewStride * MaxViews, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, ViewUbo, "view UBO")) return false;
        if (!MakeBuffer(DrawStride * MaxDraws, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, DrawUbo, "draw UBO")) return false;
        if (!MakeBuffer(ArenaBytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_INDEX_BUFFER_BIT, Arena, "vertex arena")) return false;

        // Quad pattern used by the instanced line and point billboards: corners 0,1,3 and 0,3,2 (the CPU mirror's triangles).
        const uint32_t Quad[6] = { 0, 1, 3, 0, 3, 2 };
        std::memcpy(Arena.Map, Quad, sizeof Quad);

        VkDescriptorBufferInfo ViewInfo{ ViewUbo.B, 0, sizeof(GpuViewRecord) };
        VkDescriptorBufferInfo DrawInfo{ DrawUbo.B, 0, sizeof(GpuDrawRecord) };
        VkWriteDescriptorSet Writes[2] = {};
        Writes[0].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        Writes[0].dstSet = Set; Writes[0].dstBinding = 0; Writes[0].descriptorCount = 1;
        Writes[0].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC; Writes[0].pBufferInfo = &ViewInfo;
        Writes[1] = Writes[0];
        Writes[1].dstBinding = 1; Writes[1].pBufferInfo = &DrawInfo;
        vkUpdateDescriptorSets(Dev, 2, Writes, 0, nullptr);
        return true;
    }

    bool CreateShaders()
    {
        struct Blob { const uint32_t* Words; size_t Bytes; };
        const Blob Blobs[8] = {
            { SolidArcSpirv::LatticeVS, SolidArcSpirv::LatticeVSBytes }, { SolidArcSpirv::LatticeFS, SolidArcSpirv::LatticeFSBytes },
            { SolidArcSpirv::SurfaceVS, SolidArcSpirv::SurfaceVSBytes }, { SolidArcSpirv::SurfaceFS, SolidArcSpirv::SurfaceFSBytes },
            { SolidArcSpirv::LineVS,    SolidArcSpirv::LineVSBytes },    { SolidArcSpirv::LineFS,    SolidArcSpirv::LineFSBytes },
            { SolidArcSpirv::PointVS,   SolidArcSpirv::PointVSBytes },   { SolidArcSpirv::PointFS,   SolidArcSpirv::PointFSBytes },
        };
        for (int I = 0; I < 8; ++I)
        {
            VkShaderModuleCreateInfo CI{ VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO };
            CI.codeSize = Blobs[I].Bytes;
            CI.pCode = Blobs[I].Words;
            SA_VK(vkCreateShaderModule(Dev, &CI, nullptr, &Modules[I]), "vkCreateShaderModule");
        }
        return true;
    }

    bool CreateRenderPass()
    {
        VkAttachmentDescription A[3] = {};
        A[0].format = VK_FORMAT_R8G8B8A8_UNORM;
        A[1].format = VK_FORMAT_R32_UINT;
        A[2].format = VK_FORMAT_D32_SFLOAT;
        for (VkAttachmentDescription& D : A)
        {
            D.samples = VK_SAMPLE_COUNT_1_BIT;
            D.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
            D.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
            D.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
            D.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
            D.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
            D.finalLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        }
        VkAttachmentReference Colour[2] = { { 0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL }, { 1, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL } };
        VkAttachmentReference Depth{ 2, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL };
        VkSubpassDescription Sub{};
        Sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        Sub.colorAttachmentCount = 2;
        Sub.pColorAttachments = Colour;
        Sub.pDepthStencilAttachment = &Depth;
        VkSubpassDependency Deps[2] = {};
        Deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
        Deps[0].dstSubpass = 0;
        Deps[0].srcStageMask = VK_PIPELINE_STAGE_ALL_COMMANDS_BIT;
        Deps[0].srcAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT;
        Deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        Deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
        Deps[1].srcSubpass = 0;
        Deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
        Deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
        Deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
        Deps[1].dstStageMask = VK_PIPELINE_STAGE_TRANSFER_BIT;
        Deps[1].dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        VkRenderPassCreateInfo RPI{ VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO };
        RPI.attachmentCount = 3;
        RPI.pAttachments = A;
        RPI.subpassCount = 1;
        RPI.pSubpasses = &Sub;
        RPI.dependencyCount = 2;
        RPI.pDependencies = Deps;
        SA_VK(vkCreateRenderPass(Dev, &RPI, nullptr, &Pass), "vkCreateRenderPass");
        return true;
    }

    VkResult MakePipeline(Kind K, bool OverlayMode, bool PickMode, VkPipeline& Out)
    {
        const uint32_t VS = 2 * K, FS = VS + 1;
        VkPipelineShaderStageCreateInfo Stages[2] = {};
        static const char* VertexNames[4] = { "LatticeVS", "SurfaceVS", "LineVS", "PointVS" };
        static const char* FragmentNames[4] = { "LatticeFS", "SurfaceFS", "LineFS", "PointFS" };
        Stages[0].sType = Stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        Stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
        Stages[0].module = Modules[VS];
        Stages[0].pName = VertexNames[K];
        Stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
        Stages[1].module = Modules[FS];
        Stages[1].pName = FragmentNames[K];

        VkVertexInputBindingDescription Bind[3] = {};
        VkVertexInputAttributeDescription Attr[3] = {};
        VkPipelineVertexInputStateCreateInfo VIS{ VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO };
        if (K == KindSurface)
        {
            Bind[0] = { 0, 12, VK_VERTEX_INPUT_RATE_VERTEX };
            Bind[1] = { 1, 12, VK_VERTEX_INPUT_RATE_VERTEX };
            Bind[2] = { 2, 8,  VK_VERTEX_INPUT_RATE_VERTEX };
            Attr[0] = { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 };
            Attr[1] = { 1, 1, VK_FORMAT_R32G32B32_SFLOAT, 0 };
            Attr[2] = { 2, 2, VK_FORMAT_R32G32_SFLOAT, 0 };
            VIS.vertexBindingDescriptionCount = 3;
            VIS.vertexAttributeDescriptionCount = 3;
        }
        else if (K == KindLine)
        {
            Bind[0] = { 0, 24, VK_VERTEX_INPUT_RATE_INSTANCE };
            Attr[0] = { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 };
            Attr[1] = { 1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12 };
            VIS.vertexBindingDescriptionCount = 1;
            VIS.vertexAttributeDescriptionCount = 2;
        }
        else if (K == KindPoint)
        {
            Bind[0] = { 0, 16, VK_VERTEX_INPUT_RATE_INSTANCE };
            Attr[0] = { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 };
            Attr[1] = { 1, 0, VK_FORMAT_R32_SFLOAT, 12 };
            VIS.vertexBindingDescriptionCount = 1;
            VIS.vertexAttributeDescriptionCount = 2;
        }
        VIS.pVertexBindingDescriptions = Bind;
        VIS.pVertexAttributeDescriptions = Attr;

        VkPipelineInputAssemblyStateCreateInfo IA{ VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO };
        IA.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
        VkPipelineViewportStateCreateInfo VPS{ VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO };
        VPS.viewportCount = 1;
        VPS.scissorCount = 1;
        VkPipelineRasterizationStateCreateInfo RS{ VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO };
        RS.polygonMode = VK_POLYGON_MODE_FILL;
        RS.cullMode = VK_CULL_MODE_NONE;                  // back faces are shaded (tinted) by the Slang body, so no culling
        RS.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
        RS.lineWidth = 1.0f;
        VkPipelineMultisampleStateCreateInfo MS{ VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO };
        MS.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
        VkPipelineDepthStencilStateCreateInfo DS{ VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO };
        DS.depthTestEnable = OverlayMode ? VK_FALSE : VK_TRUE;
        DS.depthWriteEnable = OverlayMode ? VK_FALSE : VK_TRUE;
        DS.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;       // the mirror keeps a fragment when it is not behind the stored depth
        VkPipelineColorBlendAttachmentState Blend[2] = {};
        Blend[0].blendEnable = VK_TRUE;                         // straight alpha over the target
        Blend[0].srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
        Blend[0].dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
        Blend[0].colorBlendOp = VK_BLEND_OP_ADD;
        Blend[0].srcAlphaBlendFactor = VK_BLEND_FACTOR_ZERO;   // alpha stays as cleared (opaque backdrop)
        Blend[0].dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
        Blend[0].alphaBlendOp = VK_BLEND_OP_ADD;
        Blend[0].colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
        // Pick target: no blending; written only by pickable pipelines. The lattice shader never writes it.
        Blend[1].blendEnable = VK_FALSE;
        Blend[1].colorWriteMask = (PickMode && K != KindLattice) ? VK_COLOR_COMPONENT_R_BIT : 0;
        VkPipelineColorBlendStateCreateInfo CB{ VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO };
        CB.attachmentCount = 2;
        CB.pAttachments = Blend;
        VkDynamicState Dyn[2] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR };
        VkPipelineDynamicStateCreateInfo DSI{ VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO };
        DSI.dynamicStateCount = 2;
        DSI.pDynamicStates = Dyn;

        VkGraphicsPipelineCreateInfo CI{ VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO };
        CI.stageCount = 2;
        CI.pStages = Stages;
        CI.pVertexInputState = &VIS;
        CI.pInputAssemblyState = &IA;
        CI.pViewportState = &VPS;
        CI.pRasterizationState = &RS;
        CI.pMultisampleState = &MS;
        CI.pDepthStencilState = &DS;
        CI.pColorBlendState = &CB;
        CI.pDynamicState = &DSI;
        CI.layout = PipeLayout;
        CI.renderPass = Pass;
        CI.subpass = 0;
        return vkCreateGraphicsPipelines(Dev, VK_NULL_HANDLE, 1, &CI, nullptr, &Out);
    }

    bool CreatePipelines()
    {
        for (uint32_t K = 0; K < KindCount; ++K)
            for (uint32_t O = 0; O < 2; ++O)
                for (uint32_t P = 0; P < 2; ++P)
                    SA_VK(MakePipeline(static_cast<Kind>(K), O != 0, P != 0, Pipes[K][O][P]), "vkCreateGraphicsPipelines");
        return true;
    }

    bool BuildTargets()
    {
        if (!MakeImage(VK_FORMAT_R8G8B8A8_UNORM, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
                       VK_IMAGE_ASPECT_COLOR_BIT, Colour, "colour image")) return false;
        if (!MakeImage(VK_FORMAT_R32_UINT, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
                       VK_IMAGE_ASPECT_COLOR_BIT, Pick, "pick image")) return false;
        if (!MakeImage(VK_FORMAT_D32_SFLOAT, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
                       VK_IMAGE_ASPECT_DEPTH_BIT, Depth, "depth image")) return false;
        const VkDeviceSize Bytes = VkDeviceSize(W) * H * 4;
        if (!MakeBuffer(Bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT, ColourRead, "colour readback")) return false;
        if (!MakeBuffer(Bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT, PickRead, "pick readback")) return false;
        if (!MakeBuffer(Bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT, DepthRead, "depth readback")) return false;
        const VkImageView Views[3] = { Colour.V, Pick.V, Depth.V };
        VkFramebufferCreateInfo FI{ VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO };
        FI.renderPass = Pass;
        FI.attachmentCount = 3;
        FI.pAttachments = Views;
        FI.width = W;
        FI.height = H;
        FI.layers = 1;
        SA_VK(vkCreateFramebuffer(Dev, &FI, nullptr, &Fb), "vkCreateFramebuffer");
        return true;
    }

    void DestroyTargets()
    {
        if (Fb) vkDestroyFramebuffer(Dev, Fb, nullptr);
        Fb = VK_NULL_HANDLE;
        Destroy(Dev, Colour);
        Destroy(Dev, Pick);
        Destroy(Dev, Depth);
        Destroy(Dev, ColourRead);
        Destroy(Dev, PickRead);
        Destroy(Dev, DepthRead);
    }

    bool Init()
    {
        VkApplicationInfo App{ VK_STRUCTURE_TYPE_APPLICATION_INFO };
        App.pApplicationName = "SolidArc";
        App.apiVersion = VK_API_VERSION_1_2;
        VkInstanceCreateInfo IC{ VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO };
        IC.pApplicationInfo = &App;
        SA_VK(vkCreateInstance(&IC, nullptr, &Instance), "vkCreateInstance (no Vulkan loader or ICD?)");
        if (!PickDevice()) return false;
        if (!CreateDevice()) return false;
        if (!CreateShaders()) return false;
        if (!CreateRenderPass()) return false;
        if (!CreatePipelines()) return false;
        if (!BuildTargets()) return false;
        Log("ready: %ux%u · 16 pipelines · view stride %llu B · draw stride %llu B", W, H,
            static_cast<unsigned long long>(ViewStride), static_cast<unsigned long long>(DrawStride));
        return true;
    }

    void Teardown()
    {
        if (Dev)
        {
            vkDeviceWaitIdle(Dev);
            DestroyDevice();
        }
        if (Instance) vkDestroyInstance(Instance, nullptr);
        Instance = VK_NULL_HANDLE;
    }

    void DestroyDevice()
    {
        DestroyTargets();
        for (VkShaderModule M : Modules) if (M) vkDestroyShaderModule(Dev, M, nullptr);
        for (auto& K : Pipes) for (auto& O : K) for (VkPipeline P : O) if (P) vkDestroyPipeline(Dev, P, nullptr);
        if (Pass) vkDestroyRenderPass(Dev, Pass, nullptr);
        Destroy(Dev, ViewUbo);
        Destroy(Dev, DrawUbo);
        Destroy(Dev, Arena);
        if (DescPool) vkDestroyDescriptorPool(Dev, DescPool, nullptr);
        if (PipeLayout) vkDestroyPipelineLayout(Dev, PipeLayout, nullptr);
        if (SetLayout) vkDestroyDescriptorSetLayout(Dev, SetLayout, nullptr);
        if (Timing) vkDestroyQueryPool(Dev, Timing, nullptr);
        if (Fence) vkDestroyFence(Dev, Fence, nullptr);
        if (Pool) vkDestroyCommandPool(Dev, Pool, nullptr);
        vkDestroyDevice(Dev, nullptr);
        Dev = VK_NULL_HANDLE;
    }

    // Copies vertex data into the arena. Returns NoOffset (and logs) when the arena is full.
    VkDeviceSize Upload(const void* Source, size_t Bytes)
    {
        const VkDeviceSize Offset = AlignUp(ArenaCursor, 16);
        if (Offset + Bytes > ArenaBytes)
        {
            Log("vertex arena full (%llu of %llu bytes used); draw skipped", static_cast<unsigned long long>(Offset),
                static_cast<unsigned long long>(ArenaBytes));
            return NoOffset;
        }
        std::memcpy(Arena.Map + Offset, Source, Bytes);
        ArenaCursor = Offset + Bytes;
        return Offset;
    }

    // Binds the pipeline and descriptor set for one draw and stages its record. False when the draw must be skipped.
    bool Prepare(Kind K, const DrawRecord& Draw, bool PickMode)
    {
        if (!InTarget) { Log("draw outside BeginTarget/EndTarget; ignored"); return false; }
        if (CurView < 0) { Log("draw before BindView; ignored"); return false; }
        if (Draws.size() >= MaxDraws) { Log("draw slots exhausted (%u); draw skipped", MaxDraws); return false; }
        vkCmdBindPipeline(Cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, Pipes[K][Overlay ? 1 : 0][PickMode ? 1 : 0]);
        const uint32_t Slot = static_cast<uint32_t>(Draws.size());
        Draws.push_back(ToGpu(Draw));
        const uint32_t Offsets[2] = { static_cast<uint32_t>(CurView * ViewStride), static_cast<uint32_t>(Slot * DrawStride) };
        vkCmdBindDescriptorSets(Cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, PipeLayout, 0, 1, &Set, 2, Offsets);
        return true;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  PUBLIC SURFACE
//------------------------------------------------------------------------------------------------------------------------

VulkanRaster::VulkanRaster(uint32_t Width, uint32_t Height) noexcept : Self(std::make_unique<Detail>())
{
    Self->W = Width;
    Self->H = Height;
    Self->Valid = Self->Init();
    if (Self->Valid) Log("VulkanRaster valid (%s)", Self->Device.c_str());
    else Log("VulkanRaster unavailable: %s", Self->Reason.c_str());
}

VulkanRaster::~VulkanRaster()
{
    if (Self) Self->Teardown();
}

bool VulkanRaster::Valid() const noexcept { return Self->Valid; }
const std::string& VulkanRaster::FailureReason() const noexcept { return Self->Reason; }
const std::string& VulkanRaster::DeviceName() const noexcept { return Self->Device; }
double VulkanRaster::LastGpuMilliseconds() const noexcept { return Self->GpuMs; }

void VulkanRaster::Resize(uint32_t Width, uint32_t Height) noexcept
{
    if (!Self->Valid || Width == 0 || Height == 0) return;
    if (Self->InTarget) EndTarget();
    vkDeviceWaitIdle(Self->Dev);
    Self->DestroyTargets();
    Self->W = Width;
    Self->H = Height;
    if (!Self->BuildTargets())
    {
        Self->Valid = false;
        Log("resize to %ux%u failed: %s", Width, Height, Self->Reason.c_str());
    }
}

uint32_t VulkanRaster::Width() const noexcept { return Self->W; }
uint32_t VulkanRaster::Height() const noexcept { return Self->H; }

void VulkanRaster::BeginTarget(const float ClearColour[4]) noexcept
{
    auto& D = *Self;
    if (!D.Valid) return;
    if (D.InTarget) { Log("BeginTarget while a target is open; closing it first"); EndTarget(); }
    std::memcpy(D.Clear, ClearColour, sizeof D.Clear);
    D.Views.clear();
    D.Draws.clear();
    D.CurView = -1;
    D.Overlay = false;
    D.ArenaCursor = ArenaBase;
    D.Counts = Tally{};

    VkCommandBufferBeginInfo BI{ VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO };
    BI.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkResetCommandBuffer(D.Cmd, 0);
    vkBeginCommandBuffer(D.Cmd, &BI);
    vkCmdResetQueryPool(D.Cmd, D.Timing, 0, 2);
    vkCmdWriteTimestamp(D.Cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, D.Timing, 0);

    VkClearValue Clear[3] = {};
    Clear[0].color.float32[0] = ClearColour[0];
    Clear[0].color.float32[1] = ClearColour[1];
    Clear[0].color.float32[2] = ClearColour[2];
    Clear[0].color.float32[3] = ClearColour[3];
    Clear[1].color.uint32[0] = 0;
    Clear[1].color.uint32[1] = 0;
    Clear[1].color.uint32[2] = 0;
    Clear[1].color.uint32[3] = 0;
    Clear[2].depthStencil = { 1.0f, 0 };

    VkRenderPassBeginInfo RB{ VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO };
    RB.renderPass = D.Pass;
    RB.framebuffer = D.Fb;
    RB.renderArea = { { 0, 0 }, { D.W, D.H } };
    RB.clearValueCount = 3;
    RB.pClearValues = Clear;
    vkCmdBeginRenderPass(D.Cmd, &RB, VK_SUBPASS_CONTENTS_INLINE);
    const VkViewport VP{ 0.0f, 0.0f, float(D.W), float(D.H), 0.0f, 1.0f };
    const VkRect2D Scissor{ { 0, 0 }, { D.W, D.H } };
    vkCmdSetViewport(D.Cmd, 0, 1, &VP);
    vkCmdSetScissor(D.Cmd, 0, 1, &Scissor);
    D.InTarget = true;
}

void VulkanRaster::BindView(const ViewRecord& View) noexcept
{
    auto& D = *Self;
    if (!D.InTarget) { Log("BindView outside a target; ignored"); return; }
    if (D.Views.size() >= MaxViews) { Log("view slots exhausted (%u); BindView ignored", MaxViews); return; }
    D.Views.push_back(ToGpu(View));
    D.CurView = static_cast<int64_t>(D.Views.size() - 1);
}

void VulkanRaster::DrawLattice() noexcept
{
    auto& D = *Self;
    if (!D.Valid || !D.InTarget) return;
    DrawRecord Empty{};
    if (!D.Prepare(KindLattice, Empty, false)) return;
    vkCmdDraw(D.Cmd, 3, 1, 0, 0);
}

void VulkanRaster::DrawSurface(const SurfaceStream& Stream, const DrawRecord& Draw) noexcept
{
    auto& D = *Self;
    if (!D.Valid || !D.InTarget) return;
    const uint32_t Vertices = Stream.VertexCount();
    const size_t Indices = Stream.Triangles.size();
    if (Vertices == 0 || Indices < 3) return;
    if (Indices % 3 != 0 || Stream.Positions.size() < size_t(Vertices) * 3 ||
        Stream.Normals.size() < size_t(Vertices) * 3 || Stream.Parameters.size() < size_t(Vertices) * 2)
    {
        Log("surface stream malformed (%u vertices, %zu indices); draw skipped", Vertices, Indices);
        return;
    }
    const VkDeviceSize OffP = D.Upload(Stream.Positions.data(), size_t(Vertices) * 12);
    const VkDeviceSize OffN = D.Upload(Stream.Normals.data(), size_t(Vertices) * 12);
    const VkDeviceSize OffUV = D.Upload(Stream.Parameters.data(), size_t(Vertices) * 8);
    const VkDeviceSize OffI = D.Upload(Stream.Triangles.data(), Indices * 4);
    if (OffP == NoOffset || OffN == NoOffset || OffUV == NoOffset || OffI == NoOffset) return;
    if (!D.Prepare(KindSurface, Draw, Draw.PickIdentity != 0)) return;
    const VkBuffer Buffers[3] = { D.Arena.B, D.Arena.B, D.Arena.B };
    const VkDeviceSize Offsets[3] = { OffP, OffN, OffUV };
    vkCmdBindVertexBuffers(D.Cmd, 0, 3, Buffers, Offsets);
    vkCmdBindIndexBuffer(D.Cmd, D.Arena.B, OffI, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(D.Cmd, static_cast<uint32_t>(Indices), 1, 0, 0, 0);
    D.Counts.Triangles += static_cast<uint32_t>(Indices / 3);
}

void VulkanRaster::DrawSegments(const SegmentStream& Stream, const DrawRecord& Draw) noexcept
{
    auto& D = *Self;
    if (!D.Valid || !D.InTarget) return;
    const uint32_t Count = Stream.SegmentCount();
    if (Count == 0) return;
    const VkDeviceSize Off = D.Upload(Stream.Endpoints.data(), size_t(Count) * 24);
    if (Off == NoOffset) return;
    if (!D.Prepare(KindLine, Draw, Draw.PickIdentity != 0)) return;
    vkCmdBindVertexBuffers(D.Cmd, 0, 1, &D.Arena.B, &Off);
    vkCmdBindIndexBuffer(D.Cmd, D.Arena.B, 0, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(D.Cmd, 6, Count, 0, 0, 0);
    D.Counts.Segments += Count;
}

void VulkanRaster::DrawPoints(const PointStream& Stream, const DrawRecord& Draw) noexcept
{
    auto& D = *Self;
    if (!D.Valid || !D.InTarget) return;
    const uint32_t Count = Stream.PointCount();
    if (Count == 0) return;
    const VkDeviceSize Off = D.Upload(Stream.Points.data(), size_t(Count) * 16);
    if (Off == NoOffset) return;
    if (!D.Prepare(KindPoint, Draw, Draw.PickIdentity != 0)) return;
    vkCmdBindVertexBuffers(D.Cmd, 0, 1, &D.Arena.B, &Off);
    vkCmdBindIndexBuffer(D.Cmd, D.Arena.B, 0, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(D.Cmd, 6, Count, 0, 0, 0);
    D.Counts.Points += Count;
}

void VulkanRaster::BeginOverlay() noexcept { Self->Overlay = true; }

void VulkanRaster::EndTarget() noexcept
{
    auto& D = *Self;
    if (!D.InTarget) return;
    const VkDeviceSize Bytes = VkDeviceSize(D.W) * D.H * 4;

    vkCmdEndRenderPass(D.Cmd);
    vkCmdWriteTimestamp(D.Cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, D.Timing, 1);
    VkBufferImageCopy Region{};
    Region.imageExtent = { D.W, D.H, 1 };
    Region.imageSubresource = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 };
    vkCmdCopyImageToBuffer(D.Cmd, D.Colour.I, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, D.ColourRead.B, 1, &Region);
    vkCmdCopyImageToBuffer(D.Cmd, D.Pick.I, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, D.PickRead.B, 1, &Region);
    Region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_DEPTH_BIT;
    vkCmdCopyImageToBuffer(D.Cmd, D.Depth.I, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, D.DepthRead.B, 1, &Region);
    VkBufferMemoryBarrier Barriers[3] = {};
    const VkBuffer Targets[3] = { D.ColourRead.B, D.PickRead.B, D.DepthRead.B };
    for (int I = 0; I < 3; ++I)
    {
        Barriers[I].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        Barriers[I].srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        Barriers[I].dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        Barriers[I].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        Barriers[I].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        Barriers[I].buffer = Targets[I];
        Barriers[I].size = VK_WHOLE_SIZE;
    }
    vkCmdPipelineBarrier(D.Cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 0, nullptr, 3, Barriers, 0, nullptr);
    vkEndCommandBuffer(D.Cmd);

    // Records reach their slots only now, so no recorded draw ever reads a slot overwritten by a later one.
    for (size_t I = 0; I < D.Views.size(); ++I)
        std::memcpy(D.ViewUbo.Map + I * D.ViewStride, &D.Views[I], sizeof(GpuViewRecord));
    for (size_t I = 0; I < D.Draws.size(); ++I)
        std::memcpy(D.DrawUbo.Map + I * D.DrawStride, &D.Draws[I], sizeof(GpuDrawRecord));

    VkSubmitInfo Submit{ VK_STRUCTURE_TYPE_SUBMIT_INFO };
    Submit.commandBufferCount = 1;
    Submit.pCommandBuffers = &D.Cmd;
    vkResetFences(D.Dev, 1, &D.Fence);
    if (vkQueueSubmit(D.Queue, 1, &Submit, D.Fence) != VK_SUCCESS || vkWaitForFences(D.Dev, 1, &D.Fence, VK_TRUE, UINT64_MAX) != VK_SUCCESS)
    {
        Log("submit or fence wait failed; target discarded");
        D.Valid = false;
        D.InTarget = false;
        return;
    }
    uint64_t Stamps[2] = { 0, 0 };
    vkGetQueryPoolResults(D.Dev, D.Timing, 0, 2, sizeof Stamps, Stamps, sizeof(uint64_t), VK_QUERY_RESULT_64_BIT | VK_QUERY_RESULT_WAIT_BIT);
    D.GpuMs = double(Stamps[1] - Stamps[0]) * double(D.TimestampNs) * 1e-6;

    const size_t Pixels = size_t(D.W) * D.H;
    D.Cache.Width = D.W;
    D.Cache.Height = D.H;
    D.Cache.Pixels.assign(D.ColourRead.Map, D.ColourRead.Map + Bytes);
    D.PickCache.resize(Pixels);
    std::memcpy(D.PickCache.data(), D.PickRead.Map, Bytes);
    D.DepthCache.resize(Pixels);
    std::memcpy(D.DepthCache.data(), D.DepthRead.Map, Bytes);

    Log("target %ux%u · draws %zu · triangles %u · segments %u · points %u · views %zu · GPU %.3f ms (timestamps)",
        D.W, D.H, D.Draws.size(), D.Counts.Triangles, D.Counts.Segments, D.Counts.Points, D.Views.size(), D.GpuMs);
    D.InTarget = false;
    D.Overlay = false;
    D.CurView = -1;
}

RasterImage VulkanRaster::Readback() const noexcept { return Self->Cache; }

uint32_t VulkanRaster::Pick(uint32_t X, uint32_t Y) const noexcept
{
    const auto& D = *Self;
    if (X >= D.W || Y >= D.H || D.PickCache.empty()) return 0;
    return D.PickCache[size_t(Y) * D.W + X];
}

float VulkanRaster::Depth(uint32_t X, uint32_t Y) const noexcept
{
    const auto& D = *Self;
    if (X >= D.W || Y >= D.H || D.DepthCache.empty()) return 1.0f;
    return D.DepthCache[size_t(Y) * D.W + X];
}

RasterExchange::Tally VulkanRaster::QueryTally() const noexcept { return Self->Counts; }

} // namespace Frontier
