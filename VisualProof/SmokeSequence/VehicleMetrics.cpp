//============================================================================================================================================
//                                                             VEHICLEMETRICS.CPP
//============================================================================================================================================
// 📦 Native combined-slip vehicle/thermal/smoke recordings and actual Drive C-publication lifecycle checks.

#include "../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include "../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.h"
#include "../../Engine/VolumetricDynamics/GasVehicleIntake.h"
#include "../../Engine/Host/SmokeSequence.h"
#include "../../Projects/Project-Drive/Source/VehicleInstanceSequence.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <vector>

using namespace Frontier;
using namespace Frontier::Vehicle;
using Frontier::Drive::VehicleChassisBody;

namespace
{

constexpr float StepSeconds = 1.0f / 240.0f;

bool ReadFlat(const Vec3& Position, Vec3& Surface, Vec3& Normal)
{
    Surface = {Position.x, Position.y, 0.0f};
    Normal = {0.0f, 0.0f, 1.0f};
    return true;
}

struct DriftFixture
{
    VehicleGeometry            Geometry     ;
    VehicleChassisBody         Body         ;
    VehicleSolver              Solver       ;
    VehicleSolverConfiguration Tuning       ;
    Frontier::SmokeSequence    Transport    ;
    SmokeSpecification         Smoke        ;
    bool                       Airborne      = false;
    std::array<GasEmission, 16> Emissions{};
    uint32_t                   EmissionCount = 0u;

    void Construct(bool Air, bool DiagnosticFire)
    {
        Airborne = Air;
        ApplyGeometry(Tuning, Geometry);
        Tuning.ActiveScheme = DrivingScheme::PacejkaDrivetrain;
        Tuning.Aero.Enabled = false;
        Tuning.TyreThermal.Enabled = true;
        Tuning.TyreThermal.IgnitionEnabled = true;
        if (DiagnosticFire)
        {
            Tuning.TyreThermal.SurfaceHeatCapacity = 100.0;
            Tuning.TyreThermal.IgnitionTemperature = 315.0;
            Tuning.TyreThermal.ExtinctionTemperature = 310.0;
            Tuning.TyreThermal.IgnitionExposureSeconds = 0.2;
        }
        Body.Position = {0.0f, 0.0f, Air ? 25.0f : 0.55f};
        Body.Mass = Tuning.ChassisMass;
        Body.InvInertiaDiag = Geometry.InvInertia();
        const GroundQuery Ground = [this](const Vec3& Position, Vec3& Surface, Vec3& Normal)
        { return !Airborne && ReadFlat(Position, Surface, Normal); };
        const VehicleSolver::Hooks Reception
        {
            [this] { return Body.State(); },
            [this](const Vec3& Force, const Vec3& Position) { Body.ApplyForceAtPoint(Force, Position); },
            [this](const Vec3& Torque) { Body.ApplyTorque(Torque); },
            Ground
        };
        Solver.Build(Tuning, Reception, Body.State());
        assert(!Transport.QueryField());
    }

    static void PrepareObstruction(CoarseGasField& Field, const void* Context)
    {
        const auto& Fixture = *static_cast<const DriftFixture*>(Context);
        if (Fixture.Airborne) return;
        for (uint32_t Z = 0u; Z < CoarseExtent; ++Z)
        {
            const float Height = Field.Origin[2] + (Z + 0.5f) * VoxelSize(Field);
            if (Height >= 0.0f) continue;
            for (uint32_t Y = 0u; Y < CoarseExtent; ++Y)
            for (uint32_t X = 0u; X < CoarseExtent; ++X) Field.Occupancy[VoxelIndex(X, Y, Z)] = 1.0f;
        }
    }

