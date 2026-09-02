//============================================================================================================================================
// 📦 Frontier/Layer1_PhysicalDynamics/RigidBodySolver.h — Multi-Threaded Rigid Body Constraint and Manifold Solver
//============================================================================================================================================

#pragma once

#include "RigidBodyStructure.h"
#include "../Layer0_DeviceExchange/TaskScheduler.h"
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                  RIGID BODY SOLVER
//------------------------------------------------------------------------------------------------------------------------

class RigidBodySolver
{
public:
    explicit RigidBodySolver(TaskScheduler* Scheduler) noexcept;
    ~RigidBodySolver() noexcept = default;

    RigidBodySolver(const RigidBodySolver&) = delete;
    RigidBodySolver& operator=(const RigidBodySolver&) = delete;

    [[nodiscard]] bool      Initialize() noexcept;
    void                    Terminate() noexcept;

    [[nodiscard]] uint64_t  RegisterBody(const RigidBodyStructure& Body) noexcept;
    void                    UnregisterBody(uint64_t BodyIdentifier) noexcept;

    void                    AdvanceSimulation(float Δτ) noexcept;

    [[nodiscard]] const RigidBodyStructure* QueryBody(uint64_t BodyIdentifier) const noexcept;
    [[nodiscard]] size_t    QueryActiveBodyCount() const noexcept;

    // Single unified conversion operator for active body metrics
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    TaskScheduler*          m_Scheduler;                        // [ptr] task graph scheduler reference
    std::vector<RigidBodyStructure> m_Bodies;                   // [bodies] contiguous body records
    Vector3                 m_GravitationalAcceleration;        // [m/s²] continuous gravity vector
    bool                    m_InitializedCondition;             // [bool] lifecycle status
};

template<>
inline size_t RigidBodySolver::Convert<size_t>() const noexcept
{
    return QueryActiveBodyCount();
}

} // namespace Frontier
