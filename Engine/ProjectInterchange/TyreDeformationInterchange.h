//============================================================================================================================================
//                                                     TYREDEFORMATIONINTERCHANGE.H
//============================================================================================================================================
// 📦 Optional versioned C tyre-deformation extension: per-wheel contact records the host's GPU bends tyre meshes with.

#pragma once

#include "ProjectInterchange.h"

#ifdef __cplusplus
extern "C"
{
#endif

// One wheel's record, in the exact 128-byte std430 layout of Shaders/TyreDeformation.slang
//    (GeometricRaster/TyreDeformationRecord.h documents every lane). All positions are host +Z-up metre world.
typedef struct FrontierTyreDeformationRecord
{
    float Values[32];
} FrontierTyreDeformationRecord;

// Calls are synchronous while the code image and ProjectRecord are alive. The caller owns Records and
//    SubjectNames (Capacity entries each); the project writes Count ≤ Capacity of them and points each SubjectName
//    at a string that stays valid until the next call. Capacity 0 negotiates: Count reports how many wheels the
//    project would publish. Revision advances with every completed physics step; a repeated Revision means the
//    records are unchanged. Result: 0 unsupported/inactive; 1 accepted; 2 refused.
typedef struct FrontierProjectTyreDeformationReading
{
    uint32_t                        StructureSize;
    uint32_t                        InterchangeNumber;   // [-] currently one
    uint32_t                        Capacity;            // [cnt] caller-owned record slots
    uint32_t                        Count;               // [cnt] records written
    const char**                    SubjectNames;        // [-]  scene placement name each record deforms
    FrontierTyreDeformationRecord*  Records;             // [-]  caller-owned output
    uint64_t                        Revision;
} FrontierProjectTyreDeformationReading;

typedef uint32_t (FRONTIER_CODE_IMAGE_CALL* FrontierProjectTyreDeformation)(void*, FrontierProjectTyreDeformationReading*);

FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ProjectTyreDeformationInterchange(
    void* ProjectRecord, FrontierProjectTyreDeformationReading* Reading);

#ifdef __cplusplus
}
#endif
