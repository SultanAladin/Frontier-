//============================================================================================================================================
//                                                       PROJECTZEROINTERCHANGE.CPP
//============================================================================================================================================
// 📦 Project-Zero owns authored-car behaviour; shared vehicle mechanics and Frontier-owned rendering cross versioned C records.

#include "../../../Engine/ProjectInterchange/ProjectInterchange.h"
#include "../../../Engine/ProjectInterchange/TyreDeformationInterchange.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/TyreDeformationPublisher.h"
#include <array>
#include "../../../Engine/ProjectInterchange/VehicleInterchange.h"
#include "../../../Engine/DisplayPresentation/ChaseCameraSolver.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/DriverInputIntegrator.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <memory>
#include <sstream>

namespace
{

constexpr const char* VehicleSubjects[] =
{
    "ControlVehicle — paint / glass / plastic", "Tyre FL", "Tyre FR", "Tyre RL", "Tyre RR",
};

struct VehiclePlacementSpecification
{
    Frontier::Vehicle::Vec3 InitialVelocity{};
    Frontier::Vehicle::Vec3 InitialAngularVelocity{};
    bool DiagnosticIgnition = false;
};

void WriteRefusal(FrontierProjectRefusal* Refusal, FrontierProjectRefusalNumber Number, const char* Explanation)
{
    if (!Refusal) return;
    Refusal->Number = static_cast<uint32_t>(Number);
    std::snprintf(Refusal->Explanation, sizeof(Refusal->Explanation), "%s", Explanation);
}

bool DecodeVehiclePlacement(const char* Location, VehiclePlacementSpecification& Placement)
{
    if (!Location || !Location[0]) return true;
    std::ifstream Stream(std::filesystem::u8path(Location));
    if (!Stream) return false;
    bool VehicleSection = false;
    std::string Line;
    while (std::getline(Stream, Line))
    {
        const auto Comment = Line.find('#');
        if (Comment != std::string::npos) Line.resize(Comment);
        const auto First = Line.find_first_not_of(" \t\r");
        if (First == std::string::npos) continue;
        if (Line[First] == '[')
        {
            VehicleSection = Line.substr(First).find("[Vehicle]") == 0u;
            continue;
        }
        if (!VehicleSection) continue;
        const auto Separator = Line.find('=');
        if (Separator == std::string::npos) return false;
        std::string Subject = Line.substr(First, Separator - First);
        Subject.erase(Subject.find_last_not_of(" \t") + 1u);
        std::string Reading = Line.substr(Separator + 1u);
        if (Subject == "DiagnosticIgnition")
        {
            if (Reading.find("true") != std::string::npos) Placement.DiagnosticIgnition = true;
            else if (Reading.find("false") != std::string::npos) Placement.DiagnosticIgnition = false;
            else return false;
            continue;
        }
        if (Subject != "InitialVelocity" && Subject != "InitialAngularVelocity") return false;
        for (char& Character : Reading)
            if (Character == '[' || Character == ']' || Character == ',') Character = ' ';
        Frontier::Vehicle::Vec3 Direction;
        std::istringstream Components(Reading);
        if (!(Components >> Direction.x >> Direction.y >> Direction.z) ||
            !std::isfinite(Direction.x) || !std::isfinite(Direction.y) || !std::isfinite(Direction.z) ||
            Direction.Length() > 150.0f) return false;
        if (Subject == "InitialVelocity") Placement.InitialVelocity = Direction;
        else Placement.InitialAngularVelocity = Direction;
    }
    return true;
}

struct ZeroVehicleSequence
{
    FrontierProjectHostInterchange Reception{};
    Frontier::Vehicle::VehicleGeometry Geometry;
    Frontier::Vehicle::VehicleInstanceSequence Vehicle;
    Frontier::Vehicle::DriverInputIntegrator Driving;
    Frontier::Vehicle::ChaseCameraSolver Camera;
    VehiclePlacementSpecification Placement;
    std::vector<Frontier::InstanceRecord> Poses{5u};
    uint64_t CarrierIdentifier = 0u;
    uint32_t PreviousTransport = 0u;
    bool PreviousReset = false;

