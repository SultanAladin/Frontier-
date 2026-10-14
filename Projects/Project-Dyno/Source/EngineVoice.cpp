//============================================================================================================================================
//                                                        ENGINEVOICE.CPP
//============================================================================================================================================
// 🧩 The v3 garage: 17 voices. Numbers are the native twin of Projects/Project-Dyno/Web/src/sim/voices.ts
//    (post ROUTING/WAVE/DETAIL2/SIGNATURE/HYBRID composition) + cars.ts for catalogue data — keep them in step.
//    Only fields EngineVoice carries are set; the web model's extra layers (block/injector/chain/tail detail)
//    survive there as reference and are folded into Rasp/CamG here.

#include "EngineVoice.h"

#include <cstring>
#include <initializer_list>

namespace Frontier {

namespace {

VoiceFormant F(float Hz, float Gain, float Q) noexcept { return VoiceFormant{ Hz, Gain, Q }; }

// Base voice with the web DEFAULT_VOICE already folded in; each car overrides what makes it itself.
EngineVoice Base(const char* Id, const char* Name, const char* Tag, uint32_t Cyl, uint32_t Banks,
                 float Idle, float Redline) noexcept
{
    EngineVoice V;
    V.Id = Id; V.Name = Name; V.Tag = Tag;
    V.Cylinders = Cyl; V.Banks = Banks; V.IdleRpm = Idle; V.RedlineRpm = Redline;
    V.Formants[0] = F(120, 1.8f, 4.0f); V.Formants[1] = F(400, 1.6f, 4.5f);
    V.Formants[2] = F(1000, 2.0f, 5.0f); V.Formants[3] = F(2300, 2.2f, 5.0f);
    V.FormantCount = 4u;
    V.Intake[0] = F(320, 1.5f, 3.5f); V.IntakeCount = 1u;
    V.Orders[0] = 1.0f; V.Orders[1] = 0.8f; V.Orders[2] = 0.5f;
    V.Orders[3] = 0.35f; V.Orders[4] = 0.22f; V.Orders[5] = 0.14f; V.OrderCount = 6u;
    V.AddRes[0] = F(100, 1.2f, 0.25f); V.AddRes[1] = F(300, 0.9f, 0.28f);
    V.AddRes[2] = F(900, 0.9f, 0.3f); V.AddResCount = 3u;
    return V;
}

void Hybrid(EngineVoice& V, float Rare, float RaspAM, float OrderGain, float OrderPeak,
            float Crackle, float CrackleHz, float Heat, std::initializer_list<float> Orders) noexcept
{
    V.Rare = Rare; V.RaspAM = RaspAM; V.OrderGain = OrderGain; V.OrderPeak = OrderPeak;
    V.Crackle = Crackle; V.CrackleHz = CrackleHz; V.FormantHeat = Heat;
    V.OrderCount = 0u;
    for (float O : Orders) { if (V.OrderCount < 8u) V.Orders[V.OrderCount++] = O; }
}

const EngineVoice* BuildGarage(uint32_t* Count) noexcept
{
    static EngineVoice Garage[18];
    static bool Built = false;
    if (Built) { if (Count) *Count = 18u; return Garage; }
    Built = true;
    uint32_t I = 0u;
    auto Add = [&]() -> EngineVoice& { return Garage[I++]; };

    {   // Nissan GT-R NISMO — twin-turbo V6, deep brawl (the patch-1 reference voice)
        EngineVoice& V = Add(); V = Base("gtr-nismo", "Nissan GT-R NISMO", "Twin-turbo V6 - deep brawl", 6u, 2u, 800.0f, 7100.0f);
        V.Boosted = true; V.BlowLow = 115; V.BlowHigh = 90; V.Decay = 2.4f; V.Attack = 0.0007f;
        V.FcLow = 650; V.FcHigh = 3000; V.Body = 1.4f; V.BodyHz = 120;
        V.Formants[0] = F(80, 2.4f, 4); V.Formants[1] = F(165, 2.0f, 4); V.Formants[2] = F(330, 1.6f, 4);
        V.Formants[3] = F(680, 1.2f, 3.5f); V.Formants[4] = F(1400, 1.0f, 3); V.FormantCount = 5u;
        V.Detune = 0.06f; V.BankGain = 0.88f; V.Intake[0] = F(210, 1.4f, 3); V.IntakeGain = 0.3f; V.IntakeW = 190;
        V.Rough = 0.14f; V.Skew = 2.8f; V.Cyc = 0.14f; V.Jit = 1.6f; V.IdleLope = 0.5f;
        V.RunnerMs = 1.5f; V.RunnerSpread = 0.35f; V.ReflG = 0.3f; V.CollMs = 1.8f; V.CollFb = 0.3f;
        V.Turbo = 0.5f; V.TurboHz = 1400; V.Tors = 0.055f; V.CamHz = 2350; V.CamQ = 4.6f; V.CamG = 0.78f;
        V.CabHz = 76; V.CabG = 0.30f; V.SpoolHz = 5400; V.SpoolG = 1.12f; V.Pop = 0.45f;
        Hybrid(V, 0.24f, 0.20f, 0.38f, 4.0f, 0.30f, 4200, 0.7f, { 1.0f, 0.6f, 0.9f, 0.7f, 0.4f, 0.3f });
    }
    {   // Porsche 918 Spyder — flat-plane V8 hybrid, clean hard scream
        EngineVoice& V = Add(); V = Base("918", "Porsche 918 Spyder", "Flat-plane V8 - clean hybrid scream", 8u, 2u, 900.0f, 9150.0f);
        V.BlowLow = 108; V.BlowHigh = 78; V.Decay = 2.6f; V.Attack = 0.0006f; V.Round = 0.1f;
        V.FcLow = 850; V.FcHigh = 4600; V.Body = 0.95f; V.BodyHz = 125;
        V.Formants[0] = F(110, 2.0f, 3.2f); V.Formants[1] = F(300, 1.8f, 3.4f); V.Formants[2] = F(760, 2.0f, 3.4f);
        V.Formants[3] = F(1700, 1.8f, 3.1f); V.Formants[4] = F(3000, 1.1f, 2.8f); V.FormantCount = 5u;
        V.Detune = 0.04f; V.BankGain = 0.92f; V.PipeMs = 3.4f; V.PipeFb = -0.4f; V.PipeDamp = 3200;
        V.Rasp = 0.32f; V.RaspHz = 2100;
        V.Intake[0] = F(340, 1.8f, 3.2f); V.Intake[1] = F(900, 1.9f, 3.5f); V.IntakeCount = 2u; V.IntakeGain = 0.5f;
        V.Rough = 0.12f; V.Skew = 2.0f; V.Cyc = 0.13f; V.Jit = 1.2f; V.IdleLope = 0.35f; V.Drive = 1.05f; V.Level = 0.27f;
        V.RunnerMs = 0.9f; V.RunnerSpread = 0.16f; V.ReflG = 0.36f; V.CollMs = 1.1f; V.CollFb = 0.22f;
        V.Tors = 0.034f; V.CamHz = 3150; V.CamQ = 5.8f; V.CamG = 0.62f; V.CabHz = 94; V.CabG = 0.34f; V.Pop = 0.25f;
        Hybrid(V, 0.20f, 0.50f, 0.44f, 4.4f, 0.26f, 5000, 0.85f, { 1.0f, 1.4f, 0.6f, 0.8f });
    }
    {   // Ferrari LaFerrari — REBUILT v3 profile (see EngineVoice.h for the full post-mortem)
        EngineVoice& V = Add(); V = Base("laferrari", "Ferrari LaFerrari", "65 deg V12 - hollow bark to glass howl, equal-length 6-into-1 (rebuilt v3)", 12u, 2u, 1000.0f, 9250.0f);
        V.BlowLow = 104; V.BlowHigh = 66; V.Decay = 2.15f; V.Attack = 0.00055f; V.Round = 0.16f;
        V.FcLow = 950; V.FcHigh = 5600; V.Direct = 1.05f; V.Body = 1.05f; V.BodyHz = 118;
        V.Formants[0] = F(132, 1.9f, 3.4f); V.Formants[1] = F(356, 1.9f, 3.6f); V.Formants[2] = F(742, 2.5f, 3.8f);
        V.Formants[3] = F(1480, 2.4f, 3.4f); V.Formants[4] = F(2950, 1.7f, 2.9f); V.Formants[5] = F(4700, 0.8f, 2.4f);
        V.FormantCount = 6u;
        V.Detune = 0.018f; V.BankGain = 0.97f; V.PipeMs = 5.6f; V.PipeFb = -0.42f; V.PipeDamp = 3400;
        V.Rasp = 0.16f; V.RaspHz = 2750;
        V.Intake[0] = F(386, 2.0f, 3.2f); V.Intake[1] = F(864, 2.2f, 3.4f); V.Intake[2] = F(1730, 1.4f, 3.0f);
        V.IntakeCount = 3u; V.IntakeGain = 0.85f; V.IntakeW = 168;
        V.Rough = 0.05f; V.Skew = 0.8f; V.Cyc = 0.06f; V.Jit = 0.5f; V.IdleLope = 0.10f; V.Drive = 0.95f; V.Level = 0.30f;
        V.RunnerMs = 0.75f; V.RunnerSpread = 0.07f; V.ReflG = 0.34f; V.CollMs = 0.9f; V.CollFb = 0.18f;
        V.Tors = 0.022f; V.CamHz = 3400; V.CamQ = 6.0f; V.CamG = 0.52f; V.CabHz = 96; V.CabG = 0.32f; V.Pop = 0.30f;
        Hybrid(V, 0.38f, 0.55f, 0.50f, 3.4f, 0.20f, 5200, 0.9f, { 0.9f, 1.0f, 0.55f, 0.95f, 0.42f, 0.62f, 0.3f, 0.2f });
    }
    {   // Aston Martin Vulcan — track-only 7.0 V12, straight pipes: silk turned savage
        EngineVoice& V = Add(); V = Base("vulcan", "Aston Martin Vulcan", "7.0 V12 - track-only, silk turned savage", 12u, 2u, 1100.0f, 8000.0f);
        V.BlowLow = 100; V.BlowHigh = 62; V.Decay = 2.5f; V.Attack = 0.00048f; V.Round = 0.12f;
        V.FcLow = 1100; V.FcHigh = 6600; V.Direct = 1.1f; V.Body = 0.9f; V.BodyHz = 128;
        V.Formants[0] = F(148, 1.8f, 3.2f); V.Formants[1] = F(412, 2.0f, 3.4f); V.Formants[2] = F(884, 2.5f, 3.6f);
        V.Formants[3] = F(1780, 2.4f, 3.2f); V.Formants[4] = F(3450, 1.6f, 2.8f); V.FormantCount = 5u;
        V.Detune = 0.022f; V.BankGain = 0.96f; V.PipeMs = 4.2f; V.PipeFb = -0.52f; V.PipeDamp = 3800;
        V.Rasp = 0.30f; V.RaspHz = 2900;
        V.Intake[0] = F(408, 2.1f, 3.2f); V.Intake[1] = F(920, 2.3f, 3.4f); V.IntakeCount = 2u; V.IntakeGain = 0.95f; V.IntakeW = 164;
        V.Rough = 0.09f; V.Skew = 1.3f; V.Cyc = 0.09f; V.Jit = 0.8f; V.IdleLope = 0.18f; V.Drive = 1.06f; V.Level = 0.33f;
        V.RunnerMs = 0.7f; V.RunnerSpread = 0.09f; V.ReflG = 0.36f; V.CollMs = 0.85f; V.CollFb = 0.18f;
        V.Tors = 0.024f; V.CamHz = 3350; V.CamQ = 6.0f; V.CamG = 0.55f; V.CabHz = 92; V.CabG = 0.42f; V.Pop = 0.50f;
        Hybrid(V, 0.30f, 0.70f, 0.52f, 3.8f, 0.30f, 5400, 0.9f, { 0.85f, 1.0f, 0.6f, 0.9f, 0.45f, 0.6f, 0.34f, 0.24f });
    }
    {   // Dodge Viper ACR — 8.4 V10 side pipes, the anti-V12: huge lazy pulses, all chest
        EngineVoice& V = Add(); V = Base("viper", "Dodge Viper ACR", "8.4 V10 - side-pipe thump, lazy giant", 10u, 2u, 750.0f, 6200.0f);
        V.BlowLow = 124; V.BlowHigh = 92; V.Decay = 2.1f; V.Attack = 0.0008f; V.Round = 0.2f;
        V.FcLow = 620; V.FcHigh = 3400; V.Direct = 1.1f; V.Body = 1.6f; V.BodyHz = 96;
        V.Formants[0] = F(72, 2.6f, 3.6f); V.Formants[1] = F(148, 2.2f, 3.8f); V.Formants[2] = F(305, 1.8f, 3.8f);
        V.Formants[3] = F(640, 1.4f, 3.4f); V.Formants[4] = F(1250, 1.0f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.09f; V.BankGain = 0.82f; V.PipeMs = 3.8f; V.PipeFb = -0.38f; V.PipeDamp = 2400;
        V.Rasp = 0.22f; V.RaspHz = 1500;
        V.Intake[0] = F(190, 1.6f, 3.0f); V.IntakeGain = 0.45f; V.IntakeW = 188;
        V.Rough = 0.20f; V.Skew = 3.4f; V.Cyc = 0.19f; V.Jit = 2.0f; V.IdleLope = 0.62f; V.Drive = 1.12f; V.Level = 0.31f;
        V.RunnerMs = 1.15f; V.RunnerSpread = 0.24f; V.ReflG = 0.3f; V.CollMs = 1.35f; V.CollFb = 0.26f;
        V.Tors = 0.06f; V.CamHz = 2300; V.CamQ = 4.6f; V.CamG = 0.85f; V.CabHz = 78; V.CabG = 0.38f; V.Pop = 0.50f;
        Hybrid(V, 0.34f, 0.18f, 0.42f, 3.0f, 0.26f, 3800, 0.6f, { 1.0f, 0.9f, 0.4f, 0.7f, 0.3f, 0.5f });
    }
    {   // Dodge Challenger SRT Demon — supercharged cross-plane V8 (additive body + charger whine)
        EngineVoice& V = Add(); V = Base("demon", "Dodge Challenger SRT Demon", "Supercharged cross-plane V8 - blower thunder", 8u, 2u, 800.0f, 6500.0f);
        V.CrossPlane = true;
        V.BlowLow = 122; V.BlowHigh = 92; V.Decay = 2.3f; V.Attack = 0.00065f; V.Round = 0.1f;
        V.FcLow = 700; V.FcHigh = 4200; V.Direct = 1.1f; V.Body = 1.55f; V.BodyHz = 104;
        V.Formants[0] = F(76, 2.6f, 4); V.Formants[1] = F(152, 2.2f, 4); V.Formants[2] = F(318, 1.8f, 4);
        V.Formants[3] = F(760, 1.3f, 3.5f); V.Formants[4] = F(1600, 1.0f, 3); V.FormantCount = 5u;
        V.Detune = 0.07f; V.BankGain = 0.85f; V.PipeMs = 3.4f; V.PipeFb = -0.4f; V.PipeDamp = 2200;
        V.Rasp = 0.24f; V.RaspHz = 1500; V.Intake[0] = F(205, 1.9f, 3); V.IntakeGain = 0.65f; V.IntakeW = 186;
        V.Rough = 0.16f; V.Skew = 3.0f; V.Cyc = 0.16f; V.Jit = 1.8f; V.IdleLope = 0.58f; V.Drive = 1.12f;
        V.RunnerMs = 1.3f; V.RunnerSpread = 0.3f; V.ReflG = 0.3f; V.CollMs = 1.5f; V.CollFb = 0.28f;
        V.Tors = 0.058f; V.CamHz = 2260; V.CamQ = 4.8f; V.CamG = 0.86f; V.CabHz = 80; V.CabG = 0.40f;
        V.Alpha = 1.02f; V.AddRes[0] = F(80, 1.5f, 0.20f); V.AddRes[1] = F(165, 1.2f, 0.22f);
        V.AddRes[2] = F(340, 0.9f, 0.28f); V.AddRes[3] = F(880, 0.95f, 0.30f); V.AddResCount = 4u; V.Lope = 0.13f;
        V.Charger = 1.0f; V.ChargerRatio = 34; V.Pop = 0.65f;
        Hybrid(V, 0.30f, 0.12f, 0.40f, 3.2f, 0.30f, 4000, 0.6f, { 1.0f, 0.8f, 0.6f, 0.5f, 0.3f, 0.2f });
    }
    {   // Koenigsegg Agera RS — flat-plane twin-turbo V8, hard edge through the turbines
        EngineVoice& V = Add(); V = Base("agera", "Koenigsegg Agera RS", "Flat-plane TT V8 - hard edge through the turbines", 8u, 2u, 800.0f, 8250.0f);
        V.Boosted = true;
        V.BlowLow = 110; V.BlowHigh = 80; V.Decay = 2.55f; V.Attack = 0.00058f; V.Round = 0.08f;
        V.FcLow = 800; V.FcHigh = 4400; V.Direct = 1.05f; V.Body = 1.25f; V.BodyHz = 118;
        V.Formants[0] = F(105, 2.2f, 3.5f); V.Formants[1] = F(290, 2.0f, 3.6f); V.Formants[2] = F(690, 2.2f, 3.6f);
        V.Formants[3] = F(1500, 1.9f, 3.3f); V.Formants[4] = F(2700, 1.2f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.05f; V.BankGain = 0.9f; V.PipeMs = 4.0f; V.PipeFb = -0.46f; V.PipeDamp = 3000;
        V.Rasp = 0.34f; V.RaspHz = 1850; V.Intake[0] = F(300, 1.5f, 3); V.IntakeGain = 0.42f; V.IntakeW = 176;
        V.Rough = 0.14f; V.Skew = 2.4f; V.Cyc = 0.15f; V.Jit = 1.5f; V.IdleLope = 0.44f; V.Drive = 1.08f;
        V.RunnerMs = 1.25f; V.RunnerSpread = 0.24f; V.ReflG = 0.28f; V.CollMs = 1.45f; V.CollFb = 0.27f;
        V.Turbo = 0.5f; V.TurboHz = 1650; V.Tors = 0.044f; V.CamHz = 2880; V.CamQ = 5.2f; V.CamG = 0.68f;
        V.CabHz = 90; V.CabG = 0.36f; V.SpoolHz = 7000; V.SpoolG = 1.18f; V.Pop = 0.55f;
        Hybrid(V, 0.26f, 0.40f, 0.40f, 4.2f, 0.30f, 4600, 0.8f, { 1.2f, 0.5f, 1.1f, 0.4f, 0.9f, 0.3f, 0.7f });
    }
    {   // Porsche Taycan Turbo S — pure EV (main-branch synthesis; combustion fields unused)
        EngineVoice& V = Add(); V = Base("taycan", "Porsche Taycan Turbo S", "Electric - twin-motor + 2-speed gear whine", 2u, 1u, 0.0f, 16000.0f);
        V.Electric = true; V.Level = 0.3f; V.Pop = 0.0f;
        Hybrid(V, 0.0f, 0.0f, 0.0f, 3.0f, 0.0f, 4000, 0.0f, { 1.0f });
    }
    {   // Porsche 911 GT3 R — boxer-6, deliberately unequal primaries = the warble
        EngineVoice& V = Add(); V = Base("911-gt3r", "Porsche 911 GT3 R", "Boxer-6 - raw metallic rasp", 6u, 2u, 1100.0f, 9000.0f);
        V.BlowLow = 100; V.BlowHigh = 66; V.Decay = 3.0f; V.Attack = 0.00045f;
        V.FcLow = 1000; V.FcHigh = 5200; V.Body = 0.55f; V.BodyHz = 150;
        V.Formants[0] = F(120, 1.4f, 3.2f); V.Formants[1] = F(360, 1.5f, 3.5f); V.Formants[2] = F(880, 2.3f, 3.8f);
        V.Formants[3] = F(1900, 2.4f, 3.5f); V.Formants[4] = F(3300, 1.5f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.11f; V.BankGain = 0.84f; V.PipeMs = 2.6f; V.PipeFb = -0.5f; V.PipeDamp = 3800;
        V.Rasp = 0.62f; V.RaspHz = 2400;
        V.Intake[0] = F(300, 2.4f, 3.5f); V.Intake[1] = F(780, 2.7f, 3.8f); V.IntakeCount = 2u; V.IntakeGain = 0.8f;
        V.Rough = 0.17f; V.Skew = 2.8f; V.Cyc = 0.17f; V.Jit = 1.6f; V.IdleLope = 0.5f; V.Level = 0.27f;
        V.RunnerMs = 1.0f; V.RunnerSpread = 0.55f; V.ReflG = 0.38f; V.CollMs = 1.2f; V.CollFb = 0.24f;
        V.Tors = 0.05f; V.CamHz = 2920; V.CamQ = 5.2f; V.CamG = 0.92f; V.CabHz = 104; V.CabG = 0.48f; V.Pop = 0.35f;
        Hybrid(V, 0.26f, 0.42f, 0.40f, 4.6f, 0.42f, 5400, 0.9f, { 0.95f, 0.7f, 1.1f, 0.6f, 0.4f });
    }
    {   // Lamborghini Huracan GT3 — V10 nasal banshee wail
        EngineVoice& V = Add(); V = Base("huracan-gt3", "Lamborghini Huracan GT3 Evo2", "V10 - nasal banshee wail", 10u, 2u, 1100.0f, 8500.0f);
        V.BlowLow = 100; V.BlowHigh = 66; V.Decay = 2.6f; V.Attack = 0.0006f; V.Round = 0.22f;
        V.FcLow = 1000; V.FcHigh = 5000; V.Body = 0.75f; V.BodyHz = 140;
        V.Formants[0] = F(130, 1.5f, 3.0f); V.Formants[1] = F(420, 1.6f, 3.2f); V.Formants[2] = F(1000, 2.2f, 3.2f);
        V.Formants[3] = F(2000, 2.3f, 3.0f); V.Formants[4] = F(3400, 1.3f, 2.8f); V.FormantCount = 5u;
        V.Detune = 0.03f; V.BankGain = 0.93f; V.PipeMs = 4.2f; V.PipeFb = -0.45f; V.PipeDamp = 3400;
        V.Rasp = 0.20f; V.RaspHz = 2400;
        V.Intake[0] = F(360, 2.0f, 3.2f); V.Intake[1] = F(1000, 2.4f, 3.5f); V.IntakeCount = 2u; V.IntakeGain = 0.7f; V.IntakeW = 170;
        V.Rough = 0.08f; V.Skew = 1.4f; V.Cyc = 0.09f; V.Jit = 0.9f; V.IdleLope = 0.22f; V.Level = 0.27f;
        V.RunnerMs = 0.85f; V.RunnerSpread = 0.12f; V.ReflG = 0.36f; V.CollMs = 1.0f; V.CollFb = 0.2f;
        V.Tors = 0.03f; V.CamHz = 3220; V.CamQ = 5.8f; V.CamG = 0.6f; V.CabHz = 101; V.CabG = 0.43f; V.Pop = 0.45f;
        Hybrid(V, 0.24f, 0.50f, 0.44f, 4.2f, 0.30f, 5100, 0.85f, { 0.9f, 0.8f, 1.0f, 0.7f, 0.4f, 0.25f });
    }
    {   // Mercedes-AMG GT3 — cross-plane V8 thunder (additive model: the unique one)
        EngineVoice& V = Add(); V = Base("amg-gt3", "Mercedes-AMG GT3", "Cross-plane V8 - thunder", 8u, 2u, 1000.0f, 7500.0f);
        V.CrossPlane = true;
        V.BlowLow = 120; V.BlowHigh = 90; V.Decay = 2.3f; V.Attack = 0.0006f;
        V.FcLow = 800; V.FcHigh = 4800; V.Body = 1.5f; V.BodyHz = 110;
        V.Formants[0] = F(80, 2.5f, 4); V.Formants[1] = F(160, 2.1f, 4); V.Formants[2] = F(330, 1.7f, 4);
        V.Formants[3] = F(820, 1.3f, 3.5f); V.Formants[4] = F(1700, 1.0f, 3); V.FormantCount = 5u;
        V.Detune = 0.07f; V.BankGain = 0.85f; V.Intake[0] = F(200, 2.0f, 3); V.IntakeGain = 0.7f; V.IntakeW = 185;
        V.Rough = 0.15f; V.Skew = 3.0f; V.Cyc = 0.15f; V.Jit = 1.8f; V.IdleLope = 0.55f; V.Drive = 1.1f;
        V.RunnerMs = 1.1f; V.RunnerSpread = 0.22f; V.ReflG = 0.34f; V.CollMs = 1.3f; V.CollFb = 0.24f;
        V.Tors = 0.052f; V.CamHz = 2280; V.CamQ = 4.8f; V.CamG = 0.84f; V.CabHz = 88; V.CabG = 0.50f; V.Pop = 0.60f;
        V.Alpha = 1.0f; V.AddRes[0] = F(85, 1.5f, 0.20f); V.AddRes[1] = F(170, 1.2f, 0.22f);
        V.AddRes[2] = F(340, 0.9f, 0.28f); V.AddRes[3] = F(900, 1.0f, 0.30f); V.AddResCount = 4u; V.Lope = 0.12f;
        Hybrid(V, 0.30f, 0.12f, 0.42f, 3.2f, 0.34f, 4100, 0.6f, { 1.0f, 0.85f, 0.6f, 0.45f, 0.28f });
    }
    {   // Nissan GT-R NISMO GT3 — race VR38, open turbo plumbing
        EngineVoice& V = Add(); V = Base("gtr-gt3", "Nissan GT-R NISMO GT3", "Twin-turbo V6 - open-pipe bark", 6u, 2u, 1000.0f, 7600.0f);
        V.Boosted = true;
        V.BlowLow = 112; V.BlowHigh = 84; V.Decay = 2.5f; V.Attack = 0.00065f;
        V.FcLow = 750; V.FcHigh = 3600; V.Body = 1.3f; V.BodyHz = 115;
        V.Formants[0] = F(85, 2.2f, 3.5f); V.Formants[1] = F(180, 2.0f, 3.6f); V.Formants[2] = F(420, 1.8f, 3.8f);
        V.Formants[3] = F(1000, 1.7f, 3.5f); V.Formants[4] = F(2000, 1.3f, 3.2f); V.FormantCount = 5u;
        V.Detune = 0.07f; V.BankGain = 0.86f; V.PipeMs = 4.8f; V.PipeFb = -0.5f; V.PipeDamp = 2800;
        V.Rasp = 0.40f; V.RaspHz = 1500; V.Intake[0] = F(260, 1.2f, 3); V.IntakeGain = 0.35f; V.IntakeW = 180;
        V.Rough = 0.16f; V.Skew = 3.0f; V.Cyc = 0.16f; V.Jit = 1.8f; V.IdleLope = 0.55f; V.Drive = 1.1f; V.Level = 0.28f;
        V.RunnerMs = 1.6f; V.RunnerSpread = 0.38f; V.ReflG = 0.32f; V.CollMs = 2.0f; V.CollFb = 0.32f;
        V.Turbo = 0.45f; V.TurboHz = 1500; V.Tors = 0.058f; V.CamHz = 2480; V.CamQ = 4.8f; V.CamG = 0.82f;
        V.CabHz = 84; V.CabG = 0.47f; V.SpoolHz = 5900; V.SpoolG = 1.02f; V.Pop = 0.60f;
        Hybrid(V, 0.25f, 0.22f, 0.38f, 4.0f, 0.36f, 4300, 0.7f, { 1.0f, 0.65f, 0.9f, 0.65f, 0.4f });
    }
    {   // Ferrari 296 GT3 — 120-degree V6, ripping canvas
        EngineVoice& V = Add(); V = Base("296-gt3", "Ferrari 296 GT3", "120 deg V6 - ripping canvas", 6u, 2u, 1100.0f, 8400.0f);
        V.Boosted = true;
        V.BlowLow = 100; V.BlowHigh = 70; V.Decay = 2.8f; V.Attack = 0.0005f;
        V.FcLow = 900; V.FcHigh = 4600; V.Body = 0.85f; V.BodyHz = 135;
        V.Formants[0] = F(135, 1.9f, 3.2f); V.Formants[1] = F(370, 1.8f, 3.5f); V.Formants[2] = F(880, 2.2f, 3.6f);
        V.Formants[3] = F(1900, 2.1f, 3.4f); V.Formants[4] = F(3300, 1.3f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.05f; V.BankGain = 0.88f; V.PipeMs = 3.0f; V.PipeFb = -0.55f; V.PipeDamp = 3500;
        V.Rasp = 0.50f; V.RaspHz = 1900; V.Intake[0] = F(330, 1.4f, 3); V.IntakeGain = 0.42f;
        V.Rough = 0.15f; V.Skew = 2.6f; V.Cyc = 0.15f; V.Jit = 1.5f; V.IdleLope = 0.45f; V.Level = 0.28f;
        V.RunnerMs = 1.3f; V.RunnerSpread = 0.32f; V.ReflG = 0.3f; V.CollMs = 1.6f; V.CollFb = 0.28f;
        V.Turbo = 0.45f; V.TurboHz = 1600; V.Tors = 0.046f; V.CamHz = 2820; V.CamQ = 5.2f; V.CamG = 0.72f;
        V.CabHz = 95; V.CabG = 0.45f; V.SpoolHz = 6900; V.SpoolG = 0.92f; V.Pop = 0.50f;
        Hybrid(V, 0.22f, 0.34f, 0.40f, 4.4f, 0.34f, 4900, 0.85f, { 0.95f, 0.7f, 1.0f, 0.7f, 0.4f });
    }
    {   // BMW M4 GT3 — turbo inline-6, one long exhaust, split-scroll growl
        EngineVoice& V = Add(); V = Base("m4-gt3", "BMW M4 GT3", "Inline-6 - long-pipe growl", 6u, 1u, 1000.0f, 7200.0f);
        V.Boosted = true;
        V.BlowLow = 112; V.BlowHigh = 82; V.Decay = 2.5f; V.Attack = 0.00065f; V.Round = 0.15f;
        V.FcLow = 700; V.FcHigh = 3800; V.Body = 1.15f; V.BodyHz = 120;
        V.Formants[0] = F(110, 2.1f, 3.5f); V.Formants[1] = F(240, 1.8f, 3.5f); V.Formants[2] = F(520, 2.0f, 3.8f);
        V.Formants[3] = F(1050, 1.8f, 3.5f); V.Formants[4] = F(2000, 1.2f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.0f; V.BankGain = 1.0f; V.PipeMs = 6.2f; V.PipeFb = -0.52f; V.PipeDamp = 2600;
        V.Rasp = 0.30f; V.RaspHz = 1250; V.Intake[0] = F(240, 1.3f, 3); V.IntakeGain = 0.35f; V.IntakeW = 185;
        V.Rough = 0.12f; V.Skew = 2.0f; V.Cyc = 0.12f; V.Jit = 1.3f; V.IdleLope = 0.35f; V.Level = 0.28f;
        V.RunnerMs = 1.9f; V.RunnerSpread = 0.3f; V.ReflG = 0.34f; V.CollMs = 2.2f; V.CollFb = 0.32f;
        V.Turbo = 0.5f; V.TurboHz = 1400; V.Tors = 0.052f; V.CamHz = 2580; V.CamQ = 5.0f; V.CamG = 0.76f;
        V.CabHz = 87; V.CabG = 0.44f; V.SpoolHz = 6400; V.SpoolG = 0.98f; V.Pop = 0.50f;
        Hybrid(V, 0.26f, 0.18f, 0.40f, 3.8f, 0.28f, 4000, 0.7f, { 1.05f, 0.7f, 0.95f, 0.6f, 0.35f });
    }
    {   // Ferrari 488 GTE — turbo flat-plane V8, tearing fabric muffled by turbines
        EngineVoice& V = Add(); V = Base("488-gte", "Ferrari 488 GTE Evo", "Turbo flat-plane V8 - tearing", 8u, 2u, 1100.0f, 7800.0f);
        V.Boosted = true;
        V.BlowLow = 108; V.BlowHigh = 78; V.Decay = 2.7f; V.Attack = 0.0006f; V.Round = 0.08f;
        V.FcLow = 850; V.FcHigh = 4200; V.Body = 1.0f; V.BodyHz = 125;
        V.Formants[0] = F(120, 1.9f, 3.4f); V.Formants[1] = F(330, 1.9f, 3.6f); V.Formants[2] = F(780, 2.2f, 3.6f);
        V.Formants[3] = F(1700, 2.0f, 3.3f); V.Formants[4] = F(3000, 1.2f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.05f; V.BankGain = 0.9f; V.PipeMs = 3.8f; V.PipeFb = -0.45f; V.PipeDamp = 3000;
        V.Rasp = 0.38f; V.RaspHz = 1800; V.Intake[0] = F(300, 1.5f, 3); V.IntakeGain = 0.4f;
        V.Rough = 0.14f; V.Skew = 2.4f; V.Cyc = 0.15f; V.Jit = 1.5f; V.IdleLope = 0.45f; V.Level = 0.28f;
        V.RunnerMs = 1.2f; V.RunnerSpread = 0.25f; V.ReflG = 0.28f; V.CollMs = 1.4f; V.CollFb = 0.26f;
        V.Turbo = 0.45f; V.TurboHz = 1600; V.Tors = 0.042f; V.CamHz = 2920; V.CamQ = 5.2f; V.CamG = 0.66f;
        V.CabHz = 93; V.CabG = 0.46f; V.SpoolHz = 6650; V.SpoolG = 0.94f; V.Pop = 0.55f;
        Hybrid(V, 0.22f, 0.40f, 0.40f, 4.2f, 0.32f, 4700, 0.8f, { 1.0f, 0.6f, 1.05f, 0.5f, 0.35f });
    }
    {   // Porsche 911 RSR-19 — mid-engine boxer-6, deep racing bark
        EngineVoice& V = Add(); V = Base("911-rsr", "Porsche 911 RSR-19", "Boxer-6 - deep racing bark", 6u, 2u, 1200.0f, 9300.0f);
        V.BlowLow = 104; V.BlowHigh = 70; V.Decay = 2.8f; V.Attack = 0.0005f; V.Round = 0.08f;
        V.FcLow = 950; V.FcHigh = 4800; V.Body = 0.85f; V.BodyHz = 135;
        V.Formants[0] = F(105, 1.9f, 3.3f); V.Formants[1] = F(290, 1.9f, 3.6f); V.Formants[2] = F(700, 2.3f, 3.8f);
        V.Formants[3] = F(1500, 2.2f, 3.5f); V.Formants[4] = F(2800, 1.4f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.12f; V.BankGain = 0.83f; V.PipeMs = 3.9f; V.PipeFb = -0.52f; V.PipeDamp = 3000;
        V.Rasp = 0.48f; V.RaspHz = 1700;
        V.Intake[0] = F(260, 2.5f, 3.3f); V.Intake[1] = F(700, 2.6f, 3.6f); V.IntakeCount = 2u; V.IntakeGain = 0.8f;
        V.Rough = 0.17f; V.Skew = 2.8f; V.Cyc = 0.17f; V.Jit = 1.6f; V.IdleLope = 0.5f; V.Level = 0.28f;
        V.RunnerMs = 1.2f; V.RunnerSpread = 0.58f; V.ReflG = 0.38f; V.CollMs = 1.4f; V.CollFb = 0.26f;
        V.Tors = 0.052f; V.CamHz = 2840; V.CamQ = 5.2f; V.CamG = 0.96f; V.CabHz = 99; V.CabG = 0.53f; V.Pop = 0.30f;
        Hybrid(V, 0.25f, 0.44f, 0.40f, 4.8f, 0.40f, 5500, 0.9f, { 0.9f, 0.7f, 1.15f, 0.65f, 0.4f });
    }
    {   // Chevrolet Corvette C8.R — big flat-plane V8 thunderous bark
        EngineVoice& V = Add(); V = Base("c8r", "Chevrolet Corvette C8.R", "Big flat-plane V8 - thunderous bark", 8u, 2u, 1100.0f, 8500.0f);
        V.BlowLow = 112; V.BlowHigh = 80; V.Decay = 2.6f; V.Attack = 0.0006f; V.Round = 0.05f;
        V.FcLow = 850; V.FcHigh = 5000; V.Body = 1.3f; V.BodyHz = 115;
        V.Formants[0] = F(95, 2.3f, 3.4f); V.Formants[1] = F(270, 2.0f, 3.6f); V.Formants[2] = F(640, 2.2f, 3.8f);
        V.Formants[3] = F(1400, 2.0f, 3.5f); V.Formants[4] = F(2600, 1.4f, 3.0f); V.FormantCount = 5u;
        V.Detune = 0.06f; V.BankGain = 0.86f; V.PipeMs = 4.4f; V.PipeFb = -0.5f; V.PipeDamp = 3200;
        V.Rasp = 0.45f; V.RaspHz = 1500;
        V.Intake[0] = F(240, 2.5f, 3.2f); V.Intake[1] = F(650, 2.3f, 3.5f); V.IntakeCount = 2u; V.IntakeGain = 0.75f; V.IntakeW = 180;
        V.Rough = 0.15f; V.Skew = 2.8f; V.Cyc = 0.16f; V.Jit = 1.7f; V.IdleLope = 0.5f; V.Drive = 1.1f; V.Level = 0.28f;
        V.RunnerMs = 1.1f; V.RunnerSpread = 0.2f; V.ReflG = 0.34f; V.CollMs = 1.3f; V.CollFb = 0.24f;
        V.Tors = 0.048f; V.CamHz = 2620; V.CamQ = 5.0f; V.CamG = 0.86f; V.CabHz = 90; V.CabG = 0.51f; V.Pop = 0.60f;
        Hybrid(V, 0.24f, 0.38f, 0.42f, 4.0f, 0.36f, 4500, 0.8f, { 1.05f, 0.6f, 1.0f, 0.55f, 0.35f });
    }
    {   // Aston Martin Vantage GTE — cross-plane turbo V8 burble (additive + spool)
        EngineVoice& V = Add(); V = Base("vantage-gte", "Aston Martin Vantage AMR GTE", "Cross-plane turbo V8 - burble", 8u, 2u, 1000.0f, 7200.0f);
        V.CrossPlane = true; V.Boosted = true;
        V.BlowLow = 115; V.BlowHigh = 85; V.Decay = 2.4f; V.Attack = 0.0006f;
        V.FcLow = 750; V.FcHigh = 3800; V.Body = 1.4f; V.BodyHz = 115;
        V.Formants[0] = F(90, 2.4f, 4); V.Formants[1] = F(220, 2.0f, 4); V.Formants[2] = F(520, 1.6f, 4);
        V.Formants[3] = F(1100, 1.3f, 3.5f); V.Formants[4] = F(2000, 1.0f, 3); V.FormantCount = 5u;
        V.Detune = 0.07f; V.BankGain = 0.85f; V.Intake[0] = F(230, 1.4f, 3); V.IntakeGain = 0.4f; V.IntakeW = 185;
        V.Rough = 0.15f; V.Skew = 3.0f; V.Cyc = 0.15f; V.Jit = 1.8f; V.IdleLope = 0.55f; V.Drive = 1.1f;
        V.RunnerMs = 1.4f; V.RunnerSpread = 0.3f; V.ReflG = 0.3f; V.CollMs = 1.6f; V.CollFb = 0.28f;
        V.Turbo = 0.45f; V.TurboHz = 1500; V.Tors = 0.055f; V.CamHz = 2320; V.CamQ = 4.8f; V.CamG = 0.8f;
        V.CabHz = 85; V.CabG = 0.49f; V.SpoolHz = 5650; V.SpoolG = 1.04f; V.Pop = 0.55f;
        V.Alpha = 1.0f; V.AddRes[0] = F(90, 1.4f, 0.20f); V.AddRes[1] = F(220, 1.1f, 0.25f);
        V.AddRes[2] = F(520, 0.9f, 0.30f); V.AddRes[3] = F(1100, 0.8f, 0.30f); V.AddResCount = 4u; V.Lope = 0.10f;
        Hybrid(V, 0.30f, 0.14f, 0.42f, 3.2f, 0.32f, 4100, 0.6f, { 1.0f, 0.85f, 0.6f, 0.45f, 0.28f });
    }

    if (Count) *Count = I;
    return Garage;
}

} // namespace

const EngineVoice* VoiceGarage(uint32_t* Count) noexcept { return BuildGarage(Count); }

const EngineVoice* FindVoice(std::string_view Id) noexcept
{
    uint32_t Count = 0u;
    const EngineVoice* Garage = BuildGarage(&Count);
    for (uint32_t I = 0u; I < Count; ++I)
        if (Id == Garage[I].Id) return &Garage[I];
    return nullptr;
}

const EngineVoice& HeroVoice() noexcept
{
    const EngineVoice* Hero = FindVoice("laferrari");
    return *Hero;   // the garage is static and always contains the hero car
}

} // namespace Frontier
