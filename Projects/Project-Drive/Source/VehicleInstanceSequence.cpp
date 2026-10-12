//============================================================================================================================================
// 📦 Projects/Project-Drive/Source/VehicleInstanceSequence.cpp — engine⇄project seam: VehicleSolver → renderer instances
//============================================================================================================================================
#include "VehicleInstanceSequence.h"
#include "DriveCourse.h"
#include "ControlVehicleMesh.inl"
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleSpawnSolver.h"
#include <cstdio>

#include <algorithm>
#include <cassert>
#include <cmath>

namespace Frontier {
namespace Drive {

using Frontier::Vehicle::Vec3;
using Frontier::Vehicle::Quat;
using Frontier::Vehicle::QuatMul;
using Frontier::Vehicle::QuatNormalize;
using Frontier::Vehicle::VehicleSolver;

//------------------------------------------------------------------------------------------------------------------------ chassis body (identical integrator to DriveTelemetry / FieldDemo)
namespace
{

Vec3 RotateUnit(const Quat& Rotation, const Vec3& Direction) noexcept
{
    const double X = Rotation.x, Y = Rotation.y, Z = Rotation.z, W = Rotation.w;
    const double Norm = X * X + Y * Y + Z * Z + W * W;
    const double Projection = X * Direction.x + Y * Direction.y + Z * Direction.z;
    const double Scalar = W * W - X * X - Y * Y - Z * Z;
    return {static_cast<float>((Scalar * Direction.x + 2 * X * Projection + 2 * W * (Y * Direction.z - Z * Direction.y)) / Norm),
            static_cast<float>((Scalar * Direction.y + 2 * Y * Projection + 2 * W * (Z * Direction.x - X * Direction.z)) / Norm),
            static_cast<float>((Scalar * Direction.z + 2 * Z * Projection + 2 * W * (X * Direction.y - Y * Direction.x)) / Norm)};
}

} // namespace

Quat VehicleChassisBody::Conjugate() const noexcept
{ return {-Orientation.x, -Orientation.y, -Orientation.z, Orientation.w}; }

Vec3 VehicleChassisBody::WorldAngularAccel(const Vec3& torqueWorld) const noexcept
{
    const Vec3 tb = RotateUnit(Conjugate(), torqueWorld);
    const Vec3 ab{tb.x*InvInertiaDiag.x, tb.y*InvInertiaDiag.y, tb.z*InvInertiaDiag.z};
    return RotateUnit(Orientation, ab);
}
void VehicleChassisBody::ApplyForceAtPoint(const Vec3& f, const Vec3& p) noexcept
{ ForceAccum += f; TorqueAccum += Frontier::Vehicle::Cross(p - Position, f); }
void VehicleChassisBody::ApplyTorque(const Vec3& t) noexcept { TorqueAccum += t; }

void VehicleChassisBody::Integrate(float dt) noexcept
{
    ForceAccum += Gravity*Mass;
    LastForce = ForceAccum;
    LastTorque = TorqueAccum;
    LinearVelocity += ForceAccum*(dt/Mass);
    if (LinearDamping > 0.0f) LinearVelocity = LinearVelocity*std::exp(-LinearDamping*dt);
    Position += LinearVelocity*dt;
    // 📝 Implicit midpoint Euler equations and their matching Cayley orientation increment.
    const Vec3 Initial = RotateUnit(Conjugate(), AngularVelocity);
    const Vec3 Moment = RotateUnit(Conjugate(), TorqueAccum);
    const double Inertia[3] = {1.0 / InvInertiaDiag.x, 1.0 / InvInertiaDiag.y, 1.0 / InvInertiaDiag.z};
    const double ω₀[3] = {Initial.x, Initial.y, Initial.z}, τ[3] = {Moment.x, Moment.y, Moment.z};
    double ω₁[3] = {ω₀[0], ω₀[1], ω₀[2]}, Midpoint[3]{};
    AngularConverged = false;
    for (uint32_t Iteration = 0u; Iteration < 24u; ++Iteration)
    {
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis) Midpoint[Axis] = 0.5 * (ω₀[Axis] + ω₁[Axis]);
        double Jacobian[3][4]{};
        double Scale = 1.0; AngularResidual = 0.0;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const uint32_t Next = (Axis + 1u) % 3u, Last = (Axis + 2u) % 3u;
            const double Difference = Inertia[Last] - Inertia[Next];
            const double Residual = Inertia[Axis] * (ω₁[Axis] - ω₀[Axis]) + dt * Difference * Midpoint[Next] * Midpoint[Last] - dt * τ[Axis];
            Jacobian[Axis][Axis] = Inertia[Axis]; Jacobian[Axis][Next] = 0.5 * dt * Difference * Midpoint[Last];
            Jacobian[Axis][Last] = 0.5 * dt * Difference * Midpoint[Next]; Jacobian[Axis][3] = -Residual;
            AngularResidual = std::max(AngularResidual, std::abs(Residual));
            Scale = std::max(Scale, std::abs(Inertia[Axis] * ω₀[Axis]) + std::abs(dt * τ[Axis]));
        }
        if (AngularResidual <= 1.0e-11 * Scale) { AngularConverged = true; break; }
        for (uint32_t Column = 0u; Column < 3u; ++Column)
        {
            uint32_t Pivot = Column;
            for (uint32_t Row = Column + 1u; Row < 3u; ++Row)
                if (std::abs(Jacobian[Row][Column]) > std::abs(Jacobian[Pivot][Column])) Pivot = Row;
            for (uint32_t Entry = Column; Entry < 4u; ++Entry) std::swap(Jacobian[Column][Entry], Jacobian[Pivot][Entry]);
            const double Diagonal = Jacobian[Column][Column];
            for (uint32_t Entry = Column; Entry < 4u; ++Entry) Jacobian[Column][Entry] /= Diagonal;
            for (uint32_t Row = 0u; Row < 3u; ++Row)
            {
                if (Row == Column) continue;
                const double Factor = Jacobian[Row][Column];
                for (uint32_t Entry = Column; Entry < 4u; ++Entry) Jacobian[Row][Entry] -= Factor * Jacobian[Column][Entry];
            }
        }
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis) ω₁[Axis] += Jacobian[Axis][3];
    }
    // 📝 Refuse non-convergence instead of presenting an iteration ceiling as a converged solution.
    assert(AngularConverged);
    const Quat Increment{static_cast<float>(0.5 * dt * Midpoint[0]), static_cast<float>(0.5 * dt * Midpoint[1]), static_cast<float>(0.5 * dt * Midpoint[2]), 1.0f};
    Orientation = (Orientation * Increment.Normalized()).Normalized();
    AngularVelocity = RotateUnit(Orientation, {static_cast<float>(ω₁[0]), static_cast<float>(ω₁[1]), static_cast<float>(ω₁[2])});
    if (AngularDamping > 0.0f) AngularVelocity = AngularVelocity * std::exp(-AngularDamping * dt);
    ForceAccum = Vec3{}; TorqueAccum = Vec3{};
}
float VehicleChassisBody::KineticEnergy() const noexcept
{
    const Vec3 Spin = RotateUnit(Conjugate(), AngularVelocity);
    const Vec3 Inertia{1.0f / InvInertiaDiag.x, 1.0f / InvInertiaDiag.y, 1.0f / InvInertiaDiag.z};
    return 0.5f * (Mass * Frontier::Vehicle::Dot(LinearVelocity, LinearVelocity)
         + Inertia.x * Spin.x * Spin.x + Inertia.y * Spin.y * Spin.y + Inertia.z * Spin.z * Spin.z);
}