    void Advance(const DriverInput& Input, uint32_t Tick)
    {
        Solver.AssignInput(Input);
        Solver.Step(StepSeconds);
        Body.Integrate(StepSeconds);
        const auto& Telemetry = Solver.Telemetry();
        for (uint32_t Wheel = 0u; Wheel < Telemetry.WheelCount; ++Wheel)
        {
            auto Emission = ResolveWheelSmoke(Telemetry, Wheel, Smoke);
            if (Emission.SmokeRate <= 0.0f && Emission.TemperatureRate <= 0.0f) continue;
            Emission.SmokeRate *= 0.25f;
            Emission.TemperatureRate *= 0.25f;
            assert(EmissionCount < Emissions.size());
            Emissions[EmissionCount++] = Emission;
        }
        if (Tick % 4u == 3u)
        {
            const float Placement[3] = {Body.Position.x, Body.Position.y, Body.Position.z};
            assert(Transport.Integrate(Smoke, Emissions.data(), EmissionCount, Placement, &PrepareObstruction, this));
            EmissionCount = 0u;
        }
        assert(std::isfinite(Body.Position.x) && std::isfinite(Body.Position.y) && std::isfinite(Body.Position.z));
        for (const auto& Wheel : Telemetry.Wheels) if (Wheel.Thermal.Valid)
            assert(std::abs(Wheel.Thermal.EnergyResidualJoules) < 0.01);
    }
};

struct CaseReading
{
    const char* Name;
    Vec3  InitialVelocity;
    float InitialYaw     ;
    float Steering       ;
    bool  Airborne       ;
    bool  DiagnosticFire ;
};

void Record(const std::filesystem::path& Folder, const CaseReading& Case)
{
    DriftFixture Fixture;
    Fixture.Construct(Case.Airborne, Case.DiagnosticFire);
    for (uint32_t Tick = 0u; Tick < 360u; ++Tick) Fixture.Advance({}, Tick);
    const auto WarmMetrics = Fixture.Transport.QueryMetrics();
    assert(!WarmMetrics.Resident && WarmMetrics.Acquisitions == 0u);
    Fixture.Body.LinearVelocity = Case.InitialVelocity; // one initial condition, never commanded again
    Fixture.Body.AngularVelocity.z = Case.InitialYaw;
    std::array<double, 4> InitialHeat{};
    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel) InitialHeat[Wheel] = Fixture.Solver.Telemetry().Wheels[Wheel].Thermal.SlidingHeatJoules;
    std::ofstream Trace(Folder / (std::string(Case.Name) + ".csv"));
    std::ofstream Capture(Folder / (std::string(Case.Name) + ".smoke"), std::ios::binary);
    const uint32_t Version = 1u;
    const uint32_t Extent = CoarseExtent;
    Capture.write("FSKV", 4u);
    Capture.write(reinterpret_cast<const char*>(&Version), sizeof(Version));
    Capture.write(reinterpret_cast<const char*>(&Extent), sizeof(Extent));
    Trace << "t,x,y,z,yaw,acquisitions,relocations,resident,peak_density,peak_temperature,quiet_seconds";
    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
        Trace << ",surface_C_" << Wheel << ",carcass_C_" << Wheel << ",gas_C_" << Wheel << ",pressure_kPa_" << Wheel
              << ",sliding_W_" << Wheel << ",sliding_heat_J_" << Wheel << ",grip_" << Wheel << ",ignited_" << Wheel
              << ",fuel_kg_" << Wheel << ",slip_m_s_" << Wheel;
    Trace << '\n';
    double MaximumSliding = 0.0;
    double MaximumHeat = 0.0;
    float MaximumYawChange = 0.0f;
    uint32_t IgnitionSamples = 0u;
    uint32_t MovingCloudSamples = 0u;
    uint32_t QuietCloudSamples = 0u;
    const float InitialHeading = std::atan2(Fixture.Body.Orientation.Rotate({1,0,0}).y, Fixture.Body.Orientation.Rotate({1,0,0}).x);
    constexpr uint32_t Ticks = 1440u;
    for (uint32_t Tick = 0u; Tick < Ticks; ++Tick)
    {
        DriverInput Input;
        Input.Steer = Case.Steering;
        Fixture.Advance(Input, Tick);
        const auto& Telemetry = Fixture.Solver.Telemetry();
        for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
        {
            const auto& Condition = Telemetry.Wheels[Wheel].Thermal;
            assert(Condition.Valid);
            MaximumSliding = std::max(MaximumSliding, Condition.SlidingPower);
            MaximumHeat = std::max(MaximumHeat, Condition.SlidingHeatJoules - InitialHeat[Wheel]);
            if (Condition.Ignited) ++IgnitionSamples;
            if (Case.Airborne) assert(Condition.SlidingPower == 0.0);
        }
        if (Tick % 12u != 11u) continue;
        const float Time = (Tick + 1u) * StepSeconds;
        const Vec3 Heading = Fixture.Body.Orientation.Rotate({1,0,0});
        const float Yaw = std::atan2(Heading.y, Heading.x);
        MaximumYawChange = std::max(MaximumYawChange, std::abs(std::remainder(Yaw - InitialHeading, 6.283185307f)));
        const auto& Metrics = Fixture.Transport.QueryMetrics();
        if (Metrics.Resident && Metrics.ActiveSources) ++MovingCloudSamples;
        if (Metrics.Resident && !Metrics.ActiveSources) ++QuietCloudSamples;
        Trace << Time << ',' << Fixture.Body.Position.x << ',' << Fixture.Body.Position.y << ',' << Fixture.Body.Position.z << ',' << Yaw
              << ',' << Metrics.Acquisitions << ',' << Metrics.Relocations << ',' << Metrics.Resident << ',' << Metrics.PeakDensity
              << ',' << Metrics.PeakTemperature << ',' << Metrics.QuietSeconds;
        std::array<float, 37> Pose{};
        Pose[0] = Time;
        Pose[1] = Fixture.Body.Position.x; Pose[2] = Fixture.Body.Position.y; Pose[3] = Fixture.Body.Position.z;
        Pose[4] = Yaw;
        for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
        {
            const auto& Reading = Telemetry.Wheels[Wheel];
            const auto& Condition = Reading.Thermal;
            Trace << ',' << Condition.SurfaceTemperature - 273.15 << ',' << Condition.CarcassTemperature - 273.15
                  << ',' << Condition.GasTemperature - 273.15 << ',' << Condition.GaugePressure / 1000.0 << ',' << Condition.SlidingPower
                  << ',' << Condition.SlidingHeatJoules - InitialHeat[Wheel] << ',' << Condition.GripFactor << ',' << Condition.Ignited
                  << ',' << Condition.RemainingRubber << ',' << Reading.SlipVelocity.Length();
            const uint32_t First = 5u + Wheel * 8u;
            Pose[First] = Reading.ContactPoint.x; Pose[First + 1u] = Reading.ContactPoint.y; Pose[First + 2u] = Reading.ContactPoint.z;
            Pose[First + 3u] = static_cast<float>(Condition.SurfaceTemperature - 273.15);
            Pose[First + 4u] = static_cast<float>(Condition.GaugePressure / 1000.0);
            Pose[First + 5u] = static_cast<float>(Condition.SlidingPower);
            Pose[First + 6u] = Condition.Ignited ? 1.0f : 0.0f;
            Pose[First + 7u] = Reading.InContact ? 1.0f : 0.0f;
        }
        Trace << '\n';
        Capture.write(reinterpret_cast<const char*>(Pose.data()), sizeof(Pose));
        const auto* Field = Fixture.Transport.QueryField();
        const uint32_t Resident = Field ? 1u : 0u;
        Capture.write(reinterpret_cast<const char*>(&Resident), sizeof(Resident));
        const float Bounds[4] = {Field ? Field->Origin[0] : 0.0f, Field ? Field->Origin[1] : 0.0f,
                                 Field ? Field->Origin[2] : 0.0f, Field ? Field->Span : 0.0f};
        Capture.write(reinterpret_cast<const char*>(Bounds), sizeof(Bounds));
        if (Field)
        {
            Capture.write(reinterpret_cast<const char*>(Field->Smoke.data()), CoarseVoxelCount * sizeof(float));
            Capture.write(reinterpret_cast<const char*>(Field->Temperature.data()), CoarseVoxelCount * sizeof(float));
        }
    }
    const auto& Metrics = Fixture.Transport.QueryMetrics();
    if (Case.InitialVelocity.Length() == 0.0f)
    {
        assert(Metrics.Acquisitions == 0u && MaximumSliding < 1.0 && MaximumHeat < 1.0);
    }
    else if (Case.Airborne) assert(Metrics.Acquisitions == 0u && MaximumSliding == 0.0);
    else
    {
        assert(Metrics.Acquisitions == 1u && MaximumSliding > 1000.0 && MaximumHeat > 100.0 && MovingCloudSamples > 0u);
        if (Case.InitialVelocity.x > 10.0f) assert(Metrics.Relocations > 0u && QuietCloudSamples > 0u);
        if (Case.InitialYaw > 0.0f) assert(MaximumYawChange > 0.2f);
        if (Case.DiagnosticFire) assert(IgnitionSamples > 0u);
        else assert(IgnitionSamples == 0u);
    }
    std::printf("PASS %s: peak sliding %.3f W, largest per-wheel sliding heat %.3f J, domains %llu, shifts %llu, active/quiet samples %u/%u, yaw %.3f rad, burning samples %u\n",
        Case.Name, MaximumSliding, MaximumHeat, static_cast<unsigned long long>(Metrics.Acquisitions),
        static_cast<unsigned long long>(Metrics.Relocations), MovingCloudSamples, QuietCloudSamples, MaximumYawChange, IgnitionSamples);
}

