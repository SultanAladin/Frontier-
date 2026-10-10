//============================================================================================================================================
//                                                       MESHSDFVULKAN.H
//============================================================================================================================================
// 📦 Vulkan host for the mesh SDF compute kernels (MeshSdf.slang, SPIR-V embedded in Generated/MeshSdfSpirv.inc).
//    Import-time bake (BakeMain) and dirty-cell composite (CompositeMain). Compute only: no ray tracing extensions, so the same
//    code runs on any Vulkan 1.0 device with a compute queue (NVIDIA GTX or RTX, AMD RX). RT cores are not used.
//
//    Not executed in the build sandbox (no Vulkan driver there). Compile-checked against the Vulkan headers only.
//    Run the device check, Tools/Bake/MeshSdfDeviceCheck.cpp, on the target GPU to validate it.
//
//    Buffers are host-visible and host-coherent, which keeps the first version simple and correct. A device-local path with a
//    staging copy is the obvious next optimisation once the device check is green.

#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>
#include <string>
#include <vector>

namespace MeshSdfVulkan
{
// Host mirrors of the shader records. Offsets are checked against the SPIR-V by Tools/Build/BuildMeshSdfSpirv.py.
struct BakeParamsHost
{
    float    Min[3];          // 0
    float    Pad0;            // 12
    float    Max[3];          // 16
    uint32_t Resolution;      // 28
    uint32_t TriangleCount;   // 32
    uint32_t Pad1;            // 36
    uint32_t Pad2[2];         // 40
};
static_assert(sizeof(BakeParamsHost) == 48u, "BakeParams is a 48-byte std140 block");

struct CompositeParamsHost
{
    float    Origin[3];       // 0
    float    Cell;            // 12
    uint32_t Dim;             // 16
    uint32_t Pad0[3];         // 20
    uint32_t DirtyLo[3];      // 32
    uint32_t Pad1;            // 44
    uint32_t DirtyHi[3];      // 48
    uint32_t InstanceCount;   // 60
    uint32_t Pad2[4];         // 64
};
static_assert(sizeof(CompositeParamsHost) == 80u, "CompositeParams is an 80-byte std140 block");

struct InstanceGpuHost
{
    float    InverseRow0[4];  // 0
    float    InverseRow1[4];  // 16
    float    InverseRow2[4];  // 32
    float    FieldMin[4];     // 48   w = minimum stretch
    float    FieldMax[4];     // 64   w = resolution
    uint32_t FieldOffset;     // 80
    uint32_t Pad0[3];         // 84
    uint32_t Pad1[4];         // 96
};
static_assert(sizeof(InstanceGpuHost) == 112u, "InstanceGpu is a 112-byte std430 element");

// Device context. Owns the instance and device it creates.
struct Context
{
    VkInstance       Instance = VK_NULL_HANDLE;
    VkPhysicalDevice Physical = VK_NULL_HANDLE;
    VkDevice         Device   = VK_NULL_HANDLE;
    VkQueue          Queue    = VK_NULL_HANDLE;
    uint32_t         QueueFamily = 0u;
    VkPhysicalDeviceProperties Properties{};
};

// Picks a device with a compute queue. Prefers a discrete GPU. Logs every device it sees (vendor, name, type). Returns false on error.
bool CreateContext(Context& Out, std::string& Log, std::string& Error);
void DestroyContext(Context& Ctx);

class Kernels
{
  public:
    bool Create(const Context& Ctx, std::string& Error);
    void Destroy();

    // Import-time bake. TriangleFloats holds 9 floats per triangle. Writes Resolution^3 distances, X fastest.
    bool Bake(const std::vector<float>& TriangleFloats, const float Min[3], const float Max[3], uint32_t Resolution,
              std::vector<float>& Out, double& Seconds, std::string& Error);

    // Dirty-cell composite over one clip level. Only cells inside [Lo, Hi] are written. Other cells of ClipVolume are untouched.
    bool Composite(const CompositeParamsHost& Params, const std::vector<InstanceGpuHost>& Instances, const std::vector<float>& FieldData,
                   std::vector<float>& ClipVolume, double& Seconds, std::string& Error);

  private:
    VkDevice Device = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties Memory{};
    VkQueue Queue = VK_NULL_HANDLE;
    uint32_t QueueFamily = 0u;
    VkShaderModule BakeModule = VK_NULL_HANDLE, CompositeModule = VK_NULL_HANDLE;
    VkDescriptorSetLayout BakeLayout = VK_NULL_HANDLE, CompositeLayout = VK_NULL_HANDLE;
    VkPipelineLayout BakePipelineLayout = VK_NULL_HANDLE, CompositePipelineLayout = VK_NULL_HANDLE;
    VkPipeline BakePipeline = VK_NULL_HANDLE, CompositePipeline = VK_NULL_HANDLE;
    VkDescriptorPool Pool = VK_NULL_HANDLE;
    VkCommandPool Commands = VK_NULL_HANDLE;
    VkFence Fence = VK_NULL_HANDLE;
};
} // namespace MeshSdfVulkan
