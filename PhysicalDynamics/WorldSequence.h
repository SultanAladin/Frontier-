//============================================================================================================================================
// 📦 Frontier/PhysicalDynamics/WorldSequence.h — World Streaming, Track Level Loading and Scene Transitions
//============================================================================================================================================

#pragma once

#include "RigidBodySolver.h"
#include "DeformableSolver.h"
#include <string>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                 LEVEL DESCRIPTOR
//------------------------------------------------------------------------------------------------------------------------

struct LevelDescriptor
{
    std::string             LevelIdentifier;                    // [token] unique level or track identifier
    std::string             DisplayName;                        // [text] display level name
    Vector3                 SpawnLocation;                      // [m] initial vehicle / player spawn point
    Vector3                 SunDirection;                       // [-] primary directional sun vector
    Vector3                 SunRadiance;                        // [lux] sun light radiance
    uint32_t                TotalCheckpoints;                   // [count] track checkpoint triggers
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   WORLD SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

class WorldSequence
{
public:
    WorldSequence() noexcept;
    ~WorldSequence() noexcept = default;

    WorldSequence(const WorldSequence&) = delete;
    WorldSequence& operator=(const WorldSequence&) = delete;

    uint32_t                RegisterLevel(LevelDescriptor Level) noexcept;
    [[nodiscard]] bool      TransitionToLevel(uint32_t LevelIndex, RigidBodySolver& RigidBodies, DeformableSolver& Deformables) noexcept;

    void                    AdvanceWorld(float Δτ) noexcept;

    [[nodiscard]] uint32_t  QueryActiveLevelIndex() const noexcept { return ActiveLevelIndex; }
    [[nodiscard]] const LevelDescriptor* QueryActiveLevel() const noexcept;
    [[nodiscard]] float     QueryTransitionProgress() const noexcept { return TransitionProgress; }

    // Single unified conversion operator for level count
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    std::vector<LevelDescriptor> RegisteredLevels;              // [levels] available track environments
    uint32_t                ActiveLevelIndex;                   // [index] currently loaded level
    float                   TransitionProgress;                 // [0..1] level fade transition progress
    bool                    TransitioningCondition;             // [bool] true when streaming level assets
};

template<>
inline size_t WorldSequence::Convert<size_t>() const noexcept
{
    return RegisteredLevels.size();
}

template<>
inline uint32_t WorldSequence::Convert<uint32_t>() const noexcept
{
    return ActiveLevelIndex;
}

} // namespace Frontier
