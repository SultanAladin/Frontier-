//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ControlCentrePanel.h — Organic Top Notch Control Centre Overlay and Stepper Carousel Locomotion
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "ThemeStructure.h"
#include "VectorCodec.h"
#include "../DeviceExchange/InputExchange.h"
#include <cstdint>
#include <vector>
#include <array>
#include <string_view>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                 BEZIER POINT RECORD
//------------------------------------------------------------------------------------------------------------------------

struct BezierPointRecord
{
    float                   X;                                  // [px] horizontal coordinate
    float                   Y;                                  // [px] vertical coordinate
};

//------------------------------------------------------------------------------------------------------------------------
//                                         CONTROL CENTRE PAGE CATEGORY
//------------------------------------------------------------------------------------------------------------------------

enum class ControlCentrePageCategory : uint32_t
{
    Dashboard                           = 0,                    // 0: Master quick toggle dashboard & master sliders
    SettingsHub                         = 1,                    // 1: Primary settings categories hub
    Appearance                          = 2,                    // 2: Theme, typography roles & corner roundness
    Display                             = 3,                    // 3: Resolution, scaling, refresh rate & VSync
    Input                               = 4,                    // 4: Navigation presets, mouse sensitivity & keybindings
    Notifications                       = 5,                    // 5: Alert sounds, RAM monitor & task alerts
    Count                               = 6
};

//------------------------------------------------------------------------------------------------------------------------
//                                             CONTROL CENTRE PANEL STATE
//------------------------------------------------------------------------------------------------------------------------

enum class ControlCentrePanelState : uint32_t
{
    Closed                              = 0,                    // Retracted at Y = 0px
    Opening                             = 1,                    // Spring locomotion translating downward
    Open                                = 2,                    // Fully deployed at Y = ScreenHeight - 36px
    Closing                             = 3,                    // Spring locomotion retracting upward
    Dragging                            = 4                     // Direct pointer dragging
};

//------------------------------------------------------------------------------------------------------------------------
//                                                CONTROL CENTRE PANEL
//------------------------------------------------------------------------------------------------------------------------

class ControlCentrePanel
{
public:
    ControlCentrePanel() noexcept;
    ~ControlCentrePanel() noexcept = default;

    ControlCentrePanel(const ControlCentrePanel&) = delete;
    ControlCentrePanel& operator=(const ControlCentrePanel&) = delete;

    [[nodiscard]] bool      Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept;
    void                    Terminate() noexcept;

    void                    AdvanceLocomotion(float DeltaSeconds) noexcept;
    void                    AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept;

    void                    OpenNotch() noexcept;
    void                    CloseNotch() noexcept;
    void                    ToggleNotch() noexcept;

    // Stepper Carousel Page Navigation
    void                    NavigateToPage(ControlCentrePageCategory TargetPage) noexcept;
    void                    NavigateBack() noexcept;
    [[nodiscard]] ControlCentrePageCategory QueryActivePage() const noexcept { return ActivePage; }
    [[nodiscard]] ControlCentrePageCategory QueryPreviousPage() const noexcept { return PreviousPage; }
    [[nodiscard]] float     QuerySlideOffset() const noexcept { return CurrentSlideOffset; }
    [[nodiscard]] bool      IsSlideTransitionActive() const noexcept;

    // Theme & Global UI Rounding Controls
    void                    SelectTheme(ThemeCategory Theme) noexcept { ActiveTheme.AssignTheme(Theme); }
    void                    AssignCornerRadius(float RadiusPixels) noexcept { ActiveTheme.AssignCornerRadius(RadiusPixels); }
    [[nodiscard]] ThemeCategory QueryThemeCategory() const noexcept { return ActiveTheme.QueryActiveTheme(); }
    [[nodiscard]] float     QueryCornerRadius() const noexcept { return ActiveTheme.QueryCornerRadius(); }

