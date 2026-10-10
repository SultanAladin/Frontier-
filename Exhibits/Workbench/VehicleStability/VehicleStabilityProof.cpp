//============================================================================================================================================
// Exhibits/Workbench/VehicleStability/VehicleStabilityProof.cpp — headless curb-strike, spin, and energy audit
//============================================================================================================================================
//
//    Drives the REAL VehicleSolver (soft XPBD tyres, Pacejka slip, drivetrain, struts, anti-roll bars) with the REAL
//    ApplyGeometry() configuration from VehicleGeometry.cpp, on a mock rigid-box chassis (same integrator as
//    VehicleDrivingChecks.cpp). The chassis is a box, not Jolt, so this proves the tyre and solver layers only.
//
//    Scenarios:
//      CURB   — coast (throttle 0, brake 0, steer 0) into a 0.12 m curb line at 5/10/15/20 m/s and at 0° / 20° to the
//               curb. Records roll, pitch, wheel lift, pinning, and the energy budget.
//      SPIN   — full throttle with steer input at 12 m/s in an open flat arena until the car yaws, then coast.
//
//    ENERGY AUDIT (what is tracked, per step, all in joules):
//      E_chassis   = ½·m·v² + ½·Σ Iᵢ·ωᵢ² (body frame) + m·g·z_CoM
//      E_wheels    = Σ ½·Iw·ω_wheelᵢ²   (solver wheel spin, telemetry)  +  ½·Ie·ω_engine²  (engine rotor, telemetry)
//      E_tyreKE    = Σ node ½·m·v²     (XPBD carcass kinetic energy, read-only accessor)
//      E_tyreSpr   = Σ ½·C²/α          (XPBD stored edge-spring energy, read-only accessor)
//      E_total     = sum of the four.
//    Dissipation (mock angular damping, XPBD damping, Pacejka slip, brakes) only LOWERS E_total. Energy is INPUT only
//    through the driver (throttle/brake) and the engine; the coast runs have neither, so for them E_total(t) must never
//    exceed E_total(0). The spin run is bounded by E_total(0) + P_engine_max·t, where P_engine_max is the peak of
//    TorqueCurve·rpm·2π/60 (the crank-side power that can reach the wheels). Anything above those bounds is artificial.
//
//    NOT IN THE AUDIT: gas-pressure (PV) work inside the carcass (the gas volume is private and only drives internal
//    forces), and the Jolt ground's own response (ground here is an analytic static heightfield, so it does no work
//    beyond the contact constraint, which the tyre's node-energy accounting already sees).
//
//    Build & run (from this directory):
//        g++ -std=c++17 -O2 VehicleStabilityProof.cpp ../../../Engine/PhysicalDynamics/Vehicle/VehicleSolver.cpp ...  (see list below)
//
//============================================================================================================================================

#include "VehicleSolver.h"
#include "VehicleGeometry.h"

#include <cmath>
#include <cstdio>
#include <memory>
#include <string>

using namespace Frontier::Vehicle;

//------------------------------------------------------------------------------------------------------------------------
//                       MOCK RIGID BOX  (same integrator as VehicleDrivingChecks.cpp, plus no hidden energy sources)
//------------------------------------------------------------------------------------------------------------------------
struct MockChassis
{
    Vec3  Position{0, 0, 1.0f};
    Quat  Orientation{0, 0, 0, 1};
    Vec3  LinearVelocity{};
    Vec3  AngularVelocity{};
    float Mass = 1200.0f;
    Vec3  InvInertiaDiag{};
    Vec3  Gravity{0, 0, -9.81f};
    float AngularDamping = 0.05f;   // mock dissipation: only ever removes energy
    Vec3  ForceAccum{};
    Vec3  TorqueAccum{};

