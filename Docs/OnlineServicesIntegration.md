# Online Services Integration

## Current scope

This repository now has a provider-neutral multiplayer boundary in `Engine/Online/` and a dependency-free contract proof. It is an interface only: no EOS, Photon, Xsolla, authentication, lobby, session, or gameplay-replication provider is wired into the runtime yet.

`IMultiplayerTransport` is designed for adapters that pump on the owning game thread. Provider callbacks are translated to queued `TransportEvent` values, sends borrow their input buffer only for the call, and received messages own their payload. `PeerId` is transport-local; the backend's immutable account identity must remain separate. Session locators carry a provider tag so an invite cannot be routed to the wrong network.

The contract deliberately has no `premium` flag, API key, webhook secret, or Photon server secret. A client-side flag is not an authorization decision; premium access and Photon custom-auth tokens must be granted by the authoritative backend.

## EOS SDK staging

The supplied Drive folder `EOS Flattened` contains the SDK's `Include`, `Lib`, and `Bin` directories. Its `eos_version.h` identifies EOS SDK **1.19.2.1**. Keep this proprietary SDK out of Git; local `ThirdParty/EOS/`, `ThirdParty/Photon/`, and `ThirdParty/Xsolla/` trees are ignored.

After downloading/unpacking the EOS files locally, set `EOS_SDK_ROOT` to the directory containing `Include`, `Lib`, and `Bin`, then validate the x64 package:

```powershell
$env:EOS_SDK_ROOT = 'C:\path\to\EOS'
python Tools\Online\verify_eos_sdk.py
```

Or pass the SDK root as the first argument. The verifier checks the SDK version and the Windows x64 header/import-library/runtime-DLL layout, then prints SHA-256 checksums for the `.lib` and `.dll`. Those checksums are for the local component files, not the 588 MB source ZIP.

The current Windows app build uses the direct MSVC PowerShell toolchain, C++20, and `/MD`. Any eventual EOS link must use the matching Win64 shipping library and deploy its matching DLL beside the app. The `native-proof` CMake path is not the Windows app toolchain.

## Integration boundaries

- **EOS:** Auth + Connect establish the player identity; EOS P2P/lobbies are the free or mixed-play transport. Keep product/sandbox/deployment configuration outside source control.
- **Photon Realtime Core C++:** a separate adapter for premium-only rooms. Do not use Photon Fusion. The client must receive any Photon custom-auth token from the backend; never embed the Photon server secret.
- **Commerce:** use Xsolla checkout/catalog HTTP APIs through a backend unless a supported native C++ package is obtained. Signed webhooks, idempotent grants, refunds/revocations, and premium entitlement checks belong server-side.
- **Replication:** entity state, snapshots, interpolation, prediction/reconciliation, authority, spawning, and despawning sit above `IMultiplayerTransport`; the transport contract is not a replication system.

## Decisions required before provider implementations

1. Provide the backend source or explicitly approve creating a backend service. Xsolla purchase validation and authoritative premium checks must not live in the game client.
2. Confirm the play policy: separate free/EOS and premium/Photon pools, or the recommended mixed-play fallback where any free participant selects EOS.
3. Decide Photon room authority (client-hosted, shared authority, or dedicated authoritative server) and define what premium access grants.
4. Supply development-only EOS Product/Sandbox/Deployment/Client configuration and the required client policy; keep credentials out of Git and chat.
5. Supply the Photon Realtime App ID/configuration and Xsolla project/SKU configuration through a secure local/deployment path.

## Verification

The provider-neutral contract proof is included in the repository's proof-only CMake/CTest path as `OnlineTransportContract`. The SDK verifier can be run independently and performs no download. Provider integration tests will require the proprietary SDKs and valid development service configuration; neither is needed for the contract proof.
