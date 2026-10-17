//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Interaction/ToolSession.cpp — Prompt lists, numeric entry grammar, preview construction
//============================================================================================================================================

#include "ToolSession.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace Frontier
{

namespace
{
constexpr double NoScalar = std::numeric_limits<double>::quiet_NaN();
bool Given(double S) noexcept { return !std::isnan(S); }
using Want = ToolPrompt::Want;
}

const char* ToolName(ToolChoice Classification) noexcept
{
    switch (Classification)
    {
        case ToolChoice::None:             return "none";
        case ToolChoice::Line:             return "line";
        case ToolChoice::Polyline:         return "polyline";
        case ToolChoice::Rectangle:        return "rect";
        case ToolChoice::CentreRectangle:  return "centerrect";
        case ToolChoice::Polygon:          return "polygon";
        case ToolChoice::Slot:             return "slot";
        case ToolChoice::PolylineSlot:     return "pslot";
        case ToolChoice::DatumPoint:       return "datum-point";
        case ToolChoice::SketchPoint:      return "sketch-point";
        case ToolChoice::PresetSlot:       return "slot2";
        case ToolChoice::Circle:           return "circle";
        case ToolChoice::TwoPointCircle:   return "circle2";
        case ToolChoice::ThreePointCircle: return "circle3";
        case ToolChoice::Arc:              return "arc";
        case ToolChoice::ThreePointArc:    return "arc3";
        case ToolChoice::Ellipse:          return "ellipse";
        case ToolChoice::Spline:           return "spline";
        case ToolChoice::ControlCurve:     return "cpcurve";
        case ToolChoice::Hermite: return "hermite";
        case ToolChoice::Bezier: return "bezier";
        case ToolChoice::BSpline: return "bspline";
        case ToolChoice::Nurbs: return "nurbs";
        case ToolChoice::Move:             return "move";
        case ToolChoice::Rotate:           return "rotate";
        case ToolChoice::Scale:            return "scale";
    }
    return "?";
}

std::optional<ToolChoice> ParseToolChoice(std::string_view Name) noexcept
{
    static const ToolChoice All[] = { ToolChoice::Line, ToolChoice::Polyline, ToolChoice::Rectangle, ToolChoice::CentreRectangle, ToolChoice::Polygon, ToolChoice::Slot,
                                    ToolChoice::Circle, ToolChoice::TwoPointCircle, ToolChoice::ThreePointCircle, ToolChoice::Arc, ToolChoice::ThreePointArc,
                                    ToolChoice::Ellipse, ToolChoice::Spline, ToolChoice::ControlCurve, ToolChoice::Move, ToolChoice::Rotate, ToolChoice::Scale, ToolChoice::PolylineSlot, ToolChoice::DatumPoint, ToolChoice::SketchPoint, ToolChoice::PresetSlot, ToolChoice::Hermite, ToolChoice::Bezier, ToolChoice::BSpline, ToolChoice::Nurbs };
    for (ToolChoice K : All) if (Name == ToolName(K)) return K;
    if(Name=="b-spline") return ToolChoice::BSpline;
    if (Name == "rectangle") return ToolChoice::Rectangle;
    if (Name == "grab" || Name == "translate") return ToolChoice::Move;
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

bool ToolSession::Begin(ToolChoice NewChoice, const Context& NewCtx, Completion NewCompletion) noexcept
{
    if (Active()) Finish(false);
    Classification = NewChoice; Ctx = NewCtx; OnComplete = std::move(NewCompletion);
    // Each begin has deterministic defaults; explicit tool-options commands preserve edits in .arc replay.
    ControlWeights.clear();
    SlotRadius=.25; Clockwise=false; Circumscribed=false; Closed=false; Sides=6; Degree=3;
    Prompts.clear(); Confirmed.clear(); Scalars.clear(); Live = {}; PromptIndex = 0; HavePointer = false;
    auto P = [&](const char* Label, Want W = Want::Point, bool Optional = false) { Prompts.push_back({ Label, W, Optional }); };
    switch (Classification)
    {
        case ToolChoice::DatumPoint:
        case ToolChoice::SketchPoint:      P("Position"); break;
        case ToolChoice::PresetSlot:       P("First centre"); P("Second centre"); break;
        case ToolChoice::Line:             P("Start"); P("End"); break;
        case ToolChoice::PolylineSlot:     P("First centre"); P("Next centre — Enter / right-click to finish", Want::Point, true); break;
        case ToolChoice::Polyline:         P("Start"); P("Next", Want::Point, true); break;             // repeats until Enter
        case ToolChoice::Rectangle:        P("First corner"); P("Opposite corner"); break;
        case ToolChoice::CentreRectangle:  P("Centre"); P("Corner"); break;
        case ToolChoice::Polygon:          P("Centre"); P("Radius / vertex", Want::Distance); break;
        case ToolChoice::Slot:             P("First centre"); P("Second centre"); P("Radius", Want::Distance); break;
        case ToolChoice::Circle:           P("Centre"); P("Radius", Want::Distance); break;
        case ToolChoice::TwoPointCircle:   P("Diameter start"); P("Diameter end"); break;
        case ToolChoice::ThreePointCircle: P("First"); P("Second"); P("Third"); break;
        case ToolChoice::Arc:              P("Centre"); P("Start", Want::Distance); P("End", Want::Angle); break;
        case ToolChoice::ThreePointArc:    P("Start"); P("End"); P("Through"); break;
        case ToolChoice::Ellipse:          P("Centre"); P("Major axis end", Want::Distance); P("Minor radius", Want::Distance); break;
        case ToolChoice::Spline:           P("Start"); P("Next", Want::Point, true); break;
        case ToolChoice::Hermite: P("Start");P("End");P("Start tangent handle");P("Incoming end tangent handle");P("Next end / incoming handle — Enter to finish", Want::Point, true);break;
        case ToolChoice::Bezier:
        case ToolChoice::BSpline:
        case ToolChoice::Nurbs:
        case ToolChoice::ControlCurve:     P("Start"); P("Next", Want::Point, true); break;
        case ToolChoice::Move:             P("Offset", Want::Point); break;
        case ToolChoice::Rotate:           P("Angle", Want::Angle); break;
        case ToolChoice::Scale:            P("Factor", Want::Distance); break;
        case ToolChoice::None:             return false;
    }
    Scalars.assign(Prompts.size() + 64, NoScalar);
    Live.Cursor = Ctx.Plane.Origin;
    Rebuild();
    return true;
}

void ToolSession::ResizeViewport(uint32_t Width, uint32_t Height) noexcept
{
    if (Ctx.Width == Width && Ctx.Height == Height) return;
    if (HavePointer && Ctx.Width > 0u && Ctx.Height > 0u)
    {
        PointerX *= double(Width) / Ctx.Width;
        PointerY *= double(Height) / Ctx.Height;
    }
    Ctx.Width = Width;
    Ctx.Height = Height;
    if (Active()) Rebuild();
}

void ToolSession::Cancel() noexcept { if (Active()) Finish(false); }

void ToolSession::Finish(bool Completed) noexcept
{
    ToolResult Out;
    Out.SourceTool=Classification;
    Out.Completed = Completed;
    if (Completed)
    {
        if (Classification == ToolChoice::Move || Classification == ToolChoice::Rotate || Classification == ToolChoice::Scale)
        {
            Vec3 Pivot = Ctx.SelectionPivot;
            if (Classification == ToolChoice::Move)
            {
                Vec3 D = Confirmed.empty() ? Live.Cursor - Pivot : Confirmed.back() - Pivot;
                Out.Transform = Mat4::Translation(D);
                char B[96]; std::snprintf(B, sizeof B, "move (%.4f %.4f %.4f) lock %s", D.X, D.Y, D.Z, AxisLockName(Live.Lock)); Out.Summary = B;
            }
            else if (Classification == ToolChoice::Rotate)
            {
                double A = Given(Scalars[0]) ? ScalarCriteria::Radians(Scalars[0]) : 0.0;
                Vec3 Axis = Live.Lock == AxisLock::X ? Vec3::UnitX() : Live.Lock == AxisLock::Y ? Vec3::UnitY() : Ctx.Plane.Normal();
                Out.Transform = Mat4::Translation(Pivot) * Mat4::Rotation(Axis, A) * Mat4::Translation(Pivot * -1.0);
                char B[96]; std::snprintf(B, sizeof B, "rotate %.3f° about %s", ScalarCriteria::Degrees(A), Live.Lock == AxisLock::None ? "workplane normal" : AxisLockName(Live.Lock)); Out.Summary = B;
            }
            else
            {
                double F = Given(Scalars[0]) ? Scalars[0] : 1.0;
                Vec3 S{ F, F, F };
                if (Live.Lock == AxisLock::X) S = { F, 1, 1 }; else if (Live.Lock == AxisLock::Y) S = { 1, F, 1 }; else if (Live.Lock == AxisLock::Z) S = { 1, 1, F };
                else if (Live.Lock == AxisLock::PlaneXY) S = { F, F, 1 }; else if (Live.Lock == AxisLock::PlaneXZ) S = { F, 1, F }; else if (Live.Lock == AxisLock::PlaneYZ) S = { 1, F, F };
                Out.Transform = Mat4::Translation(Pivot) * Mat4::Scaling(S) * Mat4::Translation(Pivot * -1.0);
                char B[96]; std::snprintf(B, sizeof B, "scale %.4f lock %s", F, AxisLockName(Live.Lock)); Out.Summary = B;
            }
        }
        else if(Classification==ToolChoice::DatumPoint || Classification==ToolChoice::SketchPoint)
        {
            if(Confirmed.empty()) Out.Completed=false;
            else Out.ReferencePoints.push_back(Confirmed.front());
            Out.ConstructionPoint=Classification==ToolChoice::DatumPoint;
            Out.Summary=std::string(ToolName(Classification));
        }
        else
        {
            Deliver<NurbsCurve> R = Produce(true);
            if (R) { Out.Curves.push_back(R.Payload); Out.Summary = std::string(ToolName(Classification)) + " — " + std::to_string(Confirmed.size()) + " point(s)"; }
            else { Out.Completed = false; Out.Summary = std::string("refused: ") + R.Denial.Detail; }
        }
    }
    else Out.Summary = std::string(ToolName(Classification)) + " cancelled";
    Completion Done = std::move(OnComplete);
    Classification = ToolChoice::None; Prompts.clear(); Confirmed.clear(); Live = {};
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

bool ToolSession::Receive(const InputEvent& E) noexcept
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
            if (Live.Snap.Classification != SnapClassification::None) Live.Cursor = ApplyLock(AnchorPoint, Live.Snap.Position);
            Rebuild();
            return true;
        }
        case InputAction::PointerPress:
            if (E.Button == PointerButton::Left) { if (!Live.NumericEntry.empty()) return SupplyText(Live.NumericEntry); return Advance(Live.Cursor); }
            if (E.Button == PointerButton::Right) { if (Classification==ToolChoice::Hermite && CurrentPrompt().Optional) return Confirm(); if (CurrentPrompt().Optional || PromptIndex >= Prompts.size()) Finish(true); else Finish(false); return true; }
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
                case Key::Backspace: if (!Live.NumericEntry.empty()) Live.NumericEntry.pop_back(); else if (!Confirmed.empty() && CurrentPrompt().Optional) { Confirmed.pop_back();if(Classification==ToolChoice::Hermite){PromptIndex=std::min(size_t(4),Confirmed.size());Prompts.back().Label=Confirmed.size()%2?"Incoming end tangent handle":"Next end — Enter / right-click to finish";} } Rebuild(); return true;
                case Key::X:         Live.Lock = E.Shift() ? AxisLock::PlaneYZ : (Live.Lock == AxisLock::X ? AxisLock::None : AxisLock::X); Rebuild(); return true;
                case Key::Y:         Live.Lock = E.Shift() ? AxisLock::PlaneXZ : (Live.Lock == AxisLock::Y ? AxisLock::None : AxisLock::Y); Rebuild(); return true;
                case Key::Z:         Live.Lock = E.Shift() ? AxisLock::PlaneXY : (Live.Lock == AxisLock::Z ? AxisLock::None : AxisLock::Z); Rebuild(); return true;
                case Key::Tab:       if (PromptIndex + 1 < Prompts.size() && !Confirmed.empty()) { /* field hop: keep cursor, move to next scalar prompt */ } return true;
                case Key::Up:        if (Classification == ToolChoice::Polygon) ++Sides; else if (Classification == ToolChoice::Spline || Classification == ToolChoice::ControlCurve || Classification==ToolChoice::BSpline || Classification==ToolChoice::Nurbs) Degree = std::min(Degree + 1, 7); Rebuild(); return true;
                case Key::Down:      if (Classification == ToolChoice::Polygon) Sides = std::max(3, Sides - 1); else if (Classification == ToolChoice::Spline || Classification == ToolChoice::ControlCurve || Classification==ToolChoice::BSpline || Classification==ToolChoice::Nurbs) Degree = std::max(1, Degree - 1); Rebuild(); return true;
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
    Live.Snap = {}; Live.Snap.Classification = SnapClassification::Free; Live.Snap.Position = Live.Cursor;
    return Advance(Live.Cursor);
}

Vec3 ToolSession::PointFromNumbers(const std::vector<double>& V, bool Relative) const noexcept
{
    const Workplane& W = Ctx.Plane;
    Vec3 Origin = Relative ? Anchor() : W.Origin;
    if (V.size() == 1)
    {
        // Single number: distance along the current rubber band direction (or along the lock axis).
        Vec3 Dir = Live.Cursor - Anchor();
        if (Dir.Length() < ScalarCriteria::MergeTolerance) Dir = Live.Lock == AxisLock::Y ? W.AxisY : Live.Lock == AxisLock::Z ? W.Normal() : W.AxisX;
        return Anchor() + Dir.Normalised() * V[0];
    }
    Vec3 P = Origin + W.AxisX * V[0] + W.AxisY * V[1];
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
        double Number = 0.0;
        size_t Op = Piece.find_first_of("*/", 1);
        if (Op != std::string::npos) { double L = std::atof(Piece.substr(0, Op).c_str()), R = std::atof(Piece.substr(Op + 1).c_str()); Number = Piece[Op] == '*' ? L * R : (R != 0.0 ? L / R : 0.0); }
        else { char* End = nullptr; Number = std::strtod(Piece.c_str(), &End); if (End == Piece.c_str()) return false; }
        Values.push_back(Number);
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
    if (Classification == ToolChoice::Move)
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
    if (Confirmed.empty() && !HavePointer) return false; // Enter never invents a first point at the origin
    if (Classification==ToolChoice::Hermite && (Confirmed.size()<4 || Confirmed.size()%2)) return false;
    if (CurrentPrompt().Optional || PromptIndex >= Prompts.size()) { Finish(true); return true; }
    if (Classification == ToolChoice::Move || Classification == ToolChoice::Rotate || Classification == ToolChoice::Scale) { Finish(true); return true; }
    return Advance(Live.Cursor);
}

bool ToolSession::Advance(Vec3 P) noexcept
{
    if (!Active()) return false;
    // Reject zero-length steps on point prompts (double click on the same spot) except for the very first point.
    if (!Confirmed.empty() && CurrentPrompt().Wants == Want::Point && P.Distance(Confirmed.back()) < ScalarCriteria::MergeTolerance && Classification != ToolChoice::Move) return false;
    Confirmed.push_back(P);
    Live.Points = Confirmed;
    if (Classification == ToolChoice::Move || Classification == ToolChoice::Rotate || Classification == ToolChoice::Scale) { Finish(true); return true; }
    if (Classification==ToolChoice::Hermite){
        PromptIndex=std::min(size_t(4),Confirmed.size());
        Prompts.back().Label=Confirmed.size()%2?"Incoming end tangent handle":"Next end — Enter / right-click to finish";
    } else if (!CurrentPrompt().Optional) ++PromptIndex;                                       // optional prompts repeat
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
    if (!Final && (Classification!=ToolChoice::Hermite || P.empty() || P.back().Distance(Live.Cursor)>ScalarCriteria::MergeTolerance)) P.push_back(Live.Cursor);
    const Workplane& W = Ctx.Plane;
    auto L = [&](Vec3 V) { return W.ToLocal(V); };
    auto Reject = [](const char* Why) { return Deliver<NurbsCurve>::Reject(RefusalReason::DegenerateInput, Why); };
    size_t N = P.size();
    switch (Classification)
    {
        case ToolChoice::Line:             return N >= 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need two points");
        case ToolChoice::Polyline:         return N >= 2 ? NurbsCurve::Polyline(P, Closed) : Reject("need two points");
        case ToolChoice::Rectangle:        return N >= 2 ? NurbsCurve::Rectangle(W, L(P[0]), L(P[1])) : Reject("need two corners");
        case ToolChoice::CentreRectangle:  return N >= 2 ? NurbsCurve::Rectangle(W, L(P[0]) - (L(P[1]) - L(P[0])), L(P[1])) : Reject("need centre and corner");
        case ToolChoice::Polygon:
        {
            if (N < 2) return Reject("need centre and radius");
            Vec2 C = L(P[0]), R = L(P[1]) - C;
            return NurbsCurve::Polygon(W, C, R.Length(), Sides, R.Angle(), !Circumscribed);
        }
        case ToolChoice::PresetSlot: return N>=2 ? NurbsCurve::Slot(W,L(P[0]),L(P[1]),SlotRadius):Reject("need two centres");
        case ToolChoice::PolylineSlot:
        {
            if(N<2) return Reject("need two slot centres");
            std::vector<Vec2> Spine;
            for(auto Point:P) { const auto Local=L(Point); if(Spine.empty() || Local.Distance(Spine.back())>ScalarCriteria::MergeTolerance) Spine.push_back(Local); }
            return NurbsCurve::PolylineSlot(W,Spine,SlotRadius);
        }
        case ToolChoice::Slot:
        {
            if (N < 3) return N == 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need two centres and a radius");
            double R = Given(Scalars[2]) ? Scalars[2] : P[2].Distance(P[1]);
            return NurbsCurve::Slot(W, L(P[0]), L(P[1]), R);
        }
        case ToolChoice::Circle:
        {
            if (N < 2) return Reject("need centre and radius");
            double R = Given(Scalars[1]) ? Scalars[1] : P[1].Distance(P[0]);
            return NurbsCurve::Circle(P[0], W.Normal(), R);
        }
        case ToolChoice::TwoPointCircle:   return N >= 2 ? NurbsCurve::Circle((P[0] + P[1]) * 0.5, W.Normal(), P[0].Distance(P[1]) * 0.5) : Reject("need two points");
        case ToolChoice::ThreePointCircle:
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
        case ToolChoice::Arc:
        {
            if (N < 2) return Reject("need centre, start, end");
            Vec2 C = L(P[0]), S = L(P[1]) - C;
            double R = S.Length();
            if (N == 2) return NurbsCurve::Circle(P[0], W.Normal(), R);
            double A0 = S.Angle(), A1 = (L(P[2]) - C).Angle();
            double Sweep = A1 - A0;
            while (Sweep <= 0) Sweep += ScalarCriteria::TwoPi;                          // counter-clockwise, like Plasticity
            if(Clockwise) Sweep-=ScalarCriteria::TwoPi;
            if (Given(Scalars[2])) Sweep = ScalarCriteria::Radians(Scalars[2]);
            const Workplane ArcPlane = Workplane::FromNormal(P[0], W.Normal());
            const double WorldStart = ArcPlane.ToLocal(P[1]).Angle();
            return NurbsCurve::Arc(P[0], W.Normal(), R, WorldStart, Sweep);
        }
        case ToolChoice::ThreePointArc:
        {
            if (N < 3) return N == 2 ? NurbsCurve::Line(P[0], P[1]) : Reject("need start, end, through");
            return NurbsCurve::ArcThreePoints(P[0], P[2], P[1]);                        // start, through, end
        }
        case ToolChoice::Ellipse:
        {
            if (N < 2) return Reject("need centre, major end, minor radius");
            Vec2 C = L(P[0]), M = L(P[1]) - C;
            double Major = M.Length();
            if (N == 2) return NurbsCurve::Line(P[0], P[1]);
            Vec2 Perp{ -M.Y, M.X };
            double Minor = Given(Scalars[2]) ? Scalars[2] : std::fabs((L(P[2]) - C).Dot(Perp.Normalised()));
            if (Minor < ScalarCriteria::MergeTolerance) return Reject("minor radius is zero");
            Vec3 MajorDir = W.AxisX * M.X + W.AxisY * M.Y;
            return NurbsCurve::Ellipse(P[0], W.Normal(), MajorDir, Major, Minor);
        }
        case ToolChoice::Hermite: {
            if(N<2)return Reject("need start and end");
            if(Final && (N<4 || N%2))return Reject("finish each Hermite span with its incoming tangent handle");
            if(N<3)return NurbsCurve::Line(P[0],P[1]);
            const Vec3 C1=P[0]+(P[2]-P[0])/3.,C2=N>=4?P[1]+(P[3]-P[1])/3.:P[1];
            auto Curve=NurbsCurve::Bezier({P[0],C1,C2,P[1]});
            if(!Curve || N<5)return Curve;
            Vec3 Start=P[1],Tangent=P[1]-P[3];
            for(size_t I=4;I<N;I+=2){
                const Vec3 End=P[I],Incoming=I+1<N?P[I+1]:End-(End-Start);
                auto Span=NurbsCurve::Bezier({Start,Start+Tangent/3.,End+(Incoming-End)/3.,End});
                if(!Span)return Span;
                auto Joined=NurbsCurve::Join(Curve.Payload,Span.Payload);if(!Joined)return Joined;
                Curve=std::move(Joined);Start=End;Tangent=End-Incoming;
            }
            return Curve;
        }
        case ToolChoice::Bezier:return N>=2?NurbsCurve::Bezier(P):Reject("need two control points");
        case ToolChoice::BSpline:
        case ToolChoice::Nurbs: {
            if(N<2)return Reject("need two control points");
            if(Classification==ToolChoice::Nurbs && Final && !ControlWeights.empty() && ControlWeights.size()!=N)return Reject("provide one positive weight per control point, or leave weights empty");
            auto C=NurbsCurve::ControlPoints(std::min(Degree,int(N)-1),P,false);
            if(!C || Classification!=ToolChoice::Nurbs)return C;
            auto H=C.Payload.Poles;
            for(size_t I=0;I<N;++I)H[I]=Vec4::Weighted(P[I],I<ControlWeights.size()?ControlWeights[I]:1.);
            return NurbsCurve::Build(C.Payload.Degree,std::move(H),std::move(C.Payload.Knots));
        }
        case ToolChoice::Spline:           return N >= 2 ? NurbsCurve::Interpolate(P, std::min(Degree, int(N) - 1), false) : Reject("need two points");
        case ToolChoice::ControlCurve:     return N >= 2 ? NurbsCurve::ControlPoints(std::min(Degree, int(N) - 1), P, false) : Reject("need two points");
        default:                         return Reject("not a curve tool");
    }
}

void ToolSession::Rebuild() noexcept
{
    Live.Points = Confirmed;
    Live.Curves.clear();
    Live.Readout.clear();
    Live.Dimensions.clear();Live.AngleSegments.clear();Live.DimensionSpokes.clear();
    if (!Active()) return;
    char B[128];
    if (Classification == ToolChoice::Move || Classification == ToolChoice::Rotate || Classification == ToolChoice::Scale)
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
        if (Classification == ToolChoice::Polygon) { std::snprintf(B, sizeof B, "sides %d (↑/↓, n<k>)", Sides); Live.Readout.push_back(B); }
        if (Classification == ToolChoice::Spline || Classification == ToolChoice::ControlCurve || Classification==ToolChoice::BSpline || Classification==ToolChoice::Nurbs) { std::snprintf(B, sizeof B, "degree %d (↑/↓, d<k>)", Degree); Live.Readout.push_back(B); }
    }
    // Spatial live dimensions are presentation metadata, not authored document dimensions.
    // The native ImGui view uses its UI font for labels; both CPU/GPU devices draw the strokes.
    if (!Confirmed.empty())
    {
        const Vec3 A = Confirmed.front(), B = Confirmed.size() > 1 ? Confirmed[1] : Live.Cursor;
        auto Dimension = [&](Vec3 P, Vec3 Q, const char* Prefix, double Value, float OffsetY=0)
        {
            char Text[96]; std::snprintf(Text, sizeof Text, "%s%.1f mm", Prefix, Value*1000);
            Live.Dimensions.push_back({P, Q, Text,OffsetY});
        };
        auto AngleDimension=[&](Vec3 Vertex,Vec3 First,Vec3 Last){
            const Vec2 V=Ctx.Plane.ToLocal(Vertex),F=Ctx.Plane.ToLocal(First)-V,E=Ctx.Plane.ToLocal(Last)-V;
            const double Start=F.Angle();double Sweep=E.Angle()-Start;
            while(Sweep>ScalarCriteria::Pi)Sweep-=ScalarCriteria::TwoPi;while(Sweep< -ScalarCriteria::Pi)Sweep+=ScalarCriteria::TwoPi;
            const double Radius=std::min(F.Length(),E.Length())*.35;
            auto At=[&](double T,double Scale=1.){return Ctx.Plane.ToWorld(V+Vec2{std::cos(T),std::sin(T)}*(Radius*Scale));};
            for(int I=0;I<16;++I){Live.AngleSegments.push_back(At(Start+Sweep*I/16));Live.AngleSegments.push_back(At(Start+Sweep*(I+1)/16));}
            char Text[64];std::snprintf(Text,sizeof Text,"%.1f°",std::abs(ScalarCriteria::Degrees(Sweep)));
            const Vec3 Label=At(Start+Sweep*.5,1.6);Live.Dimensions.push_back({Label,Label,Text});
        };
        if (Classification == ToolChoice::Rectangle || Classification == ToolChoice::CentreRectangle)
        {
            Vec2 Lo = Ctx.Plane.ToLocal(A), Hi = Ctx.Plane.ToLocal(Live.Cursor);
            if (Classification == ToolChoice::CentreRectangle) Lo = Lo - (Hi - Lo);
            const Vec3 P = Ctx.Plane.ToWorld(Lo), Q = Ctx.Plane.ToWorld({Hi.X, Lo.Y}), R = Ctx.Plane.ToWorld(Hi);
            Dimension(P-Ctx.Plane.AxisY*.4, Q-Ctx.Plane.AxisY*.4, "", std::fabs(Hi.X - Lo.X));
            Dimension(Q+Ctx.Plane.AxisX*.4, R+Ctx.Plane.AxisX*.4, "", std::fabs(Hi.Y - Lo.Y));
        }
        else if(Classification==ToolChoice::Circle || Classification==ToolChoice::TwoPointCircle) {
            const Vec3 C=Classification==ToolChoice::Circle?A:(A+B)*.5;
            const double Radius=A.Distance(B)*(Classification==ToolChoice::Circle?1:.5);
            Dimension(C,C+Ctx.Plane.AxisX*Radius,"R ",Radius,-14);
            const Vec3 V=(Ctx.Plane.AxisX+Ctx.Plane.AxisY)*(Radius*std::sqrt(.5));
            Dimension(C-V,C+V,"⌀ ",Radius*2,14);
        }
        else if(Classification==ToolChoice::Polygon) {
            const double Radius=A.Distance(B),Angle=(Ctx.Plane.ToLocal(B)-Ctx.Plane.ToLocal(A)).Angle();
            const Vec3 Next=A+(Ctx.Plane.AxisX*std::cos(Angle+ScalarCriteria::TwoPi/Sides)+Ctx.Plane.AxisY*std::sin(Angle+ScalarCriteria::TwoPi/Sides))*Radius;
            Live.DimensionSpokes={A,B,A,Next};Dimension(A,B,"R ",Radius,-14);Dimension(B,Next,"",B.Distance(Next),14);AngleDimension(A,B,Next);
            char Text[96];std::snprintf(Text,sizeof Text,"%d sides · %.1f° interior",Sides,180.*(Sides-2)/Sides);
            Live.Dimensions.push_back({A,A,Text,23});
        }
        else if(Classification==ToolChoice::Arc) {
            Dimension(A,B,"R ",A.Distance(B));
            if(Confirmed.size()>1) {
                const Vec2 C=Ctx.Plane.ToLocal(A);double Start=(Ctx.Plane.ToLocal(B)-C).Angle(),Sweep=(Ctx.Plane.ToLocal(Live.Cursor)-C).Angle()-Start;
                while(Sweep<=0)Sweep+=ScalarCriteria::TwoPi;
                const double R=A.Distance(B)*1.15,T=Start+Sweep*.5;
                const Vec3 Q=A+(Ctx.Plane.AxisX*std::cos(T)+Ctx.Plane.AxisY*std::sin(T))*R;
                char Text[64];std::snprintf(Text,sizeof Text,"%.1f°",ScalarCriteria::Degrees(Sweep));Live.Dimensions.push_back({Q,Q,Text});
            }
        }
        else if (Classification == ToolChoice::Ellipse && Confirmed.size() > 1)
        {
            const Vec2 M = Ctx.Plane.ToLocal(B) - Ctx.Plane.ToLocal(A);
            const Vec2 N{-M.Y, M.X};
            const double Minor = std::fabs((Ctx.Plane.ToLocal(Live.Cursor) - Ctx.Plane.ToLocal(A)).Dot(N.Normalised()));
            Dimension(A, B, "a ", M.Length());
            Dimension(A, Ctx.Plane.ToWorld(Ctx.Plane.ToLocal(A) + N.Normalised() * Minor), "b ", Minor);
        }
        else {
            Dimension(Confirmed.back(), Live.Cursor, "", Confirmed.back().Distance(Live.Cursor),-14);
            if(Confirmed.size()>1)AngleDimension(Confirmed.back(),Confirmed[Confirmed.size()-2],Live.Cursor);
        }
    }
    if (Live.Lock != AxisLock::None) { std::snprintf(B, sizeof B, "lock %s", AxisLockName(Live.Lock)); Live.Readout.push_back(B); }
    if (!Live.NumericEntry.empty()) Live.Readout.push_back("typing: " + Live.NumericEntry);
    if (Live.Snap.Classification != SnapClassification::None && Live.Snap.Classification != SnapClassification::Free) { std::snprintf(B, sizeof B, "snap %s%s%s", SnapName(Live.Snap.Classification), Live.Snap.FigureIdentity ? " #" : "", Live.Snap.FigureIdentity ? std::to_string(Live.Snap.FigureIdentity).c_str() : ""); Live.Readout.push_back(B); }
}

} // namespace Frontier
