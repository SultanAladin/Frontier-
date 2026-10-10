//============================================================================================================================================
//                                                        DISTANCEFIELDMATERIAL.SLANG
//============================================================================================================================================
// 📦 Shared authored material decoding for both surface-card capture and final material resolve.

#define FRONTIER_SDF_MATERIALS 1
#include "SceneShadingRecords.slang"

// 📝 13 and 14 are NOT free: MaterialEvaluation.slang claims them for EnergyLut and SheenLut, in every pass that
//    includes it. These start at 15 to leave that pair alone.
layout(std430, binding = 15) readonly store TriangleExtent     { GpuTriangle     Triangles[];     };
layout(std430, binding = 16) readonly store MaterialExtent     { GpuMaterial     Materials[];     };
layout(std430, binding = 17) readonly store InstanceExtent     { GpuInstance     Instances[];     };
layout(std430, binding = 18) readonly store MaterialSlabExtent { GpuMaterialSlab MaterialSlabs[]; };
layout(std430, binding = 19) readonly store VertexExtent       { GpuVertex       Vertices[];      };
layout(std430, binding = 20) readonly store IndexExtent        { uint            Indices[];       };

const uint kMaterialTextureNone = 0xFFFFFFFFu;
#define FRONTIER_AUTOMOTIVE_SHOWCASE 1
#include "MaterialEvaluation.slang"
#ifndef FRONTIER_CONSTANT_MATERIALS
layout(binding = 31) uniform sampler2D Textures[];
#endif
#include "SceneMaterialResolve.slang"

