//========================================================================================================================
// 🧩 AppearanceInspector — see AppearanceInspector.h
//========================================================================================================================
#include "AppearanceInspector.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace Frontier {

namespace {

constexpr ColorQuad Hex(uint32_t Rgb, float Alpha = 1.0f) noexcept
{
    return ColorQuad{ ((Rgb >> 16) & 0xFFu) / 255.0f, ((Rgb >> 8) & 0xFFu) / 255.0f, (Rgb & 0xFFu) / 255.0f, Alpha };
}

// Notch dark theme text colours (colors.text / colors.textMuted) used on section headings.
constexpr ColorQuad Ink90 { 1.0f, 1.0f, 1.0f, 0.90f };
constexpr ColorQuad Ink50 { 1.0f, 1.0f, 1.0f, 0.50f };
constexpr ColorQuad Ink10 { 1.0f, 1.0f, 1.0f, 0.10f };
constexpr ColorQuad Ink20 { 1.0f, 1.0f, 1.0f, 0.20f };

// Theme tile miniature palettes — Notch ThemeTab.tsx (bg / sidebar / panel / lines).
struct TilePalette { const char* Name; ColorQuad Background, Sidebar, Panel, Lines; bool OutlinePanel; };
constexpr TilePalette Tiles[7] =
{
    { "OLED",    Hex(0x000000), Hex(0x0A0A0A), Hex(0x141414), Hex(0xFFFFFF), false },
    { "Dark",    Hex(0x18181A), Hex(0x222224), Hex(0x2C2C2E), Hex(0xFFFFFF), false },
    { "Light",   Hex(0xE5E5E5), Hex(0xF4F4F5), Hex(0xFFFFFF), Hex(0x000000), true  },
    { "Sepia",   Hex(0xDCA85B), Hex(0xE6C697), Hex(0xF1DAB0), Hex(0x825619), false },
    { "Dracula", Hex(0x282A36), Hex(0x44475A), Hex(0x6272A4), Hex(0xF8F8F2), false },
    { "Nord",    Hex(0x2E3440), Hex(0x3B4252), Hex(0x4C566A), Hex(0xECEFF4), false },
    { "GitHub",  Hex(0x0D1117), Hex(0x161B22), Hex(0x21262D), Hex(0xC9D1D9), false },
};
constexpr ThemeCategory TileThemes[7] =
{
    ThemeCategory::Oled, ThemeCategory::Dark, ThemeCategory::Light, ThemeCategory::Sepia,
    ThemeCategory::Dracula, ThemeCategory::Nord, ThemeCategory::GitHub
};

constexpr uint32_t AccentHex[10] = { 0xFFFFFF, 0xF97316, 0xF59E0B, 0x84CC16, 0x10B981, 0x06B6D4, 0x3B82F6, 0x8B5CF6, 0xD946EF, 0xF43F5E };

// Semantic swatch rows — Notch ThemeTab.tsx; Caution row added per direction (flagged).
constexpr uint32_t SemanticHex[4][4] =
{
    { 0xF59E0B, 0xEAB308, 0xFBBF24, 0xF97316 },   // Warning
    { 0x10B981, 0x22C55E, 0x34D399, 0x059669 },   // Success
    { 0x3B82F6, 0x0EA5E9, 0x60A5FA, 0x2563EB },   // Info
    { 0xEAB308, 0xFACC15, 0xFDE047, 0xCA8A04 },   // Caution (yellow ladder)
};

constexpr const char* ResolutionNames[] = { "Native", "2560 x 1440", "1920 x 1080", "1280 x 720" };
constexpr const char* VsyncNames[]      = { "Off", "On", "Adaptive" };
constexpr const char* FrameCapNames[]   = { "Unlimited", "60 fps", "120 fps", "144 fps" };
constexpr const char* CornerNames[]     = { "TL", "TR", "BL", "BR" };
constexpr const char* SampleNames[]     = { "1x", "2x", "4x", "8x" };

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

AppearanceInspector::AppearanceInspector() noexcept
    : Applied{}, Draft{}, Revision(0u), OpenDropdown(-1), DraggingSlider(-1), Dropdowns{ DropdownRecord{ {}, nullptr, 0u, 0u, -1 }, DropdownRecord{ {}, nullptr, 0u, 0u, -1 }, DropdownRecord{ {}, nullptr, 0u, 0u, -1 }, DropdownRecord{ {}, nullptr, 0u, 0u, -1 } }, DropdownCount(0u)
    , TileExtents{}, AccentExtents{}, RadiusSliderExtent{}, ScaleSliderExtent{}, DropdownExtents{}, FullscreenSwitchExtent{}, VsyncExtent{}
{
}

const char* AppearanceInspector::QueryThemeName(ThemeCategory Theme) noexcept
{
    for (uint32_t I = 0u; I < 7u; ++I) if (TileThemes[I] == Theme) return Tiles[I].Name;
    return "Dim";
}

ColorQuad AppearanceInspector::QueryAccentColour(AccentCategory Accent) noexcept
{
    return Hex(AccentHex[std::min<uint32_t>(static_cast<uint32_t>(Accent), 9u)]);
}

ColorQuad AppearanceInspector::QuerySemanticColour(uint32_t Row, uint32_t Swatch) noexcept
{
    return Hex(SemanticHex[std::min(Row, 3u)][std::min(Swatch, 3u)]);
}

AppearanceDifference AppearanceInspector::QueryDifference() const noexcept
{
    AppearanceDifference D{};
    auto Note = [&](bool Changed, const char* Name) { if (Changed) { if (D.Count < 8u) D.Names[D.Count] = Name; ++D.Count; } };
    Note(Draft.Resolution       != Applied.Resolution,       "Resolution");
    Note(Draft.InterfaceScale   != Applied.InterfaceScale,   "UI scale");
    Note(Draft.MatchQualityTier != Applied.MatchQualityTier, "Match quality");
    Note(Draft.VerticalSync     != Applied.VerticalSync,     "V-Sync");
    Note(Draft.FrameCap         != Applied.FrameCap,         "Frame cap");
    Note(Draft.Fullscreen       != Applied.Fullscreen,       "Fullscreen");
    Note(Draft.AntiAliasing     != Applied.AntiAliasing,     "Anti-aliasing");
    Note(Draft.SafeAreaPadding  != Applied.SafeAreaPadding,  "Safe area");
    Note(Draft.FrameRateOverlay != Applied.FrameRateOverlay, "FPS overlay");
    Note(Draft.OverlayCorner    != Applied.OverlayCorner,    "Overlay corner");
    Note(Draft.Theme            != Applied.Theme,            "Theme");
    Note(Draft.CornerRadius     != Applied.CornerRadius,     "Corner radius");
    Note(Draft.Accent           != Applied.Accent,           "Accent");
    Note(Draft.WarningSwatch    != Applied.WarningSwatch,    "Warning colour");
    Note(Draft.SuccessSwatch    != Applied.SuccessSwatch,    "Success colour");
    Note(Draft.InfoSwatch       != Applied.InfoSwatch,       "Info colour");
    Note(Draft.CautionSwatch    != Applied.CautionSwatch,    "Caution colour");
    return D;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DROPDOWNS
//------------------------------------------------------------------------------------------------------------------------

void AppearanceInspector::RecordDropdown(PixelSpace& Surface, const PlaneExtent& Extent, int Ordinal, const char* const* Options, uint32_t Count, uint32_t& Value, const ControlPointer& Pointer, float Opacity) noexcept
{
    // While a menu is open every other control is inert (the floating layer owns the pointer).
    ControlPointer Local = Pointer;
    if (OpenDropdown >= 0) Local.Enabled = false;
    // A pick made in the floating layer (drawn after this tab last frame) lands here, one frame later.
    if (static_cast<uint32_t>(Ordinal) < 4u && Dropdowns[Ordinal].Pick >= 0) { Value = static_cast<uint32_t>(Dropdowns[Ordinal].Pick); Dropdowns[Ordinal].Pick = -1; }
    const ControlHit Hit = ControlKit::Dropdown(Surface, Extent, Options[std::min(Value, Count - 1u)], OpenDropdown == Ordinal, Local, Opacity);
    if (Hit.Clicked) OpenDropdown = Ordinal;
    if (static_cast<uint32_t>(Ordinal) < 4u) { Dropdowns[Ordinal] = DropdownRecord{ Extent, Options, Count, Value, -1 }; DropdownExtents[Ordinal] = Extent; }
    DropdownCount = std::max(DropdownCount, static_cast<uint32_t>(Ordinal + 1));
}

void AppearanceInspector::ConstructFloatingLayout(PixelSpace& Surface, const ControlPointer& Pointer, float Opacity) noexcept
{
    if (OpenDropdown < 0 || static_cast<uint32_t>(OpenDropdown) >= DropdownCount) return;
    DropdownRecord& R = Dropdowns[OpenDropdown];
    uint32_t Chosen = R.Value;
    const ControlHit Hit = ControlKit::DropdownMenu(Surface, R.Button, R.Options, R.Count, R.Value, Pointer, Chosen, Opacity);
    if (Hit.Clicked) { R.Pick = static_cast<int>(Chosen); R.Value = Chosen; OpenDropdown = -1; return; }
    // Release outside the menu and its button closes it.
    if (Pointer.Released && !Hit.Hovered && !R.Button.Encloses(Pointer.X, Pointer.Y)) OpenDropdown = -1;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DISPLAY TAB
//------------------------------------------------------------------------------------------------------------------------

float AppearanceInspector::ConstructDisplayTabLayout(PixelSpace& Surface, const PlaneExtent& Body, float ScrollY, const ControlPointer& Pointer, float Opacity) noexcept
{
    DropdownCount = 0u;
    const float Radius = std::clamp(Draft.CornerRadius, 0.0f, SectionRadiusMax);
    const float X = Body.MinimumX, W = Body.Width();
    float Y = Body.MinimumY - ScrollY;
    const float RowH = ControlKitTokens::ControlHeight, RowGap = 16.0f;
    ControlPointer Local = Pointer;
    if (OpenDropdown >= 0) Local.Enabled = false;   // menus own the pointer

    // A section = card with heading + N rows. Height = pad + heading + rows + pad.
    auto Section = [&](const char* Title, const char* Description, uint32_t Rows) -> PlaneExtent
    {
        const float HeadingH = 24.0f + (Description && *Description ? 16.0f : 0.0f) + 24.0f;   // mb-6 after heading
        const float H = ControlKit::SectionPadding * 2.0f + HeadingH + Rows * RowH + (Rows > 0u ? (Rows - 1u) * RowGap : 0.0f);
        const PlaneExtent Card = Spanning(X, Y, W, H);
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Card, Radius, Opacity);
        ControlKit::SectionHeading(Surface, Content.MinimumX, Content.MinimumY, Content.Width(), Title, Description, Ink90, Ink50, Opacity);
        Y += H + SectionGap;
        return PlaneExtent{ Content.MinimumX, Content.MinimumY + HeadingH, Content.MaximumX, Content.MaximumY };
    };

    // ① Resolution & Scaling
    {
        PlaneExtent C = Section("Resolution & Scaling", "Render target size and interface scale", 3u);
        float RowY = C.MinimumY;
        PlaneExtent Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "Resolution", ControlKitTokens::TextDim, Opacity);
        uint32_t Res = static_cast<uint32_t>(Draft.Resolution);
        RecordDropdown(Surface, Spanning(Ctl.MinimumX, RowY, std::min(Ctl.Width(), 260.0f), RowH), 0, ResolutionNames, 4u, Res, Pointer, Opacity);
        Draft.Resolution = static_cast<RenderResolutionCategory>(Res);
        RowY += RowH + RowGap;

        Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "UI Scale", ControlKitTokens::TextDim, Opacity);
        char Num[8]; std::snprintf(Num, sizeof(Num), "%d", static_cast<int>(std::lround(Draft.InterfaceScale)));
        ControlKit::ValuePill(Surface, Ctl.MinimumX, RowY, Num, "%", Opacity);
        ScaleSliderExtent = Spanning(Ctl.MinimumX + ControlKit::ValuePillWidth + ControlKitTokens::RowGap, RowY, Ctl.MaximumX - (Ctl.MinimumX + ControlKit::ValuePillWidth + ControlKitTokens::RowGap), RowH);
        {
            float V = Draft.InterfaceScale;
            const ControlHit Hit = ControlKit::Slider(Surface, ScaleSliderExtent, 50.0f, 200.0f, V, DraggingSlider == 0, Local, V, false, false, Opacity);
            if (Hit.Pressed) DraggingSlider = 0;
            if (DraggingSlider == 0) Draft.InterfaceScale = std::round(V);
        }
        RowY += RowH + RowGap;

        Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "Match Quality", ControlKitTokens::TextDim, Opacity);
        if (ControlKit::Switch(Surface, Ctl.MinimumX, RowY + (RowH - ControlKit::SwitchHeight) * 0.5f, Draft.MatchQualityTier, Local, Opacity).Clicked) Draft.MatchQualityTier = !Draft.MatchQualityTier;
        ControlKit::TextLeading(Surface, Spanning(Ctl.MinimumX + ControlKit::SwitchWidth + 12.0f, RowY, 300.0f, RowH), 0.0f, ControlKit::Faded(ControlKitTokens::TextFaint, Opacity), "Render scale follows the Quality tier", 12.0f);
    }

    // ② Presentation
    {
        PlaneExtent C = Section("Presentation", "Swapchain behaviour", 3u);
        float RowY = C.MinimumY;
        PlaneExtent Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "V-Sync", ControlKitTokens::TextDim, Opacity);
        {
            float SegW = 8.0f;
            for (const char* N : VsyncNames) SegW += Surface.MeasureText(N, 13.0f).X + 32.0f + 4.0f;
            SegW -= 4.0f;
            VsyncExtent = Spanning(Ctl.MinimumX, RowY, SegW, RowH);
            uint32_t Pick = static_cast<uint32_t>(Draft.VerticalSync);
            ControlKit::Segmented(Surface, VsyncExtent, VsyncNames, 3u, Pick, Local, Pick, Opacity);
            Draft.VerticalSync = static_cast<VerticalSyncCategory>(Pick);
        }
        RowY += RowH + RowGap;

        Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "Frame Cap", ControlKitTokens::TextDim, Opacity);
        uint32_t Cap = static_cast<uint32_t>(Draft.FrameCap);
        RecordDropdown(Surface, Spanning(Ctl.MinimumX, RowY, std::min(Ctl.Width(), 260.0f), RowH), 1, FrameCapNames, 4u, Cap, Pointer, Opacity);
        Draft.FrameCap = static_cast<FrameCapCategory>(Cap);
        RowY += RowH + RowGap;

        Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "Fullscreen", ControlKitTokens::TextDim, Opacity);
        FullscreenSwitchExtent = Spanning(Ctl.MinimumX, RowY + (RowH - ControlKit::SwitchHeight) * 0.5f, ControlKit::SwitchWidth, ControlKit::SwitchHeight);
        if (ControlKit::Switch(Surface, FullscreenSwitchExtent.MinimumX, FullscreenSwitchExtent.MinimumY, Draft.Fullscreen, Local, Opacity).Clicked) Draft.Fullscreen = !Draft.Fullscreen;
    }

    // ③ Anti-Aliasing — Notch DisplayTab pill row (1x 2x 4x 8x), kept verbatim.
    {
        const float HeadH = 16.0f + 24.0f;   // uppercase text-xs heading + gap-6
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + 34.0f;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        Surface.Text(Content.MinimumX + 4.0f, Content.MinimumY + 1.0f, ControlKit::Faded(Ink50, Opacity), "ANTI-ALIASING", 12.0f);
        float PX = Content.MinimumX;
        for (uint32_t I = 0u; I < 4u; ++I)
        {
            const bool Active = static_cast<uint32_t>(Draft.AntiAliasing) == I;
            const float TextW = Surface.MeasureText(SampleNames[I], 12.0f).X;
            const float PW = 40.0f + TextW + (Active ? 6.0f + 8.0f : 0.0f);   // px-5, dot w-1.5 + mr-2
            const PlaneExtent Pill = Spanning(PX, Content.MinimumY + HeadH, PW, 34.0f);
            const bool Hover = ControlKit::Over(Pill, Local);
            if (Hover && !Active) Surface.FillRectangle(Pill, ControlKit::Faded(Ink10, Opacity), 17.0f);   // hover:activeBg white/10
            ControlKit::OutlineRounded(Surface, Pill, ControlKit::Faded(Active ? ControlKitTokens::Accent : ColorQuad{ 1.0f, 1.0f, 1.0f, 0.06f }, Opacity), 17.0f);
            float TX = Pill.MinimumX + 20.0f;
            if (Active) { Surface.FillRectangle(Spanning(TX, Pill.MinimumY + 14.0f, 6.0f, 6.0f), ControlKit::Faded(ControlKitTokens::Accent, Opacity), 3.0f); TX += 6.0f + 8.0f; }
            const PlanePoint M = Surface.MeasureText(SampleNames[I], 12.0f);
            Surface.Text(TX, Pill.MinimumY + (34.0f - M.Y) * 0.5f, ControlKit::Faded(Active ? ControlKitTokens::Accent : Ink50, Opacity), SampleNames[I], 12.0f);
            if (Hover && Local.Released) Draft.AntiAliasing = static_cast<SampleCountCategory>(I);
            PX += PW + 8.0f;
        }
        Y += H + SectionGap;
    }

    // ④ Safe Area Padding — Notch DisplayTab slider 0–128, kept.
    {
        const float HeadH = 16.0f + 24.0f;
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + RowH;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        Surface.Text(Content.MinimumX + 4.0f, Content.MinimumY + 1.0f, ControlKit::Faded(Ink50, Opacity), "SAFE AREA PADDING", 12.0f);
        char Num[8]; std::snprintf(Num, sizeof(Num), "%d", static_cast<int>(std::lround(Draft.SafeAreaPadding)));
        ControlKit::ValuePill(Surface, Content.MinimumX, Content.MinimumY + HeadH, Num, "px", Opacity);
        const PlaneExtent Track = Spanning(Content.MinimumX + ControlKit::ValuePillWidth + ControlKitTokens::RowGap, Content.MinimumY + HeadH, Content.Width() - ControlKit::ValuePillWidth - ControlKitTokens::RowGap, RowH);
        float V = Draft.SafeAreaPadding;
        const ControlHit Hit = ControlKit::Slider(Surface, Track, 0.0f, 128.0f, V, DraggingSlider == 1, Local, V, false, false, Opacity);
        if (Hit.Pressed) DraggingSlider = 1;
        if (DraggingSlider == 1) Draft.SafeAreaPadding = std::round(V);
        Y += H + SectionGap;
    }

    // ⑤ Overlay
    {
        PlaneExtent C = Section("Overlay", "Frame-rate overlay placement", 2u);
        float RowY = C.MinimumY;
        PlaneExtent Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "FPS Overlay", ControlKitTokens::TextDim, Opacity);
        if (ControlKit::Switch(Surface, Ctl.MinimumX, RowY + (RowH - ControlKit::SwitchHeight) * 0.5f, Draft.FrameRateOverlay, Local, Opacity).Clicked) Draft.FrameRateOverlay = !Draft.FrameRateOverlay;
        RowY += RowH + RowGap;
        Ctl = ControlKit::ControlRow(Surface, C.MinimumX, RowY, C.Width(), "Corner", ControlKitTokens::TextDim, Opacity);
        float SegW = 8.0f;
        for (const char* N : CornerNames) SegW += Surface.MeasureText(N, 13.0f).X + 32.0f + 4.0f;
        SegW -= 4.0f;
        uint32_t Pick = static_cast<uint32_t>(Draft.OverlayCorner);
        ControlKit::Segmented(Surface, Spanning(Ctl.MinimumX, RowY, SegW, RowH), CornerNames, 4u, Pick, Local, Pick, Opacity);
        Draft.OverlayCorner = static_cast<OverlayCornerCategory>(Pick);
    }

    if (Pointer.Released) DraggingSlider = -1;
    return (Y + ScrollY) - Body.MinimumY - SectionGap;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THEME TAB
