//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Kernel/BlendSolver.cpp — chamfer / fillet / face push as regularised set operations
//============================================================================================================================================
#include "BlendSolver.h"
#include "IntersectionSolver.h"
#include <algorithm>
#include <cmath>
#include <optional>

namespace Frontier
{
namespace
{
    constexpr double Tol = ScalarCriteria::MergeTolerance;

    // A rectangular solid given by an origin corner and three edge vectors, built from six planar faces and sewn.
    //    Used as the half-space cutter: it is finite, so it must be made comfortably larger than the target body.
    Deliver<BrepBody> OrientedBox(Vec3 Corner, Vec3 U, Vec3 V, Vec3 W, double LengthU, double LengthV, double LengthW) noexcept
    {
        std::vector<NurbsSurface> Faces;
        auto Put = [&](Deliver<NurbsSurface> S) { if (S) Faces.push_back(std::move(S.Payload)); };
        Put(NurbsSurface::Plane(Corner, U, V, LengthU, LengthV));
        Put(NurbsSurface::Plane(Corner + W * LengthW, U, V, LengthU, LengthV));
        Put(NurbsSurface::Plane(Corner, U, W, LengthU, LengthW));
        Put(NurbsSurface::Plane(Corner + V * LengthV, U, W, LengthU, LengthW));
        Put(NurbsSurface::Plane(Corner, V, W, LengthV, LengthW));
        Put(NurbsSurface::Plane(Corner + U * LengthU, V, W, LengthV, LengthW));
        if (Faces.size() != 6) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "cutter face is degenerate");
        return BrepBody::Sew(Faces);
    }

    // The tool that removes a corner. Two things make this harder than "cut with a half-space":
    //
    //    1. It must be LOCAL across the corner. An unbounded half-space also lops off every other part of the body
    //       lying beyond the set-back plane — on the spanner it cut the whole head off.
    //    2. Its END CAPS must not land on a neighbouring face or vertex. The boolean is exact, not tolerant: it
    //       refuses a non-transversal contact ("surface singularity or seam corner", "passes exactly through a
    //       vertex") rather than guessing. A cutter stopping exactly at the edge's endpoints is precisely that case,
    //       and one running well past them slices into whatever is around the corner.
    //
    //    There is no single margin that satisfies both for every edge — measured across the 30 edges of the pushed
    //    spanner, every fixed choice either refuses or over-cuts somewhere. So the cutter is parameterised and
    //    ChamferEdge tries a ladder of them, keeping the first that both closes and matches the closed-form volume.
    //    HalfWidth is measured across the corner, Margin along the edge (negative = stop short of the endpoints).
    Deliver<BrepBody> CornerCutter(const EdgeCornerFrame& F, double Offset, double HalfWidth, double Margin, double Outward) noexcept
    {
        Vec3 W = F.Bisector;                                                             // outward: the side cut away
        Vec3 U = F.Tangent.Cross(W);
        if (U.Length() <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "cutter frame is degenerate");
        U = U.Normalised();
        double Span = F.Length + 2.0 * Margin;
        if (Span <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "cutter is shorter than the edge allows");
        Vec3 Corner = F.Start + W * Offset - U * HalfWidth - F.Tangent * Margin;
        return OrientedBox(Corner, U, F.Tangent, W, 2.0 * HalfWidth, Span, Outward);
    }

    // Outward normal of a planar face, and whether it really is planar.
    bool PlanarNormal(const BrepBody& Body, int Face, Vec3& Out) noexcept
    {
        Vec3 N = Body.FaceNormal(Face, 0.5, 0.5);
        if (N.Length() <= Tol) return false;
        N = N.Normalised();
        const double Samples[4][2] = { { 0.25, 0.25 }, { 0.75, 0.25 }, { 0.25, 0.75 }, { 0.75, 0.75 } };
        for (const auto& S : Samples)
        {
            Vec3 M = Body.FaceNormal(Face, S[0], S[1]);
            if (M.Length() <= Tol) return false;
            if (M.Normalised().Dot(N) < 0.999999) return false;
        }
        Out = N;
        return true;
    }

    // A full circular cylinder cap has an exact chamfer construction: retain the cylindrical run and sew a conical
    // frustum at the selected cap. It avoids asking a planar prism cutter to approximate a curved edge.
    struct CylinderCap
    {
        Vec3   Base, Axis;
        double Radius = 0.0, Height = 0.0;
        bool   Upper = false;
    };

    std::optional<CylinderCap> NativeCylinderCap(const BrepBody& Body, int Edge) noexcept
    {
        if (Edge < 0 || Edge >= static_cast<int>(Body.Edges.size()) || !Body.Validate().Solid() ||
            Body.Vertices.size() != 2 || Body.Edges.size() != 3 || Body.Coedges.size() != 6 || Body.Loops.size() != 3 || Body.Faces.size() != 3) return std::nullopt;
        const BrepEdge& Boundary = Body.Edges[Edge];
        if (!Boundary.Closed() || Boundary.Curve.Classification != CurveClassification::Circle || Boundary.Curve.Degree != 2 || !Boundary.Curve.Rational() || Boundary.Coedges.size() != 2) return std::nullopt;
        int Rims = 0, Seams = 0;
        for (const BrepEdge& Candidate : Body.Edges)
        {
            if (Candidate.Closed() && Candidate.Curve.Classification == CurveClassification::Circle && Candidate.Curve.Degree == 2 && Candidate.Curve.Rational() && Candidate.Coedges.size() == 2) ++Rims;
            else if (!Candidate.Closed() && Candidate.Curve.Classification == CurveClassification::Line && Candidate.Curve.Degree == 1 && Candidate.Coedges.size() == 2) ++Seams;
            else return std::nullopt;
        }
        if (Rims != 2 || Seams != 1) return std::nullopt;
        int Side = -1, Caps[2] = { -1, -1 }, CapCount = 0;
        for (size_t F = 0; F < Body.Faces.size(); ++F)
        {
            const BrepFace& Face = Body.Faces[F];
            if (Face.Loops.size() != 1) return std::nullopt;
            if (Face.Surface.Classification == SurfaceClassification::Cylinder)
            {
                if (Side >= 0) return std::nullopt;
                Side = static_cast<int>(F);
            }
            else if (Face.Surface.Classification == SurfaceClassification::Plane)
            {
                if (CapCount == 2) return std::nullopt;
                Caps[CapCount++] = static_cast<int>(F);
            }
            else return std::nullopt;
        }
        if (Side < 0 || CapCount != 2) return std::nullopt;
        int SelectedCap = -1;
        for (int Coedge : Boundary.Coedges)
        {
            if (Coedge < 0 || Coedge >= static_cast<int>(Body.Coedges.size())) return std::nullopt;
            int Face = Body.Coedges[Coedge].Face;
            if (Face == Side) continue;
            if (Face == Caps[0] || Face == Caps[1]) { if (SelectedCap >= 0) return std::nullopt; SelectedCap = Face; }
            else return std::nullopt;
        }
        if (SelectedCap < 0) return std::nullopt;
        const NurbsSurface& Cylinder = Body.Faces[Side].Surface;
        Vec3 Axis = Cylinder.Axis.Normalised();
        if (Axis.Length() <= Tol || Cylinder.RadiusMajor <= Tol || std::fabs(Cylinder.RadiusMajor - Cylinder.RadiusMinor) > Tol) return std::nullopt;
        const double RadiusTolerance = 1e-8 * std::max(1.0, Cylinder.RadiusMajor);
        for (const BrepEdge& Rim : Body.Edges)
            if (Rim.Closed())
            {
                Vec3 Point = Rim.Curve.Sample(0.5 * (Rim.Curve.DomainStart() + Rim.Curve.DomainEnd()));
                double Along = (Point - Cylinder.Origin).Dot(Axis);
                Vec3 Radial = Point - (Cylinder.Origin + Axis * Along);
                if (std::fabs(Radial.Length() - Cylinder.RadiusMajor) > RadiusTolerance) return std::nullopt;
                for (int I = 0; I < 5; ++I)
                {
                    Vec3 Sample = Rim.Curve.Sample(Rim.Curve.DomainStart() + (Rim.Curve.DomainEnd() - Rim.Curve.DomainStart()) * (static_cast<double>(I) / 4.0));
                    if (std::fabs((Sample - Cylinder.Origin).Dot(Axis) - Along) > RadiusTolerance) return std::nullopt;
                }
            }
        for (int Cap : Caps)
        {
            Vec3 Normal;
            if (!PlanarNormal(Body, Cap, Normal) || std::fabs(Normal.Dot(Axis)) < 1.0 - 1e-8) return std::nullopt;
        }
        const auto HeightAt = [&](int Face)
        {
            const NurbsSurface& Surface = Body.Faces[Face].Surface;
            Vec3 Point = Surface.Sample(0.5 * (Surface.DomainStartU() + Surface.DomainEndU()), 0.5 * (Surface.DomainStartV() + Surface.DomainEndV()));
            return (Point - Cylinder.Origin).Dot(Axis);
        };
        double T0 = HeightAt(Caps[0]), T1 = HeightAt(Caps[1]);
        double Low = std::min(T0, T1), High = std::max(T0, T1), Height = High - Low;
        const double Epsilon = 1e-8 * std::max({ 1.0, Cylinder.RadiusMajor, Height });
        if (Height <= Epsilon) return std::nullopt;
        double Chosen = HeightAt(SelectedCap);
        bool Upper = std::fabs(Chosen - High) <= Epsilon;
        if (!Upper && std::fabs(Chosen - Low) > Epsilon) return std::nullopt;
        Vec3 SeamPoint = Boundary.Curve.Sample(0.5 * (Boundary.Curve.DomainStart() + Boundary.Curve.DomainEnd()));
        Vec3 Radial = SeamPoint - (Cylinder.Origin + Axis * Chosen);
        if (std::fabs(Radial.Dot(Axis)) > Epsilon || std::fabs(Radial.Length() - Cylinder.RadiusMajor) > Epsilon) return std::nullopt;
        return CylinderCap{ Cylinder.Origin + Axis * Low, Axis, Cylinder.RadiusMajor, Height, Upper };
    }

