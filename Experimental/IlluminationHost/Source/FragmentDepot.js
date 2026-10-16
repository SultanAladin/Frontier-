//============================================================================================================================================
//                                                             FRAGMENTDEPOT.JS
//============================================================================================================================================
// 🧩 The yard's breakable props taken apart: per-prop fracture recipes, fragment bodies, their vertex records and one draw, and reassembly.

// 📝 What happens when a prop breaks, struck by the car or from the Fracture editor:
//
//    ① the prop's convex blank is fractured in its own frame (FractureStructure.FracturePart) at the impact point,
//       with the strike's energy — a share of the kinetic energy of the approach — or the recipe's in the editor;
//    ② each part becomes a rigid body in this depot's own debris solver, its mass the prop's mass shared by volume
//       (a crate is hollow, a block is not), thrown with the striking velocity and outward from the impact;
//    ③ the prop's occupant is parked below the course, the bricks it filled are rewritten, its obstacle box goes;
//    ④ the fragment span of the scene is replaced and every fragment's triangles are written once into one vertex
//       buffer that names each fragment by its offset in the span — the surface and shadow passes draw them all in a
//       single call whatever their number;
//    ⑤ concrete, stone and wood throw dust into the smoke lattice.
//
//    Fragments are raster and dynamic only: the scene distance field does not carry them, the cascaded shadows do.
//    When the span would overflow, the oldest wreck is swept and its prop stands again.

import { FragmentCapacity, VertexStride } from "./FacetStructure.js";
import { BreakableKinds, BarrierProfile } from "./YardStructure.js";
import { ConstructBlank, FracturePart, NormalizeRecipe, ProjectFragment, ResolveMoments, FractureMaterials, ConstructRandom } from "./FractureStructure.js";
import { DebrisSolver } from "./DebrisSolver.js";
import { ConstructAxisQuaternion, InvertTransform, TransformPoint, AddVector, SubtractVector, ScaleVector, NormalizeVector,
         LengthVector } from "./TransformProjection.js";

const VertexCapacity = 180000;   // [-]   fragment vertices, 32 B each
const EnergyShare    = 0.35;     // [-]   of a strike's kinetic energy spent cutting
const EnergyCeiling  = 50000.0;  // [J]   FractureSpecification's limit
const ThrowShare     = 0.75;     // [-]   of the striking velocity a fragment near the impact leaves with

