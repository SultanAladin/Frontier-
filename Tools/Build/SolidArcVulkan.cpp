//=============================================================================================================================================
// SolidArcVulkan.cpp
// Standalone C++20 SolidArc shell: software CAD raster, Vulkan swapchain presentation, and an ImGui Construct workflow.
//=============================================================================================================================================

#define GLFW_INCLUDE_VULKAN
#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>

#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_vulkan.h>
#include <imgui.h>

#include "Editor/AuthoringTools/Modelling/SolidArc/Console/ConsoleHost.h"
#include "Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcConstructCatalog.h"
#include "Editor/AuthoringTools/Modelling/SolidArc/Interaction/SnapResolution.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

namespace {

void CheckVk(VkResult Result, const char* Operation)
{
    if (Result == VK_SUCCESS)
        return;
    char Message[192] = {};
    std::snprintf(Message, sizeof(Message), "%s failed with VkResult %d", Operation, static_cast<int>(Result));
    throw std::runtime_error(Message);
}

void ImGuiVkResult(VkResult Result)
{
    if (Result != VK_SUCCESS)
        std::fprintf(stderr, "[SolidArc] ImGui Vulkan backend returned VkResult %d\n", static_cast<int>(Result));
}

struct QueueFamilies
{
    uint32_t Graphics = UINT32_MAX;
    uint32_t Present = UINT32_MAX;
    [[nodiscard]] bool Complete() const noexcept { return Graphics != UINT32_MAX && Present != UINT32_MAX; }
};

struct FrameResources
{
    VkCommandBuffer CommandBuffer = VK_NULL_HANDLE;
    VkSemaphore ImageAvailable = VK_NULL_HANDLE;
    VkSemaphore RenderFinished = VK_NULL_HANDLE;
    VkFence InFlight = VK_NULL_HANDLE;
};

class VulkanPresenter final
{
public:
    ~VulkanPresenter() { Destroy(); }
    VulkanPresenter() = default;
    VulkanPresenter(const VulkanPresenter&) = delete;
    VulkanPresenter& operator=(const VulkanPresenter&) = delete;

    void Initialize(GLFWwindow* Window)
    {
        NativeWindow = Window;
        CreateInstance();
        CheckVk(glfwCreateWindowSurface(Instance, NativeWindow, nullptr, &Surface), "glfwCreateWindowSurface");
        SelectPhysicalDevice();
        CreateLogicalDevice();
        CreateCommandPool();
        CreateSwapchain();
        CreateRenderPass();
        CreateFramebuffers();
        CreateFrameResources();
    }

    void InitializeImGuiBackends()
    {
        if (!ImGui_ImplGlfw_InitForVulkan(NativeWindow, true))
            throw std::runtime_error("ImGui GLFW/Vulkan platform backend initialization failed");
        GlfwBackendReady = true;

        ImGui_ImplVulkan_InitInfo Info{};
        Info.ApiVersion = VK_API_VERSION_1_1;
        Info.Instance = Instance;
        Info.PhysicalDevice = PhysicalDevice;
        Info.Device = Device;
        Info.QueueFamily = Families.Graphics;
        Info.Queue = GraphicsQueue;
        Info.DescriptorPoolSize = 64u;
        Info.MinImageCount = MinimumImageCount;
        Info.ImageCount = static_cast<uint32_t>(SwapchainImages.size());
        Info.PipelineInfoMain.RenderPass = RenderPass;
        Info.PipelineInfoMain.Subpass = 0u;
        Info.PipelineInfoMain.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
        Info.CheckVkResultFn = ImGuiVkResult;
        if (!ImGui_ImplVulkan_Init(&Info))
            throw std::runtime_error("ImGui Vulkan renderer backend initialization failed");
        VulkanBackendReady = true;
    }

