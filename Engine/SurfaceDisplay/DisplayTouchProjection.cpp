//============================================================================================================================================
//                                                      DISPLAYTOUCHPROJECTION.CPP
//============================================================================================================================================
// 🧩 Plane intersection and the contact state machine.

#include "DisplayTouchProjection.h"

#include <algorithm>
#include <cmath>

namespace Frontier {

DisplayContact DisplayTouchProjection::Resolve(const float RayOrigin[3], const float RayDirection[3], const DisplayPose& Pose,
                                               const DisplaySurfaceStructure& Surface) noexcept
{
    DisplayContact Contact;
    const float Denominator = RayDirection[0] * Pose.Normal[0] + RayDirection[1] * Pose.Normal[1] + RayDirection[2] * Pose.Normal[2];
    if (Denominator >= -1.0e-6f) return Contact;   // parallel, or approaching from behind the glass
    const float Delta[3] = { Pose.Origin[0] - RayOrigin[0], Pose.Origin[1] - RayOrigin[1], Pose.Origin[2] - RayOrigin[2] };
    const float T = (Delta[0] * Pose.Normal[0] + Delta[1] * Pose.Normal[1] + Delta[2] * Pose.Normal[2]) / Denominator;
    if (T <= 0.0f) return Contact;
    const float Hit[3] = { RayOrigin[0] + RayDirection[0] * T - Pose.Origin[0], RayOrigin[1] + RayDirection[1] * T - Pose.Origin[1], RayOrigin[2] + RayDirection[2] * T - Pose.Origin[2] };
    const float LocalX = Hit[0] * Pose.Right[0] + Hit[1] * Pose.Right[1] + Hit[2] * Pose.Right[2];
    const float LocalY = Hit[0] * Pose.Up[0] + Hit[1] * Pose.Up[1] + Hit[2] * Pose.Up[2];
    if (!Surface.Encloses(LocalX, LocalY)) return Contact;
    const DisplaySpecification& S = Surface.QuerySpecification();
    Contact.Hit = true;
    Contact.Distance = T;
    Contact.Across = (0.5f + LocalX / S.Width) * Surface.QuerySheetWidth();
    Contact.Down = (0.5f - LocalY / S.Height) * Surface.QuerySheetHeight();
    return Contact;
}

DisplayTouchReading DisplayTouchProjection::Advance(const DisplayContact& Contact, bool Pressed, float Seconds) noexcept
{
    DisplayTouchReading Reading;
    Reading.Across = Contact.Across; Reading.Down = Contact.Down;
    Reading.StartAcross = StartAcross; Reading.StartDown = StartDown;
    Reading.Moved = MovedSinceDown;
    const float Interval = std::max(1.0e-3f, Seconds - PreviousSeconds);

    if (!Holding)
    {
        if (Pressed && Contact.Hit)
        {
            Holding = true; MovedSinceDown = false; LongPressDelivered = false;
            StartAcross = PreviousAcross = Contact.Across; StartDown = PreviousDown = Contact.Down;
            DownSeconds = PreviousSeconds = Seconds;
            VelocityAcross = VelocityDown = 0.0f;
            Reading.Phase = DisplayTouchPhase::Down;
            Reading.StartAcross = StartAcross; Reading.StartDown = StartDown;
        }
        else Reading.Phase = Contact.Hit ? DisplayTouchPhase::Hover : DisplayTouchPhase::None;
        PreviousSeconds = Seconds;
        return Reading;
    }

    // Holding. Losing the surface while pressed keeps the gesture alive (a finger sliding past the bezel still scrolls);
    //    only a release ends it, and a release off-glass is a cancel rather than a tap.
    if (Contact.Hit)
    {
        const float DX = Contact.Across - PreviousAcross, DY = Contact.Down - PreviousDown;
        // Exponential velocity filter, the usual VelocityTracker flavour.
        const float Blend = 0.6f;
        VelocityAcross = VelocityAcross * (1.0f - Blend) + (DX / Interval) * Blend;
        VelocityDown = VelocityDown * (1.0f - Blend) + (DY / Interval) * Blend;
        PreviousAcross = Contact.Across; PreviousDown = Contact.Down;
        const float FromStart = std::hypot(Contact.Across - StartAcross, Contact.Down - StartDown);
        if (FromStart > Settings.SlopPixels) MovedSinceDown = true;
    }
    Reading.Moved = MovedSinceDown;
    Reading.VelocityAcross = VelocityAcross; Reading.VelocityDown = VelocityDown;

    if (!Pressed)
    {
        Holding = false;
        Reading.Phase = Contact.Hit ? DisplayTouchPhase::Up : DisplayTouchPhase::Cancel;
        Reading.Fling = MovedSinceDown && std::hypot(VelocityAcross, VelocityDown) >= Settings.FlingVelocity;
        PreviousSeconds = Seconds;
        return Reading;
    }
    if (!MovedSinceDown && !LongPressDelivered && Seconds - DownSeconds >= Settings.HoldSeconds)
    {
        LongPressDelivered = true;
        Reading.Phase = DisplayTouchPhase::LongPress;
    }
    else Reading.Phase = DisplayTouchPhase::Move;
    PreviousSeconds = Seconds;
    return Reading;
}

} // namespace Frontier
