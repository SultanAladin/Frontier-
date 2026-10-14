//============================================================================================================================================
//                                                     DISTANCEFIELDSHARED.SLANG
//============================================================================================================================================
// 📦 What the field route's screen kernels share: the visibility id unpack, the feature/reflection constants, the sky dome,
//    and the field-traced reflection (FacetSurface + ReflectedRadiance). Included after DistanceFieldTransport.slang and
//    DistanceFieldMaterial.slang by DistanceFieldReflectionBody.slang and DistanceFieldGIResolveBody.slang.

#ifndef FRONTIER_DISTANCE_FIELD_SHARED
#define FRONTIER_DISTANCE_FIELD_SHARED

// The visibility id packing SurfaceResolve.slang writes into SurfaceImage.w — identical to ReSTIRViewport's.
const uint kVisibilityInvalid = 0xFFFFFFFFu;
uint VisibilityInstance(uint Packed)  { return (Packed >> 14) & 0x3FFFFu; }
uint VisibilityPrimitive(uint Packed) { return Packed & 0x3FFFu; }

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

#endif // FRONTIER_DISTANCE_FIELD_SHARED