    void CreateCanvasTexture(const Frontier::RasterImage& Image)
    {
        if (Image.Width == 0u || Image.Height == 0u || Image.Pixels.size() != size_t(Image.Width) * Image.Height * 4u)
            throw std::runtime_error("SolidArc raster returned an invalid RGBA image");
        CheckVk(vkDeviceWaitIdle(Device), "vkDeviceWaitIdle(recreate CAD canvas)");
        ReleaseCanvasTexture();
        CanvasWidth = Image.Width;
        CanvasHeight = Image.Height;
        CreateCanvasImage();
        UploadCanvasPixels(Image.Pixels.data(), Image.Pixels.size());
        CanvasTexture = ImGui_ImplVulkan_AddTexture(CanvasView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
        if (CanvasTexture == VK_NULL_HANDLE)
            throw std::runtime_error("ImGui Vulkan texture descriptor allocation failed");
    }

    void UploadCanvas(const Frontier::RasterImage& Image)
    {
        if (Image.Width != CanvasWidth || Image.Height != CanvasHeight ||
            Image.Pixels.size() != size_t(Image.Width) * Image.Height * 4u)
        {
            CreateCanvasTexture(Image);
            return;
        }
        UploadCanvasPixels(Image.Pixels.data(), Image.Pixels.size());
    }

    [[nodiscard]] ImTextureRef CanvasTextureRef() const noexcept
    {
        return ImTextureRef(TextureId(CanvasTexture));
    }

    void ShutdownImGuiBackends() noexcept
    {
        if (Device != VK_NULL_HANDLE)
            vkDeviceWaitIdle(Device);
        if (CanvasTexture != VK_NULL_HANDLE && VulkanBackendReady)
        {
            ImGui_ImplVulkan_RemoveTexture(CanvasTexture);
            CanvasTexture = VK_NULL_HANDLE;
        }
        if (VulkanBackendReady)
        {
            ImGui_ImplVulkan_Shutdown();
            VulkanBackendReady = false;
        }
        if (GlfwBackendReady)
        {
            ImGui_ImplGlfw_Shutdown();
            GlfwBackendReady = false;
        }
    }

    void Destroy() noexcept
    {
        ShutdownImGuiBackends();
        if (Device != VK_NULL_HANDLE)
            vkDeviceWaitIdle(Device);
        ReleaseCanvasTexture();
        DestroyFrameResources();
        DestroyFramebuffers();
        if (RenderPass != VK_NULL_HANDLE)
        {
            vkDestroyRenderPass(Device, RenderPass, nullptr);
            RenderPass = VK_NULL_HANDLE;
        }
        DestroySwapchain();
        if (CommandPool != VK_NULL_HANDLE)
        {
            vkDestroyCommandPool(Device, CommandPool, nullptr);
            CommandPool = VK_NULL_HANDLE;
        }
        if (Device != VK_NULL_HANDLE)
        {
            vkDestroyDevice(Device, nullptr);
            Device = VK_NULL_HANDLE;
        }
        if (Surface != VK_NULL_HANDLE && Instance != VK_NULL_HANDLE)
        {
            vkDestroySurfaceKHR(Instance, Surface, nullptr);
            Surface = VK_NULL_HANDLE;
        }
        if (Instance != VK_NULL_HANDLE)
        {
            vkDestroyInstance(Instance, nullptr);
            Instance = VK_NULL_HANDLE;
        }
    }

    void Render(ImDrawData* DrawData)
    {
        if (NeedsSwapchainRebuild && !RebuildSwapchain())
            return;

        FrameResources& Frame = Frames[FrameIndex];
        CheckVk(vkWaitForFences(Device, 1u, &Frame.InFlight, VK_TRUE, UINT64_MAX), "vkWaitForFences");
        uint32_t ImageIndex = 0u;
        const VkResult Acquired = vkAcquireNextImageKHR(Device, Swapchain, UINT64_MAX, Frame.ImageAvailable,
                                                         VK_NULL_HANDLE, &ImageIndex);
        if (Acquired == VK_ERROR_OUT_OF_DATE_KHR)
        {
            NeedsSwapchainRebuild = true;
            RebuildSwapchain();
            return;
        }
        if (Acquired != VK_SUCCESS && Acquired != VK_SUBOPTIMAL_KHR)
            CheckVk(Acquired, "vkAcquireNextImageKHR");
        if (Acquired == VK_SUBOPTIMAL_KHR)
            NeedsSwapchainRebuild = true;

        if (ImageFences[ImageIndex] != VK_NULL_HANDLE)
            CheckVk(vkWaitForFences(Device, 1u, &ImageFences[ImageIndex], VK_TRUE, UINT64_MAX), "wait for swapchain image fence");
        ImageFences[ImageIndex] = Frame.InFlight;
        CheckVk(vkResetFences(Device, 1u, &Frame.InFlight), "vkResetFences");
        CheckVk(vkResetCommandBuffer(Frame.CommandBuffer, 0u), "vkResetCommandBuffer");

        VkCommandBufferBeginInfo Begin{};
        Begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        CheckVk(vkBeginCommandBuffer(Frame.CommandBuffer, &Begin), "vkBeginCommandBuffer");

        VkClearValue Clear{};
        Clear.color.float32[0] = 0.035f;
        Clear.color.float32[1] = 0.043f;
        Clear.color.float32[2] = 0.055f;
        Clear.color.float32[3] = 1.0f;
        VkRenderPassBeginInfo Pass{};
        Pass.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        Pass.renderPass = RenderPass;
        Pass.framebuffer = Framebuffers[ImageIndex];
        Pass.renderArea.offset = { 0, 0 };
        Pass.renderArea.extent = SwapchainExtent;
        Pass.clearValueCount = 1u;
        Pass.pClearValues = &Clear;
        vkCmdBeginRenderPass(Frame.CommandBuffer, &Pass, VK_SUBPASS_CONTENTS_INLINE);
        ImGui_ImplVulkan_RenderDrawData(DrawData, Frame.CommandBuffer);
        vkCmdEndRenderPass(Frame.CommandBuffer);
        CheckVk(vkEndCommandBuffer(Frame.CommandBuffer), "vkEndCommandBuffer");

        const VkPipelineStageFlags WaitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        VkSubmitInfo Submit{};
        Submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        Submit.waitSemaphoreCount = 1u;
        Submit.pWaitSemaphores = &Frame.ImageAvailable;
        Submit.pWaitDstStageMask = &WaitStage;
        Submit.commandBufferCount = 1u;
        Submit.pCommandBuffers = &Frame.CommandBuffer;
        Submit.signalSemaphoreCount = 1u;
        Submit.pSignalSemaphores = &Frame.RenderFinished;
        CheckVk(vkQueueSubmit(GraphicsQueue, 1u, &Submit, Frame.InFlight), "vkQueueSubmit");

        VkPresentInfoKHR Present{};
        Present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
        Present.waitSemaphoreCount = 1u;
        Present.pWaitSemaphores = &Frame.RenderFinished;
        Present.swapchainCount = 1u;
        Present.pSwapchains = &Swapchain;
        Present.pImageIndices = &ImageIndex;
        const VkResult Presented = vkQueuePresentKHR(PresentQueue, &Present);
        if (Presented == VK_ERROR_OUT_OF_DATE_KHR || Presented == VK_SUBOPTIMAL_KHR)
            NeedsSwapchainRebuild = true;
        else
            CheckVk(Presented, "vkQueuePresentKHR");
        FrameIndex = (FrameIndex + 1u) % static_cast<uint32_t>(Frames.size());
    }

private:
    template <typename Handle>
    static ImTextureID TextureId(Handle Value) noexcept
    {
        if constexpr (std::is_pointer_v<Handle>)
            return reinterpret_cast<ImTextureID>(Value);
        else
            return static_cast<ImTextureID>(Value);
    }

    void CreateInstance()
    {
        uint32_t ExtensionCount = 0u;
        const char** Extensions = glfwGetRequiredInstanceExtensions(&ExtensionCount);
        if (Extensions == nullptr || ExtensionCount == 0u)
            throw std::runtime_error("GLFW did not provide Vulkan surface extensions");

        VkApplicationInfo App{};
        App.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
        App.pApplicationName = "SolidArc";
        App.applicationVersion = VK_MAKE_VERSION(0, 1, 0);
        App.pEngineName = "SolidArc standalone";
        App.engineVersion = VK_MAKE_VERSION(0, 1, 0);
        App.apiVersion = VK_API_VERSION_1_1;

        VkInstanceCreateInfo Create{};
        Create.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
        Create.pApplicationInfo = &App;
        Create.enabledExtensionCount = ExtensionCount;
        Create.ppEnabledExtensionNames = Extensions;
        CheckVk(vkCreateInstance(&Create, nullptr, &Instance), "vkCreateInstance");
    }

    [[nodiscard]] QueueFamilies FindFamilies(VkPhysicalDevice Candidate) const
    {
        QueueFamilies Result{};
        uint32_t Count = 0u;
        vkGetPhysicalDeviceQueueFamilyProperties(Candidate, &Count, nullptr);
        std::vector<VkQueueFamilyProperties> Properties(Count);
        vkGetPhysicalDeviceQueueFamilyProperties(Candidate, &Count, Properties.data());
        for (uint32_t Index = 0u; Index < Count; ++Index)
        {
            if ((Properties[Index].queueFlags & VK_QUEUE_GRAPHICS_BIT) != 0u)
                Result.Graphics = Index;
            VkBool32 SupportsPresent = VK_FALSE;
            CheckVk(vkGetPhysicalDeviceSurfaceSupportKHR(Candidate, Index, Surface, &SupportsPresent), "vkGetPhysicalDeviceSurfaceSupportKHR");
            if (SupportsPresent == VK_TRUE)
                Result.Present = Index;
            if (Result.Complete())
                break;
        }
        return Result;
    }

    [[nodiscard]] bool HasSwapchainExtension(VkPhysicalDevice Candidate) const
    {
        uint32_t Count = 0u;
        CheckVk(vkEnumerateDeviceExtensionProperties(Candidate, nullptr, &Count, nullptr), "vkEnumerateDeviceExtensionProperties");
        std::vector<VkExtensionProperties> Available(Count);
        CheckVk(vkEnumerateDeviceExtensionProperties(Candidate, nullptr, &Count, Available.data()), "vkEnumerateDeviceExtensionProperties");
        return std::any_of(Available.begin(), Available.end(), [](const VkExtensionProperties& Extension)
        {
            return std::string(Extension.extensionName) == VK_KHR_SWAPCHAIN_EXTENSION_NAME;
        });
    }

    void SelectPhysicalDevice()
    {
        uint32_t Count = 0u;
        CheckVk(vkEnumeratePhysicalDevices(Instance, &Count, nullptr), "vkEnumeratePhysicalDevices");
        if (Count == 0u)
            throw std::runtime_error("No Vulkan physical device was found");
        std::vector<VkPhysicalDevice> Devices(Count);
        CheckVk(vkEnumeratePhysicalDevices(Instance, &Count, Devices.data()), "vkEnumeratePhysicalDevices");

        for (VkPhysicalDevice Candidate : Devices)
        {
            QueueFamilies CandidateFamilies = FindFamilies(Candidate);
            if (!CandidateFamilies.Complete() || !HasSwapchainExtension(Candidate))
                continue;
            uint32_t FormatCount = 0u, PresentModeCount = 0u;
            if (vkGetPhysicalDeviceSurfaceFormatsKHR(Candidate, Surface, &FormatCount, nullptr) != VK_SUCCESS || FormatCount == 0u)
                continue;
            if (vkGetPhysicalDeviceSurfacePresentModesKHR(Candidate, Surface, &PresentModeCount, nullptr) != VK_SUCCESS || PresentModeCount == 0u)
                continue;
            PhysicalDevice = Candidate;
            Families = CandidateFamilies;
            break;
        }
        if (PhysicalDevice == VK_NULL_HANDLE)
            throw std::runtime_error("No Vulkan device supports both graphics and the GLFW surface");
    }

    void CreateLogicalDevice()
    {
        const float Priority = 1.0f;
        std::vector<uint32_t> UniqueFamilies = { Families.Graphics };
        if (Families.Present != Families.Graphics)
            UniqueFamilies.push_back(Families.Present);
        std::vector<VkDeviceQueueCreateInfo> QueueCreates;
        QueueCreates.reserve(UniqueFamilies.size());
        for (uint32_t Family : UniqueFamilies)
        {
            VkDeviceQueueCreateInfo Queue{};
            Queue.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            Queue.queueFamilyIndex = Family;
            Queue.queueCount = 1u;
            Queue.pQueuePriorities = &Priority;
            QueueCreates.push_back(Queue);
        }
        const char* Extensions[] = { VK_KHR_SWAPCHAIN_EXTENSION_NAME };
        VkPhysicalDeviceFeatures Features{};
        VkDeviceCreateInfo Create{};
        Create.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
        Create.queueCreateInfoCount = static_cast<uint32_t>(QueueCreates.size());
        Create.pQueueCreateInfos = QueueCreates.data();
        Create.pEnabledFeatures = &Features;
        Create.enabledExtensionCount = 1u;
        Create.ppEnabledExtensionNames = Extensions;
        CheckVk(vkCreateDevice(PhysicalDevice, &Create, nullptr, &Device), "vkCreateDevice");
        vkGetDeviceQueue(Device, Families.Graphics, 0u, &GraphicsQueue);
        vkGetDeviceQueue(Device, Families.Present, 0u, &PresentQueue);
    }

    void CreateCommandPool()
    {
        VkCommandPoolCreateInfo Create{};
        Create.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        Create.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT | VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
        Create.queueFamilyIndex = Families.Graphics;
        CheckVk(vkCreateCommandPool(Device, &Create, nullptr, &CommandPool), "vkCreateCommandPool");
    }

    [[nodiscard]] VkSurfaceFormatKHR ChooseSurfaceFormat(const std::vector<VkSurfaceFormatKHR>& Formats) const
    {
        if (Formats.size() == 1u && Formats[0].format == VK_FORMAT_UNDEFINED)
            return { VK_FORMAT_B8G8R8A8_UNORM, Formats[0].colorSpace };
        for (const VkSurfaceFormatKHR& Format : Formats)
            if (Format.format == VK_FORMAT_B8G8R8A8_UNORM && Format.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR)
                return Format;
        for (const VkSurfaceFormatKHR& Format : Formats)
            if (Format.format == VK_FORMAT_R8G8B8A8_UNORM && Format.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR)
                return Format;
        return Formats.front();
    }

    [[nodiscard]] uint32_t FindMemoryType(uint32_t TypeBits, VkMemoryPropertyFlags Required) const
    {
        VkPhysicalDeviceMemoryProperties Memory{};
        vkGetPhysicalDeviceMemoryProperties(PhysicalDevice, &Memory);
        for (uint32_t Index = 0u; Index < Memory.memoryTypeCount; ++Index)
            if ((TypeBits & (1u << Index)) != 0u && (Memory.memoryTypes[Index].propertyFlags & Required) == Required)
                return Index;
        throw std::runtime_error("Vulkan device does not expose a required memory type");
    }

    void CreateSwapchain()
    {
        VkSurfaceCapabilitiesKHR Capabilities{};
        CheckVk(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(PhysicalDevice, Surface, &Capabilities), "vkGetPhysicalDeviceSurfaceCapabilitiesKHR");
        uint32_t FormatCount = 0u;
        CheckVk(vkGetPhysicalDeviceSurfaceFormatsKHR(PhysicalDevice, Surface, &FormatCount, nullptr), "vkGetPhysicalDeviceSurfaceFormatsKHR");
        std::vector<VkSurfaceFormatKHR> Formats(FormatCount);
        CheckVk(vkGetPhysicalDeviceSurfaceFormatsKHR(PhysicalDevice, Surface, &FormatCount, Formats.data()), "vkGetPhysicalDeviceSurfaceFormatsKHR");
        if (Formats.empty())
            throw std::runtime_error("GLFW surface has no Vulkan formats");
        SurfaceFormat = ChooseSurfaceFormat(Formats);

        uint32_t ModeCount = 0u;
        CheckVk(vkGetPhysicalDeviceSurfacePresentModesKHR(PhysicalDevice, Surface, &ModeCount, nullptr), "vkGetPhysicalDeviceSurfacePresentModesKHR");
        std::vector<VkPresentModeKHR> Modes(ModeCount);
        CheckVk(vkGetPhysicalDeviceSurfacePresentModesKHR(PhysicalDevice, Surface, &ModeCount, Modes.data()), "vkGetPhysicalDeviceSurfacePresentModesKHR");
        VkPresentModeKHR PresentMode = VK_PRESENT_MODE_FIFO_KHR;
        if (std::find(Modes.begin(), Modes.end(), VK_PRESENT_MODE_MAILBOX_KHR) != Modes.end())
            PresentMode = VK_PRESENT_MODE_MAILBOX_KHR;

        if ((Capabilities.supportedUsageFlags & VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT) == 0u)
            throw std::runtime_error("GLFW Vulkan surface cannot be used as a color attachment");
        if (Capabilities.currentExtent.width != UINT32_MAX)
            SwapchainExtent = Capabilities.currentExtent;
        else
        {
            int Width = 0, Height = 0;
            glfwGetFramebufferSize(NativeWindow, &Width, &Height);
            if (Width <= 0 || Height <= 0)
                throw std::runtime_error("Cannot create a Vulkan swapchain for a minimized window");
            SwapchainExtent.width = std::clamp(static_cast<uint32_t>(Width), Capabilities.minImageExtent.width, Capabilities.maxImageExtent.width);
            SwapchainExtent.height = std::clamp(static_cast<uint32_t>(Height), Capabilities.minImageExtent.height, Capabilities.maxImageExtent.height);
        }

        uint32_t ImageCount = std::max(2u, Capabilities.minImageCount + 1u);
        if (Capabilities.maxImageCount > 0u)
            ImageCount = std::min(ImageCount, Capabilities.maxImageCount);
        MinimumImageCount = std::max(2u, Capabilities.minImageCount);
        MinimumImageCount = std::min(MinimumImageCount, ImageCount);

        VkSwapchainCreateInfoKHR Create{};
        Create.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
        Create.surface = Surface;
        Create.minImageCount = ImageCount;
        Create.imageFormat = SurfaceFormat.format;
        Create.imageColorSpace = SurfaceFormat.colorSpace;
        Create.imageExtent = SwapchainExtent;
        Create.imageArrayLayers = 1u;
        Create.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        const uint32_t QueueIndices[] = { Families.Graphics, Families.Present };
        if (Families.Graphics != Families.Present)
        {
            Create.imageSharingMode = VK_SHARING_MODE_CONCURRENT;
            Create.queueFamilyIndexCount = 2u;
            Create.pQueueFamilyIndices = QueueIndices;
        }
        else
            Create.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
        Create.preTransform = Capabilities.currentTransform;
        Create.compositeAlpha = ChooseCompositeAlpha(Capabilities.supportedCompositeAlpha);
        Create.presentMode = PresentMode;
        Create.clipped = VK_TRUE;
        Create.oldSwapchain = VK_NULL_HANDLE;
        CheckVk(vkCreateSwapchainKHR(Device, &Create, nullptr, &Swapchain), "vkCreateSwapchainKHR");
        uint32_t ActualCount = 0u;
        CheckVk(vkGetSwapchainImagesKHR(Device, Swapchain, &ActualCount, nullptr), "vkGetSwapchainImagesKHR");
        SwapchainImages.resize(ActualCount);
        CheckVk(vkGetSwapchainImagesKHR(Device, Swapchain, &ActualCount, SwapchainImages.data()), "vkGetSwapchainImagesKHR");
        ImageFences.assign(ActualCount, VK_NULL_HANDLE);
    }

    static VkCompositeAlphaFlagBitsKHR ChooseCompositeAlpha(VkCompositeAlphaFlagsKHR Supported) noexcept
    {
        constexpr VkCompositeAlphaFlagBitsKHR Candidates[] = {
            VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR,
            VK_COMPOSITE_ALPHA_PRE_MULTIPLIED_BIT_KHR,
            VK_COMPOSITE_ALPHA_POST_MULTIPLIED_BIT_KHR,
            VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR,
        };
        for (VkCompositeAlphaFlagBitsKHR Candidate : Candidates)
            if ((Supported & Candidate) != 0u)
                return Candidate;
        return VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    }

    void CreateRenderPass()
    {
        VkAttachmentDescription Colour{};
        Colour.format = SurfaceFormat.format;
        Colour.samples = VK_SAMPLE_COUNT_1_BIT;
        Colour.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        Colour.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        Colour.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        Colour.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        Colour.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        Colour.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        VkAttachmentReference ColourRef{};
        ColourRef.attachment = 0u;
        ColourRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        VkSubpassDescription Subpass{};
        Subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        Subpass.colorAttachmentCount = 1u;
        Subpass.pColorAttachments = &ColourRef;
        VkSubpassDependency Dependency{};
        Dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
        Dependency.dstSubpass = 0u;
        Dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        Dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        Dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        VkRenderPassCreateInfo Create{};
        Create.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        Create.attachmentCount = 1u;
        Create.pAttachments = &Colour;
        Create.subpassCount = 1u;
        Create.pSubpasses = &Subpass;
        Create.dependencyCount = 1u;
        Create.pDependencies = &Dependency;
        CheckVk(vkCreateRenderPass(Device, &Create, nullptr, &RenderPass), "vkCreateRenderPass");
    }

    void CreateFramebuffers()
    {
        SwapchainViews.resize(SwapchainImages.size(), VK_NULL_HANDLE);
        Framebuffers.resize(SwapchainImages.size(), VK_NULL_HANDLE);
        for (size_t Index = 0u; Index < SwapchainImages.size(); ++Index)
        {
            VkImageViewCreateInfo View{};
            View.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
            View.image = SwapchainImages[Index];
            View.viewType = VK_IMAGE_VIEW_TYPE_2D;
            View.format = SurfaceFormat.format;
            View.components = { VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY,
                                VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY };
            View.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
            View.subresourceRange.baseMipLevel = 0u;
            View.subresourceRange.levelCount = 1u;
            View.subresourceRange.baseArrayLayer = 0u;
            View.subresourceRange.layerCount = 1u;
            CheckVk(vkCreateImageView(Device, &View, nullptr, &SwapchainViews[Index]), "vkCreateImageView(swapchain)");
            VkFramebufferCreateInfo Create{};
            Create.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
            Create.renderPass = RenderPass;
            Create.attachmentCount = 1u;
            Create.pAttachments = &SwapchainViews[Index];
            Create.width = SwapchainExtent.width;
            Create.height = SwapchainExtent.height;
            Create.layers = 1u;
            CheckVk(vkCreateFramebuffer(Device, &Create, nullptr, &Framebuffers[Index]), "vkCreateFramebuffer");
        }
    }

    void CreateFrameResources()
    {
        VkCommandBufferAllocateInfo Allocate{};
        Allocate.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        Allocate.commandPool = CommandPool;
        Allocate.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        Allocate.commandBufferCount = static_cast<uint32_t>(Frames.size());
        VkCommandBuffer Commands[2] = {};
        CheckVk(vkAllocateCommandBuffers(Device, &Allocate, Commands), "vkAllocateCommandBuffers");
        for (uint32_t Index = 0u; Index < Frames.size(); ++Index)
        {
            Frames[Index].CommandBuffer = Commands[Index];
            VkSemaphoreCreateInfo Semaphore{};
            Semaphore.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
            CheckVk(vkCreateSemaphore(Device, &Semaphore, nullptr, &Frames[Index].ImageAvailable), "vkCreateSemaphore(image available)");
            CheckVk(vkCreateSemaphore(Device, &Semaphore, nullptr, &Frames[Index].RenderFinished), "vkCreateSemaphore(render finished)");
            VkFenceCreateInfo Fence{};
            Fence.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
            Fence.flags = VK_FENCE_CREATE_SIGNALED_BIT;
            CheckVk(vkCreateFence(Device, &Fence, nullptr, &Frames[Index].InFlight), "vkCreateFence");
        }
    }

    void DestroyFrameResources() noexcept
    {
        if (Device == VK_NULL_HANDLE)
            return;
        for (FrameResources& Frame : Frames)
        {
            if (Frame.ImageAvailable != VK_NULL_HANDLE) vkDestroySemaphore(Device, Frame.ImageAvailable, nullptr);
            if (Frame.RenderFinished != VK_NULL_HANDLE) vkDestroySemaphore(Device, Frame.RenderFinished, nullptr);
            if (Frame.InFlight != VK_NULL_HANDLE) vkDestroyFence(Device, Frame.InFlight, nullptr);
            Frame = {};
        }
        if (CommandPool != VK_NULL_HANDLE)
        {
            // Command buffers are freed with their pool.
            vkResetCommandPool(Device, CommandPool, 0u);
        }
    }

    void DestroyFramebuffers() noexcept
    {
        if (Device == VK_NULL_HANDLE)
            return;
        for (VkFramebuffer Framebuffer : Framebuffers)
            if (Framebuffer != VK_NULL_HANDLE) vkDestroyFramebuffer(Device, Framebuffer, nullptr);
        Framebuffers.clear();
        for (VkImageView View : SwapchainViews)
            if (View != VK_NULL_HANDLE) vkDestroyImageView(Device, View, nullptr);
        SwapchainViews.clear();
    }

    void DestroySwapchain() noexcept
    {
        if (Device != VK_NULL_HANDLE && Swapchain != VK_NULL_HANDLE)
            vkDestroySwapchainKHR(Device, Swapchain, nullptr);
        Swapchain = VK_NULL_HANDLE;
        SwapchainImages.clear();
        ImageFences.clear();
    }

    bool RebuildSwapchain()
    {
        int Width = 0, Height = 0;
        glfwGetFramebufferSize(NativeWindow, &Width, &Height);
        if (Width <= 0 || Height <= 0)
            return false;
        CheckVk(vkDeviceWaitIdle(Device), "vkDeviceWaitIdle(swapchain rebuild)");
        const VkFormat PreviousFormat = SurfaceFormat.format;
        DestroyFramebuffers();
        DestroySwapchain();
        CreateSwapchain();
        const bool FormatChanged = PreviousFormat != SurfaceFormat.format;
        if (FormatChanged)
        {
            if (RenderPass != VK_NULL_HANDLE)
                vkDestroyRenderPass(Device, RenderPass, nullptr);
            RenderPass = VK_NULL_HANDLE;
            CreateRenderPass();
        }
        CreateFramebuffers();
        if (VulkanBackendReady)
        {
            ImGui_ImplVulkan_SetMinImageCount(MinimumImageCount);
            if (FormatChanged)
            {
                ImGui_ImplVulkan_PipelineInfo Pipeline{};
                Pipeline.RenderPass = RenderPass;
                Pipeline.Subpass = 0u;
                Pipeline.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
                ImGui_ImplVulkan_CreateMainPipeline(&Pipeline);
            }
        }
        NeedsSwapchainRebuild = false;
        return true;
    }

    void CreateCanvasImage()
    {
        VkImageCreateInfo Create{};
        Create.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        Create.imageType = VK_IMAGE_TYPE_2D;
        Create.format = VK_FORMAT_R8G8B8A8_UNORM;
        Create.extent = { CanvasWidth, CanvasHeight, 1u };
        Create.mipLevels = 1u;
        Create.arrayLayers = 1u;
        Create.samples = VK_SAMPLE_COUNT_1_BIT;
        Create.tiling = VK_IMAGE_TILING_OPTIMAL;
        Create.usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
        Create.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        Create.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        CheckVk(vkCreateImage(Device, &Create, nullptr, &CanvasImage), "vkCreateImage(CAD canvas)");
        VkMemoryRequirements Requirements{};
        vkGetImageMemoryRequirements(Device, CanvasImage, &Requirements);
        VkMemoryAllocateInfo Allocate{};
        Allocate.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        Allocate.allocationSize = Requirements.size;
        Allocate.memoryTypeIndex = FindMemoryType(Requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        CheckVk(vkAllocateMemory(Device, &Allocate, nullptr, &CanvasMemory), "vkAllocateMemory(CAD canvas)");
        CheckVk(vkBindImageMemory(Device, CanvasImage, CanvasMemory, 0u), "vkBindImageMemory(CAD canvas)");

        VkImageViewCreateInfo View{};
        View.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        View.image = CanvasImage;
        View.viewType = VK_IMAGE_VIEW_TYPE_2D;
        View.format = VK_FORMAT_R8G8B8A8_UNORM;
        View.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        View.subresourceRange.baseMipLevel = 0u;
        View.subresourceRange.levelCount = 1u;
        View.subresourceRange.baseArrayLayer = 0u;
        View.subresourceRange.layerCount = 1u;
        CheckVk(vkCreateImageView(Device, &View, nullptr, &CanvasView), "vkCreateImageView(CAD canvas)");

        CanvasStagingSize = VkDeviceSize(CanvasWidth) * CanvasHeight * 4u;
        VkBufferCreateInfo Buffer{};
        Buffer.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        Buffer.size = CanvasStagingSize;
        Buffer.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
        Buffer.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        CheckVk(vkCreateBuffer(Device, &Buffer, nullptr, &CanvasStagingBuffer), "vkCreateBuffer(CAD canvas staging)");
        VkMemoryRequirements BufferRequirements{};
        vkGetBufferMemoryRequirements(Device, CanvasStagingBuffer, &BufferRequirements);
        VkMemoryAllocateInfo BufferAllocate{};
        BufferAllocate.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        BufferAllocate.allocationSize = BufferRequirements.size;
        try
        {
            BufferAllocate.memoryTypeIndex = FindMemoryType(BufferRequirements.memoryTypeBits,
                VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
            CanvasStagingCoherent = true;
        }
        catch (const std::runtime_error&)
        {
            BufferAllocate.memoryTypeIndex = FindMemoryType(BufferRequirements.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT);
            CanvasStagingCoherent = false;
        }
        CheckVk(vkAllocateMemory(Device, &BufferAllocate, nullptr, &CanvasStagingMemory), "vkAllocateMemory(CAD canvas staging)");
        CheckVk(vkBindBufferMemory(Device, CanvasStagingBuffer, CanvasStagingMemory, 0u), "vkBindBufferMemory(CAD canvas staging)");
        CheckVk(vkMapMemory(Device, CanvasStagingMemory, 0u, VK_WHOLE_SIZE, 0u, &CanvasStagingMapped), "vkMapMemory(CAD canvas staging)");
    }

    void UploadCanvasPixels(const uint8_t* Pixels, size_t ByteCount)
    {
        if (Pixels == nullptr || CanvasImage == VK_NULL_HANDLE || ByteCount != static_cast<size_t>(CanvasStagingSize))
            throw std::runtime_error("Invalid SolidArc canvas upload");
        CheckVk(vkDeviceWaitIdle(Device), "vkDeviceWaitIdle(canvas upload)");
        std::memcpy(CanvasStagingMapped, Pixels, ByteCount);
        if (!CanvasStagingCoherent)
        {
            VkMappedMemoryRange Range{};
            Range.sType = VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE;
            Range.memory = CanvasStagingMemory;
            Range.offset = 0u;
            Range.size = VK_WHOLE_SIZE;
            CheckVk(vkFlushMappedMemoryRanges(Device, 1u, &Range), "vkFlushMappedMemoryRanges(canvas)");
        }

        VkCommandBufferAllocateInfo Allocate{};
        Allocate.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        Allocate.commandPool = CommandPool;
        Allocate.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        Allocate.commandBufferCount = 1u;
        VkCommandBuffer Command = VK_NULL_HANDLE;
        CheckVk(vkAllocateCommandBuffers(Device, &Allocate, &Command), "vkAllocateCommandBuffers(canvas upload)");
        VkCommandBufferBeginInfo Begin{};
        Begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        CheckVk(vkBeginCommandBuffer(Command, &Begin), "vkBeginCommandBuffer(canvas upload)");

        VkImageMemoryBarrier ToTransfer{};
        ToTransfer.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        ToTransfer.srcAccessMask = CanvasUploaded ? static_cast<VkAccessFlags>(VK_ACCESS_SHADER_READ_BIT) : VkAccessFlags{};
        ToTransfer.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        ToTransfer.oldLayout = CanvasUploaded ? VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL : VK_IMAGE_LAYOUT_UNDEFINED;
        ToTransfer.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        ToTransfer.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        ToTransfer.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        ToTransfer.image = CanvasImage;
        ToTransfer.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        ToTransfer.subresourceRange.baseMipLevel = 0u;
        ToTransfer.subresourceRange.levelCount = 1u;
        ToTransfer.subresourceRange.baseArrayLayer = 0u;
        ToTransfer.subresourceRange.layerCount = 1u;
        vkCmdPipelineBarrier(Command,
            CanvasUploaded ? VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT : VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT, 0u, 0u, nullptr, 0u, nullptr, 1u, &ToTransfer);

        VkBufferImageCopy Copy{};
        Copy.bufferOffset = 0u;
        Copy.bufferRowLength = 0u;
        Copy.bufferImageHeight = 0u;
        Copy.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        Copy.imageSubresource.mipLevel = 0u;
        Copy.imageSubresource.baseArrayLayer = 0u;
        Copy.imageSubresource.layerCount = 1u;
        Copy.imageOffset = { 0, 0, 0 };
        Copy.imageExtent = { CanvasWidth, CanvasHeight, 1u };
        vkCmdCopyBufferToImage(Command, CanvasStagingBuffer, CanvasImage, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1u, &Copy);

        VkImageMemoryBarrier ToSample{};
        ToSample.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        ToSample.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        ToSample.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        ToSample.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        ToSample.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        ToSample.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        ToSample.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        ToSample.image = CanvasImage;
        ToSample.subresourceRange = ToTransfer.subresourceRange;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                             0u, 0u, nullptr, 0u, nullptr, 1u, &ToSample);
        CheckVk(vkEndCommandBuffer(Command), "vkEndCommandBuffer(canvas upload)");
        VkSubmitInfo Submit{};
        Submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        Submit.commandBufferCount = 1u;
        Submit.pCommandBuffers = &Command;
        CheckVk(vkQueueSubmit(GraphicsQueue, 1u, &Submit, VK_NULL_HANDLE), "vkQueueSubmit(canvas upload)");
        CheckVk(vkQueueWaitIdle(GraphicsQueue), "vkQueueWaitIdle(canvas upload)");
        vkFreeCommandBuffers(Device, CommandPool, 1u, &Command);
        CanvasUploaded = true;
    }

    void ReleaseCanvasTexture() noexcept
    {
        if (Device == VK_NULL_HANDLE)
            return;
        if (CanvasTexture != VK_NULL_HANDLE && VulkanBackendReady)
        {
            ImGui_ImplVulkan_RemoveTexture(CanvasTexture);
            CanvasTexture = VK_NULL_HANDLE;
        }
        if (CanvasStagingMapped != nullptr && CanvasStagingMemory != VK_NULL_HANDLE)
        {
            vkUnmapMemory(Device, CanvasStagingMemory);
            CanvasStagingMapped = nullptr;
        }
        if (CanvasStagingBuffer != VK_NULL_HANDLE) vkDestroyBuffer(Device, CanvasStagingBuffer, nullptr);
        if (CanvasStagingMemory != VK_NULL_HANDLE) vkFreeMemory(Device, CanvasStagingMemory, nullptr);
        if (CanvasView != VK_NULL_HANDLE) vkDestroyImageView(Device, CanvasView, nullptr);
        if (CanvasImage != VK_NULL_HANDLE) vkDestroyImage(Device, CanvasImage, nullptr);
        if (CanvasMemory != VK_NULL_HANDLE) vkFreeMemory(Device, CanvasMemory, nullptr);
        CanvasStagingBuffer = VK_NULL_HANDLE;
        CanvasStagingMemory = VK_NULL_HANDLE;
        CanvasView = VK_NULL_HANDLE;
        CanvasImage = VK_NULL_HANDLE;
        CanvasMemory = VK_NULL_HANDLE;
        CanvasTexture = VK_NULL_HANDLE;
        CanvasWidth = CanvasHeight = 0u;
        CanvasStagingSize = 0u;
        CanvasUploaded = false;
    }

    GLFWwindow* NativeWindow = nullptr;
    VkInstance Instance = VK_NULL_HANDLE;
    VkSurfaceKHR Surface = VK_NULL_HANDLE;
    VkPhysicalDevice PhysicalDevice = VK_NULL_HANDLE;
    VkDevice Device = VK_NULL_HANDLE;
    QueueFamilies Families{};
    VkQueue GraphicsQueue = VK_NULL_HANDLE;
    VkQueue PresentQueue = VK_NULL_HANDLE;
    VkCommandPool CommandPool = VK_NULL_HANDLE;
    VkSwapchainKHR Swapchain = VK_NULL_HANDLE;
    VkSurfaceFormatKHR SurfaceFormat{};
    VkExtent2D SwapchainExtent{};
    uint32_t MinimumImageCount = 2u;
    std::vector<VkImage> SwapchainImages;
    std::vector<VkImageView> SwapchainViews;
    std::vector<VkFramebuffer> Framebuffers;
    std::vector<VkFence> ImageFences;
    VkRenderPass RenderPass = VK_NULL_HANDLE;
    std::array<FrameResources, 2> Frames{};
    uint32_t FrameIndex = 0u;
    bool NeedsSwapchainRebuild = false;
    bool GlfwBackendReady = false;
    bool VulkanBackendReady = false;

    VkImage CanvasImage = VK_NULL_HANDLE;
    VkDeviceMemory CanvasMemory = VK_NULL_HANDLE;
    VkImageView CanvasView = VK_NULL_HANDLE;
    VkBuffer CanvasStagingBuffer = VK_NULL_HANDLE;
    VkDeviceMemory CanvasStagingMemory = VK_NULL_HANDLE;
    void* CanvasStagingMapped = nullptr;
    VkDeviceSize CanvasStagingSize = 0u;
    uint32_t CanvasWidth = 0u;
    uint32_t CanvasHeight = 0u;
    bool CanvasStagingCoherent = false;
    bool CanvasUploaded = false;
    VkDescriptorSet CanvasTexture = VK_NULL_HANDLE;
};

struct CanvasGesture
{
    bool LeftHeld = false;
    bool LeftTravelled = false;
    bool RightHeld = false;
    bool MiddleHeld = false;
    bool PressStartedOnCanvas = false;
    ImVec2 PressPosition{};
};

struct StandaloneState
{
    int ActiveTile = -1;
    bool AnchorSet = false;
    Frontier::Vec3 Anchor{};
    bool CursorValid = false;
    Frontier::Vec3 Cursor{};
    bool CanvasHovered = false;
    bool ConstructPopupOpen = false;
    bool SceneDirty = true;
    bool GestureDirty = false;
    CanvasGesture Gesture{};
    std::string Status = "Choose Construct to place a primitive, or drag in the viewport to orbit.";
};

void DrawDashedLine(ImDrawList* Draw, ImVec2 A, ImVec2 B, ImU32 Colour, float Dash = 11.0f, float Gap = 7.0f)
{
    const float Dx = B.x - A.x;
    const float Dy = B.y - A.y;
    const float Length = std::sqrt(Dx * Dx + Dy * Dy);
    if (Length <= 0.01f)
        return;
    const float Ux = Dx / Length;
    const float Uy = Dy / Length;
    for (float Along = 0.0f; Along < Length; Along += Dash + Gap)
    {
        const float End = std::min(Length, Along + Dash);
        Draw->AddLine(ImVec2(A.x + Ux * Along, A.y + Uy * Along),
                      ImVec2(A.x + Ux * End, A.y + Uy * End), Colour, 1.0f);
    }
}

bool ProjectToCanvas(const Frontier::ConsoleHost& Host, Frontier::Vec3 World, ImVec2 Minimum, ImVec2 Size, ImVec2& Screen) noexcept
{
    double X = 0.0, Y = 0.0;
    if (!Host.Camera().WorldToPixel(World, Host.Raster().Width(), Host.Raster().Height(), X, Y))
        return false;
    Screen = ImVec2(Minimum.x + static_cast<float>(X / Host.Raster().Width()) * Size.x,
                    Minimum.y + static_cast<float>(Y / Host.Raster().Height()) * Size.y);
    return true;
}

void DrawConstructGuide(const Frontier::ConsoleHost& Host, const StandaloneState& State,
                       ImDrawList* Draw, ImVec2 Minimum, ImVec2 Maximum) noexcept
{
    if (State.ActiveTile < 0 || !State.CursorValid)
        return;
    const ImVec2 Size(Maximum.x - Minimum.x, Maximum.y - Minimum.y);
    double PixelX = 0.0, PixelY = 0.0;
    if (!Host.Camera().WorldToPixel(State.Cursor, Host.Raster().Width(), Host.Raster().Height(), PixelX, PixelY))
        return;
    const ImVec2 Cursor(Minimum.x + static_cast<float>(PixelX / Host.Raster().Width()) * Size.x,
                        Minimum.y + static_cast<float>(PixelY / Host.Raster().Height()) * Size.y);
    const ImU32 Guide = IM_COL32(63, 218, 229, 190);
    DrawDashedLine(Draw, ImVec2(Minimum.x + 1.0f, Cursor.y), ImVec2(Maximum.x - 1.0f, Cursor.y), Guide);
    DrawDashedLine(Draw, ImVec2(Cursor.x, Minimum.y + 1.0f), ImVec2(Cursor.x, Maximum.y - 1.0f), Guide);
    Draw->AddCircle(Cursor, 5.0f, IM_COL32(130, 240, 246, 230), 20, 1.5f);
    Draw->AddCircleFilled(Cursor, 1.7f, IM_COL32(230, 255, 255, 255));

    char Readout[160] = {};
    std::snprintf(Readout, sizeof(Readout), "%s   X %.3f   Y %.3f   Z %.3f",
                  Frontier::kSolidArcConstructTiles[static_cast<size_t>(State.ActiveTile)].Label,
                  State.Cursor.X, State.Cursor.Y, State.Cursor.Z);
    const ImVec2 TextSize = ImGui::CalcTextSize(Readout);
    ImVec2 LabelPos(Cursor.x + 12.0f, Cursor.y + 10.0f);
    if (LabelPos.x + TextSize.x + 16.0f > Maximum.x)
        LabelPos.x = Cursor.x - TextSize.x - 22.0f;
    if (LabelPos.y + TextSize.y + 12.0f > Maximum.y)
        LabelPos.y = Cursor.y - TextSize.y - 18.0f;
    const ImVec2 LabelMax(LabelPos.x + TextSize.x + 14.0f, LabelPos.y + TextSize.y + 10.0f);
    Draw->AddRectFilled(LabelPos, LabelMax, IM_COL32(9, 17, 20, 228), 5.0f);
    Draw->AddRect(LabelPos, LabelMax, IM_COL32(63, 218, 229, 135), 5.0f, 0, 1.0f);
    Draw->AddText(ImVec2(LabelPos.x + 7.0f, LabelPos.y + 5.0f), IM_COL32(200, 250, 252, 255), Readout);

    if (State.AnchorSet)
    {
        ImVec2 AnchorScreen{};
        if (ProjectToCanvas(Host, State.Anchor, Minimum, Size, AnchorScreen))
        {
            DrawDashedLine(Draw, AnchorScreen, Cursor, IM_COL32(255, 184, 86, 200), 6.0f, 4.0f);
            Draw->AddCircle(AnchorScreen, 7.0f, IM_COL32(255, 184, 86, 255), 16, 1.7f);
            Draw->AddLine(ImVec2(AnchorScreen.x - 4.0f, AnchorScreen.y), ImVec2(AnchorScreen.x + 4.0f, AnchorScreen.y), IM_COL32(255, 220, 164, 255), 1.4f);
            Draw->AddLine(ImVec2(AnchorScreen.x, AnchorScreen.y - 4.0f), ImVec2(AnchorScreen.x, AnchorScreen.y + 4.0f), IM_COL32(255, 220, 164, 255), 1.4f);
        }
    }
}

bool HandleCanvas(Frontier::ConsoleHost& Host, StandaloneState& State,
                  ImVec2 Minimum, ImVec2 Maximum, bool Hovered)
{
    ImGuiIO& IO = ImGui::GetIO();
    const ImVec2 Size(Maximum.x - Minimum.x, Maximum.y - Minimum.y);
    State.CanvasHovered = Hovered;
    State.CursorValid = false;
    bool Changed = false;

    auto PixelFromScreen = [&](ImVec2 Screen, double& PixelX, double& PixelY) noexcept
    {
        const double U = std::clamp(double(Screen.x - Minimum.x) / std::max(1.0, double(Size.x)), 0.0, 1.0);
        const double V = std::clamp(double(Screen.y - Minimum.y) / std::max(1.0, double(Size.y)), 0.0, 1.0);
        PixelX = U * Host.Raster().Width();
        PixelY = V * Host.Raster().Height();
    };

    if (Hovered && State.ActiveTile >= 0)
    {
        double PixelX = 0.0, PixelY = 0.0;
        PixelFromScreen(IO.MousePos, PixelX, PixelY);
        State.CursorValid = Frontier::SnapResolution::PlaneHit(PixelX, PixelY, Host.Camera(),
            Host.Raster().Width(), Host.Raster().Height(), Host.WorkPlane(), State.Cursor);
    }

    CanvasGesture& Gesture = State.Gesture;
    if (Hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left))
    {
        Gesture.LeftHeld = true;
        Gesture.LeftTravelled = false;
        Gesture.PressStartedOnCanvas = true;
        Gesture.PressPosition = IO.MousePos;
    }
    if (Hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Right))
    {
        Gesture.RightHeld = true;
        Gesture.PressPosition = IO.MousePos;
    }
    if (Hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Middle))
    {
        Gesture.MiddleHeld = true;
        Gesture.PressPosition = IO.MousePos;
    }

