//============================================================================================================================================
// Frontier/Online/IMultiplayerTransport.h — Shared contract for EOS and Photon transports
//============================================================================================================================================
#pragma once

#include "TransportTypes.h"

#include <span>
#include <string>

namespace Frontier::Online {

// Adapters are pumped by their owning game thread. Vendor callbacks must be converted
// to TransportEvents and drained by PollEvent; they must not mutate game state directly.
// Operation methods are asynchronous: a nonzero OperationId is completed by a matching
// OperationCompletedEvent. A zero id means the request was rejected before submission.
class IMultiplayerTransport
{
public:
    virtual ~IMultiplayerTransport() = default;

    [[nodiscard]] virtual TransportProvider QueryProvider() const noexcept = 0;

    // Provider-specific configuration is supplied to the concrete adapter at creation
    // time. Error text is diagnostic only and must never contain access tokens/secrets.
    virtual bool Initialize(std::string& Error) = 0;
    virtual void Shutdown() noexcept = 0;

    // Pump the provider once per frame. All public methods, including PollEvent and
    // Shutdown, are called on the same owning thread unless an adapter documents more.
    virtual void Tick(double DeltaSeconds) = 0;

    [[nodiscard]] virtual OperationId CreateSession(const SessionOptions& Options) = 0;
    [[nodiscard]] virtual OperationId JoinSession(const SessionId& Session) = 0;
    [[nodiscard]] virtual OperationId LeaveSession() = 0;

    // Payload memory is borrowed only for the duration of the call. An adapter that
    // queues a send must copy it before returning. The returned result describes local
    // acceptance/back-pressure, not end-to-end delivery acknowledgement.
    [[nodiscard]] virtual SendResult SendReliable(
        const PeerId& Recipient,
        std::uint8_t Channel,
        std::span<const std::byte> Payload) = 0;

    [[nodiscard]] virtual SendResult SendUnreliable(
        const PeerId& Recipient,
        std::uint8_t Channel,
        std::span<const std::byte> Payload) = 0;

    // Returns false when the event queue is empty. MessageReceivedEvent owns its payload.
    virtual bool PollEvent(TransportEvent& Event) = 0;
};

} // namespace Frontier::Online
