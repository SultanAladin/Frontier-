//============================================================================================================================================
//                                                      ACOUSTICINTEGRATOR.H
//============================================================================================================================================
// 🧩 Row A2's acoustic integrator: Frontier Engine Audio Sim v3 as a native SignalIntegrator. This is the hybrid
//    the two EngineAudioSim branches each failed to be alone — patch-1's per-car exhaust physics (formants,
//    runner flight times, collector groups, pipe resonator, torsional crank, cabin) fused with the main branch's
//    raw layers (asymmetric rarefaction pulse, pulse-gated order harmonics with a CAPPED loudest-order peak,
//    inter-bank AM rasp, per-firing stochastic crackle, heat-drifting formants, load-sensitive loudness).
//
//    Three synthesis models share one demand path and one set of output layers (spool, charger, cabin):
//        pulse     even-firing engines: one pressure pulse per firing travels its own runner into collector
//                  groups, then per-bank formants / pipe / muffler. Irregular per cylinder and per cycle.
//        additive  cross-plane V8s (uneven firing): harmonic series per firing phase, bank delay + lope.
//        ev        Taycan: motor-order tones, gear whine, electromagnetic throb (main-branch EV recipe).
//
//    Realtime contract (AudioExchange.h): Render is lock-free and allocation-free. All tables and delay rings
//    are sized in Prepare; AssignVoice only publishes a pointer, the rebuild happens into fixed arrays.
//    Randomness is a seeded xorshift (never rand()/Math.random()), so --render output is byte-deterministic.
//
//    Voice data lives in EngineVoice.h/.cpp — native twin of the web garage in Projects/Project-Dyno/Web.

#pragma once

#include "../../../Engine/DeviceExchange/RelayQueue.h"
#include "../../../Engine/PlatformInterchange/AudioExchange.h"
#include "DynoSequence.h"
#include "EngineVoice.h"

#include <array>
#include <atomic>
#include <cstdint>

namespace Frontier {

class AcousticIntegrator final : public SignalIntegrator
{
public:
    AcousticIntegrator() noexcept;

    // Main thread: publish the latest demand (wait-free triple-slot relay, latest wins).
    void AssignDemand(const PowertrainRecord& Record) noexcept { Demand.Publish(Record); }

    // Main thread: select the car. Only the pointer is published; per-voice tables rebuild on the realtime
    //    side (or in Prepare) into preallocated arrays. Safe before or after Prepare.
    void AssignVoice(const EngineVoice* Voice) noexcept { PendingVoice.store(Voice, std::memory_order_release); }
    [[nodiscard]] const EngineVoice* QueryVoice() const noexcept { return ActiveVoice; }

    // SignalIntegrator
    void Prepare(uint32_t SampleRate, uint32_t ChannelCount) noexcept override;
    void Render(float* Output, uint32_t FrameCount) noexcept override;

    [[nodiscard]] uint64_t QueryEventCount() const noexcept { return EventCount.load(std::memory_order_relaxed); }

private:
    // ── small DSP primitives (constant-peak band-pass, state-variable low-pass; web BP/LPF twins) ──
    struct BandPass
    {
        float B0 = 0, A1 = 0, A2 = 0, X1 = 0, X2 = 0, Y1 = 0, Y2 = 0;
        void Set(float Hz, float Q, float SampleRate) noexcept;
        float Process(float X) noexcept
        {
            const float Y = B0 * (X - X2) - A1 * Y1 - A2 * Y2;
            X2 = X1; X1 = X; Y2 = Y1; Y1 = Y; return Y;
        }
        void Clear() noexcept { X1 = X2 = Y1 = Y2 = 0.0f; }
    };
    struct LowPass
    {
        float A1 = 0, A2 = 0, A3 = 0, Ic1 = 0, Ic2 = 0;
        void Set(float Hz, float Q, float SampleRate) noexcept;
        float Process(float X) noexcept
        {
            const float V3 = X - Ic2;
            const float V1 = A1 * Ic1 + A2 * V3;
            const float V2 = Ic2 + A2 * Ic1 + A3 * V3;
            Ic1 = 2.0f * V1 - Ic1; Ic2 = 2.0f * V2 - Ic2; return V2;
        }
        void Clear() noexcept { Ic1 = Ic2 = 0.0f; }
    };

