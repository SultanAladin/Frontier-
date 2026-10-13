//============================================================================================================================================
//                                                     DISPLAYRASTERPROJECTION.CPP
//============================================================================================================================================
// 🧩 Scanline polygon coverage (non-zero winding, 4 sub-scanlines, exact horizontal span fractions), signed-distance
//    rounded rectangles / circles / arcs / capsules, a max-combined capsule union for polylines, bilinear sprite
//    blits, TrueType glyph compositing and the SVG path-data decoder the icon depot relies on.

#include "DisplayRasterProjection.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace Frontier {

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr uint32_t kSubScanlines = 4u;

[[nodiscard]] float Clamp01(float V) noexcept { return V < 0.0f ? 0.0f : V > 1.0f ? 1.0f : V; }

[[nodiscard]] uint8_t Lerp8(uint8_t A, uint8_t B, float T) noexcept
{
    return static_cast<uint8_t>(std::lround(A + (B - A) * T));
}

[[nodiscard]] float RoundedRectangleDistance(float PX, float PY, float CX, float CY, float HalfW, float HalfH, float Radius) noexcept
{
    const float R = std::min(Radius, std::min(HalfW, HalfH));
    const float QX = std::fabs(PX - CX) - (HalfW - R);
    const float QY = std::fabs(PY - CY) - (HalfH - R);
    const float Outside = std::sqrt(std::max(QX, 0.0f) * std::max(QX, 0.0f) + std::max(QY, 0.0f) * std::max(QY, 0.0f));
    return Outside + std::min(std::max(QX, QY), 0.0f) - R;
}

[[nodiscard]] float SegmentDistance(float PX, float PY, float AX, float AY, float BX, float BY) noexcept
{
    const float DX = BX - AX, DY = BY - AY;
    const float LengthSquared = DX * DX + DY * DY;
    float T = LengthSquared > 0.0f ? ((PX - AX) * DX + (PY - AY) * DY) / LengthSquared : 0.0f;
    T = Clamp01(T);
    const float EX = AX + DX * T - PX, EY = AY + DY * T - PY;
    return std::sqrt(EX * EX + EY * EY);
}

struct Edge { float X0, Y0, X1, Y1; int Winding; };

} // namespace

//------------------------------------------------------------------------------------------------------------------------ paint

DisplayPaint DisplayPaint::Linear(float X0, float Y0, float X1, float Y1, DisplayColour A, DisplayColour B) noexcept
{
    DisplayPaint P; P.Category = DisplayPaintCategory::Linear; P.Start = A; P.End = B; P.X0 = X0; P.Y0 = Y0; P.X1 = X1; P.Y1 = Y1; return P;
}

DisplayPaint DisplayPaint::Radial(float CentreX, float CentreY, float InnerRadius, float OuterRadius, DisplayColour A, DisplayColour B) noexcept
{
    DisplayPaint P; P.Category = DisplayPaintCategory::Radial; P.Start = A; P.End = B; P.X0 = CentreX; P.Y0 = CentreY; P.R0 = InnerRadius; P.R1 = OuterRadius; return P;
}

DisplayColour DisplayRasterProjection::Sample(const DisplayPaint& Paint, float PixelX, float PixelY) const noexcept
{
    if (Paint.Category == DisplayPaintCategory::Solid) return Paint.Start;
    // Back to design space for the gradient parameters.
    const float X = PixelX / Scale - OffsetX, Y = PixelY / Scale - OffsetY;
    float T = 0.0f;
    if (Paint.Category == DisplayPaintCategory::Linear)
    {
        const float DX = Paint.X1 - Paint.X0, DY = Paint.Y1 - Paint.Y0;
        const float L = DX * DX + DY * DY;
        T = L > 0.0f ? ((X - Paint.X0) * DX + (Y - Paint.Y0) * DY) / L : 0.0f;
    }
    else
    {
        const float D = std::sqrt((X - Paint.X0) * (X - Paint.X0) + (Y - Paint.Y0) * (Y - Paint.Y0));
        T = Paint.R1 > Paint.R0 ? (D - Paint.R0) / (Paint.R1 - Paint.R0) : 1.0f;
    }
    T = Clamp01(T);
    return DisplayColour{ Lerp8(Paint.Start.Red, Paint.End.Red, T), Lerp8(Paint.Start.Green, Paint.End.Green, T),
                          Lerp8(Paint.Start.Blue, Paint.End.Blue, T), Lerp8(Paint.Start.Alpha, Paint.End.Alpha, T) };
}

//------------------------------------------------------------------------------------------------------------------------ blend, clip

void DisplayRasterProjection::Begin(DisplaySheetStructure& Sheet, float NewScale, float NewOffsetX, float NewOffsetY,
                                    TypefaceSheetCodec* LightFace, TypefaceSheetCodec* RegularFace, TypefaceSheetCodec* MediumFace) noexcept
{
    Target = &Sheet; Scale = NewScale; OffsetX = NewOffsetX; OffsetY = NewOffsetY;
    Faces[0] = LightFace; Faces[1] = RegularFace; Faces[2] = MediumFace;
    Clips.clear();
}

float DisplayRasterProjection::ClipCoverage(float PixelX, float PixelY) const noexcept
{
    float Coverage = 1.0f;
    for (const ClipRecord& C : Clips)
    {
        const float D = RoundedRectangleDistance(PixelX, PixelY, 0.5f * (C.Left + C.Right), 0.5f * (C.Top + C.Bottom),
                                                 0.5f * (C.Right - C.Left), 0.5f * (C.Bottom - C.Top), C.Radius);
        Coverage *= Clamp01(0.5f - D);
        if (Coverage <= 0.0f) return 0.0f;
    }
    return Coverage;
}

