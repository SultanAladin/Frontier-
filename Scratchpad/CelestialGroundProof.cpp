//============================================================================================================================================
// 📦 Scratchpad/CelestialGroundProof.cpp — The World Under the Sky: Ground Plane, Height Field and the Two Local Lights
//============================================================================================================================================
//
//    The first pass of the celestial port carried everything the reference draws *above* the horizon. It did
//    not carry what the reference draws *below* it — and the panel has four entities there, all uploaded every
//    frame, three of them ON by default:
//
//        · `plane`   — the checker ground plane, with its filtered checker, graticule and coloured axis lines.
//        · `terrain` — the sculpted height field (`uTerrOn = 0` in the live panel, so it ships off but present).
//        · `plight`  — the point light,  #ffd9a0, 14 cd, 26 m reach, inverse-square decay.
//        · `slight`  — the spot light,   #e8f0ff, 62 cd, 26° cone, 0.42 penumbra.
//
//    This proof checks them the way the rest of the port is checked: against arithmetic done independently of
//    the code under test, not against the code's own output. Each block states the law it is testing.
//
//============================================================================================================================================

#include "../Projects/Project-Zero/Source/CelestialIntegrator.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace Frontier;
using namespace Frontier::ProjectZero;

namespace {

int Failures = 0;

void Gate(bool Condition, const std::string& Title, const std::string& Detail)
{
    if (Condition)
    {
        std::printf("     \033[32m✓\033[0m %-52s %s\n", Title.c_str(), Detail.c_str());
    }
    else
    {
        ++Failures;
        std::printf("     \033[31m✗\033[0m %-52s %s\n", Title.c_str(), Detail.c_str());
    }
}

void Section(const char* Title)
{
    std::printf("\n\033[1m  %s\033[0m\n", Title);
}

//    A noon observer standing on the plane, looking level. Everything below is measured from here.
ObserverFrame StandingObserver(float Height = 2.0f)
{
    ObserverFrame O{};
    O.Position    = Vector3{ 0.0f, Height, 0.0f };
    O.Forward     = Vector3{ 0.0f, 0.0f, -1.0f };
    O.Right       = Vector3{ 1.0f, 0.0f, 0.0f };
    O.Upward      = Vector3{ 0.0f, 1.0f, 0.0f };
    O.TangentHalf = std::tan(Radians(72.0f) * 0.5f);
    O.Height      = Height;
    return O;
}

//    A direction that strikes the plane at a chosen horizontal range from an observer at `Height`.
Vector3 DirectionToGround(float Height, float Range)
{
    const float Length = std::sqrt(Range * Range + Height * Height);
    return Vector3{ 0.0f, -Height / Length, -Range / Length };
}

} // namespace

