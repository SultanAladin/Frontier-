//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/WorkspacePanel.h — Multi-Band Immediate Mode Workspace Overlay
//============================================================================================================================================

#pragma once

#include <cstdint>
#include <string_view>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                WORKSPACE EDIT MODE
//------------------------------------------------------------------------------------------------------------------------

enum class WorkspaceEditMode : uint32_t
{
    Editing                             = 0,                    // CAD and geometry editing mode
    SimulatingInEditor                  = 1,                    // Physics active within editor
    Paused                              = 2                     // Simulation frozen for inspection
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   WORKSPACE PANEL
//------------------------------------------------------------------------------------------------------------------------

class WorkspacePanel
{
public:
    WorkspacePanel() noexcept;
    ~WorkspacePanel() noexcept = default;

    WorkspacePanel(const WorkspacePanel&) = delete;
    WorkspacePanel& operator=(const WorkspacePanel&) = delete;

    [[nodiscard]] bool      Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept;
    void                    Terminate() noexcept;

    void                    RenderWorkspaceOverlay(WorkspaceEditMode DesiredMode, float DeltaSeconds) noexcept;

    [[nodiscard]] WorkspaceEditMode QueryEditMode() const noexcept { return CurrentMode; }
    void                    AssignEditMode(WorkspaceEditMode NewMode) noexcept { CurrentMode = NewMode; }

    // Single unified conversion operator for edit mode
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
#ifdef FRONTIER_DEVELOPMENT
    void                    RenderBand0Background() noexcept;
    void                    RenderBand1Viewport() noexcept;
    void                    RenderBand2ToolDrawers() noexcept;
#endif

    uint32_t                ViewportWidth;                      // [px] viewport width
    uint32_t                ViewportHeight;                     // [px] viewport height
    WorkspaceEditMode       CurrentMode;                        // [mode] active editor operation mode
    bool                    InitializedCondition;               // [bool] overlay status
};

template<>
inline WorkspaceEditMode WorkspacePanel::Convert<WorkspaceEditMode>() const noexcept
{
    return CurrentMode;
}

} // namespace Frontier
