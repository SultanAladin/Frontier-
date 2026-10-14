//============================================================================================================================================
//                                                       DISPLAYMESHPROJECTION.H
//============================================================================================================================================
// 🧩 A small CPU projection of a triangle list into a display sheet: an orbit camera, a z-buffer, flat Lambert +
//    a rim term, per-triangle family colours. It exists so an in-world screen can show the vehicle's REAL mesh
//    (the same facets the scene was authored from) without a second GPU pipeline — the Garage app's turntable.
//    Not a renderer: no textures, no shadows, one pass, pixel-exact enough for a 640 × 400 sheet at a few hertz.

#pragma once

#include "DisplaySheetStructure.h"

#include <cstdint>
#include <vector>

namespace Frontier {

struct DisplayMeshFamily
{
    DisplayColour Colour;        // sRGB base
    float         Gloss = 0.3f;  // [-] highlight weight
    bool          Emissive = false;
};

struct DisplayMeshView
{
    float Yaw = 0.6f, Pitch = 0.32f;    // [rad] orbit angles about the mesh centre
    float Distance = 0.0f;              // [m]   0 = fit the bounds
    float FieldOfView = 0.6f;           // [rad] vertical
    float LightDirection[3] = { 0.4f, 0.3f, 0.86f };   // [-] toward the light, world
    DisplayColour Background{ 0x0e, 0x14, 0x17, 255 };
    DisplayColour Floor{ 0x18, 0x22, 0x26, 255 };
    bool  DrawFloorDisc = true;
    // Diagnostics: an explicit camera instead of the orbit, and a cutaway that drops facets above a height.
    bool  UseEye = false;
    float Eye[3] = { 0.0f, 0.0f, 0.0f }, Target[3] = { 1.0f, 0.0f, 0.0f };
    bool  Cutaway = false;
    float CutawayAboveZ = 0.0f;
};

class DisplayMeshProjection
{
public:
    // Positions: xyz per vertex (object space, Z up); Indices three per triangle; Family one per triangle.
    void AssignMesh(const float* Positions, uint32_t VertexCount, const uint32_t* Indices, uint32_t TriangleCount,
                    const uint32_t* Family, const DisplayMeshFamily* Families, uint32_t FamilyCount) noexcept;
    void Raster(DisplaySheetStructure& Sheet, const DisplayMeshView& View) noexcept;
    [[nodiscard]] uint32_t QueryTriangleCount() const noexcept { return static_cast<uint32_t>(Indices.size() / 3u); }

private:
    std::vector<float>             Positions;
    std::vector<uint32_t>          Indices, Family;
    std::vector<DisplayMeshFamily> Families;
    std::vector<float>             Depth;
    float Centre[3] = { 0.0f, 0.0f, 0.0f }, Radius = 1.0f, FloorZ = 0.0f;
};

} // namespace Frontier
