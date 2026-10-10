//============================================================================================================================================
// 📦 Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders/SolidArcVulkanEntries.slang — Vulkan entry points for the SolidArc raster
//============================================================================================================================================
// The bodies live in the sibling files (ShadingRecords, LatticeProjection, SurfaceRaster, LineRaster, PointRaster, MatcapStudio). This
//    file only adds what a Vulkan pipeline needs on top of them: entry points, descriptor bindings, the pick output, and the
//    matcap glue. The SAME bodies are compiled as C++ by SoftwareRaster (SlangMirror.h), so the CPU mirror and the SPIR-V share text.
//
// Bindings (one descriptor set, two dynamic uniform buffers, the same layout for every pipeline):
//    set 0, binding 0  ViewRecord  (dynamic offset per BindView / draw)
//    set 0, binding 1  DrawRecord  (dynamic offset per draw)
//
// Outputs: colour0 = straight-alpha RGBA8 (blended); colour1 = pick identity (R32_UINT, written only by pickable pipelines).
//    Pick identity travels in DrawRecord.Selection.y as float bits; the line dashing flag travels in DrawRecord.Surface.w.
//
// Lattice: the mirror's 4-tap supersampling (SoftwareRaster::DrawLattice) is reproduced here so both paths average the same taps.

#include "ShadingRecords.slang"
#include "LatticeProjection.slang"
#include "SurfaceRaster.slang"
#include "LineRaster.slang"
#include "PointRaster.slang"

[[vk::binding(0, 0)]] ConstantBuffer<ViewRecord> gView;
[[vk::binding(1, 0)]] ConstantBuffer<DrawRecord> gDraw;

// Matcap studio lookup. The CPU mirror pre-renders studios into 128x128 layers; the GPU evaluates the same analytic studio per
//    fragment. This is a documented difference: the pixels are equal only in the analytic limit (see Exhibits README).
float3 MatcapLookup(uint Layer, float3 ViewNormal)
{
    return MatcapStudioSample(Layer, ViewNormal);
}

//------------------------------------------------------------------------------------------------------------------------ LATTICE

struct LatticeFSOut
{
    float4 Colour : SV_Target0;
    float  Depth  : SV_Depth;
};

[shader("vertex")]
float4 LatticeVS(uint Vertex : SV_VertexID) : SV_Position
{
    // Full-screen triangle: (-1,-1), (3,-1), (-1,3).
    float2 P = float2((Vertex << 1) & 2, Vertex & 2);
    return float4(P * 2.0 - 1.0, 0.0, 1.0);
}

