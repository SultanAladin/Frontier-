//============================================================================================================================================
//                                                     SMOKETRANSPORTINTERCHANGE.H
//============================================================================================================================================
// 📦 Optional caller-owned coarse world velocity, obstruction and completed contact injections for shared fine-volume transport.

#pragma once

#include "SmokeInterchange.h"

#ifdef __cplusplus
extern "C"
{
#endif

enum
{
    FrontierSmokeSourceCeiling = 384u,
    FrontierSmokeTransportNumber = 1u,
};

// Sources retain their physics-path positions. Rates are gas-tick weighted; divide their sum by CompletedTicks.
typedef struct FrontierSmokeInjection
{
    float PositionRadius[4];    // [m]       - world contact position and physical source radius
    float VelocityDensity[4];   // [m/s,1/s] - world injection momentum and smoke rate
    float Temperature[4];       // [K/s,1/s] - excess heat and combustion-provenance rates; zw reserved
} FrontierSmokeInjection;

typedef struct FrontierSmokeTransportReading
{
    uint32_t                  StructureSize;       // [B] - exact extension layout
    uint32_t                  InterchangeNumber;   // [-] - optional transport extension, independent of ABI3
    uint32_t                  Capacity;            // [-] - caller-owned coarse cell capacity; zero negotiates
    float*                    VelocityOccupancy;   // [-] - four floats/cell: world xyz m/s and solid fraction
    uint64_t                  CarrierIdentifier;   // [-] - must match the completed scalar snapshot
    uint64_t                  Revision;            // [-] - completed coarse gas revision
    uint32_t                  Extent;              // [-] - zero inactive, otherwise coarse cube axis count
    uint32_t                  CompletedTicks;      // [-] - gas ticks consumed by the latest project advance
    uint32_t                  SourceCount;         // [-] - completed physics-path sources
    uint32_t                  SourceOffsets[7];    // [-] - half-open per-gas-tick source ranges; last equals SourceCount
    float                     Origin[3];           // [m] - completed world-axis-aligned minimum
    float                     Span;                // [m] - finite domain side
    float                     SmokeLoss;           // [1/s] - scalar dissipation
    float                     Cooling;             // [1/s] - excess-temperature cooling
    float                     ChassisPosition[4];  // [m] - completed chassis world origin
    float                     ChassisInverse[4];   // [-] - inverse world quaternion, xyzw
    float                     ChassisMinimum[4];   // [m] - conservative local obstruction minimum
    float                     ChassisMaximum[4];   // [m] - conservative local obstruction maximum
    FrontierSmokeInjection    Sources[FrontierSmokeSourceCeiling];         // [-] - copied synchronously; no borrowed project storage
} FrontierSmokeTransportReading;

typedef uint32_t (FRONTIER_CODE_IMAGE_CALL* FrontierProjectSmokeTransport)(void*, FrontierSmokeTransportReading*);

FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectSmokeTransportInterchange(
    void* ProjectRecord, FrontierSmokeTransportReading* Reading);

#ifdef __cplusplus
}
#endif
