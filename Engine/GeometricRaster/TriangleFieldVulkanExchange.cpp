//============================================================================================================================================
//                                                      TRIANGLEFIELDVULKANEXCHANGE.CPP
//============================================================================================================================================
// 📦 Vulkan host for the mesh SDF kernels. See TriangleFieldVulkanExchange.h. Compile-checked only in the build sandbox; device-unverified.

#include "TriangleFieldVulkanExchange.h"

#include "Generated/TriangleFieldSpirv.inc"

#include <algorithm>
#include <chrono>
#include <cstring>

namespace TriangleFieldVulkanExchange
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

bool FindMemoryIndex(const VkPhysicalDeviceMemoryProperties& TypeTable, uint32_t TypeBits, VkMemoryPropertyFlags Wanted, uint32_t& Type)
{
    for (uint32_t I = 0u; I < TypeTable.memoryTypeCount; ++I)
        if ((TypeBits & (1u << I)) && (TypeTable.memoryTypes[I].propertyFlags & Wanted) == Wanted) { Type = I; return true; }
    return false;
}

// Host-visible, host-coherent buffer. First version: simple and correct. A device-local path comes later.
struct DeviceRange
{
    VkBuffer Native = VK_NULL_HANDLE;
    VkDeviceMemory Backing = VK_NULL_HANDLE;
    VkDeviceSize Bytes = 0u;
};

bool AllocateRange(VkDevice Device, const VkPhysicalDeviceMemoryProperties& TypeTable, VkDeviceSize Bytes, VkBufferUsageFlags Usage,
                DeviceRange& Out, std::string& Error)
{
    VkBufferCreateInfo Request{ VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO };
    Request.size = std::max<VkDeviceSize>(Bytes, 16u);
    Request.usage = Usage;
    Request.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (vkCreateBuffer(Device, &Request, nullptr, &Out.Native) != VK_SUCCESS) { Error = "vkCreateBuffer failed"; return false; }
    VkMemoryRequirements Req{};
    vkGetBufferMemoryRequirements(Device, Out.Native, &Req);
    uint32_t Type = 0u;
    if (!FindMemoryIndex(TypeTable, Req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, Type))
    {
        Error = "no host-visible coherent memory type";
        return false;
    }
    VkMemoryAllocateInfo Alloc{ VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO };
    Alloc.allocationSize = Req.size;
    Alloc.memoryTypeIndex = Type;
    if (vkAllocateMemory(Device, &Alloc, nullptr, &Out.Backing) != VK_SUCCESS) { Error = "vkAllocateMemory failed"; return false; }
    vkBindBufferMemory(Device, Out.Native, Out.Backing, 0u);
    Out.Bytes = Request.size;
    return true;
}

void ReleaseRange(VkDevice Device, DeviceRange& B)
{
    if (B.Native) vkDestroyBuffer(Device, B.Native, nullptr);
    if (B.Backing) vkFreeMemory(Device, B.Backing, nullptr);
    B = DeviceRange{};
}

void Upload(VkDevice Device, const DeviceRange& B, const void* Payload, size_t Bytes)
{
    void* Mapped = nullptr;
    vkMapMemory(Device, B.Backing, 0u, VK_WHOLE_SIZE, 0u, &Mapped);
    std::memcpy(Mapped, Payload, Bytes);
    vkUnmapMemory(Device, B.Backing);
}

void Download(VkDevice Device, const DeviceRange& B, void* Payload, size_t Bytes)
{
    void* Mapped = nullptr;
    vkMapMemory(Device, B.Backing, 0u, VK_WHOLE_SIZE, 0u, &Mapped);
    std::memcpy(Payload, Mapped, Bytes);
    vkUnmapMemory(Device, B.Backing);
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
    VkDescriptorSetLayoutCreateInfo Request{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO };
    Request.bindingCount = uint32_t(List.size());
    Request.pBindings = List.data();
    VkDescriptorSetLayout Layout = VK_NULL_HANDLE;
    vkCreateDescriptorSetLayout(Device, &Request, nullptr, &Layout);
    return Layout;
}

