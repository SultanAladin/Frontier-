//============================================================================================================================================
//                                                       DISPLAYMESHPROJECTION.CPP
//============================================================================================================================================
// 🧩 Orbit camera + z-buffered flat triangles over a DisplaySheetStructure. Back faces are kept (the vehicle shell
//    is single-sided in places); the depth test sorts them out.

#include "DisplayMeshProjection.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace Frontier {

namespace {

struct V3 { float x, y, z; };
[[nodiscard]] V3 Sub(V3 a, V3 b) noexcept { return { a.x - b.x, a.y - b.y, a.z - b.z }; }
[[nodiscard]] V3 Cross(V3 a, V3 b) noexcept { return { a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x }; }
[[nodiscard]] float Dot(V3 a, V3 b) noexcept { return a.x * b.x + a.y * b.y + a.z * b.z; }
[[nodiscard]] V3 Normalise(V3 a) noexcept { const float L = std::sqrt(std::max(1.0e-12f, Dot(a, a))); return { a.x / L, a.y / L, a.z / L }; }
[[nodiscard]] float SrgbToLinear(uint8_t C) noexcept { const float F = C / 255.0f; return F <= 0.04045f ? F / 12.92f : std::pow((F + 0.055f) / 1.055f, 2.4f); }
[[nodiscard]] uint8_t LinearToSrgb(float F) noexcept { F = std::clamp(F, 0.0f, 1.0f); const float S = F <= 0.0031308f ? F * 12.92f : 1.055f * std::pow(F, 1.0f / 2.4f); return static_cast<uint8_t>(std::lround(S * 255.0f)); }

} // namespace

void DisplayMeshProjection::AssignMesh(const float* P, uint32_t VertexCount, const uint32_t* I, uint32_t TriangleCount,
                                       const uint32_t* F, const DisplayMeshFamily* Fam, uint32_t FamilyCount) noexcept
{
    Positions.assign(P, P + static_cast<size_t>(VertexCount) * 3u);
    Indices.assign(I, I + static_cast<size_t>(TriangleCount) * 3u);
    Family.assign(F, F + TriangleCount);
    Families.assign(Fam, Fam + FamilyCount);
    float Minimum[3] = { 1e30f, 1e30f, 1e30f }, Maximum[3] = { -1e30f, -1e30f, -1e30f };
    for (uint32_t V = 0u; V < VertexCount; ++V)
        for (int A = 0; A < 3; ++A) { Minimum[A] = std::min(Minimum[A], P[V * 3u + A]); Maximum[A] = std::max(Maximum[A], P[V * 3u + A]); }
    for (int A = 0; A < 3; ++A) Centre[A] = 0.5f * (Minimum[A] + Maximum[A]);
    Radius = 0.5f * std::sqrt((Maximum[0] - Minimum[0]) * (Maximum[0] - Minimum[0]) + (Maximum[1] - Minimum[1]) * (Maximum[1] - Minimum[1]) + (Maximum[2] - Minimum[2]) * (Maximum[2] - Minimum[2]));
    FloorZ = Minimum[2];
}

