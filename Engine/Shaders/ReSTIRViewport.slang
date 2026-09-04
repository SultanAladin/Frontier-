//============================================================================================================================================
// 📦 Engine/Shaders/ReSTIRViewport.slang — Progressive path tracer with RIS direct lighting (interim kernel)
//============================================================================================================================================
// 🚧 HONEST STATUS (plan v2.1 R0): this is NOT ReSTIR as published. Per pixel it does
//       • primary visibility from the R2 visibility raster (SurfaceImage / NormalImage, no primary rays),
//       • shadow / bounce rays traverse the R3 CWBVH (TraversalCWBVH.slang, bindings 8-9) — O(log N), not O(N),
//       • ReSTIR-DI *initial candidates only*: M light samples resampled with a weighted reservoir (correct RIS),
//         with SpatialPassCount extra candidates folded in — there is NO temporal and NO spatial neighbour reuse (R5),
//       • one cosine-sampled bounce with next-event estimation — plain 1-bounce path tracing, no GI reservoir (R6),
//       • a running-mean accumulation that restarts on camera motion; motion vectors exist (R2) but are not consumed yet (R5), no denoiser (R6).
//    It is kept as the reference image source until the staged frame graph replaces it.
// NOTE: GLSL source lowered to SPIR-V by the build scripts (glslc -fshader-stage=compute --target-env=vulkan1.2 -I Engine).
//       World space is right-handed Z-up (CLAUDE.md §7); the pixel→ray mapping (Shaders/RayGeneration.slang) is applied by
//       SurfaceResolve.slang — this kernel no longer generates camera rays.

#version 460
#extension GL_GOOGLE_include_directive : require
layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

//------------------------------------------------------------------------------------------------------------------------
//                                                    STORAGE IMAGE OUTPUT
//------------------------------------------------------------------------------------------------------------------------

layout(rgba8,   binding = 0) uniform writeonly image2D OutputImage;    // tone-mapped 8-bit presentation image
layout(rgba32f, binding = 3) uniform          image2D HistoryImage;   // linear HDR running mean, .a = sample count
layout(rgba32f, binding = 4) uniform readonly image2D SurfaceImage;   // R2 SurfaceResolve: xyz = world position, w = visibility id bits
layout(rgba16f, binding = 5) uniform readonly image2D NormalImage;    // R2 SurfaceResolve: xyz = camera-facing geometric normal

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE GEOMETRY BINDING
//------------------------------------------------------------------------------------------------------------------------

struct GpuTriangle          // TriangleIndex (SwapchainExchange.h), R4a layout
{
    vec4 v0;            // xyz = vertex α, w = materialIndex (floatBitsToUint)
    vec4 v1;            // xyz = vertex β, w = γ.u
    vec4 v2;            // xyz = vertex γ, w = γ.v
    vec4 uv;            // xy = α.uv, zw = β.uv
};

struct GpuMaterial          // MaterialRecord (ContentInterchange/MaterialIndex.h, 64 B) — R4a header; mirrors SceneRecords.slang
{
    vec4  Albedo;           // xyz = flattened base colour, w = specular roughness
    vec4  Emissive;         // xyz = emission radiance [nit], w = metalness
    uvec4 Slabs;            // x = SlabOffset, y = SlabCount, z = Flags, w = Complexity
    uvec2 Textures;         // x = base colour slot, y = normal slot (0xFFFFFFFF = none)
    float AlphaCutoff;
    float NormalScale;
};

struct GpuMaterialSlab      // MaterialSlabRecord (288 B) — 18 vec4; field map in SceneRecords.slang. Read by R4b shading.
{
    vec4  Payload[15];
    uvec4 TextureSlots0;
    uvec4 TextureSlots1;
    uvec4 Runtime;
};

struct GpuInstance          // InstanceRecord (SceneStructure.h / SceneRecords.slang) — only MaterialIndex is read here
{
    mat4 World;
    mat4 PreviousWorld;
    uint VertexOffset;
    uint FirstIndex;
    uint TriangleCount;
    uint MaterialIndex;
    uint ClusterOffset;
    uint ClusterCount;
    uint Flags;
    uint FlatTriangleOffset;
};

struct GpuLuminaire         // LuminaireRecord (SceneStructure.h): emissive triangle + alias entry
{
    uint  TriangleSlot;     // index into Triangles[]
    uint  InstanceIndex;
    uint  PrimitiveIndex;
    uint  AliasSlot;
    float Threshold;
    float Area;
    float Probability;
    float Pad;
};

