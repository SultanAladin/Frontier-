//============================================================================================================================================
// 📦 ConvergenceGTX/Source/Main.cpp — Convergence GTX Standalone Executable Game Entry Point
//============================================================================================================================================

#include "GameHost.h"
#include <iostream>

int main(int argc, char** argv)
{
    (void)argc;
    (void)argv;

    std::cout << "================================================================================\n";
    std::cout << "                     CONVERGENCE GTX — VIRTUAL HYPERGRID                        \n";
    std::cout << "================================================================================\n";
    std::cout << "[Convergence GTX] Initializing standalone racing game project...\n";

    ConvergenceGTX::GameHost Game;
    if (!Game.LaunchGame(1920, 1080))
    {
        std::cerr << "[Convergence GTX Error] Failed to launch game!\n";
        return 1;
    }

    std::cout << "[Convergence GTX] Game launched successfully. Running race simulation ticks...\n";

    for (int tick = 1; tick <= 10; ++tick)
    {
        Game.StepGameCycle(1.0f / 60.0f);
        const auto& Telemetry = Game.QueryVehicleTelemetry();
        std::cout << "  Tick " << tick
                  << " | Speed: " << static_cast<int>(Telemetry.SpeedKilometersPerHour) << " km/h"
                  << " | RPM: " << static_cast<int>(Telemetry.EngineRevolutionsPerMinute)
                  << " | Gear: " << Telemetry.CurrentGear
                  << " | Pos: (" << Telemetry.SpatialLocation.x << ", " << Telemetry.SpatialLocation.z << ")\n";
    }

    std::cout << "[Convergence GTX] Race complete. Terminating game cleanly...\n";
    Game.TerminateGame();
    std::cout << "[Convergence GTX] Terminated successfully.\n";

    return 0;
}
