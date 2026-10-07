//============================================================================================================================================
//                                                               LOGINHOST.CPP
//============================================================================================================================================
// 📦 Runs the real EOS login from a console without creating a game window.

#include "EpicExchange.h"
#include "PlatformDiagnostics.h"
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
    if (ArgumentCount == 2 && std::strcmp(Arguments[1], "--platform-check") == 0)
    {
        const bool Ready = Networking::VerifyEpicPlatform(PrintDiagnostic);
        const bool Retired = Networking::ShutdownEpic(PrintDiagnostic);
        return Ready && Retired ? 0 : 2;
    }
    if (ArgumentCount == 2 && std::strcmp(Arguments[1], "--sdk-check") == 0)
    {
        const bool Ready = Networking::VerifyEpicRuntime(PrintDiagnostic);
        const bool Retired = Networking::ShutdownEpic(PrintDiagnostic);
        return Ready && Retired ? 0 : 2;
    }
    if (ArgumentCount == 2 && std::strcmp(Arguments[1], "--lifecycle-check") == 0)
    {
        char Oversized[81]{};
        std::memset(Oversized, 'A', 80);
        char Boundary[65]{};
        std::memset(Boundary, 'A', 64);
        bool Accepted = Networking::ValidateEpicCredentials(Oversized, "test-client") != nullptr &&
            Networking::ValidateEpicCredentials("test-secret", Oversized) != nullptr &&
            Networking::ValidateEpicCredentials("test secret", "test-client") != nullptr &&
            Networking::ValidateEpicCredentials("test-secret", "test\nclient") != nullptr &&
            Networking::ValidateEpicCredentials(nullptr, "test-client") != nullptr &&
            Networking::ValidateEpicCredentials(Boundary, "test-client") == nullptr;
        const char* Raw = "ClientCredentials.ClientSecret must be an ANSI string between 1 and 64 in length";
        Accepted = Networking::ClassifyPlatformDiagnostic(Raw) == 1 && Accepted;
        Accepted = std::strstr(Networking::DescribePlatformDiagnostic(Networking::ClassifyPlatformDiagnostic(
            "unknown SDK message: token=DO_NOT_LOG_THIS_VALUE")), "DO_NOT_LOG_THIS_VALUE") == nullptr && Accepted;
        PrintDiagnostic(Accepted ? "PASS credential bounds and SDK diagnostic redaction" : "FAIL credential validation");
        Accepted = Networking::VerifyEpicRuntime(PrintDiagnostic) && Accepted;
        Accepted = Networking::VerifyEpicRuntime(PrintDiagnostic) && Accepted;
        const Networking::LoginSpecification Missing{nullptr, nullptr, "developer", "PlayerOne", false};
        Accepted = !Networking::ConstructEpic(Missing, PrintDiagnostic) && Accepted;
        Networking::RetireEpic();
        Accepted = Networking::VerifyEpicRuntime(PrintDiagnostic) && Accepted;
        Accepted = !Networking::QueryEpicFriends() && !Networking::ShowEpicFriends() &&
            !Networking::HideEpicFriends() && !Networking::EpicOverlayOwnsInput() && Accepted;
        Accepted = Networking::InspectFriendCount() == 0 && Accepted;
        Accepted = Networking::ShutdownEpic(PrintDiagnostic) && Accepted;
        Accepted = Networking::ShutdownEpic(PrintDiagnostic) && Accepted;
        Accepted = !Networking::VerifyEpicRuntime(PrintDiagnostic) && Accepted;
        std::puts(Accepted ? "PASS same-process SDK reuse, retry, social guards and terminal shutdown" : "FAIL SDK lifecycle");
        return Accepted ? 0 : 2;
    }
    if (ArgumentCount != 1)
    {
        std::puts("Usage: LoginHost [--sdk-check | --lifecycle-check | --platform-check]");
        return 2;
    }
    std::puts("Project-Networking: REAL EOS login; no simulated provider");
    if (!Networking::ConstructEpic(PrintDiagnostic))
    {
        Networking::ShutdownEpic(PrintDiagnostic);
        return 2;
    }
    while (Networking::InspectLogin() != Networking::LoginProgress::Connected &&
           Networking::InspectLogin() != Networking::LoginProgress::Refused)
    {
        Networking::AdvanceEpic();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    const bool Connected = Networking::InspectLogin() == Networking::LoginProgress::Connected;
    Networking::ShutdownEpic(PrintDiagnostic);
    return Connected ? 0 : 1;
}
