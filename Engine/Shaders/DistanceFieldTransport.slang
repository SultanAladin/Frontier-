//============================================================================================================================================
//                                                     DISTANCEFIELDTRANSPORT.SLANG
//============================================================================================================================================
// 📦 Immutable mesh-local fields follow placement matrices. Distance fields serve indirect light, never RT routing.

#ifndef FRONTIER_DISTANCE_TRANSPORT
#define FRONTIER_DISTANCE_TRANSPORT

#include "ShadowSample.slang"

struct DistanceFacet { vec4 Alpha; vec4 Beta; vec4 Gamma; vec4 Normal; vec4 Albedo; vec4 Emission; };
struct DistanceVoxel { float Distance; uint Facet; };
struct DistancePlacement
{
    mat4 LocalToWorld;
    mat4 WorldToLocal;
    vec4 Minimum;
    vec4 Maximum;
    uvec4 Resolution;
    uvec4 Identity;
    vec4 WorldMinimum;
    vec4 WorldMaximum;
};
layout(std430, binding = 3) readonly buffer FieldExtent { DistanceVoxel Field[]; };
layout(rgba16f, binding = 4) uniform readonly image2D PreviousRadiance;
layout(std430, binding = 5) readonly buffer DistanceConstants { uvec4 GeometryCounts; };
layout(std430, binding = 6) readonly buffer DistancePlacements { DistancePlacement Placements[]; };
layout(std430, binding = 7) readonly buffer DistanceFacets { DistanceFacet Facets[]; };
layout(rgba16f, binding = 10) uniform image2D NextRadiance;
layout(rgba16f, binding = 8) uniform image2D SurfaceDiffuse;
layout(rgba16f, binding = 9) uniform image2D SurfaceNormal;
layout(rgba16f, binding = 11) uniform image2D SurfaceEmission;
layout(push_constant) uniform DistancePush
{
    vec4 SunDirectionRadiance;
    vec4 SunColour;
    vec4 SkyAmbient;
    vec4 Tuning;
    vec4 CameraEye;
    uvec4 Counts;
    uvec4 RenderExtent;
} PC;

float BoxDistanceSquared(vec3 Position, vec3 Minimum, vec3 Maximum)
{
    vec3 Delta = max(max(Minimum - Position, Position - Maximum), vec3(0.0));
    return dot(Delta, Delta);
}

float SampleSceneDistance(vec3 Position, out float Tolerance, out uint Facet)
{
    float Best = 1e20;
    Tolerance = 0.002;
    Facet = 0xFFFFFFFFu;
    for (uint Slot = 0u; Slot < GeometryCounts.y; ++Slot)
    {
        DistancePlacement Placement = Placements[Slot];
        if (BoxDistanceSquared(Position, Placement.WorldMinimum.xyz, Placement.WorldMaximum.xyz) > Best * Best) continue;
        vec3 Local = (Placement.WorldToLocal * vec4(Position, 1.0)).xyz;
        if (any(lessThan(Local, Placement.Minimum.xyz)) || any(greaterThan(Local, Placement.Maximum.xyz)))
        {
            float Outside = sqrt(BoxDistanceSquared(Local, Placement.Minimum.xyz, Placement.Maximum.xyz)) * Placement.Minimum.w;
            if (Outside < Best) { Best = Outside; Facet = 0xFFFFFFFFu; Tolerance = Placement.Maximum.w; }
            continue;
        }
        vec3 Coordinate = (Local - Placement.Minimum.xyz) / (Placement.Maximum.xyz - Placement.Minimum.xyz) *
                          vec3(Placement.Resolution.xyz - uvec3(1u));
        uvec3 Lower = min(uvec3(Coordinate), Placement.Resolution.xyz - uvec3(2u));
        vec3 Fraction = Coordinate - vec3(Lower);
        float SignedDistance = 0.0;
        float NearestWeight = -1.0;
        uint NearestFacet = 0u;
        for (uint Corner = 0u; Corner < 8u; ++Corner)
        {
            uvec3 Offset = uvec3(Corner & 1u, (Corner >> 1u) & 1u, (Corner >> 2u) & 1u);
            vec3 Weight = mix(vec3(1.0) - Fraction, Fraction, vec3(Offset));
            float Product = Weight.x * Weight.y * Weight.z;
            uvec3 At = Lower + Offset;
            uint Index = Placement.Resolution.w + (At.z * Placement.Resolution.y + At.y) * Placement.Resolution.x + At.x;
            DistanceVoxel Sample = Field[Index];
            SignedDistance += Sample.Distance * Product;
            if (Product > NearestWeight) { NearestWeight = Product; NearestFacet = Sample.Facet; }
        }
        float Distance = abs(SignedDistance) * Placement.Minimum.w;
        if (Distance < Best)
        {
            Best = Distance;
            Facet = Placement.Identity.y + min(NearestFacet, Placement.Identity.z - 1u);
            Tolerance = Placement.Maximum.w;
        }
    }
    return Best;
}

