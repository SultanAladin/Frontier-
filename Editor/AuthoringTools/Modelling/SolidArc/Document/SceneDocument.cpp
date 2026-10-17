//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Document/SceneDocument.cpp — Figure store
//============================================================================================================================================

#include "SceneDocument.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>

namespace Frontier
{


uint64_t SceneFigure::GeometryFingerprint() const noexcept
{
    uint64_t H=1469598103934665603ull;
    auto Put=[&](uint64_t V){H^=V;H*=1099511628211ull;};
    auto Number=[&](double D){uint64_t V;std::memcpy(&V,&D,8);Put(V);};
    auto Point=[&](Vec3 P){Number(P.X);Number(P.Y);Number(P.Z);};
    auto CurveHash=[&](const NurbsCurve& C){Put(C.Degree);Put(C.Poles.size());for(auto P:C.Poles){Number(P.X);Number(P.Y);Number(P.Z);Number(P.W);}Put(C.Knots.size());for(double K:C.Knots)Number(K);};
    Put(uint64_t(Classification));
    if(Classification==FigureClassification::Curve)CurveHash(Curve);
    else if(Classification==FigureClassification::Surface){
        Put(Surface.DegreeU);Put(Surface.DegreeV);Put(Surface.CountU);Put(Surface.CountV);
        for(auto P:Surface.Poles){Number(P.X);Number(P.Y);Number(P.Z);Number(P.W);}for(double K:Surface.KnotsU)Number(K);for(double K:Surface.KnotsV)Number(K);
    }
    else if(Classification==FigureClassification::Body){
        Put(Body.Vertices.size());for(const auto& V:Body.Vertices)Point(V.Point);
        Put(Body.Edges.size());for(const auto& E:Body.Edges){CurveHash(E.Curve);for(int I:E.Coedges)Put(uint64_t(I+1));}
        Put(Body.Coedges.size());for(const auto& C:Body.Coedges){Put(uint64_t(C.Edge+1));Put(C.Reversed);}
        Put(Body.Faces.size());for(const auto& F:Body.Faces){Put(F.Reversed);Put(F.Surface.DegreeU);Put(F.Surface.DegreeV);Put(F.Surface.CountU);Put(F.Surface.CountV);for(auto P:F.Surface.Poles){Number(P.X);Number(P.Y);Number(P.Z);Number(P.W);}for(double K:F.Surface.KnotsU)Number(K);for(double K:F.Surface.KnotsV)Number(K);for(int I:F.Loops)Put(uint64_t(I+1));}
        Put(Body.Loops.size());for(const auto& L:Body.Loops)for(int I:L.Coedges)Put(uint64_t(I+1));
    }
    return H;
}
std::string SceneFigure::BevelEditReason(size_t Index) const
{
    if(Index>=Bevels.size())return "Feature no longer exists.";
    if(Hidden||Locked)return "Show and unlock this object to edit its bevel.";
    if(GeometryFingerprint()!=Bevels.back().AfterFingerprint)return "Geometry changed outside this bevel chain; editing would discard that change.";
    for(size_t I=Index+1;I<Bevels.size();++I)if(Bevels[I].Boundary)return "A later non-bevel edit starts a new chain; this earlier feature is read-only.";
    return {};
}
void SceneFigure::Transform(const Mat4& M) noexcept
{
    const bool Attached=!Bevels.empty()&&GeometryFingerprint()==Bevels.back().AfterFingerprint;
    if(Classification==FigureClassification::Curve)Curve=Curve.Transformed(M);
    else if(Classification==FigureClassification::Surface)Surface=Surface.Transformed(M);
    else Body=Body.Transformed(M);
    if(!Attached)return;
    const Vec3 O=M.TransformPoint({0,0,0});
    const Vec3 X=M.TransformPoint({1,0,0})-O,Y=M.TransformPoint({0,1,0})-O,Z=M.TransformPoint({0,0,1})-O;
    const double Scale=X.Length(),Tol=1e-8*std::max(1.0,Scale*Scale);
    if(Scale<=ScalarCriteria::KernelTolerance||std::fabs(Y.Length()-Scale)>Tol||std::fabs(Z.Length()-Scale)>Tol||std::fabs(X.Dot(Y))>Tol||std::fabs(X.Dot(Z))>Tol||std::fabs(Y.Dot(Z))>Tol)return; // nonuniform transforms explicitly detach
    for(auto& B:Bevels){B.Size*=Scale;B.BeforeCurve=B.BeforeCurve.Transformed(M);B.BeforeBody=B.BeforeBody.Transformed(M);for(auto& Binding:B.Bindings)for(auto& P:Binding.Samples)P=M.TransformPoint(P);}
    Bevels.back().AfterFingerprint=GeometryFingerprint();
}

void SceneDocument::TouchSelection(SceneFigure& Figure) noexcept
{
    uint64_t Last=0;
    for(const auto& Item:Entries)Last=std::max(Last,Item.SelectionOrder);
    Figure.SelectionOrder=Figure.Selected?Last+1:0;
}
std::vector<uint32_t> SceneDocument::OrderedSelection() const
{
    std::vector<const SceneFigure*> Picked;
    for(const auto& Figure:Entries)if(Figure.Selected)Picked.push_back(&Figure);
    std::stable_sort(Picked.begin(),Picked.end(),[](auto* A,auto* B){return A->SelectionOrder<B->SelectionOrder;});
    std::vector<uint32_t> Ids;for(auto* Figure:Picked)Ids.push_back(Figure->Identity);
    return Ids;
}
uint32_t SceneDocument::ActiveSelection() const
{
    const auto Ids=OrderedSelection();return Ids.empty()?0:Ids.back();
}

SceneFigure& SceneDocument::AddCurve(std::string Name, NurbsCurve Curve) noexcept
{
    SceneFigure Figure;
    Figure.Identity = NextIdentity++;
    Figure.Classification = FigureClassification::Curve;
    Figure.Name = UniqueName(Name.empty() ? "Curve" : Name);
    Figure.Curve = std::move(Curve);
    Entries.push_back(std::move(Figure));
    return Entries.back();
}

SceneFigure& SceneDocument::Duplicate(const SceneFigure& Original) noexcept
{
    SceneFigure Figure = Original;
    Figure.Identity = NextIdentity++;
    Figure.Selected = false; Figure.SelectedPoles.clear(); Figure.SelectedFaces.clear(); Figure.SelectedEdges.clear();
    std::string Stem = Original.Name; size_t Dot = Stem.rfind('.'); if (Dot != std::string::npos && Dot + 1 < Stem.size() && std::isdigit(uint8_t(Stem[Dot + 1]))) Stem.resize(Dot);
    Figure.Name = UniqueName(Stem);
    Entries.push_back(std::move(Figure));
    return Entries.back();
}

SceneFigure& SceneDocument::AddBody(std::string Name, BrepBody Body) noexcept
{
    SceneFigure Figure;
    Figure.Identity = NextIdentity++;
    Figure.Classification = FigureClassification::Body;
    Figure.Name = UniqueName(Name.empty() ? "Body" : Name);
    Figure.Body = std::move(Body);
    Entries.push_back(std::move(Figure));
    return Entries.back();
}

SceneFigure& SceneDocument::AddSurface(std::string Name, NurbsSurface Surface) noexcept
{
    SceneFigure Figure;
    Figure.Identity = NextIdentity++;
    Figure.Classification = FigureClassification::Surface;
    Figure.Name = UniqueName(Name.empty() ? "Surface" : Name);
    Figure.Surface = std::move(Surface);
    Entries.push_back(std::move(Figure));
    return Entries.back();
}

bool SceneDocument::Remove(uint32_t Identity) noexcept
{
    auto It = std::find_if(Entries.begin(), Entries.end(), [&](const SceneFigure& I) { return I.Identity == Identity; });
    if (It == Entries.end()) return false;
    Entries.erase(It);
    return true;
}

SceneFigure* SceneDocument::Find(uint32_t Identity) noexcept
{
    for (SceneFigure& I : Entries) if (I.Identity == Identity) return &I;
    return nullptr;
}

SceneFigure* SceneDocument::Find(const std::string& Name) noexcept
{
    for (SceneFigure& I : Entries) if (I.Name == Name) return &I;
    return nullptr;
}

Box3 SceneDocument::Bounds(bool SelectedOnly) const noexcept
{
    Box3 B;
    for (const SceneFigure& I : Entries)
        if (!I.Hidden && (!SelectedOnly || I.Selected)) B.Include(I.Bounds());
    return B;
}

std::string SceneDocument::UniqueName(const std::string& Stem) const noexcept
{
    auto Taken = [&](const std::string& N) { return std::any_of(Entries.begin(), Entries.end(), [&](const SceneFigure& I) { return I.Name == N; }); };
    if (!Taken(Stem)) return Stem;
    for (int K = 2;; ++K)
    {
        std::string Candidate = Stem + "." + std::to_string(K);
        if (!Taken(Candidate)) return Candidate;
    }
}

} // namespace Frontier

