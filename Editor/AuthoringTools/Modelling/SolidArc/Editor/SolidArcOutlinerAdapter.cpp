//=============================================================================================================================================
// SolidArcOutlinerAdapter.cpp
//=============================================================================================================================================

#include "SolidArcOutlinerAdapter.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace Frontier {
namespace {

struct SolidArcBucket
{
    FigureClassification Class;
    const char*          Label;
    EditorGlyph          Glyph;
    EditorNarrowing      Narrowing;
    float                Tint[3];
    uint32_t             Count = 0u;
};

void ClearRow(EditorInstance& Row, SolidArcOutlinerBinding& Binding) noexcept
{
    Row = EditorInstance{};
    Binding = SolidArcOutlinerBinding{};
}

void CopyText(char* Destination, size_t Capacity, const char* Text) noexcept
{
    if (Capacity == 0u)
        return;
    std::snprintf(Destination, Capacity, "%s", Text != nullptr ? Text : "");
}

void SeatFolder(EditorInstance& Row,
                const char* Label,
                uint32_t Depth,
                uint32_t KidCount,
                EditorGlyph Glyph,
                EditorNarrowing Narrowing,
                const float Tint[3]) noexcept
{
    CopyText(Row.Label, sizeof(Row.Label), Label);
    Row.Depth      = Depth;
    Row.KidCount   = KidCount;
    Row.Category   = EditorInstanceCategory::Folder;
    Row.Glyph      = Glyph;
    Row.Narrowing  = Narrowing;
    Row.Pinned     = true;
    Row.Visible    = true;
    Row.Tint[0]    = Tint[0];
    Row.Tint[1]    = Tint[1];
    Row.Tint[2]    = Tint[2];
}

const char* ClassLabel(FigureClassification Class) noexcept
{
    switch (Class)
    {
    case FigureClassification::Curve:   return "Curve";
    case FigureClassification::Surface: return "Surface";
    case FigureClassification::Body:    return "Body";
    case FigureClassification::Empty:   return "Empty";
    default:                            return "Figure";
    }
}

EditorGlyph FigureGlyph(FigureClassification Class) noexcept
{
    switch (Class)
    {
    case FigureClassification::Curve:   return EditorGlyph::Wave;
    case FigureClassification::Surface: return EditorGlyph::Plane;
    case FigureClassification::Body:    return EditorGlyph::Lattice;
    case FigureClassification::Empty:   return EditorGlyph::Orbit;
    default:                            return EditorGlyph::Auto;
    }
}

EditorNarrowing FigureNarrowing(FigureClassification Class) noexcept
{
    return Class == FigureClassification::Empty ? EditorNarrowing::Bodies : EditorNarrowing::Geometry;
}

uint32_t CountClass(const ConsoleHost& Host, FigureClassification Class) noexcept
{
    uint32_t Count = 0u;
    for (const SceneFigure& Figure : Host.AllFigures())
        if (Figure.Classification == Class)
            ++Count;
    return Count;
}

} // namespace

