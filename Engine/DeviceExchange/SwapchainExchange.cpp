//============================================================================================================================================
//                                                     SWAPCHAINEXCHANGE.CPP
//============================================================================================================================================
// 🧩 Vulkan instance, surface, device, swapchain and recording-slot transport across the hardware vendor edge.

#include <vulkan/vulkan.h>

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>

#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_vulkan.h>

#include <thorvg.h>

#include "SwapchainExchange.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           CONSTANTS AND INTERNAL LIMITS
//------------------------------------------------------------------------------------------------------------------------

static constexpr uint32_t kCycleSlotCount  = 2u;
static constexpr uint32_t kLocalGroupSizeX = 16u;
static constexpr uint32_t kLocalGroupSizeY = 16u;

//------------------------------------------------------------------------------------------------------------------------
//                                              VULKAN RECORD DEFINITION
//------------------------------------------------------------------------------------------------------------------------

struct SwapchainExchange::VulkanRecord
{
    // ── Instance and surface ──────────────────────────────────────────────────────────────────────────────────────────
    VkInstance               Instance              = VK_NULL_HANDLE;
    VkDebugUtilsMessengerEXT DebugMessenger        = VK_NULL_HANDLE;
    VkSurfaceKHR             Surface               = VK_NULL_HANDLE;

    // ── Physical and logical device ───────────────────────────────────────────────────────────────────────────────────
    VkPhysicalDevice                  PhysicalDevice  = VK_NULL_HANDLE;
    VkDevice                          Device          = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties  MemoryProperties{};
    uint32_t                          GraphicsFamily  = 0u;
    uint32_t                          ComputeFamily   = 0u;
    VkQueue                           GraphicsQueue   = VK_NULL_HANDLE;
    VkQueue                           ComputeQueue    = VK_NULL_HANDLE;

    // ── Swapchain ─────────────────────────────────────────────────────────────────────────────────────────────────────
    VkSwapchainKHR           Swapchain             = VK_NULL_HANDLE;
    VkFormat                 SwapchainFormat       = VK_FORMAT_UNDEFINED;
    VkExtent2D               SwapchainExtent       = {};
    std::vector<VkImage>     SwapchainImages;
    std::vector<VkImageView> SwapchainImageViews;

    // ── Storage image (compute writes; blit to swapchain) ────────────────────────────────────────────────────────────
    VkImage                  StorageImage          = VK_NULL_HANDLE;
    VkDeviceMemory           StorageMemory         = VK_NULL_HANDLE;
    VkImageView              StorageImageView      = VK_NULL_HANDLE;

    // ── Scene SSBO geometry and materials ────────────────────────────────────────────────────────────────────────────
    VkBuffer                 TriangleBuffer        = VK_NULL_HANDLE;
    VkDeviceMemory           TriangleMemory        = VK_NULL_HANDLE;
    VkBuffer                 MaterialBuffer        = VK_NULL_HANDLE;
    VkDeviceMemory           MaterialMemory        = VK_NULL_HANDLE;
    uint32_t                 TriangleCount         = 0u;
    uint32_t                 MaterialCount         = 0u;

    // ── Compute pipeline ──────────────────────────────────────────────────────────────────────────────────────────────
    VkDescriptorSetLayout    ComputeDescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool         ComputeDescriptorPool   = VK_NULL_HANDLE;
    VkDescriptorSet          ComputeDescriptorSet    = VK_NULL_HANDLE;
    VkPipelineLayout         ComputePipelineLayout   = VK_NULL_HANDLE;
    VkPipeline               ComputePipeline         = VK_NULL_HANDLE;

    // ── Command recording ─────────────────────────────────────────────────────────────────────────────────────────────
    VkCommandPool                ComputeCommandPool = VK_NULL_HANDLE;
    std::vector<VkCommandBuffer> ComputeCommands;

    // ── ImGui render pass and framebuffers ───────────────────────────────────────────────────────────────────────────
    VkDescriptorPool         ImGuiDescriptorPool   = VK_NULL_HANDLE;
    VkRenderPass             ImGuiRenderPass       = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> ImGuiFramebuffers;

