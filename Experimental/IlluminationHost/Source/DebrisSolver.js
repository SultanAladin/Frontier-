//============================================================================================================================================
//                                                             DEBRISSOLVER.JS
//============================================================================================================================================
// 🧩 Point-contact rigid bodies: the stress test's crates, barrels and pylons, and fracture fragments, pushed aside by the ControlVehicle.

// 📝 Each body carries the contact points of its scatter shape (FacetStructure.ConstructScatterShapes) and integrates
//    at a fixed 120 Hz: gravity, sequential impulses at every point under the course height or inside an obstacle box,
//    sphere proxies between bodies, and the vehicle's hull and wheel spheres as kinematic pushers of infinite mass.
//    A body slower than the sleep thresholds for SleepSeconds stops — and a sleeping body costs the GI nothing: its
//    transform is unchanged, so its bricks are not rewritten and its cards fall back to the round-robin refresh.
//    The solver is a load generator for the renderer, not a physics reference; stacks settle as spheres would.
//    A fracture fragment is a body without a shape: it carries its own hull points about its centroid, its mass and
//    its material's restitution and friction (ConstructRigidBody), and its transform places the centroid itself.

import { ResolveCourseHeight, ResolveCourseNormal } from "./CourseStructure.js";
import { AddVector, SubtractVector, ScaleVector, CrossVector, DotVector, LengthVector, MultiplyAddVector, NormalizeVector,
         RotateVector, ConjugateQuaternion, ConstructAxisQuaternion, IntegrateQuaternion, ConstructRigidTransform } from "./TransformProjection.js";

const SubstepSeconds   = 1.0 / 120.0;   // [s]
const MaximumSubsteps  = 4;             // [-]   per advance, so a stalled tab does not spiral
const Gravity          = 9.81;          // [m/s²]
const Restitution      = 0.22;          // [-]
const RestitutionFloor = 1.2;           // [m/s] approach speeds below this do not bounce
const Friction         = 0.6;           // [-]
const SolverSweeps     = 4;             // [-]   impulse sweeps over a body's contacts per substep
const SleepSpeed       = 0.15;          // [m/s]
const SleepSpin        = 0.35;          // [rad/s]
const SleepSeconds     = 0.35;          // [s]
const PairCell         = 2.0;           // [m]   spatial hash cell for body pairs and vehicle queries
const Damping          = 0.02;          // [1/s] air drag on linear and angular velocity
const RestingDamping   = 6.0;           // [1/s] angular damping while three or more points bear — stops a crate rocking forever
const ContactCapacity  = 48;            // [-]   contacts one body may carry in a substep

// 📝 A seeded generator, so a given press of the stress button lays out the same scene every time — a performance
//    comparison between two builds should measure the same occupants.
export function ConstructRandomSequence(Seed)
{
    let Accumulator = Seed >>> 0;
    return () =>
    {
        Accumulator = (Accumulator + 0x6D2B79F5) >>> 0;
        let Word = Accumulator;
        Word = Math.imul(Word ^ (Word >>> 15), Word | 1);
        Word ^= Word + Math.imul(Word ^ (Word >>> 7), Word | 61);
        return ((Word ^ (Word >>> 14)) >>> 0) / 4294967296.0;
    };
}

