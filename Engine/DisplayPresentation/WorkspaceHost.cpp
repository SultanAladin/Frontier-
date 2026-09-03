//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/WorkspaceHost.cpp — Trapezoidal Workspace Overlay and Multi-Viewport Docking Implementation
//============================================================================================================================================

#include "WorkspaceHost.h"
#include <cmath>
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

WorkspaceHost::WorkspaceHost() noexcept
    : ViewportWidth(1920)
    , ViewportHeight(1080)
    , CurrentMode(WorkspaceEditMode::Editing)
    , ActiveWorkspace(WorkspaceCategory::Modeling)
    , TrapezoidTabs{}
    , WorkspaceRenderTargets{}
    , ViewportFocusedCondition(false)
    , InputGatedCondition(false)
    , InitializedCondition(false)
#ifdef FRONTIER_DEVELOPMENT
    , NotchControlCentreHost{}
#endif
{
}

bool WorkspaceHost::Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept
{
    ViewportWidth  = std::max(1u, DesiredWidth);
    ViewportHeight = std::max(1u, DesiredHeight);

    // Initialize 4 independent Vulkan offscreen render targets for each workspace
    for (size_t Index = 0; Index < WorkspaceRenderTargets.size(); ++Index)
    {
        RenderTargetConfiguration TargetConfig{
            ViewportWidth,
            ViewportHeight,
            37,                 // VK_FORMAT_R8G8B8A8_UNORM
            1,                  // 1 sample (non-MSAA)
            true,               // Depth buffer enabled
            true                // Sampled texture enabled for ImGui viewport
        };
        (void)WorkspaceRenderTargets[Index].AllocateTargetResources(TargetConfig);
    }

#ifdef FRONTIER_DEVELOPMENT
    CalculateTrapezoidTabs();
    (void)NotchControlCentreHost.Initialize(ViewportWidth, ViewportHeight);
#endif

    InitializedCondition = true;
    return true;
}

