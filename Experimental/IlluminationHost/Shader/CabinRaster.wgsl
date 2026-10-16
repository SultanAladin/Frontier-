//! include "FrameDescriptor.wgsl"

// 📝 Adapted from Slate commit 3c987f33c71c2477bd73ca29c69d5bd0ee484d1a. Cabin is the Slate wheel/tablet pose,
//    display scale and preview well. Textures belong to the local CabinSequence so the live HMI and Garage material
//    preview remain the single source of truth.
struct CabinRecord
{
    Body    : mat4x4f,
    Wheel   : mat4x4f,
    Tablet  : mat4x4f,
    Display : vec4f,   // x physical HMI scale, y brightness, z enabled, w Garage preview active
    Preview : vec4f,   // xy low UV, zw high UV
    Corner  : vec4f,   // xy rounded-corner radius in panel UV
}

@group(0) @binding(1) var<uniform> Cabin : CabinRecord;
@group(0) @binding(2) var ClusterTexture : texture_2d<f32>;
@group(0) @binding(3) var TabletTexture : texture_2d<f32>;
@group(0) @binding(4) var LinearSampler : sampler;
@group(0) @binding(5) var PreviewTexture : texture_2d<f32>;

struct CabinVarying
{
    @builtin(position) Position : vec4f,
    @location(0) Normal : vec3f,
    @location(1) World : vec3f,
    @location(2) UV : vec2f,
    @location(3) @interpolate(flat) Material : u32,
}

@vertex
fn CabinVertex(@location(0) Position : vec3f, @location(1) Normal : vec3f,
               @location(2) UV : vec2f, @location(3) Material : u32) -> CabinVarying
{
    var Pose = Cabin.Body;
    var Local = Position;
    if (Material == 1u || Material == 2u) { Pose = Cabin.Wheel; }
    if (Material == 3u || Material == 4u) { Pose = Cabin.Tablet; }
    // 📝 HMI-only scale: panel, active glass and binnacle raster grow together, while the wheel, dashboard, seats and
    //    seated eye retain Slate's authored dimensions. Ray bounds use the same value in CabinProjection.QueryTabletHit.
    if (Material == 2u || Material == 3u || Material == 4u) { Local.xy *= Cabin.Display.x; }
    let World = Pose * vec4f(Local, 1.0);
    var V : CabinVarying;
    V.Position = Frame.ViewProjection * World;
    V.World = World.xyz;
    V.Normal = (Pose * vec4f(Normal, 0.0)).xyz;
    V.UV = UV;
    V.Material = Material;
    return V;
}

fn ResolvePreviewCoverage(Coordinates : vec2f) -> f32
{
    let Low = Cabin.Preview.xy;
    let High = Cabin.Preview.zw;
    if (any(Coordinates < Low) || any(Coordinates > High)) { return 0.0; }
    let Radius = Cabin.Corner.xy;
    let Inner = clamp(Coordinates, Low + Radius, High - Radius);
    let Offset = (Coordinates - Inner) / max(Radius, vec2f(1.0e-5));
    return select(1.0, 0.0, dot(Offset, Offset) > 1.0);
}

@fragment
fn CabinFragment(V : CabinVarying) -> @location(0) vec4f
{
    if (V.Material == 2u)
    {
        if (Cabin.Display.z < 0.5) { return vec4f(0.004, 0.006, 0.007, 1.0); }
        let Picture = textureSampleLevel(ClusterTexture, LinearSampler, V.UV, 0.0);
        if (Picture.a < 0.5) { discard; }
        return vec4f(Picture.rgb * Cabin.Display.y * Frame.EmissionScale, 1.0);
    }
    if (V.Material == 4u)
    {
        if (Cabin.Display.z < 0.5) { return vec4f(0.006, 0.008, 0.009, 1.0); }
        var Picture = textureSampleLevel(TabletTexture, LinearSampler, V.UV, 0.0).rgb;
        if (Cabin.Display.w > 0.5)
        {
            let Coverage = ResolvePreviewCoverage(V.UV);
            if (Coverage > 0.0)
            {
                let Within = (V.UV - Cabin.Preview.xy) / max(Cabin.Preview.zw - Cabin.Preview.xy, vec2f(1.0e-5));
                Picture = mix(Picture, textureSampleLevel(PreviewTexture, LinearSampler, Within, 0.0).rgb, Coverage);
            }
        }
        return vec4f(Picture * Cabin.Display.y * Frame.EmissionScale, 1.0);
    }

    let N = normalize(V.Normal);
    let View = normalize(Frame.CameraPosition - V.World);
    let Facing = abs(dot(N, View));
    let Shade = 0.22 + 0.44 * max(0.0, dot(N, Frame.SunDirection)) + 0.16 * max(0.0, N.z);
    let Rim = pow(1.0 - Facing, 3.0) * 0.055;
    let Base = select(vec3f(0.045, 0.054, 0.056), vec3f(0.085, 0.092, 0.088), V.Material == 3u);
    return vec4f(Base * Shade + vec3f(Rim), 1.0);
}