void DisplayRasterProjection::Blend(uint32_t X, uint32_t Y, DisplayColour Colour, float Coverage) noexcept
{
    if (!Target || X >= Target->QueryWidth() || Y >= Target->QueryHeight()) return;
    float Alpha = Coverage * (Colour.Alpha / 255.0f);
    if (!Clips.empty()) Alpha *= ClipCoverage(X + 0.5f, Y + 0.5f);
    if (ShapeMask && ShapeMask->size() == static_cast<size_t>(Target->QueryWidth()) * Target->QueryHeight())
        Alpha *= (*ShapeMask)[static_cast<size_t>(Y) * Target->QueryWidth() + X] / 255.0f;
    if (Alpha <= 0.0f) return;
    if (Alpha > 1.0f) Alpha = 1.0f;
    uint8_t* T = Target->AccessTexels() + (static_cast<size_t>(Y) * Target->QueryWidth() + X) * 4u;
    const float DestinationAlpha = T[3] / 255.0f;
    const float OutAlpha = Alpha + DestinationAlpha * (1.0f - Alpha);
    if (OutAlpha <= 0.0f) { T[0] = T[1] = T[2] = T[3] = 0u; return; }
    const uint8_t Source[3] = { Colour.Red, Colour.Green, Colour.Blue };
    for (int C = 0; C < 3; ++C)
    {
        const float Value = (Source[C] * Alpha + T[C] * DestinationAlpha * (1.0f - Alpha)) / OutAlpha;
        T[C] = static_cast<uint8_t>(std::lround(std::min(255.0f, std::max(0.0f, Value))));
    }
    T[3] = static_cast<uint8_t>(std::lround(OutAlpha * 255.0f));
}

void DisplayRasterProjection::PushClip(float Left, float Top, float Width, float Height, float Radius) noexcept
{
    Clips.push_back(ClipRecord{ (Left + OffsetX) * Scale, (Top + OffsetY) * Scale,
                                (Left + Width + OffsetX) * Scale, (Top + Height + OffsetY) * Scale, Radius * Scale });
}

void DisplayRasterProjection::PopClip() noexcept { if (!Clips.empty()) Clips.pop_back(); }

//------------------------------------------------------------------------------------------------------------------------ fills

void DisplayRasterProjection::FillRectangle(float Left, float Top, float Width, float Height, float Radius, const DisplayPaint& Paint) noexcept
{
    if (!Target || Width <= 0.0f || Height <= 0.0f) return;
    const float L = (Left + OffsetX) * Scale, T = (Top + OffsetY) * Scale, W = Width * Scale, H = Height * Scale, R = Radius * Scale;
    const int X0 = std::max(0, static_cast<int>(std::floor(L)) - 1), Y0 = std::max(0, static_cast<int>(std::floor(T)) - 1);
    const int X1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(L + W)) + 1);
    const int Y1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(T + H)) + 1);
    const float CX = L + 0.5f * W, CY = T + 0.5f * H;
    for (int Y = Y0; Y <= Y1; ++Y)
        for (int X = X0; X <= X1; ++X)
        {
            const float PX = X + 0.5f, PY = Y + 0.5f;
            float Coverage;
            if (R <= 0.0f)
            {
                // Exact box coverage for sharp rectangles (fractional edges stay crisp at any scale).
                const float OX = std::min(PX + 0.5f, L + W) - std::max(PX - 0.5f, L);
                const float OY = std::min(PY + 0.5f, T + H) - std::max(PY - 0.5f, T);
                Coverage = std::max(0.0f, OX) * std::max(0.0f, OY);
            }
            else Coverage = Clamp01(0.5f - RoundedRectangleDistance(PX, PY, CX, CY, 0.5f * W, 0.5f * H, R));
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Sample(Paint, PX, PY), Coverage);
        }
}

void DisplayRasterProjection::StrokeRectangle(float Left, float Top, float Width, float Height, float Radius, float LineWidth, DisplayColour Colour) noexcept
{
    if (!Target || Width <= 0.0f || Height <= 0.0f) return;
    const float L = (Left + OffsetX) * Scale, T = (Top + OffsetY) * Scale, W = Width * Scale, H = Height * Scale, R = Radius * Scale;
    const float Half = 0.5f * std::max(LineWidth * Scale, 1.0f);
    const int X0 = std::max(0, static_cast<int>(std::floor(L - Half)) - 1), Y0 = std::max(0, static_cast<int>(std::floor(T - Half)) - 1);
    const int X1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(L + W + Half)) + 1);
    const int Y1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(T + H + Half)) + 1);
    const float CX = L + 0.5f * W, CY = T + 0.5f * H;
    for (int Y = Y0; Y <= Y1; ++Y)
        for (int X = X0; X <= X1; ++X)
        {
            const float PX = X + 0.5f, PY = Y + 0.5f;
            const float D = std::fabs(RoundedRectangleDistance(PX, PY, CX, CY, 0.5f * W, 0.5f * H, R));
            const float Coverage = Clamp01(Half - D + 0.5f);
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, Coverage);
        }
}

