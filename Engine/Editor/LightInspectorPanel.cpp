//============================================================================================================================================
//                                                          LIGHTINSPECTORPANEL.CPP
//============================================================================================================================================
// 📦 Native scene-emitter inspector: the approved Point, Spot, Area, Tube and LED Strip cards drawn 1:1 from the browser reference.

#include "LightInspectorPanel.h"
#include "ControlPanel.h"
#include "EditorInstance.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      REFERENCE PALETTE
//------------------------------------------------------------------------------------------------------------------------
// Values transcribed from Experimental/FrontierEditor/style.css so the native panel and the browser
// reference resolve to the same pixels rather than to a similar-looking approximation.

constexpr ImU32 Ink        = IM_COL32(223, 223, 223, 255);   // [-] .metric colour
constexpr ImU32 Heading    = IM_COL32(201, 201, 201, 255);   // [-] .card-heading
constexpr ImU32 Muted      = IM_COL32(125, 125, 125, 255);   // [-] .muted
constexpr ImU32 Faint      = IM_COL32(114, 114, 114, 255);   // [-] .range-labels
constexpr ImU32 PillInk    = IM_COL32(163, 163, 163, 255);   // [-] .small-pill text
constexpr ImU32 PillFill   = IM_COL32(47, 47, 47, 255);      // [-] .small-pill background
constexpr ImU32 PillEdge   = IM_COL32(59, 59, 59, 255);      // [-] .small-pill border
constexpr ImU32 CardTop    = IM_COL32(34, 34, 34, 255);      // [-] .card gradient start
constexpr ImU32 CardFoot   = IM_COL32(31, 31, 31, 255);      // [-] .card gradient end
constexpr ImU32 CardEdge   = IM_COL32(47, 47, 47, 255);      // [-] .card border
constexpr ImU32 Backdrop   = IM_COL32(16, 16, 16, 255);      // [-] body background
constexpr ImU32 Track      = IM_COL32(58, 58, 58, 255);      // [-] slider rail
constexpr ImU32 Knob       = IM_COL32(232, 232, 232, 255);   // [-] slider handle
constexpr ImU32 FieldFill  = IM_COL32(26, 26, 30, 255);      // [-] numeric field
constexpr ImU32 FieldEdge  = IM_COL32(55, 55, 61, 255);      // [-] numeric field border
constexpr ImU32 Lit        = IM_COL32(126, 198, 148, 255);   // [-] .status-chip.is-on
constexpr ImU32 Unlit      = IM_COL32(205, 123, 110, 255);   // [-] .status-chip.is-off
constexpr ImU32 Amber      = IM_COL32(233, 198, 123, 255);   // [-] lighting accent

constexpr float CardRadius = 18;   // [px] .card border-radius
constexpr float CardPadX   = 23;   // [px] .card horizontal padding
constexpr float CardPadY   = 22;   // [px] .card vertical padding
constexpr float CardGap    = 14;   // [px] .cards grid gap

//------------------------------------------------------------------------------------------------------------------------
//                                                     EMITTER DESCRIPTION
//------------------------------------------------------------------------------------------------------------------------

struct EmitterDescription
{
    const char* Title;        // [-] outliner and header name
    const char* Eyebrow;      // [-] uppercase kicker above the title
    const char* Lineage;      // [-] right-hand breadcrumb
    const char* OutputNote;   // [-] sentence under the flux metric
    ImU32       Accent;       // [-] card icon tint
};

const EmitterDescription& Describe(unsigned Kind)
{
    static const EmitterDescription Table[] =
    {
        {"Point Light", "OMNIDIRECTIONAL EMITTER", "Lighting / Punctual \xC2\xB7 output, reach & response",
         "Flux radiated uniformly in every direction.", IM_COL32(233, 198, 123, 255)},
        {"Spot Light", "CONE EMITTER", "Lighting / Punctual \xC2\xB7 output, cone & response",
         "Flux concentrated into the outer cone.", IM_COL32(232, 187, 134, 255)},
        {"Area Light", "RECTANGULAR EMITTER", "Lighting / Surface \xC2\xB7 output, panel & response",
         "Flux emitted from the panel into the forward hemisphere.", IM_COL32(223, 192, 143, 255)},
        {"Tube Light", "TUBULAR EMITTER", "Lighting / Surface \xC2\xB7 output, tube & response",
         "Flux emitted from the panel into the forward hemisphere.", IM_COL32(217, 196, 155, 255)},
        {"LED Strip", "LINEAR EMITTER", "Lighting / Linear \xC2\xB7 output per metre, run & response",
         "Total flux is the authored output per metre across the run.", IM_COL32(226, 207, 154, 255)},
    };
    return Table[Kind < 5 ? Kind : 0];
}

// Card accent colours, keyed in the same order the cards are drawn.
constexpr ImU32 AccentOutput       = IM_COL32(233, 198, 123, 255);
constexpr ImU32 AccentTemperature  = IM_COL32(230, 156, 121, 255);
constexpr ImU32 AccentReach        = IM_COL32(159, 183, 212, 255);
constexpr ImU32 AccentBeam         = IM_COL32(240, 189, 114, 255);
constexpr ImU32 AccentEmitter      = IM_COL32(223, 192, 143, 255);
constexpr ImU32 AccentPlacement    = IM_COL32(181, 196, 223, 255);
constexpr ImU32 AccentResponse     = IM_COL32(192, 168, 212, 255);
constexpr ImU32 AccentDistribution = IM_COL32(212, 185, 112, 255);
constexpr ImU32 AccentSupport      = IM_COL32(142, 142, 142, 255);

EditorProperty* Find(EditorSheet& Sheet, const char* Name)
{
    for (uint32_t Group = 0; Group < Sheet.GroupCount; ++Group)
    {
        for (uint32_t Slot = 0; Slot < Sheet.Groups[Group].PropertyCount; ++Slot)
        {
            if (!std::strcmp(Sheet.Groups[Group].Properties[Slot].Label, Name))
            {
                return &Sheet.Groups[Group].Properties[Slot];
            }
        }
    }
    return nullptr;
}

// Grouped thousands, matching the browser's toLocaleString('en-US').
void Grouped(char* Out, size_t Size, double Value)
{
    const long long Whole = static_cast<long long>(std::llround(Value));
    if (std::llabs(Whole) >= 1000)
    {
        std::snprintf(Out, Size, "%lld,%03lld", Whole / 1000, std::llabs(Whole % 1000));
    }
    else
    {
        std::snprintf(Out, Size, "%lld", Whole);
    }
}