    auto ApplyDrag = [&](ImVec2 Delta, bool Pan) noexcept
    {
        if (Delta.x == 0.0f && Delta.y == 0.0f)
            return;
        if (Pan)
            Host.Camera().Pan(Delta.x, -Delta.y, std::max(1.0, double(Size.y)));
        else
            Host.Camera().Orbit(-Delta.x * 0.006, Delta.y * 0.006);
        Changed = true;
    };

    if (Gesture.LeftHeld && ImGui::IsMouseDown(ImGuiMouseButton_Left))
    {
        const float Dx = IO.MousePos.x - Gesture.PressPosition.x;
        const float Dy = IO.MousePos.y - Gesture.PressPosition.y;
        if (Dx * Dx + Dy * Dy > 9.0f)
            Gesture.LeftTravelled = true;
        if (Gesture.LeftTravelled)
            ApplyDrag(IO.MouseDelta, IO.KeyShift);
    }
    if (Gesture.RightHeld && ImGui::IsMouseDown(ImGuiMouseButton_Right))
        ApplyDrag(IO.MouseDelta, false);
    if (Gesture.MiddleHeld && ImGui::IsMouseDown(ImGuiMouseButton_Middle))
        ApplyDrag(IO.MouseDelta, true);

    if (Gesture.LeftHeld && ImGui::IsMouseReleased(ImGuiMouseButton_Left))
    {
        if (Gesture.PressStartedOnCanvas && !Gesture.LeftTravelled)
        {
            double PixelX = 0.0, PixelY = 0.0;
            PixelFromScreen(Gesture.PressPosition, PixelX, PixelY);
            if (State.ActiveTile >= 0)
            {
                Frontier::Vec3 Hit;
                if (Frontier::SnapResolution::PlaneHit(PixelX, PixelY, Host.Camera(),
                    Host.Raster().Width(), Host.Raster().Height(), Host.WorkPlane(), Hit))
                {
                    State.Anchor = Hit;
                    State.AnchorSet = true;
                    State.Status = "Anchor set — press Enter to place, or Esc to cancel.";
                }
                else
                    State.Status = "That pointer ray is parallel to the XY construction plane; move over the canvas and click again.";
            }
            else
            {
                Host.ClickSelectAtPixel(PixelX, PixelY, IO.KeyShift || IO.KeyCtrl);
                Changed = true;
            }
        }
        Gesture.LeftHeld = false;
        Gesture.PressStartedOnCanvas = false;
    }
    if (Gesture.RightHeld && ImGui::IsMouseReleased(ImGuiMouseButton_Right))
        Gesture.RightHeld = false;
    if (Gesture.MiddleHeld && ImGui::IsMouseReleased(ImGuiMouseButton_Middle))
        Gesture.MiddleHeld = false;

