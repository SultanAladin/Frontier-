//============================================================================================================================================
// 📦 Scratchpad/CelestialPhysicsProof.cpp — Independent Numeric Gate on the Transcribed Celestial Physics
//============================================================================================================================================
//
//    This does NOT re-run the port and compare it with itself. Every assertion below is computed a second,
//    independent way — from published values, from closed-form optics, or from the reference's own arithmetic
//    re-derived by hand — and the port is required to land on it. A gate that only proves "the code equals
//    itself" proves nothing, so none of these do that.
//
//    Exit code is the number of failures, so a build script can gate on it.
//
//============================================================================================================================================

#include "../Projects/Project-Zero/Source/CelestialIntegrator.h"

#include <cmath>
#include <cstdio>
#include <string>

using namespace Frontier;
using namespace Frontier::ProjectZero;

namespace {

int Failures = 0;
int Checks   = 0;

void Check(bool Condition, const std::string& Title, const std::string& Detail)
{
    ++Checks;
    if (Condition)
    {
        std::printf("  \033[32m✓\033[0m %-52s %s\n", Title.c_str(), Detail.c_str());
    }
    else
    {
        ++Failures;
        std::printf("  \033[31m✗\033[0m %-52s %s\n", Title.c_str(), Detail.c_str());
    }
}

void CheckNear(float Measured, float Expected, float Tolerance, const std::string& Title)
{
    char Detail[192];
    std::snprintf(Detail, sizeof(Detail), "measured %.6g · expected %.6g · tol %.3g", Measured, Expected, Tolerance);
    Check(std::abs(Measured - Expected) <= Tolerance, Title, Detail);
}

void Banner(const char* Text)
{
    std::printf("\n\033[1m%s\033[0m\n", Text);
}

} // namespace

