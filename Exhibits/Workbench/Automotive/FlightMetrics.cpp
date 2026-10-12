//============================================================================================================================================
//                                                              FLIGHTMETRICS.CPP
//============================================================================================================================================
// 📦 Actual production launches, signed free flight, landings and incline parking with explicit mechanical diagnostics.

#include "DriveDynamicsFixture.h"

#include <array>
#include <bit>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <string>

using namespace Frontier::Vehicle;
using DriveProof::DriveFixture;
using DriveProof::StepSeconds;
namespace Course = Frontier::Drive;

namespace
{

struct FlightSpecification
{
    std::string Name;
    Vec3 Position{}, Velocity{}, Angular{};
    Quat Orientation{};
    uint32_t Terrain = 1u;
    float Mirror = 1.0f, Incline = 0.0f, Heading = 0.0f, Friction = 0.8f, Seconds = 6.0f;
    uint32_t Brakes = 0u;
    bool Repeat = false;
};

struct MechanicalMetrics
{
    double Body = 0.0, Particles = 0.0, RimTranslation = 0.0, RimSpin = 0.0;
    double Gravity = 0.0, Elastic = 0.0, Gas = 0.0, Suspension = 0.0, Stops = 0.0, Contact = 0.0, Bristles = 0.0;
    double Radius = 0.0, HalfWidth = 0.0, ShapeMax = 0.0, ShapeRms = 0.0, RelativeSpeed = 0.0;
    double DrivePower = 0.0, ContactPower = 0.0, StaticPower = 0.0, NormalLoad = 0.0;
    uint32_t Contacts = 0u;
    Vec3 Momentum{};
    double Total() const
    {
        return Body + Particles + RimTranslation + RimSpin + Gravity + Elastic + Gas + Suspension + Stops + Contact + Bristles;
    }
};

struct FlightReading
{
    double InitialAvailable = 0.0, PeakIncrease = 0.0, PeakTime = 0.0, DriveWork = 0.0;
    double Radius = 0.0, HalfWidth = 0.0, AirShape = 0.0, PeakAngular = 0.0;
    double MinimumUp = 1.0, PrimaryAirMinimumUp = 1.0, LongestAir = 0.0, PeakVertical = 0.0;
    double ParkingDrift = 0.0, ParkingSpeed = 0.0, FinalSpeed = 0.0;
    double PeakContactPower = 0.0, PeakStaticPower = 0.0;
    uint32_t RampMask = 0u, Contacts = 0u;
    uint64_t Fingerprint = 1469598103934665603ull;
};

std::vector<FlightSpecification> ConstructFlights()
{
    std::vector<FlightSpecification> Flights;
    for (float Speed : {30.0f, 40.0f})
        for (float Side : {1.0f, -1.0f})
        {
            FlightSpecification Flight;
            Flight.Name = std::string("launch-") + (Side > 0.0f ? "left-" : "right-") + std::to_string(static_cast<int>(Speed));
            Flight.Position = {0.0f, Side * 2.8f, 0.54f};
            Flight.Velocity = {Speed, 0.0f, 0.0f};
            Flight.Terrain = 0u; Flight.Mirror = Side; Flight.Repeat = true;
            Flights.push_back(Flight);
        }
    for (int X = -1; X <= 1; ++X)
        for (int Y = -1; Y <= 1; ++Y)
            for (int Z = -1; Z <= 1; ++Z)
            {
                if (X == 0 && Y == 0 && Z == 0) continue;
                FlightSpecification Flight;
                Flight.Name = "air-" + std::to_string(X) + "_" + std::to_string(Y) + "_" + std::to_string(Z);
                Flight.Position = {0.0f, 0.0f, 60.0f}; Flight.Velocity = {8.0f, -3.0f, 8.0f};
                Flight.Angular = Vec3{static_cast<float>(X), static_cast<float>(Y), static_cast<float>(Z)}.Normalized() * 12.0f;
                Flight.Repeat = X == 1 && Y == -1 && Z == -1;
                Flights.push_back(Flight);
            }
    for (const Vec3 Axis : {Vec3{-1, 0, 0}, Vec3{1, 0, 0}, Vec3{0, -1, 0}, Vec3{0, 1, 0},
                           Vec3{0, 0, -1}, Vec3{0, 0, 1}, Vec3{-1, 0, 1}, Vec3{1, -1, -1}})
    {
        FlightSpecification Flight;
        Flight.Name = "landing-" + std::to_string(static_cast<int>(Axis.x)) + "_" + std::to_string(static_cast<int>(Axis.y)) + "_" + std::to_string(static_cast<int>(Axis.z));
        Flight.Position = {0.0f, 0.0f, 9.0f}; Flight.Velocity = {8.0f, -3.0f, 8.0f};
        Flight.Angular = Axis.Normalized() * 8.0f;
        Flight.Terrain = 2u; Flight.Seconds = 8.0f; Flight.Repeat = Axis.x == -1.0f && Axis.z == 1.0f;
        Flights.push_back(Flight);
    }
    for (float Incline : {10.0f, 20.0f})
        for (float Heading : {0.0f, 180.0f, 90.0f, -90.0f})
            for (uint32_t Brakes = 0u; Brakes < 3u; ++Brakes)
            {
                FlightSpecification Flight;
                Flight.Name = "slope-" + std::to_string(static_cast<int>(Incline)) + "-heading-" + std::to_string(static_cast<int>(Heading)) + "-brakes-" + std::to_string(Brakes);
                Flight.Terrain = 3u; Flight.Incline = Incline; Flight.Heading = Heading; Flight.Brakes = Brakes; Flight.Seconds = 8.0f;
                Flight.Repeat = Incline == 20.0f && Heading == 90.0f && Brakes == 1u;
                Flights.push_back(Flight);
            }
    for (float Heading : {0.0f, 90.0f})
        for (float Friction : {0.0f, 0.2f, 0.8f})
        {
            FlightSpecification Flight;
            Flight.Name = "limit-35-heading-" + std::to_string(static_cast<int>(Heading)) + "-friction-" + std::to_string(static_cast<int>(Friction * 100.0f));
            Flight.Terrain = 3u; Flight.Incline = 35.0f; Flight.Heading = Heading; Flight.Friction = Friction; Flight.Brakes = 1u;
            Flights.push_back(Flight);
        }
    return Flights;
}

double SpringPotential(const SuspensionSpecification& Spring, double Compression)
{
    Compression = std::max(0.0, Compression);
    double Potential = Spring.Preload * Compression;
    if (!Spring.Progressive || !Spring.Coefficients.IsProgressive()) return Potential + 0.5 * Spring.SpringRate * Compression * Compression;
    const double Turn = Spring.RateFloorCompression();
    const double Active = Turn > 0.0 ? std::min(Compression, Turn) : Compression;
    const auto& Coefficients = Spring.Coefficients;
    Potential += 0.5 * Coefficients.k1 * Active * Active + Coefficients.k2 * Active * Active * Active / 3.0
               + Coefficients.k3 * Active * Active * Active * Active / 4.0;
    if (Compression > Active)
    {
        const double Remainder = Compression - Active;
        Potential += Spring.SpringForce(static_cast<float>(Active)) * Remainder + 0.05 * Spring.SpringRate * Remainder * Remainder;
    }
    return Potential;
}

MechanicalMetrics Measure(const DriveFixture& Fixture, bool Initial)
{
    MechanicalMetrics Reading;
    const auto& Configuration = Fixture.Configuration;
    const auto& Body = Fixture.Body;
    const auto& Telemetry = Fixture.Solver.Telemetry();
    Reading.Body = Body.KineticEnergy();
    Reading.Gravity = -Body.Mass * Dot(Configuration.Gravity, Body.Position);
    Reading.Momentum = Body.LinearVelocity * Body.Mass;
    double ShapeSquared = 0.0, RelativeSquared = 0.0;
    size_t Count = 0u;
    for (size_t Corner = 0u; Corner < Fixture.Solver.Tyres().size(); ++Corner)
    {
        const auto& Tyre = Fixture.Solver.Tyres()[Corner];
        const auto Energy = Tyre.Energy();
        const auto& Wheel = Configuration.Wheels[Corner];
        const auto& Spring = Corner < 2u ? Configuration.FrontStrut : Configuration.RearStrut;
        const auto& Report = Telemetry.Wheels[Corner];
        const double Compression = Initial ? Spring.StaticCompression : Report.StrutCompression;
        const double RimMass = std::max(0.0, static_cast<double>(Configuration.UnsprungMass - Configuration.Tyre.TotalMass));
        const Vec3 Hub = Tyre.HubPosition();
        const float Mirror = Wheel.LocalOffset.y < 0.0f ? -1.0f : 1.0f;
        const Vec3 Up = Body.Orientation.Rotate({-Spring.AxisX, -Spring.AxisY * Mirror, -Spring.AxisZ});
        const Vec3 HubVelocity = Body.LinearVelocity + Cross(Body.AngularVelocity, Hub - Body.Position) + Up * (Initial ? 0.0f : Report.StrutRate);
        const Vec3 SpinAxis = Tyre.HubRotation().Rotate({0.0f, 1.0f, 0.0f});
        const Vec3 Angular = Body.AngularVelocity + SpinAxis * Report.WheelOmega;
        const double AbsoluteSpin = Dot(Angular, SpinAxis);
        Reading.RimTranslation += 0.5 * RimMass * Dot(HubVelocity, HubVelocity);
        Reading.RimSpin += 0.5 * Configuration.WheelInertia * AbsoluteSpin * AbsoluteSpin;
        Reading.Gravity -= RimMass * Dot(Configuration.Gravity, Hub);
        Reading.Momentum += HubVelocity * static_cast<float>(RimMass);
        Reading.Particles += Energy.Kinetic; Reading.Elastic += Energy.Elastic; Reading.Gas += Energy.Gas;
        Reading.Stops += Energy.Stops; Reading.Bristles += Energy.Bristles;
        Reading.Radius = std::max(Reading.Radius, Energy.Radius); Reading.HalfWidth = std::max(Reading.HalfWidth, Energy.HalfWidth);
        Reading.ShapeMax = std::max(Reading.ShapeMax, Energy.ShapeMax); Reading.Contacts += Report.ContactCount;
        Reading.NormalLoad += Report.VerticalLoad; Reading.DrivePower += Report.DrivePower_W;
        Reading.ContactPower += Report.ContactPower_W; Reading.StaticPower += Report.StaticContactPower_W;
        if (Configuration.SuspensionEnabled)
        {
            Reading.Suspension += SpringPotential(Spring, Compression);
            const double Over = std::max(0.0, Compression - Spring.MaxTravel); Reading.Stops += 6.0 * Spring.SpringRate * Over * Over;
        }
        const Quat Rotation = Tyre.MaterialFrame();
        for (const auto& Particle : Tyre.Nodes())
        {
            if (!(Particle.InverseMass > 0.0f)) continue;
            const double Mass = 1.0 / Particle.InverseMass;
            Reading.Gravity -= Mass * Dot(Configuration.Gravity, Particle.Position);
            Reading.Momentum += Particle.Velocity * static_cast<float>(Mass);
            const Vec3 Offset = Particle.Position - Hub - Rotation.Rotate(Particle.TreadLocal);
            ShapeSquared += Dot(Offset, Offset);
            const Vec3 RelativeVelocity = Particle.Velocity - HubVelocity - Cross(Angular, Particle.Position - Hub);
            RelativeSquared += Dot(RelativeVelocity, RelativeVelocity); ++Count;
            if (Report.ContactCount && Fixture.Ground)
            {
                Vec3 Surface, Normal;
                if (Fixture.Ground(Particle.Position, Surface, Normal))
                {
                    const double Penetration = std::max(0.0f, Dot(Surface - Particle.Position, Normal.Normalized()));
                    Reading.Contact += 0.5 * Penetration * Penetration / Configuration.Tyre.ContactCompliance;
                }
            }
        }
    }
    for (const auto& Bar : {Configuration.FrontBar, Configuration.RearBar})
        if (Bar.Enabled && Configuration.SuspensionEnabled && Bar.LeftWheel < Telemetry.WheelCount && Bar.RightWheel < Telemetry.WheelCount)
        {
            const double Difference = Initial ? 0.0 : Telemetry.Wheels[Bar.LeftWheel].StrutCompression - Telemetry.Wheels[Bar.RightWheel].StrutCompression;
            Reading.Suspension += 0.5 * Bar.Stiffness * Difference * Difference;
        }
    if (Count) { Reading.ShapeRms = std::sqrt(ShapeSquared / Count); Reading.RelativeSpeed = std::sqrt(RelativeSquared / Count); }
    return Reading;
}

void Capture(std::ofstream& Stream, const DriveFixture& Fixture)
{
    const auto Vector = [&](const Vec3& Point) { Stream.write(reinterpret_cast<const char*>(&Point), sizeof(Point)); };
    const auto Rotation = [&](const Quat& Orientation) { Stream.write(reinterpret_cast<const char*>(&Orientation), sizeof(Orientation)); };
    Vector(Fixture.Body.Position); Rotation(Fixture.Body.Orientation);
    for (const auto& Tyre : Fixture.Solver.Tyres())
    {
        Vector(Tyre.HubPosition()); Rotation(Tyre.MaterialFrame());
        for (const auto& Particle : Tyre.Nodes()) Vector(Particle.Position);
    }
}

void Fingerprint(FlightReading& Reading, const DriveFixture& Fixture)
{
    const auto Mix = [&](float Number) { Reading.Fingerprint ^= std::bit_cast<uint32_t>(Number); Reading.Fingerprint *= 1099511628211ull; };
    const auto Vector = [&](const Vec3& Point) { Mix(Point.x); Mix(Point.y); Mix(Point.z); };
    const auto Rotation = [&](const Quat& Orientation) { Mix(Orientation.x); Mix(Orientation.y); Mix(Orientation.z); Mix(Orientation.w); };
    Vector(Fixture.Body.Position); Rotation(Fixture.Body.Orientation); Vector(Fixture.Body.LinearVelocity); Vector(Fixture.Body.AngularVelocity);
    for (const auto& Tyre : Fixture.Solver.Tyres())
        for (const auto& Particle : Tyre.Nodes())
        {
            Vector(Particle.Position); Vector(Particle.Previous); Vector(Particle.Velocity);
            Vector(Particle.BristleAnchor); Vector(Particle.ContactPoint); Vector(Particle.ContactNormal);
            Mix(Particle.SpokeLambda); Mix(Particle.SpokeTangentialLambda); Mix(Particle.SpokeLateralLambda);
            Mix(Particle.ContactLambda); Mix(Particle.TreadLambda); Mix(Particle.RimLambda); Mix(Particle.InContact ? 1.0f : 0.0f);
        }
    for (const auto& Corner : Fixture.Solver.Telemetry().Wheels) { Mix(Corner.StrutCompression); Mix(Corner.StrutRate); Mix(Corner.WheelOmega); }
}

FlightReading Record(const FlightSpecification& Specification, const std::filesystem::path& Folder, bool Publish, bool Before)
{
    const Quat Incline = Quat::AxisAngle({0.0f, 1.0f, 0.0f}, -Specification.Incline * 0.01745329252f);
    const Vec3 Normal = Incline.Rotate({0.0f, 0.0f, 1.0f});
    const auto Ground = [&](const Vec3& Point, Vec3& Surface, Vec3& Outward)
    {
        if (Specification.Terrain == 1u) return false;
        if (Specification.Terrain >= 2u) { Outward = Normal; Surface = Point - Normal * Dot(Point, Normal); return true; }
        const float Mirror = Specification.Mirror;
        Course::CourseSurface(Point.x, Point.y * Mirror, Point.z, Surface.x, Surface.y, Surface.z, Outward.x, Outward.y, Outward.z);
        Surface.y *= Mirror; Outward.y *= Mirror; return true;
    };
    const Quat Orientation = Specification.Terrain == 3u ? (Incline * Quat::AxisAngle({0.0f, 0.0f, 1.0f}, Specification.Heading * 0.01745329252f)).Normalized() : Specification.Orientation;
    DriveFixture Fixture;
    Fixture.Construct(Specification.Terrain == 3u ? Normal * 0.54f : Specification.Position, Specification.Velocity, Orientation, Ground, Specification.Angular);
    Fixture.Configuration.GripCoefficient = Specification.Friction;
    for (auto& Wheel : Fixture.Configuration.Wheels) Wheel.Driven = false;
    Fixture.CorrectContacts = !Before; Fixture.Rebuild();
    DriverInput Input;
    Input.Brake = Specification.Brakes == 1u ? 1.0f : 0.0f; Input.Handbrake = Specification.Brakes == 2u;
    const uint32_t Ticks = static_cast<uint32_t>(std::round(Specification.Seconds / StepSeconds));
    std::ofstream Csv, Pictures;
    if (Publish)
    {
        Csv.open(Folder / (Specification.Name + ".csv")); Csv << std::setprecision(12);
        Csv << "t,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,body_kinetic_J,particle_kinetic_J,rim_translation_J,rim_rotation_J,gravity_J,carcass_J,gas_J,suspension_J,stops_J,contact_elastic_J,bristle_J,mechanical_J,increase_J,drive_work_J,angular_speed,body_up_z,radius_m,half_width_m,shape_max_m,shape_rms_m,relative_speed_rms,normal_load_N,contacts,body_contacts,airborne,contact_power_W,static_contact_power_W,air_run_s,parking_drift_m,momentum_error\n";
        Pictures.open(Folder / (Specification.Name + ".frames"), std::ios::binary);
        const uint32_t Header[] = {0x54554D42u, Fixture.Configuration.Tyre.RingCount, Fixture.Configuration.Tyre.SegmentCount, Ticks / 12u};
        Pictures.write(reinterpret_cast<const char*>(Header), sizeof(Header));
        std::ofstream Terrain(Folder / (Specification.Name + ".terrain"));
        Terrain << Specification.Terrain << ' ' << Specification.Mirror << ' ' << Normal.x << ' ' << Normal.y << ' ' << Normal.z << '\n';
    }
    FlightReading Result;
    const auto Initial = Measure(Fixture, true); const double ReferenceGravity = Initial.Gravity;
    Result.InitialAvailable = Initial.Total() - ReferenceGravity;
    const Vec3 InitialMomentum = Initial.Momentum;
    Vec3 ParkingOrigin = Fixture.Body.Position;
    double AirRun = 0.0, AirMinimum = 1.0, FirstRamp = -1.0;
    const double CompleteMass = Fixture.Body.Mass + Fixture.Configuration.UnsprungMass * Fixture.Configuration.Wheels.size();
    for (uint32_t Tick = 0u; Tick <= Ticks; ++Tick)
    {
        if (Tick) Fixture.Advance(Input);
        auto Reading = Measure(Fixture, Tick == 0u);
        const double Time = Tick * static_cast<double>(StepSeconds);
        Reading.Gravity -= ReferenceGravity;
        if (Tick) Result.DriveWork += Reading.DrivePower * StepSeconds;
        const double Increase = Reading.Total() - Result.InitialAvailable - Result.DriveWork;
        assert(std::isfinite(Increase));
        if (Increase > Result.PeakIncrease) { Result.PeakIncrease = Increase; Result.PeakTime = Time; }
        const Vec3 Up = Fixture.Body.Orientation.Rotate({0.0f, 0.0f, 1.0f});
        const bool Airborne = Tick > 0u && Reading.Contacts == 0u && Fixture.Body.Contacts.ContactCount == 0u;
        if (Airborne)
        {
            AirRun += StepSeconds; AirMinimum = std::min(AirMinimum, static_cast<double>(Up.z));
            Result.AirShape = std::max(Result.AirShape, Reading.ShapeMax);
            if (AirRun >= Result.LongestAir) { Result.LongestAir = AirRun; Result.PrimaryAirMinimumUp = AirMinimum; }
        }
        else { AirRun = 0.0; AirMinimum = 1.0; }
        Result.MinimumUp = std::min(Result.MinimumUp, static_cast<double>(Up.z));
        Result.Radius = std::max(Result.Radius, Reading.Radius); Result.HalfWidth = std::max(Result.HalfWidth, Reading.HalfWidth);
        Result.PeakAngular = std::max(Result.PeakAngular, static_cast<double>(Fixture.Body.AngularVelocity.Length()));
        Result.PeakVertical = std::max(Result.PeakVertical, static_cast<double>(Fixture.Body.LinearVelocity.z));
        Result.Contacts += Reading.Contacts + Fixture.Body.Contacts.ContactCount;
        Result.PeakContactPower = std::max(Result.PeakContactPower, Reading.ContactPower); Result.PeakStaticPower = std::max(Result.PeakStaticPower, Reading.StaticPower);
        if (Specification.Terrain == 0u)
            for (uint32_t Corner = 0u; Corner < Fixture.Solver.Telemetry().WheelCount; ++Corner)
                if (std::abs(Fixture.Solver.Telemetry().Wheels[Corner].NormalReaction.x) > 50.0f && Fixture.Body.Position.x > 5.0f && Fixture.Body.Position.x < 19.0f)
                {
                    if (FirstRamp < 0.0) FirstRamp = Time;
                    if (Time - FirstRamp < 0.18) Result.RampMask |= 1u << Corner;
                }
        double ParkingDrift = 0.0;
        if (Time <= 2.0) ParkingOrigin = Fixture.Body.Position;
        else if (Specification.Terrain == 3u)
        {
            const Vec3 Displacement = Fixture.Body.Position - ParkingOrigin;
            ParkingDrift = (Displacement - Normal * Dot(Displacement, Normal)).Length();
            Result.ParkingDrift = std::max(Result.ParkingDrift, ParkingDrift);
            const Vec3 Velocity = Fixture.Body.LinearVelocity;
            Result.ParkingSpeed = std::max(Result.ParkingSpeed, static_cast<double>((Velocity - Normal * Dot(Velocity, Normal)).Length()));
        }
        const double MomentumError = (Reading.Momentum - InitialMomentum - Fixture.Configuration.Gravity * static_cast<float>(CompleteMass * Time)).Length();
        Fingerprint(Result, Fixture);
        if (Publish)
        {
            const auto& Body = Fixture.Body;
            Csv << Time << ',' << Body.Position.x << ',' << Body.Position.y << ',' << Body.Position.z << ',' << Body.Orientation.x << ',' << Body.Orientation.y << ',' << Body.Orientation.z << ',' << Body.Orientation.w << ','
                << Body.LinearVelocity.x << ',' << Body.LinearVelocity.y << ',' << Body.LinearVelocity.z << ',' << Body.AngularVelocity.x << ',' << Body.AngularVelocity.y << ',' << Body.AngularVelocity.z << ','
                << Reading.Body << ',' << Reading.Particles << ',' << Reading.RimTranslation << ',' << Reading.RimSpin << ',' << Reading.Gravity << ',' << Reading.Elastic << ',' << Reading.Gas << ',' << Reading.Suspension << ',' << Reading.Stops << ',' << Reading.Contact << ',' << Reading.Bristles << ','
                << Reading.Total() << ',' << Increase << ',' << Result.DriveWork << ',' << Body.AngularVelocity.Length() << ',' << Up.z << ',' << Reading.Radius << ',' << Reading.HalfWidth << ',' << Reading.ShapeMax << ',' << Reading.ShapeRms << ',' << Reading.RelativeSpeed << ','
                << Reading.NormalLoad << ',' << Reading.Contacts << ',' << Body.Contacts.ContactCount << ',' << Airborne << ',' << Reading.ContactPower << ',' << Reading.StaticPower << ',' << AirRun << ',' << ParkingDrift << ',' << MomentumError << '\n';
            if (Tick > 0u && Tick % 12u == 0u) Capture(Pictures, Fixture);
        }
    }
    Result.FinalSpeed = Fixture.Body.LinearVelocity.Length(); return Result;
}

void Publish(std::ofstream& Stream, const FlightSpecification& Specification, const FlightReading& Reading)
{
    Stream << "{\"name\":\"" << Specification.Name << "\",\"seconds\":" << Specification.Seconds << ",\"terrain\":" << Specification.Terrain
           << ",\"inclineDegrees\":" << Specification.Incline << ",\"headingDegrees\":" << Specification.Heading << ",\"brakes\":" << Specification.Brakes << ",\"friction\":" << Specification.Friction
           << ",\"initialAvailableJ\":" << Reading.InitialAvailable << ",\"peakIncreaseJ\":" << Reading.PeakIncrease << ",\"peakIncreaseTime\":" << Reading.PeakTime << ",\"driveWorkJ\":" << Reading.DriveWork
           << ",\"radiusM\":" << Reading.Radius << ",\"halfWidthM\":" << Reading.HalfWidth << ",\"airShapeMaxM\":" << Reading.AirShape << ",\"peakAngular\":" << Reading.PeakAngular
           << ",\"minimumUpZ\":" << Reading.MinimumUp << ",\"primaryFlightMinimumUpZ\":" << Reading.PrimaryAirMinimumUp << ",\"longestAirS\":" << Reading.LongestAir << ",\"peakVerticalSpeed\":" << Reading.PeakVertical
           << ",\"contacts\":" << Reading.Contacts << ",\"parkingDriftM\":" << Reading.ParkingDrift << ",\"parkingSpeed\":" << Reading.ParkingSpeed << ",\"finalSpeed\":" << Reading.FinalSpeed
           << ",\"rampWheelMask\":" << Reading.RampMask << ",\"peakContactPowerW\":" << Reading.PeakContactPower << ",\"peakStaticContactPowerW\":" << Reading.PeakStaticPower
           << ",\"repeated\":" << (Specification.Repeat ? "true" : "false") << ",\"fingerprint\":\"" << Reading.Fingerprint << "\"}";
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 2 && Count <= 7);
    const std::filesystem::path Folder = Arguments[1];
    const uint32_t Shard = Count > 2 ? static_cast<uint32_t>(std::stoul(Arguments[2])) : 0u;
    const uint32_t Shards = Count > 3 ? static_cast<uint32_t>(std::stoul(Arguments[3])) : 1u;
    const std::string Selection = Count > 4 ? Arguments[4] : "all";
    const float Duration = Count > 5 ? std::stof(Arguments[5]) : 0.0f;
    const bool Before = Count > 6 && std::string(Arguments[6]) == "before";
    std::filesystem::create_directories(Folder);
    auto Flights = ConstructFlights(); assert(Flights.size() == 68u);
    std::ofstream Results(Folder / "FlightResults.json"); Results << std::setprecision(12) << "{\"cpuOnly\":true,\"rateHz\":240,\"snapshotRateHz\":20,\"cases\":[";
    bool First = true;
    for (uint32_t Index = 0u; Index < Flights.size(); ++Index)
    {
        auto& Flight = Flights[Index];
        const bool Cardinal = Flight.Name == "air--1_0_0" || Flight.Name == "air-1_0_0" || Flight.Name == "air-0_-1_0" || Flight.Name == "air-0_1_0" || Flight.Name == "air-0_0_-1" || Flight.Name == "air-0_0_1";
        const bool Critical = Flight.Name == "air--1_0_1" || Flight.Name == "air-1_-1_-1" || Flight.Name == "landing--1_0_1" || Flight.Name == "landing-1_-1_-1";
        const bool Core = Flight.Name.find("launch-") == 0u || Cardinal || Critical;
        if (Index % Shards != Shard || (Selection == "core" ? !Core : Selection != "all" && Flight.Name.find(Selection) == std::string::npos)) continue;
        if (Duration > 0.0f) Flight.Seconds = Duration;
        if (Before) Flight.Repeat = false;
        const auto Reading = Record(Flight, Folder, true, Before);
        if (Flight.Repeat) { const auto Repeated = Record(Flight, Folder, false, Before); assert(Reading.Fingerprint == Repeated.Fingerprint); }
        if (!First) Results << ','; First = false; Publish(Results, Flight, Reading); Results.flush();
        std::printf("RECORDED %s: air %.3fs up %.3f energy +%.2f J radius %.4fm parking %.6fm\n", Flight.Name.c_str(), Reading.LongestAir, Reading.MinimumUp, Reading.PeakIncrease, Reading.Radius, Reading.ParkingDrift); std::fflush(stdout);
    }
    Results << "]}\n";
}
