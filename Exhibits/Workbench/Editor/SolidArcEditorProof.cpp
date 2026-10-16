// Native CPU evidence, not evidence of GPU execution. Uses the actual editor host,
// actual modelling/shader code and shared ImGui panels. --interactive is the thin
// browser mirror transport; there is no second JS implementation of the editor.
#ifndef FRONTIER_DEVELOPMENT
#error "SolidArc proof requires the real development editor"
#endif
#include <imgui.h>
#include <imgui_internal.h>
#include "Editor/SolidArcEditorHost.h"
#include "PngWriteCounterpart.h"
#include "../IconArt/CpuDraw.h"
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {
constexpr int Width = 1280, Height = 720;
constexpr const char* Folder = "Exhibits/Gallery/Editor/";

void Require(bool Ok, const char* Why) {
    if (!Ok) throw std::runtime_error(Why);
}

// No pixel storage or software fallback: proves ConsoleHost honours the injected
// device vocabulary for surfaces, lattice and transform overlays alike.
class DeviceContract final : public Frontier::RasterExchange {
public:
    unsigned Surfaces=0, Lines=0, Points=0, Lattices=0, Overlays=0;
    unsigned W=520, H=340;
    void Resize(uint32_t X,uint32_t Y) noexcept override { W=X;H=Y; }
    uint32_t Width() const noexcept override { return W; }
    uint32_t Height() const noexcept override { return H; }
    void BeginTarget(const float[4]) noexcept override {}
    void BindView(const Frontier::ViewRecord&) noexcept override {}
    void DrawLattice() noexcept override { ++Lattices; }
    void DrawSurface(const Frontier::SurfaceStream&, const Frontier::DrawRecord&) noexcept override { ++Surfaces; }
    void DrawSegments(const Frontier::SegmentStream&, const Frontier::DrawRecord&) noexcept override { ++Lines; }
    void DrawPoints(const Frontier::PointStream&, const Frontier::DrawRecord&) noexcept override { ++Points; }
    void BeginOverlay() noexcept override { ++Overlays; }
    void EndTarget() noexcept override {}
    Frontier::RasterImage Readback() const noexcept override { return {}; }
    uint32_t Pick(uint32_t,uint32_t) const noexcept override { return 0; }
    float Depth(uint32_t,uint32_t) const noexcept override { return 1; }
    Tally QueryTally() const noexcept override { return {}; }
};

void CheckDeviceSeam() {
    auto Backend = std::make_unique<DeviceContract>();
    auto* Device = Backend.get();
    Frontier::ConsoleHost Host("/tmp/solidarc-contract", std::move(Backend));
    Require(Host.Execute("box (-1,-1,0) (1,1,1) --name=Body01"), "contract box");
    Require(Host.Execute("select Body01"), "contract select");
    Host.Render();
    Require(Device->Lattices && Device->Surfaces && Device->Lines && Device->Overlays, "device draw vocabulary bypassed");
    Require(Host.Raster().Readback().Pixels.empty(), "device contract unexpectedly rasterized pixels");
    Host.ResizeViewport(640,480);
    Require(Device->W==640 && Device->H==480, "injected backend not resized");
}
}

