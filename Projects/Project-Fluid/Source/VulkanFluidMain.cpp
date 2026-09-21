#define GLFW_INCLUDE_NONE
#include <vulkan/vulkan.h>
#include <GLFW/glfw3.h>

#include "SpectralOcean.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace PF = Frontier::ProjectFluid;

namespace {
constexpr std::uint32_t InitialWidth = 1280;
constexpr std::uint32_t InitialHeight = 720;

[[noreturn]] void Fail(const std::string& message) { throw std::runtime_error(message); }
void VkCheck(VkResult result, const char* operation) {
    if (result != VK_SUCCESS) Fail(std::string(operation) + " failed (VkResult " + std::to_string(result) + ")");
}

std::vector<std::uint32_t> ReadSpirv(const char* path) {
    std::ifstream stream(path, std::ios::binary | std::ios::ate);
    if (!stream) Fail(std::string("Cannot open shader: ") + path);
    const auto bytes = stream.tellg();
    if (bytes <= 0 || (bytes % 4) != 0) Fail(std::string("Invalid SPIR-V: ") + path);
    std::vector<std::uint32_t> words(static_cast<std::size_t>(bytes) / 4);
    stream.seekg(0);
    stream.read(reinterpret_cast<char*>(words.data()), bytes);
    return words;
}

struct Buffer {
    VkBuffer Handle{VK_NULL_HANDLE};
    VkDeviceMemory Memory{VK_NULL_HANDLE};
    VkDeviceSize Size{};
    void* Mapped{};
};

struct alignas(16) Parameters {
    std::uint32_t Resolution{};
    std::uint32_t ModeCount{};
    float DomainMetres{};
    float Seconds{};
    float Choppiness{};
    float WindSpeed{};
    float CameraX{};
    float CameraZ{};
    float CameraZoom{};
    float Sun{};
    std::uint32_t Paused{};
    std::uint32_t DebugCpu{};
};
static_assert(sizeof(Parameters) == 48);

class FluidApplication final {
public:
    ~FluidApplication() { Shutdown(); }

    void Run() {
        Initialize();
        auto previous = std::chrono::steady_clock::now();
        while (!glfwWindowShouldClose(Window_)) {
            glfwPollEvents();
            const auto now = std::chrono::steady_clock::now();
            const float dt = std::min(0.05f, std::chrono::duration<float>(now - previous).count());
            previous = now;
            // Mapped uniforms and mode data are single-buffered in this proof;
            // do not mutate them until the preceding dispatch has retired.
            vkWaitForFences(Device_, 1, &FrameFence_, VK_TRUE, UINT64_MAX);
            Update(dt);
            Draw();
        }
        vkDeviceWaitIdle(Device_);
    }

private:
    GLFWwindow* Window_{};
    VkInstance Instance_{VK_NULL_HANDLE};
    VkSurfaceKHR WindowSurface_{VK_NULL_HANDLE};
    VkPhysicalDevice Physical_{VK_NULL_HANDLE};
    VkDevice Device_{VK_NULL_HANDLE};
    VkQueue Queue_{VK_NULL_HANDLE};
    std::uint32_t QueueFamily_{};
    VkSwapchainKHR Swapchain_{VK_NULL_HANDLE};
    VkFormat SwapFormat_{VK_FORMAT_UNDEFINED};
    VkExtent2D Extent_{};
    std::vector<VkImage> Images_;
    VkCommandPool CommandPool_{VK_NULL_HANDLE};
    VkCommandBuffer Command_{VK_NULL_HANDLE};
    VkDescriptorSetLayout SetLayout_{VK_NULL_HANDLE};
    VkDescriptorPool DescriptorPool_{VK_NULL_HANDLE};
    VkDescriptorSet SurfaceSet_{VK_NULL_HANDLE};
    VkDescriptorSet PresentSet_{VK_NULL_HANDLE};
    VkPipelineLayout SurfaceLayout_{VK_NULL_HANDLE};
    VkPipelineLayout PresentLayout_{VK_NULL_HANDLE};
    VkPipeline SurfacePipeline_{VK_NULL_HANDLE};
    VkPipeline PresentPipeline_{VK_NULL_HANDLE};
    VkSemaphore Acquired_{VK_NULL_HANDLE};
    VkSemaphore Rendered_{VK_NULL_HANDLE};
    VkFence FrameFence_{VK_NULL_HANDLE};
    Buffer ModesBuffer_;
    Buffer SurfaceBuffer_;
    Buffer PixelBuffer_;
    Buffer UniformBuffer_;
    PF::SpectralOcean Ocean_;
    Parameters Params_{};
    bool PauseLatch_{false};
    bool CpuLatch_{false};
    std::uint64_t FrameNumber_{};

