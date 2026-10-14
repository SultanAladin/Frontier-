//============================================================================================================================================
//                                                       GAMEEXECUTION.CPP
//============================================================================================================================================
// 🧩 Project-Dyno — the windowless dyno cell. No Vulkan, no GLFW, no ImGui: a console main loop that drives the audio
//    transport exactly the way Project-Zero's loop will after the merge (Pull.Advance → generator demand → Audio.Advance).
//
//    Usage
//        Project-Dyno                                  live: default device, "sweep" pull, 8 cylinders, loops until Enter / Ctrl-C
//        Project-Dyno --pull pull --cylinders 12       live: WOT pull, 12-cylinder click train
//        Project-Dyno --sweep                          add the 40 Hz → 8 kHz sine sweep on top of the clicks
//        Project-Dyno --null                           null driver (no hardware): clocked, silent — CI / sandbox
//        Project-Dyno --render out.wav --pull pull     offline: same generator, same slicing, written to WAV; no device
//        Project-Dyno --seconds 8                      run / render length in seconds (0 = until Enter live, = pull length for --render)
//        Project-Dyno --float                          write IEEE float32 instead of PCM16 (bit-identity proofs)
//
//    Row A2: AcousticIntegrator (Engine Audio Sim v3, --car <id>, default laferrari) is the powertrain;
//    CrankClickIntegrator remains as the transport self-test behind --engine clicks.
//
//        Project-Dyno --car amg-gt3                    live: patch-1's unique cross-plane thunder, v3-raw
//        Project-Dyno --render la.wav --car laferrari --pull pull   offline hero-car render
//        Project-Dyno --list-cars                      print the 18-car garage and exit

#include "../../../Engine/DeviceExchange/DiagnosticMetrics.h"
#include "../../../Engine/PlatformInterchange/AudioExchange.h"
#include "../../../Engine/PlatformInterchange/WaveCodec.h"
#include "AcousticIntegrator.h"
#include "CrankClickIntegrator.h"
#include "DynoSequence.h"
#include "EngineVoice.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                   CONSOLE STOP KEY
//------------------------------------------------------------------------------------------------------------------------

// Enter on stdin ends a live run; a detached reader keeps the main loop free of blocking I/O. Ctrl-C still works as usual.
std::atomic<bool> StopRequested { false };

void WatchStandardInput()
{
    std::thread([]
    {
        std::string Line;
        if (std::getline(std::cin, Line) || std::cin.eof()) StopRequested.store(true, std::memory_order_relaxed);
    }).detach();
}

const char* Argument(int argc, char** argv, const char* Name, const char* Fallback = nullptr)
{
    for (int I = 1; I + 1 < argc; ++I)
        if (std::strcmp(argv[I], Name) == 0) return argv[I + 1];
    return Fallback;
}

bool Switch(int argc, char** argv, const char* Name)
{
    for (int I = 1; I < argc; ++I)
        if (std::strcmp(argv[I], Name) == 0) return true;
    return false;
}

void ReportMetrics(Frontier::DiagnosticMetrics& Logger, const Frontier::AudioMetrics& M)
{
    char Line[512];
    std::snprintf(Line, sizeof(Line),
                  "%s | %s | %u Hz | period %u frames | callbacks %llu | frames %llu | last %.1f us (%.2f load) | peak %.1f us (%.2f load) | overloads %u | clips %u | stops %u | reroutes %u | reopens %u",
                  M.DriverName.c_str(), M.DeviceName.c_str(), M.GrantedSampleRate, M.GrantedPeriodFrames,
                  static_cast<unsigned long long>(M.CallbackCount), static_cast<unsigned long long>(M.FramesRendered),
                  M.LastCallbackMicros, M.CallbackLoad, M.PeakCallbackMicros, M.PeakLoad,
                  M.OverloadCount, M.ClipCount, M.StopCount, M.RerouteCount, M.ReopenCount);
    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Audio", Line);
}

} // namespace

