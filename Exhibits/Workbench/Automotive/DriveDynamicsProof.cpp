//============================================================================================================================================
//                                                       DRIVEDYNAMICSPROOF.CPP
//============================================================================================================================================
// 📦 Deterministic production-code Drive contact, free-flight, rollover, landing and camera-possession checks with traces.

#include "../../../Engine/Host/CameraPossessionSequence.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.h"
#include "../../../Projects/Project-Drive/Source/VehicleInstanceSequence.h"
#include "../../../Projects/Project-Drive/Source/ControlVehicleMesh.inl"
#include "../../../Projects/Project-Drive/Source/DriveCourse.h"

#include <algorithm>
#include <bit>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <vector>

using namespace Frontier::Vehicle;
using Frontier::Drive::VehicleChassisBody;
namespace Course = Frontier::Drive;

namespace
{

constexpr float StepSeconds = 1.0f / 240.0f;

bool ReadCourse(const Vec3& Point, Vec3& Surface, Vec3& Normal)
{
    Course::CourseSurface(Point.x, Point.y, Point.z, Surface.x, Surface.y, Surface.z,
                          Normal.x, Normal.y, Normal.z);
    return true;
}

bool ReadFlat(const Vec3& Point, Vec3& Surface, Vec3& Normal)
{
    Surface = {Point.x, Point.y, 0.0f};
    Normal = {0.0f, 0.0f, 1.0f};
    return true;
}

struct DriveFixture
{
    VehicleGeometry Geometry;
    VehicleChassisBody Body;
    VehicleSolver Solver;
    VehicleSolverConfiguration Configuration;
    GroundQuery Ground;
    std::vector<Vec3> CollisionLocations;

    void Construct(const Vec3& Position, const Vec3& Velocity, const Quat& Rotation,
                   GroundQuery Surface)
    {
        Ground = std::move(Surface);
        ApplyGeometry(Configuration, Geometry);
        Configuration.Aero.Enabled = false;
        Body.Position = Position;
        Body.Orientation = Rotation;
        Body.LinearVelocity = Velocity;
        Body.Mass = Configuration.ChassisMass;
        Body.InvInertiaDiag = Geometry.InvInertia();
        const VehicleSolver::Hooks Reception
        {
            [this] { return Body.State(); },
            [this](const Vec3& Force, const Vec3& Point) { Body.ApplyForceAtPoint(Force, Point); },
            [this](const Vec3& Torque) { Body.ApplyTorque(Torque); },
            Ground
        };
        Solver.Build(Configuration, Reception, Body.State());
        for (uint32_t Index = 0u; Index < Course::ControlVehicleMesh::kVertexCount; ++Index)
            CollisionLocations.push_back({Course::ControlVehicleMesh::kPositions[Index * 3u],
                                          Course::ControlVehicleMesh::kPositions[Index * 3u + 1u],
                                          Course::ControlVehicleMesh::kPositions[Index * 3u + 2u] - Geometry.CoMModelZ()});
    }

