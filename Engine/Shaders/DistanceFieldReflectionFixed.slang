//============================================================================================================================================
//                                                     DISTANCEFIELDREFLECTIONFIXED.SLANG
//============================================================================================================================================
// 📦 Field-traced specular pass, constant materials (no bindless texture table).

#version 460
#extension GL_GOOGLE_include_directive : require
#define FRONTIER_CONSTANT_MATERIALS 1
#include "DistanceFieldReflectionBody.slang"
