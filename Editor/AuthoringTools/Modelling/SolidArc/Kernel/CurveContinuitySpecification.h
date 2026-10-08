//============================================================================================================================================
//                                                      CURVECONTINUITYSPECIFICATION.H
//============================================================================================================================================
// 📦 Per-vertex continuity for CarEditor — G0 / G1 / G2 on NURBS poly-curves with curvature combs

#pragma once

#include "CurveSpecification.h"
#include "ConstraintSolver.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTINUITY KIND
//------------------------------------------------------------------------------------------------------------------------

enum class ContinuityKind : uint8_t
{
    G0 = 0,                                                                 // [-] positional only — C0 join, no tangent handling
    G1 = 1,                                                                 // [-] tangent continuous — direction matches, magnitude free
    G2 = 2,                                                                 // [-] curvature continuous — direction + curvature match, comb visible
};

[[nodiscard]] const char* Describe(ContinuityKind Kind) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    HANDLE MODE
//------------------------------------------------------------------------------------------------------------------------

enum class HandleMode : uint8_t
{
    Auto      = 0,                                                          // [-] solver picks tangent from neighbours
    Sharp     = 1,                                                          // [-] break — no continuity, two independent handles
    Smooth    = 2,                                                          // [-] G1 — one tangent line, two handles free length
    Symmetric = 3,                                                          // [-] G1 + equal handle lengths (G2-like for cubics)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                VERTEX CONTINUITY RECORD
//------------------------------------------------------------------------------------------------------------------------

struct VertexContinuity
{
    ContinuityKind Kind = ContinuityKind::G0;                               // [-] continuity at this join
    HandleMode     Mode = HandleMode::Auto;                                 // [-] how the two handles relate
    double         Tension = 0.0;                                            // [-] G1 magnitude bias — 0 = neutral, ±1 = tight/loose
    double         Curvature = 0.0;                                          // [1/m] G2 curvature value when Kind == G2
    bool           CombEnabled = false;                                      // [-] show curvature comb in the viewport
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  CONTINUITY SOLVER
//------------------------------------------------------------------------------------------------------------------------

class CurveContinuitySolver
{
public:
    // Join two NURBS curves at their endpoints with the requested continuity.
    // A == predecessor, B == successor. Their endpoints must be within MergeTolerance.
    // Returns a single joined curve whose interior knot multiplicity encodes the continuity:
    //   G0 → multiplicity = degree, G1 → degree-1, G2 → degree-2 (for cubics: 3/2/1).
    [[nodiscard]] static Deliver<NurbsCurve> JoinWithContinuity(const NurbsCurve& A,
                                                                const NurbsCurve& B,
                                                                ContinuityKind    Kind,
                                                                HandleMode        Mode) noexcept;

    // Enforce G1 at an interior vertex of a poly-curve (three consecutive poles).
    // Adjusts the two handle poles so they become collinear with the vertex.
    [[nodiscard]] static Deliver<NurbsCurve> EnforceG1(NurbsCurve Curve,
                                                        int         VertexIndex,
                                                        HandleMode  Mode) noexcept;

    // Enforce G2 — G1 plus curvature match. Requires degree ≥ 3. Rebuilds the two adjacent
    // spans as a single G2 span with matched second derivative.
    [[nodiscard]] static Deliver<NurbsCurve> EnforceG2(NurbsCurve Curve,
                                                        int         VertexIndex,
                                                        double      Curvature) noexcept;

    // Evaluate curvature combs for the viewport overlay.
    struct CombSample
    {
        Vec3 Point{};                                                       // [m] point on the curve
        Vec3 Normal{};                                                      // [-] unit normal in the workplane
        double Curvature = 0.0;                                             // [1/m] signed curvature
    };
    [[nodiscard]] static std::vector<CombSample> CurvatureComb(const NurbsCurve& Curve,
                                                                int               Samples = 64) noexcept;

    // ConstraintGraph integration — add Tangent / Curvature rows for a join.
    [[nodiscard]] static bool AppendContinuityConstraints(ConstraintSolver& Solver,
                                                          const PointRef&   Joint,
                                                          ContinuityKind    Kind) noexcept;
};

} // namespace Frontier