VkPipeline MakePipeline(VkDevice Device, VkShaderModule Module, const char* Entry, VkPipelineLayout Layout)
{
    VkComputePipelineCreateInfo Request{ VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO };
    Request.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    Request.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    Request.stage.module = Module;
    Request.stage.pName = Entry;
    Request.layout = Layout;
    VkPipeline Kernel = VK_NULL_HANDLE;
    vkCreateComputePipelines(Device, VK_NULL_HANDLE, 1u, &Request, nullptr, &Kernel);
    return Kernel;
}

// Records one submission with the given bindings, runs it, waits for completion. Returns wall-clock seconds from submit to fence.
bool RunOnce(VkDevice Device, VkQueue Queue, VkCommandPool Commands, VkFence Fence, VkPipeline Kernel, VkPipelineLayout Layout,
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
    vkCmdBindPipeline(Cmd, VK_PIPELINE_BIND_POINT_COMPUTE, Kernel);
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

VkDescriptorSet AllocSet(VkDevice Device, VkDescriptorPool DescriptorSlots, VkDescriptorSetLayout Layout)
{
    VkDescriptorSetAllocateInfo Alloc{ VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO };
    Alloc.descriptorPool = DescriptorSlots;
    Alloc.descriptorSetCount = 1u;
    Alloc.pSetLayouts = &Layout;
    VkDescriptorSet Set = VK_NULL_HANDLE;
    vkAllocateDescriptorSets(Device, &Alloc, &Set);
    return Set;
}

void Write(VkDevice Device, VkDescriptorSet Set, uint32_t Binding, VkDescriptorType Type, const DeviceRange& B)
{
    VkDescriptorBufferInfo Request{ B.Native, 0u, VK_WHOLE_SIZE };
    VkWriteDescriptorSet Write{ VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET };
    Write.dstSet = Set;
    Write.dstBinding = Binding;
    Write.descriptorCount = 1u;
    Write.descriptorType = Type;
    Write.pBufferInfo = &Request;
    vkUpdateDescriptorSets(Device, 1u, &Write, 0u, nullptr);
}
} // namespace

