//============================================================================================================================================
//                                                          CABINSTRUCTURE.JS
//============================================================================================================================================
// 🧩 The ControlVehicle cabin the authored shell never carried: dash, seats, glass, a steering wheel with its own
//    dashboard, and the HMI demo's two screens — procedural facets in the body (CoM) frame, placed by the fixtures
//    of Projects/Project-Drive's DriveCabinLayout.h.

// 📝 The .blend carries no cabin sockets, so DriveCabinLayout ESTIMATES the fixtures from the shell (cowl at
//    X +1.335 / Z +0.735 in the model frame, roof at Z +1.35, driver 0.42 m left of centre) and this module does the
//    same, rebased onto the centre of mass exactly as ProjectBodyFacets rebases the body (Z − 0.11285 m). The
//    native HMI demo (DriveCabinDisplays) draws its cluster and tablet as emissive sheets floating in an empty
//    shell — the screenshot in Exhibits/Gallery/ProjectDrive/live/sdf-gi-cockpit.png shows both screens hanging in
//    a bare tub. Here the sheets sit in a dash that reaches them, and the cluster's job moves onto the steering
//    wheel, F1-style: an RPM bar across the wheel screen and four tyre cells beneath it, lit per frame by the host
//    through the occupants' material overrides (SurfaceRaster honours Occupant.MaterialOverride per occupant).
//
// 📝 Occupant plan (FacetStructure.ConstructScene registers them after the yard, outside the distance span, so the
//    scene distance field and its occupant identities never see them — the body volume already encloses the cabin):
//      trim · glass (own occupant, sun-exempt, collapsed by SurfaceRaster in interior views) · cluster screen ·
//      tablet screen · 10 cluster RPM cells · 8 tablet tiles (static) · steering wheel (rim, spokes, hub, its
//      dashboard screen) · 12 wheel RPM cells · 4 wheel tyre cells.
//    Every cabin occupant is Raster|Dynamic; the host re-poses the rig each frame from the body transform, the
//    wheel additionally taking the steering lock. Display cells share one unit-quad facet set, so all of them
//    raster as a single instanced run.

import { CourseMaterial } from "./MaterialSpecification.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                       FIXTURES
//------------------------------------------------------------------------------------------------------------------------

// 📝 DriveCabinLayout.h, model frame → CoM frame (Z − 0.11285 m). Wheel centre and radius are placed from the
//    cluster and the driver eye of the same fixture sheet: the wheel stands between them, a hand ahead of the eye.
const CoMRebase = 0.11285;   // [m]

export const CabinFixtures = Object.freeze({
    Cluster:    { Centre: [0.86, 0.42, 0.92 - CoMRebase], Tilt: 0.14, Width: 0.34, Height: 0.19 },
    Tablet:     { Centre: [0.98, 0.00, 0.62 - CoMRebase], Tilt: 0.42, Width: 0.30, Height: 0.19 },
    DriverEye:  [-0.20, 0.42, 1.12 - CoMRebase],
    DriverPitch: 0.21,          // [rad] the cockpit camera's downward tilt (CabinDriverEyeFixture)
    DriverFieldOfView: 1.22,    // [rad]
    WheelCentre: [0.58, 0.42, 0.70],
    WheelTilt:   0.38,          // [rad] wheel axis leaning back from vertical
    WheelRadius: 0.175          // [m]
});

// 📝 A screen's viewer frame, DriveCabinLayout's CabinScreenBasis: Right is the viewer's right (−Y, the car's
//    right), Up leans back with the tilt, Toward faces the driver.
function ScreenFrame(Fixture)
{
    const { Centre, Tilt } = Fixture;
    return { Centre,
             Right:  [0.0, -1.0, 0.0],
             Up:     [Math.sin(Tilt), 0.0, Math.cos(Tilt)],
             Toward: [-Math.cos(Tilt), 0.0, Math.sin(Tilt)] };
}