    [[nodiscard]] bool      IsOpen() const noexcept { return OpenCondition; }
    [[nodiscard]] bool      IsDragging() const noexcept { return DraggingCondition; }
    [[nodiscard]] bool      IsSelected() const noexcept { return SelectedCondition; }
    [[nodiscard]] float     QueryCurrentHeight() const noexcept { return CurrentOffsetY; }
    [[nodiscard]] float     QueryHandleX() const noexcept { return HandlePositionX; }
    [[nodiscard]] float     QueryHandleY() const noexcept { return HandlePositionY; }
    [[nodiscard]] float     QueryHandleWidth() const noexcept { return 400.0f; }
    [[nodiscard]] float     QueryHandleHeight() const noexcept { return 36.0f; }

    [[nodiscard]] const ThemeStructure& QueryTheme() const noexcept { return ActiveTheme; }
    ThemeStructure&         AccessTheme() noexcept { return ActiveTheme; }

    [[nodiscard]] const std::vector<BezierPointRecord>& QueryHandleContour() const noexcept { return HandleContour; }

    // Single unified conversion operator for panel openness
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    void                    GenerateHandleContour() noexcept;
    [[nodiscard]] float     EvaluateSpringEase(float ParameterT) const noexcept;

    uint32_t                ViewportWidth;                      // [px] window horizontal resolution
    uint32_t                ViewportHeight;                     // [px] window vertical resolution
    float                   CurrentOffsetY;                     // [px] vertical position of pull-down shade
    float                   TargetOffsetY;                      // [px] destination vertical position
    float                   LocomotionVelocity;                 // [px/s] vertical spring velocity

    // Stepper Carousel Sliding Dynamics
    ControlCentrePageCategory ActivePage;                       // [page] currently visible page
    ControlCentrePageCategory PreviousPage;                     // [page] source page during slide transition
    float                   CurrentSlideOffset;                 // [px] horizontal carousel slide displacement
    float                   TargetSlideOffset;                  // [px] destination horizontal displacement
    float                   SlideVelocity;                      // [px/s] carousel horizontal spring velocity
    std::vector<ControlCentrePageCategory> PageHistoryStack;    // [stack] navigation trail for back transitions

    float                   HandlePositionX;                    // [px] horizontal position of notch handle
    float                   HandlePositionY;                    // [px] vertical position of notch handle
    float                   DragStartCursorY;                   // [px] anchor pointer coordinate during drag
    float                   DragStartOffsetY;                   // [px] anchor notch position during drag
    bool                    OpenCondition;                      // [bool] true if fully or transitioning open
    bool                    DraggingCondition;                  // [bool] true if currently dragging notch
    bool                    SelectedCondition;                  // [bool] true if notch handle has focus/hover
    bool                    HoveredCondition;                   // [bool] true if pointer is inside notch handle
    bool                    InitializedCondition;               // [bool] lifecycle status
    ThemeStructure          ActiveTheme;                        // [theme] theme tokens and surface colors
    std::vector<BezierPointRecord> HandleContour;               // [polygon] tessellated organic curved SVG path
};

template<>
inline bool ControlCentrePanel::Convert<bool>() const noexcept
{
    return OpenCondition;
}

template<>
inline float ControlCentrePanel::Convert<float>() const noexcept
{
    return CurrentOffsetY;
}

template<>
inline ControlCentrePageCategory ControlCentrePanel::Convert<ControlCentrePageCategory>() const noexcept
{
    return ActivePage;
}

template<>
inline ControlCentrePanelState ControlCentrePanel::Convert<ControlCentrePanelState>() const noexcept
{
    if (DraggingCondition) return ControlCentrePanelState::Dragging;
    if (OpenCondition && CurrentOffsetY >= static_cast<float>(ViewportHeight - 36)) return ControlCentrePanelState::Open;
    if (!OpenCondition && CurrentOffsetY <= 0.5f) return ControlCentrePanelState::Closed;
    return OpenCondition ? ControlCentrePanelState::Opening : ControlCentrePanelState::Closing;
}

// Type alias for backward compatibility
using ControlPanel = ControlCentrePanel;

} // namespace Frontier
