//============================================================================================================================================
//                                                              DRIVEWHEELMESH.H
//============================================================================================================================================
// 📦 Legacy Drive names forward to the shared closed wheel-surface projection.

#pragma once
#include "../../../Engine/GeometricRaster/WheelProjection.h"
namespace Frontier::Drive
{
using Frontier::Vehicle::WheelTreadLattice;
using Frontier::Vehicle::FillRestTreadLattice;
using Frontier::Vehicle::EmitWheelSurface;
using Frontier::Vehicle::kDriveWheelRingCount;
using Frontier::Vehicle::kDriveWheelSegmentCount;
using Frontier::Vehicle::kDriveWheelSpokeCount;
}
