//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ControlCentreHost.cpp — Top Notch Control Centre: Drawer Locomotion, Notch Travel and Overlay Recording
//============================================================================================================================================

#include "ControlCentreHost.h"

#include <algorithm>
#include <cmath>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                     LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

ControlCentreHost::ControlCentreHost() noexcept
    : DisplayWidth(1920u)
    , DisplayHeight(1080u)
    , Motion{}
    , ShadeChannel(0u)
    , NotchChannel(0u)
    , SlideChannel(0u)
    , Pose(ControlCentreHostState::Closed)
    , OpenBeforeGrab(false)
    , GrabbedSubject(GrabSubject::Nothing)
    , Grabbed(false)
    , Hovered(false)
    , PointerWithheld(false)
    , PreviousButton(false)
    , AxisResolved(false)
    , YDominant(false)
    , TravelExceeded(false)
    , ContactDuration(0.0)
    , GrabCursorX(0.0f), GrabCursorY(0.0f)
    , GrabShadeY(0.0)
    , GrabNotchX(0.0)
    , PreviousCursorX(0.0f), PreviousCursorY(0.0f)
    , RateX(0.0), RateY(0.0)
    , LastDeltaSeconds(1.0f / 60.0f)
    , ActivePage(ControlCentrePageCategory::Dashboard)
    , PreviousPage(ControlCentrePageCategory::Dashboard)
    , ActiveAppearanceSubTab(AppearanceSubTabCategory::Theme)
    , ActiveDialogue(DialogueCategory::None)
    , PageHistoryStack{}
    , ActiveTheme{}
    , ProjectName("Frontier")
    , HandleContour{}
    , InitializedCondition(false)
{
    ShadeChannel = Motion.Register(0.0);
    NotchChannel = Motion.Register(0.0);
    SlideChannel = Motion.Register(0.0);

    ActiveTheme.AssignTheme(ThemeCategory::Dark);   // 📝 dark is the default per direction; palette below
}

bool ControlCentreHost::Initialize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept
{
    DisplayWidth  = std::max(1u, DesiredWidth);
    DisplayHeight = std::max(1u, DesiredHeight);

    Motion.Spring(ShadeChannel).Place(0.0);
    Motion.Spring(NotchChannel).Place(0.0);
    Motion.Spring(SlideChannel).Place(0.0);

    Pose = ControlCentreHostState::Closed;
    GenerateHandleContour();
    InitializedCondition = true;
    return true;
}

void ControlCentreHost::Terminate() noexcept
{
    InitializedCondition = false;
    HandleContour.clear();
    PageHistoryStack.clear();
}

