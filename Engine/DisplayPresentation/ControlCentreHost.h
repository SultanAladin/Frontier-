//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ControlCentreHost.h — Top Notch Control Centre: Drawer Locomotion, Notch Travel and Overlay Recording
//============================================================================================================================================
// 🧩 The pull-down shade behind a notch that hangs from the top edge of the display.
//
//    Geometry  (from the Notch reference, ArcNotch.tsx):
//      • notch handle 400 × 36 px, SVG outline
//            M 0 0  C 15 0, 20 6, 25 15  L 35 28  C 40 34, 45 36, 52 36  L 348 36  C 355 36, 360 34, 365 28
//            L 375 15  C 380 6, 385 0, 400 0  Z
//        tessellated once; the handle carries the project name centred in it.
//      • shade: a full-width sheet whose lower edge sits at the handle's top; closed at Y = 0, open at
//        Y = DisplayHeight − 36. Scrim over the scene fades 0 → 40 % black across that travel.
//
//    Interaction (from the Slate DrawerSpace):
//      • press on the handle grabs it; a release within 6 px / 350 ms is a TAP → toggle open/closed.
//      • the first travel past 6 px decides the axis ONCE: mostly-vertical → carry the shade (Y);
//        mostly-horizontal → slide the notch along the top edge (X) within ±(DisplayWidth − 400)/2.
//        Beyond a bound the carry accepts 5 % of the overshoot (elastic) and springs back on release.
//      • Y release classification (Notch ArcNotch.tsx): released past H/2 it stays open unless flung upward
//        faster than 20 px/s or pulled back more than 50 px; released before H/2 it closes unless flung downward
//        faster than 20 px/s or pulled more than 50 px. The release velocity is injected into the spring.
//      • while open, a press on the scrim (outside the shade content) closes the shade.
//
//    Rendering: Record(RecordingSurface&) — hosts call it after Advance*; nothing here names ImGui.
//
// ⚠️ Public API kept source-compatible with WorkspaceHost / Project-F20 (Initialize, Terminate, AdvanceInteraction,
//    AdvanceLocomotion, OpenNotch, CloseNotch, ToggleNotch, IsOpen, IsDragging, Query*/Convert).

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "ThemeStructure.h"
#include "MotionIntegrator.h"
#include "RecordingSurface.h"
#include "../DeviceExchange/InputExchange.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                 BEZIER POINT RECORD
//------------------------------------------------------------------------------------------------------------------------

struct BezierPointIndex
{
    float X;                 // [px]
    float Y;                 // [px]
};

//------------------------------------------------------------------------------------------------------------------------
//                                         CONTROL CENTRE PAGE CATEGORY  (content pages arrive in later steps)
//------------------------------------------------------------------------------------------------------------------------

enum class ControlCentrePageCategory : uint32_t
{
    Dashboard      = 0,
    SettingsHub    = 1,
    Appearance     = 2,
    Display        = 3,
    Input          = 4,
    Notifications  = 5,
    Count          = 6
};

enum class AppearanceSubTabCategory : uint32_t { Theme = 0, Fonts = 1, Display = 2, Count = 3 };
enum class DialogueCategory         : uint32_t { None = 0, ApplyPreferences = 1, DiscardChanges = 2, Count = 3 };

//------------------------------------------------------------------------------------------------------------------------
//                                                    DRAWER POSE
//------------------------------------------------------------------------------------------------------------------------

enum class ControlCentreHostState : uint32_t
{
    Closed   = 0,            // shade resting at Y = 0
    Opening  = 1,            // spring travelling downward
    Open     = 2,            // shade resting at Y = DisplayHeight − 36
    Closing  = 3,            // spring travelling upward
    Dragging = 4             // pointer carries the shade or the notch
};

//------------------------------------------------------------------------------------------------------------------------
//                                                CONTROL CENTRE HOST
//------------------------------------------------------------------------------------------------------------------------