[shader("fragment")]
LatticeFSOut LatticeFS(float4 Position : SV_Position)
{
    float2 Pixel  = Position.xy;
    float2 Size   = gView.Viewport.xy;
    bool   Persp  = gView.EyePosition.w > 0.5;
    float3 Eye    = gView.EyePosition.xyz;
    float  PixelAngle = gView.DepthPolicy.y;     // perspective: radians per pixel
    float  PixelWorld = gView.DepthPolicy.z;     // orthographic: world units per pixel

    const float2 Taps[4] = { float2(0.25, 0.25), float2(0.75, 0.25), float2(0.25, 0.75), float2(0.75, 0.75) };
    float4 Sum = float4(0, 0, 0, 0);
    float  DepthMin = 1.0;
    for (int I = 0; I < 4; ++I)
    {
        float2 Tap = Pixel + Taps[I] - float2(0.5, 0.5);
        // Sub-pixel position → NDC (Y down in the viewport, Vulkan NDC has Y down as well).
        float2 Ndc = (Tap / Size) * 2.0 - 1.0;
        float4 NearH = mul(gView.ClipView, float4(Ndc, 0.0, 1.0));
        float4 FarH  = mul(gView.ClipView, float4(Ndc, 1.0, 1.0));
        float3 NearP = NearH.xyz / NearH.w;
        float3 FarP  = FarH.xyz / FarH.w;
        float3 Origin = Persp ? Eye : NearP;
        float3 Direction = normalize(FarP - NearP);
        LatticeSample G = LatticeShade(gView, Origin, Direction, PixelAngle, PixelWorld);
        Sum += float4(G.Colour.xyz * G.Colour.w, G.Colour.w);
        DepthMin = min(DepthMin, G.Depth);
    }
    LatticeFSOut Out;
    Out.Colour = float4(0, 0, 0, 0);
    Out.Depth  = DepthMin;
    if (Sum.w <= 0.002) { Out.Depth = 1.0; return Out; }     // no coverage: keep the cleared depth
    Out.Colour = float4(Sum.x / Sum.w, Sum.y / Sum.w, Sum.z / Sum.w, Sum.w * 0.25);
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------ SURFACE

struct SurfaceVSIn
{
    [[vk::location(0)]] float3 Position  : POSITION;
    [[vk::location(1)]] float3 Normal    : NORMAL;
    [[vk::location(2)]] float2 Parameter : TEXCOORD0;
};

struct SurfaceVSOut
{
    float4 Clip          : SV_Position;
    float3 WorldPosition : TEXCOORD0;
    float3 WorldNormal   : TEXCOORD1;
    float2 Parameter     : TEXCOORD2;
};

[shader("vertex")]
SurfaceVSOut SurfaceVS(SurfaceVSIn In)
{
    SurfaceVarying V = SurfaceVertex(gView, gDraw, In.Position, In.Normal, In.Parameter);
    SurfaceVSOut Out;
    Out.Clip          = V.Clip;
    Out.WorldPosition = V.WorldPosition;
    Out.WorldNormal   = V.WorldNormal;
    Out.Parameter     = V.Parameter;
    return Out;
}

struct FragOut
{
    float4 Colour : SV_Target0;
    uint   Pick   : SV_Target1;
};

[shader("fragment")]
FragOut SurfaceFS(SurfaceVSOut In, bool FrontFacing : SV_IsFrontFace)
{
    SurfaceVarying V;
    V.Clip          = In.Clip;
    V.WorldPosition = In.WorldPosition;
    V.WorldNormal   = In.WorldNormal;
    V.Parameter     = In.Parameter;
    FragOut Out;
    Out.Colour = SurfaceFragment(gView, gDraw, V, FrontFacing);
    Out.Pick   = uint(gDraw.Selection.y + 0.5);
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------ LINES

struct LineVSIn
{
    [[vk::location(0)]] float3 A : POSITION0;                      // instance-rate, per segment
    [[vk::location(1)]] float3 B : POSITION1;
};

struct LineVSOut
{
    float4 Clip          : SV_Position;
    float  Across        : TEXCOORD0;
    float  Along         : TEXCOORD1;
    float  SegmentPixels : TEXCOORD2;
};

[shader("vertex")]
LineVSOut LineVS(LineVSIn In, uint Corner : SV_VertexID)
{
    LineVarying V = LineVertex(gView, gDraw, In.A, In.B, Corner);
    LineVSOut Out;
    Out.Clip = V.Clip; Out.Across = V.Across; Out.Along = V.Along; Out.SegmentPixels = V.SegmentPixels;
    return Out;
}

[shader("fragment")]
FragOut LineFS(LineVSOut In)
{
    LineVarying V;
    V.Clip = In.Clip; V.Across = In.Across; V.Along = In.Along; V.SegmentPixels = In.SegmentPixels;
    FragOut Out;
    Out.Colour = LineFragment(gView, gDraw, V, gDraw.Surface.w > 0.5);
    Out.Pick   = uint(gDraw.Selection.y + 0.5);
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------ POINTS

struct PointVSIn
{
    [[vk::location(0)]] float3 Position : POSITION0;               // instance-rate, per point
    [[vk::location(1)]] float  Glyph    : TEXCOORD0;
};

struct PointVSOut
{
    float4 Clip  : SV_Position;
    float2 Local : TEXCOORD0;
    float  Glyph : TEXCOORD1;
};

[shader("vertex")]
PointVSOut PointVS(PointVSIn In, uint Corner : SV_VertexID)
{
    PointVarying V = PointVertex(gView, gDraw, In.Position, In.Glyph, Corner);
    PointVSOut Out;
    Out.Clip = V.Clip; Out.Local = V.Local; Out.Glyph = V.Glyph;
    return Out;
}

[shader("fragment")]
FragOut PointFS(PointVSOut In)
{
    PointVarying V;
    V.Clip = In.Clip; V.Local = In.Local; V.Glyph = In.Glyph;
    FragOut Out;
    Out.Colour = PointFragment(gView, gDraw, V);
    Out.Pick   = uint(gDraw.Selection.y + 0.5);
    return Out;
}
