//============================================================================================================================================
// 📦 Engine/Shaders/ReSTIRViewport.slang — ReSTIR DI+GI Cornell Box Compute Shader Writing Directly to a Storage Image
//============================================================================================================================================
// NOTE: GLSL source lowered to SPIR-V by the build scripts (glslc -fshader-stage=compute --target-env=vulkan1.2 -I Engine).
//       World space is right-handed Z-up (CLAUDE.md §7); the pixel→ray mapping lives in Shaders/RayGeneration.slang.

#version 460
#extension GL_GOOGLE_include_directive : require
layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

#include "Shaders/RayGeneration.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                    STORAGE IMAGE OUTPUT
//------------------------------------------------------------------------------------------------------------------------

layout(rgba8,   binding = 0) uniform writeonly image2D OutputImage;    // tone-mapped 8-bit presentation image
layout(rgba32f, binding = 3) uniform          image2D HistoryImage;   // linear HDR running mean, .a = sample count

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE GEOMETRY BINDING
//------------------------------------------------------------------------------------------------------------------------

struct GpuTriangle
{
    vec4 v0;            // xyz = vertex α, w = materialIndex (floatBitsToUint)
    vec4 v1;            // xyz = vertex β, w = triangleIndex (floatBitsToUint)
    vec4 v2;            // xyz = vertex γ, w = pad
    vec4 normal;        // xyz = surface normal, w = pad
};

struct GpuMaterial
{
    vec4 albedo;        // xyz = albedo rgb, w = roughness
    vec4 emissive;      // xyz = emissive radiance, w = metallic
};

layout(std430, binding = 1) readonly buffer TriangleExtent  { GpuTriangle Triangles[]; };
layout(std430, binding = 2) readonly buffer MaterialExtent  { GpuMaterial Materials[]; };

//------------------------------------------------------------------------------------------------------------------------
//                                                    PUSH CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

layout(push_constant) uniform ReSTIRConstants
{
    vec3    CameraOrigin;           // [m]   camera world position
    float   FieldOfViewTanHalf;     // [-]   tan(FoV/2)
    vec3    CameraForward;          // [-]   forward unit vector
    float   AspectRatio;            // [-]   width / height
    vec3    CameraRight;            // [-]   right unit vector
    float   Exposure;               // [-]   ACES exposure
    vec3    CameraUp;               // [-]   up unit vector
    float   AmbientStrength;        // [-]   ambient fallback
    uint    ViewportWidth;          // [px]  render width
    uint    ViewportHeight;         // [px]  render height
    uint    FrameIndex;             // [cnt] temporal accumulation index
    uint    SpatialPassCount;       // [cnt] ReSTIR spatial resampling passes
    uint    SamplesPerPixel;        // [cnt] primary DI candidates per pixel
    uint    TriangleCount;          // [cnt] number of triangles in scene
    uint    LightTriangleCount;     // [cnt] emissive triangles for DI sampling
    uint    FeatureFlags;           // [bit] kFeatureGlobalIllumination | kFeatureAntiAliasing
};

const uint kFeatureGlobalIllumination = 1u;   // bit 0: trace the secondary bounce (section 4)
const uint kFeatureAntiAliasing       = 2u;   // bit 1: sub-pixel jitter on the primary ray (off = pixel centre)

//------------------------------------------------------------------------------------------------------------------------
//                                                    PCG RANDOM
//------------------------------------------------------------------------------------------------------------------------

