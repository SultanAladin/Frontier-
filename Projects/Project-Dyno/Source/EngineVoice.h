//============================================================================================================================================
//                                                        ENGINEVOICE.H
//============================================================================================================================================
// 🧩 Engine voices: the per-car acoustic identity for AcousticIntegrator — Frontier Engine Audio Sim v3, native twin of
//    Projects/Project-Dyno/Web/src/sim/voices.ts + cars.ts (the two must tell the same story; the web file carries the
//    long-form rationale, this file carries the same numbers in engine form).
//
//    Provenance, honestly: neither ancestor was sufficient alone.
//        EngineAudioSim `main`        raw and detailed — asymmetric combustion pulse, per-firing noise crackle, AM
//                                     tearing rasp, migrating harmonic peak — but every car shared one pulse shape
//                                     and one harmonic recipe, so every car sounded the same.
//        EngineAudioSim patch-1       deep per-car character — exhaust formants, runner flight times, collector
//                                     groups, torsional crank, cabin — but analytic pulses, one-sided jitter, a
//                                     perfectly periodic cycle and a full loudness normaliser made it digital
//                                     and linear, and its LaFerrari was the thinnest voice in the garage.
//        This file (v3)               patch-1's exhaust physics as the character backbone, main's raw layers fused
//                                     back in (Rarefaction, pulse-gated Orders with a capped peak, RaspAM, per-event
//                                     Crackle, heat-drifting formants), plus a rebuilt LaFerrari profile (below).
//
//    LaFerrari (F140 FE 6.3 L 65° V12) — why it never sounded right, and what changed:
//        ① OrderPeak 3.4 (was: migration to order 8–12). The old peak thinned the top end into an F1 shriek.
//        ② Body 1.05 @ 118 Hz + Rare 0.38 (was: body 0.7, no rarefaction). The hollow low-rpm bark is back; the
//           scream layers over the chest instead of replacing it.
//        ③ Formants 132 / 356 / 742 / 1480 / 2950 / 4700 Hz, heat-drifting (was: generic 150…3600 stack).
//           The 742 Hz collector howl is the loudest — that band *is* the Ferrari V12 signature.
//        ④ Round is now dynamic in the integrator (sharp at idle → overlapped silk at 9 000 rpm); the static
//           compromise shape could do neither. Even firing stays dead even (Rough/Skew/Lope are the garage's
//           smallest): a LaFerrari must never lope like a cross-plane V8.

#pragma once

#include <cstdint>
#include <string_view>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                   VOICE RECORD
//------------------------------------------------------------------------------------------------------------------------

struct VoiceFormant
{
    float Hz   = 0.0f;   // [Hz] resonance centre
    float Gain = 0.0f;   // [-]  peak gain into the bank mix
    float Q    = 3.0f;   // [-]  resonance sharpness
};

// One car's complete acoustic identity. Plain data, no behaviour: AcousticIntegrator interprets it.
//    Field groups mirror the web VoiceProfile so the two garages can be diffed by eye.
struct EngineVoice
{
    const char* Id   = "";      // [-]    stable key ("laferrari")
    const char* Name = "";      // [-]    display name
    const char* Tag  = "";      // [-]    one-line character description

    uint32_t Cylinders  = 8u;   // [-]
    uint32_t Banks      = 2u;   // [-]    1 = inline / flat single collector side, 2 = V / boxer
    bool     CrossPlane = false;// [-]    uneven-fire V8 → additive harmonic model (AMG / Vantage / Demon)
    bool     Electric   = false;// [-]    EV synthesis (Taycan); combustion fields unused
    bool     Boosted    = false;// [-]    turbocharged (spool / turbine layers)
    float    IdleRpm    = 900.0f;   // [rpm]
    float    RedlineRpm = 8000.0f;  // [rpm]

    // Exhaust pulse geometry (patch-1 backbone)
    float BlowLow  = 105.0f;    // [deg]  blow-down window at idle
    float BlowHigh = 75.0f;     // [deg]  blow-down window at redline
    float Decay    = 2.8f;      // [-]    pulse tail exponent (higher = crisper)
    float Attack   = 0.0005f;   // [s]    pulse attack time
    float Round    = 0.0f;      // [-]    static roundness seed; the integrator adds rpm-dependent rounding
    float FcLow    = 900.0f;    // [Hz]   muffler corner, closed throttle
    float FcHigh   = 5000.0f;   // [Hz]   muffler corner, full throttle
    float Direct   = 1.0f;      // [-]    un-resonated pulse level
    float Body     = 1.0f;      // [-]    low thump level
    float BodyHz   = 130.0f;    // [Hz]   thump corner
    VoiceFormant Formants[6]{}; // [-]    exhaust resonances per bank (slightly detuned bank to bank)
    uint32_t     FormantCount = 0u;
    float Detune   = 0.05f;     // [-]    header length difference between banks
    float BankGain = 0.88f;     // [-]    bank B level relative to bank A
    float PipeMs   = 0.0f;      // [ms]   exhaust pipe round-trip delay (0 disables)
    float PipeFb   = 0.0f;      // [-]    pipe reflection (negative = open end)
    float PipeDamp = 3000.0f;   // [Hz]   damping inside the pipe loop
    float Rasp     = 0.0f;      // [-]    gated combustion rasp level
    float RaspHz   = 2000.0f;   // [Hz]   rasp band centre
    VoiceFormant Intake[3]{};   // [-]    induction resonances
    uint32_t     IntakeCount = 0u;
    float IntakeGain = 0.5f;    // [-]
    float IntakeW    = 175.0f;  // [deg]  intake pulse width

