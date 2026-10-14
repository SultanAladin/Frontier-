//============================================================================================================================================
//                                                       DISTANCEFIELDGATHERBODY.SLANG
//============================================================================================================================================
// 📦 Material-independent incoming diffuse lighting and geometry guides for spatial irradiance reconstruction.

#extension GL_GOOGLE_include_directive : require
#ifndef FRONTIER_CONSTANT_MATERIALS
#extension GL_EXT_nonuniform_qualifier : require
#endif
layout(local_size_x=8, local_size_y=8) in;
layout(rgba32f, binding=1) uniform readonly image2D SurfaceImage;
layout(rgba16f, binding=21) uniform writeonly image2D GatherIrradiance;
layout(rgba16f, binding=22) uniform writeonly image2D GatherNormal;
// 📝 The previous frame's accumulated gather, read here and refreshed by the host from this frame's outputs
//    after the dispatch. Four fresh directions a frame cannot describe a hemisphere; accumulated against a
//    validated surface point they become dozens, which is the difference between the smooth irradiance the
//    resolve reconstructs now and the fixed speckle it used to blur.
layout(rgba16f, binding=24) uniform readonly image2D AccumulatedIrradiance;
layout(rgba16f, binding=25) uniform readonly image2D AccumulatedNormal;
layout(rgba16f, binding=26) uniform readonly image2D AccumulatedSurface;
layout(rgba16f, binding=27) uniform writeonly image2D GatherSurface;
#include "DistanceFieldTransport.slang"
#include "DistanceFieldMaterial.slang"
void main()
{
    ivec2 Pixel=ivec2(gl_GlobalInvocationID.xy);
    ivec2 Extent=(ivec2(PC.RenderExtent.xy)+1)/2;
    if (any(greaterThanEqual(Pixel,min(imageSize(GatherIrradiance),Extent)))) return;
    ivec2 SurfacePixel=min(Pixel*2,ivec2(PC.RenderExtent.xy)-1);
    imageStore(GatherIrradiance,Pixel,vec4(0.0));
    imageStore(GatherNormal,Pixel,vec4(0.0));
    imageStore(GatherSurface,Pixel,vec4(0.0));
    // TEMPORARY fault probe 92: no material resolve, no transport — constant guides.
    if (PC.Tuning.w>91.5 && PC.Tuning.w<92.5)
    { imageStore(GatherIrradiance,Pixel,vec4(0.01)); imageStore(GatherNormal,Pixel,vec4(0.0,0.0,1.0,1.0)); imageStore(GatherSurface,Pixel,vec4(0.0)); return; }
    vec4 Surface=imageLoad(SurfaceImage,SurfacePixel);
    uint Packed=floatBitsToUint(Surface.w), Instance=Packed>>14u;
    if (Packed==0xFFFFFFFFu || Instance>=uint(Instances.length())) return;
    GpuInstance Placement=Instances[Instance];
    SurfaceFrame Frame;
    vec3 View=normalize(PC.CameraEye.xyz-Surface.xyz);
    ShadingRecord Material=ResolveMaterial(Materials[Placement.MaterialIndex],Placement,Packed&0x3FFFu,
        Surface.xyz,View,length(PC.CameraEye.xyz-Surface.xyz)*0.0015,Frame);
    if (dot(Frame.Normal,View)<=0.0 || dot(Frame.Emission,Frame.Emission)>0.0) return;
    vec3 Incoming=GatherDistanceRadiance(Surface.xyz,Frame.Normal,true);
    // Accumulate only where the accumulated texel still describes this surface point: same placement, a normal
    //    within tolerance, and the point itself unmoved. Anything else — a moved car, a swung camera, a resized
    //    frame (the host clears the accumulation) — starts again from this frame's samples alone.
    vec4 PreviousNormal=imageLoad(AccumulatedNormal,Pixel);
    vec4 PreviousSurface=imageLoad(AccumulatedSurface,Pixel);
    bool AccumulatedValid=PreviousNormal.w>0.0 && PreviousSurface.w==float(Instance+1u) &&
        dot(Frame.Normal,PreviousNormal.xyz)>0.90 &&
        length(PreviousSurface.xyz-Surface.xyz)<=max(0.05,length(Surface.xyz-PC.CameraEye.xyz)*0.002);
    vec3 Accumulated=AccumulatedValid
        ? mix(imageLoad(AccumulatedIrradiance,Pixel).xyz,Incoming,0.125)
        : Incoming;
    imageStore(GatherIrradiance,Pixel,vec4(clamp(Accumulated,vec3(0.0),vec3(65504.0)),1.0));
    imageStore(GatherNormal,Pixel,vec4(Frame.Normal,1.0));
    imageStore(GatherSurface,Pixel,vec4(Surface.xyz,float(Instance+1u)));
}
