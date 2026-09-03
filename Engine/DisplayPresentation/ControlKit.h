//========================================================================================================================
// 🧩 ControlKit — reusable immediate-mode widgets for the Control Centre and every later docket / inspector.
//    Visuals are the Slate base component kit (References/UIComponents.html) — tokens, sizes, radii verbatim.
//    Widgets record into a PixelSpace and report hits; the calling host owns every value.
//========================================================================================================================
#pragma once

#include "PixelSpace.h"
#include "ThemeStructure.h"
#include "VectorCodec.h"

#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    DESIGN TOKENS  (UIComponents.html :root)
//------------------------------------------------------------------------------------------------------------------------

struct ControlKitTokens
{
    static constexpr ColorQuad Panel        { 0x12 / 255.0f, 0x12 / 255.0f, 0x12 / 255.0f, 1.0f };   // --panel
    static constexpr ColorQuad Inset        { 0x1A / 255.0f, 0x1A / 255.0f, 0x1A / 255.0f, 1.0f };   // --inset
    static constexpr ColorQuad Field        { 0.0f, 0.0f, 0.0f, 1.0f };                               // --field
    static constexpr ColorQuad Raised       { 0x22 / 255.0f, 0x22 / 255.0f, 0x22 / 255.0f, 1.0f };   // --raised
    static constexpr ColorQuad Selected     { 0x2A / 255.0f, 0x2A / 255.0f, 0x2A / 255.0f, 1.0f };   // --selected
    static constexpr ColorQuad Stroke       { 1.0f, 1.0f, 1.0f, 0.05f };                              // --stroke
    static constexpr ColorQuad StrokeStrong { 0x2E / 255.0f, 0x2E / 255.0f, 0x2E / 255.0f, 1.0f };   // --stroke-strong
    static constexpr ColorQuad Text         { 0xF0 / 255.0f, 0xF0 / 255.0f, 0xF0 / 255.0f, 1.0f };   // --text
    static constexpr ColorQuad TextDim      { 0x88 / 255.0f, 0x88 / 255.0f, 0x88 / 255.0f, 1.0f };   // --text-dim
    static constexpr ColorQuad TextFaint    { 0x5C / 255.0f, 0x5C / 255.0f, 0x5C / 255.0f, 1.0f };   // --text-faint
    static constexpr ColorQuad Accent       { 1.0f, 1.0f, 1.0f, 1.0f };                               // --accent
    static constexpr ColorQuad AccentSoft   { 1.0f, 1.0f, 1.0f, 0.12f };                              // --accent-soft
    static constexpr ColorQuad Highlight    { 0x6C / 255.0f, 0x77 / 255.0f, 0xFF / 255.0f, 1.0f };   // --hi
    static constexpr ColorQuad Danger       { 0xEF / 255.0f, 0x44 / 255.0f, 0x44 / 255.0f, 1.0f };   // --danger
    static constexpr ColorQuad Ok           { 0x22 / 255.0f, 0xC5 / 255.0f, 0x5E / 255.0f, 1.0f };   // --ok
    static constexpr ColorQuad Warning      { 0xF5 / 255.0f, 0x9E / 255.0f, 0x0B / 255.0f, 1.0f };   // amber-500 (Notch warning default)
    static constexpr ColorQuad Caution      { 0xEA / 255.0f, 0xB3 / 255.0f, 0x08 / 255.0f, 1.0f };   // yellow-500
    static constexpr ColorQuad PrimaryInk   { 0x11 / 255.0f, 0x11 / 255.0f, 0x11 / 255.0f, 1.0f };   // .btn.primary color #111
    static constexpr ColorQuad SliderFill   { 0x7A / 255.0f, 0x7A / 255.0f, 0x7A / 255.0f, 1.0f };   // slider filled side
    static constexpr ColorQuad SliderThumb  { 0xE0 / 255.0f, 0xE0 / 255.0f, 0xE0 / 255.0f, 1.0f };   // slider thumb
    static constexpr ColorQuad SwitchKnobOff{ 0xBD / 255.0f, 0xBD / 255.0f, 0xBD / 255.0f, 1.0f };   // switch knob (off)

