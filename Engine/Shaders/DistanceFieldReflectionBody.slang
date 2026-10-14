//============================================================================================================================================
//                                                     DISTANCEFIELDREFLECTIONBODY.SLANG
//============================================================================================================================================
// 📦 The field route's specular pass: per primary pixel, the authored specular lobe GGX-sampled and traced through the
//    distance fields (sky dome past them), written as the finished specular term the resolve adds. Full resolution,
//    its own kernel: see DistanceFieldGIResolveBody.slang for why it is not inlined there.

#extension GL_GOOGLE_include_directive : require
#ifndef FRONTIER_CONSTANT_MATERIALS
#extension GL_EXT_nonuniform_qualifier : require
#endif

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(rgba32f, binding=1) uniform readonly image2D SurfaceImage;
#include "DistanceFieldTransport.slang"
#include "DistanceFieldMaterial.slang"
layout(rgba16f, binding=24) uniform writeonly image2D ReflectionImage;
#include "DistanceFieldShared.slang"

vec3 Reflection(vec3 Position, SurfaceFrame Surface, vec3 View, ShadingRecord Material, ResolvedLayers Layers, uint Mode)
{
    if (Mode==kReflectOff || Material.SpecularWeight<=0.0) return vec3(0.0);
    vec3 Outgoing=ToLocal(Surface,View);
    vec3 OutgoingAnisotropic=Layers.AnisoBasis*Outgoing;
    vec3 Result=vec3(0.0);
    uint Samples=Material.SpecularRoughness<0.05 ? 1u : 4u;
    for (uint Sample=0u; Sample<Samples; ++Sample)
    {
        vec2 Sequence=vec2(fract(float(Sample)*0.61803398875), (float(Sample)+0.5)/float(Samples));
        bool Haze=fract(float(Sample)*0.754877666)>1.0-Material.HazinessWeight;
        vec3 HalfDirection=SampleGgxVndf(OutgoingAnisotropic,Haze ? Layers.HazeAlpha : Layers.SpecularAlpha,Sequence);
        vec3 IncomingAnisotropic=reflect(-OutgoingAnisotropic,HalfDirection);
        vec3 Incoming=transpose(Layers.AnisoBasis)*IncomingAnisotropic;
        if (Incoming.z<=0.0) continue;
        float Density=mix(GgxVndfPdf(OutgoingAnisotropic,HalfDirection,Layers.SpecularAlpha),
            GgxVndfPdf(OutgoingAnisotropic,HalfDirection,Layers.HazeAlpha),Material.HazinessWeight) /
            (4.0*max(dot(OutgoingAnisotropic,HalfDirection),1e-6));
        vec3 Direction=Surface.Tangent*Incoming.x+Surface.Bitangent*Incoming.y+Surface.Normal*Incoming.z;
        vec3 Incident=ReflectedRadiance(Position,Surface.Geometric,Direction,Material.SpecularRoughness);
        Result+=Incident*EvaluateBaseSpecular(Material,Layers,Outgoing,Incoming)*Incoming.z/max(Density,1e-8);
    }
    return Result/float(Samples);
}



void main()
{
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    ivec2 size = imageSize(SurfaceImage);
    if (any(greaterThanEqual(pixel,min(size,ivec2(PC.RenderExtent.xy))))) return;
    vec4 surf = imageLoad(SurfaceImage, pixel);
    vec3 P = surf.xyz;
    uint visibility = floatBitsToUint(surf.w);
    uint reflMode = PC.Counts.w;
    if (reflMode == kReflectOff || visibility == kVisibilityInvalid || VisibilityInstance(visibility) >= uint(Instances.length()))
    { imageStore(ReflectionImage, pixel, vec4(0.0)); return; }
    GpuInstance  inst = Instances[VisibilityInstance(visibility)];
    GpuMaterial  mat  = Materials[inst.MaterialIndex];
    vec3  V         = normalize(PC.CameraEye.xyz - P);
    float coneWidth = length(PC.CameraEye.xyz - P) * 0.0015;
    SurfaceFrame F;
    ShadingRecord m = ResolveMaterial(mat, inst, VisibilityPrimitive(visibility), P, V, coneWidth, F);
    if (dot(F.Emission, F.Emission) > 0.0) { imageStore(ReflectionImage, pixel, vec4(0.0)); return; }
    vec3 woLoc = ToLocal(F, V);
    if (woLoc.z <= 0.0) { imageStore(ReflectionImage, pixel, vec4(0.0)); return; }
    ResolvedLayers layers = ResolveLayers(m, woLoc);
    vec3 specular = Reflection(P, F, V, m, layers, reflMode);
    // .w: the fraction of the lobe's samples that reached a field rather than the dome (debug view 6).
    uint samples = m.SpecularRoughness < 0.05 ? 1u : 4u;
    imageStore(ReflectionImage, pixel, vec4(clamp(specular, vec3(0.0), vec3(65504.0)), float(ReflectionFieldHits) / float(samples)));
}