    // ── Cycle slots (one fence + two semaphores per slot) ────────────────────────────────────────────────────────────
    std::array<VkSemaphore, kCycleSlotCount> AcquireSemaphores = {};
    std::array<VkSemaphore, kCycleSlotCount> ReleaseSemaphores = {};
    std::array<VkFence,     kCycleSlotCount> CycleFences       = {};
    std::vector<VkFence>                     ImageOrdinalFences;  // [-]  per-image in-flight fence pointer
    uint32_t                                 ActiveSlot         = 0u;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  VALIDATION CALLBACK
//------------------------------------------------------------------------------------------------------------------------

static VKAPI_ATTR VkBool32 VKAPI_CALL ValidationCallback(
    VkDebugUtilsMessageSeverityFlagBitsEXT,
    VkDebugUtilsMessageTypeFlagsEXT,
    const VkDebugUtilsMessengerCallbackDataEXT* CallbackData,
    void*) noexcept
{
    std::cerr << "[SwapchainExchange] Validation: " << CallbackData->pMessage << "\n";
    return VK_FALSE;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               SPIRV LOADER
//------------------------------------------------------------------------------------------------------------------------

static std::vector<uint32_t> LoadSpirv(const std::string& Path)
{
    std::ifstream File(Path, std::ios::binary | std::ios::ate);
    if (!File.is_open())
    {
        std::cerr << "[SwapchainExchange] Cannot open SPIR-V: " << Path << "\n";
        return {};
    }
    const std::streamsize ByteCount = File.tellg();
    std::vector<uint32_t> Spirv(static_cast<size_t>(ByteCount) / 4u);
    File.seekg(0);
    File.read(reinterpret_cast<char*>(Spirv.data()), ByteCount);
    return Spirv;
}

//------------------------------------------------------------------------------------------------------------------------
//                                         BUFFER ALLOCATION HELPER
//------------------------------------------------------------------------------------------------------------------------

static void AllocateBuffer(
    VkDevice                           Device,
    VkPhysicalDeviceMemoryProperties&  MemoryProperties,
    VkDeviceSize                       ByteCount,
    VkBufferUsageFlags                 UsageFlags,
    uint32_t                           MemoryFlags,
    VkBuffer&                          OutBuffer,
    VkDeviceMemory&                    OutMemory) noexcept
{
    VkBufferCreateInfo BufferInfo{};
    BufferInfo.sType       = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    BufferInfo.size        = ByteCount;
    BufferInfo.usage       = UsageFlags;
    BufferInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    (void)vkCreateBuffer(Device, &BufferInfo, nullptr, &OutBuffer);

    VkMemoryRequirements Requirements{};
    vkGetBufferMemoryRequirements(Device, OutBuffer, &Requirements);

    VkMemoryAllocateInfo AllocateInfo{};
    AllocateInfo.sType          = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    AllocateInfo.allocationSize = Requirements.size;
    for (uint32_t Index = 0u; Index < MemoryProperties.memoryTypeCount; ++Index)
    {
        if ((Requirements.memoryTypeBits & (1u << Index)) &&
            (MemoryProperties.memoryTypes[Index].propertyFlags & MemoryFlags) ==
             static_cast<VkMemoryPropertyFlags>(MemoryFlags))
        {
            AllocateInfo.memoryTypeIndex = Index;
            break;
        }
    }
    (void)vkAllocateMemory(Device, &AllocateInfo, nullptr, &OutMemory);
    vkBindBufferMemory(Device, OutBuffer, OutMemory, 0);
}

//============================================================================================================================================
//                                                     LIFECYCLE
//============================================================================================================================================

SwapchainExchange::SwapchainExchange(const SwapchainConfiguration& InitialConfiguration) noexcept
    : Vulkan(new VulkanRecord{})
    , GlfwWindow(nullptr)
    , Configuration(InitialConfiguration)
    , ResizePending(false)
    , ForwardInput(nullptr)
    , PreviousCursorX(0.0)
    , PreviousCursorY(0.0)
    , CursorInitialised(false)
{
}

SwapchainExchange::~SwapchainExchange() noexcept
{
    Retire();
    delete Vulkan;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       BRING
//------------------------------------------------------------------------------------------------------------------------

bool SwapchainExchange::Bring() noexcept
{
    if (!glfwInit())
    {
        std::cerr << "[SwapchainExchange] glfwInit failed.\n";
        return false;
    }

    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE,  GLFW_TRUE);

    GlfwWindow = glfwCreateWindow(
        static_cast<int>(Configuration.Width),
        static_cast<int>(Configuration.Height),
        Configuration.Title ? Configuration.Title : "Frontier",
        nullptr, nullptr);

    if (!GlfwWindow)
    {
        std::cerr << "[SwapchainExchange] glfwCreateWindow failed.\n";
        return false;
    }

    glfwSetWindowUserPointer      (GlfwWindow, this);
    glfwSetKeyCallback            (GlfwWindow, OnKey);
    glfwSetMouseButtonCallback    (GlfwWindow, OnMouseButton);
    glfwSetCursorPosCallback      (GlfwWindow, OnCursorMove);
    glfwSetScrollCallback         (GlfwWindow, OnScroll);
    glfwSetFramebufferSizeCallback(GlfwWindow, OnFramebuffer);

    tvg::Initializer::init(0u);

    return BringInstance()
        && BringSurface()
        && BringPhysicalDevice()
        && BringLogicalDevice()
        && BringSwapchain()
        && BringStorageImage()
        && BringCommandRecording()
        && BringComputePipeline()
        && BringDescriptorSet()
        && BringCycleSlots()
        && BringImGui();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RETIRE
//------------------------------------------------------------------------------------------------------------------------

void SwapchainExchange::Retire() noexcept
{
    if (!Vulkan || !Vulkan->Device) return;

    vkDeviceWaitIdle(Vulkan->Device);

    ImGui_ImplVulkan_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    for (auto& Framebuffer : Vulkan->ImGuiFramebuffers)
        if (Framebuffer) vkDestroyFramebuffer(Vulkan->Device, Framebuffer, nullptr);
    if (Vulkan->ImGuiRenderPass)     vkDestroyRenderPass     (Vulkan->Device, Vulkan->ImGuiRenderPass,     nullptr);
    if (Vulkan->ImGuiDescriptorPool) vkDestroyDescriptorPool (Vulkan->Device, Vulkan->ImGuiDescriptorPool, nullptr);

    RetireSwapchain();

    if (Vulkan->TriangleBuffer)  vkDestroyBuffer (Vulkan->Device, Vulkan->TriangleBuffer, nullptr);
    if (Vulkan->TriangleMemory)  vkFreeMemory    (Vulkan->Device, Vulkan->TriangleMemory, nullptr);
    if (Vulkan->MaterialBuffer)  vkDestroyBuffer (Vulkan->Device, Vulkan->MaterialBuffer, nullptr);
    if (Vulkan->MaterialMemory)  vkFreeMemory    (Vulkan->Device, Vulkan->MaterialMemory, nullptr);

    for (uint32_t Slot = 0u; Slot < kCycleSlotCount; ++Slot)
    {
        if (Vulkan->AcquireSemaphores[Slot]) vkDestroySemaphore(Vulkan->Device, Vulkan->AcquireSemaphores[Slot], nullptr);
        if (Vulkan->ReleaseSemaphores[Slot]) vkDestroySemaphore(Vulkan->Device, Vulkan->ReleaseSemaphores[Slot], nullptr);
        if (Vulkan->CycleFences[Slot])       vkDestroyFence    (Vulkan->Device, Vulkan->CycleFences[Slot],       nullptr);
    }

    if (Vulkan->ComputeCommandPool)    vkDestroyCommandPool       (Vulkan->Device, Vulkan->ComputeCommandPool,    nullptr);
    if (Vulkan->ComputePipeline)       vkDestroyPipeline          (Vulkan->Device, Vulkan->ComputePipeline,       nullptr);
    if (Vulkan->ComputePipelineLayout) vkDestroyPipelineLayout    (Vulkan->Device, Vulkan->ComputePipelineLayout, nullptr);
    if (Vulkan->ComputeDescriptorPool) vkDestroyDescriptorPool    (Vulkan->Device, Vulkan->ComputeDescriptorPool, nullptr);
    if (Vulkan->ComputeDescriptorLayout) vkDestroyDescriptorSetLayout(Vulkan->Device, Vulkan->ComputeDescriptorLayout, nullptr);

    if (Vulkan->Device)   vkDestroyDevice             (Vulkan->Device,             nullptr);
    if (Vulkan->Surface)  vkDestroySurfaceKHR          (Vulkan->Instance, Vulkan->Surface, nullptr);
    if (Vulkan->Instance) vkDestroyInstance            (Vulkan->Instance,           nullptr);

    tvg::Initializer::term();

    if (GlfwWindow) glfwDestroyWindow(GlfwWindow);
    glfwTerminate();
    GlfwWindow = nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               RETIRE SWAPCHAIN  (inner)
//------------------------------------------------------------------------------------------------------------------------

void SwapchainExchange::RetireSwapchain() noexcept
{
    if (Vulkan->StorageImageView)  vkDestroyImageView(Vulkan->Device, Vulkan->StorageImageView,  nullptr);
    if (Vulkan->StorageImage)      vkDestroyImage    (Vulkan->Device, Vulkan->StorageImage,      nullptr);
    if (Vulkan->StorageMemory)     vkFreeMemory      (Vulkan->Device, Vulkan->StorageMemory,     nullptr);
    Vulkan->StorageImageView = VK_NULL_HANDLE;
    Vulkan->StorageImage     = VK_NULL_HANDLE;
    Vulkan->StorageMemory    = VK_NULL_HANDLE;

    for (auto& ImageView : Vulkan->SwapchainImageViews)
        if (ImageView) vkDestroyImageView(Vulkan->Device, ImageView, nullptr);
    Vulkan->SwapchainImageViews.clear();

    if (Vulkan->Swapchain) vkDestroySwapchainKHR(Vulkan->Device, Vulkan->Swapchain, nullptr);
    Vulkan->Swapchain = VK_NULL_HANDLE;
}

//============================================================================================================================================
//                                                   BRING-UP STAGES
//============================================================================================================================================

bool SwapchainExchange::BringInstance() noexcept
{
    VkApplicationInfo ApplicationInfo{};
    ApplicationInfo.sType              = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    ApplicationInfo.pApplicationName   = Configuration.Title;
    ApplicationInfo.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    ApplicationInfo.pEngineName        = "Frontier";
    ApplicationInfo.engineVersion      = VK_MAKE_VERSION(1, 0, 0);
    ApplicationInfo.apiVersion         = VK_API_VERSION_1_2;

    uint32_t     GlfwExtensionCount = 0u;
    const char** GlfwExtensions     = glfwGetRequiredInstanceExtensions(&GlfwExtensionCount);

    std::vector<const char*> Extensions(GlfwExtensions, GlfwExtensions + GlfwExtensionCount);
    std::vector<const char*> Layers;

    if (Configuration.ValidationEnabled)
    {
        Extensions.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
        Layers.push_back("VK_LAYER_KHRONOS_validation");
    }

    VkInstanceCreateInfo InstanceInfo{};
    InstanceInfo.sType                   = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    InstanceInfo.pApplicationInfo        = &ApplicationInfo;
    InstanceInfo.enabledExtensionCount   = static_cast<uint32_t>(Extensions.size());
    InstanceInfo.ppEnabledExtensionNames = Extensions.data();
    InstanceInfo.enabledLayerCount       = static_cast<uint32_t>(Layers.size());
    InstanceInfo.ppEnabledLayerNames     = Layers.data();

    if (vkCreateInstance(&InstanceInfo, nullptr, &Vulkan->Instance) != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] vkCreateInstance failed.\n";
        return false;
    }

    if (Configuration.ValidationEnabled)
    {
        auto CreateMessenger = reinterpret_cast<PFN_vkCreateDebugUtilsMessengerEXT>(
            vkGetInstanceProcAddr(Vulkan->Instance, "vkCreateDebugUtilsMessengerEXT"));

        if (CreateMessenger)
        {
            VkDebugUtilsMessengerCreateInfoEXT MessengerInfo{};
            MessengerInfo.sType           = VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT;
            MessengerInfo.messageSeverity = VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT
                                          | VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT;
            MessengerInfo.messageType     = VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT
                                          | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
            MessengerInfo.pfnUserCallback = ValidationCallback;
            CreateMessenger(Vulkan->Instance, &MessengerInfo, nullptr, &Vulkan->DebugMessenger);
        }
    }

    return true;
}

bool SwapchainExchange::BringSurface() noexcept
{
    if (glfwCreateWindowSurface(Vulkan->Instance, GlfwWindow, nullptr, &Vulkan->Surface) != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] glfwCreateWindowSurface failed.\n";
        return false;
    }
    return true;
}

bool SwapchainExchange::BringPhysicalDevice() noexcept
{
    uint32_t DeviceCount = 0u;
    vkEnumeratePhysicalDevices(Vulkan->Instance, &DeviceCount, nullptr);
    if (DeviceCount == 0u)
    {
        std::cerr << "[SwapchainExchange] No Vulkan physical devices found.\n";
        return false;
    }

    std::vector<VkPhysicalDevice> Devices(DeviceCount);
    vkEnumeratePhysicalDevices(Vulkan->Instance, &DeviceCount, Devices.data());

    Vulkan->PhysicalDevice = Devices[0];
    for (const auto& Candidate : Devices)
    {
        VkPhysicalDeviceProperties Properties{};
        vkGetPhysicalDeviceProperties(Candidate, &Properties);
        if (Properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU)
        {
            Vulkan->PhysicalDevice = Candidate;
            break;
        }
    }

    vkGetPhysicalDeviceMemoryProperties(Vulkan->PhysicalDevice, &Vulkan->MemoryProperties);

    uint32_t FamilyCount = 0u;
    vkGetPhysicalDeviceQueueFamilyProperties(Vulkan->PhysicalDevice, &FamilyCount, nullptr);
    std::vector<VkQueueFamilyProperties> Families(FamilyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(Vulkan->PhysicalDevice, &FamilyCount, Families.data());

    for (uint32_t Index = 0u; Index < FamilyCount; ++Index)
    {
        VkBool32 PresentCapable = VK_FALSE;
        vkGetPhysicalDeviceSurfaceSupportKHR(Vulkan->PhysicalDevice, Index, Vulkan->Surface, &PresentCapable);
        if ((Families[Index].queueFlags & VK_QUEUE_GRAPHICS_BIT) && PresentCapable)
            Vulkan->GraphicsFamily = Index;
        if (Families[Index].queueFlags & VK_QUEUE_COMPUTE_BIT)
            Vulkan->ComputeFamily = Index;
    }

    return true;
}

bool SwapchainExchange::BringLogicalDevice() noexcept
{
    float Priority = 1.0f;

    std::vector<VkDeviceQueueCreateInfo> QueueInfoList;
    auto AddQueueFamily = [&](uint32_t Family)
    {
        for (const auto& Existing : QueueInfoList)
            if (Existing.queueFamilyIndex == Family) return;

        VkDeviceQueueCreateInfo QueueInfo{};
        QueueInfo.sType            = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        QueueInfo.queueFamilyIndex = Family;
        QueueInfo.queueCount       = 1u;
        QueueInfo.pQueuePriorities = &Priority;
        QueueInfoList.push_back(QueueInfo);
    };

    AddQueueFamily(Vulkan->GraphicsFamily);
    AddQueueFamily(Vulkan->ComputeFamily);

    const char* DeviceExtensions[] = { VK_KHR_SWAPCHAIN_EXTENSION_NAME };

    VkPhysicalDeviceFeatures DeviceFeatures{};
    DeviceFeatures.shaderStorageImageWriteWithoutFormat = VK_TRUE;

    VkDeviceCreateInfo DeviceInfo{};
    DeviceInfo.sType                   = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    DeviceInfo.queueCreateInfoCount    = static_cast<uint32_t>(QueueInfoList.size());
    DeviceInfo.pQueueCreateInfos       = QueueInfoList.data();
    DeviceInfo.enabledExtensionCount   = 1u;
    DeviceInfo.ppEnabledExtensionNames = DeviceExtensions;
    DeviceInfo.pEnabledFeatures        = &DeviceFeatures;

    if (vkCreateDevice(Vulkan->PhysicalDevice, &DeviceInfo, nullptr, &Vulkan->Device) != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] vkCreateDevice failed.\n";
        return false;
    }

    vkGetDeviceQueue(Vulkan->Device, Vulkan->GraphicsFamily, 0u, &Vulkan->GraphicsQueue);
    vkGetDeviceQueue(Vulkan->Device, Vulkan->ComputeFamily,  0u, &Vulkan->ComputeQueue);
    return true;
}

bool SwapchainExchange::BringSwapchain() noexcept
{
    VkSurfaceCapabilitiesKHR SurfaceCapabilities{};
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(Vulkan->PhysicalDevice, Vulkan->Surface, &SurfaceCapabilities);

    uint32_t FormatCount = 0u;
    vkGetPhysicalDeviceSurfaceFormatsKHR(Vulkan->PhysicalDevice, Vulkan->Surface, &FormatCount, nullptr);
    std::vector<VkSurfaceFormatKHR> SurfaceFormats(FormatCount);
    vkGetPhysicalDeviceSurfaceFormatsKHR(Vulkan->PhysicalDevice, Vulkan->Surface, &FormatCount, SurfaceFormats.data());

    VkSurfaceFormatKHR ChosenFormat = SurfaceFormats[0];
    for (const auto& Candidate : SurfaceFormats)
    {
        if (Candidate.format     == VK_FORMAT_B8G8R8A8_UNORM &&
            Candidate.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR)
        {
            ChosenFormat = Candidate;
            break;
        }
    }

    Vulkan->SwapchainFormat = ChosenFormat.format;

    if (SurfaceCapabilities.currentExtent.width != UINT32_MAX)
    {
        Vulkan->SwapchainExtent = SurfaceCapabilities.currentExtent;
    }
    else
    {
        int FramebufferW = 0, FramebufferH = 0;
        glfwGetFramebufferSize(GlfwWindow, &FramebufferW, &FramebufferH);
        Vulkan->SwapchainExtent.width  = std::clamp(
            static_cast<uint32_t>(FramebufferW),
            SurfaceCapabilities.minImageExtent.width,
            SurfaceCapabilities.maxImageExtent.width);
        Vulkan->SwapchainExtent.height = std::clamp(
            static_cast<uint32_t>(FramebufferH),
            SurfaceCapabilities.minImageExtent.height,
            SurfaceCapabilities.maxImageExtent.height);
    }

    Configuration.Width  = Vulkan->SwapchainExtent.width;
    Configuration.Height = Vulkan->SwapchainExtent.height;

    uint32_t ImageCount = SurfaceCapabilities.minImageCount + 1u;
    if (SurfaceCapabilities.maxImageCount > 0u)
        ImageCount = std::min(ImageCount, SurfaceCapabilities.maxImageCount);

    VkSwapchainCreateInfoKHR SwapchainInfo{};
    SwapchainInfo.sType            = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    SwapchainInfo.surface          = Vulkan->Surface;
    SwapchainInfo.minImageCount    = ImageCount;
    SwapchainInfo.imageFormat      = ChosenFormat.format;
    SwapchainInfo.imageColorSpace  = ChosenFormat.colorSpace;
    SwapchainInfo.imageExtent      = Vulkan->SwapchainExtent;
    SwapchainInfo.imageArrayLayers = 1u;
    SwapchainInfo.imageUsage       = VK_IMAGE_USAGE_STORAGE_BIT
                                   | VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT
                                   | VK_IMAGE_USAGE_TRANSFER_DST_BIT;

    uint32_t SharedFamilies[] = { Vulkan->GraphicsFamily, Vulkan->ComputeFamily };
    if (Vulkan->GraphicsFamily != Vulkan->ComputeFamily)
    {
        SwapchainInfo.imageSharingMode      = VK_SHARING_MODE_CONCURRENT;
        SwapchainInfo.queueFamilyIndexCount = 2u;
        SwapchainInfo.pQueueFamilyIndices   = SharedFamilies;
    }
    else
    {
        SwapchainInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    }

    SwapchainInfo.preTransform   = SurfaceCapabilities.currentTransform;
    SwapchainInfo.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    SwapchainInfo.presentMode    = VK_PRESENT_MODE_FIFO_KHR;
    SwapchainInfo.clipped        = VK_TRUE;

    if (vkCreateSwapchainKHR(Vulkan->Device, &SwapchainInfo, nullptr, &Vulkan->Swapchain) != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] vkCreateSwapchainKHR failed.\n";
        return false;
    }

    uint32_t ActualImageCount = 0u;
    (void)vkGetSwapchainImagesKHR(Vulkan->Device, Vulkan->Swapchain, &ActualImageCount, nullptr);
    Vulkan->SwapchainImages.resize(ActualImageCount);
    (void)vkGetSwapchainImagesKHR(Vulkan->Device, Vulkan->Swapchain, &ActualImageCount, Vulkan->SwapchainImages.data());

    Vulkan->SwapchainImageViews.resize(ActualImageCount);
    for (uint32_t Index = 0u; Index < ActualImageCount; ++Index)
    {
        VkImageViewCreateInfo ImageViewInfo{};
        ImageViewInfo.sType                           = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        ImageViewInfo.image                           = Vulkan->SwapchainImages[Index];
        ImageViewInfo.viewType                        = VK_IMAGE_VIEW_TYPE_2D;
        ImageViewInfo.format                          = Vulkan->SwapchainFormat;
        ImageViewInfo.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
        ImageViewInfo.subresourceRange.baseMipLevel   = 0u;
        ImageViewInfo.subresourceRange.levelCount     = 1u;
        ImageViewInfo.subresourceRange.baseArrayLayer = 0u;
        ImageViewInfo.subresourceRange.layerCount     = 1u;
        (void)vkCreateImageView(Vulkan->Device, &ImageViewInfo, nullptr, &Vulkan->SwapchainImageViews[Index]);
    }

    Vulkan->ImageOrdinalFences.assign(ActualImageCount, VK_NULL_HANDLE);
    return true;
}

bool SwapchainExchange::BringStorageImage() noexcept
{
    VkImageCreateInfo ImageInfo{};
    ImageInfo.sType         = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ImageInfo.imageType     = VK_IMAGE_TYPE_2D;
    ImageInfo.format        = VK_FORMAT_R8G8B8A8_UNORM;
    ImageInfo.extent        = { Configuration.Width, Configuration.Height, 1u };
    ImageInfo.mipLevels     = 1u;
    ImageInfo.arrayLayers   = 1u;
    ImageInfo.samples       = VK_SAMPLE_COUNT_1_BIT;
    ImageInfo.tiling        = VK_IMAGE_TILING_OPTIMAL;
    ImageInfo.usage         = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    ImageInfo.sharingMode   = VK_SHARING_MODE_EXCLUSIVE;
    ImageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    (void)vkCreateImage(Vulkan->Device, &ImageInfo, nullptr, &Vulkan->StorageImage);

    VkMemoryRequirements Requirements{};
    vkGetImageMemoryRequirements(Vulkan->Device, Vulkan->StorageImage, &Requirements);

    VkMemoryAllocateInfo AllocateInfo{};
    AllocateInfo.sType           = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    AllocateInfo.allocationSize  = Requirements.size;
    AllocateInfo.memoryTypeIndex = ResolveMemoryType(Requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    (void)vkAllocateMemory(Vulkan->Device, &AllocateInfo, nullptr, &Vulkan->StorageMemory);
    vkBindImageMemory(Vulkan->Device, Vulkan->StorageImage, Vulkan->StorageMemory, 0);

    VkImageViewCreateInfo ViewInfo{};
    ViewInfo.sType                           = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    ViewInfo.image                           = Vulkan->StorageImage;
    ViewInfo.viewType                        = VK_IMAGE_VIEW_TYPE_2D;
    ViewInfo.format                          = VK_FORMAT_R8G8B8A8_UNORM;
    ViewInfo.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
    ViewInfo.subresourceRange.levelCount     = 1u;
    ViewInfo.subresourceRange.layerCount     = 1u;
    (void)vkCreateImageView(Vulkan->Device, &ViewInfo, nullptr, &Vulkan->StorageImageView);

    return true;
}

bool SwapchainExchange::BringCommandRecording() noexcept
{
    VkCommandPoolCreateInfo PoolInfo{};
    PoolInfo.sType            = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    PoolInfo.flags            = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    PoolInfo.queueFamilyIndex = Vulkan->ComputeFamily;

    if (vkCreateCommandPool(Vulkan->Device, &PoolInfo, nullptr, &Vulkan->ComputeCommandPool) != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] vkCreateCommandPool failed.\n";
        return false;
    }

    const uint32_t ImageCount = static_cast<uint32_t>(Vulkan->SwapchainImages.size());
    Vulkan->ComputeCommands.resize(ImageCount);

    VkCommandBufferAllocateInfo AllocateInfo{};
    AllocateInfo.sType              = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    AllocateInfo.commandPool        = Vulkan->ComputeCommandPool;
    AllocateInfo.level              = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    AllocateInfo.commandBufferCount = ImageCount;
    (void)vkAllocateCommandBuffers(Vulkan->Device, &AllocateInfo, Vulkan->ComputeCommands.data());

    return true;
}

bool SwapchainExchange::BringComputePipeline() noexcept
{
    // ① Descriptor set layout — binding 0: storage image, 1: triangle SSBO, 2: material SSBO
    std::array<VkDescriptorSetLayoutBinding, 3u> LayoutBindings{};
    LayoutBindings[0].binding         = 0u;
    LayoutBindings[0].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    LayoutBindings[0].descriptorCount = 1u;
    LayoutBindings[0].stageFlags      = VK_SHADER_STAGE_COMPUTE_BIT;
    LayoutBindings[1].binding         = 1u;
    LayoutBindings[1].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    LayoutBindings[1].descriptorCount = 1u;
    LayoutBindings[1].stageFlags      = VK_SHADER_STAGE_COMPUTE_BIT;
    LayoutBindings[2].binding         = 2u;
    LayoutBindings[2].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    LayoutBindings[2].descriptorCount = 1u;
    LayoutBindings[2].stageFlags      = VK_SHADER_STAGE_COMPUTE_BIT;

    VkDescriptorSetLayoutCreateInfo LayoutInfo{};
    LayoutInfo.sType        = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    LayoutInfo.bindingCount = 3u;
    LayoutInfo.pBindings    = LayoutBindings.data();
    (void)vkCreateDescriptorSetLayout(Vulkan->Device, &LayoutInfo, nullptr, &Vulkan->ComputeDescriptorLayout);

    // ② Push constant range — matches DispatchConfiguration exactly (80 bytes)
    VkPushConstantRange PushRange{};
    PushRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    PushRange.offset     = 0u;
    PushRange.size       = static_cast<uint32_t>(sizeof(DispatchConfiguration));

    VkPipelineLayoutCreateInfo PipelineLayoutInfo{};
    PipelineLayoutInfo.sType                  = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    PipelineLayoutInfo.setLayoutCount         = 1u;
    PipelineLayoutInfo.pSetLayouts            = &Vulkan->ComputeDescriptorLayout;
    PipelineLayoutInfo.pushConstantRangeCount = 1u;
    PipelineLayoutInfo.pPushConstantRanges    = &PushRange;
    (void)vkCreatePipelineLayout(Vulkan->Device, &PipelineLayoutInfo, nullptr, &Vulkan->ComputePipelineLayout);

    // ③ Load SPIR-V — expected at Shaders/ReSTIRViewport.spv relative to working directory
    const std::vector<uint32_t> Spirv = LoadSpirv("Engine/Shaders/ReSTIRViewport.spv");
    if (Spirv.empty()) return false;

    VkShaderModuleCreateInfo ShaderModuleInfo{};
    ShaderModuleInfo.sType    = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ShaderModuleInfo.codeSize = Spirv.size() * 4u;
    ShaderModuleInfo.pCode    = Spirv.data();
    VkShaderModule ShaderModule = VK_NULL_HANDLE;
    (void)vkCreateShaderModule(Vulkan->Device, &ShaderModuleInfo, nullptr, &ShaderModule);

    VkComputePipelineCreateInfo ComputeInfo{};
    ComputeInfo.sType        = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    ComputeInfo.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    ComputeInfo.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
    ComputeInfo.stage.module = ShaderModule;
    ComputeInfo.stage.pName  = "main";
    ComputeInfo.layout       = Vulkan->ComputePipelineLayout;

    const VkResult PipelineResult = vkCreateComputePipelines(
        Vulkan->Device, VK_NULL_HANDLE, 1u, &ComputeInfo, nullptr, &Vulkan->ComputePipeline);
    vkDestroyShaderModule(Vulkan->Device, ShaderModule, nullptr);

    if (PipelineResult != VK_SUCCESS)
    {
        std::cerr << "[SwapchainExchange] vkCreateComputePipelines failed.\n";
        return false;
    }
    return true;
}

bool SwapchainExchange::BringDescriptorSet() noexcept
{
    std::array<VkDescriptorPoolSize, 2u> PoolSizes{};
    PoolSizes[0].type            = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    PoolSizes[0].descriptorCount = 1u;
    PoolSizes[1].type            = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    PoolSizes[1].descriptorCount = 2u;

    VkDescriptorPoolCreateInfo PoolInfo{};
    PoolInfo.sType         = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    PoolInfo.maxSets       = 1u;
    PoolInfo.poolSizeCount = 2u;
    PoolInfo.pPoolSizes    = PoolSizes.data();
    (void)vkCreateDescriptorPool(Vulkan->Device, &PoolInfo, nullptr, &Vulkan->ComputeDescriptorPool);

    VkDescriptorSetAllocateInfo AllocateInfo{};
    AllocateInfo.sType              = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    AllocateInfo.descriptorPool     = Vulkan->ComputeDescriptorPool;
    AllocateInfo.descriptorSetCount = 1u;
    AllocateInfo.pSetLayouts        = &Vulkan->ComputeDescriptorLayout;
    (void)vkAllocateDescriptorSets(Vulkan->Device, &AllocateInfo, &Vulkan->ComputeDescriptorSet);

    WriteDescriptorSet();
    return true;
}

void SwapchainExchange::WriteDescriptorSet() noexcept
{
    VkDescriptorImageInfo ImageInfo{};
    ImageInfo.imageView   = Vulkan->StorageImageView;
    ImageInfo.imageLayout = VK_IMAGE_LAYOUT_GENERAL;

    VkDescriptorBufferInfo TriangleBufferInfo{};
    TriangleBufferInfo.buffer = Vulkan->TriangleBuffer;
    TriangleBufferInfo.offset = 0u;
    TriangleBufferInfo.range  = VK_WHOLE_SIZE;

    VkDescriptorBufferInfo MaterialBufferInfo{};
    MaterialBufferInfo.buffer = Vulkan->MaterialBuffer;
    MaterialBufferInfo.offset = 0u;
    MaterialBufferInfo.range  = VK_WHOLE_SIZE;

    std::array<VkWriteDescriptorSet, 3u> Writes{};
    Writes[0].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    Writes[0].dstSet          = Vulkan->ComputeDescriptorSet;
    Writes[0].dstBinding      = 0u;
    Writes[0].descriptorCount = 1u;
    Writes[0].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    Writes[0].pImageInfo      = &ImageInfo;

    Writes[1].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    Writes[1].dstSet          = Vulkan->ComputeDescriptorSet;
    Writes[1].dstBinding      = 1u;
    Writes[1].descriptorCount = 1u;
    Writes[1].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    Writes[1].pBufferInfo     = &TriangleBufferInfo;

    Writes[2].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    Writes[2].dstSet          = Vulkan->ComputeDescriptorSet;
    Writes[2].dstBinding      = 2u;
    Writes[2].descriptorCount = 1u;
    Writes[2].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    Writes[2].pBufferInfo     = &MaterialBufferInfo;

    vkUpdateDescriptorSets(Vulkan->Device, 3u, Writes.data(), 0u, nullptr);
}

bool SwapchainExchange::BringCycleSlots() noexcept
{
    VkSemaphoreCreateInfo SemaphoreInfo{ VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO };
    VkFenceCreateInfo     FenceInfo    { VK_STRUCTURE_TYPE_FENCE_CREATE_INFO };
    FenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;

    for (uint32_t Slot = 0u; Slot < kCycleSlotCount; ++Slot)
    {
        (void)vkCreateSemaphore(Vulkan->Device, &SemaphoreInfo, nullptr, &Vulkan->AcquireSemaphores[Slot]);
        (void)vkCreateSemaphore(Vulkan->Device, &SemaphoreInfo, nullptr, &Vulkan->ReleaseSemaphores[Slot]);
        vkCreateFence    (Vulkan->Device, &FenceInfo,     nullptr, &Vulkan->CycleFences[Slot]);
    }
    return true;
}

bool SwapchainExchange::BringImGui() noexcept
{
    // ① ImGui descriptor pool
    VkDescriptorPoolSize ImGuiPoolSize{ VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 10u };
    VkDescriptorPoolCreateInfo ImGuiPoolInfo{};
    ImGuiPoolInfo.sType         = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    ImGuiPoolInfo.flags         = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    ImGuiPoolInfo.maxSets       = 10u;
    ImGuiPoolInfo.poolSizeCount = 1u;
    ImGuiPoolInfo.pPoolSizes    = &ImGuiPoolSize;
    (void)vkCreateDescriptorPool(Vulkan->Device, &ImGuiPoolInfo, nullptr, &Vulkan->ImGuiDescriptorPool);

    // ② Render pass — loads compute output, ImGui renders on top, transitions to PRESENT
    VkAttachmentDescription ColourAttachment{};
    ColourAttachment.format         = Vulkan->SwapchainFormat;
    ColourAttachment.samples        = VK_SAMPLE_COUNT_1_BIT;
    ColourAttachment.loadOp         = VK_ATTACHMENT_LOAD_OP_LOAD;
    ColourAttachment.storeOp        = VK_ATTACHMENT_STORE_OP_STORE;
    ColourAttachment.initialLayout  = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    ColourAttachment.finalLayout    = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentReference ColourReference{ 0u, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL };
    VkSubpassDescription  Subpass{};
    Subpass.pipelineBindPoint    = VK_PIPELINE_BIND_POINT_GRAPHICS;
    Subpass.colorAttachmentCount = 1u;
    Subpass.pColorAttachments    = &ColourReference;

    VkSubpassDependency Dependency{};
    Dependency.srcSubpass    = VK_SUBPASS_EXTERNAL;
    Dependency.dstSubpass    = 0u;
    Dependency.srcStageMask  = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    Dependency.dstStageMask  = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    Dependency.srcAccessMask = 0u;
    Dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

    VkRenderPassCreateInfo RenderPassInfo{};
    RenderPassInfo.sType           = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    RenderPassInfo.attachmentCount = 1u;
    RenderPassInfo.pAttachments    = &ColourAttachment;
    RenderPassInfo.subpassCount    = 1u;
    RenderPassInfo.pSubpasses      = &Subpass;
    RenderPassInfo.dependencyCount = 1u;
    RenderPassInfo.pDependencies   = &Dependency;
    (void)vkCreateRenderPass(Vulkan->Device, &RenderPassInfo, nullptr, &Vulkan->ImGuiRenderPass);

    // ③ Framebuffers
    const uint32_t ImageCount = static_cast<uint32_t>(Vulkan->SwapchainImages.size());
    Vulkan->ImGuiFramebuffers.resize(ImageCount);
    for (uint32_t Index = 0u; Index < ImageCount; ++Index)
    {
        VkFramebufferCreateInfo FramebufferInfo{};
        FramebufferInfo.sType           = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        FramebufferInfo.renderPass      = Vulkan->ImGuiRenderPass;
        FramebufferInfo.attachmentCount = 1u;
        FramebufferInfo.pAttachments    = &Vulkan->SwapchainImageViews[Index];
        FramebufferInfo.width           = Configuration.Width;
        FramebufferInfo.height          = Configuration.Height;
        FramebufferInfo.layers          = 1u;
        (void)vkCreateFramebuffer(Vulkan->Device, &FramebufferInfo, nullptr, &Vulkan->ImGuiFramebuffers[Index]);
    }

    // ④ ImGui context
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
#ifdef IMGUI_HAS_DOCK
    ImGui::GetIO().ConfigFlags |= ImGuiConfigFlags_DockingEnable;  // 💡 docking branch only
#endif // IMGUI_HAS_DOCK
    ImGui::StyleColorsDark();

    ImGui_ImplGlfw_InitForVulkan(GlfwWindow, true);

    ImGui_ImplVulkan_InitInfo ImGuiVulkanInfo{};
    ImGuiVulkanInfo.Instance       = Vulkan->Instance;
    ImGuiVulkanInfo.PhysicalDevice = Vulkan->PhysicalDevice;
    ImGuiVulkanInfo.Device         = Vulkan->Device;
    ImGuiVulkanInfo.QueueFamily    = Vulkan->GraphicsFamily;
    ImGuiVulkanInfo.Queue          = Vulkan->GraphicsQueue;
    ImGuiVulkanInfo.DescriptorPool = Vulkan->ImGuiDescriptorPool;
    ImGuiVulkanInfo.PipelineInfoMain.RenderPass   = Vulkan->ImGuiRenderPass;  // 💡 moved from InitInfo root in ImGui 1.93
    ImGuiVulkanInfo.PipelineInfoMain.MSAASamples  = VK_SAMPLE_COUNT_1_BIT;    // 💡 moved from InitInfo root in ImGui 1.93
    ImGuiVulkanInfo.MinImageCount  = 2u;
    ImGuiVulkanInfo.ImageCount     = ImageCount;
    ImGui_ImplVulkan_Init(&ImGuiVulkanInfo);

    // ⑤ Font upload — automatic since ImGui 1.80; ImGui_ImplVulkan_NewFrame() uploads on first call.
    // 💡 ImGui_ImplVulkan_CreateFontsTexture() was removed in ImGui 1.93 (2025-06-11).
    //    The backend now owns font atlas upload internally via ImGuiBackendFlags_RendererHasTextures.

    return true;
}

//============================================================================================================================================
//                                               SCENE UPLOAD
//============================================================================================================================================

void SwapchainExchange::UploadTriangles(const std::vector<TriangleIndex>& Triangles) noexcept
{
    if (Vulkan->TriangleBuffer) vkDestroyBuffer(Vulkan->Device, Vulkan->TriangleBuffer, nullptr);
    if (Vulkan->TriangleMemory) vkFreeMemory   (Vulkan->Device, Vulkan->TriangleMemory, nullptr);

    Vulkan->TriangleCount      = static_cast<uint32_t>(Triangles.size());
    const VkDeviceSize ByteCount = Triangles.size() * sizeof(TriangleIndex);
    constexpr uint32_t HostVisible = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                                   | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;

    AllocateBuffer(Vulkan->Device, Vulkan->MemoryProperties, ByteCount,
                   VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, HostVisible,
                   Vulkan->TriangleBuffer, Vulkan->TriangleMemory);

    void* Mapped = nullptr;
    (void)vkMapMemory(Vulkan->Device, Vulkan->TriangleMemory, 0u, ByteCount, 0u, &Mapped);
    std::memcpy(Mapped, Triangles.data(), static_cast<size_t>(ByteCount));
    vkUnmapMemory(Vulkan->Device, Vulkan->TriangleMemory);
}

void SwapchainExchange::UploadRadiance(const std::vector<RadianceStructure>& Materials) noexcept
{
    if (Vulkan->MaterialBuffer) vkDestroyBuffer(Vulkan->Device, Vulkan->MaterialBuffer, nullptr);
    if (Vulkan->MaterialMemory) vkFreeMemory   (Vulkan->Device, Vulkan->MaterialMemory, nullptr);

    Vulkan->MaterialCount      = static_cast<uint32_t>(Materials.size());
    const VkDeviceSize ByteCount = Materials.size() * sizeof(RadianceStructure);
    constexpr uint32_t HostVisible = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                                   | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;

    AllocateBuffer(Vulkan->Device, Vulkan->MemoryProperties, ByteCount,
                   VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, HostVisible,
                   Vulkan->MaterialBuffer, Vulkan->MaterialMemory);

    void* Mapped = nullptr;
    (void)vkMapMemory(Vulkan->Device, Vulkan->MaterialMemory, 0u, ByteCount, 0u, &Mapped);
    std::memcpy(Mapped, Materials.data(), static_cast<size_t>(ByteCount));
    vkUnmapMemory(Vulkan->Device, Vulkan->MaterialMemory);
}

//============================================================================================================================================
//                                           RECORD AND PRESENT
//============================================================================================================================================

void SwapchainExchange::RecordAndPresent(const DispatchConfiguration& Dispatch) noexcept
{
    const uint32_t ActiveSlot = Vulkan->ActiveSlot;

    vkWaitForFences(Vulkan->Device, 1u, &Vulkan->CycleFences[ActiveSlot], VK_TRUE, UINT64_MAX);

    uint32_t ImageOrdinal = 0u;
    const VkResult AcquireResult = vkAcquireNextImageKHR(
        Vulkan->Device, Vulkan->Swapchain, UINT64_MAX,
        Vulkan->AcquireSemaphores[ActiveSlot], VK_NULL_HANDLE, &ImageOrdinal);

    if (AcquireResult == VK_ERROR_OUT_OF_DATE_KHR || ResizePending)
    {
        ResizePending = false;
        RebuildSwapchain();
        return;
    }

    if (Vulkan->ImageOrdinalFences[ImageOrdinal] != VK_NULL_HANDLE)
        vkWaitForFences(Vulkan->Device, 1u, &Vulkan->ImageOrdinalFences[ImageOrdinal], VK_TRUE, UINT64_MAX);
    Vulkan->ImageOrdinalFences[ImageOrdinal] = Vulkan->CycleFences[ActiveSlot];

    RecordComputeCommands(ImageOrdinal, Dispatch);

    vkResetFences(Vulkan->Device, 1u, &Vulkan->CycleFences[ActiveSlot]);

    VkPipelineStageFlags WaitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo Submit{ VK_STRUCTURE_TYPE_SUBMIT_INFO };
    Submit.waitSemaphoreCount   = 1u;
    Submit.pWaitSemaphores      = &Vulkan->AcquireSemaphores[ActiveSlot];
    Submit.pWaitDstStageMask    = &WaitStage;
    Submit.commandBufferCount   = 1u;
    Submit.pCommandBuffers      = &Vulkan->ComputeCommands[ImageOrdinal];
    Submit.signalSemaphoreCount = 1u;
    Submit.pSignalSemaphores    = &Vulkan->ReleaseSemaphores[ActiveSlot];
    (void)vkQueueSubmit(Vulkan->GraphicsQueue, 1u, &Submit, Vulkan->CycleFences[ActiveSlot]);

    VkPresentInfoKHR PresentInfo{ VK_STRUCTURE_TYPE_PRESENT_INFO_KHR };
    PresentInfo.waitSemaphoreCount = 1u;
    PresentInfo.pWaitSemaphores    = &Vulkan->ReleaseSemaphores[ActiveSlot];
    PresentInfo.swapchainCount     = 1u;
    PresentInfo.pSwapchains        = &Vulkan->Swapchain;
    PresentInfo.pImageIndices      = &ImageOrdinal;

    const VkResult PresentResult = vkQueuePresentKHR(Vulkan->GraphicsQueue, &PresentInfo);
    if (PresentResult == VK_ERROR_OUT_OF_DATE_KHR || PresentResult == VK_SUBOPTIMAL_KHR || ResizePending)
    {
        ResizePending = false;
        RebuildSwapchain();
    }

    Vulkan->ActiveSlot = (ActiveSlot + 1u) % kCycleSlotCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                           RECORD COMPUTE COMMANDS
//------------------------------------------------------------------------------------------------------------------------

void SwapchainExchange::RecordComputeCommands(uint32_t ImageOrdinal, const DispatchConfiguration& Dispatch) noexcept
{
    VkCommandBuffer Command = Vulkan->ComputeCommands[ImageOrdinal];

    VkCommandBufferBeginInfo BeginInfo{ VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO };
    BeginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    (void)vkBeginCommandBuffer(Command, &BeginInfo);

    // ① Storage image → GENERAL for compute write
    {
        VkImageMemoryBarrier Barrier{};
        Barrier.sType                           = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        Barrier.oldLayout                       = VK_IMAGE_LAYOUT_UNDEFINED;
        Barrier.newLayout                       = VK_IMAGE_LAYOUT_GENERAL;
        Barrier.srcQueueFamilyIndex             = VK_QUEUE_FAMILY_IGNORED;
        Barrier.dstQueueFamilyIndex             = VK_QUEUE_FAMILY_IGNORED;
        Barrier.image                           = Vulkan->StorageImage;
        Barrier.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
        Barrier.subresourceRange.levelCount     = 1u;
        Barrier.subresourceRange.layerCount     = 1u;
        Barrier.srcAccessMask                   = 0u;
        Barrier.dstAccessMask                   = VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(Command,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0u, 0u, nullptr, 0u, nullptr, 1u, &Barrier);
    }

    // ② Dispatch ReSTIR compute
    vkCmdBindPipeline(Command, VK_PIPELINE_BIND_POINT_COMPUTE, Vulkan->ComputePipeline);
    vkCmdBindDescriptorSets(Command, VK_PIPELINE_BIND_POINT_COMPUTE,
        Vulkan->ComputePipelineLayout, 0u, 1u, &Vulkan->ComputeDescriptorSet, 0u, nullptr);
    vkCmdPushConstants(Command, Vulkan->ComputePipelineLayout,
        VK_SHADER_STAGE_COMPUTE_BIT, 0u, sizeof(DispatchConfiguration), &Dispatch);

    const uint32_t GroupX = (Configuration.Width  + kLocalGroupSizeX - 1u) / kLocalGroupSizeX;
    const uint32_t GroupY = (Configuration.Height + kLocalGroupSizeY - 1u) / kLocalGroupSizeY;
    vkCmdDispatch(Command, GroupX, GroupY, 1u);

    // ③ Storage image → TRANSFER_SRC for blit
    {
        VkImageMemoryBarrier Barrier{};
        Barrier.sType                           = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        Barrier.oldLayout                       = VK_IMAGE_LAYOUT_GENERAL;
        Barrier.newLayout                       = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        Barrier.image                           = Vulkan->StorageImage;
        Barrier.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
        Barrier.subresourceRange.levelCount     = 1u;
        Barrier.subresourceRange.layerCount     = 1u;
        Barrier.srcAccessMask                   = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask                   = VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(Command,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
            0u, 0u, nullptr, 0u, nullptr, 1u, &Barrier);
    }

    // ④ Swapchain image → TRANSFER_DST
    {
        VkImageMemoryBarrier Barrier{};
        Barrier.sType                           = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        Barrier.oldLayout                       = VK_IMAGE_LAYOUT_UNDEFINED;
        Barrier.newLayout                       = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        Barrier.image                           = Vulkan->SwapchainImages[ImageOrdinal];
        Barrier.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
        Barrier.subresourceRange.levelCount     = 1u;
        Barrier.subresourceRange.layerCount     = 1u;
        Barrier.srcAccessMask                   = 0u;
        Barrier.dstAccessMask                   = VK_ACCESS_TRANSFER_WRITE_BIT;
        vkCmdPipelineBarrier(Command,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
            0u, 0u, nullptr, 0u, nullptr, 1u, &Barrier);
    }

    // ⑤ Blit storage → swapchain
    VkImageBlit BlitRegion{};
    BlitRegion.srcSubresource = { VK_IMAGE_ASPECT_COLOR_BIT, 0u, 0u, 1u };
    BlitRegion.srcOffsets[0]  = { 0, 0, 0 };
    BlitRegion.srcOffsets[1]  = { static_cast<int32_t>(Configuration.Width), static_cast<int32_t>(Configuration.Height), 1 };
    BlitRegion.dstSubresource = { VK_IMAGE_ASPECT_COLOR_BIT, 0u, 0u, 1u };
    BlitRegion.dstOffsets[0]  = { 0, 0, 0 };
    BlitRegion.dstOffsets[1]  = { static_cast<int32_t>(Configuration.Width), static_cast<int32_t>(Configuration.Height), 1 };
    vkCmdBlitImage(Command,
        Vulkan->StorageImage,                    VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
        Vulkan->SwapchainImages[ImageOrdinal],   VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
        1u, &BlitRegion, VK_FILTER_NEAREST);

    // ⑥ Swapchain image → COLOR_ATTACHMENT_OPTIMAL for ImGui
    {
        VkImageMemoryBarrier Barrier{};
        Barrier.sType                           = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        Barrier.oldLayout                       = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        Barrier.newLayout                       = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        Barrier.image                           = Vulkan->SwapchainImages[ImageOrdinal];
        Barrier.subresourceRange.aspectMask     = VK_IMAGE_ASPECT_COLOR_BIT;
        Barrier.subresourceRange.levelCount     = 1u;
        Barrier.subresourceRange.layerCount     = 1u;
        Barrier.srcAccessMask                   = VK_ACCESS_TRANSFER_WRITE_BIT;
        Barrier.dstAccessMask                   = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        vkCmdPipelineBarrier(Command,
            VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
            0u, 0u, nullptr, 0u, nullptr, 1u, &Barrier);
    }

    // ⑦ ImGui render pass
    VkClearValue ClearValue{};
    ClearValue.color = {{ 0.0f, 0.0f, 0.0f, 0.0f }};

    VkRenderPassBeginInfo RenderPassBegin{};
    RenderPassBegin.sType             = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    RenderPassBegin.renderPass        = Vulkan->ImGuiRenderPass;
    RenderPassBegin.framebuffer       = Vulkan->ImGuiFramebuffers[ImageOrdinal];
    RenderPassBegin.renderArea.extent = Vulkan->SwapchainExtent;
    RenderPassBegin.clearValueCount   = 1u;
    RenderPassBegin.pClearValues      = &ClearValue;
    vkCmdBeginRenderPass(Command, &RenderPassBegin, VK_SUBPASS_CONTENTS_INLINE);
    ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), Command);
    vkCmdEndRenderPass(Command);