int main(int argc, char** argv) try {
    if (argc>1 && std::string(argv[1])=="--keys") {
        std::cout << "{\"Enter\":" << int(ImGuiKey_Enter) << ",\"Escape\":" << int(ImGuiKey_Escape)
            << ",\"Delete\":" << int(ImGuiKey_Delete) << ",\"Backspace\":" << int(ImGuiKey_Backspace)
            << ",\"Tab\":" << int(ImGuiKey_Tab) << ",\"Space\":" << int(ImGuiKey_Space);
        for (int I=0;I<26;++I) std::cout << ",\"Key" << char('A'+I) << "\":" << int(ImGuiKey_A)+I;
        for (int I=0;I<10;++I) std::cout << ",\"Digit" << I << "\":" << int(ImGuiKey_0)+I;
        std::cout << "}" << std::endl; return 0;
    }
    const bool Interactive = argc>1 && std::string(argv[1])=="--interactive";
    std::filesystem::create_directories(Folder);
    if (!Interactive) CheckDeviceSeam();
    ImGui::CreateContext();
    auto& IO = ImGui::GetIO();
    Require(IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 14.0f) != nullptr, "shared DM Sans UI font");
    IO.DisplaySize = {Width, Height};
    IO.DisplayFramebufferScale = {1,1};
    IO.IniFilename = nullptr; IO.LogFilename = nullptr;
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
    Frontier::SolidArcEditorHost Editor;
    Editor.ApplyTheme();
    Frontier::ConsoleHost Host("/tmp/solidarc-editor-proof", 680,480);
    if (!Interactive) {
    Require(Host.Execute("box (-1.2,-0.5,0) (1.2,0.5,0.8) --name=Body01"), "box");
    Require(Host.Execute("sphere (0,0,1.15) 0.35 --sheet --name=CanopySheet"), "sphere");
    Require(Host.Execute("line (-1.4,-0.7,0) (1.4,-0.7,0) --name=SketchAxis"), "line");
    Require(Host.Execute("select Body01"), "select");
    }
    std::vector<unsigned char> Pixels(Width*Height*3);
    auto Tick = [&]() {
        IO.DeltaTime = 1.0f/60;
        ImGui::NewFrame();
        Editor.Record(Host);
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };
    auto Sheet = [&](const char* Name) {
        std::fill(Pixels.begin(), Pixels.end(), 5);
        const auto* Draw = ImGui::GetDrawData();
        const auto& Preview = Editor.QueryProofImage();
        const ImTextureID Scene = static_cast<ImTextureID>(reinterpret_cast<uintptr_t>(Preview.Pixels.data()));
        FrontierProof::Image Image{Preview.Pixels.data(), int(Preview.Width), int(Preview.Height), 4};
        for (const auto* List : Draw->CmdLists)
            FrontierProof::Draw(List, Pixels.data(), Width, Height, Draw->DisplayPos, Draw->FramebufferScale, Scene, Image);
        const auto Path = std::string(Folder)+Name;
        Require(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width*3)!=0, "PNG write");
    };
    if(argc>1 && std::string(argv[1])=="--orientation-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        struct CubeCase{const char* Name;Frontier::Vec3 Normal;};
        const CubeCase Cases[]={{"right",{1,0,0}},{"left",{-1,0,0}},{"back",{0,1,0}},{"front",{0,-1,0}},{"top",{0,0,1}},{"bottom",{0,0,-1}}};
        std::ofstream Out(std::string(Folder)+"SolidArcNativeCubeProof.json");Out<<"{\"renderer\":\"native ImGui triangle meshes / CPU proof\",\"faces\":[";int Count=0;
        for(const auto& C:Cases){
            Require(Host.Execute(std::string("view ")+C.Name),"cube face setup");Tick();Tick();
            const auto Origin=Editor.QueryViewOrigin();
            const auto R=Host.Camera().Right(),U=Host.Camera().Up();
            const ImVec2 P(Origin.x+Editor.QueryViewWidth()-65+22*float(C.Normal.Dot(R)),Origin.y+Editor.QueryViewHeight()-65-22*float(C.Normal.Dot(U)));
            // Deliberately give the camera the wrong workplane. Only the actual
            // orientation-face mouse release should reseat the named-view plane.
            Require(Host.Execute(std::abs(C.Normal.Z)>.5?"workplane yz":"workplane xy"),"cube incorrect plane fixture");Tick();Tick();
            Click(P);
            Require(std::abs(Host.WorkPlane().Normal().Dot(C.Normal))>.99,"native cube mouse face snap chooses workplane");
            if(Count++)Out<<',';Out<<"{\"face\":\""<<C.Name<<"\",\"mouseClick\":true,\"workplaneSnapped\":true}";
        }
        Require(Host.Execute("view iso"),"cube iso");Tick();Tick();Sheet("EditorProof_SolidArc_OrientationCube.png");
        Require(Host.Execute("box (-1,-1,-1) (1,1,1) --name=OrbitWitness"),"orbit geometry fixture");
        Require(Host.Execute("view top"),"orbit pole fixture");Tick();Tick();Sheet("EditorProof_SolidArc_OrbitTopBefore.png");
        const auto Target=Host.Camera().Pivot;const double Radius=Host.Camera().Distance;
        const auto Origin=Editor.QueryViewOrigin();
        const ImVec2 Start(Origin.x+Editor.QueryViewWidth()*.5f,Origin.y+Editor.QueryViewHeight()*.5f);
        IO.AddMousePosEvent(Start.x,Start.y);Tick();Tick();IO.AddKeyEvent(ImGuiMod_Alt,true);Tick();IO.AddMouseButtonEvent(0,true);Tick();Tick();
        for(int I=1;I<=24;++I){IO.AddMousePosEvent(Start.x+I*4,Start.y);Tick();Tick();}
        IO.AddMouseButtonEvent(0,false);IO.AddKeyEvent(ImGuiMod_Alt,false);Tick();Tick();
        Require(Host.Camera().Pivot.Distance(Target)<1e-9 && std::abs(Host.Camera().Distance-Radius)<1e-9,"native orbit fixes target and radius");
        Require(std::abs(Host.Camera().Roll)<1e-10 && std::abs(Host.Camera().Right().Z)<1e-10,"Alt-left drag must also remain upright without roll");
        Require(std::abs(Host.Camera().Eye().Distance(Target)-Radius)<1e-8,"native eye orbits on target sphere");
        Sheet("EditorProof_SolidArc_OrbitTopAfter.png");
        Require(Host.Execute("view iso"),"RMB turntable fixture");Tick();Tick();
        const double Yaw=Host.Camera().Yaw,Pitch=Host.Camera().Pitch;
        IO.AddMousePosEvent(Start.x,Start.y);Tick();Tick();IO.AddMouseButtonEvent(1,true);Tick();Tick();
        for(int I=1;I<=12;++I){IO.AddMousePosEvent(Start.x+I*8,Start.y);Tick();Tick();}
        Require(std::abs(Host.Camera().Yaw-(Yaw-.576))<1e-5,"RMB horizontal motion rotates world Z");
        Require(std::abs(Host.Camera().Pitch-Pitch)<1e-8 && std::abs(Host.Camera().Roll)<1e-8,"RMB horizontal motion does not tilt or roll");
        for(int I=1;I<=12;++I){IO.AddMousePosEvent(Start.x+96,Start.y+I*4);Tick();Tick();}
        IO.AddMouseButtonEvent(1,false);Tick();Tick();
        Require(std::abs(Host.Camera().Pitch-(Pitch+.288))<1e-5 && std::abs(Host.Camera().Yaw-(Yaw-.576))<1e-5,"RMB vertical motion changes elevation only");
        Require(Host.Camera().Pivot.Distance(Target)<1e-9 && std::abs(Host.Camera().Distance-Radius)<1e-9,"RMB preserves orbit centre and radius");
        Sheet("EditorProof_SolidArc_RightDrag.png");
        Out<<"],\"orbit\":{\"fixedTarget\":true,\"fixedRadius\":true,\"uprightAltDrag\":true,\"nativeMouseMoves\":24}}";
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: six native 3D cube face mouse clicks, workplane snaps, UV labels, Alt orbit and RMB world-Z/camera-right axes\n");
        return 0;
    }
    if(argc>1 && std::string(argv[1])=="--view-grid-only") {
        IO.MouseDrawCursor=true;for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto ViewChoice=[&](int Index){
            ImVec2 P;Require(Editor.QueryControlCentre("camera-view",P),"view menu bounds");Click(P);
            auto& Popups=ImGui::GetCurrentContext()->OpenPopupStack;Require(Popups.Size&&Popups.back().Window,"view menu opens");
            const auto* Popup=Popups.back().Window;Click(ImVec2(Popup->WorkRect.Min.x+50,Popup->WorkRect.Min.y+Index*33+14));
        };
        struct Case{const char* Name;int Menu;int Normal;};
        const Case Cases[]={{"top",2,2},{"bottom",5,2},{"front",3,1},{"back",6,1},{"right",4,0},{"left",7,0},{"iso",1,0},{"offset",4,0}};
        std::ofstream Evidence(std::string(Folder)+"SolidArcNativeViewGrid.json");Evidence<<"{\"input\":\"native ImGui view menu, Construct tile and pointer clicks\",\"renderer\":\"CPU reference of shared shader\",\"cases\":[";int Index=0;
        for(const auto& C:Cases){
            Host.StartEmptyDocument();Tick();Tick();
            if(std::string(C.Name)=="iso")Require(Host.Execute("workplane yz"),"isometric plane setup");
            ViewChoice(C.Menu);
            if(std::string(C.Name)=="offset"){Require(Host.Execute("workplane yz --origin=(2,0,0)"),"offset plane setup");Tick();Tick();}
            const auto Plane=Host.WorkPlane();const auto N=Plane.Normal();
            Require(std::abs((C.Normal==0?N.X:C.Normal==1?N.Y:N.Z))>.99,"named view chooses correct drawing plane");
            char Path[140];std::snprintf(Path,sizeof(Path),"EditorProof_SolidArc_ViewGrid_%s_grid.png",C.Name);Sheet(Path);
            auto Project=[&](double U,double V){
                double X=0,Y=0;Require(Host.Camera().WorldToPixel(Plane.ToWorld({U,V}),Host.Raster().Width(),Host.Raster().Height(),X,Y),"workplane point projects");
                const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X)*Editor.QueryViewWidth()/Host.Raster().Width(),O.y+float(Y)*Editor.QueryViewHeight()/Host.Raster().Height());
            };
            Click(Editor.QueryConstructCentre());ImVec2 Section,Tile;
            Require(Editor.QueryControlCentre("section-Sketch Draw",Section),"Sketch Draw section");Click(Section);
            Require(Editor.QueryControlCentre("construct-rect",Tile),"Rectangle tile");Click(Tile);
            Click(Project(.5,.6));const auto A=IO.MousePos,B=Project(2.3,1.7);
            for(int S=1;S<=16;++S){float T=S/16.f;IO.AddMousePosEvent(A.x+(B.x-A.x)*T,A.y+(B.y-A.y)*T);Tick();Tick();Require(Host.AllFigures().empty(),"view-grid preview does not commit");}
            Require(Host.ActiveToolPreview()&&!Host.ActiveToolPreview()->Curves.empty(),"view-grid native preview exists");
            for(const auto& Curve:Host.ActiveToolPreview()->Curves)for(const auto& P:Curve.Poles)Require(std::abs((P.Divide()-Plane.Origin).Dot(N))<1e-7,"preview lies on visible grid plane");
            std::snprintf(Path,sizeof(Path),"EditorProof_SolidArc_ViewGrid_%s_drawing.png",C.Name);Sheet(Path);
            Click(B);Require(!Host.HasActiveTool()&&Host.AllFigures().size()==1,"view-grid rectangle commits once");
            const auto Bounds=Host.AllFigures()[0].Bounds();
            const auto TargetA=Plane.ToWorld({.5,.6}),TargetB=Plane.ToWorld({2.3,1.7});
            const auto ExpectedLow=Frontier::Vec3::Min(TargetA,TargetB),ExpectedHigh=Frontier::Vec3::Max(TargetA,TargetB);
            Require(Bounds.Low.Distance(ExpectedLow)<.06&&Bounds.High.Distance(ExpectedHigh)<.06,"native rectangle matches mouse location in active view");
            for(const auto& P:Host.AllFigures()[0].Curve.Poles)Require(std::abs((P.Divide()-Plane.Origin).Dot(N))<1e-7,"committed poles lie on visible grid plane");
            std::snprintf(Path,sizeof(Path),"EditorProof_SolidArc_ViewGrid_%s_completed.png",C.Name);Sheet(Path);
            const std::string Save="_AgentScratch/tmp/ViewGrid_"+std::string(C.Name)+".arc";Require(Host.Execute("save "+Save),"view-grid save");
            Frontier::ConsoleHost Reopened("/tmp/viewgrid-reopen",320,240);Require(Reopened.Execute("open "+Save),"view-grid reopen");
            Require(Reopened.AllFigures().size()==1&&Reopened.AllFigures()[0].Bounds().Low.Distance(Bounds.Low)<1e-7,"view-grid plane survives native journal replay");
            if(Index++){Evidence<<',';}Evidence<<"{\"view\":\""<<C.Name<<"\",\"passed\":true,\"pointerMoves\":16,\"previewOnPlane\":true,\"commitOnPlane\":true,\"replayPassed\":true}";
            Require(Host.Execute("undo")&&Host.AllFigures().empty(),"view-grid one-step undo");
            std::fprintf(stderr,"[SolidArcEditorProof] PASS: view-grid %s, native menu/Construct/mouse, plane geometry, save replay, undo\n",C.Name);
        }
        Evidence<<"]}\n";ImGui::DestroyContext();return 0;
    }
    if (!Interactive) {
    IO.AddMousePosEvent(-1,-1);
    for (int I=0;I<12;++I) Tick();
    for(const char* Name:{"Outliner###SolidArc Outliner","Viewport###SolidArc Viewport","Inspector###SolidArc Inspector"})
    {
        auto* Window=ImGui::FindWindowByName(Name);
        Require(Window && Window->DockNode && Window->DockNode->TabBar,"native panel is docked with a real tab bar");
        Require(!(Window->Flags & ImGuiWindowFlags_NoDocking),"native panel accepts docking");
        Require(!Window->DockNode->HasWindowMenuButton,"CAD dock strip has no ImGui caret");
        const auto* Bar=Window->DockNode->TabBar;
        const auto& Tab=Bar->Tabs[0];
        const float Inset=std::max(Bar->FramePadding.x,std::max(ImGui::GetStyle().TabSlant,ImGui::GetStyle().TabOverlap)+4*ImGui::GetStyle()._MainScale);
        const float LabelWidth=ImGui::CalcTextSize(Window->Name,nullptr,true).x;
        Require(Tab.Width+0.01f>=2*Inset+LabelWidth+ImGui::GetFontSize()+ImGui::GetStyle().ItemInnerSpacing.x,"tab label and close button fit between sloped/overlapped caps");
        Require(Bar->BarRect.GetHeight()>=ImGui::GetFontSize(),"tab text and close button fit vertically");
    }
    auto* Workspace=ImGui::FindWindowByName("SolidArc document workspace");
    Require(Workspace!=nullptr,"native document workspace exists");
    const auto* Documents=ImGui::GetCurrentContext()->TabBars.GetByKey(Workspace->GetID("SolidArc document tabs"));
    Require(Documents==nullptr,"redundant Untitled.arc tab removed");
    for(const auto Colour:{ImGuiCol_Tab,ImGuiCol_TabHovered,ImGuiCol_TabSelected,ImGuiCol_TabSelectedOverline,ImGuiCol_TabDimmed,ImGuiCol_TabDimmedSelected,ImGuiCol_TabDimmedSelectedOverline})
    {
        const auto C=ImGui::GetStyle().Colors[Colour];
        Require(C.x==C.y && C.y==C.z,"tab theme is monochrome in every state");
    }
    std::fprintf(stderr,"[SolidArcEditorProof] PASS: trapezoid text/close-button insets, no dock carets; monochrome dock tabs, no document tab\n");
    const auto& Theme=ImGui::GetStyle();
    for(auto State:{ImGuiCol_Tab,ImGuiCol_TabSelected,ImGuiCol_TabDimmed,ImGuiCol_TabDimmedSelected})
    { const auto T=Theme.Colors[State],B=Theme.Colors[ImGuiCol_WindowBg];Require(T.x==B.x&&T.y==B.y&&T.z==B.z&&T.w==B.w,"tab background matches panel body"); }
    Require(Theme.TabBarOverlineSize==0 && Theme.Colors[ImGuiCol_TabSelectedOverline].w==0 && Theme.Colors[ImGuiCol_TabDimmedSelectedOverline].w==0,"no tab overline");
    // Inspector evidence uses actual native widgets, not direct field mutation.
    { std::vector<Frontier::CommandLine> Commands;std::string Error;
      Require(Frontier::CommandCodec::Decode("select #1 ; rename #1 \"Body One\" # comment",Commands,Error) && Commands.size()==2 && Commands[0].Arguments[0]=="#1" && Commands[1].Arguments.size()==2 && Commands[1].Arguments[1]=="Body One","native stable identity operands coexist with comments and quoted names"); }
    auto InspectorClick=[&](const char* Name) {
        ImVec2 P;Require(Editor.QueryControlCentre(Name,P),Name);
        IO.AddMousePosEvent(P.x,P.y);Tick();Tick();
        IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();
    };
    auto InspectorType=[&](const char* Value) {
        IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();
        IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();
        IO.AddInputCharactersUTF8(Value);Tick();
        IO.AddKeyEvent(ImGuiKey_Enter,true);Tick();IO.AddKeyEvent(ImGuiKey_Enter,false);Tick();Tick();
    };
    InspectorClick("inspector-name");InspectorType("InspectorMouseProof");
    Require(Host.Document().Find("InspectorMouseProof")!=nullptr,"native Inspector rename reached document");
    InspectorClick("inspector-name");InspectorType("Body01");
    Require(Host.Document().Find("Body01")!=nullptr,"native Inspector rename restored fixture");
    Sheet("EditorProof_SolidArc_InspectorGeometry.png");
    InspectorClick("inspector-tab-Transform");
    const auto BeforeInspector=Host.Document().Find("Body01")->Bounds().Centre();
    InspectorClick("inspector-move-x");InspectorType("0.25");
    Sheet("EditorProof_SolidArc_InspectorTransform.png");
    InspectorClick("inspector-apply-transform");
    Require(std::abs(Host.Document().Find("Body01")->Bounds().Centre().X-BeforeInspector.X-.25)<1e-6,"native Inspector transform reached geometry");
    Require(Host.Execute("undo"),"Inspector transform undo");Tick();Tick();
    InspectorClick("inspector-tab-Topology");Sheet("EditorProof_SolidArc_InspectorTopology.png");
    InspectorClick("inspector-tab-Geometry");
    auto* InspectorProofWindow=ImGui::FindWindowByName("Inspector###SolidArc Inspector");
    Require(InspectorProofWindow!=nullptr,"Inspector scroll target");
    ImGui::SetScrollY(InspectorProofWindow,10000);Tick();Tick();
    Sheet("EditorProof_SolidArc_InspectorOperations.png");
    ImGui::SetScrollY(InspectorProofWindow,0);Tick();Tick();
    std::fprintf(stderr,"[SolidArcEditorProof] PASS: native Inspector cards/tabs, mouse rename, typed transform and geometry delta, undo\n");
    Sheet("EditorProof_SolidArc.png");
    IO.AddMousePosEvent(178,175); Tick();
    IO.AddMouseButtonEvent(0,true); Tick();
    IO.AddMouseButtonEvent(0,false); Tick(); Tick();
    Sheet("EditorProof_SolidArc_Menu.png");
    IO.AddMousePosEvent(178,175); Tick();
    IO.AddMouseButtonEvent(0,true); Tick();
    IO.AddMouseButtonEvent(0,false); Tick(); Tick();
    const ImVec2 Origin = Editor.QueryViewOrigin();
    const float X = Origin.x + Editor.QueryViewWidth()*0.45f;
    const float Y = Origin.y + Editor.QueryViewHeight()*0.6f;
    IO.AddMousePosEvent(X,Y); Tick(); Tick();
    const double YawBefore = Host.Camera().Yaw;
    IO.MouseDrawCursor=true;Tick();Sheet("EditorProof_SolidArc_OrbitMotion_00.png");
    IO.AddMouseButtonEvent(1,true); Tick();
    for(int Step=1;Step<=32;++Step)
    {
        IO.AddMousePosEvent(X+Step*5.f,Y+std::sin(Step*3.14159265f/32)*55);Tick();Tick();
        if(Step%4==0){char Name[100];std::snprintf(Name,sizeof(Name),"EditorProof_SolidArc_OrbitMotion_%02d.png",Step/4);Sheet(Name);}
    }
    IO.AddMouseButtonEvent(1,false); Tick();Tick();Sheet("EditorProof_SolidArc_OrbitMotion_09.png");
    IO.MouseDrawCursor=false;
    Require(std::abs(Host.Camera().Yaw-YawBefore)>0.01, "RMB viewport orbit did not reach CAD camera");
    {std::ofstream Evidence(std::string(Folder)+"SolidArcOrbitProof.json");
     Evidence<<"{\"input\":\"native ImGui RMB drag\",\"pointerMoves\":32,\"frames\":10,\"yawBefore\":"<<YawBefore<<",\"yawAfter\":"<<Host.Camera().Yaw<<",\"passed\":true}\n";}
    std::fprintf(stderr,"[SolidArcEditorProof] PASS: native orbit 32 RMB pointer moves, 10 raster frames; yaw %.4f -> %.4f\n",YawBefore,Host.Camera().Yaw);
    const double DistanceBefore = Host.Camera().Distance;
    IO.AddMouseWheelEvent(0,1); Tick();
    Require(Host.Camera().Distance < DistanceBefore, "wheel did not reach CAD camera");
    Tick(); Sheet("EditorProof_SolidArc_Orbit.png");
    IO.AddMousePosEvent(50,50); Tick();
    const double Outside = Host.Camera().Distance;
    IO.AddMouseWheelEvent(0,1); Tick();
    Require(Host.Camera().Distance==Outside, "wheel outside viewport changed camera");
    if(argc>1 && std::string(argv[1])=="--inspector-orbit-only") {
        ImGui::DestroyContext();return 0;
    }
    // Exercise the real gizmo pointer path, including a release outside the view.
    Require(Host.Execute("select Body01"), "gizmo selection");
    Host.Render();
    const auto Original = *Host.Document().Find("Body01");
    const auto PivotBefore = Original.Bounds().Centre();
    bool Dragged = false;
    for (auto Grip : {Frontier::GizmoGrip::TranslateX, Frontier::GizmoGrip::TranslateY, Frontier::GizmoGrip::TranslateZ}) {
        const auto Anchor = Host.Gizmo().GripAnchor(Grip,Host.Camera(),Host.Raster().Height());
        double Px=0,Py=0;
        if (!Host.Camera().WorldToPixel(Anchor,Host.Raster().Width(),Host.Raster().Height(),Px,Py)) continue;
        const float Sx=Origin.x+float(Px/Host.Raster().Width())*Editor.QueryViewWidth();
        const float Sy=Origin.y+float(Py/Host.Raster().Height())*Editor.QueryViewHeight();
        IO.AddMousePosEvent(Sx,Sy); Tick();
        IO.AddMouseButtonEvent(0,true); Tick();
        if (!Host.Gizmo().Dragging()) { IO.AddMouseButtonEvent(0,false); Tick(); continue; }
        IO.AddMousePosEvent(Sx+35,Sy+10); Tick();
        Tick(); Sheet("EditorProof_SolidArc_Gizmo.png");
        // Release while the pointer is over the outliner; capture must survive.
        IO.AddMousePosEvent(50,Sy); IO.AddMouseButtonEvent(0,false); Tick();
        Dragged = !Host.Gizmo().Dragging(); break;
    }
    Require(Dragged, "gizmo did not capture/release native pointer events");
    const auto PivotAfter = Host.Document().Find("Body01")->Bounds().Centre();
    Require((PivotAfter-PivotBefore).Length()>1e-5, "gizmo drag did not change geometry");
    Require(Host.Execute("save /tmp/solidarc-editor-proof/PointerRoundtrip.arc"), "save native pointer journal");
    Frontier::ConsoleHost Reopened("/tmp/solidarc-reopen", 320,200);
    Require(Reopened.Execute("open /tmp/solidarc-editor-proof/PointerRoundtrip.arc"), "open native pointer journal");
    Require(Reopened.Document().Find("Body01")->Bounds().Centre().Distance(PivotAfter)<1e-8,
            "native pointer edits did not survive document replay at another viewport size");
    Require(Host.Execute("undo"), "undo native drag");
    Require(Host.Document().Find("Body01")->Bounds().Centre().Distance(PivotBefore)<1e-8, "native drag undo");
    Require(Host.Execute("redo"), "redo native drag");
    Require(Host.Document().Find("Body01")->Bounds().Centre().Distance(PivotAfter)<1e-8, "native drag redo");
    *Host.Document().Find("Body01") = Original;
    Tick();
    std::fprintf(stderr,"[SolidArcEditorProof] PASS: real host + shaders; injected device contract; orbit; wheel; outside-wheel isolation; gizmo geometry delta\n");

    if (!(argc>1 && std::string(argv[1])=="--interactive")) {
        Host.StartEmptyDocument();
        Require(Host.AllDimensions().empty(), "new native document must clear old dimensions");
        Require(Host.AllFigures().empty(), "new native document must be empty");
        Host.Execute("view top");
        Host.Camera().Distance = 12; Host.Camera().Pivot = {};
        IO.AddMousePosEvent(50,50); Tick(); Tick();
        Sheet("EditorProof_SolidArc_Empty.png");
        auto Click = [&](ImVec2 P) {
            IO.AddMousePosEvent(P.x,P.y); Tick();
            IO.AddMouseButtonEvent(0,true); Tick();
            IO.AddMouseButtonEvent(0,false); Tick(); Tick();
        };
        Click(Editor.QueryConstructCentre());
        Require(ImGui::IsPopupOpen(nullptr, ImGuiPopupFlags_AnyPopupId | ImGuiPopupFlags_AnyPopupLevel), "native viewport Construct button opens catalogue");
        Sheet("EditorProof_SolidArc_Construct.png");
        ImVec2 Rectangle;
        Require(Editor.QueryControlCentre("construct-rect",Rectangle), "native rectangle tile bounds available");
        Click(Rectangle);
        Require(Host.HasActiveTool(), "mouse selected native rectangle tool");
        auto Project = [&](double X, double Y) {
            double Px=0,Py=0;
            Require(Host.Camera().WorldToPixel({X,Y,0},Host.Raster().Width(),Host.Raster().Height(),Px,Py), "drawing point projection");
            const auto O=Editor.QueryViewOrigin();
            return ImVec2(O.x+float(Px/Host.Raster().Width())*Editor.QueryViewWidth(),O.y+float(Py/Host.Raster().Height())*Editor.QueryViewHeight());
        };
        const ImVec2 First=Project(-1,-1), Second=Project(2,1);
        Click(First);
        IO.AddMousePosEvent(Second.x,Second.y); Tick(); Tick();
        Require(Host.ActiveToolPreview() && Host.ActiveToolPreview()->Dimensions.size()==2, "native spatial width/height dimensions");
        Require(Host.AllFigures().empty(), "preview must not author geometry");
        Sheet("EditorProof_SolidArc_Drawing.png");
        Click(Second);
        Require(Host.AllFigures().size()==1 && !Host.HasActiveTool(), "native rectangle pointer completion");
        Sheet("EditorProof_SolidArc_Completed.png");
        const auto& Raster=Editor.QueryProofImage();
        std::vector<unsigned char> SceneRGB(Raster.Width*Raster.Height*3);
        for (size_t I=0;I<SceneRGB.size()/3;++I)
            for (size_t C=0;C<3;++C) SceneRGB[I*3+C]=Raster.Pixels[I*4+C];
        Require(stbi_write_png((std::string(Folder)+"EditorProof_SolidArc_Scene.png").c_str(),Raster.Width,Raster.Height,3,SceneRGB.data(),Raster.Width*3)!=0,"native scene-only PNG");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: mouse-only Construct / Rectangle / first corner (%.1f,%.1f) / second corner (%.1f,%.1f); no tool or point commands; native C++ scene raster %ux%u\n",First.x,First.y,Second.x,Second.y,Raster.Width,Raster.Height);
        Require(Host.Execute("undo"), "native drawing undo");
        Require(Host.AllFigures().empty(), "native drawing is one undo transaction");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: empty document, modal native rectangle, spatial dimensions with UI font, pointer completion and undo\n");
        // CAD roster never invents empty category buckets or drops actual non-figure rows.
        Frontier::EditorInstance Rows[16]; Frontier::SolidArcOutlinerBinding Bindings[16];
        Require(Frontier::BuildSolidArcOutliner(Host,Rows,Bindings,16,nullptr,true)==0,"empty CAD roster has no dummy rows");
        auto FinishCurve=[&]() { IO.AddKeyEvent(ImGuiKey_Enter,true);Tick();IO.AddKeyEvent(ImGuiKey_Enter,false);Tick();Tick(); };
        for(const char* Name:{"pslot","spline","cpcurve"})
        {
            Click(Editor.QueryConstructCentre());
            ImVec2 Tile;
            Require(Editor.QueryControlCentre((std::string("construct-")+Name).c_str(),Tile),"native curve tile exists");
            Click(Tile);
            Require(Host.HasActiveTool(),"native curve tile starts a real C++ tool");
            Click(Project(-2,-1));Click(Project(0,1));Click(Project(2,-1));
            Require(Host.HasActiveTool(),"multi-point curve awaits native Enter");
            Require(Host.ActiveToolPreview() && !Host.ActiveToolPreview()->Curves.empty(),"multi-point native curve has live preview");
            if(std::string(Name)=="pslot") Sheet("EditorProof_SolidArc_PolylineSlot.png");
            FinishCurve();
            Require(!Host.HasActiveTool(),"Enter completes native curve");
        }
        Require(Host.AllFigures().size()==3,"polyline slot, spline and control curve committed");
        Require(Host.AllFigures()[0].Curve.Closed(),"native polyline slot is closed");
        Require(Host.AllFigures()[0].Name=="PolylineSlot" && Host.AllFigures()[1].Name=="Spline" && Host.AllFigures()[2].Name=="ControlCurve","native tools retain correct source names after completion");
        for(const auto& F:Host.AllFigures()) Require(!F.Curve.Validate(),"committed native curve validates");
        const auto Count=Frontier::BuildSolidArcOutliner(Host,Rows,Bindings,4,nullptr,true);
        Require(Count==4 && Rows[0].KidCount==3,"CAD capacity admits collection and all three real figures");
        for(unsigned I=1;I<Count;++I)
            Require(Rows[I].Label[0] && Rows[I].InspectorKey==Bindings[I].FigureIdentity && Bindings[I].RowRole==Frontier::SolidArcOutlinerBinding::Role::Figure,"CAD rows have real names and stable bindings");
        IO.AddMousePosEvent(-1,-1);Tick();Tick();Sheet("EditorProof_SolidArc_CadOutliner.png");
        for(const auto& Spine:std::vector<std::vector<Frontier::Vec2>>{{{0,0},{2,0}},{{0,0},{2,0},{2,2}},{{0,0},{2,0},{2,-2}},{{0,0},{2,0},{4,0}}})
        {
            const auto Slot=Frontier::NurbsCurve::PolylineSlot(Frontier::Workplane::XZ(),Spine,.25);
            Require(bool(Slot) && Slot.Payload.Closed() && Slot.Payload.Rational() && !Slot.Payload.Validate(),"analytic slot straight/left/right/collinear on XZ");
        }
        Require(!Frontier::NurbsCurve::PolylineSlot(Frontier::Workplane::XY(),{{0,0},{0,0}},.25),"duplicate slot centres refused");
        Require(!Frontier::NurbsCurve::PolylineSlot(Frontier::Workplane::XY(),{{0,0},{2,0},{0,0}},.25),"reversing slot spine refused");
        Host.StartEmptyDocument();Tick();Tick();
        Click(Editor.QueryConstructCentre());
        ImVec2 Section,PointTile;
        Require(Editor.QueryControlCentre("section-Reference",Section),"native Reference section exists");Click(Section);
        Require(Editor.QueryControlCentre("construct-datum-point",PointTile),"native Datum Point tile exists");Click(PointTile);
        Click(Project(1,2));
        Require(Host.AllFigures().size()==1 && Host.AllFigures()[0].Construction,"native mouse placed real construction datum");
        Require(Host.Execute("undo") && Host.AllFigures().empty(),"datum is one native undo transaction");
        Tick();Tick();
        Click(Editor.QueryConstructCentre());
        Require(Editor.QueryControlCentre("section-Sketch Draw",Section),"native Sketch section exists");Click(Section);
        Require(Editor.QueryControlCentre("construct-sketch-point",PointTile),"native Point tile exists");Click(PointTile);
        Click(Project(1,2));
        Require(Host.AllFigures().size()==1 && !Host.AllFigures()[0].Construction,"native mouse placed real sketch point");
        Require(Host.Execute("undo") && Host.AllFigures().empty(),"sketch point undo");
        Tick();Tick();
        for(const auto& Entry:std::vector<std::pair<const char*,Frontier::ToolChoice>>{{"sketch-point",Frontier::ToolChoice::SketchPoint},{"datum-point",Frontier::ToolChoice::DatumPoint}})
        {
            Frontier::ToolSession Tool; Frontier::ToolResult Result; Frontier::ToolSession::Context Ctx;
            Require(Tool.Begin(Entry.second,Ctx,[&](const Frontier::ToolResult& R){Result=R;}),"point tool begins");
            Require(Tool.SupplyPoint({1,2,0}) && Result.Completed && Result.ReferencePoints.size()==1,"one click supplies native point result");
        }
        Frontier::ConsoleHost JournalHost("/tmp/solidarc-tool-options-proof",320,240);
        Require(JournalHost.Execute("tool pslot") && JournalHost.Execute("tool-options --radius=.4"),"journalled polyline-slot settings");
        Require(!JournalHost.Execute("tool-options --radius=-1") && std::abs(JournalHost.ActiveToolSession()->QuerySlotRadius()-.4)<1e-9,"invalid settings are atomic");
        Require(JournalHost.Execute("point (0,0); point (2,0); point (2,2); key enter"),"configured slot completion");
        std::filesystem::create_directories("_AgentScratch/tmp");
        Require(JournalHost.Execute("save _AgentScratch/tmp/NativeToolOptions.arc"),"save configured native slot");
        Frontier::ConsoleHost Replay("/tmp/solidarc-tool-options-replay",320,240);
        Require(Replay.Execute("open _AgentScratch/tmp/NativeToolOptions.arc"),"replay configured native slot");
        Require(Replay.AllFigures().size()==1 && std::abs(Replay.AllFigures()[0].Curve.Length()-JournalHost.AllFigures()[0].Curve.Length())<1e-8,"slot settings survive save and replay");
        auto* InspectorWindow=ImGui::FindWindowByName("Inspector###SolidArc Inspector");
        Require(InspectorWindow && InspectorWindow->DockNode,"Inspector starts docked");

        const auto* Tabs=InspectorWindow->DockNode->TabBar;
        const auto& Tab=Tabs->Tabs[0];
        const ImVec2 TabCentre(Tabs->BarRect.Min.x+Tab.Offset+Tab.Width*.5f,(Tabs->BarRect.Min.y+Tabs->BarRect.Max.y)*.5f);
        IO.AddMousePosEvent(TabCentre.x,TabCentre.y);Tick();
        IO.AddMouseButtonEvent(0,true);Tick();
        IO.AddMousePosEvent(TabCentre.x-30,TabCentre.y+35);Tick();Tick();
        IO.AddMousePosEvent(650,710);Tick();Tick();
        IO.AddMouseButtonEvent(0,false);Tick();Tick();Tick();
        Require(InspectorWindow->DockNode==nullptr,"native mouse drag undocks Inspector");
        // Seat the now-floating window fully inside the proof image after dragging it clear of the dockspace.
        ImGui::SetWindowPos("Inspector###SolidArc Inspector",ImVec2(760,140));
        ImGui::SetWindowSize("Inspector###SolidArc Inspector",ImVec2(300,480));Tick();Tick();
        Sheet("EditorProof_SolidArc_Docking.png");
        // Undocking the last panel can delete its old leaf. Split the surviving
        // centre node instead of "restoring" into a stale ID (which makes a floating dock).
        const auto CentreNode=ImGui::FindWindowByName("Viewport###SolidArc Viewport")->DockNode->ID;
        ImGuiID RightNode=0,RemainingNode=0;
        ImGui::DockBuilderSplitNode(CentreNode,ImGuiDir_Right,.235f,&RightNode,&RemainingNode);
        ImGui::DockBuilderDockWindow("Inspector###SolidArc Inspector",RightNode);
        ImGui::DockBuilderFinish(CentreNode);Tick();Tick();Tick();
        Require(InspectorWindow->DockNode!=nullptr,"Inspector can be docked again");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: native mouse undocks Inspector tab; restored dock layout\n");
        auto OpenMenu=[&](const char* Name){
            ImVec2 Centre;Require(Editor.QueryControlCentre(Name,Centre),"shared dropdown bounds");Click(Centre);
            auto& Popups=ImGui::GetCurrentContext()->OpenPopupStack;
            Require(Popups.Size>0 && Popups.back().Window,"shared dropdown opens native popup");
            auto* Popup=Popups.back().Window;
            Require(Popup->WindowRounding==16 && Popup->WindowPadding.x==8 && Popup->WindowPadding.y==8,"all dropdowns use Filter popup styling");
            return Popup;
        };
        auto PickRow=[&](ImGuiWindow* Popup,int Index){Click(ImVec2(Popup->WorkRect.Min.x+50,Popup->WorkRect.Min.y+Index*33+14));};
        auto* CameraMenu=OpenMenu("camera-view");Sheet("EditorProof_SolidArc_Dropdowns.png");PickRow(CameraMenu,2);
        Require(std::abs(Host.Camera().Pitch-1.570696327)<1e-4,"shared camera dropdown selects Top");
        auto* ProjectionMenu=OpenMenu("projection");PickRow(ProjectionMenu,0);
        Require(!Host.Camera().Orthographic,"shared projection dropdown selects Perspective");
        ProjectionMenu=OpenMenu("projection");PickRow(ProjectionMenu,1);
        Require(Host.Camera().Orthographic,"shared projection dropdown selects Orthographic");
        auto* FilterMenu=OpenMenu("filter");PickRow(FilterMenu,0);
        Require(!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel),"shared filter dropdown toggles and closes");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: shared Filter/camera/projection dropdown styling and mouse selection; tabs match body, no overline\n");
        // End-to-end catalogue sweep. Only fixture reset/camera setup uses commands;
        // tool selection, every point and all preview motion use native ImGui IO.
        FilterMenu=OpenMenu("filter");PickRow(FilterMenu,0); // restore unfiltered CAD roster
        struct MouseCase {const char* Key;std::vector<Frontier::Vec2> Points;bool Finish;};
        const std::vector<MouseCase> Cases={
            {"line",{{-2,-1},{2,1}},false},
            {"polyline",{{-2,-1},{0,1},{2,-1}},true},
            {"rect",{{-2,-1},{2,1}},false},
            {"centerrect",{{0,0},{2,1}},false},
            {"slot2",{{-2,0},{2,0}},false},
            {"pslot",{{-2,-1},{0,1},{2,-1}},true},
            {"circle",{{0,0},{2,0}},false},
            {"arc",{{0,0},{2,0},{0,2}},false},
            {"circle2",{{-2,0},{2,0}},false},
            {"circle3",{{-2,0},{0,2},{2,0}},false},
            {"arc3",{{-2,0},{2,0},{0,2}},false},
            {"ellipse",{{0,0},{2,0},{0,1}},false},
            {"polygon",{{0,0},{2,0}},false},
            {"spline",{{-2,-1},{-1,1},{1,-1},{2,1}},true},
            {"cpcurve",{{-2,-1},{-1,1},{1,-1},{2,1}},true},
            {"sketch-point",{{1,1}},false},
            {"datum-point",{{1,1}},false},
        };
        std::ofstream Evidence(std::string(Folder)+"SolidArcMouseProof.json");
        Evidence<<"{\"input\":\"native ImGui IO\",\"renderer\":\"C++ CPU reference\",\"toolOrPointCommandsUsed\":false,\"cases\":[";
        unsigned CaseIndex=0,TotalMoves=0;IO.MouseDrawCursor=true;
        for(const auto& Case:Cases)
        {
            Host.StartEmptyDocument();Tick();Tick();
            PickRow(OpenMenu("camera-view"),2);PickRow(OpenMenu("projection"),1);
            Click(Editor.QueryConstructCentre());
            ImVec2 SectionCentre,TileCentre;
            const char* SectionName=std::string(Case.Key)=="datum-point"?"section-Reference":"section-Sketch Draw";
            Require(Editor.QueryControlCentre(SectionName,SectionCentre),"catalogue section bounds");Click(SectionCentre);
            Require(Editor.QueryControlCentre((std::string("construct-")+Case.Key).c_str(),TileCentre),"catalogue tile bounds");
            Click(TileCentre);Require(Host.HasActiveTool(),"mouse starts catalogue tool");
            if(std::string(Case.Key)=="rect")Sheet("EditorProof_SolidArc_Motion_00.png");
            unsigned Moves=0;
            for(size_t Point=0;Point<Case.Points.size();++Point)
            {
                const auto Target=Project(Case.Points[Point].X,Case.Points[Point].Y);
                const auto From=IO.MousePos;
                for(int Step=1;Step<=24;++Step)
                {
                    const float T=Step/24.f;
                    IO.AddMousePosEvent(From.x+(Target.x-From.x)*T,From.y+(Target.y-From.y)*T);Tick();Tick();++Moves;
                    Require(Host.HasActiveTool() && Host.AllFigures().empty(),"native mouse movement previews without committing");
                    if(std::string(Case.Key)=="rect" && Point==1 && Step%4==0)
                    {
                        Require(Host.ActiveToolPreview() && Host.ActiveToolPreview()->Dimensions.size()==2,"moving rectangle has live dimensions");
                        char Name[100];std::snprintf(Name,sizeof(Name),"EditorProof_SolidArc_Motion_%02d.png",Step/4);Sheet(Name);
                    }
                }
                Click(Target);
            }
            if(Case.Finish)FinishCurve();
            Require(!Host.HasActiveTool() && Host.AllFigures().size()==1,"native catalogue mouse sequence commits exactly one figure");
            const auto& Figure=Host.AllFigures()[0];
            if(Figure.Classification==Frontier::FigureClassification::Curve)Require(!Figure.Curve.Validate(),"mouse-authored native NURBS validates");
            const std::string Name=std::string("EditorProof_SolidArc_Mouse_")+Case.Key+".png";
            Sheet(Name.c_str());
            if(std::string(Case.Key)=="rect")Sheet("EditorProof_SolidArc_Motion_07.png");
            if(CaseIndex++)Evidence<<",";
            Evidence<<"{\"tool\":\""<<Case.Key<<"\",\"mouseMoves\":"<<Moves<<",\"pointClicks\":"<<Case.Points.size()<<",\"enterToFinish\":"<<(Case.Finish?"true":"false")<<",\"figures\":1,\"undoPassed\":true}";
            Require(Host.Execute("undo") && Host.AllFigures().empty(),"each mouse construction is one undo transaction");
            TotalMoves+=Moves;
            std::fprintf(stderr,"[SolidArcEditorProof] PASS: native mouse catalogue %s — %u moves, %zu clicks, one figure + undo\n",Case.Key,Moves,Case.Points.size());
        }
        IO.MouseDrawCursor=false;
        Evidence<<"],\"totalMouseMoves\":"<<TotalMoves<<"}";Evidence.close();
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: %zu mouse-selected native Construct tools; %u interpolated pointer moves; per-tool C++ raster evidence\n",Cases.size(),TotalMoves);
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: CAD roster without dummy rows; mouse-selected Polyline Slot / Spline / Control Curve + Enter; analytic round joins on XY/XZ; point tools\n");

    }

    }
    if (Interactive) {
        IO.AddMousePosEvent(-1,-1);
        for (int I=0;I<12;++I) Tick();
        std::string Line;
        while (std::getline(std::cin,Line)) {
            std::istringstream In(Line);
            float Mx=-1,My=-1,Wheel=0; int Buttons=0,Mods=0,Key=0,Down=0,Character=0;
            if (!(In>>Mx>>My>>Buttons>>Wheel>>Mods>>Key>>Down)) continue;
            In>>Character;
            IO.AddMousePosEvent(Mx,My);
            for (int B=0;B<3;++B) IO.AddMouseButtonEvent(B,(Buttons&(1<<B))!=0);
            IO.AddKeyEvent(ImGuiMod_Shift,(Mods&1)!=0);
            IO.AddKeyEvent(ImGuiMod_Ctrl,(Mods&2)!=0);
            IO.AddKeyEvent(ImGuiMod_Alt,(Mods&4)!=0);
            if (Wheel) IO.AddMouseWheelEvent(0,Wheel);
            if (Key>=ImGuiKey_NamedKey_BEGIN && Key<ImGuiKey_NamedKey_END) IO.AddKeyEvent(ImGuiKey(Key),Down!=0);
            if (Character>=32 && Character<127 && Down) IO.AddInputCharacter(unsigned(Character));
            Tick(); Tick(); Sheet("SolidArcMirror.png");
            std::cout<<"SOLIDARC_FRAME_READY"<<std::endl;
        }
    }
    ImGui::DestroyContext();
    return 0;
} catch (const std::exception& E) {
    std::fprintf(stderr,"[SolidArcEditorProof] FAIL: %s\n",E.what()); return 1;
}
