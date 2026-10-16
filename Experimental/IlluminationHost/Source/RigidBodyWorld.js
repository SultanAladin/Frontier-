//============================================================================================================================================
//                                                           RIGIDBODYWORLD.JS
//============================================================================================================================================
// 🧩 Convex rigid bodies — debris and cones — against the course, the static colliders, each other and the car, at 120 Hz.

// 📝 Every body is a convex hull: its points (for contacts it makes) and its face planes (for contacts made into it),
//    both about its centre of mass. That one representation answers every query the arena asks:
//
//      ① the course: each hull point below the analytic surface is a contact along the course normal;
//      ② static colliders (walls, barriers, containers, intact props — world boxes): a hull point inside a box is
//         pushed out through the nearest face, and a box corner inside a hull pushes the hull off it;
//      ③ body against body: the points of each inside the other's planes — the deepest plane names the normal and
//         the depth. A uniform grid finds the pairs; two sleeping bodies are never tested;
//      ④ the car: its hull spheres and its four wheels against each hull's planes, and each hull's points against
//         the spheres. Impulses go both ways — the car is a body here, with its mass and inertia, so a concrete slab
//         stops it and a cone does not;
//      ⑤ the car can also drive OVER a heavy body: QuerySupport answers the vehicle solver's strut casts with the
//         highest hull top under the wheel, and the wheel's load is handed back to that body as an impulse.
//
//    Contacts are resolved with sequential impulses (restitution only for real approaches, Coulomb friction) and a
//    split positional projection. Bodies sleep once settled and cost nothing until something with real momentum
//    reaches them; a cone at rest is a sleeping body, so a hundred and thirty of them are free until the car arrives.

import { ResolveCourseHeight, ResolveCourseNormal, CourseConstants, KerbConstants } from "./CourseStructure.js";
import { HullSpheres } from "./VehicleSolver.js";
import { VehicleGeometry, ResolveInertia } from "./VehicleSpecification.js";
import { AddVector, SubtractVector, ScaleVector, DotVector, CrossVector, LengthVector, NormalizeVector, MultiplyAddVector,
         RotateVector, ConjugateQuaternion, IntegrateQuaternion } from "./TransformProjection.js";

const Gravity        = 9.81;         // [m/s²]
const SubstepSeconds = 1.0 / 120.0;  // [s]
const SubstepCeiling = 4;            // [-]   per frame, so a stalled tab does not spiral
const Iterations     = 4;            // [-]   impulse passes per substep
const SleepSpeed     = 0.11;         // [m/s] at the hull (linear, and spin × radius)
const SleepSeconds   = 0.35;         // [s]
const BounceSpeed    = 0.7;          // [m/s] below this approach a contact is plastic (no restitution, no jitter)
const Slop           = 0.002;        // [m]   penetration left alone
const Projection     = 0.7;          // [-]   share of the remaining penetration removed per substep
const CellExtent     = 1.25;         // [m]   broadphase grid pitch
const VehicleReach   = 4.2;          // [m]   car bounding sphere about its centre of mass
const SupportMass    = 2.0;          // [kg]  bodies at least this heavy carry a wheel (and are pinned by it); lighter ones are shoved aside
const PebbleRadius   = 0.12;         // [m]   smaller pieces than this pass under a tyre instead of being struck by it
const WakeSpeed      = 0.35;         // [m/s] an approach this fast wakes a sleeping body

export const RigidSettingsDefaults = Object.freeze({
    Bounce:   1.0,   // [×] scale on every body's restitution
    Friction: 1.0,   // [×] scale on every body's friction
    Vehicle:  true   // [-] the car pushes bodies and feels them
});

