//============================================================================================================================================
// 📦 Projects/Project-Drive/Source/DriveKerbChecks.cpp — headless kerb / bump regression against the REAL drive course
//============================================================================================================================================
//
//    Drives the production VehicleSolver (PacejkaDrivetrain, suspension on, aero off) over the authored course surface:
//    the same CourseSurface() contract that VehicleInstanceSequence hands the tyres. Scenarios:
//
//      A. flat pad control        — straight, far from the kerb: must stay planted (validates the harness).
//      B. speed bumps             — the 0.11 m rounded bumps behind the spawn: must roll over them without launching.
//      C. kerb side strike        — a shallow approach into the kerb's vertical inner face (a corner that runs wide).
//      D. steep kerb strike       — a steeper approach into the same face.
//      E/F/G. fast kerb strikes   — 43 to 72 km/h into the same face. F and G reproduce the launch on the pre-fix solver.
//
//    A pass means the body stays on the road: no launch above 0.25 m, pitch and roll under control, no spin-up, and no
//    sustained airtime. Every number is printed so the telemetry can be inspected directly.
//
//    Build & run: registered in Tools/Tests/CheckDrivePlayback.py (linked against Projects/Project-Drive/Build/DriveSimulationSources.json).
//    Manual build from the repository root:
//        g++ -std=c++20 -O2 -Wall -Wextra Projects/Project-Drive/Source/DriveKerbChecks.cpp <DriveSimulationSources> -o driveKerb && ./driveKerb
//
//============================================================================================================================================

#include "DriveCourse.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"

#include <cmath>
#include <cstdio>

using namespace Frontier::Vehicle;

namespace {

// Rigid box chassis, semi-implicit Euler (same integration as the existing VehicleSceneValidation mock).
struct KerbChassis
{
    Vec3  Position{};
    Quat  Orientation{0, 0, 0, 1};
    Vec3  LinearVelocity{};
    Vec3  AngularVelocity{};
    float Mass = 1200.0f;
    Vec3  InvInertiaDiag{};
    Vec3  Gravity{0, 0, -9.81f};
    float AngularDamping = 0.05f;
    Vec3  ForceAccum{};
    Vec3  TorqueAccum{};

