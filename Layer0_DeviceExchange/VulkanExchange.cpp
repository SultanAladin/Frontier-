//============================================================================================================================================
// 📦 Frontier/Layer0_DeviceExchange/VulkanExchange.cpp — Vulkan Device Communication Implementation
//============================================================================================================================================

#include "VulkanExchange.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

VulkanExchange::VulkanExchange() noexcept
    : m_DeviceToken{}
    , m_ActiveSlotCount(3)
    , m_InitializedCondition(false)
{
}

VulkanExchange::~VulkanExchange() noexcept
{
    Terminate();
}

bool VulkanExchange::Initialize(bool EnableValidation) noexcept
{
    (void)EnableValidation;
    m_DeviceToken.DeviceIdentifier       = 0x10DE0001ULL;       // Representative GPU ID
    m_DeviceToken.GraphicsQueueIndex     = 0;
    m_DeviceToken.ComputeQueueIndex      = 1;
    m_DeviceToken.TransferQueueIndex     = 2;
    m_DeviceToken.RayTracingCapable      = true;
    m_DeviceToken.MeshletClusterCapable  = true;
    m_InitializedCondition               = true;
    return true;
}

void VulkanExchange::Terminate() noexcept
{
    if (m_InitializedCondition)
    {
        SynchronizeDevice();
        m_InitializedCondition = false;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 COMMAND SLOT OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

VulkanDeviceToken VulkanExchange::QueryDevice() const noexcept
{
    return m_DeviceToken;
}

CommandRecordSlot VulkanExchange::AcquireSlot(uint32_t SlotIndex) noexcept
{
    CommandRecordSlot Slot{};
    Slot.SlotIndex           = SlotIndex % m_ActiveSlotCount;
    Slot.FenceToken          = 0x1000ULL + Slot.SlotIndex;
    Slot.SemaphoreToken      = 0x2000ULL + Slot.SlotIndex;
    Slot.InFlightCondition   = false;
    return Slot;
}

void VulkanExchange::SubmitSlot(CommandRecordSlot Slot) noexcept
{
    (void)Slot;
}

void VulkanExchange::SynchronizeDevice() noexcept
{
}

} // namespace Frontier
