#pragma once
//==============================================================================================================================================
//                                                           LIGHTDEPOTSURFACE.H
//==============================================================================================================================================
// 📦 Drawing primitives transcribed from Experimental/ProjectZeroEditor/InspectorDepot: the pcard stack, the tape, the stepper and the rail.

#include "ControlPanel.h"
#include "EditorInstance.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace Depot
{

constexpr float Pi = 3.14159265358979f;

//------------------------------------------------------------------------------------------------------------------------
//                                                        DEPOT PALETTE
//------------------------------------------------------------------------------------------------------------------------
// Transcribed from InspectorDepot/styles.css :root. The browser resolves these to pixels; so must we.

constexpr ImU32 PanelFill    = IM_COL32( 18,  18,  18, 255);   // [-] --panel  #121212, the rail pill
constexpr ImU32 InsetFill    = IM_COL32( 26,  26,  26, 255);   // [-] --inset  #1a1a1a, every pcard
constexpr ImU32 FieldFill    = IM_COL32(  0,   0,   0, 255);   // [-] --field  #000000, axis cells and meters
constexpr ImU32 RaisedFill   = IM_COL32( 34,  34,  34, 255);   // [-] --raised #222222, stepper buttons
constexpr ImU32 Stroke       = IM_COL32(255, 255, 255,  13);   // [-] --stroke rgba(255,255,255,.05)
constexpr ImU32 StrokeStrong = IM_COL32( 46,  46,  46, 255);   // [-] --stroke-strong #2e2e2e
constexpr ImU32 Text         = IM_COL32(240, 240, 240, 255);   // [-] --text       #f0f0f0
constexpr ImU32 TextDim      = IM_COL32(136, 136, 136, 255);   // [-] --text-dim   #888888
constexpr ImU32 TextFaint    = IM_COL32( 92,  92,  92, 255);   // [-] --text-faint #5c5c5c
constexpr ImU32 Ok           = IM_COL32( 34, 197,  94, 255);   // [-] --ok         #22c55e
constexpr ImU32 HeroFill     = IM_COL32(  5,   7,  15, 255);   // [-] .mp-hero background
constexpr ImU32 PlotFill     = IM_COL32(  5,   5,   5, 255);   // [-] lights.js canvas ground  #050505
constexpr ImU32 EmitterFill  = IM_COL32(  4,   4,   4, 255);   // [-] advancedLights.js ground #040404

constexpr float InsetRadius = 18;   // [px] --r-inset
constexpr float CardPadX    = 14;   // [px] .pcard padding left and right
constexpr float CardPadTop  = 12;   // [px] .pcard padding top
constexpr float CardPadFoot = 14;   // [px] .pcard padding bottom
constexpr float StackGap    = 10;   // [px] .mpanel gap
constexpr float CardSkirt   = 10;   // [px] .pcard margin-bottom, which flexbox adds to the gap

// DM Sans carries a 0.99 em ascent over a 1.25 em line box, so a canvas baseline sits this far below the
//    line-box top that ImGui::AddText anchors to. Canvas fillText is baseline-relative; ImGui is not.
constexpr float BaselineShare = 0.792f;
constexpr float LineShare     = 1.25f;

inline float LineHigh(float Size) noexcept { return Size * LineShare; }

//------------------------------------------------------------------------------------------------------------------------
//                                                       TRACKED LETTERING
//------------------------------------------------------------------------------------------------------------------------
// CSS letter-spacing and text-transform have no ImGui equivalent, so tracked small caps are laid out a
//    glyph at a time. Every uppercase label in the reference carries tracking, so this is not a detail.

// Walks UTF-8, because the reference labels carry degree, middot, multiplication and minus signs.
//    Only ASCII is case-folded; the punctuation has no case to fold.
inline int Glyph(char* Out, const char* Scan, bool Upper)
{
    unsigned int Point = 0;
    const int Bytes = ImTextCharFromUtf8(&Point, Scan, nullptr);
    const int Step  = Bytes > 0 ? Bytes : 1;
    if (Upper && Step == 1)
    {
        Out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(*Scan)));
        Out[1] = '\0';
    }
    else
    {
        std::memcpy(Out, Scan, static_cast<size_t>(Step));
        Out[Step] = '\0';
    }
    return Step;
}

inline float TrackedWide(ImFont* Face, float Size, const char* Body, float Tracking, bool Upper)
{
    float Pen = 0;
    bool  Any = false;
    for (const char* Scan = Body; *Scan;)
    {
        char Cell[8];
        Scan += Glyph(Cell, Scan, Upper);
        Pen += Face->CalcTextSizeA(Size, 10000, 0, Cell).x + Tracking;
        Any = true;
    }
    return Any ? Pen - Tracking : 0;
}