void DisplayRasterProjection::FillCircle(float CentreX, float CentreY, float Radius, const DisplayPaint& Paint) noexcept
{
    if (!Target || Radius <= 0.0f) return;
    const float CX = (CentreX + OffsetX) * Scale, CY = (CentreY + OffsetY) * Scale, R = Radius * Scale;
    const int X0 = std::max(0, static_cast<int>(std::floor(CX - R)) - 1), Y0 = std::max(0, static_cast<int>(std::floor(CY - R)) - 1);
    const int X1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(CX + R)) + 1);
    const int Y1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(CY + R)) + 1);
    for (int Y = Y0; Y <= Y1; ++Y)
        for (int X = X0; X <= X1; ++X)
        {
            const float PX = X + 0.5f, PY = Y + 0.5f;
            const float D = std::sqrt((PX - CX) * (PX - CX) + (PY - CY) * (PY - CY)) - R;
            const float Coverage = Clamp01(0.5f - D);
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Sample(Paint, PX, PY), Coverage);
        }
}

void DisplayRasterProjection::FillCoverage(const std::vector<std::vector<DisplayPoint>>& PixelContours, const DisplayPaint& Paint, std::vector<uint8_t>* MaskOut) noexcept
{
    if (!Target) return;
    std::vector<Edge> Edges;
    float MinX = 1.0e9f, MinY = 1.0e9f, MaxX = -1.0e9f, MaxY = -1.0e9f;
    for (const auto& Contour : PixelContours)
    {
        const size_t N = Contour.size();
        if (N < 3u) continue;
        for (size_t I = 0u; I < N; ++I)
        {
            const DisplayPoint& A = Contour[I];
            const DisplayPoint& B = Contour[(I + 1u) % N];
            MinX = std::min(MinX, A.X); MaxX = std::max(MaxX, A.X); MinY = std::min(MinY, A.Y); MaxY = std::max(MaxY, A.Y);
            if (A.Y == B.Y) continue;
            Edges.push_back(A.Y < B.Y ? Edge{ A.X, A.Y, B.X, B.Y, 1 } : Edge{ B.X, B.Y, A.X, A.Y, -1 });
        }
    }
    if (Edges.empty()) return;
    const int Width = static_cast<int>(Target->QueryWidth()), Height = static_cast<int>(Target->QueryHeight());
    const int Y0 = std::max(0, static_cast<int>(std::floor(MinY))), Y1 = std::min(Height - 1, static_cast<int>(std::ceil(MaxY)));
    const int X0 = std::max(0, static_cast<int>(std::floor(MinX))), X1 = std::min(Width - 1, static_cast<int>(std::ceil(MaxX)));
    if (Y1 < Y0 || X1 < X0) return;
    CoverageRow.assign(static_cast<size_t>(X1 - X0 + 2), 0.0f);
    struct Crossing { float X; int Winding; };
    std::vector<Crossing> Crossings;
    for (int Y = Y0; Y <= Y1; ++Y)
    {
        std::fill(CoverageRow.begin(), CoverageRow.end(), 0.0f);
        bool Touched = false;
        for (uint32_t S = 0u; S < kSubScanlines; ++S)
        {
            const float SampleY = Y + (S + 0.5f) / kSubScanlines;
            Crossings.clear();
            for (const Edge& E : Edges)
                if (SampleY >= E.Y0 && SampleY < E.Y1)
                    Crossings.push_back({ E.X0 + (E.X1 - E.X0) * (SampleY - E.Y0) / (E.Y1 - E.Y0), E.Winding });
            if (Crossings.size() < 2u) continue;
            std::sort(Crossings.begin(), Crossings.end(), [](const Crossing& A, const Crossing& B) { return A.X < B.X; });
            int Winding = 0;
            for (size_t I = 0u; I + 1u < Crossings.size(); ++I)
            {
                Winding += Crossings[I].Winding;
                if (Winding == 0) continue;
                float XA = std::max(Crossings[I].X, static_cast<float>(X0)), XB = std::min(Crossings[I + 1u].X, static_cast<float>(X1 + 1));
                if (XB <= XA) continue;
                Touched = true;
                const int IA = static_cast<int>(std::floor(XA)), IB = static_cast<int>(std::floor(XB));
                if (IA == IB) CoverageRow[IA - X0] += XB - XA;
                else
                {
                    CoverageRow[IA - X0] += (IA + 1) - XA;
                    for (int I2 = IA + 1; I2 < IB; ++I2) CoverageRow[I2 - X0] += 1.0f;
                    if (IB <= X1) CoverageRow[IB - X0] += XB - IB;
                }
            }
        }
        if (!Touched) continue;
        for (int X = X0; X <= X1; ++X)
        {
            const float Coverage = std::min(1.0f, CoverageRow[X - X0] / kSubScanlines);
            if (Coverage <= 0.0f) continue;
            if (MaskOut) (*MaskOut)[static_cast<size_t>(Y) * Width + X] = static_cast<uint8_t>(std::lround(Coverage * 255.0f));
            else Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Sample(Paint, X + 0.5f, Y + 0.5f), Coverage);
        }
    }
}

void DisplayRasterProjection::FillPolygon(const std::vector<std::vector<DisplayPoint>>& Contours, const DisplayPaint& Paint) noexcept
{
    std::vector<std::vector<DisplayPoint>> Pixels(Contours.size());
    for (size_t C = 0u; C < Contours.size(); ++C)
    {
        Pixels[C].reserve(Contours[C].size());
        for (const DisplayPoint& P : Contours[C]) Pixels[C].push_back({ (P.X + OffsetX) * Scale, (P.Y + OffsetY) * Scale });
    }
    FillCoverage(Pixels, Paint, nullptr);
}