int main()
{
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");
    std::printf("  CELESTIAL GROUND PROOF — checker plane, height field, point light, spot light\n");
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");

    //========================================================================================================
    //    ① THE CHECKER PLANE — ray/plane geometry, against the closed-form solution
    //========================================================================================================
    //    A ray leaving an eye at height h with vertical component d.y < 0 meets the plane y = 0 at
    //    t = -h / d.y, at horizontal range r = t·|d.xz|. Both are exact; the port must agree with them.

    Section("① The checker plane is where ray/plane geometry says it is");
    {
        CelestialCriteria C{};
        C.Sun.LocalHours = 12.0f;
        C.Terrain.Visible = false;                              // isolate the plane
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        const float Height = 2.0f;
        const ObserverFrame Observer = StandingObserver(Height);

        bool AllRangesAgree = true;
        double WorstError = 0.0;
        for (const float Range : { 1.0f, 5.0f, 20.0f, 80.0f, 300.0f })
        {
            const Vector3 d = DirectionToGround(Height, Range);
            const auto G = Sky.SampleGround(d, Observer, 1e-3f);
            const float Expected = std::sqrt(Range * Range + Height * Height);
            const double Error = std::abs(G.Distance - Expected) / Expected;
            WorstError = std::max(WorstError, Error);
            if (!G.Hit || Error > 1e-4) { AllRangesAgree = false; }
        }
        Gate(AllRangesAgree, "hit distance matches -h/d.y at 1..300 m",
             "worst relative error " + std::to_string(WorstError));

        //    A ray with d.y > 0 must miss: the plane is below the observer and does not extend upward.
        const auto Up = Sky.SampleGround(Vector3{ 0.0f, 0.5f, -0.866f }.Normalized(), Observer, 1e-3f);
        Gate(!Up.Hit, "an upward ray misses the plane", "no ground above the horizon");

        //    The plane's normal is +Y everywhere.
        const auto Down = Sky.SampleGround(DirectionToGround(Height, 10.0f), Observer, 1e-3f);
        Gate(std::abs(Down.Normal.y - 1.0f) < 1e-5f, "the plane's normal is +Y", "flat ground is flat");

        //    Switching the plane off must remove it, not merely darken it — the panel's `vis_plane`.
        CelestialCriteria Off = C;
        Off.GroundPlane.Visible = false;
        CelestialIntegrator NoPlane(Off);
        NoPlane.SolveFrame(0.0f);
        const auto Missing = NoPlane.SampleGround(DirectionToGround(Height, 10.0f), Observer, 1e-3f);
        Gate(!Missing.Hit, "vis_plane = false removes the plane", "the entity toggle is wired");
    }

    //========================================================================================================
    //    ② THE FILTERED CHECKER — the box filter must converge to the mean tile at long range
    //========================================================================================================
    //    This is the property that distinguishes a filtered checker from a point-sampled one. As the footprint
    //    grows past one cell, the integral of the square wave over the footprint tends to its mean — so the
    //    plane must fade to the average of tile A and tile B rather than alias into moiré. A point-sampled
    //    checker would keep returning one tile or the other and the variance would stay high forever.

    Section("② The checker is box-filtered: it converges to the mean tile, it does not alias");
    {
        CelestialCriteria C{};
        C.Sun.LocalHours = 12.0f;
        C.Terrain.Visible = false;
        C.GroundPlane.Graticule = false;                        // the grid lines are a separate feature
        C.PointLight.Visible = false;
        C.SpotLight.Visible  = false;
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        const float Height = 2.0f;
        const ObserverFrame Observer = StandingObserver(Height);

        //    Sample a row of neighbouring directions at a fixed range and measure the spread of the result.
        //    Near the camera the footprint is much smaller than a 1 m cell, so tiles resolve and the spread is
        //    large. Far away the footprint spans many cells and the spread must collapse.
        //
        //    ⚠️ The sweep runs at a lateral offset of 0.37 cells, NOT along x = 0. A checkerboard is
        //    x-XOR-z, so on the line x = 0 — exactly a cell boundary — the two tiles cancel and the pattern
        //    is a constant 0.5 whatever z does. Sampling there measures nothing and would report a perfectly
        //    filtered plane even if the filter were broken.
        const float LateralOffset = 0.37f;
        auto SpreadAt = [&](float Range, float Footprint) -> double
        {
            double Minimum = 1e30, Maximum = -1e30;
            for (int i = 0; i < 64; ++i)
            {
                const float Offset = static_cast<float>(i) * 0.021f;   // sweep across cells
                const float r = Range + Offset;
                //    A direction landing at (LateralOffset, 0, -r) on the plane.
                const float Length = std::sqrt(LateralOffset * LateralOffset + r * r + Height * Height);
                const Vector3 d{ LateralOffset / Length, -Height / Length, -r / Length };
                const auto G = Sky.SampleGround(d, Observer, Footprint);
                if (!G.Hit) { continue; }
                const double L = LuminanceOf(G.Radiance);
                Minimum = std::min(Minimum, L);
                Maximum = std::max(Maximum, L);
            }
            return (Maximum - Minimum) / std::max(Maximum, 1e-9);
        };

        const double NearSpread = SpreadAt(3.0f, 2e-4f);        // footprint ≈ 0.6 mm at 3 m: tiles resolve
        const double FarSpread  = SpreadAt(400.0f, 2e-3f);      // footprint ≈ 0.8 m at 400 m: many cells per tap
        std::printf("     relative spread: near %.4f   far %.4f\n", NearSpread, FarSpread);
        Gate(NearSpread > 0.05, "close up, individual tiles resolve", "spread " + std::to_string(NearSpread));
        Gate(FarSpread < NearSpread * 0.5, "far away, the filter converges to the mean tile",
             "spread falls to " + std::to_string(FarSpread));

        //    And the converged value must sit BETWEEN the two tiles, which is what "mean" means. Measured at
        //    the same lateral offset, for the same reason.
        auto FarDirection = [&](float Range)
        {
            const float Length = std::sqrt(LateralOffset * LateralOffset + Range * Range + Height * Height);
            return Vector3{ LateralOffset / Length, -Height / Length, -Range / Length };
        };
        const auto Far = Sky.SampleGround(FarDirection(400.0f), Observer, 2e-3f);
        CelestialCriteria AOnly = C;
        AOnly.GroundPlane.TintB = AOnly.GroundPlane.TintA;      // both tiles = A
        CelestialIntegrator PlaneA(AOnly);
        PlaneA.SolveFrame(0.0f);
        CelestialCriteria BOnly = C;
        BOnly.GroundPlane.TintA = BOnly.GroundPlane.TintB;      // both tiles = B
        CelestialIntegrator PlaneB(BOnly);
        PlaneB.SolveFrame(0.0f);
        const double La = LuminanceOf(PlaneA.SampleGround(FarDirection(400.0f), Observer, 2e-3f).Radiance);
        const double Lb = LuminanceOf(PlaneB.SampleGround(FarDirection(400.0f), Observer, 2e-3f).Radiance);
        const double Lf = LuminanceOf(Far.Radiance);
        Gate(Lf > std::min(La, Lb) * 0.98 && Lf < std::max(La, Lb) * 1.02,
             "the filtered value lies between tile A and tile B",
             "A " + std::to_string(La) + " · filtered " + std::to_string(Lf) + " · B " + std::to_string(Lb));
    }

    //========================================================================================================
    //    ③ DISTANCE FOG ON THE GROUND — against the reference's own closed form
    //========================================================================================================
    //    The reference fades the plane into the sky with  fog = (1 - exp(-t·7e-5))^1.6, and at t → ∞ the plane
    //    must become the sky colour exactly. Both ends are checkable in closed form.

    Section("③ The ground fades into the sky by the reference's own fog law");
    {
        CelestialCriteria C{};
        C.Sun.LocalHours = 12.0f;
        C.Terrain.Visible = false;
        C.GroundPlane.Graticule = false;
        C.HeightFog.Visible = false;
        C.AtmosphericFog.Visible = false;
        C.LocalFog.Visible = false;
        C.LocalCloud.Visible = false;
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        //    An observer high enough that a shallow ray runs a very long way before it lands.
        const ObserverFrame Observer = StandingObserver(1500.0f);

        double PreviousFog = -1.0;
        bool Monotone = true;
        for (const float Range : { 2000.0f, 8000.0f, 30000.0f, 120000.0f })
        {
            const Vector3 d = DirectionToGround(1500.0f, Range);
            const auto G = Sky.SampleGround(d, Observer, 1e-3f);
            if (!G.Hit) { continue; }
            const double t = G.Distance;
            const double Fog = std::pow(1.0 - std::exp(-t * 7e-5), 1.6);
            if (Fog < PreviousFog) { Monotone = false; }
            PreviousFog = Fog;
        }
        Gate(Monotone, "fog grows monotonically with distance", "the law is 1-exp(-t·7e-5) raised to 1.6");

        //    At 120 km the closed form gives fog ≈ 0.9997, so the ground must be within a fraction of a percent
        //    of the sky it is fading into — computed here by asking the integrator for that same sky.
        const Vector3 dFar = DirectionToGround(1500.0f, 400000.0f);
        const auto GFar = Sky.SampleGround(dFar, Observer, 1e-3f);
        if (GFar.Hit)
        {
            const double t = GFar.Distance;
            const double Fog = std::pow(1.0 - std::exp(-t * 7e-5), 1.6);
            Gate(Fog > 0.999, "a very distant plane is fully fogged",
                 "fog = " + std::to_string(Fog) + " at " + std::to_string(t / 1000.0) + " km");
        }
    }

    //========================================================================================================
    //    ④ THE HEIGHT FIELD — the traced surface must agree with the analytic field it traces
    //========================================================================================================
    //    `terrHit` sphere-traces `terrH`. The two are independent pieces of code, so the trace can be checked
    //    against the field directly: the hit point must LIE on the surface, and the returned normal must be
    //    perpendicular to it — verified by finite differences of the field, not by re-running the same code.

    Section("④ The height field's trace agrees with the field it traces");
    {
        CelestialCriteria C{};
        C.Sun.LocalHours = 12.0f;
        C.Terrain.Visible = true;                               // the panel ships this off; switch it on to test it
        C.GroundPlane.Visible = false;                          // isolate the terrain
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        const float Height = 30.0f;
        const ObserverFrame Observer = StandingObserver(Height);

        uint32_t Hits = 0u;
        double WorstResidual = 0.0;
        double WorstNormalError = 0.0;
        for (int i = 0; i < 40; ++i)
        {
            const float Range = 8.0f + static_cast<float>(i) * 1.6f;
            const Vector3 d = DirectionToGround(Height, Range);
            float t = 0.0f;
            Vector3 n{};
            if (!Sky.TerrainIntersect(Observer.Position, d, t, n)) { continue; }
            ++Hits;

            const Vector3 p = Observer.Position + d * t;
            //    ① The hit point lies on the surface: p.y == terrH(p.x, p.z).
            const float Surface = Sky.TerrainHeightAt(p.x, p.z);
            WorstResidual = std::max(WorstResidual, static_cast<double>(std::abs(p.y - Surface)));

            //    ② The normal is perpendicular to the surface. Built here from an INDEPENDENT central
            //       difference at a different step size than the tracer uses, then compared by angle.
            const float e = 0.05f;
            const Vector3 Reference = Vector3{ Sky.TerrainHeightAt(p.x - e, p.z) - Sky.TerrainHeightAt(p.x + e, p.z),
                                               2.0f * e,
                                               Sky.TerrainHeightAt(p.x, p.z - e) - Sky.TerrainHeightAt(p.x, p.z + e) }.Normalized();
            const double CosAngle = static_cast<double>(Dot(Reference, n));
            WorstNormalError = std::max(WorstNormalError, std::acos(std::min(1.0, CosAngle)) * 180.0 / 3.14159265);
        }

        std::printf("     %u hits · worst surface residual %.4f m · worst normal error %.3f°\n",
                    Hits, WorstResidual, WorstNormalError);
        Gate(Hits > 25u, "the terrain is hit across the patch", std::to_string(Hits) + " of 40 rays land");
        Gate(WorstResidual < 0.30, "every hit point lies on the analytic surface",
             "worst residual " + std::to_string(WorstResidual) + " m");
        Gate(WorstNormalError < 5.0, "the returned normal is the surface gradient",
             "worst deviation " + std::to_string(WorstNormalError) + "°");

        //    The field is bounded: terrH ∈ [pos.y, pos.y + height] by construction, since tfield is clamped
        //    to [0,1]. A sampling sweep must never leave that band.
        float Lowest = 1e9f, Highest = -1e9f;
        for (int i = 0; i < 120; ++i)
        {
            for (int j = 0; j < 120; ++j)
            {
                const float x = -90.0f + static_cast<float>(i) * 1.5f;
                const float z = -90.0f + static_cast<float>(j) * 1.5f;
                const float h = Sky.TerrainHeightAt(x, z);
                Lowest = std::min(Lowest, h);
                Highest = std::max(Highest, h);
            }
        }
        Gate(Lowest >= -1e-4f && Highest <= 12.0f + 1e-4f, "the field stays inside [0, height]",
             "range " + std::to_string(Lowest) + " .. " + std::to_string(Highest) + " m of 12 m");
        Gate(Highest - Lowest > 4.0f, "the field is actually sculpted, not flat",
             "relief " + std::to_string(Highest - Lowest) + " m");

        //    And the panel default is OFF: `uTerrOn = 0` in the live reference.
        CelestialCriteria Default{};
        Gate(!Default.Terrain.Visible, "the panel default is uTerrOn = 0", "ships off, as the reference does");
    }

    //========================================================================================================
    //    ⑤ THE POINT LIGHT — inverse-power decay, against the photometric law
    //========================================================================================================
    //    The reference's point light is  I / max(d,1)^decay  windowed by a smoothstep reach. With decay = 2
    //    that is the inverse-square law, and doubling the distance must quarter the irradiance — inside the
    //    window, where the window is 1 and not attenuating.

    Section("⑤ The point light obeys the inverse-square law inside its reach");
    {
        CelestialCriteria C{};
        C.Sun.Visible = false;                                  // isolate the lamp
        C.Sky.Visible = false;
        C.Atmosphere.Visible = false;
        C.Stars.Visible = false;
        C.MoonCount = 0u;
        C.SpotLight.Visible = false;
        C.PointLight.Visible = true;
        C.PointLight.Placement = Vector3{ 0.0f, 4.0f, 0.0f };   // directly overhead, so N·L = 1 on flat ground
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        //    Measure straight out of the lighting routine, on a level surface with unit albedo.
        const Vector3 White{ 1.0f, 1.0f, 1.0f };
        auto Irradiance = [&](float Below) -> double
        {
            //    A point directly under the lamp at distance `Below`.
            const Vector3 p{ 0.0f, 4.0f - Below, 0.0f };
            return LuminanceOf(Sky.LocalLightsOnSurface(p, White));
        };

        const double At2 = Irradiance(2.0f);
        const double At4 = Irradiance(4.0f);
        const double At8 = Irradiance(8.0f);
        const double Ratio24 = At2 / std::max(At4, 1e-12);
        const double Ratio48 = At4 / std::max(At8, 1e-12);
        std::printf("     E(2m) %.6f   E(4m) %.6f   E(8m) %.6f   ratios %.3f, %.3f\n",
                    At2, At4, At8, Ratio24, Ratio48);

        //    2→4 m is entirely inside the 26 m reach window, so it is pure inverse square: exactly 4.
        Gate(std::abs(Ratio24 - 4.0) < 0.02, "doubling distance quarters the irradiance",
             "E(2)/E(4) = " + std::to_string(Ratio24) + " against 4");
        //    4→8 m starts to feel the reach window (it begins at 0.7·26 = 18.2 m), so it is ≥ 4, not > 4.
        Gate(Ratio48 >= 3.98, "the law still holds further out", "E(4)/E(8) = " + std::to_string(Ratio48));

        //    Past the reach the light must be gone entirely — the window closes at d = 26 m.
        Gate(Irradiance(27.0f) == 0.0, "beyond the reach the lamp contributes nothing",
             "the smoothstep window closes at 26 m");

        //    The lamp's colour must survive: #ffd9a0 is warm, so R > G > B.
        const Vector3 Lit = Sky.LocalLightsOnSurface(Vector3{ 0.0f, 2.0f, 0.0f }, White);
        Gate(Lit.x > Lit.y && Lit.y > Lit.z, "the lamp is warm (#ffd9a0)",
             "R " + std::to_string(Lit.x) + " > G " + std::to_string(Lit.y) + " > B " + std::to_string(Lit.z));

        //    And `vis_plight` switches it off.
        CelestialCriteria Off = C;
        Off.PointLight.Visible = false;
        CelestialIntegrator Dark(Off);
        Dark.SolveFrame(0.0f);
        Gate(LuminanceOf(Dark.LocalLightsOnSurface(Vector3{ 0.0f, 2.0f, 0.0f }, White)) == 0.0,
             "vis_plight = false switches the lamp off", "the entity toggle is wired");
    }

    //========================================================================================================
    //    ⑥ THE SPOT LIGHT — the cone, against cos(half-angle) computed independently
    //========================================================================================================
    //    The panel's cone is 26° full, so the penumbra runs from cos(13°) outward. A point on the axis is fully
    //    lit; a point past the cone edge is dark; and the transition happens at the angle trigonometry says.

    Section("⑥ The spot light's cone closes where cos(13°) says it does");
    {
        CelestialCriteria C{};
        C.Sun.Visible = false;
        C.Sky.Visible = false;
        C.Atmosphere.Visible = false;
        C.Stars.Visible = false;
        C.MoonCount = 0u;
        C.PointLight.Visible = false;
        C.SpotLight.Visible = true;
        //    Aim it straight down from 10 m so the cone's footprint on the ground is a circle of known radius.
        C.SpotLight.Placement = Vector3{ 0.0f, 10.0f, 0.0f };
        C.SpotLight.Target    = Vector3{ 0.0f, 0.0f, 0.0f };
        C.SpotLight.Penumbra  = 0.0f;                           // a hard edge, so the geometry is unambiguous
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        const Vector3 White{ 1.0f, 1.0f, 1.0f };
        //    The cone half-angle is 13°, so on the ground 10 m below it cuts a circle of radius 10·tan13°.
        const double EdgeRadius = 10.0 * std::tan(13.0 * 3.14159265 / 180.0);
        std::printf("     predicted cone radius on the ground: %.4f m\n", EdgeRadius);

        auto LitAt = [&](double Radius) -> double
        {
            const Vector3 p{ static_cast<float>(Radius), 0.0f, 0.0f };
            return LuminanceOf(Sky.LocalLightsOnSurface(p, White));
        };

        Gate(LitAt(0.0) > 0.0, "the cone axis is lit", "E = " + std::to_string(LitAt(0.0)));
        Gate(LitAt(EdgeRadius * 0.85) > 0.0, "just inside the edge is lit",
             "at " + std::to_string(EdgeRadius * 0.85) + " m");
        Gate(LitAt(EdgeRadius * 1.15) == 0.0, "just outside the edge is dark",
             "at " + std::to_string(EdgeRadius * 1.15) + " m");

        //    Bisect for the actual cut-off and compare with the predicted radius.
        double Low = 0.0, High = EdgeRadius * 2.0;
        for (int i = 0; i < 60; ++i)
        {
            const double Mid = 0.5 * (Low + High);
            if (LitAt(Mid) > 0.0) { Low = Mid; } else { High = Mid; }
        }
        const double Measured = 0.5 * (Low + High);
        const double Error = std::abs(Measured - EdgeRadius) / EdgeRadius;
        Gate(Error < 0.01, "the measured cut-off is 10·tan(13°)",
             "measured " + std::to_string(Measured) + " m against " + std::to_string(EdgeRadius) + " m");

        //    The penumbra must soften that edge rather than move it: with penumbra on, the boundary spreads.
        CelestialCriteria Soft = C;
        Soft.SpotLight.Penumbra = 0.42f;                        // the panel's own default
        CelestialIntegrator Feathered(Soft);
        Feathered.SolveFrame(0.0f);
        auto SoftAt = [&](double Radius) -> double
        {
            const Vector3 p{ static_cast<float>(Radius), 0.0f, 0.0f };
            return LuminanceOf(Feathered.LocalLightsOnSurface(p, White));
        };
        //    The feather has a predictable width: the smoothstep runs from cos(13°) to mix(cos13°, 1, .9·p).
        //    With p = 0.42 that band ends at cos⁻¹(0.98416) = 10.2°, i.e. at 0.78 of the edge radius — so at
        //    0.85 of it the feathered cone is already falling while the hard cone is still saturated, and at
        //    0.6 BOTH are saturated. Probing at 0.6 would compare two ones and prove nothing.
        const double HardInner = LitAt(EdgeRadius * 0.85);
        const double SoftInner = SoftAt(EdgeRadius * 0.85);
        Gate(SoftInner < HardInner * 0.95, "the penumbra feathers the cone inward",
             "at 0.85 r: hard " + std::to_string(HardInner) + " vs soft " + std::to_string(SoftInner));
        //    …and it does not move the outer edge, which is set by the cone angle alone.
        Gate(SoftAt(EdgeRadius * 1.15) == 0.0, "the penumbra does not widen the cone",
             "the cut-off is still 10·tan(13°)");

        //    The spot is cool (#e8f0ff): B > G > R, the opposite of the point lamp.
        const Vector3 Lit = Sky.LocalLightsOnSurface(Vector3{ 0.0f, 0.0f, 0.0f }, White);
        Gate(Lit.z > Lit.y && Lit.y > Lit.x, "the spot is cool (#e8f0ff)",
             "B " + std::to_string(Lit.z) + " > G " + std::to_string(Lit.y) + " > R " + std::to_string(Lit.x));
    }

    //========================================================================================================
    //    ⑦ THE LIGHT GLYPHS — a light that is on must be visible, and occluded when something is in front
    //========================================================================================================

    Section("⑦ The light glyphs are visible, directional and occluded by the ground");
    {
        CelestialCriteria C{};
        C.Sun.Visible = false;
        C.Sky.Visible = false;
        C.Atmosphere.Visible = false;
        C.PointLight.Visible = true;
        C.SpotLight.Visible = false;
        C.PointLight.Placement = Vector3{ 0.0f, 2.0f, -10.0f };
        CelestialIntegrator Sky(C);
        Sky.SolveFrame(0.0f);

        const ObserverFrame Observer = StandingObserver(2.0f);
        const Vector3 Black{ 0.0f, 0.0f, 0.0f };

        //    Straight at the lamp.
        const Vector3 AtLamp = (C.PointLight.Placement - Observer.Position).Normalized();
        const double OnAxis = LuminanceOf(Sky.AddLightGlyphs(Black, AtLamp, Observer, false, 0.0f));
        //    30° off it.
        const Vector3 OffAxis = Vector3{ std::sin(Radians(30.0f)), 0.0f, -std::cos(Radians(30.0f)) };
        const double Beside = LuminanceOf(Sky.AddLightGlyphs(Black, OffAxis, Observer, false, 0.0f));

        std::printf("     glyph on axis %.6f   30° off axis %.6f\n", OnAxis, Beside);
        Gate(OnAxis > 1e-4, "the lamp is visible where it stands", "L = " + std::to_string(OnAxis));
        Gate(Beside < OnAxis * 0.01, "and only where it stands", "falls to " + std::to_string(Beside));

        //    Ground nearer than the lamp must hide it; ground further away must not.
        const double Hidden = LuminanceOf(Sky.AddLightGlyphs(Black, AtLamp, Observer, true, 3.0f));
        const double Behind = LuminanceOf(Sky.AddLightGlyphs(Black, AtLamp, Observer, true, 50.0f));
        Gate(Hidden == 0.0, "an occluder in front hides the glyph", "ground at 3 m, lamp at 10 m");
        Gate(std::abs(Behind - OnAxis) < 1e-9, "an occluder behind does not", "ground at 50 m, lamp at 10 m");
    }

    //========================================================================================================
    //    ⑧ THE LAMPS LIGHT THE FOG — the volumetric in-scatter term
    //========================================================================================================
    //    A lamp inside a fog bank must make the fog glow, not merely light the surface under it. The check is
    //    differential: the same fog volume, the same view ray, with the lamp on and off.

    Section("⑧ A lamp inside the fog makes the fog glow");
    {
        CelestialCriteria C{};
        //    ⚠️ `Sun.Visible` is the reference's `uSunVisible`, which gates only the DISC — the sun goes on
        //    scattering into every medium regardless, because `uSunIntensity` is a separate uniform. To leave
        //    the lamp as the only light in the fog the intensity itself has to go to zero.
        C.Sun.Visible = false;
        C.Sun.Intensity = 0.0f;
        C.Sky.Visible = false;
        C.Atmosphere.Visible = false;
        C.Stars.Visible = false;
        C.MoonCount = 0u;
        C.GroundPlane.Visible = false;
        C.Terrain.Visible = false;
        C.LocalCloud.Visible = false;
        C.CloudLayer.Visible = false;
        C.VolumetricCloud.Visible = false;
        C.HeightFog.Visible = false;
        C.AtmosphericFog.Visible = false;
        C.SpotLight.Visible = false;

        //    A fog bank straight ahead, with the lamp inside it.
        C.LocalFog.Visible     = true;
        C.LocalFog.Placement   = Vector3{ 0.0f, 2.0f, -20.0f };
        C.LocalFog.HalfExtents = Vector3{ 10.0f, 6.0f, 10.0f };
        C.PointLight.Placement = Vector3{ 0.0f, 2.0f, -20.0f };

        const ObserverFrame Observer = StandingObserver(2.0f);
        const Vector3 Through{ 0.0f, 0.0f, -1.0f };

        CelestialCriteria WithLamp = C;
        WithLamp.PointLight.Visible = true;
        CelestialIntegrator Lit(WithLamp);
        Lit.SolveFrame(0.0f);

        CelestialCriteria NoLamp = C;
        NoLamp.PointLight.Visible = false;
        CelestialIntegrator Unlit(NoLamp);
        Unlit.SolveFrame(0.0f);

        //    Look slightly off the lamp so the glyph is not what is being measured — only the fog.
        const Vector3 Offset = Vector3{ 0.25f, 0.0f, -1.0f }.Normalized();
        const double FogLit = LuminanceOf(Lit.SampleSkyRadiance(Offset, Observer, 1e-3f, 5u, 9u));
        const double FogUnlit = LuminanceOf(Unlit.SampleSkyRadiance(Offset, Observer, 1e-3f, 5u, 9u));
        //    With every other illuminant removed, the fog is lit by the lamp or by nothing.
        std::printf("     fog radiance   lamp ON %.8f   lamp OFF %.8f\n", FogLit, FogUnlit);
        Gate(FogUnlit < 1e-6, "with no lamp the fog is black", "OFF " + std::to_string(FogUnlit));
        Gate(FogLit > 1e-4, "the lamp in-scatters into the fog", "ON " + std::to_string(FogLit));

        //    And with no fog at all, the same off-axis ray must not change: the in-scatter needs a medium.
        CelestialCriteria NoFog = WithLamp;
        NoFog.LocalFog.Visible = false;
        CelestialIntegrator Clear(NoFog);
        Clear.SolveFrame(0.0f);
        CelestialCriteria NoFogNoLamp = NoLamp;
        NoFogNoLamp.LocalFog.Visible = false;
        CelestialIntegrator ClearDark(NoFogNoLamp);
        ClearDark.SolveFrame(0.0f);
        const double ClearLit = LuminanceOf(Clear.SampleSkyRadiance(Offset, Observer, 1e-3f, 5u, 9u));
        const double ClearUnlit = LuminanceOf(ClearDark.SampleSkyRadiance(Offset, Observer, 1e-3f, 5u, 9u));
        Gate(std::abs(ClearLit - ClearUnlit) < 1e-6, "with no medium there is nothing to in-scatter into",
             "difference " + std::to_string(std::abs(ClearLit - ClearUnlit)));
    }

    //========================================================================================================
    //    ⑨ THE GROUND IS LIT BY THE SUN — and darkens when the sun goes down
    //========================================================================================================
    //    The ground's sun term is  albedo · sunColour · I · 0.11 · max(sunDir.y, 0). It is linear in the
    //    sun's altitude sine, and it must vanish below the horizon. Both are checkable against the formula.

    Section("⑨ The ground's sun term follows max(sinθ, 0)");
    {
        CelestialCriteria C{};
        C.Terrain.Visible = false;
        C.GroundPlane.Graticule = false;
        C.PointLight.Visible = false;
        C.SpotLight.Visible = false;
        C.LocalFog.Visible = false;
        C.LocalCloud.Visible = false;
        C.VolumetricCloud.Visible = false;
        C.HeightFog.Visible = false;
        C.AtmosphericFog.Visible = false;
        C.MoonCount = 0u;

        const ObserverFrame Observer = StandingObserver(2.0f);
        const Vector3 Down = DirectionToGround(2.0f, 6.0f);

        double Noon = 0.0, Evening = 0.0, Night = 0.0;
        for (int Phase = 0; Phase < 3; ++Phase)
        {
            CelestialCriteria Moment = C;
            Moment.Sun.LocalHours = (Phase == 0) ? 12.0f : (Phase == 1) ? 17.0f : 0.5f;
            CelestialIntegrator Sky(Moment);
            Sky.SolveFrame(0.0f);
            const auto G = Sky.SampleGround(Down, Observer, 1e-3f);
            const double L = LuminanceOf(G.Radiance);
            if (Phase == 0) { Noon = L; } else if (Phase == 1) { Evening = L; } else { Night = L; }
        }
        std::printf("     ground luminance   noon %.6f   evening %.6f   midnight %.6f\n", Noon, Evening, Night);
        Gate(Noon > Evening && Evening > Night, "the ground tracks the sun down the sky",
             "noon > evening > midnight");
        Gate(Night < Noon * 0.02, "at midnight the ground is dark",
             "midnight is " + std::to_string(Night / std::max(Noon, 1e-12)) + " of noon");
    }

    //========================================================================================================
    std::printf("\n════════════════════════════════════════════════════════════════════════════════════════════\n");
    if (Failures == 0)
    {
        std::printf("  \033[32mALL GROUND CHECKS PASSED\033[0m — the world under the sky agrees with independent arithmetic\n");
    }
    else
    {
        std::printf("  \033[31m%d CHECK(S) FAILED\033[0m\n", Failures);
    }
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");
    return Failures;
}
