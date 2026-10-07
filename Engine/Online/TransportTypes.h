//============================================================================================================================================
// Frontier/Online/TransportTypes.h — Provider-neutral multiplayer values and events
//============================================================================================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace Frontier::Online {

enum class TransportProvider : std::uint8_t
{
    Eos,
    PhotonRealtime
};

enum class DeliveryMode : std::uint8_t
{
    Reliable,
    Unreliable
};

enum class SessionOperation : std::uint8_t
{
    Create,
    Join,
    Leave
};

enum class OperationStatus : std::uint8_t
{
    Succeeded,
    Failed,
    Cancelled
};

enum class SessionState : std::uint8_t
{
    Offline,
    Ready,
    Connecting,
    InSession,
    Reconnecting,
    Leaving
};

enum class SendResult : std::uint8_t
{
    Queued,
    NotInSession,
    UnknownPeer,
    PayloadTooLarge,
    BackPressure,
    ProviderError
};

// Zero is reserved for "not accepted" when an operation is submitted.
struct OperationId
{
    std::uint64_t Value{};

    [[nodiscard]] constexpr explicit operator bool() const noexcept
    {
        return Value != 0;
    }
};

// Opaque provider-local locator. The provider tag is part of the value so an invite
// cannot silently route an EOS session to Photon (or vice versa).
struct SessionId
{
    TransportProvider Provider{TransportProvider::Eos};
    std::string Value;

    [[nodiscard]] bool IsValid() const noexcept
    {
        return !Value.empty();
    }
};

// Opaque identifier meaningful only to the active transport. It is not a stable
// account identifier and must not be used as the backend's cross-provider identity.
struct PeerId
{
    std::string Value;

    [[nodiscard]] bool IsValid() const noexcept
    {
        return !Value.empty();
    }
};

struct SessionOptions
{
    std::string Name;
    std::uint32_t MaximumPlayers{4};
    bool InviteOnly{false};
};

struct OperationCompletedEvent
{
    OperationId Id{};
    SessionOperation Operation{SessionOperation::Create};
    OperationStatus Status{OperationStatus::Failed};
    std::optional<SessionId> Session;
    std::string Message;
};

struct SessionStateChangedEvent
{
    SessionState State{SessionState::Offline};
};

struct PeerJoinedEvent
{
    PeerId Peer;
};

struct PeerLeftEvent
{
    PeerId Peer;
    std::string Reason;
};

// Received payloads own their bytes; consumers may retain them after PollEvent returns.
struct MessageReceivedEvent
{
    PeerId Sender;
    std::uint8_t Channel{};
    DeliveryMode Delivery{DeliveryMode::Reliable};
    std::vector<std::byte> Payload;
};

struct ProviderErrorEvent
{
    std::string Message;
    bool Recoverable{false};
};

using TransportEvent = std::variant<
    OperationCompletedEvent,
    SessionStateChangedEvent,
    PeerJoinedEvent,
    PeerLeftEvent,
    MessageReceivedEvent,
    ProviderErrorEvent>;

} // namespace Frontier::Online
