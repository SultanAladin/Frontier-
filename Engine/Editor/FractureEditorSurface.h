//==============================================================================================================================================
//                                                      FRACTUREEDITORSURFACE.H
//==============================================================================================================================================
// 📦 The FractureEditor dialog: the standalone authoring review at Experimental/FractureEditor/index.html (788 KB
//    bundle, 25 953 B FracturePanel.js + 22 026 B FractureStructure.js + 14 461 B FracturePanel.css, built by
//    Experimental/FractureEditor/Build.mjs). It is opened from ProjectZeroEditor via the per-object fracture card's
//    ↗ expand control (FracturePanel.jsx:34) and from the object context menu, per-object and not a global gallery.
//
//    This header ports the chrome only — titlebar, workspace bar, the three-column workspace (target-panel ·
//    viewport-panel · inspector-panel), the five inspector cards and the statusbar — against the inlined <style>
//    string in the built bundle, not the source .css alone. The Three.js viewport is a dark placeholder; the
//    orbit and fracture simulation are not claimed to run on the CPU.

#pragma once

#include "WindInstrumentSurface.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier::FractureEditor
{

namespace Kit = Frontier::WindInstrument;

//------------------------------------------------------------------------------------------------------------------------
//                                                   PALETTE AND GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

constexpr ImU32 AppBg       = IM_COL32( 23,  23,  23, 255);  // [-] body background #171717
constexpr ImU32 TitleBg     = IM_COL32( 18,  18,  18, 255);  // [-] .titlebar #121212
constexpr ImU32 TitleRule   = IM_COL32( 56,  56,  56, 255);  // [-] .divider #383838
constexpr ImU32 TitleTailInk= IM_COL32( 95,  95,  95, 255);  // [-] .title-tail #5f5f5f
constexpr ImU32 BarBg       = IM_COL32( 32,  32,  32, 255);  // [-] .workspace-bar #202020
constexpr ImU32 BarRule     = IM_COL32(  8,   8,   8, 255);  // [-] .workspace-bar border #080808
constexpr ImU32 TabBg       = IM_COL32( 48,  48,  48, 255);  // [-] .workspace-tab #303030
constexpr ImU32 BreadInk    = IM_COL32(119, 119, 119, 255);  // [-] #breadcrumb #777
constexpr ImU32 WorkBg      = IM_COL32(  8,   8,   8, 255);  // [-] .workspace gap #080808
constexpr ImU32 PaneBg      = IM_COL32( 27,  27,  27, 255);  // [-] .target-panel #1b1b1b
constexpr ImU32 HeadBg      = IM_COL32( 34,  34,  34, 255);  // [-] .pane-heading #222
constexpr ImU32 HeadRule    = IM_COL32(255, 255, 255,   8);  // [-] .pane-heading border #ffffff08
constexpr ImU32 HeadInk     = IM_COL32(170, 170, 170, 255);  // [-] .pane-heading colour #aaa
constexpr ImU32 HeadSpan    = IM_COL32( 99,  99,  99, 255);  // [-] .pane-heading span #636363
constexpr ImU32 TargetSelBg = IM_COL32( 43,  45,  43, 255);  // [-] .target-selected #2b2d2b
constexpr ImU32 TargetSelEdge=IM_COL32(255, 255, 255,  12);  // [-] .target-selected border #ffffff0c
constexpr ImU32 TargetIcon  = IM_COL32(211, 217, 213, 255);  // [-] .target-selected svg stroke #d3d9d5
constexpr ImU32 SourceInk   = IM_COL32( 99,  99,  99, 255);  // [-] .target-properties dt #636363
constexpr ImU32 ValueInk    = IM_COL32(151, 151, 151, 255);  // [-] .target-properties dd #979797
constexpr ImU32 FootBg      = IM_COL32( 23,  23,  23, 255);  // [-] .target-footer #171717
constexpr ImU32 CodeInk     = IM_COL32(112, 112, 112, 255);  // [-] .target-footer code #707070
constexpr ImU32 ViewBg      = IM_COL32( 21,  21,  21, 255);  // [-] .viewport-panel #151515
constexpr ImU32 ToolBg      = IM_COL32( 28,  28,  28, 255);  // [-] .viewport-toolbar #1c1c1c
constexpr ImU32 ToolActive  = IM_COL32( 51,  51,  51, 255);  // [-] button[aria-pressed] #333
constexpr ImU32 ToolInk     = IM_COL32(211, 211, 211, 255);  // [-] #eee
constexpr ImU32 HelpInk     = IM_COL32( 86,  89,  86, 255);  // [-] .viewport-help #565956
constexpr ImU32 PreviewBg   = IM_COL32( 28,  28,  28, 255);  // [-] .preview-controls #1c1c1c
constexpr ImU32 PrimaryBg   = IM_COL32(186, 203, 191, 255);  // [-] .primary #bacbbf
constexpr ImU32 PrimaryInk  = IM_COL32( 23,  39,  29, 255);  // [-] .primary colour #17271d
constexpr ImU32 MetricBg    = IM_COL32( 22,  22,  22, 255);  // [-] .metrics #161616
constexpr ImU32 MetricStrong= IM_COL32(183, 193, 186, 255);  // [-] .metrics strong #b7c1ba
constexpr ImU32 MetricCap   = IM_COL32( 96, 103,  96, 255);  // [-] .metrics span #606760
constexpr ImU32 CardBg      = IM_COL32( 25,  25,  25, 255);  // [-] .card #191919
constexpr ImU32 CardEdge    = IM_COL32(255, 255, 255,  11);  // [-] .card border #ffffff0b
constexpr ImU32 CardHeadInk = IM_COL32(219, 219, 219, 255);  // [-] h2 #dbdbdb
constexpr ImU32 CardNum     = IM_COL32( 72,  72,  72, 255);  // [-] .card header span #484848
constexpr ImU32 MatOffBg    = IM_COL32( 35,  35,  35, 255);  // [-] .material-options button #232323
constexpr ImU32 MatOffInk   = IM_COL32(146, 146, 146, 255);  // [-] #929292
constexpr ImU32 MatOnBg     = IM_COL32( 53,  57,  53, 255);  // [-] [aria-pressed] #353935
constexpr ImU32 MatOnInk    = IM_COL32(225, 231, 226, 255);  // [-] #e1e7e2
constexpr ImU32 ReadStrong  = IM_COL32(185, 191, 186, 255);  // [-] .material-readout strong #b9bfba
constexpr ImU32 GraphGrid   = IM_COL32(255, 255, 255,  13);  // [-] .graph-grid #ffffff0d
constexpr ImU32 GraphLine   = IM_COL32(141, 166, 148, 255);  // [-] .graph-line #8da694
constexpr ImU32 GraphFill   = IM_COL32(140, 165, 145,  16);  // [-] .graph-area #8ca59510
constexpr ImU32 StatusBg    = IM_COL32( 17,  17,  17, 255);  // [-] .statusbar #111

constexpr float TitleTall   = 39.0f;  // [px] .titlebar height
constexpr float BarTall     = 40.0f;  // [px] .workspace-bar height
constexpr float WorkGap     =  1.0f;  // [px] .workspace gap
constexpr float PaneHeadTall= 39.0f;  // [px] .pane-heading height
constexpr float AsideWide   =240.0f;  // [px] .workspace first track
constexpr float InspectorWide=330.0f; // [px] .workspace last track
constexpr float CardRound   = 22.0f;  // [px] .card border-radius
constexpr float CardPadX    = 17.0f;  // [px] .card padding left/right
constexpr float CardPadY    = 20.0f;  // [px] .card padding
constexpr float MetricTall  = 72.0f;  // [px] .metrics height (19+19+padding)
constexpr float PreviewTall = 68.0f;  // [px] .preview-controls
constexpr float ToolTall    = 40.0f;  // [px] .viewport-toolbar
constexpr float StatusTall  = 26.0f;  // [px] .statusbar
constexpr float CardGap     = 12.0f;  // [px] .card margin-bottom

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE STATIC COPY
//------------------------------------------------------------------------------------------------------------------------

inline const char* TitleTail()    { return "HTML AUTHORING PREVIEW"; }
inline const char* Breadcrumb()   { return "Cube / Fracture"; }
inline const char* Execution()    { return "DYNAMIC / GEOMETRY"; }
inline const char* ViewportName() { return "Cube"; }
inline const char* ViewportCap()  { return "Source geometry \xc2\xb7 no fracture yet"; }
inline const char* StatusReady()  { return "Ready"; }
inline const char* StatusTail()   { return "HTML ONLY \xc2\xb7 NATIVE PORT PENDING"; }

//------------------------------------------------------------------------------------------------------------------------
//                                                  CHROME PAINTERS
//------------------------------------------------------------------------------------------------------------------------

inline void PaintTitlebar(ImDrawList* Draw, ImFont* Face, ImVec2 Spot, float Wide)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + TitleTall }, TitleBg);
    Kit::Inked(Draw, Face, Spot.x + 18.0f, Spot.y + (TitleTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadInk, "\xe2\x97\x88  Frontier");
    Kit::Inked(Draw, Face, Spot.x + 110.0f, Spot.y + (TitleTall - 13.0f)*0.5f, 13.0f, TitleRule, "|");
    Kit::Inked(Draw, Face, Spot.x + 124.0f, Spot.y + (TitleTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadInk, "Project-Zero");
    float TailW = Kit::Measured(Face, 9.0f, TitleTail());
    Kit::Tracked(Draw, Face, Spot.x + Wide - 18.0f - TailW, Spot.y + (TitleTall - Kit::Grind(9.0f))*0.5f + Kit::AscentShare*9.0f, 9.0f, TitleTailInk, TitleTail(), 1.3f);
}

inline void PaintWorkspaceBar(ImDrawList* Draw, ImFont* Face, ImVec2 Spot, float Wide)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + BarTall }, BarBg);
    Draw->AddLine({ Spot.x, Spot.y + BarTall }, { Spot.x + Wide, Spot.y + BarTall }, BarRule, 1.0f);
    // Tab.
    float TabWide = 150.0f;
    Draw->AddRectFilled(Spot, { Spot.x + TabWide, Spot.y + BarTall }, TabBg, 0);
    Draw->AddRectFilled({ Spot.x, Spot.y + BarTall - 7.0f }, { Spot.x + TabWide, Spot.y + BarTall }, TabBg);
    Kit::Inked(Draw, Face, Spot.x + 20.0f, Spot.y + (BarTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadInk, "Fracture");
    Kit::Inked(Draw, Face, Spot.x + TabWide - 22.0f, Spot.y + (BarTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, BreadInk, "\xe2\x86\x97");
    Kit::Inked(Draw, Face, Spot.x + TabWide + 19.0f, Spot.y + (BarTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, BreadInk, Breadcrumb());
    // Export button on the right.
    const char* Export = "Export fracture...";
    float EW = Kit::Measured(Face, 10.0f, Export) + 20.0f;
    ImVec2 Btn{ Spot.x + Wide - 12.0f - EW, Spot.y + (BarTall - 22.0f)*0.5f };
    Draw->AddRectFilled(Btn, { Btn.x + EW, Btn.y + 22.0f }, IM_COL32(40,40,40,255), 5.0f);
    Kit::Inked(Draw, Face, Btn.x + (EW - Kit::Measured(Face, 10.0f, Export))*0.5f, Btn.y + (22.0f - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, HeadInk, Export);
}

inline void PaintTargetPanel(ImDrawList* Draw, ImFont* Face, ImFont* Small, ImVec2 Spot, float Wide, float Tall)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, PaneBg);
    // Pane heading.
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + PaneHeadTall }, HeadBg);
    Draw->AddLine({ Spot.x, Spot.y + PaneHeadTall }, { Spot.x + Wide, Spot.y + PaneHeadTall }, HeadRule, 1.0f);
    Kit::Inked(Draw, Face, Spot.x + 16.0f, Spot.y + (PaneHeadTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadInk, "Object");
    {
        float Run = Kit::Tracked(nullptr, Face, 0, 0, 8.0f, 0, "LOCAL SPACE", 1.2f, false);
        Kit::Tracked(Draw, Face, Spot.x + Wide - 16.0f - Run, Spot.y + (PaneHeadTall - Kit::Grind(8.0f))*0.5f + Kit::AscentShare*8.0f, 8.0f, HeadSpan, "LOCAL SPACE", 1.2f);
    }
    // Selected object row.
    ImVec2 Sel{ Spot.x + 15.0f, Spot.y + PaneHeadTall + 18.0f };
    Draw->AddRectFilled(Sel, { Sel.x + Wide - 30.0f, Sel.y + 58.0f }, TargetSelBg, 7.0f);
    Draw->AddRect(Sel, { Sel.x + Wide - 30.0f, Sel.y + 58.0f }, TargetSelEdge, 7.0f, 0, 1.0f);
    // Icon: simple cube wireframe (32x32).
    ImVec2 Icon{ Sel.x + 16.0f, Sel.y + 13.0f };
    Draw->AddRect(Icon, { Icon.x + 32.0f, Icon.y + 32.0f }, TargetIcon, 0, 0, 1.1f);
    Draw->AddLine({ Icon.x, Icon.y + 10.0f }, { Icon.x + 32.0f, Icon.y + 10.0f }, TargetIcon, 1.1f);
    Draw->AddLine({ Icon.x + 16.0f, Icon.y }, { Icon.x + 16.0f, Icon.y + 32.0f }, TargetIcon, 1.1f);
    Kit::Inked(Draw, Face, Sel.x + 58.0f, Sel.y + 14.0f, 12.0f, HeadInk, "Cube");
    Kit::Inked(Draw, Face, Sel.x + 58.0f, Sel.y + 32.0f, 10.0f, ValueInk, "Cube");
    Draw->AddCircleFilled({ Sel.x + Wide - 30.0f - 14.0f, Sel.y + 29.0f }, 3.0f, IM_COL32(105,147,117,255));
    // Properties dl.
    float Y = Sel.y + 58.0f + 23.0f;
    const char* Keys[4] = { "Source", "Dimensions", "Object scale", "Source volume" };
    const char* Vals[4] = { "Analytical primitive", "1 \xc3\x97 1 \xc3\x97 1 m", "1.00 \xc3\x97 1.00 \xc3\x97 1.00", "1.000 m\xc2\xb3" };
    for (int I = 0; I < 4; ++I)
    {
        Kit::Inked(Draw, Face, Spot.x + 16.0f, Y, 10.0f, SourceInk, Keys[I]);
        float VW = Kit::Measured(Face, 10.0f, Vals[I]);
        Kit::Inked(Draw, Face, Spot.x + Wide - 16.0f - VW, Y, 10.0f, ValueInk, Vals[I]);
        Y += 18.0f;
    }
    // Footer.
    ImVec2 Foot{ Spot.x, Spot.y + Tall - 54.0f };
    Draw->AddRectFilled(Foot, { Spot.x + Wide, Spot.y + Tall }, FootBg);
    Draw->AddLine(Foot, { Spot.x + Wide, Foot.y }, HeadRule, 1.0f);
    Kit::Tracked(Draw, Face, Foot.x + 16.0f, Foot.y + 14.0f, 9.0f, SourceInk, "SOURCE OWNER", 1.1f);
    Kit::Inked(Draw, Face, Foot.x + 16.0f, Foot.y + 30.0f, 9.0f, CodeInk, "cube");
}