    static constexpr float RadiusPanel   = 24.0f;   // --r-panel
    static constexpr float RadiusInset   = 18.0f;   // --r-inset
    static constexpr float RadiusPill    = 999.0f;  // --r-pill (clamped to half height)
    static constexpr float ControlHeight = 40.0f;   // --ctl-h
    static constexpr float RowHeight     = 36.0f;   // --row-h
    static constexpr float LabelWidth    = 110.0f;  // .crow > .clabel
    static constexpr float RowGap        = 14.0f;   // .crow gap
    static constexpr float DisabledAlpha = 0.35f;   // .btn[disabled]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     WIDGET STATE
//------------------------------------------------------------------------------------------------------------------------

// Pointer state the host feeds every widget call. Widgets never poll input themselves.
struct ControlPointer
{
    float X          = 0.0f;   // [px]
    float Y          = 0.0f;   // [px]
    bool  Down       = false;  // [-] button held this frame
    bool  Pressed    = false;  // [-] transitioned up → down this frame
    bool  Released   = false;  // [-] transitioned down → up this frame
    bool  Enabled    = true;   // [-] false while the page is mid-swap or a dialogue covers it
};

enum class ButtonToneCategory : uint32_t { Primary = 0, Secondary = 1, Ghost = 2, Danger = 3, Tinted = 4 };

struct ButtonStructure
{
    const char*        Label    = "";
    ButtonToneCategory Tone     = ButtonToneCategory::Secondary;
    ColorQuad          Tint     = ControlKitTokens::Accent;   // Tinted: fill colour; Danger: text colour
    bool               Disabled = false;
    float              FontSize = 13.5f;
    float              PaddingX = 20.0f;
    float              Height   = ControlKitTokens::ControlHeight;
};

// Result of any interactive widget for one frame.
struct ControlHit
{
    bool Hovered  = false;
    bool Pressed  = false;   // pointer went down on it this frame
    bool Clicked  = false;   // pointer released on it this frame after going down on it (host tracks the down)
    bool Dragging = false;   // sliders: pointer held inside the track's row
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      CONTROL KIT
//------------------------------------------------------------------------------------------------------------------------

class ControlKit
{
public:
    // ── Primitives ───────────────────────────────────────────────────────────────────────────────────────────────────
    static void  OutlineRounded(PixelSpace& Surface, const PlaneExtent& Extent, ColorQuad Colour, float Radius, float Thickness = 1.0f) noexcept;
    static void  FillCircle    (PixelSpace& Surface, float CentreX, float CentreY, float Radius, ColorQuad Colour) noexcept
    {
        Surface.FillRectangle(Spanning(CentreX - Radius, CentreY - Radius, Radius * 2.0f, Radius * 2.0f), Colour, Radius);
    }
    static void  OutlineCircle (PixelSpace& Surface, float CentreX, float CentreY, float Radius, ColorQuad Colour, float Thickness) noexcept;
    static void  Divider       (PixelSpace& Surface, float X, float Y, float Width, ColorQuad Colour = ControlKitTokens::Stroke) noexcept;
    static void  TextCentred   (PixelSpace& Surface, const PlaneExtent& Extent, ColorQuad Colour, const char* Utf8, float Size) noexcept;
    static void  TextLeading   (PixelSpace& Surface, const PlaneExtent& Extent, float PadX, ColorQuad Colour, const char* Utf8, float Size) noexcept;
    static void  Glyph         (PixelSpace& Surface, float X, float Y, float Size, ColorQuad Colour, ControlCentreIconCategory Icon, float Stroke = 2.0f) noexcept;
    static void  GlyphCentred  (PixelSpace& Surface, const PlaneExtent& Extent, float Size, ColorQuad Colour, ControlCentreIconCategory Icon, float Stroke = 2.0f) noexcept;

    // ── Measurement ──────────────────────────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] static float ButtonWidth(PixelSpace& Surface, const ButtonStructure& Button) noexcept;

