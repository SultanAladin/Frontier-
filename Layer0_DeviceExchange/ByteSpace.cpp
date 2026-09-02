//============================================================================================================================================
// 📦 Frontier/Layer0_DeviceExchange/ByteSpace.cpp — Monotonic Transient Storage Implementation
//============================================================================================================================================

#include "ByteSpace.h"
#include <cstdlib>
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

ByteSpace::ByteSpace(size_t CapacityInBytes) noexcept
    : m_StorageHead(nullptr)
    , m_TotalCapacity(CapacityInBytes)
    , m_OccupiedBytes(0)
    , m_PeakOccupiedBytes(0)
{
    if (m_TotalCapacity > 0)
    {
        m_StorageHead = static_cast<uint8_t*>(std::malloc(m_TotalCapacity));
    }
}

ByteSpace::~ByteSpace() noexcept
{
    if (m_StorageHead)
    {
        std::free(m_StorageHead);
        m_StorageHead = nullptr;
    }
}

ByteSpace::ByteSpace(ByteSpace&& Other) noexcept
    : m_StorageHead(Other.m_StorageHead)
    , m_TotalCapacity(Other.m_TotalCapacity)
    , m_OccupiedBytes(Other.m_OccupiedBytes)
    , m_PeakOccupiedBytes(Other.m_PeakOccupiedBytes)
{
    Other.m_StorageHead = nullptr;
    Other.m_TotalCapacity = 0;
    Other.m_OccupiedBytes = 0;
    Other.m_PeakOccupiedBytes = 0;
}

ByteSpace& ByteSpace::operator=(ByteSpace&& Other) noexcept
{
    if (this != &Other)
    {
        if (m_StorageHead)
        {
            std::free(m_StorageHead);
        }
        m_StorageHead = Other.m_StorageHead;
        m_TotalCapacity = Other.m_TotalCapacity;
        m_OccupiedBytes = Other.m_OccupiedBytes;
        m_PeakOccupiedBytes = Other.m_PeakOccupiedBytes;

        Other.m_StorageHead = nullptr;
        Other.m_TotalCapacity = 0;
        Other.m_OccupiedBytes = 0;
        Other.m_PeakOccupiedBytes = 0;
    }
    return *this;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                EXTENT OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

void* ByteSpace::AcquireSpan(size_t SizeInBytes, size_t AlignmentInBytes) noexcept
{
    if (!m_StorageHead || SizeInBytes == 0)
    {
        return nullptr;
    }

    size_t CurrentAddress = reinterpret_cast<size_t>(m_StorageHead + m_OccupiedBytes);
    size_t Misalignment = CurrentAddress % AlignmentInBytes;
    size_t Padding = (Misalignment == 0) ? 0 : (AlignmentInBytes - Misalignment);

    size_t DesiredBytes = m_OccupiedBytes + Padding + SizeInBytes;
    if (DesiredBytes > m_TotalCapacity)
    {
        return nullptr;
    }

    uint8_t* ResultLocation = m_StorageHead + m_OccupiedBytes + Padding;
    m_OccupiedBytes = DesiredBytes;
    m_PeakOccupiedBytes = std::max(m_PeakOccupiedBytes, m_OccupiedBytes);

    return ResultLocation;
}

void ByteSpace::ReclaimAll() noexcept
{
    m_OccupiedBytes = 0;
}

size_t ByteSpace::QueryOccupiedBytes() const noexcept
{
    return m_OccupiedBytes;
}

size_t ByteSpace::QueryTotalCapacity() const noexcept
{
    return m_TotalCapacity;
}

float ByteSpace::QueryOccupancyRatio() const noexcept
{
    if (m_TotalCapacity == 0)
    {
        return 0.0f;
    }
    return static_cast<float>(m_OccupiedBytes) / static_cast<float>(m_TotalCapacity);
}

} // namespace Frontier
