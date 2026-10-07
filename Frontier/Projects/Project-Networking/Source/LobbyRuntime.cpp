#include "RoomRuntime.h"
#include <eos_lobby.h>
#include <eos_sessions.h>
#include <eos_rtc.h>
#include <eos_rtc_audio.h>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <ctime>

namespace Networking
{
namespace
{
RoomReading Room;
EOS_HLobby Lobby = nullptr;
EOS_HSessions Sessions = nullptr;
EOS_HRTCAudio Audio = nullptr;
EOS_ProductUserId User = nullptr;
DiagnosticReception Log = nullptr;
std::uintptr_t Generation = 1;
void* Cookie() { return reinterpret_cast<void*>(Generation); }
bool Current(void* C) { return User && C == Cookie(); }
std::vector<EOS_ProductUserId> RealMembers, Registered;
std::array<bool, 3> DummyReady{};
unsigned Dummies = 3;
bool OwnerAttributesDirty = false;
bool Dirty = true, Operation = false, SessionExists = false, WantLeave = false, LobbyLeaveSent = false;
bool PendingMicrophone = false, PendingListening = true;
bool ReadyDesired = false, AttributesDirty = false, AutoArmed = true, MatchRecorded = false;
std::string Name = "You", VoiceRoom, JoinAfterLeave;
std::chrono::steady_clock::time_point LastRefresh{}, MatchClock{};
EOS_NotificationId MemberUpdate = EOS_INVALID_NOTIFICATIONID, MemberStatus = EOS_INVALID_NOTIFICATIONID,
    RoomConnection = EOS_INVALID_NOTIFICATIONID;
constexpr const char* SessionName = "ChargeMatch";
constexpr const char* Bucket = "charge-dev-v1";
void Report(const char* Op, EOS_EResult Result)
{
    std::string Text = std::string(Op) + " result=" + EOS_EResult_ToString(Result);
    if (Log) Log(Text.c_str());
    if (Result != EOS_EResult::EOS_Success) Room.Status = Text;
}
bool Success(const char* Op, EOS_EResult Result)
{ Report(Op, Result); return Result == EOS_EResult::EOS_Success; }
void Refresh();
void Prepare();
void Created();
void ResetDummyReadiness() { DummyReady.fill(false); ReadyDesired = false; AttributesDirty = true; Dirty = true; }
void SaveMatch(const char* Kind)
{
    if (!Room.StartedAt || MatchRecorded) return;
    const auto Duration = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - MatchClock).count();
    RecordHistory(Kind, Room, Duration); MatchRecorded = true;
}
void EOS_CALL Changed(const EOS_Lobby_LobbyMemberUpdateReceivedCallbackInfo* C)
{ if (Current(C->ClientData) && C->LobbyId && Room.LobbyId == C->LobbyId) Dirty = true; }
void EOS_CALL Members(const EOS_Lobby_LobbyMemberStatusReceivedCallbackInfo* C)
{
    if (!Current(C->ClientData) || !C->LobbyId || Room.LobbyId != C->LobbyId) return;
    Dirty = true;
    if (C->TargetUserId == User && (C->CurrentStatus == EOS_ELobbyMemberStatus::EOS_LMS_KICKED ||
        C->CurrentStatus == EOS_ELobbyMemberStatus::EOS_LMS_CLOSED || C->CurrentStatus == EOS_ELobbyMemberStatus::EOS_LMS_DISCONNECTED))
    {
        SaveMatch("abandoned"); Room.VoiceConnected = Room.Microphone = false;
        WantLeave = true; Room.Status = "Removed from lobby; closing local match session";
    }
}
void EOS_CALL VoiceChanged(const EOS_Lobby_RTCRoomConnectionChangedCallbackInfo* C)
{
    if (!Current(C->ClientData) || !C->LobbyId || Room.LobbyId != C->LobbyId || C->LocalUserId != User) return;
    Room.VoiceConnected = C->bIsConnected == EOS_TRUE;
    if (!Room.VoiceConnected) Room.Microphone = false;
    Room.VoiceStatus = Room.VoiceConnected ? "EOS RTC connected • microphone muted initially" :
        std::string("EOS RTC disconnected: ") + EOS_EResult_ToString(C->DisconnectReason);
    if (Log) Log(Room.VoiceConnected ? "rtc=connected; dummy players are not voice participants" : "rtc=disconnected");
    Dirty = true;
}
void Subscribe()
{
    EOS_Lobby_AddNotifyLobbyMemberUpdateReceivedOptions A{}; A.ApiVersion = EOS_LOBBY_ADDNOTIFYLOBBYMEMBERUPDATERECEIVED_API_LATEST;
    MemberUpdate = EOS_Lobby_AddNotifyLobbyMemberUpdateReceived(Lobby, &A, Cookie(), Changed);
    EOS_Lobby_AddNotifyLobbyMemberStatusReceivedOptions B{}; B.ApiVersion = EOS_LOBBY_ADDNOTIFYLOBBYMEMBERSTATUSRECEIVED_API_LATEST;
    MemberStatus = EOS_Lobby_AddNotifyLobbyMemberStatusReceived(Lobby, &B, Cookie(), Members);
    EOS_Lobby_AddNotifyRTCRoomConnectionChangedOptions C{}; C.ApiVersion = EOS_LOBBY_ADDNOTIFYRTCROOMCONNECTIONCHANGED_API_LATEST;
    RoomConnection = EOS_Lobby_AddNotifyRTCRoomConnectionChanged(Lobby, &C, Cookie(), VoiceChanged);
}
void Refresh()
{
    if (!Lobby || Room.LobbyId.empty()) return;
    Dirty = false; LastRefresh = std::chrono::steady_clock::now();
    EOS_Lobby_CopyLobbyDetailsHandleOptions O{};
    O.ApiVersion = EOS_LOBBY_COPYLOBBYDETAILSHANDLE_API_LATEST; O.LobbyId = Room.LobbyId.c_str(); O.LocalUserId = User;
    EOS_HLobbyDetails Details = nullptr;
    if (EOS_Lobby_CopyLobbyDetailsHandle(Lobby, &O, &Details) != EOS_EResult::EOS_Success)
    { Room.Players.clear(); RealMembers.clear(); Room.LocalReady = false; return; }
    EOS_LobbyDetails_GetLobbyOwnerOptions Owner{}; Owner.ApiVersion = EOS_LOBBYDETAILS_GETLOBBYOWNER_API_LATEST;
    Room.Owner = EOS_LobbyDetails_GetLobbyOwner(Details, &Owner) == User;
    EOS_LobbyDetails_GetMemberCountOptions Count{}; Count.ApiVersion = EOS_LOBBYDETAILS_GETMEMBERCOUNT_API_LATEST;
    const uint32_t N = EOS_LobbyDetails_GetMemberCount(Details, &Count);
    Room.Players.clear(); RealMembers.clear(); Room.LocalReady = false;
    for (uint32_t I = 0; I < std::min(N, 8u); ++I)
    {
        EOS_LobbyDetails_GetMemberByIndexOptions Index{}; Index.ApiVersion = EOS_LOBBYDETAILS_GETMEMBERBYINDEX_API_LATEST; Index.MemberIndex = I;
        const auto Id = EOS_LobbyDetails_GetMemberByIndex(Details, &Index);
        if (!Id) continue;
        RealMembers.push_back(Id);
        RoomPlayer Player; Player.Local = Id == User;
        Player.Name = Player.Local ? Name : "EOS player " + std::to_string(I + 1);
        EOS_LobbyDetails_CopyMemberAttributeByKeyOptions Key{};
        Key.ApiVersion = EOS_LOBBYDETAILS_COPYMEMBERATTRIBUTEBYKEY_API_LATEST; Key.TargetUserId = Id; Key.AttrKey = "ready";
        EOS_Lobby_Attribute* Attribute = nullptr;
        if (EOS_LobbyDetails_CopyMemberAttributeByKey(Details, &Key, &Attribute) == EOS_EResult::EOS_Success && Attribute)
        {
            Player.Ready = Attribute->Data && Attribute->Data->ValueType == EOS_ELobbyAttributeType::EOS_AT_BOOLEAN && Attribute->Data->Value.AsBool == EOS_TRUE;
            EOS_Lobby_Attribute_Release(Attribute);
        }
        if (!Player.Local)
        {
            Key.AttrKey = "display_name"; Attribute = nullptr;
            if (EOS_LobbyDetails_CopyMemberAttributeByKey(Details, &Key, &Attribute) == EOS_EResult::EOS_Success && Attribute)
            {
                if (Attribute->Data && Attribute->Data->ValueType == EOS_ELobbyAttributeType::EOS_AT_STRING && Attribute->Data->Value.AsUtf8)
                    Player.Name.assign(Attribute->Data->Value.AsUtf8, std::min<size_t>(64, std::strlen(Attribute->Data->Value.AsUtf8)));
                EOS_Lobby_Attribute_Release(Attribute);
            }
        }
        if (Player.Local) Room.LocalReady = Player.Ready;
        Room.Players.push_back(Player);
    }
    if (!Room.Owner)
    {
        std::string RemoteState;
        for (const char* KeyName : {"session_id", "match_state"})
        {
            EOS_LobbyDetails_CopyAttributeByKeyOptions A{}; A.ApiVersion = EOS_LOBBYDETAILS_COPYATTRIBUTEBYKEY_API_LATEST; A.AttrKey = KeyName;
            EOS_Lobby_Attribute* V = nullptr;
            if (EOS_LobbyDetails_CopyAttributeByKey(Details, &A, &V) == EOS_EResult::EOS_Success && V)
            {
                if (V->Data && V->Data->ValueType == EOS_ELobbyAttributeType::EOS_AT_STRING && V->Data->Value.AsUtf8)
                {
                    if (std::strcmp(KeyName, "session_id") == 0) Room.SessionId = V->Data->Value.AsUtf8;
                    else RemoteState = V->Data->Value.AsUtf8;
                }
                EOS_Lobby_Attribute_Release(V);
            }
        }
        if (!WantLeave && RemoteState == "running" && Room.Phase != RoomPhase::Running)
        {
            OwnerAttributesDirty = true;
    Room.Phase = RoomPhase::Running; MatchClock = std::chrono::steady_clock::now();
            Room.StartedAt = std::time(nullptr); MatchRecorded = false;
            Room.Status = "Host match in progress • session membership managed by host";
        }
        else if (RemoteState == "complete" && Room.Phase == RoomPhase::Running)
        { SaveMatch("completed"); Room.Phase = RoomPhase::Complete; Room.Status = "Host ended the match"; }
        else if (RemoteState == "waiting" && Room.Phase == RoomPhase::Complete)
        { Room.Phase = RoomPhase::Waiting; Room.StartedAt = 0; ReadyDesired = false; AttributesDirty = true; }
    }
    EOS_LobbyDetails_Release(Details);
    for (unsigned I = 0; I < Dummies; ++I)
        Room.Players.push_back({"Test player " + std::to_string(I + 1), DummyReady[I], true, false});
    char Buffer[512]{}; uint32_t Capacity = sizeof(Buffer);
    EOS_Lobby_GetRTCRoomNameOptions R{}; R.ApiVersion = EOS_LOBBY_GETRTCROOMNAME_API_LATEST; R.LobbyId = Room.LobbyId.c_str(); R.LocalUserId = User;
    if (EOS_Lobby_GetRTCRoomName(Lobby, &R, Buffer, &Capacity) == EOS_EResult::EOS_Success) VoiceRoom = Buffer;
    EOS_Lobby_IsRTCRoomConnectedOptions V{}; V.ApiVersion = EOS_LOBBY_ISRTCROOMCONNECTED_API_LATEST; V.LobbyId = Room.LobbyId.c_str(); V.LocalUserId = User;
    EOS_Bool Connected = EOS_FALSE;
    if (EOS_Lobby_IsRTCRoomConnected(Lobby, &V, &Connected) == EOS_EResult::EOS_Success)
    { Room.VoiceConnected = Connected == EOS_TRUE; if (!Room.VoiceConnected) Room.Microphone = false; }
}
void EOS_CALL AttributesDone(const EOS_Lobby_UpdateLobbyCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Room.ReadyPending = false; Dirty = true;
    if (!Success("lobby_member_update", C->ResultCode)) { ReadyDesired = Room.LocalReady; AttributesDirty = false; AutoArmed = false; }
}
void PublishAttributes()
{
    if (!Lobby || Room.LobbyId.empty() || Room.ReadyPending || (!AttributesDirty && !OwnerAttributesDirty) || WantLeave) return;
    EOS_Lobby_UpdateLobbyModificationOptions O{};
    O.ApiVersion = EOS_LOBBY_UPDATELOBBYMODIFICATION_API_LATEST; O.LocalUserId = User; O.LobbyId = Room.LobbyId.c_str();
    EOS_HLobbyModification Modification = nullptr;
    if (!Success("lobby_modify", EOS_Lobby_UpdateLobbyModification(Lobby, &O, &Modification))) { AttributesDirty = false; return; }
    EOS_Lobby_AttributeData D{}; D.ApiVersion = EOS_LOBBY_ATTRIBUTEDATA_API_LATEST; D.Key = "ready";
    D.ValueType = EOS_ELobbyAttributeType::EOS_AT_BOOLEAN; D.Value.AsBool = ReadyDesired ? EOS_TRUE : EOS_FALSE;
    EOS_LobbyModification_AddMemberAttributeOptions A{}; A.ApiVersion = EOS_LOBBYMODIFICATION_ADDMEMBERATTRIBUTE_API_LATEST;
    A.Attribute = &D; A.Visibility = EOS_ELobbyAttributeVisibility::EOS_LAT_PUBLIC;
    auto Result = EOS_LobbyModification_AddMemberAttribute(Modification, &A);
    if (Result == EOS_EResult::EOS_Success)
    {
        D.Key = "display_name"; D.ValueType = EOS_ELobbyAttributeType::EOS_AT_STRING; D.Value.AsUtf8 = Name.c_str();
        Result = EOS_LobbyModification_AddMemberAttribute(Modification, &A);
    }
    if (Result == EOS_EResult::EOS_Success && Room.Owner && OwnerAttributesDirty)
    {
        EOS_LobbyModification_AddAttributeOptions A{}; A.ApiVersion = EOS_LOBBYMODIFICATION_ADDATTRIBUTE_API_LATEST;
        A.Attribute = &D; A.Visibility = EOS_ELobbyAttributeVisibility::EOS_LAT_PUBLIC;
        D.Key = "session_id"; D.ValueType = EOS_ELobbyAttributeType::EOS_AT_STRING; D.Value.AsUtf8 = Room.SessionId.c_str();
        Result = EOS_LobbyModification_AddAttribute(Modification, &A);
        D.Key = "match_state"; D.Value.AsUtf8 = Room.Phase == RoomPhase::Running ? "running" : Room.Phase == RoomPhase::Complete ? "complete" : "waiting";
        if (Result == EOS_EResult::EOS_Success) Result = EOS_LobbyModification_AddAttribute(Modification, &A);
    }
    AttributesDirty = false; OwnerAttributesDirty = false;
    if (Success("lobby_attributes", Result))
    {
        EOS_Lobby_UpdateLobbyOptions U{}; U.ApiVersion = EOS_LOBBY_UPDATELOBBY_API_LATEST; U.LobbyModificationHandle = Modification;
        Room.ReadyPending = true; EOS_Lobby_UpdateLobby(Lobby, &U, Cookie(), AttributesDone);
    }
    EOS_LobbyModification_Release(Modification);
}
void EOS_CALL Prepared(const EOS_Sessions_UpdateSessionCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("session_create", C->ResultCode)) { Room.Phase = RoomPhase::Failed; AutoArmed = false; return; }
    OwnerAttributesDirty = true;
    SessionExists = true; Room.SessionId = C->SessionId ? C->SessionId : "";
    Room.Phase = RoomPhase::Waiting; Room.Status = "Lobby open • match session prepared";
    RecordHistory("session", Room);
}
void Prepare()
{
    if (!User || !Sessions || !Room.Owner || SessionExists || Operation || WantLeave) return;
    Room.Phase = RoomPhase::Preparing;
    EOS_Sessions_CreateSessionModificationOptions O{};
    O.ApiVersion = EOS_SESSIONS_CREATESESSIONMODIFICATION_API_LATEST; O.SessionName = SessionName;
    O.BucketId = Bucket; O.MaxPlayers = 8; O.LocalUserId = User; O.bPresenceEnabled = EOS_FALSE;
    EOS_HSessionModification M = nullptr;
    if (!Success("session_prepare", EOS_Sessions_CreateSessionModification(Sessions, &O, &M))) { Room.Phase = RoomPhase::Failed; return; }
    EOS_SessionModification_SetPermissionLevelOptions P{}; P.ApiVersion = EOS_SESSIONMODIFICATION_SETPERMISSIONLEVEL_API_LATEST;
    P.PermissionLevel = EOS_EOnlineSessionPermissionLevel::EOS_OSPF_InviteOnly;
    auto Result = EOS_SessionModification_SetPermissionLevel(M, &P);
    EOS_SessionModification_SetJoinInProgressAllowedOptions J{}; J.ApiVersion = EOS_SESSIONMODIFICATION_SETJOININPROGRESSALLOWED_API_LATEST;
    J.bAllowJoinInProgress = EOS_FALSE;
    if (Result == EOS_EResult::EOS_Success) Result = EOS_SessionModification_SetJoinInProgressAllowed(M, &J);
    if (Success("session_options", Result))
    {
        EOS_Sessions_UpdateSessionOptions U{}; U.ApiVersion = EOS_SESSIONS_UPDATESESSION_API_LATEST; U.SessionModificationHandle = M;
        Operation = true; EOS_Sessions_UpdateSession(Sessions, &U, Cookie(), Prepared);
    }
    else Room.Phase = RoomPhase::Failed;
    EOS_SessionModification_Release(M);
}
void Created()
{
    Dirty = true; AttributesDirty = true; ReadyDesired = false; AutoArmed = true;
    Room.Status = "Lobby created • joining EOS voice muted"; Room.Phase = RoomPhase::Waiting;
    Refresh(); Prepare();
}
void EOS_CALL LobbyCreated(const EOS_Lobby_CreateLobbyCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("lobby_create", C->ResultCode)) { Room.Phase = RoomPhase::Failed; return; }
    Room.LobbyId = C->LobbyId; Created();
}
void EOS_CALL Joined(const EOS_Lobby_JoinLobbyByIdCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("lobby_join", C->ResultCode)) { Room.Phase = RoomPhase::Failed; return; }
    Room.LobbyId = C->LobbyId; Dummies = 0; Created();
}
void EOS_CALL Started(const EOS_Sessions_StartSessionCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("session_start", C->ResultCode)) { Room.Phase = RoomPhase::Failed; AutoArmed = false; return; }
    OwnerAttributesDirty = true;
    Room.Phase = RoomPhase::Running; MatchClock = std::chrono::steady_clock::now();
    Room.StartedAt = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()); MatchRecorded = false;
    Room.Status = "EOS match session in progress • lifecycle test, no gameplay simulation";
    Refresh();
    if (WantLeave || !EveryoneReady(Room) || RealMembers != Registered) EndRoomMatch();
}
void EOS_CALL RegisteredPlayers(const EOS_Sessions_RegisterPlayersCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("session_register_real_players", C->ResultCode)) { Room.Phase = RoomPhase::Failed; AutoArmed = false; return; }
    Refresh();
    if (WantLeave || !EveryoneReady(Room) || RealMembers != Registered)
    { Room.Phase = RoomPhase::Failed; AutoArmed = false; Room.Status = "Readiness or membership changed. Start cancelled."; return; }
    EOS_Sessions_StartSessionOptions O{}; O.ApiVersion = EOS_SESSIONS_STARTSESSION_API_LATEST; O.SessionName = SessionName;
    Operation = true; EOS_Sessions_StartSession(Sessions, &O, Cookie(), Started);
}
void EOS_CALL Ended(const EOS_Sessions_EndSessionCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("session_end", C->ResultCode)) { Room.Phase = RoomPhase::Running; AutoArmed = false; return; }
    SaveMatch(WantLeave ? "abandoned" : "completed");
    OwnerAttributesDirty = true;
    Room.Phase = RoomPhase::Complete; Room.Status = "Match ended • history queued for EOS cloud sync";
    ResetDummyReadiness();
}
void EOS_CALL DestroyedSession(const EOS_Sessions_DestroySessionCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Operation = false;
    if (!Success("session_destroy", C->ResultCode)) { Room.Phase = RoomPhase::Failed; return; }
    SessionExists = false; Room.SessionId.clear(); Registered.clear(); Room.StartedAt = 0;
    if (!WantLeave) { ResetDummyReadiness(); AutoArmed = true; Prepare(); }
}
void FinishLeave(EOS_EResult Result)
{
    Operation = false; LobbyLeaveSent = false;
    if (Result != EOS_EResult::EOS_Success && Result != EOS_EResult::EOS_NotFound)
    { Report("lobby_leave", Result); WantLeave = false; Room.Phase = RoomPhase::Failed; return; }
    Room.LobbyId.clear(); Room.Players.clear(); RealMembers.clear(); VoiceRoom.clear();
    Room.VoiceConnected = Room.Microphone = false; Room.Owner = false; Room.Phase = RoomPhase::Offline;
    Room.Status = "Lobby closed"; WantLeave = false;
    if (!JoinAfterLeave.empty()) { auto Id = JoinAfterLeave; JoinAfterLeave.clear(); JoinRoom(Id.c_str()); }
}
void EOS_CALL DestroyedLobby(const EOS_Lobby_DestroyLobbyCallbackInfo* C) { if (Current(C->ClientData)) FinishLeave(C->ResultCode); }
void EOS_CALL LeftLobby(const EOS_Lobby_LeaveLobbyCallbackInfo* C) { if (Current(C->ClientData)) FinishLeave(C->ResultCode); }
void EOS_CALL Sending(const EOS_RTCAudio_UpdateSendingCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Room.VoicePending = false;
    const bool Ok = Success("rtc_sending", C->ResultCode);
    if (Ok) Room.Microphone = PendingMicrophone;
    Room.VoiceStatus = Ok ? (Room.Microphone ? "Microphone on • EOS RTC" : "Microphone muted • EOS RTC") : "Microphone update failed";
}
void EOS_CALL Receiving(const EOS_RTCAudio_UpdateReceivingCallbackInfo* C)
{
    if (!Current(C->ClientData)) return;
    Room.VoicePending = false;
    if (Success("rtc_receiving", C->ResultCode)) Room.Listening = PendingListening;
    else Room.VoiceStatus = "Speaker update failed; previous state retained";
}
}
const RoomReading& InspectRoom() noexcept { return Room; }
bool RoomIsClosed() noexcept { return !Operation && !SessionExists && Room.LobbyId.empty(); }
void BindRoomRuntime(EOS_HPlatform Platform, EOS_ProductUserId LocalUser, DiagnosticReception Reception,
    const std::filesystem::path& Root, bool CloudEnabled)
{
    DetachRoomRuntime();
    User = LocalUser; Log = Reception; Lobby = EOS_Platform_GetLobbyInterface(Platform); Sessions = EOS_Platform_GetSessionsInterface(Platform);
    auto Rtc = EOS_Platform_GetRTCInterface(Platform); Audio = Rtc ? EOS_RTC_GetAudioInterface(Rtc) : nullptr;
    BindHistory(Platform, User, Log, Root, CloudEnabled); RecordHistory("login", Room);
    if (!Lobby || !Sessions) { Room.Phase = RoomPhase::Failed; Room.Status = "EOS lobby/session interfaces unavailable"; return; }
    Subscribe(); CreateRoom();
}
bool CreateRoom()
{
    if (!Lobby || !User || Operation || !Room.LobbyId.empty() || SessionExists) return false;
    WantLeave = false; AutoArmed = true; ResetDummyReadiness();
    Room.Phase = RoomPhase::Creating; Room.Status = "Creating EOS lobby and voice room...";
    EOS_Lobby_LocalRTCOptions R{}; R.ApiVersion = EOS_LOBBY_LOCALRTCOPTIONS_API_LATEST; R.bLocalAudioDeviceInputStartsMuted = EOS_TRUE;
    EOS_Lobby_CreateLobbyOptions O{}; O.ApiVersion = EOS_LOBBY_CREATELOBBY_API_LATEST; O.LocalUserId = User;
    O.MaxLobbyMembers = 8; O.PermissionLevel = EOS_ELobbyPermissionLevel::EOS_LPL_JOINVIAPRESENCE;
    O.bPresenceEnabled = EOS_TRUE; O.bAllowInvites = EOS_TRUE; O.BucketId = Bucket;
    O.bDisableHostMigration = EOS_TRUE; O.bEnableRTCRoom = EOS_TRUE; O.LocalRTCOptions = &R; O.bEnableJoinById = EOS_TRUE;
    O.bRejoinAfterKickRequiresInvite = EOS_TRUE;
    O.RTCRoomJoinActionType = EOS_ELobbyRTCRoomJoinActionType::EOS_LRRJAT_AutomaticJoin;
    Operation = true; EOS_Lobby_CreateLobby(Lobby, &O, Cookie(), LobbyCreated); return true;
}
bool JoinRoom(const char* Id)
{
    if (!Lobby || !Id || !*Id || std::strlen(Id) > 128 || Operation || Room.Phase == RoomPhase::Running || Room.Phase == RoomPhase::Starting) return false;
    if (!RoomIsClosed()) { JoinAfterLeave = Id; LeaveRoom(); return true; }
    EOS_Lobby_LocalRTCOptions R{}; R.ApiVersion = EOS_LOBBY_LOCALRTCOPTIONS_API_LATEST; R.bLocalAudioDeviceInputStartsMuted = EOS_TRUE;
    EOS_Lobby_JoinLobbyByIdOptions O{}; O.ApiVersion = EOS_LOBBY_JOINLOBBYBYID_API_LATEST;
    O.LobbyId = Id; O.LocalUserId = User; O.bPresenceEnabled = EOS_TRUE; O.LocalRTCOptions = &R;
    O.RTCRoomJoinActionType = EOS_ELobbyRTCRoomJoinActionType::EOS_LRRJAT_AutomaticJoin;
    Operation = true; Room.Phase = RoomPhase::Creating; EOS_Lobby_JoinLobbyById(Lobby, &O, Cookie(), Joined); return true;
}
bool SetRoomReady(bool Ready)
{
    if (Room.Phase != RoomPhase::Waiting || Room.ReadyPending || Operation || !User || WantLeave) return false;
    ReadyDesired = Ready; AttributesDirty = true; AutoArmed = true; PublishAttributes(); return true;
}
void SetRoomDisplayName(const char* Value) { Name = Value && *Value ? Value : "You"; if (Name.size() > 64) Name.resize(64); AttributesDirty = true; Dirty = true; }
void SetDummyCount(unsigned Count)
{ if (Room.Phase == RoomPhase::Waiting && Room.Owner) { Dummies = std::min(Count, 3u); DummyReady.fill(false); Dirty = true; AutoArmed = true; } }
void SetDummyReady(unsigned Index, bool Ready)
{ if (Room.Phase == RoomPhase::Waiting && Room.Owner && Index < Dummies) { DummyReady[Index] = Ready; Dirty = true; AutoArmed = true; } }
void SetAutoStart(bool Enabled) { Room.AutoStart = Enabled; AutoArmed = true; }
bool StartRoomMatch()
{
    if (!Sessions || !SessionExists || Operation || Room.ReadyPending || AttributesDirty || WantLeave || Room.Phase != RoomPhase::Waiting || !Room.Owner) return false;
    Refresh(); if (!EveryoneReady(Room) || RealMembers.empty()) return false;
    Registered = RealMembers; Room.Phase = RoomPhase::Starting; Room.Status = "Registering real EOS members and starting match...";
    EOS_Sessions_RegisterPlayersOptions O{}; O.ApiVersion = EOS_SESSIONS_REGISTERPLAYERS_API_LATEST;
    O.SessionName = SessionName; O.PlayersToRegister = Registered.data(); O.PlayersToRegisterCount = static_cast<uint32_t>(Registered.size());
    Operation = true; AutoArmed = false; EOS_Sessions_RegisterPlayers(Sessions, &O, Cookie(), RegisteredPlayers); return true;
}
bool EndRoomMatch()
{
    if (!Sessions || !Room.Owner || !SessionExists || Operation || Room.Phase != RoomPhase::Running) return false;
    Room.Phase = RoomPhase::Ending; Operation = true;
    EOS_Sessions_EndSessionOptions O{}; O.ApiVersion = EOS_SESSIONS_ENDSESSION_API_LATEST; O.SessionName = SessionName;
    EOS_Sessions_EndSession(Sessions, &O, Cookie(), Ended); return true;
}
bool PrepareNextMatch()
{
    if (!Sessions || !Room.Owner || Operation || WantLeave || (Room.Phase != RoomPhase::Complete && Room.Phase != RoomPhase::Failed)) return false;
    if (!SessionExists) { Prepare(); return true; }
    EOS_Sessions_DestroySessionOptions O{}; O.ApiVersion = EOS_SESSIONS_DESTROYSESSION_API_LATEST; O.SessionName = SessionName;
    Operation = true; EOS_Sessions_DestroySession(Sessions, &O, Cookie(), DestroyedSession); return true;
}
bool SetRoomMicrophone(bool Enabled)
{
    if (!Audio || !Room.VoiceConnected || VoiceRoom.empty() || Room.VoicePending || WantLeave) return false;
    EOS_RTCAudio_UpdateSendingOptions O{}; O.ApiVersion = EOS_RTCAUDIO_UPDATESENDING_API_LATEST;
    O.LocalUserId = User; O.RoomName = VoiceRoom.c_str();
    O.AudioStatus = Enabled ? EOS_ERTCAudioStatus::EOS_RTCAS_Enabled : EOS_ERTCAudioStatus::EOS_RTCAS_Disabled;
    PendingMicrophone = Enabled; Room.VoicePending = true; EOS_RTCAudio_UpdateSending(Audio, &O, Cookie(), Sending); return true;
}
bool SetRoomListening(bool Enabled)
{
    if (!Audio || !Room.VoiceConnected || VoiceRoom.empty() || Room.VoicePending || WantLeave) return false;
    EOS_RTCAudio_UpdateReceivingOptions O{}; O.ApiVersion = EOS_RTCAUDIO_UPDATERECEIVING_API_LATEST;
    O.LocalUserId = User; O.RoomName = VoiceRoom.c_str(); O.bAudioEnabled = Enabled ? EOS_TRUE : EOS_FALSE;
    PendingListening = Enabled; Room.VoicePending = true; EOS_RTCAudio_UpdateReceiving(Audio, &O, Cookie(), Receiving); return true;
}
void LeaveRoom() { if (!User) return; WantLeave = true; AutoArmed = false; }
void TickRoomRuntime()
{
    TickHistory();
    if (!User) return;
    if (Dirty || std::chrono::steady_clock::now() - LastRefresh > std::chrono::seconds(1)) Refresh();
    if (WantLeave && !Operation && !Room.ReadyPending)
    {
        if (Room.Phase == RoomPhase::Running && Room.Owner && SessionExists) { EndRoomMatch(); return; }
        if (Room.Phase == RoomPhase::Running) SaveMatch("abandoned");
        if (SessionExists)
        {
            SaveMatch("abandoned"); Room.Phase = RoomPhase::Leaving;
            EOS_Sessions_DestroySessionOptions O{}; O.ApiVersion = EOS_SESSIONS_DESTROYSESSION_API_LATEST; O.SessionName = SessionName;
            Operation = true; EOS_Sessions_DestroySession(Sessions, &O, Cookie(), DestroyedSession); return;
        }
        if (!Room.LobbyId.empty() && !LobbyLeaveSent)
        {
            Room.Phase = RoomPhase::Leaving; Operation = LobbyLeaveSent = true;
            if (Room.Owner)
            {
                EOS_Lobby_DestroyLobbyOptions O{}; O.ApiVersion = EOS_LOBBY_DESTROYLOBBY_API_LATEST;
                O.LocalUserId = User; O.LobbyId = Room.LobbyId.c_str(); EOS_Lobby_DestroyLobby(Lobby, &O, Cookie(), DestroyedLobby);
            }
            else
            {
                EOS_Lobby_LeaveLobbyOptions O{}; O.ApiVersion = EOS_LOBBY_LEAVELOBBY_API_LATEST;
                O.LocalUserId = User; O.LobbyId = Room.LobbyId.c_str(); EOS_Lobby_LeaveLobby(Lobby, &O, Cookie(), LeftLobby);
            }
            return;
        }
    }
    if (!WantLeave) PublishAttributes();
    if (!WantLeave && Room.Phase == RoomPhase::Waiting)
    {
        if (Room.AutoStart && AutoArmed && Room.Owner && !Room.ReadyPending && !AttributesDirty && EveryoneReady(Room)) StartRoomMatch();
    }
}
void DetachRoomRuntime()
{
    SaveMatch("abandoned"); ++Generation;
    if (Lobby)
    {
        if (MemberUpdate != EOS_INVALID_NOTIFICATIONID) EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived(Lobby, MemberUpdate);
        if (MemberStatus != EOS_INVALID_NOTIFICATIONID) EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived(Lobby, MemberStatus);
        if (RoomConnection != EOS_INVALID_NOTIFICATIONID) EOS_Lobby_RemoveNotifyRTCRoomConnectionChanged(Lobby, RoomConnection);
    }
    MemberUpdate = MemberStatus = RoomConnection = EOS_INVALID_NOTIFICATIONID;
    DetachHistory(); Room = {}; Lobby = nullptr; Sessions = nullptr; Audio = nullptr; User = nullptr; Log = nullptr;
    RealMembers.clear(); Registered.clear(); VoiceRoom.clear(); JoinAfterLeave.clear(); Name = "You";
    OwnerAttributesDirty = false;
    Dirty = true; Operation = SessionExists = WantLeave = LobbyLeaveSent = false;
    ReadyDesired = AttributesDirty = MatchRecorded = false; AutoArmed = true; Dummies = 3; DummyReady.fill(false);
}
}
