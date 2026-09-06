//============================================================================================================================================
// 📦 ParametricSketcher/Console/ConsoleHost.cpp — Command set: sketch curves, primitive surfaces, extrude/revolve/loft, scene, view, render
//============================================================================================================================================

#include "ConsoleHost.h"
#include "Presentation/ScenePresentation.h"
#include "Kernel/ProfileSolver.h"
#include "Kernel/IntersectionSolver.h"
#include <cctype>
#include <chrono>
#include <cstdarg>
#include <filesystem>
#include <fstream>

namespace Frontier
{

namespace
{
const float Backdrop[4] = { 0.117f, 0.129f, 0.153f, 1.0f };
const char* ClassName(FigureClassification K) noexcept { return K == FigureClassification::Curve ? "curve" : "surface"; }
}

ConsoleHost::ConsoleHost(std::string ProofFolder, uint32_t Width, uint32_t Height) noexcept
    : Proofs(std::move(ProofFolder)), Surface(std::make_unique<SoftwareRaster>(Width, Height))
{
    Register();
    RegisterInteraction();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  OUTPUT
//------------------------------------------------------------------------------------------------------------------------

bool ConsoleHost::Refuse(const char* Format, ...) noexcept
{
    ++Refusals;
    std::printf("  ✗ ");
    va_list Args; va_start(Args, Format); std::vprintf(Format, Args); va_end(Args);
    std::printf("\n");
    return false;
}

void ConsoleHost::Row(const char* Format, ...) noexcept
{
    std::printf("  · ");
    va_list Args; va_start(Args, Format); std::vprintf(Format, Args); va_end(Args);
    std::printf("\n");
}

void ConsoleHost::DescribeFigure(const SceneFigure& Figure) noexcept
{
    Box3 B = Figure.Bounds();
    if (Figure.Classification == FigureClassification::Curve)
    {
        const NurbsCurve& C = Figure.Curve;
        Row("#%-3u %-18s curve    deg %d  poles %-4d %s%s  length %.4f  bounds [%.2f %.2f %.2f]–[%.2f %.2f %.2f]%s%s",
            Figure.Identity, Figure.Name.c_str(), C.Degree, C.PoleCount(), C.Rational() ? "rational" : "integral", C.Closed() ? " closed" : "",
            C.Length(), B.Low.X, B.Low.Y, B.Low.Z, B.High.X, B.High.Y, B.High.Z, Figure.Construction ? "  [construction]" : "", Figure.Selected ? "  [selected]" : "");
    }
    else if (Figure.Classification == FigureClassification::Body)
    {
        BodyReport R = Figure.Body.Validate();
        Row("#%-3u %-18s %-8s V%d E%d F%d  χ=%d genus %d  vol %.4f  area %.4f  bounds [%.2f %.2f %.2f]–[%.2f %.2f %.2f]%s%s%s",
            Figure.Identity, Figure.Name.c_str(), Describe(Figure.Body.Classification()), R.Vertices, R.Edges, R.Faces, R.EulerCharacteristic, R.Genus, R.Volume, R.Area,
            B.Low.X, B.Low.Y, B.Low.Z, B.High.X, B.High.Y, B.High.Z, R.Solid() ? "" : (R.OpenEdges ? "  [open]" : R.MisorientedEdges ? "  [misoriented]" : "  [not solid]"),
            Figure.Selected ? "  [selected]" : "", Figure.SelectedFaces.empty() && Figure.SelectedEdges.empty() ? "" : "  [sub-selection]");
    }
    else
    {
        const NurbsSurface& S = Figure.Surface;
        Row("#%-3u %-18s surface  deg %dx%d  poles %dx%d  %s%s%s  bounds [%.2f %.2f %.2f]–[%.2f %.2f %.2f]%s",
            Figure.Identity, Figure.Name.c_str(), S.DegreeU, S.DegreeV, S.CountU, S.CountV, S.Rational() ? "rational" : "integral",
            S.ClosedU() ? " closedU" : "", S.ClosedV() ? " closedV" : "", B.Low.X, B.Low.Y, B.Low.Z, B.High.X, B.High.Y, B.High.Z, Figure.Selected ? "  [selected]" : "");
    }
}

bool ConsoleHost::AddCurve(const CommandLine& C, const char* Stem, Deliver<NurbsCurve> Result) noexcept
{
    if (!Result) return Refuse("%s refused: %s — %s", Stem, Refusal::Describe(Result.Denial.Reason), Result.Denial.Detail);
    SceneFigure& Figure = Scene.AddCurve(C.SwitchText("name").value_or(Stem), std::move(Result.Payload));
    Figure.Construction = C.Switch("construction");
    DescribeFigure(Figure);
    return true;
}

bool ConsoleHost::AddSurface(const CommandLine& C, const char* Stem, Deliver<NurbsSurface> Result) noexcept
{
    if (!Result) return Refuse("%s refused: %s — %s", Stem, Refusal::Describe(Result.Denial.Reason), Result.Denial.Detail);
    SceneFigure& Figure = Scene.AddSurface(C.SwitchText("name").value_or(Stem), std::move(Result.Payload));
    DescribeFigure(Figure);
    return true;
}

bool ConsoleHost::AddBody(const CommandLine& C, const char* Stem, Deliver<BrepBody> Result) noexcept
{
    if (!Result) return Refuse("%s refused: %s — %s", Stem, Refusal::Describe(Result.Denial.Reason), Result.Denial.Detail);
    SceneFigure& Figure = Scene.AddBody(C.SwitchText("name").value_or(Stem), std::move(Result.Payload));
    DescribeFigure(Figure);
    BodyReport R = Figure.Body.Validate();
    if (!R.Solid()) Row("  ⚠ open %d  non-manifold %d  misoriented %d", R.OpenEdges, R.NonManifoldEdges, R.MisorientedEdges);
    return true;
}

// Create a derived figure from a recipe: build once now, keep the sources (Plasticity leaves the sketch in place), and
//    let Regenerate() follow them from then on.
bool ConsoleHost::AddDerived(const CommandLine& C, const char* Stem, FigureRecipe Recipe) noexcept
{
    Deliver<FigureRecipe::Product> P = Recipe.Produce(Scene, Plane);
    if (!P) return Refuse("%s refused: %s — %s", Stem, Refusal::Describe(P.Denial.Reason), P.Denial.Detail);
    Recipe.InputFingerprint = Recipe.FingerprintInputs(Scene, Plane);
    SceneFigure& Figure = P.Payload.IsBody ? Scene.AddBody(C.SwitchText("name").value_or(Stem), std::move(P.Payload.Body))
                                           : Scene.AddSurface(C.SwitchText("name").value_or(Stem), std::move(P.Payload.Sheet));
    Figure.Recipe = std::move(Recipe);
    DescribeFigure(Figure);
    Row("  ↳ %s", Figure.Recipe.Summary(Scene).c_str());
    if (Figure.Classification == FigureClassification::Body) { BodyReport R = Figure.Body.Validate(); if (!R.Solid()) Row("  ⚠ open %d  non-manifold %d  misoriented %d", R.OpenEdges, R.NonManifoldEdges, R.MisorientedEdges); }
    return true;
}

SceneFigure* ConsoleHost::Resolve(const std::string& Token) noexcept
{
    if (!Token.empty() && Token[0] == '#')
        if (auto Id = CommandCodec::ParseNumber(Token.substr(1))) return Scene.Find(static_cast<uint32_t>(*Id));
    if (SceneFigure* I = Scene.Find(Token)) return I;
    if (auto Id = CommandCodec::ParseNumber(Token)) return Scene.Find(static_cast<uint32_t>(*Id));
    return nullptr;
}

std::vector<SceneFigure*> ConsoleHost::ResolveMany(const CommandLine& C, size_t FirstIndex) noexcept
{
    std::vector<SceneFigure*> Out;
    if (C.Count() <= FirstIndex || (C.Count() == FirstIndex + 1 && C.Arguments[FirstIndex] == "selected"))
    {
        for (SceneFigure& I : Scene.Figures()) if (I.Selected) Out.push_back(&I);
        return Out;
    }
    if (C.Count() == FirstIndex + 1 && C.Arguments[FirstIndex] == "all")
    {
        for (SceneFigure& I : Scene.Figures()) Out.push_back(&I);
        return Out;
    }
    for (size_t I = FirstIndex; I < C.Count(); ++I)
        if (SceneFigure* Figure = Resolve(C.Arguments[I])) Out.push_back(Figure);
        else { Refuse("no figure '%s'", C.Arguments[I].c_str()); Out.clear(); return Out; }
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  RENDER
//------------------------------------------------------------------------------------------------------------------------

void ConsoleHost::Render() noexcept
{
    Surface->BeginTarget(Backdrop);
    Surface->BindView(View.ToViewRecord(Surface->Width(), Surface->Height(), 1.0));
    Surface->DrawLattice();

    for (const SceneFigure& Figure : Scene.Figures())
    {
        if (Figure.Hidden || Figure.Classification != FigureClassification::Body) continue;
        DrawBody(Figure);
    }
    for (const SceneFigure& Figure : Scene.Figures())
    {
        if (Figure.Hidden || Figure.Classification != FigureClassification::Surface) continue;
        DrawRecord D = ScenePresentation::Tinted(Figure.Tint[0], Figure.Tint[1], Figure.Tint[2]);
        D.PickIdentity = SceneDocument::PickOf(Figure.Identity);
        D.Highlight = Figure.Selected ? 2.0f : (SceneDocument::IdentityOf(HoverPick) == Figure.Identity ? 1.0f : 0.0f);
        D.Matcap = Figure.Matcap;
        D.Shading = static_cast<uint8_t>(Shading);
        Surface->DrawSurface(ScenePresentation::SurfaceTriangles(Figure.Surface, 2e-3), D);
        if (ShowIsoCurves)
        {
            DrawRecord Iso = ScenePresentation::Tinted(0.10f, 0.11f, 0.13f, 0.28f); Iso.LineWidth = 1.0f; Iso.PickIdentity = SceneDocument::PickOf(Figure.Identity);
            Surface->DrawSegments(ScenePresentation::SurfaceIsoCurves(Figure.Surface, 8, 8), Iso);
        }
        if (ShowControlCages || Figure.Selected || Mode == SelectMode::Control) DrawControlPoints(Figure);
    }
    DrawAreas();
    for (const SceneFigure& Figure : Scene.Figures())
    {
        if (Figure.Hidden || Figure.Classification != FigureClassification::Curve) continue;
        DrawRecord D = Figure.Selected ? ScenePresentation::Tinted(1.0f, 0.62f, 0.20f) : ScenePresentation::Tinted(0.92f, 0.94f, 0.97f);
        D.LineWidth = Figure.Selected ? 2.5f : 2.0f;
        D.Dashed = Figure.Construction;
        D.PickIdentity = SceneDocument::PickOf(Figure.Identity);
        D.Highlight = Figure.Selected ? 2.0f : (SceneDocument::IdentityOf(HoverPick) == Figure.Identity ? 1.0f : 0.0f);
        Surface->DrawSegments(ScenePresentation::CurveSegments(Figure.Curve), D);
        if (ShowControlCages || Figure.Selected || Mode == SelectMode::Control) DrawControlPoints(Figure);
    }

    Surface->BeginOverlay();
    DrawToolPreview();
    if (GizmoShown && (Scene.SelectedCount() + Scene.SelectedPoleCount() + Scene.SelectedFaceCount() + Scene.SelectedEdgeCount() > 0) && !Tool.Active())
    {
        if (!GizmoRig.Dragging()) RefreshGizmoPivot();
        GizmoRig.AimAt(View);
        GizmoRig.Draw(*Surface, View, Surface->Width(), Surface->Height());
    }
    ScenePresentation::DrawTriad(*Surface, View.OrthographicHalfHeight() * 0.12);
    Surface->EndTarget();
}

void ConsoleHost::DrawAreas() noexcept
{
    // Filled sketch areas: translucent sheet in the workplane, ear-clipped with holes, picked by their own identity.
    for (const SketchArea& A : Scene.Areas())
    {
        if (!A.Filled && !A.Selected && SceneDocument::IdentityOf(HoverPick) != A.Identity) continue;
        std::vector<Vec3> Pts; std::vector<std::vector<uint32_t>> Rings;
        auto Ring = [&](const NurbsCurve& C)
        {
            std::vector<Vec3> P; C.Tessellate(P, nullptr, 2e-3);
            if (P.size() > 1 && P.back().Coincident(P.front(), 1e-9)) P.pop_back();
            std::vector<uint32_t> R; for (const Vec3& Q : P) { R.push_back(uint32_t(Pts.size())); Pts.push_back(Q); }
            Rings.push_back(std::move(R));
        };
        Ring(A.Cell.Outer); for (const NurbsCurve& Hh : A.Cell.Holes) Ring(Hh);
        std::vector<uint32_t> Tri = TriangulatePlanarPolygon(Pts, Rings, A.Normal);
        if (Tri.empty()) continue;
        SurfaceStream S;
        for (const Vec3& P : Pts) { S.Positions.insert(S.Positions.end(), { float(P.X), float(P.Y), float(P.Z) }); S.Normals.insert(S.Normals.end(), { float(A.Normal.X), float(A.Normal.Y), float(A.Normal.Z) }); S.Parameters.insert(S.Parameters.end(), { 0.f, 0.f }); }
        S.Triangles = Tri;
        const bool Hover = SceneDocument::IdentityOf(HoverPick) == A.Identity;
        DrawRecord D = A.Selected ? ScenePresentation::Tinted(1.0f, 0.62f, 0.20f, 0.45f)
                     : A.Filled  ? ScenePresentation::Tinted(0.55f, 0.72f, 0.95f, Hover ? 0.42f : 0.28f)
                                 : ScenePresentation::Tinted(0.95f, 0.95f, 0.95f, 0.10f);            // unfilled: ghost only while hovered
        D.PickIdentity = SceneDocument::PickOf(A.Identity);
        D.Highlight = A.Selected ? 2.0f : (Hover ? 1.0f : 0.0f);
        Surface->DrawSurface(S, D);
    }
}

void ConsoleHost::DrawBody(const SceneFigure& Figure) noexcept
{
    const BrepBody& B = Figure.Body;
    const bool FigureHover = SceneDocument::IdentityOf(HoverPick) == Figure.Identity;
    for (size_t F = 0; F < B.Faces.size(); ++F)
    {
        BrepBody::FaceTriangles T = B.TessellateFace(int(F), 2e-3);
        SurfaceStream S;
        for (size_t I = 0; I < T.Positions.size(); ++I)
        {
            S.Positions.push_back(float(T.Positions[I].X)); S.Positions.push_back(float(T.Positions[I].Y)); S.Positions.push_back(float(T.Positions[I].Z));
            S.Normals.push_back(float(T.Normals[I].X)); S.Normals.push_back(float(T.Normals[I].Y)); S.Normals.push_back(float(T.Normals[I].Z));
            S.Parameters.push_back(float(T.Parameters[I].X)); S.Parameters.push_back(float(T.Parameters[I].Y));
        }
        S.Triangles = T.Triangles;
        DrawRecord D = ScenePresentation::Tinted(Figure.Tint[0], Figure.Tint[1], Figure.Tint[2]);
        D.PickIdentity = SceneDocument::PickOf(Figure.Identity, SceneDocument::PickPart::Face, int(F));
        const bool FaceSel = Figure.FaceSelected(int(F));
        const bool FaceHover = FigureHover && (Mode == SelectMode::Face ? SceneDocument::FaceOf(HoverPick) == int(F) : Mode == SelectMode::Whole);
        D.Highlight = (Figure.Selected || FaceSel) ? 2.0f : (FaceHover ? 1.0f : 0.0f);
        D.Matcap = Figure.Matcap;
        D.Shading = static_cast<uint8_t>(Shading);
        Surface->DrawSurface(S, D);
    }
    for (size_t E = 0; E < B.Edges.size(); ++E)
    {
        std::vector<Vec3> P = B.EdgePolyline(int(E));
        SegmentStream Seg; for (size_t I = 0; I + 1 < P.size(); ++I) Seg.Append(P[I], P[I + 1]);
        const bool EdgeSel = Figure.EdgeSelected(int(E));
        const bool EdgeHover = FigureHover && Mode == SelectMode::Edge && SceneDocument::EdgeOf(HoverPick) == int(E);
        DrawRecord D = EdgeSel ? ScenePresentation::Tinted(1.0f, 0.62f, 0.20f) : ScenePresentation::Tinted(0.08f, 0.09f, 0.11f, 0.9f);
        D.LineWidth = EdgeSel ? 4.0f : (EdgeHover ? 3.0f : 1.5f);
        D.Highlight = EdgeSel ? 2.0f : (EdgeHover ? 1.0f : 0.0f);
        D.PickIdentity = SceneDocument::PickOf(Figure.Identity, SceneDocument::PickPart::Edge, int(E));
        Surface->DrawSegments(Seg, D);
    }
}

void ConsoleHost::DrawControlPoints(const SceneFigure& Figure) noexcept
{
    DrawRecord Cage = ScenePresentation::Tinted(0.95f, 0.80f, 0.30f, 0.9f); Cage.LineWidth = 1.0f; Cage.Dashed = true; Cage.PointSize = 7.0f;
    if (Figure.Classification == FigureClassification::Curve) Surface->DrawSegments(ScenePresentation::ControlPolygon(Figure.Curve), Cage);
    else Surface->DrawSegments(ScenePresentation::ControlNet(Figure.Surface), Cage);
    // One draw per pole so each carries its own pick identity and highlight (still a handful of quads).
    const int N = Figure.PoleCount();
    for (int P = 0; P < N; ++P)
    {
        PointStream One; One.Append(Figure.PolePosition(P), PointGlyph::Square);
        DrawRecord D = Cage;
        D.PickIdentity = SceneDocument::PickOf(Figure.Identity, P);
        const bool Sel = Figure.PoleSelected(P);
        D.Highlight = Sel ? 2.0f : (HoverPick == D.PickIdentity ? 1.0f : 0.0f);
        D.PointSize = Sel ? 9.0f : 7.0f;
        Surface->DrawPoints(One, D);
    }
}

Vec3 ConsoleHost::SelectionPivot() const noexcept
{
    if (Mode == SelectMode::Control && Scene.SelectedPoleCount() > 0)
    {
        Vec3 Sum; int N = 0;
        for (const SceneFigure& I : Scene.Figures()) for (int P : I.SelectedPoles) { Sum = Sum + I.PolePosition(P); ++N; }
        return Sum * (1.0 / N);
    }
    if (Scene.SelectedFaceCount() + Scene.SelectedEdgeCount() > 0)
    {
        Box3 B;
        for (const SceneFigure& I : Scene.Figures())
        {
            for (int F : I.SelectedFaces) B.Include(I.Body.Faces[F].Surface.Bounds());
            for (int E : I.SelectedEdges) B.Include(I.Body.Edges[E].Curve.Bounds());
        }
        if (!B.Empty()) return B.Centre();
    }
    return Scene.Bounds(true).Centre();
}

void ConsoleHost::RefreshGizmoPivot() noexcept
{
    TransformGizmo::PivotBasis F; F.Origin = SelectionPivot();
    GizmoRig.Anchor(F);
    GizmoRig.AimAt(View);
}

void ConsoleHost::ApplyDeltaToSelection(const Mat4& Delta) noexcept
{
    for (auto& [Id, Original] : GizmoOriginals)
        if (SceneFigure* I = Scene.Find(Id))
        {
            if (Mode == SelectMode::Control && !Original.SelectedPoles.empty())
            {
                for (int P : Original.SelectedPoles) I->MovePole(P, Delta.TransformPoint(Original.PolePosition(P)));
            }
            else { SceneFigure Fresh = Original; Fresh.Transform(Delta); I->Curve = std::move(Fresh.Curve); I->Surface = std::move(Fresh.Surface); I->Body = std::move(Fresh.Body); }
        }
}

void ConsoleHost::ApplyGizmoDelta(const Mat4& Delta) noexcept { ApplyDeltaToSelection(Delta); }

//------------------------------------------------------------------------------------------------------------------------
//                                                  COMMANDS
//------------------------------------------------------------------------------------------------------------------------

void ConsoleHost::Register() noexcept
{
    auto Add = [&](const char* Verb, const char* Help, Command Fn) { Commands[Verb] = std::move(Fn); Usage[Verb] = Help; };
    auto Need = [&](const CommandLine& C, size_t N, const char* Verb) -> bool
    {
        if (C.Count() >= N) return true;
        return Refuse("%s: expected %zu argument(s) — usage: %s", Verb, N, Usage[Verb].c_str());
    };
    auto PointArg = [&](const CommandLine& C, size_t I, Vec3& Out, const char* Verb) -> bool
    {
        auto P = C.Point(I);
        if (!P) return Refuse("%s: argument %zu must be a point (x,y[,z])", Verb, I + 1);
        Out = *P; return true;
    };
    auto NumberArg = [&](const CommandLine& C, size_t I, double& Out, const char* Verb) -> bool
    {
        auto N = C.Number(I);
        if (!N) return Refuse("%s: argument %zu must be a number", Verb, I + 1);
        Out = *N; return true;
    };
    // Points given as (x,y) are lifted onto the active workplane; (x,y,z) are world.
    auto Lift = [&](const CommandLine& C, size_t I, Vec3& Out) -> bool
    {
        auto P = C.Point(I); if (!P) return false;
        bool Planar = C.Arguments[I].find(',') == C.Arguments[I].rfind(',');
        Out = Planar ? Plane.ToWorld({ P->X, P->Y }) : *P;
        return true;
    };

    //---------------------------------------------- sketch curves ----------------------------------------------
    Add("line", "line (x,y[,z]) (x,y[,z]) [--name=N] [--construction]", [=, this](const CommandLine& C)
    {
        Vec3 A, B; if (!Need(C, 2, "line") || !Lift(C, 0, A) || !Lift(C, 1, B)) return Refuse("line: two points required");
        return AddCurve(C, "Line", NurbsCurve::Line(A, B));
    });
    Add("polyline", "polyline (x,y) (x,y) ... [--closed]", [=, this](const CommandLine& C)
    {
        std::vector<Vec3> Pts; Vec3 P;
        for (size_t I = 0; I < C.Count(); ++I) { if (!Lift(C, I, P)) return Refuse("polyline: argument %zu is not a point", I + 1); Pts.push_back(P); }
        return AddCurve(C, "Polyline", NurbsCurve::Polyline(Pts, C.Switch("closed")));
    });
    Add("rect", "rect (x,y) (x,y) [--radius=R] [--center]", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "rect")) return false;
        auto A = C.Point2(0), B = C.Point2(1); if (!A || !B) return Refuse("rect: two planar points required");
        if (C.Switch("center")) { Vec2 Half = *B; B = *A + Half; A = *A - Half; }
        return AddCurve(C, "Rectangle", NurbsCurve::Rectangle(Plane, *A, *B, C.SwitchNumber("radius").value_or(0.0)));
    });
    Add("polygon", "polygon (cx,cy) radius sides [--rotation=deg] [--circumscribed]", [=, this](const CommandLine& C)
    {
        double R = 0, N = 0; if (!Need(C, 3, "polygon") || !NumberArg(C, 1, R, "polygon") || !NumberArg(C, 2, N, "polygon")) return false;
        auto Ctr = C.Point2(0); if (!Ctr) return Refuse("polygon: centre must be a planar point");
        return AddCurve(C, "Polygon", NurbsCurve::Polygon(Plane, *Ctr, R, static_cast<int>(N), ScalarCriteria::Radians(C.SwitchNumber("rotation").value_or(0.0)), !C.Switch("circumscribed")));
    });
    Add("slot", "slot (ax,ay) (bx,by) radius", [=, this](const CommandLine& C)
    {
        double R = 0; if (!Need(C, 3, "slot") || !NumberArg(C, 2, R, "slot")) return false;
        auto A = C.Point2(0), B = C.Point2(1); if (!A || !B) return Refuse("slot: two planar centres required");
        return AddCurve(C, "Slot", NurbsCurve::Slot(Plane, *A, *B, R));
    });
    Add("circle", "circle (cx,cy[,cz]) radius [--normal=(x,y,z)]", [=, this](const CommandLine& C)
    {
        Vec3 Ctr; double R = 0; if (!Need(C, 2, "circle") || !Lift(C, 0, Ctr) || !NumberArg(C, 1, R, "circle")) return Refuse("circle: centre and radius required");
        Vec3 N = Plane.Normal(); if (auto F = C.SwitchText("normal")) if (auto V = CommandCodec::ParsePoint(*F)) N = *V;
        return AddCurve(C, "Circle", NurbsCurve::Circle(Ctr, N, R));
    });
    Add("arc", "arc (cx,cy) radius startDeg sweepDeg  |  arc --three (a) (b) (c)", [=, this](const CommandLine& C)
    {
        if (C.Switch("three"))
        {
            Vec3 A, B, D; if (!Need(C, 3, "arc") || !Lift(C, 0, A) || !Lift(C, 1, B) || !Lift(C, 2, D)) return Refuse("arc --three: three points required");
            return AddCurve(C, "Arc", NurbsCurve::ArcThreePoints(A, B, D));
        }
        Vec3 Ctr; double R = 0, S0 = 0, Sw = 0;
        if (!Need(C, 4, "arc") || !Lift(C, 0, Ctr) || !NumberArg(C, 1, R, "arc") || !NumberArg(C, 2, S0, "arc") || !NumberArg(C, 3, Sw, "arc")) return false;
        return AddCurve(C, "Arc", NurbsCurve::Arc(Ctr, Plane.Normal(), R, ScalarCriteria::Radians(S0), ScalarCriteria::Radians(Sw)));
    });
    Add("ellipse", "ellipse (cx,cy) radiusMajor radiusMinor [--rotation=deg]", [=, this](const CommandLine& C)
    {
        Vec3 Ctr; double A = 0, B = 0; if (!Need(C, 3, "ellipse") || !Lift(C, 0, Ctr) || !NumberArg(C, 1, A, "ellipse") || !NumberArg(C, 2, B, "ellipse")) return false;
        double Rot = ScalarCriteria::Radians(C.SwitchNumber("rotation").value_or(0.0));
        Vec3 Major = Plane.AxisX * std::cos(Rot) + Plane.AxisY * std::sin(Rot);
        return AddCurve(C, "Ellipse", NurbsCurve::Ellipse(Ctr, Plane.Normal(), Major, A, B));
    });
    Add("spline", "spline (p) (p) (p) ... [--degree=3] [--closed]   interpolating", [=, this](const CommandLine& C)
    {
        std::vector<Vec3> Pts; Vec3 P;
        for (size_t I = 0; I < C.Count(); ++I) { if (!Lift(C, I, P)) return Refuse("spline: argument %zu is not a point", I + 1); Pts.push_back(P); }
        return AddCurve(C, "Spline", NurbsCurve::Interpolate(Pts, static_cast<int>(C.SwitchNumber("degree").value_or(3)), C.Switch("closed")));
    });
    Add("cpcurve", "cpcurve (p) (p) (p) ... [--degree=3] [--periodic]   control-point curve", [=, this](const CommandLine& C)
    {
        std::vector<Vec3> Pts; Vec3 P;
        for (size_t I = 0; I < C.Count(); ++I) { if (!Lift(C, I, P)) return Refuse("cpcurve: argument %zu is not a point", I + 1); Pts.push_back(P); }
        return AddCurve(C, "ControlCurve", NurbsCurve::ControlPoints(static_cast<int>(C.SwitchNumber("degree").value_or(3)), Pts, C.Switch("periodic")));
    });

