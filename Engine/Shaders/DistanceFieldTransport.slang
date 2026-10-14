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

// Horizon → zenith gradient about the sky ambient, plus a broad solar aureole. Roughness widens the lobe, which
//    is what a prefiltered cube would have done for a glossy reflection. This is the one dome every stage agrees
//    on: a gather ray that leaves the fields reads THIS radiance along its own direction, never the flat ambient,
//    whose magnitude is the hemisphere's irradiance scale — reading it as radiance overstated every missed ray
//    roughly threefold and washed the occlusion out of the image (the sky-fraction capture read white everywhere).
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

float BoxDistanceSquared(vec3 Position, vec3 Minimum, vec3 Maximum)
{
    vec3 Delta = max(max(Minimum - Position, Position - Maximum), vec3(0.0));
    return dot(Delta, Delta);
}

// 📝 The signed form: negative on the closest facet's back side. The march needs the sign, because a sheet thinner
//    than one march step has no sample inside its tolerance band on either side — only the sign change across it
//    proves the ray went through. SampleSceneDistance below is the unsigned magnitude the other callers want.
float SampleSceneSignedDistance(vec3 Position, out float Tolerance, out uint Facet)
{
    float Best = 1e20;          // [m] smallest distance magnitude seen so far; the winner is chosen on this
    float SignedBest = 1e20;    // [m] the winner's signed distance, returned for crossing detection in the march
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
            if (Outside < Best) { Best = Outside; SignedBest = Outside; Facet = 0xFFFFFFFFu; Tolerance = Placement.Maximum.w; }
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
        float Distance = SignedDistance * Placement.Minimum.w;
        if (abs(Distance) < Best)
        {
            Best = abs(Distance);
            SignedBest = Distance;
            Facet = Placement.Identity.y + min(NearestFacet, Placement.Identity.z - 1u);
            Tolerance = Placement.Maximum.w;
        }
    }
    return SignedBest;
}

