//============================================================================================================================================
//                                                     DISPLAYSURFACESTRUCTURE.H
//============================================================================================================================================
// 🧩 The world-side half of a display: its housing outline (a unit polygon over [−1, 1]², the same path that masks the
//    sheet), its physical size in metres, and the triangles + UVs that put the sheet on that outline 1:1. The sheet's
//    aspect is derived from the physical aspect, so a 0.26 × 0.26 m cut circle gets a square raster and a 0.40 × 0.13 m
//    pill a 3:1 raster — the texture is never stretched onto a housing of a different shape.
//
//    Local frame: origin at the display centre, +X across (viewer's right), +Y up, +Z out of the glass toward the
//    viewer. UV: u = 0 at the left edge, v = 0 at the TOP edge (glTF convention), matching the sheet's +Y-down pixels.
//    A thin bezel ring (BezelMargin) is emitted as a second triangle list so the display reads as a device, not a decal.
//
//    The emission the display contributes is `EmissionLuminance` × the sheet's texel; luminance is in the scene's
//    luminaire unit (the same one the tail lamps and the Showcase panels use), so the project tunes it beside them.

#pragma once

#include "DisplayRasterProjection.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

enum class DisplayOutlineCategory : uint32_t { Rectangle = 0u, Hexagon = 1u, CutCircle = 2u, Trapezoid = 3u, Pill = 4u };

struct DisplaySpecification
{
    std::string            Name;                                      // [-]  scene subject / material name
    DisplayOutlineCategory Outline = DisplayOutlineCategory::Rectangle;
    float                  Width = 0.30f, Height = 0.1875f;           // [m]  physical glass extent (bounding box of the outline)
    float                  CornerRadius = 0.012f;                      // [m]  rectangle outline only
    float                  BezelMargin = 0.006f;                       // [m]  housing ring around the glass; 0 = none
    uint32_t               SheetWidth = 1200u;                         // [px] sheet width; height follows the physical aspect
    float                  EmissionLuminance = 24.0f;                  // [luminaire unit]
    float                  EmissionColour[3] = { 1.0f, 1.0f, 1.0f };   // [-]  tint multiplied with the sheet
};

struct DisplayTriangleList
{
    std::vector<float>    Positions;   // [m]  xyz per vertex, local frame
    std::vector<float>    Normals;     // [-]  xyz per vertex
    std::vector<float>    TextureCoordinates;   // [-]  uv per vertex
    std::vector<uint32_t> Indices;     // [-]  three per triangle, counter-clockwise seen from +Z
    [[nodiscard]] uint32_t TriangleCount() const noexcept { return static_cast<uint32_t>(Indices.size() / 3u); }
};

class DisplaySurfaceStructure
{
public:
    void Construct(const DisplaySpecification& Specification) noexcept;

    [[nodiscard]] const DisplaySpecification&      QuerySpecification() const noexcept { return Specification; }
    [[nodiscard]] uint32_t                         QuerySheetWidth()    const noexcept { return SheetWidth; }
    [[nodiscard]] uint32_t                         QuerySheetHeight()   const noexcept { return SheetHeight; }
    // Unit outline over [−1, 1]² (+Y up), counter-clockwise. Also the shape mask path for the sheet.
    [[nodiscard]] const std::vector<DisplayPoint>& QueryUnitOutline()   const noexcept { return UnitOutline; }
    // The same outline in sheet pixels (+Y down), ready for DisplayRasterProjection::ConstructMask at Scale 1 / Offset 0.
    [[nodiscard]] std::vector<DisplayPoint>        ConstructSheetOutline(float Inset = 0.0f) const noexcept;
    [[nodiscard]] const DisplayTriangleList&       QueryGlass()         const noexcept { return Glass; }
    [[nodiscard]] const DisplayTriangleList&       QueryBezel()         const noexcept { return Bezel; }
    // Point-in-outline test in local metres (touch), true when inside the glass.
    [[nodiscard]] bool                             Encloses(float LocalX, float LocalY) const noexcept;

    [[nodiscard]] static std::vector<DisplayPoint> ConstructUnitOutline(DisplayOutlineCategory Category, float Width, float Height, float CornerRadius) noexcept;
    // Ear-clipping triangulation of a simple polygon (any winding); indices into Points.
    [[nodiscard]] static std::vector<uint32_t>     Triangulate(const std::vector<DisplayPoint>& Points) noexcept;

private:
    DisplaySpecification      Specification;
    uint32_t                  SheetWidth = 0u, SheetHeight = 0u;
    std::vector<DisplayPoint> UnitOutline;
    DisplayTriangleList       Glass, Bezel;
};

} // namespace Frontier
