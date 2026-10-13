//============================================================================================================================================
//                                                         VEHICLESTRUCTURE.H
//============================================================================================================================================
// 📦 Shared authored ControlVehicle, closed XPBD-compatible wheels and a neutral proving-ground surface.

#pragma once

#include "SceneCodec.h"
#include "../PhysicalDynamics/Vehicle/VehicleGeometry.h"

namespace Frontier
{

class VehicleStructure
{
public:
    void Construct();
    bool Export(const std::string& Location, std::string& Refusal) const;
    const std::vector<TriangleIndex>& QueryTriangles() const noexcept { return Triangles; }
    const std::vector<MaterialDescriptor>& QueryMaterials() const noexcept { return Materials; }
    const std::vector<TriangleSpanRecord>& QuerySpans() const noexcept { return Spans; }

private:
    void AppendFacet(const Vector3& Alpha, const Vector3& Beta, const Vector3& Gamma, uint32_t Material);
    void BeginSpan(const char* Name, bool Dynamic);
    void FinishSpan();

    std::vector<TriangleIndex>      Triangles;
    std::vector<MaterialDescriptor> Materials;
    std::vector<TriangleSpanRecord> Spans;
};

} // namespace Frontier
