//============================================================================================================================================
// 📦 ParametricSketcher/Document/FigureRecipe.cpp — Resolving recipe inputs and rebuilding derived figures
//============================================================================================================================================
#include "FigureRecipe.h"
#include "SceneDocument.h"
#include <cstring>

namespace Frontier
{

const char* Describe(RecipeOperation Operation) noexcept
{
    switch (Operation)
    {
        case RecipeOperation::Extrude: return "extrude";
        case RecipeOperation::Revolve: return "revolve";
        case RecipeOperation::Loft:    return "loft";
        case RecipeOperation::Sweep:   return "sweep";
        case RecipeOperation::Pipe:    return "pipe";
        case RecipeOperation::Patch:   return "patch";
        default:                       return "authored";
    }
}

namespace
{
    inline void Mix(uint64_t& H, uint64_t V) noexcept { H ^= V + 0x9e3779b97f4a7c15ull + (H << 6) + (H >> 2); }
    inline uint64_t Bits(double D) noexcept { uint64_t U; std::memcpy(&U, &D, sizeof U); return U; }
    void MixCurve(uint64_t& H, const NurbsCurve& C) noexcept
    {
        Mix(H, C.Degree); for (const Vec4& P : C.Poles) { Mix(H, Bits(P.X)); Mix(H, Bits(P.Y)); Mix(H, Bits(P.Z)); Mix(H, Bits(P.W)); }
        for (double K : C.Knots) Mix(H, Bits(K));
    }
}

std::string RecipeInput::Label(const SceneDocument& Scene) const noexcept
{
    std::string Out;
    auto NameOf = [&](uint32_t Id)
    {
        for (const SceneFigure& F : Scene.Figures()) if (F.Identity == Id) return F.Name;
        std::string Gone = "#"; Gone += std::to_string(Id); Gone += "(gone)"; return Gone;
    };
    if (Figures.empty()) return "?";
    if (Shape == Form::Curve) { for (size_t I = 0; I < Figures.size(); ++I) { if (I) Out += '+'; Out += NameOf(Figures[I]); } return Out; }
    if (Shape == Form::Edge) { Out = NameOf(Figures.front()); Out += " edge "; Out += std::to_string(Edge); return Out; }
    Out = "area{";
    for (size_t I = 0; I < Figures.size(); ++I) { if (I) Out += ' '; Out += NameOf(Figures[I]); }
    Out += '}';
    return Out;
}

Deliver<std::vector<NurbsCurve>> FigureRecipe::ResolveInput(const RecipeInput& In, const SceneDocument& Scene, const Workplane& Work) noexcept
{
    (void)Work;
    auto Find = [&](uint32_t Id) -> const SceneFigure* { for (const SceneFigure& F : Scene.Figures()) if (F.Identity == Id) return &F; return nullptr; };
    if (In.Shape == RecipeInput::Form::Curve)
    {
        std::vector<NurbsCurve> Loops;                                                  // several figures = outer + holes of one station
        for (uint32_t Id : In.Figures)
        {
            const SceneFigure* F = Find(Id);
            if (!F || F->Classification != FigureClassification::Curve) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::DegenerateInput, "a input curve was deleted");
            Loops.push_back(F->Curve);
        }
        if (Loops.empty()) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::DegenerateInput, "no input curve");
        return Deliver<std::vector<NurbsCurve>>::Accept(std::move(Loops));
    }
    if (In.Shape == RecipeInput::Form::Edge)
    {
        const SceneFigure* F = In.Figures.empty() ? nullptr : Find(In.Figures.front());
        if (!F || F->Classification != FigureClassification::Body || In.Edge < 0 || In.Edge >= int(F->Body.Edges.size())) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::DegenerateInput, "an input edge no longer exists");
        return Deliver<std::vector<NurbsCurve>>::Accept({ F->Body.Edges[In.Edge].Curve });
    }
    // Area: the sketch cell with (nearly) the same centroid, else re-derive from the bounding curves alone.
    if (const SketchArea* A = Scene.AreaBySignature(In.Centroid))
    {
        bool SameCurves = true;
        for (uint32_t Id : In.Figures) { bool Found = false; for (uint32_t B : A->BoundingIdentities) Found |= B == Id; SameCurves &= Found; }
        if (SameCurves) return Deliver<std::vector<NurbsCurve>>::Accept(A->Loops());
    }
    std::vector<NurbsCurve> Curves;
    for (uint32_t Id : In.Figures) { const SceneFigure* F = Find(Id); if (!F || F->Classification != FigureClassification::Curve) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::DegenerateInput, "a bounding curve of the area was deleted"); Curves.push_back(F->Curve); }
    if (Curves.empty()) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::DegenerateInput, "area has no bounding curves");
    Vec3 N = Vec3::UnitZ(); Frontier::Plane Flat; if (Curves.front().Planar(Flat)) N = Flat.Normal;
    std::vector<PlanarCell> Cells = ProfileSolver::Cells(Curves, N);
    if (Cells.empty()) return Deliver<std::vector<NurbsCurve>>::Reject(RefusalReason::OpenWire, "the area's curves no longer close");
    // the cell whose centroid is nearest the remembered one
    size_t Best = 0; double BestD = 1e300;
    for (size_t I = 0; I < Cells.size(); ++I)
    {
        std::vector<Vec3> P; Cells[I].Outer.Tessellate(P, nullptr, 1e-3); Vec3 S; for (const Vec3& Q : P) S = S + Q; S = S * (1.0 / double(std::max<size_t>(1, P.size())));
        double D = S.Distance(In.Centroid); if (D < BestD) { BestD = D; Best = I; }
    }
    return Deliver<std::vector<NurbsCurve>>::Accept(Cells[Best].Loops());
}

