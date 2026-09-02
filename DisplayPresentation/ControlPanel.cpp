//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ControlPanel.cpp — Organic Top Notch Control Centre Overlay and Spring Locomotion Implementation
//============================================================================================================================================

#include "ControlPanel.h"
#include <cmath>
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

ControlPanel::ControlPanel() noexcept
    : ViewportWidth(1920)
    , ViewportHeight(1080)
    , CurrentOffsetY(0.0f)
    , TargetOffsetY(0.0f)
    , LocomotionVelocity(0.0f)
    , LocomotionProgress(0.0f)
    , HandlePositionX(760.0f)
    , HandlePositionY(0.0f)
    , DragStartCursorY(0.0f)
    , DragStartOffsetY(0.0f)
    , OpenCondition(false)
    , DraggingCondition(false)
    , SelectedCondition(false)
    , HoveredCondition(false)
    , InitializedCondition(false)
    , ActiveTheme{}
    , HandleContour{}
{
}

bool ControlPanel::Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept
{
    ViewportWidth  = std::max(1u, DesiredWidth);
    ViewportHeight = std::max(1u, DesiredHeight);

    CurrentOffsetY  = 0.0f;
    TargetOffsetY   = 0.0f;
    HandlePositionX = (static_cast<float>(ViewportWidth) - 400.0f) * 0.5f;
    HandlePositionY = 0.0f;

    GenerateHandleContour();

    InitializedCondition = true;
    return true;
}

