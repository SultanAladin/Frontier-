//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/EditorTheme.h"
#include "../../../../../Engine/Editor/CadWidgets.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <filesystem>
#include <cstdlib>

namespace Frontier {

SolidArcEditorHost::SolidArcEditorHost() noexcept
{
    Outliner_.AssignControls(&Controls_);
    Outliner_.AssignFrameless(false); Outliner_.AssignCadPresentation(true);
    Inspector_.AssignCadPresentation(true);
    Viewport_.AssignFrameless(false); Viewport_.AssignBrowserCadChrome(true);
    Inspector_.AssignFrameless(false);
    Viewport_.AssignControls(&Controls_);
    Inspector_.AssignControls(&Controls_);
    Outliner_.AssignTabOpen(&OutlinerTabOpen_);
    Viewport_.AssignTabOpen(&ViewportTabOpen_);
    Inspector_.AssignTabOpen(&InspectorTabOpen_);
    Outliner_.AssignWindowTitle("Outliner###SolidArc Outliner");
    Viewport_.AssignWindowTitle("Viewport###SolidArc Viewport");
    Inspector_.AssignWindowTitle("Inspector###SolidArc Inspector");
    // SolidArc uses its CAD filter catalogue, not Project-Zero's game narrowing labels.
    // Colours match the web editor KINDS palette: curve/sketch #4fd8e0, body #ffb454,
    // surface #4da3ff, construction plane #b48cff and dimensions #e5d33a.
    const OutlinerFilterEntry SolidArcFilters[] =
    {
        {"Bodies", IM_COL32(255,180,84,255), SolidArcOutlinerFilter::Bodies},
        {"Sketches", IM_COL32(79,216,224,255), SolidArcOutlinerFilter::Lines | SolidArcOutlinerFilter::Profiles},
        {"Surfaces", IM_COL32(77,163,255,255), SolidArcOutlinerFilter::Surfaces},
    };
    Outliner_.AssignFilterCatalog(SolidArcFilters, static_cast<uint32_t>(sizeof(SolidArcFilters) / sizeof(SolidArcFilters[0])));
    Viewport_.AssignChrome(ViewportPanelChrome::SolidArcCad);
    Viewport_.AssignExternalCadInput(true);
    Outliner_.AssignReadout(&Readout_);
    Viewport_.AssignReadout(&Readout_);
    Inspector_.AssignReadout(&Readout_);
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
    ImGuiStyle& Style = ImGui::GetStyle();
#ifdef FRONTIER_DEVELOPMENT
    Style.TabSlant                  = 14.0f;
    Style.TabOverlap                = 24.0f;
    Style.TabHeight                 = 24.0f;
    Style.TabStripPadTop            = 4.0f;
    Style.TabMinWidthBase           = 110.0f;
    Style.TabMinWidthShrink         = 110.0f;
    Style.DockingNodeHasCloseButton = false;
    Style.TabRounding               = 0.0f;
    Style.TabBorderSize             = 0.0f;
    Style.TabBarBorderSize          = 0.0f;
    Style.TabButtonRounding         = 1.0f;
#endif
    Style.WindowMenuButtonPosition = ImGuiDir_None; // No ImGui caret/menu in CAD tab strips.
    Style.WindowPadding    = ImVec2(14.0f, 12.0f);
    Style.WindowRounding   = 8.0f;
    Style.ChildRounding    = 12.0f;
    Style.FrameRounding    = 16.0f;
    Style.WindowBorderSize = 1.0f;
    Style.FrameBorderSize  = 1.0f;
    Style.ScrollbarSize    = 8.0f;

    ImVec4* Colours = Style.Colors;
    Colours[ImGuiCol_WindowBg]       = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_ChildBg]        = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Colours[ImGuiCol_Border]         = ImVec4(1.000f, 1.000f, 1.000f, 0.05f);
    Colours[ImGuiCol_FrameBg]        = ImVec4(0.000f, 0.000f, 0.000f, 1.0f);
    Colours[ImGuiCol_TitleBg]        = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgActive]  = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgCollapsed] = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_Button]         = ImVec4(0.133f, 0.133f, 0.133f, 1.0f);
    Colours[ImGuiCol_ButtonHovered]  = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_Header]         = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Colours[ImGuiCol_Text]=ImVec4(.94f,.94f,.94f,1);
    ApplyEditorControlTheme(Style);
    ApplyPanelTabTheme(Style);
    Colours[ImGuiCol_DockingPreview] = ImVec4(1.000f, 1.000f, 1.000f, 0.12f);
}

