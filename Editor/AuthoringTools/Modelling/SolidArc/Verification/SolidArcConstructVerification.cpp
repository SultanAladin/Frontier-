#include "Console/ConsoleHost.h"
#include "Editor/SolidArcConstructCatalog.h"

#include <cmath>
#include <cstdio>
#include <cstring>

int main()
{
    using namespace Frontier;
    ConsoleHost Host("/tmp/solidarc-construct-verification", 256, 192);
    if (Host.QueryShading() != SurfaceShading::Matcap || kDefaultViewportShading != ViewportShadingMode::Matcap)
        return 8;
    Host.AssignShading(SurfaceShading::Flat);
    if (Host.QueryShading() != SurfaceShading::Flat)
        return 9;
    Host.AssignShading(SurfaceShading::Matcap);
    Host.AssignLatticeCell(0.01);
    if (Host.LatticeCell() < 0.0099 || Host.LatticeCell() > 0.0101)
        return 1;

    const char* Sections[] = { "Reference", "Sketch Draw", "Solid", "Surface" };
    uint32_t SectionCounts[4] = {};
    for (uint32_t Tile = 0u; Tile < kSolidArcConstructTileCount; ++Tile)
    {
        const SolidArcConstructTile& Definition = kSolidArcConstructTiles[Tile];
        uint32_t Section = 0u;
        while (Section < 4u && std::strcmp(Definition.Section, Sections[Section]) != 0)
            ++Section;
        if (Section >= 4u || Definition.Label == nullptr || Definition.Label[0] == '\0')
            return 2;
        ++SectionCounts[Section];

        const std::string Command = BuildSolidArcConstructCommand(Tile, double(Tile) * 2.0, 0.0);
        if (Command.empty() || !Host.Execute(Command))
        {
            std::fprintf(stderr, "[SolidArc] Construct tile %u (%s) failed: %s\n", Tile, Definition.Label, Command.c_str());
            return 3;
        }
    }

    if (SectionCounts[0] != 1u || SectionCounts[1] != 11u || SectionCounts[2] != 5u || SectionCounts[3] != 5u)
        return 4;
    if (Host.AllFigures().size() != kSolidArcConstructTileCount || Host.RefusalCount() != 0)
        return 5;
    for (const SceneFigure& Figure : Host.AllFigures())
        if (Figure.Matcap != kDefaultMetalMatcapLayer)
            return 10;
    const Box3 CentreRectangle = Host.AllFigures()[4].Bounds();
    if (std::abs(CentreRectangle.Low.X - 7.3) > 1e-3 || std::abs(CentreRectangle.High.X - 8.7) > 1e-3 ||
        std::abs(CentreRectangle.Low.Y + 0.5) > 1e-3 || std::abs(CentreRectangle.High.Y - 0.5) > 1e-3)
        return 7;

    const std::string Invalid = BuildSolidArcConstructCommand(kSolidArcConstructTileCount, 0.0, 0.0);
    if (!Invalid.empty())
        return 6;
    std::printf("[SolidArc] Construct catalogue created all %u C++ primitives on the 10 mm lattice\n", kSolidArcConstructTileCount);
    return 0;
}
