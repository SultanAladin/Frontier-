//============================================================================================================================================
//                                                       TABLETSCREENSEQUENCE.H
//============================================================================================================================================
// 🧩 The shared-device launcher and its applications, ported from the accepted HTML prototype
//    (Experimental/TabletPanel/ScreenSequence.js + AppSpecification.js + IconDepot.js). One 1200 × 750 design space,
//    five launcher designs (Launchpad, Dashboard, Collections, Focus, Console), twelve applications, retained hit
//    regions, the Settings design picker, sliders, the Garage preview and the touch rules — drawn into any sheet
//    through DisplayRasterProjection, and centred on any panel aspect without stretching (PresentAspect).
//
//    Vehicle-neutral by design: the project supplies a TabletReading (speed, gear, ambient, tyres) and, for the Garage,
//    a preview sheet it rendered itself. The sequence never names a car model beyond the string the project gives it.

#pragma once

#include "DisplayRasterProjection.h"
#include "DisplayTouchProjection.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

inline constexpr float kTabletDesignWidth  = 1200.0f;   // [design] the prototype's ScreenWidth
inline constexpr float kTabletDesignHeight = 750.0f;    // [design] ScreenHeight

enum class LauncherDesignCategory : uint32_t { Launchpad = 0u, Dashboard = 1u, Collections = 2u, Focus = 3u, Console = 4u, Count = 5u };

struct TabletApplication
{
    const char* Identifier; const char* Name; const char* Caption; const char* Category; const char* Colour; const char* Badge;
};
inline constexpr uint32_t kTabletApplicationCount = 12u;
[[nodiscard]] const TabletApplication* QueryTabletApplications() noexcept;   // the twelve, prototype order
[[nodiscard]] const char* QueryLauncherDesignName(LauncherDesignCategory Design) noexcept;
[[nodiscard]] const char* QueryLauncherDesignCaption(LauncherDesignCategory Design) noexcept;

// What the vehicle tells the tablet each cycle.
struct TabletReading
{
    float       SpeedKph = 0.0f;
    const char* Gear = "P";
    float       AmbientCelsius = 22.0f;
    float       TreadCelsius[4] = { 20.0f, 20.0f, 20.0f, 20.0f };
    float       PressureKpa[4] = { 185.0f, 185.0f, 185.0f, 185.0f };
    const char* VehicleName = "ControlVehicle";
    bool        Live = false;              // false ⇒ the status line says "LOCAL DEMO"
};

// The Garage preview the project renders (its own camera and lighting over the real vehicle mesh).
struct TabletPreviewSource
{
    const DisplaySheetStructure* Sheet = nullptr;   // 640 × 400 expected, drawn 1:1
    uint32_t                     Facets = 0u;
    bool                         Spin = true;
    float                        OrbitYaw = 0.0f, OrbitPitch = 0.0f;   // [rad] accumulated by drags
    bool                         Dirty = false;                        // set by the sequence when the user orbits/toggles
    const char*                  Failure = nullptr;
};

struct TabletValues
{
    float Steering = 50.0f, Height = 35.0f, Stiffness = 65.0f, Spoiler = 14.0f, Pressure = 185.0f, Temperature = 22.0f,
          Fan = 2.0f, Volume = 55.0f, Brightness = 90.0f, Laps = 8.0f, Zoom = 1.0f;
};

struct TabletScreenReading
{
    LauncherDesignCategory Design = LauncherDesignCategory::Launchpad;
    const char*            Application = nullptr;     // null on the launcher
    uint64_t               Revision = 0u;
    uint32_t               RegionCount = 0u;
    uint32_t               FocusIndex = 0u;
    TabletValues           Values;
    bool                   RoomReady = false;
    uint32_t               MessageCount = 0u;
    std::string            Nickname;
    std::string            Hovered, Pressed;
};

class TabletScreenSequence
{
public:
    TabletScreenSequence() noexcept;

