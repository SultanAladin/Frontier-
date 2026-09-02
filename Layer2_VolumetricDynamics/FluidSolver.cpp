//============================================================================================================================================
// 📦 Frontier/Layer2_VolumetricDynamics/FluidSolver.cpp — 3D Eulerian Navier-Stokes Fluid Solver Implementation
//============================================================================================================================================

#include "FluidSolver.h"
#include <algorithm>
#include <cmath>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

FluidSolver::FluidSolver(FluidConfiguration Config) noexcept
    : m_Config(Config)
    , m_CellCount(static_cast<size_t>(Config.ResolutionX * Config.ResolutionY * Config.ResolutionZ))
    , m_Density(m_CellCount, 0.0f)
    , m_DensityScratch(m_CellCount, 0.0f)
    , m_Temperature(m_CellCount, Config.AmbientTemperature)
    , m_TemperatureScratch(m_CellCount, Config.AmbientTemperature)
    , m_Velocity(m_CellCount, Vector3{ 0.0f, 0.0f, 0.0f })
    , m_VelocityScratch(m_CellCount, Vector3{ 0.0f, 0.0f, 0.0f })
    , m_Divergence(m_CellCount, 0.0f)
    , m_Pressure(m_CellCount, 0.0f)
    , m_PressureScratch(m_CellCount, 0.0f)
{
}

size_t FluidSolver::CellIndex(uint32_t x, uint32_t y, uint32_t z) const noexcept
{
    return static_cast<size_t>(z * (m_Config.ResolutionX * m_Config.ResolutionY) + y * m_Config.ResolutionX + x);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                INJECTION OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

void FluidSolver::InjectDensity(uint32_t x, uint32_t y, uint32_t z, float Amount) noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        m_Density[CellIndex(x, y, z)] += Amount;
    }
}

void FluidSolver::InjectTemperature(uint32_t x, uint32_t y, uint32_t z, float Kelvins) noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        m_Temperature[CellIndex(x, y, z)] = Kelvins;
    }
}

void FluidSolver::InjectMomentum(uint32_t x, uint32_t y, uint32_t z, const Vector3& Impulse) noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        m_Velocity[CellIndex(x, y, z)] += Impulse;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SIMULATION INTEGRATION
//------------------------------------------------------------------------------------------------------------------------

void FluidSolver::AdvanceSimulation(float Δτ, const LevelSetSpace* SolidBoundaries) noexcept
{
    if (Δτ <= 0.0f)
    {
        return;
    }

    ApplyBuoyancy(Δτ);
    AdvectFields(Δτ);
    ProjectPressure(SolidBoundaries);
}

void FluidSolver::ApplyBuoyancy(float Δτ) noexcept
{
    for (uint32_t z = 0; z < m_Config.ResolutionZ; ++z)
    {
        for (uint32_t y = 0; y < m_Config.ResolutionY; ++y)
        {
            for (uint32_t x = 0; x < m_Config.ResolutionX; ++x)
            {
                size_t idx = CellIndex(x, y, z);
                float Dens = m_Density[idx];
                float Temp = m_Temperature[idx];

                // Buoyancy force: f = (-alpha * rho + beta * (T - T_amb)) * g
                float BuoyantForce = -m_Config.BuoyancyAlpha * Dens + m_Config.BuoyancyBeta * (Temp - m_Config.AmbientTemperature);
                m_Velocity[idx].y += BuoyantForce * 9.81f * Δτ;
            }
        }
    }
}

void FluidSolver::AdvectFields(float Δτ) noexcept
{
    float invCell = 1.0f / m_Config.CellWidth;

    for (uint32_t z = 1; z < m_Config.ResolutionZ - 1; ++z)
    {
        for (uint32_t y = 1; y < m_Config.ResolutionY - 1; ++y)
        {
            for (uint32_t x = 1; x < m_Config.ResolutionX - 1; ++x)
            {
                size_t idx = CellIndex(x, y, z);
                Vector3 vel = m_Velocity[idx];

                // Backtrace position: x_prev = x - v * Δτ
                float px = static_cast<float>(x) - vel.x * Δτ * invCell;
                float py = static_cast<float>(y) - vel.y * Δτ * invCell;
                float pz = static_cast<float>(z) - vel.z * Δτ * invCell;

                int32_t sx = std::clamp(static_cast<int32_t>(px), 0, static_cast<int32_t>(m_Config.ResolutionX - 1));
                int32_t sy = std::clamp(static_cast<int32_t>(py), 0, static_cast<int32_t>(m_Config.ResolutionY - 1));
                int32_t sz = std::clamp(static_cast<int32_t>(pz), 0, static_cast<int32_t>(m_Config.ResolutionZ - 1));

                size_t sidx = CellIndex(sx, sy, sz);
                m_DensityScratch[idx] = m_Density[sidx];
                m_TemperatureScratch[idx] = m_Temperature[sidx];
                m_VelocityScratch[idx] = m_Velocity[sidx];
            }
        }
    }

    m_Density = m_DensityScratch;
    m_Temperature = m_TemperatureScratch;
    m_Velocity = m_VelocityScratch;
}

