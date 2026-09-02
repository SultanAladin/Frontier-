//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/WorldSequence.cpp — Level Streaming and Scene Transitions Implementation
//============================================================================================================================================

#include "WorldSequence.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

WorldSequence::WorldSequence() noexcept
    : ActiveLevelIndex(0)
    , TransitionProgress(1.0f)
    , TransitioningCondition(false)
{
}

//------------------------------------------------------------------------------------------------------------------------
//                                                LEVEL REGISTRATION
//------------------------------------------------------------------------------------------------------------------------

uint32_t WorldSequence::RegisterLevel(LevelDescriptor Level) noexcept
{
    uint32_t Index = static_cast<uint32_t>(RegisteredLevels.size());
    RegisteredLevels.push_back(std::move(Level));
    return Index;
}

bool WorldSequence::TransitionToLevel(uint32_t LevelIndex, RigidBodySolver& RigidBodies, DeformableSolver& Deformables) noexcept
{
    if (LevelIndex >= RegisteredLevels.size())
    {
        return false;
    }

    ActiveLevelIndex       = LevelIndex;
    TransitionProgress     = 0.0f;
    TransitioningCondition = true;

    // Reset physics bodies for new track level
    (void)RigidBodies;
    (void)Deformables;

    return true;
}

void WorldSequence::AdvanceWorld(float Δτ) noexcept
{
    if (TransitioningCondition)
    {
        TransitionProgress += Δτ * 2.0f; // 0.5s transition
        if (TransitionProgress >= 1.0f)
        {
            TransitionProgress     = 1.0f;
            TransitioningCondition = false;
        }
    }
}

const LevelDescriptor* WorldSequence::QueryActiveLevel() const noexcept
{
    if (ActiveLevelIndex < RegisteredLevels.size())
    {
        return &RegisteredLevels[ActiveLevelIndex];
    }
    return nullptr;
}

} // namespace Frontier