uint32_t BuildSolidArcOutliner(const ConsoleHost& Host,
                               EditorInstance* Rows,
                               SolidArcOutlinerBinding* Bindings,
                               uint32_t Capacity,
                               EditorReadout* Readout) noexcept
{
    if (Rows == nullptr || Bindings == nullptr || Capacity == 0u)
        return 0u;

    for (uint32_t I = 0u; I < Capacity; ++I)
        ClearRow(Rows[I], Bindings[I]);

    SolidArcBucket Buckets[] =
    {
        { FigureClassification::Body,    "Bodies",   EditorGlyph::Lattice, EditorNarrowing::Geometry, { 0.72f, 0.76f, 0.82f }, 0u },
        { FigureClassification::Surface, "Surfaces", EditorGlyph::Plane,   EditorNarrowing::Geometry, { 0.58f, 0.76f, 1.00f }, 0u },
        { FigureClassification::Curve,   "Curves",   EditorGlyph::Wave,    EditorNarrowing::Geometry, { 0.45f, 0.88f, 0.72f }, 0u },
        { FigureClassification::Empty,   "Empties",  EditorGlyph::Orbit,   EditorNarrowing::Bodies,   { 0.96f, 0.80f, 0.42f }, 0u },
    };
    uint32_t FolderCount = 0u;
    for (SolidArcBucket& Bucket : Buckets)
    {
        Bucket.Count = CountClass(Host, Bucket.Class);
        if (Bucket.Count > 0u)
            ++FolderCount;
    }
    const uint32_t DimensionCount = static_cast<uint32_t>(Host.AllDimensions().size());
    const uint32_t ConstraintCount = static_cast<uint32_t>(Host.AllConstraints().size());
    if (DimensionCount > 0u)
        ++FolderCount;
    if (ConstraintCount > 0u)
        ++FolderCount;

    uint32_t At = 0u;
    const float RootTint[3] = { 0.82f, 0.84f, 0.90f };
    SeatFolder(Rows[At], "SolidArc Document", 0u, FolderCount, EditorGlyph::Folder, EditorNarrowing::Geometry, RootTint);
    CopyText(Rows[At].Meta, sizeof(Rows[At].Meta), "CAD");
    ++At;

    const auto AddFigureFolder = [&](const SolidArcBucket& Bucket) noexcept
    {
        if (Bucket.Count == 0u || At >= Capacity)
            return;
        const uint32_t FolderRow = At++;
        SeatFolder(Rows[FolderRow], Bucket.Label, 1u, Bucket.Count, Bucket.Glyph, Bucket.Narrowing, Bucket.Tint);
        char CountText[24] = {};
        std::snprintf(CountText, sizeof(CountText), "%u", Bucket.Count);
        CopyText(Rows[FolderRow].Meta, sizeof(Rows[FolderRow].Meta), CountText);

        for (const SceneFigure& Figure : Host.AllFigures())
        {
            if (Figure.Classification != Bucket.Class || At >= Capacity)
                continue;
            EditorInstance& Row = Rows[At];
            SolidArcOutlinerBinding& Binding = Bindings[At];
            CopyText(Row.Label, sizeof(Row.Label), Figure.Name.c_str());
            Row.Depth     = 2u;
            Row.KidCount  = 0u;
            Row.Category  = EditorInstanceCategory::Geometry;
            Row.Glyph     = FigureGlyph(Figure.Classification);
            Row.Narrowing = FigureNarrowing(Figure.Classification);
            Row.Visible   = !Figure.Hidden;
            Row.Locked    = Figure.Construction;
            Row.Tint[0]   = Figure.Tint[0];
            Row.Tint[1]   = Figure.Tint[1];
            Row.Tint[2]   = Figure.Tint[2];
            CopyText(Row.Meta, sizeof(Row.Meta), ClassLabel(Figure.Classification));
            if (Figure.Construction)
                CopyText(Row.Tag, sizeof(Row.Tag), "Ref");
            if (Figure.Selected)
            {
                Row.Standing = EditorStanding::Ok;
                CopyText(Row.StandingNote, sizeof(Row.StandingNote), "Selected");
            }
            Binding.RowRole = SolidArcOutlinerBinding::Role::Figure;
            Binding.FigureIdentity = Figure.Identity;
            ++At;
        }
    };

    for (const SolidArcBucket& Bucket : Buckets)
        AddFigureFolder(Bucket);

    if (DimensionCount > 0u && At < Capacity)
    {
        const float DimTint[3] = { 0.86f, 0.72f, 1.00f };
        const uint32_t FolderRow = At++;
        SeatFolder(Rows[FolderRow], "Dimensions", 1u, DimensionCount, EditorGlyph::Sliders, EditorNarrowing::Geometry, DimTint);
        for (const ConsoleHost::DimensionEntry& Dimension : Host.AllDimensions())
        {
            if (At >= Capacity)
                break;
            EditorInstance& Row = Rows[At];
            SolidArcOutlinerBinding& Binding = Bindings[At];
            CopyText(Row.Label, sizeof(Row.Label), Dimension.AnchorName.empty() ? "Dimension" : Dimension.AnchorName.c_str());
            Row.Depth     = 2u;
            Row.Category  = EditorInstanceCategory::Geometry;
            Row.Glyph     = EditorGlyph::Sliders;
            Row.Narrowing = EditorNarrowing::Geometry;
            Row.Visible   = !Dimension.Hidden;
            Row.Tint[0]   = DimTint[0]; Row.Tint[1] = DimTint[1]; Row.Tint[2] = DimTint[2];
            CopyText(Row.Meta, sizeof(Row.Meta), Dimension.Label.c_str());
            Binding.RowRole = SolidArcOutlinerBinding::Role::Dimension;
            Binding.DimensionId = Dimension.Id;
            ++At;
        }
    }

    if (ConstraintCount > 0u && At < Capacity)
    {
        const float ConstraintTint[3] = { 1.00f, 0.78f, 0.48f };
        const uint32_t FolderRow = At++;
        SeatFolder(Rows[FolderRow], "Constraints", 1u, ConstraintCount, EditorGlyph::Key, EditorNarrowing::Geometry, ConstraintTint);
        for (const ConstraintEntry& Constraint : Host.AllConstraints())
        {
            if (At >= Capacity)
                break;
            EditorInstance& Row = Rows[At];
            SolidArcOutlinerBinding& Binding = Bindings[At];
            CopyText(Row.Label, sizeof(Row.Label), Constraint.Note.empty() ? "Constraint" : Constraint.Note.c_str());
            Row.Depth     = 2u;
            Row.Category  = EditorInstanceCategory::Geometry;
            Row.Glyph     = EditorGlyph::Key;
            Row.Narrowing = EditorNarrowing::Geometry;
            Row.Visible   = true;
            Row.Tint[0]   = ConstraintTint[0]; Row.Tint[1] = ConstraintTint[1]; Row.Tint[2] = ConstraintTint[2];
            char IdText[24] = {};
            std::snprintf(IdText, sizeof(IdText), "#%u", Constraint.Id);
            CopyText(Row.Meta, sizeof(Row.Meta), IdText);
            Binding.RowRole = SolidArcOutlinerBinding::Role::Constraint;
            Binding.ConstraintId = Constraint.Id;
            ++At;
        }
    }

    if (Readout != nullptr)
    {
        *Readout = EditorReadout{};
        Readout->Fps = 60.0f;
        CopyText(Readout->Quality, sizeof(Readout->Quality), "CAD");
        const RasterExchange::Tally Tally = Host.Raster().QueryTally();
        Readout->Triangles = Tally.Triangles;
        CopyText(Readout->Scene, sizeof(Readout->Scene), "SolidArc");
    }

    return At;
}

void ApplySolidArcOutlinerVisibility(ConsoleHost& Host,
                                      const EditorInstance* Rows,
                                      const SolidArcOutlinerBinding* Bindings,
                                      uint32_t RowCount) noexcept
{
    if (Rows == nullptr || Bindings == nullptr)
        return;

    for (uint32_t I = 0u; I < RowCount; ++I)
    {
        if (Bindings[I].RowRole != SolidArcOutlinerBinding::Role::Figure || Bindings[I].FigureIdentity == 0u)
            continue;
        SceneFigure* Figure = Host.Document().Find(Bindings[I].FigureIdentity);
        if (Figure != nullptr)
            Figure->Hidden = !Rows[I].Visible;
    }
}

} // namespace Frontier
