//============================================================================================================================================
// 📦 Project-Zero/Source/GameExecution.cpp — Project-Zero Standalone ReSTIR Photometric Test Ground Entry Point
//============================================================================================================================================

#include "RendererHost.h"
#include "FlyThroughSolver.h"
#include "CelestialStage.h"
#include "../../../DeviceExchange/DiagnosticMetrics.h"
#include "../../../DeviceExchange/InputExchange.h"
#include <iostream>
#include <chrono>
#include <cstdlib>

int main(int ArgumentCount, char** ArgumentValues)
{
    (void)ArgumentCount;
    (void)ArgumentValues;

    std::cout << "================================================================================\n";
    std::cout << "                 PROJECT-ZERO — RESTIR PHOTOMETRIC TEST GROUND                  \n";
    std::cout << "================================================================================\n";
    std::cout << "[Project-Zero] Initializing analytical triangle test scene, UE camera, and ReSTIR pipeline...\n";

    // Initialize Telemetry Logger with markdown table format
    Frontier::DiagnosticConfiguration ReportConfig{};
    ReportConfig.DestinationFolder          = "Diagnostics";
    ReportConfig.OutputFileStem             = "ProjectZero_TelemetryReport";
    ReportConfig.FileExtension              = ".md";
    ReportConfig.TimestampPrefixEnabled     = true;
    ReportConfig.ConsoleEchoEnabled         = false;
    ReportConfig.MarkdownTableFormatEnabled = true;

    Frontier::DiagnosticMetrics ReportLogger(ReportConfig);
    if (ReportLogger.InitializeSink())
    {
        ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Bootstrap", "Project-Zero ReSTIR test ground initialized.");
    }

    constexpr uint32_t ViewportWidth  = 640;
    constexpr uint32_t ViewportHeight = 480;

    // Initialize Unreal Engine style Fly-Through Camera
    Frontier::ProjectZero::FlyThroughConfiguration CameraConfig{
        2.5f,                   // [m/s] base speed
        3.0f,                   // [x] boost when holding Shift
        0.0025f,                // [rad/px] mouse sensitivity
        0.5f,                   // [m/s] scroll increment
        12.0f                   // damping
    };
    //    ⚠️ The eye point is authored in the engine's frame: +X right, +Y forward/depth, +Z up. It previously
    //    read (0, 1, -1.95), which was a +Y-up position from when the Cornell box was authored that way — in a
    //    +Z-up world that puts the camera 1.95 m BEHIND the room at floor level, staring away from it, and the
    //    exported frame came out a single flat colour. It now stands just inside the near wall at eye height.
    //    Placed so that AFTER the five locomotion ticks below (which fly the camera forward at up to 7.5 m/s)
    //    the eye is still inside the room, framing the classic Cornell view: both coloured walls, both boxes
    //    and the ceiling luminaire.
    Frontier::ProjectZero::FlyThroughSolver Camera(CameraConfig);
    Camera.AssignSpatialLocation(Frontier::Vector3{ -0.10f, -1.30f, 1.0f });
    //    The simulated input below holds a rightward mouse drag, so the rig ends about 10.7 deg of yaw to the
    //    right of where it starts. Pre-rotating by that much leaves the final frame square to the back wall.
    Camera.AssignOrientationEuler(-3.6f * 3.14159265f / 180.0f, -10.75f * 3.14159265f / 180.0f, 0.0f);
    Camera.AssignFieldOfView(55.0f);
    Camera.AssignAspectRatio(static_cast<float>(ViewportWidth) / static_cast<float>(ViewportHeight));

    // Simulate Unreal Engine Viewport Input Interaction (WASD + Q/E + RMB + Scroll)
    Frontier::InputExchange Input;
    Input.AssignKeyState(Frontier::VirtualKeyCategory::KeyW, true);          // Hold W to fly forward
    Input.AssignKeyState(Frontier::VirtualKeyCategory::KeyLeftShift, true);  // Hold Shift for speed boost
    Input.AssignMouseButton(Frontier::MouseButtonCategory::ButtonRight, true); // Hold RMB for look steering
    Input.AssignCursorDelta(15.0f, -5.0f);                                   // Slight yaw right, pitch up
    Input.AssignMouseScroll(2.0f);                                           // Scroll up to increase flight speed

    // Advance camera kinematics through 5 simulation ticks
    std::cout << "[Project-Zero] Simulating Unreal-style Fly-Through Camera Navigation (WASD, Q/E, Shift, Scroll, RMB)...\n";
    for (int tick = 1; tick <= 5; ++tick)
    {
        Camera.AdvanceLocomotion(Input, 1.0f / 60.0f);
        const auto& Loc = Camera.QuerySpatialLocation();
        std::cout << "  Tick " << tick
                  << " | Cam Pos: (" << Loc.x << ", " << Loc.y << ", " << Loc.z << ")"
                  << " | Speed: " << Camera.QueryFlightSpeed() << " m/s"
                  << " | Pitch: " << (Camera.QueryPitchRadians() * 180.0f / 3.14159f) << " deg"
                  << " | Yaw: " << (Camera.QueryYawRadians() * 180.0f / 3.14159f) << " deg\n";
    }

    std::cout << "[Project-Zero] Viewport: " << ViewportWidth << "x" << ViewportHeight << " pixels.\n";
    std::cout << "[Project-Zero] Scene: Cornell Box with analytical triangle geometry & emissive ceiling luminaire.\n";
    std::cout << "[Project-Zero] Executing ReSTIR DI + ReSTIR GI from navigated camera viewpoint...\n";

    auto StartTime = std::chrono::high_resolution_clock::now();

    Frontier::ProjectZero::RendererHost Renderer(ViewportWidth, ViewportHeight);
    Renderer.RenderReSTIRFrame(Camera, 2); // 2 spatial resampling passes

    auto EndTime = std::chrono::high_resolution_clock::now();
    double DurationMs = std::chrono::duration<double, std::milli>(EndTime - StartTime).count();

    std::cout << "[Project-Zero] ReSTIR render completed in " << DurationMs << " ms.\n";

    std::string PpmPath = "Diagnostics/ProjectZero_ReSTIR_GI.ppm";
    std::string PngPath = "Diagnostics/ProjectZero_ReSTIR_GI.png";

    if (Renderer.ExportPpmImage(PpmPath))
    {
        std::cout << "[Project-Zero] Exported raw PPM image to: " << PpmPath << "\n";
        ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Renderer", "Exported PPM image to " + PpmPath);

        // Convert PPM to PNG
        std::string ConvertCmd = "python3 Tools/PpmToPng.py " + PpmPath + " " + PngPath + " > /dev/null 2>&1";
        int Result = std::system(ConvertCmd.c_str());
        if (Result == 0)
        {
            std::cout << "[Project-Zero] Converted to PNG image: " << PngPath << "\n";
            ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Renderer", "Converted to PNG at " + PngPath);
        }
    }
    else
    {
        std::cerr << "[Project-Zero Error] Failed to export PPM image!\n";
        ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Fatal, "Renderer", "Failed to export PPM image.");
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                    THE COMBINED CELESTIAL FRAME
    //------------------------------------------------------------------------------------------------------------------------
    //    ReSTIR DI and GI in the Cornell box, lit through an opened ceiling by the full celestial port — sun,
    //    atmosphere, sky, twilight, stars, moon, volumetric clouds, cloud layer, local cloud, height fog,
    //    atmospheric fog, local volumetric fog, wind, precipitation, rainbow, lens flare and the tonemap chain,
    //    all in one image. This is the frame the port is judged on, so the shipped executable produces it.

    std::cout << "[Project-Zero] Rendering the combined celestial frame (ReSTIR + Cornell box + full sky)...\n";

    Frontier::ProjectZero::CelestialCriteria SkyCriteria{};
    SkyCriteria.Sun.LocalHours               = 12.0f;
    SkyCriteria.Observer.Height              = 0.55f;
    SkyCriteria.VolumetricCloud.Coverage     = 0.52f;
    SkyCriteria.Moons[0].AzimuthDegrees      = 200.0f;
    SkyCriteria.Moons[0].ElevationDegrees    = 40.0f;
    //    The fog bank sits in the middle distance beyond the aperture, not over the room.
    SkyCriteria.LocalFog.Placement           = Frontier::Vector3{ 0.0f, 6.0f, -26.0f };
    SkyCriteria.LocalFog.HalfExtents         = Frontier::Vector3{ 22.0f, 5.0f, 14.0f };
    SkyCriteria.LocalCloud.Placement         = Frontier::Vector3{ 18.0f, 90.0f, -70.0f };
    SkyCriteria.LocalCloud.HalfExtents       = Frontier::Vector3{ 60.0f, 26.0f, 45.0f };

    Frontier::ProjectZero::CelestialStageCriteria StageCriteria{};
    StageCriteria.Width         = ViewportWidth;
    StageCriteria.Height        = ViewportHeight;
    StageCriteria.IndirectRays  = 24u;
    StageCriteria.SpatialPasses = 3u;
    StageCriteria.SkyTaps       = 48u;

    Frontier::ProjectZero::CelestialStage Stage(StageCriteria, SkyCriteria);
    {
        auto LunarSurface = Frontier::ProjectZero::MoonAlbedoSurface::LoadPortablePixmap(
            "../../EngineContent/CelestialTextures/luna_1k.ppm");
        if (LunarSurface.Populated())
        {
            Stage.MutableSky().AssignMoonSurface(0u, std::move(LunarSurface));
        }
    }

    //    Settle the weather: the wind integral, the cloud advection and a populated rain pool.
    for (int Tick = 0; Tick < 45; ++Tick)
    {
        Stage.Advance(1.0f / 30.0f);
    }

    Frontier::ProjectZero::FlyThroughSolver CelestialCamera(CameraConfig);
    //    Eye height 1.2 m, looking level and slightly down. The camera has to stand high enough to see OVER
    //    the two Cornell boxes and out through the window — from the old 0.55 m crouch the boxes occlude the
    //    entire opening and not one ray reaches the ground, so the sky was the only celestial thing in frame.
    //    A small downward pitch is what puts the horizon, the ground and the room's floor in the same image.
    CelestialCamera.AssignSpatialLocation(Frontier::Vector3{ 0.60f, 0.25f, 1.20f });
    CelestialCamera.AssignOrientationEuler(-6.0f * 3.14159265f / 180.0f,
                                           -7.0f * 3.14159265f / 180.0f, 0.0f);
    CelestialCamera.AssignFieldOfView(92.0f);
    CelestialCamera.AssignAspectRatio(static_cast<float>(ViewportWidth) / static_cast<float>(ViewportHeight));

    Stage.RenderFrame(CelestialCamera);
    const auto& CelestialStatistics = Stage.QueryStatistics();

    const std::string CelestialPpm = "Diagnostics/ProjectZero_Celestial.ppm";
    const std::string CelestialPng = "Diagnostics/ProjectZero_Celestial.png";
    if (Stage.ExportPpmImage(CelestialPpm))
    {
        const std::string CelestialConvert = "python3 ../../Tools/PpmToPng.py " + CelestialPpm + " " + CelestialPng + " > /dev/null 2>&1";
        if (std::system(CelestialConvert.c_str()) == 0)
        {
            std::cout << "[Project-Zero] Combined celestial frame: " << CelestialPng << "\n";
        }
        ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Celestial",
                                   "Rendered the combined ReSTIR + celestial frame to " + CelestialPng);
    }

    std::cout << "  Sun elevation: " << Stage.QuerySky().QueryFrame().SunElevationDeg << " deg"
              << " | sky pixels: " << (CelestialStatistics.SkyPixelFraction * 100.0) << "%"
              << " | " << CelestialStatistics.RenderMilliseconds << " ms\n";

    ReportLogger.RecordMeasurement("ViewportWidth", ViewportWidth, "px");
    ReportLogger.RecordMeasurement("ViewportHeight", ViewportHeight, "px");
    ReportLogger.RecordMeasurement("TotalPixels", ViewportWidth * ViewportHeight, "px");
    ReportLogger.RecordMeasurement("RenderDurationMs", DurationMs, "ms");
    ReportLogger.RecordMeasurement("SpatialResamplingPasses", 2, "count");
    ReportLogger.RecordMeasurement("CameraFlightSpeed", Camera.QueryFlightSpeed(), "m/s");
    ReportLogger.RecordMeasurement("CelestialRenderMs", CelestialStatistics.RenderMilliseconds, "ms");
    ReportLogger.RecordMeasurement("CelestialSkyPixelFraction", CelestialStatistics.SkyPixelFraction, "-");
    ReportLogger.RecordMeasurement("CelestialMeanLuminance", CelestialStatistics.MeanLuminance, "-");
    ReportLogger.RecordMeasurement("CelestialSunElevation", Stage.QuerySky().QueryFrame().SunElevationDeg, "deg");

    ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Shutdown", "Project-Zero test ground completed successfully.");
    ReportLogger.TerminateSink();

    std::cout << "[Project-Zero] Test complete. Telemetry report emitted to " << ReportLogger.QueryResolvedFilePath() << "\n";
    return 0;
}
