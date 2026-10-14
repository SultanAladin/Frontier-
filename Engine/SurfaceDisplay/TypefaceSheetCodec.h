//============================================================================================================================================
//                                                       TYPEFACESHEETCODEC.H
//============================================================================================================================================
// 🧩 Decodes a TrueType/OpenType face (stb_truetype, CFF included — the shipped Inter faces are .otf) into glyph
//    coverage bitmaps on demand, cached per (codepoint, pixel size). This is the CPU text path for display sheets;
//    it has nothing to do with the ImGui atlas the editor uses (TypefaceRegistry), because a project image must not
//    depend on the host's UI backend.
//
//    Measurement and layout are deliberately simple: horizontal advance + kerning pairs, one line, UTF-8 in. No
//    shaping, no bidi, no fallback faces — the prototype's strings are Latin with a few symbols (°, ·, ›, →, −).

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace Frontier {

struct GlyphSheet
{
    int32_t              Width = 0, Height = 0;    // [px] bitmap extent
    int32_t              OffsetX = 0, OffsetY = 0; // [px] bitmap origin relative to the pen (Y down from the baseline)
    float                Advance = 0.0f;           // [px] pen step
    std::vector<uint8_t> Coverage;                 // [-]  Width×Height, 0..255
};

class TypefaceSheetCodec
{
public:
    TypefaceSheetCodec() noexcept;
    ~TypefaceSheetCodec() noexcept;
    TypefaceSheetCodec(const TypefaceSheetCodec&) = delete;
    TypefaceSheetCodec& operator=(const TypefaceSheetCodec&) = delete;

    // Reads the whole file and parses the first face. False (with Explanation) when the file is absent or not a font.
    [[nodiscard]] bool Decode(const std::string& Path, std::string* Explanation = nullptr) noexcept;
    [[nodiscard]] bool Ready() const noexcept { return Loaded; }

    // Glyph for a Unicode codepoint at the pixel size (em height as stb defines it: ascent − descent). Null when
    //    the face has no glyph for it (the caller skips the character; a missing glyph is visible, a wrong one is not).
    [[nodiscard]] const GlyphSheet* Glyph(uint32_t Codepoint, float PixelSize) noexcept;
    [[nodiscard]] float Kerning(uint32_t Previous, uint32_t Next, float PixelSize) const noexcept;
    // Advance width of a UTF-8 string, kerning included.
    [[nodiscard]] float Measure(const char* Utf8, float PixelSize) noexcept;
    // Ascent above the baseline at the size (positive).
    [[nodiscard]] float Ascent(float PixelSize) const noexcept;

    // Decodes one UTF-8 sequence; advances Cursor. Returns U+FFFD on malformed bytes.
    [[nodiscard]] static uint32_t NextCodepoint(const char*& Cursor) noexcept;

private:
    struct Face;
    std::unique_ptr<Face>                      Record;
    std::vector<uint8_t>                       Bytes;
    std::unordered_map<uint64_t, GlyphSheet>   Cache;
    bool                                       Loaded = false;
};

} // namespace Frontier
