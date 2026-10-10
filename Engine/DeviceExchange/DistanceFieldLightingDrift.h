//============================================================================================================================================
//                                                  DISTANCEFIELDLIGHTINGDRIFT.H
//============================================================================================================================================
// 📦 Decides whether the Distance Field GI card history must restart. Shared by the device stage and the CPU proof so both run
//    the same arithmetic.
//
// The first build compared the lighting block byte for byte. An animating sun, or auto-exposure easing by a fraction of a
// percent, changed some byte every frame, so both card images were cleared every frame and the GI never accumulated. A step
// below what the eye can resolve must not restart the history. Larger steps (a preset change, a sun that moved a visible
// amount, a real exposure jump) still restart it at once.

#pragma once

#include <cmath>
#include <cstdint>

namespace DistanceFieldLightingDrift
{
// Layout of the 12-float lighting block: [0..3] sun direction + radiance, [4..7] sun colour, [8..11] sky ambient + exposure.
inline constexpr float SunDirectionToleranceDegrees = 0.25f;   // angular step of the sun direction that still keeps history
inline constexpr float RelativeToleranceFraction    = 0.02f;   // 2% step in radiance, colour, ambient or exposure keeps history

inline bool LightingChanged(const float* Previous, const float* Next) noexcept
{
    const float PreviousLength = std::sqrt(Previous[0] * Previous[0] + Previous[1] * Previous[1] + Previous[2] * Previous[2]);
    const float NextLength     = std::sqrt(Next[0] * Next[0] + Next[1] * Next[1] + Next[2] * Next[2]);
    if (PreviousLength > 1e-6f && NextLength > 1e-6f)
    {
        const float Cosine = (Previous[0] * Next[0] + Previous[1] * Next[1] + Previous[2] * Next[2]) / (PreviousLength * NextLength);
        if (Cosine < std::cos(SunDirectionToleranceDegrees * 3.14159265f / 180.0f)) return true;
    }
    else if ((PreviousLength > 1e-6f) != (NextLength > 1e-6f))
    {
        return true;   // sun appeared or disappeared
    }
    for (uint32_t Index = 3u; Index < 12u; ++Index)
    {
        const float A = Previous[Index], B = Next[Index];
        if (!std::isfinite(A) || !std::isfinite(B)) return true;
        const float Scale = std::fmax(std::fmax(std::fabs(A), std::fabs(B)), 1e-6f);
        if (std::fabs(A - B) > RelativeToleranceFraction * Scale) return true;
    }
    return false;
}
} // namespace DistanceFieldLightingDrift
