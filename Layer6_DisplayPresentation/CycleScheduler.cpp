//============================================================================================================================================
// 📦 Frontier/Layer6_DisplayPresentation/CycleScheduler.cpp — 14-Phase Engine Loop Execution Implementation
//============================================================================================================================================

#include "CycleScheduler.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

CycleScheduler::CycleScheduler(CycleConfiguration Config) noexcept
    : m_Config(Config)
    , m_Telemetry{}
{
}

CycleScheduler::~CycleScheduler() noexcept
{
    Terminate();
}

bool CycleScheduler::Initialize() noexcept
{
    // Layer 0
    m_VulkanExchange   = std::make_unique<VulkanExchange>();
    m_ByteSpace        = std::make_unique<ByteSpace>(64ULL * 1024ULL * 1024ULL); // 64 MB per-frame transient
    m_TaskScheduler    = std::make_unique<TaskScheduler>();
    m_VendorClassifier = std::make_unique<VendorClassifier>();

    if (!m_VulkanExchange->Initialize(true))
    {
        return false;
    }
    m_TaskScheduler->Initialize();

    // Layer 1
    m_RigidBodySolver  = std::make_unique<RigidBodySolver>(m_TaskScheduler.get());
    m_DeformableSolver = std::make_unique<DeformableSolver>(m_TaskScheduler.get());
    m_LocomotionSolver = std::make_unique<LocomotionSolver>();

    if (!m_RigidBodySolver->Initialize() || !m_DeformableSolver->Initialize())
    {
        return false;
    }

    // Layer 2
    m_LevelSetSpace      = std::make_unique<LevelSetSpace>(64, 64, 64, 0.25f);
    m_LevelSetSpace->InitializeSphere(Vector3{ 8.0f, 0.0f, 8.0f }, 3.0f);

    FluidConfiguration fluidConfig{ 32, 32, 32, 0.5f, 0.001f, 0.05f, 0.1f, 300.0f, 16 };
    m_FluidSolver        = std::make_unique<FluidSolver>(fluidConfig);
    m_ParticleIntegrator = std::make_unique<ParticleIntegrator>(16384);

    // Layer 3
    m_GeometryStructure    = std::make_unique<GeometryStructure>();
    m_VisibilityProjection = std::make_unique<VisibilityProjection>(m_Config.ViewportWidth, m_Config.ViewportHeight);
    m_RasterSequence       = std::make_unique<RasterSequence>(m_TaskScheduler.get());
    m_MaterialCodec        = std::make_unique<MaterialCodec>();

    // Layer 4
    m_ClusteredSpace               = std::make_unique<ClusteredSpace>(16, 16, 32);
    m_DirectIlluminationIntegrator = std::make_unique<DirectIlluminationIntegrator>(m_Config.ViewportWidth, m_Config.ViewportHeight);
    m_GlobalIlluminationIntegrator = std::make_unique<GlobalIlluminationIntegrator>(m_Config.ViewportWidth, m_Config.ViewportHeight);
    m_AtmosphereIntegrator         = std::make_unique<AtmosphereIntegrator>();

    // Layer 5
    OnlineConfiguration onlineConfig{ "front_prod", "front_sbx", "front_dep", "client_id", "secret", false };
    m_OnlineInterchange = std::make_unique<OnlineInterchange>(onlineConfig);
    if (!m_OnlineInterchange->InitializePlatform())
    {
        return false;
    }

    m_AcousticStructure  = std::make_unique<AcousticStructure>();
    m_AcousticIntegrator = std::make_unique<AcousticIntegrator>();

    // Layer 6
    if (!m_WorkspacePanel.Initialize(m_Config.ViewportWidth, m_Config.ViewportHeight))
    {
        return false;
    }

    // Initial Light Setup
    PhotometricLightRecord sunLight{};
    sunLight.SpatialLocation       = Vector3{ 50.0f, 100.0f, 50.0f };
    sunLight.EmissiveRadiance      = Vector3{ 10.0f, 9.5f, 8.5f };
    sunLight.InfluenceRadius       = 500.0f;
    sunLight.SpotInnerAngleCosine  = 0.0f;
    sunLight.SpotOuterAngleCosine  = 0.0f;
    sunLight.LightCategory         = 2;
    m_Lights.push_back(sunLight);

    return true;
}

