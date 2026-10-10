//============================================================================================================================================
//                                                    TRIANGLEFIELDGPUMIRROR.H
//============================================================================================================================================
// 📦 CPU exact mirror of Engine/GeometricRaster/Shaders/TriangleField.slang. Each function follows its shader counterpart line for line and
//    works on the same flat buffers (9 floats per triangle, concatenated field data, InstanceGpu records, clip volume X fastest).
//    The proof checks this mirror against the CPU reference in TriangleField.h. The GPU must match this mirror, and that check
//    needs a device run, which this sandbox cannot do.

#pragma once

#include "TriangleField.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace TriangleFieldDeviceMirror
{
struct float3 { float X, Y, Z; };

inline float3 F3(float X, float Y, float Z) noexcept { return { X, Y, Z }; }
inline float3 operator+(float3 A, float3 B) noexcept { return { A.X + B.X, A.Y + B.Y, A.Z + B.Z }; }
inline float3 operator-(float3 A, float3 B) noexcept { return { A.X - B.X, A.Y - B.Y, A.Z - B.Z }; }
inline float3 operator*(float3 A, float S) noexcept { return { A.X * S, A.Y * S, A.Z * S }; }
inline float3 operator*(float S, float3 A) noexcept { return A * S; }
inline float3 operator/(float3 A, float S) noexcept { return { A.X / S, A.Y / S, A.Z / S }; }
inline float3 operator*(float3 A, float3 B) noexcept { return { A.X * B.X, A.Y * B.Y, A.Z * B.Z }; }
inline float3 operator/(float3 A, float3 B) noexcept { return { A.X / B.X, A.Y / B.Y, A.Z / B.Z }; }
inline float  Dot3(float3 A, float3 B) noexcept { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
inline float3 Cross3(float3 A, float3 B) noexcept { return { A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X }; }
inline float  Length3(float3 A) noexcept { return std::sqrt(Dot3(A, A)); }

// Ericson closest point, same branch order as ClosestOnTriangle in the shader and in TriangleField.h.
inline float3 ClosestOnTriangle(float3 P, float3 A, float3 B, float3 C) noexcept
{
    float3 AB = B - A, AC = C - A, AP = P - A;
    float D1 = Dot3(AB, AP), D2 = Dot3(AC, AP);
    if (D1 <= 0.0f && D2 <= 0.0f) return A;
    float3 BP = P - B;
    float D3 = Dot3(AB, BP), D4 = Dot3(AC, BP);
    if (D3 >= 0.0f && D4 <= D3) return B;
    float VC = D1 * D4 - D3 * D2;
    if (VC <= 0.0f && D1 >= 0.0f && D3 <= 0.0f) return A + AB * (D1 / (D1 - D3));
    float3 CP = P - C;
    float D5 = Dot3(AB, CP), D6 = Dot3(AC, CP);
    if (D6 >= 0.0f && D5 <= D6) return C;
    float VB = D5 * D2 - D1 * D6;
    if (VB <= 0.0f && D2 >= 0.0f && D6 <= 0.0f) return A + AC * (D2 / (D2 - D6));
    float VA = D3 * D6 - D5 * D4;
    if (VA <= 0.0f && (D4 - D3) >= 0.0f && (D5 - D6) >= 0.0f)
    {
        float W = (D4 - D3) / ((D4 - D3) + (D5 - D6));
        return B + (C - B) * W;
    }
    float Denom = 1.0f / (VA + VB + VC);
    return A + AB * (VB * Denom) + AC * (VC * Denom);
}

struct GridProjectionParams
{
    float3   Min, Max;
    uint32_t Resolution, TriangleCount;
};

// ProjectGridMain for one thread: the value of node I.
inline float ProjectNode(const GridProjectionParams& P, const std::vector<float>& Triangles, uint32_t I) noexcept
{
    const uint32_t N = P.Resolution;
    const uint32_t X = I % N, Y = (I / N) % N, Z = I / (N * N);
    const float3 Pos = P.Min + (P.Max - P.Min) * F3(float(X), float(Y), float(Z)) / float(N - 1u);
    float Best = 1e30f, Sign = 1.0f;
    for (uint32_t T = 0u; T < P.TriangleCount; ++T)
    {
        const size_t Base = size_t(T) * 9u;
        const float3 A = F3(Triangles[Base + 0], Triangles[Base + 1], Triangles[Base + 2]);
        const float3 B = F3(Triangles[Base + 3], Triangles[Base + 4], Triangles[Base + 5]);
        const float3 C = F3(Triangles[Base + 6], Triangles[Base + 7], Triangles[Base + 8]);
        const float3 Q = ClosestOnTriangle(Pos, A, B, C);
        const float3 D = Pos - Q;
        const float  S2 = Dot3(D, D);
        if (S2 < Best * Best)
        {
            Best = std::sqrt(S2);
            const float3 Normal = Cross3(B - A, C - A);
            Sign = Dot3(D, Normal) < 0.0f ? -1.0f : 1.0f;
        }
    }
    return Sign * Best;
}

// ProjectGridMain over the whole grid. Same output layout as TriangleField::Field::Distance.
inline std::vector<float> ProjectGrid(const GridProjectionParams& P, const std::vector<float>& Triangles)
{
    const uint32_t Total = P.Resolution * P.Resolution * P.Resolution;
    std::vector<float> Out(Total);
    for (uint32_t I = 0u; I < Total; ++I) Out[I] = ProjectNode(P, Triangles, I);
    return Out;
}

// InstanceGpu, as laid out by the shader.
struct InstanceGpu
{
    float    InverseRow0[4], InverseRow1[4], InverseRow2[4];
    float    FieldMin[4], FieldMax[4];   // FieldMin.w = minimum stretch, FieldMax.w = resolution as float
    uint32_t FieldOffset;
};

inline InstanceGpu MakeInstanceGpu(const TriangleField::Field& F, const TriangleField::Affine& A, uint32_t FieldOffset) noexcept
{
    InstanceGpu G{};
    for (int C = 0; C < 4; ++C) G.InverseRow0[C] = 0.0f, G.InverseRow1[C] = 0.0f, G.InverseRow2[C] = 0.0f;
    for (int C = 0; C < 3; ++C)
    {
        G.InverseRow0[C] = A.Inverse[0 + C];
        G.InverseRow1[C] = A.Inverse[3 + C];
        G.InverseRow2[C] = A.Inverse[6 + C];
    }
    G.InverseRow0[3] = A.InverseTranslation[0];
    G.InverseRow1[3] = A.InverseTranslation[1];
    G.InverseRow2[3] = A.InverseTranslation[2];
    for (int C = 0; C < 3; ++C) { G.FieldMin[C] = F.H.Min[C]; G.FieldMax[C] = F.H.Max[C]; }
    G.FieldMin[3] = A.MinScale;
    G.FieldMax[3] = float(F.H.Resolution);
    G.FieldOffset = FieldOffset;
    return G;
}

// SampleField in the shader. Payload is the concatenation of every field.
inline float SampleField(const std::vector<float>& FieldSamples, uint32_t Offset, uint32_t N, float3 Min, float3 Max, float3 P) noexcept
{
    const float3 Clamped = F3(std::clamp(P.X, Min.X, Max.X), std::clamp(P.Y, Min.Y, Max.Y), std::clamp(P.Z, Min.Z, Max.Z));
    const float  Gap = Length3(Clamped - P);
    const float3 Grid = (Clamped - Min) / (Max - Min) * float(N - 1u);
    const float  Lim = float(N - 1u) - 1e-4f;
    const float3 G = F3(std::min(Grid.X, Lim), std::min(Grid.Y, Lim), std::min(Grid.Z, Lim));
    const uint32_t I0x = uint32_t(std::max(G.X, 0.0f)), I0y = uint32_t(std::max(G.Y, 0.0f)), I0z = uint32_t(std::max(G.Z, 0.0f));
    const float3 Fr = F3(G.X - float(I0x), G.Y - float(I0y), G.Z - float(I0z));
    float Accum = 0.0f;
    for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
    {
        const uint32_t Dx = Corner & 1u, Dy = (Corner >> 1) & 1u, Dz = (Corner >> 2) & 1u;
        const float Weight = (Dx != 0u ? Fr.X : 1.0f - Fr.X) * (Dy != 0u ? Fr.Y : 1.0f - Fr.Y) * (Dz != 0u ? Fr.Z : 1.0f - Fr.Z);
        const uint32_t Index = Offset + (I0z + Dz) * N * N + (I0y + Dy) * N + (I0x + Dx);
        Accum += Weight * FieldSamples[Index];
    }
    return Gap > 0.0f ? std::max(Gap, Accum - Gap) : Accum;
}

struct ClipMinimumParams
{
    float3   Origin;
    float    Cell;
    uint32_t Dim;
    uint32_t DirtyLo[3], DirtyHi[3];   // inclusive
    uint32_t InstanceCount;
};

// ClipMinimumMain for one thread: writes only when the cell lies inside the dirty box. Returns true when the cell was written.
inline bool ClipMinimumCell(const ClipMinimumParams& P, const std::vector<InstanceGpu>& Instances, const std::vector<float>& FieldSamples,
                          const uint32_t Id[3], std::vector<float>& ClipVolume) noexcept
{
    uint32_t Cell[3];
    for (int A = 0; A < 3; ++A)
    {
        Cell[A] = P.DirtyLo[A] + Id[A];
        if (Cell[A] > P.DirtyHi[A]) return false;
    }
    const float3 Pos = P.Origin + F3(float(Cell[0]) + 0.5f, float(Cell[1]) + 0.5f, float(Cell[2]) + 0.5f) * P.Cell;
    float Best = 1e30f;
    for (uint32_t K = 0u; K < P.InstanceCount; ++K)
    {
        const InstanceGpu& Inst = Instances[K];
        const float3 Local = F3(
            Inst.InverseRow0[0] * Pos.X + Inst.InverseRow0[1] * Pos.Y + Inst.InverseRow0[2] * Pos.Z + Inst.InverseRow0[3],
            Inst.InverseRow1[0] * Pos.X + Inst.InverseRow1[1] * Pos.Y + Inst.InverseRow1[2] * Pos.Z + Inst.InverseRow1[3],
            Inst.InverseRow2[0] * Pos.X + Inst.InverseRow2[1] * Pos.Y + Inst.InverseRow2[2] * Pos.Z + Inst.InverseRow2[3]);
        const float D = SampleField(FieldSamples, Inst.FieldOffset, uint32_t(Inst.FieldMax[3]),
                                    F3(Inst.FieldMin[0], Inst.FieldMin[1], Inst.FieldMin[2]),
                                    F3(Inst.FieldMax[0], Inst.FieldMax[1], Inst.FieldMax[2]), Local) * Inst.FieldMin[3];
        Best = std::min(Best, D);
    }
    const uint32_t Index = (Cell[2] * P.Dim + Cell[1]) * P.Dim + Cell[0];
    ClipVolume[Index] = Best;
    return true;
}

// Dispatch over the dirty box, the way the shader's thread groups do.
inline uint64_t ClipMinimumDirty(const ClipMinimumParams& P, const std::vector<InstanceGpu>& Instances, const std::vector<float>& FieldSamples,
                               std::vector<float>& ClipVolume) noexcept
{
    uint64_t Written = 0u;
    uint32_t Extent[3];
    for (int A = 0; A < 3; ++A) Extent[A] = P.DirtyHi[A] - P.DirtyLo[A] + 1u;
    for (uint32_t Z = 0u; Z < Extent[2]; ++Z)
        for (uint32_t Y = 0u; Y < Extent[1]; ++Y)
            for (uint32_t X = 0u; X < Extent[0]; ++X)
            {
                const uint32_t Id[3] = { X, Y, Z };
                Written += ClipMinimumCell(P, Instances, FieldSamples, Id, ClipVolume) ? 1u : 0u;
            }
    return Written;
}
} // namespace TriangleFieldDeviceMirror
