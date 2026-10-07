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
};

bool ConstructEpic(const LoginSpecification& Specification, DiagnosticReception Reception) noexcept;
bool VerifyEpicRuntime(DiagnosticReception Reception) noexcept;
bool ConstructEpic(DiagnosticReception Reception) noexcept;
void AdvanceEpic() noexcept;
void RetireEpic() noexcept;
LoginProgress InspectLogin() noexcept;
}
