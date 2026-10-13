//============================================================================================================================================
//                                                       TABLETSCREENSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Port of ScreenSequence.js. Coordinates, sizes and colour literals are the prototype's, so the C++ sheet matches the
//    accepted browser render; behaviour differences are called out inline.

#include "TabletScreenSequence.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <utility>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------ specification

namespace {

const TabletApplication kApplications[kTabletApplicationCount] = {
    { "vehicle",    "Vehicle",    "Make it your own",             "Vehicle",  "#a4e5be", nullptr },
    { "drive-room", "Drive Room", "Your people. Your race.",      "Connect",  "#ffcf87", "3" },
    { "messages",   "Messages",   "Keep the conversation going",  "Connect",  "#94caff", "2" },
    { "contacts",   "Contacts",   "People worth driving with",    "Connect",  "#f4b19b", nullptr },
    { "navigation", "Navigation", "Find your next road",          "Vehicle",  "#8fe0d0", nullptr },
    { "media",      "Media",      "Set the pace",                 "Personal", "#efa5d7", nullptr },
    { "tyres",      "Tyres",      "Every corner counts",          "Vehicle",  "#aad9e9", nullptr },
    { "telemetry",  "Telemetry",  "Know your machine",            "Vehicle",  "#cbb2ef", nullptr },
    { "climate",    "Climate",    "Your comfort zone",            "Personal", "#a2dbe7", nullptr },
    { "garage",     "Garage",     "A place for your car",         "Personal", "#e5bf95", nullptr },
    { "account",    "Account",    "Always your space",            "Connect",  "#b9b4f6", nullptr },
    { "settings",   "Settings",   "The little things",            "Personal", "#c5cfd2", nullptr },
};

const char* kDesignNames[5]    = { "Launchpad", "Dashboard", "Collections", "Focus", "Console" };
const char* kDesignCaptions[5] = { "The familiar icon canvas", "Big moments. Small cards.", "A place for everything", "One app takes the stage", "A calm rail. A clear choice." };
const char* kDesignNumbers[5]  = { "01", "02", "03", "04", "05" };
const char* kDesignIdentifiers[5] = { "launchpad", "dashboard", "collections", "focus", "console" };

// IconDepot.js artwork, verbatim.
const char* kIconArtwork[kTabletApplicationCount] = {
    R"(<path d="m13 27 4-11a5 5 0 0 1 5-3h20a5 5 0 0 1 5 3l4 11" fill="#c6f5cc"/><path d="m19 24 3-8h20l3 8" fill="#385f75"/><rect x="10" y="24" width="44" height="24" rx="8" fill="#84d99f"/><rect x="14" y="46" width="7" height="7" rx="2" fill="#31504b"/><rect x="43" y="46" width="7" height="7" rx="2" fill="#31504b"/><path d="m14 29 9 2m18 0 9-2" stroke="#f9ffcf" stroke-width="4" stroke-linecap="round"/><path d="M26 40h12" stroke="#355b59" stroke-width="3" stroke-linecap="round"/>)",
    R"(<path d="M14 17v36" stroke="#71546c" stroke-width="4" stroke-linecap="round"/><path d="M17 15h31v23H17z" fill="#fff0cb"/><path d="M17 15h8v8h-8zm16 0h8v8h-8zm-8 8h8v8h-8zm16 0h7v8h-7zm-24 8h8v7h-8zm16 0h8v7h-8z" fill="#a87391"/><path d="M26 47h24" stroke="#ea9468" stroke-width="4" stroke-linecap="round"/><path d="m43 41 7 6-7 6" stroke="#fff0cf" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>)",
    R"(<path d="M13 15h33a8 8 0 0 1 8 8v17a8 8 0 0 1-8 8H28L15 56l3-8a8 8 0 0 1-5-8z" fill="#397ebe"/><path d="M10 11h31a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H25l-12 8 2-9a8 8 0 0 1-5-7z" fill="#eff8fd"/><circle cx="20" cy="27" r="3" fill="#689fc6"/><circle cx="30" cy="27" r="3" fill="#68b6ac"/><circle cx="40" cy="27" r="3" fill="#e6b562"/>)",
    R"(<circle cx="40" cy="24" r="9" fill="#b388a0"/><path d="M28 49v-6a12 12 0 0 1 24 0v6" fill="#8e7399"/><circle cx="25" cy="22" r="11" fill="#fff0d2"/><path d="M9 51v-8a16 16 0 0 1 32 0v8" fill="#fff0d2"/><path d="M15 45c7-5 14-5 20 0" stroke="#ecaa87" stroke-width="3" stroke-linecap="round"/>)",
    R"(<path d="m9 15 15-5 16 6 15-5v40l-15 5-16-6-15 5z" fill="#edf6cf"/><path d="M24 10v40l16 6V16z" fill="#bbdfbd"/><path d="m12 37 14-8 12 8 13-16" stroke="#519d9c" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M46 15c-9 0-11 10-1 19 10-9 10-19 1-19z" fill="#ee7d75"/><circle cx="46" cy="22" r="3" fill="#fff3d9"/>)",
    R"(<path d="M23 17v29m0-29 24-5v29" stroke="#fff0e3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="17" cy="46" rx="9" ry="7" fill="#fff0e3"/><ellipse cx="41" cy="42" rx="9" ry="7" fill="#7b5397"/><path d="m26 24 18-4" stroke="#9959a3" stroke-width="4" stroke-linecap="round"/>)",
    R"(<ellipse cx="30" cy="33" rx="19" ry="24" fill="#3d6070"/><ellipse cx="30" cy="33" rx="11" ry="16" fill="#d7f3ec"/><ellipse cx="30" cy="33" rx="5" ry="8" fill="#6c9fb5"/><path d="m14 21 7 3m-9 9 7 1m-6 10 7-2m18-21 7-3m-6 17 7-1m-8 10 7 2" stroke="#78a1b2" stroke-width="2.8" stroke-linecap="round"/><circle cx="49" cy="48" r="9" fill="#dbb164"/><path d="M49 43v6m0 4h.01" stroke="#fff2d3" stroke-width="2.5" stroke-linecap="round"/>)",
    R"(<path d="M12 12v39h41" stroke="#f0e9f9" stroke-width="4" fill="none" stroke-linecap="round"/><path d="m19 41 9-14 10 8 13-18" stroke="#6f589b" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="28" cy="27" r="4" fill="#a4dfd0"/><circle cx="38" cy="35" r="4" fill="#efd395"/><circle cx="51" cy="17" r="4" fill="#f0e9f9"/>)",
    R"(<path d="M32 27c-5-14-1-22 7-18 9 4 5 15-7 18zm5 7c15-3 22 1 17 9-5 8-15 3-17-9zm-8 3c-2 15-9 20-15 13-7-7 0-16 15-13zm-4-9C11 22 5 25 8 34c3 9 14 6 17-6z" fill="#ecf8f3"/><circle cx="32" cy="32" r="8" fill="#659ba7"/><circle cx="32" cy="32" r="4" fill="#e9c482"/>)",
    R"(<path d="m8 27 24-17 24 17v28H8z" fill="#f7e5c5"/><path d="M16 28h32v27H16z" fill="#ac8c78"/><path d="M18 34h28m-28 6h28" stroke="#d5b597" stroke-width="2"/><path d="m20 48 3-6h18l3 6v7H20z" fill="#8fbcc9"/><path d="m25 45 1-3h12l1 3" fill="#385f76"/><circle cx="24" cy="51" r="2" fill="#fff0cc"/><circle cx="40" cy="51" r="2" fill="#fff0cc"/>)",
    R"(<rect x="9" y="10" width="46" height="45" rx="11" fill="#7774b2"/><circle cx="31" cy="25" r="10" fill="#f5d9bd"/><path d="M15 48a16 16 0 0 1 32 0" fill="#eff0e2"/><circle cx="49" cy="49" r="9" fill="#a0d5b7"/><path d="m45 49 3 3 5-6" stroke="#41796b" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>)",
    R"(<path d="m28 9 8 0 2 7 6 3 7-2 4 7-5 5v6l5 5-4 7-7-2-6 3-2 7h-8l-2-7-6-3-7 2-4-7 5-5v-6l-5-5 4-7 7 2 6-3z" fill="#f0eee0"/><circle cx="32" cy="32" r="12" fill="#668486"/><circle cx="32" cy="32" r="6" fill="#b1ddd2"/><circle cx="48" cy="17" r="5" fill="#eaa681"/>)",
};
const char* kIconBackgrounds[kTabletApplicationCount][2] = {
    { "#b5ebc6", "#67bd89" }, { "#f9d894", "#e9b16c" }, { "#9bd5f3", "#6ca9df" }, { "#f5c7ab", "#e3917e" }, { "#b3e6cf", "#70c3bd" }, { "#f0b9dd", "#d587bd" },
    { "#b7dee3", "#89bfce" }, { "#d8c8f0", "#a48ccb" }, { "#b1e3e9", "#7abbc8" }, { "#edd7b5", "#c99c74" }, { "#ceccf1", "#9b96cc" }, { "#dbe1dd", "#a4b6b7" },
};

[[nodiscard]] DisplayColour C(const char* Literal) noexcept { return ParseDisplayColour(Literal); }

// Minimal attribute reader for the SVG fragments above: `<tag a="v" b="v"/>` sequences.
struct SvgElement { std::string Tag; std::vector<std::pair<std::string, std::string>> Attributes; [[nodiscard]] const char* Attribute(const char* Name) const noexcept { for (const auto& A : Attributes) if (A.first == Name) return A.second.c_str(); return nullptr; } };

[[nodiscard]] std::vector<SvgElement> ParseSvgFragment(const char* Text) noexcept
{
    std::vector<SvgElement> Elements;
    const char* P = Text;
    while ((P = std::strchr(P, '<')) != nullptr)
    {
        ++P;
        SvgElement E;
        while (*P && *P != ' ' && *P != '/' && *P != '>') E.Tag.push_back(*P++);
        while (*P && *P != '>')
        {
            while (*P == ' ') ++P;
            if (*P == '/' || *P == '>') break;
            std::string Key, Value;
            while (*P && *P != '=' && *P != ' ' && *P != '>') Key.push_back(*P++);
            if (*P == '=') { ++P; if (*P == '"') { ++P; while (*P && *P != '"') Value.push_back(*P++); if (*P == '"') ++P; } }
            if (!Key.empty()) E.Attributes.push_back({ Key, Value });
        }
        if (!E.Tag.empty()) Elements.push_back(E);
    }
    return Elements;
}

[[nodiscard]] DisplayVectorArt DecodeIconArt(const char* Fragment) noexcept
{
    DisplayVectorArt Art;
    for (const SvgElement& E : ParseSvgFragment(Fragment))
    {
        const char* Fill = E.Attribute("fill");
        const char* Stroke = E.Attribute("stroke");
        std::vector<std::vector<DisplayPoint>> Contours;
        if (E.Tag == "path") Contours = DisplayRasterProjection::DecodePathData(E.Attribute("d"));
        else if (E.Tag == "rect")
        {
            const float X = std::strtof(E.Attribute("x") ? E.Attribute("x") : "0", nullptr), Y = std::strtof(E.Attribute("y") ? E.Attribute("y") : "0", nullptr);
            const float W = std::strtof(E.Attribute("width"), nullptr), H = std::strtof(E.Attribute("height"), nullptr);
            const float R = E.Attribute("rx") ? std::strtof(E.Attribute("rx"), nullptr) : 0.0f;
            Contours.push_back(DisplayRasterProjection::ConstructRoundedRectangle(X, Y, W, H, R));
        }
        else if (E.Tag == "circle")
        {
            const float R = std::strtof(E.Attribute("r"), nullptr);
            Contours.push_back(DisplayRasterProjection::ConstructEllipse(std::strtof(E.Attribute("cx"), nullptr), std::strtof(E.Attribute("cy"), nullptr), R, R));
        }
        else if (E.Tag == "ellipse")
            Contours.push_back(DisplayRasterProjection::ConstructEllipse(std::strtof(E.Attribute("cx"), nullptr), std::strtof(E.Attribute("cy"), nullptr),
                                                                          std::strtof(E.Attribute("rx"), nullptr), std::strtof(E.Attribute("ry"), nullptr)));
        else continue;
        if (Fill && std::strcmp(Fill, "none") != 0)
        {
            DisplayVectorShape S; S.Filled = true; S.Colour = C(Fill); S.Contours = Contours; Art.Shapes.push_back(std::move(S));
        }
        else if (!Fill && !Stroke)   // SVG default fill is black
        {
            DisplayVectorShape S; S.Filled = true; S.Colour = C("#000000"); S.Contours = Contours; Art.Shapes.push_back(std::move(S));
        }
        if (Stroke)
        {
            DisplayVectorShape S; S.Filled = false; S.Colour = C(Stroke);
            S.StrokeWidth = E.Attribute("stroke-width") ? std::strtof(E.Attribute("stroke-width"), nullptr) : 1.0f;
            // Closed subpaths ('z') come back with their first point repeated by the decoder only when a command
            //    follows; a stroked closed path is not used by the depot, so Closed stays false.
            S.Contours = Contours; Art.Shapes.push_back(std::move(S));
        }
    }
    return Art;
}

} // namespace

