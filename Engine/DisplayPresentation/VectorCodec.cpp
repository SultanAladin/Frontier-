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
//                                         CONTROL CENTRE GLYPH LOOKUP TABLE
//------------------------------------------------------------------------------------------------------------------------

const std::array<VectorGlyphRecord, static_cast<size_t>(ControlCentreIconCategory::Count)> VectorCodec::ControlCentreGlyphTable = {
    // 0: SettingsGear
    VectorGlyphRecord{
        "SettingsGear",
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
        24, 24, 2.0f
    },
    // 1: AppearancePalette
    VectorGlyphRecord{
        "AppearancePalette",
        "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z",
        24, 24, 2.0f
    },
    // 2: DisplayMonitor
    VectorGlyphRecord{
        "DisplayMonitor",
        "M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm6 16h8m-4-4v4",
        24, 24, 2.0f
    },
    // 3: InputDevices
    VectorGlyphRecord{
        "InputDevices",
        "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
        24, 24, 2.0f
    },
    // 4: NotificationsBell
    VectorGlyphRecord{
        "NotificationsBell",
        "M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
        24, 24, 2.0f
    },
    // 5: WirelessSignal
    VectorGlyphRecord{
        "WirelessSignal",
        "M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0",
        24, 24, 2.0f
    },
    // 6: BluetoothSymbol
    VectorGlyphRecord{
        "BluetoothSymbol",
        "M7 7l10 10-5 5V2l5 5L7 17",
        24, 24, 2.0f
    },
    // 7: MoonDisturbance
    VectorGlyphRecord{
        "MoonDisturbance",
        "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
        24, 24, 2.0f
    },
    // 8: VolumeSpeaker
    VectorGlyphRecord{
        "VolumeSpeaker",
        "M11 5L6 9H2v6h4l5 4V5zm8.07-.07a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07",
        24, 24, 2.0f
    },
    // 9: SunIllumination — lucide "sun": circle r4 + 8 rays
    VectorGlyphRecord{
        "SunIllumination",
        "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
        24, 24, 2.0f
    },
    // 10: SparklesAntiAliasing — lucide "sparkles"
    VectorGlyphRecord{
        "SparklesAntiAliasing",
        "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4M6 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
        24, 24, 2.0f
    },
    // 11: GaugeFrameRate — lucide "gauge"
    VectorGlyphRecord{
        "GaugeFrameRate",
        "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0",
        24, 24, 2.0f
    },
    // 12: SlidersQuality — lucide "sliders-horizontal"
    VectorGlyphRecord{
        "SlidersQuality",
        "M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3",
        24, 24, 2.0f
    },
    // 13: VideoRenderScale — lucide "video": lens path + rounded rect x2 y6 w14 h12 rx2
    VectorGlyphRecord{
        "VideoRenderScale",
        "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
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

const VectorGlyphRecord& VectorCodec::QueryControlCentreIcon(ControlCentreIconCategory Icon) noexcept
{
    size_t Index = static_cast<size_t>(Icon);
    if (Index < ControlCentreGlyphTable.size())
    {
        return ControlCentreGlyphTable[Index];
    }
    return ControlCentreGlyphTable[0];
}

std::string_view VectorCodec::QueryControlCentreSvgPath(ControlCentreIconCategory Icon) noexcept
{
    return QueryControlCentreIcon(Icon).SvgPathString;
}

uint32_t VectorCodec::QueryControlCentreIconCount() noexcept
{
    return static_cast<uint32_t>(ControlCentreGlyphTable.size());
}

} // namespace Frontier
