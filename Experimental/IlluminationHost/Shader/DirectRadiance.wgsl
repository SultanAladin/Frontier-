//============================================================================================================================================
//                                                           DIRECTRADIANCE.WGSL
//============================================================================================================================================
// 🧩 Direct sun and fire radiance at every primary surface with cascaded shadow depth, and the sky behind the course.

//! include "FrameDescriptor.wgsl"
//! include "SurfaceReflectance.wgsl"
//! include "PackingCodec.wgsl"
//! include "SkyProjection.wgsl"
//! include "PlumeRecords.wgsl"

struct CascadeReceiver
{
    LightViewProjection : array<mat4x4f, 3>,
    Splits              : vec4f,   // [m]   xyz far distance of each cascade, w cascade count
    TexelWorld          : vec4f,   // [m]   world size of one shadow texel per cascade
}

@group(0) @binding(1) var<storage, read> Materials : array<MaterialRecord>;
@group(0) @binding(2) var SurfaceAttributes        : texture_2d<f32>;
@group(0) @binding(3) var SurfaceDepth             : texture_depth_2d;
@group(0) @binding(4) var ShadowDepth              : texture_depth_2d_array;
@group(0) @binding(5) var ShadowSampler            : sampler_comparison;
@group(0) @binding(6) var<uniform> Receiver        : CascadeReceiver;
@group(0) @binding(7) var SkyView                  : texture_2d<f32>;
@group(0) @binding(8) var SkySampler               : sampler;
@group(0) @binding(9) var DirectTarget             : texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var<uniform> FireLights     : FireLightRecord;

// 📐 3×3 percentage-closer taps, each a hardware bilinear comparison, after a normal offset of 1.5 texels.
fn ResolveCascadeVisibility(Position: vec3f, Normal: vec3f) -> f32
{
    let ViewDistance = ResolveViewDepth(Position);
    let Count = u32(Receiver.Splits.w);
    var Cascade = 0u;
    while (Cascade + 1u < Count && ViewDistance > Receiver.Splits[Cascade])
    {
        Cascade++;
    }
    if (ViewDistance > Receiver.Splits[Count - 1u])
    {
        return 1.0;
    }
    let Offset = Position + Normal * (1.5 * Receiver.TexelWorld[Cascade]);
    let Clip = Receiver.LightViewProjection[Cascade] * vec4f(Offset, 1.0);
    let Ndc = Clip.xyz / Clip.w;
    let Coordinates = vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5);
    if (any(Coordinates < vec2f(0.0)) || any(Coordinates > vec2f(1.0)) || Ndc.z > 1.0)
    {
        return 1.0;
    }
    let Texel = 1.0 / vec2f(textureDimensions(ShadowDepth).xy);
    var Lit = 0.0;
    for (var Y = -1; Y <= 1; Y++)
    {
        for (var X = -1; X <= 1; X++)
        {
            Lit += textureSampleCompareLevel(ShadowDepth, ShadowSampler, Coordinates + vec2f(f32(X), f32(Y)) * Texel, Cascade, Ndc.z);
        }
    }
    return Lit / 9.0;
}

// 📝 Burning tyres and exhaust pops light the car and the road: a softened inverse square through the surface's own
//    reflectance, windowed smoothly to nothing at FireReach so a fire does not light the far side of the yard. Not
//    shadowed — the flames sit under and beside the body they light.
const FireReach : f32 = 14.0;   // [m]

fn ResolveFireRadiance(Surface: SurfaceSample, Position: vec3f, Normal: vec3f, View: vec3f) -> vec3f
{
    var Radiance = vec3f(0.0);
    for (var Index = 0u; Index < min(FireLights.Count.x, 4u); Index++)
    {
        let Offset = FireLights.PositionRadius[Index].xyz - Position;
        let Squared = dot(Offset, Offset);
        let Radius = FireLights.PositionRadius[Index].w;
        let Window = clamp(1.0 - pow(Squared / (FireReach * FireReach), 2.0), 0.0, 1.0);
        let Toward = Offset * inverseSqrt(max(Squared, 1.0e-6));
        Radiance += FireLights.Radiance[Index].rgb * (Window * Window / (Squared + Radius * Radius))
                  * ResolveDirectReflectance(Surface, Normal, View, Toward);
    }
    return Radiance;
}

fn ResolveBackgroundRadiance(Direction: vec3f) -> vec3f
{
    var Radiance = textureSampleLevel(SkyView, SkySampler, ProjectSkyCoordinates(Direction), 0.0).rgb * Frame.SkyScale
                 + Frame.NightSkyRadiance;
    // 📝 The solar disc (0.27° radius) is added only here, never to escaped rays, so it is not counted twice.
    let Cosine = dot(Direction, Frame.SunDirection);
    if (Cosine > 0.99998)
    {
        Radiance += Frame.SunIlluminance * 2500.0;
    }
    return Radiance;
}

@compute @workgroup_size(8, 8)
fn IntegrateDirectRadiance(@builtin(global_invocation_id) Invocation: vec3u)
{
    let Pixel = Invocation.xy;
    if (any(vec2f(Pixel) >= Frame.ScreenExtent))
    {
        return;
    }
    let Depth = textureLoad(SurfaceDepth, vec2i(Pixel), 0);
    let Centre = vec2f(Pixel) + 0.5;
    if (Depth <= 0.0)
    {
        let Far = ReconstructWorldPosition(Centre, 1.0e-6);
        textureStore(DirectTarget, vec2i(Pixel), vec4f(ResolveBackgroundRadiance(normalize(Far - Frame.CameraPosition)), 0.0));
        return;
    }
    let Position   = ReconstructWorldPosition(Centre, Depth);
    let Attributes = textureLoad(SurfaceAttributes, vec2i(Pixel), 0);
    let Normal     = DecodeOctahedral(Attributes.xy);
    let Surface    = ProjectWeatheredSample(Materials[u32(Attributes.z + 0.5)], Attributes.w);
    let View       = normalize(Frame.CameraPosition - Position);
    var Visibility = 1.0;
    if (FeatureEnabled(Frame, FeatureDirectShadow))
    {
        Visibility = ResolveCascadeVisibility(Position, Normal);
    }
    var Radiance = Frame.SunIlluminance * Visibility * ResolveDirectReflectance(Surface, Normal, View, Frame.SunDirection);
    Radiance += ResolveFireRadiance(Surface, Position, Normal, View);
    textureStore(DirectTarget, vec2i(Pixel), vec4f(Radiance, 1.0));
}
