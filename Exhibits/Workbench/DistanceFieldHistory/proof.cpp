// CPU exact proof: how often the Distance Field GI card history restarts.
//   old_exact   = the 1784c86 stage: byte-exact memcmp against the lighting stored on EVERY frame.
//   new_tolerant = the current stage: DistanceFieldLightingDrift::LightingChanged against the lighting held at the last reset.
// The new predicate is the real header the stage compiles. Build: g++ -std=c++20 -O2 -I../../../Engine/DeviceExchange proof.cpp
#include "DistanceFieldLightingDrift.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>

namespace
{
constexpr int   Frames    = 3600;   // 60 s at 60 fps
constexpr float Pi        = 3.14159265f;
constexpr int   PresetAt  = 1800;

struct Lighting { float V[12]; };

Lighting Make(float ElevationDeg, float Radiance, float Exposure) noexcept
{
    Lighting L{};
    const float E = ElevationDeg * Pi / 180.0f;
    L.V[0] = std::cos(E) * 0.6f; L.V[1] = std::sin(E); L.V[2] = std::cos(E) * 0.8f;
    L.V[3] = Radiance;
    L.V[4] = 1.0f; L.V[5] = 0.95f; L.V[6] = 0.85f; L.V[7] = 0.0f;   // colour; [7] is struct padding, always 0
    L.V[8] = 0.20f; L.V[9] = 0.25f; L.V[10] = 0.30f; L.V[11] = Exposure;
    return L;
}

struct Scenario
{
    const char* Name;
    const char* Description;
    double      SunDegPerFrame;
    double      ExposureJitter;   // standard deviation per frame, as a fraction
    bool        PresetChange;
};

struct Result
{
    int    Restarts = 0, LongestRun = 0, PresetRestarts = 0;
    double MeanRun = 0.0, NsPerDecision = 0.0;
    int    SecondCumulative[60]{};
};

Result Run(const Scenario& S, bool Tolerant)
{
    std::mt19937 Rng(20260901u);
    std::normal_distribution<float> Jitter(0.0f, float(S.ExposureJitter));
    float Elevation = 35.0f, Exposure = 1.0f;
    Lighting Stored = Make(Elevation, 3.0f, Exposure);   // what PreviousLighting holds
    Result R;
    int RunLength = 0, RunsCount = 0, RunsSum = 0;
    double Nanoseconds = 0.0;
    for (int F = 0; F < Frames; ++F)
    {
        Elevation += float(S.SunDegPerFrame);
        Exposure  *= 1.0f + Jitter(Rng);
        const float Radiance = (S.PresetChange && F >= PresetAt) ? 6.0f : 3.0f;
        const Lighting Now = Make(Elevation, Radiance, Exposure);

        const auto T0 = std::chrono::steady_clock::now();
        bool Restart;
        if (Tolerant)
        {
            Restart = DistanceFieldLightingDrift::LightingChanged(Stored.V, Now.V);
        }
        else
        {
            Restart = std::memcmp(Stored.V, Now.V, sizeof(Stored.V)) != 0;
        }
        const auto T1 = std::chrono::steady_clock::now();
        Nanoseconds += double(std::chrono::duration_cast<std::chrono::nanoseconds>(T1 - T0).count());

        if (Restart)
        {
            ++R.Restarts;
            if (S.PresetChange && F == PresetAt) ++R.PresetRestarts;
            if (RunLength > 0) { RunsSum += RunLength; ++RunsCount; }
            if (RunLength > R.LongestRun) R.LongestRun = RunLength;
            RunLength = 0;
            std::memcpy(Stored.V, Now.V, sizeof(Stored.V));
        }
        else
        {
            ++RunLength;
            if (!Tolerant) std::memcpy(Stored.V, Now.V, sizeof(Stored.V));   // old build: baseline is the previous frame
        }
        if (F % 60 == 59) R.SecondCumulative[F / 60] = R.Restarts;
    }
    if (RunLength > 0) { RunsSum += RunLength; ++RunsCount; }
    if (RunLength > R.LongestRun) R.LongestRun = RunLength;
    R.MeanRun = RunsCount ? double(RunsSum) / RunsCount : 0.0;
    R.NsPerDecision = Nanoseconds / Frames;
    return R;
}
} // namespace

int main()
{
    const Scenario Scenes[] = {
        { "sun_realtime",  "Sun at real day speed (360 deg / 24 min), exposure steady",                               0.0001, 0.0,   false },
        { "sun_demo_1dps", "Sun at 1 deg/s (demo speed), exposure steady",                                            0.0167, 0.0,   false },
        { "auto_exposure", "Sun static, auto-exposure hunts +/-0.3% per frame, preset change at frame 1800",          0.0,    0.003, true  },
    };
    std::FILE* Tsv   = std::fopen("history_summary.tsv", "w");
    std::FILE* Trace = std::fopen("restarts_per_second.tsv", "w");
    std::fprintf(Tsv, "scenario\tbuild\tframes\trestarts\trestarts_per_frame\tmean_history_run_frames\tlongest_history_run_frames\tpreset_change_restarts\tdecision_ns_per_frame\tdescription\n");
    std::fprintf(Trace, "scenario\tbuild\tsecond\tcumulative_restarts\n");
    int Failures = 0;
    for (const Scenario& S : Scenes)
    {
        const Result Old = Run(S, false);
        const Result New = Run(S, true);
        const Result* Pair[2] = { &Old, &New };
        const char*   Names[2] = { "old_exact", "new_tolerant" };
        for (int P = 0; P < 2; ++P)
        {
            const Result& R = *Pair[P];
            std::fprintf(Tsv, "%s\t%s\t%d\t%d\t%.5f\t%.1f\t%d\t%d\t%.1f\t%s\n", S.Name, Names[P], Frames, R.Restarts,
                         double(R.Restarts) / Frames, R.MeanRun, R.LongestRun, R.PresetRestarts, R.NsPerDecision, S.Description);
            for (int Second = 0; Second < 60; ++Second)
                std::fprintf(Trace, "%s\t%s\t%d\t%d\n", S.Name, Names[P], Second + 1, R.SecondCumulative[Second]);
        }
        std::printf("%-15s old %5d restarts (%.4f/frame)   new %5d restarts (%.4f/frame)   new longest history run %d frames\n",
                    S.Name, Old.Restarts, double(Old.Restarts) / Frames, New.Restarts, double(New.Restarts) / Frames, New.LongestRun);
        if (S.PresetChange && New.PresetRestarts != 1) { std::printf("FAIL: preset change did not restart history once\n"); ++Failures; }
        if (New.Restarts > Old.Restarts) { std::printf("FAIL: tolerant build restarted more than old in %s\n", S.Name); ++Failures; }
    }
    std::fclose(Tsv);
    std::fclose(Trace);
    std::printf("%s - %d failure(s)\n", Failures ? "RED" : "GREEN", Failures);
    return Failures ? 1 : 0;
}