    // Irregularity — the anti-synthesiser (patch-1, with v3 zero-mean jitter in the integrator)
    float Rough    = 0.14f;     // [-]    static cylinder-to-cylinder level spread
    float Skew     = 2.4f;      // [deg]  static cylinder timing error
    float Cyc      = 0.14f;     // [-]    cycle-to-cycle combustion variation
    float Jit      = 1.5f;      // [deg]  cycle-to-cycle timing jitter
    float IdleLope = 0.45f;     // [-]    extra lumpiness at idle
    float Drive    = 1.0f;      // [-]    saturation drive (host waveshaper; informational here)
    float Level    = 0.30f;     // [-]    target loudness into the partial normaliser

    // Header-wave physics (patch-1)
    float RunnerMs     = 0.9f;  // [ms]   exhaust runner flight time, port → collector
    float RunnerSpread = 0.2f;  // [-]    how unequal the individual runners are
    float ReflG        = 0.3f;  // [-]    reflected suction-wave strength (tuned-header tone)
    float CollMs       = 1.2f;  // [ms]   collector merge-pipe delay
    float CollFb       = 0.25f; // [-]    collector reflection
    float Turbo        = 0.0f;  // [-]    turbine edge-soak (0 = naturally aspirated)
    float TurboHz      = 1500.0f; // [Hz] turbine soak corner

    // Mechanical / tonal detail
    float Tors     = 0.04f;     // [-]    crank torsional swing driven by the firing pulses
    float CamHz    = 2600.0f;   // [Hz]   valvetrain resonance
    float CamQ     = 5.0f;      // [-]
    float CamG     = 0.7f;      // [-]    valvetrain excitation per valve event
    float CabHz    = 86.0f;     // [Hz]   cabin / body boom resonance
    float CabG     = 0.34f;     // [-]    cabin resonance level

    // Additive-model (cross-plane) parameters — patch-1's SoundProfile, engine form
    float        Alpha = 1.0f;  // [-]    pulse spectral slope
    VoiceFormant AddRes[4]{};   // [-]    exhaust formants [Hz, gain, log-width in Q slot]
    uint32_t     AddResCount = 0u;
    float        Lope = 0.1f;   // [-]    idle lope depth

    // v3 hybrid layers (EngineAudioSim `main`, generalised per car)
    float Rare       = 0.22f;   // [-]    negative rarefaction dip after blow-down (hollow bark)
    float RaspAM     = 0.25f;   // [-]    inter-bank AM tearing rasp
    float Orders[8]{};          // [-]    tonal order weights vs firing frequency
    uint32_t OrderCount = 0u;
    float OrderGain  = 0.35f;   // [-]    order-layer level (pulse-gated in the integrator)
    float OrderPeak  = 5.0f;    // [-]    cap on loudest-order migration — the anti-F1 control
    float Crackle    = 0.22f;   // [-]    per-firing stochastic HF burst level
    float CrackleHz  = 4800.0f; // [Hz]   crackle band centre
    float FormantHeat = 0.7f;   // [-]    formant drift with exhaust temperature
    float Charger    = 0.0f;    // [-]    supercharger whine level (Demon)
    float ChargerRatio = 36.0f; // [-]    charger cycles per crank revolution
    float SpoolHz    = 6200.0f; // [Hz]   turbo shaft whistle at full spool
    float SpoolG     = 0.0f;    // [-]    spool whistle multiplier
    float Pop        = 0.4f;    // [-]    overrun / lift-off pop propensity
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   GARAGE
//------------------------------------------------------------------------------------------------------------------------

// The full v3 garage (18 cars). Storage outlives the program; never null.
[[nodiscard]] const EngineVoice* VoiceGarage(uint32_t* Count) noexcept;

// Exact-id lookup ("laferrari", "amg-gt3", …); nullptr when unknown.
[[nodiscard]] const EngineVoice* FindVoice(std::string_view Id) noexcept;

// The hero car: rebuilt LaFerrari. Equivalent to FindVoice("laferrari"), never null.
[[nodiscard]] const EngineVoice& HeroVoice() noexcept;

} // namespace Frontier