export class DebrisSolver
{
    constructor(Shapes, Obstacles)
    {
        this.Shapes      = Shapes;
        this.Obstacles   = Obstacles;
        this.Bodies      = [];
        this.Accumulator = 0.0;
        this.AwakeCount  = 0;
        this.SpawnCount  = 0;
        this.Hash        = null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  CONSTRUCTION
    //--------------------------------------------------------------------------------------------------------------------

    ConstructBody(ShapeIndex, Family, Position, Orientation, Dynamic)
    {
        const Shape = this.Shapes[ShapeIndex];
        const [X, Y, Z] = Shape.Extent;
        const Points = Shape.Points.map((Point) => [Point[0], Point[1], Point[2] - Shape.CentreHeight]);
        const Radius = Math.max(...Points.map((Point) => LengthVector(Point)));
        const Body = {
            Shape: ShapeIndex, Family, Dynamic, Occupant: -1,
            Position: Position.slice(), Orientation: Orientation.slice(),
            Linear: [0.0, 0.0, 0.0], Angular: [0.0, 0.0, 0.0],
            InverseMass: 1.0 / Shape.Mass,
            InverseInertia: [12.0 / (Shape.Mass * (Y * Y + Z * Z)), 12.0 / (Shape.Mass * (X * X + Z * Z)), 12.0 / (Shape.Mass * (X * X + Y * Y))],
            Points, Radius,
            ProxyRadius: 0.5 * Math.min(X, Y, Z),
            Asleep: !Dynamic, SleepTimer: 0.0, Stirred: 2
        };
        Body.Transform = this.ProjectTransform(Body);
        this.Bodies.push(Body);
        return Body;
    }

    // 📝 Rigid bodies dropped from 3–14 m over a disc around Centre, tumbling, so they rain down and settle.
    SpawnDropped(Count, Centre)
    {
        const Random = ConstructRandomSequence(0x51A7E + 7919 * this.SpawnCount++);
        const Reach = 8.0 + 20.0 * Math.sqrt(Math.min(1.0, (this.Bodies.length + Count) / 1024.0));
        for (let Index = 0; Index < Count; ++Index)
        {
            const Angle = Random() * 2.0 * Math.PI;
            const Distance = 4.0 + Math.sqrt(Random()) * Reach;
            const Position = [Centre[0] + Math.cos(Angle) * Distance, Centre[1] + Math.sin(Angle) * Distance, 3.0 + Random() * 11.0];
            const Axis = NormalizeVector([Random() - 0.5, Random() - 0.5, Random() - 0.5]);
            const ShapeIndex = Math.min(this.Shapes.length - 1, Math.floor(Random() * this.Shapes.length));
            const Families = this.Shapes[ShapeIndex].Families;
            const Body = this.ConstructBody(ShapeIndex, Families[Math.floor(Random() * Families.length) % Families.length], Position,
                                            ConstructAxisQuaternion(Axis, Random() * 2.0 * Math.PI), true);
            Body.Linear  = [(Random() - 0.5) * 3.0, (Random() - 0.5) * 3.0, -Random() * 2.0];
            Body.Angular = [(Random() - 0.5) * 6.0, (Random() - 0.5) * 6.0, (Random() - 0.5) * 6.0];
            Body.Asleep  = false;
        }
    }

    // 📝 Static props laid on the course in a jittered lattice around Centre, kept off the car and the obstacles.
    SpawnPlaced(Count, Centre)
    {
        const Random = ConstructRandomSequence(0xC0FFEE + 104729 * this.SpawnCount++);
        const Spacing = 2.6;
        let Placed = 0, Ring = 2;
        const Occupied = new Set(this.Bodies.map((Body) => `${Math.round(Body.Position[0] / Spacing)},${Math.round(Body.Position[1] / Spacing)}`));
        while (Placed < Count && Ring < 80)
        {
            for (let Step = 0; Step < 8 * Ring && Placed < Count; ++Step)
            {
                const Side = Math.floor(Step / (2 * Ring)), Along = Step % (2 * Ring) - Ring;
                const Cell = [[Along, -Ring], [Ring, Along], [-Along, Ring], [-Ring, -Along]][Side];
                const CellX = Math.round(Centre[0] / Spacing) + Cell[0], CellY = Math.round(Centre[1] / Spacing) + Cell[1];
                const Key = `${CellX},${CellY}`;
                if (Occupied.has(Key))
                    continue;
                const X = CellX * Spacing + (Random() - 0.5) * 0.8, Y = CellY * Spacing + (Random() - 0.5) * 0.8;
                if (this.Obstacles.some((Box) => X > Box.Minimum[0] - 1.2 && X < Box.Maximum[0] + 1.2 && Y > Box.Minimum[1] - 1.2 && Y < Box.Maximum[1] + 1.2))
                    continue;
                Occupied.add(Key);
                const ShapeIndex = Math.min(this.Shapes.length - 1, Math.floor(Random() * this.Shapes.length));
                const Shape = this.Shapes[ShapeIndex];
                const Ground = ResolveCourseHeight(X, Y);
                this.ConstructBody(ShapeIndex, Shape.Families[Math.floor(Random() * Shape.Families.length) % Shape.Families.length],
                                   [X, Y, Ground + Shape.CentreHeight], ConstructAxisQuaternion([0.0, 0.0, 1.0], Random() * Math.PI), false);
                ++Placed;
            }
            ++Ring;
        }
        return Placed;
    }

    Clear()
    {
        this.Bodies = [];
        this.AwakeCount = 0;
        this.Hash = null;
    }

    // 📝 Wakes every rigid body and lifts it back into the air, for a second fall without re-allocating the scene.
    WakeAll(Centre)
    {
        const Random = ConstructRandomSequence(0xBADA55 + this.SpawnCount++);
        for (const Body of this.Bodies)
        {
            if (!Body.Dynamic)
                continue;
            Body.Position[2] += 4.0 + Random() * 8.0;
            Body.Linear = [(Random() - 0.5) * 4.0 + (Body.Position[0] - Centre[0]) * 0.05, (Random() - 0.5) * 4.0 + (Body.Position[1] - Centre[1]) * 0.05, 0.0];
            Body.Angular = [(Random() - 0.5) * 6.0, (Random() - 0.5) * 6.0, (Random() - 0.5) * 6.0];
            Body.Asleep = false;
            Body.SleepTimer = 0.0;
        }
    }

    // 📝 A fragment: Description { Points about the centroid, Mass, Extent, Restitution, Friction }. Returns the body.
    ConstructRigidBody(Description, Family, Position, Orientation, Linear = [0.0, 0.0, 0.0], Angular = [0.0, 0.0, 0.0])
    {
        const [X, Y, Z] = Description.Extent.map((Length) => Math.max(Length, 0.01));
        const Mass = Description.Mass;
        const Body = {
            Shape: -1, Family, Dynamic: true, Occupant: -1,
            Position: Position.slice(), Orientation: Orientation.slice(),
            Linear: Linear.slice(), Angular: Angular.slice(),
            InverseMass: 1.0 / Mass,
            InverseInertia: [12.0 / (Mass * (Y * Y + Z * Z)), 12.0 / (Mass * (X * X + Z * Z)), 12.0 / (Mass * (X * X + Y * Y))],
            Points: Description.Points.map((Point) => Point.slice()),
            Radius: Math.max(...Description.Points.map((Point) => LengthVector(Point))),
            ProxyRadius: Math.max(0.015, 0.42 * Math.min(X, Y, Z)),
            Restitution: Description.Restitution, Friction: Description.Friction,
            Asleep: false, SleepTimer: 0.0, Stirred: 2
        };
        Body.Transform = this.ProjectTransform(Body);
        this.Bodies.push(Body);
        return Body;
    }

    ProjectTransform(Body)
    {
        if (Body.Shape < 0)
            return ConstructRigidTransform(Body.Position, Body.Orientation);
        const Lift = RotateVector(Body.Orientation, [0.0, 0.0, this.Shapes[Body.Shape].CentreHeight]);
        return ConstructRigidTransform(SubtractVector(Body.Position, Lift), Body.Orientation);
    }

    // 📝 World bounds of a static prop, for the vehicle's obstacle boxes.
    QueryPropBounds(Body)
    {
        const Corners = Body.Points.map((Point) => AddVector(Body.Position, RotateVector(Body.Orientation, Point)));
        return {
            Minimum: [0, 1, 2].map((Axis) => Math.min(...Corners.map((Corner) => Corner[Axis]))),
            Maximum: [0, 1, 2].map((Axis) => Math.max(...Corners.map((Corner) => Corner[Axis])))
        };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  INTEGRATION
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Advances the awake bodies; Pushers are world spheres { Centre, Radius, Velocity } of the vehicle. Returns the
    //    bodies whose transform changed this advance.
    Advance(Seconds, Pushers)
    {
        const Moved = [];
        if (this.Bodies.length === 0)
            return Moved;
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), SubstepSeconds * MaximumSubsteps);
        let Stepped = false;
        while (this.Accumulator >= SubstepSeconds)
        {
            this.Step(SubstepSeconds, Pushers);
            this.Accumulator -= SubstepSeconds;
            Stepped = true;
        }
        this.AwakeCount = 0;
        for (const Body of this.Bodies)
        {
            if (!Body.Dynamic)
                continue;
            if (!Body.Asleep)
                this.AwakeCount++;
            if (Stepped && (!Body.Asleep || Body.JustSlept))
            {
                Body.Transform = this.ProjectTransform(Body);
                Moved.push(Body);
                Body.JustSlept = false;
            }
        }
        return Moved;
    }

