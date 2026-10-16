//============================================================================================================================================
//                                                            SURFACERASTER.WGSL
//============================================================================================================================================
// 🧩 Primary visibility: every rastered occupant projected into depth, shading normal, material family, weathering and screen motion.

//! include "FrameDescriptor.wgsl"
//! include "PackingCodec.wgsl"
//! include "TyreCarcass.wgsl"

@group(0) @binding(1) var<storage, read> Occupants : array<OccupantRecord>;
@group(0) @binding(2) var RubberDeposit            : texture_2d<f32>;
@group(0) @binding(3) var RubberSampler            : sampler;
@group(0) @binding(4) var<storage, read> Carcasses : array<TyreCarcass, 4>;

struct SurfaceVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) Normal                     : vec3f,
    @location(1) @interpolate(flat) Family  : u32,
    @location(2) CurrentClip                : vec4f,
    @location(3) PreviousClip               : vec4f,
    @location(4) WorldPosition              : vec3f,
}

struct SurfaceTargets
{
    @location(0) Attributes : vec4f,   // xy octahedral shading normal, z material family, w albedo weathering
    @location(1) Motion     : vec2f,   // [px] current minus previous screen position
}

// 📝 The occupant is instance_index — the run's first occupant plus the instance — plus the vertex's own offset, which
//    is zero for every facet set and a fragment's slot in the fragment span for the fragment depot's records. The four
//    wheels' tyres take their carcass deformation (TyreCarcass.wgsl) before anything else.
@vertex
fn SurfaceVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f, @location(3) OccupantOffset: u32,
                 @builtin(instance_index) OccupantIndex: u32) -> SurfaceVarying
{
    let Identity = OccupantIndex + OccupantOffset;
    let Occupant = Occupants[Identity];
    var Local = Position;
    var LocalNormal = Normal;
    let Wheel = Identity - WheelOccupantFirst;
    if (Wheel < 4u)
    {
        let Deformed = DeformTyre(Wheel, Position, Normal);
        Local = Deformed.Position;
        LocalNormal = Deformed.Normal;
    }
    let World    = Occupant.LocalToWorld * vec4f(Local, 1.0);
    let Previous = Occupant.PreviousLocalToWorld * vec4f(Local, 1.0);
    var Varying: SurfaceVarying;
    Varying.Position      = Frame.ViewProjection * World;
    Varying.CurrentClip   = Frame.UnjitteredViewProjection * World;
    Varying.PreviousClip  = Frame.PreviousUnjitteredViewProjection * Previous;
    Varying.Normal        = (Occupant.LocalToWorld * vec4f(LocalNormal, 0.0)).xyz;
    Varying.Family        = select(Family, Occupant.MaterialOverride, Occupant.MaterialOverride != NoMaterialOverride);
    Varying.WorldPosition = World.xyz;
    return Varying;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  GROUND WEATHERING
//------------------------------------------------------------------------------------------------------------------------

fn HashPlane(Cell: vec2f) -> f32
{
    return fract(sin(dot(Cell, vec2f(127.1, 311.7))) * 43758.5453);
}

fn ResolvePlaneNoise(Position: vec2f) -> f32
{
    let Cell = floor(Position);
    let Fraction = Position - Cell;
    let Smooth = Fraction * Fraction * (3.0 - 2.0 * Fraction);
    return mix(mix(HashPlane(Cell), HashPlane(Cell + vec2f(1.0, 0.0)), Smooth.x),
               mix(HashPlane(Cell + vec2f(0.0, 1.0)), HashPlane(Cell + vec2f(1.0, 1.0)), Smooth.x), Smooth.y);
}

// 📝 The road's albedo factor, written where the material family is asphalt, apron or paint: 12 m and 3 m patches of
//    lighter and darker surfacing, a 23 cm grain, sparse oil stains, paint worn thinner in places, and the rubber the
//    tyres have laid (TyreMarkSpace.js) — black on asphalt, grey on paint.
fn ResolveGroundWeathering(World: vec2f, Family: u32) -> f32
{
    let Patch = ResolvePlaneNoise(World * 0.083) * 0.6 + ResolvePlaneNoise(World * 0.31 + vec2f(7.3, 1.1)) * 0.4;
    let Grain = ResolvePlaneNoise(World * 4.3 + vec2f(1.9, 5.2));
    let Stain = smoothstep(0.8, 0.93, ResolvePlaneNoise(World * 0.27 + vec2f(13.7, 2.4)))
              * smoothstep(0.45, 0.8, ResolvePlaneNoise(World * 2.3 + vec2f(3.1, 9.8)));
    let Paint = Family >= PaintFamilyFirst;
    var Weathering = select((0.82 + 0.3 * Patch + 0.1 * (Grain - 0.5)) * (1.0 - 0.22 * Stain), 0.84 + 0.18 * Patch + 0.06 * (Grain - 0.5), Paint);
    let Coordinates = (World - vec2f(MarkMinimum)) / MarkExtent;
    if (all(Coordinates >= vec2f(0.0)) && all(Coordinates <= vec2f(1.0)))
    {
        let Rubber = textureSampleLevel(RubberDeposit, RubberSampler, Coordinates, 0.0).r;
        Weathering *= 1.0 - Rubber * select(0.88, 0.62, Paint);
    }
    return max(Weathering, 0.05);
}

fn ProjectScreenPixel(Clip: vec4f) -> vec2f
{
    let Ndc = Clip.xy / Clip.w;
    return vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5) * Frame.ScreenExtent;
}

@fragment
fn SurfaceFragment(Varying: SurfaceVarying) -> SurfaceTargets
{
    var Normal = normalize(Varying.Normal);
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    // 📝 Every surface shades two-sided: an open facet seen from behind turns its normal toward the viewer.
    if (dot(Normal, View) < 0.0)
    {
        Normal = -Normal;
    }
    var Weathering = 1.0;
    if (Varying.Family >= GroundFamilyFirst && Varying.Family <= GroundFamilyLast)
    {
        Weathering = ResolveGroundWeathering(Varying.WorldPosition.xy, Varying.Family);
    }
    var Targets: SurfaceTargets;
    Targets.Attributes = vec4f(EncodeOctahedral(Normal), f32(Varying.Family), Weathering);
    Targets.Motion     = ProjectScreenPixel(Varying.CurrentClip) - ProjectScreenPixel(Varying.PreviousClip);
    return Targets;
}