    // Faces for text (Light 300 / Regular 400 / Medium 500). Any may be null; text then falls back to the next face.
    void AssignTypefaces(TypefaceSheetCodec* Light, TypefaceSheetCodec* Regular, TypefaceSheetCodec* Medium) noexcept;
    void AssignPreview(TabletPreviewSource* Source) noexcept { Preview = Source; Dirty = true; }
    void AssignReading(const TabletReading& Reading) noexcept;

    // Panel aspect (width / height) and raster density (sheet pixels per design unit). The 16:10 layout keeps its
    //    uniform scale; spare bands continue the background. Returns true when the sheet size changed.
    bool PresentAspect(float Aspect, float Scale) noexcept;
    [[nodiscard]] bool PresentDesign(LauncherDesignCategory Design) noexcept;
    void PresentHome() noexcept;
    [[nodiscard]] bool PresentApplication(const char* Identifier) noexcept;
    void AdvanceClock(int Hour, int Minute) noexcept;

    // Rasterises when dirty. Returns true when the sheet changed (its revision advanced).
    bool Raster() noexcept;
    [[nodiscard]] const DisplaySheetStructure& QuerySheet() const noexcept { return Sheet; }
    [[nodiscard]] DisplaySheetStructure&       AccessSheet()      noexcept { return Sheet; }
    [[nodiscard]] bool                         IsDirty() const noexcept { return Dirty; }
    void MarkDirty() noexcept { Dirty = true; }

    // Touch in SHEET pixels (what DisplayTouchProjection yields); the sequence converts to design space itself.
    void ForwardTouch(const DisplayTouchReading& Touch) noexcept;
    // Text entry from whatever keyboard the host offers (TextTarget decides where it lands).
    void AdmitText(const char* Text) noexcept;
    // One keystroke into the focused field: UTF-8 appended, U+0008 deletes the last code point, U+000A commits
    //    (sends the message / saves the name). Ignored when no field has focus.
    void TypeCharacter(uint32_t Codepoint) noexcept;
    [[nodiscard]] bool WantsText() const noexcept { return !TextTarget.empty(); }

    [[nodiscard]] TabletScreenReading QueryReading() const noexcept;
    [[nodiscard]] const char* QueryTextTarget() const noexcept { return TextTarget.c_str(); }
    // Hit test in design units (for proofs and for the host): identifier of the topmost region, or empty.
    [[nodiscard]] std::string QueryContactIdentifier(float Across, float Down) const noexcept;   // sheet pixels
    [[nodiscard]] float QueryPanelWidth()  const noexcept { return PanelWidth; }
    [[nodiscard]] float QueryPanelHeight() const noexcept { return PanelHeight; }

    // Icon artwork: the prototype's SVG, rasterised once per (application, pixel extent). Exposed for proofs.
    [[nodiscard]] const DisplaySheetStructure& IconSheet(uint32_t ApplicationIndex, uint32_t PixelExtent) noexcept;

private:
    enum class ActionCategory : uint32_t
    {
        None, Home, Application, Design, FocusIndex, VehicleTab, VehicleReset, ToggleReady, SendMessage, ReceiveText,
        Invite, SaveName, Increment, ToggleMedia, SelectColour, ToggleSpin
    };
    struct Region
    {
        std::string    Identifier;
        float          Left, Top, Width, Height;
        ActionCategory Action = ActionCategory::None;
        std::string    Argument;
        float          Number = 0.0f, Minimum = 0.0f, Maximum = 0.0f;   // Increment: delta/min/max
        int            SliderValue = -1;                                 // index into TabletValues, −1 none
        float          TrackLeft = 0.0f, TrackWidth = 0.0f, Step = 1.0f;
        bool           Swipe = false, Orbit = false;
    };
    struct IconRecord { uint32_t Application; uint32_t Extent; DisplaySheetStructure Sheet; };