    Deliver<BrepBody> ChamferCylinderCap(const CylinderCap& Cap, double SetBack) noexcept
    {
        if (SetBack <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "set-back is zero or negative");
        if (SetBack >= Cap.Radius - Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "set-back reaches the cylinder axis");
        if (SetBack >= Cap.Height - Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "set-back consumes the entire cylinder height");
        std::vector<NurbsSurface> Faces;
        Deliver<NurbsSurface> Cylinder = Cap.Upper
            ? NurbsSurface::Cylinder(Cap.Base, Cap.Axis, Cap.Radius, Cap.Height - SetBack)
            : NurbsSurface::Cylinder(Cap.Base + Cap.Axis * SetBack, Cap.Axis, Cap.Radius, Cap.Height - SetBack);
        Deliver<NurbsSurface> Cone = Cap.Upper
            ? NurbsSurface::Cone(Cap.Base + Cap.Axis * (Cap.Height - SetBack), Cap.Axis, Cap.Radius, Cap.Radius - SetBack, SetBack)
            : NurbsSurface::Cone(Cap.Base, Cap.Axis, Cap.Radius - SetBack, Cap.Radius, SetBack);
        if (!Cylinder || !Cone) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "cylindrical chamfer support is degenerate");
        Faces.push_back(std::move(Cylinder.Payload)); Faces.push_back(std::move(Cone.Payload));
        Deliver<BrepBody> Result = BrepBody::Sew(Faces);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "cylindrical chamfer could not be sewn into a valid solid");
        return Result;
    }

    std::optional<CylinderCap> NativeCylinderCapFace(const BrepBody& Body, int Face) noexcept
    {
        if (Face < 0 || Face >= static_cast<int>(Body.Faces.size()) || Body.Faces[Face].Surface.Classification != SurfaceClassification::Plane) return std::nullopt;
        for (size_t E = 0; E < Body.Edges.size(); ++E)
        {
            const BrepEdge& Boundary = Body.Edges[E];
            if (!Boundary.Closed()) continue;
            bool OnFace = false;
            for (int Coedge : Boundary.Coedges)
                if (Coedge >= 0 && Coedge < static_cast<int>(Body.Coedges.size()) && Body.Coedges[Coedge].Face == Face) { OnFace = true; break; }
            if (OnFace)
                if (std::optional<CylinderCap> Cap = NativeCylinderCap(Body, static_cast<int>(E))) return Cap;
        }
        return std::nullopt;
    }

    std::optional<CylinderCap> NativeCylinderSideFace(const BrepBody& Body, int Face) noexcept
    {
        if (Face < 0 || Face >= static_cast<int>(Body.Faces.size()) || Body.Faces[Face].Surface.Classification != SurfaceClassification::Cylinder) return std::nullopt;
        for (size_t E = 0; E < Body.Edges.size(); ++E)
            if (Body.Edges[E].Closed())
                if (std::optional<CylinderCap> Cap = NativeCylinderCap(Body, static_cast<int>(E))) return Cap;
        return std::nullopt;
    }

    // Phase 31's first general smooth-support pair is the circular root where a cylindrical boss leaves a planar
    // annular shoulder. Unlike a three-face cylinder cap, the unsplit edge belongs to a five-face stepped solid and the
    // fillet ADDS its rolling-ball wedge. Phase 32a also follows a complete circular chain across angular representation
    // seams. The classifier derives every patch and dimension from topology/support geometry, never face-table order or
    // a remembered primitive recipe.
    struct PlaneCylinderRoot
    {
        Vec3   Base, Axis;
        double OuterRadius = 0.0, ShoulderHeight = 0.0;
        double BossRadius = 0.0, BossHeight = 0.0;
    };

    bool CircularFrame(const NurbsCurve& Curve, Vec3& Centre, Vec3& Normal, double& Radius) noexcept
    {
        if ((Curve.Classification != CurveClassification::Arc && Curve.Classification != CurveClassification::Circle) ||
            Curve.Degree != 2 || !Curve.Rational()) return false;
        const double T0 = Curve.DomainStart(), Span = Curve.DomainEnd() - T0;
        if (Span <= ScalarCriteria::ParametricEpsilon) return false;
        const double MiddleFraction = Curve.Closed() ? 0.25 : 0.5;
        const double EndFraction = Curve.Closed() ? 0.5 : 1.0;
        Vec3 P0 = Curve.Sample(T0), P1 = Curve.Sample(T0 + Span * MiddleFraction), P2 = Curve.Sample(T0 + Span * EndFraction);
        Vec3 U = P1 - P0, V = P2 - P0, Cross = U.Cross(V);
        const double Denominator = 2.0 * Cross.LengthSquared();
        if (Denominator <= ScalarCriteria::KernelTolerance) return false;
        Centre = P0 + (Cross.Cross(U) * V.LengthSquared() + V.Cross(Cross) * U.LengthSquared()) / Denominator;
        Radius = Centre.Distance(P0);
        if (Radius <= Tol) return false;
        Normal = Cross.Normalised();
        const double Epsilon = 1e-8 * std::max(1.0, Radius);
        for (int I = 0; I <= 8; ++I)
        {
            Vec3 Radial = Curve.Sample(T0 + Span * (static_cast<double>(I) / 8.0)) - Centre;
            if (std::fabs(Radial.Length() - Radius) > Epsilon || std::fabs(Radial.Dot(Normal)) > Epsilon) return false;
        }
        return true;
    }

    bool CylinderEndCentres(const NurbsSurface& Cylinder, Vec3& Start, Vec3& End, double& Radius) noexcept
    {
        if (Cylinder.Classification != SurfaceClassification::Cylinder || Cylinder.RadiusMajor <= Tol ||
            std::fabs(Cylinder.RadiusMajor - Cylinder.RadiusMinor) > Tol) return false;
        const double U0 = Cylinder.DomainStartU(), U1 = Cylinder.DomainEndU();
        const double V0 = Cylinder.DomainStartV(), V1 = Cylinder.DomainEndV();
        const double MiddleU = 0.5 * (U0 + U1);
        Vec3 Axis = Cylinder.Axis.Normalised();
        if (Axis.Length() <= Tol) return false;
        Vec3 PointStart = Cylinder.Sample(MiddleU, V0), PointEnd = Cylinder.Sample(MiddleU, V1);
        Start = Cylinder.Origin + Axis * (PointStart - Cylinder.Origin).Dot(Axis);
        End = Cylinder.Origin + Axis * (PointEnd - Cylinder.Origin).Dot(Axis);
        Radius = Cylinder.RadiusMajor;
        const double Height = Start.Distance(End);
        const double Epsilon = 1e-8 * std::max({ 1.0, Radius, Height });
        if (Height <= Epsilon || (End - Start).Normalised().Cross(Axis).Length() > 1e-8) return false;
        for (double V : { V0, V1 })
        {
            Vec3 Centre = V == V0 ? Start : End;
            for (int I = 0; I <= 8; ++I)
            {
                Vec3 Point = Cylinder.Sample(U0 + (U1 - U0) * (static_cast<double>(I) / 8.0), V);
                Vec3 Radial = Point - Centre;
                if (std::fabs(Radial.Length() - Radius) > Epsilon || std::fabs(Radial.Dot(Axis)) > Epsilon) return false;
            }
        }
        return true;
    }

    bool CompleteCircularChain(const BrepBody& Body, const std::vector<int>& Chain,
                               Vec3 Centre, Vec3 Axis, double Radius) noexcept
    {
        if (Chain.empty()) return false;
        if (Chain.size() == 1 && Body.Edges[Chain.front()].Closed()) return true;
        std::vector<int> Degrees(Body.Vertices.size(), 0);
        double Angle = 0.0;
        for (int Edge : Chain)
        {
            if (Edge < 0 || Edge >= static_cast<int>(Body.Edges.size())) return false;
            const BrepEdge& Candidate = Body.Edges[Edge];
            if (Candidate.Closed() || Candidate.VertexStart < 0 || Candidate.VertexEnd < 0) return false;
            Vec3 CandidateCentre, CandidateNormal; double CandidateRadius = 0.0;
            if (!CircularFrame(Candidate.Curve, CandidateCentre, CandidateNormal, CandidateRadius) ||
                CandidateCentre.Distance(Centre) > 1e-8 * std::max(1.0, Radius) ||
                std::fabs(CandidateRadius - Radius) > 1e-8 * std::max(1.0, Radius) ||
                std::fabs(CandidateNormal.Dot(Axis)) < 1.0 - 1e-8) return false;
            ++Degrees[Candidate.VertexStart]; ++Degrees[Candidate.VertexEnd];
            const double T0 = Candidate.Curve.DomainStart(), T1 = Candidate.Curve.DomainEnd(), TM = 0.5 * (T0 + T1);
            Vec3 R0 = (Candidate.Curve.Sample(T0) - Centre).Normalised();
            Vec3 RM = (Candidate.Curve.Sample(TM) - Centre).Normalised();
            Vec3 R1 = (Candidate.Curve.Sample(T1) - Centre).Normalised();
            Angle += std::acos(ScalarCriteria::Clamp(R0.Dot(RM), -1.0, 1.0));
            Angle += std::acos(ScalarCriteria::Clamp(RM.Dot(R1), -1.0, 1.0));
        }
        for (int Degree : Degrees) if (Degree != 0 && Degree != 2) return false;
        return std::fabs(Angle - ScalarCriteria::TwoPi) <= 1e-6;
    }

    std::optional<PlaneCylinderRoot> PlaneCylinderBossRoot(const BrepBody& Body, int Edge) noexcept
    {
        if (Edge < 0 || Edge >= static_cast<int>(Body.Edges.size()) || !Body.Validate().Solid()) return std::nullopt;
        Deliver<std::vector<int>> ChainResult = BlendSolver::TangentChain(Body, Edge);
        if (!ChainResult || ChainResult.Payload.empty()) return std::nullopt;
        const std::vector<int>& RootEdges = ChainResult.Payload;
        const size_t SegmentCount = RootEdges.size();

        // One angular patch for each outer-wall, shoulder, and boss segment, plus two planar end caps. The same formulas
        // cover the original single closed edge and any fully sewn representation-seam split of that circular edge.
        if (Body.Vertices.size() != 4 * SegmentCount || Body.Edges.size() != 7 * SegmentCount ||
            Body.Coedges.size() != 14 * SegmentCount || Body.Loops.size() != 3 * SegmentCount + 2 ||
            Body.Faces.size() != 3 * SegmentCount + 2) return std::nullopt;

        auto Contains = [](const std::vector<int>& Values, int Value) noexcept
        { return std::find(Values.begin(), Values.end(), Value) != Values.end(); };
        auto AppendUnique = [&](std::vector<int>& Values, int Value) noexcept
        { if (!Contains(Values, Value)) Values.push_back(Value); };

        Vec3 RootCentre, Axis; double BossRadius = 0.0, BossHeight = 0.0;
        bool FirstRoot = true;
        std::vector<int> ShoulderFaces, BossFaces;
        for (int RootIndex : RootEdges)
        {
            const BrepEdge& RootEdge = Body.Edges[RootIndex];
            if (RootEdge.Coedges.size() != 2) return std::nullopt;
            Vec3 CandidateCentre, CandidateCircleNormal; double CandidateRadius = 0.0;
            if (!CircularFrame(RootEdge.Curve, CandidateCentre, CandidateCircleNormal, CandidateRadius)) return std::nullopt;

            int ShoulderFace = -1, BossFace = -1; Vec3 CandidateAxis;
            for (int Coedge : RootEdge.Coedges)
            {
                if (Coedge < 0 || Coedge >= static_cast<int>(Body.Coedges.size())) return std::nullopt;
                int Face = Body.Coedges[Coedge].Face;
                if (Face < 0 || Face >= static_cast<int>(Body.Faces.size())) return std::nullopt;
                if (Body.Faces[Face].Surface.Classification == SurfaceClassification::Cylinder)
                {
                    if (BossFace >= 0) return std::nullopt;
                    BossFace = Face;
                }
                else
                {
                    Vec3 Normal;
                    if (ShoulderFace >= 0 || !PlanarNormal(Body, Face, Normal)) return std::nullopt;
                    ShoulderFace = Face; CandidateAxis = Normal.Normalised();
                }
            }
            if (ShoulderFace < 0 || BossFace < 0 || CandidateAxis.Length() <= Tol ||
                std::fabs(CandidateCircleNormal.Dot(CandidateAxis)) < 1.0 - 1e-8) return std::nullopt;

            Vec3 BossStart, BossEnd; double ClassifiedBossRadius = 0.0;
            if (!CylinderEndCentres(Body.Faces[BossFace].Surface, BossStart, BossEnd, ClassifiedBossRadius)) return std::nullopt;
            const double Scale = std::max({ 1.0, CandidateRadius, ClassifiedBossRadius, BossStart.Distance(BossEnd) });
            const double Epsilon = 1e-8 * Scale;
            if (std::fabs(CandidateRadius - ClassifiedBossRadius) > Epsilon) return std::nullopt;
            Vec3 BossOther;
            if (BossStart.Distance(CandidateCentre) <= Epsilon) BossOther = BossEnd;
            else if (BossEnd.Distance(CandidateCentre) <= Epsilon) BossOther = BossStart;
            else return std::nullopt;
            double CandidateBossHeight = BossOther.Distance(CandidateCentre);
            if (CandidateBossHeight <= Epsilon ||
                (BossOther - CandidateCentre).Normalised().Dot(CandidateAxis) < 1.0 - 1e-8) return std::nullopt;

            if (FirstRoot)
            {
                RootCentre = CandidateCentre; Axis = CandidateAxis;
                BossRadius = CandidateRadius; BossHeight = CandidateBossHeight;
                FirstRoot = false;
            }
            else if (CandidateCentre.Distance(RootCentre) > Epsilon || CandidateAxis.Dot(Axis) < 1.0 - 1e-8 ||
                     std::fabs(CandidateRadius - BossRadius) > Epsilon ||
                     std::fabs(CandidateBossHeight - BossHeight) > Epsilon) return std::nullopt;
            AppendUnique(ShoulderFaces, ShoulderFace);
            AppendUnique(BossFaces, BossFace);
        }
        if (FirstRoot || ShoulderFaces.size() != SegmentCount || BossFaces.size() != SegmentCount ||
            !CompleteCircularChain(Body, RootEdges, RootCentre, Axis, BossRadius)) return std::nullopt;

        // Every shoulder patch has one concentric outer circular arc. Follow those arcs through their adjacent cylindrical
        // wall patches, just as the selected tangent chain was followed through the boss/shoulder patches.
        std::vector<int> OuterEdges, OuterFaces;
        double OuterRadius = 0.0;
        for (int ShoulderFace : ShoulderFaces)
        {
            int FoundOuter = -1;
            for (int Loop : Body.Faces[ShoulderFace].Loops)
            {
                if (Loop < 0 || Loop >= static_cast<int>(Body.Loops.size())) return std::nullopt;
                for (int Coedge : Body.Loops[Loop].Coedges)
                {
                    if (Coedge < 0 || Coedge >= static_cast<int>(Body.Coedges.size())) return std::nullopt;
                    int Candidate = Body.Coedges[Coedge].Edge;
                    if (Candidate < 0 || Candidate >= static_cast<int>(Body.Edges.size()) || Contains(RootEdges, Candidate)) continue;
                    Vec3 CandidateCentre, CandidateNormal; double CandidateRadius = 0.0;
                    const double Epsilon = 1e-8 * std::max(1.0, BossRadius);
                    if (!CircularFrame(Body.Edges[Candidate].Curve, CandidateCentre, CandidateNormal, CandidateRadius) ||
                        CandidateCentre.Distance(RootCentre) > Epsilon ||
                        std::fabs(CandidateNormal.Dot(Axis)) < 1.0 - 1e-8 || CandidateRadius <= BossRadius + Epsilon) continue;
                    if (FoundOuter >= 0 && FoundOuter != Candidate) return std::nullopt;
                    FoundOuter = Candidate;
                }
            }
            if (FoundOuter < 0) return std::nullopt;
            Vec3 CandidateCentre, CandidateNormal; double CandidateRadius = 0.0;
            if (!CircularFrame(Body.Edges[FoundOuter].Curve, CandidateCentre, CandidateNormal, CandidateRadius)) return std::nullopt;
            if (OuterRadius <= Tol) OuterRadius = CandidateRadius;
            else if (std::fabs(CandidateRadius - OuterRadius) > 1e-8 * std::max(1.0, OuterRadius)) return std::nullopt;
            AppendUnique(OuterEdges, FoundOuter);

            int OuterFace = -1;
            for (int Coedge : Body.Edges[FoundOuter].Coedges)
            {
                if (Coedge < 0 || Coedge >= static_cast<int>(Body.Coedges.size())) return std::nullopt;
                int Face = Body.Coedges[Coedge].Face;
                if (!Contains(ShoulderFaces, Face))
                {
                    if (OuterFace >= 0 || Face < 0 || Face >= static_cast<int>(Body.Faces.size()) ||
                        Body.Faces[Face].Surface.Classification != SurfaceClassification::Cylinder) return std::nullopt;
                    OuterFace = Face;
                }
            }
            if (OuterFace < 0) return std::nullopt;
            AppendUnique(OuterFaces, OuterFace);
        }
        if (OuterEdges.size() != SegmentCount || OuterFaces.size() != SegmentCount || OuterRadius <= BossRadius ||
            !CompleteCircularChain(Body, OuterEdges, RootCentre, Axis, OuterRadius)) return std::nullopt;

        Vec3 Base; double ShoulderHeight = 0.0; bool FirstOuter = true;
        for (int OuterFace : OuterFaces)
        {
            Vec3 OuterStart, OuterEnd; double ClassifiedOuterRadius = 0.0;
            if (!CylinderEndCentres(Body.Faces[OuterFace].Surface, OuterStart, OuterEnd, ClassifiedOuterRadius)) return std::nullopt;
            const double Epsilon = 1e-8 * std::max({ 1.0, OuterRadius, OuterStart.Distance(OuterEnd) });
            if (std::fabs(OuterRadius - ClassifiedOuterRadius) > Epsilon) return std::nullopt;
            Vec3 CandidateBase;
            if (OuterStart.Distance(RootCentre) <= Epsilon) CandidateBase = OuterEnd;
            else if (OuterEnd.Distance(RootCentre) <= Epsilon) CandidateBase = OuterStart;
            else return std::nullopt;
            double CandidateHeight = CandidateBase.Distance(RootCentre);
            if (CandidateHeight <= Epsilon ||
                (CandidateBase - RootCentre).Normalised().Dot(Axis) > -1.0 + 1e-8) return std::nullopt;
            if (FirstOuter) { Base = CandidateBase; ShoulderHeight = CandidateHeight; FirstOuter = false; }
            else if (CandidateBase.Distance(Base) > Epsilon || std::fabs(CandidateHeight - ShoulderHeight) > Epsilon)
                return std::nullopt;
        }
        if (FirstOuter) return std::nullopt;

        // The only remaining faces are the planar end caps at the derived outer base and boss top.
        int BottomCaps = 0, TopCaps = 0;
        Vec3 BossTop = RootCentre + Axis * BossHeight;
        for (size_t Face = 0; Face < Body.Faces.size(); ++Face)
        {
            int FaceIndex = static_cast<int>(Face);
            if (Contains(ShoulderFaces, FaceIndex) || Contains(BossFaces, FaceIndex) || Contains(OuterFaces, FaceIndex)) continue;
            Vec3 Normal;
            if (!PlanarNormal(Body, FaceIndex, Normal) || std::fabs(Normal.Dot(Axis)) < 1.0 - 1e-8) return std::nullopt;
            const NurbsSurface& Cap = Body.Faces[Face].Surface;
            Vec3 Point = Cap.Sample(0.5 * (Cap.DomainStartU() + Cap.DomainEndU()),
                                    0.5 * (Cap.DomainStartV() + Cap.DomainEndV()));
            const double Epsilon = 1e-8 * std::max({ 1.0, OuterRadius, ShoulderHeight, BossHeight });
            if (std::fabs((Point - Base).Dot(Axis)) <= Epsilon) ++BottomCaps;
            else if (std::fabs((Point - BossTop).Dot(Axis)) <= Epsilon) ++TopCaps;
            else return std::nullopt;
        }
        if (BottomCaps != 1 || TopCaps != 1) return std::nullopt;
        return PlaneCylinderRoot{ Base, Axis, OuterRadius, ShoulderHeight, BossRadius, BossHeight };
    }

    Deliver<BrepBody> FilletPlaneCylinderBossRoot(const PlaneCylinderRoot& Root, double Radius) noexcept
    {
        if (Radius <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "radius is zero or negative");
        if (Radius >= Root.BossHeight - Tol)
            return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet radius consumes the cylindrical boss height");
        if (Radius >= Root.OuterRadius - Root.BossRadius - Tol)
            return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet radius consumes the planar shoulder");

        const Vec3 ShoulderCentre = Root.Base + Root.Axis * Root.ShoulderHeight;
        const Workplane Frame = Workplane::FromNormal(Root.Base, Root.Axis);
        Deliver<NurbsSurface> Outer = NurbsSurface::Cylinder(Root.Base, Root.Axis, Root.OuterRadius, Root.ShoulderHeight);
        Deliver<NurbsCurve> ShoulderLine = NurbsCurve::Line(
            ShoulderCentre + Frame.AxisX * Root.OuterRadius,
            ShoulderCentre + Frame.AxisX * (Root.BossRadius + Radius));
        Deliver<NurbsSurface> Shoulder = ShoulderLine
            ? NurbsSurface::Revolution(ShoulderLine.Payload, Root.Base, Root.Axis, ScalarCriteria::TwoPi)
            : Deliver<NurbsSurface>::Reject(ShoulderLine.Denial.Reason, ShoulderLine.Denial.Detail);

        Vec3 MeridianCentre = ShoulderCentre + Root.Axis * Radius + Frame.AxisX * (Root.BossRadius + Radius);
        Vec3 ShoulderContact = MeridianCentre - Root.Axis * Radius;
        Vec3 BossContact = MeridianCentre - Frame.AxisX * Radius;
        Vec3 MeridianMiddle = MeridianCentre - (Root.Axis + Frame.AxisX) * (Radius / std::sqrt(2.0));
        Deliver<NurbsCurve> Meridian = NurbsCurve::ArcThreePoints(ShoulderContact, MeridianMiddle, BossContact);
        Deliver<NurbsSurface> Roll = Meridian
            ? NurbsSurface::Revolution(Meridian.Payload, Root.Base, Root.Axis, ScalarCriteria::TwoPi)
            : Deliver<NurbsSurface>::Reject(Meridian.Denial.Reason, Meridian.Denial.Detail);
        Deliver<NurbsSurface> Boss = NurbsSurface::Cylinder(
            ShoulderCentre + Root.Axis * Radius, Root.Axis, Root.BossRadius, Root.BossHeight - Radius);
        if (!Outer || !Shoulder || !Roll || !Boss)
            return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "plane-cylinder fillet support is degenerate");

        // Preserve the exact partial-torus identity for checking, selection, and later support correspondence.
        Roll.Payload.Classification = SurfaceClassification::Torus;
        Roll.Payload.Origin = ShoulderCentre + Root.Axis * Radius;
        Roll.Payload.Axis = Root.Axis;
        Roll.Payload.RadiusMajor = Root.BossRadius + Radius;
        Roll.Payload.RadiusMinor = Radius;
        Deliver<BrepBody> Result = BrepBody::Sew({ Outer.Payload, Shoulder.Payload, Roll.Payload, Boss.Payload });
        if (!Result || !Result.Payload.Validate().Solid())
            return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "plane-cylinder fillet could not be sewn into a valid solid");
        return Result;
    }

    struct ConeSide
    {
        Vec3 Base, Axis;
        double RadiusFoot = 0.0, RadiusTop = 0.0, Height = 0.0;
    };

    std::optional<ConeSide> NativeConeSideFace(const BrepBody& Body, int Face) noexcept
    {
        if (Face < 0 || Face >= static_cast<int>(Body.Faces.size()) ||
            Body.Faces[Face].Surface.Classification != SurfaceClassification::Cone || !Body.Validate().Solid() ||
            Body.Vertices.size() != 2 || Body.Edges.size() != 3 || Body.Coedges.size() != 6 ||
            Body.Loops.size() != 3 || Body.Faces.size() != 3) return std::nullopt;

        const NurbsSurface& Side = Body.Faces[Face].Surface;
        Vec3 Axis = Side.Axis.Normalised();
        if (Axis.Length() <= Tol || Side.RadiusMajor <= Tol || Side.RadiusMinor <= Tol) return std::nullopt;

        int Caps = 0, Rims = 0, Seams = 0;
        double Low = ScalarCriteria::Infinity, High = -ScalarCriteria::Infinity;
        for (size_t CandidateIndex = 0; CandidateIndex < Body.Faces.size(); ++CandidateIndex)
        {
            const BrepFace& Candidate = Body.Faces[CandidateIndex];
            if (Candidate.Loops.size() != 1) return std::nullopt;
            if (Candidate.Surface.Classification == SurfaceClassification::Plane)
            {
                Vec3 Normal;
                if (!PlanarNormal(Body, static_cast<int>(CandidateIndex), Normal) ||
                    std::fabs(Normal.Dot(Axis)) < 1.0 - 1e-8) return std::nullopt;
                const NurbsSurface& Plane = Candidate.Surface;
                Vec3 Point = Plane.Sample(0.5 * (Plane.DomainStartU() + Plane.DomainEndU()),
                                          0.5 * (Plane.DomainStartV() + Plane.DomainEndV()));
                double Along = (Point - Side.Origin).Dot(Axis);
                Low = std::min(Low, Along); High = std::max(High, Along); ++Caps;
            }
            else if (static_cast<int>(CandidateIndex) != Face) return std::nullopt;
        }
        for (const BrepEdge& Edge : Body.Edges)
        {
            if (Edge.Closed() && Edge.Curve.Classification == CurveClassification::Circle &&
                Edge.Curve.Degree == 2 && Edge.Curve.Rational() && Edge.Coedges.size() == 2) ++Rims;
            else if (!Edge.Closed() && Edge.Curve.Classification == CurveClassification::Line &&
                     Edge.Curve.Degree == 1 && Edge.Coedges.size() == 2) ++Seams;
            else return std::nullopt;
        }

        const double Height = High - Low;
        const double Scale = std::max({ 1.0, Side.RadiusMajor, Side.RadiusMinor, std::fabs(Low), std::fabs(High), Height });
        const double Epsilon = 1e-8 * Scale;
        if (Caps != 2 || Rims != 2 || Seams != 1 || Height <= Epsilon) return std::nullopt;

        // Verify the classified support against its actual NURBS. In particular, derive the two axial endpoints instead
        // of assuming the construction height was positive: Cone(..., -H) is a valid primitive whose first ring is the
        // geometrically upper ring. Canonicalising to low → high makes outward face motion independent of construction
        // direction while preserving the same exact support.
        const double U0 = Side.DomainStartU(), U1 = Side.DomainEndU();
        const double V0 = Side.DomainStartV(), V1 = Side.DomainEndV();
        auto Ring = [&](double V, double& Along, double& Radius) -> bool
        {
            Vec3 First = Side.Sample(U0, V);
            Along = (First - Side.Origin).Dot(Axis);
            Radius = (First - (Side.Origin + Axis * Along)).Length();
            if (Radius <= Tol) return false;
            for (int I = 1; I <= 8; ++I)
            {
                Vec3 Point = Side.Sample(U0 + (U1 - U0) * (static_cast<double>(I) / 8.0), V);
                double T = (Point - Side.Origin).Dot(Axis);
                double R = (Point - (Side.Origin + Axis * T)).Length();
                if (std::fabs(T - Along) > Epsilon || std::fabs(R - Radius) > Epsilon) return false;
            }
            return true;
        };

        double AlongStart = 0.0, AlongEnd = 0.0, RadiusStart = 0.0, RadiusEnd = 0.0;
        if (!Ring(V0, AlongStart, RadiusStart) || !Ring(V1, AlongEnd, RadiusEnd)) return std::nullopt;
        if (std::fabs(std::min(AlongStart, AlongEnd) - Low) > Epsilon ||
            std::fabs(std::max(AlongStart, AlongEnd) - High) > Epsilon ||
            std::fabs(RadiusStart - Side.RadiusMajor) > Epsilon ||
            std::fabs(RadiusEnd - Side.RadiusMinor) > Epsilon) return std::nullopt;

        for (int J = 1; J < 4; ++J)
        {
            const double Fraction = static_cast<double>(J) / 4.0;
            double Along = 0.0, Radius = 0.0;
            if (!Ring(V0 + (V1 - V0) * Fraction, Along, Radius) ||
                std::fabs(Along - ScalarCriteria::Lerp(AlongStart, AlongEnd, Fraction)) > Epsilon ||
                std::fabs(Radius - ScalarCriteria::Lerp(RadiusStart, RadiusEnd, Fraction)) > Epsilon) return std::nullopt;
        }

        bool LowRim = false, HighRim = false;
        for (const BrepEdge& Edge : Body.Edges)
        {
            if (!Edge.Closed()) continue;
            double RimAlong = 0.0, RimRadius = 0.0;
            for (int I = 0; I < 8; ++I)
            {
                Vec3 Point = Edge.Curve.Sample(Edge.Curve.DomainStart() +
                    (Edge.Curve.DomainEnd() - Edge.Curve.DomainStart()) * (static_cast<double>(I) / 8.0));
                double Along = (Point - Side.Origin).Dot(Axis);
                double Radius = (Point - (Side.Origin + Axis * Along)).Length();
                if (I == 0) { RimAlong = Along; RimRadius = Radius; }
                else if (std::fabs(Along - RimAlong) > Epsilon || std::fabs(Radius - RimRadius) > Epsilon) return std::nullopt;
            }
            if (std::fabs(RimAlong - Low) <= Epsilon)
            {
                if (LowRim || std::fabs(RimRadius - (AlongStart < AlongEnd ? RadiusStart : RadiusEnd)) > Epsilon) return std::nullopt;
                LowRim = true;
            }
            else if (std::fabs(RimAlong - High) <= Epsilon)
            {
                if (HighRim || std::fabs(RimRadius - (AlongStart > AlongEnd ? RadiusStart : RadiusEnd)) > Epsilon) return std::nullopt;
                HighRim = true;
            }
            else return std::nullopt;
        }
        if (!LowRim || !HighRim) return std::nullopt;

        const bool StartIsLow = AlongStart < AlongEnd;
        return ConeSide{ Side.Origin + Axis * Low, Axis,
                         StartIsLow ? RadiusStart : RadiusEnd,
                         StartIsLow ? RadiusEnd : RadiusStart, Height };
    }

    struct ConeCap { ConeSide Shape; bool Upper = false; };
    std::optional<ConeCap> NativeConeCapFace(const BrepBody& Body, int Face) noexcept
    {
        if (Face < 0 || Face >= static_cast<int>(Body.Faces.size()) || Body.Faces[Face].Surface.Classification != SurfaceClassification::Plane) return std::nullopt;
        for (size_t F = 0; F < Body.Faces.size(); ++F) if (Body.Faces[F].Surface.Classification == SurfaceClassification::Cone)
            if (std::optional<ConeSide> Side = NativeConeSideFace(Body, static_cast<int>(F)))
            {
                const NurbsSurface& Cap = Body.Faces[Face].Surface;
                Vec3 Point = Cap.Sample(0.5 * (Cap.DomainStartU() + Cap.DomainEndU()), 0.5 * (Cap.DomainStartV() + Cap.DomainEndV()));
                double T = (Point - Side->Base).Dot(Side->Axis), Epsilon = 1e-8 * std::max({ 1.0, Side->Height, Side->RadiusFoot, Side->RadiusTop });
                if (std::fabs(T - Side->Height) <= Epsilon) return ConeCap{ *Side, true };
                if (std::fabs(T) <= Epsilon) return ConeCap{ *Side, false };
            }
        return std::nullopt;
    }
    Deliver<BrepBody> PushConeCap(const ConeCap& Cap, double Distance) noexcept
    {
        const double Slope = (Cap.Shape.RadiusTop - Cap.Shape.RadiusFoot) / Cap.Shape.Height, Height = Cap.Shape.Height + Distance;
        if (Height <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push would consume the entire cone height");
        Vec3 Base = Cap.Shape.Base; double Foot = Cap.Shape.RadiusFoot, Top = Cap.Shape.RadiusTop;
        if (Cap.Upper) Top += Slope * Distance; else { Base = Base - Cap.Shape.Axis * Distance; Foot -= Slope * Distance; }
        if (Foot <= Tol || Top <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push would collapse a conical cap radius");
        Deliver<BrepBody> Result = BrepBody::Cone(Base, Cap.Shape.Axis, Foot, Top, Height);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "conical cap push could not be rebuilt into a valid solid");
        return Result;
    }

    Deliver<BrepBody> PushConeSide(const ConeSide& Cone, double Distance) noexcept
    {
        const double OffsetScale = std::sqrt(1.0 + std::pow((Cone.RadiusTop - Cone.RadiusFoot) / Cone.Height, 2.0));
        const double Foot = Cone.RadiusFoot + Distance * OffsetScale, Top = Cone.RadiusTop + Distance * OffsetScale;
        if (Foot <= Tol || Top <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push would collapse a conical cap radius");
        Deliver<BrepBody> Result = BrepBody::Cone(Cone.Base, Cone.Axis, Foot, Top, Cone.Height);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "conical side push could not be rebuilt into a valid solid");
        return Result;
    }

    Deliver<BrepBody> PushCylinderCap(const CylinderCap& Cap, double Distance) noexcept
    {
        const double NewHeight = Cap.Height + Distance;
        if (NewHeight <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push would consume the entire cylinder height");
        Vec3 NewBase = Cap.Upper ? Cap.Base : Cap.Base - Cap.Axis * Distance;
        Deliver<BrepBody> Result = BrepBody::Cylinder(NewBase, Cap.Axis, Cap.Radius, NewHeight);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "cylindrical cap push could not be rebuilt into a valid solid");
        return Result;
    }

    Deliver<BrepBody> PushCylinderSide(const CylinderCap& Cylinder, double Distance) noexcept
    {
        const double NewRadius = Cylinder.Radius + Distance;
        if (NewRadius <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push would collapse the cylinder radius");
        Deliver<BrepBody> Result = BrepBody::Cylinder(Cylinder.Base, Cylinder.Axis, NewRadius, Cylinder.Height);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "cylindrical side push could not be rebuilt into a valid solid");
        return Result;
    }

    Deliver<BrepBody> FilletCylinderCap(const CylinderCap& Cap, double Radius) noexcept
    {
        if (Radius <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "radius is zero or negative");
        if (Radius >= Cap.Radius - Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet radius reaches the cylinder axis");
        if (Radius >= Cap.Height - Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet radius consumes the entire cylinder height");

        // The meridian is an exact rational quarter arc. Revolving it forms the constant-radius rolling-ball surface;
        // the remaining cylinder touches its outer endpoint and the automatically capped plane touches its inner one.
        Workplane Frame = Workplane::FromNormal(Cap.Base, Cap.Axis);
        Vec3 Centre = Cap.Upper
            ? Cap.Base + Cap.Axis * (Cap.Height - Radius) + Frame.AxisX * (Cap.Radius - Radius)
            : Cap.Base + Cap.Axis * Radius + Frame.AxisX * (Cap.Radius - Radius);
        Vec3 Outer = Centre + Frame.AxisX * Radius;
        Vec3 Mid = Cap.Upper
            ? Centre + (Frame.AxisX + Cap.Axis) * (Radius / std::sqrt(2.0))
            : Centre + (Frame.AxisX - Cap.Axis) * (Radius / std::sqrt(2.0));
        Vec3 Inner = Cap.Upper ? Centre + Cap.Axis * Radius : Centre - Cap.Axis * Radius;
        Deliver<NurbsCurve> Meridian = NurbsCurve::ArcThreePoints(Outer, Mid, Inner);
        if (!Meridian) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "circular-cap fillet meridian is degenerate");
        Deliver<NurbsSurface> Roll = NurbsSurface::Revolution(Meridian.Payload, Cap.Base, Cap.Axis, ScalarCriteria::TwoPi);
        Deliver<NurbsSurface> Cylinder = Cap.Upper
            ? NurbsSurface::Cylinder(Cap.Base, Cap.Axis, Cap.Radius, Cap.Height - Radius)
            : NurbsSurface::Cylinder(Cap.Base + Cap.Axis * Radius, Cap.Axis, Cap.Radius, Cap.Height - Radius);
        if (!Roll || !Cylinder) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "circular-cap fillet support is degenerate");
        // It is a partial torus, not a generic revolution: preserve exact analytic identity for downstream selection,
        // checking and future blend correspondence while retaining its quarter-domain NURBS control net.
        Roll.Payload.Classification = SurfaceClassification::Torus;
        Roll.Payload.Origin = Centre - Frame.AxisX * (Cap.Radius - Radius);
        Roll.Payload.Axis = Cap.Axis; Roll.Payload.RadiusMajor = Cap.Radius - Radius; Roll.Payload.RadiusMinor = Radius;
        std::vector<NurbsSurface> Faces;
        Faces.push_back(std::move(Cylinder.Payload)); Faces.push_back(std::move(Roll.Payload));
        Deliver<BrepBody> Result = BrepBody::Sew(Faces);
        if (!Result || !Result.Payload.Validate().Solid()) return Deliver<BrepBody>::Reject(RefusalReason::NonManifold, "circular-cap fillet could not be sewn into a valid solid");
        return Result;
    }

    // Move a face by rebuilding its boundary as a ring of ruled faces instead of unioning a nearly coincident
    // extrusion.  A Boolean needs the footprint pulled in by a small epsilon to avoid coincident side faces; that
    // epsilon leaves a very thin, but real, rim around the old face.  On a full-face push the rim is not design
    // geometry: its four inner edges are only a few microns long across, yet they were presented as blend targets.
    //
    // Replacing the face directly has the exact intended topology.  Existing boundary edges remain at the root and
    // become shared by their old neighbour and one new ruled wall; translated copies become the moved cap's edges.
    // It also means a subsequent blend sees the actual arm perimeter, rather than an epsilon-wide Boolean artefact.
    Deliver<BrepBody> DirectPlanarPush(const BrepBody& Body, int Face, Vec3 Normal, double Distance) noexcept
    {
        if (Body.Faces[Face].Loops.empty())
            return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "face has no boundary loops to push");

        struct Boundary
        {
            int        Coedge = -1;
            int        RootEdge = -1;
            int        CapEdge = -1;
            NurbsCurve Root;
            NurbsCurve Cap;
        };

        BrepBody Result = Body;
        const Mat4 Move = Mat4::Translation(Normal * Distance);
        std::vector<Boundary> BoundaryEdges;
        for (int Loop : Result.Faces[Face].Loops)
            for (int Coedge : Result.Loops[Loop].Coedges)
            {
                int RootEdge = Result.Coedges[Coedge].Edge;
                if (RootEdge < 0 || RootEdge >= (int)Result.Edges.size())
                    return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "face has an invalid boundary edge");
                NurbsCurve Root = Result.Edges[RootEdge].Curve;
                NurbsCurve Cap = Root.Transformed(Move);
                int CapEdge = Result.AddEdge(Cap, Tol);
                BoundaryEdges.push_back({ Coedge, RootEdge, CapEdge, std::move(Root), std::move(Cap) });
            }
        if (BoundaryEdges.size() < 3)
            return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "face boundary has fewer than three edges");

        // Lift the selected face and rewire its existing coedges to the translated rim.  The same coedge/loop order
        // is retained, so holes move with the cap as expected.
        Result.Faces[Face].Surface = Result.Faces[Face].Surface.Transformed(Move);
        for (const Boundary& B : BoundaryEdges)
        {
            std::vector<int>& Users = Result.Edges[B.RootEdge].Coedges;
            Users.erase(std::remove(Users.begin(), Users.end(), B.Coedge), Users.end());
            Result.Edges[B.CapEdge].Coedges.push_back(B.Coedge);
            Result.Coedges[B.Coedge].Edge = B.CapEdge;
            Result.Coedges[B.Coedge].Trace.clear();
        }

        // Every ruled wall naturally reuses its root and cap edge, and automatically shares the vertical joins with
        // the adjacent ruled walls.  There is no coincident-face Boolean seam to leave behind.
        for (const Boundary& B : BoundaryEdges)
        {
            Deliver<NurbsSurface> Wall = NurbsSurface::Ruled(B.Root, B.Cap);
            if (!Wall) return Deliver<BrepBody>::Reject(Wall.Denial.Reason, Wall.Denial.Detail);
            int WallFace = Result.AddFace(std::move(Wall.Payload));
            Result.AddNaturalBoundary(WallFace, Tol);
        }
        Result.Orient();
        BodyReport Report = Result.Validate();
        if (!Report.Solid())
            return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "direct face push did not close into a manifold solid");
        return Deliver<BrepBody>::Accept(std::move(Result));
    }

    // A root edge of a prismatic handle can be reflex: its material angle is greater than π even though the two
    // adjacent face normals have the smaller supplementary angle.  Treating it as a convex corner and subtracting a
    // box cutter makes the cutter re-enter the head (the broken, pinched pictures this case originally produced).
    //
    // For the regular and very common prismatic case, edit the cross-section itself instead.  The complete outline is
    // rebuilt once, then extruded through the selected edge.  This leaves one clean bevel face, or a consistently
    // sampled concave round, rather than a Boolean-generated hole and four accidental end faces.
    std::optional<BrepBody> PrismaticReflexBlend(const BrepBody& Body, const EdgeCornerFrame& F, double Amount, bool Round) noexcept
    {
        // A Boolean/PullFace result can partition an otherwise planar cap into several coplanar faces.  Do not pick
        // one face loop: that was the subtle source of the old broken root.  Instead trace the boundary of the whole
        // cross-section.  A perimeter edge has one cap-face user and one non-cap user; seams between cap patches have
        // two cap users and are deliberately ignored.
        const double CapLevel = F.Start.Dot(F.Tangent);
        std::vector<std::vector<std::pair<int, int>>> Neighbours(Body.Vertices.size());
        for (size_t E = 0; E < Body.Edges.size(); ++E)
        {
            const BrepEdge& Edge = Body.Edges[E];
            if (Edge.VertexStart < 0 || Edge.VertexEnd < 0) return std::nullopt;
            if (std::fabs(Body.Vertices[Edge.VertexStart].Point.Dot(F.Tangent) - CapLevel) > Tol ||
                std::fabs(Body.Vertices[Edge.VertexEnd].Point.Dot(F.Tangent) - CapLevel) > Tol) continue;
            int CapUsers = 0;
            for (int C : Edge.Coedges)
            {
                Vec3 N;
                if (PlanarNormal(Body, Body.Coedges[C].Face, N) && std::fabs(N.Dot(F.Tangent)) > 0.999999) ++CapUsers;
            }
            if (CapUsers != 1) continue;
            if (Edge.Curve.Degree > 1) return std::nullopt;                            // the rebuilt cap contour must stay linear except for our roll
            Neighbours[Edge.VertexStart].push_back({ (int)E, Edge.VertexEnd });
            Neighbours[Edge.VertexEnd].push_back({ (int)E, Edge.VertexStart });
        }

        int Start = -1;
        for (size_t V = 0; V < Body.Vertices.size(); ++V)
            if (Body.Vertices[V].Point.Coincident(F.Start, Tol)) { Start = (int)V; break; }
        if (Start < 0 || Neighbours[Start].size() != 2) return std::nullopt;             // not a simple, capped prism

        // Begin at the selected root.  The trace has no duplicate endpoint; it is P, next, ..., previous.
        std::vector<Vec3> Points;
        int Current = Start, PreviousEdge = -1;
        for (size_t Guard = 0; Guard <= Body.Vertices.size(); ++Guard)
        {
            Points.push_back(Body.Vertices[Current].Point);
            const std::vector<std::pair<int, int>>& Options = Neighbours[Current];
            if (Options.size() != 2) return std::nullopt;
            const std::pair<int, int>& Step = Options[Options[0].first == PreviousEdge ? 1 : 0];
            PreviousEdge = Step.first; Current = Step.second;
            if (Current == Start) break;
            if (Guard == Body.Vertices.size()) return std::nullopt;
        }
        const size_t Count = Points.size();
        if (Count < 3 || Current != Start) return std::nullopt;
        Vec3 P = Points[0], Previous = Points.back(), Next = Points[1];
        Vec3 ToPrevious = Previous - P, ToNext = Next - P;
        double PreviousLength = ToPrevious.Length(), NextLength = ToNext.Length();
        if (PreviousLength <= Tol || NextLength <= Tol) return std::nullopt;
        ToPrevious = ToPrevious * (1.0 / PreviousLength);
        ToNext = ToNext * (1.0 / NextLength);

        // The sign of a local turn relative to the loop's area normal identifies a reflex vertex independent of
        // whether we started from the upper or lower cap (and hence independent of loop orientation).
        Vec3 AreaNormal;
        for (size_t I = 0; I < Count; ++I) AreaNormal = AreaNormal + Points[I].Cross(Points[(I + 1) % Count]);
        if (AreaNormal.Length() <= Tol || (P - Previous).Cross(Next - P).Dot(AreaNormal) >= -Tol) return std::nullopt;

        double SetBack = Amount;
        Vec3 Centre, Mid;
        Deliver<NurbsCurve> Arc;
        if (Round)
        {
            // The angle between the two rays is the small *void* angle at a reflex root.  Its exact tangent distance
            // is R/tan(void/2), and the circle centre sits on its bisector.  This is not the convex formula used by
            // the Boolean fallback's `F.Bisector`.
            double VoidAngle = std::acos(ScalarCriteria::Clamp(ToPrevious.Dot(ToNext), -1.0, 1.0));
            if (VoidAngle <= Tol || VoidAngle >= ScalarCriteria::Pi - Tol) return std::nullopt;
            SetBack = Amount / std::tan(VoidAngle * 0.5);
            Vec3 VoidBisector = (ToPrevious + ToNext).Normalised();
            Centre = P + VoidBisector * (Amount / std::sin(VoidAngle * 0.5));
            Mid = Centre - VoidBisector * Amount;
        }
        if (SetBack <= Tol || SetBack >= PreviousLength - Tol || SetBack >= NextLength - Tol) return std::nullopt;

        Vec3 A = P + ToPrevious * SetBack, B = P + ToNext * SetBack;
        if (!Round)
        {
            // P is replaced by a single, planar bevel edge.  This adds the proper triangular wedge to a re-entrant
            // corner rather than subtracting a convex cutter from it.
            std::vector<Vec3> Outline;
            Outline.reserve(Count + 1);
            Outline.push_back(B);
            Outline.insert(Outline.end(), Points.begin() + 1, Points.end());
            Outline.push_back(A);
            Deliver<NurbsCurve> Profile = NurbsCurve::Polyline(Outline, true);
            if (!Profile) return std::nullopt;
            Deliver<BrepBody> Rebuilt = BrepBody::Extrude(Profile.Payload, F.Tangent, F.Length);
            if (!Rebuilt || !Rebuilt.Payload.Validate().Solid()) return std::nullopt;
            return std::move(Rebuilt.Payload);
        }

        // Keep the circular piece separate from the tangent straight walls.  A NURBS Join is geometrically valid,
        // but it intentionally hides a G1 seam from SplitAtKinks; sewing these sheets explicitly records the
        // cylindrical fillet as its own face while retaining exact (rational) circle geometry.
        Arc = NurbsCurve::ArcThreePoints(A, Mid, B);
        if (!Arc) return std::nullopt;
        std::vector<NurbsCurve> Pieces;
        Pieces.reserve(Count + 1);
        auto AppendLine = [&](Vec3 From, Vec3 To) -> bool
        {
            Deliver<NurbsCurve> Line = NurbsCurve::Line(From, To);
            if (!Line) return false;
            Pieces.push_back(std::move(Line.Payload));
            return true;
        };
        if (!AppendLine(B, Points[1])) return std::nullopt;
        for (size_t I = 1; I + 1 < Count; ++I)
            if (!AppendLine(Points[I], Points[I + 1])) return std::nullopt;
        if (!AppendLine(Points.back(), A)) return std::nullopt;
        Pieces.push_back(std::move(Arc.Payload));                                      // A → B closes the profile

        std::vector<NurbsSurface> Sides;
        Sides.reserve(Pieces.size());
        for (const NurbsCurve& Piece : Pieces)
        {
            Deliver<NurbsSurface> Side = NurbsSurface::Extrusion(Piece, F.Tangent, F.Length);
            if (!Side) return std::nullopt;
            Sides.push_back(std::move(Side.Payload));
        }
        Deliver<BrepBody> Rebuilt = BrepBody::Sew(Sides);
        if (!Rebuilt || !Rebuilt.Payload.Validate().Solid()) return std::nullopt;
        return std::move(Rebuilt.Payload);
    }
}

