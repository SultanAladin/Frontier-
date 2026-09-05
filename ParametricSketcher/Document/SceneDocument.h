//============================================================================================================================================
// 📦 ParametricSketcher/Document/SceneDocument.h — Named geometry figure with stable identities (curves and surfaces for now; solids in Phase 6)
//============================================================================================================================================
#pragma once

#include "Kernel/SurfaceSpecification.h"
#include "Kernel/TopologySpecification.h"
#include <string>
#include <vector>

namespace Frontier
{

enum class FigureClassification : uint8_t { Curve, Surface, Body };

enum class SelectMode : uint8_t { Control = 1, Edge = 2, Face = 3, Whole = 4 };           // Plasticity 1/2/3/4
[[nodiscard]] inline const char* SelectModeName(SelectMode M) noexcept { switch (M) { case SelectMode::Control: return "control"; case SelectMode::Edge: return "edge"; case SelectMode::Face: return "face"; default: return "whole"; } }

struct SceneFigure
{
    uint32_t     Identity = 0;                                                          // [-] stable, 1-based, doubles as pick identity
    FigureClassification     Classification = FigureClassification::Curve;                                                // [-]
    std::string  Name;                                                                  // [-] user-facing, unique
    NurbsCurve   Curve;                                                                 // valid when Classification == Curve
    NurbsSurface Surface;                                                               // valid when Classification == Surface
    BrepBody     Body;                                                                  // valid when Classification == Body
    bool         Construction = false;                                                  // [-] drawn dashed, never rendered as solid
    bool         Hidden = false;                                                        // [-]
    bool         Selected = false;                                                      // [-]
    uint8_t      Matcap = 0;                                                            // [-] studio layer (Plasticity: one per whole)
    float        Tint[3] = { 0.62f, 0.66f, 0.72f };                                     // [-] body colour
    std::vector<int> SelectedPoles;                                                     // [-] control-point selection (mode 1), pole indices
    std::vector<int> SelectedFaces;                                                     // [-] face selection (mode 3), body face indices
    std::vector<int> SelectedEdges;                                                     // [-] edge selection (mode 2), body edge indices
    [[nodiscard]] bool FaceSelected(int I) const noexcept { for (int F : SelectedFaces) if (F == I) return true; return false; }
    [[nodiscard]] bool EdgeSelected(int I) const noexcept { for (int E : SelectedEdges) if (E == I) return true; return false; }

    [[nodiscard]] int  PoleCount() const noexcept { return Classification == FigureClassification::Curve ? int(Curve.Poles.size()) : Classification == FigureClassification::Surface ? int(Surface.Poles.size()) : 0; }
    [[nodiscard]] Vec3 PolePosition(int Index) const noexcept { return (Classification == FigureClassification::Curve ? Curve.Poles[Index] : Surface.Poles[Index]).Divide(); }
    void MovePole(int Index, Vec3 P) noexcept
    {
        Vec4& H = Classification == FigureClassification::Curve ? Curve.Poles[Index] : Surface.Poles[Index];
        H.X = P.X * H.W; H.Y = P.Y * H.W; H.Z = P.Z * H.W;
    }
    [[nodiscard]] bool PoleSelected(int Index) const noexcept { for (int I : SelectedPoles) if (I == Index) return true; return false; }

    [[nodiscard]] Box3 Bounds() const noexcept { return Classification == FigureClassification::Curve ? Curve.Bounds() : Classification == FigureClassification::Surface ? Surface.Bounds() : Body.Bounds(); }
    void Transform(const Mat4& M) noexcept
    {
        if (Classification == FigureClassification::Curve) Curve = Curve.Transformed(M); else if (Classification == FigureClassification::Surface) Surface = Surface.Transformed(M); else Body = Body.Transformed(M);
    }
};

class SceneDocument
{
public:
    [[nodiscard]] SceneFigure& AddCurve(std::string Name, NurbsCurve Curve) noexcept;
    [[nodiscard]] SceneFigure& AddSurface(std::string Name, NurbsSurface Surface) noexcept;
    [[nodiscard]] SceneFigure& AddBody(std::string Name, BrepBody Body) noexcept;
    bool Remove(uint32_t Identity) noexcept;
    [[nodiscard]] SceneFigure*       Find(uint32_t Identity) noexcept;
    [[nodiscard]] SceneFigure*       Find(const std::string& Name) noexcept;
    [[nodiscard]] const std::vector<SceneFigure>& Figures() const noexcept { return Entries; }
    [[nodiscard]] std::vector<SceneFigure>&       Figures() noexcept { return Entries; }
    [[nodiscard]] Box3 Bounds(bool SelectedOnly = false) const noexcept;
    [[nodiscard]] std::string UniqueName(const std::string& Stem) const noexcept;
    void Clear() noexcept { Entries.clear(); NextIdentity = 1; }
    [[nodiscard]] int  SelectedCount() const noexcept { int N = 0; for (const SceneFigure& I : Entries) if (I.Selected) ++N; return N; }
    [[nodiscard]] int  SelectedPoleCount() const noexcept { int N = 0; for (const SceneFigure& I : Entries) N += int(I.SelectedPoles.size()); return N; }
    [[nodiscard]] int  SelectedFaceCount() const noexcept { int N = 0; for (const SceneFigure& I : Entries) N += int(I.SelectedFaces.size()); return N; }
    [[nodiscard]] int  SelectedEdgeCount() const noexcept { int N = 0; for (const SceneFigure& I : Entries) N += int(I.SelectedEdges.size()); return N; }
    void ClearSelection() noexcept { for (SceneFigure& I : Entries) { I.Selected = false; I.SelectedPoles.clear(); I.SelectedFaces.clear(); I.SelectedEdges.clear(); } }
    // Pick identities: low 14 bits figure identity, bits 14-15 the part (0 body, 1 pole, 2 face, 3 edge), high 16 bits sub index + 1.
    enum class PickPart : uint8_t { Figure = 0, Pole = 1, Face = 2, Edge = 3 };
    [[nodiscard]] static uint32_t PickOf(uint32_t Identity, int Pole = -1) noexcept { return PickOf(Identity, Pole < 0 ? PickPart::Figure : PickPart::Pole, Pole); }
    [[nodiscard]] static uint32_t PickOf(uint32_t Identity, PickPart Part, int Index) noexcept { return (Identity & 0x3FFFu) | (uint32_t(Part) << 14) | (uint32_t(Index + 1) << 16); }
    [[nodiscard]] static uint32_t IdentityOf(uint32_t Pick) noexcept { return Pick & 0x3FFFu; }
    [[nodiscard]] static PickPart PartOf(uint32_t Pick) noexcept { return static_cast<PickPart>((Pick >> 14) & 3u); }
    [[nodiscard]] static int      SubIndexOf(uint32_t Pick) noexcept { return int(Pick >> 16) - 1; }
    [[nodiscard]] static int      PoleOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Pole ? SubIndexOf(Pick) : -1; }
    [[nodiscard]] static int      FaceOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Face ? SubIndexOf(Pick) : -1; }
    [[nodiscard]] static int      EdgeOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Edge ? SubIndexOf(Pick) : -1; }
    // Duplicate an figure (new identity, unique name); returns the copy.
    [[nodiscard]] SceneFigure& Duplicate(const SceneFigure& Original) noexcept;

private:
    std::vector<SceneFigure> Entries;
    uint32_t NextIdentity = 1;
};

} // namespace Frontier
