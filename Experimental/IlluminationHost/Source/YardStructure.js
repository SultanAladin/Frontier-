//============================================================================================================================================
//                                                             YARDSTRUCTURE.JS
//============================================================================================================================================
// 🧩 The drift yard: asphalt and markings, warehouse, container stacks, barriers, floodlights, kerbs, ramp and the breakable smash zone.

// 📝 A 120 m asphalt pad (the GroundLayout the card depot tiles) laid out for driving and for the indirect term:
//
//    | Area                 | Where (x, y) [m]           | What it is for                                              |
//    |----------------------|----------------------------|-------------------------------------------------------------|
//    | burnout box          | centred on the spawn       | line-lock burnouts in place (B)                             |
//    | figure eight         | circles at (24, ±9)        | drifting round painted rings                                |
//    | warehouse            | −28…12 × 30…54             | open door, skylights, strip lights: bounce light and smoke  |
//    |                      |                            | trapped under a roof                                        |
//    | container wall       | x ≈ 57, y −42…42           | coloured walls for colour bleeding, stacked two high        |
//    | barrier straight     | y = −45                    | constant-slope concrete barriers, breakable at speed        |
//    | smash zone           | y −36…−27                  | glass panels, crates, crash barrels, concrete blocks        |
//    | ramp                 | x −42…−36                  | Project-Drive's ramp, moved to the west run-up              |
//
//    Long walls and roofs are built from 8 m modules so each facet set's distance volume keeps a fine voxel — one
//    40 m wall would be stretched across 128 texels at 31 cm and leak light. Every module is one facet set placed by
//    many occupants, so the raster draws them as instanced runs.

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets, EmitRampFacets, KerbConstants } from "./CourseStructure.js";
import { ConstructRigidTransform, ConstructAxisQuaternion } from "./TransformProjection.js";

export const YardLayout = Object.freeze({
    PadHalfExtent:   60.0,    // [m]
    SurroundExtent:  240.0,   // [m]
    MarkingLift:     0.008,   // [m]  paint above the asphalt
    ApronLift:       0.005,   // [m]  the concrete apron above the asphalt
    Warehouse: { MinimumX: -28.0, MaximumX: 12.0, MinimumY: 30.0, MaximumY: 54.0, Height: 8.0, Wall: 0.4,
                 DoorMinimumX: -16.0, DoorMaximumX: 0.0, DoorHeight: 6.0, Roof: 0.3, Skylight: 2.0 },
    ContainerExtent: [6.06, 2.44, 2.59],   // [m] ISO 20 ft
    BarrierLength:   3.0                   // [m]
});

// 📝 The breakable props and their fracture defaults — FractureSpecification's recipe keys plus what the exhibit needs
//    to break them when struck: a mass, the impact energy below which the prop holds, and the faces a cut exposes.
export const BreakableKinds = Object.freeze({
    Crate:   { Name: "Wooden crate",   Material: "wood",     Primitive: "box",      Extent: [0.9, 0.9, 0.9],   Mass: 28.0,   BreakEnergy: 600.0,
               Family: CourseMaterial.CrateWood, Core: CourseMaterial.CrateCore, Ceiling: 26, MinimumSize: 0.06 },
    Barrel:  { Name: "Crash barrel",   Material: "plastic",  Primitive: "cylinder", Extent: [0.84, 0.84, 0.95], Mass: 45.0,  BreakEnergy: 2500.0,
               Family: CourseMaterial.BarrelPlastic, Core: CourseMaterial.BarrelCore, Ceiling: 16, MinimumSize: 0.08 },
    Pane:    { Name: "Glass panel",    Material: "tempered", Primitive: "pane",     Extent: [0.04, 2.4, 1.5],   Mass: 36.0,   BreakEnergy: 150.0,
               Family: CourseMaterial.GlassPane, Core: CourseMaterial.GlassPane, Ceiling: 110, MinimumSize: 0.03 },
    Block:   { Name: "Concrete block", Material: "concrete", Primitive: "box",      Extent: [1.2, 0.6, 0.6],   Mass: 1000.0, BreakEnergy: 30000.0,
               Family: CourseMaterial.BlockConcrete, Core: CourseMaterial.BlockCore, Ceiling: 36, MinimumSize: 0.06 },
    Barrier: { Name: "Concrete barrier", Material: "concrete", Primitive: "barrier", Extent: [3.0, 0.6, 0.81],  Mass: 1950.0, BreakEnergy: 110000.0,
               Family: CourseMaterial.Barrier, Core: CourseMaterial.BarrierCore, Ceiling: 32, MinimumSize: 0.08 }
});

