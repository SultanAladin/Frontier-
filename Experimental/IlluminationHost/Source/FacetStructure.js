//============================================================================================================================================
//                                                            FACETSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Scene topology — facet sets (the ControlVehicle, the drift yard, the stress-test props) and the occupants placing them.

import { RetrieveFacetStream } from "./FacetCodec.js";
import { CourseMaterial } from "./MaterialSpecification.js";
import * as Course from "./CourseStructure.js";
import { ConstructYard, EmitYardGroundFacets } from "./YardStructure.js";
import { VehicleGeometry, ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { ConstructIdentityTransform, TransformBounds, InvertTransform,
         SubtractVector, CrossVector, NormalizeVector } from "./TransformProjection.js";

// 📝 What an occupant takes part in. A ground tile only owns a surface card; the ground occupant is only rastered,
//    because the scene distance field carries the ground as its analytic plane rather than as a sampled volume.
export const OccupantRole = Object.freeze({
    Raster:   1,   // [-] - drawn into the surface projection and the shadow depth
    Distance: 2,   // [-] - unioned into the scene distance field from its own distance volume
    Cards:    4,   // [-] - owns surface cards in the card depot
    Dynamic:  8    // [-] - transform may change every frame
});

export const VertexStride = 32;   // [B] - position.xyz, family (u32), normal.xyz, occupant offset (u32)

// 📝 Occupant order is load-bearing:
//      [vehicle 5 | yard | scatter span | ground | ground tiles | fragment span]
//    The union pass walks [0, DistanceCount), so the stress-test scatter span sits at its end: inserting or removing
//    scatter occupants never renumbers an occupant whose identity the distance field or a reservoir already holds.
//    Everything after the ground is outside the union: the fracture fragments, which the fragment depot replaces
//    wholesale and draws in one call from their own vertex records.
export const ScatterCapacity  = 1536;   // [-] - f16 identities are exact below 2045, the yard takes ~150
export const FragmentCapacity = 1024;   // [-] - live fracture fragments

// 📝 The ground tiling the card depot uses for the course plane: a 10 × 10 lattice of 12 m tiles over the pad and four
//    strips over the authored 480 m surround. A ground hit resolves its card from x, y alone through this layout.
export const GroundLayout = Object.freeze({
    PadMinimum:   -60.0,   // [m]
    TileExtent:   12.0,    // [m]
    TileCount:    10,      // [-] per axis
    OuterExtent:  240.0,   // [m] half extent of the authored surround quad
    PadDensity:   8.0,     // [texel/m]
    StripDensity: 0.5      // [texel/m]
});

const ParkedHeight = -500.0;   // [m] - a broken prop's occupant waits here, outside every cascade and shadow

//------------------------------------------------------------------------------------------------------------------------
//                                                   SCENE STRUCTURE
//------------------------------------------------------------------------------------------------------------------------

export class SceneStructure
{
    constructor()
    {
        this.FacetSets        = [];
        this.Occupants        = [];
        this.VehicleOccupants = { Body: -1, Wheels: [-1, -1, -1, -1] };
        this.GroundTiles      = { First: -1, Strips: [-1, -1, -1, -1] };
        this.GroundOccupant   = -1;
        this.DistanceCount    = 0;
        this.Breakables       = [];
        this.FragmentFirst    = 0;
        this.FragmentCount    = 0;
    }

    async ConstructScene(ArchiveFolder)
    {
        const [Body, Tyre, Rim] = await Promise.all([
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleBody.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleTyre.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleRim.facet`)
        ]);

        // ① vehicle facet sets — and the bare rims a burst tyre leaves, transferred at bring-up so a burst swaps sets
        const BodySet       = this.ConstructFacetSet("ControlVehicle body", ProjectBodyFacets(Body), 0.05, 40.0);
        const WheelLeftSet  = this.ConstructFacetSet("ControlVehicle wheel (left)", ProjectWheelFacets(Tyre, Rim, false, true), 0.025, 40.0);
        const WheelRightSet = this.ConstructFacetSet("ControlVehicle wheel (right)", ProjectWheelFacets(Tyre, Rim, true, true), 0.025, 40.0);
        const RimLeftSet    = this.ConstructFacetSet("ControlVehicle rim (left)", ProjectWheelFacets(Tyre, Rim, false, false), 0.025, 40.0);
        const RimRightSet   = this.ConstructFacetSet("ControlVehicle rim (right)", ProjectWheelFacets(Tyre, Rim, true, false), 0.025, 40.0);
        this.FacetSets[RimLeftSet].DistanceRequired = true;
        this.FacetSets[RimRightSet].DistanceRequired = true;
        this.WheelSets = { Tyred: [WheelLeftSet, WheelRightSet], Rim: [RimLeftSet, RimRightSet] };
        const GroundSet = this.ConstructFacetSet("Course ground", EmitYardGroundFacets(), 0.0, 0.0);

        // ② distance occupants first, so the union pass walks one compact span ------------------------------------
        const VehicleRoles = OccupantRole.Raster | OccupantRole.Distance | OccupantRole.Cards | OccupantRole.Dynamic;
        const StaticRoles  = OccupantRole.Raster | OccupantRole.Distance | OccupantRole.Cards;
        this.VehicleOccupants.Body = this.ConstructOccupant("ControlVehicle", BodySet, ConstructIdentityTransform(), VehicleRoles);
        const WheelNames = ["Wheel FL", "Wheel FR", "Wheel RL", "Wheel RR"];
        for (let Wheel = 0; Wheel < 4; ++Wheel)
        {
            const Set = (Wheel & 1) ? WheelRightSet : WheelLeftSet;
            this.VehicleOccupants.Wheels[Wheel] = this.ConstructOccupant(WheelNames[Wheel], Set, ConstructIdentityTransform(), VehicleRoles);
        }
        this.DynamicCount = this.Occupants.length;
        const Yard = ConstructYard(this, { Static: StaticRoles });
        this.Breakables = Yard.Breakables;
        this.DistanceCount = this.Occupants.length;

        // ②½ the stress-test scatter shapes: facet sets (and so distance volumes) exist from bring-up, occupants only
        //    once the panel asks for them, appended at ScatterFirst — the end of the distance span.
        this.ScatterShapes = ConstructScatterShapes(this);
        this.ScatterFirst  = this.Occupants.length;
        this.ScatterCount  = 0;

        // ③ the ground: rastered once, carded as tiles ----------------------------------------------------------------
        this.GroundOccupant = this.ConstructOccupant("Course ground", GroundSet, ConstructIdentityTransform(), OccupantRole.Raster);
        this.GroundTiles.First = this.Occupants.length;
        for (let Row = 0; Row < GroundLayout.TileCount; ++Row)
        {
            for (let Column = 0; Column < GroundLayout.TileCount; ++Column)
            {
                const MinimumX = GroundLayout.PadMinimum + Row * GroundLayout.TileExtent;
                const MinimumY = GroundLayout.PadMinimum + Column * GroundLayout.TileExtent;
                const Tile = this.ConstructOccupant(`Ground tile ${Row},${Column}`, GroundSet, ConstructIdentityTransform(),
                                                    OccupantRole.Cards);
                this.AssignCardBounds(Tile, [MinimumX, MinimumY, -0.05],
                                      [MinimumX + GroundLayout.TileExtent, MinimumY + GroundLayout.TileExtent, 0.05], GroundLayout.PadDensity);
            }
        }
        const Pad = -GroundLayout.PadMinimum, Outer = GroundLayout.OuterExtent;
        const StripBounds = [[[-Outer, -Outer], [-Pad, Outer]], [[Pad, -Outer], [Outer, Outer]],
                             [[-Pad, -Outer], [Pad, -Pad]],     [[-Pad, Pad], [Pad, Outer]]];
        const StripNames = ["West", "East", "South", "North"];
        for (let Strip = 0; Strip < 4; ++Strip)
        {
            const [Low, High] = StripBounds[Strip];
            const Occupant = this.ConstructOccupant(`Ground strip ${StripNames[Strip]}`, GroundSet, ConstructIdentityTransform(),
                                                    OccupantRole.Cards);
            this.AssignCardBounds(Occupant, [Low[0], Low[1], -0.05], [High[0], High[1], 0.05], GroundLayout.StripDensity);
            this.GroundTiles.Strips[Strip] = Occupant;
        }

        // ④ the fragment span starts empty; the fragment depot fills it
        this.FragmentSet   = this.ConstructFacetSet("Fracture fragments", [], 0.0, 0.0);
        this.FragmentFirst = this.Occupants.length;
        this.FragmentCount = 0;
        this.ResolveRasterRuns();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              SCATTER SPAN (STRESS TEST)
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Replaces the whole scatter span with Bodies ({ Shape, Transform, Dynamic, Family }), grouped by shape so each
    //    shape rasters as one instanced run. Writes each body's occupant index back as Body.Occupant and returns the
    //    world bounds of every removed and inserted occupant, which the distance field must rewrite.
    ReconstructScatter(Bodies)
    {
        const Invalidated = [];
        for (let Index = this.ScatterFirst; Index < this.ScatterFirst + this.ScatterCount; ++Index)
            Invalidated.push(this.QueryWorldBounds(Index));
        const Order = Bodies.map((Body, Index) => Index).sort((Left, Right) => (Bodies[Left].Shape - Bodies[Right].Shape) || (Left - Right));
        const Inserted = Order.map((BodyIndex, Offset) =>
        {
            const Body = Bodies[BodyIndex];
            const Shape = this.ScatterShapes[Body.Shape];
            const Roles = OccupantRole.Raster | OccupantRole.Distance | OccupantRole.Cards | (Body.Dynamic ? OccupantRole.Dynamic : 0);
            const Record = ProjectOccupantRecord(this.FacetSets[Shape.FacetSet], `${Shape.Name} ${Offset}`, Shape.FacetSet, Body.Transform.slice(),
                                                 Roles, Body.Family);
            Record.UnionTransform = Body.Transform.slice();
            Record.Obstacle = !Body.Dynamic;
            Record.Scatter = true;
            return Record;
        });
        const Delta = Inserted.length - this.ScatterCount;
        this.Occupants.splice(this.ScatterFirst, this.ScatterCount, ...Inserted);
        Order.forEach((BodyIndex, Offset) => { Bodies[BodyIndex].Occupant = this.ScatterFirst + Offset; });
        this.ScatterCount   = Inserted.length;
        this.DistanceCount += Delta;
        this.GroundOccupant += Delta;
        this.GroundTiles.First += Delta;
        this.GroundTiles.Strips = this.GroundTiles.Strips.map((Index) => Index + Delta);
        this.FragmentFirst += Delta;
        for (let Index = this.ScatterFirst; Index < this.ScatterFirst + this.ScatterCount; ++Index)
            Invalidated.push(this.QueryWorldBounds(Index));
        this.ResolveRasterRuns();
        return Invalidated;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 FRAGMENT SPAN
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Replaces the fragment span with Fragments ({ Name, Transform, LocalMinimum, LocalMaximum }): raster and
    //    dynamic only — the scene distance field does not carry them, the cascaded shadows do. The depot's vertex
    //    records name each fragment by its offset in this span, so the span renumbers nothing when it moves.
    ReplaceFragments(Fragments)
    {
        const Set = this.FacetSets[this.FragmentSet];
        const Records = Fragments.map((Fragment) =>
        {
            const Record = ProjectOccupantRecord(Set, Fragment.Name, this.FragmentSet, Fragment.Transform.slice(), OccupantRole.Raster | OccupantRole.Dynamic);
            Record.Fragment = true;
            Record.LocalMinimum = Fragment.LocalMinimum;
            Record.LocalMaximum = Fragment.LocalMaximum;
            return Record;
        });
        this.Occupants.splice(this.FragmentFirst, this.FragmentCount, ...Records);
        this.FragmentCount = Records.length;
    }

    // 📝 A broken prop leaves the field without leaving the list: its occupant is moved below the course, where no
    //    cascade, shadow or obstacle query reaches it. Returns the world bounds it vacated.
    ParkOccupant(Index)
    {
        const Record = this.Occupants[Index];
        const Vacated = this.QueryWorldBounds(Index);
        if (!Record.Parked)
        {
            Record.HomeTransform = Record.Transform.slice();
            Record.Parked = true;
        }
        const Parked = Record.HomeTransform.slice();
        Parked[14] += ParkedHeight;
        Record.Transform = Parked;
        Record.PreviousTransform = Parked.slice();
        return Vacated;
    }

    RestoreOccupant(Index)
    {
        const Record = this.Occupants[Index];
        if (!Record.Parked)
            return null;
        Record.Transform = Record.HomeTransform.slice();
        Record.PreviousTransform = Record.HomeTransform.slice();
        Record.Parked = false;
        return this.QueryWorldBounds(Index);
    }

    // 📝 A burst tyre runs on its rim: the wheel occupant takes the bare-rim facet set, and back on a fresh tyre.
    AssignWheelSet(Wheel, Tyred)
    {
        const Occupant = this.VehicleOccupants.Wheels[Wheel];
        const Side = Wheel & 1;
        const Set = Tyred ? this.WheelSets.Tyred[Side] : this.WheelSets.Rim[Side];
        if (this.Occupants[Occupant].FacetSet === Set)
            return false;
        this.Occupants[Occupant].FacetSet = Set;
        this.ResolveRasterRuns();
        return true;
    }

    // 📝 Consecutive rastered occupants sharing a facet set become one instanced draw: instance_index includes the
    //    first-instance argument, so the run [First, First + Count) reads its own occupant records. The course and the
    //    scatter span collapse from hundreds of draws to one per shape; the shadow runs leave out the ground. The
    //    fragment span is drawn by the fragment depot in one call of its own.
    ResolveRasterRuns()
    {
        const Runs = [], ShadowRuns = [];
        const Extend = (Target, Index, Set) =>
        {
            const Last = Target[Target.length - 1];
            if (Last && Last.FacetSet === Set && Last.First + Last.Count === Index)
                Last.Count++;
            else
                Target.push({ FacetSet: Set, First: Index, Count: 1 });
        };
        this.Occupants.forEach((Occupant, Index) =>
        {
            if (!(Occupant.Roles & OccupantRole.Raster) || Occupant.Fragment)
                return;
            Extend(Runs, Index, Occupant.FacetSet);
            if (Index !== this.GroundOccupant)
                Extend(ShadowRuns, Index, Occupant.FacetSet);
        });
        this.RasterRuns = Runs;
        this.ShadowRuns = ShadowRuns;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                            FACET SET CONSTRUCTION
    //--------------------------------------------------------------------------------------------------------------------

    ConstructFacetSet(Name, Facets, DistanceVoxel, CardDensity)
    {
        const Minimum = [Infinity, Infinity, Infinity];
        const Maximum = [-Infinity, -Infinity, -Infinity];
        for (const Facet of Facets)
        {
            for (const Corner of Facet.Corners)
            {
                for (let Axis = 0; Axis < 3; ++Axis)
                {
                    Minimum[Axis] = Math.min(Minimum[Axis], Corner[Axis]);
                    Maximum[Axis] = Math.max(Maximum[Axis], Corner[Axis]);
                }
            }
        }
        if (Facets.length === 0)
        {
            Minimum.fill(0.0);
            Maximum.fill(0.0);
        }
        this.FacetSets.push({ Name, Facets, LocalMinimum: Minimum, LocalMaximum: Maximum, DistanceVoxel, CardDensity,
                              FirstVertex: 0, VertexCount: Facets.length * 3, VolumeIndex: -1 });
        return this.FacetSets.length - 1;
    }

    ConstructOccupant(Name, FacetSet, Transform, Roles, MaterialOverride = -1)
    {
        this.Occupants.push(ProjectOccupantRecord(this.FacetSets[FacetSet], Name, FacetSet, Transform, Roles, MaterialOverride));
        return this.Occupants.length - 1;
    }

    AssignCardBounds(Occupant, Minimum, Maximum, Density)
    {
        this.Occupants[Occupant].CardMinimum = Minimum;
        this.Occupants[Occupant].CardMaximum = Maximum;
        this.Occupants[Occupant].CardDensity = Density;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               VERTEX ENCODING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Non-indexed facet corners, 32 bytes each: flat sets repeat the facet normal, authored sets carry corner normals.
    //    The last word is the occupant offset the fragment depot's own records use; zero here, so instance_index alone
    //    names the occupant.
    EncodeVertexRecords()
    {
        let VertexTotal = 0;
        for (const Set of this.FacetSets)
        {
            Set.FirstVertex = VertexTotal;
            VertexTotal += Set.VertexCount;
        }
        const Bytes = new ArrayBuffer(Math.max(1, VertexTotal) * VertexStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        let Cursor = 0;
        for (const Set of this.FacetSets)
        {
            for (const Facet of Set.Facets)
            {
                const FacetNormal = NormalizeVector(CrossVector(SubtractVector(Facet.Corners[1], Facet.Corners[0]),
                                                                SubtractVector(Facet.Corners[2], Facet.Corners[0])));
                for (let Corner = 0; Corner < 3; ++Corner)
                {
                    const Normal = Facet.Normals ? Facet.Normals[Corner] : FacetNormal;
                    const Offset = Cursor * 8;
                    Scalars[Offset + 0] = Facet.Corners[Corner][0];
                    Scalars[Offset + 1] = Facet.Corners[Corner][1];
                    Scalars[Offset + 2] = Facet.Corners[Corner][2];
                    Integers[Offset + 3] = Facet.Family;
                    Scalars[Offset + 4] = Normal[0];
                    Scalars[Offset + 5] = Normal[1];
                    Scalars[Offset + 6] = Normal[2];
                    Integers[Offset + 7] = 0;
                    ++Cursor;
                }
            }
        }
        return Scalars;
    }

    QueryWorldBounds(Occupant)
    {
        const Record = this.Occupants[Occupant];
        if (Record.Fragment)
            return TransformBounds(Record.Transform, Record.LocalMinimum, Record.LocalMaximum);
        const Set = this.FacetSets[Record.FacetSet];
        if (Record.Roles & OccupantRole.Raster || Record.Roles & OccupantRole.Distance)
            return TransformBounds(Record.Transform, Set.LocalMinimum, Set.LocalMaximum);
        return TransformBounds(Record.Transform, Record.CardMinimum, Record.CardMaximum);
    }

    // 📝 World bounds of every static occupant the vehicle hull and the debris collide with: walls, containers, barriers,
    //    props. A pole answers with its shaft alone (its arm is out of reach); a breakable carries its identity, the
    //    energy that breaks it and its mass, so the vehicle can strike it rather than stop against it.
    QueryObstacleBounds()
    {
        const Bounds = [];
        this.Occupants.forEach((Occupant, Index) =>
        {
            if (!Occupant.Obstacle || Occupant.Parked)
                return;
            const Box = Occupant.ObstacleMinimum ? TransformBounds(Occupant.Transform, Occupant.ObstacleMinimum, Occupant.ObstacleMaximum)
                                                 : this.QueryWorldBounds(Index);
            if (Occupant.Breakable !== undefined)
            {
                Box.Breakable = Occupant.Breakable;
                Box.BreakEnergy = Occupant.BreakEnergy;
                Box.Mass = Occupant.BreakMass;
            }
            Bounds.push(Box);
        });
        return Bounds;
    }

    // 📝 Advances an occupant's transform; the previous one is retained for motion vectors and reservoir carriage.
    AssignOccupantTransform(Occupant, Transform)
    {
        const Record = this.Occupants[Occupant];
        Record.PreviousTransform = Record.Transform;
        Record.Transform = Transform;
    }

    RetainOccupantTransform(Occupant)
    {
        const Record = this.Occupants[Occupant];
        Record.PreviousTransform = Record.Transform;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              OCCUPANT ENCODING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 336-byte records matching OccupantRecord in SceneRecords.wgsl (84 scalars) for occupants [First, First +
    //    Count): the vehicle's five for the per-frame upload, the stirred part of the scatter span, the moving
    //    fragments, or everything. The caller writes the result at byte offset First · OccupantStride.
    EncodeOccupantRecords(DistanceSpace, Count = undefined, First = 0)
    {
        const Span = Count === undefined ? this.Occupants.length - First : Math.min(Count, this.Occupants.length - First);
        const Bytes = new ArrayBuffer(Math.max(1, Span) * OccupantStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        for (let Index = 0; Index < Span; ++Index)
        {
            const Record = this.Occupants[First + Index];
            const Offset = Index * (OccupantStride / 4);
            const Set = this.FacetSets[Record.FacetSet];
            Scalars.set(Record.Transform, Offset);
            Scalars.set(InvertTransform(Record.Transform), Offset + 16);
            Scalars.set(Record.PreviousTransform, Offset + 32);
            Scalars.set(InvertTransform(Record.PreviousTransform), Offset + 48);
            const Bounds = this.QueryWorldBounds(First + Index);
            Scalars.set(Bounds.Minimum, Offset + 64);
            Integers[Offset + 67] = Record.Roles;
            Scalars.set(Bounds.Maximum, Offset + 68);
            Integers[Offset + 71] = Record.MaterialOverride >= 0 ? Record.MaterialOverride : 0xFFFFFFFF;
            const Volume = (DistanceSpace && Set.VolumeIndex >= 0 && !Record.Fragment) ? DistanceSpace.Volumes[Set.VolumeIndex] : null;
            if (Volume)
            {
                Scalars.set(Volume.Minimum, Offset + 72);
                Scalars[Offset + 75] = Volume.VoxelExtent;
                Scalars.set(Volume.TexelOrigin, Offset + 76);
                Scalars.set(Volume.Resolution, Offset + 80);
            }
            Integers[Offset + 79] = Record.FirstCard;
            Integers[Offset + 83] = Record.CardCount;
        }
        return Scalars;
    }
}

export const OccupantStride = 336;   // [B] - OccupantRecord

//------------------------------------------------------------------------------------------------------------------------
//                                           CONTROLVEHICLE FACET PROJECTION
//------------------------------------------------------------------------------------------------------------------------

// 📝 DriveSceneAuthor::AppendVehicleBody(): rebase the authored model onto the centre of mass (z − 0.11285 m) and keep
//    the per-facet family; facet normals are flat, exactly as AppendFace derives them.
function ProjectBodyFacets(Stream)
{
    const Rebase = ResolveCoMAuthoredZ();
    const Facets = [];
    for (let Facet = 0; Facet < Stream.FacetCount; ++Facet)
    {
        const Corners = [];
        for (let Corner = 0; Corner < 3; ++Corner)
        {
            const Vertex = Stream.Facets[Facet * 3 + Corner];
            Corners.push([Stream.Positions[Vertex * 3], Stream.Positions[Vertex * 3 + 1], Stream.Positions[Vertex * 3 + 2] - Rebase]);
        }
        Facets.push({ Corners, Family: Stream.Families[Facet] });
    }
    return Facets;
}

// 📝 The authored tyre plus the authored rim (mags and all), hub-local with the axle along +Y. The rim is scaled to the
//    configured rim radius as DriveSceneAuthor::AppendWheel does. The right-hand wheels mirror Y so the mag face points
//    outward on both sides; mirroring reverses the winding, which is restored by swapping two corners. Without the
//    tyre it is what a burst leaves on the axle.
function ProjectWheelFacets(Tyre, Rim, Mirrored, Tyred)
{
    const Facets = [];
    const RimScale = VehicleGeometry.TyreRimRadius / VehicleGeometry.AuthoredRimRadius;
    const Append = (Stream, Scale) =>
    {
        for (let Facet = 0; Facet < Stream.FacetCount; ++Facet)
        {
            const Corners = [], Normals = [];
            for (let Corner = 0; Corner < 3; ++Corner)
            {
                const Vertex = Stream.Facets[Facet * 3 + Corner];
                const Sign = Mirrored ? -1.0 : 1.0;
                Corners.push([Stream.Positions[Vertex * 3] * Scale, Sign * Stream.Positions[Vertex * 3 + 1] * Scale,
                              Stream.Positions[Vertex * 3 + 2] * Scale]);
                const Offset = Facet * 9 + Corner * 3;
                Normals.push([Stream.CornerNormals[Offset], Sign * Stream.CornerNormals[Offset + 1], Stream.CornerNormals[Offset + 2]]);
            }
            if (Mirrored)
            {
                [Corners[1], Corners[2]] = [Corners[2], Corners[1]];
                [Normals[1], Normals[2]] = [Normals[2], Normals[1]];
            }
            Facets.push({ Corners, Normals, Family: Stream.Families[Facet] });
        }
    };
    if (Tyred)
        Append(Tyre, 1.0);
    Append(Rim, RimScale);
    return Facets;
}

function ProjectOccupantRecord(Set, Name, FacetSet, Transform, Roles, MaterialOverride = -1)
{
    return {
        Name, FacetSet, Roles, MaterialOverride,
        Transform:         Transform,
        PreviousTransform: Transform.slice(),
        CardMinimum:       Set.LocalMinimum.slice(),
        CardMaximum:       Set.LocalMaximum.slice(),
        CardDensity:       Set.CardDensity,
        FirstCard:         0,
        CardCount:         0
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                               SCATTER SHAPES (STRESS TEST)
//------------------------------------------------------------------------------------------------------------------------

// 📝 Four props, each a facet set local to its bottom centre (outward winding, which the distance transfer needs) and
//    a rigid description the debris solver integrates: extent [m], mass [kg], centre-of-mass height above the local
//    origin [m], contact points in the local frame, and the colours the props are drawn in.
const ScatterCardDensity = 12.0;   // [texel/m]
const ScatterVoxel       = 0.05;   // [m]

function ConstructScatterShapes(Scene)
{
    const Shapes = [];
    const Define = (Name, Facets, Rigid) =>
    {
        const FacetSet = Scene.ConstructFacetSet(`Scatter ${Name}`, Facets, ScatterVoxel, ScatterCardDensity);
        Scene.FacetSets[FacetSet].DistanceRequired = true;
        Shapes.push({ Name, FacetSet, ...Rigid });
    };
    const BoxPoints = (X, Y, Z) =>
    {
        const Points = [];
        for (const SignZ of [0.0, 1.0])
            for (const SignY of [-0.5, 0.5])
                for (const SignX of [-0.5, 0.5])
                    Points.push([SignX * X, SignY * Y, SignZ * Z]);
        return Points;
    };
    const RimPoints = (Radius, Heights, Segments) =>
    {
        const Points = [];
        for (const Height of Heights)
            for (let Segment = 0; Segment < Segments; ++Segment)
            {
                const θ = (2.0 * Math.PI * Segment) / Segments;
                Points.push([Radius * Math.cos(θ), Radius * Math.sin(θ), Height]);
            }
        return Points;
    };
    Define("crate", EmitBoxFacets(0.8, 0.8, 0.8, CourseMaterial.WallChalk),
           { Extent: [0.8, 0.8, 0.8], Mass: 25.0, CentreHeight: 0.4, Points: BoxPoints(0.8, 0.8, 0.8),
             Families: [CourseMaterial.WallChalk, CourseMaterial.Bump, CourseMaterial.WallCrimson] });
    Define("long crate", EmitBoxFacets(1.4, 0.7, 0.6, CourseMaterial.WallCobalt),
           { Extent: [1.4, 0.7, 0.6], Mass: 40.0, CentreHeight: 0.3, Points: BoxPoints(1.4, 0.7, 0.6),
             Families: [CourseMaterial.WallCobalt, CourseMaterial.WallViridian, CourseMaterial.TunnelConcrete] });
    Define("barrel", EmitCylinderFacets(0.3, 0.9, 12, CourseMaterial.Cone),
           { Extent: [0.6, 0.6, 0.9], Mass: 30.0, CentreHeight: 0.45, Points: RimPoints(0.3, [0.0, 0.9], 8),
             Families: [CourseMaterial.Cone, CourseMaterial.WallCobalt, CourseMaterial.WallCrimson] });
    Define("pylon", EmitPylonFacets(0.32, 0.85, 12, CourseMaterial.Cone),
           { Extent: [0.64, 0.64, 0.85], Mass: 6.0, CentreHeight: 0.22, Points: [...RimPoints(0.32, [0.0], 8), [0.0, 0.0, 0.85]],
             Families: [CourseMaterial.Cone, CourseMaterial.Bump] });
    return Shapes;
}

// 📝 A closed cylinder local to its bottom centre: side quads, top fan (+Z), bottom fan (−Z), outward winding.
function EmitCylinderFacets(Radius, Height, Segments, Family)
{
    const Facets = [];
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        const θ0 = (2.0 * Math.PI * Segment) / Segments, θ1 = (2.0 * Math.PI * (Segment + 1)) / Segments;
        const P0 = [Radius * Math.cos(θ0), Radius * Math.sin(θ0)], P1 = [Radius * Math.cos(θ1), Radius * Math.sin(θ1)];
        Facets.push({ Corners: [[P0[0], P0[1], 0.0], [P1[0], P1[1], 0.0], [P1[0], P1[1], Height]], Family });
        Facets.push({ Corners: [[P0[0], P0[1], 0.0], [P1[0], P1[1], Height], [P0[0], P0[1], Height]], Family });
        Facets.push({ Corners: [[0.0, 0.0, Height], [P0[0], P0[1], Height], [P1[0], P1[1], Height]], Family });
        Facets.push({ Corners: [[0.0, 0.0, 0.0], [P1[0], P1[1], 0.0], [P0[0], P0[1], 0.0]], Family });
    }
    return Facets;
}

// 📝 A traffic pylon: a cone local to its base centre, the same winding as Course.EmitConeFacets at another size.
function EmitPylonFacets(Radius, Height, Segments, Family)
{
    const Facets = [];
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        const θ0 = (2.0 * Math.PI * Segment) / Segments, θ1 = (2.0 * Math.PI * (Segment + 1)) / Segments;
        const P0 = [Radius * Math.cos(θ0), Radius * Math.sin(θ0), 0.0];
        const P1 = [Radius * Math.cos(θ1), Radius * Math.sin(θ1), 0.0];
        Facets.push({ Corners: [P0, P1, [0.0, 0.0, Height]], Family });
        Facets.push({ Corners: [P1, P0, [0.0, 0.0, 0.0]], Family });
    }
    return Facets;
}

function EmitBoxFacets(ExtentX, ExtentY, ExtentZ, Family)
{
    return Course.EmitBoxFacets(ExtentX, ExtentY, ExtentZ, Family);
}
