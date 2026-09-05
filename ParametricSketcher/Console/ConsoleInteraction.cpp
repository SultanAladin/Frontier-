//============================================================================================================================================
// 📦 ParametricSketcher/Console/ConsoleInteraction.cpp — Phase 3 commands: modal tools, synthetic pointer/keys, snapping, hotkeys, HUD
//============================================================================================================================================
// The console is the input device: `pointer x y` moves it, `click` presses, `key g` / `key shift+x` types, `type 3,4`
//    enters numbers — exactly the events a window would send. Everything a tool shows on screen (rubber band, snap
//    glyph, prompt line) is also printed, so a script transcript is a full account of the interaction.

#include "ConsoleHost.h"
#include "Presentation/ScenePresentation.h"
#include <cstring>

namespace Frontier
{

ToolSession::Context ConsoleHost::ToolContext() const noexcept
{
    ToolSession::Context C;
    C.Camera = &View; C.Scene = &Scene; C.Snap = &Snap; C.Plane = Plane;
    C.Width = Surface->Width(); C.Height = Surface->Height();
    Box3 B = Scene.Bounds(true);
    C.SelectionPivot = B.Empty() ? Plane.Origin : B.Centre();
    return C;
}

void ConsoleHost::OnToolOutcome(const ToolOutcome& Outcome) noexcept
{
    if (!Outcome.Completed) { Row("tool: %s", Outcome.Summary.c_str()); if (Outcome.Summary.rfind("refused", 0) == 0) ToolReportedRefusal = true; return; }
    for (const NurbsCurve& C : Outcome.Curves)
    {
        const char* Stem = C.Classification == CurveClassification::Freeform ? (Tool.CurrentKind() == ToolKind::ControlCurve ? "ControlCurve" : "Spline") : Describe(C.Classification);
        SceneItem& Item = Scene.AddCurve(Stem, C);
        DescribeItem(Item);
    }
    if (Outcome.Curves.empty())                                                         // transform
    {
        int N = 0;
        for (SceneItem& I : Scene.Items())
            if (I.Selected) { if (I.Kind == ItemKind::Curve) I.Curve = I.Curve.Transformed(Outcome.Transform); else I.Surface = I.Surface.Transformed(Outcome.Transform); ++N; DescribeItem(I); }
        Row("%s → %d item(s)", Outcome.Summary.c_str(), N);
    }
    else Row("tool: %s", Outcome.Summary.c_str());
}

bool ConsoleHost::Dispatch(const InputEvent& E) noexcept
{
    if (Tool.Active() && Tool.Handle(E))
    {
        if (Tool.Active())
        {
            const ToolPreview& P = Tool.Preview();
            std::string Line = std::string("[") + ToolKindName(Tool.CurrentKind()) + "] " + Tool.CurrentPrompt().Label;
            for (const std::string& R : P.Readout) Line += "  · " + R;
            Row("%s", Line.c_str());
        }
        return true;
    }
    if (E.Action == InputAction::KeyPress)
    {
        if (const HotkeyBinding* B = Hotkeys.Find(E.KeyCode, E.Modifiers))
        {
            Row("%s → %s", DescribeKeyChord(E.KeyCode, E.Modifiers).c_str(), B->Verb.c_str());
            return Execute(B->Verb);
        }
        return Refuse("%s is not bound", DescribeKeyChord(E.KeyCode, E.Modifiers).c_str());
    }
    if (E.Action == InputAction::PointerPress && E.Button == PointerButton::Left)
    {
        // Click-select through the pick buffer of the last render.
        Render();
        uint32_t Id = Surface->Pick(uint32_t(E.PixelX), uint32_t(E.PixelY));
        if (!E.Shift()) for (SceneItem& I : Scene.Items()) I.Selected = false;
        if (SceneItem* Item = Scene.Find(Id)) { Item->Selected = E.Shift() ? !Item->Selected : true; DescribeItem(*Item); }
        else Row("click (%d,%d): nothing", int(E.PixelX), int(E.PixelY));
        return true;
    }
    if (E.Action == InputAction::Wheel) { View.Dolly(E.WheelSteps); return true; }
    return false;
}

void ConsoleHost::DrawToolPreview() noexcept
{
    if (!Tool.Active()) return;
    const ToolPreview& P = Tool.Preview();
    DrawRecord Band = ScenePresentation::Tinted(1.0f, 0.85f, 0.35f); Band.LineWidth = 2.0f;
    for (const NurbsCurve& C : P.Curves) Surface->DrawSegments(ScenePresentation::CurveSegments(C), Band);
    if (!P.Points.empty())
    {
        PointStream Pts; for (Vec3 Q : P.Points) Pts.Append(Q, PointGlyph::Square);
        DrawRecord D = ScenePresentation::Tinted(1.0f, 0.85f, 0.35f); D.PointSize = 7.0f;
        Surface->DrawPoints(Pts, D);
    }
    // Axis-lock guide line through the anchor.
    if (P.Lock != AxisLock::None && !P.Points.empty())
    {
        Vec3 A = P.Points.back();
        Vec3 Dir = P.Lock == AxisLock::X ? Plane.AxisX : P.Lock == AxisLock::Y ? Plane.AxisY : Plane.Normal();
        float Col[3] = { P.Lock == AxisLock::X ? 0.95f : 0.3f, P.Lock == AxisLock::Y ? 0.9f : 0.3f, P.Lock == AxisLock::Z ? 0.95f : 0.3f };
        SegmentStream S; S.Append(A - Dir * 1000.0, A + Dir * 1000.0);
        DrawRecord G = ScenePresentation::Tinted(Col[0], Col[1], Col[2], 0.8f); G.LineWidth = 1.0f; G.Dashed = true;
        Surface->DrawSegments(S, G);
    }
    // Snap glyph: shape says what kind.
    if (P.Snap.Kind != SnapKind::None)
    {
        PointGlyph Glyph = PointGlyph::Cross;
        switch (P.Snap.Kind)
        {
            case SnapKind::Endpoint: case SnapKind::ControlPoint: Glyph = PointGlyph::Square; break;
            case SnapKind::Midpoint: case SnapKind::Quadrant:     Glyph = PointGlyph::Diamond; break;
            case SnapKind::Centre: case SnapKind::Origin:         Glyph = PointGlyph::Ring; break;
            case SnapKind::Intersection:                          Glyph = PointGlyph::Cross; break;
            case SnapKind::OnCurve: case SnapKind::Perpendicular: case SnapKind::Tangent: Glyph = PointGlyph::Disc; break;
            default:                                              Glyph = PointGlyph::Cross; break;
        }
        PointStream S; S.Append(P.Cursor, Glyph);
        bool Strong = P.Snap.Kind != SnapKind::Free && P.Snap.Kind != SnapKind::Grid;
        DrawRecord D = Strong ? ScenePresentation::Tinted(0.35f, 0.90f, 0.95f) : ScenePresentation::Tinted(0.8f, 0.8f, 0.85f, 0.7f);
        D.PointSize = Strong ? 13.0f : 9.0f;
        Surface->DrawPoints(S, D);
    }
}

void ConsoleHost::RegisterInteraction() noexcept
{
    auto Add = [&](const char* Verb, const char* Help, Command Fn) { Commands[Verb] = std::move(Fn); Usage[Verb] = Help; };
    auto Number = [&](const CommandLine& C, size_t I, double& Out) -> bool { auto N = C.Number(I); if (!N) return false; Out = *N; return true; };
    auto Event = [&](InputAction A) { InputEvent E; E.Action = A; E.PixelX = PointerX; E.PixelY = PointerY; return E; };
    auto Modifiers = [&](const CommandLine& C) { uint8_t M = ModifierNone; if (C.Flag("shift")) M |= ModifierShift; if (C.Flag("ctrl")) M |= ModifierCtrl; if (C.Flag("alt")) M |= ModifierAlt; return M; };

    //---------------------------------------------- tools ----------------------------------------------
    Add("tool", "tool <kind> — start a modal tool: line polyline rect centerrect polygon slot circle circle2 circle3 arc arc3 ellipse spline cpcurve move rotate scale  ·  tool cancel", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("tool: kind required");
        if (C.Arguments[0] == "cancel") { Tool.Cancel(); return true; }
        auto K = ParseToolKind(C.Arguments[0]);
        if (!K) return Refuse("tool: unknown kind '%s'", C.Arguments[0].c_str());
        if ((*K == ToolKind::Move || *K == ToolKind::Rotate || *K == ToolKind::Scale) && Scene.Bounds(true).Empty()) return Refuse("tool %s: nothing selected", C.Arguments[0].c_str());
        ToolReportedRefusal = false;
        Tool.Begin(*K, ToolContext(), [this](const ToolOutcome& O) { OnToolOutcome(O); });
        Row("[%s] %s", ToolKindName(*K), Tool.CurrentPrompt().Label.c_str());
        return true;
    });
    Add("point", "point (x,y[,z]) — supply a point to the running tool (planar points lift onto the workplane)", [=, this](const CommandLine& C)
    {
        if (!Tool.Active()) return Refuse("point: no tool running");
        auto P = C.Point(0); if (!P) return Refuse("point: (x,y[,z]) required");
        bool Planar = C.Arguments[0].find(',') == C.Arguments[0].rfind(',');
        Vec3 W = Planar ? Plane.ToWorld({ P->X, P->Y }) : *P;
        ToolReportedRefusal = false;
        if (!Tool.SupplyPoint(W)) return Refuse("point: rejected (coincident with previous?)");
        if (Tool.Active()) { std::string L; for (const std::string& R : Tool.Preview().Readout) L += "  · " + R; Row("[%s] %s%s", ToolKindName(Tool.CurrentKind()), Tool.CurrentPrompt().Label.c_str(), L.c_str()); }
        return !ToolReportedRefusal;
    });
    Add("type", "type <text> — numeric entry: 3 · 2,4 · @1,1 (relative) · r2.5 (radius) · a45 (angle) · a30,2 (polar) · n6 (sides) · d2 (degree) · 3*2", [=, this](const CommandLine& C)
    {
        if (!Tool.Active()) return Refuse("type: no tool running");
        if (C.Count() < 1) return Refuse("type: text required");
        ToolReportedRefusal = false;
        if (!Tool.SupplyText(C.Arguments[0])) return Refuse("type: '%s' not understood here", C.Arguments[0].c_str());
        if (Tool.Active()) { std::string L; for (const std::string& R : Tool.Preview().Readout) L += "  · " + R; Row("[%s] %s%s", ToolKindName(Tool.CurrentKind()), Tool.CurrentPrompt().Label.c_str(), L.c_str()); }
        return !ToolReportedRefusal;
    });
    Add("pointer", "pointer x y [--ctrl] — move the synthetic pointer (pixels, origin top-left); tools snap and preview", [=, this](const CommandLine& C)
    {
        double X, Y; if (!Number(C, 0, X) || !Number(C, 1, Y)) return Refuse("pointer: x y required");
        PointerX = X; PointerY = Y;
        InputEvent E = Event(InputAction::PointerMove); E.Modifiers = Modifiers(C);
        if (!Dispatch(E))
        {
            Vec3 Hit; if (SnapResolution::PlaneHit(X, Y, View, Surface->Width(), Surface->Height(), Plane, Hit)) Row("pointer (%d,%d) → workplane (%.4f %.4f %.4f)", int(X), int(Y), Hit.X, Hit.Y, Hit.Z);
            else Row("pointer (%d,%d) misses the workplane", int(X), int(Y));
        }
        return true;
    });
    Add("click", "click [x y] [--right] [--middle] [--shift] [--ctrl] — press at the pointer (or at x y)", [=, this](const CommandLine& C)
    {
        double X, Y; if (Number(C, 0, X) && Number(C, 1, Y)) { PointerX = X; PointerY = Y; InputEvent M = Event(InputAction::PointerMove); M.Modifiers = Modifiers(C); Dispatch(M); }
        InputEvent E = Event(InputAction::PointerPress);
        E.Button = C.Flag("right") ? PointerButton::Right : C.Flag("middle") ? PointerButton::Middle : PointerButton::Left;
        E.Modifiers = Modifiers(C);
        ToolReportedRefusal = false;
        Dispatch(E);
        return !ToolReportedRefusal;
    });
    Add("key", "key <chord> — press a key: g, shift+x, ctrl+numpad1, enter, esc, tab, up, backspace", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("key: chord required");
        InputEvent E = Event(InputAction::KeyPress);
        if (!ParseKeyChord(C.Arguments[0], E.KeyCode, E.Modifiers)) return Refuse("key: unknown chord '%s'", C.Arguments[0].c_str());
        ToolReportedRefusal = false;
        return Dispatch(E) && !ToolReportedRefusal;
    });
    Add("wheel", "wheel steps — dolly", [=, this](const CommandLine& C)
    {
        double S; if (!Number(C, 0, S)) return Refuse("wheel: steps required");
        InputEvent E = Event(InputAction::Wheel); E.WheelSteps = S; Dispatch(E);
        Row("distance %.3f", View.Distance);
        return true;
    });
    Add("snap", "snap on|off  ·  snap grid|geometry|oncurve|axis|intersections on|off  ·  snap radius px  ·  snap step m  ·  snap status", [=, this](const CommandLine& C)
    {
        if (C.Count() >= 1 && C.Arguments[0] == "status") {}
        else if (C.Count() == 1) { if (C.Arguments[0] != "on" && C.Arguments[0] != "off") return Refuse("snap: on|off"); Snap.Enabled = C.Arguments[0] == "on"; }
        else if (C.Count() >= 2)
        {
            const std::string& K = C.Arguments[0]; bool On = C.Arguments[1] == "on"; double V = C.Number(1).value_or(0.0);
            if (K == "grid") Snap.Grid = On; else if (K == "geometry") Snap.Geometry = On; else if (K == "oncurve") Snap.OnCurve = On;
            else if (K == "axis") Snap.Axis = On; else if (K == "intersections") Snap.Intersections = On;
            else if (K == "radius") Snap.Radius = V; else if (K == "step") Snap.GridStep = V; else if (K == "angle") Snap.AngleStep = ScalarCriteria::Radians(V);
            else return Refuse("snap: unknown setting '%s'", K.c_str());
        }
        Row("snap %s  grid %s (step %.3g)  geometry %s  on-curve %s  axis %s  intersections %s  radius %.0f px",
            Snap.Enabled ? "on" : "off", Snap.Grid ? "on" : "off", Snap.GridStep, Snap.Geometry ? "on" : "off", Snap.OnCurve ? "on" : "off", Snap.Axis ? "on" : "off", Snap.Intersections ? "on" : "off", Snap.Radius);
        return true;
    });
    Add("probe", "probe x y — report what the cursor would snap to at a pixel, without a tool", [=, this](const CommandLine& C)
    {
        double X, Y; if (!Number(C, 0, X) || !Number(C, 1, Y)) return Refuse("probe: x y required");
        SnapCandidate S = SnapResolution::Resolve(X, Y, View, Surface->Width(), Surface->Height(), Plane, Scene, Snap, nullptr);
        Row("probe (%d,%d) → %s at (%.4f %.4f %.4f)%s%u  %.1f px", int(X), int(Y), SnapKindName(S.Kind), S.Position.X, S.Position.Y, S.Position.Z, S.ItemIdentity ? "  #" : "  ", S.ItemIdentity, S.PixelDistance);
        return true;
    });
    Add("bind", "bind <chord> \"command\" — add or replace a hotkey", [=, this](const CommandLine& C)
    {
        if (C.Count() < 2) return Refuse("bind: chord and command required");
        Key K; uint8_t M; if (!ParseKeyChord(C.Arguments[0], K, M)) return Refuse("bind: unknown chord '%s'", C.Arguments[0].c_str());
        Hotkeys.Bind(K, M, C.Arguments[1], "user");
        Row("%s → %s", DescribeKeyChord(K, M).c_str(), C.Arguments[1].c_str());
        return true;
    });
    Add("unbind", "unbind <chord>", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("unbind: chord required");
        Key K; uint8_t M; if (!ParseKeyChord(C.Arguments[0], K, M)) return Refuse("unbind: unknown chord");
        return Hotkeys.Unbind(K, M) ? true : Refuse("unbind: %s was not bound", DescribeKeyChord(K, M).c_str());
    });
    Add("bindings", "bindings [filter] — print the hotkey chart", [=, this](const CommandLine& C)
    {
        std::string Filter = C.Count() ? C.Arguments[0] : "";
        int N = 0;
        for (const HotkeyBinding& B : Hotkeys.Bindings())
        {
            if (!Filter.empty() && B.Verb.find(Filter) == std::string::npos && B.Description.find(Filter) == std::string::npos) continue;
            std::printf("  %-16s %-24s %s\n", DescribeKeyChord(B.KeyCode, B.Modifiers).c_str(), B.Verb.c_str(), B.Description.c_str()); ++N;
        }
        Row("%d binding(s)", N);
        return true;
    });
    Add("repeat", "repeat — run the previous command again (Shift+R)", [=, this](const CommandLine&)
    {
        if (LastCommand.empty()) return Refuse("repeat: nothing to repeat");
        return Execute(LastCommand);
    });
    Add("hud", "hud — print the modal state: tool, prompt, points, lock, snap, readout", [=, this](const CommandLine&)
    {
        if (!Tool.Active()) { Row("no tool running  ·  workplane origin (%.2f %.2f %.2f)  ·  pointer (%d,%d)", Plane.Origin.X, Plane.Origin.Y, Plane.Origin.Z, int(PointerX), int(PointerY)); return true; }
        const ToolPreview& P = Tool.Preview();
        Row("tool %s  prompt %zu/%zu '%s'  lock %s  snap %s", ToolKindName(Tool.CurrentKind()), Tool.CurrentPromptIndex() + 1, (size_t)0 + Tool.CurrentPromptIndex() + 1, Tool.CurrentPrompt().Label.c_str(), AxisLockName(P.Lock), SnapKindName(P.Snap.Kind));
        for (size_t I = 0; I < P.Points.size(); ++I) Row("  point %zu (%.4f %.4f %.4f)", I, P.Points[I].X, P.Points[I].Y, P.Points[I].Z);
        Row("  cursor (%.4f %.4f %.4f)", P.Cursor.X, P.Cursor.Y, P.Cursor.Z);
        for (const std::string& R : P.Readout) Row("  %s", R.c_str());
        return true;
    });
    // "view toggle" for Numpad5 and the show toggles referenced by the chart.
    Add("selectmode", "selectmode control|edge|face|solid|cycle — recorded now, enforced in Phase 4", [=, this](const CommandLine& C)
    {
        Row("select mode %s (Phase 4 enforces it)", C.Count() ? C.Arguments[0].c_str() : "?"); return true;
    });
}

} // namespace Frontier
