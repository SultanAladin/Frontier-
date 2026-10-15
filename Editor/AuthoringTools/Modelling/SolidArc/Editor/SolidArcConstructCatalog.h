//=============================================================================================================================================
// SolidArcConstructCatalog.h
// A small, presentation-independent Construct catalogue shared by the standalone Vulkan shell and C++ verification.
//=============================================================================================================================================
#pragma once

#include <array>
#include <cstddef>
#include <cstdio>
#include <cstdint>
#include <string>

namespace Frontier {

struct SolidArcConstructTile
{
    const char* Section;
    const char* Label;
    const char* Shortcut;
};

inline constexpr std::array<SolidArcConstructTile, 22> kSolidArcConstructTiles = {{
    { "Reference",   "Plane",           ""  },
    { "Sketch Draw", "Line",            "L" },
    { "Sketch Draw", "Polyline",        ""  },
    { "Sketch Draw", "Rectangle",       "R" },
    { "Sketch Draw", "Centre Rectangle", "" },
    { "Sketch Draw", "Slot",            ""  },
    { "Sketch Draw", "Circle",          "C" },
    { "Sketch Draw", "Arc",             "A" },
    { "Sketch Draw", "Ellipse",         ""  },
    { "Sketch Draw", "Polygon",         "P" },
    { "Sketch Draw", "Spline",          ""  },
    { "Sketch Draw", "Control Curve",   ""  },
    { "Solid",       "Box",             ""  },
    { "Solid",       "Sphere",          ""  },
    { "Solid",       "Cylinder",        ""  },
    { "Solid",       "Cone",            ""  },
    { "Solid",       "Torus",           ""  },
    { "Surface",     "Sphere Sheet",    ""  },
    { "Surface",     "Cylinder Sheet",  ""  },
    { "Surface",     "Cone Sheet",      ""  },
    { "Surface",     "Torus Sheet",     ""  },
    { "Surface",     "Patch",           ""  },
}};

inline constexpr uint32_t kSolidArcConstructTileCount = static_cast<uint32_t>(kSolidArcConstructTiles.size());

// Every tile is deliberately a deterministic default-size shape centred around the selected XY anchor.
// The menu only chooses a tile; placement requires a real viewport hit and an explicit Enter confirmation.
[[nodiscard]] inline std::string BuildSolidArcConstructCommand(uint32_t Tile, double X, double Y) noexcept
{
    char Line[640] = {};
    switch (Tile)
    {
    case 0:  std::snprintf(Line, sizeof(Line), "plane (%.3f,%.3f,0) 1.4 1.4", X - 0.7, Y - 0.7); break;
    case 1:  std::snprintf(Line, sizeof(Line), "line (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 2:  std::snprintf(Line, sizeof(Line), "polyline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.5, X - 0.3, Y + 0.5, X + 0.3, Y - 0.2, X + 0.8, Y + 0.5); break;
    case 3:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 4:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (0.7,0.5) --center", X, Y); break;
    case 5:  std::snprintf(Line, sizeof(Line), "slot (%.3f,%.3f) (%.3f,%.3f) 0.25", X - 0.5, Y, X + 0.5, Y); break;
    case 6:  std::snprintf(Line, sizeof(Line), "circle (%.3f,%.3f) 0.6", X, Y); break;
    case 7:  std::snprintf(Line, sizeof(Line), "arc (%.3f,%.3f) 0.7 -60 240", X, Y); break;
    case 8:  std::snprintf(Line, sizeof(Line), "ellipse (%.3f,%.3f) 0.8 0.45", X, Y); break;
    case 9:  std::snprintf(Line, sizeof(Line), "polygon (%.3f,%.3f) 0.6 6", X, Y); break;
    case 10: std::snprintf(Line, sizeof(Line), "spline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                            X - 0.8, Y - 0.3, X - 0.3, Y + 0.5, X + 0.3, Y - 0.5, X + 0.8, Y + 0.3); break;
    case 11: std::snprintf(Line, sizeof(Line), "cpcurve (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                            X - 0.8, Y - 0.3, X - 0.3, Y + 0.6, X + 0.3, Y - 0.6, X + 0.8, Y + 0.3); break;
    case 12: std::snprintf(Line, sizeof(Line), "box (%.3f,%.3f,0) 1 1 1", X - 0.5, Y - 0.5); break;
    case 13: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6", X, Y); break;
    case 14: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2", X, Y); break;
    case 15: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2", X, Y); break;
    case 16: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25", X, Y); break;
    case 17: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6 --sheet", X, Y); break;
    case 18: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2 --sheet", X, Y); break;
    case 19: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2 --sheet", X, Y); break;
    case 20: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25 --sheet", X, Y); break;
    case 21:
    {
        int Used = std::snprintf(Line, sizeof(Line), "patch 3 3 --degree=2");
        for (int Row = 0; Row < 3 && Used > 0 && static_cast<std::size_t>(Used) < sizeof(Line); ++Row)
            for (int Column = 0; Column < 3 && Used > 0 && static_cast<std::size_t>(Used) < sizeof(Line); ++Column)
                Used += std::snprintf(Line + Used, sizeof(Line) - static_cast<std::size_t>(Used), " (%.3f,%.3f,%.3f)",
                    X + (Column - 1) * 0.7, Y + (Row - 1) * 0.7, (Row == 1 && Column == 1) ? 0.5 : 0.0);
        break;
    }
    default: return {};
    }
    return std::string(Line);
}

} // namespace Frontier
