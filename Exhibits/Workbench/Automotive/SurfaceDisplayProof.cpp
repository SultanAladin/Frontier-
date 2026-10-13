//============================================================================================================================================
//                                                       SURFACEDISPLAYPROOF.CPP
//============================================================================================================================================
// 🧩 CPU proof for Engine/SurfaceDisplay: rasters the tablet (launcher, three apps, the Settings picker in all five
//    launcher designs) and the cluster in all four housings to PNG, exercising the touch pipeline through the same
//    DisplayTouchProjection::Advance the runtime uses. No GPU, no project: this proves the drawing and input port
//    before it meets the swapchain.
//
//    Build (see VisualProof/SurfaceDisplay/README.md):
//      g++ -O2 -std=c++20 -IEngine -IEngine/SurfaceDisplay -I${EXT}/stb Exhibits/Workbench/Automotive/SurfaceDisplayProof.cpp
//          Engine/SurfaceDisplay/*.cpp -o _AgentScratch/SurfaceDisplayProof
//      _AgentScratch/SurfaceDisplayProof EngineContent/FontArchives/Inter VisualProof/SurfaceDisplay

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include "SurfaceDisplay/ClusterScreenSequence.h"
#include "SurfaceDisplay/DisplaySurfaceStructure.h"
#include "SurfaceDisplay/DisplayTouchProjection.h"
#include "SurfaceDisplay/TabletScreenSequence.h"

#include <cmath>
#include <cstdio>
#include <string>

using namespace Frontier;

