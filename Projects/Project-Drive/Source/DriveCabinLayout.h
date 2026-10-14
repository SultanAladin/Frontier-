//============================================================================================================================================
//                                                           DRIVECABINLAYOUT.H
//============================================================================================================================================
// 📦 Where the cabin HMI sits in the ControlVehicle. The .blend carries no dashboard, steering or screen sockets
//    (only axle/strut mounts and two camera rigs), so the placement is ESTIMATED from the authored shell:
//
//        cowl (windscreen base, centreline)   X +1.335  Z +0.735   (model frame, origin ≈ hub height)
//        windscreen top                        X +0.529  Z +1.322
//        roof                                  Z +1.35
//        shell half-width at the cowl          1.25
//
//    A GT coupé dash top sits just under the cowl line and runs ~0.35 m aft of it; the driver (left-hand drive,
//    +Y is left) sits ~0.42 m off the centreline. Hence: cluster ahead of the driver, over the dash, tilted back;
//    tablet on the centre stack, lower and more reclined; one cabin lamp in the headliner. Everything is in the
//    MODEL frame here; the scene author and the display host both rebase onto the CoM the same way the body is.
//
//    Replace these with real sockets when the model grows them — nothing else needs to change.

#pragma once

#include "../../../Engine/SurfaceDisplay/DisplaySurfaceStructure.h"

#include <cmath>

namespace Frontier {
namespace Drive {

struct CabinFixture
{
    const char* Name;            // material / subject name the sheet binds to
    float       Centre[3];       // [m]   model frame
    float       Tilt;            // [rad] top of the screen leaning away from the driver (+X)
    DisplaySpecification Screen;
};

// Vehicle-local basis for a screen facing the driver (−X), tilted back by Tilt about its horizontal axis.
//    Right = the viewer's right (−Y), Up, Toward (the viewer) — the same frame DisplaySurfaceStructure builds in.
inline void CabinScreenBasis(float Tilt, float Right[3], float Up[3], float Toward[3]) noexcept
{
    Right[0] = 0.0f; Right[1] = -1.0f; Right[2] = 0.0f;
    Up[0] = std::sin(Tilt); Up[1] = 0.0f; Up[2] = std::cos(Tilt);
    Toward[0] = -std::cos(Tilt); Toward[1] = 0.0f; Toward[2] = std::sin(Tilt);
}

inline CabinFixture CabinTabletFixture() noexcept
{
    CabinFixture F{ "Display:CabinTablet", { +0.98f, 0.0f, +0.62f }, 0.42f, {} };
    F.Screen.Outline = DisplayOutlineCategory::Rectangle;
    F.Screen.Width = 0.30f; F.Screen.Height = 0.19f; F.Screen.CornerRadius = 0.012f; F.Screen.BezelMargin = 0.012f;
    // Screen white, in the scene's radiance units where sunlit white ground is ≈ 5: a bright automotive panel
    //    (≈ 800 nits against ≈ 25 000 for sunlit white) is a fraction of that. 24 clipped the whole sheet to white
    //    on the live capture (Exhibits/Gallery/ProjectDrive/live/sdf-gi-cockpit.png); 3 keeps the UI's blacks
    //    black and the whites below the display transfer's shoulder in the shaded cabin.
    F.Screen.EmissionLuminance = 3.0f;
    return F;
}

inline CabinFixture CabinClusterFixture(DisplayOutlineCategory Outline = DisplayOutlineCategory::Hexagon) noexcept
{
    CabinFixture F{ "Display:DriverCluster", { +0.86f, +0.42f, +0.92f }, 0.14f, {} };
    F.Screen.Outline = Outline;
    switch (Outline)
    {
    case DisplayOutlineCategory::CutCircle: F.Screen.Width = 0.26f; F.Screen.Height = 0.26f; break;
    case DisplayOutlineCategory::Trapezoid: F.Screen.Width = 0.36f; F.Screen.Height = 0.17f; break;
    case DisplayOutlineCategory::Pill:      F.Screen.Width = 0.40f; F.Screen.Height = 0.13f; break;
    default:                                F.Screen.Width = 0.34f; F.Screen.Height = 0.19f; break;
    }
    F.Screen.CornerRadius = 0.02f; F.Screen.BezelMargin = 0.010f;
    F.Screen.EmissionLuminance = 3.5f;   // cluster: a touch brighter than the tablet (see CabinTabletFixture)
    return F;
}

// The driver's eye, model frame: left-hand seat (the cluster sits at +0.42), a hand behind the cluster, eye height
//    between the 0.89 m scuttle and the 1.35 m roof of the authored shell. The cockpit camera sits here, looking
//    forward and PitchDown so the cluster (≈ 11° below the eye) and the tablet (≈ 23° below, to the right) both
//    fall inside a 70° vertical view; the pointer ray from that eye is the finger on the glass.
struct CabinDriverEye { float Position[3]; float PitchDown; float VerticalFieldOfView; };
inline CabinDriverEye CabinDriverEyeFixture() noexcept { return { { -0.20f, +0.42f, +1.12f }, 0.21f, 1.22f }; }

// The headliner lamp: a small downward disc behind the windscreen header. Luminance is the emitter's own nits.
struct CabinLamp { float Centre[3]; float Radius; float Luminance; };
inline CabinLamp CabinLampFixture() noexcept { return { { +0.15f, 0.0f, +1.30f }, 0.045f, 40.0f }; }

} // namespace Drive
} // namespace Frontier