    std::uint32_t FindMemory(std::uint32_t mask, VkMemoryPropertyFlags wanted) const {
        VkPhysicalDeviceMemoryProperties properties{};
        vkGetPhysicalDeviceMemoryProperties(Physical_, &properties);
        for (std::uint32_t i = 0; i < properties.memoryTypeCount; ++i)
            if ((mask & (1u << i)) && (properties.memoryTypes[i].propertyFlags & wanted) == wanted) return i;
        Fail("No compatible Vulkan memory type");
    }

    Buffer MakeBuffer(VkDeviceSize size, VkBufferUsageFlags usage, bool hostVisible) {
        Buffer buffer{};
        buffer.Size = size;
        VkBufferCreateInfo info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        info.size = size;
        info.usage = usage;
        info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        VkCheck(vkCreateBuffer(Device_, &info, nullptr, &buffer.Handle), "vkCreateBuffer");
        VkMemoryRequirements requirement{};
        vkGetBufferMemoryRequirements(Device_, buffer.Handle, &requirement);
        VkMemoryAllocateInfo allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        allocation.allocationSize = requirement.size;
        const VkMemoryPropertyFlags flags = hostVisible
            ? VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
            : VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT;
        allocation.memoryTypeIndex = FindMemory(requirement.memoryTypeBits, flags);
        VkCheck(vkAllocateMemory(Device_, &allocation, nullptr, &buffer.Memory), "vkAllocateMemory");
        VkCheck(vkBindBufferMemory(Device_, buffer.Handle, buffer.Memory, 0), "vkBindBufferMemory");
        if (hostVisible) VkCheck(vkMapMemory(Device_, buffer.Memory, 0, size, 0, &buffer.Mapped), "vkMapMemory");
        return buffer;
    }

    void DestroyBuffer(Buffer& buffer) {
        if (!Device_) return;
        if (buffer.Mapped) vkUnmapMemory(Device_, buffer.Memory);
        if (buffer.Handle) vkDestroyBuffer(Device_, buffer.Handle, nullptr);
        if (buffer.Memory) vkFreeMemory(Device_, buffer.Memory, nullptr);
        buffer = {};
    }

    void Initialize() {
        if (!glfwInit()) Fail("GLFW initialization failed");
        if (!glfwVulkanSupported()) Fail("No Vulkan loader/driver is available");
        glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
        glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);
        Window_ = glfwCreateWindow(InitialWidth, InitialHeight, "Frontier — Project Fluid (Vulkan GPU + CPU mirror)", nullptr, nullptr);
        if (!Window_) Fail("Window creation failed");

        std::uint32_t extensionCount = 0;
        const char** extensions = glfwGetRequiredInstanceExtensions(&extensionCount);
        VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        app.pApplicationName = "Project Fluid";
        app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
        app.pEngineName = "Frontier";
        app.apiVersion = VK_API_VERSION_1_1;
        VkInstanceCreateInfo instanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        instanceInfo.pApplicationInfo = &app;
        instanceInfo.enabledExtensionCount = extensionCount;
        instanceInfo.ppEnabledExtensionNames = extensions;
        VkCheck(vkCreateInstance(&instanceInfo, nullptr, &Instance_), "vkCreateInstance");
        VkCheck(glfwCreateWindowSurface(Instance_, Window_, nullptr, &WindowSurface_), "glfwCreateWindowSurface");
        PickDevice();
        CreateSwapchain();
        CreateComputeState();

        Params_.Resolution = Ocean_.Settings().Resolution;
        Params_.ModeCount = static_cast<std::uint32_t>(Ocean_.Modes().size());
        Params_.DomainMetres = Ocean_.Settings().DomainMetres;
        Params_.WindSpeed = Ocean_.Settings().WindSpeed;
        Params_.Choppiness = Ocean_.Settings().Choppiness;
        Params_.CameraZoom = 170.0f;
        Params_.Sun = 0.15f;
        UploadModes();
        std::cout << "Project Fluid controls: WASD pan, Q/E zoom, arrows wind/chop, Space pause, C parity marker, Esc quit\n";
    }

