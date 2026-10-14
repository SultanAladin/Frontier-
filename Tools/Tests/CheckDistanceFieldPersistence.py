#!/usr/bin/env python3
"""CPU production-code and Vulkan failure-injection checks. This never opens a window or dispatches GPU work."""
from pathlib import Path
import argparse
import os
import subprocess
import sys
import tempfile
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
Arguments = Parser.parse_args()
Scratch = Root / "_AgentScratch" / "build" / "DistanceFieldPersistence"
Scratch.mkdir(parents=True, exist_ok=True)
Windows = sys.platform == "win32"
Includes = [Root / "Engine", RestoreVulkanHeaders()]
Flags = (["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O1", "/UNDEBUG", "/DNOMINMAX", "/MD"] if Windows else
         ["-std=c++20", "-O1", "-g", "-UNDEBUG", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"])
Flags += [("/I" if Windows else "-I") + str(Folder) for Folder in Includes]


def CompileAndRun(Name, Sources, Parameters=()):
    Executable = Scratch / (Name + (".exe" if Windows else ""))
    Destination = [f"/Fe{Executable}"] if Windows else ["-o", str(Executable)]
    subprocess.run([Arguments.compiler, *Flags, *map(str, Sources), *Destination], cwd=Scratch, check=True)
    subprocess.run([str(Executable), *map(str, Parameters)], cwd=Scratch, check=True)


def SliceFunction(Content, Declaration):
    First = Content.index(Declaration)
    Opening = Content.index("{", First)
    Depth = 1
    Closing = Opening + 1
    while Depth:
        if Content[Closing] == "{":
            Depth += 1
        elif Content[Closing] == "}":
            Depth -= 1
        Closing += 1
    return Content[First:Closing]


with tempfile.TemporaryDirectory(prefix="local-fields-", dir=Scratch) as Directory:
    CompileAndRun("PersistenceChecks", [Root / "Exhibits/Workbench/Traversal/DistanceFieldPersistenceChecks.cpp",
                                        Root / "Engine/GeometricRaster/DistanceFieldStructure.cpp",
                                        Root / "Engine/GeometricRaster/SceneStructure.cpp",
                                        Root / "Engine/GeometricRaster/GeometryStructure.cpp",
                                        Root / "Engine/ContentInterchange/MaterialIndex.cpp",
                                        Root / "Engine/DeviceExchange/OrientationClassifier.cpp"],
                  [Path(Directory) / "artifacts"])

# Compile the actual allocator, fail-once publisher and upload submission routine against narrowly defined
# Vulkan stubs. Extraction avoids a second implementation of the mechanism; it does not simulate a driver.
Source = (Root / "Engine/DeviceExchange/SwapchainExchange.cpp").read_text(encoding="utf-8")
Mock = r'''
#include <vulkan/vulkan.h>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <vector>

static VkResult Creation = VK_SUCCESS, Binding = VK_SUCCESS, Ending = VK_SUCCESS;
static VkResult FenceCreation = VK_SUCCESS, Submission = VK_SUCCESS, Waiting = VK_SUCCESS;
static bool RefuseLocal = false;
static uint32_t BufferReclaims = 0, MemoryReclaims = 0, Waits = 0, Submissions = 0;
static std::vector<uint32_t> MemoryChoices;

extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkCreateBuffer(VkDevice, const VkBufferCreateInfo* Description,
                                                         const VkAllocationCallbacks*, VkBuffer* Buffer)
{
    assert(Description->usage & VK_BUFFER_USAGE_TRANSFER_DST_BIT);
    if (Creation == VK_SUCCESS) *Buffer = reinterpret_cast<VkBuffer>(uintptr_t(1));
    return Creation;
}
extern "C" VKAPI_ATTR void VKAPI_CALL vkGetBufferMemoryRequirements(VkDevice, VkBuffer, VkMemoryRequirements* Requirements)
{
    Requirements->size = 4096; Requirements->alignment = 256; Requirements->memoryTypeBits = 3;
}
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkAllocateMemory(VkDevice, const VkMemoryAllocateInfo* Description,
                                                           const VkAllocationCallbacks*, VkDeviceMemory* Memory)
{
    MemoryChoices.push_back(Description->memoryTypeIndex);
    if (RefuseLocal && Description->memoryTypeIndex == 1) return VK_ERROR_OUT_OF_DEVICE_MEMORY;
    *Memory = reinterpret_cast<VkDeviceMemory>(uintptr_t(1));
    return VK_SUCCESS;
}
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkBindBufferMemory(VkDevice, VkBuffer, VkDeviceMemory, VkDeviceSize) { return Binding; }
extern "C" VKAPI_ATTR void VKAPI_CALL vkDestroyBuffer(VkDevice, VkBuffer, const VkAllocationCallbacks*) { ++BufferReclaims; }
extern "C" VKAPI_ATTR void VKAPI_CALL vkFreeMemory(VkDevice, VkDeviceMemory, const VkAllocationCallbacks*) { ++MemoryReclaims; }
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkEndCommandBuffer(VkCommandBuffer) { return Ending; }
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkCreateFence(VkDevice, const VkFenceCreateInfo*, const VkAllocationCallbacks*, VkFence* Fence)
{
    if (FenceCreation == VK_SUCCESS) *Fence = reinterpret_cast<VkFence>(uintptr_t(1));
    return FenceCreation;
}
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkQueueSubmit(VkQueue, uint32_t, const VkSubmitInfo*, VkFence) { ++Submissions; return Submission; }
extern "C" VKAPI_ATTR VkResult VKAPI_CALL vkWaitForFences(VkDevice, uint32_t, const VkFence*, VkBool32, uint64_t) { ++Waits; return Waiting; }
extern "C" VKAPI_ATTR void VKAPI_CALL vkDestroyFence(VkDevice, VkFence, const VkAllocationCallbacks*) {}
extern "C" VKAPI_ATTR void VKAPI_CALL vkFreeCommandBuffers(VkDevice, VkCommandPool, uint32_t, const VkCommandBuffer*) {}

namespace Frontier
{
class SwapchainExchange
{
public:
    struct VulkanRecord { VkDevice Device = nullptr; VkQueue GraphicsQueue = nullptr; VkCommandPool ComputeCommandPool = nullptr; };
    VulkanRecord Record;
    VulkanRecord* Vulkan = &Record;
    bool FrameFailed = false;
    const char* FrameFailureOperation = "";
    int32_t FrameFailureCode = 0;
    void RefuseFrame(const char* Operation, int32_t Code) noexcept;
    bool SubmitUpload(VkCommandBuffer Command) noexcept;
};
ALLOCATOR
FAILURE
UPLOAD
}

int main()
{
    VkPhysicalDeviceMemoryProperties Properties{};
    Properties.memoryTypeCount = 2;
    Properties.memoryTypes[0].propertyFlags = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
    Properties.memoryTypes[1].propertyFlags = Properties.memoryTypes[0].propertyFlags | VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT;
    VkBuffer Buffer = VK_NULL_HANDLE;
    VkDeviceMemory Memory = VK_NULL_HANDLE;
    auto Allocate = [&](uint32_t Required = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)
    { return Frontier::AllocateBuffer(nullptr, Properties, 1024, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, Required, Buffer, Memory); };
    assert(Allocate() == VK_SUCCESS && MemoryChoices == std::vector<uint32_t>{1});
    MemoryChoices.clear(); RefuseLocal = true;
    assert(Allocate() == VK_SUCCESS && MemoryChoices == (std::vector<uint32_t>{1, 0}));
    MemoryChoices.clear();
    assert(Allocate(VK_MEMORY_PROPERTY_HOST_CACHED_BIT) == VK_ERROR_FEATURE_NOT_PRESENT && MemoryChoices.empty());
    assert(!Buffer && !Memory);
    RefuseLocal = false; Binding = VK_ERROR_DEVICE_LOST;
    const uint32_t Reclaims = MemoryReclaims;
    assert(Allocate() == VK_ERROR_DEVICE_LOST && !Buffer && !Memory && MemoryReclaims == Reclaims + 1);
    Binding = VK_SUCCESS; Creation = VK_ERROR_OUT_OF_DEVICE_MEMORY;
    assert(Allocate() == Creation && !Buffer && !Memory);
    Creation = VK_SUCCESS;
    std::cout << "PASS actual allocator: local preference, OOM fallback, no-match refusal, bind/create failure cleanup\n";

    Frontier::SwapchainExchange Surface;
    std::ostringstream Diagnostics;
    auto* Previous = std::cerr.rdbuf(Diagnostics.rdbuf());
    Surface.RefuseFrame("first operation", VK_ERROR_DEVICE_LOST);
    Surface.RefuseFrame("second operation", VK_ERROR_INITIALIZATION_FAILED);
    std::cerr.rdbuf(Previous);
    assert(Surface.FrameFailed && Surface.FrameFailureCode == VK_ERROR_DEVICE_LOST);
    assert(std::string(Surface.FrameFailureOperation) == "first operation");
    assert(Diagnostics.str().find("second operation") == std::string::npos);
    std::cout << "PASS actual frame-failure publisher: first cause retained, one diagnostic only\n";

    auto Clear = [&]
    {
        Surface.FrameFailed = false; Surface.FrameFailureCode = 0; Waits = Submissions = 0;
        Ending = FenceCreation = Submission = Waiting = VK_SUCCESS;
    };
    VkCommandBuffer Command = reinterpret_cast<VkCommandBuffer>(uintptr_t(1));
    Clear(); Ending = VK_ERROR_DEVICE_LOST;
    assert(!Surface.SubmitUpload(Command) && Surface.FrameFailed && Submissions == 0 && Waits == 0);
    Clear(); FenceCreation = VK_ERROR_OUT_OF_HOST_MEMORY;
    assert(!Surface.SubmitUpload(Command) && Surface.FrameFailed && Submissions == 0 && Waits == 0);
    Clear(); Submission = VK_ERROR_DEVICE_LOST;
    assert(!Surface.SubmitUpload(Command) && Surface.FrameFailed && Submissions == 1 && Waits == 0);
    Clear(); Waiting = VK_ERROR_DEVICE_LOST;
    assert(!Surface.SubmitUpload(Command) && Surface.FrameFailed && Submissions == 1 && Waits == 1);
    Clear();
    assert(Surface.SubmitUpload(Command) && !Surface.FrameFailed && Submissions == 1 && Waits == 1);
    std::cout << "PASS actual upload submission: no submit after recording/fence failure; no unsignalled wait after submit failure\n";
    std::cout << "Failure injection only, not Vulkan driver execution or AMD reproduction.\n";
}
'''
Mock = Mock.replace("ALLOCATOR", SliceFunction(Source, "static VkResult AllocateBuffer("))
Mock = Mock.replace("FAILURE", SliceFunction(Source, "void SwapchainExchange::RefuseFrame("))
Mock = Mock.replace("UPLOAD", SliceFunction(Source, "bool SwapchainExchange::SubmitUpload("))
MockPath = Scratch / "VulkanRefusalChecks.cpp"
MockPath.write_text(Mock, encoding="utf-8")
CompileAndRun("VulkanRefusalChecks", [MockPath])

# Complement the executable checks with source wiring guards; these are not claimed as GPU validation.
Record = SliceFunction(Source, "bool SwapchainExchange::RecordComputeCommands(")
Present = SliceFunction(Source, "void SwapchainExchange::RecordAndPresent(")
assert "vkResetCommandBuffer" in Record and "vkBeginCommandBuffer" in Record and "vkEndCommandBuffer" in Record
assert "if (!RecordComputeCommands(ImageOrdinal, Dispatch)) return;" in Present
assert "ComputeDescriptorSets[ActiveSlot]" in Present
assert Present.index("vkWaitForFences") < Present.index("ComputeDescriptorSets[ActiveSlot]")
assert "TraceRequested" in Record and "!TraceRequested" in Record and "NonRaytracedGIRequested" in Record
assert "PublishUniform(Vulkan->SkyBuffer" in Record and "PublishUniform(Vulkan->MoonBuffer" in Record
Stage = (Root / "Engine/DeviceExchange/DistanceFieldGIStage.cpp").read_text(encoding="utf-8")
assert "SelectsDistanceField(Frame.FeatureFlags)" in Stage
assert "DistanceFieldConstruct" not in Stage and "ClipOrigins" not in Stage and "std::floor(Frame.CameraEye" not in Stage
Runtime = (Root / "Engine/Host/FrontierRuntime.cpp").read_text(encoding="utf-8")
Motion = Runtime[Runtime.index("if (ProjectMoved)"):Runtime.index("if (Transport == 1u && !CameraEjected && !ActiveReception.CameraRequests.empty())")]
assert "RefreshGeometry" in Motion and "UploadScene" not in Motion
Geometry = (Root / "Engine/Host/GeometrySequence.h").read_text(encoding="utf-8")
assert "InvertMatrix(Instance.World" in Geometry and "WorldToLocal[0] * X" in Geometry
assert "std::fill_n(Live.World" not in Geometry
for Name in ("CMakeLists.txt", "Tools/Build/ToolchainSequence.ps1"):
    Build = (Root / Name).read_text(encoding="utf-8")
    assert "Surfel" not in Build and "DistanceFieldConstruct.slang" not in Build
print("PASS production wiring: checked recording, per-slot descriptors, ordered uniforms, local deformation, no motion bake or Surfel registration")
print("All checks are CPU-only. GPU validation, appearance, timings and device-loss reproduction remain separate.")