Deliver<std::vector<int>> BlendSolver::TangentChain(const BrepBody& Body, int SeedEdge) noexcept
{
    if (SeedEdge < 0 || SeedEdge >= static_cast<int>(Body.Edges.size()))
        return Deliver<std::vector<int>>::Reject(RefusalReason::DegenerateInput, "seed edge index is out of range");
    if (Body.Edges[SeedEdge].Coedges.size() != 2)
        return Deliver<std::vector<int>>::Reject(RefusalReason::Unsupported, "seed edge is not a manifold body edge");

    std::vector<int> Chain{ SeedEdge };
    for (size_t Cursor = 0; Cursor < Chain.size(); ++Cursor)
    {
        int CurrentIndex = Chain[Cursor];
        const BrepEdge& Current = Body.Edges[CurrentIndex];
        if (Current.Closed()) continue;
        for (int Vertex : { Current.VertexStart, Current.VertexEnd })
        {
            if (Vertex < 0 || Vertex >= static_cast<int>(Body.Vertices.size()))
                return Deliver<std::vector<int>>::Reject(RefusalReason::Unsupported, "chain edge has no valid endpoint vertex");
            const double CurrentParameter = Vertex == Current.VertexStart
                ? Current.Curve.DomainStart() : Current.Curve.DomainEnd();
            Vec3 CurrentTangent = Current.Curve.Tangent(CurrentParameter).Normalised();
            if (CurrentTangent.Length() <= Tol)
                return Deliver<std::vector<int>>::Reject(RefusalReason::DegenerateInput, "chain edge has a zero endpoint tangent");

            int Continuation = -1;
            for (size_t CandidateIndex = 0; CandidateIndex < Body.Edges.size(); ++CandidateIndex)
            {
                if (static_cast<int>(CandidateIndex) == CurrentIndex) continue;
                const BrepEdge& Candidate = Body.Edges[CandidateIndex];
                if (Candidate.Coedges.size() != 2 || Candidate.Closed() ||
                    (Candidate.VertexStart != Vertex && Candidate.VertexEnd != Vertex)) continue;
                const double CandidateParameter = Vertex == Candidate.VertexStart
                    ? Candidate.Curve.DomainStart() : Candidate.Curve.DomainEnd();
                Vec3 CandidateTangent = Candidate.Curve.Tangent(CandidateParameter).Normalised();
                if (CandidateTangent.Length() <= Tol ||
                    std::fabs(CurrentTangent.Dot(CandidateTangent)) < 1.0 - 1e-8) continue;
                if (Continuation >= 0 && Continuation != static_cast<int>(CandidateIndex))
                    return Deliver<std::vector<int>>::Reject(RefusalReason::Unsupported, "tangent chain branches ambiguously at a vertex");
                Continuation = static_cast<int>(CandidateIndex);
            }
            if (Continuation >= 0 && std::find(Chain.begin(), Chain.end(), Continuation) == Chain.end())
                Chain.push_back(Continuation);
        }
    }
    return Deliver<std::vector<int>>::Accept(std::move(Chain));
}

