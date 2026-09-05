//============================================================================================================================================
// 📦 ParametricSketcher/Interaction/ToolSession.cpp — Prompt lists, numeric entry grammar, preview construction
//============================================================================================================================================

#include "ToolSession.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace Frontier
{

namespace
{
constexpr double NoScalar = std::numeric_limits<double>::quiet_NaN();
bool Has(double S) noexcept { return !std::isnan(S); }
using Want = ToolPrompt::Want;
}

const char* ToolKindName(ToolKind Kind) noexcept
{
    switch (Kind)
    {
        case ToolKind::None:             return "none";
        case ToolKind::Line:             return "line";
        case ToolKind::Polyline:         return "polyline";
        case ToolKind::Rectangle:        return "rect";
        case ToolKind::CentreRectangle:  return "centerrect";
        case ToolKind::Polygon:          return "polygon";
        case ToolKind::Slot:             return "slot";
        case ToolKind::Circle:           return "circle";
        case ToolKind::TwoPointCircle:   return "circle2";
        case ToolKind::ThreePointCircle: return "circle3";
        case ToolKind::Arc:              return "arc";
        case ToolKind::ThreePointArc:    return "arc3";
        case ToolKind::Ellipse:          return "ellipse";
        case ToolKind::Spline:           return "spline";
        case ToolKind::ControlCurve:     return "cpcurve";
        case ToolKind::Move:             return "move";
        case ToolKind::Rotate:           return "rotate";
        case ToolKind::Scale:            return "scale";
    }
    return "?";
}

std::optional<ToolKind> ParseToolKind(std::string_view Name) noexcept
{
    static const ToolKind All[] = { ToolKind::Line, ToolKind::Polyline, ToolKind::Rectangle, ToolKind::CentreRectangle, ToolKind::Polygon, ToolKind::Slot,
                                    ToolKind::Circle, ToolKind::TwoPointCircle, ToolKind::ThreePointCircle, ToolKind::Arc, ToolKind::ThreePointArc,
                                    ToolKind::Ellipse, ToolKind::Spline, ToolKind::ControlCurve, ToolKind::Move, ToolKind::Rotate, ToolKind::Scale };
    for (ToolKind K : All) if (Name == ToolKindName(K)) return K;
    if (Name == "rectangle") return ToolKind::Rectangle;
    if (Name == "grab" || Name == "translate") return ToolKind::Move;
    return std::nullopt;
}

const char* AxisLockName(AxisLock Lock) noexcept
{
    switch (Lock)
    {
        case AxisLock::None:    return "free";
        case AxisLock::X:       return "X";
        case AxisLock::Y:       return "Y";
        case AxisLock::Z:       return "Z";
        case AxisLock::PlaneYZ: return "YZ plane";
        case AxisLock::PlaneXZ: return "XZ plane";
        case AxisLock::PlaneXY: return "XY plane";
    }
    return "?";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

bool ToolSession::Begin(ToolKind NewKind, const Context& NewCtx, Completion NewCompletion) noexcept
{
    if (Active()) Finish(false);
    Kind = NewKind; Ctx = NewCtx; OnComplete = std::move(NewCompletion);
    Prompts.clear(); Confirmed.clear(); Scalars.clear(); Live = {}; PromptIndex = 0; HavePointer = false;
    auto P = [&](const char* Label, Want W = Want::Point, bool Optional = false) { Prompts.push_back({ Label, W, Optional }); };
    switch (Kind)
    {
        case ToolKind::Line:             P("Start"); P("End"); break;
        case ToolKind::Polyline:         P("Start"); P("Next", Want::Point, true); break;             // repeats until Enter
        case ToolKind::Rectangle:        P("First corner"); P("Opposite corner"); break;
        case ToolKind::CentreRectangle:  P("Centre"); P("Corner"); break;
        case ToolKind::Polygon:          P("Centre"); P("Radius / vertex", Want::Distance); break;
        case ToolKind::Slot:             P("First centre"); P("Second centre"); P("Radius", Want::Distance); break;
        case ToolKind::Circle:           P("Centre"); P("Radius", Want::Distance); break;
        case ToolKind::TwoPointCircle:   P("Diameter start"); P("Diameter end"); break;
        case ToolKind::ThreePointCircle: P("First"); P("Second"); P("Third"); break;
        case ToolKind::Arc:              P("Centre"); P("Start", Want::Distance); P("End", Want::Angle); break;
        case ToolKind::ThreePointArc:    P("Start"); P("End"); P("Through"); break;
        case ToolKind::Ellipse:          P("Centre"); P("Major axis end", Want::Distance); P("Minor radius", Want::Distance); break;
        case ToolKind::Spline:           P("Start"); P("Next", Want::Point, true); break;
        case ToolKind::ControlCurve:     P("Start"); P("Next", Want::Point, true); break;
        case ToolKind::Move:             P("Offset", Want::Point); break;
        case ToolKind::Rotate:           P("Angle", Want::Angle); break;
        case ToolKind::Scale:            P("Factor", Want::Distance); break;
        case ToolKind::None:             return false;
    }
    Scalars.assign(Prompts.size() + 64, NoScalar);
    Live.Cursor = Ctx.Plane.Origin;
    Rebuild();
    return true;
}

void ToolSession::Cancel() noexcept { if (Active()) Finish(false); }

void ToolSession::Finish(bool Completed) noexcept
{
    ToolOutcome Out;
    Out.Completed = Completed;
    if (Completed)
    {
        if (Kind == ToolKind::Move || Kind == ToolKind::Rotate || Kind == ToolKind::Scale)
        {
            Vec3 Pivot = Ctx.SelectionPivot;
            if (Kind == ToolKind::Move)
            {
                Vec3 D = Confirmed.empty() ? Live.Cursor - Pivot : Confirmed.back() - Pivot;
                Out.Transform = Mat4::Translation(D);
                char B[96]; std::snprintf(B, sizeof B, "move (%.4f %.4f %.4f) lock %s", D.X, D.Y, D.Z, AxisLockName(Live.Lock)); Out.Summary = B;
            }
            else if (Kind == ToolKind::Rotate)
            {
                double A = Has(Scalars[0]) ? ScalarCriteria::Radians(Scalars[0]) : 0.0;
                Vec3 Axis = Live.Lock == AxisLock::X ? Vec3::UnitX() : Live.Lock == AxisLock::Y ? Vec3::UnitY() : Ctx.Plane.Normal();
                Out.Transform = Mat4::Translation(Pivot) * Mat4::Rotation(Axis, A) * Mat4::Translation(Pivot * -1.0);
                char B[96]; std::snprintf(B, sizeof B, "rotate %.3f° about %s", ScalarCriteria::Degrees(A), Live.Lock == AxisLock::None ? "workplane normal" : AxisLockName(Live.Lock)); Out.Summary = B;
            }
            else
            {
                double F = Has(Scalars[0]) ? Scalars[0] : 1.0;
                Vec3 S{ F, F, F };
                if (Live.Lock == AxisLock::X) S = { F, 1, 1 }; else if (Live.Lock == AxisLock::Y) S = { 1, F, 1 }; else if (Live.Lock == AxisLock::Z) S = { 1, 1, F };
                else if (Live.Lock == AxisLock::PlaneXY) S = { F, F, 1 }; else if (Live.Lock == AxisLock::PlaneXZ) S = { F, 1, F }; else if (Live.Lock == AxisLock::PlaneYZ) S = { 1, F, F };
                Out.Transform = Mat4::Translation(Pivot) * Mat4::Scaling(S) * Mat4::Translation(Pivot * -1.0);
                char B[96]; std::snprintf(B, sizeof B, "scale %.4f lock %s", F, AxisLockName(Live.Lock)); Out.Summary = B;
            }
        }
        else
        {
            Deliver<NurbsCurve> R = Produce(true);
            if (R) { Out.Curves.push_back(R.Payload); Out.Summary = std::string(ToolKindName(Kind)) + " — " + std::to_string(Confirmed.size()) + " point(s)"; }
            else { Out.Completed = false; Out.Summary = std::string("refused: ") + R.Denial.Detail; }
        }
    }
    else Out.Summary = std::string(ToolKindName(Kind)) + " cancelled";
    Completion Done = std::move(OnComplete);
    Kind = ToolKind::None; Prompts.clear(); Confirmed.clear(); Live = {};
    if (Done) Done(Out);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  INPUT
//------------------------------------------------------------------------------------------------------------------------

Vec3 ToolSession::ApplyLock(Vec3 A, Vec3 P) const noexcept
{
    Vec3 D = P - A;
    const Workplane& W = Ctx.Plane;
    Vec3 N = W.Normal();
    switch (Live.Lock)
    {
        case AxisLock::None:    return P;
        case AxisLock::X:       return A + W.AxisX * D.Dot(W.AxisX);
        case AxisLock::Y:       return A + W.AxisY * D.Dot(W.AxisY);
        case AxisLock::Z:       return A + N * D.Dot(N);
        case AxisLock::PlaneXY: return A + W.AxisX * D.Dot(W.AxisX) + W.AxisY * D.Dot(W.AxisY);
        case AxisLock::PlaneXZ: return A + W.AxisX * D.Dot(W.AxisX) + N * D.Dot(N);
        case AxisLock::PlaneYZ: return A + W.AxisY * D.Dot(W.AxisY) + N * D.Dot(N);
    }
    return P;
}

bool ToolSession::Handle(const InputEvent& E) noexcept
{
    if (!Active()) return false;
    switch (E.Action)
    {
        case InputAction::PointerMove:
        {
            HavePointer = true; PointerX = E.PixelX; PointerY = E.PixelY; SnapSuppressed = E.Ctrl();
            SnapSettings Local = Ctx.Snap ? *Ctx.Snap : SnapSettings{};
            if (SnapSuppressed) Local.Enabled = false;
            Vec3 AnchorPoint = Anchor();
            Live.Snap = SnapResolution::Resolve(E.PixelX, E.PixelY, *Ctx.Camera, Ctx.Width, Ctx.Height, Ctx.Plane, *Ctx.Scene, Local, Confirmed.empty() ? nullptr : &AnchorPoint);
            if (Live.Snap.Kind != SnapKind::None) Live.Cursor = ApplyLock(AnchorPoint, Live.Snap.Position);
            Rebuild();
            return true;
        }
        case InputAction::PointerPress:
            if (E.Button == PointerButton::Left) { if (!Live.NumericEntry.empty()) return SupplyText(Live.NumericEntry); return Advance(Live.Cursor); }
            if (E.Button == PointerButton::Right) { if (CurrentPrompt().Optional || PromptIndex >= Prompts.size()) Finish(true); else Finish(false); return true; }
            return false;
        case InputAction::Text:
        {
            char C = E.Character;
            if (std::isdigit(static_cast<unsigned char>(C)) || C == '.' || C == '-' || C == ',' || C == '@' || C == 'r' || C == 'a' || C == 'n' || C == 'd' || C == '*' || C == '/')
            {
                Live.NumericEntry.push_back(C);
                Rebuild();
                return true;
            }
            return false;
        }
        case InputAction::KeyPress:
        {
            switch (E.KeyCode)
            {
                case Key::Escape:    if (!Live.NumericEntry.empty()) { Live.NumericEntry.clear(); Rebuild(); } else Finish(false); return true;
                case Key::Enter:     return Confirm();
                case Key::Backspace: if (!Live.NumericEntry.empty()) Live.NumericEntry.pop_back(); else if (!Confirmed.empty() && CurrentPrompt().Optional) { Confirmed.pop_back(); } Rebuild(); return true;
                case Key::X:         Live.Lock = E.Shift() ? AxisLock::PlaneYZ : (Live.Lock == AxisLock::X ? AxisLock::None : AxisLock::X); Rebuild(); return true;
                case Key::Y:         Live.Lock = E.Shift() ? AxisLock::PlaneXZ : (Live.Lock == AxisLock::Y ? AxisLock::None : AxisLock::Y); Rebuild(); return true;
                case Key::Z:         Live.Lock = E.Shift() ? AxisLock::PlaneXY : (Live.Lock == AxisLock::Z ? AxisLock::None : AxisLock::Z); Rebuild(); return true;
                case Key::Tab:       if (PromptIndex + 1 < Prompts.size() && !Confirmed.empty()) { /* field hop: keep cursor, move to next scalar prompt */ } return true;
                case Key::Up:        if (Kind == ToolKind::Polygon) ++Sides; else if (Kind == ToolKind::Spline || Kind == ToolKind::ControlCurve) Degree = std::min(Degree + 1, 7); Rebuild(); return true;
                case Key::Down:      if (Kind == ToolKind::Polygon) Sides = std::max(3, Sides - 1); else if (Kind == ToolKind::Spline || Kind == ToolKind::ControlCurve) Degree = std::max(1, Degree - 1); Rebuild(); return true;
                default:             return false;
            }
        }
        default: return false;
    }
}

bool ToolSession::SupplyPoint(Vec3 P) noexcept
{
    if (!Active()) return false;
    Live.Cursor = ApplyLock(Anchor(), P);
    Live.Snap = {}; Live.Snap.Kind = SnapKind::Free; Live.Snap.Position = Live.Cursor;
    return Advance(Live.Cursor);
}

Vec3 ToolSession::PointFromNumbers(const std::vector<double>& V, bool Relative) const noexcept
{
    const Workplane& W = Ctx.Plane;
    Vec3 Base = Relative ? Anchor() : W.Origin;
    if (V.size() == 1)
    {
        // Single number: distance along the current rubber band direction (or along the lock axis).
        Vec3 Dir = Live.Cursor - Anchor();
        if (Dir.Length() < ScalarCriteria::MergeTolerance) Dir = Live.Lock == AxisLock::Y ? W.AxisY : Live.Lock == AxisLock::Z ? W.Normal() : W.AxisX;
        return Anchor() + Dir.Normalised() * V[0];
    }
    Vec3 P = Base + W.AxisX * V[0] + W.AxisY * V[1];
    if (V.size() >= 3) P += W.Normal() * V[2];
    return P;
}

bool ToolSession::SupplyText(std::string_view Text) noexcept
{
    if (!Active() || Text.empty()) return false;
    Live.NumericEntry.clear();
    bool Relative = false;
    char Prefix = 0;
    std::string_view Body = Text;
    if (Body.front() == '@') { Relative = true; Body.remove_prefix(1); }
    if (!Body.empty() && (Body.front() == 'r' || Body.front() == 'a' || Body.front() == 'n' || Body.front() == 'd')) { Prefix = Body.front(); Body.remove_prefix(1); }

    std::vector<double> Values;
    size_t Start = 0;
    while (Start <= Body.size())
    {
        size_t Comma = Body.find(',', Start);
        std::string Piece(Body.substr(Start, Comma == std::string_view::npos ? std::string_view::npos : Comma - Start));
        // Tiny expression support: a*b, a/b (Blender accepts arithmetic in fields).
        double Value = 0.0;
        size_t Op = Piece.find_first_of("*/", 1);
        if (Op != std::string::npos) { double L = std::atof(Piece.substr(0, Op).c_str()), R = std::atof(Piece.substr(Op + 1).c_str()); Value = Piece[Op] == '*' ? L * R : (R != 0.0 ? L / R : 0.0); }
        else { char* End = nullptr; Value = std::strtod(Piece.c_str(), &End); if (End == Piece.c_str()) return false; }
        Values.push_back(Value);
        if (Comma == std::string_view::npos) break;
        Start = Comma + 1;
    }
    if (Values.empty()) return false;

    const ToolPrompt& Prompt = CurrentPrompt();
    if (Prefix == 'n') { Sides = std::max(3, int(Values[0])); Rebuild(); return true; }
    if (Prefix == 'd') { Degree = std::clamp(int(Values[0]), 1, 7); Rebuild(); return true; }

    // Scalar prompts: r/a prefixes or a bare single number fill the scalar directly.
    if (Prompt.Wants == Want::Distance && (Prefix == 'r' || Values.size() == 1) && Prefix != 'a')
    {
        Scalars[PromptIndex] = Values[0];
        // The point for a distance prompt is anchor + direction·r; direction from the cursor or the workplane X.
        Vec3 Dir = Live.Cursor - Anchor();
        if (Dir.Length() < ScalarCriteria::MergeTolerance) Dir = Ctx.Plane.AxisX;
        return Advance(Anchor() + Dir.Normalised() * Values[0]);
    }
    if (Prompt.Wants == Want::Angle && (Prefix == 'a' || Values.size() == 1))
    {
        Scalars[PromptIndex] = Values[0];
        Vec3 Centre = Confirmed.empty() ? Anchor() : Confirmed.front();
        double Radius = Confirmed.size() >= 2 ? Confirmed[1].Distance(Confirmed[0]) : 1.0;
        double Start0 = Confirmed.size() >= 2 ? std::atan2(Ctx.Plane.ToLocal(Confirmed[1]).Y - Ctx.Plane.ToLocal(Centre).Y, Ctx.Plane.ToLocal(Confirmed[1]).X - Ctx.Plane.ToLocal(Centre).X) : 0.0;
        double A = Start0 + ScalarCriteria::Radians(Values[0]);
        Vec2 L = Ctx.Plane.ToLocal(Centre);
        return Advance(Ctx.Plane.ToWorld({ L.X + std::cos(A) * Radius, L.Y + std::sin(A) * Radius }));
    }
    if (Kind == ToolKind::Move)
    {
        // Blender: "G X 12" moves 12 along X; "G 1,2" moves by (1,2) in the workplane; "G 1,2,3" world offset.
        Vec3 Pivot = Ctx.SelectionPivot;
        if (Values.size() == 1)
        {
            const Workplane& W = Ctx.Plane;
            Vec3 Dir = Live.Lock == AxisLock::X ? W.AxisX : Live.Lock == AxisLock::Y ? W.AxisY : Live.Lock == AxisLock::Z ? W.Normal() : (Live.Cursor - Pivot);
            if (Dir.Length() < ScalarCriteria::MergeTolerance) Dir = W.AxisX;
            return Advance(Pivot + Dir.Normalised() * Values[0]);
        }
        Vec3 Offset = Ctx.Plane.AxisX * Values[0] + Ctx.Plane.AxisY * Values[1] + (Values.size() >= 3 ? Ctx.Plane.Normal() * Values[2] : Vec3{});
        return Advance(Pivot + Offset);
    }
    if (Prefix == 'a' && Prompt.Wants == Want::Point && Values.size() >= 1)
    {
        // Polar entry: "a45" then distance via r, or "a45,3" → angle + distance in the workplane from the anchor.
        double Ang = ScalarCriteria::Radians(Values[0]);
        double Dist = Values.size() >= 2 ? Values[1] : (Live.Cursor - Anchor()).Length();
        Vec2 L = Ctx.Plane.ToLocal(Anchor());
        return Advance(Ctx.Plane.ToWorld({ L.X + std::cos(Ang) * Dist, L.Y + std::sin(Ang) * Dist }));
    }
    return Advance(PointFromNumbers(Values, Relative || (Values.size() > 1 && !Confirmed.empty() && Text.front() == '@')));
}

bool ToolSession::Confirm() noexcept
{
    if (!Active()) return false;
    if (!Live.NumericEntry.empty()) return SupplyText(std::string(Live.NumericEntry));
    if (CurrentPrompt().Optional || PromptIndex >= Prompts.size()) { Finish(true); return true; }
    if (Kind == ToolKind::Move || Kind == ToolKind::Rotate || Kind == ToolKind::Scale) { Finish(true); return true; }
    return Advance(Live.Cursor);
}

bool ToolSession::Advance(Vec3 P) noexcept
{
    if (!Active()) return false;
    // Reject zero-length steps on point prompts (double click on the same spot) except for the very first point.
    if (!Confirmed.empty() && CurrentPrompt().Wants == Want::Point && P.Distance(Confirmed.back()) < ScalarCriteria::MergeTolerance && Kind != ToolKind::Move) return false;
    Confirmed.push_back(P);
    Live.Points = Confirmed;
    if (Kind == ToolKind::Move || Kind == ToolKind::Rotate || Kind == ToolKind::Scale) { Finish(true); return true; }
    if (!CurrentPrompt().Optional) ++PromptIndex;                                       // optional prompts repeat
    if (PromptIndex >= Prompts.size()) { Finish(true); return true; }
    Live.Cursor = P;
    Rebuild();
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

Deliver<NurbsCurve> ToolSession::Produce(bool Final) const noexcept
{
    std::vector<Vec3> P = Confirmed;
    if (!Final) P.push_back(Live.Cursor);
    const Workplane& W = Ctx.Plane;
    auto L = [&](Vec3 V) { return W.ToLocal(V); };
    auto Reject = [](const char* Why) { return Deliver<NurbsCurve>::Reject(RefusalReason::DegenerateInput, Why); };
    size_t N = P.size();
    switch (Kind)
    {
        case ToolKind::Line:             return N >= 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need two points");
        case ToolKind::Polyline:         return N >= 2 ? NurbsCurve::Polyline(P, false) : Reject("need two points");
        case ToolKind::Rectangle:        return N >= 2 ? NurbsCurve::Rectangle(W, L(P[0]), L(P[1])) : Reject("need two corners");
        case ToolKind::CentreRectangle:  return N >= 2 ? NurbsCurve::Rectangle(W, L(P[0]) - (L(P[1]) - L(P[0])), L(P[1])) : Reject("need centre and corner");
        case ToolKind::Polygon:
        {
            if (N < 2) return Reject("need centre and radius");
            Vec2 C = L(P[0]), R = L(P[1]) - C;
            return NurbsCurve::Polygon(W, C, R.Length(), Sides, R.Angle(), true);
        }
        case ToolKind::Slot:
        {
            if (N < 3) return N == 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need two centres and a radius");
            double R = Has(Scalars[2]) ? Scalars[2] : P[2].Distance(P[1]);
            return NurbsCurve::Slot(W, L(P[0]), L(P[1]), R);
        }
        case ToolKind::Circle:
        {
            if (N < 2) return Reject("need centre and radius");
            double R = Has(Scalars[1]) ? Scalars[1] : P[1].Distance(P[0]);
            return NurbsCurve::Circle(P[0], W.Normal(), R);
        }
        case ToolKind::TwoPointCircle:   return N >= 2 ? NurbsCurve::Circle((P[0] + P[1]) * 0.5, W.Normal(), P[0].Distance(P[1]) * 0.5) : Reject("need two points");
        case ToolKind::ThreePointCircle:
        {
            if (N < 3) return N == 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need three points");
            // Circumcentre in the workplane.
            Vec2 A = L(P[0]), B = L(P[1]), C = L(P[2]);
            double D = 2.0 * (A.X * (B.Y - C.Y) + B.X * (C.Y - A.Y) + C.X * (A.Y - B.Y));
            if (std::fabs(D) < 1e-12) return Reject("three points are collinear");
            double A2 = A.LengthSquared(), B2 = B.LengthSquared(), C2 = C.LengthSquared();
            Vec2 Centre{ (A2 * (B.Y - C.Y) + B2 * (C.Y - A.Y) + C2 * (A.Y - B.Y)) / D, (A2 * (C.X - B.X) + B2 * (A.X - C.X) + C2 * (B.X - A.X)) / D };
            return NurbsCurve::Circle(W.ToWorld(Centre), W.Normal(), Centre.Distance(A));
        }
        case ToolKind::Arc:
        {
            if (N < 2) return Reject("need centre, start, end");
            Vec2 C = L(P[0]), S = L(P[1]) - C;
            double R = S.Length();
            if (N == 2) return NurbsCurve::Circle(P[0], W.Normal(), R);
            double A0 = S.Angle(), A1 = (L(P[2]) - C).Angle();
            double Sweep = A1 - A0;
            while (Sweep <= 0) Sweep += ScalarCriteria::TwoPi;                          // counter-clockwise, like Plasticity
            if (Has(Scalars[2])) Sweep = ScalarCriteria::Radians(Scalars[2]);
            return NurbsCurve::Arc(P[0], W.Normal(), R, A0, Sweep);
        }
        case ToolKind::ThreePointArc:
        {
            if (N < 3) return N == 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need start, end, through");
            return NurbsCurve::ArcThreePoints(P[0], P[2], P[1]);                        // start, through, end
        }
        case ToolKind::Ellipse:
        {
            if (N < 2) return Reject("need centre, major end, minor radius");
            Vec2 C = L(P[0]), M = L(P[1]) - C;
            double Major = M.Length();
            if (N == 2) return NurbsCurve::Line(P[0], P[1]);
            Vec2 Perp{ -M.Y, M.X };
            double Minor = Has(Scalars[2]) ? Scalars[2] : std::fabs((L(P[2]) - C).Dot(Perp.Normalised()));
            if (Minor < ScalarCriteria::MergeTolerance) return Reject("minor radius is zero");
            Vec3 MajorDir = W.AxisX * M.X + W.AxisY * M.Y;
            return NurbsCurve::Ellipse(P[0], W.Normal(), MajorDir, Major, Minor);
        }
        case ToolKind::Spline:           return N >= 2 ? NurbsCurve::Interpolate(P, std::min(Degree, int(N) - 1), false) : Reject("need two points");
        case ToolKind::ControlCurve:     return N >= 2 ? NurbsCurve::ControlPoints(std::min(Degree, int(N) - 1), P, false) : Reject("need two points");
        default:                         return Reject("not a curve tool");
    }
}

void ToolSession::Rebuild() noexcept
{
    Live.Points = Confirmed;
    Live.Curves.clear();
    Live.Readout.clear();
    if (!Active()) return;
    char B[128];
    if (Kind == ToolKind::Move || Kind == ToolKind::Rotate || Kind == ToolKind::Scale)
    {
        Vec3 D = Live.Cursor - Ctx.SelectionPivot;
        std::snprintf(B, sizeof B, "Δ (%.4f %.4f %.4f)  |Δ| %.4f  lock %s", D.X, D.Y, D.Z, D.Length(), AxisLockName(Live.Lock)); Live.Readout.push_back(B);
    }
    else
    {
        Deliver<NurbsCurve> R = Produce(false);
        if (R) Live.Curves.push_back(R.Payload);
        if (!Confirmed.empty())
        {
            Vec3 A = Confirmed.back(); Vec2 D = Ctx.Plane.ToLocal(Live.Cursor) - Ctx.Plane.ToLocal(A);
            std::snprintf(B, sizeof B, "L %.4f  ∠ %.2f°  Δ (%.4f, %.4f)", (Live.Cursor - A).Length(), ScalarCriteria::Degrees(D.Angle()), D.X, D.Y); Live.Readout.push_back(B);
        }
        if (Kind == ToolKind::Polygon) { std::snprintf(B, sizeof B, "sides %d (↑/↓, n<k>)", Sides); Live.Readout.push_back(B); }
        if (Kind == ToolKind::Spline || Kind == ToolKind::ControlCurve) { std::snprintf(B, sizeof B, "degree %d (↑/↓, d<k>)", Degree); Live.Readout.push_back(B); }
    }
    if (Live.Lock != AxisLock::None) { std::snprintf(B, sizeof B, "lock %s", AxisLockName(Live.Lock)); Live.Readout.push_back(B); }
    if (!Live.NumericEntry.empty()) Live.Readout.push_back("typing: " + Live.NumericEntry);
    if (Live.Snap.Kind != SnapKind::None && Live.Snap.Kind != SnapKind::Free) { std::snprintf(B, sizeof B, "snap %s%s%s", SnapKindName(Live.Snap.Kind), Live.Snap.ItemIdentity ? " #" : "", Live.Snap.ItemIdentity ? std::to_string(Live.Snap.ItemIdentity).c_str() : ""); Live.Readout.push_back(B); }
}

} // namespace Frontier
