//============================================================================================================================================
//                                                               EPICEXCHANGE.H
//============================================================================================================================================
// 📦 Declares the project-owned EOS login lifetime and redacted diagnostic reception.

#pragma once
#include "LoginSequence.h"

namespace Networking
{
using DiagnosticReception = void (*)(const char*);

struct LoginSpecification
{
    const char* Secret;
    const char* ClientId;
    const char* Method;
    const char* DeveloperCredential;
    bool AllowCreation;
    bool EnableSocial = true;
};

const char* ValidateEpicCredentials(const char* Secret, const char* ClientId) noexcept;
bool ConstructEpic(const LoginSpecification& Specification, DiagnosticReception Reception) noexcept;
bool VerifyEpicPlatform(DiagnosticReception Reception) noexcept;
bool VerifyEpicRuntime(DiagnosticReception Reception) noexcept;
bool ConstructEpic(DiagnosticReception Reception) noexcept;
bool ShutdownEpic(DiagnosticReception Reception = nullptr) noexcept;
struct AccountProfile
{
    char DisplayName[256]{};
    char Country[128]{};
    char Language[64]{};
    bool Pending = false;
    bool Available = false;
};
const AccountProfile& InspectEpicProfile() noexcept;
bool QueryEpicProfile() noexcept;
bool ApproveEpicUserCreation() noexcept;
bool QueryEpicFriends() noexcept;
bool ShowEpicFriends() noexcept;
bool HideEpicFriends() noexcept;
bool EpicOverlayOwnsInput() noexcept;
int InspectFriendCount() noexcept;
const char* InspectFriendName(int Index) noexcept;
const char* InspectFriendship(int Index) noexcept;
const char* InspectFriendsReading() noexcept;
bool FriendsQueryPending() noexcept;
const char* InspectOverlayReading() noexcept;
void AdvanceEpic() noexcept;
void RetireEpic() noexcept;
LoginProgress InspectLogin() noexcept;
}