// 📝 The constant-slope barrier's cross-section (y, z) [m], convex so the fracture blank is the barrier itself.
export const BarrierProfile = Object.freeze([[-0.3, 0.0], [0.3, 0.0], [0.3, 0.08], [0.1, 0.81], [-0.1, 0.81], [-0.3, 0.08]]);

//------------------------------------------------------------------------------------------------------------------------
//                                                   FACET EMISSION
//------------------------------------------------------------------------------------------------------------------------

function EmitQuad(Facets, A, B, C, D, Family)
{
    Facets.push({ Corners: [A, B, C], Family });
    Facets.push({ Corners: [A, C, D], Family });
}

// 📝 An axis-aligned box between two corners, outward winding.
export function EmitBlockFacets(Facets, Minimum, Maximum, Family)
{
    const [X0, Y0, Z0] = Minimum, [X1, Y1, Z1] = Maximum;
    EmitQuad(Facets, [X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], Family);
    EmitQuad(Facets, [X0, Y1, Z0], [X1, Y1, Z0], [X1, Y0, Z0], [X0, Y0, Z0], Family);
    EmitQuad(Facets, [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], [X1, Y0, Z1], Family);
    EmitQuad(Facets, [X0, Y1, Z0], [X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], Family);
    EmitQuad(Facets, [X1, Y1, Z0], [X0, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1], Family);
    EmitQuad(Facets, [X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], Family);
    return Facets;
}

// 📝 A convex polygon in (y, z) extruded along x over ±Length/2: side quads and two fan caps, outward winding.
export function EmitExtrusionFacets(Profile, Length, Family)
{
    const Facets = [], Half = 0.5 * Length;
    for (let Index = 0; Index < Profile.length; ++Index)
    {
        const [Y0, Z0] = Profile[Index], [Y1, Z1] = Profile[(Index + 1) % Profile.length];
        EmitQuad(Facets, [-Half, Y0, Z0], [Half, Y0, Z0], [Half, Y1, Z1], [-Half, Y1, Z1], Family);
    }
    for (let Index = 1; Index + 1 < Profile.length; ++Index)
    {
        Facets.push({ Corners: [[Half, ...Profile[0]], [Half, ...Profile[Index]], [Half, ...Profile[Index + 1]]], Family });
        Facets.push({ Corners: [[-Half, ...Profile[0]], [-Half, ...Profile[Index + 1]], [-Half, ...Profile[Index]]], Family });
    }
    return Facets;
}

// 📝 A solid of revolution about +Z from a profile of (radius, height) pairs, bottom to top, capped at both ends.
export function EmitLatheFacets(Profile, Segments, Family)
{
    const Facets = [];
    const Ring = (Radius, Height, Segment) =>
    {
        const θ = (2.0 * Math.PI * Segment) / Segments;
        return [Radius * Math.cos(θ), Radius * Math.sin(θ), Height];
    };
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        for (let Step = 0; Step + 1 < Profile.length; ++Step)
        {
            const [R0, H0] = Profile[Step], [R1, H1] = Profile[Step + 1];
            EmitQuad(Facets, Ring(R0, H0, Segment), Ring(R0, H0, Segment + 1), Ring(R1, H1, Segment + 1), Ring(R1, H1, Segment), Family);
        }
        const [RB, HB] = Profile[0], [RT, HT] = Profile[Profile.length - 1];
        Facets.push({ Corners: [[0.0, 0.0, HT], Ring(RT, HT, Segment), Ring(RT, HT, Segment + 1)], Family });
        Facets.push({ Corners: [[0.0, 0.0, HB], Ring(RB, HB, Segment + 1), Ring(RB, HB, Segment)], Family });
    }
    return Facets;
}

