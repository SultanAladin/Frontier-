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
    // SkyAmbient is the hemisphere's irradiance scale the transport uses as fill; the dome's RADIANCE seen directly
    //    is a fraction of it (the raytraced path's atmosphere renders a mid-blue zenith and a bright, whiter
    //    horizon at the same exposure — these factors were read off the two paths' CI captures side by side).
    const vec3  zenith  = PC.SkyAmbient.xyz * 0.30;
    const vec3  horizon = PC.SkyAmbient.xyz * vec3(0.75, 0.62, 0.48);
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
    // 5×5 half-resolution footprint (a 10-pixel radius at full resolution): the 4-sample gather is far too sparse
    //    for a 3×3 to average, which is what showed as speckle on every dark surface. The geometry guards below
    //    keep the wider window from bleeding across silhouettes, placements or receiver planes.
    for (int Row=-2;Row<=2;++Row) for (int Column=-2;Column<=2;++Column)
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
        float Weight=exp(-float(Column*Column+Row*Row)*0.25)*pow(max(Alignment,0.0),16.0);
        Sum+=imageLoad(GatherIrradiance,Neighbor).xyz*Weight;
        Total+=Weight;
    }
    return Total>0.0 ? Sum/Total : PC.SkyAmbient.xyz;
}

// Schlick Fresnel for the specular/reflection weight.
vec3 Fresnel(vec3 f0, float cosTheta){ float m = clamp(1.0 - cosTheta, 0.0, 1.0); float m2 = m*m; return f0 + (vec3(1.0) - f0) * (m2*m2*m); }

// What a reflected direction sees: the distance fields' surface where the sphere-march reaches one, the sky dome
//    past them. The hit is shaded from its own material at the hit point (so a checker reads as a checker in the
//    paint, not as the card's 4x4 mean), with the sun through the same shadow maps as the primary surface and a
//    bounded hemisphere fill for its indirect term; the card radiance is deliberately not re-gathered here. Rough
//    lobes above the threshold see the dome alone — their reflection is the irradiance the gather already
//    integrates, and a 20 m march per sample bought nothing visible there. This is the software (field) tier of
//    reflections; mesh-exact reflections stay on the raytraced route.
// The surface a field hit lands on, from its facet: albedo and emission at the hit's own texel (so a checker reads
//    as a checker in the paint) and the face normal. Deliberately NOT a second ResolveMaterial: that inlines the
//    whole OpenPBR slab decode a second time into this kernel, and on lavapipe (shader on a CPU thread stack) the
//    frame alone faulted the simulate transport (CI run 38553319530) before the branch was ever taken.
void FacetSurface(uint Facet, vec3 Position, out vec3 Albedo, out vec3 Emission, out vec3 Normal)
{
    uint Slot = floatBitsToUint(Facets[Facet].Alpha.w);
    GpuInstance Placement = Instances[Slot];
    GpuMaterial HitMaterial = Materials[Placement.MaterialIndex];
    Normal = CardNormal(Facet, Facets[Facet].Normal.xyz);
    Albedo = HitMaterial.Albedo.xyz * (1.0 - HitMaterial.Emissive.w);
    Emission = HitMaterial.Emissive.xyz;
    if (HitMaterial.Slabs.y == 0u) return;
    GpuMaterialSlab S = MaterialSlabs[HitMaterial.Slabs.x];
    uint Primitive = floatBitsToUint(Facets[Facet].Beta.w);
    uint Base = Placement.FirstIndex + Primitive * 3u;
    GpuVertex A = Vertices[Indices[Base] + Placement.VertexOffset];
    GpuVertex B = Vertices[Indices[Base + 1u] + Placement.VertexOffset];
    GpuVertex C = Vertices[Indices[Base + 2u] + Placement.VertexOffset];
    vec3 Weights = Barycentric((Placements[Slot].WorldToLocal * vec4(Position, 1.0)).xyz, A.Position.xyz, B.Position.xyz, C.Position.xyz);
    vec2 Uv = Weights.x * A.Texcoord.xy + Weights.y * B.Texcoord.xy + Weights.z * C.Texcoord.xy;
    vec4 P0 = S.Payload[0], P1 = S.Payload[1], P11 = S.Payload[11], P12 = S.Payload[12];
    // Coarse lod: a reflection of a far surface wants its mean, not its texels.
    vec3 BaseColour = P0.x * P0.yzw * SampleChannel(S, kChannelBaseColor, Uv, 1.0, vec4(1.0)).xyz;
    Albedo = BaseColour * (1.0 - P1.x);
    Emission = P11.z * vec3(P11.w, P12.xy) * SampleChannel(S, kChannelEmission, Uv, 1.0, vec4(1.0)).xyz;
}

