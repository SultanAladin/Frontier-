//============================================================================================================================================
//                                                              AIRTYREMETRICS.CPP
//============================================================================================================================================
// 📦 Native tyre centre, inflation, airborne deformation and bead seating in controlled hub and actual vehicle motion.

#include "DriveDynamicsFixture.h"
#include "../../../Projects/Project-Drive/Source/TyreSequence.h"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <string>

using namespace Frontier::Vehicle;
using DriveProof::StepSeconds;

namespace
{

struct TyreDeformationMetrics
{
    Vec3   Centre{};
    double MeanRadius       = 0.0;
    double MinimumRadius    = 1.0e30;
    double MaximumRadius    = 0.0;
    double CentredRange      = 0.0;
    double ShapeMaximum     = 0.0;
    double NativeBeadGap    = 0.0;
    double NativeTreadGap   = 0.0;
};

TyreDeformationMetrics Measure(const XPBDSoftTyre& Tyre)
{
    TyreDeformationMetrics Reading;
    const Vec3 Hub = Tyre.HubPosition();
    const Quat Rotation = Tyre.MaterialFrame();
    const Quat Inverse{-Rotation.x, -Rotation.y, -Rotation.z, Rotation.w};
    const auto& Parameters = Tyre.Params();
    for (const auto& Particle : Tyre.Nodes())
        Reading.Centre += Inverse.Rotate(Particle.Position - Hub) * (1.0f / Tyre.Nodes().size());
    double CentredMinimum = 1.0e30, CentredMaximum = 0.0;
    for (const auto& Particle : Tyre.Nodes())
    {
        const Vec3 Local = Inverse.Rotate(Particle.Position - Hub);
        const double Radius = std::hypot(Local.x, Local.z);
        const double CentredRadius = std::hypot(Local.x - Reading.Centre.x, Local.z - Reading.Centre.z);
        Reading.MeanRadius += Radius / Tyre.Nodes().size();
        Reading.MinimumRadius = std::min(Reading.MinimumRadius, Radius);
        Reading.MaximumRadius = std::max(Reading.MaximumRadius, Radius);
        CentredMinimum = std::min(CentredMinimum, CentredRadius);
        CentredMaximum = std::max(CentredMaximum, CentredRadius);
        Reading.ShapeMaximum = std::max(Reading.ShapeMaximum, static_cast<double>((Local - Particle.TreadLocal).Length()));
    }
    Reading.CentredRange = CentredMaximum - CentredMinimum;
    Frontier::Drive::TyreSequence Projection;
    Projection.Capture(Tyre, Hub, Tyre.HubRotation());
    std::vector<Frontier::Vector3> Vertices;
    std::vector<Frontier::DeformationSpace::Face> Faces;
    Projection.Envelope(Vertices, Faces, false);
    for (uint32_t Ring = 0u; Ring < Parameters.RingCount; ++Ring)
        for (uint32_t Segment = 0u; Segment < Parameters.SegmentCount; ++Segment)
        {
            const auto& Vertex = Vertices[Ring * Parameters.SegmentCount + Segment];
            const auto& Particle = Tyre.Nodes()[(Parameters.RingCount - 1u - Ring) * Parameters.SegmentCount + Segment];
            const Vec3 Local{Vertex.x, Vertex.y, Vertex.z};
            Reading.NativeTreadGap = std::max(Reading.NativeTreadGap, static_cast<double>((Hub + Rotation.Rotate(Local) - Particle.Position).Length()));
        }
    for (uint32_t Side = 0u; Side < 2u; ++Side)
        for (uint32_t Segment = 0u; Segment < Parameters.SegmentCount; ++Segment)
        {
            const auto& Vertex = Vertices[(Parameters.RingCount + 1u - Side) * Parameters.SegmentCount + Segment];
            const Vec3 Local{Vertex.x, Vertex.y, Vertex.z};
            Reading.NativeBeadGap = std::max(Reading.NativeBeadGap,
                static_cast<double>((Local - Tyre.BeadSeats()[Side * Parameters.SegmentCount + Segment]).Length()));
        }
    return Reading;
}

void Capture(std::ofstream& Stream, const XPBDSoftTyre& Tyre)
{
    // 📝 Single-wheel recording; no invented extra wheels or substituted tyre positions.
    const Vec3 Hub = Tyre.HubPosition();
    const Quat Rotation = Tyre.MaterialFrame();
    Stream.write(reinterpret_cast<const char*>(&Hub), sizeof(Hub));
    Stream.write(reinterpret_cast<const char*>(&Rotation), sizeof(Rotation));
    Stream.write(reinterpret_cast<const char*>(&Hub), sizeof(Hub));
    Stream.write(reinterpret_cast<const char*>(&Rotation), sizeof(Rotation));
    for (const auto& Particle : Tyre.Nodes())
        Stream.write(reinterpret_cast<const char*>(&Particle.Position), sizeof(Particle.Position));
}

void Record(const std::string& Name, const std::filesystem::path& Folder)
{
    const bool ActualVehicle = Name.find("vehicle-") == 0u;
    const bool GravityEnabled = Name != "no-gravity-wheel";
    const bool Freefall = Name.find("freefall-") == 0u;
    const bool Unloading = Name == "unload-held-wheel";
    const float Ω = Name == "freefall-spinning-wheel" ? 80.0f : 0.0f;
    DriveProof::DriveFixture Fixture;
    XPBDSoftTyre Isolated;
    VehicleSolverConfiguration Configuration;
    ApplyGeometry(Configuration, VehicleGeometry{});
    Configuration.Tyre.Gravity = GravityEnabled ? Vec3{0.0f, 0.0f, -9.81f} : Vec3{};
    Vec3 Hub{0.0f, 0.0f, Unloading ? 0.47f : 2.0f}, Velocity{};
    const auto Ground = [](const Vec3& Point, Vec3& Surface, Vec3& Normal)
    {
        Surface = {Point.x, Point.y, 0.0f}; Normal = {0.0f, 0.0f, 1.0f}; return true;
    };
    const auto NoGround = [](const Vec3&, Vec3&, Vec3&) { return false; };
    if (ActualVehicle)
    {
        const Vec3 Angular = Name == "vehicle-tumbling" ? Vec3{1.0f, -1.0f, -1.0f}.Normalized() * 12.0f : Vec3{};
        Fixture.Construct({0.0f, 0.0f, 60.0f}, {8.0f, -3.0f, 8.0f}, {}, NoGround, Angular);
        for (auto& Wheel : Fixture.Configuration.Wheels) Wheel.Driven = false;
        Fixture.Rebuild();
    }
    else
    {
        Isolated.Build(Configuration.Tyre, Hub, {});
        Isolated.AssignRigidVelocity({}, {0.0f, Ω, 0.0f}, Hub);
        if (Unloading)
        {
            HubMotion Motion; Motion.Position = Hub;
            for (uint32_t Tick = 0u; Tick < 360u; ++Tick)
                Isolated.Step(StepSeconds, Configuration.TyreSubsteps, Motion, {}, Ground);
        }
    }
    const auto Tyre = [&]() -> const XPBDSoftTyre& { return ActualVehicle ? Fixture.Solver.Tyres()[1] : Isolated; };
    const auto& Parameters = Tyre().Params();
    constexpr uint32_t Ticks = 1440u;
    std::ofstream Csv(Folder / (Name + ".csv")); Csv << std::setprecision(12);
    Csv << "t,centre_x_m,centre_y_m,centre_z_m,world_centre_z_m,mean_radius_m,minimum_radius_m,maximum_radius_m,centred_range_m,shape_max_m,native_bead_gap_m,native_tread_gap_m,contacts,hub_x,hub_y,hub_z,pressure_Pa\n";
    std::ofstream Pictures(Folder / (Name + ".frames"), std::ios::binary);
    const uint32_t Header[] = {0x54554D31u, Parameters.RingCount, Parameters.SegmentCount, Ticks / 12u};
    Pictures.write(reinterpret_cast<const char*>(Header), sizeof(Header));
    std::ofstream(Folder / (Name + ".terrain")) << "1 1 0 0 1\n";
    double MaximumCentre = 0.0, MaximumBeadGap = 0.0;
    for (uint32_t Tick = 0u; Tick <= Ticks; ++Tick)
    {
        if (Tick)
        {
            if (ActualVehicle) Fixture.Advance();
            else
            {
                if (Freefall) { Velocity += Configuration.Tyre.Gravity * StepSeconds; Hub += Velocity * StepSeconds; }
                HubMotion Motion; Motion.Position = Hub; Motion.LinearVelocity = Velocity; Motion.SpinRate = Ω;
                Isolated.Step(StepSeconds, Configuration.TyreSubsteps, Motion, {}, NoGround);
            }
        }
        const auto& Current = Tyre();
        const auto Reading = Measure(Current);
        const Vec3 WorldCentre = Current.MaterialFrame().Rotate(Reading.Centre);
        const auto Position = Current.HubPosition();
        MaximumCentre = std::max(MaximumCentre, static_cast<double>(Reading.Centre.Length()));
        MaximumBeadGap = std::max(MaximumBeadGap, Reading.NativeBeadGap);
        Csv << Tick * static_cast<double>(StepSeconds) << ',' << Reading.Centre.x << ',' << Reading.Centre.y << ',' << Reading.Centre.z << ',' << WorldCentre.z << ','
            << Reading.MeanRadius << ',' << Reading.MinimumRadius << ',' << Reading.MaximumRadius << ',' << Reading.CentredRange << ',' << Reading.ShapeMaximum << ','
            << Reading.NativeBeadGap << ',' << Reading.NativeTreadGap << ',' << Current.Reaction().ContactCount << ',' << Position.x << ',' << Position.y << ',' << Position.z << ',' << Current.Reaction().GaugePressure << '\n';
        if (Tick && Tick % 12u == 0u) Capture(Pictures, Current);
    }
    std::printf("MEASURED %s: centre %.3f mm; native bead %.6f mm\n", Name.c_str(), MaximumCentre * 1000.0, MaximumBeadGap * 1000.0);
    std::fflush(stdout);
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 2 && Count <= 4);
    const std::filesystem::path Folder = Arguments[1];
    const uint32_t Shard = Count > 2 ? static_cast<uint32_t>(std::stoul(Arguments[2])) : 0u;
    const uint32_t Shards = Count > 3 ? static_cast<uint32_t>(std::stoul(Arguments[3])) : 1u;
    std::filesystem::create_directories(Folder);
    const std::string Names[] = {"held-hub-gravity", "no-gravity-wheel", "freefall-wheel", "freefall-spinning-wheel", "unload-held-wheel", "vehicle-freefall", "vehicle-tumbling"};
    for (uint32_t Index = 0u; Index < 7u; ++Index)
        if (Index % Shards == Shard) Record(Names[Index], Folder);
}
