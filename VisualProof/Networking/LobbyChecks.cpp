#include "../../Frontier/Projects/Project-Networking/Source/HistoryFormat.h"
#include "../../Frontier/Projects/Project-Networking/Source/LocalConfiguration.h"
#include <cstdio>
#include <string>
int main()
{
    using namespace Networking;
    unsigned Failures = 0;
    auto Check = [&](bool Pass, const char* Name) { std::printf("%s %s\n", Pass ? "PASS" : "FAIL", Name); if (!Pass) ++Failures; };
    RoomReading Room;
    Check(!EveryoneReady(Room), "empty lobby cannot start");
    Room.Players = {{"Synthetic local", false, false, true}, {"Dummy", true, true, false}};
    Check(!EveryoneReady(Room), "dummy readiness cannot bypass real player readiness");
    Room.Players[0].Ready = true;
    Check(EveryoneReady(Room), "ready real player plus explicit local dummy can exercise solo flow");
    Room.Players.erase(Room.Players.begin());
    Check(!EveryoneReady(Room), "dummy-only roster cannot start an EOS match");
    HistoryRecord R; R.Id = std::string(32, 'a'); R.Kind = "completed"; R.Utc = 1791360000;
    R.Duration = 42; R.RealPlayers = 1; R.DummyPlayers = 3; R.Session = "test-session"; R.Lobby = "test-lobby";
    HistoryRecord Decoded;
    Check(DecodeHistory(EncodeHistory(R), Decoded) && Decoded.Duration == 42 && Decoded.DummyPlayers == 3,
        "history round trip preserves explicitly labelled simulation counts");
    Check(!DecodeHistory(EncodeHistory(R) + "token=must-not-be-stored\n", Decoded), "unknown or credential fields rejected from cloud history");
    Check(!DecodeHistory(EncodeHistory(R) + "utc=1\n", Decoded), "duplicate cloud fields rejected");
    Check(!DecodeHistory(std::string(4097, 'a'), Decoded), "cloud input bounded at 4096 bytes");
    R.Session = "../../outside";
    Check(!DecodeHistory(EncodeHistory(R), Decoded), "untrusted cloud identifier cannot become a path");
    R.Session = "test-session"; R.Duration = -1;
    Check(!DecodeHistory(EncodeHistory(R), Decoded), "negative duration rejected");
    R.Duration = 0;
    HistoryReading History;
    MergeHistory(History, R); MergeHistory(History, R);
    Check(History.Records.size() == 1, "local and cloud copies deduplicated by immutable event ID");
    for (unsigned I = 0; I < 100; ++I)
    {
        char Id[33]{}; std::snprintf(Id, sizeof(Id), "%032x", I); R.Id = Id; R.Utc += 1;
        MergeHistory(History, R);
    }
    Check(History.Records.size() == 64 && History.Records.front().Utc >= History.Records.back().Utc,
        "history is bounded and newest-first");
    const std::string Config = "version=1\nclient_id=synthetic-client\nclient_secret=synthetic-secret\nstorage_key=" + std::string(64, 'a') + "\n";
    PortableSettings Settings;
    Check(ParsePortableSettings(Config, Settings) && Settings.Secret == "synthetic-secret", "portable config parses without embedding production credentials");
    WipeSettings(Settings);
    Check(Settings.Secret.empty() && Settings.StorageKey.empty(), "portable temporary secret buffers cleared");
    Check(!ParsePortableSettings(Config + "client_secret=duplicate\n", Settings), "duplicate portable secret rejected");
    Check(!ParsePortableSettings("version=1\nclient_id=x\nclient_secret=" + std::string(65, 'x') + "\nstorage_key=" + std::string(64, 'a'), Settings),
        "oversized portable secret rejected, never truncated");
    Check(!ValidStorageKey(std::string(64, 'z')), "invalid encryption key rejected");
    std::puts("Scope: deterministic local logic only. EOS lobby, RTC and cloud integration are not exercised here.");
    return Failures ? 1 : 0;
}
