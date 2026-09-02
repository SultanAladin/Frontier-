//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/VectorCodec.cpp — Categorized Scalable Vector Graphic (SVG) Path Decoders Implementation
//============================================================================================================================================

#include "VectorCodec.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           NAVIGATION GLYPH LOOKUP TABLE
//------------------------------------------------------------------------------------------------------------------------

const std::array<VectorGlyphRecord, static_cast<size_t>(NavigationIconCategory::Count)> VectorCodec::NavigationGlyphTable = {
    // 0: ArrowUp
    VectorGlyphRecord{
        "ArrowUp",
        "M12 19V5M5 12l7-7 7 7",
        24, 24, 2.0f
    },
    // 1: ArrowDown
    VectorGlyphRecord{
        "ArrowDown",
        "M12 5v14M19 12l-7 7-7-7",
        24, 24, 2.0f
    },
    // 2: ArrowLeft
    VectorGlyphRecord{
        "ArrowLeft",
        "M19 12H5M12 19l-7-7 7-7",
        24, 24, 2.0f
    },
    // 3: ArrowRight
    VectorGlyphRecord{
        "ArrowRight",
        "M5 12h14M12 5l7 7-7 7",
        24, 24, 2.0f
    },
    // 4: ChevronUp
    VectorGlyphRecord{
        "ChevronUp",
        "M18 15l-6-6-6 6",
        24, 24, 2.0f
    },
    // 5: ChevronDown
    VectorGlyphRecord{
        "ChevronDown",
        "M6 9l6 6 6-6",
        24, 24, 2.0f
    },
    // 6: ChevronLeft
    VectorGlyphRecord{
        "ChevronLeft",
        "M15 18l-6-6 6-6",
        24, 24, 2.0f
    },
    // 7: ChevronRight
    VectorGlyphRecord{
        "ChevronRight",
        "M9 18l6-6-6-6",
        24, 24, 2.0f
    },
    // 8: ChevronsUp
    VectorGlyphRecord{
        "ChevronsUp",
        "M17 11l-5-5-5 5M17 18l-5-5-5 5",
        24, 24, 2.0f
    },
    // 9: ChevronsDown
    VectorGlyphRecord{
        "ChevronsDown",
        "M7 13l5 5 5-5M7 6l5 5 5-5",
        24, 24, 2.0f
    },
    // 10: ChevronsLeft
    VectorGlyphRecord{
        "ChevronsLeft",
        "M11 17l-5-5 5-5M18 17l-5-5 5-5",
        24, 24, 2.0f
    },
    // 11: ChevronsRight
    VectorGlyphRecord{
        "ChevronsRight",
        "M13 17l5-5-5-5M6 17l5-5-5-5",
        24, 24, 2.0f
    },
    // 12: CornerDownRight
    VectorGlyphRecord{
        "CornerDownRight",
        "M15 10l5 5-5 5M4 4v7a4 4 0 0 0 4 4h12",
        24, 24, 2.0f
    },
    // 13: CornerDownLeft
    VectorGlyphRecord{
        "CornerDownLeft",
        "M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4",
        24, 24, 2.0f
    },
    // 14: RotateClockwise
    VectorGlyphRecord{
        "RotateClockwise",
        "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5",
        24, 24, 2.0f
    },
    // 15: RotateCounterClockwise
    VectorGlyphRecord{
        "RotateCounterClockwise",
        "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
        24, 24, 2.0f
    },
    // 16: ExpandDiagonal
    VectorGlyphRecord{
        "ExpandDiagonal",
        "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
        24, 24, 2.0f
    },
    // 17: CollapseDiagonal
    VectorGlyphRecord{
        "CollapseDiagonal",
        "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
        24, 24, 2.0f
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR ACCESSORS
//------------------------------------------------------------------------------------------------------------------------

const VectorGlyphRecord& VectorCodec::QueryNavigationIcon(NavigationIconCategory Icon) noexcept
{
    size_t Index = static_cast<size_t>(Icon);
    if (Index < NavigationGlyphTable.size())
    {
        return NavigationGlyphTable[Index];
    }
    return NavigationGlyphTable[0];
}

std::string_view VectorCodec::QueryNavigationSvgPath(NavigationIconCategory Icon) noexcept
{
    return QueryNavigationIcon(Icon).SvgPathString;
}

uint32_t VectorCodec::QueryNavigationIconCount() noexcept
{
    return static_cast<uint32_t>(NavigationGlyphTable.size());
}

} // namespace Frontier
