//============================================================================================================================================
// 📦 ParametricSketcher/Document/SceneDocument.cpp — Figure store
//============================================================================================================================================

#include "SceneDocument.h"
#include <algorithm>
#include <cctype>

namespace Frontier
{

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