    bool Deploy()
    {
        Frontier::Vehicle::VehicleInstanceConfiguration Specification;
        Specification.SpawnHeight           = Geometry.CoMHeight + 0.02f;
        Specification.TyreConditionsEnabled = true;
        Specification.TyreIgnitionEnabled   = true;
        Specification.DriftSmokeEnabled     = true;
        if (!Vehicle.Construct(Geometry, Specification)) return false;
        if (Placement.DiagnosticIgnition)
        {
            // 📝 Appearance fixture only. Ordinary Project-Zero retains production heat capacities and thresholds.
            auto Configuration = Vehicle.Configuration();
            Configuration.TyreThermal.SurfaceHeatCapacity     = 100.0;
            Configuration.TyreThermal.IgnitionTemperature     = 315.0;
            Configuration.TyreThermal.ExtinctionTemperature   = 310.0;
            Configuration.TyreThermal.IgnitionExposureSeconds = 0.2;
            Vehicle.Reconfigure(Configuration);
        }
        Vehicle.DeployMotion(Placement.InitialVelocity, Placement.InitialAngularVelocity);
        Driving = Frontier::Vehicle::DriverInputIntegrator{};
        ++CarrierIdentifier;
        return true;
    }

    std::array<Frontier::TyreDeformationRecord, 4> TyreRecords{};
    uint64_t TyreRevision = 0u;

    void PublishGeometry()
    {
        const auto& Tyres = Vehicle.Tyres();
        const auto& Wheels = Vehicle.Telemetry().Wheels;
        for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
            TyreRecords[Wheel] = (Wheel < Tyres.size() && Wheel < Wheels.size())
                ? Frontier::Vehicle::ComposeTyreDeformation(Tyres[Wheel], Wheels[Wheel], Vehicle.Configuration().Tyre)
                : Frontier::TyreDeformationRecord{};
        ++TyreRevision;
        if (!Reception.ReceiveSceneMutation) return;
        for (uint32_t Slot = 0u; Slot < 5u; ++Slot)
        {
            FrontierProjectSceneMutation Mutation{};
            Mutation.StructureSize = sizeof(Mutation);
            Mutation.MutationNumber = 2u;
            Mutation.SubjectName = VehicleSubjects[Slot];
            std::copy_n(Poses[Slot].World, 16u, Mutation.Transform);
            Frontier::Vehicle::Vec3 RestOrigin{0.0f, 0.0f, Geometry.CoMHeight + 0.02f};
            if (Slot) RestOrigin += Geometry.AxleMountLocal(Slot - 1u);
            for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                Mutation.Transform[12u + Axis] -= Mutation.Transform[Axis] * RestOrigin.x
                                               + Mutation.Transform[4u + Axis] * RestOrigin.y
                                               + Mutation.Transform[8u + Axis] * RestOrigin.z;
            Reception.ReceiveSceneMutation(&Mutation, Reception.ProjectReception);
        }
    }