export class FragmentDepot
{
    constructor(Exchange, Scene)
    {
        this.Exchange      = Exchange;
        this.Scene         = Scene;
        this.VertexRecords = Exchange.ConstructRecords(VertexCapacity * VertexStride, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Fragment vertices");
        this.VertexCount   = 0;
        this.Solver        = new DebrisSolver([], Scene.QueryObstacleBounds());
        this.Groups        = [];
        this.Elapsed       = 0.0;
        this.Options       = { Enabled: true, Dust: true, Lifetime: 0.0 };
        this.Recipes       = Scene.Breakables.map((Entry, Index) => this.ConstructRecipe(Entry, Index));
        this.LastFracture  = null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    RECIPES
    //--------------------------------------------------------------------------------------------------------------------

    ConstructRecipe(Entry, Index)
    {
        const Kind = BreakableKinds[Entry.Kind];
        return { ...NormalizeRecipe({ Material: Kind.Material, Energy: 2500, Seed: 42 + 7 * Index, Ceiling: Kind.Ceiling, MinimumSize: Kind.MinimumSize }),
                 BreakEnergy: Kind.BreakEnergy, Mass: Kind.Mass };
    }

    // 📝 The Fracture editor writes a recipe back; the occupant carries the break energy and mass the obstacle query
    //    hands the vehicle. The caller rebuilds the obstacle boxes.
    AssignRecipe(Index, Input)
    {
        const Recipe = { ...NormalizeRecipe(Input), BreakEnergy: Math.max(10.0, Number(Input.BreakEnergy) || this.Recipes[Index].BreakEnergy),
                         Mass: Math.max(1.0, Number(Input.Mass) || this.Recipes[Index].Mass) };
        this.Recipes[Index] = Recipe;
        const Record = this.Scene.Occupants[this.Scene.Breakables[Index].Occupant];
        Record.BreakEnergy = Recipe.Enabled ? Recipe.BreakEnergy : Infinity;
        Record.BreakMass = Recipe.Mass;
        return Recipe;
    }

    // 📝 The blank, the impact point in its frame and the fracture itself — also what the editor's preview runs.
    ResolveFracture(Index, LocalHit = null, Energy = null)
    {
        const Entry = this.Scene.Breakables[Index];
        const Kind = BreakableKinds[Entry.Kind];
        const Recipe = this.Recipes[Index];
        const Blank = ConstructBlank(Kind.Primitive, Kind.Extent, BarrierProfile);
        const Hit = LocalHit || [Recipe.X, Recipe.Y, Recipe.Z + 0.5 * Kind.Extent[2]];
        const Result = FracturePart(Blank, { ...Recipe, Energy: Energy === null ? Recipe.Energy : Energy }, Hit);
        return { Entry, Kind, Recipe, Blank, Hit, Result };
    }

    QueryBroken(Index)
    {
        return this.Groups.some((Group) => Group.Breakable === Index);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    BREAKING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Impact: { Point, Velocity, Energy } in the world, or null for the editor's recipe impact. Returns
    //    { Vacated, Restored, Dust, Statistics } or null when the prop is already broken or fracture is off.
    Fracture(Index, Impact = null)
    {
        if (!this.Options.Enabled || this.QueryBroken(Index) || !this.Recipes[Index].Enabled)
            return null;
        const Entry = this.Scene.Breakables[Index];
        const Home = this.Scene.Occupants[Entry.Occupant].Parked ? this.Scene.Occupants[Entry.Occupant].HomeTransform : this.Scene.Occupants[Entry.Occupant].Transform;
        // 📝 Baked: the recipe's impact and energy every time — the pattern the editor previews; Dynamic: the strike's.
        const Struck = Impact && this.Recipes[Index].Mode !== "baked";
        const LocalHit = Struck ? TransformPoint(InvertTransform(Home), Impact.Point) : null;
        const Energy = Struck ? Math.min(EnergyCeiling, Impact.Energy * EnergyShare) : null;
        const { Kind, Recipe, Blank, Hit, Result } = this.ResolveFracture(Index, LocalHit, Energy);
        if (Result.Parts.length < 2)
            return null;

        // ① room in the span: sweep the oldest wrecks
        const Restored = [];
        while (this.Groups.length > 0 && this.CountFragments() + Result.Parts.length > FragmentCapacity)
            Restored.push(...this.Sweep(this.Groups[0].Breakable));

        // ② bodies: mass by volume, thrown with the strike and outward from the impact
        const Material = FractureMaterials[Recipe.Material];
        const Density = Recipe.Mass / Math.max(1.0e-6, ResolveMoments(Blank).Volume);
        const Orientation = ConstructAxisQuaternion([0.0, 0.0, 1.0], Entry.Yaw);
        const WorldHit = TransformPoint(Home, Hit);
        const Random = ConstructRandom(Recipe.Seed * 31 + 7);
        const Strike = Impact ? Impact.Velocity : [0.0, 0.0, 0.0];
        const StrikeSpeed = LengthVector(Strike);
        const Burst = Impact ? 0.0 : Math.sqrt(2.0 * 0.06 * Recipe.Energy / Recipe.Mass);
        const Radius = LengthVector(Kind.Extent);
        const Bodies = Result.Parts.map((Part) =>
        {
            const Fragment = ProjectFragment(Part, Density, { Shell: Kind.Family, Core: Kind.Core });
            const Position = TransformPoint(Home, Fragment.Centroid);
            const Away = SubtractVector(Position, WorldHit);
            const Near = Math.exp(-LengthVector(Away) / (0.6 * Radius));
            const Outward = NormalizeVector(AddVector(Away, [0.0, 0.0, 0.25 * LengthVector(Away)]));
            const Jitter = [Random() - 0.5, Random() - 0.5, Random() * 0.5];
            const Linear = AddVector(AddVector(ScaleVector(Strike, ThrowShare * (0.35 + 0.65 * Near)), ScaleVector(Outward, (0.25 * StrikeSpeed + Burst) * Near)),
                                     ScaleVector(Jitter, 0.5 + 0.1 * StrikeSpeed));
            const Spin = (1.5 + 0.6 * StrikeSpeed + 2.0 * Burst) * Near;
            const Angular = [(Random() - 0.5) * Spin, (Random() - 0.5) * Spin, (Random() - 0.5) * Spin];
            const Body = this.Solver.ConstructRigidBody({ Points: Fragment.Points, Mass: Fragment.Mass, Extent: Fragment.Extent,
                                                          Restitution: Material.Restitution, Friction: Material.Friction },
                                                        Kind.Family, Position, Orientation, Linear, Angular);
            Body.Geometry = Fragment;
            Body.Breakable = Index;
            return Body;
        });
        this.Groups.push({ Breakable: Index, Bodies, Time: this.Elapsed });

        // ③ the prop leaves the field; ④ the span and its vertex records are rebuilt
        const Vacated = this.Scene.ParkOccupant(Entry.Occupant);
        this.ReconstructSpan();

        // ⑤ dust, by material and energy spent
        const Spent = Math.max(Result.Spent, 1.0);
        const Dust = this.Options.Dust && Material.DustPerJoule >= 0.2
            ? { Position: WorldHit, Radius: Math.min(1.2, 0.3 + 0.5 * Radius), Velocity: AddVector(ScaleVector(Strike, 0.25), [0.0, 0.0, 0.8]),
                Smoke: Math.min(140.0, Material.DustPerJoule * Spent * 0.02 + 10.0), Heat: 0.0, Flame: 0.0, Soot: 0.0, Seconds: 0.3 }
            : null;
        this.LastFracture = { Name: Entry.Name, Fragments: Result.Parts.length, Milliseconds: Result.Milliseconds, Quality: Result.Quality,
                              Triangles: Result.Triangles, VolumeError: Result.VolumeError, Spent: Result.Spent, Energy: Energy ?? Recipe.Energy };
        return { Vacated, Restored, Dust, Statistics: this.LastFracture };
    }

    // 📝 Takes one wreck away and stands its prop again; returns the world bounds the prop occupies again.
    Sweep(Index)
    {
        const Group = this.Groups.find((Candidate) => Candidate.Breakable === Index);
        if (!Group)
            return [];
        this.Groups = this.Groups.filter((Candidate) => Candidate !== Group);
        const Restored = this.Scene.RestoreOccupant(this.Scene.Breakables[Index].Occupant);
        this.ReconstructSpan();
        return Restored ? [Restored] : [];
    }

    SweepAll()
    {
        const Restored = [];
        for (const Group of this.Groups.slice())
            Restored.push(...this.Sweep(Group.Breakable));
        return Restored;
    }

    CountFragments()
    {
        return this.Groups.reduce((Sum, Group) => Sum + Group.Bodies.length, 0);
    }

    // 📝 The span in group order: the scene's fragment occupants, the solver's bodies, one vertex record set.
    ReconstructSpan()
    {
        const Bodies = this.Groups.flatMap((Group) => Group.Bodies);
        this.Solver.Bodies = Bodies;
        this.Solver.Hash = null;
        Bodies.forEach((Body, Slot) => { Body.Slot = Slot; Body.Stirred = 2; });
        this.Scene.ReplaceFragments(Bodies.map((Body, Slot) => ({ Name: `Fragment ${Slot}`, Transform: Body.Transform,
                                                                  LocalMinimum: Body.Geometry.LocalMinimum, LocalMaximum: Body.Geometry.LocalMaximum })));
        let Total = 0;
        for (const Body of Bodies)
            Total += Body.Geometry.Triangles.length * 3;
        Total = Math.min(Total, VertexCapacity);
        const Bytes = new ArrayBuffer(Math.max(1, Total) * VertexStride);
        const Scalars = new Float32Array(Bytes), Integers = new Uint32Array(Bytes);
        let Cursor = 0;
        for (const Body of Bodies)
        {
            for (const Triangle of Body.Geometry.Triangles)
            {
                if (Cursor + 3 > Total)
                    break;
                for (const Corner of Triangle.Corners)
                {
                    const Offset = Cursor * 8;
                    Scalars[Offset] = Corner[0];
                    Scalars[Offset + 1] = Corner[1];
                    Scalars[Offset + 2] = Corner[2];
                    Integers[Offset + 3] = Triangle.Family;
                    Scalars[Offset + 4] = Triangle.Normal[0];
                    Scalars[Offset + 5] = Triangle.Normal[1];
                    Scalars[Offset + 6] = Triangle.Normal[2];
                    Integers[Offset + 7] = Body.Slot;
                    ++Cursor;
                }
            }
        }
        this.VertexCount = Cursor;
        if (Cursor > 0)
            this.Exchange.Device.queue.writeBuffer(this.VertexRecords, 0, Scalars, 0, Cursor * 8);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   INTEGRATION
    //--------------------------------------------------------------------------------------------------------------------

    AssignObstacles(Obstacles)
    {
        this.Solver.Obstacles = Obstacles;
    }

    // 📝 Steps the fragments; moved ones take their new transform. Returns the span range whose records must be
    //    uploaded, or null. Wrecks older than Options.Lifetime (when set) are swept — the restored bounds are queued
    //    for the caller in Swept.
    Advance(Seconds, Pushers)
    {
        this.Elapsed += Seconds;
        this.Swept = [];
        if (this.Options.Lifetime > 0.0)
            for (const Group of this.Groups.slice())
                if (this.Elapsed - Group.Time > this.Options.Lifetime)
                    this.Swept.push(...this.Sweep(Group.Breakable));
        if (this.Solver.Bodies.length === 0)
            return null;
        const Moved = new Set(this.Solver.Advance(Seconds, Pushers));
        let First = Infinity, Last = -Infinity;
        const Base = this.Scene.FragmentFirst;
        for (const Body of this.Solver.Bodies)
        {
            const Occupant = Base + Body.Slot;
            if (Moved.has(Body))
            {
                this.Scene.AssignOccupantTransform(Occupant, Body.Transform);
                Body.Stirred = 2;
            }
            else if (Body.Stirred > 0)
            {
                this.Scene.RetainOccupantTransform(Occupant);
                Body.Stirred--;
            }
            else
                continue;
            First = Math.min(First, Occupant);
            Last = Math.max(Last, Occupant);
        }
        return First <= Last ? { First, Count: Last - First + 1 } : null;
    }

    QueryStatistics()
    {
        return { Wrecks: this.Groups.length, Fragments: this.CountFragments(), Capacity: FragmentCapacity, Vertices: this.VertexCount,
                 Awake: this.Solver.AwakeCount, Last: this.LastFracture };
    }
}
