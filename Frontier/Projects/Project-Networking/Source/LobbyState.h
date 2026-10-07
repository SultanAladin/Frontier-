#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Networking
{
enum class RoomPhase { Offline, Creating, Waiting, Preparing, Starting, Running, Ending, Complete, Leaving, Failed };
struct RoomPlayer { std::string Name; bool Ready = false; bool Dummy = false; bool Local = false; };
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
    for (const auto& Player : Room.Players) if (!Player.Ready) return false;
    return true;
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
bool RoomIsClosed() noexcept;
}
