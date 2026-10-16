//============================================================================================================================================
//                                                        DISPLAYRECOMBINATION.WGSL
//============================================================================================================================================
// 🧩 Recombines direct, indirect diffuse, glossy reflection and emission per pixel, or substitutes an inspection signal.

// 📝 The indirect term arrives demodulated (irradiance E) and is modulated here by the diffuse albedo, so texture-free
//    surfaces keep their edges through the wavelet. Specular indirect uses the split-sum response F0·A + B over the
//    traced reflection; past the reflection cutoff it falls back to E/π, Lumen's rough-reflection reuse. A clear coat
//    reflects the same radiance with its own response and attenuates the layer beneath by its Fresnel transmittance.

//! include "FrameDescriptor.wgsl"
//! include "SurfaceReflectance.wgsl"
//! include "PackingCodec.wgsl"

@group(0) @binding(1) var<storage, read> Materials : array<MaterialRecord>;
@group(0) @binding(2) var SurfaceAttributes        : texture_2d<f32>;
@group(0) @binding(3) var SurfaceDepth             : texture_depth_2d;
@group(0) @binding(4) var DirectRadiance           : texture_2d<f32>;
@group(0) @binding(5) var IndirectIrradiance       : texture_2d<f32>;
@group(0) @binding(6) var ReflectionRadiance       : texture_2d<f32>;
@group(0) @binding(7) var ResampledIrradiance      : texture_2d<f32>;
@group(0) @binding(8) var InspectionRadiance       : texture_2d<f32>;
@group(0) @binding(9) var CardFinal                : texture_2d<f32>;
@group(0) @binding(10) var RecombinedTarget         : texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var PlumeRadiance            : texture_2d<f32>;
@group(0) @binding(12) var EmberRadiance            : texture_2d<f32>;

const InspectionFinal      : u32 = 0u;
const InspectionDirect     : u32 = 1u;
const InspectionDiffuse    : u32 = 2u;
const InspectionIrradiance : u32 = 3u;
const InspectionResampled  : u32 = 4u;
const InspectionReflection : u32 = 5u;
const InspectionDistance   : u32 = 6u;
const InspectionCards      : u32 = 7u;
const InspectionNormal     : u32 = 8u;
const InspectionAlbedo     : u32 = 9u;
const InspectionPlume      : u32 = 10u;

// 📝 The smoke-and-fire march arrives at trace resolution as premultiplied radiance and transmittance. Four bilinear
//    taps are weighted by how closely each trace pixel's surface depth matches this pixel's, so a plume behind the
//    car does not bleed onto its silhouette; when no tap agrees, the closest one answers.
fn ResolvePlume(Pixel: vec2i, ViewDepth: f32) -> vec4f
{
    let Extent = vec2i(Frame.TraceExtent);
    let Continuous = (vec2f(Pixel) + 0.5) / f32(Frame.TraceScale) - 0.5;
    let Corner = vec2i(floor(Continuous));
    let Fraction = Continuous - vec2f(Corner);
    var Sum = vec4f(0.0);
    var Weights = 0.0;
    var Nearest = vec4f(0.0, 0.0, 0.0, 1.0);
    var NearestError = 1.0e9;
    for (var Tap = 0u; Tap < 4u; Tap++)
    {
        let Offset = vec2i(i32(Tap & 1u), i32(Tap >> 1u));
        let Trace = clamp(Corner + Offset, vec2i(0), Extent - vec2i(1));
        let Screen = min(Trace * i32(Frame.TraceScale), vec2i(Frame.ScreenExtent) - vec2i(1));
        let TapDepth = textureLoad(SurfaceDepth, Screen, 0);
        let TapView = select(1.0e5, ResolveViewDepth(ReconstructWorldPosition(vec2f(Screen) + 0.5, TapDepth)), TapDepth > 0.0);
        let Error = abs(TapView - ViewDepth) / max(min(TapView, ViewDepth), 0.1);
        let Bilinear = select(1.0 - Fraction.x, Fraction.x, Offset.x == 1) * select(1.0 - Fraction.y, Fraction.y, Offset.y == 1);
        let Weight = Bilinear * exp(-Error * 16.0);
        let Sample = textureLoad(PlumeRadiance, Trace, 0);
        Sum += Sample * Weight;
        Weights += Weight;
        if (Error < NearestError)
        {
            NearestError = Error;
            Nearest = Sample;
        }
    }
    return select(Nearest, Sum / Weights, Weights > 1.0e-3);
}

fn ComposePlumeTerm(Pixel: vec2i, Colour: vec3f, Depth: f32) -> vec3f
{
    if (!FeatureEnabled(Frame, FeaturePlume) || (Frame.InspectionMode != InspectionFinal && Frame.InspectionMode != InspectionPlume))
    {
        return Colour;
    }
    let ViewDepth = select(1.0e5, ResolveViewDepth(ReconstructWorldPosition(vec2f(Pixel) + 0.5, Depth)), Depth > 0.0);
    let Plume = ResolvePlume(Pixel, ViewDepth);
    return Colour * Plume.a + Plume.rgb;
}

