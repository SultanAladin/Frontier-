//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Console/ConsoleInteraction.cpp — Phase 3 commands: modal tools, synthetic pointer/keys, snapping, hotkeys, HUD
//============================================================================================================================================
// The console is the input device: `pointer x y` moves it, `click` presses, `key g` / `key shift+x` types, `type 3,4`
//    enters numbers — exactly the events a window would send. Everything a tool shows on screen (rubber band, snap
//    glyph, prompt line) is also printed, so a script transcript is a full account of the interaction.

#include "ConsoleHost.h"
#include "Presentation/ScenePresentation.h"
#include <cstring>
#include <iomanip>
#include <sstream>

namespace Frontier
{

namespace {
bool CurveWeights(const CommandLine& C,std::vector<double>& Out) {
    const auto Text=C.SwitchText("weights");if(!Text)return true;
    if(Text->empty()||Text->back()==',')return false;
    std::istringstream Input(*Text);std::string Part;
    while(std::getline(Input,Part,',')) {
        char* End=nullptr;const double V=std::strtod(Part.c_str(),&End);
        if(End==Part.c_str()||*End||!std::isfinite(V)||V<=0)return false;Out.push_back(V);
    }
    return !Out.empty();
}
}

// A user-facing new document is not the legacy `reset` command, which intentionally
// retains dimension IDs for old scripts. Clear all document metadata and the journal here.
void ConsoleHost::StartEmptyDocument() noexcept
{
    Tool.Cancel();
    if (GizmoRig.Dragging()) FinishGizmoAtView(true);
    Execute("reset");
    Dimensions.clear(); NextDimensionId = 1; NamedPlanes.clear();
    DocumentJournal.clear(); DocumentPath.clear();
    Mode = SelectMode::Whole; HoverPick = 0;
    View = CameraProjection{};
}

ToolSession::Context ConsoleHost::ToolContext() const noexcept
{
    ToolSession::Context C;
    C.Camera = &View; C.Scene = &Scene; C.Snap = &Snap; C.Plane = Plane;
    C.Width = Surface->Width(); C.Height = Surface->Height();
    const bool Selected = Mode == SelectMode::Whole ? Scene.SelectedCount() > 0 :
                          Mode == SelectMode::Face ? Scene.SelectedFaceCount() > 0 :
                          Mode == SelectMode::Edge ? Scene.SelectedEdgeCount() > 0 : Scene.SelectedPoleCount() > 0;
    C.SelectionPivot = Selected ? SelectionPivot() : Plane.Origin;
    return C;
}

void ConsoleHost::OnToolResult(const ToolResult& Result) noexcept
{
    if (!Result.Completed) { Row("tool: %s", Result.Summary.c_str()); if (Result.Summary.rfind("refused", 0) == 0) ToolReportedRefusal = true; return; }
    for(const auto& P:Result.ReferencePoints)
    {
        auto& Figure=AddEmpty(P,Result.ConstructionPoint?"DatumPoint":"Point");
        Figure.Construction=Result.ConstructionPoint;
        Figure.ShapeKind=Result.ConstructionPoint?"datum-point":"sketch-point";
        DescribeFigure(Figure);
    }
    for (const NurbsCurve& C : Result.Curves)
    {
        const char* Stem = Result.SourceTool==ToolChoice::Hermite ? "Hermite" : Result.SourceTool==ToolChoice::Bezier ? "Bezier" : Result.SourceTool==ToolChoice::BSpline ? "BSpline" : Result.SourceTool==ToolChoice::Nurbs ? "NURBS" : Result.SourceTool==ToolChoice::PolylineSlot ? "PolylineSlot" :
            C.Classification == CurveClassification::Freeform ? (Result.SourceTool == ToolChoice::ControlCurve ? "ControlCurve" : "Spline") : Describe(C.Classification);
        SceneFigure& Figure = Scene.AddCurve(Stem, C);
        Figure.ShapeKind=ToolName(Result.SourceTool);
        DescribeFigure(Figure);
    }
    if (Result.Curves.empty() && Result.ReferencePoints.empty())                         // transform
    {
        if (Mode != SelectMode::Whole)
        {
            // Synthetic modal tools use the same transactional component edit as the
            // windowed gizmo. A face/edge/vertex tool must never fall through to I.Transform().
            std::ostringstream Command;
            Command << std::setprecision(17) << "transform selected";
            for (double Cell : Result.Transform.M) Command << ' ' << Cell;
            Command << " --components";
            if (!Execute(Command.str())) ToolReportedRefusal = true;
            return;
        }
        int N = 0, Poles = 0;
        for (SceneFigure& I : Scene.Figures())
        {
            if (!I.Selected) continue;
            if (Mode == SelectMode::Control && !I.SelectedPoles.empty())                  // edit mode: only the chosen poles move
            {
                for (int P : I.SelectedPoles) { I.MovePole(P, Result.Transform.TransformPoint(I.PolePosition(P))); ++Poles; }
            }
            else I.Transform(Result.Transform);
            ++N; DescribeFigure(I);
        }
        if (Poles) Row("%s → %d pole(s) on %d figure(s)", Result.Summary.c_str(), Poles, N);
        else Row("%s → %d figure(s)", Result.Summary.c_str(), N);
    }
    else Row("tool: %s", Result.Summary.c_str());
}

bool ConsoleHost::Dispatch(const InputEvent& E) noexcept
{
    if (Tool.Active() && Tool.Receive(E))
    {
        if (Tool.Active())
        {
            const ToolPreview& P = Tool.Preview();
            std::string Line = std::string("[") + ToolName(Tool.CurrentTool()) + "] " + Tool.CurrentPrompt().Label;
            for (const std::string& R : P.Readout) Line += "  · " + R;
            Row("%s", Line.c_str());
        }
        return true;
    }
    if (E.Action == InputAction::KeyPress)
    {
        if (const HotkeyEntry* B = Hotkeys.Find(E.KeyCode, E.Modifiers))
        {
            Row("%s → %s", DescribeKeyChord(E.KeyCode, E.Modifiers).c_str(), B->Verb.c_str());
            return Execute(B->Verb);
        }
        return Refuse("%s is not bound", DescribeKeyChord(E.KeyCode, E.Modifiers).c_str());
    }
    const bool GizmoLive = GizmoShown && (Mode == SelectMode::Whole ? Scene.SelectedCount() > 0 :
        Mode == SelectMode::Face ? Scene.SelectedFaceCount() > 0 :
        Mode == SelectMode::Edge ? Scene.SelectedEdgeCount() > 0 : Scene.SelectedPoleCount() > 0);
    if (E.Action == InputAction::PointerMove && GizmoLive)
    {
        if (GizmoRig.Dragging())
        {
            (void)DragGizmoAtView(E.PixelX, E.PixelY, E.Ctrl());
            Row("gizmo %s%s", GizmoRig.Drag().Readout.c_str(), E.Ctrl() ? "  [snap]" : "");
            return true;
        }
        RefreshGizmoPivot();
        GizmoRig.AimAt(View);
        GizmoGrip H = GizmoRig.Locate(E.PixelX, E.PixelY, View, Surface->Width(), Surface->Height());
        if (H != GizmoRig.Hovered()) { GizmoRig.MarkHovered(H); Row("gizmo hover %s", GizmoGripName(H)); }
        if (H != GizmoGrip::None) return true;
    }
    if (E.Action == InputAction::PointerMove && !Tool.Active()) { HoverAtPixel(E.PixelX, E.PixelY); return false; }
    if (E.Action == InputAction::PointerPress && E.Button == PointerButton::Left && GizmoLive)
    {
        if (BeginGizmoAtView(E.PixelX, E.PixelY))
        {
            Row("gizmo grab %s", GizmoGripName(GizmoRig.Drag().Grip));
            return true;
        }
    }
    if (E.Action == InputAction::PointerRelease && GizmoRig.Dragging())
    {
        const std::string Readout = GizmoRig.Drag().Readout;
        (void)FinishGizmoAtView(false);
        Row("gizmo release %s", Readout.c_str());
        return true;
    }
    if (E.Action == InputAction::PointerPress && E.Button == PointerButton::Left)
    {
        SelectAtPixel(E.PixelX, E.PixelY, E.Shift() || E.Ctrl());
        return true;
    }
    if (E.Action == InputAction::Wheel) { View.Dolly(E.WheelSteps); return true; }
    return false;
}

void ConsoleHost::DrawToolPreview() noexcept
{
    if (!Tool.Active()) return;
    const ToolPreview& P = Tool.Preview();
    DrawRecord Band = ScenePresentation::Tinted(1.0f, 1.0f, 1.0f,.75f); Band.LineWidth = 1.0f;
    for (const NurbsCurve& C : P.Curves) Surface->DrawSegments(ScenePresentation::CurveSegments(C), Band);
    if (!P.Points.empty())
    {
        PointStream Pts; for (Vec3 Q : P.Points) Pts.Append(Q, PointGlyph::Disc);
        DrawRecord D = ScenePresentation::Tinted(1.0f, 0.85f, 0.35f); D.PointSize = 7.0f;
        Surface->DrawPoints(Pts, D);
    }
    SegmentStream Guides;
    SurfaceStream Arrows;
    const double W=Surface->Width(),H=Surface->Height();
    auto ScreenWorld=[&](double X,double Y){const Ray R=View.PixelRay(X,Y,W,H);return R.Origin+R.Direction*View.Distance;};
    for (const auto& Dimension : P.Dimensions)
    {
        if ((Dimension.B - Dimension.A).LengthSquared() < 1e-16) continue;
        Guides.Append(Dimension.A, Dimension.B);
        double AX,AY,BX,BY;
        if(!View.WorldToPixel(Dimension.A,W,H,AX,AY)||!View.WorldToPixel(Dimension.B,W,H,BX,BY))continue;
        const double L=std::hypot(BX-AX,BY-AY);if(L<1)continue;
        for(int End=0;End<2;++End) {
            const double X=End?BX:AX,Y=End?BY:AY,DX=(End?AX-BX:BX-AX)/L,DY=(End?AY-BY:BY-AY)/L;
            const Vec3 V[]={ScreenWorld(X,Y),ScreenWorld(X+7*DX-3*DY,Y+7*DY+3*DX),ScreenWorld(X+7*DX+3*DY,Y+7*DY-3*DX)};
            for(Vec3 Q:V) {Arrows.Triangles.push_back(Arrows.VertexCount());Arrows.Positions.insert(Arrows.Positions.end(),{float(Q.X),float(Q.Y),float(Q.Z)});Arrows.Normals.insert(Arrows.Normals.end(),{0,0,1});Arrows.Parameters.insert(Arrows.Parameters.end(),{0,0});}
        }
    }
    DrawRecord Guide=ScenePresentation::Tinted(1,1,1,.75f);Guide.LineWidth=1;
    Surface->DrawSegments(Guides,Guide);
    DrawRecord Arrow=ScenePresentation::Tinted(1,1,1,.85f);Arrow.Shading=3;
    if(!Arrows.Triangles.empty())Surface->DrawSurface(Arrows,Arrow);
    for(int Kind=0;Kind<2;++Kind) {
        const auto& Points=Kind?P.DimensionSpokes:P.AngleSegments;SegmentStream Lines;
        for(size_t I=1;I<Points.size();I+=2)Lines.Append(Points[I-1],Points[I]);
        DrawRecord Style=Kind?ScenePresentation::Tinted(1,1,1,.35f):ScenePresentation::Tinted(1,.645f,.188f,.9f);
        Style.LineWidth=Kind?1:1.2f;Style.Dashed=Kind!=0;
        if(!Points.empty())Surface->DrawSegments(Lines,Style);
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
    // Snap glyph: shape says which snap.
    if (P.Snap.Classification != SnapClassification::None)
    {
        PointGlyph Glyph = PointGlyph::Cross;
        switch (P.Snap.Classification)
        {
            case SnapClassification::Endpoint: case SnapClassification::ControlPoint: Glyph = PointGlyph::Disc; break;
            case SnapClassification::Midpoint: case SnapClassification::Quadrant:     Glyph = PointGlyph::Diamond; break;
            case SnapClassification::Centre: case SnapClassification::Origin:         Glyph = PointGlyph::Ring; break;
            case SnapClassification::Intersection:                          Glyph = PointGlyph::Cross; break;
            case SnapClassification::OnCurve: case SnapClassification::Perpendicular: case SnapClassification::Tangent: Glyph = PointGlyph::Disc; break;
            default:                                              Glyph = PointGlyph::Cross; break;
        }
        PointStream S; S.Append(P.Cursor, Glyph);
        bool Strong = P.Snap.Classification != SnapClassification::Free && P.Snap.Classification != SnapClassification::Lattice;
        DrawRecord D = Strong ? ScenePresentation::Tinted(0.35f, 0.90f, 0.95f) : ScenePresentation::Tinted(0.8f, 0.8f, 0.85f, 0.7f);
        D.PointSize = Strong ? 13.0f : 9.0f;
        Surface->DrawPoints(S, D);
    }
}

// Live pointer movement is a presentation gesture, not a document command.
// Sending it through Execute() took a full undo snapshot, area rebuild and
// parametric regeneration on every pixel of motion (then invalidated the raster).
void ConsoleHost::MoveToolPointer(double X, double Y, bool SuppressSnap) noexcept
{
    if (!Tool.Active()) return;
    PointerX = X;
    PointerY = Y;
    InputEvent Event{};
    Event.Action = InputAction::PointerMove;
    Event.PixelX = X;
    Event.PixelY = Y;
    Event.Modifiers = SuppressSnap ? ModifierCtrl : ModifierNone;
    (void)Tool.Receive(Event);
}

void ConsoleHost::RegisterInteraction() noexcept
{
    auto Add = [&](const char* Verb, const char* Help, Command Fn) { Commands[Verb] = std::move(Fn); Usage[Verb] = Help; };
    auto Number = [&](const CommandLine& C, size_t I, double& Out) -> bool { auto N = C.Number(I); if (!N) return false; Out = *N; return true; };
    auto Event = [&](InputAction A) { InputEvent E; E.Action = A; E.PixelX = PointerX; E.PixelY = PointerY; return E; };
    auto Modifiers = [&](const CommandLine& C) { uint8_t M = ModifierNone; if (C.Switch("shift")) M |= ModifierShift; if (C.Switch("ctrl")) M |= ModifierCtrl; if (C.Switch("alt")) M |= ModifierAlt; return M; };

    Add("input", "input <event + camera snapshot> — replayable native editor event", [=, this](const CommandLine& C)
    {
        if (C.Count() != 19 && C.Count()!=20) return Refuse("input: expected 19 or 20 event/camera fields");
        double N[20]={};
        for (size_t I = 0; I < C.Count(); ++I)
            if (!Number(C, I, N[I]) || !std::isfinite(N[I])) return Refuse("input: fields must be finite numbers");
        auto Integer = [&](int I, double Max) { return N[I] >= 0 && N[I] <= Max && std::floor(N[I]) == N[I]; };
        if (!Integer(0, unsigned(InputAction::Wheel)) || !Integer(3, unsigned(PointerButton::Right)) ||
            !Integer(4, 7) || !Integer(5, unsigned(Key::End)) || !Integer(6, 127) ||
            !Integer(8, 16384) || !Integer(9, 16384) || N[8] < 1 || N[9] < 1 ||
            N[12] <= 0 || !Integer(16, 1) || N[17] <= 0 || N[17] >= ScalarCriteria::Pi || N[18] <= 0)
            return Refuse("input: event or camera field out of range");
        InputEvent E;
        E.Action = InputAction(unsigned(N[0])); E.PixelX=N[1]; E.PixelY=N[2];
        E.Button=PointerButton(unsigned(N[3])); E.Modifiers=uint8_t(N[4]);
        E.KeyCode=Key(unsigned(N[5])); E.Character=char(N[6]); E.WheelSteps=N[7];
        ResizeViewport(uint32_t(N[8]),uint32_t(N[9]));
        View.Yaw=N[10]; View.Pitch=N[11]; View.Distance=N[12];View.Roll=0; // legacy field accepted, roll no longer applied
        View.Pivot={N[13],N[14],N[15]}; View.Orthographic=N[16]!=0; View.FovY=N[17]; View.Reach=N[18];
        PointerX=E.PixelX; PointerY=E.PixelY;
        ToolReportedRefusal=false;
        const bool Accepted = Dispatch(E);
        return !ToolReportedRefusal && (E.Action != InputAction::KeyPress || Accepted);
    });

    //---------------------------------------------- tools ----------------------------------------------
    // One document transaction, using exactly the same modal NURBS builder as native pointer input.
    // Browser rubber bands are presentation only; malformed/degenerate sequences cannot partially edit the scene.
    Add("draw", "draw <tool> (u,v) ... [--sides=N] [--closed] [--construction] — complete a modal sketch atomically", [=, this](const CommandLine& C)
    {
        if (C.Count() < 2) return Refuse("draw: tool and points required");
        auto Kind = ParseToolChoice(C.Arguments[0]);
        if (!Kind || *Kind == ToolChoice::Move || *Kind == ToolChoice::Rotate || *Kind == ToolChoice::Scale)
            return Refuse("draw: a sketch tool is required");
        std::vector<Vec3> Points;
        for (size_t I = 1; I < C.Count(); ++I)
        {
            auto P = C.Point(I);
            if (!P || !std::isfinite(P->X) || !std::isfinite(P->Y) || !std::isfinite(P->Z)) return Refuse("draw: finite points required");
            const bool Planar = C.Arguments[I].find(',') == C.Arguments[I].rfind(',');
            Points.push_back(Planar ? Plane.ToWorld({P->X, P->Y}) : *P);
        }
        ToolResult Result;
        ToolSession Draft;
        Draft.Begin(*Kind, ToolContext(), [&](const ToolResult& R) { Result = R; });
        const double Radius=C.SwitchNumber("radius").value_or(.25);
        if(!std::isfinite(Radius)||Radius<=0)return Refuse("draw: positive slot radius required");
        Draft.SetSlotRadius(Radius);
        const double Degree=C.SwitchNumber("degree").value_or(3);
        if(!std::isfinite(Degree)||Degree<1||Degree>7||std::floor(Degree)!=Degree)return Refuse("draw: degree must be an integer in 1..7");
        Draft.SetDegree(int(Degree));std::vector<double> Weights;
        if(!CurveWeights(C,Weights))return Refuse("draw: weights must be positive finite numbers separated by commas");
        Draft.SetControlWeights(std::move(Weights));
        const double Sides = C.SwitchNumber("sides").value_or(6);
        if (!std::isfinite(Sides) || Sides < 3 || Sides > 64 || std::floor(Sides) != Sides) return Refuse("draw: sides must be an integer in 3..64");
        if (*Kind == ToolChoice::Polygon) Draft.SupplyText("n" + std::to_string(int(Sides)));
        for (Vec3 P : Points)
            if (!Draft.Active() || !Draft.SupplyPoint(P)) return Refuse("draw: rejected point sequence");
        if (Draft.Active())
        {
            if (*Kind != ToolChoice::Polyline && *Kind != ToolChoice::PolylineSlot && *Kind != ToolChoice::Spline && *Kind != ToolChoice::ControlCurve && *Kind!=ToolChoice::Hermite && *Kind!=ToolChoice::Bezier && *Kind!=ToolChoice::BSpline && *Kind!=ToolChoice::Nurbs)
                return Refuse("draw: incomplete point sequence");
            Draft.Confirm();
        }
        if (!Result.Completed || (Result.Curves.empty()&&Result.ReferencePoints.empty())) return Refuse("draw: %s", Result.Summary.c_str());
        if (C.Switch("closed") && *Kind == ToolChoice::Polyline)
        {
            auto Closed = NurbsCurve::Polyline(Points, true);
            if (!Closed) return Refuse("draw: invalid closed polyline");
            Result.Curves = {Closed.Payload};
        }
        const size_t Before=Scene.Figures().size();
        OnToolResult(Result);
        for(size_t I=Before;I<Scene.Figures().size();++I)
            Scene.Figures()[I].Construction=C.Switch("construction")||Result.ConstructionPoint;
        return true;
    });

    Add("extrude-options","extrude-options — request the contextual Extrude parameter panel (E)",[this](const CommandLine&) {
        if(Tool.Active())return Refuse("extrude: finish or cancel the sketch first");
        const auto Faces=FaceExtrusionSelection();bool Profile=false;
        for(const auto& Op:SelectionOperations())if(Op.Key=="extrude")Profile=true;
        if(!Faces.Available&&!Profile)return Refuse("extrude: select a supported sketch profile or body face(s)");
        ExtrudeOptionsRequested=true;Row("Extrude parameters requested; Apply commits the distance and mode.");return true;
    });
    Add("tool", "tool <name> — start a modal tool: line polyline rect centerrect polygon slot circle circle2 circle3 arc arc3 ellipse spline cpcurve hermite bezier bspline nurbs move rotate scale  ·  tool cancel", [=, this](const CommandLine& C)
    {
        if (C.Count() < 1) return Refuse("tool: name required");
        if (C.Arguments[0] == "cancel") { Tool.Cancel(); return true; }
        if (C.Arguments[0] == "extrude")return Execute("extrude-options");
        auto K = ParseToolChoice(C.Arguments[0]);
        if (!K) return Refuse("tool: unknown tool '%s'", C.Arguments[0].c_str());
        if ((*K == ToolChoice::Move || *K == ToolChoice::Rotate || *K == ToolChoice::Scale) && Scene.Bounds(true).Empty()) return Refuse("tool %s: nothing selected", C.Arguments[0].c_str());
        ToolReportedRefusal = false;
        Tool.Begin(*K, ToolContext(), [this](const ToolResult& O) { OnToolResult(O); });
        Row("[%s] %s", ToolName(*K), Tool.CurrentPrompt().Label.c_str());
        return true;
    });
    Add("tool-options", "tool-options [--radius=m] [--clockwise=0|1] [--circumscribed=0|1] [--closed=0|1] [--sides=N] — journalled live sketch settings", [=, this](const CommandLine& C)
    {
        if(!Tool.Active()) return Refuse("tool-options: no active tool");
        for(const auto& Flag:C.Flags)
            if(Flag.first!="radius" && Flag.first!="clockwise" && Flag.first!="circumscribed" && Flag.first!="closed" && Flag.first!="sides" && Flag.first!="degree" && Flag.first!="weights")
                return Refuse("tool-options: unsupported setting");
        std::vector<double> Weights;if(!CurveWeights(C,Weights))return Refuse("tool-options: positive finite weights required");
        for(const auto& Flag:C.Flags)
        {
            if(Flag.first=="weights")continue;
            const auto V=C.SwitchNumber(Flag.first);
            if(!V || !std::isfinite(*V)) return Refuse("tool-options: finite numeric value required");
            if(Flag.first=="degree" && (*V<1||*V>7||std::floor(*V)!=*V))return Refuse("tool-options: degree must be in 1..7");
            if(Flag.first=="radius" && *V<=0) return Refuse("tool-options: radius must be positive");
            if(Flag.first=="sides" && (*V<3 || *V>64 || std::floor(*V)!=*V)) return Refuse("tool-options: sides must be an integer from 3 to 64");
            if((Flag.first=="clockwise" || Flag.first=="circumscribed" || Flag.first=="closed") && *V!=0 && *V!=1)
                return Refuse("tool-options: toggle must be 0 or 1");
        }
        if(C.SwitchText("weights"))Tool.SetControlWeights(std::move(Weights));
        if(auto V=C.SwitchNumber("degree"))Tool.SetDegree(int(*V));
        if(auto V=C.SwitchNumber("radius")) Tool.SetSlotRadius(*V);
        if(auto V=C.SwitchNumber("clockwise")) Tool.SetClockwise(*V!=0);
        if(auto V=C.SwitchNumber("circumscribed")) Tool.SetCircumscribed(*V!=0);
        if(auto V=C.SwitchNumber("closed")) Tool.SetClosed(*V!=0);
        if(auto V=C.SwitchNumber("sides")) Tool.SetSides(int(*V));
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
        if (Tool.Active()) { std::string L; for (const std::string& R : Tool.Preview().Readout) L += "  · " + R; Row("[%s] %s%s", ToolName(Tool.CurrentTool()), Tool.CurrentPrompt().Label.c_str(), L.c_str()); }
        return !ToolReportedRefusal;
    });
    Add("type", "type <text> — numeric entry: 3 · 2,4 · @1,1 (relative) · r2.5 (radius) · a45 (angle) · a30,2 (polar) · n6 (sides) · d2 (degree) · 3*2", [=, this](const CommandLine& C)
    {
        if (!Tool.Active()) return Refuse("type: no tool running");
        if (C.Count() < 1) return Refuse("type: text required");
        ToolReportedRefusal = false;
        if (!Tool.SupplyText(C.Arguments[0])) return Refuse("type: '%s' not understood here", C.Arguments[0].c_str());
        if (Tool.Active()) { std::string L; for (const std::string& R : Tool.Preview().Readout) L += "  · " + R; Row("[%s] %s%s", ToolName(Tool.CurrentTool()), Tool.CurrentPrompt().Label.c_str(), L.c_str()); }
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
        E.Button = C.Switch("right") ? PointerButton::Right : C.Switch("middle") ? PointerButton::Middle : PointerButton::Left;
        E.Modifiers = Modifiers(C);
        ToolReportedRefusal = false;
        Dispatch(E);
        return !ToolReportedRefusal;
    });
    Add("release", "release [--ctrl] — release the pointer button (ends a gizmo drag)", [=, this](const CommandLine& C)
    {
        InputEvent E = Event(InputAction::PointerRelease); E.Button = PointerButton::Left; E.Modifiers = Modifiers(C);
        if (!Dispatch(E)) Row("release: nothing held");
        return true;
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
    Add("snap", "snap on|off  ·  snap lattice|geometry|oncurve|axis|intersections on|off  ·  snap radius px  ·  snap step m  ·  snap status", [=, this](const CommandLine& C)
    {
        if (C.Count() >= 1 && C.Arguments[0] == "status") {}
        else if (C.Count() == 1) { if (C.Arguments[0] != "on" && C.Arguments[0] != "off") return Refuse("snap: on|off"); Snap.Enabled = C.Arguments[0] == "on"; }
        else if (C.Count() >= 2)
        {
            const std::string& K = C.Arguments[0]; bool On = C.Arguments[1] == "on"; double V = C.Number(1).value_or(0.0);
            if (K == "lattice") Snap.Lattice = On; else if (K == "geometry") Snap.Geometry = On; else if (K == "oncurve") Snap.OnCurve = On;
            else if (K == "axis") Snap.Axis = On; else if (K == "intersections") Snap.Intersections = On;
            else if (K == "radius") Snap.Radius = V; else if (K == "step") Snap.LatticeStep = V; else if (K == "angle") Snap.AngleStep = ScalarCriteria::Radians(V);
            else return Refuse("snap: unknown setting '%s'", K.c_str());
        }
        Row("snap %s  lattice %s (step %.3g)  geometry %s  on-curve %s  axis %s  intersections %s  radius %.0f px",
            Snap.Enabled ? "on" : "off", Snap.Lattice ? "on" : "off", Snap.LatticeStep, Snap.Geometry ? "on" : "off", Snap.OnCurve ? "on" : "off", Snap.Axis ? "on" : "off", Snap.Intersections ? "on" : "off", Snap.Radius);
        return true;
    });
    Add("inspect", "inspect x y — report what the cursor would snap to at a pixel, without a tool", [=, this](const CommandLine& C)
    {
        double X, Y; if (!Number(C, 0, X) || !Number(C, 1, Y)) return Refuse("inspect: x y required");
        SnapCandidate S = SnapResolution::Resolve(X, Y, View, Surface->Width(), Surface->Height(), Plane, Scene, Snap, nullptr);
        Row("inspect (%d,%d) → %s at (%.4f %.4f %.4f)%s%u  %.1f px", int(X), int(Y), SnapName(S.Classification), S.Position.X, S.Position.Y, S.Position.Z, S.FigureIdentity ? "  #" : "  ", S.FigureIdentity, S.PixelDistance);
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
    Add("hotkeys", "hotkeys [sift] — print the hotkey chart", [=, this](const CommandLine& C)
    {
        std::string Needle = C.Count() ? C.Arguments[0] : "";
        int N = 0;
        for (const HotkeyEntry& B : Hotkeys.Bindings())
        {
            if (!Needle.empty() && B.Verb.find(Needle) == std::string::npos && B.Description.find(Needle) == std::string::npos) continue;
            std::printf("  %-16s %-24s %s\n", DescribeKeyChord(B.KeyCode, B.Modifiers).c_str(), B.Verb.c_str(), B.Description.c_str()); ++N;
        }
        Row("%d hotkey(s)", N);
        return true;
    });
    Add("repeat", "repeat — run the previous command again (Shift+R)", [=, this](const CommandLine&)
    {
        if (LastCommand.empty()) return Refuse("repeat: nothing to repeat");
        return Execute(LastCommand);
    });
    Add("hud", "hud — print the modal tool status: tool, prompt, points, lock, snap, readout", [=, this](const CommandLine&)
    {
        if (!Tool.Active()) { Row("no tool running  ·  workplane origin (%.2f %.2f %.2f)  ·  pointer (%d,%d)", Plane.Origin.X, Plane.Origin.Y, Plane.Origin.Z, int(PointerX), int(PointerY)); return true; }
        const ToolPreview& P = Tool.Preview();
        Row("tool %s  prompt %zu/%zu '%s'  lock %s  snap %s", ToolName(Tool.CurrentTool()), Tool.CurrentPromptIndex() + 1, (size_t)0 + Tool.CurrentPromptIndex() + 1, Tool.CurrentPrompt().Label.c_str(), AxisLockName(P.Lock), SnapName(P.Snap.Classification));
        for (size_t I = 0; I < P.Points.size(); ++I) Row("  point %zu (%.4f %.4f %.4f)", I, P.Points[I].X, P.Points[I].Y, P.Points[I].Z);
        Row("  cursor (%.4f %.4f %.4f)", P.Cursor.X, P.Cursor.Y, P.Cursor.Z);
        for (const std::string& R : P.Readout) Row("  %s", R.c_str());
        return true;
    });
    // "view toggle" for Numpad5 and the show toggles referenced by the chart.
    Add("selectmode", "selectmode control|edge|face|whole|cycle|status — 1/2/3/4 and Tab", [=, this](const CommandLine& C)
    {
        const std::string A = C.Count() ? C.Arguments[0] : "status";
        SelectMode Next = Mode;
        if (A == "control") Next = SelectMode::Control; else if (A == "edge") Next = SelectMode::Edge; else if (A == "face") Next = SelectMode::Face;
        else if (A == "whole" || A == "solid") Next = SelectMode::Whole;
        else if (A == "cycle") Next = Mode == SelectMode::Whole ? SelectMode::Control : SelectMode::Whole;   // Blender Tab: whole ⇄ edit (control points)
        else if (A != "status") return Refuse("selectmode: control|edge|face|whole|cycle|status");
        if (Next != Mode)
        {
            // Changing mode drops the sub-selection of the mode being left; figure selection persists.
            for (SceneFigure& I : Scene.Figures()) { I.SelectedPoles.clear(); I.SelectedFaces.clear(); I.SelectedEdges.clear(); }
            Mode = Next;
        }
        Row("select mode %s  ·  %d figure(s), %d pole(s), %d face(s), %d edge(s) selected", SelectModeName(Mode), Scene.SelectedCount(), Scene.SelectedPoleCount(), Scene.SelectedFaceCount(), Scene.SelectedEdgeCount());
        return true;
    });
}

} // namespace Frontier