//------------------------------------------------------------------------------------------------------------------------

void AppearanceInspector::RecordThemeTile(PixelSpace& Surface, const PlaneExtent& Extent, ThemeCategory Theme, bool Active, float Radius, const ControlPointer& Pointer, float Opacity) noexcept
{
    uint32_t Index = 0u; for (uint32_t I = 0u; I < 7u; ++I) if (TileThemes[I] == Theme) Index = I;
    const TilePalette& T = Tiles[Index];
    const bool Hover = ControlKit::Over(Extent, Pointer);

    // aspect-[4/3] rounded-[1.25rem] (20 px) bg; ring-1 white/10 idle (hover white/20)
    Surface.FillRectangle(Extent, ControlKit::Faded(T.Background, Opacity), 20.0f);
    if (!Active) ControlKit::OutlineRounded(Surface, Extent, ControlKit::Faded(Hover ? Ink20 : Ink10, Opacity), 20.0f);

    // Inner mock: sidebar from (24, 24) to the tile's bottom-right; 30 % sidebar column + panel.
    const PlaneExtent Inner = PlaneExtent{ Extent.MinimumX + 24.0f, Extent.MinimumY + 24.0f, Extent.MaximumX, Extent.MaximumY };
    Surface.FillRectangle(Inner, ControlKit::Faded(T.Sidebar, Opacity), 0.0f);
    const float SideW = Inner.Width() * 0.30f;
    const PlaneExtent Side = PlaneExtent{ Inner.MinimumX, Inner.MinimumY, Inner.MinimumX + SideW, Inner.MaximumY };
    const PlaneExtent Pane = PlaneExtent{ Side.MaximumX, Inner.MinimumY, Inner.MaximumX, Inner.MaximumY };
    Surface.FillRectangle(Pane, ControlKit::Faded(T.Panel, Opacity), 0.0f);
    if (T.OutlinePanel) ControlKit::OutlineRounded(Surface, Pane, ControlKit::Faded(ColorQuad{ 0.0f, 0.0f, 0.0f, 0.05f }, Opacity), 0.0f);
    Surface.FillRectangle(Spanning(Side.MaximumX, Side.MinimumY, 1.0f, Side.Height()), ControlKit::Faded(ColorQuad{ 0.0f, 0.0f, 0.0f, 0.05f }, Opacity));

    const float LineR = Radius * 0.25f;
    auto Line = [&](float LX, float LY, float LW, float LH, float Alpha, float R) { Surface.FillRectangle(Spanning(LX, LY, LW, LH), ControlKit::Faded(ColorQuad{ T.Lines.Red, T.Lines.Green, T.Lines.Blue, Alpha }, Opacity), R); };
    // Sidebar p-3: three 6 px dots, then 3 lines (full, 2/3, 1/2), then avatar row at the bottom.
    float SX = Side.MinimumX + 12.0f, SY = Side.MinimumY + 12.0f;
    for (int I = 0; I < 3; ++I) Line(SX + I * 10.0f, SY, 6.0f, 6.0f, 0.4f, 3.0f);
    SY += 6.0f + 8.0f;
    const float SW = Side.Width() - 24.0f;
    Line(SX, SY, SW, 6.0f, 0.2f, LineR);              SY += 12.0f;
    Line(SX, SY, SW * 2.0f / 3.0f, 6.0f, 0.2f, LineR);  SY += 12.0f;
    Line(SX, SY, SW * 0.5f, 6.0f, 0.2f, LineR);
    const float AY = Side.MaximumY - 12.0f - 10.0f;
    if (AY > SY + 8.0f) { Line(SX, AY, 10.0f, 10.0f, 0.4f, 5.0f); Line(SX + 16.0f, AY + 2.0f, 16.0f, 6.0f, 0.2f, LineR); }
    // Panel p-4: 1/4 line, 1/3 line, three squares, 1/5 line at the bottom.
    float PX = Pane.MinimumX + 16.0f, PY = Pane.MinimumY + 16.0f;
    const float PW = Pane.Width() - 32.0f;
    Line(PX, PY, PW * 0.25f, 6.0f, 0.3f, LineR); PY += 6.0f + 4.0f + 6.0f;
    Line(PX, PY, PW / 3.0f, 6.0f, 0.2f, LineR);  PY += 6.0f + 6.0f + 4.0f;
    const float Sq = std::max((PW - 16.0f) / 3.0f, 4.0f);
    for (int I = 0; I < 3; ++I) Line(PX + I * (Sq + 8.0f), PY, Sq, Sq, 0.1f, Radius * 0.5f);
    const float BY = Pane.MaximumY - 16.0f - 6.0f;
    if (BY > PY + Sq + 4.0f) Line(PX, BY, PW * 0.2f, 6.0f, 0.2f, LineR);
}