// 📝 A 20 ft container local to its bottom centre, long axis +X: the box, vertical corrugation ribs on both long sides
//    and a door frame at the +X end.
function EmitContainerFacets(Family)
{
    const [Length, Width, Height] = YardLayout.ContainerExtent;
    const Facets = EmitBlockFacets([], [-0.5 * Length, -0.5 * Width, 0.0], [0.5 * Length, 0.5 * Width, Height], Family);
    for (let Rib = 0; Rib < 9; ++Rib)
    {
        const X = -0.5 * Length + 0.42 + Rib * ((Length - 0.84) / 8.0);
        for (const Side of [-1.0, 1.0])
        {
            const Inner = Side * 0.5 * Width, Outer = Side * (0.5 * Width + 0.045);
            EmitBlockFacets(Facets, [X - 0.07, Math.min(Inner, Outer), 0.12], [X + 0.07, Math.max(Inner, Outer), Height - 0.12], Family);
        }
    }
    EmitBlockFacets(Facets, [0.5 * Length, -0.5 * Width + 0.06, 0.06], [0.5 * Length + 0.05, -0.5 * Width + 0.18, Height - 0.06], Family);
    EmitBlockFacets(Facets, [0.5 * Length, 0.5 * Width - 0.18, 0.06], [0.5 * Length + 0.05, 0.5 * Width - 0.06, Height - 0.06], Family);
    return Facets;
}

// 📝 A floodlight pole local to its foot: a tapered shaft, an arm reaching +X and a lamp head whose underside emits.
function EmitPoleFacets()
{
    const Facets = EmitLatheFacets([[0.13, 0.0], [0.13, 0.35], [0.09, 0.4], [0.07, 9.0]], 10, CourseMaterial.PoleMetal);
    EmitBlockFacets(Facets, [0.0, -0.06, 8.75], [1.55, 0.06, 8.87], CourseMaterial.PoleMetal);
    EmitBlockFacets(Facets, [1.1, -0.32, 8.6], [1.85, 0.32, 8.78], CourseMaterial.PoleMetal);
    EmitBlockFacets(Facets, [1.14, -0.28, 8.56], [1.81, 0.28, 8.6], CourseMaterial.Floodlight);
    return Facets;
}

// 📝 One roof module local to its bottom centre, with a strip light under it so the light is part of the module.
function EmitRoofFacets(Length, Depth)
{
    const Thickness = YardLayout.Warehouse.Roof;
    const Facets = EmitBlockFacets([], [-0.5 * Length, -0.5 * Depth, 0.0], [0.5 * Length, 0.5 * Depth, Thickness], CourseMaterial.WarehouseRoof);
    EmitBlockFacets(Facets, [-0.5 * Length + 0.4, -0.16, -0.08], [0.5 * Length - 0.4, 0.16, 0.0], CourseMaterial.StripLight);
    return Facets;
}

// 📝 The breakable props as facet sets local to their bottom centre — the same shapes the fracture blank is built from.
export function EmitBreakableFacets(Kind)
{
    const [X, Y, Z] = Kind.Extent;
    if (Kind.Primitive === "cylinder")
        return EmitLatheFacets([[0.5 * X, 0.0], [0.5 * X, Z]], 20, Kind.Family);
    if (Kind.Primitive === "barrier")
        return EmitExtrusionFacets(BarrierProfile, X, Kind.Family);
    return EmitBlockFacets([], [-0.5 * X, -0.5 * Y, 0.0], [0.5 * X, 0.5 * Y, Z], Kind.Family);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   GROUND AND PAINT
//------------------------------------------------------------------------------------------------------------------------

function EmitStrip(Facets, From, To, Width, Lift, Family)
{
    const Dx = To[0] - From[0], Dy = To[1] - From[1], Length = Math.hypot(Dx, Dy);
    const Nx = -Dy / Length * 0.5 * Width, Ny = Dx / Length * 0.5 * Width;
    EmitQuad(Facets, [From[0] - Nx, From[1] - Ny, Lift], [To[0] - Nx, To[1] - Ny, Lift], [To[0] + Nx, To[1] + Ny, Lift],
             [From[0] + Nx, From[1] + Ny, Lift], Family);
}

function EmitDashes(Facets, From, To, Width, Dash, Gap, Lift, Family)
{
    const Length = Math.hypot(To[0] - From[0], To[1] - From[1]);
    for (let Start = 0.0; Start < Length; Start += Dash + Gap)
    {
        const End = Math.min(Length, Start + Dash);
        const At = (Distance) => [From[0] + (To[0] - From[0]) * Distance / Length, From[1] + (To[1] - From[1]) * Distance / Length];
        EmitStrip(Facets, At(Start), At(End), Width, Lift, Family);
    }
}

function EmitRing(Facets, CentreX, CentreY, Radius, Width, Segments, Lift, Family)
{
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        const θ0 = (2.0 * Math.PI * Segment) / Segments, θ1 = (2.0 * Math.PI * (Segment + 1)) / Segments;
        const Point = (θ, R) => [CentreX + R * Math.cos(θ), CentreY + R * Math.sin(θ), Lift];
        EmitQuad(Facets, Point(θ0, Radius - 0.5 * Width), Point(θ1, Radius - 0.5 * Width), Point(θ1, Radius + 0.5 * Width),
                 Point(θ0, Radius + 0.5 * Width), Family);
    }
}