uint64_t FigureRecipe::FingerprintInputs(const SceneDocument& Scene, const Workplane& Work) const noexcept
{
    uint64_t H = 1469598103934665603ull;
    Mix(H, uint64_t(Operation));
    auto MixInput = [&](const RecipeInput& In)
    {
        Mix(H, uint64_t(In.Shape)); for (uint32_t Id : In.Figures) Mix(H, Id); Mix(H, uint64_t(In.Edge + 1));
        Deliver<std::vector<NurbsCurve>> R = ResolveInput(In, Scene, Work);
        if (!R) { Mix(H, 0xdeadull); return; }
        for (const NurbsCurve& C : R.Payload) MixCurve(H, C);
    };
    for (const RecipeInput& In : Sections) MixInput(In);
    if (!Path.Figures.empty()) MixInput(Path);
    Mix(H, Bits(Direction.X)); Mix(H, Bits(Direction.Y)); Mix(H, Bits(Direction.Z)); Mix(H, Bits(Length));
    Mix(H, Bits(AxisOrigin.X)); Mix(H, Bits(AxisOrigin.Y)); Mix(H, Bits(AxisOrigin.Z)); Mix(H, Bits(Axis.X)); Mix(H, Bits(Axis.Y)); Mix(H, Bits(Axis.Z)); Mix(H, Bits(Angle));
    Mix(H, Bits(Radius)); Mix(H, Sheet ? 1 : 0);
    Mix(H, Loft.DegreeV); Mix(H, (Loft.Loop ? 1 : 0) | (Loft.AlignSeams ? 2 : 0) | (Loft.AlignSense ? 4 : 0) | (Loft.Solid ? 8 : 0));
    Mix(H, uint64_t(Sweep.Bases)); Mix(H, Sweep.Stations); Mix(H, Bits(Sweep.ScaleEnd)); Mix(H, Bits(Sweep.TwistAngle)); Mix(H, Sweep.Solid ? 1 : 0);
    return H;
}

