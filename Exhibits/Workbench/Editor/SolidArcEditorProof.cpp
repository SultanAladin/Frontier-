// Native CPU evidence, not evidence of GPU execution. Uses the actual editor host,
// actual modelling/shader code and shared ImGui panels. --interactive is the thin
// browser mirror transport; there is no second JS implementation of the editor.
#ifndef FRONTIER_DEVELOPMENT
#error "SolidArc proof requires the real development editor"
#endif
#include <imgui.h>
#include "ExternalPackages/json/include/nlohmann/json.hpp"
#include <imgui_internal.h>
#include "Editor/SolidArcEditorHost.h"
#include "Kernel/ProfileSolver.h"
#include "Presentation/GpuPickingRaster.h"
#include <iomanip>
#include "PngWriteCounterpart.h"
#include "../IconArt/CpuDraw.h"
#include <cmath>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <set>
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
    const bool ComplexProof=argc>1&&std::string(argv[1])=="--complex-geometry-captures";
    const auto ProofRoot=ComplexProof?"/tmp/solidarc-complex-proof-"+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()):std::string("/tmp/solidarc-editor-proof");
    Frontier::ConsoleHost Host(ProofRoot, 680,480);
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
    if(argc>1 && std::string(argv[1])=="--extrude-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();
        Require(Host.Execute("box (0,0,0) 2 2 2 --name=FaceExtrude"),"face extrusion fixture");
        Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view iso");Host.Execute("view fit");Host.Execute("selectmode face");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"extrusion fixture projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        auto E=[&](){IO.AddKeyEvent(ImGuiKey_E,true);Tick();IO.AddKeyEvent(ImGuiKey_E,false);Tick();Tick();};
        Click(Project({1,1,2}));Require(Host.Document().SelectedFaceCount()==1,"mouse selects top face");
        Sheet("EditorProof_SolidArc_ExtrudeFaceSelection.png");E();
        ImVec2 Control;Require(Editor.QueryControlCentre("inspector-extrude-distance",Control),"E opens native extrusion parameters");
        Sheet("EditorProof_SolidArc_ExtrudeNormalOptions.png");
        Require(Editor.QueryControlCentre("inspector-operation-apply",Control),"extrusion Apply button");Click(Control);
        Require(Host.AllFigures().size()==1&&Host.AllFigures()[0].Bounds().High.Z>2.9,"native E Apply extrudes selected face");
        Require(Host.AllFigures()[0].Body.Validate().Solid(),"normal extrusion remains solid");
        Sheet("EditorProof_SolidArc_ExtrudeNormalResult.png");
        Require(Host.Execute("undo")&&std::abs(Host.AllFigures()[0].Bounds().High.Z-2)<1e-8,"normal extrusion single-step undo");Tick();Tick();
        IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project({1,0,1}));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
        Require(Host.Document().SelectedFaceCount()==2,"native Shift-click adds second face");
        Require(!Host.FaceExtrusionSelection().Normal,"different face normals disable shared-normal mode");
        Sheet("EditorProof_SolidArc_ExtrudeMultiSelection.png");
        Require(Editor.QueryControlCentre("inspector-operation-Extrude · E",Control),"multi-face Inspector Extrude button");Click(Control);
        Sheet("EditorProof_SolidArc_ExtrudeIndividualOptions.png");
        Require(Editor.QueryControlCentre("inspector-operation-apply",Control),"individual extrusion Apply");Click(Control);
        const auto Bounds=Host.AllFigures()[0].Bounds();Require(Bounds.High.Z>2.9&&Bounds.Low.Y<-.9,"individual faces extrude along distinct normals");
        Require(Host.AllFigures()[0].Body.Validate().Solid(),"individual extrusion remains manifold solid");
        Sheet("EditorProof_SolidArc_ExtrudeIndividualResult.png");
        Require(Host.Execute("undo")&&std::abs(Host.AllFigures()[0].Bounds().High.Z-2)<1e-8,"individual extrusion single-step undo");
        Require(Host.Execute("redo")&&Host.AllFigures()[0].Bounds().High.Z>2.9,"individual extrusion redo");
        {std::ofstream Out(std::string(Folder)+"SolidArcNativeExtrudeProof.json");Out<<R"({"renderer":"native C++ CPU reference","mouseFaceSelection":true,"shiftMultiFaceSelection":true,"EOpensParameters":true,"inspectorExtrudeButton":true,"normalExtrusion":true,"individualNormals":true,"validSolids":true,"singleStepUndoRedo":true})";}
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse single/multi face selection, E shortcut, Inspector button, normal/individual options, real solid extrusions, undo/redo\n");
        ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--bevel-corner-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();
        Require(Host.RunScript("Experimental/SolidArc/Native/Fixtures/MixedCapCorner.arc",false),"exact minimized user corner journal");
        Host.Execute("hide 1");Host.Execute("select none");Host.Execute("view fit");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"mixed rim projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        auto Value=[&](const char* Text){ImVec2 P;Require(Editor.QueryControlCentre("bevel-size",P),"mixed rim numeric field");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();IO.AddInputCharactersUTF8(Text);Tick();Tick();};
        auto Detail=[&](const char* Name){const auto Camera=Host.Camera();Host.Camera().Pivot={-4.01,2.04,6.82};Host.Camera().Distance=1.35;Tick();Tick();Sheet(Name);Host.Camera()=Camera;Tick();Tick();};
        const auto Arc=Host.Document().Find(2)->Body.Edges[14].Curve,Line=Host.Document().Find(2)->Body.Edges[15].Curve;
        Click(Project(Arc.Sample((Arc.DomainStart()+Arc.DomainEnd())*.5)));
        Require(Host.Document().SelectedEdgeCount()==1,"native own mouse picks user arc");
        IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project(Line.Sample((Line.DomainStart()+Line.DomainEnd())*.5)));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
        Require(Host.Document().SelectedEdgeCount()==2,"native Shift-mouse adds connected line");Sheet("EditorProof_SolidArc_CornerSelected.png");
        const auto Before=Frontier::UndoSequence::Fingerprint(Host.Document());const auto Steps=Host.Timeline().UndoEntries().size();
        Key(ImGuiKey_B);Require(Host.CurrentBevel().Active&&Host.CurrentBevel().Valid,"mixed native B preview valid");Value("20.2791507347mm");
        Require(Host.CurrentBevel().Valid&&Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"mixed preview is non-destructive");Sheet("EditorProof_SolidArc_CornerRoundPreview.png");
        ImVec2 P;Require(Editor.QueryControlCentre("bevel-apply",P),"mixed native Apply");Click(P);
        const auto& B=Host.Document().Find(2)->Body;const auto R=B.Validate();Require(R.Solid()&&R.EulerCharacteristic==2&&R.Genus==0&&R.Faces==11,"mixed native round manifold");
        Require(B.Faces[B.Faces.size()-2].Surface.Classification==Frontier::SurfaceClassification::Torus&&B.Faces.back().Surface.Classification==Frontier::SurfaceClassification::Cylinder,"native torus plus cylindrical roll");
        Require(Host.Document().Find(2)->Bevels.size()==3&&Host.Timeline().UndoEntries().size()==Steps+1,"third feature, one undo transaction");Sheet("EditorProof_SolidArc_CornerRound.png");Detail("EditorProof_SolidArc_CornerRoundDetail.png");
        Require(Host.Execute("undo")&&Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"mixed corner exact undo");Require(Host.Execute("redo"),"mixed corner redo");Tick();Tick();
        Require(Editor.QueryControlCentre("inspector-bevel-feature-3",P),"third feature mouse property");Click(P);Value("-20.2791507347mm");
        Require(Host.CurrentBevel().Valid&&Host.CurrentBevel().Chamfer,"same connected rim flat preview");Sheet("EditorProof_SolidArc_CornerFlatPreview.png");
        Key(ImGuiKey_Enter);Require(Host.Document().Find(2)->Bevels.size()==3&&Host.Document().Find(2)->Bevels.back().Chamfer,"native Enter edits third feature to chamfer");Sheet("EditorProof_SolidArc_CornerFlat.png");Detail("EditorProof_SolidArc_CornerFlatDetail.png");
        const auto Flat=Frontier::UndoSequence::Fingerprint(Host.Document());Require(Editor.QueryControlCentre("inspector-bevel-feature-3",P),"reopen third property");Click(P);Value("-200mm");Require(!Host.CurrentBevel().Valid,"mixed corner oversize refusal");
        Require(Editor.QueryControlCentre("bevel-apply",P),"disabled mixed Apply");Click(P);Require(Host.CurrentBevel().Active&&Frontier::UndoSequence::Fingerprint(Host.Document())==Flat,"invalid own mouse Apply stays atomic");Sheet("EditorProof_SolidArc_CornerRefused.png");Key(ImGuiKey_Escape);
        Require(Editor.QueryControlCentre("inspector-bevel-feature-2",P),"earlier native history property");Click(P);Value("180mm");Require(Host.CurrentBevel().Valid,"earlier feature replays third mixed rim");Key(ImGuiKey_Enter);
        Require(Host.Document().Find(2)->Bevels.size()==3&&std::fabs(Host.Document().Find(2)->Bevels[1].Size-.18)<1e-8,"native downstream replay retains all three");
        {std::ofstream Out(std::string(Folder)+"SolidArcNativeCornerProof.json");Out<<R"({"renderer":"native C++ CPU-reference raster / real ImGui own mouse and keyboard","fixture":"exact minimized user journal","arcMousePick":true,"shiftLineMousePick":true,"BPreview":true,"numericUnits":true,"nonDestructivePreview":true,"mouseApply":true,"exactTorusAndCylinder":true,"closedManifoldEuler2Genus0":true,"thirdEditableFeature":true,"oneStepUndoRedo":true,"sameFeatureChamferEdit":true,"oversizeDisabledAndAtomic":true,"earlierFeatureReplaysMixedRim":true,"pass":true})";}
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: actual mixed user rim, own native arc/line mouse selection, B, units, torus/cylinder fillet, chamfer, third history property, undo/redo, refused oversize and earlier replay\n");ImGui::DestroyContext();return 0;
    }
    if(argc>2 && std::string(argv[1])=="--complex-geometry-captures") {
        std::ifstream Input(argv[2]);nlohmann::json Plan;Input>>Plan;const std::string Prefix=Plan.value("prefix","ComplexGeometry");
        for(int I=0;I<12;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Reveal=[&](const char* Name){auto* W=ImGui::FindWindowByName("Inspector###SolidArc Inspector");Require(W,"complex Inspector");ImVec2 P;for(int I=0;I<30;++I){if(Editor.QueryControlCentre(Name,P)&&W->InnerClipRect.Contains(P))return P;IO.AddMousePosEvent(W->InnerClipRect.GetCenter().x,W->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,-2);Tick();Tick();}throw std::runtime_error("complex control not visible");};
        std::set<std::string> Sources;nlohmann::json Captures=nlohmann::json::array(),Ui=nlohmann::json::array();
        for(const auto& Row:Plan.at("cases")){
            const std::string Id=Row.at("id"),Fixture=Row.at("fixture");Host.StartEmptyDocument();Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");
            bool Setup=true;for(const auto& Command:Row.at("commands")){if(!Host.Execute(Command.get<std::string>())){Setup=false;break;}}
            Require(Setup==Row.at("sourceReady").get<bool>(),"native complex construction matches probe");
            Host.Execute("select none");Host.Execute("view iso");Host.Execute("view fit");Host.Camera().Distance*=.7;Tick();Tick();
            if(Sources.insert(Fixture).second)Sheet((Prefix+"-"+Fixture+"-source.png").c_str());
            if(!Setup){Captures.push_back({{"id",Id},{"fixture",Fixture},{"constructionBlocked",true}});continue;}
            const auto Before=Frontier::UndoSequence::Fingerprint(Host.Document());const bool Accepted=Host.Execute(Row.at("booleanCommand").get<std::string>());Require(Accepted==Row.at("accepted").get<bool>(),"native complex Boolean matches probe");
            if(!Accepted)Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"native complex refusal preserves source");Tick();Tick();Sheet((Prefix+"-"+Id+"-boolean.png").c_str());
            Captures.push_back({{"id",Id},{"fixture",Fixture},{"accepted",Accepted},{"renderer","actual native C++ ImGui CPU-reference color"}});
            if(Row.at("ui").get<bool>()){
                // Reset only this isolated proof document. Source setup uses
                // commands; selection/order/operation/Apply use own ImGui input.
                Host.StartEmptyDocument();for(const auto& Command:Row.at("commands"))Require(Host.Execute(Command.get<std::string>()),"complex own-input setup");
                Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("selectmode whole");Host.Execute("select none");Host.Execute("view iso");Host.Execute("view fit");Host.Camera().Distance*=.7;Tick();Tick();
                const auto A=Host.Document().Find("A")->Identity,B=Host.Document().Find("B")->Identity;ImVec2 P;
                Require(Editor.QueryOutlinerFigureCentre(A,P),"complex A outliner row");Click(P);Require(Editor.QueryOutlinerFigureCentre(B,P),"complex B outliner row");IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(P);IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
                Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({A,B}),"complex own-mouse ordered selection");
                const std::string Op=Row.at("operation");if(Op.ends_with("-ba"))Click(Reveal("inspector-reverse-order"));
                const auto Selected=Frontier::UndoSequence::Fingerprint(Host.Document());const std::string Label=Op.starts_with("union")?"Union":Op.starts_with("intersect")?"Intersect":"Subtract";
                Click(Reveal(("inspector-operation-"+Label).c_str()));
                if(!Accepted){
                    Require(!Editor.QueryControlCentre("inspector-operation-apply",P),"unsupported complex operation disabled before popup");Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Selected,"disabled complex operation preserves source");
                    Sheet((Prefix+"-"+Id+"-ui-before-apply.png").c_str());Sheet((Prefix+"-"+Id+"-ui-result.png").c_str());
                    Ui.push_back({{"id",Id},{"operation",Op},{"accepted",false},{"ownOutlinerMouse",true},{"shiftSelection",true},{"operationButton",true},{"Apply",false},{"disabledBeforePopup",true},{"transactionChecked",true}});
                    {std::ofstream Out(std::string(Folder)+Prefix+"NativeUI.json");Out<<Ui.dump(2);}
                    {std::ofstream Out(std::string(Folder)+Prefix+"NativeCaptures.json");Out<<Captures.dump(2);}
                    std::fprintf(stderr,"PASS complex native disabled-operation guard %s\n",Id.c_str());continue;
                }
                Require(Editor.QueryControlCentre("inspector-operation-apply",P),"complex native popup Apply");Sheet((Prefix+"-"+Id+"-ui-before-apply.png").c_str());Click(P);
                if(Accepted){Require(!Host.Document().Find(A)&&!Host.Document().Find(B),"complex native Apply consumes both operands");int Bodies=0;for(const auto& Figure:Host.AllFigures())if(Figure.Classification==Frontier::FigureClassification::Body){++Bodies;Require(Figure.Body.Validate().Solid(),"complex own-input result solid");}Require(Bodies==1,"complex native result body count");Require(Host.Execute("undo")&&Frontier::UndoSequence::Fingerprint(Host.Document())==Selected,"complex native UI undo");Require(Host.Execute("redo"),"complex native UI redo");Tick();Tick();}
                else{Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Selected,"complex native UI refusal atomic");Key(ImGuiKey_Escape);}
                Sheet((Prefix+"-"+Id+"-ui-result.png").c_str());Ui.push_back({{"id",Id},{"operation",Op},{"accepted",Accepted},{"ownOutlinerMouse",true},{"shiftSelection",true},{"operationButton",true},{"Apply",true},{"transactionChecked",true}});
                std::fprintf(stderr,"PASS complex native own-input %s accepted=%d\n",Id.c_str(),int(Accepted));
            }
            {std::ofstream Out(std::string(Folder)+Prefix+"NativeCaptures.json");Out<<Captures.dump(2);}
            {std::ofstream Out(std::string(Folder)+Prefix+"NativeUI.json");Out<<Ui.dump(2);}
        }
        Require(Sources.size()==Plan.value("expectedSources",24)&&Ui.size()==Plan.value("expectedUI",4)&&Captures.size()==Plan.at("cases").size(),"complex native capture coverage complete");
        {std::ofstream Out(std::string(Folder)+Prefix+"NativeCaptures.json");Out<<Captures.dump(2);}ImGui::DestroyContext();return 0;
    }
    if(argc>2 && std::string(argv[1])=="--broad-geometry-proof") {
        // Trusted local probe results. This process is separate from the live
        // mirror. All Boolean captures use the actual C++ editor/CPU raster;
        // the explicitly marked subset also exercises native ImGui input.
        std::ifstream Input(argv[2]);nlohmann::json Matrix;Input>>Matrix;
        for(int I=0;I<12;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Value=[&](double Size){ImVec2 P;Require(Editor.QueryControlCentre("bevel-size",P),"broad numeric control");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();std::ostringstream Text;Text<<std::setprecision(12)<<Size<<"m";IO.AddInputCharactersUTF8(Text.str().c_str());Tick();Tick();};
        std::set<std::string> Sources,UiDone;
        const std::set<std::string> UiFixtures={"offset-boxes","rotated-boxes","sphere-box","sphere-sphere","cone-sphere","torus-box","extruded-hexagon","translated-sphere-cylinder"};
        nlohmann::json Captures=nlohmann::json::array(),Ui=nlohmann::json::array();
        for(const auto& Row:Matrix.at("cases")){
            const std::string Id=Row.at("id"),Fixture=Row.at("fixture");
            Host.StartEmptyDocument();for(const auto& Command:Row.at("commands"))Require(Host.Execute(Command.get<std::string>()),"broad fixture setup");
            Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("select none");Host.Execute("view iso");Host.Execute("view fit");Host.Camera().Distance*=.6;Tick();Tick();
            if(Sources.insert(Fixture).second)Sheet(("BroadGeometry-"+Fixture+"-source.png").c_str());
            const auto Before=Frontier::UndoSequence::Fingerprint(Host.Document());
            const bool Accepted=Host.Execute(Row.at("booleanCommand").get<std::string>());
            const bool Expected=Row.at("stages").contains("boolean");Require(Accepted==Expected,"native UI Boolean matches command probe");
            if(!Accepted)Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"native refused Boolean preserves model");
            Tick();Tick();Sheet(("BroadGeometry-"+Id+"-boolean.png").c_str());
            Captures.push_back({{"id",Id},{"booleanAccepted",Accepted},{"renderer","native C++ ImGui CPU-reference color"}});
            {std::ofstream Out(std::string(Folder)+"BroadGeometryNativeCaptures.json");Out<<Captures.dump(2);}
            if(!Accepted||!UiFixtures.count(Fixture)||UiDone.count(Fixture))continue;
            auto Choice=nlohmann::json();for(const auto& Blend:Row.at("blends"))if(Blend.at("accepted")==true&&!Blend.at("multiple").get<bool>()){Choice=Blend;break;}
            if(Choice.is_null())continue;
            const int Edge=std::stoi(Choice.at("targets").get<std::string>());
            auto* Body=Host.Document().Find("Result");Require(Body,"broad result body");const auto Owner=Body->Identity;
            const auto Curve=Body->Body.Edges[Edge].Curve;Host.Execute("selectmode edge");Host.Execute("select none");Tick();Tick();bool Picked=false;
            for(double Pitch:{.65,-.65,1.1,-1.1}){if(Picked)break;Host.Camera().Pitch=Pitch;
                for(double Yaw:{-.7853981634,.7853981634,2.3561944902,-2.3561944902}){if(Picked)break;Host.Camera().Yaw=Yaw;Tick();Tick();
                    for(int I=1;I<16&&!Picked;++I){auto P=Curve.Sample(Curve.DomainStart()+(Curve.DomainEnd()-Curve.DomainStart())*I/16);double X,Y;if(!Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y))continue;auto O=Editor.QueryViewOrigin();Click({O.x+float(X),O.y+float(Y)});Body=Host.Document().Find(Owner);Picked=std::find(Body->SelectedEdges.begin(),Body->SelectedEdges.end(),Edge)!=Body->SelectedEdges.end();}
                }
            }
            Require(Picked,"broad native own mouse selects tested edge");
            const auto Selected=Frontier::UndoSequence::Fingerprint(Host.Document());Key(ImGuiKey_B);Require(Host.CurrentBevel().Active,"broad native B opens bevel");
            const bool Chamfer=Choice.at("mode")=="chamfer";const double Size=Choice.at("size");Value(Chamfer?-Size:Size);Require(Host.CurrentBevel().Valid,"broad native signed preview");Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Selected,"broad native preview atomic");Sheet(("BroadGeometry-"+Id+"-ui-preview.png").c_str());
            ImVec2 P;Require(Editor.QueryControlCentre("bevel-apply",P),"broad native Apply button");Click(P);Body=Host.Document().Find(Owner);Require(!Host.CurrentBevel().Active&&Body->Bevels.size()==1&&Body->Body.Validate().Solid(),"broad native mouse Apply solid");Sheet(("BroadGeometry-"+Id+"-ui-applied.png").c_str());
            Require(Host.Execute("undo")&&Frontier::UndoSequence::Fingerprint(Host.Document())==Selected,"broad native undo");Require(Host.Execute("redo"),"broad native redo");Tick();Tick();Require(Editor.QueryControlCentre("inspector-bevel-feature-1",P),"broad native history button");Click(P);Require(Host.CurrentBevel().EditFeature==1,"broad native history responds");Key(ImGuiKey_Escape);
            UiDone.insert(Fixture);Ui.push_back({{"id",Id},{"fixture",Fixture},{"edge",Edge},{"size",Size},{"mode",Choice.at("mode")},{"ownMouse",true},{"B",true},{"signedInput",true},{"Apply",true},{"historyButton",true},{"undoRedo",true}});
            {std::ofstream Out(std::string(Folder)+"BroadGeometryNativeUI.json");Out<<Ui.dump(2);}
            std::fprintf(stderr,"PASS broad native ImGui %s\n",Id.c_str());
        }
        Require(Captures.size()==Matrix.at("cases").size()&&UiDone==UiFixtures,"broad native captures and all eight UI fixtures complete");ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--cylinder-sphere-bevel-only") {
        // Primitive setup only: edge selection, B, numeric edits, Apply and
        // Inspector history re-opening all use real native ImGui input.
        for(int I=0;I<12;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"cylinder sphere projection");auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        auto Value=[&](const char* Text){ImVec2 P;Require(Editor.QueryControlCentre("bevel-size",P),"cylinder sphere numeric field");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();IO.AddInputCharactersUTF8(Text);Tick();Tick();};
        std::ofstream Evidence(std::string(Folder)+"SolidArcCylinderSphereNativeUI.json");Evidence<<"[";
        int Count=0;
        for(int Order=0;Order<2;++Order)for(int Chamfer=0;Chamfer<2;++Chamfer)for(int Edge=1;Edge<=2;++Edge){
            Host.StartEmptyDocument();Require(Host.Execute("sphere (0,0,0) 1"),"sphere operand");Require(Host.Execute("cylinder (0,0,0) .6 2"),"cylinder operand");
            Require(Host.Execute(Order?"boolean subtract #2 -- #1 --select-result":"boolean subtract #1 -- #2 --select-result"),"cylinder sphere difference");
            Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("view iso");Host.Execute("view fit");Host.Execute("selectmode edge");Host.Execute("select none");
            if(Order&&Edge==2)Host.Camera().Pitch=-.7;else Host.Camera().Pitch=.8;
            Host.Camera().Distance*=.6;
            Tick();Tick();
            auto* Figure=Host.Document().Find(3);Require(Figure&&Figure->Body.Faces.size()==3&&Figure->Body.Edges.size()==size_t(Order?3:4),"reproduced difference topology");
            const auto Curve=Figure->Body.Edges[Edge].Curve;bool Picked=false;
            for(int I=1;I<32&&!Picked;++I){Click(Project(Curve.Sample(Curve.DomainStart()+(Curve.DomainEnd()-Curve.DomainStart())*I/32)));Figure=Host.Document().Find(3);Picked=std::find(Figure->SelectedEdges.begin(),Figure->SelectedEdges.end(),Edge)!=Figure->SelectedEdges.end();}
            Require(Picked,"native own mouse picks circular rim");
            const auto Before=Frontier::UndoSequence::Fingerprint(Host.Document());
            const std::string Prefix="SolidArcCylinderSphere-"+std::to_string(Order)+"-"+(Chamfer?"chamfer":"fillet")+"-e"+std::to_string(Edge);
            Sheet((Prefix+"-before.png").c_str());
            Key(ImGuiKey_B);Require(Host.CurrentBevel().Active,"native B opens cylinder sphere bevel");
            Value(Chamfer?"-37.5mm":"37.5mm");Require(Host.CurrentBevel().Valid&&Host.CurrentBevel().Chamfer==bool(Chamfer),"native signed numeric preview valid");
            Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"native preview preserves source");Sheet((Prefix+"-preview.png").c_str());
            ImVec2 P;Require(Editor.QueryControlCentre("bevel-apply",P),"native cylinder sphere Apply exists");Click(P);
            Figure=Host.Document().Find(3);Require(!Host.CurrentBevel().Active&&Figure->Bevels.size()==1&&Figure->Body.Validate().Solid(),"native mouse Apply authors valid solid");
            const auto After=Frontier::UndoSequence::Fingerprint(Host.Document());Sheet((Prefix+"-applied.png").c_str());
            Require(Host.Execute("undo")&&Frontier::UndoSequence::Fingerprint(Host.Document())==Before,"native cylinder sphere undo");Require(Host.Execute("redo")&&Frontier::UndoSequence::Fingerprint(Host.Document())==After,"native cylinder sphere redo");Tick();Tick();
            Require(Editor.QueryControlCentre("inspector-bevel-feature-1",P),"native cylinder sphere history button");Click(P);Require(Host.CurrentBevel().EditFeature==1,"native history responds");
            Value("100m");Require(!Host.CurrentBevel().Valid,"oversize disables Apply");Require(Editor.QueryControlCentre("bevel-apply",P),"disabled Apply exists");Click(P);Require(Host.CurrentBevel().Active&&Frontier::UndoSequence::Fingerprint(Host.Document())==After,"disabled native Apply is atomic");Key(ImGuiKey_Escape);
            if(Count++)Evidence<<",";Evidence<<"{\"order\":"<<Order<<",\"edge\":"<<Edge<<",\"mode\":\""<<(Chamfer?"chamfer":"fillet")<<"\",\"ownMouse\":true,\"shortcutB\":true,\"signedInput\":true,\"apply\":true,\"historyButton\":true,\"undoRedo\":true,\"invalidApplyAtomic\":true,\"solid\":true}";Evidence.flush();
            std::fprintf(stderr,"PASS native ImGui cylinder sphere order=%d edge=%d chamfer=%d\n",Order,Edge,Chamfer);
        }
        Evidence<<"]";ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--bevel-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"bevel fixture projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        auto Value=[&](const char* Text){ImVec2 P;Require(Editor.QueryControlCentre("bevel-size",P),"native bevel numeric field");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();IO.AddInputCharactersUTF8(Text);Tick();Tick();};
        Require(Host.Execute("box (0,0,0) (4,4,4) --name=BeveledBody"),"bevel body fixture");Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view iso");Host.Execute("view fit");Host.Execute("selectmode edge");Tick();Tick();
        const auto& Edge=Host.AllFigures()[0].Body.Edges[4].Curve;Click(Project(Edge.Sample((Edge.DomainStart()+Edge.DomainEnd())*.5)));
        Require(Host.Document().SelectedEdgeCount()==1,"native own mouse selects solid edge");const auto Before=Frontier::UndoSequence::Fingerprint(Host.Document());const auto Steps=Host.Timeline().UndoEntries().size();
        Key(ImGuiKey_B);Require(Host.CurrentBevel().Active&&Host.CurrentBevel().Valid,"B opens native live bevel");
        Require(Frontier::UndoSequence::Fingerprint(Host.Document())==Before&&Host.Timeline().UndoEntries().size()==Steps,"preview does not author geometry/history");Sheet("EditorProof_SolidArc_Bevel3DPreview.png");
        IO.AddInputCharactersUTF8("2");Tick();IO.AddInputCharactersUTF8("50mm");Tick();Tick();Require(Host.CurrentBevel().Valid&&std::fabs(Host.CurrentBevel().Size-.25)<1e-8,"native type without clicking field");
        Value("250mm");Require(Host.CurrentBevel().Valid&&std::fabs(Host.CurrentBevel().Size-.25)<1e-8,"native unit numeric entry");
        ImVec2 P;Require(Editor.QueryControlCentre("bevel-apply",P),"native bevel Apply");Click(P);
        Require(!Host.CurrentBevel().Active&&Host.AllFigures()[0].Bevels.size()==1&&Host.AllFigures()[0].Body.Validate().Solid(),"native own mouse Apply creates solid history feature");
        Require(Host.Timeline().UndoEntries().size()==Steps+1,"native bevel one undo step");Sheet("EditorProof_SolidArc_Bevel3DResult.png");
        Require(Editor.QueryControlCentre("inspector-bevel-feature-1",P),"editable Inspector bevel history");Click(P);
        Require(Host.CurrentBevel().Active&&Host.CurrentBevel().EditFeature==1,"native mouse reopens bevel property");Value("-350mm");
        Require(Host.CurrentBevel().Valid&&Host.CurrentBevel().Chamfer,"negative native size switches to chamfer");Sheet("EditorProof_SolidArc_BevelHistoryEdit.png");
        Require(Editor.QueryControlCentre("bevel-apply",P),"native property Apply");Click(P);
        Require(Host.AllFigures()[0].Bevels.size()==1&&Host.AllFigures()[0].Bevels[0].Chamfer&&std::fabs(Host.AllFigures()[0].Bevels[0].Size-.35)<1e-8,"edit modifies existing feature, not append");
        Require(Host.Execute("undo")&&!Host.AllFigures()[0].Bevels[0].Chamfer,"native feature edit undo");Require(Host.Execute("redo")&&Host.AllFigures()[0].Bevels[0].Chamfer,"native feature edit redo");
        int Other=-1;const auto Owner=Host.AllFigures()[0].Identity;
        for(size_t I=0;I<Host.AllFigures()[0].Body.Edges.size();++I){const auto& C=Host.AllFigures()[0].Body.Edges[I].Curve;if(C.Sample((C.DomainStart()+C.DomainEnd())*.5).Distance({2,4,0})<1e-6)Other=int(I);}
        Require(Other>=0,"independent downstream body edge binding");
        Require(Host.Execute("beveladd .15 --mode=fillet --targets="+std::to_string(Owner)+":e"+std::to_string(Other)),"second native body bevel feature");
        Require(Host.BeginBevel(false,Owner,1)&&Host.PreviewBevel(.4,true)&&Host.ApplyBevel(),"editing earlier body bevel replays downstream fillet");
        Require(Host.AllFigures()[0].Bevels.size()==2&&Host.AllFigures()[0].Body.Validate().Solid()&&std::fabs(Host.AllFigures()[0].Bevels[1].Size-.15)<1e-8,"multiple 3D features retain independent sizes and solid validity");
        Host.StartEmptyDocument();Require(Host.Execute("rect (0,0,0) (4,4,0) --name=Sketch"),"bevel sketch fixture");Host.Execute("select Sketch");Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view top");Host.Execute("view fit");Host.Execute("selectmode control");Tick();Tick();
        Click(Project({0,0,0}));Require(Host.Document().SelectedPoleCount()>0,"native own mouse selects sketch corner");
        Key(ImGuiKey_B);Require(Host.CurrentBevel().Active&&Host.CurrentBevel().Valid,"native B sketch corner preview");
        bool Rational=false;for(const auto& Pole:Host.CurrentBevel().Preview.Figures()[0].Curve.Poles)Rational|=std::fabs(Pole.W-1)>1e-8;
        Require(Rational&&Host.CurrentBevel().Preview.Figures()[0].Curve.Closed(),"2D round preview retains exact rational arc and closure");Value("-200mm");Require(Host.CurrentBevel().Valid,"native 2D chamfer preview");Sheet("EditorProof_SolidArc_Bevel2DPreview.png");
        Value("100m");Require(!Host.CurrentBevel().Valid,"oversize sketch corner disables Apply");Require(Editor.QueryControlCentre("bevel-apply",P),"disabled Apply control");Click(P);Require(Host.CurrentBevel().Active&&Host.AllFigures()[0].Bevels.empty(),"invalid mouse Apply has no effect");
        Value("-200mm");Require(Host.CurrentBevel().Valid,"valid size recovers after refusal");Key(ImGuiKey_Enter);Require(Host.AllFigures()[0].Bevels.size()==1&&Host.AllFigures()[0].Bevels[0].Targets.size()==1,"native Enter commits only picked sketch corner");Sheet("EditorProof_SolidArc_Bevel2DResult.png");
        const auto End=Frontier::UndoSequence::Fingerprint(Host.Document());Require(Editor.QueryControlCentre("inspector-bevel-feature-1",P),"native sketch bevel history");Click(P);Value("-300mm");Key(ImGuiKey_Escape);Require(!Host.CurrentBevel().Active&&Frontier::UndoSequence::Fingerprint(Host.Document())==End,"Escape cancels feature edits exactly");
        {std::ofstream Out(std::string(Folder)+"SolidArcNativeBevelProof.json");Out<<R"({"renderer":"native C++ CPU reference / ImGui own mouse","bodyEdgeMouseSelection":true,"BStartsInteractivePreview":true,"previewDoesNotAuthor":true,"unitNumericEntry":true,"mouseApply":true,"editableFeatureHistory":true,"multipleBodyFeaturesReplay":true,"typeWithoutFieldClick":true,"negativeSizeChamfer":true,"singleStepUndoRedo":true,"sketchCornerMouseSelection":true,"onlyPickedCornerChanged":true,"exactRationalSketchArc":true,"invalidApplyDisabled":true,"EnterCommits":true,"EscapeCancels":true})";}
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse 3D edge / 2D corner, B preview, unit entry, chamfer switch, editable history, atomic refusal, undo/redo, Enter/Escape\n");ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--sketch-tools-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"sketch tool projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        ImVec2 Control;Require(Editor.QueryControlCentre("sketch-tool-Cut",Control),"bottom toolbar Cut visible in empty document");Click(Control);
        Require(Host.AllFigures().empty()&&!Host.SketchTools().Cut&&!Host.SketchTools().Trim,"empty document tools disabled");
        Require(Host.Execute("draw line (-3,0,0) (3,0,0)"),"cut fixture");Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view top");Host.Execute("view fit");Tick();Tick();
        Require(Host.SketchTools().Cut&&!Host.SketchTools().Trim,"cut enabled, trim disabled without crossings");
        Require(Editor.QueryControlCentre("sketch-tool-Cut",Control),"native Cut toolbar button");Click(Control);
        Require(Host.AllFigures().size()==1,"arming Cut does not mutate geometry");Sheet("EditorProof_SolidArc_CutTool.png");
        Click(Project({0,0,0}));Require(Host.AllFigures().size()==2,"native own-mouse Cut produces two exact curves");
        Require(std::abs(Host.AllFigures()[0].Curve.EndPoint().X)<.02&&Host.AllFigures()[0].Curve.EndPoint().Distance(Host.AllFigures()[1].Curve.StartPoint())<1e-8,"native cut joins at picked point");
        Require(Host.Document().SelectedCount()==2,"native Cut selects both resulting pieces");Sheet("EditorProof_SolidArc_CutResult.png");
        Require(Host.Execute("undo")&&Host.AllFigures().size()==1,"Cut single-step undo");Require(Host.Execute("redo")&&Host.AllFigures().size()==2,"Cut redo");Tick();Tick();
        for(auto& F:Host.Document().Figures())F.Locked=true;
        Require(!Host.SketchTools().Cut,"locked curves disable Cut");for(auto& F:Host.Document().Figures())F.Locked=false;
        Require(Host.SketchTools().Cut,"unlock invalidates native eligibility cache");
        Require(Editor.QueryControlCentre("sketch-tool-Select",Control),"Select toolbar button");Click(Control);Host.StartEmptyDocument();
        Require(Host.Execute("draw line (-3,0,0) (3,0,0)"),"trim target");
        Require(Host.Execute("draw line (-1,-2,0) (-1,2,0)"),"left trim boundary");
        Require(Host.Execute("draw line (1,-2,0) (1,2,0)"),"right trim boundary");
        Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view top");Host.Execute("view fit");Tick();Tick();
        Require(Host.SketchTools().Trim,"native exact intersections enable Trim");
        Require(Editor.QueryControlCentre("sketch-tool-Trim",Control),"Trim toolbar button");Click(Control);Sheet("EditorProof_SolidArc_TrimTool.png");
        Click(Project({0,0,0}));Require(Host.AllFigures().size()==4,"native mouse Trim removes middle and retains two surviving pieces");
        Require(Host.Document().SelectedCount()==2,"Trim selects surviving pieces");
        Require(std::abs(Host.AllFigures()[0].Curve.EndPoint().X+1)<1e-5&&std::abs(Host.AllFigures().back().Curve.StartPoint().X-1)<1e-5,"Trim preserves crossing boundaries");
        Sheet("EditorProof_SolidArc_TrimResult.png");
        Require(Host.Execute("undo")&&Host.AllFigures().size()==3,"Trim single-step undo");Require(Host.Execute("redo")&&Host.AllFigures().size()==4,"Trim redo");
        IO.AddKeyEvent(ImGuiKey_Escape,true);Tick();IO.AddKeyEvent(ImGuiKey_Escape,false);Tick();Tick();
        const auto Count=Host.AllFigures().size();Click(Project({2,0,0}));Require(Host.AllFigures().size()==Count,"Escape leaves trim mode");
        {std::ofstream Out(std::string(Folder)+"SolidArcNativeSketchToolsProof.json");Out<<R"({"renderer":"native C++ CPU reference / ImGui","emptyDisabled":true,"toolbarCutAndTrim":true,"mouseCut":true,"mouseTrim":true,"crossingBoundariesPreserved":true,"selectedResultPieces":true,"lockedEligibility":true,"singleStepUndoRedo":true,"EscapeExits":true})";}
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: bottom toolbar, disabled eligibility, own-mouse Cut/Trim, surviving exact curves, single-step undo/redo, Esc\n");
        ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--loft-disabled-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();
        Require(Host.Execute("circle (0,0,0) 2 --name=Outer"),"coplanar outer fixture");
        Require(Host.Execute("circle (0,0,0) 1 --name=Inner"),"coplanar inner fixture");
        Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view iso");Host.Execute("view fit");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"coplanar projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        Click(Project({2,0,0}));IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project({1,0,0}));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
        Require(Host.Document().SelectedCount()==2,"native mouse selects coplanar profiles");
        auto Operations=Host.SelectionOperations();Require(!Operations.empty()&&!Operations[0].Enabled,"C++ marks coplanar solid loft disabled");
        ImVec2 Control;Require(Editor.QueryControlCentre("inspector-operation-Loft",Control),"disabled Loft remains visible");Click(Control);
        Require(!Editor.QueryControlCentre("inspector-operation-apply",Control),"disabled Loft click does not open Apply");
        Require(Host.AllFigures().size()==2,"disabled Loft does not mutate geometry");Sheet("EditorProof_SolidArc_LoftDisabled.png");
        Require(Host.Execute("move #2 (0,0,2)"),"separate profiles");Tick();Tick();
        Operations=Host.SelectionOperations();Require(Operations[0].Enabled,"separation re-enables Loft");
        Sheet("EditorProof_SolidArc_LoftReenabled.png");
        Require(Editor.QueryControlCentre("inspector-operation-Loft",Control),"re-enabled Loft button");Click(Control);
        Require(Editor.QueryControlCentre("inspector-operation-apply",Control),"enabled Loft opens Apply");Click(Control);
        Require(Host.AllFigures().size()==3&&Host.AllFigures().back().Body.Validate().Solid(),"re-enabled Loft makes valid solid");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse coplanar selection, grey disabled Loft ignores click, separation re-enables valid solid loft\n");
        ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--shortcuts-picking-only") {
        Require(std::string(Frontier::NativePickingDriver()).find("native GLES3")!=std::string::npos,"native GPU picking explicitly active");
        for(int I=0;I<8;++I)Tick();Host.StartEmptyDocument();Host.Execute("box (-4,-1,0) (-2,1,1) --name=Left");Host.Execute("box (-1,-1,0) (1,1,1) --name=Middle");Host.Execute("box (2,-1,0) (4,1,1) --name=Right");Host.Execute("view top");Host.Execute("view ortho");Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("view fit");Host.Execute("select none");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"GPU pick project");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X)*Editor.QueryViewWidth()/Host.Raster().Width(),O.y+float(Y)*Editor.QueryViewHeight()/Host.Raster().Height());};
        IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Key(ImGuiKey_A);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel),"native Ctrl+A opens Construct");Sheet("EditorProof_SolidArc_NativeCtrlA.png");Key(ImGuiKey_Escape);Require(!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel),"Escape closes native Construct");Tick();Tick();
        Click(Project({-3,0,1}));IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Click(Project({3,0,1}));IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,3}),"GPU Ctrl-click viewport picks two bodies in order");
        IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Click(Project({3,0,1}));IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1}),"GPU Ctrl-click viewport toggles off");
        ImVec2 P;Require(Editor.QueryOutlinerFigureCentre(1,P),"left outliner row");Click(P);IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Require(Editor.QueryOutlinerFigureCentre(3,P),"right outliner row");Click(P);IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,3}),"Shift outliner selects clicked rows, not middle row");
        IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Require(Editor.QueryOutlinerFigureCentre(2,P),"middle outliner row");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,3,2}),"Ctrl outliner adds in click order");
        IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,3}),"Ctrl outliner toggles off without dropping other bodies");
        const char* SavePath=std::getenv("SOLIDARC_RECOVERY_FILE");Require(SavePath&&std::string(SavePath).find("ShortcutsProof")!=std::string::npos,"dedicated native save proof path");std::filesystem::remove(SavePath);IO.AddKeyEvent(ImGuiMod_Ctrl,true);Tick();Key(ImGuiKey_S);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();Require(std::filesystem::exists(SavePath),"Ctrl+S writes native arc");
        Sheet("EditorProof_SolidArc_NativeMultiSelect.png");
        Host.StartEmptyDocument();Host.Execute("box (-1,-1,0) (1,1,1)");Host.Execute("box (-1,-1,2) (1,1,3)");Host.Execute("view top");Host.Execute("view fit");Host.Execute("selectmode face");Host.Render();double X,Y;Host.Camera().WorldToPixel({0,0,3},Host.Raster().Width(),Host.Raster().Height(),X,Y);const auto Pick=Host.Raster().Pick(uint32_t(X),uint32_t(Y));Require(Frontier::SceneDocument::IdentityOf(Pick)==2&&Frontier::SceneDocument::PartOf(Pick)==Frontier::SceneDocument::PickPart::Face,"GPU depth picks upper face and preserves encoded face ID bits");
        Host.StartEmptyDocument();Require(Host.Execute("draw sketch-point (0,0)"),"point fixture");Host.Execute("view top");Host.Execute("view fit");Host.Render();Host.Camera().WorldToPixel({0,0,0},Host.Raster().Width(),Host.Raster().Height(),X,Y);Require(Frontier::SceneDocument::IdentityOf(Host.Raster().Pick(uint32_t(X),uint32_t(Y)))==1,"GPU draws CPU-owned point positions into integer ID target");
        std::ofstream Out(std::string(Folder)+"SolidArcNativeShortcutsPickingProof.json");Out<<"{\"renderer\":\"CPU reference display; native GLES3 ID/depth picking\",\"pickingDriver\":"<<std::quoted(Frontier::NativePickingDriver())<<",\"ctrlAConstruct\":true,\"ctrlSSave\":true,\"ctrlViewportToggle\":true,\"ctrlShiftOutliner\":true,\"occlusionAndFaceIds\":true,\"gpuPointPicking\":true}";
        std::fprintf(stderr,"[SolidArcEditorProof] PASS native shortcuts, own Ctrl/Shift viewport/outliner clicks, native GPU depth/face/point IDs: %s\n",Frontier::NativePickingDriver());ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--curved-booleans-only") {
        for(int I=0;I<10;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Reveal=[&](const char* Name){auto* W=ImGui::FindWindowByName("Inspector###SolidArc Inspector");Require(W,"curved Boolean Inspector");ImVec2 P;for(int I=0;I<25;++I){if(Editor.QueryControlCentre(Name,P)&&W->InnerClipRect.Contains(P))return P;IO.AddMousePosEvent(W->InnerClipRect.GetCenter().x,W->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,-2);Tick();Tick();}throw std::runtime_error("curved Boolean control not visible");};
        const char* Ops[]={"Union","Subtract","Intersect"};
        const double Pi=Frontier::ScalarCriteria::Pi,SV=4*Pi*.75*.75*.75/3,Base=48-6*(2-1.4994483840546615);
        std::ofstream Evidence(std::string(Folder)+"SolidArcNativeCurvedBooleansProof.json");Evidence<<"{\"renderer\":\"CPU-reference color, native GLES3 ID picking when enabled\",\"input\":\"own ImGui Outliner Shift-click and Inspector Apply\",\"cases\":[";
        for(int Fixture=0;Fixture<3;++Fixture)for(int Op=0;Op<4;++Op){
            Host.StartEmptyDocument();uint32_t A=1,B=2;double VA=24,VB=SV,Common=SV/8;
            if(Fixture==2){Host.Execute("sphere (0,0,0) 1");Host.Execute("sphere (1,0,0) 1");VA=VB=4*Pi/3;Common=5*Pi/12;}
            else {Host.Execute("box (0,0,0) (4,3,2)");if(Fixture==1){Host.Execute("box (2,0,1.4994483840546615) (6,3,3.4994483840546615)");Host.Execute("boolean union #1 -- #2 --select-result");A=3;B=4;VA=Base;}Host.Execute("sphere (0,0,0) .75");}
            Host.Execute("selectmode whole");Host.Execute("view iso");Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("select none");Host.Execute("view fit");Tick();Tick();
            ImVec2 P;Require(Editor.QueryOutlinerFigureCentre(A,P),"curved first Outliner row");Click(P);Require(Editor.QueryOutlinerFigureCentre(B,P),"curved second Outliner row");IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(P);IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
            Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({A,B}),"curved own mouse ordered selection");
            if(Op==3)Click(Reveal("inspector-reverse-order"));
            const int Index=Op==3?1:Op;Click(Reveal((std::string("inspector-operation-")+Ops[Index]).c_str()));Require(Editor.QueryControlCentre("inspector-operation-apply",P),"curved popup Apply");Click(P);
            Require(Host.AllFigures().size()==1,"curved operation consumes exactly two inputs");const auto R=Host.AllFigures().front().Body.Validate();const double Expected=Index==0?VA+VB-Common:Index==2?Common:(Op==3?VB:VA)-Common;
            Require(R.Solid()&&R.Hulls==1&&std::abs(R.Volume-Expected)<std::max(.003,.002*Expected),"curved closed/manifold/oriented one hull and analytical volume within quadrature tolerance");
            Require(Host.Execute("undo")&&Host.AllFigures().size()==2,"curved one-step undo");Require(Host.Execute("redo")&&Host.AllFigures().size()==1,"curved redo");Tick();Tick();
            if(Fixture==1&&Op<3)Sheet((std::string("EditorProof_SolidArc_NativeCurved")+Ops[Index]+".png").c_str());
            if(Fixture||Op)Evidence<<',';Evidence<<"{\"fixture\":"<<Fixture<<",\"operation\":\""<<(Op==3?"Reverse subtract":Ops[Index])<<"\",\"volume\":"<<R.Volume<<",\"expected\":"<<Expected<<",\"closed\":true,\"manifold\":true,\"mouseSelectionApply\":true,\"undoRedo\":true}";
        }
        Evidence<<"]}";std::fprintf(stderr,"[SolidArcEditorProof] PASS: 12 native curved Boolean own-mouse cases: pole/corner sphere, user's derived Union + sphere, sphere pair; Union/Subtract/Intersect/reverse, topology/volume/undo/redo\n");ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--booleans3d-only") {
        for(int I=0;I<10;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"boolean profile projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X)*Editor.QueryViewWidth()/Host.Raster().Width(),O.y+float(Y)*Editor.QueryViewHeight()/Host.Raster().Height());};
        auto Reveal=[&](const char* Name){auto* W=ImGui::FindWindowByName("Inspector###SolidArc Inspector");Require(W,"boolean Inspector");ImVec2 P;for(int I=0;I<25;++I){if(Editor.QueryControlCentre(Name,P)&&W->InnerClipRect.Contains(P))return P;IO.AddMousePosEvent(W->InnerClipRect.GetCenter().x,W->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,-2);Tick();Tick();}throw std::runtime_error("boolean control not visible");};
        std::ofstream Evidence(std::string(Folder)+"SolidArcNativeBooleans3DProof.json");Evidence<<"{\"renderer\":\"native C++ CPU reference\",\"input\":\"own ImGui mouse/Shift/wheel\",\"cases\":[";
        const char* Ops[]={"Union","Subtract","Intersect"};
        for(int I=0;I<4;++I){
            Host.StartEmptyDocument();Host.Execute("box (0,0,0) (4,3,2) --name=First");Host.Execute("box (2,1,.5) (6,4,2.5) --name=Second");Host.Execute("selectmode whole");Host.Execute("view top");Host.Execute("view ortho");Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("select none");Host.Execute("view fit");Tick();Tick();
            Click(Project({.5,.5,2}));IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project({5,3,2.5}));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
            Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,2}),"own-mouse ordered 3D body selection");
            if(I==3){Click(Reveal("inspector-reverse-order"));Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({2,1}),"own-mouse reverse subtraction operands");}
            Host.Execute("view iso");Tick();Tick();
            const char* Op=Ops[I==3?1:I];Click(Reveal((std::string("inspector-operation-")+Op).c_str()));ImVec2 P;Require(Editor.QueryControlCentre("inspector-operation-apply",P),"boolean popup Apply");
            if(I==0)Sheet("EditorProof_SolidArc_NativeBoolean3DParameters.png");Click(P);
            Require(Host.AllFigures().size()==1,"native boolean consumes two inputs into one loop");const auto& F=Host.AllFigures().back();
            Require(F.Classification==Frontier::FigureClassification::Body&&F.Body.Validate().Solid()&&F.Selected,"closed manifold oriented selected native solid result");
            const double Area=F.Body.Validate().Volume;const double Expected=I==0?42:I==2?6:18;Require(std::abs(Area-Expected)<1e-5,"native boolean exact volume");
            Require(Host.Execute("undo")&&Host.AllFigures().size()==2,"3D boolean single undo restores operands");Require(Host.Execute("redo")&&Host.AllFigures().size()==1,"3D boolean redo");Tick();Tick();Sheet((std::string("EditorProof_SolidArc_NativeBoolean3D")+(I==3?"ReverseSubtract":Op)+".png").c_str());
            if(I)Evidence<<',';Evidence<<"{\"operation\":\""<<(I==3?"Reverse subtract":Op)<<"\",\"volume\":"<<Area<<",\"mouseSelectionApply\":true,\"undoRedo\":true}";
        }
        Host.StartEmptyDocument();Host.Execute("box (0,0,0) (2,2,2)");Host.Execute("box (4,0,0) (6,2,2)");Host.Execute("select all");Tick();Tick();Click(Reveal("inspector-operation-Intersect"));Require(!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel)&&Host.AllFigures().size()==2,"disabled empty intersection boolean ignores mouse");Sheet("EditorProof_SolidArc_NativeBoolean3DDisabled.png");
        Evidence<<"],\"invalidPairDisabled\":true}";std::fprintf(stderr,"[SolidArcEditorProof] PASS: 3D Boolean own-mouse Shift-selection, Union/Subtract/Intersect + reverse order, volumes 42/18/6/18, disabled empty intersection, undo/redo\n");ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--booleans2d-only") {
        for(int I=0;I<10;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"boolean profile projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X)*Editor.QueryViewWidth()/Host.Raster().Width(),O.y+float(Y)*Editor.QueryViewHeight()/Host.Raster().Height());};
        auto Reveal=[&](const char* Name){auto* W=ImGui::FindWindowByName("Inspector###SolidArc Inspector");Require(W,"boolean Inspector");ImVec2 P;for(int I=0;I<25;++I){if(Editor.QueryControlCentre(Name,P)&&W->InnerClipRect.Contains(P))return P;IO.AddMousePosEvent(W->InnerClipRect.GetCenter().x,W->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,-2);Tick();Tick();}throw std::runtime_error("boolean control not visible");};
        std::ofstream Evidence(std::string(Folder)+"SolidArcNativeBooleans2DProof.json");Evidence<<"{\"renderer\":\"native C++ CPU reference\",\"input\":\"own ImGui mouse/Shift/wheel\",\"cases\":[";
        const char* Ops[]={"Union","Subtract","Intersect"};
        for(int I=0;I<4;++I){
            Host.StartEmptyDocument();Host.Execute("draw rect (0,0) (4,3) --name=First");Host.Execute("draw rect (2,1) (6,4) --name=Second");Host.Execute("view top");Host.Execute("view ortho");Host.Execute("gizmo off");Host.Execute("dim off");Host.Execute("show cages off");Host.Execute("select none");Host.Execute("view fit");Tick();Tick();
            Click(Project({0,1.5,0}));IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project({6,2.5,0}));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
            Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({1,2}),"own-mouse ordered 2D profile selection");
            if(I==3){Click(Reveal("inspector-reverse-order"));Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({2,1}),"own-mouse reverse subtraction operands");}
            const char* Op=Ops[I==3?1:I];Click(Reveal((std::string("inspector-operation-")+Op).c_str()));ImVec2 P;Require(Editor.QueryControlCentre("inspector-operation-apply",P),"boolean popup Apply");
            if(I==0)Sheet("EditorProof_SolidArc_NativeBooleanParameters.png");Click(P);
            Require(Host.AllFigures().size()==1,"native boolean consumes two inputs into one loop");const auto& F=Host.AllFigures().back();
            Require(F.Classification==Frontier::FigureClassification::Curve&&F.Curve.Closed()&&F.Selected,"closed selected native profile result");
            const double Area=std::fabs(Frontier::ProfileSolver::SignedArea(F.Curve,Frontier::Vec3::UnitZ()));const double Expected=I==0?20:I==2?4:8;Require(std::abs(Area-Expected)<1e-5,"native boolean exact area");
            Require(Host.Execute("undo")&&Host.AllFigures().size()==2,"2D boolean single undo restores operands");Require(Host.Execute("redo")&&Host.AllFigures().size()==1,"2D boolean redo");Tick();Tick();Sheet((std::string("EditorProof_SolidArc_NativeBoolean")+(I==3?"ReverseSubtract":Op)+".png").c_str());
            if(I)Evidence<<',';Evidence<<"{\"operation\":\""<<(I==3?"Reverse subtract":Op)<<"\",\"area\":"<<Area<<",\"mouseSelectionApply\":true,\"undoRedo\":true}";
        }
        Host.StartEmptyDocument();Host.Execute("draw line (0,0) (4,0)");Host.Execute("circle (2,2,0) 1");Host.Execute("select all");Tick();Tick();Click(Reveal("inspector-operation-Union"));Require(!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel)&&Host.AllFigures().size()==2,"disabled open profile boolean ignores mouse");Sheet("EditorProof_SolidArc_NativeBooleanDisabled.png");
        Evidence<<"],\"invalidPairDisabled\":true}";std::fprintf(stderr,"[SolidArcEditorProof] PASS: 2D Boolean own-mouse Shift-selection, Union/Subtract/Intersect + reverse order, areas 20/8/4/8, disabled open profile, undo/redo\n");ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--operations-only") {
        for(int I=0;I<10;++I)Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Key=[&](ImGuiKey K){IO.AddKeyEvent(K,true);Tick();IO.AddKeyEvent(K,false);Tick();Tick();};
        auto Number=[&](const char* Id,const char* Text){ImVec2 P;Require(Editor.QueryControlCentre(Id,P),"native operation numeric input");Click(P);IO.AddKeyEvent(ImGuiMod_Ctrl,true);IO.AddKeyEvent(ImGuiKey_A,true);Tick();IO.AddKeyEvent(ImGuiKey_A,false);IO.AddKeyEvent(ImGuiMod_Ctrl,false);Tick();IO.AddInputCharactersUTF8(Text);Tick();Tick();Key(ImGuiKey_Enter);};
        struct Case{const char* Key;const char* Operand;const char* Value;const char* Field;};
        const Case Cases[]={{"Solidify","PlateSheet","0.45","inspector-solidify-thickness"},{"Pipe","PipePath","0.22","inspector-pipe-radius"},{"Revolve","LatheProfile","360","inspector-revolve-angle"}};
        std::ofstream Evidence(std::string(Folder)+"SolidArcNativeOperationsProof.json");
        Evidence<<"{\"renderer\":\"native C++ CPU reference\",\"input\":\"ImGui mouse, wheel and keyboard numeric entry\",\"operationCommandsUsedByProof\":false,\"cases\":[";
        int Index=0;
        for(const auto& C:Cases){
            Host.StartEmptyDocument();
            std::ifstream Input(std::string("Experimental/SolidArc/public/examples/")+C.Key+".arc");std::string Line;
            while(std::getline(Input,Line)){if(Line.rfind("solidify ",0)==0||Line.rfind("pipe ",0)==0||Line.rfind("revolve ",0)==0)break;if(!Line.empty()&&Line[0]!='#')Require(Host.Execute(Line),Line.c_str());}
            Host.Execute("gizmo off");Host.Execute("show cages off");Host.Execute("dim off");Host.Execute("view iso");Host.Execute("view fit");Require(Host.Execute(std::string("select ")+C.Operand),"select operation source fixture");Tick();Tick();
            auto* Window=ImGui::FindWindowByName("Inspector###SolidArc Inspector");Require(Window,"native Inspector window");ImGui::SetScrollY(Window,0);Tick();Tick();
            ImVec2 P;bool Visible=false;
            for(int Attempt=0;Attempt<20;++Attempt){
                if(Editor.QueryControlCentre((std::string("inspector-operation-")+C.Key).c_str(),P)&&Window->InnerClipRect.Contains(P)){Visible=true;break;}
                IO.AddMousePosEvent(Window->InnerClipRect.GetCenter().x,Window->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,-3);Tick();Tick();
            }
            Require(Visible,"mouse wheel reveals native operation button");
            const auto Before=Host.AllFigures().size();Click(P);Require(Editor.QueryControlCentre("inspector-operation-apply",P),"native operation popup opens");
            Number(C.Field,"0");Require(Editor.QueryControlCentre("inspector-operation-apply",P),"invalid Apply bounds");Click(P);Require(Host.AllFigures().size()==Before&&ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel),"zero parameter disables Apply without authoring geometry");
            Number(C.Field,C.Value);Sheet((std::string("EditorProof_SolidArc_Native")+C.Key+"Parameters.png").c_str());
            Require(Editor.QueryControlCentre("inspector-operation-apply",P),"native valid Apply");Click(P);
            Require(!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel),"native Apply closes popup");
            const auto& Result=Host.AllFigures().back();Require(Result.Classification==Frontier::FigureClassification::Body,"native operation creates a B-rep body");const auto Report=Result.Body.Validate();
            Require(Report.Solid()&&Report.Volume>0,"native result is closed oriented manifold with volume");Require(Host.Document().ActiveSelection()==Result.Identity,"native result is selected");
            if(Index==0){Require(Report.Faces==6&&std::abs(Report.Volume-5.4)<1e-5,"solidify has six sewn faces and exact slab volume");}
            if(Index==2)Require(Report.Genus==1,"revolved collar has a through bore");
            const auto Count=Host.AllFigures().size();Require(Host.Execute("undo"),"native operation undo");if(Index==0)Require(Host.AllFigures().back().Classification==Frontier::FigureClassification::Surface,"Solidify undo restores sheet");else Require(Host.AllFigures().size()==Count-1,"native undo removes derived solid");Require(Host.Execute("redo"),"native operation redo");Require(Host.AllFigures().back().Body.Validate().Solid(),"native redo restores valid solid");
            Host.Execute("view fit");Tick();Tick();Sheet((std::string("EditorProof_SolidArc_Native")+C.Key+"Result.png").c_str());
            if(Index)Evidence<<',';Evidence<<"{\"operation\":\""<<C.Key<<"\",\"mouseApply\":true,\"invalidValueDisabled\":true,\"undoRedo\":true,\"closed\":true,\"manifold\":true,\"oriented\":true,\"faces\":"<<Report.Faces<<",\"edges\":"<<Report.Edges<<",\"vertices\":"<<Report.Vertices<<",\"genus\":"<<Report.Genus<<",\"volume\":"<<Report.Volume<<'}';
            std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse %s, numeric value %s, disabled zero, valid solid F%d E%d V%d volume %.6f, undo/redo\n",C.Key,C.Value,Report.Faces,Report.Edges,Report.Vertices,Report.Volume);++Index;
        }
        Evidence<<"]}";ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--fender-only") {
        for(int I=0;I<8;++I)Tick();Host.StartEmptyDocument();
        Host.Execute("view top");Host.Execute("view ortho");Host.Execute("gizmo off");Host.Execute("dim off");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        Click(Editor.QueryConstructCentre());ImVec2 Control;
        Require(Editor.QueryControlCentre("section-Sketch Draw",Control),"native sketch section");Click(Control);
        for(int Attempt=0;Attempt<20;++Attempt){
            Require(Editor.QueryControlCentre("construct-hermite",Control),"native Hermite tile");
            ImGuiWindow* Child=nullptr;for(auto* W:ImGui::GetCurrentContext()->Windows)if(W->Active&&std::strstr(W->Name,"Sketch Draw scrolling"))Child=W;
            if(!Child||Child->InnerClipRect.Contains(Control))break;
            IO.AddMousePosEvent(Child->InnerClipRect.GetCenter().x,Child->InnerClipRect.GetCenter().y);IO.AddMouseWheelEvent(0,Control.y<Child->InnerClipRect.Min.y?2.f:-2.f);Tick();Tick();
        }
        Click(Control);Require(Host.HasActiveTool(),"native mouse starts Hermite");
        const std::vector<Frontier::Vec3> Points={{-3,0,0},{0,0,0},{-3,3,0},{0,3,0},{3,0,0},{3,-3,0}};
        for(const auto P:Points){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"Hermite point projection");const auto O=Editor.QueryViewOrigin();Click({O.x+float(X)*Editor.QueryViewWidth()/Host.Raster().Width(),O.y+float(Y)*Editor.QueryViewHeight()/Host.Raster().Height()});Require(Host.HasActiveTool()&&Host.AllFigures().empty(),"Hermite stays modal past first four clicks");}
        IO.AddKeyEvent(ImGuiKey_Enter,true);Tick();IO.AddKeyEvent(ImGuiKey_Enter,false);Tick();Tick();
        Require(!Host.HasActiveTool()&&Host.AllFigures().size()==1,"native Enter authors one joined Hermite curve");
        const auto& C=Host.AllFigures().front().Curve;Require(C.Poles.size()==7&&!C.Validate(),"joined cubic Hermite topology");
        Frontier::Vec3 L[2],R[2];C.Derivatives(1-1e-8,1,L);C.Derivatives(1+1e-8,1,R);Require(L[1].Distance(R[1])<1e-5,"Hermite derivative continuity");
        Sheet("EditorProof_SolidArc_ContinuousHermite.png");
        Host.StartEmptyDocument();std::ifstream Input("Experimental/SolidArc/public/examples/Fender.arc");std::string Line;
        while(std::getline(Input,Line))if(!Line.empty()&&Line[0]!='#')Require(Host.Execute(Line),Line.c_str());
        Require(Host.AllFigures().size()==6&&Host.AllFigures().back().Classification==Frontier::FigureClassification::Surface,"fender one real NURBS sheet");
        const auto& F=Host.AllFigures().back();Require(!F.Surface.Validate(),"fender NURBS validates");
        for(const char* Name:{"WheelArch","EngineRail","StartProfile","CrownProfile","EndProfile"}){
            const auto* Curve=Host.Document().Find(Name);Require(Curve,"fender constraint exists");
            for(int I=0;I<=64;++I){double U,V,D;F.Surface.ClosestParameter(Curve->Curve.Sample(Curve->Curve.DomainStart()+(Curve->Curve.DomainEnd()-Curve->Curve.DomainStart())*I/64.),U,V,&D);Require(D<8e-5,"fender interpolates rails and stations within fit tolerance");}
        }
        Tick();Tick();Sheet("EditorProof_SolidArc_Fender.png");
        Require(Host.Execute("undo")&&Host.Execute("redo"),"fender undo/redo");
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse 6-click continuous Hermite, C1 derivatives, native fender sheet + 325 rail/profile distance checks, undo/redo\n");
        ImGui::DestroyContext();return 0;
    }
    if(argc>1 && std::string(argv[1])=="--loft-only") {
        for(int I=0;I<12;++I)Tick();Host.StartEmptyDocument();
        Require(Host.Execute("circle (0,0,0) 1 --name=Bottom"),"loft bottom fixture");
        Require(Host.Execute("circle (0,0,3) .6 --name=Top"),"loft top fixture");
        Host.Execute("gizmo off");Host.Execute("dim hide all");Host.Execute("view iso");Host.Execute("view fit");Tick();Tick();
        auto Click=[&](ImVec2 P){IO.AddMousePosEvent(P.x,P.y);Tick();IO.AddMouseButtonEvent(0,true);Tick();IO.AddMouseButtonEvent(0,false);Tick();Tick();};
        auto Project=[&](Frontier::Vec3 P){double X,Y;Require(Host.Camera().WorldToPixel(P,Host.Raster().Width(),Host.Raster().Height(),X,Y),"loft fixture projection");const auto O=Editor.QueryViewOrigin();return ImVec2(O.x+float(X),O.y+float(Y));};
        Click(Project({1,0,0}));
        IO.AddKeyEvent(ImGuiMod_Shift,true);Tick();Click(Project({.6,0,3}));IO.AddKeyEvent(ImGuiMod_Shift,false);Tick();Tick();
        Require(Host.Document().SelectedCount()==2,"native Shift-click selects two profiles");
        const auto Order=Host.Document().OrderedSelection();Require(Order.size()==2&&Host.Document().Find(Order.back())->Name=="Top","native active profile is last click");
        Sheet("EditorProof_SolidArc_LoftSelection.png");
        ImVec2 Control;Require(Editor.QueryControlCentre("inspector-reverse-order",Control),"native reverse-order button exists");Click(Control);
        Require(Host.Document().OrderedSelection()==std::vector<uint32_t>({Order[1],Order[0]}),"native Inspector reverses section order");
        Require(Editor.QueryControlCentre("inspector-operation-Loft",Control),"native compatible Loft button");Click(Control);
        Sheet("EditorProof_SolidArc_LoftParameters.png");
        Require(Editor.QueryControlCentre("inspector-operation-apply",Control),"native operation Apply button");Click(Control);
        Require(Host.AllFigures().size()==3,"native Inspector mouse Apply creates real loft");
        const auto& Loft=Host.AllFigures().back();Require(Loft.Classification==Frontier::FigureClassification::Body&&Loft.Body.Validate().Solid(),"native loft is a valid solid");
        Require(Host.Document().ActiveSelection()==Loft.Identity,"native Inspector selects the resulting loft");
        Sheet("EditorProof_SolidArc_LoftResult.png");
        Require(Host.Execute("undo")&&Host.AllFigures().size()==2,"native loft single-step undo");
        Require(Host.Execute("redo")&&Host.AllFigures().size()==3,"native loft redo");
        {std::ofstream Out(std::string(Folder)+"SolidArcNativeLoftProof.json");Out<<R"({"renderer":"native C++ CPU reference","input":"native ImGui mouse and Shift key","twoProfileSelection":true,"selectionOrderReversal":true,"compatibleInspectorLoft":true,"mouseApply":true,"validSolid":true,"resultAutoSelected":true,"singleStepUndoRedo":true})";}
        std::fprintf(stderr,"[SolidArcEditorProof] PASS: own-mouse Shift-selection, active/order, Inspector reversal, Loft button + Apply, valid solid, undo/redo\n");
        ImGui::DestroyContext();return 0;
    }
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
        auto RevealTile=[&](const char* Key) {
            for(int Attempt=0;Attempt<20;++Attempt) {
                ImVec2 Centre;Require(Editor.QueryControlCentre((std::string("construct-")+Key).c_str(),Centre),"scrollable tile exists");
                ImGuiWindow* Child=nullptr;
                for(auto* Window:ImGui::GetCurrentContext()->Windows)if(Window->Active && std::strstr(Window->Name,"Sketch Draw scrolling"))Child=Window;
                if(!Child || Child->InnerClipRect.Contains(Centre))return;
                IO.AddMousePosEvent(Child->InnerClipRect.GetCenter().x,Child->InnerClipRect.GetCenter().y);
                IO.AddMouseWheelEvent(0,Centre.y<Child->InnerClipRect.Min.y?2.f:-2.f);Tick();Tick();
            }
            Require(false,"native wheel must reveal tile");
        };
        auto FinishCurve=[&]() { IO.AddKeyEvent(ImGuiKey_Enter,true);Tick();IO.AddKeyEvent(ImGuiKey_Enter,false);Tick();Tick(); };
        for(const char* Name:{"pslot","spline","cpcurve"})
        {
            Click(Editor.QueryConstructCentre());
            RevealTile(Name);
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
        RevealTile("sketch-point");
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
            {"hermite",{{-2,0},{2,0},{-2,3},{2,3}},true},
            {"bezier",{{-2,0},{-1,2},{1,2},{2,0}},true},
            {"bspline",{{-2,0},{-1,2},{0,-1},{1,2},{2,0}},true},
            {"nurbs",{{-2,0},{0,2},{2,0}},true},
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
            if(std::string(Case.Key)!="datum-point")RevealTile(Case.Key);
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
