//============================================================================================================================================
//                                                      DISPLAYSHEETSTRUCTURE.H
//============================================================================================================================================
// 🧩 The texel sheet behind one flat, texture-backed display in the world: RGBA8 (sRGB encoded colour, straight alpha),
//    origin top-left, +Y down, sized in device pixels. The sheet is what the raster projection draws into, what the
//    project hands across the display interchange, and what the host re-seats as the Emission texture of the display's
//    material — so a display is an ordinary emissive surface for ReSTIR and the distance-field GI.
//
//    Alpha carries the shape mask: an irregular housing (hexagon, cut circle, pill) leaves the corners at alpha 0 and
//    the quad's material treats those texels as black emission. The sheet is never stretched to a different aspect;
//    `Resize` reallocates, which is the "no squashed artwork" rule from the prototype made structural.
//
//    Revision advances on every completed raster (`Commit`) so a consumer can tell "new picture" from "same picture"
//    without comparing bytes.

#pragma once

#include <cstdint>
#include <vector>

namespace Frontier {

struct DisplayColour
{
    uint8_t Red = 0u, Green = 0u, Blue = 0u, Alpha = 255u;   // [-] sRGB-encoded 8-bit colour, straight alpha
};

// "#rrggbb" / "#rrggbbaa" (the prototype's literals), so every colour in the port is traceable to the HTML source.
[[nodiscard]] DisplayColour ParseDisplayColour(const char* Literal) noexcept;
[[nodiscard]] constexpr DisplayColour MakeDisplayColour(uint8_t R, uint8_t G, uint8_t B, uint8_t A = 255u) noexcept { return DisplayColour{ R, G, B, A }; }

class DisplaySheetStructure
{
public:
    DisplaySheetStructure() noexcept = default;
    DisplaySheetStructure(uint32_t Width, uint32_t Height) noexcept { Resize(Width, Height); }

    // Reallocates (and clears to transparent black) when the size differs. Returns true when storage changed —
    //    the signal a resident GPU image must be recreated rather than sub-uploaded.
    bool Resize(uint32_t Width, uint32_t Height) noexcept;
    void Clear(DisplayColour Colour) noexcept;
    void Commit() noexcept { ++Revision; }

    [[nodiscard]] uint32_t             QueryWidth()    const noexcept { return Width; }
    [[nodiscard]] uint32_t             QueryHeight()   const noexcept { return Height; }
    [[nodiscard]] uint64_t             QueryRevision() const noexcept { return Revision; }
    [[nodiscard]] uint64_t             QueryByteCount() const noexcept { return static_cast<uint64_t>(Width) * Height * 4u; }
    [[nodiscard]] const uint8_t*       QueryTexels()   const noexcept { return Texels.data(); }
    [[nodiscard]] uint8_t*             AccessTexels()        noexcept { return Texels.data(); }
    [[nodiscard]] DisplayColour        QueryTexel(uint32_t X, uint32_t Y) const noexcept;
    [[nodiscard]] bool                 Empty()         const noexcept { return Texels.empty(); }

private:
    uint32_t             Width = 0u, Height = 0u;
    uint64_t             Revision = 0u;
    std::vector<uint8_t> Texels;
};

} // namespace Frontier
