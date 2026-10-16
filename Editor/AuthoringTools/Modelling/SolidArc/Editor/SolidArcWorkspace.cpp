// Native presentation of the approved Experimental/SolidArc workspace. All buttons below
// act on ConsoleHost/ToolSession. This file does not load HTML or contain a geometry renderer.
#include "SolidArcEditorHost.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <filesystem>

namespace Frontier {
void SolidArcEditorHost::TrackControl(const char* Name) noexcept
{
    VisibleControls_.push_back({Name,ImGui::GetItemRectMin(),ImGui::GetItemRectMax()});
}
bool SolidArcEditorHost::QueryControlCentre(const char* Name, ImVec2& Centre) const noexcept
{
    if(!std::strcmp(Name,"camera-view")){Centre=Viewport_.QueryCameraMenuCentre();return true;}
    if(!std::strcmp(Name,"projection")){Centre=Viewport_.QueryProjectionMenuCentre();return true;}
    if(!std::strcmp(Name,"filter")){Centre=Outliner_.QueryFilterCentre();return true;}
    for (const auto& Control : VisibleControls_)
        if (Control.Name==Name) { Centre=ImVec2((Control.Min.x+Control.Max.x)*0.5f,(Control.Min.y+Control.Max.y)*0.5f); return true; }
    return false;
}
void SolidArcEditorHost::RecordWorkspaceChrome(ConsoleHost& Host) noexcept
{
    const auto* Main=ImGui::GetMainViewport();
    // Panel dock strips are the only tab bars; no redundant document tab.
    const auto Flags=ImGuiWindowFlags_NoDecoration|ImGuiWindowFlags_NoMove|ImGuiWindowFlags_NoSavedSettings|ImGuiWindowFlags_NoDocking;
    ImGui::SetNextWindowPos(Main->Pos);
    ImGui::SetNextWindowSize(ImVec2(Main->Size.x,Main->Size.y-26));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(8,4));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding,0);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0);
    if(ImGui::Begin("SolidArc document workspace",nullptr,Flags|ImGuiWindowFlags_NoBringToFrontOnFocus))
    {
        ConstructLayout();
        ImGui::DockSpace(ImGui::GetID("SolidArcEditorDockSpace"),ImVec2(0,0),ImGuiDockNodeFlags_NoWindowMenuButton);
    }
    ImGui::End(); ImGui::PopStyleVar(3);
    ImGui::SetNextWindowPos(ImVec2(Main->Pos.x,Main->Pos.y+Main->Size.y-26));
    ImGui::SetNextWindowSize(ImVec2(Main->Size.x,26));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(16,4));
    if (ImGui::Begin("SolidArc status",nullptr,Flags))
    {
        ImGui::TextColored(ImVec4(.35f,.85f,.57f,1),"Kernel ready · %s",DeviceTexture_?"GPU device":"C++ CPU raster reference");
        ImGui::SameLine(); ImGui::TextDisabled("%zu figures · Metres · Z-up",Host.AllFigures().size());
        if (!FileNotice_.empty()) { ImGui::SameLine(); ImGui::TextUnformatted(FileNotice_.c_str()); }
        if (!RecoveryError_.empty()) { ImGui::SameLine(); ImGui::TextUnformatted(RecoveryError_.c_str()); }
    }
    ImGui::End(); ImGui::PopStyleVar();
}
void SolidArcEditorHost::RecordEmptyInspector(ConsoleHost& Host) noexcept
{
    const auto Flags=ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoCollapse;
    if (ImGui::Begin("Inspector###SolidArc Inspector",&InspectorTabOpen_,Flags))
    {
        ImGui::TextUnformatted("Inspector"); ImGui::Separator();
        if(auto* Tool=Host.ActiveToolSession())
        {
            const auto Kind=Tool->CurrentTool();
            ImGui::Spacing(); ImGui::TextUnformatted(ToolName(Kind));
            ImGui::TextWrapped("%s",Host.ActiveToolPrompt().c_str());
            if(Kind==ToolChoice::PolylineSlot || Kind==ToolChoice::PresetSlot)
            {
                float R=float(Tool->QuerySlotRadius()); ImGui::SetNextItemWidth(110);
                if(ImGui::InputFloat("Radius (m)",&R,.01f,.1f,"%.3f") && R>0) Host.Execute("tool-options --radius="+std::to_string(R));
            }
            if(Kind==ToolChoice::Circle || Kind==ToolChoice::TwoPointCircle)
            {
                uint32_t Mode=Kind==ToolChoice::Circle?0:1;
                ImGui::BeginDisabled(Tool->CurrentPromptIndex()!=0);
                ImGui::SetNextItemWidth(120);
                const char Modes[kMaxEditorOptions][kMaxEditorOptionChars]={"Centre","Diameter"};
                ImGui::TextUnformatted("Defined by");
                if(Controls_.DropDown("Defined by",&Mode,Modes,2,140)) Host.Execute(Mode?"tool circle2":"tool circle");
                ImGui::EndDisabled();
            }
            if(Kind==ToolChoice::Arc) { bool CW=Tool->QueryClockwise(); if(ImGui::Checkbox("Clockwise",&CW)) Host.Execute(std::string("tool-options --clockwise=")+(CW?"1":"0")); }
            if(Kind==ToolChoice::Polygon)
            {
                int N=Tool->QuerySides(); ImGui::SetNextItemWidth(90);
                if(ImGui::InputInt("Sides",&N)) Host.Execute("tool-options --sides="+std::to_string(N));
                bool Circ=Tool->QueryCircumscribed(); if(ImGui::Checkbox("Circumscribed",&Circ)) Host.Execute(std::string("tool-options --circumscribed=")+(Circ?"1":"0"));
            }
            if(Kind==ToolChoice::Polyline) {bool Close=Tool->QueryClosed();if(ImGui::Checkbox("Close on finish",&Close)) Host.Execute(std::string("tool-options --closed=")+(Close?"1":"0"));}
            ImGui::TextWrapped("Click in the viewport to place geometry. Enter / right-click finishes multi-point curves; Esc cancels.");
            if(ImGui::Button("Cancel drawing")) Host.Execute("tool cancel");
            ImGui::End(); return;
        }
        ImGui::Dummy(ImVec2(0,16));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding,22);
        ImGui::PushStyleColor(ImGuiCol_ChildBg,ImVec4(.09f,.09f,.09f,1));
        if (ImGui::BeginChild("Select geometry",ImVec2(0,190),ImGuiChildFlags_Borders))
        {
            ImGui::SetCursorPosY(54); const char* Title="Select geometry";
            ImGui::SetCursorPosX(std::max(12.0f,(ImGui::GetWindowWidth()-ImGui::CalcTextSize(Title).x)*.5f));
            ImGui::TextUnformatted(Title); ImGui::Spacing();
            ImGui::TextWrapped("Pick a body, sketch or surface in the viewport or outliner to inspect its native geometry.");
        }
        ImGui::EndChild(); ImGui::Spacing();
        if (ImGui::BeginChild("Start constructing",ImVec2(0,240),ImGuiChildFlags_Borders|ImGuiChildFlags_AlwaysUseWindowPadding))
        {
            ImGui::TextUnformatted("Start constructing"); ImGui::TextWrapped("Create a profile, then extrude it into a solid."); ImGui::Spacing();
            if (ImGui::Button("Box",ImVec2(90,52))) {ConstructSection_=2;ConstructRequested_=true;} TrackControl("inspector-box");
            ImGui::SameLine(); if (ImGui::Button("Circle",ImVec2(90,52))) Host.Execute("tool circle"); TrackControl("inspector-circle");
            if (ImGui::Button("Rectangle",ImVec2(90,52))) Host.Execute("tool rect"); TrackControl("inspector-rectangle");
            ImGui::SameLine(); ImGui::BeginDisabled(); ImGui::Button("Extrude",ImVec2(90,52)); ImGui::EndDisabled();
            if(ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))ImGui::SetTooltip("Select a sketch profile or region before extruding.");
        }
        ImGui::EndChild(); ImGui::PopStyleColor(); ImGui::PopStyleVar();
    }
    ImGui::End();
}
} // namespace Frontier