void DisplayRasterProjection::FillPolygon(const DisplayPoint* Points, uint32_t Count, const DisplayPaint& Paint) noexcept
{
    std::vector<std::vector<DisplayPoint>> Contours(1);
    Contours[0].assign(Points, Points + Count);
    FillPolygon(Contours, Paint);
}

void DisplayRasterProjection::ConstructMask(const std::vector<std::vector<DisplayPoint>>& Contours, std::vector<uint8_t>& Mask) noexcept
{
    if (!Target) return;
    Mask.assign(static_cast<size_t>(Target->QueryWidth()) * Target->QueryHeight(), 0u);
    std::vector<std::vector<DisplayPoint>> Pixels(Contours.size());
    for (size_t C = 0u; C < Contours.size(); ++C)
        for (const DisplayPoint& P : Contours[C]) Pixels[C].push_back({ (P.X + OffsetX) * Scale, (P.Y + OffsetY) * Scale });
    FillCoverage(Pixels, DisplayPaint{}, &Mask);
}

//------------------------------------------------------------------------------------------------------------------------ strokes

void DisplayRasterProjection::StrokeCapsule(float X0, float Y0, float X1, float Y1, float HalfWidth, DisplayColour Colour) noexcept
{
    const int PX0 = std::max(0, static_cast<int>(std::floor(std::min(X0, X1) - HalfWidth)) - 1);
    const int PY0 = std::max(0, static_cast<int>(std::floor(std::min(Y0, Y1) - HalfWidth)) - 1);
    const int PX1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(std::max(X0, X1) + HalfWidth)) + 1);
    const int PY1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(std::max(Y0, Y1) + HalfWidth)) + 1);
    for (int Y = PY0; Y <= PY1; ++Y)
        for (int X = PX0; X <= PX1; ++X)
        {
            const float Coverage = Clamp01(HalfWidth - SegmentDistance(X + 0.5f, Y + 0.5f, X0, Y0, X1, Y1) + 0.5f);
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, Coverage);
        }
}

void DisplayRasterProjection::StrokeLine(float X0, float Y0, float X1, float Y1, float LineWidth, DisplayColour Colour) noexcept
{
    if (!Target) return;
    StrokeCapsule((X0 + OffsetX) * Scale, (Y0 + OffsetY) * Scale, (X1 + OffsetX) * Scale, (Y1 + OffsetY) * Scale,
                  0.5f * std::max(LineWidth * Scale, 0.75f), Colour);
}

void DisplayRasterProjection::StrokePolyline(const DisplayPoint* Points, uint32_t Count, float LineWidth, DisplayColour Colour, bool Closed) noexcept
{
    if (!Target || Count < 2u) return;
    // Union of capsules: coverage is max-combined in a scratch sheet so a translucent stroke does not double at joins.
    const float Half = 0.5f * std::max(LineWidth * Scale, 0.75f);
    const int Width = static_cast<int>(Target->QueryWidth()), Height = static_cast<int>(Target->QueryHeight());
    std::vector<DisplayPoint> Pixels(Count);
    float MinX = 1.0e9f, MinY = 1.0e9f, MaxX = -1.0e9f, MaxY = -1.0e9f;
    for (uint32_t I = 0u; I < Count; ++I)
    {
        Pixels[I] = { (Points[I].X + OffsetX) * Scale, (Points[I].Y + OffsetY) * Scale };
        MinX = std::min(MinX, Pixels[I].X); MaxX = std::max(MaxX, Pixels[I].X); MinY = std::min(MinY, Pixels[I].Y); MaxY = std::max(MaxY, Pixels[I].Y);
    }
    const int BX0 = std::max(0, static_cast<int>(std::floor(MinX - Half)) - 1), BY0 = std::max(0, static_cast<int>(std::floor(MinY - Half)) - 1);
    const int BX1 = std::min(Width - 1, static_cast<int>(std::ceil(MaxX + Half)) + 1), BY1 = std::min(Height - 1, static_cast<int>(std::ceil(MaxY + Half)) + 1);
    if (BX1 < BX0 || BY1 < BY0) return;
    const int BW = BX1 - BX0 + 1;
    std::vector<float> Union(static_cast<size_t>(BW) * (BY1 - BY0 + 1), 0.0f);
    const uint32_t SegmentCount = Closed ? Count : Count - 1u;
    for (uint32_t S = 0u; S < SegmentCount; ++S)
    {
        const DisplayPoint& A = Pixels[S];
        const DisplayPoint& B = Pixels[(S + 1u) % Count];
        const int PX0 = std::max(BX0, static_cast<int>(std::floor(std::min(A.X, B.X) - Half)) - 1);
        const int PY0 = std::max(BY0, static_cast<int>(std::floor(std::min(A.Y, B.Y) - Half)) - 1);
        const int PX1 = std::min(BX1, static_cast<int>(std::ceil(std::max(A.X, B.X) + Half)) + 1);
        const int PY1 = std::min(BY1, static_cast<int>(std::ceil(std::max(A.Y, B.Y) + Half)) + 1);
        for (int Y = PY0; Y <= PY1; ++Y)
            for (int X = PX0; X <= PX1; ++X)
            {
                const float Coverage = Clamp01(Half - SegmentDistance(X + 0.5f, Y + 0.5f, A.X, A.Y, B.X, B.Y) + 0.5f);
                float& Cell = Union[static_cast<size_t>(Y - BY0) * BW + (X - BX0)];
                if (Coverage > Cell) Cell = Coverage;
            }
    }
    for (int Y = BY0; Y <= BY1; ++Y)
        for (int X = BX0; X <= BX1; ++X)
        {
            const float Coverage = Union[static_cast<size_t>(Y - BY0) * BW + (X - BX0)];
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, Coverage);
        }
}