void SolidArcEditorHost::ConstructLayout() noexcept
{
    const ImGuiID DockId = ImGui::GetID("SolidArcEditorDockSpace");
    if (LayoutSeated_)
        return;
    LayoutSeated_ = true;

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::DockBuilderRemoveNode(DockId);
    ImGui::DockBuilderAddNode(DockId, ImGuiDockNodeFlags_DockSpace | ImGuiDockNodeFlags_NoWindowMenuButton);
    ImGui::DockBuilderSetNodePos(DockId,ImGui::GetCursorScreenPos());
    ImGui::DockBuilderSetNodeSize(DockId, ImGui::GetContentRegionAvail());

    ImGuiID Left = 0u, CentreAndRight = 0u, Centre = 0u, Right = 0u;
    const float LeftShare = Main->Size.x > 0.0f ? std::clamp(236.0f / Main->Size.x, 0.15f, 0.26f) : 0.18f;
    ImGui::DockBuilderSplitNode(DockId, ImGuiDir_Left, LeftShare, &Left, &CentreAndRight);
    const float RestWidth = std::max(1.0f, Main->Size.x * (1.0f - LeftShare));
    const float RightShare = std::clamp(236.0f / RestWidth, 0.16f, 0.28f);
    ImGui::DockBuilderSplitNode(CentreAndRight, ImGuiDir_Right, RightShare, &Right, &Centre);
    ImGui::DockBuilderDockWindow("Outliner###SolidArc Outliner", Left);
    ImGui::DockBuilderDockWindow("Viewport###SolidArc Viewport", Centre);
    ImGui::DockBuilderDockWindow("Inspector###SolidArc Inspector", Right);
    LeftColumn_ = Left;
    CentreColumn_ = Centre;
    RightColumn_ = Right;
    ImGui::DockBuilderFinish(DockId);
}