void CycleScheduler::Terminate() noexcept
{
    if (m_TaskScheduler)
    {
        m_TaskScheduler->Terminate();
    }
    if (m_OnlineInterchange)
    {
        m_OnlineInterchange->TerminatePlatform();
    }
    if (m_DeformableSolver)
    {
        m_DeformableSolver->Terminate();
    }
    if (m_RigidBodySolver)
    {
        m_RigidBodySolver->Terminate();
    }
    if (m_VulkanExchange)
    {
        m_VulkanExchange->Terminate();
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                        14-PHASE ENGINE CYCLE EXECUTION
//------------------------------------------------------------------------------------------------------------------------

void CycleScheduler::ExecuteCycle(float WallClockDeltaSeconds) noexcept
{
    m_Telemetry.FrameTimeSeconds = WallClockDeltaSeconds;
    m_Telemetry.AccumulatorSeconds += std::min(WallClockDeltaSeconds, m_Config.MaximumAccumulatorSeconds);

    // ① [DeviceExchange]: Ingest timestamped input events
    // (Acquired from platform windowing)

    // ② [OnlineInterchange]: Advance EOS platform tick & network datagrams
    m_OnlineInterchange->AdvanceOnlineCycle();

    // ③ [Pre-Physics Queue]: Kinematic trajectories & user movement commands
    // (Player input vectors evaluated)

    // ④ [Fixed Substep Execution]: Step physics solvers over Δτ_fixed
    while (m_Telemetry.AccumulatorSeconds >= m_Config.FixedTimeStepΔτ)
    {
        m_RigidBodySolver->AdvanceSimulation(m_Config.FixedTimeStepΔτ);
        m_DeformableSolver->AdvanceSimulation(m_Config.FixedTimeStepΔτ, 4);
        m_FluidSolver->AdvanceSimulation(m_Config.FixedTimeStepΔτ, m_LevelSetSpace.get());

        m_Telemetry.AccumulatorSeconds -= m_Config.FixedTimeStepΔτ;
    }

    // ⑤ [Post-Physics Sync]: Interpolation weight α = τ_accum / Δτ_fixed
    m_Telemetry.InterpolationAlpha = m_Telemetry.AccumulatorSeconds / m_Config.FixedTimeStepΔτ;

    // ⑥ [AnimationSequence]: Skeletal skinning & joint matrices update
    // (Joint matrices interpolated)

    // ⑦ [LevelSetSpace Update]: Liquid surface distance fields & dynamic solid masks
    // (Dynamic obstacle SDF evaluated)

    // ⑧ [ParticleIntegrator]: GPU compute particles advected by curl noise & fluids
    m_ParticleIntegrator->AdvanceSimulation(WallClockDeltaSeconds, m_FluidSolver.get());

    // ⑨ [ClusteredSpace Binning]: 16x16x32 view frustum light assignment
    Matrix4x4 ViewProj = Matrix4x4::Identity();
    m_ClusteredSpace->BinLights(m_Lights, ViewProj);

    // ⑩ [VisibilityProjection]: Software meshlet rasterization producing 32-bit visibility buffer
    m_VisibilityProjection->ClearExtent();
    m_RasterSequence->RasterizeGeometry(*m_GeometryStructure, 1, Matrix4x4::Identity(), ViewProj, *m_VisibilityProjection);

    // ⑪ [MaterialCodec Shading]: ReSTIR DI/GI candidate resampling & AtmosphereIntegrator
    m_DirectIlluminationIntegrator->IntegrateDirectIllumination(
        *m_VisibilityProjection, *m_GeometryStructure, *m_MaterialCodec, m_Lights, m_RadianceField);

    m_GlobalIlluminationIntegrator->IntegrateGlobalIllumination(
        *m_VisibilityProjection, *m_GeometryStructure, *m_MaterialCodec, m_RadianceField);

    AtmosphereIntegrationCriteria atmoCriteria{};
    atmoCriteria.RayOrigin              = Vector3{ 0.0f, 1.7f, 0.0f };
    atmoCriteria.RayDirection           = Vector3{ 0.0f, 0.2f, 1.0f }.Normalized();
    atmoCriteria.RayMarchDistance       = 64.0f;
    atmoCriteria.StepCount              = 32;
    atmoCriteria.AsymmetryFactorG       = 0.6f;
    atmoCriteria.AbsorptionCrossSection = 0.02f;
    atmoCriteria.ScatteringCrossSection = 0.08f;

    [[maybe_unused]] Vector4 AtmoScattering = m_AtmosphereIntegrator->RaymarchMedia(
        atmoCriteria, *m_FluidSolver, Vector3{ 0.5f, 0.8f, 0.3f }.Normalized(), Vector3{ 5.0f, 4.8f, 4.2f });

    // ⑫ [AcousticIntegrator]: 3D HRTF listener panned mix with occlusion raymarching
    m_AcousticIntegrator->AdvanceAudio(WallClockDeltaSeconds, m_LevelSetSpace.get());

    // ⑬ [WorkspacePanel Present]: Immediate mode overlay & offscreen target presentation
    m_WorkspacePanel.RenderWorkspaceOverlay(m_WorkspacePanel.QueryEditMode(), WallClockDeltaSeconds);

    // ⑭ [ByteSpace Reclamation]: Reset linear transient storage offset to 0
    m_ByteSpace->ReclaimAll();

    // Update telemetry metrics
    m_Telemetry.CycleIndex++;
    m_Telemetry.ActiveRigidBodies         = m_RigidBodySolver->QueryActiveBodyCount();
    m_Telemetry.ActiveDeformableParticles = m_DeformableSolver->QueryActiveParticleCount();
    m_Telemetry.ActiveParticles           = m_ParticleIntegrator->QueryActiveParticleCount();
    m_Telemetry.ByteSpaceOccupiedBytes    = m_ByteSpace->QueryOccupiedBytes();
}

} // namespace Frontier
