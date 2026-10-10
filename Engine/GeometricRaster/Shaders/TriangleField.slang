//============================================================================================================================================
//                                                        TRIANGLEFIELD.SLANG
//============================================================================================================================================
// 📦 GPU import bake and dirty-cell composite for mesh signed distance fields. Mirrors TriangleField.h line for line:
//    TriangleFieldDeviceMirror.h is the CPU exact mirror of these kernels, and the proof checks it against the CPU reference.
//
//    ProjectGridMain       one thread per grid node of one mesh. Exact closest triangle, sign from the closest face normal.
//                   Runs at import time only. Output is the .fsdf distance array (X fastest).
//    ClipMinimumMain  one thread per dirty cell of one clip level. Minimum over the culled instance list of each instance's
//                   sample through its inverse transform. Threads outside the dirty box exit, so only dirty cells are written.
//
// Bindings (set 0):
//    0  GridProjectionParams        constant buffer
//    1  Triangles         StructuredBuffer<float>, 9 floats per triangle (3 corners x xyz)
//    2  ProjectOutput        RWStructuredBuffer<float>, Resolution^3
//    3  ClipMinimumParams   constant buffer
//    4  Instances         StructuredBuffer<InstanceGpu>
//    5  FieldSamples         StructuredBuffer<float>, all mesh fields concatenated (each at InstanceGpu.FieldOffset)
//    6  ClipVolume        RWStructuredBuffer<float>, Dim^3 cells of one clip level

struct GridProjectionParams
{
    float3 Min;
    float3 Max;
    uint   Resolution;
    uint   TriangleCount;
    uint2  Pad;
};

struct ClipMinimumParams
{
    float3 Origin;      // world minimum corner of the clip level
    float  Cell;        // cell edge length
    uint   Dim;         // cells per axis
    uint3  DirtyLo;     // inclusive
    uint3  DirtyHi;     // inclusive
    uint   InstanceCount;
    uint3  Pad;
};

struct InstanceGpu
{
    float4 InverseRow0;     // xyz = inverse 3x3 row, w = inverse translation x   (local = Inverse * p + translation)
    float4 InverseRow1;     // xyz = inverse 3x3 row, w = inverse translation y
    float4 InverseRow2;     // xyz = inverse 3x3 row, w = inverse translation z
    float4 FieldMin;        // xyz = field bounds minimum (field space), w = minimum stretch of the transform
    float4 FieldMax;        // xyz = field bounds maximum, w = field resolution (as float)
    uint   FieldOffset;     // index of the field's first float in FieldSamples
    uint3  Pad;
};

[[vk::binding(0, 0)]] ConstantBuffer<GridProjectionParams>        gBake;
[[vk::binding(1, 0)]] StructuredBuffer<float>           gTriangles;
[[vk::binding(2, 0)]] RWStructuredBuffer<float>         gBakeOutput;
[[vk::binding(3, 0)]] ConstantBuffer<ClipMinimumParams>   gComposite;
[[vk::binding(4, 0)]] StructuredBuffer<InstanceGpu>     gInstances;
[[vk::binding(5, 0)]] StructuredBuffer<float>           gFieldData;
[[vk::binding(6, 0)]] RWStructuredBuffer<float>         gClipVolume;

// Closest point on triangle (Ericson). Same branch order as ClosestOnTriangle in TriangleField.h.
float3 ClosestOnTriangle(float3 P, float3 A, float3 B, float3 C)
{
    float3 AB = B - A, AC = C - A, AP = P - A;
    float D1 = dot(AB, AP), D2 = dot(AC, AP);
    if (D1 <= 0.0 && D2 <= 0.0) return A;
    float3 BP = P - B;
    float D3 = dot(AB, BP), D4 = dot(AC, BP);
    if (D3 >= 0.0 && D4 <= D3) return B;
    float VC = D1 * D4 - D3 * D2;
    if (VC <= 0.0 && D1 >= 0.0 && D3 <= 0.0) return A + (D1 / (D1 - D3)) * AB;
    float3 CP = P - C;
    float D5 = dot(AB, CP), D6 = dot(AC, CP);
    if (D6 >= 0.0 && D5 <= D6) return C;
    float VB = D5 * D2 - D1 * D6;
    if (VB <= 0.0 && D2 >= 0.0 && D6 <= 0.0) return A + (D2 / (D2 - D6)) * AC;
    float VA = D3 * D6 - D5 * D4;
    if (VA <= 0.0 && (D4 - D3) >= 0.0 && (D5 - D6) >= 0.0)
    {
        float W = (D4 - D3) / ((D4 - D3) + (D5 - D6));
        return B + W * (C - B);
    }
    float Denom = 1.0 / (VA + VB + VC);
    return A + AB * (VB * Denom) + AC * (VC * Denom);
}