    [[nodiscard]] Quat Conjugate() const noexcept { return {-Orientation.x, -Orientation.y, -Orientation.z, Orientation.w}; }
    [[nodiscard]] Vec3 WorldAngularAccel(const Vec3& t) const noexcept
    {
        const Vec3 tb = Conjugate().Rotate(t);
        return Orientation.Rotate(Vec3{tb.x * InvInertiaDiag.x, tb.y * InvInertiaDiag.y, tb.z * InvInertiaDiag.z});
    }
    void ApplyForceAtPoint(const Vec3& f, const Vec3& p) noexcept { ForceAccum += f; TorqueAccum += Cross(p - Position, f); }
    void ApplyTorque(const Vec3& t) noexcept { TorqueAccum += t; }
    void Integrate(float dt) noexcept
    {
        ForceAccum += Gravity * Mass;
        LinearVelocity += ForceAccum * (dt / Mass);
        Position += LinearVelocity * dt;
        AngularVelocity += WorldAngularAccel(TorqueAccum) * dt;
        AngularVelocity = AngularVelocity * std::exp(-AngularDamping * dt);
        const Quat wq{AngularVelocity.x, AngularVelocity.y, AngularVelocity.z, 0.0f};
        const Quat dq = QuatMul(wq, Orientation);
        Orientation = QuatNormalize(Quat{Orientation.x + 0.5f * dt * dq.x, Orientation.y + 0.5f * dt * dq.y,
                                         Orientation.z + 0.5f * dt * dq.z, Orientation.w + 0.5f * dt * dq.w});
        ForceAccum = Vec3{}; TorqueAccum = Vec3{};
    }
    [[nodiscard]] ChassisState State() const noexcept { return {Position, Orientation, LinearVelocity, AngularVelocity}; }
};

struct Scenario
{
    const char* Name;
    float X, Y;            // spawn position [m]
    float YawDegrees;      // heading, +Y is the kerb side for the kerb scenarios
    float Speed;           // [m/s]
    float Seconds;         // drive time after the settle
};

struct Result
{
    float PeakRise = 0.0f, PeakPitch = 0.0f, PeakRoll = 0.0f, PeakVerticalSpeed = 0.0f, PeakYawRate = 0.0f;
    float AirborneSeconds = 0.0f, FinalSpeed = 0.0f, MaxLateralDisplacement = 0.0f;
    bool  Finite = true;
};

Result Run(const Scenario& S)
{
    const float dt = 1.0f / 240.0f;
    VehicleSolverConfiguration Cfg;
    Cfg.ActiveScheme = DrivingScheme::PacejkaDrivetrain;
    VehicleGeometry Geometry{};
    ApplyGeometry(Cfg, Geometry);
    Cfg.Aero.Enabled = false;

    KerbChassis Body;
    Body.Mass = Cfg.ChassisMass;
    Body.InvInertiaDiag = Geometry.InvInertia();
    Body.Position = Vec3{S.X, S.Y, 0.5f};
    Body.Orientation = Quat::AxisAngle(Vec3{0.0f, 0.0f, 1.0f}, S.YawDegrees * 0.0174532925f);

    VehicleSolver::Hooks H;
    H.ReadChassis       = [&Body]{ return Body.State(); };
    H.ApplyForceAtPoint = [&Body](const Vec3& f, const Vec3& p){ Body.ApplyForceAtPoint(f, p); };
    H.ApplyTorque       = [&Body](const Vec3& t){ Body.ApplyTorque(t); };
    H.Ground = [](const Vec3& p, Vec3& s, Vec3& n)
    {
        float Sx, Sy, Sz, Nx, Ny, Nz;
        Frontier::Drive::CourseSurface(p.x, p.y, p.z, Sx, Sy, Sz, Nx, Ny, Nz);
        s = Vec3{Sx, Sy, Sz};
        n = Vec3{Nx, Ny, Nz};
        return true;
    };

    VehicleSolver Solver;
    Solver.Build(Cfg, H, Body.State());

    // Settle on the course at rest so the first contact is with a settled car, not the spawn drop.
    DriverInput Hold{};
    Solver.AssignInput(Hold);
    for (int s = 0; s < int(1.0f / dt); ++s) { Solver.Step(dt); Body.Integrate(dt); }

    const float SpawnZ = Body.Position.z;
    const Vec3  Start  = Body.Position;
    const Vec3  Heading = Body.Orientation.Rotate(Vec3{1.0f, 0.0f, 0.0f});
    Body.LinearVelocity = Heading * S.Speed;

    DriverInput Drive{};
    Drive.Throttle = 0.25f;     // holds the speed; the scenario measures the course, not the drivetrain
    Solver.AssignInput(Drive);

    Result R;
    const int Steps = int(S.Seconds / dt);
    for (int s = 0; s < Steps; ++s)
    {
        Solver.Step(dt);
        Body.Integrate(dt);
        const Vec3 Fwd  = Body.Orientation.Rotate(Vec3{1, 0, 0});
        const Vec3 Left = Body.Orientation.Rotate(Vec3{0, 1, 0});
        const float PitchRad = std::asin(std::fmax(-1.0f, std::fmin(1.0f, -Fwd.z)));
        const float RollRad  = std::asin(std::fmax(-1.0f, std::fmin(1.0f,  Left.z)));
        R.PeakRise          = std::fmax(R.PeakRise, Body.Position.z - SpawnZ);
        R.PeakPitch         = std::fmax(R.PeakPitch, std::fabs(PitchRad) * 57.29578f);
        R.PeakRoll          = std::fmax(R.PeakRoll,  std::fabs(RollRad)  * 57.29578f);
        R.PeakVerticalSpeed = std::fmax(R.PeakVerticalSpeed, std::fabs(Body.LinearVelocity.z));
        R.PeakYawRate       = std::fmax(R.PeakYawRate, std::fabs(Body.AngularVelocity.z));
        const Vec3 Moved = Body.Position - Start;
        R.MaxLateralDisplacement = std::fmax(R.MaxLateralDisplacement, std::fabs(Moved.y));
        if (Solver.Telemetry().WheelsInContact == 0u) R.AirborneSeconds += dt;
        if (!std::isfinite(Body.Position.z) || !std::isfinite(Body.LinearVelocity.x)) { R.Finite = false; break; }
    }
    R.FinalSpeed = Body.LinearVelocity.Length();
    return R;
}

int g_failures = 0;

void Report(const Scenario& S, const Result& R)
{
    std::printf("%-26s rise %6.3f m  pitch %5.1f deg  roll %5.1f deg  vz %5.2f m/s  yaw %5.2f rad/s  airborne %.3f s  final %5.2f m/s\n",
                S.Name, R.PeakRise, R.PeakPitch, R.PeakRoll, R.PeakVerticalSpeed, R.PeakYawRate, R.AirborneSeconds, R.FinalSpeed);
    const bool Ok = R.Finite && R.PeakRise < 0.25f && R.PeakPitch < 12.0f && R.PeakRoll < 8.0f
                 && R.PeakYawRate < 1.5f && R.AirborneSeconds < 0.15f;
    std::printf("  [%s]\n", Ok ? "PASS" : "FAIL");
    if (!Ok) ++g_failures;
}

} // namespace

int main()
{
    std::printf("Drive course kerb / bump regression — PacejkaDrivetrain, suspension on, aero off\n");
    using K = Frontier::Drive::KerbConstants;
    std::printf("kerb: inner face y=%.2f m, top z=%.3f m, x in [%.1f, %.1f] m\n\n", K::CentreY, K::Height, K::NearX, K::FarX);

    // Every run must end before x = 8 m: the authored ramp (x 9..15 m, 1.35 m crest) is a designed launch and would
    //    otherwise be measured as a kerb fault. The kerb inner face is at y = 3.20 m.
    const Scenario Scenarios[] = {
        { "A flat pad (control)",    -30.0f,  0.0f, 180.0f, 10.0f, 3.0f },   // heads -X, away from the bumps and the ramp
        { "B speed bumps",           -12.0f,  0.0f,   0.0f,  8.0f, 2.5f },   // the 0.11 m rounded bumps at x -7 and -11.5
        { "C shallow kerb strike",    -4.0f,  2.4f,   8.0f,  8.0f, 1.4f },   // wall reached near x ~ 1.6 m
        { "D steep kerb strike",      -4.0f,  2.2f,  14.0f,  8.0f, 1.2f },   // steeper, wall reached near x ~ 0 m
        { "E fast kerb strike",       -6.0f,  2.4f,   8.0f, 12.0f, 1.0f },   // 43 km/h into the same face
        { "F 72 km/h kerb corner",   -10.0f,  2.5f,  14.0f, 20.0f, 0.8f },   // the launch case: airtime + roll on the old code
        { "G 58 km/h shallow kerb",  -10.0f,  2.5f,   6.0f, 16.0f, 0.9f },   // long wheelbase lift on the old code
    };
    for (const Scenario& S : Scenarios) Report(S, Run(S));

    if (g_failures) { std::printf("\n%d course check(s) FAILED\n", g_failures); return 1; }
    std::printf("\nAll course checks PASS\n");
    return 0;
}