void AppearanceInspector::RecordSemanticRow(PixelSpace& Surface, float X, float Y, float Width, uint32_t Row, const char* Label, uint32_t& Swatch, ControlCentreIconCategory Icon, float Radius, bool Last, const ControlPointer& Pointer, float Opacity) noexcept
{
    // grid-cols-[300px_1fr] gap-8 items-center; left: label + 4 swatches; right: preview card min-h 100.
    const float LeftW = 300.0f;
    const float PreviewH = 100.0f;
    const PlanePoint M = Surface.MeasureText(Label, 14.0f);
    const float LeftH = 20.0f + 24.0f + ControlKit::SwatchDiameter;
    const float RowH = std::max(PreviewH, LeftH);
    const float LeftY = Y + (RowH - LeftH) * 0.5f;
    Surface.Text(X, LeftY + (20.0f - M.Y) * 0.5f, ControlKit::Faded(Ink90, Opacity), Label, 14.0f);
    for (uint32_t I = 0u; I < 4u; ++I)
    {
        const float Cx = X + 16.0f + I * (ControlKit::SwatchDiameter + 12.0f), Cy = LeftY + 20.0f + 24.0f + 16.0f;
        if (ControlKit::Swatch(Surface, Cx, Cy, QuerySemanticColour(Row, I), Swatch == I, false, Pointer, Opacity).Clicked) Swatch = I;
    }
    const PlaneExtent Preview = Spanning(X + LeftW + 32.0f, Y, Width - LeftW - 32.0f, PreviewH);
    Surface.FillRectangle(Preview, ControlKit::Faded(Ink10, Opacity), Radius * 0.7f);        // colors.activeBg
    ControlKit::OutlineRounded(Surface, Preview, ControlKit::Faded(ColorQuad{ 1.0f, 1.0f, 1.0f, 0.06f }, Opacity), Radius * 0.7f);
    const ColorQuad Tone = QuerySemanticColour(Row, Swatch);
    ControlKit::Glyph(Surface, Preview.MinimumX + 24.0f, Preview.MinimumY + (PreviewH - 20.0f) * 0.5f, 20.0f, ControlKit::Faded(Tone, Opacity), Icon);
    const char* Message = Row == 0u ? "Warning Message" : Row == 1u ? "Success Message" : Row == 2u ? "Info Message" : "Caution Message";
    const PlanePoint MM = Surface.MeasureText(Message, 18.0f);
    Surface.Text(Preview.MinimumX + 24.0f + 20.0f + 8.0f, Preview.MinimumY + (PreviewH - MM.Y) * 0.5f, ControlKit::Faded(Tone, Opacity), Message, 18.0f);
    if (!Last) ControlKit::Divider(Surface, X, Y + RowH + 32.0f, Width, ControlKit::Faded(ColorQuad{ 1.0f, 1.0f, 1.0f, 0.06f }, Opacity));
}

