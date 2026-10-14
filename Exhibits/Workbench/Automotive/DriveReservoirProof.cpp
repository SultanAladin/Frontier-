//============================================================================================================================================
//                                                        DRIVERESERVOIRPROOF.CPP
//============================================================================================================================================
// 📦 Supply the actual Drive scene to the shared CPU reservoir integrator. No other project or windowed host is involved.
#include "../../../Engine/GeometricRaster/ReservoirIntegrator.h"
#include "../../../Engine/ContentInterchange/PngWriteCounterpart.h"
#include "../../../Projects/Project-Drive/Source/DriveSceneAuthor.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>

int main(int Count, char** Arguments)
{
    assert(Count >= 2);
    const std::filesystem::path Folder = Arguments[1];
    const uint32_t Views = Count > 2 ? static_cast<uint32_t>(std::stoul(Arguments[2])) : 8u;
    const uint32_t Frames = Count > 3 ? static_cast<uint32_t>(std::stoul(Arguments[3])) : 16u;
    assert(Views > 0u && Views <= 24u && Frames >= 2u && Frames <= 64u);
    std::filesystem::create_directories(Folder);
    Frontier::Drive::DriveSceneAuthor Author;
    Author.Construct(true);
    std::ofstream Proof(Folder / "ReservoirProof.json");
    Proof << "{\"renderer\":\"Engine/GeometricRaster/ReservoirIntegrator\",\"gpuExecution\":false,"
          << "\"gi\":\"one traced continuation; not the GPU GI reservoir pipeline\",\"views\":[";
    for (uint32_t View = 0u; View < Views; ++View)
    {
        const float θ = View * 6.28318530718f / Views;
        Frontier::ReservoirSpecification Settings;
        Settings.Frames = Frames;
        Settings.Target = {0.0f, 0.0f, 0.7f};
        Settings.Eye = {-6.4f * std::cos(θ) + 5.4f * std::sin(θ),
                        -6.4f * std::sin(θ) - 5.4f * std::cos(θ), 2.2f};
        Settings.SunDirection = {-0.3f, -0.4f, 0.85f};
        std::vector<unsigned char> Pixels;
        const auto Metrics = Frontier::ReservoirIntegrator::Render(Author.QueryTriangles(), Author.QueryCornerNormals(),
            Author.QueryMaterials(), Settings, Pixels);
        assert(Metrics.InvalidSamples == 0u && std::isfinite(Metrics.MeanRadiance) && Metrics.MeanRadiance > 0.0);
        assert(Metrics.TemporalReuses > 0u && Metrics.SpatialReuses > 0u);
        const auto File = Folder / ("orbit-" + std::to_string(View) + "-restir.png");
        assert(PngWriteCounterpart::WritePng(File.string().c_str(), Settings.Width, Settings.Height, 3,
            Pixels.data(), Settings.Width * 3u));
        if (View > 0u) Proof << ",";
        Proof << "{\"view\":" << View << ",\"frames\":" << Frames << ",\"temporalReuses\":" << Metrics.TemporalReuses
              << ",\"spatialReuses\":" << Metrics.SpatialReuses << ",\"invalidSamples\":" << Metrics.InvalidSamples
              << ",\"meanRadiance\":" << Metrics.MeanRadiance << "}";
        Proof.flush();
        std::printf("PASS CPU ReSTIR DI reference view %u: temporal %llu, spatial %llu, invalid %llu, mean %.5f. Shared engine only.\n",
            View, static_cast<unsigned long long>(Metrics.TemporalReuses), static_cast<unsigned long long>(Metrics.SpatialReuses),
            static_cast<unsigned long long>(Metrics.InvalidSamples), Metrics.MeanRadiance);
        std::fflush(stdout);
    }
    Proof << "]}\n";
}
