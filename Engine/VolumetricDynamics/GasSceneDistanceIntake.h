//==============================================================================================================================================
//                                                      GASSCENEDISTANCEINTAKE.H
//==============================================================================================================================================
// 📦 Level ②, bound to the engine's own global distance field — the one file that knows both the gas solver and the raster exist.
//
// GasCollisionIntake.h takes obstruction from a function pointer and a context so that the solver can run in
//    the headless checks with no raster linked. It prints the adapter in its own header as a comment and
//    leaves writing it to whoever has both. This is that file, and it is the whole of it.
//
// 💡 ARBITRARY GEOMETRY OBSTRUCTS GAS WITH NO NEW CODE IN THE SOLVER. A cathedral, a fractured wall, a tree —
//    anything already registered with GlobalDistanceFieldSpace answers "how far to the nearest surface", which
//    is the only question the admission asks. Nothing has to author a primitive for it.
//
// ⚠️ A SAMPLE IS A CLIPMAP LOOKUP AND THE ADMISSION TAKES 32768 OF THEM. That is the price of level ② and the
//    reason level ① exists: a crate is a box, and a box is six signed distances with no memory traffic. Give
//    the distance field the geometry that has no primitive, and only that.
//
// 📐 Both sides are metres, both put +Z up, and both call a negative distance "inside". There is nothing to
//    convert, which is why this file is a function and not a layer.

#pragma once

#include "GasCollisionIntake.h"

#include "../GeometricRaster/GlobalDistanceFieldSpace.h"

namespace Frontier {

/// 📦 The scene's distance at a world position, in the shape GasCollisionIntake.h wants it.
/// in    Context    [-]  a const GlobalDistanceFieldSpace*; null answers "nothing near", not a crash
/// in    Position   [m]  world position of a voxel centre
/// out   float      [m]  distance to the nearest surface; negative inside geometry
/// note  spelled against the composited global volume rather than the cascades, because a gas domain is a few
///       metres across and sits wherever it was authored, not wherever the camera happens to be looking
/// cost  🔴  one clipmap sample; the admission calls this per voxel
/// tag   api, nonallocating, nonthrowing
inline float ReadSceneDistance(const void* Context, const float Position[3]) noexcept
{
    const GlobalDistanceFieldSpace* const Scene = static_cast<const GlobalDistanceFieldSpace*>(Context);
    if (Scene == nullptr) return 1.0e6f;
    return Scene->SampleSceneDistance(Vector3{ Position[0], Position[1], Position[2] });
}


/// 📦 Admits the whole scene's geometry into one field as obstruction.
/// in    Field       [-]  the field
/// in    Scene       [-]  the global distance field; null admits nothing and is not an error
/// in    Thickness   [m]  surfaces grown by this much; zero asks for half a voxel, which is the thinnest
///                        wall this lattice can hold at all
/// out   uint32_t    [-]  voxels newly marked solid
/// cost  🔴  one distance sample per voxel
/// tag   api, nonallocating, nonthrowing
inline uint32_t AdmitSceneGeometry(CoarseGasField& Field, const GlobalDistanceFieldSpace* Scene,
                                   float Thickness = 0.0f) noexcept
{
    if (Scene == nullptr) return 0u;
    return AdmitDistanceReading(Field, &ReadSceneDistance, Scene, Thickness);
}

}   // namespace Frontier