float AppearanceInspector::ConstructThemeTabLayout(PixelSpace& Surface, const PlaneExtent& Body, float ScrollY, const ControlPointer& Pointer, float Opacity) noexcept
{
    DropdownCount = 0u;
    const float Radius = std::clamp(Draft.CornerRadius, 0.0f, SectionRadiusMax);
    const float X = Body.MinimumX, W = Body.Width();
    float Y = Body.MinimumY - ScrollY;

    // ① Color Scheme — grid-cols-4 gap-6 gap-y-8, tiles aspect 4:3 + name (gap-3).
    {
        const float InnerW = W - ControlKit::SectionPadding * 2.0f;
        const float TileW = (InnerW - 3.0f * 24.0f) / 4.0f, TileH = TileW * 0.75f;
        const float CellH = TileH + 12.0f + 16.0f;
        const float GridH = CellH * 2.0f + 32.0f;
        const float HeadH = 20.0f + 4.0f + 16.0f + 24.0f;   // title mb-1 + desc + mb-6
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + GridH;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        ControlKit::SectionHeading(Surface, Content.MinimumX, Content.MinimumY, Content.Width(), "Color Scheme", "Choose the overall look of the interface", Ink90, Ink50, Opacity);
        for (uint32_t I = 0u; I < 7u; ++I)
        {
            const uint32_t Col = I % 4u, Row = I / 4u;
            const PlaneExtent Tile = Spanning(Content.MinimumX + Col * (TileW + 24.0f), Content.MinimumY + HeadH + Row * (CellH + 32.0f), TileW, TileH);
            TileExtents[I] = Tile;
            const bool Active = Draft.Theme == TileThemes[I];
            RecordThemeTile(Surface, Tile, TileThemes[I], Active, Radius, Pointer, Opacity);
            if (Active) ControlKit::OutlineRounded(Surface, PlaneExtent{ Tile.MinimumX - 2.0f, Tile.MinimumY - 2.0f, Tile.MaximumX + 2.0f, Tile.MaximumY + 2.0f }, ControlKit::Faded(ControlKitTokens::Accent, Opacity), 22.0f, 2.0f);
            const PlanePoint NM = Surface.MeasureText(Tiles[I].Name, 12.0f);
            Surface.Text(Tile.MinimumX + (TileW - NM.X) * 0.5f, Tile.MaximumY + 12.0f + (16.0f - NM.Y) * 0.5f, ControlKit::Faded(Active ? Ink90 : Ink50, Opacity), Tiles[I].Name, 12.0f);
            if (ControlKit::Over(Tile, Pointer) && Pointer.Released) Draft.Theme = TileThemes[I];
        }
        Y += H + SectionGap;
    }

    // ② Corner Radius — heading left, "Npx" right, slider below (Notch <Slider>: thin track).
    {
        const float HeadH = 20.0f + 4.0f + 16.0f + 24.0f;
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + ControlKitTokens::ControlHeight;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        ControlKit::SectionHeading(Surface, Content.MinimumX, Content.MinimumY, Content.Width(), "Corner Radius", "Adjust the roundness of UI elements", Ink90, Ink50, Opacity);
        char Value[8]; std::snprintf(Value, sizeof(Value), "%dpx", static_cast<int>(std::lround(Draft.CornerRadius)));
        const PlanePoint VM = Surface.MeasureText(Value, 12.0f);
        Surface.Text(Content.MaximumX - VM.X, Content.MinimumY + HeadH - 24.0f - 16.0f + (16.0f - VM.Y) * 0.5f, ControlKit::Faded(Ink50, Opacity), Value, 12.0f);
        RadiusSliderExtent = Spanning(Content.MinimumX, Content.MinimumY + HeadH, Content.Width(), ControlKitTokens::ControlHeight);
        float V = Draft.CornerRadius;
        const ControlHit Hit = ControlKit::Slider(Surface, RadiusSliderExtent, 0.0f, 32.0f, V, DraggingSlider == 2, Pointer, V, true, false, Opacity);
        if (Hit.Pressed) DraggingSlider = 2;
        if (DraggingSlider == 2) Draft.CornerRadius = std::round(V);
        Y += H + SectionGap;
    }

    // ③ Accent Color — flex-wrap gap-3 of 32 px swatches + dashed custom circle.
    {
        const float HeadH = 20.0f + 4.0f + 16.0f + 24.0f;
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + ControlKit::SwatchDiameter + 8.0f;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        ControlKit::SectionHeading(Surface, Content.MinimumX, Content.MinimumY, Content.Width(), "Accent Color", "Highlight colour for active controls", Ink90, Ink50, Opacity);
        const float Cy = Content.MinimumY + HeadH + 4.0f + 16.0f;
        for (uint32_t I = 0u; I < 10u; ++I)
        {
            const float Cx = Content.MinimumX + 16.0f + I * (ControlKit::SwatchDiameter + 12.0f);
            AccentExtents[I] = Spanning(Cx - 16.0f, Cy - 16.0f, 32.0f, 32.0f);
            if (ControlKit::Swatch(Surface, Cx, Cy, QueryAccentColour(static_cast<AccentCategory>(I)), static_cast<uint32_t>(Draft.Accent) == I, true, Pointer, Opacity).Clicked)
                Draft.Accent = static_cast<AccentCategory>(I);
        }
        // Custom picker placeholder (dashed border, "+") — picker itself is a later step.
        const float Cx = Content.MinimumX + 16.0f + 10u * (ControlKit::SwatchDiameter + 12.0f);
        {
            for (int I = 0; I < 24; I += 2)
            {
                const float A0 = 6.2831853f * I / 24.0f, A1 = 6.2831853f * (I + 1) / 24.0f;
                PlanePoint P[2] = { { Cx + std::cos(A0) * 16.0f, Cy + std::sin(A0) * 16.0f }, { Cx + std::cos(A1) * 16.0f, Cy + std::sin(A1) * 16.0f } };
                Surface.StrokePolyline(P, 2u, ControlKit::Faded(ColorQuad{ 1.0f, 1.0f, 1.0f, 0.06f }, Opacity), 1.0f, false);
            }
            const PlanePoint PM = Surface.MeasureText("+", 14.0f);
            Surface.Text(Cx - PM.X * 0.5f, Cy - PM.Y * 0.5f, ControlKit::Faded(Ink50, Opacity), "+", 14.0f);
        }
        Y += H + SectionGap;
    }

    // ④ Semantic Colors — Warning · Success · Info · Caution rows.
    {
        const float HeadH = 20.0f + 4.0f + 16.0f + 24.0f;
        const float RowH = 100.0f, RowGap = 32.0f + 1.0f + 32.0f;   // pb-8 border-b space-y-8
        const float H = ControlKit::SectionPadding * 2.0f + HeadH + RowH * 4.0f + RowGap * 3.0f;
        const PlaneExtent Content = ControlKit::SectionCard(Surface, Spanning(X, Y, W, H), Radius, Opacity);
        ControlKit::SectionHeading(Surface, Content.MinimumX, Content.MinimumY, Content.Width(), "Semantic Colors", "Tones used by alerts, dialogues and toasts", Ink90, Ink50, Opacity);
        float RowY = Content.MinimumY + HeadH;
        RecordSemanticRow(Surface, Content.MinimumX, RowY, Content.Width(), 0u, "Warning", Draft.WarningSwatch, ControlCentreIconCategory::TriangleAlert, Radius, false, Pointer, Opacity); RowY += RowH + RowGap;
        RecordSemanticRow(Surface, Content.MinimumX, RowY, Content.Width(), 1u, "Success", Draft.SuccessSwatch, ControlCentreIconCategory::CircleCheck,   Radius, false, Pointer, Opacity); RowY += RowH + RowGap;
        RecordSemanticRow(Surface, Content.MinimumX, RowY, Content.Width(), 2u, "Info",    Draft.InfoSwatch,    ControlCentreIconCategory::CircleInfo,    Radius, false, Pointer, Opacity); RowY += RowH + RowGap;
        RecordSemanticRow(Surface, Content.MinimumX, RowY, Content.Width(), 3u, "Caution", Draft.CautionSwatch, ControlCentreIconCategory::OctagonAlert,  Radius, true,  Pointer, Opacity);
        Y += H + SectionGap;
    }

    if (Pointer.Released) DraggingSlider = -1;
    return (Y + ScrollY) - Body.MinimumY - SectionGap;
}

} // namespace Frontier