    if (Hovered && IO.MouseWheel != 0.0f)
    {
        Host.Camera().Dolly(IO.MouseWheel);
        Changed = true;
    }
    return Changed;
}

bool DrawConstructPopup(StandaloneState& State)
{
    bool Selected = false;
    ImGui::SetNextWindowSize(ImVec2(430.0f, 340.0f), ImGuiCond_Appearing);
    if (ImGui::BeginPopup("##SolidArcConstructMenu", ImGuiWindowFlags_NoSavedSettings))
    {
        State.ConstructPopupOpen = true;
        ImGui::TextUnformatted("Construct");
        ImGui::SameLine();
        ImGui::TextDisabled("Click a tile, then click the XY plane and press Enter");
        ImGui::Separator();
        if (!ImGui::GetIO().WantTextInput)
        {
            int ShortcutTile = -1;
            if (ImGui::IsKeyPressed(ImGuiKey_L, false)) ShortcutTile = ImGui::GetIO().KeyShift ? 2 : 1;
            else if (ImGui::IsKeyPressed(ImGuiKey_R, false)) ShortcutTile = 3;
            else if (ImGui::IsKeyPressed(ImGuiKey_C, false)) ShortcutTile = 6;
            else if (ImGui::IsKeyPressed(ImGuiKey_A, false)) ShortcutTile = 7;
            else if (ImGui::IsKeyPressed(ImGuiKey_E, false)) ShortcutTile = 8;
            else if (ImGui::IsKeyPressed(ImGuiKey_P, false)) ShortcutTile = 9;
            if (ShortcutTile >= 0 && static_cast<uint32_t>(ShortcutTile) < Frontier::kSolidArcConstructTileCount)
            {
                State.ActiveTile = ShortcutTile;
                State.AnchorSet = false;
                State.CursorValid = false;
                State.Status = std::string(Frontier::kSolidArcConstructTiles[static_cast<size_t>(ShortcutTile)].Label) + " armed.";
                ImGui::CloseCurrentPopup();
                Selected = true;
            }
        }
        if (ImGui::BeginTabBar("##SolidArcConstructSections"))
        {
            constexpr const char* Sections[] = { "Reference", "Sketch Draw", "Solid", "Surface" };
            for (const char* Section : Sections)
            {
                if (!ImGui::BeginTabItem(Section))
                    continue;
                uint32_t Column = 0u;
                for (uint32_t Index = 0u; Index < Frontier::kSolidArcConstructTileCount; ++Index)
                {
                    const Frontier::SolidArcConstructTile& Tile = Frontier::kSolidArcConstructTiles[Index];
                    if (std::string(Tile.Section) != Section)
                        continue;
                    ImGui::PushID(static_cast<int>(Index));
                    char ButtonLabel[96] = {};
                    if (Tile.Shortcut[0] != '\0')
                        std::snprintf(ButtonLabel, sizeof(ButtonLabel), "%s  [%s]", Tile.Label, Tile.Shortcut);
                    else
                        std::snprintf(ButtonLabel, sizeof(ButtonLabel), "%s", Tile.Label);
                    if (ImGui::Button(ButtonLabel, ImVec2(122.0f, 34.0f)))
                    {
                        State.ActiveTile = static_cast<int>(Index);
                        State.AnchorSet = false;
                        State.CursorValid = false;
                        State.Status = std::string(Tile.Label) + " armed — move over the viewport and click an XY anchor.";
                        ImGui::CloseCurrentPopup();
                        Selected = true;
                    }
                    ImGui::PopID();
                    ++Column;
                    if (Column % 3u != 0u)
                        ImGui::SameLine();
                }
                ImGui::EndTabItem();
            }
            ImGui::EndTabBar();
        }
        ImGui::Separator();
        ImGui::TextDisabled("Enter places · Esc cancels · LMB drag orbits · Shift+LMB pans · wheel dollies");
        ImGui::EndPopup();
    }
    else
        State.ConstructPopupOpen = false;
    return Selected;
}

