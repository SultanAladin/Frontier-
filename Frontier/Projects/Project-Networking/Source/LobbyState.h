#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Networking
{
enum class RoomPhase { Offline, Creating, Waiting, Preparing, Starting, Running, Ending, Complete, Leaving, Failed };

// Permission levels mirror EOS enums but stay SDK-independent for deterministic checks.
enum class LobbyPermission { PublicAdvertised = 0, JoinViaPresence = 1, InviteOnly = 2 };
enum class SessionPermission { PublicAdvertised = 0, JoinViaPresence = 1, InviteOnly = 2 };

struct LobbyCreationSettings
{
    unsigned MaxMembers = 8;
    std::string BucketId = "charge-dev-v1";
    LobbyPermission Permission = LobbyPermission::JoinViaPresence;
    bool PresenceEnabled = true;
    bool AllowInvites = true;
    bool EnableRtcRoom = true;
    bool DisableHostMigration = true;
    bool EnableJoinById = true;
    bool RejoinAfterKickRequiresInvite = true;
    bool RtcAutoJoin = true;
    // Custom searchable lobby attributes (host-editable, published as public attributes).
    std::string MapName = "dev-arena";
    std::string ModeName = "lobby-lab";
    std::string Region = "auto";
    std::string Note;
};

struct MatchSessionSettings
{
    std::string SessionName = "ChargeMatch";
    std::string BucketId = "charge-dev-v1";
    unsigned MaxPlayers = 8;
    SessionPermission Permission = SessionPermission::InviteOnly;
    bool JoinInProgressAllowed = false;
    bool PresenceEnabled = false;
    bool SanctionsEnabled = false;
    std::string MapName = "dev-arena";
    std::string ModeName = "lobby-lab";
};

struct RoomPlayer { std::string Name; bool Ready = false; bool Dummy = false; bool Local = false; };

struct LobbySearchResult
{
    std::string LobbyId;
    std::string BucketId;
    std::string MapName;
    std::string ModeName;
    std::string OwnerLabel; // never a raw PUID; display-safe only
    unsigned Members = 0;
    unsigned MaxMembers = 0;
    int Permission = 1;
    bool RtcEnabled = false;
};

struct SessionSearchResult
{
    std::string SessionId;
    std::string BucketId;
    std::string MapName;
    std::string ModeName;
    unsigned OpenConnections = 0;
    unsigned MaxConnections = 0;
    int Permission = 2;
    bool JoinInProgress = false;
};

struct SearchReading
{
    std::vector<LobbySearchResult> Lobbies;
    std::vector<SessionSearchResult> Sessions;
    std::string LobbyStatus = "No lobby search yet.";
    std::string SessionStatus = "No session search yet.";
    std::string LobbyFilter;
    std::string SessionFilter;
    bool LobbyBusy = false;
    bool SessionBusy = false;
};

struct RoomReading
{
    RoomPhase Phase = RoomPhase::Offline;
    std::string LobbyId, SessionId;
    std::string Status = "Sign in to create your lobby.";
    std::vector<RoomPlayer> Players;
    bool Owner = false, LocalReady = false, ReadyPending = false;
    bool VoiceConnected = false, Microphone = false, Listening = true, VoicePending = false;
    bool AutoStart = true;
    std::string VoiceStatus = "Voice offline";
    std::int64_t StartedAt = 0;
    // True match-session state, separated from the lobby lifecycle.
    std::string SessionStatus = "No match session.";
    bool SessionExists = false;
    bool SessionJoined = false; // true when this client joined someone else's session
    bool SessionOwner = false;
    bool SessionBusy = false;
    bool SessionWithoutRegistration = false; // set when RegisterPlayers failed on policy
    unsigned SessionRegistered = 0;
    LobbyCreationSettings LobbySettings;
    MatchSessionSettings SessionSettings;
    SearchReading Search;
};

struct HistoryRecord
{
    std::string Id, Kind, Lobby, Session;
    std::int64_t Utc = 0, Duration = 0;
    unsigned RealPlayers = 0, DummyPlayers = 0;
};
struct HistoryReading
{
    std::vector<HistoryRecord> Records;
    std::string Status = "Cloud sync requires the private data key.";
    bool Busy = false, Enabled = false;
    unsigned Pending = 0;
};
inline bool EveryoneReady(const RoomReading& Room)
{
    if (Room.Players.empty()) return false;
    bool Real = false;
    for (const auto& Player : Room.Players) { if (!Player.Ready) return false; Real |= !Player.Dummy; }
    return Real;
}
// Deterministic validation used by both the UI and VisualProof checks (no EOS calls).
inline bool ValidBucketId(const std::string& Value)
{
    if (Value.empty() || Value.size() > 64) return false;
    for (unsigned char C : Value)
    {
        const bool Ok = (C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') ||
            (C >= '0' && C <= '9') || C == '-' || C == '_' || C == ':' || C == '.';
        if (!Ok) return false;
    }
    return true;
}
inline bool ValidSessionName(const std::string& Value)
{
    if (Value.empty() || Value.size() > 32) return false;
    for (unsigned char C : Value)
    {
        const bool Ok = (C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') ||
            (C >= '0' && C <= '9') || C == '-' || C == '_';
        if (!Ok) return false;
    }
    return true;
}
inline bool ValidLobbyAttribute(const std::string& Value)
{
    if (Value.size() > 64) return false;
    for (unsigned char C : Value) if (C < 32 || C >= 127) return false;
    return true;
}
inline const char* LobbyPermissionLabel(LobbyPermission P) noexcept
{
    switch (P)
    {
    case LobbyPermission::PublicAdvertised: return "Public advertised";
    case LobbyPermission::JoinViaPresence: return "Join via presence";
    case LobbyPermission::InviteOnly: return "Invite only";
    }
    return "Unknown";
}
inline const char* SessionPermissionLabel(SessionPermission P) noexcept
{
    switch (P)
    {
    case SessionPermission::PublicAdvertised: return "Public advertised";
    case SessionPermission::JoinViaPresence: return "Join via presence";
    case SessionPermission::InviteOnly: return "Invite only";
    }
    return "Unknown";
}
inline bool MatchesFilter(const std::string& Haystack, const std::string& Needle)
{
    if (Needle.empty()) return true;
    if (Haystack.size() < Needle.size()) return false;
    for (size_t I = 0; I + Needle.size() <= Haystack.size(); ++I)
    {
        bool Same = true;
        for (size_t J = 0; J < Needle.size(); ++J)
        {
            const char A = Haystack[I + J], B = Needle[J];
            const char LowerA = (A >= 'A' && A <= 'Z') ? static_cast<char>(A + 32) : A;
            const char LowerB = (B >= 'A' && B <= 'Z') ? static_cast<char>(B + 32) : B;
            if (LowerA != LowerB) { Same = false; break; }
        }
        if (Same) return true;
    }
    return false;
}
inline bool LobbyMatchesFilter(const LobbySearchResult& R, const std::string& Filter)
{
    if (Filter.empty()) return true;
    return MatchesFilter(R.LobbyId, Filter) || MatchesFilter(R.BucketId, Filter) ||
        MatchesFilter(R.MapName, Filter) || MatchesFilter(R.ModeName, Filter);
}
inline bool SessionMatchesFilter(const SessionSearchResult& R, const std::string& Filter)
{
    if (Filter.empty()) return true;
    return MatchesFilter(R.SessionId, Filter) || MatchesFilter(R.BucketId, Filter) ||
        MatchesFilter(R.MapName, Filter) || MatchesFilter(R.ModeName, Filter);
}
const RoomReading& InspectRoom() noexcept;
const HistoryReading& InspectHistory() noexcept;
bool CreateRoom();
bool JoinRoom(const char* LobbyId);
bool SetRoomReady(bool Ready);
void SetDummyCount(unsigned Count);
void SetDummyReady(unsigned Index, bool Ready);
void SetAutoStart(bool Enabled);
bool StartRoomMatch();
bool EndRoomMatch();
bool PrepareNextMatch();
bool SetRoomMicrophone(bool Enabled);
bool SetRoomListening(bool Enabled);
void RetryCloudSync();
void LeaveRoom();
// New: explicit match-session + search + settings APIs.
bool ApplyLobbySettings(const LobbyCreationSettings& Settings);
bool ApplySessionSettings(const MatchSessionSettings& Settings);
bool UpdateLobbyLiveSettings();
bool RefreshLobbySearch(const char* Filter);
bool RefreshSessionSearch(const char* Filter);
bool JoinLobbyResult(size_t Index);
bool JoinSessionResult(size_t Index);
bool JoinMatchSession(); // member joins the host session after lobby join
bool LeaveMatchSession();
bool RoomIsClosed() noexcept;
}