bool CreateContext(Context& Out, std::string& Log, std::string& Error)
{
    VkApplicationInfo App{ VK_STRUCTURE_TYPE_APPLICATION_INFO };
    App.pApplicationName = "TriangleFieldDeviceCheck";
    App.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo Request{ VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO };
    Request.pApplicationInfo = &App;
    if (vkCreateInstance(&Request, nullptr, &Out.Instance) != VK_SUCCESS) { Error = "vkCreateInstance failed (is a Vulkan driver installed?)"; return false; }

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
        Log += "[TriangleField] device " + std::to_string(I) + ": " + P.deviceName + " (" + VendorName(P.vendorID) + ", " + TypeName(P.deviceType) +
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
    VkDeviceCreateInfo DeviceReport{ VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO };
    DeviceReport.queueCreateInfoCount = 1u;
    DeviceReport.pQueueCreateInfos = &Queue;
    if (vkCreateDevice(Out.Physical, &DeviceReport, nullptr, &Out.Device) != VK_SUCCESS) { Error = "vkCreateDevice failed"; return false; }
    vkGetDeviceQueue(Out.Device, Out.QueueFamily, 0u, &Out.Queue);
    Log += "[TriangleField] using: " + std::string(Out.Properties.deviceName) + "\n";
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
    vkGetPhysicalDeviceMemoryProperties(Ctx.Physical, &TypeTable);

    VkShaderModuleCreateInfo Request{ VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO };
    Request.codeSize = sizeof(TriangleFieldSpirv::ProjectGridMain);
    Request.pCode = TriangleFieldSpirv::ProjectGridMain;
    if (vkCreateShaderModule(Device, &Request, nullptr, &ProjectModule) != VK_SUCCESS) { Error = "bake shader module rejected"; return false; }
    Request.codeSize = sizeof(TriangleFieldSpirv::ClipMinimumMain);
    Request.pCode = TriangleFieldSpirv::ClipMinimumMain;
    if (vkCreateShaderModule(Device, &Request, nullptr, &ClipMinimumModule) != VK_SUCCESS) { Error = "composite shader module rejected"; return false; }

    // ProjectGridMain uses bindings 0 (params), 1 (triangles), 2 (output). ClipMinimumMain uses 3 (params), 4 (instances), 5 (fields), 6 (clip).
    ProjectLayout = MakeSetLayout(Device, { { 0u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER }, { 1u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER },
                                         { 2u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER } });
    ClipMinimumLayout = MakeSetLayout(Device, { { 3u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER }, { 4u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER },
                                              { 5u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER }, { 6u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER } });
    if (!ProjectLayout || !ClipMinimumLayout) { Error = "descriptor set layout failed"; return false; }

    VkPipelineLayoutCreateInfo PL{ VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO };
    PL.setLayoutCount = 1u;
    PL.pSetLayouts = &ProjectLayout;
    if (vkCreatePipelineLayout(Device, &PL, nullptr, &ProjectPipelineLayout) != VK_SUCCESS) { Error = "bake pipeline layout failed"; return false; }
    PL.pSetLayouts = &ClipMinimumLayout;
    if (vkCreatePipelineLayout(Device, &PL, nullptr, &ClipMinimumPipelineLayout) != VK_SUCCESS) { Error = "composite pipeline layout failed"; return false; }

    ProjectPipeline = MakePipeline(Device, ProjectModule, "ProjectGridMain", ProjectPipelineLayout);
    ClipMinimumPipeline = MakePipeline(Device, ClipMinimumModule, "ClipMinimumMain", ClipMinimumPipelineLayout);
    if (!ProjectPipeline || !ClipMinimumPipeline) { Error = "compute pipeline creation failed"; return false; }

    VkDescriptorPoolSize Sizes[2] = { { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 4u }, { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 12u } };
    VkDescriptorPoolCreateInfo SlotBudget{ VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO };
    SlotBudget.maxSets = 4u;
    SlotBudget.poolSizeCount = 2u;
    SlotBudget.pPoolSizes = Sizes;
    if (vkCreateDescriptorPool(Device, &SlotBudget, nullptr, &DescriptorSlots) != VK_SUCCESS) { Error = "descriptor pool failed"; return false; }

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
    if (DescriptorSlots) vkDestroyDescriptorPool(Device, DescriptorSlots, nullptr);
    if (ProjectPipeline) vkDestroyPipeline(Device, ProjectPipeline, nullptr);
    if (ClipMinimumPipeline) vkDestroyPipeline(Device, ClipMinimumPipeline, nullptr);
    if (ProjectPipelineLayout) vkDestroyPipelineLayout(Device, ProjectPipelineLayout, nullptr);
    if (ClipMinimumPipelineLayout) vkDestroyPipelineLayout(Device, ClipMinimumPipelineLayout, nullptr);
    if (ProjectLayout) vkDestroyDescriptorSetLayout(Device, ProjectLayout, nullptr);
    if (ClipMinimumLayout) vkDestroyDescriptorSetLayout(Device, ClipMinimumLayout, nullptr);
    if (ProjectModule) vkDestroyShaderModule(Device, ProjectModule, nullptr);
    if (ClipMinimumModule) vkDestroyShaderModule(Device, ClipMinimumModule, nullptr);
    *this = Kernels{};
}

bool Kernels::Project(const std::vector<float>& TriangleFloats, const float Min[3], const float Max[3], uint32_t Resolution,
                   std::vector<float>& Out, double& Seconds, std::string& Error)
{
    if (!Device || Resolution < 2u) { Error = "bake: not created or bad resolution"; return false; }
    const uint32_t TriangleCount = uint32_t(TriangleFloats.size() / 9u);
    const uint32_t Total = Resolution * Resolution * Resolution;

    GridProjectionParamsHost Params{};
    std::memcpy(Params.Min, Min, 12);
    std::memcpy(Params.Max, Max, 12);
    Params.Resolution = Resolution;
    Params.TriangleCount = TriangleCount;

    DeviceRange ParamBuf, TriBuf, OutBuf;
    bool Ok = AllocateRange(Device, TypeTable, sizeof(Params), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, ParamBuf, Error) &&
              AllocateRange(Device, TypeTable, TriangleFloats.size() * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, TriBuf, Error) &&
              AllocateRange(Device, TypeTable, size_t(Total) * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, OutBuf, Error);
    if (Ok)
    {
        Upload(Device, ParamBuf, &Params, sizeof(Params));
        if (!TriangleFloats.empty()) Upload(Device, TriBuf, TriangleFloats.data(), TriangleFloats.size() * sizeof(float));
        VkDescriptorSet Set = AllocSet(Device, DescriptorSlots, ProjectLayout);
        Write(Device, Set, 0u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, ParamBuf);
        Write(Device, Set, 1u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, TriBuf);
        Write(Device, Set, 2u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, OutBuf);
        Ok = RunOnce(Device, Queue, Commands, Fence, ProjectPipeline, ProjectPipelineLayout, Set, (Total + 63u) / 64u, 1u, 1u, Seconds, Error);
        if (Ok)
        {
            Out.assign(Total, 0.0f);
            Download(Device, OutBuf, Out.data(), size_t(Total) * sizeof(float));
        }
        vkFreeDescriptorSets(Device, DescriptorSlots, 1u, &Set);
    }
    ReleaseRange(Device, ParamBuf);
    ReleaseRange(Device, TriBuf);
    ReleaseRange(Device, OutBuf);
    return Ok;
}

