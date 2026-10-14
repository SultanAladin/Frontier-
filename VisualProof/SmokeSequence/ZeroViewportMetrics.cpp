//============================================================================================================================================
//                                                        ZEROVIEWPORTMETRICS.CPP
//============================================================================================================================================
// 📦 Actual ProjectZero.dll simulation, decoded authored car, shared 3D visibility raster and the production Vulkan smoke exchange.

#include "../../Engine/ProjectInterchange/ProjectSpecification.h"
#include "../../Engine/ProjectInterchange/CodeInterchange.h"
#include "../../Engine/Host/SmokeSequence.h"
#include "../../Engine/Host/GeometrySequence.h"
#include "../../Engine/ContentInterchange/VehicleStructure.h"
#include "../../Engine/ContentInterchange/PngWriteCounterpart.h"
#include "../../Engine/GeometricRaster/VisibilityRaster.h"
#include "../../Engine/DeviceExchange/SmokeExchange.h"

#include <cassert>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

namespace
{

using Frontier::Vehicle::Vec3;
using Clock = std::chrono::steady_clock;

struct ImageSpace
{
    VkImage        Image   = VK_NULL_HANDLE;
    VkImageView    View    = VK_NULL_HANDLE;
    VkDeviceMemory Storage = VK_NULL_HANDLE;
    VkFormat       Format  = VK_FORMAT_UNDEFINED;
    uint32_t       Width   = 0u;
    uint32_t       Height  = 0u;
};

class VulkanProofSequence
{
public:
    VkInstance Instance = VK_NULL_HANDLE;
    VkPhysicalDevice PhysicalDevice = VK_NULL_HANDLE;
    VkDevice Device = VK_NULL_HANDLE;
    VkQueue Queue = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    VkCommandPool Commands = VK_NULL_HANDLE;
    VkCommandBuffer Command = VK_NULL_HANDLE;
    VkBuffer Transfer = VK_NULL_HANDLE;
    VkDeviceMemory TransferStorage = VK_NULL_HANDLE;
    void* Mapped = nullptr;
    uint32_t QueueFamily = 0u;
    ImageSpace Linear, Surface, Albedo, Presentation;
    std::string DeviceName;
    uint32_t DeviceClassification = 0u;