void VehicleChassisBody::ResolveContacts(const std::vector<Vec3>& Locations,
                                         const Frontier::Vehicle::XPBDSoftTyre::GroundQuery& Ground,
                                         float Seconds) noexcept
{
    Contacts = {};
    if (!Ground || Locations.empty() || Seconds <= 0.0f || Mass <= 0.0f) return;
    ContactConstraints.assign(Locations.size(), ContactConstraint{});
    const float InverseMass = 1.0f / Mass;
    constexpr float Tolerance = 0.001f;
    constexpr float Friction = 0.45f;
    const auto ReadContact = [&](size_t Index, Vec3& Arm, Vec3& Normal, float& Separation)
    {
        Arm = Orientation.Rotate(Locations[Index]);
        const Vec3 Point = Position + Arm;
        Vec3 Surface;
        if (!Ground(Point, Surface, Normal)) return false;
        const float Length = Normal.Length();
        if (!std::isfinite(Length) || Length < 1.0e-6f) return false;
        Normal = Normal * (1.0f / Length);
        Separation = Frontier::Vehicle::Dot(Point - Surface, Normal);
        return std::isfinite(Separation);
    };
    const auto EffectiveInverseMass = [&](const Vec3& Arm, const Vec3& Direction)
    {
        const Vec3 AngularGradient = Frontier::Vehicle::Cross(Arm, Direction);
        return InverseMass + Frontier::Vehicle::Dot(AngularGradient, WorldAngularAccel(AngularGradient));
    };
    // 📝 XPBD unilateral position projection; split correction is not converted into a fictitious rebound velocity.
    for (uint32_t Sweep = 0u; Sweep < 6u; ++Sweep)
        for (size_t Index = 0u; Index < Locations.size(); ++Index)
        {
            Vec3 Arm, Normal;
            float Separation;
            if (!ReadContact(Index, Arm, Normal, Separation)) continue;
            if (Sweep == 0u) Contacts.ArrivalPenetration = std::max(Contacts.ArrivalPenetration, -Separation);
            auto& Constraint = ContactConstraints[Index];
            const float Previous = Constraint.PositionMultiplier;
            const float InverseEffective = EffectiveInverseMass(Arm, Normal);
            Constraint.PositionMultiplier = std::max(0.0f, Previous - Separation / InverseEffective);
            const float Correction = Constraint.PositionMultiplier - Previous;
            if (std::abs(Correction) < 1.0e-8f) continue;
            Position += Normal * (Correction * InverseMass);
            const Vec3 Rotation = WorldAngularAccel(Frontier::Vehicle::Cross(Arm, Normal * Correction));
            const float Angle = Rotation.Length();
            if (Angle > 1.0e-8f)
                Orientation = QuatNormalize(QuatMul(Quat::AxisAngle(Rotation * (1.0f / Angle), Angle), Orientation));
        }
    Contacts.KineticBefore = KineticEnergy();
    // 📝 Accumulated unilateral impulses and a Coulomb disk, including rigid angular effective mass; restitution is zero.
    for (uint32_t Sweep = 0u; Sweep < 6u; ++Sweep)
        for (size_t Index = 0u; Index < Locations.size(); ++Index)
        {
            Vec3 Arm, Normal;
            float Separation;
            if (!ReadContact(Index, Arm, Normal, Separation) || Separation > Tolerance) continue;
            auto& Constraint = ContactConstraints[Index];
            const Vec3 Velocity = LinearVelocity + Frontier::Vehicle::Cross(AngularVelocity, Arm);
            const float Closing = Frontier::Vehicle::Dot(Velocity, Normal);
            const float Previous = Constraint.NormalImpulse;
            Constraint.NormalImpulse = std::max(0.0f, Previous - Closing / EffectiveInverseMass(Arm, Normal));
            const Vec3 NormalCorrection = Normal * (Constraint.NormalImpulse - Previous);
            LinearVelocity += NormalCorrection * InverseMass;
            AngularVelocity += WorldAngularAccel(Frontier::Vehicle::Cross(Arm, NormalCorrection));
            Contacts.Impulse += NormalCorrection;

            const Vec3 Remaining = LinearVelocity + Frontier::Vehicle::Cross(AngularVelocity, Arm);
            const Vec3 Tangent = Remaining - Normal * Frontier::Vehicle::Dot(Remaining, Normal);
            const float Speed = Tangent.Length();
            if (Speed <= 1.0e-6f) continue;
            const Vec3 Direction = Tangent * (1.0f / Speed);
            Vec3 Proposed = Constraint.TangentImpulse - Tangent * (1.0f / EffectiveInverseMass(Arm, Direction));
            const float Magnitude = Proposed.Length();
            const float Limit = Friction * Constraint.NormalImpulse;
            if (Magnitude > Limit) Proposed = Proposed * (Limit / Magnitude);
            const Vec3 TangentCorrection = Proposed - Constraint.TangentImpulse;
            Constraint.TangentImpulse = Proposed;
            LinearVelocity += TangentCorrection * InverseMass;
            AngularVelocity += WorldAngularAccel(Frontier::Vehicle::Cross(Arm, TangentCorrection));
            Contacts.Impulse += TangentCorrection;
        }
    Contacts.KineticAfter = KineticEnergy();
    for (size_t Index = 0u; Index < Locations.size(); ++Index)
    {
        Vec3 Arm, Normal;
        float Separation;
        if (!ReadContact(Index, Arm, Normal, Separation)) continue;
        Contacts.RemainingPenetration = std::max(Contacts.RemainingPenetration, -Separation);
        if (Separation <= Tolerance) ++Contacts.ContactCount;
    }
}

