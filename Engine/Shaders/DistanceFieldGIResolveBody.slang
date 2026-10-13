//============================================================================================================================================
//                                                     DISTANCEFIELDGIRESOLVE.SLANG
//============================================================================================================================================
// 📦 Raster primary visibility, shared OpenPBR materials, distance-field diffuse transport; raster shadow maps and sky-only reflections/transmission.

#extension GL_GOOGLE_include_directive : require
#ifndef FRONTIER_CONSTANT_MATERIALS
#extension GL_EXT_nonuniform_qualifier : require
#endif

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(rgba8, binding=0) uniform writeonly image2D OutputImage;
layout(rgba32f, binding=1) uniform readonly image2D SurfaceImage;
layout(rgba16f, binding=2) uniform readonly image2D NormalImage;
#include "DistanceFieldTransport.slang"
#include "DistanceFieldMaterial.slang"
layout(rgba16f, binding=21) uniform readonly image2D GatherIrradiance;
layout(rgba16f, binding=22) uniform readonly image2D GatherNormal;
layout(rgba32f, binding=23) uniform writeonly image2D LinearRadiance;

// The visibility id packing SurfaceResolve.slang writes into SurfaceImage.w — identical to ReSTIRViewport's.
const uint kVisibilityInvalid = 0xFFFFFFFFu;
uint VisibilityInstance(uint Packed)  { return (Packed >> 14) & 0x3FFFFu; }
uint VisibilityPrimitive(uint Packed) { return Packed & 0x3FFFu; }

//------------------------------------------------------------------------------------------------------------------------
//                                                    PUSH CONSTANTS
//------------------------------------------------------------------------------------------------------------------------
// Feature flags — MUST match Engine/Shaders/ReSTIRViewport.slang so a single ControlCentreSettings drives both paths.
const uint kFeatureGlobalIllumination = 1u;    // bit 0: distance-field diffuse gather runs
// Reflection mode (Counts.w): 0 = Off, 1 = Sky. RT modes never enter this route.
const uint kReflectOff = 0u, kReflectSky = 1u;

// Horizon → zenith gradient about the sky ambient, plus a broad solar aureole. Roughness widens the lobe, which
//    is what a prefiltered cube would have done for a glossy reflection.
vec3 SkyAlongApprox(vec3 Direction, float Roughness)
{
    const vec3  up      = vec3(0.0, 0.0, 1.0);                       // world is RH Z-up, metres
    const float height  = clamp(dot(Direction, up) * 0.5 + 0.5, 0.0, 1.0);
    const vec3  zenith  = PC.SkyAmbient.xyz;
    const vec3  horizon = PC.SkyAmbient.xyz * vec3(1.35, 1.22, 1.05);  // Rayleigh reddens toward the horizon
    vec3 dome = mix(horizon, zenith, height * height);
    const float sunCos  = clamp(dot(Direction, normalize(PC.SunDirectionRadiance.xyz)), 0.0, 1.0);
    const float sharp   = mix(2048.0, 8.0, clamp(Roughness, 0.0, 1.0));
    dome += PC.SunColour.xyz * PC.SunDirectionRadiance.w * pow(sunCos, sharp) * 0.02;
    return dome;
}