bool BlendSolver::Frame(const BrepBody& Body, int Edge, EdgeCornerFrame& Out, std::string& Refusal) noexcept
{
    if (Edge < 0 || Edge >= (int)Body.Edges.size()) { Refusal = "edge index out of range"; return false; }
    const BrepEdge& E = Body.Edges[Edge];
    if (E.Coedges.size() != 2) { Refusal = "edge is not a manifold interior edge (a blend needs exactly two adjacent faces)"; return false; }
    if (E.VertexStart < 0 || E.VertexEnd < 0) { Refusal = "edge has no stored vertices"; return false; }

    Vec3 P0 = Body.Vertices[E.VertexStart].Point, P1 = Body.Vertices[E.VertexEnd].Point;
    Vec3 Along = P1 - P0;
    double Length = Along.Length();
    if (Length <= Tol) { Refusal = "edge is degenerate (zero length)"; return false; }
    Vec3 Tangent = Along * (1.0 / Length);

    // The edge must be straight: the tool solids are prisms, so a curved edge would not be cut exactly.
    {
        std::vector<Vec3> Samples = Body.EdgePolyline(Edge, 1e-4);
        for (const Vec3& S : Samples)
        {
            Vec3 D = S - P0;
            double Deviation = (D - Tangent * D.Dot(Tangent)).Length();
            if (Deviation > 1e-6 * std::max(1.0, Length)) { Refusal = "edge is not straight (blend of a curved edge is not supported)"; return false; }
        }
    }

    int FaceA = Body.Coedges[E.Coedges[0]].Face, FaceB = Body.Coedges[E.Coedges[1]].Face;
    if (FaceA < 0 || FaceB < 0 || FaceA == FaceB) { Refusal = "edge has invalid adjacent faces"; return false; }

    Vec3 NA, NB;
    if (!PlanarNormal(Body, FaceA, NA) || !PlanarNormal(Body, FaceB, NB)) { Refusal = "blend requires both adjacent faces to be planar (curvature detected)"; return false; }
    if (std::fabs(Tangent.Dot(NA)) > 1e-6 || std::fabs(Tangent.Dot(NB)) > 1e-6) { Refusal = "edge does not lie in both face planes"; return false; }

    Vec3 Bisector = NA + NB;
    if (Bisector.Length() <= Tol) { Refusal = "adjacent faces are opposite (degenerate corner)"; return false; }
    Bisector = Bisector.Normalised();

    // In-face directions: perpendicular to the edge, lying in each face, pointing away from the edge across the face.
    //    Taking them as ±(Tangent × N) and choosing the sign that leads to the face's interior keeps this correct for
    //    both convex and concave edges.
    auto InFace = [&](int Face, Vec3 N) -> Vec3
    {
        Vec3 Direction = Tangent.Cross(N);
        if (Direction.Length() <= Tol) return Vec3{};
        Direction = Direction.Normalised();
        BrepBody::FaceTriangles Triangles = Body.TessellateFace(Face);
        Vec3 Centroid{}; double Weight = 0.0;
        for (size_t I = 0; I + 2 < Triangles.Triangles.size(); I += 3)
        {
            Vec3 A = Triangles.Positions[Triangles.Triangles[I]], B = Triangles.Positions[Triangles.Triangles[I + 1]], C = Triangles.Positions[Triangles.Triangles[I + 2]];
            double Area = (B - A).Cross(C - A).Length() * 0.5;
            Centroid = Centroid + (A + B + C) * (Area / 3.0);
            Weight += Area;
        }
        if (Weight <= Tol) return Vec3{};
        Centroid = Centroid * (1.0 / Weight);
        double Side = (Centroid - P0).Dot(Direction);
        return Side >= 0.0 ? Direction : Direction * -1.0;
    };
    Vec3 InA = InFace(FaceA, NA), InB = InFace(FaceB, NB);
    if (InA.Length() <= Tol || InB.Length() <= Tol) { Refusal = "cannot resolve the in-face direction of the edge"; return false; }

    // Interior dihedral: the angle the material subtends at the edge, measured between the two in-face directions.
    double Dihedral = std::acos(ScalarCriteria::Clamp(InA.Dot(InB), -1.0, 1.0));
    if (Dihedral <= 1e-6 || Dihedral >= ScalarCriteria::Pi - 1e-6) { Refusal = "faces are tangent or folded at this edge (no corner to blend)"; return false; }

    Out.Start = P0; Out.End = P1; Out.Tangent = Tangent;
    Out.NormalA = NA; Out.NormalB = NB; Out.InA = InA; Out.InB = InB;
    Out.Bisector = Bisector; Out.Length = Length; Out.Dihedral = Dihedral;
    Out.FaceA = FaceA; Out.FaceB = FaceB;
    return true;
}

