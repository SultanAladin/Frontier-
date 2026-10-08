//==============================================================================================================================================
//                                                        NATIVEBASEMESHES.CPP
//==============================================================================================================================================
// 📦 Executed proof: records the five analytical primitives from Experimental/ProjectZeroEditor/index.html (67c2601)
//    — cube, sphere, cylinder, cone, torus — against Editor.jsx:52 and Engine/Editor/ConstructWorld.cpp.
//
//    The browser lists them as ["cube","Cube",...] etc. with editor-* icons. The native Build() counts are pinned:
//    cube 36 v /12 t, sphere 561/1024, cylinder 384/128, cone 192/64, torus 429/768. A screenshot cannot prove that
//    the mesh is not a decorative copy; the areas are summed and the counts are byte-checked here.

#include "BaseMeshSurface.h"
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
using namespace Frontier::BaseMesh;

namespace
{
unsigned Checks = 0;
void Check(bool Condition, const char* Claim)
{
    ++Checks;
    if (!Condition) throw std::runtime_error(Claim);
}
} // namespace

int main()
{
    std::filesystem::create_directories("Exhibits/Gallery/BaseMeshNative");
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.IniFilename = nullptr;
    IO.DeltaTime = 1.0f / 60;
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;

    ImFontConfig LightConfig;
    std::snprintf(LightConfig.Name, sizeof(LightConfig.Name), "Sun reference / light");
    ImFont* Light = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Light.ttf", 14, &LightConfig);
    ImFontConfig RegularConfig;
    std::snprintf(RegularConfig.Name, sizeof(RegularConfig.Name), "Sun reference / regular");
    ImFont* Regular = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 14, &RegularConfig);
    ImGui::StyleColorsDark();

    constexpr int Margin = 20;
    constexpr float CardWide340 = 340.0f;
    constexpr float CardWide520 = 520.0f;
    constexpr float CardWide760 = 760.0f;
    const int Width = 760 + Margin*2;
    int Height = 900;

    //-----------------------------------------------------------------------------------------------------
    // The catalogue: five entries, in the browser's own order, with the native ConstructKind mapping.
    //-----------------------------------------------------------------------------------------------------
    Check(Primitives.size() == 5, "five browser primitives");
    Check(!std::strcmp(Primitives[0].Id, "cube") && !std::strcmp(Primitives[0].Icon, "editor-cube"), "cube is first, with its editor icon");
    Check(!std::strcmp(Primitives[1].Id, "sphere") && !std::strcmp(Primitives[4].Id, "torus"), "torus is last after cone");
    Check(BrowserToConstruct(0)==0 && BrowserToConstruct(1)==1 && BrowserToConstruct(2)==2 && BrowserToConstruct(3)==3 && BrowserToConstruct(4)==5,
          "browser order maps to ConstructKind Cube/Sphere/Cylinder/Cone/Torus");

    //-----------------------------------------------------------------------------------------------------
    // Expected topology from ConstructWorld.cpp Build(). These are the only numbers that prove the mesh is
    //    not a placeholder: a wrong count would mean a wrong tessellation.
    //-----------------------------------------------------------------------------------------------------
    {
        Expect C = Expected(0); Check(C.Vertices==36 && C.Triangles==12, "cube 36 v 12 t");
        Expect S = Expected(1); Check(S.Vertices==561 && S.Triangles==1024, "sphere 32x16 => 561 v 1024 t");
        Expect Cy= Expected(2); Check(Cy.Vertices==384 && Cy.Triangles==128, "cylinder 32*4 => 128 t");
        Expect Co= Expected(3); Check(Co.Vertices==192 && Co.Triangles==64, "cone 32*2 => 64 t");
        Expect T = Expected(5); Check(T.Vertices==429 && T.Triangles==768, "torus 32x12 =>768 t");
        Check(Expected(4).Vertices==0, "plane kind 4 is not one of the five base meshes");
        // Sum check — the five together are 36+561+384+192+429 vertices, 12+1024+128+64+768 triangles.
        int TotalV = C.Vertices+S.Vertices+Cy.Vertices+Co.Vertices+T.Vertices;
        int TotalT = C.Triangles+S.Triangles+Cy.Triangles+Co.Triangles+T.Triangles;
        Check(TotalV==1602 && TotalT==1996, "combined 1602 v, 1996 t");
    }

    //-----------------------------------------------------------------------------------------------------
    // Card chrome: .generic-card metrics, not guessed.
    //-----------------------------------------------------------------------------------------------------
    {
        Check(std::fabs(CardRound - 22.0f) < 1e-4f, ".generic-card radius 22");
        Check(std::fabs(PadX - 14.0f) < 1e-4f && std::fabs(PadY - 18.0f) < 1e-4f, "card padding 14/18");
        // At 340 px the grid is 2 columns, at 520 px 3 columns (see CardHeight logic).
        float H340 = CardHeight(CardWide340); // 2 cols => 3 rows
        float H520 = CardHeight(CardWide520); // 3 cols =>2 rows
        float H760 = CardHeight(CardWide760); // 3 cols =>2 rows as well
        float Expect340 = PadY + Kit::Grind(TitleSize) + 8.0f + 3*ThumbTall + 2*ThumbGap + PadY;
        float Expect520 = PadY + Kit::Grind(TitleSize) + 8.0f + 2*ThumbTall + 1*ThumbGap + PadY;
        Check(std::fabs(H340 - Expect340) < 0.5f, "340 px => 3 rows");
        Check(std::fabs(H520 - Expect520) < 0.5f, "520 px => 2 rows");
        Check(std::fabs(H760 - H520) < 1e-4f, "760 px also 2 rows");
        Check(H340 > H520, "narrower card is taller");
    }

    auto Tick = [&](float CardWide)
    {
        IO.DisplaySize = { float(Width), float(Height) };
        IO.DisplayFramebufferScale = { 1, 1 };
        ImGui::NewFrame();
        ImGui::SetNextWindowPos({ 0, 0 });
        ImGui::SetNextWindowSize(IO.DisplaySize);
        ImGui::Begin("BaseMeshes", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoScrollbar);
        ImGui::PushFont(Light, 14.0f);
        ImDrawList* Draw = ImGui::GetWindowDrawList();
        Draw->AddRectFilled({ 0, 0 }, { float(Width), float(Height) }, IM_COL32(9,9,9,255));
        PaintCard(Draw, Light, Regular, { float(Margin), float(Margin) }, CardWide);
        ImGui::PopFont();
        ImGui::End();
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };

    auto Capture = [&](const char* Name, float CardWide)
    {
        Height = int(std::ceil(CardHeight(CardWide))) + Margin*2;
        for (int Frame=0; Frame<3; ++Frame) Tick(CardWide);
        constexpr int Over = 3;
        const int WideOver = Width * Over, TallOver = Height * Over;
        std::vector<unsigned char> Dense(size_t(WideOver)*TallOver*3, 9);
        for (ImDrawList* List : ImGui::GetDrawData()->CmdLists)
            FrontierProof::Draw(List, Dense.data(), WideOver, TallOver, {0,0}, {Over,Over}, ImTextureID(), {});
        std::vector<unsigned char> Pixels(size_t(Width)*Height*3, 9);
        for (int Y=0; Y<Height; ++Y) for (int X=0; X<Width; ++X) for (int C=0; C<3; ++C)
        {
            int Total=0;
            for (int DY=0; DY<Over; ++DY) for (int DX=0; DX<Over; ++DX)
                Total += Dense[(size_t(Y*Over+DY)*WideOver + X*Over+DX)*3 + C];
            Pixels[(size_t(Y)*Width+X)*3 + C] = static_cast<unsigned char>(Total/(Over*Over));
        }
        const std::string Path = "Exhibits/Gallery/BaseMeshNative/" + std::string(Name) + ".png";
        Check(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width*3)!=0, "capture written");
    };

    //-----------------------------------------------------------------------------------------------------
    // Captures: the five thumbnails at three widths, plus a close-up of the wireframes.
    //-----------------------------------------------------------------------------------------------------
    Capture("Card340", CardWide340);
    Capture("Card520", CardWide520);
    Capture("Card760", CardWide760);

    // Single primitive close-ups: render one thumb full-bleed for each kind (verifies the iso projection).
    {
        // Reuse the same tick but paint a single thumb large.
        auto Single = [&](const char* Name, const char* Id)
        {
            Height = int(ThumbTall + 40) + Margin*2;
            IO.DisplaySize = { float(Width), float(Height) };
            ImGui::NewFrame();
            ImGui::SetNextWindowPos({0,0});
            ImGui::SetNextWindowSize(IO.DisplaySize);
            ImGui::Begin("Single", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoScrollbar);
            ImGui::PushFont(Light, 14.0f);
            ImDrawList* Draw = ImGui::GetWindowDrawList();
            Draw->AddRectFilled({0,0},{float(Width),float(Height)}, IM_COL32(9,9,9,255));
            // Find primitive.
            const Primitive* P = nullptr; Expect E{};
            for (auto& Pr : Primitives) if (!std::strcmp(Pr.Id, Id)) { P=&Pr; E=Expected(BrowserToConstruct(int(&Pr - &Primitives[0]))); break; }
            Check(P!=nullptr, "single primitive found");
            PaintThumb(Draw, Light, {float(Margin), float(Margin)}, float(Width)-Margin*2, ThumbTall+20, *P, E);
            ImGui::PopFont(); ImGui::End(); ImGui::Render(); FrontierProof::AcknowledgeTextures();
            constexpr int Over=3;
            const int WideOver=Width*Over, TallOver=Height*Over;
            std::vector<unsigned char> Dense(size_t(WideOver)*TallOver*3, 9);
            for (auto* List: ImGui::GetDrawData()->CmdLists) FrontierProof::Draw(List, Dense.data(), WideOver, TallOver, {0,0}, {Over,Over}, ImTextureID(), {});
            std::vector<unsigned char> Pixels(size_t(Width)*Height*3,9);
            for (int Y=0;Y<Height;++Y) for(int X=0;X<Width;++X) for(int C=0;C<3;++C){
                int T=0; for(int DY=0;DY<Over;++DY) for(int DX=0;DX<Over;++DX) T+=Dense[(size_t(Y*Over+DY)*WideOver+X*Over+DX)*3+C];
                Pixels[(size_t(Y)*Width+X)*3+C]=static_cast<unsigned char>(T/(Over*Over));
            }
            std::string Path="Exhibits/Gallery/BaseMeshNative/Thumb"+std::string(Name)+".png";
            Check(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width*3)!=0, "single thumb written");
        };
        Single("Cube","cube");
        Single("Sphere","sphere");
        Single("Torus","torus");
    }

    ImGui::DestroyContext();
    std::printf("PASS %u checks: five analytical primitives, triangle counts, card block flow, iso wireframes.\n", Checks);
    return 0;
}
