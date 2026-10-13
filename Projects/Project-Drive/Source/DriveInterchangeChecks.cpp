//============================================================================================================================================
//                                                        DRIVEINTERCHANGECHECKS.CPP
//============================================================================================================================================
// 📦 Exercises the actual project callbacks: transport, vehicle motion, camera requests, pause, reset and retirement.

#include "../../../Engine/ProjectInterchange/ProjectInterchange.h"
#include "../../../Engine/ProjectInterchange/DisplayInterchange.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include "DriveCabinLayout.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <string>
#include <vector>

namespace {
struct ReceptionMetrics
{
    float Body[16]{};
    float Wheels[4][16]{};
    uint32_t Mutations = 0u;
    uint32_t Cameras = 0u;
};

void ReceivePlacement(const FrontierProjectSceneMutation* Mutation, void* Address)
{
    auto& Reception = *static_cast<ReceptionMetrics*>(Address);
    assert(Mutation->MutationNumber == 2u);
    for (float Cell : Mutation->Transform) assert(std::isfinite(Cell));
    if (std::strncmp(Mutation->SubjectName, "ControlVehicle", 14u) == 0)
        std::memcpy(Reception.Body, Mutation->Transform, sizeof(Reception.Body));
    const char* Names[] = { "Tyre FL", "Tyre FR", "Tyre RL", "Tyre RR" };
    for (uint32_t Slot = 0u; Slot < 4u; ++Slot)
        if (std::strcmp(Mutation->SubjectName, Names[Slot]) == 0)
            std::memcpy(Reception.Wheels[Slot], Mutation->Transform, sizeof(Reception.Wheels[Slot]));
    ++Reception.Mutations;
}

void ReceiveCamera(const FrontierProjectCameraRequest* Request, void* Address)
{
    auto& Reception = *static_cast<ReceptionMetrics*>(Address);
    for (float Cell : Request->Eye) assert(std::isfinite(Cell));
    float Length = 0.0f;
    for (float Cell : Request->Forward) Length += Cell * Cell;
    assert(std::abs(Length - 1.0f) < 1e-4f);
    assert(Request->VerticalFieldOfView > 0.1f);
    ++Reception.Cameras;
}
}