    void PublishCamera(float Seconds, bool Snap)
    {
        if (!Reception.ReceiveCameraRequest) return;
        const auto& Chassis = Vehicle.Chassis();
        const auto Forward = Chassis.Orientation.Rotate({1.0f, 0.0f, 0.0f});
        const Frontier::Vector3 Position{Chassis.Position.x, Chassis.Position.y, Chassis.Position.z};
        const Frontier::Vector3 Direction{Forward.x, Forward.y, Forward.z};
        if (Snap) Camera.SnapTo(Position, Direction);
        else Camera.AdvanceChase(Position, Direction, Chassis.LinearVelocity.Length(), Seconds);
        FrontierProjectCameraRequest Request{};
        Request.StructureSize = sizeof(Request);
        const auto& Eye = Camera.QuerySpatialLocation();
        const auto& Sight = Camera.QueryForwardVector();
        Request.Eye[0] = Eye.x; Request.Eye[1] = Eye.y; Request.Eye[2] = Eye.z;
        Request.Forward[0] = Sight.x; Request.Forward[1] = Sight.y; Request.Forward[2] = Sight.z;
        Request.VerticalFieldOfView = Camera.QueryFieldOfViewRadians();
        Reception.ReceiveCameraRequest(&Request, Reception.ProjectReception);
    }
};

uint32_t FRONTIER_CODE_IMAGE_CALL ConstructProject(
    const FrontierProjectLaunch*          Launch,
    const FrontierProjectHostInterchange* Reception,
    void**                               ProjectRecord,
    FrontierProjectRefusal*              Refusal)
{
    if (!Launch || Launch->StructureSize < sizeof(*Launch) || !Reception ||
        Reception->StructureSize < sizeof(*Reception) || !ProjectRecord)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectZero received an incomplete opening record");
        return 0u;
    }
    *ProjectRecord = nullptr;
    try
    {
        auto Sequence = std::make_unique<ZeroVehicleSequence>();
        Sequence->Reception = *Reception;
        if (!DecodeVehiclePlacement(Launch->SpecificationLocation, Sequence->Placement))
        {
            WriteRefusal(Refusal, FrontierProjectRefusalConstruction, "ProjectZero refused its vehicle initial conditions");
            return 0u;
        }
        if (Reception->ReceivePanel)
        {
            const FrontierProjectPanel Panel{sizeof(Panel), "ZeroVehicle", "ControlVehicle / independent tyre conditions"};
            Reception->ReceivePanel(&Panel, Reception->ProjectReception);
        }
        *ProjectRecord = Sequence.release();
        return 1u;
    }
    catch (...)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalConstruction, "ProjectZero could not acquire its vehicle record");
        return 0u;
    }
}

uint32_t FRONTIER_CODE_IMAGE_CALL AdvanceProject(
    void*                       ProjectRecord,
    const FrontierProjectCycle* Cycle,
    FrontierProjectRefusal*      Refusal)
{
    if (!ProjectRecord || !Cycle || Cycle->StructureSize < sizeof(*Cycle) || !Cycle->InputReading ||
        Cycle->InputReading->StructureSize < sizeof(FrontierProjectInputReading))
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectZero requires complete ABI3 input readings");
        return 0u;
    }
    auto& Sequence = *static_cast<ZeroVehicleSequence*>(ProjectRecord);
    const auto& Input = *Cycle->InputReading;
    const bool Started = Input.TransportNumber && !Sequence.PreviousTransport;
    const bool Reset = Input.ResetPressed && !Sequence.PreviousReset && !Input.KeyboardCaptured;
    if (Started || (Input.TransportNumber && Reset))
        if (!Sequence.Deploy())
        {
            WriteRefusal(Refusal, FrontierProjectRefusalConstruction, "ProjectZero vehicle deployment refused");
            return 0u;
        }
    if (!Input.TransportNumber && Sequence.PreviousTransport) Sequence.Vehicle.ResetToSpawn();
    Sequence.PreviousTransport = Input.TransportNumber;
    Sequence.PreviousReset = Input.ResetPressed != 0u;
    if (!Input.TransportNumber) return 1u;
    const float Seconds = Input.Paused ? (Input.SimulationStep ? 1.0f / 60.0f : 0.0f)
                                      : std::clamp(Cycle->CycleSeconds, 0.0f, 0.1f);
    const bool Driving = Input.TransportNumber == 1u && !Input.KeyboardCaptured;
    if (!Driving) Sequence.Driving = Frontier::Vehicle::DriverInputIntegrator{};
    Sequence.Driving.ForwardThrottleKey(Driving && Input.MoveAxisY > 0.0f);
    Sequence.Driving.ForwardBrakeKey(Driving && Input.MoveAxisY < 0.0f);
    Sequence.Driving.ForwardSteerLeftKey(Driving && Input.MoveAxisX < 0.0f);
    Sequence.Driving.ForwardSteerRightKey(Driving && Input.MoveAxisX > 0.0f);
    Sequence.Driving.ForwardHandbrakeKey(Driving && Input.HandbrakePressed);
    const auto Command = Sequence.Driving.Advance(Seconds);
    if (Seconds > 0.0f || Started || Reset)
    {
        Sequence.Vehicle.AdvanceVehicle(Command.Drive, Sequence.Poses, Seconds);
        Sequence.PublishGeometry();
    }
    if (Input.TransportNumber == 1u) Sequence.PublishCamera(Seconds, Started || Reset);
    return 1u;
}

