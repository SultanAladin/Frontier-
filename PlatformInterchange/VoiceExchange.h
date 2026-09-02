//============================================================================================================================================
// 📦 Frontier/PlatformInterchange/VoiceExchange.h — WebRTC 3D Positional Voice Room Routing and Audio Streaming
//============================================================================================================================================

#pragma once

#include "../DeviceExchange/OrientationClassifier.h"
#include <string>
#include <vector>
#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                 VOICE PARTICIPANT
//------------------------------------------------------------------------------------------------------------------------

struct VoiceParticipant
{
    uint64_t                AccountIdentifier;                  // [token] unique peer account identifier
    Vector3                 SpatialLocation;                    // [m] position in continuous 3D world
    bool                    SpeakingCondition;                  // [bool] true when transmitting microphone audio
    bool                    MutedCondition;                     // [bool] true when local participant is muted
    float                   VolumeMultiplier;                   // [0..1] peer volume scaling
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    VOICE EXCHANGE
//------------------------------------------------------------------------------------------------------------------------

class VoiceExchange
{
public:
    VoiceExchange() noexcept;
    ~VoiceExchange() noexcept = default;

    VoiceExchange(const VoiceExchange&) = delete;
    VoiceExchange& operator=(const VoiceExchange&) = delete;

    [[nodiscard]] bool      JoinRoom(std::string_view RoomNameToken) noexcept;
    void                    LeaveRoom() noexcept;

    void                    AssignLocalTransform(const Vector3& Position, const Vector3& Forward) noexcept;
    void                    AssignMuted(bool Muted) noexcept;

    void                    RegisterPeer(uint64_t AccountId, const Vector3& InitialPosition) noexcept;
    void                    UnregisterPeer(uint64_t AccountId) noexcept;

    [[nodiscard]] size_t    QueryParticipantCount() const noexcept;

    // Single unified conversion operator for participant count
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    std::string             ActiveRoomName;                     // [name] current active voice room
    Vector3                 LocalPosition;                      // [m] local speaker position
    Vector3                 LocalForward;                       // [-] local speaker forward vector
    bool                    LocalMuted;                         // [bool] local microphone mute status
    std::vector<VoiceParticipant> Participants;                 // [peers] active room participants
};

template<>
inline size_t VoiceExchange::Convert<size_t>() const noexcept
{
    return QueryParticipantCount();
}

} // namespace Frontier