void DisplayMeshProjection::Raster(DisplaySheetStructure& Sheet, const DisplayMeshView& View) noexcept
{
    const uint32_t W = Sheet.QueryWidth(), H = Sheet.QueryHeight();
    if (!W || !H) return;
    Sheet.Clear(View.Background);
    Depth.assign(static_cast<size_t>(W) * H, 1e30f);
    uint8_t* Texels = Sheet.AccessTexels();

    // Camera: orbit about the centre, Z up.
    const float Distance = View.Distance > 0.0f ? View.Distance : Radius / std::tan(View.FieldOfView * 0.5f) * 1.05f;
    const float CY = std::cos(View.Yaw), SY = std::sin(View.Yaw), CP = std::cos(View.Pitch), SP = std::sin(View.Pitch);
    const V3 Eye = View.UseEye ? V3{ View.Eye[0], View.Eye[1], View.Eye[2] }
                               : V3{ Centre[0] + Distance * CP * CY, Centre[1] + Distance * CP * SY, Centre[2] + Distance * SP };
    const V3 Target = View.UseEye ? V3{ View.Target[0], View.Target[1], View.Target[2] } : V3{ Centre[0], Centre[1], Centre[2] };
    const V3 Forward = Normalise(Sub(Target, Eye));
    const V3 Right = Normalise(Cross(Forward, { 0.0f, 0.0f, 1.0f }));
    const V3 Up = Cross(Right, Forward);
    const float Focal = (H * 0.5f) / std::tan(View.FieldOfView * 0.5f);
    const V3 Light = Normalise({ View.LightDirection[0], View.LightDirection[1], View.LightDirection[2] });

    auto Project = [&](V3 P, float& X, float& Y, float& Z)
    {
        const V3 D = Sub(P, Eye);
        Z = Dot(D, Forward);
        if (Z < 1.0e-3f) return false;
        X = W * 0.5f + Dot(D, Right) / Z * Focal;
        Y = H * 0.5f - Dot(D, Up) / Z * Focal;
        return true;
    };

    auto Fill = [&](float X0, float Y0, float Z0, float X1, float Y1, float Z1, float X2, float Y2, float Z2, const float Rgb[3])
    {
        const int MinX = std::max(0, static_cast<int>(std::floor(std::min({ X0, X1, X2 }))));
        const int MaxX = std::min(static_cast<int>(W) - 1, static_cast<int>(std::ceil(std::max({ X0, X1, X2 }))));
        const int MinY = std::max(0, static_cast<int>(std::floor(std::min({ Y0, Y1, Y2 }))));
        const int MaxY = std::min(static_cast<int>(H) - 1, static_cast<int>(std::ceil(std::max({ Y0, Y1, Y2 }))));
        const float Area = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
        if (std::fabs(Area) < 1.0e-6f) return;
        const float InverseArea = 1.0f / Area;
        const uint8_t R8 = LinearToSrgb(Rgb[0]), G8 = LinearToSrgb(Rgb[1]), B8 = LinearToSrgb(Rgb[2]);
        for (int Y = MinY; Y <= MaxY; ++Y)
            for (int X = MinX; X <= MaxX; ++X)
            {
                const float PX = X + 0.5f, PY = Y + 0.5f;
                float W0 = ((X1 - PX) * (Y2 - PY) - (X2 - PX) * (Y1 - PY)) * InverseArea;
                float W1 = ((X2 - PX) * (Y0 - PY) - (X0 - PX) * (Y2 - PY)) * InverseArea;
                float W2 = 1.0f - W0 - W1;
                if (W0 < 0.0f || W1 < 0.0f || W2 < 0.0f) continue;
                const float Z = 1.0f / (W0 / Z0 + W1 / Z1 + W2 / Z2);
                float& D = Depth[static_cast<size_t>(Y) * W + X];
                if (Z >= D) continue;
                D = Z;
                uint8_t* T = Texels + (static_cast<size_t>(Y) * W + X) * 4u;
                T[0] = R8; T[1] = G8; T[2] = B8; T[3] = 255u;
            }
    };

    // Floor disc: a soft contact shadow, drawn first so the depth test keeps the car above it.
    if (View.DrawFloorDisc)
    {
        const int Segments = 48;
        const float FloorRgb[3] = { SrgbToLinear(View.Floor.Red), SrgbToLinear(View.Floor.Green), SrgbToLinear(View.Floor.Blue) };
        float CX, CY2, CZ;
        if (Project({ Centre[0], Centre[1], FloorZ }, CX, CY2, CZ))
            for (int S = 0; S < Segments; ++S)
            {
                const float A0 = 6.2831853f * S / Segments, A1 = 6.2831853f * (S + 1) / Segments;
                float X0, Y0, Z0, X1, Y1, Z1;
                if (!Project({ Centre[0] + Radius * 0.95f * std::cos(A0), Centre[1] + Radius * 0.95f * std::sin(A0), FloorZ }, X0, Y0, Z0)) continue;
                if (!Project({ Centre[0] + Radius * 0.95f * std::cos(A1), Centre[1] + Radius * 0.95f * std::sin(A1), FloorZ }, X1, Y1, Z1)) continue;
                Fill(CX, CY2, CZ + 0.002f, X0, Y0, Z0 + 0.002f, X1, Y1, Z1 + 0.002f, FloorRgb);
            }
    }

    const uint32_t TriangleCount = QueryTriangleCount();
    for (uint32_t T = 0u; T < TriangleCount; ++T)
    {
        const uint32_t I0 = Indices[T * 3u], I1 = Indices[T * 3u + 1u], I2 = Indices[T * 3u + 2u];
        const V3 A = { Positions[I0 * 3u], Positions[I0 * 3u + 1u], Positions[I0 * 3u + 2u] };
        const V3 B = { Positions[I1 * 3u], Positions[I1 * 3u + 1u], Positions[I1 * 3u + 2u] };
        const V3 C = { Positions[I2 * 3u], Positions[I2 * 3u + 1u], Positions[I2 * 3u + 2u] };
        if (View.Cutaway && std::min({ A.z, B.z, C.z }) > View.CutawayAboveZ) continue;
        V3 N = Normalise(Cross(Sub(B, A), Sub(C, A)));
        const V3 ToEye = Normalise(Sub(Eye, A));
        if (Dot(N, ToEye) < 0.0f) N = { -N.x, -N.y, -N.z };   // two-sided shading
        const DisplayMeshFamily& Fam = Families[std::min<uint32_t>(Family[T], static_cast<uint32_t>(Families.size()) - 1u)];
        const float Base[3] = { SrgbToLinear(Fam.Colour.Red), SrgbToLinear(Fam.Colour.Green), SrgbToLinear(Fam.Colour.Blue) };
        float Rgb[3];
        if (Fam.Emissive) { Rgb[0] = Base[0]; Rgb[1] = Base[1]; Rgb[2] = Base[2]; }
        else
        {
            const float Lambert = std::max(0.0f, Dot(N, Light));
            const V3 Half = Normalise({ Light.x + ToEye.x, Light.y + ToEye.y, Light.z + ToEye.z });
            const float Highlight = std::pow(std::max(0.0f, Dot(N, Half)), 48.0f) * Fam.Gloss;
            const float Rim = std::pow(1.0f - std::max(0.0f, Dot(N, ToEye)), 3.0f) * 0.25f;
            const float Shade = 0.18f + 0.82f * Lambert;
            for (int K = 0; K < 3; ++K) Rgb[K] = Base[K] * Shade + Highlight + Rim * 0.6f;
        }
        float X0, Y0, Z0, X1, Y1, Z1, X2, Y2, Z2;
        if (!Project(A, X0, Y0, Z0) || !Project(B, X1, Y1, Z1) || !Project(C, X2, Y2, Z2)) continue;
        Fill(X0, Y0, Z0, X1, Y1, Z1, X2, Y2, Z2, Rgb);
    }
    Sheet.Commit();
}

} // namespace Frontier
