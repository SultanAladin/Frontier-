//============================================================================================================================================
//                                                        CABINFIXTUREPROOF.CPP
//============================================================================================================================================
// 🧩 Where the cabin HMI landed in the REAL ControlVehicle: builds the authored Drive scene (DriveSceneAuthor, the
//    body span with its screens and headliner lamp) and projects it flat through DisplayMeshProjection — a quick
//    diagnostic, not a render. Three sheets: the driver's eye, an exterior three-quarter cutaway (roof removed so
//    the dash is visible), and a plan view. Also exercises the touch frame: a ray from the driver's eye to the
//    tablet centre must land on the tablet sheet's middle pixel, through the same pose maths the DLL uses.
//
//    Build (see VisualProof/SurfaceDisplay/README.md).

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include "../../../Projects/Project-Drive/Source/DriveCabinLayout.h"
#include "../../../Projects/Project-Drive/Source/DriveCourse.h"
#include "../../../Projects/Project-Drive/Source/DriveSceneAuthor.h"
#include "SurfaceDisplay/DisplayMeshProjection.h"
#include "SurfaceDisplay/DisplayTouchProjection.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace Frontier;

namespace {
int Failures = 0;
void Check(bool Condition, const char* What) { std::printf("  %s %s\n", Condition ? "PASS" : "FAIL", What); if (!Condition) ++Failures; }
void Save(const DisplaySheetStructure& Sheet, const std::string& Path)
{
    const int Ok = stbi_write_png(Path.c_str(), static_cast<int>(Sheet.QueryWidth()), static_cast<int>(Sheet.QueryHeight()), 4, Sheet.QueryTexels(), static_cast<int>(Sheet.QueryWidth() * 4u));
    std::printf("  %s %s\n", Ok ? "wrote" : "FAILED", Path.c_str());
    if (!Ok) ++Failures;
}
DisplayMeshFamily Palette(uint32_t M)
{
    switch (M)
    {
    case Drive::MatBodyPaint:      return { { 0xd6, 0xe6, 0x1a, 255 }, 0.9f, false };
    case Drive::MatVehicleGlass:   return { { 0x3a, 0x48, 0x52, 255 }, 1.0f, false };
    case Drive::MatVehiclePlastic: return { { 0x1a, 0x1a, 0x1c, 255 }, 0.2f, false };
    case Drive::MatVehicleTrim:    return { { 0x9a, 0x9e, 0xa4, 255 }, 0.5f, false };
    case Drive::MatHeadlight:      return { { 0xff, 0xf6, 0xe0, 255 }, 0.0f, true };
    case Drive::MatTaillight:      return { { 0xe0, 0x1c, 0x24, 255 }, 0.0f, true };
    case Drive::MatCabinTablet:    return { { 0x7f, 0xd8, 0xb0, 255 }, 0.0f, true };   // screens are drawn as flat emitters: mint tablet,
    case Drive::MatCabinCluster:   return { { 0xf0, 0xc2, 0x7a, 255 }, 0.0f, true };   //   amber cluster, warm lamp — so they read at a glance
    case Drive::MatCabinLamp:      return { { 0xff, 0xe4, 0xb0, 255 }, 0.0f, true };
    case Drive::MatCabinBezel:     return { { 0x30, 0x30, 0x34, 255 }, 0.1f, false };
    case Drive::MatTyre:           return { { 0x2c, 0x2c, 0x2e, 255 }, 0.1f, false };
    default:                       return { { 0xb0, 0xb0, 0xb0, 255 }, 0.3f, false };
    }
}
} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::string Output = ArgumentCount > 1 ? Arguments[1] : "VisualProof/SurfaceDisplay";

    Drive::DriveSceneAuthor Author;
    Author.Construct(/*StaticPose=*/true);
    const std::vector<TriangleIndex>& Facets = Author.QueryTriangles();
    const std::vector<TriangleSpanRecord>& Spans = Author.QuerySpans();
    Check(Spans.size() >= 5u, "authored spans present");

    // Body + wheels only (spans 0-4): the course would swamp the views.
    std::vector<float> Positions; std::vector<uint32_t> Indices, Family;
    uint32_t FixtureFacets = 0u, LampFacets = 0u;
    for (uint32_t S = 0u; S < 5u && S < Spans.size(); ++S)
        for (uint32_t T = Spans[S].FirstTriangle; T < Spans[S].FirstTriangle + Spans[S].TriangleCount; ++T)
        {
            const TriangleIndex& F = Facets[T];
            uint32_t M = 0u; std::memcpy(&M, &F.MaterialSlot, sizeof(M));
            const uint32_t Base = static_cast<uint32_t>(Positions.size() / 3u);
            Positions.insert(Positions.end(), { F.VertexAlphaX, F.VertexAlphaY, F.VertexAlphaZ, F.VertexBetaX, F.VertexBetaY, F.VertexBetaZ, F.VertexGammaX, F.VertexGammaY, F.VertexGammaZ });
            Indices.insert(Indices.end(), { Base, Base + 1u, Base + 2u });
            Family.push_back(M);
            if (M == Drive::MatCabinTablet || M == Drive::MatCabinCluster) ++FixtureFacets;
            if (M == Drive::MatCabinLamp) ++LampFacets;
        }
    Check(FixtureFacets > 0u, "screen glass facets on the body span");
    Check(LampFacets == 20u, "headliner lamp disc on the body span");

    std::vector<DisplayMeshFamily> Families(Drive::MatCabinCount);
    for (uint32_t M = 0u; M < Drive::MatCabinCount; ++M) Families[M] = Palette(M);
    DisplayMeshProjection Projection;
    Projection.AssignMesh(Positions.data(), static_cast<uint32_t>(Positions.size() / 3u), Indices.data(), static_cast<uint32_t>(Indices.size() / 3u), Family.data(), Families.data(), static_cast<uint32_t>(Families.size()));

    // StaticPose lifts the body by CoMHeight + 0.02 (wheels on the floor); fixtures are in the same frame.
    Frontier::Vehicle::VehicleGeometry Geometry;
    const float Lift = Geometry.CoMHeight + 0.02f, Rebase = Geometry.CoMModelZ();
    auto Model = [&](const float* P) { return std::array<float, 3>{ P[0], P[1], P[2] - Rebase + Lift }; };

    DisplaySheetStructure Sheet(960u, 600u);
    DisplayMeshView View;
    View.DrawFloorDisc = false;
    View.Background = { 0x10, 0x14, 0x18, 255 };

    // ① Driver's eye: LHD seat, eye ~0.25 m behind the model origin, 1.0 m above it.
    const float EyeModel[3] = { -0.25f, 0.42f, 1.02f };
    const auto Eye = Model(EyeModel);
    View.UseEye = true; View.Eye[0] = Eye[0]; View.Eye[1] = Eye[1]; View.Eye[2] = Eye[2];
    const float Look[3] = { 1.2f, 0.25f, 0.85f };
    const auto LookAt = Model(Look);
    View.Target[0] = LookAt[0]; View.Target[1] = LookAt[1]; View.Target[2] = LookAt[2];
    View.FieldOfView = 1.25f;
    View.LightDirection[0] = -0.5f; View.LightDirection[1] = 0.2f; View.LightDirection[2] = 0.84f;
    Projection.Raster(Sheet, View);
    Save(Sheet, Output + "/Cabin_DriverEye.png");

    // ② Exterior three-quarter cutaway, roof removed above the cowl line and the glazing dropped so the dash shows.
    {
        std::vector<float> Open; std::vector<uint32_t> OpenIndices, OpenFamily;
        for (uint32_t T = 0u; T < Family.size(); ++T)
        {
            if (Family[T] == Drive::MatVehicleGlass) continue;
            const uint32_t Base = static_cast<uint32_t>(Open.size() / 3u);
            for (int K = 0; K < 3; ++K) Open.insert(Open.end(), Positions.begin() + Indices[T * 3u + K] * 3u, Positions.begin() + Indices[T * 3u + K] * 3u + 3u);
            OpenIndices.insert(OpenIndices.end(), { Base, Base + 1u, Base + 2u });
            OpenFamily.push_back(Family[T]);
        }
        Projection.AssignMesh(Open.data(), static_cast<uint32_t>(Open.size() / 3u), OpenIndices.data(), static_cast<uint32_t>(OpenIndices.size() / 3u), OpenFamily.data(), Families.data(), static_cast<uint32_t>(Families.size()));
    }
    View.UseEye = true;
    View.Eye[0] = 5.2f; View.Eye[1] = 3.6f; View.Eye[2] = 3.4f;
    View.Target[0] = 0.4f; View.Target[1] = 0.1f; View.Target[2] = 0.9f;
    View.FieldOfView = 0.7f;
    View.Cutaway = true; View.CutawayAboveZ = Model(Drive::CabinTabletFixture().Centre)[2] + 0.42f;
    View.LightDirection[0] = 0.4f; View.LightDirection[1] = 0.3f; View.LightDirection[2] = 0.86f;
    Projection.Raster(Sheet, View);
    Save(Sheet, Output + "/Cabin_Cutaway.png");

    // ③ Plan view with the same cutaway.
    View.Eye[0] = 0.6f; View.Eye[1] = 0.01f; View.Eye[2] = 7.5f;
    View.Target[0] = 0.6f; View.Target[1] = 0.0f; View.Target[2] = 0.9f;
    View.FieldOfView = 0.8f;
    Projection.Raster(Sheet, View);
    Save(Sheet, Output + "/Cabin_Plan.png");

    // ④ Touch frame: eye → tablet centre must hit the tablet's middle pixel (same basis as the DLL).
    {
        const Drive::CabinFixture F = Drive::CabinTabletFixture();
        DisplaySurfaceStructure Surface; Surface.Construct(F.Screen);
        DisplayPose Pose;
        float Right[3], Up[3], Toward[3];
        Drive::CabinScreenBasis(F.Tilt, Right, Up, Toward);
        const auto Centre = Model(F.Centre);
        for (int K = 0; K < 3; ++K) { Pose.Origin[K] = Centre[K]; Pose.Right[K] = Right[K]; Pose.Up[K] = Up[K]; Pose.Normal[K] = Toward[K]; }
        const float Origin[3] = { Eye[0], Eye[1], Eye[2] };
        float Direction[3] = { Centre[0] - Eye[0], Centre[1] - Eye[1], Centre[2] - Eye[2] };
        const float L = std::sqrt(Direction[0] * Direction[0] + Direction[1] * Direction[1] + Direction[2] * Direction[2]);
        for (float& D : Direction) D /= L;
        const DisplayContact Contact = DisplayTouchProjection::Resolve(Origin, Direction, Pose, Surface);
        const float W = static_cast<float>(Surface.QuerySheetWidth()), H = static_cast<float>(Surface.QuerySheetHeight());
        Check(Contact.Hit, "driver's ray to the tablet centre hits the glass");
        Check(Contact.Hit && std::fabs(Contact.Across - W / 2.0f) < 2.0f && std::fabs(Contact.Down - H / 2.0f) < 2.0f, "contact lands on the middle pixel");
        std::printf("  contact %.1f, %.1f of %.0f x %.0f at %.2f m; screen faces the driver: dot %.2f\n", Contact.Across, Contact.Down, W, H, Contact.Distance,
                    -(Toward[0] * Direction[0] + Toward[1] * Direction[1] + Toward[2] * Direction[2]));
        Check(-(Toward[0] * Direction[0] + Toward[1] * Direction[1] + Toward[2] * Direction[2]) > 0.7f, "tablet normal faces the driver");
    }
    std::printf("%s (%d failures)\n", Failures == 0 ? "PASS" : "FAIL", Failures);
    return Failures == 0 ? 0 : 1;
}
