//============================================================================================================================================
// 📦 ParametricSketcher/Interaction/SnapResolution.cpp — Candidate generation and ranking
//============================================================================================================================================

#include "SnapResolution.h"
#include <algorithm>
#include <cmath>

namespace Frontier
{

const char* SnapKindName(SnapKind Kind) noexcept
{
    switch (Kind)
    {
        case SnapKind::None:          return "none";
        case SnapKind::Grid:          return "grid";
        case SnapKind::Endpoint:      return "endpoint";
        case SnapKind::Midpoint:      return "midpoint";
        case SnapKind::Centre:        return "centre";
        case SnapKind::Quadrant:      return "quadrant";
        case SnapKind::ControlPoint:  return "control-point";
        case SnapKind::OnCurve:       return "on-curve";
        case SnapKind::Perpendicular: return "perpendicular";
        case SnapKind::Tangent:       return "tangent";
        case SnapKind::Intersection:  return "intersection";
        case SnapKind::AxisX:         return "axis-x";
        case SnapKind::AxisY:         return "axis-y";
        case SnapKind::AxisZ:         return "axis-z";
        case SnapKind::Origin:        return "origin";
        case SnapKind::Free:          return "free";
    }
    return "?";
}

namespace
{

int PriorityOf(SnapKind Kind) noexcept
{
    switch (Kind)
    {
        case SnapKind::Intersection:  return 90;
        case SnapKind::Endpoint:      return 80;
        case SnapKind::Origin:        return 78;
        case SnapKind::Centre:        return 75;
        case SnapKind::Midpoint:      return 70;
        case SnapKind::Quadrant:      return 65;
        case SnapKind::Perpendicular: return 60;
        case SnapKind::Tangent:       return 58;
        case SnapKind::ControlPoint:  return 50;
        case SnapKind::OnCurve:       return 40;
        case SnapKind::AxisX: case SnapKind::AxisY: case SnapKind::AxisZ: return 30;
        case SnapKind::Grid:          return 10;
        default:                      return 0;
    }
}

Vec2 Project(const CameraProjection& Camera, Vec3 P, uint32_t W, uint32_t H) noexcept
{
    Mat4 VC = Camera.ProjectionMatrix(double(W) / H) * Camera.ViewMatrix();
    Vec4 C = VC * Vec4(P, 1.0);
    if (C.W <= 1e-9) return { -1e9, -1e9 };
    return { (C.X / C.W * 0.5 + 0.5) * W, (C.Y / C.W * 0.5 + 0.5) * H };
}

bool CircularKind(CurveClassification K) noexcept
{
    return K == CurveClassification::Circle || K == CurveClassification::Arc || K == CurveClassification::Ellipse;
}

// Centre of a rational conic: average of the "on-curve" poles for a full circle; for arcs use the curvature centre at mid-parameter.
Vec3 ConicCentre(const NurbsCurve& C) noexcept
{
    double Tm = 0.5 * (C.DomainStart() + C.DomainEnd());
    Vec3 D[3];
    C.Derivatives(Tm, 2, D);
    double Speed2 = D[1].LengthSquared();
    Vec3 Normal = D[1].Cross(D[2]);
    if (Speed2 < 1e-18 || Normal.LengthSquared() < 1e-24) return D[0];
    Vec3 Inward = Normal.Cross(D[1]).Normalised();
    double Kappa = Normal.Length() / (std::sqrt(Speed2) * Speed2);
    return D[0] + Inward / Kappa;
}

} // namespace

bool SnapResolution::PlaneHit(double PixelX, double PixelY, const CameraProjection& Camera, uint32_t Width, uint32_t Height,
                              const Workplane& Plane, Vec3& Out) noexcept
{
    Ray R = Camera.PixelRay(PixelX, PixelY, Width, Height);
    double T = 0.0;
    if (!R.Intersect(Plane.ToPlane(), T)) return false;
    if (T < 0.0 && !Camera.Orthographic) return false;
    Out = R.At(T);
    return true;
}

std::vector<SnapCandidate> SnapResolution::GeometryCandidates(const SceneDocument& Scene, uint32_t IgnoreIdentity) noexcept
{
    std::vector<SnapCandidate> Out;
    auto Push = [&](SnapKind Kind, Vec3 P, uint32_t Id, double T)
    {
        SnapCandidate C; C.Kind = Kind; C.Position = P; C.ItemIdentity = Id; C.Parameter = T; C.Priority = PriorityOf(Kind);
        Out.push_back(C);
    };
    for (const SceneItem& Item : Scene.Items())
    {
        if (Item.Hidden || Item.Kind != ItemKind::Curve || Item.Identity == IgnoreIdentity) continue;
        const NurbsCurve& C = Item.Curve;
        bool Closed = C.Closed();
        if (!Closed) { Push(SnapKind::Endpoint, C.StartPoint(), Item.Identity, C.DomainStart()); Push(SnapKind::Endpoint, C.EndPoint(), Item.Identity, C.DomainEnd()); }

        if (C.Degree == 1)                                                              // polyline: every vertex is an endpoint, every edge has a midpoint
        {
            for (int I = 0; I + 1 < C.PoleCount(); ++I)
            {
                Vec3 A = C.Poles[I].Divide(), B = C.Poles[I + 1].Divide();
                if (I > 0) Push(SnapKind::Endpoint, A, Item.Identity, C.Knots[I + 1]);
                Push(SnapKind::Midpoint, (A + B) * 0.5, Item.Identity, 0.5 * (C.Knots[I + 1] + C.Knots[I + 2]));
            }
        }
        else
        {
            double Tm = C.ParameterAtLength(C.Length() * 0.5);
            if (!Closed) Push(SnapKind::Midpoint, C.Sample(Tm), Item.Identity, Tm);
            for (const Vec4& Pole : C.Poles) Push(SnapKind::ControlPoint, Pole.Divide(), Item.Identity, 0.0);
        }

        if (CircularKind(C.Classification))
        {
            Vec3 Centre = ConicCentre(C);
            Push(SnapKind::Centre, Centre, Item.Identity, 0.0);
            if (C.Classification == CurveClassification::Circle)
            {
                // Quadrants: sample the curve, find points extremal along the workplane-ish axes of the circle's own plane.
                Frontier::Plane P; if (C.Planar(P))
                {
                    Workplane W = Workplane::FromNormal(Centre, P.Normal);
                    Vec3 Rim = C.StartPoint();
                    double R = Rim.Distance(Centre);
                    Vec3 Axes[4] = { W.AxisX, W.AxisY, W.AxisX * -1.0, W.AxisY * -1.0 };
                    for (Vec3 A : Axes) { Vec3 Q = Centre + A * R; double Dist; double T = C.ClosestParameter(Q, &Dist); Push(SnapKind::Quadrant, C.Sample(T), Item.Identity, T); }
                }
            }
        }
        else if (C.Classification == CurveClassification::Rectangle || C.Classification == CurveClassification::Slot || C.Classification == CurveClassification::Polygon)
        {
            Box3 B = C.Bounds();
            Push(SnapKind::Centre, B.Centre(), Item.Identity, 0.0);
        }
    }
    return Out;
}

SnapCandidate SnapResolution::Resolve(double PixelX, double PixelY, const CameraProjection& Camera, uint32_t Width, uint32_t Height,
                                      const Workplane& Plane, const SceneDocument& Scene, const SnapSettings& Settings,
                                      const Vec3* Anchor, uint32_t IgnoreIdentity) noexcept
{
    Vec2 Cursor{ PixelX, PixelY };
    SnapCandidate Best;
    Vec3 Hit;
    bool HaveHit = PlaneHit(PixelX, PixelY, Camera, Width, Height, Plane, Hit);
    if (HaveHit) { Best.Kind = SnapKind::Free; Best.Position = Hit; Best.PixelDistance = 0.0; Best.Priority = 0; }
    if (!Settings.Enabled) return Best;

    auto Consider = [&](SnapCandidate C)
    {
        C.PixelDistance = Project(Camera, C.Position, Width, Height).Distance(Cursor);
        if (C.PixelDistance > Settings.Radius) return;
        // Within the radius: higher priority wins; equal priority → closer wins.
        if (Best.Kind == SnapKind::Free || Best.Kind == SnapKind::None || C.Priority > Best.Priority ||
            (C.Priority == Best.Priority && C.PixelDistance < Best.PixelDistance))
            Best = C;
    };

    //---------------------------------------------- geometry ----------------------------------------------
    std::vector<SnapCandidate> Geometry;
    if (Settings.Geometry || Settings.Intersections) Geometry = GeometryCandidates(Scene, IgnoreIdentity);
    if (Settings.Geometry) for (const SnapCandidate& C : Geometry) Consider(C);

    // Origin of the workplane.
    { SnapCandidate C; C.Kind = SnapKind::Origin; C.Position = Plane.Origin; C.Priority = PriorityOf(SnapKind::Origin); Consider(C); }

    //---------------------------------------------- on-curve, perpendicular, tangent ----------------------------------------------
    if (Settings.OnCurve && HaveHit)
    {
        for (const SceneItem& Item : Scene.Items())
        {
            if (Item.Hidden || Item.Kind != ItemKind::Curve || Item.Identity == IgnoreIdentity) continue;
            const NurbsCurve& K = Item.Curve;
            double Dist; double T = K.ClosestParameter(Hit, &Dist);
            SnapCandidate C; C.Kind = SnapKind::OnCurve; C.Position = K.Sample(T); C.ItemIdentity = Item.Identity; C.Parameter = T; C.Priority = PriorityOf(SnapKind::OnCurve);
            Consider(C);
            if (Anchor)
            {
                double DistA; double Ta = K.ClosestParameter(*Anchor, &DistA);
                Vec3 Foot = K.Sample(Ta);
                if (DistA > ScalarCriteria::MergeTolerance)
                {
                    SnapCandidate P; P.Kind = SnapKind::Perpendicular; P.Position = Foot; P.ItemIdentity = Item.Identity; P.Parameter = Ta; P.Priority = PriorityOf(SnapKind::Perpendicular);
                    Consider(P);
                }
                if (K.Classification == CurveClassification::Circle)
                {
                    Vec3 Centre = ConicCentre(K);
                    double R = K.StartPoint().Distance(Centre);
                    Frontier::Plane Pl; if (K.Planar(Pl))
                    {
                        Vec3 D = *Anchor - Centre; D = D - Pl.Normal * D.Dot(Pl.Normal);
                        double L = D.Length();
                        if (L > R + ScalarCriteria::MergeTolerance)
                        {
                            double Angle = std::acos(R / L);
                            Vec3 U = D / L, V = Pl.Normal.Cross(U);
                            for (double S : { 1.0, -1.0 })
                            {
                                Vec3 Tp = Centre + (U * std::cos(Angle) + V * (S * std::sin(Angle))) * R;
                                double Tt = K.ClosestParameter(Tp, nullptr);
                                SnapCandidate Tc; Tc.Kind = SnapKind::Tangent; Tc.Position = K.Sample(Tt); Tc.ItemIdentity = Item.Identity; Tc.Parameter = Tt; Tc.Priority = PriorityOf(SnapKind::Tangent);
                                Consider(Tc);
                            }
                        }
                    }
                }
            }
        }
    }

    //---------------------------------------------- intersections (planar curves on the workplane) ----------------------------------------------
    if (Settings.Intersections && HaveHit)
    {
        // Cheap and honest: tessellate the two curves nearest the cursor and intersect polylines in workplane coordinates.
        std::vector<std::pair<double, const SceneItem*>> Near;
        for (const SceneItem& Item : Scene.Items())
        {
            if (Item.Hidden || Item.Kind != ItemKind::Curve || Item.Identity == IgnoreIdentity) continue;
            double Dist; (void)Item.Curve.ClosestParameter(Hit, &Dist);
            Near.emplace_back(Dist, &Item);
        }
        std::sort(Near.begin(), Near.end(), [](auto& A, auto& B) { return A.first < B.first; });
        if (Near.size() > 4) Near.resize(4);
        for (size_t I = 0; I < Near.size(); ++I)
            for (size_t J = I + 1; J < Near.size(); ++J)
            {
                std::vector<Vec3> A, B;
                Near[I].second->Curve.Tessellate(A, nullptr, 1e-3);
                Near[J].second->Curve.Tessellate(B, nullptr, 1e-3);
                for (size_t a = 0; a + 1 < A.size(); ++a)
                {
                    Vec2 P0 = Plane.ToLocal(A[a]), P1 = Plane.ToLocal(A[a + 1]);
                    for (size_t b = 0; b + 1 < B.size(); ++b)
                    {
                        Vec2 Q0 = Plane.ToLocal(B[b]), Q1 = Plane.ToLocal(B[b + 1]);
                        Vec2 R = P1 - P0, S = Q1 - Q0;
                        double Den = R.Cross(S);
                        if (std::fabs(Den) < 1e-14) continue;
                        Vec2 QP = Q0 - P0;
                        double T = QP.Cross(S) / Den, U = QP.Cross(R) / Den;
                        if (T < -1e-9 || T > 1 + 1e-9 || U < -1e-9 || U > 1 + 1e-9) continue;
                        Vec3 X = A[a] + (A[a + 1] - A[a]) * T;
                        // Refine: alternate closest-point projections so the result sits on both true curves.
                        for (int It = 0; It < 4; ++It)
                        {
                            X = Near[I].second->Curve.Sample(Near[I].second->Curve.ClosestParameter(X));
                            X = Near[J].second->Curve.Sample(Near[J].second->Curve.ClosestParameter(X));
                        }
                        SnapCandidate C; C.Kind = SnapKind::Intersection; C.Position = X; C.ItemIdentity = Near[I].second->Identity; C.Priority = PriorityOf(SnapKind::Intersection);
                        Consider(C);
                    }
                }
            }
    }

    //---------------------------------------------- axis alignment with the anchor ----------------------------------------------
    if (Settings.Axis && Anchor && HaveHit && (Best.Kind == SnapKind::Free || Best.Kind == SnapKind::Grid || Best.Kind == SnapKind::OnCurve))
    {
        Vec3 D = Hit - *Anchor;
        struct AxisOption { SnapKind Kind; Vec3 Dir; } Options[3] = { { SnapKind::AxisX, Plane.AxisX }, { SnapKind::AxisY, Plane.AxisY }, { SnapKind::AxisZ, Plane.Normal() } };
        for (const AxisOption& O : Options)
        {
            Vec3 Along = O.Dir * D.Dot(O.Dir);
            if (Along.Length() < ScalarCriteria::MergeTolerance) continue;
            SnapCandidate C; C.Kind = O.Kind; C.Position = *Anchor + Along; C.Priority = PriorityOf(O.Kind);
            Consider(C);
        }
    }

    //---------------------------------------------- grid ----------------------------------------------
    if (Settings.Grid && HaveHit && Settings.GridStep > 0.0 && (Best.Kind == SnapKind::Free))
    {
        Vec2 L = Plane.ToLocal(Hit);
        Vec2 G{ std::round(L.X / Settings.GridStep) * Settings.GridStep, std::round(L.Y / Settings.GridStep) * Settings.GridStep };
        SnapCandidate C; C.Kind = SnapKind::Grid; C.Position = Plane.ToWorld(G); C.Priority = PriorityOf(SnapKind::Grid);
        Consider(C);
    }
    return Best;
}

} // namespace Frontier