layout(std430, binding = 1) readonly buffer TriangleExtent  { GpuTriangle  Triangles[];  };
layout(std430, binding = 2) readonly buffer MaterialExtent  { GpuMaterial  Materials[];  };
layout(std430, binding = 6) readonly buffer InstanceExtent  { GpuInstance  Instances[];  };
layout(std430, binding = 7) readonly buffer LuminaireExtent { GpuLuminaire Luminaires[]; };
layout(std430, binding = 8) readonly buffer TraversalNodeExtent { vec4 CwbvhNodes[]; };   // R3: TraversalIndex node blob
layout(std430, binding = 9) readonly buffer TraversalLeafExtent { vec4 CwbvhTris[];  };   // R3: TraversalIndex triangle blob
layout(std430, binding = 10) readonly buffer MaterialSlabExtent { GpuMaterialSlab MaterialSlabs[]; };   // R4a: per-slab OpenPBR records (unused by the R3 kernel; R4b shading reads them)

#include "TraversalCWBVH.slang"

const uint kVisibilityInvalid = 0xFFFFFFFFu;
uint VisibilityInstance(uint Packed) { return (Packed >> 14) & 0x3FFFFu; }

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
const uint kFeatureAntiAliasing       = 2u;   // bit 1: sub-pixel jitter — applied by the R2 raster/resolve, not here
const uint kFeatureAmbientFloor       = 4u;   // bit 2: add albedo × AmbientStrength (debug fill light; default OFF)

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
//                                                    SCENE TRAVERSAL
//------------------------------------------------------------------------------------------------------------------------

Hit TraceScene(Ray ray)
{
    // R3: closest hit through the CWBVH; the primitive index addresses the flat Triangles[] for material and normal.
    Hit closest;
    closest.valid = false;
    closest.t     = kInf;

    vec3 rD = vec3(1.0) / ray.dir;   // IEEE ±inf on axis-aligned rays is handled by the slab test exactly as in tinybvh
    TraversalHit h = TraverseClosest(ray.origin, ray.dir, rD, kInf);
    if (h.primitive == 0xFFFFFFFFu || h.t <= kEps) return closest;

    GpuTriangle tri = Triangles[h.primitive];
    closest.valid  = true;
    closest.t      = h.t;
    closest.pos    = ray.origin + h.t * ray.dir;
    closest.normal = normalize(cross(tri.v1.xyz - tri.v0.xyz, tri.v2.xyz - tri.v0.xyz));   // R4a: face normal from the edges (slot now carries UVs)
    closest.matIdx = floatBitsToUint(tri.v0.w);
    return closest;
}

