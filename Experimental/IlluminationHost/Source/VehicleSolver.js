//============================================================================================================================================
//                                                             VEHICLESOLVER.JS
//============================================================================================================================================
// 🧩 ControlVehicle rigid-body dynamics: socket struts, transient-slip MF6.1 tyres, GT-R powertrain, brakes, aero, contact.

// 📝 The chassis, sockets, strut calibration, tyre sheet, torque curve, ratios, brake and steering limits are the
//    Project-Drive ControlVehicle's own (VehicleGeometry.h, SuspensionSpecification.h, PacejkaMagicFormula.h,
//    Drivetrain.cpp, VehicleSolver.h). What differs from Frontier is the contact: Frontier's tyre is an XPBD soft-body
//    lattice; here each corner casts its strut axis onto DriveCourse's CourseHeight() and resolves a point contact.
//    The transient slip states follow TyreSlipDynamics' relaxation-length form, integrated implicitly so the step
//    is stable at speed, and the low-speed tread damping of VehicleSolverConfiguration keeps standstill quiet.

import { TyreSlipSolver } from "./TyreSlipSolver.js";
import { ConstructThermal, IntegrateThermal, ForceIgnition, ResolveTreadFraction, ThermalSpecification, AbrasionSpecification } from "./TyreThermalIntegrator.js";
import { VehicleGeometry, ResolveSuspensionPair, ResolveSuspensionMountLocal, ResolveInertia, AntiRollBars,
         EngineSheet, TurbochargerSheet, TransmissionSheet, ChassisSheet } from "./VehicleSpecification.js";
import { ResolveCourseHeight, ResolveCourseNormal } from "./CourseStructure.js";
import { AddVector, SubtractVector, ScaleVector, CrossVector, DotVector, NormalizeVector, LengthVector, MultiplyAddVector,
         RotateVector, ConjugateQuaternion, MultiplyQuaternion, ConstructAxisQuaternion, IntegrateQuaternion,
         ConstructRigidTransform, ClampScalar } from "./TransformProjection.js";

const SubstepSeconds  = 1.0 / 480.0;   // [s]   fixed integration step
const MaximumSubsteps = 32;            // [-]   per advance, so a stalled tab does not spiral
const Gravity         = 9.81;          // [m/s²]
const RadiansToRpm    = 60.0 / (2.0 * Math.PI);
const CarcassStiffness = 220000.0;      // [N/m]   radial tyre stiffness in series with the strut past bump travel
const CarcassDamping   = 900.0;         // [N·s/m] carcass damping
const LoadLimit      = 24000.0;       // [N]     largest load handed to MF6.1, beyond its fitted range
const ReverseSpeedLimit = 9.0;          // [m/s]
const FrictionLimit    = 1.35;          // [-]     combined tyre force over normal load
const OverturnSeconds  = 3.0;           // [s]     upside down this long and the vehicle respawns

// 📝 Exhaust tips, CoM-local [m]: under the rear bumper (IdPlateSecondary sits at x −2.99), either side of centre.
//    ControlVehicle.blend carries no exhaust socket, so these are placed, not read.
const ExhaustOutlets = [[-3.02, 0.52, -0.17], [-3.02, -0.52, -0.17]];
const AfterfireLiftSeconds  = 0.55;   // [s]   pop window after lifting off from high rpm
const AfterfireShiftSeconds = 0.16;   // [s]   pop window on a powered upshift
const AfterfireRpm          = 4200.0; // [rpm] lifting below this does not pop

// 📝 Line lock — the burnout aid of a drag car: the front calipers are held at LineLockTorque while the rear brakes
//    stay released, so throttle spins the driven rears against a car that cannot roll. The AMT holds its gear while
//    the lock is on and the engine bounces off the limiter, as a burnout is driven.
const LineLockTorque   = 3600.0;   // [N·m] per front wheel — beyond the pedal's 2600, a held hydraulic lock

// 📝 The soft tyre in the dynamics: a carcass spring in series with the strut, its stiffness the sidewalls' plus the
//    air column's, K = K₀ + κ·p — about 223 kN/m at 220 kPa (an 18 mm static deflection under the corner's 3.2 kN),
//    25 kN/m with no air. The tyre's deflection lowers its corner and shortens its rolling radius; past the pinch the
//    rim flange presses the road through the rubber. A flat rolled far enough comes apart and the wheel runs on its rim.
const TyreSidewallStiffness = 25000.0;     // [N/m]
const TyreAirStiffness      = 0.9;         // [N/m/Pa]
const TyrePinchClearance    = 0.022;       // [m]   rubber between flange and road at the pinch
const TyreReferencePressure = 220000.0;    // [Pa]
const ShredDistance         = 150.0;       // [m]   rolled on a flat before the rubber comes off the rim
const ShredPressure         = 25000.0;     // [Pa]
const RimRadiusMargin       = 0.012;       // [m]   what is left of a shredded tyre on the rim
const ScrapeSpeed           = 2.0;         // [m/s] sliding contact faster than this throws sparks
const RimStiffness          = 1.5e6;       // [N/m] a rim flange on the road through what rubber is left

// 📝 Burnout hold, an exhibit assist: with 49 / 51 front / rear static load, a locked front axle cannot quite hold the
//    spinning rears and the car creeps away at up to 20 km/h. While the lock is on, a planar force at the centre of
//    mass opposes the creep, proportional to speed and capped, so the burnout stays in its box. Off in the editor,
//    the car rolls as the tyre model says it would.
const BurnoutHoldRate         = 6.0;   // [1/s]
const BurnoutHoldAcceleration = 3.5;   // [m/s²]

// 📝 Collision hull of the body, CoM-local spheres [x, y, z, radius]: a lower ring along the sills and an upper cabin.
const HullSpheres = [
    [ 2.70,  0.85, 0.12, 0.32], [ 2.70, -0.85, 0.12, 0.32], [ 1.35,  0.90, 0.12, 0.32], [ 1.35, -0.90, 0.12, 0.32],
    [ 0.00,  0.90, 0.12, 0.32], [ 0.00, -0.90, 0.12, 0.32], [-1.35,  0.90, 0.12, 0.32], [-1.35, -0.90, 0.12, 0.32],
    [-2.70,  0.85, 0.18, 0.32], [-2.70, -0.85, 0.18, 0.32], [ 1.10,  0.55, 0.70, 0.42], [ 1.10, -0.55, 0.70, 0.42],
    [-0.40,  0.55, 0.80, 0.45], [-0.40, -0.55, 0.80, 0.45], [-1.80,  0.00, 0.62, 0.42]
];

