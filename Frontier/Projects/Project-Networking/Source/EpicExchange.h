//============================================================================================================================================
//                                                               EPICEXCHANGE.H
//============================================================================================================================================
// 📦 Declares the project-owned EOS login lifetime and redacted diagnostic reception.

#pragma once
#include "LoginSequence.h"

namespace Networking
{
using DiagnosticReception = void (*)(const char*);

bool VerifyEpicRuntime(DiagnosticReception Reception) noexcept;
bool ConstructEpic(DiagnosticReception Reception) noexcept;
void AdvanceEpic() noexcept;
void RetireEpic() noexcept;
LoginProgress InspectLogin() noexcept;
}