void DisplayRasterProjection::StrokeArc(float CentreX, float CentreY, float Radius, float StartAngle, float Sweep, float LineWidth, DisplayColour Colour) noexcept
{
    if (!Target || Radius <= 0.0f || Sweep == 0.0f) return;
    if (Sweep < 0.0f) { StartAngle += Sweep; Sweep = -Sweep; }
    const float CX = (CentreX + OffsetX) * Scale, CY = (CentreY + OffsetY) * Scale, R = Radius * Scale;
    const float Half = 0.5f * std::max(LineWidth * Scale, 0.75f);
    const float Reach = R + Half;
    const int X0 = std::max(0, static_cast<int>(std::floor(CX - Reach)) - 1), Y0 = std::max(0, static_cast<int>(std::floor(CY - Reach)) - 1);
    const int X1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(CX + Reach)) + 1);
    const int Y1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(CY + Reach)) + 1);
    const bool Full = Sweep >= 2.0f * kPi - 1.0e-4f;
    const float AX = CX + std::cos(StartAngle) * R, AY = CY + std::sin(StartAngle) * R;
    const float BX = CX + std::cos(StartAngle + Sweep) * R, BY = CY + std::sin(StartAngle + Sweep) * R;
    for (int Y = Y0; Y <= Y1; ++Y)
        for (int X = X0; X <= X1; ++X)
        {
            const float PX = X + 0.5f, PY = Y + 0.5f;
            const float DX = PX - CX, DY = PY - CY;
            const float Distance = std::sqrt(DX * DX + DY * DY);
            float D = std::fabs(Distance - R);
            if (!Full)
            {
                float Angle = std::atan2(DY, DX) - StartAngle;
                Angle = std::fmod(Angle, 2.0f * kPi); if (Angle < 0.0f) Angle += 2.0f * kPi;
                if (Angle > Sweep)
                {
                    const float DA = std::sqrt((PX - AX) * (PX - AX) + (PY - AY) * (PY - AY));
                    const float DB = std::sqrt((PX - BX) * (PX - BX) + (PY - BY) * (PY - BY));
                    D = std::min(DA, DB);
                }
            }
            const float Coverage = Clamp01(Half - D + 0.5f);
            if (Coverage > 0.0f) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, Coverage);
        }
}

void DisplayRasterProjection::StrokeCubic(float X0, float Y0, float C0X, float C0Y, float C1X, float C1Y, float X1, float Y1, float LineWidth, DisplayColour Colour) noexcept
{
    DisplayPoint Points[25];
    for (int I = 0; I <= 24; ++I)
    {
        const float T = I / 24.0f, U = 1.0f - T;
        Points[I] = { U * U * U * X0 + 3.0f * U * U * T * C0X + 3.0f * U * T * T * C1X + T * T * T * X1,
                      U * U * U * Y0 + 3.0f * U * U * T * C0Y + 3.0f * U * T * T * C1Y + T * T * T * Y1 };
    }
    StrokePolyline(Points, 25u, LineWidth, Colour, false);
}

//------------------------------------------------------------------------------------------------------------------------ text

TypefaceSheetCodec* DisplayRasterProjection::Face(DisplayTextWeight Weight) const noexcept
{
    TypefaceSheetCodec* Chosen = Faces[static_cast<uint32_t>(Weight)];
    if (!Chosen || !Chosen->Ready()) Chosen = Faces[1];
    if (!Chosen || !Chosen->Ready()) for (TypefaceSheetCodec* F : Faces) if (F && F->Ready()) return F;
    return Chosen && Chosen->Ready() ? Chosen : nullptr;
}

float DisplayRasterProjection::MeasureText(const char* Utf8, float Size, DisplayTextWeight Weight) noexcept
{
    TypefaceSheetCodec* F = Face(Weight);
    return F ? F->Measure(Utf8, Size * Scale) / Scale : 0.0f;
}

void DisplayRasterProjection::DrawGlyph(const GlyphSheet& Glyph, float PenX, float PenY, DisplayColour Colour) noexcept
{
    const int BaseX = static_cast<int>(std::lround(PenX)) + Glyph.OffsetX;
    const int BaseY = static_cast<int>(std::lround(PenY)) + Glyph.OffsetY;
    for (int J = 0; J < Glyph.Height; ++J)
    {
        const int Y = BaseY + J;
        if (Y < 0 || Y >= static_cast<int>(Target->QueryHeight())) continue;
        for (int I = 0; I < Glyph.Width; ++I)
        {
            const int X = BaseX + I;
            if (X < 0 || X >= static_cast<int>(Target->QueryWidth())) continue;
            const uint8_t Coverage = Glyph.Coverage[static_cast<size_t>(J) * Glyph.Width + I];
            if (Coverage) Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, Coverage / 255.0f);
        }
    }
}

