#pragma once
#include "LobbyState.h"
#include "EpicExchange.h"
#include <imgui.h>
#include <algorithm>
#include <cstdio>
#include <ctime>
#include <cstring>
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
inline const char* PhaseLabel(RoomPhase P) noexcept
{
    switch (P)
    {
    case RoomPhase::Offline: return "Offline";
    case RoomPhase::Creating: return "Creating";
    case RoomPhase::Waiting: return "Waiting";
    case RoomPhase::Preparing: return "Preparing";
    case RoomPhase::Starting: return "Starting";
    case RoomPhase::Running: return "Running";
    case RoomPhase::Ending: return "Ending";
    case RoomPhase::Complete: return "Complete";
    case RoomPhase::Leaving: return "Leaving";
    case RoomPhase::Failed: return "Attention";
    }
    return "Unknown";
}
inline void StatusChip(const char* Text, ImVec4 Colour)
{
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(Colour.x, Colour.y, Colour.z, 0.14f));
    ImGui::PushStyleColor(ImGuiCol_Text, Colour);
    ImGui::BeginDisabled(); ImGui::SmallButton(Text); ImGui::EndDisabled();
    ImGui::PopStyleColor(2);
}

inline void RenderLobbyPanel(ImFont* Heading, const char* Diagnostics, void (*CopyLog)(), void (*Disconnect)(), const RoomReading* Preview = nullptr)
{
    const auto& R = Preview ? *Preview : InspectRoom();
    const auto& H = InspectHistory();
    const auto& P = InspectEpicProfile();
    const ImVec4 Dim(0.54f, 0.54f, 0.56f, 1.0f);
    const ImVec4 Blue(0.12f, 0.37f, 1.0f, 1.0f);
    const ImVec4 BlueSoft(0.30f, 0.50f, 1.0f, 1.0f);
    const ImVec4 Green(0.48f, 0.85f, 0.52f, 1.0f);
    const ImVec4 Amber(0.91f, 0.72f, 0.39f, 1.0f);
    const ImVec4 Red(0.96f, 0.51f, 0.47f, 1.0f);
    static int ActiveTab = 0; // 0 Lobby, 1 Browse, 2 Settings, 3 History
    static char LobbyFilter[128]{}, SessionFilter[128]{}, JoinId[129]{};
    static char LBucket[65]{}, LMap[65]{}, LMode[65]{}, LRegion[65]{}, LNote[65]{};
    static char SName[33]{}, SBucket[65]{}, SMap[65]{}, SMode[65]{};
    static int LMax = 8, LPerm = 1, SMax = 8, SPerm = 2;
    static bool LPresence = true, LInvites = true, LRtc = true, LNoMigration = true;
    static bool LJoinById = true, LRejoinInvite = true, LRtcAuto = true;
    static bool SJoinProg = false, SPresence = false;
    static bool SettingsLoaded = false;
    static char SettingsError[256]{};
    if (!SettingsLoaded)
    {
        std::snprintf(LBucket, sizeof(LBucket), "%s", R.LobbySettings.BucketId.c_str());
        std::snprintf(LMap, sizeof(LMap), "%s", R.LobbySettings.MapName.c_str());
        std::snprintf(LMode, sizeof(LMode), "%s", R.LobbySettings.ModeName.c_str());
        std::snprintf(LRegion, sizeof(LRegion), "%s", R.LobbySettings.Region.c_str());
        std::snprintf(LNote, sizeof(LNote), "%s", R.LobbySettings.Note.c_str());
        std::snprintf(SName, sizeof(SName), "%s", R.SessionSettings.SessionName.c_str());
        std::snprintf(SBucket, sizeof(SBucket), "%s", R.SessionSettings.BucketId.c_str());
        std::snprintf(SMap, sizeof(SMap), "%s", R.SessionSettings.MapName.c_str());
        std::snprintf(SMode, sizeof(SMode), "%s", R.SessionSettings.ModeName.c_str());
        LMax = static_cast<int>(R.LobbySettings.MaxMembers);
        LPerm = static_cast<int>(R.LobbySettings.Permission);
        SMax = static_cast<int>(R.SessionSettings.MaxPlayers);
        SPerm = static_cast<int>(R.SessionSettings.Permission);
        LPresence = R.LobbySettings.PresenceEnabled; LInvites = R.LobbySettings.AllowInvites;
        LRtc = R.LobbySettings.EnableRtcRoom; LNoMigration = R.LobbySettings.DisableHostMigration;
        LJoinById = R.LobbySettings.EnableJoinById; LRejoinInvite = R.LobbySettings.RejoinAfterKickRequiresInvite;
        LRtcAuto = R.LobbySettings.RtcAutoJoin;
        SJoinProg = R.SessionSettings.JoinInProgressAllowed; SPresence = R.SessionSettings.PresenceEnabled;
        SettingsLoaded = true;
    }

    auto* View = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(View->WorkPos); ImGui::SetNextWindowSize(View->WorkSize);
    ImGui::Begin("Frontier lobby", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings);
    ImGui::BeginDisabled(EpicOverlayOwnsInput() || Preview);
    // ---- Top bar ----
    ImGui::TextColored(BlueSoft, "FRONTIER"); ImGui::SameLine();
    ImGui::TextColored(Dim, "CHARGE DEV  /  LOBBY LAB");
    ImGui::SameLine(ImGui::GetWindowContentRegionMax().x - 275);
    if (ImGui::SmallButton("Account")) ImGui::OpenPopup("Account details");
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
    ImGui::TextColored(Dim, "Lobby for voice and readiness. Match session for the actual game.");
    ImGui::Spacing();
    // ---- Tabs ----
    const char* Tabs[] = {"Lobby", "Browse", "Settings", "History"};
    for (int I = 0; I < 4; ++I)
    {
        if (I) ImGui::SameLine();
        const bool Active = ActiveTab == I;
        if (Active) ImGui::PushStyleColor(ImGuiCol_Button, Blue);
        if (ImGui::Button(Tabs[I], ImVec2(120, 32))) ActiveTab = I;
        if (Active) ImGui::PopStyleColor();
    }
    ImGui::SameLine(ImGui::GetWindowContentRegionMax().x - 190);
    StatusChip(PhaseLabel(R.Phase), R.Phase == RoomPhase::Running ? Green :
        R.Phase == RoomPhase::Failed ? Red : R.Phase == RoomPhase::Waiting ? BlueSoft : Dim);
    ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();

    const float Width = ImGui::GetContentRegionAvail().x;
    const float Height = ImGui::GetContentRegionAvail().y - 26;
    unsigned Ready = 0, Real = 0, Dummy = 0;
    for (const auto& M : R.Players) { Ready += M.Ready; M.Dummy ? ++Dummy : ++Real; }

    if (ActiveTab == 0)
    {
        // ---- Lobby tab: roster + voice | match session ----
        ImGui::BeginChild("Squad panel", ImVec2((Width - 12) * 0.60f, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Squad"); ImGui::SameLine();
        ImGui::TextColored(Dim, "%u ready / %u players  -  %u real, %u test", Ready,
            static_cast<unsigned>(R.Players.size()), Real, Dummy);
        ImGui::Spacing();
        const float RosterHeight = std::max(150.0f, ImGui::GetContentRegionAvail().y - 235.0f);
        ImGui::BeginChild("Roster", ImVec2(0, RosterHeight));
        const float CardWidth = (ImGui::GetContentRegionAvail().x - 12) / 2;
        for (size_t I = 0; I < R.Players.size(); ++I)
        {
            const auto Player = R.Players[I];
            if (I % 2) ImGui::SameLine();
            ImGui::PushID(static_cast<int>(I));
            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.07f, 0.07f, 0.08f, 1.0f));
            ImGui::BeginChild("player", ImVec2(CardWidth, 118), ImGuiChildFlags_Borders);
            ImGui::TextColored(Player.Dummy ? Amber : BlueSoft, "%s",
                Player.Dummy ? "TEST" : Preview ? "PREVIEW" : Player.Local ? "YOU" : "MEMBER");
            ImGui::TextWrapped("%s", Player.Name.c_str());
            ImGui::TextColored(Player.Ready ? Green : Dim, "%s", Player.Ready ? "Ready" : "Not ready");
            if (Player.Dummy)
            {
                unsigned Index = 0; for (size_t J = 0; J < I; ++J) if (R.Players[J].Dummy) ++Index;
                ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !R.Owner);
                bool Value = Player.Ready;
                if (ImGui::Checkbox("Test ready", &Value)) SetDummyReady(Index, Value);
                ImGui::EndDisabled();
            }
            ImGui::EndChild(); ImGui::PopStyleColor(); ImGui::PopID();
        }
        if (R.Players.empty()) ImGui::TextColored(Dim, "%s", R.Status.c_str());
        ImGui::EndChild();
        ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextUnformatted("Voice"); ImGui::SameLine();
        ImGui::TextColored(R.VoiceConnected ? Green : Dim, "%s",
            R.VoiceConnected ? "RTC connected" : "RTC not connected");
        ImGui::TextColored(Dim, "%s", R.VoiceStatus.c_str());
        ImGui::BeginDisabled(!R.VoiceConnected || R.VoicePending);
        if (ImGui::Button(R.Microphone ? "Mute mic" : "Enable mic", ImVec2(130, 32))) SetRoomMicrophone(!R.Microphone);
        ImGui::SameLine();
        if (ImGui::Button(R.Listening ? "Mute audio" : "Enable audio", ImVec2(130, 32))) SetRoomListening(!R.Listening);
        ImGui::EndDisabled();
        if (R.VoicePending) ImGui::TextColored(Dim, "Applying audio change...");
        if (ImGui::CollapsingHeader("Solo test controls"))
        {
            ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !R.Owner);
            int Count = static_cast<int>(Dummy);
            ImGui::SetNextItemWidth(160);
            if (ImGui::SliderInt("Test players", &Count, 0, 3)) SetDummyCount(static_cast<unsigned>(Count));
            ImGui::EndDisabled();
            ImGui::TextColored(Dim, "Test players exercise readiness only. No Epic identity, session slot, or voice.");
        }
        ImGui::EndChild();
        ImGui::SameLine();
        ImGui::BeginChild("Match panel", ImVec2(0, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Lobby"); ImGui::SameLine();
        ImGui::TextColored(Dim, "%s", R.Owner ? "HOST" : R.LobbyId.empty() ? "NO LOBBY" : "MEMBER");
        ImGui::TextColored(Dim, "%s", R.Status.c_str());
        if (!R.LobbyId.empty())
        {
            if (ImGui::SmallButton("Copy lobby ID")) ImGui::SetClipboardText(R.LobbyId.c_str());
            ImGui::SameLine();
            if (ImGui::SmallButton("Leave lobby")) LeaveRoom();
        }
        else if (R.Phase == RoomPhase::Offline || (R.Phase == RoomPhase::Failed && R.LobbyId.empty()))
        {
            if (ImGui::Button("Create lobby", ImVec2(-1, 40))) CreateRoom();
        }
        ImGui::Spacing(); ImGui::Separator(); ImGui::Spacing();
        ImGui::TextUnformatted("Match session"); ImGui::SameLine();
        ImGui::TextColored(Dim, "%s", R.SessionOwner ? "HOST" : R.SessionJoined ? "JOINED" : R.SessionExists ? "ACTIVE" : "NONE");
        ImGui::TextColored(Dim, "%s", R.SessionStatus.c_str());
        if (!R.SessionId.empty()) ImGui::TextWrapped("ID: %s", R.SessionId.c_str());
        if (R.SessionExists) ImGui::TextColored(Dim, "Registered: %u", R.SessionRegistered);
        if (R.SessionWithoutRegistration)
            ImGui::TextColored(Amber, "Running without registration. Fix the EOS Client Policy for full sessions.");
        ImGui::Spacing();
        if (R.Phase == RoomPhase::Running && R.Owner)
        {
            if (ImGui::Button("End match", ImVec2(-1, 44))) EndRoomMatch();
        }
        else if (R.Owner && (R.Phase == RoomPhase::Complete || (R.Phase == RoomPhase::Failed && !R.LobbyId.empty() && R.SessionExists)))
        {
            if (ImGui::Button("Prepare next match", ImVec2(-1, 44))) PrepareNextMatch();
        }
        else if (!R.LobbyId.empty())
        {
            ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || R.ReadyPending);
            ImGui::PushStyleColor(ImGuiCol_Button, Blue);
            if (ImGui::Button(R.LocalReady ? "Not ready" : "I'm ready", ImVec2(-1, 44))) SetRoomReady(!R.LocalReady);
            ImGui::PopStyleColor(); ImGui::EndDisabled();
        }
        if (R.Owner && !R.LobbyId.empty())
        {
            bool Auto = R.AutoStart;
            ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting);
            if (ImGui::Checkbox("Start when everyone is ready", &Auto)) SetAutoStart(Auto);
            ImGui::EndDisabled();
            if (!Auto)
            {
                ImGui::BeginDisabled(R.Phase != RoomPhase::Waiting || !EveryoneReady(R));
                if (ImGui::Button(R.SessionWithoutRegistration ? "Start without registration" : "Start match", ImVec2(-1, 38))) StartRoomMatch();
                ImGui::EndDisabled();
            }
        }
        if (!R.Owner && !R.LobbyId.empty() && !R.SessionId.empty() && !R.SessionExists && R.Phase == RoomPhase::Running)
        {
            if (ImGui::Button("Join match session", ImVec2(-1, 38))) JoinMatchSession();
        }
        if (R.SessionExists && !R.SessionOwner)
        {
            if (ImGui::SmallButton("Leave match session")) LeaveMatchSession();
        }
        ImGui::Spacing();
        ImGui::TextColored(Dim, "Leaving the lobby always closes the match session first.");
        ImGui::EndChild();
    }
    else if (ActiveTab == 1)
    {
        // ---- Browse tab ----
        ImGui::BeginChild("Browse lobbies", ImVec2((Width - 12) * 0.5f, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Lobbies");
        ImGui::TextColored(Dim, "%s", R.Search.LobbyStatus.c_str());
        ImGui::SetNextItemWidth(-1);
        ImGui::InputTextWithHint("##lobby-filter", "Filter by ID, bucket, map, mode", LobbyFilter, sizeof(LobbyFilter));
        ImGui::BeginDisabled(R.Search.LobbyBusy);
        if (ImGui::Button("Search lobbies", ImVec2(-1, 32))) RefreshLobbySearch(LobbyFilter);
        ImGui::EndDisabled();
        ImGui::Spacing();
        ImGui::BeginChild("Lobby results", ImVec2(0, -90));
        unsigned Shown = 0;
        for (size_t I = 0; I < R.Search.Lobbies.size(); ++I)
        {
            const auto& Lb = R.Search.Lobbies[I];
            if (!LobbyMatchesFilter(Lb, LobbyFilter)) continue;
            ++Shown;
            ImGui::PushID(static_cast<int>(I));
            ImGui::Separator();
            ImGui::TextWrapped("%s", Lb.LobbyId.c_str());
            ImGui::TextColored(Dim, "%s  -  %u/%u  -  %s%s", Lb.BucketId.c_str(), Lb.Members, Lb.MaxMembers,
                Lb.MapName.empty() ? "no map" : Lb.MapName.c_str(), Lb.RtcEnabled ? "  -  voice" : "");
            if (ImGui::SmallButton("Join")) JoinLobbyResult(I);
            ImGui::PopID();
        }
        if (!Shown) ImGui::TextColored(Dim, "No lobbies match. Only advertised lobbies appear here.");
        ImGui::EndChild();
        ImGui::Separator();
        ImGui::TextUnformatted("Join by ID");
        ImGui::SetNextItemWidth(-1);
        ImGui::InputTextWithHint("##join-id", "Paste lobby ID", JoinId, sizeof(JoinId), ImGuiInputTextFlags_AutoSelectAll);
        if (ImGui::SmallButton("Join lobby")) JoinRoom(JoinId);
        ImGui::EndChild();
        ImGui::SameLine();
        ImGui::BeginChild("Browse sessions", ImVec2(0, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Match sessions");
        ImGui::TextColored(Dim, "%s", R.Search.SessionStatus.c_str());
        ImGui::SetNextItemWidth(-1);
        ImGui::InputTextWithHint("##session-filter", "Filter by ID, bucket, map, mode", SessionFilter, sizeof(SessionFilter));
        ImGui::BeginDisabled(R.Search.SessionBusy);
        if (ImGui::Button("Search sessions", ImVec2(-1, 32))) RefreshSessionSearch(SessionFilter);
        ImGui::EndDisabled();
        ImGui::Spacing();
        ImGui::BeginChild("Session results", ImVec2(0, 0));
        unsigned SShown = 0;
        for (size_t I = 0; I < R.Search.Sessions.size(); ++I)
        {
            const auto& S = R.Search.Sessions[I];
            if (!SessionMatchesFilter(S, SessionFilter)) continue;
            ++SShown;
            ImGui::PushID(static_cast<int>(1000 + I));
            ImGui::Separator();
            ImGui::TextWrapped("%s", S.SessionId.c_str());
            ImGui::TextColored(Dim, "%s  -  %u open / %u  -  %s", S.BucketId.c_str(),
                S.OpenConnections, S.MaxConnections, S.MapName.empty() ? "no map" : S.MapName.c_str());
            ImGui::BeginDisabled(R.SessionExists);
            if (ImGui::SmallButton("Join session")) JoinSessionResult(I);
            ImGui::EndDisabled();
            ImGui::PopID();
        }
        if (!SShown) ImGui::TextColored(Dim, "No sessions match. New sessions take a few seconds to index.");
        ImGui::EndChild();
        ImGui::EndChild();
    }
    else if (ActiveTab == 2)
    {
        // ---- Settings tab ----
        ImGui::BeginChild("Lobby settings", ImVec2((Width - 12) * 0.5f, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Lobby settings");
        ImGui::TextColored(Dim, "Used on Create. Host can apply live.");
        ImGui::Spacing();
        ImGui::TextUnformatted("Bucket"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##lbucket", LBucket, sizeof(LBucket));
        ImGui::TextUnformatted("Max members"); ImGui::SetNextItemWidth(-1); ImGui::SliderInt("##lmax", &LMax, 2, 16);
        ImGui::TextUnformatted("Permission"); ImGui::SetNextItemWidth(-1);
        ImGui::Combo("##lperm", &LPerm, "Public advertised\0Join via presence\0Invite only\0");
        ImGui::Checkbox("Presence enabled", &LPresence);
        ImGui::Checkbox("Allow invites", &LInvites);
        ImGui::Checkbox("Enable voice room", &LRtc);
        ImGui::Checkbox("Disable host migration", &LNoMigration);
        ImGui::Checkbox("Allow join by ID", &LJoinById);
        ImGui::Checkbox("Rejoin after kick needs invite", &LRejoinInvite);
        ImGui::Checkbox("Auto-join voice", &LRtcAuto);
        ImGui::Spacing();
        ImGui::TextUnformatted("Map"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##lmap", LMap, sizeof(LMap));
        ImGui::TextUnformatted("Mode"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##lmode", LMode, sizeof(LMode));
        ImGui::TextUnformatted("Region"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##lregion", LRegion, sizeof(LRegion));
        ImGui::TextUnformatted("Note"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##lnote", LNote, sizeof(LNote));
        ImGui::Spacing();
        if (ImGui::Button("Apply lobby settings", ImVec2(-1, 36)))
        {
            LobbyCreationSettings S;
            S.BucketId = LBucket; S.MaxMembers = static_cast<unsigned>(std::clamp(LMax, 2, 16));
            S.Permission = static_cast<LobbyPermission>(std::clamp(LPerm, 0, 2));
            S.PresenceEnabled = LPresence; S.AllowInvites = LInvites; S.EnableRtcRoom = LRtc;
            S.DisableHostMigration = LNoMigration; S.EnableJoinById = LJoinById;
            S.RejoinAfterKickRequiresInvite = LRejoinInvite; S.RtcAutoJoin = LRtcAuto;
            S.MapName = LMap; S.ModeName = LMode; S.Region = LRegion; S.Note = LNote;
            if (ApplyLobbySettings(S))
            {
                std::snprintf(SettingsError, sizeof(SettingsError), "Lobby settings applied.");
                if (!R.LobbyId.empty() && R.Owner) UpdateLobbyLiveSettings();
            }
            else std::snprintf(SettingsError, sizeof(SettingsError), "Invalid lobby settings. Check bucket and lengths.");
        }
        if (R.LobbyId.empty() && ImGui::Button("Create lobby with these settings", ImVec2(-1, 32))) CreateRoom();
        ImGui::EndChild();
        ImGui::SameLine();
        ImGui::BeginChild("Session settings", ImVec2(0, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Match session settings");
        ImGui::TextColored(Dim, "Used when the host prepares the session.");
        ImGui::Spacing();
        ImGui::TextUnformatted("Session name"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##sname", SName, sizeof(SName));
        ImGui::TextUnformatted("Bucket"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##sbucket", SBucket, sizeof(SBucket));
        ImGui::TextUnformatted("Max players"); ImGui::SetNextItemWidth(-1); ImGui::SliderInt("##smax", &SMax, 2, 16);
        ImGui::TextUnformatted("Permission"); ImGui::SetNextItemWidth(-1);
        ImGui::Combo("##sperm", &SPerm, "Public advertised\0Join via presence\0Invite only\0");
        ImGui::Checkbox("Allow join in progress", &SJoinProg);
        ImGui::Checkbox("Presence enabled", &SPresence);
        ImGui::Spacing();
        ImGui::TextUnformatted("Map"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##smap", SMap, sizeof(SMap));
        ImGui::TextUnformatted("Mode"); ImGui::SetNextItemWidth(-1); ImGui::InputText("##smode", SMode, sizeof(SMode));
        ImGui::Spacing();
        if (ImGui::Button("Apply session settings", ImVec2(-1, 36)))
        {
            MatchSessionSettings S;
            S.SessionName = SName; S.BucketId = SBucket;
            S.MaxPlayers = static_cast<unsigned>(std::clamp(SMax, 2, 16));
            S.Permission = static_cast<SessionPermission>(std::clamp(SPerm, 0, 2));
            S.JoinInProgressAllowed = SJoinProg; S.PresenceEnabled = SPresence;
            S.MapName = SMap; S.ModeName = SMode;
            std::snprintf(SettingsError, sizeof(SettingsError), "%s",
                ApplySessionSettings(S) ? "Session settings applied." : "Invalid session settings. Check name and bucket.");
        }
        ImGui::Spacing();
        if (SettingsError[0]) ImGui::TextColored(Amber, "%s", SettingsError);
        ImGui::TextColored(Dim, "Session name: letters, numbers, - and _. Bucket: letters, numbers, - _ : .");
        ImGui::EndChild();
    }
    else
    {
        // ---- History tab ----
        std::int64_t LastLogin = 0; unsigned Completed = 0;
        const HistoryRecord* LastMatch = nullptr;
        for (const auto& Record : H.Records)
        {
            if (Record.Kind == "login") LastLogin = std::max(LastLogin, Record.Utc);
            if (Record.Kind == "completed") ++Completed;
            if (Record.Kind != "login" && !LastMatch) LastMatch = &Record;
        }
        ImGui::BeginChild("History panel", ImVec2((Width - 12) * 0.42f, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("History");
        ImGui::TextColored(Dim, "LAST LOGIN"); ImGui::TextWrapped("%s", UtcReading(LastLogin).c_str());
        ImGui::TextColored(Dim, "COMPLETED TESTS"); ImGui::Text("%u", Completed);
        if (LastMatch)
        {
            ImGui::TextColored(Dim, "LAST MATCH");
            ImGui::TextWrapped("%s / %s", LastMatch->Kind.c_str(), DurationReading(LastMatch->Duration).c_str());
            ImGui::TextWrapped("%s", LastMatch->Session.c_str());
        }
        ImGui::Spacing();
        ImGui::TextWrapped("%s", H.Status.c_str());
        ImGui::TextColored(Dim, "%u pending", H.Pending);
        ImGui::BeginDisabled(H.Busy || !H.Enabled);
        if (ImGui::SmallButton("Sync cloud history")) RetryCloudSync();
        ImGui::EndDisabled();
        ImGui::TextColored(Dim, "Up to 64 records. Client history only.");
        ImGui::EndChild();
        ImGui::SameLine();
        ImGui::BeginChild("Log panel", ImVec2(0, Height), ImGuiChildFlags_Borders);
        ImGui::TextUnformatted("Activity log");
        ImGui::TextColored(Dim, "Redacted. No secrets or tokens.");
        ImGui::BeginChild("Lobby diagnostics", ImVec2(0, 0));
        ImGui::PushTextWrapPos(0); ImGui::TextUnformatted(Diagnostics); ImGui::PopTextWrapPos();
        ImGui::EndChild();
        ImGui::EndChild();
    }
    ImGui::TextColored(Dim, "EOS LOBBY + MATCH SESSION + RTC  /  Leaving the lobby closes the session first");
    ImGui::EndDisabled(); ImGui::End();
}
}
