//==============================================================================================================================================
//                                                         GASVEHICLEINTAKE.H
//==============================================================================================================================================
// 📦 Resolves actual wheel contact and thermal readings into world-space burnout, drift and combustion sources.
//
// GasGameplayEmission.h states the hook in terms of a GasTyreContact: a patch, its travel, its slip and its
// load. That struct was written so the tyre solver would not have to change. This file is the proof of that
// claim: Engine/PhysicalDynamics/Vehicle/VehicleSolver.h already fills every field of it, under other names,
// completed contact velocities and thermal readings also drive the combined-slip adapter below.
//
//    | GasTyreContact | Read from                                                  |
//    |----------------|------------------------------------------------------------|
//    | Position       | WheelTelemetry::ContactPoint                                |
//    | Forward        | the hub's own +X, turned by HubRotation, times ForwardSpeed |
//    | SlipRatio      | WheelTelemetry::SlipRatio, unsigned                         |
//    | NormalLoad     | WheelTelemetry::VerticalLoad, or none when out of contact   |
//    | PatchRadius    | WheelTelemetry::ContactPatchRadius if the solver gains one; until then, authored |
//
// 💡 THE DEPENDENCY RUNS ONE WAY ON PURPOSE. GasGameplayEmission.h does not include the vehicle; the vehicle
//    does not include the gas. This file includes both and is the only thing that does, which is what lets a
//    build with no vehicle in it still have gas, and a vehicle-only build still link.
//
// 📐 Both layers put +Z up — XPBDSoftTyre.h says so in as many words, and axis 2 is up throughout
//    VolumetricDynamics — so the contact point crosses without a change of hand or of axis order. If either
//    ever moves, it moves here.
//
// ⚠️ Whether a given car smokes at all is not decided here. This answers what the tyre is doing; the opt-in
//    lives with the vehicle in the scene, beside the two-way coupling consent, because a configuration
//    decision compiled into a header is a decision nobody can change.

#pragma once

#include "GasGameplayEmission.h"
#include "SmokeSequence.h"

#include "../PhysicalDynamics/Vehicle/VehicleSolver.h"

