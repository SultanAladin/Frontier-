//============================================================================================================================================
//                                                              SMOKESEQUENCE.H
//============================================================================================================================================
// 📦 One on-demand vehicle smoke lattice: world-space sources, exact cell scrolling, continued fading and explicit retirement.

#pragma once

#include "SmokeSpace.h"

#include <array>
#include <memory>

namespace Frontier
{

struct SmokeSpecification
{
    float             Span                 = 24.0f;      // [m]       - finite world-axis-aligned extent; not unlimited trail retention
    uint32_t          GuardCells           = 8u;         // [cells]   - protected interior for source movement
    float             SourcePowerOnset     = 200.0f;     // [W]       - sliding must dissipate enough energy to request visible smoke
    float             SourcePowerFull      = 18000.0f;   // [W]       - reference contact heating for source strength
    float             MinimumSlipSpeed     = 0.35f;      // [m/s]     - static support does not request friction smoke
    float             DensityRate          = 18.0f;      // [1/s]     - reference source density
    float             CarrierVelocityShare = 0.15f;      // [-]      - injection momentum, never a transform of already emitted gas
    float             FaintestVisible      = 0.004f;     // [density] - release when the remaining plume is below this threshold
    float             FadeCeiling          = 12.0f;      // [s]       - maximum retained plume after sources stop
    float             InjectionRadiusCells = 0.8f;       // [cells]  - coarse source footprint; fine visual detail is a separate delivery
    float             SmokeHeatRate        = 0.04f;      // [K/s]     - small buoyancy contribution, no automatic flame appearance
    float             FireHeatPowerScale   = 0.00005f;   // [K/J]   - authored plume heat conversion from tyre combustion
    CoarseGasSettings Transport           ;
};

struct SmokeMetrics
{
    uint64_t AdvanceNumber   = 0u;      // [-] - completed gas ticks
    uint64_t Acquisitions    = 0u;      // [-] - actual on-demand lattice acquisitions
    uint64_t Relocations     = 0u;      // [-] - nonzero integer-cell movements
    uint64_t Retirements     = 0u;      // [-] - completed releases
    uint32_t ActiveSources   = 0u;      // [-] - multiple tyres share one domain
    double   DensitySum      = 0.0;     // [-] - sum over current cells
    float    PeakDensity     = 0.0f;    // [-] - maximum current density
    float    PeakTemperature = 0.0f;    // [K] - retained hot plume above ambient
    float    QuietSeconds    = 0.0f;    // [s] - elapsed since latest source request
    bool     Resident        = false;   // [-] - allocated field, including lingering smoke
    bool     Refused         = false;   // [-] - invalid request, not silently replaced with empty smoke
};

class SmokeSequence
{
public:
    using ObstructionReading = void (*)(CoarseGasField&, const void*);

    const CoarseGasField* QueryField() const noexcept { return ActiveField.get(); }
    const SmokeMetrics& QueryMetrics() const noexcept { return CurrentMetrics; }

    void Reclaim() noexcept
    {
        if (ActiveField) ++CurrentMetrics.Retirements;
        ActiveField.reset();
        CurrentMetrics.Resident = false;
        CurrentMetrics.ActiveSources = 0u;
        CurrentMetrics.DensitySum = 0.0;
        CurrentMetrics.PeakDensity = 0.0f;
        CurrentMetrics.QuietSeconds = 0.0f;
        CurrentMetrics.PeakTemperature = 0.0f;
    }