// 📐 Column-major basis transform (x = XAxis·Scale[0], …), the matrix an occupant record carries.
export function ComposeBasisTransform(Origin, XAxis, YAxis, ZAxis, Scale = [1.0, 1.0, 1.0])
{
    const Transform = new Float32Array(16);
    Transform[0] = XAxis[0] * Scale[0]; Transform[1] = XAxis[1] * Scale[0]; Transform[2]  = XAxis[2] * Scale[0];
    Transform[4] = YAxis[0] * Scale[1]; Transform[5] = YAxis[1] * Scale[1]; Transform[6]  = YAxis[2] * Scale[1];
    Transform[8] = ZAxis[0] * Scale[2]; Transform[9] = ZAxis[1] * Scale[2]; Transform[10] = ZAxis[2] * Scale[2];
    Transform[12] = Origin[0];          Transform[13] = Origin[1];         Transform[14] = Origin[2];
    Transform[15] = 1.0;
    return Transform;
}

// 📝 One display cell on a screen: centre offset (U along Right, V along Up) [m], size [m], floated Lift [m] off
//    the sheet so it never z-fights the screen beneath it. The cell's local X faces the driver.
function ScreenCellTransform(Frame, U, V, Width, Height, Lift = 0.006)
{
    const Origin = [0, 1, 2].map((Axis) => Frame.Centre[Axis] + Frame.Right[Axis] * U + Frame.Up[Axis] * V + Frame.Toward[Axis] * Lift);
    return ComposeBasisTransform(Origin, Frame.Toward, Frame.Right, Frame.Up, [1.0, Width, Height]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FACET EMISSION
//------------------------------------------------------------------------------------------------------------------------

function Quad(Facets, A, B, C, D, Family)
{
    Facets.push({ Corners: [A, B, C], Family });
    Facets.push({ Corners: [A, C, D], Family });
}

// 📝 An axis-aligned box by centre and full extents.
function Box(Facets, Centre, Extents, Family)
{
    const [X, Y, Z] = [0, 1, 2].map((Axis) => Extents[Axis] / 2.0);
    const [Cx, Cy, Cz] = Centre;
    Quad(Facets, [Cx - X, Cy - Y, Cz + Z], [Cx + X, Cy - Y, Cz + Z], [Cx + X, Cy + Y, Cz + Z], [Cx - X, Cy + Y, Cz + Z], Family);
    Quad(Facets, [Cx - X, Cy + Y, Cz - Z], [Cx + X, Cy + Y, Cz - Z], [Cx + X, Cy - Y, Cz - Z], [Cx - X, Cy - Y, Cz - Z], Family);
    Quad(Facets, [Cx + X, Cy - Y, Cz - Z], [Cx + X, Cy + Y, Cz - Z], [Cx + X, Cy + Y, Cz + Z], [Cx + X, Cy - Y, Cz + Z], Family);
    Quad(Facets, [Cx - X, Cy + Y, Cz - Z], [Cx - X, Cy - Y, Cz - Z], [Cx - X, Cy - Y, Cz + Z], [Cx - X, Cy + Y, Cz + Z], Family);
    Quad(Facets, [Cx + X, Cy + Y, Cz - Z], [Cx - X, Cy + Y, Cz - Z], [Cx - X, Cy + Y, Cz + Z], [Cx + X, Cy + Y, Cz + Z], Family);
    Quad(Facets, [Cx - X, Cy - Y, Cz - Z], [Cx + X, Cy - Y, Cz - Z], [Cx + X, Cy - Y, Cz + Z], [Cx - X, Cy - Y, Cz + Z], Family);
}

// 📝 A box stretched between two points (pillars, the steering column): Width across, Thickness deep.
function Beam(Facets, From, To, Width, Thickness, Family)
{
    const Axis = [To[0] - From[0], To[1] - From[1], To[2] - From[2]];
    const Length = Math.hypot(...Axis);
    const Direction = Axis.map((Scalar) => Scalar / Length);
    const Reference = Math.abs(Direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const Side = Cross(Direction, Reference), Deep = Cross(Side, Direction);
    const Corners = [];
    for (const End of [From, To])
        for (const [S, D] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
            Corners.push([0, 1, 2].map((A) => End[A] + Side[A] * S * Width / 2.0 + Deep[A] * D * Thickness / 2.0));
    for (let Face = 0; Face < 4; ++Face)
    {
        const Next = (Face + 1) % 4;
        Quad(Facets, Corners[Face], Corners[Next], Corners[Next + 4], Corners[Face + 4], Family);
    }
    Quad(Facets, Corners[3], Corners[2], Corners[1], Corners[0], Family);
    Quad(Facets, Corners[4], Corners[5], Corners[6], Corners[7], Family);
}

function Cross(Left, Right)
{
    return [Left[1] * Right[2] - Left[2] * Right[1], Left[2] * Right[0] - Left[0] * Right[2], Left[0] * Right[1] - Left[1] * Right[0]];
}

// 📝 A single quad in a viewer frame, normal toward the viewer (Right × Up).
function Panel(Facets, Centre, Right, Up, Width, Height, Family)
{
    const Corner = (R, U) => [0, 1, 2].map((Axis) => Centre[Axis] + Right[Axis] * R * Width / 2.0 + Up[Axis] * U * Height / 2.0);
    Quad(Facets, Corner(-1, -1), Corner(1, -1), Corner(1, 1), Corner(-1, 1), Family);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         TRIM
//------------------------------------------------------------------------------------------------------------------------

// 📝 Dash, stack, tunnel, seats, door cards, headliner and pillars in the CoM frame. The shell's own bounds are
//    X −3.11…3.11 (the cabin lives in −1.6…1.35), half-width 1.25 at the cowl narrowing inside, roof at Z 1.24.
export function EmitCabinTrimFacets()
{
    const Facets = [];
    const Trim = CourseMaterial.CabinTrim, Seat = CourseMaterial.CabinSeat;

    // dash top from the cowl line down to the fascia, and the fascia the screens mount on
    Quad(Facets, [1.34, -1.04, 0.600], [1.34, 1.04, 0.600], [0.82, 1.04, 0.525], [0.82, -1.04, 0.525], Trim);
    Quad(Facets, [0.82, -1.04, 0.280], [0.82, 1.04, 0.280], [0.82, 1.04, 0.525], [0.82, -1.04, 0.525], Trim);
    Box(Facets, [0.92, 0.42, 0.845], [0.14, 0.46, 0.10], Trim);                    // cluster hood
    Box(Facets, [0.95, 0.00, 0.300], [0.24, 0.36, 0.44], Trim);                    // centre stack under the tablet
    Box(Facets, [-0.10, 0.00, 0.170], [1.75, 0.34, 0.22], Trim);                   // transmission tunnel
    Quad(Facets, [1.05, -1.04, 0.03], [1.05, 1.04, 0.03], [-1.55, 1.04, 0.03], [-1.55, -1.04, 0.03], Trim);   // floor

    // front seats and the rear bench
    for (const Side of [0.42, -0.42])
    {
        Box(Facets, [-0.30, Side, 0.220], [0.55, 0.52, 0.13], Seat);
        Box(Facets, [-0.60, Side, 0.520], [0.13, 0.52, 0.55], Seat);
        Box(Facets, [-0.63, Side, 0.920], [0.11, 0.27, 0.17], Seat);
    }
    Box(Facets, [-1.25, 0.00, 0.240], [0.45, 1.50, 0.13], Seat);
    Box(Facets, [-1.50, 0.00, 0.550], [0.13, 1.50, 0.55], Seat);
    Quad(Facets, [-1.05, -0.95, 0.78], [-1.05, 0.95, 0.78], [-1.50, 0.95, 0.82], [-1.50, -0.95, 0.82], Trim);  // parcel shelf

    // door cards, headliner, A-pillars, the mirror and the cabin lamp of DriveCabinLayout
    for (const Side of [1.05, -1.05])
        Quad(Facets, [1.05, Side, 0.14], [-1.30, Side, 0.14], [-1.30, Side, 0.70], [1.05, Side, 0.70], Trim);
    Quad(Facets, [0.52, -0.95, 1.205], [0.52, 0.95, 1.205], [-1.18, 0.95, 1.205], [-1.18, -0.95, 1.205], Trim);
    for (const Side of [1.00, -1.00])
        Beam(Facets, [1.30, Side, 0.60], [0.50, Side * 0.86, 1.19], 0.070, 0.050, Trim);
    Box(Facets, [0.47, 0.00, 1.06], [0.035, 0.30, 0.10], Trim);
    Beam(Facets, [0.50, 0.00, 1.18], [0.47, 0.00, 1.10], 0.020, 0.020, Trim);
    Panel(Facets, [0.15, 0.00, 1.195], [0, 1, 0], [1, 0, 0], 0.07, 0.16, CourseMaterial.StripLight);

    // the steering column, from the fascia to the wheel the host spins
    Beam(Facets, [0.82, 0.42, 0.60], [0.60, 0.42, 0.685], 0.055, 0.055, Trim);
    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STEERING WHEEL
//------------------------------------------------------------------------------------------------------------------------

// 📝 The wheel in its own frame: origin at its centre, +X toward the driver, the rim in the Y–Z plane. The host
//    composes body · tilt · steering spin over this frame, and the dashboard cells ride in it too.
export function EmitSteeringWheelFacets()
{
    const Facets = [];
    const Trim = CourseMaterial.CabinTrim;

    // rim: a torus of 28 × 8 segments
    const Around = 28, Tube = 8, Ring = CabinFixtures.WheelRadius, TubeRadius = 0.016;
    const RingPoint = (A, B) =>
    {
        const RingCentre = [0.0, Ring * Math.cos(A), Ring * Math.sin(A)];
        const Radial = [0.0, Math.cos(A), Math.sin(A)];
        return [RingCentre[0] + TubeRadius * Math.sin(B),
                RingCentre[1] + TubeRadius * Math.cos(B) * Radial[1],
                RingCentre[2] + TubeRadius * Math.cos(B) * Radial[2]];
    };
    for (let Segment = 0; Segment < Around; ++Segment)
    {
        const A0 = (Segment / Around) * 2.0 * Math.PI, A1 = ((Segment + 1) / Around) * 2.0 * Math.PI;
        for (let Step = 0; Step < Tube; ++Step)
        {
            const B0 = (Step / Tube) * 2.0 * Math.PI, B1 = ((Step + 1) / Tube) * 2.0 * Math.PI;
            Quad(Facets, RingPoint(A0, B0), RingPoint(A1, B0), RingPoint(A1, B1), RingPoint(A0, B1), Trim);
        }
    }

    // three spokes and the hub barrel
    Box(Facets, [0.0,  0.095, 0.0], [0.028, 0.170, 0.040], Trim);
    Box(Facets, [0.0, -0.095, 0.0], [0.028, 0.170, 0.040], Trim);
    Box(Facets, [0.0,  0.000, -0.095], [0.028, 0.040, 0.170], Trim);
    const HubSegments = 18, HubRadius = 0.058;
    for (let Segment = 0; Segment < HubSegments; ++Segment)
    {
        const A0 = (Segment / HubSegments) * 2.0 * Math.PI, A1 = ((Segment + 1) / HubSegments) * 2.0 * Math.PI;
        const P = (A, X) => [X, HubRadius * Math.cos(A), HubRadius * Math.sin(A)];
        Quad(Facets, P(A0, -0.030), P(A1, -0.030), P(A1, 0.035), P(A0, 0.035), Trim);
        Facets.push({ Corners: [[0.035, 0.0, 0.0], P(A0, 0.035), P(A1, 0.035)], Family: Trim });
        Facets.push({ Corners: [[-0.030, 0.0, 0.0], P(A1, -0.030), P(A0, -0.030)], Family: Trim });
    }

    // the dashboard the wheel carries: bezel and its screen, facing the driver
    Box(Facets, [0.028, 0.0, 0.0], [0.035, 0.235, 0.140], Trim);
    Panel(Facets, [0.047, 0.0, 0.0], [0, 1, 0], [0, 0, 1], 0.210, 0.115, CourseMaterial.CabinScreen);
    return Facets;
}

// 📝 The unit display quad every screen and cell occupant draws: facing +X in the Y–Z plane, centred on its origin,
//    so a ComposeBasisTransform places, orientates and stretches it (x = the facing axis, y = width, z = height).
export function EmitUnitQuadFacets()
{
    const Facets = [];
    Quad(Facets, [0.0, -0.5, -0.5], [0.0, 0.5, -0.5], [0.0, 0.5, 0.5], [0.0, -0.5, 0.5], CourseMaterial.CellOff);
    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      CELL PLAN
//------------------------------------------------------------------------------------------------------------------------

// 📝 Where every screen, cell and tile sits, in the frame of its parent (Parent "body" = the cabin/CoM frame,
//    "wheel" = the steering-wheel frame). Screens and static tiles carry the family they always show; the RPM and
//    tyre cells are lit per frame by the host (RefreshCabinDisplays) through the material override.
export function ConstructCabinCellPlan()
{
    const Identity = ComposeBasisTransform([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const Cluster = ScreenFrame(CabinFixtures.Cluster), Tablet = ScreenFrame(CabinFixtures.Tablet);
    const Plan = { ClusterScreen: ScreenCellTransform(Cluster, 0, 0, CabinFixtures.Cluster.Width, CabinFixtures.Cluster.Height, 0.0),
                   TabletScreen:  ScreenCellTransform(Tablet, 0, 0, CabinFixtures.Tablet.Width, CabinFixtures.Tablet.Height, 0.0),
                   ClusterCells: [], TabletTiles: [], WheelCells: [], WheelTyreCells: [] };

    // the cluster's RPM bar along its lower edge
    for (let Cell = 0; Cell < 10; ++Cell)
        Plan.ClusterCells.push(ScreenCellTransform(Cluster, -0.132 + Cell * 0.027, -0.062, 0.021, 0.020));

    // the tablet's launcher tiles, the HMI demo's app grid — static colours, set once at scene construction
    const TileFamilies = [CourseMaterial.CellCyan, CourseMaterial.CellGreen, CourseMaterial.CellAmber, CourseMaterial.WallCobalt,
                          CourseMaterial.CellGreen, CourseMaterial.CellCyan, CourseMaterial.ContainerOrange, CourseMaterial.CellAmber];
    for (let Tile = 0; Tile < 8; ++Tile)
        Plan.TabletTiles.push({ Local: ScreenCellTransform(Tablet, -0.105 + (Tile % 4) * 0.070, Tile < 4 ? 0.048 : -0.048, 0.052, 0.036),
                                Family: TileFamilies[Tile] });

    // the wheel dashboard: twelve RPM cells across the top of its screen, four tyre cells beneath
    for (let Cell = 0; Cell < 12; ++Cell)
        Plan.WheelCells.push(ComposeBasisTransform([0.052, -0.0935 + Cell * 0.017, 0.036],
                                                   [1, 0, 0], [0, 1, 0], [0, 0, 1], [1.0, 0.0135, 0.018]));
    for (let Cell = 0; Cell < 4; ++Cell)
        Plan.WheelTyreCells.push(ComposeBasisTransform([0.052, -0.045 + Cell * 0.030, -0.036],
                                                       [1, 0, 0], [0, 1, 0], [0, 0, 1], [1.0, 0.020, 0.018]));
    Plan.Identity = Identity;
    return Plan;
}