uint PcgHash(uint v)
{
    uint state = v * 747796405u + 2891336453u;
    uint word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float RandFloat(inout uint seed)
{
    seed = PcgHash(seed);
    return float(seed) * (1.0 / 4294967296.0);
}

uint MakeSeed(uvec2 pixel, uint frame)
{
    return PcgHash(pixel.x + pixel.y * 7919u + frame * 1000003u);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RAY / HIT STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct Ray    { vec3 origin; vec3 dir; };
struct Hit    { bool valid; float t; vec3 pos; vec3 normal; uint matIdx; };

const float kEps = 1e-4;
const float kInf = 1e30;

//------------------------------------------------------------------------------------------------------------------------
//                                                    MOLLER-TRUMBORE INTERSECTION
//------------------------------------------------------------------------------------------------------------------------

Hit IntersectTriangle(Ray ray, GpuTriangle tri)
{
    Hit h;
    h.valid = false;
    h.t     = kInf;

    vec3 v0 = tri.v0.xyz;
    vec3 v1 = tri.v1.xyz;
    vec3 v2 = tri.v2.xyz;

    vec3 edge1 = v1 - v0;
    vec3 edge2 = v2 - v0;
    vec3 pvec  = cross(ray.dir, edge2);
    float det  = dot(edge1, pvec);

    if (abs(det) < kEps) return h;

    float invDet = 1.0 / det;
    vec3  tvec   = ray.origin - v0;
    float u      = dot(tvec, pvec) * invDet;
    if (u < 0.0 || u > 1.0) return h;

    vec3  qvec   = cross(tvec, edge1);
    float v      = dot(ray.dir, qvec) * invDet;
    if (v < 0.0 || u + v > 1.0) return h;

    float t = dot(edge2, qvec) * invDet;
    if (t < kEps) return h;

    h.valid  = true;
    h.t      = t;
    h.pos    = ray.origin + t * ray.dir;
    h.normal = tri.normal.xyz;
    h.matIdx = floatBitsToUint(tri.v0.w);
    return h;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE TRAVERSAL
//------------------------------------------------------------------------------------------------------------------------

Hit TraceScene(Ray ray)
{
    Hit closest;
    closest.valid = false;
    closest.t     = kInf;

    for (uint i = 0u; i < TriangleCount; ++i)
    {
        Hit h = IntersectTriangle(ray, Triangles[i]);
        if (h.valid && h.t < closest.t)
            closest = h;
    }
    return closest;
}

bool TraceShadow(vec3 origin, vec3 target)
{
    vec3 dir = target - origin;
    float tMax = length(dir) - 2.0 * kEps;
    dir = normalize(dir);
    Ray shadow;
    shadow.origin = origin + dir * kEps;
    shadow.dir    = dir;

    for (uint i = 0u; i < TriangleCount; ++i)
    {
        Hit h = IntersectTriangle(shadow, Triangles[i]);
        if (h.valid && h.t < tMax) return true;
    }
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          COSINE-WEIGHTED HEMISPHERE SAMPLING
//------------------------------------------------------------------------------------------------------------------------

vec3 SampleCosineHemisphere(vec3 normal, float u1, float u2)
{
    float r     = sqrt(u1);
    float theta = 6.28318530718 * u2;
    float x     = r * cos(theta);
    float y     = r * sin(theta);
    float z     = sqrt(max(0.0, 1.0 - u1));

    vec3 up      = abs(normal.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 tangent = normalize(cross(up, normal));
    vec3 bitan   = cross(normal, tangent);

    return normalize(tangent * x + bitan * y + normal * z);
}

//------------------------------------------------------------------------------------------------------------------------
//                             LIGHT TRIANGLE AREA SAMPLING (uniform area pick)
//------------------------------------------------------------------------------------------------------------------------

// Light triangles are the last LightTriangleCount entries in the Triangles[] buffer.
vec3 SampleLightPoint(uint lightTriIdx, float u1, float u2)
{
    uint idx = TriangleCount - LightTriangleCount + lightTriIdx;
    vec3 v0 = Triangles[idx].v0.xyz;
    vec3 v1 = Triangles[idx].v1.xyz;
    vec3 v2 = Triangles[idx].v2.xyz;
    float r1 = sqrt(u1);
    return (1.0 - r1) * v0 + r1 * (1.0 - u2) * v1 + r1 * u2 * v2;
}

//------------------------------------------------------------------------------------------------------------------------
//                                           RESTIR DI — WEIGHTED RESERVOIR SAMPLING
//------------------------------------------------------------------------------------------------------------------------

struct Reservoir
{
    vec3  SelectedPoint;    // chosen light sample position
    float WeightSum;        // running sum of candidate weights
    uint  SampleCount;      // M: number of considered candidates
    float UnbiasedWeight;   // W: final unbiased contribution weight
};

void ResampleCandidate(inout Reservoir res, vec3 point, float weight, inout uint seed)
{
    res.WeightSum    += weight;
    res.SampleCount  += 1u;
    if (RandFloat(seed) * res.WeightSum <= weight)
        res.SelectedPoint = point;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              ACES FILMIC TONE MAPPING
//------------------------------------------------------------------------------------------------------------------------

float AcesFilm(float x)
{
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 ToneMap(vec3 hdr)
{
    hdr *= Exposure;
    float r = AcesFilm(hdr.r);
    float g = AcesFilm(hdr.g);
    float b = AcesFilm(hdr.b);
    // gamma 2.2
    return pow(vec3(r, g, b), vec3(1.0 / 2.2));
}

//------------------------------------------------------------------------------------------------------------------------
//                                              TEMPORAL ACCUMULATION RESOLVE
//------------------------------------------------------------------------------------------------------------------------
// Running mean in linear radiance. AccumulationIndex == 0 restarts the history (camera moved / parameter changed);
//    every later frame folds the new estimate in with weight 1/(n+1). Tone mapping is applied to the mean only.

void Resolve(uvec2 pixel, vec3 radiance)
{
    vec4 history = (FrameIndex == 0u) ? vec4(0.0) : imageLoad(HistoryImage, ivec2(pixel));
    float count  = history.a + 1.0;
    vec3  mean   = history.rgb + (radiance - history.rgb) / count;

    imageStore(HistoryImage, ivec2(pixel), vec4(mean, count));
    imageStore(OutputImage,  ivec2(pixel), vec4(ToneMap(mean), 1.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAIN COMPUTE KERNEL
//------------------------------------------------------------------------------------------------------------------------

void main()
{
    uvec2 pixel = gl_GlobalInvocationID.xy;
    if (pixel.x >= ViewportWidth || pixel.y >= ViewportHeight) return;

    uint seed = MakeSeed(pixel, FrameIndex);

    //------------------------------------------------------------------------------------------------------------------
    // 1. Generate primary ray — see RayGeneration.slang for the World → Vulkan-image convention
    //------------------------------------------------------------------------------------------------------------------
    CameraBasis camera;
    camera.Origin     = CameraOrigin;
    camera.Forward    = CameraForward;
    camera.Right      = CameraRight;
    camera.Up         = CameraUp;
    camera.TanHalfFov = FieldOfViewTanHalf;
    camera.Aspect     = AspectRatio;

    Ray primary;
    primary.origin = CameraOrigin;
    vec2 jitter = ((FeatureFlags & kFeatureAntiAliasing) != 0u)
                ? vec2(RandFloat(seed), RandFloat(seed))
                : vec2(0.5, 0.5);
    primary.dir    = GeneratePrimaryDirection(camera, pixel, jitter, uvec2(ViewportWidth, ViewportHeight));

    //------------------------------------------------------------------------------------------------------------------
    // 2. Primary visibility
    //------------------------------------------------------------------------------------------------------------------
    Hit primaryHit = TraceScene(primary);

    if (!primaryHit.valid)
    {
        // Background: pure black. There is no sky and no environment light in the Cornell scene; anything
        // that is not the box must read as a miss, never as a colour.
        Resolve(pixel, vec3(0.0));
        return;
    }

    GpuMaterial mat = Materials[primaryHit.matIdx];
    vec3 albedo     = mat.albedo.xyz;
    vec3 emissive   = mat.emissive.xyz;

    // If we directly hit an emitter — return its radiance
    if (dot(emissive, emissive) > 0.0)
    {
        Resolve(pixel, emissive);
        return;
    }

    vec3 hitPos    = primaryHit.pos;
    vec3 hitNormal = primaryHit.normal;
    // Ensure normal faces incoming ray
    if (dot(hitNormal, -primary.dir) < 0.0) hitNormal = -hitNormal;

    vec3 accumulatedRadiance = vec3(0.0);

    //------------------------------------------------------------------------------------------------------------------
    // 3. ReSTIR DI — per-pixel initial candidates + spatial resampling
    //------------------------------------------------------------------------------------------------------------------

    if (LightTriangleCount > 0u)
    {
        // Initial reservoir from M = SamplesPerPixel candidates
        Reservoir res;
        res.SelectedPoint  = vec3(0.0);
        res.WeightSum      = 0.0;
        res.SampleCount    = 0u;
        res.UnbiasedWeight = 0.0;

        for (uint s = 0u; s < SamplesPerPixel; ++s)
        {
            uint   li          = uint(RandFloat(seed) * float(LightTriangleCount));
            vec3   lp          = SampleLightPoint(li, RandFloat(seed), RandFloat(seed));
            vec3   toLight     = lp - hitPos;
            float  dist        = length(toLight);
            vec3   lDir        = toLight / dist;
            float  cosTheta    = max(0.0, dot(hitNormal, lDir));

            // Get light material
            uint lMatIdx = floatBitsToUint(
                Triangles[TriangleCount - LightTriangleCount + li].v0.w);
            vec3 lEmissive = Materials[lMatIdx].emissive.xyz;

            // Target function: unshadowed direct contribution
            float pHat = cosTheta * length(lEmissive) / (dist * dist + 0.001);
            float w    = pHat / (1.0 / float(LightTriangleCount));

            ResampleCandidate(res, lp, w, seed);
        }

        // Compute unbiased weight W
        if (res.WeightSum > 0.0 && res.SampleCount > 0u)
        {
            vec3  toSel    = res.SelectedPoint - hitPos;
            float selDist  = length(toSel);
            vec3  selDir   = toSel / selDist;
            float cosTheta = max(0.0, dot(hitNormal, selDir));

            // Find emissive of selected light triangle (nearest emissive)
            // We stored selected point — lookup which light triangle it came from via brute-force closest match
            vec3 selEmissive = vec3(0.0);
            float bestD = kInf;
            for (uint li = 0u; li < LightTriangleCount; ++li)
            {
                uint idx = TriangleCount - LightTriangleCount + li;
                vec3 triCenter = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                float d = distance(triCenter, res.SelectedPoint);
                if (d < bestD) { bestD = d; selEmissive = Materials[floatBitsToUint(Triangles[idx].v0.w)].emissive.xyz; }
            }

            float pHatSel = cosTheta * length(selEmissive) / (selDist * selDist + 0.001);
            if (pHatSel > 0.0)
                res.UnbiasedWeight = res.WeightSum / (float(res.SampleCount) * pHatSel);

            // Spatial resampling (SpatialPassCount neighbour merges — approximate)
            for (uint sp = 0u; sp < SpatialPassCount; ++sp)
            {
                // Resample from a neighbour reservoir (jitter around current pixel)
                uint   nli    = uint(RandFloat(seed) * float(LightTriangleCount));
                vec3   nlp    = SampleLightPoint(nli, RandFloat(seed), RandFloat(seed));
                vec3   nToL   = nlp - hitPos;
                float  nDist  = length(nToL);
                float  nCos   = max(0.0, dot(hitNormal, nToL / nDist));
                uint   nMIdx  = floatBitsToUint(Triangles[TriangleCount - LightTriangleCount + nli].v0.w);
                vec3   nEmit  = Materials[nMIdx].emissive.xyz;
                float  nPHat  = nCos * length(nEmit) / (nDist * nDist + 0.001);
                float  nW     = nPHat * res.UnbiasedWeight * float(res.SampleCount);
                ResampleCandidate(res, nlp, nW, seed);
            }

            // Evaluate visibility and shade
            if (!TraceShadow(hitPos + hitNormal * kEps, res.SelectedPoint))
            {
                vec3 shadeDir = normalize(res.SelectedPoint - hitPos);
                float shadeCos = max(0.0, dot(hitNormal, shadeDir));

                // Re-fetch emissive of chosen point
                vec3 chosenEmit = vec3(0.0);
                float bd2 = kInf;
                for (uint li = 0u; li < LightTriangleCount; ++li)
                {
                    uint idx = TriangleCount - LightTriangleCount + li;
                    vec3 c = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                    float d = distance(c, res.SelectedPoint);
                    if (d < bd2) { bd2 = d; chosenEmit = Materials[floatBitsToUint(Triangles[idx].v0.w)].emissive.xyz; }
                }

                float dist2 = dot(res.SelectedPoint - hitPos, res.SelectedPoint - hitPos);
                accumulatedRadiance += albedo * chosenEmit * shadeCos * res.UnbiasedWeight
                                       / (3.14159265 * (dist2 + 0.01));
            }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // 4. ReSTIR GI — one secondary bounce (cosine-sampled hemisphere); skipped when the GI feature is off
    //------------------------------------------------------------------------------------------------------------------
    if ((FeatureFlags & kFeatureGlobalIllumination) != 0u)
    {
        vec3 bounceDir = SampleCosineHemisphere(hitNormal, RandFloat(seed), RandFloat(seed));
        Ray  bounceRay;
        bounceRay.origin = hitPos + hitNormal * kEps;
        bounceRay.dir    = bounceDir;

        Hit bounceHit = TraceScene(bounceRay);
        if (bounceHit.valid)
        {
            GpuMaterial bMat      = Materials[bounceHit.matIdx];
            vec3        bEmissive = bMat.emissive.xyz;
            vec3        bAlbedo   = bMat.albedo.xyz;

            // Direct light at bounce point
            if (dot(bEmissive, bEmissive) > 0.0)
            {
                accumulatedRadiance += albedo * bEmissive;
            }
            else if (LightTriangleCount > 0u)
            {
                vec3  bHitPos    = bounceHit.pos;
                vec3  bHitNormal = bounceHit.normal;
                if (dot(bHitNormal, -bounceDir) < 0.0) bHitNormal = -bHitNormal;

                uint  bLi  = uint(RandFloat(seed) * float(LightTriangleCount));
                vec3  bLp  = SampleLightPoint(bLi, RandFloat(seed), RandFloat(seed));
                vec3  bToL = bLp - bHitPos;
                float bDist = length(bToL);
                vec3  bLDir = bToL / bDist;
                float bCos  = max(0.0, dot(bHitNormal, bLDir));

                uint  bLMatIdx = floatBitsToUint(
                    Triangles[TriangleCount - LightTriangleCount + bLi].v0.w);
                vec3 bLEmit = Materials[bLMatIdx].emissive.xyz;

                if (!TraceShadow(bHitPos + bHitNormal * kEps, bLp))
                {
                    float bDist2 = bDist * bDist;
                    accumulatedRadiance += albedo * bAlbedo * bLEmit * bCos
                                          / (3.14159265 * (bDist2 + 0.01) * float(LightTriangleCount));
                }
            }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // 5. Ambient fallback + tone map + write
    //------------------------------------------------------------------------------------------------------------------
    accumulatedRadiance += albedo * AmbientStrength;

    Resolve(pixel, accumulatedRadiance);
}
