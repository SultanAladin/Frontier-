//============================================================================================================================================
//                                                      PIXELSPACE.CPP
//============================================================================================================================================
// 🧩 The only translation unit in DisplayPresentation that spells ImGui. Everything above hands in pixels and colours.

#include "PixelSpace.h"

#include <algorithm>

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

PixelSpace::PixelSpace() noexcept
    : Commands(nullptr)
    , DisplayWidth(0.0f)
    , DisplayHeight(0.0f)
{
}

bool PixelSpace::Begin(SurfaceLayer Layer, float InDisplayWidth, float InDisplayHeight) noexcept
{
    DisplayWidth  = InDisplayWidth;
    DisplayHeight = InDisplayHeight;

    if (ImGui::GetCurrentContext() == nullptr)
    {
        Commands = nullptr;
        return false;
    }

    // The foreground list sits in front of every ImGui window, so the notch and its shade cover the
    //    project's own panels when pulled down — exactly what a system overlay should do.
    Commands = (Layer == SurfaceLayer::Above)
             ? static_cast<void*>(ImGui::GetForegroundDrawList())
             : static_cast<void*>(ImGui::GetBackgroundDrawList());
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

void PixelSpace::FillRectangle(const PlaneExtent& Extent, ColorQuad Colour, float Radius) noexcept
{
    if (!Commands) return;
    List(Commands)->AddRectFilled(ImVec2(Extent.MinimumX, Extent.MinimumY),
                                  ImVec2(Extent.MaximumX, Extent.MaximumY),
                                  Pack(Colour), Radius);
}

void PixelSpace::FillRectangleBottomRounded(const PlaneExtent& Extent, ColorQuad Colour, float Radius) noexcept
{
    if (!Commands) return;
    List(Commands)->AddRectFilled(ImVec2(Extent.MinimumX, Extent.MinimumY),
                                  ImVec2(Extent.MaximumX, Extent.MaximumY),
                                  Pack(Colour), Radius, ImDrawFlags_RoundCornersBottom);
}

void PixelSpace::FillPolygon(const PlanePoint* Points, uint32_t PointCount, ColorQuad Colour) noexcept
{
    if (!Commands || PointCount < 3u) return;

    // ImGui's AddConvexPolyFilled produces artefacts on concave outlines; the notch is concave (it narrows
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

void PixelSpace::StrokePolyline(const PlanePoint* Points, uint32_t PointCount, ColorQuad Colour, float Thickness, bool Closed) noexcept
{
    if (!Commands || PointCount < 2u) return;

    std::vector<ImVec2> Converted;
    Converted.reserve(PointCount);
    for (uint32_t Index = 0u; Index < PointCount; ++Index)
        Converted.emplace_back(Points[Index].X, Points[Index].Y);

    List(Commands)->AddPolyline(Converted.data(), static_cast<int>(Converted.size()), Pack(Colour),
                                Closed ? ImDrawFlags_Closed : ImDrawFlags_None, Thickness);
}

void PixelSpace::Text(float X, float Y, ColorQuad Colour, const char* Utf8, float FontSizePixels) noexcept
{
    if (!Commands || !Utf8) return;
    ImFont* Font = ImGui::GetFont();
    const float Size = FontSizePixels > 0.0f ? FontSizePixels : ImGui::GetFontSize();
    List(Commands)->AddText(Font, Size, ImVec2(X, Y), Pack(Colour), Utf8);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        GROUPS
//------------------------------------------------------------------------------------------------------------------------

uint32_t PixelSpace::BeginGroup() const noexcept
{
    if (!Commands) return 0u;
    return static_cast<uint32_t>(List(Commands)->VtxBuffer.Size);
}

void PixelSpace::EndGroup(uint32_t Mark, float OffsetX, float OffsetY, float Scale, float PivotX, float PivotY, float Alpha) noexcept
{
    if (!Commands) return;
    ImDrawList* Draw = List(Commands);
    const int End = Draw->VtxBuffer.Size;
    const float A = std::clamp(Alpha, 0.0f, 1.0f);
    for (int Index = static_cast<int>(Mark); Index < End; ++Index)
    {
        ImDrawVert& Vertex = Draw->VtxBuffer[Index];
        Vertex.pos.x = PivotX + (Vertex.pos.x - PivotX) * Scale + OffsetX;
        Vertex.pos.y = PivotY + (Vertex.pos.y - PivotY) * Scale + OffsetY;
        if (A < 1.0f)
        {
            const ImU32 Colour = Vertex.col;
            const ImU32 Faded  = static_cast<ImU32>(static_cast<float>((Colour >> IM_COL32_A_SHIFT) & 0xFFu) * A + 0.5f);
            Vertex.col = (Colour & ~IM_COL32_A_MASK) | (Faded << IM_COL32_A_SHIFT);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     MEASUREMENT
//------------------------------------------------------------------------------------------------------------------------

PlanePoint PixelSpace::MeasureText(const char* Utf8, float FontSizePixels) const noexcept
{
    if (ImGui::GetCurrentContext() == nullptr || !Utf8) return {};
    ImFont* Font = ImGui::GetFont();
    const float Size = FontSizePixels > 0.0f ? FontSizePixels : ImGui::GetFontSize();
    const ImVec2 Measured = Font->CalcTextSizeA(Size, FLT_MAX, 0.0f, Utf8);
    return PlanePoint{ Measured.x, Measured.y };
}

} // namespace Frontier