function EmitRectangle(Facets, MinimumX, MinimumY, MaximumX, MaximumY, Width, Lift, Family)
{
    EmitStrip(Facets, [MinimumX, MinimumY], [MaximumX, MinimumY], Width, Lift, Family);
    EmitStrip(Facets, [MaximumX, MinimumY], [MaximumX, MaximumY], Width, Lift, Family);
    EmitStrip(Facets, [MaximumX, MaximumY], [MinimumX, MaximumY], Width, Lift, Family);
    EmitStrip(Facets, [MinimumX, MaximumY], [MinimumX, MinimumY], Width, Lift, Family);
}

// 📝 World-space ground: the gravel surround 2 cm down (as EmitCourseTriangles() authored it), the asphalt pad at zero,
//    the warehouse's concrete apron a few millimetres up, and paint a few more — enough separation for the reversed
//    depth to keep them apart at the far end of the pad.
export function EmitYardGroundFacets()
{
    const Facets = [];
    const Outer = YardLayout.SurroundExtent, Pad = YardLayout.PadHalfExtent, Lift = YardLayout.MarkingLift;
    EmitQuad(Facets, [-Outer, -Outer, -0.02], [Outer, -Outer, -0.02], [Outer, Outer, -0.02], [-Outer, Outer, -0.02], CourseMaterial.Gravel);
    EmitQuad(Facets, [-Pad, -Pad, 0.0], [Pad, -Pad, 0.0], [Pad, Pad, 0.0], [-Pad, Pad, 0.0], CourseMaterial.Asphalt);
    const House = YardLayout.Warehouse;
    EmitQuad(Facets, [House.MinimumX - 2.0, 22.4, YardLayout.ApronLift], [House.MaximumX + 2.0, 22.4, YardLayout.ApronLift],
             [House.MaximumX + 2.0, House.MaximumY + 1.0, YardLayout.ApronLift], [House.MinimumX - 2.0, House.MaximumY + 1.0, YardLayout.ApronLift],
             CourseMaterial.Apron);
    // ① burnout box with its launch line
    EmitRectangle(Facets, -5.0, -2.6, 5.0, 2.6, 0.15, Lift, CourseMaterial.PaintWhite);
    EmitStrip(Facets, [6.0, -2.6], [6.0, 2.6], 0.4, Lift, CourseMaterial.PaintYellow);
    // ② the figure eight
    EmitRing(Facets, 24.0, 9.0, 8.0, 0.16, 72, Lift, CourseMaterial.PaintWhite);
    EmitRing(Facets, 24.0, -9.0, 8.0, 0.16, 72, Lift, CourseMaterial.PaintWhite);
    EmitRing(Facets, 24.0, 9.0, 0.5, 0.2, 16, Lift, CourseMaterial.PaintYellow);
    EmitRing(Facets, 24.0, -9.0, 0.5, 0.2, 16, Lift, CourseMaterial.PaintYellow);
    // ③ the smash lane and the yard's edge
    EmitStrip(Facets, [-36.0, -26.5], [34.0, -26.5], 0.15, Lift, CourseMaterial.PaintWhite);
    EmitStrip(Facets, [-36.0, -37.5], [34.0, -37.5], 0.15, Lift, CourseMaterial.PaintWhite);
    EmitDashes(Facets, [-56.0, -56.0], [56.0, -56.0], 0.15, 3.0, 2.0, Lift, CourseMaterial.PaintYellow);
    EmitDashes(Facets, [-56.0, -56.0], [-56.0, 56.0], 0.15, 3.0, 2.0, Lift, CourseMaterial.PaintYellow);
    EmitDashes(Facets, [-56.0, 56.0], [52.0, 56.0], 0.15, 3.0, 2.0, Lift, CourseMaterial.PaintYellow);
    // ④ bays on the apron
    for (let Bay = 0; Bay <= 6; ++Bay)
        EmitStrip(Facets, [-26.0 + Bay * 5.6, 23.2], [-26.0 + Bay * 5.6, 28.6], 0.12, YardLayout.ApronLift + 0.003, CourseMaterial.PaintYellow);
    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PLACEMENT
//------------------------------------------------------------------------------------------------------------------------

function Place(X, Y, Z = 0.0, Yaw = 0.0)
{
    return ConstructRigidTransform([X, Y, Z], ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw));
}

