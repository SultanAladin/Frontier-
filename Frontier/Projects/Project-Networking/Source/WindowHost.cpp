//============================================================================================================================================
//                                                               WINDOWHOST.CPP
//============================================================================================================================================
// 📦 Standalone ImGui/GLFW login diagnostic; the Frontier game host and project DLL remain separate.

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>
#include <wincred.h>
#endif
#include "EpicExchange.h"
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl2.h>
#include <GLFW/glfw3.h>
#include <algorithm>
#include <chrono>
#include <cctype>
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
int Method = 1;
bool RememberCredential = false;
bool ContinueAfterSetup = false;
bool SetupRequested = false;
const char* SetupError = "";
ImFont* TitleFont = nullptr;
struct LogReading { char Text[2048]{}; char Time[16]{}; int Severity = 0; };
LogReading LogReadings[128]{};
int LogCount = 0;
const ImVec4 SuccessColour(0.68f, 0.83f, 0.57f, 1);
const ImVec4 WarningColour(0.91f, 0.73f, 0.43f, 1);
const ImVec4 ErrorColour(0.96f, 0.51f, 0.47f, 1);
const ImVec4 Muted(0.53f, 0.58f, 0.53f, 1.0f);
const ImVec4 Accent(0.79f, 0.87f, 0.71f, 1.0f);

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
    if (LogCount == 128)
    {
        std::move(LogReadings + 1, LogReadings + 128, LogReadings);
        --LogCount;
    }
    auto& Reading = LogReadings[LogCount++];
    std::snprintf(Reading.Text, sizeof(Reading.Text), "%s", Text);
    static const auto Start = std::chrono::steady_clock::now();
    const auto Seconds = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - Start).count();
    std::snprintf(Reading.Time, sizeof(Reading.Time), "%02lld:%02lld", static_cast<long long>(Seconds / 60), static_cast<long long>(Seconds % 60));
    std::string Lower(Text);
    std::transform(Lower.begin(), Lower.end(), Lower.begin(), [](unsigned char C) { return static_cast<char>(std::tolower(C)); });
    const auto Has = [&Lower](const char* Word) { return Lower.find(Word) != std::string::npos; };
    Reading.Severity = Has("failed") || Has("error") || Has("refused") || Has("could not") ? 3 :
        Has("too long") || Has("whitespace") || Has("missing") || Has("not ready") || Has("empty") || Has("cancelled") || Has("canceled") || Has("not bootstrapped") ? 2 :
        Has("=success") || Has("eos_success") || Has("sdk_initialized_once=1") ? 1 : 0;
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

#if defined(_WIN32)
constexpr wchar_t CredentialTarget[] = L"Frontier/Charge/Dev/EOSClient";

bool LoadCredential()
{
    PCREDENTIALW Saved = nullptr;
    if (!CredReadW(CredentialTarget, CRED_TYPE_GENERIC, 0, &Saved))
        return false;
    bool Valid = Saved->CredentialBlob && Saved->CredentialBlobSize > 0 &&
        Saved->CredentialBlobSize < sizeof(Secret) && Saved->UserName;
    char LoadedClient[sizeof(ClientId)]{};
    if (Valid)
        Valid = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, Saved->UserName, -1,
            LoadedClient, sizeof(LoadedClient), nullptr, nullptr) > 0;
    if (Valid)
    {
        WipeSecret();
        std::memcpy(Secret, Saved->CredentialBlob, Saved->CredentialBlobSize);
        std::memcpy(ClientId, LoadedClient, sizeof(ClientId));
        RememberCredential = true;
    }
    if (Saved->CredentialBlob)
        SecureZeroMemory(Saved->CredentialBlob, Saved->CredentialBlobSize);
    CredFree(Saved);
    return Valid;
}

bool SaveCredential()
{
    wchar_t User[256]{};
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, ClientId, -1, User, 256))
        return false;
    CREDENTIALW Saved{};
    Saved.Type = CRED_TYPE_GENERIC;
    Saved.TargetName = const_cast<wchar_t*>(CredentialTarget);
    Saved.UserName = User;
    Saved.CredentialBlobSize = static_cast<DWORD>(std::strlen(Secret));
    Saved.CredentialBlob = reinterpret_cast<LPBYTE>(Secret);
    Saved.Persist = CRED_PERSIST_LOCAL_MACHINE;
    const bool Stored = CredWriteW(&Saved, 0) != FALSE;
    ReceiveDiagnostic(Stored ? "Application credential saved in your Windows user vault." : "Could not save application credential.");
    return Stored;
}

