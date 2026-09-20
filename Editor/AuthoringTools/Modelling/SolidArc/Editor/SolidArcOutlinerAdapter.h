//=============================================================================================================================================
// SolidArcOutlinerAdapter.h
//=============================================================================================================================================
// Maps a SolidArc CAD document to the shared Frontier editor outliner feed. The UI panel is still the engine's
// OutlinerPanel; this adapter only speaks its EditorInstance rows so SolidArc and Project-Zero share one outliner.

#pragma once

#include "Console/ConsoleHost.h"
#include "../../../../../Engine/Editor/EditorInstance.h"

#include <cstdint>

namespace Frontier {

struct SolidArcOutlinerBinding
{
    enum class Role : uint32_t
    {
        None = 0u,
        Figure,
        Dimension,
        Constraint,
    };

    Role     RowRole        = Role::None;
    uint32_t FigureIdentity = 0u;
    uint32_t DimensionId    = 0u;
    uint32_t ConstraintId   = 0u;
};

[[nodiscard]] uint32_t BuildSolidArcOutliner(const ConsoleHost& Host,
                                             EditorInstance* Rows,
                                             SolidArcOutlinerBinding* Bindings,
                                             uint32_t Capacity,
                                             EditorReadout* Readout) noexcept;

void ApplySolidArcOutlinerVisibility(ConsoleHost& Host,
                                      const EditorInstance* Rows,
                                      const SolidArcOutlinerBinding* Bindings,
                                      uint32_t RowCount) noexcept;

} // namespace Frontier