// What a reflected direction sees: the distance fields' surface where the sphere-march reaches one, the sky dome
//    past them. The hit is lit by the sun through the same shadow maps as the primary surface plus a bounded
//    hemisphere fill; the card radiance is deliberately not re-gathered here. Rough lobes above the threshold see
//    the dome alone — their reflection is the irradiance the gather already integrates. This is the software
//    (field) tier of reflections; mesh-exact reflections stay on the raytraced route.
vec3 ReflectedRadiance(vec3 Position, vec3 GeometricNormal, vec3 Direction, float Roughness)
{
    if (Roughness > 0.55 || (uint(PC.Tuning.w + 0.5) & 0x100u) != 0u) return SkyAlongApprox(Direction, Roughness);
    float Tolerance; uint Receiver;
    SampleSceneDistance(Position, Tolerance, Receiver);
    vec3 Origin = Position + GeometricNormal * max(Tolerance * 3.0, 0.003);
    DistanceRayHit Hit = TraceDistanceField(Origin, Direction, 20.0);
    if (Hit.Facet == 0xFFFFFFFFu) return SkyAlongApprox(Direction, Roughness);
    vec3 HitPosition = Origin + Direction * Hit.Travel;
    vec3 Albedo, Emission, Normal;
    FacetSurface(Hit.Facet, HitPosition, Albedo, Emission, Normal);
    if (dot(Normal, Direction) > 0.0) Normal = -Normal;
    vec3 SunDirection = normalize(PC.SunDirectionRadiance.xyz);
    float Cosine = max(dot(Normal, SunDirection), 0.0);
    float Visibility = PC.SunDirectionRadiance.w > 0.0 && Cosine > 0.0 ? DistanceShadow(HitPosition, Normal) : 1.0;
    vec3 Direct = PC.SunColour.xyz * PC.SunDirectionRadiance.w * Cosine * Visibility / 3.14159265359;
    // Indirect at the hit: the card's gathered irradiance (the same cache the diffuse transport reads).
    vec3 Indirect = SampleCachedRadiance(Hit.Facet, HitPosition, true);
    return max(Emission, vec3(0.0)) + Albedo * (Direct + Indirect);
}

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


// RT is off on this route: transmission sees the dome; no triangle rays on the field tier.
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

// The same display transfer as the raytraced kernel (ViewportIntegrator.slang ToneMap): exposure, ACES filmic, gamma 2.2.
//    The SDF path used to Reinhard its own output, so the two lighting modes never matched in contrast or in
//    highlight roll-off; the exposure itself is PC.SkyAmbient.w, the host's adaptive value.
vec3 DisplayTransfer(vec3 radiance)
{
    vec3 hdr = max(radiance, vec3(0.0)) * PC.SkyAmbient.w;
    vec3 mapped = clamp((hdr * (2.51 * hdr + 0.03)) / (hdr * (2.43 * hdr + 0.59) + 0.14), vec3(0.0), vec3(1.0));
    return pow(mapped, vec3(1.0 / 2.2));
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
        imageStore(OutputImage, pixel, vec4(DisplayTransfer(sky), 1.0));
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
        imageStore(OutputImage, pixel, vec4(DisplayTransfer(F.Emission), 1.0));
        return;
    }

    vec3 woLoc = ToLocal(F, V);
    if (woLoc.z <= 0.0) { imageStore(LinearRadiance, pixel, vec4(0.0)); imageStore(OutputImage, pixel, vec4(0.0, 0.0, 0.0, 1.0)); return; }
    ResolvedLayers layers = ResolveLayers(m, woLoc);

    // Direct-light visibility comes from the same raster maps as plain raster; no SDF shadow or hidden mesh rays.
    vec3 col = vec3(0.0);
    vec3 directOnly = vec3(0.0);
    float sunVisibility = 1.0;
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
        if (Directional) sunVisibility = Visibility;
    }
    directOnly = col;

    // --- indirect diffuse: an irradiance through this material's hemispherical response ---
    vec3 response = AmbientResponse(m, layers, woLoc);
    vec3 irradiance = (flags & kFeatureGlobalIllumination) != 0u
        ? ReconstructIrradiance(pixel,P,F.Normal,visibility) * PC.Tuning.y      // distance-field diffuse transport
        : PC.SkyAmbient.xyz;                                                    // plain raster: sky ambient fill (never black)
    col += response * irradiance;

    // Diagnostic views (DistanceFieldFrame::DebugView), each through the same display transfer as the final image.
    uint debugView = uint(PC.Tuning.w + 0.5) & 0xFFu;
    if (debugView != 0u)
    {
        vec3 shown = debugView == 1u ? irradiance * 0.5 :
                     debugView == 2u ? directOnly :
                     debugView == 3u ? vec3(sunVisibility) / max(PC.SkyAmbient.w, 1e-4) :
                                       vec3(dot(irradiance, vec3(1.0 / 3.0)) / max(dot(PC.SkyAmbient.xyz, vec3(1.0 / 3.0)), 1e-6)) / max(PC.SkyAmbient.w, 1e-4);
        imageStore(LinearRadiance, pixel, vec4(shown, 1.0));
        imageStore(OutputImage, pixel, vec4(DisplayTransfer(shown), 1.0));
        return;
    }

    // Use the authored specular lobe and its GGX PDF, not an unconditional 4% perfect mirror.
    col += Reflection(P,F,V,m,layers,reflMode);

    if (m.TransmissionWeight>0.0)
    {
        float FresnelWeight=pow((max(m.SpecularIor,1.01)-1.0)/(max(m.SpecularIor,1.01)+1.0),2.0);
        FresnelWeight+= (1.0-FresnelWeight)*pow(1.0-max(dot(N,V),0.0),5.0);
        col+=m.TransmissionWeight*(1.0-FresnelWeight)*Transmission(P,N,V,m,F.ThinWalled);
    }
    imageStore(LinearRadiance, pixel, vec4(col, 1.0));
    imageStore(OutputImage, pixel, vec4(DisplayTransfer(col), 1.0));
}