    //---------------------------------------------- primitive surfaces ----------------------------------------------
    Add("box", "box (cornerA) (cornerB)  ·  box (corner) dx dy dz — solid body", [=, this](const CommandLine& C)
    {
        Vec3 A, B; if (!Need(C, 2, "box") || !PointArg(C, 0, A, "box")) return false;
        if (C.Count() >= 4) { double Dx = 0, Dy = 0, Dz = 0; if (!NumberArg(C, 1, Dx, "box") || !NumberArg(C, 2, Dy, "box") || !NumberArg(C, 3, Dz, "box")) return false; B = A + Vec3{ Dx, Dy, Dz }; }
        else if (!PointArg(C, 1, B, "box")) return false;
        return AddBody(C, "Box", BrepBody::Box(A, B));
    });
    Add("sphere", "sphere (cx,cy,cz) radius [--sheet]", [=, this](const CommandLine& C)
    {
        Vec3 Ctr; double R = 0; if (!Need(C, 2, "sphere") || !PointArg(C, 0, Ctr, "sphere") || !NumberArg(C, 1, R, "sphere")) return false;
        if (C.Switch("sheet")) return AddSurface(C, "Sphere", NurbsSurface::Sphere(Ctr, R));
        return AddBody(C, "Sphere", BrepBody::Sphere(Ctr, R));
    });
    Add("cylinder", "cylinder (foot) radius height [--axis=(x,y,z)] [--sheet]", [=, this](const CommandLine& C)
    {
        Vec3 F; double R = 0, H = 0; if (!Need(C, 3, "cylinder") || !PointArg(C, 0, F, "cylinder") || !NumberArg(C, 1, R, "cylinder") || !NumberArg(C, 2, H, "cylinder")) return false;
        Vec3 Axis = Plane.Normal(); if (auto A = C.SwitchText("axis")) if (auto V = CommandCodec::ParsePoint(*A)) Axis = *V;
        if (C.Switch("sheet")) return AddSurface(C, "Cylinder", NurbsSurface::Cylinder(F, Axis, R, H));
        return AddBody(C, "Cylinder", BrepBody::Cylinder(F, Axis, R, H));
    });
    Add("cone", "cone (foot) radiusFoot radiusTop height [--axis=(x,y,z)] [--sheet]", [=, this](const CommandLine& C)
    {
        Vec3 F; double R0 = 0, R1 = 0, H = 0;
        if (!Need(C, 4, "cone") || !PointArg(C, 0, F, "cone") || !NumberArg(C, 1, R0, "cone") || !NumberArg(C, 2, R1, "cone") || !NumberArg(C, 3, H, "cone")) return false;
        Vec3 Axis = Plane.Normal(); if (auto A = C.SwitchText("axis")) if (auto V = CommandCodec::ParsePoint(*A)) Axis = *V;
        if (C.Switch("sheet")) return AddSurface(C, "Cone", NurbsSurface::Cone(F, Axis, R0, R1, H));
        return AddBody(C, "Cone", BrepBody::Cone(F, Axis, R0, R1, H));
    });
    Add("torus", "torus (centre) radiusMajor radiusMinor [--axis=(x,y,z)] [--sheet]", [=, this](const CommandLine& C)
    {
        Vec3 Ctr; double R0 = 0, R1 = 0; if (!Need(C, 3, "torus") || !PointArg(C, 0, Ctr, "torus") || !NumberArg(C, 1, R0, "torus") || !NumberArg(C, 2, R1, "torus")) return false;
        Vec3 Axis = Plane.Normal(); if (auto A = C.SwitchText("axis")) if (auto V = CommandCodec::ParsePoint(*A)) Axis = *V;
        if (C.Switch("sheet")) return AddSurface(C, "Torus", NurbsSurface::Torus(Ctr, Axis, R0, R1));
        return AddBody(C, "Torus", BrepBody::Torus(Ctr, Axis, R0, R1));
    });
    Add("topology", "topology <body> — vertices, edges (with coedge senses), loops, faces, validation", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "topology")) return false;
        SceneFigure* I = Resolve(C.Arguments[0]); if (!I) return Refuse("no figure '%s'", C.Arguments[0].c_str());
        if (I->Classification != FigureClassification::Body) return Refuse("topology: '%s' is not a body", I->Name.c_str());
        const BrepBody& B = I->Body; BodyReport R = B.Validate();
        Row("%s %s  V%d E%d F%d L%d  hulls %d  χ=%d genus %d  closed %s manifold %s oriented %s  volume %.6f  area %.6f", I->Name.c_str(), Describe(B.Classification()),
            R.Vertices, R.Edges, R.Faces, R.Loops, R.Hulls, R.EulerCharacteristic, R.Genus, R.Closed ? "yes" : "no", R.Manifold ? "yes" : "no", R.Oriented ? "yes" : "no", R.Volume, R.Area);
        for (size_t V = 0; V < B.Vertices.size(); ++V) Row("  v%-3zu (%9.4f %9.4f %9.4f)", V, B.Vertices[V].Point.X, B.Vertices[V].Point.Y, B.Vertices[V].Point.Z);
        for (size_t E = 0; E < B.Edges.size(); ++E)
        {
            const BrepEdge& Ed = B.Edges[E];
            std::string Users; for (int Ce : Ed.Coedges) Users += " f" + std::to_string(B.Coedges[Ce].Face) + (B.Coedges[Ce].Reversed ? "-" : "+");
            Row("  e%-3zu v%d→v%d  %s deg %d  len %.4f  coedges[%s ]%s", E, Ed.VertexStart, Ed.VertexEnd, Describe(Ed.Curve.Classification), Ed.Curve.Degree, Ed.Curve.Length(), Users.c_str(),
                Ed.Coedges.size() == 1 ? "  OPEN" : Ed.Coedges.size() > 2 ? "  NON-MANIFOLD" : "");
        }
        for (size_t F = 0; F < B.Faces.size(); ++F)
        {
            const BrepFace& Fa = B.Faces[F];
            std::string Loops;
            for (int L : Fa.Loops) { Loops += B.Loops[L].Outer ? "  outer[" : "  hole["; for (int Ce : B.Loops[L].Coedges) Loops += " e" + std::to_string(B.Coedges[Ce].Edge) + (B.Coedges[Ce].Reversed ? "-" : "+"); Loops += " ]"; }
            Vec3 N = B.FaceNormal(int(F), 0.5 * (Fa.Surface.DomainStartU() + Fa.Surface.DomainEndU()), 0.5 * (Fa.Surface.DomainStartV() + Fa.Surface.DomainEndV()));
            Row("  f%-3zu %-10s %s%s  n(%.2f %.2f %.2f)%s", F, Describe(Fa.Surface.Classification), Fa.Reversed ? "reversed " : "", Fa.Natural ? "natural" : "trimmed", N.X, N.Y, N.Z, Loops.c_str());
        }
        return true;
    });
    Add("areas", "areas — list the closed sketch areas of the workplane (aN), their fill, holes and bounding curves", [=, this](const CommandLine&)
    {
        Scene.RebuildAreas(Plane);
        if (Scene.Areas().empty()) { Row("no closed areas on the workplane"); return true; }
        for (const SketchArea& A : Scene.Areas())
        {
            std::string Src; for (uint32_t Id : A.BoundingIdentities) if (SceneFigure* F = Scene.Find(Id)) Src += " " + F->Name;
            Row("  a%-3u %-8s depth %d  area %.6f  holes %zu  centroid (%.3f %.3f %.3f)%s  bounded by%s", A.Identity - SceneDocument::AreaIdentityBase, A.Filled ? "filled" : "empty", A.Cell.Depth, A.Cell.Area, A.Cell.Holes.size(), A.Centroid.X, A.Centroid.Y, A.Centroid.Z, A.Selected ? "  [selected]" : "", Src.c_str());
        }
        return true;
    });
    Add("fill", "fill on|off|toggle <aN...> | all | none | selected  ·  fill at (x,y[,z]) [on|off] — bucket-fill: choose which closed areas are material (solid on extrude) and which stay empty (sheet)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "fill")) return false;
        Scene.RebuildAreas(Plane);
        const std::string& A0 = C.Arguments[0];
        auto Apply = [&](SketchArea& A, int Want) { A.Filled = Want < 0 ? !A.Filled : Want > 0; Row("  a%u %s  (area %.4f, %zu hole(s))", A.Identity - SceneDocument::AreaIdentityBase, A.Filled ? "filled" : "emptied", A.Cell.Area, A.Cell.Holes.size()); };
        if (A0 == "at")
        {
            Vec3 P; if (!Need(C, 2, "fill at") || !PointArg(C, 1, P, "fill")) return false;
            int Want = -1; if (C.Count() >= 3) Want = C.Arguments[2] == "on" ? 1 : C.Arguments[2] == "off" ? 0 : -1;
            SketchArea* A = Scene.AreaAt(P); if (!A) return Refuse("fill at: no closed area under (%.3f %.3f %.3f)", P.X, P.Y, P.Z);
            Apply(*A, Want); return true;
        }
        if (A0 == "all" || A0 == "none") { for (SketchArea& A : Scene.Areas()) Apply(A, A0 == "all"); return true; }
        int Want = A0 == "on" ? 1 : A0 == "off" ? 0 : A0 == "toggle" ? -1 : -2;
        if (Want == -2) return Refuse("fill: on|off|toggle|all|none|at expected, got '%s'", A0.c_str());
        int Done = 0;
        if (C.Count() == 1 || C.Arguments[1] == "selected") { for (SketchArea& A : Scene.Areas()) if (A.Selected) { Apply(A, Want); ++Done; } if (!Done) return Refuse("fill: no areas selected"); return true; }
        for (size_t I = 1; I < C.Count(); ++I)
        {
            const std::string& T = C.Arguments[I];
            if (T == "all") { for (SketchArea& A : Scene.Areas()) { Apply(A, Want); ++Done; } continue; }
            const char* Digits = T.c_str(); if (*Digits == 'a' || *Digits == 'A') ++Digits;
            SketchArea* A = Scene.FindArea(SceneDocument::AreaIdentityBase + uint32_t(std::atoi(Digits)));
            if (!A) return Refuse("fill: no area '%s' (see `areas`)", T.c_str());
            Apply(*A, Want); ++Done;
        }
        return Done > 0;
    });
    Add("sew", "sew <surface...> — stitch sheet surfaces into one body, cap planar openings, orient", [=, this](const CommandLine& C)
    {
        std::vector<NurbsSurface> S; std::vector<uint32_t> Ids;
        for (SceneFigure* I : ResolveMany(C, 0)) { if (I->Classification == FigureClassification::Surface) { S.push_back(I->Surface); Ids.push_back(I->Identity); } else if (I->Classification == FigureClassification::Body) { for (const BrepFace& F : I->Body.Faces) S.push_back(F.Surface); Ids.push_back(I->Identity); } }
        if (S.empty()) return Refuse("sew: no surfaces");
        if (!AddBody(C, "Sewn", BrepBody::Sew(S))) return false;
        if (!C.Switch("keep")) for (uint32_t Id : Ids) Scene.Remove(Id);
        return true;
    });
    Add("plane", "plane (origin) lengthU lengthV [--u=(x,y,z)] [--v=(x,y,z)]", [=, this](const CommandLine& C)
    {
        Vec3 O; double LU = 0, LV = 0; if (!Need(C, 3, "plane") || !PointArg(C, 0, O, "plane") || !NumberArg(C, 1, LU, "plane") || !NumberArg(C, 2, LV, "plane")) return false;
        Vec3 U = Plane.AxisX, V = Plane.AxisY;
        if (auto A = C.SwitchText("u")) if (auto W = CommandCodec::ParsePoint(*A)) U = *W;
        if (auto A = C.SwitchText("v")) if (auto W = CommandCodec::ParsePoint(*A)) V = *W;
        return AddSurface(C, "Plane", NurbsSurface::Plane(O, U, V, LU, LV));
    });
    Add("patch", "patch countU countV (p00) (p01) ... row-major [--degree=3]   B-spline patch", [=, this](const CommandLine& C)
    {
        double CU = 0, CV = 0; if (!Need(C, 2, "patch") || !NumberArg(C, 0, CU, "patch") || !NumberArg(C, 1, CV, "patch")) return false;
        std::vector<Vec3> Pts; Vec3 P;
        for (size_t I = 2; I < C.Count(); ++I) { if (!PointArg(C, I, P, "patch")) return false; Pts.push_back(P); }
        int Deg = static_cast<int>(C.SwitchNumber("degree").value_or(3));
        return AddSurface(C, "Patch", NurbsSurface::Patch(std::min(Deg, int(CU) - 1), std::min(Deg, int(CV) - 1), int(CU), int(CV), Pts));
    });

    //---------------------------------------------- derived surfaces ----------------------------------------------
    // What an extrude / revolve operates on: a sketch area (by name "area N" / "aN", or the area a curve bounds when it is
    //    filled), else the bare curve. Filled area → solid with through-holes; unfilled area or open curve → sheet(s).
    struct SweepSource { std::vector<NurbsCurve> Loops; bool Solid = false; std::string Label; RecipeInput Input; };
    auto ResolveSweep = [this](const CommandLine& C, size_t Index, const char* Verb, SweepSource& Out) -> bool
    {
        const std::string& Tok = C.Arguments[Index];
        SketchArea* Area = nullptr;
        if (Tok.size() > 1 && (Tok[0] == 'a' || Tok[0] == 'A') && std::isdigit(static_cast<unsigned char>(Tok[1]))) Area = Scene.FindArea(SceneDocument::AreaIdentityBase + uint32_t(std::atoi(Tok.c_str() + 1)));
        if (!Area && Tok == "area" && Index + 1 < C.Count()) Area = Scene.FindArea(SceneDocument::AreaIdentityBase + uint32_t(std::atoi(C.Arguments[Index + 1].c_str())));
        if (Area)
        {
            Out.Input.Shape = RecipeInput::Form::Area; Out.Input.Figures = Area->BoundingIdentities; Out.Input.Centroid = Area->Centroid;
            Out.Loops = Area->Loops(); Out.Solid = Area->Filled && !C.Switch("sheet");
            Out.Label = "area " + std::to_string(Area->Identity - SceneDocument::AreaIdentityBase) + (Area->Filled ? " (filled)" : " (unfilled)");
            return true;
        }
        // body edge: Name:eN
        if (size_t Colon = Tok.find(":e"); Colon != std::string::npos)
        {
            SceneFigure* Owner = Resolve(Tok.substr(0, Colon)); int E = std::atoi(Tok.c_str() + Colon + 2);
            if (!Owner || Owner->Classification != FigureClassification::Body || E < 0 || E >= int(Owner->Body.Edges.size())) return Refuse("%s: '%s' is not an edge of a body (Name:eN)", Verb, Tok.c_str());
            Out.Input.Shape = RecipeInput::Form::Edge; Out.Input.Figures = { Owner->Identity }; Out.Input.Edge = E;
            Out.Loops = { Owner->Body.Edges[E].Curve }; Out.Solid = false; Out.Label = Tok;
            return true;
        }
        SceneFigure* Figure = Resolve(Tok);
        if (!Figure || Figure->Classification != FigureClassification::Curve) return Refuse("%s: '%s' is neither a curve, an area (a0, a1 … see `areas`) nor an edge (Name:eN)", Verb, Tok.c_str());
        Out.Input.Shape = RecipeInput::Form::Curve; Out.Input.Figures = { Figure->Identity };
        // a closed curve that bounds exactly one filled area whose outer loop is this curve → that area (carries its holes)
        if (Figure->Curve.Closed() && !C.Switch("sheet"))
        {
            for (SketchArea* A : Scene.AreasOf(Figure->Identity))
            {
                double D = 0; (void)A->Cell.Outer.ClosestParameter(Figure->Curve.Sample(0.37 * (Figure->Curve.DomainStart() + Figure->Curve.DomainEnd()) + 0.63 * Figure->Curve.DomainStart()), &D);
                bool SameOuter = D < ScalarCriteria::MergeTolerance && std::fabs(std::fabs(ProfileSolver::SignedArea(Figure->Curve, A->Normal)) - (A->Cell.Area + [&] { double S = 0; for (const NurbsCurve& Hh : A->Cell.Holes) S += std::fabs(ProfileSolver::SignedArea(Hh, A->Normal)); return S; }())) < 1e-6;
                if (!SameOuter) continue;
                Out.Input.Shape = RecipeInput::Form::Area; Out.Input.Figures = A->BoundingIdentities; Out.Input.Centroid = A->Centroid;
                Out.Loops = A->Loops(); Out.Solid = A->Filled;
                Out.Label = Figure->Name + " → area " + std::to_string(A->Identity - SceneDocument::AreaIdentityBase) + (A->Filled ? " (filled, " + std::to_string(A->Cell.Holes.size()) + " hole(s))" : " (unfilled → sheet)");
                return true;
            }
        }
        // closed curve off the workplane (or bounding no area): material by default; unfilled areas were handled above
        Out.Loops = { Figure->Curve }; Out.Solid = Figure->Curve.Closed() && !C.Switch("sheet");
        Out.Label = Figure->Name + (Figure->Curve.Closed() ? (Out.Solid ? " (closed → solid)" : " (closed → sheet)") : " (open → sheet)");
        return true;
    };
    Add("extrude", "extrude <curve | aN> length [--direction=(x,y,z)] [--sheet] — filled area → solid with through-holes; unfilled / open → sheet", [=, this](const CommandLine& C)
    {
        double L = 0; if (!Need(C, 2, "extrude") || !NumberArg(C, C.Count() - 1, L, "extrude")) return false;
        SweepSource S; if (!ResolveSweep(C, 0, "extrude", S)) return false;
        Vec3 Dir = Plane.Normal(); if (auto A = C.SwitchText("direction")) if (auto V = CommandCodec::ParsePoint(*A)) Dir = *V;
        Row("extrude %s", S.Label.c_str());
        FigureRecipe R; R.Operation = RecipeOperation::Extrude; R.Sections = { S.Input }; R.Direction = Dir; R.Length = L; R.Sheet = !S.Solid;
        return AddDerived(C, "Extrusion", R);
    });
    Add("revolve", "revolve <curve> angleDeg [--origin=(x,y,z)] [--axis=(x,y,z)] [--sheet]", [=, this](const CommandLine& C)
    {
        double Angle = 0; if (!Need(C, 2, "revolve") || !NumberArg(C, C.Count() - 1, Angle, "revolve")) return false;
        SweepSource S; if (!ResolveSweep(C, 0, "revolve", S)) return false;
        Vec3 O = Plane.Origin, Axis = Plane.AxisY;
        if (auto A = C.SwitchText("origin")) if (auto V = CommandCodec::ParsePoint(*A)) O = *V;
        if (auto A = C.SwitchText("axis")) if (auto V = CommandCodec::ParsePoint(*A)) Axis = *V;
        Row("revolve %s", S.Label.c_str());
        FigureRecipe R; R.Operation = RecipeOperation::Revolve; R.Sections = { S.Input }; R.AxisOrigin = O; R.Axis = Axis; R.Angle = ScalarCriteria::Radians(Angle); R.Sheet = !S.Solid;
        return AddDerived(C, "Revolution", R);
    });
    //------------------------------------------------ Phase 7: planar profile algebra -------------------------------------------------
    auto ProfileOf = [this](const std::vector<SceneFigure*>& Figures, const char* Verb, Profile& Out) -> bool
    {
        std::vector<NurbsCurve> Loops;
        for (SceneFigure* F : Figures)
        {
            if (F->Classification != FigureClassification::Curve) return Refuse("%s: '%s' is not a curve", Verb, F->Name.c_str());
            if (!F->Curve.Closed()) return Refuse("%s: '%s' is not closed", Verb, F->Name.c_str());
            Loops.push_back(F->Curve);
        }
        if (Loops.empty()) return Refuse("%s: no closed curves", Verb);
        Deliver<Profile> P = ProfileSolver::Assemble(Loops, Plane.Normal());
        if (!P) return Refuse("%s: %s", Verb, P.Denial.Detail);
        Out = std::move(P.Payload);
        return true;
    };
    auto EmitProfile = [this](const CommandLine& C, const char* Stem, const Profile& P, ProfileOperation Op)
    {
        Row("%s → %zu loop(s), area %.6f", Describe(Op), P.Loops.size(), P.Area());
        std::string Stem2 = C.SwitchText("name").value_or(Stem);
        for (size_t I = 0; I < P.Loops.size(); ++I)
        {
            const ProfileLoop& L = P.Loops[I];
            SceneFigure& F = Scene.AddCurve(Stem2, L.Curve);
            Row("  · #%-3u %-18s %s  depth %d  area %+.6f  %s", F.Identity, F.Name.c_str(), L.SignedArea > 0 ? "ccw" : "cw ", L.Depth, L.SignedArea, L.Depth % 2 ? "hole" : "outer");
            F.Selected = true;
        }
    };
    Add("boolean", "boolean union|subtract|intersect <A...> -- <B...> [--keep] [--name=] [--verbose]   ·   bodies: true NURBS surface–surface-intersection boolean; sketch curves: 2D profile boolean (A may hold holes)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "boolean")) return false;
        ProfileOperation Op;
        const std::string& O = C.Arguments[0];
        if (O == "union" || O == "add" || O == "u") Op = ProfileOperation::Union;
        else if (O == "subtract" || O == "cut" || O == "difference" || O == "s") Op = ProfileOperation::Subtract;
        else if (O == "intersect" || O == "common" || O == "i") Op = ProfileOperation::Intersect;
        else return Refuse("boolean: unknown operation '%s' (union | subtract | intersect)", O.c_str());
        std::vector<SceneFigure*> A, B; bool Right = false;
        if (C.Count() == 2 && C.Arguments[1] == "selected") { for (SceneFigure& F : Scene.Figures()) if (F.Selected) A.push_back(&F); }
        else for (size_t I = 1; I < C.Count(); ++I)
        {
            if (C.Arguments[I] == "--") { Right = true; continue; }
            SceneFigure* F = Resolve(C.Arguments[I]); if (!F) return Refuse("no figure '%s'", C.Arguments[I].c_str());
            (Right ? B : A).push_back(F);
        }
        if (!Right && A.size() >= 2) { B.push_back(A.back()); A.pop_back(); }                 // "boolean union A B" shorthand
        if (A.empty() || B.empty()) return Refuse("boolean: need figures on both sides (use -- to separate A from B)");
        bool Bodies = A.front()->Classification == FigureClassification::Body;
        if (Bodies)
        {
            //------------------------------------------------ 3D: SSI boolean of two solids -------------------------------------------------
            if (A.size() != 1 || B.size() != 1 || B.front()->Classification != FigureClassification::Body) return Refuse("boolean: body booleans take exactly one body on each side");
            BodyOperation Op3 = Op == ProfileOperation::Union ? BodyOperation::Union : Op == ProfileOperation::Subtract ? BodyOperation::Subtract : BodyOperation::Intersect;
            std::string NameA = A.front()->Name, NameB = B.front()->Name;
            uint32_t IdA = A.front()->Identity, IdB = B.front()->Identity;
            IntersectionSolver::Verbose = C.Switch("verbose");
            auto T0 = std::chrono::steady_clock::now();
            BooleanReport Rep;
            Deliver<BrepBody> R = IntersectionSolver::Combine(A.front()->Body, B.front()->Body, Op3, &Rep);
            IntersectionSolver::Verbose = false;
            double Seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count();
            if (!R) return Refuse("boolean %s: %s — %s", Describe(Op3), Refusal::Describe(R.Denial.Reason), R.Denial.Detail);
            Row("boolean %s %s %s  ·  %d intersection curve(s), pieces %d + %d, kept %d + %d (inside %d / %d)  ·  %.3f s", Describe(Op3), NameA.c_str(), NameB.c_str(), Rep.Curves, Rep.PiecesA, Rep.PiecesB, Rep.KeptA, Rep.KeptB, Rep.InsideA, Rep.InsideB, Seconds);
            Scene.ClearSelection();
            if (!C.Switch("keep")) { Scene.Remove(IdA); Scene.Remove(IdB); }              // before adding: pointers die with the erase
            const char* Stem = Op3 == BodyOperation::Union ? "Union" : Op3 == BodyOperation::Subtract ? "Difference" : "Common";
            return AddBody(C, Stem, std::move(R));
        }
        //------------------------------------------------ 2D: planar profile boolean -------------------------------------------------
        Profile Pa, Pb; if (!ProfileOf(A, "boolean", Pa) || !ProfileOf(B, "boolean", Pb)) return false;
        std::vector<uint32_t> Consumed; for (SceneFigure* F : A) Consumed.push_back(F->Identity); for (SceneFigure* F : B) Consumed.push_back(F->Identity);
        Deliver<Profile> R = ProfileSolver::Combine(Pa, Pb, Op);
        if (!R) return Refuse("boolean: %s", R.Denial.Detail);
        Scene.ClearSelection();
        if (!C.Switch("keep")) for (uint32_t Id : Consumed) Scene.Remove(Id);              // before adding: pointers die with the erase
        EmitProfile(C, Op == ProfileOperation::Union ? "Union" : Op == ProfileOperation::Subtract ? "Difference" : "Common", R.Payload, Op);
        return true;
    });
    Add("profile", "profile <closed curves...> — signed areas, enclosure depth, winding orientation and combined area", [=, this](const CommandLine& C)
    {
        Profile P; if (!ProfileOf(ResolveMany(C, 0), "profile", P)) return false;
        Row("profile of %zu loop(s): area %.6f  normal (%.2f %.2f %.2f)", P.Loops.size(), P.Area(), P.Normal.X, P.Normal.Y, P.Normal.Z);
        for (const ProfileLoop& L : P.Loops) Row("  %s  depth %d  area %+.6f  %s  length %.4f", L.SignedArea > 0 ? "ccw" : "cw ", L.Depth, L.SignedArea, (L.SignedArea > 0) == (L.Depth % 2 == 0) ? "winding agrees with depth" : "WINDING INVERTED for its depth", L.Curve.Length());
        return true;
    });
    Add("intersections", "intersections <curve> <curve> | <body> <body> [--curves] — exact curve–curve crossings, or SSI curves between two solids (--curves adds them to the scene)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "intersections")) return false;
        SceneFigure* A = Resolve(C.Arguments[0]); SceneFigure* B = Resolve(C.Arguments[1]);
        if (!A || !B) return Refuse("intersections: unknown figure");
        if (A->Classification == FigureClassification::Body && B->Classification == FigureClassification::Body)
        {
            // surface–surface intersection curves become sketch curves in the scene (Plasticity: intersect → curves)
            std::vector<IntersectionCurve> X = IntersectionSolver::Intersect(A->Body, B->Body);
            Row("%zu intersection curve piece(s) between %s and %s", X.size(), A->Name.c_str(), B->Name.c_str());
            std::string NameA = A->Name, NameB = B->Name; int Index = 0;
            for (const IntersectionCurve& K : X)
            {
                Row("  %s:f%d ∩ %s:f%d  %zu points  %s  deviation %.1e  length %.4f", NameA.c_str(), K.FaceA, NameB.c_str(), K.FaceB, K.Points.size(), K.Closed ? "closed" : "open", K.Deviation, K.Curve.Length());
                if (C.Switch("curves") && K.Curve.PoleCount() >= 2) { SceneFigure& F = Scene.AddCurve(std::string("Intersection.") + std::to_string(++Index), K.Curve); F.Selected = true; }
            }
            return true;
        }
        if (A->Classification != FigureClassification::Curve || B->Classification != FigureClassification::Curve) return Refuse("intersections: both must be curves or both bodies");
        std::vector<CurveCrossing> X = A == B ? ProfileSolver::SelfIntersections(A->Curve) : ProfileSolver::Intersect(A->Curve, B->Curve);
        Row("%zu crossing(s) between %s and %s", X.size(), A->Name.c_str(), B->Name.c_str());
        for (const CurveCrossing& K : X) Row("  (%.6f %.6f %.6f)  tA %.6f  tB %.6f%s", K.Point.X, K.Point.Y, K.Point.Z, K.ParameterA, K.ParameterB, K.Tangent ? "  tangent" : "");
        return true;
    });
    Add("fillet", "fillet <curve...> radius [--corners=i,j,…] — round the corners of a polyline / polygon / rectangle (Plasticity B)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "fillet")) return false;
        double R = 0; if (!NumberArg(C, C.Count() - 1, R, "fillet")) return false;
        CommandLine Sub = C; Sub.Arguments.pop_back();
        std::vector<int> Corners; bool Some = false;
        if (auto T = C.SwitchText("corners")) { Some = true; size_t P = 0; while (P < T->size()) { size_t Q = T->find(',', P); Corners.push_back(std::atoi(T->substr(P, Q == std::string::npos ? std::string::npos : Q - P).c_str())); if (Q == std::string::npos) break; P = Q + 1; } }
        int Done = 0;
        for (SceneFigure* F : ResolveMany(Sub, 0))
        {
            if (F->Classification != FigureClassification::Curve) continue;
            Deliver<NurbsCurve> N = ProfileSolver::Filleted(F->Curve, R, Some ? &Corners : nullptr);
            if (!N) { Refuse("fillet %s: %s", F->Name.c_str(), N.Denial.Detail); continue; }
            F->Curve = std::move(N.Payload); DescribeFigure(*F); ++Done;
        }
        return Done > 0;
    });
    Add("chamfer", "chamfer <curve...> setback [--corners=i,j,…] — bevel the corners", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "chamfer")) return false;
        double D = 0; if (!NumberArg(C, C.Count() - 1, D, "chamfer")) return false;
        CommandLine Sub = C; Sub.Arguments.pop_back();
        std::vector<int> Corners; bool Some = false;
        if (auto T = C.SwitchText("corners")) { Some = true; size_t P = 0; while (P < T->size()) { size_t Q = T->find(',', P); Corners.push_back(std::atoi(T->substr(P, Q == std::string::npos ? std::string::npos : Q - P).c_str())); if (Q == std::string::npos) break; P = Q + 1; } }
        int Done = 0;
        for (SceneFigure* F : ResolveMany(Sub, 0))
        {
            if (F->Classification != FigureClassification::Curve) continue;
            Deliver<NurbsCurve> N = ProfileSolver::Chamfered(F->Curve, D, Some ? &Corners : nullptr);
            if (!N) { Refuse("chamfer %s: %s", F->Name.c_str(), N.Denial.Detail); continue; }
            F->Curve = std::move(N.Payload); DescribeFigure(*F); ++Done;
        }
        return Done > 0;
    });
    Add("offset", "offset <curve...> distance [--copy] — parallel curve; + is left of travel (inward for ccw loops), lines and arcs stay exact (Plasticity O)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "offset")) return false;
        double D = 0; if (!NumberArg(C, C.Count() - 1, D, "offset")) return false;
        CommandLine Sub = C; Sub.Arguments.pop_back();
        int Done = 0;
        std::vector<SceneFigure*> Targets = ResolveMany(Sub, 0);
        std::vector<uint32_t> Ids; for (SceneFigure* F : Targets) Ids.push_back(F->Identity);
        for (uint32_t Id : Ids)
        {
            SceneFigure* F = Scene.Find(Id); if (!F || F->Classification != FigureClassification::Curve) continue;
            Deliver<NurbsCurve> N = ProfileSolver::Offset(F->Curve, D, Plane.Normal());
            if (!N) { Refuse("offset %s: %s", F->Name.c_str(), N.Denial.Detail); continue; }
            if (C.Switch("copy")) { SceneFigure& G = Scene.AddCurve(F->Name + ".offset", std::move(N.Payload)); DescribeFigure(G); }
            else { F->Curve = std::move(N.Payload); DescribeFigure(*F); }
            ++Done;
        }
        return Done > 0;
    });
    Add("trim", "trim <curve> (near point) [--by=<cutter,...>] — remove the piece of the curve nearest the point between crossings with the cutters (default: every other curve) (Plasticity T)", [=, this](const CommandLine& C)
    {
        Vec3 Near; if (!Need(C, 2, "trim") || !PointArg(C, 1, Near, "trim")) return false;
        SceneFigure* F = Resolve(C.Arguments[0]); if (!F || F->Classification != FigureClassification::Curve) return Refuse("trim: '%s' is not a curve", C.Arguments[0].c_str());
        std::vector<NurbsCurve> Cutters;
        if (auto T = C.SwitchText("by"))
        {
            size_t P = 0; while (P <= T->size()) { size_t Q = T->find(',', P); std::string Tok = T->substr(P, Q == std::string::npos ? std::string::npos : Q - P); if (SceneFigure* K = Resolve(Tok)) if (K->Classification == FigureClassification::Curve) Cutters.push_back(K->Curve); if (Q == std::string::npos) break; P = Q + 1; }
        }
        else for (SceneFigure& K : Scene.Figures()) if (&K != F && K.Classification == FigureClassification::Curve && !K.Hidden) Cutters.push_back(K.Curve);
        Deliver<std::vector<NurbsCurve>> R = ProfileSolver::Trimmed(F->Curve, Cutters, Near);
        if (!R) return Refuse("trim: %s", R.Denial.Detail);
        std::string Name = F->Name; uint32_t Id = F->Identity; bool Sel = F->Selected;
        Scene.Remove(Id);
        Row("trim %s → %zu piece(s)", Name.c_str(), R.Payload.size());
        for (NurbsCurve& P : R.Payload) { SceneFigure& G = Scene.AddCurve(Name, std::move(P)); G.Selected = Sel; DescribeFigure(G); }
        return true;
    });
    Add("join", "join <curve...> | selected — chain curves that meet end to end into one (Plasticity J)", [=, this](const CommandLine& C)
    {
        std::vector<SceneFigure*> Fs = ResolveMany(C, 0);
        std::vector<NurbsCurve> Pieces; std::vector<uint32_t> Ids; std::string Name;
        for (SceneFigure* F : Fs) if (F->Classification == FigureClassification::Curve) { Pieces.push_back(F->Curve); Ids.push_back(F->Identity); if (Name.empty()) Name = F->Name; }
        if (Pieces.size() < 2) return Refuse("join: need at least two curves");
        Deliver<NurbsCurve> J = ProfileSolver::Joined(std::move(Pieces));
        if (!J) return Refuse("join: %s", J.Denial.Detail);
        for (uint32_t Id : Ids) Scene.Remove(Id);
        SceneFigure& G = Scene.AddCurve(C.SwitchText("name").value_or("Joined"), std::move(J.Payload)); G.Selected = true;
        DescribeFigure(G);
        return true;
    });
    Add("explode", "explode <curve...> | selected — split a curve at its tangent kinks into separate curves (Plasticity Alt+J)", [=, this](const CommandLine& C)
    {
        std::vector<SceneFigure*> Fs = ResolveMany(C, 0);
        std::vector<uint32_t> Ids; for (SceneFigure* F : Fs) if (F->Classification == FigureClassification::Curve) Ids.push_back(F->Identity);
        if (Ids.empty()) return Refuse("explode: no curves");
        for (uint32_t Id : Ids)
        {
            SceneFigure* F = Scene.Find(Id); std::string Name = F->Name; bool Sel = F->Selected;
            std::vector<NurbsCurve> Pieces = SplitAtKinks(F->Curve);
            if (Pieces.size() < 2) { Row("%s has no kinks — left alone", Name.c_str()); continue; }
            Scene.Remove(Id);
            Row("explode %s → %zu piece(s)", Name.c_str(), Pieces.size());
            for (NurbsCurve& P : Pieces) { SceneFigure& G = Scene.AddCurve(Name, std::move(P)); G.Selected = Sel; }
        }
        return true;
    });
    // Sections for loft / sweep / patch: every positional argument is a curve, area (aN), or edge (Body:eN); `selected`
    //    takes the selection in order (areas first, then curves, then selected body edges).
    auto CollectSections = [this, ResolveSweep](const CommandLine& C, size_t First, const char* Verb, std::vector<SweepSource>& Out) -> bool
    {
        if (C.Count() <= First || (C.Count() == First + 1 && C.Arguments[First] == "selected"))
        {
            for (SketchArea& A : Scene.Areas()) if (A.Selected) { SweepSource S; S.Input.Shape = RecipeInput::Form::Area; S.Input.Figures = A.BoundingIdentities; S.Input.Centroid = A.Centroid; S.Loops = A.Loops(); S.Solid = A.Filled; S.Label = "a" + std::to_string(A.Identity - SceneDocument::AreaIdentityBase); Out.push_back(S); }
            for (SceneFigure& F : Scene.Figures())
            {
                if (!F.Selected && F.SelectedEdges.empty()) continue;
                if (F.Classification == FigureClassification::Curve && F.Selected) { SweepSource S; S.Input.Shape = RecipeInput::Form::Curve; S.Input.Figures = { F.Identity }; S.Loops = { F.Curve }; S.Solid = F.Curve.Closed(); S.Label = F.Name; Out.push_back(S); }
                if (F.Classification == FigureClassification::Body) for (int E : F.SelectedEdges) { SweepSource S; S.Input.Shape = RecipeInput::Form::Edge; S.Input.Figures = { F.Identity }; S.Input.Edge = E; S.Loops = { F.Body.Edges[E].Curve }; S.Label = F.Name + ":e" + std::to_string(E); Out.push_back(S); }
            }
            if (Out.empty()) return Refuse("%s: nothing selected", Verb);
            return true;
        }
        for (size_t I = First; I < C.Count(); ++I)
        {
            // "Outer+Hole+Hole2" → one station made of several closed loops (outer first)
            const std::string& Tok = C.Arguments[I];
            if (Tok.find('+') != std::string::npos)
            {
                SweepSource Station; Station.Input.Shape = RecipeInput::Form::Curve; Station.Solid = true;
                size_t Start = 0;
                while (Start <= Tok.size())
                {
                    size_t Plus = Tok.find('+', Start); std::string Name = Tok.substr(Start, Plus == std::string::npos ? std::string::npos : Plus - Start);
                    SceneFigure* F = Resolve(Name);
                    if (!F || F->Classification != FigureClassification::Curve || !F->Curve.Closed()) return Refuse("%s: '%s' in '%s' must be a closed curve", Verb, Name.c_str(), Tok.c_str());
                    Station.Input.Figures.push_back(F->Identity); Station.Loops.push_back(F->Curve);
                    Station.Label += (Station.Label.empty() ? "" : "+") + F->Name;
                    if (Plus == std::string::npos) break;
                    Start = Plus + 1;
                }
                Out.push_back(Station); continue;
            }
            SweepSource S; if (!ResolveSweep(C, I, Verb, S)) return false; Out.push_back(S);
        }
        return true;
    };
    Add("loft", "loft <sections...>|selected [--degree=3] [--loop] [--sheet] [--no-align] — sections are curves, areas (aN), body edges (Body:eN) or Outer+Hole groups in flow order; closed sections → solid (areas with holes → through-holes)", [=, this](const CommandLine& C)
    {
        std::vector<SweepSource> Sections; if (!CollectSections(C, 0, "loft", Sections)) return false;
        if (Sections.size() < 2) return Refuse("loft: at least two sections");
        FigureRecipe R; R.Operation = RecipeOperation::Loft;
        for (const SweepSource& S : Sections) R.Sections.push_back(S.Input);
        R.Loft.DegreeV = int(C.SwitchNumber("degree").value_or(3)); R.Loft.Loop = C.Switch("loop"); R.Loft.AlignSeams = R.Loft.AlignSense = !C.Switch("no-align");
        R.Sheet = C.Switch("sheet");
        std::string Names; for (const SweepSource& S : Sections) Names += " " + S.Label;
        Row("loft%s", Names.c_str());
        return AddDerived(C, "Loft", R);
    });
    Add("sweep", "sweep <profile> <path> [--bases=minimal|frenet|fixed] [--scale=s] [--twist=deg] [--stations=n] [--sheet] — carry a profile (curve / area / edge) along a path curve or edge", [=, this](const CommandLine& C)
    {
        SweepSource P, Path;
        if (C.Count() == 1 && C.Arguments[0] == "selected")
        {
            std::vector<SweepSource> Sel; if (!CollectSections(C, 0, "sweep", Sel)) return false;
            if (Sel.size() != 2) return Refuse("sweep selected: select exactly the profile and then the path (%zu selected)", Sel.size());
            P = Sel[0]; Path = Sel[1];
        }
        else { if (!Need(C, 2, "sweep")) return false; if (!ResolveSweep(C, 0, "sweep", P) || !ResolveSweep(C, 1, "sweep", Path)) return false; }
        FigureRecipe R; R.Operation = RecipeOperation::Sweep; R.Sections = { P.Input }; R.Path = Path.Input; R.Sheet = C.Switch("sheet") || !P.Solid;
        if (auto F = C.SwitchText("bases")) R.Sweep.Bases = *F == "frenet" ? SweepBases::Frenet : *F == "fixed" ? SweepBases::Fixed : SweepBases::RotationMinimising;
        R.Sweep.ScaleEnd = C.SwitchNumber("scale").value_or(1.0); R.Sweep.TwistAngle = ScalarCriteria::Radians(C.SwitchNumber("twist").value_or(0.0)); R.Sweep.Stations = int(C.SwitchNumber("stations").value_or(0));
        Row("sweep %s along %s", P.Label.c_str(), Path.Label.c_str());
        return AddDerived(C, "Sweep", R);
    });
    Add("pipe", "pipe <path> radius [--sheet] — circular tube along a curve or edge", [=, this](const CommandLine& C)
    {
        double Radius = 0; if (!Need(C, 2, "pipe") || !NumberArg(C, 1, Radius, "pipe")) return false;
        SweepSource Path;
        if (C.Arguments[0] == "selected") { std::vector<SweepSource> Sel; if (!CollectSections(CommandLine{ C.Verb, { "selected" }, C.Flags }, 0, "pipe", Sel)) return false; if (Sel.size() != 1) return Refuse("pipe selected: select exactly one path"); Path = Sel[0]; }
        else if (!ResolveSweep(C, 0, "pipe", Path)) return false;
        FigureRecipe R; R.Operation = RecipeOperation::Pipe; R.Path = Path.Input; R.Radius = Radius; R.Sheet = C.Switch("sheet");
        return AddDerived(C, "Pipe", R);
    });
    Add("fillpatch", "fillpatch <boundaries...>|selected — Coons sheet over 3–4 boundary curves / edges, N-sided fill over more, or one closed curve", [=, this](const CommandLine& C)
    {
        std::vector<SweepSource> B; if (!CollectSections(C, 0, "fillpatch", B)) return false;
        FigureRecipe R; R.Operation = RecipeOperation::Patch; for (const SweepSource& S : B) R.Sections.push_back(S.Input);
        return AddDerived(C, "Patch", R);
    });
    Add("fairpatch", "fairpatch <rim[@g0|@g1|@g2][@tN][@fN]...>|selected [--g1|--g2] [--tension=t] [--on=surface] [--guides=a,b] [--star] [--spans=n] [--fairness=f] — energy-fair fill; G1/G2 rims follow the adjacent body face (or --on)", [=, this](const CommandLine& C)
    {
        // rim tokens may carry per-rim suffixes: Body:e3@g2@t0.5 ; the switches give the defaults
        RimContinuity Default = C.Switch("g2") ? RimContinuity::Curvature : C.Switch("g1") ? RimContinuity::Tangent : RimContinuity::Position;
        double DefaultTension = C.SwitchNumber("tension").value_or(1.0);
        uint32_t Support = 0;
        if (auto On = C.SwitchText("on")) { SceneFigure* F = Resolve(*On); if (!F || F->Classification == FigureClassification::Curve) return Refuse("fairpatch: --on needs a surface or body"); Support = F->Identity; }
        CommandLine Bare = C; std::vector<std::pair<std::pair<RimContinuity, double>, int>> PerRim;
        for (std::string& Tok : Bare.Arguments)
        {
            RimContinuity Cont = Default; double Tension = DefaultTension; int Face = -1;
            size_t At;
            while ((At = Tok.rfind('@')) != std::string::npos)
            {
                std::string Tag = Tok.substr(At + 1); Tok.erase(At);
                if (Tag == "g0") Cont = RimContinuity::Position; else if (Tag == "g1") Cont = RimContinuity::Tangent; else if (Tag == "g2") Cont = RimContinuity::Curvature;
                else if (!Tag.empty() && Tag[0] == 't') Tension = std::atof(Tag.c_str() + 1);
                else if (!Tag.empty() && Tag[0] == 'f') Face = std::atoi(Tag.c_str() + 1);
                else return Refuse("fairpatch: unknown rim tag '@%s' (use @g0 @g1 @g2 @t<tension> @f<face>)", Tag.c_str());
            }
            PerRim.push_back({ { Cont, Tension }, Face });
        }
        std::vector<SweepSource> B; if (!CollectSections(Bare, 0, "fairpatch", B)) return false;
        FigureRecipe R; R.Operation = RecipeOperation::FairPatch;
        bool Selected = Bare.Count() == 0 || (Bare.Count() == 1 && Bare.Arguments[0] == "selected");
        for (size_t I = 0; I < B.size(); ++I)
        {
            RecipeInput In = B[I].Input;
            In.Continuity = Selected || I >= PerRim.size() ? Default : PerRim[I].first.first;
            In.Tension = Selected || I >= PerRim.size() ? DefaultTension : PerRim[I].first.second;
            In.Face = Selected || I >= PerRim.size() ? -1 : PerRim[I].second;
            In.Support = In.Shape == RecipeInput::Form::Edge ? 0 : Support;
            if (In.Continuity != RimContinuity::Position && In.Shape != RecipeInput::Form::Edge && !Support) Row("  ⚠ %s: G1/G2 on a curve needs --on=<surface|body>; it will be G0", B[I].Label.c_str());
            R.Sections.push_back(In);
        }
        if (auto G = C.SwitchText("guides"))
        {
            std::string Tok; for (char Ch : *G + ",") { if (Ch == ',') { if (!Tok.empty()) { SceneFigure* F = Resolve(Tok); if (!F || F->Classification != FigureClassification::Curve) return Refuse("fairpatch: guide '%s' is not a curve", Tok.c_str()); RecipeInput In; In.Shape = RecipeInput::Form::Curve; In.Figures = { F->Identity }; R.Guides.push_back(In); } Tok.clear(); } else Tok += Ch; }
        }
        R.Fair.Star = C.Switch("star"); R.Fair.Spans = int(C.SwitchNumber("spans").value_or(10)); R.Fair.Fairness = C.SwitchNumber("fairness").value_or(1.0); R.Fair.Rounds = int(C.SwitchNumber("rounds").value_or(3));
        FairPatchReport Rep;
        Deliver<FigureRecipe::Product> Probe = R.Produce(Scene, Plane, &Rep);
        if (!Probe) return Refuse("FairPatch refused: %s — %s", Refusal::Describe(Probe.Denial.Reason), Probe.Denial.Detail);
        if (!AddDerived(C, "FairPatch", R)) return false;
        Row("  quads %d  unknowns %d  rim break G1 %.3f°  G2 %.4f 1/m  seam break %.3f°  guide deviation %.5f  bending energy %.4f (Coons %.4f)%s",
            Rep.Quads, Rep.Unknowns, ScalarCriteria::Degrees(Rep.TangentBreak), Rep.CurvatureBreak, ScalarCriteria::Degrees(Rep.SeamBreak), Rep.GuideDeviation, Rep.Energy, Rep.CoonsEnergy, Rep.UnsupportedRims ? "  ⚠ unsupported rims fell back to G0" : "");
        return true;
    });
    Add("recipe", "recipe [figure...] — how derived figures are built (sources, options, complaints)  ·  recipe bake <figure...> detaches them", [=, this](const CommandLine& C)
    {
        if (C.Count() >= 1 && C.Arguments[0] == "bake")
        {
            CommandLine Sub = C; Sub.Arguments.erase(Sub.Arguments.begin());
            int N = 0; for (SceneFigure* F : ResolveMany(Sub, 0)) if (F->Recipe.Live()) { F->Recipe = FigureRecipe(); ++N; Row("#%u %s baked — now authored geometry", F->Identity, F->Name.c_str()); }
            if (!N) return Refuse("recipe bake: no derived figures given");
            return true;
        }
        int N = 0;
        auto Show = [&](const SceneFigure& F)
        {
            if (!F.Recipe.Live()) { if (C.Count()) Row("#%u %-14s authored", F.Identity, F.Name.c_str()); return; }
            ++N; Row("#%u %-14s %s", F.Identity, F.Name.c_str(), F.Recipe.Summary(Scene).c_str());
        };
        if (C.Count() == 0) { for (const SceneFigure& F : Scene.Figures()) Show(F); if (!N) Row("no derived figures"); return true; }
        for (SceneFigure* F : ResolveMany(C, 0)) Show(*F);
        return true;
    });
    Add("dependents", "dependents <figure> — derived figures that follow this one", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "dependents")) return false;
        SceneFigure* F = Resolve(C.Arguments[0]); if (!F) return Refuse("no figure '%s'", C.Arguments[0].c_str());
        std::vector<const SceneFigure*> D = Scene.DerivedFrom(F->Identity);
        if (D.empty()) { Row("#%u %s: nothing depends on it", F->Identity, F->Name.c_str()); return true; }
        for (const SceneFigure* G : D) Row("  #%u %s  (%s)", G->Identity, G->Name.c_str(), Describe(G->Recipe.Operation));
        return true;
    });
    Add("ruled", "ruled <curveA> <curveB>", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "ruled")) return false;
        SceneFigure* A = Resolve(C.Arguments[0]); SceneFigure* B = Resolve(C.Arguments[1]);
        if (!A || !B || A->Classification != FigureClassification::Curve || B->Classification != FigureClassification::Curve) return Refuse("ruled: two curves required");
        return AddSurface(C, "Ruled", NurbsSurface::Ruled(A->Curve, B->Curve));
    });

    //---------------------------------------------- scene ----------------------------------------------
    Add("list", "list — every figure with its measurements", [=, this](const CommandLine&)
    {
        if (Scene.Figures().empty()) Row("(empty scene)");
        for (const SceneFigure& I : Scene.Figures()) DescribeFigure(I);
        return true;
    });
    Add("describe", "describe <figure> — poles and knots", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "describe")) return false;
        SceneFigure* Figure = Resolve(C.Arguments[0]); if (!Figure) return Refuse("no figure '%s'", C.Arguments[0].c_str());
        DescribeFigure(*Figure);
        if (Figure->Classification == FigureClassification::Curve)
        {
            const NurbsCurve& K = Figure->Curve;
            std::printf("    knots:"); for (double T : K.Knots) std::printf(" %.4g", T); std::printf("\n");
            for (int I = 0; I < K.PoleCount(); ++I) { Vec3 P = K.Poles[I].Divide(); std::printf("    pole %-3d (%9.4f %9.4f %9.4f)  w %.4f\n", I, P.X, P.Y, P.Z, K.Poles[I].W); }
        }
        else if (Figure->Classification == FigureClassification::Body) return Execute("topology " + C.Arguments[0]);
        else
        {
            const NurbsSurface& S = Figure->Surface;
            std::printf("    knotsU:"); for (double T : S.KnotsU) std::printf(" %.4g", T); std::printf("\n    knotsV:"); for (double T : S.KnotsV) std::printf(" %.4g", T); std::printf("\n");
            for (int I = 0; I < S.CountU; ++I) for (int J = 0; J < S.CountV; ++J) { Vec3 P = S.Pole(I, J).Divide(); std::printf("    pole %2d,%-2d (%9.4f %9.4f %9.4f)  w %.4f\n", I, J, P.X, P.Y, P.Z, S.Pole(I, J).W); }
        }
        return true;
    });
    Add("rename", "rename <figure> <newName>", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "rename")) return false;
        SceneFigure* I = Resolve(C.Arguments[0]); if (!I) return Refuse("no figure '%s'", C.Arguments[0].c_str());
        I->Name = Scene.UniqueName(C.Arguments[1]); DescribeFigure(*I); return true;
    });
    Add("move", "move <figure...> (dx,dy,dz)", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "move")) return false;
        Vec3 D; if (!PointArg(C, C.Count() - 1, D, "move")) return false;
        CommandLine Sub = C; Sub.Arguments.pop_back();
        Mat4 M = Mat4::Translation(D);
        for (SceneFigure* I : ResolveMany(Sub, 0)) { I->Transform(M); DescribeFigure(*I); }
        return true;
    });

    //---------------------------------------------- workplane & view ----------------------------------------------
    Add("workplane", "workplane xy|xz|yz [--origin=(x,y,z)]", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "workplane")) return false;
        const std::string& N = C.Arguments[0];
        if (N == "xy")      Plane = Workplane::XY();
        else if (N == "xz") Plane = Workplane::XZ();
        else if (N == "yz") Plane = Workplane::YZ();
        else return Refuse("workplane: xy, xz or yz");
        if (auto O = C.SwitchText("origin")) if (auto V = CommandCodec::ParsePoint(*O)) Plane.Origin = *V;
        Row("workplane %s origin (%.3f %.3f %.3f) normal (%.0f %.0f %.0f)", N.c_str(), Plane.Origin.X, Plane.Origin.Y, Plane.Origin.Z, Plane.Normal().X, Plane.Normal().Y, Plane.Normal().Z);
        return true;
    });
    Add("view", "view front|back|right|left|top|bottom|iso|persp|ortho  ·  view orbit yawDeg pitchDeg  ·  view fit [selected]  ·  view dolly steps", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "view")) return false;
        const std::string& N = C.Arguments[0];
        double Aspect = double(Surface->Width()) / Surface->Height();
        if (N == "front") View.Look(CanonicalView::Front);
        else if (N == "back") View.Look(CanonicalView::Back);
        else if (N == "right") View.Look(CanonicalView::Right);
        else if (N == "left") View.Look(CanonicalView::Left);
        else if (N == "top") View.Look(CanonicalView::Top);
        else if (N == "bottom") View.Look(CanonicalView::Bottom);
        else if (N == "iso") View.Look(CanonicalView::Isometric);
        else if (N == "persp") View.Orthographic = false;
        else if (N == "toggle") View.Orthographic = !View.Orthographic;
        else if (N == "ortho") View.Orthographic = true;
        else if (N == "orbit") { double Y = 0, P = 0; if (!NumberArg(C, 1, Y, "view") || !NumberArg(C, 2, P, "view")) return false; View.Orbit(ScalarCriteria::Radians(Y), ScalarCriteria::Radians(P)); }
        else if (N == "dolly") { double S = 0; if (!NumberArg(C, 1, S, "view")) return false; View.Dolly(S); }
        else if (N == "fit")
        {
            Box3 B = Scene.Bounds(C.Count() > 1 && C.Arguments[1] == "selected");
            if (B.Empty()) B.Include({ -5, -5, 0 }), B.Include({ 5, 5, 0 });
            View.Fit(B.Inflated(B.Diagonal() * 0.05), Aspect);
        }
        else return Refuse("view: unknown mode '%s'", N.c_str());
        Vec3 E = View.Eye();
        Row("view %s  eye (%.2f %.2f %.2f)  pivot (%.2f %.2f %.2f)  distance %.2f  yaw %.1f° pitch %.1f°  %s",
            N.c_str(), E.X, E.Y, E.Z, View.Pivot.X, View.Pivot.Y, View.Pivot.Z, View.Distance, ScalarCriteria::Degrees(View.Yaw), ScalarCriteria::Degrees(View.Pitch), View.Orthographic ? "ortho" : "persp");
        return true;
    });
    Add("matcap", "matcap <figure...> <name|index>  ·  matcap list — per-figure studio (steel chrome gold copper plastic-white plastic-red plastic-blue clay pearl carbon)", [=, this](const CommandLine& C)
    {
        if (C.Count() == 1 && C.Arguments[0] == "list") { for (int I = 0; I < MatcapCount(); ++I) Row("%d  %s", I, MatcapName(uint8_t(I))); return true; }
        if (C.Count() < 2) return Refuse("matcap: figure and a studio name required");
        const std::string& Name = C.Arguments.back();
        int Layer = -1;
        for (int I = 0; I < MatcapCount(); ++I) if (Name == MatcapName(uint8_t(I))) Layer = I;
        if (Layer < 0) if (auto N = CommandCodec::ParseNumber(Name)) Layer = int(*N);
        if (Layer < 0 || Layer >= MatcapCount()) return Refuse("matcap: unknown studio '%s' (try matcap list)", Name.c_str());
        CommandLine Sub = C; Sub.Arguments.pop_back();
        for (SceneFigure* I : ResolveMany(Sub, 0)) { I->Matcap = uint8_t(Layer); Row("#%u %s → %s", I->Identity, I->Name.c_str(), MatcapName(uint8_t(Layer))); }
        return true;
    });
    Add("tint", "tint <figure...> r g b — body colour 0..1", [=, this](const CommandLine& C)
    {
        if (C.Count() < 4) return Refuse("tint: figure and r g b required");
        double R = C.Number(C.Count() - 3).value_or(-1), G = C.Number(C.Count() - 2).value_or(-1), B = C.Number(C.Count() - 1).value_or(-1);
        if (R < 0 || G < 0 || B < 0) return Refuse("tint: r g b must be numbers 0..1");
        CommandLine Sub = C; Sub.Arguments.resize(C.Count() - 3);
        for (SceneFigure* I : ResolveMany(Sub, 0)) { I->Tint[0] = float(R); I->Tint[1] = float(G); I->Tint[2] = float(B); }
        return true;
    });
    Add("gizmo", "gizmo on|off  ·  gizmo combined|translate|rotate|scale  ·  gizmo size px  ·  gizmo status  ·  gizmo grips", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("gizmo: argument required");
        const std::string& A = C.Arguments[0];
        if (A == "on") GizmoShown = true; else if (A == "off") GizmoShown = false;
        else if (A == "combined") GizmoRig.Arrange(GizmoLayout::Combined); else if (A == "translate") GizmoRig.Arrange(GizmoLayout::Translate);
        else if (A == "rotate") GizmoRig.Arrange(GizmoLayout::Rotate); else if (A == "scale") GizmoRig.Arrange(GizmoLayout::Scale);
        else if (A == "size") { double S; if (!C.Number(1) || (S = *C.Number(1)) < 10) return Refuse("gizmo size: pixels ≥ 10 required"); GizmoRig.Resize(S); }
        else if (A == "grips")
        {
            RefreshGizmoPivot();
            for (int I = int(GizmoGrip::TranslateX); I <= int(GizmoGrip::RotateZ); ++I)
            {
                GizmoGrip H = static_cast<GizmoGrip>(I);
                Vec3 W = GizmoRig.GripAnchor(H, View, Surface->Height());
                double X = 0, Y = 0; bool On = View.WorldToPixel(W, Surface->Width(), Surface->Height(), X, Y);
                GizmoRig.AimAt(View);
                GizmoGrip Locate = On ? GizmoRig.Locate(X, Y, View, Surface->Width(), Surface->Height()) : GizmoGrip::None;
                if (!GizmoRig.Visible(H)) { Row("%-13s hidden (orthographic view along %c)", GizmoGripName(H), "XYZ"[std::clamp(GizmoRig.ViewAxis(), 0, 2)]); continue; }
                Row("%-13s pixel (%4d,%4d)  world (%.3f %.3f %.3f)  inspect → %s", GizmoGripName(H), int(X), int(Y), W.X, W.Y, W.Z, GizmoGripName(Locate));
            }
            return true;
        }
        else if (A != "status") return Refuse("gizmo: on|off|combined|translate|rotate|scale|size|status|grips");
        RefreshGizmoPivot();
        const char* Layouts[] = { "combined", "translate", "rotate", "scale" };
        Vec3 O = GizmoRig.CurrentPivot().Origin;
        const char* Aim[] = { "free", "along X (only YZ-plane move + X rotate)", "along Y (only XZ-plane move + Y rotate)", "along Z (only XY-plane move + Z rotate)" };
        Row("gizmo %s  layout %s  pivot (%.3f %.3f %.3f)  view %s  hover %s%s", GizmoShown ? "on" : "off", Layouts[int(GizmoRig.CurrentLayout())], O.X, O.Y, O.Z,
            Aim[GizmoRig.ViewAxis() + 1], GizmoGripName(GizmoRig.Hovered()), GizmoRig.Dragging() ? "  [dragging]" : "");
        return true;
    });
    RegisterSelection();
    Add("show", "show cages on|off  ·  show iso on|off  ·  show shading flat|plastic|matcap", [=, this](const CommandLine& C)
    {
        if (!Need(C, 2, "show")) return false;
        bool On = C.Arguments[1] == "on";
        if (C.Arguments[0] == "cages") ShowControlCages = On; else if (C.Arguments[0] == "iso") ShowIsoCurves = On;
        else if (C.Arguments[0] == "shading")
        {
            const std::string& M = C.Arguments[1];
            if (M == "flat") Shading = SurfaceShading::Flat; else if (M == "plastic") Shading = SurfaceShading::Plastic; else if (M == "matcap") Shading = SurfaceShading::Matcap;
            else return Refuse("show shading: flat|plastic|matcap");
            Row("shading %s", M.c_str());
        }
        else return Refuse("show: cages|iso|shading");
        return true;
    });
    Add("render", "render <name> [--size=WxH] — writes Proofs/<name>.png", [=, this](const CommandLine& C)
    {
        if (!Need(C, 1, "render")) return false;
        if (auto S = C.SwitchText("size"))
        {
            size_t X = S->find('x');
            if (X != std::string::npos) Surface->Resize(uint32_t(std::atoi(S->substr(0, X).c_str())), uint32_t(std::atoi(S->substr(X + 1).c_str())));
        }
        auto T0 = std::chrono::steady_clock::now();
        Render();
        double Ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - T0).count();
        std::filesystem::create_directories(Proofs);
        std::string Path = (std::filesystem::path(Proofs) / (C.Arguments[0] + ".png")).string();
        if (!WritePng(Path, Surface->Readback())) return Refuse("render: cannot write %s", Path.c_str());
        RasterExchange::Tally T = Surface->QueryTally();
        Row("render %s  %ux%u  %.1f ms  %u tri  %u seg  %u pts  %u frag", Path.c_str(), Surface->Width(), Surface->Height(), Ms, T.Triangles, T.Segments, T.Points, T.Fragments);
        return true;
    });
    Add("pick", "pick x y — identity (and pole) under a pixel of the last render", [=, this](const CommandLine& C)
    {
        double X = 0, Y = 0; if (!Need(C, 2, "pick") || !NumberArg(C, 0, X, "pick") || !NumberArg(C, 1, Y, "pick")) return false;
        uint32_t Pick = Surface->Pick(uint32_t(X), uint32_t(Y));
        uint32_t Id = SceneDocument::IdentityOf(Pick); int Pole = SceneDocument::PoleOf(Pick);
        SceneFigure* Figure = Scene.Find(Id);
        if (Pole >= 0) Row("pixel (%d,%d) → #%u pole %d  depth %.5f", int(X), int(Y), Id, Pole, Surface->Depth(uint32_t(X), uint32_t(Y)));
        else Row("pixel (%d,%d) → %s%s  depth %.5f", int(X), int(Y), Id ? "#" : "nothing", Id ? std::to_string(Id).c_str() : "", Surface->Depth(uint32_t(X), uint32_t(Y)));
        if (Figure) DescribeFigure(*Figure);
        return true;
    });
    Add("echo", "echo text", [=, this](const CommandLine& C) { std::printf("  "); for (const auto& A : C.Arguments) std::printf("%s ", A.c_str()); std::printf("\n"); return true; });
    Add("help", "help [verb]", [=, this](const CommandLine& C)
    {
        if (C.Count() == 1) { auto It = Usage.find(C.Arguments[0]); if (It == Usage.end()) return Refuse("no command '%s'", C.Arguments[0].c_str()); Row("%s", It->second.c_str()); return true; }
        for (const auto& [Verb, Help] : Usage) std::printf("  %-10s %s\n", Verb.c_str(), Help.c_str());
        return true;
    });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  EXECUTION