// 📝 Embers and sparks arrive additive at screen resolution, already depth-tested against the primary surfaces.
fn ComposeEmberTerm(Pixel: vec2i, Colour: vec3f) -> vec3f
{
    if (Frame.InspectionMode != InspectionFinal && Frame.InspectionMode != InspectionPlume)
    {
        return Colour;
    }
    return Colour + textureLoad(EmberRadiance, Pixel, 0).rgb * Frame.EmissionScale;
}

@compute @workgroup_size(8, 8)
fn ResolveRecombination(@builtin(global_invocation_id) Invocation: vec3u)
{
    let Pixel = vec2i(Invocation.xy);
    if (any(vec2f(Pixel) >= Frame.ScreenExtent))
    {
        return;
    }
    let Direct = textureLoad(DirectRadiance, Pixel, 0);
    if (Frame.InspectionMode == InspectionDistance)
    {
        textureStore(RecombinedTarget, Pixel, vec4f(textureLoad(InspectionRadiance, Pixel, 0).rgb, 1.0));
        return;
    }
    if (Frame.InspectionMode == InspectionCards)
    {
        let Extent = vec2f(textureDimensions(CardFinal));
        let Scale = min(Frame.ScreenExtent.x, Frame.ScreenExtent.y) / Extent.x;
        let Texel = vec2i(vec2f(Pixel) / Scale);
        var Colour = vec3f(0.04);
        if (all(Texel < vec2i(Extent)))
        {
            Colour = textureLoad(CardFinal, Texel, 0).rgb;
        }
        textureStore(RecombinedTarget, Pixel, vec4f(Colour, 1.0));
        return;
    }
    let Depth = textureLoad(SurfaceDepth, Pixel, 0);
    if (Depth <= 0.0)
    {
        textureStore(RecombinedTarget, Pixel, vec4f(ComposeEmberTerm(Pixel, ComposePlumeTerm(Pixel, Direct.rgb, Depth)), 1.0));
        return;
    }
    let Attributes = textureLoad(SurfaceAttributes, Pixel, 0);
    let Normal = DecodeOctahedral(Attributes.xy);
    let Surface = ProjectWeatheredSample(Materials[u32(Attributes.z + 0.5)], Attributes.w);
    let Position = ReconstructWorldPosition(vec2f(Pixel) + 0.5, Depth);
    let View = normalize(Frame.CameraPosition - Position);
    let NdotV = max(dot(Normal, View), 1.0e-3);

    var Irradiance = vec3f(0.0);
    if (FeatureEnabled(Frame, FeatureIndirect))
    {
        Irradiance = textureLoad(IndirectIrradiance, Pixel, 0).rgb * Frame.IndirectScale;
    }
    let Diffuse = ResolveDiffuseAlbedo(Surface) * InversePi * Irradiance;

    let GlossRoughness = select(Surface.Roughness, Surface.CoatRoughness, Surface.CoatWeight > 0.0);
    let Reflection = textureLoad(ReflectionRadiance, Pixel, 0);
    var Glossy = Irradiance * InversePi;
    if (FeatureEnabled(Frame, FeatureReflection) && FeatureEnabled(Frame, FeatureIndirect))
    {
        Glossy = mix(Reflection.rgb * Frame.IndirectScale, Glossy, smoothstep(0.35, 0.5, GlossRoughness));
    }
    let LayerResponse = ResolveEnvironmentResponse(NdotV, Surface.Roughness);
    let LayerGlossy = select(Glossy, mix(Glossy, Irradiance * InversePi, smoothstep(0.3, 0.5, Surface.Roughness)), Surface.CoatWeight > 0.0);
    var Indirect = Diffuse + LayerGlossy * (ResolveSpecularColour(Surface) * LayerResponse.x + LayerResponse.y);
    var Specular = LayerGlossy * (ResolveSpecularColour(Surface) * LayerResponse.x + LayerResponse.y);
    if (Surface.CoatWeight > 0.0)
    {
        let CoatResponse = ResolveEnvironmentResponse(NdotV, Surface.CoatRoughness);
        let CoatReflectance = (0.04 * CoatResponse.x + CoatResponse.y) * Surface.CoatWeight;
        Indirect = Indirect * (1.0 - CoatReflectance) + Glossy * CoatReflectance;
        Specular = Specular * (1.0 - CoatReflectance) + Glossy * CoatReflectance;
    }
    let Emission = Surface.Emission * Frame.EmissionScale;

    var Colour = Direct.rgb + Indirect + Emission;
    switch (Frame.InspectionMode)
    {
        case 1u: { Colour = Direct.rgb + Emission; }
        case 2u: { Colour = Diffuse; }
        case 3u: { Colour = Irradiance * InversePi; }
        case 4u:
        {
            let TracePixel = min(Pixel / i32(Frame.TraceScale), vec2i(Frame.TraceExtent) - vec2i(1));
            Colour = textureLoad(ResampledIrradiance, TracePixel, 0).rgb * InversePi;
        }
        case 5u: { Colour = Specular; }
        case 8u: { Colour = Normal * 0.5 + 0.5; }
        case 9u: { Colour = Surface.Albedo; }
        default: { }
    }
    textureStore(RecombinedTarget, Pixel, vec4f(ComposeEmberTerm(Pixel, ComposePlumeTerm(Pixel, Colour, Depth)), 1.0));
}
