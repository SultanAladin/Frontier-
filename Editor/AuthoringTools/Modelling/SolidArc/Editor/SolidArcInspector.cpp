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
        if(Card("Operations")) {
            ImGui::TextUnformatted("Operations");ImGui::TextDisabled("NATIVE SOLVERS");
            const char* Names[]={"Extrude","Revolve","Loft","Fillet","Chamfer","Shell","Union","Subtract","Intersect"};
            const std::string Defaults[]={"extrude "+Ref+" 1","revolve "+Ref+" 360","loft selected","fillet "+Ref+" .1","chamfer "+Ref+" .1","shell "+Ref+" .1 --face=0","boolean union "+Ref+" -- <other-body>","boolean subtract "+Ref+" -- <other-body>","boolean intersect "+Ref+" -- <other-body>"};
            const float TileWidth=std::max(50.f,(ImGui::GetContentRegionAvail().x-ImGui::GetStyle().ItemSpacing.x)*.5f);
            for(int I=0;I<9;++I){if(I%2)ImGui::SameLine();if(ImGui::Button(Names[I],ImVec2(TileWidth,42))){std::snprintf(NativeCommand_,sizeof(NativeCommand_),"%s",Defaults[I].c_str());ImGui::OpenPopup("Operation parameters");}}
            if(ImGui::BeginPopup("Operation parameters")) {
                ImGui::TextWrapped("Explicit native operands and parameters (metres). Choose the target IDs; Apply commits through the kernel.");
                ImGui::SetNextItemWidth(360);ImGui::InputText("##parameters",NativeCommand_,sizeof(NativeCommand_));
                if(ImGui::Button("Apply")){Command=NativeCommand_;ImGui::CloseCurrentPopup();}ImGui::EndPopup();
            }
            ImGui::TextDisabled("%zu faces · %zu edges selected",F->SelectedFaces.size(),F->SelectedEdges.size());
        }ImGui::EndChild();ImGui::Spacing();
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