    void PickDevice() {
        std::uint32_t count = 0;
        vkEnumeratePhysicalDevices(Instance_, &count, nullptr);
        std::vector<VkPhysicalDevice> devices(count);
        vkEnumeratePhysicalDevices(Instance_, &count, devices.data());
        for (VkPhysicalDevice candidate : devices) {
            std::uint32_t familyCount = 0;
            vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, nullptr);
            std::vector<VkQueueFamilyProperties> families(familyCount);
            vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, families.data());
            for (std::uint32_t i = 0; i < familyCount; ++i) {
                VkBool32 present = VK_FALSE;
                vkGetPhysicalDeviceSurfaceSupportKHR(candidate, i, WindowSurface_, &present);
                if (present && (families[i].queueFlags & VK_QUEUE_COMPUTE_BIT)) {
                    Physical_ = candidate;
                    QueueFamily_ = i;
                    break;
                }
            }
            if (Physical_) break;
        }
        if (!Physical_) Fail("No Vulkan compute queue can present to this window");
        const float priority = 1.0f;
        VkDeviceQueueCreateInfo queue{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        queue.queueFamilyIndex = QueueFamily_;
        queue.queueCount = 1;
        queue.pQueuePriorities = &priority;
        const char* extension = VK_KHR_SWAPCHAIN_EXTENSION_NAME;
        VkDeviceCreateInfo device{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        device.queueCreateInfoCount = 1;
        device.pQueueCreateInfos = &queue;
        device.enabledExtensionCount = 1;
        device.ppEnabledExtensionNames = &extension;
        VkCheck(vkCreateDevice(Physical_, &device, nullptr, &Device_), "vkCreateDevice");
        vkGetDeviceQueue(Device_, QueueFamily_, 0, &Queue_);
    }

    void CreateSwapchain() {
        VkSurfaceCapabilitiesKHR capabilities{};
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(Physical_, WindowSurface_, &capabilities);
        std::uint32_t formatCount = 0;
        vkGetPhysicalDeviceSurfaceFormatsKHR(Physical_, WindowSurface_, &formatCount, nullptr);
        std::vector<VkSurfaceFormatKHR> formats(formatCount);
        vkGetPhysicalDeviceSurfaceFormatsKHR(Physical_, WindowSurface_, &formatCount, formats.data());
        VkSurfaceFormatKHR selected = formats.front();
        for (const auto& format : formats)
            if (format.format == VK_FORMAT_B8G8R8A8_UNORM) selected = format;
        if (selected.format != VK_FORMAT_B8G8R8A8_UNORM && selected.format != VK_FORMAT_B8G8R8A8_SRGB)
            Fail("Project Fluid currently requires a BGRA8 swapchain");
        SwapFormat_ = selected.format;
        Extent_ = capabilities.currentExtent.width != std::numeric_limits<std::uint32_t>::max()
            ? capabilities.currentExtent : VkExtent2D{InitialWidth, InitialHeight};
        const std::uint32_t imageCount = std::clamp(capabilities.minImageCount + 1, capabilities.minImageCount,
            capabilities.maxImageCount ? capabilities.maxImageCount : capabilities.minImageCount + 1);
        VkSwapchainCreateInfoKHR info{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
        info.surface = WindowSurface_;
        info.minImageCount = imageCount;
        info.imageFormat = selected.format;
        info.imageColorSpace = selected.colorSpace;
        info.imageExtent = Extent_;
        info.imageArrayLayers = 1;
        info.imageUsage = VK_IMAGE_USAGE_TRANSFER_DST_BIT;
        info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
        info.preTransform = capabilities.currentTransform;
        info.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
        info.presentMode = VK_PRESENT_MODE_FIFO_KHR;
        info.clipped = VK_TRUE;
        VkCheck(vkCreateSwapchainKHR(Device_, &info, nullptr, &Swapchain_), "vkCreateSwapchainKHR");
        std::uint32_t actual = 0;
        vkGetSwapchainImagesKHR(Device_, Swapchain_, &actual, nullptr);
        Images_.resize(actual);
        vkGetSwapchainImagesKHR(Device_, Swapchain_, &actual, Images_.data());
    }

    VkPipeline MakePipeline(const char* path, VkPipelineLayout layout) {
        const auto code = ReadSpirv(path);
        VkShaderModuleCreateInfo moduleInfo{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        moduleInfo.codeSize = code.size() * sizeof(std::uint32_t);
        moduleInfo.pCode = code.data();
        VkShaderModule module{};
        VkCheck(vkCreateShaderModule(Device_, &moduleInfo, nullptr, &module), "vkCreateShaderModule");
        VkPipelineShaderStageCreateInfo stage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        stage.module = module;
        stage.pName = "main";
        VkComputePipelineCreateInfo pipelineInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
        pipelineInfo.stage = stage;
        pipelineInfo.layout = layout;
        VkPipeline pipeline{};
        VkCheck(vkCreateComputePipelines(Device_, VK_NULL_HANDLE, 1, &pipelineInfo, nullptr, &pipeline), "vkCreateComputePipelines");
        vkDestroyShaderModule(Device_, module, nullptr);
        return pipeline;
    }

    void CreateComputeState() {
        ModesBuffer_ = MakeBuffer(Ocean_.Modes().size() * sizeof(PF::OceanMode), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, true);
        const VkDeviceSize surfaceBytes = Ocean_.Settings().Resolution * Ocean_.Settings().Resolution * sizeof(float) * 4;
        SurfaceBuffer_ = MakeBuffer(surfaceBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, true);
        PixelBuffer_ = MakeBuffer(static_cast<VkDeviceSize>(Extent_.width) * Extent_.height * 4,
                                  VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT, false);
        UniformBuffer_ = MakeBuffer(sizeof(Parameters), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, true);

        std::array<VkDescriptorSetLayoutBinding, 3> bindings{};
        bindings[0] = {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        bindings[1] = {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        bindings[2] = {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        VkDescriptorSetLayoutCreateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        setInfo.bindingCount = static_cast<std::uint32_t>(bindings.size());
        setInfo.pBindings = bindings.data();
        VkCheck(vkCreateDescriptorSetLayout(Device_, &setInfo, nullptr, &SetLayout_), "vkCreateDescriptorSetLayout");

        VkPipelineLayoutCreateInfo surfaceLayout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        surfaceLayout.setLayoutCount = 1;
        surfaceLayout.pSetLayouts = &SetLayout_;
        VkCheck(vkCreatePipelineLayout(Device_, &surfaceLayout, nullptr, &SurfaceLayout_), "vkCreatePipelineLayout");
        VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(std::uint32_t) * 2};
        VkPipelineLayoutCreateInfo presentLayout = surfaceLayout;
        presentLayout.pushConstantRangeCount = 1;
        presentLayout.pPushConstantRanges = &push;
        VkCheck(vkCreatePipelineLayout(Device_, &presentLayout, nullptr, &PresentLayout_), "vkCreatePipelineLayout");
        SurfacePipeline_ = MakePipeline(PROJECT_FLUID_SURFACE_SPV, SurfaceLayout_);
        PresentPipeline_ = MakePipeline(PROJECT_FLUID_PRESENT_SPV, PresentLayout_);

        std::array<VkDescriptorPoolSize, 2> sizes{{
            {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 4}, {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 2}}};
        VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        pool.maxSets = 2;
        pool.poolSizeCount = static_cast<std::uint32_t>(sizes.size());
        pool.pPoolSizes = sizes.data();
        VkCheck(vkCreateDescriptorPool(Device_, &pool, nullptr, &DescriptorPool_), "vkCreateDescriptorPool");
        std::array<VkDescriptorSetLayout, 2> layouts{SetLayout_, SetLayout_};
        VkDescriptorSetAllocateInfo allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        allocate.descriptorPool = DescriptorPool_;
        allocate.descriptorSetCount = 2;
        allocate.pSetLayouts = layouts.data();
        std::array<VkDescriptorSet, 2> sets{};
        VkCheck(vkAllocateDescriptorSets(Device_, &allocate, sets.data()), "vkAllocateDescriptorSets");
        SurfaceSet_ = sets[0]; PresentSet_ = sets[1];
        WriteSet(SurfaceSet_, ModesBuffer_, SurfaceBuffer_);
        WriteSet(PresentSet_, SurfaceBuffer_, PixelBuffer_);

        VkCommandPoolCreateInfo commandPool{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        commandPool.queueFamilyIndex = QueueFamily_;
        commandPool.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        VkCheck(vkCreateCommandPool(Device_, &commandPool, nullptr, &CommandPool_), "vkCreateCommandPool");
        VkCommandBufferAllocateInfo command{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        command.commandPool = CommandPool_;
        command.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        command.commandBufferCount = 1;
        VkCheck(vkAllocateCommandBuffers(Device_, &command, &Command_), "vkAllocateCommandBuffers");
        VkSemaphoreCreateInfo semaphore{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        vkCreateSemaphore(Device_, &semaphore, nullptr, &Acquired_);
        vkCreateSemaphore(Device_, &semaphore, nullptr, &Rendered_);
        VkFenceCreateInfo fence{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        fence.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        vkCreateFence(Device_, &fence, nullptr, &FrameFence_);
    }

    void WriteSet(VkDescriptorSet set, const Buffer& first, const Buffer& second) {
        VkDescriptorBufferInfo a{first.Handle, 0, first.Size};
        VkDescriptorBufferInfo b{second.Handle, 0, second.Size};
        VkDescriptorBufferInfo u{UniformBuffer_.Handle, 0, UniformBuffer_.Size};
        std::array<VkWriteDescriptorSet, 3> writes{};
        const std::array<VkDescriptorBufferInfo*, 3> infos{&a, &b, &u};
        for (std::uint32_t i = 0; i < 3; ++i) {
            writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[i].dstSet = set;
            writes[i].dstBinding = i;
            writes[i].descriptorCount = 1;
            writes[i].descriptorType = i == 2 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            writes[i].pBufferInfo = infos[i];
        }
        vkUpdateDescriptorSets(Device_, static_cast<std::uint32_t>(writes.size()), writes.data(), 0, nullptr);
    }

    void UploadModes() {
        std::memcpy(ModesBuffer_.Mapped, Ocean_.Modes().data(), Ocean_.Modes().size() * sizeof(PF::OceanMode));
    }

    bool Pressed(int key, bool& latch) {
        const bool down = glfwGetKey(Window_, key) == GLFW_PRESS;
        const bool edge = down && !latch;
        latch = down;
        return edge;
    }

    void Update(float dt) {
        if (glfwGetKey(Window_, GLFW_KEY_ESCAPE) == GLFW_PRESS) glfwSetWindowShouldClose(Window_, GLFW_TRUE);
        if (Pressed(GLFW_KEY_SPACE, PauseLatch_)) Params_.Paused ^= 1u;
        if (Pressed(GLFW_KEY_C, CpuLatch_)) Params_.DebugCpu ^= 1u;
        if (!Params_.Paused) Params_.Seconds += dt;
        const float move = dt * Params_.CameraZoom * 0.45f;
        if (glfwGetKey(Window_, GLFW_KEY_W) == GLFW_PRESS) Params_.CameraZ += move;
        if (glfwGetKey(Window_, GLFW_KEY_S) == GLFW_PRESS) Params_.CameraZ -= move;
        if (glfwGetKey(Window_, GLFW_KEY_A) == GLFW_PRESS) Params_.CameraX -= move;
        if (glfwGetKey(Window_, GLFW_KEY_D) == GLFW_PRESS) Params_.CameraX += move;
        if (glfwGetKey(Window_, GLFW_KEY_Q) == GLFW_PRESS) Params_.CameraZoom = std::min(400.0f, Params_.CameraZoom + move);
        if (glfwGetKey(Window_, GLFW_KEY_E) == GLFW_PRESS) Params_.CameraZoom = std::max(45.0f, Params_.CameraZoom - move);
        if (glfwGetKey(Window_, GLFW_KEY_UP) == GLFW_PRESS) Params_.Choppiness = std::min(1.8f, Params_.Choppiness + dt * 0.5f);
        if (glfwGetKey(Window_, GLFW_KEY_DOWN) == GLFW_PRESS) Params_.Choppiness = std::max(0.0f, Params_.Choppiness - dt * 0.5f);
        float newWind = Params_.WindSpeed;
        if (glfwGetKey(Window_, GLFW_KEY_RIGHT) == GLFW_PRESS) newWind = std::min(18.0f, newWind + dt * 2.0f);
        if (glfwGetKey(Window_, GLFW_KEY_LEFT) == GLFW_PRESS) newWind = std::max(2.0f, newWind - dt * 2.0f);
        if (std::abs(newWind - Params_.WindSpeed) > 0.001f) {
            vkWaitForFences(Device_, 1, &FrameFence_, VK_TRUE, UINT64_MAX);
            Params_.WindSpeed = newWind;
            Ocean_.Rebuild(newWind, Ocean_.Settings().WindDirectionRadians);
            UploadModes();
        }
        Ocean_.SetChoppiness(Params_.Choppiness);
        std::memcpy(UniformBuffer_.Mapped, &Params_, sizeof(Params_));
        std::string title = "Project Fluid | Vulkan GPU | wind " + std::to_string(static_cast<int>(Params_.WindSpeed)) +
                            " m/s | chop " + std::to_string(Params_.Choppiness).substr(0, 4) +
                            (Params_.Paused ? " | PAUSED" : " | CPU mirror active");
        glfwSetWindowTitle(Window_, title.c_str());
    }

    void Draw() {
        vkWaitForFences(Device_, 1, &FrameFence_, VK_TRUE, UINT64_MAX);
        vkResetFences(Device_, 1, &FrameFence_);
        std::uint32_t imageIndex = 0;
        VkResult acquired = vkAcquireNextImageKHR(Device_, Swapchain_, UINT64_MAX, Acquired_, VK_NULL_HANDLE, &imageIndex);
        if (acquired != VK_SUCCESS && acquired != VK_SUBOPTIMAL_KHR) Fail("Swapchain acquisition failed");
        vkResetCommandBuffer(Command_, 0);
        VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        VkCheck(vkBeginCommandBuffer(Command_, &begin), "vkBeginCommandBuffer");
        vkCmdBindPipeline(Command_, VK_PIPELINE_BIND_POINT_COMPUTE, SurfacePipeline_);
        vkCmdBindDescriptorSets(Command_, VK_PIPELINE_BIND_POINT_COMPUTE, SurfaceLayout_, 0, 1, &SurfaceSet_, 0, nullptr);
        vkCmdDispatch(Command_, (Params_.Resolution + 15) / 16, (Params_.Resolution + 15) / 16, 1);
        VkMemoryBarrier computeBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        computeBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        computeBarrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        vkCmdPipelineBarrier(Command_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0,
                             1, &computeBarrier, 0, nullptr, 0, nullptr);
        vkCmdBindPipeline(Command_, VK_PIPELINE_BIND_POINT_COMPUTE, PresentPipeline_);
        vkCmdBindDescriptorSets(Command_, VK_PIPELINE_BIND_POINT_COMPUTE, PresentLayout_, 0, 1, &PresentSet_, 0, nullptr);
        const std::array<std::uint32_t, 2> dimensions{Extent_.width, Extent_.height};
        vkCmdPushConstants(Command_, PresentLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(dimensions), dimensions.data());
        vkCmdDispatch(Command_, (Extent_.width + 15) / 16, (Extent_.height + 15) / 16, 1);
        VkBufferMemoryBarrier pixelBarrier{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
        pixelBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        pixelBarrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        pixelBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        pixelBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        pixelBarrier.buffer = PixelBuffer_.Handle;
        pixelBarrier.size = VK_WHOLE_SIZE;
        vkCmdPipelineBarrier(Command_, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                             0, nullptr, 1, &pixelBarrier, 0, nullptr);
        VkImageMemoryBarrier toTransfer{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        toTransfer.srcAccessMask = 0;
        toTransfer.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        // We overwrite every pixel, so UNDEFINED may discard the acquired
        // image's previous presentation contents on every frame.
        toTransfer.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        toTransfer.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        toTransfer.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toTransfer.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toTransfer.image = Images_[imageIndex];
        toTransfer.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        vkCmdPipelineBarrier(Command_, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                             0, nullptr, 0, nullptr, 1, &toTransfer);
        VkBufferImageCopy copy{};
        copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        copy.imageExtent = {Extent_.width, Extent_.height, 1};
        vkCmdCopyBufferToImage(Command_, PixelBuffer_.Handle, Images_[imageIndex], VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &copy);
        VkImageMemoryBarrier toPresent = toTransfer;
        toPresent.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        toPresent.dstAccessMask = 0;
        toPresent.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        toPresent.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        vkCmdPipelineBarrier(Command_, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0,
                             0, nullptr, 0, nullptr, 1, &toPresent);
        VkCheck(vkEndCommandBuffer(Command_), "vkEndCommandBuffer");
        const VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_TRANSFER_BIT;
        VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        submit.waitSemaphoreCount = 1; submit.pWaitSemaphores = &Acquired_; submit.pWaitDstStageMask = &waitStage;
        submit.commandBufferCount = 1; submit.pCommandBuffers = &Command_;
        submit.signalSemaphoreCount = 1; submit.pSignalSemaphores = &Rendered_;
        VkCheck(vkQueueSubmit(Queue_, 1, &submit, FrameFence_), "vkQueueSubmit");
        VkPresentInfoKHR present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
        present.waitSemaphoreCount = 1; present.pWaitSemaphores = &Rendered_;
        present.swapchainCount = 1; present.pSwapchains = &Swapchain_; present.pImageIndices = &imageIndex;
        VkCheck(vkQueuePresentKHR(Queue_, &present), "vkQueuePresentKHR");
        if ((++FrameNumber_ % 180u) == 0u) ValidateCpuMirror();
    }

    void ValidateCpuMirror() {
        vkWaitForFences(Device_, 1, &FrameFence_, VK_TRUE, UINT64_MAX);
        const auto* gpu = static_cast<const float*>(SurfaceBuffer_.Mapped);
        float maxHeightError = 0.0f;
        float maxSlopeError = 0.0f;
        for (std::uint32_t z : {31u, 97u, 181u, 233u}) {
            for (std::uint32_t x : {17u, 83u, 149u, 219u}) {
                const float worldX = (static_cast<float>(x) / (Params_.Resolution - 1u) - 0.5f) * Params_.DomainMetres;
                const float worldZ = (static_cast<float>(z) / (Params_.Resolution - 1u) - 0.5f) * Params_.DomainMetres;
                const auto cpu = Ocean_.Evaluate(worldX, worldZ, Params_.Seconds);
                const std::size_t at = (z * Params_.Resolution + x) * 4;
                maxHeightError = std::max(maxHeightError, std::abs(cpu.Height - gpu[at]));
                maxSlopeError = std::max({maxSlopeError, std::abs(cpu.SlopeX - gpu[at + 1]), std::abs(cpu.SlopeZ - gpu[at + 2])});
            }
        }
        std::cout << "[CPU mirror] max height error " << maxHeightError << " m, slope error " << maxSlopeError
                  << (maxHeightError < 0.002f ? " (PASS)\n" : " (CHECK DRIVER MATH)\n");
    }

    void Shutdown() {
        if (Device_) vkDeviceWaitIdle(Device_);
        if (Device_) {
            if (FrameFence_) vkDestroyFence(Device_, FrameFence_, nullptr);
            if (Acquired_) vkDestroySemaphore(Device_, Acquired_, nullptr);
            if (Rendered_) vkDestroySemaphore(Device_, Rendered_, nullptr);
            if (CommandPool_) vkDestroyCommandPool(Device_, CommandPool_, nullptr);
            if (SurfacePipeline_) vkDestroyPipeline(Device_, SurfacePipeline_, nullptr);
            if (PresentPipeline_) vkDestroyPipeline(Device_, PresentPipeline_, nullptr);
            if (SurfaceLayout_) vkDestroyPipelineLayout(Device_, SurfaceLayout_, nullptr);
            if (PresentLayout_) vkDestroyPipelineLayout(Device_, PresentLayout_, nullptr);
            if (DescriptorPool_) vkDestroyDescriptorPool(Device_, DescriptorPool_, nullptr);
            if (SetLayout_) vkDestroyDescriptorSetLayout(Device_, SetLayout_, nullptr);
            DestroyBuffer(ModesBuffer_); DestroyBuffer(SurfaceBuffer_); DestroyBuffer(PixelBuffer_); DestroyBuffer(UniformBuffer_);
            if (Swapchain_) vkDestroySwapchainKHR(Device_, Swapchain_, nullptr);
            vkDestroyDevice(Device_, nullptr);
        }
        if (WindowSurface_) vkDestroySurfaceKHR(Instance_, WindowSurface_, nullptr);
        if (Instance_) vkDestroyInstance(Instance_, nullptr);
        if (Window_) glfwDestroyWindow(Window_);
        glfwTerminate();
        Device_ = VK_NULL_HANDLE;
    }
};
} // namespace

int main() {
    try {
        FluidApplication application;
        application.Run();
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Project Fluid: " << error.what() << '\n';
        return 1;
    }
}