float DisplayRasterProjection::Text(const char* Utf8, float X, float Y, float Size, DisplayColour Colour, DisplayTextAlignment Alignment, DisplayTextWeight Weight) noexcept
{
    if (!Target || !Utf8 || !*Utf8) return 0.0f;
    TypefaceSheetCodec* F = Face(Weight);
    if (!F) return 0.0f;
    const float PixelSize = Size * Scale;
    const float Width = F->Measure(Utf8, PixelSize);
    float PenX = (X + OffsetX) * Scale;
    const float PenY = (Y + OffsetY) * Scale;
    if (Alignment == DisplayTextAlignment::Centre) PenX -= 0.5f * Width;
    else if (Alignment == DisplayTextAlignment::Right) PenX -= Width;
    uint32_t Previous = 0u;
    const char* Cursor = Utf8;
    while (*Cursor)
    {
        const uint32_t Code = TypefaceSheetCodec::NextCodepoint(Cursor);
        const GlyphSheet* G = F->Glyph(Code, PixelSize);
        if (!G) continue;
        PenX += F->Kerning(Previous, Code, PixelSize);
        if (G->Width > 0) DrawGlyph(*G, PenX, PenY, Colour);
        PenX += G->Advance;
        Previous = Code;
    }
    return Width / Scale;
}

//------------------------------------------------------------------------------------------------------------------------ art and sprites

void DisplayRasterProjection::DrawVectorArt(const DisplayVectorArt& Art, float Left, float Top, float Extent) noexcept
{
    if (!Target || Art.ViewWidth <= 0.0f) return;
    const float Unit = Extent / Art.ViewWidth;   // design units per view-box unit
    for (const DisplayVectorShape& Shape : Art.Shapes)
    {
        if (Shape.Filled)
        {
            std::vector<std::vector<DisplayPoint>> Pixels(Shape.Contours.size());
            for (size_t C = 0u; C < Shape.Contours.size(); ++C)
                for (const DisplayPoint& P : Shape.Contours[C])
                    Pixels[C].push_back({ (Left + P.X * Unit + OffsetX) * Scale, (Top + P.Y * Unit + OffsetY) * Scale });
            FillCoverage(Pixels, DisplayPaint(Shape.Colour), nullptr);
        }
        else
        {
            for (const auto& Contour : Shape.Contours)
            {
                std::vector<DisplayPoint> Design(Contour.size());
                for (size_t I = 0u; I < Contour.size(); ++I) Design[I] = { Left + Contour[I].X * Unit, Top + Contour[I].Y * Unit };
                if (Design.size() == 1u) Design.push_back(Design[0]);   // a dot: zero-length capsule
                StrokePolyline(Design.data(), static_cast<uint32_t>(Design.size()), Shape.StrokeWidth * Unit, Shape.Colour, Shape.Closed);
            }
        }
    }
}

