//============================================================================================================================================
//                                                          DRIVECABINDISPLAYS.CPP
//============================================================================================================================================
// 📦 Tablet at ≤ 15 Hz when dirty, cluster at 30 Hz, Garage turntable at 10 Hz while spinning — three rates, one module.

#include "DriveCabinDisplays.h"

#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.h"
#include "ControlVehicleMesh.inl"
#include "DriveCourse.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <ctime>

namespace Frontier {
namespace Drive {

namespace {
constexpr double kTabletInterval  = 1.0 / 15.0;
constexpr double kClusterInterval = 1.0 / 30.0;
constexpr double kPreviewInterval = 1.0 / 10.0;
constexpr uint32_t kPreviewWidth = 640u, kPreviewHeight = 400u;

// The authored family palette for the turntable, sRGB — the same families DriveSceneAuthor renders physically.
DisplayMeshFamily FamilyColour(uint32_t Family) noexcept
{
    switch (Family)
    {
    case MatBodyPaint:      return { { 0xd6, 0xe6, 0x1a, 255 }, 0.9f, false };   // MetalicCoat 0.68/0.80/0 linear
    case MatVehicleGlass:   return { { 0x2a, 0x33, 0x3a, 255 }, 1.0f, false };
    case MatVehiclePlastic: return { { 0x16, 0x16, 0x18, 255 }, 0.2f, false };
    case MatTyre:           return { { 0x2c, 0x2c, 0x2e, 255 }, 0.1f, false };
    case MatHub:            return { { 0x45, 0x80, 0xcc, 255 }, 0.6f, false };
    case MatVehicleTrim:    return { { 0x9a, 0x9e, 0xa4, 255 }, 0.5f, false };
    case MatHeadlight:      return { { 0xff, 0xf6, 0xe0, 255 }, 0.0f, true };
    case MatTaillight:      return { { 0xe0, 0x1c, 0x24, 255 }, 0.0f, true };
    default:                return { { 0xb8, 0xb8, 0xb8, 255 }, 0.3f, false };
    }
}
} // namespace

bool DriveCabinDisplays::Construct(const std::string& FontDirectory, float ComRebase, std::string* Explanation) noexcept
{
    Rebase = ComRebase;
    std::string Why;
    if (!Light.Decode(FontDirectory + "/Inter-Light.otf", &Why) || !Regular.Decode(FontDirectory + "/Inter-Regular.otf", &Why) ||
        !Medium.Decode(FontDirectory + "/Inter-Medium.otf", &Why))
    {
        if (Explanation) *Explanation = "cabin displays: typeface missing under " + FontDirectory + " (" + Why + ")";
        return false;
    }
    Screens[0].Fixture = CabinTabletFixture();
    Screens[1].Fixture = CabinClusterFixture();
    for (Screen& S : Screens)
    {
        S.Surface.Construct(S.Fixture.Screen);
        // Touch slop in sheet pixels: a 1200 px sheet seen from the driver's seat spans a few hundred screen pixels,
        //    so one pixel of mouse jitter is several sheet pixels — 2.5 % of the width keeps a tap a tap.
        DisplayTouchConfiguration Touch;
        Touch.SlopPixels = std::max(12.0f, 0.025f * static_cast<float>(S.Surface.QuerySheetWidth()));
        S.Touch.Configure(Touch);
    }

    Tablet.AssignTypefaces(&Light, &Regular, &Medium);
    (void)Tablet.PresentAspect(Screens[0].Fixture.Screen.Width / Screens[0].Fixture.Screen.Height, 1.0f);
    Cluster.AssignTypefaces(&Light, &Regular);
    (void)Cluster.PresentSurface(Screens[1].Surface, 1.5f);
    // Ignition: both panels power on through the engine's startup sequence — the tablet a little longer than the
    //    cluster, as a tablet boots slower than an instrument self-test; the seeds keep the two swarms distinct.
    Tablet.BeginStartup(2.8f, 0x44415249u, "FRONTIER");
    Cluster.BeginStartup(1.9f, 0x434c5553u, nullptr);

    // The Garage turntable: the authored shell with its family palette.
    {
        using namespace Frontier::Drive::ControlVehicleMesh;
        DisplayMeshFamily Families[MatCount];
        for (uint32_t F = 0u; F < MatCount; ++F) Families[F] = FamilyColour(F);
        Preview.AssignMesh(kPositions, kVertexCount, kTriangles, kTriangleCount, kTriangleFamily, Families, MatCount);
        PreviewSheet.Resize(kPreviewWidth, kPreviewHeight);
        PreviewSource.Sheet = &PreviewSheet;
        PreviewSource.Facets = kTriangleCount;
        PreviewSource.Spin = true;
        Tablet.AssignPreview(&PreviewSource);
        RasterPreview();
    }
    Constructed = true;
    return true;
}

void DriveCabinDisplays::RefreshPose(Screen& S, const Frontier::Vehicle::ChassisState* Chassis) noexcept
{
    float Right[3], Up[3], Toward[3];
    CabinScreenBasis(S.Fixture.Tilt, Right, Up, Toward);
    const float Local[3] = { S.Fixture.Centre[0], S.Fixture.Centre[1], S.Fixture.Centre[2] - Rebase };
    if (!Chassis)
    {
        std::memcpy(S.Pose.Origin, Local, sizeof(Local));
        std::memcpy(S.Pose.Right, Right, sizeof(Right)); std::memcpy(S.Pose.Up, Up, sizeof(Up)); std::memcpy(S.Pose.Normal, Toward, sizeof(Toward));
        return;
    }
    auto World = [&](const float V[3], bool Point)
    {
        const Frontier::Vehicle::Vec3 R = Chassis->Orientation.Rotate({ V[0], V[1], V[2] });
        return Frontier::Vehicle::Vec3{ R.x + (Point ? Chassis->Position.x : 0.0f), R.y + (Point ? Chassis->Position.y : 0.0f), R.z + (Point ? Chassis->Position.z : 0.0f) };
    };
    const auto O = World(Local, true), Rw = World(Right, false), Uw = World(Up, false), Nw = World(Toward, false);
    S.Pose.Origin[0] = O.x; S.Pose.Origin[1] = O.y; S.Pose.Origin[2] = O.z;
    S.Pose.Right[0] = Rw.x; S.Pose.Right[1] = Rw.y; S.Pose.Right[2] = Rw.z;
    S.Pose.Up[0] = Uw.x; S.Pose.Up[1] = Uw.y; S.Pose.Up[2] = Uw.z;
    S.Pose.Normal[0] = Nw.x; S.Pose.Normal[1] = Nw.y; S.Pose.Normal[2] = Nw.z;
}

void DriveCabinDisplays::RasterPreview() noexcept
{
    DisplayMeshView View;
    View.Yaw = 0.6f + PreviewSpin + PreviewSource.OrbitYaw;
    View.Pitch = std::clamp(0.30f + PreviewSource.OrbitPitch, 0.05f, 1.2f);
    Preview.Raster(PreviewSheet, View);
    PreviewSource.Dirty = false;
    Tablet.MarkDirty();
}

void DriveCabinDisplays::Advance(const Frontier::Vehicle::ChassisState* Chassis, const CabinVehicleReading& Reading, double Seconds) noexcept
{
    if (!Constructed) return;
    const double Interval = LastSeconds > 0.0 ? std::clamp(Seconds - LastSeconds, 0.0, 0.25) : 0.0;
    LastSeconds = Seconds;
    for (Screen& S : Screens) RefreshPose(S, Chassis);

    // Clock from the wall, like the prototype's status bar.
    {
        const std::time_t Now = std::time(nullptr);
        std::tm Local{};
#if defined(_WIN32)
        localtime_s(&Local, &Now);
#else
        localtime_r(&Now, &Local);
#endif
        Tablet.AdvanceClock(Local.tm_hour, Local.tm_min);
    }

    TabletReading T;
    T.SpeedKph = Reading.SpeedKph; T.Gear = Reading.Gear; T.Live = Reading.Live;
    std::memcpy(T.TreadCelsius, Reading.TreadCelsius, sizeof(T.TreadCelsius));
    std::memcpy(T.PressureKpa, Reading.PressureKpa, sizeof(T.PressureKpa));
    Tablet.AssignReading(T);

    ClusterReading C;
    C.SpeedKph = Reading.SpeedKph; C.EngineRpm = Reading.EngineRpm; C.Gear = Reading.Gear;
    C.TractionActive = Reading.EngineRpm > 6500.0f;
    Caption = Reading.Live ? "LIVE VEHICLE · PROJECT-DRIVE" : "DEMONSTRATION DRIVE · NO LIVE VEHICLE";
    C.Caption = Caption.c_str();
    Cluster.AssignReading(C);

    // Turntable: spins at 0.4 rad/s while Spin is on; a drag marks it dirty.
    if (PreviewSource.Spin) PreviewSpin += static_cast<float>(Interval) * 0.4f;
    if ((PreviewSource.Spin || PreviewSource.Dirty) && Tablet.QueryReading().Application && std::strcmp(Tablet.QueryReading().Application, "garage") == 0 &&
        Seconds - LastPreview >= kPreviewInterval)
    {
        LastPreview = Seconds;
        RasterPreview();
    }

    // The startup sequences clock on the display time base and raster at the cluster's rate while they run.
    (void)Tablet.AdvanceStartup(Seconds);
    (void)Cluster.AdvanceStartup(Seconds);
    const double TabletInterval = Tablet.StartupActive() ? kClusterInterval : kTabletInterval;
    if (Tablet.IsDirty() && Seconds - Screens[0].LastRaster >= TabletInterval) { if (Tablet.Raster()) Screens[0].LastRaster = Seconds; }
    if (Cluster.IsDirty() && Seconds - Screens[1].LastRaster >= kClusterInterval) { if (Cluster.Raster()) Screens[1].LastRaster = Seconds; }
}

uint32_t DriveCabinDisplays::Deliver(FrontierProjectDisplayReading& Reading) noexcept
{
    if (Reading.StructureSize != sizeof(FrontierProjectDisplayReading) || Reading.InterchangeNumber != 2u) return 2u;
    if (!Constructed || Reading.Ordinal >= Screens.size()) return 0u;
    Screen& S = Screens[Reading.Ordinal];
    const DisplaySheetStructure& Sheet = Reading.Ordinal == 0u ? Tablet.QuerySheet() : Cluster.QuerySheet();
    Reading.SubjectName = S.Fixture.Name;
    Reading.Width = Sheet.QueryWidth(); Reading.Height = Sheet.QueryHeight();
    Reading.Revision = Sheet.QueryRevision();
    Reading.Luminance = S.Fixture.Screen.EmissionLuminance;

    // Touch: a zero direction is "no pointer"; the state machine still needs the release.
    const bool HasRay = Reading.RayDirection[0] != 0.0f || Reading.RayDirection[1] != 0.0f || Reading.RayDirection[2] != 0.0f;
    DisplayContact Contact;
    if (HasRay) Contact = DisplayTouchProjection::Resolve(Reading.RayOrigin, Reading.RayDirection, S.Pose, S.Surface);
    S.Contact = Contact;
    const DisplayTouchReading Touch = S.Touch.Advance(Contact, Reading.Pressed != 0u, static_cast<float>(LastSeconds));
    if (Reading.Ordinal == 0u) Tablet.ForwardTouch(Touch);
    Reading.ContactHit = Contact.Hit ? 1u : 0u;
    Reading.ContactAcross = Contact.Across; Reading.ContactDown = Contact.Down;

    // Typing: the host's UTF-8 for this frame goes to the focused field, one code point at a time.
    if (Reading.Ordinal == 0u && Reading.TypedText && Tablet.WantsText())
    {
        const unsigned char* Byte = reinterpret_cast<const unsigned char*>(Reading.TypedText);
        while (*Byte)
        {
            uint32_t Codepoint = *Byte, Continuations = 0u;
            if (*Byte >= 0xF0u) { Codepoint = *Byte & 0x07u; Continuations = 3u; }
            else if (*Byte >= 0xE0u) { Codepoint = *Byte & 0x0Fu; Continuations = 2u; }
            else if (*Byte >= 0xC0u) { Codepoint = *Byte & 0x1Fu; Continuations = 1u; }
            ++Byte;
            for (; Continuations > 0u && (*Byte & 0xC0u) == 0x80u; --Continuations, ++Byte) Codepoint = (Codepoint << 6) | (*Byte & 0x3Fu);
            Tablet.TypeCharacter(Codepoint);
        }
    }
    Reading.TextWanted = (Reading.Ordinal == 0u && Tablet.WantsText()) ? 1u : 0u;

    if (Reading.Capacity == 0u) return 1u;
    if (!Reading.Texels || Reading.Capacity < Sheet.QueryByteCount()) return 2u;
    std::memcpy(Reading.Texels, Sheet.QueryTexels(), static_cast<size_t>(Sheet.QueryByteCount()));
    return 1u;
}

} // namespace Drive
} // namespace Frontier
