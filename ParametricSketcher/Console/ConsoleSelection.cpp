//============================================================================================================================================
// 📦 ParametricSketcher/Console/ConsoleSelection.cpp — Phase 4: pick / box selection, select modes, hide / isolate, undo / redo, duplicate
//============================================================================================================================================
// Selection goes through the pick plane of the raster, exactly what a Vulkan id attachment will give later. Object mode
//    picks whole items; control mode picks poles (their pick id carries the pole index in the high 16 bits). Box selection
//    walks the pick plane inside the rectangle — no separate frustum code to keep in step with the drawing.
#include "ConsoleHost.h"
#include "Presentation/ScenePresentation.h"
#include <algorithm>
#include <set>

namespace Frontier
{

namespace
{
    void ToggleIndex(std::vector<int>& S, int Index, bool On) noexcept
    {
        auto It = std::find(S.begin(), S.end(), Index);
        if (On && It == S.end()) S.push_back(Index);
        if (!On && It != S.end()) S.erase(It);
    }
    void TogglePole(SceneItem& Item, int Pole, bool On) noexcept { ToggleIndex(Item.SelectedPoles, Pole, On); }
}

void ConsoleHost::HoverAtPixel(double X, double Y) noexcept
{
    if (X < 0 || Y < 0 || X >= Surface->Width() || Y >= Surface->Height()) return;
    Render();
    uint32_t Pick = Surface->Pick(uint32_t(X), uint32_t(Y));
    const auto Part = SceneDocument::PartOf(Pick);
    if (Mode == SelectMode::Object || Mode == SelectMode::Face) { if (Part == SceneDocument::PickPart::Pole || Part == SceneDocument::PickPart::Edge) Pick = SceneDocument::PickOf(SceneDocument::IdentityOf(Pick)); }
    if (Mode == SelectMode::Control && Part != SceneDocument::PickPart::Pole) Pick = SceneDocument::PickOf(SceneDocument::IdentityOf(Pick));
    if (Mode == SelectMode::Edge && Part != SceneDocument::PickPart::Edge) Pick = SceneDocument::PickOf(SceneDocument::IdentityOf(Pick));
    if (Pick == HoverPick) return;
    HoverPick = Pick;
    if (SceneItem* I = Scene.Find(SceneDocument::IdentityOf(Pick)))
    {
        int Pole = SceneDocument::PoleOf(Pick), Face = SceneDocument::FaceOf(Pick), Edge = SceneDocument::EdgeOf(Pick);
        if (Pole >= 0) Row("hover #%u %s pole %d", I->Identity, I->Name.c_str(), Pole);
        else if (Face >= 0 && Mode == SelectMode::Face) Row("hover #%u %s face %d", I->Identity, I->Name.c_str(), Face);
        else if (Edge >= 0) Row("hover #%u %s edge %d", I->Identity, I->Name.c_str(), Edge);
        else Row("hover #%u %s", I->Identity, I->Name.c_str());
    }
    else Row("hover nothing");
}

bool ConsoleHost::SelectAtPixel(double X, double Y, bool Toggle) noexcept
{
    Render();
    uint32_t Pick = Surface->Pick(uint32_t(X), uint32_t(Y));
    uint32_t Id = SceneDocument::IdentityOf(Pick); int Pole = SceneDocument::PoleOf(Pick);
    SceneItem* Item = Scene.Find(Id);
    if (!Toggle) Scene.ClearSelection();
    if (!Item) { Row("click (%d,%d): nothing", int(X), int(Y)); return false; }
    if (Mode == SelectMode::Control)
    {
        if (Pole < 0)
        {
            // Clicking a body in control mode selects the item so its cage appears (Blender: enter edit on it).
            Item->Selected = true; Row("click (%d,%d): #%u %s — cage shown, click its poles", int(X), int(Y), Item->Identity, Item->Name.c_str());
            return true;
        }
        const bool On = Toggle ? !Item->PoleSelected(Pole) : true;
        TogglePole(*Item, Pole, On);
        Item->Selected = true;
        Vec3 P = Item->PolePosition(Pole);
        Row("pole %d of #%u %s %s  (%.4f %.4f %.4f)  ·  %d pole(s) selected", Pole, Item->Identity, Item->Name.c_str(), On ? "selected" : "deselected", P.X, P.Y, P.Z, Scene.SelectedPoleCount());
        return true;
    }
    if (Item->Kind == ItemKind::Body && Mode == SelectMode::Face)
    {
        int Face = SceneDocument::FaceOf(Pick);
        if (Face < 0) { Row("click (%d,%d): #%u %s has no face here", int(X), int(Y), Item->Identity, Item->Name.c_str()); return false; }
        const bool On = Toggle ? !Item->FaceSelected(Face) : true;
        ToggleIndex(Item->SelectedFaces, Face, On);
        const BrepFace& F = Item->Body.Faces[Face];
        Row("face %d of #%u %s %s  (%s, %zu loop(s))  ·  %d face(s) selected", Face, Item->Identity, Item->Name.c_str(), On ? "selected" : "deselected", Describe(F.Surface.Classification), F.Loops.size(), Scene.SelectedFaceCount());
        return true;
    }
    if (Item->Kind == ItemKind::Body && Mode == SelectMode::Edge)
    {
        int Edge = SceneDocument::EdgeOf(Pick);
        if (Edge < 0) { Row("click (%d,%d): #%u %s — no edge under the pointer (edges pick within their line width)", int(X), int(Y), Item->Identity, Item->Name.c_str()); return false; }
        const bool On = Toggle ? !Item->EdgeSelected(Edge) : true;
        ToggleIndex(Item->SelectedEdges, Edge, On);
        const BrepEdge& E = Item->Body.Edges[Edge];
        Row("edge %d of #%u %s %s  (%s, length %.4f, %zu face(s))  ·  %d edge(s) selected", Edge, Item->Identity, Item->Name.c_str(), On ? "selected" : "deselected", Describe(E.Curve.Classification), E.Curve.Length(), E.Coedges.size(), Scene.SelectedEdgeCount());
        return true;
    }
    Item->Selected = Toggle ? !Item->Selected : true;
    DescribeItem(*Item);
    Row("%d selected", Scene.SelectedCount());
    return true;
}

int ConsoleHost::SelectInRectangle(double X0, double Y0, double X1, double Y1, bool Toggle, bool Subtract) noexcept
{
    Render();
    if (!Toggle && !Subtract) Scene.ClearSelection();
    const uint32_t Ax = uint32_t(std::clamp(std::min(X0, X1), 0.0, double(Surface->Width() - 1)));
    const uint32_t Bx = uint32_t(std::clamp(std::max(X0, X1), 0.0, double(Surface->Width() - 1)));
    const uint32_t Ay = uint32_t(std::clamp(std::min(Y0, Y1), 0.0, double(Surface->Height() - 1)));
    const uint32_t By = uint32_t(std::clamp(std::max(Y0, Y1), 0.0, double(Surface->Height() - 1)));
    std::set<uint32_t> Picks;
    for (uint32_t Y = Ay; Y <= By; ++Y) for (uint32_t X = Ax; X <= Bx; ++X) { uint32_t P = Surface->Pick(X, Y); if (P) Picks.insert(P); }
    int Changed = 0;
    for (uint32_t P : Picks)
    {
        SceneItem* Item = Scene.Find(SceneDocument::IdentityOf(P)); if (!Item) continue;
        int Pole = SceneDocument::PoleOf(P);
        if (Mode == SelectMode::Control)
        {
            if (Pole < 0) continue;                                                     // box in control mode only takes poles
            TogglePole(*Item, Pole, !Subtract); Item->Selected = true; ++Changed;
        }
        else if (Mode == SelectMode::Face && Item->Kind == ItemKind::Body)
        {
            int Face = SceneDocument::FaceOf(P); if (Face < 0) continue;
            if (Item->FaceSelected(Face) != Subtract) continue;
            ToggleIndex(Item->SelectedFaces, Face, !Subtract); ++Changed;
        }
        else if (Mode == SelectMode::Edge && Item->Kind == ItemKind::Body)
        {
            int Edge = SceneDocument::EdgeOf(P); if (Edge < 0) continue;
            if (Item->EdgeSelected(Edge) != Subtract) continue;
            ToggleIndex(Item->SelectedEdges, Edge, !Subtract); ++Changed;
        }
        else if (Item->Selected == Subtract)
        {
            Item->Selected = !Subtract; ++Changed;
        }
    }
    return Changed;
}

void ConsoleHost::RegisterSelection() noexcept
{
    auto Add = [&](const char* Verb, const char* Help, Command Fn) { Commands[Verb] = std::move(Fn); Usage[Verb] = Help; };
    auto Number = [&](const CommandLine& C, size_t I, double& Out) -> bool { auto N = C.Number(I); if (!N) return false; Out = *N; return true; };

    Add("select", "select <item...> | all | none | invert  ·  select box x0 y0 x1 y1 [--add|--subtract]  ·  select poles|faces|edges <item> <i...>|all|none [--add]", [=, this](const CommandLine& C)
    {
        if (C.Count() == 1 && C.Arguments[0] == "none") { Scene.ClearSelection(); Row("selection cleared"); return true; }
        if (C.Count() == 1 && C.Arguments[0] == "invert")
        {
            if (Mode == SelectMode::Control)
            {
                for (SceneItem& I : Scene.Items())
                {
                    if (!I.Selected) continue;
                    std::vector<int> Inv; for (int P = 0; P < I.PoleCount(); ++P) if (!I.PoleSelected(P)) Inv.push_back(P);
                    I.SelectedPoles = Inv;
                }
            }
            else
            {
                for (SceneItem& I : Scene.Items()) if (!I.Hidden) I.Selected = !I.Selected;
            }
        }
        else if (C.Count() >= 1 && C.Arguments[0] == "box")
        {
            double V[4]; for (int I = 0; I < 4; ++I) if (!Number(C, 1 + I, V[I])) return Refuse("select box: x0 y0 x1 y1 required");
            int N = SelectInRectangle(V[0], V[1], V[2], V[3], C.Flag("add"), C.Flag("subtract"));
            Row("box (%d,%d)-(%d,%d): %d change(s)", int(V[0]), int(V[1]), int(V[2]), int(V[3]), N);
        }
        else if (C.Count() >= 3 && (C.Arguments[0] == "faces" || C.Arguments[0] == "edges"))
        {
            const bool Faces = C.Arguments[0] == "faces";
            SceneItem* I = Resolve(C.Arguments[1]); if (!I) return Refuse("no item '%s'", C.Arguments[1].c_str());
            if (I->Kind != ItemKind::Body) return Refuse("select %s: '%s' is not a body", C.Arguments[0].c_str(), I->Name.c_str());
            std::vector<int>& Target = Faces ? I->SelectedFaces : I->SelectedEdges;
            const int Count = Faces ? int(I->Body.Faces.size()) : int(I->Body.Edges.size());
            if (!C.Flag("add")) for (SceneItem& J : Scene.Items()) { J.SelectedFaces.clear(); J.SelectedEdges.clear(); }
            if (C.Arguments[2] == "all") { Target.clear(); for (int K = 0; K < Count; ++K) Target.push_back(K); }
            else if (C.Arguments[2] == "none") Target.clear();
            else for (size_t K = 2; K < C.Count(); ++K)
            {
                double Ix; if (!Number(C, K, Ix) || Ix < 0 || Ix >= Count) return Refuse("select %s: index %s out of range 0..%d", C.Arguments[0].c_str(), C.Arguments[K].c_str(), Count - 1);
                ToggleIndex(Target, int(Ix), true);
            }
            SelectMode Want = Faces ? SelectMode::Face : SelectMode::Edge;
            if (Mode != Want) { Mode = Want; Row("select mode %s", SelectModeName(Mode)); }
        }
        else if (C.Count() >= 2 && C.Arguments[0] == "poles")
        {
            SceneItem* I = Resolve(C.Arguments[1]); if (!I) return Refuse("no item '%s'", C.Arguments[1].c_str());
            if (!C.Flag("add")) for (SceneItem& J : Scene.Items()) J.SelectedPoles.clear();
            I->Selected = true;
            if (C.Count() == 3 && C.Arguments[2] == "all") { I->SelectedPoles.clear(); for (int P = 0; P < I->PoleCount(); ++P) I->SelectedPoles.push_back(P); }
            else if (C.Count() == 3 && C.Arguments[2] == "none") I->SelectedPoles.clear();
            else for (size_t K = 2; K < C.Count(); ++K)
            {
                double P; if (!Number(C, K, P) || P < 0 || P >= I->PoleCount()) return Refuse("select poles: index %s out of range 0..%d", C.Arguments[K].c_str(), I->PoleCount() - 1);
                TogglePole(*I, int(P), true);
            }
            if (Mode != SelectMode::Control) { Mode = SelectMode::Control; Row("select mode control"); }
        }
        else
        {
            std::vector<SceneItem*> Items = ResolveMany(C, 0); if (Items.empty()) return Refuse("select: nothing matched");
            if (!C.Flag("add")) Scene.ClearSelection();
            for (SceneItem* I : Items) I->Selected = true;
        }
        int N = 0; for (const SceneItem& I : Scene.Items()) if (I.Selected) { ++N; DescribeItem(I); }
        std::string Sub;
        if (Scene.SelectedPoleCount()) Sub += ", " + std::to_string(Scene.SelectedPoleCount()) + " pole(s)";
        if (Scene.SelectedFaceCount()) Sub += ", " + std::to_string(Scene.SelectedFaceCount()) + " face(s)";
        if (Scene.SelectedEdgeCount()) Sub += ", " + std::to_string(Scene.SelectedEdgeCount()) + " edge(s)";
        Row("%d selected%s", N, Sub.c_str());
        return true;
    });
    Add("delete", "delete <item...> | selected  — in control mode nothing is deleted from a NURBS (poles are structural)", [=, this](const CommandLine& C)
    {
        std::vector<uint32_t> Ids; for (SceneItem* I : ResolveMany(C, 0)) Ids.push_back(I->Identity);
        if (Ids.empty()) return Refuse("delete: nothing selected");
        for (uint32_t Id : Ids) Scene.Remove(Id);
        Row("deleted %zu item(s)", Ids.size());
        return true;
    });
    Add("hide", "hide <item...> | selected | unselected", [=, this](const CommandLine& C)
    {
        int N = 0;
        if (C.Count() == 1 && C.Arguments[0] == "unselected") { for (SceneItem& I : Scene.Items()) if (!I.Selected && !I.Hidden) { I.Hidden = true; ++N; } }
        else for (SceneItem* I : ResolveMany(C, 0)) { I->Hidden = true; I->Selected = false; I->SelectedPoles.clear(); ++N; }
        Row("hidden %d item(s)", N);
        return true;
    });
    Add("unhide", "unhide <item...> | all", [=, this](const CommandLine& C)
    {
        int N = 0; for (SceneItem* I : ResolveMany(C, 0)) if (I->Hidden) { I->Hidden = false; ++N; }
        Row("unhidden %d item(s)", N);
        return true;
    });
    Add("isolate", "isolate [item...] — hide everything else (Plasticity: Shift+H)  ·  isolate off", [=, this](const CommandLine& C)
    {
        if (C.Count() == 1 && C.Arguments[0] == "off") { for (SceneItem& I : Scene.Items()) I.Hidden = false; Row("isolate off"); return true; }
        std::vector<SceneItem*> Keep = ResolveMany(C, 0); if (Keep.empty()) return Refuse("isolate: nothing selected");
        for (SceneItem& I : Scene.Items()) I.Hidden = std::find(Keep.begin(), Keep.end(), &I) == Keep.end();
        Row("isolated %zu item(s)", Keep.size());
        return true;
    });
    Add("duplicate", "duplicate [item...] [(dx,dy,dz)] — copy, select the copies (Shift+D)", [=, this](const CommandLine& C)
    {
        Vec3 Offset; bool HasOffset = false;
        CommandLine Sub = C;
        if (C.Count() && C.Arguments.back().front() == '(') { auto P = CommandCodec::ParsePoint(C.Arguments.back()); if (!P) return Refuse("duplicate: bad offset"); Offset = *P; HasOffset = true; Sub.Arguments.pop_back(); }
        std::vector<SceneItem*> Src = ResolveMany(Sub, 0); if (Src.empty()) return Refuse("duplicate: nothing selected");
        std::vector<uint32_t> Ids; for (SceneItem* I : Src) Ids.push_back(I->Identity);
        Scene.ClearSelection();
        for (uint32_t Id : Ids)
        {
            SceneItem Copy = *Scene.Find(Id);
            SceneItem& D = Scene.Duplicate(Copy);
            if (HasOffset) D.Transform(Mat4::Translation(Offset));
            D.Selected = true; DescribeItem(D);
        }
        Row("duplicated %zu item(s)%s", Ids.size(), HasOffset ? "" : " in place — G to move");
        return true;
    });
    Add("mirror", "mirror [item...] x|y|z [--copy] — mirror across the workplane-origin plane normal to that axis (Alt+X)", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("mirror: axis required");
        const std::string Axis = C.Arguments.back();
        if (Axis != "x" && Axis != "y" && Axis != "z") return Refuse("mirror: axis x|y|z");
        CommandLine Sub = C; Sub.Arguments.pop_back();
        std::vector<SceneItem*> Items = ResolveMany(Sub, 0); if (Items.empty()) return Refuse("mirror: nothing selected");
        Vec3 S{ Axis == "x" ? -1.0 : 1.0, Axis == "y" ? -1.0 : 1.0, Axis == "z" ? -1.0 : 1.0 };
        Vec3 O = Plane.Origin;
        Mat4 M = Mat4::Translation(O) * Mat4::Scaling(S) * Mat4::Translation(O * -1.0);
        std::vector<uint32_t> Ids; for (SceneItem* I : Items) Ids.push_back(I->Identity);
        if (C.Flag("copy")) Scene.ClearSelection();
        for (uint32_t Id : Ids)
        {
            SceneItem* Target = Scene.Find(Id);
            if (C.Flag("copy")) { SceneItem Copy = *Target; Target = &Scene.Duplicate(Copy); Target->Selected = true; }
            // A reflection flips orientation: reverse one parametric direction so the outward normal survives.
            if (Target->Kind == ItemKind::Surface) Target->Surface = Target->Surface.Transformed(M).Reversed();
            else Target->Transform(M);                                                  // bodies re-orient inside BrepBody::Transformed
            DescribeItem(*Target);
        }
        Row("mirrored %zu item(s) across %s%s", Ids.size(), Axis.c_str(), C.Flag("copy") ? " (copies)" : "");
        return true;
    });
    Add("undo", "undo [n] — step back (Ctrl+Z)", [=, this](const CommandLine& C)
    {
        double N = 1; (void)Number(C, 0, N);
        int Done = 0; std::string Last;
        for (int I = 0; I < int(N) && Ledger.CanUndo(); ++I) { Last = Ledger.Undo(Scene); ++Done; }
        if (!Done) return Refuse("undo: nothing to undo");
        Row("undo %d → '%s' reverted  ·  %zu undo / %zu redo", Done, Last.c_str(), Ledger.UndoEntries().size(), Ledger.RedoEntries().size());
        return true;
    });
    Add("redo", "redo [n] — step forward (Ctrl+Shift+Z / Ctrl+Y)", [=, this](const CommandLine& C)
    {
        double N = 1; (void)Number(C, 0, N);
        int Done = 0; std::string Last;
        for (int I = 0; I < int(N) && Ledger.CanRedo(); ++I) { Last = Ledger.Redo(Scene); ++Done; }
        if (!Done) return Refuse("redo: nothing to redo");
        Row("redo %d → '%s' reapplied  ·  %zu undo / %zu redo", Done, Last.c_str(), Ledger.UndoEntries().size(), Ledger.RedoEntries().size());
        return true;
    });
    Add("history", "history — list undo / redo entries", [=, this](const CommandLine&)
    {
        size_t K = 0;
        for (const auto& E : Ledger.UndoEntries()) Row("%3zu  %s", ++K, E.Label.c_str());
        Row("── now ── (%zu undo, %zu redo)", Ledger.UndoEntries().size(), Ledger.RedoEntries().size());
        for (auto It = Ledger.RedoEntries().rbegin(); It != Ledger.RedoEntries().rend(); ++It) Row("  ↷  %s", It->Label.c_str());
        return true;
    });
    Add("clear", "clear — empty the scene (undoable)", [=, this](const CommandLine&) { Scene.Clear(); Row("scene cleared"); return true; });
}

} // namespace Frontier
