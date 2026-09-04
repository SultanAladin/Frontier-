//============================================================================================================================================
// 📦 Engine/Shaders/SceneRecords.slang — Resident-scene record layouts shared by the R2 passes (include only)
//============================================================================================================================================
// Mirrors Engine/GeometricRaster/SceneStructure.h byte for byte (std430) and the FrameConstants block written by
//    VisibilityExchange.cpp (std140). Change both sides or neither.
//
// Coordinates: world is right-handed Z-up (CLAUDE.md §7). ViewClip already contains the single Vulkan Y flip and the
//    reverse-Z infinite projection (near → depth 1, infinity → depth 0); see GeometricRaster/ClipProjection.h.

#ifndef FRONTIER_SCENE_RECORDS
#define FRONTIER_SCENE_RECORDS

//------------------------------------------------------------------------------------------------------------------------
//                                                     FRAME CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

layout(std140, set = 0, binding = 0) uniform FrameConstants
{
    mat4  ViewClip;             // world → clip, current frame, sub-pixel jitter folded in
    mat4  PreviousViewClip;     // world → clip, previous frame, unjittered (motion vectors)
    vec4  FrustumPlanes[5];     // world-space, normalised: left, right, bottom, top, near (infinite far → no far plane)
    vec4  CameraOrigin;         // xyz = eye, w = near distance
    vec4  CameraForward;        // xyz = forward, w = tan(FoV/2)
    vec4  CameraRight;          // xyz = right,   w = aspect
    vec4  CameraUp;             // xyz = up,      w = unused
    vec4  Jitter;               // xy = clip-space jitter added as clip.xy += Jitter.xy * clip.w; zw = pixel-space jitter [0,1)
    uvec4 Extent;               // x = render width, y = render height, z = HiZ mip count, w = cluster count
    uvec4 Control;              // x = cull phase (1 | 2), y = frame index, z = debug view, w = flags (bit 0: HiZ test on)
    vec4  Projection;           // x = P00, y = |P11| (sphere → screen bounds), zw = unused
};

const uint kControlHiZEnabled = 1u;

//------------------------------------------------------------------------------------------------------------------------
//                                                     SCENE RECORDS
//------------------------------------------------------------------------------------------------------------------------

struct VertexRecord            // 64 B — GeometryStructure.h
{
    vec4 Position;             // xyz, w = pad
    vec4 Normal;               // xyz, w = pad
    vec4 Tangent;              // xyz, w = sign
    vec4 Texcoord;             // xy = uv, zw = pad
};

struct InstanceRecord          // 160 B — SceneStructure.h
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

struct ClusterRecord           // 48 B — SceneStructure.h
{
    vec4 Sphere;               // xyz = object-space centre, w = radius
    vec4 Cone;                 // xyz = object-space axis,   w = cutoff (1.0 = never culled)
    uint InstanceIndex;
    uint FirstIndex;
    uint TriangleCount;
    uint FirstPrimitive;
};

struct MaterialRecord          // 48 B — RadianceStructure (SwapchainExchange.h)
{
    vec4 Albedo;               // xyz = albedo, w = roughness
    vec4 Emissive;             // xyz = radiance, w = metallic
    uvec4 Identity;            // x = identifier
};

struct DrawCommand             // VkDrawIndexedIndirectCommand
{
    uint IndexCount;
    uint InstanceCount;
    uint FirstIndex;
    int  VertexOffset;
    uint FirstInstance;        // = cluster index (read back through gl_InstanceIndex)
};

// Counters[0] = draw count (consumed by vkCmdDrawIndexedIndirectCount); the rest are telemetry.
const uint kCounterDrawCount     = 0u;
const uint kCounterClusterTotal  = 1u;
const uint kCounterFrustumPassed = 2u;
const uint kCounterConePassed    = 3u;
const uint kCounterHiZPassed     = 4u;
const uint kCounterTriangleDrawn = 5u;
const uint kCounterPhaseOneDrawn = 6u;
const uint kCounterDrawCountPhaseTwo = 7u;   // draw count of the phase-2 list (vkCmdDrawIndexedIndirectCount reads it at byte 28)
const uint kCounterCount         = 8u;

const uint kInstanceFlagDoubleSided = 1u;
const uint kInstanceFlagEmissive    = 2u;

//------------------------------------------------------------------------------------------------------------------------
//                                                  VISIBILITY IDENTIFIER
//------------------------------------------------------------------------------------------------------------------------
// GeometricRaster/VisibilityProjection.h: 18-bit instance token << 14 | 14-bit primitive token; 0xFFFFFFFF = nothing.

const uint kVisibilityInvalid = 0xFFFFFFFFu;

uint PackVisibility(uint InstanceToken, uint PrimitiveToken)
{
    return ((InstanceToken & 0x3FFFFu) << 14) | (PrimitiveToken & 0x3FFFu);
}

uint VisibilityInstance(uint Packed)  { return (Packed >> 14) & 0x3FFFFu; }
uint VisibilityPrimitive(uint Packed) { return Packed & 0x3FFFu; }

#endif // FRONTIER_SCENE_RECORDS
