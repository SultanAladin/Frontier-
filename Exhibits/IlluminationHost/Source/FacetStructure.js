//============================================================================================================================================
//                                                            FACETSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Scene topology — facet sets (the ControlVehicle, Project-Drive's course, the illumination set) and the occupants placing them.

import { RetrieveFacetStream } from "./FacetCodec.js";
import { CourseMaterial } from "./MaterialSpecification.js";
import * as Course from "./CourseStructure.js";
import { VehicleGeometry, ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { ConstructIdentityTransform, ConstructRigidTransform, TransformBounds, InvertTransform,
         SubtractVector, CrossVector, NormalizeVector } from "./TransformProjection.js";

// 📝 What an occupant takes part in. A ground tile only owns a surface card; the ground occupant is only rastered,
//    because the scene distance field carries the ground as its analytic plane rather than as a sampled volume.
export const OccupantRole = Object.freeze({
    Raster:   1,   // [-] - drawn into the surface projection and the shadow depth
    Distance: 2,   // [-] - unioned into the scene distance field from its own distance volume
    Cards:    4,   // [-] - owns surface cards in the card depot
    Dynamic:  8    // [-] - transform may change every frame
});

export const VertexStride = 32;   // [B] - position.xyz, family (u32), normal.xyz, pad

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

//------------------------------------------------------------------------------------------------------------------------
//                                               ILLUMINATION SET LAYOUT
//------------------------------------------------------------------------------------------------------------------------

// 📝 Beside the course, never over it: two long walls flanking the spawn beyond the kerb, and a tunnel past the last
//    slalom cone. The course itself is untouched.
const IlluminationLayout = Object.freeze({
    WallExtent:        [4.0, 0.4, 3.5],     // [m]
    WallCentreY:       9.2,                 // [m]
    WallFirstX:        -22.0,               // [m]
    WallCount:         8,                   // [-] per side
    TunnelWallExtent:  [4.0, 0.5, 4.5],     // [m]
    TunnelRoofExtent:  [4.0, 9.0, 0.5],     // [m]
    TunnelCentreY:     4.25,                // [m]
    TunnelFirstX:      60.0,                // [m]
    TunnelCount:       6,                   // [-]
    KerbSegmentLength: 4.0                  // [m]
});

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
    }

    async ConstructScene(ArchiveFolder)
    {
        const [Body, Tyre, Rim] = await Promise.all([
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleBody.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleTyre.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleRim.facet`)
        ]);

        // ① facet sets ------------------------------------------------------------------------------------------------
        const BodySet       = this.ConstructFacetSet("ControlVehicle body", ProjectBodyFacets(Body), 0.05, 40.0);
        const WheelLeftSet  = this.ConstructFacetSet("ControlVehicle wheel (left)", ProjectWheelFacets(Tyre, Rim, false), 0.025, 40.0);
        const WheelRightSet = this.ConstructFacetSet("ControlVehicle wheel (right)", ProjectWheelFacets(Tyre, Rim, true), 0.025, 40.0);
        const GroundSet     = this.ConstructFacetSet("Course ground", Course.EmitGroundFacets(), 0.0, 0.0);
        const RampSet       = this.ConstructFacetSet("Course ramp", Course.EmitRampFacets(), 0.06, 20.0);
        const KerbSet       = this.ConstructFacetSet("Course kerb segment",
                                  Course.EmitBoxFacets(IlluminationLayout.KerbSegmentLength, Course.KerbConstants.Depth,
                                                       Course.KerbConstants.Height, CourseMaterial.Surround), 0.03, 24.0);
        const BumpSet       = this.ConstructFacetSet("Course speed bump", Course.EmitBumpFacets(), 0.04, 20.0);
        const ConeSet       = this.ConstructFacetSet("Course cone", Course.EmitConeFacets(), 0.02, 40.0);
        const WallSet       = this.ConstructFacetSet("Illumination wall segment",
                                  Course.EmitBoxFacets(...IlluminationLayout.WallExtent, CourseMaterial.WallChalk), 0.05, 20.0);
        const TunnelWallSet = this.ConstructFacetSet("Tunnel wall segment",
                                  Course.EmitBoxFacets(...IlluminationLayout.TunnelWallExtent, CourseMaterial.TunnelConcrete), 0.06, 16.0);
        const TunnelRoofSet = this.ConstructFacetSet("Tunnel roof segment",
                                  Course.EmitBoxFacets(...IlluminationLayout.TunnelRoofExtent, CourseMaterial.TunnelConcrete), 0.08, 16.0);

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
        this.ConstructOccupant("Ramp", RampSet, ConstructIdentityTransform(), StaticRoles);
        const KerbSegments = Math.round((Course.KerbConstants.FarX - Course.KerbConstants.NearX) / IlluminationLayout.KerbSegmentLength);
        for (let Segment = 0; Segment < KerbSegments; ++Segment)
        {
            const CentreX = Course.KerbConstants.NearX + (Segment + 0.5) * IlluminationLayout.KerbSegmentLength;
            const CentreY = Course.KerbConstants.CentreY + 0.5 * Course.KerbConstants.Depth;
            this.ConstructOccupant(`Kerb ${Segment}`, KerbSet, ProjectTranslation(CentreX, CentreY, 0.0), StaticRoles);
        }
        for (let Bump = 0; Bump < Course.CourseConstants.BumpCount; ++Bump)
        {
            const CentreX = Course.CourseConstants.BumpFirstX + Bump * Course.CourseConstants.BumpSpacingX;
            this.ConstructOccupant(`Speed bump ${Bump}`, BumpSet, ProjectTranslation(CentreX, 0.0, 0.0), StaticRoles);
        }
        for (let Cone = 0; Cone < Course.CourseConstants.ConeCount; ++Cone)
        {
            const [ConeX, ConeY] = Course.ResolveConeOrigin(Cone);
            this.ConstructOccupant(`Cone ${Cone}`, ConeSet, ProjectTranslation(ConeX, ConeY, 0.0), StaticRoles);
        }
        for (let Segment = 0; Segment < IlluminationLayout.WallCount; ++Segment)
        {
            const CentreX = IlluminationLayout.WallFirstX + Segment * IlluminationLayout.WallExtent[0];
            this.ConstructOccupant(`Crimson wall ${Segment}`, WallSet, ProjectTranslation(CentreX, IlluminationLayout.WallCentreY, 0.0),
                                   StaticRoles, CourseMaterial.WallCrimson);
            this.ConstructOccupant(`Viridian wall ${Segment}`, WallSet, ProjectTranslation(CentreX, -IlluminationLayout.WallCentreY, 0.0),
                                   StaticRoles, CourseMaterial.WallViridian);
        }
        for (let Segment = 0; Segment < IlluminationLayout.TunnelCount; ++Segment)
        {
            const CentreX = IlluminationLayout.TunnelFirstX + Segment * IlluminationLayout.TunnelWallExtent[0];
            this.ConstructOccupant(`Tunnel wall L${Segment}`, TunnelWallSet, ProjectTranslation(CentreX, IlluminationLayout.TunnelCentreY, 0.0),
                                   StaticRoles, CourseMaterial.WallCobalt);
            this.ConstructOccupant(`Tunnel wall R${Segment}`, TunnelWallSet, ProjectTranslation(CentreX, -IlluminationLayout.TunnelCentreY, 0.0),
                                   StaticRoles, CourseMaterial.WallChalk);
            this.ConstructOccupant(`Tunnel roof ${Segment}`, TunnelRoofSet,
                                   ProjectTranslation(CentreX, 0.0, IlluminationLayout.TunnelWallExtent[2]), StaticRoles);
        }
        this.DistanceCount = this.Occupants.length;
        const ObstacleSets = new Set([ConeSet, WallSet, TunnelWallSet, TunnelRoofSet]);
        for (const Occupant of this.Occupants)
            Occupant.Obstacle = ObstacleSets.has(Occupant.FacetSet);

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
        this.FacetSets.push({ Name, Facets, LocalMinimum: Minimum, LocalMaximum: Maximum, DistanceVoxel, CardDensity,
                              FirstVertex: 0, VertexCount: Facets.length * 3, VolumeIndex: -1 });
        return this.FacetSets.length - 1;
    }

    ConstructOccupant(Name, FacetSet, Transform, Roles, MaterialOverride = -1)
    {
        const Set = this.FacetSets[FacetSet];
        this.Occupants.push({
            Name, FacetSet, Roles, MaterialOverride,
            Transform:         Transform,
            PreviousTransform: Transform.slice(),
            CardMinimum:       Set.LocalMinimum.slice(),
            CardMaximum:       Set.LocalMaximum.slice(),
            CardDensity:       Set.CardDensity,
            FirstCard:         0,
            CardCount:         0
        });
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
    EncodeVertexRecords()
    {
        let VertexTotal = 0;
        for (const Set of this.FacetSets)
        {
            Set.FirstVertex = VertexTotal;
            VertexTotal += Set.VertexCount;
        }
        const Bytes = new ArrayBuffer(VertexTotal * VertexStride);
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
                    Scalars[Offset + 7] = 0.0;
                    ++Cursor;
                }
            }
        }
        return Scalars;
    }

    QueryWorldBounds(Occupant)
    {
        const Record = this.Occupants[Occupant];
        const Set = this.FacetSets[Record.FacetSet];
        if (Record.Roles & OccupantRole.Raster || Record.Roles & OccupantRole.Distance)
            return TransformBounds(Record.Transform, Set.LocalMinimum, Set.LocalMaximum);
        return TransformBounds(Record.Transform, Record.CardMinimum, Record.CardMaximum);
    }

    // 📝 World bounds of every static occupant the vehicle hull collides with: walls, tunnel, cones.
    QueryObstacleBounds()
    {
        const Bounds = [];
        this.Occupants.forEach((Occupant, Index) =>
        {
            if (Occupant.Obstacle)
                Bounds.push(this.QueryWorldBounds(Index));
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

    // 📝 336-byte records matching OccupantRecord in SceneRecords.wgsl (84 scalars). Count limits the encoding to the
    //    leading occupants — the vehicle's five, which are constructed first — for the per-frame upload.
    EncodeOccupantRecords(DistanceSpace, Count = this.Occupants.length)
    {
        const Bytes = new ArrayBuffer(Math.max(1, Count) * OccupantStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        this.Occupants.slice(0, Count).forEach((Record, Index) =>
        {
            const Offset = Index * (OccupantStride / 4);
            const Set = this.FacetSets[Record.FacetSet];
            Scalars.set(Record.Transform, Offset);
            Scalars.set(InvertTransform(Record.Transform), Offset + 16);
            Scalars.set(Record.PreviousTransform, Offset + 32);
            Scalars.set(InvertTransform(Record.PreviousTransform), Offset + 48);
            const Bounds = this.QueryWorldBounds(Index);
            Scalars.set(Bounds.Minimum, Offset + 64);
            Integers[Offset + 67] = Record.Roles;
            Scalars.set(Bounds.Maximum, Offset + 68);
            Integers[Offset + 71] = Record.MaterialOverride >= 0 ? Record.MaterialOverride : 0xFFFFFFFF;
            const Volume = (DistanceSpace && Set.VolumeIndex >= 0) ? DistanceSpace.Volumes[Set.VolumeIndex] : null;
            if (Volume)
            {
                Scalars.set(Volume.Minimum, Offset + 72);
                Scalars[Offset + 75] = Volume.VoxelExtent;
                Scalars.set(Volume.TexelOrigin, Offset + 76);
                Scalars.set(Volume.Resolution, Offset + 80);
            }
            Integers[Offset + 79] = Record.FirstCard;
            Integers[Offset + 83] = Record.CardCount;
        });
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
//    outward on both sides; mirroring reverses the winding, which is restored by swapping two corners.
function ProjectWheelFacets(Tyre, Rim, Mirrored)
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
    Append(Tyre, 1.0);
    Append(Rim, RimScale);
    return Facets;
}

function ProjectTranslation(PositionX, PositionY, PositionZ)
{
    return ConstructRigidTransform([PositionX, PositionY, PositionZ], [0.0, 0.0, 0.0, 1.0]);
}
