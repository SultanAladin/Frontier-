//============================================================================================================================================
//                                                          DRIVETUMBLEPROOF.CPP
//============================================================================================================================================
// 📦 Signed torque-free rigid invariants, actual mass partition and native solved-rim publication checks.

#include "DriveDynamicsFixture.h"

#include <fstream>
#include <iomanip>

using namespace Frontier::Vehicle;

namespace
{

Vec3 AngularMomentum(const Frontier::Drive::VehicleChassisBody& Body)
{
    const Vec3 Local = Body.Conjugate().Rotate(Body.AngularVelocity);
    return Body.Orientation.Rotate({Local.x / Body.InvInertiaDiag.x, Local.y / Body.InvInertiaDiag.y, Local.z / Body.InvInertiaDiag.z});
}

} // namespace

int main(int Count, char** Arguments)
{
    const std::filesystem::path Folder = Count > 1 ? Arguments[1] : "_AgentScratch/tmp/DriveRigidProof";
    std::filesystem::create_directories(Folder);
    VehicleGeometry Geometry; VehicleSolverConfiguration Configuration;
    ApplyGeometry(Configuration, Geometry);
    assert(std::abs(Configuration.ChassisMass + 4.0 * Configuration.UnsprungMass - Geometry.Mass) < 0.0001);
    assert(std::abs(Configuration.ChassisMass - 1220.0f) < 0.0001f);
    double WorstEnergy = 0.0, WorstMomentum = 0.0;
    uint32_t Directions = 0u;
    for (int X = -1; X <= 1; ++X)
        for (int Y = -1; Y <= 1; ++Y)
            for (int Z = -1; Z <= 1; ++Z)
            {
                if (X == 0 && Y == 0 && Z == 0) continue;
                Frontier::Drive::VehicleChassisBody Body;
                Body.Mass = Configuration.ChassisMass; Body.InvInertiaDiag = Configuration.InvChassisInertia;
                Body.Gravity = {}; Body.AngularDamping = 0.0f; Body.LinearDamping = 0.0f;
                Body.Orientation = Quat::AxisAngle(Vec3{1, 2, 3}.Normalized(), 0.73f);
                Body.AngularVelocity = Vec3{static_cast<float>(X), static_cast<float>(Y), static_cast<float>(Z)}.Normalized() * 16.0f;
                const double InitialEnergy = Body.KineticEnergy(); const Vec3 InitialMomentum = AngularMomentum(Body);
                for (uint32_t Tick = 0u; Tick < 1440u; ++Tick)
                {
                    Body.Integrate(DriveProof::StepSeconds); assert(Body.AngularConverged);
                    WorstEnergy = std::max(WorstEnergy, std::abs(Body.KineticEnergy() - InitialEnergy) / InitialEnergy);
                    WorstMomentum = std::max(WorstMomentum, static_cast<double>((AngularMomentum(Body) - InitialMomentum).Length()) / InitialMomentum.Length());
                }
                ++Directions;
            }
    assert(Directions == 26u && WorstEnergy < 0.00005 && WorstMomentum < 0.00005);
    Frontier::Drive::VehicleInstanceSequence Native;
    Frontier::Drive::VehicleInstanceConfiguration Placement;
    Placement.SpawnHeight = 60.0f; Placement.FitTerrain = false;
    assert(Native.Construct(Geometry, Placement, [](const Vec3&, Vec3&, Vec3&) { return false; }));
    std::vector<Frontier::InstanceRecord> Rows(5u);
    DriverInput Input; Input.Throttle = 0.3f; Input.Steer = 0.4f;
    double WorstRim = 0.0;
    for (uint32_t Tick = 0u; Tick < 96u; ++Tick)
    {
        Native.AdvanceVehicle(Input, Rows, DriveProof::StepSeconds);
        for (size_t Corner = 0u; Corner < Native.Tyres().size(); ++Corner)
        {
            const auto& Tyre = Native.Tyres()[Corner]; const auto& Row = Rows[Corner + 1u];
            const Vec3 Origin{Row.World[12], Row.World[13], Row.World[14]};
            WorstRim = std::max(WorstRim, static_cast<double>((Origin - Tyre.HubPosition()).Length()));
            for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
            {
                const Vec3 Local = Axis == 0u ? Vec3{1, 0, 0} : Axis == 1u ? Vec3{0, 1, 0} : Vec3{0, 0, 1};
                const Vec3 Expected = Tyre.MaterialFrame().Rotate(Local), Actual{Row.World[Axis * 4u], Row.World[Axis * 4u + 1u], Row.World[Axis * 4u + 2u]};
                WorstRim = std::max(WorstRim, static_cast<double>((Expected - Actual).Length()));
            }
        }
    }
    assert(WorstRim < 0.00001);
    std::ofstream Proof(Folder / "RigidResults.json");
    Proof << std::setprecision(12) << "{\"passed\":true,\"cpuOnly\":true,\"directions\":26,\"secondsPerDirection\":6,\"relativeEnergyError\":" << WorstEnergy
          << ",\"relativeMomentumError\":" << WorstMomentum << ",\"nativeTicks\":96,\"rimPoseError\":" << WorstRim << "}\n";
    std::printf("PASS 26 signed 6 s rigid directions: energy %.9g momentum %.9g; native 96-tick rim error %.9g\n", WorstEnergy, WorstMomentum, WorstRim);
}
