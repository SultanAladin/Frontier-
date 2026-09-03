//============================================================================================================================================
//                                                      RECORDINGSURFACE.CPP
//============================================================================================================================================
// 🧩 The only translation unit in DisplayPresentation that spells ImGui. Everything above hands in pixels and colours.

#include "RecordingSurface.h"

#include <imgui.h>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                     HELPERS
//------------------------------------------------------------------------------------------------------------------------

namespace {

ImDrawList* List(void* Slot) noexcept
{
    return static_cast<ImDrawList*>(Slot);
}

ImU32 Pack(ColorQuad Colour) noexcept
{
    return ImGui::ColorConvertFloat4ToU32(ImVec4(Colour.Red, Colour.Green, Colour.Blue, Colour.Alpha));
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

RecordingSurface::RecordingSurface() noexcept
    : Commands(nullptr)
    , DisplayWidth(0.0f)
    , DisplayHeight(0.0f)
{
}

bool RecordingSurface::Begin(SurfaceLayer Layer, float InDisplayWidth, float InDisplayHeight) noexcept
{
    DisplayWidth  = InDisplayWidth;
    DisplayHeight = InDisplayHeight;

    if (ImGui::GetCurrentContext() == nullptr)
    {
        Commands = nullptr;
        return false;
    }

    // 📝 The foreground list sits in front of every ImGui window, so the notch and its shade cover the
    //    project's own panels when pulled down — exactly what a system overlay should do.
    Commands = (Layer == SurfaceLayer::Above)
             ? static_cast<void*>(ImGui::GetForegroundDrawList())
             : static_cast<void*>(ImGui::GetBackgroundDrawList());
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

void RecordingSurface::FillRectangle(const PlaneExtent& Extent, ColorQuad Colour, float Radius) noexcept
{
    if (!Commands) return;
    List(Commands)->AddRectFilled(ImVec2(Extent.MinimumX, Extent.MinimumY),
                                  ImVec2(Extent.MaximumX, Extent.MaximumY),
                                  Pack(Colour), Radius);
}

void RecordingSurface::FillPolygon(const PlanePoint* Points, uint32_t PointCount, ColorQuad Colour) noexcept
{
    if (!Commands || PointCount < 3u) return;

    // 📝 ImGui's AddConvexPolyFilled produces artefacts on concave outlines; the notch is concave (it narrows
    //    toward the bottom), so the concave-capable path is used. It expects ImVec2 storage.
    std::vector<ImVec2> Converted;
    Converted.reserve(PointCount);
    for (uint32_t Index = 0u; Index < PointCount; ++Index)
        Converted.emplace_back(Points[Index].X, Points[Index].Y);

#if IMGUI_VERSION_NUM >= 19100
    List(Commands)->AddConcavePolyFilled(Converted.data(), static_cast<int>(Converted.size()), Pack(Colour));
#else
    List(Commands)->AddConvexPolyFilled(Converted.data(), static_cast<int>(Converted.size()), Pack(Colour));
#endif
}

void RecordingSurface::StrokePolyline(const PlanePoint* Points, uint32_t PointCount, ColorQuad Colour, float Thickness, bool Closed) noexcept
{
    if (!Commands || PointCount < 2u) return;

    std::vector<ImVec2> Converted;
    Converted.reserve(PointCount);
    for (uint32_t Index = 0u; Index < PointCount; ++Index)
        Converted.emplace_back(Points[Index].X, Points[Index].Y);

    List(Commands)->AddPolyline(Converted.data(), static_cast<int>(Converted.size()), Pack(Colour),
                                Closed ? ImDrawFlags_Closed : ImDrawFlags_None, Thickness);
}

void RecordingSurface::Text(float X, float Y, ColorQuad Colour, const char* Utf8, float FontSizePixels) noexcept
{
    if (!Commands || !Utf8) return;
    ImFont* Font = ImGui::GetFont();
    const float Size = FontSizePixels > 0.0f ? FontSizePixels : ImGui::GetFontSize();
    List(Commands)->AddText(Font, Size, ImVec2(X, Y), Pack(Colour), Utf8);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     MEASUREMENT
//------------------------------------------------------------------------------------------------------------------------

PlanePoint RecordingSurface::MeasureText(const char* Utf8, float FontSizePixels) const noexcept
{
    if (ImGui::GetCurrentContext() == nullptr || !Utf8) return {};
    ImFont* Font = ImGui::GetFont();
    const float Size = FontSizePixels > 0.0f ? FontSizePixels : ImGui::GetFontSize();
    const ImVec2 Measured = Font->CalcTextSizeA(Size, FLT_MAX, 0.0f, Utf8);
    return PlanePoint{ Measured.x, Measured.y };
}

} // namespace Frontier