class ControlCentreHost
{
public:
    // ── Figures (all from the references; change here, nowhere else) ────────────────────────────────────────────────
    static constexpr float  NotchWidth        = 400.0f;   // [px]
    static constexpr float  NotchHeight       =  36.0f;   // [px]
    static constexpr float  TapTravelLimit    =   6.0f;   // [px]   beyond this a contact is a drag
    static constexpr double TapDurationLimit  =   0.350;  // [s]    beyond this a contact is a press
    static constexpr double DragElasticity    =   0.05;   // [-]    fraction of overshoot accepted past a bound
    static constexpr double SnapRate          =  20.0;    // [px/s] Notch release-velocity threshold
    static constexpr double SnapOffset        =  50.0;    // [px]   Notch release-offset threshold
    static constexpr double RateRetention     =   0.60;   // [-]    velocity estimate smoothing
    static constexpr float  ScrimMaxAlpha     =   0.40f;  // [-]    black over the scene when fully open

    ControlCentreHost() noexcept;
    ~ControlCentreHost() noexcept = default;

    ControlCentreHost(const ControlCentreHost&)            = delete;
    ControlCentreHost& operator=(const ControlCentreHost&) = delete;

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] bool      Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept;
    void                    Terminate() noexcept;
    void                    Resize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept;

    // ── Per-frame ─────────────────────────────────────────────────────────────────────────────────────────────────
    void                    AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept;
    void                    AdvanceLocomotion(float DeltaSeconds) noexcept;
    void                    Record(RecordingSurface& Surface) const noexcept;

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────────
    void                    OpenNotch() noexcept;
    void                    CloseNotch() noexcept;
    void                    ToggleNotch() noexcept;
    void                    AssignProjectName(std::string Name) noexcept { ProjectName = std::move(Name); }

    // ── Page navigation (state only in this step; pages are recorded in later steps) ─────────────────────────────
    void                    NavigateToPage(ControlCentrePageCategory TargetPage) noexcept;
    void                    NavigateBack() noexcept;
    [[nodiscard]] ControlCentrePageCategory QueryActivePage()   const noexcept { return ActivePage; }
    [[nodiscard]] ControlCentrePageCategory QueryPreviousPage() const noexcept { return PreviousPage; }
    [[nodiscard]] float     QuerySlideOffset() const noexcept;
    [[nodiscard]] bool      IsSlideTransitionActive() const noexcept;

    void                    AssignAppearanceSubTab(AppearanceSubTabCategory SubTab) noexcept { ActiveAppearanceSubTab = SubTab; }
    [[nodiscard]] AppearanceSubTabCategory QueryAppearanceSubTab() const noexcept { return ActiveAppearanceSubTab; }

    void                    OpenDialogue(DialogueCategory Dialogue) noexcept { ActiveDialogue = Dialogue; }
    void                    CloseDialogue() noexcept { ActiveDialogue = DialogueCategory::None; }
    [[nodiscard]] DialogueCategory QueryActiveDialogue() const noexcept { return ActiveDialogue; }
    [[nodiscard]] bool      IsDialogueOpen() const noexcept { return ActiveDialogue != DialogueCategory::None; }

    // ── Theme ─────────────────────────────────────────────────────────────────────────────────────────────────────
    void                    SelectTheme(ThemeCategory Theme) noexcept { ActiveTheme.AssignTheme(Theme); }
    void                    AssignCornerRadius(float RadiusPixels) noexcept { ActiveTheme.AssignCornerRadius(RadiusPixels); }
    void                    SelectFontFamily(FontFamilyCategory Family) noexcept { ActiveTheme.AssignFontFamily(Family); }
    [[nodiscard]] ThemeCategory      QueryThemeCategory() const noexcept { return ActiveTheme.QueryActiveTheme(); }
    [[nodiscard]] float              QueryCornerRadius()  const noexcept { return ActiveTheme.QueryCornerRadius(); }
    [[nodiscard]] FontFamilyCategory QueryFontFamily()    const noexcept { return ActiveTheme.QueryActiveFontFamily(); }
    [[nodiscard]] const ThemeStructure& QueryTheme() const noexcept { return ActiveTheme; }
    ThemeStructure&         AccessTheme() noexcept { return ActiveTheme; }

    // ── Queries ───────────────────────────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] bool      IsOpen()      const noexcept { return Pose == ControlCentreHostState::Open || Pose == ControlCentreHostState::Opening; }
    [[nodiscard]] bool      IsDragging()  const noexcept { return Pose == ControlCentreHostState::Dragging; }
    [[nodiscard]] bool      IsSelected()  const noexcept { return Grabbed; }
    [[nodiscard]] bool      IsHovered()   const noexcept { return Hovered; }
    [[nodiscard]] bool      CoversPointer() const noexcept { return PointerWithheld; }   // 📝 true when the overlay owns the pointer this frame
    [[nodiscard]] ControlCentreHostState QueryPose() const noexcept { return Pose; }
    [[nodiscard]] float     QueryCurrentHeight() const noexcept;                          // [px] shade Y (0 closed … H−36 open)
    [[nodiscard]] float     QueryHandleX() const noexcept;                                // [px] notch left edge
    [[nodiscard]] float     QueryHandleY() const noexcept { return QueryCurrentHeight(); }
    [[nodiscard]] float     QueryHandleWidth()  const noexcept { return NotchWidth;  }
    [[nodiscard]] float     QueryHandleHeight() const noexcept { return NotchHeight; }
    [[nodiscard]] PlaneExtent QueryHandleExtent() const noexcept;
    [[nodiscard]] const std::vector<BezierPointIndex>& QueryHandleContour() const noexcept { return HandleContour; }

    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    enum class GrabSubject : uint32_t { Nothing = 0, Notch = 1, Scrim = 2 };

    void                    GenerateHandleContour() noexcept;
    void                    Grab(GrabSubject Subject, float CursorX, float CursorY) noexcept;
    void                    Carry(float CursorX, float CursorY, float DeltaSeconds) noexcept;
    void                    Relinquish() noexcept;
    void                    Depart(bool Opening) noexcept;
    [[nodiscard]] double    OpenTravel() const noexcept { return static_cast<double>(DisplayHeight) - NotchHeight; }
    [[nodiscard]] double    NotchAdmissible() const noexcept;
    [[nodiscard]] static double Constrain(double Value, double Minimum, double Maximum, double Elasticity) noexcept;

    // ── Display ───────────────────────────────────────────────────────────────────────────────────────────────────
    uint32_t                DisplayWidth;
    uint32_t                DisplayHeight;

    // ── Motion ────────────────────────────────────────────────────────────────────────────────────────────────────
    MotionIntegrator        Motion;
    uint32_t                ShadeChannel;            // [px] Y of the shade's lower edge (= notch top)
    uint32_t                NotchChannel;            // [px] signed X travel of the notch from centre
    uint32_t                SlideChannel;            // [px] page carousel offset (later steps)

    // ── Pose ──────────────────────────────────────────────────────────────────────────────────────────────────────
    ControlCentreHostState  Pose;
    bool                    OpenBeforeGrab;          // [-] pose the grab started from, for classification

    // ── Contact ───────────────────────────────────────────────────────────────────────────────────────────────────
    GrabSubject             GrabbedSubject;
    bool                    Grabbed;
    bool                    Hovered;
    bool                    PointerWithheld;
    bool                    PreviousButton;
    bool                    AxisResolved;
    bool                    YDominant;
    bool                    TravelExceeded;
    double                  ContactDuration;         // [s]
    float                   GrabCursorX, GrabCursorY;
    double                  GrabShadeY;
    double                  GrabNotchX;
    float                   PreviousCursorX, PreviousCursorY;
    double                  RateX, RateY;            // [px/s] smoothed pointer velocity
    float                   LastDeltaSeconds;        // [s]    last locomotion step, used by the velocity estimate

    // ── Pages (state only) ────────────────────────────────────────────────────────────────────────────────────────
    ControlCentrePageCategory ActivePage;
    ControlCentrePageCategory PreviousPage;
    AppearanceSubTabCategory  ActiveAppearanceSubTab;
    DialogueCategory          ActiveDialogue;
    std::vector<ControlCentrePageCategory> PageHistoryStack;

    // ── Appearance ────────────────────────────────────────────────────────────────────────────────────────────────
    ThemeStructure          ActiveTheme;
    std::string             ProjectName;
    std::vector<BezierPointIndex> HandleContour;   // [px] outline in notch-local space (0..400 × 0..36)
    bool                    InitializedCondition;
};

template<> inline bool  ControlCentreHost::Convert<bool>()  const noexcept { return IsOpen(); }
template<> inline float ControlCentreHost::Convert<float>() const noexcept { return QueryCurrentHeight(); }
template<> inline ControlCentrePageCategory ControlCentreHost::Convert<ControlCentrePageCategory>() const noexcept { return ActivePage; }

} // namespace Frontier
