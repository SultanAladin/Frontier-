//============================================================================================================================================
// 📦 Frontier/Layer1_PhysicalDynamics/RigidBodySolver.cpp — Rigid Body Dynamics Solver Implementation
//============================================================================================================================================

#include "RigidBodySolver.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

RigidBodySolver::RigidBodySolver(TaskScheduler* Scheduler) noexcept
    : m_Scheduler(Scheduler)
    , m_GravitationalAcceleration(0.0f, -9.81f, 0.0f)
    , m_InitializedCondition(false)
{
}

bool RigidBodySolver::Initialize() noexcept
{
    m_Bodies.reserve(4096);
    m_InitializedCondition = true;
    return true;
}

void RigidBodySolver::Terminate() noexcept
{
    m_Bodies.clear();
    m_InitializedCondition = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                BODY REGISTRATION
//------------------------------------------------------------------------------------------------------------------------

uint64_t RigidBodySolver::RegisterBody(const RigidBodyStructure& Body) noexcept
{
    m_Bodies.push_back(Body);
    return Body.BodyIdentifier;
}

void RigidBodySolver::UnregisterBody(uint64_t BodyIdentifier) noexcept
{
    auto iterator = std::remove_if(m_Bodies.begin(), m_Bodies.end(),
        [BodyIdentifier](const RigidBodyStructure& b) { return b.BodyIdentifier == BodyIdentifier; });
    m_Bodies.erase(iterator, m_Bodies.end());
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SIMULATION INTEGRATION
//------------------------------------------------------------------------------------------------------------------------

void RigidBodySolver::AdvanceSimulation(float Δτ) noexcept
{
    if (m_Bodies.empty() || Δτ <= 0.0f)
    {
        return;
    }

    auto IntegrateChunk = [this, Δτ](uint32_t Start, uint32_t End)
    {
        for (uint32_t Index = Start; Index < End; ++Index)
        {
            auto& Body = m_Bodies[Index];
            if (!Body.MotionActive || Body.InertialMass <= 0.0f)
            {
                continue;
            }

            // Newtonian integration: v += g * Δτ
            Body.LinearMomentum += m_GravitationalAcceleration * Δτ;
            Body.LinearMomentum *= (1.0f - Body.LinearDamping * Δτ);

            // Position update: p += v * Δτ
            Body.SpatialLocation += Body.LinearMomentum * Δτ;

            // Ground floor constraint (y >= 0)
            if (Body.SpatialLocation.y < 0.0f)
            {
                Body.SpatialLocation.y = 0.0f;
                Body.LinearMomentum.y = -Body.LinearMomentum.y * Body.RestitutionCoefficient;
                Body.LinearMomentum.x *= (1.0f - Body.FrictionCoefficient);
                Body.LinearMomentum.z *= (1.0f - Body.FrictionCoefficient);
            }
        }
    };

    if (m_Scheduler && m_Bodies.size() > 64)
    {
        m_Scheduler->DispatchParallel(static_cast<uint32_t>(m_Bodies.size()), 64, IntegrateChunk);
    }
    else
    {
        IntegrateChunk(0, static_cast<uint32_t>(m_Bodies.size()));
    }
}

const RigidBodyStructure* RigidBodySolver::QueryBody(uint64_t BodyIdentifier) const noexcept
{
    for (const auto& Body : m_Bodies)
    {
        if (Body.BodyIdentifier == BodyIdentifier)
        {
            return &Body;
        }
    }
    return nullptr;
}

size_t RigidBodySolver::QueryActiveBodyCount() const noexcept
{
    return m_Bodies.size();
}

} // namespace Frontier