void DisplayRasterProjection::BlitSheet(const DisplaySheetStructure& Source, float Left, float Top, float Width, float Height, float Opacity) noexcept
{
    if (!Target || Source.Empty() || Width <= 0.0f || Height <= 0.0f) return;
    const float L = (Left + OffsetX) * Scale, T = (Top + OffsetY) * Scale, W = Width * Scale, H = Height * Scale;
    const int X0 = std::max(0, static_cast<int>(std::floor(L))), Y0 = std::max(0, static_cast<int>(std::floor(T)));
    const int X1 = std::min(static_cast<int>(Target->QueryWidth()) - 1, static_cast<int>(std::ceil(L + W)) - 1);
    const int Y1 = std::min(static_cast<int>(Target->QueryHeight()) - 1, static_cast<int>(std::ceil(T + H)) - 1);
    const int SW = static_cast<int>(Source.QueryWidth()), SH = static_cast<int>(Source.QueryHeight());
    const uint8_t* Texels = Source.QueryTexels();
    for (int Y = Y0; Y <= Y1; ++Y)
        for (int X = X0; X <= X1; ++X)
        {
            const float U = ((X + 0.5f) - L) / W * SW - 0.5f, V = ((Y + 0.5f) - T) / H * SH - 0.5f;
            const int IU = static_cast<int>(std::floor(U)), IV = static_cast<int>(std::floor(V));
            const float FU = U - IU, FV = V - IV;
            float Sum[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
            for (int J = 0; J < 2; ++J)
                for (int I = 0; I < 2; ++I)
                {
                    const int SX = std::min(SW - 1, std::max(0, IU + I)), SY = std::min(SH - 1, std::max(0, IV + J));
                    const float Weight = (I ? FU : 1.0f - FU) * (J ? FV : 1.0f - FV);
                    const uint8_t* S = Texels + (static_cast<size_t>(SY) * SW + SX) * 4u;
                    const float A = S[3] / 255.0f * Weight;
                    Sum[0] += S[0] * A; Sum[1] += S[1] * A; Sum[2] += S[2] * A; Sum[3] += A;   // premultiplied accumulate
                }
            if (Sum[3] <= 0.0f) continue;
            const DisplayColour Colour{ static_cast<uint8_t>(std::lround(Sum[0] / Sum[3])), static_cast<uint8_t>(std::lround(Sum[1] / Sum[3])),
                                        static_cast<uint8_t>(std::lround(Sum[2] / Sum[3])), 255u };
            Blend(static_cast<uint32_t>(X), static_cast<uint32_t>(Y), Colour, std::min(1.0f, Sum[3]) * Opacity);
        }
}

void DisplayRasterProjection::Veil(float Opacity) noexcept
{
    if (!Target || Opacity <= 0.0f) return;
    const DisplayColour Black{ 0u, 0u, 0u, 255u };
    for (uint32_t Y = 0u; Y < Target->QueryHeight(); ++Y)
        for (uint32_t X = 0u; X < Target->QueryWidth(); ++X) Blend(X, Y, Black, Opacity);
}

//------------------------------------------------------------------------------------------------------------------------ geometry helpers

std::vector<DisplayPoint> DisplayRasterProjection::ConstructEllipse(float CentreX, float CentreY, float RadiusX, float RadiusY, uint32_t Segments) noexcept
{
    std::vector<DisplayPoint> Points(Segments);
    for (uint32_t I = 0u; I < Segments; ++I)
    {
        const float A = 2.0f * kPi * I / Segments;
        Points[I] = { CentreX + std::cos(A) * RadiusX, CentreY + std::sin(A) * RadiusY };
    }
    return Points;
}

std::vector<DisplayPoint> DisplayRasterProjection::ConstructRoundedRectangle(float Left, float Top, float Width, float Height, float Radius) noexcept
{
    const float R = std::min(Radius, 0.5f * std::min(Width, Height));
    std::vector<DisplayPoint> Points;
    const float Corners[4][2] = { { Left + Width - R, Top + R }, { Left + Width - R, Top + Height - R }, { Left + R, Top + Height - R }, { Left + R, Top + R } };
    for (int C = 0; C < 4; ++C)
        for (int I = 0; I <= 8; ++I)
        {
            const float A = -kPi / 2.0f + (C * kPi / 2.0f) + (kPi / 2.0f) * I / 8.0f;
            Points.push_back({ Corners[C][0] + std::cos(A) * R, Corners[C][1] + std::sin(A) * R });
        }
    return Points;
}

//------------------------------------------------------------------------------------------------------------------------ SVG path data

namespace {

struct PathCursor
{
    const char* Text;
    [[nodiscard]] bool More() noexcept
    {
        while (*Text == ' ' || *Text == ',' || *Text == '\n' || *Text == '\t' || *Text == '\r') ++Text;
        return *Text != '\0';
    }
    [[nodiscard]] bool NumberAhead() noexcept
    {
        if (!More()) return false;
        const char C = *Text;
        return (C >= '0' && C <= '9') || C == '-' || C == '+' || C == '.';
    }
    [[nodiscard]] float Number() noexcept
    {
        (void)More();
        char* End = nullptr;
        const float Value = std::strtof(Text, &End);
        if (End == Text) { ++Text; return 0.0f; }
        Text = End;
        return Value;
    }
    // Arc flags are single digits that may be run together ("1 0 0" or "100").
    [[nodiscard]] int Flag() noexcept
    {
        (void)More();
        const int Value = *Text == '1' ? 1 : 0;
        if (*Text == '0' || *Text == '1') ++Text;
        return Value;
    }
};

void AppendCubic(std::vector<DisplayPoint>& Out, DisplayPoint P0, DisplayPoint C0, DisplayPoint C1, DisplayPoint P1) noexcept
{
    for (int I = 1; I <= 12; ++I)
    {
        const float T = I / 12.0f, U = 1.0f - T;
        Out.push_back({ U * U * U * P0.X + 3.0f * U * U * T * C0.X + 3.0f * U * T * T * C1.X + T * T * T * P1.X,
                        U * U * U * P0.Y + 3.0f * U * U * T * C0.Y + 3.0f * U * T * T * C1.Y + T * T * T * P1.Y });
    }
}

void AppendArc(std::vector<DisplayPoint>& Out, DisplayPoint P0, float RX, float RY, float RotationDegrees, int Large, int SweepFlag, DisplayPoint P1) noexcept
{
    // SVG implementation notes F.6.5: endpoint to centre parameterisation.
    if (RX == 0.0f || RY == 0.0f) { Out.push_back(P1); return; }
    RX = std::fabs(RX); RY = std::fabs(RY);
    const float Phi = RotationDegrees * kPi / 180.0f, CosPhi = std::cos(Phi), SinPhi = std::sin(Phi);
    const float DX = 0.5f * (P0.X - P1.X), DY = 0.5f * (P0.Y - P1.Y);
    const float X1 = CosPhi * DX + SinPhi * DY, Y1 = -SinPhi * DX + CosPhi * DY;
    const float Lambda = (X1 * X1) / (RX * RX) + (Y1 * Y1) / (RY * RY);
    if (Lambda > 1.0f) { const float S = std::sqrt(Lambda); RX *= S; RY *= S; }
    float Numerator = RX * RX * RY * RY - RX * RX * Y1 * Y1 - RY * RY * X1 * X1;
    const float Denominator = RX * RX * Y1 * Y1 + RY * RY * X1 * X1;
    float Coefficient = Denominator > 0.0f ? std::sqrt(std::max(0.0f, Numerator) / Denominator) : 0.0f;
    if (Large == SweepFlag) Coefficient = -Coefficient;
    const float CX1 = Coefficient * RX * Y1 / RY, CY1 = -Coefficient * RY * X1 / RX;
    const float CX = CosPhi * CX1 - SinPhi * CY1 + 0.5f * (P0.X + P1.X);
    const float CY = SinPhi * CX1 + CosPhi * CY1 + 0.5f * (P0.Y + P1.Y);
    auto AngleOf = [](float UX, float UY, float VX, float VY) noexcept
    {
        const float Dot = UX * VX + UY * VY, Length = std::sqrt((UX * UX + UY * UY) * (VX * VX + VY * VY));
        float A = std::acos(std::max(-1.0f, std::min(1.0f, Length > 0.0f ? Dot / Length : 1.0f)));
        if (UX * VY - UY * VX < 0.0f) A = -A;
        return A;
    };
    const float Theta = AngleOf(1.0f, 0.0f, (X1 - CX1) / RX, (Y1 - CY1) / RY);
    float Delta = AngleOf((X1 - CX1) / RX, (Y1 - CY1) / RY, (-X1 - CX1) / RX, (-Y1 - CY1) / RY);
    if (!SweepFlag && Delta > 0.0f) Delta -= 2.0f * kPi;
    else if (SweepFlag && Delta < 0.0f) Delta += 2.0f * kPi;
    const int Steps = std::max(4, static_cast<int>(std::ceil(std::fabs(Delta) / (kPi / 12.0f))));
    for (int I = 1; I <= Steps; ++I)
    {
        const float A = Theta + Delta * I / Steps;
        const float EX = RX * std::cos(A), EY = RY * std::sin(A);
        Out.push_back({ CosPhi * EX - SinPhi * EY + CX, SinPhi * EX + CosPhi * EY + CY });
    }
}

} // namespace

std::vector<std::vector<DisplayPoint>> DisplayRasterProjection::DecodePathData(const char* Data) noexcept
{
    std::vector<std::vector<DisplayPoint>> Contours;
    if (!Data) return Contours;
    PathCursor Cursor{ Data };
    std::vector<DisplayPoint> Current;
    DisplayPoint Pen{}, Start{}, LastControl{};
    char Command = 0, PreviousCommand = 0;
    auto Flush = [&]() { if (Current.size() >= 2u) Contours.push_back(Current); Current.clear(); };
    while (Cursor.More())
    {
        const char C = *Cursor.Text;
        if ((C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z')) { Command = C; ++Cursor.Text; }
        else if (Command == 0) break;
        else if (Command == 'M') Command = 'L';
        else if (Command == 'm') Command = 'l';
        const bool Relative = Command >= 'a' && Command <= 'z';
        const char Upper = Relative ? static_cast<char>(Command - 32) : Command;
        const DisplayPoint Origin = Relative ? Pen : DisplayPoint{};
        switch (Upper)
        {
        case 'M':
        {
            Flush();
            Pen = { Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            Start = Pen; Current.push_back(Pen);
            break;
        }
        case 'L': Pen = { Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() }; Current.push_back(Pen); break;
        case 'H': Pen.X = Origin.X + Cursor.Number(); Current.push_back(Pen); break;
        case 'V': Pen.Y = Origin.Y + Cursor.Number(); Current.push_back(Pen); break;
        case 'C':
        {
            const DisplayPoint C0{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            const DisplayPoint C1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            const DisplayPoint P1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            AppendCubic(Current, Pen, C0, C1, P1); LastControl = C1; Pen = P1; break;
        }
        case 'S':
        {
            const DisplayPoint C0 = (PreviousCommand == 'C' || PreviousCommand == 'c' || PreviousCommand == 'S' || PreviousCommand == 's')
                ? DisplayPoint{ 2.0f * Pen.X - LastControl.X, 2.0f * Pen.Y - LastControl.Y } : Pen;
            const DisplayPoint C1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            const DisplayPoint P1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            AppendCubic(Current, Pen, C0, C1, P1); LastControl = C1; Pen = P1; break;
        }
        case 'Q':
        {
            const DisplayPoint Q{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            const DisplayPoint P1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            AppendCubic(Current, Pen, { Pen.X + 2.0f / 3.0f * (Q.X - Pen.X), Pen.Y + 2.0f / 3.0f * (Q.Y - Pen.Y) },
                        { P1.X + 2.0f / 3.0f * (Q.X - P1.X), P1.Y + 2.0f / 3.0f * (Q.Y - P1.Y) }, P1);
            LastControl = Q; Pen = P1; break;
        }
        case 'T':
        {
            const DisplayPoint Q = (PreviousCommand == 'Q' || PreviousCommand == 'q' || PreviousCommand == 'T' || PreviousCommand == 't')
                ? DisplayPoint{ 2.0f * Pen.X - LastControl.X, 2.0f * Pen.Y - LastControl.Y } : Pen;
            const DisplayPoint P1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            AppendCubic(Current, Pen, { Pen.X + 2.0f / 3.0f * (Q.X - Pen.X), Pen.Y + 2.0f / 3.0f * (Q.Y - Pen.Y) },
                        { P1.X + 2.0f / 3.0f * (Q.X - P1.X), P1.Y + 2.0f / 3.0f * (Q.Y - P1.Y) }, P1);
            LastControl = Q; Pen = P1; break;
        }
        case 'A':
        {
            const float RX = Cursor.Number(), RY = Cursor.Number(), Rotation = Cursor.Number();
            const int Large = Cursor.Flag(), SweepFlag = Cursor.Flag();
            const DisplayPoint P1{ Origin.X + Cursor.Number(), Origin.Y + Cursor.Number() };
            AppendArc(Current, Pen, RX, RY, Rotation, Large, SweepFlag, P1); Pen = P1; break;
        }
        case 'Z':
            if (!Current.empty()) { Pen = Start; Flush(); Current.push_back(Pen); }
            break;
        default: ++Cursor.Text; break;
        }
        PreviousCommand = Command;
        // A lone point left after Z (the implicit new subpath origin) is discarded by Flush if nothing follows.
    }
    Flush();
    return Contours;
}

} // namespace Frontier