    Step(Δτ, Pushers)
    {
        const Awake = this.Bodies.filter((Body) => Body.Dynamic && !Body.Asleep);
        // 📝 The pair hash is rebuilt only while something moves; a settled scene answers the vehicle from the last one.
        if (!this.Hash || Awake.length > 0)
            this.Hash = this.ConstructPairHash();
        const Hash = this.Hash;
        this.ResolvePushers(Pushers, Hash);
        for (const Body of Awake)
        {
            Body.Linear[2] -= Gravity * Δτ;
            const Drag = Math.max(0.0, 1.0 - Damping * Δτ);
            Body.Linear = ScaleVector(Body.Linear, Drag);
            Body.Angular = ScaleVector(Body.Angular, Drag);
            this.ResolvePointContacts(Body, Δτ);
        }
        this.ResolvePairs(Hash);
        for (const Body of Awake)
        {
            Body.Position = MultiplyAddVector(Body.Position, Body.Linear, Δτ);
            Body.Orientation = IntegrateQuaternion(Body.Orientation, Body.Angular, Δτ);
            const Calm = LengthVector(Body.Linear) < SleepSpeed && LengthVector(Body.Angular) < SleepSpin;
            Body.SleepTimer = Calm ? Body.SleepTimer + Δτ : 0.0;
            if (Body.SleepTimer > SleepSeconds || Body.Position[2] < -20.0)
            {
                Body.Asleep = true;
                Body.JustSlept = true;
                Body.Linear = [0.0, 0.0, 0.0];
                Body.Angular = [0.0, 0.0, 0.0];
            }
        }
    }