bool ForgetCredential(bool WipeInput = true)
{
    if (CredDeleteW(CredentialTarget, CRED_TYPE_GENERIC, 0) || GetLastError() == ERROR_NOT_FOUND)
    {
        RememberCredential = false;
        if (WipeInput) WipeSecret();
        ReceiveDiagnostic("No saved application credential remains.");
        return true;
    }
    else
        ReceiveDiagnostic("Could not remove saved credential. Use Windows Credential Manager.");
    return false;
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
    if (const char* Error = Networking::ValidateEpicCredentials(Secret, ClientId))
    {
        ReceiveDiagnostic("configuration=refused; credentials were not submitted to EOS");
        ReceiveDiagnostic(Error);
        SetupError = Error;
        SetupRequested = true;
        return;
    }
    Networking::RetireEpic();
    const Networking::LoginSpecification Specification{
        Secret, ClientId, Method == 0 ? "developer" : "accountportal", Credential, AllowCreation, EnableSocial};
    Busy = Networking::ConstructEpic(Specification, ReceiveDiagnostic);
    WipeSecret();
    WipeClipboard();
    ReceiveDiagnostic(RememberCredential ? "Temporary secret cleared. The saved Windows credential will be reused on retry." :
        "Temporary secret cleared. Enter it in Setup before retrying, or enable Remember on this PC.");
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
    Style.WindowPadding = ImVec2(30, 28);
    Style.FramePadding = ImVec2(14, 11);
    Style.ItemSpacing = ImVec2(12, 14);
    Style.WindowRounding = 18;
    Style.ChildRounding = 26;
    Style.FrameRounding = 12;
    Style.PopupRounding = 18;
    Style.ScrollbarSize = 7;
    Style.ScrollbarRounding = 8;
    Style.ChildBorderSize = 1;
    Style.Colors[ImGuiCol_WindowBg] = ImVec4(0.055f, 0.061f, 0.057f, 1);
    Style.Colors[ImGuiCol_ChildBg] = ImVec4(0.085f, 0.094f, 0.087f, 1);
    Style.Colors[ImGuiCol_PopupBg] = ImVec4(0.08f, 0.09f, 0.082f, 1);
    Style.Colors[ImGuiCol_FrameBg] = ImVec4(0.13f, 0.145f, 0.132f, 1);
    Style.Colors[ImGuiCol_Border] = ImVec4(0.17f, 0.19f, 0.175f, 0.7f);
    Style.Colors[ImGuiCol_Text] = ImVec4(0.90f, 0.92f, 0.88f, 1);
    Style.Colors[ImGuiCol_TextDisabled] = Muted;
    Style.Colors[ImGuiCol_Button] = ImVec4(0.15f, 0.17f, 0.155f, 1);
    Style.Colors[ImGuiCol_ButtonHovered] = ImVec4(0.22f, 0.25f, 0.22f, 1);
    Style.Colors[ImGuiCol_ButtonActive] = ImVec4(0.27f, 0.31f, 0.26f, 1);
    Style.Colors[ImGuiCol_Header] = Style.Colors[ImGuiCol_Button];
    Style.Colors[ImGuiCol_HeaderHovered] = Style.Colors[ImGuiCol_ButtonHovered];
    Style.Colors[ImGuiCol_HeaderActive] = Style.Colors[ImGuiCol_ButtonActive];
    Style.Colors[ImGuiCol_CheckMark] = Accent;
}

