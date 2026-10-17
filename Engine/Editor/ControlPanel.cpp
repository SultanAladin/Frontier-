//============================================================================================================================================
//                                                    CONTROLPANEL.CPP
//============================================================================================================================================
// 🧩 Development editor controls — the hand-drawn widgets of the property sheet.

#include "ControlPanel.h"
#include <imgui_internal.h>   // ImGuiWindow: the SkipItems early-out

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace Frontier {

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                          TOKENS
//------------------------------------------------------------------------------------------------------------------------

constexpr ImU32 kField     = IM_COL32(0, 0, 0, 255);      // the pill shell
constexpr ImU32 kInset     = IM_COL32(26, 26, 26, 255);     // the card seat
constexpr ImU32 kHover     = IM_COL32(34, 34, 34, 255);     // the raised hover
constexpr ImU32 kSeated    = IM_COL32(42, 42, 42, 255);     // the seated row
constexpr ImU32 kStrong    = IM_COL32(46, 46, 46, 255);     // the strong stroke
constexpr ImU32 kText      = IM_COL32(240, 240, 240, 255);
constexpr ImU32 kDim       = IM_COL32(136, 136, 136, 255);
constexpr ImU32 kFaint     = IM_COL32(92, 92, 92, 255);
constexpr ImU32 kStroke    = IM_COL32(255, 255, 255, 13);   // rgba(255,255,255,.05)
constexpr ImU32 kHi        = IM_COL32(108, 119, 255, 255);  // the periwinkle fill
constexpr ImU32 kFill      = IM_COL32(74, 74, 74, 255);     // the slider fill
constexpr ImU32 kThumb     = IM_COL32(224, 224, 224, 255);  // the slider thumb
constexpr ImU32 kKnobOff   = IM_COL32(189, 189, 189, 255);  // the switch knob, off
constexpr ImU32 kKnobOn    = IM_COL32(17, 17, 17, 255);     // the switch knob, on
constexpr ImU32 kCell      = IM_COL32(34, 34, 34, 255);     // the unit/caret cell, one step up from the card
constexpr ImU32 kMenuHover = IM_COL32(20, 20, 20, 255);     // the menu option hover
constexpr ImU32 kMenuSel   = IM_COL32(24, 24, 24, 255);     // the menu option seated
constexpr ImU32 kAxX    = IM_COL32(239, 83, 80, 255);
constexpr ImU32 kAxY    = IM_COL32(105, 208, 109, 255);
constexpr ImU32 kAxZ    = IM_COL32(91, 140, 255, 255);

constexpr float kTintDots[8][3] =
{
    { 1.000f, 1.000f, 1.000f },   // white
    { 0.937f, 0.325f, 0.314f },   // red
    { 1.000f, 0.694f, 0.294f },   // amber
    { 0.961f, 0.827f, 0.294f },   // yellow
    { 0.412f, 0.816f, 0.427f },   // green
    { 0.357f, 0.549f, 1.000f },   // blue
    { 0.604f, 0.482f, 1.000f },   // violet
    { 0.310f, 0.820f, 0.773f },   // teal
};

float Clamp01(float V) noexcept
{
    return V < 0.0f ? 0.0f : (V > 1.0f ? 1.0f : V);
}

bool NearTint(const float A[3], const float B[3]) noexcept
{
    return std::fabs(A[0] - B[0]) + std::fabs(A[1] - B[1]) + std::fabs(A[2] - B[2]) < 0.03f;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           FACES
//------------------------------------------------------------------------------------------------------------------------

void ControlPanel::AssignFonts(ImFont* Ui, ImFont* Small, ImFont* Mono, ImFont* MonoSmall,
                            ImFont* Title, ImFont* Display) noexcept
{
    Ui_        = Ui;
    Small_     = Small;
    Mono_      = Mono;
    MonoSmall_ = MonoSmall;
    Title_     = Title;
    Display_   = Display;
}

ImFont* ControlPanel::QueryUi() const noexcept
{
    return Ui_ != nullptr ? Ui_ : ImGui::GetFont();
}

ImFont* ControlPanel::QuerySmall() const noexcept
{
    return Small_ != nullptr ? Small_ : ImGui::GetFont();
}

ImFont* ControlPanel::QueryMono() const noexcept
{
    return Mono_ != nullptr ? Mono_ : ImGui::GetFont();
}

float ControlPanel::QueryFootTop() const noexcept
{
    // The window's own bottom edge, less the pad and the forty: size never moves under a scrollbar's
    //    reservation the way the content rect does, so every column's foot lands on the same row.
    return ImGui::GetWindowPos().y + ImGui::GetWindowSize().y - 8.0f - kEditorFooterH;
}

ImFont* ControlPanel::QueryMonoSmall() const noexcept
{
    return MonoSmall_ != nullptr ? MonoSmall_ : ImGui::GetFont();
}

ImFont* ControlPanel::QueryTitle() const noexcept
{
    return Title_ != nullptr ? Title_ : ImGui::GetFont();
}

ImFont* ControlPanel::QueryDisplay() const noexcept
{
    return Display_ != nullptr ? Display_ : ImGui::GetFont();
}

ImU32 ControlPanel::FadeTint(ImU32 Tint, float Fade) noexcept
{
    const int A = static_cast<int>(((Tint >> IM_COL32_A_SHIFT) & 0xFFu) * Fade);
    return (Tint & ~IM_COL32_A_MASK) | (static_cast<ImU32>(A) << IM_COL32_A_SHIFT);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       CLICK-TO-TYPE
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::TypeInCell(const char* Id, const ImVec2& CellMin, const ImVec2& CellSize,
                            float Current, uint32_t Decimals, float* Committed) noexcept
{
    const ImGuiID CellId = ImGui::GetID(Id);
    ImDrawList*   Draw   = ImGui::GetWindowDrawList();
    ImFont*       Mono   = QueryMono();

    if (TypeInId_ == CellId)
    {
        ImGui::SetCursorScreenPos(ImVec2(CellMin.x + 2.0f, CellMin.y + 1.0f));
        ImGui::PushItemWidth(CellSize.x - 4.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(2.0f, 1.0f));
        ImGui::PushFont(Mono);
        if (TypeInFocus_)
        {
            ImGui::SetKeyboardFocusHere();
            TypeInFocus_ = false;
        }
        const bool Done = ImGui::InputText("##typein", TypeIn_, sizeof(TypeIn_),
            ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_AutoSelectAll);
        ImGui::PopFont();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
        ImGui::PopItemWidth();

        if (Done)
        {
            *Committed = static_cast<float>(std::atof(TypeIn_));
            TypeInId_  = 0u;
            return true;
        }
        if (ImGui::IsItemDeactivated())
        {
            TypeInId_ = 0u;
        }
        return false;
    }

    ImGui::SetCursorScreenPos(CellMin);
    ImGui::InvisibleButton(Id, CellSize);
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        std::snprintf(TypeIn_, sizeof(TypeIn_), "%.*f", Decimals, static_cast<double>(Current));
        TypeInId_    = CellId;
        TypeInFocus_ = true;
    }

    char Shown[32] = {};
    std::snprintf(Shown, sizeof(Shown), "%.*f", Decimals, static_cast<double>(Current));
    const ImVec2 Glyph = Mono->CalcTextSizeA(Mono->LegacySize, FLT_MAX, 0.0f, Shown);
    ImGui::PushFont(Mono);
    Draw->AddText(ImVec2(CellMin.x + (CellSize.x - Glyph.x) * 0.5f, CellMin.y + (CellSize.y - Glyph.y) * 0.5f),
        kText, Shown);
    ImGui::PopFont();
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        SLIDER PILL
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::SliderPill(const char* Id, float* Figure, float Minimum, float Maximum,
                            uint32_t Decimals, const char* Unit, bool Hi, bool Thin, bool ShowPill) noexcept
{
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    if (RowWidth < 1.0f)
    {
        return false;
    }

    // The reference slider: a 92-pixel split pill (black figure cell, inset unit cell) beside the track.
    //    The track pill stands as tall as the knob circle — 26 over 24 — and the thin voice drops the
    //    three figures to 18 over 10 over 18. The pill hides for the footer clock, which keeps its own text.
    constexpr float kPillWidth = 92.0f;
    constexpr float kUnitWidth = 34.0f;
    constexpr float kGap       = 10.0f;
    constexpr float kHeight    = 30.0f;
    constexpr float kPillH     = 28.0f;
    const float TrackH = Thin ? 10.0f : 26.0f;
    const float ThumbR = Thin ? 9.0f : 12.0f;
    const float BoxH   = Thin ? 18.0f : 26.0f;

    ImGui::Dummy(ImVec2(RowWidth, kHeight));
    const ImVec2 Cursor = ImGui::GetItemRectMin();
    ImDrawList* Draw    = ImGui::GetWindowDrawList();
    bool        Changed = false;

    float TrackX0 = Cursor.x;
    if (ShowPill)
    {
        const ImVec2 PillMin(Cursor.x, Cursor.y + 1.0f);
        const ImVec2 PillMax(Cursor.x + kPillWidth, Cursor.y + 1.0f + kPillH);
        const float  SplitX = Cursor.x + kPillWidth - kUnitWidth;

        Draw->AddRectFilled(PillMin, ImVec2(SplitX, PillMax.y), kField, 14.0f, ImDrawFlags_RoundCornersLeft);
        Draw->AddRectFilled(ImVec2(SplitX, PillMin.y), PillMax, kInset, 14.0f, ImDrawFlags_RoundCornersRight);
        Draw->AddRect(PillMin, PillMax, kStroke, 14.0f);
        Draw->AddLine(ImVec2(SplitX, PillMin.y), ImVec2(SplitX, PillMax.y), kStroke);

        const ImVec2 NumMin(Cursor.x + 2.0f, PillMin.y + 2.0f);
        const ImVec2 NumSize(SplitX - Cursor.x - 4.0f, kPillH - 4.0f);
        if (TypeInCell(Id, NumMin, NumSize, *Figure, Decimals, Figure))
        {
            Changed = true;
        }

        ImFont* Small = QuerySmall();
        ImGui::PushFont(Small);
        const ImVec2 UnitGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Unit);
        Draw->AddText(ImVec2(SplitX + (kUnitWidth - UnitGlyph.x) * 0.5f,
            PillMin.y + (kPillH - UnitGlyph.y) * 0.5f), kFaint, Unit);
        ImGui::PopFont();

        TrackX0 = Cursor.x + kPillWidth + kGap;
    }

    const float TrackX1 = Cursor.x + RowWidth;
    const float Span    = TrackX1 - TrackX0;
    if (Span > 20.0f)
    {
        const float BoxY0   = Cursor.y + (kHeight - BoxH) * 0.5f;
        const float TrackY0 = BoxY0 + (BoxH - TrackH) * 0.5f;
        const float TrackY1 = TrackY0 + TrackH;
        const float MidY    = (TrackY0 + TrackY1) * 0.5f;
        const float Travel0 = TrackX0 + ThumbR;
        const float Travel1 = TrackX1 - ThumbR;

        float Fraction = (Maximum > Minimum) ? ((*Figure - Minimum) / (Maximum - Minimum)) : 0.0f;
        Fraction       = Clamp01(Fraction);

        ImGui::SetCursorScreenPos(ImVec2(TrackX0, BoxY0));
        ImGui::InvisibleButton("##track", ImVec2(Span, BoxH));
        const bool Held = ImGui::IsItemActive();
        if (Held && Travel1 > Travel0)
        {
            const float MouseX = ImGui::GetIO().MousePos.x;
            float Next = Minimum + (MouseX - Travel0) / (Travel1 - Travel0) * (Maximum - Minimum);
            Next       = Next < Minimum ? Minimum : (Next > Maximum ? Maximum : Next);
            if (Next != *Figure)
            {
                *Figure  = Next;
                Changed  = true;
                Fraction = (Maximum > Minimum) ? ((*Figure - Minimum) / (Maximum - Minimum)) : 0.0f;
                Fraction = Clamp01(Fraction);
            }
        }

        const float ThumbX = Travel0 + Fraction * (Travel1 - Travel0);
        const float FillX1 = ThumbX > TrackX0 + ThumbR * 2.0f ? ThumbX : TrackX0 + ThumbR * 2.0f;
        Draw->AddRectFilled(ImVec2(TrackX0, TrackY0), ImVec2(TrackX1, TrackY1), kHover, TrackH * 0.5f);
        Draw->AddRectFilled(ImVec2(TrackX0, TrackY0), ImVec2(FillX1, TrackY1), Hi ? kHi : kFill, TrackH * 0.5f);
        const float KnobR = Held ? ThumbR * 1.12f : ThumbR;
        Draw->AddCircleFilled(ImVec2(ThumbX, MidY + 1.0f), KnobR, IM_COL32(0, 0, 0, 128));
        Draw->AddCircleFilled(ImVec2(ThumbX, MidY), KnobR, kThumb);
    }

    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          SWITCH
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::Switch(const char* Id, bool* On) noexcept
{
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    // The reference switch: a 44×25 pill, white when on, the knob gliding end to end.
    constexpr float kW = 44.0f;
    constexpr float kH = 25.0f;
    ImGui::Dummy(ImVec2(kW, kH));
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImGui::SetCursorScreenPos(Min);
    ImGui::InvisibleButton(Id, ImVec2(kW, kH));
    bool Changed = false;
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        *On     = !*On;
        Changed = true;
    }

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, *On ? IM_COL32(255, 255, 255, 255) : kHover, 12.5f);
    Draw->AddRect(Min, Max, kStroke, 12.5f);
    const float KnobX = *On ? (Min.x + 30.5f) : (Min.x + 11.5f);
    Draw->AddCircleFilled(ImVec2(KnobX, Min.y + 12.5f), 9.5f, *On ? kKnobOn : kKnobOff);

    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         AXIS VEC3
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::AxisVec3(const char* Id, float Axes[3], float Step, bool Editable) noexcept
{
    (void)Id;
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    if (RowWidth < 1.0f)
    {
        return false;
    }

    constexpr float kGap    = 8.0f;
    constexpr float kHeight = 26.0f;
    const float CellWidth   = (RowWidth - 2.0f * kGap) / 3.0f;

    ImGui::Dummy(ImVec2(RowWidth, kHeight));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    static const char*  kLetters[3] = { "X", "Y", "Z" };
    static const ImU32  kAxisTint[3] = { kAxX, kAxY, kAxZ };

    ImDrawList* Draw    = ImGui::GetWindowDrawList();
    ImFont*     Small   = QuerySmall();
    bool        Changed = false;

    for (uint32_t i = 0u; i < 3u; ++i)
    {
        const ImVec2 CellMin(Cursor.x + i * (CellWidth + kGap), Cursor.y);
        const ImVec2 CellMax(CellMin.x + CellWidth, Cursor.y + kHeight);
        Draw->AddRectFilled(CellMin, CellMax, kField, 8.0f);
        Draw->AddRect(CellMin, CellMax, kStroke, 8.0f);

        const ImVec2 LetterMax(CellMin.x + 22.0f, CellMax.y);
        char LetterId[8] = {};
        std::snprintf(LetterId, sizeof(LetterId), "##ax%u", i);
        ImGui::SetCursorScreenPos(CellMin);
        ImGui::InvisibleButton(LetterId, ImVec2(22.0f, kHeight));
        if (Editable && ImGui::IsItemActive())
        {
            Axes[i] += ImGui::GetIO().MouseDelta.x * Step * 0.5f;
            Changed  = true;
        }

        ImGui::PushFont(Small);
        const ImVec2 LetterGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, kLetters[i]);
        Draw->AddText(ImVec2(CellMin.x + (22.0f - LetterGlyph.x) * 0.5f,
            CellMin.y + (kHeight - LetterGlyph.y) * 0.5f), Editable ? kAxisTint[i] : kFaint, kLetters[i]);
        ImGui::PopFont();

        const ImVec2 NumMin(LetterMax.x + 2.0f, CellMin.y + 4.0f);
        const ImVec2 NumMax(CellMax.x - 8.0f, CellMax.y - 4.0f);
        if (Editable)
        {
            char NumId[8] = {};
            std::snprintf(NumId, sizeof(NumId), "##n%u", i);
            if (TypeInCell(NumId, NumMin, ImVec2(NumMax.x - NumMin.x, NumMax.y - NumMin.y), Axes[i], 2u, &Axes[i]))
            {
                Changed = true;
            }
        }
        else
        {
            char Shown[32] = {};
            std::snprintf(Shown, sizeof(Shown), "%.2f", static_cast<double>(Axes[i]));
            ImFont* Mono = QueryMono();
            ImGui::PushFont(Mono);
            const ImVec2 Glyph = Mono->CalcTextSizeA(Mono->LegacySize, FLT_MAX, 0.0f, Shown);
            Draw->AddText(ImVec2(NumMin.x + (NumMax.x - NumMin.x - Glyph.x) * 0.5f,
                NumMin.y + (NumMax.y - NumMin.y - Glyph.y) * 0.5f), kFaint, Shown);
            ImGui::PopFont();
        }
    }

    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        COLOUR CHIP
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::ColourChip(const char* Id, float Tint[3]) noexcept
{
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    if (RowWidth < 1.0f)
    {
        return false;
    }

    constexpr float kHeight = 26.0f;
    ImGui::Dummy(ImVec2(RowWidth, kHeight));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    ImGui::SetCursorScreenPos(Cursor);
    ImGui::InvisibleButton(Id, ImVec2(52.0f, kHeight));
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        ImGui::OpenPopup("##chipmenu");
    }

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    const ImVec2 ChipMax(Cursor.x + 52.0f, Cursor.y + kHeight);
    Draw->AddRectFilled(Cursor, ChipMax,
        IM_COL32(static_cast<int>(Clamp01(Tint[0]) * 255.0f), static_cast<int>(Clamp01(Tint[1]) * 255.0f),
            static_cast<int>(Clamp01(Tint[2]) * 255.0f), 255), 8.0f);
    Draw->AddRect(Cursor, ChipMax, kStrong, 8.0f);

    char Hex[10] = {};
    std::snprintf(Hex, sizeof(Hex), "#%02X%02X%02X",
        static_cast<int>(Clamp01(Tint[0]) * 255.0f),
        static_cast<int>(Clamp01(Tint[1]) * 255.0f),
        static_cast<int>(Clamp01(Tint[2]) * 255.0f));
    ImFont* Mono = QueryMono();
    ImGui::PushFont(Mono);
    const ImVec2 HexGlyph = Mono->CalcTextSizeA(Mono->LegacySize, FLT_MAX, 0.0f, Hex);
    Draw->AddText(ImVec2(Cursor.x + 62.0f, Cursor.y + (kHeight - HexGlyph.y) * 0.5f), kDim, Hex);
    ImGui::PopFont();

    bool Changed = false;
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.102f, 0.102f, 0.102f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.180f, 0.180f, 0.180f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 12.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f, 10.0f));
    if (ImGui::BeginPopup("##chipmenu"))
    {
        ImGui::PushItemWidth(220.0f);
        Changed = ImGui::ColorPicker3("##picker", Tint,
            ImGuiColorEditFlags_NoSidePreview | ImGuiColorEditFlags_NoSmallPreview | ImGuiColorEditFlags_NoAlpha);
        ImGui::PopItemWidth();
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        SWATCH ROW
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::SwatchRow(const char* Id, float Tint[3]) noexcept
{
    (void)Id;
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    constexpr float kDot  = 18.0f;
    constexpr float kGap  = 8.0f;
    constexpr float kSpan = 8.0f * kDot + 7.0f * kGap;

    ImGui::Dummy(ImVec2(kSpan, 20.0f));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    ImDrawList* Draw    = ImGui::GetWindowDrawList();
    bool        Changed = false;

    for (uint32_t i = 0u; i < 8u; ++i)
    {
        const ImVec2 DotMin(Cursor.x + i * (kDot + kGap), Cursor.y + 1.0f);
        const ImVec2 Centre(DotMin.x + kDot * 0.5f, DotMin.y + kDot * 0.5f);
        char DotId[8] = {};
        std::snprintf(DotId, sizeof(DotId), "##sw%u", i);
        ImGui::SetCursorScreenPos(DotMin);
        ImGui::InvisibleButton(DotId, ImVec2(kDot, kDot));
        if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
        {
            Tint[0] = kTintDots[i][0];
            Tint[1] = kTintDots[i][1];
            Tint[2] = kTintDots[i][2];
            Changed = true;
        }

        Draw->AddCircleFilled(Centre, 9.0f,
            IM_COL32(static_cast<int>(kTintDots[i][0] * 255.0f), static_cast<int>(kTintDots[i][1] * 255.0f),
                static_cast<int>(kTintDots[i][2] * 255.0f), 255));
        Draw->AddCircle(Centre, 9.0f, kStrong);
        if (NearTint(Tint, kTintDots[i]))
        {
            Draw->AddCircle(Centre, 11.5f, IM_COL32(255, 255, 255, 255), 0, 2.0f);
        }
    }

    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         DROP-DOWN
//------------------------------------------------------------------------------------------------------------------------

// One visual language for filter, camera, projection and property selectors.
// The entire control is a pill: no stock ImGui split-arrow rectangle.
bool ControlPanel::DropdownButton(const char* Id,const char* Label,ImVec2 Size,bool Open,bool Emphasized,float LabelInset,bool BlackGrey) noexcept
{
    const bool Pressed=ImGui::InvisibleButton(Id,Size);
    const bool Hot=ImGui::IsItemHovered() || ImGui::IsItemActive() || Open;
    const auto A=ImGui::GetItemRectMin(), B=ImGui::GetItemRectMax();
    auto* D=ImGui::GetWindowDrawList();
    if(BlackGrey)
    {
        const float Split=B.x-30;
        D->AddRectFilled(A,B,IM_COL32(0,0,0,255),Size.y*.5f);
        D->AddRectFilled(ImVec2(Split,A.y),B,Hot?IM_COL32(46,46,46,255):IM_COL32(34,34,34,255),Size.y*.5f,ImDrawFlags_RoundCornersRight);
    }
    else
    D->AddRectFilled(A,B,Hot?IM_COL32(255,255,255,20):IM_COL32(255,255,255,11),Size.y*.5f);
    D->AddRect(A,B,Hot?IM_COL32(255,255,255,33):IM_COL32(255,255,255,18),Size.y*.5f);
    const ImU32 Ink=Hot || Emphasized?IM_COL32(255,255,255,240):IM_COL32(255,255,255,82);
    auto* Font=QueryUi(); const float Px=12;
    const ImVec2 Min(A.x+LabelInset,(A.y+B.y-Px)*.5f);
    D->PushClipRect(Min,ImVec2(ImMax(Min.x,B.x-28),B.y),true);
    D->AddText(Font,Px,Min,Ink,Label); D->PopClipRect();
    const float X=B.x-17,Y=(A.y+B.y)*.5f-2;
    D->AddTriangleFilled(ImVec2(X-4,Y),ImVec2(X+4,Y),ImVec2(X,Y+(Open?-4:4)),Ink);
    return Pressed;
}

bool ControlPanel::BeginDropdownPopup(const char* Id,ImVec2 Anchor,float Width) noexcept
{
    ImGui::SetNextWindowPos(Anchor,ImGuiCond_Appearing);
    ImGui::SetNextWindowSize(ImVec2(Width,0),ImGuiCond_Appearing);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(8,8));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,ImVec2(0,5));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding,16);
    ImGui::PushStyleColor(ImGuiCol_PopupBg,ImVec4(15.f/255,16.f/255,18.f/255,189.f/255));
    ImGui::PushStyleColor(ImGuiCol_Border,ImVec4(1,1,1,33.f/255));
    if(ImGui::BeginPopup(Id,ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse)) return true;
    ImGui::PopStyleColor(2);ImGui::PopStyleVar(3);return false;
}
void ControlPanel::EndDropdownPopup() noexcept
{
    ImGui::EndPopup();ImGui::PopStyleColor(2);ImGui::PopStyleVar(3);
}
bool ControlPanel::DropdownChoice(const char* Id,const char* Label,bool Selected,ImU32 Dot,ImU32 Check) noexcept
{
    const auto A=ImGui::GetCursorScreenPos();const float W=ImGui::GetContentRegionAvail().x;
    const bool Pressed=ImGui::InvisibleButton(Id,ImVec2(W,28));
    const bool Hot=ImGui::IsItemHovered();auto* D=ImGui::GetWindowDrawList();
    if(Hot||Selected)D->AddRectFilled(A,ImVec2(A.x+W,A.y+28),Hot?IM_COL32(255,255,255,20):IM_COL32(255,255,255,11),14);
    if(Dot)D->AddCircleFilled(ImVec2(A.x+13,A.y+14),3,Dot);
    const float X=A.x+(Dot?26:14);
    D->PushClipRect(ImVec2(X,A.y),ImVec2(ImMax(X,A.x+W-26),A.y+28),true);
    D->AddText(QueryUi(),12,ImVec2(X,A.y+8),Selected||Hot?IM_COL32(255,255,255,240):IM_COL32(255,255,255,143),Label);
    D->PopClipRect();
    if(Selected){D->AddLine(ImVec2(A.x+W-20,A.y+14),ImVec2(A.x+W-17,A.y+17),Check,1.5f);D->AddLine(ImVec2(A.x+W-17,A.y+17),ImVec2(A.x+W-11,A.y+10),Check,1.5f);}
    return Pressed;
}
bool ControlPanel::DropDown(const char* Id,uint32_t* Picked,
                           const char Options[kMaxEditorOptions][kMaxEditorOptionChars],uint32_t OptionCount,float Width,float Height) noexcept
{
    if(ImGui::GetCurrentWindow()->SkipItems || !OptionCount) return false;
    if(Width<=0) Width=ImGui::GetContentRegionAvail().x;
    if(Width<1) return false;
    ImGui::PushID(Id);
    if(DropdownButton("##button",Options[*Picked<OptionCount?*Picked:0],ImVec2(Width,Height),ImGui::IsPopupOpen("##menu"),true,14,true)) ImGui::OpenPopup("##menu");
    const auto A=ImGui::GetItemRectMin(),B=ImGui::GetItemRectMax();bool Changed=false;
    const auto Trigger=ImGui::GetCurrentContext()->LastItemData;
    if(BeginDropdownPopup("##menu",ImVec2(A.x,B.y+6),ImMax(170.f,Width)))
    {
        for(uint32_t I=0;I<OptionCount;++I)
        {
            ImGui::PushID(int(I));
            if(DropdownChoice("##choice",Options[I],*Picked==I)){*Picked=I;Changed=true;ImGui::CloseCurrentPopup();}
            ImGui::PopID();
        }
        EndDropdownPopup();
    }
    ImGui::PopID();ImGui::GetCurrentContext()->LastItemData=Trigger;return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        PILL TOGGLE
//------------------------------------------------------------------------------------------------------------------------

bool ControlPanel::PillToggle(const char* Label, bool* On) noexcept
{
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return false;
    }

    ImFont* Small = QuerySmall();
    ImGui::PushFont(Small);
    const ImVec2 LabelGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Label);
    ImGui::PopFont();

    const ImVec2 Size(LabelGlyph.x + 20.0f, 22.0f);
    ImGui::Dummy(Size);
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImGui::SetCursorScreenPos(Min);
    ImGui::InvisibleButton(Label, Size);
    bool Changed = false;
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        *On     = !*On;
        Changed = true;
    }

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, *On ? kInset : IM_COL32(255, 255, 255, 8), 11.0f);
    Draw->AddRect(Min, Max, *On ? kStrong : kStroke, 11.0f);
    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(Min.x + (Size.x - LabelGlyph.x) * 0.5f, Min.y + (Size.y - LabelGlyph.y) * 0.5f),
        *On ? kText : kDim, Label);
    ImGui::PopFont();
    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          READOUT
//------------------------------------------------------------------------------------------------------------------------

void ControlPanel::Readout(const char* Text) noexcept
{
    ImGuiWindow* Window = ImGui::GetCurrentWindow();
    if (Window->SkipItems)
    {
        return;
    }

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    if (RowWidth < 1.0f)
    {
        return;
    }

    ImGui::Dummy(ImVec2(RowWidth, 18.0f));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    ImFont* Mono = QueryMonoSmall();
    ImGui::PushFont(Mono);
    const ImVec2 Glyph = Mono->CalcTextSizeA(Mono->LegacySize, FLT_MAX, 0.0f, Text);
    ImGui::GetWindowDrawList()->AddText(
        ImVec2(Cursor.x + RowWidth - Glyph.x, Cursor.y + (18.0f - Glyph.y) * 0.5f), kDim, Text);
    ImGui::PopFont();
}

} // namespace Frontier
