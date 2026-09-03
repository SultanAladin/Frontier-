//============================================================================================================================================
//                                                     PREFERENCEREGISTRY.CPP
//============================================================================================================================================
// 🧩 UserPreferences ⇄ TOML. Enumerations round-trip by name; unknown names fall back to the default.

#include "PreferenceRegistry.h"
#include "TypefaceRegistry.h"
#include <toml++/toml.hpp>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <cstring>
#include <algorithm>

namespace Frontier {

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                  ENUM NAME TABLES
//------------------------------------------------------------------------------------------------------------------------

template<typename E> struct NameTable;

#define FRONTIER_NAMES(Enum, ...)                                                                            \
    template<> struct NameTable<Enum> { static constexpr const char* Names[] = { __VA_ARGS__ }; }

FRONTIER_NAMES(FidelityCategory,         "Minimal", "Economy", "Standard", "Ultra", "Reference");
FRONTIER_NAMES(RenderResolutionCategory, "Native", "2560x1440", "1920x1080", "1280x720");
FRONTIER_NAMES(VerticalSyncCategory,     "Off", "On", "Adaptive");
FRONTIER_NAMES(FrameCapCategory,         "Unlimited", "60", "120", "144");
FRONTIER_NAMES(OverlayCornerCategory,    "TopLeft", "TopRight", "BottomLeft", "BottomRight");
FRONTIER_NAMES(SampleCountCategory,      "1x", "2x", "4x", "8x");
FRONTIER_NAMES(ThemeCategory,            "Oled", "Dark", "Dim", "Light", "Sepia", "Dracula", "Nord", "GitHub");
FRONTIER_NAMES(AccentCategory,           "White", "Orange", "Amber", "Lime", "Emerald", "Cyan", "Blue", "Violet", "Fuchsia", "Rose");
FRONTIER_NAMES(ToastPlacementCategory,   "TopRight", "TopLeft", "BottomRight", "BottomLeft");
FRONTIER_NAMES(FontWeightCategory,       "Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black");
#undef FRONTIER_NAMES

template<typename E> const char* NameOf(E Value) noexcept
{
    constexpr size_t N = sizeof(NameTable<E>::Names) / sizeof(NameTable<E>::Names[0]);
    const size_t I = static_cast<size_t>(Value);
    return I < N ? NameTable<E>::Names[I] : NameTable<E>::Names[0];
}

// FontWeightCategory is 100-stepped, everything else is 0-based.
template<> const char* NameOf<FontWeightCategory>(FontWeightCategory Value) noexcept
{
    return NameTable<FontWeightCategory>::Names[TypefaceRegistry::WeightOrdinal(Value)];
}

template<typename E> E EnumFrom(std::string_view Name, E Fallback) noexcept
{
    constexpr size_t N = sizeof(NameTable<E>::Names) / sizeof(NameTable<E>::Names[0]);
    for (size_t I = 0; I < N; ++I) if (Name == NameTable<E>::Names[I]) return static_cast<E>(I);
    return Fallback;
}

template<> FontWeightCategory EnumFrom<FontWeightCategory>(std::string_view Name, FontWeightCategory Fallback) noexcept
{
    for (uint32_t I = 0u; I < TypefaceRegistry::WeightCount; ++I)
        if (Name == NameTable<FontWeightCategory>::Names[I]) return TypefaceRegistry::WeightAt(I);
    return Fallback;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    READ HELPERS
//------------------------------------------------------------------------------------------------------------------------

struct Reader
{
    const toml::table* T;
    template<typename V> void Get(const char* Key, V& Out) const
    {
        if (!T) return;
        if constexpr (std::is_same_v<V, bool>)          { if (auto* N = T->get_as<bool>(Key)) Out = N->get(); }
        else if constexpr (std::is_same_v<V, float>)    { if (auto* N = T->get_as<double>(Key)) Out = static_cast<float>(N->get()); else if (auto* I = T->get_as<int64_t>(Key)) Out = static_cast<float>(I->get()); }
        else if constexpr (std::is_same_v<V, uint32_t>) { if (auto* N = T->get_as<int64_t>(Key)) Out = static_cast<uint32_t>(std::max<int64_t>(0, N->get())); }
        else if constexpr (std::is_same_v<V, std::string>) { if (auto* N = T->get_as<std::string>(Key)) Out = N->get(); }
    }
    template<typename E> void GetEnum(const char* Key, E& Out) const
    {
        if (!T) return;
        if (auto* N = T->get_as<std::string>(Key)) Out = EnumFrom<E>(N->get(), Out);
    }
    Reader Sub(const char* Key) const { return Reader{ T ? T->get_as<toml::table>(Key) : nullptr }; }
};

const char* FamilyNameOf(uint32_t Index) noexcept
{
    const TypefaceRegistry* Reg = TypefaceRegistry::QueryCurrent();
    const TypefaceFamily* F = Reg ? Reg->QueryFamily(Index) : nullptr;
    return F ? F->Name.c_str() : "";
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

PreferenceRegistry::PreferenceRegistry() noexcept
    : Preferences{}, StoragePath{}, LastError{}, LoadedFromDisk(false), Dirty(false), QuietSeconds(0.0f)
{
}

void PreferenceRegistry::Advance(float DeltaSeconds) noexcept
{
    if (!Dirty) return;
    QuietSeconds += DeltaSeconds;
    if (QuietSeconds >= DebounceSeconds) { Dirty = false; (void)Save(); }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SERIALISE
//------------------------------------------------------------------------------------------------------------------------

std::string PreferenceRegistry::Serialise(const UserPreferences& P) noexcept
{
    toml::table Root;
    Root.insert("preferences", toml::table{ { "version", static_cast<int64_t>(UserPreferences::SchemaVersion) } });

    Root.insert("render", toml::table{
        { "global_illumination", P.Render.GlobalIllumination },
        { "anti_aliasing",       P.Render.AntiAliasing },
        { "frame_rate_overlay",  P.Render.FrameRateOverlay },
        { "notifications",       P.Render.Notifications },
        { "quality",             NameOf(P.Render.Quality) },
        { "render_scale",        static_cast<double>(P.Render.RenderScale) },
    });

    const AppearanceSettings& A = P.Appearance;
    toml::table Display{
        { "resolution",         NameOf(A.Resolution) },
        { "interface_scale",    static_cast<double>(A.InterfaceScale) },
        { "match_quality_tier", A.MatchQualityTier },
        { "vertical_sync",      NameOf(A.VerticalSync) },
        { "frame_cap",          NameOf(A.FrameCap) },
        { "fullscreen",         A.Fullscreen },
        { "anti_aliasing",      NameOf(A.AntiAliasing) },
        { "safe_area_padding",  static_cast<double>(A.SafeAreaPadding) },
        { "frame_rate_overlay", A.FrameRateOverlay },
        { "overlay_corner",     NameOf(A.OverlayCorner) },
    };
    toml::table Theme{
        { "theme",          NameOf(A.Theme) },
        { "corner_radius",  static_cast<double>(A.CornerRadius) },
        { "accent",         NameOf(A.Accent) },
        { "warning_swatch", static_cast<int64_t>(A.WarningSwatch) },
        { "success_swatch", static_cast<int64_t>(A.SuccessSwatch) },
        { "info_swatch",    static_cast<int64_t>(A.InfoSwatch) },
        { "caution_swatch", static_cast<int64_t>(A.CautionSwatch) },
    };
    toml::table Fonts{
        { "family",       FamilyNameOf(A.FontFamily) },
        { "family_index", static_cast<int64_t>(A.FontFamily) },
        { "antialiasing", A.FontAntialiasing },
        { "ligatures",    A.Ligatures },
    };
    toml::table Roles;
    for (uint32_t R = 0u; R < AppearanceSettings::TypeRoleCount; ++R)
        Roles.insert(AppearanceInspector::QueryTypeRoleLabel(R), toml::table{ { "size", static_cast<double>(A.RoleSize[R]) }, { "weight", NameOf(A.RoleWeight[R]) } });
    Fonts.insert("roles", std::move(Roles));
    Root.insert("appearance", toml::table{ { "display", std::move(Display) }, { "fonts", std::move(Fonts) }, { "theme", std::move(Theme) } });

    Root.insert("input", toml::table{
        { "mouse_sensitivity", static_cast<double>(P.Input.MouseSensitivity) },
        { "invert_pitch",      P.Input.InvertPitch },
        { "flight_speed",      static_cast<double>(P.Input.FlightSpeed) },
        { "boost_multiplier",  static_cast<double>(P.Input.BoostMultiplier) },
        { "scroll_speed_step", static_cast<double>(P.Input.ScrollSpeedStep) },
        { "raw_mouse_input",   P.Input.RawMouseInput },
    });

    Root.insert("notifications", toml::table{
        { "render_changes",       P.Notifications.RenderChanges },
        { "baking_complete",      P.Notifications.BakingComplete },
        { "memory_warnings",      P.Notifications.MemoryWarnings },
        { "frame_rate_drops",     P.Notifications.FrameRateDrops },
        { "frame_rate_threshold", static_cast<double>(P.Notifications.FrameRateThreshold) },
        { "hold_seconds",         static_cast<double>(P.Notifications.HoldSeconds) },
        { "placement",            NameOf(P.Notifications.Placement) },
        { "sound",                P.Notifications.Sound },
    });

    std::ostringstream Out;
    Out << "# Frontier user preferences - written by PreferenceRegistry; edit freely, unknown keys are ignored.\n\n" << Root << "\n";
    return Out.str();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DESERIALISE
//------------------------------------------------------------------------------------------------------------------------

bool PreferenceRegistry::Deserialise(std::string_view Toml, UserPreferences& Out, std::string* Error) noexcept
{
    toml::table Root;
    try { Root = toml::parse(Toml); }
    catch (const toml::parse_error& E) { if (Error) *Error = E.description(); return false; }
    catch (...) { if (Error) *Error = "unknown parse failure"; return false; }

    Reader R{ &Root };
    {
        Reader S = R.Sub("render");
        S.Get("global_illumination", Out.Render.GlobalIllumination);
        S.Get("anti_aliasing",       Out.Render.AntiAliasing);
        S.Get("frame_rate_overlay",  Out.Render.FrameRateOverlay);
        S.Get("notifications",       Out.Render.Notifications);
        S.GetEnum("quality",         Out.Render.Quality);
        S.Get("render_scale",        Out.Render.RenderScale);
        Out.Render.RenderScale = std::clamp(Out.Render.RenderScale, 0.25f, 1.0f);
    }
    {
        AppearanceSettings& A = Out.Appearance;
        Reader D = R.Sub("appearance").Sub("display");
        D.GetEnum("resolution",        A.Resolution);
        D.Get("interface_scale",       A.InterfaceScale);
        D.Get("match_quality_tier",    A.MatchQualityTier);
        D.GetEnum("vertical_sync",     A.VerticalSync);
        D.GetEnum("frame_cap",         A.FrameCap);
        D.Get("fullscreen",            A.Fullscreen);
        D.GetEnum("anti_aliasing",     A.AntiAliasing);
        D.Get("safe_area_padding",     A.SafeAreaPadding);
        D.Get("frame_rate_overlay",    A.FrameRateOverlay);
        D.GetEnum("overlay_corner",    A.OverlayCorner);
        A.InterfaceScale  = std::clamp(A.InterfaceScale, 50.0f, 200.0f);
        A.SafeAreaPadding = std::clamp(A.SafeAreaPadding, 0.0f, 128.0f);

        Reader T = R.Sub("appearance").Sub("theme");
        T.GetEnum("theme",         A.Theme);
        T.Get("corner_radius",     A.CornerRadius);
        T.GetEnum("accent",        A.Accent);
        T.Get("warning_swatch",    A.WarningSwatch);
        T.Get("success_swatch",    A.SuccessSwatch);
        T.Get("info_swatch",       A.InfoSwatch);
        T.Get("caution_swatch",    A.CautionSwatch);
        A.CornerRadius  = std::clamp(A.CornerRadius, 0.0f, 32.0f);
        A.WarningSwatch = std::min(A.WarningSwatch, 3u); A.SuccessSwatch = std::min(A.SuccessSwatch, 3u);
        A.InfoSwatch    = std::min(A.InfoSwatch, 3u);    A.CautionSwatch = std::min(A.CautionSwatch, 3u);

        Reader F = R.Sub("appearance").Sub("fonts");
        // Family by name first (stable across archive changes), index as fallback.
        std::string FamilyName; F.Get("family", FamilyName);
        if (const TypefaceRegistry* Reg = TypefaceRegistry::QueryCurrent(); Reg && !FamilyName.empty())
        {
            const int32_t Found = Reg->FindFamily(FamilyName);
            if (Found >= 0) A.FontFamily = static_cast<uint32_t>(Found); else F.Get("family_index", A.FontFamily);
        }
        else F.Get("family_index", A.FontFamily);
        F.Get("antialiasing", A.FontAntialiasing);
        F.Get("ligatures",    A.Ligatures);
        Reader Roles = F.Sub("roles");
        for (uint32_t I = 0u; I < AppearanceSettings::TypeRoleCount; ++I)
        {
            Reader Role = Roles.Sub(AppearanceInspector::QueryTypeRoleLabel(I));
            Role.Get("size", A.RoleSize[I]);
            Role.GetEnum("weight", A.RoleWeight[I]);
            A.RoleSize[I] = std::clamp(A.RoleSize[I], 8.0f, 72.0f);
        }
    }
    {
        Reader S = R.Sub("input");
        S.Get("mouse_sensitivity", Out.Input.MouseSensitivity);
        S.Get("invert_pitch",      Out.Input.InvertPitch);
        S.Get("flight_speed",      Out.Input.FlightSpeed);
        S.Get("boost_multiplier",  Out.Input.BoostMultiplier);
        S.Get("scroll_speed_step", Out.Input.ScrollSpeedStep);
        S.Get("raw_mouse_input",   Out.Input.RawMouseInput);
        Out.Input.MouseSensitivity = std::clamp(Out.Input.MouseSensitivity, 0.1f, 5.0f);
        Out.Input.FlightSpeed      = std::clamp(Out.Input.FlightSpeed, 0.1f, 10.0f);
        Out.Input.BoostMultiplier  = std::clamp(Out.Input.BoostMultiplier, 1.0f, 10.0f);
        Out.Input.ScrollSpeedStep  = std::clamp(Out.Input.ScrollSpeedStep, 0.1f, 5.0f);
    }
    {
        Reader S = R.Sub("notifications");
        S.Get("render_changes",       Out.Notifications.RenderChanges);
        S.Get("baking_complete",      Out.Notifications.BakingComplete);
        S.Get("memory_warnings",      Out.Notifications.MemoryWarnings);
        S.Get("frame_rate_drops",     Out.Notifications.FrameRateDrops);
        S.Get("frame_rate_threshold", Out.Notifications.FrameRateThreshold);
        S.Get("hold_seconds",         Out.Notifications.HoldSeconds);
        S.GetEnum("placement",        Out.Notifications.Placement);
        S.Get("sound",                Out.Notifications.Sound);
        Out.Notifications.FrameRateThreshold = std::clamp(Out.Notifications.FrameRateThreshold, 10.0f, 240.0f);
        Out.Notifications.HoldSeconds        = std::clamp(Out.Notifications.HoldSeconds, 1.0f, 10.0f);
    }
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      FILE I/O
//------------------------------------------------------------------------------------------------------------------------

bool PreferenceRegistry::Load(std::string_view Path) noexcept
{
    StoragePath.assign(Path);
    LoadedFromDisk = false;
    LastError.clear();
    std::error_code Ec;
    if (!std::filesystem::exists(StoragePath, Ec)) return true;   // first start: defaults

    std::ifstream In(StoragePath, std::ios::binary);
    if (!In) { LastError = "cannot open"; return false; }
    std::stringstream Buffer; Buffer << In.rdbuf();

    UserPreferences Parsed{};
    if (!Deserialise(Buffer.str(), Parsed, &LastError)) return false;
    Preferences = Parsed;
    LoadedFromDisk = true;
    return true;
}

bool PreferenceRegistry::Save() noexcept
{
    return StoragePath.empty() ? false : SaveTo(StoragePath);
}

bool PreferenceRegistry::SaveTo(std::string_view Path) noexcept
{
    std::error_code Ec;
    const std::filesystem::path Target(Path);
    if (Target.has_parent_path()) std::filesystem::create_directories(Target.parent_path(), Ec);

    // Write to a sibling temp file, then rename — a crash mid-write never leaves a truncated preferences file.
    const std::filesystem::path Temp = Target.string() + ".tmp";
    {
        std::ofstream Out(Temp, std::ios::binary | std::ios::trunc);
        if (!Out) { LastError = "cannot write"; return false; }
        Out << Serialise(Preferences);
    }
    std::filesystem::rename(Temp, Target, Ec);
    if (Ec) { LastError = Ec.message(); return false; }
    return true;
}

} // namespace Frontier
