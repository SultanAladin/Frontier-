#pragma once
#include "LobbyState.h"
#include "EpicExchange.h"
#include <imgui.h>
#include <algorithm>
#include <cstdio>
#include <ctime>
#include <string>

namespace Networking
{
inline std::string UtcReading(std::int64_t Seconds)
{
    if (!Seconds) return "No record yet";
    const std::time_t Time = static_cast<std::time_t>(Seconds);
    std::tm Value{};
#if defined(_WIN32)
    if (gmtime_s(&Value, &Time)) return "Unavailable";
#else
    if (!gmtime_r(&Time, &Value)) return "Unavailable";
#endif
    char Text[48]{}; std::strftime(Text, sizeof(Text), "%d %b %Y  %H:%M UTC", &Value); return Text;
}
inline std::string DurationReading(std::int64_t Seconds)
{
    char Text[48]{}; Seconds = std::max<std::int64_t>(0, Seconds);
    std::snprintf(Text, sizeof(Text), "%02lld:%02lld:%02lld", static_cast<long long>(Seconds / 3600),
        static_cast<long long>((Seconds / 60) % 60), static_cast<long long>(Seconds % 60)); return Text;
}
inline void LobbyPill(const char* Text, ImVec4 Colour)
{
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(Colour.x, Colour.y, Colour.z, .12f));
    ImGui::PushStyleColor(ImGuiCol_Text, Colour);
    ImGui::BeginDisabled(); ImGui::SmallButton(Text); ImGui::EndDisabled();
    ImGui::PopStyleColor(2);
}
inline void RenderLobbyPanel(ImFont* Heading, const char* Diagnostics, void (*CopyLog)(), void (*Disconnect)(), const RoomReading* Preview = nullptr)
{
    const auto& R = Preview ? *Preview : InspectRoom(); const auto& H = InspectHistory(); const auto& P = InspectEpicProfile();
    const ImVec4 Dim(.56f, .58f, .63f, 1), Blue(.28f,.48f,1,1), Green(.48f,.85f,.52f,1), Amber(.91f,.72f,.39f,1);
    auto* View = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(View->WorkPos); ImGui::SetNextWindowSize(View->WorkSize);
    ImGui::Begin("Frontier lobby", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings);
    ImGui::BeginDisabled(EpicOverlayOwnsInput() || Preview);
    ImGui::TextColored(Blue, "%s", Preview ? "UI PREVIEW / NO EOS AUTHENTICATION" : "F / FRONTIER"); ImGui::SameLine();
    ImGui::TextColored(Dim, "      LOBBY     /     CHARGE DEV");
    ImGui::SameLine(ImGui::GetWindowContentRegionMax().x - 265);
    if (ImGui::SmallButton("Your account")) ImGui::OpenPopup("Account details");
    ImGui::SameLine(); if (ImGui::SmallButton("Copy log")) CopyLog();
    ImGui::SameLine(); if (ImGui::SmallButton("Disconnect")) Disconnect();
    if (ImGui::BeginPopup("Account details"))
    {
        ImGui::TextUnformatted(P.DisplayName[0] ? P.DisplayName : "Epic account");
        ImGui::TextColored(Green, "Auth + Connect verified");
        ImGui::Text("Country: %s", P.Country[0] ? P.Country : "Unavailable");
        ImGui::Text("Language: %s", P.Language[0] ? P.Language : "Unavailable");
        ImGui::BeginDisabled(P.Pending); if (ImGui::SmallButton("Refresh profile")) QueryEpicProfile(); ImGui::EndDisabled();
        if (ImGui::SmallButton("Epic friends overlay")) ShowEpicFriends();
        ImGui::EndPopup();
    }
    ImGui::Spacing();
    if (Heading) ImGui::PushFont(Heading);
    ImGui::TextUnformatted(R.Phase == RoomPhase::Running ? "In session." : "Your lobby.");
    if (Heading) ImGui::PopFont();
    ImGui::TextColored(Dim, "Your squad. Your pace. Ready when you are.");
    ImGui::Spacing();
    unsigned Ready = 0, Real = 0, Dummy = 0;
    for (const auto& M : R.Players) { Ready += M.Ready; M.Dummy ? ++Dummy : ++Real; }
    std::int64_t LastLogin = 0; unsigned Completed = 0;
    const HistoryRecord* LastMatch = nullptr;
    for (const auto& Record : H.Records)
    {
        if (Record.Kind == "login") LastLogin = std::max(LastLogin, Record.Utc);
        if (Record.Kind == "completed") ++Completed;
        if (Record.Kind != "login" && !LastMatch) LastMatch = &Record;
    }
    const float Width = ImGui::GetContentRegionAvail().x;
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18, 12));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12, 8));
    const float MetricWidth = (Width - 24) / 3;
    for (int I = 0; I < 3; ++I)
    {
        if (I) ImGui::SameLine();
        ImGui::PushID(I);
        ImGui::BeginChild("metric", ImVec2(MetricWidth, 96), ImGuiChildFlags_Borders);
        ImGui::TextColored(Dim, "%s", I == 0 ? "READINESS" : I == 1 ? "LIVE SESSION" : "RECENT COMPLETED TESTS");
        ImGui::SetWindowFontScale(1.8f);
        if (I == 0) ImGui::Text("%u / %u", Ready, static_cast<unsigned>(R.Players.size()));
        else if (I == 1) ImGui::TextUnformatted(R.Phase == RoomPhase::Running ? DurationReading(std::time(nullptr) - R.StartedAt).c_str() : "Not running");
        else ImGui::Text("%u", Completed);
        ImGui::SetWindowFontScale(1); ImGui::EndChild(); ImGui::PopID();
    }
    ImGui::PopStyleVar(2);
    ImGui::Spacing();
    const float Height = ImGui::GetContentRegionAvail().y - 27;
    ImGui::BeginChild("Squad panel", ImVec2((Width - 12) * .60f, Height), ImGuiChildFlags_Borders);
    ImGui::TextUnformatted("The room"); ImGui::SameLine();
    if (Preview) ImGui::TextColored(Dim, "   Layout fixture - not an EOS roster");
    else ImGui::TextColored(Dim, "   %u EOS member%s  /  %u local test players", Real, Real == 1 ? "" : "s", Dummy);
    ImGui::Spacing();
    const float RosterHeight = std::max(130.0f, ImGui::GetContentRegionAvail().y - 185.0f);
    ImGui::BeginChild("Scrollable roster", ImVec2(0, RosterHeight));
    const float CardWidth = (ImGui::GetContentRegionAvail().x - 12) / 2;
    for (size_t I = 0; I < R.Players.size(); ++I)
    {
        const auto Player = R.Players[I];
        if (I % 2) ImGui::SameLine();
        ImGui::PushID(static_cast<int>(I));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(.105f,.109f,.12f,1));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14, 12));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8, 6));
        ImGui::BeginChild("player", ImVec2(CardWidth, 132), ImGuiChildFlags_Borders);
        const ImVec2 Avatar(ImGui::GetWindowPos().x + ImGui::GetWindowWidth() - 32, ImGui::GetCursorScreenPos().y + 14);
        ImGui::GetWindowDrawList()->AddCircleFilled(Avatar, 16, Player.Dummy ? IM_COL32(62, 51, 31, 255) : IM_COL32(34, 52, 106, 255), 32);
        ImGui::GetWindowDrawList()->AddText(ImVec2(Avatar.x - 5, Avatar.y - 9), ImGui::GetColorU32(Player.Dummy ? Amber : Blue), Player.Dummy ? "T" : "E");
        ImGui::TextColored(Player.Dummy ? Amber : Blue, "%s", Player.Dummy ? "LOCAL DUMMY" : Preview ? "PREVIEW ACCOUNT" : Player.Local ? "YOU / EPIC ACCOUNT" : "EOS MEMBER");
        ImGui::TextWrapped("%s", Player.Name.c_str());
        ImGui::TextColored(Player.Ready ? Green : Dim, "%s", Player.Ready ? "*  Ready" : "o  Not ready");
        if (Player.Dummy)
        {
            unsigned Index = 0; for (size_t J = 0; J < I; ++J) if (R.Players[J].Dummy) ++Index;
            ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !R.Owner);
            bool Value = Player.Ready;
            if (ImGui::Checkbox("Test ready", &Value)) SetDummyReady(Index, Value);
            ImGui::EndDisabled();
        }
        ImGui::EndChild(); ImGui::PopStyleVar(2); ImGui::PopStyleColor(); ImGui::PopID();
    }
    if (R.Players.empty()) ImGui::TextWrapped("%s", R.Status.c_str());
    ImGui::EndChild();
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8, 6));
    ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextUnformatted("Voice room");
    ImGui::TextColored(R.VoiceConnected ? Green : Dim, "%s", R.VoiceConnected ? "*  Connected to EOS RTC" : "o  RTC not connected");
    ImGui::TextWrapped("%s", R.VoiceStatus.c_str());
    ImGui::BeginDisabled(!R.VoiceConnected || R.VoicePending);
    if (ImGui::Button(R.Microphone ? "Mute microphone" : "Enable microphone")) SetRoomMicrophone(!R.Microphone);
    ImGui::SameLine(); if (ImGui::Button(R.Listening ? "Mute speakers" : "Enable speakers")) SetRoomListening(!R.Listening);
    ImGui::EndDisabled();
    if (R.VoicePending) ImGui::TextColored(Dim, "Applying audio change...");
    ImGui::TextWrapped("Voice uses your OS default audio devices. Local dummies cannot send or receive audio; test with another real account.");
    if (ImGui::CollapsingHeader("Solo test controls"))
    {
        ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !R.Owner);
        int Count = static_cast<int>(Dummy);
        ImGui::SetNextItemWidth(150);
        if (ImGui::SliderInt("Local dummies", &Count, 0, 3)) SetDummyCount(static_cast<unsigned>(Count));
        ImGui::EndDisabled();
        ImGui::TextWrapped("Dummies only exercise local readiness. They are not Epic accounts, session registrations or RTC peers.");
    }
    ImGui::PopStyleVar();
    ImGui::EndChild();
    ImGui::SameLine();
    ImGui::BeginChild("Match panel", ImVec2(0, Height), ImGuiChildFlags_Borders);
    ImGui::TextUnformatted("Match session");
    ImGui::TextColored(Dim, "DEV DEPLOYMENT  /  EOS");
    ImGui::Spacing(); ImGui::TextWrapped("%s", R.Status.c_str());
    if (!R.LobbyId.empty())
    {
        if (ImGui::SmallButton("Copy lobby ID")) ImGui::SetClipboardText(R.LobbyId.c_str());
        ImGui::SameLine(); ImGui::TextColored(Dim, "%s", R.Owner ? "Host" : "Member");
    }
    if (!R.SessionId.empty())
    {
        ImGui::TextColored(Dim, "SESSION ID"); ImGui::TextWrapped("%s", R.SessionId.c_str());
    }
    ImGui::Spacing();
    if (R.Phase == RoomPhase::Running && R.Owner)
    {
        if (ImGui::Button("End test match", ImVec2(-1, 46))) EndRoomMatch();
    }
    else if (R.Owner && (R.Phase == RoomPhase::Complete || (R.Phase == RoomPhase::Failed && !R.LobbyId.empty())))
    {
        if (ImGui::Button("Prepare next match", ImVec2(-1, 46))) PrepareNextMatch();
    }
    else if (R.Phase == RoomPhase::Offline || (R.Phase == RoomPhase::Failed && R.LobbyId.empty()))
    {
        if (ImGui::Button("Create lobby", ImVec2(-1, 46))) CreateRoom();
    }
    else
    {
        ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || R.ReadyPending);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(.12f,.32f,.90f,1));
        if (ImGui::Button(R.LocalReady ? "Not ready" : "I'm ready", ImVec2(-1, 46))) SetRoomReady(!R.LocalReady);
        ImGui::PopStyleColor(); ImGui::EndDisabled();
    }
    if (R.Owner)
    {
        bool Auto = R.AutoStart;
        ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting);
        if (ImGui::Checkbox("Start when everyone is ready", &Auto)) SetAutoStart(Auto);
        ImGui::EndDisabled();
        if (!Auto)
        {
            ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !EveryoneReady(R));
            if (ImGui::Button("Start match", ImVec2(-1, 40))) StartRoomMatch();
            ImGui::EndDisabled();
        }
    }
    if (!R.LobbyId.empty() && ImGui::SmallButton("Leave lobby")) LeaveRoom();
    if (ImGui::CollapsingHeader("Join a friend"))
    {
        static char LobbyId[129]{};
        ImGui::InputTextWithHint("##join-id", "Paste lobby ID", LobbyId, sizeof(LobbyId), ImGuiInputTextFlags_AutoSelectAll);
        if (ImGui::SmallButton("Join lobby")) JoinRoom(LobbyId);
        ImGui::TextWrapped("Uses a real EOS lobby ID. Requires a separate eligible account to test a second player.");
    }
    ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
    ImGui::TextUnformatted("Session history");
    ImGui::TextColored(Dim, "LAST SUCCESSFUL LOGIN");
    ImGui::TextWrapped("%s", UtcReading(LastLogin).c_str());
    if (LastMatch)
    {
        ImGui::TextColored(Dim, "LAST MATCH");
        ImGui::TextWrapped("%s / %s", LastMatch->Kind.c_str(), DurationReading(LastMatch->Duration).c_str());
        ImGui::TextWrapped("%s", LastMatch->Session.c_str());
    }
    ImGui::TextWrapped("%s", H.Status.c_str());
    ImGui::TextColored(Dim, "%u pending upload%s", H.Pending, H.Pending == 1 ? "" : "s");
    ImGui::BeginDisabled(H.Busy || !H.Enabled);
    if (ImGui::SmallButton("Sync cloud history")) RetryCloudSync();
    ImGui::EndDisabled();
    ImGui::TextWrapped("Up to 64 recent records. Client-written test history, not trusted competitive stats.");
    if (ImGui::CollapsingHeader("Activity log"))
    {
        ImGui::BeginChild("Lobby diagnostics", ImVec2(0, 200));
        ImGui::PushTextWrapPos(0); ImGui::TextUnformatted(Diagnostics); ImGui::PopTextWrapPos();
        ImGui::EndChild();
    }
    ImGui::EndChild();
    ImGui::TextColored(Dim, "EOS LOBBY + RTC + MATCH LIFECYCLE       /       Local test players clearly marked");
    ImGui::EndDisabled(); ImGui::End();
}
}