const TabletApplication* QueryTabletApplications() noexcept { return kApplications; }
const char* QueryLauncherDesignName(LauncherDesignCategory Design) noexcept { return kDesignNames[static_cast<uint32_t>(Design) % 5u]; }
const char* QueryLauncherDesignCaption(LauncherDesignCategory Design) noexcept { return kDesignCaptions[static_cast<uint32_t>(Design) % 5u]; }

//------------------------------------------------------------------------------------------------------------------------ lifecycle

TabletScreenSequence::TabletScreenSequence() noexcept
{
    Messages.push_back({ "Amelia", "Same road. New adventure?" });
    Messages.push_back({ "You", "See you in the Drive Room." });
    IconArt.resize(kTabletApplicationCount);
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I) IconArt[I] = DecodeIconArt(kIconArtwork[I]);
    (void)PresentAspect(kTabletDesignWidth / kTabletDesignHeight, 1.5f);
}

void TabletScreenSequence::AssignTypefaces(TypefaceSheetCodec* Light, TypefaceSheetCodec* Regular, TypefaceSheetCodec* Medium) noexcept
{
    Faces[0] = Light; Faces[1] = Regular; Faces[2] = Medium; Dirty = true;
}

void TabletScreenSequence::AssignReading(const TabletReading& NewReading) noexcept
{
    // Only redraw when a value the screen shows has changed; the status bar shows speed to the km/h and the gear.
    const bool Changed = std::lround(NewReading.SpeedKph) != std::lround(Reading.SpeedKph) || std::strcmp(NewReading.Gear, Reading.Gear) != 0 ||
                         NewReading.Live != Reading.Live || std::lround(NewReading.AmbientCelsius) != std::lround(Reading.AmbientCelsius) ||
                         (Application == "telemetry" || Application == "tyres");
    Reading = NewReading;
    if (Changed) Dirty = true;
}

bool TabletScreenSequence::PresentAspect(float Aspect, float NewScale) noexcept
{
    const float Reference = kTabletDesignWidth / kTabletDesignHeight;
    Scale = NewScale;
    PanelWidth  = Aspect >= Reference ? kTabletDesignHeight * Aspect : kTabletDesignWidth;
    PanelHeight = Aspect >= Reference ? kTabletDesignHeight : kTabletDesignWidth / Aspect;
    OffsetAcross = 0.5f * (PanelWidth - kTabletDesignWidth);
    OffsetDown   = 0.5f * (PanelHeight - kTabletDesignHeight);
    Dirty = true;
    return Sheet.Resize(static_cast<uint32_t>(std::lround(PanelWidth * Scale)), static_cast<uint32_t>(std::lround(PanelHeight * Scale)));
}

bool TabletScreenSequence::PresentDesign(LauncherDesignCategory NewDesign) noexcept
{
    if (static_cast<uint32_t>(NewDesign) >= 5u) return false;
    Design = NewDesign;
    PresentHome();
    return true;
}

void TabletScreenSequence::PresentHome() noexcept
{
    Application.clear(); Notice.clear(); Hovered.clear(); Pressed.clear(); TextTarget.clear();
    PointerHeld = false;
    Dirty = true;
}

bool TabletScreenSequence::PresentApplication(const char* Identifier) noexcept
{
    bool Known = false;
    for (const TabletApplication& A : kApplications) if (std::strcmp(A.Identifier, Identifier) == 0) Known = true;
    if (!Known) return false;
    Application = Identifier; Notice.clear(); Hovered.clear(); Pressed.clear(); TextTarget.clear();
    Dirty = true;
    return true;
}

void TabletScreenSequence::AdvanceClock(int Hour, int Minute) noexcept
{
    char Buffer[8];
    std::snprintf(Buffer, sizeof(Buffer), "%02d:%02d", Hour % 24, Minute % 60);
    if (Clock != Buffer) { Clock = Buffer; Dirty = true; }
}

//------------------------------------------------------------------------------------------------------------------------ primitives

void TabletScreenSequence::RasterRectangle(float L, float T, float W, float H, float R, const DisplayPaint& Paint, const char* Stroke) noexcept
{
    Raster_.FillRectangle(L, T, W, H, R, Paint);
    if (Stroke) Raster_.StrokeRectangle(L, T, W, H, R, 1.0f, C(Stroke));
}

void TabletScreenSequence::RasterText(const char* Text, float L, float T, float Size, const char* Colour, DisplayTextAlignment Align, DisplayTextWeight Weight) noexcept
{
    (void)Raster_.Text(Text, L, T, Size, C(Colour), Align, Weight);
}