void HandleConstructHotkeys(StandaloneState& State)
{
    if (State.ConstructPopupOpen || ImGui::GetIO().WantTextInput)
        return;
    int Tile = -1;
    if (ImGui::IsKeyPressed(ImGuiKey_L, false)) Tile = ImGui::GetIO().KeyShift ? 2 : 1;
    else if (ImGui::IsKeyPressed(ImGuiKey_R, false)) Tile = 3;
    else if (ImGui::IsKeyPressed(ImGuiKey_C, false)) Tile = 6;
    else if (ImGui::IsKeyPressed(ImGuiKey_A, false)) Tile = 7;
    else if (ImGui::IsKeyPressed(ImGuiKey_E, false)) Tile = 8;
    else if (ImGui::IsKeyPressed(ImGuiKey_P, false)) Tile = 9;
    if (Tile < 0 || static_cast<uint32_t>(Tile) >= Frontier::kSolidArcConstructTileCount)
        return;
    State.ActiveTile = Tile;
    State.AnchorSet = false;
    State.CursorValid = false;
    State.Status = std::string(Frontier::kSolidArcConstructTiles[static_cast<size_t>(Tile)].Label) + " armed.";
}

bool DrawStandaloneUi(Frontier::ConsoleHost& Host, VulkanPresenter& Vulkan, StandaloneState& State)
{
    bool SceneChanged = false;
    ImGuiIO& IO = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(IO.DisplaySize, ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    constexpr ImGuiWindowFlags Flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus;
    if (ImGui::Begin("SolidArc Workspace", nullptr, Flags))
    {
        ImGui::TextColored(ImVec4(0.33f, 0.84f, 0.88f, 1.0f), "SOLIDARC");
        ImGui::SameLine();
        ImGui::TextDisabled("C++ CAD  /  Vulkan presentation");
        ImGui::SameLine();
        if (ImGui::Button("Construct", ImVec2(102.0f, 28.0f)))
            ImGui::OpenPopup("##SolidArcConstructMenu");
        DrawConstructPopup(State);
        ImGui::SameLine();
        if (State.ActiveTile >= 0)
        {
            const Frontier::SolidArcConstructTile& Tile = Frontier::kSolidArcConstructTiles[static_cast<size_t>(State.ActiveTile)];
            ImGui::TextColored(ImVec4(0.43f, 0.86f, 0.89f, 1.0f), "%s armed", Tile.Label);
            ImGui::SameLine();
            if (ImGui::SmallButton("Cancel"))
            {
                State.ActiveTile = -1;
                State.AnchorSet = false;
                State.CursorValid = false;
                State.Status = "Construction cancelled.";
            }
        }
        ImGui::SameLine();
        ImGui::TextDisabled("%zu figures", Host.AllFigures().size());
        ImGui::Separator();

        if (ImGui::BeginTable("##SolidArcLayout", 2, ImGuiTableFlags_Resizable | ImGuiTableFlags_SizingStretchProp,
                              ImVec2(0.0f, std::max(100.0f, ImGui::GetContentRegionAvail().y - 50.0f))))
        {
            ImGui::TableSetupColumn("CAD viewport", ImGuiTableColumnFlags_WidthStretch, 0.78f);
            ImGui::TableSetupColumn("Outliner", ImGuiTableColumnFlags_WidthStretch, 0.22f);
            ImGui::TableNextColumn();
            ImGui::BeginChild("##SolidArcViewport", ImVec2(0.0f, 0.0f), ImGuiChildFlags_Borders,
                              ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoScrollbar);
            const ImVec2 Available = ImGui::GetContentRegionAvail();
            const float CanvasWidth = std::max(64.0f, Available.x);
            const float CanvasHeight = std::max(64.0f, Available.y);
            ImGui::Image(Vulkan.CanvasTextureRef(), ImVec2(CanvasWidth, CanvasHeight));
            const ImVec2 Minimum = ImGui::GetItemRectMin();
            const ImVec2 Maximum = ImGui::GetItemRectMax();
            const bool Hovered = ImGui::IsItemHovered();
            SceneChanged |= HandleCanvas(Host, State, Minimum, Maximum, Hovered && !State.ConstructPopupOpen);
            DrawConstructGuide(Host, State, ImGui::GetWindowDrawList(), Minimum, Maximum);
            ImGui::EndChild();

            ImGui::TableNextColumn();
            ImGui::BeginChild("##SolidArcOutliner", ImVec2(0.0f, 0.0f), ImGuiChildFlags_Borders,
                              ImGuiWindowFlags_NoScrollWithMouse);
            ImGui::TextUnformatted("Outliner");
            ImGui::Separator();
            if (Host.AllFigures().empty())
                ImGui::TextDisabled("No figures yet. Open Construct to begin.");
            for (const Frontier::SceneFigure& Figure : Host.AllFigures())
            {
                const char* Kind = Figure.Classification == Frontier::FigureClassification::Body ? "Body" :
                    Figure.Classification == Frontier::FigureClassification::Surface ? "Surface" :
                    Figure.Classification == Frontier::FigureClassification::Curve ? "Sketch" : "Construction";
                ImGui::PushID(static_cast<int>(Figure.Identity));
                if (ImGui::Selectable(Figure.Name.c_str(), Figure.Selected))
                {
                    Host.Document().ClearSelection();
                    for (Frontier::SceneFigure& Candidate : Host.Document().Figures())
                        if (Candidate.Identity == Figure.Identity)
                            Candidate.Selected = true;
                    SceneChanged = true;
                }
                ImGui::SameLine();
                ImGui::TextDisabled("%s", Kind);
                ImGui::PopID();
            }
            ImGui::EndChild();
            ImGui::EndTable();
        }

        ImGui::Separator();
        if (State.ActiveTile >= 0 && State.AnchorSet)
            ImGui::TextColored(ImVec4(0.98f, 0.70f, 0.34f, 1.0f), "Anchor X %.3f   Y %.3f   Z %.3f  ·  Enter to place  ·  Esc to cancel",
                State.Anchor.X, State.Anchor.Y, State.Anchor.Z);
        else if (State.ActiveTile >= 0 && State.CursorValid)
            ImGui::TextColored(ImVec4(0.36f, 0.85f, 0.89f, 1.0f), "X %.3f   Y %.3f   Z %.3f  ·  click to set anchor, then Enter",
                State.Cursor.X, State.Cursor.Y, State.Cursor.Z);
        else
            ImGui::TextDisabled("Perspective · Isometric · Z-up · 10 mm lattice     LMB click selects / places · LMB drag orbits · Shift+LMB pans · wheel dollies");
        ImGui::TextDisabled("%s", State.Status.c_str());
    }
    ImGui::End();
    ImGui::PopStyleVar(2);

    if (State.ActiveTile >= 0 && !IO.WantTextInput && !State.ConstructPopupOpen)
    {
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false))
        {
            State.ActiveTile = -1;
            State.AnchorSet = false;
            State.CursorValid = false;
            State.Status = "Construction cancelled.";
        }
        else if (ImGui::IsKeyPressed(ImGuiKey_Enter, false) && State.AnchorSet)
        {
            const size_t Before = Host.AllFigures().size();
            const std::string Command = Frontier::BuildSolidArcConstructCommand(
                static_cast<uint32_t>(State.ActiveTile), State.Anchor.X, State.Anchor.Y);
            if (!Command.empty() && Host.Execute(Command) && Host.AllFigures().size() > Before)
            {
                Host.Document().ClearSelection();
                Host.Document().Figures().back().Selected = true;
                const std::string Label = Frontier::kSolidArcConstructTiles[static_cast<size_t>(State.ActiveTile)].Label;
                State.Status = "Placed " + Label + " at the chosen XY anchor.";
                SceneChanged = true;
            }
            else
                State.Status = "Placement failed; see the SolidArc console output for the command refusal.";
            State.ActiveTile = -1;
            State.AnchorSet = false;
            State.CursorValid = false;
        }
    }
    return SceneChanged;
}

