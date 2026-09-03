//============================================================================================================================================
//                                                GENERATECONTROLCENTREPROOF.CPP
//============================================================================================================================================
// 🧩 Headless proof of the Control Centre notch + drawer. Drives the REAL ControlCentreHost through scripted
//    InputExchange contacts (press → drag → release, taps, flings, horizontal slides), records it through the REAL
//    PixelSpace onto an ImGui context with no backend, then software-rasterises the ImGui draw lists to PNG.
//
//    Build (Linux / MSYS / WSL):
//      g++ -std=c++20 -O2 -DGLFW_INCLUDE_NONE -I. -IEngine -IExternalPackages/imgui -IExternalPackages/stb \
//          Scratchpad/GenerateControlCentreProof.cpp Engine/DisplayPresentation/ControlCentreHost.cpp \
//          Engine/DisplayPresentation/PixelSpace.cpp Engine/DisplayPresentation/MotionIntegrator.cpp \
//          Engine/DisplayPresentation/ThemeStructure.cpp Engine/DeviceExchange/InputExchange.cpp \
//          ExternalPackages/imgui/imgui.cpp ExternalPackages/imgui/imgui_draw.cpp ExternalPackages/imgui/imgui_tables.cpp \
//          ExternalPackages/imgui/imgui_widgets.cpp -o ControlCentreProof && ./ControlCentreProof
//
//    Output: Diagnostics/ControlCentre_Notch_*.png  (1280 × 720, scene stand-in = Cornell-box-ish gradient)

#include "../Engine/DisplayPresentation/ControlCentreHost.h"
#include "../Engine/DisplayPresentation/PixelSpace.h"
#include "../Engine/DeviceExchange/InputExchange.h"
#include "../Engine/DisplayPresentation/NotificationQueue.h"
#include "../Engine/DisplayPresentation/TelemetryMetrics.h"
#include "../Engine/DisplayPresentation/FidelityClassifier.h"

#include <imgui.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace {

constexpr int Width  = 1280;
constexpr int Height = 720;
constexpr float Step = 1.0f / 120.0f;   // [s] simulated frame

//------------------------------------------------------------------------------------------------------------------------
//                                              SOFTWARE RASTERISER FOR IMDRAWDATA
//------------------------------------------------------------------------------------------------------------------------

struct Canvas
{
    std::vector<float> Rgb;   // linear 0..1, 3 per pixel
    Canvas() : Rgb(static_cast<size_t>(Width) * Height * 3u, 0.0f) {}

    void Blend(int X, int Y, float R, float G, float B, float A)
    {
        if (X < 0 || Y < 0 || X >= Width || Y >= Height || A <= 0.0f) return;
        float* P = &Rgb[(static_cast<size_t>(Y) * Width + X) * 3u];
        P[0] = P[0] * (1.0f - A) + R * A;
        P[1] = P[1] * (1.0f - A) + G * A;
        P[2] = P[2] * (1.0f - A) + B * A;
    }
};

// Scene stand-in so the scrim is visible: a soft vertical gradient with a red / green band left / right,
//    echoing the Cornell box the overlay will sit on in Project-Zero.
void PaintSceneStandIn(Canvas& C)
{
    for (int Y = 0; Y < Height; ++Y)
        for (int X = 0; X < Width; ++X)
        {
            const float V = static_cast<float>(Y) / Height;
            float R = 0.16f + 0.10f * V, G = 0.17f + 0.10f * V, B = 0.20f + 0.10f * V;
            if (X < Width / 5)          { R = 0.55f; G = 0.14f; B = 0.14f; }
            else if (X > Width * 4 / 5) { R = 0.12f; G = 0.50f; B = 0.16f; }
            C.Blend(X, Y, R, G, B, 1.0f);
        }
}