void ControlPanel::Terminate() noexcept
{
    InitializedCondition = false;
    HandleContour.clear();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                ORGANIC SVG TESSELLATION
//------------------------------------------------------------------------------------------------------------------------

static BezierPointRecord SampleCubicBezier(
    BezierPointRecord P0,
    BezierPointRecord P1,
    BezierPointRecord P2,
    BezierPointRecord P3,
    float ParameterT) noexcept
{
    float InverseT = 1.0f - ParameterT;
    float B0 = InverseT * InverseT * InverseT;
    float B1 = 3.0f * InverseT * InverseT * ParameterT;
    float B2 = 3.0f * InverseT * ParameterT * ParameterT;
    float B3 = ParameterT * ParameterT * ParameterT;

    return BezierPointRecord{
        B0 * P0.X + B1 * P1.X + B2 * P2.X + B3 * P3.X,
        B0 * P0.Y + B1 * P1.Y + B2 * P2.Y + B3 * P3.Y
    };
}

void ControlPanel::GenerateHandleContour() noexcept
{
    HandleContour.clear();
    HandleContour.reserve(128);

    // M 0 0
    HandleContour.push_back(BezierPointRecord{ 0.0f, 0.0f });

    // C 15 0, 20 6, 25 15
    for (int Step = 1; Step <= 12; ++Step)
    {
        float T = static_cast<float>(Step) / 12.0f;
        HandleContour.push_back(SampleCubicBezier(
            BezierPointRecord{ 0.0f, 0.0f },
            BezierPointRecord{ 15.0f, 0.0f },
            BezierPointRecord{ 20.0f, 6.0f },
            BezierPointRecord{ 25.0f, 15.0f },
            T
        ));
    }

    // L 35 28
    HandleContour.push_back(BezierPointRecord{ 35.0f, 28.0f });

    // C 40 34, 45 36, 52 36
    for (int Step = 1; Step <= 12; ++Step)
    {
        float T = static_cast<float>(Step) / 12.0f;
        HandleContour.push_back(SampleCubicBezier(
            BezierPointRecord{ 35.0f, 28.0f },
            BezierPointRecord{ 40.0f, 34.0f },
            BezierPointRecord{ 45.0f, 36.0f },
            BezierPointRecord{ 52.0f, 36.0f },
            T
        ));
    }

    // L 348 36
    HandleContour.push_back(BezierPointRecord{ 348.0f, 36.0f });

    // C 355 36, 360 34, 365 28
    for (int Step = 1; Step <= 12; ++Step)
    {
        float T = static_cast<float>(Step) / 12.0f;
        HandleContour.push_back(SampleCubicBezier(
            BezierPointRecord{ 348.0f, 36.0f },
            BezierPointRecord{ 355.0f, 36.0f },
            BezierPointRecord{ 360.0f, 34.0f },
            BezierPointRecord{ 365.0f, 28.0f },
            T
        ));
    }

    // L 375 15
    HandleContour.push_back(BezierPointRecord{ 375.0f, 15.0f });

    // C 380 6, 385 0, 400 0
    for (int Step = 1; Step <= 12; ++Step)
    {
        float T = static_cast<float>(Step) / 12.0f;
        HandleContour.push_back(SampleCubicBezier(
            BezierPointRecord{ 375.0f, 15.0f },
            BezierPointRecord{ 380.0f, 6.0f },
            BezierPointRecord{ 385.0f, 0.0f },
            BezierPointRecord{ 400.0f, 0.0f },
            T
        ));
    }

    // Z (Return to 0, 0)
    HandleContour.push_back(BezierPointRecord{ 0.0f, 0.0f });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SPRING LOCOMOTION PHYSICS
//------------------------------------------------------------------------------------------------------------------------

float ControlPanel::EvaluateSpringEase(float ParameterT) const noexcept
{
    // Cubic bezier spring curve: cubic-bezier(0.175, 0.885, 0.32, 1.15)
    float T = std::clamp(ParameterT, 0.0f, 1.0f);
    float InvT = 1.0f - T;
    // Y(t) = 3*(1-t)^2 * t * P1_y + 3*(1-t) * t^2 * P2_y + t^3 * 1.0
    float P1_y = 0.885f;
    float P2_y = 1.150f;
    return (3.0f * InvT * InvT * T * P1_y) + (3.0f * InvT * T * T * P2_y) + (T * T * T);
}

void ControlPanel::AdvanceLocomotion(float DeltaSeconds) noexcept
{
    if (DeltaSeconds <= 0.0f) return;

    HandlePositionX = (static_cast<float>(ViewportWidth) - 400.0f) * 0.5f;

    if (!DraggingCondition)
    {
        // Smooth spring damper dynamics
        constexpr float SpringStiffness = 160.0f;                // [1/s^2] spring constant
        constexpr float DampingRatio    = 20.0f;                 // [1/s] damping ratio

        float Displacement = CurrentOffsetY - TargetOffsetY;
        float SpringForce  = -SpringStiffness * Displacement;
        float DampingForce = -DampingRatio * LocomotionVelocity;
        float Acceleration = SpringForce + DampingForce;

        LocomotionVelocity += Acceleration * DeltaSeconds;
        CurrentOffsetY     += LocomotionVelocity * DeltaSeconds;

        // Clamp settling threshold
        if (std::abs(Displacement) < 0.1f && std::abs(LocomotionVelocity) < 0.1f)
        {
            CurrentOffsetY     = TargetOffsetY;
            LocomotionVelocity = 0.0f;
        }
    }

    HandlePositionY = CurrentOffsetY;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             INTERACTION & DRAG CONTROLLER
//------------------------------------------------------------------------------------------------------------------------

void ControlPanel::OpenNotch() noexcept
{
    OpenCondition = true;
    TargetOffsetY = static_cast<float>(ViewportHeight - 36);
}

void ControlPanel::CloseNotch() noexcept
{
    OpenCondition = false;
    TargetOffsetY = 0.0f;
}

void ControlPanel::ToggleNotch() noexcept
{
    if (OpenCondition)
    {
        CloseNotch();
    }
    else
    {
        OpenNotch();
    }
}

void ControlPanel::AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept
{
    // Hit test against organic notch handle (centered at HandlePositionX, HandlePositionY)
    bool InsideX = (CursorX >= HandlePositionX && CursorX <= (HandlePositionX + 400.0f));
    bool InsideY = (CursorY >= HandlePositionY && CursorY <= (HandlePositionY + 36.0f));
    HoveredCondition = (InsideX && InsideY);

    if (Input.IsMouseButtonPressed(MouseButtonCategory::ButtonLeft))
    {
        if (!DraggingCondition && HoveredCondition)
        {
            // Begin dragging interaction
            DraggingCondition = true;
            SelectedCondition = true;
            DragStartCursorY  = CursorY;
            DragStartOffsetY   = CurrentOffsetY;
            LocomotionVelocity = 0.0f;
        }

        if (DraggingCondition)
        {
            float DeltaY = CursorY - DragStartCursorY;
            float MaxY   = static_cast<float>(ViewportHeight - 36);
            CurrentOffsetY = std::clamp(DragStartOffsetY + DeltaY, 0.0f, MaxY);
            TargetOffsetY  = CurrentOffsetY;
            HandlePositionY = CurrentOffsetY;
        }
    }
    else
    {
        // Pointer released
        if (DraggingCondition)
        {
            DraggingCondition = false;
            float MaxY = static_cast<float>(ViewportHeight - 36);
            float DragDelta = std::abs(CurrentOffsetY - DragStartOffsetY);

            // If drag delta is tiny, treat as a click toggle
            if (DragDelta < 6.0f)
            {
                ToggleNotch();
            }
            else
            {
                // Snap based on position threshold (35% drop threshold)
                if (CurrentOffsetY > (MaxY * 0.35f))
                {
                    OpenNotch();
                }
                else
                {
                    CloseNotch();
                }
            }
        }
    }
}

} // namespace Frontier
