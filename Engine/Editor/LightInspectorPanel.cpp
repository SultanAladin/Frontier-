//==============================================================================================================================================
//                                                          LIGHTINSPECTORPANEL.CPP
//==============================================================================================================================================
// 📦 Native light inspector converted from InspectorDepot/panels/lights.js and panels/advancedLights.js — hero, rail, duo, photometry and aim.

#include "LightInspectorPanel.h"
#include "LightDepotSurface.h"

namespace Frontier
{
using namespace Depot;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       EMITTER KINDS
//------------------------------------------------------------------------------------------------------------------------
// world.js names five lighting types. The engine's Type selector offers six; Directional has no counterpart
//    in the reference, so it reads out through the isotropic branch that fits it, and Strip is a tube run.

constexpr const char* DEG = "\u00b0";   // the reference writes angles with a degree sign, not the word

enum class EmitterKind : unsigned { Point = 0, Spot, Ies, Area, Tube };

struct EmitterSpecification
{
    const char* Label;       // [-] world.js label
    float       Tint[3];     // [-] the type's default emission colour
};

const EmitterSpecification& Describe(EmitterKind Kind)
{
    static const EmitterSpecification Family[] = {
        {"Point Light",      {1.000f, 0.851f, 0.627f}},   // #ffd9a0
        {"Spot Light",       {0.910f, 0.941f, 1.000f}},   // #e8f0ff
        {"IES / Automotive", {1.000f, 0.949f, 0.812f}},   // #fff2cf
        {"Rect Area Light",  {1.000f, 0.945f, 0.839f}},   // #fff1d6
        {"Tube Light",       {0.910f, 0.949f, 1.000f}},   // #e8f2ff
    };
    return Family[static_cast<unsigned>(Kind)];
}

// lights.js — luxAt(I, d, decay) = I / max(1, d) ^ decay
float LuxAt(float Intensity, float Distance, float Decay)
{
    return Intensity / std::pow(std::max(1.0f, Distance), Decay);
}

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

//------------------------------------------------------------------------------------------------------------------------
//                                                       PANEL SURFACE
//------------------------------------------------------------------------------------------------------------------------
// One cursor walks down the column. Every emitter mirrors a DOM element from the reference and advances the
//    cursor by that element's box: .mpanel adds a 10 px gap, and a .pcard adds its own 10 px bottom margin.

struct DepotPanel
{
    ControlPanel& Controls;
    EditorSheet&  Sheet;
    ImDrawList*   Draw;
    ImVec2        Origin;
    float         Wide;
    ImFont*       Face;
    ImFont*       Display;
    float         Walk = 0;

    ImVec2 At(float X, float Y) const { return {Origin.x + X, Origin.y + Y}; }

    void Advance(float High, bool Card) { Walk += High + StackGap + (Card ? CardSkirt : 0.0f); }

    //  Text ---------------------------------------------------------------------------------------------

    void Plain(float X, float Top, const char* Body, float Size, ImU32 Colour) const
    {
        Draw->AddText(Face, Size, At(X, Top), Colour, Body);
    }

    float PlainWide(const char* Body, float Size) const
    {
        return Face->CalcTextSizeA(Size, 10000, 0, Body).x;
    }

    void Caps(float X, float Top, const char* Body, float Size, ImU32 Colour, float Tracking) const
    {
        TrackedText(Draw, Face, Size, At(X, Top), Colour, Body, Tracking, true);
    }

    float CapsWide(const char* Body, float Size, float Tracking) const
    {
        return TrackedWide(Face, Size, Body, Tracking, true);
    }

    // canvas fillText anchors on the baseline; ImGui anchors on the line-box top.
    void Baseline(float X, float Base, const char* Body, float Size, ImU32 Colour) const
    {
        Draw->AddText(Face, Size, At(X, Base - Size * BaselineShare), Colour, Body);
    }

    void BaselineMid(float Centre, float Base, const char* Body, float Size, ImU32 Colour) const
    {
        Baseline(Centre - PlainWide(Body, Size) * 0.5f, Base, Body, Size, Colour);
    }

    void BaselineRight(float Right, float Base, const char* Body, float Size, ImU32 Colour) const
    {
        Baseline(Right - PlainWide(Body, Size), Base, Body, Size, Colour);
    }

    //  Boxes --------------------------------------------------------------------------------------------

    // .pcard — --inset ground, 18 px corners, 12/14/14 padding. Returns the content left edge.
    float Pcard(float High) const
    {
        Draw->AddRectFilled(At(0, Walk), At(Wide, Walk + High), InsetFill, InsetRadius);
        return CardPadX;
    }

    // .mp-hero — the one card with its own ground and a real border, clipped to its corners.
    void Hero(float High) const
    {
        Draw->AddRectFilled(At(0, Walk), At(Wide, Walk + High), HeroFill, InsetRadius);
        Draw->AddRect(At(0, Walk), At(Wide, Walk + High), StrokeStrong, InsetRadius);
    }

    // .mp-cap — the caption band, gradient-backed, pinned to the foot of a hero.
    void HeroCaption(float High, const char* Title, const char* Sub, const char* Right, bool SubCaps) const
    {
        const float Foot = Walk + High;
        const float Band = 48;
        const int   First = Draw->VtxBuffer.Size;
        Draw->AddRectFilled(At(0, Foot - Band), At(Wide, Foot), IM_COL32_WHITE);
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(Draw, First, Draw->VtxBuffer.Size,
                                                      At(0, Foot - Band), At(0, Foot),
                                                      Blend(HeroFill, 0.0f), Blend(HeroFill, 0.88f));
        Plain(12, Foot - 40, Title, 15, Text);
        if (SubCaps)
        {
            Caps(12, Foot - 20, Sub, 9, TextFaint, 1.3f);
        }
        else
        {
            Plain(12, Foot - 20, Sub, 9, TextFaint);
        }
        if (Right && Right[0])
        {
            const float Span = CapsWide(Right, 9.5f, 0.7f);
            Caps(Wide - 12 - Span, Foot - 20, Right, 9.5f, TextDim, 0.7f);
        }
    }

    //  Rail and duo -------------------------------------------------------------------------------------

    // .mp-rail — three 1fr pills and one 1.25fr pill, 5 px gaps, capsule corners.
    static constexpr float RailHigh = 44;

    void Rail(const char* const Keys[4], const char* const Figures[4], const char* const Units[4]) const
    {
        const float Unit = (Wide - 15) / 4.25f;
        float Left = 0;
        for (int Slot = 0; Slot < 4; ++Slot)
        {
            const float Span = Slot == 3 ? Unit * 1.25f : Unit;
            Draw->AddRectFilled(At(Left, Walk), At(Left + Span, Walk + RailHigh), PanelFill, RailHigh * 0.5f);
            Draw->AddRect(At(Left, Walk), At(Left + Span, Walk + RailHigh), Stroke, RailHigh * 0.5f);
            Plain(Left + 9, Walk + 7, Figures[Slot], 14, Text);
            if (Units[Slot] && Units[Slot][0])
            {
                const float Advance = PlainWide(Figures[Slot], 14);
                TrackedText(Draw, Face, 9.5f, At(Left + 9 + Advance + 2, Walk + 13), TextDim, Units[Slot], 0.4f, false);
            }
            Caps(Left + 9, Walk + 25, Keys[Slot], 9, TextFaint, 1.1f);
            Left += Span + 5;
        }
    }

    // .mp-duo — two .pcard.mp-stat tiles: a status chip, a sentence, and a right-set numeral.
    static constexpr float DuoHigh = 71;