Frontier::Vehicle::ChassisState VehicleChassisBody::State() const noexcept
{ return {Position, Orientation, LinearVelocity, AngularVelocity}; }

//------------------------------------------------------------------------------------------------------------------------ construction
bool VehicleInstanceSequence::Construct(const Frontier::Vehicle::VehicleGeometry& Geometry,
                                        const VehicleInstanceConfiguration& Configuration,
                                        Frontier::Vehicle::XPBDSoftTyre::GroundQuery Ground) noexcept
{
    Built = false;
    Instancing = Configuration;
    ActiveConfiguration = Frontier::Vehicle::VehicleSolverConfiguration{};
    ActiveConfiguration.ActiveScheme = Frontier::Vehicle::DrivingScheme::PacejkaDrivetrain;
    Frontier::Vehicle::ApplyGeometry(ActiveConfiguration, Geometry);
    ActiveConfiguration.Aero.Enabled = true;

    SpawnPosition = Instancing.SpawnLocation;
    SpawnPosition.z = Instancing.SpawnHeight;
    SpawnOrientation = Instancing.SpawnRotation;
    Body = VehicleChassisBody{};
    Body.Position       = SpawnPosition;
    Body.Orientation    = SpawnOrientation;
    Body.Mass           = ActiveConfiguration.ChassisMass;
    Body.InvInertiaDiag = Geometry.InvInertia();
    CollisionLocations.clear();
    CollisionLocations.reserve(ControlVehicleMesh::kVertexCount);
    for (uint32_t Index = 0u; Index < ControlVehicleMesh::kVertexCount; ++Index)
        CollisionLocations.push_back({ControlVehicleMesh::kPositions[Index * 3u],
                                      ControlVehicleMesh::kPositions[Index * 3u + 1u],
                                      ControlVehicleMesh::kPositions[Index * 3u + 2u] - Geometry.CoMModelZ()});

    VehicleSolver::Hooks h;
    h.ReadChassis       = [this]{ return Body.State(); };
    h.ApplyForceAtPoint = [this](const Vec3& f, const Vec3& p){ Body.ApplyForceAtPoint(f, p); };
    h.ApplyTorque       = [this](const Vec3& t){ Body.ApplyTorque(t); };
    GroundSurface = Ground ? std::move(Ground) : Frontier::Vehicle::XPBDSoftTyre::GroundQuery([](const Vec3& p, Vec3& s, Vec3& n)
    {
        // The surface query, not a height: CourseSurface answers with the nearest point ON the course and
        //    its outward normal, so a kerb's vertical face can stop a tyre sideways instead of lifting it.
        float Sx, Sy, Sz, Nx, Ny, Nz;
        CourseSurface(p.x, p.y, p.z, Sx, Sy, Sz, Nx, Ny, Nz);
        s = Vec3{Sx, Sy, Sz};
        n = Vec3{Nx, Ny, Nz};
        return true;
    });
    h.Ground = GroundSurface;
    if (Instancing.FitTerrain)
    {
        const auto Settled = Frontier::Vehicle::ResolveVehicleSpawn(ActiveConfiguration, Body.State(), GroundSurface);
        if (Settled.Supported)
        {
            SpawnPosition = Settled.Pose.Position;
            SpawnOrientation = Settled.Pose.Orientation;
            Body.Position = SpawnPosition;
            Body.Orientation = SpawnOrientation;
        }
        else { std::fputs("[Drive] Spawn terrain is incomplete; deployment refused.\n", stderr); return false; }
    }
    ActiveVehicleSolver.Build(ActiveConfiguration, h, Body.State());

    WheelSpin.assign(Instancing.WheelCount, 0.0f);
    ChassisState_ = Body.State();
    Accumulator = 0.0f;
    RestCaptured = false;
    Built = true;
    return true;
}