void ControlCentreHost::Resize(uint32_t DesiredWidth, uint32_t DesiredHeight) noexcept
{
    const bool WasOpen = (Pose == ControlCentreHostState::Open);
    DisplayWidth  = std::max(1u, DesiredWidth);
    DisplayHeight = std::max(1u, DesiredHeight);

    // 📝 Keep an open shade open at the new height and the notch inside the new admissible travel.
    if (WasOpen) Motion.Spring(ShadeChannel).Place(OpenTravel());
    SpringChannel& Notch = Motion.Spring(NotchChannel);
    const double Admissible = NotchAdmissible();
    Notch.Place(std::clamp(Notch.Current, -Admissible, Admissible));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PAGE NAVIGATION  (state only in this step)
//------------------------------------------------------------------------------------------------------------------------

void ControlCentreHost::NavigateToPage(ControlCentrePageCategory TargetPage) noexcept
{
    if (ActivePage == TargetPage) return;
    PageHistoryStack.push_back(ActivePage);
    PreviousPage = ActivePage;
    ActivePage   = TargetPage;
    Motion.Spring(SlideChannel).Place(static_cast<double>(DisplayWidth) * 0.65);
    Motion.Spring(SlideChannel).Depart(0.0);
}

void ControlCentreHost::NavigateBack() noexcept
{
    if (PageHistoryStack.empty())
    {
        if (ActivePage == ControlCentrePageCategory::Dashboard) return;
        PreviousPage = ActivePage;
        ActivePage   = ControlCentrePageCategory::Dashboard;
    }
    else
    {
        PreviousPage = ActivePage;
        ActivePage   = PageHistoryStack.back();
        PageHistoryStack.pop_back();
    }
    Motion.Spring(SlideChannel).Place(-static_cast<double>(DisplayWidth) * 0.65);
    Motion.Spring(SlideChannel).Depart(0.0);
}

float ControlCentreHost::QuerySlideOffset() const noexcept
{
    return static_cast<float>(Motion.Spring(SlideChannel).Current);
}

bool ControlCentreHost::IsSlideTransitionActive() const noexcept
{
    return !Motion.Spring(SlideChannel).Settled;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 NOTCH OUTLINE TESSELLATION
//------------------------------------------------------------------------------------------------------------------------
// SVG (ArcNotch.tsx):  M 0 0  C 15 0, 20 6, 25 15  L 35 28  C 40 34, 45 36, 52 36  L 348 36
//                      C 355 36, 360 34, 365 28  L 375 15  C 380 6, 385 0, 400 0  Z

namespace {

BezierPointIndex SampleCubic(BezierPointIndex P0, BezierPointIndex P1, BezierPointIndex P2, BezierPointIndex P3, float T) noexcept
{
    const float U  = 1.0f - T;
    const float B0 = U * U * U;
    const float B1 = 3.0f * U * U * T;
    const float B2 = 3.0f * U * T * T;
    const float B3 = T * T * T;
    return BezierPointIndex{ B0 * P0.X + B1 * P1.X + B2 * P2.X + B3 * P3.X,
                             B0 * P0.Y + B1 * P1.Y + B2 * P2.Y + B3 * P3.Y };
}

void AppendCubic(std::vector<BezierPointIndex>& Out, BezierPointIndex P0, BezierPointIndex P1, BezierPointIndex P2, BezierPointIndex P3) noexcept
{
    constexpr int Segments = 16;
    for (int Step = 1; Step <= Segments; ++Step)
        Out.push_back(SampleCubic(P0, P1, P2, P3, static_cast<float>(Step) / static_cast<float>(Segments)));
}

} // namespace

void ControlCentreHost::GenerateHandleContour() noexcept
{
    HandleContour.clear();
    HandleContour.reserve(80);

    HandleContour.push_back({ 0.0f, 0.0f });                                                       // M 0 0
    AppendCubic(HandleContour, { 0.0f, 0.0f },   { 15.0f, 0.0f },  { 20.0f, 6.0f },   { 25.0f, 15.0f });  // C
    HandleContour.push_back({ 35.0f, 28.0f });                                                     // L 35 28
    AppendCubic(HandleContour, { 35.0f, 28.0f }, { 40.0f, 34.0f }, { 45.0f, 36.0f },  { 52.0f, 36.0f });  // C
    HandleContour.push_back({ 348.0f, 36.0f });                                                    // L 348 36
    AppendCubic(HandleContour, { 348.0f, 36.0f },{ 355.0f, 36.0f },{ 360.0f, 34.0f }, { 365.0f, 28.0f }); // C
    HandleContour.push_back({ 375.0f, 15.0f });                                                    // L 375 15
    AppendCubic(HandleContour, { 375.0f, 15.0f },{ 380.0f, 6.0f }, { 385.0f, 0.0f },  { 400.0f, 0.0f });  // C
    // Z — the polygon filler closes back to (0, 0)
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

float ControlCentreHost::QueryCurrentHeight() const noexcept
{
    return static_cast<float>(Motion.Spring(ShadeChannel).Current);
}

float ControlCentreHost::QueryHandleX() const noexcept
{
    return (static_cast<float>(DisplayWidth) - NotchWidth) * 0.5f + static_cast<float>(Motion.Spring(NotchChannel).Current);
}

PlaneExtent ControlCentreHost::QueryHandleExtent() const noexcept
{
    return Spanning(QueryHandleX(), QueryCurrentHeight(), NotchWidth, NotchHeight);
}

double ControlCentreHost::NotchAdmissible() const noexcept
{
    const double Limit = (static_cast<double>(DisplayWidth) - NotchWidth) * 0.5;
    return Limit > 0.0 ? Limit : 0.0;
}

double ControlCentreHost::Constrain(double Value, double Minimum, double Maximum, double Elasticity) noexcept
{
    if (Value < Minimum) return Minimum - (Minimum - Value) * Elasticity;
    if (Value > Maximum) return Maximum + (Value - Maximum) * Elasticity;
    return Value;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       COMMANDS
//------------------------------------------------------------------------------------------------------------------------

void ControlCentreHost::Depart(bool Opening) noexcept
{
    Motion.Spring(ShadeChannel).Depart(Opening ? OpenTravel() : 0.0);
    Pose = Opening ? ControlCentreHostState::Opening : ControlCentreHostState::Closing;
}

void ControlCentreHost::OpenNotch()  noexcept { Depart(true);  }
void ControlCentreHost::CloseNotch() noexcept { Depart(false); }
void ControlCentreHost::ToggleNotch() noexcept { Depart(!IsOpen()); }

//------------------------------------------------------------------------------------------------------------------------
//                                                      INTERACTION
//------------------------------------------------------------------------------------------------------------------------

void ControlCentreHost::Grab(GrabSubject Subject, float CursorX, float CursorY) noexcept
{
    GrabbedSubject  = Subject;
    Grabbed         = true;
    AxisResolved    = false;
    YDominant       = false;
    TravelExceeded  = false;
    ContactDuration = 0.0;
    GrabCursorX     = CursorX;
    GrabCursorY     = CursorY;
    GrabShadeY      = Motion.Spring(ShadeChannel).Current;
    GrabNotchX      = Motion.Spring(NotchChannel).Current;
    OpenBeforeGrab  = IsOpen();
    RateX = RateY   = 0.0;

    if (Subject == GrabSubject::Notch)
    {
        // 📝 Pin both springs where they stand; the pointer owns them until release.
        Motion.Spring(ShadeChannel).Place(GrabShadeY);
        Motion.Spring(NotchChannel).Place(GrabNotchX);
        Pose = ControlCentreHostState::Dragging;
    }
}

void ControlCentreHost::Carry(float CursorX, float CursorY, float DeltaSeconds) noexcept
{
    // 📐 Pointer velocity estimate (px/s), smoothed with 60 % retention of the previous tick's estimate.
    if (DeltaSeconds > 0.0f)
    {
        const double InstantX = static_cast<double>(CursorX - PreviousCursorX) / DeltaSeconds;
        const double InstantY = static_cast<double>(CursorY - PreviousCursorY) / DeltaSeconds;
        RateX = RateRetention * RateX + (1.0 - RateRetention) * InstantX;
        RateY = RateRetention * RateY + (1.0 - RateRetention) * InstantY;
    }

    if (GrabbedSubject != GrabSubject::Notch) return;

    const double TravelX = static_cast<double>(CursorX - GrabCursorX);
    const double TravelY = static_cast<double>(CursorY - GrabCursorY);

    if (!TravelExceeded && (std::fabs(TravelX) > TapTravelLimit || std::fabs(TravelY) > TapTravelLimit))
        TravelExceeded = true;

    // 📐 The axis is decided ONCE, on the first travel that clears the tap ceiling, by the larger displacement.
    //    Deciding per tick makes a diagonal drag alternate between sliding the notch and opening the shade.
    if (!AxisResolved && TravelExceeded)
    {
        YDominant    = std::fabs(TravelY) > std::fabs(TravelX);
        AxisResolved = true;
    }

    if (!AxisResolved) return;

    if (YDominant)
    {
        const double Dragged = GrabShadeY + TravelY;
        Motion.Spring(ShadeChannel).Place(Constrain(Dragged, 0.0, OpenTravel(), DragElasticity));
    }
    else
    {
        const double Admissible = NotchAdmissible();
        const double Dragged    = GrabNotchX + TravelX;
        Motion.Spring(NotchChannel).Place(Constrain(Dragged, -Admissible, Admissible, DragElasticity));
    }
}

void ControlCentreHost::Relinquish() noexcept
{
    if (!Grabbed) return;

    const bool Tap = !TravelExceeded && ContactDuration <= TapDurationLimit;

    if (GrabbedSubject == GrabSubject::Scrim)
    {
        // 📝 A tap on the scrim while open closes the shade. A drag that started on the scrim does nothing.
        if (Tap && IsOpen()) Depart(false);
    }
    else if (GrabbedSubject == GrabSubject::Notch)
    {
        if (Tap)
        {
            // 📝 A notch that cannot be tapped is a notch the user reports as dead.
            Depart(!OpenBeforeGrab);
        }
        else if (!YDominant)
        {
            // Horizontal slide: settle inside the admissible band (undo the elastic overshoot).
            SpringChannel& Notch = Motion.Spring(NotchChannel);
            const double Admissible = NotchAdmissible();
            Notch.Depart(std::clamp(Notch.Current, -Admissible, Admissible));
            Pose = OpenBeforeGrab ? ControlCentreHostState::Open : ControlCentreHostState::Closed;
        }
        else
        {
            // Vertical carry — Notch ArcNotch.tsx handleDragEnd, verbatim:
            //   y > H/2 : close only if velocity < −20 px/s or offset < −50 px, else open
            //   y < H/2 : open  only if velocity >  20 px/s or offset >  50 px, else close
            const double ShadeY       = Motion.Spring(ShadeChannel).Current;
            const double Displacement = ShadeY - GrabShadeY;

            bool Opening;
            if (ShadeY > static_cast<double>(DisplayHeight) * 0.5)
                Opening = !(RateY < -SnapRate || Displacement < -SnapOffset);
            else
                Opening =  (RateY >  SnapRate || Displacement >  SnapOffset);

            Depart(Opening);

            // 📐 The release's own rate is injected rather than discarded: a spring departing from rest
            //    arrives visibly later than the flick that asked for it.
            Motion.Spring(ShadeChannel).Rate = RateY;
        }
    }

    Grabbed        = false;
    GrabbedSubject = GrabSubject::Nothing;
}

void ControlCentreHost::AdvanceInteraction(const InputExchange& Input, float CursorX, float CursorY) noexcept
{
    if (!InitializedCondition) return;

    const bool Button = Input.IsMouseButtonPressed(MouseButtonCategory::ButtonLeft);
    const bool Pressed  =  Button && !PreviousButton;
    const bool Released = !Button &&  PreviousButton;
    PreviousButton = Button;

    const PlaneExtent Handle = QueryHandleExtent();
    Hovered = Handle.Encloses(CursorX, CursorY);

    // Shade content extent: everything above the notch's top edge.
    const bool OverShade = CursorY < QueryCurrentHeight();
    const bool ShadeOpenish = QueryCurrentHeight() > 50.0f;   // Notch: scrim intercepts pointer once y > 50

    if (Pressed)
    {
        if (Hovered)                      Grab(GrabSubject::Notch, CursorX, CursorY);
        else if (ShadeOpenish && !OverShade) Grab(GrabSubject::Scrim, CursorX, CursorY);
    }

    if (Grabbed && Button)
        Carry(CursorX, CursorY, LastDeltaSeconds);

    if (Released)
        Relinquish();

    // 📝 The overlay owns the pointer while it is over the notch, over the pulled-down shade, or during a grab —
    //    hosts use this to keep the pointer away from the scene camera / project panels.
    PointerWithheld = Hovered || Grabbed || ShadeOpenish;

    PreviousCursorX = CursorX;
    PreviousCursorY = CursorY;
}

void ControlCentreHost::AdvanceLocomotion(float DeltaSeconds) noexcept
{
    if (!InitializedCondition || DeltaSeconds <= 0.0f) return;

    LastDeltaSeconds = DeltaSeconds;
    if (Grabbed) ContactDuration += DeltaSeconds;

    Motion.Advance(static_cast<double>(DeltaSeconds));

    // Settle the pose once the shade spring comes to rest.
    if (Pose == ControlCentreHostState::Opening && Motion.Spring(ShadeChannel).Settled) Pose = ControlCentreHostState::Open;
    if (Pose == ControlCentreHostState::Closing && Motion.Spring(ShadeChannel).Settled) Pose = ControlCentreHostState::Closed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RECORDING
//------------------------------------------------------------------------------------------------------------------------

void ControlCentreHost::Record(RecordingSurface& Surface) const noexcept
{
    if (!InitializedCondition || !Surface.IsRecording()) return;

    const float W      = static_cast<float>(DisplayWidth);
    const float H      = static_cast<float>(DisplayHeight);
    const float ShadeY = QueryCurrentHeight();                    // lower edge of the sheet / top of the notch
    const float NotchX = QueryHandleX();

    // 📐 ArcNotch.tsx hard-codes the sheet and notch to #0A0A0B and the caption to text-white/50 regardless of
    //    the selected theme (the theme only recolours the cards inside the shade). Reproduced verbatim.
    constexpr ColorQuad Sheet{ 10.0f / 255.0f, 10.0f / 255.0f, 11.0f / 255.0f, 1.0f };   // #0A0A0B
    constexpr ColorQuad Label{ 1.0f, 1.0f, 1.0f, 0.5f };                                  // white / 50

    // ① Scrim: black, opacity 0 → 0.4 across the travel (Notch: useTransform(y, [0, H], [0, 0.4]) on bg-black/50).
    const float Travel = static_cast<float>(OpenTravel());
    const float Progress = Travel > 0.0f ? std::clamp(ShadeY / Travel, 0.0f, 1.0f) : 0.0f;
    if (Progress > 0.0f)
        Surface.FillRectangle(Spanning(0.0f, 0.0f, W, H), ColorQuad{ 0.0f, 0.0f, 0.0f, ScrimMaxAlpha * Progress });

    // ② Shade sheet: full width, from far above the top edge down to the notch's top.
    if (ShadeY > 0.0f)
        Surface.FillRectangle(PlaneExtent{ 0.0f, -2000.0f, W, ShadeY }, Sheet);

    // ③ Notch handle: tessellated SVG outline translated to (NotchX, ShadeY).
    std::vector<PlanePoint> Outline;
    Outline.reserve(HandleContour.size());
    for (const BezierPointIndex& P : HandleContour)
        Outline.push_back(PlanePoint{ NotchX + P.X, ShadeY + P.Y });
    Surface.FillPolygon(Outline.data(), static_cast<uint32_t>(Outline.size()), Sheet);

    // ④ Project name centred in the handle (Notch: 13 px, font-medium, text-white/50, pb-1 → 4 px lift).
    constexpr float LabelSize = 13.0f;
    const PlanePoint Measured = Surface.MeasureText(ProjectName.c_str(), LabelSize);
    const float TextX = NotchX + (NotchWidth  - Measured.X) * 0.5f;
    const float TextY = ShadeY + (NotchHeight - Measured.Y) * 0.5f - 2.0f;
    Surface.Text(TextX, TextY, Label, ProjectName.c_str(), LabelSize);
}

} // namespace Frontier