    ApplyImpulse(Body, Impulse, Lever)
    {
        Body.Linear = MultiplyAddVector(Body.Linear, Impulse, Body.InverseMass);
        Body.Angular = AddVector(Body.Angular, this.ProjectInverseInertia(Body, CrossVector(Lever, Impulse)));
    }

    ProjectInverseInertia(Body, Vector)
    {
        const Local = RotateVector(ConjugateQuaternion(Body.Orientation), Vector);
        return RotateVector(Body.Orientation, [Local[0] * Body.InverseInertia[0], Local[1] * Body.InverseInertia[1], Local[2] * Body.InverseInertia[2]]);
    }

    // 📝 Every contact point below the course height or inside an obstacle box: a restitution-and-friction impulse
    //    at the point, swept SolverSweeps times, then the body is lifted out by its deepest penetration. Scalar
    //    arithmetic over preallocated contact lanes, and only the obstacle boxes the body's sphere overlaps — at a
    //    thousand falling bodies this loop is the solver's whole cost.
    ResolvePointContacts(Body, Δτ)
    {
        const Lanes = this.ContactLanes || (this.ContactLanes = new Float64Array(ContactCapacity * 7));
        const [Qx, Qy, Qz, Qw] = Body.Orientation;
        const R00 = 1 - 2 * (Qy * Qy + Qz * Qz), R01 = 2 * (Qx * Qy - Qz * Qw), R02 = 2 * (Qx * Qz + Qy * Qw);
        const R10 = 2 * (Qx * Qy + Qz * Qw), R11 = 1 - 2 * (Qx * Qx + Qz * Qz), R12 = 2 * (Qy * Qz - Qx * Qw);
        const R20 = 2 * (Qx * Qz - Qy * Qw), R21 = 2 * (Qy * Qz + Qx * Qw), R22 = 1 - 2 * (Qx * Qx + Qy * Qy);
        // 📐 I⁻¹ in world: R · diag(I⁻¹_body) · Rᵀ
        const [Ix, Iy, Iz] = Body.InverseInertia;
        const W00 = R00 * R00 * Ix + R01 * R01 * Iy + R02 * R02 * Iz, W01 = R00 * R10 * Ix + R01 * R11 * Iy + R02 * R12 * Iz;
        const W02 = R00 * R20 * Ix + R01 * R21 * Iy + R02 * R22 * Iz, W11 = R10 * R10 * Ix + R11 * R11 * Iy + R12 * R12 * Iz;
        const W12 = R10 * R20 * Ix + R11 * R21 * Iy + R12 * R22 * Iz, W22 = R20 * R20 * Ix + R21 * R21 * Iy + R22 * R22 * Iz;
        const [Px, Py, Pz] = Body.Position;
        const Near = [];
        for (const Box of this.Obstacles)
            if (Px + Body.Radius > Box.Minimum[0] && Px - Body.Radius < Box.Maximum[0] && Py + Body.Radius > Box.Minimum[1] &&
                Py - Body.Radius < Box.Maximum[1] && Pz + Body.Radius > Box.Minimum[2] && Pz - Body.Radius < Box.Maximum[2])
                Near.push(Box);
        let Count = 0, Deepest = -1, DeepestDepth = 0.0;
        const Append = (Rx, Ry, Rz, Nx, Ny, Nz, Depth) =>
        {
            if (Count >= ContactCapacity)
                return;
            const Offset = Count * 7;
            Lanes[Offset] = Rx; Lanes[Offset + 1] = Ry; Lanes[Offset + 2] = Rz;
            Lanes[Offset + 3] = Nx; Lanes[Offset + 4] = Ny; Lanes[Offset + 5] = Nz; Lanes[Offset + 6] = Depth;
            if (Depth > DeepestDepth)
            {
                DeepestDepth = Depth;
                Deepest = Count;
            }
            Count++;
        };
        for (const Local of Body.Points)
        {
            const Rx = R00 * Local[0] + R01 * Local[1] + R02 * Local[2];
            const Ry = R10 * Local[0] + R11 * Local[1] + R12 * Local[2];
            const Rz = R20 * Local[0] + R21 * Local[1] + R22 * Local[2];
            const X = Px + Rx, Y = Py + Ry, Z = Pz + Rz;
            const Ground = ResolveCourseHeight(X, Y);
            if (Z < Ground)
            {
                const Normal = Ground > 0.0 ? ResolveCourseNormal(X, Y) : [0.0, 0.0, 1.0];
                Append(Rx, Ry, Rz, Normal[0], Normal[1], Normal[2], Ground - Z);
            }
            for (const Box of Near)
            {
                if (X <= Box.Minimum[0] || X >= Box.Maximum[0] || Y <= Box.Minimum[1] || Y >= Box.Maximum[1] || Z <= Box.Minimum[2] || Z >= Box.Maximum[2])
                    continue;
                const Exits = [X - Box.Minimum[0], Box.Maximum[0] - X, Y - Box.Minimum[1], Box.Maximum[1] - Y, Z - Box.Minimum[2], Box.Maximum[2] - Z];
                let Face = 0;
                for (let Index = 1; Index < 6; ++Index)
                    if (Exits[Index] < Exits[Face])
                        Face = Index;
                const Sign = (Face & 1) ? 1.0 : -1.0;
                Append(Rx, Ry, Rz, (Face >> 1) === 0 ? Sign : 0.0, (Face >> 1) === 1 ? Sign : 0.0, (Face >> 1) === 2 ? Sign : 0.0, Exits[Face]);
            }
        }
        if (Count === 0)
            return;
        let [Vx, Vy, Vz] = Body.Linear, [Ax, Ay, Az] = Body.Angular;
        const InverseMass = Body.InverseMass;
        const BodyRestitution = Body.Restitution ?? Restitution, BodyFriction = Body.Friction ?? Friction;
        // 📐 Effective inverse mass along a direction d at lever r: 1/m + d · ((I⁻¹ (r × d)) × r)
        const Effective = (Rx, Ry, Rz, Dx, Dy, Dz) =>
        {
            const Cx = Ry * Dz - Rz * Dy, Cy = Rz * Dx - Rx * Dz, Cz = Rx * Dy - Ry * Dx;
            const Jx = W00 * Cx + W01 * Cy + W02 * Cz, Jy = W01 * Cx + W11 * Cy + W12 * Cz, Jz = W02 * Cx + W12 * Cy + W22 * Cz;
            return InverseMass + Dx * (Jy * Rz - Jz * Ry) + Dy * (Jz * Rx - Jx * Rz) + Dz * (Jx * Ry - Jy * Rx);
        };
        const Apply = (Rx, Ry, Rz, Ix, Iy, Iz) =>
        {
            Vx += Ix * InverseMass; Vy += Iy * InverseMass; Vz += Iz * InverseMass;
            const Cx = Ry * Iz - Rz * Iy, Cy = Rz * Ix - Rx * Iz, Cz = Rx * Iy - Ry * Ix;
            Ax += W00 * Cx + W01 * Cy + W02 * Cz; Ay += W01 * Cx + W11 * Cy + W12 * Cz; Az += W02 * Cx + W12 * Cy + W22 * Cz;
        };
        for (let Sweep = 0; Sweep < SolverSweeps; ++Sweep)
        {
            for (let Contact = 0; Contact < Count; ++Contact)
            {
                const Offset = Contact * 7;
                const Rx = Lanes[Offset], Ry = Lanes[Offset + 1], Rz = Lanes[Offset + 2];
                const Nx = Lanes[Offset + 3], Ny = Lanes[Offset + 4], Nz = Lanes[Offset + 5];
                const Ux = Vx + Ay * Rz - Az * Ry, Uy = Vy + Az * Rx - Ax * Rz, Uz = Vz + Ax * Ry - Ay * Rx;
                const Approach = Ux * Nx + Uy * Ny + Uz * Nz;
                if (Approach >= 0.0)
                    continue;
                const Bounce = Sweep === 0 && Approach < -RestitutionFloor ? BodyRestitution : 0.0;
                const Normal = -(1.0 + Bounce) * Approach / Effective(Rx, Ry, Rz, Nx, Ny, Nz);
                let Ix = Nx * Normal, Iy = Ny * Normal, Iz = Nz * Normal;
                const Tx = Ux - Nx * Approach, Ty = Uy - Ny * Approach, Tz = Uz - Nz * Approach;
                const TangentialSpeed = Math.hypot(Tx, Ty, Tz);
                if (TangentialSpeed > 1.0e-5)
                {
                    const Dx = Tx / TangentialSpeed, Dy = Ty / TangentialSpeed, Dz = Tz / TangentialSpeed;
                    const Sliding = Math.min(BodyFriction * Normal, TangentialSpeed / Effective(Rx, Ry, Rz, Dx, Dy, Dz));
                    Ix -= Dx * Sliding; Iy -= Dy * Sliding; Iz -= Dz * Sliding;
                }
                Apply(Rx, Ry, Rz, Ix, Iy, Iz);
            }
        }
        if (Count >= 3)
        {
            const Settle = Math.max(0.0, 1.0 - RestingDamping * Δτ);
            Ax *= Settle; Ay *= Settle; Az *= Settle;
        }
        Body.Linear = [Vx, Vy, Vz];
        Body.Angular = [Ax, Ay, Az];
        const Offset = Deepest * 7;
        Body.Position = [Px + Lanes[Offset + 3] * DeepestDepth * 0.8, Py + Lanes[Offset + 4] * DeepestDepth * 0.8, Pz + Lanes[Offset + 5] * DeepestDepth * 0.8];
        Body.Bearing = Count;
    }