//------------------------------------------------------------------------------------------------------------------------

bool ConsoleHost::Execute(std::string_view Line) noexcept
{
    std::vector<CommandLine> Batch; std::string Error;
    if (!CommandCodec::Decode(Line, Batch, Error)) return Refuse("syntax: %s", Error.c_str());
    bool Ok = true;
    for (const CommandLine& C : Batch)
    {
        auto It = Commands.find(C.Verb);
        if (It == Commands.end()) { Ok = Refuse("unknown command '%s' (try help)", C.Verb.c_str()); continue; }
        std::printf("> %s", C.Verb.c_str());
        for (const auto& A : C.Arguments) std::printf(" %s", A.c_str());
        for (const auto& F : C.Flags) std::printf(" --%s%s%s", F.first.c_str(), F.second.empty() ? "" : "=", F.second.c_str());
        std::printf("\n");
        // One record entry per command — except a gizmo drag, which is recorded once from the grab to the release.
        const bool Stepper = C.Verb == "undo" || C.Verb == "redo" || C.Verb == "timeline";
        const bool Record = !Recording && !GizmoRig.Dragging() && !Stepper;
        std::string Label = C.Verb; for (const auto& A : C.Arguments) Label += " " + A;
        if (Record) { Recording = true; Undo.Record(Scene, Label); }
        if (Stepper && Recording) Undo.Abandon();                                    // `key ctrl+z` → the wrapper must not record the step
        const bool Done = It->second(C);
        Scene.RebuildAreas(Plane);
        for (const std::string& N : Scene.Regenerate(Plane)) Row("  ↻ %s rebuilt from its sources", N.c_str());
        if (Record)
        {
            Recording = false;
            if (GizmoRig.Dragging()) Undo.Relabel("gizmo drag " + std::string(GizmoGripName(GizmoRig.Drag().Grip)));   // keep pending until release
            else Undo.Settle(Scene);
        }
        if (!Done) Ok = false;
        else if (C.Verb != "repeat" && C.Verb != "render" && C.Verb != "list" && C.Verb != "hud" && C.Verb != "help")
        {
            LastCommand = C.Verb;
            for (const auto& A : C.Arguments) LastCommand += " " + A;
            for (const auto& F : C.Flags) LastCommand += " --" + F.first + (F.second.empty() ? "" : "=" + F.second);
        }
    }
    return Ok;
}

bool ConsoleHost::RunScript(const std::string& Path, bool ContinueOnRefusal) noexcept
{
    std::ifstream In(Path);
    if (!In) return Refuse("cannot open script %s", Path.c_str());
    std::printf("── script %s\n", Path.c_str());
    std::string Line; LineNumber = 0; bool Ok = true;
    while (std::getline(In, Line))
    {
        ++LineNumber;
        if (!Execute(Line))
        {
            std::printf("  (line %d)\n", LineNumber);
            Ok = false;
            if (!ContinueOnRefusal) break;
        }
    }
    std::printf("── %s: %d line(s), %d refusal(s)\n", Path.c_str(), LineNumber, Refusals);
    return Ok;
}

int ConsoleHost::RunInteractive(std::FILE* In) noexcept
{
    std::printf("SolidArc console — type help, quit to exit\n");
    char Line[4096];
    while (std::printf("solidarc> "), std::fflush(stdout), std::fgets(Line, sizeof Line, In))
    {
        std::string_view S(Line);
        while (!S.empty() && (S.back() == '\n' || S.back() == '\r')) S.remove_suffix(1);
        if (S == "quit" || S == "exit") break;
        Execute(S);
    }
    return Refusals == 0 ? 0 : 1;
}

} // namespace Frontier
