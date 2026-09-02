//============================================================================================================================================
// 📦 Frontier/Layer6_DisplayPresentation/FrontierHost.h — Engine Bootstrap Host Coordinator and Lifecycle Entry
//============================================================================================================================================

#pragma once

#include "CycleScheduler.h"
#include <memory>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    FRONTIER HOST
//------------------------------------------------------------------------------------------------------------------------

class FrontierHost
{
public:
    FrontierHost() noexcept;
    ~FrontierHost() noexcept;

    FrontierHost(const FrontierHost&) = delete;
    FrontierHost& operator=(const FrontierHost&) = delete;

    [[nodiscard]] bool      Bootstrap(uint32_t Width = 1920, uint32_t Height = 1080) noexcept;
    void                    Shutdown() noexcept;

    void                    StepOnce(float DeltaSeconds) noexcept;

    [[nodiscard]] bool      IsRunning() const noexcept { return m_RunningCondition; }
    [[nodiscard]] CycleScheduler* QueryScheduler() noexcept { return m_Scheduler.get(); }

    // Single unified conversion operator for status
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    std::unique_ptr<CycleScheduler> m_Scheduler;                // [scheduler] master execution cycle coordinator
    bool                    m_RunningCondition;                 // [bool] running lifecycle condition
};

template<>
inline bool FrontierHost::Convert<bool>() const noexcept
{
    return m_RunningCondition;
}

} // namespace Frontier
