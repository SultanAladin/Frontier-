//============================================================================================================================================
//                                                       TYPEFACESHEETCODEC.CPP
//============================================================================================================================================
// 🧩 stb_truetype decode and the glyph cache. The only TU that defines STB_TRUETYPE_IMPLEMENTATION.

#include "TypefaceSheetCodec.h"

#include <cmath>
#include <cstring>
#include <fstream>

#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#include <stb_truetype.h>

namespace Frontier {

struct TypefaceSheetCodec::Face
{
    stbtt_fontinfo Info{};
    int            Ascent = 0, Descent = 0, LineGap = 0;
};

TypefaceSheetCodec::TypefaceSheetCodec() noexcept : Record(std::make_unique<Face>()) {}
TypefaceSheetCodec::~TypefaceSheetCodec() noexcept = default;

bool TypefaceSheetCodec::Decode(const std::string& Path, std::string* Explanation) noexcept
{
    Loaded = false;
    Cache.clear();
    std::ifstream Stream(Path, std::ios::binary);
    if (!Stream)
    {
        if (Explanation) *Explanation = "Typeface file not found: " + Path;
        return false;
    }
    Bytes.assign(std::istreambuf_iterator<char>(Stream), std::istreambuf_iterator<char>());
    if (Bytes.empty() || !stbtt_InitFont(&Record->Info, Bytes.data(), stbtt_GetFontOffsetForIndex(Bytes.data(), 0)))
    {
        if (Explanation) *Explanation = "Typeface could not be parsed: " + Path;
        Bytes.clear();
        return false;
    }
    stbtt_GetFontVMetrics(&Record->Info, &Record->Ascent, &Record->Descent, &Record->LineGap);
    Loaded = true;
    return true;
}

const GlyphSheet* TypefaceSheetCodec::Glyph(uint32_t Codepoint, float PixelSize) noexcept
{
    if (!Loaded || PixelSize <= 0.0f) return nullptr;
    const uint32_t SizeKey = static_cast<uint32_t>(std::lround(PixelSize * 4.0f));   // quarter-pixel size buckets
    const uint64_t Key = (static_cast<uint64_t>(SizeKey) << 32) | Codepoint;
    if (auto Found = Cache.find(Key); Found != Cache.end()) return Found->second.Width < 0 ? nullptr : &Found->second;
    const int Index = stbtt_FindGlyphIndex(&Record->Info, static_cast<int>(Codepoint));
    if (Index == 0 && Codepoint != 32u)
    {
        GlyphSheet Missing; Missing.Width = -1;
        Cache.emplace(Key, std::move(Missing));
        return nullptr;
    }
    const float Scale = stbtt_ScaleForPixelHeight(&Record->Info, SizeKey / 4.0f);
    int Advance = 0, Bearing = 0;
    stbtt_GetGlyphHMetrics(&Record->Info, Index, &Advance, &Bearing);
    GlyphSheet Sheet;
    Sheet.Advance = Advance * Scale;
    int X0 = 0, Y0 = 0, X1 = 0, Y1 = 0;
    stbtt_GetGlyphBitmapBoxSubpixel(&Record->Info, Index, Scale, Scale, 0.0f, 0.0f, &X0, &Y0, &X1, &Y1);
    Sheet.Width = X1 - X0; Sheet.Height = Y1 - Y0; Sheet.OffsetX = X0; Sheet.OffsetY = Y0;
    if (Sheet.Width > 0 && Sheet.Height > 0)
    {
        Sheet.Coverage.assign(static_cast<size_t>(Sheet.Width) * Sheet.Height, 0u);
        stbtt_MakeGlyphBitmapSubpixel(&Record->Info, Sheet.Coverage.data(), Sheet.Width, Sheet.Height, Sheet.Width, Scale, Scale, 0.0f, 0.0f, Index);
    }
    else { Sheet.Width = 0; Sheet.Height = 0; }
    return &Cache.emplace(Key, std::move(Sheet)).first->second;
}

float TypefaceSheetCodec::Kerning(uint32_t Previous, uint32_t Next, float PixelSize) const noexcept
{
    if (!Loaded || Previous == 0u) return 0.0f;
    const float Scale = stbtt_ScaleForPixelHeight(&Record->Info, PixelSize);
    return stbtt_GetCodepointKernAdvance(&Record->Info, static_cast<int>(Previous), static_cast<int>(Next)) * Scale;
}

float TypefaceSheetCodec::Measure(const char* Utf8, float PixelSize) noexcept
{
    if (!Loaded || !Utf8) return 0.0f;
    float Width = 0.0f; uint32_t Previous = 0u;
    const char* Cursor = Utf8;
    while (*Cursor)
    {
        const uint32_t Code = NextCodepoint(Cursor);
        if (const GlyphSheet* G = Glyph(Code, PixelSize)) { Width += G->Advance + Kerning(Previous, Code, PixelSize); Previous = Code; }
    }
    return Width;
}

float TypefaceSheetCodec::Ascent(float PixelSize) const noexcept
{
    if (!Loaded) return 0.0f;
    return Record->Ascent * stbtt_ScaleForPixelHeight(&Record->Info, PixelSize);
}

uint32_t TypefaceSheetCodec::NextCodepoint(const char*& Cursor) noexcept
{
    const unsigned char Lead = static_cast<unsigned char>(*Cursor);
    if (Lead < 0x80u) { ++Cursor; return Lead; }
    int Length = 0; uint32_t Code = 0u;
    if ((Lead & 0xE0u) == 0xC0u) { Length = 1; Code = Lead & 0x1Fu; }
    else if ((Lead & 0xF0u) == 0xE0u) { Length = 2; Code = Lead & 0x0Fu; }
    else if ((Lead & 0xF8u) == 0xF0u) { Length = 3; Code = Lead & 0x07u; }
    else { ++Cursor; return 0xFFFDu; }
    ++Cursor;
    for (int I = 0; I < Length; ++I)
    {
        const unsigned char Trail = static_cast<unsigned char>(*Cursor);
        if ((Trail & 0xC0u) != 0x80u) return 0xFFFDu;
        Code = (Code << 6) | (Trail & 0x3Fu);
        ++Cursor;
    }
    return Code;
}

} // namespace Frontier
