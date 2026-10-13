//============================================================================================================================================
//                                                         VEHICLEINTERCHANGE.H
//============================================================================================================================================
// 📦 Shared vehicle readings translated into synchronous C smoke and transport snapshots without borrowed storage.

#pragma once

#include "SmokeTransportInterchange.h"
#include "../PhysicalDynamics/Vehicle/VehicleInstanceSequence.h"

namespace Frontier
{

inline uint32_t DeliverVehicleSmoke(
    const Vehicle::VehicleInstanceSequence* ActiveVehicle,
    uint64_t                                CarrierIdentifier,
    FrontierProjectSmokeReading*            Reading)
{
    if (!Reading || Reading->StructureSize != sizeof(*Reading) || Reading->InterchangeNumber != 1u) return 2u;
    Reading->Extent            = 0u;
    Reading->Span              = 0.0f;
    Reading->CarrierIdentifier = CarrierIdentifier;
    Reading->Revision          = 0u;
    Reading->Refused           = 0u;
    Reading->WheelCount        = 0u;
    std::fill_n(Reading->Origin, 3u, 0.0f);
    std::fill_n(Reading->Tyres, 8u, FrontierProjectTyreReading{});
    if (!ActiveVehicle) return 1u;
    const auto& Telemetry = ActiveVehicle->Telemetry();
    Reading->WheelCount = std::min<uint32_t>(Telemetry.WheelCount, 8u);
    for (uint32_t Wheel = 0u; Wheel < Reading->WheelCount; ++Wheel)
    {
        const auto& Condition = Telemetry.Wheels[Wheel].Thermal;
        Reading->Tyres[Wheel] =
        {
            static_cast<float>(Condition.SurfaceTemperature), static_cast<float>(Condition.CarcassTemperature),
            static_cast<float>(Condition.GasTemperature), static_cast<float>(Condition.GaugePressure),
            static_cast<float>(Condition.GripFactor), static_cast<float>(Condition.SlidingPower),
            static_cast<float>(Condition.RemainingRubber), (Condition.Valid ? 1u : 0u) | (Condition.Ignited ? 2u : 0u),
        };
    }
    const auto& Metrics = ActiveVehicle->QuerySmokeMetrics();
    Reading->Revision = Metrics.AdvanceNumber;
    Reading->Refused  = Metrics.Refused ? 1u : 0u;
    const auto* Field = ActiveVehicle->QuerySmoke();
    if (!Field) return 1u;
    Reading->Extent = CoarseExtent;
    Reading->Span   = Field->Span;
    std::copy_n(Field->Origin, 3u, Reading->Origin);
    if (Reading->Capacity == 0u) return 1u;
    if (!Reading->Density || !Reading->Temperature || Reading->Capacity < CoarseVoxelCount) return 2u;
    std::copy(Field->Smoke.begin(), Field->Smoke.end(), Reading->Density);
    std::copy(Field->Temperature.begin(), Field->Temperature.end(), Reading->Temperature);
    return 1u;
}

inline uint32_t DeliverVehicleTransport(
    const Vehicle::VehicleInstanceSequence* ActiveVehicle,
    uint64_t                                CarrierIdentifier,
    FrontierSmokeTransportReading*          Reading)
{
    if (!Reading || Reading->StructureSize != sizeof(*Reading) ||
        Reading->InterchangeNumber != FrontierSmokeTransportNumber) return 2u;
    Reading->CarrierIdentifier = CarrierIdentifier;
    Reading->Revision          = ActiveVehicle ? ActiveVehicle->QuerySmokeMetrics().AdvanceNumber : 0u;
    Reading->Extent            = 0u;
    Reading->CompletedTicks    = 0u;
    Reading->SourceCount       = 0u;
    std::fill_n(Reading->SourceOffsets, 7u, 0u);
    const auto* Field = ActiveVehicle ? ActiveVehicle->QuerySmoke() : nullptr;
    if (!Field) return 1u;
    Reading->Extent         = CoarseExtent;
    Reading->Span           = Field->Span;
    Reading->CompletedTicks = ActiveVehicle->QueryCompletedGasTicks();
    Reading->SourceCount    = ActiveVehicle->QueryCompletedSourceCount();
    std::copy_n(ActiveVehicle->QueryCompletedOffsets().data(), 7u, Reading->SourceOffsets);
    Reading->SmokeLoss      = -std::log1p(-ActiveVehicle->QuerySmokeSpecification().Transport.SmokeLossPerSecond);
    Reading->Cooling        = -std::log1p(-ActiveVehicle->QuerySmokeSpecification().Transport.CoolingPerSecond);
    std::copy_n(Field->Origin, 3u, Reading->Origin);
    const auto& Chassis = ActiveVehicle->Chassis();
    const auto& Minimum = ActiveVehicle->QueryCollisionMinimum();
    const auto& Maximum = ActiveVehicle->QueryCollisionMaximum();
    Reading->ChassisPosition[0] = Chassis.Position.x;
    Reading->ChassisPosition[1] = Chassis.Position.y;
    Reading->ChassisPosition[2] = Chassis.Position.z;
    Reading->ChassisInverse[0]  = -Chassis.Orientation.x;
    Reading->ChassisInverse[1]  = -Chassis.Orientation.y;
    Reading->ChassisInverse[2]  = -Chassis.Orientation.z;
    Reading->ChassisInverse[3]  = Chassis.Orientation.w;
    Reading->ChassisMinimum[0]  = Minimum.x;
    Reading->ChassisMinimum[1]  = Minimum.y;
    Reading->ChassisMinimum[2]  = Minimum.z;
    Reading->ChassisMaximum[0]  = Maximum.x;
    Reading->ChassisMaximum[1]  = Maximum.y;
    Reading->ChassisMaximum[2]  = Maximum.z;
    if (Reading->SourceCount > FrontierSmokeSourceCeiling) return 2u;
    const auto& Sources = ActiveVehicle->QueryCompletedSources();
    for (uint32_t Index = 0u; Index < Reading->SourceCount; ++Index)
    {
        const auto& Source = Sources[Index];
        auto& Target = Reading->Sources[Index];
        std::copy_n(Source.Position, 3u, Target.PositionRadius);
        std::copy_n(Source.Velocity, 3u, Target.VelocityDensity);
        Target.PositionRadius[3]  = Source.Radius;
        Target.VelocityDensity[3] = Source.SmokeRate;
        Target.Temperature[0]     = Source.TemperatureRate;
        Target.Temperature[1]     = Source.IncandescenceRate;
    }
    if (Reading->Capacity == 0u) return 1u;
    if (!Reading->VelocityOccupancy || Reading->Capacity < CoarseVoxelCount) return 2u;
    const float Cell = VoxelSize(*Field);
    for (uint32_t Index = 0u; Index < CoarseVoxelCount; ++Index)
    {
        const Vehicle::Vec3 Position
        {
            Field->Origin[0] + (Index % CoarseExtent + 0.5f) * Cell,
            Field->Origin[1] + (Index / CoarseExtent % CoarseExtent + 0.5f) * Cell,
            Field->Origin[2] + (Index / (CoarseExtent * CoarseExtent) + 0.5f) * Cell,
        };
        float* Target = Reading->VelocityOccupancy + Index * 4u;
        Target[0] = Field->VelocityX[Index];
        Target[1] = Field->VelocityY[Index];
        Target[2] = Field->VelocityZ[Index];
        // 📝 Fine transport samples terrain here and the exact rigid box above; tyre SDF deformation stays deferred.
        Target[3] = ActiveVehicle->QueryGroundSolid(Position) ? 1.0f : 0.0f;
    }
    return 1u;
}

} // namespace Frontier
