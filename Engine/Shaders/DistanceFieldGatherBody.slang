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
layout(rgba16f, binding=25) uniform readonly image2D PreviousGatherIrradiance;
layout(rgba16f, binding=26) uniform readonly image2D PreviousGatherNormal;
layout(rgba32f, binding=27) uniform readonly image2D PreviousGatherPosition;
layout(rgba32f, binding=28) uniform writeonly image2D GatherPosition;
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
    imageStore(GatherPosition,Pixel,vec4(0.0));
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
    float Frames=1.0;
    // The four rays must change each frame, otherwise spatial filtering only blurs a fixed noisy pattern.
    // Reuse screen history only on the SAME raster surface; a moving/rotating car or a silhouette rejects itself.
    if (PC.RenderExtent.z != 0u)
    {
        vec4 Old=imageLoad(PreviousGatherIrradiance,Pixel);
        if (Old.w>0.0)
        {
            vec4 Guide=imageLoad(PreviousGatherPosition,Pixel);
            vec4 Normal=imageLoad(PreviousGatherNormal,Pixel);
            float PositionLimit=max(0.015,length(PC.CameraEye.xyz-Surface.xyz)*0.002);
            if (floatBitsToUint(Guide.w)==Packed && Normal.w>0.0 &&
                dot(Normal.xyz,Frame.Normal)>0.95 && length(Guide.xyz-Surface.xyz)<PositionLimit)
            {
                Frames=min(Old.w,16.0)+1.0;
                Incoming=mix(Old.xyz,Incoming,1.0/Frames);
            }
        }
    }
    imageStore(GatherIrradiance,Pixel,vec4(clamp(Incoming,vec3(0.0),vec3(65504.0)),Frames));
    imageStore(GatherNormal,Pixel,vec4(Frame.Normal,1.0));
    imageStore(GatherPosition,Pixel,vec4(Surface.xyz,uintBitsToFloat(Packed)));
}
