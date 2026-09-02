//============================================================================================================================================
// 📦 Frontier/Layer6_DisplayPresentation/Main.cpp — Frontier Engine Standalone Demonstration Entry Point
//============================================================================================================================================

#include "FrontierHost.h"
#include <iostream>

int main(int argc, char** argv)
{
    (void)argc;
    (void)argv;

    std::cout << "[Frontier] Bootstrapping Frontier Engine Subsystems...\n";

    Frontier::FrontierHost host;
    if (!host.Bootstrap(1920, 1080))
    {
        std::cerr << "[Frontier Error] Host bootstrap failed!\n";
        return 1;
    }

    std::cout << "[Frontier] Initialization successful. Executing 10 simulation test cycles...\n";

    for (int cycle = 1; cycle <= 10; ++cycle)
    {
        host.StepOnce(1.0f / 60.0f);
        const auto& telemetry = host.QueryScheduler()->QueryTelemetry();
        std::cout << "  Cycle " << telemetry.CycleIndex
                  << " | α: " << telemetry.InterpolationAlpha
                  << " | Particles: " << telemetry.ActiveParticles
                  << " | Softbody Particles: " << telemetry.ActiveDeformableParticles
                  << " | ByteSpace Usage: " << telemetry.ByteSpaceOccupiedBytes << " B\n";
    }

    std::cout << "[Frontier] Cycles complete. Shutting down gracefully...\n";
    host.Shutdown();
    std::cout << "[Frontier] Engine terminated successfully.\n";

    return 0;
}