void SolidArcEditorHost::Record(ConsoleHost& Host) noexcept
{
    VisibleControls_.clear();
    if (Viewport_.QueryViewWidth()>1 && Viewport_.QueryViewHeight()>1)
        Host.SeatSurface(uint32_t(Viewport_.QueryViewWidth()),uint32_t(Viewport_.QueryViewHeight()),1);
    if(CameraSeated_ && Viewport_.QueryViewportOrbit().Revision==OrbitRevision_)
    {
        const auto& C=Host.Camera(); const auto& O=Viewport_.QueryViewportOrbit();
        if(std::abs(C.Yaw-O.Yaw)>1e-5 || std::abs(C.Pitch+O.Pitch)>1e-5 || std::abs(C.Roll-O.Roll)>1e-5 || std::abs(C.Distance-O.Distance)>1e-4 ||
           C.Orthographic!=O.Ortho || std::abs(C.Pivot.X-O.Target[0])+std::abs(C.Pivot.Y-O.Target[1])+std::abs(C.Pivot.Z-O.Target[2])>1e-4)
            CameraSeated_=false;
    }
    if (!CameraSeated_)
    {
        const auto& C = Host.Camera();
        ViewportOrbit Orbit;
        Orbit.Yaw = float(C.Yaw); Orbit.Pitch = float(-C.Pitch); Orbit.Roll=float(C.Roll);
        Orbit.Distance = float(C.Distance); Orbit.Ortho = C.Orthographic;
        Orbit.Target[0] = float(C.Pivot.X); Orbit.Target[1] = float(C.Pivot.Y); Orbit.Target[2] = float(C.Pivot.Z);
        Viewport_.SeatViewportOrbit(Orbit);
        OrbitRevision_ = Viewport_.QueryViewportOrbit().Revision;
        CameraSeated_ = true;
    }
    Host.Render();
    if (!DeviceTexture_) ViewImage_ = Host.Raster().Readback();
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Bindings_.data(), kMaxEditorInstances, &Readout_, true);
    if (DeviceTexture_)
        Viewport_.AssignViewTexture(DeviceTexture_, Host.Raster().Width(), Host.Raster().Height());
    else if (!ViewImage_.Pixels.empty())
        Viewport_.AssignView(ViewImage_.Pixels.data(), ViewImage_.Width, ViewImage_.Height);
    else
        Viewport_.AssignView(nullptr, 0u, 0u);

    // Dock nodes, not fixed-position panels. The patched tab renderer supplies
    // both the document strip and the three movable panel tabs.
    RecordWorkspaceChrome(Host);

    uint32_t ModelSelection = 0;
    for (const auto& Figure : Host.AllFigures())
        if (Figure.Selected || !Figure.SelectedFaces.empty() || !Figure.SelectedEdges.empty() || !Figure.SelectedPoles.empty())
        { ModelSelection = Figure.Identity; break; }
    if (ModelSelection != LastModelSelection_)
    {
        uint32_t SelectedRow=kNoEditorInstance;
        for (uint32_t I=0;I<RowCount_;++I)
            if (Bindings_[I].RowRole==SolidArcOutlinerBinding::Role::Figure && Bindings_[I].FigureIdentity==ModelSelection) SelectedRow=I;
        Outliner_.PickInstance(SelectedRow);
        LastModelSelection_=ModelSelection;
    }
    Outliner_.Record(Rows_.data(), RowCount_);
    const uint32_t Chosen = QueryPickedFigureIdentity();
    if (Chosen && Chosen != LastModelSelection_)
    {
        Host.Execute("select #" + std::to_string(Chosen));
        LastModelSelection_ = Chosen;
    }
    Viewport_.Record(Rows_.data(), RowCount_);
    AdvanceInput(Host);
    RecordWorkflow(Host);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Bindings_.data(), RowCount_);
    const uint32_t Picked = Outliner_.QueryPicked();
    EditorInstance* PickedRow = (Picked < RowCount_) ? &Rows_[Picked] : nullptr;
    if (PickedRow != nullptr)
        BuildSolidArcInspectorSheet(Host, Bindings_[Picked], &PickedSheet_);
    else
        BuildSolidArcInspectorSheet(Host, SolidArcOutlinerBinding{}, &PickedSheet_);
    if (Host.HasActiveTool() || !PickedRow || Bindings_[Picked].RowRole==SolidArcOutlinerBinding::Role::None) RecordEmptyInspector(Host);
    else if(Bindings_[Picked].RowRole==SolidArcOutlinerBinding::Role::Figure) RecordCadInspector(Host,Bindings_[Picked].FigureIdentity);
    else Inspector_.Record(PickedRow, Picked, &PickedSheet_);

    if (Picked < RowCount_ && Bindings_[Picked].RowRole!=SolidArcOutlinerBinding::Role::Figure)
        ApplySolidArcInspectorSheet(Host, Bindings_[Picked], PickedSheet_);
}