const char* TemperatureName(float Kelvin)
{
    return Kelvin < 2700 ? "Candle warmth"
         : Kelvin < 3500 ? "Warm white"
         : Kelvin < 5000 ? "Neutral white"
         : Kelvin < 6500 ? "Cool white"
                         : "Daylight";
}

ImU32 TemperatureChip(float Kelvin)
{
    return Kelvin < 3000 ? IM_COL32(240, 207, 160, 255)
         : Kelvin < 4500 ? IM_COL32(239, 217, 180, 255)
         : Kelvin > 6500 ? IM_COL32(196, 216, 243, 255)
                         : IM_COL32(239, 233, 220, 255);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       DRAWING SURFACE
//------------------------------------------------------------------------------------------------------------------------

struct LightPanel
{
    ControlPanel& Controls;
    EditorSheet&  Sheet;
    ImDrawList*   Draw;
    ImVec2        Origin;
    ImFont*       Face;
    ImFont*       Display;

    ImVec2 At(float X, float Y) const { return {Origin.x + X, Origin.y + Y}; }

    void Write(float X, float Y, const char* Body, float Size = 12, ImU32 Colour = Ink) const
    {
        Draw->AddText(Face, Size, At(X, Y), Colour, Body);
    }

    float Measure(const char* Body, float Size) const
    {
        return Face->CalcTextSizeA(Size, 10000, 0, Body).x;
    }

    void WriteRight(float Right, float Y, const char* Body, float Size, ImU32 Colour) const
    {
        Write(Right - Measure(Body, Size), Y, Body, Size, Colour);
    }

    void Wrap(float X, float Y, float Width, const char* Body, float Size = 10, ImU32 Colour = Muted) const
    {
        Draw->AddText(Face, Size, At(X, Y), Colour, Body, nullptr, Width);
    }

    // .card — 125 degree gradient, hairline border, 18 px corners.
    void Card(float X, float Y, float Width, float Height, const char* Title, ImU32 Accent) const
    {
        const int First = Draw->VtxBuffer.Size;
        Draw->AddRectFilled(At(X, Y), At(X + Width, Y + Height), IM_COL32_WHITE, CardRadius);
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(
            Draw, First, Draw->VtxBuffer.Size, At(X, Y), At(X + Width * 0.42f, Y + Height), CardTop, CardFoot);
        Draw->AddRect(At(X, Y), At(X + Width, Y + Height), CardEdge, CardRadius);
        if (Title && Title[0])
        {
            // The lucide glyph is represented by its accent swatch; the heading keeps the reference wording.
            Draw->AddRectFilled(At(X + CardPadX, Y + CardPadY + 1), At(X + CardPadX + 11, Y + CardPadY + 12), Accent, 3);
            Write(X + CardPadX + 18, Y + CardPadY + 1, Title, 12, Heading);
        }
    }

    // .metric — 45 px light numeral with a 16 px unit on the baseline.
    void Metric(float X, float Y, const char* Figure, const char* Unit) const
    {
        Draw->AddText(Display, 45, At(X, Y), Ink, Figure);
        if (Unit && Unit[0])
        {
            const float Advance = Display->CalcTextSizeA(45, 10000, 0, Figure).x;
            Draw->AddText(Face, 16, At(X + Advance + 6, Y + 26), IM_COL32(125, 125, 125, 255), Unit);
        }
    }

    // .small-pill — 9 px capsule on the heading line.
    void Pill(float Right, float Y, const char* Body) const
    {
        const float Width = Measure(Body, 9) + 18;
        Draw->AddRectFilled(At(Right - Width, Y), At(Right, Y + 21), PillFill, 11);
        Draw->AddRect(At(Right - Width, Y), At(Right, Y + 21), PillEdge, 11);
        Write(Right - Width + 9, Y + 6, Body, 9, PillInk);
    }

    // .range-labels — 9 px caption pair under a track.
    void Range(float X, float Y, float Width, const char* Low, const char* High) const
    {
        Write(X, Y, Low, 9, Faint);
        WriteRight(X + Width, Y, High, 9, Faint);
    }

    // A bound slider. Returns the live figure so derived readouts cannot drift from the control.
    float Slider(float X, float Y, float Width, const char* Name, bool Bare = false, float Fallback = 0) const
    {
        EditorProperty* Bound = Find(Sheet, Name);
        if (!Bound)
        {
            return Fallback;
        }
        ImGui::PushID(Name);
        ImGui::SetCursorScreenPos(At(X, Y - 9));
        ImGui::InvisibleButton("##rail", {std::max(12.0f, Width), 20});
        if (ImGui::IsItemActive())
        {
            const float Local = ImGui::GetIO().MousePos.x - At(X, Y).x;
            const float Share = std::clamp(Local / std::max(1.0f, Width), 0.0f, 1.0f);
            Bound->Figure = std::clamp(Bound->Minimum + (Bound->Maximum - Bound->Minimum) * Share,
                                       Bound->Minimum, Bound->Maximum);
        }
        ImGui::PopID();
        const float Span  = std::max(0.00001f, Bound->Maximum - Bound->Minimum);
        const float Share = std::clamp((Bound->Figure - Bound->Minimum) / Span, 0.0f, 1.0f);
        const float HandleX = X + Share * Width;
        if (!Bare)
        {
            Draw->AddLine(At(X, Y), At(X + Width, Y), Track, 3);
            Draw->AddLine(At(X, Y), At(HandleX, Y), IM_COL32(220, 220, 220, 255), 3);
        }
        Draw->AddCircleFilled(At(HandleX, Y), 6.5f, Knob, 24);
        return Bound->Figure;
    }

    float Value(const char* Name, float Fallback) const
    {
        const EditorProperty* Bound = Find(const_cast<EditorSheet&>(Sheet), Name);
        return Bound ? Bound->Figure : Fallback;
    }

    // .volume-subheading — uppercase kicker with a right-aligned qualifier.
    void Subheading(float X, float Y, float Width, const char* Kicker, const char* Note) const
    {
        Write(X, Y, Kicker, 9, IM_COL32(150, 150, 150, 255));
        WriteRight(X + Width, Y, Note, 9, Faint);
    }

    // A labelled numeric field from .volume-fields.
    void Field(float X, float Y, float Width, const char* Label, const char* Body, const char* Unit) const
    {
        Write(X, Y, Label, 10, Muted);
        Draw->AddRectFilled(At(X, Y + 17), At(X + Width, Y + 45), FieldFill, 6);
        Draw->AddRect(At(X, Y + 17), At(X + Width, Y + 45), FieldEdge, 6);
        Write(X + 10, Y + 26, Body, 10, IM_COL32(214, 214, 214, 255));
        WriteRight(X + Width - 10, Y + 26, Unit, 9, Faint);
    }

    // A paired slider with a bold inline readout and an italic caption, from .light-cone-controls.
    void CaptionedSlider(float X, float Y, float Width, const char* Label, const char* Readout,
                         const char* Caption, const char* Bound) const
    {
        Write(X, Y, Label, 10, Muted);
        WriteRight(X + Width, Y, Readout, 11, Ink);
        Slider(X, Y + 28, Width, Bound);
        Write(X, Y + 40, Caption, 9, Faint);
    }

    // .light-support-row — a status dot and a sentence that names the real standing.
    void StatusRow(float X, float Y, float Width, bool Supported, const char* Body) const
    {
        Draw->AddCircleFilled(At(X + 4, Y + 5), 4, Supported ? Lit : Unlit, 16);
        Wrap(X + 16, Y, Width - 16, Body, 10, IM_COL32(178, 178, 178, 255));
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     PHOTOMETRIC POLAR
//------------------------------------------------------------------------------------------------------------------------
// Luminous-intensity distribution. A point source fills the sphere, a spot shows the cone with a soft
// shoulder between the inner and outer angle, and the surface emitters show the Lambertian cosine lobe.

void PhotometricPolar(const LightPanel& Panel, float X, float Y, float Width, unsigned Kind, float Inner, float Outer)
{
    const float CentreX = X + Width * 0.5f;
    const float CentreY = Y + 102;
    const float Radius  = 90;

    for (int Ring = 1; Ring <= 4; ++Ring)
    {
        Panel.Draw->AddCircle(Panel.At(CentreX, CentreY), Radius * Ring / 4.0f, IM_COL32(255, 255, 255, 11), 72, 1);
    }
    for (int Spoke = 0; Spoke < 12; ++Spoke)
    {
        const float Angle = Spoke * 3.14159265f / 6.0f;
        Panel.Draw->AddLine(Panel.At(CentreX, CentreY),
                            Panel.At(CentreX + std::sin(Angle) * Radius, CentreY + std::cos(Angle) * Radius),
                            IM_COL32(255, 255, 255, 9), 1);
    }

    // Sample the authored distribution; 0 degrees points down the beam axis, as in the reference.
    ImVec2 Lobe[129];
    int    Samples = 0;
    for (int Step = 0; Step <= 128; ++Step)
    {
        const float Degrees = -180.0f + Step * 360.0f / 128.0f;
        const float Away    = std::fabs(Degrees);
        float       Gain    = 0;
        if (Kind == 0)
        {
            Gain = 1;
        }
        else if (Kind == 1)
        {
            const float Half  = Outer * 0.5f;
            const float Core  = Inner * 0.5f;
            Gain = Away <= Core ? 1.0f
                 : Away >= Half ? 0.0f
                 : 1.0f - (Away - Core) / std::max(0.001f, Half - Core);
        }
        else
        {
            Gain = Away <= 90.0f ? std::cos(Away * 3.14159265f / 180.0f) : 0.0f;
        }
        if (Gain <= 0.0f)
        {
            continue;
        }
        const float Angle = Degrees * 3.14159265f / 180.0f;
        Lobe[Samples++] = Panel.At(CentreX + std::sin(Angle) * Radius * Gain,
                                   CentreY + std::cos(Angle) * Radius * Gain);
    }
    if (Samples >= 3)
    {
        Panel.Draw->AddConvexPolyFilled(Lobe, Samples, IM_COL32(233, 198, 123, 28));
        Panel.Draw->AddPolyline(Lobe, Samples, Amber, Kind == 0 ? ImDrawFlags_Closed : ImDrawFlags_None, 1.4f);
    }
    if (Kind != 0)
    {
        Panel.Draw->AddLine(Panel.At(CentreX, CentreY), Panel.At(Lobe[0].x - Panel.Origin.x, Lobe[0].y - Panel.Origin.y),
                            IM_COL32(233, 198, 123, 90), 1.2f);
        Panel.Draw->AddLine(Panel.At(CentreX, CentreY),
                            Panel.At(Lobe[Samples - 1].x - Panel.Origin.x, Lobe[Samples - 1].y - Panel.Origin.y),
                            IM_COL32(233, 198, 123, 90), 1.2f);
    }
    Panel.Draw->AddCircleFilled(Panel.At(CentreX, CentreY), 3, Amber, 16);
    Panel.Write(CentreX - Radius - 32, CentreY - 5, "90\xC2\xB0", 10, Faint);
    Panel.Write(CentreX + Radius + 14, CentreY - 5, "90\xC2\xB0", 10, Faint);
    Panel.Write(CentreX - 7, CentreY + Radius + 10, "0\xC2\xB0", 10, Faint);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        FALLOFF CURVE
//------------------------------------------------------------------------------------------------------------------------
// Inverse-square attenuation across the authored reach, marking the half-illuminance distance.

void FalloffCurve(const LightPanel& Panel, float X, float Y, float Width, float Reach)
{
    const float Left = X + 34, Right = X + Width - 14, Top = Y + 6, Bottom = Y + 82;
    for (int Row = 0; Row <= 2; ++Row)
    {
        const float Line = Top + Row * (Bottom - Top) / 2.0f;
        for (float Dash = Left; Dash < Right; Dash += 7)
        {
            Panel.Draw->AddLine(Panel.At(Dash, Line), Panel.At(std::min(Dash + 2, Right), Line),
                                IM_COL32(255, 255, 255, 14), 1);
        }
    }
    ImVec2 Curve[97];
    for (int Step = 0; Step <= 96; ++Step)
    {
        const float Distance    = 0.6f + Reach * Step / 96.0f;
        const float Attenuation = std::min(1.0f, 1.0f / std::max(0.36f, Distance * Distance));
        Curve[Step] = Panel.At(Left + (Right - Left) * Step / 96.0f, Bottom - Attenuation * (Bottom - Top));
    }
    Panel.Draw->AddPolyline(Curve, 97, IM_COL32(159, 183, 212, 235), ImDrawFlags_None, 1.6f);

    const float Half = 1.41421f;
    if (Half <= Reach)
    {
        const float Marker = Left + (Right - Left) * (Half - 0.6f) / std::max(0.001f, Reach);
        for (float Dash = Top; Dash < Bottom; Dash += 6)
        {
            Panel.Draw->AddLine(Panel.At(Marker, Dash), Panel.At(Marker, std::min(Dash + 3, Bottom)),
                                IM_COL32(159, 183, 212, 110), 1);
        }
        Panel.Write(Marker + 6, Top + 2, "50 % at 1.41 m", 9, Faint);
    }
    char Far[32];
    std::snprintf(Far, sizeof(Far), "%.0f m", double(Reach));
    Panel.Write(Left, Bottom + 6, "0 m", 9, Faint);
    Panel.WriteRight(Right, Bottom + 6, Far, 9, Faint);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          BEAM CONE
//------------------------------------------------------------------------------------------------------------------------
// Side elevation of the cone against a floor plane, with the lit pool drawn at the authored reach.

void BeamCone(const LightPanel& Panel, float X, float Y, float Width, float Inner, float Outer, float Reach)
{
    const float Apex   = X + Width * 0.5f;
    const float Top    = Y + 18;
    const float Floor  = Y + 150;
    const float Depth  = Floor - Top;
    const float Spread = std::tan(std::min(84.0f, Outer * 0.5f) * 3.14159265f / 180.0f) * Depth;
    const float Core   = std::tan(std::min(84.0f, Inner * 0.5f) * 3.14159265f / 180.0f) * Depth;

    Panel.Draw->AddRectFilled(Panel.At(Apex - 13, Top - 13), Panel.At(Apex + 13, Top - 2),
                              IM_COL32(60, 60, 60, 255), 3);
    const ImVec2 Outside[3] = {Panel.At(Apex, Top), Panel.At(Apex - Spread, Floor), Panel.At(Apex + Spread, Floor)};
    Panel.Draw->AddConvexPolyFilled(Outside, 3, IM_COL32(233, 198, 123, 26));
    Panel.Draw->AddLine(Outside[0], Outside[1], Amber, 1.4f);
    Panel.Draw->AddLine(Outside[0], Outside[2], Amber, 1.4f);
    const ImVec2 Inside[3] = {Panel.At(Apex, Top), Panel.At(Apex - Core, Floor), Panel.At(Apex + Core, Floor)};
    Panel.Draw->AddConvexPolyFilled(Inside, 3, IM_COL32(233, 198, 123, 34));
    for (float Dash = Top; Dash < Floor; Dash += 7)
    {
        Panel.Draw->AddLine(Panel.At(Apex, Dash), Panel.At(Apex, std::min(Dash + 3, Floor)),
                            IM_COL32(233, 198, 123, 120), 1);
    }
    Panel.Draw->AddLine(Panel.At(X + 10, Floor), Panel.At(X + Width - 10, Floor), IM_COL32(255, 255, 255, 26), 1);
    Panel.Draw->AddEllipse(Panel.At(Apex, Floor), {Spread, 11}, IM_COL32(233, 198, 123, 90), 0, 48, 1.2f);
    Panel.Draw->AddCircleFilled(Panel.At(Apex, Top), 3.5f, Amber, 16);

    char Span[40];
    std::snprintf(Span, sizeof(Span), "%.0f m reach", double(Reach));
    Panel.Write(X + 14, Floor + 10, "floor plane", 9, Faint);
    Panel.WriteRight(X + Width - 14, Floor + 10, Span, 9, Faint);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       EMITTER FIGURE
//------------------------------------------------------------------------------------------------------------------------
// Dimensioned schematic of the emitting surface for the rectangle, tube and strip.

void EmitterFigure(const LightPanel& Panel, float X, float Y, float Width, unsigned Kind,
                   float PanelWidth, float PanelHeight, float Length, float Radius)
{
    const float CentreX = X + Width * 0.5f;
    const float CentreY = Y + 52;
    char Caption[64];

    if (Kind == 2)
    {
        const float Scale = std::min(150.0f / std::max(0.05f, PanelWidth), 72.0f / std::max(0.05f, PanelHeight));
        const float HalfW = std::max(12.0f, PanelWidth * Scale * 0.5f);
        const float HalfH = std::max(8.0f, PanelHeight * Scale * 0.5f);
        Panel.Draw->AddRectFilled(Panel.At(CentreX - HalfW, CentreY - HalfH), Panel.At(CentreX + HalfW, CentreY + HalfH),
                                  IM_COL32(233, 198, 123, 36), 4);
        Panel.Draw->AddRect(Panel.At(CentreX - HalfW, CentreY - HalfH), Panel.At(CentreX + HalfW, CentreY + HalfH),
                            Amber, 4, 0, 1.4f);
        std::snprintf(Caption, sizeof(Caption), "%.2f m \xC3\x97 %.2f m", double(PanelWidth), double(PanelHeight));
    }
    else if (Kind == 3)
    {
        const float Half = std::max(18.0f, std::min(150.0f, Length * 48.0f) * 0.5f);
        const float Thick = std::max(4.0f, std::min(26.0f, Radius * 220.0f));
        Panel.Draw->AddRectFilled(Panel.At(CentreX - Half, CentreY - Thick), Panel.At(CentreX + Half, CentreY + Thick),
                                  IM_COL32(233, 198, 123, 36), Thick);
        Panel.Draw->AddRect(Panel.At(CentreX - Half, CentreY - Thick), Panel.At(CentreX + Half, CentreY + Thick),
                            Amber, Thick, 0, 1.4f);
        std::snprintf(Caption, sizeof(Caption), "%.2f m long \xC2\xB7 %.3f m radius", double(Length), double(Radius));
    }
    else
    {
        const float Half     = std::max(24.0f, std::min(160.0f, 52.0f + Length * 17.0f) * 0.5f);
        const int   Segments = std::max(4, std::min(26, int(std::lround(Length * 4))));
        Panel.Draw->AddRectFilled(Panel.At(CentreX - Half, CentreY - 9), Panel.At(CentreX + Half, CentreY + 9),
                                  IM_COL32(233, 198, 123, 26), 4);
        Panel.Draw->AddRect(Panel.At(CentreX - Half, CentreY - 9), Panel.At(CentreX + Half, CentreY + 9),
                            Amber, 4, 0, 1.3f);
        for (int Slot = 0; Slot < Segments; ++Slot)
        {
            const float Step = CentreX - Half + 7 + (Half * 2 - 14) * (Slot + 0.5f) / Segments;
            Panel.Draw->AddRectFilled(Panel.At(Step - 2.6f, CentreY - 4.5f), Panel.At(Step + 2.6f, CentreY + 4.5f),
                                      IM_COL32(243, 219, 162, 235), 1.5f);
        }
        std::snprintf(Caption, sizeof(Caption), "%.2f m \xC2\xB7 %d drawn segments", double(Length), Segments);
    }
    Panel.Draw->AddLine(Panel.At(CentreX - 60, CentreY + 32), Panel.At(CentreX + 60, CentreY + 32),
                        IM_COL32(255, 255, 255, 22), 1);
    Panel.Write(CentreX - Panel.Measure(Caption, 9) * 0.5f, CentreY + 40, Caption, 9, Faint);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     SCENE EMITTER SHEET
//------------------------------------------------------------------------------------------------------------------------

void RecordLightInspector(ControlPanel& Controls, EditorInstance&, EditorSheet& Sheet)
{
    EditorProperty* Type     = Find(Sheet, "Type");
    EditorProperty* Position = Find(Sheet, "Position");
    if (!Type || !Position)
    {
        ImGui::TextUnformatted("Light component unavailable");
        return;
    }

    // Directional stays with the Sun inspector, so the scene-emitter family starts at Point.
    const unsigned Category = Type->Picked == 0 ? 1u : std::min(Type->Picked, 5u);
    const unsigned Kind     = Category - 1;
    const bool     Spot     = Kind == 1;
    const bool     Surface  = Kind >= 2;
    const bool     Strip    = Kind == 4;

    ImGuiWindow* Current = ImGui::GetCurrentWindow();
    if (Current && Current->ParentWindow)
    {
        ImGuiWindow* Parent = Current->ParentWindow;
        Parent->DrawList->AddRectFilled(Parent->Pos,
                                        {Parent->Pos.x + Parent->Size.x, Parent->Pos.y + Parent->Size.y}, Backdrop);
    }
    ImDrawList* Background = ImGui::GetWindowDrawList();
    const ImVec2 WindowMin = ImGui::GetWindowPos();
    Background->AddRectFilled(WindowMin, {WindowMin.x + ImGui::GetWindowSize().x, WindowMin.y + ImGui::GetWindowSize().y},
                              Backdrop);

    ImFont* Face = ImGui::GetFont();
    for (ImFont* Candidate : ImGui::GetIO().Fonts->Fonts)
    {
        if (!std::strcmp(Candidate->GetDebugName(), "Sun reference / regular"))
        {
            Face = Candidate;
        }
    }
    ImGui::PushFont(Face, 14);

    ImVec2 Anchor = ImGui::GetCursorScreenPos();
    Anchor.x += 28;
    Anchor.y += 10;
    const float Width = std::max(320.0f, ImGui::GetContentRegionAvail().x - 56);
    LightPanel Panel{Controls, Sheet, ImGui::GetWindowDrawList(), Anchor, Face, Controls.QueryDisplay()};

    const EmitterDescription& Emitter = Describe(Kind);
    char Text[192];

    //----------------------------------------------------------------------------------------------------------------
    // Header
    //----------------------------------------------------------------------------------------------------------------
    Panel.Write(0, 0, Emitter.Eyebrow, 9, Faint);
    Panel.Draw->AddText(Panel.Display, 30, Panel.At(0, 14), IM_COL32(238, 238, 238, 255), Emitter.Title);

    EditorProperty* Enabled = Find(Sheet, "Enabled");
    const bool      Live    = !Enabled || Enabled->On;
    Panel.WriteRight(Width - 92, 16, "Reset", 10, Muted);
    const float PillLeft = Width - 78;
    Panel.Draw->AddRectFilled(Panel.At(PillLeft, 8), Panel.At(Width, 32), IM_COL32(38, 38, 38, 255), 12);
    Panel.Draw->AddRect(Panel.At(PillLeft, 8), Panel.At(Width, 32), IM_COL32(58, 58, 58, 255), 12);
    Panel.Draw->AddCircleFilled(Panel.At(PillLeft + 13, 20), 3.5f, Live ? Lit : Unlit, 12);
    Panel.Write(PillLeft + 22, 14, Live ? "Enabled" : "Disabled", 10, IM_COL32(205, 205, 205, 255));
    ImGui::SetCursorScreenPos(Panel.At(PillLeft, 8));
    if (ImGui::InvisibleButton("##enabled", {78, 24}) && Enabled)
    {
        Enabled->On = !Enabled->On;
    }

    Panel.Write(0, 56, "PROPERTIES", 9, Faint);
    Panel.WriteRight(Width, 56, Emitter.Lineage, 9, Faint);

    //----------------------------------------------------------------------------------------------------------------
    // Property switches
    //----------------------------------------------------------------------------------------------------------------
    struct SwitchTile { const char* Bound; const char* Caption; };
    SwitchTile Tiles[4];
    unsigned   TileCount = 0;
    Tiles[TileCount++] = {"Enabled", "Emission"};
    if (Spot)
    {
        Tiles[TileCount++] = {"Beam shape", "Beam"};
    }
    Tiles[TileCount++] = {"Cast Shadows", "Shadows"};
    if (!Surface)
    {
        Tiles[TileCount++] = {"Specular response", "Specular"};
    }

    float Cursor = 76;
    for (unsigned Slot = 0; Slot < TileCount; ++Slot)
    {
        const float TileX = Slot * 98.0f;
        EditorProperty* Bound = Find(Sheet, Tiles[Slot].Bound);
        const bool      On    = !Bound || Bound->On || Bound->Figure > 0;
        Panel.Draw->AddRectFilled(Panel.At(TileX, Cursor), Panel.At(TileX + 88, Cursor + 62), IM_COL32(32, 32, 32, 255), 13);
        Panel.Draw->AddRect(Panel.At(TileX, Cursor), Panel.At(TileX + 88, Cursor + 62), IM_COL32(52, 52, 52, 255), 13);
        const ImU32 Mark = On ? Lit : Unlit;
        Panel.Draw->AddCircle(Panel.At(TileX + 44, Cursor + 19), 10, Mark, 24, 1.4f);
        Panel.Draw->AddCircleFilled(Panel.At(TileX + 44, Cursor + 19), 4, Mark, 16);
        Panel.Write(TileX + 44 - Panel.Measure(Tiles[Slot].Caption, 10) * 0.5f, Cursor + 34, Tiles[Slot].Caption, 10,
                    IM_COL32(198, 198, 198, 255));
        Panel.Write(TileX + 44 - Panel.Measure(On ? "ON" : "OFF", 8) * 0.5f, Cursor + 48, On ? "ON" : "OFF", 8, Faint);
        ImGui::SetCursorScreenPos(Panel.At(TileX, Cursor));
        ImGui::PushID(int(Slot));
        if (ImGui::InvisibleButton("##tile", {88, 62}) && Bound && Bound->Category == EditorPropertyCategory::Switch)
        {
            Bound->On = !Bound->On;
        }
        ImGui::PopID();
    }
    Cursor += 84;

    //----------------------------------------------------------------------------------------------------------------
    // Photometry. Flux is authored; everything else is derived so the readouts cannot drift from the slider.
    //----------------------------------------------------------------------------------------------------------------
    const float Half       = (Width - CardGap) * 0.5f;
    const float Inner      = Panel.Value("Inner Cone", 30);
    const float Outer      = std::max(Inner, Panel.Value("Outer Cone", 55));
    const float Length     = Panel.Value("Width", 1.5f);
    const float PanelWidth = Panel.Value("Width", 1.2f);
    const float PanelHigh  = Panel.Value("Height", 0.6f);
    const float TubeRadius = Panel.Value("Height", 0.04f);
    const float Reach      = Panel.Value("Range", 12);
    const float Flux       = Panel.Value("Luminous flux", 1500);
    const float SolidAngle = Spot ? 2 * 3.14159265f * (1 - std::cos(Outer * 0.5f * 3.14159265f / 180.0f))
                                  : 4 * 3.14159265f;
    const float Candela     = Surface ? Flux / 3.14159265f : Flux / std::max(0.0001f, SolidAngle);
    const float Illuminance = Candela / std::max(0.0001f, Reach * Reach);
    const float PoolAcross  = 2 * Reach * std::tan(std::min(84.0f, Outer * 0.5f) * 3.14159265f / 180.0f);
    const float EmitterArea = Kind == 2 ? PanelWidth * PanelHigh
                            : Kind == 3 ? 2 * 3.14159265f * TubeRadius * Length
                                        : 0.0f;

    //----------------------------------------------------------------------------------------------------------------
    // Luminous output
    //----------------------------------------------------------------------------------------------------------------
    const float OutputHeight = 440;
    Panel.Card(0, Cursor, Width, OutputHeight, "Luminous output", AccentOutput);
    char Figure[48], Pill[48];
    Grouped(Figure, sizeof(Figure), double(Flux));
    Grouped(Pill, sizeof(Pill), double(Candela));
    std::snprintf(Text, sizeof(Text), "%s cd", Pill);
    Panel.Metric(CardPadX, Cursor + 48, Figure, "lm");
    Panel.Pill(Width - CardPadX, Cursor + 52, Text);
    Panel.Wrap(CardPadX, Cursor + 106, Width - CardPadX * 2, Emitter.OutputNote);
    PhotometricPolar(Panel, CardPadX, Cursor + 124, Width - CardPadX * 2, Kind, Inner, Outer);
    const float OutputTrack = Cursor + 348;
    Panel.Slider(CardPadX, OutputTrack, Width - CardPadX * 2, Strip ? "Flux per metre" : "Luminous flux");
    Panel.Range(CardPadX, OutputTrack + 12, Width - CardPadX * 2,
                Strip ? "100 lm/m" : "0 lm", Strip ? "3,000 lm/m" : "20,000 lm");

    const float DerivedY = Cursor + OutputHeight - 54;
    Panel.Write(CardPadX, DerivedY, "Intensity", 9, Faint);
    std::snprintf(Text, sizeof(Text), "%s cd", Pill);
    Panel.Write(CardPadX, DerivedY + 14, Text, 14, IM_COL32(222, 222, 222, 255));
    std::snprintf(Text, sizeof(Text), "At %.0f m", double(Reach));
    Panel.Write(CardPadX + (Width - CardPadX * 2) * 0.34f, DerivedY, Text, 9, Faint);
    if (Illuminance < 10)
    {
        std::snprintf(Text, sizeof(Text), "%.2f lx", double(Illuminance));
    }
    else
    {
        char Rounded[32];
        Grouped(Rounded, sizeof(Rounded), double(Illuminance));
        std::snprintf(Text, sizeof(Text), "%s lx", Rounded);
    }
    Panel.Write(CardPadX + (Width - CardPadX * 2) * 0.34f, DerivedY + 14, Text, 14, IM_COL32(222, 222, 222, 255));
    if (EmitterArea > 0)
    {
        char Nit[32];
        Grouped(Nit, sizeof(Nit), double(Flux / (3.14159265f * std::max(0.0001f, EmitterArea))));
        Panel.Write(CardPadX + (Width - CardPadX * 2) * 0.68f, DerivedY, "Luminance", 9, Faint);
        std::snprintf(Text, sizeof(Text), "%s nit", Nit);
        Panel.Write(CardPadX + (Width - CardPadX * 2) * 0.68f, DerivedY + 14, Text, 14, IM_COL32(222, 222, 222, 255));
    }
    Cursor += OutputHeight + CardGap;

    //----------------------------------------------------------------------------------------------------------------
    // Colour temperature and Reach & falloff share a row
    //----------------------------------------------------------------------------------------------------------------
    const float PairHeight = 272;
    const float Kelvin     = Panel.Value("Colour temperature", 3000);
    Panel.Card(0, Cursor, Half, PairHeight, "Colour temperature", AccentTemperature);
    Grouped(Figure, sizeof(Figure), double(Kelvin));
    Panel.Metric(CardPadX, Cursor + 48, Figure, "K");
    const float KelvinTrack = Cursor + 126;
    const float KelvinWidth = Half - CardPadX * 2;
    for (int Band = 0; Band < 64; ++Band)
    {
        const float Share = Band / 63.0f;
        const ImU32 Warm  = IM_COL32(int(224 - Share * 70), int(150 + Share * 60), int(96 + Share * 140), 255);
        Panel.Draw->AddRectFilled(Panel.At(CardPadX + KelvinWidth * Band / 64.0f, KelvinTrack - 5),
                                  Panel.At(CardPadX + KelvinWidth * (Band + 1) / 64.0f, KelvinTrack + 5), Warm);
    }
    Panel.Slider(CardPadX, KelvinTrack, KelvinWidth, "Colour temperature", true);
    Panel.Range(CardPadX, KelvinTrack + 14, KelvinWidth, "Warm", "Cool");
    Panel.Draw->AddRectFilled(Panel.At(CardPadX, Cursor + 176), Panel.At(CardPadX + 12, Cursor + 188),
                              TemperatureChip(Kelvin), 3);
    Panel.Write(CardPadX + 20, Cursor + 177, TemperatureName(Kelvin), 10, IM_COL32(186, 186, 186, 255));

    const float ReachX = Half + CardGap;
    Panel.Card(ReachX, Cursor, Half, PairHeight, "Reach & falloff", AccentReach);
    std::snprintf(Figure, sizeof(Figure), "%.0f", double(Reach));
    Panel.Metric(ReachX + CardPadX, Cursor + 48, Figure, "m");
    Panel.Pill(ReachX + Half - CardPadX, Cursor + 52, "Inverse square");
    Panel.Wrap(ReachX + CardPadX, Cursor + 106, Half - CardPadX * 2, "Distance at which the emitter stops being evaluated");
    FalloffCurve(Panel, ReachX + CardPadX, Cursor + 122, Half - CardPadX * 2, Reach);
    Panel.Slider(ReachX + CardPadX, Cursor + 234, Half - CardPadX * 2, "Range");
    Panel.Range(ReachX + CardPadX, Cursor + 246, Half - CardPadX * 2, "1 m", "80 m");
    Cursor += PairHeight + CardGap;

    //----------------------------------------------------------------------------------------------------------------
    // Beam shape — cone emitters only
    //----------------------------------------------------------------------------------------------------------------
    if (Spot)
    {
        const float BeamHeight = 388;
        Panel.Card(0, Cursor, Width, BeamHeight, "Beam shape", AccentBeam);
        std::snprintf(Figure, sizeof(Figure), "%.0f", double(Outer));
        Panel.Metric(CardPadX, Cursor + 48, Figure, "\xC2\xB0");
        std::snprintf(Text, sizeof(Text), "%.0f\xC2\xB0 hot core", double(Inner));
        Panel.Pill(Width - CardPadX, Cursor + 52, Text);
        BeamCone(Panel, CardPadX, Cursor + 96, Width - CardPadX * 2, Inner, Outer, Reach);
        const float ConeY = Cursor + 288;
        const float ConeW = (Width - CardPadX * 2 - 28) * 0.5f;
        std::snprintf(Text, sizeof(Text), "%.0f\xC2\xB0", double(Inner));
        Panel.CaptionedSlider(CardPadX, ConeY, ConeW, "Inner cone", Text, "Fully lit core", "Inner Cone");
        std::snprintf(Text, sizeof(Text), "%.0f\xC2\xB0", double(Outer));
        Panel.CaptionedSlider(CardPadX + ConeW + 28, ConeY, ConeW, "Outer cone", Text, "Edge of any light", "Outer Cone");
        std::snprintf(Text, sizeof(Text), "Pool at %.0f m", double(Reach));
        Panel.Write(CardPadX, Cursor + BeamHeight - 26, Text, 10, Muted);
        std::snprintf(Text, sizeof(Text), "%.1f m across", double(PoolAcross));
        Panel.WriteRight(Width - CardPadX, Cursor + BeamHeight - 26, Text, 10, IM_COL32(216, 216, 216, 255));
        Cursor += BeamHeight + CardGap;
    }

    //----------------------------------------------------------------------------------------------------------------
    // Emitter dimensions — surface emitters only
    //----------------------------------------------------------------------------------------------------------------
    if (Surface)
    {
        const float EmitterHeight = 268;
        Panel.Card(0, Cursor, Width, EmitterHeight, "Emitter dimensions", AccentEmitter);
        EmitterFigure(Panel, CardPadX, Cursor + 60, Width - CardPadX * 2, Kind, PanelWidth, PanelHigh, Length, TubeRadius);
        Panel.Subheading(CardPadX, Cursor + 170, Width - CardPadX * 2, "DIMENSIONS", "Metres \xC2\xB7 emitting surface");
        const float FieldW = (Width - CardPadX * 2 - 14) * 0.5f;
        char Left[32], Right[32];
        if (Kind == 2)
        {
            std::snprintf(Left, sizeof(Left), "%.2f", double(PanelWidth));
            std::snprintf(Right, sizeof(Right), "%.2f", double(PanelHigh));
            Panel.Field(CardPadX, Cursor + 190, FieldW, "Width", Left, "m");
            Panel.Field(CardPadX + FieldW + 14, Cursor + 190, FieldW, "Height", Right, "m");
        }
        else if (Kind == 3)
        {
            std::snprintf(Left, sizeof(Left), "%.2f", double(Length));
            std::snprintf(Right, sizeof(Right), "%.3f", double(TubeRadius));
            Panel.Field(CardPadX, Cursor + 190, FieldW, "Length", Left, "m");
            Panel.Field(CardPadX + FieldW + 14, Cursor + 190, FieldW, "Radius", Right, "m");
        }
        else
        {
            std::snprintf(Left, sizeof(Left), "%.2f", double(Length));
            std::snprintf(Right, sizeof(Right), "%.0f", double(Panel.Value("Flux per metre", 900)));
            Panel.Field(CardPadX, Cursor + 190, FieldW, "Run length", Left, "m");
            Panel.Field(CardPadX + FieldW + 14, Cursor + 190, FieldW, "Output", Right, "lm/m");
        }
        if (Strip)
        {
            Panel.Wrap(CardPadX, Cursor + 244, Width - CardPadX * 2,
                       "Total flux is the output per metre multiplied by the run length.");
        }
        else
        {
            std::snprintf(Text, sizeof(Text), "Emitting area %.3f m\xC2\xB2.", double(EmitterArea));
            Panel.Wrap(CardPadX, Cursor + 244, Width - CardPadX * 2, Text);
        }
        Cursor += EmitterHeight + CardGap;
    }

    //----------------------------------------------------------------------------------------------------------------
    // Placement
    //----------------------------------------------------------------------------------------------------------------
    const float PlacementHeight = Spot ? 240.0f : 148.0f;
    Panel.Card(0, Cursor, Width, PlacementHeight, "Placement", AccentPlacement);
    Panel.Subheading(CardPadX, Cursor + 58, Width - CardPadX * 2, "POSITION", "World-space centre \xC2\xB7 metres");
    const float AxisW = (Width - CardPadX * 2 - 28) / 3.0f;
    const char* AxisLabel[3] = {"Centre X", "Centre Y", "Centre Z"};
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        char Reading[32];
        std::snprintf(Reading, sizeof(Reading), "%.2f", double(Position->Axes[Axis]));
        const float AxisX = CardPadX + Axis * (AxisW + 14);
        Panel.Field(AxisX, Cursor + 78, AxisW, AxisLabel[Axis], Reading, "m");
        ImGui::SetCursorScreenPos(Panel.At(AxisX, Cursor + 95));
        ImGui::PushID(Axis + 400);
        ImGui::InvisibleButton("##axis", {AxisW, 28});
        if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left))
        {
            Position->Axes[Axis] += ImGui::GetIO().MouseDelta.x * Position->AxisStep;
        }
        ImGui::PopID();
    }
    if (Spot)
    {
        Panel.Subheading(CardPadX, Cursor + 146, Width - CardPadX * 2, "AIM", "Beam axis \xC2\xB7 degrees");
        const EditorProperty* Azimuth   = Find(Sheet, "Aim azimuth");
        const EditorProperty* Elevation = Find(Sheet, "Aim elevation");
        const float           AimW      = (Width - CardPadX * 2 - 28) * 0.5f;
        Panel.Write(CardPadX, Cursor + 170, "Azimuth", 10, Muted);
        Panel.WriteRight(CardPadX + AimW, Cursor + 170, Azimuth ? Azimuth->Text : "--", 11, Ink);
        Panel.Write(CardPadX, Cursor + 192, "Clockwise from north \xC2\xB7 owned by the placement transform", 9, Faint);
        Panel.Write(CardPadX + AimW + 28, Cursor + 170, "Elevation", 10, Muted);
        Panel.WriteRight(Width - CardPadX, Cursor + 170, Elevation ? Elevation->Text : "--", 11, Ink);
        Panel.Write(CardPadX + AimW + 28, Cursor + 192, "Negative aims at the floor", 9, Faint);
    }
    Cursor += PlacementHeight + CardGap;

    //----------------------------------------------------------------------------------------------------------------
    // Shadows & response
    //----------------------------------------------------------------------------------------------------------------
    const float ResponseHeight = 250;
    Panel.Card(0, Cursor, Width, ResponseHeight, "Shadows & response", AccentResponse);
    const float Softness = Panel.Value("Shadow softness", 28);
    std::snprintf(Figure, sizeof(Figure), "%.0f", double(Softness));
    Panel.Metric(CardPadX, Cursor + 48, Figure, "%");
    Panel.Pill(Width - CardPadX, Cursor + 52, "Penumbra width");
    Panel.Wrap(CardPadX, Cursor + 106, Width - CardPadX * 2, "Softness of the shadow edge cast by this emitter");
    Panel.Slider(CardPadX, Cursor + 136, Width - CardPadX * 2, "Shadow softness");
    Panel.Range(CardPadX, Cursor + 148, Width - CardPadX * 2, "Hard edge", "Soft gradient");
    const float ResponseY = Cursor + 182;
    const float ResponseW = (Width - CardPadX * 2 - 28) * 0.5f;
    std::snprintf(Text, sizeof(Text), "%.0f%%", double(Panel.Value("Diffuse response", 100)));
    Panel.CaptionedSlider(CardPadX, ResponseY, ResponseW, "Diffuse", Text, "Matte surface contribution",
                          "Diffuse response");
    std::snprintf(Text, sizeof(Text), "%.0f%%", double(Panel.Value("Specular response", 100)));
    Panel.CaptionedSlider(CardPadX + ResponseW + 28, ResponseY, ResponseW, "Specular", Text, "Highlight contribution",
                          "Specular response");
    Cursor += ResponseHeight + CardGap;

    //----------------------------------------------------------------------------------------------------------------
    // Luminous distribution — punctual emitters only — and the renderer support terminal card
    //----------------------------------------------------------------------------------------------------------------
    const float SupportHeight = 168;
    const float SupportWidth  = Surface ? Width : Half;
    float       SupportX      = 0;
    if (!Surface)
    {
        Panel.Card(0, Cursor, Half, SupportHeight, "Luminous distribution", AccentDistribution);
        Panel.Wrap(CardPadX, Cursor + 54, Half - CardPadX * 2, "How intensity is shaped across the emitted solid angle");
        Panel.Write(CardPadX, Cursor + 92, "Distribution", 10, Muted);
        EditorProperty* Distribution = Find(Sheet, "Distribution");
        const float     SelectX      = Half - CardPadX - 132;
        Panel.Draw->AddRectFilled(Panel.At(SelectX, Cursor + 84), Panel.At(Half - CardPadX, Cursor + 112),
                                  IM_COL32(32, 32, 36, 255), 6);
        Panel.Draw->AddRect(Panel.At(SelectX, Cursor + 84), Panel.At(Half - CardPadX, Cursor + 112), FieldEdge, 6);
        const char* Shapes[3] = {"Uniform", "IES profile", "Automotive low beam"};
        const unsigned Picked = Distribution ? std::min(Distribution->Picked, 2u) : 0u;
        Panel.Write(SelectX + 10, Cursor + 92, Shapes[Picked], 10, IM_COL32(214, 214, 214, 255));
        ImGui::SetCursorScreenPos(Panel.At(SelectX, Cursor + 84));
        if (ImGui::InvisibleButton("##distribution", {132, 28}) && Distribution)
        {
            Distribution->Picked = (Picked + 1) % 3;
        }
        const char* Note = Picked == 0 ? "Even intensity across the cone."
                         : Picked == 1 ? "Measured photometric web \xE2\x80\x94 requires an imported IES file."
                                       : "Asymmetric cut-off shaped for road lighting.";
        Panel.Wrap(CardPadX, Cursor + 128, Half - CardPadX * 2, Note, 10, IM_COL32(176, 176, 176, 255));
        SupportX = Half + CardGap;
    }

    Panel.Card(SupportX, Cursor, SupportWidth, SupportHeight, "Renderer support", AccentSupport);
    const float RowX = SupportX + CardPadX;
    const float RowW = SupportWidth - CardPadX * 2;
    Panel.StatusRow(RowX, Cursor + 56, RowW, true, "Scene record \xC2\xB7 position, output, colour and reach persist");
    Panel.StatusRow(RowX, Cursor + 78, RowW, !Surface,
                    Surface ? "Extended emitter \xE2\x80\x94 not consumed by the raster lighting kernel"
                            : "Punctual source \xE2\x80\x94 consumed by the lighting kernel");
    Panel.StatusRow(RowX, Cursor + 100, RowW, false, "No lightmap bake path exists; baked contribution is unavailable");
    Panel.Wrap(RowX, Cursor + 128, RowW,
               "Reported from the authored record. Unsupported states are labelled rather than drawn as if they worked.");
    Cursor += SupportHeight + 24;

    ImGui::SetCursorScreenPos(Panel.At(0, Cursor));
    ImGui::Dummy({Width, 1});
    ImGui::PopFont();
}

} // namespace Frontier