//------------------------------------------------------------------------------------------------------------------------
//                                                  SKETCH AREAS
//------------------------------------------------------------------------------------------------------------------------
namespace Frontier
{

void SceneDocument::RebuildAreas(const Workplane& Plane) noexcept
{
    // remember the fills of the current cells before they are thrown away
    for (const SketchArea& A : Cells)
    {
        bool Found = false;
        for (FillChoice& M : Fills) if (M.Centroid.Coincident(A.Centroid, 1e-6) && std::fabs(M.Area - A.Cell.Area) < 1e-9) { M.Filled = A.Filled; Found = true; }
        if (!Found) Fills.push_back({ A.Centroid, A.Cell.Area, A.Filled });
    }
    std::vector<uint32_t> Selected; for (const SketchArea& A : Cells) if (A.Selected) Selected.push_back(A.Identity);
    Cells.clear();
    std::vector<NurbsCurve> Curves; std::vector<uint32_t> Owners;
    Frontier::Plane Sheet = Plane.ToPlane();
    for (const SceneFigure& F : Entries)
    {
        if (F.Classification != FigureClassification::Curve || F.Hidden || F.Construction || F.Feature != FeaturePurpose::None) continue;
        bool InPlane = true;
        for (const Vec4& P : F.Curve.Poles) if (std::fabs(Sheet.SignedDistance(P.Divide())) > ScalarCriteria::MergeTolerance) { InPlane = false; break; }
        if (!InPlane) continue;
        Curves.push_back(F.Curve); Owners.push_back(F.Identity);
    }
    if (Curves.empty()) return;
    std::vector<PlanarCell> Found = ProfileSolver::Cells(Curves, Plane.Normal());
    uint32_t Next = AreaIdentityBase;
    for (PlanarCell& C : Found)
    {
        SketchArea A; A.Identity = Next++; A.Cell = std::move(C); A.Normal = Plane.Normal();
        std::vector<Vec3> Pts; A.Cell.Outer.Tessellate(Pts, nullptr, 1e-3);
        Vec3 Sum; for (const Vec3& P : Pts) Sum = Sum + P; A.Centroid = Sum * (1.0 / double(Pts.size()));
        for (uint32_t S : A.Cell.Origins) A.BoundingIdentities.push_back(Owners[S]);
        for (const FillChoice& M : Fills) if (M.Centroid.Coincident(A.Centroid, 1e-6) && std::fabs(M.Area - A.Cell.Area) < 1e-9) A.Filled = M.Filled;
        for (uint32_t Id : Selected) if (Id == A.Identity) A.Selected = true;
        Cells.push_back(std::move(A));
    }
}

SketchArea* SceneDocument::FindArea(uint32_t Identity) noexcept
{
    for (SketchArea& A : Cells) if (A.Identity == Identity) return &A;
    return nullptr;
}

SketchArea* SceneDocument::AreaAt(Vec3 P) noexcept
{
    SketchArea* Best = nullptr;
    for (SketchArea& A : Cells)
    {
        bool In = ProfileSolver::Winding(A.Cell.Outer, A.Normal, P) != 0;
        for (const NurbsCurve& H : A.Cell.Holes) if (ProfileSolver::Winding(H, A.Normal, P) != 0) In = false;
        if (In && (!Best || A.Cell.Area < Best->Cell.Area)) Best = &A;
    }
    return Best;
}

std::vector<SketchArea*> SceneDocument::AreasOf(uint32_t FigureIdentity) noexcept
{
    std::vector<SketchArea*> Out;
    for (SketchArea& A : Cells) for (uint32_t S : A.BoundingIdentities) if (S == FigureIdentity) { Out.push_back(&A); break; }
    return Out;
}

} // namespace Frontier

