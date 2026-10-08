//==============================================================================================================================================
//                                                          OUTLINERMETADATA.H
//==============================================================================================================================================
// 📦 The small live figure under every outliner row's name — Editor.jsx OutlinerMetadata(), transcribed
//    branch for branch, together with the CompactNumber / CompactPosition formatting it reads through.

#pragma once

#include "EditorInstance.h"
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE PANEL A ROW SPEAKS FOR
//------------------------------------------------------------------------------------------------------------------------
// The browser keys everything off `Row.Panel`, a string. The engine already carries the same
//    discrimination across two enumerations — the category for the four structural families, the glyph
//    for the celestial ones — so the string is recovered rather than stored a second time.

enum class RowPanel : uint32_t
{
    Group = 0u,
    Geometry,
    Camera,
    EditorCamera,     // the permanent editor camera, which the browser answers before anything else
    Light,
    Post,
    Atmosphere,
    Sun,
    Flare,
    Moon,
    Stars,
    Wind,
    HeightFog,
    AerialFog,
    LocalFog,
    Clouds,
    LocalCloud,
    Precipitation,
    Rainbow,
    Count
};

/// 📦 The panel a row speaks for, from the glyph it already carries and the family it belongs to.
/// in    Glyph     [-] the row's own glyph; Auto defers to the category
/// in    Family    [-] the row's category
/// in    Permanent [-] true for the editor camera, which cannot be hidden or renamed
/// out   RowPanel  [-] never Count — an unrecognised glyph answers by category
inline RowPanel PanelOfRow(EditorGlyph Glyph, EditorInstanceCategory Family, bool Permanent = false) noexcept
{
    if (Permanent) return RowPanel::EditorCamera;
    switch (Glyph)
    {
    case EditorGlyph::Atmosphere:   return RowPanel::Atmosphere;
    case EditorGlyph::Globe:        return RowPanel::Atmosphere;
    case EditorGlyph::Sky:          return RowPanel::Atmosphere;
    case EditorGlyph::Sun:          return RowPanel::Sun;
    case EditorGlyph::Flare:        return RowPanel::Flare;
    case EditorGlyph::Moon:         return RowPanel::Moon;
    case EditorGlyph::Stars:        return RowPanel::Stars;
    case EditorGlyph::Wind:         return RowPanel::Wind;
    case EditorGlyph::VolumeFog:    return RowPanel::HeightFog;
    case EditorGlyph::AerialFog:    return RowPanel::AerialFog;
    case EditorGlyph::Fog:          return RowPanel::LocalFog;
    case EditorGlyph::Cloud:        return RowPanel::Clouds;
    case EditorGlyph::VolumeClouds: return RowPanel::Clouds;
    case EditorGlyph::LocalCloud:   return RowPanel::LocalCloud;
    case EditorGlyph::Rain:         return RowPanel::Precipitation;
    case EditorGlyph::Rainbow:      return RowPanel::Rainbow;
    case EditorGlyph::Effects:      return RowPanel::Post;
    case EditorGlyph::Aperture:     return RowPanel::Post;
    case EditorGlyph::Camera:       return RowPanel::Camera;
    case EditorGlyph::Bulb:         return RowPanel::Light;
    case EditorGlyph::Folder:       return RowPanel::Group;
    default: break;
    }
    switch (Family)
    {
    case EditorInstanceCategory::Folder: return RowPanel::Group;
    case EditorInstanceCategory::Light:  return RowPanel::Light;
    case EditorInstanceCategory::Camera: return RowPanel::Camera;
    default:                             return RowPanel::Geometry;
    }
}

// FolderInventory.mjs CollectionTypes — the plural the collection inspector lists a panel under.
inline const char* CollectionTypeName(RowPanel Panel) noexcept
{
    switch (Panel)
    {
    case RowPanel::Group:         return "Folders";
    case RowPanel::Geometry:      return "Geometry";
    case RowPanel::Camera:        return "Cameras";
    case RowPanel::EditorCamera:  return "Cameras";
    case RowPanel::Light:         return "Lights";
    case RowPanel::Sun:           return "Sun";
    case RowPanel::Atmosphere:    return "Atmospheres";
    case RowPanel::Moon:          return "Moons";
    case RowPanel::Stars:         return "Stars";
    case RowPanel::Wind:          return "Wind";
    case RowPanel::Clouds:        return "Clouds";
    case RowPanel::LocalCloud:    return "Local clouds";
    case RowPanel::HeightFog:     return "Height fog";
    case RowPanel::AerialFog:     return "Aerial fog";
    case RowPanel::LocalFog:      return "Local fog";
    case RowPanel::Precipitation: return "Precipitation";
    case RowPanel::Rainbow:       return "Rainbows";
    case RowPanel::Flare:         return "Lens flares";
    case RowPanel::Post:          return "Post processing";
    default:                      return "Geometry";
    }
}

