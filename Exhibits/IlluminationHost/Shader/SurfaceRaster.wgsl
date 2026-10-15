//============================================================================================================================================
//                                                            SURFACERASTER.WGSL
//============================================================================================================================================
// 🧩 Primary visibility: every rastered occupant projected into depth, shading normal, material family and screen motion.

//! include "FrameDescriptor.wgsl"
//! include "PackingCodec.wgsl"

@group(0) @binding(1) var<storage, read> Occupants : array<OccupantRecord>;

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
    @location(0) Attributes : vec4f,   // xy octahedral shading normal, z material family, w 1
    @location(1) Motion     : vec2f,   // [px] current minus previous screen position
}

@vertex
fn SurfaceVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
                 @builtin(instance_index) OccupantIndex: u32) -> SurfaceVarying
{
    let Occupant = Occupants[OccupantIndex];
    let World    = Occupant.LocalToWorld * vec4f(Position, 1.0);
    let Previous = Occupant.PreviousLocalToWorld * vec4f(Position, 1.0);
    var Varying: SurfaceVarying;
    Varying.Position      = Frame.ViewProjection * World;
    Varying.CurrentClip   = Frame.UnjitteredViewProjection * World;
    Varying.PreviousClip  = Frame.PreviousUnjitteredViewProjection * Previous;
    Varying.Normal        = (Occupant.LocalToWorld * vec4f(Normal, 0.0)).xyz;
    Varying.Family        = select(Family, Occupant.MaterialOverride, Occupant.MaterialOverride != NoMaterialOverride);
    Varying.WorldPosition = World.xyz;
    return Varying;
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
    var Targets: SurfaceTargets;
    Targets.Attributes = vec4f(EncodeOctahedral(Normal), f32(Varying.Family), 1.0);
    Targets.Motion     = ProjectScreenPixel(Varying.CurrentClip) - ProjectScreenPixel(Varying.PreviousClip);
    return Targets;
}