namespace {

int Failures = 0;

void Check(bool Condition, const char* What)
{
    std::printf("  %s %s\n", Condition ? "PASS" : "FAIL", What);
    if (!Condition) ++Failures;
}

void Save(const DisplaySheetStructure& Sheet, const std::string& Path)
{
    const int Ok = stbi_write_png(Path.c_str(), static_cast<int>(Sheet.QueryWidth()), static_cast<int>(Sheet.QueryHeight()), 4, Sheet.QueryTexels(), static_cast<int>(Sheet.QueryWidth() * 4u));
    std::printf("  %s %s (%u x %u, revision %llu)\n", Ok ? "wrote" : "FAILED", Path.c_str(), Sheet.QueryWidth(), Sheet.QueryHeight(), static_cast<unsigned long long>(Sheet.QueryRevision()));
    if (!Ok) ++Failures;
}

// A tap at sheet pixels through the real touch state machine: Down, one Move inside the slop, Up.
void Tap(TabletScreenSequence& Tablet, DisplayTouchProjection& Touch, float Across, float Down)
{
    DisplayContact Contact; Contact.Hit = true; Contact.Across = Across; Contact.Down = Down;
    Tablet.ForwardTouch(Touch.Advance(Contact, true, 0.016f));
    Tablet.ForwardTouch(Touch.Advance(Contact, true, 0.016f));
    Tablet.ForwardTouch(Touch.Advance(Contact, false, 0.016f));
    Contact.Hit = false;
    Tablet.ForwardTouch(Touch.Advance(Contact, false, 0.016f));
}

float Opaque(const DisplaySheetStructure& Sheet)
{
    uint64_t Count = 0u;
    for (uint32_t Y = 0u; Y < Sheet.QueryHeight(); ++Y)
        for (uint32_t X = 0u; X < Sheet.QueryWidth(); ++X) Count += Sheet.QueryTexel(X, Y).Alpha > 8u ? 1u : 0u;
    return static_cast<float>(Count) / static_cast<float>(Sheet.QueryWidth() * Sheet.QueryHeight());
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::string Fonts = ArgumentCount > 1 ? Arguments[1] : "EngineContent/FontArchives/Inter";
    const std::string Output = ArgumentCount > 2 ? Arguments[2] : "VisualProof/SurfaceDisplay";

    TypefaceSheetCodec Light, Regular, Medium;
    std::string Why;
    Check(Light.Decode(Fonts + "/Inter-Light.otf", &Why), ("Inter-Light decodes " + Why).c_str());
    Check(Regular.Decode(Fonts + "/Inter-Regular.otf", &Why), ("Inter-Regular decodes " + Why).c_str());
    Check(Medium.Decode(Fonts + "/Inter-Medium.otf", &Why), ("Inter-Medium decodes " + Why).c_str());

    // ---- Tablet --------------------------------------------------------------------------------------------------------------------------
    std::printf("Tablet\n");
    TabletScreenSequence Tablet;
    Tablet.AssignTypefaces(&Light, &Regular, &Medium);
    TabletReading Reading; Reading.SpeedKph = 63.0f; Reading.Gear = "D"; Reading.TreadCelsius[1] = 48.0f; Reading.Live = true;
    Tablet.AssignReading(Reading);
    Tablet.AdvanceClock(14, 32);
    // A 0.30 × 0.19 m slab at 1 design unit per pixel: 1200 × 760 sheet.
    (void)Tablet.PresentAspect(0.30f / 0.19f, 1.0f);
    Check(Tablet.Raster(), "launcher rasters");
    Save(Tablet.QuerySheet(), Output + "/Tablet_Launchpad.png");
    Check(Opaque(Tablet.QuerySheet()) > 0.99f, "launcher fully opaque");

    DisplayTouchProjection Touch;
    const char* Applications[] = { "vehicle", "drive-room", "telemetry", "tyres", "climate", "garage", "settings" };
    for (const char* Identifier : Applications)
    {
        Tablet.PresentHome();
        (void)Tablet.Raster();
        // Find the tile centre by asking the sequence which region a pixel belongs to: scan a coarse grid.
        bool Found = false;
        for (uint32_t Y = 40u; Y < Tablet.QuerySheet().QueryHeight() && !Found; Y += 12u)
            for (uint32_t X = 20u; X < Tablet.QuerySheet().QueryWidth() && !Found; X += 12u)
                if (Tablet.QueryContactIdentifier(static_cast<float>(X), static_cast<float>(Y)) == std::string("app:") + Identifier)
                {
                    Tap(Tablet, Touch, static_cast<float>(X), static_cast<float>(Y));
                    Found = true;
                }
        Check(Found, (std::string("tile reachable: ") + Identifier).c_str());
        (void)Tablet.Raster();
        const TabletScreenReading State = Tablet.QueryReading();
        Check(State.Application && std::string(State.Application) == Identifier, (std::string("tap opens ") + Identifier).c_str());
        Save(Tablet.QuerySheet(), Output + "/Tablet_" + Identifier + ".png");
    }
    // Settings in each launcher design (the picker), two further housings for the modular rule.
    const LauncherDesignCategory Designs[] = { LauncherDesignCategory::Launchpad, LauncherDesignCategory::Dashboard, LauncherDesignCategory::Collections, LauncherDesignCategory::Focus, LauncherDesignCategory::Console };
    for (LauncherDesignCategory Design : Designs)
    {
        (void)Tablet.PresentDesign(Design);
        Tablet.PresentHome();
        (void)Tablet.Raster();
        Save(Tablet.QuerySheet(), Output + std::string("/Tablet_Design_") + QueryLauncherDesignName(Design) + ".png");
    }
    (void)Tablet.PresentDesign(LauncherDesignCategory::Launchpad);
    (void)Tablet.PresentAspect(0.25f / 0.17f, 1.0f);   // a narrower slab: new sheet, nothing stretched
    Tablet.PresentHome();
    (void)Tablet.Raster();
    Save(Tablet.QuerySheet(), Output + "/Tablet_Narrow.png");
    Check(Tablet.QuerySheet().QueryWidth() != 1200u || Tablet.QuerySheet().QueryHeight() != 760u, "narrow housing reallocates the sheet");

    // ---- Cluster -------------------------------------------------------------------------------------------------------------------------
    std::printf("Cluster\n");
    struct Housing { DisplayOutlineCategory Outline; float Width, Height; const char* Name; };
    const Housing Housings[] = { { DisplayOutlineCategory::Hexagon, 0.34f, 0.19f, "Hexagon" }, { DisplayOutlineCategory::CutCircle, 0.26f, 0.26f, "Arc" },
                                 { DisplayOutlineCategory::Trapezoid, 0.36f, 0.17f, "Trapezoid" }, { DisplayOutlineCategory::Pill, 0.40f, 0.13f, "Pill" } };
    for (const Housing& H : Housings)
    {
        DisplaySpecification Specification;
        Specification.Outline = H.Outline; Specification.Width = H.Width; Specification.Height = H.Height; Specification.CornerRadius = 0.02f;
        DisplaySurfaceStructure Surface; Surface.Construct(Specification);
        ClusterScreenSequence Cluster;
        Cluster.AssignTypefaces(&Light, &Regular);
        (void)Cluster.PresentSurface(Surface, 1.5f);
        ClusterReading Dials; Dials.SpeedKph = 132.0f; Dials.EngineRpm = 5400.0f; Dials.Gear = "4"; Dials.TractionActive = true;
        Cluster.AssignReading(Dials);
        Check(Cluster.Raster(), (std::string("cluster rasters: ") + H.Name).c_str());
        const DisplaySheetStructure& Sheet = Cluster.QuerySheet();
        const float Expected = kClusterDesignWidth * H.Height / H.Width;
        Check(std::fabs(Cluster.QueryDesignHeight() - std::round(Expected)) < 0.5f, (std::string("design height follows housing aspect: ") + H.Name).c_str());
        const float Coverage = Opaque(Sheet);
        Check(Coverage > 0.5f && Coverage < 1.0f - (H.Outline == DisplayOutlineCategory::Hexagon ? 0.01f : 0.03f), (std::string("mask leaves the housing corners transparent: ") + H.Name).c_str());
        Save(Sheet, Output + "/Cluster_" + H.Name + ".png");
        Cluster.AssignReading(Dials);
        Check(!Cluster.Raster(), (std::string("unchanged reading does not re-raster: ") + H.Name).c_str());
    }

    std::printf("%s (%d failures)\n", Failures == 0 ? "PASS" : "FAIL", Failures);
    return Failures == 0 ? 0 : 1;
}