export class RigidBodyWorld
{
    constructor()
    {
        this.Bodies      = [];
        this.Obstacles   = [];
        this.Accumulator = 0.0;
        this.Settings    = { ...RigidSettingsDefaults };
        this.NextId      = 1;
        this.Support     = [];   // heavy bodies near the car, refreshed per frame for QuerySupport
        this.Metrics     = { Bodies: 0, Awake: 0, Contacts: 0, Pairs: 0, Milliseconds: 0.0, Backend: "custom" };
        this.VehicleInertia = ResolveInertia();
        this.Jolt         = null;
        this.JoltInterface = null;
        this.JoltBodies  = null;
        this.JoltStaticIds = [];
        this.JoltCourseIds = [];
        this.JoltScratch = null;
        this.JoltObjectLayer = { Static: 0, Dynamic: 1 };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   BODIES
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Spec: { Position, Orientation, Linear?, Angular?, Mass, Inertia [3] (principal, body frame), Points, Planes,
    //    Restitution, Friction, Sleeping?, Owner?, Kind? }. Points and planes are about the centre of mass.
    AddBody(Spec)
    {
        let Radius = 0.0;
        for (const Point of Spec.Points)
            Radius = Math.max(Radius, LengthVector(Point));
        const Samples = Spec.Samples || ConstructContactSamples(Spec.Points, Spec.Planes);
        const Body = {
            Id:             this.NextId++,
            JoltId:         null,
            JoltState:      null,
            Kind:           Spec.Kind || "debris",
            Owner:          Spec.Owner || null,
            Position:       Spec.Position.slice(),
            Orientation:    Spec.Orientation.slice(),
            Linear:         Spec.Linear ? Spec.Linear.slice() : [0.0, 0.0, 0.0],
            Angular:        Spec.Angular ? Spec.Angular.slice() : [0.0, 0.0, 0.0],
            Mass:           Spec.Mass,
            InverseMass:    1.0 / Spec.Mass,
            InverseInertia: Spec.Inertia.map((Moment) => 1.0 / Math.max(Moment, 1.0e-6)),
            Points:         Spec.Points,
            Planes:         Spec.Planes,
            Samples,
            Radius,
            Restitution:    Spec.Restitution ?? 0.2,
            Friction:       Spec.Friction ?? 0.6,
            Sleeping:       !!Spec.Sleeping,
            Still:          0.0,
            Touching:       false,
            Carries:        Spec.Mass >= SupportMass,
            WorldPoints:    new Float64Array(Spec.Points.length * 3),
            WorldSamples:   new Float64Array(Samples.length * 3),
            WorldPlanes:    new Float64Array(Spec.Planes.length * 4),
            Rotation:       new Float64Array(9),
            Woke:           false,   // [-] set when the body wakes this frame (owners read and clear it)
            Moved:          !Spec.Sleeping
        };
        this.RefreshBody(Body);
        if (this.JoltInterface)
            Body.JoltId = this.CreateJoltBody(Body, Spec);
        this.Bodies.push(Body);
        return Body;
    }

    RemoveBody(Body)
    {
        const Index = this.Bodies.indexOf(Body);
        if (Index >= 0)
        {
            if (Body.JoltId !== null && this.JoltBodies)
                this.RemoveJoltBody(Body.JoltId);
            Body.JoltId = null;
            Body.JoltState = null;
            this.Bodies.splice(Index, 1);
        }
    }

    // 📝 Puts a body somewhere, at rest and asleep (a cone rezzed back onto its mark).
    PlaceBody(Body, Position, Orientation, Sleeping = true)
    {
        Body.Position = Position.slice();
        Body.Orientation = Orientation.slice();
        Body.Linear = [0.0, 0.0, 0.0];
        Body.Angular = [0.0, 0.0, 0.0];
        Body.Sleeping = Sleeping;
        Body.Still = 0.0;
        Body.Moved = true;
        this.RefreshBody(Body);
        if (Body.JoltId !== null && this.JoltBodies)
            this.SyncBodyToJolt(Body, !Sleeping);
    }

    Wake(Body)
    {
        if (Body.Sleeping)
        {
            Body.Sleeping = false;
            Body.Woke = true;
            if (Body.JoltId !== null && this.JoltBodies)
                this.JoltBodies.ActivateBody(Body.JoltId);
        }
        Body.Still = 0.0;
    }

    // 📝 World boxes { Minimum, Maximum } the bodies collide with (the vehicle's obstacle list).
    AssignObstacles(Boxes)
    {
        this.Obstacles = Boxes;
        if (this.JoltInterface)
            this.RebuildJoltObstacles();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               JOLT FOR WEB
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Jolt owns the shared dynamic-body simulation; the host keeps the JS body records as the stable API for support
    //    casts, occupants and the custom vehicle-contact bridge. The package is loaded from Tools after npm install, and
    //    the custom solver remains the fallback when an adapter cannot initialise WebAssembly.
    async InitializeJolt()
    {
        if (this.JoltInterface)
            return this;
        const Package = await import("../Tools/node_modules/jolt-physics/dist/jolt-physics.wasm-compat.js");
        const Jolt = await Package.default();
        this.Jolt = Jolt;
        try
        {
            const ObjectLayers = new Jolt.ObjectLayerPairFilterTable(2);
            ObjectLayers.EnableCollision(this.JoltObjectLayer.Static, this.JoltObjectLayer.Dynamic);
            ObjectLayers.EnableCollision(this.JoltObjectLayer.Dynamic, this.JoltObjectLayer.Dynamic);
            const BroadPhase = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
            const StaticBroadPhase = new Jolt.BroadPhaseLayer(0), DynamicBroadPhase = new Jolt.BroadPhaseLayer(1);
            BroadPhase.MapObjectToBroadPhaseLayer(this.JoltObjectLayer.Static, StaticBroadPhase);
            BroadPhase.MapObjectToBroadPhaseLayer(this.JoltObjectLayer.Dynamic, DynamicBroadPhase);
            Jolt.destroy(StaticBroadPhase);
            Jolt.destroy(DynamicBroadPhase);

            const Settings = new Jolt.JoltSettings();
            Settings.mMaxBodies = 8192;
            Settings.mMaxBodyPairs = 32768;
            Settings.mMaxContactConstraints = 16384;
            Settings.mMaxWorkerThreads = 1;
            Settings.mObjectLayerPairFilter = ObjectLayers;
            Settings.mBroadPhaseLayerInterface = BroadPhase;
            Settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(BroadPhase, 2, ObjectLayers, 2);
            this.JoltInterface = new Jolt.JoltInterface(Settings);
            Jolt.destroy(Settings);
            this.PhysicsSystem = this.JoltInterface.GetPhysicsSystem();
            this.JoltBodies = this.PhysicsSystem.GetBodyInterface();
            const GravityVector = new Jolt.Vec3(0.0, 0.0, -Gravity);
            this.PhysicsSystem.SetGravity(GravityVector);
            Jolt.destroy(GravityVector);
            this.JoltScratch = {
                Position: new Jolt.RVec3(), Rotation: new Jolt.Quat(), Linear: new Jolt.Vec3(), Angular: new Jolt.Vec3(),
                WritePosition: new Jolt.RVec3(), WriteRotation: new Jolt.Quat(), WriteLinear: new Jolt.Vec3(), WriteAngular: new Jolt.Vec3()
            };
            this.CreateJoltCourse();
            this.RebuildJoltObstacles();
            for (const Body of this.Bodies)
                Body.JoltId = this.CreateJoltBody(Body, Body);
            this.Metrics = { ...this.Metrics, Backend: "Jolt Physics for Web" };
            return this;
        }
        catch (Failure)
        {
            this.DestroyJolt();
            throw Failure;
        }
    }

    DestroyJolt()
    {
        const Jolt = this.Jolt;
        if (!Jolt)
            return;
        if (this.JoltBodies)
        {
            for (const Body of this.Bodies)
            {
                if (Body.JoltId === null)
                    continue;
                this.RemoveJoltBody(Body.JoltId);
                Body.JoltId = null;
                Body.JoltState = null;
            }
            for (const Id of [...this.JoltStaticIds, ...this.JoltCourseIds])
                this.RemoveJoltBody(Id);
        }
        this.JoltStaticIds = [];
        this.JoltCourseIds = [];
        if (this.JoltScratch)
            for (const Value of Object.values(this.JoltScratch))
                Jolt.destroy(Value);
        this.JoltScratch = null;
        if (this.JoltInterface)
            Jolt.destroy(this.JoltInterface);
        this.JoltInterface = null;
        this.JoltBodies = null;
        this.PhysicsSystem = null;
        this.Jolt = null;
        this.Metrics = { ...this.Metrics, Backend: "custom" };
    }

    CreateJoltShape(ShapeSettings)
    {
        const Jolt = this.Jolt;
        let Result = null;
        try
        {
            Result = ShapeSettings.Create();
            if (!Result.IsValid())
            {
                const Detail = Result.HasError() ? Result.GetError() : null;
                const Message = Detail ? Detail.c_str() : "invalid shape settings";
                if (Detail) Jolt.destroy(Detail);
                throw new Error(`Jolt could not create a convex shape: ${Message}`);
            }
            const Shape = Result.Get();
            Result.Clear();
            Shape.AddRef();
            return Shape;
        }
        finally
        {
            if (Result) Jolt.destroy(Result);
            Jolt.destroy(ShapeSettings);
        }
    }

    CreateJoltShapeBody(ShapeSettings, Position, Orientation, MotionType, ObjectLayer, Activation, Spec = null)
    {
        const Jolt = this.Jolt;
        const Shape = this.CreateJoltShape(ShapeSettings);
        const JoltPosition = new Jolt.RVec3(Position[0], Position[1], Position[2]);
        const JoltRotation = new Jolt.Quat(Orientation[0], Orientation[1], Orientation[2], Orientation[3]);
        let Creation = null, ShapeOwned = true;
        try
        {
            Creation = new Jolt.BodyCreationSettings(Shape, JoltPosition, JoltRotation, MotionType, ObjectLayer);
            Shape.Release();
            ShapeOwned = false;
            Creation.mFriction = Spec ? Spec.Friction : 0.85;
            Creation.mRestitution = Spec ? Spec.Restitution : 0.0;
            if (Spec)
            {
                Creation.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
                Creation.mMassPropertiesOverride.mMass = Spec.Mass;
                const Linear = new Jolt.Vec3(...(Spec.Linear || [0.0, 0.0, 0.0]));
                const Angular = new Jolt.Vec3(...(Spec.Angular || [0.0, 0.0, 0.0]));
                Creation.mLinearVelocity = Linear;
                Creation.mAngularVelocity = Angular;
                Jolt.destroy(Linear);
                Jolt.destroy(Angular);
                Creation.mAllowSleeping = true;
                Creation.mLinearDamping = 0.025;
                Creation.mAngularDamping = 0.08;
            }
            const TemporaryId = this.JoltBodies.CreateAndAddBody(Creation, Activation);
            const Id = new Jolt.BodyID(TemporaryId.GetIndexAndSequenceNumber());
            Jolt.destroy(TemporaryId);
            return Id;
        }
        finally
        {
            if (ShapeOwned)
                Shape.Release();
            Jolt.destroy(JoltPosition);
            Jolt.destroy(JoltRotation);
            if (Creation) Jolt.destroy(Creation);
        }
    }

    CreateJoltBody(Body, Spec)
    {
        const Hull = new this.Jolt.ConvexHullShapeSettings();
        Hull.mMaxConvexRadius = 0.015;
        for (const [X, Y, Z] of Spec.Points)
        {
            const Point = new this.Jolt.Vec3(X, Y, Z);
            Hull.mPoints.push_back(Point);
            this.Jolt.destroy(Point);
        }
        const Id = this.CreateJoltShapeBody(Hull, Body.Position, Body.Orientation, this.Jolt.EMotionType_Dynamic,
                                            this.JoltObjectLayer.Dynamic, Body.Sleeping ? this.Jolt.EActivation_DontActivate : this.Jolt.EActivation_Activate,
                                            Spec);
        Body.JoltState = this.CopyJoltState(Body);
        return Id;
    }

    CreateJoltBox(Position, HalfExtent, Friction = 0.85)
    {
        const Half = new this.Jolt.Vec3(Math.max(0.005, HalfExtent[0]), Math.max(0.005, HalfExtent[1]), Math.max(0.005, HalfExtent[2]));
        const Shape = new this.Jolt.BoxShapeSettings(Half, Math.min(0.02, Math.min(HalfExtent[0], HalfExtent[1], HalfExtent[2]) * 0.25), null);
        this.Jolt.destroy(Half);
        const Id = this.CreateJoltShapeBody(Shape, Position, [0.0, 0.0, 0.0, 1.0], this.Jolt.EMotionType_Static,
                                            this.JoltObjectLayer.Static, this.Jolt.EActivation_DontActivate);
        this.JoltBodies.SetFriction(Id, Friction);
        return Id;
    }

    CreateJoltCourse()
    {
        const Course = CourseConstants;
        this.JoltCourseIds.push(this.CreateJoltBox([0.0, 0.0, Course.SurroundHeight - 0.05], [600.0, 600.0, 0.05]));
        this.JoltCourseIds.push(this.CreateJoltBox([(Course.PadMinimum[0] + Course.PadMaximum[0]) * 0.5,
                                                   (Course.PadMinimum[1] + Course.PadMaximum[1]) * 0.5, -0.05],
                                                   [(Course.PadMaximum[0] - Course.PadMinimum[0]) * 0.5,
                                                    (Course.PadMaximum[1] - Course.PadMinimum[1]) * 0.5, 0.05]));
        for (const [X0, X1, Y0, Y1] of KerbConstants.Strips)
            this.JoltCourseIds.push(this.CreateJoltBox([(X0 + X1) * 0.5, (Y0 + Y1) * 0.5, KerbConstants.Height * 0.5],
                                                       [(X1 - X0) * 0.5, (Y1 - Y0) * 0.5, KerbConstants.Height * 0.5]));
        const Near = Course.RampNearX, Far = Near + Course.RampRunX, Low = Course.RampCentreY - Course.RampHalfWidth;
        const High = Course.RampCentreY + Course.RampHalfWidth, Rise = Course.RampRise;
        const Ramp = new this.Jolt.ConvexHullShapeSettings();
        Ramp.mMaxConvexRadius = 0.005;
        for (const Point of [[Near, Low, 0.0], [Near, High, 0.0], [Far, Low, 0.0], [Far, High, 0.0],
                             [Far, Low, Rise], [Far, High, Rise]])
        {
            const Vertex = new this.Jolt.Vec3(...Point);
            Ramp.mPoints.push_back(Vertex);
            this.Jolt.destroy(Vertex);
        }
        this.JoltCourseIds.push(this.CreateJoltShapeBody(Ramp, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0],
                                                         this.Jolt.EMotionType_Static, this.JoltObjectLayer.Static,
                                                         this.Jolt.EActivation_DontActivate));
    }

    RebuildJoltObstacles()
    {
        if (!this.JoltBodies)
            return;
        for (const Id of this.JoltStaticIds)
            this.RemoveJoltBody(Id);
        this.JoltStaticIds = [];
        for (const Box of this.Obstacles)
        {
            const Minimum = Box.Minimum, Maximum = Box.Maximum;
            const Half = [0, 1, 2].map((Axis) => Math.max(0.005, 0.5 * (Maximum[Axis] - Minimum[Axis])));
            const Centre = [0, 1, 2].map((Axis) => 0.5 * (Maximum[Axis] + Minimum[Axis]));
            this.JoltStaticIds.push(this.CreateJoltBox(Centre, Half, 0.8));
        }
    }

    RemoveJoltBody(Id)
    {
        if (!this.JoltBodies || Id === null || Id === undefined)
            return;
        this.JoltBodies.RemoveBody(Id);
        this.JoltBodies.DestroyBody(Id);
    }

    CopyJoltState(Body)
    {
        return { Position: Body.Position.slice(), Orientation: Body.Orientation.slice(), Linear: Body.Linear.slice(),
                 Angular: Body.Angular.slice(), Sleeping: Body.Sleeping };
    }

    JoltStateDiffers(Body)
    {
        const State = Body.JoltState;
        if (!State || State.Sleeping !== Body.Sleeping)
            return true;
        const Changed = (Left, Right) => Left.some((Value, Index) => Math.abs(Value - Right[Index]) > 1.0e-6);
        return Changed(Body.Position, State.Position) || Changed(Body.Orientation, State.Orientation)
            || Changed(Body.Linear, State.Linear) || Changed(Body.Angular, State.Angular);
    }

    SyncBodyToJolt(Body, Activate = !Body.Sleeping)
    {
        if (!this.JoltBodies || Body.JoltId === null)
            return;
        const Scratch = this.JoltScratch;
        Scratch.WritePosition.Set(...Body.Position);
        Scratch.WriteRotation.Set(...Body.Orientation);
        Scratch.WriteLinear.Set(...Body.Linear);
        Scratch.WriteAngular.Set(...Body.Angular);
        this.JoltBodies.SetPositionRotationAndVelocity(Body.JoltId, Scratch.WritePosition, Scratch.WriteRotation,
                                                       Scratch.WriteLinear, Scratch.WriteAngular);
        if (Activate)
            this.JoltBodies.ActivateBody(Body.JoltId);
        else
            this.JoltBodies.DeactivateBody(Body.JoltId);
        Body.Sleeping = !Activate;
        Body.JoltState = this.CopyJoltState(Body);
        Body.Moved = true;
        this.RefreshBody(Body);
    }

    ReadBodyFromJolt(Body, WasSleeping)
    {
        if (!this.JoltBodies || Body.JoltId === null)
            return false;
        if (!this.JoltBodies.IsActive(Body.JoltId))
        {
            Body.Sleeping = true;
            Body.JoltState = this.CopyJoltState(Body);
            return false;
        }
        const Scratch = this.JoltScratch;
        this.JoltBodies.GetPositionAndRotation(Body.JoltId, Scratch.Position, Scratch.Rotation);
        this.JoltBodies.GetLinearAndAngularVelocity(Body.JoltId, Scratch.Linear, Scratch.Angular);
        const Prior = Body.JoltState;
        Body.Position = [Scratch.Position.GetX(), Scratch.Position.GetY(), Scratch.Position.GetZ()];
        Body.Orientation = [Scratch.Rotation.GetX(), Scratch.Rotation.GetY(), Scratch.Rotation.GetZ(), Scratch.Rotation.GetW()];
        Body.Linear = [Scratch.Linear.GetX(), Scratch.Linear.GetY(), Scratch.Linear.GetZ()];
        Body.Angular = [Scratch.Angular.GetX(), Scratch.Angular.GetY(), Scratch.Angular.GetZ()];
        Body.Sleeping = false;
        if (WasSleeping)
            Body.Woke = true;
        const Changed = (Left, Right) => !Right || Left.some((Value, Index) => Math.abs(Value - Right[Index]) > 1.0e-6);
        const Moved = Changed(Body.Position, Prior?.Position) || Changed(Body.Orientation, Prior?.Orientation);
        Body.Moved = Body.Moved || Moved;
        Body.JoltState = this.CopyJoltState(Body);
        if (Moved)
            this.RefreshBody(Body);
        return Moved;
    }

    SyncJoltMaterial(Body)
    {
        if (Body.JoltId === null || !this.JoltBodies)
            return;
        const Friction = Math.max(0.0, Body.Friction * this.Settings.Friction);
        const Restitution = Math.max(0.0, Body.Restitution * this.Settings.Bounce);
        if (Body.JoltFriction !== Friction)
        {
            this.JoltBodies.SetFriction(Body.JoltId, Friction);
            Body.JoltFriction = Friction;
        }
        if (Body.JoltRestitution !== Restitution)
        {
            this.JoltBodies.SetRestitution(Body.JoltId, Restitution);
            Body.JoltRestitution = Restitution;
        }
    }

    AdvanceJolt(Seconds, Vehicle)
    {
        const Started = performance.now();
        for (const Body of this.Bodies)
        {
            Body.Moved = false;
            this.SyncJoltMaterial(Body);
        }
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), SubstepSeconds * SubstepCeiling);
        const Steps = Math.floor(this.Accumulator / SubstepSeconds);
        this.Accumulator -= Steps * SubstepSeconds;
        this.ApplySupportLoads(Vehicle);
        for (const Body of this.Bodies)
            if (this.JoltStateDiffers(Body))
                this.SyncBodyToJolt(Body, !Body.Sleeping);
        const Car = Vehicle && this.Settings.Vehicle && !Vehicle.Hidden ? this.ConstructVehicleProxy(Vehicle) : null;
        let Awake = this.Bodies.reduce((Count, Body) => Count + (Body.Sleeping ? 0 : 1), 0);
        if (Steps === 0 || (Awake === 0 && !(Car && this.AnyNear(Car.Position, VehicleReach + 1.5))))
        {
            this.Metrics = { ...this.Metrics, Bodies: this.Bodies.length, Awake, Contacts: 0, Pairs: 0,
                             Milliseconds: performance.now() - Started };
            this.RefreshSupport(Vehicle);
            return;
        }
        let Contacts = 0;
        for (let Step = 0; Step < Steps; ++Step)
        {
            const Sleeping = this.Bodies.map((Body) => Body.Sleeping);
            for (const Body of this.Bodies)
                Body.Touching = false;
            this.JoltInterface.Step(SubstepSeconds, 1);
            for (let Index = 0; Index < this.Bodies.length; ++Index)
                this.ReadBodyFromJolt(this.Bodies[Index], Sleeping[Index]);

            if (Car)
            {
                const Manifold = [];
                this.CollectVehicleContacts(Car, Manifold);
                Contacts += Manifold.length;
                const Bounce = this.Settings.Bounce, Grip = this.Settings.Friction;
                for (let Iteration = 0; Iteration < Iterations; ++Iteration)
                    for (const Contact of Manifold)
                        this.ResolveContact(Contact, Iteration === 0, Bounce, Grip, Car);
                for (const Body of this.Bodies)
                    Body.Shift = null;
                for (const Contact of Manifold)
                    this.ProjectContact(Contact);
                const Modified = new Set(Manifold.map((Contact) => Contact.A));
                for (const Body of Modified)
                    this.SyncBodyToJolt(Body, !Body.Sleeping);
            }
        }
        if (Car)
            this.ReturnVehicleProxy(Car, Vehicle);
        Awake = this.Bodies.reduce((Count, Body) => Count + (Body.Sleeping ? 0 : 1), 0);
        this.Metrics = { ...this.Metrics, Bodies: this.Bodies.length, Awake,
                         Contacts: Steps > 0 ? Math.round(Contacts / Steps) : 0, Pairs: 0,
                         Milliseconds: performance.now() - Started };
        this.RefreshSupport(Vehicle);
    }