void WorkspaceHost::Terminate() noexcept
{
    if (InitializedCondition)
    {
#ifdef FRONTIER_DEVELOPMENT
        NotchControlCentreHost.Terminate();
#endif
        for (auto& Target : WorkspaceRenderTargets)
        {
            Target.ReleaseTargetResources();
        }
        InitializedCondition = false;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                             WORKSPACE INTERACTION & GATING
//------------------------------------------------------------------------------------------------------------------------

void WorkspaceHost::AssignActiveWorkspace(WorkspaceCategory Category) noexcept
{
    ActiveWorkspace = Category;
#ifdef FRONTIER_DEVELOPMENT
    CalculateTrapezoidTabs();
#endif
}

const RenderTargetExchange& WorkspaceHost::QueryActiveRenderTarget() const noexcept
{
    size_t Index = static_cast<size_t>(ActiveWorkspace);
    if (Index < WorkspaceRenderTargets.size())
    {
        return WorkspaceRenderTargets[Index];
    }
    return WorkspaceRenderTargets[0];
}

void WorkspaceHost::AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    // 1. Advance Notch Control Centre Interaction
    NotchControlCentreHost.AdvanceInteraction(Input, CursorX, CursorY);
    if (NotchControlCentreHost.IsOpen() || NotchControlCentreHost.IsDragging())
    {
        InputGatedCondition      = true;
        ViewportFocusedCondition = false;
        return;
    }
#endif

    // 2. Evaluate Trapezoidal Workspace Tabs Hit Testing
    for (auto& Tab : TrapezoidTabs)
    {
        Tab.HoveredCondition = false;
        if (CursorY >= Tab.TopLeftPoint.y && CursorY <= Tab.BottomLeftPoint.y)
        {
            float NormalizedY = (CursorY - Tab.TopLeftPoint.y) / (Tab.BottomLeftPoint.y - Tab.TopLeftPoint.y);
            float MinX = Tab.TopLeftPoint.x + NormalizedY * (Tab.BottomLeftPoint.x - Tab.TopLeftPoint.x);
            float MaxX = Tab.TopRightPoint.x + NormalizedY * (Tab.BottomRightPoint.x - Tab.TopRightPoint.x);

            if (CursorX >= MinX && CursorX <= MaxX)
            {
                Tab.HoveredCondition = true;
                if (Input.IsMouseButtonPressed(MouseButtonCategory::ButtonLeft))
                {
                    AssignActiveWorkspace(Tab.Category);
                    InputGatedCondition = true;
                }
            }
        }
    }

    // 3. Evaluate Focus Isolation Gating
    // Top header band (Y < 32px) and tool drawers (X < 320px or X > ViewportWidth - 320px) gate inputs
    if (CursorY < 32.0f || CursorX < 320.0f || CursorX > static_cast<float>(ViewportWidth - 320))
    {
        InputGatedCondition      = true;
        ViewportFocusedCondition = false;
    }
    else
    {
        // Central 3D Viewport Zone
        InputGatedCondition = false;
        if (Input.IsMouseButtonPressed(MouseButtonCategory::ButtonRight))
        {
            ViewportFocusedCondition = true;
        }
        else if (!Input.IsMouseButtonPressed(MouseButtonCategory::ButtonLeft))
        {
            ViewportFocusedCondition = false;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                OVERLAY RENDERING
//------------------------------------------------------------------------------------------------------------------------

void WorkspaceHost::RenderWorkspaceOverlay(WorkspaceEditMode DesiredMode, float DeltaSeconds) noexcept
{
    CurrentMode = DesiredMode;

#ifdef FRONTIER_DEVELOPMENT
    NotchControlCentreHost.AdvanceLocomotion(DeltaSeconds);
    RenderBand0WorkspaceHeader();
    RenderBand1CentralViewport();
    RenderBand2DockedDrawers();
#else
    (void)DeltaSeconds;
#endif
}

#ifdef FRONTIER_DEVELOPMENT

void WorkspaceHost::CalculateTrapezoidTabs() noexcept
{
    const float TabHeight  = 28.0f;
    const float SlantSlope = TabHeight * 0.32f; // ~18 degree angle slope (9.0px)
    const float TabWidth   = 140.0f;
    const float HeaderY    = 2.0f;

    const char* WorkspaceTitles[4] = { "Modeling", "Shading", "Simulation", "Diagnostics" };

    float CurrentX = 16.0f;
    for (size_t Index = 0; Index < 4; ++Index)
    {
        TrapezoidTabs[Index].BottomLeftPoint  = Vector3{ CurrentX - SlantSlope, HeaderY + TabHeight, 0.0f };
        TrapezoidTabs[Index].TopLeftPoint     = Vector3{ CurrentX + SlantSlope, HeaderY, 0.0f };
        TrapezoidTabs[Index].TopRightPoint    = Vector3{ CurrentX + TabWidth - SlantSlope, HeaderY, 0.0f };
        TrapezoidTabs[Index].BottomRightPoint = Vector3{ CurrentX + TabWidth + SlantSlope, HeaderY + TabHeight, 0.0f };
        TrapezoidTabs[Index].LabelText        = WorkspaceTitles[Index];
        TrapezoidTabs[Index].Category         = static_cast<WorkspaceCategory>(Index);
        TrapezoidTabs[Index].ActiveCondition  = (ActiveWorkspace == TrapezoidTabs[Index].Category);
        TrapezoidTabs[Index].HoveredCondition = false;

        CurrentX += (TabWidth + 4.0f);
    }
}

void WorkspaceHost::RenderBand0WorkspaceHeader() noexcept
{
    // Band 0: Master Workspace Trapezoidal Header Bar
    CalculateTrapezoidTabs();
}

void WorkspaceHost::RenderBand1CentralViewport() noexcept
{
    // Band 1: Central Docked 3D Scene Viewport hosting active RenderTargetExchange
}

void WorkspaceHost::RenderBand2DockedDrawers() noexcept
{
    // Band 2: Docked Tool Panels (SpatialIndexPanel outliner, InspectorPanel properties, TelemetryPanel metrics)
}

#endif // FRONTIER_DEVELOPMENT

} // namespace Frontier
