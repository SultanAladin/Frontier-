//============================================================================================================================================
//                                                          CARLOFTSPECIFICATION.H
//============================================================================================================================================
// 📦 Car loft types — Ruled / Normal / Developable / Smooth G2 over NURBS sections

#pragma once

#include "SurfaceSpecification.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                        LOFT KIND
//------------------------------------------------------------------------------------------------------------------------

enum class LoftKind : uint8_t
{
    Ruled       = 0,                                                        // [-] straight degree-1 in V — ruled sheet
    Normal      = 1,                                                        // [-] sections stay normal to a guide rail
    Developable = 2,                                                        // [-] developable (unrollable) fairing
    Smooth      = 3,                                                        // [-] full G2 skin — Class-A, curvature continuous
};

[[nodiscard]] const char* Describe(LoftKind Kind) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                     LOFT SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

struct CarLoftSpecification
{
    std::vector<NurbsCurve> Sections;                                       // [-] ordered sections — at least two
    NurbsCurve              Guide;                                          // [-] optional guide rail for Normal loft
    LoftKind                Kind = LoftKind::Smooth;                        // [-] which fairing to use
    int                     DegreeV = 3;                                    // [-] loft degree in V (1 for Ruled)
    bool                    Closed = false;                                 // [-] closed loop (belt line → belt line)
    double                  DevelopableTolerance = 1e-4;                    // [m] Developable angle tolerance
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       LOFT SOLVER
//------------------------------------------------------------------------------------------------------------------------

class CarLoftSolver
{
public:
    [[nodiscard]] static Deliver<NurbsSurface> Build(const CarLoftSpecification& Spec) noexcept;

private:
    [[nodiscard]] static Deliver<NurbsSurface> BuildRuled(const CarLoftSpecification& Spec) noexcept;
    [[nodiscard]] static Deliver<NurbsSurface> BuildNormal(const CarLoftSpecification& Spec) noexcept;
    [[nodiscard]] static Deliver<NurbsSurface> BuildDevelopable(const CarLoftSpecification& Spec) noexcept;
    [[nodiscard]] static Deliver<NurbsSurface> BuildSmooth(const CarLoftSpecification& Spec) noexcept;
};

} // namespace Frontier
