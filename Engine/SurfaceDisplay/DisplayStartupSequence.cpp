//============================================================================================================================================
//                                                      DISPLAYSTARTUPSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Power-on sequence: particles gather into a ring, the wordmark fades up, the veil lifts. See the header.

#include "DisplayStartupSequence.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float    kPi            = 3.14159265358979f;
constexpr uint32_t kParticleCount = 144u;

// Phase boundaries in sequence units [0,1].
constexpr float kGatherStart = 0.06f;   // particles leave their scatter
constexpr float kGatherSpan  = 0.52f;   // ... and reach the ring (per-particle delay spreads this)
constexpr float kRingStart   = 0.34f;   // ring stroke begins to close
constexpr float kRingSpan    = 0.34f;
constexpr float kWordStart   = 0.46f;   // wordmark fades in
constexpr float kWordSpan    = 0.16f;
constexpr float kLiftStart   = 0.74f;   // veil lifts, the screen underneath comes through
constexpr float kLiftSpan    = 0.22f;

[[nodiscard]] uint32_t Hash(uint32_t Value) noexcept
{
    Value ^= Value >> 16; Value *= 0x7feb352du; Value ^= Value >> 15; Value *= 0x846ca68bu; Value ^= Value >> 16;
    return Value;
}
[[nodiscard]] float Unit01(uint32_t Seed, uint32_t Index, uint32_t Channel) noexcept
{
    return static_cast<float>(Hash(Seed * 0x9e3779b9u + Index * 0x85ebca6bu + Channel * 0xc2b2ae35u) & 0xFFFFFFu) / 16777215.0f;
}
[[nodiscard]] float Ramp(float Unit, float Start, float Span) noexcept
{
    return std::clamp((Unit - Start) / std::max(Span, 1.0e-4f), 0.0f, 1.0f);
}
[[nodiscard]] float Smooth(float X) noexcept { return X * X * (3.0f - 2.0f * X); }
[[nodiscard]] float EaseOutCubic(float X) noexcept { const float Y = 1.0f - X; return 1.0f - Y * Y * Y; }
[[nodiscard]] DisplayColour WithAlpha(DisplayColour Colour, float Alpha) noexcept
{
    Colour.Alpha = static_cast<uint8_t>(std::clamp(Alpha, 0.0f, 1.0f) * 255.0f + 0.5f);
    return Colour;
}
[[nodiscard]] DisplayColour Lighten(DisplayColour Colour, float Towards) noexcept
{
    auto Mix = [&](uint8_t Channel) { return static_cast<uint8_t>(Channel + (255 - Channel) * Towards); };
    return DisplayColour{ Mix(Colour.Red), Mix(Colour.Green), Mix(Colour.Blue), Colour.Alpha };
}
} // namespace

void DisplayStartupSequence::Begin(float DurationSeconds, uint32_t SeedValue, const char* WordmarkText, const char* AccentLiteral) noexcept
{
    Duration = std::max(DurationSeconds, 0.25f);
    Seed     = SeedValue == 0u ? 1u : SeedValue;
    Wordmark = WordmarkText ? WordmarkText : "";
    Accent   = AccentLiteral ? ParseDisplayColour(AccentLiteral) : DisplayColour{ 143u, 209u, 172u, 255u };
    Start    = -1.0;
    Unit     = 0.0f;
    Running  = true;
}

bool DisplayStartupSequence::Advance(double Seconds) noexcept
{
    if (!Running) return false;
    if (Start < 0.0) Start = Seconds;
    Unit = static_cast<float>(std::clamp((Seconds - Start) / Duration, 0.0, 1.0));
    if (Unit >= 1.0f) { Running = false; return true; }   // one last frame: the veil is gone, the screen is itself
    return true;
}

float DisplayStartupSequence::VeilOpacity() const noexcept
{
    if (!Running) return 0.0f;
    return 1.0f - Smooth(Ramp(Unit, kLiftStart, kLiftSpan));
}

