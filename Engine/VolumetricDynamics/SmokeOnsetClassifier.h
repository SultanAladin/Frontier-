//============================================================================================================================================
//                                                       SMOKEONSETCLASSIFIER.H
//============================================================================================================================================
// 📦 Per-wheel sliding-source hysteresis; contact loss cuts friction immediately, while thermal combustion is classified separately.

#pragma once

#include "SmokeSequence.h"
#include <cmath>

namespace Frontier
{

struct SmokeOnsetMetrics
{
    float RequestSeconds = 0.0f; // [s] - sustained above-onset sliding
    float QuietSeconds   = 0.0f; // [s] - transient release grace
    bool  Active         = false;
};

inline bool AdvanceSmokeOnset(
    SmokeOnsetMetrics&        Metrics,
    double                    SlidingPower,
    double                    SlipSpeed,
    bool                      Contact,
    float                     Seconds,
    const SmokeSpecification& Specification) noexcept
{
    if (!Contact || !std::isfinite(SlidingPower) || !std::isfinite(SlipSpeed) || !std::isfinite(Seconds) || Seconds <= 0.0f)
    {
        Metrics = {};
        return false;
    }
    const bool AboveEntry = SlidingPower > Specification.SourcePowerOnset && SlipSpeed >= Specification.MinimumSlipSpeed;
    const bool AboveRelease = SlidingPower > Specification.SourcePowerOnset * Specification.SourceReleaseRatio &&
                              SlipSpeed >= Specification.MinimumSlipSpeed;
    if (AboveEntry)
    {
        Metrics.RequestSeconds += Seconds;
        Metrics.QuietSeconds = 0.0f;
        if (Metrics.RequestSeconds + 0.000001f >= Specification.SourceOnsetSeconds) Metrics.Active = true;
    }
    else if (Metrics.Active && AboveRelease)
        Metrics.QuietSeconds = 0.0f;
    else
    {
        Metrics.RequestSeconds = 0.0f;
        Metrics.QuietSeconds += Seconds;
        if (Metrics.QuietSeconds >= Specification.SourceReleaseSeconds) Metrics.Active = false;
    }
    return Metrics.Active;
}

} // namespace Frontier