void StyleImGui() noexcept
{
    ImGui::StyleColorsDark();
    ImGuiStyle& Style = ImGui::GetStyle();
    Style.WindowPadding = ImVec2(10.0f, 8.0f);
    Style.FramePadding = ImVec2(10.0f, 6.0f);
    Style.ItemSpacing = ImVec2(8.0f, 7.0f);
    Style.WindowRounding = 8.0f;
    Style.ChildRounding = 7.0f;
    Style.FrameRounding = 5.0f;
    Style.PopupRounding = 7.0f;
    Style.ScrollbarSize = 9.0f;
    ImVec4* Colours = Style.Colors;
    Colours[ImGuiCol_WindowBg] = ImVec4(0.045f, 0.052f, 0.064f, 1.0f);
    Colours[ImGuiCol_ChildBg] = ImVec4(0.027f, 0.032f, 0.041f, 1.0f);
    Colours[ImGuiCol_Border] = ImVec4(0.19f, 0.23f, 0.27f, 0.75f);
    Colours[ImGuiCol_FrameBg] = ImVec4(0.085f, 0.098f, 0.112f, 1.0f);
    Colours[ImGuiCol_Button] = ImVec4(0.095f, 0.13f, 0.15f, 1.0f);
    Colours[ImGuiCol_ButtonHovered] = ImVec4(0.13f, 0.27f, 0.29f, 1.0f);
    Colours[ImGuiCol_ButtonActive] = ImVec4(0.14f, 0.34f, 0.36f, 1.0f);
    Colours[ImGuiCol_Header] = ImVec4(0.12f, 0.25f, 0.27f, 0.8f);
    Colours[ImGuiCol_HeaderHovered] = ImVec4(0.14f, 0.33f, 0.36f, 0.95f);
    Colours[ImGuiCol_HeaderActive] = ImVec4(0.15f, 0.40f, 0.42f, 1.0f);
    Colours[ImGuiCol_Tab] = ImVec4(0.08f, 0.12f, 0.14f, 1.0f);
    Colours[ImGuiCol_TabHovered] = ImVec4(0.14f, 0.32f, 0.35f, 1.0f);
    Colours[ImGuiCol_TabSelected] = ImVec4(0.12f, 0.27f, 0.30f, 1.0f);
}

} // namespace

