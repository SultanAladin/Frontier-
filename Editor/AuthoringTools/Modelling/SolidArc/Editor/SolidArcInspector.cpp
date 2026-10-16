// Native cards follow WorkspacePanel.RefreshInspector; geometry and edits remain ConsoleHost-owned.
#include "SolidArcEditorHost.h"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <sstream>

namespace Frontier {
namespace {
bool Card(const char* Name) { return ImGui::BeginChild(Name,ImVec2(0,0),ImGuiChildFlags_Borders|ImGuiChildFlags_AutoResizeY|ImGuiChildFlags_AlwaysUseWindowPadding); }
std::string Tuple(const float* V) {std::ostringstream S;S<<'('<<V[0]<<','<<V[1]<<','<<V[2]<<')';return S.str();}
}
void SolidArcEditorHost::RecordCadInspector(ConsoleHost& Host,uint32_t Identity) noexcept
{
    auto* F=Host.Document().Find(Identity);if(!F)return;
    const auto Centre=F->Bounds().Centre();
    const float Position[3]={float(Centre.X),float(Centre.Y),float(Centre.Z)};
    const std::string Ref="#"+std::to_string(Identity);
    if(InspectorIdentity_!=Identity) {
        InspectorIdentity_=Identity;std::snprintf(InspectorName_,sizeof(InspectorName_),"%s",F->Name.c_str());
        for(int I=0;I<3;++I){Move_[I]=Position[I];Rotate_[I]=0;Scale_[I]=1;}
    }
    std::string Command;
    const auto Ordered=Host.Document().OrderedSelection();
    const auto Compatible=Host.CurveSelectionOperations();
    const auto FaceExtrusion=Host.FaceExtrusionSelection();
    const bool RequestedExtrude=Host.ConsumeExtrudeOptionsRequest();
    const bool ExtrudeKey=RequestedExtrude || (!Host.HasActiveTool()&&!ImGui::GetIO().WantTextInput&&!ImGui::GetIO().KeyCtrl&&!ImGui::GetIO().KeyAlt&&!ImGui::GetIO().KeyShift&&ImGui::IsKeyPressed(ImGuiKey_E,false)&&!ImGui::IsPopupOpen(nullptr,ImGuiPopupFlags_AnyPopupId|ImGuiPopupFlags_AnyPopupLevel));
    if(ExtrudeKey){InspectorTab_=0;InspectorTabOpen_=true;}
    bool OnlyCurves=!Ordered.empty(),OnlyBodies=!Ordered.empty();std::string Operands;
    for(uint32_t Id:Ordered){OnlyCurves&=Host.Document().Find(Id)->Classification==FigureClassification::Curve;OnlyBodies&=Host.Document().Find(Id)->Classification==FigureClassification::Body;Operands+=" #"+std::to_string(Id);}
    const bool MultiCurves=OnlyCurves&&Ordered.size()>1;
    if(!ImGui::Begin("Inspector###SolidArc Inspector",&InspectorTabOpen_,ImGuiWindowFlags_NoCollapse)){ImGui::End();return;}
    ImGui::TextUnformatted("Inspector");ImGui::Separator();ImGui::Spacing();
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding,20);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(12,14));
    ImGui::PushStyleColor(ImGuiCol_ChildBg,ImVec4(.085f,.085f,.085f,1));
    const auto Kind=F->Classification;
    if(Card("Selection")) {
        ImGui::SetNextItemWidth(std::max(70.f,ImGui::GetContentRegionAvail().x-42));
        if(ImGui::InputText("##geometry-name",InspectorName_,sizeof(InspectorName_),ImGuiInputTextFlags_EnterReturnsTrue) && !std::strchr(InspectorName_,'"'))Command="rename "+Ref+" \""+InspectorName_+"\"";
        TrackControl("inspector-name");ImGui::SameLine();
        if(ImGui::SmallButton(F->Hidden?"Show":"Hide"))Command=(F->Hidden?"unhide ":"hide ")+Ref;
        ImGui::TextDisabled("%s",Kind==FigureClassification::Curve?"SKETCH CURVE":Kind==FigureClassification::Body?"SOLID BODY":Kind==FigureClassification::Surface?"NURBS SURFACE":"REFERENCE");
        int Faces=0,Edges=0,Vertices=0;
        if(Kind==FigureClassification::Body){Faces=int(F->Body.Faces.size());Edges=int(F->Body.Edges.size());Vertices=int(F->Body.Vertices.size());}
        else if(Kind==FigureClassification::Curve){Edges=1;Vertices=F->PoleCount();}
        if(ImGui::BeginTable("Geometry counts",3,ImGuiTableFlags_SizingStretchSame)) {
            const char* Labels[]={"Faces","Edges",Kind==FigureClassification::Curve?"Poles":"Vertices"};int Counts[]={Faces,Edges,Vertices};
            for(int I=0;I<3;++I){ImGui::TableNextColumn();ImGui::TextDisabled("%s",Labels[I]);ImGui::Text("%d",Counts[I]);}ImGui::EndTable();
        }
    }ImGui::EndChild();ImGui::Spacing();
    if(Card("Bevel history")) {
        ImGui::TextUnformatted("Bevel history");ImGui::TextDisabled("EDITABLE NATIVE FEATURES");
        for(size_t I=0;I<F->Bevels.size();++I){
            const auto& B=F->Bevels[I];const auto Why=F->BevelEditReason(I);
            ImGui::PushID(int(B.Identity));ImGui::BeginDisabled(!Why.empty()||Host.CurrentBevel().Active);
            const std::string Label=std::to_string(B.Identity)+" · "+(B.Chamfer?"Chamfer":"Fillet")+" · "+std::to_string(B.Size)+" m";
            if(ImGui::Button(Label.c_str(),ImVec2(-1,34)))StartBevelEditor(Host,B.Chamfer,F->Identity,B.Identity);
            TrackControl(("inspector-bevel-feature-"+std::to_string(B.Identity)).c_str());ImGui::EndDisabled();
            if(ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))ImGui::SetTooltip("%s",Why.empty()?"Edit size / mode and replay downstream bevels atomically.":Why.c_str());ImGui::PopID();
        }
        const auto Eligibility=Host.BevelSelection();ImGui::BeginDisabled(!Eligibility.Available||Host.CurrentBevel().Active);
        if(ImGui::Button("Bevel / Chamfer · B",ImVec2(-1,36)))StartBevelEditor(Host);
        TrackControl("inspector-bevel-start");ImGui::EndDisabled();
        if(ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))ImGui::SetTooltip("%s",Eligibility.Reason.c_str());
    }ImGui::EndChild();ImGui::Spacing();
    auto RecordOperations=[&]() {
        if(Card("Operations")) {
            ImGui::TextUnformatted("Operations");ImGui::TextDisabled("NATIVE SOLVERS");
            std::vector<std::pair<std::string,std::string>> Options;
            if(FaceExtrusion.Available)Options.emplace_back("Extrude · E","extrudefaces selected 1");
            else if(!FaceExtrusion.Count && OnlyCurves)for(const auto& Op:Compatible) {
                std::string Default=Op.Key+Operands;
                if(Op.Key=="loft")Default+=" --degree=3";
                if(Op.Key=="extrude")Default+=" 1";
                if(Op.Key=="revolve")Default+=" 360";
                if(Op.Key=="pipe")Default+=" .1";
                Options.emplace_back(Op.Label,Default);
            }
            else if(!FaceExtrusion.Count && Kind==FigureClassification::Body && (OnlyBodies||Ordered.empty())) {
                if(Ordered.size()<=1){Options.emplace_back("Shell","shell "+Ref+" .1 --face=0");}
                else if(Ordered.size()==2){const std::string Pair=" #"+std::to_string(Ordered[0])+" -- #"+std::to_string(Ordered[1]);Options.emplace_back("Union","boolean union"+Pair);Options.emplace_back("Subtract","boolean subtract"+Pair);Options.emplace_back("Intersect","boolean intersect"+Pair);}
            }
            const float TileWidth=std::max(50.f,(ImGui::GetContentRegionAvail().x-ImGui::GetStyle().ItemSpacing.x)*.5f);
            for(size_t I=0;I<Options.size();++I){
                if(I%2)ImGui::SameLine();
                const auto Op=std::find_if(Compatible.begin(),Compatible.end(),[&](const auto& O){return O.Label==Options[I].first;});
                const bool Disabled=Op!=Compatible.end()&&!Op->Enabled;
                ImGui::BeginDisabled(Disabled);
                if(ImGui::Button(Options[I].first.c_str(),ImVec2(TileWidth,42))){std::snprintf(NativeCommand_,sizeof(NativeCommand_),"%s",Options[I].second.c_str());LoftProfiles_[0]=0;ExtrudeDistance_=1;ExtrudeMode_=FaceExtrusion.Normal?0:1;ImGui::OpenPopup("Operation parameters");}
                TrackControl(("inspector-operation-"+Options[I].first).c_str());
                ImGui::EndDisabled();
                if(Op!=Compatible.end()&&ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))ImGui::SetTooltip("%s",Op->Hint.c_str());
            }
            if(ExtrudeKey)for(const auto& O:Options)if(O.second.rfind("extrude",0)==0){std::snprintf(NativeCommand_,sizeof(NativeCommand_),"%s",O.second.c_str());ExtrudeDistance_=1;ExtrudeMode_=FaceExtrusion.Normal?0:1;ImGui::OpenPopup("Operation parameters");break;}
            if(Options.empty())ImGui::TextWrapped("%s",FaceExtrusion.Count?FaceExtrusion.Reason.c_str():"No compatible operation for this selection.");
            if(ImGui::BeginPopup("Operation parameters")) {
                ImGui::TextWrapped("Explicit native operands and parameters (metres). Choose the target IDs; Apply commits through the kernel.");
                const bool Faces=std::strncmp(NativeCommand_,"extrudefaces",12)==0;
                if(Faces){
                    ImGui::Text("%u selected faces · native extrusion",FaceExtrusion.Count);
                    ImGui::InputFloat("Distance (m)",&ExtrudeDistance_,.1f,1.f,"%.4f");TrackControl("inspector-extrude-distance");
                    const char Modes[kMaxEditorOptions][kMaxEditorOptionChars]={"Normal region","Individual normals"};
                    if(FaceExtrusion.Normal)Controls_.DropDown("Mode",&ExtrudeMode_,Modes,2,220);else{ExtrudeMode_=1;ImGui::TextUnformatted("Individual face normals (shared normal unavailable)");}
                    TrackControl("inspector-extrude-mode");
                    ImGui::TextWrapped("Use positive distance. Normal mode shares the region rim; Individual adds walls per face. Inward cuts and unsupported operations refuse atomically.");
                } else {ImGui::SetNextItemWidth(360);ImGui::InputText("##parameters",NativeCommand_,sizeof(NativeCommand_));}
                const bool ProfileLoft=std::strncmp(NativeCommand_,"loft ",5)==0;
                if(ProfileLoft){ImGui::SetNextItemWidth(360);ImGui::InputText("Cross-profile IDs",LoftProfiles_,sizeof(LoftProfiles_));TrackControl("inspector-loft-profiles");ImGui::TextWrapped("Optional: start, middle, end curve IDs (3,4,5). Select two open rails. Stations must connect both rails, in order. Cubic spans, degree 3. Rational rails are approximated; interior station joins are C0.");}
                if(ImGui::Button("Apply")){Command=Faces?("extrudefaces selected "+std::to_string(ExtrudeDistance_)+" --mode="+(ExtrudeMode_?"individual":"normal")):(std::string(NativeCommand_)+(ProfileLoft&&LoftProfiles_[0]?" --profiles="+std::string(LoftProfiles_):"")+" --select-result");ImGui::CloseCurrentPopup();}TrackControl("inspector-operation-apply");ImGui::EndPopup();
            }
            ImGui::TextDisabled("%zu faces · %zu edges selected",F->SelectedFaces.size(),F->SelectedEdges.size());
        }ImGui::EndChild();ImGui::Spacing();
    };
    if(MultiCurves) {
        if(Card("Ordered curve selection")) {
            ImGui::Text("%zu curves selected · click order",Ordered.size());
            for(size_t I=0;I<Ordered.size();++I) {
                const auto* Item=Host.Document().Find(Ordered[I]);const bool Active=Ordered[I]==Host.Document().ActiveSelection();
                ImGui::TextColored(Active?ImVec4(.2f,1,.45f,1):ImVec4(.25f,.6f,1,1),"%zu. %s%s",I+1,Item->Name.c_str(),Active?" · ACTIVE":"");
            }
            if(ImGui::Button("Reverse order")){Command="select";for(auto I=Ordered.rbegin();I!=Ordered.rend();++I)Command+=" #"+std::to_string(*I);}
            TrackControl("inspector-reverse-order");
            ImGui::TextWrapped("Loft follows this order. Sweep uses profile first, path second. Apply validates geometry.");
        }ImGui::EndChild();ImGui::Spacing();
    }
    if(MultiCurves||FaceExtrusion.Count)RecordOperations();
    if(ImGui::BeginTable("Inspector sections",3,ImGuiTableFlags_SizingStretchSame)) {
        const char* Tabs[]={"Geometry","Transform","Topology"};
        for(int I=0;I<3;++I){ImGui::TableNextColumn();if(ImGui::Selectable(Tabs[I],InspectorTab_==I))InspectorTab_=I;TrackControl((std::string("inspector-tab-")+Tabs[I]).c_str());}
        ImGui::EndTable();
    }
    if(InspectorTab_==1) {
        if(Card("Transform")) {
            ImGui::TextUnformatted("Transform");ImGui::TextDisabled("WORLD SPACE");
            ImGui::TextWrapped("World position; rotation and scale are amounts. Apply around the selection centre.");
            if(ImGui::BeginTable("Transform values",4,ImGuiTableFlags_SizingStretchSame)) {
                ImGui::TableNextColumn();for(auto Axis:{"X","Y","Z"}){ImGui::TableNextColumn();ImGui::TextUnformatted(Axis);}
                float* Values[]={Move_,Rotate_,Scale_};const char* Labels[]={"Position","Rotation","Scale"};
                for(int Row=0;Row<3;++Row){ImGui::TableNextColumn();ImGui::TextUnformatted(Labels[Row]);for(int I=0;I<3;++I){ImGui::TableNextColumn();ImGui::PushID(Row*3+I);ImGui::SetNextItemWidth(-1);ImGui::InputFloat("##axis",&Values[Row][I],0,0,"%.3f",ImGuiInputTextFlags_AutoSelectAll);if(Row==0&&I==0)TrackControl("inspector-move-x");ImGui::PopID();}}
                ImGui::EndTable();
            }
            ImGui::TextUnformatted("Uniform scale");ImGui::SetNextItemWidth(-1);ImGui::SliderFloat("##uniform-scale",&UniformScale_,.1f,4.f,"%.2f ×");
            if(ImGui::Button("Apply transform")){
                float Delta[3],Scaled[3];for(int I=0;I<3;++I){Delta[I]=Move_[I]-Position[I];Scaled[I]=Scale_[I]*UniformScale_;}
                Command="transform "+Ref+" --move="+Tuple(Delta)+" --rotate="+Tuple(Rotate_)+" --scale="+Tuple(Scaled);
            }
            TrackControl("inspector-apply-transform");
            if(ImGui::SmallButton("Reset amounts")){UniformScale_=1;for(int I=0;I<3;++I){Move_[I]=Position[I];Rotate_[I]=0;Scale_[I]=1;}}
        }ImGui::EndChild();
    } else if(InspectorTab_==2) {
        if(Card("Topology")) {
            ImGui::TextUnformatted("Topology");
            if(Kind==FigureClassification::Body){const auto R=F->Body.Validate();ImGui::Text("%zu faces · %zu edges",F->Body.Faces.size(),F->Body.Edges.size());ImGui::Text("Manifold: %s",R.Manifold?"yes":"no");ImGui::Text("Volume: %.4f m³",R.Volume);ImGui::Text("Area: %.4f m²",R.Area);}
            else if(Kind==FigureClassification::Curve){ImGui::Text("NURBS degree %d",F->Curve.Degree);ImGui::Text("%zu poles · %zu knots",F->Curve.Poles.size(),F->Curve.Knots.size());ImGui::Text("Closed: %s",F->Curve.Closed()?"yes":"no");}
            else ImGui::TextWrapped("Native surface / reference geometry.");
        }ImGui::EndChild();
    } else {
        if(Card("Dimensions")) {
            ImGui::TextUnformatted("Dimensions");ImGui::SameLine();ImGui::TextDisabled("NATIVE · m");
            ImGui::TextWrapped("Construction dimensions rebuild native geometry. Drag values or type; apply on release.");
            ViewDimensions_=Host.DimensionsVisible();
            unsigned Count=0;
            for(const auto& D:Host.AllDimensions())if(D.Anchor==Identity && Count++<12){
                ImGui::PushID(int(D.Id));float V=float(D.Value);ImGui::TextWrapped("%s",(D.Label.empty()?D.AnchorName:D.Label).c_str());
                ImGui::BeginDisabled(D.Slot<0);ImGui::SetNextItemWidth(-1);ImGui::DragFloat("##dimension",&V,.01f,0,0,"%.4f");
                if(ImGui::IsItemDeactivatedAfterEdit())Command="dim edit "+std::to_string(D.Id)+" "+std::to_string(V);
                ImGui::EndDisabled();ImGui::PopID();
            }
            if(!Count)ImGui::TextWrapped("No live dimensions on this derived figure.");
            if(ImGui::Checkbox("Viewport dimensions",&ViewDimensions_))Command=ViewDimensions_?"dim show all":"dim hide all";
        }ImGui::EndChild();ImGui::Spacing();
        if(Card("Bounds")) {
            ImGui::TextUnformatted("Bounds");ImGui::SameLine();ImGui::TextDisabled("WORLD · m");
            const auto E=F->Bounds().Extent();double V[]={E.X,E.Y,E.Z};
            if(ImGui::BeginTable("Extent",3,ImGuiTableFlags_SizingStretchSame)) {const char* Axes[]={"X","Y","Z"};for(int I=0;I<3;++I){ImGui::TableNextColumn();ImGui::TextDisabled("%s",Axes[I]);ImGui::Text("%.3f m",V[I]);}ImGui::EndTable();}
        }ImGui::EndChild();ImGui::Spacing();
        if(!MultiCurves&&!FaceExtrusion.Count)RecordOperations();
        if(Card("Presentation")) {
            ImGui::TextUnformatted("Presentation");const char Finishes[kMaxEditorOptions][kMaxEditorOptionChars]={"steel","chrome","copper","clay","plastic-blue","glass"};uint32_t Finish=0;
            for(uint32_t I=0;I<6;++I)if(!std::strcmp(Finishes[I],MatcapName(F->Matcap)))Finish=I;
            if(Controls_.DropDown("Finish",&Finish,Finishes,6))Command="matcap "+Ref+" "+Finishes[Finish];
            if(ImGui::Button("Export OBJ")){std::filesystem::create_directories("_AgentScratch/Documents");Command="export _AgentScratch/Documents/SolidArc.obj";}
            ImGui::SameLine();if(ImGui::Button("Delete"))Command="delete "+Ref;TrackControl("inspector-delete");
            ImGui::TextWrapped("OBJ exports all native solid bodies. Save .arc to retain editable construction.");
        }ImGui::EndChild();
    }
    ImGui::PopStyleColor();ImGui::PopStyleVar(2);ImGui::End();
    if(!Command.empty()) {
        if(!Host.Execute(Command))FileNotice_="Kernel refused Inspector operation; see native log.";
        else if(Command.rfind("transform ",0)==0){
            UniformScale_=1;const auto C=Host.Document().Find(Identity)->Bounds().Centre();float P[]={float(C.X),float(C.Y),float(C.Z)};
            for(int I=0;I<3;++I){Move_[I]=P[I];Rotate_[I]=0;Scale_[I]=1;}
        }
    }
}
} // namespace Frontier
