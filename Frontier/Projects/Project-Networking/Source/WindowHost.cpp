//============================================================================================================================================
//                                                               WINDOWHOST.CPP
//============================================================================================================================================
// 📦 Standalone ImGui/GLFW login diagnostic; the Frontier game host and project DLL remain separate.

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>
#endif
#include "EpicExchange.h"
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl2.h>
#include <GLFW/glfw3.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace
{
char Secret[512]{};
char ClientId[256] = "xyza7891AKjtZj8wTzcmI5F3oc1zLU4s";
char Credential[128] = "PlayerOne";
char Diagnostics[32768]{};
size_t DiagnosticLength = 0;
bool AllowCreation = false;
bool EnableSocial = true;
char ClipboardText[8192]{};
bool Busy = false;
bool Attempted = false;
bool Verified = false;
bool Cancelled = false;
bool SdkReady = false;
bool ScrollPending = false;
int Method = 0;
const ImVec4 Muted(0.57f, 0.64f, 0.73f, 1.0f);
const ImVec4 Accent(0.34f, 0.75f, 0.98f, 1.0f);

void WipeClipboard() noexcept
{
    volatile char* Bytes = ClipboardText;
    for (size_t Index = 0; Index < sizeof(ClipboardText); ++Index)
        Bytes[Index] = 0;
}

void WipeSecret() noexcept
{
    volatile char* Bytes = Secret;
    for (size_t Index = 0; Index < sizeof(Secret); ++Index)
        Bytes[Index] = 0;
}

void ReceiveDiagnostic(const char* Text)
{
    const size_t Length = std::strlen(Text);
    if (DiagnosticLength + Length + 2 >= sizeof(Diagnostics))
    {
        DiagnosticLength = 0;
        Diagnostics[0] = 0;
    }
    const int Written = std::snprintf(Diagnostics + DiagnosticLength, sizeof(Diagnostics) - DiagnosticLength,
        "%s\n", Text);
    if (Written > 0)
        DiagnosticLength += std::min(static_cast<size_t>(Written), sizeof(Diagnostics) - DiagnosticLength - 1);
    ScrollPending = true;
}

#if defined(_WIN32)
const char* ReadUnicodeClipboard(ImGuiContext*)
{
    WipeClipboard();
    if (!IsClipboardFormatAvailable(CF_UNICODETEXT))
    {
        ReceiveDiagnostic("Clipboard has no plain Unicode text. Use the portal copy icon or type the field manually.");
        return ClipboardText;
    }
    if (!OpenClipboard(nullptr))
    {
        ReceiveDiagnostic("Clipboard is busy. Try pasting again.");
        return ClipboardText;
    }
    HANDLE Content = GetClipboardData(CF_UNICODETEXT);
    const auto* Text = Content ? static_cast<const wchar_t*>(GlobalLock(Content)) : nullptr;
    bool Copied = false;
    if (Text)
    {
        const size_t Capacity = GlobalSize(Content) / sizeof(wchar_t);
        size_t Length = 0;
        while (Length < Capacity && Text[Length])
            ++Length;
        if (Length < Capacity && Length < 4096)
        {
            const int Count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, Text, static_cast<int>(Length),
                ClipboardText, static_cast<int>(sizeof(ClipboardText)) - 1, nullptr, nullptr);
            Copied = Count > 0 || Length == 0;
            if (Count > 0)
                ClipboardText[Count] = 0;
        }
        GlobalUnlock(Content);
    }
    CloseClipboard();
    if (!Copied)
        ReceiveDiagnostic("Clipboard text could not be read safely. Copy only the field text and retry.");
    return ClipboardText;
}
#endif

void BeginLogin()
{
    if (Busy || Verified)
        return;
    Verified = false;
    Cancelled = false;
    Attempted = true;
    if (!Secret[0])
    {
        ReceiveDiagnostic("Client secret is empty. Enter the ROTATED EOS application secret; it is not your Epic password.");
        return;
    }
    if (!ClientId[0] || (Method == 0 && !Credential[0]))
    {
        ReceiveDiagnostic("Client ID or Developer Auth Tool credential NAME is missing.");
        return;
    }
    Networking::RetireEpic();
    const Networking::LoginSpecification Specification{
        Secret, ClientId, Method == 0 ? "developer" : "accountportal", Credential, AllowCreation, EnableSocial};
    Busy = Networking::ConstructEpic(Specification, ReceiveDiagnostic);
    WipeSecret();
    WipeClipboard();
    ReceiveDiagnostic("Secret cleared after submission. Re-enter it before retrying.");
    if (!Busy)
        Networking::RetireEpic();
}