void VehicleInstanceSequence::Reconfigure(const Frontier::Vehicle::VehicleSolverConfiguration& Edited) noexcept
{
    ActiveConfiguration = Edited;
    // Rebuild so a curve / geometry / tyre edit rebinds the soft tyres at the current chassis pose.
    VehicleSolver::Hooks h;
    h.ReadChassis       = [this]{ return Body.State(); };
    h.ApplyForceAtPoint = [this](const Vec3& f, const Vec3& p){ Body.ApplyForceAtPoint(f, p); };
    h.ApplyTorque       = [this](const Vec3& t){ Body.ApplyTorque(t); };
    h.Ground = GroundSurface;
    ActiveVehicleSolver.Build(ActiveConfiguration, h, Body.State());
}

void VehicleInstanceSequence::ResetToSpawn() noexcept
{
    Accumulator          = 0.0f;
    Body.Position        = SpawnPosition;
    Body.Orientation     = SpawnOrientation;
    Body.LinearVelocity  = Vec3{};
    Body.AngularVelocity = Vec3{};
    Body.ForceAccum      = Vec3{};
    Body.TorqueAccum     = Vec3{};
    std::fill(WheelSpin.begin(), WheelSpin.end(), 0.0f);
    Reconfigure(ActiveConfiguration);          // rebinds the tyres at the spawn pose using the current config
    ChassisState_ = Body.State();
}