// Half-resolution incident light, reconstructed before material evaluation and tone mapping.
// Never borrow across placement identity, a silhouette or a different receiver plane.
vec3 ReconstructIrradiance(ivec2 Pixel, vec3 Position, vec3 Normal, uint Visibility)
{
    ivec2 Center=Pixel/2, Extent=min(imageSize(GatherIrradiance),(ivec2(PC.RenderExtent.xy)+1)/2);
    vec3 Sum=vec3(0.0);
    float Total=0.0;
    for (int Row=-1;Row<=1;++Row) for (int Column=-1;Column<=1;++Column)
    {
        ivec2 Neighbor=Center+ivec2(Column,Row);
        if (any(lessThan(Neighbor,ivec2(0))) || any(greaterThanEqual(Neighbor,Extent))) continue;
        ivec2 SurfacePixel=min(Neighbor*2,ivec2(PC.RenderExtent.xy)-1);
        vec4 Surface=imageLoad(SurfaceImage,SurfacePixel);
        uint Packed=floatBitsToUint(Surface.w);
        if (Packed==kVisibilityInvalid || VisibilityInstance(Packed)!=VisibilityInstance(Visibility)) continue;
        vec4 Guide=imageLoad(GatherNormal,Neighbor);
        float Alignment=dot(Normal,Guide.xyz);
        if (Guide.w==0.0 || Alignment<0.9) continue;
        vec3 Delta=Surface.xyz-Position;
        if (abs(dot(Delta,Normal))>max(0.001,length(Delta)*0.1)) continue;
        float Weight=exp(-float(Column*Column+Row*Row)*0.5)*pow(max(Alignment,0.0),16.0);
        Sum+=imageLoad(GatherIrradiance,Neighbor).xyz*Weight;
        Total+=Weight;
    }
    return Total>0.0 ? Sum/Total : PC.SkyAmbient.xyz;
}

// Schlick Fresnel for the specular/reflection weight.
vec3 Fresnel(vec3 f0, float cosTheta){ float m = clamp(1.0 - cosTheta, 0.0, 1.0); float m2 = m*m; return f0 + (vec3(1.0) - f0) * (m2*m2*m); }

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
        vec3 Incident=SkyAlongApprox(Direction,Material.SpecularRoughness);
        Result+=Incident*EvaluateBaseSpecular(Material,Layers,Outgoing,Incoming)*Incoming.z/max(Density,1e-8);
    }
    return Result/float(Samples);
}


// RT is off on this route. Do not turn SDF into a hidden triangle-ray reflection/refraction renderer.
vec3 Transmission(vec3 Position, vec3 Normal, vec3 View, ShadingRecord Material, bool ThinWalled)
{
    vec3 Direction=ThinWalled ? -View : refract(-View,Normal,1.0/max(Material.SpecularIor,1.01));
    if (dot(Direction,Direction)<1e-8) return vec3(0.0);
    vec3 Attenuation=vec3(1.0);
    if (Material.TransmissionDepth>0.0 && Material.TransmissionThickness>0.0)
        Attenuation=exp(log(max(Material.TransmissionColor,vec3(1e-5)))*Material.TransmissionThickness/
                        (Material.TransmissionDepth*max(abs(dot(View,Normal)),1e-4)));
    return Attenuation*SkyAlongApprox(Direction,Material.SpecularRoughness);
}

