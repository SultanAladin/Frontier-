//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ControlPanel.h — Organic Top Notch Control Centre Overlay and Spring Locomotion Dynamics
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "ThemeStructure.h"
#include "../DeviceExchange/InputExchange.h"
#include <cstdint>
#include <vector>

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
//                                                CONTROL PANEL STATE
//------------------------------------------------------------------------------------------------------------------------

enum class ControlPanelState : uint32_t
{
    Closed                              = 0,                    // Retracted at Y = 0px
    Opening                             = 1,                    // Spring locomotion translating downward
    Open                                = 2,                    // Fully deployed at Y = ScreenHeight - 36px
    Closing                             = 3,                    // Spring locomotion retracting upward
    Dragging                            = 4                     // Direct pointer dragging
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   CONTROL PANEL
//------------------------------------------------------------------------------------------------------------------------

class ControlPanel
{
public:
    ControlPanel() noexcept;
    ~ControlPanel() noexcept = default;

    ControlPanel(const ControlPanel&) = delete;
    ControlPanel& operator=(const ControlPanel&) = delete;

    [[nodiscard]] bool      Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept;
    void                    Terminate() noexcept;

    void                    AdvanceLocomotion(float DeltaSeconds) noexcept;
    void                    AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept;

    void                    OpenNotch() noexcept;
    void                    CloseNotch() noexcept;
    void                    ToggleNotch() noexcept;

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
    float                   LocomotionVelocity;                 // [px/s] spring velocity
    float                   LocomotionProgress;                 // [0..1] spring interpolation factor
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
inline bool ControlPanel::Convert<bool>() const noexcept
{
    return OpenCondition;
}

template<>
inline float ControlPanel::Convert<float>() const noexcept
{
    return CurrentOffsetY;
}

template<>
inline ControlPanelState ControlPanel::Convert<ControlPanelState>() const noexcept
{
    if (DraggingCondition) return ControlPanelState::Dragging;
    if (OpenCondition && CurrentOffsetY >= static_cast<float>(ViewportHeight - 36)) return ControlPanelState::Open;
    if (!OpenCondition && CurrentOffsetY <= 0.5f) return ControlPanelState::Closed;
    return OpenCondition ? ControlPanelState::Opening : ControlPanelState::Closing;
}

} // namespace Frontier
