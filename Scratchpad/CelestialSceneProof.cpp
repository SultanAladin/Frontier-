//============================================================================================================================================
// 📦 Scratchpad/CelestialSceneProof.cpp — The Combined Proof: ReSTIR + Cornell Box + The Whole Celestial Port, One Frame
//============================================================================================================================================
//
//    This is the artefact the port is judged on. It renders Project Zero's Cornell box, lit by its own emissive
//    luminaire AND by the ported sun and sky through an opened ceiling, with ReSTIR DI and GI running, and
//    every celestial system live in the same frame: atmosphere, twilight, stars, moons, volumetric clouds,
//    cloud layer, local cloud, height fog, atmospheric fog, local volumetric fog, wind, precipitation, rainbow,
//    lens flare and the tonemap chain.
//
//    It emits a sheet of frames across the day so the systems are visible where each is strongest: the stars
//    and moon at night, the twilight band and its white line at dawn, the clouds and rainbow by day.
//
//    Every frame is accompanied by numbers, and the numbers are gated — a frame that goes flat, goes black, or
//    loses a feature fails the gate rather than quietly shipping.
//
//============================================================================================================================================

#include "../Projects/Project-Zero/Source/CelestialStage.h"
#include "../Projects/Project-Zero/Source/FlyThroughSolver.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
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
        std::printf("     \033[32m✓\033[0m %-46s %s\n", Title.c_str(), Detail.c_str());
    }
    else
    {
        ++Failures;
        std::printf("     \033[31m✗\033[0m %-46s %s\n", Title.c_str(), Detail.c_str());
    }
}

//    Count distinct quantised colours — the single cheapest guard against the failure that was already sitting
//    in this repository: an exported frame with exactly one colour in it.
uint32_t DistinctColoursOf(const std::string& PpmPath)
{
    std::FILE* f = std::fopen(PpmPath.c_str(), "rb");
    if (!f) { return 0u; }
    char magic[3] = { 0, 0, 0 };
    int w = 0, h = 0, maxv = 0;
    if (std::fscanf(f, "%2s %d %d %d", magic, &w, &h, &maxv) != 4) { std::fclose(f); return 0u; }
    std::fgetc(f);
    std::map<uint32_t, uint32_t> Seen;
    for (int i = 0; i < w * h; ++i)
    {
        const int r = std::fgetc(f), g = std::fgetc(f), b = std::fgetc(f);
        if (r < 0 || g < 0 || b < 0) { break; }
        Seen[(static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | static_cast<uint32_t>(b)]++;
    }
    std::fclose(f);
    return static_cast<uint32_t>(Seen.size());
}

struct SceneMoment
{
    const char* Stem;
    const char* Title;
    float       LocalHours;
    uint32_t    CloudVariety;
    float       Coverage;
    uint32_t    Precipitation;                                  // 0 rain · 3 snow
    float       Rate;
    float       SunAzimuthOffset;                               // [deg] swing the sun into the aperture
    float       MoonAzimuth;                                    // [deg]
    float       MoonElevation;                                  // [deg]
};

} // namespace