    void Duo(const char* LeftLabel, const char* LeftFigure, const char* LeftUnit,
             const char* RightLabel, const char* RightFigure, const char* RightUnit) const
    {
        const float Span = (Wide - 10) * 0.5f;
        const char* Labels[2]  = {LeftLabel, RightLabel};
        const char* Figures[2] = {LeftFigure, RightFigure};
        const char* Units[2]   = {LeftUnit, RightUnit};
        for (int Slot = 0; Slot < 2; ++Slot)
        {
            const float Left = Slot * (Span + 10);
            Draw->AddRectFilled(At(Left, Walk), At(Left + Span, Walk + DuoHigh), InsetFill, InsetRadius);
            Draw->AddRectFilled(At(Left + 13, Walk + 11), At(Left + 32, Walk + 30), Blend(Ok, 0.13f), 7);
            Draw->AddCircleFilled(At(Left + 22.5f, Walk + 20.5f), 3.2f, Ok, 16);
            Plain(Left + 13, Walk + 47, Labels[Slot], 11, TextDim);
            const float UnitWide = Units[Slot] && Units[Slot][0] ? PlainWide(Units[Slot], 11) + 2 : 0;
            const float Right    = Left + Span - 13;
            Plain(Right - UnitWide - PlainWide(Figures[Slot], 25), Walk + 36, Figures[Slot], 25, Text);
            if (UnitWide > 0)
            {
                Plain(Right - UnitWide + 2, Walk + 48, Units[Slot], 11, TextDim);
            }
        }
    }

    //  Card internals -----------------------------------------------------------------------------------

    // .mp-chead — a 15 px title over a 9.5 px tracked kicker, 8 px of air beneath.
    static constexpr float CheadHigh = 30 + 8;

    void Chead(float Y, const char* Title, const char* Sub) const
    {
        Plain(CardPadX, Y, Title, 15, Text);
        Caps(CardPadX, Y + 19, Sub, 9.5f, TextFaint, 0.9f);
    }

    // .mp-num — the big light numeral with its decimals dropped back a shade and its unit as a footnote.
    static constexpr float NumHigh = 2 + 46 + 6;

    void Numeral(float Y, const char* Whole, const char* Decimal, const char* Unit) const
    {
        Draw->AddText(Display, 46, At(CardPadX, Y + 2), Text, Whole);
        float Pen = CardPadX + Display->CalcTextSizeA(46, 10000, 0, Whole).x;
        if (Decimal && Decimal[0])
        {
            Draw->AddText(Display, 46, At(Pen, Y + 2), TextFaint, Decimal);
            Pen += Display->CalcTextSizeA(46, 10000, 0, Decimal).x;
        }
        Plain(Pen + 7, Y + 32, Unit, 12, TextDim);
    }

    // .mp-k.mp-target — a tracked caption with a sentence-case value beside it.
    static constexpr float TargetHigh = 13;

    void Target(float Y, const char* Key, const char* Value) const
    {
        Caps(CardPadX, Y, Key, 9.5f, TextFaint, 1.3f);
        Plain(CardPadX + CapsWide(Key, 9.5f, 1.3f) + 6, Y - 1, Value, 11, TextDim);
    }

    // .mp-note — the card note: 10 px, faint, sentence case, 2 px of air above it.
    static constexpr float NoteHigh = 14;

    void Note(float Y, const char* Body) const
    {
        Draw->AddText(Face, 10, At(CardPadX + 2, Y + 2), TextFaint, Body, nullptr, Wide - CardPadX * 2 - 4);
    }

    // .mp-subhead — the 9 px tracked divider between vector blocks.
    static constexpr float SubheadHigh = 10 + 11 + 4;

    void Subhead(float Y, const char* Key) const
    {
        Caps(CardPadX, Y + 10, Key, 9, TextFaint, 1.3f);
    }

    //  Controls -----------------------------------------------------------------------------------------

    // .step — a 20 px nudge either side of a black type-in field.
    void Stepper(float Right, float Top, const char* Figure, const char* Unit, float FieldWide) const
    {
        const float Inked = PlainWide(Figure, 12.5f) + (Unit && Unit[0] ? PlainWide(Unit, 9) + 3 : 0);
        const float Pad   = std::clamp((FieldWide - Inked) * 0.5f, 3.0f, 8.0f);
        const float FieldLeft = Right - 20 - 4 - FieldWide;
        Draw->AddRectFilled(At(FieldLeft - 4 - 20, Top), At(FieldLeft - 4, Top + 20), RaisedFill, 7);
        Draw->AddRect(At(FieldLeft - 4 - 20, Top), At(FieldLeft - 4, Top + 20), Stroke, 7);
        Plain(FieldLeft - 4 - 13, Top + 4, "-", 12, TextDim);
        Draw->AddRectFilled(At(FieldLeft, Top), At(FieldLeft + FieldWide, Top + 20), FieldFill, 9);
        Draw->AddRect(At(FieldLeft, Top), At(FieldLeft + FieldWide, Top + 20), Stroke, 9);
        const float UnitWide = Unit && Unit[0] ? PlainWide(Unit, 9) + 3 : 0;
        Draw->PushClipRect(At(FieldLeft + 2, Top), At(FieldLeft + FieldWide - 2, Top + 20), true);
        Plain(FieldLeft + FieldWide - Pad - UnitWide - PlainWide(Figure, 12.5f), Top + 3, Figure, 12.5f, Text);
        if (UnitWide > 0)
        {
            Plain(FieldLeft + FieldWide - Pad - UnitWide + 3, Top + 6, Unit, 9, TextDim);
        }
        Draw->PopClipRect();
        Draw->AddRectFilled(At(Right - 20, Top), At(Right, Top + 20), RaisedFill, 7);
        Draw->AddRect(At(Right - 20, Top), At(Right, Top + 20), Stroke, 7);
        Plain(Right - 13, Top + 4, "+", 12, TextDim);
    }

    // controls.js tape — a ruler with the range written on it, ticks you can count, and a marker on the value.
    //    Forty-one ticks, long every tenth, lit up to the value. 8 px pad, the baseline 11 px off the foot.
    static constexpr float TapeHigh = 10 + 12 + 1 + 30 + 12;

    float Tape(float Y, const char* Label, EditorProperty* Bound, float Fallback, float Low, float High,
               int Decimals, const char* Unit, const char* const Marks[3], const float MarkAt[3], int MarkCount) const
    {
        const float Left = CardPadX, Span = Wide - CardPadX * 2;
        float Figure = Bound ? Bound->Figure : Fallback;
        const float Floor = Bound ? Bound->Minimum : Low, Ceiling = Bound ? Bound->Maximum : High;

        if (Bound)
        {
            ImGui::PushID(Label);
            ImGui::SetCursorScreenPos(At(Left, Y + 23));
            ImGui::InvisibleButton("##tape", {std::max(12.0f, Span), 30});
            if (ImGui::IsItemActive())
            {
                const float Local = ImGui::GetIO().MousePos.x - At(Left + 8, 0).x;
                const float Share = std::clamp(Local / std::max(1.0f, Span - 16), 0.0f, 1.0f);
                Bound->Figure = Floor + Share * (Ceiling - Floor);
                Figure = Bound->Figure;
            }
            ImGui::PopID();
        }

        Caps(Left, Y + 10, Label, 9.5f, TextFaint, 1.3f);
        char Reading[32];
        Fixed(Reading, sizeof(Reading), Figure, Decimals);
        Stepper(Left + Span, Y + 7, Reading, Unit, 58);

        const float Top  = Y + 23;
        const float Pad  = 8, Ruler = Span - Pad * 2, Base = Top + 30 - 11;
        const float Share = std::clamp((Figure - Floor) / std::max(0.00001f, Ceiling - Floor), 0.0f, 1.0f);
        for (int Tick = 0; Tick <= 40; ++Tick)
        {
            const float Stop  = static_cast<float>(Tick) / 40.0f;
            const bool  Major = Tick % 10 == 0;
            const bool  Lit   = Stop <= Share;
            const ImU32 Ink   = Major ? IM_COL32(255, 255, 255, 77)
                                      : IM_COL32(255, 255, 255, Lit ? 56 : 23);
            const float Long  = Major ? 9.0f : (Tick % 5 == 0 ? 6.0f : 4.0f);
            const float X     = Left + Pad + Stop * Ruler;
            Draw->AddLine(At(X, Base - Long), At(X, Base), Ink, 1);
        }
        Draw->AddLine(At(Left + Pad, Base + 0.5f), At(Left + Pad + Ruler, Base + 0.5f), IM_COL32(255, 255, 255, 26), 1);

        // A tape with no named marks still writes its range on itself, at both ends.
        char LowLabel[24], HighLabel[24];
        Fixed(LowLabel, sizeof(LowLabel), Floor, Decimals);
        Fixed(HighLabel, sizeof(HighLabel), Ceiling, Decimals);
        const char* const Ends[2] = {LowLabel, HighLabel};
        const float       EndAt[2] = {0.0f, 1.0f};
        const char* const* Written = MarkCount > 0 ? Marks : Ends;
        const float*       WrittenAt = MarkCount > 0 ? MarkAt : EndAt;
        const int          WrittenCount = MarkCount > 0 ? MarkCount : 2;
        for (int Slot = 0; Slot < WrittenCount; ++Slot)
        {
            const float X = Left + Pad + WrittenAt[Slot] * Ruler;
            const float Measure = PlainWide(Written[Slot], 8);
            const float Anchor = WrittenAt[Slot] <= 0 ? X : WrittenAt[Slot] >= 1 ? X - Measure : X - Measure * 0.5f;
            Baseline(Anchor, Top + 30 - 1, Written[Slot], 8, IM_COL32(255, 255, 255, 71));
        }

        const float Mark = Left + Pad + Share * Ruler;
        Draw->AddTriangleFilled(At(Mark, Base - 13), At(Mark + 4, Base - 19), At(Mark - 4, Base - 19), IM_COL32_WHITE);
        Draw->AddLine(At(Mark, Base - 12), At(Mark, Base), IM_COL32(255, 255, 255, 217), 1.4f);
        return Figure;
    }

