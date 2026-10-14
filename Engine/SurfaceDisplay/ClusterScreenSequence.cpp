//============================================================================================================================================
//                                                       CLUSTERSCREENSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Port of ClusterSequence.js; gauge geometry and colours verbatim.

#include "ClusterScreenSequence.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier {

namespace {
constexpr float kPi = 3.14159265358979323846f;
[[nodiscard]] DisplayColour C(const char* Literal) noexcept { return ParseDisplayColour(Literal); }
} // namespace

ClusterScreenSequence::ClusterScreenSequence() noexcept = default;

bool ClusterScreenSequence::PresentSurface(const DisplaySurfaceStructure& Surface, float NewScale) noexcept
{
    Scale = NewScale;
    Outline = Surface.QuerySpecification().Outline;
    const DisplaySpecification& S = Surface.QuerySpecification();
    DesignHeight = std::round(kClusterDesignWidth * S.Height / std::max(S.Width, 1.0e-4f));
    const uint32_t Width = static_cast<uint32_t>(std::lround(kClusterDesignWidth * Scale));
    const uint32_t Height = static_cast<uint32_t>(std::lround(DesignHeight * Scale));
    const bool Resized = Sheet.Resize(Width, Height);
    // Outline paths in design units (+Y down), from the unit outline (+Y up).
    const std::vector<DisplayPoint>& Unit = Surface.QueryUnitOutline();
    auto Trace = [&](float Inset)
    {
        std::vector<DisplayPoint> Points(Unit.size());
        for (size_t I = 0u; I < Unit.size(); ++I)
            Points[I] = { kClusterDesignWidth / 2.0f + Unit[I].X * (kClusterDesignWidth / 2.0f - Inset), DesignHeight / 2.0f - Unit[I].Y * (DesignHeight / 2.0f - Inset) };
        return Points;
    };
    SheetOutline = Trace(0.0f);
    SheetOutlineInset = Trace(2.0f);
    Raster_.Begin(Sheet, Scale, 0.0f, 0.0f, Faces[0], Faces[1], nullptr);
    Raster_.ConstructMask({ SheetOutline }, Mask);
    Dirty = true; BackdropValid = false;
    return Resized;
}

void ClusterScreenSequence::AssignReading(const ClusterReading& New)
    noexcept
{
    const bool Changed = std::lround(New.SpeedKph) != std::lround(Reading.SpeedKph) || std::fabs(New.EngineRpm - Reading.EngineRpm) > 40.0f ||
                         std::strcmp(New.Gear, Reading.Gear) != 0 || New.AbsActive != Reading.AbsActive || New.TractionActive != Reading.TractionActive ||
                         New.OilWarning != Reading.OilWarning || New.LowBeam != Reading.LowBeam || std::strcmp(New.Caption, Reading.Caption) != 0;
    if (Changed) { Reading = New; Dirty = true; }
}

void ClusterScreenSequence::RasterGaugeBackdrop(float CentreX, float CentreY, float Radius, float Start, float Sweep,
                                                const char* Label, const char* Unit, float Redline) noexcept
{
    Raster_.StrokeArc(CentreX, CentreY, Radius, Start, Sweep, 14.0f, C("#ffffff14"));
    if (Redline > 0.0f) Raster_.StrokeArc(CentreX, CentreY, Radius, Start + Sweep * Redline, Sweep * (1.0f - Redline), 14.0f, C("#c9563d"));
    for (int I = 0; I <= 10; ++I)
    {
        const float A = Start + Sweep * I / 10.0f;
        Raster_.StrokeLine(CentreX + std::cos(A) * (Radius - 20.0f), CentreY + std::sin(A) * (Radius - 20.0f),
                           CentreX + std::cos(A) * (Radius - 30.0f), CentreY + std::sin(A) * (Radius - 30.0f), 2.0f, C("#b7cfc4"));
    }
    (void)Raster_.Text(Unit, CentreX, CentreY + Radius * 0.42f, Radius * 0.14f, C("#93a99d"), DisplayTextAlignment::Centre);
    (void)Raster_.Text(Label, CentreX, CentreY + Radius * 0.62f, Radius * 0.14f, C("#93a99d"), DisplayTextAlignment::Centre);
}