const DisplaySheetStructure& TabletScreenSequence::IconSheet(uint32_t ApplicationIndex, uint32_t PixelExtent) noexcept
{
    for (IconRecord& I : Icons) if (I.Application == ApplicationIndex && I.Extent == PixelExtent) return I.Sheet;
    Icons.push_back(IconRecord{ ApplicationIndex, PixelExtent, DisplaySheetStructure(PixelExtent, PixelExtent) });
    IconRecord& Record = Icons.back();
    DisplayRasterProjection Icon;
    Icon.Begin(Record.Sheet, PixelExtent / 64.0f, 0.0f, 0.0f, nullptr, nullptr, nullptr);
    Icon.FillRectangle(1.0f, 1.0f, 62.0f, 62.0f, 15.0f, DisplayPaint::Linear(0.0f, 0.0f, 64.0f, 64.0f, C(kIconBackgrounds[ApplicationIndex][0]), C(kIconBackgrounds[ApplicationIndex][1])));
    Icon.DrawVectorArt(IconArt[ApplicationIndex], 0.0f, 0.0f, 64.0f);
    return Record.Sheet;
}

void TabletScreenSequence::RasterIcon(uint32_t ApplicationIndex, float L, float T, float Extent) noexcept
{
    const uint32_t Pixels = std::max(8u, static_cast<uint32_t>(std::lround(Extent * Scale)));
    Raster_.BlitSheet(IconSheet(ApplicationIndex, Pixels), L, T, Extent, Extent);
}

void TabletScreenSequence::RasterRule(float L, float T, float W, const char* Colour) noexcept { Raster_.FillRectangle(L, T, W, 1.0f, 0.0f, C(Colour)); }

void TabletScreenSequence::RasterBadge(const char* Text, float CentreX, float CentreY) noexcept
{
    RasterRectangle(CentreX - 12.0f, CentreY - 10.0f, 24.0f, 20.0f, 10.0f, C("#d3b3a3"));
    RasterText(Text, CentreX, CentreY + 4.0f, 12.0f, "#3e3633", DisplayTextAlignment::Centre);
}

TabletScreenSequence::Region& TabletScreenSequence::AdmitRegion(const char* Identifier, float L, float T, float W, float H, ActionCategory Action, const char* Argument) noexcept
{
    Region R; R.Identifier = Identifier; R.Left = L; R.Top = T; R.Width = W; R.Height = H; R.Action = Action; R.Argument = Argument ? Argument : "";
    Regions.push_back(std::move(R));
    return Regions.back();
}

void TabletScreenSequence::RasterButton(const char* Identifier, const char* Text, float L, float T, float W, float H, ActionCategory Action, const char* Argument, const char* Colour, const char* Ink) noexcept
{
    const bool Hover = Hovered == Identifier;
    RasterRectangle(L, T, W, H, 14.0f, C(Hover ? "#466057" : Colour));
    RasterText(Text, L + W / 2.0f, T + H / 2.0f + 7.0f, 19.0f, Ink, DisplayTextAlignment::Centre);
    (void)AdmitRegion(Identifier, L, T, W, H, Action, Argument);
}

void TabletScreenSequence::RasterBackground(bool Light) noexcept
{
    RasterRectangle(-OffsetAcross, -OffsetDown, PanelWidth, PanelHeight, 0.0f,
                    DisplayPaint::Linear(0.0f, 0.0f, kTabletDesignWidth, kTabletDesignHeight, C(Light ? "#f1f1e7" : "#17262c"), C(Light ? "#dfe8db" : "#121a22")));
    RasterRectangle(-OffsetAcross, -OffsetDown, PanelWidth, PanelHeight, 0.0f,
                    DisplayPaint::Radial(1010.0f, 70.0f, 20.0f, 670.0f, C(Light ? "#ffffff85" : "#8eb29b26"), C("#8eb29b00")));
}

void TabletScreenSequence::RasterStatus(bool Light) noexcept
{
    const char* Ink = Light ? "#394a46" : "#dae8e3";
    const char* Muted = Light ? "#86948a" : "#82978e";
    char Speed[16]; std::snprintf(Speed, sizeof(Speed), "%d", static_cast<int>(std::lround(std::fabs(Reading.SpeedKph))));
    RasterText("F R O N T I E R", 48.0f, 49.0f, 15.0f, Ink);
    RasterText(Reading.Gear, 242.0f, 49.0f, 16.0f, Muted);
    RasterText(Speed, 269.0f, 49.0f, 24.0f, Ink);
    RasterText("km/h", 269.0f + Raster_.MeasureText(Speed, 24.0f) + 6.0f, 49.0f, 12.0f, Muted);
    Raster_.FillCircle(941.0f, 42.0f, 3.0f, C(Reading.Live ? "#8dac8c" : "#c9a35d"));
    RasterText(Reading.Live ? "LIVE VEHICLE" : "LOCAL DEMO", 953.0f, 48.0f, 11.0f, Muted);
    RasterText(Clock.c_str(), 1150.0f, 49.0f, 17.0f, Ink, DisplayTextAlignment::Right);
    RasterRule(48.0f, 74.0f, 1104.0f, Light ? "#283c2812" : "#ffffff0b");
}

void TabletScreenSequence::RasterFooter(bool Light) noexcept
{
    const char* Ink = Light ? "#5b6d5f" : "#879d92";
    std::string Name = Reading.VehicleName ? Reading.VehicleName : "";
    for (char& Ch : Name) Ch = static_cast<char>(std::toupper(static_cast<unsigned char>(Ch)));
    char Ambient[16]; std::snprintf(Ambient, sizeof(Ambient), "%d°", static_cast<int>(std::lround(Reading.AmbientCelsius)));
    RasterText(Name.c_str(), 50.0f, 708.0f, 12.0f, Ink);
    RasterText(Ambient, 1096.0f, 708.0f, 19.0f, Ink);
    RasterText("AUTO", 1129.0f, 708.0f, 10.0f, Ink);
    RasterRectangle(553.0f, 697.0f, 94.0f, 5.0f, 3.0f, C(Light ? "#8a9a8655" : "#e2eadd50"));
    (void)AdmitRegion("home", 505.0f, 678.0f, 190.0f, 50.0f, ActionCategory::Home);
    (void)AdmitRegion("climate-shortcut", 1070.0f, 678.0f, 88.0f, 50.0f, ActionCategory::Application, "climate");
}

void TabletScreenSequence::RasterApplicationTile(uint32_t Index, float L, float T, float W, float H, int Style, bool Light) noexcept
{
    const TabletApplication& A = kApplications[Index];
    const std::string Identifier = std::string("app:") + A.Identifier;
    const bool Hover = Hovered == Identifier, IsPressed = Pressed == Identifier;
    const char* Ink = Light ? "#33453d" : "#e4ebe5";
    if (Style == 0)   // icon
    {
        if (Hover || IsPressed) RasterRectangle(L + 8.0f, T, W - 16.0f, H, 22.0f, C(Light ? "#ffffff90" : "#ffffff0b"));
        RasterIcon(Index, L + (W - 85.0f) / 2.0f, T + 17.0f, 85.0f);
        RasterText(A.Name, L + W / 2.0f, T + 129.0f, 21.0f, Ink, DisplayTextAlignment::Centre);
        if (A.Badge) RasterBadge(A.Badge, L + W / 2.0f + 42.0f, T + 13.0f);
    }
    else if (Style == 1)   // row
    {
        RasterRectangle(L, T, W, H, 18.0f, C(Hover ? "#41574c" : "#ffffff09"));
        RasterIcon(Index, L + 16.0f, T + (H - 55.0f) / 2.0f, 55.0f);
        RasterText(A.Name, L + 86.0f, T + 37.0f, 20.0f, Ink);
        RasterText(A.Caption, L + 86.0f, T + 60.0f, 12.0f, Light ? "#7d8e79" : "#879b90");
        if (A.Badge) RasterBadge(A.Badge, L + W - 20.0f, T + 17.0f);
    }
    else   // card
    {
        RasterRectangle(L, T, W, H, 24.0f, DisplayPaint::Linear(L, T, L + W, T + H, C(Hover ? "#3c5548" : "#ffffff0d"), C("#ffffff04")), "#ffffff0a");
        RasterIcon(Index, L + 21.0f, T + 20.0f, 58.0f);
        RasterText(A.Name, L + 22.0f, T + 108.0f, 23.0f, Ink);
        if (H > 145.0f) RasterText(A.Caption, L + 22.0f, T + 133.0f, 12.0f, "#91a496");
        if (A.Badge) RasterBadge(A.Badge, L + W - 23.0f, T + 22.0f);
    }
    (void)AdmitRegion(Identifier.c_str(), L, T, W, H, ActionCategory::Application, A.Identifier);
}

//------------------------------------------------------------------------------------------------------------------------ values