    // ── Widgets (kit classes in comments) ────────────────────────────────────────────────────────────────────────────
    // .btn .primary / (secondary) / .ghost / .danger / [disabled]
    static ControlHit PillButton(PixelSpace& Surface, const PlaneExtent& Extent, const ButtonStructure& Button, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;

    // .switch  46 × 26, knob 20, on = accent fill + #111 knob. Returns Clicked when toggled.
    static ControlHit Switch(PixelSpace& Surface, float X, float Y, bool On, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;
    static constexpr float SwitchWidth = 46.0f, SwitchHeight = 26.0f;

    // .seg  pill group; returns the index under a click via OutIndex (unchanged when no click).
    static ControlHit Segmented(PixelSpace& Surface, const PlaneExtent& Extent, const char* const* Labels, uint32_t Count, uint32_t Active, const ControlPointer& Pointer, uint32_t& OutIndex, float Opacity = 1.0f) noexcept;

    // input[type=range].slider (28 px track, 26 px thumb) — Thin: 10 px / 18 px. Writes OutValue while dragging.
    static ControlHit Slider(PixelSpace& Surface, const PlaneExtent& Extent, float Minimum, float Maximum, float Value, bool Dragging, const ControlPointer& Pointer, float& OutValue, bool Thin = false, bool HighlightFill = false, float Opacity = 1.0f) noexcept;
    static constexpr float SliderHeight = 28.0f, SliderThinHeight = 10.0f, SliderThumb = 26.0f, SliderThinThumb = 18.0f;

    // .vpill  118 px: number cell (field) + 44 px unit cell (inset).
    static void ValuePill(PixelSpace& Surface, float X, float Y, const char* Number, const char* Unit, float Opacity = 1.0f) noexcept;
    static constexpr float ValuePillWidth = 118.0f, ValuePillUnitWidth = 44.0f;

    // .dd-btn  pill with split caret cell. Returns Clicked when the button is clicked (host opens the menu).
    static ControlHit Dropdown(PixelSpace& Surface, const PlaneExtent& Extent, const char* Current, bool Open, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;
    // .dd-menu  floating list under the button; returns chosen index via OutIndex (unchanged when none).
    static ControlHit DropdownMenu(PixelSpace& Surface, const PlaneExtent& ButtonExtent, const char* const* Options, uint32_t Count, uint32_t Selected, const ControlPointer& Pointer, uint32_t& OutIndex, float Opacity = 1.0f) noexcept;
    static constexpr float DropdownOptionHeight = 36.0f;   // 9 px pad × 2 + 13 px text leading
    [[nodiscard]] static PlaneExtent DropdownMenuExtent(const PlaneExtent& ButtonExtent, uint32_t Count) noexcept;

    // Notch <section>: p-6, bg inputBg (white/5), border panelBorder, radius = corner radius; returns content extent.
    [[nodiscard]] static PlaneExtent SectionCard(PixelSpace& Surface, const PlaneExtent& Extent, float Radius, float Opacity = 1.0f) noexcept;
    static constexpr float SectionPadding = 24.0f;

    // Section heading: text-sm bold title + text-xs muted description (Notch ThemeTab); returns the height consumed.
    static float SectionHeading(PixelSpace& Surface, float X, float Y, float Width, const char* Title, const char* Description, ColorQuad TitleInk, ColorQuad MutedInk, float Opacity = 1.0f) noexcept;

    // Circular colour swatch 32 px; Selected draws the 2 px ring at inset −4 (Notch accent) or a white border-2 (Notch semantic).
    static ControlHit Swatch(PixelSpace& Surface, float CentreX, float CentreY, ColorQuad Colour, bool Selected, bool RingStyle, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;
    static constexpr float SwatchDiameter = 32.0f;

    // Notch FontsTab chip: px-3 py-1.5 text-xs font-semibold rounded-md; active = white bg / black text, idle muted → white on hover.
    static ControlHit ChipButton(PixelSpace& Surface, const PlaneExtent& Extent, const char* Label, bool Active, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;
    [[nodiscard]] static float ChipWidth(PixelSpace& Surface, const char* Label) noexcept;
    static constexpr float ChipHeight = 28.0f;   // 12 px text + 6 px × 2 padding (+ leading)

    // Notch 32 px round bordered icon button (w-8 h-8 rounded-full border, hover white/5).
    static ControlHit RoundIconButton(PixelSpace& Surface, float CentreX, float CentreY, ControlCentreIconCategory Icon, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;
    static constexpr float RoundIconDiameter = 32.0f;

    // .crow  110 px dim label; returns the control extent to the right of the label.
    [[nodiscard]] static PlaneExtent ControlRow(PixelSpace& Surface, float X, float Y, float Width, const char* Label, ColorQuad LabelInk, float Opacity = 1.0f) noexcept;

    // Pointer helper: hit-test honouring Enabled.
    [[nodiscard]] static bool Over(const PlaneExtent& Extent, const ControlPointer& Pointer) noexcept
    {
        return Pointer.Enabled && Extent.Encloses(Pointer.X, Pointer.Y);
    }
    [[nodiscard]] static ColorQuad Faded(ColorQuad Colour, float Opacity) noexcept { Colour.Alpha *= Opacity; return Colour; }
};

} // namespace Frontier