    (void)vkEndCommandBuffer(Command);
}

//============================================================================================================================================
//                                             SWAPCHAIN REBUILD (on resize)
//============================================================================================================================================

bool SwapchainExchange::RebuildSwapchain() noexcept
{
    int FramebufferW = 0, FramebufferH = 0;
    glfwGetFramebufferSize(GlfwWindow, &FramebufferW, &FramebufferH);
    while (FramebufferW == 0 || FramebufferH == 0)
    {
        glfwGetFramebufferSize(GlfwWindow, &FramebufferW, &FramebufferH);
        glfwWaitEvents();
    }

    vkDeviceWaitIdle(Vulkan->Device);

    for (auto& Framebuffer : Vulkan->ImGuiFramebuffers)
        vkDestroyFramebuffer(Vulkan->Device, Framebuffer, nullptr);
    Vulkan->ImGuiFramebuffers.clear();

    RetireSwapchain();

    if (!BringSwapchain() || !BringStorageImage()) return false;

    WriteDescriptorSet();

    const uint32_t ImageCount = static_cast<uint32_t>(Vulkan->SwapchainImages.size());
    Vulkan->ImGuiFramebuffers.resize(ImageCount);
    for (uint32_t Index = 0u; Index < ImageCount; ++Index)
    {
        VkFramebufferCreateInfo FramebufferInfo{};
        FramebufferInfo.sType           = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        FramebufferInfo.renderPass      = Vulkan->ImGuiRenderPass;
        FramebufferInfo.attachmentCount = 1u;
        FramebufferInfo.pAttachments    = &Vulkan->SwapchainImageViews[Index];
        FramebufferInfo.width           = Configuration.Width;
        FramebufferInfo.height          = Configuration.Height;
        FramebufferInfo.layers          = 1u;
        (void)vkCreateFramebuffer(Vulkan->Device, &FramebufferInfo, nullptr, &Vulkan->ImGuiFramebuffers[Index]);
    }
    return true;
}

