//============================================================================================================================================
//                                                      GAMEEXECUTION.CPP
//============================================================================================================================================
// 🧩 Project-Zero entry point — opens the Vulkan window, uploads Cornell Box geometry, runs the ReSTIR render loop.

#include "../../../Engine/DeviceExchange/SwapchainExchange.h"
#include "../../../Engine/DisplayPresentation/ReSTIRIntegrator.h"
#include "../../../Engine/DisplayPresentation/RenderScheduler.h"
#include "../../../Engine/DeviceExchange/DiagnosticMetrics.h"
#include "FlyThroughSolver.h"
#include "RayTracingSolver.h"

#include <chrono>
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
    Logger.InitializeSink();
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
        0.0025f,    // [rad/px] mouse sensitivity
        0.5f,       // [m/s]    scroll speed increment
        12.0f       // [-]      acceleration damping
    };

    Frontier::ProjectZero::FlyThroughSolver Camera(CameraConfig);
    Camera.AssignSpatialLocation(Frontier::Vector3{ 0.0f, 1.0f, -1.95f });
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

        // 📝 Clamp Δτ to prevent spiral-of-death on window drag or breakpoints
        if (Δτ > 0.1f) Δτ = 0.1f;

        // ① Poll input — GLFW callbacks forward into Input
        Surface.PollInput(Input);

        // ② Advance camera kinematics
        Camera.AdvanceLocomotion(Input, Δτ);
        Camera.AssignAspectRatio(
            static_cast<float>(Surface.QueryWidth()) /
            static_cast<float>(Surface.QueryHeight()));

        // ③ Build ImGui draw data (calls ImGui::NewFrame → ImGui::Render internally)
        Panel.Present(Integrator, Camera, Scene,
                      Surface.QueryWidth(), Surface.QueryHeight());

        // ④ Build dispatch configuration from live camera + integrator state
        const Frontier::DispatchConfiguration Dispatch = Integrator.BuildDispatch(
            Camera,
            Surface.QueryWidth(),
            Surface.QueryHeight(),
            static_cast<uint32_t>(Scene.QueryTriangles().size()),
            LuminaireCount);

        // ⑤ Dispatch compute, blit to swapchain, submit ImGui, present
        Surface.RecordAndPresent(Dispatch);

        Integrator.IncrementAccumulationIndex();

        // 📝 Keep the on-disk telemetry current even if the process is killed mid-run.
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