float SampleSceneDistance(vec3 Position, out float Tolerance, out uint Facet)
{
    return abs(SampleSceneSignedDistance(Position, Tolerance, Facet));
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

struct DistanceRayHit { float Travel; uint Facet; };
DistanceRayHit TraceDistanceField(vec3 Origin, vec3 Direction, float Maximum)
{
    DistanceRayHit Hit;
    Hit.Travel = Maximum;
    Hit.Facet = 0xFFFFFFFFu;
    float Travel = 0.002;
    float PreviousTravel = Travel;   // [m] where the previous field sample was taken
    float PreviousSigned = 1e20;     // [m] signed distance there; the sentinel keeps step zero from "crossing"
    uint  PreviousFacet = 0xFFFFFFFFu;
    // Deliberately bounded diffuse-GI approximation. No exact-triangle fallback, world BVH or clipmap construction.
    for (uint Step = 0u; Step < 48u && Travel < Maximum; ++Step)
    {
        float Tolerance;
        uint Facet;
        vec3 Position = Origin + Direction * Travel;
        float Signed = SampleSceneSignedDistance(Position, Tolerance, Facet);
        float Distance = abs(Signed);
        if (Distance > 1e19) break;
        if (Facet != 0xFFFFFFFFu && Distance < Tolerance && SurfaceCoverage(Facet, Position) > 0.0)
        {
            Hit.Travel = Travel;
            Hit.Facet = Facet;
            return Hit;
        }
        // 📝 A sheet thinner than the step that crossed it leaves no sample inside its own tolerance band: the
        //    unsigned march read straight through body panels and the ground, and the ray came out the far side
        //    counted as sky. The signed field changes sign across such a sheet, so the crossing itself is the hit,
        //    placed by interpolation between the two samples that bracket it. The bracket must be tight: the sign
        //    also flips across a facet's extended plane far from the facet, and a crossing claimed out there
        //    would invent a wall in empty air beside the car.
        if (Step > 0u && PreviousSigned > 0.0 && Signed < 0.0 && Distance < Tolerance * 4.0 && PreviousSigned < Tolerance * 4.0 &&
            (Facet != 0xFFFFFFFFu || PreviousFacet != 0xFFFFFFFFu))
        {
            uint CrossedFacet = Facet != 0xFFFFFFFFu ? Facet : PreviousFacet;
            if (SurfaceCoverage(CrossedFacet, Position) > 0.0)
            {
                float Crossing = PreviousSigned / max(PreviousSigned - Signed, 1e-20);
                Hit.Travel = mix(PreviousTravel, Travel, clamp(Crossing, 0.0, 1.0));
                Hit.Facet = CrossedFacet;
                return Hit;
            }
        }
        PreviousTravel = Travel;
        PreviousSigned = Signed;
        PreviousFacet = Facet;
        // ⚠️ The old floor, 1.5 × Tolerance, was wider than the hit band (2 × Tolerance end to end) a grazing ray
        //    had to land a sample in; 0.75 × keeps the approach sampled while the field distance still dominates
        //    the step wherever the ray is genuinely far from geometry.
        Travel += max(Distance * 0.85, Tolerance * 0.75);
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

// 📐 Cosine-weighted directions about Normal (density cosθ/π, generated as a point on the unit disk read in the
//    tangent plane). Under this density the plain mean of the sampled radiance IS the irradiance over π that the
//    resolve's AmbientResponse expects. The generation this replaces set the height to √u with u uniform, whose
//    density is 1/(4π·cosθ): it crowded samples at grazing angles — exactly where a voxel field is least able to
//    say what a ray hit — and left the mean answering a different integral than the one it was spent on.
vec3 HemisphereDirection(vec3 Normal, uint Sample, uint SampleCount, vec2 Shift)
{
    float DiskFraction = fract((float(Sample) + 0.5) / float(SampleCount) + Shift.x);
    float Angle = 6.28318530718 * fract(float(Sample) * 0.61803398875 + Shift.y);
    float Radius = sqrt(DiskFraction);
    vec3 Tangent = normalize(abs(Normal.z) < 0.9 ? cross(Normal, vec3(0, 0, 1)) : cross(Normal, vec3(0, 1, 0)));
    return Tangent * (cos(Angle) * Radius) + cross(Normal, Tangent) * (sin(Angle) * Radius) +
           Normal * sqrt(max(1.0 - DiskFraction, 0.0));
}

uint ScrambleSample(uint Sequence)
{
    Sequence ^= Sequence >> 16u; Sequence *= 0x7feb352du; Sequence ^= Sequence >> 15u;
    Sequence *= 0x846ca68bu;
    return Sequence ^ (Sequence >> 16u);
}

// The radiance leaving a field hit toward the ray. The card holds the hit's albedo, emission, normal and its
//    gathered INDIRECT irradiance; the sun is evaluated here, at the hit point, through the shadow maps. The card
//    used to hold direct light too, integrated at its own 4x4 texel centres — on a 480 m ground slab those are
//    120 m apart and all sunlit, so a hit on the ground under a car returned sunlit ground, and the shadowed
//    ground beneath was lit by its own reflection. Direct light is a function of position; it is not cached.
vec3 HitRadiance(uint Facet, vec3 Position, bool Current)
{
    ivec2 Pixel = CardOrigin(Facet) + ivec2(clamp(CardCoordinate(Facet, Position) * float(GeometryCounts.w),
                                                vec2(0.0), vec2(GeometryCounts.w - 1u)));
    vec3 Diffuse = imageLoad(SurfaceDiffuse, Pixel).xyz;
    vec3 Emission = imageLoad(SurfaceEmission, Pixel).xyz;
    vec3 Normal = CardNormal(Facet, imageLoad(SurfaceNormal, Pixel).xyz);
    vec3 SunDirection = normalize(PC.SunDirectionRadiance.xyz);
    float Cosine = max(0.0, dot(Normal, SunDirection));
    float Visibility = PC.SunDirectionRadiance.w > 0.0 && Cosine > 0.0 ? DistanceShadow(Position, CardNormal(Facet, Facets[Facet].Normal.xyz)) : 1.0;
    vec3 Direct = PC.SunColour.xyz * PC.SunDirectionRadiance.w * Cosine * Visibility / 3.14159265359;
    return Emission + Diffuse * (Direct + SampleCachedRadiance(Facet, Position, Current));
}

vec3 GatherDistanceRadiance(vec3 Position, vec3 Normal, bool Current)
{
    float Tolerance;
    uint Receiver;
    SampleSceneDistance(Position, Tolerance, Receiver);
    vec3 Origin = Position + Normal * max(Tolerance * 3.0, 0.003);
    // 📝 Per pixel AND per frame (Counts.y is the frame number). A seed fixed per pixel repeats the same few
    //    directions forever, so the estimate converges onto one fixed speckle pattern that no amount of run time
    //    averages away — the blotching the captures showed at frame 90 exactly as at frame 9. Rotating the seed
    //    is what lets the screen gather's accumulation (and the cards' own blend) average different directions.
    uint Seed = ScrambleSample(gl_GlobalInvocationID.x) ^ ScrambleSample(gl_GlobalInvocationID.y + 0x9e3779b9u) ^
                ScrambleSample(PC.Counts.y * 0x632be5abu + 0x1b873593u);
    vec2 Shift = vec2(ScrambleSample(Seed), ScrambleSample(Seed + 1u)) / 4294967296.0;
    uint SampleCount = 4u;
    vec3 Result = vec3(0.0);
    // Firefly ceiling. A diffuse card can return at most albedo/π of the sun's irradiance (≈0.32 × SunColour) plus
    //    sky; a single sample above that is a card-footprint/mip mismatch, not light, and with 4 samples one such
    //    tap paints a white speck on a dark bonnet. Clamped per sample, before the mean.
    vec3 Ceiling = max(PC.SunColour.xyz * 0.4, PC.SkyAmbient.xyz * 6.0);
    for (uint Sample = 0u; Sample < SampleCount; ++Sample)
    {
        vec3 Direction = HemisphereDirection(Normal, Sample, SampleCount, Shift);
        DistanceRayHit Hit = TraceDistanceField(Origin, Direction, 20.0);
        vec3 Radiance = Hit.Facet == 0xFFFFFFFFu ? SkyAlongApprox(Direction, 1.0) :
                        HitRadiance(Hit.Facet, Origin + Direction * Hit.Travel, Current);
        Result += min(Radiance, Ceiling);
    }
    return Result / float(SampleCount);
}
#endif
