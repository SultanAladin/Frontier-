//============================================================================================================================================
//                                                     DISPLAYRASTERPROJECTION.H
//============================================================================================================================================
// 🧩 Maps design-space primitives (the prototype's 1200 × 750 canvas units) onto a DisplaySheetStructure's pixels:
//    anti-aliased rounded rectangles, polygons (non-zero winding, any contour count), stroked polylines and arcs
//    with round caps, cubic curves, solid / linear / radial paint, one rounded clip rectangle, a shape mask, sprite
//    blits and TrueType text through TypefaceSheetCodec. Source-over blending in the sheet's sRGB encoding, which is
//    what an HTML canvas does and therefore what the accepted prototype looked like.
//
//    Design space: origin top-left, +Y down, uniform Scale to pixels, plus an Offset so a 16:10 layout centres on a
//    panel of any aspect (ScreenSequence.PresentAspect). Nothing here knows what it is drawing — launcher, gauge or
//    icon — it is a projection from vector primitives to texels and no more.

#pragma once

#include "DisplaySheetStructure.h"
#include "TypefaceSheetCodec.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

struct DisplayPoint { float X = 0.0f, Y = 0.0f; };

enum class DisplayPaintCategory : uint32_t { Solid = 0u, Linear = 1u, Radial = 2u };

struct DisplayPaint
{
    DisplayPaintCategory Category = DisplayPaintCategory::Solid;
    DisplayColour        Start{}, End{};            // [-] solid uses Start only
    float                X0 = 0.0f, Y0 = 0.0f;       // [design] linear: start point; radial: centre
    float                X1 = 0.0f, Y1 = 0.0f;       // [design] linear: end point
    float                R0 = 0.0f, R1 = 1.0f;       // [design] radial radii

    DisplayPaint() noexcept = default;
    DisplayPaint(DisplayColour Colour) noexcept : Start(Colour), End(Colour) {}   // NOLINT implicit by design — a colour is a paint
    [[nodiscard]] static DisplayPaint Linear(float X0, float Y0, float X1, float Y1, DisplayColour A, DisplayColour B) noexcept;
    [[nodiscard]] static DisplayPaint Radial(float CentreX, float CentreY, float InnerRadius, float OuterRadius, DisplayColour A, DisplayColour B) noexcept;
};

enum class DisplayTextAlignment : uint32_t { Left = 0u, Centre = 1u, Right = 2u };
enum class DisplayTextWeight    : uint32_t { Light = 0u, Regular = 1u, Medium = 2u };

// A decoded vector artwork: contours to fill and polylines to stroke, in its own unit box (the icon viewBox).
struct DisplayVectorShape
{
    bool                                  Filled = true;
    DisplayColour                         Colour{};
    float                                 StrokeWidth = 0.0f;     // [viewBox] strokes only
    bool                                  Closed = false;         // strokes only
    std::vector<std::vector<DisplayPoint>> Contours;              // [viewBox] one or more
};

struct DisplayVectorArt
{
    float                           ViewWidth = 64.0f, ViewHeight = 64.0f;
    std::vector<DisplayVectorShape> Shapes;
};

class DisplayRasterProjection
{
public:
    DisplayRasterProjection() noexcept = default;

    // Binds the target sheet and the design → pixel mapping for the following calls. Faces may be null (text skipped).
    void Begin(DisplaySheetStructure& Sheet, float Scale, float OffsetX, float OffsetY,
               TypefaceSheetCodec* LightFace, TypefaceSheetCodec* RegularFace, TypefaceSheetCodec* MediumFace) noexcept;

    // ── fills ──────────────────────────────────────────────────────────────────────────────────────────────────
    void FillRectangle(float Left, float Top, float Width, float Height, float Radius, const DisplayPaint& Paint) noexcept;
    void StrokeRectangle(float Left, float Top, float Width, float Height, float Radius, float LineWidth, DisplayColour Colour) noexcept;
    void FillCircle(float CentreX, float CentreY, float Radius, const DisplayPaint& Paint) noexcept;
    void FillPolygon(const std::vector<std::vector<DisplayPoint>>& Contours, const DisplayPaint& Paint) noexcept;
    void FillPolygon(const DisplayPoint* Points, uint32_t Count, const DisplayPaint& Paint) noexcept;