    // .li-steppers / .al-steppers — three axis cells across, each a black capsule with its letter above.
    static constexpr float AxisHigh = 6 + 10 + 4 + 20 + 6 + 8;

    void AxisRow(float Y, EditorProperty* Bound, const float Fallback[3], const char* Unit) const
    {
        const float Span = (Wide - CardPadX * 2 - 10) / 3.0f;
        for (int Axis = 0; Axis < 3; ++Axis)
        {
            const float Left = CardPadX + Axis * (Span + 5);
            Draw->AddRectFilled(At(Left, Y), At(Left + Span, Y + AxisHigh - 8), FieldFill, 11);
            Draw->AddRect(At(Left, Y), At(Left + Span, Y + AxisHigh - 8), Stroke, 11);
            Caps(Left + 6, Y + 6, Axis == 0 ? "X" : Axis == 1 ? "Y" : "Z", 8, TextFaint, 1.0f);
            char Reading[32];
            Fixed(Reading, sizeof(Reading), Bound ? Bound->Axes[Axis] : Fallback[Axis], 2);
            Stepper(Left + Span - 6, Y + 20, Reading, Axis == 0 ? Unit : "", Span - 12 - 48);
        }
    }

    // .mp-tags — state pills: a 7 px dot that goes green when the state is on, and a tracked word.
    static constexpr float TagsHigh = 8 + 20 + 2;

    void Tags(float Y, const char* const Labels[], const bool States[], int Count) const
    {
        float Left = CardPadX;
        for (int Slot = 0; Slot < Count; ++Slot)
        {
            const float Body = CapsWide(Labels[Slot], 8.5f, 1.2f);
            const float Span = 9 + 7 + 5 + Body + 9;
            if (Left + Span > Wide - CardPadX && Left > CardPadX)
            {
                Left = CardPadX;
                Y += 25;
            }
            Draw->AddRectFilled(At(Left, Y + 8), At(Left + Span, Y + 28), States[Slot] ? InsetFill : IM_COL32(0, 0, 0, 0), 10);
            Draw->AddRect(At(Left, Y + 8), At(Left + Span, Y + 28), States[Slot] ? StrokeStrong : Stroke, 10);
            if (States[Slot])
            {
                Draw->AddCircleFilled(At(Left + 12.5f, Y + 18), 5.5f, Blend(Ok, 0.35f), 18);
            }
            Draw->AddCircleFilled(At(Left + 12.5f, Y + 18), 3.5f, States[Slot] ? Ok : TextFaint, 14);
            Caps(Left + 21, Y + 13, Labels[Slot], 8.5f, States[Slot] ? Text : TextFaint, 1.2f);
            Left += Span + 5;
        }
    }