void main()
{
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    ivec2 size = imageSize(SurfaceImage);
    if (any(greaterThanEqual(pixel,min(size,ivec2(PC.RenderExtent.xy))))) return;

    vec4 surf = imageLoad(SurfaceImage, pixel);
    vec3 P = surf.xyz;
    uint visibility = floatBitsToUint(surf.w);
    // A miss (no geometry) shows the sky directly.
    if (visibility == kVisibilityInvalid || VisibilityInstance(visibility) >= uint(Instances.length()))
    {
        vec3 V = normalize(P - PC.CameraEye.xyz);
        vec3 sky = SkyAlongApprox(V, 0.0);
        imageStore(LinearRadiance, pixel, vec4(sky, 1.0));
        imageStore(OutputImage, pixel, vec4(pow(sky/(sky+vec3(1.0)), vec3(1.0/2.2)), 1.0));
        return;
    }

    // ── the receiving material, decoded ─────────────────────────────────────────────────────────────────────
    // Same unpack, same instance row, same ResolveMaterial call as ReSTIRViewport.slang's primary hit. The
    //    shading frame comes back from the decode, so the normal map and the tangent basis are the raytraced
    //    path's, not a geometric normal read out of an rgba16f image.
    GpuInstance  inst = Instances[VisibilityInstance(visibility)];
    GpuMaterial  mat  = Materials[inst.MaterialIndex];
    vec3  V         = normalize(PC.CameraEye.xyz - P);
    float coneWidth = length(PC.CameraEye.xyz - P) * 0.0015;   // ≈ one pixel's spread at the hit [m]
    SurfaceFrame F;
    ShadingRecord m = ResolveMaterial(mat, inst, VisibilityPrimitive(visibility), P, V, coneWidth, F);
    vec3 N = F.Normal;

    uint flags = PC.Counts.z;
    uint reflMode = PC.Counts.w;

    // An emitter is its own radiance, as in the raytraced kernel.
    if (dot(F.Emission, F.Emission) > 0.0)
    {
        imageStore(LinearRadiance, pixel, vec4(F.Emission, 1.0));
        vec3 e = F.Emission * PC.SkyAmbient.w;
        imageStore(OutputImage, pixel, vec4(pow(e/(e+vec3(1.0)), vec3(1.0/2.2)), 1.0));
        return;
    }

    vec3 woLoc = ToLocal(F, V);
    if (woLoc.z <= 0.0) { imageStore(LinearRadiance, pixel, vec4(0.0)); imageStore(OutputImage, pixel, vec4(0.0, 0.0, 0.0, 1.0)); return; }
    ResolvedLayers layers = ResolveLayers(m, woLoc);

    // Direct-light visibility comes from the same raster maps as plain raster; no SDF shadow or hidden mesh rays.
    vec3 col = vec3(0.0);
    for (uint Tap=0u; Tap<min(ShadowControl.z,kShadowMaximumTaps); ++Tap)
    {
        bool Directional=(ShadowControl.w&(1u<<Tap))!=0u;
        vec3 Delta=ShadowTapOrigin[Tap].xyz-P;
        float Distance=max(length(Delta),0.001);
        vec3 Direction=Directional ? -ShadowTapNormal[Tap].xyz : Delta/Distance;
        vec3 Incoming=ToLocal(F,Direction);
        float Facing=Directional ? 1.0 : max(-dot(ShadowTapNormal[Tap].xyz,Direction),0.0);
        if (Incoming.z<=0.0 || Facing<=0.0) continue;
        float Visibility=ShadowLitFraction(P,F.Geometric,Incoming.z,Tap);
        float Geometry=Directional ? Incoming.z*Visibility :
                       Incoming.z*Facing*ShadowTapRadiance[Tap].w*Visibility/(Distance*Distance);
        col+=EvaluateBsdf(m,layers,woLoc,Incoming)*ShadowTapRadiance[Tap].xyz*Geometry;
    }

    // --- indirect diffuse: an irradiance through this material's hemispherical response ---
    vec3 response = AmbientResponse(m, layers, woLoc);
    if ((flags & kFeatureGlobalIllumination) != 0u)
        col += response * ReconstructIrradiance(pixel,P,F.Normal,visibility) * PC.Tuning.y;        // distance-field diffuse transport
    else
        col += response * PC.SkyAmbient.xyz;                   // plain raster: sky ambient fill (never black)

    // Use the authored specular lobe and its GGX PDF, not an unconditional 4% perfect mirror.
    col += Reflection(P,F,V,m,layers,reflMode);

    if (m.TransmissionWeight>0.0)
    {
        float FresnelWeight=pow((max(m.SpecularIor,1.01)-1.0)/(max(m.SpecularIor,1.01)+1.0),2.0);
        FresnelWeight+= (1.0-FresnelWeight)*pow(1.0-max(dot(N,V),0.0),5.0);
        col+=m.TransmissionWeight*(1.0-FresnelWeight)*Transmission(P,N,V,m,F.ThinWalled);
    }
    // exposure + Reinhard + gamma
    imageStore(LinearRadiance, pixel, vec4(col, 1.0));
    col *= PC.SkyAmbient.w;
    vec3 mapped = pow(col / (col + vec3(1.0)), vec3(1.0/2.2));
    imageStore(OutputImage, pixel, vec4(mapped, 1.0));
}
