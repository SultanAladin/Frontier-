//============================================================================================================================================
// Shared viewport surface-style contract used by Frontier and SolidArc.
//============================================================================================================================================
#pragma once

#include <cstdint>

namespace Frontier {

// Both applications route their modelling viewport through these same surface styles and baked chrome matcap.
enum class ViewportShadingMode : uint8_t
{
    Flat = 0,
    Matcap = 1
};

inline constexpr ViewportShadingMode kDefaultViewportShading = ViewportShadingMode::Matcap;
inline constexpr uint8_t kDefaultMetalMatcapLayer = 1u; // Chrome, baked studio with 0.05 roughness.

} // namespace Frontier