float& TabletScreenSequence::ValueAt(TabletValues& V, int Index) noexcept
{
    switch (Index)
    {
    case 0: return V.Steering; case 1: return V.Height; case 2: return V.Stiffness; case 3: return V.Spoiler; case 4: return V.Pressure;
    case 5: return V.Temperature; case 6: return V.Fan; case 7: return V.Volume; case 8: return V.Brightness; case 9: return V.Laps; default: return V.Zoom;
    }
}

int TabletScreenSequence::ValueIndex(const char* Identifier) noexcept
{
    static const char* Names[11] = { "steering", "height", "stiffness", "spoiler", "pressure", "temperature", "fan", "volume", "brightness", "laps", "zoom" };
    for (int I = 0; I < 11; ++I) if (std::strcmp(Names[I], Identifier) == 0) return I;
    return 10;
}

void TabletScreenSequence::RasterSlider(int Value, const char* Identifier, const char* Name, const char* Unit, float L, float T, float W, float Minimum, float Maximum, float Step) noexcept
{
    const float V = ValueAt(Values, Value);
    char Label[48];
    if (std::fabs(V - std::round(V)) < 1.0e-3f) std::snprintf(Label, sizeof(Label), "%d%s", static_cast<int>(std::lround(V)), Unit);
    else std::snprintf(Label, sizeof(Label), "%.2g%s", V, Unit);
    RasterText(Name, L, T, 22.0f, "#d8e4d5");
    RasterText(Label, L + W, T, 24.0f, "#b5d4a8", DisplayTextAlignment::Right);
    RasterRectangle(L, T + 29.0f, W, 5.0f, 3.0f, C("#3b4b42"));
    const float Fraction = (V - Minimum) / (Maximum - Minimum);
    RasterRectangle(L, T + 29.0f, std::max(2.0f, W * Fraction), 5.0f, 3.0f, C("#a3c394"));
    Raster_.FillCircle(L + W * Fraction, T + 31.0f, 10.0f, C("#dce9ce"));
    Region& R = AdmitRegion((std::string("slider:") + Identifier).c_str(), L - 12.0f, T + 6.0f, W + 24.0f, 49.0f, ActionCategory::None);
    R.SliderValue = Value; R.TrackLeft = L; R.TrackWidth = W; R.Minimum = Minimum; R.Maximum = Maximum; R.Step = Step;
}

//------------------------------------------------------------------------------------------------------------------------ launchers

void TabletScreenSequence::RasterLaunchpad() noexcept
{
    RasterBackground(false); RasterStatus(false);
    RasterText(("Welcome back, " + Nickname + ".").c_str(), 56.0f, 158.0f, 41.0f, "#ebefdf", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("Your car. Your people. Your space.", 57.0f, 197.0f, 17.0f, "#82968d");
    RasterRectangle(986.0f, 120.0f, 155.0f, 68.0f, 19.0f, C("#b1c5a115"));
    RasterText("ALL APPS", 1008.0f, 146.0f, 10.0f, "#9faf98");
    RasterText("12", 1008.0f, 176.0f, 25.0f, "#d3dec7");
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I)
        RasterApplicationTile(I, 40.0f + (I % 6u) * 188.0f, 255.0f + (I / 6u) * 181.0f, 176.0f, 149.0f, 0, false);
    RasterFooter(false);
}