    VulkanProofSequence(uint32_t Width, uint32_t Height)
    {
        VkApplicationInfo Application{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        Application.pApplicationName = "Frontier Project-Zero native visual proof";
        Application.apiVersion = VK_API_VERSION_1_1;
        VkInstanceCreateInfo Opening{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        Opening.pApplicationInfo = &Application;
        Require(vkCreateInstance(&Opening, nullptr, &Instance), "vkCreateInstance");
        uint32_t Count = 0u;
        Require(vkEnumeratePhysicalDevices(Instance, &Count, nullptr), "vkEnumeratePhysicalDevices");
        assert(Count);
        std::vector<VkPhysicalDevice> Devices(Count);
        Require(vkEnumeratePhysicalDevices(Instance, &Count, Devices.data()), "vkEnumeratePhysicalDevices");
        PhysicalDevice = Devices.front();
        VkPhysicalDeviceProperties Properties{};
        vkGetPhysicalDeviceProperties(PhysicalDevice, &Properties);
        DeviceName = Properties.deviceName;
        DeviceClassification = Properties.deviceType;
        std::cout << "Vulkan device: " << DeviceName << "; device classification " << DeviceClassification << '\n';
        vkGetPhysicalDeviceMemoryProperties(PhysicalDevice, &MemoryProperties);
        uint32_t FamilyCount = 0u;
        vkGetPhysicalDeviceQueueFamilyProperties(PhysicalDevice, &FamilyCount, nullptr);
        std::vector<VkQueueFamilyProperties> Families(FamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(PhysicalDevice, &FamilyCount, Families.data());
        while (QueueFamily < FamilyCount && !(Families[QueueFamily].queueFlags & VK_QUEUE_COMPUTE_BIT)) ++QueueFamily;
        assert(QueueFamily < FamilyCount);
        float Priority = 1.0f;
        VkDeviceQueueCreateInfo QueueOpening{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        QueueOpening.queueFamilyIndex = QueueFamily;
        QueueOpening.queueCount = 1u;
        QueueOpening.pQueuePriorities = &Priority;
        VkPhysicalDeviceFeatures Supported{};
        vkGetPhysicalDeviceFeatures(PhysicalDevice, &Supported);
        assert(Supported.shaderStorageImageExtendedFormats);
        VkPhysicalDeviceFeatures Features{};
        Features.shaderStorageImageExtendedFormats = VK_TRUE;
        VkDeviceCreateInfo DeviceOpening{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        DeviceOpening.queueCreateInfoCount = 1u;
        DeviceOpening.pQueueCreateInfos = &QueueOpening;
        DeviceOpening.pEnabledFeatures = &Features;
        Require(vkCreateDevice(PhysicalDevice, &DeviceOpening, nullptr, &Device), "vkCreateDevice");
        vkGetDeviceQueue(Device, QueueFamily, 0u, &Queue);
        VkCommandPoolCreateInfo Recording{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        Recording.queueFamilyIndex = QueueFamily;
        Require(vkCreateCommandPool(Device, &Recording, nullptr, &Commands), "vkCreateCommandPool");
        VkCommandBufferAllocateInfo Selection{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        Selection.commandPool = Commands;
        Selection.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        Selection.commandBufferCount = 1u;
        Require(vkAllocateCommandBuffers(Device, &Selection, &Command), "vkAllocateCommandBuffers");
        VkBufferCreateInfo Upload{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        Upload.size = std::max<uint64_t>(Width * Height * 16ull, 128ull * 128ull * 128ull * 8ull);
        Upload.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT;
        Require(vkCreateBuffer(Device, &Upload, nullptr, &Transfer), "vkCreateBuffer");
        VkMemoryRequirements Requirements{};
        vkGetBufferMemoryRequirements(Device, Transfer, &Requirements);
        VkMemoryAllocateInfo Extent{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Extent.allocationSize = Requirements.size;
        Extent.memoryTypeIndex = LocateMemory(Requirements.memoryTypeBits,
                                             VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        Require(vkAllocateMemory(Device, &Extent, nullptr, &TransferStorage), "vkAllocateMemory");
        Require(vkBindBufferMemory(Device, Transfer, TransferStorage, 0u), "vkBindBufferMemory");
        Require(vkMapMemory(Device, TransferStorage, 0u, Upload.size, 0u, &Mapped), "vkMapMemory");
        ConstructImage(Linear, Width, Height, VK_FORMAT_R32G32B32A32_SFLOAT);
        ConstructImage(Surface, Width, Height, VK_FORMAT_R32G32B32A32_SFLOAT);
        ConstructImage(Albedo, Width, Height, VK_FORMAT_R8G8B8A8_UNORM);
        ConstructImage(Presentation, Width, Height, VK_FORMAT_R8G8B8A8_UNORM);
    }

    ~VulkanProofSequence()
    {
        if (!Device) return;
        vkDeviceWaitIdle(Device);
        for (auto* Image : {&Linear, &Surface, &Albedo, &Presentation})
        {
            vkDestroyImageView(Device, Image->View, nullptr);
            vkDestroyImage(Device, Image->Image, nullptr);
            vkFreeMemory(Device, Image->Storage, nullptr);
        }
        vkUnmapMemory(Device, TransferStorage);
        vkDestroyBuffer(Device, Transfer, nullptr);
        vkFreeMemory(Device, TransferStorage, nullptr);
        vkDestroyCommandPool(Device, Commands, nullptr);
        vkDestroyDevice(Device, nullptr);
        vkDestroyInstance(Instance, nullptr);
    }

    static void Require(VkResult Result, const char* Operation)
    {
        if (Result != VK_SUCCESS)
        {
            std::cerr << Operation << " refused: " << Result << '\n';
            std::abort();
        }
    }

    uint32_t LocateMemory(uint32_t Eligible, VkMemoryPropertyFlags Required)
    {
        for (uint32_t Index = 0u; Index < MemoryProperties.memoryTypeCount; ++Index)
            if ((Eligible & (1u << Index)) && (MemoryProperties.memoryTypes[Index].propertyFlags & Required) == Required) return Index;
        std::abort();
    }

    void ConstructImage(ImageSpace& Extent, uint32_t Width, uint32_t Height, VkFormat Format)
    {
        Extent.Width = Width; Extent.Height = Height; Extent.Format = Format;
        VkImageCreateInfo Image{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        Image.imageType = VK_IMAGE_TYPE_2D;
        Image.format = Format;
        Image.extent = {Width, Height, 1u};
        Image.mipLevels = Image.arrayLayers = 1u;
        Image.samples = VK_SAMPLE_COUNT_1_BIT;
        Image.tiling = VK_IMAGE_TILING_OPTIMAL;
        Image.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT |
                      VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
        Require(vkCreateImage(Device, &Image, nullptr, &Extent.Image), "vkCreateImage");
        VkMemoryRequirements Requirements{};
        vkGetImageMemoryRequirements(Device, Extent.Image, &Requirements);
        VkMemoryAllocateInfo Storage{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Storage.allocationSize = Requirements.size;
        Storage.memoryTypeIndex = LocateMemory(Requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        Require(vkAllocateMemory(Device, &Storage, nullptr, &Extent.Storage), "vkAllocateMemory image");
        Require(vkBindImageMemory(Device, Extent.Image, Extent.Storage, 0u), "vkBindImageMemory");
        VkImageViewCreateInfo View{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        View.image = Extent.Image;
        View.viewType = VK_IMAGE_VIEW_TYPE_2D;
        View.format = Format;
        View.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        View.subresourceRange.levelCount = View.subresourceRange.layerCount = 1u;
        Require(vkCreateImageView(Device, &View, nullptr, &Extent.View), "vkCreateImageView");
        Begin();
        Barrier(Extent.Image, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL, 0u,
                VK_ACCESS_TRANSFER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
        Complete();
    }

    void Begin()
    {
        Require(vkResetCommandPool(Device, Commands, 0u), "vkResetCommandPool");
        VkCommandBufferBeginInfo Recording{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        Recording.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Require(vkBeginCommandBuffer(Command, &Recording), "vkBeginCommandBuffer");
    }

    void Complete()
    {
        Require(vkEndCommandBuffer(Command), "vkEndCommandBuffer");
        VkSubmitInfo Recording{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        Recording.commandBufferCount = 1u;
        Recording.pCommandBuffers = &Command;
        Require(vkQueueSubmit(Queue, 1u, &Recording, VK_NULL_HANDLE), "vkQueueSubmit");
        Require(vkQueueWaitIdle(Queue), "vkQueueWaitIdle");
    }

    void Barrier(VkImage Image, VkImageLayout Before, VkImageLayout After, VkAccessFlags Source, VkAccessFlags Target)
    {
        VkImageMemoryBarrier Change{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        Change.oldLayout = Before; Change.newLayout = After;
        Change.srcQueueFamilyIndex = Change.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        Change.image = Image;
        Change.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        Change.subresourceRange.levelCount = Change.subresourceRange.layerCount = 1u;
        Change.srcAccessMask = Source; Change.dstAccessMask = Target;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                             0u, 0u, nullptr, 0u, nullptr, 1u, &Change);
    }

    void Upload(ImageSpace& Image, const void* Pixels, size_t Bytes)
    {
        std::memcpy(Mapped, Pixels, Bytes);
        Begin();
        Barrier(Image.Image, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_TRANSFER_WRITE_BIT);
        VkBufferImageCopy TransferRange{};
        TransferRange.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        TransferRange.imageSubresource.layerCount = 1u;
        TransferRange.imageExtent = {Image.Width, Image.Height, 1u};
        vkCmdCopyBufferToImage(Command, Transfer, Image.Image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1u, &TransferRange);
        Barrier(Image.Image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL,
                VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
        Complete();
    }

    void ReadImage(VkImage Image, VkExtent3D Dimensions, void* Result, size_t Bytes)
    {
        Begin();
        Barrier(Image, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_TRANSFER_READ_BIT);
        VkBufferImageCopy Range{};
        Range.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        Range.imageSubresource.layerCount = 1u;
        Range.imageExtent = Dimensions;
        vkCmdCopyImageToBuffer(Command, Image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, Transfer, 1u, &Range);
        Barrier(Image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL,
                VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
        VkMemoryBarrier Visible{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Visible.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        Visible.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        vkCmdPipelineBarrier(Command, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT,
                             0u, 1u, &Visible, 0u, nullptr, 0u, nullptr);
        Complete();
        std::memcpy(Result, Mapped, Bytes);
    }
};

struct SceneReceptionSequence
{
    Frontier::SceneStructure* Scene = nullptr;
    std::vector<Frontier::InstanceRecord> Rest, Current;
    Vec3 Centre{};
    float Heading = 0.0f;
};

void FRONTIER_CODE_IMAGE_CALL ReceiveMutation(const FrontierProjectSceneMutation* Mutation, void* Context)
{
    auto& Reception = *static_cast<SceneReceptionSequence*>(Context);
    assert(Mutation && Mutation->StructureSize == sizeof(*Mutation) && Mutation->MutationNumber == 2u);
    for (const auto& Placement : Reception.Scene->QueryPlacements())
    {
        if (Placement.Name != Mutation->SubjectName) continue;
        for (uint32_t Offset = 0u; Offset < Placement.InstanceCount; ++Offset)
        {
            const uint32_t Slot = Placement.FirstInstance + Offset;
            auto& Current = Reception.Current[Slot];
            std::copy_n(Current.World, 16u, Current.PreviousWorld);
            const auto& Rest = Reception.Rest[Slot];
            for (uint32_t Column = 0u; Column < 4u; ++Column)
                for (uint32_t Row = 0u; Row < 4u; ++Row)
                {
                    Current.World[Column * 4u + Row] = 0.0f;
                    for (uint32_t Along = 0u; Along < 4u; ++Along)
                        Current.World[Column * 4u + Row] += Mutation->Transform[Along * 4u + Row] * Rest.World[Column * 4u + Along];
                }
        }
    }
    if (std::strncmp(Mutation->SubjectName, "ControlVehicle", 14u) == 0)
    {
        const float Height = Frontier::Vehicle::VehicleGeometry{}.CoMHeight + 0.02f;
        Reception.Centre = {Mutation->Transform[12] + Mutation->Transform[8] * Height,
                            Mutation->Transform[13] + Mutation->Transform[9] * Height,
                            Mutation->Transform[14] + Mutation->Transform[10] * Height};
        Reception.Heading = std::atan2(Mutation->Transform[1], Mutation->Transform[0]);
    }
}

std::vector<float> ResolveSurfaces(const Frontier::SceneStructure& Scene, const Frontier::VisibilityRaster& Raster,
                                   const Vec3& Eye, const Vec3& Forward, const Vec3& Right, const Vec3& Up,
                                   uint32_t Width, uint32_t Height, float Aperture)
{
    std::vector<float> Surfaces(Width * Height * 4u);
    const auto& Triangles = Scene.QueryFlatTriangles();
    for (uint32_t Cell = 0u; Cell < Width * Height; ++Cell)
    {
        float* Surface = Surfaces.data() + Cell * 4u;
        const uint32_t Triangle = Raster.QueryVisibility()[Cell];
        if (Triangle == Frontier::VisibilityRaster::kMiss)
        {
            const uint32_t Miss = 0xFFFFFFFFu;
            std::memcpy(Surface + 3u, &Miss, sizeof(Miss));
            continue;
        }
        const float Alpha = Raster.QueryBarycentrics()[Cell * 2u], Beta = Raster.QueryBarycentrics()[Cell * 2u + 1u];
        const float Gamma = 1.0f - Alpha - Beta;
        const auto& Facet = Triangles[Triangle];
        Surface[0] = Alpha * Facet.VertexAlphaX + Beta * Facet.VertexBetaX + Gamma * Facet.VertexGammaX;
        Surface[1] = Alpha * Facet.VertexAlphaY + Beta * Facet.VertexBetaY + Gamma * Facet.VertexGammaX;
        Surface[2] = Alpha * Facet.VertexAlphaZ + Beta * Facet.VertexBetaZ + Gamma * Facet.VertexGammaZ;
        Surface[3] = 0.0f;
    }
    (void)Eye; (void)Forward; (void)Right; (void)Up; (void)Aperture;
    return Surfaces;
}

void Require(bool Accepted, const std::string& Refusal)
{
    if (!Accepted) { std::cerr << "REFUSED " << Refusal << '\n'; std::abort(); }
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 3);
    if (std::strcmp(Arguments[1], "--author") == 0)
    {
        Frontier::VehicleStructure Content;
        Content.Construct();
        std::string Refusal;
        std::filesystem::create_directories(std::filesystem::path(Arguments[2]).parent_path());
        Require(Content.Export(Arguments[2], Refusal), Refusal);
        std::cout << "Authored actual car: " << Content.QueryTriangles().size() << " facets, "
                  << Content.QuerySpans().size() << " placements.\n";
        return 0;
    }
    assert(Count == 7);
    const std::filesystem::path SpecificationLocation = Arguments[1], Output = Arguments[2];
    const std::string Case = Arguments[3], Spirv = Arguments[4];
    const uint32_t Ticks = static_cast<uint32_t>(std::stoul(Arguments[5]));
    const uint32_t FineExtent = static_cast<uint32_t>(std::stoul(Arguments[6]));
    constexpr uint32_t Width = 512u, Height = 320u;
    std::filesystem::create_directories(Output);
    Frontier::ProjectSpecification Specification;
    std::string Refusal;
    Require(Frontier::DecodeProjectSpecification(SpecificationLocation, Specification, Refusal), Refusal);
    assert(Specification.ProjectName == "ProjectZero");
    Frontier::SceneStructure Scene;
    Frontier::SceneDecodeConfiguration Decoding;
    Require(Frontier::SceneCodec::Decode(Specification.OpeningSceneLocation.string(), Scene, nullptr, Decoding, &Refusal), Refusal);
    assert(Scene.QueryPlacements().size() >= 6u && Scene.QueryFlatTriangles().size() > 20000u);
    Frontier::CodeInterchange Project;
    Require(Project.Construct(Specification, Refusal), Refusal);
    assert(Project.CodeImageOpen() && Project.HasGeometry() && Project.SmokeAvailable() && Project.TransportAvailable());
    SceneReceptionSequence Reception;
    Reception.Scene = &Scene;
    Reception.Rest = Reception.Current = Scene.QueryInstances();
    FrontierProjectHostInterchange Host{};
    Host.StructureSize = sizeof(Host);
    Host.ReceiveSceneMutation = &ReceiveMutation;
    Host.ProjectReception = &Reception;
    Require(Project.ConstructProject(Specification, Host, Refusal), Refusal);
    Frontier::HostRuntime::GeometrySequence Geometry;
    Geometry.Construct(Scene, Project);
    Reception.Rest = Reception.Current = Scene.QueryInstances();
    Geometry.CaptureRest(Scene, Reception.Rest);
    Frontier::HostRuntime::SmokeSequence Coarse;
    VulkanProofSequence Device(Width, Height);
    Frontier::SmokeExchange Fine;
    Frontier::SmokeDeviceSpecification DeviceSpecification;
    DeviceSpecification.PhysicalDevice = Device.PhysicalDevice;
    DeviceSpecification.Device = Device.Device;
    DeviceSpecification.MemoryProperties = Device.MemoryProperties;
    DeviceSpecification.FineExtent = FineExtent;
    DeviceSpecification.CycleSlotCount = 1u;
    DeviceSpecification.SpirvLocation = Spirv;
    Require(Fine.Construct(DeviceSpecification), Fine.QueryRefusal());
    assert(Fine.QueryMetrics().HeldBytes == 0u && !Fine.Resident());
    Frontier::VisibilityRaster Raster;
    Raster.AssignFlatColouring(true);
    std::vector<unsigned char> Pixels(Width * Height * 4u), Baseline(Pixels.size());
    std::ofstream Trace(Output / "Trace.csv");
    Trace << "time_s,x_m,y_m,z_m,heading_rad,revision,resident,gpu_bytes,gpu_ticks,gpu_scrolls,peak_power_w,"
          << "tread_c,carcass_c,gas_c,gauge_kpa,ignited,remaining_rubber_kg,active_sources,volume_pixels,"
          << "physics_ms,snapshot_ms,transport_ms,render_ms\n";
    uint32_t Captures = 0u, ChangedCaptures = 0u, IgnitedTicks = 0u, ResidentTicks = 0u;
    uint64_t MaximumBytes = 0u;
    double PeakPower = 0.0;
    bool DepthChecked = false, PauseChecked = false;
    Vec3 CameraCentre{0.0f, 0.0f, 0.6f};
    for (uint32_t Tick = 0u; Tick < Ticks; ++Tick)
    {
        FrontierProjectInputReading Input{};
        Input.StructureSize = sizeof(Input);
        Input.TransportNumber = Case == "turning-drift" ? 1u : 2u;
        if (Case == "turning-drift") { Input.MoveAxisX = -1.0f; Input.HandbrakePressed = Tick < 72u; }
        const auto PhysicsStart = Clock::now();
        Require(Project.AdvanceProject(Tick / 60.0f, 1.0f / 60.0f, &Input, Refusal), Refusal);
        const double PhysicsMilliseconds = std::chrono::duration<double, std::milli>(Clock::now() - PhysicsStart).count();
        const auto SnapshotStart = Clock::now();
        Require(Coarse.Advance(Project, Refusal), Refusal);
        Require(Fine.Capture(Coarse.QueryReading(), Coarse.QueryTransport()), Fine.QueryRefusal());
        const double SnapshotMilliseconds = std::chrono::duration<double, std::milli>(Clock::now() - SnapshotStart).count();
        Device.Begin();
        Require(Fine.RecordTransport(Device.Command, 0u), Fine.QueryRefusal());
        Device.Complete();
        Fine.ReadCompleted(0u);
        const auto& Smoke = Coarse.QueryReading();
        if (Smoke.Extent) ++ResidentTicks;
        double MaximumPower = 0.0, SurfaceTemperature = 0.0, CarcassTemperature = 0.0, GasTemperature = 0.0;
        double Pressure = 0.0, RemainingRubber = 0.0;
        uint32_t Ignited = 0u;
        for (uint32_t Wheel = 0u; Wheel < Smoke.WheelCount; ++Wheel)
        {
            const auto& Reading = Smoke.Tyres[Wheel];
            MaximumPower = std::max(MaximumPower, double(Reading.SlidingPower));
            SurfaceTemperature = std::max(SurfaceTemperature, double(Reading.SurfaceTemperature));
            CarcassTemperature = std::max(CarcassTemperature, double(Reading.CarcassTemperature));
            GasTemperature = std::max(GasTemperature, double(Reading.GasTemperature));
            Pressure = std::max(Pressure, double(Reading.GaugePressure));
            RemainingRubber += Reading.RemainingRubber;
            Ignited += (Reading.Condition & 2u) ? 1u : 0u;
        }
        if (Ignited) ++IgnitedTicks;
        PeakPower = std::max(PeakPower, MaximumPower);
        MaximumBytes = std::max(MaximumBytes, Fine.QueryMetrics().HeldBytes);
        if (Tick == 120u && Fine.Resident())
        {
            const auto Revision = Smoke.Revision;
            const auto Before = Fine.QueryMetrics().TransportTicks;
            Input.Paused = 1u;
            Require(Project.AdvanceProject(Tick / 60.0f, 1.0f / 60.0f, &Input, Refusal), Refusal);
            Require(Coarse.Advance(Project, Refusal), Refusal);
            Require(Fine.Capture(Coarse.QueryReading(), Coarse.QueryTransport()), Fine.QueryRefusal());
            Device.Begin(); Require(Fine.RecordTransport(Device.Command, 0u), Fine.QueryRefusal()); Device.Complete();
            assert(Coarse.QueryReading().Revision == Revision && Fine.QueryMetrics().TransportTicks == Before);
            PauseChecked = true;
        }
        uint32_t ChangedPixels = 0u;
        if (Tick % 6u == 0u)
        {
            bool GeometryChanged = false;
            Require(Geometry.Advance(Scene, Reception.Current, Project, GeometryChanged, Refusal), Refusal);
            Scene.RefreshGeometry(Reception.Current);
            // 📝 World-axis follow translation only; neither camera basis nor previously emitted gas inherits vehicle yaw.
            CameraCentre = CameraCentre * 0.35f + Reception.Centre * 0.65f;
            const Vec3 Offset = Case == "diagnostic-ignition" ? Vec3{-5.0f, -6.0f, 2.2f} : Vec3{-6.0f, -8.0f, 3.6f};
            const Vec3 Eye = CameraCentre + Offset;
            const Vec3 Target = CameraCentre + Vec3{0.0f, 0.0f, 0.15f};
            const Vec3 Forward = (Target - Eye).Normalized();
            const Vec3 Right = Frontier::Vehicle::Cross(Forward, Vec3{0.0f, 0.0f, 1.0f}).Normalized();
            const Vec3 Up = Frontier::Vehicle::Cross(Right, Forward).Normalized();
            double Luminance = 0.0;
            Require(Raster.Render(Scene, &Eye.x, &Forward.x, &Right.x, &Up.x, 0.82f, Width, Height, Pixels.data(), Luminance),
                    "shared 3D raster refused");
            Baseline = Pixels;
            if (Fine.Resident())
            {
                std::vector<float> Linear(Width * Height * 4u);
                const auto& Radiance = Raster.QueryLinearRadiance();
                for (uint32_t Cell = 0u; Cell < Width * Height; ++Cell)
                {
                    std::copy_n(Radiance.data() + Cell * 3u, 3u, Linear.data() + Cell * 4u);
                    Linear[Cell * 4u + 3u] = 1.0f;
                }
                auto Surfaces = ResolveSurfaces(Scene, Raster, Eye, Forward, Right, Up, Width, Height, 0.82f);
                std::vector<unsigned char> Albedo(Width * Height * 4u, 255u);
                Device.Upload(Device.Linear, Linear.data(), Linear.size() * sizeof(float));
                Device.Upload(Device.Surface, Surfaces.data(), Surfaces.size() * sizeof(float));
                Device.Upload(Device.Albedo, Albedo.data(), Albedo.size());
                Device.Upload(Device.Presentation, Baseline.data(), Baseline.size());
                Frontier::SmokeProjection Projection;
                std::copy_n(&Eye.x, 3u, Projection.Eye);
                std::copy_n(&Forward.x, 3u, Projection.Forward);
                std::copy_n(&Right.x, 3u, Projection.Right);
                std::copy_n(&Up.x, 3u, Projection.Up);
                Projection.Eye[3] = std::tan(0.82f * 0.5f);
                Projection.Width = Width; Projection.Height = Height;
                Projection.ColourTransfer = 1u;
                Projection.Lighting.DensityExtinction = 6.0f;
                Projection.Lighting.SmokeAlbedo = 0.82f;
                Projection.Lighting.TemperatureScale = 0.35f;
                Device.Begin();
                Require(Fine.RecordProjection(Device.Command, 0u, Device.Linear.View, Device.Surface.View, Device.Albedo.View,
                                              Device.Presentation.View, Projection), Fine.QueryRefusal());
                Device.Complete(); Fine.ReadCompleted(0u);
                Device.ReadImage(Device.Presentation.Image, {Width, Height, 1u}, Pixels.data(), Pixels.size());
                for (uint32_t Cell = 0u; Cell < Width * Height; ++Cell)
                {
                    uint32_t Difference = 0u;
                    for (uint32_t Channel = 0u; Channel < 3u; ++Channel)
                        Difference += std::abs(int(Pixels[Cell * 4u + Channel]) - int(Baseline[Cell * 4u + Channel]));
                    if (Difference > 8u) ++ChangedPixels;
                }
                if (!DepthChecked && ChangedPixels > 100u)
                {
                    // Opaque interception immediately in front of the camera: every smoke voxel is behind it.
                    for (uint32_t Cell = 0u; Cell < Width * Height; ++Cell)
                    {
                        Surfaces[Cell * 4u] = Eye.x;
                        Surfaces[Cell * 4u + 1u] = Eye.y;
                        Surfaces[Cell * 4u + 2u] = Eye.z;
                        Surfaces[Cell * 4u + 3u] = 0.0f;
                    }
                    Device.Upload(Device.Surface, Surfaces.data(), Surfaces.size() * sizeof(float));
                    Device.Upload(Device.Presentation, Baseline.data(), Baseline.size());
                    Device.Begin();
                    Require(Fine.RecordProjection(Device.Command, 0u, Device.Linear.View, Device.Surface.View, Device.Albedo.View,
                                                  Device.Presentation.View, Projection), Fine.QueryRefusal());
                    Device.Complete();
                    std::vector<unsigned char> Occluded(Pixels.size());
                    Device.ReadImage(Device.Presentation.Image, {Width, Height, 1u}, Occluded.data(), Occluded.size());
                    for (uint32_t Component = 0u; Component < Occluded.size(); ++Component)
                        assert(std::abs(int(Occluded[Component]) - int(Baseline[Component])) <= 1);
                    DepthChecked = true;
                }
            }
            char Name[64];
            std::snprintf(Name, sizeof(Name), "Picture-%04u.png", Captures++);
            assert(stbi_write_png((Output / Name).string().c_str(), Width, Height, 4, Pixels.data(), Width * 4u));
            if (ChangedPixels > 100u) ++ChangedCaptures;
            if (Captures % 10u == 0u)
                std::cout << Case << ": " << Captures << " actual 3D captures; volume pixels "
                          << ChangedPixels << '\n' << std::flush;
        }
        const auto& Metrics = Fine.QueryMetrics();
        Trace << (Tick + 1u) / 60.0f << ',' << Reception.Centre.x << ',' << Reception.Centre.y << ',' << Reception.Centre.z << ','
              << Reception.Heading << ',' << Smoke.Revision << ',' << (Smoke.Extent ? 1 : 0) << ',' << Metrics.HeldBytes << ','
              << Metrics.TransportTicks << ',' << Metrics.Relocations << ',' << MaximumPower << ',' << SurfaceTemperature - 273.15 << ','
              << CarcassTemperature - 273.15 << ',' << GasTemperature - 273.15 << ',' << Pressure / 1000.0 << ',' << Ignited << ','
              << RemainingRubber << ',' << Coarse.QueryTransport().SourceCount << ',' << ChangedPixels << ',' << PhysicsMilliseconds << ','
              << SnapshotMilliseconds << ',' << Metrics.TransportMilliseconds << ',' << Metrics.RenderMilliseconds << '\n';
    }
    const auto Recorded = Fine.QueryMetrics();
    FrontierProjectInputReading Stop{};
    Stop.StructureSize = sizeof(Stop);
    Require(Project.AdvanceProject(Ticks / 60.0f, 1.0f / 60.0f, &Stop, Refusal), Refusal);
    Require(Coarse.Advance(Project, Refusal), Refusal);
    Require(Fine.Capture(Coarse.QueryReading(), Coarse.QueryTransport()), Fine.QueryRefusal());
    assert(!Fine.Resident() && Fine.QueryMetrics().HeldBytes == 0u);
    Project.Retire();
    if (Case == "holding") assert(!ResidentTicks && Recorded.Acquisitions == 0u && PeakPower < 1.0);
    else
    {
        assert(ResidentTicks && ChangedCaptures && DepthChecked);
        if (Ticks > 120u) assert(PauseChecked);
        if (Case == "diagnostic-ignition") assert(IgnitedTicks);
        else assert(!IgnitedTicks);
    }
    std::ofstream Audit(Output / "NativeMetrics.json");
    Audit << "{\n  \"passed\": true,\n  \"project\": \"ProjectZero\",\n  \"loadedActualCodeImage\": true,\n"
          << "  \"renderer\": \"Engine VisibilityRaster + Vulkan SmokeExchange\",\n  \"device\": \"" << Device.DeviceName << "\",\n"
          << "  \"deviceClassification\": " << Device.DeviceClassification << ",\n"
          << "  \"physicsRateHz\": 240,\n  \"gasRateHz\": 60,\n  \"captureRateHz\": 10,\n"
          << "  \"fineExtent\": " << FineExtent << ",\n  \"frames\": " << Captures << ",\n  \"visibleVolumeFrames\": "
          << ChangedCaptures << ",\n"
          << "  \"peakSlidingPowerW\": " << PeakPower << ",\n  \"ignitedTicks\": " << IgnitedTicks
          << ",\n  \"residentTicks\": " << ResidentTicks << ",\n"
          << "  \"acquisitions\": " << Recorded.Acquisitions << ",\n  \"scrolls\": " << Recorded.Relocations
          << ",\n  \"peakDeviceBytes\": " << MaximumBytes << ",\n"
          << "  \"releasedDeviceBytes\": 0,\n  \"opaqueDepthCheck\": " << (DepthChecked ? "true" : "false") << ",\n"
          << "  \"pauseCheck\": " << (PauseChecked ? "true" : "false") << ",\n  \"diagnosticIgnitionOverrides\": "
          << (Case == "diagnostic-ignition" ? "true" : "false") << "\n}\n";
    std::cout << "PASS " << Case << ": actual ProjectZero.dll + actual authored 3D car + shared Vulkan smoke; released all domain storage.\n";
    return 0;
}
