//============================================================================================================================================
//                                                           DISPLAYINTERCHANGE.H
//============================================================================================================================================
// 📦 Optional versioned C exchange for project-owned texture-backed displays (SurfaceDisplay sheets: a cabin tablet,
//    an instrument cluster, any in-world screen). The project rasters; Frontier.exe owns the texture slot, the
//    emissive material binding and the GPU refresh. Caller-owned arrays, synchronous copying, no borrowed storage.
//
//    Enumeration: the host calls with Ordinal = 0, 1, 2 … until the result is 0. Capacity 0 negotiates metadata
//    (SubjectName, Width, Height, Revision). With Capacity ≥ Width × Height × 4 the project copies straight-alpha
//    sRGB RGBA8 texels, v = 0 at the TOP row. A changed Width/Height is a new sheet (the host re-seats the slot);
//    a changed Revision at the same size is a refresh.
//
//    Touch: the host passes the pointer ray (world metres) and whether the primary button is held; a zero direction
//    means no pointer. The project resolves it against its own display pose and reports the sheet-pixel contact.
//    Text: when a display reports TextWanted (a field on the sheet has focus) the host routes the frame's typed
//    characters to it as UTF-8 in TypedText — backspace as U+0008, enter as U+000A — instead of to game keys.
//    ABI3 remains unchanged — this is a separate exported entry, probed by name like the smoke extension.
//    Revision 2 appended TypedText / TextWanted; the project refuses any other revision.

#pragma once

#include "ProjectInterchange.h"

#ifdef __cplusplus
extern "C"
{
#endif

// Result: 0 unsupported or past the last display; 1 accepted; 2 refused (malformed record).
typedef struct FrontierProjectDisplayReading
{
    uint32_t    StructureSize;      // [B]  - exact layout size
    uint32_t    InterchangeNumber;  // [-]  - extension revision, currently two
    uint32_t    Ordinal;            // [-]  - in: which display, zero-based
    const char* SubjectName;        // [-]  - out: material name the sheet binds to (project storage, valid until the next call)
    uint32_t    Width;              // [px] - out: sheet width
    uint32_t    Height;             // [px] - out: sheet height
    uint32_t    Capacity;           // [B]  - in: bytes available at Texels; zero negotiates metadata only
    uint8_t*    Texels;             // [-]  - caller-owned RGBA8 straight-alpha sRGB, row 0 at the top
    uint64_t    Revision;           // [-]  - out: increments per committed raster
    float       RayOrigin[3];       // [m]  - in: pointer ray origin, world
    float       RayDirection[3];    // [-]  - in: pointer ray direction, world; all zero = no pointer
    uint32_t    Pressed;            // [-]  - in: primary button held
    float       ContactAcross;      // [px] - out: sheet pixel under the pointer when ContactHit
    float       ContactDown;        // [px] - out
    uint32_t    ContactHit;         // [-]  - out: the ray meets the glass inside the outline
    float       Luminance;          // [nit]- out: emission the host assigns to the bound material (0 = leave authored)
    const char* TypedText;          // [-]  - in: UTF-8 typed this frame for the focused field (null = nothing); U+0008 backspace, U+000A enter
    uint32_t    TextWanted;         // [-]  - out: a text field on the sheet has focus; the host should route typing here
} FrontierProjectDisplayReading;

typedef uint32_t (FRONTIER_CODE_IMAGE_CALL* FrontierProjectDisplay)(void*, FrontierProjectDisplayReading*);

FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectDisplayInterchange(
    void* ProjectRecord, FrontierProjectDisplayReading* Reading);

#ifdef __cplusplus
}
#endif
