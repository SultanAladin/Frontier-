//============================================================================================================================================
//                                                       TYREDEFORMATIONPUBLISHER.H
//============================================================================================================================================
// 📦 Composes the GPU tyre-deformation record for one wheel from the solver's telemetry — the only bridge there is.
//
// 📐 Nothing here feeds back into the physics. The rigid wheel's hub pose, the trace-fan contact (patch centre,
//    normal, deflection), Pacejka's in-plane forces and the wheel spin become the eight float4 lanes
//    Shaders/TyreDeformation.slang bends the drawn tyre with. The carcass stiffnesses are visual constants with
//    road-tyre magnitudes, not calibrated compound data.

#pragma once

#include "RigidWheel.h"
#include "VehicleSolver.h"
#include "../../GeometricRaster/TyreDeformationRecord.h"
#include <algorithm>
#include <cmath>

namespace Frontier::Vehicle {

struct TyreDeformationTuning
{
    float LateralStiffness      = 160000.0f;  // [N/m] carcass lateral: 4 kN → 25 mm of tread walk
    float LongitudinalStiffness = 350000.0f;  // [N/m] carcass fore/aft: 7 kN → 20 mm of lead
    float MaxLateralWalk        = 0.045f;     // [m]   bound on ③
    float MaxLongitudinalLead   = 0.030f;     // [m]   bound on ④
    float BulgeGain             = 0.35f;      // [-]   sidewall belly per metre of deflection (② — 25 mm → ~9 mm)
    float PatchSoftness         = 0.35f;      // [-]   C¹ knee of the flat patch as a fraction of δ
    float GrowthGain            = 4.0e-6f;    // [1/(m/s)²] ⑤ — 60 m/s → 1.4 % radius
};

[[nodiscard]] inline TyreDeformationRecord ComposeTyreDeformation(const RigidWheel& Wheel, const WheelTelemetry& Reading,
                                                                   const TyreSpecification& Specification,
                                                                   const TyreDeformationTuning& Tuning = {}) noexcept
{
    TyreDeformationRecord Record{};
    const Vec3 Hub  = Wheel.HubPosition();
    const Quat Rot  = Wheel.HubRotation();
    const Vec3 Axle = Rot.Rotate(Vec3{0.0f, 1.0f, 0.0f}).Normalized();
    Vec3 N = Reading.InContact ? Reading.ContactNormal : Vec3{0.0f, 0.0f, 1.0f};
    if (!(N.LengthSq() > 1e-6f) || !std::isfinite(N.x) || !std::isfinite(N.y) || !std::isfinite(N.z)) N = {0.0f, 0.0f, 1.0f};
    N = N.Normalized();
    Vec3 Forward = Rot.Rotate(Vec3{1.0f, 0.0f, 0.0f});
    Forward = (Forward - N * Dot(Forward, N)).Normalized();
    if (!(Forward.LengthSq() > 1e-6f)) Forward = Cross(Axle, N).Normalized();
    const Vec3 Left = Cross(N, Forward).Normalized();

    const float Deflection = Reading.InContact ? std::clamp(Reading.TyreDeflection, 0.0f, 0.5f * Specification.Radius) : 0.0f;
    const Vec3  Patch      = Reading.InContact ? Reading.ContactPoint : Hub - N * Specification.Radius;

    const float Walk = std::clamp(Reading.LateralForce / Tuning.LateralStiffness, -Tuning.MaxLateralWalk, Tuning.MaxLateralWalk);
    const float Lead = std::clamp(Reading.LongitudinalForce / Tuning.LongitudinalStiffness, -Tuning.MaxLongitudinalLead, Tuning.MaxLongitudinalLead);
    const float TreadSpeed = std::fabs(Reading.WheelOmega) * Specification.Radius;
    const float PressureRatio = (Reading.Thermal.Valid && Specification.InflationPressure > 1.0f)
        ? std::clamp(static_cast<float>(Reading.Thermal.GaugePressure) / Specification.InflationPressure, 0.5f, 2.0f) : 1.0f;

    const auto Put = [](float* Lane, const Vec3& V, float W) { Lane[0] = V.x; Lane[1] = V.y; Lane[2] = V.z; Lane[3] = W; };
    Put(Record.Hub,          Hub,              Specification.Radius);
    Put(Record.Axle,         Axle,             Specification.RimRadius);
    Put(Record.Ground,       Patch,            Deflection);
    Put(Record.Normal,       N,                0.5f * Specification.Width);
    Put(Record.Lateral,      Left * Walk,      TreadSpeed);
    Put(Record.Longitudinal, Forward * Lead,   PressureRatio);
    Record.Tuning[0] = Tuning.BulgeGain; Record.Tuning[1] = Tuning.PatchSoftness; Record.Tuning[2] = Tuning.GrowthGain; Record.Tuning[3] = 1.0f;
    for (float* Lane : {Record.Hub, Record.Axle, Record.Ground, Record.Normal, Record.Lateral, Record.Longitudinal})
        for (uint32_t I = 0u; I < 4u; ++I) if (!std::isfinite(Lane[I])) { Record.Tuning[3] = 0.0f; break; }
    return Record;
}

} // namespace Frontier::Vehicle