    void Advance(const DriverInput& Input = {})
    {
        Solver.AssignInput(Input);
        Solver.Step(StepSeconds);
        Body.Integrate(StepSeconds);
        const Vec3 BeforePosition = Body.Position;
        const Quat BeforeRotation = Body.Orientation;
        Body.ResolveContacts(CollisionLocations, Ground, StepSeconds);
        if (Body.Contacts.ArrivalPenetration > 0.0f) Solver.CorrectAttachments(BeforePosition, BeforeRotation, Body.Position, Body.Orientation);
        assert(std::isfinite(Body.KineticEnergy()));
        assert(std::isfinite(Body.Position.x) && std::isfinite(Body.Position.y) && std::isfinite(Body.Position.z));
        assert(std::isfinite(Body.Orientation.x) && std::isfinite(Body.Orientation.y) &&
               std::isfinite(Body.Orientation.z) && std::isfinite(Body.Orientation.w));
        assert(Body.Contacts.KineticAfter <= Body.Contacts.KineticBefore + std::max(1.0f, Body.Contacts.KineticBefore * 0.0001f));
        for (const auto& Tyre : Solver.Tyres())
            assert(std::isfinite(Tyre.HubPosition().x) && std::isfinite(Tyre.HubPosition().y) && std::isfinite(Tyre.HubPosition().z));
    }
};

void CheckCameraPossession()
{
    Frontier::HostRuntime::CameraPossessionSequence Possession;
    assert(!Possession.Advance(0u, false, false));
    assert(!Possession.Advance(1u, false, false));
    assert(Possession.Advance(1u, true, false));
    for (uint32_t Repeat = 0u; Repeat < 90u; ++Repeat) assert(Possession.Advance(1u, true, false));
    assert(Possession.Advance(1u, false, false));
    assert(!Possession.Advance(1u, true, false));
    assert(!Possession.Advance(1u, false, false));
    assert(!Possession.Advance(1u, true, true));
    assert(!Possession.Advance(1u, true, false));
    assert(!Possession.Advance(1u, false, false));
    assert(Possession.Advance(1u, true, false));
    assert(!Possession.Advance(2u, true, false));
    assert(!Possession.Advance(1u, true, false));
    assert(!Possession.Advance(0u, false, false));
    std::puts("PASS F8 edges, held key, modal capture, repossession and Edit/Simulate/new-Play reset");
}

void CheckKerbGeometry()
{
    using K = Course::KerbConstants;
    Vec3 Surface, Normal;
    ReadCourse({0.0f, K::CentreY + K::Depth * 0.5f, K::Height - 0.005f}, Surface, Normal);
    assert(std::abs(Surface.z - K::Height) < 1.0e-6f && Normal.z == 1.0f);
    ReadCourse({0.0f, K::CentreY + 0.005f, K::Height * 0.5f}, Surface, Normal);
    assert(std::abs(Surface.y - K::CentreY) < 1.0e-6f && Normal.y == -1.0f);
    ReadCourse({K::NearX + 0.005f, K::CentreY + K::Depth * 0.5f, K::Height * 0.5f}, Surface, Normal);
    assert(Surface.x == K::NearX && Normal.x == -1.0f);
    ReadCourse({0.0f, K::CentreY - 0.005f, K::Height * 0.5f}, Surface, Normal);
    assert(Surface.y == K::CentreY && Normal.y == -1.0f);
    uint32_t KerbTriangles = 0u;
    Course::EmitCourseTriangles([&](float Ax, float Ay, float Az, float Bx, float By, float Bz,
                                   float Cx, float Cy, float Cz, uint32_t)
    {
        if (Ax >= K::NearX && Ax <= K::FarX && Ay >= K::CentreY && Ay <= K::CentreY + K::Depth &&
            Bx >= K::NearX && Bx <= K::FarX && By >= K::CentreY && By <= K::CentreY + K::Depth &&
            Cx >= K::NearX && Cx <= K::FarX && Cy >= K::CentreY && Cy <= K::CentreY + K::Depth &&
            (Az == K::Height || Bz == K::Height || Cz == K::Height)) ++KerbTriangles;
    });
    assert(KerbTriangles == 10u);
    std::puts("PASS 120 mm kerb top, both sides and end caps agree with the rendered geometry");
}

void CheckWallTransfer()
{
    for (const auto Scheme : {DrivingScheme::SimpleFrictionCircle, DrivingScheme::PacejkaDrivetrain})
    {
        VehicleSolverConfiguration Configuration;
        Configuration.ActiveScheme = Scheme;
        Configuration.SuspensionEnabled = false;
        Configuration.Aero.Enabled = false;
        Configuration.Wheels = {WheelMount{{}, {}, false, false, false}};
        const ChassisState Chassis{{0.0f, Course::KerbConstants::CentreY - 0.07f, 0.31f}, {}, {}, {}};
        Vec3 Delivered;
        VehicleSolver Solver;
        Solver.Build(Configuration, VehicleSolver::Hooks{
            [&] { return Chassis; },
            [&](const Vec3& Force, const Vec3&) { Delivered += Force; },
            {}, ReadCourse}, Chassis);
        float LargestSide = 0.0f;
        for (uint32_t Tick = 0u; Tick < 96u; ++Tick)
        {
            Delivered = {};
            Solver.Step(StepSeconds);
            const auto& Wheel = Solver.Telemetry().Wheels[0];
            const auto& Reaction = Solver.Tyres()[0].Reaction();
            const Vec3 Normal = Reaction.SupportReaction.Length() > 1.0f ? Reaction.SupportReaction.Normalized() : Vec3{0, 0, 1};
            const Vec3 Forward = (Vec3{1, 0, 0} - Normal * Normal.x).Normalized(), Left = Cross(Normal, Forward).Normalized();
            const Vec3 Expected = Reaction.RimForce + Forward * Wheel.LongitudinalForce + Left * Wheel.LateralForce;
            assert(std::abs(Delivered.y - Expected.y) < std::max(0.1f, std::abs(Delivered.y) * 0.001f));
            LargestSide = std::max(LargestSide, std::abs(Reaction.RimForce.y));
        }
        assert(LargestSide > 100.0f);
        std::printf("PASS %s transfers kerb contact normal to chassis (peak %.1f N)\n",
                    Scheme == DrivingScheme::PacejkaDrivetrain ? "Pacejka" : "simple", LargestSide);
    }
}

struct ScenarioReading
{
    float PeakEnergy = 0.0f;
    float PeakLoad = 0.0f;
    float PeakSide = 0.0f;
    float WorstOverlap = 0.0f;
    uint32_t BodyContacts = 0u;
    uint32_t TyreContacts = 0u;
    ChassisState End;
    std::vector<uint32_t> StateBits;
};

ScenarioReading RunScenario(const char* Name, const std::filesystem::path& Folder, bool Publish)
{
    DriveFixture Fixture;
    if (std::string(Name) == "airborne")
        Fixture.Construct({0.0f, 0.0f, 8.0f}, {3.0f, 0.0f, 0.0f}, {},
                          [](const Vec3&, Vec3&, Vec3&) { return false; });
    else if (std::string(Name) == "rollover")
    {
        Fixture.Construct({0.0f, 0.0f, 1.6f}, {1.0f, 0.0f, -0.5f}, Quat::AxisAngle({1.0f, 0.0f, 0.0f}, 2.9f), ReadFlat);
        Fixture.Body.AngularVelocity = {1.0f, 0.0f, 0.0f};
    }
    else if (std::string(Name) == "kerb")
        Fixture.Construct({0.0f, 1.8f, 0.54f}, {1.0f, 2.0f, 0.0f}, {}, ReadCourse);
    else if (std::string(Name) == "settled")
        Fixture.Construct({0.0f, 0.0f, 0.54f}, {}, {}, ReadFlat);
    else
        Fixture.Construct({0.0f, 0.0f, 2.0f}, {0.0f, 0.0f, -2.0f}, {}, ReadFlat);
    FILE* Trace = Publish ? std::fopen((Folder / (std::string(Name) + ".csv")).string().c_str(), "w") : nullptr;
    if (Publish) assert(Trace);
    if (Trace) std::fputs("t,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,kinetic_J,potential_J,force_x_N,force_y_N,force_z_N,body_contacts,body_impulse_Ns,body_penetration_m,tyre_load_N,tyre_normal_y_N,strut_force_N,rim_error_m,ground_error_m\n", Trace);
    ScenarioReading Reading;
    for (uint32_t Tick = 0u; Tick < 360u; ++Tick)
    {
        Fixture.Advance();
        float Load = 0.0f, Side = 0.0f, Strut = 0.0f, Rim = 0.0f, GroundError = 0.0f;
        for (const auto& Wheel : Fixture.Solver.Telemetry().Wheels)
        {
            Load += Wheel.VerticalLoad;
            Side += Wheel.NormalReaction.y;
            Strut += Wheel.StrutForce;
            Reading.TyreContacts += Wheel.InContact ? 1u : 0u;
        }
        Reading.PeakLoad = std::max(Reading.PeakLoad, Load);
        Reading.PeakSide = std::max(Reading.PeakSide, std::abs(Side));
        Reading.PeakEnergy = std::max(Reading.PeakEnergy, Fixture.Body.KineticEnergy());
        Reading.WorstOverlap = std::max(Reading.WorstOverlap, Fixture.Body.Contacts.RemainingPenetration);
        Reading.BodyContacts += Fixture.Body.Contacts.ContactCount;
        const auto& Body = Fixture.Body;
        const float State[] = {
            Body.Position.x, Body.Position.y, Body.Position.z,
            Body.Orientation.x, Body.Orientation.y, Body.Orientation.z, Body.Orientation.w,
            Body.LinearVelocity.x, Body.LinearVelocity.y, Body.LinearVelocity.z,
            Body.AngularVelocity.x, Body.AngularVelocity.y, Body.AngularVelocity.z,
            Body.KineticEnergy(), Body.Mass * 9.81f * Body.Position.z,
            Body.LastForce.x, Body.LastForce.y, Body.LastForce.z,
            Body.Contacts.Impulse.x, Body.Contacts.Impulse.y, Body.Contacts.Impulse.z,
            Body.Contacts.RemainingPenetration, Load, Side, Strut, Rim, GroundError};
        for (const float Value : State) Reading.StateBits.push_back(std::bit_cast<uint32_t>(Value));
        Reading.StateBits.push_back(Body.Contacts.ContactCount);
        if (Trace) std::fprintf(Trace,
            "%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%u,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g\n",
            (Tick + 1u) * StepSeconds, Body.Position.x, Body.Position.y, Body.Position.z,
            Body.Orientation.x, Body.Orientation.y, Body.Orientation.z, Body.Orientation.w,
            Body.LinearVelocity.x, Body.LinearVelocity.y, Body.LinearVelocity.z,
            Body.AngularVelocity.x, Body.AngularVelocity.y, Body.AngularVelocity.z,
            Body.KineticEnergy(), Body.Mass * 9.81f * Body.Position.z,
            Body.LastForce.x, Body.LastForce.y, Body.LastForce.z, Body.Contacts.ContactCount,
            Body.Contacts.Impulse.Length(), Body.Contacts.RemainingPenetration, Load, Side, Strut, Rim, GroundError);
    }
    if (Trace) std::fclose(Trace);
    Reading.End = Fixture.Body.State();
    if (std::string(Name) == "airborne")
    {
        assert(Reading.TyreContacts == 0u && Reading.BodyContacts == 0u);
        assert(std::abs(Reading.End.LinearVelocity.z + 9.81f * 1.5f) < 0.5f);
        assert(std::abs(Reading.End.Position.x - 4.5f) < 0.01f);
    }
    else if (std::string(Name) == "rollover")
    {
        assert(Reading.BodyContacts > 0u);
        assert(Reading.WorstOverlap < 0.025f);
        assert(Reading.End.Position.z > 0.0f);
        assert(Reading.End.Orientation.Rotate({0.0f, 0.0f, 1.0f}).z < 0.5f);
    }
    else if (std::string(Name) == "kerb") assert(Reading.PeakSide > 100.0f && Reading.End.Position.z > 0.0f);
    else assert(Reading.TyreContacts > 0u && Reading.End.Position.z > 0.2f && Reading.End.Position.z < 1.0f);
    assert(Reading.PeakEnergy < 200000.0f);
    std::printf("%s: peak kinetic %.1f J, load %.1f N, side %.1f N, body contacts %u, residual %.6f m, end z %.4f m vz %.4f m/s\n",
                Name, Reading.PeakEnergy, Reading.PeakLoad, Reading.PeakSide, Reading.BodyContacts,
                Reading.WorstOverlap, Reading.End.Position.z, Reading.End.LinearVelocity.z);
    return Reading;
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count == 2);
    const std::filesystem::path Folder = Arguments[1];
    std::filesystem::create_directories(Folder);
    CheckCameraPossession();
    CheckKerbGeometry();
    CheckWallTransfer();
    for (const char* Name : {"settled", "kerb", "airborne", "rollover", "landing"})
    {
        const auto First = RunScenario(Name, Folder, true);
        const auto Second = RunScenario(Name, Folder, false);
        assert(First.End.Position.x == Second.End.Position.x && First.End.Position.y == Second.End.Position.y &&
               First.End.Position.z == Second.End.Position.z && First.End.Orientation.w == Second.End.Orientation.w);
        assert(First.PeakEnergy == Second.PeakEnergy && First.PeakLoad == Second.PeakLoad &&
               First.PeakSide == Second.PeakSide && First.BodyContacts == Second.BodyContacts);
        assert(First.StateBits == Second.StateBits);
        std::printf("PASS %s complete body/force/energy trace is bit-identical on this compiler/host\n", Name);
    }
    std::puts("CPU production simulation only; no window, Vulkan driver, GPU timing or appearance validation.");
}