    /// 📦 Advances one fixed gas tick; source positions are world-space and existing contents never inherit yaw.
    /// in    Sources       [-] emissions accumulated over the corresponding completed physics interval
    /// in    Placement     [m] carrier position used only for bounded origin scrolling
    /// in    Obstruction   [-] synchronous occupancy refresh; no callback/context is retained
    /// out   QueryMetrics  [-] acquisition, relocation, source and retirement readings
    /// err   false for invalid requests/allocation/scrolling refusal; Refused reports the failure
    bool Integrate(
        const SmokeSpecification& Specification,
        const GasEmission*        Sources,
        uint32_t                  SourceCount,
        const float               Placement[3],
        ObstructionReading        Obstruction = nullptr,
        const void*               ObstructionContext = nullptr) noexcept
    {
        CurrentMetrics.Refused = false;
        if (!Placement || SourceCount > 64u || (SourceCount && !Sources) ||
            !std::isfinite(Specification.Span) || Specification.Span / CoarseExtent < 0.0001f ||
            Specification.GuardCells >= CoarseExtent / 2u)
        { CurrentMetrics.Refused = true; return false; }
        const float Nonnegative[] = {Specification.SourcePowerOnset, Specification.SourcePowerFull,
            Specification.MinimumSlipSpeed, Specification.DensityRate, Specification.CarrierVelocityShare,
            Specification.FaintestVisible, Specification.SmokeHeatRate, Specification.FireHeatPowerScale,
            Specification.Transport.BuoyancyLift, Specification.Transport.SmokeWeight,
            Specification.Transport.SmokeLossPerSecond, Specification.Transport.CoolingPerSecond,
            Specification.Transport.DampingPerSecond, Specification.Transport.TurbulenceStrength,
            Specification.Transport.TurbulenceScale};
        for (float Reading : Nonnegative)
            if (!std::isfinite(Reading) || Reading < 0.0f) { CurrentMetrics.Refused = true; return false; }
        if (!std::isfinite(Specification.FadeCeiling) || Specification.FadeCeiling <= 0.0f ||
            !std::isfinite(Specification.InjectionRadiusCells) || Specification.InjectionRadiusCells <= 0.0f ||
            Specification.SourcePowerFull <= Specification.SourcePowerOnset ||
            Specification.Transport.SmokeLossPerSecond > 1.0f || Specification.Transport.CoolingPerSecond > 1.0f ||
            Specification.Transport.DampingPerSecond > 1.0f)
        { CurrentMetrics.Refused = true; return false; }
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
            if (!std::isfinite(Placement[Axis])) { CurrentMetrics.Refused = true; return false; }
        uint32_t ActiveSources = 0u;
        for (uint32_t Index = 0u; Index < SourceCount; ++Index)
        {
            const auto& Source = Sources[Index];
            if (!std::isfinite(Source.Radius) || Source.Radius <= 0.0f ||
                !std::isfinite(Source.SmokeRate) || Source.SmokeRate < 0.0f ||
                !std::isfinite(Source.TemperatureRate) || Source.TemperatureRate < 0.0f)
            { CurrentMetrics.Refused = true; return false; }
            for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                if (!std::isfinite(Source.Position[Axis]) || !std::isfinite(Source.Velocity[Axis]))
                { CurrentMetrics.Refused = true; return false; }
            if (Source.SmokeRate > 0.0f || Source.TemperatureRate > 0.0f)
            {
                const float Radius = std::max(Source.Radius, Specification.Span / CoarseExtent * Specification.InjectionRadiusCells);
                for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                    if (std::abs(double(Source.Position[Axis]) - Placement[Axis]) + Radius >= 0.5 * Specification.Span)
                    { CurrentMetrics.Refused = true; return false; }
                ++ActiveSources;
            }
        }
        if (!ActiveField && ActiveSources == 0u) return true;
        if (!ActiveField)
        {
            try
            {
                auto Candidate = std::make_unique<CoarseGasField>();
                const float Cell = Specification.Span / CoarseExtent;
                float Origin[3];
                for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                    Origin[Axis] = std::floor((Placement[Axis] - 0.5f * Specification.Span) / Cell) * Cell;
                ResetField(*Candidate, Origin, Specification.Span);
                ActiveField = std::move(Candidate);
            }
            catch (...) { CurrentMetrics.Refused = true; return false; }
            ++CurrentMetrics.Acquisitions;
            CurrentMetrics.Resident = true;
        }
        // 📝 A live extent cannot be resized by relabelling it; refuse until a separate remapping is supplied.
        if (ActiveField->Span != Specification.Span) { CurrentMetrics.Refused = true; return false; }
        int32_t Shift[3]{};
        if (ActiveSources && !ResolveSmokeShift(*ActiveField, Placement, Specification.GuardCells, Shift))
        { CurrentMetrics.Refused = true; return false; }
        if (Shift[0] || Shift[1] || Shift[2])
        {
            SmokeRelocationMetrics Reading;
            if (!RelocateSmoke(*ActiveField, Shift, Reading)) { CurrentMetrics.Refused = true; return false; }
            ++CurrentMetrics.Relocations;
        }
        std::fill(ActiveField->Occupancy.begin(), ActiveField->Occupancy.end(), 0.0f);
        if (Obstruction) Obstruction(*ActiveField, ObstructionContext);
        const float RadiusFloor = VoxelSize(*ActiveField) * std::max(0.01f, Specification.InjectionRadiusCells);
        for (uint32_t Index = 0u; Index < SourceCount; ++Index)
        {
            GasEmission Emission = Sources[Index];
            if (Emission.SmokeRate <= 0.0f && Emission.TemperatureRate <= 0.0f) continue;
            Emission.Radius = std::max(Emission.Radius, RadiusFloor);
            InjectEmission(*ActiveField, Emission, CoarseStepInterval);
        }
        AdvanceField(*ActiveField, Specification.Transport);
        ++CurrentMetrics.AdvanceNumber;
        CurrentMetrics.ActiveSources = ActiveSources;
        const float PreviousQuiet = CurrentMetrics.QuietSeconds;
        CurrentMetrics.QuietSeconds = ActiveSources ? 0.0f : PreviousQuiet + CoarseStepInterval;
        if (!ActiveSources)
        {
            // 📝 The declared lifetime fades remaining contents continuously; it does not pop a visible field at a ceiling.
            const float Remaining = std::max(0.0f, Specification.FadeCeiling - CurrentMetrics.QuietSeconds);
            const float Fade = Remaining / std::max(CoarseStepInterval, Specification.FadeCeiling - PreviousQuiet);
            for (float& Density : ActiveField->Smoke) Density *= Fade;
            for (float& Temperature : ActiveField->Temperature) Temperature *= Fade;
        }
        CurrentMetrics.DensitySum = 0.0;
        CurrentMetrics.PeakDensity = 0.0f;
        CurrentMetrics.PeakTemperature = 0.0f;
        for (float Temperature : ActiveField->Temperature) CurrentMetrics.PeakTemperature = std::max(CurrentMetrics.PeakTemperature, Temperature);
        for (float Density : ActiveField->Smoke)
        {
            CurrentMetrics.DensitySum += Density;
            CurrentMetrics.PeakDensity = std::max(CurrentMetrics.PeakDensity, Density);
        }
        if (!ActiveSources && CurrentMetrics.PeakDensity <= Specification.FaintestVisible && CurrentMetrics.PeakTemperature <= 0.05f) Reclaim();
        return true;
    }

private:
    std::unique_ptr<CoarseGasField> ActiveField;
    SmokeMetrics CurrentMetrics;
};

} // namespace Frontier