// Textured-triangle rasteriser with barycentric interpolation and a pixel-centre coverage (ImGui geometry carries its own AA fringe).
void RasterTriangle(Canvas& C, const ImDrawVert& A, const ImDrawVert& B, const ImDrawVert& D,
                    const unsigned char* Tex, int TexW, int TexH, const ImVec4& Clip)
{
    const float MinX = std::max(Clip.x, std::floor(std::min({ A.pos.x, B.pos.x, D.pos.x })));
    const float MaxX = std::min(Clip.z, std::ceil (std::max({ A.pos.x, B.pos.x, D.pos.x })));
    const float MinY = std::max(Clip.y, std::floor(std::min({ A.pos.y, B.pos.y, D.pos.y })));
    const float MaxY = std::min(Clip.w, std::ceil (std::max({ A.pos.y, B.pos.y, D.pos.y })));
    if (MinX >= MaxX || MinY >= MaxY) return;

    const float Area = (B.pos.x - A.pos.x) * (D.pos.y - A.pos.y) - (B.pos.y - A.pos.y) * (D.pos.x - A.pos.x);
    if (std::fabs(Area) < 1e-6f) return;
    const float InvArea = 1.0f / Area;

    auto Unpack = [](ImU32 Col, float* Out)
    {
        Out[0] = ((Col >> IM_COL32_R_SHIFT) & 0xFF) / 255.0f;
        Out[1] = ((Col >> IM_COL32_G_SHIFT) & 0xFF) / 255.0f;
        Out[2] = ((Col >> IM_COL32_B_SHIFT) & 0xFF) / 255.0f;
        Out[3] = ((Col >> IM_COL32_A_SHIFT) & 0xFF) / 255.0f;
    };
    float CA[4], CB[4], CD[4];
    Unpack(A.col, CA); Unpack(B.col, CB); Unpack(D.col, CD);

    constexpr int SS = 1;   // pixel-centre test, exactly like the GPU rasteriser (ImGui supplies its own AA fringe)
    for (int Y = static_cast<int>(MinY); Y < static_cast<int>(MaxY); ++Y)
        for (int X = static_cast<int>(MinX); X < static_cast<int>(MaxX); ++X)
        {
            float AccR = 0, AccG = 0, AccB = 0, AccA = 0; int Hits = 0;
            for (int SY = 0; SY < SS; ++SY)
                for (int SX = 0; SX < SS; ++SX)
                {
                    const float PX = X + (SX + 0.5f) / SS;
                    const float PY = Y + (SY + 0.5f) / SS;
                    float W0 = ((B.pos.x - PX) * (D.pos.y - PY) - (B.pos.y - PY) * (D.pos.x - PX)) * InvArea;
                    float W1 = ((D.pos.x - PX) * (A.pos.y - PY) - (D.pos.y - PY) * (A.pos.x - PX)) * InvArea;
                    float W2 = 1.0f - W0 - W1;
                    if (W0 < 0 || W1 < 0 || W2 < 0) continue;

                    float R = W0 * CA[0] + W1 * CB[0] + W2 * CD[0];
                    float G = W0 * CA[1] + W1 * CB[1] + W2 * CD[1];
                    float Bl= W0 * CA[2] + W1 * CB[2] + W2 * CD[2];
                    float Al= W0 * CA[3] + W1 * CB[3] + W2 * CD[3];

                    const float U = W0 * A.uv.x + W1 * B.uv.x + W2 * D.uv.x;
                    const float V = W0 * A.uv.y + W1 * B.uv.y + W2 * D.uv.y;
                    const int TX = std::clamp(static_cast<int>(U * TexW), 0, TexW - 1);
                    const int TY = std::clamp(static_cast<int>(V * TexH), 0, TexH - 1);
                    const unsigned char* T = &Tex[(static_cast<size_t>(TY) * TexW + TX) * 4u];
                    Al *= T[3] / 255.0f;

                    AccR += R * Al; AccG += G * Al; AccB += Bl * Al; AccA += Al; ++Hits;
                }
            if (Hits == 0 || AccA <= 0.0f) continue;
            const float Cov = AccA / (SS * SS);
            C.Blend(X, Y, AccR / AccA, AccG / AccA, AccB / AccA, Cov);
        }
}

void RasterDrawData(Canvas& C, ImDrawData* Data, const unsigned char* Tex, int TexW, int TexH)
{
    for (int L = 0; L < Data->CmdListsCount; ++L)
    {
        const ImDrawList* List = Data->CmdLists[L];
        const ImDrawVert* Vtx  = List->VtxBuffer.Data;
        const ImDrawIdx*  Idx  = List->IdxBuffer.Data;
        for (const ImDrawCmd& Cmd : List->CmdBuffer)
        {
            if (Cmd.UserCallback) continue;
            for (unsigned I = 0; I + 2 < Cmd.ElemCount; I += 3)
            {
                const ImDrawVert& A = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 0]];
                const ImDrawVert& B = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 1]];
                const ImDrawVert& D = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 2]];
                RasterTriangle(C, A, B, D, Tex, TexW, TexH, Cmd.ClipRect);
            }
        }
    }
}