    ConstructPairHash()
    {
        const Hash = new Map();
        this.Bodies.forEach((Body, Index) =>
        {
            const Key = ProjectCellKey(Math.floor(Body.Position[0] / PairCell), Math.floor(Body.Position[1] / PairCell));
            const Occupants = Hash.get(Key);
            if (Occupants)
                Occupants.push(Index);
            else
                Hash.set(Key, [Index]);
        });
        return Hash;
    }

    VisitNearby(Hash, Position, Reach, Visit)
    {
        const LowX = Math.floor((Position[0] - Reach) / PairCell), HighX = Math.floor((Position[0] + Reach) / PairCell);
        const LowY = Math.floor((Position[1] - Reach) / PairCell), HighY = Math.floor((Position[1] + Reach) / PairCell);
        for (let CellY = LowY; CellY <= HighY; ++CellY)
            for (let CellX = LowX; CellX <= HighX; ++CellX)
            {
                const Occupants = Hash.get(ProjectCellKey(CellX, CellY));
                if (Occupants)
                    for (const Index of Occupants)
                        Visit(Index);
            }
    }

    // 📝 Sphere proxies between bodies: positional separation weighted by inverse mass (a sleeping body is fixed
    //    unless struck faster than 1 m/s, which wakes it) and an inelastic impulse along the centre line.
    ResolvePairs(Hash)
    {
        this.Bodies.forEach((Body, Index) =>
        {
            if (!Body.Dynamic || Body.Asleep)
                return;
            this.VisitNearby(Hash, Body.Position, Body.ProxyRadius + 1.0, (Other) =>
            {
                if (Other === Index)
                    return;
                const Target = this.Bodies[Other];
                if (!Target.Asleep && Other < Index)
                    return;
                const Offset = SubtractVector(Target.Position, Body.Position);
                const Distance = LengthVector(Offset);
                const Reach = Body.ProxyRadius + Target.ProxyRadius;
                if (Distance >= Reach || Distance < 1.0e-6)
                    return;
                const Normal = ScaleVector(Offset, 1.0 / Distance);
                const Approach = DotVector(SubtractVector(Body.Linear, Target.Linear), Normal);
                if (Target.Asleep && Target.Dynamic && Approach > 1.0)
                {
                    Target.Asleep = false;
                    Target.SleepTimer = 0.0;
                }
                const TargetInverse = (Target.Asleep || !Target.Dynamic) ? 0.0 : Target.InverseMass;
                const Total = Body.InverseMass + TargetInverse;
                const Overlap = Reach - Distance;
                Body.Position = MultiplyAddVector(Body.Position, Normal, -Overlap * Body.InverseMass / Total * 0.8);
                if (TargetInverse > 0.0)
                    Target.Position = MultiplyAddVector(Target.Position, Normal, Overlap * TargetInverse / Total * 0.8);
                if (Approach > 0.0)
                {
                    const Impulse = Approach / Total * 1.05;
                    Body.Linear = MultiplyAddVector(Body.Linear, Normal, -Impulse * Body.InverseMass);
                    if (TargetInverse > 0.0)
                        Target.Linear = MultiplyAddVector(Target.Linear, Normal, Impulse * TargetInverse);
                }
            });
        });
    }

