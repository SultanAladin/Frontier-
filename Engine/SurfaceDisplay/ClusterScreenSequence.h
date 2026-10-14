//============================================================================================================================================
//                                                       CLUSTERSCREENSEQUENCE.H
//============================================================================================================================================
// 🧩 The driver's instrument cluster, ported from Experimental/TabletPanel/ClusterSequence.js: two ring gauges (speed,
//    engine) with ticks, redline and needle, the gear in the middle, four telltales, drawn on a 1000-wide design space
//    whose height follows the housing outline's physical aspect (hexagon 559, cut circle 1000, trapezoid 472, pill 325)
//    — one raster per outline, never one raster stretched over all of them.
//
//    The sheet is masked to the outline (alpha 0 outside), so the emissive quad shows the housing shape, and the
//    rim stroke sits 2 design units inside the edge exactly as the prototype drew it.

#pragma once

#include "DisplayRasterProjection.h"
#include "DisplayStartupSequence.h"
#include "DisplaySurfaceStructure.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

inline constexpr float kClusterDesignWidth = 1000.0f;   // [design]

struct ClusterReading
{
    float       SpeedKph = 0.0f;
    float       EngineRpm = 900.0f;
    const char* Gear = "P";
    bool        AbsActive = false, TractionActive = false, OilWarning = false, LowBeam = true;
    const char* VehicleName = "ControlVehicle";
    const char* Caption = "DEMONSTRATION DRIVE · NO LIVE VEHICLE";
    float       SpeedLimitKph = 240.0f;   // [km/h] gauge full scale
    float       RpmLimit = 8000.0f;       // [rpm]  gauge full scale
    float       Redline = 0.84f;          // [-]    fraction of the sweep painted red
};

struct ClusterScreenReading
{
    DisplayOutlineCategory Outline = DisplayOutlineCategory::Hexagon;
    uint64_t               Revision = 0u;
    uint32_t               Width = 0u, Height = 0u;   // [px] sheet
    float                  DesignHeight = 0.0f;
    float                  SpeedKph = 0.0f, EngineRpm = 0.0f;
    std::string            Gear;
};

class ClusterScreenSequence
{
public:
    ClusterScreenSequence() noexcept;

    void AssignTypefaces(TypefaceSheetCodec* Light, TypefaceSheetCodec* Regular) noexcept { Faces[0] = Light; Faces[1] = Regular; Dirty = true; BackdropValid = false; }
    // The housing (outline + physical size) decides the design height and the sheet size; Scale = sheet pixels per design unit.
    bool PresentSurface(const DisplaySurfaceStructure& Surface, float Scale) noexcept;
    // Marks dirty only when a displayed quantity actually changed (speed to the km/h, rpm beyond 40, gear, lamps).
    void AssignReading(const ClusterReading& Reading) noexcept;
    bool Raster() noexcept;

    // Power-on sequence over the gauges (see DisplayStartupSequence); the needles sweep up and back meanwhile.
    void BeginStartup(float DurationSeconds, uint32_t Seed, const char* Wordmark) noexcept { Startup.Begin(DurationSeconds, Seed, Wordmark, "#f0c27a"); Dirty = true; }
    bool AdvanceStartup(double Seconds) noexcept { const bool Changing = Startup.Advance(Seconds); if (Changing) Dirty = true; return Changing; }
    [[nodiscard]] bool StartupActive() const noexcept { return Startup.Active(); }

    [[nodiscard]] const DisplaySheetStructure& QuerySheet() const noexcept { return Sheet; }
    [[nodiscard]] DisplaySheetStructure&       AccessSheet()      noexcept { return Sheet; }
    [[nodiscard]] bool                         IsDirty()  const noexcept { return Dirty; }
    [[nodiscard]] ClusterScreenReading         QueryReading() const noexcept;
    [[nodiscard]] float                        QueryDesignHeight() const noexcept { return DesignHeight; }

private:
    void RasterGaugeBackdrop(float CentreX, float CentreY, float Radius, float Start, float Sweep, const char* Label, const char* Unit, float Redline) noexcept;
    void RasterGauge(float CentreX, float CentreY, float Radius, float Fraction, float Start, float Sweep, const char* Colour, const char* Value) noexcept;

    DisplaySheetStructure    Sheet;
    DisplaySheetStructure    Backdrop;                 // static layer (gradient, tracks, ticks, captions, rim), rebuilt only when the housing/text changes
    std::string              BackdropName, BackdropCaption;
    bool                     BackdropValid = false;
    DisplayRasterProjection  Raster_;
    DisplayStartupSequence   Startup;
    TypefaceSheetCodec*      Faces[2] = { nullptr, nullptr };
    DisplayOutlineCategory   Outline = DisplayOutlineCategory::Hexagon;
    std::vector<DisplayPoint> SheetOutline, SheetOutlineInset;   // [design] outline paths for mask and rim
    std::vector<uint8_t>     Mask;
    float                    Scale = 1.5f, DesignHeight = 560.0f;
    ClusterReading           Reading;
    bool                     Dirty = true;
};

} // namespace Frontier
