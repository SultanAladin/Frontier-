//============================================================================================================================================
//                                                         VEHICLEINSTANCESEQUENCE.H
//============================================================================================================================================
// 📦 Drive-specific ground reception around the shared vehicle mechanics; no project-to-project source edge.

#pragma once
#include "../../../Engine/PhysicalDynamics/Vehicle/VehicleInstanceSequence.h"
namespace Frontier::Drive
{
using VehicleInstanceConfiguration = Frontier::Vehicle::VehicleInstanceConfiguration;
using VehicleChassisBody = Frontier::Vehicle::VehicleChassisBody;
using ChassisContactReading = Frontier::Vehicle::ChassisContactReading;

class VehicleInstanceSequence : public Frontier::Vehicle::VehicleInstanceSequence
{
public:
    bool Construct(
        const Frontier::Vehicle::VehicleGeometry&          Geometry,
        const VehicleInstanceConfiguration&               Configuration,
        Frontier::Vehicle::GroundQuery       Ground = {}) noexcept;
};
}
