//============================================================================================================================================
// 📦 Frontier/Layer0_DeviceExchange/TaskScheduler.cpp — Work-Stealing Task Graph Implementation
//============================================================================================================================================

#include "TaskScheduler.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

TaskScheduler::TaskScheduler(uint32_t WorkerThreadCount) noexcept
    : m_WorkerCount(WorkerThreadCount == 0 ? std::max(1u, std::thread::hardware_concurrency()) : WorkerThreadCount)
    , m_RunningCondition(false)
{
    for (uint32_t Index = 0; Index < m_WorkerCount; ++Index)
    {
        m_Queues.push_back(std::make_unique<ExecutionQueue>());
    }
}

TaskScheduler::~TaskScheduler() noexcept
{
    Terminate();
}

void TaskScheduler::Initialize() noexcept
{
    m_RunningCondition.store(true, std::memory_order_release);
    m_Workers.reserve(m_WorkerCount);
    for (uint32_t Index = 0; Index < m_WorkerCount; ++Index)
    {
        m_Workers.emplace_back(&TaskScheduler::WorkerLoop, this, Index);
    }
}

void TaskScheduler::Terminate() noexcept
{
    if (m_RunningCondition.exchange(false, std::memory_order_acq_rel))
    {
        for (auto& Worker : m_Workers)
        {
            if (Worker.joinable())
            {
                Worker.join();
            }
        }
        m_Workers.clear();
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                TASK DISPATCHING
//------------------------------------------------------------------------------------------------------------------------

TaskToken TaskScheduler::DispatchTask(TaskFunction Task) noexcept
{
    auto* Counter = new std::atomic<uint32_t>(1);
    TaskToken Token{ Counter };

    auto WrappedTask = [Task = std::move(Task), Counter]()
    {
        Task();
        Counter->fetch_sub(1, std::memory_order_release);
    };

    if (!m_Queues.empty())
    {
        [[maybe_unused]] bool pushed = m_Queues[0]->PushBottom(std::move(WrappedTask));
    }
    return Token;
}

void TaskScheduler::DispatchParallel(uint32_t ItemCount, uint32_t ChunkSize, std::function<void(uint32_t, uint32_t)> ChunkFunction) noexcept
{
    if (ItemCount == 0 || ChunkSize == 0)
    {
        return;
    }

    uint32_t ChunkCount = (ItemCount + ChunkSize - 1) / ChunkSize;
    auto Counter = std::make_unique<std::atomic<uint32_t>>(ChunkCount);

    for (uint32_t ChunkIndex = 0; ChunkIndex < ChunkCount; ++ChunkIndex)
    {
        uint32_t Start = ChunkIndex * ChunkSize;
        uint32_t End = std::min(Start + ChunkSize, ItemCount);

        auto Task = [ChunkFunction, Start, End, &Counter]()
        {
            ChunkFunction(Start, End);
            Counter->fetch_sub(1, std::memory_order_release);
        };

        uint32_t TargetQueue = ChunkIndex % m_WorkerCount;
        [[maybe_unused]] bool pushed = m_Queues[TargetQueue]->PushBottom(std::move(Task));
    }

    while (Counter->load(std::memory_order_acquire) > 0)
    {
        std::this_thread::yield();
    }
}

void TaskScheduler::WaitForToken(TaskToken Token) noexcept
{
    if (Token.CompletionCounter)
    {
        while (Token.CompletionCounter->load(std::memory_order_acquire) > 0)
        {
            std::this_thread::yield();
        }
        delete Token.CompletionCounter;
    }
}

uint32_t TaskScheduler::QueryWorkerCount() const noexcept
{
    return m_WorkerCount;
}

void TaskScheduler::WorkerLoop(uint32_t WorkerIndex) noexcept
{
    while (m_RunningCondition.load(std::memory_order_relaxed))
    {
        TaskFunction Task;
        if (m_Queues[WorkerIndex]->PopBottom(Task))
        {
            Task();
            continue;
        }

        bool Stolen = false;
        for (uint32_t Offset = 1; Offset < m_WorkerCount; ++Offset)
        {
            uint32_t VictimIndex = (WorkerIndex + Offset) % m_WorkerCount;
            if (m_Queues[VictimIndex]->StealTop(Task))
            {
                Task();
                Stolen = true;
                break;
            }
        }

        if (!Stolen)
        {
            std::this_thread::yield();
        }
    }
}

} // namespace Frontier
