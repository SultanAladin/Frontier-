//============================================================================================================================================
//                                                        VEHICLEINSTANCESEQUENCE.CPP
//============================================================================================================================================
// 📦 Drive supplies its own nearest course surface; all chassis/tyre/thermal integration is shared.

#include "VehicleInstanceSequence.h"
#include "DriveCourse.h"

namespace Frontier::Drive
{
bool VehicleInstanceSequence::Construct(
    const Frontier::Vehicle::VehicleGeometry&          Geometry,
    const VehicleInstanceConfiguration&               Configuration,
    Frontier::Vehicle::GroundQuery       Ground) noexcept
{
    if (!Ground)
        Ground = [](const Vehicle::Vec3& Point, Vehicle::Vec3& Surface, Vehicle::Vec3& Normal)
        {
            CourseSurface(Point.x, Point.y, Point.z, Surface.x, Surface.y, Surface.z, Normal.x, Normal.y, Normal.z);
            return true;
        };
    return Vehicle::VehicleInstanceSequence::Construct(Geometry, Configuration, std::move(Ground));
}
}
