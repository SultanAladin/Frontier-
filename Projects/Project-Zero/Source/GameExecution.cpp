//============================================================================================================================================
//                                                      GAMEEXECUTION.CPP
//============================================================================================================================================
// 🧩 Project-Zero entry point — opens the Vulkan window, uploads Cornell Box geometry, runs the ReSTIR render loop.

#include "../../../Engine/DeviceExchange/SwapchainExchange.h"
#include "../../../Engine/DisplayPresentation/ReSTIRIntegrator.h"
#include "../../../Engine/DisplayPresentation/RenderScheduler.h"
#include "../../../Engine/DeviceExchange/DiagnosticMetrics.h"
#include "../../../Engine/DisplayPresentation/ControlCentreHost.h"
#include "../../../Engine/DisplayPresentation/PixelSpace.h"
#include "../../../Engine/DisplayPresentation/FidelityClassifier.h"
#include "../../../Engine/DisplayPresentation/NotificationQueue.h"
#include "../../../Engine/DisplayPresentation/TelemetryMetrics.h"
#include "FlyThroughSolver.h"
#include "RayTracingSolver.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <iostream>

int main(int, char**)
{
    //──────────────────────────────────────────────────────────────────────────
    // Telemetry sink
    //──────────────────────────────────────────────────────────────────────────
    Frontier::DiagnosticConfiguration DiagnosticConfig{};
    DiagnosticConfig.DestinationFolder          = "Diagnostics";
    DiagnosticConfig.OutputFileStem             = "ProjectZero_TelemetryReport";
    DiagnosticConfig.FileExtension              = ".md";
    DiagnosticConfig.TimestampPrefixEnabled     = true;
    DiagnosticConfig.ConsoleEchoEnabled         = true;    // 💡 mirror telemetry into the console so a failed bring-up is visible
    DiagnosticConfig.MarkdownTableFormatEnabled = true;

    Frontier::DiagnosticMetrics Logger(DiagnosticConfig);
    if (!Logger.InitializeSink())
        std::cerr << "[Project-Zero] Telemetry sink could not be opened; continuing with console output only.\n";
    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Project-Zero windowed ReSTIR renderer starting.");

    //──────────────────────────────────────────────────────────────────────────
    // Scene — Cornell Box (CPU analytical geometry, uploaded once to GPU SSBOs)
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ProjectZero::RayTracingSolver Scene;

    const std::vector<Frontier::TriangleIndex> GpuTriangles =
        Frontier::ReSTIRIntegrator::BuildTriangleIndex(Scene);

    const std::vector<Frontier::RadianceStructure> GpuMaterials =
        Frontier::ReSTIRIntegrator::BuildRadianceStructures(Scene);

    const uint32_t LuminaireCount =
        Frontier::ReSTIRIntegrator::CountLuminaireTriangles(Scene);

    //──────────────────────────────────────────────────────────────────────────
    // Camera — Unreal-style fly-through, right-handed +Z up
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ProjectZero::FlyThroughConfiguration CameraConfig
    {
        2.5f,       // [m/s]    base flight speed
        3.0f,       // [-]      Shift boost multiplier
        0.00125f,   // [rad/px] mouse sensitivity (≈ 0.07°/px)
        0.5f,       // [m/s]    scroll speed increment
        12.0f       // [-]      acceleration damping
    };

    // Z-up: stand 1.95 m in front of the open face (Y < 0), eye height 1 m, looking along +Y into the box.
    Frontier::ProjectZero::FlyThroughSolver Camera(CameraConfig);
    Camera.AssignSpatialLocation(Frontier::Vector3{ 0.0f, -1.95f, 1.0f });
    Camera.AssignOrientationEuler(0.0f, 0.0f, 0.0f);
    Camera.AssignFieldOfView(55.0f);
    Camera.AssignAspectRatio(1280.0f / 720.0f);

    //──────────────────────────────────────────────────────────────────────────
    // ReSTIR integrator — owns dispatch parameters, accumulation index
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ReSTIRIntegratorConfiguration IntegratorConfig
    {
        8u,         // [-]  candidates per pixel
        2u,         // [-]  spatial resampling passes
        1.05f,      // [-]  ACES exposure
        0.015f      // [-]  ambient strength
    };

    Frontier::ReSTIRIntegrator Integrator(IntegratorConfig);

    //──────────────────────────────────────────────────────────────────────────
    // Swapchain exchange — GLFW window + Vulkan surface + compute pipeline
    //──────────────────────────────────────────────────────────────────────────
    Frontier::SwapchainConfiguration SurfaceConfig
    {
        1280u,
        720u,
        "Project-Zero  |  ReSTIR GI  |  Frontier Engine",
        false       // validation layers — set true for debugging
    };

    Frontier::SwapchainExchange Surface(SurfaceConfig);

    if (!Surface.Bring())
    {
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Fatal,
                             "Bootstrap", "SwapchainExchange bring-up failed - see the [SwapchainExchange] lines above for the failing stage.");
        Logger.TerminateSink();
        std::cerr << "\nProject-Zero could not open its window. Press Enter to close this console.\n";
        std::cin.get();
        return 1;
    }

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Window and Vulkan swapchain ready.");

    Surface.UploadTriangles(GpuTriangles);
    Surface.UploadRadiance(GpuMaterials);

    //──────────────────────────────────────────────────────────────────────────
    // ImGui panel — apply theme once after context exists
    //──────────────────────────────────────────────────────────────────────────
    Frontier::RenderScheduler Panel;
    Panel.ApplyTheme();

    //──────────────────────────────────────────────────────────────────────────
    // Control Centre — top notch + pull-down shade (engine overlay, drawn above every ImGui window)
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ControlCentreHost ControlCentre;
    ControlCentre.AssignProjectName("Project-Zero");
    (void)ControlCentre.Initialize(Surface.QueryWidth(), Surface.QueryHeight());
    Frontier::PixelSpace OverlaySurface;

    // Dashboard-driven engine services: quality ladder, toasts, frame telemetry
    Frontier::FidelityClassifier Fidelity;
    Frontier::NotificationQueue  Notifications;
    Frontier::TelemetryMetrics   Telemetry;
    uint32_t AppliedSettingsRevision = ~0u;   // forces the first application
    float    SettingsQuietSeconds    = 0.0f;  // [s] since the last change; the toast waits for the slider to rest
    bool     SettingsToastPending    = false;
    uint32_t AppliedAppearanceRevision = 0u;   // AppearanceInspector::Apply bumps its own revision

    // Push the Control Centre settings into the renderer. Called whenever the settings revision changes.
    auto ApplyControlCentreSettings = [&](const Frontier::ControlCentreSettings& S, bool Announce)
    {
        Fidelity.AssignCategory(S.Quality);
        const Frontier::FidelityCriteria Criteria = Fidelity.QueryActiveCriteria();

        // The quality tier sets the ReSTIR budget; the GI / AA tiles override the tier's own defaults.
        Integrator.AssignCandidatesPerPixel(Criteria.ReSTIRCandidateSampleCount);
        Integrator.AssignSpatialPassCount(Criteria.ReSTIRSpatialPassCount);
        Integrator.AssignGlobalIllumination(S.GlobalIllumination);
        Integrator.AssignAntiAliasing(S.AntiAliasing);
        Notifications.AssignEnabled(S.Notifications);

        if (Announce)
        {
            char Body[96];
            std::snprintf(Body, sizeof(Body), "%s  |  %u candidates, %u spatial, GI %s, AA %s, scale %d%%",
                          Frontier::FidelityLabel(S.Quality), Criteria.ReSTIRCandidateSampleCount,
                          Criteria.ReSTIRSpatialPassCount, S.GlobalIllumination ? "on" : "off",
                          S.AntiAliasing ? "on" : "off", static_cast<int>(S.RenderScale * 100.0f + 0.5f));
            Notifications.Push("Render settings applied", Body);
        }
    };

    Camera.AssignAspectRatio(
        static_cast<float>(Surface.QueryWidth()) /
        static_cast<float>(Surface.QueryHeight()));

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Entering render loop.");

    //──────────────────────────────────────────────────────────────────────────
    // Input exchange — filled each frame by GLFW callbacks
    //──────────────────────────────────────────────────────────────────────────
    Frontier::InputExchange Input;

    //──────────────────────────────────────────────────────────────────────────
    // Render loop
    //──────────────────────────────────────────────────────────────────────────
    using Clock    = std::chrono::high_resolution_clock;
    using Duration = std::chrono::duration<float>;

    auto PreviousTime = Clock::now();

    while (!Surface.CloseRequested() && !Panel.Convert<bool>())
    {
        const auto  NowTime = Clock::now();
        float       Δτ      = std::chrono::duration_cast<Duration>(NowTime - PreviousTime).count();
        PreviousTime        = NowTime;

        // Clamp Δτ to prevent spiral-of-death on window drag or breakpoints
        if (Δτ > 0.1f) Δτ = 0.1f;

        // ① Poll input — GLFW callbacks forward into Input
        Surface.PollInput(Input);

        // ①b Control Centre owns the pointer while hovered / grabbed / pulled down; the camera never sees those clicks
        ControlCentre.Resize(Surface.QueryWidth(), Surface.QueryHeight());
        ControlCentre.AdvanceInteraction(Input, Input.QueryCursorPositionX(), Input.QueryCursorPositionY());
        ControlCentre.AdvanceLocomotion(Δτ);
        Notifications.Advance(Δτ);
        Telemetry.RecordFrame(Δτ);

        // ①c Dashboard settings → renderer (only when something changed)
        {
            const Frontier::ControlCentreSettings& S = ControlCentre.QuerySettings();
            if (S.Revision != AppliedSettingsRevision)
            {
                const bool First = AppliedSettingsRevision == ~0u;
                ApplyControlCentreSettings(S, false);      // renderer follows every tick (live slider)
                AppliedSettingsRevision = S.Revision;
                SettingsQuietSeconds = 0.0f;
                SettingsToastPending = !First;
            }
            else if (SettingsToastPending)
            {
                SettingsQuietSeconds += Δτ;
                if (SettingsQuietSeconds >= 0.4f)          // one toast per gesture, not per drag tick
                {
                    ApplyControlCentreSettings(S, true);
                    SettingsToastPending = false;
                }
            }
        }

        // ①d Appearance page → Apply (explicit, dialogue-confirmed when leaving dirty). The renderer consumes what it
        //    can today (FPS overlay); resolution / V-Sync / fullscreen land with the swapchain step (5+) and are
        //    acknowledged here so the user sees the commit.
        {
            const Frontier::AppearanceInspector& A = ControlCentre.QueryAppearance();
            if (A.QueryRevision() != AppliedAppearanceRevision)
            {
                const Frontier::AppearanceSettings& P = A.QueryApplied();
                AppliedAppearanceRevision = A.QueryRevision();
                char Body[128];
                std::snprintf(Body, sizeof(Body), "%s  |  UI %d%%  |  radius %dpx  |  V-Sync %s%s",
                              Frontier::AppearanceInspector::QueryThemeName(P.Theme), static_cast<int>(P.InterfaceScale),
                              static_cast<int>(P.CornerRadius),
                              P.VerticalSync == Frontier::VerticalSyncCategory::Off ? "off" : P.VerticalSync == Frontier::VerticalSyncCategory::On ? "on" : "adaptive",
                              P.Fullscreen ? "  |  fullscreen" : "");
                Notifications.Push("Appearance applied", Body);
            }
        }

        // ② Advance camera kinematics (frozen while the overlay owns the pointer)
        if (!ControlCentre.CoversPointer())
            Camera.AdvanceLocomotion(Input, Δτ);
        Camera.AssignAspectRatio(
            static_cast<float>(Surface.QueryWidth()) /
            static_cast<float>(Surface.QueryHeight()));

        // ③ Build ImGui draw data (calls ImGui::NewFrame → ImGui::Render internally); the Control Centre records
        //    itself onto the foreground list between NewFrame and Render via the overlay hook.
        Panel.Present(Integrator, Camera, Scene,
                      Surface.QueryWidth(), Surface.QueryHeight(),
                      [&]()
                      {
                          if (OverlaySurface.Begin(Frontier::SurfaceLayer::Above,
                                                   static_cast<float>(Surface.QueryWidth()),
                                                   static_cast<float>(Surface.QueryHeight())))
                          {
                              // Scene overlays hang from the closed notch line; the pulled-down sheet covers the FPS
                              //    readout, while toasts are drawn after the shade so a settings change is acknowledged
                              //    on top of the dashboard that caused it.
                              const float NotchLine = ControlCentre.QueryHandleHeight();
                              if (ControlCentre.QuerySettings().FrameRateOverlay)
                                  Telemetry.ConstructTelemetryLayout(OverlaySurface, NotchLine);
                              ControlCentre.ConstructControlLayout(OverlaySurface);
                              Notifications.ConstructNotificationLayout(OverlaySurface, NotchLine);
                          }
                      });

        // ④ Build dispatch configuration from live camera + integrator state (camera motion restarts accumulation)
        //    Render scale: the kernel runs on a sub-rectangle of the storage image and the blit stretches it.
        const float    RenderScale  = ControlCentre.QuerySettings().RenderScale;
        const uint32_t RenderWidth  = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryWidth())  * RenderScale + 0.5f));
        const uint32_t RenderHeight = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryHeight()) * RenderScale + 0.5f));
        Integrator.ObserveCamera(Camera, RenderWidth, RenderHeight);
        const Frontier::DispatchConfiguration Dispatch = Integrator.BuildDispatch(
            Camera,
            RenderWidth,
            RenderHeight,
            static_cast<uint32_t>(Scene.QueryTriangles().size()),
            LuminaireCount);

        // ⑤ Dispatch compute, blit to swapchain, submit ImGui, present
        Surface.RecordAndPresent(Dispatch);

        Integrator.IncrementAccumulationIndex();

        // Keep the on-disk telemetry current even if the process is killed mid-run.
        if ((Integrator.QueryAccumulationIndex() & 63u) == 0u) Logger.FlushSink();
    }

    //──────────────────────────────────────────────────────────────────────────
    // Shutdown
    //──────────────────────────────────────────────────────────────────────────
    Surface.Retire();

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Shutdown", "Render loop exited cleanly.");
    Logger.TerminateSink();

    return 0;
}