void SolidArcEditorHost::AdvanceInput(ConsoleHost& Host) noexcept
{
    const auto& Orbit = Viewport_.QueryViewportOrbit();
    auto& Camera = Host.Camera();
    const int ViewRequest=Viewport_.ConsumeCadViewRequest();
    if(ViewRequest>0) {
        const char* Names[]={"orbit","iso","top","front","right","bottom","back","left"};
        Host.Execute(std::string("view ")+Names[ViewRequest]);
        OrbitRevision_=Orbit.Revision;
    }
    if (Orbit.Revision != OrbitRevision_)
    {
        // Frontier's compass pitch is a look direction; SolidArc stores eye elevation.
        Camera.Yaw = Orbit.Yaw; Camera.Pitch = -Orbit.Pitch;Camera.Roll=Orbit.Roll;
        Camera.Distance = Orbit.Distance; Camera.Orthographic = Orbit.Ortho;
        Camera.Pivot = { Orbit.Target[0], Orbit.Target[1], Orbit.Target[2] };
        OrbitRevision_ = Orbit.Revision;
    }
    float U = 0, V = 0;
    const bool Hovered = Viewport_.QueryViewAim(&U, &V);
    const ImGuiIO& IO = ImGui::GetIO();
    const ImVec2 Origin = Viewport_.QueryViewOrigin();
    const double W = Viewport_.QueryViewWidth(), H = Viewport_.QueryViewHeight();
    if (W <= 1 || H <= 1) return;
    InputEvent Event;
    Event.PixelX = (IO.MousePos.x - Origin.x) * Host.Raster().Width() / W;
    Event.PixelY = (IO.MousePos.y - Origin.y) * Host.Raster().Height() / H;
    Event.Modifiers = (IO.KeyShift ? ModifierShift : 0) | (IO.KeyCtrl ? ModifierCtrl : 0) | (IO.KeyAlt ? ModifierAlt : 0);
    auto Send = [&](InputAction Action, PointerButton Button = PointerButton::None)
    {
        Event.Action = Action; Event.Button = Button; return Host.ReceiveInput(Event);
    };
    // LMB belongs to selection/tools/the transform rig, never to canvas orbit.
    // Keep delivering captured drags and release outside the view.
    if (Hovered || PointerCaptured_) Send(InputAction::PointerMove);
    if (Hovered && ImGui::IsMouseClicked(0) && !IO.KeyAlt)
    {
        PointerCaptured_ = true;
        Send(InputAction::PointerPress, PointerButton::Left);
    }
    if (PointerCaptured_ && ImGui::IsMouseReleased(0))
    {
        Send(InputAction::PointerRelease, PointerButton::Left);
        PointerCaptured_ = false;
    }
    if (Hovered && ImGui::IsMouseClicked(0) && IO.KeyAlt) NavigationButton_ = 0;
    if (Hovered && ImGui::IsMouseClicked(1))
    {
        RightWasTool_ = Host.HasActiveTool();
        if (Host.HasActiveTool()) Send(InputAction::PointerPress, PointerButton::Right);
        else NavigationButton_ = 1;
    }
    if (Hovered && ImGui::IsMouseClicked(2)) NavigationButton_ = 2;
    if (NavigationButton_ >= 0)
    {
        if (!ImGui::IsMouseDown(NavigationButton_)) NavigationButton_ = -1;
        else if (NavigationButton_ == 2 || IO.KeyShift)
            Camera.Pan(-IO.MouseDelta.x, IO.MouseDelta.y, H);
        else if(NavigationButton_==1) {
            Camera.Roll=0;Camera.Orbit(-IO.MouseDelta.x*.006,IO.MouseDelta.y*.006);
        }
        else Camera.OrbitScreen(-IO.MouseDelta.x * 0.006, IO.MouseDelta.y * 0.006);
    }
    if (Hovered && IO.MouseWheel != 0)
    {
        Event.WheelSteps = IO.MouseWheel;
        Send(InputAction::Wheel);
    }
    if (Hovered && !IO.WantTextInput)
    {
        struct Binding { ImGuiKey Ui; Key Model; };
        const Binding Keys[] = {{ImGuiKey_G, Key::G}, {ImGuiKey_R, Key::R}, {ImGuiKey_S, Key::S},
            {ImGuiKey_Escape, Key::Escape}, {ImGuiKey_Enter, Key::Enter}, {ImGuiKey_Delete, Key::Delete},
            {ImGuiKey_X, Key::X}, {ImGuiKey_Y, Key::Y}, {ImGuiKey_Z, Key::Z},
            {ImGuiKey_Backspace, Key::Backspace}, {ImGuiKey_UpArrow, Key::Up}, {ImGuiKey_DownArrow, Key::Down}};
        for (const auto& B : Keys) if (ImGui::IsKeyPressed(B.Ui, false))
        { Event.KeyCode = B.Model; Send(InputAction::KeyPress); }
        for (ImWchar C : IO.InputQueueCharacters) if (C >= 32 && C < 127)
        { Event.Character = char(C); Send(InputAction::Text); }
    }
    // Mirror camera changes back to chrome, without changing its seated home.
    ViewportOrbit Current = Orbit;
    Current.Yaw = float(Camera.Yaw); Current.Pitch = float(-Camera.Pitch); Current.Roll=float(Camera.Roll);
    Current.Distance = float(Camera.Distance); Current.Ortho = Camera.Orthographic;
    Current.Target[0] = float(Camera.Pivot.X); Current.Target[1] = float(Camera.Pivot.Y); Current.Target[2] = float(Camera.Pivot.Z);
    Viewport_.UpdateViewportOrbit(Current);
    OrbitRevision_ = Viewport_.QueryViewportOrbit().Revision;
}