    // 📝 Rotation matrix, world points and world planes of a body at its current pose.
    RefreshBody(Body)
    {
        const [X, Y, Z, W] = Body.Orientation;
        const R = Body.Rotation;
        R[0] = 1 - 2 * (Y * Y + Z * Z); R[1] = 2 * (X * Y - Z * W);     R[2] = 2 * (X * Z + Y * W);
        R[3] = 2 * (X * Y + Z * W);     R[4] = 1 - 2 * (X * X + Z * Z); R[5] = 2 * (Y * Z - X * W);
        R[6] = 2 * (X * Z - Y * W);     R[7] = 2 * (Y * Z + X * W);     R[8] = 1 - 2 * (X * X + Y * Y);
        const P = Body.Position;
        for (let Index = 0; Index < Body.Points.length; ++Index)
        {
            const [A, B, C] = Body.Points[Index];
            Body.WorldPoints[Index * 3 + 0] = P[0] + R[0] * A + R[1] * B + R[2] * C;
            Body.WorldPoints[Index * 3 + 1] = P[1] + R[3] * A + R[4] * B + R[5] * C;
            Body.WorldPoints[Index * 3 + 2] = P[2] + R[6] * A + R[7] * B + R[8] * C;
        }
        for (let Index = 0; Index < Body.Samples.length; ++Index)
        {
            const [A, B, C] = Body.Samples[Index];
            Body.WorldSamples[Index * 3 + 0] = P[0] + R[0] * A + R[1] * B + R[2] * C;
            Body.WorldSamples[Index * 3 + 1] = P[1] + R[3] * A + R[4] * B + R[5] * C;
            Body.WorldSamples[Index * 3 + 2] = P[2] + R[6] * A + R[7] * B + R[8] * C;
        }
        for (let Index = 0; Index < Body.Planes.length; ++Index)
        {
            const [A, B, C, D] = Body.Planes[Index];
            const NX = R[0] * A + R[1] * B + R[2] * C, NY = R[3] * A + R[4] * B + R[5] * C, NZ = R[6] * A + R[7] * B + R[8] * C;
            Body.WorldPlanes[Index * 4 + 0] = NX;
            Body.WorldPlanes[Index * 4 + 1] = NY;
            Body.WorldPlanes[Index * 4 + 2] = NZ;
            Body.WorldPlanes[Index * 4 + 3] = D + NX * P[0] + NY * P[1] + NZ * P[2];
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  STEPPING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 After the vehicle steps: up to four 120 Hz substeps. Vehicle (optional) is the VehicleSolver; it is pushed
    //    and pulled through its velocities only — its pose was already advanced this frame.
    Advance(Seconds, Vehicle)
    {
        if (this.JoltInterface)
        {
            this.AdvanceJolt(Seconds, Vehicle);
            return;
        }
        const Started = performance.now();
        for (const Body of this.Bodies)
            Body.Moved = false;
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), SubstepSeconds * SubstepCeiling);
        const Steps = Math.floor(this.Accumulator / SubstepSeconds);
        this.Accumulator -= Steps * SubstepSeconds;
        this.ApplySupportLoads(Vehicle);
        const Car = Vehicle && this.Settings.Vehicle && !Vehicle.Hidden ? this.ConstructVehicleProxy(Vehicle) : null;
        let Awake = 0;
        for (const Body of this.Bodies)
            if (!Body.Sleeping)
                Awake++;
        // 📝 Nothing awake and no car among the bodies: nothing can change.
        if (Awake === 0 && !(Car && this.AnyNear(Car.Position, VehicleReach + 1.5)))
        {
            this.Metrics = { ...this.Metrics, Bodies: this.Bodies.length, Awake: 0, Contacts: 0, Pairs: 0, Backend: "custom",
                             Milliseconds: performance.now() - Started };
            this.RefreshSupport(Vehicle);
            return;
        }
        let Contacts = 0, Pairs = 0;
        for (let Step = 0; Step < Steps; ++Step)
        {
            const Result = this.Step(SubstepSeconds, Car);
            Contacts += Result.Contacts;
            Pairs += Result.Pairs;
        }
        if (Car)
            this.ReturnVehicleProxy(Car, Vehicle);
        Awake = 0;
        for (const Body of this.Bodies)
            if (!Body.Sleeping)
                Awake++;
        this.Metrics = { Bodies: this.Bodies.length, Awake, Contacts: Steps > 0 ? Math.round(Contacts / Steps) : 0,
                         Pairs: Steps > 0 ? Math.round(Pairs / Steps) : 0, Milliseconds: performance.now() - Started, Backend: "custom" };
        this.RefreshSupport(Vehicle);
    }