//============================================================================================================================================
//                                               POLL AND CLOSE
//============================================================================================================================================

bool SwapchainExchange::CloseRequested() const noexcept
{
    return GlfwWindow && glfwWindowShouldClose(GlfwWindow);
}

void SwapchainExchange::PollInput(InputExchange& TargetInput) noexcept
{
    ForwardInput = &TargetInput;
    TargetInput.AssignCursorDelta(0.0f, 0.0f);
    TargetInput.AssignMouseScroll(0.0f);
    glfwPollEvents();
    ForwardInput = nullptr;
}

//============================================================================================================================================
//                                               MEMORY TYPE RESOLUTION
//============================================================================================================================================

uint32_t SwapchainExchange::ResolveMemoryType(uint32_t TypeMask, uint32_t PropertyMask) const noexcept
{
    for (uint32_t Index = 0u; Index < Vulkan->MemoryProperties.memoryTypeCount; ++Index)
    {
        if ((TypeMask & (1u << Index)) &&
            (Vulkan->MemoryProperties.memoryTypes[Index].propertyFlags & PropertyMask) ==
             static_cast<VkMemoryPropertyFlags>(PropertyMask))
        {
            return Index;
        }
    }
    return 0u;
}

//============================================================================================================================================
//                                                 GLFW CALLBACKS
//============================================================================================================================================

