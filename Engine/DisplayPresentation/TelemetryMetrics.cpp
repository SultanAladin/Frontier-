//============================================================================================================================================
//                                                     TELEMETRYMETRICS.CPP
//============================================================================================================================================
// 🧩 Frame-time ring and FPS overlay — see TelemetryMetrics.h.

#include "TelemetryMetrics.h"

#include <algorithm>
#include <cstdio>
#include <vector>

namespace Frontier {

TelemetryMetrics::TelemetryMetrics() noexcept
    : Samples{}, Cursor(0u), Filled(0u)
{
}

void TelemetryMetrics::RecordFrame(float DeltaSeconds) noexcept
{
    if (DeltaSeconds <= 0.0f) return;
    Samples[Cursor] = DeltaSeconds;
    Cursor = (Cursor + 1u) % SampleCount;
    if (Filled < SampleCount) ++Filled;
}

float TelemetryMetrics::QueryAverageFrameSeconds() const noexcept
{
    if (Filled == 0u) return 0.0f;
    float Sum = 0.0f;
    for (uint32_t I = 0u; I < Filled; ++I) Sum += Samples[I];
    return Sum / static_cast<float>(Filled);
}

void TelemetryMetrics::ConstructTelemetryLayout(PixelSpace& Surface, float TopInset) const noexcept
{
    if (!Surface.IsRecording()) return;

    constexpr ColorQuad Pill { 0x0A / 255.0f, 0x0A / 255.0f, 0x0B / 255.0f, 0.70f };
    constexpr ColorQuad Ink  { 1.0f, 1.0f, 1.0f, 0.90f };
    constexpr ColorQuad Trace{ 0x3B / 255.0f, 0x82 / 255.0f, 0xF6 / 255.0f, 0.90f };   // #3B82F6, same blue as active tiles
    constexpr float Inset = 16.0f, Padding = 10.0f, FontSize = 11.0f, GraphWidth = 120.0f, GraphHeight = 24.0f;

    char Readout[64];
    std::snprintf(Readout, sizeof(Readout), "%3.0f FPS  %5.1f ms",
                  static_cast<double>(QueryAverageFramesPerSecond()),
                  static_cast<double>(QueryAverageFrameSeconds() * 1000.0f));

    const PlanePoint TextSize = Surface.MeasureText(Readout, FontSize);
    const float Width  = Padding * 2.0f + std::max(TextSize.X, GraphWidth);
    const float Height = Padding * 2.0f + TextSize.Y + 6.0f + GraphHeight;
    const PlaneExtent Extent = Spanning(Inset, TopInset + Inset, Width, Height);

    Surface.FillRectangle(Extent, Pill, 12.0f);
    Surface.Text(Extent.MinimumX + Padding, Extent.MinimumY + Padding, Ink, Readout, FontSize);

    // Sparkline of the last SampleCount frames, oldest left. Scale: 0 ms at the bottom, 2 x the average at the top.
    if (Filled >= 2u)
    {
        const float Ceiling = std::max(QueryAverageFrameSeconds() * 2.0f, 1.0f / 240.0f);
        const float GraphX  = Extent.MinimumX + Padding;
        const float GraphY  = Extent.MinimumY + Padding + TextSize.Y + 6.0f;

        std::vector<PlanePoint> Line;
        Line.reserve(Filled);
        for (uint32_t I = 0u; I < Filled; ++I)
        {
            const uint32_t Index = (Cursor + SampleCount - Filled + I) % SampleCount;
            const float T = std::clamp(Samples[Index] / Ceiling, 0.0f, 1.0f);
            Line.push_back({ GraphX + GraphWidth * static_cast<float>(I) / static_cast<float>(SampleCount - 1u),
                             GraphY + GraphHeight * (1.0f - T) });
        }
        Surface.StrokePolyline(Line.data(), static_cast<uint32_t>(Line.size()), Trace, 1.0f, false);
    }
}

} // namespace Frontier