void CancelLogin()
{
    Networking::RetireEpic();
    Busy = false;
    Verified = false;
    Cancelled = true;
    WipeSecret();
    ReceiveDiagnostic("Login cancelled locally. No successful authentication is claimed.");
}

void SaveDiagnostics()
{
    std::filesystem::path Destination = "Networking-login.log";
#if defined(_WIN32)
    wchar_t Filename[MAX_PATH] = L"Networking-login.log";
    OPENFILENAMEW Selection{};
    Selection.lStructSize = sizeof(Selection);
    Selection.lpstrFilter = L"Log files\0*.log\0All files\0*.*\0";
    Selection.lpstrFile = Filename;
    Selection.nMaxFile = MAX_PATH;
    Selection.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    Selection.lpstrDefExt = L"log";
    if (!GetSaveFileNameW(&Selection))
        return;
    Destination = Filename;
#endif
    std::ofstream File(Destination);
    File << "Project-Networking GUI diagnostic\n";
    File << "unix_seconds=" << std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()) << '\n';
    File << "login_verified=" << (Verified ? 1 : 0) << '\n' << Diagnostics;
    File.close();
    ReceiveDiagnostic(File ? "Redacted log saved." : "Could not save log. Choose a writable location.");
}

void ConfigureAppearance()
{
    ImGui::StyleColorsDark();
    ImGuiStyle& Style = ImGui::GetStyle();
    Style.WindowPadding = ImVec2(26, 24);
    Style.FramePadding = ImVec2(12, 10);
    Style.ItemSpacing = ImVec2(12, 12);
    Style.WindowRounding = 0;
    Style.ChildRounding = 12;
    Style.FrameRounding = 6;
    Style.PopupRounding = 8;
    Style.ChildBorderSize = 1;
    Style.Colors[ImGuiCol_WindowBg] = ImVec4(0.055f, 0.071f, 0.10f, 1);
    Style.Colors[ImGuiCol_ChildBg] = ImVec4(0.075f, 0.096f, 0.13f, 1);
    Style.Colors[ImGuiCol_FrameBg] = ImVec4(0.11f, 0.14f, 0.19f, 1);
    Style.Colors[ImGuiCol_Border] = ImVec4(0.16f, 0.20f, 0.26f, 1);
    Style.Colors[ImGuiCol_Button] = ImVec4(0.12f, 0.35f, 0.52f, 1);
    Style.Colors[ImGuiCol_ButtonHovered] = ImVec4(0.17f, 0.45f, 0.66f, 1);
    Style.Colors[ImGuiCol_ButtonActive] = ImVec4(0.10f, 0.30f, 0.48f, 1);
    Style.Colors[ImGuiCol_CheckMark] = Accent;
}