// 📝 Constructs every yard facet set and its static occupants on Scene. Breakables are listed with their kind and
//    occupant so the fracture depot can take them apart. Returns { Breakables }.
export function ConstructYard(Scene, Roles)
{
    const Set = (Name, Facets, Voxel, Density) => Scene.ConstructFacetSet(Name, Facets, Voxel, Density);
    const House = YardLayout.Warehouse;
    const Quarter = Math.PI * 0.5;
    const Wall8   = Set("Warehouse wall 8 m", EmitBlockFacets([], [-4.0, -0.5 * House.Wall, 0.0], [4.0, 0.5 * House.Wall, House.Height], CourseMaterial.WarehouseWall), 0.1, 5.0);
    const Wall4   = Set("Warehouse wall 4 m", EmitBlockFacets([], [-2.0, -0.5 * House.Wall, 0.0], [2.0, 0.5 * House.Wall, House.Height], CourseMaterial.WarehouseWall), 0.1, 5.0);
    const Lintel  = Set("Warehouse lintel", EmitBlockFacets([], [-4.0, -0.5 * House.Wall, 0.0], [4.0, 0.5 * House.Wall, House.Height - House.DoorHeight],
                                                            CourseMaterial.WarehouseWall), 0.1, 5.0);
    const RoofDepth = (House.MaximumY - House.MinimumY - 2.0 * House.Skylight) / 3.0;
    const Roof    = Set("Warehouse roof module", EmitRoofFacets(8.0, RoofDepth), 0.1, 4.0);
    const Dock    = Set("Loading dock", EmitBlockFacets([], [-6.0, -2.0, 0.0], [6.0, 2.0, 1.1], CourseMaterial.DockConcrete), 0.1, 6.0);
    const Box     = Set("Shipping container", EmitContainerFacets(CourseMaterial.ContainerRust), 0.08, 8.0);
    const Tyres   = Set("Tyre stack", EmitLatheFacets([[0.3, 0.0], [0.33, 0.04], [0.33, 0.2], [0.3, 0.24], [0.33, 0.28], [0.33, 0.44], [0.3, 0.48],
                                                       [0.33, 0.52], [0.33, 0.68], [0.3, 0.72], [0.33, 0.76], [0.33, 0.92], [0.3, 0.96]], 16, CourseMaterial.Tyre), 0.04, 12.0);
    const Pole    = Set("Floodlight pole", EmitPoleFacets(), 0.07, 8.0);
    const Kerb    = Set("Course kerb segment", EmitBoxFacets(4.0, KerbConstants.Depth, KerbConstants.Height, CourseMaterial.KerbRed), 0.03, 20.0);
    const Ramp    = Set("Course ramp", EmitRampFacets(), 0.06, 20.0);
    const KindSets = {};
    for (const [Key, Kind] of Object.entries(BreakableKinds))
        KindSets[Key] = Set(`Breakable ${Kind.Name.toLowerCase()}`, EmitBreakableFacets(Kind), Kind.Primitive === "barrier" ? 0.05 : 0.04, 14.0);

    const Static = Roles.Static;
    const Occupy = (Name, FacetSet, Transform, MaterialOverride = -1, Obstacle = true) =>
    {
        const Index = Scene.ConstructOccupant(Name, FacetSet, Transform, Static, MaterialOverride);
        Scene.Occupants[Index].Obstacle = Obstacle;
        return Index;
    };

    // ① warehouse: walls in 8 m and 4 m modules, a lintel over the door, three rows of roof modules between skylights
    for (let Module = 0; Module < 5; ++Module)
        Occupy(`Warehouse back wall ${Module}`, Wall8, Place(House.MinimumX + 4.0 + 8.0 * Module, House.MaximumY - 0.5 * House.Wall));
    for (let Module = 0; Module < 3; ++Module)
    {
        const Y = House.MinimumY + 4.0 + 8.0 * Module;
        Occupy(`Warehouse west wall ${Module}`, Wall8, Place(House.MinimumX + 0.5 * House.Wall, Y, 0.0, Quarter));
        Occupy(`Warehouse east wall ${Module}`, Wall8, Place(House.MaximumX - 0.5 * House.Wall, Y, 0.0, Quarter));
    }
    const Front = House.MinimumY + 0.5 * House.Wall;
    Occupy("Warehouse front wall 0", Wall8, Place(House.MinimumX + 4.0, Front));
    Occupy("Warehouse front wall 1", Wall4, Place(House.DoorMinimumX - 2.0, Front));
    Occupy("Warehouse front wall 2", Wall4, Place(House.DoorMaximumX + 2.0, Front));
    Occupy("Warehouse front wall 3", Wall8, Place(House.MaximumX - 4.0, Front));
    Occupy("Warehouse lintel 0", Lintel, Place(House.DoorMinimumX + 4.0, Front, House.DoorHeight), -1, false);
    Occupy("Warehouse lintel 1", Lintel, Place(House.DoorMaximumX - 4.0, Front, House.DoorHeight), -1, false);
    for (let Row = 0; Row < 3; ++Row)
        for (let Module = 0; Module < 5; ++Module)
            Occupy(`Warehouse roof ${Row}.${Module}`, Roof, Place(House.MinimumX + 4.0 + 8.0 * Module,
                   House.MinimumY + 0.5 * RoofDepth + Row * (RoofDepth + House.Skylight), House.Height), -1, false);
    Occupy("Loading dock", Dock, Place(House.MinimumX + 8.0, House.MaximumY - 2.6));

    // ② containers: the east wall two high in trade colours, and a few loose ones to drift round
    const Liveries = [CourseMaterial.ContainerRust, CourseMaterial.ContainerCobalt, CourseMaterial.ContainerGreen, CourseMaterial.ContainerOrange,
                      CourseMaterial.ContainerWhite, CourseMaterial.ContainerYellow];
    const Height = YardLayout.ContainerExtent[2];
    for (let Slot = 0; Slot < 13; ++Slot)
    {
        const Y = -39.0 + Slot * 6.5;
        Occupy(`Container wall ${Slot}`, Box, Place(57.2, Y, 0.0, Quarter), Liveries[Slot % 6]);
        if (Slot % 4 !== 1)
            Occupy(`Container wall ${Slot} upper`, Box, Place(57.2, Y + 0.4, Height, Quarter), Liveries[(Slot * 5 + 2) % 6]);
    }
    Occupy("Container 0", Box, Place(36.0, -21.0, 0.0, 0.0), CourseMaterial.ContainerCobalt);
    Occupy("Container 1", Box, Place(-36.0, 14.0, 0.0, Quarter), CourseMaterial.ContainerOrange);
    Occupy("Container 1 upper", Box, Place(-36.0, 14.3, Height, Quarter), CourseMaterial.ContainerWhite);
    Occupy("Container 2", Box, Place(38.0, 32.0, 0.0, 0.0), CourseMaterial.ContainerGreen);
    Occupy("Container 3", Box, Place(38.0, 34.5, 0.0, 0.0), CourseMaterial.ContainerRust);
    Occupy("Container 4", Box, Place(-46.0, -24.0, 0.0, 0.35), CourseMaterial.ContainerYellow);

    // ③ tyre stacks at the barrier ends, inside the warehouse and at the container wall's corners
    const Stacks = [[-38.8, -45.0], [38.8, -45.0], [-38.8, -44.3], [38.8, -44.3], [54.6, -44.0], [54.6, 44.0], [-30.8, 14.0], [-30.8, 15.0]];
    for (let Slot = 0; Slot < 7; ++Slot)
        Stacks.push([House.MaximumX - 1.0, House.MinimumY + 3.0 + Slot * 2.6]);
    Stacks.forEach(([X, Y], Slot) => Occupy(`Tyre stack ${Slot}`, Tyres, Place(X, Y)));

    // ④ floodlights round the pad, arms toward the middle; only the shaft is an obstacle
    const Poles = [[-57.0, -57.0], [0.0, -57.0], [52.0, -50.0], [-57.0, 0.0], [52.0, 0.0], [-57.0, 27.0], [26.0, 27.5], [52.0, 50.0]];
    Poles.forEach(([X, Y], Slot) =>
    {
        const Index = Occupy(`Floodlight ${Slot}`, Pole, Place(X, Y, 0.0, Math.atan2(-Y, -X)));
        Scene.Occupants[Index].ObstacleMinimum = [-0.14, -0.14, 0.0];
        Scene.Occupants[Index].ObstacleMaximum = [0.14, 0.14, 9.0];
    });

    // ⑤ kerbs along the apron, red and white; the ramp on the west run-up
    const KerbSegments = Math.round((KerbConstants.FarX - KerbConstants.NearX) / 4.0);
    for (let Segment = 0; Segment < KerbSegments; ++Segment)
        Occupy(`Kerb ${Segment}`, Kerb, Place(KerbConstants.NearX + (Segment + 0.5) * 4.0, KerbConstants.CentreY + 0.5 * KerbConstants.Depth),
               Segment & 1 ? CourseMaterial.KerbWhite : CourseMaterial.KerbRed, false);
    Occupy("Ramp", Ramp, Place(0.0, 0.0), -1, false);

    // ⑥ breakables: the barrier straight, the smash zone, crates in the warehouse doorway
    const Breakables = [];
    const Breakable = (Key, Name, X, Y, Yaw = 0.0, Z = 0.0) =>
    {
        const Index = Occupy(Name, KindSets[Key], Place(X, Y, Z, Yaw));
        const Record = Scene.Occupants[Index];
        Record.Breakable   = Breakables.length;
        Record.BreakEnergy = BreakableKinds[Key].BreakEnergy;
        Record.BreakMass   = BreakableKinds[Key].Mass;
        Breakables.push({ Kind: Key, Occupant: Index, Name, Transform: Record.Transform.slice(), Position: [X, Y, Z], Yaw });
    };
    for (let Slot = 0; Slot < 23; ++Slot)
        Breakable("Barrier", `Barrier ${Slot}`, -33.0 + Slot * YardLayout.BarrierLength, -45.0);
    for (let Slot = 0; Slot < 3; ++Slot)
        Breakable("Pane", `Glass panel ${Slot}`, -24.0 + Slot * 4.0, -32.0, 0.0);
    for (let Slot = 0; Slot < 6; ++Slot)
        Breakable("Crate", `Crate ${Slot}`, -6.0 + (Slot % 3) * 1.0, -33.0 + Math.floor(Slot / 3) * 2.6, 0.08 * Slot);
    for (let Slot = 0; Slot < 5; ++Slot)
        Breakable("Barrel", `Crash barrel ${Slot}`, 8.0, -34.0 + Slot * 1.05);
    for (let Slot = 0; Slot < 4; ++Slot)
        Breakable("Block", `Concrete block ${Slot}`, 20.0 + (Slot & 1) * 0.1, -34.0 + Slot * 1.4, Quarter);
    for (let Slot = 0; Slot < 4; ++Slot)
        Breakable("Crate", `Warehouse crate ${Slot}`, -10.0 + (Slot % 2) * 1.0, 35.0 + Math.floor(Slot / 2) * 1.0, 0.3 * Slot);
    return { Breakables };
}