// The browser's own fallback: the panel key with its hyphens opened out.
inline const char* PanelProse(RowPanel Panel) noexcept
{
    switch (Panel)
    {
    case RowPanel::HeightFog:     return "height fog";
    case RowPanel::AerialFog:     return "aerial fog";
    case RowPanel::LocalFog:      return "local fog";
    case RowPanel::LocalCloud:    return "local cloud";
    default:                      return "geometry";
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      NUMBER FORMATTING
//------------------------------------------------------------------------------------------------------------------------

/// 📦 Number.prototype.toLocaleString("en-US", { maximumFractionDigits: Digits }).
/// in    Reading   [-]  the figure; a non-finite reading answers with an em dash, as Number.isFinite does
/// in    Digits    [-]  maximum fraction digits — trailing zeros are dropped, there is no minimum
/// out   Out       [-]  grouped decimal, at most Room - 1 characters
/// note  Intl rounds half away from zero; printf rounds half to even, so the rounding is done by hand.
inline void CompactNumber(double Reading, int Digits, char* Out, size_t Room) noexcept
{
    if (Out == nullptr || Room == 0) return;
    if (!std::isfinite(Reading)) { std::snprintf(Out, Room, "\xe2\x80\x94"); return; }

    double Scale = 1.0;
    for (int Step = 0; Step < Digits; ++Step) Scale *= 10.0;
    // Intl rounds the shortest decimal that round-trips, so 12.45 answers 12.5; the binary double is a
    //    hair under and would answer 12.4. The relative nudge closes exactly that gap and nothing wider.
    const bool   Below   = Reading < 0.0;
    const double Scaled  = std::fabs(Reading) * Scale;
    const double Rounded = std::floor(Scaled + 0.5 + Scaled * 1e-12) / Scale;

    char Plain[64];
    std::snprintf(Plain, sizeof(Plain), "%.*f", Digits > 0 ? Digits : 0, Rounded);

    // Drop the trailing zeros and then the orphaned point: maximumFractionDigits has no minimum.
    if (Digits > 0 && std::strchr(Plain, '.') != nullptr)
    {
        size_t Last = std::strlen(Plain);
        while (Last > 0 && Plain[Last - 1] == '0') --Last;
        if (Last > 0 && Plain[Last - 1] == '.') --Last;
        Plain[Last] = '\0';
    }

    // Group the integer part in threes. A zero that rounded down from a negative reading loses its sign,
    //    exactly as (-0.04).toLocaleString(undefined, { maximumFractionDigits: 1 }) gives "-0" → "0" here
    //    only when the whole magnitude rounded away.
    const char* Point  = std::strchr(Plain, '.');
    const size_t Whole = Point != nullptr ? size_t(Point - Plain) : std::strlen(Plain);
    char Grouped[80];
    size_t Fill = 0;
    if (Below && Rounded != 0.0 && Fill + 1 < sizeof(Grouped)) Grouped[Fill++] = '-';
    for (size_t Index = 0; Index < Whole && Fill + 1 < sizeof(Grouped); ++Index)
    {
        if (Index > 0 && (Whole - Index) % 3 == 0) Grouped[Fill++] = ',';
        if (Fill + 1 < sizeof(Grouped)) Grouped[Fill++] = Plain[Index];
    }
    for (size_t Index = Whole; Index < std::strlen(Plain) && Fill + 1 < sizeof(Grouped); ++Index)
        Grouped[Fill++] = Plain[Index];
    Grouped[Fill] = '\0';
    // A bounded copy rather than another snprintf: the working buffer is deliberately wider than any
    //    caller's, and the compiler is right to say so.
    const size_t Carry = Fill < Room - 1 ? Fill : Room - 1;
    std::memcpy(Out, Grouped, Carry);
    Out[Carry] = '\0';
}

// CompactPosition: three one-decimal figures joined by bare commas, no spaces.
inline void CompactPosition(const float Position[3], char* Out, size_t Room) noexcept
{
    char X[24], Y[24], Z[24];
    CompactNumber(Position != nullptr ? double(Position[0]) : 0.0, 1, X, sizeof(X));
    CompactNumber(Position != nullptr ? double(Position[1]) : 0.0, 1, Y, sizeof(Y));
    CompactNumber(Position != nullptr ? double(Position[2]) : 0.0, 1, Z, sizeof(Z));
    std::snprintf(Out, Room, "%s,%s,%s", X, Y, Z);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ROW'S OWN FIGURE
//------------------------------------------------------------------------------------------------------------------------

// The seven luminaire shapes the reference names, in its own order.
enum class LuminaireShape : uint32_t { Point = 0u, Spot, Ies, Area, Tube, Led, Strip, Count };

inline const char* LuminaireName(LuminaireShape Shape) noexcept
{
    switch (Shape)
    {
    case LuminaireShape::Point: return "Point";
    case LuminaireShape::Spot:  return "Spot";
    case LuminaireShape::Ies:   return "IES";
    case LuminaireShape::Tube:  return "Tube";
    case LuminaireShape::Led:   return "LED";
    case LuminaireShape::Strip: return "Strip";
    default:                    return "Area";
    }
}

// Everything the eighteen branches read. A feed fills only the fields its panel asks for; the defaults
//    are the browser's own, which it reaches through Panels[Row.Panel].find(…).Default.
struct RowReading
{
    float    Position[3]     = { 0.0f, 0.0f, 0.0f };
    uint32_t Enclosed        = 0u;        // [-]   group: rows whose parent is this one
    float    FocalLength     = 35.0f;     // [mm]
    float    Aperture        = 2.8f;      // [-]   f-number
    float    Exposure        = 0.0f;      // [EV]
    float    Mie             = 1.0f;      // [x]
    float    Ozone           = 1.0f;      // [x]
    float    Intensity       = 1.0f;      // [x]   sun, flare, rainbow; lx for a light with no reference
    float    AngularDiameter = 0.53f;     // [deg]
    float    Ghosts          = 6.0f;      // [-]
    float    Phase           = 0.5f;      // [-]   0…1
    float    LimitingMagnitude = 6.0f;    // [mag]
    float    Brightness      = 1.0f;      // [x]
    float    Speed           = 7.0f;      // [m/s]
    float    Bearing         = 45.0f;     // [deg]
    float    Density         = 1.0f;      // [x]
    float    FalloffHeight   = 120.0f;    // [m]
    float    Start           = 500.0f;    // [m]
    float    Coverage        = 0.5f;      // [-]   0…1
    uint32_t Precipitate     = 0u;        // [-]   index into Rain / Drizzle / Hail / Snow / Sleet
    float    MinimumPath     = 100.0f;    // [m]
    float    Output          = 32.0f;     // [cd | lm]
    bool     Referenced      = false;     // true once the row carries a reference luminaire
    LuminaireShape Shape     = LuminaireShape::Area;
};

inline const char* PrecipitateName(uint32_t Which) noexcept
{
    switch (Which)
    {
    case 1u: return "Drizzle";
    case 2u: return "Hail";
    case 3u: return "Snow";
    case 4u: return "Sleet";
    default: return "Rain";
    }
}

/// 📦 Editor.jsx OutlinerMetadata(Row, Record, Rows) — the small line under an outliner row's name.
/// in    Panel    [-] which of the eighteen branches answers
/// in    Reading  [-] the live figures that branch reads
/// out   Out      [-] the figure, UTF-8, at most Room - 1 characters
/// note  The separator is U+00B7, the multiplication sign U+00D7 and the degree sign U+00B0, as shipped.
inline void OutlinerMetadata(RowPanel Panel, const RowReading& Reading, char* Out, size_t Room) noexcept
{
    if (Out == nullptr || Room == 0) return;
    constexpr const char* Dot   = " \xc2\xb7 ";
    constexpr const char* Times = "\xc3\x97";
    constexpr const char* Degree= "\xc2\xb0";
    char First[32], Second[32], Place[64];

    switch (Panel)
    {
    case RowPanel::EditorCamera:
        std::snprintf(Out, Room, "Editor \xc2\xb7 permanent");
        return;

    case RowPanel::Group:
        std::snprintf(Out, Room, "%u item%s", Reading.Enclosed, Reading.Enclosed == 1u ? "" : "s");
        return;

    case RowPanel::Geometry:
        CompactPosition(Reading.Position, Place, sizeof(Place));
        std::snprintf(Out, Room, "Position %s m", Place);
        return;

    case RowPanel::Camera:
        CompactNumber(double(Reading.FocalLength), 0, First, sizeof(First));
        CompactNumber(double(Reading.Aperture), 1, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s mm%sf/%s", First, Dot, Second);
        return;

    case RowPanel::Post:
        CompactNumber(double(Reading.Exposure), 1, First, sizeof(First));
        std::snprintf(Out, Room, "EV %s%s", Reading.Exposure >= 0.0f ? "+" : "", First);
        return;

    case RowPanel::Atmosphere:
        CompactNumber(double(Reading.Mie), 1, First, sizeof(First));
        CompactNumber(double(Reading.Ozone), 1, Second, sizeof(Second));
        std::snprintf(Out, Room, "Mie %s%s%sozone %s", First, Times, Dot, Second);
        return;

    case RowPanel::Sun:
        CompactNumber(double(Reading.Intensity), 1, First, sizeof(First));
        CompactNumber(double(Reading.AngularDiameter), 2, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%s%s%s", First, Times, Dot, Second, Degree);
        return;

    case RowPanel::Flare:
        CompactNumber(double(Reading.Intensity), 1, First, sizeof(First));
        CompactNumber(double(Reading.Ghosts), 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%s%s ghosts", First, Times, Dot, Second);
        return;

    case RowPanel::Moon:
        CompactNumber(double(Reading.Phase) * 360.0, 0, First, sizeof(First));
        CompactNumber(double(Reading.Phase) * 100.0, 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "Lunar phase %s%s%s%s%%", First, Degree, Dot, Second);
        return;

    case RowPanel::Stars:
        CompactNumber(double(Reading.LimitingMagnitude), 1, First, sizeof(First));
        CompactNumber(double(Reading.Brightness), 1, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s mag%s%s%s", First, Dot, Second, Times);
        return;

    case RowPanel::Wind:
        CompactNumber(double(Reading.Speed), 1, First, sizeof(First));
        CompactNumber(double(Reading.Bearing), 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s m/s%s%s%s", First, Dot, Second, Degree);
        return;

    case RowPanel::HeightFog:
        CompactNumber(double(Reading.Density), 2, First, sizeof(First));
        CompactNumber(double(Reading.FalloffHeight), 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%s%s m", First, Times, Dot, Second);
        return;

    case RowPanel::AerialFog:
        CompactNumber(double(Reading.Density), 1, First, sizeof(First));
        CompactNumber(double(Reading.Start), 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%sstarts %s m", First, Times, Dot, Second);
        return;

    case RowPanel::LocalFog:
        CompactNumber(double(Reading.Density), 1, First, sizeof(First));
        CompactNumber(double(Reading.Coverage) * 100.0, 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%s%s%%", First, Times, Dot, Second);
        return;

    case RowPanel::Clouds:
    case RowPanel::LocalCloud:
        CompactNumber(double(Reading.Coverage) * 100.0, 0, First, sizeof(First));
        CompactNumber(double(Reading.Density), 1, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%%%s%s%s", First, Dot, Second, Times);
        return;

    case RowPanel::Precipitation:
        CompactNumber(double(Reading.Intensity), 1, First, sizeof(First));
        std::snprintf(Out, Room, "%s%s%s mm/h", PrecipitateName(Reading.Precipitate), Dot, First);
        return;

    case RowPanel::Rainbow:
        CompactNumber(double(Reading.Intensity), 1, First, sizeof(First));
        CompactNumber(double(Reading.MinimumPath), 0, Second, sizeof(Second));
        std::snprintf(Out, Room, "%s%s%s%s m", First, Times, Dot, Second);
        return;

    case RowPanel::Light:
    {
        // Without a reference luminaire the row reports the panel's own Intensity in lux; with one it
        //    reports what that luminaire actually emits, in candela for the two punctual shapes.
        const bool Punctual = Reading.Shape == LuminaireShape::Point || Reading.Shape == LuminaireShape::Spot;
        const char* Unit    = Reading.Referenced ? (Punctual ? "cd" : "lm") : "lx";
        CompactNumber(Reading.Referenced ? double(Reading.Output) : double(Reading.Intensity), 0,
                      First, sizeof(First));
        CompactPosition(Reading.Position, Place, sizeof(Place));
        std::snprintf(Out, Room, "%s %s%s%s%s%s", First, Unit, Dot, LuminaireName(Reading.Shape), Dot, Place);
        return;
    }

    default:
        std::snprintf(Out, Room, "%s", PanelProse(Panel));
        return;
    }
}

}   // namespace Frontier
