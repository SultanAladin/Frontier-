//============================================================================================================================================
// 📦 Frontier/Layer6_DisplayPresentation/FrontierHost.cpp — Engine Bootstrap Host Implementation
//============================================================================================================================================

#include "FrontierHost.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

FrontierHost::FrontierHost() noexcept
    : m_RunningCondition(false)
{
}

FrontierHost::~FrontierHost() noexcept
{
    Shutdown();
}

bool FrontierHost::Bootstrap(uint32_t Width, uint32_t Height) noexcept
{
    CycleConfiguration config{};
    config.FixedTimeStepΔτ            = 1.0f / 60.0f;           // 60 Hz physics
    config.MaximumAccumulatorSeconds  = 0.1f;                   // 100ms cap
    config.ViewportWidth              = Width;
    config.ViewportHeight             = Height;

    m_Scheduler = std::make_unique<CycleScheduler>(config);
    if (!m_Scheduler->Initialize())
    {
        return false;
    }

    m_RunningCondition = true;
    return true;
}

void FrontierHost::Shutdown() noexcept
{
    if (m_RunningCondition)
    {
        if (m_Scheduler)
        {
            m_Scheduler->Terminate();
            m_Scheduler.reset();
        }
        m_RunningCondition = false;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                STEP EXECUTION
//------------------------------------------------------------------------------------------------------------------------

void FrontierHost::StepOnce(float DeltaSeconds) noexcept
{
    if (m_RunningCondition && m_Scheduler)
    {
        m_Scheduler->ExecuteCycle(DeltaSeconds);
    }
}

} // namespace Frontier
