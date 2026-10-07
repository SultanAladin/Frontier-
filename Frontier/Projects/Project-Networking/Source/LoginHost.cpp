//============================================================================================================================================
//                                                               LOGINHOST.CPP
//============================================================================================================================================
// 📦 Runs the real EOS login from a console without creating a game window.

#include "EpicExchange.h"
#include <chrono>
#include <cstdio>
#include <cstring>
#include <thread>

namespace
{
void PrintDiagnostic(const char* Text)
{
    std::puts(Text);
    std::fflush(stdout);
}
}

int main(int ArgumentCount, char** Arguments)
{
    if (ArgumentCount == 2 && std::strcmp(Arguments[1], "--sdk-check") == 0)
        return Networking::VerifyEpicRuntime(PrintDiagnostic) ? 0 : 2;
    if (ArgumentCount != 1)
    {
        std::puts("Usage: LoginHost [--sdk-check]");
        return 2;
    }
    std::puts("Project-Networking: REAL EOS login; no simulated provider");
    if (!Networking::ConstructEpic(PrintDiagnostic))
    {
        Networking::RetireEpic();
        return 2;
    }
    while (Networking::InspectLogin() != Networking::LoginProgress::Connected &&
           Networking::InspectLogin() != Networking::LoginProgress::Refused)
    {
        Networking::AdvanceEpic();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    const bool Connected = Networking::InspectLogin() == Networking::LoginProgress::Connected;
    Networking::RetireEpic();
    return Connected ? 0 : 1;
}