int main()
{
    FrontierProjectInterchange Project{};
    FrontierProjectRefusal Refusal{};
    assert(ConstructProjectInterchange(2u, UINT64_C(0xdd4363893c94c8f0), &Project, &Refusal) == 0u);
    assert(ConstructProjectInterchange(FrontierCodeInterchangeNumber, FrontierCodeInterchangeFingerprint, &Project, &Refusal));
    ReceptionMetrics Reception;
    FrontierProjectHostInterchange Host{};
    Host.StructureSize = sizeof(Host);
    Host.ReceiveSceneMutation = &ReceivePlacement;
    Host.ReceiveCameraRequest = &ReceiveCamera;
    Host.ProjectReception = &Reception;
    FrontierProjectLaunch Launch{};
    Launch.StructureSize = sizeof(Launch);
    void* Record = nullptr;
    assert(Project.ConstructProject(&Launch, &Host, &Record, &Refusal));
    assert(Record != nullptr);
    FrontierProjectInputReading Input{};
    Input.StructureSize = sizeof(Input);
    FrontierProjectCycle Cycle{};
    Cycle.StructureSize = sizeof(Cycle);
    Cycle.CycleSeconds = 1.0f / 60.0f;
    Cycle.InputReading = &Input;
    const auto Advance = [&](uint32_t Count)
    {
        for (uint32_t Tick = 0u; Tick < Count; ++Tick)
        {
            Cycle.ElapsedSeconds += Cycle.CycleSeconds;
            assert(Project.AdvanceProject(Record, &Cycle, &Refusal));
        }
    };
    Input.MoveAxisY = 1.0f;
    Advance(60u);
    assert(Reception.Mutations == 0u && Reception.Cameras == 0u);
    std::puts("PASS edit mode never drives or requests a player camera");

    Input.TransportNumber = 1u;
    Advance(180u);
    std::printf("Drive displacement: %.4f %.4f %.4f metres\n", Reception.Body[12], Reception.Body[13], Reception.Body[14]);
    assert(Reception.Body[12] > 1.0f);
    assert(Reception.Mutations == 900u && Reception.Cameras == 180u);
    std::puts("PASS Play drives the real vehicle solver and emits all five placements plus the chase camera");

    Input.Paused = 1u;
    const auto Before = Reception;
    Advance(30u);
    assert(Reception.Mutations == Before.Mutations);
    assert(std::memcmp(Reception.Body, Before.Body, sizeof(Before.Body)) == 0);
    Input.SimulationStep = 1u;
    Advance(1u);
    assert(Reception.Mutations == Before.Mutations + 5u);
    Input.SimulationStep = 0u;
    Advance(1u);
    assert(Reception.Mutations == Before.Mutations + 5u);
    std::puts("PASS pause holds simulation; one step advances exactly one interval");

    Input.ResetPressed = 1u;
    Advance(1u);
    assert(std::abs(Reception.Body[12]) < 1e-5f && std::abs(Reception.Body[13]) < 1e-5f);
    for (const auto& Wheel : Reception.Wheels)
        for (uint32_t Axis = 12u; Axis < 15u; ++Axis) assert(std::abs(Wheel[Axis]) < 1e-5f);
    std::puts("PASS paused reset returns both chassis and all wheel transforms to spawn");
    Input.TransportNumber = 0u;
    Advance(1u);
    Input.TransportNumber = 2u;
    Input.Paused = 0u;
    Input.ResetPressed = 0u;
    const uint32_t Cameras = Reception.Cameras;
    Advance(120u);
    assert(Reception.Cameras == Cameras);
    assert(std::abs(Reception.Body[12]) < 0.2f);
    std::puts("PASS Simulate integrates without keyboard driving or a chase-camera takeover");

    Input.TransportNumber = 0u;
    Advance(1u);
    Input.TransportNumber = 1u;
    Input.KeyboardCaptured = 1u;
    Advance(120u);
    assert(std::abs(Reception.Body[12]) < 0.2f);
    std::puts("PASS text-input capture suppresses driving");
    Project.RetireProject(Record);
    std::puts("PASS project retirement");
    // Exercise the actual project callback, not only the generic actor container.
    for (bool Consume : {false, true})
    {
        const std::string Specification = (std::filesystem::current_path() / "DeploymentCheck.frontier").string();
        {
            std::ofstream File(Specification);
            File << "[DeploymentPoint]\nPosition = [2,3,0.55]\nPlayerIdentifier = 73\n"
                    "Rotation = [0,0,0.70710678,0.70710678]\nDeleteAfterSpawn = " << (Consume ? "true" : "false") << "\n";
        }
        Launch.SpecificationLocation = Specification.c_str();
        Reception = {}; Input = {}; Input.StructureSize = sizeof(Input); Record = nullptr;
        assert(Project.ConstructProject(&Launch, &Host, &Record, &Refusal));
        Input.ResetPressed = 1u; Advance(1); // edit-mode R must not consume a pre-game deployment actor
        Input.ResetPressed = 0u; Input.TransportNumber = 1u; Input.Paused = 1u; Advance(1);
        assert(Reception.Mutations == 5u);
        assert(std::abs(Reception.Body[12] - 2.0f) < 1e-4f && std::abs(Reception.Body[13] - 3.0f) < 1e-4f);
        assert(std::abs(Reception.Body[0]) < 1e-4f && Reception.Body[1] > .99f);
        Input.ResetPressed = 1u; Advance(1);
        assert(Reception.Mutations == (Consume ? 5u : 10u));
        Advance(1); // held key never repeatedly deploys
        assert(Reception.Mutations == (Consume ? 5u : 10u));
        Input.TransportNumber = 0u; Advance(1);
        Input.TransportNumber = 1u; Advance(1); // a new editor session restores the authored point
        assert(Reception.Mutations == (Consume ? 10u : 15u));
        Project.RetireProject(Record);
        std::filesystem::remove(Specification);
    }
    std::puts("PASS real deployment callbacks: configured position/yaw, edit-mode safety, optional deletion, respawn edge and new-session restoration");

    // Cabin displays through the display interchange: the real .frontier (so the Inter archives resolve), two
    //    sheets with their material names, revisions that move while driving, and a pointer ray that lands on the
    //    tablet glass. Both compilers see this file by absolute path, so __FILE__ locates the project.
    {
        const std::string Specification = (std::filesystem::path(__FILE__).parent_path().parent_path() / "ProjectDrive.frontier").string();
        Launch.SpecificationLocation = Specification.c_str();
        Reception = {}; Input = {}; Input.StructureSize = sizeof(Input); Record = nullptr;
        assert(Project.ConstructProject(&Launch, &Host, &Record, &Refusal));
        FrontierProjectDisplayReading Display{};
        Display.StructureSize = sizeof(Display); Display.InterchangeNumber = 1u;
        Display.Ordinal = 7u;
        assert(ProjectDisplayInterchange(Record, &Display) == 0u);          // past the last display
        Display.InterchangeNumber = 9u; Display.Ordinal = 0u;
        assert(ProjectDisplayInterchange(Record, &Display) == 2u);          // malformed record
        Display.InterchangeNumber = 1u;
        const char* Subjects[2] = { "Display:CabinTablet", "Display:DriverCluster" };
        uint64_t Revisions[2] = {};
        uint32_t Sizes[2][2] = {};
        Input.TransportNumber = 1u; Input.MoveAxisY = 1.0f; Advance(120u);
        for (uint32_t Ordinal = 0u; Ordinal < 2u; ++Ordinal)
        {
            Display.Ordinal = Ordinal; Display.Capacity = 0u; Display.Texels = nullptr;
            assert(ProjectDisplayInterchange(Record, &Display) == 1u);
            assert(Display.SubjectName && std::strcmp(Display.SubjectName, Subjects[Ordinal]) == 0);
            assert(Display.Width >= 256u && Display.Height >= 128u && Display.Luminance > 0.0f);
            assert(Display.Revision > 0u);                                 // rastered at least once while driving
            Revisions[Ordinal] = Display.Revision; Sizes[Ordinal][0] = Display.Width; Sizes[Ordinal][1] = Display.Height;
            std::vector<uint8_t> Texels(static_cast<size_t>(Display.Width) * Display.Height * 4u);
            Display.Capacity = static_cast<uint32_t>(Texels.size()) - 4u; Display.Texels = Texels.data();
            assert(ProjectDisplayInterchange(Record, &Display) == 2u);     // short buffer refused
            Display.Capacity = static_cast<uint32_t>(Texels.size());
            assert(ProjectDisplayInterchange(Record, &Display) == 1u);
            uint32_t Lit = 0u;
            for (size_t Texel = 0u; Texel < Texels.size(); Texel += 4u) Lit += Texels[Texel] + Texels[Texel + 1u] + Texels[Texel + 2u] > 96u;
            assert(Lit > Texels.size() / 4u / 50u);                        // the sheet is drawn, not blank
            std::printf("Display %u %s %ux%u revision %llu, %u lit texels, %.0f nit\n", Ordinal, Display.SubjectName, Display.Width, Display.Height,
                        static_cast<unsigned long long>(Display.Revision), Lit, Display.Luminance);
        }
        Advance(120u);                                                     // speed/rpm move → the cluster re-rasters
        Display.Ordinal = 1u; Display.Capacity = 0u; Display.Texels = nullptr;
        assert(ProjectDisplayInterchange(Record, &Display) == 1u);
        assert(Display.Revision > Revisions[1] && Display.Width == Sizes[1][0] && Display.Height == Sizes[1][1]);
        std::puts("PASS cabin displays: two bound sheets, drawn texels, cluster revision advances with telemetry, refusals for malformed/short records");

        // Touch: the chassis is at a known pose after reset, so aim at the tablet from above the driver's seat.
        Input.MoveAxisY = 0.0f; Input.Paused = 1u; Input.ResetPressed = 1u; Advance(1u); Input.ResetPressed = 0u; Advance(1u);
        Display.Ordinal = 0u;
        assert(ProjectDisplayInterchange(Record, &Display) == 1u);
        assert(Display.ContactHit == 0u);                                  // zero direction = no pointer
        // Body mutations are T(simulated) R T(-rest): the chassis itself sits at rest height (CoMHeight + 0.02).
        const Frontier::Vehicle::VehicleGeometry Geometry;
        const float Rebase = Geometry.CoMModelZ(), Rest = Geometry.CoMHeight + 0.02f;
        const Frontier::Drive::CabinFixture Tablet = Frontier::Drive::CabinTabletFixture();
        const float Eye[3] = { Reception.Body[12] - 0.25f, Reception.Body[13] + 0.42f, Reception.Body[14] + Rest + 1.02f - Rebase };
        const float Glass[3] = { Reception.Body[12] + Tablet.Centre[0], Reception.Body[13] + Tablet.Centre[1], Reception.Body[14] + Rest + Tablet.Centre[2] - Rebase };
        float Toward[3] = { Glass[0] - Eye[0], Glass[1] - Eye[1], Glass[2] - Eye[2] };
        const float Length = std::sqrt(Toward[0] * Toward[0] + Toward[1] * Toward[1] + Toward[2] * Toward[2]);
        for (float& Cell : Toward) Cell /= Length;
        std::memcpy(Display.RayOrigin, Eye, sizeof(Eye)); std::memcpy(Display.RayDirection, Toward, sizeof(Toward));
        Display.Pressed = 0u;
        assert(ProjectDisplayInterchange(Record, &Display) == 1u);
        std::printf("Tablet contact: hit %u at %.0f, %.0f\n", Display.ContactHit, Display.ContactAcross, Display.ContactDown);
        assert(Display.ContactHit == 1u);
        assert(Display.ContactAcross > 0.0f && Display.ContactAcross < static_cast<float>(Sizes[0][0]));
        assert(Display.ContactDown > 0.0f && Display.ContactDown < static_cast<float>(Sizes[0][1]));
        Project.RetireProject(Record);
        std::puts("PASS tablet touch: a world ray from the driver's seat resolves to a sheet pixel through the posed glass");
    }

}