bool Kernels::ClipMinimum(const ClipMinimumParamsHost& Params, const std::vector<InstanceGpuHost>& Instances, const std::vector<float>& FieldSamples,
                        std::vector<float>& ClipVolume, double& Seconds, std::string& Error)
{
    if (!Device) { Error = "composite: not created"; return false; }
    const uint64_t Total = uint64_t(Params.Dim) * Params.Dim * Params.Dim;
    if (ClipVolume.size() != Total) { Error = "composite: clip volume size does not match Dim^3"; return false; }

    DeviceRange ParamBuf, InstBuf, FieldBuf, ClipBuf;
    bool Ok = AllocateRange(Device, TypeTable, sizeof(Params), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, ParamBuf, Error) &&
              AllocateRange(Device, TypeTable, Instances.size() * sizeof(InstanceGpuHost), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, InstBuf, Error) &&
              AllocateRange(Device, TypeTable, FieldSamples.size() * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, FieldBuf, Error) &&
              AllocateRange(Device, TypeTable, Total * sizeof(float), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, ClipBuf, Error);
    if (Ok)
    {
        Upload(Device, ParamBuf, &Params, sizeof(Params));
        if (!Instances.empty()) Upload(Device, InstBuf, Instances.data(), Instances.size() * sizeof(InstanceGpuHost));
        if (!FieldSamples.empty()) Upload(Device, FieldBuf, FieldSamples.data(), FieldSamples.size() * sizeof(float));
        Upload(Device, ClipBuf, ClipVolume.data(), size_t(Total) * sizeof(float));   // keeps cells outside the dirty box as they were
        VkDescriptorSet Set = AllocSet(Device, DescriptorSlots, ClipMinimumLayout);
        Write(Device, Set, 3u, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, ParamBuf);
        Write(Device, Set, 4u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, InstBuf);
        Write(Device, Set, 5u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, FieldBuf);
        Write(Device, Set, 6u, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, ClipBuf);
        // ClipMinimumMain uses [numthreads(4,4,4)]. Dispatch covers the dirty box only.
        const uint32_t Ext[3] = { Params.DirtyHi[0] - Params.DirtyLo[0] + 1u, Params.DirtyHi[1] - Params.DirtyLo[1] + 1u,
                                  Params.DirtyHi[2] - Params.DirtyLo[2] + 1u };
        Ok = RunOnce(Device, Queue, Commands, Fence, ClipMinimumPipeline, ClipMinimumPipelineLayout, Set, (Ext[0] + 3u) / 4u, (Ext[1] + 3u) / 4u,
                     (Ext[2] + 3u) / 4u, Seconds, Error);
        if (Ok) Download(Device, ClipBuf, ClipVolume.data(), size_t(Total) * sizeof(float));
        vkFreeDescriptorSets(Device, DescriptorSlots, 1u, &Set);
    }
    ReleaseRange(Device, ParamBuf);
    ReleaseRange(Device, InstBuf);
    ReleaseRange(Device, FieldBuf);
    ReleaseRange(Device, ClipBuf);
    return Ok;
}
} // namespace TriangleFieldVulkanExchange
