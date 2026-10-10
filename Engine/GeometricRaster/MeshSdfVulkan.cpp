//============================================================================================================================================
//                                                      MESHSDFVULKAN.CPP
//============================================================================================================================================
// 📦 Vulkan host for the mesh SDF kernels. See MeshSdfVulkan.h. Compile-checked only in the build sandbox; device-unverified.

#include "MeshSdfVulkan.h"

#include "Generated/MeshSdfSpirv.inc"

#include <algorithm>
#include <chrono>
#include <cstring>

namespace MeshSdfVulkan
{
namespace
{
const char* VendorName(uint32_t Id)
{
    switch (Id)
    {
        case 0x10DE: return "NVIDIA";
        case 0x1002: return "AMD";
        case 0x8086: return "Intel";
        case 0x13B5: return "ARM";
        case 0x5143: return "Qualcomm";
        case 0x1010: return "ImgTec";
        default:     return "other";
    }
}

const char* TypeName(VkPhysicalDeviceType Type)
{
    switch (Type)
    {
        case VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU:   return "discrete";
        case VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU: return "integrated";
        case VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU:    return "virtual";
        case VK_PHYSICAL_DEVICE_TYPE_CPU:            return "cpu";
        default:                                     return "other";
    }
}

bool FindComputeFamily(VkPhysicalDevice Physical, uint32_t& Family)
{
    uint32_t Count = 0u;
    vkGetPhysicalDeviceQueueFamilyProperties(Physical, &Count, nullptr);
    std::vector<VkQueueFamilyProperties> Props(Count);
    vkGetPhysicalDeviceQueueFamilyProperties(Physical, &Count, Props.data());
    for (uint32_t I = 0u; I < Count; ++I)
        if (Props[I].queueFlags & VK_QUEUE_COMPUTE_BIT) { Family = I; return true; }
    return false;
}

bool FindMemory(const VkPhysicalDeviceMemoryProperties& Memory, uint32_t TypeBits, VkMemoryPropertyFlags Wanted, uint32_t& Type)
{
    for (uint32_t I = 0u; I < Memory.memoryTypeCount; ++I)
        if ((TypeBits & (1u << I)) && (Memory.memoryTypes[I].propertyFlags & Wanted) == Wanted) { Type = I; return true; }
    return false;
}

// Host-visible, host-coherent buffer. First version: simple and correct. A device-local path comes later.
struct Buffer
{
    VkBuffer Handle = VK_NULL_HANDLE;
    VkDeviceMemory Memory = VK_NULL_HANDLE;
    VkDeviceSize Bytes = 0u;
};

bool MakeBuffer(VkDevice Device, const VkPhysicalDeviceMemoryProperties& Memory, VkDeviceSize Bytes, VkBufferUsageFlags Usage,
                Buffer& Out, std::string& Error)
{
    VkBufferCreateInfo Info{ VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO };
    Info.size = std::max<VkDeviceSize>(Bytes, 16u);
    Info.usage = Usage;
    Info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (vkCreateBuffer(Device, &Info, nullptr, &Out.Handle) != VK_SUCCESS) { Error = "vkCreateBuffer failed"; return false; }
    VkMemoryRequirements Req{};
    vkGetBufferMemoryRequirements(Device, Out.Handle, &Req);
    uint32_t Type = 0u;
    if (!FindMemory(Memory, Req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, Type))
    {
        Error = "no host-visible coherent memory type";
        return false;
    }
    VkMemoryAllocateInfo Alloc{ VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO };
    Alloc.allocationSize = Req.size;
    Alloc.memoryTypeIndex = Type;
    if (vkAllocateMemory(Device, &Alloc, nullptr, &Out.Memory) != VK_SUCCESS) { Error = "vkAllocateMemory failed"; return false; }
    vkBindBufferMemory(Device, Out.Handle, Out.Memory, 0u);
    Out.Bytes = Info.size;
    return true;
}

void DestroyBuffer(VkDevice Device, Buffer& B)
{
    if (B.Handle) vkDestroyBuffer(Device, B.Handle, nullptr);
    if (B.Memory) vkFreeMemory(Device, B.Memory, nullptr);
    B = Buffer{};
}

void Upload(VkDevice Device, const Buffer& B, const void* Data, size_t Bytes)
{
    void* Mapped = nullptr;
    vkMapMemory(Device, B.Memory, 0u, VK_WHOLE_SIZE, 0u, &Mapped);
    std::memcpy(Mapped, Data, Bytes);
    vkUnmapMemory(Device, B.Memory);
}

void Download(VkDevice Device, const Buffer& B, void* Data, size_t Bytes)
{
    void* Mapped = nullptr;
    vkMapMemory(Device, B.Memory, 0u, VK_WHOLE_SIZE, 0u, &Mapped);
    std::memcpy(Data, Mapped, Bytes);
    vkUnmapMemory(Device, B.Memory);
}

VkDescriptorSetLayout MakeSetLayout(VkDevice Device, const std::vector<std::pair<uint32_t, VkDescriptorType>>& Bindings)
{
    std::vector<VkDescriptorSetLayoutBinding> List;
    for (const auto& B : Bindings)
    {
        VkDescriptorSetLayoutBinding L{};
        L.binding = B.first;
        L.descriptorType = B.second;
        L.descriptorCount = 1u;
        L.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        List.push_back(L);
    }
    VkDescriptorSetLayoutCreateInfo Info{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO };
    Info.bindingCount = uint32_t(List.size());
    Info.pBindings = List.data();
    VkDescriptorSetLayout Layout = VK_NULL_HANDLE;
    vkCreateDescriptorSetLayout(Device, &Info, nullptr, &Layout);
    return Layout;
}

VkPipeline MakePipeline(VkDevice Device, VkShaderModule Module, const char* Entry, VkPipelineLayout Layout)
{
    VkComputePipelineCreateInfo Info{ VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO };
    Info.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    Info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    Info.stage.module = Module;
    Info.stage.pName = Entry;
    Info.layout = Layout;
    VkPipeline Pipeline = VK_NULL_HANDLE;
    vkCreateComputePipelines(Device, VK_NULL_HANDLE, 1u, &Info, nullptr, &Pipeline);
    return Pipeline;
}

// Records one submission with the given bindings, runs it, waits for completion. Returns wall-clock seconds from submit to fence.
bool RunOnce(VkDevice Device, VkQueue Queue, VkCommandPool Commands, VkFence Fence, VkPipeline Pipeline, VkPipelineLayout Layout,
             VkDescriptorSet Set, uint32_t GroupsX, uint32_t GroupsY, uint32_t GroupsZ, double& Seconds, std::string& Error)
{
    VkCommandBufferAllocateInfo Alloc{ VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO };
    Alloc.commandPool = Commands;
    Alloc.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    Alloc.commandBufferCount = 1u;
    VkCommandBuffer Cmd = VK_NULL_HANDLE;
    if (vkAllocateCommandBuffers(Device, &Alloc, &Cmd) != VK_SUCCESS) { Error = "vkAllocateCommandBuffers failed"; return false; }
    VkCommandBufferBeginInfo Begin{ VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO };
    Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(Cmd, &Begin);
    vkCmdBindPipeline(Cmd, VK_PIPELINE_BIND_POINT_COMPUTE, Pipeline);
    vkCmdBindDescriptorSets(Cmd, VK_PIPELINE_BIND_POINT_COMPUTE, Layout, 0u, 1u, &Set, 0u, nullptr);
    vkCmdDispatch(Cmd, GroupsX, GroupsY, GroupsZ);
    vkEndCommandBuffer(Cmd);

    vkResetFences(Device, 1u, &Fence);
    VkSubmitInfo Submit{ VK_STRUCTURE_TYPE_SUBMIT_INFO };
    Submit.commandBufferCount = 1u;
    Submit.pCommandBuffers = &Cmd;
    const auto T0 = std::chrono::steady_clock::now();
    if (vkQueueSubmit(Queue, 1u, &Submit, Fence) != VK_SUCCESS) { Error = "vkQueueSubmit failed"; vkFreeCommandBuffers(Device, Commands, 1u, &Cmd); return false; }
    const VkResult Wait = vkWaitForFences(Device, 1u, &Fence, VK_TRUE, UINT64_MAX);
    Seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count();
    vkFreeCommandBuffers(Device, Commands, 1u, &Cmd);
    if (Wait != VK_SUCCESS) { Error = "vkWaitForFences failed"; return false; }
    return true;
}

VkDescriptorSet AllocSet(VkDevice Device, VkDescriptorPool Pool, VkDescriptorSetLayout Layout)
{
    VkDescriptorSetAllocateInfo Alloc{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO };
    Alloc.descriptorPool = Pool;
    Alloc.descriptorSetCount = 1u;
    Alloc.pSetLayouts = &Layout;
    VkDescriptorSet Set = VK_NULL_HANDLE;
    vkAllocateDescriptorSets(Device, &Alloc, &Set);
    return Set;
}

void Write(VkDevice Device, VkDescriptorSet Set, uint32_t Binding, VkDescriptorType Type, const Buffer& B)
{
    VkDescriptorBufferInfo Info{ B.Handle, 0u, VK_WHOLE_SIZE };
    VkWriteDescriptorSet Write{ VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET };
    Write.dstSet = Set;
    Write.dstBinding = Binding;
    Write.descriptorCount = 1u;
    Write.descriptorType = Type;
    Write.pBufferInfo = &Info;
    vkUpdateDescriptorSets(Device, 1u, &Write, 0u, nullptr);
}
} // namespace

bool CreateContext(Context& Out, std::string& Log, std::string& Error)
{
    VkApplicationInfo App{ VK_STRUCTURE_TYPE_APPLICATION_INFO };
    App.pApplicationName = "MeshSdfDeviceCheck";
    App.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo Info{ VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO };
    Info.pApplicationInfo = &App;
    if (vkCreateInstance(&Info, nullptr, &Out.Instance) != VK_SUCCESS) { Error = "vkCreateInstance failed (is a Vulkan driver installed?)"; return false; }

    uint32_t Count = 0u;
    vkEnumeratePhysicalDevices(Out.Instance, &Count, nullptr);
    if (Count == 0u) { Error = "no Vulkan physical devices"; return false; }
    std::vector<VkPhysicalDevice> Devices(Count);
    vkEnumeratePhysicalDevices(Out.Instance, &Count, Devices.data());

    // Log every device, then prefer a discrete GPU with compute.
    int Chosen = -1;
    for (uint32_t I = 0u; I < Count; ++I)
    {
        VkPhysicalDeviceProperties P{};
        vkGetPhysicalDeviceProperties(Devices[I], &P);
        uint32_t Family = 0u;
        const bool HasCompute = FindComputeFamily(Devices[I], Family);
        Log += "[MeshSdf] device " + std::to_string(I) + ": " + P.deviceName + " (" + VendorName(P.vendorID) + ", " + TypeName(P.deviceType) +
               ", compute " + (HasCompute ? "yes" : "no") + ")\n";
        if (HasCompute && (Chosen < 0 || (P.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU &&
                                          Out.Properties.deviceType != VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU)))
        {
            Chosen = int(I);
            Out.Properties = P;
        }
    }
    if (Chosen < 0) { Error = "no device with a compute queue"; return false; }
    Out.Physical = Devices[size_t(Chosen)];
    if (!FindComputeFamily(Out.Physical, Out.QueueFamily)) { Error = "chosen device lost its compute queue"; return false; }

    const float Priority = 1.0f;
    VkDeviceQueueCreateInfo Queue{ VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO };
    Queue.queueFamilyIndex = Out.QueueFamily;
    Queue.queueCount = 1u;
    Queue.pQueuePriorities = &Priority;
    VkDeviceCreateInfo DeviceInfo{ VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO };
    DeviceInfo.queueCreateInfoCount = 1u;
    DeviceInfo.pQueueCreateInfos = &Queue;
    if (vkCreateDevice(Out.Physical, &DeviceInfo, nullptr, &Out.Device) != VK_SUCCESS) { Error = "vkCreateDevice failed"; return false; }
    vkGetDeviceQueue(Out.Device, Out.QueueFamily, 0u, &Out.Queue);
    Log += "[MeshSdf] using: " + std::string(Out.Properties.deviceName) + "\n";
    return true;
}

void DestroyContext(Context& Ctx)
{
    if (Ctx.Device) vkDestroyDevice(Ctx.Device, nullptr);
    if (Ctx.Instance) vkDestroyInstance(Ctx.Instance, nullptr);
    Ctx = Context{};
}

bool Kernels::Create(const Context& Ctx, std::string& Error)
{
    Device = Ctx.Device;
    Queue = Ctx.Queue;
    QueueFamily = Ctx.QueueFamily;
    vkGetPhysicalDeviceMemoryProperties(Ctx.Physical, &Memory);

    VkShaderModuleCreateInfo Info{ VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO };
    Info.codeSize = sizeof(MeshSdfSpirv::BakeMain);
    Info.pCode = MeshSdfSpirv::BakeMain;
    if (vkCreateShaderModule(Device, &Info, nullptr, &BakeModule) != VK_SUCCESS) { Error = "bake shader module rejected"; return false; }
    Info.codeSize = sizeof(MeshSdfSpirv::CompositeMain);
    Info.pCode = MeshSdfSpirv::CompositeMain;
    if (vkCreateShaderModule(Device, &Info, nullptr, &CompositeModule) != VK_SUCCESS) { Error = "composite shader module rejected"; return false; }

    // BakeMain uses bindings 0 (params), 1 (triangles), 2 (output). CompositeMain uses 3 (params), 4 (instances), 5 (fields), 6 (clip).
    BakeLayout = MakeSetLayout(Device, { { 0u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER }, { 1u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER },
                                         { 2u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER } });
    CompositeLayout = MakeSetLayout(Device, { { 3u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER }, { 4u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER },
                                              { 5u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER }, { 6u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER } });
    if (!BakeLayout || !CompositeLayout) { Error = "descriptor set layout failed"; return false; }

    VkPipelineLayoutCreateInfo PL{ VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO };
    PL.setLayoutCount = 1u;
    PL.pSetLayouts = &BakeLayout;
    if (vkCreatePipelineLayout(Device, &PL, nullptr, &BakePipelineLayout) != VK_SUCCESS) { Error = "bake pipeline layout failed"; return false; }
    PL.pSetLayouts = &CompositeLayout;
    if (vkCreatePipelineLayout(Device, &PL, nullptr, &CompositePipelineLayout) != VK_SUCCESS) { Error = "composite pipeline layout failed"; return false; }

    BakePipeline = MakePipeline(Device, BakeModule, "BakeMain", BakePipelineLayout);
    CompositePipeline = MakePipeline(Device, CompositeModule, "CompositeMain", CompositePipelineLayout);
    if (!BakePipeline || !CompositePipeline) { Error = "compute pipeline creation failed"; return false; }

    VkDescriptorPoolSize Sizes[2] = { { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 4u }, { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 12u } };
    VkDescriptorPoolCreateInfo PoolInfo{ VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO };
    PoolInfo.maxSets = 4u;
    PoolInfo.poolSizeCount = 2u;
    PoolInfo.pPoolSizes = Sizes;
    if (vkCreateDescriptorPool(Device, &PoolInfo, nullptr, &Pool) != VK_SUCCESS) { Error = "descriptor pool failed"; return false; }

    VkCommandPoolCreateInfo CP{ VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO };
    CP.queueFamilyIndex = QueueFamily;
    CP.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    if (vkCreateCommandPool(Device, &CP, nullptr, &Commands) != VK_SUCCESS) { Error = "command pool failed"; return false; }

    VkFenceCreateInfo FC{ VK_STRUCTURE_TYPE_FENCE_CREATE_INFO };
    if (vkCreateFence(Device, &FC, nullptr, &Fence) != VK_SUCCESS) { Error = "fence failed"; return false; }
    return true;
}

void Kernels::Destroy()
{
    if (!Device) return;
    vkDeviceWaitIdle(Device);
    if (Fence) vkDestroyFence(Device, Fence, nullptr);
    if (Commands) vkDestroyCommandPool(Device, Commands, nullptr);
    if (Pool) vkDestroyDescriptorPool(Device, Pool, nullptr);
    if (BakePipeline) vkDestroyPipeline(Device, BakePipeline, nullptr);
    if (CompositePipeline) vkDestroyPipeline(Device, CompositePipeline, nullptr);
    if (BakePipelineLayout) vkDestroyPipelineLayout(Device, BakePipelineLayout, nullptr);
    if (CompositePipelineLayout) vkDestroyPipelineLayout(Device, CompositePipelineLayout, nullptr);
    if (BakeLayout) vkDestroyDescriptorSetLayout(Device, BakeLayout, nullptr);
    if (CompositeLayout) vkDestroyDescriptorSetLayout(Device, CompositeLayout, nullptr);
    if (BakeModule) vkDestroyShaderModule(Device, BakeModule, nullptr);
    if (CompositeModule) vkDestroyShaderModule(Device, CompositeModule, nullptr);
    *this = Kernels{};
}

bool Kernels::Bake(const std::vector<float>& TriangleFloats, const float Min[3], const float Max[3], uint32_t Resolution,
                   std::vector<float>& Out, double& Seconds, std::string& Error)
{
    if (!Device || Resolution < 2u) { Error = "bake: not created or bad resolution"; return false; }
    const uint32_t TriangleCount = uint32_t(TriangleFloats.size() / 9u);
    const uint32_t Total = Resolution * Resolution * Resolution;

    BakeParamsHost Params{};
    std::memcpy(Params.Min, Min, 12);
    std::memcpy(Params.Max, Max, 12);
    Params.Resolution = Resolution;
    Params.TriangleCount = TriangleCount;

    Buffer ParamBuf, TriBuf, OutBuf;
    bool Ok = MakeBuffer(Device, Memory, sizeof(Params), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, ParamBuf, Error) &&
              MakeBuffer(Device, Memory, TriangleFloats.size() * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, TriBuf, Error) &&
              MakeBuffer(Device, Memory, size_t(Total) * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, OutBuf, Error);
    if (Ok)
    {
        Upload(Device, ParamBuf, &Params, sizeof(Params));
        if (!TriangleFloats.empty()) Upload(Device, TriBuf, TriangleFloats.data(), TriangleFloats.size() * sizeof(float));
        VkDescriptorSet Set = AllocSet(Device, Pool, BakeLayout);
        Write(Device, Set, 0u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, ParamBuf);
        Write(Device, Set, 1u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, TriBuf);
        Write(Device, Set, 2u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, OutBuf);
        Ok = RunOnce(Device, Queue, Commands, Fence, BakePipeline, BakePipelineLayout, Set, (Total + 63u) / 64u, 1u, 1u, Seconds, Error);
        if (Ok)
        {
            Out.assign(Total, 0.0f);
            Download(Device, OutBuf, Out.data(), size_t(Total) * sizeof(float));
        }
        vkFreeDescriptorSets(Device, Pool, 1u, &Set);
    }
    DestroyBuffer(Device, ParamBuf);
    DestroyBuffer(Device, TriBuf);
    DestroyBuffer(Device, OutBuf);
    return Ok;
}

bool Kernels::Composite(const CompositeParamsHost& Params, const std::vector<InstanceGpuHost>& Instances, const std::vector<float>& FieldData,
                        std::vector<float>& ClipVolume, double& Seconds, std::string& Error)
{
    if (!Device) { Error = "composite: not created"; return false; }
    const uint64_t Total = uint64_t(Params.Dim) * Params.Dim * Params.Dim;
    if (ClipVolume.size() != Total) { Error = "composite: clip volume size does not match Dim^3"; return false; }

    Buffer ParamBuf, InstBuf, FieldBuf, ClipBuf;
    bool Ok = MakeBuffer(Device, Memory, sizeof(Params), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, ParamBuf, Error) &&
              MakeBuffer(Device, Memory, Instances.size() * sizeof(InstanceGpuHost), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, InstBuf, Error) &&
              MakeBuffer(Device, Memory, FieldData.size() * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, FieldBuf, Error) &&
              MakeBuffer(Device, Memory, Total * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, ClipBuf, Error);
    if (Ok)
    {
        Upload(Device, ParamBuf, &Params, sizeof(Params));
        if (!Instances.empty()) Upload(Device, InstBuf, Instances.data(), Instances.size() * sizeof(InstanceGpuHost));
        if (!FieldData.empty()) Upload(Device, FieldBuf, FieldData.data(), FieldData.size() * sizeof(float));
        Upload(Device, ClipBuf, ClipVolume.data(), size_t(Total) * sizeof(float));   // keeps cells outside the dirty box as they were
        VkDescriptorSet Set = AllocSet(Device, Pool, CompositeLayout);
        Write(Device, Set, 3u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, ParamBuf);
        Write(Device, Set, 4u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, InstBuf);
        Write(Device, Set, 5u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, FieldBuf);
        Write(Device, Set, 6u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, ClipBuf);
        // CompositeMain uses [numthreads(4,4,4)]. Dispatch covers the dirty box only.
        const uint32_t Ext[3] = { Params.DirtyHi[0] - Params.DirtyLo[0] + 1u, Params.DirtyHi[1] - Params.DirtyLo[1] + 1u,
                                  Params.DirtyHi[2] - Params.DirtyLo[2] + 1u };
        Ok = RunOnce(Device, Queue, Commands, Fence, CompositePipeline, CompositePipelineLayout, Set, (Ext[0] + 3u) / 4u, (Ext[1] + 3u) / 4u,
                     (Ext[2] + 3u) / 4u, Seconds, Error);
        if (Ok) Download(Device, ClipBuf, ClipVolume.data(), size_t(Total) * sizeof(float));
        vkFreeDescriptorSets(Device, Pool, 1u, &Set);
    }
    DestroyBuffer(Device, ParamBuf);
    DestroyBuffer(Device, InstBuf);
    DestroyBuffer(Device, FieldBuf);
    DestroyBuffer(Device, ClipBuf);
    return Ok;
}
} // namespace MeshSdfVulkan
