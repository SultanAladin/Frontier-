#include "Online/IMultiplayerTransport.h"

#include <array>
#include <cassert>
#include <deque>
#include <string>
#include <utility>
#include <vector>

namespace {

using namespace Frontier::Online;

class ContractProbe final : public IMultiplayerTransport
{
public:
    [[nodiscard]] TransportProvider QueryProvider() const noexcept override
    {
        return TransportProvider::Eos;
    }

    bool Initialize(std::string& Error) override
    {
        Error.clear();
        Initialized = true;
        return true;
    }

    void Shutdown() noexcept override
    {
        Initialized = false;
        InSession = false;
    }

    void Tick(double DeltaSeconds) override
    {
        LastDeltaSeconds = DeltaSeconds;
    }

    [[nodiscard]] OperationId CreateSession(const SessionOptions&) override
    {
        return Initialized ? NextOperation() : OperationId{};
    }

    [[nodiscard]] OperationId JoinSession(const SessionId& Session) override
    {
        if (!Initialized || !Session.IsValid() || Session.Provider != QueryProvider())
        {
            return {};
        }
        InSession = true;
        return NextOperation();
    }

    [[nodiscard]] OperationId LeaveSession() override
    {
        if (!Initialized || !InSession)
        {
            return {};
        }
        InSession = false;
        return NextOperation();
    }

    [[nodiscard]] SendResult SendReliable(
        const PeerId& Recipient,
        std::uint8_t Channel,
        std::span<const std::byte> Payload) override
    {
        return RecordSend(Recipient, Channel, Payload);
    }

    [[nodiscard]] SendResult SendUnreliable(
        const PeerId& Recipient,
        std::uint8_t Channel,
        std::span<const std::byte> Payload) override
    {
        return RecordSend(Recipient, Channel, Payload);
    }

    bool PollEvent(TransportEvent& Event) override
    {
        if (Events.empty())
        {
            return false;
        }
        Event = std::move(Events.front());
        Events.pop_front();
        return true;
    }

    bool Initialized{false};
    bool InSession{false};
    double LastDeltaSeconds{0.0};
    PeerId LastRecipient;
    std::uint8_t LastChannel{0};
    std::vector<std::byte> LastPayload;
    std::deque<TransportEvent> Events;

private:
    [[nodiscard]] OperationId NextOperation() noexcept
    {
        return OperationId{++NextId};
    }

    [[nodiscard]] SendResult RecordSend(
        const PeerId& Recipient,
        std::uint8_t Channel,
        std::span<const std::byte> Payload)
    {
        if (!Initialized || !InSession)
        {
            return SendResult::NotInSession;
        }
        if (!Recipient.IsValid())
        {
            return SendResult::UnknownPeer;
        }
        LastRecipient = Recipient;
        LastChannel = Channel;
        LastPayload.assign(Payload.begin(), Payload.end());
        return SendResult::Queued;
    }

    std::uint64_t NextId{0};
};

} // namespace

int main()
{
    ContractProbe Transport;
    std::string Error{"stale error"};

    assert(Transport.QueryProvider() == TransportProvider::Eos);
    assert(Transport.Initialize(Error));
    assert(Error.empty());

    const SessionOptions Options{"proof-room", 8, true};
    const OperationId CreateId = Transport.CreateSession(Options);
    assert(CreateId);

    const PeerId Peer{"peer-1"};
    const std::array<std::byte, 3> Payload{
        std::byte{0x10}, std::byte{0x20}, std::byte{0x30}};
    assert(Transport.SendReliable(Peer, 2, Payload) == SendResult::NotInSession);

    const SessionId PhotonSession{TransportProvider::PhotonRealtime, "room-42"};
    assert(!Transport.JoinSession(PhotonSession));

    const SessionId EosSession{TransportProvider::Eos, "lobby-17"};
    assert(Transport.JoinSession(EosSession));
    assert(Transport.SendReliable(Peer, 2, Payload) == SendResult::Queued);
    assert(Transport.LastRecipient.Value == "peer-1");
    assert(Transport.LastChannel == 2);
    assert(Transport.LastPayload.size() == Payload.size());

    Transport.Events.emplace_back(MessageReceivedEvent{
        Peer,
        2,
        DeliveryMode::Reliable,
        std::vector<std::byte>(Payload.begin(), Payload.end())});

    TransportEvent Event;
    assert(Transport.PollEvent(Event));
    const auto* Message = std::get_if<MessageReceivedEvent>(&Event);
    assert(Message != nullptr);
    assert(Message->Sender.Value == Peer.Value);
    assert(Message->Payload.size() == Payload.size());
    assert(!Transport.PollEvent(Event));

    Transport.Tick(1.0 / 60.0);
    assert(Transport.LastDeltaSeconds > 0.0);
    assert(Transport.LeaveSession());
    assert(Transport.SendReliable(Peer, 2, Payload) == SendResult::NotInSession);

    Transport.Shutdown();
    assert(!Transport.CreateSession(Options));
    return 0;
}