Deliver<FigureRecipe::Product> FigureRecipe::Produce(const SceneDocument& Scene, const Workplane& Work) const noexcept
{
    using Out = Deliver<Product>;
    std::vector<std::vector<NurbsCurve>> Stations;
    for (const RecipeInput& In : Sections)
    {
        Deliver<std::vector<NurbsCurve>> R = ResolveInput(In, Scene, Work);
        if (!R) return Out::Reject(R.Denial.Reason, R.Denial.Detail);
        Stations.push_back(std::move(R.Payload));
    }
    auto FromSkin = [](Deliver<SkinSolver::Skin> S) -> Out
    {
        if (!S) return Out::Reject(S.Denial.Reason, S.Denial.Detail);
        Product P; P.IsBody = S.Payload.IsBody; P.Body = std::move(S.Payload.Body); P.Sheet = std::move(S.Payload.Sheet);
        return Out::Accept(std::move(P));
    };
    switch (Operation)
    {
        case RecipeOperation::Extrude:
        {
            if (Stations.empty()) return Out::Reject(RefusalReason::DegenerateInput, "nothing to extrude");
            const std::vector<NurbsCurve>& Loops = Stations.front();
            bool Closed = true; for (const NurbsCurve& C : Loops) Closed &= C.Closed();
            if (Sheet || !Closed)
            {
                Deliver<NurbsSurface> S = NurbsSurface::Extrusion(Loops.front(), Direction, Length);
                if (!S) return Out::Reject(S.Denial.Reason, S.Denial.Detail);
                Product P; P.Sheet = std::move(S.Payload); return Out::Accept(std::move(P));
            }
            Deliver<BrepBody> B = BrepBody::Extrude(Loops, Direction, Length);
            if (!B) return Out::Reject(B.Denial.Reason, B.Denial.Detail);
            Product P; P.IsBody = true; P.Body = std::move(B.Payload); return Out::Accept(std::move(P));
        }
        case RecipeOperation::Revolve:
        {
            if (Stations.empty()) return Out::Reject(RefusalReason::DegenerateInput, "nothing to revolve");
            const std::vector<NurbsCurve>& Loops = Stations.front();
            bool Closed = true; for (const NurbsCurve& C : Loops) Closed &= C.Closed();
            if (Sheet || !Closed)
            {
                Deliver<NurbsSurface> S = NurbsSurface::Revolution(Loops.front(), AxisOrigin, Axis, Angle);
                if (!S) return Out::Reject(S.Denial.Reason, S.Denial.Detail);
                Product P; P.Sheet = std::move(S.Payload); return Out::Accept(std::move(P));
            }
            Deliver<BrepBody> B = BrepBody::Revolve(Loops, AxisOrigin, Axis, Angle);
            if (!B) return Out::Reject(B.Denial.Reason, B.Denial.Detail);
            Product P; P.IsBody = true; P.Body = std::move(B.Payload); return Out::Accept(std::move(P));
        }
        case RecipeOperation::Loft:
        {
            LoftOptions L = Loft; if (Sheet) L.Solid = false;
            return FromSkin(SkinSolver::Loft(Stations, L));
        }
        case RecipeOperation::Sweep:
        case RecipeOperation::Pipe:
        {
            Deliver<std::vector<NurbsCurve>> P = ResolveInput(Path, Scene, Work);
            if (!P) return Out::Reject(P.Denial.Reason, P.Denial.Detail);
            SweepOptions S = Sweep; if (Sheet) S.Solid = false;
            if (Operation == RecipeOperation::Pipe) return FromSkin(SkinSolver::Pipe(P.Payload.front(), Radius, S.Solid));
            if (Stations.empty()) return Out::Reject(RefusalReason::DegenerateInput, "sweep has no profile");
            return FromSkin(SkinSolver::Sweep(Stations.front(), P.Payload.front(), S));
        }
        case RecipeOperation::Patch:
        {
            std::vector<NurbsCurve> Boundaries; for (auto& S : Stations) for (NurbsCurve& C : S) Boundaries.push_back(std::move(C));
            return FromSkin(SkinSolver::Patch(std::move(Boundaries)));
        }
        default: return Out::Reject(RefusalReason::DegenerateInput, "figure is authored, not derived");
    }
}

std::string FigureRecipe::Summary(const SceneDocument& Scene) const noexcept
{
    if (!Live()) return "authored";
    std::string S = Describe(Operation);
    if (!Sections.empty()) S += " of";
    for (const RecipeInput& In : Sections) { S += ' '; S += In.Label(Scene); }
    if (!Path.Figures.empty()) { S += " along "; S += Path.Label(Scene); }
    char Extra[160] = {};
    switch (Operation)
    {
        case RecipeOperation::Extrude: std::snprintf(Extra, sizeof Extra, "  length %.4g  direction (%.2f %.2f %.2f)", Length, Direction.X, Direction.Y, Direction.Z); break;
        case RecipeOperation::Revolve: std::snprintf(Extra, sizeof Extra, "  angle %.4g°  axis (%.2f %.2f %.2f)", ScalarCriteria::Degrees(Angle), Axis.X, Axis.Y, Axis.Z); break;
        case RecipeOperation::Loft:    std::snprintf(Extra, sizeof Extra, "  degree %d%s%s", Loft.DegreeV, Loft.Loop ? "  loop" : "", Loft.Solid ? "" : "  sheet"); break;
        case RecipeOperation::Sweep:   std::snprintf(Extra, sizeof Extra, "  bases %s  scale %.3g  twist %.4g°", Sweep.Bases == SweepBases::Frenet ? "frenet" : Sweep.Bases == SweepBases::Fixed ? "fixed" : "minimal", Sweep.ScaleEnd, ScalarCriteria::Degrees(Sweep.TwistAngle)); break;
        case RecipeOperation::Pipe:    std::snprintf(Extra, sizeof Extra, "  radius %.4g", Radius); break;
        default: break;
    }
    S += Extra;
    if (!Complaint.empty()) { S += "  ⚠ "; S += Complaint; }
    return S;
}

} // namespace Frontier