void PresentLogin()
{
    const ImGuiViewport* View = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(View->WorkPos);
    ImGui::SetNextWindowSize(View->WorkSize);
    ImGui::Begin("Project-Networking", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::BeginDisabled(Networking::EpicOverlayOwnsInput());
    ImGui::TextColored(Accent, "FRONTIER  /  PROJECT-NETWORKING");
    ImGui::SetWindowFontScale(1.65f);
    ImGui::TextUnformatted("Charge - Online access");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::TextColored(Muted, "Epic account login  >  EOS Connect identity");
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    const float Available = ImGui::GetContentRegionAvail().x;
    const float LeftWidth = Available * 0.51f;
    const float Height = ImGui::GetContentRegionAvail().y - 30;
    ImGui::BeginChild("Credentials", ImVec2(LeftWidth, Height), ImGuiChildFlags_Borders);
    ImGui::TextColored(Accent, "01  SIGN IN");
    ImGui::TextColored(Muted, "Charge / Dev sandbox / Dev Deployment");
    ImGui::BeginDisabled(Busy || Verified);
    ImGui::TextUnformatted("Login method");
    ImGui::SetNextItemWidth(-1);
    ImGui::Combo("##method", &Method, "Developer Auth Tool\0Epic login overlay (Account Portal)\0");
    if (Method == 0)
    {
        ImGui::TextUnformatted("Saved developer credential name");
        ImGui::SetNextItemWidth(-1);
        ImGui::InputText("##credential", Credential, sizeof(Credential));
        ImGui::TextColored(Muted, "Local tool: localhost:6547");
    }
    else
    {
        ImGui::TextWrapped("Windows requires the EOS redistributable and launch through EOS Bootstrapper. "
            "This app checks readiness before login.");
    }
    ImGui::TextUnformatted("EOS client secret");
    ImGui::SetNextItemWidth(-1);
    ImGui::InputTextWithHint("##secret", "Enter the rotated secret locally", Secret, sizeof(Secret),
        ImGuiInputTextFlags_Password | ImGuiInputTextFlags_NoUndoRedo);
    ImGui::TextColored(Muted, "Application credential - NOT your Epic password.");
    ImGui::TextWrapped("Cleared after submission. Re-enter to retry. Never saved to disk or included in logs.");
#if defined(_WIN32)
    if (ImGui::Button("Paste secret"))
    {
        const char* Text = ReadUnicodeClipboard(nullptr);
        if (std::strlen(Text) < sizeof(Secret))
            std::snprintf(Secret, sizeof(Secret), "%s", Text);
        else
            ReceiveDiagnostic("Clipboard text is too long for this field; copy only the client secret.");
        WipeClipboard();
    }
#endif
    if (ImGui::CollapsingHeader("Client configuration"))
    {
        ImGui::TextUnformatted("Client ID (not your Application ID)");
        ImGui::SetNextItemWidth(-1);
        ImGui::InputText("##client", ClientId, sizeof(ClientId));
        ImGui::TextWrapped("The provided Dev product, sandbox and deployment are configured. "
            "Edit the Client ID only if you replaced the whole client.");
    }
    ImGui::Checkbox("Request Friends + Presence permissions", &EnableSocial);
    ImGui::Checkbox("Allow NEW Dev product-user creation", &AllowCreation);
    if (AllowCreation)
        ImGui::TextWrapped("Consent: EOS may create a new PUID. Do not use this to bypass account linking.");
    ImGui::Spacing();
    if (ImGui::Button("Log in with Epic", ImVec2(-1, 43)))
        BeginLogin();
    ImGui::EndDisabled();
    if (Busy && ImGui::Button("Cancel login", ImVec2(-1, 38)))
        CancelLogin();
    if (Verified && ImGui::Button("Disconnect", ImVec2(-1, 38)))
    {
        Networking::RetireEpic();
        Verified = false;
        Attempted = false;
        ReceiveDiagnostic("Local session disconnected. The SDK stays initialized for another login.");
    }
    ImGui::Spacing();
    if (ImGui::CollapsingHeader("Epic overlay requirements"))
    {
        ImGui::TextWrapped("Login overlay = Epic Account Portal. Friends overlay = Epic Social Overlay. "
            "Both need Epic's EOS redistributable and the configured EOS Bootstrapper on Windows. "
            "The included SDK DLL is not the redistributable. These tools were not in the flattened SDK folder.");
        ImGui::TextWrapped("%s", Networking::InspectOverlayReading());
    }
    ImGui::Spacing();
    if (ImGui::CollapsingHeader("First-time setup"))
        ImGui::TextWrapped("Open Epic's Developer Authentication Tool on port 6547. "
            "Sign in with an account permitted for your development application and save it as PlayerOne. "
            "Keep the tool running, then enter the rotated client secret here. "
            "The tool is separate from this included EOS runtime.");
    ImGui::EndChild();
    ImGui::SameLine();
    ImGui::BeginChild("Activity", ImVec2(0, Height), ImGuiChildFlags_Borders);
    ImGui::TextColored(Accent, "02  CONNECTION STATUS");
    const char* Status = "Ready to log in";
    ImVec4 Colour = Muted;
    if (Busy)
    {
        Status = Networking::InspectLogin() == Networking::LoginProgress::WaitingForConnect ?
            "Epic authenticated / connecting..." : "Waiting for Epic authentication...";
        Colour = Accent;
    }
    else if (Verified)
    {
        Status = "Auth + Connect verified";
        Colour = ImVec4(0.39f, 0.87f, 0.63f, 1);
    }
    else if (Cancelled)
        Status = "Login cancelled";
    else if (Attempted)
    {
        Status = "Login not completed - see details";
        Colour = ImVec4(1.0f, 0.66f, 0.38f, 1);
    }
    ImGui::TextColored(Colour, "%s", Status);
    ImGui::TextColored(Muted, "%s", SdkReady ? "EOS runtime check passed" : "EOS runtime not checked");
    ImGui::TextWrapped("A valid login requires both real Auth and Connect callbacks. "
        "A window or SDK startup check is not a player login.");
    ImGui::Spacing();
    ImGui::BeginDisabled(Busy);
    if (ImGui::Button("Check SDK"))
        SdkReady = Networking::VerifyEpicRuntime(ReceiveDiagnostic);
    ImGui::EndDisabled();
    ImGui::SameLine();
    if (ImGui::Button("Save log"))
        SaveDiagnostics();
    ImGui::Spacing();
    ImGui::Separator();
    if (ImGui::CollapsingHeader("EPIC FRIENDS & SOCIAL OVERLAY", ImGuiTreeNodeFlags_DefaultOpen))
    {
        ImGui::BeginDisabled(!Verified);
        ImGui::BeginDisabled(Networking::FriendsQueryPending());
        if (ImGui::Button("Refresh friends"))
            Networking::QueryEpicFriends();
        ImGui::EndDisabled();
        ImGui::SameLine();
        if (ImGui::Button("Open Epic overlay"))
            Networking::ShowEpicFriends();
        if (ImGui::Button("Hide overlay"))
            Networking::HideEpicFriends();
        ImGui::EndDisabled();
        ImGui::TextWrapped("%s", Networking::InspectFriendsReading());
        ImGui::TextWrapped("%s", Networking::InspectOverlayReading());
        if (Verified && Networking::InspectFriendCount() > 0)
        {
            ImGui::BeginChild("FriendNames", ImVec2(0, 120), ImGuiChildFlags_Borders);
            for (int Index = 0; Index < Networking::InspectFriendCount(); ++Index)
            {
                ImGui::TextUnformatted(Networking::InspectFriendName(Index));
                ImGui::SameLine();
                ImGui::TextColored(Muted, "(%s)", Networking::InspectFriendship(Index));
            }
            ImGui::EndChild();
        }
        ImGui::TextWrapped("Only friends authorized for this application may be returned. "
            "Use the Epic overlay for friend invitations. Names are never saved in the log.");
    }
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(Muted, "ACTIVITY - TOKENS AND IDENTIFIERS ARE OMITTED");
    ImGui::BeginChild("DiagnosticReading", ImVec2(0, 0));
    ImGui::PushTextWrapPos(0);
    ImGui::TextUnformatted(Diagnostics);
    ImGui::PopTextWrapPos();
    if (ScrollPending)
    {
        ImGui::SetScrollHereY(1);
        ScrollPending = false;
    }
    ImGui::EndChild();
    ImGui::EndChild();
    ImGui::TextColored(Muted, "Development login test  /  No credentials embedded  /  EOS runtime included");
    ImGui::EndDisabled();
    ImGui::End();
}

bool CaptureWindow(int Width, int Height)
{
    if (Width <= 0 || Height <= 0)
        return false;
    const unsigned RowBytes = (static_cast<unsigned>(Width) * 3 + 3) & ~3u;
    std::vector<unsigned char> Pixels(static_cast<size_t>(RowBytes) * Height);
    glPixelStorei(GL_PACK_ALIGNMENT, 4);
    glReadPixels(0, 0, Width, Height, GL_RGB, GL_UNSIGNED_BYTE, Pixels.data());
    const auto Range = std::minmax_element(Pixels.begin(), Pixels.end());
    if (*Range.first == *Range.second)
        return false;
    if (glGetError() != GL_NO_ERROR)
        return false;
    for (int Y = 0; Y < Height; ++Y)
        for (int X = 0; X < Width; ++X)
            std::swap(Pixels[Y * RowBytes + X * 3], Pixels[Y * RowBytes + X * 3 + 2]);
    unsigned char Header[54]{};
    const auto Encode = [&Header](int Offset, unsigned Number)
    {
        for (int Index = 0; Index < 4; ++Index)
            Header[Offset + Index] = static_cast<unsigned char>((Number >> (8 * Index)) & 255);
    };
    Header[0] = 'B'; Header[1] = 'M'; Header[26] = 1; Header[28] = 24;
    Encode(2, 54 + static_cast<unsigned>(Pixels.size()));
    Encode(10, 54); Encode(14, 40); Encode(18, Width); Encode(22, Height);
    std::ofstream File("WindowProof.bmp", std::ios::binary);
    File.write(reinterpret_cast<const char*>(Header), sizeof(Header));
    File.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
    File.close();
    return static_cast<bool>(File);
}

int RunWindow(bool Smoke)
{
    glfwSetErrorCallback([](int Number, const char* Description)
    {
        char Text[1024]{};
        std::snprintf(Text, sizeof(Text), "GLFW error %d: %s", Number, Description);
        ReceiveDiagnostic(Text);
        std::ofstream("WindowChecks.log") << Diagnostics;
    });
    if (!glfwInit())
        return 2;
    GLFWwindow* Window = glfwCreateWindow(1080, 800, "Charge | Project-Networking", nullptr, nullptr);
    if (!Window)
    {
        glfwTerminate();
        return 2;
    }
    glfwSetWindowSizeLimits(Window, 960, 720, GLFW_DONT_CARE, GLFW_DONT_CARE);
    glfwMakeContextCurrent(Window);
    glfwSwapInterval(1);
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& Io = ImGui::GetIO();
    Io.IniFilename = nullptr;
    Io.LogFilename = nullptr;
    Io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
#if defined(_WIN32)
    Io.Fonts->AddFontFromFileTTF("C:/Windows/Fonts/segoeui.ttf", 17.0f);
#endif
    ConfigureAppearance();
    if (!ImGui_ImplGlfw_InitForOpenGL(Window, true) || !ImGui_ImplOpenGL2_Init())
    {
        ImGui::DestroyContext();
        glfwDestroyWindow(Window);
        glfwTerminate();
        return 2;
    }
    ReceiveDiagnostic("Ready. Credentials remain on this PC; no player login has been attempted.");
    if (Smoke)
    {
        ReceiveDiagnostic("CI rendering check; authentication NOT attempted.");
        ReceiveDiagnostic(reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
    }
#if defined(_WIN32)
    ImGui::GetPlatformIO().Platform_GetClipboardTextFn = ReadUnicodeClipboard;
#endif
    SdkReady = Networking::VerifyEpicRuntime(ReceiveDiagnostic);
    int Result = 0;
    int Cycles = 0;
    while (!glfwWindowShouldClose(Window))
    {
        glfwPollEvents();
        Networking::AdvanceEpic();
        if (Busy)
        {
            const auto Progress = Networking::InspectLogin();
            if (Progress == Networking::LoginProgress::Connected || Progress == Networking::LoginProgress::Refused)
            {
                Verified = Progress == Networking::LoginProgress::Connected;
                Busy = false;
                if (Verified && EnableSocial)
                    Networking::QueryEpicFriends();
                if (!Verified)
                    Networking::RetireEpic();
            }
        }
        else if (Verified && Networking::InspectLogin() != Networking::LoginProgress::Connected)
        {
            Verified = false;
            Networking::RetireEpic();
        }
        ImGui_ImplOpenGL2_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();
        PresentLogin();
        ImGui::Render();
        int Width = 0, Height = 0;
        glfwGetFramebufferSize(Window, &Width, &Height);
        glViewport(0, 0, Width, Height);
        glClearColor(0.055f, 0.071f, 0.10f, 1);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL2_RenderDrawData(ImGui::GetDrawData());
        if (Smoke && ++Cycles == 12)
        {
            glFinish();
            const bool Captured = CaptureWindow(Width, Height);
            BeginLogin();
            const bool Refused = !Busy && !Verified && Attempted;
            Networking::RetireEpic();
            const bool Reused = Networking::VerifyEpicRuntime(ReceiveDiagnostic);
            const bool Guarded = !Networking::QueryEpicFriends() && !Networking::ShowEpicFriends();
            Result = Captured && SdkReady && Refused && Reused && Guarded ? 0 : 3;
            std::ofstream Proof("WindowChecks.log");
            Proof << "glfw_imgui_rendered=" << Captured << "\nsdk_check=" << SdkReady
                  << "\nmissing_credentials_refused=" << Refused
                  << "\nsdk_reused_same_process=" << Reused
                  << "\nsocial_requires_login=" << Guarded
                  << "\nauthentication=NOT_ATTEMPTED\n" << Diagnostics;
            if (!Proof)
                Result = 3;
            glfwSetWindowShouldClose(Window, GLFW_TRUE);
        }
        glfwSwapBuffers(Window);
    }
    Networking::ShutdownEpic(ReceiveDiagnostic);
    WipeSecret();
    WipeClipboard();
    ImGui_ImplOpenGL2_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(Window);
    glfwTerminate();
    return Result;
}
}

#if defined(_WIN32)
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR CommandLine, int)
{
    const bool Smoke = std::strcmp(CommandLine, "--ui-smoke") == 0;
    try
    {
        const int Result = RunWindow(Smoke);
        if (Result && !Smoke)
            MessageBoxW(nullptr, L"Could not initialize the login window. Check your graphics driver and included DLLs.",
                L"Project-Networking", MB_OK | MB_ICONERROR);
        return Result;
    }
    catch (...)
    {
        Networking::ShutdownEpic();
        WipeSecret();
        WipeClipboard();
        if (!Smoke)
            MessageBoxW(nullptr, L"The login window could not continue. No successful login is claimed.",
                L"Project-Networking", MB_OK | MB_ICONERROR);
        return 4;
    }
}
#else
int main(int ArgumentCount, char** Arguments)
{
    return RunWindow(ArgumentCount == 2 && std::strcmp(Arguments[1], "--ui-smoke") == 0);
}
#endif
