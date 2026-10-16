#pragma once
#include <imgui.h>
#include <cstring>
#include <cmath>

namespace Frontier::CadWidgets {
inline void DrawShapeIcon(ImDrawList* D,const char* Kind,ImVec2 P,float Scale,ImU32 C) {
    auto Q=[&](float X,float Y){return ImVec2(P.x+X*Scale,P.y+Y*Scale);};
    if (!std::strcmp(Kind,"body")||!std::strcmp(Kind,"box")) {ImVec2 V[]={Q(0,-12),Q(11,-6),Q(11,6),Q(0,12),Q(-11,6),Q(-11,-6),Q(0,-12)};D->AddPolyline(V,7,C,0,1.5f);D->AddLine(Q(-11,-6),Q(0,0),C);D->AddLine(Q(0,0),Q(11,-6),C);D->AddLine(Q(0,0),Q(0,12),C);}
    else if (std::strstr(Kind,"rect")) {
        D->AddRect(Q(-13,-9),Q(13,9),C,2,0,1.5f);
        if(std::strcmp(Kind,"rect")) { D->AddLine(Q(-4,0),Q(4,0),C); D->AddLine(Q(0,-4),Q(0,4),C); }
    } else if (std::strstr(Kind,"slot")) {
        D->AddRect(Q(-15,-7),Q(15,7),C,7,0,1.5f);
        if(std::strcmp(Kind,"slot")) D->AddLine(Q(-10,2),Q(7,-3),C,1.5f);
    } else if (std::strstr(Kind,"circle")) D->AddCircle(P,12,C,32,1.5f);
    else if (!std::strcmp(Kind,"ellipse")) {
        ImVec2 V[33]; for(int I=0;I<=32;++I) { const float T=I*6.2831853f/32; V[I]=Q(14*std::cos(T),8*std::sin(T)); } D->AddPolyline(V,33,C,0,1.5f);
    } else if (!std::strcmp(Kind,"line")) { D->AddLine(Q(-12,10),Q(12,-10),C,1.5f); D->AddCircleFilled(Q(-12,10),2,C); D->AddCircleFilled(Q(12,-10),2,C); }
    else if (!std::strcmp(Kind,"polyline")) { ImVec2 V[]={Q(-14,9),Q(-6,-10),Q(5,8),Q(14,-8)}; D->AddPolyline(V,4,C,0,1.5f); }
    else if (!std::strcmp(Kind,"polygon")) { D->AddNgon(P,13,C,6,1.5f); }
    else if (std::strstr(Kind,"point")) { D->AddCircle(P,10,C,24,1.5f); D->AddCircleFilled(P,2.5f,C); }
    else if (std::strstr(Kind,"arc")) { D->PathArcTo(P,12,-2.7f,.4f,24); D->PathStroke(C,0,1.5f); }
    else { D->AddBezierCubic(Q(-14,10),Q(-7,-23),Q(7,23),Q(14,-10),C,1.5f); if(!std::strcmp(Kind,"cpcurve")) {D->AddLine(Q(-14,10),Q(-7,-15),C);D->AddLine(Q(-7,-15),Q(14,-10),C);} }
 }
// Shared, native CAD tile: the browser catalogue's icon-above-label structure.
// Leaves the real ImGui item bounds/current item available to automation and accessibility adapters.
inline bool ToolTile(const char* Label, const char* Kind, ImVec2 Size=ImVec2(112,76))
{
    const bool Pressed=ImGui::InvisibleButton(Label,Size);
    const ImVec2 A=ImGui::GetItemRectMin(), B=ImGui::GetItemRectMax();
    auto* D=ImGui::GetWindowDrawList();
    D->AddRectFilled(A,B,ImGui::IsItemHovered()?IM_COL32(47,51,54,255):IM_COL32(30,33,36,255),14);
    D->AddRect(A,B,IM_COL32(58,62,66,255),14);
    const ImU32 C=IM_COL32(79,216,224,255);
    const ImVec2 P((A.x+B.x)*.5f,(A.y+B.y)*.5f-12);
    DrawShapeIcon(D,Kind,P,1.f,C);
    const auto Text=ImGui::CalcTextSize(Label);
    D->AddText(ImVec2((A.x+B.x-Text.x)*.5f,B.y-Text.y-9),IM_COL32(224,228,232,255),Label);
    if(ImGui::IsItemHovered()) ImGui::SetTooltip("%s · choose then draw in the viewport",Label);
    return Pressed;
}
}
