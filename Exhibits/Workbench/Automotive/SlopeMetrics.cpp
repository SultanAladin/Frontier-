//============================================================================================================================================
//                                                              SLOPEMETRICS.CPP
//============================================================================================================================================
// 📦 Powered approach, moving brakes, signed slope travel and native-versus-physical bead geometry measurements.

#include "DriveDynamicsFixture.h"
#include "../../../Projects/Project-Drive/Source/TyreSequence.h"

#include <fstream>
#include <iomanip>
#include <string>

using namespace Frontier::Vehicle;
using DriveProof::DriveFixture;
using DriveProof::StepSeconds;

namespace
{

struct SlopeSpecification
{
    std::string Name;
    float Incline = 20.0f, Heading = 0.0f, Friction = 0.8f;
    uint32_t Brakes = 0u;
    bool Driven = true;
};

struct SlopeReading
{
    double BrakeStartSpeed = 0.0, FinalSpeed = 0.0, StopTime = -1.0;
    double DriveUphill = 0.0, FinalUphill = 0.0, BrakeDisplacement = 0.0;
    double NativeBeadGap = 0.0, PhysicalBeadGap = 0.0;
    double PositiveBrakePower = 0.0, PositiveContactPower = 0.0;
    double PeakRadius = 0.0, PeakShape = 0.0;
};

void Capture(std::ofstream& Stream, const DriveFixture& Fixture)
{
    Stream.write(reinterpret_cast<const char*>(&Fixture.Body.Position), sizeof(Vec3));
    Stream.write(reinterpret_cast<const char*>(&Fixture.Body.Orientation), sizeof(Quat));
    for (const auto& Tyre : Fixture.Solver.Tyres())
    {
        const Vec3 Hub = Tyre.HubPosition(); const Quat Rotation = Tyre.MaterialFrame();
        Stream.write(reinterpret_cast<const char*>(&Hub), sizeof(Hub));
        Stream.write(reinterpret_cast<const char*>(&Rotation), sizeof(Rotation));
        for (const auto& Particle : Tyre.Nodes()) Stream.write(reinterpret_cast<const char*>(&Particle.Position), sizeof(Vec3));
    }
}

SlopeReading Record(const SlopeSpecification& Specification, const std::filesystem::path& Folder)
{
    const Quat Incline = Quat::AxisAngle({0, 1, 0}, -Specification.Incline * 0.01745329252f);
    const Quat Rotation = (Incline * Quat::AxisAngle({0, 0, 1}, Specification.Heading * 0.01745329252f)).Normalized();
    const Vec3 Normal = Incline.Rotate({0, 0, 1}), Uphill = Incline.Rotate({1, 0, 0});
    const Vec3 Forward = Rotation.Rotate({1, 0, 0}), Across{0, 1, 0};
    const auto Ground = [&](const Vec3& Point, Vec3& Surface, Vec3& Outward)
    {
        Outward = Normal; Surface = Point - Normal * Dot(Point, Normal); return true;
    };
    DriveFixture Fixture;
    Fixture.Construct(Normal * 0.54f, {}, Rotation, Ground);
    Fixture.Configuration.GripCoefficient = Specification.Friction;
    if (!Specification.Driven) for (auto& Wheel : Fixture.Configuration.Wheels) Wheel.Driven = false;
    Fixture.Rebuild();
    const Vec3 Origin = Fixture.Body.Position;
    Vec3 DriveOrigin = Origin, BrakeOrigin = Origin;
    constexpr uint32_t Ticks = 1680u;
    constexpr uint32_t DriveTick = 360u, BrakeTick = 840u;
    std::ofstream Csv(Folder / (Specification.Name + ".csv")); Csv << std::setprecision(12);
    Csv << "t,phase,throttle,brake,handbrake,x,y,z,vx,vy,vz,uphill_m,across_m,forward_m,uphill_speed,across_speed,forward_speed,tangent_speed,body_uphill_force_N,body_across_force_N,gravity_uphill_N,normal_load_N,brake_capacity_Nm,applied_brake_Nm,brake_power_W,contact_power_W,static_power_W,drive_power_W,native_bead_gap_m,physical_bead_gap_m,radius_m,shape_max_m,resting_converged\n";
    std::ofstream Pictures(Folder / (Specification.Name + ".frames"), std::ios::binary);
    const uint32_t Header[] = {0x54554D42u, Fixture.Configuration.Tyre.RingCount, Fixture.Configuration.Tyre.SegmentCount, Ticks / 12u};
    Pictures.write(reinterpret_cast<const char*>(Header), sizeof(Header));
    std::ofstream Terrain(Folder / (Specification.Name + ".terrain")); Terrain << 3 << " 1 " << Normal.x << ' ' << Normal.y << ' ' << Normal.z << '\n';
    SlopeReading Result;
    for (uint32_t Tick = 0u; Tick <= Ticks; ++Tick)
    {
        const uint32_t Phase = Tick < DriveTick ? 0u : Tick < BrakeTick ? 1u : 2u;
        DriverInput Input;
        if (Phase == 0u) Input.Brake = 1.0f;
        if (Phase == 1u && Specification.Driven) Input.Throttle = 0.4f;
        if (Phase == 2u) { Input.Brake = Specification.Brakes == 1u ? 1.0f : 0.0f; Input.Handbrake = Specification.Brakes == 2u; }
        if (Tick == DriveTick) DriveOrigin = Fixture.Body.Position;
        if (Tick == BrakeTick)
        {
            BrakeOrigin = Fixture.Body.Position;
            const Vec3 Velocity = Fixture.Body.LinearVelocity;
            Result.BrakeStartSpeed = (Velocity - Normal * Dot(Velocity, Normal)).Length();
            Result.DriveUphill = Dot(BrakeOrigin - DriveOrigin, Uphill);
        }
        if (Tick) Fixture.Advance(Input);
        const auto& Body = Fixture.Body;
        const auto& Telemetry = Fixture.Solver.Telemetry();
        const Vec3 Displacement = Body.Position - Origin;
        const Vec3 TangentVelocity = Body.LinearVelocity - Normal * Dot(Body.LinearVelocity, Normal);
        const double Speed = TangentVelocity.Length();
        double NativeGap = 0.0, PhysicalGap = 0.0, Radius = 0.0, Shape = 0.0;
        double BrakeCapacity = 0.0, AppliedBrake = 0.0, BrakePower = 0.0, ContactPower = 0.0, StaticPower = 0.0, DrivePower = 0.0;
        for (size_t Corner = 0u; Corner < Fixture.Solver.Tyres().size(); ++Corner)
        {
            const auto& Tyre = Fixture.Solver.Tyres()[Corner]; const auto& Parameters = Tyre.Params();
            const auto& Reading = Telemetry.Wheels[Corner]; const auto Energy = Tyre.Energy();
            Radius = std::max(Radius, Energy.Radius); Shape = std::max(Shape, Energy.ShapeMax);
            BrakeCapacity += Reading.RequestedBrakeTorque; AppliedBrake += std::abs(Reading.AppliedBrakeTorque);
            BrakePower += Reading.BrakePower_W; ContactPower += Reading.ContactPower_W; StaticPower += Reading.StaticContactPower_W; DrivePower += Reading.DrivePower_W;
            Frontier::Drive::TyreSequence Projection;
            Projection.Capture(Tyre, Tyre.HubPosition(), Tyre.HubRotation());
            const Quat Material = Tyre.MaterialFrame();
            for (uint32_t Side = 0u; Side < 2u; ++Side)
                for (uint32_t Segment = 0u; Segment < Parameters.SegmentCount; Segment += 4u)
                {
                    const float θ = 6.28318530718f * Segment / Parameters.SegmentCount;
                    const float Sign = Side == 0u ? -1.0f : 1.0f;
                    const Vec3 Local{Parameters.RimRadius * std::cos(θ), Sign * Parameters.Width * 0.5f * 0.74f, Parameters.RimRadius * std::sin(θ)};
                    const Vec3 RimPoint = Tyre.HubPosition() + Material.Rotate(Local);
                    const auto Published = Projection.Project({Local.x, Local.y, Local.z});
                    NativeGap = std::max(NativeGap, static_cast<double>((Vec3{Published.x, Published.y, Published.z} - RimPoint).Length()));
                    const uint32_t Ring = Side == 0u ? 0u : Parameters.RingCount - 1u;
                    const Vec3 Physical = Tyre.HubPosition() + Material.Rotate(Tyre.Nodes()[Ring * Parameters.SegmentCount + Segment].BeadLocal);
                    PhysicalGap = std::max(PhysicalGap, static_cast<double>((Physical - RimPoint).Length()));
                }
        }
        Result.NativeBeadGap = std::max(Result.NativeBeadGap, NativeGap); Result.PhysicalBeadGap = std::max(Result.PhysicalBeadGap, PhysicalGap);
        Result.PositiveBrakePower = std::max(Result.PositiveBrakePower, BrakePower);
        Result.PositiveContactPower = std::max(Result.PositiveContactPower, ContactPower + StaticPower);
        Result.PeakRadius = std::max(Result.PeakRadius, Radius); Result.PeakShape = std::max(Result.PeakShape, Shape);
        if (Tick > BrakeTick && Speed < 0.05 && Result.StopTime < 0.0) Result.StopTime = (Tick - BrakeTick) * StepSeconds;
        Result.FinalSpeed = Speed; Result.FinalUphill = Dot(Body.Position - DriveOrigin, Uphill);
        Result.BrakeDisplacement = (Body.Position - BrakeOrigin - Normal * Dot(Body.Position - BrakeOrigin, Normal)).Length();
        Csv << Tick * static_cast<double>(StepSeconds) << ',' << Phase << ',' << Input.Throttle << ',' << Input.Brake << ',' << Input.Handbrake << ','
            << Body.Position.x << ',' << Body.Position.y << ',' << Body.Position.z << ',' << Body.LinearVelocity.x << ',' << Body.LinearVelocity.y << ',' << Body.LinearVelocity.z << ','
            << Dot(Displacement, Uphill) << ',' << Dot(Displacement, Across) << ',' << Dot(Displacement, Forward) << ','
            << Dot(Body.LinearVelocity, Uphill) << ',' << Dot(Body.LinearVelocity, Across) << ',' << Dot(Body.LinearVelocity, Forward) << ',' << Speed << ','
            << Dot(Body.LastForce, Uphill) << ',' << Dot(Body.LastForce, Across) << ',' << Fixture.Body.Mass * Dot(Fixture.Configuration.Gravity, Uphill) << ','
            << Telemetry.TotalVerticalLoad << ',' << BrakeCapacity << ',' << AppliedBrake << ',' << BrakePower << ',' << ContactPower << ',' << StaticPower << ',' << DrivePower << ','
            << NativeGap << ',' << PhysicalGap << ',' << Radius << ',' << Shape << ',' << Telemetry.RestingContactConverged << '\n';
        if (Tick > 0u && Tick % 12u == 0u) Capture(Pictures, Fixture);
    }
    return Result;
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 2 && Count <= 5);
    const std::filesystem::path Folder = Arguments[1]; std::filesystem::create_directories(Folder);
    const uint32_t Shard = Count > 2 ? static_cast<uint32_t>(std::stoul(Arguments[2])) : 0u;
    const uint32_t Shards = Count > 3 ? static_cast<uint32_t>(std::stoul(Arguments[3])) : 1u;
    const std::string Selection = Count > 4 ? Arguments[4] : "all";
    std::vector<SlopeSpecification> Specifications;
    for (float Heading : {0.0f, 180.0f, 90.0f, -90.0f})
        for (uint32_t Brakes = 0u; Brakes < 3u; ++Brakes)
            Specifications.push_back({"moving-20-heading-" + std::to_string(static_cast<int>(Heading)) + "-brakes-" + std::to_string(Brakes), 20.0f, Heading, 0.8f, Brakes, true});
    Specifications.push_back({"moving-35-downhill-service", 35.0f, 180.0f, 0.8f, 1u, true});
    Specifications.push_back({"released-20-frictionless", 20.0f, 0.0f, 0.0f, 0u, false});
    std::ofstream Results(Folder / "SlopeResults.json"); Results << std::setprecision(12) << "{\"cpuOnly\":true,\"rateHz\":240,\"snapshotRateHz\":20,\"cases\":[";
    bool First = true;
    for (size_t Index = 0u; Index < Specifications.size(); ++Index)
    {
        const auto& Specification = Specifications[Index];
        if (Index % Shards != Shard || (Selection != "all" && Specification.Name.find(Selection) == std::string::npos)) continue;
        const auto Reading = Record(Specification, Folder);
        if (!First) Results << ','; First = false;
        Results << "{\"name\":\"" << Specification.Name << "\",\"incline\":" << Specification.Incline << ",\"heading\":" << Specification.Heading << ",\"friction\":" << Specification.Friction
                << ",\"brakes\":" << Specification.Brakes << ",\"driven\":" << (Specification.Driven ? "true" : "false") << ",\"brakeStartSpeed\":" << Reading.BrakeStartSpeed
                << ",\"finalSpeed\":" << Reading.FinalSpeed << ",\"stopTime\":" << Reading.StopTime << ",\"driveUphillM\":" << Reading.DriveUphill << ",\"finalUphillM\":" << Reading.FinalUphill
                << ",\"brakeDisplacementM\":" << Reading.BrakeDisplacement << ",\"nativeBeadGapM\":" << Reading.NativeBeadGap << ",\"physicalBeadGapM\":" << Reading.PhysicalBeadGap
                << ",\"positiveBrakePowerW\":" << Reading.PositiveBrakePower << ",\"positiveContactPowerW\":" << Reading.PositiveContactPower << ",\"radiusM\":" << Reading.PeakRadius << ",\"shapeM\":" << Reading.PeakShape << '}';
        Results.flush();
        std::printf("MEASURED %s: brake %.3f -> %.3f m/s stop %.3fs drive uphill %.4fm native bead %.6fm physical bead %.6fm\n", Specification.Name.c_str(), Reading.BrakeStartSpeed, Reading.FinalSpeed, Reading.StopTime, Reading.DriveUphill, Reading.NativeBeadGap, Reading.PhysicalBeadGap); std::fflush(stdout);
    }
    Results << "]}\n";
}
