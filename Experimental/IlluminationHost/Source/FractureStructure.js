//============================================================================================================================================
//                                                           FRACTURESTRUCTURE.JS
//============================================================================================================================================
// 🧩 Energy-limited convex fracture — closed convex partitioning of a prop, ported from the Frontier Fracture Editor without its dependencies.

// 📝 The Frontier Fracture Editor (Experimental/FractureEditor/FractureStructure.js, branch arena/215a6f39-frontier)
//    partitions a convex blank by repeated plane cuts and pays for each cut out of the impact energy: fragment area is
//    bought at 2·Gc per square metre, Gc being the material's critical strain energy release rate. The piece to cut
//    next is the one with the most volume weighted by its nearness to the impact, exp(−d / 0.65 R), so pieces near
//    the hit are cut first and end up smallest; of eight candidate planes through the piece the cut with the best
//    worst-triangle quality per slenderness is kept, and a cut that leaves a sliver, a piece under the minimum size,
//    or more cost than the energy left is rejected. Tempered glass carries residual stored energy, so it dices.
//
//    This port keeps the algorithm and the material table and drops three.js and the TypeScript sources: a part is a
//    plain list of vertices and convex faces. Two additions serve the exhibit — every face remembers whether a cut
//    exposed it (the core material shows there), and fragments come back centred on their centroid with the rigid
//    description the debris solver integrates. A thin blank's thin axis is found rather than assumed to be z.

// 📝 MATERIALS from Fragmentation/src/fracture/materials.ts — the fields fracture and the solver read.
export const FractureMaterials = Object.freeze({
    concrete: { Label: "Concrete",       Density: 2350.0, Gc: 140.0, StoredEnergy: 0.0,     Restitution: 0.12, Friction: 0.8,  DustPerJoule: 2.2,  Grain: null },
    rock:     { Label: "Stone",          Density: 2700.0, Gc: 95.0,  StoredEnergy: 0.0,     Restitution: 0.10, Friction: 0.9,  DustPerJoule: 1.6,  Grain: null },
    wood:     { Label: "Wood",           Density: 520.0,  Gc: 320.0, StoredEnergy: 0.0,     Restitution: 0.20, Friction: 0.55, DustPerJoule: 0.25, Grain: 0 },
    glass:    { Label: "Glass",          Density: 2500.0, Gc: 7.0,   StoredEnergy: 0.0,     Restitution: 0.12, Friction: 0.28, DustPerJoule: 0.7,  Grain: null },
    tempered: { Label: "Tempered glass", Density: 2500.0, Gc: 7.0,   StoredEnergy: 46000.0, Restitution: 0.10, Friction: 0.35, DustPerJoule: 1.4,  Grain: null },
    plastic:  { Label: "ABS plastic",    Density: 1050.0, Gc: 460.0, StoredEnergy: 0.0,     Restitution: 0.35, Friction: 0.45, DustPerJoule: 0.05, Grain: null }
});

// 📝 FractureSpecification.js Defaults and Limits, the recipe the Fracture editor edits.
export const FractureDefaults = Object.freeze({ Enabled: true, Mode: "dynamic", Material: "concrete", Energy: 2500, Seed: 42, Ceiling: 48,
                                                MinimumSize: 0.045, X: 0, Y: 0, Z: 0 });
export const FractureLimits = Object.freeze({ Energy: [0, 50000], Seed: [1, 999999], Ceiling: [2, 160], MinimumSize: [0.002, 0.3],
                                              X: [-1000, 1000], Y: [-1000, 1000], Z: [-1000, 1000] });

