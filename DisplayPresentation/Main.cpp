//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/Main.cpp — Frontier Engine Standalone Demonstration Entry Point
//============================================================================================================================================

#include "FrontierHost.h"
#include <iostream>

int main(int argc, char** argv)
{
    (void)argc;
    (void)argv;

    std::cout << "[Frontier] Bootstrapping Frontier Engine Subsystems...\n";

    Frontier::FrontierHost HostInstance;
    if (!HostInstance.Bootstrap(1920, 1080))
    {
        std::cerr << "[Frontier Error] Host bootstrap failed!\n";
        return 1;
    }

    std::cout << "[Frontier] Initialization successful. Executing 10 simulation test cycles...\n";

    for (int cycle = 1; cycle <= 10; ++cycle)
    {
        HostInstance.StepOnce(1.0f / 60.0f);
        const auto& TelemetryData = HostInstance.QueryScheduler()->QueryTelemetry();
        std::cout << "  Cycle " << TelemetryData.CycleIndex
                  << " | α: " << TelemetryData.InterpolationAlpha
                  << " | Particles: " << TelemetryData.ActiveParticles
                  << " | Softbody Particles: " << TelemetryData.ActiveDeformableParticles
                  << " | ByteSpace Usage: " << TelemetryData.ByteSpaceOccupiedBytes << " B\n";
    }

    std::cout << "[Frontier] Cycles complete. Shutting down gracefully...\n";
    HostInstance.Shutdown();
    std::cout << "[Frontier] Engine terminated successfully.\n";

    return 0;
}