    [[nodiscard]] Quat Conjugate() const noexcept { return {-Orientation.x, -Orientation.y, -Orientation.z, Orientation.w}; }
    [[nodiscard]] Vec3 WorldAngularAccel(const Vec3& t) const noexcept
    {
        const Vec3 tb = Conjugate().Rotate(t);
        const Vec3 ab{tb.x * InvInertiaDiag.x, tb.y * InvInertiaDiag.y, tb.z * InvInertiaDiag.z};
        return Orientation.Rotate(ab);
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
        ForceAccum = {0, 0, 0}; TorqueAccum = {0, 0, 0};
    }
    [[nodiscard]] ChassisState State() const noexcept { return {Position, Orientation, LinearVelocity, AngularVelocity}; }
};

//------------------------------------------------------------------------------------------------------------------------
//                                              GROUND
//------------------------------------------------------------------------------------------------------------------------
static XPBDSoftTyre::GroundQuery Flat()
{
    return [](const Vec3& p, Vec3& s, Vec3& n) { s = {p.x, p.y, 0.0f}; n = {0, 0, 1}; return true; };
}

// A curb: a raised strip 0.10 m wide, 0.12 m high, lying across the road along the direction (cos θ, sin θ) and
// placed at (x0,0). u is the coordinate across the curb. 0.02 m linear ramps on both faces keep the heightfield
// continuous so the tyre sees a steep but finite face, as a real curb edge would present.
static XPBDSoftTyre::GroundQuery Curb(std::shared_ptr<double> x0Shared, float thetaRad, float height = 0.12f,
                                      float width = 0.10f, float ramp = 0.02f)
{
    const float c = std::cos(thetaRad), s = std::sin(thetaRad);
    return [=](const Vec3& p, Vec3& surf, Vec3& n)
    {
        const float x0 = float(*x0Shared);
        const float u = (p.x - x0) * c + p.y * s;               // signed distance across the curb
        float h = 0.0f, dhdu = 0.0f;
        if (u >= 0.0f && u <= width)                      { h = height; }
        else if (u < 0.0f && u > -ramp)                   { h = height * (1.0f + u / ramp); dhdu = height / ramp; }
        else if (u > width && u < width + ramp)           { h = height * (1.0f - (u - width) / ramp); dhdu = -height / ramp; }
        surf = {p.x, p.y, h};
        n = Vec3{-dhdu * c, -dhdu * s, 1.0f}.Normalized();
        return true;
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                             RIG & AUDIT
//------------------------------------------------------------------------------------------------------------------------
static VehicleSolverConfiguration MakeConfig(uint32_t tyreSweeps = 1u)
{
    VehicleSolverConfiguration c;
    c.ActiveScheme = DrivingScheme::PacejkaDrivetrain;
    ApplyGeometry(c, VehicleGeometry{});       // the production geometry used by the engine
    c.Aero.Enabled = false;                     // aero is a separate axis; keep the audit to tyres + mechanics
    c.Tyre.SolverIterations = tyreSweeps;       // Gauss-Seidel sweeps per XPBD substep (solver default = 1)
    return c;
}

// Peak crank power the drivetrain can deliver: max over TorqueCurve of torque·ω, with ω = rpm·2π/60 [W].
static double PeakEnginePower(const VehicleSolverConfiguration& c)
{
    double p = 0.0;
    for (std::size_t i = 0; i < c.Engine.TorqueCurve.X.size(); ++i)
    {
        const double w = c.Engine.TorqueCurve.X[i] * 2.0 * M_PI / 60.0;
        p = std::max(p, double(c.Engine.TorqueCurve.Y[i]) * w);
    }
    return p;
}

struct Rig
{
    MockChassis chassis;
    VehicleSolver solver;
    VehicleSolverConfiguration cfg;
    double dt = 1.0 / 240.0;

    void Build(const VehicleSolverConfiguration& c, XPBDSoftTyre::GroundQuery g, const Vec3& spawn)
    {
        cfg = c;
        chassis = MockChassis{};
        chassis.Position = spawn;
        chassis.Mass = c.ChassisMass;
        chassis.InvInertiaDiag = VehicleGeometry{}.InvInertia();
        VehicleSolver::Hooks h;
        h.ReadChassis       = [this] { return chassis.State(); };
        h.ApplyForceAtPoint = [this](const Vec3& f, const Vec3& p) { chassis.ApplyForceAtPoint(f, p); };
        h.ApplyTorque       = [this](const Vec3& t) { chassis.ApplyTorque(t); };
        h.Ground            = std::move(g);
        solver.Build(c, h, chassis.State());
    }

    void Step(const DriverInput& in)
    {
        solver.AssignInput(in);
        solver.Step(float(dt));
        chassis.Integrate(float(dt));
    }
};

struct Energy { double chassis = 0, wheels = 0, tyreKE = 0, tyreSpring = 0; double Total() const { return chassis + wheels + tyreKE + tyreSpring; } };

static Energy MeasureEnergy(const Rig& r)
{
    Energy e;
    const MockChassis& ch = r.chassis;
    const Vec3 v = ch.LinearVelocity;
    const Vec3 wb = ch.Conjugate().Rotate(ch.AngularVelocity);     // body-frame angular velocity
    const Vec3 I{1.0f / ch.InvInertiaDiag.x, 1.0f / ch.InvInertiaDiag.y, 1.0f / ch.InvInertiaDiag.z};
    e.chassis = 0.5 * ch.Mass * v.LengthSq()
              + 0.5 * (double(I.x) * wb.x * wb.x + double(I.y) * wb.y * wb.y + double(I.z) * wb.z * wb.z)
              + double(ch.Mass) * 9.81 * ch.Position.z;

    const VehicleTelemetry& t = r.solver.Telemetry();
    const double Iw = r.cfg.WheelInertia;
    for (uint32_t i = 0; i < t.WheelCount; ++i) e.wheels += 0.5 * Iw * double(t.Wheels[i].WheelOmega) * t.Wheels[i].WheelOmega;
    const double we = double(t.EngineRPM) * 2.0 * M_PI / 60.0;
    e.wheels += 0.5 * double(r.cfg.Engine.EngineInertia) * we * we;

    for (const XPBDSoftTyre& ty : r.solver.Tyres())
    {
        e.tyreKE     += ty.NodeKineticEnergy();
        e.tyreSpring += ty.StoredEdgeEnergy();
    }
    return e;
}

//------------------------------------------------------------------------------------------------------------------------
//                                         RUN RECORDING
//------------------------------------------------------------------------------------------------------------------------
struct Frame
{
    double t, x, y, z, vx, vy, vz, roll, pitch, yaw, yawRate, speed;
    double eChassis, eWheels, eTyreKE, eTyreSpring, eTotal, ePeakBound;
    int    wheelsInContact;
    double contact[4][3];
    double wheelLoad[4];
    double resConstraint;   // max over tyres of the sidewall/tread/lateral/diagonal residual [m] (solver's own report)
    double resContact;      // max over tyres of the deepest remaining ground penetration [m]
};

struct RunSummary
{
    std::string name;
    double maxAbsRollDeg = 0, maxAbsPitchDeg = 0, maxYawRate = 0, maxSpeed = 0;
    int    liftFrames = 0;              // frames with at least one wheel off the ground
    int    frames = 0;
    double maxEnergyGainJ = -1e300;     // max over t of E(t) − E(0) − (bound term) for coast; see report
    double maxEnergyExcessJ = -1e300;   // max over t of E(t) − E(0) − P_peak·t (spin bound)
    double eStart = 0, eEnd = 0, eTyreKEmax = 0, eTyreSprMax = 0;
    bool   finite = true;
    bool   tipped = false;              // |roll| > 45° or |pitch| > 45°
    bool   pinned = false;              // forward speed collapsed to < 20 % of entry speed while throttle was off
    bool   diverged = false;            // |v| > 100 m/s or |ω| > 50 rad/s
    double yawRateAtEnd = 0;
    double pinTimeS = -1;
};

static void RecordFrame(Rig& r, double t, Frame& f)
{
    const MockChassis& ch = r.chassis;
    const Vec3 fwd  = ch.Orientation.Rotate({1, 0, 0});
    const Vec3 left = ch.Orientation.Rotate({0, 1, 0});
    const Energy e = MeasureEnergy(r);
    f.t = t;
    f.x = ch.Position.x; f.y = ch.Position.y; f.z = ch.Position.z;
    f.vx = ch.LinearVelocity.x; f.vy = ch.LinearVelocity.y; f.vz = ch.LinearVelocity.z;
    f.roll  = std::asin(std::fmax(-1.0f, std::fmin(1.0f, left.z))) * 180.0 / M_PI;
    f.pitch = std::asin(std::fmax(-1.0f, std::fmin(1.0f, fwd.z)))  * 180.0 / M_PI;
    f.yaw   = std::atan2(fwd.y, fwd.x) * 180.0 / M_PI;
    f.yawRate = ch.AngularVelocity.z * 180.0 / M_PI;
    f.speed = ch.LinearVelocity.Length();
    f.eChassis = e.chassis; f.eWheels = e.wheels; f.eTyreKE = e.tyreKE; f.eTyreSpring = e.tyreSpring; f.eTotal = e.Total();
    const VehicleTelemetry& tel = r.solver.Telemetry();
    f.wheelsInContact = int(tel.WheelsInContact);
    for (int i = 0; i < 4; ++i)
    {
        f.contact[i][0] = tel.Wheels[i].ContactPoint.x;
        f.contact[i][1] = tel.Wheels[i].ContactPoint.y;
        f.contact[i][2] = tel.Wheels[i].ContactPoint.z;
        f.wheelLoad[i]  = tel.Wheels[i].VerticalLoad;
    }
    f.resConstraint = 0.0; f.resContact = 0.0;
    for (const XPBDSoftTyre& ty : r.solver.Tyres())
    {
        const SoftTyreResidual& q = ty.Residual();
        f.resConstraint = std::max(f.resConstraint, double(std::max({q.SpokeMax, q.ShearMax, q.HoopMax, q.LateralMax, q.DiagonalMax})));
        f.resContact    = std::max(f.resContact, double(q.ContactMax));
    }
}

static void WriteCsv(const std::string& path, const std::vector<Frame>& frames)
{
    FILE* fp = std::fopen(path.c_str(), "w");
    if (!fp) { std::fprintf(stderr, "cannot write %s\n", path.c_str()); return; }
    std::fprintf(fp, "t,x,y,z,vx,vy,vz,roll_deg,pitch_deg,yaw_deg,yaw_rate_dps,speed,E_chassis,E_wheels,E_tyre_KE,E_tyre_spring,E_total,"
                     "P_peak_bound_J,wheels_in_contact,c0x,c0y,c0z,c1x,c1y,c1z,c2x,c2y,c2z,c3x,c3y,c3z,load0,load1,load2,load3,"
                     "residual_constraint_m,residual_contact_m\n");
    for (const Frame& f : frames)
    {
        std::fprintf(fp, "%.5f,%.5f,%.5f,%.5f,%.5f,%.5f,%.5f,%.4f,%.4f,%.4f,%.3f,%.4f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%d",
                     f.t, f.x, f.y, f.z, f.vx, f.vy, f.vz, f.roll, f.pitch, f.yaw, f.yawRate, f.speed,
                     f.eChassis, f.eWheels, f.eTyreKE, f.eTyreSpring, f.eTotal, f.ePeakBound, f.wheelsInContact);
        for (int i = 0; i < 4; ++i) std::fprintf(fp, ",%.4f,%.4f,%.4f", f.contact[i][0], f.contact[i][1], f.contact[i][2]);
        for (int i = 0; i < 4; ++i) std::fprintf(fp, ",%.2f", f.wheelLoad[i]);
        std::fprintf(fp, ",%.6f,%.6f\n", f.resConstraint, f.resContact);
    }
    std::fclose(fp);
}

// Finalises the per-run summary from the recorded frames.
static void Summarise(RunSummary& s, const std::vector<Frame>& frames, double entrySpeed, bool coasting)
{
    s.frames = int(frames.size());
    if (frames.empty()) return;
    s.eStart = frames.front().eTotal;
    s.eEnd = frames.back().eTotal;
    s.yawRateAtEnd = frames.back().yawRate;
    for (const Frame& f : frames)
    {
        if (!std::isfinite(f.eTotal) || !std::isfinite(f.x) || !std::isfinite(f.roll)) s.finite = false;
        s.maxAbsRollDeg  = std::max(s.maxAbsRollDeg,  std::fabs(f.roll));
        s.maxAbsPitchDeg = std::max(s.maxAbsPitchDeg, std::fabs(f.pitch));
        s.maxYawRate     = std::max(s.maxYawRate, std::fabs(f.yawRate));
        s.maxSpeed       = std::max(s.maxSpeed, f.speed);
        if (f.wheelsInContact < 4) ++s.liftFrames;
        if (f.speed > 100.0 || std::fabs(f.yawRate) > 50.0 * 180.0 / M_PI) s.diverged = true;
        s.maxEnergyGainJ    = std::max(s.maxEnergyGainJ, f.eTotal - s.eStart);
        s.maxEnergyExcessJ  = std::max(s.maxEnergyExcessJ, f.eTotal - f.ePeakBound);
        s.eTyreKEmax  = std::max(s.eTyreKEmax, f.eTyreKE);
        s.eTyreSprMax = std::max(s.eTyreSprMax, f.eTyreSpring);
    }
    s.tipped = s.maxAbsRollDeg > 45.0 || s.maxAbsPitchDeg > 45.0;
    if (coasting)
    {
        for (const Frame& f : frames)
            if (f.speed < 0.2 * entrySpeed && f.t > 0.5 && s.pinTimeS < 0) { s.pinned = true; s.pinTimeS = f.t; }
    }
}

// Rolling start: full throttle from rest until the target speed, then throttle off. Every wheel spins up through the
// tyre-ground contact here, so the scenario that follows starts with rolling wheels, not locked ones. (Setting the
// chassis velocity directly leaves WheelSpin at zero, which locks the tyres and creates a false braking force.)
static double RollUp(Rig& r, double targetSpeed, double maxTime)
{
    double t = 0.0;
    DriverInput in{};
    in.Throttle = 1.0f;
    while (t < maxTime && r.chassis.LinearVelocity.Length() < targetSpeed)
    {
        r.Step(in);
        t += r.dt;
    }
    r.Step(DriverInput{});
    return t;
}

//------------------------------------------------------------------------------------------------------------------------
//                                         SCENARIO: CURB STRIKE
//------------------------------------------------------------------------------------------------------------------------
static RunSummary RunCurb(const std::string& outDir, double speed, double angleDeg, uint32_t sweeps = 1u, const char* tag = "")
{
    const double kRunTime = 5.0;
    const VehicleSolverConfiguration cfg = MakeConfig(sweeps);
    const double theta = angleDeg * M_PI / 180.0;
    auto curbX = std::make_shared<double>(1.0e6);                 // no curb until the rolling start is complete
    Rig r;
    r.Build(cfg, Curb(curbX, theta), {0, 0, 1.0f});
    for (int i = 0; i < int(1.5 / r.dt); ++i) r.Step(DriverInput{});   // settle the carcass on the ground
    RollUp(r, speed, 30.0);
    *curbX = r.chassis.Position.x + 6.0;                           // curb 6 m ahead of the rolling car

    std::vector<Frame> frames;
    const double eStart = MeasureEnergy(r).Total();
    const int nRun = int(kRunTime / r.dt);
    for (int i = 0; i <= nRun; ++i)
    {
        Frame f{};
        RecordFrame(r, i * r.dt, f);
        f.ePeakBound = eStart;                // coast: no input energy allowed, bound is E at window start
        frames.push_back(f);
        r.Step(DriverInput{});
    }

    RunSummary s;
    char nm[96]; std::snprintf(nm, sizeof nm, "curb_%02.0fms_%02.0fdeg%s", speed, angleDeg, tag);
    s.name = nm;
    Summarise(s, frames, frames.front().speed, true);
    WriteCsv(outDir + "/" + s.name + ".csv", frames);
    return s;
}

//------------------------------------------------------------------------------------------------------------------------
//                                         SCENARIO: SPIN IN ARENA
//------------------------------------------------------------------------------------------------------------------------
static RunSummary RunSpin(const std::string& outDir)
{
    const double kSettle = 1.5, kPower = 4.0, kCoast = 6.0, kEntry = 12.0;
    const VehicleSolverConfiguration cfg = MakeConfig();
    Rig r;
    r.Build(cfg, Flat(), {0, 0, 1.0f});
    const DriverInput idle{};
    for (int i = 0; i < int(kSettle / r.dt); ++i) r.Step(idle);
    RollUp(r, kEntry, 30.0);                       // rolling start at 12 m/s, wheels spun up by the drive

    const double pPeak = PeakEnginePower(cfg);
    std::vector<Frame> frames;
    const double eStart = MeasureEnergy(r).Total();
    const int nPower = int(kPower / r.dt), nCoast = int(kCoast / r.dt);
    double tNow = 0.0;
    for (int i = 0; i <= nPower + nCoast; ++i)
    {
        Frame f{};
        RecordFrame(r, tNow, f);
        f.ePeakBound = eStart + pPeak * tNow;   // engine can add at most its peak crank power
        frames.push_back(f);
        DriverInput in{};
        if (i < nPower)
        {
            // Throttle with a steering step to provoke power oversteer; hold lock for 1 s, then ease off.
            in.Throttle = 1.0f;
            in.Steer = (i < int(1.0 / r.dt)) ? 0.8f : 0.4f;
        }
        else
        {
            in.Throttle = 0.0f; in.Steer = 0.0f;     // coast out of the spin
        }
        r.Step(in);
        tNow += r.dt;
    }
    RunSummary s;
    s.name = "spin_12ms_arena";
    Summarise(s, frames, frames.front().speed, false);
    WriteCsv(outDir + "/" + s.name + ".csv", frames);
    return s;
}

//------------------------------------------------------------------------------------------------------------------------
//                                   SCENARIO: SPIN-OUT WITH NO DRIVER INPUT
//------------------------------------------------------------------------------------------------------------------------
// The car is rolled up to speed, the throttle is released, and it is given a yaw rate (a spin started by a kick, not by
// the driver). Nothing adds energy after that, so E_total(t) must never rise above its value at the kick.
static RunSummary RunSpinCoast(const std::string& outDir, double speed, double yawRateRadS, uint32_t sweeps = 1u, const char* tag = "")
{
    const VehicleSolverConfiguration cfg = MakeConfig(sweeps);
    Rig r;
    r.Build(cfg, Flat(), {0, 0, 1.0f});
    for (int i = 0; i < int(1.5 / r.dt); ++i) r.Step(DriverInput{});
    RollUp(r, speed, 30.0);
    r.chassis.AngularVelocity = Vec3{0.0f, 0.0f, float(yawRateRadS)};   // the kick

    std::vector<Frame> frames;
    const double eStart = MeasureEnergy(r).Total();
    const int nRun = int(8.0 / r.dt);
    for (int i = 0; i <= nRun; ++i)
    {
        Frame f{};
        RecordFrame(r, i * r.dt, f);
        f.ePeakBound = eStart;
        frames.push_back(f);
        r.Step(DriverInput{});
    }
    RunSummary s;
    char nm[96]; std::snprintf(nm, sizeof nm, "spincoast_%02.0fms_%03.0fdps%s", speed, yawRateRadS * 180.0 / M_PI, tag);
    s.name = nm;
    Summarise(s, frames, frames.front().speed, false);
    WriteCsv(outDir + "/" + s.name + ".csv", frames);
    return s;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                MAIN
//------------------------------------------------------------------------------------------------------------------------
static void PrintSummaries(const std::vector<RunSummary>& sums)
{
    std::printf("\n%-30s %8s %8s %8s %8s %6s %7s %7s %11s %11s %8s %8s\n", "run", "rollMax", "pitchMax", "yawMax", "speedMax",
                "liftF", "tipped", "pinned", "dE_max[J]", "excess[J]", "finite", "diverge");
    for (const RunSummary& s : sums)
        std::printf("%-30s %8.2f %8.2f %8.1f %8.2f %6d %7s %7s %11.1f %11.1f %8s %8s\n", s.name.c_str(), s.maxAbsRollDeg,
                    s.maxAbsPitchDeg, s.maxYawRate, s.maxSpeed, s.liftFrames, s.tipped ? "YES" : "no",
                    s.pinned ? "YES" : "no", s.maxEnergyGainJ, s.maxEnergyExcessJ, s.finite ? "yes" : "NO",
                    s.diverged ? "YES" : "no");
}

int main(int argc, char** argv)
{
    const std::string outDir = (argc > 1) ? argv[1] : ".";
    const std::string mode   = (argc > 2) ? argv[2] : "full";
    const VehicleSolverConfiguration cfg = MakeConfig();
    std::printf("config: mass %.0f kg, CoM height %.3f m, tyre radius %.3f m, peak crank power bound %.1f kW, tyre sweeps %u\n",
                cfg.ChassisMass, cfg.Aero.ComHeightAboveFloor_m, cfg.Tyre.Radius, PeakEnginePower(cfg) / 1000.0,
                cfg.Tyre.SolverIterations);

    if (mode == "sweep")
    {
        // Same curb strike, changing only the number of XPBD Gauss-Seidel sweeps per substep. If the energy spike
        // is a convergence artefact, it must shrink as the sweeps rise.
        std::vector<RunSummary> sums;
        for (uint32_t sw : {1u, 4u, 16u})
        {
            char tag[32]; std::snprintf(tag, sizeof tag, "_sweeps%u", sw);
            sums.push_back(RunCurb(outDir, 10.0, 0.0, sw, tag));
        }
        for (uint32_t sw : {4u, 16u})
        {
            char tag[32]; std::snprintf(tag, sizeof tag, "_sweeps%u", sw);
            sums.push_back(RunSpinCoast(outDir, 12.0, 1.0, sw, tag));
        }
        PrintSummaries(sums);
        return 0;
    }

    std::vector<RunSummary> sums;
    const double speeds[] = {5.0, 10.0, 15.0, 20.0};
    const double angles[] = {0.0, 20.0};
    for (double a : angles)
        for (double v : speeds) sums.push_back(RunCurb(outDir, v, a));
    sums.push_back(RunSpin(outDir));
    sums.push_back(RunSpinCoast(outDir, 12.0, 1.0));
    sums.push_back(RunSpinCoast(outDir, 20.0, 1.5));
    PrintSummaries(sums);

    std::printf("\nenergy: E_total(0) per run and tyre energy maxima\n");
    for (const RunSummary& s : sums)
        std::printf("%-30s E0=%.1f J  Eend=%.1f J  tyreKEmax=%.2f J  tyreSprMax=%.2f J  yawRateEnd=%.2f dps\n", s.name.c_str(),
                    s.eStart, s.eEnd, s.eTyreKEmax, s.eTyreSprMax, s.yawRateAtEnd);
    return 0;
}
