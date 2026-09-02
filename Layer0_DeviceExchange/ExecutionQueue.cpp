//============================================================================================================================================
// 📦 Frontier/Layer0_DeviceExchange/ExecutionQueue.cpp — Lock-Free Double-Ended Task Stealing Implementation
//============================================================================================================================================

#include "ExecutionQueue.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

ExecutionQueue::ExecutionQueue(size_t InitialCapacity) noexcept
    : m_Tasks(InitialCapacity)
    , m_TopIndex(0)
    , m_BottomIndex(0)
{
}

//------------------------------------------------------------------------------------------------------------------------
//                                                QUEUE OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

bool ExecutionQueue::PushBottom(TaskFunction Task) noexcept
{
    int64_t Bottom = m_BottomIndex.load(std::memory_order_relaxed);
    int64_t Top = m_TopIndex.load(std::memory_order_acquire);

    if (Bottom - Top >= static_cast<int64_t>(m_Tasks.size()))
    {
        return false;
    }

    m_Tasks[Bottom % m_Tasks.size()] = std::move(Task);
    m_BottomIndex.store(Bottom + 1, std::memory_order_release);
    return true;
}

bool ExecutionQueue::PopBottom(TaskFunction& OutTask) noexcept
{
    int64_t Bottom = m_BottomIndex.load(std::memory_order_relaxed) - 1;
    m_BottomIndex.store(Bottom, std::memory_order_seq_cst);
    int64_t Top = m_TopIndex.load(std::memory_order_seq_cst);

    if (Top <= Bottom)
    {
        OutTask = std::move(m_Tasks[Bottom % m_Tasks.size()]);
        if (Top == Bottom)
        {
            if (!m_TopIndex.compare_exchange_strong(Top, Top + 1, std::memory_order_seq_cst, std::memory_order_relaxed))
            {
                m_BottomIndex.store(Bottom + 1, std::memory_order_relaxed);
                return false;
            }
            m_BottomIndex.store(Bottom + 1, std::memory_order_relaxed);
        }
        return true;
    }

    m_BottomIndex.store(Bottom + 1, std::memory_order_relaxed);
    return false;
}

bool ExecutionQueue::StealTop(TaskFunction& OutTask) noexcept
{
    int64_t Top = m_TopIndex.load(std::memory_order_acquire);
    int64_t Bottom = m_BottomIndex.load(std::memory_order_acquire);

    if (Top < Bottom)
    {
        OutTask = m_Tasks[Top % m_Tasks.size()];
        if (m_TopIndex.compare_exchange_strong(Top, Top + 1, std::memory_order_seq_cst, std::memory_order_relaxed))
        {
            return true;
        }
    }
    return false;
}

size_t ExecutionQueue::QueryTaskCount() const noexcept
{
    int64_t Top = m_TopIndex.load(std::memory_order_relaxed);
    int64_t Bottom = m_BottomIndex.load(std::memory_order_relaxed);
    return (Bottom > Top) ? static_cast<size_t>(Bottom - Top) : 0;
}

} // namespace Frontier
