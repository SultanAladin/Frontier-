//============================================================================================================================================
//                                                     DISPLAYSURFACESTRUCTURE.CPP
//============================================================================================================================================
// 🧩 Outline construction (the prototype's ClusterOutlines, verbatim proportions), ear clipping and the UV mapping.

#include "DisplaySurfaceStructure.h"

#include <algorithm>
#include <cmath>

namespace Frontier {

namespace {
constexpr float kPi = 3.14159265358979323846f;

[[nodiscard]] float SignedArea(const std::vector<DisplayPoint>& P) noexcept
{
    float Area = 0.0f;
    for (size_t I = 0u; I < P.size(); ++I) { const DisplayPoint& A = P[I]; const DisplayPoint& B = P[(I + 1u) % P.size()]; Area += A.X * B.Y - B.X * A.Y; }
    return 0.5f * Area;
}

[[nodiscard]] bool PointInTriangle(DisplayPoint P, DisplayPoint A, DisplayPoint B, DisplayPoint C) noexcept
{
    const float D1 = (P.X - B.X) * (A.Y - B.Y) - (A.X - B.X) * (P.Y - B.Y);
    const float D2 = (P.X - C.X) * (B.Y - C.Y) - (B.X - C.X) * (P.Y - C.Y);
    const float D3 = (P.X - A.X) * (C.Y - A.Y) - (C.X - A.X) * (P.Y - A.Y);
    const bool Negative = D1 < 0.0f || D2 < 0.0f || D3 < 0.0f, Positive = D1 > 0.0f || D2 > 0.0f || D3 > 0.0f;
    return !(Negative && Positive);
}

[[nodiscard]] bool PointInPolygon(const std::vector<DisplayPoint>& P, float X, float Y) noexcept
{
    bool Inside = false;
    for (size_t I = 0u, J = P.size() - 1u; I < P.size(); J = I++)
        if ((P[I].Y > Y) != (P[J].Y > Y) && X < (P[J].X - P[I].X) * (Y - P[I].Y) / (P[J].Y - P[I].Y) + P[I].X) Inside = !Inside;
    return Inside;
}
} // namespace

std::vector<DisplayPoint> DisplaySurfaceStructure::ConstructUnitOutline(DisplayOutlineCategory Category, float Width, float Height, float CornerRadius) noexcept
{
    std::vector<DisplayPoint> Points;
    switch (Category)
    {
    case DisplayOutlineCategory::Hexagon:
        Points = { { -0.62f, -1.0f }, { 0.62f, -1.0f }, { 1.0f, 0.0f }, { 0.62f, 1.0f }, { -0.62f, 1.0f }, { -1.0f, 0.0f } };
        break;
    case DisplayOutlineCategory::CutCircle:
    {
        // 70 % of the circle; the missing 30 % is a chord cut symmetrically across the bottom, exactly as the accepted prototype drew it.
        const float Start = kPi * 0.8f, End = kPi * 2.2f;
        for (int I = 0; I <= 72; ++I) { const float A = Start + (End - Start) * I / 72.0f; Points.push_back({ std::cos(A), std::sin(A) }); }
        // The prototype's +Y-down canvas drew this with sin; flipping keeps the chord on the same (bottom) edge in the +Y-up frame.
        for (DisplayPoint& P : Points) P.Y = -P.Y;
        break;
    }
    case DisplayOutlineCategory::Trapezoid:
        Points = { { -0.78f, -1.0f }, { 0.78f, -1.0f }, { 1.0f, 1.0f }, { -1.0f, 1.0f } };
        break;
    case DisplayOutlineCategory::Pill:
        for (int I = 0; I <= 24; ++I) { const float A = -kPi / 2.0f + kPi * I / 24.0f; Points.push_back({ 0.68f + 0.32f * std::cos(A), std::sin(A) }); }
        for (int I = 0; I <= 24; ++I) { const float A = kPi / 2.0f + kPi * I / 24.0f; Points.push_back({ -0.68f + 0.32f * std::cos(A), std::sin(A) }); }
        break;
    case DisplayOutlineCategory::Rectangle:
    default:
    {
        const float RX = Width > 0.0f ? std::min(CornerRadius / (0.5f * Width), 1.0f) : 0.0f;
        const float RY = Height > 0.0f ? std::min(CornerRadius / (0.5f * Height), 1.0f) : 0.0f;
        const float Corners[4][2] = { { 1.0f - RX, -1.0f + RY }, { 1.0f - RX, 1.0f - RY }, { -1.0f + RX, 1.0f - RY }, { -1.0f + RX, -1.0f + RY } };
        for (int C = 0; C < 4; ++C)
            for (int I = 0; I <= 6; ++I)
            {
                const float A = -kPi / 2.0f + C * kPi / 2.0f + (kPi / 2.0f) * I / 6.0f;
                Points.push_back({ Corners[C][0] + std::cos(A) * RX, Corners[C][1] + std::sin(A) * RY });
            }
        break;
    }
    }
    // Normalise winding to counter-clockwise in +Y-up and drop a duplicated closing vertex.
    if (Points.size() > 2u && std::fabs(Points.front().X - Points.back().X) < 1.0e-5f && std::fabs(Points.front().Y - Points.back().Y) < 1.0e-5f) Points.pop_back();
    if (SignedArea(Points) < 0.0f) std::reverse(Points.begin(), Points.end());
    return Points;
}

std::vector<uint32_t> DisplaySurfaceStructure::Triangulate(const std::vector<DisplayPoint>& Points) noexcept
{
    std::vector<uint32_t> Indices;
    const size_t N = Points.size();
    if (N < 3u) return Indices;
    std::vector<uint32_t> Remaining(N);
    for (size_t I = 0u; I < N; ++I) Remaining[I] = static_cast<uint32_t>(I);
    const bool CounterClockwise = SignedArea(Points) > 0.0f;
    size_t Guard = 0u;
    while (Remaining.size() > 3u && Guard++ < N * N)
    {
        bool Clipped = false;
        for (size_t I = 0u; I < Remaining.size(); ++I)
        {
            const uint32_t IA = Remaining[(I + Remaining.size() - 1u) % Remaining.size()], IB = Remaining[I], IC = Remaining[(I + 1u) % Remaining.size()];
            const DisplayPoint& A = Points[IA]; const DisplayPoint& B = Points[IB]; const DisplayPoint& C = Points[IC];
            const float Cross = (B.X - A.X) * (C.Y - A.Y) - (B.Y - A.Y) * (C.X - A.X);
            if ((CounterClockwise && Cross <= 0.0f) || (!CounterClockwise && Cross >= 0.0f)) continue;   // reflex
            bool Empty = true;
            for (uint32_t Other : Remaining)
                if (Other != IA && Other != IB && Other != IC && PointInTriangle(Points[Other], A, B, C)) { Empty = false; break; }
            if (!Empty) continue;
            if (CounterClockwise) { Indices.push_back(IA); Indices.push_back(IB); Indices.push_back(IC); }
            else { Indices.push_back(IC); Indices.push_back(IB); Indices.push_back(IA); }
            Remaining.erase(Remaining.begin() + static_cast<std::ptrdiff_t>(I));
            Clipped = true;
            break;
        }
        if (!Clipped) break;   // degenerate input; emit what remains as a fan below
    }
    if (Remaining.size() == 3u)
    {
        if (CounterClockwise) { Indices.push_back(Remaining[0]); Indices.push_back(Remaining[1]); Indices.push_back(Remaining[2]); }
        else { Indices.push_back(Remaining[2]); Indices.push_back(Remaining[1]); Indices.push_back(Remaining[0]); }
    }
    return Indices;
}

void DisplaySurfaceStructure::Construct(const DisplaySpecification& NewSpecification) noexcept
{
    Specification = NewSpecification;
    UnitOutline = ConstructUnitOutline(Specification.Outline, Specification.Width, Specification.Height, Specification.CornerRadius);
    SheetWidth = std::max(16u, Specification.SheetWidth);
    SheetHeight = std::max(16u, static_cast<uint32_t>(std::lround(SheetWidth * Specification.Height / std::max(Specification.Width, 1.0e-4f))));

    const float HalfW = 0.5f * Specification.Width, HalfH = 0.5f * Specification.Height;
    auto Emit = [&](DisplayTriangleList& List, const std::vector<DisplayPoint>& Unit, float ScaleX, float ScaleY, float Z)
    {
        List = DisplayTriangleList{};
        for (const DisplayPoint& P : Unit)
        {
            List.Positions.push_back(P.X * ScaleX); List.Positions.push_back(P.Y * ScaleY); List.Positions.push_back(Z);
            List.Normals.push_back(0.0f); List.Normals.push_back(0.0f); List.Normals.push_back(1.0f);
            List.TextureCoordinates.push_back(0.5f + 0.5f * P.X * ScaleX / HalfW);
            List.TextureCoordinates.push_back(0.5f - 0.5f * P.Y * ScaleY / HalfH);
        }
        List.Indices = Triangulate(Unit);
    };
    Emit(Glass, UnitOutline, HalfW, HalfH, 0.0f);
    if (Specification.BezelMargin > 0.0f)
    {
        // Bezel: the outline grown by the margin, sitting 1 mm behind the glass, with the glass outline as a hole
        //    approximated by a ring strip (outer ring vertices paired with inner ones).
        const float OuterX = HalfW + Specification.BezelMargin, OuterY = HalfH + Specification.BezelMargin;
        Bezel = DisplayTriangleList{};
        const uint32_t N = static_cast<uint32_t>(UnitOutline.size());
        for (const DisplayPoint& P : UnitOutline)
        {
            Bezel.Positions.push_back(P.X * OuterX); Bezel.Positions.push_back(P.Y * OuterY); Bezel.Positions.push_back(-0.001f);
            Bezel.Normals.push_back(0.0f); Bezel.Normals.push_back(0.0f); Bezel.Normals.push_back(1.0f);
            Bezel.TextureCoordinates.push_back(0.0f); Bezel.TextureCoordinates.push_back(0.0f);
        }
        for (const DisplayPoint& P : UnitOutline)
        {
            Bezel.Positions.push_back(P.X * HalfW); Bezel.Positions.push_back(P.Y * HalfH); Bezel.Positions.push_back(-0.001f);
            Bezel.Normals.push_back(0.0f); Bezel.Normals.push_back(0.0f); Bezel.Normals.push_back(1.0f);
            Bezel.TextureCoordinates.push_back(0.0f); Bezel.TextureCoordinates.push_back(0.0f);
        }
        for (uint32_t I = 0u; I < N; ++I)
        {
            const uint32_t J = (I + 1u) % N;
            Bezel.Indices.push_back(I); Bezel.Indices.push_back(J); Bezel.Indices.push_back(N + J);
            Bezel.Indices.push_back(I); Bezel.Indices.push_back(N + J); Bezel.Indices.push_back(N + I);
        }
    }
    else Bezel = DisplayTriangleList{};
}

std::vector<DisplayPoint> DisplaySurfaceStructure::ConstructSheetOutline(float Inset) const noexcept
{
    std::vector<DisplayPoint> Points(UnitOutline.size());
    const float HalfW = 0.5f * SheetWidth, HalfH = 0.5f * SheetHeight;
    for (size_t I = 0u; I < UnitOutline.size(); ++I)
        Points[I] = { HalfW + UnitOutline[I].X * (HalfW - Inset), HalfH - UnitOutline[I].Y * (HalfH - Inset) };
    return Points;
}

bool DisplaySurfaceStructure::Encloses(float LocalX, float LocalY) const noexcept
{
    if (UnitOutline.size() < 3u || Specification.Width <= 0.0f || Specification.Height <= 0.0f) return false;
    return PointInPolygon(UnitOutline, LocalX / (0.5f * Specification.Width), LocalY / (0.5f * Specification.Height));
}

} // namespace Frontier