int main(int argc, char** argv)
{
    const char* RenderPath = Argument(argc, argv, "--render");
    const char* PullName   = Argument(argc, argv, "--pull", "sweep");
    const char* CarId      = Argument(argc, argv, "--car", "laferrari");
    const char* EngineKind = Argument(argc, argv, "--engine", "acoustic");
    const uint32_t Cylinders = static_cast<uint32_t>(std::atoi(Argument(argc, argv, "--cylinders", "8")));
    const float    Seconds   = static_cast<float>(std::atof(Argument(argc, argv, "--seconds", "0")));
    const float    RedlineArg = static_cast<float>(std::atof(Argument(argc, argv, "--redline", "0")));
    const bool     UseNull   = Switch(argc, argv, "--null");
    const bool     UseSweep  = Switch(argc, argv, "--sweep");
    const bool     UseFloat  = Switch(argc, argv, "--float");
    const bool     ListCars  = Switch(argc, argv, "--list-cars");

    if (ListCars)
    {
        uint32_t Count = 0u;
        const Frontier::EngineVoice* Garage = Frontier::VoiceGarage(&Count);
        std::printf("Frontier Engine Audio Sim v3 - %u cars\n", Count);
        for (uint32_t I = 0u; I < Count; ++I)
            std::printf("  %-12s %-32s %2u cyl  idle %4.0f  redline %5.0f  %s\n", Garage[I].Id, Garage[I].Name,
                        Garage[I].Cylinders, Garage[I].IdleRpm, Garage[I].RedlineRpm, Garage[I].Tag);
        return 0;
    }

    //──────────────────────────────────────────────────────────────────────────
    // Telemetry sink (same shape as Project-Zero's)
    //──────────────────────────────────────────────────────────────────────────
    Frontier::DiagnosticConfiguration DiagnosticConfig{};
    DiagnosticConfig.DestinationFolder          = "Diagnostics";
    DiagnosticConfig.OutputFileStem             = "ProjectDyno_TelemetryReport";
    DiagnosticConfig.FileExtension              = ".md";
    DiagnosticConfig.TimestampPrefixEnabled     = true;
    DiagnosticConfig.ConsoleEchoEnabled         = true;
    DiagnosticConfig.MarkdownTableFormatEnabled = true;

    Frontier::DiagnosticMetrics Logger(DiagnosticConfig);
    if (!Logger.InitializeSink())
        std::cerr << "[Project-Dyno] Telemetry sink could not be opened; continuing with console output only.\n";
    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Bootstrap", "Project-Dyno dyno cell starting.");

    //──────────────────────────────────────────────────────────────────────────
    // Powertrain + pull (v3 acoustic by default; clicks = transport self-test)
    //──────────────────────────────────────────────────────────────────────────
    const bool UseClicks = std::strcmp(EngineKind, "clicks") == 0;
    const Frontier::EngineVoice* Voice = Frontier::FindVoice(CarId);
    if (!Voice)
    {
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Warning, "Dyno", (std::string("Unknown car '") + CarId + "' - using laferrari (see --list-cars)").c_str());
        Voice = &Frontier::HeroVoice();
    }
    const float Redline = RedlineArg > 0.0f ? RedlineArg : Voice->RedlineRpm;

    Frontier::AcousticIntegrator Acoustic;
    Acoustic.AssignVoice(Voice);
    Frontier::CrankClickIntegrator Clicks(Cylinders == 0u ? 8u : Cylinders);
    Clicks.AssignSweep(UseSweep);
    Frontier::SignalIntegrator* Powertrain = UseClicks ? static_cast<Frontier::SignalIntegrator*>(&Clicks)
                                                       : static_cast<Frontier::SignalIntegrator*>(&Acoustic);
    auto AssignDemand = [&](const Frontier::PowertrainRecord& Record)
    {
        if (UseClicks) Clicks.AssignDemand(Record); else Acoustic.AssignDemand(Record);
    };
    auto QueryEvents = [&]() -> uint64_t { return UseClicks ? Clicks.QueryEventCount() : Acoustic.QueryEventCount(); };

    Frontier::DynoSequence Pull;
    if (!Pull.Select(PullName, Redline))
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Warning, "Dyno", (std::string("Unknown pull '") + PullName + "' — using sweep").c_str());
    {
        char Line[384];
        std::snprintf(Line, sizeof(Line), "pull '%s' (%.1f s), car '%s' (%s, %u cylinders, redline %.0f rpm), engine %s%s",
                      std::string(Pull.QueryName()).c_str(), Pull.QueryDuration(), Voice->Id, Voice->Name,
                      UseClicks ? (Cylinders == 0u ? 8u : Cylinders) : Voice->Cylinders, Redline,
                      UseClicks ? "clicks (transport self-test)" : "acoustic v3", UseSweep ? ", sine sweep on" : "");
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Dyno", Line);
    }

    Frontier::AudioConfiguration AudioConfig;
    AudioConfig.SampleRate        = 48000u;
    AudioConfig.ChannelCount      = 2u;
    AudioConfig.PeriodFrames      = 256u;
    AudioConfig.RenderSliceFrames = 64u;
    AudioConfig.Driver           = UseNull ? Frontier::AudioDriverCategory::Null : Frontier::AudioDriverCategory::Platform;

    //──────────────────────────────────────────────────────────────────────────
    // Offline render: identical generator + slicing, no device
    //──────────────────────────────────────────────────────────────────────────
    if (RenderPath)
    {
        // The pull is advanced per render block at exactly the block's duration, mirroring what the live loop does at
        //    frame rate — but deterministically, so two renders of the same arguments are byte-identical.
        struct PulledIntegrator final : Frontier::SignalIntegrator
        {
            Frontier::SignalIntegrator& Inner;
            Frontier::DynoSequence&     Pull;
            bool                        ClicksMode;
            Frontier::AcousticIntegrator* AcousticPtr;
            Frontier::CrankClickIntegrator* ClicksPtr;
            uint32_t                    Rate = 48000u;
            PulledIntegrator(Frontier::SignalIntegrator& G, Frontier::DynoSequence& P, bool C,
                             Frontier::AcousticIntegrator* A, Frontier::CrankClickIntegrator* K)
                : Inner(G), Pull(P), ClicksMode(C), AcousticPtr(A), ClicksPtr(K) { }
            void Prepare(uint32_t SampleRate, uint32_t ChannelCount) noexcept override { Rate = SampleRate; Inner.Prepare(SampleRate, ChannelCount); Pull.Restart(); }
            void Render(float* Output, uint32_t FrameCount) noexcept override
            {
                Pull.Advance(static_cast<float>(FrameCount) / static_cast<float>(Rate));
                if (ClicksMode) ClicksPtr->AssignDemand(Pull.QueryRecord()); else AcousticPtr->AssignDemand(Pull.QueryRecord());
                Inner.Render(Output, FrameCount);
            }
        } Pulled(*Powertrain, Pull, UseClicks, &Acoustic, &Clicks);

        Frontier::WaveClip Clip;
        Clip.SampleRate   = AudioConfig.SampleRate;
        Clip.ChannelCount = AudioConfig.ChannelCount;
        const double Length = Seconds > 0.0f ? Seconds : Pull.QueryDuration();
        Frontier::AudioExchange::RenderOffline(Pulled, Clip.SampleRate, Clip.ChannelCount, AudioConfig.RenderSliceFrames, Length, AudioConfig.MasterGain, Clip.Samples);

        std::string Error;
        const bool Written = Frontier::WaveCodec::Encode(RenderPath, Clip, UseFloat ? Frontier::WaveEncodingCategory::Float32 : Frontier::WaveEncodingCategory::Pcm16, &Error);
        char Line[512];
        if (Written) std::snprintf(Line, sizeof(Line), "rendered %.2f s (%llu frames, %llu firing events) to %s", Length,
                                   static_cast<unsigned long long>(Clip.FrameCount()), static_cast<unsigned long long>(QueryEvents()), RenderPath);
        else         std::snprintf(Line, sizeof(Line), "render failed: %s", Error.c_str());
        Logger.RecordMessage(Written ? Frontier::DiagnosticSeverity::Information : Frontier::DiagnosticSeverity::Fatal, "Render", Line);
        Logger.TerminateSink();
        return Written ? 0 : 1;
    }

    //──────────────────────────────────────────────────────────────────────────
    // Live: device up, generator attached, main loop at ~240 Hz
    //──────────────────────────────────────────────────────────────────────────
    Frontier::AudioExchange Audio;
    {
        std::string Error;
        if (!Audio.Open(AudioConfig, &Error))
        {
            Logger.RecordMessage(Frontier::DiagnosticSeverity::Fatal, "Audio", Error.c_str());
            Logger.TerminateSink();
            std::cerr << "\nProject-Dyno could not open an audio device (try --null or --render). Press Enter to close.\n";
            std::cin.get();
            return 1;
        }
    }
    Audio.Attach(Powertrain);
    ReportMetrics(Logger, Audio.QueryMetrics());
    if (Seconds <= 0.0f)
    {
        std::cout << "[Dyno] Running. Press Enter to stop.\n";
        WatchStandardInput();
    }

    using Clock    = std::chrono::high_resolution_clock;
    using Duration = std::chrono::duration<float>;
    auto  PreviousTime = Clock::now();
    float Elapsed      = 0.0f;   // [s]
    float ReportTimer  = 0.0f;   // [s]

    while (!StopRequested.load(std::memory_order_relaxed))
    {
        const auto NowTime = Clock::now();
        float      Δτ      = std::chrono::duration_cast<Duration>(NowTime - PreviousTime).count();
        PreviousTime       = NowTime;
        if (Δτ > 0.1f) Δτ = 0.1f;   // same spiral-of-death clamp as Project-Zero's loop

        // ① Script → demand → transport housekeeping. This is the exact call sequence the game loop will carry.
        Pull.Advance(Δτ);
        if (Pull.Finished()) Pull.Restart();
        AssignDemand(Pull.QueryRecord());
        Audio.Advance(Δτ);

        // ② Periodic health line (every 2 s) — what the F3 popup / AudioEditor device panel will show later
        Elapsed     += Δτ;
        ReportTimer += Δτ;
        if (ReportTimer >= 2.0f) { ReportTimer = 0.0f; ReportMetrics(Logger, Audio.QueryMetrics()); }
        if (Seconds > 0.0f && Elapsed >= Seconds) break;

        std::this_thread::sleep_for(std::chrono::microseconds(4000));   // ~240 Hz main loop; the device thread is independent
    }

    //──────────────────────────────────────────────────────────────────────────
    // Shutdown
    //──────────────────────────────────────────────────────────────────────────
    Audio.Advance(0.0f);
    ReportMetrics(Logger, Audio.QueryMetrics());
    const Frontier::AudioMetrics Final = Audio.QueryMetrics();
    Audio.Attach(nullptr);
    Audio.Close();
    {
        char Line[256];
        std::snprintf(Line, sizeof(Line), "%.1f s live, %llu firing events, %u overloads, %u clips — %s", Elapsed,
                      static_cast<unsigned long long>(QueryEvents()), Final.OverloadCount, Final.ClipCount,
                      (Final.OverloadCount == 0u && Final.ClipCount == 0u) ? "PASS" : "CHECK");
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Shutdown", Line);
    }
    Logger.TerminateSink();
    return 0;
}
