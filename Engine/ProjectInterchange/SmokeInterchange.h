//============================================================================================================================================
//                                                             SMOKEINTERCHANGE.H
//============================================================================================================================================
// 📦 Optional versioned C smoke and tyre-condition snapshots; caller-owned arrays, synchronous copying, no borrowed DLL storage.

#pragma once

#include "ProjectInterchange.h"

#ifdef __cplusplus
extern "C"
{
#endif

// Result: 0 unsupported; 1 accepted (including inactive); 2 refused. Capacity 0 requests metadata only.
// Density/temperature arrays are x-fastest, +Z-up, metre-world samples. Temperature is excess above ambient.
// CarrierIdentifier distinguishes respawns; Revision distinguishes completed gas ticks of that carrier.
// A resident volume retains world placement independently of the current car pose. ABI3 remains unchanged.
typedef struct FrontierProjectTyreReading
{
    float    SurfaceTemperature; // [K]  - rubber tread temperature
    float    CarcassTemperature; // [K]  - slower bulk rubber temperature
    float    GasTemperature;     // [K]  - enclosed air temperature
    float    GaugePressure;      // [Pa] - current absolute pressure minus atmosphere
    float    GripFactor;         // [-]  - this wheel only
    float    SlidingPower;       // [W]  - dissipated sliding, excluding support/disc work
    float    RemainingRubber;    // [kg] - available combustible mass
    uint32_t Condition;          // [-]  - bit 0 valid, bit 1 ignited
} FrontierProjectTyreReading;

typedef struct FrontierProjectSmokeReading
{
    uint32_t                  StructureSize;     // [B] - exact extension layout size
    uint32_t                  InterchangeNumber; // [-] - optional extension revision, currently one
    uint32_t                  Capacity;          // [-] - caller-owned scalar count; zero negotiates metadata
    float*                    Density;           // [-] - caller-owned density output
    float*                    Temperature;       // [K] - caller-owned excess-temperature output
    uint32_t                  Extent;            // [-] - cube axis count; zero is inactive, 32 is coarse transport
    float                     Origin[3];         // [m] - world minimum, not vehicle-local
    float                     Span;              // [m] - world cube side
    uint64_t                  CarrierIdentifier; // [-] - distinguishes vehicle deployment lifetimes
    uint64_t                  Revision;          // [-] - completed gas-tick revision
    uint32_t                  Refused;           // [-] - explicit source/domain refusal, not an empty plume
    uint32_t                  WheelCount;        // [-] - completed thermal subjects, at most eight
    FrontierProjectTyreReading Tyres[8];          // [-] - independent wheel conditions
} FrontierProjectSmokeReading;

typedef uint32_t (FRONTIER_CODE_IMAGE_CALL* FrontierProjectSmoke)(void*, FrontierProjectSmokeReading*);

FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectSmokeInterchange(
    void* ProjectRecord, FrontierProjectSmokeReading* Reading);

#ifdef __cplusplus
}
#endif
