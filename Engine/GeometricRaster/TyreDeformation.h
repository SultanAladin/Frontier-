//============================================================================================================================================
//                                                           TYREDEFORMATION.H
//============================================================================================================================================
// 📦 CPU mirror of Shaders/TyreDeformation.slang: the identical function compiled as C++ for GPU-free proofs.
//
// 📐 The shader text is included through SlangCpuShim.h, so there is one arithmetic, not two. The plain
//    TyreDeformationRecord (float[4] fields, the uploaded layout) is widened into the shim's vec4 record here.

#pragma once

#include "TyreDeformationRecord.h"
#include <cmath>
#include "../Shaders/SlangCpuShim.h"   // global-scope GLSL vocabulary (vec3/vec4, dot, clamp …), as every CPU port does

namespace Frontier::TyreDeformationPort {
#include "../Shaders/TyreDeformation.slang"

[[nodiscard]] inline ::Frontier::TyreDeformationPort::TyreDeformationRecord Widen(const ::Frontier::TyreDeformationRecord& R) noexcept
{
    const auto V = [](const float* F) { return vec4(F[0], F[1], F[2], F[3]); };
    ::Frontier::TyreDeformationPort::TyreDeformationRecord S;
    S.Hub = V(R.Hub); S.Axle = V(R.Axle); S.Ground = V(R.Ground); S.Normal = V(R.Normal);
    S.Lateral = V(R.Lateral); S.Longitudinal = V(R.Longitudinal); S.Tuning = V(R.Tuning); S.Reserved = V(R.Reserved);
    return S;
}
} // namespace Frontier::TyreDeformationPort

namespace Frontier {

// World point in, deformed world point out — exactly what the vertex stage and the resolve compute.
inline void DeformTyreWorldPoint(const TyreDeformationRecord& Record, const float In[3], float Out[3]) noexcept
{
    const auto S = TyreDeformationPort::Widen(Record);
    const vec3 P = TyreDeformationPort::DeformTyrePoint(vec3(In[0], In[1], In[2]), S);
    Out[0] = P.x; Out[1] = P.y; Out[2] = P.z;
}

} // namespace Frontier