void FluidSolver::ProjectPressure(const LevelSetSpace* SolidBoundaries) noexcept
{
    float invCell2 = 1.0f / (2.0f * m_Config.CellWidth);

    // 1. Compute velocity divergence: ∇ · u
    for (uint32_t z = 1; z < m_Config.ResolutionZ - 1; ++z)
    {
        for (uint32_t y = 1; y < m_Config.ResolutionY - 1; ++y)
        {
            for (uint32_t x = 1; x < m_Config.ResolutionX - 1; ++x)
            {
                size_t idx = CellIndex(x, y, z);
                float du_dx = (m_Velocity[CellIndex(x + 1, y, z)].x - m_Velocity[CellIndex(x - 1, y, z)].x) * invCell2;
                float dv_dy = (m_Velocity[CellIndex(x, y + 1, z)].y - m_Velocity[CellIndex(x, y - 1, z)].y) * invCell2;
                float dw_dz = (m_Velocity[CellIndex(x, y, z + 1)].z - m_Velocity[CellIndex(x, y, z - 1)].z) * invCell2;

                m_Divergence[idx] = du_dx + dv_dy + dw_dz;
                m_Pressure[idx] = 0.0f;
            }
        }
    }

    // 2. Jacobi Poisson pressure iterations: ∇²p = ∇ · u
    for (uint32_t iter = 0; iter < m_Config.PressureIterations; ++iter)
    {
        for (uint32_t z = 1; z < m_Config.ResolutionZ - 1; ++z)
        {
            for (uint32_t y = 1; y < m_Config.ResolutionY - 1; ++y)
            {
                for (uint32_t x = 1; x < m_Config.ResolutionX - 1; ++x)
                {
                    size_t idx = CellIndex(x, y, z);
                    float p_sum = m_Pressure[CellIndex(x + 1, y, z)] + m_Pressure[CellIndex(x - 1, y, z)]
                                + m_Pressure[CellIndex(x, y + 1, z)] + m_Pressure[CellIndex(x, y - 1, z)]
                                + m_Pressure[CellIndex(x, y, z + 1)] + m_Pressure[CellIndex(x, y, z - 1)];

                    m_PressureScratch[idx] = (p_sum - m_Divergence[idx] * (m_Config.CellWidth * m_Config.CellWidth)) / 6.0f;
                }
            }
        }
        m_Pressure = m_PressureScratch;
    }

    // 3. Project velocity: u -= ∇p
    for (uint32_t z = 1; z < m_Config.ResolutionZ - 1; ++z)
    {
        for (uint32_t y = 1; y < m_Config.ResolutionY - 1; ++y)
        {
            for (uint32_t x = 1; x < m_Config.ResolutionX - 1; ++x)
            {
                size_t idx = CellIndex(x, y, z);
                float dp_dx = (m_Pressure[CellIndex(x + 1, y, z)] - m_Pressure[CellIndex(x - 1, y, z)]) * invCell2;
                float dp_dy = (m_Pressure[CellIndex(x, y + 1, z)] - m_Pressure[CellIndex(x, y - 1, z)]) * invCell2;
                float dp_dz = (m_Pressure[CellIndex(x, y, z + 1)] - m_Pressure[CellIndex(x, y, z - 1)]) * invCell2;

                m_Velocity[idx].x -= dp_dx;
                m_Velocity[idx].y -= dp_dy;
                m_Velocity[idx].z -= dp_dz;

                // LevelSetSpace solid boundary masking: u · n = 0
                if (SolidBoundaries)
                {
                    Vector3 CellPos{
                        static_cast<float>(x) * m_Config.CellWidth,
                        static_cast<float>(y) * m_Config.CellWidth,
                        static_cast<float>(z) * m_Config.CellWidth
                    };

                    if (SolidBoundaries->IsInsideSolid(CellPos))
                    {
                        Vector3 SolidNormal = SolidBoundaries->SampleGradient(CellPos);
                        float NormalVelocity = OrientationClassifier::DotProduct(m_Velocity[idx], SolidNormal);
                        if (NormalVelocity < 0.0f)
                        {
                            m_Velocity[idx] -= SolidNormal * NormalVelocity;
                        }
                    }
                }
            }
        }
    }
}

float FluidSolver::QueryDensity(uint32_t x, uint32_t y, uint32_t z) const noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        return m_Density[CellIndex(x, y, z)];
    }
    return 0.0f;
}

float FluidSolver::QueryTemperature(uint32_t x, uint32_t y, uint32_t z) const noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        return m_Temperature[CellIndex(x, y, z)];
    }
    return m_Config.AmbientTemperature;
}

Vector3 FluidSolver::QueryVelocity(uint32_t x, uint32_t y, uint32_t z) const noexcept
{
    if (x < m_Config.ResolutionX && y < m_Config.ResolutionY && z < m_Config.ResolutionZ)
    {
        return m_Velocity[CellIndex(x, y, z)];
    }
    return Vector3{ 0.0f, 0.0f, 0.0f };
}

} // namespace Frontier