void SolidArcEditorHost::RecordWorkflow(ConsoleHost& Host) noexcept
{
    namespace Fs = std::filesystem;
    const char* Override = std::getenv("SOLIDARC_RECOVERY_FILE");
    const Fs::path Recovery = Override ? Override : "_AgentScratch/autosave/SolidArc.arc";
    const Fs::path Previous = Recovery.string() + ".previous.arc";
    std::error_code Error;
    const uint64_t Fingerprint = UndoSequence::Fingerprint(Host.Document());
    if (!RecoveryInitialized_)
    {
        Welcome_ = Host.AllFigures().empty() && Fs::exists(Recovery, Error);
        RecoveryFingerprint_ = Fingerprint;
        RecoveryInitialized_ = true;
    }
    if (Fingerprint != RecoveryFingerprint_)
    {
        RecoveryFingerprint_ = Fingerprint;
        RecoveryChangedAt_ = ImGui::GetTime();
        RecoveryPending_ = true;
    }
    if (RecoveryPending_ && !Welcome_ && !Host.HasActiveTool() && !Host.Gizmo().Dragging() && ImGui::GetTime() - RecoveryChangedAt_ > 0.6)
    {
        Fs::create_directories(Recovery.parent_path(), Error);
        if (Error || !Host.Execute("save \"" + Recovery.string() + "\"")) { RecoveryError_ = "Autosave failed; save a native .arc copy."; RecoveryPending_ = false; }
        else { RecoveryPending_ = false; RecoveryError_.clear(); }
    }
    auto NewDocument = [&]()
    {
        if (!Host.AllFigures().empty() && !Host.Execute("save \"" + Recovery.string() + "\"")) return;
        if (Fs::exists(Recovery, Error))
        {
            Fs::copy_file(Recovery, Previous, Fs::copy_options::overwrite_existing, Error);
            if (Error) { RecoveryError_ = "Previous drawing could not be backed up; new document cancelled."; return; }
            Fs::remove(Recovery, Error);
        }
        Host.StartEmptyDocument(); Host.Execute("view iso");
        Welcome_ = false; RecoveryPending_ = false;
        RecoveryFingerprint_ = UndoSequence::Fingerprint(Host.Document());
    };
    const ImVec2 Origin = Viewport_.QueryViewOrigin();
    const float W = Viewport_.QueryViewWidth(), H = Viewport_.QueryViewHeight();
    if (W < 10 || H < 10) return;
    ImGui::SetNextWindowPos(ImVec2(Origin.x + 12, Origin.y + 12));
    ImGui::SetNextWindowSize(ImVec2(1,1));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(0,0));
    constexpr ImGuiWindowFlags Flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings;
    if (ImGui::Begin("SolidArc construction controls", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBackground))
    {
        float U = 0, V = 0;
        if (Viewport_.QueryViewAim(&U, &V) && ImGui::IsKeyPressed(ImGuiKey_Tab, false)) ImGui::OpenPopup("Construct");
        if (Viewport_.ConsumeSolidArcConstructRequest() || ConstructRequested_) { ConstructRequested_=false; ImGui::OpenPopup("Construct"); }
        const ImVec2 RightTravel = ImGui::GetMouseDragDelta(1, 0.0f);
        if (Viewport_.QueryViewAim(&U, &V) && ImGui::IsMouseReleased(1) && !RightWasTool_ &&
            RightTravel.x*RightTravel.x + RightTravel.y*RightTravel.y < 16.0f) ImGui::OpenPopup("Construct");
        if (NewRequested_) { NewRequested_=false; ImGui::OpenPopup("New native document?"); }
        if (ImGui::BeginPopup("New native document?"))
        {
            ImGui::TextUnformatted("Keep a recovery copy and start empty?");
            if (ImGui::Button("Start empty")) { NewDocument(); ImGui::CloseCurrentPopup(); }
            ImGui::SameLine(); if (ImGui::Button("Cancel")) ImGui::CloseCurrentPopup();
            ImGui::EndPopup();
        }
        ImGui::SetNextWindowSize(ImVec2(560,0),ImGuiCond_Appearing);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(16,16));
        if (ImGui::BeginPopup("Construct"))
        {
            ImGui::TextUnformatted("Construct"); ImGui::SameLine(); ImGui::TextDisabled("Tab · choose a tool, then draw in the viewport");
            ImGui::Separator();
            const char* Sections[]={"Reference", "Sketch Draw", "Solid", "Surface"};
            if (ImGui::BeginTable("Native construction catalogue",2,ImGuiTableFlags_SizingFixedFit))
            {
                ImGui::TableSetupColumn("Sections",ImGuiTableColumnFlags_WidthFixed,125);
                ImGui::TableSetupColumn("Tools",ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableNextColumn();
                for (int I=0;I<4;++I)
                {
                    if (ImGui::Selectable(Sections[I],ConstructSection_==I,ImGuiSelectableFlags_NoAutoClosePopups,ImVec2(120,38))) ConstructSection_=I;
                    TrackControl((std::string("section-")+Sections[I]).c_str());
                }
                ImGui::TableNextColumn();
                if (ConstructSection_==0)
                {
                    ImGui::TextUnformatted("Reference");
                    if(CadWidgets::ToolTile("Datum Point","datum-point")) {Host.Execute("tool datum-point");ImGui::CloseCurrentPopup();}
                    TrackControl("construct-datum-point");
                    static uint32_t Base=0; static float Offset=0;
                    const char Bases[kMaxEditorOptions][kMaxEditorOptionChars]={"XY","XZ","YZ"};
                    ImGui::TextUnformatted("Base");
                    Controls_.DropDown("Base",&Base,Bases,3,140); ImGui::InputFloat("Offset (m)",&Offset);
                    if (ImGui::Button("Use workplane",ImVec2(150,52)))
                    {
                        const std::string O=Base==0?"0,0,"+std::to_string(Offset):Base==1?"0,"+std::to_string(Offset)+",0":std::to_string(Offset)+",0,0";
                        Host.Execute(std::string("workplane ")+(Base==0?"xy":Base==1?"xz":"yz")+" --origin=("+O+")");
                        ImGui::CloseCurrentPopup();
                    }
                }
                if (ConstructSection_==1)
                {
                    const char* Tools[][2]={{"Line","line"},{"Polyline","polyline"},{"Rectangle","rect"},{"Centre Rect.","centerrect"},
                        {"Slot","slot2"},{"Polyline Slot","pslot"},{"Circle","circle"},{"Arc","arc"},{"Ellipse","ellipse"},{"Polygon","polygon"},{"Spline","spline"},{"Control Curve","cpcurve"},{"Point","sketch-point"},{"Diameter Circle","circle2"},{"3-point Circle","circle3"},{"3-point Arc","arc3"}};
                    for (int I=0;I<int(sizeof(Tools)/sizeof(Tools[0]));++I)
                    {
                        if (I%3) ImGui::SameLine();
                        if (CadWidgets::ToolTile(Tools[I][0],Tools[I][1])) { Host.Execute(std::string("tool ")+Tools[I][1]); ImGui::CloseCurrentPopup(); }
                        TrackControl((std::string("construct-")+Tools[I][1]).c_str());
                    }
                }
                if (ConstructSection_>=2)
                {
                    const char* Labels[][5]={{"Box","Sphere","Cylinder","Cone","Torus"},{"Sphere Sheet","Cylinder Sheet","Cone Sheet","Torus Sheet","Patch"}};
                    const char* Commands[][5]={{"box (0,0,0) 1 1 1","sphere (0,0,0) 1","cylinder (0,0,0) 1 2","cone (0,0,0) 1 .2 2","torus (0,0,0) 1 .25"},
                        {"sphere (0,0,0) 1 --sheet","cylinder (0,0,0) 1 2 --sheet","cone (0,0,0) 1 .2 2 --sheet","torus (0,0,0) 1 .25 --sheet","patch 2 2 --degree=1 (0,0,0) (1,0,0) (0,1,0) (1,1,0)"}};
                    for (int I=0;I<5;++I)
                    {
                        if (I%3) ImGui::SameLine();
                        if (ImGui::Button(Labels[ConstructSection_-2][I],ImVec2(112,64)))
                        { std::snprintf(NativeCommand_,sizeof(NativeCommand_),"%s",Commands[ConstructSection_-2][I]); ImGui::OpenPopup("Native construction parameters"); }
                    }
                    if (ImGui::BeginPopup("Native construction parameters"))
                    {
                        ImGui::TextWrapped("Edit location and dimensions explicitly (metres). No object is inserted until Apply.");
                        ImGui::SetNextItemWidth(360); ImGui::InputText("##native-command",NativeCommand_,sizeof(NativeCommand_));
                        if (ImGui::Button("Apply") && Host.Execute(NativeCommand_)) ImGui::CloseCurrentPopup();
                        ImGui::EndPopup();
                    }
                }
                ImGui::EndTable();
            }
            ImGui::Separator();
            if (ImGui::Selectable("Restore previous document") && Fs::exists(Previous, Error))
            {
                if (Host.AllFigures().empty() || Host.Execute("save \"" + Recovery.string() + "\"")) Host.Execute("open \"" + Previous.string() + "\"");
            }
            ImGui::EndPopup();
        }
        ImGui::PopStyleVar();

    }
    ImGui::End();
    ImGui::PopStyleVar();
    if (Welcome_)
    {
        ImGui::SetNextWindowPos(ImVec2(Origin.x + W*0.5f, Origin.y + H*0.5f), ImGuiCond_Always, ImVec2(0.5f,0.5f));
        ImGui::OpenPopup("Welcome back");
        if (ImGui::BeginPopupModal("Welcome back", nullptr, ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings))
        {
            ImGui::TextUnformatted("Your native drawing has a local recovery copy.");
            if (ImGui::Button("Continue previous")) { if (Host.Execute("open \"" + Recovery.string() + "\"")) { Welcome_ = false; ImGui::CloseCurrentPopup(); } }
            ImGui::SameLine(); if (ImGui::Button("New document")) { NewDocument(); if (!Welcome_) ImGui::CloseCurrentPopup(); }
            ImGui::EndPopup();
        }
    }
    if (const ToolPreview* Preview = Host.ActiveToolPreview())
    {
        ImDrawList* Draw = ImGui::GetForegroundDrawList();
        Draw->PushClipRect(Origin, ImVec2(Origin.x+W, Origin.y+H));
        for (const auto& Dimension : Preview->Dimensions)
        {
            double X = 0, Y = 0;
            if (Host.Camera().WorldToPixel((Dimension.A + Dimension.B)*0.5, Host.Raster().Width(), Host.Raster().Height(), X, Y))
            {
                ImFont* Font=ImGui::GetFont();
                const ImVec2 Size=Font->CalcTextSizeA(11,FLT_MAX,0,Dimension.Label.c_str());
                const float CX=Origin.x+float(X/Host.Raster().Width())*W,CY=Origin.y+float(Y/Host.Raster().Height())*H+Dimension.OffsetY;
                Draw->AddRectFilled(ImVec2(CX-Size.x*.5f-6,CY-9),ImVec2(CX+Size.x*.5f+6,CY+9),IM_COL32(0,0,0,184),9);
                const bool Angle=Dimension.Label.find("°")!=std::string::npos;
                Draw->AddText(Font,11,ImVec2(CX-Size.x*.5f,CY-Size.y*.5f),Angle?IM_COL32(255,210,120,255):IM_COL32(255,255,255,255),Dimension.Label.c_str());
            }
        }
        Draw->PopClipRect();
        ImGui::SetNextWindowPos(ImVec2(Origin.x+12,Origin.y+H-150));
        if (ImGui::Begin("Sketch prompt", nullptr, Flags))
        {
            ImGui::TextUnformatted(Host.ActiveToolPrompt().c_str());
            for (const auto& Line : Preview->Readout) ImGui::TextUnformatted(Line.c_str());
            ImGui::TextDisabled("Enter / right-click: finish · Esc: cancel · arrows: sides / degree");
            if (ImGui::Button("Cancel")) Host.Execute("tool cancel");
        }
        ImGui::End();
    }
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

} // namespace Frontier
