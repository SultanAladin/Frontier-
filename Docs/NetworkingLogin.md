# Project-Networking login test

## What is delivered

`Frontier/Projects/Project-Networking` is an overlay for the existing Slate checkout, not a copy of its engine.
`ProjectNetworking.frontier` opens a project-owned empty scene and a revision-3 project DLL. The DLL ticks the
same EOS exchange as the standalone console diagnostic. It does not create another game window or renderer.

The implementation uses your supplied Dev Product/Sandbox/Deployment IDs and original Client ID. Secrets are
read only from the local process environment. If you replaced the entire client, override `EOS_CLIENT_ID`.
The Application ID is not an EOS platform initialization field.

The sequence is real EOS Auth -> copy the selected account's ID token -> EOS Connect -> validate the PUID.
SDK 1.19's SelectedAccountId is used for game-scoped identity, including previously merged Epic accounts.
Optional new-PUID creation requires explicit consent. Failures, missing credentials and timeouts cannot report success.
Raw tokens, secrets, Epic account IDs and PUID strings are not emitted by the application diagnostics.

This remains a one-shot login diagnostic, not production session management. It does not implement token refresh,
identity linking, a login panel, Photon, commerce, lobbies, or multiplayer traffic. Local success is not a substitute
for backend identity verification. The project owns a single EOS lifetime and refuses an already-initialized SDK.

## Executed evidence

See `VisualProof/Networking/SdkChecks.log` and `SdkBuildEvidence.json` for actual captured results and hashes.
The older `LocalChecks.log` is the earlier SDK-independent check, not the latest evidence.

- Compiled and linked the console and project shared library against the downloaded EOS SDK using Linux g++.
- Loaded the real EOS runtime; its reported version is `1.19.2.1-58105819`.
- Ran real EOS initialize/shutdown successfully twice, in separate processes.
- Ran missing-secret and invalid-argument refusal checks against the linked console.
- Loaded the real project image and checked ABI rejection, valid entry points, and refused project construction.
- Ran seven synthetic login-order checks. Those are explicitly NOT authentication proof.
- Windows/MSVC build and real SDK smoke checks subsequently passed in Actions run `37583886172`.
- Windows scene opening and LIVE PLAYER AUTHENTICATION remain unverified.

No replacement secret was supplied. This sandbox's outbound allowlist excludes Epic authentication services.
No player login was attempted, and no successful player login is claimed.

## SDK storage and provenance

The private Drive folder is reachable through its direct link:
`https://drive.google.com/drive/folders/1_qBBX5gJTFkkRVOuB7e3Q2TtlM9FR62s`.
Its flattened layout already contains `Include`, `Lib`, and `Bin`; use that folder itself as `SdkRoot`.
Windows x64 and Linux x64 binaries are present. The downloaded Linux runtime and required include closure are
staged under ignored `ThirdParty/EOS`. `SdkManifest.json` records hashes, not proprietary SDK content.
No license/notices file was found at the folder root; retain those from the original Epic package.
The flattened upload does not include the Developer Authentication Tool or Bootstrapper at its root.
Obtain these from your original SDK/tool downloads as needed; they have not been installed by this integration.

`Upstream.json` records the latest inspected Slate revision, `bf0bdd5005f97b6375c21bc74e9a4bd8b41417cd`.
Fetch the upstream branch before subsequent changes and reconcile it; never discard local work with a reset.
Builds include the supplied checkout's real ABI header and assert the supported revision and fingerprint.
For the local checks, that header was extracted from the fetched commit without importing the entire engine.

## Build on Windows

Use x64 Visual Studio developer PowerShell at this Frontier checkout's root:

```powershell
$Project = (Resolve-Path '.\Frontier\Projects\Project-Networking').Path
& "$Project\Build\ToolchainSequence.ps1" `
    -SdkRoot 'C:\Dependencies\EOS Flattened' `
    -SlateRoot 'C:\Source\Slate'
```

Required SDK files include `Include/eos_sdk.h`, `Lib/EOSSDK-Win64-Shipping.lib`, and
`Bin/EOSSDK-Win64-Shipping.dll`. The script uses C++20 and `/MD` for both targets and stages the runtime next
to the console. Both build targets compile the same exchange; no shared-engine source batch needs changing.
Output and build evidence are in `Build/Output`, ignored by Git.

## First real player login: Developer Authentication Tool

For local development, use Epic's Developer Authentication Tool rather than bypassing Account Portal readiness:

1. Rotate the client secret exposed in chat. Never paste the replacement or commit it.
2. Start Epic's Developer Authentication Tool on **port 6547** on your own PC.
3. Sign in through the tool with an Epic account permitted to access your development application.
4. Save that credential in the tool with a name such as `PlayerOne`.
5. Keep the tool running. The project contacts `localhost:6547` on the SAME PC, not this sandbox.
6. Run the following in the x64 developer PowerShell session used to build:

```powershell
# Only set this if you replaced the entire client, not just its secret:
# $env:EOS_CLIENT_ID = 'replacement-client-id'
& "$Project\Build\LoginSequence.ps1" -DeveloperCredential 'PlayerOne'
```

