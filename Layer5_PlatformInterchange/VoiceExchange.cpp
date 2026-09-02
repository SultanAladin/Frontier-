//============================================================================================================================================
// 📦 Frontier/Layer5_PlatformInterchange/VoiceExchange.cpp — Positional Voice Room Routing Implementation
//============================================================================================================================================

#include "VoiceExchange.h"
#include <algorithm>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

VoiceExchange::VoiceExchange() noexcept
    : m_LocalPosition{ 0.0f, 0.0f, 0.0f }
    , m_LocalForward{ 0.0f, 0.0f, -1.0f }
    , m_LocalMuted(false)
{
    m_Participants.reserve(32);
}

bool VoiceExchange::JoinRoom(std::string_view RoomNameToken) noexcept
{
    m_ActiveRoomName = RoomNameToken;
    return true;
}

void VoiceExchange::LeaveRoom() noexcept
{
    m_ActiveRoomName.clear();
    m_Participants.clear();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                PARTICIPANT MANAGEMENT
//------------------------------------------------------------------------------------------------------------------------

void VoiceExchange::UpdateLocalTransform(const Vector3& Position, const Vector3& Forward) noexcept
{
    m_LocalPosition = Position;
    m_LocalForward = Forward.Normalized();
}

void VoiceExchange::SetMuted(bool Muted) noexcept
{
    m_LocalMuted = Muted;
}

void VoiceExchange::RegisterPeer(uint64_t AccountId, const Vector3& InitialPosition) noexcept
{
    VoiceParticipant Peer{};
    Peer.AccountIdentifier  = AccountId;
    Peer.SpatialLocation    = InitialPosition;
    Peer.SpeakingCondition  = false;
    Peer.MutedCondition     = false;
    Peer.VolumeMultiplier   = 1.0f;

    m_Participants.push_back(Peer);
}

void VoiceExchange::UnregisterPeer(uint64_t AccountId) noexcept
{
    auto iterator = std::remove_if(m_Participants.begin(), m_Participants.end(),
        [AccountId](const VoiceParticipant& p) { return p.AccountIdentifier == AccountId; });
    m_Participants.erase(iterator, m_Participants.end());
}

size_t VoiceExchange::QueryParticipantCount() const noexcept
{
    return m_Participants.size();
}

} // namespace Frontier