void SavePng(const Canvas& C, const std::string& Path)
{
    std::vector<unsigned char> Bytes(static_cast<size_t>(Width) * Height * 3u);
    for (size_t I = 0; I < Bytes.size(); ++I)
        Bytes[I] = static_cast<unsigned char>(std::clamp(C.Rgb[I], 0.0f, 1.0f) * 255.0f + 0.5f);
    stbi_write_png(Path.c_str(), Width, Height, 3, Bytes.data(), Width * 3);
    std::printf("wrote %s\n", Path.c_str());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCRIPTED CONTACT
//------------------------------------------------------------------------------------------------------------------------

struct Rig
{
    Frontier::ControlCentreHost Host;
    Frontier::InputExchange     Input;
    Frontier::PixelSpace  Surface;
    Frontier::NotificationQueue Notifications;
    Frontier::TelemetryMetrics  Telemetry;
    uint32_t AppliedRevision = 0u;
    float CursorX = 640.0f, CursorY = 300.0f;
    const unsigned char* Tex = nullptr; int TexW = 0, TexH = 0;
    uint32_t FrameCounter = 0u;

    Rig()
    {
        Host.AssignProjectName("Project-Zero");
        (void)Host.Initialize(Width, Height);
    }

    // One simulated frame: interaction → locomotion → record → (optionally) rasterise.
    void Frame(Canvas* Out)
    {
        Input.AssignCursorPosition(CursorX, CursorY);
        Host.AdvanceInteraction(Input, CursorX, CursorY);
        Host.AdvanceLocomotion(Step);
        Notifications.Advance(Step);
        Telemetry.RecordFrame(Step * (1.0f + 0.3f * std::sin(static_cast<float>(FrameCounter++) * 0.21f)));   // wobble so the sparkline shows

        // Mirror GameExecution: a settings change raises a toast
        const Frontier::ControlCentreSettings& S = Host.QuerySettings();
        if (S.Revision != AppliedRevision)
        {
            Notifications.AssignEnabled(S.Notifications);
            char Body[96];
            std::snprintf(Body, sizeof(Body), "%s  |  GI %s, AA %s, scale %d%%", Frontier::FidelityLabel(S.Quality),
                          S.GlobalIllumination ? "on" : "off", S.AntiAliasing ? "on" : "off",
                          static_cast<int>(S.RenderScale * 100.0f + 0.5f));
            Notifications.Push("Render settings applied", Body);
            AppliedRevision = S.Revision;
        }

        ImGuiIO& IO = ImGui::GetIO();
        IO.DeltaTime   = Step;
        IO.DisplaySize = ImVec2(Width, Height);
        ImGui::NewFrame();
        if (Surface.Begin(Frontier::SurfaceLayer::Above, Width, Height))
        {
            const float NotchLine = Host.QueryHandleHeight();
            if (Host.QuerySettings().FrameRateOverlay) Telemetry.ConstructTelemetryLayout(Surface, NotchLine);
            Host.ConstructControlLayout(Surface);
            Notifications.ConstructNotificationLayout(Surface, NotchLine);
        }
        ImGui::Render();

        if (Out)
        {
            PaintSceneStandIn(*Out);
            RasterDrawData(*Out, ImGui::GetDrawData(), Tex, TexW, TexH);
        }
    }

    void Idle(int Frames) { for (int I = 0; I < Frames; ++I) Frame(nullptr); }
    void Press()   { Input.AssignMouseButton(Frontier::MouseButtonCategory::ButtonLeft, true);  Frame(nullptr); }
    void Release() { Input.AssignMouseButton(Frontier::MouseButtonCategory::ButtonLeft, false); Frame(nullptr); }

    // Move the cursor to (X, Y) over N frames (linear), holding whatever button state is current.
    void Drag(float X, float Y, int Frames)
    {
        const float X0 = CursorX, Y0 = CursorY;
        for (int I = 1; I <= Frames; ++I)
        {
            const float T = static_cast<float>(I) / Frames;
            CursorX = X0 + (X - X0) * T;
            CursorY = Y0 + (Y - Y0) * T;
            Frame(nullptr);
        }
    }

    void Snapshot(const char* Name)
    {
        Canvas C;
        Frame(&C);
        SavePng(C, std::string("Diagnostics/") + Name + ".png");
        const Frontier::ControlCentreSettings& S = Host.QuerySettings();
        std::printf("   pose=%u shadeY=%.1f notchX=%.1f covers=%d hover=%d | GI=%d AA=%d FPS=%d Notif=%d Q=%s scale=%.2f rev=%u\n",
                    static_cast<unsigned>(Host.QueryPose()), Host.QueryCurrentHeight(), Host.QueryHandleX(),
                    Host.CoversPointer() ? 1 : 0, Host.QueryHoveredSlot(), S.GlobalIllumination, S.AntiAliasing,
                    S.FrameRateOverlay, S.Notifications, Frontier::FidelityLabel(S.Quality), S.RenderScale, S.Revision);
    }
};

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        MAIN
//------------------------------------------------------------------------------------------------------------------------

int main()
{
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.DisplaySize = ImVec2(Width, Height);
    IO.Fonts->AddFontDefault();

    unsigned char* Pixels = nullptr; int TexW = 0, TexH = 0;
    IO.Fonts->GetTexDataAsRGBA32(&Pixels, &TexW, &TexH);
    IO.Fonts->SetTexID(static_cast<ImTextureID>(1));
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasVtxOffset;

    Rig R;
    R.Tex = Pixels; R.TexW = TexW; R.TexH = TexH;

    // ① Closed, idle.
    R.Idle(10);
    R.Snapshot("ControlCentre_Notch_01_Closed");

    // ② Press on the notch and drag down 180 px (past the 6 px tap ceiling, offset > 50 px → opens on release).
    R.CursorX = 640.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press();
    R.Drag(640.0f, 200.0f, 30);
    R.Snapshot("ControlCentre_Notch_02_Dragging_180px");

    // ③ Release: offset 182 px > 50 px → opens. Capture mid-spring and settled.
    R.Release();
    R.Idle(6);
    R.Snapshot("ControlCentre_Notch_03_Opening_Mid");
    R.Idle(120);
    R.Snapshot("ControlCentre_Notch_04_Open");

    // ④ From OPEN: drag the notch up 30 px then hold still (offset < 50, |vel| < 20) → release → stays open (Notch rule).
    R.CursorX = 640.0f; R.CursorY = Height - 18.0f; R.Idle(2);
    R.Press();
    R.Drag(640.0f, Height - 48.0f, 60);
    R.Snapshot("ControlCentre_Notch_05_OpenPulledUp30px_Dragging");
    R.Idle(30);                          // hold still so release velocity decays below 20 px/s
    R.Release();
    R.Idle(150);
    R.Snapshot("ControlCentre_Notch_06_StaysOpen");

    // ⑤ Tap on the scrim area (below the shade content region does not exist when fully open; tap the notch instead).
    R.CursorX = 640.0f; R.CursorY = Height - 18.0f; R.Idle(2);
    R.Press(); R.Idle(2); R.Release();
    R.Idle(150);
    R.Snapshot("ControlCentre_Notch_07_TapClosed");

    // ⑥ Horizontal: press on notch, drag 300 px to the right (axis resolves to X) → notch slides along the top edge.
    R.CursorX = 640.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press();
    R.Drag(940.0f, 22.0f, 30);
    R.Snapshot("ControlCentre_Notch_08_SlideRight_Dragging");
    R.Release();
    R.Idle(120);
    R.Snapshot("ControlCentre_Notch_09_SlideRight_Settled");

    // ⑦ Overshoot: drag far past the admissible band (elastic 5 %) then release → springs back to the bound.
    R.CursorX = R.Host.QueryHandleX() + 200.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press();
    R.Drag(R.CursorX + 900.0f, 18.0f, 30);
    R.Snapshot("ControlCentre_Notch_10_SlideOvershoot_Dragging");
    R.Release();
    R.Idle(120);
    R.Snapshot("ControlCentre_Notch_11_SlideOvershoot_Settled");

    // ⑧ From OPEN: fast upward flick of 100 px (vel < −20) → closes on velocity.
    R.CursorX = R.Host.QueryHandleX() + 200.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press(); R.Idle(2); R.Release();      // tap → open
    R.Idle(150);
    R.CursorX = R.Host.QueryHandleX() + 200.0f; R.CursorY = Height - 18.0f; R.Idle(2);
    R.Press();
    R.Drag(R.CursorX, Height - 118.0f, 4); // 100 px in 4 frames at 120 Hz ≈ 3000 px/s upward
    R.Release();
    R.Idle(10);
    R.Snapshot("ControlCentre_Notch_12_FlingClose_Mid");
    R.Idle(150);
    R.Snapshot("ControlCentre_Notch_13_FlingClosed");

    //------------------------------------------------------------------------------------------------------------------
    // Step 2 — dashboard. Open the drawer, then exercise every tile with real press/release contacts.
    //------------------------------------------------------------------------------------------------------------------
    auto Centre = [](const Frontier::PlaneExtent& E, float& X, float& Y) { X = (E.MinimumX + E.MaximumX) * 0.5f; Y = (E.MinimumY + E.MaximumY) * 0.5f; };
    auto TapSlot = [&](unsigned Slot)
    {
        Centre(R.Host.QueryTileDiscExtent(Slot), R.CursorX, R.CursorY);
        R.Idle(2); R.Press(); R.Idle(3); R.Release(); R.Idle(2);
    };

    // Bring the notch back to centre and open by tap.
    R.CursorX = R.Host.QueryHandleX() + 200.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press(); R.Drag(640.0f, 18.0f, 30); R.Release(); R.Idle(120);
    R.CursorX = 640.0f; R.CursorY = 18.0f; R.Idle(2);
    R.Press(); R.Idle(2); R.Release();
    R.Idle(20);
    R.Snapshot("ControlCentre_Dashboard_01_Opening_CardFadingIn");
    R.Idle(150);
    R.Snapshot("ControlCentre_Dashboard_02_Open_Defaults");

    // Hover the Anti-Aliasing tile (active → hover blue-400).
    Centre(R.Host.QueryTileDiscExtent(1), R.CursorX, R.CursorY); R.Idle(3);
    R.Snapshot("ControlCentre_Dashboard_03_Hover_AntiAliasing");

    // Tap Global Illumination off → tile goes idle grey, toast appears.
    TapSlot(0);
    R.CursorX = 640.0f; R.CursorY = 300.0f; R.Idle(6);
    R.Snapshot("ControlCentre_Dashboard_04_GI_Off_Toast");

    // Tap FPS Overlay on → top-left readout appears.
    TapSlot(2);
    R.CursorX = 640.0f; R.CursorY = 300.0f; R.Idle(30);
    R.Snapshot("ControlCentre_Dashboard_05_FPS_Overlay_On");

    // Cycle Quality through every tier: Standard → Ultra → Reference → Minimal → Economy → Standard.
    const char* Names[] = { "Ultra", "Reference", "Minimal", "Economy", "Standard" };
    for (int I = 0; I < 5; ++I)
    {
        TapSlot(4);
        R.CursorX = 640.0f; R.CursorY = 300.0f; R.Idle(8);
        char Name[96]; std::snprintf(Name, sizeof(Name), "ControlCentre_Dashboard_06_Quality_%d_%s", I + 1, Names[I]);
        R.Snapshot(Name);
        R.Idle(500);   // let toasts expire between tiers so each frame shows one
    }

    // Drag the render-scale pill to about 60 %.
    {
        Frontier::PlaneExtent Track = R.Host.QueryPillTrackExtent();
        R.CursorX = Track.MaximumX - 2.0f; R.CursorY = (Track.MinimumY + Track.MaximumY) * 0.5f; R.Idle(2);
        R.Press();
        R.Drag(Track.MinimumX + Track.Width() * 0.4667f, R.CursorY, 40);
        R.Snapshot("ControlCentre_Dashboard_07_RenderScale_Dragging");
        R.Release(); R.Idle(6);
        R.Snapshot("ControlCentre_Dashboard_08_RenderScale_60pct");
    }

    // Notifications off, then toggle AA — no toast may appear.
    TapSlot(3);
    R.Idle(500);
    TapSlot(1);
    R.CursorX = 640.0f; R.CursorY = 300.0f; R.Idle(6);
    R.Snapshot("ControlCentre_Dashboard_09_Notifications_Off_NoToast");

    // Close by tapping the notch; the FPS overlay stays because it is a scene overlay, not part of the shade.
    R.CursorX = 640.0f; R.CursorY = Height - 18.0f; R.Idle(2);
    R.Press(); R.Idle(2); R.Release(); R.Idle(150);
    R.Snapshot("ControlCentre_Dashboard_10_Closed_FPS_Overlay_Persists");

    ImGui::DestroyContext();
    return 0;
}