double BlendSolver::TangentSetBack(const EdgeCornerFrame& F, double Radius) noexcept
{
    return Radius / std::tan(F.Dihedral * 0.5);
}

double BlendSolver::ChamferRemoval(const EdgeCornerFrame& F, double SetBack) noexcept
{
    // Triangle of sides SetBack, SetBack with the included interior angle, swept along the edge.
    return F.Length * 0.5 * SetBack * SetBack * std::sin(F.Dihedral);
}

double BlendSolver::FilletRemoval(const EdgeCornerFrame& F, double Radius) noexcept
{
    // Corner kite (two tangent lengths) minus the circular sector the roll leaves behind, swept along the edge.
    double T = TangentSetBack(F, Radius);
    return F.Length * (Radius * T - Radius * Radius * (ScalarCriteria::Pi - F.Dihedral) * 0.5);
}

Deliver<BrepBody> BlendSolver::ChamferEdge(const BrepBody& Body, int Edge, double SetBack) noexcept
{
    if (std::optional<CylinderCap> Cap = NativeCylinderCap(Body, Edge)) return ChamferCylinderCap(*Cap, SetBack);
    EdgeCornerFrame F; std::string Why;
    if (!Frame(Body, Edge, F, Why)) return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, Why.c_str());
    if (SetBack <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "set-back is zero or negative");

    // A re-entrant edge of a capped prism is a profile operation, not the exterior wedge removal below.
    if (std::optional<BrepBody> Reflex = PrismaticReflexBlend(Body, F, SetBack, false))
        return Deliver<BrepBody>::Accept(std::move(*Reflex));

    // The cut plane passes through the two set-back points, square to the outward bisector.
    Vec3 A = F.Start + F.InA * SetBack, B = F.Start + F.InB * SetBack;
    double Offset = ((A + B) * 0.5 - F.Start).Dot(F.Bisector);
    const double Target = Body.Validate().Volume - ChamferRemoval(F, SetBack);
    // A plane chamfer is exact geometry. The B-rep volume reporter itself is tessellated, so three cubic microns is
    // its observed integration floor on this model — it is 2e-10 of the part, not an approximation allowance. An
    // appreciably different result is refused rather than silently shipping a mis-cut part.
    constexpr double Accept = 3e-6;

    // Ladder of cutter shapes, coarsest-fitting first. Negative margins stop the cutter just short of the edge's
    // endpoints (relative to the edge length); positive ones run it past (relative to the set-back). Each candidate
    // must be both closed and within the numerical-integration floor of the exact local wedge.
    static const double Margins[] = { -1e-8, -1e-7, -1e-6, -1e-5, -1e-4, -1e-3,
                                           1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3,
                                           0.01, 0.05, 0.13, 0.29, 0.53, 1.0, 2.0, 3.0 };
    static const double HalfWidths[] = { 0.55, 0.8, 1.2, 2.0, 3.0 };

    Deliver<BrepBody> Best = Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "no cutter placement produced a valid solid");
    double BestError = ScalarCriteria::Infinity;
    for (double Width : HalfWidths)
        for (double Margin : Margins)
        {
            double Along = Margin < 0.0 ? F.Length * Margin : SetBack * Margin;
            Deliver<BrepBody> Cutter = CornerCutter(F, Offset, SetBack * Width, Along, SetBack * 3.0);
            if (!Cutter) continue;
            Deliver<BrepBody> Cut = IntersectionSolver::Combine(Body, Cutter.Payload, BodyOperation::Subtract);
            if (!Cut) continue;
            BodyReport Report = Cut.Payload.Validate();
            if (!Report.Solid()) continue;
            double Error = std::fabs(Report.Volume - Target);
            if (Error < BestError) { BestError = Error; Best = std::move(Cut); }
        }
    if (Best && BestError <= Accept) return Best;
    return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "no cutter placement reached the exact chamfer tolerance");
}