    // .mp-meter — a black instrument well with a tracked heading and a canvas under it.
    void Meter(float Y, float CanvasHigh, const char* Head) const
    {
        const float Left = CardPadX, Span = Wide - CardPadX * 2;
        const float High = 2 + 19 + CanvasHigh;
        Draw->AddRectFilled(At(Left, Y + 2), At(Left + Span, Y + 2 + High), FieldFill, InsetRadius);
        Draw->AddRect(At(Left, Y + 2), At(Left + Span, Y + 2 + High), Stroke, InsetRadius);
        Caps(Left + 9, Y + 10, Head, 8.5f, TextFaint, 1.1f);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      PHOTOMETRIC HERO
//------------------------------------------------------------------------------------------------------------------------
// lights.js paintHero. A point source lays concentric falloff discs with reach rings over them; a spot lays
//    the lit wedge with a dashed inner cone at angle * (1 - penumbra). Both carry the glow and corner readouts.

void HeroSurface(const DepotPanel& Panel, float Top, float High, bool Spot,
                 const float Tint[3], float Intensity, float Reach, float Angle, float Penumbra, float Decay)
{
    ImDrawList* Draw = Panel.Draw;
    const float Wide = Panel.Wide;
    Draw->PushClipRect(Panel.At(0, Top), Panel.At(Wide, Top + High), true);
    Draw->AddRectFilled(Panel.At(0, Top), Panel.At(Wide, Top + High), PlotFill);

    const float CentreX = Spot ? Wide * 0.22f : Wide * 0.5f;
    const float CentreY = Top + (Spot ? High * 0.5f : High * 0.47f);

    if (Spot)
    {
        const float Half = Angle * Pi / 360.0f;
        const float Reachable = Wide * 0.65f;
        const float Rise = std::tan(Half) * Reachable;
        // The lit wedge: a linear wash from the apex out to the rim, capped by a quadratic bulge.
        const int First = Draw->VtxBuffer.Size;
        Draw->PathLineTo(Panel.At(CentreX, CentreY));
        Draw->PathLineTo(Panel.At(Wide - 10, CentreY - Rise));
        Draw->PathBezierQuadraticCurveTo(Panel.At(Wide - 3, CentreY), Panel.At(Wide - 10, CentreY + Rise), 18);
        Draw->PathFillConvex(IM_COL32_WHITE);
        ShadeAcross(Draw, First, Draw->VtxBuffer.Size, Panel.At(CentreX, 0).x, Panel.At(Wide, 0).x,
                    FromBytes(Tint, 0.65f), FromBytes(Tint, 0.03f));
        const float Inner = Half * (1 - Penumbra);
        const float InnerRise = std::tan(Inner) * Reachable;
        DashedLine(Draw, Panel.At(CentreX, CentreY), Panel.At(Wide - 10, CentreY - InnerRise), IM_COL32(255, 255, 255, 71), 3, 3);
        DashedLine(Draw, Panel.At(CentreX, CentreY), Panel.At(Wide - 10, CentreY + InnerRise), IM_COL32(255, 255, 255, 71), 3, 3);
        Draw->AddLine(Panel.At(CentreX, CentreY), Panel.At(Wide - 10, CentreY - Rise), IM_COL32(255, 255, 255, 166), 1);
        Draw->AddLine(Panel.At(CentreX, CentreY), Panel.At(Wide - 10, CentreY + Rise), IM_COL32(255, 255, 255, 166), 1);
    }
    else
    {
        for (float Ring = 70; Ring > 4; Ring -= 3)
        {
            const float Distance = Ring / 70.0f * Reach;
            const float Alpha = std::clamp(LuxAt(Intensity, Distance, Decay) / std::max(1.0f, Intensity), 0.0f, 1.0f) * 0.35f;
            Draw->AddCircleFilled(Panel.At(CentreX, CentreY), Ring, FromBytes(Tint, Alpha), 64);
        }
        const float Fractions[] = {0.25f, 0.5f, 0.75f, 1.0f};
        for (float Share : Fractions)
        {
            Draw->AddCircle(Panel.At(CentreX, CentreY), 70 * Share, IM_COL32(255, 255, 255, 28), 64, 1.0f);
            if (Share == 0.5f || Share == 1.0f)
            {
                char Legend[24];
                std::snprintf(Legend, sizeof(Legend), "%d m", static_cast<int>(std::lround(Reach * Share)));
                Panel.Baseline(CentreX + 70 * Share + 3, CentreY - 4, Legend, 8, IM_COL32(255, 255, 255, 77));
            }
        }
    }

    GlowWash(Draw, Panel.At(CentreX, CentreY), 16, FromBytes(Tint, 0.9f));

    char Reading[32];
    std::snprintf(Reading, sizeof(Reading), "%.*f cd", Spot ? 0 : 1, Intensity);
    Panel.Baseline(8, Top + 13, Spot ? "0° AXIS" : "ISOTROPIC 360°", 8, IM_COL32(255, 255, 255, 82));
    Panel.BaselineRight(Wide - 8, Top + 13, Reading, 8, IM_COL32(255, 255, 255, 82));
    Draw->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      PHOTOMETRY CURVE
//------------------------------------------------------------------------------------------------------------------------
// lights.js paintCurve. Illuminance against distance on a log vertical, the area under it washed in the
//    emission colour, quartile rules dashed behind, and a white dot marking the five-metre reading.

void PhotometryCurve(const DepotPanel& Panel, float Left, float Top, float Wide, float High,
                     const float Tint[3], float Intensity, float Reach, float Decay, bool Spot)
{
    ImDrawList* Draw = Panel.Draw;
    Draw->PushClipRect(Panel.At(Left, Top), Panel.At(Left + Wide, Top + High), true);
    const float Pad = 8, Rim = 31, Head = 8, Foot = 17;
    const float Ceiling = std::max(1.0f, Intensity);
    const float Furthest = Spot ? 30.0f : Reach;
    auto AtX = [&](float Distance) { return Left + Pad + Distance / std::max(Furthest, 10.0f) * (Wide - Pad - Rim); };
    auto AtY = [&](float Lux)
    {
        const float Share = std::clamp(std::log10(Lux + 0.01f) / std::log10(Ceiling + 0.01f), 0.0f, 1.0f);
        return Top + Head + (1 - Share) * (High - Head - Foot);
    };

    const float Quartiles[] = {0.25f, 0.5f, 0.75f, 1.0f};
    for (float Share : Quartiles)
    {
        const float Y = Top + Head + (1 - Share) * (High - Head - Foot);
        DashedLine(Draw, Panel.At(Left + Pad, Y), Panel.At(Left + Wide - Rim, Y), IM_COL32(255, 255, 255, 18), 2, 5);
    }

    const float Step = 0.3f;
    Draw->PathClear();
    for (float Distance = 1; Distance <= Furthest; Distance += Step)
    {
        Draw->PathLineTo(Panel.At(AtX(Distance), AtY(LuxAt(Intensity, Distance, Decay))));
    }
    Draw->PathLineTo(Panel.At(AtX(Furthest), Top + High - Foot));
    Draw->PathLineTo(Panel.At(AtX(1), Top + High - Foot));
    Draw->PathFillConcave(FromBytes(Tint, 0.22f));

    Draw->PathClear();
    for (float Distance = 1; Distance <= Furthest; Distance += Step)
    {
        Draw->PathLineTo(Panel.At(AtX(Distance), AtY(LuxAt(Intensity, Distance, Decay))));
    }
    Draw->PathStroke(IM_COL32(255, 255, 255, 230), 1.0f);

    const float Stops[] = {1, 5, 10, Furthest};
    for (int Slot = 0; Slot < 4; ++Slot)
    {
        char Legend[24];
        if (Slot == 3)
        {
            std::snprintf(Legend, sizeof(Legend), "%.0f m", Stops[3]);
            Panel.BaselineRight(AtX(Stops[3]), Top + High - 3, Legend, 8, IM_COL32(255, 255, 255, 71));
        }
        else
        {
            std::snprintf(Legend, sizeof(Legend), "%.0f", Stops[Slot]);
            if (Slot == 0)
            {
                Panel.Baseline(AtX(Stops[0]), Top + High - 3, Legend, 8, IM_COL32(255, 255, 255, 71));
            }
            else
            {
                Panel.BaselineMid(AtX(Stops[Slot]), Top + High - 3, Legend, 8, IM_COL32(255, 255, 255, 71));
            }
        }
    }
    Draw->AddCircleFilled(Panel.At(AtX(5), AtY(LuxAt(Intensity, 5, Decay))), 3, IM_COL32_WHITE, 20);
    Draw->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         AIM PLAN
//------------------------------------------------------------------------------------------------------------------------
// lights.js paintAim. A twenty-metre world plan: an eight-by-eight grid with the centre lines brighter, the
//    source as a filled dot in its emission colour, and for a spot the throw line out to the target.

void AimPlan(const DepotPanel& Panel, float Left, float Top, float Wide, float High,
             const float Tint[3], const float Source[3], const float Target[3], bool Spot)
{
    ImDrawList* Draw = Panel.Draw;
    Draw->PushClipRect(Panel.At(Left, Top), Panel.At(Left + Wide, Top + High), true);
    Draw->AddRectFilled(Panel.At(Left, Top), Panel.At(Left + Wide, Top + High), PlotFill);
    const float CentreX = Left + Wide * 0.5f, CentreY = Top + High * 0.5f;
    const float Span = std::min(Wide, High) - 20;
    for (int Step = -4; Step <= 4; ++Step)
    {
        const ImU32 Ink = Step ? IM_COL32(255, 255, 255, 15) : IM_COL32(255, 255, 255, 46);
        Draw->AddLine(Panel.At(CentreX + Step * Span / 8, Top + 10),
                      Panel.At(CentreX + Step * Span / 8, Top + High - 10), Ink, 1);
        Draw->AddLine(Panel.At(CentreX - Span / 2, CentreY + Step * Span / 8),
                      Panel.At(CentreX + Span / 2, CentreY + Step * Span / 8), Ink, 1);
    }
    auto Plot = [&](const float World[3])
    {
        return ImVec2{CentreX + std::clamp(World[0] / 20.0f, -1.0f, 1.0f) * Span / 2,
                      CentreY + std::clamp(World[2] / 20.0f, -1.0f, 1.0f) * Span / 2};
    };
    const ImVec2 Here = Plot(Source), There = Plot(Target);
    if (Spot)
    {
        Draw->AddLine(Panel.At(Here.x, Here.y), Panel.At(There.x, There.y), FromBytes(Tint, 0.75f), 1);
        Draw->AddCircleFilled(Panel.At(There.x, There.y), 4, IM_COL32_WHITE, 20);
    }
    Draw->AddCircleFilled(Panel.At(Here.x, Here.y), 6, FromBytes(Tint, 1.0f), 24);
    Draw->AddCircle(Panel.At(Here.x, Here.y), 9, IM_COL32_WHITE, 28, 1.0f);
    Draw->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SHAPED EMITTER HERO
//------------------------------------------------------------------------------------------------------------------------
// advancedLights.js paintHero. An area light draws its aperture with floor ellipses under it; a tube draws a
//    bloomed capsule; an IES lamp rasters its candela field over the H-V plane with the profile shaping it.

void EmitterHero(const DepotPanel& Panel, float Top, float High, EmitterKind Kind, const float Tint[3],
                 float Width, float Height, float Length, float Radius, float Cone, float Cutoff,
                 float Multiplier, unsigned Profile)
{
    ImDrawList* Draw = Panel.Draw;
    const float Wide = Panel.Wide;
    Draw->PushClipRect(Panel.At(0, Top), Panel.At(Wide, Top + High), true);
    Draw->AddRectFilled(Panel.At(0, Top), Panel.At(Wide, Top + High), EmitterFill);
    const float CentreX = Wide * 0.5f, CentreY = Top + High * 0.44f;

    if (Kind == EmitterKind::Ies)
    {
        const float Half = Cone * Pi / 360.0f, Pitch = Cutoff * Pi / 180.0f;
        const bool  Low  = Profile == 0 || Profile == 1;
        for (float Y = Top + 8; Y < Top + High - 25; Y += 3)
        {
            for (float X = 4; X < Wide - 4; X += 3)
            {
                const float Nx = (X - CentreX) / (Wide * 0.47f), Ny = (Y - CentreY) / (High * 0.42f);
                const float Bearing = std::atan2(Ny, Nx), Reach = std::sqrt(Nx * Nx + Ny * Ny);
                float Beam = std::fabs(Bearing - Pitch) < Half
                           ? std::exp(-Reach * Reach * (Profile == 2 ? 6.0f : 2.2f)) : 0.0f;
                if (Low && Ny < -0.04f) { Beam *= 0.06f; }
                if (Profile == 3)       { Beam *= std::exp(-Ny * Ny * 18.0f); }
                if (Profile == 4)       { Beam = 0.18f * std::exp(-Reach * Reach * 1.3f); }
                if (Beam > 0.004f)
                {
                    Draw->AddRectFilled(Panel.At(X, Y), Panel.At(X + 3.2f, Y + 3.2f), FromBytes(Tint, Beam * 0.58f * Multiplier));
                }
            }
        }
        Draw->AddLine(Panel.At(CentreX, CentreY), Panel.At(Wide - 8, CentreY - std::tan(Half - Pitch) * (Wide * 0.47f)),
                      IM_COL32(255, 255, 255, 140), 1);
        Draw->AddLine(Panel.At(CentreX, CentreY), Panel.At(Wide - 8, CentreY + std::tan(Half + Pitch) * (Wide * 0.47f)),
                      IM_COL32(255, 255, 255, 140), 1);
        DashedLine(Draw, Panel.At(8, CentreY), Panel.At(Wide - 8, CentreY), IM_COL32(255, 255, 255, 64), 3, 3);
        Panel.Baseline(8, Top + 13, "H-V PHOTOMETRIC PLANE", 8, IM_COL32(255, 255, 255, 97));
    }
    else if (Kind == EmitterKind::Area)
    {
        const float Across = std::clamp(Width / 20.0f, 0.0f, 1.0f) * (Wide * 0.65f) + 25;
        const float Down   = std::clamp(Height / 20.0f, 0.0f, 1.0f) * (High * 0.55f) + 14;
        const float Left = CentreX - Across / 2, Head = CentreY - Down / 2;
        Draw->PushClipRect(Panel.At(Left, Head), Panel.At(Left + Across, Head + Down), true);
        RadialWash(Draw, Panel.At(CentreX, CentreY), std::max(Across, Down), FromBytes(Tint, 0.95f), FromBytes(Tint, 0.22f), 30);
        Draw->PopClipRect();
        Draw->AddRect(Panel.At(Left + 0.5f, Head + 0.5f), Panel.At(Left + Across - 0.5f, Head + Down - 0.5f), IM_COL32_WHITE, 0.0f, 1.0f);
        for (int Hoop = 1; Hoop < 4; ++Hoop)
        {
            Draw->AddEllipse(Panel.At(CentreX, CentreY + Down / 2), {Across * 0.3f * Hoop, Down * 0.16f * Hoop},
                             IM_COL32(255, 255, 255, 31), 0.0f, 48, 1.0f);
        }
    }
    else
    {
        const float Run = std::clamp(Length / 20.0f, 0.0f, 1.0f) * (Wide * 0.72f) + 30;
        const float Thick = std::clamp(Radius, 0.01f, 1.0f) * 12 + 2;
        const float Left = CentreX - Run / 2;
        // shadowBlur 22 around the capsule, laid in as widening translucent skirts.
        for (int Skirt = 6; Skirt >= 1; --Skirt)
        {
            const float Grow = Skirt * 3.6f;
            Draw->AddRectFilled(Panel.At(Left - Grow, CentreY - Thick - Grow), Panel.At(Left + Run + Grow, CentreY + Thick + Grow),
                                FromBytes(Tint, 0.07f), Thick + Grow);
        }
        const int First = Draw->VtxBuffer.Size;
        Draw->AddRectFilled(Panel.At(Left, CentreY - Thick), Panel.At(Left + Run, CentreY + Thick), IM_COL32_WHITE);
        ShadeAcross(Draw, First, Draw->VtxBuffer.Size, Panel.At(Left, 0).x, Panel.At(Left + Run * 0.15f, 0).x,
                    FromBytes(Tint, 0.25f), FromBytes(Tint, 0.95f));
        Draw->AddRect(Panel.At(Left, CentreY - Thick), Panel.At(Left + Run, CentreY + Thick), IM_COL32(255, 255, 255, 204), 0.0f, 1.0f);
    }
    Draw->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DISTRIBUTION SURFACE
//------------------------------------------------------------------------------------------------------------------------
// advancedLights.js paintDist. An IES lamp sweeps its candela fan from -80 to +80 degrees over three range
//    rings; an area or tube emitter states its aperture as an aspect bar with the ratio written under it.

void DistributionSurface(const DepotPanel& Panel, float Left, float Top, float Wide, float High,
                         EmitterKind Kind, const float Tint[3], float Width, float Height, float Length,
                         float Radius, float Multiplier, unsigned Profile)
{
    ImDrawList* Draw = Panel.Draw;
    Draw->PushClipRect(Panel.At(Left, Top), Panel.At(Left + Wide, Top + High), true);
    Draw->AddRectFilled(Panel.At(Left, Top), Panel.At(Left + Wide, Top + High), PlotFill);
    const float CentreX = Left + Wide * 0.5f, CentreY = Top + High * 0.5f;

    if (Kind == EmitterKind::Ies)
    {
        const bool Low = Profile == 0 || Profile == 1;
        for (float Bearing = -80; Bearing <= 80; Bearing += 2)
        {
            const float Peak = Low
                ? std::exp(-std::pow((Bearing - 8) / 25.0f, 2.0f)) * (Bearing > -2 ? 1.0f : 0.16f)
                : std::exp(-std::pow(Bearing / (Profile == 2 ? 12.0f : 35.0f), 2.0f));
            const float Reach = 8 + Peak * 45 * Multiplier;
            const float Theta = (Bearing - 90) * Pi / 180.0f;
            Draw->AddLine(Panel.At(CentreX, CentreY),
                          Panel.At(CentreX + std::cos(Theta) * Reach, CentreY + std::sin(Theta) * Reach),
                          FromBytes(Tint, 0.18f + Peak * 0.65f), 1);
        }
        const float Rings[] = {15, 30, 45};
        for (float Ring : Rings)
        {
            Draw->AddCircle(Panel.At(CentreX, CentreY), Ring, IM_COL32(255, 255, 255, 38), 48, 1.0f);
        }
        Panel.Baseline(Left + 6, CentreY, "LEFT", 8, IM_COL32(255, 255, 255, 77));
        Panel.BaselineRight(Left + Wide - 6, CentreY, "RIGHT", 8, IM_COL32(255, 255, 255, 77));
    }
    else
    {
        const float Aspect = Kind == EmitterKind::Area ? Width / std::max(0.0001f, Height)
                                                       : Length / std::max(0.02f, Radius * 2);
        const float Held = std::clamp(Aspect, 1.0f, 12.0f);
        Draw->AddRectFilled(Panel.At(CentreX - Held * 8, CentreY - 9), Panel.At(CentreX + Held * 8, CentreY + 9),
                            FromBytes(Tint, 0.5f));
        Draw->AddRect(Panel.At(CentreX - Held * 8, CentreY - 9), Panel.At(CentreX + Held * 8, CentreY + 9),
                      IM_COL32_WHITE, 0.0f, 1.0f);
        char Legend[32];
        std::snprintf(Legend, sizeof(Legend), "%.1f : 1 ASPECT", Aspect);
        Panel.BaselineMid(CentreX, Top + High - 7, Legend, 8, IM_COL32(255, 255, 255, 77));
    }
    Draw->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      PROPERTY BINDING
//------------------------------------------------------------------------------------------------------------------------
// The panel asks for the reference's own property names. Where the feed has not published one yet the
//    reference default stands in, so a card always reads as the browser draws it rather than as a blank.

struct Reading
{
    EditorProperty* Bound = nullptr;
    float           Figure = 0;
};

Reading Pick(EditorSheet& Sheet, const char* Name, float Fallback)
{
    EditorProperty* Bound = Find(Sheet, Name);
    return {Bound, Bound ? Bound->Figure : Fallback};
}

bool Flag(EditorSheet& Sheet, const char* Name, bool Fallback)
{
    const EditorProperty* Bound = Find(Sheet, Name);
    return Bound ? Bound->On : Fallback;
}

void Vector(EditorSheet& Sheet, const char* Name, const float Fallback[3], float Out[3])
{
    const EditorProperty* Bound = Find(Sheet, Name);
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        Out[Axis] = Bound ? Bound->Axes[Axis] : Fallback[Axis];
    }
}

} // namespace

//==============================================================================================================================================
//                                                           LIGHT INSPECTOR
//==============================================================================================================================================

void RecordLightInspector(ControlPanel& Controls, EditorInstance&, EditorSheet& Sheet)
{
    ImDrawList* Draw = ImGui::GetWindowDrawList();
    const ImVec2 Origin = ImGui::GetCursorScreenPos();
    const float  Wide   = std::max(240.0f, ImGui::GetContentRegionAvail().x);
    ImFont* Face    = Controls.QueryUi();
    ImFont* Display = Controls.QueryDisplay() ? Controls.QueryDisplay() : Face;
    if (!Face)
    {
        return;
    }

    DepotPanel Panel{Controls, Sheet, Draw, Origin, Wide, Face, Display, 0.0f};

    //  Which of the reference's five emitters this sheet is ------------------------------------------------
    const EditorProperty* Type = Find(Sheet, "Type");
    const EditorProperty* Shape = Find(Sheet, "Distribution");
    const unsigned Category = Type ? Type->Picked : 1u;
    EmitterKind Kind = EmitterKind::Point;
    switch (Category)
    {
    case 2:  Kind = (Shape && Shape->Picked > 0) ? EmitterKind::Ies : EmitterKind::Spot; break;
    case 3:  Kind = EmitterKind::Area; break;
    case 4:
    case 5:  Kind = EmitterKind::Tube; break;
    default: Kind = EmitterKind::Point; break;
    }
    const bool Spot     = Kind == EmitterKind::Spot;
    const bool Advanced = Kind == EmitterKind::Ies || Kind == EmitterKind::Area || Kind == EmitterKind::Tube;
    const EmitterSpecification& Spec = Describe(Kind);

    float Tint[3] = {Spec.Tint[0], Spec.Tint[1], Spec.Tint[2]};
    if (const EditorProperty* Colour = Find(Sheet, "Emission colour"))
    {
        Tint[0] = Colour->ColourTint[0];
        Tint[1] = Colour->ColourTint[1];
        Tint[2] = Colour->ColourTint[2];
    }

    char Line[64], Alt[64], Third[64];

    if (!Advanced)
    {
        //  lights.js --------------------------------------------------------------------------------------
        const Reading Intensity = Pick(Sheet, "Intensity", Spot ? 62.0f : 14.0f);
        const Reading Reach     = Pick(Sheet, "Reach", 26.0f);
        const Reading Angle     = Pick(Sheet, "Cone angle", 26.0f);
        const Reading Penumbra  = Pick(Sheet, "Penumbra", 0.42f);
        const Reading Decay     = Pick(Sheet, "Decay exponent", 2.0f);
        const float   Falloff   = Spot ? 2.0f : Decay.Figure;
        const float   SourceDefault[3] = {0, Spot ? 6.0f : 2.0f, 0};
        const float   TargetDefault[3] = {0, 0, 0};
        float Source[3], Target[3];
        Vector(Sheet, "Position", SourceDefault, Source);
        Vector(Sheet, "Target", TargetDefault, Target);
        const float Exposure = LuxAt(Intensity.Figure, 5, Falloff);

        //  hero
        const float HeroHigh = 172;
        Panel.Hero(HeroHigh);
        HeroSurface(Panel, Panel.Walk, HeroHigh, Spot, Tint, Intensity.Figure, Reach.Figure,
                    Angle.Figure, Penumbra.Figure, Decay.Figure);
        std::snprintf(Line, sizeof(Line), Spot ? "%.1f° cone" : "%.0f m reach", Spot ? Angle.Figure : Reach.Figure);
        Panel.HeroCaption(HeroHigh, Spec.Label, "Photometric distribution", Line, true);
        Panel.Advance(HeroHigh, true);

        //  rail
        char RailOne[24], RailTwo[24], RailThree[24], RailFour[24];
        Fixed(RailOne, sizeof(RailOne), Intensity.Figure, Spot ? 0 : 1);
        Fixed(RailTwo, sizeof(RailTwo), Intensity.Figure, 0);
        Fixed(RailThree, sizeof(RailThree), LuxAt(Intensity.Figure, 10, Falloff), 2);
        Fixed(RailFour, sizeof(RailFour), Spot ? Angle.Figure : Decay.Figure, 1);
        const char* RailKeys[4]    = {"Intensity", "At 1 m", "At 10 m", Spot ? "Cone" : "Decay"};
        const char* RailFigures[4] = {RailOne, RailTwo, RailThree, RailFour};
        const char* RailUnits[4]   = {"cd", "lx", "lx", Spot ? DEG : "n"};
        Panel.Rail(RailKeys, RailFigures, RailUnits);
        Panel.Advance(DepotPanel::RailHigh, false);

        //  duo
        Fixed(Line, sizeof(Line), Exposure, 2);
        Fixed(Alt, sizeof(Alt), Spot ? 2 * 5 * std::tan(Angle.Figure * Pi / 360.0f) : Reach.Figure, Spot ? 1 : 0);
        Panel.Duo("Exposure at 5 m", Line, "lx", Spot ? "Pool at 5 m" : "Reach limit", Alt, "m");
        Panel.Advance(DepotPanel::DuoHigh, true);

        //  photometry
        {
            const float ChartHigh = 112;
            const float High = CardPadTop + DepotPanel::CheadHigh + DepotPanel::NumHigh + DepotPanel::TargetHigh
                             + 2 + ChartHigh + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, "Photometry", "Illuminance over distance");
            Y += DepotPanel::CheadHigh;
            const int Whole = static_cast<int>(std::floor(Exposure));
            std::snprintf(Line, sizeof(Line), "%d", Whole);
            std::snprintf(Alt, sizeof(Alt), ".%d", static_cast<int>(std::lround(Exposure * 10)) % 10);
            Panel.Numeral(Y, Line, Alt, "lx");
            Y += DepotPanel::NumHigh;
            Panel.Target(Y, "At five metres", "inverse power law");
            Y += DepotPanel::TargetHigh + 2;
            PhotometryCurve(Panel, CardPadX - 4, Y, Wide - CardPadX * 2 + 8, ChartHigh,
                            Tint, Intensity.Figure, Reach.Figure, Falloff, Spot);
            Panel.Advance(High, true);
        }

        //  output
        {
            const float High = CardPadTop + DepotPanel::CheadHigh + DepotPanel::TapeHigh * 3
                             + DepotPanel::SubheadHigh + DepotPanel::TagsHigh + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, "Output", "Distribution · attenuation");
            Y += DepotPanel::CheadHigh;

            const char* IntensityMarks[3] = {"OFF", Spot ? "KEY 62" : "POINT 14", Spot ? "200 cd" : "60 cd"};
            const float IntensityAt[3] = {0.0f, Spot ? 0.31f : 0.233f, 1.0f};
            Panel.Tape(Y, "Intensity", Intensity.Bound, Intensity.Figure, 0, Spot ? 200.0f : 60.0f,
                       Spot ? 0 : 1, "cd", IntensityMarks, IntensityAt, 3);
            Y += DepotPanel::TapeHigh;

            if (Spot)
            {
                const char* ConeMarks[3] = {"PIN 2°", "SPOT 26°", "FLOOD 80°"};
                const float ConeAt[3] = {0.0f, 0.308f, 1.0f};
                Panel.Tape(Y, "Cone angle", Angle.Bound, Angle.Figure, 2, 80, 1, DEG, ConeMarks, ConeAt, 3);
                Y += DepotPanel::TapeHigh;
                const char* SoftMarks[3] = {"HARD", "SOFT .42", "FEATHER"};
                const float SoftAt[3] = {0.0f, 0.42f, 1.0f};
                Panel.Tape(Y, "Penumbra", Penumbra.Bound, Penumbra.Figure, 0, 1, 2, "", SoftMarks, SoftAt, 3);
            }
            else
            {
                const char* ReachMarks[3] = {"1 m", "26 m", "120 m"};
                const float ReachAt[3] = {0.0f, 0.21f, 1.0f};
                Panel.Tape(Y, "Reach", Reach.Bound, Reach.Figure, 1, 120, 0, "m", ReachMarks, ReachAt, 3);
                Y += DepotPanel::TapeHigh;
                const char* DecayMarks[3] = {"NONE", "PHYSICAL 2", "4"};
                const float DecayAt[3] = {0.0f, 0.5f, 1.0f};
                Panel.Tape(Y, "Decay exponent", Decay.Bound, Decay.Figure, 0, 4, 2, "", DecayMarks, DecayAt, 3);
            }
            Y += DepotPanel::TapeHigh;

            Panel.Subhead(Y, "emission colour");
            Draw->AddRectFilled(Panel.At(Wide - CardPadX - 34, Y + 7), Panel.At(Wide - CardPadX, Y + 25),
                                FromBytes(Tint, 1.0f), 9);
            Draw->AddRect(Panel.At(Wide - CardPadX - 34, Y + 7), Panel.At(Wide - CardPadX, Y + 25), Stroke, 9);
            Y += DepotPanel::SubheadHigh;

            const char* TagLabels[2] = {"CAST SHADOWS", Spot ? "DRAW CONE" : "SHOW GLOW"};
            const bool  TagStates[2] = {Flag(Sheet, "Cast Shadows", Spot),
                                        Flag(Sheet, Spot ? "Draw cone" : "Show glow", true)};
            Panel.Tags(Y, TagLabels, TagStates, 2);
            Panel.Advance(High, true);
        }

        //  placement and aim
        {
            const float PlanHigh = 118;
            const float VectorHigh = DepotPanel::SubheadHigh + DepotPanel::AxisHigh;
            const float High = CardPadTop + DepotPanel::CheadHigh + 2 + 19 + PlanHigh + 10
                             + VectorHigh * (Spot ? 2 : 1) + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, Spot ? "Aim" : "Placement",
                        Spot ? "World coordinates · source to target" : "World coordinates");
            Y += DepotPanel::CheadHigh;
            Panel.Meter(Y, PlanHigh, "world plan · ±20 m");
            AimPlan(Panel, CardPadX, Y + 21, Wide - CardPadX * 2, PlanHigh, Tint, Source, Target, Spot);
            Y += 2 + 19 + PlanHigh + 10;
            Panel.Subhead(Y, "position");
            Panel.AxisRow(Y + DepotPanel::SubheadHigh, Find(Sheet, "Position"), SourceDefault, "m");
            Y += VectorHigh;
            if (Spot)
            {
                Panel.Subhead(Y, "target");
                Panel.AxisRow(Y + DepotPanel::SubheadHigh, Find(Sheet, "Target"), TargetDefault, "m");
            }
            Panel.Advance(High, true);
        }
    }
    else
    {
        //  advancedLights.js ------------------------------------------------------------------------------
        const bool Ies = Kind == EmitterKind::Ies, Area = Kind == EmitterKind::Area;
        const Reading Flux   = Pick(Sheet, "Luminous flux", Ies ? 1650.0f : Area ? 2400.0f : 1800.0f);
        const Reading Width  = Pick(Sheet, "Width", 2.0f);
        const Reading Height = Pick(Sheet, "Height", 1.0f);
        const Reading Length = Pick(Sheet, "Length", 1.5f);
        const Reading Radius = Pick(Sheet, "Tube radius", 0.04f);
        const Reading Spread = Pick(Sheet, "Beam spread", 120.0f);
        const Reading Cone   = Pick(Sheet, "Field angle", 58.0f);
        const Reading Cutoff = Pick(Sheet, "Cut-off pitch", -1.0f);
        const Reading Boost  = Pick(Sheet, "Profile multiplier", 1.0f);
        const Reading Span   = Pick(Sheet, "Photometric range", 120.0f);
        const Reading Throw  = Pick(Sheet, "Reach", 24.0f);
        const Reading Kelvin = Pick(Sheet, "Colour temperature", Ies ? 4300.0f : 5600.0f);
        const float   Range  = Ies ? Span.Figure : Area ? 80.0f : Throw.Figure;
        const EditorProperty* ProfileBound = Find(Sheet, "Distribution");
        const unsigned Profile = ProfileBound && ProfileBound->Picked > 0 ? ProfileBound->Picked - 1 : 0;
        static const char* ProfileNames[6] = {"ECE Low Beam", "SAE Low Beam", "High Beam",
                                              "Fog Lamp", "Parking Lamp", "Custom .IES"};
        const float SourceDefault[3] = {0, Ies ? 1.0f : 3.0f, 0};
        const float AimDefault[3]    = {0, Ies ? 0.6f : 0.0f, Ies ? -12.0f : 0.0f};
        float Source[3], Aim[3];
        Vector(Sheet, "Position", SourceDefault, Source);
        Vector(Sheet, Kind == EmitterKind::Tube ? "Rotation" : "Target", AimDefault, Aim);

        const float Peak = Ies ? Flux.Figure * Boost.Figure * 1.8f
                               : Flux.Figure / (Area ? std::max(0.1f, Width.Figure * Height.Figure)
                                                     : std::max(0.1f, Length.Figure)) * 0.45f;

        //  hero
        const float HeroHigh = 174;
        Panel.Hero(HeroHigh);
        EmitterHero(Panel, Panel.Walk, HeroHigh, Kind, Tint, Width.Figure, Height.Figure, Length.Figure,
                    Radius.Figure, Cone.Figure, Cutoff.Figure, Boost.Figure, Profile);
        if (Ies)
        {
            std::snprintf(Alt, sizeof(Alt), "%s · %.0f K", ProfileNames[Profile], Kelvin.Figure);
        }
        else if (Area)
        {
            std::snprintf(Alt, sizeof(Alt), "%.1f × %.1f m emitter", Width.Figure, Height.Figure);
        }
        else
        {
            std::snprintf(Alt, sizeof(Alt), "%.2f m luminous tube", Length.Figure);
        }
        std::snprintf(Line, sizeof(Line), "%.0f lm", Flux.Figure);
        Panel.HeroCaption(HeroHigh, Spec.Label, Alt, Line, false);
        Panel.Advance(HeroHigh, true);

        //  rail
        char RailOne[24], RailTwo[24], RailThree[24], RailFour[24];
        Fixed(RailOne, sizeof(RailOne), Flux.Figure, 0);
        Fixed(RailTwo, sizeof(RailTwo), Peak, 0);
        Fixed(RailThree, sizeof(RailThree), std::min(160.0f, 70 + (Area ? 4300.0f : Kelvin.Figure) / 100.0f), 0);
        Fixed(RailFour, sizeof(RailFour), Range, 0);
        const char* RailKeys[4]    = {"Flux", "Peak cd", "Efficacy", "Range"};
        const char* RailFigures[4] = {RailOne, RailTwo, RailThree, RailFour};
        const char* RailUnits[4]   = {"lm", "cd", "", "m"};
        Panel.Rail(RailKeys, RailFigures, RailUnits);
        Panel.Advance(DepotPanel::RailHigh, false);

        //  distribution
        {
            const float ChartHigh = 118;
            const float TagRows = Ies ? 2 * 25.0f + 10 : 0.0f;
            const float High = CardPadTop + DepotPanel::CheadHigh + DepotPanel::NumHigh + DepotPanel::TargetHigh
                             + 2 + ChartHigh + TagRows + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, Ies ? "IES distribution" : "Emitter geometry",
                        Ies ? "Candela map · homologation view" : "Luminous aperture · projected solid angle");
            Y += DepotPanel::CheadHigh;
            std::snprintf(Line, sizeof(Line), "%d", static_cast<int>(std::floor(Flux.Figure)));
            Panel.Numeral(Y, Line, "", "lm");
            Y += DepotPanel::NumHigh;
            if (Ies)
            {
                std::snprintf(Third, sizeof(Third), "%s · %.2f×", ProfileNames[Profile], Boost.Figure);
            }
            else if (Area)
            {
                std::snprintf(Third, sizeof(Third), "%.2f × %.2f m aperture", Width.Figure, Height.Figure);
            }
            else
            {
                std::snprintf(Third, sizeof(Third), "%.2f m line source", Length.Figure);
            }
            Panel.Target(Y, "Luminous flux", Third);
            Y += DepotPanel::TargetHigh + 2;
            DistributionSurface(Panel, CardPadX - 4, Y, Wide - CardPadX * 2 + 8, ChartHigh, Kind, Tint,
                                Width.Figure, Height.Figure, Length.Figure, Radius.Figure, Boost.Figure, Profile);
            Y += ChartHigh;
            if (Ies)
            {
                bool Chosen[6];
                for (int Slot = 0; Slot < 6; ++Slot)
                {
                    Chosen[Slot] = static_cast<unsigned>(Slot) == Profile;
                }
                Panel.Tags(Y, ProfileNames, Chosen, 6);
            }
            Panel.Advance(High, true);
        }

        //  photometric output
        {
            const int   TapeCount = 1 + (Ies ? 4 : 3) + (Area ? 0 : 1);
            const float TagRows   = Area ? 25.0f : 0.0f;
            const float High = CardPadTop + DepotPanel::CheadHigh + DepotPanel::TapeHigh * TapeCount
                             + DepotPanel::SubheadHigh + DepotPanel::TagsHigh + TagRows + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, "Photometric output", "Calibrated source values");
            Y += DepotPanel::CheadHigh;

            const char* FluxMarks[3] = {"OFF", Ies ? "ECE 1 650" : "NOMINAL", "MAX"};
            const float FluxAt[3] = {0.0f, Ies ? 0.206f : Area ? 0.12f : 0.15f, 1.0f};
            Panel.Tape(Y, "Luminous flux", Flux.Bound, Flux.Figure, 0, Ies ? 8000.0f : Area ? 20000.0f : 12000.0f,
                       0, "lm", FluxMarks, FluxAt, 3);
            Y += DepotPanel::TapeHigh;

            if (Ies)
            {
                const char* BoostMarks[3] = {"OFF", "1×", "4×"};
                const float BoostAt[3] = {0.0f, 0.25f, 1.0f};
                Panel.Tape(Y, "Profile multiplier", Boost.Bound, Boost.Figure, 0, 4, 2, "×", BoostMarks, BoostAt, 3);
                Y += DepotPanel::TapeHigh;
                const char* SpanMarks[3] = {"1 m", "120 m", "250 m"};
                const float SpanAt[3] = {0.0f, 0.48f, 1.0f};
                Panel.Tape(Y, "Photometric range", Span.Bound, Span.Figure, 1, 250, 0, "m", SpanMarks, SpanAt, 3);
                Y += DepotPanel::TapeHigh;
                const char* FieldMarks[3] = {"5°", "58°", "100°"};
                const float FieldAt[3] = {0.0f, 0.558f, 1.0f};
                Panel.Tape(Y, "Field angle", Cone.Bound, Cone.Figure, 5, 100, 1, DEG, FieldMarks, FieldAt, 3);
                Y += DepotPanel::TapeHigh;
                const char* PitchMarks[3] = {"−5°", "ECE −1°", "+5°"};
                const float PitchAt[3] = {0.0f, 0.4f, 1.0f};
                Panel.Tape(Y, "Cut-off pitch", Cutoff.Bound, Cutoff.Figure, -5, 5, 1, DEG, PitchMarks, PitchAt, 3);
                Y += DepotPanel::TapeHigh;
            }
            else if (Area)
            {
                Panel.Tape(Y, "Width", Width.Bound, Width.Figure, 0.1f, 20, 2, "m", nullptr, nullptr, 0);
                Y += DepotPanel::TapeHigh;
                Panel.Tape(Y, "Height", Height.Bound, Height.Figure, 0.1f, 20, 2, "m", nullptr, nullptr, 0);
                Y += DepotPanel::TapeHigh;
                const char* SpreadMarks[3] = {"1°", "120°", "180°"};
                const float SpreadAt[3] = {0.0f, 0.665f, 1.0f};
                Panel.Tape(Y, "Beam spread", Spread.Bound, Spread.Figure, 1, 180, 0, DEG, SpreadMarks, SpreadAt, 3);
                Y += DepotPanel::TapeHigh;
            }
            else
            {
                Panel.Tape(Y, "Length", Length.Bound, Length.Figure, 0.1f, 20, 2, "m", nullptr, nullptr, 0);
                Y += DepotPanel::TapeHigh;
                Panel.Tape(Y, "Tube radius", Radius.Bound, Radius.Figure, 0.01f, 1, 2, "m", nullptr, nullptr, 0);
                Y += DepotPanel::TapeHigh;
                Panel.Tape(Y, "Reach", Throw.Bound, Throw.Figure, 1, 120, 0, "m", nullptr, nullptr, 0);
                Y += DepotPanel::TapeHigh;
            }

            if (!Area)
            {
                const char* KelvinMarks[3] = {"1800 K", "4300 K", "12000 K"};
                const float KelvinAt[3] = {0.0f, 0.245f, 1.0f};
                Panel.Tape(Y, "Colour temperature", Kelvin.Bound, Kelvin.Figure, 1800, 12000, 0, "K",
                           KelvinMarks, KelvinAt, 3);
                Y += DepotPanel::TapeHigh;
            }

            Panel.Subhead(Y, "emission colour");
            Draw->AddRectFilled(Panel.At(Wide - CardPadX - 34, Y + 7), Panel.At(Wide - CardPadX, Y + 25),
                                FromBytes(Tint, 1.0f), 9);
            Draw->AddRect(Panel.At(Wide - CardPadX - 34, Y + 7), Panel.At(Wide - CardPadX, Y + 25), Stroke, 9);
            Y += DepotPanel::SubheadHigh;

            const char* TagLabels[3] = {"CAST SHADOWS", Ies ? "DRAW DISTRIBUTION" : "DRAW EMITTER", "TWO SIDED"};
            const bool  TagStates[3] = {Flag(Sheet, "Cast Shadows", !Area),
                                        Flag(Sheet, Ies ? "Draw distribution" : "Draw emitter", true),
                                        Flag(Sheet, "Two sided", false)};
            Panel.Tags(Y, TagLabels, TagStates, Area ? 3 : 2);
            Panel.Advance(High, true);
        }

        //  mounting
        {
            const float VectorHigh = DepotPanel::SubheadHigh + DepotPanel::AxisHigh;
            const float High = CardPadTop + DepotPanel::CheadHigh + VectorHigh * 2 + CardPadFoot;
            Panel.Pcard(High);
            float Y = Panel.Walk + CardPadTop;
            Panel.Chead(Y, "Mounting", "World transform · optical axis");
            Y += DepotPanel::CheadHigh;
            Panel.Subhead(Y, "position");
            Panel.AxisRow(Y + DepotPanel::SubheadHigh, Find(Sheet, "Position"), SourceDefault, "m");
            Y += VectorHigh;
            const bool Tube = Kind == EmitterKind::Tube;
            Panel.Subhead(Y, Tube ? "rotation" : "target");
            Panel.AxisRow(Y + DepotPanel::SubheadHigh, Find(Sheet, Tube ? "Rotation" : "Target"), AimDefault,
                          Tube ? "" : "m");
            Panel.Advance(High, true);
        }
    }

    // Every tape parks an InvisibleButton at its own screen position, so the cursor has wandered. Put it
    //    back before claiming the column, or the panel reserves its height twice over.
    ImGui::SetCursorScreenPos(Origin);
    ImGui::Dummy({Wide, Panel.Walk});
}

} // namespace Frontier
