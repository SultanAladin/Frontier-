//============================================================================================================================================
//                                                      DISPLAYTOUCHPROJECTION.H
//============================================================================================================================================
// 🧩 Pointer ray → display pixel, and the phone-style gesture reading on top of it. The host hands the project a
//    world ray each cycle (camera + cursor); this projection intersects the display plane, rejects points outside the
//    housing outline, converts to sheet pixels, and runs the Android/iPhone contact rules: a press that stays within
//    the slop radius is a tap on release, a press that moves is a drag (scroll/slider/orbit), a fast release after a
//    drag is a fling with a velocity, and a press held past the hold time without moving is a long press.
//
//    Pure arithmetic; nothing here knows what a tile or slider is. The screen sequence owns that meaning.

#pragma once

#include "DisplaySurfaceStructure.h"

#include <cstdint>

namespace Frontier {

struct DisplayPose
{
    float Origin[3] = { 0.0f, 0.0f, 0.0f };   // [m] display centre, world
    float Right[3]  = { 1.0f, 0.0f, 0.0f };   // [-] local +X, unit
    float Up[3]     = { 0.0f, 0.0f, 1.0f };   // [-] local +Y, unit
    float Normal[3] = { 0.0f, -1.0f, 0.0f };  // [-] local +Z (toward the viewer), unit
};

struct DisplayContact
{
    bool  Hit = false;         // [-]  the ray meets the glass inside the outline, from the front
    float Across = 0.0f;       // [px] sheet pixel X (0 at the left edge)
    float Down = 0.0f;         // [px] sheet pixel Y (0 at the top edge)
    float Distance = 0.0f;     // [m]  along the ray
};

enum class DisplayTouchPhase : uint32_t { None = 0u, Hover = 1u, Down = 2u, Move = 3u, Up = 4u, Cancel = 5u, LongPress = 6u };

struct DisplayTouchReading
{
    DisplayTouchPhase Phase = DisplayTouchPhase::None;
    float             Across = 0.0f, Down = 0.0f;          // [px] current contact
    float             StartAcross = 0.0f, StartDown = 0.0f; // [px] where the press began
    float             VelocityAcross = 0.0f, VelocityDown = 0.0f;   // [px/s] on Up (fling when above the threshold)
    bool              Moved = false;                        // [-]  exceeded the slop radius since Down
    bool              Fling = false;                        // [-]  Up with |velocity| above FlingVelocity
};

struct DisplayTouchConfiguration
{
    float SlopPixels = 12.0f;        // [px]  Android touch slop ≈ 8 dp; scaled for the sheet density
    float HoldSeconds = 0.5f;        // [s]   long-press delay
    float FlingVelocity = 600.0f;    // [px/s]
};

class DisplayTouchProjection
{
public:
    // Ray–plane intersection in the display's local frame; sheet pixels out.
    [[nodiscard]] static DisplayContact Resolve(const float RayOrigin[3], const float RayDirection[3], const DisplayPose& Pose,
                                                const DisplaySurfaceStructure& Surface) noexcept;

    void Configure(const DisplayTouchConfiguration& Configuration) noexcept { Settings = Configuration; }
    // One cycle: the contact for this display (Hit false when the ray misses), the primary button and the clock.
    [[nodiscard]] DisplayTouchReading Advance(const DisplayContact& Contact, bool Pressed, float Seconds) noexcept;
    [[nodiscard]] bool Active() const noexcept { return Holding; }

private:
    DisplayTouchConfiguration Settings;
    bool  Holding = false, MovedSinceDown = false, LongPressDelivered = false;
    float StartAcross = 0.0f, StartDown = 0.0f, PreviousAcross = 0.0f, PreviousDown = 0.0f;
    float DownSeconds = 0.0f, PreviousSeconds = 0.0f;
    float VelocityAcross = 0.0f, VelocityDown = 0.0f;
};

} // namespace Frontier