inline void TrackedText(ImDrawList* Draw, ImFont* Face, float Size, ImVec2 Spot, ImU32 Colour,
                        const char* Body, float Tracking, bool Upper)
{
    float Pen = Spot.x;
    for (const char* Scan = Body; *Scan;)
    {
        char Cell[8];
        Scan += Glyph(Cell, Scan, Upper);
        Draw->AddText(Face, Size, {Pen, Spot.y}, Colour, Cell);
        Pen += Face->CalcTextSizeA(Size, 10000, 0, Cell).x + Tracking;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      CANVAS PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

inline ImU32 Blend(ImU32 Colour, float Alpha)
{
    return (Colour & 0x00FFFFFFu) | (static_cast<ImU32>(std::clamp(Alpha, 0.0f, 1.0f) * 255.0f + 0.5f) << 24);
}

inline ImU32 FromBytes(const float Rgb[3], float Alpha)
{
    return IM_COL32(static_cast<int>(Rgb[0] * 255.0f + 0.5f),
                    static_cast<int>(Rgb[1] * 255.0f + 0.5f),
                    static_cast<int>(Rgb[2] * 255.0f + 0.5f),
                    static_cast<int>(std::clamp(Alpha, 0.0f, 1.0f) * 255.0f + 0.5f));
}

// setLineDash([On, Off]) — the reference dashes gridlines, inner cones and crosshairs.
inline void DashedLine(ImDrawList* Draw, ImVec2 From, ImVec2 To, ImU32 Colour, float On, float Off, float Thick = 1)
{
    const float Dx = To.x - From.x, Dy = To.y - From.y;
    const float Span = std::sqrt(Dx * Dx + Dy * Dy);
    if (Span <= 0.01f)
    {
        return;
    }
    const float Ux = Dx / Span, Uy = Dy / Span;
    for (float Walk = 0; Walk < Span; Walk += On + Off)
    {
        const float Stop = std::min(Walk + On, Span);
        Draw->AddLine({From.x + Ux * Walk, From.y + Uy * Walk}, {From.x + Ux * Stop, From.y + Uy * Stop}, Colour, Thick);
    }
}

// ShadeVertsLinearColorGradientKeepAlpha preserves the original alpha, but every gradient in the
//    reference fades out, so the full RGBA has to be interpolated across the span by hand.
inline void ShadeAcross(ImDrawList* Draw, int First, int Last, float FromX, float ToX, ImU32 From, ImU32 To)
{
    const float Span = ToX - FromX;
    const ImVec4 Head = ImGui::ColorConvertU32ToFloat4(From), Foot = ImGui::ColorConvertU32ToFloat4(To);
    for (ImDrawVert* Vertex = Draw->VtxBuffer.Data + First; Vertex < Draw->VtxBuffer.Data + Last; ++Vertex)
    {
        const float Share = std::clamp(std::fabs(Span) < 0.0001f ? 0.0f : (Vertex->pos.x - FromX) / Span, 0.0f, 1.0f);
        Vertex->col = ImGui::GetColorU32(ImLerp(Head, Foot, Share));
    }
}

// createRadialGradient has no ImGui counterpart; concentric discs from the outside in reproduce it.
inline void RadialWash(ImDrawList* Draw, ImVec2 Centre, float Radius, ImU32 Core, ImU32 Edge, int Steps = 26)
{
    const ImVec4 Head = ImGui::ColorConvertU32ToFloat4(Core), Foot = ImGui::ColorConvertU32ToFloat4(Edge);
    for (int Ring = Steps; Ring >= 1; --Ring)
    {
        const float Share = static_cast<float>(Ring) / static_cast<float>(Steps);
        Draw->AddCircleFilled(Centre, Radius * Share, ImGui::GetColorU32(ImLerp(Head, Foot, Share)), 48);
    }
}

// The hero glow has a middle stop: white at the core, the emission colour a quarter out, nothing at the rim.
inline void GlowWash(ImDrawList* Draw, ImVec2 Centre, float Radius, ImU32 Tinted)
{
    const ImVec4 Core = ImGui::ColorConvertU32ToFloat4(IM_COL32(255, 255, 255, 250));
    const ImVec4 Mid  = ImGui::ColorConvertU32ToFloat4(Tinted);
    const ImVec4 Rim  = ImVec4{Mid.x, Mid.y, Mid.z, 0.0f};
    for (int Ring = 32; Ring >= 1; --Ring)
    {
        const float Share = static_cast<float>(Ring) / 32.0f;
        const ImVec4 Ink = Share <= 0.25f ? ImLerp(Core, Mid, Share / 0.25f)
                                          : ImLerp(Mid, Rim, (Share - 0.25f) / 0.75f);
        Draw->AddCircleFilled(Centre, Radius * Share, ImGui::GetColorU32(Ink), 48);
    }
}

inline void Fixed(char* Out, size_t Size, double Value, int Decimals)
{
    std::snprintf(Out, Size, "%.*f", Decimals, Value);
}

} // namespace Depot
} // namespace Frontier
