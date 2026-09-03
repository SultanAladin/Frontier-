//============================================================================================================================================
//                                                      PREFERENCEREGISTRY.H
//============================================================================================================================================
// 🧩 One record for every user-facing Control Centre setting, persisted as TOML.
//
//    UserPreferences groups the four pages: Render (dashboard tiles + pills), Appearance (Display / Fonts / Theme),
//    Input, Notifications. The page hosts keep owning their live/draft state; the registry is the durable copy:
//
//        start-up   Load(path) → seed the hosts                      (missing file / key → defaults, never an error)
//        Apply      hosts write their applied record here → Save()   (Appearance: on Apply; dashboard: debounced)
//
//    Schema: [preferences] version = 1 plus one table per page. Unknown keys are ignored, missing keys keep defaults,
//    so a file written by an older build always loads. Enumerations are stored as their category names, not numbers.
//
//    Storage: <ProjectRoot>/Content/UserPreferences.toml by default (same convention as the font archives).

#pragma once

#include "ControlCentreHost.h"
#include "AppearanceInspector.h"
#include <cstdint>
#include <string>
#include <string_view>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                  INPUT PREFERENCES
//------------------------------------------------------------------------------------------------------------------------

struct InputPreferences
{
    float MouseSensitivity   = 1.0f;    // [×] multiplier on the project's base rad/px
    bool  InvertPitch        = false;
    float FlightSpeed        = 1.0f;    // [×] multiplier on the project's base m/s
    float BoostMultiplier    = 3.0f;    // [×] while Left Shift is held
    float ScrollSpeedStep    = 1.0f;    // [×] wheel speed increment
    bool  RawMouseInput      = true;
    [[nodiscard]] bool operator==(const InputPreferences&) const noexcept = default;
};

//------------------------------------------------------------------------------------------------------------------------
//                                               NOTIFICATION PREFERENCES
//------------------------------------------------------------------------------------------------------------------------

enum class ToastPlacementCategory : uint32_t { TopRight = 0, TopLeft = 1, BottomRight = 2, BottomLeft = 3, Count = 4 };

struct NotificationPreferences
{
    bool  RenderChanges      = true;    // "Render settings applied" / "Appearance applied"
    bool  BakingComplete     = true;
    bool  MemoryWarnings     = true;
    bool  FrameRateDrops     = false;
    float FrameRateThreshold = 30.0f;   // [fps] toast when the 1 s average dips below
    float HoldSeconds        = 3.5f;    // [s] toast dwell (NotificationQueue::HoldDuration default)
    ToastPlacementCategory Placement = ToastPlacementCategory::TopRight;
    bool  Sound              = false;
    [[nodiscard]] bool operator==(const NotificationPreferences&) const noexcept = default;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   USER PREFERENCES
//------------------------------------------------------------------------------------------------------------------------

struct UserPreferences
{
    static constexpr uint32_t SchemaVersion = 1u;

    ControlCentreSettings    Render;          // Revision is transient and not persisted
    AppearanceSettings       Appearance;
    InputPreferences         Input;
    NotificationPreferences  Notifications;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  PREFERENCE REGISTRY
//------------------------------------------------------------------------------------------------------------------------

class PreferenceRegistry
{
public:
    PreferenceRegistry() noexcept;

    // Path is remembered for later Save() calls. Load returns false only when the file exists but cannot be parsed;
    //    a missing file is a normal first start (defaults, returns true).
    bool Load(std::string_view Path) noexcept;
    bool Save() noexcept;
    bool SaveTo(std::string_view Path) noexcept;

    [[nodiscard]] const UserPreferences& Query() const noexcept { return Preferences; }
    UserPreferences&                     Access() noexcept { return Preferences; }
    [[nodiscard]] const std::string&     QueryPath() const noexcept { return StoragePath; }
    [[nodiscard]] bool                   WasLoadedFromDisk() const noexcept { return LoadedFromDisk; }
    [[nodiscard]] const std::string&     QueryLastError() const noexcept { return LastError; }

    // Debounced save: hosts call MarkDirty() on every live change; Advance() writes once the input has been quiet.
    void MarkDirty() noexcept { Dirty = true; QuietSeconds = 0.0f; }
    void Advance(float DeltaSeconds) noexcept;
    static constexpr float DebounceSeconds = 0.6f;

    // Serialisation helpers (public so tests / tools can round-trip a record without a file).
    [[nodiscard]] static std::string Serialise(const UserPreferences& P) noexcept;
    [[nodiscard]] static bool        Deserialise(std::string_view Toml, UserPreferences& Out, std::string* Error = nullptr) noexcept;

private:
    UserPreferences Preferences;
    std::string     StoragePath;
    std::string     LastError;
    bool            LoadedFromDisk;
    bool            Dirty;
    float           QuietSeconds;
};

} // namespace Frontier