//------------------------------------------------------------------------------------------------------------------------
//                                                  DERIVED FIGURES
//------------------------------------------------------------------------------------------------------------------------
namespace Frontier
{

const SketchArea* SceneDocument::FindArea(uint32_t Identity) const noexcept
{
    for (const SketchArea& A : Cells) if (A.Identity == Identity) return &A;
    return nullptr;
}

const SketchArea* SceneDocument::AreaBySignature(Vec3 Centroid) const noexcept
{
    const SketchArea* Best = nullptr; double BestD = 1e-3;
    for (const SketchArea& A : Cells) { double D = A.Centroid.Distance(Centroid); if (D < BestD) { BestD = D; Best = &A; } }
    return Best;
}

std::vector<const SceneFigure*> SceneDocument::DerivedFrom(uint32_t Identity) const noexcept
{
    std::vector<const SceneFigure*> Out;
    for (const SceneFigure& F : Entries)
    {
        if (!F.Recipe.Live()) continue;
        bool Uses = false;
        for (const RecipeInput& In : F.Recipe.Sections) for (uint32_t Id : In.Figures) Uses |= Id == Identity;
        for (uint32_t Id : F.Recipe.Path.Figures) Uses |= Id == Identity;
        for(const auto* Inputs:{&F.Recipe.Guides,&F.Recipe.LoftGuideInputs,&F.Recipe.LoftProfileInputs})for(const auto& In:*Inputs)for(uint32_t Id:In.Figures)Uses|=Id==Identity;
        Uses |= F.Recipe.Path.Support == Identity;
        if (Uses) Out.push_back(&F);
    }
    return Out;
}

std::vector<std::string> SceneDocument::Regenerate(const Workplane& Plane) noexcept
{
    std::vector<std::string> Changed;
    // Recipes may chain (a loft of an edge of an extrusion): iterate until nothing moves, bounded.
    for (int Round = 0; Round < 4; ++Round)
    {
        bool Any = false;
        for (size_t I = 0; I < Entries.size(); ++I)
        {
            SceneFigure& F = Entries[I];
            if (!F.Recipe.Live()) continue;
            uint64_t Now = F.Recipe.FingerprintInputs(*this, Plane);
            if (Now == F.Recipe.InputFingerprint) continue;
            Deliver<FigureRecipe::Product> P = F.Recipe.Produce(*this, Plane);
            F.Recipe.InputFingerprint = Now;
            if (!P)
            {
                F.Recipe.Complaint = P.Denial.Detail;
                if (F.Recipe.Operation == RecipeOperation::SurfaceOffset)
                {
                    F.Recipe.OffsetFailureHidden = F.Recipe.OffsetFailureHidden || !F.Hidden;
                    F.Hidden = true;
                }
                continue;
            }
            if (F.Recipe.OffsetFailureHidden) { F.Hidden = false; F.Recipe.OffsetFailureHidden = false; }
            F.Recipe.Complaint.clear();
            if (P.Payload.IsCurve) { F.Classification = FigureClassification::Curve; F.Curve = std::move(P.Payload.Curve); }
            else if (P.Payload.IsBody) { F.Classification = FigureClassification::Body; F.Body = std::move(P.Payload.Body); F.Surface = NurbsSurface(); }
            else { F.Classification = FigureClassification::Surface; F.Surface = std::move(P.Payload.Sheet); F.Body = BrepBody(); }
            F.SelectedFaces.clear(); F.SelectedEdges.clear(); F.SelectedPoles.clear();
            Changed.push_back(F.Name); Any = true;
        }
        if (!Any) break;
        RebuildAreas(Plane);
    }
    return Changed;
}

} // namespace Frontier