Deliver<BrepBody> BlendSolver::FilletEdge(const BrepBody& Body, int Edge, double Radius) noexcept
{
    if (std::optional<CylinderCap> Cap = NativeCylinderCap(Body, Edge)) return FilletCylinderCap(*Cap, Radius);
    if (std::optional<PlaneCylinderRoot> Root = PlaneCylinderBossRoot(Body, Edge))
        return FilletPlaneCylinderBossRoot(*Root, Radius);
    EdgeCornerFrame F; std::string Why;
    if (!Frame(Body, Edge, F, Why)) return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, Why.c_str());
    if (Radius <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "radius is zero or negative");

    // A prismatic reflex root is rebuilt from its 2D profile so the roll stays on the material side of the corner.
    if (std::optional<BrepBody> Reflex = PrismaticReflexBlend(Body, F, Radius, true))
        return Deliver<BrepBody>::Accept(std::move(*Reflex));

    // 1. Cut the corner back to where the rolling ball touches each face.
    double T = TangentSetBack(F, Radius);
    Vec3 TangentA = F.Start + F.InA * T, TangentB = F.Start + F.InB * T;
    Deliver<BrepBody> Wedged = ChamferEdge(Body, Edge, T);
    if (!Wedged) return Deliver<BrepBody>::Reject(Wedged.Denial.Reason, Wedged.Denial.Detail);

    Vec3 Centre = F.Start - F.Bisector * (Radius / std::sin(F.Dihedral * 0.5));
    Vec3 AxisU = F.Bisector, AxisV = F.Tangent.Cross(F.Bisector).Normalised();
    const double Target = Body.Validate().Volume - FilletRemoval(F, Radius);

    // 2. Re-seat the flat the cut left onto the tangent cylinder. The two cap edges of that flat are still straight
    //    chords; on a simple corner rebuilding them as arcs on the same cylinder is what makes the volume exact, but
    //    where the surrounding topology is more involved the rebuild can over-correct. Rather than guess, build the
    //    body both ways and keep whichever lands closer to the closed-form volume — the operation checks its own work.
    auto Build = [&](bool RebuildCaps) -> Deliver<BrepBody>
    {
        BrepBody Result = Wedged.Payload;
        int Flat = -1; double Closest = 0.999;
        for (size_t Face = 0; Face < Result.Faces.size(); ++Face)
        {
            Vec3 N = Result.FaceNormal((int)Face, 0.5, 0.5);
            if (N.Length() <= Tol) continue;
            double Alignment = N.Normalised().Dot(F.Bisector);
            if (Alignment > Closest) { Closest = Alignment; Flat = (int)Face; }
        }
        if (Flat < 0) return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "the set-back cut did not produce a chamfer face to roll");

        Deliver<NurbsCurve> Profile = NurbsCurve::ArcThreePoints(TangentA, Centre + F.Bisector * Radius, TangentB);
        if (!Profile) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet arc section is degenerate");
        Deliver<NurbsSurface> Roll = NurbsSurface::Extrusion(Profile.Payload, F.Tangent, F.Length);
        if (!Roll) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "fillet surface is degenerate");
        Result.Faces[Flat].Surface = std::move(Roll.Payload);

        // The swept arc's natural normal may agree or disagree with the flat it replaces; decide from the geometry.
        Vec3 Facing = Result.FaceNormal(Flat, 0.5, 0.5);
        if (Facing.Length() > Tol && Facing.Normalised().Dot(F.Bisector) < 0.0) Result.Faces[Flat].Reversed = !Result.Faces[Flat].Reversed;

        if (RebuildCaps)
            for (int Loop : Result.Faces[Flat].Loops)
                for (int Coedge : Result.Loops[Loop].Coedges)
                {
                    int EdgeIndex = Result.Coedges[Coedge].Edge;
                    Vec3 S = Result.CoedgeStart(Coedge), E = Result.CoedgeEnd(Coedge);
                    if ((E - S).Length() <= Tol) continue;
                    int Other = -1;
                    for (int Ce : Result.Edges[EdgeIndex].Coedges) if (Result.Coedges[Ce].Face != Flat) { Other = Result.Coedges[Ce].Face; break; }
                    if (Other < 0) continue;
                    Vec3 PlaneNormal;
                    if (!PlanarNormal(Result, Other, PlaneNormal)) continue;
                    double Facing2 = PlaneNormal.Dot(F.Tangent);
                    if (std::fabs(Facing2) <= 1e-9) continue;                              // a rail of the roll: already exact
                    if (std::fabs(std::fabs(Facing2) - 1.0) > 1e-6) continue;              // a mitred end sections in an ellipse, not an arc

                    auto AngleOf = [&](Vec3 P)
                    {
                        Vec3 Radial = P - (Centre + F.Tangent * (P - Centre).Dot(F.Tangent));
                        return std::atan2(Radial.Dot(AxisV), Radial.Dot(AxisU));
                    };
                    double Sweep = AngleOf(E) - AngleOf(S);
                    while (Sweep >  ScalarCriteria::Pi) Sweep -= 2.0 * ScalarCriteria::Pi;
                    while (Sweep < -ScalarCriteria::Pi) Sweep += 2.0 * ScalarCriteria::Pi;
                    double Middle = AngleOf(S) + Sweep * 0.5;
                    Vec3 Radial = AxisU * std::cos(Middle) + AxisV * std::sin(Middle);
                    double Slide = (PlaneNormal.Dot(S - Centre) - Radius * PlaneNormal.Dot(Radial)) / Facing2;
                    Deliver<NurbsCurve> Section = NurbsCurve::ArcThreePoints(S, Centre + F.Tangent * Slide + Radial * Radius, E);
                    if (Section) Result.Edges[EdgeIndex].Curve = std::move(Section.Payload);
                }

        for (BrepCoedge& C : Result.Coedges) C.Trace.clear();
        Result.Orient();
        return Deliver<BrepBody>::Accept(std::move(Result));
    };

    // Score both cap treatments against the closed form. A fillet must also leave MORE material than the flat cut it
    //    replaces — the roll is added back into the corner — so a candidate that comes out below the wedge volume is
    //    geometrically wrong however close its number looks, and is rejected outright.
    const double WedgeVolume = Wedged.Payload.Validate().Volume;
    Deliver<BrepBody> Plain = Build(false), Arced = Build(true);
    auto Score = [&](const Deliver<BrepBody>& D) -> double
    {
        if (!D) return ScalarCriteria::Infinity;
        BodyReport R = D.Payload.Validate();
        if (!R.Solid()) return ScalarCriteria::Infinity;
        if (R.Volume < WedgeVolume - std::max(std::fabs(WedgeVolume), 1.0) * 1e-9) return ScalarCriteria::Infinity;
        return std::fabs(R.Volume - Target);
    };
    double ScorePlain = Score(Plain), ScoreArced = Score(Arced);
    if (std::isfinite(ScoreArced) || std::isfinite(ScorePlain))
        return ScoreArced <= ScorePlain ? std::move(Arced) : std::move(Plain);
    // Neither candidate is admissible: fall back to the tangent-set-back flat, which is a valid solid and is what a
    //    chamfer at the fillet's own set-back would have produced.
    return Wedged;
}