void ClusterScreenSequence::RasterGauge(float CentreX, float CentreY, float Radius, float Fraction, float Start, float Sweep, const char* Colour,
                                        const char* Value) noexcept
{
    Raster_.StrokeArc(CentreX, CentreY, Radius, Start, Sweep * std::max(0.001f, Fraction), 14.0f, C(Colour));
    const float Needle = Start + Sweep * Fraction;
    Raster_.StrokeLine(CentreX + std::cos(Needle) * (Radius - 12.0f), CentreY + std::sin(Needle) * (Radius - 12.0f),
                       CentreX + std::cos(Needle + kPi) * 18.0f, CentreY + std::sin(Needle + kPi) * 18.0f, 3.0f, C("#f3f6ee"));
    (void)Raster_.Text(Value, CentreX, CentreY + Radius * 0.22f, Radius * 0.62f, C("#edf2e8"), DisplayTextAlignment::Centre, DisplayTextWeight::Light);
}

bool ClusterScreenSequence::Raster() noexcept
{
    if (!Dirty || Sheet.Empty()) return false;
    const bool Narrow = Outline == DisplayOutlineCategory::CutCircle;
    const bool Flat = Outline == DisplayOutlineCategory::Pill;
    const float Radius = Narrow ? 190.0f : Flat ? 112.0f : std::min(160.0f, DesignHeight * 0.3f);
    const float Row = Narrow ? 470.0f : DesignHeight / 2.0f + (Flat ? 6.0f : 14.0f);
    const float LeftCentre = Narrow ? 275.0f : Flat ? 230.0f : 250.0f;
    const float RightCentre = Narrow ? 725.0f : Flat ? 770.0f : 750.0f;
    const char* Lamps[4][2] = { { "#8fd1ac", "ABS" }, { "#f0c27a", "TCS" }, { "#c9563d", "OIL" }, { "#94caff", "LOW BEAM" } };
    const float LampDown = Narrow ? 215.0f : Flat ? 36.0f : 54.0f;

    // The backdrop (gradient, gauge tracks, ticks, static captions, rim) is a whole-sheet raster — the costly part —
    //    and only changes with the housing, typefaces or vehicle name. It is kept and copied under every live frame,
    //    so a 30 Hz rpm update rasters just the arcs, needles, numerals and lamps.
    const std::string Name = Reading.VehicleName ? Reading.VehicleName : "";
    if (!BackdropValid || BackdropName != Name || Backdrop.QueryWidth() != Sheet.QueryWidth() || Backdrop.QueryHeight() != Sheet.QueryHeight())
    {
        (void)Backdrop.Resize(Sheet.QueryWidth(), Sheet.QueryHeight());
        Backdrop.Clear(DisplayColour{ 0u, 0u, 0u, 0u });
        Raster_.Begin(Backdrop, Scale, 0.0f, 0.0f, Faces[0], Faces[1], nullptr);
        Raster_.AssignMask(&Mask);
        Raster_.FillRectangle(0.0f, 0.0f, kClusterDesignWidth, DesignHeight, 0.0f,
                              DisplayPaint::Linear(0.0f, 0.0f, 0.0f, DesignHeight, C("#111c20"), C("#0b1113")));
        RasterGaugeBackdrop(LeftCentre, Row, Radius, kPi * 0.75f, kPi * 1.5f, "SPEED", "km/h", 0.0f);
        RasterGaugeBackdrop(RightCentre, Row, Radius, kPi * 0.75f, kPi * 1.5f, "ENGINE", "× 1000 rpm", Reading.Redline);
        (void)Raster_.Text(Reading.Caption, kClusterDesignWidth / 2.0f, Narrow ? 760.0f : DesignHeight - 44.0f, 13.0f, C("#8aa394"), DisplayTextAlignment::Centre);
        std::string Upper = Name;
        for (char& Ch : Upper) Ch = static_cast<char>(std::toupper(static_cast<unsigned char>(Ch)));
        (void)Raster_.Text(Upper.c_str(), kClusterDesignWidth / 2.0f, Row - (Flat ? 46.0f : 60.0f), 13.0f, C("#8aa394"), DisplayTextAlignment::Centre);
        for (int I = 0; I < 4; ++I)
            (void)Raster_.Text(Lamps[I][1], kClusterDesignWidth / 2.0f - 90.0f + I * 60.0f, LampDown + 20.0f, 9.0f, C("#7f978a"), DisplayTextAlignment::Centre);
        Raster_.AssignMask(nullptr);
        Raster_.StrokePolyline(SheetOutlineInset.data(), static_cast<uint32_t>(SheetOutlineInset.size()), 3.0f, C("#ffffff22"), true);
        BackdropValid = true; BackdropName = Name; BackdropCaption = Reading.Caption ? Reading.Caption : "";
    }
    else if (BackdropCaption != (Reading.Caption ? Reading.Caption : "")) { BackdropValid = false; return Raster(); }
    std::memcpy(Sheet.AccessTexels(), Backdrop.QueryTexels(), static_cast<size_t>(Sheet.QueryByteCount()));

    Raster_.Begin(Sheet, Scale, 0.0f, 0.0f, Faces[0], Faces[1], nullptr);
    Raster_.AssignMask(&Mask);
    char Speed[16], Revolutions[16];
    std::snprintf(Speed, sizeof(Speed), "%d", static_cast<int>(std::lround(std::fabs(Reading.SpeedKph))));
    std::snprintf(Revolutions, sizeof(Revolutions), "%.1f", std::round(Reading.EngineRpm / 100.0f) / 10.0f);
    // During power-on the needles sweep to full scale and back (the classic self-test), then hand over to the readings.
    float SpeedFraction = std::min(1.0f, std::fabs(Reading.SpeedKph) / Reading.SpeedLimitKph);
    float RpmFraction   = std::min(1.0f, Reading.EngineRpm / Reading.RpmLimit);
    if (Startup.Active())
    {
        const float Sweep = std::sin(std::clamp((Startup.Progress() - 0.1f) / 0.75f, 0.0f, 1.0f) * kPi);
        SpeedFraction = std::max(SpeedFraction, Sweep); RpmFraction = std::max(RpmFraction, Sweep);
    }
    RasterGauge(LeftCentre, Row, Radius, SpeedFraction, kPi * 0.75f, kPi * 1.5f, "#8fd1ac", Speed);
    RasterGauge(RightCentre, Row, Radius, RpmFraction, kPi * 0.75f, kPi * 1.5f, "#f0c27a", Revolutions);
    (void)Raster_.Text(Reading.Gear, kClusterDesignWidth / 2.0f, Row + (Flat ? 24.0f : 30.0f), Flat ? 66.0f : 84.0f, C("#f2f6ef"), DisplayTextAlignment::Centre, DisplayTextWeight::Light);
    const bool Lit[4] = { Reading.AbsActive, Reading.TractionActive, Reading.OilWarning, Reading.LowBeam };
    for (int I = 0; I < 4; ++I)
        Raster_.FillCircle(kClusterDesignWidth / 2.0f - 90.0f + I * 60.0f, LampDown, 6.0f, C(Lit[I] ? Lamps[I][0] : "#3a2b26"));
    if (Startup.Active()) Startup.Compose(Raster_, kClusterDesignWidth, DesignHeight);
    Raster_.AssignMask(nullptr);
    Sheet.Commit();
    Dirty = false;
    return true;
}

ClusterScreenReading ClusterScreenSequence::QueryReading() const noexcept
{
    ClusterScreenReading R;
    R.Outline = Outline; R.Revision = Sheet.QueryRevision(); R.Width = Sheet.QueryWidth(); R.Height = Sheet.QueryHeight();
    R.DesignHeight = DesignHeight; R.SpeedKph = Reading.SpeedKph; R.EngineRpm = Reading.EngineRpm; R.Gear = Reading.Gear;
    return R;
}

} // namespace Frontier