int main()
{
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");
    std::printf("  CELESTIAL SCENE PROOF — ReSTIR + Cornell Box + the full CelestialPanel port, one frame each\n");
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");

    //    The camera stands INSIDE the room, near the open end, tilted up so one frame holds all three things
    //    at once: the coloured walls and boxes (ReSTIR), the ceiling aperture (the seam), and the sky beyond it
    //    (the celestial port). The engine frame is +X right, +Y forward/depth, +Z up.
    //
    //    Eye near the floor at the near wall, tilted up: the boxes and the coloured walls fill the lower frame,
    //    the wide aperture and the sky beyond it fill the upper frame. One picture, both systems.
    FlyThroughConfiguration CameraSetup{ 2.5f, 3.0f, 0.0025f, 0.5f, 12.0f };
    FlyThroughSolver Camera(CameraSetup);
    Camera.AssignSpatialLocation(Vector3{ 0.0f, 0.06f, 0.42f });
    Camera.AssignOrientationEuler(Radians(30.0f), 0.0f, 0.0f);
    Camera.AssignFieldOfView(80.0f);

    //    The aperture frames sky azimuth ≈ 0° (north, sky $-Z$) between 38° and 85° of elevation, measured from
    //    the eye point above. Each moment steers its principal body into that window: the physics is untouched,
    //    only the observer's placement relative to it — the same thing a photographer does.
    const SceneMoment Moments[] = {
        { "Dawn",     "06:20 · twilight band, white line, the last stars",  6.35f, 2u, 0.45f, 0u, 12.0f,  10.0f,  10.0f, 55.0f },
        { "Noon",     "12:00 · cumulus, rainbow, aerial perspective",      12.00f, 2u, 0.52f, 0u, 14.0f,   0.0f, 200.0f, 40.0f },
        { "Dusk",     "17:50 · low sun, lens flare, reddened disc",        17.85f, 3u, 0.58f, 0u,  9.0f, -10.0f, 350.0f, 50.0f },
        { "Night",    "23:30 · moon, Milky Way, star field",               23.50f, 5u, 0.30f, 3u,  6.0f,   0.0f,   4.0f, 56.0f }
    };

    std::vector<std::string> Written;

    for (const SceneMoment& Moment : Moments)
    {
        CelestialCriteria Sky{};
        Sky.Sun.LocalHours = Moment.LocalHours;
        Sky.Sun.AzimuthOffsetDegrees = Moment.SunAzimuthOffset;
        Sky.VolumetricCloud.Variety = static_cast<float>(Moment.CloudVariety);
        Sky.VolumetricCloud.Coverage = Moment.Coverage;
        Sky.Precipitation.Variety = Moment.Precipitation;
        Sky.Precipitation.RateMillimetres = Moment.Rate;
        Sky.Moons[0].AzimuthDegrees = Moment.MoonAzimuth;
        Sky.Moons[0].ElevationDegrees = Moment.MoonElevation;
        //    A larger disc than Luna's true 0.5°, so the textured surface, phase terminator and limb darkening
        //    are all legible at this resolution — the panel's own atlas offers exactly this range.
        Sky.Moons[0].AngularDiameterDeg = 6.5f;

        //    The observer stands in the room, so the celestial camera height is the room's, not a mountain's.
        Sky.Observer.Height = 1.05f;

        //    Bring the local volumes into the room's neighbourhood; the panel's defaults are placed for a
        //    600 m plane, and at Cornell-box scale they would sit far outside the shot.
        Sky.LocalFog.Placement   = Vector3{ 2.0f, 1.2f, -3.0f };
        Sky.LocalFog.HalfExtents = Vector3{ 6.0f, 2.0f, 6.0f };
        Sky.LocalCloud.Placement   = Vector3{ 18.0f, 90.0f, -70.0f };
        Sky.LocalCloud.HalfExtents = Vector3{ 60.0f, 26.0f, 45.0f };

        CelestialStageCriteria Setup{};
        Setup.Width  = 960u;
        Setup.Height = 640u;
        Setup.SpatialPasses = 2u;
        Setup.IndirectRays  = 8u;

        CelestialStage Stage(Setup, Sky);

        //    The real lunar albedo — NASA LROC, the reference atlas's own `luna` plate, decoded to P6.
        MoonAlbedoSurface Luna = MoonAlbedoSurface::LoadPortablePixmap("EngineContent/CelestialTextures/luna_1k.ppm");
        if (Luna.Populated())
        {
            Stage.MutableSky().AssignMoonSurface(0u, std::move(Luna));
        }

        //    Let the weather settle: wind integral, cloud advection and a populated rain pool.
        for (int i = 0; i < 45; ++i)
        {
            Stage.Advance(1.0f / 30.0f);
        }

        std::printf("\n\033[1m  %s — %s\033[0m\n", Moment.Stem, Moment.Title);
        Stage.RenderFrame(Camera);
        const CelestialStage::FrameStatistics& S = Stage.QueryStatistics();

        const std::string Ppm = std::string("Diagnostics/Celestial_") + Moment.Stem + ".ppm";
        const std::string Png = std::string("Diagnostics/Celestial_") + Moment.Stem + ".png";
        const bool Exported = Stage.ExportPpmImage(Ppm);
        const std::string Convert = "python3 Tools/PpmToPng.py " + Ppm + " " + Png + " > /dev/null 2>&1";
        if (Exported && std::system(Convert.c_str()) == 0)
        {
            Written.push_back(Png);
        }

        const uint32_t Distinct = DistinctColoursOf(Ppm);
        const CelestialFrame& F = Stage.QuerySky().QueryFrame();

        std::printf("     sun elevation %.2f°   sky pixels %.1f%%   mean L %.4f   surfaces %.4f   sky %.4f\n",
                    static_cast<double>(F.SunElevationDeg), S.SkyPixelFraction * 100.0,
                    S.MeanLuminance, S.MeanSurfaceLuminance, S.MeanSkyLuminance);
        std::printf("     rain pixels %u   distinct colours %u   %.0f ms\n",
                    S.RainPixels, Distinct, S.RenderMilliseconds);

        //    ── The gates ───────────────────────────────────────────────────────────────────────────────────
        Gate(Distinct > 2000u, "the frame is not flat", std::to_string(Distinct) + " distinct colours");
        Gate(S.SkyPixelFraction > 0.02 && S.SkyPixelFraction < 0.80,
             "geometry and sky share the frame", "both are visible");
        Gate(S.MeanSurfaceLuminance > 1e-4, "the room is lit, not black", "surfaces carry radiance");
        Gate(S.MeanLuminance > 1e-4 && std::isfinite(S.MeanLuminance), "radiance is finite and non-zero", "no NaN, no black frame");

        //    Per-moment feature gates: each names the system that moment exists to exercise, so a feature
        //    silently dropping out fails here instead of surviving as a slightly different picture.
        if (std::string(Moment.Stem) == "Night")
        {
            //    At night the sky must carry star and moon light, not merely be dark.
            const ObserverFrame Observer{};
            const Vector3 MoonDirection = Stage.QuerySky().QueryFrame().MoonDirections[0];
            const Vector3 AtMoon = Stage.QuerySky().SampleSkyRadiance(MoonDirection, Observer, 1.0e-3f, 7u, 11u);
            Gate(LuminanceOf(AtMoon) > 0.05, "the moon disc is luminous",
                 "L = " + std::to_string(LuminanceOf(AtMoon)));

            //    Sweep a band of sky for star hits: the field must produce bright points, not a smooth wash.
            float Brightest = 0.0f;
            double Mean = 0.0;
            uint32_t Samples = 0u;
            for (int i = 0; i < 220; ++i)
            {
                const float az = static_cast<float>(i) / 220.0f * 6.283f;
                for (int j = 0; j < 40; ++j)
                {
                    const float el = 0.25f + static_cast<float>(j) / 40.0f * 1.0f;
                    const Vector3 d{ std::sin(az) * std::cos(el), std::sin(el), -std::cos(az) * std::cos(el) };
                    const float l = LuminanceOf(Stage.QuerySky().SampleSkyRadiance(d, Observer, 8.0e-4f,
                                                                                   static_cast<uint32_t>(i),
                                                                                   static_cast<uint32_t>(j)));
                    Brightest = std::max(Brightest, l);
                    Mean += l;
                    ++Samples;
                }
            }
            Mean /= Samples;
            Gate(Brightest > Mean * 20.0, "the star field resolves point sources",
                 "peak " + std::to_string(Brightest) + " vs mean " + std::to_string(Mean));
        }
        else
        {
            //    By day the solar disc must be the brightest thing in the sky. How much brighter depends on
            //    elevation, and that dependence is itself physics: at 2° the beam crosses ~19 air masses, so
            //    the disc is both dimmed and reddened. The gate therefore scales with air mass instead of
            //    demanding one fixed ratio, and adds the reddening as a separate, stronger assertion.
            const ObserverFrame Observer{};
            const Vector3 SunDirection = Stage.QuerySky().QueryFrame().SunDirection;
            const Vector3 AtSun = Stage.QuerySky().SampleSkyRadiance(SunDirection, Observer, 1.0e-4f, 3u, 5u);
            const Vector3 OffSun = Stage.QuerySky().SampleSkyRadiance(
                Cross(SunDirection, Vector3{ 0.0f, 1.0f, 0.0f }).Normalized(), Observer, 1.0e-4f, 3u, 5u);
            const float AirMass = CelestialIntegrator::AirMassOf(Stage.QuerySky().QueryFrame().SunElevationDeg);
            const float RequiredRatio = AirMass > 10.0f ? 3.0f : 10.0f;
            Gate(LuminanceOf(AtSun) > LuminanceOf(OffSun) * RequiredRatio, "the solar disc dominates the sky",
                 "disc " + std::to_string(LuminanceOf(AtSun)) + " vs sky " + std::to_string(LuminanceOf(OffSun))
                 + " at " + std::to_string(AirMass) + " air masses");

            if (AirMass > 10.0f)
            {
                //    A low sun MUST be red: this is the differential-extinction signature, and it is the
                //    reason the disc is dim in the first place.
                Gate(AtSun.x > AtSun.z * 1.6f, "the low sun is reddened by its long path",
                     "R/B = " + std::to_string(AtSun.x / std::max(AtSun.z, 1e-6f)));
            }
            Gate(S.RainPixels > 0u, "precipitation is falling", std::to_string(S.RainPixels) + " rain pixels");
        }
    }

    //--------------------------------------------------------------------------------------------------------
    //    The negative control. If the sky is switched off and the room does NOT get darker, then the sky was
    //    never lighting it and every frame above is decoration. This is the check that makes the others mean
    //    something.
    //--------------------------------------------------------------------------------------------------------
    std::printf("\n\033[1m  NEGATIVE CONTROL — does the sky actually light the room?\033[0m\n");
    {
        CelestialCriteria Sky{};
        Sky.Sun.LocalHours = 12.0f;
        Sky.Observer.Height = 1.05f;

        CelestialStageCriteria Lit{};
        Lit.Width = 320u; Lit.Height = 220u; Lit.IndirectRays = 6u; Lit.SpatialPasses = 1u;
        Lit.EmissiveLuminaire = false;                          // isolate the sky as the ONLY light

        CelestialStage WithSky(Lit, Sky);
        WithSky.Advance(0.2f);
        WithSky.RenderFrame(Camera);
        const double LitSurface = WithSky.QueryStatistics().MeanSurfaceLuminance;

        CelestialStageCriteria Dark = Lit;
        Dark.SkyLighting = false;
        CelestialStage WithoutSky(Dark, Sky);
        WithoutSky.Advance(0.2f);
        WithoutSky.RenderFrame(Camera);
        const double UnlitSurface = WithoutSky.QueryStatistics().MeanSurfaceLuminance;

        std::printf("     surface luminance   sky ON %.6f   sky OFF %.6f   ratio %.1fx\n",
                    LitSurface, UnlitSurface, LitSurface / std::max(UnlitSurface, 1e-9));

        Gate(LitSurface > UnlitSurface * 10.0, "removing the sky darkens the room >10x",
             "the sky is a real illuminant, not a backdrop");
        Gate(UnlitSurface < 1e-3, "with no sky and no lamp the room is black", "no light leaks in");
    }

    //--------------------------------------------------------------------------------------------------------
    std::printf("\n════════════════════════════════════════════════════════════════════════════════════════════\n");
    for (const std::string& Path : Written)
    {
        std::printf("  wrote %s\n", Path.c_str());
    }
    if (Failures == 0)
    {
        std::printf("  \033[32mALL SCENE GATES PASSED\033[0m\n");
    }
    else
    {
        std::printf("  \033[31m%d SCENE GATES FAILED\033[0m\n", Failures);
    }
    std::printf("════════════════════════════════════════════════════════════════════════════════════════════\n");
    return Failures;
}