    AnyNear(Position, Reach)
    {
        for (const Body of this.Bodies)
        {
            const DX = Body.Position[0] - Position[0], DY = Body.Position[1] - Position[1], DZ = Body.Position[2] - Position[2];
            const Limit = Reach + Body.Radius;
            if (DX * DX + DY * DY + DZ * DZ < Limit * Limit)
                return true;
        }
        return false;
    }

    Step(Δτ, Car)
    {
        // ① integrate the awake bodies
        for (const Body of this.Bodies)
        {
            if (Body.Sleeping)
                continue;
            Body.Linear[2] -= Gravity * Δτ;
            // 📝 A body under a wheel is pinned by the wheel's load: its motion dies away quickly.
            const Drag = Body.Pressed ? 0.8 : 1.0 - 0.04 * Δτ, Spin = Body.Pressed ? 0.8 : 1.0 - 0.1 * Δτ;
            Body.Linear[0] *= Drag; Body.Linear[1] *= Drag; Body.Linear[2] *= Drag;
            Body.Angular[0] *= Spin; Body.Angular[1] *= Spin; Body.Angular[2] *= Spin;
            Body.Position[0] += Body.Linear[0] * Δτ;
            Body.Position[1] += Body.Linear[1] * Δτ;
            Body.Position[2] += Body.Linear[2] * Δτ;
            Body.Orientation = IntegrateQuaternion(Body.Orientation, Body.Angular, Δτ);
            Body.Touching = false;
            Body.Moved = true;
            this.RefreshBody(Body);
        }

        // ② contacts: course, static boxes, pairs, car
        const Contacts = [];
        for (const Body of this.Bodies)
        {
            if (Body.Sleeping)
                continue;
            this.CollectCourseContacts(Body, Contacts);
            this.CollectObstacleContacts(Body, Contacts);
        }
        const Pairs = this.CollectPairContacts(Contacts);
        if (Car)
            this.CollectVehicleContacts(Car, Contacts);

        // ③ impulses, then positional projection
        const Bounce = this.Settings.Bounce, Grip = this.Settings.Friction;
        for (let Iteration = 0; Iteration < Iterations; ++Iteration)
            for (const Contact of Contacts)
                this.ResolveContact(Contact, Iteration === 0, Bounce, Grip, Car);
        for (const Body of this.Bodies)
            Body.Shift = null;
        for (const Contact of Contacts)
            this.ProjectContact(Contact);

        // ④ sleep
        for (const Body of this.Bodies)
        {
            if (Body.Sleeping)
                continue;
            this.RefreshBody(Body);
            // 📝 Calm is judged by speed at the hull, so a 2 cm shard's spin jitter does not keep it awake for ever.
            const Speed = LengthVector(Body.Linear), Spin = LengthVector(Body.Angular) * Math.max(Body.Radius, 0.05);
            const Calm = Speed < SleepSpeed && Spin < SleepSpeed;
            if (Body.Touching && Speed < 3.0 * SleepSpeed && Spin < 3.0 * SleepSpeed)
            {
                // 📝 Resting contact bleeds the last of the motion away — rolling resistance and the friction a pile's
                //    many contacts really have — so a heap of planks settles instead of jostling for ever.
                Body.Angular = ScaleVector(Body.Angular, 0.88);
                Body.Linear = ScaleVector(Body.Linear, 0.92);
            }
            Body.Still = Body.Touching && Calm ? Body.Still + Δτ : 0.0;
            if (Body.Still > SleepSeconds)
            {
                Body.Sleeping = true;
                Body.Linear = [0.0, 0.0, 0.0];
                Body.Angular = [0.0, 0.0, 0.0];
            }
        }
        return { Contacts: Contacts.length, Pairs };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  CONTACTS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Contact: { A (body), B (body, Car or null), Point, Normal (pushes A out of B), Depth, Restitution, Friction }.
    CollectCourseContacts(Body, Contacts)
    {
        const Points = Body.WorldPoints;
        for (let Index = 0; Index < Body.Points.length; ++Index)
        {
            const X = Points[Index * 3], Y = Points[Index * 3 + 1], Z = Points[Index * 3 + 2];
            const Ground = ResolveCourseHeight(X, Y);
            if (Z >= Ground)
                continue;
            const Normal = Ground > 0.0 ? ResolveCourseNormal(X, Y) : [0.0, 0.0, 1.0];
            Contacts.push({ A: Body, B: null, Point: [X, Y, Z], Normal, Depth: (Ground - Z) * Normal[2],
                            Restitution: Body.Restitution, Friction: Body.Friction });
            Body.Touching = true;
        }
    }

    CollectObstacleContacts(Body, Contacts)
    {
        const P = Body.Position, Reach = Body.Radius;
        for (const Box of this.Obstacles)
        {
            if (P[0] + Reach < Box.Minimum[0] || P[0] - Reach > Box.Maximum[0] || P[1] + Reach < Box.Minimum[1] ||
                P[1] - Reach > Box.Maximum[1] || P[2] + Reach < Box.Minimum[2] || P[2] - Reach > Box.Maximum[2])
                continue;
            // ① hull points inside the box leave through its nearest face
            const Points = Body.WorldPoints;
            for (let Index = 0; Index < Body.Points.length; ++Index)
            {
                const X = Points[Index * 3], Y = Points[Index * 3 + 1], Z = Points[Index * 3 + 2];
                if (X <= Box.Minimum[0] || X >= Box.Maximum[0] || Y <= Box.Minimum[1] || Y >= Box.Maximum[1] ||
                    Z <= Box.Minimum[2] || Z >= Box.Maximum[2])
                    continue;
                const Exits = [X - Box.Minimum[0], Box.Maximum[0] - X, Y - Box.Minimum[1], Box.Maximum[1] - Y, Z - Box.Minimum[2], Box.Maximum[2] - Z];
                let Face = 0;
                for (let Candidate = 1; Candidate < 6; ++Candidate)
                    if (Exits[Candidate] < Exits[Face])
                        Face = Candidate;
                const Normal = [0.0, 0.0, 0.0];
                Normal[Face >> 1] = (Face & 1) ? 1.0 : -1.0;
                Contacts.push({ A: Body, B: null, Point: [X, Y, Z], Normal, Depth: Exits[Face], Restitution: Body.Restitution, Friction: Body.Friction });
                Body.Touching = true;
            }
            // ② box corners inside the hull push the hull off them (a slab landing across a barrier's edge)
            if (Body.Radius > 0.25)
            {
                for (let Corner = 0; Corner < 8; ++Corner)
                {
                    const C = [(Corner & 1) ? Box.Maximum[0] : Box.Minimum[0], (Corner & 2) ? Box.Maximum[1] : Box.Minimum[1],
                               (Corner & 4) ? Box.Maximum[2] : Box.Minimum[2]];
                    const Inside = this.MeasureInside(Body, C);
                    if (!Inside)
                        continue;
                    Contacts.push({ A: Body, B: null, Point: C, Normal: ScaleVector(Inside.Normal, -1.0), Depth: Inside.Depth,
                                    Restitution: Body.Restitution, Friction: Body.Friction });
                    Body.Touching = true;
                }
            }
        }
    }

    // 📝 The deepest plane a world point is behind, or null when it is outside the hull: { Normal (out of the hull),
    //    Depth }. For a convex hull, inside means behind every plane, and the least-negative plane is the way out.
    MeasureInside(Body, Point)
    {
        const Planes = Body.WorldPlanes;
        let Best = -Infinity, BestIndex = -1;
        for (let Index = 0; Index < Body.Planes.length; ++Index)
        {
            const Distance = Planes[Index * 4] * Point[0] + Planes[Index * 4 + 1] * Point[1] + Planes[Index * 4 + 2] * Point[2] - Planes[Index * 4 + 3];
            if (Distance >= 0.0)
                return null;
            if (Distance > Best)
            {
                Best = Distance;
                BestIndex = Index;
            }
        }
        if (BestIndex < 0)
            return null;
        return { Normal: [Planes[BestIndex * 4], Planes[BestIndex * 4 + 1], Planes[BestIndex * 4 + 2]], Depth: -Best };
    }

    // 📝 The signed distance-like value of a point against a hull: the largest plane distance (exact inside, a lower
    //    bound outside) and that plane's normal.
    MeasureSeparation(Body, Point)
    {
        const Planes = Body.WorldPlanes;
        let Best = -Infinity, BestIndex = 0;
        for (let Index = 0; Index < Body.Planes.length; ++Index)
        {
            const Distance = Planes[Index * 4] * Point[0] + Planes[Index * 4 + 1] * Point[1] + Planes[Index * 4 + 2] * Point[2] - Planes[Index * 4 + 3];
            if (Distance > Best)
            {
                Best = Distance;
                BestIndex = Index;
            }
        }
        return { Distance: Best, Normal: [Planes[BestIndex * 4], Planes[BestIndex * 4 + 1], Planes[BestIndex * 4 + 2]] };
    }

    // 📝 Uniform grid over bounding spheres; each pair with at least one awake body is tested both ways.
    CollectPairContacts(Contacts)
    {
        const Grid = new Map();
        const Key = (X, Y, Z) => ((X + 512) * 1024 + (Y + 512)) * 1024 + (Z + 64);
        for (let Index = 0; Index < this.Bodies.length; ++Index)
        {
            const Body = this.Bodies[Index];
            const P = Body.Position, R = Body.Radius;
            const X0 = Math.floor((P[0] - R) / CellExtent), X1 = Math.floor((P[0] + R) / CellExtent);
            const Y0 = Math.floor((P[1] - R) / CellExtent), Y1 = Math.floor((P[1] + R) / CellExtent);
            const Z0 = Math.floor((P[2] - R) / CellExtent), Z1 = Math.floor((P[2] + R) / CellExtent);
            for (let X = X0; X <= X1; ++X)
                for (let Y = Y0; Y <= Y1; ++Y)
                    for (let Z = Z0; Z <= Z1; ++Z)
                    {
                        const Cell = Key(X, Y, Z);
                        const List = Grid.get(Cell);
                        if (List)
                            List.push(Index);
                        else
                            Grid.set(Cell, [Index]);
                    }
        }
        const Seen = new Set();
        let Pairs = 0;
        for (const List of Grid.values())
        {
            if (List.length < 2)
                continue;
            for (let First = 0; First < List.length; ++First)
            {
                for (let Second = First + 1; Second < List.length; ++Second)
                {
                    const A = this.Bodies[List[First]], B = this.Bodies[List[Second]];
                    if (A.Sleeping && B.Sleeping)
                        continue;
                    const PairKey = A.Id < B.Id ? A.Id * 65536 + B.Id : B.Id * 65536 + A.Id;
                    if (Seen.has(PairKey))
                        continue;
                    Seen.add(PairKey);
                    const DX = B.Position[0] - A.Position[0], DY = B.Position[1] - A.Position[1], DZ = B.Position[2] - A.Position[2];
                    const Reach = A.Radius + B.Radius;
                    if (DX * DX + DY * DY + DZ * DZ >= Reach * Reach)
                        continue;
                    // 📝 A plane of either hull with the other's bounding sphere wholly outside it separates them.
                    if (this.SeparatedBy(A, B) || this.SeparatedBy(B, A))
                        continue;
                    Pairs++;
                    this.CollectHullContacts(A, B, Contacts);
                    this.CollectHullContacts(B, A, Contacts);
                }
            }
        }
        return Pairs;
    }

    SeparatedBy(Hull, Other)
    {
        const Planes = Hull.WorldPlanes, P = Other.Position, R = Other.Radius;
        for (let Index = 0; Index < Hull.Planes.length; ++Index)
            if (Planes[Index * 4] * P[0] + Planes[Index * 4 + 1] * P[1] + Planes[Index * 4 + 2] * P[2] - Planes[Index * 4 + 3] > R)
                return true;
        return false;
    }

    // 📝 A's contact samples inside B: at most the four deepest, so a face lying flat on a face gives a stable
    //    manifold. Samples are the hull's corners, edge midpoints and face points — corners alone miss two equal
    //    boxes stacked a little turned, whose corners all stick out past each other. The awake body is always the
    //    contact's A: a sleeping body is immovable until a fast enough approach wakes it.
    CollectHullContacts(A, B, Contacts)
    {
        const Found = [];
        const Points = A.WorldSamples;
        const Point = [0.0, 0.0, 0.0];
        const Swap = A.Sleeping;
        for (let Index = 0; Index < A.Samples.length; ++Index)
        {
            Point[0] = Points[Index * 3]; Point[1] = Points[Index * 3 + 1]; Point[2] = Points[Index * 3 + 2];
            const Inside = this.MeasureInside(B, Point);
            if (!Inside)
                continue;
            Found.push({ A: Swap ? B : A, B: Swap ? A : B, Point: Point.slice(), Normal: Swap ? ScaleVector(Inside.Normal, -1.0) : Inside.Normal,
                         Depth: Inside.Depth, Restitution: Math.min(A.Restitution, B.Restitution), Friction: Math.sqrt(A.Friction * B.Friction) });
        }
        if (Found.length === 0)
            return;
        for (const Contact of ReduceManifold(Found, 6))
            Contacts.push(Contact);
        A.Touching = B.Touching = true;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   THE CAR
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 The car as a body for this frame: its pose is fixed (it already stepped), its velocities are not.
    ConstructVehicleProxy(Vehicle)
    {
        const Spheres = HullSpheres.map(([X, Y, Z, Radius]) => ({ Local: [X, Y, Z], Radius, Wheel: -1 }));
        for (let Wheel = 0; Wheel < 4; ++Wheel)
        {
            const Hub = Vehicle.QueryWheelTransform(Wheel).slice(12, 15);
            const Local = RotateVector(ConjugateQuaternion(Vehicle.Orientation), SubtractVector(Hub, Vehicle.Position));
            Spheres.push({ Local, Radius: VehicleGeometry.TyreRadius * 0.92, Wheel });
        }
        for (const Sphere of Spheres)
            Sphere.Centre = AddVector(Vehicle.Position, RotateVector(Vehicle.Orientation, Sphere.Local));
        return {
            IsCar: true,
            Position: Vehicle.Position.slice(),
            Orientation: Vehicle.Orientation.slice(),
            Linear: Vehicle.LinearVelocity.slice(),
            Angular: Vehicle.AngularVelocity.slice(),
            InverseMass: 1.0 / VehicleGeometry.Mass,
            Spheres,
            Supported: new Set(Vehicle.Wheels.map((Wheel) => Wheel.SupportBody).filter(Boolean)),
            StartLinear: Vehicle.LinearVelocity.slice(),
            StartAngular: Vehicle.AngularVelocity.slice()
        };
    }

    ReturnVehicleProxy(Car, Vehicle)
    {
        // 📝 Hand back only the change, so anything else that touched the velocities this frame is kept.
        Vehicle.LinearVelocity = AddVector(Vehicle.LinearVelocity, SubtractVector(Car.Linear, Car.StartLinear));
        Vehicle.AngularVelocity = AddVector(Vehicle.AngularVelocity, SubtractVector(Car.Angular, Car.StartAngular));
    }

    CarInverseInertia(Car, Vector)
    {
        const Body = RotateVector(ConjugateQuaternion(Car.Orientation), Vector);
        const I = this.VehicleInertia;
        return RotateVector(Car.Orientation, [Body[0] / I[0], Body[1] / I[1], Body[2] / I[2]]);
    }

    CollectVehicleContacts(Car, Contacts)
    {
        for (const Body of this.Bodies)
        {
            const DX = Body.Position[0] - Car.Position[0], DY = Body.Position[1] - Car.Position[1], DZ = Body.Position[2] - Car.Position[2];
            const Reach = VehicleReach + Body.Radius;
            if (DX * DX + DY * DY + DZ * DZ >= Reach * Reach)
                continue;
            let Touched = false;
            for (const Sphere of Car.Spheres)
            {
                const Centre = Sphere.Centre;
                const SX = Body.Position[0] - Centre[0], SY = Body.Position[1] - Centre[1], SZ = Body.Position[2] - Centre[2];
                const Near = Sphere.Radius + Body.Radius;
                if (SX * SX + SY * SY + SZ * SZ >= Near * Near)
                    continue;
                // 📝 A wheel riding on this body (QuerySupport) does not also shove it, nor does it strike a pebble.
                if (Sphere.Wheel >= 0 && (Car.Supported.has(Body) || Body.Radius < PebbleRadius))
                    continue;
                // 📝 The sphere against the hull's planes. The largest plane distance is exact inside and a lower bound
                //    outside, so when it reaches the radius no point of the hull can be inside the sphere either.
                const Separation = this.MeasureSeparation(Body, Centre);
                if (Separation.Distance >= Sphere.Radius)
                    continue;
                const Depth = Sphere.Radius - Separation.Distance;
                const Point = MultiplyAddVector(Centre, Separation.Normal, -Math.max(0.0, Separation.Distance));
                Contacts.push({ A: Body, B: Car, Point, Normal: ScaleVector(Separation.Normal, -1.0), Depth: Math.min(Depth, 0.25),
                                Restitution: 0.25 * Body.Restitution, Friction: 0.5, Sphere });
                Touched = true;
            }
            if (Touched)
                Body.Touching = true;
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 RESOLUTION
    //--------------------------------------------------------------------------------------------------------------------

    InverseInertiaWorld(Body, Vector)
    {
        const R = Body.Rotation, I = Body.InverseInertia;
        // 📐 R · I⁻¹ · Rᵀ · v
        const BX = R[0] * Vector[0] + R[3] * Vector[1] + R[6] * Vector[2];
        const BY = R[1] * Vector[0] + R[4] * Vector[1] + R[7] * Vector[2];
        const BZ = R[2] * Vector[0] + R[5] * Vector[1] + R[8] * Vector[2];
        const SX = BX * I[0], SY = BY * I[1], SZ = BZ * I[2];
        return [R[0] * SX + R[1] * SY + R[2] * SZ, R[3] * SX + R[4] * SY + R[5] * SZ, R[6] * SX + R[7] * SY + R[8] * SZ];
    }

    // 📝 A sleeping B is immovable unless the approach is fast enough to wake it — so a settled pile holds its shape
    //    under a resting piece and comes apart under a real hit.
    ResolveContact(Contact, First, Bounce, Grip, Car)
    {
        const A = Contact.A, B = Contact.B;
        const Normal = Contact.Normal;
        const LeverA = SubtractVector(Contact.Point, A.Position);
        let VelocityA = AddVector(A.Linear, CrossVector(A.Angular, LeverA));
        let VelocityB = [0.0, 0.0, 0.0], LeverB = null, Dynamic = false;
        if (B)
        {
            LeverB = SubtractVector(Contact.Point, B.Position);
            VelocityB = AddVector(B.Linear, CrossVector(B.Angular, LeverB));
            Dynamic = B.IsCar || !B.Sleeping;
        }
        if (A.Sleeping)
        {
            // 📝 Only the car reaches a sleeping A. A slow touch (the car resting on settled debris) leaves the body
            //    asleep and immovable, and only the car takes the impulse; a real approach wakes it.
            const Approach = DotVector(SubtractVector(VelocityA, VelocityB), Normal);
            if (B && B.IsCar && -Approach < WakeSpeed)
            {
                this.ResolveAgainstSleeper(Contact, B, LeverB, VelocityB, Approach, Grip);
                return;
            }
            this.Wake(A);
        }
        if (B && !B.IsCar && B.Sleeping)
        {
            const Approach = -DotVector(SubtractVector(VelocityA, VelocityB), Normal);
            if (Approach > WakeSpeed)
            {
                this.Wake(B);
                Dynamic = true;
            }
        }
        const Relative = SubtractVector(VelocityA, VelocityB);
        const Approach = DotVector(Relative, Normal);
        if (Approach >= 0.0)
            return;
        const AngularA = CrossVector(this.InverseInertiaWorld(A, CrossVector(LeverA, Normal)), LeverA);
        let Effective = A.InverseMass + DotVector(Normal, AngularA);
        let AngularB = null;
        if (Dynamic)
        {
            AngularB = B.IsCar ? CrossVector(this.CarInverseInertia(B, CrossVector(LeverB, Normal)), LeverB)
                               : CrossVector(this.InverseInertiaWorld(B, CrossVector(LeverB, Normal)), LeverB);
            Effective += B.InverseMass + DotVector(Normal, AngularB);
        }
        const Restitution = First && Approach < -BounceSpeed ? Contact.Restitution * Bounce : 0.0;
        const Impulse = -(1.0 + Restitution) * Approach / Effective;
        this.ApplyImpulse(A, B, Dynamic, LeverA, LeverB, ScaleVector(Normal, Impulse));

        // 📐 Coulomb friction against the post-impulse tangential slip, capped at μ · jₙ.
        const AfterA = AddVector(A.Linear, CrossVector(A.Angular, LeverA));
        const AfterB = Dynamic ? AddVector(B.Linear, CrossVector(B.Angular, LeverB)) : VelocityB;
        const Slip = SubtractVector(AfterA, AfterB);
        const Tangential = SubtractVector(Slip, ScaleVector(Normal, DotVector(Slip, Normal)));
        const Speed = LengthVector(Tangential);
        if (Speed < 1.0e-5)
            return;
        const Direction = ScaleVector(Tangential, 1.0 / Speed);
        let TangentEffective = A.InverseMass + DotVector(Direction, CrossVector(this.InverseInertiaWorld(A, CrossVector(LeverA, Direction)), LeverA));
        if (Dynamic)
            TangentEffective += B.InverseMass + DotVector(Direction, B.IsCar ? CrossVector(this.CarInverseInertia(B, CrossVector(LeverB, Direction)), LeverB)
                                                                              : CrossVector(this.InverseInertiaWorld(B, CrossVector(LeverB, Direction)), LeverB));
        const Friction = Math.min(Speed / TangentEffective, Contact.Friction * Grip * Impulse);
        this.ApplyImpulse(A, B, Dynamic, LeverA, LeverB, ScaleVector(Direction, -Friction));
    }

    // 📝 The car against a body that stays asleep: the body is a fixed surface for this contact, so the impulse that
    //    stops the approach (and its friction) goes to the car alone.
    ResolveAgainstSleeper(Contact, Car, LeverB, VelocityB, Approach, Grip)
    {
        if (Approach >= 0.0)
            return;
        const Normal = Contact.Normal;
        const Angular = CrossVector(this.CarInverseInertia(Car, CrossVector(LeverB, Normal)), LeverB);
        const Effective = Car.InverseMass + DotVector(Normal, Angular);
        const Impulse = -Approach / Effective;
        const Push = ScaleVector(Normal, -Impulse);
        Car.Linear = MultiplyAddVector(Car.Linear, Push, Car.InverseMass);
        Car.Angular = AddVector(Car.Angular, this.CarInverseInertia(Car, CrossVector(LeverB, Push)));
        const After = AddVector(Car.Linear, CrossVector(Car.Angular, LeverB));
        const Tangential = SubtractVector(After, ScaleVector(Normal, DotVector(After, Normal)));
        const Speed = LengthVector(Tangential);
        if (Speed < 1.0e-5)
            return;
        const Direction = ScaleVector(Tangential, 1.0 / Speed);
        const TangentEffective = Car.InverseMass + DotVector(Direction, CrossVector(this.CarInverseInertia(Car, CrossVector(LeverB, Direction)), LeverB));
        const Friction = ScaleVector(Direction, -Math.min(Speed / TangentEffective, Contact.Friction * Grip * Impulse));
        Car.Linear = MultiplyAddVector(Car.Linear, Friction, Car.InverseMass);
        Car.Angular = AddVector(Car.Angular, this.CarInverseInertia(Car, CrossVector(LeverB, Friction)));
    }

    ApplyImpulse(A, B, Dynamic, LeverA, LeverB, Impulse)
    {
        A.Linear = MultiplyAddVector(A.Linear, Impulse, A.InverseMass);
        A.Angular = AddVector(A.Angular, this.InverseInertiaWorld(A, CrossVector(LeverA, Impulse)));
        if (!Dynamic)
            return;
        const Opposite = ScaleVector(Impulse, -1.0);
        B.Linear = MultiplyAddVector(B.Linear, Opposite, B.InverseMass);
        B.Angular = AddVector(B.Angular, B.IsCar ? this.CarInverseInertia(B, CrossVector(LeverB, Opposite))
                                                 : this.InverseInertiaWorld(B, CrossVector(LeverB, Opposite)));
    }

    // 📝 Split projection by inverse mass; the car and sleeping bodies do not move, so A takes all of it there. Each
    //    contact sees the penetration left after the pushes already made this pass (Shift), so the four contacts of
    //    a face resting on a face remove its depth once, not four times.
    ProjectContact(Contact)
    {
        const A = Contact.A, B = Contact.B;
        if (A.Sleeping)
            return;
        const Movable = B && !B.IsCar && !B.Sleeping;
        const ShiftA = A.Shift || [0.0, 0.0, 0.0], ShiftB = (Movable && B.Shift) || [0.0, 0.0, 0.0];
        const Remaining = Contact.Depth - DotVector(SubtractVector(ShiftA, ShiftB), Contact.Normal);
        const Excess = Remaining - Slop;
        if (Excess <= 0.0)
            return;
        const Share = Movable ? A.InverseMass / (A.InverseMass + B.InverseMass) : 1.0;
        const Push = Math.min(Excess * Projection, 0.08);
        A.Position = MultiplyAddVector(A.Position, Contact.Normal, Push * Share);
        A.Shift = MultiplyAddVector(ShiftA, Contact.Normal, Push * Share);
        if (Movable)
        {
            B.Position = MultiplyAddVector(B.Position, Contact.Normal, -Push * (1.0 - Share));
            B.Shift = MultiplyAddVector(ShiftB, Contact.Normal, -Push * (1.0 - Share));
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              DRIVING OVER DEBRIS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Heavy bodies within reach of the car: the candidates QuerySupport walks during the next vehicle step.
    RefreshSupport(Vehicle)
    {
        this.Support = [];
        if (!Vehicle)
            return;
        for (const Body of this.Bodies)
        {
            if (!Body.Carries)
                continue;
            const DX = Body.Position[0] - Vehicle.Position[0], DY = Body.Position[1] - Vehicle.Position[1];
            const Reach = 3.4 + Body.Radius;
            if (DX * DX + DY * DY < Reach * Reach)
                this.Support.push(Body);
        }
    }

    // 📝 The highest hull top under (x, y) below Ceiling, or null: { Height, Normal, Body }. A vertical line through a
    //    convex hull enters through the plane whose bound on the line parameter is the smallest upper bound.
    QuerySupport(X, Y, Ceiling)
    {
        let Best = null;
        for (const Body of this.Support)
        {
            const DX = X - Body.Position[0], DY = Y - Body.Position[1];
            if (DX * DX + DY * DY > Body.Radius * Body.Radius)
                continue;
            const Planes = Body.WorldPlanes;
            let Top = Infinity, Bottom = -Infinity, TopIndex = -1;
            for (let Index = 0; Index < Body.Planes.length; ++Index)
            {
                const NX = Planes[Index * 4], NY = Planes[Index * 4 + 1], NZ = Planes[Index * 4 + 2], D = Planes[Index * 4 + 3];
                const Rest = D - NX * X - NY * Y;
                if (Math.abs(NZ) < 1.0e-6)
                {
                    if (Rest < 0.0)
                    {
                        Top = -Infinity;
                        break;
                    }
                    continue;
                }
                const Bound = Rest / NZ;
                if (NZ > 0.0)
                {
                    if (Bound < Top)
                    {
                        Top = Bound;
                        TopIndex = Index;
                    }
                }
                else if (Bound > Bottom)
                {
                    Bottom = Bound;
                }
            }
            if (TopIndex < 0 || Top < Bottom || Top > Ceiling)
                continue;
            if (!Best || Top > Best.Height)
                Best = { Height: Top, Normal: [Planes[TopIndex * 4], Planes[TopIndex * 4 + 1], Planes[TopIndex * 4 + 2]], Body };
        }
        return Best;
    }

    // 📝 The wheels' load on the bodies they rode this frame, as impulses down the contact normal (the vehicle solver
    //    accumulates load·Δτ per wheel); a body under a wheel is pressed into the course and stays put.
    ApplySupportLoads(Vehicle)
    {
        for (const Body of this.Bodies)
            Body.Pressed = false;
        if (!Vehicle)
            return;
        for (const Wheel of Vehicle.Wheels)
        {
            const Body = Wheel.SupportBody;
            const Impulse = Wheel.SupportImpulse;
            Wheel.SupportImpulse = [0.0, 0.0, 0.0];
            if (!Body || !Impulse || !this.Bodies.includes(Body))
                continue;
            // 📝 Pressed into the course, a body cannot sink, so the load's vertical share only pins it (Pressed damps
            //    its motion). The tyre's tangential force drags it: a spinning wheel on a light slab spits it out.
            Body.Pressed = true;
            const Lever = SubtractVector(Wheel.SupportPoint || Body.Position, Body.Position);
            const Tangential = [Impulse[0], Impulse[1], 0.0];
            if (LengthVector(Tangential) * Body.InverseMass > 0.6)
            {
                this.Wake(Body);
                Body.Linear = MultiplyAddVector(Body.Linear, Tangential, Body.InverseMass * 0.5);
                Body.Angular = AddVector(Body.Angular, ScaleVector(this.InverseInertiaWorld(Body, CrossVector(Lever, Tangential)), 0.5));
            }
        }
    }
}

// 📝 Up to Limit contacts of one pair: the deepest, then each next the one farthest from those already kept — a spread
//    manifold, so the impulses of a resting face balance instead of tipping it toward whichever corner came first.
function ReduceManifold(Found, Limit)
{
    if (Found.length <= Limit)
        return Found;
    let Deepest = 0;
    for (let Index = 1; Index < Found.length; ++Index)
        if (Found[Index].Depth > Found[Deepest].Depth)
            Deepest = Index;
    const Kept = [Found[Deepest]];
    const Nearest = Found.map((Contact) => DistanceSquared(Contact.Point, Found[Deepest].Point));
    while (Kept.length < Limit)
    {
        let Farthest = -1, Best = 1.0e-8;
        for (let Index = 0; Index < Found.length; ++Index)
            if (Nearest[Index] > Best)
            {
                Best = Nearest[Index];
                Farthest = Index;
            }
        if (Farthest < 0)
            break;
        Kept.push(Found[Farthest]);
        for (let Index = 0; Index < Found.length; ++Index)
            Nearest[Index] = Math.min(Nearest[Index], DistanceSquared(Found[Index].Point, Found[Farthest].Point));
    }
    return Kept;
}

function DistanceSquared(Left, Right)
{
    const X = Left[0] - Right[0], Y = Left[1] - Right[1], Z = Left[2] - Right[2];
    return X * X + Y * Y + Z * Z;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  HULL CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Face planes [nx, ny, nz, d] (n outward, n·p ≤ d inside) of the convex hull of a small point set, by testing every
//    triple — fine for the two dozen points of a cone hull. Coplanar triples are merged by normal and offset.
export function ConstructHullPlanes(Points, Tolerance = 1.0e-5)
{
    const Planes = [];
    const Count = Points.length;
    for (let I = 0; I < Count; ++I)
        for (let J = I + 1; J < Count; ++J)
            for (let K = J + 1; K < Count; ++K)
            {
                const Normal = CrossVector(SubtractVector(Points[J], Points[I]), SubtractVector(Points[K], Points[I]));
                const Length = LengthVector(Normal);
                if (Length < 1.0e-9)
                    continue;
                let N = ScaleVector(Normal, 1.0 / Length);
                let D = DotVector(N, Points[I]);
                let Above = 0, Below = 0;
                for (const Point of Points)
                {
                    const Distance = DotVector(N, Point) - D;
                    if (Distance > Tolerance)
                        Above++;
                    else if (Distance < -Tolerance)
                        Below++;
                    if (Above && Below)
                        break;
                }
                if (Above && Below)
                    continue;
                if (Above)
                {
                    N = ScaleVector(N, -1.0);
                    D = -D;
                }
                if (!Planes.some((Plane) => Math.abs(Plane[3] - D) < 1.0e-4 && DotVector(Plane, N) > 1.0 - 1.0e-6))
                    Planes.push([N[0], N[1], N[2], D]);
            }
    return Planes;
}

// 📝 Contact samples of a convex hull: its corners, the midpoint of every edge (two points sharing two planes) and
//    every face's centroid — plus, with Inset, the points halfway from each centroid to its face's corners.
export function ConstructContactSamples(Points, Planes, Tolerance = 1.0e-4, Inset = false, Edges = true)
{
    const Samples = Points.map((Point) => Point.slice());
    const Add = (Point) =>
    {
        for (const Sample of Samples)
            if (Math.abs(Sample[0] - Point[0]) < 1.0e-4 && Math.abs(Sample[1] - Point[1]) < 1.0e-4 && Math.abs(Sample[2] - Point[2]) < 1.0e-4)
                return;
        Samples.push(Point);
    };
    const OnPlane = Planes.map((Plane) => Points.map((Point, Index) => (Math.abs(DotVector(Plane, Point) - Plane[3]) < Tolerance ? Index : -1))
                                                 .filter((Index) => Index >= 0));
    for (const Face of OnPlane)
    {
        if (Face.length < 3)
            continue;
        const Centroid = [0.0, 0.0, 0.0];
        for (const Index of Face)
            for (let Axis = 0; Axis < 3; ++Axis)
                Centroid[Axis] += Points[Index][Axis] / Face.length;
        Add(Centroid);
        if (Inset)
            for (const Index of Face)
                Add([0, 1, 2].map((Axis) => 0.5 * (Centroid[Axis] + Points[Index][Axis])));
    }
    for (let I = 0; I < Points.length && Edges; ++I)
        for (let J = I + 1; J < Points.length; ++J)
        {
            let Shared = 0;
            for (const Face of OnPlane)
                if (Face.includes(I) && Face.includes(J))
                    Shared++;
            if (Shared >= 2)
                Add([0, 1, 2].map((Axis) => 0.5 * (Points[I][Axis] + Points[J][Axis])));
        }
    return Samples;
}

// 📝 Face planes of a fragment from its faces (the fracture's polygons), with the Newell normal and the centroid as
//    origin — exact, and as many planes as faces.
export function ResolveFacePlanes(Part, Centroid)
{
    const Planes = [];
    for (const Face of Part.Faces)
    {
        const Indices = Face.Indices;
        let NX = 0.0, NY = 0.0, NZ = 0.0;
        for (let Index = 0; Index < Indices.length; ++Index)
        {
            const Current = Part.Vertices[Indices[Index]], Next = Part.Vertices[Indices[(Index + 1) % Indices.length]];
            NX += (Current[1] - Next[1]) * (Current[2] + Next[2]);
            NY += (Current[2] - Next[2]) * (Current[0] + Next[0]);
            NZ += (Current[0] - Next[0]) * (Current[1] + Next[1]);
        }
        const Length = Math.hypot(NX, NY, NZ);
        if (Length < 1.0e-12)
            continue;
        const Normal = [NX / Length, NY / Length, NZ / Length];
        const Origin = SubtractVector(Part.Vertices[Indices[0]], Centroid);
        Planes.push([Normal[0], Normal[1], Normal[2], DotVector(Normal, Origin)]);
    }
    return Planes;
}

export { NormalizeVector };