    // drawing (design space)
    void RasterRectangle(float L, float T, float W, float H, float R, const DisplayPaint& Paint, const char* Stroke = nullptr) noexcept;
    void RasterText(const char* Text, float L, float T, float Size, const char* Colour, DisplayTextAlignment Align = DisplayTextAlignment::Left, DisplayTextWeight Weight = DisplayTextWeight::Regular) noexcept;
    void RasterIcon(uint32_t Application, float L, float T, float Extent) noexcept;
    void RasterRule(float L, float T, float W, const char* Colour) noexcept;
    void RasterBadge(const char* Text, float CentreX, float CentreY) noexcept;
    void RasterButton(const char* Identifier, const char* Text, float L, float T, float W, float H, ActionCategory Action, const char* Argument,
                      const char* Colour = "#253939", const char* Ink = "#d7e7df") noexcept;
    void RasterBackground(bool Light) noexcept;
    void RasterStatus(bool Light) noexcept;
    void RasterFooter(bool Light) noexcept;
    void RasterApplicationTile(uint32_t Index, float L, float T, float W, float H, int Style, bool Light) noexcept;
    void RasterSlider(int Value, const char* Identifier, const char* Name, const char* Unit, float L, float T, float W, float Minimum, float Maximum, float Step = 1.0f) noexcept;
    void RasterLaunchpad() noexcept; void RasterDashboard() noexcept; void RasterCollections() noexcept; void RasterFocus() noexcept; void RasterConsole() noexcept;
    void RasterApplication() noexcept; void RasterApplicationContent(const char* Identifier) noexcept;
    void RasterDesignSchematic(LauncherDesignCategory Design, float L, float T, const char* Colour) noexcept;
    Region& AdmitRegion(const char* Identifier, float L, float T, float W, float H, ActionCategory Action, const char* Argument = "") noexcept;

    // behaviour
    const Region* QueryContact(float Across, float Down) const noexcept;
    void Perform(const Region& Region) noexcept;
    void AdvanceSlider(const Region& Region, float Across) noexcept;
    void IncrementValue(int Value, float Difference, float Minimum, float Maximum) noexcept;
    void DeliverMessage() noexcept;
    void ReceiveText(const char* Target) noexcept;
    [[nodiscard]] static float& ValueAt(TabletValues& Values, int Index) noexcept;
    [[nodiscard]] static int ValueIndex(const char* Identifier) noexcept;

    DisplaySheetStructure    Sheet;
    DisplaySheetStructure    Background;               // cached wallpaper gradients (see RasterBackground)
    bool                     BackgroundValid = false, BackgroundLight = false;
    DisplayRasterProjection  Raster_;
    TypefaceSheetCodec*      Faces[3] = { nullptr, nullptr, nullptr };
    TabletPreviewSource*     Preview = nullptr;
    TabletReading            Reading;
    LauncherDesignCategory   Design = LauncherDesignCategory::Launchpad;
    std::string              Application;          // empty on the launcher
    std::vector<Region>      Regions;
    std::string              Hovered, Pressed, TextTarget, Notice, Clock, VehicleTab = "Steering", Invited, Nickname = "Aladin", MessageDraft, FinishColour = "#a4d8be";
    struct Message { std::string From, Text; };
    std::vector<Message>     Messages;
    TabletValues             Values;
    uint32_t                 FocusIndex = 0u;
    bool                     RoomReady = false, MediaPlaying = false, Dirty = true;
    float                    Scale = 1.5f, OffsetAcross = 0.0f, OffsetDown = 0.0f, PanelWidth = kTabletDesignWidth, PanelHeight = kTabletDesignHeight;
    // active pointer
    bool                     PointerHeld = false;
    const Region*            PointerContact = nullptr;   // index-stable only until the next raster: we store the identifier too
    std::string              PointerIdentifier;
    float                    PointerStartAcross = 0.0f, PointerStartDown = 0.0f, PointerPreviousAcross = 0.0f, PointerPreviousDown = 0.0f;
    std::vector<IconRecord>  Icons;
    std::vector<DisplayVectorArt> IconArt;   // decoded once per application
};

} // namespace Frontier