function SampleCurve(Curve, Abscissa)
{
    if (Abscissa <= Curve[0][0])
        return Curve[0][1];
    for (let Index = 1; Index < Curve.length; ++Index)
    {
        if (Abscissa <= Curve[Index][0])
        {
            const [X0, Y0] = Curve[Index - 1];
            const [X1, Y1] = Curve[Index];
            return Y0 + (Y1 - Y0) * (Abscissa - X0) / (X1 - X0);
        }
    }
    return Curve[Curve.length - 1][1];
}

export class VehicleSolver
{
    constructor(Obstacles)
    {
        this.Tyres       = new TyreSlipSolver();
        const Pair       = ResolveSuspensionPair();
        this.Struts      = [Pair.Front, Pair.Front, Pair.Rear, Pair.Rear];
        this.StaticLength = 0.6436 - 0.0914;
        this.InertiaBody = ResolveInertia();
        this.Obstacles   = Obstacles;
        this.Accumulator = 0.0;
        this.ThermalOptions = { HeatGain: 1.0, ExposureSeconds: 4.0, IgnitionEnabled: true, IgnitionTemperature: 723.15,
                                WearEnabled: true, WearScale: 1.0 };
        this.ThermalGrip    = false;
        this.BurnoutHold    = true;
        this.Respawn();
    }

