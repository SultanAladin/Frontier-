//============================================================================================================================================
//                                                      TELEMETRYMETRICS.H
//============================================================================================================================================
// 🧩 Frame-time ring buffer and the top-left FPS overlay the Control Centre "FPS Overlay" tile toggles.
//
//    Overlay: 11 px monospace-style readout "60 FPS  16.7 ms" plus a 120-sample sparkline, on a #0A0A0B/70 pill.
//    Placed top-left beneath the notch line so it never collides with the notch or the toast column.

#pragma once

#include "PixelSpace.h"
#include <array>
#include <cstdint>

namespace Frontier {

class TelemetryMetrics
{
public:
    static constexpr uint32_t SampleCount = 120u;   // [frames] ring length (2 s at 60 Hz)

    TelemetryMetrics() noexcept;

    void RecordFrame(float DeltaSeconds) noexcept;

    [[nodiscard]] float QueryAverageFrameSeconds() const noexcept;
    [[nodiscard]] float QueryAverageFramesPerSecond() const noexcept
    {
        const float S = QueryAverageFrameSeconds();
        return S > 0.0f ? 1.0f / S : 0.0f;
    }

    void ConstructTelemetryLayout(PixelSpace& Surface, float TopInset) const noexcept;

private:
    std::array<float, SampleCount> Samples;   // [s]
    uint32_t Cursor;                          // [-] next write index
    uint32_t Filled;                          // [-] valid samples
};

} // namespace Frontier
