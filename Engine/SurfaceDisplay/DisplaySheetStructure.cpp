//============================================================================================================================================
//                                                      DISPLAYSHEETSTRUCTURE.CPP
//============================================================================================================================================
// 🧩 Sheet storage and the colour literal parser.

#include "DisplaySheetStructure.h"

#include <cstring>

namespace Frontier {

namespace {
[[nodiscard]] int HexValue(char C) noexcept
{
    if (C >= '0' && C <= '9') return C - '0';
    if (C >= 'a' && C <= 'f') return 10 + (C - 'a');
    if (C >= 'A' && C <= 'F') return 10 + (C - 'A');
    return -1;
}
} // namespace

DisplayColour ParseDisplayColour(const char* Literal) noexcept
{
    DisplayColour Colour{ 255u, 0u, 255u, 255u };   // loud magenta for a malformed literal — a wrong colour is easy to miss, this is not
    if (!Literal || Literal[0] != '#') return Colour;
    const size_t Length = std::strlen(Literal + 1);
    if (Length != 6u && Length != 8u) return Colour;
    uint8_t Channel[4] = { 0u, 0u, 0u, 255u };
    for (size_t I = 0u; I < Length / 2u; ++I)
    {
        const int High = HexValue(Literal[1 + I * 2u]), Low = HexValue(Literal[2 + I * 2u]);
        if (High < 0 || Low < 0) return Colour;
        Channel[I] = static_cast<uint8_t>(High * 16 + Low);
    }
    return DisplayColour{ Channel[0], Channel[1], Channel[2], Channel[3] };
}

bool DisplaySheetStructure::Resize(uint32_t NewWidth, uint32_t NewHeight) noexcept
{
    if (NewWidth == Width && NewHeight == Height && !Texels.empty()) return false;
    Width = NewWidth; Height = NewHeight;
    Texels.assign(static_cast<size_t>(Width) * Height * 4u, 0u);
    return true;
}

void DisplaySheetStructure::Clear(DisplayColour Colour) noexcept
{
    const size_t Count = static_cast<size_t>(Width) * Height;
    for (size_t I = 0u; I < Count; ++I)
    {
        Texels[I * 4u + 0u] = Colour.Red; Texels[I * 4u + 1u] = Colour.Green;
        Texels[I * 4u + 2u] = Colour.Blue; Texels[I * 4u + 3u] = Colour.Alpha;
    }
}

DisplayColour DisplaySheetStructure::QueryTexel(uint32_t X, uint32_t Y) const noexcept
{
    if (X >= Width || Y >= Height) return DisplayColour{ 0u, 0u, 0u, 0u };
    const uint8_t* T = Texels.data() + (static_cast<size_t>(Y) * Width + X) * 4u;
    return DisplayColour{ T[0], T[1], T[2], T[3] };
}

} // namespace Frontier