namespace Frontier {

// Half the contact width of a road tyre, until the solver reports its own. Authored here rather than inside
//    GasGameplayEmission.h, because it is a fact about tyres and not a fact about gas.
constexpr float GasRoadTyrePatchRadius = 0.16f;   // [m]


/// 📦 One wheel of a vehicle, read as the contact report the gas hook takes.
/// in    Telemetry         [-]  as the vehicle solver filled it this step
/// in    WheelIndex        [-]  which corner; out-of-range answers a patch with no load
/// out   GasTyreContact    [-]  position, travel, slip and load; the carrier is the wheel index
/// err   a wheel out of contact reports no load, which TyreSmokes() declines — no check is needed at the call site
/// note  the absolute slip is taken, because a wheel locked under braking lays down exactly the same smoke as
///       one spinning under power, and the sign is the only thing that distinguishes them
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
inline GasTyreContact ReadTyreContact(const Vehicle::VehicleTelemetry& Telemetry, uint32_t WheelIndex) noexcept
{
    GasTyreContact Contact;
    Contact.PatchRadius = GasRoadTyrePatchRadius;
    if (WheelIndex >= Telemetry.WheelCount || WheelIndex >= Telemetry.Wheels.size())
    {
        Contact.NormalLoad = 0.0f;
        return Contact;
    }

    const Vehicle::WheelTelemetry& Wheel = Telemetry.Wheels[WheelIndex];
    Contact.Carrier     = WheelIndex;
    Contact.Position[0] = Wheel.ContactPoint.x;
    Contact.Position[1] = Wheel.ContactPoint.y;
    Contact.Position[2] = Wheel.ContactPoint.z;
    Contact.SlipRatio   = Wheel.SlipRatio < 0.0f ? -Wheel.SlipRatio : Wheel.SlipRatio;
    Contact.NormalLoad  = Wheel.InContact ? Wheel.VerticalLoad : 0.0f;

    // The patch travels where the hub points, at the speed the chassis is making. Taking the hub's own axis
    //    rather than the chassis' means a steered wheel drags its cloud along the steer angle, which is the
    //    difference between a drift that reads and one that does not.
    const Vehicle::Vec3 Along = Wheel.HubRotation.Rotate(Vehicle::Vec3{ 1.0f, 0.0f, 0.0f });
    Contact.Forward[0] = Along.x * Telemetry.ForwardSpeed;
    Contact.Forward[1] = Along.y * Telemetry.ForwardSpeed;
    Contact.Forward[2] = Along.z * Telemetry.ForwardSpeed;
    return Contact;
}


/// 📦 The burnout emitter one wheel is owed this step, or a disabled one.
/// in    Telemetry              [-]  as the vehicle solver filled it this step
/// in    WheelIndex             [-]  which corner
/// out   GasEmitterComponent    [-]  continuous, on tyre_burnout, at the contact patch
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
inline GasEmitterComponent ConstructWheelEmitter(const Vehicle::VehicleTelemetry& Telemetry,
                                                 uint32_t WheelIndex) noexcept
{
    return ConstructTyreEmitter(ReadTyreContact(Telemetry, WheelIndex));
}


/// 📦 Resolves actual combined sliding work into one world-space drift/fire injection.
/// in    Telemetry     [-] completed vehicle force/contact/thermal readings
/// in    WheelIndex    [-] requested wheel; out-of-range delivers a zero-rate source
/// in    Specification [-] smoke tuning, independent of the physical tyre specification
/// out   GasEmission   [-] world position, velocity, density and plume heat; zero rates mean no demand
/// note  fire may remain active in the air; fresh friction smoke requires contact and real tangential slip
inline GasEmission ResolveWheelSmoke(
    const Vehicle::VehicleTelemetry& Telemetry,
    uint32_t                         WheelIndex,
    const SmokeSpecification&        Specification) noexcept
{
    GasEmission Emission;
    Emission.SmokeRate = Emission.TemperatureRate = 0.0f;
    if (WheelIndex >= Telemetry.WheelCount || WheelIndex >= Telemetry.Wheels.size()) return Emission;
    const auto& Wheel = Telemetry.Wheels[WheelIndex];
    const bool Burning = Wheel.Thermal.Valid && Wheel.Thermal.Ignited && Wheel.Thermal.CombustionPower > 0.0;
    const double Power = Wheel.Thermal.SlidingPower;
    const bool Sliding = Wheel.InContact && std::hypot(Wheel.SlipVelocity.Length(), Wheel.SpinSlipSpeed) >= Specification.MinimumSlipSpeed &&
                         Power > Specification.SourcePowerOnset;
    const auto Position = Burning && !Wheel.InContact ? Wheel.HubPosition : Wheel.ContactPoint;
    Emission.Position[0] = Position.x; Emission.Position[1] = Position.y; Emission.Position[2] = Position.z + 0.04f;
    Emission.Radius = GasRoadTyrePatchRadius * 1.4f;
    const double Strength = Sliding ? std::clamp((Power - Specification.SourcePowerOnset) /
        std::max(1.0f, Specification.SourcePowerFull - Specification.SourcePowerOnset), 0.0, 4.0) : 0.0;
    const double Warm = std::clamp((Wheel.Thermal.SurfaceTemperature - Wheel.Thermal.ReferenceTemperature) / 100.0, 0.0, 1.0);
    Emission.SmokeRate = Specification.DensityRate * static_cast<float>(Strength * (0.5 + 0.5 * Warm)) + (Burning ? 12.0f : 0.0f);
    Emission.TemperatureRate = Specification.SmokeHeatRate * static_cast<float>(Strength) +
        (Burning ? static_cast<float>(Wheel.Thermal.CombustionPower) * Specification.FireHeatPowerScale : 0.0f);
    Emission.Velocity[0] = Wheel.ContactVelocity.x * Specification.CarrierVelocityShare;
    Emission.Velocity[1] = Wheel.ContactVelocity.y * Specification.CarrierVelocityShare;
    Emission.Velocity[2] = Wheel.ContactVelocity.z * Specification.CarrierVelocityShare + (Burning ? 1.2f : 0.15f);
    return Emission;
}

}   // namespace Frontier
