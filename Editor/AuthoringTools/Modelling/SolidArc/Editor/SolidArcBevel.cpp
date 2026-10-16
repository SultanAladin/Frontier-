// Native ImGui counterpart of BevelSequence: own mouse, signed adjustment,
// numeric/unit entry, live C++ preview and one transactional confirmation.
#include "SolidArcEditorHost.h"
#include <cmath>
#include <cstdio>

namespace Frontier {
void SolidArcEditorHost::StartBevelEditor(ConsoleHost& Host,bool Chamfer,uint32_t Owner,uint32_t Feature) noexcept {
    if(!Host.CurrentBevel().Active&&!Host.BeginBevel(Chamfer,Owner,Feature)){FileNotice_=Host.CurrentBevel().Status;return;}
    SketchTool_=0;SketchPressed_=false;BevelPinned_=Owner!=0;BevelTyping_=false;BevelReanchor_=false;
    const auto& B=Host.CurrentBevel();const double Signed=B.Size*(B.Chamfer?-1:1);
    std::snprintf(BevelInput_,sizeof(BevelInput_),"%.9g",Signed);
    BevelUnitsPerPixel_=Host.Camera().Distance*2*std::tan(3.141592653589793/8)/std::max(1.f,Viewport_.QueryViewHeight());
    BevelPointerValue_=Signed;
}
void SolidArcEditorHost::RecordBevelEditor(ConsoleHost& Host) noexcept {
    if(!Host.CurrentBevel().Active)return;
    const ImVec2 Origin=Viewport_.QueryViewOrigin();const float W=Viewport_.QueryViewWidth(),H=Viewport_.QueryViewHeight();
    ImGui::SetNextWindowPos(ImVec2(Origin.x+W*.5f,Origin.y+H-110),ImGuiCond_Always,ImVec2(.5f,1));
    ImGui::SetNextWindowSize(ImVec2(340,0));
    const auto Flags=ImGuiWindowFlags_NoDecoration|ImGuiWindowFlags_AlwaysAutoResize|ImGuiWindowFlags_NoSavedSettings|ImGuiWindowFlags_NoDocking|ImGuiWindowFlags_NoMove|ImGuiWindowFlags_NoFocusOnAppearing;
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding,20);ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(18,16));
    bool Apply=false,Cancel=false;
    if(ImGui::Begin("Bevel / Chamfer preview",nullptr,Flags)){
        const auto& B=Host.CurrentBevel();
        ImGui::TextUnformatted(B.EditOwner?"Edit bevel feature":"Bevel / Chamfer · B");ImGui::TextDisabled("EXACT NATIVE PREVIEW");ImGui::Spacing();
        uint32_t Mode=B.Chamfer?1:0;const uint32_t OldMode=Mode;
        const char Modes[kMaxEditorOptions][kMaxEditorOptionChars]={"Rounded · Fillet","Flat · Chamfer"};
        Controls_.DropDown("Mode",&Mode,Modes,2,200);TrackControl("bevel-mode");
        if(Mode!=OldMode){BevelPinned_=true;const double Size=std::max(1e-5,std::fabs(ConsoleHost::ParseBevelDistance(BevelInput_).value_or(B.Size)));std::snprintf(BevelInput_,sizeof(BevelInput_),"%.9g",Size*(Mode?-1:1));Host.PreviewBevel(Size,Mode!=0);}
        ImGui::SetNextItemWidth(180);
        if(ImGui::InputText("Signed size (m)",BevelInput_,sizeof(BevelInput_))){
            BevelPinned_=true;const double Signed=ConsoleHost::ParseBevelDistance(BevelInput_).value_or(0);Host.PreviewBevel(std::fabs(Signed),Signed<0);
        }
        TrackControl("bevel-size");if(ImGui::IsItemActive())BevelPinned_=true;
        ImGui::TextDisabled("Units: m, mm, cm, in, ft");
        if(ImGui::SmallButton("Mouse adjust")){BevelPinned_=false;BevelTyping_=false;BevelReanchor_=true;BevelPointerValue_=B.Size*(B.Chamfer?-1:1);}
        TrackControl("bevel-pointer");
        ImGui::TextWrapped("Move right: round; left: flat. Shift: fine. Type to pin. Positive = radius; negative = setback.");
        ImGui::PushTextWrapPos(0);ImGui::TextColored(B.Valid?ImVec4(.7f,.7f,.7f,1):ImVec4(.9f,.6f,.58f,1),"%s",B.Status.c_str());ImGui::PopTextWrapPos();
        ImGui::BeginDisabled(!B.Valid);Apply=ImGui::Button("Apply / Enter",ImVec2(142,32));TrackControl("bevel-apply");ImGui::EndDisabled();ImGui::SameLine();Cancel=ImGui::Button("Cancel / Esc",ImVec2(142,32));TrackControl("bevel-cancel");
        ImGui::TextDisabled("Constant radius / equal setback only.");
        ImGui::TextWrapped("Unsupported geometry refuses without partial edits.");
    }
    ImGui::End();ImGui::PopStyleVar(2);
    if(Cancel)Host.CancelBevel();else if(Apply)Host.ApplyBevel();
}
} // namespace Frontier