    static constexpr uint32_t MaxCyl = 16u;
    static constexpr uint32_t MaxGroups = 4u;
    static constexpr uint32_t MaxFormants = 6u;
    static constexpr uint32_t MaxIntake = 3u;
    static constexpr uint32_t MaxOrders = 8u;
    static constexpr uint32_t MaxHarmonics = 96u;
    static constexpr uint32_t DelayLen = 2048u;
    static constexpr uint32_t DelayMask = DelayLen - 1u;
    static constexpr uint32_t MaxPops = 14u;

    void BuildTables(const EngineVoice& Voice) noexcept;
    void NewExhaustEvent(uint32_t I) noexcept;
    void SpawnPop(float Amp, float WidthMs, uint32_t Group) noexcept;
    [[nodiscard]] float Random() noexcept;
    [[nodiscard]] float Gauss() noexcept;

    void RenderPulse(float* Output, uint32_t FrameCount) noexcept;
    void RenderAdditive(float* Output, uint32_t FrameCount) noexcept;
    void RenderElectric(float* Output, uint32_t FrameCount) noexcept;

    const EngineVoice* ActiveVoice = nullptr;
    std::atomic<const EngineVoice*> PendingVoice { nullptr };
    RelayQueue<PowertrainRecord> Demand;
    std::atomic<uint64_t> EventCount { 0u };

    uint32_t Rate = 48000u;
    uint32_t Channels = 2u;
    uint32_t Seed = 2463534242u;

    // demand, slewed per sample (block-size invariant, like CrankClickIntegrator)
    double CurrentRpm = 900.0;
    float  Load = 0.0f, BoostState = 0.0f, Spool = 0.0f, PrevLoad = 0.0f;
    double Cycle = 0.0;             // firing-cycle phase [0,1)
    double Theta = 0.0;             // additive-model crank phase [rad]
    float  Volume = 0.0f, CutGain = 1.0f, PowerNorm = 0.5f, Heat = 0.3f;
    float  Torsion = 0.0f, TorsionDc = 0.0f, Tau = 1.0f;
    float  OrderGate = 0.0f;
    double TimeSeconds = 0.0;
    uint32_t CutTimer = 0u, SincePop = 0u;

    // per-cylinder tables (built in BuildTables)
    uint32_t CylCount = 8u, GroupCount = 1u;
    std::array<float, MaxCyl> Frac{}, BankPanL{}, BankPanR{}, CylGain{};
    std::array<uint8_t, MaxCyl> BankOf{}, Route{};
    std::array<float, MaxCyl> RunnerSec{}, IntakeSec{}, DurM{}, DecM{}, AtkM{}, AmpStatic{}, TimStaticDeg{};
    std::array<float, MaxCyl> BaseEx{}, BaseIn{}, LastEx{}, LastIn{}, AmpEvent{}, JitEvent{}, AmpIntake{}, DurEvent{}, DecEvent{};
    std::array<uint8_t, MaxGroups> GroupBank{};

    // filters / resonators
    std::array<BandPass, MaxFormants> FormantA{}, FormantB{};
    std::array<BandPass, MaxIntake> IntakeL{}, IntakeR{};
    BandPass RaspA, RaspB, BlockA, BlockB, InjA, InjB, ChainA, ChainB, SlapA, SlapB, CamA, CamB, CabA, CabB, CrackleA, CrackleB;
    LowPass MufflerA, MufflerB;

    // delay rings (collector groups, bank pipes, scavenge, tail)
    std::array<std::array<float, DelayLen>, MaxGroups> GroupBuf{};
    std::array<float, DelayLen> PipeA{}, PipeB{}, ScavBuf{}, TailBuf{};
    std::array<uint32_t, MaxGroups> GroupDelay{};
    std::array<float, MaxGroups> GroupLag{}, GroupDc{}, GroupTurbLp{};
    uint32_t PipeDelayA = 4u, PipeDelayB = 4u, ScavDelay = 4u, TailDelay = 4u, WritePos = 0u;
    float PipeLagA = 0, PipeLagB = 0, ScavLag = 0, TailLag = 0;

    // continuous-layer state
    float LowA = 0, LowB = 0, DcA = 0, DcB = 0, DcI = 0, PrevEA = 0, PrevEB = 0;
    float CrackleLevelA = 0, CrackleLevelB = 0, CrackleDecayA = 40.0f, CrackleDecayB = 40.0f;
    float TurboPhase1 = 0, TurboPhase2 = 0, ChargerPhase = 0, EvPhase1 = 0, EvPhase2 = 0, EvPhase3 = 0;

    struct Pop { float Age = 0, Width = 0.001f, Amp = 0; uint32_t Group = 0u; bool Active = false; };
    std::array<Pop, MaxPops> Pops{};
};

} // namespace Frontier
