//============================================================================================================================================
//                                                          DRIVECABINDISPLAYS.H
//============================================================================================================================================
// 📦 Project-Drive's two cabin screens over the generic SurfaceDisplay module: the centre tablet (launcher + apps,
//    15 Hz when dirty) and the driver cluster (30 Hz). Each owns its sheet; Frontier.exe copies a moved revision
//    through ProjectDisplayInterchange and binds it to the emissive material DriveSceneAuthor named for it.
//
//    Touch arrives as a world ray; the screens' poses follow the chassis (CoM-local fixtures from DriveCabinLayout
//    rotated by the live orientation), so a tap on the glass of a moving car still lands on the right pixel.
//    The Garage app's turntable is the authored ControlVehicle facets through DisplayMeshProjection — the real car.

#pragma once

#include "../../../Engine/ProjectInterchange/DisplayInterchange.h"
#include "../../../Engine/SurfaceDisplay/ClusterScreenSequence.h"
#include "../../../Engine/SurfaceDisplay/DisplayMeshProjection.h"
#include "../../../Engine/SurfaceDisplay/DisplaySurfaceStructure.h"
#include "../../../Engine/SurfaceDisplay/DisplayTouchProjection.h"
#include "../../../Engine/SurfaceDisplay/TabletScreenSequence.h"
#include "../../../Engine/SurfaceDisplay/TypefaceSheetCodec.h"
#include "DriveCabinLayout.h"

#include <array>
#include <string>

namespace Frontier::Vehicle { struct ChassisState; struct VehicleTelemetry; }

namespace Frontier {
namespace Drive {

struct CabinVehicleReading
{
    float SpeedKph = 0.0f, EngineRpm = 0.0f;
    const char* Gear = "N";
    float TreadCelsius[4] = { 20.0f, 20.0f, 20.0f, 20.0f };
    float PressureKpa[4] = { 185.0f, 185.0f, 185.0f, 185.0f };
    bool  Live = false;
};

class DriveCabinDisplays
{
public:
    // FontDirectory: the Inter archive (…/EngineContent/FontArchives/Inter). ComRebase: model Z − CoM Z, the same
    //    shift DriveSceneAuthor applies to the body so fixtures and facets agree.
    bool Construct(const std::string& FontDirectory, float ComRebase, std::string* Explanation) noexcept;
    [[nodiscard]] bool Ready() const noexcept { return Constructed; }

    // Per project tick: chassis pose for the touch frames, vehicle reading for the gauges, wall-clock seconds for rates.
    void Advance(const Frontier::Vehicle::ChassisState* Chassis, const CabinVehicleReading& Reading, double Seconds) noexcept;

    // The C interchange body. Returns 0 past the last display, 1 accepted, 2 refused.
    uint32_t Deliver(FrontierProjectDisplayReading& Reading) noexcept;

    [[nodiscard]] const TabletScreenSequence&  QueryTablet()  const noexcept { return Tablet; }
    [[nodiscard]] const ClusterScreenSequence& QueryCluster() const noexcept { return Cluster; }

private:
    struct Screen
    {
        CabinFixture            Fixture{};
        DisplaySurfaceStructure Surface;
        DisplayPose             Pose;          // world, refreshed each Advance
        DisplayTouchProjection  Touch;
        DisplayContact          Contact;
        double                  LastRaster = -1.0;
    };
    void RefreshPose(Screen& S, const Frontier::Vehicle::ChassisState* Chassis) noexcept;
    void RasterPreview() noexcept;

    bool                   Constructed = false;
    float                  Rebase = 0.0f;
    TypefaceSheetCodec     Light, Regular, Medium;
    TabletScreenSequence   Tablet;
    ClusterScreenSequence  Cluster;
    std::array<Screen, 2>  Screens;     // 0 tablet, 1 cluster
    DisplayMeshProjection  Preview;
    DisplaySheetStructure  PreviewSheet;
    TabletPreviewSource    PreviewSource;
    double                 LastPreview = -1.0, LastSeconds = 0.0;
    float                  PreviewSpin = 0.0f;
    std::string            Caption;
};

} // namespace Drive
} // namespace Frontier