export function NormalizeRecipe(Input = {})
{
    const Recipe = { ...FractureDefaults, Enabled: Input.Enabled !== false, Mode: Input.Mode === "baked" ? "baked" : "dynamic",
                     Material: Object.hasOwn(FractureMaterials, Input.Material) ? Input.Material : FractureDefaults.Material };
    for (const [Key, [Minimum, Maximum]] of Object.entries(FractureLimits))
    {
        const Value = Number(Input[Key] ?? FractureDefaults[Key]);
        Recipe[Key] = Number.isFinite(Value) ? Math.min(Maximum, Math.max(Minimum, Value)) : FractureDefaults[Key];
        if (Key === "Ceiling" || Key === "Seed")
            Recipe[Key] = Math.round(Recipe[Key]);
    }
    return Recipe;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   VECTOR ALGEBRA
//------------------------------------------------------------------------------------------------------------------------

const Subtract = (A, B) => [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
const Add      = (A, B) => [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
const Scale    = (A, S) => [A[0] * S, A[1] * S, A[2] * S];
const Dot      = (A, B) => A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
const Cross    = (A, B) => [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
const Length   = (A) => Math.hypot(A[0], A[1], A[2]);
const Normalize = (A) => { const L = Length(A); return L > 0.0 ? Scale(A, 1.0 / L) : [0.0, 0.0, 0.0]; };

export function ConstructRandom(Seed)
{
    let Accumulator = Seed >>> 0;
    return () =>
    {
        Accumulator = (Math.imul(1664525, Accumulator) + 1013904223) >>> 0;
        return Accumulator / 4294967296;
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONVEX PARTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 A part: { Vertices: [[x, y, z]], Faces: [{ Indices: [counter-clockwise from outside], Interior }] }.

export function ResolveBounds(Part)
{
    const Minimum = [Infinity, Infinity, Infinity], Maximum = [-Infinity, -Infinity, -Infinity];
    for (const Point of Part.Vertices)
        for (let Axis = 0; Axis < 3; ++Axis)
        {
            Minimum[Axis] = Math.min(Minimum[Axis], Point[Axis]);
            Maximum[Axis] = Math.max(Maximum[Axis], Point[Axis]);
        }
    return { Minimum, Maximum, Size: Subtract(Maximum, Minimum), Centre: Scale(Add(Minimum, Maximum), 0.5) };
}

// 📐 Volume and centroid by tetrahedra from the first vertex over every face fan.
export function ResolveMoments(Part)
{
    const Origin = Part.Vertices[0];
    let Volume = 0.0;
    let Centroid = [0.0, 0.0, 0.0];
    for (const Face of Part.Faces)
    {
        const First = Part.Vertices[Face.Indices[0]];
        for (let Slot = 1; Slot + 1 < Face.Indices.length; ++Slot)
        {
            const Second = Part.Vertices[Face.Indices[Slot]], Third = Part.Vertices[Face.Indices[Slot + 1]];
            const Tetra = Dot(Subtract(First, Origin), Cross(Subtract(Second, Origin), Subtract(Third, Origin))) / 6.0;
            Volume += Tetra;
            Centroid = Add(Centroid, Scale(Add(Add(Origin, First), Add(Second, Third)), Tetra * 0.25));
        }
    }
    return { Volume, Centroid: Math.abs(Volume) > 1.0e-15 ? Scale(Centroid, 1.0 / Volume) : Origin.slice() };
}

// 📐 Worst fan-triangle quality 4√3·A / Σ edge², 1 for an equilateral triangle, and the triangle count.
export function ResolveQuality(Part)
{
    let Quality = 1.0, Triangles = 0;
    for (const Face of Part.Faces)
    {
        const First = Part.Vertices[Face.Indices[0]];
        for (let Slot = 1; Slot + 1 < Face.Indices.length; ++Slot)
        {
            const Second = Part.Vertices[Face.Indices[Slot]], Third = Part.Vertices[Face.Indices[Slot + 1]];
            const Area = 0.5 * Length(Cross(Subtract(Second, First), Subtract(Third, First)));
            const Edges = Dot(Subtract(Second, First), Subtract(Second, First)) + Dot(Subtract(Third, Second), Subtract(Third, Second))
                        + Dot(Subtract(First, Third), Subtract(First, Third));
            Quality = Math.min(Quality, Edges > 0.0 ? 6.92820323 * Area / Edges : 0.0);
            ++Triangles;
        }
    }
    return { Quality, Triangles };
}

function ResolveAspect(Part, SourceSize)
{
    const Size = ResolveBounds(Part).Size.map((Length, Axis) => Length / Math.max(SourceSize[Axis], 1.0e-9));
    return Math.max(...Size) / Math.max(Math.min(...Size), 1.0e-9);
}

// 📝 Cuts Part by the plane Normal·p = Offset; returns [below, above] or null when the plane misses. Edge intersections
//    are shared between the two faces of an edge, vertices on the plane go to both sides, and the cap polygon is
//    ordered around its centroid in the plane — counter-clockwise seen from outside each half.
export function SplitPart(Part, Normal, Offset)
{
    const Extent = Length(ResolveBounds(Part).Size);
    const Epsilon = 1.0e-9 * Math.max(1.0, Extent);
    const Distance = Part.Vertices.map((Point) => Dot(Normal, Point) - Offset);
    if (Distance.every((Value) => Value >= -Epsilon) || Distance.every((Value) => Value <= Epsilon))
        return null;
    const Halves = [{ Vertices: [], Faces: [], Map: new Map() }, { Vertices: [], Faces: [], Map: new Map() }];
    const Crossings = new Map();
    const CapPoints = [];
    const Take = (Half, Key, Point) =>
    {
        if (!Half.Map.has(Key))
        {
            Half.Map.set(Key, Half.Vertices.length);
            Half.Vertices.push(Point);
        }
        return Half.Map.get(Key);
    };
    const Side = (Value) => Value < -Epsilon ? 0 : (Value > Epsilon ? 1 : 2);
    Part.Vertices.forEach((Point, Index) => { if (Side(Distance[Index]) === 2) CapPoints.push({ Key: `v${Index}`, Point }); });
    const Crossing = (A, B) =>
    {
        const Key = A < B ? `${A}:${B}` : `${B}:${A}`;
        if (!Crossings.has(Key))
        {
            const T = Distance[A] / (Distance[A] - Distance[B]);
            const Point = Add(Part.Vertices[A], Scale(Subtract(Part.Vertices[B], Part.Vertices[A]), T));
            Crossings.set(Key, Point);
            CapPoints.push({ Key: `e${Key}`, Point });
        }
        return { Key: `e${Key}`, Point: Crossings.get(Key) };
    };
    for (const Face of Part.Faces)
    {
        const Polygons = [[], []];
        const Count = Face.Indices.length;
        for (let Slot = 0; Slot < Count; ++Slot)
        {
            const A = Face.Indices[Slot], B = Face.Indices[(Slot + 1) % Count];
            const SideA = Side(Distance[A]), SideB = Side(Distance[B]);
            if (SideA === 2)
            {
                Polygons[0].push({ Key: `v${A}`, Point: Part.Vertices[A] });
                Polygons[1].push({ Key: `v${A}`, Point: Part.Vertices[A] });
            }
            else
                Polygons[SideA].push({ Key: `v${A}`, Point: Part.Vertices[A] });
            if ((SideA === 0 && SideB === 1) || (SideA === 1 && SideB === 0))
            {
                const Shared = Crossing(A, B);
                Polygons[0].push(Shared);
                Polygons[1].push(Shared);
            }
        }
        Polygons.forEach((Polygon, Index) =>
        {
            if (Polygon.length >= 3)
                Halves[Index].Faces.push({ Indices: Polygon.map((Corner) => Take(Halves[Index], Corner.Key, Corner.Point)), Interior: Face.Interior });
        });
    }
    if (CapPoints.length < 3)
        return null;
    // ② the cap: on the plane, ordered by angle about its centroid; the lower half's outward normal is +Normal
    const Centre = Scale(CapPoints.reduce((Sum, Corner) => Add(Sum, Corner.Point), [0.0, 0.0, 0.0]), 1.0 / CapPoints.length);
    const Tangent = Normalize(Math.abs(Normal[0]) < 0.9 ? Cross(Normal, [1.0, 0.0, 0.0]) : Cross(Normal, [0.0, 1.0, 0.0]));
    const Bitangent = Cross(Normal, Tangent);
    const Ordered = CapPoints.map((Corner) => ({ ...Corner, Angle: Math.atan2(Dot(Subtract(Corner.Point, Centre), Bitangent),
                                                                              Dot(Subtract(Corner.Point, Centre), Tangent)) }))
                             .sort((Left, Right) => Left.Angle - Right.Angle);
    Halves[0].Faces.push({ Indices: Ordered.map((Corner) => Take(Halves[0], Corner.Key, Corner.Point)), Interior: true });
    Halves[1].Faces.push({ Indices: Ordered.slice().reverse().map((Corner) => Take(Halves[1], Corner.Key, Corner.Point)), Interior: true });
    const Result = Halves.map((Half) => ({ Vertices: Half.Vertices, Faces: Half.Faces }));
    if (Result.some((Half) => Half.Faces.length < 4))
        return null;
    return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      BLANKS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The convex blank of a breakable, local to its bottom centre exactly as YardStructure emits its facet set.
//    Primitive: box | pane | cylinder | barrier; Profile is the barrier's (y, z) cross-section.
export function ConstructBlank(Primitive, Extent, Profile = null)
{
    const [X, Y, Z] = Extent;
    if (Primitive === "cylinder")
    {
        const Segments = 20, Vertices = [], Faces = [];
        for (let Segment = 0; Segment < Segments; ++Segment)
        {
            const θ = (2.0 * Math.PI * Segment) / Segments;
            Vertices.push([0.5 * X * Math.cos(θ), 0.5 * Y * Math.sin(θ), 0.0]);
        }
        for (let Segment = 0; Segment < Segments; ++Segment)
            Vertices.push([Vertices[Segment][0], Vertices[Segment][1], Z]);
        for (let Segment = 0; Segment < Segments; ++Segment)
        {
            const Next = (Segment + 1) % Segments;
            Faces.push({ Indices: [Segment, Next, Segments + Next, Segments + Segment], Interior: false });
        }
        Faces.push({ Indices: Array.from({ length: Segments }, (Unused, Index) => Segments + Index), Interior: false });
        Faces.push({ Indices: Array.from({ length: Segments }, (Unused, Index) => Segments - 1 - Index), Interior: false });
        return { Vertices, Faces };
    }
    if (Primitive === "barrier" && Profile)
    {
        const Count = Profile.length, Vertices = [], Faces = [];
        for (const Sign of [-0.5, 0.5])
            for (const [PointY, PointZ] of Profile)
                Vertices.push([Sign * X, PointY, PointZ]);
        for (let Index = 0; Index < Count; ++Index)
        {
            const Next = (Index + 1) % Count;
            Faces.push({ Indices: [Index, Count + Index, Count + Next, Next], Interior: false });
        }
        Faces.push({ Indices: Array.from({ length: Count }, (Unused, Index) => Count + Index), Interior: false });
        Faces.push({ Indices: Array.from({ length: Count }, (Unused, Index) => Count - 1 - Index), Interior: false });
        return OrientFaces({ Vertices, Faces });
    }
    const Vertices = [];
    for (const SignZ of [0.0, 1.0])
        for (const SignY of [-0.5, 0.5])
            for (const SignX of [-0.5, 0.5])
                Vertices.push([SignX * X, SignY * Y, SignZ * Z]);
    const Faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
        .map((Indices) => ({ Indices, Interior: false }));
    return OrientFaces({ Vertices, Faces });
}

// 📝 Turns every face to wind counter-clockwise from outside — the blanks are built by hand and this is cheaper to
//    trust than every hand-written index list.
function OrientFaces(Part)
{
    const Centre = ResolveBounds(Part).Centre;
    for (const Face of Part.Faces)
    {
        const [A, B, C] = Face.Indices.slice(0, 3).map((Index) => Part.Vertices[Index]);
        const Normal = Cross(Subtract(B, A), Subtract(C, A));
        if (Dot(Normal, Subtract(A, Centre)) < 0.0)
            Face.Indices.reverse();
    }
    return Part;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     FRACTURE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Fracture(Root, Recipe, Hit): Hit is the impact point in the blank's frame, Recipe a NormalizeRecipe result.
//    Returns { Parts, Milliseconds, VolumeError, Quality, Triangles, Rejected, Spent }.
export function FracturePart(Root, Recipe, Hit)
{
    const Start = performance.now();
    const DrawRandom = ConstructRandom(Recipe.Seed);
    const Material = FractureMaterials[Recipe.Material] || FractureMaterials.concrete;
    const Original = ResolveMoments(Root).Volume;
    const QualityFloor = Math.min(0.018, ResolveQuality(Root).Quality * 0.4);
    const Size = ResolveBounds(Root).Size;
    const Radius = Length(Size);
    const ThinAxis = Size.indexOf(Math.min(...Size));
    const Thin = Size[ThinAxis] < 0.1 * Math.min(...Size.filter((Unused, Axis) => Axis !== ThinAxis));
    const Planar = [0, 1, 2].filter((Axis) => Axis !== ThinAxis);
    let Parts = [Root];
    let Energy = Recipe.Energy + Material.StoredEnergy * Original;
    let Rejected = 0, Spent = 0;
    const Stopped = new Set();
    while (Parts.length < Recipe.Ceiling)
    {
        let Best = -1, Priority = -1;
        Parts.forEach((Part, Slot) =>
        {
            if (Stopped.has(Part))
                return;
            const Weighted = ResolveMoments(Part).Volume * Math.exp(-Length(Subtract(ResolveBounds(Part).Centre, Hit)) / (Radius * 0.65));
            if (Weighted > Priority)
            {
                Priority = Weighted;
                Best = Slot;
            }
        });
        if (Best < 0 || Energy <= 0.0)
            break;
        const Part = Parts[Best];
        const Extent = ResolveBounds(Part);
        const Uncut = ResolveMoments(Part).Volume;
        let Choice = null;
        for (let Trial = 0; Trial < 8; ++Trial)
        {
            let Direction = [DrawRandom() * 2.0 - 1.0, DrawRandom() * 2.0 - 1.0, DrawRandom() * 2.0 - 1.0];
            if (Thin)
                Direction[ThinAxis] = 0.0;
            if (Material.Grain !== null)
                Direction[Material.Grain] *= 0.14;
            if (Trial === 7)
            {
                const Axes = (Thin ? Planar : [0, 1, 2]).slice().sort((Left, Right) =>
                    (Extent.Size[Right] / Size[Right]) * (Material.Grain === Right ? 0.15 : 1.0)
                  - (Extent.Size[Left] / Size[Left]) * (Material.Grain === Left ? 0.15 : 1.0));
                Direction = [0.0, 0.0, 0.0];
                Direction[Axes[0]] = 1.0;
            }
            if (Thin && Recipe.Material === "glass")
            {
                // 📝 Annealed glass cracks radially around the impact, in the pane's own plane.
                const Radial = Subtract(Extent.Centre, Hit);
                const Swirl = [0.0, 0.0, 0.0];
                Swirl[Planar[0]] = -Radial[Planar[1]];
                Swirl[Planar[1]] = Radial[Planar[0]];
                const Unit = Normalize(Swirl);
                Direction = Normalize(Add(Scale(Unit, 0.65), Scale(Normalize(Direction), 0.35)));
            }
            if (Dot(Direction, Direction) < 0.25)
                continue;
            Direction = Normalize(Direction);
            const Projections = Part.Vertices.map((Point) => Dot(Direction, Point));
            const Low = Math.min(...Projections), High = Math.max(...Projections);
            const Offset = Dot(Direction, Extent.Centre) + (DrawRandom() - 0.5) * (High - Low) * 0.18;
            const Halves = SplitPart(Part, Direction, Offset);
            if (!Halves)
                continue;
            const Volumes = Halves.map((Half) => ResolveMoments(Half).Volume);
            const Qualities = Halves.map((Half) => ResolveQuality(Half).Quality);
            const Ratio = Math.min(...Volumes) / Uncut;
            if (Ratio < 0.18 || Math.abs(Volumes[0] + Volumes[1] - Uncut) > Uncut * 1.0e-6 || Qualities.some((Quality) => Quality < QualityFloor))
            {
                Rejected++;
                continue;
            }
            if (Halves.some((Half) => ResolveBounds(Half).Size.some((Span, Axis) => Span < Math.min(Recipe.MinimumSize, Size[Axis] * 0.3))))
            {
                Rejected++;
                continue;
            }
            const Cap = Halves[0].Faces[Halves[0].Faces.length - 1];
            const CapOrigin = Halves[0].Vertices[Cap.Indices[0]];
            let Area = 0.0;
            for (let Slot = 1; Slot + 1 < Cap.Indices.length; ++Slot)
                Area += 0.5 * Length(Cross(Subtract(Halves[0].Vertices[Cap.Indices[Slot]], CapOrigin), Subtract(Halves[0].Vertices[Cap.Indices[Slot + 1]], CapOrigin)));
            const Cost = 2.0 * Material.Gc * Area * (Material.Grain !== null ? 1.0 + Math.abs(Direction[Material.Grain]) * 10.0 : 1.0);
            if (Cost > Energy)
                continue;
            const Slenderness = Math.max(...Halves.map((Half) => ResolveAspect(Half, Size)));
            if (Slenderness > (Material.Grain !== null ? 10.0 : 6.0))
            {
                Rejected++;
                continue;
            }
            const Score = Math.sqrt(Math.min(...Qualities) / Slenderness) * Math.min(...Volumes) / Math.max(...Volumes);
            if (!Choice || Score > Choice.Score)
                Choice = { Halves, Cost, Score };
        }
        if (!Choice)
        {
            Stopped.add(Part);
            continue;
        }
        Energy -= Choice.Cost;
        Spent += Choice.Cost;
        Parts.splice(Best, 1, ...Choice.Halves);
    }
    const Total = Parts.reduce((Sum, Part) => Sum + ResolveMoments(Part).Volume, 0.0);
    const Measures = Parts.map(ResolveQuality);
    return { Parts, Milliseconds: performance.now() - Start, VolumeError: Math.abs(Total - Original) / Original,
             Quality: Math.min(...Measures.map((Measure) => Measure.Quality)), Triangles: Measures.reduce((Sum, Measure) => Sum + Measure.Triangles, 0),
             Rejected, Spent };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                FRAGMENT PROJECTION
//------------------------------------------------------------------------------------------------------------------------

// 📝 A part as a fragment: fan triangles about its centroid with flat normals, the exposed faces in the core family,
//    bounds, up to sixteen hull points for contacts (farthest-point thinned), and its mass and box inertia extents.
export function ProjectFragment(Part, Density, Families)
{
    const Moments = ResolveMoments(Part);
    const Centroid = Moments.Centroid;
    const Local = Part.Vertices.map((Point) => Subtract(Point, Centroid));
    const Triangles = [];
    for (const Face of Part.Faces)
    {
        const Family = Face.Interior ? Families.Core : Families.Shell;
        for (let Slot = 1; Slot + 1 < Face.Indices.length; ++Slot)
        {
            const A = Local[Face.Indices[0]], B = Local[Face.Indices[Slot]], C = Local[Face.Indices[Slot + 1]];
            const Normal = Normalize(Cross(Subtract(B, A), Subtract(C, A)));
            Triangles.push({ Corners: [A, B, C], Normal, Family });
        }
    }
    const Bounds = ResolveBounds({ Vertices: Local });
    let Points = [Local[0]];
    while (Points.length < Math.min(16, Local.length))
    {
        let Farthest = null, Reach = -1.0;
        for (const Point of Local)
        {
            const Nearest = Math.min(...Points.map((Chosen) => Length(Subtract(Point, Chosen))));
            if (Nearest > Reach)
            {
                Reach = Nearest;
                Farthest = Point;
            }
        }
        if (Reach <= 1.0e-6)
            break;
        Points.push(Farthest);
    }
    return { Centroid, Triangles, LocalMinimum: Bounds.Minimum, LocalMaximum: Bounds.Maximum, Points,
             Mass: Math.max(0.05, Math.abs(Moments.Volume) * Density), Extent: Bounds.Size, Volume: Math.abs(Moments.Volume) };
}
