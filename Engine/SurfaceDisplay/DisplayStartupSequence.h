//============================================================================================================================================
//                                                      DISPLAYSTARTUPSEQUENCE.H
//============================================================================================================================================
// 🧩 The power-on sequence of any display surface: a dark glass, a swarm of particles that gather into a ring, a
//    wordmark, then the veil lifts off whatever the screen was about to show. Generic — a tablet, a cluster or a
//    wall panel run the same sequence at their own duration and seed; the screen sequences compose it over their
//    finished raster while it is active and keep themselves dirty until it has ended.
//
//    Everything is deterministic in (seed, time): the same frame of the sequence rasters identically on the CPU
//    mirror and in the code image, which is what the proofs assert on.

#pragma once

#include "DisplayRasterProjection.h"

#include <cstdint>
#include <string>

namespace Frontier
{

class DisplayStartupSequence
{
public:
    // Arm the sequence; it starts on the first Advance. Wordmark may be null (ring only).
    void Begin(float DurationSeconds, uint32_t Seed, const char* Wordmark, const char* AccentLiteral = "#8fd1ac") noexcept;
    // Clock the sequence with the display's time base [s]. Returns true while frames are still changing.
    bool Advance(double Seconds) noexcept;
    [[nodiscard]] bool  Active()   const noexcept { return Running; }
    [[nodiscard]] float Progress() const noexcept { return Running ? Unit : 1.0f; }   // [0,1]
    void Cancel() noexcept { Running = false; }

    // Draws over an already-rastered sheet, in the projection's design units (Width x Height is the panel).
    void Compose(DisplayRasterProjection& Raster, float Width, float Height) const noexcept;

    // The veil opacity at the current progress (1 = black glass, 0 = screen fully revealed); exposed for proofs.
    [[nodiscard]] float VeilOpacity() const noexcept;

private:
    bool        Running  = false;
    float       Duration = 2.6f;
    double      Start    = -1.0;
    float       Unit     = 0.0f;
    uint32_t    Seed     = 1u;
    std::string Wordmark;
    DisplayColour Accent{ 143u, 209u, 172u, 255u };
};

} // namespace Frontier
