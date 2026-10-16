#pragma once
#include <imgui.h>
#include <initializer_list>

namespace Frontier {
// Same control states for both editor hosts; component-specific semantic colours stay intact.
inline void ApplyEditorControlTheme(ImGuiStyle& Style) noexcept
{
    auto* C=Style.Colors;
    C[ImGuiCol_FrameBg]=ImVec4(0,0,0,1);
    C[ImGuiCol_FrameBgHovered]=ImVec4(.031f,.031f,.031f,1);
    C[ImGuiCol_FrameBgActive]=C[ImGuiCol_WindowBg];
    C[ImGuiCol_Button]=ImVec4(.133f,.133f,.133f,1);
    C[ImGuiCol_ButtonHovered]=ImVec4(.18f,.18f,.18f,1);
    C[ImGuiCol_ButtonActive]=ImVec4(.22f,.22f,.22f,1);
    C[ImGuiCol_Header]=ImVec4(.165f,.165f,.165f,1);
    C[ImGuiCol_HeaderHovered]=ImVec4(.11f,.11f,.11f,1);
    C[ImGuiCol_HeaderActive]=C[ImGuiCol_Header];
    C[ImGuiCol_PopupBg]=ImVec4(.102f,.102f,.102f,1);
    C[ImGuiCol_CheckMark]=ImVec4(1,1,1,1);
}

// Shared Frontier/SolidArc dock chrome. Active tabs join the panel body;
// hover uses the same theme token as other controls, never a separate blue accent.
inline void ApplyPanelTabTheme(ImGuiStyle& Style) noexcept
{
    auto* C=Style.Colors;
    for(auto State:{ImGuiCol_Tab,ImGuiCol_TabSelected,ImGuiCol_TabDimmed,ImGuiCol_TabDimmedSelected})
        C[State]=C[ImGuiCol_WindowBg];
    C[ImGuiCol_TabHovered]=C[ImGuiCol_ButtonHovered];
    C[ImGuiCol_TabSelectedOverline]=ImVec4(0,0,0,0);
    C[ImGuiCol_TabDimmedSelectedOverline]=ImVec4(0,0,0,0);
    Style.TabBarOverlineSize=0;
    Style.TabBarBorderSize=0;
    Style.TabBorderSize=0;
}
}