void DisplayStartupSequence::Compose(DisplayRasterProjection& Raster, float Width, float Height) const noexcept
{
    if (!Running) return;
    const float Veil = VeilOpacity();
    if (Veil <= 0.0f) return;
    Raster.Veil(Veil);

    // Everything the sequence draws fades with the veil, so the lift reveals the screen through the ring.
    const float Presence = Veil;
    const float CentreX  = Width * 0.5f, CentreY = Height * 0.46f;
    const float Radius   = std::min(Width, Height) * 0.17f;
    const float Stroke   = std::max(2.0f, Radius * 0.055f);

    // A faint radial bloom behind the ring, growing with the gather.
    const float Gather = Ramp(Unit, kGatherStart, kGatherSpan);
    if (Gather > 0.0f)
        Raster.FillCircle(CentreX, CentreY, Radius * 2.4f,
                          DisplayPaint::Radial(CentreX, CentreY, 0.0f, Radius * 2.4f,
                                               WithAlpha(Accent, 0.16f * Gather * Presence), WithAlpha(Accent, 0.0f)));

    // Particles: each leaves a scattered seat, swirls about the centre and settles on its seat of the ring.
    for (uint32_t Index = 0u; Index < kParticleCount; ++Index)
    {
        const float Delay  = Unit01(Seed, Index, 0u) * 0.28f;
        const float Local  = EaseOutCubic(Ramp(Unit, kGatherStart + Delay, kGatherSpan - 0.28f + Delay * 0.5f));
        const float Angle  = (static_cast<float>(Index) / kParticleCount) * 2.0f * kPi + Unit01(Seed, Index, 1u) * 0.04f;
        const float Spread = 0.55f + Unit01(Seed, Index, 2u) * 0.9f;              // scatter radius in ring radii
        const float Swirl  = (Unit01(Seed, Index, 3u) - 0.5f) * 2.6f;              // extra turn on the way in
        const float Theta  = Angle + Swirl * (1.0f - Local);
        const float Reach  = Radius * (1.0f + (Spread * 2.6f) * (1.0f - Local));
        const float X      = CentreX + std::cos(Theta) * Reach;
        const float Y      = CentreY + std::sin(Theta) * Reach * std::min(1.0f, Height / std::max(Width, 1.0f) * 1.6f);
        // Settled particles dim as the ring stroke takes over their seat.
        const float Settle = Ramp(Unit, kRingStart + 0.05f, kRingSpan);
        const float Alpha  = Presence * (0.25f + 0.75f * Local) * (1.0f - 0.85f * Settle * Local);
        if (Alpha <= 0.01f) continue;
        const float Size   = (0.9f + Unit01(Seed, Index, 4u) * 1.6f) * Stroke * 0.5f * (1.0f + 0.6f * (1.0f - Local));
        // A short tail along the motion, so the swarm reads as moving rather than twinkling.
        const float PreviousLocal = EaseOutCubic(Ramp(Unit - 0.025f, kGatherStart + Delay, kGatherSpan - 0.28f + Delay * 0.5f));
        const float PreviousTheta = Angle + Swirl * (1.0f - PreviousLocal);
        const float PreviousReach = Radius * (1.0f + (Spread * 2.6f) * (1.0f - PreviousLocal));
        const float PX = CentreX + std::cos(PreviousTheta) * PreviousReach;
        const float PY = CentreY + std::sin(PreviousTheta) * PreviousReach * std::min(1.0f, Height / std::max(Width, 1.0f) * 1.6f);
        const DisplayColour Tint = Lighten(Accent, 0.35f * Unit01(Seed, Index, 5u));
        if (Local < 0.999f) Raster.StrokeLine(PX, PY, X, Y, Size * 0.9f, WithAlpha(Tint, Alpha * 0.45f));
        Raster.FillCircle(X, Y, Size, WithAlpha(Tint, Alpha));
    }

    // The ring closes clockwise from the top; a brighter head leads the stroke.
    const float Ring = Smooth(Ramp(Unit, kRingStart, kRingSpan));
    if (Ring > 0.0f)
    {
        const float Sweep = 2.0f * kPi * Ring;
        Raster.StrokeArc(CentreX, CentreY, Radius, -kPi * 0.5f, Sweep, Stroke, WithAlpha(Accent, 0.9f * Presence));
        if (Ring < 1.0f)
        {
            const float HeadAngle = -kPi * 0.5f + Sweep;
            Raster.FillCircle(CentreX + std::cos(HeadAngle) * Radius, CentreY + std::sin(HeadAngle) * Radius, Stroke * 1.4f,
                              WithAlpha(Lighten(Accent, 0.6f), Presence));
        }
    }

    // The wordmark beneath the ring, light face, letter-spaced by hand.
    const float Word = Smooth(Ramp(Unit, kWordStart, kWordSpan));
    if (Word > 0.0f && !Wordmark.empty())
    {
        const float Size    = std::max(10.0f, Radius * 0.42f);
        const float Spacing = Size * 0.22f;
        float Advance = 0.0f;
        for (char Glyph : Wordmark) { const char One[2] = { Glyph, 0 }; Advance += Raster.MeasureText(One, Size, DisplayTextWeight::Light) + Spacing; }
        Advance -= Spacing;
        float Pen = CentreX - Advance * 0.5f + (1.0f - Word) * Size * 0.3f;
        const float Down = CentreY + Radius * 1.75f;
        for (char Glyph : Wordmark)
        {
            const char One[2] = { Glyph, 0 };
            Pen += Raster.Text(One, Pen, Down, Size, WithAlpha(DisplayColour{ 242u, 246u, 239u, 255u }, Word * Presence),
                               DisplayTextAlignment::Left, DisplayTextWeight::Light) + Spacing;
        }
    }
}

} // namespace Frontier