The runner defaults to `developer`, prompts for the rotated client secret without echoing it, and clears the
secret environment variable in `finally`. The credential name is NOT your password or client secret.
The native executable still calls the real EOS Auth and Connect APIs; the local tool is not a simulated identity.
The overall login timeout is 180 seconds. The environment secret is temporarily readable by the local process;
this is not protected server-side storage.

If Auth succeeds but Connect reports `account_creation_required`, confirm this is a genuinely new test player:

```powershell
& "$Project\Build\LoginSequence.ps1" -DeveloperCredential 'PlayerOne' -AllowCreateUser
```

This permits a real PUID creation in the Dev deployment. Do not use it to work around an identity-linking problem.
For a second test player, sign in another authorized account in the tool, save it as `PlayerTwo`, and run again
with that credential name. One successful development account does not prove public player access.

## Account Portal mode

The supplied SDK's `eos_auth_types.h` explicitly requires Windows Account Portal applications to be launched
through EOS Bootstrapper with the EOS redistributable installed. The earlier overlay-disabled configuration
was incorrect for this path and has been removed. The project now checks desktop crossplay readiness on Windows.

For this path, configure Epic's Bootstrapper to launch the executable with local environment
`EOS_LOGIN_METHOD=accountportal` and the rotated client credential. Follow the Bootstrapper instructions for
this exact SDK distribution. The runner's `-LoginMethod accountportal` is a diagnostic selection, NOT a replacement
for launching through the Bootstrapper. A direct launch can correctly refuse with `account_portal=not_ready`.
We have not fabricated Bootstrapper command-line arguments or bundled an untested installer.

## Login evidence to share

A successful run must exit zero and include all three lines below. This is the EXPECTED format, not captured proof:

```text
auth=success epic_account_id_valid=1
connect=success product_user_id_valid=1
LOGIN_VERIFIED auth=success connect=success
```

The Windows runner writes UTC timestamps, executable hash, exit code, and redacted diagnostics to
`Build/Output/Login-*.log`. Share that log and `BuildEvidence.json`, not secrets or browser codes.
A local log is diagnostic evidence, not a signed assertion a server should trust.

## Reproduce Linux checks

With the Linux runtime in `SDK/Bin` and matching headers in `SDK/Include`:

```bash
python3 Frontier/Projects/Project-Networking/Build/ToolchainSequence.py \
  --sdk-root /path/to/SDK --slate-root /path/to/Slate
python3 VisualProof/Networking/RunChecks.py --slate-root /path/to/Slate
```

The checker strips credential environment variables, exercises the real SDK, and never starts player login.
It also writes fresh evidence and fails nonzero on a regression. The Linux `.so` is for ABI verification;
the `.frontier` specification remains targeted at the Windows DLL.

## Open the project through Frontier

After building the Windows engine normally, use a securely configured local session with `EOS_CLIENT_SECRET`,
`EOS_LOGIN_METHOD=developer`, and `EOS_DEVELOPER_CREDENTIAL=PlayerOne`, with the developer tool running:

```powershell
$env:PATH = "$Project\Build\Output;$env:PATH"
& 'C:\Path\To\Frontier.exe' "$Project\ProjectNetworking.frontier"
```

Diagnostics go through Frontier's diagnostic reception. There is no login UI yet. Close and reopen the project
to rerun the one-shot sequence. Remove local secret environment variables when finished. Start with the console
route so unrelated renderer or empty-scene issues do not mask authentication failures.

## GitHub Actions Windows binary

`.github/workflows/networking-windows.yml` builds on Windows Server 2022 with MSVC x64, C++20 and `/MD`.
The runner fetches the latest Slate branch for its ABI header and records the resolved commit in build evidence.
`WindowsSdkManifest.json` pins every downloaded SDK input by size and SHA-256. Download access relies on the
existing user-shared Drive links; the workflow does not change their permissions or receive any client secret.
It runs real SDK initialization/shutdown, missing-secret refusal, and the login-order checks before packaging.

The artifact contains the console EXE, project DLL, launcher, project specification, scene, evidence, and instructions.
It is NOT a full Frontier engine build. Proprietary SDK headers, import libraries and the EOS runtime are excluded
from the downloadable artifact; copy the existing x64 EOS DLL beside the EXE as explained in `START-HERE.txt`.
No credentials are baked in. Artifacts expire after 14 days and can be regenerated by rerunning the workflow.

### Windows build result

Actions run `37583886172` completed successfully for source commit
`1a430f3fc2c59ea1083380f6283623da119de1f8`. `VisualProof/Networking/WindowsActions.json` records the
reported job and step results. The package contains the runner-generated `WindowsChecks.log` and
`BuildEvidence.json`; these are distinct from the earlier Linux-only results above.

Download: https://github.com/c7egoist/Frontier/actions/runs/37583886172/artifacts/11466181637

The sandbox could not mirror the artifact from GitHub's Azure download host. The artifact itself was uploaded
successfully and is available through the GitHub link (sign-in may be required).
