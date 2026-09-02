//============================================================================================================================================
// 📦 Frontier/Layer2_VolumetricDynamics/FluidSolver.h — 3D Eulerian Incompressible Navier-Stokes Fluid and Gas Solver
//============================================================================================================================================

#pragma once

#include "LevelSetSpace.h"
#include <vector>
#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                FLUID CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct FluidConfiguration
{
    uint32_t                ResolutionX;                        // [cells] domain resolution along X
    uint32_t                ResolutionY;                        // [cells] domain resolution along Y
    uint32_t                ResolutionZ;                        // [cells] domain resolution along Z
    float                   CellWidth;                          // [m] spatial cell size Δx
    float                   KinematicViscosity;                 // [m²/s] kinematic fluid viscosity ν
    float                   BuoyancyAlpha;                      // [1/K] smoke weight factor α
    float                   BuoyancyBeta;                       // [1/K] thermal expansion factor β
    float                   AmbientTemperature;                 // [K] reference background temperature
    uint32_t                PressureIterations;                 // [count] Jacobi Poisson solver iterations
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    FLUID SOLVER
//------------------------------------------------------------------------------------------------------------------------

class FluidSolver
{
public:
    explicit FluidSolver(FluidConfiguration Config) noexcept;
    ~FluidSolver() noexcept = default;

    FluidSolver(const FluidSolver&) = delete;
    FluidSolver& operator=(const FluidSolver&) = delete;

    void                    InjectDensity(uint32_t x, uint32_t y, uint32_t z, float Amount) noexcept;
    void                    InjectTemperature(uint32_t x, uint32_t y, uint32_t z, float Kelvins) noexcept;
    void                    InjectMomentum(uint32_t x, uint32_t y, uint32_t z, const Vector3& Impulse) noexcept;

    void                    AdvanceSimulation(float Δτ, const LevelSetSpace* SolidBoundaries = nullptr) noexcept;

    [[nodiscard]] float     QueryDensity(uint32_t x, uint32_t y, uint32_t z) const noexcept;
    [[nodiscard]] float     QueryTemperature(uint32_t x, uint32_t y, uint32_t z) const noexcept;
    [[nodiscard]] Vector3   QueryVelocity(uint32_t x, uint32_t y, uint32_t z) const noexcept;

    // Single unified conversion operator for total fluid cells
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    [[nodiscard]] size_t    CellIndex(uint32_t x, uint32_t y, uint32_t z) const noexcept;
    void                    AdvectFields(float Δτ) noexcept;
    void                    ApplyBuoyancy(float Δτ) noexcept;
    void                    ProjectPressure(const LevelSetSpace* SolidBoundaries) noexcept;

    FluidConfiguration      m_Config;                           // [config] physical configuration parameters
    size_t                  m_CellCount;                        // [cells] total voxel count in domain
    std::vector<float>      m_Density;                          // [kg/m³] density scalar field
    std::vector<float>      m_DensityScratch;                   // [kg/m³] advection scratch field
    std::vector<float>      m_Temperature;                      // [K] temperature field
    std::vector<float>      m_TemperatureScratch;               // [K] advection scratch field
    std::vector<Vector3>    m_Velocity;                         // [m/s] continuous 3D velocity field
    std::vector<Vector3>    m_VelocityScratch;                  // [m/s] advection scratch field
    std::vector<float>      m_Divergence;                       // [1/s] velocity divergence field
    std::vector<float>      m_Pressure;                         // [Pa] scalar Poisson pressure field
    std::vector<float>      m_PressureScratch;                  // [Pa] Jacobi scratch field
};

template<>
inline size_t FluidSolver::Convert<size_t>() const noexcept
{
    return m_CellCount;
}

} // namespace Frontier
