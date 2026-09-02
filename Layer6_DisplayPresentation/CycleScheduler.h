//============================================================================================================================================
// 📦 Frontier/Layer6_DisplayPresentation/CycleScheduler.h — 14-Phase Deterministic Dual-Clock Execution Scheduler
//============================================================================================================================================

#pragma once

#include "../Layer0_DeviceExchange/VulkanExchange.h"
#include "../Layer0_DeviceExchange/ByteSpace.h"
#include "../Layer0_DeviceExchange/TaskScheduler.h"
#include "../Layer0_DeviceExchange/VendorClassifier.h"
#include "../Layer1_PhysicalDynamics/RigidBodySolver.h"
#include "../Layer1_PhysicalDynamics/DeformableSolver.h"
#include "../Layer1_PhysicalDynamics/LocomotionSolver.h"
#include "../Layer2_VolumetricDynamics/LevelSetSpace.h"
#include "../Layer2_VolumetricDynamics/FluidSolver.h"
#include "../Layer2_VolumetricDynamics/ParticleIntegrator.h"
#include "../Layer3_GeometricRaster/GeometryStructure.h"
#include "../Layer3_GeometricRaster/VisibilityProjection.h"
#include "../Layer3_GeometricRaster/RasterSequence.h"
#include "../Layer3_GeometricRaster/MaterialCodec.h"
#include "../Layer4_PhotometricIllumination/ClusteredSpace.h"
#include "../Layer4_PhotometricIllumination/DirectIlluminationIntegrator.h"
#include "../Layer4_PhotometricIllumination/GlobalIlluminationIntegrator.h"
#include "../Layer4_PhotometricIllumination/AtmosphereIntegrator.h"
#include "../Layer5_PlatformInterchange/OnlineInterchange.h"
#include "../Layer5_PlatformInterchange/AcousticStructure.h"
#include "../Layer5_PlatformInterchange/AcousticIntegrator.h"
#include "WorkspacePanel.h"
#include <memory>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                CYCLE CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct CycleConfiguration
{
    float                   FixedTimeStepΔτ;                    // [s] fixed simulation timestep Δτ (e.g. 1/60s)
    float                   MaximumAccumulatorSeconds;          // [s] maximum accumulated physics debt
    uint32_t                ViewportWidth;                      // [px] target presentation width
    uint32_t                ViewportHeight;                     // [px] target presentation height
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 CYCLE TELEMETRY
//------------------------------------------------------------------------------------------------------------------------

struct CycleTelemetry
{
    uint64_t                CycleIndex;                         // [counter] total rendered frame cycles
    float                   FrameTimeSeconds;                   // [s] wall-clock delta time
    float                   AccumulatorSeconds;                 // [s] remaining unconsumed physics debt
    float                   InterpolationAlpha;                 // [0..1] render interpolation factor α
    size_t                  ActiveRigidBodies;                  // [count] active rigid bodies
    size_t                  ActiveDeformableParticles;          // [count] active softbody particles
    size_t                  ActiveParticles;                    // [count] active compute particles
    size_t                  ByteSpaceOccupiedBytes;             // [B] linear storage bytes used
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   CYCLE SCHEDULER
//------------------------------------------------------------------------------------------------------------------------

class CycleScheduler
{
public:
    explicit CycleScheduler(CycleConfiguration Config) noexcept;
    ~CycleScheduler() noexcept;

    CycleScheduler(const CycleScheduler&) = delete;
    CycleScheduler& operator=(const CycleScheduler&) = delete;

    [[nodiscard]] bool      Initialize() noexcept;
    void                    Terminate() noexcept;

    void                    ExecuteCycle(float WallClockDeltaSeconds) noexcept;

    [[nodiscard]] const CycleTelemetry& QueryTelemetry() const noexcept { return m_Telemetry; }
    [[nodiscard]] WorkspacePanel&       QueryWorkspacePanel() noexcept { return m_WorkspacePanel; }

    // Single unified conversion operator for telemetry
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    CycleConfiguration      m_Config;                           // [config] loop parameters
    CycleTelemetry          m_Telemetry;                        // [telemetry] per-cycle profiling metrics

    // Layer 0: Device Exchange
    std::unique_ptr<VulkanExchange>       m_VulkanExchange;
    std::unique_ptr<ByteSpace>            m_ByteSpace;
    std::unique_ptr<TaskScheduler>        m_TaskScheduler;
    std::unique_ptr<VendorClassifier>     m_VendorClassifier;

    // Layer 1: Physical Dynamics
    std::unique_ptr<RigidBodySolver>      m_RigidBodySolver;
    std::unique_ptr<DeformableSolver>     m_DeformableSolver;
    std::unique_ptr<LocomotionSolver>     m_LocomotionSolver;

    // Layer 2: Volumetric Dynamics
    std::unique_ptr<LevelSetSpace>        m_LevelSetSpace;
    std::unique_ptr<FluidSolver>          m_FluidSolver;
    std::unique_ptr<ParticleIntegrator>   m_ParticleIntegrator;

    // Layer 3: Geometric Raster
    std::unique_ptr<GeometryStructure>    m_GeometryStructure;
    std::unique_ptr<VisibilityProjection> m_VisibilityProjection;
    std::unique_ptr<RasterSequence>       m_RasterSequence;
    std::unique_ptr<MaterialCodec>        m_MaterialCodec;

    // Layer 4: Photometric Illumination
    std::unique_ptr<ClusteredSpace>                m_ClusteredSpace;
    std::unique_ptr<DirectIlluminationIntegrator>  m_DirectIlluminationIntegrator;
    std::unique_ptr<GlobalIlluminationIntegrator>  m_GlobalIlluminationIntegrator;
    std::unique_ptr<AtmosphereIntegrator>          m_AtmosphereIntegrator;

    // Layer 5: Platform Interchange
    std::unique_ptr<OnlineInterchange>    m_OnlineInterchange;
    std::unique_ptr<AcousticStructure>    m_AcousticStructure;
    std::unique_ptr<AcousticIntegrator>   m_AcousticIntegrator;

    // Layer 6: Presentation
    WorkspacePanel                        m_WorkspacePanel;

    // Frame Buffers
    std::vector<PhotometricLightRecord>   m_Lights;
    std::vector<Vector4>                  m_RadianceField;
};

template<>
inline CycleTelemetry CycleScheduler::Convert<CycleTelemetry>() const noexcept
{
    return m_Telemetry;
}

template<>
inline uint64_t CycleScheduler::Convert<uint64_t>() const noexcept
{
    return m_Telemetry.CycleIndex;
}

} // namespace Frontier
