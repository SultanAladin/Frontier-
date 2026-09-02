//============================================================================================================================================
// 📦 Project-F20/Source/GameExecution.cpp — Project-F20 Standalone Executable Game Entry Point
//============================================================================================================================================

#include "GameHost.h"
#include "../../../DeviceExchange/DiagnosticMetrics.h"
#include <iostream>

int main(int ArgumentCount, char** ArgumentValues)
{
    (void)ArgumentCount;
    (void)ArgumentValues;

    std::cout << "================================================================================\n";
    std::cout << "                        PROJECT-F20 — VIRTUAL HYPERGRID                         \n";
    std::cout << "================================================================================\n";
    std::cout << "[Project-F20] Initializing standalone racing game project...\n";

    // Initialize Telemetry Logger with custom .log format
    Frontier::DiagnosticConfiguration RaceLogConfig{};
    RaceLogConfig.DestinationFolder          = "Logs/Project-F20";
    RaceLogConfig.OutputFileStem             = "RaceSessionLog";
    RaceLogConfig.FileExtension              = ".log";
    RaceLogConfig.TimestampPrefixEnabled     = true;
    RaceLogConfig.ConsoleEchoEnabled         = false;
    RaceLogConfig.MarkdownTableFormatEnabled = false;

    Frontier::DiagnosticMetrics RaceLogger(RaceLogConfig);
    if (RaceLogger.InitializeSink())
    {
        RaceLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "GameLifecycle", "Launching Project-F20 session...");
    }

    Frontier::ProjectF20::GameHost Game;
    if (!Game.LaunchGame(1920, 1080))
    {
        RaceLogger.RecordMessage(Frontier::DiagnosticSeverity::Fatal, "GameLifecycle", "Game launch failed!");
        std::cerr << "[Project-F20 Error] Failed to launch game!\n";
        return 1;
    }

    RaceLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "GameLifecycle", "Game launched successfully. Starting race simulation.");
    std::cout << "[Project-F20] Game launched successfully. Running race simulation ticks...\n";

    for (int tick = 1; tick <= 10; ++tick)
    {
        Game.StepGameCycle(1.0f / 60.0f);
        const auto& Telemetry = Game.QueryVehicleTelemetry();
        
        RaceLogger.RecordMeasurement("SpeedKph", Telemetry.SpeedKilometersPerHour, "km/h");
        RaceLogger.RecordMeasurement("EngineRpm", Telemetry.EngineRevolutionsPerMinute, "RPM");

        std::cout << "  Tick " << tick
                  << " | Speed: " << static_cast<int>(Telemetry.SpeedKilometersPerHour) << " km/h"
                  << " | RPM: " << static_cast<int>(Telemetry.EngineRevolutionsPerMinute)
                  << " | Gear: " << Telemetry.CurrentGear
                  << " | Pos: (" << Telemetry.SpatialLocation.x << ", " << Telemetry.SpatialLocation.z << ")\n";
    }

    RaceLogger.RecordMessage(Frontier::DiagnosticSeverity::Information, "GameLifecycle", "Race session completed successfully.");
    std::cout << "[Project-F20] Race complete. Terminating game cleanly...\n";
    Game.TerminateGame();
    RaceLogger.TerminateSink();

    std::cout << "[Project-F20] Terminated successfully. Race telemetry written to " << RaceLogger.QueryResolvedFilePath() << "\n";
    return 0;
}