ivec2 CardOrigin(uint Facet)
{
    uint Columns = uint(imageSize(NextRadiance).x) / GeometryCounts.w;
    return ivec2(Facet % Columns, Facet / Columns) * int(GeometryCounts.w);
}

vec3 CardPosition(uint Facet, vec2 Coordinate)
{
    float Root = sqrt(clamp(Coordinate.x, 0.0, 1.0));
    vec3 Weights = vec3(1.0 - Root, Root * (1.0 - Coordinate.y), Root * Coordinate.y);
    vec3 Local = Facets[Facet].Alpha.xyz * Weights.x + Facets[Facet].Beta.xyz * Weights.y + Facets[Facet].Gamma.xyz * Weights.z;
    uint Slot = floatBitsToUint(Facets[Facet].Alpha.w);
    return (Placements[Slot].LocalToWorld * vec4(Local, 1.0)).xyz;
}

vec3 CardNormal(uint Facet, vec3 LocalNormal)
{
    uint Slot = floatBitsToUint(Facets[Facet].Alpha.w);
    return normalize(transpose(mat3(Placements[Slot].WorldToLocal)) * LocalNormal);
}

vec2 CardCoordinate(uint Facet, vec3 Position)
{
    uint Slot = floatBitsToUint(Facets[Facet].Alpha.w);
    Position = (Placements[Slot].WorldToLocal * vec4(Position, 1.0)).xyz;
    vec3 EdgeAlpha = Facets[Facet].Beta.xyz - Facets[Facet].Alpha.xyz;
    vec3 EdgeBeta = Facets[Facet].Gamma.xyz - Facets[Facet].Alpha.xyz;
    vec3 Delta = Position - Facets[Facet].Alpha.xyz;
    float Alpha = dot(EdgeAlpha, EdgeAlpha), Beta = dot(EdgeAlpha, EdgeBeta), Gamma = dot(EdgeBeta, EdgeBeta);
    float Denominator = max(Alpha * Gamma - Beta * Beta, 1e-20);
    vec2 Weights = max(vec2(Gamma * dot(Delta, EdgeAlpha) - Beta * dot(Delta, EdgeBeta),
                           Alpha * dot(Delta, EdgeBeta) - Beta * dot(Delta, EdgeAlpha)) / Denominator, vec2(0.0));
    float Sum = Weights.x + Weights.y;
    return clamp(vec2(Sum * Sum, Weights.y / max(Sum, 1e-10)), vec2(0.0), vec2(1.0));
}

vec3 SampleCachedRadiance(uint Facet, vec3 Position, bool Current)
{
    vec2 Coordinate = clamp(CardCoordinate(Facet, Position) * float(GeometryCounts.w) - 0.5,
                            vec2(0.0), vec2(GeometryCounts.w - 1u));
    ivec2 Lower = ivec2(floor(Coordinate)), Origin = CardOrigin(Facet);
    vec2 Fraction = fract(Coordinate);
    vec3 Radiance = vec3(0.0);
    for (uint Corner = 0u; Corner < 4u; ++Corner)
    {
        ivec2 Offset = ivec2(Corner & 1u, (Corner >> 1u) & 1u);
        ivec2 Pixel = Origin + min(Lower + Offset, ivec2(GeometryCounts.w - 1u));
        vec2 Weight = mix(vec2(1.0) - Fraction, Fraction, vec2(Offset));
        Radiance += (Current ? imageLoad(NextRadiance, Pixel).xyz : imageLoad(PreviousRadiance, Pixel).xyz) * Weight.x * Weight.y;
    }
    return Radiance;
}

float SurfaceCoverage(uint Facet, vec3 Position)
{
    ivec2 Pixel = CardOrigin(Facet) + ivec2(clamp(CardCoordinate(Facet, Position) * float(GeometryCounts.w),
                                                vec2(0.0), vec2(GeometryCounts.w - 1u)));
    return imageLoad(SurfaceNormal, Pixel).w;
}

// Horizon → zenith gradient about the sky ambient, plus a broad solar aureole. Roughness widens the lobe, which
//    is what a prefiltered cube would have done for a glossy reflection. This is the radiance a ray that leaves
//    the fields actually sees: a gather sample that misses must return this dome, never the flat ambient, or
//    every unoccluded point is lit as if the whole hemisphere were zenith-bright and the image washes blue.
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

