//============================================================================================================================================
//                                                      RESTIRINTEGRATOR.H
//============================================================================================================================================
// 🧩 Accumulates ReSTIR DI+GI radiance by numerically integrating light transport paths on the GPU compute pipeline.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "../DeviceExchange/SwapchainExchange.h"
#include "../../Projects/Project-Zero/Source/RayTracingSolver.h"
#include "../../Projects/Project-Zero/Source/FlyThroughSolver.h"
#include <cstdint>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           RESTIR INTEGRATOR CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct ReSTIRIntegratorConfiguration
{
    uint32_t    CandidatesPerPixel;         // [-]   primary DI candidates per pixel
    uint32_t    SpatialPassCount;           // [-]   ReSTIR spatial resampling passes
    float       Exposure;                   // [-]   ACES tone-map exposure scalar
    float       AmbientStrength;            // [-]   ambient fallback contribution
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  RESTIR INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class ReSTIRIntegrator
{
public:
    explicit ReSTIRIntegrator(ReSTIRIntegratorConfiguration InitialConfiguration) noexcept;
    ~ReSTIRIntegrator() noexcept = default;

    ReSTIRIntegrator(const ReSTIRIntegrator&)            = delete;
    ReSTIRIntegrator& operator=(const ReSTIRIntegrator&) = delete;

    // Construct the DispatchConfiguration from live camera state and scene counts
    [[nodiscard]] DispatchConfiguration
    BuildDispatch(const ProjectZero::FlyThroughSolver& Camera,
                  uint32_t                             ViewportWidth,
                  uint32_t                             ViewportHeight,
                  uint32_t                             TriangleCount,
                  uint32_t                             LuminaireTriangleCount) const noexcept;

    // Count emissive triangles in the scene (used to set LuminaireTriangleCount each frame)
    [[nodiscard]] static uint32_t
    CountLuminaireTriangles(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Build GPU triangle and material records from the CPU scene
    [[nodiscard]] static std::vector<TriangleIndex>
    BuildTriangleIndex(const ProjectZero::RayTracingSolver& Scene) noexcept;

    [[nodiscard]] static std::vector<RadianceStructure>
    BuildRadianceStructures(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Mutable configuration — updated live by RenderScheduler
    void AssignCandidatesPerPixel(uint32_t Count) noexcept { ActiveConfiguration.CandidatesPerPixel = Count; }
    void AssignSpatialPassCount  (uint32_t Count) noexcept { ActiveConfiguration.SpatialPassCount   = Count; }
    void AssignExposure          (float    Value) noexcept { ActiveConfiguration.Exposure            = Value; }

    [[nodiscard]] const ReSTIRIntegratorConfiguration& QueryConfiguration() const noexcept
    {
        return ActiveConfiguration;
    }

    void IncrementAccumulationIndex() noexcept { AccumulationIndex++; }
    [[nodiscard]] uint32_t QueryAccumulationIndex() const noexcept { return AccumulationIndex; }

    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    ReSTIRIntegratorConfiguration ActiveConfiguration;  // [-]  live-tunable parameters
    uint32_t                      AccumulationIndex;    // [-]  temporal frame counter (incremented per frame)
};

template<>
inline uint32_t ReSTIRIntegrator::Convert<uint32_t>() const noexcept
{
    return AccumulationIndex;
}

template<>
inline float ReSTIRIntegrator::Convert<float>() const noexcept
{
    return ActiveConfiguration.Exposure;
}

} // namespace Frontier