void SwapchainExchange::OnKey(GLFWwindow* Window, int Key, int, int Action, int) noexcept
{
    auto* Self = static_cast<SwapchainExchange*>(glfwGetWindowUserPointer(Window));
    if (!Self || !Self->ForwardInput) return;

    const bool Pressed = (Action == GLFW_PRESS || Action == GLFW_REPEAT);
    auto MapKey = [&](int GlfwKey, VirtualKeyCategory EngineKey)
    {
        if (Key == GlfwKey) Self->ForwardInput->AssignKeyState(EngineKey, Pressed);
    };

    MapKey(GLFW_KEY_W,           VirtualKeyCategory::KeyW);
    MapKey(GLFW_KEY_A,           VirtualKeyCategory::KeyA);
    MapKey(GLFW_KEY_S,           VirtualKeyCategory::KeyS);
    MapKey(GLFW_KEY_D,           VirtualKeyCategory::KeyD);
    MapKey(GLFW_KEY_Q,           VirtualKeyCategory::KeyQ);
    MapKey(GLFW_KEY_E,           VirtualKeyCategory::KeyE);
    MapKey(GLFW_KEY_LEFT_SHIFT,  VirtualKeyCategory::KeyLeftShift);
    MapKey(GLFW_KEY_RIGHT_SHIFT, VirtualKeyCategory::KeyRightShift);
    MapKey(GLFW_KEY_ESCAPE,      VirtualKeyCategory::KeyEscape);

    if (Key == GLFW_KEY_ESCAPE && Action == GLFW_PRESS)
        glfwSetWindowShouldClose(Window, GLFW_TRUE);
}