void TabletScreenSequence::RasterDashboard() noexcept
{
    RasterBackground(false); RasterStatus(false);
    RasterText("A good day to drive.", 50.0f, 151.0f, 40.0f, "#e4eddc", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("Your essentials, brought together.", 52.0f, 184.0f, 16.0f, "#83988a");
    RasterRectangle(50.0f, 220.0f, 340.0f, 392.0f, 29.0f, DisplayPaint::Linear(50.0f, 218.0f, 385.0f, 600.0f, C("#bbd2b0"), C("#86a698")));
    RasterText("YOUR VEHICLE", 78.0f, 264.0f, 12.0f, "#557362");
    RasterIcon(0u, 123.0f, 295.0f, 192.0f);
    RasterText(Reading.VehicleName, 78.0f, 531.0f, 33.0f, "#253e33", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("Ready when you are.", 79.0f, 562.0f, 15.0f, "#577867");
    RasterText("Explore  →", 79.0f, 589.0f, 15.0f, "#304f3c");
    (void)AdmitRegion("app:vehicle", 50.0f, 220.0f, 340.0f, 392.0f, ActionCategory::Application, "vehicle");
    uint32_t Card = 0u;
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I)
    {
        const char* Id = kApplications[I].Identifier;
        if (std::strcmp(Id, "vehicle") == 0 || std::strcmp(Id, "account") == 0 || std::strcmp(Id, "settings") == 0) continue;
        RasterApplicationTile(I, 411.0f + (Card % 3u) * 246.0f, 220.0f + (Card / 3u) * 132.0f, 230.0f, 116.0f, 2, false);
        ++Card;
    }
    RasterIcon(10u, 54.0f, 631.0f, 28.0f);
    RasterText(Nickname.c_str(), 94.0f, 653.0f, 15.0f, "#95aa97");
    (void)AdmitRegion("app:account", 50.0f, 623.0f, 140.0f, 40.0f, ActionCategory::Application, "account");
    RasterIcon(11u, 1010.0f, 630.0f, 27.0f);
    RasterText("Settings", 1050.0f, 651.0f, 15.0f, "#95aa97");
    (void)AdmitRegion("app:settings", 997.0f, 623.0f, 148.0f, 40.0f, ActionCategory::Application, "settings");
    RasterFooter(false);
}

void TabletScreenSequence::RasterCollections() noexcept
{
    RasterBackground(true); RasterStatus(true);
    RasterText("Everything in its place.", 53.0f, 154.0f, 40.0f, "#2f473b", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("A little less searching. A little more driving.", 55.0f, 191.0f, 16.0f, "#82947f");
    const char* Categories[3] = { "Vehicle", "Connect", "Personal" };
    const char* Colours[3] = { "#d5e5d4", "#e0dfcf", "#d8e0e5" };
    const char* Numbers[3] = { "01", "02", "03" };
    for (uint32_t Column = 0u; Column < 3u; ++Column)
    {
        const float Left = 49.0f + Column * 375.0f;
        RasterRectangle(Left, 234.0f, 351.0f, 414.0f, 29.0f, C(Colours[Column]));
        RasterText(Categories[Column], Left + 27.0f, 280.0f, 26.0f, "#3c5443");
        RasterText(Numbers[Column], Left + 318.0f, 279.0f, 13.0f, "#94a28d", DisplayTextAlignment::Right);
        uint32_t Row = 0u;
        for (uint32_t I = 0u; I < kTabletApplicationCount; ++I)
        {
            if (std::strcmp(kApplications[I].Category, Categories[Column]) != 0) continue;
            const float Top = 305.0f + Row * 80.0f;
            const std::string Identifier = std::string("app:") + kApplications[I].Identifier;
            RasterRectangle(Left + 13.0f, Top, 325.0f, 70.0f, 15.0f, C(Hovered == Identifier ? "#ffffff98" : "#ffffff40"));
            RasterIcon(I, Left + 25.0f, Top + 11.0f, 48.0f);
            RasterText(kApplications[I].Name, Left + 91.0f, Top + 39.0f, 20.0f, "#425540");
            RasterText("›", Left + 312.0f, Top + 39.0f, 24.0f, "#8b9e82", DisplayTextAlignment::Right);
            (void)AdmitRegion(Identifier.c_str(), Left + 13.0f, Top, 325.0f, 70.0f, ActionCategory::Application, kApplications[I].Identifier);
            ++Row;
        }
    }
    RasterFooter(true);
}

void TabletScreenSequence::RasterFocus() noexcept
{
    RasterBackground(false); RasterStatus(false);
    RasterText("Make room for what matters.", 53.0f, 144.0f, 37.0f, "#e3eddf", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("Swipe to explore. Tap to step inside.", 55.0f, 179.0f, 15.0f, "#859b8e");
    for (int Offset = -1; Offset <= 1; ++Offset)
    {
        const uint32_t Index = (FocusIndex + static_cast<uint32_t>(Offset + static_cast<int>(kTabletApplicationCount))) % kTabletApplicationCount;
        const TabletApplication& A = kApplications[Index];
        const float Centre = 600.0f + Offset * 406.0f;
        const bool Main = Offset == 0;
        const float Width = Main ? 375.0f : 286.0f, Top = Main ? 220.0f : 252.0f, Height = Main ? 342.0f : 278.0f;
        RasterRectangle(Centre - Width / 2.0f, Top, Width, Height, 27.0f,
                        DisplayPaint::Linear(Centre, Top, Centre, Top + Height, C(Main ? "#d7dfc6" : "#253936"), C(Main ? "#a3bba3" : "#1d2c2c")));
        RasterIcon(Index, Centre - (Main ? 55.0f : 37.0f), Top + 38.0f, Main ? 110.0f : 74.0f);
        RasterText(A.Name, Centre, Top + (Main ? 201.0f : 158.0f), Main ? 32.0f : 24.0f, Main ? "#314b39" : "#c0d4c2", DisplayTextAlignment::Centre, DisplayTextWeight::Light);
        RasterText(A.Caption, Centre, Top + (Main ? 232.0f : 185.0f), 13.0f, Main ? "#698269" : "#7d9783", DisplayTextAlignment::Centre);
        RasterText(Main ? "Open application  →" : "Tap to focus", Centre, Top + Height - 32.0f, Main ? 17.0f : 13.0f, Main ? "#466749" : "#87a18a", DisplayTextAlignment::Centre);
        char FocusId[32]; std::snprintf(FocusId, sizeof(FocusId), "focus:%u", Index);
        char IndexText[8]; std::snprintf(IndexText, sizeof(IndexText), "%u", Index);
        Region& R = Main ? AdmitRegion((std::string("app:") + A.Identifier).c_str(), Centre - Width / 2.0f, Top, Width, Height, ActionCategory::Application, A.Identifier)
                         : AdmitRegion(FocusId, Centre - Width / 2.0f, Top, Width, Height, ActionCategory::FocusIndex, IndexText);
        R.Swipe = true;
    }
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I)
    {
        const float Left = 176.0f + I * 71.0f;
        if (I == FocusIndex) RasterRectangle(Left - 9.0f, 598.0f, 57.0f, 57.0f, 16.0f, C("#b8d5a320"));
        RasterIcon(I, Left, 607.0f, 39.0f);
        char IndexText[8]; std::snprintf(IndexText, sizeof(IndexText), "%u", I);
        (void)AdmitRegion((std::string("focus-choice:") + kApplications[I].Identifier).c_str(), Left - 9.0f, 598.0f, 57.0f, 57.0f, ActionCategory::FocusIndex, IndexText);
    }
    RasterFooter(false);
}

void TabletScreenSequence::RasterConsole() noexcept
{
    RasterBackground(false);
    RasterRectangle(-OffsetAcross, -OffsetDown, 250.0f + OffsetAcross, PanelHeight, 0.0f, C("#edf0e3"));
    char Speed[16]; std::snprintf(Speed, sizeof(Speed), "%d", static_cast<int>(std::lround(std::fabs(Reading.SpeedKph))));
    std::string GearLine = std::string(Reading.Gear) + "  ·  " + (std::strcmp(Reading.Gear, "P") == 0 ? "PARKED" : Reading.Live ? "DRIVING" : "DEMO");
    RasterText("F R O N T I E R", 34.0f, 51.0f, 13.0f, "#62745f");
    RasterText(Speed, 125.0f, 184.0f, 93.0f, "#344739", DisplayTextAlignment::Centre, DisplayTextWeight::Light);
    RasterText("km/h", 125.0f, 216.0f, 15.0f, "#8c9b80", DisplayTextAlignment::Centre);
    RasterRectangle(75.0f, 244.0f, 100.0f, 31.0f, 15.0f, C("#dce5d2"));
    RasterText(GearLine.c_str(), 125.0f, 264.0f, 11.0f, "#6e8362", DisplayTextAlignment::Centre);
    RasterIcon(0u, 65.0f, 351.0f, 120.0f);
    RasterText(Reading.VehicleName, 125.0f, 517.0f, 20.0f, "#465e42", DisplayTextAlignment::Centre);
    RasterText(("Welcome, " + Nickname).c_str(), 125.0f, 549.0f, 13.0f, "#899b7e", DisplayTextAlignment::Centre);
    RasterRule(42.0f, 611.0f, 166.0f, "#617a4b22");
    RasterText(Reading.Live ? "LIVE" : "LOCAL", 125.0f, 656.0f, 10.0f, "#82986f", DisplayTextAlignment::Centre);
    RasterText("YOUR APPS", 290.0f, 52.0f, 12.0f, "#8a9d89");
    RasterText(Clock.c_str(), 1151.0f, 52.0f, 17.0f, "#a9bba4", DisplayTextAlignment::Right);
    RasterText("Choose your next move.", 290.0f, 143.0f, 35.0f, "#e0ebd6", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText("Simple controls. Clear choices.", 292.0f, 177.0f, 15.0f, "#849b80");
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I)
        RasterApplicationTile(I, 286.0f + (I % 3u) * 293.0f, 218.0f + (I / 3u) * 111.0f, 276.0f, 94.0f, 1, false);
    RasterRectangle(670.0f, 697.0f, 86.0f, 5.0f, 3.0f, C("#dbe8cc40"));
    (void)AdmitRegion("home", 625.0f, 678.0f, 180.0f, 50.0f, ActionCategory::Home);
}

//------------------------------------------------------------------------------------------------------------------------ applications

void TabletScreenSequence::RasterApplication() noexcept
{
    RasterBackground(false); RasterStatus(false);
    uint32_t Index = 0u;
    for (uint32_t I = 0u; I < kTabletApplicationCount; ++I) if (Application == kApplications[I].Identifier) Index = I;
    const TabletApplication& A = kApplications[Index];
    RasterButton("back", "‹  Apps", 48.0f, 103.0f, 107.0f, 48.0f, ActionCategory::Home, "", "#ffffff0b");
    RasterIcon(Index, 190.0f, 97.0f, 65.0f);
    RasterText(A.Name, 273.0f, 136.0f, 35.0f, "#e3eddd", DisplayTextAlignment::Left, DisplayTextWeight::Light);
    RasterText(A.Caption, 274.0f, 164.0f, 15.0f, "#879e89");
    RasterText(Reading.Live ? "LIVE VEHICLE" : "LOCAL DEMONSTRATION", 1140.0f, 133.0f, 10.0f, "#8ea18c", DisplayTextAlignment::Right);
    RasterRectangle(48.0f, 209.0f, 1104.0f, 430.0f, 28.0f, C("#ffffff06"), "#ffffff0b");
    RasterApplicationContent(A.Identifier);
    RasterText(Notice.empty() ? (Reading.Live ? "Vehicle readings are live from the simulation · no online service is connected" : "Design prototype · no live vehicle or online service is connected") : Notice.c_str(),
               64.0f, 665.0f, 12.0f, "#708875");
    RasterFooter(false);
}

void TabletScreenSequence::RasterApplicationContent(const char* Identifier) noexcept
{
    auto Is = [&](const char* Name) { return std::strcmp(Identifier, Name) == 0; };
    if (Is("vehicle"))
    {
        RasterText("VEHICLE SETUP", 79.0f, 256.0f, 12.0f, "#8fa487");
        const char* Tabs[3] = { "Steering", "Suspension", "Aerodynamics" };
        for (uint32_t I = 0u; I < 3u; ++I)
        {
            const bool Active = VehicleTab == Tabs[I];
            RasterButton((std::string("tab:") + Tabs[I]).c_str(), Tabs[I], 80.0f + I * 245.0f, 279.0f, 229.0f, 50.0f, ActionCategory::VehicleTab, Tabs[I],
                         Active ? "#a6c396" : "#243931", Active ? "#304734" : "#acbba8");
        }
        if (VehicleTab == "Steering")
        {
            RasterSlider(0, "steering", "Mouse steering sensitivity", "%", 93.0f, 410.0f, 686.0f, 10.0f, 100.0f);
            RasterText("Fine adjustment for your next drive.", 93.0f, 478.0f, 17.0f, "#859b80");
        }
        else if (VehicleTab == "Suspension")
        {
            RasterSlider(1, "height", "Ride height", " mm", 93.0f, 389.0f, 686.0f, 15.0f, 70.0f);
            RasterSlider(2, "stiffness", "Spring stiffness", "%", 93.0f, 497.0f, 686.0f, 20.0f, 100.0f);
        }
        else RasterSlider(3, "spoiler", "Rear wing angle", "°", 93.0f, 409.0f, 686.0f, 4.0f, 22.0f);
        RasterIcon(0u, 891.0f, 374.0f, 135.0f);
        RasterButton("vehicle-reset", "Restore defaults", 91.0f, 555.0f, 205.0f, 49.0f, ActionCategory::VehicleReset, "");
    }
    else if (Is("drive-room"))
    {
        RasterText("THE EVENING DRIVE", 82.0f, 265.0f, 14.0f, "#91a286");
        RasterText("Your room. Your rules.", 80.0f, 313.0f, 34.0f, "#d9e6ca", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        const char* Names[3] = { "Aladin", "Amelia", "Noah" };
        for (uint32_t I = 0u; I < 3u; ++I)
        {
            RasterRectangle(80.0f, 345.0f + I * 72.0f, 527.0f, 58.0f, 16.0f, C("#b7d0980b"));
            RasterText(I == 0u ? Nickname.c_str() : Names[I], 107.0f, 382.0f + I * 72.0f, 20.0f, "#c2d8b6");
            RasterText(I == 0u ? "YOU" : "DEMO CONTACT", 583.0f, 382.0f + I * 72.0f, 10.0f, "#809b6d", DisplayTextAlignment::Right);
        }
        RasterText("Highlands Loop", 688.0f, 317.0f, 26.0f, "#cfdec3");
        RasterSlider(9, "laps", "Laps", "", 688.0f, 399.0f, 379.0f, 1.0f, 20.0f);
        RasterButton("ready", RoomReady ? "Ready" : "Mark as ready", 688.0f, 510.0f, 379.0f, 64.0f, ActionCategory::ToggleReady, "",
                     RoomReady ? "#b6ca99" : "#33513c", RoomReady ? "#385032" : "#c4d8b4");
    }
    else if (Is("messages"))
    {
        RasterText("AMELIA", 85.0f, 265.0f, 15.0f, "#9db6a1");
        const size_t First = Messages.size() > 4u ? Messages.size() - 4u : 0u;
        for (size_t I = First; I < Messages.size(); ++I)
        {
            const Message& M = Messages[I];
            const bool Own = M.From == "You";
            const float Left = Own ? 419.0f : 85.0f, Row = static_cast<float>(I - First);
            RasterRectangle(Left, 286.0f + Row * 65.0f, 650.0f, 52.0f, 15.0f, C(Own ? "#abc1a726" : "#edf8ef0a"));
            RasterText(M.Text.substr(0, 62).c_str(), Left + 19.0f, 319.0f + Row * 65.0f, 18.0f, Own ? "#cee6bd" : "#c1d8c8");
        }
        RasterRectangle(83.0f, 575.0f, 800.0f, 44.0f, 12.0f, C("#12221c"));
        RasterText(MessageDraft.empty() ? "Write a message…" : MessageDraft.c_str(), 102.0f, 604.0f, 18.0f, MessageDraft.empty() ? "#78917b" : "#d9ead0");
        (void)AdmitRegion("message-input", 83.0f, 575.0f, 800.0f, 44.0f, ActionCategory::ReceiveText, "message");
        RasterButton("send-message", "Send", 904.0f, 575.0f, 181.0f, 44.0f, ActionCategory::SendMessage, "", "#a6c795", "#34512e");
    }
    else if (Is("contacts"))
    {
        const char* Names[3] = { "Amelia", "Noah", "Zara" };
        for (uint32_t I = 0u; I < 3u; ++I)
        {
            const float Top = 269.0f + I * 104.0f;
            RasterIcon(3u, 86.0f, Top, 66.0f);
            RasterText(Names[I], 174.0f, Top + 30.0f, 24.0f, "#d9e4cc");
            RasterText("Demo contact", 175.0f, Top + 58.0f, 14.0f, "#7d997d");
            RasterButton((std::string("invite:") + Names[I]).c_str(), Invited == Names[I] ? "Invited" : "Invite to room", 830.0f, Top + 5.0f, 255.0f, 55.0f, ActionCategory::Invite, Names[I]);
        }
    }
    else if (Is("account"))
    {
        RasterIcon(10u, 85.0f, 277.0f, 134.0f);
        RasterText("YOUR PROFILE", 271.0f, 281.0f, 12.0f, "#8d9d8b");
        RasterText(Nickname.c_str(), 268.0f, 331.0f, 40.0f, "#d6e8c9", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        RasterText("A local profile for this design study.", 270.0f, 367.0f, 18.0f, "#7d9679");
        RasterButton("rename", "Edit display name", 269.0f, 407.0f, 270.0f, 55.0f, ActionCategory::ReceiveText, "nickname");
        RasterText("Display name", 269.0f, 526.0f, 17.0f, "#85997d");
        RasterRectangle(267.0f, 546.0f, 560.0f, 47.0f, 12.0f, C("#12221c"));
        RasterText(Nickname.c_str(), 287.0f, 577.0f, 20.0f, "#d1e7c2");
        (void)AdmitRegion("nickname-input", 267.0f, 546.0f, 560.0f, 47.0f, ActionCategory::ReceiveText, "nickname");
        RasterButton("save-name", "Done", 850.0f, 546.0f, 236.0f, 47.0f, ActionCategory::SaveName, "");
    }
    else if (Is("climate"))
    {
        char Temperature[16]; std::snprintf(Temperature, sizeof(Temperature), "%d°", static_cast<int>(std::lround(Values.Temperature)));
        RasterText("SET YOUR COMFORT", 86.0f, 263.0f, 13.0f, "#8ca68a");
        RasterText(Temperature, 354.0f, 418.0f, 114.0f, "#dcebcf", DisplayTextAlignment::Centre, DisplayTextWeight::Light);
        RasterButton("colder", "−", 144.0f, 458.0f, 88.0f, 62.0f, ActionCategory::Increment, "temperature");
        Regions.back().Number = -1.0f; Regions.back().Minimum = 16.0f; Regions.back().Maximum = 29.0f;
        RasterButton("warmer", "+", 476.0f, 458.0f, 88.0f, 62.0f, ActionCategory::Increment, "temperature");
        Regions.back().Number = 1.0f; Regions.back().Minimum = 16.0f; Regions.back().Maximum = 29.0f;
        RasterIcon(8u, 847.0f, 285.0f, 120.0f);
        RasterSlider(6, "fan", "Fan speed", "", 687.0f, 494.0f, 378.0f, 0.0f, 5.0f);
    }
    else if (Is("tyres"))
    {
        RasterIcon(6u, 85.0f, 281.0f, 135.0f);
        RasterText("FOUR CORNERS. ONE DRIVE.", 267.0f, 276.0f, 12.0f, "#90a995");
        RasterText("Cold pressure", 268.0f, 324.0f, 33.0f, "#dbe7d6", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        RasterSlider(4, "pressure", "Selected pressure", " kPa", 269.0f, 420.0f, 752.0f, 140.0f, 240.0f);
        char Line[128];
        std::snprintf(Line, sizeof(Line), "FL %d°C       FR %d°C       RL %d°C       RR %d°C",
                      static_cast<int>(std::lround(Reading.TreadCelsius[0])), static_cast<int>(std::lround(Reading.TreadCelsius[1])),
                      static_cast<int>(std::lround(Reading.TreadCelsius[2])), static_cast<int>(std::lround(Reading.TreadCelsius[3])));
        RasterText(Line, 270.0f, 523.0f, 19.0f, "#94b9aa");
        RasterText(Reading.Live ? "Live tread temperatures from the tyre thermal model." : "Demonstration values, not live tyre telemetry.", 270.0f, 564.0f, 15.0f, "#778f7c");
    }
    else if (Is("media"))
    {
        RasterRectangle(84.0f, 265.0f, 305.0f, 311.0f, 25.0f, DisplayPaint::Linear(85.0f, 265.0f, 363.0f, 576.0f, C("#bbb3ca"), C("#436a70")));
        RasterIcon(5u, 174.0f, 336.0f, 125.0f);
        RasterText("OPEN ROADS", 417.0f, 308.0f, 12.0f, "#97a98d");
        RasterText("A slower kind of rush", 414.0f, 361.0f, 33.0f, "#e0e8d4", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        RasterText("Player interface demo · no audio stream", 418.0f, 402.0f, 16.0f, "#7c9580");
        RasterButton("media-play", MediaPlaying ? "Pause" : "Play", 418.0f, 439.0f, 205.0f, 53.0f, ActionCategory::ToggleMedia, "", "#c0c9a7", "#3b5037");
        RasterSlider(7, "volume", "Volume", "%", 418.0f, 548.0f, 650.0f, 0.0f, 100.0f);
    }
    else if (Is("navigation"))
    {
        RasterRectangle(78.0f, 240.0f, 730.0f, 370.0f, 19.0f, C("#284640"));
        Raster_.PushClip(78.0f, 240.0f, 730.0f, 370.0f, 19.0f);
        const float CentreX = 443.0f, CentreY = 425.0f, Z = Values.Zoom;
        auto ZX = [&](float X) { return CentreX + (X - CentreX) * Z; };
        auto ZY = [&](float Y) { return CentreY + (Y - CentreY) * Z; };
        for (int I = 0; I < 7; ++I)
            Raster_.StrokeCubic(ZX(38.0f), ZY(264.0f + I * 62.0f), ZX(220.0f), ZY(170.0f + I * 71.0f), ZX(630.0f), ZY(325.0f + I * 58.0f), ZX(920.0f), ZY(227.0f + I * 61.0f), 1.0f, C("#cbe1bc11"));
        Raster_.StrokeCubic(ZX(160.0f), ZY(630.0f), ZX(315.0f), ZY(513.0f), ZX(237.0f), ZY(354.0f), ZX(596.0f), ZY(332.0f), 8.0f * Z, C("#8cccac"));
        Raster_.StrokeCubic(ZX(596.0f), ZY(332.0f), ZX(671.0f), ZY(328.0f), ZX(694.0f), ZY(272.0f), ZX(797.0f), ZY(217.0f), 8.0f * Z, C("#8cccac"));
        RasterIcon(4u, ZX(470.0f), ZY(360.0f), 55.0f * Z);
        Raster_.PopClip();
        RasterText("HIGHLANDS LOOP", 838.0f, 293.0f, 12.0f, "#89a38b");
        RasterText("Find your road.", 836.0f, 336.0f, 27.0f, "#d3e5c8", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        RasterText("Local route illustration", 838.0f, 369.0f, 14.0f, "#7c987c");
        RasterButton("zoom-in", "+", 841.0f, 435.0f, 99.0f, 64.0f, ActionCategory::Increment, "zoom");
        Regions.back().Number = 0.25f; Regions.back().Minimum = 0.75f; Regions.back().Maximum = 2.0f;
        RasterButton("zoom-out", "−", 958.0f, 435.0f, 99.0f, 64.0f, ActionCategory::Increment, "zoom");
        Regions.back().Number = -0.25f; Regions.back().Minimum = 0.75f; Regions.back().Maximum = 2.0f;
    }
    else if (Is("telemetry"))
    {
        RasterText(Reading.Live ? "LIVE READINGS" : "DEMONSTRATION READINGS", 83.0f, 264.0f, 12.0f, "#90a38b");
        char Speed[16], Tread[16], Pressure[16];
        std::snprintf(Speed, sizeof(Speed), "%d", static_cast<int>(std::lround(std::fabs(Reading.SpeedKph))));
        std::snprintf(Tread, sizeof(Tread), "%d", static_cast<int>(std::lround(0.25f * (Reading.TreadCelsius[0] + Reading.TreadCelsius[1] + Reading.TreadCelsius[2] + Reading.TreadCelsius[3]))));
        std::snprintf(Pressure, sizeof(Pressure), "%d", static_cast<int>(std::lround(Reading.Live ? 0.25f * (Reading.PressureKpa[0] + Reading.PressureKpa[1] + Reading.PressureKpa[2] + Reading.PressureKpa[3]) : Values.Pressure)));
        const char* Readings[3][3] = { { "Speed", Speed, "km/h" }, { "Tread", Tread, "°C" }, { "Pressure", Pressure, "kPa" } };
        for (uint32_t I = 0u; I < 3u; ++I)
        {
            const float Left = 83.0f + I * 340.0f;
            RasterRectangle(Left, 300.0f, 316.0f, 249.0f, 21.0f, C("#c9d5b407"));
            RasterText(Readings[I][0], Left + 24.0f, 342.0f, 18.0f, "#8c9f87");
            RasterText(Readings[I][1], Left + 24.0f, 446.0f, 71.0f, "#d4e4c4", DisplayTextAlignment::Left, DisplayTextWeight::Light);
            RasterText(Readings[I][2], Left + 25.0f, 486.0f, 19.0f, "#88a285");
        }
        RasterText(Reading.Live ? "Native vehicle readings, straight from the Project-Drive simulation." : "Native vehicle readings connect when the project supplies them.", 87.0f, 594.0f, 17.0f, "#8aa380");
    }
    else if (Is("garage"))
    {
        // The preview target is 640 × 400; draw it 1:1 so the car is never squashed into the page layout.
        RasterRectangle(78.0f, 248.0f, 640.0f, 400.0f, 22.0f, C("#0d1416"));
        if (Preview && Preview->Sheet && !Preview->Sheet->Empty())
        {
            Raster_.PushClip(78.0f, 248.0f, 640.0f, 400.0f, 22.0f);
            Raster_.BlitSheet(*Preview->Sheet, 78.0f, 248.0f, 640.0f, 400.0f);
            Raster_.PopClip();
            char Caption[96]; std::snprintf(Caption, sizeof(Caption), "%u facets · %s · own camera & lighting", Preview->Facets, Reading.VehicleName);
            RasterText(Caption, 96.0f, 630.0f, 13.0f, "#8fa89c");
        }
        else RasterText(Preview && Preview->Failure ? Preview->Failure : "Loading your car…", 428.0f, 455.0f, 20.0f, "#7d968b", DisplayTextAlignment::Centre);
        AdmitRegion("preview-orbit", 78.0f, 248.0f, 640.0f, 400.0f, ActionCategory::None).Orbit = true;
        RasterText("YOUR GARAGE", 762.0f, 291.0f, 12.0f, "#98a98f");
        RasterText(Reading.VehicleName, 760.0f, 349.0f, 39.0f, "#dce8cc", DisplayTextAlignment::Left, DisplayTextWeight::Light);
        RasterText("The Project-Drive car. Drag to orbit. Visual only.", 763.0f, 392.0f, 17.0f, "#849c81");
        RasterText("Highlight colour for this UI study", 763.0f, 440.0f, 15.0f, "#c5d9ba");
        const char* Colours[4] = { "#a4d8be", "#d4bd88", "#9eb8df", "#e2ada4" };
        for (uint32_t I = 0u; I < 4u; ++I)
        {
            const float Left = 762.0f + (I % 2u) * 128.0f, Top = 462.0f + (I / 2u) * 74.0f;
            RasterRectangle(Left, Top, 110.0f, 58.0f, 16.0f, C(Colours[I]), FinishColour == Colours[I] ? "#e8e8d5" : nullptr);
            char Id[16]; std::snprintf(Id, sizeof(Id), "colour:%u", I);
            (void)AdmitRegion(Id, Left, Top, 110.0f, 58.0f, ActionCategory::SelectColour, Colours[I]);
        }
        RasterButton("preview-spin", Preview && Preview->Spin ? "Pause turntable" : "Resume turntable", 762.0f, 618.0f, 238.0f, 42.0f, ActionCategory::ToggleSpin, "", "#243931", "#acbba8");
    }
    else   // settings
    {
        RasterText("MAKE THIS SCREEN YOURS", 84.0f, 264.0f, 12.0f, "#8da086");
        RasterSlider(8, "brightness", "Screen brightness", "%", 91.0f, 361.0f, 962.0f, 40.0f, 100.0f);
        RasterText("App grid", 93.0f, 452.0f, 21.0f, "#c5d9ba");
        RasterText("Pick how your launcher arranges the same twelve apps.", 93.0f, 480.0f, 15.0f, "#84997f");
        for (uint32_t I = 0u; I < 5u; ++I)
        {
            const float Left = 89.0f + I * 202.0f, Top = 500.0f;
            const bool Chosen = static_cast<uint32_t>(Design) == I;
            RasterRectangle(Left, Top, 188.0f, 118.0f, 16.0f, C(Chosen ? "#b2c899" : "#1f3328"), Chosen ? "#dcebc8" : nullptr);
            RasterDesignSchematic(static_cast<LauncherDesignCategory>(I), Left + 16.0f, Top + 14.0f, Chosen ? "#365035" : "#a9c49c");
            RasterText(kDesignNames[I], Left + 16.0f, Top + 94.0f, 17.0f, Chosen ? "#365035" : "#d4e3c8", DisplayTextAlignment::Left, DisplayTextWeight::Medium);
            RasterText(kDesignNumbers[I], Left + 172.0f, Top + 94.0f, 13.0f, Chosen ? "#4d6a48" : "#7f9a7a", DisplayTextAlignment::Right);
            (void)AdmitRegion((std::string("design:") + kDesignIdentifiers[I]).c_str(), Left, Top, 188.0f, 118.0f, ActionCategory::Design, kDesignIdentifiers[I]);
        }
    }
}

void TabletScreenSequence::RasterDesignSchematic(LauncherDesignCategory D, float L, float T, const char* Colour) noexcept
{
    // Miniature of each grid so the Settings picker shows the arrangement, not just a name.
    auto Cell = [&](float Across, float Down, float W, float H) { RasterRectangle(L + Across, T + Down, W, H, 3.0f, C(Colour)); };
    switch (D)
    {
    case LauncherDesignCategory::Launchpad:   for (int Row = 0; Row < 2; ++Row) for (int Column = 0; Column < 6; ++Column) Cell(Column * 26.0f, Row * 28.0f, 20.0f, 22.0f); break;
    case LauncherDesignCategory::Dashboard:   Cell(0.0f, 0.0f, 50.0f, 54.0f); for (int Row = 0; Row < 2; ++Row) for (int Column = 0; Column < 3; ++Column) Cell(58.0f + Column * 34.0f, Row * 28.0f, 30.0f, 24.0f); break;
    case LauncherDesignCategory::Collections: for (int Column = 0; Column < 3; ++Column) { Cell(Column * 54.0f, 0.0f, 48.0f, 10.0f); for (int Row = 0; Row < 2; ++Row) Cell(Column * 54.0f, 16.0f + Row * 20.0f, 48.0f, 16.0f); } break;
    case LauncherDesignCategory::Focus:       Cell(50.0f, 0.0f, 56.0f, 54.0f); Cell(10.0f, 14.0f, 30.0f, 30.0f); Cell(116.0f, 14.0f, 30.0f, 30.0f); break;
    default:                                  Cell(0.0f, 0.0f, 40.0f, 54.0f); for (int Row = 0; Row < 4; ++Row) Cell(48.0f, Row * 14.0f, 108.0f, 10.0f); break;
    }
}

//------------------------------------------------------------------------------------------------------------------------ raster

bool TabletScreenSequence::Raster() noexcept
{
    if (!Dirty || Sheet.Empty()) return false;
    Raster_.Begin(Sheet, Scale, OffsetAcross, OffsetDown, Faces[0], Faces[1], Faces[2]);
    Regions.clear();
    if (!Application.empty()) RasterApplication();
    else switch (Design)
    {
    case LauncherDesignCategory::Dashboard:   RasterDashboard(); break;
    case LauncherDesignCategory::Collections: RasterCollections(); break;
    case LauncherDesignCategory::Focus:       RasterFocus(); break;
    case LauncherDesignCategory::Console:     RasterConsole(); break;
    default:                                  RasterLaunchpad(); break;
    }
    if (Values.Brightness < 100.0f) Raster_.Veil((100.0f - Values.Brightness) / 140.0f);
    Sheet.Commit();
    Dirty = false;
    return true;
}

//------------------------------------------------------------------------------------------------------------------------ behaviour

const TabletScreenSequence::Region* TabletScreenSequence::QueryContact(float Across, float Down) const noexcept
{
    for (size_t I = Regions.size(); I-- > 0u;)
    {
        const Region& R = Regions[I];
        if (Across >= R.Left && Across <= R.Left + R.Width && Down >= R.Top && Down <= R.Top + R.Height) return &R;
    }
    return nullptr;
}

std::string TabletScreenSequence::QueryContactIdentifier(float Across, float Down) const noexcept
{
    // Sheet pixels, the same mapping ForwardTouch applies.
    const Region* R = QueryContact(Across / Scale - OffsetAcross, Down / Scale - OffsetDown);
    return R ? R->Identifier : std::string();
}

void TabletScreenSequence::IncrementValue(int Value, float Difference, float Minimum, float Maximum) noexcept
{
    float& V = ValueAt(Values, Value);
    V = std::max(Minimum, std::min(Maximum, std::round((V + Difference) * 100.0f) / 100.0f));
    Dirty = true;
}

void TabletScreenSequence::ReceiveText(const char* Target) noexcept
{
    TextTarget = Target;
    Notice = TextTarget == "message" ? "Type your message, then press Send." : "Type a name, then press Done.";
    Dirty = true;
}

void TabletScreenSequence::AdmitText(const char* Text) noexcept
{
    if (!Text) return;
    if (TextTarget == "message") MessageDraft = std::string(Text).substr(0, 100);
    else if (TextTarget == "nickname") Nickname = std::string(Text).substr(0, 22);
    Dirty = true;
}

void TabletScreenSequence::DeliverMessage() noexcept
{
    std::string Trimmed = MessageDraft;
    while (!Trimmed.empty() && Trimmed.back() == ' ') Trimmed.pop_back();
    while (!Trimmed.empty() && Trimmed.front() == ' ') Trimmed.erase(Trimmed.begin());
    if (Trimmed.empty()) return;
    Messages.push_back({ "You", Trimmed });
    MessageDraft.clear();
    Notice = "Message added locally. Nothing was sent online.";
    Dirty = true;
}

void TabletScreenSequence::Perform(const Region& R) noexcept
{
    switch (R.Action)
    {
    case ActionCategory::Home:         PresentHome(); break;
    case ActionCategory::Application:  (void)PresentApplication(R.Argument.c_str()); break;
    case ActionCategory::Design:
        for (uint32_t I = 0u; I < 5u; ++I) if (R.Argument == kDesignIdentifiers[I]) (void)PresentDesign(static_cast<LauncherDesignCategory>(I));
        break;
    case ActionCategory::FocusIndex:   FocusIndex = static_cast<uint32_t>(std::atoi(R.Argument.c_str())) % kTabletApplicationCount; Dirty = true; break;
    case ActionCategory::VehicleTab:   VehicleTab = R.Argument; Dirty = true; break;
    case ActionCategory::VehicleReset: Values.Steering = 50.0f; Values.Height = 35.0f; Values.Stiffness = 65.0f; Values.Spoiler = 14.0f; Dirty = true; break;
    case ActionCategory::ToggleReady:  RoomReady = !RoomReady; Notice = "Local readiness updated. No network room is joined."; Dirty = true; break;
    case ActionCategory::SendMessage:  DeliverMessage(); break;
    case ActionCategory::ReceiveText:  ReceiveText(R.Argument.c_str()); break;
    case ActionCategory::Invite:       Invited = R.Argument; Notice = R.Argument + " invited in the local prototype only."; Dirty = true; break;
    case ActionCategory::SaveName:     TextTarget.clear(); Notice = "Display name saved locally for this visit."; Dirty = true; break;
    case ActionCategory::Increment:    IncrementValue(ValueIndex(R.Argument.c_str()), R.Number, R.Minimum, R.Maximum); break;
    case ActionCategory::ToggleMedia:  MediaPlaying = !MediaPlaying; Dirty = true; break;
    case ActionCategory::SelectColour: FinishColour = R.Argument; Notice = "UI highlight selected. Vehicle materials have not been changed."; Dirty = true; break;
    case ActionCategory::ToggleSpin:   if (Preview) { Preview->Spin = !Preview->Spin; Preview->Dirty = true; } Dirty = true; break;
    default: break;
    }
}

void TabletScreenSequence::AdvanceSlider(const Region& R, float Across) noexcept
{
    const float Fraction = std::max(0.0f, std::min(1.0f, (Across - R.TrackLeft) / R.TrackWidth));
    ValueAt(Values, R.SliderValue) = std::round((R.Minimum + Fraction * (R.Maximum - R.Minimum)) / R.Step) * R.Step;
    Dirty = true;
}

void TabletScreenSequence::ForwardTouch(const DisplayTouchReading& Touch) noexcept
{
    // Sheet pixels → design units.
    const float Across = Touch.Across / Scale - OffsetAcross, Down = Touch.Down / Scale - OffsetDown;
    const Region* Contact = QueryContact(Across, Down);
    switch (Touch.Phase)
    {
    case DisplayTouchPhase::None:
    case DisplayTouchPhase::Hover:
    {
        const std::string Identifier = Touch.Phase == DisplayTouchPhase::Hover && Contact ? Contact->Identifier : std::string();
        if (Identifier != Hovered) { Hovered = Identifier; Dirty = true; }
        break;
    }
    case DisplayTouchPhase::Down:
    {
        PointerHeld = true;
        PointerIdentifier = Contact ? Contact->Identifier : std::string();
        PointerStartAcross = PointerPreviousAcross = Across; PointerStartDown = PointerPreviousDown = Down;
        Pressed = PointerIdentifier;
        if (Contact && Contact->SliderValue >= 0) AdvanceSlider(*Contact, Across);
        Dirty = true;
        break;
    }
    case DisplayTouchPhase::Move:
    case DisplayTouchPhase::LongPress:
    {
        if (!PointerHeld) break;
        const Region* Held = nullptr;
        for (const Region& R : Regions) if (R.Identifier == PointerIdentifier) { Held = &R; break; }
        if (Held && Held->SliderValue >= 0) AdvanceSlider(*Held, Across);
        if (Held && Held->Orbit && Preview)
        {
            Preview->OrbitYaw += (Across - PointerPreviousAcross) * 0.012f;
            Preview->OrbitPitch += (Down - PointerPreviousDown) * 0.008f;
            Preview->Dirty = true; Dirty = true;
        }
        PointerPreviousAcross = Across; PointerPreviousDown = Down;
        break;
    }
    case DisplayTouchPhase::Up:
    {
        if (!PointerHeld) break;
        const Region* Held = nullptr;
        for (const Region& R : Regions) if (R.Identifier == PointerIdentifier) { Held = &R; break; }
        if (Held && Held->Swipe && Touch.Moved && std::fabs(Across - PointerStartAcross) > 45.0f)
            FocusIndex = (FocusIndex + (Across < PointerStartAcross ? 1u : kTabletApplicationCount - 1u)) % kTabletApplicationCount;
        else if (!Touch.Moved && Held && Contact && Contact->Identifier == Held->Identifier)
            Perform(*Held);
        PointerHeld = false; Pressed.clear(); Dirty = true;
        break;
    }
    case DisplayTouchPhase::Cancel:
        PointerHeld = false; Pressed.clear(); Dirty = true;
        break;
    }
}

TabletScreenReading TabletScreenSequence::QueryReading() const noexcept
{
    TabletScreenReading R;
    R.Design = Design; R.Application = Application.empty() ? nullptr : Application.c_str(); R.Revision = Sheet.QueryRevision();
    R.RegionCount = static_cast<uint32_t>(Regions.size()); R.FocusIndex = FocusIndex; R.Values = Values; R.RoomReady = RoomReady;
    R.MessageCount = static_cast<uint32_t>(Messages.size()); R.Nickname = Nickname; R.Hovered = Hovered; R.Pressed = Pressed;
    return R;
}

} // namespace Frontier
