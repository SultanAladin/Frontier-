//============================================================================================================================================
//                                                            CHASECAMERASOLVER.H
//============================================================================================================================================
// 📦 Critically damped vehicle follow projection; project-neutral chassis position and forward inputs.

#pragma once

#include "../GeometricRaster/CameraProjection.h"

namespace Frontier {
namespace Vehicle {

struct ChaseCameraConfiguration
{
    float FollowDistance   = 7.0f;    // [m]   how far behind the car the eye sits
    float FollowHeight     = 2.6f;    // [m]   how far above the car the eye sits
    float LookAtHeight     = 0.8f;    // [m]   aim point above the chassis origin
    float PositionSpring   = 6.0f;    // [1/s] exponential follow rate (higher = stiffer)
    float BaseFieldOfView  = 60.0f;   // [deg] vertical FOV at rest
    float SpeedFieldOfView = 12.0f;   // [deg] extra FOV added by ramp-up to SpeedForFullFov
    float SpeedForFullFov  = 60.0f;   // [m/s] speed at which the FOV widening is fully applied
};

class ChaseCameraSolver : public Frontier::CameraProjection
{
public:
    ChaseCameraSolver() noexcept;
    explicit ChaseCameraSolver(const ChaseCameraConfiguration& InitialConfiguration) noexcept;
    ~ChaseCameraSolver() noexcept override = default;

    // Feed the chassis pose (world) + its speed each frame; the eye springs toward the ideal chase pose and aims at
    //    the car. TargetForward is the car's world forward (chassis +X rotated by its orientation), unit length.
    void AdvanceChase(const Vector3& TargetPosition, const Vector3& TargetForward,
                      float SpeedMetresPerSecond, float DeltaSeconds) noexcept;

    void AdvanceProjection(float DeltaSeconds) noexcept override;

    void AssignConfiguration(const ChaseCameraConfiguration& NewConfiguration) noexcept { ActiveConfiguration = NewConfiguration; }
    [[nodiscard]] const ChaseCameraConfiguration& QueryConfiguration() const noexcept { return ActiveConfiguration; }

    // Snap straight to the ideal pose (used when switching to the chase camera or after a vehicle reset).
    void SnapTo(const Vector3& TargetPosition, const Vector3& TargetForward) noexcept;

private:
    void OrientToward(const Vector3& AimPoint) noexcept;

    ChaseCameraConfiguration ActiveConfiguration;
    bool                     Seeded = false;
};

} // namespace Vehicle
} // namespace Frontier