void SwapchainExchange::OnMouseButton(GLFWwindow* Window, int Button, int Action, int) noexcept
{
    auto* Self = static_cast<SwapchainExchange*>(glfwGetWindowUserPointer(Window));
    if (!Self || !Self->ForwardInput) return;

    const bool Pressed = (Action == GLFW_PRESS);
    if (Button == GLFW_MOUSE_BUTTON_RIGHT)
    {
        Self->ForwardInput->AssignMouseButton(MouseButtonCategory::ButtonRight, Pressed);
        glfwSetInputMode(Window, GLFW_CURSOR, Pressed ? GLFW_CURSOR_DISABLED : GLFW_CURSOR_NORMAL);
        Self->CursorInitialised = false;
    }
    if (Button == GLFW_MOUSE_BUTTON_LEFT)
        Self->ForwardInput->AssignMouseButton(MouseButtonCategory::ButtonLeft,  Pressed);
    if (Button == GLFW_MOUSE_BUTTON_MIDDLE)
        Self->ForwardInput->AssignMouseButton(MouseButtonCategory::ButtonMiddle, Pressed);
}

void SwapchainExchange::OnCursorMove(GLFWwindow* Window, double X, double Y) noexcept
{
    auto* Self = static_cast<SwapchainExchange*>(glfwGetWindowUserPointer(Window));
    if (!Self || !Self->ForwardInput) return;

    if (!Self->CursorInitialised)
    {
        Self->PreviousCursorX  = X;
        Self->PreviousCursorY  = Y;
        Self->CursorInitialised = true;
    }

    const float Δx = static_cast<float>(X - Self->PreviousCursorX);
    const float Δy = static_cast<float>(Y - Self->PreviousCursorY);
    Self->PreviousCursorX = X;
    Self->PreviousCursorY = Y;

    Self->ForwardInput->AssignCursorDelta(Δx, Δy);
    Self->ForwardInput->AssignCursorPosition(static_cast<float>(X), static_cast<float>(Y));
}

void SwapchainExchange::OnScroll(GLFWwindow* Window, double, double OffsetY) noexcept
{
    auto* Self = static_cast<SwapchainExchange*>(glfwGetWindowUserPointer(Window));
    if (!Self || !Self->ForwardInput) return;
    Self->ForwardInput->AssignMouseScroll(static_cast<float>(OffsetY));
}

void SwapchainExchange::OnFramebuffer(GLFWwindow* Window, int, int) noexcept
{
    auto* Self = static_cast<SwapchainExchange*>(glfwGetWindowUserPointer(Window));
    if (Self) Self->SignalResize();
}

} // namespace Frontier
