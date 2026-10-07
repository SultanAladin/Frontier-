# Lobby, match and voice extension

## Observed milestone
The owner's latest screenshot shows real `LOGIN_VERIFIED auth=success
connect=success`, a successful friends query, and loaded profile details. This is
user-PC evidence, not an authentication performed by CI. Personal profile values
and the supplied client secret are deliberately not recorded here.

## Located UI
The requested Lobby implementation is `app/lobby.html` in
`streamlinkinbox/Frontier`, branch `arena/01a06c6c-frontier`, commit
`1f2126870aee94c57c32631ccd8ad0cefa461de1`.
It has a lobby hero/navigation, player-card grid, voice strip, chat and right-side
match panel. A reference copy and provenance are under Project-Networking/Reference.
Its EOS-labelled JavaScript is simulated; only visual structure is reusable.

Latest previously used Slate branch was checked through GitHub:
`unassignedinbox/Slate`, `arena/01a0fd48-slate`,
`bf0bdd5005f97b6375c21bc74e9a4bd8b41417cd`.

## Requested flow / pending implementation
1. Successful Auth + Connect creates an EOS lobby automatically (once per login).
2. Display actual local player and distinctly labelled local dummy players for
   solo readiness testing. Dummy players are not Epic accounts/PUIDs, network
   members or RTC participants; exclude them from competitive/cloud statistics.
3. Publish readiness for real players through lobby member attributes; handle
   membership changes and clear readiness as appropriate.
4. Host creates/registers/starts a real EOS match session only after readiness and
   successful callbacks. Serialize operations to prevent duplicate create/start.
5. EOS lobby RTC audio, initially muted; explicit microphone control, real RTC
   connection state and errors. Dummy players cannot prove voice transmission.
6. End/destroy session and leave/destroy lobby cleanly; stop microphone and detach
   notifications before releasing the platform.
7. Persist last successful login UTC, last lobby/session ID, session start/end UTC,
   duration and completed/abandoned test matches. Never persist access tokens or
   fabricate gameplay metrics, scores or kills when no gameplay occurred.
8. Storage scope (local or cross-PC EOS cloud) and portable credential format need
   confirmation. Client-written records are not authoritative competitive stats.

## Changes already made this turn
- Replaced Save log UI action with Copy log and explicit Win32 clipboard error
  handling. Source change only; Windows build not run yet this turn.
- Located and copied the exact visual reference with its simulation caveat.

No EOS lobby/session/RTC/data-storage success is claimed by this document.
No secret has been embedded in source, reference files or a public artifact.