int main()
{
    if (glfwInit() != GLFW_TRUE)
    {
        std::fprintf(stderr, "[SolidArc] GLFW initialization failed.\n");
        return 1;
    }
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE);
    GLFWwindow* Window = glfwCreateWindow(1440, 920, "SolidArc — Vulkan CAD", nullptr, nullptr);
    if (Window == nullptr)
    {
        std::fprintf(stderr, "[SolidArc] GLFW could not create a Vulkan window.\n");
        glfwTerminate();
        return 1;
    }

    VulkanPresenter Vulkan;
    bool ImGuiContextReady = false;
    int ExitCode = 0;
    try
    {
        Vulkan.Initialize(Window);
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiContextReady = true;
        StyleImGui();
        ImGuiIO& IO = ImGui::GetIO();
        IO.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        Vulkan.InitializeImGuiBackends();

        const std::string ProofFolder = (std::filesystem::temp_directory_path() / "SolidArcProofs").string();
        Frontier::ConsoleHost Host(ProofFolder, 768u, 512u);
        Host.AssignLatticeCell(0.01);
        Host.Render();
        Vulkan.CreateCanvasTexture(Host.Raster().Readback());
        StandaloneState State{};
        State.SceneDirty = false;

        while (glfwWindowShouldClose(Window) == GLFW_FALSE)
        {
            glfwPollEvents();
            ImGui_ImplVulkan_NewFrame();
            ImGui_ImplGlfw_NewFrame();
            ImGui::NewFrame();
            HandleConstructHotkeys(State);
            const bool SceneChanged = DrawStandaloneUi(Host, Vulkan, State);
            if (SceneChanged || State.SceneDirty)
            {
                Host.Render();
                Vulkan.UploadCanvas(Host.Raster().Readback());
                State.SceneDirty = false;
            }
            ImGui::Render();
            Vulkan.Render(ImGui::GetDrawData());
        }
    }
    catch (const std::exception& Error)
    {
        std::fprintf(stderr, "[SolidArc] %s\n", Error.what());
        ExitCode = 1;
    }

    if (ImGuiContextReady)
    {
        Vulkan.ShutdownImGuiBackends();
        ImGui::DestroyContext();
    }
    Vulkan.Destroy();
    glfwDestroyWindow(Window);
    glfwTerminate();
    return ExitCode;
}
