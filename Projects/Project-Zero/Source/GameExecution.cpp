//============================================================================================================================================
// 📦 Project-Zero/Source/GameExecution.cpp — Project-Zero Standalone ReSTIR Photometric Test Ground Entry Point
//============================================================================================================================================

#include "RendererHost.h"
#include "../../../DeviceExchange/DiagnosticMetrics.h"
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
    std::cout << "[Project-Zero] Initializing analytical triangle test scene and ReSTIR pipeline...\n";

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

    std::cout << "[Project-Zero] Viewport: " << ViewportWidth << "x" << ViewportHeight << " pixels.\n";
    std::cout << "[Project-Zero] Scene: Cornell Box with analytical triangle geometry & emissive ceiling luminaire.\n";
    std::cout << "[Project-Zero] Executing ReSTIR DI + ReSTIR GI (with Jacobian shift indirect radiosity)...\n";

    auto StartTime = std::chrono::high_resolution_clock::now();

    Frontier::ProjectZero::RendererHost Renderer(ViewportWidth, ViewportHeight);
    Renderer.RenderReSTIRFrame(2); // 2 spatial resampling passes

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

    ReportLogger.RecordMeasurement("ViewportWidth", ViewportWidth, "px");
    ReportLogger.RecordMeasurement("ViewportHeight", ViewportHeight, "px");
    ReportLogger.RecordMeasurement("TotalPixels", ViewportWidth * ViewportHeight, "px");
    ReportLogger.RecordMeasurement("RenderDurationMs", DurationMs, "ms");
    ReportLogger.RecordMeasurement("SpatialResamplingPasses", 2, "count");

    ReportLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Shutdown", "Project-Zero test ground completed successfully.");
    ReportLogger.TerminateSink();

    std::cout << "[Project-Zero] Test complete. Telemetry report emitted to " << ReportLogger.QueryResolvedFilePath() << "\n";
    return 0;
}