    Respawn(Position = [0.0, 0.0, VehicleGeometry.CoMHeight + 0.02], Yaw = 0.0)
    {
        this.Position        = Position.slice();
        this.Orientation     = ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw);
        this.LinearVelocity  = [0.0, 0.0, 0.0];
        this.AngularVelocity = [0.0, 0.0, 0.0];
        this.Wheels = [0, 1, 2, 3].map((Wheel) => ({
            Mount:       ResolveSuspensionMountLocal(Wheel),
            Steered:     Wheel < 2,
            Driven:      Wheel >= 2,
            Length:      this.StaticLength,
            Compression: this.Struts[Wheel].FreeLength - this.StaticLength,
            Deflection:  0.0,
            Spin:        0.0,
            SpinAngle:   0.0,
            SlipRatio:   0.0,
            SlipAngle:   0.0,
            Load:        0.0,
            Contact:     false,
            Steer:       0.0,
            Skid:        0.0,
            SlidingPower:    0.0,
            SlidingEnergy:   0.0,
            SlipSpeed:       0.0,
            ContactPoint:    [0.0, 0.0, 0.0],
            ContactVelocity: [0.0, 0.0, 0.0],
            Longitudinal:    [1.0, 0.0, 0.0],
            Radius:          VehicleGeometry.TyreRadius,
            TyreDeflection:  0.016,
            Pinched:         false,
            Shredded:        false,
            ShredDistance:   0.0,
            HubPosition:     [0.0, 0.0, 0.0],
            HubDistance:     Infinity,
            GroundNormal:    [0.0, 0.0, 1.0],
            LateralForce:    0.0
        }));
        // 📝 Tyre heat resets with the car: a respawned vehicle does not carry a burning tyre with it.
        this.ColdPressure     = this.ColdPressure || [TyreReferencePressure, TyreReferencePressure, TyreReferencePressure, TyreReferencePressure];
        this.Thermals         = [0, 1, 2, 3].map((Wheel) => ConstructThermal(undefined, this.ColdPressure[Wheel]));
        this.AfterfireSeconds = 0.0;
        this.LineLock         = false;
        this.Impacts          = [];
        this.BurstEvents      = [];
        this.ShredEvents      = [];
        this.Scrapes          = new Map();
        this.PriorThrottle    = 0.0;
        this.PriorGear        = TransmissionSheet.FirstIndex;
        this.ThermalSeconds   = 0.0;
        this.SteerAngle   = 0.0;
        this.GearIndex    = TransmissionSheet.FirstIndex;
        this.EngineRPM    = EngineSheet.IdleRPM;
        this.Boost        = 0.0;
        this.ShiftTimer   = 0.0;
        this.ReverseTimer = 0.0;
        this.Throttle     = 0.0;
        this.Accumulator  = 0.0;
    }

    Advance(Command, Seconds)
    {
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), SubstepSeconds * MaximumSubsteps);
        let Stepped = 0.0;
        while (this.Accumulator >= SubstepSeconds)
        {
            this.Step(Command, SubstepSeconds);
            this.Accumulator -= SubstepSeconds;
            Stepped += SubstepSeconds;
        }
        this.IntegrateConditions(Stepped);
    }

    // 📝 VehicleSolver::IntegrateConditions(): each tyre's heat advances once per advance from the sliding work its
    //    contact patch dissipated over the substeps, averaged into a power. Afterfire windows open on a lift-off from
    //    high rpm and on a powered upshift — unburnt mixture lighting in a hot exhaust, the pops of a drift car.
    IntegrateConditions(Seconds)
    {
        if (Seconds <= 0.0)
            return;
        this.Wheels.forEach((Wheel, Index) =>
        {
            const Power = Wheel.SlidingEnergy / Seconds;
            Wheel.SlidingPower = Power;
            Wheel.SlidingEnergy = 0.0;
            IntegrateThermal(this.Thermals[Index], { SlidingPower: Power, Airspeed: LengthVector(Wheel.ContactVelocity), InContact: Wheel.Contact },
                             Seconds, this.ThermalOptions);
            // 📝 A tread worn through lets go: the blowout empties the tyre, the carcass sags with it, and the host is told
            //    once. A flat rolled far enough sheds its rubber and the wheel runs on the rim.
            const Thermal = this.Thermals[Index];
            if (Thermal.BurstPending)
            {
                Thermal.BurstPending = false;
                this.BurstEvents.push(Index);
            }
            const RollingSpeed = Math.abs(Wheel.Spin) * Wheel.Radius;
            if (!Wheel.Shredded && Wheel.Contact && Thermal.GaugePressure < ShredPressure)
            {
                Wheel.ShredDistance += RollingSpeed * Seconds;
                if (Wheel.ShredDistance > ShredDistance)
                {
                    Wheel.Shredded = true;
                    Wheel.Radius = VehicleGeometry.TyreRimRadius + RimRadiusMargin;
                    Wheel.TyreDeflection = 0.0;
                    this.ShredEvents.push(Index);
                }
            }
            // 📝 A rim on the road — pinched through a flat, or bare once shredded — throws sparks while it moves.
            const Grinding = Math.max(RollingSpeed, LengthVector(Wheel.ContactVelocity));
            if (Wheel.Contact && (Wheel.Pinched || Wheel.Shredded) && Grinding > 1.5)
                this.RecordScrape(`rim${Index}`, Wheel.ContactPoint, Wheel.ContactVelocity, Math.min(1.6, (Wheel.Shredded ? 0.05 : 0.03) * Grinding), Index);
        });
        this.AfterfireSeconds = Math.max(0.0, this.AfterfireSeconds - Seconds);
        if (this.PriorThrottle > 0.55 && this.Throttle < 0.15 && this.EngineRPM > AfterfireRpm)
            this.AfterfireSeconds = AfterfireLiftSeconds;
        if (this.GearIndex > this.PriorGear && this.PriorGear >= TransmissionSheet.FirstIndex && this.Throttle > 0.8 && this.EngineRPM > 5200.0)
            this.AfterfireSeconds = Math.max(this.AfterfireSeconds, AfterfireShiftSeconds);
        this.PriorThrottle = this.Throttle;
        this.PriorGear = this.GearIndex;
        this.ThermalSeconds += Seconds;
    }

    // 🔍 Panel action: rear treads past ignition, exposure met.
    IgniteRearTyres()
    {
        ForceIgnition(this.Thermals[2], this.ThermalOptions.IgnitionTemperature);
        ForceIgnition(this.Thermals[3], this.ThermalOptions.IgnitionTemperature);
    }

    // 📝 Fresh, cold tyres on every corner at the set cold pressures — a burst or shredded wheel gets its tyre back.
    CoolTyres()
    {
        this.Thermals = [0, 1, 2, 3].map((Wheel) => ConstructThermal(undefined, this.ColdPressure[Wheel]));
        for (const Wheel of this.Wheels)
            Object.assign(Wheel, { Radius: VehicleGeometry.TyreRadius, TyreDeflection: 0.016, Pinched: false, Shredded: false, ShredDistance: 0.0 });
    }

    // 📝 A nail (a slow leak) or a blowout in one tyre.
    PunctureTyre(Index, Blowout = false)
    {
        const Thermal = this.Thermals[Index];
        Thermal.LeakRate = Blowout ? AbrasionSpecification.BlowoutRate : AbrasionSpecification.PunctureRate;
        if (Blowout)
            this.BurstEvents.push(Index);
    }

    // 📝 The tyre bay: sets the cold pressures [Pa gauge] per axle and pumps every intact tyre to them now, at its
    //    present gas temperature, sealing any leak. A shredded tyre needs fresh tyres.
    InflateTyres(Front, Rear)
    {
        this.ColdPressure = [Front, Front, Rear, Rear];
        this.Thermals.forEach((Thermal, Index) =>
        {
            if (this.Wheels[Index].Shredded)
                return;
            Thermal.LeakRate = 0.0;
            Thermal.AirMass = (this.ColdPressure[Index] + ThermalSpecification.AtmosphericPressure) * ThermalSpecification.EnclosedVolume
                            / (ThermalSpecification.AirSpecificGasConstant * Thermal.GasTemperature);
        });
    }

    // 📝 Keeps the strongest scrape per contact per frame: Key names the contact (a hull sphere, a rim).
    RecordScrape(Key, Point, Velocity, Strength, Wheel = -1)
    {
        const Prior = this.Scrapes.get(Key);
        if (!Prior || Prior.Strength < Strength)
            this.Scrapes.set(Key, { Point: Point.slice(), Velocity: Velocity.slice(), Strength, Wheel });
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  DRIVETRAIN
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 GT-R curve × first-order turbo boost × throttle, through an AMT that slips toward LaunchRPM until the wheels
    //    can carry the engine, auto-shifting at 6800 / 2600 rpm with a 0.35 s dwell and a short torque cut per shift.
    ResolveDriveTorque(Throttle, ForwardSpeed, Δτ)
    {
        const Ratio = TransmissionSheet.GearRatios[this.GearIndex] * TransmissionSheet.FinalDriveRatio;
        const DrivenSpin = 0.5 * (this.Wheels[2].Spin + this.Wheels[3].Spin);
        const WheelRPM = Math.abs(DrivenSpin * Ratio) * RadiansToRpm;
        const Launch = EngineSheet.IdleRPM + (TransmissionSheet.LaunchRPM - EngineSheet.IdleRPM) * Throttle;
        this.EngineRPM = Math.max(WheelRPM, Throttle > 0.02 ? Launch : EngineSheet.IdleRPM);
        // 📝 Below idle with the pedal up the AMT clutch is open: the engine idles and drives nothing.
        if (Throttle <= 0.02 && WheelRPM < EngineSheet.IdleRPM * 1.2)
        {
            this.ShiftTimer = Math.max(0.0, this.ShiftTimer - Δτ);
            this.Boost += (0.0 - this.Boost) * Math.min(1.0, Δτ / TurbochargerSheet.SpoolTimeConstant);
            return 0.0;
        }
        const BoostTarget = Throttle * TurbochargerSheet.WastegateMaxBoost * ClampScalar((this.EngineRPM - 1500.0) / 2500.0, 0.0, 1.0);
        this.Boost += (BoostTarget - this.Boost) * Math.min(1.0, Δτ / TurbochargerSheet.SpoolTimeConstant);
        const BoostMultiplier = SampleCurve(TurbochargerSheet.TorqueMultiplierCurve, this.Boost);
        const ω = this.EngineRPM / RadiansToRpm;
        let Torque = SampleCurve(EngineSheet.TorqueCurve, this.EngineRPM) * BoostMultiplier * Throttle;
        Torque -= (EngineSheet.EngineBrakingCoeff * ω + EngineSheet.EngineBrakingQuadratic * ω * ω * (1.0 - Throttle));
        if (this.EngineRPM >= EngineSheet.RedlineRPM)
            Torque = Math.min(Torque, 0.0);
        if (WheelRPM < Launch && Throttle > 0.02)
            Torque = Math.min(Math.max(Torque, 0.0), TransmissionSheet.ClutchCapacity);
        this.ShiftTimer = Math.max(0.0, this.ShiftTimer - Δτ);
        if (this.ShiftTimer > TransmissionSheet.ShiftCooldownSeconds - 0.12)
            Torque = Math.min(Torque, 0.0);
        if (this.GearIndex >= TransmissionSheet.FirstIndex && this.ShiftTimer <= 0.0)
        {
            const Top = TransmissionSheet.GearRatios.length - 1;
            if (WheelRPM > TransmissionSheet.UpshiftRPM && this.GearIndex < Top && !this.LineLock)
            {
                this.GearIndex++;
                this.ShiftTimer = TransmissionSheet.ShiftCooldownSeconds;
            }
            else if (WheelRPM < TransmissionSheet.DownshiftRPM && this.GearIndex > TransmissionSheet.FirstIndex && ForwardSpeed > 2.0)
            {
                this.GearIndex--;
                this.ShiftTimer = TransmissionSheet.ShiftCooldownSeconds;
            }
        }
        return Torque * Ratio * TransmissionSheet.DriveEfficiency;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 INTEGRATION
    //--------------------------------------------------------------------------------------------------------------------

    Step(Command, Δτ)
    {
        const Orientation = this.Orientation;
        const Forward = RotateVector(Orientation, [1.0, 0.0, 0.0]);
        const Upward  = RotateVector(Orientation, [0.0, 0.0, 1.0]);
        const ForwardSpeed = DotVector(this.LinearVelocity, Forward);
        const Speed = LengthVector(this.LinearVelocity);

        // ① pedals, with S as reverse once the car has stopped and W as the brake while reversing
        let Throttle = Command.Throttle, Brake = Command.Brake;
        const Reversing = this.GearIndex === TransmissionSheet.ReverseIndex;
        if (!Reversing && Command.Brake > 0.5 && Command.Throttle < 0.05 && Math.abs(ForwardSpeed) < 0.6)
        {
            this.ReverseTimer += Δτ;
            if (this.ReverseTimer > 0.25)
                this.GearIndex = TransmissionSheet.ReverseIndex;
        }
        else if (Reversing && Command.Throttle > 0.5 && Math.abs(ForwardSpeed) < 0.6)
        {
            this.GearIndex = TransmissionSheet.FirstIndex;
            this.ReverseTimer = 0.0;
        }
        else if (Command.Brake < 0.1)
        {
            this.ReverseTimer = 0.0;
        }
        if (this.GearIndex === TransmissionSheet.ReverseIndex)
        {
            Throttle = Command.Brake * 0.6 * ClampScalar((ReverseSpeedLimit + ForwardSpeed) / 3.0, 0.0, 1.0);
            Brake = Command.Throttle;
        }
        this.Throttle = Throttle;
        this.LineLock = !!Command.LineLock && this.GearIndex !== TransmissionSheet.ReverseIndex;

        // ② steering: first-order toward the command, the lock eased with speed for keyboard driving, Ackermann split
        const Lock = ChassisSheet.MaxSteerAngleRad / (1.0 + Math.max(0.0, Speed - 8.0) / 22.0);
        this.SteerAngle += (Command.Steer * Lock - this.SteerAngle) * Math.min(1.0, ChassisSheet.SteerRatePerSecond * Δτ);
        const Wheelbase = 3.396, Track = 2.095;
        const Tangent = Math.tan(this.SteerAngle);
        const InnerOuter = (Sign) => Math.atan(Wheelbase * Tangent / (Wheelbase - Sign * 0.5 * Track * Tangent));
        this.Wheels[0].Steer = Math.abs(Tangent) > 1.0e-5 ? InnerOuter(1.0) : 0.0;
        this.Wheels[1].Steer = Math.abs(Tangent) > 1.0e-5 ? InnerOuter(-1.0) : 0.0;

        const DriveTorque = this.ResolveDriveTorque(Throttle, ForwardSpeed, Δτ);
        const Differential = 40.0 * (this.Wheels[2].Spin - this.Wheels[3].Spin);
        const DriveSplit = [0.0, 0.0,
                            0.5 * DriveTorque - ClampScalar(Differential, -0.25 * Math.abs(DriveTorque) - 20.0, 0.25 * Math.abs(DriveTorque) + 20.0),
                            0.5 * DriveTorque + ClampScalar(Differential, -0.25 * Math.abs(DriveTorque) - 20.0, 0.25 * Math.abs(DriveTorque) + 20.0)];

        let Force  = [0.0, 0.0, -VehicleGeometry.Mass * Gravity];
        let Torque = [0.0, 0.0, 0.0];
        const ApplyForce = (Applied, Point) =>
        {
            Force = AddVector(Force, Applied);
            Torque = AddVector(Torque, CrossVector(SubtractVector(Point, this.Position), Applied));
        };

        // ③ struts: cast each strut axis onto the course, spring + damper + bump stop
        const Axis = ScaleVector(Upward, -1.0);
        const Strut = [];
        for (let Index = 0; Index < 4; ++Index)
        {
            const Wheel = this.Wheels[Index];
            const Specification = this.Struts[Index];
            const Mount = AddVector(this.Position, RotateVector(Orientation, Wheel.Mount));
            const MaximumLength = this.StaticLength + Specification.DroopTravel;
            let Length = MaximumLength, Contact = false, Normal = [0.0, 0.0, 1.0];
            if (Axis[2] < -0.25)
            {
                let Travel = (Mount[2] - ResolveCourseHeight(Mount[0], Mount[1])) / -Axis[2];
                for (let Iteration = 0; Iteration < 3; ++Iteration)
                {
                    const Footing = MultiplyAddVector(Mount, Axis, Travel);
                    Travel = (Mount[2] - ResolveCourseHeight(Footing[0], Footing[1])) / -Axis[2];
                }
                const Ground = MultiplyAddVector(Mount, Axis, Travel);
                Normal = ResolveCourseNormal(Ground[0], Ground[1]);
                // 📝 The carcass is a circle, not a point: the effective ground is the highest course point under the
                //    tyre's profile across ±0.24 m of footprint and ±0.15 m of tread, so a kerb face or the ramp lip
                //    is met by the tyre's leading arc rather than as a step under the hub.
                const Heading = RotateVector(MultiplyQuaternion(Orientation, ConstructAxisQuaternion([0.0, 0.0, 1.0], Wheel.Steer)), [1.0, 0.0, 0.0]);
                const Planar = NormalizeVector([Heading[0], Heading[1], 0.0]);
                const Across = [-Planar[1], Planar[0]];
                let Highest = -Infinity;
                for (let Along = -2; Along <= 2; ++Along)
                {
                    const Offset = Along * 0.12;
                    const Drop = Wheel.Radius - Math.sqrt(Math.max(0.0, Wheel.Radius ** 2 - Offset * Offset));
                    for (let Side = -1; Side <= 1; ++Side)
                    {
                        const Height = ResolveCourseHeight(Ground[0] + Planar[0] * Offset + Across[0] * Side * 0.15,
                                                           Ground[1] + Planar[1] * Offset + Across[1] * Side * 0.15);
                        Highest = Math.max(Highest, Height - Drop);
                    }
                }
                const Lift = Math.max(0.0, Highest - Ground[2]) / -Axis[2];
                // 📝 The strut and the carcass in series. TouchLength is the strut length at which the uncompressed tyre
                //    just meets the road; a longer strut squeezes the tyre by the difference. The length where the
                //    strut's force equals the tyre's is found by bisection; a strut that tops out first leaves the corner
                //    carried by whatever the squeezed tyre pushes — so a flat corner sinks until its deflated tyre holds it,
                //    and past the pinch the rim flange stiffens the stack.
                const Projection = Math.max(Normal[2], 0.3) * -Axis[2];
                const TouchLength = Travel - Lift - Wheel.Radius / Projection;
                if (TouchLength < MaximumLength)
                {
                    Contact = true;
                    const Pressure = this.Thermals[Index].GaugePressure;
                    const Stiffness = Wheel.Shredded ? RimStiffness : TyreSidewallStiffness + TyreAirStiffness * Pressure;
                    const Pinch = Wheel.Radius - VehicleGeometry.TyreRimRadius - TyrePinchClearance;
                    const BumpLength = this.StaticLength - Specification.BumpTravel;
                    const TyreForce = (Candidate) =>
                    {
                        const Squeeze = Math.max(0.0, (Candidate - TouchLength) * Projection);
                        return Stiffness * Squeeze + (Wheel.Shredded ? 0.0 : RimStiffness * Math.max(0.0, Squeeze - Pinch));
                    };
                    const StrutForce = (Candidate) =>
                    {
                        const Compressed = Specification.FreeLength - Math.max(Candidate, BumpLength);
                        return (Compressed > 0.0 ? Specification.Preload + Specification.SpringForce(Compressed) : 0.0)
                             + CarcassStiffness * Math.max(0.0, BumpLength - Candidate);
                    };
                    let Low = this.StaticLength - Specification.BumpTravel - 0.12, High = MaximumLength;
                    if (StrutForce(High) >= TyreForce(High))
                    {
                        Length = High;
                        Wheel.ToppedOut = true;
                    }
                    else
                    {
                        for (let Halving = 0; Halving < 14; ++Halving)
                        {
                            const Middle = 0.5 * (Low + High);
                            if (StrutForce(Middle) > TyreForce(Middle))
                                Low = Middle;
                            else
                                High = Middle;
                        }
                        Length = 0.5 * (Low + High);
                        Wheel.ToppedOut = false;
                    }
                    Wheel.TyreForce = TyreForce(Length);
                    Wheel.TyreDeflection = Math.max(0.0, (Length - TouchLength) * Projection);
                    Wheel.Pinched = !Wheel.Shredded && Wheel.TyreDeflection > Pinch;
                }
            }
            if (!Contact)
            {
                Wheel.TyreDeflection = 0.0;
                Wheel.Pinched = false;
                Wheel.ToppedOut = false;
            }
            // 📝 Past the strut's bump travel the remaining closure is carried by the tyre carcass in series — the
            //    compliance Frontier's soft tyre lattice supplies — rather than by an ideal stop.
            const BumpLength = this.StaticLength - Specification.BumpTravel;
            const Deflection = Math.max(0.0, BumpLength - Length);
            const StrutLength = Math.max(Length, BumpLength);
            const Compression = Specification.FreeLength - StrutLength;
            const Rate = ClampScalar((Compression - Wheel.Compression) / Δτ, -4.0, 4.0);
            const DeflectionRate = ClampScalar((Deflection - Wheel.Deflection) / Δτ, -3.0, 3.0);
            Wheel.Compression = Compression;
            Wheel.Deflection = Deflection;
            Wheel.Length = StrutLength;
            Wheel.Contact = Contact;
            let Load = 0.0;
            if (Contact && Wheel.ToppedOut)
                Load = Wheel.TyreForce;
            else if (Contact)
            {
                Load = (Compression > 0.0 ? Specification.Preload + Specification.SpringForce(Compression) : 0.0)
                     + Specification.DampingRate * Rate;
                if (Deflection > 0.0)
                    Load = Math.max(Load, 0.0) + CarcassStiffness * Deflection + CarcassDamping * DeflectionRate;
            }
            Strut.push({ Mount, Load, Rate, Normal });
        }
        for (const Bar of [AntiRollBars.Front, AntiRollBars.Rear])
        {
            const Left = this.Wheels[Bar.LeftWheel], Right = this.Wheels[Bar.RightWheel];
            if (!Left.Contact || !Right.Contact)
                continue;
            const Coupling = Bar.Stiffness * (Left.Compression - Right.Compression)
                           + Bar.Damping * (Strut[Bar.LeftWheel].Rate - Strut[Bar.RightWheel].Rate);
            Strut[Bar.LeftWheel].Load += Coupling;
            Strut[Bar.RightWheel].Load -= Coupling;
        }

        // ④ tyres: transient slip into MF6.1, low-speed tread damping, wheel spin against drive and brake torque
        const AeroSquared = ForwardSpeed * ForwardSpeed;
        const Downforce = 0.5 * ChassisSheet.AirDensity * ChassisSheet.LiftArea * AeroSquared;
        for (let Index = 0; Index < 4; ++Index)
        {
            const Wheel = this.Wheels[Index];
            const Hub = MultiplyAddVector(Strut[Index].Mount, Axis, Wheel.Length);
            Wheel.Load = Math.max(0.0, Strut[Index].Load);
            if (Wheel.Load > 0.0)
                ApplyForce(ScaleVector(Upward, Wheel.Load), Hub);
            const Pressure = this.Thermals[Index].GaugePressure;
            Wheel.HubPosition = Hub;
            Wheel.GroundNormal = Strut[Index].Normal;
            Wheel.HubDistance = Wheel.Contact ? Hub[2] - ResolveCourseHeight(Hub[0], Hub[1]) : Infinity;

            const Inertia = ChassisSheet.WheelInertia;
            let BrakeTorque = Brake * ChassisSheet.MaxBrakeTorquePerWheel;
            if (this.LineLock)
                BrakeTorque = Wheel.Steered ? Math.max(BrakeTorque, LineLockTorque) : 0.0;
            if (Command.Handbrake && !Wheel.Steered && !this.LineLock)
                BrakeTorque += ChassisSheet.HandbrakeTorque;
            let SpinTorque = DriveSplit[Index];
            Wheel.Skid = 0.0;
            Wheel.SlipSpeed = 0.0;

            if (Wheel.Contact && Wheel.Load > 0.0)
            {
                const Normal = Strut[Index].Normal;
                const Heading = RotateVector(MultiplyQuaternion(Orientation, ConstructAxisQuaternion([0.0, 0.0, 1.0], Wheel.Steer)), [1.0, 0.0, 0.0]);
                const Longitudinal = NormalizeVector(SubtractVector(Heading, ScaleVector(Normal, DotVector(Heading, Normal))));
                const Lateral = CrossVector(Normal, Longitudinal);
                const Contact = MultiplyAddVector(Hub, Normal, -(Wheel.Radius - Wheel.TyreDeflection));
                const Velocity = AddVector(this.LinearVelocity, CrossVector(this.AngularVelocity, SubtractVector(Contact, this.Position)));
                const Vx = DotVector(Velocity, Longitudinal);
                const Vy = DotVector(Velocity, Lateral);
                const RollingRadius = Wheel.Radius - Wheel.TyreDeflection / 3.0 - 0.012;
                const SlipSpeed = Vx - Wheel.Spin * RollingRadius;
                const [σx, σy] = this.Tyres.ResolveRelaxationLengths(Wheel.Load);
                // 📐 σ·dκ'/dt + |Vx|·κ' = −Vsx and σ·dα'/dt + |Vx|·α' = −Vy, integrated backward-Euler.
                Wheel.SlipRatio = ClampScalar((Wheel.SlipRatio - SlipSpeed * Δτ / σx) / (1.0 + Math.abs(Vx) * Δτ / σx), -1.5, 1.5);
                Wheel.SlipAngle = ClampScalar((Wheel.SlipAngle - Vy * Δτ / σy) / (1.0 + Math.abs(Vx) * Δτ / σy), -1.3, 1.3);
                const AxleLoad = Math.min(LoadLimit, Wheel.Load
                               + Downforce * (Wheel.Steered ? ChassisSheet.FrontLiftFraction : 1.0 - ChassisSheet.FrontLiftFraction) * 0.5);
                let [Fx, Fy] = this.Tyres.Combine(Wheel.SlipRatio, Wheel.SlipAngle, 0.0, AxleLoad);
                if (this.ThermalGrip)
                {
                    Fx *= this.Thermals[Index].GripFactor;
                    Fy *= this.Thermals[Index].GripFactor;
                }
                // 📝 An underinflated tyre grips less, a pinched one less again, a bare rim least of all.
                const PressureGrip = Wheel.Shredded ? 0.32
                                   : (0.62 + 0.38 * Math.min(1.0, Math.pow(Math.max(0.0, Pressure / (0.75 * TyreReferencePressure)), 0.7))) * (Wheel.Pinched ? 0.7 : 1.0);
                Fx *= PressureGrip;
                Fy *= PressureGrip;
                const Fade = Math.max(0.0, 1.0 - Math.abs(Vx) / ChassisSheet.ContactDampingFadeSpeed);
                Fx -= ChassisSheet.SpinDampingCoefficient * SlipSpeed * Fade;
                Fy -= ChassisSheet.LateralDampingCoefficient * Vy * Fade;
                // 📝 GRIT's sheet peaks above μ 2.3 laterally (pDy1 · Ly), past the chassis's 1.98 g static rollover
                //    threshold; VehicleGeometry.h states the intent that the car slides before it rolls, so the combined
                //    force is held to FrictionLimit · Fz.
                const Limit = FrictionLimit * AxleLoad;
                const Magnitude = Math.hypot(Fx, Fy);
                if (Magnitude > Limit)
                {
                    Fx *= Limit / Magnitude;
                    Fy *= Limit / Magnitude;
                }
                ApplyForce(AddVector(ScaleVector(Longitudinal, Fx), ScaleVector(Lateral, Fy)), Contact);
                // 📝 WheelTelemetry::SlidingPower_W: the tangential work the patch dissipates, −F·v_slip, never the
                //    work of static support (a gripping, rolling tyre has no slip velocity and so dissipates none).
                Wheel.SlidingEnergy += Math.max(0.0, -(Fx * SlipSpeed + Fy * Vy)) * Δτ;
                Wheel.SlipSpeed = Math.hypot(SlipSpeed, Vy);
                Wheel.ContactPoint = Contact;
                Wheel.ContactVelocity = Velocity;
                Wheel.Longitudinal = Longitudinal;
                Wheel.LateralForce = Fy;
                SpinTorque -= Fx * RollingRadius;
                SpinTorque -= ChassisSheet.RollingResistance * Wheel.Load * RollingRadius * Math.sign(Wheel.Spin);
                Wheel.Skid = Math.min(1.0, Math.hypot(Wheel.SlipRatio * 2.0, Wheel.SlipAngle * 3.0));
            }
            Wheel.Spin += SpinTorque * Δτ / Inertia;
            const BrakeStep = BrakeTorque * Δτ / Inertia;
            Wheel.Spin = Math.abs(Wheel.Spin) <= BrakeStep ? 0.0 : Wheel.Spin - Math.sign(Wheel.Spin) * BrakeStep;
            Wheel.SpinAngle = (Wheel.SpinAngle + Wheel.Spin * Δτ) % (2.0 * Math.PI);
        }

        // ⑤ aerodynamics: drag at the centre of mass, downforce at the axles; the burnout hold while the lock is on
        const Drag = ScaleVector(this.LinearVelocity, -0.5 * ChassisSheet.AirDensity * ChassisSheet.DragArea * Speed);
        Force = AddVector(Force, Drag);
        const PlanarSpeed = Math.hypot(this.LinearVelocity[0], this.LinearVelocity[1]);
        if (this.LineLock && this.BurnoutHold && PlanarSpeed > 1.0e-4)
        {
            const Hold = VehicleGeometry.Mass * Math.min(BurnoutHoldAcceleration, BurnoutHoldRate * PlanarSpeed) / PlanarSpeed;
            Force = AddVector(Force, [-this.LinearVelocity[0] * Hold, -this.LinearVelocity[1] * Hold, 0.0]);
        }

        // ⑥ chassis integration (semi-implicit), inertia carried into the world frame
        const Acceleration = ScaleVector(Force, 1.0 / VehicleGeometry.Mass);
        this.LinearVelocity = MultiplyAddVector(this.LinearVelocity, Acceleration, Δτ);
        const BodyTorque = RotateVector(ConjugateQuaternion(Orientation), Torque);
        const BodyAngular = RotateVector(ConjugateQuaternion(Orientation), this.AngularVelocity);
        const Momentum = [this.InertiaBody[0] * BodyAngular[0], this.InertiaBody[1] * BodyAngular[1], this.InertiaBody[2] * BodyAngular[2]];
        const Gyroscopic = CrossVector(BodyAngular, Momentum);
        const AngularAcceleration = [(BodyTorque[0] - Gyroscopic[0]) / this.InertiaBody[0],
                                     (BodyTorque[1] - Gyroscopic[1]) / this.InertiaBody[1],
                                     (BodyTorque[2] - Gyroscopic[2]) / this.InertiaBody[2]];
        this.AngularVelocity = AddVector(this.AngularVelocity, RotateVector(Orientation, ScaleVector(AngularAcceleration, Δτ)));
        this.Position = MultiplyAddVector(this.Position, this.LinearVelocity, Δτ);
        this.Orientation = IntegrateQuaternion(this.Orientation, this.AngularVelocity, Δτ);
        this.ResolveHullContacts();

        // ⑦ an overturned vehicle that stays overturned is put back on its wheels where it lies
        this.OverturnTimer = Upward[2] < 0.25 && Speed < 3.0 ? (this.OverturnTimer || 0.0) + Δτ : 0.0;
        if (this.OverturnTimer > OverturnSeconds)
        {
            const Heading = Math.atan2(Forward[1], Forward[0]);
            this.Respawn([this.Position[0], this.Position[1], VehicleGeometry.CoMHeight + 0.3], Heading);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 HULL CONTACT
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Sphere hull against the course surface and the static obstacle boxes: positional projection plus a
    //    restitution-and-friction impulse at the deepest contact of each sphere. A breakable box (a fracturable prop)
    //    is struck rather than met: when the kinetic energy of the approach along the contact normal, at the hull's
    //    effective mass there, reaches the box's BreakEnergy, the box is marked broken, the impact is queued for the
    //    host to fracture, and the hull loses only the momentum the prop's mass takes in a perfectly inelastic hit —
    //    a crate does not stop a car the way a wall does.
    ResolveHullContacts()
    {
        const InverseInertiaWorld = (Vector) =>
        {
            const Body = RotateVector(ConjugateQuaternion(this.Orientation), Vector);
            return RotateVector(this.Orientation, [Body[0] / this.InertiaBody[0], Body[1] / this.InertiaBody[1], Body[2] / this.InertiaBody[2]]);
        };
        for (const [Sphere, [X, Y, Z, Radius]] of HullSpheres.entries())
        {
            const Centre = AddVector(this.Position, RotateVector(this.Orientation, [X, Y, Z]));
            let Normal = null, Depth = 0.0;
            const Ground = ResolveCourseHeight(Centre[0], Centre[1]);
            if (Centre[2] - Radius < Ground)
            {
                Normal = [0.0, 0.0, 1.0];
                Depth = Ground + Radius - Centre[2];
            }
            for (const Box of this.Obstacles)
            {
                if (Box.Broken)
                    continue;
                const Closest = [ClampScalar(Centre[0], Box.Minimum[0], Box.Maximum[0]),
                                 ClampScalar(Centre[1], Box.Minimum[1], Box.Maximum[1]),
                                 ClampScalar(Centre[2], Box.Minimum[2], Box.Maximum[2])];
                const Offset = SubtractVector(Centre, Closest);
                const Distance = LengthVector(Offset);
                if (Distance >= Radius)
                    continue;
                let BoxNormal, BoxDepth;
                if (Distance > 1.0e-6)
                {
                    BoxNormal = ScaleVector(Offset, 1.0 / Distance);
                    BoxDepth = Radius - Distance;
                }
                else
                {
                    const Exits = [Centre[0] - Box.Minimum[0], Box.Maximum[0] - Centre[0], Centre[1] - Box.Minimum[1],
                                   Box.Maximum[1] - Centre[1], Centre[2] - Box.Minimum[2], Box.Maximum[2] - Centre[2]];
                    const Face = Exits.indexOf(Math.min(...Exits));
                    BoxNormal = [0.0, 0.0, 0.0];
                    BoxNormal[Face >> 1] = (Face & 1) ? 1.0 : -1.0;
                    BoxDepth = Exits[Face] + Radius;
                }
                if (Box.Breakable !== undefined && this.ResolveBreakableImpact(Box, Closest, BoxNormal, InverseInertiaWorld))
                    continue;
                if (BoxDepth > Depth)
                {
                    Normal = BoxNormal;
                    Depth = BoxDepth;
                }
            }
            if (!Normal)
                continue;
            this.Position = MultiplyAddVector(this.Position, Normal, Depth * 0.8);
            const Lever = SubtractVector(MultiplyAddVector(Centre, Normal, -Radius), this.Position);
            const Velocity = AddVector(this.LinearVelocity, CrossVector(this.AngularVelocity, Lever));
            const Approach = DotVector(Velocity, Normal);
            // 📝 Metal sliding on asphalt or concrete: the sill or the bumper scraping sparks off the contact.
            const Sliding = LengthVector(SubtractVector(Velocity, ScaleVector(Normal, Approach)));
            if (Sliding > ScrapeSpeed)
                this.RecordScrape(`hull${Sphere}`, MultiplyAddVector(Centre, Normal, -Radius), Velocity, Math.min(1.5, 0.06 * Sliding));
            if (Approach >= 0.0)
                continue;
            const Angular = CrossVector(InverseInertiaWorld(CrossVector(Lever, Normal)), Lever);
            const Effective = 1.0 / VehicleGeometry.Mass + DotVector(Normal, Angular);
            const Impulse = -(1.0 + 0.15) * Approach / Effective;
            const Tangential = SubtractVector(Velocity, ScaleVector(Normal, Approach));
            const TangentialSpeed = LengthVector(Tangential);
            let Total = ScaleVector(Normal, Impulse);
            if (TangentialSpeed > 1.0e-4)
                Total = AddVector(Total, ScaleVector(Tangential, -Math.min(0.45 * Impulse, TangentialSpeed * VehicleGeometry.Mass * 0.5) / TangentialSpeed));
            this.LinearVelocity = MultiplyAddVector(this.LinearVelocity, Total, 1.0 / VehicleGeometry.Mass);
            this.AngularVelocity = AddVector(this.AngularVelocity, InverseInertiaWorld(CrossVector(Lever, Total)));
        }
    }

    // 📝 Returns true when the strike broke the box (no rigid response follows), false when the box holds.
    ResolveBreakableImpact(Box, Point, Normal, InverseInertiaWorld)
    {
        const Lever = SubtractVector(Point, this.Position);
        const PointVelocity = AddVector(this.LinearVelocity, CrossVector(this.AngularVelocity, Lever));
        const Approach = DotVector(PointVelocity, Normal);
        if (Approach >= 0.0)
            return false;
        const Angular = CrossVector(InverseInertiaWorld(CrossVector(Lever, Normal)), Lever);
        const EffectiveMass = 1.0 / (1.0 / VehicleGeometry.Mass + DotVector(Normal, Angular));
        const Energy = 0.5 * EffectiveMass * Approach * Approach;
        if (Energy < Box.BreakEnergy)
            return false;
        Box.Broken = true;
        const PropMass = Math.max(1.0, Box.Mass || 40.0);
        const Exchange = -Approach * EffectiveMass * PropMass / (EffectiveMass + PropMass);
        const Impulse = ScaleVector(Normal, Exchange);
        this.LinearVelocity = MultiplyAddVector(this.LinearVelocity, Impulse, 1.0 / VehicleGeometry.Mass);
        this.AngularVelocity = AddVector(this.AngularVelocity, InverseInertiaWorld(CrossVector(Lever, Impulse)));
        this.Impacts.push({ Breakable: Box.Breakable, Point: Point.slice(), Normal: Normal.slice(), Velocity: PointVelocity, Energy, Approach });
        return true;
    }

    // 📝 Hands the queued impacts and burst events to the host once per frame.
    ResolveEvents()
    {
        const Events = { Impacts: this.Impacts, Bursts: this.BurstEvents, Shreds: this.ShredEvents, Sparks: [...this.Scrapes.values()] };
        this.Impacts = [];
        this.BurstEvents = [];
        this.ShredEvents = [];
        this.Scrapes = new Map();
        return Events;
    }

    // 📝 What the carcass solver reads per wheel: the hub's height over the road, the road's direction in the wheel's
    //    own frame (steer, camber and spin included), the pressure and the cornering force.
    QueryCarcassContacts()
    {
        return this.Wheels.map((Wheel, Index) =>
        {
            const Turned = MultiplyQuaternion(MultiplyQuaternion(this.Orientation, ConstructAxisQuaternion([0.0, 0.0, 1.0], Wheel.Steer)),
                                              ConstructAxisQuaternion([0.0, 1.0, 0.0], Wheel.SpinAngle));
            const Down = RotateVector(ConjugateQuaternion(Turned), ScaleVector(Wheel.GroundNormal, -1.0));
            return { InContact: Wheel.Contact && Number.isFinite(Wheel.HubDistance), HubDistance: Wheel.HubDistance, DownAngle: Math.atan2(Down[2], Down[0]),
                     Pressure: this.Thermals[Index].GaugePressure, LateralForce: Wheel.LateralForce, Shredded: Wheel.Shredded };
        });
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    POSES
    //--------------------------------------------------------------------------------------------------------------------

    QueryBodyTransform()
    {
        return ConstructRigidTransform(this.Position, this.Orientation);
    }

    // 📝 Hub = strut top + body −Z × strut length; rotation = body · steer about +Z · spin about the +Y axle.
    QueryWheelTransform(Index)
    {
        const Wheel = this.Wheels[Index];
        const HubLocal = [Wheel.Mount[0], Wheel.Mount[1], Wheel.Mount[2] - Wheel.Length];
        const Hub = AddVector(this.Position, RotateVector(this.Orientation, HubLocal));
        const Steered = MultiplyQuaternion(this.Orientation, ConstructAxisQuaternion([0.0, 0.0, 1.0], Wheel.Steer));
        const Spun = MultiplyQuaternion(Steered, ConstructAxisQuaternion([0.0, 1.0, 0.0], Wheel.SpinAngle));
        return ConstructRigidTransform(Hub, Spun);
    }

    QueryForward()
    {
        return RotateVector(this.Orientation, [1.0, 0.0, 0.0]);
    }

    // 📝 What the smoke and fire sources read (GasVehicleIntake.h's inputs): per wheel the contact patch, its velocity,
    //    the sliding power and slip speed, the hub and the tyre's heat; the exhaust tips and the afterfire window.
    QueryPlumeTelemetry()
    {
        const Wheels = this.Wheels.map((Wheel, Index) =>
        {
            const HubLocal = [Wheel.Mount[0], Wheel.Mount[1], Wheel.Mount[2] - Wheel.Length];
            return {
                InContact: Wheel.Contact, ContactPoint: Wheel.ContactPoint, ContactVelocity: Wheel.ContactVelocity,
                HubPosition: AddVector(this.Position, RotateVector(this.Orientation, HubLocal)),
                SlidingPower: Wheel.SlidingPower, SlipSpeed: Wheel.SlipSpeed, Thermal: this.Thermals[Index],
                Longitudinal: Wheel.Longitudinal, SurfaceSpeed: Wheel.Spin * (Wheel.Radius - 0.012), Radius: Wheel.Radius,
                Burst: this.Thermals[Index].Burst, Driven: Wheel.Driven, Pinched: Wheel.Pinched, Shredded: Wheel.Shredded
            };
        });
        const Backward = RotateVector(this.Orientation, [-1.0, 0.0, -0.08]);
        const Exhausts = ExhaustOutlets.map((Outlet) => ({ Position: AddVector(this.Position, RotateVector(this.Orientation, Outlet)),
                                                           Direction: NormalizeVector(Backward) }));
        return { Wheels, Exhausts, AfterfireSeconds: this.AfterfireSeconds, EngineRPM: this.EngineRPM, Throttle: this.Throttle,
                 Velocity: this.LinearVelocity, Position: this.Position, LineLock: this.LineLock };
    }

    // 📝 The hull spheres and the four wheels as world spheres with their point velocities — the kinematic pushers the
    //    stress-test debris collides with.
    QueryPushers()
    {
        const Pushers = HullSpheres.map(([X, Y, Z, Radius]) =>
        {
            const Centre = AddVector(this.Position, RotateVector(this.Orientation, [X, Y, Z]));
            return { Centre, Radius, Velocity: AddVector(this.LinearVelocity, CrossVector(this.AngularVelocity, SubtractVector(Centre, this.Position))) };
        });
        for (let Index = 0; Index < 4; ++Index)
        {
            const Wheel = this.Wheels[Index];
            const Centre = AddVector(this.Position, RotateVector(this.Orientation, [Wheel.Mount[0], Wheel.Mount[1], Wheel.Mount[2] - Wheel.Length]));
            Pushers.push({ Centre, Radius: Wheel.Radius,
                           Velocity: AddVector(this.LinearVelocity, CrossVector(this.AngularVelocity, SubtractVector(Centre, this.Position))) });
        }
        return Pushers;
    }

    QueryTelemetry()
    {
        const Forward = this.QueryForward();
        const Gear = this.GearIndex === TransmissionSheet.ReverseIndex ? "R" : String(this.GearIndex - TransmissionSheet.FirstIndex + 1);
        return {
            Speed: DotVector(this.LinearVelocity, Forward),
            Gear,
            EngineRPM: Math.min(this.EngineRPM, EngineSheet.RedlineRPM + 400.0),
            Boost: this.Boost,
            Throttle: this.Throttle,
            Contacts: this.Wheels.filter((Wheel) => Wheel.Contact).length,
            Skid: Math.max(...this.Wheels.map((Wheel) => Wheel.Skid)),
            TyreTemperatures: this.Thermals.map((Thermal) => Thermal.SurfaceTemperature - 273.15),
            TyresBurning: this.Thermals.filter((Thermal) => Thermal.Ignited).length,
            SlidingPower: this.Wheels.map((Wheel) => Wheel.SlidingPower),
            TreadFractions: this.Thermals.map((Thermal) => ResolveTreadFraction(Thermal)),
            Bursts: this.Thermals.map((Thermal) => Thermal.Burst),
            Pressures: this.Thermals.map((Thermal) => Thermal.GaugePressure / 1000.0),
            Leaking: this.Thermals.map((Thermal) => Thermal.LeakRate > 0.0),
            TyreDeflections: this.Wheels.map((Wheel) => Wheel.TyreDeflection),
            Pinched: this.Wheels.map((Wheel) => Wheel.Pinched),
            Shredded: this.Wheels.map((Wheel) => Wheel.Shredded),
            Ignited: this.Thermals.map((Thermal) => Thermal.Ignited),
            CarcassTemperatures: this.Thermals.map((Thermal) => Thermal.CarcassTemperature - 273.15),
            RearSurfaceSpeed: 0.5 * (this.Wheels[2].Spin * (this.Wheels[2].Radius - 0.012) + this.Wheels[3].Spin * (this.Wheels[3].Radius - 0.012)),
            LineLock: this.LineLock
        };
    }
}
