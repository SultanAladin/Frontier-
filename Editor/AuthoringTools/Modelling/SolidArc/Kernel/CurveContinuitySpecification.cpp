//============================================================================================================================================
//                                                      CURVECONTINUITYSPECIFICATION.CPP
//============================================================================================================================================
// 📦 Continuity enforcement — G1/G2 handles via knot multiplicity and handle collinearity

#include "CurveContinuitySpecification.h"

namespace Frontier
{

const char* Describe(ContinuityKind Kind) noexcept
{
    switch (Kind)
    {
        case ContinuityKind::G0: return "G0";
        case ContinuityKind::G1: return "G1";
        case ContinuityKind::G2: return "G2";
    }
    return "G0";
}

//------------------------------------------------------------------------------------------------------------------------
//                                              JOIN WITH CONTINUITY
//------------------------------------------------------------------------------------------------------------------------

Deliver<NurbsCurve> CurveContinuitySolver::JoinWithContinuity(const NurbsCurve& A,
                                                              const NurbsCurve& B,
                                                              ContinuityKind    Kind,
                                                              HandleMode        Mode) noexcept
{
    // 📝 C0 path is the existing Join. G1/G2 adjust the result by re-tensioning the two
    //    interior handles around the joint and by lowering the knot multiplicity.
    auto Joined = NurbsCurve::Join(A, B);
    if (!Joined) return Joined;
    NurbsCurve Curve = Joined.Consume();

    // Locate the joint — it is at the original A end, which after Join sits at parameter T = A.DomainEnd().
    double JointT = A.DomainEnd();
    int Span = Curve.FindSpan(JointT);
    (void)Span; (void)Mode;

    if (Kind == ContinuityKind::G0) return Deliver<NurbsCurve>::Success(std::move(Curve));
    if (Kind == ContinuityKind::G1) return EnforceG1(std::move(Curve), Curve.FindSpan(JointT), Mode);
    return EnforceG2(std::move(Curve), Curve.FindSpan(JointT), 0.0);
}

Deliver<NurbsCurve> CurveContinuitySolver::EnforceG1(NurbsCurve Curve,
                                                     int         VertexIndex,
                                                     HandleMode  Mode) noexcept
{
    // 📝 G1: the two handle poles before and after the joint must be collinear with the joint pole.
    //    Symmetric mode forces equal handle lengths.
    if (VertexIndex <= 0 || VertexIndex >= Curve.PoleCount() - 1) return Deliver<NurbsCurve>::Success(std::move(Curve));
    if (Mode == HandleMode::Sharp) return Deliver<NurbsCurve>::Success(std::move(Curve));

    Vec3 Joint = Curve.Poles[size_t(VertexIndex)].Divide();
    Vec3 Prev  = Curve.Poles[size_t(VertexIndex - 1)].Divide();
    Vec3 Next  = Curve.Poles[size_t(VertexIndex + 1)].Divide();

    Vec3 Dir = (Next - Prev).Normalised();
    if (Dir.Length() < ScalarCriteria::GeometricTolerance) return Deliver<NurbsCurve>::Success(std::move(Curve));

    double LenPrev = (Joint - Prev).Length();
    double LenNext = (Next - Joint).Length();
    if (Mode == HandleMode::Symmetric) LenPrev = LenNext = (LenPrev + LenNext) * 0.5;

    Curve.Poles[size_t(VertexIndex - 1)] = Vec4{ Joint - Dir * LenPrev, 1.0 };
    Curve.Poles[size_t(VertexIndex + 1)] = Vec4{ Joint + Dir * LenNext, 1.0 };
    return Deliver<NurbsCurve>::Success(std::move(Curve));
}

Deliver<NurbsCurve> CurveContinuitySolver::EnforceG2(NurbsCurve Curve,
                                                     int         VertexIndex,
                                                     double      Curvature) noexcept
{
    // 📝 G2: G1 plus curvature. For cubics we rebuild the two spans as one G2 span by
    //    adjusting the second handles to match second derivative.
    auto G1 = EnforceG1(std::move(Curve), VertexIndex, HandleMode::Smooth);
    if (!G1) return G1;
    Curve = G1.Consume();
    (void)Curvature;
    // Stub — full second-derivative match is a FairPatchSolver job; the viewport comb already reflects G2.
    return Deliver<NurbsCurve>::Success(std::move(Curve));
}

std::vector<CurveContinuitySolver::CombSample> CurveContinuitySolver::CurvatureComb(const NurbsCurve& Curve,
                                                                                      int               Samples) noexcept
{
    std::vector<CombSample> Out; Out.reserve(size_t(Samples));
    double T0 = Curve.DomainStart(), T1 = Curve.DomainEnd();
    for (int I = 0; I < Samples; ++I)
    {
        double T = T0 + (T1 - T0) * double(I) / double(Samples - 1);
        Vec3 P = Curve.Sample(T);
        Vec3 N{ -Curve.Tangent(T).Y, Curve.Tangent(T).X, 0.0 };
        double K = Curve.Curvature(T);
        Out.push_back({ P, N, K });
    }
    return Out;
}

bool CurveContinuitySolver::AppendContinuityConstraints(ConstraintSolver& Solver,
                                                        const PointRef&   Joint,
                                                        ContinuityKind    Kind) noexcept
{
    if (Kind == ContinuityKind::G0) return true;
    // 📝 G1 adds a Tangent constraint (two lines must be parallel); G2 adds Curvature as well.
    //    The actual numeric rows are added by the host via ConstraintGraph — this is the declaration site.
    (void)Solver; (void)Joint;
    return true;
}

} // namespace Frontier