[shader("compute")]
[numthreads(64, 1, 1)]
void ProjectGridMain(uint3 Id : SV_DispatchThreadID)
{
    uint N     = gBake.Resolution;
    uint Total = N * N * N;
    uint I     = Id.x;
    if (I >= Total) return;
    uint X = I % N;
    uint Y = (I / N) % N;
    uint Z = I / (N * N);
    float3 P = gBake.Min + (gBake.Max - gBake.Min) * float3(float(X), float(Y), float(Z)) / float(N - 1u);

    float Best = 1e30, Sign = 1.0;
    for (uint T = 0u; T < gBake.TriangleCount; ++T)
    {
        uint Base = T * 9u;
        float3 A = float3(gTriangles[Base + 0u], gTriangles[Base + 1u], gTriangles[Base + 2u]);
        float3 B = float3(gTriangles[Base + 3u], gTriangles[Base + 4u], gTriangles[Base + 5u]);
        float3 C = float3(gTriangles[Base + 6u], gTriangles[Base + 7u], gTriangles[Base + 8u]);
        float3 Q = ClosestOnTriangle(P, A, B, C);
        float3 D = P - Q;
        float  S2 = dot(D, D);
        if (S2 < Best * Best)
        {
            Best = sqrt(S2);
            float3 Normal = cross(B - A, C - A);
            Sign = dot(D, Normal) < 0.0 ? -1.0 : 1.0;
        }
    }
    gBakeOutput[I] = Sign * Best;
}

// Trilinear sample of one mesh field in its local space. Same rule as SampleLocal: outside the bounds, the larger of the gap and
// the clamped value minus the gap.
float SampleField(uint Offset, uint N, float3 Min, float3 Max, float3 P)
{
    float3 Clamped = clamp(P, Min, Max);
    float  Gap = length(Clamped - P);
    float3 Grid = (Clamped - Min) / (Max - Min) * float(N - 1u);
    float3 G = min(Grid, float3(float(N - 1u)) - 1e-4);
    uint3  I0 = uint3(max(G, 0.0));
    float3 Fr = G - float3(I0);
    float Accum = 0.0;
    for (uint Corner = 0u; Corner < 8u; ++Corner)
    {
        uint Dx = Corner & 1u, Dy = (Corner >> 1) & 1u, Dz = (Corner >> 2) & 1u;
        float Weight = (Dx != 0u ? Fr.x : 1.0 - Fr.x) * (Dy != 0u ? Fr.y : 1.0 - Fr.y) * (Dz != 0u ? Fr.z : 1.0 - Fr.z);
        uint Index = Offset + (I0.z + Dz) * N * N + (I0.y + Dy) * N + (I0.x + Dx);
        Accum += Weight * gFieldData[Index];
    }
    return Gap > 0.0 ? max(Gap, Accum - Gap) : Accum;
}

[shader("compute")]
[numthreads(4, 4, 4)]
void ClipMinimumMain(uint3 Id : SV_DispatchThreadID)
{
    uint3 Cell = gComposite.DirtyLo + Id;
    if (any(Cell > gComposite.DirtyHi)) return;
    float3 P = gComposite.Origin + (float3(Cell) + 0.5) * gComposite.Cell;

    float Best = 1e30;
    for (uint K = 0u; K < gComposite.InstanceCount; ++K)
    {
        InstanceGpu Inst = gInstances[K];
        float3 Local = float3(
            dot(Inst.InverseRow0.xyz, P) + Inst.InverseRow0.w,
            dot(Inst.InverseRow1.xyz, P) + Inst.InverseRow1.w,
            dot(Inst.InverseRow2.xyz, P) + Inst.InverseRow2.w);
        float D = SampleField(Inst.FieldOffset, uint(Inst.FieldMax.w), Inst.FieldMin.xyz, Inst.FieldMax.xyz, Local) * Inst.FieldMin.w;
        Best = min(Best, D);
    }
    uint Index = (Cell.z * gComposite.Dim + Cell.y) * gComposite.Dim + Cell.x;
    gClipVolume[Index] = Best;
}
