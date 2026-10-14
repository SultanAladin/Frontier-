//============================================================================================================================================
//                                                         DRIVEDYNAMICSFIXTURE.H
//============================================================================================================================================
// 📦 Production chassis, authored collision positions and tyre/suspension solver for deterministic CPU motion proofs.

#pragma once

#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.h"
#include "../../../Projects/Project-Drive/Source/VehicleInstanceSequence.h"
#include "../../../Projects/Project-Drive/Source/ControlVehicleMesh.inl"
#include "../../../Projects/Project-Drive/Source/DriveCourse.h"

#include <cassert>
#include <cmath>

namespace DriveProof
{

using namespace Frontier::Vehicle;
constexpr float StepSeconds = 1.0f / 240.0f;

struct DriveFixture
{
    VehicleGeometry Geometry;
    Frontier::Drive::VehicleChassisBody Body;
    VehicleSolver Solver;
    VehicleSolverConfiguration Configuration;
    GroundQuery Ground;
    std::vector<Vec3> CollisionLocations;
    bool CorrectContacts = true;

    void Construct(const Vec3& Position,
                   const Vec3& Velocity,
                   const Quat& Rotation,
                   GroundQuery Surface,
                   const Vec3& Angular = {})
    {
        Ground = std::move(Surface);
        ApplyGeometry(Configuration, Geometry);
        Configuration.Aero.Enabled = false;
        Body.Position = Position;
        Body.Orientation = Rotation;
        Body.LinearVelocity = Velocity;
        Body.AngularVelocity = Angular;
        Body.AngularDamping = 0.0f;
        Body.LinearDamping = 0.0f;
        Body.Mass = Configuration.ChassisMass;
        Body.InvInertiaDiag = Geometry.InvInertia();
        Rebuild();
        CollisionLocations.clear();
        namespace Authored = Frontier::Drive::ControlVehicleMesh;
        for (uint32_t Index = 0u; Index < Authored::kVertexCount; ++Index)
            CollisionLocations.push_back({Authored::kPositions[Index * 3u], Authored::kPositions[Index * 3u + 1u],
                                          Authored::kPositions[Index * 3u + 2u] - Geometry.CoMModelZ()});
    }

    void Rebuild()
    {
        const VehicleSolver::Hooks Reception
        {
            [this] { return Body.State(); },
            [this](const Vec3& Force, const Vec3& Point) { Body.ApplyForceAtPoint(Force, Point); },
            [this](const Vec3& Moment) { Body.ApplyTorque(Moment); },
            Ground
        };
        Solver.Build(Configuration, Reception, Body.State());
    }

    void Advance(const DriverInput& Input = {})
    {
        Solver.AssignInput(Input);
        Solver.Step(StepSeconds);
        Body.Integrate(StepSeconds);
        const Vec3 BeforePosition = Body.Position;
        const Quat BeforeRotation = Body.Orientation;
        Body.ResolveContacts(CollisionLocations, Ground, StepSeconds);
        if (CorrectContacts && Body.Contacts.ArrivalPenetration > 0.0f)
            Solver.CorrectAttachments(BeforePosition, BeforeRotation, Body.Position, Body.Orientation);
        assert(std::isfinite(Body.KineticEnergy()));
        assert(std::isfinite(Body.Position.x) && std::isfinite(Body.Position.y) && std::isfinite(Body.Position.z));
        for (const auto& Tyre : Solver.Tyres())
            assert(std::isfinite(Tyre.HubPosition().x) && std::isfinite(Tyre.HubPosition().y) && std::isfinite(Tyre.HubPosition().z));
    }
};

} // namespace DriveProof