Deliver<BrepBody> BlendSolver::PushFace(const BrepBody& Body, int Face, double Distance) noexcept
{
    if (Face < 0 || Face >= (int)Body.Faces.size()) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "face index out of range");
    if (std::fabs(Distance) <= Tol) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "push distance is zero");
    if (std::optional<ConeSide> Cone = NativeConeSideFace(Body, Face)) return PushConeSide(*Cone, Distance);
    if (std::optional<ConeCap> Cap = NativeConeCapFace(Body, Face)) return PushConeCap(*Cap, Distance);
    if (std::optional<CylinderCap> Cylinder = NativeCylinderSideFace(Body, Face)) return PushCylinderSide(*Cylinder, Distance);
    if (std::optional<CylinderCap> Cap = NativeCylinderCapFace(Body, Face)) return PushCylinderCap(*Cap, Distance);
    Vec3 Normal;
    if (!PlanarNormal(Body, Face, Normal)) return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "push requires a planar face");

    // Prefer the exact topological construction.  Keep the Boolean path below as a conservative fallback for any
    // future face type that the direct construction cannot sew into a closed manifold body.
    Deliver<BrepBody> Direct = DirectPlanarPush(Body, Face, Normal, Distance);
    if (Direct) return Direct;

    // The tool is the face's own outline swept along the normal. It is started *behind* the face, inside the material,
    //    so the tool's side walls are never coincident with the body's — the boolean refuses tangent contact, and a
    //    tool that merely touches the face would be exactly that case.
    BrepBody::FaceTriangles Triangles = Body.TessellateFace(Face);
    if (Triangles.Triangles.empty()) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "face has no area to push");

    // How far behind the face the tool starts. It only has to clear the face plane so the two solids overlap rather
    //    than merely touch (a touching tool is the coincident-face case the boolean refuses); it must NOT reach the
    //    far side of the body, or the sweep punches out through the opposite wall and the "push" becomes a slot. A
    //    small fraction of the body is both, and the seat cancels exactly in the union.
    Box3 Bounds = Body.Bounds();
    Vec3 Span = Bounds.Extent();
    double Reach = std::max({ Span.X, Span.Y, Span.Z, 1.0 });
    double Thickness = ScalarCriteria::Infinity;
    for (size_t Other = 0; Other < Body.Faces.size(); ++Other)
    {
        if ((int)Other == Face) continue;
        Vec3 OtherNormal;
        if (!PlanarNormal(Body, (int)Other, OtherNormal)) continue;
        if (OtherNormal.Dot(Normal) > -0.5) continue;                                    // only walls facing back at us
        BrepBody::FaceTriangles Far = Body.TessellateFace((int)Other);
        for (const Vec3& P : Far.Positions)
        {
            double Behind = (Triangles.Positions.empty() ? 0.0 : (Triangles.Positions.front() - P).Dot(Normal));
            if (Behind > Tol) Thickness = std::min(Thickness, Behind);
        }
    }
    double Depth = std::isfinite(Thickness) ? std::min(Reach, Thickness * 0.5) : Reach * 0.25;
    Depth = std::max(Depth, Reach * 1e-3);                                               // still a real overlap

    // Outline of the face: its outer loop, sampled in order.
    if (Body.Faces[Face].Loops.empty()) return Deliver<BrepBody>::Reject(RefusalReason::Unsupported, "face has no outer loop");
    int Outer = Body.Faces[Face].Loops.front();
    std::vector<Vec3> Outline;
    for (int Coedge : Body.Loops[Outer].Coedges)
    {
        NurbsCurve C = Body.CoedgeCurve(Coedge);
        std::vector<Vec3> Points; C.Tessellate(Points, nullptr, 1e-4);
        for (size_t I = 0; I + 1 < Points.size(); ++I)
            if (Outline.empty() || !Outline.back().Coincident(Points[I], Tol)) Outline.push_back(Points[I]);
    }
    if (Outline.size() < 3) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "face outline is degenerate");
    if (Outline.front().Coincident(Outline.back(), Tol)) Outline.pop_back();

    // Slide the outline back inside the body, then sweep it past the target depth.
    //    The outline is also pulled in by a hair: a tool whose walls lie exactly on the body's walls is the coincident-
    //    face case the boolean refuses outright ("surface singularity or seam corner"), because the two boundaries meet
    //    along a whole face rather than crossing. The inset is a few parts per million of the body, far below the
    //    tessellation tolerance the volumes are checked at, and it makes every contact transversal.
    Vec3 Centroid{};
    for (const Vec3& P : Outline) Centroid = Centroid + P;
    Centroid = Centroid * (1.0 / double(Outline.size()));
    const double Inset = std::max(Span.Length(), 1.0) * 1e-6;

    Vec3 Base = Normal * -Depth;
    std::vector<Vec3> Shifted;
    Shifted.reserve(Outline.size() + 1);
    for (const Vec3& P : Outline)
    {
        Vec3 Radial = P - Centroid;
        Radial = Radial - Normal * Radial.Dot(Normal);                                   // stay in the face's plane
        double Reach = Radial.Length();
        Vec3 Pulled = Reach > Inset ? P - Radial * (Inset / Reach) : P;
        Shifted.push_back(Pulled + Base);
    }
    Shifted.push_back(Shifted.front());

    Deliver<NurbsCurve> Loop = NurbsCurve::Polyline(Shifted, true);
    if (!Loop) return Deliver<BrepBody>::Reject(RefusalReason::DegenerateInput, "face outline does not close");
    Deliver<BrepBody> Tool = BrepBody::Extrude(Loop.Payload, Normal, Depth + std::fabs(Distance));
    if (!Tool) return Deliver<BrepBody>::Reject(Tool.Denial.Reason, Tool.Denial.Detail);

    Deliver<BrepBody> Result = Distance > 0.0
        ? IntersectionSolver::Combine(Body, Tool.Payload, BodyOperation::Union)
        : IntersectionSolver::Combine(Body, Tool.Payload, BodyOperation::Subtract);
    if (!Result) return Deliver<BrepBody>::Reject(Result.Denial.Reason, Result.Denial.Detail);

    // The seam where the tool met the face comes back as a degree-3 interpolation of the intersection polyline even
    //    where it is dead straight (arc length == chord to 1e-9). Those splines are geometrically right but they make
    //    the next boolean non-generic: a later chamfer of an edge touching this seam splits the body into two hulls.
    //    Snap any provably straight seam back to an exact line so pushed bodies stay blendable.
    BrepBody Clean = std::move(Result.Payload);
    for (BrepEdge& E : Clean.Edges)
    {
        if (E.Curve.Degree <= 1) continue;
        if (E.VertexStart < 0 || E.VertexEnd < 0 || E.Closed()) continue;
        Vec3 A = Clean.Vertices[E.VertexStart].Point, B = Clean.Vertices[E.VertexEnd].Point;
        double Chord = (B - A).Length();
        if (Chord <= Tol) continue;
        if (std::fabs(E.Curve.Length() - Chord) > 1e-7 * std::max(1.0, Chord)) continue;  // genuinely curved
        Deliver<NurbsCurve> Straight = NurbsCurve::Line(A, B);
        if (Straight) E.Curve = std::move(Straight.Payload);
    }
    for (BrepCoedge& C : Clean.Coedges) C.Trace.clear();
    return Deliver<BrepBody>::Accept(std::move(Clean));
}

} // namespace Frontier
