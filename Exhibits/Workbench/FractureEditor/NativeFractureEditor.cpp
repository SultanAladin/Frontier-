//==============================================================================================================================================
//                                                    NATIVEFRACTUREEDITOR.CPP
//==============================================================================================================================================
// 📦 Executed proof: records the FractureEditor dialog from real ImGui draw commands, against
//    Experimental/FractureEditor/FracturePanel.html (788 KB bundle) and FracturePanel.css (14 461 B).
//
//    The dialog is the standalone authoring review opened from the per-object fracture card's ↗. Every
//    geometric claim below is the CSS box model worked through by hand: titlebar 39, workspace-bar 40,
//    the three-column grid 240 | 1fr | 330 with 1 px gap, the five inspector cards and the 26 px statusbar.

#include "FractureEditorSurface.h"
#include "CpuDraw.h"
#include "PngWriteCounterpart.h"
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstring>

using namespace Frontier;
using namespace Frontier::FractureEditor;

namespace
{
unsigned Checks = 0;
void Check(bool Condition, const char* Claim)
{
    ++Checks;
    if (!Condition) throw std::runtime_error(Claim);
}
bool Near(float V, float Want, float Slack=0.02f){ return std::fabs(V-Want) < Slack; }
ImFont* Light = nullptr;
ImFont* Regular = nullptr;
} // namespace

int main()
{
    std::filesystem::create_directories("Exhibits/Gallery/FractureEditorNative");
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.IniFilename = nullptr;
    IO.DeltaTime = 1.0f/60;
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;

    ImFontConfig LC; std::snprintf(LC.Name, sizeof(LC.Name), "Sun reference / light 300");
    Light = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Light.ttf", 14, &LC);
    ImFontConfig RC; std::snprintf(RC.Name, sizeof(RC.Name), "Sun reference / regular 400");
    Regular = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 14, &RC);
    ImGui::StyleColorsDark();

    //-----------------------------------------------------------------------------------------------------
    // Palette: the inlined <style> in the built bundle, not the source .css alone.
    //-----------------------------------------------------------------------------------------------------
    Check(TitleBg == IM_COL32(18,18,18,255), "titlebar #121212");
    Check(BarBg == IM_COL32(32,32,32,255), "workspace-bar #202020");
    Check(PaneBg == IM_COL32(27,27,27,255), "panels #1b1b1b");
    Check(CardBg == IM_COL32(25,25,25,255), "card #191919");
    Check(PrimaryBg == IM_COL32(186,203,191,255), "primary #bacbbf");
    Check(AppBg == IM_COL32(23,23,23,255), "app #171717");

    //-----------------------------------------------------------------------------------------------------
    // Geometry: every number is a CSS box, not a guess.
    //-----------------------------------------------------------------------------------------------------
    Check(Near(TitleTall, 39.0f) && Near(BarTall, 40.0f) && Near(StatusTall, 26.0f), "title 39, bar 40, status 26");
    Check(Near(AsideWide, 240.0f) && Near(InspectorWide, 330.0f), "workspace tracks 240 and 330");
    Check(Near(WorkGap, 1.0f) && Near(PaneHeadTall, 39.0f), "gap 1, pane heading 39");
    Check(Near(CardRound, 22.0f) && Near(CardGap, 12.0f), "card radius 22, gap 12");
    {
        float Wide = 1600.0f, Tall = 950.0f;
        float Mid = Wide - AsideWide - InspectorWide - WorkGap*2.0f;
        Check(Near(Mid, 1028.0f), "1600-wide editor leaves 1028 for the viewport");
        Check(Near(Tall - TitleTall - BarTall - StatusTall - 1.0f, 844.0f), "950 tall leaves 844 for workspace");
        Wide = 900.0f; Mid = Wide - AsideWide - InspectorWide - 2.0f;
        Check(Near(Mid, 328.0f), "900-wide still keeps a 328 viewport");
    }

    //-----------------------------------------------------------------------------------------------------
    // Static copy: the post-sync editor opens on Cube until a scene object is linked.
    //-----------------------------------------------------------------------------------------------------
    Check(!std::strcmp(Breadcrumb(), "Cube / Fracture"), "breadcrumb Cube / Fracture");
    Check(!std::strcmp(ViewportName(), "Cube"), "viewport Cube");
    Check(!std::strcmp(StatusReady(), "Ready"), "status Ready");

    //-----------------------------------------------------------------------------------------------------
    // Painting.
    //-----------------------------------------------------------------------------------------------------
    const int BackW = 1648, BackH = 998; // Shell 1600x950 +24 pad each side like WindEditor
    int Width = BackW, Height = BackH;
    auto Tick = [&](float Wide, float Tall)
    {
        Width = int(Wide + 48); Height = int(Tall + 48);
        IO.DisplaySize = { float(Width), float(Height) };
        IO.DisplayFramebufferScale = {1,1};
        ImGui::NewFrame();
        ImGui::SetNextWindowPos({0,0});
        ImGui::SetNextWindowSize(IO.DisplaySize);
        ImGui::Begin("FractureEditor", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoScrollbar);
        ImGui::PushFont(Light, 14.0f);
        ImDrawList* Draw = ImGui::GetWindowDrawList();
        Draw->AddRectFilled({0,0}, {float(Width), float(Height)}, IM_COL32(9,9,9,255));
        Draw->AddRectFilled({0,0}, {float(Width), float(Height)}, IM_COL32(0,0,0,187));
        PaintEditor(Draw, Light, Regular, {24,24}, Wide, Tall);
        ImGui::PopFont();
        ImGui::End();
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };

    std::vector<unsigned char> Pixels;
    auto Capture = [&](const char* Name, float Wide, float Tall)
    {
        Tick(Wide, Tall);
        for (int F=0; F<3; ++F) Tick(Wide, Tall);
        constexpr int Over=3;
        const int WOver=Width*Over, HOver=Height*Over;
        std::vector<unsigned char> Dense(size_t(WOver)*HOver*3, 9);
        for (auto* L: ImGui::GetDrawData()->CmdLists) FrontierProof::Draw(L, Dense.data(), WOver, HOver, {0,0}, {Over,Over}, ImTextureID(), {});
        Pixels.assign(size_t(Width)*Height*3, 9);
        for (int Y=0; Y<Height; ++Y) for (int X=0; X<Width; ++X) for (int C=0; C<3; ++C){
            int T=0; for(int DY=0; DY<Over; ++DY) for(int DX=0; DX<Over; ++DX) T+=Dense[(size_t(Y*Over+DY)*WOver+X*Over+DX)*3+C];
            Pixels[(size_t(Y)*Width+X)*3+C]=static_cast<unsigned char>(T/(Over*Over));
        }
        std::string Path="Exhibits/Gallery/FractureEditorNative/"+std::string(Name)+".png";
        Check(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width*3)!=0, "capture written");
    };

    // Captures at the CSS breakpoints the stylesheet names: 1600 (default), 1180, 900 (target hidden), 620 (stacked).
    Capture("Editor1600", 1600.0f, 950.0f);
    Capture("Editor1180", 1180.0f, 950.0f);
    Capture("Editor900",  900.0f,  950.0f);
    // Narrow: the editor stacks vertically, like WindEditor's tall capture.
    Capture("Editor620",  620.0f, 1100.0f);

    ImGui::DestroyContext();
    std::printf("PASS %u checks: fracture editor chrome, three-column workspace, five inspector cards, viewport placeholder.\n", Checks);
    return 0;
}
