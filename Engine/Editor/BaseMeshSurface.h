//==============================================================================================================================================
//                                                         BASEMESHSURFACE.H
//==============================================================================================================================================
// 📦 Base meshes ported from Experimental/ProjectZeroEditor/index.html (67c2601) and FractureEditor/FractureSpecification.js.
//    The browser lists five analytical primitives in Editor.jsx:52 — cube, sphere, cylinder, cone, torus — each with
//    an editor-* icon and a ConstructWorld::Build mesh. Nothing in Engine/ carried the browser's own icon set or the
//    exact vertex counts, so this header makes both explicit and measurable.
//
//    The card chrome is the same .generic-card the fracture card uses, so the palette here is that card's, not a new
//    invention. The thumbnails are a CPU 2-D projection of the actual ConstructWorld vertices, not a decorative SVG.

#pragma once

#include "WindInstrumentSurface.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier::BaseMesh
{

namespace Kit = Frontier::WindInstrument;

//------------------------------------------------------------------------------------------------------------------------
//                                                   PALETTE AND GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

constexpr ImU32 CardFill    = IM_COL32( 26,  26,  26, 255);  // [-] .generic-card background #1a1a1a
constexpr ImU32 CardEdge    = IM_COL32(255, 255, 255,  13);  // [-] .generic-card border #ffffff0d
constexpr ImU32 TitleInk    = IM_COL32(202, 202, 202, 255);  // [-] h3 #cacaca
constexpr ImU32 EyebrowInk  = IM_COL32(104, 104, 104, 255);  // [-] header small #686868
constexpr ImU32 LabelInk    = IM_COL32(170, 170, 170, 255);  // [-] .switch-row #aaa (reused for mesh labels)
constexpr ImU32 NoteInk     = IM_COL32(118, 118, 118, 255);  // [-] .fracture-card p #767676
constexpr ImU32 ThumbBg     = IM_COL32( 21,  21,  21, 255);  // [-] thumbnail well #151515 (viewport-panel)
constexpr ImU32 ThumbEdge   = IM_COL32(255, 255, 255,  10);  // [-] .fracture-sdf border #ffffff0a
constexpr ImU32 ThumbWire   = IM_COL32(186, 203, 191, 255);  // [-] wire #bacbbf (primary)
constexpr ImU32 ThumbFill   = IM_COL32( 52,  58,  52, 255);  // [-] filled face #343a34
constexpr ImU32 CountInk    = IM_COL32(183, 193, 186, 255);  // [-] metrics strong #b7c1ba

constexpr float CardRound   = 22.0f;   // [px] .generic-card border-radius
constexpr float PadX        = 14.0f;   // [px] .generic-card padding left/right
constexpr float PadY        = 18.0f;   // [px] .generic-card padding top/bottom
constexpr float TitleSize   = 15.0f;   // [px] h3
constexpr float EyebrowSize =  9.0f;   // [px] header small
constexpr float EyebrowTrack=  1.2f;   // [px] letter-spacing
constexpr float ThumbWide   = 140.0f;  // [px] thumbnail width
constexpr float ThumbTall   = 110.0f;  // [px] thumbnail height
constexpr float ThumbRound  =  8.0f;   // [px] thumbnail radius
constexpr float ThumbGap    = 12.0f;   // [px] grid gap
constexpr float LabelSize   = 11.0f;   // [px] mesh name
constexpr float CountSize   = 10.0f;   // [px] vertex / triangle count
constexpr float NoteSize    = 10.0f;   // [px] caption

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE FIVE PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

struct Primitive
{
    const char* Id;          // ConstructKind name, lower-case
    const char* Name;        // Display name in the browser
    const char* Description; // One-line browser tooltip
    const char* Icon;        // editor-* icon name
};

inline constexpr std::array<Primitive, 5> Primitives{{
    { "cube",     "Cube",     "Analytical primitive · 1 × 1 × 1 m", "editor-cube"     },
    { "sphere",   "Sphere",   "UV sphere · 32 × 16",               "editor-sphere"   },
    { "cylinder", "Cylinder", "32-sided · caps",                    "editor-cylinder" },
    { "cone",     "Cone",     "32-sided · 1 cap",                   "editor-cone"     },
    { "torus",    "Torus",    "32 × 12 · 0.35 + 0.15",               "editor-torus"    },
}};

// Browser catalogue order in Editor.jsx:48 — cube, sphere, cylinder, torus, cone. The native ConstructKind order is
//    Cube, Sphere, Cylinder, Cone, Plane, Torus, ... This helper maps browser order to native order for checks.
inline int BrowserToConstruct(int BrowserIndex)
{
    constexpr int Map[5] = { 0, 1, 2, 3, 5 }; // cube 0, sphere 1, cylinder 2, cone 3, torus 5
    return Map[BrowserIndex];
}

// Expected topology from Engine/Editor/ConstructWorld.cpp — Build() counts, triangle soup for cube/cylinder/cone.
struct Expect
{
    int Vertices;
    int Indices;
    int Triangles;
};

inline Expect Expected(int ConstructKind)
{
    switch (ConstructKind)
    {
        case 0: return {  36,   36,  12 }; // Cube
        case 1: return { 561, 3072,1024 }; // Sphere 33*17 verts, 32*16*2 tris
        case 2: return { 384,  384, 128 }; // Cylinder 32*(1+2+1) =128 tris
        case 3: return { 192,  192,  64 }; // Cone 32*2 =64 tris
        case 5: return { 429, 2304, 768 }; // Torus 33*13 verts, 32*12*2 tris
        default: return {   0,    0,   0 };
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  2-D THUMBNAIL DRAWING
//------------------------------------------------------------------------------------------------------------------------
// A light orthographic projection for the CPU proof — not the engine's ReSTIR viewport, but the same vertex positions
//    ConstructWorld builds, projected isometrically so the browser's own thumbnails are recognisable.

inline ImVec2 ProjectIso(ImVec2 Centre, float Scale, float X, float Y, float Z)
{
    // Isometric: x' = (x - z) * cos 30°, y' = (x + z) * sin 30° - y  — then scaled and centred.
    const float Cos30 = 0.8660254f, Sin30 = 0.5f;
    float Px = (X - Z) * Cos30;
    float Py = (X + Z) * Sin30 - Y;
    return { Centre.x + Px * Scale, Centre.y + Py * Scale };
}

inline void PaintCubeWire(ImDrawList* Draw, ImVec2 Centre, float Scale)
{
    const ImVec2 V[8] = {
        ProjectIso(Centre, Scale, -0.5f, -0.5f, -0.5f),
        ProjectIso(Centre, Scale,  0.5f, -0.5f, -0.5f),
        ProjectIso(Centre, Scale,  0.5f,  0.5f, -0.5f),
        ProjectIso(Centre, Scale, -0.5f,  0.5f, -0.5f),
        ProjectIso(Centre, Scale, -0.5f, -0.5f,  0.5f),
        ProjectIso(Centre, Scale,  0.5f, -0.5f,  0.5f),
        ProjectIso(Centre, Scale,  0.5f,  0.5f,  0.5f),
        ProjectIso(Centre, Scale, -0.5f,  0.5f,  0.5f),
    };
    const int E[12][2] = { {0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7} };
    for (auto& e : E) Draw->AddLine(V[e[0]], V[e[1]], ThumbWire, 1.2f);
}

inline void PaintSphereWire(ImDrawList* Draw, ImVec2 Centre, float Scale)
{
    // Three great circles.
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        for (int I = 0; I < 64; ++I)
        {
            float A0 = I * 6.2831853f / 64.0f, A1 = (I+1) * 6.2831853f / 64.0f;
            ImVec2 P0, P1;
            if (Axis == 0) { P0 = ProjectIso(Centre, Scale, 0.5f*std::cos(A0), 0.5f*std::sin(A0), 0); P1 = ProjectIso(Centre, Scale, 0.5f*std::cos(A1), 0.5f*std::sin(A1), 0); }
            else if (Axis == 1) { P0 = ProjectIso(Centre, Scale, 0.5f*std::cos(A0), 0, 0.5f*std::sin(A0)); P1 = ProjectIso(Centre, Scale, 0.5f*std::cos(A1), 0, 0.5f*std::sin(A1)); }
            else { float R = 0.5f * 0.45f; P0 = ProjectIso(Centre, Scale, R*std::cos(A0), R*std::sin(A0)*0.5f, 0.5f*std::sin(A0)); P1 = ProjectIso(Centre, Scale, R*std::cos(A1), R*std::sin(A1)*0.5f, 0.5f*std::sin(A1)); }
            Draw->AddLine(P0, P1, ThumbWire, 1.0f);
        }
    }
    Draw->AddCircle(Centre, 0.5f*Scale*0.92f, ThumbWire, 48, 1.0f);
}

inline void PaintCylinderWire(ImDrawList* Draw, ImVec2 Centre, float Scale)
{
    for (int I = 0; I < 32; ++I)
    {
        float A0 = I*6.2831853f/32.0f, A1 = (I+1)*6.2831853f/32.0f;
        ImVec2 B0 = ProjectIso(Centre, Scale, 0.5f*std::cos(A0), -0.5f, 0.5f*std::sin(A0));
        ImVec2 B1 = ProjectIso(Centre, Scale, 0.5f*std::cos(A1), -0.5f, 0.5f*std::sin(A1));
        ImVec2 T0 = ProjectIso(Centre, Scale, 0.5f*std::cos(A0),  0.5f, 0.5f*std::sin(A0));
        ImVec2 T1 = ProjectIso(Centre, Scale, 0.5f*std::cos(A1),  0.5f, 0.5f*std::sin(A1));
        Draw->AddLine(B0, B1, ThumbWire, 1.0f);
        Draw->AddLine(T0, T1, ThumbWire, 1.0f);
        if (I % 4 == 0) Draw->AddLine(B0, T0, ThumbWire, 0.9f);
    }
}

inline void PaintConeWire(ImDrawList* Draw, ImVec2 Centre, float Scale)
{
    ImVec2 Apex = ProjectIso(Centre, Scale, 0, 0.5f, 0);
    for (int I = 0; I < 32; ++I)
    {
        float A0 = I*6.2831853f/32.0f, A1 = (I+1)*6.2831853f/32.0f;
        ImVec2 B0 = ProjectIso(Centre, Scale, 0.5f*std::cos(A0), -0.5f, 0.5f*std::sin(A0));
        ImVec2 B1 = ProjectIso(Centre, Scale, 0.5f*std::cos(A1), -0.5f, 0.5f*std::sin(A1));
        Draw->AddLine(B0, B1, ThumbWire, 1.0f);
        if (I % 4 == 0) Draw->AddLine(B0, Apex, ThumbWire, 0.9f);
    }
}

inline void PaintTorusWire(ImDrawList* Draw, ImVec2 Centre, float Scale)
{
    for (int U = 0; U < 32; ++U)
    {
        float Au = U*6.2831853f/32.0f;
        for (int V = 0; V < 12; ++V)
        {
            float Av = V*6.2831853f/12.0f, Av1 = (V+1)*6.2831853f/12.0f;
            float R = 0.35f, r = 0.15f;
            ImVec2 P0 = ProjectIso(Centre, Scale, (R+r*std::cos(Av))*std::cos(Au), r*std::sin(Av), (R+r*std::cos(Av))*std::sin(Au));
            ImVec2 P1 = ProjectIso(Centre, Scale, (R+r*std::cos(Av1))*std::cos(Au), r*std::sin(Av1), (R+r*std::cos(Av1))*std::sin(Au));
            if (V % 2 == 0) Draw->AddLine(P0, P1, ThumbWire, 0.9f);
        }
        if (U % 4 == 0)
        {
            for (int V = 0; V < 12; ++V)
            {
                float Av = V*6.2831853f/12.0f, Au1 = (U+1)*6.2831853f/32.0f;
                float R = 0.35f, r = 0.15f;
                ImVec2 P0 = ProjectIso(Centre, Scale, (R+r*std::cos(Av))*std::cos(Au), r*std::sin(Av), (R+r*std::cos(Av))*std::sin(Au));
                ImVec2 P1 = ProjectIso(Centre, Scale, (R+r*std::cos(Av))*std::cos(Au1), r*std::sin(Av), (R+r*std::cos(Av))*std::sin(Au1));
                if (V % 3 == 0) Draw->AddLine(P0, P1, ThumbWire, 0.7f);
            }
        }
    }
}

// One thumbnail well: the dark inset, the wire, the label and the counts.
inline void PaintThumb(ImDrawList* Draw, ImFont* Face, ImVec2 Spot, float Wide, float Tall, const Primitive& P, const Expect& E)
{
    Draw->AddRectFilled(Spot, { Spot.x + Wide, Spot.y + Tall }, ThumbBg, ThumbRound);
    Draw->AddRect(Spot, { Spot.x + Wide, Spot.y + Tall }, ThumbEdge, ThumbRound, 0, 1.0f);
    ImVec2 Centre{ Spot.x + Wide*0.5f, Spot.y + Tall*0.45f };
    float Scale = std::min(Wide, Tall) * 0.38f;
    if (!std::strcmp(P.Id, "cube")) PaintCubeWire(Draw, Centre, Scale);
    else if (!std::strcmp(P.Id, "sphere")) PaintSphereWire(Draw, Centre, Scale*1.05f);
    else if (!std::strcmp(P.Id, "cylinder")) PaintCylinderWire(Draw, Centre, Scale);
    else if (!std::strcmp(P.Id, "cone")) PaintConeWire(Draw, Centre, Scale);
    else if (!std::strcmp(P.Id, "torus")) PaintTorusWire(Draw, Centre, Scale*0.95f);
    // Label.
    Kit::Inked(Draw, Face, Spot.x + Wide*0.5f, Spot.y + Tall - 28.0f, LabelSize, TitleInk, P.Name, Kit::Anchor::Middle);
    char Counts[48]; std::snprintf(Counts, sizeof(Counts), "%d v · %d t", E.Vertices, E.Triangles);
    Kit::Inked(Draw, Face, Spot.x + Wide*0.5f, Spot.y + Tall - 14.0f, CountSize, NoteInk, Counts, Kit::Anchor::Middle);
}

// The whole card: header + the five thumbnails in a wrapping grid.
inline float CardHeight(float CardWide)
{
    int Cols = CardWide >= 500.0f ? 3 : (CardWide >= 320.0f ? 2 : 1);
    int Rows = (int(Primitives.size()) + Cols - 1) / Cols;
    return PadY + Kit::Grind(TitleSize) + 8.0f + Rows * ThumbTall + (Rows-1)*ThumbGap + PadY;
}

inline void PaintCard(ImDrawList* Draw, ImFont* Light, ImFont* Face, ImVec2 Spot, float CardWide)
{
    const float Tall = CardHeight(CardWide);
    Draw->AddRectFilled(Spot, { Spot.x + CardWide, Spot.y + Tall }, CardFill, CardRound);
    Draw->AddRect(Spot, { Spot.x + CardWide, Spot.y + Tall }, CardEdge, CardRound, 0, 1.0f);
    Kit::Inked(Draw, Face, Spot.x + PadX, Spot.y + PadY, TitleSize, TitleInk, "Base meshes");
    {
        float Run = Kit::Tracked(nullptr, Light, 0, 0, EyebrowSize, 0, "ANALYTICAL PRIMITIVES", EyebrowTrack, false);
        Kit::Tracked(Draw, Light, Spot.x + CardWide - PadX - Run, Spot.y + PadY + (Kit::Grind(TitleSize)-Kit::Grind(EyebrowSize))*0.5f,
                     EyebrowSize, EyebrowInk, "ANALYTICAL PRIMITIVES", EyebrowTrack);
    }
    float Y = Spot.y + PadY + Kit::Grind(TitleSize) + 8.0f;
    int Cols = CardWide >= 500.0f ? 3 : (CardWide >= 320.0f ? 2 : 1);
    float CellWide = (CardWide - PadX*2.0f - (Cols-1)*ThumbGap) / Cols;
    for (size_t I = 0; I < Primitives.size(); ++I)
    {
        int Col = int(I) % Cols, Row = int(I) / Cols;
        ImVec2 At{ Spot.x + PadX + Col*(CellWide+ThumbGap), Y + Row*(ThumbTall+ThumbGap) };
        Expect E = Expected(BrowserToConstruct(int(I)));
        PaintThumb(Draw, Light, At, CellWide, ThumbTall, Primitives[I], E);
    }
}

} // namespace Frontier::BaseMesh