void PresentSetup()
{
    const auto* Viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(ImVec2(Viewport->WorkPos.x + Viewport->WorkSize.x * 0.5f,
        Viewport->WorkPos.y + Viewport->WorkSize.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(std::min(550.0f, Viewport->WorkSize.x - 32),
        std::min(660.0f, Viewport->WorkSize.y - 32)), ImGuiCond_Always);
    if (!ImGui::BeginPopupModal("One-time setup", nullptr, ImGuiWindowFlags_NoResize))
        return;
    ImGui::BeginChild("Setup fields", ImVec2(0, -140));
    ImGui::TextWrapped("Install EpicOnlineServicesInstaller.exe once, then open Charge.exe (the included Epic launcher). "
        "The app can then ask Epic to display its login UI.");
    ImGui::Spacing();
    ImGui::TextUnformatted("Application credential");
    ImGui::TextColored(Muted, "Not your Epic account password. Use a rotated secret.");
    ImGui::SetNextItemWidth(-1);
    ImGui::InputTextWithHint("##secret", "EOS client secret", Secret, sizeof(Secret),
        ImGuiInputTextFlags_Password | ImGuiInputTextFlags_NoUndoRedo | ImGuiInputTextFlags_AutoSelectAll);
#if defined(_WIN32)
    if (ImGui::SmallButton("Paste secret"))
    {
        const char* Text = ReadUnicodeClipboard(nullptr);
        if (std::strlen(Text) < sizeof(Secret))
            std::snprintf(Secret, sizeof(Secret), "%s", Text);
        else
            ReceiveDiagnostic("Clipboard text too long; copy only the client secret.");
        WipeClipboard();
    }
    ImGui::Checkbox("Remember on this PC (Windows Credential Manager)", &RememberCredential);
#endif
    if (ImGui::CollapsingHeader("Advanced"))
    {
        ImGui::TextUnformatted("EOS client ID");
        ImGui::SetNextItemWidth(-1);
        ImGui::InputText("##client", ClientId, sizeof(ClientId), ImGuiInputTextFlags_AutoSelectAll);
        ImGui::SetNextItemWidth(-1);
        ImGui::Combo("##method", &Method, "Developer Auth Tool\0Epic Account Portal\0");
        if (Method == 0)
        {
            ImGui::SetNextItemWidth(-1);
            ImGui::InputText("Saved developer credential", Credential, sizeof(Credential));
            ImGui::TextWrapped("Keep Epic's Developer Auth Tool running on localhost:6547.");
        }
        ImGui::TextWrapped("Charge requires Basic Profile, Friends List, Presence and Country permissions. Epic will ask for consent.");
        ImGui::Checkbox("Load friends after login", &EnableSocial);
        ImGui::Checkbox("Allow NEW Dev product-user creation", &AllowCreation);
        if (AllowCreation)
            ImGui::TextWrapped("This allows a real new PUID to be created. Do not use it to bypass identity linking.");
        if (ImGui::SmallButton("Check SDK"))
            SdkReady = Networking::VerifyEpicRuntime(ReceiveDiagnostic);
#if defined(_WIN32)
        ImGui::SameLine();
        if (ImGui::SmallButton("Forget saved credential"))
            ForgetCredential();
#endif
        ImGui::TextWrapped("%s", Networking::InspectOverlayReading());
    }
    ImGui::Spacing();
    ImGui::EndChild();
    if (ImGui::Button(ContinueAfterSetup ? "Save & log in" : "Apply setup", ImVec2(220, 42)))
    {
        if (const char* Error = Networking::ValidateEpicCredentials(Secret, ClientId))
            SetupError = Error;
        else
        {
            bool Stored = true;
#if defined(_WIN32)
            Stored = RememberCredential ? SaveCredential() : ForgetCredential(false);
#endif
            if (Stored)
            {
                SetupError = "";
                ImGui::CloseCurrentPopup();
                if (ContinueAfterSetup)
                    BeginLogin();
            }
            else
                SetupError = "Windows could not update saved credentials. Check Windows Credential Manager and retry.";
        }
    }
    ImGui::SameLine();
    if (ImGui::Button("Cancel", ImVec2(110, 42)))
    {
        WipeSecret();
        WipeClipboard();
        ImGui::CloseCurrentPopup();
    }
    if (*SetupError)
        ImGui::TextWrapped("%s", SetupError);
    ImGui::EndPopup();
}

void PresentLogin()
{
    const ImGuiViewport* View = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(View->WorkPos);
    ImGui::SetNextWindowSize(View->WorkSize);
    ImGui::Begin("Charge", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoSavedSettings);
    ImGui::BeginDisabled(Networking::EpicOverlayOwnsInput());
    ImGui::TextColored(Accent, "C  /  CHARGE");
    ImGui::SameLine();
    ImGui::TextColored(Muted, "     ONLINE ACCESS");
    ImGui::SameLine(ImGui::GetWindowContentRegionMax().x - 66);
    ImGui::BeginDisabled(Busy || Verified);
    if (ImGui::SmallButton("Setup"))
    {
#if defined(_WIN32)
        if (!Secret[0]) LoadCredential();
#endif
        ContinueAfterSetup = false;
        SetupError = "";
        ImGui::OpenPopup("One-time setup");
    }
    ImGui::EndDisabled();
    ImGui::Spacing();
    ImGui::Spacing();

    const bool CreationConsent = Networking::InspectLogin() == Networking::LoginProgress::WaitingForCreationConsent;
    const float Available = ImGui::GetContentRegionAvail().x;
    const float Height = ImGui::GetContentRegionAvail().y - 37;
    ImGui::BeginChild("Login card", ImVec2(Available * 0.455f, Height), ImGuiChildFlags_Borders);
    const ImVec2 Origin = ImGui::GetCursorScreenPos();
    ImDrawList* Ink = ImGui::GetWindowDrawList();
    const ImVec2 Centre(Origin.x + 47, Origin.y + 48);
    Ink->AddCircleFilled(Centre, 44, IM_COL32(40, 48, 40, 255), 64);
    Ink->AddCircle(Centre, 44, IM_COL32(91, 108, 88, 120), 64, 1.0f);
    Ink->AddCircle(Centre, 33, IM_COL32(164, 185, 149, 70), 64, 1.0f);
    Ink->AddLine(ImVec2(Centre.x + 6, Centre.y - 19), ImVec2(Centre.x - 10, Centre.y + 3), IM_COL32(201, 221, 181, 255), 4);
    Ink->AddLine(ImVec2(Centre.x - 10, Centre.y + 3), ImVec2(Centre.x + 9, Centre.y + 3), IM_COL32(201, 221, 181, 255), 4);
    Ink->AddLine(ImVec2(Centre.x + 9, Centre.y + 3), ImVec2(Centre.x - 6, Centre.y + 22), IM_COL32(201, 221, 181, 255), 4);
    ImGui::Dummy(ImVec2(0, Verified || CreationConsent ? 90 : 117));
    ImGui::TextColored(Muted, "YOUR SPACE. YOUR NEXT CHAPTER.");
    ImGui::Spacing();
    if (TitleFont) ImGui::PushFont(TitleFont);
    ImGui::TextUnformatted(Verified ? "You're in." : CreationConsent ? "One last step." : "Welcome\nback.");
    if (TitleFont) ImGui::PopFont();
    ImGui::Spacing();
    ImGui::TextColored(Muted, "%s", Verified ? "Your Epic identity is connected." : "Log in to access your content.");
    if (CreationConsent)
        ImGui::TextWrapped("Epic sign-in succeeded. This account has no product user in this Dev deployment. Create a NEW Dev profile only if you do not need to link an existing game identity. Cancel otherwise.");
    else if (Verified)
    {
        const auto& Profile = Networking::InspectEpicProfile();
        ImGui::TextWrapped("%s", Profile.DisplayName[0] ? Profile.DisplayName :
            Profile.Pending ? "Loading your Epic profile..." : "Display name unavailable");
        ImGui::TextColored(SuccessColour, "Epic Auth verified  /  EOS Connect verified");
        ImGui::TextWrapped("Country: %s", Profile.Country[0] ? Profile.Country : "Not provided by Epic");
        ImGui::TextWrapped("Language: %s", Profile.Language[0] ? Profile.Language : "Not provided by Epic");
        ImGui::BeginDisabled(Profile.Pending);
        if (ImGui::SmallButton("Refresh profile")) Networking::QueryEpicProfile();
        ImGui::EndDisabled();
    }
    else ImGui::TextColored(Muted, "Secure sign-in with your Epic account.");
    ImGui::Dummy(ImVec2(0, 25));
    ImGui::PushStyleColor(ImGuiCol_Button, Accent);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.86f, 0.93f, 0.79f, 1));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.68f, 0.77f, 0.59f, 1));
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.15f, 0.085f, 1));
    ImGui::BeginDisabled(Busy && !CreationConsent);
    if (ImGui::Button(Verified ? "Open Epic friends" : CreationConsent ? "Create NEW Dev profile & continue" : Busy ? "Waiting for Epic..." : "Log in with Epic    ->", ImVec2(-1, 54)))
    {
        if (CreationConsent)
            Networking::ApproveEpicUserCreation();
        else if (Verified)
            Networking::ShowEpicFriends();
        else
        {
#if defined(_WIN32)
            if (!Secret[0]) LoadCredential();
#endif
            if (!Secret[0])
                SetupRequested = true;
            else
                BeginLogin();
        }
    }
    ImGui::EndDisabled();
    ImGui::PopStyleColor(4);
    if (Busy && ImGui::Button("Cancel", ImVec2(-1, 38)))
        CancelLogin();
    if (Verified && ImGui::SmallButton("Disconnect"))
    {
        Networking::RetireEpic();
        Verified = false;
        Attempted = false;
        ReceiveDiagnostic("Disconnected locally. Ready for another login.");
    }
    if (Verified && ImGui::CollapsingHeader("Friends"))
    {
        ImGui::TextWrapped("%s", Networking::InspectFriendsReading());
        ImGui::BeginDisabled(Networking::FriendsQueryPending());
        if (ImGui::SmallButton("Refresh friends")) Networking::QueryEpicFriends();
        ImGui::EndDisabled();
        ImGui::BeginChild("Friend names", ImVec2(0, 100));
        for (int Index = 0; Index < Networking::InspectFriendCount(); ++Index)
        {
            ImGui::TextUnformatted(Networking::InspectFriendName(Index));
            ImGui::TextColored(Muted, "%s", Networking::InspectFriendship(Index));
        }
        ImGui::EndChild();
        ImGui::TextWrapped("Only friends authorized for this app may be listed.");
    }
    ImGui::Spacing();
    const char* Status = CreationConsent ? "Waiting for your consent - no login retry" : Busy ? "Waiting for Epic..." : Verified ? "Auth + Connect verified" :
        Cancelled ? "Cancelled" : Attempted ? "Not signed in - check the activity log" : "Ready when you are";
    ImGui::TextColored(Verified ? SuccessColour : Attempted && !Busy ? WarningColour : Muted, "%s", Status);
    ImGui::Dummy(ImVec2(0, 16));
    ImGui::TextColored(Muted, "DEV SANDBOX   /   EPIC ONLINE SERVICES");
    ImGui::EndChild();
    ImGui::SameLine();
    ImGui::BeginChild("Activity card", ImVec2(0, Height), ImGuiChildFlags_Borders);
    ImGui::TextUnformatted("Activity");
    ImGui::SameLine(ImGui::GetWindowContentRegionMax().x - 82);
    if (ImGui::SmallButton("Save log"))
        SaveDiagnostics();
    ImGui::TextColored(Muted, "Live events. No secrets or tokens.");
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();
    ImGui::BeginChild("Console", ImVec2(0, -30));
    for (int Index = 0; Index < LogCount; ++Index)
    {
        const auto& Reading = LogReadings[Index];
        const ImVec4 Tone = Reading.Severity == 3 ? ErrorColour : Reading.Severity == 2 ? WarningColour :
            Reading.Severity == 1 ? SuccessColour : Muted;
        ImGui::TextColored(Muted, "%s", Reading.Time);
        ImGui::SameLine();
        ImGui::TextColored(Tone, "%s", Reading.Severity == 3 ? "ERROR" : Reading.Severity == 2 ? "WARN" :
            Reading.Severity == 1 ? "OK" : "INFO");
        ImGui::PushStyleColor(ImGuiCol_Text, Tone);
        ImGui::PushTextWrapPos(0);
        ImGui::TextUnformatted(Reading.Text);
        ImGui::PopTextWrapPos();
        ImGui::PopStyleColor();
        ImGui::Spacing();
    }
    if (ScrollPending)
    {
        ImGui::SetScrollHereY(1);
        ScrollPending = false;
    }
    ImGui::EndChild();
    ImGui::TextColored(SdkReady ? SuccessColour : WarningColour, "%s", SdkReady ? "*  SDK ready" : "*  SDK unavailable");
    ImGui::SameLine();
    ImGui::TextColored(Muted, "    Player login is verified separately.");
    ImGui::EndChild();
    ImGui::TextColored(Muted, "Project-Networking                                               Private credentials. Clear feedback.");
    if (SetupRequested)
    {
        SetupRequested = false;
        ContinueAfterSetup = true;
        ImGui::OpenPopup("One-time setup");
    }
    PresentSetup();
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
    TitleFont = Io.Fonts->AddFontFromFileTTF("C:/Windows/Fonts/segoeui.ttf", 52.0f);
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
            const bool PlatformReady = Networking::VerifyEpicPlatform(ReceiveDiagnostic);
            const bool Guarded = !Networking::QueryEpicFriends() && !Networking::ShowEpicFriends();
            Result = Captured && SdkReady && Refused && Reused && PlatformReady && Guarded ? 0 : 3;
            std::ofstream Proof("WindowChecks.log");
            Proof << "glfw_imgui_rendered=" << Captured << "\nsdk_check=" << SdkReady
                  << "\nmissing_credentials_refused=" << Refused
                  << "\nsdk_reused_same_process=" << Reused
                  << "\nplatform_created_without_auth=" << PlatformReady
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
