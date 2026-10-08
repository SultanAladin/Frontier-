//============================================================================================================================================
//                                                          CARLOFTSPECIFICATION.CPP
//============================================================================================================================================
// 📦 Loft dispatch — Ruled / Normal / Developable / Smooth

#include "CarLoftSpecification.h"

namespace Frontier
{

const char* Describe(LoftKind Kind) noexcept
{
    switch (Kind)
    {
        case LoftKind::Ruled:       return "Ruled";
        case LoftKind::Normal:      return "Normal";
        case LoftKind::Developable: return "Developable";
        case LoftKind::Smooth:      return "Smooth";
    }
    return "Smooth";
}

Deliver<NurbsSurface> CarLoftSolver::Build(const CarLoftSpecification& Spec) noexcept
{
    if (Spec.Sections.size() < 2) return Deliver<NurbsSurface>::Failure(Refusal{ "loft needs at least two sections" });
    switch (Spec.Kind)
    {
        case LoftKind::Ruled:       return BuildRuled(Spec);
        case LoftKind::Normal:      return BuildNormal(Spec);
        case LoftKind::Developable: return BuildDevelopable(Spec);
        case LoftKind::Smooth:      return BuildSmooth(Spec);
    }
    return BuildSmooth(Spec);
}

Deliver<NurbsSurface> CarLoftSolver::BuildRuled(const CarLoftSpecification& Spec) noexcept
{
    // 📝 Ruled — linear skin between each pair, degree 1 in V. Existing Ruled does one pair; we chain.
    if (Spec.Sections.size() == 2) return NurbsSurface::Ruled(Spec.Sections[0], Spec.Sections[1]);
    return NurbsSurface::Loft(Spec.Sections, 1);
}

Deliver<NurbsSurface> CarLoftSolver::BuildNormal(const CarLoftSpecification& Spec) noexcept
{
    // 📝 Normal — sweep the first section along the guide, then loft. Stub chains to Loft; the guide
    //    normal handling is a Sweep with the guide as path.
    if (Spec.Guide.PoleCount() > 1) return NurbsSurface::Loft(Spec.Sections, Spec.DegreeV);
    return NurbsSurface::Loft(Spec.Sections, Spec.DegreeV);
}

Deliver<NurbsSurface> CarLoftSolver::BuildDevelopable(const CarLoftSpecification& Spec) noexcept
{
    // 📝 Developable — fair the loft until Gaussian curvature vanishes within tolerance.
    //    For now delegate to Loft; FairPatchSolver will enforce developability in P2.
    (void)Spec.DevelopableTolerance;
    return NurbsSurface::Loft(Spec.Sections, Spec.DegreeV);
}

Deliver<NurbsSurface> CarLoftSolver::BuildSmooth(const CarLoftSpecification& Spec) noexcept
{
    // 📝 Smooth — full G2 skin, the Class-A path. Directly use Skin (degree 3 V).
    return NurbsSurface::Loft(Spec.Sections, Spec.DegreeV);
}

} // namespace Frontier