//------------------------------------------------------------------------------------------------------------------------ per-frame advance
void VehicleInstanceSequence::AdvanceVehicle(const Frontier::Vehicle::DriverInput& Input,
                                             std::vector<InstanceRecord>& Rows, float DeltaSeconds) noexcept
{
    if (!Built) return;

    ActiveVehicleSolver.AssignInput(Input);
    Accumulator += std::min(std::max(DeltaSeconds, 0.0f), Instancing.MaxFrameSeconds);
    const float h = Instancing.SubStepSeconds;
    const auto& tel = ActiveVehicleSolver.Telemetry();
    while (Accumulator >= h)
    {
        ActiveVehicleSolver.Step(h);   // reads chassis, steps tyres, applies wheel forces
        Body.Integrate(h);
        const Vec3 BeforePosition = Body.Position;
        const Quat BeforeRotation = Body.Orientation;
        Body.ResolveContacts(CollisionLocations, GroundSurface, h);
        if (Body.Contacts.ArrivalPenetration > 0.0f) ActiveVehicleSolver.CorrectAttachments(BeforePosition, BeforeRotation, Body.Position, Body.Orientation);
        for (uint32_t w = 0; w < Instancing.WheelCount && w < tel.Wheels.size(); ++w)
            WheelSpin[w] += tel.Wheels[w].WheelOmega * h;   // visual spin only
        Accumulator -= h;
    }
    ChassisState_ = Body.State();

    WriteBodyRow(Rows);
    WriteWheelRows(Rows);
}

//------------------------------------------------------------------------------------------------------------------------ matrix write
void VehicleInstanceSequence::ComposeTRS(const Vec3& T, const Quat& R, float Out[16]) noexcept
{
    const Vec3 cx = R.Rotate(Vec3{1,0,0});
    const Vec3 cy = R.Rotate(Vec3{0,1,0});
    const Vec3 cz = R.Rotate(Vec3{0,0,1});
    Out[0]=cx.x;  Out[1]=cx.y;  Out[2]=cx.z;  Out[3]=0.0f;   // column 0 (local X → world)
    Out[4]=cy.x;  Out[5]=cy.y;  Out[6]=cy.z;  Out[7]=0.0f;   // column 1 (local Y → world)
    Out[8]=cz.x;  Out[9]=cz.y;  Out[10]=cz.z; Out[11]=0.0f;  // column 2 (local Z → world)
    Out[12]=T.x;  Out[13]=T.y;  Out[14]=T.z;  Out[15]=1.0f;  // column 3 (translation)
}

void VehicleInstanceSequence::WriteBodyRow(std::vector<InstanceRecord>& Rows) noexcept
{
    if (Instancing.BodyInstance >= Rows.size()) return;
    InstanceRecord& R = Rows[Instancing.BodyInstance];
    std::copy(std::begin(R.World), std::end(R.World), std::begin(R.PreviousWorld));  // roll for motion vectors
    ComposeTRS(Body.Position, Body.Orientation, R.World);
}

