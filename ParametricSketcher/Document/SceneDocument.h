//============================================================================================================================================
// 📦 ParametricSketcher/Document/SceneDocument.h — Named geometry items with stable identities (curves and surfaces for now; solids in Phase 6)
//============================================================================================================================================
#pragma once

#include "Kernel/SurfaceSpecification.h"
#include "Kernel/TopologySpecification.h"
#include <string>
#include <vector>

namespace Frontier
{

enum class ItemKind : uint8_t { Curve, Surface, Body };

enum class SelectMode : uint8_t { Control = 1, Edge = 2, Face = 3, Object = 4 };          // Plasticity 1/2/3/4; Edge/Face select whole items until the B-rep phase
[[nodiscard]] inline const char* SelectModeName(SelectMode M) noexcept { switch (M) { case SelectMode::Control: return "control"; case SelectMode::Edge: return "edge"; case SelectMode::Face: return "face"; default: return "object"; } }

struct SceneItem
{
    uint32_t     Identity = 0;                                                          // [-] stable, 1-based, doubles as pick identity
    ItemKind     Kind = ItemKind::Curve;                                                // [-]
    std::string  Name;                                                                  // [-] user-facing, unique
    NurbsCurve   Curve;                                                                 // valid when Kind == Curve
    NurbsSurface Surface;                                                               // valid when Kind == Surface
    BrepBody     Body;                                                                  // valid when Kind == Body
    bool         Construction = false;                                                  // [-] drawn dashed, never rendered as solid
    bool         Hidden = false;                                                        // [-]
    bool         Selected = false;                                                      // [-]
    uint8_t      Matcap = 0;                                                            // [-] studio layer (Plasticity: one per object)
    float        Tint[3] = { 0.62f, 0.66f, 0.72f };                                     // [-] base colour
    std::vector<int> SelectedPoles;                                                     // [-] control-point selection (mode 1), pole indices
    std::vector<int> SelectedFaces;                                                     // [-] face selection (mode 3), body face indices
    std::vector<int> SelectedEdges;                                                     // [-] edge selection (mode 2), body edge indices
    [[nodiscard]] bool FaceSelected(int I) const noexcept { for (int F : SelectedFaces) if (F == I) return true; return false; }
    [[nodiscard]] bool EdgeSelected(int I) const noexcept { for (int E : SelectedEdges) if (E == I) return true; return false; }

    [[nodiscard]] int  PoleCount() const noexcept { return Kind == ItemKind::Curve ? int(Curve.Poles.size()) : Kind == ItemKind::Surface ? int(Surface.Poles.size()) : 0; }
    [[nodiscard]] Vec3 PolePosition(int Index) const noexcept { return (Kind == ItemKind::Curve ? Curve.Poles[Index] : Surface.Poles[Index]).Divide(); }
    void SetPolePosition(int Index, Vec3 P) noexcept
    {
        Vec4& H = Kind == ItemKind::Curve ? Curve.Poles[Index] : Surface.Poles[Index];
        H.X = P.X * H.W; H.Y = P.Y * H.W; H.Z = P.Z * H.W;
    }
    [[nodiscard]] bool PoleSelected(int Index) const noexcept { for (int I : SelectedPoles) if (I == Index) return true; return false; }

    [[nodiscard]] Box3 Bounds() const noexcept { return Kind == ItemKind::Curve ? Curve.Bounds() : Kind == ItemKind::Surface ? Surface.Bounds() : Body.Bounds(); }
    void Transform(const Mat4& M) noexcept
    {
        if (Kind == ItemKind::Curve) Curve = Curve.Transformed(M); else if (Kind == ItemKind::Surface) Surface = Surface.Transformed(M); else Body = Body.Transformed(M);
    }
};

class SceneDocument
{
public:
    [[nodiscard]] SceneItem& AddCurve(std::string Name, NurbsCurve Curve) noexcept;
    [[nodiscard]] SceneItem& AddSurface(std::string Name, NurbsSurface Surface) noexcept;
    [[nodiscard]] SceneItem& AddBody(std::string Name, BrepBody Body) noexcept;
    bool Remove(uint32_t Identity) noexcept;
    [[nodiscard]] SceneItem*       Find(uint32_t Identity) noexcept;
    [[nodiscard]] SceneItem*       Find(const std::string& Name) noexcept;
    [[nodiscard]] const std::vector<SceneItem>& Items() const noexcept { return Store; }
    [[nodiscard]] std::vector<SceneItem>&       Items() noexcept { return Store; }
    [[nodiscard]] Box3 Bounds(bool SelectedOnly = false) const noexcept;
    [[nodiscard]] std::string UniqueName(const std::string& Stem) const noexcept;
    void Clear() noexcept { Store.clear(); NextIdentity = 1; }
    [[nodiscard]] int  SelectedCount() const noexcept { int N = 0; for (const SceneItem& I : Store) if (I.Selected) ++N; return N; }
    [[nodiscard]] int  SelectedPoleCount() const noexcept { int N = 0; for (const SceneItem& I : Store) N += int(I.SelectedPoles.size()); return N; }
    [[nodiscard]] int  SelectedFaceCount() const noexcept { int N = 0; for (const SceneItem& I : Store) N += int(I.SelectedFaces.size()); return N; }
    [[nodiscard]] int  SelectedEdgeCount() const noexcept { int N = 0; for (const SceneItem& I : Store) N += int(I.SelectedEdges.size()); return N; }
    void ClearSelection() noexcept { for (SceneItem& I : Store) { I.Selected = false; I.SelectedPoles.clear(); I.SelectedFaces.clear(); I.SelectedEdges.clear(); } }
    // Pick identities: low 14 bits item identity, bits 14-15 the sub-kind (0 body, 1 pole, 2 face, 3 edge), high 16 bits sub index + 1.
    enum class PickPart : uint8_t { Item = 0, Pole = 1, Face = 2, Edge = 3 };
    [[nodiscard]] static uint32_t PickOf(uint32_t Identity, int Pole = -1) noexcept { return PickOf(Identity, Pole < 0 ? PickPart::Item : PickPart::Pole, Pole); }
    [[nodiscard]] static uint32_t PickOf(uint32_t Identity, PickPart Part, int Index) noexcept { return (Identity & 0x3FFFu) | (uint32_t(Part) << 14) | (uint32_t(Index + 1) << 16); }
    [[nodiscard]] static uint32_t IdentityOf(uint32_t Pick) noexcept { return Pick & 0x3FFFu; }
    [[nodiscard]] static PickPart PartOf(uint32_t Pick) noexcept { return static_cast<PickPart>((Pick >> 14) & 3u); }
    [[nodiscard]] static int      SubIndexOf(uint32_t Pick) noexcept { return int(Pick >> 16) - 1; }
    [[nodiscard]] static int      PoleOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Pole ? SubIndexOf(Pick) : -1; }
    [[nodiscard]] static int      FaceOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Face ? SubIndexOf(Pick) : -1; }
    [[nodiscard]] static int      EdgeOf(uint32_t Pick) noexcept { return PartOf(Pick) == PickPart::Edge ? SubIndexOf(Pick) : -1; }
    // Duplicate an item (new identity, unique name); returns the copy.
    [[nodiscard]] SceneItem& Duplicate(const SceneItem& Source) noexcept;

private:
    std::vector<SceneItem> Store;
    uint32_t NextIdentity = 1;
};

} // namespace Frontier
