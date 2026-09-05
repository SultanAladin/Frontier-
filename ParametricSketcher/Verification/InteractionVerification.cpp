//============================================================================================================================================
// 📦 ParametricSketcher/Verification/InteractionVerification.cpp — Phase 3 proofs: numeric entry, axis locks, snapping, hotkeys, tool outcomes
//============================================================================================================================================

#include "Console/ConsoleHost.h"
#include "VerificationPanel.h"

using namespace Frontier;

namespace
{
const SceneItem* Last(ConsoleHost& H) { return H.Document().Items().empty() ? nullptr : &H.Document().Items().back(); }
}

int main()
{
    VerificationPanel Panel("SolidArc · Phase 3 · Interaction Verification — ToolSession · SnapResolution · HotkeyChart · numeric entry");
    ConsoleHost Host("/tmp/SolidArcVerification", 1280, 800);
    Host.Execute("view top; view frame");
    const double PixelsPerMetre = 800.0 / (2.0 * Host.Camera().OrthographicHalfHeight());
    auto Px = [&](double X, double Y) { return std::pair<double, double>{ 640.0 + X * PixelsPerMetre, 400.0 - Y * PixelsPerMetre }; };

    Panel.Section("Numeric entry grammar");
    {
        Host.Execute("tool line; point (0,0); type 4");
        Panel.Within("`4` after a point = 4 m along +X", Last(Host)->Curve.EndPoint().Distance({ 4, 0, 0 }), 1e-12);
        Host.Execute("tool line; point (4,0); type @0,3");
        Panel.Within("`@0,3` = relative offset", Last(Host)->Curve.EndPoint().Distance({ 4, 3, 0 }), 1e-12);
        Host.Execute("tool line; point (4,3); type a180,4");
        Panel.Within("`a180,4` = polar 180°, 4 m", Last(Host)->Curve.EndPoint().Distance({ 0, 3, 0 }), 1e-12);
        Host.Execute("tool line; point (1,1); type 3,5");
        Panel.Within("`3,5` = absolute workplane point", Last(Host)->Curve.EndPoint().Distance({ 3, 5, 0 }), 1e-12);
        Host.Execute("tool line; point (0,0); type 2*3");
        Panel.Equal("`2*3` arithmetic = 6 m", Last(Host)->Curve.Length(), 6.0, 1e-12);
        Host.Execute("tool circle; point (-5,0); type r2");
        Panel.Equal("`r2` radius on a distance prompt", Last(Host)->Curve.Length(), 2.0 * ScalarCriteria::TwoPi, 1e-9);
        Host.Execute("tool polygon; type n8; point (0,-5); type 1");
        Panel.Expect("`n8` sets polygon sides (8 edges → 9 poles)", Last(Host)->Curve.PoleCount() == 9);
        Host.Execute("tool arc; point (5,-4); point (7,-4); type a90");
        Panel.Equal("`a90` arc sweep = quarter circumference", Last(Host)->Curve.Length(), ScalarCriteria::HalfPi * 2.0, 1e-9);
    }

    Panel.Section("Axis / plane locks");
    {
        Host.Execute("tool line; point (6,1); key x; point (9.7,2.9)");
        Panel.Within("X lock projects the end onto the anchor's X line", std::fabs(Last(Host)->Curve.EndPoint().Y - 1.0), 1e-12);
        Panel.Within("… keeping the X component", std::fabs(Last(Host)->Curve.EndPoint().X - 9.7), 1e-12);
        Host.Execute("tool line; point (0,0,0); key y; point (2,3,4)");
        Panel.Within("Y lock", Last(Host)->Curve.EndPoint().Distance({ 0, 3, 0 }), 1e-12);
        Host.Execute("tool line; point (0,0,0); key shift+z; point (2,3,4)");
        Panel.Within("Shift+Z = XY plane lock drops Z", Last(Host)->Curve.EndPoint().Distance({ 2, 3, 0 }), 1e-12);
        Host.Execute("tool line; point (0,0,0); key x; key x; point (2,3,0)");
        Panel.Within("Pressing X twice clears the lock", Last(Host)->Curve.EndPoint().Distance({ 2, 3, 0 }), 1e-12);
    }

    Panel.Section("Cancel / confirm semantics");
    {
        size_t Before = Host.Document().Items().size();
        Host.Execute("tool line; point (0,0); key esc");
        Panel.Expect("Esc cancels without creating geometry", Host.Document().Items().size() == Before);
        Host.Execute("tool polyline; point (0,0); point (1,0); point (1,1); key enter");
        Panel.Expect("Enter finishes an open-ended polyline (3 poles)", Last(Host)->Curve.PoleCount() == 3);
        Host.Execute("tool polyline; point (0,0); point (1,0); click --right");
        Panel.Expect("Right-click confirms an optional prompt", Last(Host)->Curve.PoleCount() == 2);
        Host.Execute("tool spline; point (0,0); point (1,2); point (2,0); point (3,2); key backspace; key enter");
        Panel.Expect("Backspace removes the last point of a repeating prompt", Last(Host)->Curve.Sample(Last(Host)->Curve.DomainEnd()).Distance({ 2, 0, 0 }) < 1e-9);
        Host.Execute("tool circle; point (1,1); point (1,1)");
        Panel.Expect("Coincident second point is refused, tool still running", Host.Document().Items().back().Kind == ItemKind::Curve && Last(Host)->Curve.Classification != CurveClassification::Circle);
        Host.Execute("tool cancel");
    }

    Panel.Section("Snapping through pixels");
    {
        Host.Execute("clear; tool line; point (0,0); type 4; tool line; point (4,0); type @0,3; tool circle; point (-5,0); type r2; tool rect; point (2,-6); point (6,-2)");
        auto Probe = [&](double X, double Y, const Vec3* Anchor = nullptr)
        {
            return SnapResolution::Resolve(X, Y, Host.Camera(), 1280, 800, Workplane::XY(), Host.Document(), SnapSettings{}, Anchor);
        };
        auto [Ex, Ey] = Px(4.0, 0.0);
        SnapCandidate S = Probe(Ex + 5, Ey + 4);
        Panel.Expect("5 px off a shared endpoint → intersection/endpoint at (4,0)", (S.Kind == SnapKind::Intersection || S.Kind == SnapKind::Endpoint) && S.Position.Distance({ 4, 0, 0 }) < 1e-9);
        auto [Mx, My] = Px(2.0, 0.0);
        S = Probe(Mx + 3, My - 2);
        Panel.Expect("Midpoint of the 4 m line", S.Kind == SnapKind::Midpoint && S.Position.Distance({ 2, 0, 0 }) < 1e-9);
        auto [Cx, Cy] = Px(-5.0, 0.0);
        S = Probe(Cx - 4, Cy + 6);
        Panel.Expect("Circle centre", S.Kind == SnapKind::Centre && S.Position.Distance({ -5, 0, 0 }) < 1e-9);
        auto [Qx, Qy] = Px(-5.0, 2.0);
        S = Probe(Qx + 2, Qy + 3);
        Panel.Expect("Circle quadrant (top)", S.Kind == SnapKind::Quadrant && S.Position.Distance({ -5, 2, 0 }) < 1e-6);
        auto [Ox, Oy] = Px(-5.0 + 2.0 * std::cos(0.7), 2.0 * std::sin(0.7));
        S = Probe(Ox + 3, Oy);
        Panel.Expect("Off the special points: on-curve snap lands on the circle", S.Kind == SnapKind::OnCurve && std::fabs(S.Position.Distance({ -5, 0, 0 }) - 2.0) < 1e-9);
        auto [Gx, Gy] = Px(0.93, 1.9);
        S = Probe(Gx, Gy);
        Panel.Expect("Empty space → grid (1,2)", S.Kind == SnapKind::Grid && S.Position.Distance({ 1, 2, 0 }) < 1e-9);
        Vec3 Anchor{ 0, 3, 0 };
        auto [Ax, Ay] = Px(3.0, 3.05);
        S = Probe(Ax, Ay, &Anchor);
        Panel.Expect("Axis-aligned with the anchor → axis-x snap keeps Y = 3", S.Kind == SnapKind::AxisX && std::fabs(S.Position.Y - 3.0) < 1e-9);
        auto [Rx, Ry] = Px(2.0, -2.0);
        S = Probe(Rx + 6, Ry + 6);
        Panel.Expect("Rectangle corner = polyline vertex endpoint", S.Kind == SnapKind::Endpoint && S.Position.Distance({ 2, -2, 0 }) < 1e-9);
        SnapSettings Off; Off.Enabled = false;
        S = SnapResolution::Resolve(Ex + 5, Ey + 4, Host.Camera(), 1280, 800, Workplane::XY(), Host.Document(), Off, nullptr);
        Panel.Expect("Snapping disabled (Ctrl) → free workplane hit", S.Kind == SnapKind::Free && S.Position.Distance({ 4, 0, 0 }) > 0.01);
    }

    Panel.Section("Pointer-driven tool with snap");
    {
        auto [Sx, Sy] = Px(4.0, 3.0);
        char Cmd[256];
        std::snprintf(Cmd, sizeof Cmd, "tool line; pointer %.0f %.0f; click; type @2,0", Sx + 4, Sy - 5);
        Host.Execute(Cmd);
        Panel.Within("Start snapped exactly to the endpoint despite a 6 px miss", Last(Host)->Curve.StartPoint().Distance({ 4, 3, 0 }), 1e-9);
        Panel.Within("Typed relative end", Last(Host)->Curve.EndPoint().Distance({ 6, 3, 0 }), 1e-9);
    }

    Panel.Section("Hotkeys and transforms");
    {
        Host.Execute("select none; select Line; key g; key x; type 12");
        Panel.Within("G X 12 moves the selection 12 m along X", Host.Document().Find(std::string("Line"))->Curve.StartPoint().Distance({ 12, 0, 0 }), 1e-9);
        Host.Execute("key r; type 90");
        Vec3 E = Host.Document().Find(std::string("Line"))->Curve.EndPoint(), St = Host.Document().Find(std::string("Line"))->Curve.StartPoint();
        Panel.Within("R 90 rotates about the selection pivot: the line is now vertical", std::fabs(E.X - St.X), 1e-9);
        Host.Execute("key s; type 0.5");
        Panel.Equal("S 0.5 halves the length", Host.Document().Find(std::string("Line"))->Curve.Length(), 2.0, 1e-9);
        Host.Execute("key numpad1");
        Panel.Within("Numpad1 = front view", Host.Camera().Forward().Distance(Vec3::UnitY()), 1e-9);
        Host.Execute("key ctrl+numpad7");
        Panel.Within("Ctrl+Numpad7 = bottom view", Host.Camera().Forward().Distance(Vec3::UnitZ()), 1e-3);
        Host.Execute("bind ctrl+shift+q \"echo bound\"");
        int Before = Host.RefusalCount();
        Host.Execute("key ctrl+shift+q");
        Panel.Expect("User binding dispatches", Host.RefusalCount() == Before);
        Host.Execute("key f12");
        Panel.Expect("Unbound key is reported as a refusal", Host.RefusalCount() == Before + 1);
        Key K; uint8_t M;
        Panel.Expect("ParseKeyChord ctrl+alt+numpad+", ParseKeyChord("ctrl+alt+numpad+", K, M) && K == Key::NumpadPlus && M == (ModifierCtrl | ModifierAlt));
        Panel.Expect("ParseKeyChord shift+space", ParseKeyChord("shift+space", K, M) && K == Key::Space && M == ModifierShift);
    }

    return Panel.Conclude();
}