bool TraceShadow(vec3 origin, vec3 target)
{
    vec3 dir = target - origin;
    float tMax = length(dir) - 2.0 * kEps;
    dir = normalize(dir);
    vec3 rD = vec3(1.0) / dir;
    return TraverseOccluded(origin + dir * kEps, dir, rD, tMax);
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

// Light triangles come from the luminaire table (R2); the pick stays UNIFORM over luminaires so the Cornell image is
//    bit-for-bit the R0 estimator. The table also carries a Walker alias entry + area-power pdf — R5 switches to it.
uint LightTriangle(uint lightIdx) { return Luminaires[lightIdx].TriangleSlot; }

vec3 SampleLightPoint(uint lightTriIdx, float u1, float u2)
{
    uint idx = LightTriangle(lightTriIdx);
    vec3 v0 = Triangles[idx].v0.xyz;
    vec3 v1 = Triangles[idx].v1.xyz;
    vec3 v2 = Triangles[idx].v2.xyz;
    float r1 = sqrt(u1);
    return (1.0 - r1) * v0 + r1 * (1.0 - u2) * v1 + r1 * u2 * v2;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  RIS DIRECT LIGHTING — WEIGHTED RESERVOIR SAMPLING (initial candidates)
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
    // 1 + 2. Primary visibility — read from the R2 visibility raster instead of tracing. SurfaceResolve intersected the
    //    pixel's camera ray (with the frame's raster jitter) with the rasterised triangle, so hitPos / hitNormal are
    //    what TraceScene used to return, already flipped to face the camera. ⚠️ Deviation from R0: anti-aliasing jitter
    //    is now one Halton offset per FRAME (shared by raster and resolve) instead of one PCG offset per pixel; the
    //    accumulated result converges to the same box-filtered image, only the per-frame noise pattern differs.
    //------------------------------------------------------------------------------------------------------------------
    vec4 surface    = imageLoad(SurfaceImage, ivec2(pixel));
    uint visibility = floatBitsToUint(surface.w);

    if (visibility == kVisibilityInvalid)
    {
        // Background: pure black. There is no sky and no environment light; anything the raster did not cover must
        // read as a miss, never as a colour.
        Resolve(pixel, vec3(0.0));
        return;
    }

    GpuMaterial mat = Materials[Instances[VisibilityInstance(visibility)].MaterialIndex];
    vec3 albedo     = mat.Albedo.xyz;
    vec3 emissive   = mat.Emissive.xyz;

    // If we directly hit an emitter — return its radiance
    if (dot(emissive, emissive) > 0.0)
    {
        Resolve(pixel, emissive);
        return;
    }

    vec3 hitPos    = surface.xyz;
    vec3 hitNormal = imageLoad(NormalImage, ivec2(pixel)).xyz;   // camera-facing (SurfaceResolve applies the two-sided flip)

    vec3 accumulatedRadiance = vec3(0.0);

    //------------------------------------------------------------------------------------------------------------------
    // 3. RIS direct lighting — per-pixel initial candidates (+ extra candidates); no temporal/spatial reuse yet
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
                Triangles[LightTriangle(li)].v0.w);
            vec3 lEmissive = Materials[lMatIdx].Emissive.xyz;

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
                uint idx = LightTriangle(li);
                vec3 triCenter = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                float d = distance(triCenter, res.SelectedPoint);
                if (d < bestD) { bestD = d; selEmissive = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
            }

            float pHatSel = cosTheta * length(selEmissive) / (selDist * selDist + 0.001);
            if (pHatSel > 0.0)
                res.UnbiasedWeight = res.WeightSum / (float(res.SampleCount) * pHatSel);

            // Extra candidates (formerly mislabelled "spatial resampling"): SpatialPassCount further light samples
            //    from THIS pixel, resampled with the same target function so the reservoir stays a valid RIS estimate.
            //    True spatial reuse (neighbour reservoirs + validation) arrives with R5.
            for (uint sp = 0u; sp < SpatialPassCount; ++sp)
            {
                uint   nli    = uint(RandFloat(seed) * float(LightTriangleCount));
                vec3   nlp    = SampleLightPoint(nli, RandFloat(seed), RandFloat(seed));
                vec3   nToL   = nlp - hitPos;
                float  nDist  = length(nToL);
                float  nCos   = max(0.0, dot(hitNormal, nToL / nDist));
                uint   nMIdx  = floatBitsToUint(Triangles[LightTriangle(nli)].v0.w);
                vec3   nEmit  = Materials[nMIdx].Emissive.xyz;
                float  nPHat  = nCos * length(nEmit) / (nDist * nDist + 0.001);
                float  nW     = nPHat / (1.0 / float(LightTriangleCount));   // p̂ / p_source, same as the initial loop
                ResampleCandidate(res, nlp, nW, seed);
            }
            // Recompute W for the final selection (the selected point may have changed).
            {
                vec3  toSel2   = res.SelectedPoint - hitPos;
                float selDist2 = length(toSel2);
                float cos2     = max(0.0, dot(hitNormal, toSel2 / selDist2));
                vec3  emit2    = vec3(0.0);
                float bd       = kInf;
                for (uint li = 0u; li < LightTriangleCount; ++li)
                {
                    uint idx = LightTriangle(li);
                    vec3 c = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                    float d = distance(c, res.SelectedPoint);
                    if (d < bd) { bd = d; emit2 = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
                }
                float pHat2 = cos2 * length(emit2) / (selDist2 * selDist2 + 0.001);
                res.UnbiasedWeight = pHat2 > 0.0 ? res.WeightSum / (float(res.SampleCount) * pHat2) : 0.0;
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
                    uint idx = LightTriangle(li);
                    vec3 c = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                    float d = distance(c, res.SelectedPoint);
                    if (d < bd2) { bd2 = d; chosenEmit = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
                }

                float dist2 = dot(res.SelectedPoint - hitPos, res.SelectedPoint - hitPos);
                accumulatedRadiance += albedo * chosenEmit * shadeCos * res.UnbiasedWeight
                                       / (3.14159265 * (dist2 + 0.01));
            }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // 4. One-bounce indirect (plain path tracing with NEE, no GI reservoir); skipped when the GI feature is off
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
            vec3        bEmissive = bMat.Emissive.xyz;
            vec3        bAlbedo   = bMat.Albedo.xyz;

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
                    Triangles[LightTriangle(bLi)].v0.w);
                vec3 bLEmit = Materials[bLMatIdx].Emissive.xyz;

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
    // 5. Ambient floor (debug only — flag kFeatureAmbientFloor; a real GI pass makes it unnecessary) + tone map + write
    //------------------------------------------------------------------------------------------------------------------
    if ((FeatureFlags & kFeatureAmbientFloor) != 0u)
        accumulatedRadiance += albedo * AmbientStrength;

    Resolve(pixel, accumulatedRadiance);
}
