//============================================================================================================================================
//                                                              SMOKESEQUENCE.H
//============================================================================================================================================
// 📦 Host-owned on-demand smoke snapshots; versioned C copying, transactional refusal and no retained project pointers.

#pragma once

#include "../ProjectInterchange/CodeInterchange.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace Frontier::HostRuntime
{

class SmokeSequence
{
public:
    const FrontierProjectSmokeReading& QueryReading() const noexcept { return CurrentReading; }
    const std::vector<float>& QueryDensity() const noexcept { return CurrentDensity; }
    const std::vector<float>& QueryTemperature() const noexcept { return CurrentTemperature; }

    void Reclaim() noexcept
    {
        std::vector<float>().swap(CurrentDensity);
        std::vector<float>().swap(CurrentTemperature);
        std::vector<float>().swap(PendingDensity);
        std::vector<float>().swap(PendingTemperature);
        CurrentReading = {};
    }

    /// 📦 Negotiates an optional smoke extension without changing the host/project ABI3 opening contract.
    /// err   false and an explanation for refused/malformed publication; last complete snapshot remains unchanged
    bool Advance(const CodeInterchange& Project, std::string& Refusal)
    {
        if (!Project.SmokeAvailable()) { Reclaim(); return true; }
        return Capture([&Project](FrontierProjectSmokeReading& Reading) { return Project.ProjectSmoke(Reading); }, Refusal);
    }

    /// 📦 Captures completed scalar samples into host-owned storage only when a resident volume demands it.
    /// in    ReadingSource [-] synchronous C callback; no callback or caller pointer is retained
    /// out   Refusal       [-] precise publication failure; unsupported extensions release previous snapshots
    /// note  matching carrier/revision avoids repeat volume copying while paused; tyre readings still refresh
    template<class ReadingSource>
    bool Capture(const ReadingSource& Source, std::string& Refusal)
    {
        Refusal.clear();
        FrontierProjectSmokeReading Reading{};
        Reading.StructureSize = sizeof(Reading);
        Reading.InterchangeNumber = 1u;
        const uint32_t Status = Source(Reading);
        if (Status == 0u) { Reclaim(); return true; }
        if (Status != 1u || Reading.StructureSize != sizeof(Reading) || Reading.InterchangeNumber != 1u ||
            Reading.Refused || Reading.WheelCount > 8u || (Reading.Extent != 0u && Reading.Extent != 32u))
        { Refusal = "project smoke metadata refused or incompatible"; return false; }
        for (uint32_t Wheel = 0u; Wheel < Reading.WheelCount; ++Wheel)
        {
            const auto& Tyre = Reading.Tyres[Wheel];
            const float Readings[] = {Tyre.SurfaceTemperature, Tyre.CarcassTemperature, Tyre.GasTemperature,
                Tyre.GaugePressure, Tyre.GripFactor, Tyre.SlidingPower, Tyre.RemainingRubber};
            for (float Scalar : Readings) if (!std::isfinite(Scalar) || Scalar < 0.0f)
            { Refusal = "project tyre condition contains nonfinite or negative physical readings"; return false; }
            if (Tyre.Condition > 3u || Tyre.SurfaceTemperature <= 0.0f || Tyre.CarcassTemperature <= 0.0f ||
                Tyre.GasTemperature <= 0.0f || Tyre.GripFactor <= 0.0f)
            { Refusal = "project tyre condition is nonphysical or incompatible"; return false; }
        }
        if (Reading.Extent == 0u)
        {
            Reclaim();
            CurrentReading = Reading;
            CurrentReading.Density = CurrentReading.Temperature = nullptr;
            return true;
        }
        if (!std::isfinite(Reading.Span) || Reading.Span <= 0.0f || Reading.CarrierIdentifier == 0u)
        { Refusal = "project smoke extent or carrier identity is invalid"; return false; }
        for (float Coordinate : Reading.Origin) if (!std::isfinite(Coordinate))
        { Refusal = "project smoke world placement is nonfinite"; return false; }
        const bool PlacementUnchanged = Reading.Span == CurrentReading.Span &&
            std::equal(std::begin(Reading.Origin), std::end(Reading.Origin), std::begin(CurrentReading.Origin));
        if (CurrentReading.Extent == Reading.Extent && CurrentReading.CarrierIdentifier == Reading.CarrierIdentifier &&
            CurrentReading.Revision == Reading.Revision && PlacementUnchanged)
        {
            CurrentReading = Reading;
            CurrentReading.Density = CurrentReading.Temperature = nullptr;
            return true;
        }
        const FrontierProjectSmokeReading Negotiated = Reading;
        const uint32_t Count = Reading.Extent * Reading.Extent * Reading.Extent;
        try { PendingDensity.resize(Count); PendingTemperature.resize(Count); }
        catch (...) { Refusal = "host could not acquire smoke snapshot storage"; return false; }
        Reading.Capacity = Count;
        Reading.Density = PendingDensity.data();
        Reading.Temperature = PendingTemperature.data();
        if (Source(Reading) != 1u || Reading.StructureSize != sizeof(Reading) || Reading.InterchangeNumber != 1u ||
            Reading.Refused || Reading.CarrierIdentifier != Negotiated.CarrierIdentifier ||
            Reading.Revision != Negotiated.Revision || Reading.Extent != Negotiated.Extent || Reading.Span != Negotiated.Span ||
            !std::equal(std::begin(Reading.Origin), std::end(Reading.Origin), std::begin(Negotiated.Origin)) ||
            Reading.Density != PendingDensity.data() || Reading.Temperature != PendingTemperature.data())
        { Refusal = "project smoke changed or refused its synchronous snapshot delivery"; return false; }
        for (uint32_t Cell = 0u; Cell < Count; ++Cell)
            if (!std::isfinite(PendingDensity[Cell]) || !std::isfinite(PendingTemperature[Cell]) ||
                PendingDensity[Cell] < 0.0f || PendingTemperature[Cell] < 0.0f)
            { Refusal = "project smoke contains nonfinite or negative scalar samples"; return false; }
        CurrentDensity.swap(PendingDensity);
        CurrentTemperature.swap(PendingTemperature);
        CurrentReading = Negotiated;
        CurrentReading.Capacity = 0u;
        CurrentReading.Density = CurrentReading.Temperature = nullptr;
        return true;
    }

private:
    FrontierProjectSmokeReading CurrentReading{};
    std::vector<float> CurrentDensity, CurrentTemperature;
    std::vector<float> PendingDensity, PendingTemperature;
};

} // namespace Frontier::HostRuntime