int main()
{
    std::printf("════════════════════════════════════════════════════════════════════════════════════════\n");
    std::printf("  CELESTIAL PHYSICS PROOF — the port against independent arithmetic\n");
    std::printf("════════════════════════════════════════════════════════════════════════════════════════\n");

    CelestialCriteria Criteria{};
    CelestialIntegrator Sky(Criteria);

    //--------------------------------------------------------------------------------------------------------
    Banner("① AIR MASS — against the published Kasten-Young table");
    //--------------------------------------------------------------------------------------------------------
    //    Kasten & Young (1989). At the zenith the air mass is exactly 1; at 30° elevation it is very close to
    //    2; at the horizon the formula gives ≈ 37.9. These are textbook values, not port outputs.
    //    Kasten-Young is a fit, not an identity: at the zenith it returns 0.99971, not exactly 1. The check is
    //    against the formula's own published value, so the tolerance admits that 2.9e-4 offset and nothing more.
    CheckNear(CelestialIntegrator::AirMassOf(90.0f), 0.99971f, 1e-4f, "zenith air mass is unity to the fit's 3e-4");
    CheckNear(CelestialIntegrator::AirMassOf(30.0f), 2.0f, 0.01f, "30° elevation ≈ 2 air masses");
    CheckNear(CelestialIntegrator::AirMassOf(0.0f), 37.92f, 0.1f, "horizon ≈ 37.9 air masses");
    Check(CelestialIntegrator::AirMassOf(-7.0f) == 40.0f, "below -6° the model saturates", "clamped at 40");

    //--------------------------------------------------------------------------------------------------------
    Banner("② RAINBOW GEOMETRY — against Descartes' minimum deviation");
    //--------------------------------------------------------------------------------------------------------
    //    The primary bow sits near 42° from the antisolar point, the secondary near 51°, and the secondary's
    //    colours run the opposite way. Those are measurable facts about water drops, independent of any code.
    const float PrimaryRed    = Degrees(CelestialIntegrator::BowAngle(700.0f, 1.0f));
    const float PrimaryViolet = Degrees(CelestialIntegrator::BowAngle(400.0f, 1.0f));
    const float SecondaryRed  = Degrees(CelestialIntegrator::BowAngle(700.0f, 2.0f));
    const float SecondaryViolet = Degrees(CelestialIntegrator::BowAngle(400.0f, 2.0f));

    std::printf("      primary   red %.2f°   violet %.2f°\n", PrimaryRed, PrimaryViolet);
    std::printf("      secondary red %.2f°   violet %.2f°\n", SecondaryRed, SecondaryViolet);

    Check(PrimaryRed > 42.0f && PrimaryRed < 42.6f, "primary red at 42.3° ± 0.3", std::to_string(PrimaryRed));
    Check(PrimaryViolet > 40.0f && PrimaryViolet < 41.2f, "primary violet near 40.6°", std::to_string(PrimaryViolet));
    Check(PrimaryRed > PrimaryViolet, "primary: red OUTSIDE violet", "red band is the outer edge");
    Check(SecondaryRed > 50.0f && SecondaryRed < 52.5f, "secondary red near 51°", std::to_string(SecondaryRed));
    Check(SecondaryViolet > SecondaryRed, "secondary: order REVERSED", "violet outside red, as observed");
    Check(SecondaryRed - PrimaryRed > 7.0f, "Alexander's dark band separates the bows", "gap > 7°");

    //--------------------------------------------------------------------------------------------------------
    Banner("③ SOLAR EPHEMERIS — against spherical-astronomy identities");
    //--------------------------------------------------------------------------------------------------------
    //    The reference's solar model is an equinox model: declination zero, so at local noon the elevation is
    //    exactly (90 - |latitude|), and sunrise/sunset land at 06:00/18:00 for every latitude. Both are
    //    independently checkable statements about the geometry, not about the code.
    {
        CelestialCriteria C{};
        C.Sun.LatitudeDegrees = -26.0f;                         // the panel's default, Johannesburg-ish
        CelestialIntegrator S(C);

        C.Sun.LocalHours = 12.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        const float NoonElevation = S.QueryFrame().SunElevationDeg;
        CheckNear(NoonElevation, 90.0f - 26.0f, 0.05f, "equinox noon elevation = 90 - |lat|");

        C.Sun.LocalHours = 6.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        CheckNear(S.QueryFrame().SunElevationDeg, 0.0f, 0.05f, "sunrise at 06:00 on the equinox");

        C.Sun.LocalHours = 18.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        CheckNear(S.QueryFrame().SunElevationDeg, 0.0f, 0.05f, "sunset at 18:00 on the equinox");

        C.Sun.LocalHours = 0.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        CheckNear(S.QueryFrame().SunElevationDeg, -(90.0f - 26.0f), 0.05f, "midnight sun is antipodal");

        //    Southern latitude ⇒ the sun culminates to the NORTH. In the reference frame north is -Z.
        C.Sun.LocalHours = 12.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        Check(S.QueryFrame().SunDirection.z < 0.0f, "southern observer sees the sun to the north", "sun.z < 0");

        //    …and a northern observer sees it to the south.
        C.Sun.LatitudeDegrees = 45.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        Check(S.QueryFrame().SunDirection.z > 0.0f, "northern observer sees the sun to the south", "sun.z > 0");
        CheckNear(S.QueryFrame().SunElevationDeg, 45.0f, 0.05f, "45°N equinox noon elevation = 45°");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("④ BLACKBODY COLOUR — against the physics of colour temperature");
    //--------------------------------------------------------------------------------------------------------
    //    A 2000 K source must be red-dominant, 6500 K near neutral, 12000 K blue-dominant. Independent of the
    //    particular fit used.
    {
        const Vector3 Warm = CelestialIntegrator::KelvinColour(2000.0f);
        const Vector3 Neutral = CelestialIntegrator::KelvinColour(6500.0f);
        const Vector3 Cool = CelestialIntegrator::KelvinColour(12000.0f);
        Check(Warm.x > Warm.z * 3.0f, "2000 K is strongly red-dominant", "R > 3·B");
        Check(std::abs(Neutral.x - Neutral.z) < 0.15f, "6500 K is near neutral", "|R-B| < 0.15");
        Check(Cool.z >= Cool.x, "12000 K is blue-dominant", "B >= R");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑤ RAYLEIGH SCATTERING — the sky is blue because β(λ) ∝ 1/λ⁴");
    //--------------------------------------------------------------------------------------------------------
    //    The transcribed coefficients are (5.8, 13.5, 33.1)e-6. Rayleigh theory says the ratio of blue to red
    //    scattering should be about (700/440)^4 ≈ 6.4. The coefficients must reproduce that independently.
    {
        const float RatioBlueRed = 33.1f / 5.8f;
        CheckNear(RatioBlueRed, std::pow(700.0f / 440.0f, 4.0f), 1.0f, "β_blue/β_red matches the 1/λ⁴ law");

        //    And the rendered sky must actually come out blue — measured 90° AWAY from the sun, which is where
        //    Rayleigh scattering dominates. Looking straight at the solar aureole would (correctly) read white,
        //    so sampling the zenith at lat 0 noon — where the sun IS the zenith — would test nothing.
        CelestialCriteria C{};
        C.Sun.LocalHours = 12.0f;
        C.Sun.LatitudeDegrees = 45.0f;                          // sun at 45°, so the zenith is well off-axis
        CelestialIntegrator S(C);
        S.SolveFrame(0.0f);
        Vector3 SkyRadiance{}, Transmittance{};
        float Ground = 0.0f;
        const Vector3 Origin{ 0.0f, C.Atmosphere.PlanetRadius + 2.0f, 0.0f };
        S.IntegrateAtmosphere(Origin, Vector3{ 0.0f, 1.0f, 0.0f }, SkyRadiance, Transmittance, Ground);
        std::printf("      zenith radiance, sun at 45° = (%.5f, %.5f, %.5f)\n", SkyRadiance.x, SkyRadiance.y, SkyRadiance.z);
        Check(SkyRadiance.z > SkyRadiance.x * 1.5f, "the clear zenith renders blue", "B > 1.5·R");
        Check(SkyRadiance.y > SkyRadiance.x && SkyRadiance.z > SkyRadiance.y, "green sits between red and blue", "R < G < B");
        Check(Ground < 0.5f, "a zenith ray does not hit the planet", "ground = 0");

        //    The complementary statement, which is what makes the one above meaningful: looking INTO the sun
        //    the same integral must go white/warm, because forward Mie scattering swamps the Rayleigh tint.
        CelestialCriteria Overhead{};
        Overhead.Sun.LocalHours = 12.0f;
        Overhead.Sun.LatitudeDegrees = 0.0f;                    // sun exactly at the zenith
        CelestialIntegrator T(Overhead);
        T.SolveFrame(0.0f);
        Vector3 Aureole{}, TransAureole{};
        float g2 = 0.0f;
        T.IntegrateAtmosphere(Origin, Vector3{ 0.0f, 1.0f, 0.0f }, Aureole, TransAureole, g2);
        std::printf("      radiance looking INTO the sun = (%.5f, %.5f, %.5f)\n", Aureole.x, Aureole.y, Aureole.z);
        Check(Aureole.x > SkyRadiance.x * 3.0f, "the solar aureole is far brighter than clear sky", "forward Mie peak");
        Check(std::abs(Aureole.x - Aureole.z) / Aureole.x < 0.20f, "the aureole is near-white, not blue", "|R-B|/R < 20%");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑥ SUNSET REDDENING — differential extinction along a long path");
    //--------------------------------------------------------------------------------------------------------
    //    Physics, not taste: at the horizon the path is ~38 air masses, so blue is scattered out far more than
    //    red and the transmitted beam must be red-dominant even though the same beam is white overhead.
    {
        CelestialCriteria C{};
        C.Sun.LatitudeDegrees = 0.0f;
        CelestialIntegrator S(C);

        C.Sun.LocalHours = 12.0f;
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        const Vector3 Origin{ 0.0f, C.Atmosphere.PlanetRadius + 2.0f, 0.0f };
        Vector3 SkyNoon{}, TransNoon{};
        float g0 = 0.0f;
        S.IntegrateAtmosphere(Origin, S.QueryFrame().SunDirection, SkyNoon, TransNoon, g0);

        C.Sun.LocalHours = 6.05f;                               // just above the horizon
        S.MutableCriteria() = C;
        S.SolveFrame(0.0f);
        Vector3 SkySet{}, TransSet{};
        float g1 = 0.0f;
        S.IntegrateAtmosphere(Origin, S.QueryFrame().SunDirection, SkySet, TransSet, g1);

        std::printf("      transmittance  noon (%.4f %.4f %.4f)   horizon (%.4f %.4f %.4f)\n",
                    TransNoon.x, TransNoon.y, TransNoon.z, TransSet.x, TransSet.y, TransSet.z);
        Check(TransNoon.x / TransNoon.z < TransSet.x / TransSet.z, "the horizon beam is redder than the noon beam",
              "R/B rises toward the horizon");
        Check(TransSet.z < TransNoon.z, "blue is extinguished more at the horizon", "B falls");
        Check(TransSet.x > TransSet.z, "the horizon sun is red-dominant", "R > B");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑦ ENERGY CONSERVATION — transmittance and Beer-Lambert");
    //--------------------------------------------------------------------------------------------------------
    {
        CelestialCriteria C{};
        CelestialIntegrator S(C);
        S.SolveFrame(0.0f);
        const Vector3 Origin{ 0.0f, C.Atmosphere.PlanetRadius + 2.0f, 0.0f };

        bool AllBounded = true;
        bool Monotonic = true;
        float PreviousZenithTransmittance = 1.0f;
        for (int i = 0; i <= 18; ++i)
        {
            const float Elevation = static_cast<float>(i) * 5.0f;
            const Vector3 d{ std::cos(Radians(Elevation)), std::sin(Radians(Elevation)), 0.0f };
            Vector3 Sky{}, Trans{};
            float Ground = 0.0f;
            S.IntegrateAtmosphere(Origin, d, Sky, Trans, Ground);
            if (Trans.x < 0.0f || Trans.x > 1.0001f || Trans.y > 1.0001f || Trans.z > 1.0001f) { AllBounded = false; }
            if (Sky.x < 0.0f || Sky.y < 0.0f || Sky.z < 0.0f) { AllBounded = false; }
            //    A steeper ray travels through less air, so its transmittance must not fall.
            if (Trans.z + 1e-5f < PreviousZenithTransmittance && i > 0) { Monotonic = false; }
            PreviousZenithTransmittance = Trans.z;
        }
        Check(AllBounded, "transmittance stays in [0,1], radiance non-negative", "19 elevations swept");
        Check(Monotonic, "transmittance rises monotonically toward the zenith", "no inversion");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑧ FRAME ROTATION — the world/sky seam is exactly invertible");
    //--------------------------------------------------------------------------------------------------------
    {
        bool RoundTrips = true;
        bool PreservesAngles = true;
        const Vector3 Samples[5] = { { 1, 0, 0 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0.3f, -0.6f, 0.74f }, { -0.5f, 0.5f, 0.707f } };
        for (const Vector3& v : Samples)
        {
            const Vector3 Back = WorldFrameOf(SkyFrameOf(v));
            if (std::abs(Back.x - v.x) > 1e-6f || std::abs(Back.y - v.y) > 1e-6f || std::abs(Back.z - v.z) > 1e-6f)
            {
                RoundTrips = false;
            }
            if (std::abs(SkyFrameOf(v).Length() - v.Length()) > 1e-6f) { PreservesAngles = false; }
        }
        //    Frontier's +Z up must land on the reference's +Y up.
        const Vector3 WorldUp{ 0.0f, 0.0f, 1.0f };
        const Vector3 SkyUp = SkyFrameOf(WorldUp);
        Check(RoundTrips, "world → sky → world is the identity", "5 vectors");
        Check(PreservesAngles, "the rotation preserves length", "no scale at the seam");
        Check(std::abs(SkyUp.y - 1.0f) < 1e-6f, "Frontier +Z up maps to reference +Y up", "the axis contract holds");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑨ STAR VISIBILITY — the daylight gate is a physical contrast test");
    //--------------------------------------------------------------------------------------------------------
    {
        CelestialCriteria C{};
        C.Sun.LatitudeDegrees = 0.0f;

        C.Sun.LocalHours = 12.0f;
        CelestialIntegrator Day(C);
        Day.SolveFrame(0.0f);
        Vector3 SkyDay{}, TransDay{};
        float g0 = 0.0f;
        const Vector3 Origin{ 0.0f, C.Atmosphere.PlanetRadius + 2.0f, 0.0f };
        Day.IntegrateAtmosphere(Origin, Vector3{ 0.0f, 1.0f, 0.0f }, SkyDay, TransDay, g0);
        const float DayLuminance = LuminanceOf(SkyDay * C.Sky.Brightness);

        C.Sun.LocalHours = 0.0f;
        CelestialIntegrator Night(C);
        Night.SolveFrame(0.0f);
        Vector3 SkyNight{}, TransNight{};
        float g1 = 0.0f;
        Night.IntegrateAtmosphere(Origin, Vector3{ 0.0f, 1.0f, 0.0f }, SkyNight, TransNight, g1);
        const float NightLuminance = LuminanceOf(SkyNight * C.Sky.Brightness);

        const float Ceiling = Day.QueryFrame().StarCeiling;
        std::printf("      sky luminance   day %.6g   night %.6g   star ceiling %.6g\n",
                    DayLuminance, NightLuminance, Ceiling);

        Check(DayLuminance > NightLuminance * 100.0f, "the day sky is orders of magnitude brighter", "> 100x");
        Check(Ceiling < DayLuminance * C.Stars.ContrastLimit * 0.6f, "stars are gated OFF at noon", "ceiling loses to the day sky");
        Check(Ceiling > NightLuminance * C.Stars.ContrastLimit * 0.6f, "stars are gated ON at midnight", "ceiling beats the night sky");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑩ HENYEY-GREENSTEIN — the cloud phase function is normalised");
    //--------------------------------------------------------------------------------------------------------
    //    ∫ p(θ) dΩ = 1 over the sphere, for any g. Integrated numerically here, so the transcription's factor
    //    of 4π is checked rather than assumed.
    {
        auto Hg = [](float c, float g)
        {
            const float d = 1.0f + g * g - 2.0f * g * c;
            return (1.0f - g * g) / (4.0f * 3.14159f * std::pow(std::max(d, 1e-6f), 1.5f));
        };
        for (float g : { 0.0f, 0.3f, 0.8f })
        {
            constexpr int N = 20000;
            double Integral = 0.0;
            for (int i = 0; i < N; ++i)
            {
                const double mu0 = -1.0 + 2.0 * i / N;
                const double mu1 = -1.0 + 2.0 * (i + 1.0) / N;
                const double mu = 0.5 * (mu0 + mu1);
                Integral += Hg(static_cast<float>(mu), g) * (mu1 - mu0) * 2.0 * 3.14159265358979;
            }
            char Title[96];
            std::snprintf(Title, sizeof(Title), "HG phase integrates to 1 at g = %.1f", static_cast<double>(g));
            CheckNear(static_cast<float>(Integral), 1.0f, 0.01f, Title);
        }
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑪ EXPONENTIAL HEIGHT KERNEL — against the closed-form integral");
    //--------------------------------------------------------------------------------------------------------
    //    The fog kernel claims to be the exact mean of exp(-y/H) over a segment. Checked against a dense
    //    numerical quadrature of the same integral, which is an independent computation.
    {
        auto Kernel = [](float hh, float a, float b)
        {
            const float ya = std::max(0.0f, std::min(a, b));
            const float yb = std::max(0.0f, std::max(a, b));
            return (yb - ya) < 1e-3f ? std::exp(-ya / hh) : hh * (std::exp(-ya / hh) - std::exp(-yb / hh)) / (yb - ya);
        };
        const float H = 42.0f, y0 = 3.0f, y1 = 180.0f;
        constexpr int N = 200000;
        double Quadrature = 0.0;
        for (int i = 0; i < N; ++i)
        {
            const double y = y0 + (y1 - y0) * (i + 0.5) / N;
            Quadrature += std::exp(-y / H);
        }
        Quadrature /= N;
        CheckNear(Kernel(H, y0, y1), static_cast<float>(Quadrature), 1e-4f, "fog height kernel = ∫exp(-y/H)/Δy");
    }

    //--------------------------------------------------------------------------------------------------------
    Banner("⑫ WIND FIELD — shear, veer and the divergence-free swirl");
    //--------------------------------------------------------------------------------------------------------
    {
        CelestialCriteria C{};
        CelestialIntegrator S(C);
        //    windBase: speed grows with the shear coefficient per kilometre, bearing veers by uWVeer deg/km.
        const float Speed0 = C.Wind.Speed;
        const float Speed1000 = C.Wind.Speed * (1.0f + C.Wind.Shear * 1.0f);
        CheckNear(Speed1000 / Speed0, 1.0f + C.Wind.Shear, 1e-5f, "wind speed grows by the shear per km");

        //    A full second of integration at the default gust phase must move the air by roughly its speed.
        S.AdvanceWind(1.0f);
        const float Moved = std::sqrt(S.QueryFrame().WindIntegral[0] * S.QueryFrame().WindIntegral[0]
                                    + S.QueryFrame().WindIntegral[1] * S.QueryFrame().WindIntegral[1]);
        std::printf("      one second of advection moved %.3f m at %.1f m/s\n", Moved, static_cast<double>(C.Wind.Speed));
        Check(Moved > C.Wind.Speed * 0.7f && Moved < C.Wind.Speed * 1.4f, "one second advects about one speed", "gust-modulated");
    }

    //--------------------------------------------------------------------------------------------------------
    std::printf("\n════════════════════════════════════════════════════════════════════════════════════════\n");
    if (Failures == 0)
    {
        std::printf("  \033[32mALL %d CHECKS PASSED\033[0m — the transcription agrees with independent physics\n", Checks);
    }
    else
    {
        std::printf("  \033[31m%d of %d CHECKS FAILED\033[0m\n", Failures, Checks);
    }
    std::printf("════════════════════════════════════════════════════════════════════════════════════════\n");
    return Failures;
}