    // 📝 The vehicle as kinematic spheres of infinite mass: a struck body is pushed out of the sphere, takes the
    //    sphere's point velocity along the normal plus a fraction of its tangential motion, and is spun about the
    //    struck point. Sleeping bodies in reach are woken first.
    ResolvePushers(Pushers, Hash)
    {
        if (!Pushers)
            return;
        for (const Pusher of Pushers)
        {
            this.VisitNearby(Hash, Pusher.Centre, Pusher.Radius + 1.0, (Index) =>
            {
                const Body = this.Bodies[Index];
                if (!Body.Dynamic)
                    return;
                const Offset = SubtractVector(Body.Position, Pusher.Centre);
                const Distance = LengthVector(Offset);
                const Reach = Pusher.Radius + Body.ProxyRadius;
                if (Distance >= Reach || Distance < 1.0e-6)
                    return;
                Body.Asleep = false;
                Body.SleepTimer = 0.0;
                const Normal = ScaleVector(Offset, 1.0 / Distance);
                Body.Position = MultiplyAddVector(Body.Position, Normal, Reach - Distance);
                const Relative = SubtractVector(Body.Linear, Pusher.Velocity);
                const Approach = DotVector(Relative, Normal);
                if (Approach >= 0.0)
                    return;
                const Lever = ScaleVector(Normal, -Body.ProxyRadius);
                const Impulse = ScaleVector(Normal, -(1.0 + 0.3) * Approach / Body.InverseMass);
                const Tangential = SubtractVector(Relative, ScaleVector(Normal, Approach));
                const Drag = ScaleVector(Tangential, -0.35 / Body.InverseMass);
                this.ApplyImpulse(Body, AddVector(Impulse, Drag), Lever);
                Body.Linear[2] = Math.max(Body.Linear[2], 0.6 * Math.min(4.0, -Approach * 0.25));
            });
        }
    }
}

// 📝 Integer cell key for the pair hash — no string is built per body per substep.
function ProjectCellKey(CellX, CellY)
{
    return (CellX + 32768) * 65536 + (CellY + 32768);
}

// 📝 A body is pushed by the vehicle only while that vehicle's spheres overlap it; the spin it is given about the
//    struck point is what makes a crate tumble rather than slide away like a puck.
export function ProjectPusherVelocity(Centre, Position, Linear, Angular)
{
    return AddVector(Linear, CrossVector(Angular, SubtractVector(Centre, Position)));
}