void FRONTIER_CODE_IMAGE_CALL RetireProject(void* ProjectRecord)
{
    delete static_cast<ZeroVehicleSequence*>(ProjectRecord);
}

} // namespace

extern "C" FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ConstructProjectInterchange(
    uint32_t RequestedInterchangeNumber, uint64_t RequestedFingerprint,
    FrontierProjectInterchange* DeliveredInterchange, FrontierProjectRefusal* Refusal)
{
    if (!DeliveredInterchange || RequestedInterchangeNumber != FrontierCodeInterchangeNumber ||
        RequestedFingerprint != FrontierCodeInterchangeFingerprint)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalInterchange, "ProjectZero cannot deliver the requested C interchange");
        return 0u;
    }
    *DeliveredInterchange = {};
    DeliveredInterchange->StructureSize = sizeof(*DeliveredInterchange);
    DeliveredInterchange->CodeInterchangeNumber = FrontierCodeInterchangeNumber;
    DeliveredInterchange->InterfaceFingerprint = FrontierCodeInterchangeFingerprint;
    DeliveredInterchange->ConstructProject = &ConstructProject;
    DeliveredInterchange->AdvanceProject = &AdvanceProject;
    DeliveredInterchange->RetireProject = &RetireProject;
    return 1u;
}

extern "C" FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectTyreDeformationInterchange(
    void* ProjectRecord, FrontierProjectTyreDeformationReading* Reading)
{
    if (!Reading || Reading->StructureSize != sizeof(*Reading) || Reading->InterchangeNumber != 1u) return 2u;
    const auto* Sequence = static_cast<const ZeroVehicleSequence*>(ProjectRecord);
    Reading->Count = 0u;
    Reading->Revision = Sequence && Sequence->PreviousTransport ? Sequence->TyreRevision : 0u;
    if (Reading->Capacity == 0u) { Reading->Count = 4u; return 1u; }
    if (!Sequence || !Reading->Revision) return 0u;
    if (!Reading->Records || !Reading->SubjectNames) return 2u;
    static_assert(sizeof(FrontierTyreDeformationRecord) == sizeof(Frontier::TyreDeformationRecord), "record layouts must agree");
    const uint32_t Count = Reading->Capacity < 4u ? Reading->Capacity : 4u;
    for (uint32_t Wheel = 0u; Wheel < Count; ++Wheel)
    {
        Reading->SubjectNames[Wheel] = VehicleSubjects[Wheel + 1u];
        std::memcpy(&Reading->Records[Wheel], &Sequence->TyreRecords[Wheel], sizeof(FrontierTyreDeformationRecord));
    }
    Reading->Count = Count;
    return 1u;
}

extern "C" FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectSmokeInterchange(
    void* ProjectRecord, FrontierProjectSmokeReading* Reading)
{
    const auto* Sequence = static_cast<const ZeroVehicleSequence*>(ProjectRecord);
    return Frontier::DeliverVehicleSmoke(Sequence && Sequence->PreviousTransport ? &Sequence->Vehicle : nullptr,
                                        Sequence ? Sequence->CarrierIdentifier : 0u, Reading);
}

extern "C" FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectSmokeTransportInterchange(
    void* ProjectRecord, FrontierSmokeTransportReading* Reading)
{
    const auto* Sequence = static_cast<const ZeroVehicleSequence*>(ProjectRecord);
    return Frontier::DeliverVehicleTransport(Sequence && Sequence->PreviousTransport ? &Sequence->Vehicle : nullptr,
                                            Sequence ? Sequence->CarrierIdentifier : 0u, Reading);
}