void CheckLivePublication()
{
    FrontierProjectInterchange Project{};
    FrontierProjectRefusal OpeningRefusal{};
    assert(ConstructProjectInterchange(FrontierCodeInterchangeNumber, FrontierCodeInterchangeFingerprint, &Project, &OpeningRefusal));
    FrontierProjectHostInterchange Host{};
    Host.StructureSize = sizeof(Host);
    FrontierProjectLaunch Launch{};
    Launch.StructureSize = sizeof(Launch);
    void* Record = nullptr;
    assert(Project.ConstructProject(&Launch, &Host, &Record, &OpeningRefusal));
    FrontierProjectInputReading Input{};
    Input.StructureSize = sizeof(Input);
    Input.TransportNumber = 1u;
    Input.MoveAxisY = 1.0f;
    FrontierProjectCycle Cycle{};
    Cycle.StructureSize = sizeof(Cycle);
    Cycle.CycleSeconds = 1.0f / 60.0f;
    Cycle.InputReading = &Input;
    Frontier::HostRuntime::SmokeSequence Publication;
    std::string Refusal;
    uint32_t ResidentSnapshots = 0u;
    const auto Source = [&](FrontierProjectSmokeReading& Reading) { return ProjectSmokeInterchange(Record, &Reading); };
    for (uint32_t Tick = 0u; Tick < 240u; ++Tick)
    {
        assert(Project.AdvanceProject(Record, &Cycle, &OpeningRefusal));
        assert(Publication.Capture(Source, Refusal));
        if (!Publication.QueryDensity().empty()) ++ResidentSnapshots;
    }
    assert(ResidentSnapshots > 0u);
    assert(Publication.QueryReading().WheelCount == 4u);
    const uint64_t BeforePause = Publication.QueryReading().Revision;
    const uint64_t BeforeCarrier = Publication.QueryReading().CarrierIdentifier;
    Input.Paused = 1u;
    assert(Project.AdvanceProject(Record, &Cycle, &OpeningRefusal));
    assert(Publication.Capture(Source, Refusal));
    assert(Publication.QueryReading().Revision == BeforePause);
    Input.SimulationStep = 1u;
    assert(Project.AdvanceProject(Record, &Cycle, &OpeningRefusal));
    assert(Publication.Capture(Source, Refusal));
    Input.SimulationStep = 0u;
    Input.ResetPressed = 1u;
    assert(Project.AdvanceProject(Record, &Cycle, &OpeningRefusal));
    assert(Publication.Capture(Source, Refusal));
    assert(Publication.QueryReading().CarrierIdentifier > BeforeCarrier && Publication.QueryDensity().empty());
    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
        assert(std::abs(Publication.QueryReading().Tyres[Wheel].SurfaceTemperature - 293.15f) < 0.001f);
    Project.RetireProject(Record);
    Record = nullptr;
    assert(Publication.Capture(Source, Refusal) && Publication.QueryDensity().empty());
    std::printf("PASS actual Drive thermal/smoke C callback: %u resident host snapshots, pause, single step, fresh-car reset and retirement\n", ResidentSnapshots);
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count == 2);
    const std::filesystem::path Folder = Arguments[1];
    std::filesystem::create_directories(Folder);
    const CaseReading Cases[] = {
        {"holding", {}, 0.0f, 0.0f, false, false},
        {"lateral-drift", {15.0f, 6.0f, 0.0f}, 0.0f, 0.0f, false, false},
        {"turning-drift", {8.0f, 4.0f, 0.0f}, 0.45f, 0.6f, false, false},
        {"airborne", {8.0f, 4.0f, 0.0f}, 0.0f, 0.0f, true, false},
        {"diagnostic-ignition", {8.0f, 6.0f, 0.0f}, 0.0f, 0.0f, false, true}
    };
    for (const auto& Case : Cases) Record(Folder, Case);
    CheckLivePublication();
}