inline void PaintViewportPanel(ImDrawList* Draw, ImFont* Face, ImVec2 Spot, float Wide, float Tall)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, ViewBg);
    // Toolbar.
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + ToolTall }, ToolBg);
    Draw->AddLine({ Spot.x, Spot.y + ToolTall }, { Spot.x + Wide, Spot.y + ToolTall }, HeadRule, 1.0f);
    float X = Spot.x + 13.0f;
    // View tabs.
    Draw->AddRectFilled({ X, Spot.y + 8.0f }, { X + 52.0f, Spot.y + 32.0f }, ToolActive, 5.0f);
    Kit::Inked(Draw, Face, X + (52.0f - Kit::Measured(Face, 10.0f, "Source"))*0.5f, Spot.y + (ToolTall - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, ToolInk, "Source");
    X += 56.0f;
    Kit::Inked(Draw, Face, X + (68.0f - Kit::Measured(Face, 10.0f, "Fragments"))*0.5f, Spot.y + (ToolTall - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, HeadSpan, "Fragments");
    X = Spot.x + Wide - 13.0f - 68.0f - 6.0f - 52.0f;
    Kit::Inked(Draw, Face, X + (68.0f - Kit::Measured(Face, 10.0f, "Wireframe"))*0.5f, Spot.y + (ToolTall - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, HeadSpan, "Wireframe");
    X += 74.0f;
    Draw->AddRectFilled({ X, Spot.y + 8.0f }, { X + 32.0f, Spot.y + 32.0f }, IM_COL32(40,40,40,255), 5.0f);
    Kit::Inked(Draw, Face, X + (32.0f - Kit::Measured(Face, 10.0f, "Fit"))*0.5f, Spot.y + (ToolTall - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, HeadInk, "Fit");
    // Viewport placeholder (dark canvas).
    ImVec2 View{ Spot.x, Spot.y + ToolTall };
    float ViewTall = Tall - ToolTall - PreviewTall - MetricTall;
    Draw->AddRectFilled({ View.x, View.y }, { View.x + Wide, View.y + ViewTall }, IM_COL32(18,18,18,255));
    // Title.
    Kit::Tracked(Draw, Face, View.x + 27.0f, View.y + 27.0f, 9.0f, MetricCap, Execution(), 1.5f);
    Kit::Inked(Draw, Face, View.x + 27.0f, View.y + 44.0f, 25.0f, IM_COL32(195,199,196,255), ViewportName());
    Kit::Inked(Draw, Face, View.x + 27.0f, View.y + 78.0f, 10.0f, SourceInk, ViewportCap());
    // Help.
    const char* Help = "Drag to orbit \xc2\xb7 Scroll to zoom \xc2\xb7 Shift-click to place impact";
    float HW = Kit::Measured(Face, 9.0f, Help);
    Kit::Inked(Draw, Face, View.x + (Wide - HW)*0.5f, View.y + ViewTall - 22.0f, 9.0f, HelpInk, Help);
    // Preview controls.
    ImVec2 Prev{ View.x, View.y + ViewTall };
    Draw->AddRectFilled(Prev, { Prev.x + Wide, Prev.y + PreviewTall }, PreviewBg);
    Draw->AddLine(Prev, { Prev.x + Wide, Prev.y }, HeadRule, 1.0f);
    Kit::Inked(Draw, Face, Prev.x + 20.0f, Prev.y + 14.0f, 10.0f, HeadInk, "Fragment separation");
    Kit::Inked(Draw, Face, Prev.x + 20.0f + Kit::Measured(Face, 10.0f, "Fragment separation") + 6.0f, Prev.y + 14.0f, 8.0f, SourceInk, "inspection only");
    // Slider well.
    Draw->AddRectFilled({ Prev.x + 20.0f, Prev.y + 32.0f }, { Prev.x + Wide*0.55f, Prev.y + 46.0f }, IM_COL32(16,16,16,255), 14.0f);
    Draw->AddRect({ Prev.x + 20.0f, Prev.y + 32.0f }, { Prev.x + Wide*0.55f, Prev.y + 46.0f }, HeadRule, 14.0f, 0, 1.0f);
    // Primary button.
    float BW = Kit::Measured(Face, 10.0f, "Fracture object") + 24.0f;
    ImVec2 Btn{ Prev.x + Wide - 20.0f - BW, Prev.y + (PreviewTall - 30.0f)*0.5f };
    Draw->AddRectFilled(Btn, { Btn.x + BW, Btn.y + 30.0f }, PrimaryBg, 5.0f);
    Kit::Inked(Draw, Face, Btn.x + (BW - Kit::Measured(Face, 10.0f, "Fracture object"))*0.5f, Btn.y + (30.0f - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, PrimaryInk, "Fracture object");
    // Metrics.
    ImVec2 Met{ Prev.x, Prev.y + PreviewTall };
    Draw->AddRectFilled(Met, { Met.x + Wide, Met.y + MetricTall }, MetricBg);
    Draw->AddLine(Met, { Met.x + Wide, Met.y }, HeadRule, 1.0f);
    const char* Caps[4] = { "FRAGMENTS", "OCCUPIED VOLUME", "MIN TRIANGLE QUALITY", "TOPOLOGY" };
    const char* Vals[4] = { "1", "100.000%", "\xe2\x80\x94", "Closed" };
    for (int I = 0; I < 4; ++I)
    {
        float Cell = Wide / 4.0f;
        float CX = Met.x + I*Cell;
        if (I) Draw->AddLine({ CX, Met.y + 10.0f }, { CX, Met.y + MetricTall - 10.0f }, HeadRule, 1.0f);
        float VW = Kit::Measured(Face, 23.0f, Vals[I]);
        Kit::Inked(Draw, Face, CX + (Cell - VW)*0.5f, Met.y + 16.0f, 23.0f, MetricStrong, Vals[I]);
        float CW = Kit::Measured(Face, 7.0f, Caps[I]);
        Kit::Inked(Draw, Face, CX + (Cell - CW)*0.5f, Met.y + 48.0f, 7.0f, MetricCap, Caps[I]);
    }
}

inline void PaintInspectorCard(ImDrawList* Draw, ImFont* Face, ImFont* Small, ImVec2 Spot, float Wide, int Index, const char* Title, const char* Caption)
{
    float Tall = 110.0f;
    if (Index == 0) Tall = 145.0f;
    else if (Index == 1) Tall = 185.0f;
    else if (Index == 2) Tall = 145.0f;
    else if (Index == 3) Tall = 125.0f;
    else Tall = 95.0f;
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, CardBg, CardRound);
    Draw->AddRect(Spot, { Spot.x + Wide, Spot.y + Tall }, CardEdge, CardRound, 0, 1.0f);
    Kit::Inked(Draw, Face, Spot.x + CardPadX, Spot.y + CardPadY, 15.0f, CardHeadInk, Title);
    char Num[4]; std::snprintf(Num, sizeof(Num), "0%d", Index+1);
    float NW = Kit::Measured(Face, 9.0f, Num);
    Kit::Inked(Draw, Face, Spot.x + Wide - CardPadX - NW, Spot.y + CardPadY + (Kit::Grind(15.0f)-Kit::Grind(9.0f))*0.5f, 9.0f, CardNum, Num);
    if (Caption) Kit::Inked(Draw, Face, Spot.x + CardPadX, Spot.y + CardPadY + Kit::Grind(15.0f) + 7.0f, 9.0f, MetricCap, Caption);
    float Y = Spot.y + CardPadY + Kit::Grind(15.0f) + 24.0f;
    if (Index == 0)
    {
        // Material grid 2x3.
        const char* Mats[6] = { "Concrete", "Stone", "Wood", "Glass", "Tempered glass", "ABS plastic" };
        for (int I = 0; I < 6; ++I)
        {
            int Col = I % 2, Row = I / 2;
            ImVec2 Cell{ Spot.x + CardPadX + Col*(Wide/2.0f + 3.0f - CardPadX), Y + Row*32.0f };
            float CW = Wide/2.0f - 3.0f - 6.0f;
            ImU32 Bg = (I==0) ? MatOnBg : MatOffBg;
            ImU32 Ink = (I==0) ? MatOnInk : MatOffInk;
            Draw->AddRectFilled(Cell, { Cell.x + CW, Cell.y + 26.0f }, Bg, 4.0f);
            Draw->AddCircleFilled({ Cell.x + 10.0f, Cell.y + 13.0f }, 3.5f, IM_COL32(140,140,140,255));
            Kit::Inked(Draw, Face, Cell.x + 22.0f, Cell.y + (26.0f - Kit::Grind(10.0f))*0.5f + Kit::AscentShare*10.0f, 10.0f, Ink, Mats[I]);
        }
    }
    else if (Index == 1)
    {
        // Impact graph placeholder.
        Draw->AddRectFilled({ Spot.x + CardPadX, Y }, { Spot.x + Wide - CardPadX, Y + 48.0f }, IM_COL32(18,20,19,255), 6.0f);
        Draw->AddLine({ Spot.x + CardPadX + 30.0f, Y + 10.0f }, { Spot.x + Wide - CardPadX - 10.0f, Y + 38.0f }, GraphLine, 1.5f);
        Kit::Inked(Draw, Face, Spot.x + CardPadX + 8.0f, Y + 52.0f, 9.0f, HeadInk, "Impact energy  2,500 J  ·  Seed 42");
    }
    else if (Index == 3)
    {
        Draw->AddRectFilled({ Spot.x + CardPadX, Y }, { Spot.x + Wide - CardPadX, Y + 28.0f }, IM_COL32(17,17,17,255), 8.0f);
        Draw->AddRect({ Spot.x + CardPadX, Y }, { Spot.x + Wide - CardPadX, Y + 28.0f }, CardEdge, 8.0f, 0, 1.0f);
        Kit::Inked(Draw, Face, Spot.x + CardPadX + 10.0f, Y + (28.0f - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadSpan, "Dynamic");
        Kit::Inked(Draw, Face, Spot.x + Wide - CardPadX - 38.0f, Y + (28.0f - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, ToolInk, "Baked");
    }
}

inline void PaintInspectorPanel(ImDrawList* Draw, ImFont* Face, ImFont* Small, ImVec2 Spot, float Wide, float Tall)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, PaneBg);
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + PaneHeadTall }, HeadBg);
    Draw->AddLine({ Spot.x, Spot.y + PaneHeadTall }, { Spot.x + Wide, Spot.y + PaneHeadTall }, HeadRule, 1.0f);
    Kit::Inked(Draw, Face, Spot.x + 16.0f, Spot.y + (PaneHeadTall - Kit::Grind(11.0f))*0.5f + Kit::AscentShare*11.0f, 11.0f, HeadInk, "Fracture inspector");
    {
        float Run = Kit::Tracked(nullptr, Face, 0, 0, 8.0f, 0, "PER OBJECT", 1.2f, false);
        Kit::Tracked(Draw, Face, Spot.x + Wide - 16.0f - Run, Spot.y + (PaneHeadTall - Kit::Grind(8.0f))*0.5f + Kit::AscentShare*8.0f, 8.0f, HeadSpan, "PER OBJECT", 1.2f);
    }
    float Y = Spot.y + PaneHeadTall + 12.0f;
    const char* Titles[5] = { "Material", "Impact", "Fragment quality", "Bake", "Geometry receipt" };
    const char* Caps[5] = { "Fracture response \xc2\xb7 not surface appearance", nullptr, nullptr, nullptr, nullptr };
    for (int I = 0; I < 5; ++I)
    {
        PaintInspectorCard(Draw, Face, Small, { Spot.x + 12.0f, Y }, Wide - 24.0f, I, Titles[I], Caps[I]);
        float H = (I==0?145.0f: I==1?185.0f: I==2?145.0f: I==3?125.0f:95.0f);
        Y += H + CardGap;
        if (Y > Spot.y + Tall - 12.0f) break;
    }
}

// The whole editor: titlebar · workspace bar · three-column workspace · statusbar.
inline void PaintEditor(ImDrawList* Draw, ImFont* Face, ImFont* Small, ImVec2 Spot, float Wide, float Tall)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, AppBg, 0);
    // Titlebar.
    PaintTitlebar(Draw, Face, Spot, Wide);
    // Workspace bar.
    PaintWorkspaceBar(Draw, Face, { Spot.x, Spot.y + TitleTall }, Wide);
    // Workspace grid.
    ImVec2 Work{ Spot.x, Spot.y + TitleTall + BarTall };
    float WorkTall = Tall - TitleTall - BarTall - StatusTall;
    Draw->AddRectFilled(Work, { Work.x + Wide, Work.y + WorkTall }, WorkBg);
    // Three columns.
    float MidWide = Wide - AsideWide - InspectorWide - WorkGap*2.0f;
    PaintTargetPanel(Draw, Face, Small, { Work.x, Work.y }, AsideWide, WorkTall);
    PaintViewportPanel(Draw, Face, { Work.x + AsideWide + WorkGap, Work.y }, MidWide, WorkTall);
    PaintInspectorPanel(Draw, Face, Small, { Work.x + AsideWide + WorkGap + MidWide + WorkGap, Work.y }, InspectorWide, WorkTall);
    // Statusbar.
    ImVec2 Stat{ Spot.x, Spot.y + Tall - StatusTall };
    Draw->AddRectFilled(Stat, { Stat.x + Wide, Stat.y + StatusTall }, StatusBg);
    Draw->AddLine(Stat, { Stat.x + Wide, Stat.y }, HeadRule, 1.0f);
    Kit::Inked(Draw, Face, Stat.x + 13.0f, Stat.y + (StatusTall - Kit::Grind(9.0f))*0.5f + Kit::AscentShare*9.0f, 9.0f, SourceInk, StatusReady());
    float TailW = Kit::Measured(Face, 8.0f, StatusTail());
    Kit::Inked(Draw, Face, Stat.x + Wide - 13.0f - TailW, Stat.y + (StatusTall - Kit::Grind(8.0f))*0.5f + Kit::AscentShare*8.0f, 8.0f, MetricCap, StatusTail());
    // Outer border.
    Draw->AddRect(Spot, { Spot.x + Wide, Spot.y + Tall }, IM_COL32(8,8,8,255), 0, 0, 1.0f);
}

} // namespace Frontier::FractureEditor