struct DistanceRayHit { float Travel; uint Facet; };
DistanceRayHit TraceDistanceField(vec3 Origin, vec3 Direction, float Maximum)
{
    DistanceRayHit Hit;
    Hit.Travel = Maximum;
    Hit.Facet = 0xFFFFFFFFu;
    float Travel = 0.002;
    // Deliberately bounded diffuse-GI approximation. No exact-triangle fallback, world BVH or clipmap construction.
    // 📝 64 steps, and the minimum advance is half the surface tolerance, not one and a half times it: at
    //    32 steps a grazing ray beside the car exhausted its budget in open field and reported sky where an exact
    //    ray hits the body (CPU mirror of this march on the Drive scene: 0.102 hits against 0.189 exact beside
    //    the car; 64 steps at 0.85 relaxation measure 0.166, and 0.955 against 0.957 exact under the body).
    for (uint Step = 0u; Step < 64u && Travel < Maximum; ++Step)
    {
        float Tolerance;
        uint Facet;
        vec3 Position = Origin + Direction * Travel;
        float Distance = SampleSceneDistance(Position, Tolerance, Facet);
        if (Distance > 1e19) break;
        if (Facet != 0xFFFFFFFFu && Distance < Tolerance && SurfaceCoverage(Facet, Position) > 0.0)
        {
            Hit.Travel = Travel;
            Hit.Facet = Facet;
            return Hit;
        }
        Travel += max(Distance * 0.85, Tolerance * 0.5);
    }
    return Hit;
}

float DistanceShadow(vec3 Position, vec3 Normal)
{
    for (uint Tap = 0u; Tap < min(ShadowControl.z, kShadowMaximumTaps); ++Tap)
    {
        if ((ShadowControl.w & (1u << Tap)) == 0u) continue;
        if (dot(-ShadowTapNormal[Tap].xyz, normalize(PC.SunDirectionRadiance.xyz)) < 0.99) continue;
        return ShadowLitFraction(Position, Normal, max(dot(Normal, normalize(PC.SunDirectionRadiance.xyz)), 0.0), Tap);
    }
    return 1.0;
}

vec3 HemisphereDirection(vec3 Normal, uint Sample, uint SampleCount, vec2 Shift)
{
    float Height = fract((float(Sample) + 0.5) / float(SampleCount) + Shift.x);
    float Angle = 6.28318530718 * fract(float(Sample) * 0.61803398875 + Shift.y);
    vec3 Tangent = normalize(abs(Normal.z) < 0.9 ? cross(Normal, vec3(0, 0, 1)) : cross(Normal, vec3(0, 1, 0)));
    return Tangent * (cos(Angle) * sqrt(1.0 - Height)) + cross(Normal, Tangent) * (sin(Angle) * sqrt(1.0 - Height)) +
           Normal * sqrt(Height);
}

uint ScrambleSample(uint Sequence)
{
    Sequence ^= Sequence >> 16u; Sequence *= 0x7feb352du; Sequence ^= Sequence >> 15u;
    Sequence *= 0x846ca68bu;
    return Sequence ^ (Sequence >> 16u);
}

vec3 GatherDistanceRadiance(vec3 Position, vec3 Normal, bool Current, out float SkyFraction)
{
    float Tolerance;
    uint Receiver;
    SampleSceneDistance(Position, Tolerance, Receiver);
    vec3 Origin = Position + Normal * max(Tolerance * 3.0, 0.003);
    uint Seed = ScrambleSample(gl_GlobalInvocationID.x) ^ ScrambleSample(gl_GlobalInvocationID.y + 0x9e3779b9u);
    vec2 Shift = vec2(ScrambleSample(Seed), ScrambleSample(Seed + 1u)) / 4294967296.0;
    // 📝 The screen gather is a single-frame estimator — there is no temporal history on this route — so its
    //    sample count is the whole variance budget: 8 cosine-stratified directions at half resolution, and 4
    //    for a card relight, whose Jacobi blend over frames averages further visits on top.
    uint SampleCount = Current ? 8u : 4u;
    uint SkyCount = 0u;
    vec3 Result = vec3(0.0);
    // Firefly ceiling. A diffuse card can return at most albedo/π of the sun's irradiance (≈0.32 × SunColour) plus
    //    sky; a single sample above that is a card-footprint/mip mismatch, not light, and with few samples one
    //    such tap paints a white speck on a dark bonnet. Clamped per sample, before the mean.
    vec3 Ceiling = max(PC.SunColour.xyz * 0.4, PC.SkyAmbient.xyz * 6.0);
    for (uint Sample = 0u; Sample < SampleCount; ++Sample)
    {
        vec3 Direction = HemisphereDirection(Normal, Sample, SampleCount, Shift);
        DistanceRayHit Hit = TraceDistanceField(Origin, Direction, 20.0);
        if (Hit.Facet == 0xFFFFFFFFu) ++SkyCount;
        vec3 Radiance = Hit.Facet == 0xFFFFFFFFu ? SkyAlongApprox(Direction, 1.0) :
                        SampleCachedRadiance(Hit.Facet, Origin + Direction * Hit.Travel, Current);
        Result += min(Radiance, Ceiling);
    }
    SkyFraction = float(SkyCount) / float(SampleCount);
    return Result / float(SampleCount);
}
#endif