void VehicleInstanceSequence::WriteWheelRows(std::vector<InstanceRecord>& Rows) noexcept
{
    const auto& tel = ActiveVehicleSolver.Telemetry();
    for (uint32_t w = 0; w < Instancing.WheelCount; ++w)
    {
        const uint32_t idx = Instancing.FirstWheel + w;
        if (idx >= Rows.size() || w >= tel.Wheels.size()) break;
        const auto& wt = tel.Wheels[w];

        // wheel = chassis · steer(about local Z) · spin(about local axle Y)   — axle authored along local Y
        const auto& Tyre = ActiveVehicleSolver.Tyres()[w];
        const Quat rot = Tyre.MaterialFrame();

        InstanceRecord& R = Rows[idx];
        std::copy(std::begin(R.World), std::end(R.World), std::begin(R.PreviousWorld));
        ComposeTRS(Tyre.HubPosition(), rot, R.World);
    }
}

//------------------------------------------------------------------------------------------------------------------------ flat-triangle refit (mirrors PhysicsInstanceSequence::RefreshBodyFacets)
void VehicleInstanceSequence::RefreshBodyFacets(std::vector<TriangleIndex>& Facets,
                                                const std::vector<InstanceRecord>& Instances) noexcept
{
    const uint32_t bodyCount = 1u + Instancing.WheelCount;

    if (!RestCaptured)
    {
        FacetFirst.assign(bodyCount, 0u);
        FacetCount.assign(bodyCount, 0u);
        RestFacets.clear();
        auto capture = [&](uint32_t slot, uint32_t instance)
        {
            if (instance >= Instances.size()) return;
            const InstanceRecord& I = Instances[instance];
            FacetFirst[slot] = I.FlatTriangleOffset;
            FacetCount[slot] = I.TriangleCount;
            for (uint32_t t = 0; t < I.TriangleCount; ++t)
            {
                const uint32_t f = I.FlatTriangleOffset + t;
                if (f < Facets.size()) RestFacets.push_back(Facets[f]);   // baked object-local at rest
            }
        };
        capture(0u, Instancing.BodyInstance);
        for (uint32_t w = 0; w < Instancing.WheelCount; ++w) capture(1u + w, Instancing.FirstWheel + w);
        RestCaptured = true;
    }

    // Re-transform each body/wheel's captured local triangles by its current World and overwrite the flat list.
    auto retransform = [&](uint32_t slot, uint32_t instance)
    {
        if (instance >= Instances.size()) return;
        const float* M = Instances[instance].World;
        uint32_t src = 0;
        for (uint32_t s = 0; s < slot; ++s) src += FacetCount[s];
        for (uint32_t t = 0; t < FacetCount[slot]; ++t)
        {
            const uint32_t f = FacetFirst[slot] + t;
            if (f >= Facets.size() || (src + t) >= RestFacets.size()) break;
            const TriangleIndex& r = RestFacets[src + t];
            TriangleIndex out = r;
            auto xf = [&](float x, float y, float z, float& ox, float& oy, float& oz)
            {
                ox = M[0]*x + M[4]*y + M[8]*z  + M[12];
                oy = M[1]*x + M[5]*y + M[9]*z  + M[13];
                oz = M[2]*x + M[6]*y + M[10]*z + M[14];
            };
            xf(r.VertexAlphaX, r.VertexAlphaY, r.VertexAlphaZ, out.VertexAlphaX, out.VertexAlphaY, out.VertexAlphaZ);
            xf(r.VertexBetaX,  r.VertexBetaY,  r.VertexBetaZ,  out.VertexBetaX,  out.VertexBetaY,  out.VertexBetaZ);
            xf(r.VertexGammaX, r.VertexGammaY, r.VertexGammaZ, out.VertexGammaX, out.VertexGammaY, out.VertexGammaZ);
            Facets[f] = out;
        }
    };
    retransform(0u, Instancing.BodyInstance);
    for (uint32_t w = 0; w < Instancing.WheelCount; ++w) retransform(1u + w, Instancing.FirstWheel + w);
}

} // namespace Drive
} // namespace Frontier
