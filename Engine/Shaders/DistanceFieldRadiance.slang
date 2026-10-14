//============================================================================================================================================
//                                                     DISTANCEFIELDRADIANCE.SLANG
//============================================================================================================================================
// 📦 Jacobi surface-irradiance propagation: separate previous/next card images of gathered indirect light; the sun and the surface are applied at the hit.

#version 460
#extension GL_GOOGLE_include_directive : require
layout(local_size_x=64) in;
#include "DistanceFieldTransport.slang"
void main()
{
    ivec2 Extent=imageSize(NextRadiance);
    uint Texels=uint(Extent.x)*uint(Extent.y), Budget=min(Texels,PC.RenderExtent.w);
    if (gl_GlobalInvocationID.x>=Budget) return;
    uint Index=(PC.Counts.y*Budget+gl_GlobalInvocationID.x)%Texels;
    ivec2 Pixel=ivec2(Index%uint(Extent.x),Index/uint(Extent.x));
    uint Resolution=GeometryCounts.w;
    uint Facet=uint(Pixel.y)/Resolution*(uint(Extent.x)/Resolution)+uint(Pixel.x)/Resolution;
    if (Facet>=GeometryCounts.z || imageLoad(SurfaceNormal,Pixel).w<=0.0)
    { imageStore(NextRadiance,Pixel,vec4(0)); return; }
    vec3 Position=CardPosition(Facet,(vec2(Pixel%int(Resolution))+0.5)/float(Resolution));
    vec3 Normal=CardNormal(Facet,imageLoad(SurfaceNormal,Pixel).xyz);
    // The card caches the texel's INDIRECT irradiance only (gathered through the fields, occlusion-weighted).
    //    Albedo, emission and the sun are applied at the hit point by HitRadiance, so a 4x4 card over a 480 m slab
    //    no longer decides where the sun falls. Jacobi: reads the previous image, writes the next.
    float Occlusion=imageLoad(SurfaceEmission,Pixel).w;
    vec3 Indirect=GatherDistanceRadiance(Position,Normal,false)*Occlusion;
    float Weight=PC.Tuning.z>0.5 ? 1.0 : 0.25;
    imageStore(NextRadiance,Pixel,vec4(mix(imageLoad(PreviousRadiance,Pixel).xyz,min(Indirect,vec3(65504.0)),Weight),1.0));
}
