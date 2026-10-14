//============================================================================================================================================
//                                                    ACOUSTICINTEGRATOR.CPP
//============================================================================================================================================
// 🧩 Hybrid engine synthesis (see AcousticIntegrator.h). Per-sample work is deliberately boring: fixed arrays,
//    no allocation, no locks, seeded RNG — the offline --render path and the live device hear identical samples.

#include "AcousticIntegrator.h"

#include <algorithm>
#include <cmath>

namespace Frontier {

namespace {
constexpr double Pi = 3.14159265358979323846;
constexpr double TwoPi = 6.28318530717958647692;

float ClampF(float X, float A, float B) noexcept { return X < A ? A : (X > B ? B : X); }
float SmoothF(float X, float A, float B) noexcept
{
    const float T = ClampF((X - A) / (B - A), 0.0f, 1.0f);
    return T * T * (3.0f - 2.0f * T);
}
float Sat(float X) noexcept { return X / (1.0f + std::fabs(X)); }
// deterministic per-index spread in [-1,1] (web cars.ts twin)
float Spread(uint32_t I, float Salt) noexcept
{
    const double X = std::sin(double(I + 1u) * 12.9898 + double(Salt) * 78.233) * 43758.5453;
    return float((X - std::floor(X)) * 2.0 - 1.0);
}
} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                   DSP PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::BandPass::Set(float Hz, float Q, float SampleRate) noexcept
{
    const double W = TwoPi * double(std::min(Hz, SampleRate * 0.45f)) / double(SampleRate);
    const double Al = std::sin(W) / (2.0 * double(std::max(0.1f, Q)));
    const double A0 = 1.0 + Al;
    B0 = float(Al / A0); A1 = float(-2.0 * std::cos(W) / A0); A2 = float((1.0 - Al) / A0);
}

void AcousticIntegrator::LowPass::Set(float Hz, float Q, float SampleRate) noexcept
{
    const float Fr = ClampF(Hz, 20.0f, SampleRate * 0.45f);
    const double G = std::tan(Pi * double(Fr) / double(SampleRate));
    const double K = 1.0 / double(std::max(0.1f, Q));
    A1 = float(1.0 / (1.0 + G * (G + K)));
    A2 = float(G * double(A1));
    A3 = float(G * double(A2));
}

float AcousticIntegrator::Random() noexcept
{
    Seed ^= Seed << 13u; Seed ^= Seed >> 17u; Seed ^= Seed << 5u;
    return float(Seed) * (1.0f / 4294967296.0f);
}
float AcousticIntegrator::Gauss() noexcept { return (Random() + Random() + Random() - 1.5f) * 2.0f; }

//------------------------------------------------------------------------------------------------------------------------
//                                                   TABLE BUILD
//------------------------------------------------------------------------------------------------------------------------

AcousticIntegrator::AcousticIntegrator() noexcept
{
    PendingVoice.store(&HeroVoice(), std::memory_order_relaxed);
}

void AcousticIntegrator::BuildTables(const EngineVoice& V) noexcept
{
    ActiveVoice = &V;
    CylCount = std::min<uint32_t>(std::max(1u, V.Cylinders), MaxCyl);
    const uint32_t Banks = std::min(2u, std::max(1u, V.Banks));

    // firing phases + banks: cross-plane V8 keeps its L R R L R L L R bank sequence (patch-1 buildFiring)
    static constexpr uint8_t CrossBank[8] = { 0, 1, 1, 0, 1, 0, 0, 1 };
    for (uint32_t I = 0u; I < CylCount; ++I)
    {
        Frac[I] = float(I) / float(CylCount);
        BankOf[I] = (V.CrossPlane && CylCount == 8u) ? CrossBank[I] : uint8_t(Banks == 2u ? (I % 2u) : 0u);
        CylGain[I] = 1.0f + (V.CrossPlane ? V.Rough : V.Rough) * 0.6f * Spread(I, 3.0f);
        BankPanL[I] = Banks == 2u ? (BankOf[I] ? 0.5f : 1.0f) : 0.8f;
        BankPanR[I] = Banks == 2u ? (BankOf[I] ? 1.0f : 0.5f) : 0.8f;
        if (BankOf[I]) { BankPanL[I] *= V.BankGain; BankPanR[I] *= V.BankGain; }
        AmpStatic[I] = ClampF(1.0f + V.Rough * 1.7f * Spread(I, 1.0f), 0.5f, 1.5f);
        TimStaticDeg[I] = V.Skew * 1.7f * Spread(I, 2.0f);
        AmpEvent[I] = AmpIntake[I] = 1.0f; JitEvent[I] = 0.0f;
        DurEvent[I] = DurM[I] = ClampF(1.0f + 0.22f * Spread(I, 13.0f), 0.6f, 1.6f);
        DecEvent[I] = DecM[I] = ClampF(1.0f + 0.30f * Spread(I, 17.0f), 0.6f, 1.6f);
        AtkM[I] = ClampF(1.0f + 0.45f * Spread(I, 11.0f), 0.45f, 2.0f);
    }

    // collector / scroll routing: turbo (and single-bank) engines split each bank into two scrolls
    const uint32_t PerBank = (V.Boosted || Banks == 1u) ? 2u : 1u;
    GroupCount = std::min(MaxGroups, Banks == 1u ? PerBank : Banks * PerBank);
    uint32_t Seen[2] = { 0u, 0u };
    for (uint32_t I = 0u; I < CylCount; ++I)
    {
        const uint32_t Sub = PerBank > 1u ? (Seen[BankOf[I]]++ % 2u) : 0u;
        Route[I] = uint8_t(std::min(GroupCount - 1u, BankOf[I] * PerBank + Sub));
        const float Gm = Sub == 0u ? 1.0f : 1.22f;   // second scroll is routed a little longer
        RunnerSec[I] = (V.RunnerMs * Gm * (1.0f + V.RunnerSpread * Spread(I, 5.0f))) * 0.001f;
        IntakeSec[I] = (0.9f * (1.0f + 0.3f * Spread(I, 7.0f))) * 0.001f;
        (void)IntakeSec;
    }
    for (uint32_t G = 0u; G < MaxGroups; ++G)
    {
        GroupBank[G] = uint8_t(PerBank > 0u ? (G / PerBank) : 0u);
        GroupDelay[G] = uint32_t(std::clamp(int(std::lround(double(V.CollMs) * 0.001 * double(Rate) * (1.0 + 0.13 * double(G)))), 2, int(DelayLen - 4u)));
        GroupLag[G] = GroupDc[G] = GroupTurbLp[G] = 0.0f;
        GroupBuf[G].fill(0.0f);
    }

    // cycle-phase bases: exhaust at the firing slot, intake half a cycle later
    for (uint32_t I = 0u; I < CylCount; ++I)
    {
        float Pe = Frac[I] + TimStaticDeg[I] / 720.0f; Pe -= std::floor(Pe);
        float Pn = Frac[I] + 0.5f + TimStaticDeg[I] * 0.5f / 720.0f; Pn -= std::floor(Pn);
        BaseEx[I] = Pe; BaseIn[I] = Pn; LastEx[I] = LastIn[I] = 0.0f;
    }

    for (uint32_t J = 0u; J < MaxFormants; ++J)
    {
        const VoiceFormant& Fm = V.Formants[std::min(J, std::max(1u, V.FormantCount) - 1u)];
        FormantA[J].Set(Fm.Hz * (1.0f - 0.5f * V.Detune), Fm.Q, float(Rate));
        FormantB[J].Set(Fm.Hz * (1.0f + 0.5f * V.Detune), Fm.Q, float(Rate));
        FormantA[J].Clear(); FormantB[J].Clear();
    }
    for (uint32_t J = 0u; J < MaxIntake; ++J)
    {
        const VoiceFormant& Fm = V.Intake[std::min(J, std::max(1u, V.IntakeCount) - 1u)];
        IntakeL[J].Set(Fm.Hz * 0.97f, Fm.Q, float(Rate));
        IntakeR[J].Set(Fm.Hz * 1.03f, Fm.Q, float(Rate));
        IntakeL[J].Clear(); IntakeR[J].Clear();
    }
    RaspA.Set(V.RaspHz, 1.0f, float(Rate)); RaspB.Set(V.RaspHz * 1.07f, 1.0f, float(Rate));
    BlockA.Set(std::max(40.0f, V.BodyHz), 1.1f, float(Rate)); BlockB.Set(std::max(40.0f, V.BodyHz) * 1.03f, 1.1f, float(Rate));
    InjA.Set(3000.0f, 7.0f, float(Rate)); InjB.Set(3120.0f, 7.0f, float(Rate));
    ChainA.Set(800.0f, 2.0f, float(Rate)); ChainB.Set(816.0f, 2.0f, float(Rate));
    SlapA.Set(650.0f, 2.4f, float(Rate)); SlapB.Set(670.0f, 2.4f, float(Rate));
    CamA.Set(V.CamHz, V.CamQ, float(Rate)); CamB.Set(V.CamHz * 1.03f, V.CamQ, float(Rate));
    CabA.Set(V.CabHz, 2.2f, float(Rate)); CabB.Set(V.CabHz * 1.015f, 2.2f, float(Rate));
    CrackleA.Set(V.CrackleHz, 1.1f, float(Rate)); CrackleB.Set(V.CrackleHz * 1.06f, 1.1f, float(Rate));
    MufflerA.Clear(); MufflerB.Clear();

    PipeDelayA = uint32_t(std::clamp(int(std::lround(double(V.PipeMs) * 0.001 * double(Rate))), 2, int(DelayLen - 4u)));
    PipeDelayB = uint32_t(std::clamp(int(std::lround(double(V.PipeMs) * 0.001 * double(Rate) * double(1.0f + 1.2f * V.Detune + 0.015f))), 2, int(DelayLen - 4u)));
    ScavDelay = uint32_t(std::clamp(int(std::lround(3.0 * 0.001 * double(Rate))), 2, int(DelayLen - 4u)));
    TailDelay = uint32_t(std::clamp(int(std::lround(5.0 * 0.001 * double(Rate))), 2, int(DelayLen - 4u)));
    PipeA.fill(0.0f); PipeB.fill(0.0f); ScavBuf.fill(0.0f); TailBuf.fill(0.0f);
    for (Pop& P : Pops) P.Active = false;
    Cycle = 0.0; Volume = 0.0f; PowerNorm = 0.5f; OrderGate = 0.0f; Tau = 1.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   EVENTS
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::NewExhaustEvent(uint32_t I) noexcept
{
    const EngineVoice& V = *ActiveVoice;
    const float RpmNow = float(CurrentRpm);
    const float IdleF = 1.0f - SmoothF(RpmNow, V.IdleRpm + 200.0f, V.IdleRpm + 3000.0f);
    const float PCyc = V.Cyc * (1.0f + 3.0f * V.IdleLope * IdleF);
    float Amp = AmpStatic[I] * (1.0f + PCyc * Gauss());
    // rev-limiter / fuel cut: skip firings, sometimes as a pop through the car's own exhaust
    const bool Cutting = CutTimer > 0u;
    if (Cutting && Random() < 0.65f)
    {
        Amp = 0.0f;
        if (Random() < 0.35f) SpawnPop(1.2f + 2.2f * Random(), 2.0f + 3.0f * Random(), Route[I]);
    }
    AmpEvent[I] = ClampF(Amp, 0.0f, 2.2f);
    const float PJit = V.Jit * (1.0f + IdleF);
    const float Jt = Gauss() * PJit * 1.3f;                    // v3: zero-mean (patch-1 was late-only)
    JitEvent[I] = ClampF(Jt, -8.0f, 8.0f);
    DurEvent[I] = ClampF(1.0f + 0.11f * Gauss(), 0.65f, 1.4f) * DurM[I];
    DecEvent[I] = ClampF(1.0f + 0.13f * Gauss(), 0.6f, 1.5f) * DecM[I];
    EventCount.fetch_add(1u, std::memory_order_relaxed);
}

void AcousticIntegrator::SpawnPop(float Amp, float WidthMs, uint32_t Group) noexcept
{
    for (Pop& P : Pops)
        if (!P.Active) { P = Pop{ 0.0f, WidthMs * 0.001f, Amp, std::min(Group, GroupCount - 1u), true }; return; }
    Pops[0] = Pop{ 0.0f, WidthMs * 0.001f, Amp, std::min(Group, GroupCount - 1u), true };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PREPARE / RENDER
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::Prepare(uint32_t SampleRate, uint32_t ChannelCount) noexcept
{
    Rate = std::max(8000u, SampleRate);
    Channels = std::max(1u, ChannelCount);
    Seed = 2463534242u;
    CurrentRpm = 900.0; Load = 0.0f; BoostState = 0.0f; Spool = 0.0f; PrevLoad = 0.0f;
    Volume = 0.0f; CutGain = 1.0f; PowerNorm = 0.5f; Heat = 0.3f;
    Torsion = TorsionDc = 0.0f; Tau = 1.0f; OrderGate = 0.0f; TimeSeconds = 0.0;
    CutTimer = 0u; SincePop = 0u; WritePos = 0u;
    LowA = LowB = DcA = DcB = DcI = PrevEA = PrevEB = 0.0f;
    CrackleLevelA = CrackleLevelB = 0.0f;
    TurboPhase1 = TurboPhase2 = ChargerPhase = EvPhase1 = EvPhase2 = EvPhase3 = 0.0f;
    EventCount.store(0u, std::memory_order_relaxed);
    const EngineVoice* V = PendingVoice.load(std::memory_order_acquire);
    BuildTables(V ? *V : HeroVoice());
    PowertrainRecord Initial; Initial.Rpm = float(CurrentRpm);
    Demand.Place(Initial);
}

void AcousticIntegrator::Render(float* Output, uint32_t FrameCount) noexcept
{
    const EngineVoice* Wanted = PendingVoice.load(std::memory_order_acquire);
    if (Wanted && Wanted != ActiveVoice) BuildTables(*Wanted);
    if (!ActiveVoice) BuildTables(HeroVoice());
    if (ActiveVoice->Electric) RenderElectric(Output, FrameCount);
    else if (ActiveVoice->CrossPlane) RenderAdditive(Output, FrameCount);
    else RenderPulse(Output, FrameCount);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PULSE MODEL
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::RenderPulse(float* Output, uint32_t FrameCount) noexcept
{
    const EngineVoice& V = *ActiveVoice;
    PowertrainRecord Latest = Demand.Latest();
    Demand.Take(Latest);

    const float Sr = float(Rate);
    const float InvSr = 1.0f / Sr;
    const uint32_t N = CylCount;
    const float CycDeg = 720.0f;

    // per-block demand + derived state
    Load += (ClampF(Latest.Throttle, 0.0f, 1.0f) - Load) * (1.0f - std::exp(-float(FrameCount) * InvSr / 0.03f));
    const float LoadNow = Load;
    const float RpmB = float(CurrentRpm);
    const float Rr = ClampF(RpmB / V.RedlineRpm, 0.0f, 1.2f);
    const float IdleF = 1.0f - SmoothF(RpmB, V.IdleRpm + 200.0f, V.IdleRpm + 3000.0f);
    (void)IdleF;

    // lift-off pop trigger (main + patch-1 behaviour; patches ring the car's own collectors)
    if (PrevLoad > 0.55f && LoadNow < 0.2f && RpmB > V.RedlineRpm * 0.4f && SincePop > Rate / 4u)
    {
        SpawnPop((1.6f + 2.4f * Random()) * (0.4f + V.Pop), 3.0f + 4.0f * Random(), Random() < 0.5f ? 0u : std::min(1u, GroupCount - 1u));
        SincePop = 0u;
    }
    PrevLoad = LoadNow;

    // exhaust heat → formant drift (retune coefficients only; resonator state survives)
    Heat += (ClampF(0.15f + 0.85f * LoadNow, 0.0f, 1.0f) - Heat) * (1.0f - std::exp(-float(FrameCount) * InvSr / 2.8f));
    const float HeatMul = 1.0f + V.FormantHeat * 0.11f * Heat;
    const uint32_t JF = std::min(MaxFormants, std::max(1u, V.FormantCount));
    for (uint32_t J = 0u; J < JF; ++J)
    {
        FormantA[J].Set(V.Formants[J].Hz * HeatMul * (1.0f - 0.5f * V.Detune), V.Formants[J].Q, Sr);
        FormantB[J].Set(V.Formants[J].Hz * HeatMul * (1.0f + 0.5f * V.Detune), V.Formants[J].Q, Sr);
    }

    // pulse geometry
    const float W = (V.BlowLow + (V.BlowHigh - V.BlowLow) * SmoothF(Rr, 0.08f, 0.95f));
    const float Dec = V.Decay;
    const float Rd = ClampF(V.Round + 0.5f * SmoothF(Rr, 0.3f, 0.92f) - 0.12f * (1.0f - LoadNow) * (1.0f - Rr), 0.0f, 0.85f);
    const float RareG = ClampF(V.Rare, 0.0f, 0.6f);
    const float Fc = (V.FcLow + (V.FcHigh - V.FcLow) * std::pow(LoadNow, 0.8f)) * (1.0f + 0.18f * V.FormantHeat * Heat) * (0.8f + 0.3f * Rr);
    MufflerA.Set(Fc, 0.75f, Sr); MufflerB.Set(Fc * 0.94f, 0.75f, Sr);

    // order layer (capped peak — the anti-F1 control)
    const float PeakOrder = 1.0f + Rr * (std::max(1.4f, V.OrderPeak) - 1.0f);
    float OrdAmp[MaxOrders] = {};
    const uint32_t NOrd = std::min(MaxOrders, std::max(1u, V.OrderCount));
    for (uint32_t K = 0u; K < NOrd; ++K)
    {
        const float Dist = std::fabs(float(K + 1u) - PeakOrder);
        OrdAmp[K] = V.Orders[K] * (1.0f + 1.15f * std::max(0.0f, 1.0f - Dist / 2.6f)) * (1.0f + 0.5f * LoadNow * float(K) / float(std::max(1u, NOrd)));
    }
    const float OrdG = V.OrderGain * (0.3f + 0.7f * LoadNow);
    const float AmG = V.RaspAM * std::max(0.0f, Rr - 0.14f) * LoadNow * 1.5f;
    const float CrG = V.Crackle * (0.3f + 0.7f * LoadNow) * (0.45f + 0.75f * Rr);
    const float RaspG = V.Rasp * 5.0f * (0.35f + 0.65f * LoadNow) * (0.5f + 0.8f * Rr);
    const float BodyG = V.Body * (0.6f + 0.4f * LoadNow);
    const float KBody = 1.0f - std::exp(-float(TwoPi) * V.BodyHz * InvSr);
    const float Km = 1.0f - std::exp(-InvSr / 0.06f);
    const float KdC = 1.0f - std::exp(-float(TwoPi) * 2600.0f * InvSr);
    const float Tb = ClampF(V.Turbo * (0.35f + 0.65f * ClampF(Latest.Boost > 0.0f ? Latest.Boost : BoostState, 0.0f, 1.0f)), 0.0f, 0.9f);
    BoostState += ((Latest.Throttle > 0.3f ? 1.0f : 0.0f) - BoostState) * 0.002f;
    const float Kt = 1.0f - std::exp(-float(TwoPi) * std::max(200.0f, V.TurboHz) * InvSr);
    const float GPipe = ClampF(V.PipeFb, -0.86f, 0.86f);
    const bool PipeOn = V.PipeMs > 0.0f && std::fabs(GPipe) > 0.01f;
    const float KdP = 1.0f - std::exp(-float(TwoPi) * std::min(V.PipeDamp, Sr * 0.4f) * InvSr);
    const float KdS = 1.0f - std::exp(-float(TwoPi) * 1500.0f * InvSr);
    const float CamG = V.CamG * 3.0f * (0.35f + 0.65f * LoadNow) * (0.6f + 0.5f * Rr);
    const float VolT = (0.34f + 0.66f * std::pow(ClampF(RpmB / V.RedlineRpm, 0.0f, 1.15f), 0.75f)) * (0.5f + 0.5f * LoadNow);
    const double TargetRpm = double(std::max(V.IdleRpm, Latest.Rpm));
    float Spooled = Spool;
    Spooled += ((V.Boosted && LoadNow > 0.2f && RpmB > 1200.0f ? 1.0f : 0.0f) - Spooled) * (1.0f - std::exp(-float(FrameCount) * InvSr / 0.45f));
    Spool = Spooled;

    for (uint32_t FI = 0u; FI < FrameCount; ++FI)
    {
        ++SincePop;
        // rev limiter: bounce just past redline
        if (CutTimer > 0u) --CutTimer;
        else if (CurrentRpm > double(V.RedlineRpm) * 1.0 && LoadNow > 0.02f) CutTimer = Rate / 16u;
        const bool Cutting = CutTimer > 0u;
        CutGain += ((Cutting ? 0.55f : 1.0f) - CutGain) * (Cutting ? 0.05f : 0.01f);

        // per-sample rpm slew (rate-limited → block-size invariant)
        {
            const double MaxStep = 50000.0 * double(InvSr);
            const double Diff = TargetRpm - CurrentRpm;
            CurrentRpm += Diff > MaxStep ? MaxStep : (Diff < -MaxStep ? -MaxStep : Diff);
        }
        const float RpmNow = float(CurrentRpm);
        Cycle += double(RpmNow) / 60.0 / 2.0 * double(Tau) * double(InvSr);
        if (Cycle >= 1.0) Cycle -= 1.0;
        TimeSeconds += double(InvSr);

        float EG[MaxGroups] = {};
        float EI = 0.0f;
        float CamHitA = 0.0f, CamHitB = 0.0f;

        for (uint32_t I = 0u; I < N; ++I)
        {
            float D = float(Cycle - double(BaseEx[I])); D -= std::floor(D);
            const float ShEx = std::min(120.0f, RunnerSec[I] * RpmNow * 6.0f);
            const float ShIn = std::min(120.0f, IntakeSec[I] * RpmNow * 6.0f);
            if (D < LastEx[I])
            {
                NewExhaustEvent(I);
                if (BankOf[I]) CamHitB += AmpStatic[I]; else CamHitA += AmpStatic[I];
            }
            LastEx[I] = D;
            const float A = AmpEvent[I];
            const float Deg = D * CycDeg - ShEx - JitEvent[I];
            const float Wc = W * DurEvent[I];
            if (A > 0.0f)
            {
                float Ex = 0.0f;
                if (Deg >= 0.0f && Deg < Wc)
                {
                    const float U = Deg / Wc;
                    float Sh = std::pow(1.0f - U, Dec * DecEvent[I]);
                    float AD = 6.0f * RpmNow * V.Attack * AtkM[I] / (0.6f + 0.4f * A);
                    AD = ClampF(AD, 0.6f, Wc * 0.5f);
                    if (Deg < AD) { const float Q = Deg / AD; Sh *= Q * Q * (3.0f - 2.0f * Q); }
                    if (Rd > 0.0f) { const float Sn = std::sin(float(Pi) * U); Sh = (1.0f - Rd) * Sh + Rd * 0.6f * Sn * Sn; }
                    if (RareG > 0.001f && U > 0.3f)
                    {
                        const float Su = (U - 0.3f) / 0.62f;
                        if (Su < 1.0f) { const float Ss = std::sin(float(Pi) * Su); Sh -= RareG * Ss * Ss * (0.4f + 0.6f * (1.0f - U)); }
                    }
                    Ex += A * Sh;
                }
                // reflected suction wave (tuned-header tone)
                {
                    const float Dr = Deg - 2.0f * ShEx - Wc * 0.35f;
                    const float Wr2 = Wc * 1.5f;
                    if (Dr >= 0.0f && Dr < Wr2) { const float Ur = std::sin(float(Pi) * Dr / Wr2); Ex -= V.ReflG * (0.6f + 0.4f * LoadNow) * A * Ur * Ur; }
                }
                EG[Route[I]] += Ex;
            }
            // intake (own runner delay into the shared plenum)
            float D2 = float(Cycle - double(BaseIn[I])); D2 -= std::floor(D2);
            if (D2 < LastIn[I]) { AmpIntake[I] = ClampF(AmpStatic[I] * (1.0f + 0.5f * Gauss()), 0.2f, 2.0f); if (BankOf[I]) CamHitB += AmpStatic[I] * 0.6f; else CamHitA += AmpStatic[I] * 0.6f; }
            LastIn[I] = D2;
            const float Dg2 = D2 * CycDeg - ShIn;
            if (Dg2 >= 0.0f && Dg2 < V.IntakeW) EI += AmpIntake[I] * std::sin(float(Pi) * Dg2 / V.IntakeW);
        }

        // pops ring the collectors
        for (Pop& P : Pops)
        {
            if (!P.Active) continue;
            P.Age += InvSr;
            if (P.Age >= P.Width) { P.Active = false; continue; }
            const float Uu = P.Age / P.Width;
            float At = P.Age < 0.0004f ? P.Age / 0.0004f : 1.0f;
            At = At * At * (3.0f - 2.0f * At);
            EG[std::min(P.Group, GroupCount - 1u)] += P.Amp * At * (1.0f - Uu) * (1.0f - Uu);
        }

        // collectors: DC-block, turbine soak, saturating reflection
        float Xa = 0.0f, Xb = 0.0f, EA = 0.0f, EB = 0.0f;
        for (uint32_t G = 0u; G < GroupCount; ++G)
        {
            const float Eg = EG[G];
            GroupDc[G] += (Eg - GroupDc[G]) * Km;
            float Xg = Eg - GroupDc[G];
            if (Tb > 0.001f) { GroupTurbLp[G] += (Xg - GroupTurbLp[G]) * Kt; Xg = Xg * (1.0f - Tb) + GroupTurbLp[G] * Tb; }
            if (V.CollFb > 0.001f)
            {
                const float Gd = GroupBuf[G][(WritePos - GroupDelay[G]) & DelayMask];
                GroupLag[G] += (Gd - GroupLag[G]) * KdC;
                Xg += ClampF(V.CollFb, 0.0f, 0.8f) * Sat(GroupLag[G]);
                GroupBuf[G][WritePos] = Xg;
            }
            if (GroupBank[G]) { Xb += Xg; EB += Eg; } else { Xa += Xg; EA += Eg; }
        }

        // crank torsion: firings surge the crank, compressions sag it
        Torsion += ((EA + EB) - Torsion) * (1.0f - std::exp(-InvSr / 0.012f));
        TorsionDc += (Torsion - TorsionDc) * (1.0f - std::exp(-InvSr / 0.3f));
        const float Tqz = ClampF(Torsion - TorsionDc, -2.5f, 2.5f);
        const float TorsAmt = V.Tors * (1.0f - 0.78f * Rr) * (0.35f + 0.65f * LoadNow);
        Tau += (1.0f + TorsAmt * Tqz - Tau) * 0.45f;

        DcI += (EI - DcI) * Km;
        const float Xi = EI - DcI;
        const float GtA = ClampF(EA, 0.0f, 1.3f), GtB = ClampF(EB, 0.0f, 1.3f);
        if (RaspG > 0.002f)
        {
            Xa += RaspG * 0.2f * RaspA.Process(Random() * 2.0f - 1.0f) * GtA * GtA;
            Xb += RaspG * 0.2f * RaspB.Process(Random() * 2.0f - 1.0f) * GtB * GtB;
        }
        // per-firing stochastic crackle
        if (CrG > 0.002f)
        {
            const float ConA = EA - PrevEA; if (ConA > 0.22f && CrG * ConA > CrackleLevelA) { CrackleLevelA = CrG * (0.5f + Random()); CrackleDecayA = 26.0f + 55.0f * Random(); }
            const float ConB = EB - PrevEB; if (ConB > 0.22f && CrG * ConB > CrackleLevelB) { CrackleLevelB = CrG * (0.5f + Random()); CrackleDecayB = 26.0f + 55.0f * Random(); }
            if (CrackleLevelA > 0.003f) { Xa += 0.55f * CrackleA.Process(Random() * 2.0f - 1.0f) * CrackleLevelA; CrackleLevelA *= std::exp(-CrackleDecayA * InvSr); }
            if (CrackleLevelB > 0.003f) { Xb += 0.55f * CrackleB.Process(Random() * 2.0f - 1.0f) * CrackleLevelB; CrackleLevelB *= std::exp(-CrackleDecayB * InvSr); }
        }
        // scavenge echo
        {
            const float Sd = ScavBuf[(WritePos - ScavDelay) & DelayMask];
            ScavLag += (Sd - ScavLag) * KdS;
            Xa += 0.14f * ScavLag; Xb += 0.14f * ScavLag;
            ScavBuf[WritePos] = (Xa + Xb) * 0.5f;
        }
        // block / slap / cam / injector / chain tonal layers
        Xa += 0.22f * (0.5f + 0.5f * LoadNow) * BlockA.Process(Xa);
        Xb += 0.22f * (0.5f + 0.5f * LoadNow) * BlockB.Process(Xb);
        {
            const float SlA = std::max(0.0f, EA - PrevEA), SlB = std::max(0.0f, EB - PrevEB);
            Xa += 0.10f * SlapA.Process(SlA); Xb += 0.10f * SlapB.Process(SlB);
        }
        if (CamG > 0.001f) { Xa += CamG * 0.33f * CamA.Process(CamHitA); Xb += CamG * 0.33f * CamB.Process(CamHitB); }
        {
            const float OnA = std::max(0.0f, EA - PrevEA), OnB = std::max(0.0f, EB - PrevEB);
            Xa += 0.5f * InjA.Process(OnA); Xb += 0.5f * InjB.Process(OnB);
        }
        Xa += 0.10f * ChainA.Process(Xa); Xb += 0.10f * ChainB.Process(Xb);
        // tailpipe reflection
        {
            const float Td = TailBuf[(WritePos - TailDelay) & DelayMask];
            TailLag += (Td - TailLag) * KdS;
            Xa += 0.12f * TailLag; Xb += 0.12f * TailLag;
            TailBuf[WritePos] = (Xa + Xb) * 0.5f;
        }
        PrevEA = EA; PrevEB = EB;

        // body thump + formants
        LowA += (Xa - LowA) * KBody; LowB += (Xb - LowB) * KBody;
        float Ya = V.Direct * Xa + BodyG * LowA;
        float Yb = V.Direct * Xb + BodyG * LowB;
        for (uint32_t J = 0u; J < JF; ++J)
        {
            const float Fg = V.Formants[J].Gain * (0.45f + 0.55f * LoadNow);
            Ya += Fg * FormantA[J].Process(Xa);
            Yb += Fg * FormantB[J].Process(Xb);
        }
        // order layer + AM rasp, gated by the pulse train
        {
            const float GateT = ClampF((EA + EB) * 0.7f, 0.0f, 1.25f);
            OrderGate += (GateT - OrderGate) * 0.22f;
            if (OrdG > 0.002f && OrderGate > 0.004f)
            {
                const double PhF = Cycle * double(N);
                float OSum = 0.0f;
                for (uint32_t K = 0u; K < NOrd; ++K) OSum += OrdAmp[K] * float(std::sin(TwoPi * double(K + 1u) * PhF));
                const float OOut = OrdG * OrderGate * OSum * 0.16f;
                Ya += OOut; Yb += OOut;
            }
            if (AmG > 0.002f)
            {
                const double PhF = Cycle * double(N);
                const float AmC = float(std::sin(TwoPi * 3.0 * PhF) * std::sin(TwoPi * 0.5 * PhF));
                Ya += AmG * AmC * GtA * 0.35f;
                Yb += AmG * AmC * GtB * 0.35f;
            }
        }
        // bank pipes
        if (PipeOn)
        {
            const float PdA = PipeA[(WritePos - PipeDelayA) & DelayMask];
            PipeLagA += (PdA - PipeLagA) * KdP; Ya += GPipe * Sat(PipeLagA); PipeA[WritePos] = Ya;
            const float PdB = PipeB[(WritePos - PipeDelayB) & DelayMask];
            PipeLagB += (PdB - PipeLagB) * KdP; Yb += GPipe * Sat(PipeLagB); PipeB[WritePos] = Yb;
        }
        Ya = MufflerA.Process(Ya); Yb = MufflerB.Process(Yb);

        // intake roar
        float InL = 0.0f, InR = 0.0f;
        const uint32_t KI = std::min(MaxIntake, std::max(1u, V.IntakeCount));
        for (uint32_t J = 0u; J < KI; ++J)
        {
            const float G = V.Intake[J].Gain * V.IntakeGain;
            InL += G * IntakeL[J].Process(Xi);
            InR += G * IntakeR[J].Process(Xi);
        }
        const float GIn = (0.15f + 0.85f * std::pow(LoadNow, 1.3f));
        const float ExL = (BankPanL[0] * Ya + (N > 1u ? BankPanL[1] : 0.0f) * Yb);
        const float ExR = (BankPanR[0] * Ya + (N > 1u ? BankPanR[1] : 0.0f) * Yb);
        // stereo from the two banks: bank A leans left, bank B right (web panL/panR)
        const float MixL = Ya * 1.0f + Yb * (V.Banks == 2u ? 0.5f * V.BankGain : 0.8f);
        const float MixR = Ya * (V.Banks == 2u ? 0.5f : 0.8f) + Yb * (V.Banks == 2u ? 1.0f * V.BankGain : 0.8f);
        (void)ExL; (void)ExR;

        // partial loudness normaliser (v3: exponent 0.19, not 0.5)
        const float Rl = MixL + InL, Rrr = MixR + InR;
        const float Raw = 0.5f * (Rl * Rl + Rrr * Rrr);
        PowerNorm += (Raw - PowerNorm) * (Raw > PowerNorm ? 0.01f : 0.002f);
        const float Ag = ClampF(V.Level * 1.9f / std::pow(PowerNorm + 1e-9f, 0.19f), 0.0f, 30.0f);
        Volume += (VolT - Volume) * 0.002f;
        const float Gg = Ag * Volume * CutGain;

        // turbo spool whistle layer
        float Layer = 0.0f;
        if (V.Boosted && V.SpoolG > 0.0f)
        {
            const float Tf = 650.0f + Spool * V.SpoolHz;
            TurboPhase1 += float(TwoPi) * Tf * InvSr; if (TurboPhase1 > float(TwoPi)) TurboPhase1 -= float(TwoPi);
            TurboPhase2 += float(TwoPi) * Tf * 1.0123f * InvSr; if (TurboPhase2 > float(TwoPi)) TurboPhase2 -= float(TwoPi);
            const float Ta = V.SpoolG * (0.002f + 0.105f * std::pow(Spool, 1.8f));
            Layer += Ta * (std::sin(TurboPhase1) + 0.45f * std::sin(TurboPhase2) + 0.22f * std::sin(TurboPhase1 * 2.0f));
        }
        const float OutL = (MixL * (0.6f + 0.4f * LoadNow) + InL * GIn) * Gg + Layer;
        const float OutR = (MixR * (0.6f + 0.4f * LoadNow) + InR * GIn) * Gg + Layer;
        // cabin boom, then the web master's soft saturation (keeps peaks musical, never hard-clipped)
        const float CabL = std::tanh(OutL + V.CabG * CabA.Process(OutL));
        const float CabR = std::tanh(OutR + V.CabG * CabB.Process(OutR));

        float* Frame = Output + size_t(FI) * Channels;
        Frame[0] += CabL;
        if (Channels > 1u) Frame[1] += CabR;
        for (uint32_t C = 2u; C < Channels; ++C) Frame[C] += (CabL + CabR) * 0.5f;
        WritePos = (WritePos + 1u) & DelayMask;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ADDITIVE MODEL (cross-plane V8)
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::RenderAdditive(float* Output, uint32_t FrameCount) noexcept
{
    const EngineVoice& V = *ActiveVoice;
    PowertrainRecord Latest = Demand.Latest();
    Demand.Take(Latest);
    const float Sr = float(Rate);
    const float InvSr = 1.0f / Sr;
    const uint32_t N = CylCount;
    Load += (ClampF(Latest.Throttle, 0.0f, 1.0f) - Load) * (1.0f - std::exp(-float(FrameCount) * InvSr / 0.03f));
    const float LoadNow = Load;
    const float RpmB = float(CurrentRpm);
    const float Rr = ClampF(RpmB / V.RedlineRpm, 0.0f, 1.2f);
    const double Nu = std::max(0.8, double(RpmB) / 60.0 / 2.0);   // cycles/s (4-stroke)
    const float Fc = V.FcLow + (V.FcHigh - V.FcLow) * std::pow(LoadNow, 0.8f);
    uint32_t KMax = uint32_t(std::min(double(MaxHarmonics), std::floor(8000.0 / Nu)));
    if (KMax < 6u) KMax = 6u;

    // harmonic shape (per block, web updateCoefs twin)
    float Shape[MaxHarmonics + 2] = {};
    float SMax = 0.0f;
    const float Half = float(N) * 0.5f;
    for (uint32_t K = 1u; K <= KMax; ++K)
    {
        const float F = float(K) * float(Nu);
        const float Kk = float(K) < Half ? Half : float(K);
        float S = std::pow(float(N) / Kk, V.Alpha + 0.32f * (1.0f - LoadNow));
        const float R4 = (F / Fc) * (F / Fc);
        S *= 1.0f / std::sqrt(1.0f + R4 * R4);
        float G = 1.0f;
        const uint32_t NR = std::min(4u, V.AddResCount);
        for (uint32_t J = 0u; J < NR; ++J)
        {
            const float D = (std::log(F) - std::log(V.AddRes[J].Hz)) / std::max(0.05f, V.AddRes[J].Q);
            G += V.AddRes[J].Gain * std::exp(-0.5f * D * D);
        }
        Shape[K] = S * G;
        if (Shape[K] > SMax) SMax = Shape[K];
    }
    uint32_t KEff = KMax;
    while (KEff > 6u && Shape[KEff] < SMax * 0.006f) --KEff;

    float AL[MaxHarmonics + 2] = {}, BL[MaxHarmonics + 2] = {}, AR[MaxHarmonics + 2] = {}, BR[MaxHarmonics + 2] = {};
    const float LopeAmt = V.Lope * (1.0f - SmoothF(RpmB, V.IdleRpm + 300.0f, V.IdleRpm + 3800.0f) * 0.85f);
    for (uint32_t I = 0u; I < N; ++I)
    {
        const uint32_t B = BankOf[I];
        float Gc = CylGain[I] * (B ? V.BankGain : 1.0f);
        Gc *= 1.0f + LopeAmt * float(std::sin(TwoPi * (0.31 + 0.137 * double(I)) * TimeSeconds + 1.9 * double(I)));
        const double TauB = B ? 0.0003 : 0.0;   // bank header delay (cross-plane signature)
        const double Psi = TwoPi * (double(Frac[I]) + Nu * TauB);
        const double Cr = std::cos(Psi), Sn = std::sin(Psi);
        double Ck = Cr, Sk = Sn;
        const float WL = B ? 0.5f : 1.0f, WR = B ? 1.0f : 0.5f;
        for (uint32_t K = 1u; K <= KEff; ++K)
        {
            const float W = Gc * Shape[K];
            AL[K] += WL * W * float(Ck); BL[K] += WL * W * float(Sk);
            AR[K] += WR * W * float(Ck); BR[K] += WR * W * float(Sk);
            const double Nc = Ck * Cr - Sk * Sn; Sk = Sk * Cr + Ck * Sn; Ck = Nc;
        }
    }
    double Pw = 0.0;
    for (uint32_t K = 1u; K <= KEff; ++K) Pw += double(AL[K] * AL[K] + BL[K] * BL[K] + AR[K] * AR[K] + BR[K] * BR[K]);
    const float Norm = float(0.3 / std::max(1e-5, std::sqrt(Pw * 0.25)));
    for (uint32_t K = 1u; K <= KEff; ++K) { AL[K] *= Norm; BL[K] *= Norm; AR[K] *= Norm; BR[K] *= Norm; }

    const float VolT = (0.34f + 0.66f * std::pow(Rr, 0.75f)) * (0.5f + 0.5f * LoadNow);
    const double TargetRpm = double(std::max(V.IdleRpm, Latest.Rpm));
    const float CamG = V.CamG * 1.1f * (0.35f + 0.65f * LoadNow) * (0.6f + 0.5f * Rr);

    for (uint32_t FI = 0u; FI < FrameCount; ++FI)
    {
        if (CutTimer > 0u) --CutTimer;
        else if (CurrentRpm > double(V.RedlineRpm) * 1.0 && LoadNow > 0.02f) CutTimer = Rate / 16u;
        const bool Cutting = CutTimer > 0u;
        CutGain += ((Cutting ? 0.4f : 1.0f) - CutGain) * (Cutting ? 0.012f : 0.004f);
        {
            const double MaxStep = 50000.0 * double(InvSr);
            const double Diff = TargetRpm - CurrentRpm;
            CurrentRpm += Diff > MaxStep ? MaxStep : (Diff < -MaxStep ? -MaxStep : Diff);
        }
        const double NuS = double(float(CurrentRpm)) / 60.0 / 2.0;
        const double PrevTheta = Theta;
        Theta += TwoPi * NuS * double(InvSr);
        if (Theta > TwoPi) Theta -= TwoPi;
        TimeSeconds += double(InvSr);

        // valve-event cam ring at the real firing phases
        float CamHitA = 0.0f, CamHitB = 0.0f;
        if (CamG > 0.001f)
        {
            for (uint32_t I = 0u; I < N; ++I)
            {
                const double Ev = double(Frac[I]) * TwoPi;
                const bool Hit = (PrevTheta < Ev && Theta >= Ev) || (Theta < PrevTheta && (Ev >= PrevTheta || Ev < Theta));
                if (Hit) { if (BankOf[I]) CamHitB += CylGain[I]; else CamHitA += CylGain[I]; EventCount.fetch_add(1u, std::memory_order_relaxed); }
            }
        }
        const double C1 = std::cos(Theta), S1 = std::sin(Theta);
        const double TwoC = 2.0 * C1;
        double CPrev = 1.0, CCur = C1, SPrev = 0.0, SCur = S1;
        float AccL = 0.0f, AccR = 0.0f;
        for (uint32_t K = 1u; K <= KEff; ++K)
        {
            AccL += AL[K] * float(CCur) + BL[K] * float(SCur);
            AccR += AR[K] * float(CCur) + BR[K] * float(SCur);
            const double CN = TwoC * CCur - CPrev;
            const double SN = TwoC * SCur - SPrev;
            CPrev = CCur; CCur = CN; SPrev = SCur; SCur = SN;
        }
        if (CamG > 0.001f)
        {
            AccL += CamG * 0.3f * CamA.Process(CamHitA);
            AccR += CamG * 0.3f * CamB.Process(CamHitB);
        }
        // charger whine (Demon) + generic ancillary tone
        float Layer = 0.0f;
        if (V.Charger > 0.0f)
        {
            const float ChF = ClampF(float(CurrentRpm) / 60.0f * V.ChargerRatio, 40.0f, Sr * 0.4f);
            ChargerPhase += float(TwoPi) * ChF * InvSr; if (ChargerPhase > float(TwoPi)) ChargerPhase -= float(TwoPi);
            const float Raw = std::sin(ChargerPhase) + 0.5f * std::sin(ChargerPhase * 2.0f) + 0.3f * std::sin(ChargerPhase * 2.98f);
            Layer += V.Charger * 0.055f * (0.2f + 0.8f * LoadNow) * (Raw / (1.0f + std::fabs(Raw) * 0.8f));
        }
        if (V.Boosted && V.SpoolG > 0.0f)
        {
            Spool += ((LoadNow > 0.2f && CurrentRpm > 1200.0 ? 1.0f : 0.0f) - Spool) * 0.001f;
            const float Tf = 650.0f + Spool * V.SpoolHz;
            TurboPhase1 += float(TwoPi) * Tf * InvSr; if (TurboPhase1 > float(TwoPi)) TurboPhase1 -= float(TwoPi);
            Layer += V.SpoolG * (0.002f + 0.105f * std::pow(Spool, 1.8f)) * std::sin(TurboPhase1);
        }
        Volume += (VolT - Volume) * 0.002f;
        const float G = Volume * CutGain;
        const float OutL = AccL * G + Layer;
        const float OutR = AccR * G + Layer;
        const float CabL = std::tanh(OutL + V.CabG * CabA.Process(OutL));
        const float CabR = std::tanh(OutR + V.CabG * CabB.Process(OutR));
        float* Frame = Output + size_t(FI) * Channels;
        Frame[0] += CabL;
        if (Channels > 1u) Frame[1] += CabR;
        for (uint32_t C = 2u; C < Channels; ++C) Frame[C] += (CabL + CabR) * 0.5f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ELECTRIC MODEL
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::RenderElectric(float* Output, uint32_t FrameCount) noexcept
{
    const EngineVoice& V = *ActiveVoice;
    PowertrainRecord Latest = Demand.Latest();
    Demand.Take(Latest);
    const float InvSr = 1.0f / float(Rate);
    Load += (ClampF(Latest.Throttle, 0.0f, 1.0f) - Load) * (1.0f - std::exp(-float(FrameCount) * InvSr / 0.03f));
    const float Act = std::fabs(Load);
    const double TargetRpm = double(Latest.Rpm);

    for (uint32_t FI = 0u; FI < FrameCount; ++FI)
    {
        {
            const double MaxStep = 50000.0 * double(InvSr);
            const double Diff = TargetRpm - CurrentRpm;
            CurrentRpm += Diff > MaxStep ? MaxStep : (Diff < -MaxStep ? -MaxStep : Diff);
        }
        const float Ratio = ClampF(float(CurrentRpm) / std::max(1000.0f, V.RedlineRpm), 0.0f, 1.1f);
        const float F1 = 28.0f + Ratio * 640.0f;
        const float F2 = 90.0f + Ratio * 1480.0f;
        const float F3 = std::min(float(CurrentRpm) * 0.11f, 9000.0f);
        EvPhase1 += float(TwoPi) * F1 * InvSr; if (EvPhase1 > float(TwoPi)) EvPhase1 -= float(TwoPi);
        EvPhase2 += float(TwoPi) * F2 * InvSr; if (EvPhase2 > float(TwoPi)) EvPhase2 -= float(TwoPi);
        EvPhase3 += float(TwoPi) * F3 * InvSr; if (EvPhase3 > float(TwoPi)) EvPhase3 -= float(TwoPi);
        const float Target = (0.1f + 0.5f * Act) * (0.35f + 0.65f * Ratio + 0.25f * Act);
        Volume += (Target - Volume) * 0.004f;
        float Out = (std::sin(EvPhase1) + 0.55f * std::sin(EvPhase2) + 0.3f * std::sin(EvPhase2 * 1.5f)) * 0.55f
                  + std::sin(EvPhase3) * 0.4f * Ratio + std::sin(EvPhase1 * 0.25f) * 0.35f * Act;
        Out = Out / (1.0f + std::fabs(Out) * 0.7f);
        const float Mono = Out * Volume * 0.5f;
        float* Frame = Output + size_t(FI) * Channels;
        for (uint32_t C = 0u; C < Channels; ++C) Frame[C] += Mono;
        TimeSeconds += double(InvSr);
    }
}

} // namespace Frontier