    // ── strokes (round caps and joins) ─────────────────────────────────────────────────────────────────────────
    void StrokeLine(float X0, float Y0, float X1, float Y1, float LineWidth, DisplayColour Colour) noexcept;
    void StrokePolyline(const DisplayPoint* Points, uint32_t Count, float LineWidth, DisplayColour Colour, bool Closed) noexcept;
    void StrokeArc(float CentreX, float CentreY, float Radius, float StartAngle, float Sweep, float LineWidth, DisplayColour Colour) noexcept;
    void StrokeCubic(float X0, float Y0, float C0X, float C0Y, float C1X, float C1Y, float X1, float Y1, float LineWidth, DisplayColour Colour) noexcept;

    // ── text ───────────────────────────────────────────────────────────────────────────────────────────────────
    // (X, Y) is the pen origin on the baseline, as the canvas prototype used it. Returns the advance in design units.
    float Text(const char* Utf8, float X, float Y, float Size, DisplayColour Colour,
               DisplayTextAlignment Alignment = DisplayTextAlignment::Left, DisplayTextWeight Weight = DisplayTextWeight::Regular) noexcept;
    [[nodiscard]] float MeasureText(const char* Utf8, float Size, DisplayTextWeight Weight = DisplayTextWeight::Regular) noexcept;

    // ── vector art and sprites ─────────────────────────────────────────────────────────────────────────────────
    // Draws decoded art scaled into a (Left, Top, Extent × Extent·aspect) box; its own transform, independent of any clip.
    void DrawVectorArt(const DisplayVectorArt& Art, float Left, float Top, float Extent) noexcept;
    // Bilinear blit of a straight-alpha RGBA8 sheet into a design-space box.
    void BlitSheet(const DisplaySheetStructure& Source, float Left, float Top, float Width, float Height, float Opacity = 1.0f) noexcept;
    // Darkening veil over the whole sheet (brightness setting).
    void Veil(float Opacity) noexcept;

    // ── clip and mask ──────────────────────────────────────────────────────────────────────────────────────────
    void PushClip(float Left, float Top, float Width, float Height, float Radius) noexcept;
    void PopClip() noexcept;
    // A per-pixel coverage mask (sheet resolution, 0..255) multiplied into every subsequent write; null clears it.
    void AssignMask(const std::vector<uint8_t>* Mask) noexcept { ShapeMask = Mask; }
    // Rasterises polygon coverage into a mask buffer sized to the current sheet (the housing outline, computed once).
    void ConstructMask(const std::vector<std::vector<DisplayPoint>>& Contours, std::vector<uint8_t>& Mask) noexcept;

    // SVG path data ("M m L l H h V v C c S s Q q T t A a Z z") → contours in the view box. Used by the icon depot.
    [[nodiscard]] static std::vector<std::vector<DisplayPoint>> DecodePathData(const char* Data) noexcept;
    [[nodiscard]] static std::vector<DisplayPoint> ConstructEllipse(float CentreX, float CentreY, float RadiusX, float RadiusY, uint32_t Segments = 48u) noexcept;
    [[nodiscard]] static std::vector<DisplayPoint> ConstructRoundedRectangle(float Left, float Top, float Width, float Height, float Radius) noexcept;

    [[nodiscard]] float QueryScale() const noexcept { return Scale; }

private:
    struct ClipRecord { float Left, Top, Right, Bottom, Radius; };   // [px]

    [[nodiscard]] DisplayColour Sample(const DisplayPaint& Paint, float PixelX, float PixelY) const noexcept;
    void Blend(uint32_t X, uint32_t Y, DisplayColour Colour, float Coverage) noexcept;
    [[nodiscard]] float ClipCoverage(float PixelX, float PixelY) const noexcept;
    void FillCoverage(const std::vector<std::vector<DisplayPoint>>& PixelContours, const DisplayPaint& Paint, std::vector<uint8_t>* MaskOut) noexcept;
    void StrokeCapsule(float X0, float Y0, float X1, float Y1, float HalfWidth, DisplayColour Colour) noexcept;
    void DrawGlyph(const GlyphSheet& Glyph, float PenX, float PenY, DisplayColour Colour) noexcept;
    [[nodiscard]] TypefaceSheetCodec* Face(DisplayTextWeight Weight) const noexcept;

    DisplaySheetStructure*      Target = nullptr;
    float                       Scale = 1.0f, OffsetX = 0.0f, OffsetY = 0.0f;
    TypefaceSheetCodec*         Faces[3] = { nullptr, nullptr, nullptr };
    std::vector<ClipRecord>     Clips;
    const std::vector<uint8_t>* ShapeMask = nullptr;
    std::vector<float>          CoverageRow;   // scratch
};

} // namespace Frontier
